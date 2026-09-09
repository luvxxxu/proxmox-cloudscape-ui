#!/usr/bin/env bash
set -euo pipefail

# Run after bun install --frozen-lockfile && bun run check && bun run build.
# This script installs files and enables the service; it does not change a cluster.
if [[ $(id -u) -ne 0 ]]; then
  echo 'Run this installer with sudo on the Debian VM/LXC.' >&2
  exit 1
fi
command -v rsync >/dev/null || { echo 'Install rsync first: apt-get install rsync' >&2; exit 1; }
[[ -x /usr/local/bin/node ]] || { echo 'Node.js 24 must be installed at /usr/local/bin/node.' >&2; exit 1; }
[[ $(/usr/local/bin/node -p 'process.versions.node.split(".")[0]') == 24 ]] || { echo 'Node.js 24 LTS is required.' >&2; exit 1; }
trusted_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
source_dir=$trusted_root
if (( $# )); then
  if [[ $# != 2 || $1 != --source-dir ]]; then
    echo 'Usage: install-systemd.sh [--source-dir BUILT_APPLICATION_DIRECTORY]' >&2
    exit 1
  fi
  source_dir=$2
fi
[[ -d "$source_dir" && ! -L "$source_dir" ]] || { echo 'Build source must be a real directory, not a symlink.' >&2; exit 1; }
source_dir=$(cd -- "$source_dir" && pwd -P)
validate_runtime_tree() {
  local directory=$1 part
  for part in .next node_modules public server; do
    [[ -d "$directory/$part" && ! -L "$directory/$part" ]] || { echo "Build directory is missing or is a symlink: $part" >&2; return 1; }
  done
  for part in .next/BUILD_ID next.config.mjs package.json; do
    [[ -f "$directory/$part" && ! -L "$directory/$part" ]] || { echo "Build file is missing, irregular, or is a symlink: $part" >&2; return 1; }
  done
  [[ -s "$directory/.next/BUILD_ID" ]] || { echo 'A production build is required. Run bun run build first.' >&2; return 1; }
  if [[ -L "$directory/.next/cache" || ( -e "$directory/.next/cache" && ! -d "$directory/.next/cache" ) ]]; then
    echo 'The application cache must be a real directory, not a symlink or file.' >&2
    return 1
  fi
}
validate_runtime_tree "$source_dir"
for part in deploy/proxmox-cloudscape.service .env.local.example; do
  [[ -f "$trusted_root/$part" && ! -L "$trusted_root/$part" ]] || { echo "Missing or unsafe trusted installation input: $part" >&2; exit 1; }
done
if [[ -e /opt/proxmox-cloudscape/current && ! -L /opt/proxmox-cloudscape/current ]]; then
  echo '/opt/proxmox-cloudscape/current must be absent or a symlink.' >&2
  exit 1
fi
getent passwd proxmox-ui >/dev/null || useradd --system --home-dir /opt/proxmox-cloudscape --shell /usr/sbin/nologin proxmox-ui
[[ $(id -u proxmox-ui) != 0 && $(id -g proxmox-ui) != 0 ]] || { echo 'The application user and its primary group must not be root.' >&2; exit 1; }
release="$(date -u +%Y%m%dT%H%M%SZ)-$$"
release_dir="/opt/proxmox-cloudscape/releases/$release"
# Keep the entire destination inaccessible to the build account until copied
# modes have been normalized, preventing source races from changing root paths.
install -d -m 0700 "$release_dir"
install -d -m 0755 /etc/proxmox-cloudscape
for part in .next node_modules public server next.config.mjs package.json; do
  rsync -a --chown=root:root --exclude='.env*' "$source_dir/$part" "$release_dir/"
done
validate_runtime_tree "$release_dir"
# The service can read code but cannot replace it, even if source modes were permissive.
for part in .next node_modules public server next.config.mjs package.json; do
  chmod -R u=rwX,go=rX "$release_dir/$part"
done
install -d -o proxmox-ui -g proxmox-ui -m 0700 "$release_dir/.next/cache"
chown -R -h proxmox-ui:proxmox-ui "$release_dir/.next/cache"
chmod 0755 "$release_dir"
install -m 0644 "$trusted_root/deploy/proxmox-cloudscape.service" /etc/systemd/system/proxmox-cloudscape.service
if [[ ! -e /etc/proxmox-cloudscape/environment ]]; then
  install -m 0600 "$trusted_root/.env.local.example" /etc/proxmox-cloudscape/environment
fi
staged_link="/opt/proxmox-cloudscape/.current-$release"
trap 'rm -f "$staged_link"' EXIT
ln -s "$release_dir" "$staged_link"
if [[ -L /opt/proxmox-cloudscape/current ]]; then
  previous=$(readlink /opt/proxmox-cloudscape/current)
  ln -sfn "$previous" /opt/proxmox-cloudscape/previous
fi
mv -Tf "$staged_link" /opt/proxmox-cloudscape/current
systemctl daemon-reload
systemctl enable proxmox-cloudscape.service
printf 'Installed release %s.\nConfigure /etc/proxmox-cloudscape/environment and proxmox-ca.pem, then run:\n  systemctl restart proxmox-cloudscape\n' "$release"
