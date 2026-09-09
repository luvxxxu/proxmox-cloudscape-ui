#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Install inside a Debian 12/13 Proxmox LXC (root, systemd, nesting=1).
Usage: bash deploy/install-lxc.sh \
  --proxmox-host https://pve.example.internal:8006 \
  --app-origin https://proxmox-ui.example.com \
  --proxmox-ca /root/proxmox-ca.pem \
  --tls-cert /root/fullchain.pem --tls-key /root/privkey.pem

Caddy mode: --behind-proxy --proxy-bind 10.0.0.20:8080 --proxy-source 10.0.0.10
In Caddy mode omit UI certificate/key; use the public HTTPS URL for --app-origin.
--proxmox-ca is optional for a publicly trusted Proxmox HTTPS endpoint.
Direct HTTPS uses port 443 and requires an existing certificate and unencrypted key.
Downloads verified Node.js 24.20.0 and Bun 1.3.12, builds as an unprivileged
user, installs systemd/Nginx, preserves the session secret, and checks health.
Run again with the same settings to update. No Proxmox host changes are made.
USAGE
}
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
proxmox_host='' app_origin='' ca_input='' cert_input='' key_input=''
behind_proxy=0 proxy_bind='' proxy_source=''
while (($#)); do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --behind-proxy) behind_proxy=1; shift ;;
    --proxmox-host|--app-origin|--proxmox-ca|--tls-cert|--tls-key|--proxy-bind|--proxy-source)
      if (($# < 2)) || [[ -z ${2:-} || $2 == --* ]]; then fail "Missing value for $1"; fi
      case "$1" in
        --proxmox-host) proxmox_host=$2 ;;
        --app-origin) app_origin=$2 ;;
        --proxmox-ca) ca_input=$2 ;;
        --tls-cert) cert_input=$2 ;;
        --tls-key) key_input=$2 ;;
        --proxy-bind) proxy_bind=$2 ;;
        --proxy-source) proxy_source=$2 ;;
      esac
      shift 2 ;;
    *) fail "Unknown argument: $1 (use --help)" ;;
  esac
