#!/usr/bin/env bash
set -euo pipefail
# Command-level regression tests inside the disposable Debian validation image.
# The systemd-run stub checks orchestration, not actual LXC mount namespaces.
sandbox_script=/source/deploy/check-lxc-sandbox.sh
fixture_dir=$(mktemp -d /tmp/proxmox-sandbox-tests.XXXXXXXX)
trap 'rm -rf -- "$fixture_dir"' EXIT
mkdir "$fixture_dir/bin"
export PROBE_CAPTURE="$fixture_dir/captured-arguments"
export PROBE_STOPS="$fixture_dir/stopped-units"
cat > "$fixture_dir/bin/systemd-detect-virt" <<'MOCK_VIRT'
#!/bin/sh
printf '%s\n' "${PROBE_VIRT:-lxc}"
MOCK_VIRT
cat > "$fixture_dir/bin/systemctl" <<'MOCK_SYSTEMCTL'
#!/bin/sh
if [ "$1" = stop ]; then printf '%s\n' "$2" >> "$PROBE_STOPS"; fi
exit 0
MOCK_SYSTEMCTL
cat > "$fixture_dir/bin/systemd-run" <<'MOCK_RUN'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$@" > "$PROBE_CAPTURE"
if [[ ${PROBE_FAIL:-0} == 1 ]]; then
  echo 'Failed at step NAMESPACE: Permission denied' >&2
  exit 226
fi
while (( $# )) && [[ $1 != /bin/sh ]]; do shift; done
runuser -u nobody -- "$@"
MOCK_RUN
chmod 0755 "$fixture_dir/bin/"*
export PATH="$fixture_dir/bin:$PATH"

if PROBE_VIRT=docker bash "$sandbox_script" > "$fixture_dir/wrong-guest" 2>&1; then
  echo 'FAIL: the LXC checker accepted another container runtime.' >&2
  exit 1
fi
grep -q 'must run inside an LXC guest' "$fixture_dir/wrong-guest"
test ! -e "$PROBE_CAPTURE"

bash "$sandbox_script" > "$fixture_dir/success"
grep -q 'PASS:' "$fixture_dir/success"
while IFS= read -r line; do
  case "${line%%=*}" in
    NoNewPrivileges|PrivateTmp|ProtectSystem|ProtectHome|ProtectKernelTunables|ProtectKernelModules|ProtectControlGroups|RestrictSUIDSGID|LockPersonality|CapabilityBoundingSet)
      grep -Fxq -- "--property=$line" "$PROBE_CAPTURE"
      ;;
  esac
done < /source/deploy/proxmox-cloudscape.service
grep -Fxq -- '--property=User=65534' "$PROBE_CAPTURE"
grep -Fxq -- '--property=RuntimeMaxSec=15s' "$PROBE_CAPTURE"
probe_dir=$(tail -n 1 "$PROBE_CAPTURE")
test ! -e "$probe_dir"
grep -Fxq "${probe_dir##*/}.service" "$PROBE_STOPS"

if PROBE_FAIL=1 bash "$sandbox_script" > "$fixture_dir/no-namespace" 2>&1; then
  echo 'FAIL: the LXC checker accepted a failed namespace setup.' >&2
  exit 1
fi
grep -q 'enable Nesting' "$fixture_dir/no-namespace"
grep -q 'Permission denied' "$fixture_dir/no-namespace"
probe_dir=$(tail -n 1 "$PROBE_CAPTURE")
test ! -e "$probe_dir"
grep -Fxq "${probe_dir##*/}.service" "$PROBE_STOPS"
echo 'PASS: sandbox preflight refuses wrong guests, preserves unit hardening, reports isolation failures, and cleans temporary resources.'
