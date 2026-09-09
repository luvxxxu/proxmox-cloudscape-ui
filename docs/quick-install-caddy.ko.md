# Caddy를 사용하는 LXC 자동 설치

Debian 12 또는 13 **amd64 비특권 컨테이너**를 생성하고, Options → Features → Nesting을 켠 뒤 시작합니다. 1~2코어·1~2GiB 메모리를 시작값으로 삼고 실제 사용량에 맞게 조절하세요. 최소 사양을 실측 보장하는 값은 아닙니다. LXC에서 빌드하지 않습니다. 고정 내부 IP 또는 DHCP 예약을 사용하세요.

이 설치는 **기존 별도 Caddy가 HTTPS를 처리하는 구성**입니다. 앱 컨테이너에서 인증서를 발급하거나 Mac에 CA를 등록할 필요가 없습니다. 앱·Nginx·systemd 설치는 자동이고, 다른 컨테이너의 Caddy 설정은 마지막에 출력되는 사이트 블록을 추가합니다. 외부 Caddy 설정과 DNS를 설치기가 임의로 변경하지 않습니다.

## 실행할 명령

Proxmox 웹 화면에서 **새 컨테이너 → Console**을 열고 root로 로그인합니다. 이미 노드 Shell에서 `pct enter 컨테이너ID`로 들어왔다면 그 화면에서 실행해도 됩니다. 프롬프트가 Proxmox 호스트 이름이 아니라 새 컨테이너 이름인지 확인하세요.

```bash
curl -fsSL https://github.com/luvxxxu/proxmox-cloudscape-ui/releases/latest/download/install.sh -o /root/cloudscape-install.sh && bash /root/cloudscape-install.sh
```

`curl: command not found`라면 먼저 아래 명령을 실행한 뒤 다시 시도합니다.

```bash
apt-get update && apt-get install -y curl ca-certificates
```

다운로드에 성공한 전체 파일만 실행하도록 `&&`를 사용합니다. `curl … | bash`로 실행해도 질문은 별도 터미널에서 읽으므로 입력이 섞이지 않습니다.

## 설치 중 입력하는 값

1. **기존 Proxmox 주소**: LXC에서 접근할 수 있는 실제 HTTPS 주소입니다. Caddy의 공인 인증서가 있는 도메인이면 CA 복사 없이 검사합니다. IP만 입력하면 `https://IP:8006`으로 보완합니다. 포트 전달이 다르면 실제 포트를 포함하세요. 브라우저의 `/#...` 부분은 제거합니다.
2. **새 UI 외부 도메인**: 예를 들어 `pve.lxvu.dev`를 입력하면 `https://pve.lxvu.dev`로 설정합니다. 기존 Proxmox와 같은 도메인·포트를 함께 사용할 수는 없습니다. 경로 하위 설치는 지원하지 않습니다.
3. **새 LXC 내부 IPv4**: 자동으로 제안합니다. 올바른 값이면 Enter를 누릅니다. 컨테이너에 실제로 할당된 주소인지 확인합니다.
4. **Caddy LXC 내부 IPv4**: Proxmox에서 Caddy 컨테이너 → Network에서 확인합니다. DHCP라면 Caddy 컨테이너 Console의 `ip -4 -brief address`로 확인합니다. NAT가 있으면 앱 LXC에서 보이는 실제 연결 원본 주소가 필요합니다.

예를 들어 외부 공인 IP가 하나라도 아래처럼 구성할 수 있습니다. 내부 주소는 설명용 예시입니다.

```text
외부 pve.lxvu.dev → 공인 IP → Caddy LXC 10.0.0.10
                                  → 앱 LXC 10.0.0.20:8080
                                       → 앱 127.0.0.1:3000
                                       → 기존 Proxmox HTTPS API
```

공인 IP는 서로 같아도 됩니다. **내부 연결 주소에 공인 IP를 복사해서 넣지는 않습니다.** Caddy와 앱 사이에는 신뢰할 수 있는 내부 네트워크를 사용합니다. 이 HTTP 연결을 인터넷으로 포트 전달하지 마세요. 외부 구간을 지나야 한다면 사설 VPN 또는 TLS를 사용하는 별도 구성이 필요합니다.

### Proxmox 인증서 검사에 실패하면