done
[[ -n $proxmox_host && -n $app_origin ]] || { usage >&2; exit 1; }
[[ $(id -u) == 0 ]] || fail 'Run inside the LXC as root (pct enter CTID).'
[[ $(uname -s) == Linux ]] || fail 'This installer runs inside a Linux LXC.'
[[ ! -d /etc/pve && ! -x /usr/bin/pveversion ]] || fail 'Do not run this on the Proxmox host. Enter the application LXC first.'
[[ $(systemd-detect-virt --container 2>/dev/null || true) == lxc ]] || fail 'A systemd-based LXC guest is required.'
[[ -d /run/systemd/system ]] || fail 'systemd must be running as the guest init system.'
# /etc/os-release is provided by the guest operating system, never by the archive.
# shellcheck disable=SC1091
source /etc/os-release
[[ ${ID:-} == debian && ${VERSION_ID:-} =~ ^(12|13)$ ]] || fail 'Use a Debian 12 or Debian 13 LXC template.'
[[ $app_origin =~ ^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || fail '--app-origin must be https://DNS-NAME or https://IPv4, port 443, without a trailing slash.'
[[ $proxmox_host =~ ^https://([A-Za-z0-9][A-Za-z0-9.-]*|\[[0-9A-Fa-f:]+\])(:[0-9]{1,5})?$ ]] || fail '--proxmox-host must be an HTTPS origin without a trailing slash, credentials, path, or query.'
ui_host=${app_origin#https://}
if ((behind_proxy)); then
  [[ -n $proxy_bind && -n $proxy_source ]] || fail 'Behind-proxy mode requires --proxy-bind PRIVATE_IPV4:PORT and --proxy-source CADDY_IPV4.'
  [[ -z $cert_input && -z $key_input ]] || fail 'Caddy handles TLS; omit --tls-cert and --tls-key in behind-proxy mode.'
else
  [[ -z $proxy_bind && -z $proxy_source ]] || fail 'Proxy settings require --behind-proxy.'
  for input in "$cert_input" "$key_input"; do
    [[ -f $input && -s $input ]] || fail "Missing certificate/key file: $input"
  done
fi
if [[ -n $ca_input ]]; then
  [[ -f $ca_input && -s $ca_input ]] || fail "Missing CA file: $ca_input"
fi
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
[[ $source_dir != / && $source_dir != /tmp ]] || fail 'Place the source in its own project directory.'
# Sources must be independent of directories that this installer creates,
# replaces, or removes. In particular, never copy a staging root into itself.
for managed in /opt/proxmox-cloudscape /opt/proxmox-cloudscape-tools /var/lib/proxmox-ui-build /var/lib/proxmox-cloudscape-builds /run/proxmox-cloudscape-install; do
  case "$source_dir/" in "$managed/"*) fail "Source directory is inside an installer-managed path: $managed" ;; esac
  case "$managed/" in "$source_dir/"*) fail "Source directory contains an installer-managed path: $managed" ;; esac
done
case "$source_dir/" in /tmp/proxmox-lxc-install.*) fail 'Source directory must not be inside a temporary installer workspace.' ;; esac
for input in package.json bun.lock deploy/nginx.conf deploy/check-lxc-sandbox.sh deploy/install-systemd.sh server/security.js; do
  [[ -f "$source_dir/$input" ]] || fail "Incomplete source archive: $input"
done
bash "$source_dir/deploy/check-lxc-sandbox.sh"
command -v flock >/dev/null || fail 'The Debian util-linux package is required.'
# A predictable lock in a shared writable directory could be replaced by a
# symlink before root opens it. Keep this lock in its own root-only directory.
[[ ! -L /run/proxmox-cloudscape-install ]] || fail 'The installer lock directory must not be a symlink.'
install -d -m 0700 -o root -g root /run/proxmox-cloudscape-install
exec 9>/run/proxmox-cloudscape-install/install.lock
flock -n 9 || fail 'Another Cloudscape installation is running.'

work_dir=$(mktemp -d /tmp/proxmox-lxc-install.XXXXXX)
build_dir='' committed=0 switching=0 prior_release='' app_was_active=0 nginx_was_active=0
declare -a destinations=()
cleanup() {
  local status=$? index target
  trap - EXIT
  if ((switching && !committed)); then
    printf 'Installation failed; restoring the previous application and configuration.\n' >&2
    for index in "${!destinations[@]}"; do
      target=${destinations[$index]}
      rm -f -- "$target"
      if [[ -e "$work_dir/backup-$index" || -L "$work_dir/backup-$index" ]]; then
        cp -a -- "$work_dir/backup-$index" "$target"
      fi
    done
    if [[ -n $prior_release ]]; then
      ln -sfn -- "$prior_release" /opt/proxmox-cloudscape/current
    else
      rm -f /opt/proxmox-cloudscape/current
    fi
    systemctl daemon-reload || true
    if ((app_was_active)); then systemctl restart proxmox-cloudscape || true; else systemctl stop proxmox-cloudscape || true; fi
    if ((nginx_was_active)); then
      if nginx -t; then systemctl reload nginx || true; fi
    else
      systemctl stop nginx || true
    fi
  fi
  [[ -z $build_dir ]] || rm -rf -- "$build_dir"
  rm -rf -- "$work_dir"
  exit "$status"
}
trap cleanup EXIT
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git unzip xz-utils rsync nginx openssl python3
if ((behind_proxy)); then
  python3 "$source_dir/deploy/configure-proxy.py" render "$app_origin" "$proxy_bind" "$proxy_source" "$source_dir/deploy/nginx.conf" "$work_dir/nginx.conf" "$work_dir/Caddyfile"
fi
install -m 0644 "${ca_input:-/etc/ssl/certs/ca-certificates.crt}" "$work_dir/proxmox-ca.pem"
if ((!behind_proxy)); then
install -m 0644 "$cert_input" "$work_dir/fullchain.pem"
install -m 0600 "$key_input" "$work_dir/privkey.pem"
openssl x509 -in "$work_dir/fullchain.pem" -noout -checkend 86400 >/dev/null || fail 'UI certificate is invalid or expires in less than one day.'
if [[ $ui_host =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  openssl x509 -in "$work_dir/fullchain.pem" -noout -checkip "$ui_host" >/dev/null || fail 'UI certificate does not cover APP_ORIGIN IP.'
else
  openssl x509 -in "$work_dir/fullchain.pem" -noout -checkhost "$ui_host" >/dev/null || fail 'UI certificate does not cover APP_ORIGIN hostname.'
fi
openssl x509 -in "$work_dir/fullchain.pem" -pubkey -noout > "$work_dir/cert-public.pem"
openssl pkey -in "$work_dir/privkey.pem" -passin pass: -pubout > "$work_dir/key-public.pem" 2>/dev/null || fail 'UI key must be a valid, unencrypted private key.'
cmp -s "$work_dir/cert-public.pem" "$work_dir/key-public.pem" || fail 'UI certificate and private key do not match.'
fi
# /version requires a ticket. /access/domains is explicitly public in PVE's
# HTTP authentication handler, so installation never needs account credentials.
curl --fail --silent --show-error --noproxy '*' --proto '=https' --connect-timeout 10 --max-time 30 \
  --cacert "$work_dir/proxmox-ca.pem" "$proxmox_host/api2/json/access/domains" > "$work_dir/domains.json" \
  || fail 'Proxmox TLS/API check failed. Check the CA chain, certificate SAN, DNS and TCP 8006.'

# Digests from Node's official SHASUMS256.txt and Bun's 1.3.12 GitHub release.
case $(uname -m) in
  x86_64)
    node_arch=x64 node_sha=2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2
    bun_asset=bun-linux-x64-baseline bun_sha=f8bb377a9ae93d44697ff91a2611164d2aedc9263415d623b0c3af24a6f55dab ;;
  aarch64)
    node_arch=arm64 node_sha=5f4ddab610c1ab2016b3c227cebdbf6d9495161487e4739c7b90090595f465f7
    bun_asset=bun-linux-aarch64 bun_sha=c40bc0ebca11bde7d75af497a654a874d0c7fd8d6a8d6031c173c10c9064297b ;;
  *) fail 'Supported guest architectures: x86_64 and aarch64.' ;;
esac
download() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 3 --connect-timeout 15 --max-time 300 "$1" -o "$2"; }
verify_file() { printf '%s  %s\n' "$1" "$2" | sha256sum --check --status || fail "Download checksum mismatch: $(basename "$2")"; }
if [[ -e /usr/local/bin/node ]]; then
  [[ $(/usr/local/bin/node -p 'process.versions.node.split(".")[0]') == 24 ]] || fail 'A different Node major version exists at /usr/local/bin/node; use a dedicated LXC with Node 24.'
