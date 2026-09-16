# 설치와 릴리스 배포

## 사용자: 빌드 없이 설치

대상은 FreeLens 1.10.2, Windows PowerShell 5.1, Linux Kubernetes Node입니다.
FreeLens와 클러스터 인증, kubectl 및 README의 Kubernetes 권한은 필요하지만,
사용자 PC에서 Node.js/pnpm 설치나 소스 빌드는 필요하지 않습니다.

1. [Releases](https://github.com/h-ingi/freelens-exec-node-shell/releases)를 엽니다.
2. 원하는 버전의 Assets에서 `h-ingi-freelens-exec-node-shell-<버전>.tgz`를 받습니다.
3. FreeLens **Extensions** 화면에 `.tgz`를 드래그하거나 파일의 로컬 경로를 입력하여 설치합니다.
4. 활성화를 확인하고 Node 우클릭 메뉴의 **Exec Node Shell**을 실행합니다.

`.tgz`는 압축을 풀지 않습니다. GitHub가 자동 제공하는 `Source code (zip)`과
`Source code (tar.gz)`는 소스 코드이므로 설치에 사용하지 않습니다.
`1.10.3-7`처럼 하이픈이 포함된 버전은 Pre-release로 게시됩니다.
시험 버전은 전체 Releases 목록에서 찾으세요. 정식 버전용 latest 링크에는 나타나지 않을 수 있습니다.

### 다운로드 파일 확인

같은 Assets에서 `.tgz.sha256`도 다운로드합니다. PowerShell에서 파일 이름을 실제 버전으로 바꾸어 실행합니다.

```powershell
Get-FileHash .\h-ingi-freelens-exec-node-shell-1.10.3-7.tgz -Algorithm SHA256
Get-Content .\h-ingi-freelens-exec-node-shell-1.10.3-7.tgz.sha256
```

두 SHA-256 값이 대소문자 차이를 제외하고 일치해야 합니다.
`sbom.spdx.json`은 구성요소 목록이며 설치할 파일은 아닙니다.

### 업데이트와 이전 버전 복구

활성 Node Shell 세션을 먼저 종료하고 새 버전의 `.tgz`를 설치합니다.
이전 코드가 계속 보이면 Extensions에서 기존 확장을 삭제한 뒤 FreeLens를 재시작하고 재설치합니다.
문제가 생기면 Releases에서 이전 버전 `.tgz`를 받아 같은 방식으로 설치합니다.
재설치 전에 변경한 설정 값을 기록하고 설치 후 확인하세요.

## 릴리스 전 시험용 파일

PR 생성·업데이트와 수동 실행은 공개 Release를 만들지 않고 패키지를 Artifact로 보관합니다.

1. 저장소의 **Actions → Release packages**에서 대상 브랜치/커밋의 성공한 실행을 선택합니다.
2. **Artifacts**의 `node-shell-<버전>-<실행 ID>`를 다운로드합니다. GitHub 로그인이 필요할 수 있습니다.
3. 다운로드한 바깥쪽 ZIP만 풀고, 안의 `.tgz`를 FreeLens에 설치합니다.

Artifact 보관 기간은 30일입니다. 만료되면 워크플로를 다시 실행합니다.
수동 실행은 워크플로가 기본 브랜치에 반영된 뒤 **Run workflow**에서 대상 브랜치를 선택합니다.
시험용 패키지는 해당 실행의 커밋을 확인하여 사용하고, 정식 배포 파일은 Releases에서 받습니다.

## 관리자: 버전 배포

[브랜치 운영 안내](branches.ko.md)의 순서대로 단계별 PR을 최종 #1까지 검토·병합한 뒤,
실제 Windows FreeLens 환경의 README 테스트 항목을 확인합니다.
자동 단위 테스트 통과만으로 GUI/EKS 동작 검증이 끝나는 것은 아닙니다.

1. 배포할 커밋에 `package.json` 버전을 확정하고 변경을 main에 반영합니다.
2. 최신 main에서 버전과 정확히 같은 `v<버전>` 태그를 만들고 원격에 push합니다.

```sh
git switch main
git pull --ff-only origin main
git tag v1.10.3-7
git push origin v1.10.3-7
```

위 버전은 예시입니다. 이미 사용한 태그를 덮어쓰지 말고 새 버전을 사용합니다.
태그와 `package.json` 버전이 다르면 패키지 게시 전에 실패합니다.

3. **Actions → Release packages**에서 build와 publish 성공을 확인합니다.
4. Releases의 `.tgz`, `.tgz.sha256`, `sbom.spdx.json`, `sbom.spdx.json.sha256`을 확인합니다.
5. 내려받은 `.tgz`의 설치와 Node Shell 실행을 확인합니다.

### 자동화 구성과 권한

- build: 저장소 지정 Node.js/pnpm → frozen lockfile 설치 → 타입 검사 → 단위 테스트 → production 빌드 → pack → SBOM/체크섬 → Artifact.
- publish: 태그 push에서만 실행하며 Artifact 체크섬 검증 후 GitHub Release에 업로드합니다.
- PR/수동 빌드는 `contents: read`, 태그 게시 작업만 `contents: write`를 사용합니다.
- npm publish는 실행하지 않습니다. `NPM_TOKEN`, npm Trusted Publishing, publishing Environment 설정은 필요하지 않습니다.
- 새 배포 경로는 GitHub Actions의 자동 `GITHUB_TOKEN`을 사용합니다. 별도의 `GH_TOKEN`은 필요하지 않습니다.
- 저장소/조직 정책에서 Actions 및 사용한 액션 실행과 게시 작업의 쓰기 권한을 허용해야 합니다.
- 기존 `Automated npm version` 및 태그 도우미는 선택적인 별도 도구입니다. 새 릴리스의 필수 단계가 아니며, Release 생성 후 자동 버전 PR도 실행하지 않습니다.

태그는 관리자 계정으로 push합니다. 다른 워크플로에서 기본 `GITHUB_TOKEN`으로 생성한 태그는
후속 push 워크플로를 시작하지 않으므로 이 절차와 혼용하지 않습니다.
실패 시 해당 Actions 실행의 오류를 확인하고 수정된 새 버전을 배포하세요.
네트워크 문제로만 실패했다면 같은 실행을 재실행할 수 있습니다.

참고: [FreeLens 확장 설치 예제](https://github.com/freelensapp/freelens-example-extension#install-built-extension),
[GitHub Actions 트리거](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
