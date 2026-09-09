# GitHub Actions → LXC 자동 배포

개발 컴퓨터에서 커밋을 **GitHub로 push**하면 `Validate` 워크플로가 검사·빌드·브라우저 테스트를 실행합니다. LXC는 기본 2분 간격으로 GitHub를 확인하고, 지정 브랜치의 **현재 최신 커밋**에 대한 전체 CI가 성공했을 때 해당 커밋의 저장소 소스와 Linux 빌드 결과를 받아 설치합니다. 최신 커밋이 검사 중이거나 실패했다면 기존 앱을 유지합니다.

LXC에 Docker나 GitHub Actions 실행기를 설치하지 않습니다. GitHub 쪽에서 LXC로 들어오는 SSH 연결도 필요하지 않습니다. LXC가 GitHub API·소스·아티팩트 다운로드 서버로 HTTPS 연결할 수 있어야 합니다. 로컬에서 `git commit`만 하고 push하지 않으면 CI는 시작되지 않습니다.

## 1. 한 번만 준비하기

현재 지원 대상은 **amd64 Debian 12·13 LXC + Node.js 24**입니다. [LXC 설치 안내](installation-lxc.ko.md)를 따라 기존 앱·Nginx·인증서·환경 파일이 먼저 구성돼 있어야 합니다. 기존 최초 설치기는 한 번 LXC에서 빌드합니다. 자동 업데이트를 켠 이후의 앱 변경은 CI에서 빌드하며 LXC에서 의존성 설치·테스트·빌드를 반복하지 않습니다.

이 문서와 함께 추가된 다음 파일을 저장소에 커밋하고 push합니다.

- `.github/workflows/ci.yml`의 런타임 패키징·업로드 단계
- `scripts/package-runtime.sh`
- `deploy/pull-update.py`, `deploy/enable-auto-update.sh`
- `deploy/proxmox-cloudscape-update.service`, `deploy/proxmox-cloudscape-update.timer`
- 기존 배포 파일 및 Python 회귀 테스트

현재 로컬의 다른 기능 수정도 실제로 배포하려면 함께 검토하고 커밋해야 합니다. 자동 배포기는 GitHub에 없는 로컬 변경을 가져올 수 없습니다.

GitHub 저장소 **Settings → Actions → General**에서 Actions 실행을 허용합니다. 외부 action 허용 목록을 쓰는 조직은 워크플로의 checkout·setup-node·setup-bun·upload-artifact도 허용해야 합니다. 기본 배포 브랜치는 `main`이며 설정 시 바꿀 수 있습니다. PR에도 CI는 실행되지만 PR 빌드는 자동 배포하지 않습니다. `main`에는 브랜치 보호와 PR 검토를 설정하는 것을 권장합니다.

## 2. LXC용 읽기 토큰 만들기

GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens**에서 토큰을 만듭니다.

1. Resource owner를 대상 저장소 소유자로 선택합니다.
2. Repository access는 배포할 저장소 하나만 선택합니다.
3. Repository permissions에서 **Contents: Read-only**, **Actions: Read-only**를 지정합니다. Metadata 읽기는 기본 권한입니다.
4. 만료일을 정하고, 조직 승인이 필요하면 승인받습니다.

