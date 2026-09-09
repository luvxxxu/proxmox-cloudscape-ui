# Proxmox에 설치하고 운영하기

**처음 설치한다면 [LXC 전용 설치 안내](installation-lxc.ko.md)를 따르세요.** 비특권 Debian LXC 생성부터 현재 소스 전달, 인증서, 자동 설치, 업데이트와 복구까지 순서대로 설명합니다. 이 문서는 VM의 Docker Compose 설치와 수동 systemd 설치, 공통 운영 설정을 다룹니다.

## 1. 설치 구조

기본 설치 경로는 Proxmox 안의 **Debian 13 비특권 LXC**에서 Node.js와 systemd로 실행하는 방식입니다. LXC 설치 스크립트는 Debian 12도 지원합니다. VM에서 운영하려면 Debian 13 VM과 Docker Compose 또는 수동 systemd 구성을 사용할 수 있습니다. 기존 Proxmox의 8006 포트와 기본 웹 UI는 계속 유지됩니다.

```text
브라우저 ── HTTPS 443 ── Nginx ── 127.0.0.1:3000 ── Cloudscape UI
                                                    │
                                              HTTPS/WSS 8006
                                                    │
                                              Proxmox VE 노드
```

화면은 Proxmox 자체에 저장된 사용자·역할·리소스를 조작합니다. 별도 사용자 데이터베이스는 없습니다. 권한은 로그인한 Proxmox 사용자의 권한으로 검사됩니다. `root@pam`을 공용으로 사용하지 말고, 운영자별 사용자와 필요한 역할을 부여하세요.

시작 사양은 2 vCPU, RAM 4 GiB, 디스크 20 GiB를 권장합니다. 이는 용량 보장 수치가 아니라 빌드와 소규모 운영을 위한 출발점입니다. 관리 VM/LXC에서 Proxmox 노드의 TCP 8006에 연결할 수 있어야 합니다. 브라우저는 UI의 443에만 접근하면 됩니다.

