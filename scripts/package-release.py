#!/usr/bin/env python3
"""Prepare immutable release assets from the runtime tested by CI."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'deploy'))
import public_release

root = Path('build')
version = os.environ['RELEASE_VERSION']
public_release.version(version)
if version != 'v0.0.0' and version != 'v' + json.loads(Path('package.json').read_text())['version']:
    raise ValueError('Release tag must match package.json version')
manifest = dict(schema=1, version=version, repository=os.environ['GITHUB_REPOSITORY'],
                commit=os.environ['GITHUB_SHA'], platform='linux-x64', nodeMajor=24)
for kind, original, name in [('runtime', 'runtime.tar.gz', 'runtime-linux-x64.tar.gz'),
                             ('source', 'proxmox-cloudscape-ui-source.tar.gz', 'source.tar.gz')]:
    shutil.copyfile(root / original, root / name)
    with (root / name).open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    manifest[kind] = dict(name=name, size=(root / name).stat().st_size, sha256=digest)
public_release.validate(manifest)
(root / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
shutil.copyfile('deploy/bootstrap-lxc.sh', root / 'install.sh')
