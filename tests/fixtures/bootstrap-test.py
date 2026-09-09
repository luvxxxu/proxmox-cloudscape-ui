"""Exercise piped installer prompts in a disposable Debian container with fake I/O.
The actual install/runtime/proxy is covered by check-lxc-install.sh.
"""
import io
import tarfile
import hashlib
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
    for name in ('public_release.py', 'pull-update.py'):
        (checkout / 'deploy' / name).write_bytes((root / 'deploy' / name).read_bytes())
    (checkout / 'deploy/enable-auto-update.sh').write_text('echo Public updates enabled without credentials\n')
    (checkout / '.env.local.example').write_text('SESSION_SECRET=\n')
    (checkout / 'deploy/check-lxc-sandbox.sh').write_text('exit 0\n')
    arguments = work / 'arguments.json'
    (checkout / 'deploy/install-lxc.sh').write_text(
        'python3 -c \'import json,sys; json.dump(sys.argv[2:],open(sys.argv[1],"w"))\' '
        + shlex.quote(str(arguments)) + ' "$@"\n')
    payload = work / 'runtime.tar.gz'
    metadata = dict(commit='a' * 40, repository='luvxxxu/proxmox-cloudscape-ui', platform='linux-x64', nodeMajor=24)
    with tarfile.open(payload, 'w:gz') as bundle:
        for name, content in [('release.json', json.dumps(metadata).encode()), ('node/bin/node', b'fixture-node')]:
            item = tarfile.TarInfo(name); item.size = len(content); item.mode = 0o755
            bundle.addfile(item, io.BytesIO(content))
    source_archive = work / 'source.tar.gz'
    with tarfile.open(source_archive, 'w:gz') as bundle:
        for path in checkout.rglob('*'):
            if path.is_file(): bundle.add(path, arcname=str(path.relative_to(checkout)), recursive=False)
    manifest = dict(schema=1, version='v0.2.1', **metadata)
    for kind, path, name in [('runtime', payload, 'runtime-linux-x64.tar.gz'), ('source', source_archive, 'source.tar.gz')]:
        manifest[kind] = dict(name=name, size=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    (work / 'release.json').write_text(json.dumps(manifest))
    (work / 'sitecustomize.py').write_text("""
import io, pathlib, urllib.request
root = pathlib.Path(__file__).parent
def fake(self, request, *args, **kwargs):
    url = request if isinstance(request, str) else request.full_url
    assert '/releases/' in url and url.startswith('https://github.com/luvxxxu/proxmox-cloudscape-ui/')
    assert not isinstance(request, urllib.request.Request) or not request.has_header('Authorization')
    name = url.rsplit('/', 1)[1]
    if name == 'runtime-linux-x64.tar.gz': name = 'runtime.tar.gz'
    return io.BytesIO((root / name).read_bytes())
urllib.request.OpenerDirector.open = fake
""")
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
        os.environ['PYTHONPATH'] = str(work)
        os.environ['PATH'] = str(commands) + ':' + os.environ['PATH']
        os.execv('/bin/bash', ['bash', '-c', 'cat /source/deploy/bootstrap-lxc.sh | bash'])
    prompts = [
        ('기존 Proxmox 접속 주소 (', '182.215.187.108'),
        ('새 UI 외부 도메인 (', 'pve.lxvu.dev'),
        ('Caddy에서 연결할 이 컨테이너의 내부 IPv4 [', ''),
        ('별도 Caddy 컨테이너의 내부 IPv4 (공인 IP 아님):', '182.215.187.108'),
        ('별도 Caddy 컨테이너의 내부 IPv4 (공인 IP 아님):', '10.0.0.10'),
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
        print('PASS: curl-pipe style TTY prompts, IP/URL normalization, public peer rejection, default internal IP, automatic anonymous release updater')
    finally:
        os.close(master)
