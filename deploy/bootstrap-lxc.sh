#!/usr/bin/env bash
# Supports curl | bash: all interactive input comes from the controlling terminal.
set -Eeuo pipefail
main() {
  fail() { printf '\n설치 중단: %s\n' "$*" >&2; exit 1; }
  [[ $(id -u) == 0 ]] || fail '컨테이너의 root 콘솔에서 실행하세요.'
  [[ ! -d /etc/pve && ! -x /usr/bin/pveversion ]] || fail '현재 Proxmox 호스트입니다. 새 LXC의 Console에서 실행하세요.'
  [[ $(uname -m) == x86_64 ]] || fail 'Debian amd64 템플릿을 사용하세요. ARM 템플릿은 이 자동 배포 구성을 지원하지 않습니다.'
  [[ $(systemd-detect-virt --container 2>/dev/null || true) == lxc && -d /run/systemd/system ]] || fail '실행 중인 Debian LXC 안에서 실행하세요.'
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ ${ID:-} == debian && ${VERSION_ID:-} =~ ^(12|13)$ ]] || fail 'Debian 12 또는 13 컨테이너가 필요합니다.'
  exec 3<>/dev/tty || fail 'Proxmox의 컨테이너 Console에서 직접 실행하세요.'
  ask() { printf '\n%s' "$1" >&3; IFS= read -r -u 3 answer || fail '입력이 종료되었습니다. 같은 설치 명령으로 재시도하세요.'; }
  [[ ! -L /run/proxmox-cloudscape-bootstrap ]] || fail '잘못된 설치 잠금 경로입니다.'
  install -d -m 0700 /run/proxmox-cloudscape-bootstrap
  exec 8>/run/proxmox-cloudscape-bootstrap/lock
  flock -n 8 || fail '다른 자동 설치가 진행 중입니다.'
  stage=$(mktemp -d /root/cloudscape-setup.XXXXXXXX)
  trap 'rm -rf -- "$stage"' EXIT
  printf '\nCloudscape UI 자동 설치 — 기존 Caddy에서 HTTPS 처리\n'
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl python3 iproute2
  printf '\n공개 안정 릴리스를 내려받고 무결성을 확인합니다. GitHub 계정은 필요 없습니다.\n'
  python3 - "$stage" <<'FETCH_RELEASE'
import hashlib, json, pathlib, re, shutil, sys, tarfile, time, urllib.error, urllib.request
root = pathlib.Path(sys.argv[1])
repository = 'luvxxxu/proxmox-cloudscape-ui'
class HTTPS(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, url):
        if not url.startswith('https://'): raise ValueError('HTTPS redirect required')
        return super().redirect_request(req, fp, code, msg, headers, url)
def fetch(url, path, limit):
    for attempt in range(3):
        try:
            with urllib.request.build_opener(HTTPS()).open(url, timeout=60) as response, path.open('wb') as output:
                size = 0
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > limit: raise ValueError('Download too large')
                    output.write(chunk)
            return
        except urllib.error.HTTPError as error:
            if error.code == 404: sys.exit('공개 안정 릴리스가 아직 없습니다. 설치를 중단합니다. PAT는 필요 없습니다.')
            if error.code not in (429, 500, 502, 503, 504): raise
        except (urllib.error.URLError, TimeoutError, ConnectionError): pass
        if attempt < 2: time.sleep(2 ** attempt)
    sys.exit('릴리스 서버 연결에 실패했습니다. 네트워크를 확인한 뒤 같은 명령으로 재시도하세요.')