Proxmox 웹 UI의 **Create CT**로 Debian 13 비특권 컨테이너를 만들고 **Options → Features → Nesting**을 켜세요. 이 설정은 systemd의 서비스 격리에 필요하며 `keyctl`은 필요하지 않습니다. [Proxmox 공식 기능 설명](https://github.com/proxmox/pve-docs/blob/master/generated/pct.conf.5-opts.adoc)에 따르면 Nesting은 호스트 procfs·sysfs의 일부 정보도 게스트에 노출합니다. VM을 선택했다면 **Create VM**으로 Debian 13을 설치하세요. 고정 IP 또는 DHCP 예약을 지정하고 DNS·시간 동기화를 확인하세요.

## 2. 변경된 소스 준비

이 안내는 이번 변경사항이 포함된 소스 기준입니다. 로컬 변경은 GitHub에 자동으로 게시되지 않습니다. 현재 작업물을 먼저 대상 게스트로 전송하거나, 변경사항을 포함한 커밋을 배포 저장소에서 가져와야 합니다.

현재 개발 Mac에서 실행하는 예시입니다. `deploy@UI_GUEST_IP`는 실제 게스트 계정과 주소로 바꾸세요.

```bash
rsync -az --exclude=.git --exclude=node_modules --exclude=.next \
  --exclude='.env*' --exclude=deploy/certs --exclude=test-results \
  /Users/lxvu/proxmox-cloudscape-ui/ deploy@UI_GUEST_IP:~/proxmox-cloudscape-ui/
# 설정 예제는 실제 비밀이 없는 파일이므로 별도로 복사합니다.
scp /Users/lxvu/proxmox-cloudscape-ui/.env.local.example \
  deploy@UI_GUEST_IP:~/proxmox-cloudscape-ui/.env.local.example
```

변경사항이 원격 저장소에 반영돼 있다면 게스트에서 다음처럼 가져올 수도 있습니다.

```bash
git clone https://github.com/luvxxxu/proxmox-cloudscape-ui.git
cd proxmox-cloudscape-ui
# 검토한 릴리스 커밋으로 체크아웃하세요.
```

이후 명령은 달리 표시하지 않는 한 **UI 게스트 안의 프로젝트 디렉터리**에서 실행합니다.

## 3. Proxmox CA와 주소 확인

Proxmox 기본 인증서는 사설 CA로 서명됩니다. 신뢰할 수 있는 SSH 연결로 **공개 CA 인증서만** 가져옵니다. PVE 루트 CA의 개인 키나 노드 개인 키는 복사하지 않습니다.

```bash
mkdir -p deploy/certs
scp root@PVE_HOST:/etc/pve/pve-root-ca.pem deploy/certs/proxmox-ca.pem
chmod 644 deploy/certs/proxmox-ca.pem
openssl x509 -in deploy/certs/proxmox-ca.pem -noout -subject -fingerprint -sha256
```

처음 연결하는 SSH 호스트의 지문과 CA 지문은 Proxmox 관리 콘솔에서 확인한 값과 비교하세요. `PVE_HOST`는 관리할 Proxmox 노드입니다.

```bash
openssl s_client -connect pve.example.internal:8006 \
  -servername pve.example.internal -CAfile deploy/certs/proxmox-ca.pem \
  -verify_hostname pve.example.internal -verify_return_error </dev/null
```

`Verify return code: 0 (ok)`가 나와야 합니다. URL에 IP를 쓰면 해당 IP가 인증서 SAN에 있어야 합니다. 그렇지 않으면 인증서에 포함된 DNS 이름과 정상적으로 해석되는 DNS 레코드를 사용하세요. 인증서를 공인 CA로 교체한 환경에서는 해당 신뢰 체인에 맞는 CA 묶음을 준비합니다.

`NODE_TLS_REJECT_UNAUTHORIZED=0`은 사용하지 않습니다. 이 값이 있으면 서버는 시작을 거부합니다. `NODE_EXTRA_CA_CERTS`는 Node 실행 시 읽히므로 **Next가 나중에 읽는 `.env.local`에만 적어두면 적용되지 않습니다**. Docker Compose와 systemd 파일은 Node 시작 전에 이 변수를 전달합니다.

## 4. Docker Compose 설치

Debian VM에 [Docker의 공식 Debian 설치 안내](https://docs.docker.com/engine/install/debian/)에 따라 Docker Engine과 Compose 플러그인을 설치하세요. 설치 후 확인합니다.

```bash
sudo docker version
sudo docker compose version
cp .env.local.example .env.production
chmod 600 .env.production
openssl rand -hex 32
nano .env.production
```

다음 값을 실제 환경에 맞게 저장합니다. `APP_ORIGIN`에는 포트가 기본 443이면 생략하고, 마지막 `/`는 넣지 않습니다.

```dotenv
PROXMOX_HOST=https://pve.example.internal:8006
APP_ORIGIN=https://proxmox-ui.example.com
SESSION_SECRET=여기에_방금_생성한_64자리_난수
PROXMOX_REQUEST_TIMEOUT_MS=60000
PROXMOX_UPLOAD_TIMEOUT_MS=7200000
```

`SESSION_SECRET`은 최소 32자이며 운영에서는 무작위 64자리 hex 값을 권장합니다. 여러 인스턴스는 같은 값을 사용해야 합니다. 교체하면 기존 UI 세션이 무효화됩니다. `PROXMOX_TOKEN_ID`와 `PROXMOX_TOKEN_SECRET`은 필요하지 않습니다. 이전 환경에 있던 토큰은 새 애플리케이션에서 사용하지 않습니다.

```bash
sudo docker compose build
sudo docker compose up -d --wait --wait-timeout 120
sudo docker compose ps
curl --fail http://127.0.0.1:3000/api/health
sudo docker compose logs --tail=100 app
```

`{"status":"ok"}`는 앱 프로세스가 준비됐다는 뜻입니다. 클러스터 접속과 사용자의 권한까지 확인하는 엔드포인트는 아닙니다. 로그인 후 노드 목록과 작업 실행을 별도로 검사해야 합니다.

앱은 컨테이너 내부에서 비특권 `node` 사용자로 실행됩니다. 실행 코드는 root 소유이며 `node` 사용자는 `.next/cache`만 수정할 수 있습니다. 게스트의 3000 포트는 루프백에만 게시하며 HTTPS 연결은 다음 Nginx 단계에서 처리합니다. `.env*`, 인증서·키, 로컬 빌드·의존성은 이미지 빌드 컨텍스트에서 제외됩니다. CA 파일이 없으면 Compose가 시작을 거부하므로 3절에서 준비한 경로를 확인하세요. `--wait`는 앱 상태 검사가 성공할 때까지 기다립니다.

## 5. HTTPS와 Nginx

`proxmox-ui.example.com`이 UI 게스트 IP를 가리키도록 DNS를 설정합니다. 사내 서비스라면 사내 DNS와 조직 CA 인증서를 사용할 수 있습니다. 브라우저가 신뢰하는 인증서여야 합니다. 공인 인증서는 사용 중인 ACME 클라이언트의 DNS 또는 HTTP 인증 절차로 발급받으세요.

앱→Proxmox에 쓰는 CA와 브라우저→UI에 쓰는 서버 인증서는 서로 다른 용도입니다.

```bash
sudo apt-get update
sudo apt-get install -y nginx
sudo install -d -m 750 /etc/ssl/proxmox-cloudscape
# 실제 발급한 인증서와 개인 키를 다음 경로에 설치합니다.
sudo install -m 644 /path/to/fullchain.pem /etc/ssl/proxmox-cloudscape/fullchain.pem
sudo install -m 600 /path/to/privkey.pem /etc/ssl/proxmox-cloudscape/privkey.pem
sudo cp deploy/nginx.conf /etc/nginx/sites-available/proxmox-cloudscape
sudo nano /etc/nginx/sites-available/proxmox-cloudscape
```

예제의 도메인 3곳과 인증서 경로를 확인합니다. `APP_ORIGIN`과 접속 주소가 정확히 일치해야 합니다. 예제는 Debian 13의 Nginx를 기준으로 `http2 on`을 사용합니다. 구형 Nginx에서 이 지시어를 지원하지 않으면 `listen 443 ssl http2;`로 바꾸고 `http2 on;`을 제거하세요.

```bash
sudo ln -s /etc/nginx/sites-available/proxmox-cloudscape /etc/nginx/sites-enabled/proxmox-cloudscape
sudo nginx -t
sudo systemctl reload nginx
```

기존 Nginx 사이트와 충돌하지 않는지 확인한 뒤 `https://proxmox-ui.example.com`에 접속하세요. 서버가 이미 사용 중이면 다른 사이트 설정을 일괄 삭제하지 않습니다. 80 포트는 HTTPS 리다이렉트 또는 사용하는 인증서 갱신 방식에만 필요합니다. 방화벽은 신뢰하는 관리망의 443 접근을 허용하고, 3000은 외부에 열지 마세요.

제공한 Nginx 구성은 WebSocket 업그레이드, 업로드 스트리밍, 로그인 속도 제한을 포함합니다. 로그인·OIDC 요청 본문은 16 KiB로 제한하며 디스크에 버퍼링하지 않습니다. 인증·콘솔·Proxmox API 경로는 요청 URL의 비밀이 남지 않도록 Nginx access/error 로그를 기록하지 않습니다. 이 경로의 접속 문제는 앱의 비밀을 제외한 오류 메시지와 브라우저의 HTTP 상태로 확인합니다. 업로드의 `client_max_body_size 64g`와 2시간 타임아웃은 환경에 맞게 조정하세요. 앱의 업로드 타임아웃도 함께 맞춰야 합니다. REST JSON 응답은 브라우저가 처리하며, 전체 API 화면의 파일 응답은 브라우저 메모리에 보관되므로 대용량 파일은 전용 스토리지 도구를 사용하세요.

## 6. Docker 없는 systemd 설치

이 절은 수동 설치 방법입니다. LXC에서는 [전용 자동 설치 안내](installation-lxc.ko.md)를 권장합니다. 수동 구성은 Debian 13 VM과 비특권 LXC에서 사용할 수 있으며, LXC는 Nesting을 켜고 서비스 격리 검사까지 통과해야 합니다. 호스트의 패키지 변경과 장애 영향을 줄이려면 별도 게스트를 사용하세요. Proxmox `pveproxy`와 `/usr/share/pve-manager`는 수정하지 않습니다.

게스트에서 빌드 도구와 Node.js 24를 설치합니다. 아래는 검증한 Node.js 24.20.0과 Bun 1.3.12 기준입니다. 운영 업데이트 시 공식 릴리스와 보안 공지를 확인하고 버전을 함께 올리세요.

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates git unzip xz-utils rsync nginx
NODE_VERSION=24.20.0
case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64) NODE_ARCH=arm64 ;;
  *) echo '지원하는 아키텍처를 확인하세요'; exit 1 ;;
