#!/usr/bin/env bash
set -euo pipefail
# Validate configuration in disposable containers; never start a host service.
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }
command -v openssl >/dev/null || { echo 'OpenSSL is required.' >&2; exit 1; }
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/proxmox-deployment-check.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=proxmox-ui.example.com   -keyout "$fixture_dir/privkey.pem" -out "$fixture_dir/fullchain.pem" >/dev/null 2>&1
cp "$repo_dir/compose.yaml" "$fixture_dir/compose.yaml"
cp "$repo_dir/.env.local.example" "$fixture_dir/.env.production"
docker compose --project-directory "$fixture_dir" -f "$fixture_dir/compose.yaml" config --quiet
docker run --rm -i --network none \
  -v "$repo_dir/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$fixture_dir:/etc/ssl/proxmox-cloudscape:ro" nginx:alpine sh -s <<'CHECK_NGINX'
set -eu
nginx -t
nginx
head -c 17000 /dev/zero | tr '\000' a > /tmp/oversized.json
for endpoint in login openid; do
  status=$(wget --no-check-certificate --server-response --post-file=/tmp/oversized.json \
    -O /dev/null "https://127.0.0.1/api/auth/$endpoint" 2>&1 || true)
  printf '%s\n' "$status" | grep -q '413' || { printf '%s\n' "$status" >&2; exit 1; }
done
nginx -s quit
printf 'PASS: Nginx configuration and authentication request size limits\n'
CHECK_NGINX
docker run --rm -i \
  -v "$repo_dir/deploy/install-systemd.sh:/source/deploy/install-systemd.sh:ro" \
  -v "$repo_dir/deploy/check-lxc-sandbox.sh:/source/deploy/check-lxc-sandbox.sh:ro" \
  -v "$repo_dir/deploy/proxmox-cloudscape.service:/source/deploy/proxmox-cloudscape.service:ro" \
  -v "$repo_dir/tests/fixtures/lxc-sandbox-test.sh:/source/tests/fixtures/lxc-sandbox-test.sh:ro" \
  -v "$repo_dir/tests/fixtures/systemd-source-test.sh:/source/tests/fixtures/systemd-source-test.sh:ro" \
  -v "$repo_dir/.env.local.example:/source/.env.local.example:ro" \
  node:24-bookworm-slim bash -s <<'CHECK_SYSTEMD'
set -euo pipefail
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends systemd rsync shellcheck >/dev/null
shellcheck /source/deploy/install-systemd.sh /source/deploy/check-lxc-sandbox.sh /source/tests/fixtures/lxc-sandbox-test.sh /source/tests/fixtures/systemd-source-test.sh
bash -n /source/deploy/install-systemd.sh
bash -n /source/deploy/check-lxc-sandbox.sh
bash /source/tests/fixtures/lxc-sandbox-test.sh
mkdir -p /tmp/fixture/{deploy,node_modules,public,server,.next}
cp /source/deploy/install-systemd.sh /source/deploy/proxmox-cloudscape.service /tmp/fixture/deploy/
cp /source/.env.local.example /tmp/fixture/
printf 'fixture-build\n' > /tmp/fixture/.next/BUILD_ID
printf 'console.log("fixture");\n' > /tmp/fixture/server/runtime.js
chmod 0777 /tmp/fixture/server/runtime.js
printf '{}\n' > /tmp/fixture/package.json
printf 'export default {};\n' > /tmp/fixture/next.config.mjs
printf '#!/bin/sh\nexit 0\n' > /usr/local/bin/systemctl
chmod 0755 /usr/local/bin/systemctl
bash /tmp/fixture/deploy/install-systemd.sh
first=$(readlink /opt/proxmox-cloudscape/current)
test "$(stat -c %U "$first/server/runtime.js")" = root
runuser -u proxmox-ui -- test ! -w "$first/server/runtime.js"
runuser -u proxmox-ui -- test -r "$first/server/runtime.js"
runuser -u proxmox-ui -- test -w "$first/.next/cache"
test "$(stat -c %a /etc/proxmox-cloudscape/environment)" = 600
grep -q '^SESSION_SECRET=$' /etc/proxmox-cloudscape/environment
bash /tmp/fixture/deploy/install-systemd.sh
test "$(readlink /opt/proxmox-cloudscape/previous)" = "$first"
test "$(readlink /opt/proxmox-cloudscape/current)" != "$first"
systemd-analyze verify /etc/systemd/system/proxmox-cloudscape.service
bash /source/tests/fixtures/systemd-source-test.sh
printf 'PASS: shellcheck, bash syntax, installer ownership/cache/config permissions, repeat-install rollback links, Debian systemd unit validation\n'
CHECK_SYSTEMD
