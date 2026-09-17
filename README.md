# FreeLens Exec Node Shell

FreeLens 본체를 수정하지 않고 `pods/exec`로 Linux Node shell에 접속하는 Extension입니다.
Node 우클릭 메뉴에서 **Exec Node Shell**을 선택합니다.

대상 환경: **FreeLens 1.10.2 / Windows PowerShell 5.1 / Linux Kubernetes Node**.
개발 의존성 `@freelensapp/extensions`는 1.10.2에 고정했습니다.
현재 터미널 명령 생성기는 PowerShell용이며 bash/zsh 로컬 터미널은 지원하지 않습니다.
Node 내부 shell은 `/bin/sh`입니다.

## 동작

1. SelfSubjectAccessReview로 대상 namespace의 RBAC를 확인합니다.
2. 선택한 Node에 임시 privileged Pod를 생성합니다.
3. Pod Ready를 API로 최대 120초 대기합니다. `kubectl wait`는 사용하지 않습니다.
4. 터미널 shell 준비를 최대 30초 대기합니다.
5. `kubectl exec`와 `nsenter`로 Node namespace에 진입합니다.
6. 정상 종료, 터미널 X, 연결 실패, 제한시간 도달 시 Pod를 정리합니다.

`pods/attach` 권한을 추가하거나 사용하지 않습니다.
단, **privileged Pod와 host namespace를 사용하므로 사실상 Node 관리자 접근**입니다.
attach 권한이 필요 없다는 뜻이지, Node 접근 자체의 권한이 낮아진다는 뜻은 아닙니다.
RBAC가 허용돼도 Pod Security Admission 등의 admission 정책은 Pod 생성을 거부할 수 있습니다.
Extension은 해당 정책을 변경하지 않습니다.

## 기능

- 정상 `exit`: 원격 종료 표식으로 keep-alive를 종료하고 터미널 finally와 API 감시가 삭제합니다.
- 터미널 X: terminal store에서 연결이 제거되면 API로 삭제합니다.
- 실패 및 timeout: Pod Ready 120초, terminal ready 30초, 세션 기본 60분입니다.
- exec가 실제로 시작되지 않으면 컨테이너는 180초 후 종료하여 API 정리 대상으로 전환됩니다.
- 삭제 실패: 실행 중 2초 간격으로 재시도합니다. 404는 이미 삭제된 것으로 처리합니다.
- Preferences: namespace, image, timeout, Pod prefix를 저장합니다. main의 저장 응답을 확인한 뒤 완료 문구를 표시하며, 새 세션은 main에서 최신 설정을 읽어 적용합니다.
- **Node Shell Sessions**: Node/Pod, namespace, 상태, 시작 시각, 경과 시간, Stop을 표시합니다.
- **Refresh / check permissions**: RBAC 표와 기존 Pod를 조회합니다. 발견한 Pod는 확인 후 Delete할 수 있습니다.
- 시작 시 및 60초마다 종료/만료된 orphan Pod를 점검합니다.

`Terminal open`은 명령을 터미널에 전달한 상태이며 Node shell 접속 성공을 검증한 상태는 아닙니다.
Pod 목록과 RBAC 결과는 Refresh로 갱신하고 로컬 세션과 경과 시간은 자동 갱신합니다.

## Kubernetes 권한

| API / 리소스                                    | 동작   | 용도                                    |
| ----------------------------------------------- | ------ | --------------------------------------- |
| `selfsubjectaccessreviews.authorization.k8s.io` | create | 실행 전 RBAC 진단                       |
| `pods`                                          | create | 임시 Pod 생성                           |
| `pods`                                          | get    | Ready 및 종료 상태 확인                 |
| `pods`                                          | delete | 세션 Pod 정리                           |
| `pods/exec`                                     | create | Node shell 접속                         |
| `pods/attach`                                   | create | 비교 진단만 수행. 실행 조건이 아님      |
| `pods`                                          | list   | 선택 기능: 기존 Pod 목록 및 orphan 정리 |

필수 권한이 거부되거나 진단 결과가 불명확하면 Pod를 만들지 않습니다.
`pods/list`가 없어도 현재 실행한 세션은 이름으로 get/delete할 수 있습니다.
`pods/watch`, `pods/patch`, Secret 조회 권한은 이 구현이 요구하지 않습니다.
ServiceAccount token 자동 마운트도 사용하지 않습니다.

## 강제 종료와 orphan

FreeLens를 강제 종료하면 Extension도 종료되므로 즉시 삭제를 보장할 수 없습니다.
`activeDeadlineSeconds`는 kubelet이 실행 시간을 제한하는 장치이며,
**일반 Pod 오브젝트를 삭제하는 TTL은 아닙니다.** Node가 응답하지 않으면 종료도 지연될 수 있습니다.

다음 활성화 및 주기 점검에서는 다음 조건만 자동 삭제합니다.

