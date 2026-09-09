# Proxmox Cloudscape UI

Cloudscape Design System으로 구현한 Proxmox VE 관리 인터페이스입니다. Next.js 서버가 로그인한 사용자의 Proxmox 티켓으로 REST API와 콘솔 WebSocket을 중계합니다.

- 사용자·그룹·역할·ACL·인증 영역, API 토큰, 비밀번호, TOTP·YubiKey·보안 키·패스키·복구 코드 관리
- VM·LXC·노드·스토리지·백업·네트워크·방화벽·HA 그룹·복제 작업 관리
- 공식 스키마의 680개 작업을 검색하는 **전체 API 관리** 화면. 전용 화면이 없는 Ceph·SDN·알림·매핑 같은 기능도 매개변수 폼에서 요청할 수 있습니다. 3개 WebSocket 작업은 기존 콘솔 화면을 이용합니다.
- HTTPS 세션, TOTP·YubiKey·복구 코드·WebAuthn 로그인, OpenID Connect, 자동 세션 갱신

전체 API 목록이 있다는 사실은 모든 Proxmox 버전과 모든 하드웨어 조합의 동작이 검증됐다는 뜻이 아닙니다. 서버 버전에 없는 기능은 Proxmox의 오류를 표시합니다. [기능 비교와 검증 범위](docs/api-coverage-and-audit.md)를 확인하세요.

## 설치

**기존 Caddy를 사용하는 경우: [명령 하나로 LXC 자동 설치](docs/quick-install-caddy.ko.md)**. 컨테이너 Console에서 설치기를 실행하면 주소 입력, 내부 IP 확인, 앱 설치와 Caddy 설정 생성을 안내합니다.

**[공개 릴리스 자동 배포](docs/automatic-deployment.ko.md)**: push마다 CI에서 검사하고, 버전 태그를 push하면 검증된 릴리스를 게시합니다. 누구나 GitHub 계정·PAT 없이 설치하고 새 안정 버전으로 자동 업데이트합니다. Node도 포함되어 LXC에서 빌드하지 않으며 실패 시 이전 릴리스를 복원합니다.

**[Proxmox LXC 설치 안내](docs/installation-lxc.ko.md)**를 먼저 읽으세요. 비특권 Debian LXC에서 설치 스크립트가 Node.js·Bun·systemd·Nginx를 준비하고 HTTPS 서비스를 구성합니다. 컨테이너 생성, 현재 소스 전달, 인증서 준비, 업데이트와 복구까지 설명합니다.

LXC는 서비스 격리를 위해 `Nesting`을 켜고, `keyctl`은 켤 필요가 없습니다. 기존 Proxmox 관리 화면과 8006 포트는 그대로 유지됩니다. VM에서 Docker Compose로 운영하거나 수동 설치하려면 [별도 설치·운영 안내](docs/installation.ko.md)를 참고하세요.

필수 설정:

```dotenv
PROXMOX_HOST=https://pve.example.internal:8006
APP_ORIGIN=https://proxmox-ui.example.com
SESSION_SECRET=openssl-rand-hex-32로-생성한-값
```

Proxmox 사설 CA는 Node 프로세스를 시작하기 **전에** `NODE_EXTRA_CA_CERTS`로 등록합니다. 인증서의 SAN과 `PROXMOX_HOST`가 일치해야 합니다. 서버 API 토큰을 이용한 익명 접속 및 전역 TLS 검증 해제는 지원하지 않습니다.

### 로컬 연결에서 CA 오류가 날 때

`UNABLE_TO_VERIFY_LEAF_SIGNATURE` 또는 `Proxmox TLS certificate is not trusted` 오류는 앱이 Proxmox 인증서의 발급 기관을 신뢰하지 못한다는 뜻입니다. 서버 주소·계정 정보가 정확해도 Proxmox 기본 사설 CA는 별도로 등록해야 합니다.

1. **Proxmox 웹 관리 화면 → 해당 노드 → Shell**에서 공개 CA 인증서를 확인합니다. 개인 키인 `.key` 파일은 복사하지 않습니다.

   ```bash
   openssl x509 -in /etc/pve/pve-root-ca.pem -noout -fingerprint -sha256
   ```

2. **Mac의 프로젝트 디렉터리**에서 파일을 가져옵니다. `PVE_HOST`는 `.env`의 `PROXMOX_HOST`에서 `https://`와 포트를 제외한 실제 노드의 호스트 이름 또는 IP로 바꿉니다. `root` 대신 기존 SSH 계정을 사용해도 됩니다. 처음 접속하는 SSH 호스트의 지문은 관리 콘솔에서 확인한 값과 비교합니다.

   ```bash
   mkdir -p deploy/certs
   scp root@PVE_HOST:/etc/pve/pve-root-ca.pem deploy/certs/proxmox-ca.pem
   openssl x509 -in deploy/certs/proxmox-ca.pem -noout -fingerprint -sha256
   ```

   두 CA의 SHA-256 지문이 같아야 합니다. SSH를 사용할 수 없다면 Proxmox Shell에서 `cat /etc/pve/pve-root-ca.pem`을 실행하고, `-----BEGIN CERTIFICATE-----`부터 `-----END CERTIFICATE-----`까지 복사하여 Mac의 `deploy/certs/proxmox-ca.pem`에 일반 텍스트로 저장합니다.

