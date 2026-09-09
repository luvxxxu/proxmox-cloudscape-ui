#!/usr/bin/env bash
set -euo pipefail
[[ -f build/runtime.tar.gz ]] || { echo 'Export the tested runtime first.' >&2; exit 1; }
# Disposable Debian 12: real exported runtime, UID, files, Node and HTTP health.
# Only systemd process orchestration is substituted; no real LXC is modified.
docker run --rm -i --platform linux/amd64 -v "$PWD:/source:ro" \
  node:24-bookworm-slim bash -s <<'CHECK'
set -euo pipefail
apt-get update -qq
apt-get install -y --no-install-recommends python3 rsync shellcheck systemd >/dev/null
cd /source
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py' -v
shellcheck deploy/enable-auto-update.sh scripts/package-runtime.sh scripts/check-pull-deployment.sh
systemd-analyze verify deploy/proxmox-cloudscape-update.service deploy/proxmox-cloudscape-update.timer
mkdir -p /etc/proxmox-cloudscape /etc/systemd/system
cp deploy/proxmox-cloudscape.service /etc/systemd/system/
cat > /etc/proxmox-cloudscape/environment <<'ENV'
PROXMOX_HOST=https://fixture.invalid:8006
APP_ORIGIN=https://ui.test
SESSION_SECRET=fixture-only-secret-012345678901234567890123456789012345678901234567
ENV
chmod 0600 /etc/proxmox-cloudscape/environment
cat > /usr/local/bin/systemctl <<'SYSTEMCTL'
#!/bin/bash
set -euo pipefail
case "$1" in
  daemon-reload|enable) exit 0 ;;
  is-active) [[ -f /run/app.pid ]] && kill -0 "$(cat /run/app.pid)" 2>/dev/null ;;
  start|restart|stop)
    if [[ -f /run/app.pid ]]; then kill "$(cat /run/app.pid)" 2>/dev/null || true; rm /run/app.pid; sleep 1; fi
    [[ $1 != stop ]] || exit 0
    if [[ -f /run/fail-next-start ]]; then rm /run/fail-next-start; exit 1; fi
    set -a
    source /etc/proxmox-cloudscape/environment
    set +a
    export NODE_ENV=production HOSTNAME=127.0.0.1 PORT=3000
    cd /opt/proxmox-cloudscape/current
    setpriv --reuid=proxmox-ui --regid=proxmox-ui --init-groups /usr/local/bin/node server/custom-server.js >>/tmp/app.log 2>&1 &
    echo "$!" >/run/app.pid ;;
  *) exit 1 ;;
esac
SYSTEMCTL
chmod 0755 /usr/local/bin/systemctl
trap 'cat /tmp/app.log 2>/dev/null || true' EXIT
PYTHONDONTWRITEBYTECODE=1 python3 - <<'PYTHON'
import importlib.util, json, pathlib, tarfile, tempfile
spec = importlib.util.spec_from_file_location('updater', '/source/deploy/pull-update.py')
u = importlib.util.module_from_spec(spec); spec.loader.exec_module(u)
u.BASE = pathlib.Path('/source')
archive = pathlib.Path('/source/build/runtime.tar.gz')
with tarfile.open(archive) as bundle:
    metadata = json.load(bundle.extractfile('release.json'))
with tempfile.TemporaryDirectory() as temporary:
    root = pathlib.Path(temporary); stage = root / 'runtime'; stage.mkdir()
    u.unpack_runtime(archive, stage, metadata['commit'], metadata['repository'])
    source = root / 'source.tar.gz'; source.write_bytes(b'fixture source snapshot')
    config = pathlib.Path('/etc/proxmox-cloudscape/environment').read_bytes()
    u.deploy(stage, source)
    first = (u.APP / 'current').resolve()
    u.deploy(stage, source)
    second = (u.APP / 'current').resolve()
    assert first != second and (u.APP / 'previous').resolve() == first
    pathlib.Path('/run/fail-next-start').touch()
    try:
        u.deploy(stage, source)
    except RuntimeError:
        pass
    else:
        raise AssertionError('Injected start failure was not reported')
    assert (u.APP / 'current').resolve() == second
    assert (u.APP / 'previous').resolve() == first
    assert pathlib.Path('/etc/proxmox-cloudscape/environment').read_bytes() == config
    u.healthy()
    assert json.loads((u.APP / 'current/release.json').read_text()) == metadata
    print('PASS: exported runtime extraction, real Node health, repeated deployment, config preservation and failed-start rollback')
PYTHON
CHECK
