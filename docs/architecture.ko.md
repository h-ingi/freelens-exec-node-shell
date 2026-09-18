# 졸업 프로젝트 기술 설명

## 주제

**RBAC 제약 환경을 위한 exec 기반 Kubernetes Node Shell Extension**

기본 Node Shell의 `pods/attach` 의존성을 `pods/exec`로 대체하고,
운영에 필요한 임시 Pod lifecycle, 권한 진단, 설정, 세션 관리 기능을 구현합니다.
사용자는 이미 privileged Pod 생성과 Node 접근을 허용받은 운영자여야 합니다.
보안 권한 상승을 차단하거나 RBAC의 거부를 무력화하는 프로젝트는 아닙니다.

## 기존 MVP 분석

기준 커밋은 `707bd94`입니다. Node 메뉴, built-in podsApi.create, PowerShell exec가 구현되어 있었습니다.
첨부 설명과 달리 terminal 연결 감시와 finally 삭제도 이미 존재했습니다.

- 연결이 한 번도 성립하지 않으면 감시가 무기한 유지됨
- kubectl wait 실패 시 finally 미진입
- terminal 생성/send 실패 catch에서 Pod를 정리하지 않음
- delete 시도 전에 타이머를 해제해 실패 후 재시도하지 못함
- as any로 terminal API 타입을 우회함
- deadline 이후 Pod 오브젝트 삭제가 없음
- RBAC/설정/세션 페이지 미구현, README는 템플릿 내용

## API와 lifecycle

설치한 FreeLens 1.10.2의 타입 선언과 배포 renderer 코드를 확인했습니다.
`terminalStore.isConnected(tabId)`는 shell 준비가 아니라 connection map 존재 여부를 반환합니다.
따라서 별도로 `getTerminalApi(tabId)?.isReady`를 기다립니다.
탭 destroy 시 map에서 연결이 제거되는 동작을 종료 감지에 이용합니다.

Pod 생성은 기존에 동작한 `Renderer.K8sApi.podsApi.create`를 유지합니다.
이전에 실패했던 applyOnCluster로 되돌리지 않습니다.
RBAC는 활성 클러스터 ID를 확인하고, 클러스터 프레임의 인증·TLS 설정을 가진
FreeLens 요청 클라이언트로 `/apis/authorization.k8s.io/v1/selfsubjectaccessreviews`에 POST합니다.
FreeLens 1.10.x 호환 어댑터는 비등록 `KubeApi`의 내부 `request`를 사용합니다.
공개 생성자가 내부 객체를 반환하므로 `KubeApi`를 상속하지 않으며, `request.post`의 존재를 확인합니다.
이 내부 계약은 FreeLens 업데이트 시 다시 검증해야 합니다.

SelfSubjectAccessReview는 저장되는 리소스가 아니므로 응답에 `metadata.uid`, `name`,
`resourceVersion`이 없어도 정상입니다. 일반 `KubeApi.create()`의 리소스 파서는 이런 응답을
`null`로 바꾸므로, 권한 조회는 원본 응답의 `status.allowed`가 boolean인지 직접 검사합니다.
필수 권한의 `false`는 Denied, 누락·잘못된 타입·요청 실패는 Unknown으로 표시하고 실행을 차단합니다.
Unknown은 권한 부족이 확정되었다는 뜻이 아닙니다.

`1.10.3-10`에서는 설치된 FreeLens API 구현을 사용하는 회귀 테스트로 기존 파서의 응답 손실과
수정 경로를 검증했습니다. 타입 검사·자동 테스트·패키지 빌드 통과와 별개로,
Windows FreeLens에서 실제 클러스터에 연결하는 기능 검증은 필요합니다.

