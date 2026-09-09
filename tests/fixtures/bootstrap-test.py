"""Exercise piped installer prompts in a disposable Debian container with fake I/O.
The actual install/runtime/proxy is covered by check-lxc-install.sh.
"""
import json
import os
from pathlib import Path
import pty
import select
import shlex
import subprocess
import tempfile
import time

root = Path('/source')
Path('/run/systemd/system').mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory() as temporary:
    work = Path(temporary)
    commands = work / 'bin'
    commands.mkdir()
    checkout = work / 'checkout'
    (checkout / 'deploy').mkdir(parents=True)
    (checkout / 'deploy/configure-proxy.py').write_bytes((root / 'deploy/configure-proxy.py').read_bytes())
    (checkout / '.env.local.example').write_text('SESSION_SECRET=\n')
    (checkout / 'deploy/check-lxc-sandbox.sh').write_text('exit 0\n')
    arguments = work / 'arguments.json'
    (checkout / 'deploy/install-lxc.sh').write_text(
        'python3 -c \'import json,sys; json.dump(sys.argv[2:],open(sys.argv[1],"w"))\' '
        + shlex.quote(str(arguments)) + ' "$@"\n')
    scripts = {
        'apt-get': 'exit 0',
        'uname': 'echo x86_64',
        'systemd-detect-virt': 'echo lxc',
        'git': f'cp -a {shlex.quote(str(checkout))} "${{@: -1}}"',
        'ip': '''case "$*" in
          '-4 route get 1.1.1.1') echo '1.1.1.1 via 10.0.0.1 dev eth0 src 10.0.0.20' ;;
          '-j -4 address') echo '[{"addr_info":[{"local":"10.0.0.20"}]}]' ;;
          *) echo 'eth0 UP 10.0.0.20/24' ;;
        esac''',
        'curl': '''while (($#)); do
          if [[ $1 == -o ]]; then printf '%s' '{"data":[{"realm":"pam","type":"pam"}]}' > "$2"; exit 0; fi
          shift
        done
        exit 1''',
    }
    for name, script in scripts.items():
        path = commands / name
        path.write_text('#!/bin/bash\nset -eu\n' + script + '\n')
        path.chmod(0o755)
    pid, master = pty.fork()
    if pid == 0:
        os.environ['PATH'] = str(commands) + ':' + os.environ['PATH']
        os.execv('/bin/bash', ['bash', '-c', 'cat /source/deploy/bootstrap-lxc.sh | bash'])
    prompts = [
        ('기존 Proxmox 접속 주소 (', '182.215.187.108'),
        ('새 UI 외부 도메인 (', 'pve.lxvu.dev'),
        ('Caddy에서 연결할 이 컨테이너의 내부 IPv4 [', ''),
        ('별도 Caddy 컨테이너의 내부 IPv4 (공인 IP 아님):', '182.215.187.108'),
        ('별도 Caddy 컨테이너의 내부 IPv4 (공인 IP 아님):', '10.0.0.10'),
        ('GitHub Actions 자동 업데이트도 설정할까요?', ''),
    ]
    pending = ''
    transcript = ''
    index = 0
    deadline = time.monotonic() + 30
    try:
        while time.monotonic() < deadline:
            if not select.select([master], [], [], 0.2)[0]:
                continue
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            text = data.decode(errors='replace')
            transcript += text
            pending += text
            if index < len(prompts) and prompts[index][0] in pending:
                pending = ''
                os.write(master, (prompts[index][1] + '\n').encode())
                index += 1
        else:
            os.kill(pid, 9)
            raise AssertionError('Installer timed out: ' + transcript)
        _, status = os.waitpid(pid, 0)
        assert os.waitstatus_to_exitcode(status) == 0, transcript
        assert index == len(prompts), transcript
        args = json.loads(arguments.read_text())
        for key, value in (('--proxmox-host', 'https://182.215.187.108:8006'),
                           ('--app-origin', 'https://pve.lxvu.dev'),
                           ('--proxy-bind', '10.0.0.20:8080'), ('--proxy-source', '10.0.0.10')):
            assert args[args.index(key) + 1] == value, args
        assert '--behind-proxy' in args
        assert '--tls-cert' not in args
        print('PASS: curl-pipe style TTY prompts, IP/URL normalization, public peer rejection, default internal IP, optional updater')
    finally:
        os.close(master)
