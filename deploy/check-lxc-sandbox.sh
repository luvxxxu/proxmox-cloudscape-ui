#!/usr/bin/env bash
set -euo pipefail

# Run inside the new LXC before downloading/building the application. This only
# starts a temporary guest service; it never changes the Proxmox host or CT policy.
if [[ $(id -u) -ne 0 ]]; then
  echo 'Run the LXC sandbox check as root inside the Debian container.' >&2
  exit 1
fi
for executable in systemd-detect-virt systemd-run systemctl timeout; do
  command -v "$executable" >/dev/null || { echo "Required guest command is missing: $executable" >&2; exit 1; }
done
if [[ $(systemd-detect-virt --container 2>/dev/null || true) != lxc ]]; then
  echo 'This sandbox check must run inside an LXC guest, not on the Proxmox host.' >&2
  exit 1
fi
if ! timeout 10s systemctl --system show --property=Version --value >/dev/null 2>&1; then
  echo 'The guest systemd service manager is unavailable. Start the LXC normally and retry.' >&2
  exit 1
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
unit_file="$script_dir/proxmox-cloudscape.service"
[[ -r "$unit_file" ]] || { echo "Service definition is missing: $unit_file" >&2; exit 1; }

# Reuse the service's actual hardening values instead of a weaker LXC override.
# The real cache path is not installed yet, so use one temporary writable path.
sandbox_properties=()
while IFS= read -r line; do
  case "${line%%=*}" in
    NoNewPrivileges|PrivateTmp|ProtectSystem|ProtectHome|ProtectKernelTunables|ProtectKernelModules|ProtectControlGroups|RestrictSUIDSGID|LockPersonality|CapabilityBoundingSet)
      sandbox_properties+=("--property=$line")
      ;;
  esac
done < "$unit_file"
[[ ${#sandbox_properties[@]} -ge 10 ]] || { echo 'Service hardening definition is incomplete; refusing a weaker sandbox check.' >&2; exit 1; }

probe_dir=$(mktemp -d /run/proxmox-cloudscape-sandbox.XXXXXXXX)
probe_unit=${probe_dir##*/}
cleanup() {
  timeout 10s systemctl stop "$probe_unit.service" >/dev/null 2>&1 || true
  rm -rf -- "$probe_dir"
}
trap cleanup EXIT
chown 65534:65534 "$probe_dir"
chmod 0700 "$probe_dir"

# Expand the probe's positional parameter only inside the transient service.
# shellcheck disable=SC2016
if ! output=$(timeout 30s systemd-run --unit="$probe_unit" --wait --collect --quiet \
  --property=Type=exec --property=User=65534 --property=Group=65534 \
  --property=RuntimeMaxSec=15s --property=TimeoutStartSec=15s --property=TimeoutStopSec=5s \
  --property=UMask=0077 "--property=ReadWritePaths=$probe_dir" \
  "${sandbox_properties[@]}" \
  /bin/sh -ec 'test "$(id -u)" = 65534; test ! -w /etc; : > "$1/cache-probe"' \
  sandbox-check "$probe_dir" 2>&1); then
  printf '%s\n' "$output" >&2
  cat >&2 <<'GUIDANCE'
The LXC cannot run the application's systemd security sandbox.
On this container's Proxmox Options > Features, enable Nesting while keeping
Unprivileged container enabled, then fully stop/start the CT and retry.
Nesting is required by systemd service isolation even though Docker is not used.
If it is already enabled, check the guest journal and the CT's AppArmor/mount
restrictions. Do not disable the service's ProtectSystem/PrivateTmp protections
or switch the CT to privileged mode to bypass this check.
GUIDANCE
  exit 1
fi

[[ -f "$probe_dir/cache-probe" ]] || { echo 'Sandbox probe did not confirm writable application cache.' >&2; exit 1; }
echo 'PASS: LXC supports the systemd security sandbox and non-root cache writes.'