Ready polling으로 kubectl wait의 watch 의존성을 제거했습니다.
원격 wrapper는 nsenter가 종료되면 컨테이너에 `/tmp/exec-ended`를 만듭니다.
keep-alive가 이를 감지해 종료하므로 로컬 터미널이 열려 있어도 API로 감지합니다.
PowerShell finally도 삭제를 시도하며 중복 삭제의 404는 성공입니다.
exec 자체가 실패하고 로컬 delete까지 실패한 경우를 위해 컨테이너 시작 후 180초 동안
exec 시작 표식이 없으면 keep-alive를 종료하여 API 정리를 유도합니다.

Lifecycle은 cleanup 진행 중 중복 tick을 차단하고 삭제 성공 후에만 완료됩니다.
Ready/terminal 준비 실패에도 cleanup 소유자를 만들어 삭제 재시도를 유지합니다.
원래 클러스터가 활성인지 검사하여 다른 클러스터로 잘못 삭제 요청을 보내지 않습니다.
클러스터가 바뀌면 정리는 원래 클러스터가 다시 활성화될 때까지 대기할 수 있습니다.
터미널 명령에도 생성 당시 context 이름을 명시합니다.

## Orphan과 설정

Extension이 죽으면 타이머/finally의 실행을 보장할 수 없습니다.
서버의 실행 제한과 다음 활성화 시 오브젝트 정리를 분리합니다.
label 하나만 보고 모두 삭제하지 않고 phase 또는 deadline을 확인합니다.
발견한 Pod 삭제에는 UID precondition을 사용합니다.
pods/list는 확장 기능이며 로컬 단일 세션의 실행 조건은 아닙니다.

Common.Store.ExtensionStore는 main 프로세스에만 등록하여 설정 저장의 기준으로 사용합니다.
Preferences의 Save는 확장 전용 IPC로 main에 저장을 요청하고, 성공 응답 후에만 완료 문구를 표시합니다.
클러스터 renderer는 새 세션마다 main에서 최신 설정을 조회합니다. 조회 실패 시 생성하지 않습니다.
renderer의 이전 메모리 값이 main의 최신 설정을 덮어쓰지 않도록 renderer에서는 저장소 동기화를 시작하지 않습니다.
`1.10.3-11`에서 별도 renderer 간 설정 전달, 저장 실패, 저장소 재로드 및 1분 제한시간을 테스트했습니다.
실제 환경의 제한시간·재시작 검증은 별도로 수행해야 합니다.
`1.10.3-12`에서는 설정 IPC 초기화를 main/renderer 확장 생성자로 이동했습니다.
환경설정 사용이 `onActivate()` 호출 여부에 의존하지 않도록 하고, 활성화 콜백 없이
등록된 설정 화면을 렌더링하여 timeout 변경·저장까지 검증하는 회귀 테스트를 추가했습니다.
`1.10.3-13`에서는 main/renderer IPC를 `createInstance()`로 생성하도록 수정했습니다.
FreeLens IPC의 Singleton 부모 클래스는 직접 `new`로 생성하면 예외를 던집니다.
생성자로 초기화를 이동한 것만으로는 이 제약을 해결하지 못했습니다. 테스트에도 직접 생성 금지
계약을 반영하여 확장 생성·설정 화면 편집·저장 경로를 검증합니다.
기본값은 kube-system, docker.io/library/alpine, 60분, node-shell-exec입니다.
namespace/prefix 형식, image 공백, timeout 범위를 검증합니다.
세션 시작 시 설정을 복사하므로 기존 세션은 원래 namespace/timeout을 유지합니다.

세션 페이지는 cluster page/sidebar API를 사용합니다.
로컬 세션은 list 없이 표시하고 기존 Pod는 Refresh로 조회합니다.
RBAC 허용이 admission/image pull/Node 상태까지 보장한다고 표시하지 않습니다.

## 변경 단계와 검증

