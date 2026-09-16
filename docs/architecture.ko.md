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
RBAC는 `KubeJsonApi.forCluster(clusterId)`로 명시적인 클러스터의
`/apis/authorization.k8s.io/v1/selfsubjectaccessreviews`에 POST합니다.

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

Common.Store.ExtensionStore를 main/renderer에 등록합니다.
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
