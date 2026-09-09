"""Anonymous, bounded HTTPS downloads of published stable GitHub release assets."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

REPOSITORY = 'luvxxxu/proxmox-cloudscape-ui'
MAX_ASSET = 1024 * 1024 * 1024


def version(value):
    if not isinstance(value, str) or not re.fullmatch(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', value):
        raise ValueError('Only stable vMAJOR.MINOR.PATCH releases are supported')
    return tuple(map(int, value[1:].split('.')))


def validate(value, repository=REPOSITORY):
    if not isinstance(value, dict):
        raise ValueError('Invalid release manifest')
    version(value.get('version'))
    if (value.get('schema') != 1 or value.get('repository') != repository
            or value.get('platform') != 'linux-x64' or value.get('nodeMajor') != 24
            or not re.fullmatch(r'[a-f0-9]{40}', value.get('commit', ''))):
        raise ValueError('Release repository, schema, commit or architecture mismatch')
    for kind, name in [('runtime', 'runtime-linux-x64.tar.gz'), ('source', 'source.tar.gz')]:
        asset = value.get(kind, {})
        if (asset.get('name') != name or not re.fullmatch(r'[a-f0-9]{64}', asset.get('sha256', ''))
                or type(asset.get('size')) is not int or not 0 < asset['size'] <= MAX_ASSET):
            raise ValueError('Invalid release asset metadata')
    return value


class HTTPSRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.startswith('https://'):
            raise ValueError('Refusing non-HTTPS redirect')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url, output, limit):
    if not url.startswith('https://github.com/' + REPOSITORY + '/releases/'):
        raise ValueError('Untrusted release download URL')
    opener = urllib.request.build_opener(HTTPSRedirect())
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'cloudscape-public-release/1'})
            with opener.open(request, timeout=60) as response, output.open('wb') as target:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > limit:
                        raise ValueError('Release download exceeds size limit')
                    target.write(chunk)
            return
        except urllib.error.HTTPError as error:
            error.close()
            output.unlink(missing_ok=True)
            if error.code == 404:
                raise RuntimeError('No published stable release or asset is available; installation/update stopped') from None
            if error.code not in (429, 500, 502, 503, 504):
                raise RuntimeError(f'Public release download failed (HTTP {error.code}); no token is required') from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            output.unlink(missing_ok=True)
        if attempt < 2:
            time.sleep(2 ** attempt)
    raise RuntimeError('Public release server could not be reached after three attempts; current version retained')


def latest(repository=REPOSITORY):
    if repository != REPOSITORY:
        raise ValueError('Unexpected release repository')
    with tempfile.TemporaryDirectory() as temporary:
        manifest = Path(temporary) / 'release.json'
        download(f'https://github.com/{repository}/releases/latest/download/release.json', manifest, 65536)
        return validate(json.loads(manifest.read_text()), repository)


def asset(manifest, kind, output):
    validate(manifest)
    metadata = manifest[kind]
    url = f'https://github.com/{manifest["repository"]}/releases/download/{manifest["version"]}/{metadata["name"]}'
    download(url, output, metadata['size'])
    with output.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if output.stat().st_size != metadata['size'] or digest != metadata['sha256']:
        output.unlink(missing_ok=True)
        raise ValueError('Release checksum or size mismatch; refusing to install')


def unpack_source(archive, destination):
    total = 0
    seen = set()
    with tarfile.open(archive, 'r:gz') as bundle:
        for member in bundle:
            name = PurePosixPath(member.name)
            if not name.parts and member.isdir():
                continue
            if (not name.parts or name.is_absolute() or '..' in name.parts or name.as_posix() in seen
                    or not (member.isfile() or member.isdir())):
                raise ValueError('Unsafe source archive')
            seen.add(name.as_posix())
            total += member.size
            if total > 256 * 1024 * 1024 or len(seen) > 10000:
                raise ValueError('Source archive exceeds limit')
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if member.isdir():
                target.mkdir(exist_ok=True)
            else:
                with bundle.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o644)


def runtime(manifest, directory):
    archive = directory / 'runtime.tar.gz'
    asset(manifest, 'runtime', archive)
    stage = directory / 'runtime'
    stage.mkdir(mode=0o700)
    spec = importlib.util.spec_from_file_location('runtime_unpacker', Path(__file__).with_name('pull-update.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.unpack_runtime(archive, stage, manifest['commit'], manifest['repository'])
    if not (stage / 'node/bin/node').is_file() or (stage / 'node/bin/node').is_symlink():
        raise ValueError('Release is missing the bundled Node executable')
    atomic_json(stage / 'public-release.json', manifest)
    return stage


def atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.release-')
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(value, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