- `app.kubernetes.io/name=freelens-exec-node-shell` 라벨이 일치함
- `Succeeded` 또는 `Failed`이거나, 생성 시각 + deadline + 60초를 지남
- 현재 창에서 관리하는 활성 세션이 아님

다른 창이나 사용자가 연 아직 만료되지 않은 세션은 자동 삭제하지 않습니다.
현재 설정과 설정 이력에 저장된 namespace만 조회합니다.
`pods/list` 또는 `pods/delete`가 거부되거나 클러스터에 연결할 수 없으면 orphan은 남을 수 있습니다.
FreeLens를 다시 열지 않아도 서버에서 삭제해야 한다면 별도 서버 측 정리 구성요소가 필요합니다.
이 Extension은 그런 구성요소를 설치하지 않습니다.

## 다운로드하여 설치

일반 사용자는 Node.js나 pnpm을 설치하거나 직접 빌드할 필요가 없습니다.

1. [GitHub Releases](https://github.com/h-ingi/freelens-exec-node-shell/releases)에서 사용할 버전을 엽니다. 시험 버전은 **Pre-release**로 표시됩니다.
2. **Assets**에서 `h-ingi-freelens-exec-node-shell-<버전>.tgz`를 다운로드합니다.
3. FreeLens의 **Extensions** 화면에서 파일을 드래그하거나 로컬 파일 경로로 설치합니다. `.tgz`는 풀지 않습니다.
4. Extension 활성화를 확인한 뒤 Node 우클릭 → **Exec Node Shell**을 선택합니다.

GitHub의 `Source code (zip)` / `Source code (tar.gz)`는 설치 패키지가 아닙니다.
릴리스가 아직 없으면 Actions의 성공한 **Release packages** 실행에서 시험용 패키지를 받을 수 있습니다.
파일 검증, 업데이트, 시험 패키지 다운로드 및 관리자 배포 절차는 [배포 안내](docs/releases.ko.md)를 참고하세요.

## 개발자용 빌드

Node.js 22 이상과 프로젝트 지정 pnpm 10을 사용합니다.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm type:check
pnpm test:unit
pnpm build
pnpm pack
```

생성된 `.tgz`를 FreeLens Extensions 화면에 설치합니다.
개발 버전을 올려 다시 패키징하려면 `pnpm pack:dev`를 사용합니다.
반영되지 않으면 기존 Extension 삭제 후 FreeLens를 재실행하고 새 `.tgz`를 설치합니다.
`.tgz`, `out/`, `node_modules/`는 Git에 저장하지 않습니다.

## 실제 환경 테스트

회사 자격증명을 저장소나 Codespaces에 복사하지 마세요.
FreeLens가 이미 인증된 테스트 클러스터에서 확인합니다.

| 시나리오               | 예상 결과                               |
| ---------------------- | --------------------------------------- |
| attach 거부, exec 허용 | Node shell 접속 가능                    |
| shell에서 exit         | Pod 삭제, 로컬 세션 Closed              |
| 터미널 X               | Pod 삭제                                |
| 잘못된 image           | Ready timeout 후 Pod 삭제               |
| 터미널 준비 실패       | 30초 후 Pod 정리                        |
| timeout 1분            | Pod 종료 및 삭제                        |
| 일시적 삭제 실패       | 오류 표시 후 재시도                     |
| 강제 종료 후 재시작    | 만료된 Pod 정리, 아직 활성인 Pod 유지   |
| pods/list 거부         | 로컬 세션 사용 가능, 목록/orphan만 실패 |
| 설정 변경 후 재시작    | 설정 유지                               |

FreeLens GUI / PowerShell 5.1 / EKS 검증은 단위 테스트와 별도로 수행해야 합니다.

## 구조

- `src/main/index.ts`: main process 설정 저장소 등록
- `src/common/store/node-shell-settings.ts`: 설정 검증 및 ExtensionStore
- `src/renderer/index.tsx`: 메뉴/Preferences/페이지 등록, lifecycle hook
- `src/renderer/menus/exec-node-shell-menu.tsx`: Node 메뉴
- `src/renderer/services/node-shell-service.ts`: RBAC부터 Pod/terminal 생성까지 orchestration
- `src/renderer/services/session-lifecycle.ts`: 종료 감지, timeout, 재시도, 중복 삭제 방지
- `src/renderer/services/cleanup-service.ts`: 세션 관리와 orphan 정리
- `src/renderer/services/rbac-service.ts`: SelfSubjectAccessReview
- `src/renderer/services/orphan-policy.ts`: 자동 정리 대상 판정
- `src/renderer/settings/preferences.tsx`: 설정 UI
- `src/renderer/pages/sessions-page.tsx`: 세션 관리 UI

졸업 프로젝트 설명은 [기술 설명](docs/architecture.ko.md)을 참고하세요.
기능별 브랜치, PR 검토 및 병합 순서는 [브랜치 운영 안내](docs/branches.ko.md)를 참고하세요.

## License

MIT. 기존 FreeLens example extension의 라이선스 및 저작권 고지를 유지합니다.