3. **앱을 실행할 Mac 터미널**에서 아래와 같이 지정합니다. 기존 개발 서버를 `Ctrl+C`로 종료한 뒤 같은 터미널에서 다시 실행합니다.

   ```bash
   export NODE_EXTRA_CA_CERTS="$PWD/deploy/certs/proxmox-ca.pem"
   bun run dev
   ```

   `export`는 현재 터미널과 여기서 시작한 프로그램에 적용됩니다. 새 터미널에서 시작할 때는 다시 지정하세요. Node는 시작 시 CA 설정을 읽으므로 Next가 나중에 읽는 `.env`에만 적거나 실행 중인 서버에서 파일만 바꿔서는 반영되지 않습니다. Bun의 사전 환경변수 로딩 여부에 의존하지 않도록 위처럼 명시적으로 전달합니다.

4. 브라우저에서 `http://localhost:3000/api/auth/realms`를 확인합니다. 정상 연결이면 `data` 배열에 로그인 영역 목록이 반환됩니다. CA 오류가 사라지고 호스트 불일치 오류가 나오면 `PROXMOX_HOST`를 인증서 SAN에 포함된 호스트 이름 또는 IP로 맞춥니다.

서버 인증서를 조직 CA나 공인 CA 인증서로 교체했다면 기본 `pve-root-ca.pem` 대신 현재 인증서를 검증하는 신뢰 체인을 사용해야 합니다. Docker·LXC 운영 환경의 CA 배치는 [설치 안내](docs/installation.ko.md#3-proxmox-ca와-주소-확인)를 참고하세요.

## 개발과 검증

Node.js 24 LTS와 Bun 1.3.12를 사용합니다. Bun은 패키지 관리·명령 실행 도구이며 서버 런타임은 Node.js입니다.

```bash
bun install --frozen-lockfile
cp .env.local.example .env.local
# .env.local의 서버 주소와 세션 비밀을 설정합니다.
# 로컬 HTTP 개발에서는 APP_ORIGIN=http://localhost:3000 으로 설정합니다.
export NODE_EXTRA_CA_CERTS=/absolute/path/to/proxmox-ca.pem
bun run dev
```

```bash
bun run check
bun audit
bun run build
docker build -t proxmox-cloudscape-ui:audit .
bunx playwright install chromium
bun run test:smoke
bash scripts/check-deployment.sh
bun run package:source
LXC_TEST_DEBIAN_VERSION=12 bash scripts/check-lxc-install.sh
LXC_TEST_DEBIAN_VERSION=13 bash scripts/check-lxc-install.sh
```

`test:smoke`는 임시 TLS 인증서와 메모리 내 Proxmox API 테스트 서버를 만들고, 실제 프로덕션 Docker 이미지를 실행해 Chromium으로 HTTPS 로그인·사용자 생성·역할 생성·API 조회·모바일 화면을 검사합니다. 실제 클러스터에는 연결하지 않습니다. 테스트 서버의 자체 서명 인증서는 해당 브라우저 컨텍스트에서만 예외 처리하고, 애플리케이션→API 구간은 CA 검증을 유지합니다. 결과 이미지는 `test-results/`에 저장합니다.

`check-deployment.sh`는 일회용 컨테이너에서 Compose·Nginx·systemd 설정, 설치 파일 권한, 재설치와 롤백 링크를 검사합니다. 호스트의 서비스는 변경하지 않습니다.

`check-lxc-install.sh`는 일회용 Debian 컨테이너에서 실제 런타임 다운로드·검사·빌드·Nginx HTTPS 설치와 업데이트 실패 복구를 검사합니다. `LXC_TEST_DEBIAN_VERSION`은 `12` 또는 `13`을 지정하며 기본값은 `13`입니다. CI도 두 버전의 매트릭스로 구성돼 있습니다. 이 검사에서 LXC 감지와 systemd 실행 명령은 대체하므로, 실제 Proxmox LXC의 커널·AppArmor·systemd 격리 검증은 별도로 필요합니다. 실제 설치기는 LXC 안에서 서비스 격리 기능을 먼저 확인하고, 공개 `GET /api2/json/access/domains`로 Proxmox TLS와 API 응답을 검사합니다.

## API 스키마 업데이트

```bash
bun run schema:update
# 인터넷 없이 Proxmox 노드의 공식 문서 파일에서 갱신할 수도 있습니다.
bun run schema:update /path/to/apidoc.js
```

스크립트는 공식 문서에서 JSON 데이터만 추출하며 다운로드한 JavaScript를 실행하지 않습니다. 원본 URL·수집일·SHA-256을 함께 기록합니다. Proxmox 노드에는 일반적으로 `/usr/share/pve-docs/api-viewer/apidoc.js`가 설치돼 있습니다. 대상 서버와 동일한 버전의 스키마로 갱신한 뒤 검사·빌드를 다시 실행하세요.

## 기준 문서

- [Cloudscape 공식 LLM 문서 인덱스](https://cloudscape.design/llms.txt)
- [Proxmox VE API Viewer](https://pve.proxmox.com/pve-docs/api-viewer/index.html)
- [Proxmox 사용자 관리](https://pve.proxmox.com/pve-docs/pveum.1.html)
- [Next.js 자체 호스팅](https://nextjs.org/docs/app/guides/self-hosting)
