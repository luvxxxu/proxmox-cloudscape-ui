#!/usr/bin/env bash
set -euo pipefail
# Real Debian packages, published runtime with bundled Node, and HTTPS services.
# Only LXC detection/systemd orchestration are substituted inside disposable Docker.
# This does NOT claim to test Proxmox's LXC kernel/AppArmor/systemd isolation.
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }
[[ -f "$repo_dir/build/runtime.tar.gz" && -f "$repo_dir/build/release.json" && -f "$repo_dir/build/proxmox-cloudscape-ui-source.tar.gz" ]] || { echo 'Prepare the tested runtime, release manifest and source archive first.' >&2; exit 1; }
debian_version=${LXC_TEST_DEBIAN_VERSION:-13}
[[ $debian_version == 12 || $debian_version == 13 ]] || { echo 'LXC_TEST_DEBIAN_VERSION must be 12 or 13.' >&2; exit 1; }
# Pin this run's input even if another test/release regenerates the archive.
# Replacing a bind-mounted file can make it disappear in Docker Desktop.
snapshot_dir=$(mktemp -d "$repo_dir/build/lxc-test.XXXXXXXX")
trap 'rm -rf -- "$snapshot_dir"' EXIT
cp "$repo_dir/build/proxmox-cloudscape-ui-source.tar.gz" "$snapshot_dir/source.tar.gz"
cp "$repo_dir/build/runtime.tar.gz" "$repo_dir/build/release.json" "$snapshot_dir/"
docker run --rm -i --platform linux/amd64 \
  -v "$snapshot_dir:/input:ro" \
  "debian:$debian_version-slim" bash -s <<'CHECK_LXC'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates openssl python3 systemd shellcheck >/dev/null
mkdir -p /root/source /root/fixtures /run/systemd/system /usr/local/bin
tar -xzf /input/source.tar.gz -C /root/source
shellcheck /root/source/deploy/bootstrap-lxc.sh /root/source/deploy/install-lxc.sh /root/source/deploy/check-lxc-sandbox.sh /root/source/deploy/install-systemd.sh
bash -n /root/source/deploy/install-lxc.sh
openssl req -x509 -newkey rsa:2048 -nodes -days 3 -subj /CN=Fixture-CA \
  -keyout /root/fixtures/ca.key -out /root/fixtures/ca.pem >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -subj /CN=ui.test \
  -keyout /root/fixtures/server.key -out /root/fixtures/server.csr >/dev/null 2>&1
printf 'subjectAltName=DNS:ui.test,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > /root/fixtures/extensions
openssl x509 -req -in /root/fixtures/server.csr -CA /root/fixtures/ca.pem -CAkey /root/fixtures/ca.key \
  -CAcreateserial -days 2 -extfile /root/fixtures/extensions -out /root/fixtures/server.pem >/dev/null 2>&1
