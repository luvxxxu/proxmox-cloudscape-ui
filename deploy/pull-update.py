#!/usr/bin/env python3
"""Root-owned pull deployer; executes only the locally installed deployment helper."""
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

BASE = Path(__file__).resolve().parent
APP = Path('/opt/proxmox-cloudscape')
CONFIG = Path('/etc/proxmox-cloudscape/auto-update.json')
UNIT = Path('/etc/systemd/system/proxmox-cloudscape.service')
MAX_ARCHIVE = 1024 * 1024 * 1024


class HTTPSRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != 'https':
            raise ValueError('Refusing a non-HTTPS download redirect')
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected and urllib.parse.urlsplit(req.full_url).netloc != urllib.parse.urlsplit(newurl).netloc:
            redirected.remove_header('Authorization')
        return redirected


def private_json(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise ValueError('Updater configuration must be a root-owned regular file with mode 0600')
    value = json.loads(path.read_text())
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', value.get('repository', '')):
        raise ValueError('Invalid repository')
    if not re.fullmatch(r'[A-Za-z0-9_./-]+', value.get('branch', '')):
        raise ValueError('Invalid branch')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+\.ya?ml', value.get('workflow', '')):
        raise ValueError('Invalid workflow filename')
    if not re.fullmatch(r'[A-Za-z0-9_]+', value.get('token', '')):
        raise ValueError('A GitHub read-only token is required')
    return value


class GitHub:
    def __init__(self, config):
        self.config = config
        self.opener = urllib.request.build_opener(HTTPSRedirect())
        self.prefix = 'https://api.github.com/repos/' + config['repository']

    def request(self, path, output=None):
        req = urllib.request.Request(self.prefix + path, headers={
            'Authorization': 'Bearer ' + self.config['token'],
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'proxmox-cloudscape-updater',
        })
        try:
            with self.opener.open(req, timeout=60) as response:
                if output is None:
                    data = response.read(8 * 1024 * 1024 + 1)
                    if len(data) > 8 * 1024 * 1024:
                        raise ValueError('GitHub response exceeds size limit')
                    return json.loads(data)
                total = 0
                with output.open('wb') as target:
                    while chunk := response.read(1024 * 1024):
                        total += len(chunk)
                        if total > MAX_ARCHIVE:
                            raise ValueError('Download exceeds size limit')
                        target.write(chunk)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'GitHub request failed: HTTP {error.code}') from None
        except urllib.error.URLError:
            raise RuntimeError('GitHub HTTPS connection failed') from None

    def head(self):
        branch = urllib.parse.quote(self.config['branch'], safe='')
        sha = self.request('/branches/' + branch)['commit']['sha']
        if not re.fullmatch(r'[a-f0-9]{40}', sha):
            raise ValueError('Invalid GitHub commit')
        return sha


def select_run(runs, sha, config):
    for run in runs:
        if (run.get('head_sha') == sha and run.get('head_branch') == config['branch']
                and run.get('event') == 'push' and run.get('status') == 'completed'
                and run.get('conclusion') == 'success'
                and run.get('head_repository', {}).get('full_name', '').lower() == config['repository'].lower()
                and run.get('path') == '.github/workflows/' + config['workflow']):
            return run
    return None


def unpack_runtime(archive, stage, sha, repository):
    # Reject links escaping the archive and special files, even for CI artifacts.
    with tarfile.open(archive, 'r:gz') as bundle:
        seen = set()
        total = 0
        for member in bundle.getmembers():
            name = PurePosixPath(member.name)
            if (name.is_absolute() or '..' in name.parts or name.as_posix() in seen
                    or not (member.isfile() or member.isdir() or member.issym())
                    or name.parts[0] not in {'.next', 'node_modules', 'public', 'server', 'package.json', 'next.config.mjs', 'release.json'}):
                raise ValueError('Unsafe runtime archive entry')
            seen.add(name.as_posix())
            total += member.size
            if total > 4 * MAX_ARCHIVE:
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


def unpack_artifact(archive, output, digest):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest or ''):
        raise ValueError('GitHub artifact digest is missing')
    with archive.open('rb') as stream:
        actual = 'sha256:' + hashlib.file_digest(stream, 'sha256').hexdigest()
    if actual != digest:
        raise ValueError('GitHub artifact digest mismatch')
    with zipfile.ZipFile(archive) as bundle:
        if bundle.namelist() != ['runtime.tar.gz']:
            raise ValueError('Unexpected artifact contents')
        if bundle.getinfo('runtime.tar.gz').file_size > MAX_ARCHIVE:
            raise ValueError('Runtime exceeds size limit')
        with bundle.open('runtime.tar.gz') as source, output.open('wb') as target:
            shutil.copyfileobj(source, target)


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
    old_unit = UNIT.read_bytes()
    was_active = subprocess.run(['systemctl', 'is-active', '--quiet', 'proxmox-cloudscape'], check=False).returncode == 0
    try:
        command('bash', str(BASE / 'deploy/install-systemd.sh'), '--source-dir', str(stage))
        shutil.copyfile(stage / 'release.json', APP / 'current/release.json')
        shutil.copyfile(source_archive, APP / 'current/source.tar.gz')
        (APP / 'current/source.tar.gz').chmod(0o600)
        command('systemctl', 'restart', 'proxmox-cloudscape')
        healthy()
    except Exception:
        for name, target in links.items():
            restore_link(APP / name, target)
        UNIT.write_bytes(old_unit)
        command('systemctl', 'daemon-reload')
        command('systemctl', 'restart' if was_active else 'stop', 'proxmox-cloudscape')
        if was_active:
            healthy()
        raise


def update(config):
    github = GitHub(config)
    sha = github.head()
    installed = APP / 'current/release.json'
    if installed.exists():
        current = json.loads(installed.read_text())
        if current.get('commit') == sha and current.get('repository') == config['repository']:
            print('Already running the current commit')
            return
    query = urllib.parse.urlencode({'branch': config['branch'], 'event': 'push', 'head_sha': sha, 'status': 'success', 'per_page': 100})
    runs = github.request('/actions/workflows/' + config['workflow'] + '/runs?' + query)['workflow_runs']
    run = select_run(runs, sha, config)
    if run is None:
        print('Latest commit has no successful CI run; keeping the current release')
        return
    artifacts = github.request(f'/actions/runs/{int(run["id"])}/artifacts?per_page=100')['artifacts']
    matches = [item for item in artifacts if item['name'] == 'runtime-linux-x64-' + sha and not item['expired']]
    if len(matches) != 1:
        raise ValueError('Expected exactly one unexpired runtime artifact; push a new commit to rebuild')
    artifact = matches[0]
    with tempfile.TemporaryDirectory(prefix='cloudscape-pull-') as temporary:
        directory = Path(temporary)
        zip_path = directory / 'artifact.zip'
        github.request(f'/actions/artifacts/{int(artifact["id"])}/zip', zip_path)
        archive = directory / 'runtime.tar.gz'
        unpack_artifact(zip_path, archive, artifact.get('digest'))
        stage = directory / 'runtime'
        stage.mkdir(mode=0o700)
        unpack_runtime(archive, stage, sha, config['repository'])
        source = directory / 'source.tar.gz'
        github.request('/tarball/' + sha, source)
        if github.head() != sha:
            print('Branch changed while downloading; waiting for the next check')
            return
        deploy(stage, source)
    print('Deployed commit ' + sha)


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
