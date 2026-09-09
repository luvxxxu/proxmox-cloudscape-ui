#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root inside the LXC.' >&2; exit 1; }
[[ $(systemd-detect-virt --container) == lxc && $(uname -m) == x86_64 ]] || { echo 'An amd64 LXC is required.' >&2; exit 1; }
[[ -f /etc/proxmox-cloudscape/environment && -f /etc/systemd/system/proxmox-cloudscape.service ]] || { echo 'Complete the initial LXC installation first.' >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
[[ ! -L /run/proxmox-cloudscape-install ]] || exit 1
install -d -m 0700 -o root -g root /run/proxmox-cloudscape-install
exec 9>/run/proxmox-cloudscape-install/install.lock
flock -n 9 || { echo 'An installation/update is running. Retry after it finishes.' >&2; exit 1; }
timer_was_active=0
if systemctl is-active --quiet proxmox-cloudscape-update.timer; then
  timer_was_active=1
  systemctl stop proxmox-cloudscape-update.timer
fi
restore_timer() {
  if ((timer_was_active)); then systemctl start proxmox-cloudscape-update.timer; fi
}
trap restore_timer EXIT
apt-get update
apt-get install -y --no-install-recommends python3
destination=/usr/local/lib/proxmox-cloudscape-updater
install -d -m 0755 "$destination/deploy"
install -m 0644 "$source_dir/deploy/pull-update.py" "$destination/pull-update.py"
install -m 0644 "$source_dir/.env.local.example" "$destination/.env.local.example"
install -m 0644 "$source_dir/deploy/install-systemd.sh" "$source_dir/deploy/proxmox-cloudscape.service" "$destination/deploy/"
# The token is read from the terminal, never from command arguments or shell history.
python3 -c '
import getpass, json, os, pathlib, tempfile, sys
if not sys.stdin.isatty():
    raise SystemExit("Run interactively inside the LXC so the token is not echoed.")
directory = pathlib.Path("/etc/proxmox-cloudscape")
repository = input("Repository [luvxxxu/proxmox-cloudscape-ui]: ").strip() or "luvxxxu/proxmox-cloudscape-ui"
branch = input("Deployment branch [main]: ").strip() or "main"
token = getpass.getpass("GitHub token (Contents:read, Actions:read): ").strip()
fd, temporary = tempfile.mkstemp(dir=directory, prefix=".auto-update-")
try:
    with os.fdopen(fd, "w") as output:
        json.dump(dict(repository=repository, branch=branch, workflow="ci.yml", token=token), output)
    import importlib.util
    spec = importlib.util.spec_from_file_location("updater", "/usr/local/lib/proxmox-cloudscape-updater/pull-update.py")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    config = module.private_json(pathlib.Path(temporary))
    github = module.GitHub(config)
    github.head()
    github.request("/actions/workflows/ci.yml")
    os.replace(temporary, directory / "auto-update.json")
finally:
    pathlib.Path(temporary).unlink(missing_ok=True)
'
install -m 0644 "$source_dir/deploy/proxmox-cloudscape-update.service" "$source_dir/deploy/proxmox-cloudscape-update.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now proxmox-cloudscape-update.timer
echo 'Automatic updates enabled. Check: journalctl -u proxmox-cloudscape-update'