토큰은 **LXC에만 저장**합니다. GitHub Secrets에 LXC 비밀번호나 SSH 키를 넣을 필요가 없습니다. 공개 저장소여도 아티팩트 다운로드를 위해 이 토큰을 설정합니다. 읽기 토큰은 Actions 실행·저장소 쓰기 권한을 요구하지 않습니다. [GitHub 아티팩트 API 권한](https://docs.github.com/en/rest/actions/artifacts#download-an-artifact)

## 3. LXC에서 자동 업데이트 켜기

새 배포 파일이 포함된 소스를 LXC에 전달합니다. 기존 [소스 패키지 전달 절차](installation-lxc.ko.md#3-현재-소스를-proxmox-호스트로-전달하기)를 이용하거나, 공개 저장소라면 **LXC 내부**에서 다음처럼 받습니다.

```bash
git clone https://github.com/luvxxxu/proxmox-cloudscape-ui.git /root/proxmox-cloudscape-auto-setup
cd /root/proxmox-cloudscape-auto-setup
bash deploy/enable-auto-update.sh
```

이미 있는 디렉터리를 덮어쓰지 말고 새 경로를 사용합니다. 비공개 저장소에는 읽기 권한이 있는 방법으로 소스를 전달하되 URL에 토큰을 넣지 마세요. root 셸에서 스크립트를 실행하면 저장소 이름, 배포 브랜치, 토큰을 입력받습니다. 토큰 입력은 화면에 표시되지 않습니다.

설정기는 저장소와 워크플로 접근을 확인한 뒤 `/etc/proxmox-cloudscape/auto-update.json`을 root 전용 `0600`으로 저장하고 타이머를 켭니다. 먼저 이 변경을 GitHub에 push해야 `ci.yml` 접근 확인이 성공합니다. 앱의 기존 환경 파일·세션 비밀·인증서·Nginx 설정은 보존합니다.

즉시 한 번 확인하려면:

```bash
systemctl start proxmox-cloudscape-update.service
journalctl -u proxmox-cloudscape-update -n 100 --no-pager
systemctl list-timers proxmox-cloudscape-update.timer
```

CI가 아직 완료되지 않았다면 현재 앱을 유지하며 다음 확인 때 다시 조회합니다. 로그에 `Deployed commit ...`이 표시되면 배포된 커밋을 확인합니다.

```bash
cat /opt/proxmox-cloudscape/current/release.json
systemctl status proxmox-cloudscape --no-pager
curl --fail http://127.0.0.1:3000/api/health
```

브라우저에서도 HTTPS 로그인과 주요 기능을 확인합니다. 자동 배포의 상태 검사는 앱 기동 확인이며 실제 Proxmox 로그인·리소스 작업 검증을 대신하지 않습니다.

## 4. 이후 코드 수정 흐름

개발 컴퓨터에서 변경을 검토하고 커밋한 뒤 배포 브랜치로 push합니다. 브랜치 보호를 쓴다면 PR을 병합합니다.

```text
push → 전체 CI 검사 → 테스트한 Docker 이미지에서 실행 파일 추출
     → GitHub 아티팩트 업로드 → 전체 워크플로 성공
     → LXC의 다음 확인 → 같은 커밋의 소스·빌드 다운로드
     → 체크섬·커밋·플랫폼 검증 → 릴리스 전환 → 앱 상태 확인
```

전체 CI 시간에 약 2분과 최대 20초의 확인 간격이 더해집니다. 앱 재시작 중 요청·콘솔 연결이 끊길 수 있으며 무중단 배포는 아닙니다. 빌드에는 런타임용 의존성만 포함합니다. 소스는 같은 릴리스의 `source.tar.gz`에 root 전용으로 보관하며 소스 안의 설치 스크립트를 root로 실행하지 않습니다.

배포 중 브랜치가 바뀌면 설치를 미루고 다음 확인에서 새 최신 커밋의 CI 결과를 확인합니다. 다운로드 실패·체크섬 불일치·CI 실패에서는 기존 앱을 유지합니다. 기동 실패 시 이전 current/previous 링크와 서비스 파일을 복원하고 이전 앱을 다시 시작합니다. 회복 실패는 서비스 실패 상태와 로그에 남습니다.

## 5. 중지·수동 복구·설정 갱신

```bash
systemctl disable --now proxmox-cloudscape-update.timer
# 이미 실행 중인 배포가 있다면 종료될 때까지 상태를 확인합니다.
systemctl status proxmox-cloudscape-update.service --no-pager
```

타이머 중지는 이미 시작된 배포를 강제 중단하지 않습니다. 실행 중인 배포가 종료된 뒤 [수동 릴리스 복구](installation-lxc.ko.md#8-업데이트와-복구)를 수행합니다. 타이머를 켜둔 채 수동 복구하면 최신 성공 커밋이 다시 배포됩니다. 이전 커밋으로 계속 운영하려면 문제 변경을 revert하여 새 커밋으로 push하는 방법도 있습니다.

토큰 갱신·저장소·브랜치 변경은 타이머를 멈춘 뒤 신뢰하는 최신 소스에서 `enable-auto-update.sh`를 다시 실행합니다. 배포기 자체와 systemd 기본 보안 설정은 자동으로 교체하지 않습니다. 해당 파일 변경도 같은 재설정 절차로 반영합니다. OS·Node.js·UI 인증서 갱신은 별도 운영 작업입니다.

아티팩트 보관 기간은 30일입니다. 최신 커밋의 아티팩트가 만료됐다면 새 커밋을 push해 다시 빌드합니다. 이전·실패 릴리스는 자동 삭제하지 않으므로 디스크를 점검하고 current/previous 대상과 보관할 백업을 제외한 릴리스를 정리하세요. 빌드 캐시가 필요 없어도 현재·이전 실행 파일과 다운로드·전개 중인 파일 공간은 필요합니다.

## 6. 검증과 제한

Python 회귀 검사는 다른 저장소·브랜치·커밋·PR·실패 CI 거부, 다운로드 리다이렉트의 토큰 제거, 아티팩트 무결성, 압축 경로 탈출 차단, 브랜치 변경 감지와 실패 복구를 다룹니다.

2026-09-09 로컬 검증에서 Python 회귀 테스트 8개가 통과했습니다. 기존에 검증한 Linux amd64 운영 이미지의 실행 파일을 실제로 추출하고, 일회용 Debian 12에서 압축 해제·Node.js 기동·상태 확인·재설치·설정 보존·시작 실패 후 복구까지 통과했습니다. 이 검사에서는 systemd 실행 명령을 대체했으며, 실제 GitHub API는 오프라인 응답으로 검증했습니다. 셸 검사와 systemd 서비스·타이머 구문 검사도 통과했습니다.

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

실제 GitHub 원격 워크플로와 사용자의 LXC를 연결한 종단 검증은 설정 이후 필요합니다. 이 변경만으로 저장소에 push하거나 LXC에 토큰·타이머를 원격 등록하지는 않습니다. GitHub에서 Actions 결과와 LXC 로그를 함께 확인하세요. [워크플로 실행 API](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow)
