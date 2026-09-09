# Proxmox LXC에 설치하기

Proxmox 안에 **Debian 13 비특권 LXC**를 만들고, 그 안에서 `deploy/install-lxc.sh`를 실행합니다. Debian 12도 지원합니다. 설치 스크립트가 Node.js 24.20.0, Bun 1.3.12, 애플리케이션 빌드, systemd 서비스와 Nginx HTTPS 설정을 준비합니다.

기존 Proxmox 관리 화면과 8006 포트는 유지됩니다. 설치 명령은 새 LXC 안에서 실행하며, Proxmox 호스트에 Node.js나 Nginx를 설치하지 않습니다. **실제 Proxmox LXC에서의 부팅·설치·운영 검증은 아직 수행하지 않았습니다.** 아래 절차의 서비스 검사와 마지막 실제 접속 검증을 완료한 뒤 운영에 투입하세요.

## 1. 준비할 값과 파일

이 문서에서는 실행 위치를 **개발 컴퓨터**, **Proxmox 호스트**, **LXC 내부**로 구분합니다. `PVE_HOST`, 예시 도메인과 파일 경로는 자신의 환경으로 바꾸세요.

| 항목 | 준비할 내용 |
|---|---|
| LXC | 새 Debian 13 또는 12 표준 템플릿, 비특권 모드, Nesting 활성화 |
| 시작 사양 | CPU 2코어, RAM 4 GiB, 루트 디스크 20 GiB. 빌드와 소규모 운영의 출발점이며 사용량에 따라 늘립니다. |
| CT ID | 클러스터 전체에서 사용하지 않는 ID. 예시 번호를 임의로 재사용하지 않습니다. |
| 스토리지 | 템플릿을 보관할 `vztmpl` 스토리지와 컨테이너 디스크를 만들 `rootdir` 스토리지 |
| 네트워크 | 실제 노드에 존재하는 브리지, 고정 IP 또는 DHCP 예약, 정상적인 DNS |
| Proxmox 주소 | 예: `https://pve.example.internal:8006`. 인증서 SAN과 일치하며 LXC에서 접근할 수 있어야 합니다. |
| UI 주소 | 예: `https://proxmox-ui.example.com`. DNS가 LXC의 IP를 가리켜야 합니다. 설치 스크립트는 HTTPS DNS 이름 또는 IPv4 주소와 기본 443 포트를 사용합니다. |
| Proxmox CA | Proxmox 서버 인증서를 검증할 **공개 CA 인증서** 또는 CA 묶음 |
| UI TLS | UI 도메인으로 발급된 `fullchain.pem`과 해당 인증서의 `privkey.pem` |

관리 브라우저에서 LXC의 TCP 443으로, LXC에서 Proxmox의 TCP 8006으로 연결할 수 있어야 합니다. 패키지 설치와 빌드에는 Debian 저장소, Node.js·Bun 배포 서버와 패키지 레지스트리 접속도 필요합니다. DNS와 호스트의 시간 동기화를 확인하세요. 3000 포트는 루프백 전용이므로 외부에 열지 않습니다. 80 포트는 HTTPS 리다이렉트 또는 선택한 인증서 갱신 방식에 필요할 때 허용합니다.

```text
관리 브라우저
  │ HTTPS 443
  ▼
Debian 비특권 LXC
  Nginx → 127.0.0.1:3000 → Node.js / Cloudscape UI
                              │ HTTPS / WSS 8006
                              ▼
                         Proxmox VE API
```

