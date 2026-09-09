#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root inside the LXC.' >&2; exit 1; }
[[ $(systemd-detect-virt --container) == lxc && $(uname -m) == x86_64 ]] || { echo 'An amd64 LXC is required.' >&2; exit 1; }
[[ -f /etc/proxmox-cloudscape/environment && -f /etc/systemd/system/proxmox-cloudscape.service ]] || { echo 'Complete the initial LXC installation first.' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
[[ ! -L /run/proxmox-cloudscape-install ]] || exit 1
install -d -m 0700 /run/proxmox-cloudscape-install
exec 9>/run/proxmox-cloudscape-install/install.lock
flock -n 9 || { echo 'An installation/update is running. Retry after it finishes.' >&2; exit 1; }
# This also replaces legacy token configuration; no PAT is read or retained.
command -v python3 >/dev/null
systemctl stop proxmox-cloudscape-update.timer || true
destination=/usr/local/lib/proxmox-cloudscape-updater
install -d -m 0755 "$destination/deploy"
install -m 0644 "$source_dir/deploy/pull-update.py" "$source_dir/deploy/public_release.py" "$destination/"
install -m 0644 "$source_dir/.env.local.example" "$destination/.env.local.example"
install -m 0644 "$source_dir/deploy/install-systemd.sh" "$source_dir/deploy/proxmox-cloudscape.service" "$destination/deploy/"
python3 - "$destination" <<'PY'
import pathlib, sys
sys.path.insert(0, sys.argv[1])
from public_release import atomic_json
atomic_json(pathlib.Path('/etc/proxmox-cloudscape/auto-update.json'), {
    'repository': 'luvxxxu/proxmox-cloudscape-ui', 'channel': 'stable'
})
PY
install -m 0644 "$source_dir/deploy/proxmox-cloudscape-update.service" "$source_dir/deploy/proxmox-cloudscape-update.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now proxmox-cloudscape-update.timer
echo 'Public stable release updates enabled (every 15 minutes). No GitHub account or token needed.'
