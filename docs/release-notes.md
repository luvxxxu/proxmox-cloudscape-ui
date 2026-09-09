VM 생성 등 본문이 있는 API 요청에서 발생하던 `chunked transfer encoding not supported` 오류를 수정했습니다.

- 요청 본문의 Content-Length를 유지해 VM·컨테이너·유저·역할 생성과 설정 변경을 Proxmox가 지원하는 방식으로 전송합니다.
- 파일 업로드는 Content-Length를 유지하면서 스트리밍합니다. 길이가 없는 작은 요청은 최대 1 MiB까지만 버퍼링해 실제 바이트 길이를 계산합니다. 이를 넘는 요청은 Content-Length를 요구하는 오류로 중단합니다.
- 실제 HTTP 통신 회귀 테스트를 추가하고 브라우저 테스트 서버도 Proxmox처럼 chunked 요청을 거부하도록 수정했습니다.

기존 공개 안정 버전 자동 업데이트가 활성화된 설치는 새 릴리스를 자동으로 받습니다. 즉시 확인하려면 앱 LXC에서 `systemctl start proxmox-cloudscape-update.service`를 실행하세요. GitHub 계정이나 PAT는 필요하지 않습니다.

설치 안내: https://github.com/luvxxxu/proxmox-cloudscape-ui/blob/main/docs/quick-install-caddy.ko.md