설치기는 먼저 운영체제의 공인 CA로 검사하고, 기존 `/root/proxmox-ca.pem`이 있으면 그 파일도 사용합니다. 실패하면 주소를 수정하거나 신뢰할 CA 파일 경로를 입력할 수 있습니다. TLS 검증을 끄거나 네트워크에서 받은 인증서를 무조건 신뢰하지 않습니다.

Proxmox 기본 사설 인증서를 사용하고 아직 CA를 복사하지 않았다면, **Proxmox 노드 → Shell**에서 한 번 실행합니다. `100`은 실제 앱 컨테이너 ID로 바꾸세요.

```bash
pct push 100 /etc/pve/pve-root-ca.pem /root/proxmox-ca.pem --perms 0644
```

이 단계도 피하려면 기존 Proxmox가 연결된 **공인 인증서의 Caddy 도메인**을 설치기에 입력하세요. 기본 CA로도 호스트 이름이 일치하지 않으면 인증서 SAN에 포함된 주소를 사용해야 합니다. NAT 내부에서 외부 주소에 접속할 수 없다면 내부 DNS나 라우팅도 맞춰야 합니다.

## 설치가 끝난 뒤 Caddy에 추가할 내용

설치기는 `/etc/proxmox-cloudscape/Caddyfile.example`을 생성하고 내용을 화면에 출력합니다. 생성된 값을 그대로 **Caddy LXC의 기존 Caddyfile 끝에 추가**하세요. 기존 Proxmox 사이트는 유지합니다.

예시:

```caddyfile
pve.lxvu.dev {
    reverse_proxy http://10.0.0.20:8080 {
        header_up Host pve.lxvu.dev
        flush_interval -1
    }
}
```

`pve.lxvu.dev`의 DNS는 Caddy로 들어오는 공인 IP를 가리켜야 합니다. Caddy가 systemd 서비스로 설치되어 있고 설정 경로가 `/etc/caddy/Caddyfile`인 경우, **Caddy LXC 안에서** 검사 후 반영합니다.

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy
```

Docker 등으로 운영하는 Caddy는 해당 환경의 설정 반영 절차를 사용합니다. Caddy는 WebSocket도 중계합니다. 기존 전역/사이트 로그 설정이 콘솔 티켓·OpenID 쿼리를 기록하지 않도록 확인하세요. [Caddy 공식 reverse_proxy 문서](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

방화벽이 활성화되어 있다면 Caddy LXC에서 앱 LXC의 TCP 8080으로 가는 연결을 허용합니다. 앱 앞의 Nginx도 지정한 Caddy IP와 로컬 점검 연결만 허용합니다. Node의 3000 포트는 루프백 전용입니다. 로그인 요청 제한은 Caddy의 연결 원본 IP를 기준으로 공유됩니다.

브라우저에서 `https://pve.lxvu.dev`로 접속합니다. Proxmox의 계정·비밀번호로 로그인하고 콘솔 연결도 확인하세요. 설치기가 검사하는 것은 내부 서비스까지이며, 다른 LXC의 Caddy와 실제 외부 접속 성공은 별도 확인이 필요합니다.

## 자동 업데이트

설치 마지막에 공개 안정 릴리스 자동 업데이트가 기본으로 켜집니다. **GitHub 계정·PAT 입력은 없습니다.** 앱과 Node는 CI에서 검사·빌드한 파일을 사용하며, LXC에서 Bun·테스트·빌드·취약점 조회를 실행하지 않습니다.

약 15분마다 새 안정 릴리스를 확인합니다. 새 버전의 시작/상태 검사에 실패하면 이전 앱과 Node로 복원합니다. 일반 코드 push는 CI 검사만 실행하고, 제작자가 버전 태그를 push해 릴리스를 게시하면 사용자에게 배포됩니다. [제작자 배포와 사용자 업데이트 안내](automatic-deployment.ko.md)를 참고하세요.

아직 공개 안정 릴리스가 없다면 설치는 중단됩니다. 원본 소스로 돌아가 빌드하거나 인증 검사를 생략하지 않습니다. 제작자의 첫 릴리스 검사가 끝나고 공개된 뒤 다시 실행하세요.

기존 외부 Caddy의 인증서 갱신은 Caddy가 담당합니다. Debian·Nginx·Caddy의 보안 업데이트는 별도로 관리해야 합니다.