else
  node_archive="node-v24.20.0-linux-$node_arch.tar.xz"
  download "https://nodejs.org/dist/v24.20.0/$node_archive" "$work_dir/$node_archive"
  verify_file "$node_sha" "$work_dir/$node_archive"
  tar -xJf "$work_dir/$node_archive" -C /opt --no-same-owner
  ln -s "/opt/node-v24.20.0-linux-$node_arch/bin/node" /usr/local/bin/node
fi
tool_dir=/opt/proxmox-cloudscape-tools
install -d -m 0755 -o root -g root "$tool_dir/bin"
if [[ ! -x "$tool_dir/bin/bun" ]] || [[ $("$tool_dir/bin/bun" --version) != 1.3.12 ]]; then
  download "https://github.com/oven-sh/bun/releases/download/bun-v1.3.12/$bun_asset.zip" "$work_dir/bun.zip"
  verify_file "$bun_sha" "$work_dir/bun.zip"
  unzip -q "$work_dir/bun.zip" -d "$work_dir/bun"
  install -m 0755 -o root -g root "$work_dir/bun/$bun_asset/bun" "$tool_dir/bin/bun"
fi
[[ $("$tool_dir/bin/bun" --version) == 1.3.12 ]] || fail 'Bun version validation failed.'
env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node --input-type=module - "$proxmox_host" "$app_origin" "$source_dir/server/security.js" "$work_dir" <<'VALIDATE'
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
const [host, origin, security, directory] = process.argv.slice(2);
process.env.NODE_ENV = 'production';
if (existsSync('/etc/proxmox-cloudscape/environment')) {
  const contents = readFileSync('/etc/proxmox-cloudscape/environment', 'utf8');
  const configured = parseEnv(contents);
  // EnvironmentFile overrides the service's Environment entries. Check the
  // actual effective values instead of accidentally validating a safer process.
  for (const [key, expected] of Object.entries({ NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3000', NODE_EXTRA_CA_CERTS: '/etc/proxmox-cloudscape/proxmox-ca.pem' })) {
    if (configured[key] !== undefined && configured[key] !== expected) throw new Error(`Existing ${key} must be ${expected} for this installer.`);
  }
  Object.assign(process.env, configured);
  if (process.env.PROXMOX_HOST !== host || process.env.APP_ORIGIN !== origin) {
    throw new Error('Existing configuration differs. Review /etc/proxmox-cloudscape/environment before changing the host or origin.');
  }
  writeFileSync(`${directory}/environment`, contents, { mode: 0o600 });
} else {
  Object.assign(process.env, { PROXMOX_HOST: host, APP_ORIGIN: origin, SESSION_SECRET: randomBytes(32).toString('hex') });
  writeFileSync(`${directory}/environment`, `PROXMOX_HOST=${host}\nAPP_ORIGIN=${origin}\nSESSION_SECRET=${process.env.SESSION_SECRET}\nPROXMOX_REQUEST_TIMEOUT_MS=60000\nPROXMOX_UPLOAD_TIMEOUT_MS=7200000\n`, { mode: 0o600 });
}
createRequire(import.meta.url)(security).validateConfiguration();
const domains = JSON.parse(readFileSync(`${directory}/domains.json`, 'utf8'));
if (!Array.isArray(domains?.data) || domains.data.length === 0 || !domains.data.every(domain =>
  domain && typeof domain.realm === 'string' && domain.realm.length > 0 && typeof domain.type === 'string' && domain.type.length > 0)) {
  throw new Error('The HTTPS target did not return valid Proxmox authentication realms.');
}
VALIDATE

getent passwd proxmox-ui-build >/dev/null || useradd --system --create-home --home-dir /var/lib/proxmox-ui-build --shell /usr/sbin/nologin proxmox-ui-build
[[ $(id -u proxmox-ui-build) != 0 && $(id -g proxmox-ui-build) != 0 ]] || fail 'The build user and its primary group must not be root.'
[[ ! -L /var/lib/proxmox-ui-build ]] || fail 'The build home must not be a symlink.'
install -d -m 0700 -o proxmox-ui-build -g proxmox-ui-build /var/lib/proxmox-ui-build
# The build account owns its HOME and each stage, but must never be able to
# rename a stage while the privileged installer copies or cleans that path.
build_root=/var/lib/proxmox-cloudscape-builds
[[ ! -L $build_root ]] || fail 'The build staging root must not be a symlink.'
install -d -m 0711 -o root -g root "$build_root"
build_dir=$(mktemp -d "$build_root/build.XXXXXX")
# Match the source packager's credential exclusions for direct checkout installs
# too, including uppercase extensions and credentials in nested directories.
rsync_excludes=()
for pattern in .git node_modules .next build out coverage test-results playwright-report data .ssh .aws .vercel .idea \
  '.env*' '*.pem' '*.key' '*.crt' '*.cer' '*.der' '*.p12' '*.pfx' '*.p7b' '*.p7c' '*.csr' '*.jks' '*.keystore' \
  .netrc .npmrc .yarnrc .ds_store '*.tsbuildinfo' deploy/certs deploy/data \
  id_rsa 'id_rsa.*' id_dsa 'id_dsa.*' id_ecdsa 'id_ecdsa.*' id_ed25519 'id_ed25519.*' \
  privkey 'privkey.*' privatekey 'privatekey.*' private-key 'private-key.*'; do
  expanded=''
  for ((index=0; index<${#pattern}; index++)); do
    character=${pattern:index:1}
    if [[ $character =~ [a-zA-Z] ]]; then expanded+="[${character,,}${character^^}]"; else expanded+=$character; fi
  done
  rsync_excludes+=("--exclude=$expanded")
done
rsync -a --safe-links "${rsync_excludes[@]}" "$source_dir/" "$build_dir/"
install -m 0644 "$source_dir/.env.local.example" "$build_dir/.env.local.example"
chown -R -h proxmox-ui-build:proxmox-ui-build "$build_dir"
printf 'Installing dependencies and checking/building the application as proxmox-ui-build.\n'
# The positional parameter is expanded by the build user's shell, not by root.
# shellcheck disable=SC2016
runuser -u proxmox-ui-build -- env -i HOME=/var/lib/proxmox-ui-build PATH="$tool_dir/bin:/usr/local/bin:/usr/bin:/bin" \
  CI=1 NEXT_TELEMETRY_DISABLED=1 bash -c 'set -euo pipefail; cd "$1"; bun install --frozen-lockfile; bun run check; bun audit; bun run build' bash "$build_dir"

if ((!behind_proxy)); then
sed "s/proxmox-ui.example.com/$ui_host/g" "$source_dir/deploy/nginx.conf" > "$work_dir/nginx.conf"
nginx_version=$(nginx -v 2>&1); nginx_version=${nginx_version##*/}
if dpkg --compare-versions "$nginx_version" lt 1.25.1; then
  sed -i -e 's/listen 443 ssl;/listen 443 ssl http2;/' -e '/^[[:space:]]*http2 on;/d' "$work_dir/nginx.conf"
fi
fi
install -d -m 0755 /etc/proxmox-cloudscape /etc/nginx/sites-available /etc/nginx/sites-enabled
install -d -m 0750 /etc/ssl/proxmox-cloudscape
[[ ! -e /opt/proxmox-cloudscape/current || -L /opt/proxmox-cloudscape/current ]] || fail 'Current release must be a symlink.'
prior_release=$(readlink /opt/proxmox-cloudscape/current || true)
systemctl is-active --quiet proxmox-cloudscape && app_was_active=1
systemctl is-active --quiet nginx && nginx_was_active=1
destinations=(/etc/proxmox-cloudscape/environment /etc/proxmox-cloudscape/proxmox-ca.pem \
  /etc/nginx/sites-available/proxmox-cloudscape /etc/nginx/sites-enabled/proxmox-cloudscape \
  /etc/systemd/system/proxmox-cloudscape.service /opt/proxmox-cloudscape/previous)
if ((!behind_proxy)); then
  destinations+=(/etc/ssl/proxmox-cloudscape/fullchain.pem /etc/ssl/proxmox-cloudscape/privkey.pem)
fi
for index in "${!destinations[@]}"; do
  target=${destinations[$index]}
  [[ ! -d $target || -L $target ]] || fail "Refusing to replace a directory: $target"
  if [[ -e $target || -L $target ]]; then cp -a -- "$target" "$work_dir/backup-$index"; fi
done
switching=1
# Backups above preserve symlinks. Unlink them before installing regular files
# so a previous managed path cannot redirect a privileged write elsewhere.
for target in "${destinations[@]}"; do rm -f -- "$target"; done
install -m 0600 "$work_dir/environment" /etc/proxmox-cloudscape/environment
install -m 0644 "$work_dir/proxmox-ca.pem" /etc/proxmox-cloudscape/proxmox-ca.pem
if ((!behind_proxy)); then
install -m 0644 "$work_dir/fullchain.pem" /etc/ssl/proxmox-cloudscape/fullchain.pem
install -m 0600 "$work_dir/privkey.pem" /etc/ssl/proxmox-cloudscape/privkey.pem
fi
install -m 0644 "$work_dir/nginx.conf" /etc/nginx/sites-available/proxmox-cloudscape
ln -sfn /etc/nginx/sites-available/proxmox-cloudscape /etc/nginx/sites-enabled/proxmox-cloudscape
nginx -t
bash "$source_dir/deploy/install-systemd.sh" --source-dir "$build_dir"
systemctl restart proxmox-cloudscape
curl --fail --silent --show-error --noproxy '*' --retry 20 --retry-connrefused --retry-delay 2 --max-time 5 \
  http://127.0.0.1:3000/api/health > "$work_dir/health.json"
systemctl enable nginx
if ((nginx_was_active)); then systemctl reload nginx; else systemctl start nginx; fi
if ((behind_proxy)); then
  curl --fail --silent --show-error --noproxy '*' --retry 20 --retry-all-errors --retry-delay 1 \
    --retry-max-time 30 --connect-timeout 5 --max-time 5 -H "Host: $ui_host" \
    "http://127.0.0.1:${proxy_bind##*:}/api/health" > "$work_dir/https-health.json"
else
# Nginx reload acknowledges the signal before new listeners/certificates are
# ready. Retry with full TLS verification while old workers are replaced.
curl --fail --silent --show-error --noproxy '*' --retry 20 --retry-all-errors --retry-delay 1 \
  --retry-max-time 30 --connect-timeout 5 --max-time 5 --cacert "$work_dir/fullchain.pem" \
  --resolve "$ui_host:443:127.0.0.1" "$app_origin/api/health" > "$work_dir/https-health.json"
fi
env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node --input-type=module - "$work_dir" <<'HEALTH'
import { readFileSync } from 'node:fs';
for (const filename of ['health.json', 'https-health.json']) {
  if (JSON.parse(readFileSync(`${process.argv[2]}/${filename}`, 'utf8')).status !== 'ok') throw new Error(`Unexpected application health response: ${filename}`);
}
HEALTH
committed=1
printf '\nInstalled successfully: %s\nApp: systemctl status proxmox-cloudscape\nLogs: journalctl -u proxmox-cloudscape -n 100 --no-pager\n' "$app_origin"
if ((behind_proxy)); then
  install -m 0644 "$work_dir/Caddyfile" /etc/proxmox-cloudscape/Caddyfile.example
  printf 'Internal installation verified. Add this site to your existing Caddy configuration:\n'
  cat /etc/proxmox-cloudscape/Caddyfile.example
  printf 'External HTTPS is not verified yet. Configure Caddy/DNS, then check login and consoles.\n'
else
  printf 'Configure certificate renewal separately. Validate login and a disposable resource before production use.\n'
fi