fetch(f'https://github.com/{repository}/releases/latest/download/release.json', root / 'manifest.json', 65536)
manifest = json.loads((root / 'manifest.json').read_text())
if (manifest.get('repository') != repository or manifest.get('schema') != 1
        or not re.fullmatch(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', manifest.get('version', ''))):
    sys.exit('Invalid release manifest')
source = manifest.get('source', {})
if (source.get('name') != 'source.tar.gz' or type(source.get('size')) is not int
        or not 0 < source['size'] <= 64 * 1024 * 1024
        or not re.fullmatch(r'[a-f0-9]{64}', source.get('sha256', ''))): sys.exit('Invalid source metadata')
archive = root / 'source.tar.gz'
fetch(f'https://github.com/{repository}/releases/download/{manifest["version"]}/source.tar.gz', archive, source['size'])
if archive.stat().st_size != source['size'] or hashlib.sha256(archive.read_bytes()).hexdigest() != source['sha256']:
    sys.exit('Source checksum mismatch')
destination = root / 'source'; destination.mkdir(mode=0o700)
seen = set(); total = 0
with tarfile.open(archive, 'r:gz') as bundle:
    for item in bundle:
        name = pathlib.PurePosixPath(item.name)
        if not name.parts and item.isdir(): continue
        if (not name.parts or name.is_absolute() or '..' in name.parts or name.as_posix() in seen
                or not (item.isfile() or item.isdir())): sys.exit('Unsafe source archive')
        seen.add(name.as_posix()); total += item.size
        if len(seen) > 10000 or total > 256 * 1024 * 1024: sys.exit('Source archive too large')
        target = destination / name; target.parent.mkdir(parents=True, exist_ok=True)
        if item.isdir(): target.mkdir(exist_ok=True)
        else:
            with bundle.extractfile(item) as incoming, target.open('xb') as output: shutil.copyfileobj(incoming, output)
sys.path.insert(0, str(destination / 'deploy'))
import public_release
public_release.validate(manifest)
public_release.runtime(manifest, root)
print('다운로드 완료:', manifest['version'])
FETCH_RELEASE
  helper="$stage/source/deploy/configure-proxy.py"
  bash "$stage/source/deploy/check-lxc-sandbox.sh"
  while true; do
    ask '기존 Proxmox 접속 주소 (예: https://pve.example.com 또는 192.168.1.10:8006): '
    if pve_origin=$(python3 "$helper" origin proxmox "$answer"); then break; fi
  done
  printf 'Proxmox 연결 주소: %s\n' "$pve_origin"
  ca=/etc/ssl/certs/ca-certificates.crt
  probe() {
    curl --fail --silent --show-error --noproxy '*' --proto '=https' --connect-timeout 10 --max-time 30 \
      --cacert "$ca" "$pve_origin/api2/json/access/domains" -o "$stage/domains.json" &&
      python3 -c 'import json,sys; d=json.load(open(sys.argv[1])).get("data"); sys.exit(0 if isinstance(d,list) and d and all(isinstance(x,dict) and x.get("realm") and x.get("type") for x in d) else "Proxmox API 응답이 아닙니다. 주소를 확인하세요.")' "$stage/domains.json"
  }
  if ! probe; then
    if [[ -s /root/proxmox-ca.pem ]]; then ca=/root/proxmox-ca.pem; fi
    while ! probe; do
      printf '\nProxmox 연결을 확인하지 못했습니다. 공인 인증서가 있는 Caddy 도메인을 사용하면 CA 복사가 필요 없습니다.\n'
      ask '주소를 다시 입력하거나, 신뢰할 Proxmox CA 파일의 절대 경로를 입력하세요 (종료: q): '
      [[ $answer != q ]] || fail '연결 확인을 취소했습니다.'
      if [[ $answer == /* ]]; then
        [[ -s $answer ]] || { printf '인증서 파일이 없습니다.\n'; continue; }
        ca=$answer
      elif pve_origin=$(python3 "$helper" origin proxmox "$answer"); then
        ca=/etc/ssl/certs/ca-certificates.crt
      else
        continue
      fi
    done
  fi
  while true; do
    ask '새 UI 외부 도메인 (예: pve.lxvu.dev): '
    if app_origin=$(python3 "$helper" origin ui "$answer"); then
      [[ $app_origin != "$pve_origin" ]] && break
      printf '새 UI와 기존 Proxmox는 서로 다른 접속 주소를 사용해야 합니다.\n'
    fi
  done
  printf '\n컨테이너에 할당된 IPv4:\n'
  ip -4 -brief address
  candidate=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="src") {print $(i+1); exit}}') || candidate=''
  if ! python3 "$helper" private-ip "$candidate" >/dev/null 2>&1; then candidate=''; fi
  while true; do
    ask "Caddy에서 연결할 이 컨테이너의 내부 IPv4 [${candidate:-직접 입력}]: "
    if bind_ip=$(python3 "$helper" private-ip "${answer:-$candidate}"); then
      if ip -j -4 address | python3 -c 'import json,sys; wanted=sys.argv[1]; sys.exit(0 if any(a.get("local")==wanted for i in json.load(sys.stdin) for a in i.get("addr_info",[])) else 1)' "$bind_ip"; then break; fi
      printf '이 컨테이너에 할당되지 않은 IP입니다. 위 목록에서 선택하세요.\n'
    fi
  done
  while true; do
    ask '별도 Caddy 컨테이너의 내부 IPv4 (공인 IP 아님): '
    if proxy_ip=$(python3 "$helper" private-ip "$answer"); then break; fi
  done
  printf '\n설치: %s → Caddy → %s:8080 → 앱\nProxmox API: %s\n' "$app_origin" "$bind_ip" "$pve_origin"
  printf '검사가 끝난 실행 파일을 설치합니다. LXC에서는 빌드나 bun audit를 실행하지 않습니다.\n'
  bash "$stage/source/deploy/install-lxc.sh" --behind-proxy \
    --proxmox-host "$pve_origin" --app-origin "$app_origin" --proxmox-ca "$ca" \
    --proxy-bind "$bind_ip:8080" --proxy-source "$proxy_ip" --release-dir "$stage/runtime"
  printf '\n앱 설치가 완료됐습니다. 위 Caddy 설정을 기존 Caddyfile에 추가해야 외부 접속이 됩니다.\n'
  printf '다시 보기: cat /etc/proxmox-cloudscape/Caddyfile.example\n'
  printf '8080은 Caddy와 컨테이너 사이의 내부 연결 전용입니다. 인터넷에 포트 전달하지 마세요.\n'
  bash "$stage/source/deploy/enable-auto-update.sh"
  printf '공개 안정 버전 자동 업데이트가 켜졌습니다. GitHub PAT는 필요 없습니다.\n'
}
main "$@"