cat > /root/fixtures/api.py <<'PYTHON'
from http.server import BaseHTTPRequestHandler, HTTPServer
import ssl
class API(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/api2/json/access/domains':
            self.send_error(401, 'No ticket')
            return
        body = b'{"data":[{"realm":"pam","type":"pam"},{"realm":"pve","type":"pve"}]}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args): pass
server = HTTPServer(('127.0.0.1', 18006), API)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain('/root/fixtures/server.pem', '/root/fixtures/server.key')
server.socket = context.wrap_socket(server.socket, server_side=True)
server.serve_forever()
PYTHON
python3 /root/fixtures/api.py &

# The installer has no test bypass flag. These shims replace unavailable guest
# orchestration only in this disposable test container; app and Nginx run for real.
printf '#!/bin/sh\nprintf "lxc\\n"\n' > /usr/local/bin/systemd-detect-virt
cat > /usr/local/bin/systemd-run <<'SANDBOX'
#!/bin/bash
set -euo pipefail
while [[ $# -gt 0 && $1 != /bin/sh ]]; do shift; done
exec setpriv --reuid=65534 --regid=65534 --clear-groups "$@"
SANDBOX
cat > /usr/local/bin/systemctl <<'SYSTEMCTL'
#!/bin/bash
set -euo pipefail
if [[ $1 == --system ]]; then printf '257\n'; exit 0; fi
action=$1
shift
if [[ ${1:-} == --quiet ]]; then shift; fi
service=${1:-}
service=${service%.service}
if [[ $service == proxmox-cloudscape-sandbox* ]]; then exit 0; fi
case "$action:$service" in
  daemon-reload:*|enable:*|reset-failed:*) exit 0 ;;
  is-active:nginx) [[ -s /run/nginx.pid ]] && kill -0 "$(cat /run/nginx.pid)" 2>/dev/null ;;
  is-active:proxmox-cloudscape) [[ -s /run/fixture-app.pid ]] && kill -0 "$(cat /run/fixture-app.pid)" 2>/dev/null ;;
  restart:proxmox-cloudscape|start:proxmox-cloudscape|stop:proxmox-cloudscape)
    if [[ -s /run/fixture-app.pid ]]; then
      app_pid=$(cat /run/fixture-app.pid)
      kill "$app_pid" 2>/dev/null || true
      for _ in {1..50}; do kill -0 "$app_pid" 2>/dev/null || break; sleep .1; done
      rm -f /run/fixture-app.pid
    fi
    [[ $action != stop ]] || exit 0
    if [[ -f /run/fail-next-app-start ]]; then rm /run/fail-next-app-start; exit 1; fi
    set -a
    source /etc/proxmox-cloudscape/environment
    set +a
    export NODE_ENV=production HOSTNAME=127.0.0.1 PORT=3000 NEXT_TELEMETRY_DISABLED=1
    export NODE_EXTRA_CA_CERTS=/etc/proxmox-cloudscape/proxmox-ca.pem
    cd /opt/proxmox-cloudscape/current
    # A real systemd manager does not inherit the installer's flock descriptor.
    setpriv --reuid=proxmox-ui --regid=proxmox-ui --init-groups /opt/proxmox-cloudscape/current/node/bin/node server/custom-server.js 9>&- >> /tmp/fixture-app.log 2>&1 &
    printf '%s\n' "$!" > /run/fixture-app.pid ;;
  start:nginx) /usr/sbin/nginx 9>&- ;;
  reload:nginx) /usr/sbin/nginx -s reload ;;
  stop:nginx) /usr/sbin/nginx -s quit 2>/dev/null || true ;;
  *) printf 'Unexpected systemctl: %s %s\n' "$action" "$service" >&2; exit 1 ;;
esac
SYSTEMCTL
chmod 0755 /usr/local/bin/systemd-detect-virt /usr/local/bin/systemd-run /usr/local/bin/systemctl
cd /root/source
python3 - <<'PREBUILT'
import importlib.util, json, pathlib
spec = importlib.util.spec_from_file_location('updater', '/root/source/deploy/pull-update.py')
u = importlib.util.module_from_spec(spec); spec.loader.exec_module(u)
manifest = json.loads(pathlib.Path('/input/release.json').read_text())
stage = pathlib.Path('/root/runtime'); stage.mkdir()
u.unpack_runtime(pathlib.Path('/input/runtime.tar.gz'), stage, manifest['commit'], manifest['repository'])
(stage / 'public-release.json').write_text(json.dumps(manifest))
PREBUILT
install_args=(--release-dir /root/runtime --proxmox-host https://localhost:18006 --app-origin https://ui.test \
  --proxmox-ca /root/fixtures/ca.pem --tls-cert /root/fixtures/server.pem --tls-key /root/fixtures/server.key)