esac
NODE_ARCHIVE="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
curl -fSLO "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}"
curl -fSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
awk -v file="$NODE_ARCHIVE" '$2 == file' SHASUMS256.txt | sha256sum --check -
sudo tar -xJf "$NODE_ARCHIVE" -C /opt
sudo ln -sfn "/opt/node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin/node" /usr/local/bin/node
/usr/local/bin/node --version
curl -fsSL https://bun.sh/install -o /tmp/install-bun.sh
bash /tmp/install-bun.sh bun-v1.3.12
export PATH="$HOME/.bun/bin:/usr/local/bin:$PATH"
bun --version
```

Bun 설치 스크립트는 내려받은 내용을 검토한 뒤 실행할 수 있도록 파일로 저장합니다. Node 다운로드의 SHA-256 검사는 반드시 성공해야 합니다. Node의 공식 서명 검증 절차가 조직 정책에 있다면 함께 적용하세요.

LXC에서 수동 설치한다면 빌드 전에 `sudo bash deploy/check-lxc-sandbox.sh`를 실행해 서비스 격리 지원을 확인하세요. 이 검사는 VM에서는 실행하지 않습니다.

```bash
bun install --frozen-lockfile
bun run check
bun audit
bun run build
sudo bash deploy/install-systemd.sh
sudo nano /etc/proxmox-cloudscape/environment
sudo install -m 644 deploy/certs/proxmox-ca.pem /etc/proxmox-cloudscape/proxmox-ca.pem
sudo systemctl restart proxmox-cloudscape
sudo systemctl status proxmox-cloudscape --no-pager
curl --fail --retry 10 --retry-connrefused --retry-delay 2 http://127.0.0.1:3000/api/health
```

설정 파일에는 4절의 `PROXMOX_HOST`, `APP_ORIGIN`, `SESSION_SECRET`을 넣습니다. 설치 스크립트는 기존 설정 파일을 덮어쓰지 않습니다. `/opt/proxmox-cloudscape/releases/`에 새 빌드를 복사하고 `current`와 `previous` 심볼릭 링크를 관리합니다. 서비스는 루트로 실행하지 않으며 `.next/cache`만 쓰기 가능합니다. Nginx는 5절과 동일하게 구성합니다.

Node가 다른 경로에 있다면 서비스의 `ExecStart`와 설치 스크립트의 Node 검사 경로를 함께 바꾸세요. 설치 파일은 `/usr/local/bin/node` 기준입니다.

## 7. 첫 로그인과 사용자·역할 생성

1. 로그인 화면에서 Proxmox에 이미 존재하는 사용자 이름과 인증 영역을 선택합니다. 예를 들어 `root` + `pam`, 또는 운영자 이름 + `pve`입니다. 사용자 ID가 `user@pve`라면 이름은 `user`, 인증 영역은 `pve`로 나눠 입력합니다.
2. `Permissions` / `권한`에서 **Roles / 역할 → Create role / 역할 생성**을 선택하고 역할 이름과 필요한 권한을 고릅니다. 내장 역할은 수정·삭제하지 않습니다.
3. **Users / 사용자 → Create user / 사용자 생성**에서 `operator@pve`처럼 인증 영역을 포함한 ID를 입력합니다. `pve` 영역이면 초기 비밀번호를 설정합니다. PAM 계정의 OS 사용자 생성이나 LDAP 디렉터리 계정 생성은 이 API의 범위가 아니므로 해당 시스템에서 먼저 준비해야 합니다.
4. 그룹을 만들고 사용자에게 지정한 뒤 ACL에서 경로·그룹·역할을 연결합니다. 예를 들어 특정 VM만 관리하려면 `/vms/100` 경로를 선택합니다. 전파 여부도 확인합니다.
5. 관리자 세션에서 로그아웃한 뒤 새 사용자로 로그인하여 실제로 필요한 화면과 작업만 허용되는지 확인합니다. UI 버튼 표시와 별개로 최종 권한 검사는 Proxmox가 수행합니다.
6. 사용자의 **Security / 보안**에서 비밀번호, API 토큰, TOTP, YubiKey, 보안 키·패스키, 복구 코드와 유효 권한을 관리합니다. 생성된 토큰 비밀과 복구 코드는 다시 조회할 수 없으므로 표시된 순간에 안전한 비밀 저장소에 보관합니다. 권한 분리 토큰은 소유자의 권한과 토큰 ACL의 제한을 모두 받습니다.

권한이 없는 목록 하나 때문에 페이지 전체가 비어 있지 않도록 개별 로드 오류를 표시합니다. 필요한 관리자 권한이 없으면 생성·수정 API가 403으로 거부될 수 있습니다.

## 8. SSO와 2단계 인증

- TOTP, YubiKey OTP, 복구 코드: 비밀번호 검증 뒤 Proxmox가 보낸 추가 인증 단계에 입력합니다.
- OpenID Connect: Proxmox 인증 영역의 IdP 클라이언트에 `https://proxmox-ui.example.com/api/auth/openid`를 허용된 리다이렉트 URI로 등록합니다. 기존 Proxmox UI의 리다이렉트 URI가 있다면 유지합니다. 영역 선택 후 SSO 로그인을 시작합니다.
- WebAuthn 로그인: Proxmox WebAuthn 설정의 RP ID와 허용 origin이 UI 도메인에서 사용 가능한 구성이어야 합니다. **RP ID를 무작정 변경하면 기존 보안 키가 작동하지 않을 수 있습니다.** 기존 값과 도메인 관계를 확인하고 필요하면 해당 RP에 보안 키를 등록합니다. 등록은 사용자의 **Security / 보안 → Two-factor authentication / 2단계 인증 → Create / 생성 → Security key / passkey / 보안 키·패스키**에서 시작합니다. 이름과 필요한 작업자 비밀번호를 입력한 뒤 브라우저의 안내를 완료하세요. 등록 완료 전까지 기존 인증 수단과 복구 코드를 유지합니다.
- 구형 U2F만 설정된 계정은 Proxmox 기본 UI를 사용합니다. 이를 지원한다고 표시하거나 2단계 인증을 건너뛰지 않습니다.