| 단계      | 파일                                          | 이유                    | 권한                                | 검증                                       |
| --------- | --------------------------------------------- | ----------------------- | ----------------------------------- | ------------------------------------------ |
| Lifecycle | session-lifecycle, node-shell-service         | 종료/실패 경로 정리     | pods get/create/delete, exec create | 종료/timeout/중복 삭제 테스트, 실제 exit/X |
| RBAC      | rbac-service                                  | attach와 exec 차이 진단 | SSAR create                         | required deny 시 생성 금지                 |
| 설정      | node-shell-settings, preferences, main        | 하드코딩 제거 및 저장   | 추가 없음                           | 타입 검사, 실제 재시작                     |
| 세션/정리 | cleanup-service, sessions-page, orphan-policy | Stop 및 crash 복구      | 선택적 pods list                    | 활성 Pod 보존/만료 판정 테스트             |
| 구조/문서 | renderer entry, menus, README                 | 등록과 업무 로직 분리   | 추가 없음                           | 전체 타입 검사, 테스트, 번들 빌드          |

단위 테스트는 mock 환경이며 실제 Pod 생성이나 회사 클러스터 조작을 수행하지 않습니다.
FreeLens GUI와 PowerShell 5.1은 설치 후 별도의 런타임 검증이 필요합니다.

## 발표 평가 항목

- 동일 RBAC에서 기본 attach 실패와 exec 성공 비교
- 정상 exit / 탭 닫기 / 연결 실패 / timeout / 강제 종료 실험
- 종료부터 Pod 삭제까지 시간과 성공률 측정
- pods/list 없는 환경에서의 기능 저하 범위
- 활성 세션을 orphan으로 잘못 삭제하지 않는지 검증
- 외부 컨트롤러 없이 가능한 복구와 불가능한 즉시 복구 범위

실제로 측정한 성능 수치는 이후 추가합니다. 현재 문서는 미측정 성능을 주장하지 않습니다.

## 이번 변경의 검증 결과

- FreeLens extensions/core 1.10.2 타입 기준 TypeScript 검사 통과
- Vitest 7개 파일, 38개 테스트 통과
- electron-vite의 main/renderer 번들 빌드 통과
- 변경한 TypeScript/TSX/JSON 파일의 Biome 검사 통과
- Trunk는 내부 오류로 실행 실패; Markdown은 Prettier로 정리
- 실제 FreeLens GUI, Windows PowerShell 5.1, EKS 접속 테스트는 미수행

현재 실행 환경의 pnpm은 저장소 지정 버전과 달라 설치 스크립트 승인 단계에서 중단되었습니다.
승인 설정을 바꾸지 않고 설치된 도구의 다음 엔트리포인트로 검사와 빌드를 실행했습니다.

```sh
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json --composite false
node node_modules/vitest/vitest.mjs run
node node_modules/electron-vite/bin/electron-vite.js build
```

이는 실제 Windows 런타임 검증을 대체하지 않습니다.

## 패키지 배포

GitHub Actions가 타입 검사, 단위 테스트, production 빌드를 마친 뒤 `.tgz`를 생성합니다.
PR과 수동 실행은 30일 보관하는 시험용 Artifact를 만들고,
`package.json` 버전과 일치하는 `v` 태그 push는 GitHub Releases에 패키지, SBOM, SHA-256을 게시합니다.
사용자는 FreeLens에 완성된 패키지를 설치하므로 로컬 Node.js/pnpm 빌드가 필요하지 않습니다.
배포는 npm 게시나 별도 npm 인증에 의존하지 않습니다.
자세한 설치 및 운영 절차는 [배포 안내](releases.ko.md)를 참고하세요.

이 자동화의 로컬 검증과 GitHub Actions 실제 실행, Windows GUI 검증은 서로 별개입니다.

## 기능별 개발 이력

수명 관리, RBAC, 설정, 세션·orphan 정리, 기술 문서, 배포 자동화를 순차 브랜치와 PR로 분리했습니다.
기존 커밋과 최종 구현은 보존합니다. [브랜치 운영 안내](branches.ko.md)에서 단계별 역할과 검토·병합 순서를 확인할 수 있습니다.