trap 'cat /tmp/fixture-app.log 2>/dev/null || true' EXIT
bash deploy/install-lxc.sh "${install_args[@]}"
first=$(readlink /opt/proxmox-cloudscape/current)
config_sha=$(sha256sum /etc/proxmox-cloudscape/environment)
[[ $(stat -c %a /etc/proxmox-cloudscape/environment) == 600 ]]
[[ $(stat -c %a /etc/ssl/proxmox-cloudscape/privkey.pem) == 600 ]]
runuser -u proxmox-ui -- test ! -w "$first/server/custom-server.js"
runuser -u proxmox-ui -- test -w "$first/.next/cache"
curl --fail --silent --cacert /root/fixtures/ca.pem --resolve ui.test:443:127.0.0.1 https://ui.test/api/health
[[ $(curl --silent --output /dev/null --write-out '%{http_code}' --cacert /root/fixtures/ca.pem --resolve ui.test:443:127.0.0.1 https://ui.test/api/proxmox/nodes) == 401 ]]
[[ ! -e /opt/proxmox-cloudscape-tools/bin/bun && ! -e /usr/local/bin/node ]]
printf '\nPASS: prebuilt Debian install without Bun/build tools, bundled Node, HTTPS, API denial, file permissions\n'

bash deploy/install-lxc.sh "${install_args[@]}"
second=$(readlink /opt/proxmox-cloudscape/current)
[[ $second != "$first" && $(readlink /opt/proxmox-cloudscape/previous) == "$first" ]]
[[ $(sha256sum /etc/proxmox-cloudscape/environment) == "$config_sha" ]]
# A third install already has previous -> directory; backup must preserve that link.
touch /run/fail-next-app-start
if bash deploy/install-lxc.sh "${install_args[@]}"; then echo 'Expected start failure.' >&2; exit 1; fi
[[ $(readlink /opt/proxmox-cloudscape/current) == "$second" ]]
[[ $(readlink /opt/proxmox-cloudscape/previous) == "$first" ]]
[[ $(sha256sum /etc/proxmox-cloudscape/environment) == "$config_sha" ]]
curl --fail --silent --retry 10 --retry-connrefused --retry-delay 1 --cacert /root/fixtures/ca.pem --resolve ui.test:443:127.0.0.1 https://ui.test/api/health
printf '\nPASS: update preserves secret, previous links survive, failed start restores application/configuration\n'
# Switch to an external TLS terminator without supplying any UI certificates.
proxy_args=(--release-dir /root/runtime --behind-proxy --proxmox-host https://localhost:18006 --app-origin https://ui.test \
  --proxmox-ca /root/fixtures/ca.pem --proxy-bind 127.0.0.1:8080 --proxy-source 127.0.0.3)
bash deploy/install-lxc.sh "${proxy_args[@]}"
proxy_release=$(readlink /opt/proxmox-cloudscape/current)
[[ $(sha256sum /etc/proxmox-cloudscape/environment) == "$config_sha" ]]
[[ $(curl --silent -H 'Host: ui.test' --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8080/api/health) == 200 ]]
[[ $(curl --silent --interface 127.0.0.3 -H 'Host: ui.test' --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8080/api/health) == 200 ]]
[[ $(curl --silent --interface 127.0.0.2 -H 'Host: ui.test' --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8080/api/health) == 403 ]]
[[ $(curl --silent -H 'Host: wrong.test' --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8080/api/health) == 421 ]]
[[ $(curl --silent -H 'Host: ui.test' --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8080/api/proxmox/nodes) == 401 ]]
nginx_sha=$(sha256sum /etc/nginx/sites-available/proxmox-cloudscape)
touch /run/fail-next-app-start
if bash deploy/install-lxc.sh "${proxy_args[@]}"; then echo 'Expected proxy-mode start failure.' >&2; exit 1; fi
[[ $(readlink /opt/proxmox-cloudscape/current) == "$proxy_release" ]]
[[ $(sha256sum /etc/nginx/sites-available/proxmox-cloudscape) == "$nginx_sha" ]]
curl --fail --silent --retry 10 --retry-connrefused -H 'Host: ui.test' http://127.0.0.1:8080/api/health
printf '\nPASS: Caddy upstream, allowed/denied peers, host validation, API denial and rollback\n'
CHECK_LXC
