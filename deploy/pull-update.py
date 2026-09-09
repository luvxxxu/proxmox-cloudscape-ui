#!/usr/bin/env python3
"""Root-owned pull deployer; executes only the locally installed deployment helper."""
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import signal
import stat
import subprocess
import tarfile
import tempfile
import time
import urllib.request


BASE = Path(__file__).resolve().parent
APP = Path('/opt/proxmox-cloudscape')
CONFIG = Path('/etc/proxmox-cloudscape/auto-update.json')
UNIT = Path('/etc/systemd/system/proxmox-cloudscape.service')
MAX_ARCHIVE = 1024 * 1024 * 1024


def private_json(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise ValueError('Updater configuration must be a root-owned regular file with mode 0600')
    value = json.loads(path.read_text())
    if value != {'repository': 'luvxxxu/proxmox-cloudscape-ui', 'channel': 'stable'}:
        raise ValueError('Expected the public stable release configuration; rerun enable-auto-update.sh to migrate')
    return value


def unpack_runtime(archive, stage, sha, repository):
    # Reject links escaping the archive and special files, even for published releases.
    with tarfile.open(archive, 'r:gz') as bundle:
        seen = set()
        total = 0
        for member in bundle.getmembers():
            name = PurePosixPath(member.name)
            if (name.is_absolute() or '..' in name.parts or name.as_posix() in seen
                    or not (member.isfile() or member.isdir() or member.issym())
                    or not name.parts or name.parts[0] not in {'.next', 'node_modules', 'public', 'server', 'package.json', 'next.config.mjs', 'release.json', 'node'}):
                raise ValueError('Unsafe runtime archive entry')
            seen.add(name.as_posix())
            total += member.size
            if member.size < 0 or len(seen) > 250000 or total > 4 * MAX_ARCHIVE:
                raise ValueError('Expanded runtime exceeds size limit')
        # Debian 12's Python 3.11 does not expose tar extraction filters.
        # Extract regular files/directories/internal symlinks explicitly instead.
        root = stage.resolve()
        for member in bundle.getmembers():
            target = stage / member.name
            for parent in target.relative_to(stage).parents:
                if (stage / parent).is_symlink():
                    raise ValueError('Archive entry traverses a symbolic link')
            if target.is_symlink():
                raise ValueError('Archive entry overwrites a symbolic link')
            target.parent.mkdir(parents=True, exist_ok=True)
            if member.isdir():
                target.mkdir(exist_ok=True)
                target.chmod(0o755)
            elif member.issym():
                if (not member.linkname or Path(member.linkname).is_absolute()
                        or not (target.parent / member.linkname).resolve().is_relative_to(root)):
                    raise ValueError('Archive symlink escapes the runtime')
                target.symlink_to(member.linkname)
            else:
                with bundle.extractfile(member) as source, target.open('wb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
    metadata = json.loads((stage / 'release.json').read_text())
    if metadata != {'commit': sha, 'repository': repository, 'platform': 'linux-x64', 'nodeMajor': 24}:
        raise ValueError('Runtime commit, repository or platform mismatch')


def command(*args):
    process = subprocess.Popen(args, start_new_session=True)
    try:
        if process.wait(timeout=180) != 0:
            raise RuntimeError('Deployment command failed')
    except BaseException:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        raise


def healthy():
    for _ in range(30):
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:3000/api/health', timeout=2) as response:
                if response.status == 200 and json.loads(response.read(4096)).get('status') == 'ok':
                    return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError('Application readiness check failed')


def restore_link(path, target):
    if target is None:
        path.unlink(missing_ok=True)
    else:
        temporary = path.with_name('.' + path.name + '-restore')
        temporary.unlink(missing_ok=True)
        temporary.symlink_to(target)
        temporary.replace(path)


def deploy(stage, source_archive):
    links = {}
    for name in ('current', 'previous'):
        path = APP / name
        if path.exists() and not path.is_symlink():
            raise ValueError('Release pointers must be symbolic links')
        links[name] = os.readlink(path) if path.is_symlink() else None
    old_unit = UNIT.read_bytes() if UNIT.exists() else None
    was_active = subprocess.run(['systemctl', 'is-active', '--quiet', 'proxmox-cloudscape'], check=False).returncode == 0
    try:
        command('bash', str(BASE / 'deploy/install-systemd.sh'), '--source-dir', str(stage))
        shutil.copyfile(stage / 'release.json', APP / 'current/release.json')
        if (stage / 'public-release.json').is_file():
            shutil.copyfile(stage / 'public-release.json', APP / 'current/public-release.json')
        shutil.copyfile(source_archive, APP / 'current/source.tar.gz')
        (APP / 'current/source.tar.gz').chmod(0o600)
        command('systemctl', 'restart', 'proxmox-cloudscape')
        healthy()
    except Exception:
        for name, target in links.items():
            restore_link(APP / name, target)
        if old_unit is None:
            UNIT.unlink(missing_ok=True)
        else:
            UNIT.write_bytes(old_unit)
        command('systemctl', 'daemon-reload')
        command('systemctl', 'restart' if was_active else 'stop', 'proxmox-cloudscape')
        if was_active:
            healthy()
        raise


def update(config):
    import public_release
    manifest = public_release.latest(config['repository'])
    installed = APP / 'current/public-release.json'
    if installed.exists():
        current = public_release.validate(json.loads(installed.read_text()), config['repository'])
        if public_release.version(manifest['version']) <= public_release.version(current['version']):
            print('Already running the latest stable release; no downgrade performed')
            return
    with tempfile.TemporaryDirectory(prefix='cloudscape-release-') as temporary:
        directory = Path(temporary)
        stage = public_release.runtime(manifest, directory)
        source = directory / 'source.tar.gz'
        public_release.asset(manifest, 'source', source)
        # Do not activate a superseded or replaced release after a long download.
        if public_release.latest(config['repository']) != manifest:
            print('Published release changed while downloading; retrying next time')
            return
        deploy(stage, source)
    print('Installed stable release ' + manifest['version'])


def main():
    if os.geteuid() != 0 or os.uname().machine != 'x86_64':
        raise ValueError('Run as root in the configured amd64 Debian LXC')
    if subprocess.check_output(['systemd-detect-virt', '--container'], text=True).strip() != 'lxc':
        raise ValueError('This updater must run inside the application LXC')
    if not (Path('/etc/proxmox-cloudscape/environment').is_file() and UNIT.is_file()):
        raise ValueError('Complete the initial LXC installation first')
    lock_dir = Path('/run/proxmox-cloudscape-install')
    if lock_dir.is_symlink():
        raise ValueError('Unsafe lock directory')
    lock_dir.mkdir(mode=0o700, exist_ok=True)
    with (lock_dir / 'install.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Another installation is running')
            return
        update(private_json(CONFIG))


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise RuntimeError('Update interrupted; attempting rollback if activation started')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        main()
    except Exception as error:
        # Do not print HTTP redirect URLs, token-bearing requests or config values.
        print('Update failed:', type(error).__name__, str(error) if isinstance(error, (ValueError, RuntimeError)) else 'see service state; current release retained or rollback attempted')
        raise SystemExit(1) from None