**Nesting은 켜야 합니다.** 제공한 systemd 서비스가 `PrivateTmp`, `ProtectSystem` 등으로 앱을 격리하기 때문입니다. Proxmox 공식 문서도 systemd의 서비스 격리에 Nesting이 필요하다고 설명합니다. 이 기능은 호스트 procfs·sysfs의 일부 정보도 게스트에 노출합니다. 비특권 모드를 유지하고, 이 설치에서 쓰지 않는 `keyctl`, 장치 전달, AppArmor 해제는 추가하지 마세요. [Proxmox 컨테이너 기능 설명](https://github.com/proxmox/pve-docs/blob/master/generated/pct.conf.5-opts.adoc)

## 2. LXC 만들기

### Proxmox 웹 화면에서 만들기

1. 대상 노드의 템플릿 저장소에서 **CT Templates → Templates**를 열고 현재 제공되는 **Debian 13 standard** 템플릿을 내려받습니다. Debian 12 standard도 가능합니다. 템플릿 파일명은 업데이트에 따라 달라집니다.
2. **Create CT**를 누릅니다. 대상 노드, 사용하지 않는 CT ID, 호스트 이름을 정하고 **Unprivileged container**를 활성화합니다. 비밀번호 또는 필요한 SSH 공개 키를 설정합니다.
3. 내려받은 템플릿과 실제 사용 가능한 디스크 스토리지를 선택합니다. 디스크 20 GiB, CPU 2코어, 메모리 4096 MiB를 시작값으로 지정합니다. 스왑은 호스트 정책과 여유 공간에 맞게 설정합니다.
4. 실제 브리지와 네트워크를 지정합니다. 고정 IP 또는 DHCP 예약을 사용하고 UI 도메인이 그 IP를 가리키도록 DNS를 설정합니다.
5. 생성 후 **Options → Features → Nesting**을 켭니다. `keyctl`은 꺼진 상태로 둡니다. **Start at boot**도 켭니다.
6. CT를 시작합니다. 이미 실행 중인 CT의 기능을 바꿨다면 정상 종료 후 다시 시작하여 적용합니다.

컨테이너 템플릿·생성·네트워크 설정의 원문은 [Proxmox 컨테이너 관리 문서](https://github.com/proxmox/pve-docs/blob/master/pct.adoc)를 참고하세요.

### 명령으로 만들기 — 웹 화면의 대안

이 절은 **LXC를 만들 Proxmox 호스트의 root 셸**에서 실행합니다. 웹 화면에서 이미 만들었다면 건너뜁니다. 먼저 실제 목록을 확인합니다.

```bash
pct list
pvesh get /cluster/resources --type vm
pvesm status --content vztmpl --enabled 1
pvesm status --content rootdir --enabled 1
ip -brief link show type bridge
pveam update
pveam available --section system
```

`pct list`는 현재 노드의 CT를 보여주므로, CT ID 중복 여부는 클러스터의 VM 목록도 함께 확인합니다. OVS 브리지 등 `ip ... type bridge`에 보이지 않는 구성은 Proxmox의 **Node → System → Network**에서 확인하세요. 템플릿용과 디스크용 스토리지는 서로 달라도 됩니다. 스토리지 유형별 콘텐츠 지원은 [Proxmox 스토리지 명령 설명](https://github.com/proxmox/pve-docs/blob/master/generated/pvesm.1-synopsis.adoc)에 나와 있습니다.

같은 **Bash 셸**에서 목록에 있는 값을 직접 입력합니다. `DEBIAN_TEMPLATE`에는 행 전체가 아니라 `debian-13-standard_…_amd64.tar.zst`처럼 표시된 실제 파일명만 입력합니다.

```bash
read -r -p '사용하지 않는 CT ID: ' CTID
read -r -p '템플릿 저장소 ID: ' TEMPLATE_STORAGE
read -r -p '컨테이너 디스크 저장소 ID: ' ROOTFS_STORAGE
read -r -p '네트워크 브리지 이름: ' BRIDGE
read -r -p '목록의 Debian 표준 템플릿 파일명: ' DEBIAN_TEMPLATE

pveam download "$TEMPLATE_STORAGE" "$DEBIAN_TEMPLATE"
pveam list "$TEMPLATE_STORAGE"
read -r -p '방금 받은 템플릿의 전체 Volume ID: ' TEMPLATE_VOLID

pct create "$CTID" "$TEMPLATE_VOLID" \
  --hostname proxmox-cloudscape \
  --ostype debian --unprivileged 1 --features nesting=1 \
  --cores 2 --memory 4096 --swap 1024 \
  --rootfs "$ROOTFS_STORAGE:20" \
  --net0 "name=eth0,bridge=$BRIDGE,ip=dhcp,type=veth" \
  --onboot 1
pct start "$CTID"
pct config "$CTID"
pct exec "$CTID" -- cat /etc/os-release
pct exec "$CTID" -- ip -brief address
```

이 예시는 **DHCP가 있는 네트워크** 기준입니다. DHCP가 없다면 생성 전에 `--net0`를 실제 주소의 `ip=주소/프리픽스,gw=게이트웨이` 설정으로 바꾸세요. 필요한 VLAN 태그와 DNS도 자신의 네트워크 구성에 맞게 지정합니다. 스왑 1024 MiB는 예시이며 호스트에 스왑이 없는 경우 실제 스왑 용량을 만들어 주는 설정은 아닙니다.

CLI 예시는 CT 내부 SSH를 켜거나 root 비밀번호를 전달하지 않습니다. 이후 파일 전달과 설치는 호스트의 `pct push`, `pct enter`로 진행하므로 CT의 SSH 서비스가 없어도 됩니다. 명령과 매개변수는 [공식 pct 명령 설명](https://github.com/proxmox/pve-docs/blob/master/generated/pct.1-synopsis.adoc), 템플릿 목록·다운로드는 [공식 pveam 명령 설명](https://github.com/proxmox/pve-docs/blob/master/generated/pveam.1-synopsis.adoc)을 기준으로 합니다.

## 3. 현재 소스를 Proxmox 호스트로 전달하기

이번 변경사항은 자동으로 GitHub에 게시되지 않습니다. 원본 Git 작업 디렉터리에서 소스 패키지를 만들어 전송하면 추적 중인 파일의 수정과 Git에서 무시하지 않는 새 파일도 포함됩니다. 비밀 환경 파일, 인증서·개인 키, 의존성과 빌드 결과는 소스 패키지에서 제외합니다. 임의의 이름으로 저장한 비밀까지 모두 감지하는 도구는 아니므로 비밀을 소스 파일에 적지 마세요. 압축을 푼 디렉터리에는 Git 정보가 없으므로 그곳에서 다시 패키징하지 않습니다.

**개발 컴퓨터의 프로젝트 디렉터리**에서 실행합니다.

```bash
cd /Users/lxvu/proxmox-cloudscape-ui
bun run package:source
```

출력된 아카이브와 SHA-256 파일을 확인합니다. 아래는 기본 출력 파일명 기준입니다. 개발 컴퓨터가 다른 환경이면 첫 줄의 경로만 바꾸세요.

```bash
ssh root@PVE_HOST 'install -d -m 0700 /root/proxmox-cloudscape-install'
scp build/proxmox-cloudscape-ui-source.tar.gz \
  build/proxmox-cloudscape-ui-source.tar.gz.sha256 \
  root@PVE_HOST:/root/proxmox-cloudscape-install/
```

처음 연결하는 SSH 호스트의 지문은 Proxmox 관리 콘솔에서 확인한 값과 비교합니다. **Proxmox 호스트**에서 전송된 파일을 검사합니다.

```bash
cd /root/proxmox-cloudscape-install
sha256sum --check proxmox-cloudscape-ui-source.tar.gz.sha256
```

`OK`를 확인한 뒤 진행합니다. 해시 파일도 동일한 신뢰 경로로 전달해야 하며, 이 검사는 전송 과정의 파일 손상을 찾는 용도입니다.

## 4. 두 종류의 인증서 준비하기

### 앱 → Proxmox: 공개 CA

Proxmox 기본 CA를 사용하는 환경에서는 **Proxmox 호스트**의 `/etc/pve/pve-root-ca.pem`이 공개 CA 인증서입니다. 설치할 앱에는 이 파일만 전달합니다. `/etc/pve/priv/pve-root-ca.key` 같은 **PVE CA 개인 키나 노드의 개인 키는 전달하지 않습니다**.

```bash
openssl x509 -in /etc/pve/pve-root-ca.pem \
  -noout -subject -fingerprint -sha256
```

Proxmox 서버 인증서를 별도 조직 CA 또는 공인 CA 인증서로 교체했다면 현재 서버 인증서를 검증하는 CA 묶음을 준비합니다. 아래 명령의 `PVE_CA_FILE`을 그 파일로 바꾸세요. CA는 인증서를 발급한 기관의 신뢰할 수 있는 경로로 확보합니다.

### 브라우저 → UI: 서버 인증서와 개인 키

`proxmox-ui.example.com`으로 발급된 인증서 체인과 개인 키를 준비합니다. 사내 DNS와 조직 CA를 사용해도 되지만 접속할 브라우저가 그 CA를 신뢰해야 합니다. 공인 인증서는 사용 중인 ACME 도구로 발급받고 자동 갱신 경로를 마련하세요. 설치 스크립트는 인증서를 발급하거나 자동 갱신하지 않습니다.

UI 인증서의 SAN에는 **UI 도메인**이 들어 있어야 합니다. Proxmox 노드용 인증서를 이름만 바꿔 복사하면 UI 도메인 검증에 실패할 수 있습니다. 무인 Nginx 시작에 사용할 개인 키는 비밀번호 입력이 필요 없는 PEM 파일이어야 하며 root만 읽을 수 있게 보관합니다.

인증서가 있는 컴퓨터에서 파일을 Proxmox 호스트로 전달합니다.

```bash
scp /path/to/ui/fullchain.pem /path/to/ui/privkey.pem \
  root@PVE_HOST:/root/proxmox-cloudscape-install/
ssh root@PVE_HOST 'chmod 0600 /root/proxmox-cloudscape-install/privkey.pem'
```

## 5. 소스와 인증서를 LXC 안으로 전달하기

**Proxmox 호스트**에서 실행합니다. 앞서 선택한 CT ID를 다시 입력하므로 셸을 새로 열어도 됩니다.

```bash
read -r -p '설치할 CT ID: ' CTID
pct config "$CTID"
pct status "$CTID"

PVE_CA_FILE=/etc/pve/pve-root-ca.pem
TRANSFER_DIR=/root/proxmox-cloudscape-install
pct exec "$CTID" -- install -d -m 0700 "$TRANSFER_DIR"
pct push "$CTID" "$TRANSFER_DIR/proxmox-cloudscape-ui-source.tar.gz" \
  "$TRANSFER_DIR/proxmox-cloudscape-ui-source.tar.gz" --perms 0600
pct push "$CTID" "$TRANSFER_DIR/proxmox-cloudscape-ui-source.tar.gz.sha256" \
  "$TRANSFER_DIR/proxmox-cloudscape-ui-source.tar.gz.sha256" --perms 0600
pct push "$CTID" "$PVE_CA_FILE" \
  "$TRANSFER_DIR/proxmox-ca.pem" --perms 0644
pct push "$CTID" "$TRANSFER_DIR/fullchain.pem" \
  "$TRANSFER_DIR/fullchain.pem" --perms 0644
pct push "$CTID" "$TRANSFER_DIR/privkey.pem" \
  "$TRANSFER_DIR/privkey.pem" --perms 0600
pct enter "$CTID"
```

`pct config`에서 대상이 맞는지와 `unprivileged: 1`, `features: nesting=1`을 확인합니다. 다른 기능이 이미 있으면 `features` 줄에 함께 표시될 수 있습니다. CT가 실행 중이어야 `pct exec`와 설치를 진행할 수 있습니다. `pct enter` 이후부터 `exit` 전까지는 **LXC 내부 root 셸**입니다. 호스트 셸의 변수는 전달된다고 가정하지 않습니다.

## 6. LXC 안에서 설치하기

**LXC 내부**에서 소스 아카이브를 확인하고 새 디렉터리에 풉니다.

```bash
cd /root/proxmox-cloudscape-install
sha256sum --check proxmox-cloudscape-ui-source.tar.gz.sha256
SOURCE_DIR=$(mktemp -d /root/proxmox-cloudscape-source.XXXXXXXX)
tar -xzf proxmox-cloudscape-ui-source.tar.gz -C "$SOURCE_DIR" --no-same-owner
cd "$SOURCE_DIR"
```

먼저 서비스 격리 지원을 검사할 수 있습니다. 설치 스크립트도 이 검사를 수행합니다.

```bash
bash deploy/check-lxc-sandbox.sh
```

이 검사는 잠시 비특권 systemd 서비스를 실행하여 앱의 실제 보안 설정과 캐시 쓰기를 확인한 뒤 정리합니다. 실패하면 호스트에서 Nesting을 확인하고 CT를 완전히 종료·시작하세요. 서비스 보안 설정을 제거해 우회하지 않습니다.

다음 명령의 두 주소를 실제 값으로 바꿔 실행합니다.

```bash
bash deploy/install-lxc.sh \
  --proxmox-host https://pve.example.internal:8006 \
  --app-origin https://proxmox-ui.example.com \
  --proxmox-ca /root/proxmox-cloudscape-install/proxmox-ca.pem \
  --tls-cert /root/proxmox-cloudscape-install/fullchain.pem \
  --tls-key /root/proxmox-cloudscape-install/privkey.pem
```

`--app-origin`에는 경로, 쿼리, 마지막 `/` 없이 HTTPS 주소를 넣습니다. DNS 이름을 권장하며 IPv4를 쓴다면 그 IP가 UI 인증서의 SAN에 들어 있어야 합니다. 기본 443 이외의 포트는 이 설치 스크립트에서 지원하지 않습니다. `--proxmox-host`도 API 경로 없이 노드의 HTTPS origin을 넣습니다. 앱 계정이나 Proxmox root 비밀번호를 설치 명령에 적지 않습니다. 사용자는 접속 후 자신의 Proxmox 계정으로 로그인합니다.

설치는 OS와 실행 위치, 서비스 격리, 주소·인증서 등을 검사하고 필요한 패키지를 설치한 뒤 전용 비특권 계정으로 검사·의존성 감사·빌드를 실행합니다. UI 인증서는 만료까지 하루 이상 남아 있고 입력한 개인 키와 일치해야 합니다. Proxmox의 공개 `GET /api2/json/access/domains`에 연결하여 CA·호스트 이름과 로그인 영역 응답을 검증합니다. 새로 내려받는 Node.js와 Bun은 고정된 SHA-256과 비교합니다. `/usr/local/bin/node`에 Node.js 24가 이미 있으면 그 런타임을 사용하며, 다른 메이저 버전이면 설치를 중단합니다.

세션 비밀은 처음 설치할 때 자동으로 생성하며 화면에 출력하지 않습니다. 실행 코드는 root 소유로 배치하고 앱 서비스는 `proxmox-ui` 계정으로 실행합니다. 브라우저에서 접속할 주소는 앞서 지정한 `https://proxmox-ui.example.com`입니다.

| 설치 위치 | 용도 |
|---|---|
| `/opt/proxmox-cloudscape/releases/` | 설치된 앱 릴리스 |
| `/opt/proxmox-cloudscape/current` | 실행할 릴리스 링크 |
| `/opt/proxmox-cloudscape/previous` | 이전 릴리스가 있을 때 복구용 링크 |
| `/etc/proxmox-cloudscape/environment` | Proxmox 주소·UI origin·세션 비밀 등, root 전용 |
| `/etc/proxmox-cloudscape/proxmox-ca.pem` | 앱의 Proxmox TLS 검증용 공개 CA |
| `/etc/ssl/proxmox-cloudscape/` | UI TLS 인증서와 개인 키 |
| `/etc/nginx/sites-available/proxmox-cloudscape` | 앱의 Nginx 사이트 |
| `/etc/systemd/system/proxmox-cloudscape.service` | 앱의 systemd 서비스 |

## 7. 설치 후 확인

**LXC 내부**에서 확인합니다.

```bash
systemctl is-active proxmox-cloudscape nginx
systemctl status proxmox-cloudscape nginx --no-pager
nginx -t
curl --fail http://127.0.0.1:3000/api/health
journalctl -u proxmox-cloudscape -n 100 --no-pager
ss -ltnp
```

앱과 Nginx가 `active`이고 상태 요청이 `{"status":"ok"}`를 반환해야 합니다. 3000 포트가 `127.0.0.1`에만 열렸는지 확인합니다. 상태 요청은 **앱 프로세스의 준비 상태**만 확인하며 Proxmox 로그인과 권한 검사를 대신하지 않습니다.

설치기의 최종 HTTPS 상태 검사는 제공한 인증서를 신뢰해 로컬 응답을 확인하므로, 관리 브라우저의 CA 신뢰와 전체 인증서 체인 검증을 대신하지 않습니다.

Proxmox 연결에서 TLS 오류가 나면 LXC 안에서 호스트 이름과 CA를 검증합니다.

```bash
getent hosts pve.example.internal
openssl s_client -connect pve.example.internal:8006 \
  -servername pve.example.internal \
  -CAfile /etc/proxmox-cloudscape/proxmox-ca.pem \
  -verify_hostname pve.example.internal -verify_return_error </dev/null
```

인증서 검증이 성공해야 합니다. `NODE_TLS_REJECT_UNAUTHORIZED=0`이나 `curl -k`로 문제를 숨기지 말고 주소·SAN·CA 체인·만료를 바로잡으세요. Node의 CA 설정은 서비스가 시작되기 전에 적용됩니다. CA를 교체한 뒤에는 앱을 재시작해야 합니다.

**관리 컴퓨터의 브라우저**에서 UI 주소에 접속하여 다음을 확인합니다.

1. 인증서 경고 없이 로그인 화면이 열립니다.
2. Proxmox의 실제 사용자와 인증 영역으로 로그인합니다. `user@pve`는 사용자 이름 `user`, 인증 영역 `pve`로 나눠 입력합니다.
3. 노드 목록을 확인하고 허용된 VM/LXC 상세 화면과 콘솔에 접속합니다.
4. 권한 화면에서 시험용 역할·사용자·그룹·ACL을 설정하고 새 사용자로 허용·거부 동작을 확인합니다.

사용자·역할 생성과 TFA·SSO는 [공통 운영 안내 7~8절](installation.ko.md#7-첫-로그인과-사용자역할-생성)에 설명합니다. VM·백업·스토리지 등 실제 리소스를 변경하는 검증은 시험용 리소스에서 수행하세요. 설치만으로 모든 클러스터 조합의 호환성이 확인되지는 않습니다.

## 8. 업데이트와 복구

반복 업데이트는 [GitHub Actions 자동 배포](automatic-deployment.ko.md)를 사용할 수 있습니다. 한 번 설정하면 GitHub에서 검사·빌드하고 LXC가 성공한 최신 커밋을 받아 설치합니다. 아래는 자동 배포를 사용하지 않을 때의 수동 절차입니다.

업데이트 전에 LXC의 백업과 복구 절차를 준비합니다. 이 앱의 릴리스 복구는 Proxmox에 이미 실행한 VM·네트워크·스토리지 변경을 되돌리지 않습니다. 업로드·콘솔 세션은 앱 재시작 중 끊길 수 있으므로 사용 중인 작업을 먼저 확인하세요.

새 소스로 3절의 아카이브를 다시 만들고 5~6절처럼 **새 소스 디렉터리**에 풉니다. 기존 소스 위에 풀면 제거된 파일이 남을 수 있습니다. 같은 주소와 인증서 경로를 지정하여 `deploy/install-lxc.sh`를 다시 실행하면 검사와 빌드 후 새 릴리스를 설치합니다. 기존 환경 파일과 세션 비밀은 보존되고 직전 릴리스는 `previous`로 남습니다. 따라서 아직 유효한 기존 세션을 다시 읽을 수 있습니다. 기존 환경 파일과 명령의 Proxmox 주소 또는 UI origin이 다르면 설치가 중단되므로 주소 변경은 환경 파일·DNS·인증서·Nginx 설정을 함께 검토한 후 진행하세요.

코드만 업데이트한다면 설치된 인증서 경로를 그대로 사용할 수 있습니다. 새 소스를 푼 디렉터리에서 실행합니다.

```bash
bash deploy/install-lxc.sh \
  --proxmox-host https://pve.example.internal:8006 \
  --app-origin https://proxmox-ui.example.com \
  --proxmox-ca /etc/proxmox-cloudscape/proxmox-ca.pem \
  --tls-cert /etc/ssl/proxmox-cloudscape/fullchain.pem \
  --tls-key /etc/ssl/proxmox-cloudscape/privkey.pem
```

릴리스 전환 이후 상태 검사에 실패하면 설치 스크립트가 이전 앱 링크와 서비스 설정 복원을 시도합니다. OS 패키지와 새로 설치한 도구까지 되돌리는 기능은 아니므로 실패 메시지 뒤에는 실제 서비스 상태를 확인해야 합니다.

설치 뒤 7절의 서비스·로그인·콘솔 확인을 반복합니다. 이전 릴리스가 있는 경우 다음 명령으로 앱 코드를 복구할 수 있습니다. **LXC 내부 root 셸**에서 실행합니다.

```bash
ROLLBACK_DIR=$(readlink -f /opt/proxmox-cloudscape/previous)
if [[ -d "$ROLLBACK_DIR" && "$ROLLBACK_DIR" == /opt/proxmox-cloudscape/releases/* ]]; then
  systemctl stop proxmox-cloudscape &&
    ln -sfn "$ROLLBACK_DIR" /opt/proxmox-cloudscape/current &&
    systemctl start proxmox-cloudscape &&
    curl --fail --retry 10 --retry-connrefused --retry-delay 2 \
      http://127.0.0.1:3000/api/health
else
  printf '%s\n' '유효한 이전 릴리스가 없어 복구를 중단했습니다.' >&2
fi
```

이 복구는 앱 릴리스만 바꿉니다. OS 패키지, Node.js, Nginx 설정, 인증서와 환경 파일도 변경했다면 변경 전 백업 또는 LXC 백업에서 함께 복원해야 할 수 있습니다. `current`·`previous`가 가리키는 릴리스를 삭제하지 마세요.

이전 릴리스와 설치 실패 중 생성된 릴리스 디렉터리는 자동 삭제되지 않습니다. 디스크 사용량을 점검하고, 실행·복구 링크의 대상과 보관할 백업을 확인한 뒤 불필요한 릴리스만 정리하세요.

백업에는 최소한 LXC 구성과 루트 디스크, `/etc/proxmox-cloudscape`, `/etc/ssl/proxmox-cloudscape`, Nginx 사이트, 앱 릴리스가 포함돼야 합니다. 백업에는 세션 비밀과 UI 개인 키가 있으므로 접근 권한과 보관 위치를 제한합니다. 소스 패키지에는 이 파일들이 포함되지 않습니다.

## 9. 인증서 갱신과 운영 점검

UI 인증서 갱신 도구가 새 파일을 발급한 뒤 `/etc/ssl/proxmox-cloudscape/fullchain.pem`과 `privkey.pem`을 갱신하고 `nginx -t` 성공 후 Nginx를 다시 읽게 해야 합니다. 개인 키는 root 소유, `0600`을 유지합니다. 설치 시 전달한 파일을 복사해서 쓰므로 원본 인증서만 갱신해도 서비스 파일이 자동으로 바뀌지는 않습니다.

```bash
install -m 0644 /path/to/renewed/fullchain.pem \
  /etc/ssl/proxmox-cloudscape/fullchain.pem
install -m 0600 /path/to/renewed/privkey.pem \
  /etc/ssl/proxmox-cloudscape/privkey.pem
nginx -t && systemctl reload nginx
```

Proxmox CA를 변경했다면 새 공개 CA 묶음을 `/etc/proxmox-cloudscape/proxmox-ca.pem`에 설치하고 `systemctl restart proxmox-cloudscape`를 실행합니다. UI 주소를 바꾸면 환경 파일·Nginx·DNS·서버 인증서와 필요한 OIDC/WebAuthn 설정도 함께 맞춰야 합니다.

앱 상태, 인증서 만료, CT 디스크·메모리, Proxmox 접속 실패와 실제 작업 실패를 각각 모니터링합니다. 브라우저의 작업 알림은 열린 세션에서 추적하므로 브라우저를 닫았다면 작업 로그 화면에서 최종 상태를 확인합니다.

기존 Node.js 24는 설치 스크립트를 다시 실행해도 자동으로 패치 버전이 갱신되지 않습니다. Node.js·Bun·OS의 보안 업데이트를 별도로 점검하고, 런타임을 변경한 뒤 서비스 재시작과 접속 검사를 수행하세요.

## 10. 문제 해결

| 증상 | 확인과 조치 |
|---|---|
| LXC가 아니라는 설치 오류 | Proxmox 호스트가 아닌 새 CT 안에서 실행했는지 확인합니다. `pct enter CTID`로 진입합니다. |
| 서비스 격리 검사 실패, `226/NAMESPACE` | 비특권 모드를 유지한 채 Nesting을 켜고 CT를 완전히 종료·시작합니다. 이미 켜져 있다면 CT AppArmor·마운트 제한과 게스트 로그를 확인합니다. |
| Debian 버전 오류 | Debian 13 또는 12 표준 LXC인지 `/etc/os-release`로 확인합니다. |
| 패키지 다운로드 실패 | DNS, 게이트웨이, 외부 저장소 접근, 시간과 CA 신뢰를 확인합니다. |
| 빌드 중 `Killed`, 종료 코드 137 | CT/호스트 메모리 부족과 OOM 기록을 확인합니다. RAM·유효한 스왑 또는 빌드 여유 공간을 늘린 뒤 재시도합니다. |
| 브라우저 인증서 경고 | UI DNS 이름, UI 인증서 SAN·전체 체인·만료, 관리 컴퓨터의 조직 CA 신뢰를 확인합니다. |
| 로그인에서 Proxmox TLS 오류 | Proxmox 주소, 공개 CA, SAN, LXC → 노드 8006 연결을 검사합니다. |
| Nginx 502 | `systemctl status proxmox-cloudscape`, 앱 로그, 루프백 `/api/health`를 확인합니다. |
| 로그인 또는 변경 작업 403 | 실제 접속 origin과 `APP_ORIGIN`, Nginx Host, Proxmox 사용자 ACL을 확인합니다. |
| 특정 목록만 403 | 해당 사용자가 API를 조회할 권한이 있는지 확인합니다. |
| 콘솔 연결 실패 | VM 상태, 콘솔 권한, Nginx WebSocket 중계와 Proxmox TLS를 확인합니다. |
| 업로드 413 또는 504 | Nginx 업로드 크기·시간 제한, 앱 업로드 제한, 저장소 여유 공간을 확인합니다. |

자세한 기능 검증 범위와 실제 클러스터에서 확인할 항목은 [검사 보고서](api-coverage-and-audit.md), VM·수동 설치와 공통 운영은 [별도 설치 안내](installation.ko.md)에 정리돼 있습니다.

## 11. 개발 컴퓨터에서 설치 절차 검사하기

Docker와 Bun이 있는 개발 컴퓨터의 원본 프로젝트에서 실행합니다. 이 검사는 실제 Proxmox 호스트나 운영 LXC에 연결하지 않습니다.

```bash
bun run package:source
LXC_TEST_DEBIAN_VERSION=12 bash scripts/check-lxc-install.sh
LXC_TEST_DEBIAN_VERSION=13 bash scripts/check-lxc-install.sh
```

`LXC_TEST_DEBIAN_VERSION`은 `12` 또는 `13`을 지정하며 생략하면 `13`입니다. CI도 Debian 12·13 매트릭스로 구성돼 있습니다. 검사는 일회용 컨테이너에서 런타임 다운로드·검사·빌드·Nginx HTTPS 설치와 업데이트 실패 복구를 다룹니다. LXC 감지와 systemd 실행은 대체하므로 실제 LXC의 커널·AppArmor·서비스 격리 검증은 별도로 필요합니다.