UI 활성 세션은 주기적으로 Proxmox 티켓을 갱신합니다. 로그아웃은 진행 중인 갱신을 취소하고 종료를 기다린 뒤 세션 쿠키를 지웁니다. Web Locks를 지원하는 브라우저에서는 여러 탭의 갱신과 로그아웃도 순서대로 처리합니다. 만료·권한 철회·네트워크 오류를 구분해서 표시하며, 서버 로그아웃에 실패하면 로그아웃됐다고 표시하지 않습니다.

## 9. 업데이트와 롤백

먼저 운영 게스트 스냅샷과 설정 파일·CA 인증서·Nginx 인증서의 백업을 준비하세요. 비밀은 소스 저장소에 커밋하지 않습니다. VM/스토리지 작업의 성공 여부는 UI 프로세스 상태가 아니라 Proxmox 작업 로그로 확인합니다.

### Docker

현재 이미지에 복구용 태그를 붙인 뒤 새 버전을 빌드합니다.

```bash
sudo docker image tag proxmox-cloudscape-ui:local proxmox-cloudscape-ui:previous
# 변경사항이 포함된 새 소스를 반영한 뒤 실행합니다.
sudo docker compose build
sudo docker compose up -d --wait --wait-timeout 120
sudo docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

로그인·노드 조회·콘솔을 확인합니다. 문제가 생기면 기존 이미지로 돌아갑니다.

```bash
sudo env IMAGE_TAG=previous docker compose up -d --no-build --wait --wait-timeout 120
```

이 예시는 기본 `IMAGE_TAG=local`을 사용하는 경우입니다. 이미지 태그를 별도로 관리하면 해당 릴리스 태그로 바꾸세요. `SESSION_SECRET`을 유지하면 앱 재시작 후에도 아직 유효한 세션을 읽을 수 있습니다. 업로드와 콘솔은 재시작 중 끊길 수 있으므로 진행 중인 작업과 사용자 세션을 먼저 확인합니다.

### systemd

새 소스에서 `bun install --frozen-lockfile`, `bun run check`, `bun audit`, `bun run build`를 완료한 뒤 설치 스크립트를 다시 실행하고 서비스를 재시작합니다. 설정은 유지되고 이전 릴리스 링크가 갱신됩니다.

```bash
sudo bash deploy/install-systemd.sh
sudo systemctl restart proxmox-cloudscape
```

롤백:

```bash
sudo systemctl stop proxmox-cloudscape
sudo sh -c 'target=$(readlink /opt/proxmox-cloudscape/previous); test -d "$target" && ln -sfn "$target" /opt/proxmox-cloudscape/current'
sudo systemctl start proxmox-cloudscape
```

오래된 릴리스를 삭제하기 전에는 `current`, `previous`가 가리키는 디렉터리를 확인하세요.

## 10. 장애 확인

| 증상 | 확인할 사항 |
|---|---|
| 서비스 시작 실패 | `SESSION_SECRET` 길이, `APP_ORIGIN`의 HTTPS 및 마지막 슬래시, `PROXMOX_HOST` 형식, Node 24, 생산 빌드 존재 |
| 502 / CA trust 오류 | CA 경로·파일 권한, 전체 체인, 인증서 만료, SAN과 주소 일치, 게스트→노드 8006 연결 |
| 로그인 또는 변경 작업 403 | 접속 origin과 `APP_ORIGIN` 일치, Nginx Host 전달, 실제 Proxmox 사용자 ACL |
| 특정 목록 403 | 그 사용자에게 해당 API를 조회할 권한이 있는지 확인 |
| 생성 시 400/500 및 필드 오류 | 표시된 매개변수, 대상 Proxmox 버전, 이름·VMID 충돌, 저장소/노드 상태 |
| 콘솔 연결 실패 | Nginx `/ws` 업그레이드, TLS 신뢰, 티켓 만료, VM 실행 상태, VM.Console/Sys.Console 권한 |
| 업로드 413/504 | Nginx 용량 제한과 시간 제한, 앱 업로드 시간 제한, 대상 저장소 여유 공간 |
| 작업 접수 후 실패 | Proxmox UPID의 최종 `exitstatus`와 작업 로그 확인; 변경 요청은 자동 재전송되지 않음 |
| 업데이트 후 세션 해제 | 세션 비밀 변경 여부, 기존 티켓 유효 시간 |

```bash
sudo docker compose logs --tail=100 app
# 또는
sudo journalctl -u proxmox-cloudscape -n 100 --no-pager
sudo nginx -t
```

`/api/health`는 인증 없이 프로세스 준비 상태만 반환합니다. 운영 모니터링에는 앱 상태, 노드 API 접속, 인증서 만료, 디스크·메모리, 실패한 Proxmox 작업을 따로 포함하세요. 작업 알림은 열린 브라우저 세션에서 추적합니다. 새로고침이나 브라우저 종료 후에는 작업 로그 화면에서 최종 상태를 확인합니다.

## 11. 운영 승인 전에 실제 클러스터에서 확인할 항목

로컬 자동 검증은 실제 Proxmox의 저장소·네트워크·하드웨어 장애를 대신할 수 없습니다. 먼저 테스트 클러스터 또는 폐기 가능한 리소스에서 다음 경로를 검증하세요.

- 사용자·그룹·역할·ACL 생성 → 새 사용자 로그인 → 허용/거부 경로 확인 → 테스트 항목 삭제
- 토큰 생성·권한 분리·만료·삭제, 비밀번호 변경, 실제 TOTP/SSO/WebAuthn 설정
- VM/LXC 생성·시작·정상 종료·콘솔, 백업·복원·스냅샷, 작업 실패 표시
- ISO 업로드, 노드·스토리지·네트워크별 실제 버전 호환성
- HTTPS 프록시 뒤 WebSocket, 대용량 업로드 중 네트워크 중단, 서비스 재시작과 롤백
- HA·복제·Ceph·SDN처럼 클러스터 상태를 바꾸는 작업은 해당 구성의 시험 환경에서 별도 검증

이번 작업에서 실제 클러스터에 임의의 사용자·역할·VM을 만들거나 네트워크·스토리지를 변경하지 않았습니다. 검증된 내용과 남은 범위는 [검사 보고서](api-coverage-and-audit.md)에 기록합니다.
