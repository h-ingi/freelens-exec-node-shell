# 기능별 브랜치와 PR 운영

## 분리 방식

기존 기능별 커밋을 그대로 사용하여 순차 브랜치와 Draft PR로 분리했습니다.
뒤 단계는 앞 단계 기능을 포함합니다. 각 PR의 기준 브랜치를 앞 단계로 지정하여
Files changed에는 해당 단계의 추가 변경만 표시합니다.
서로 독립적으로 main에서 개발한 브랜치는 아니며, 중간 단계를 완성된 배포본으로 취급하지 않습니다.

## 브랜치와 검토 순서

| 순서 | 브랜치                           | 최초 PR 기준                     | 역할                                 | PR                                                              |
| ---- | -------------------------------- | -------------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| 1    | `feat/node-shell-lifecycle-core` | `main`                           | exit·터미널 X·timeout 정리           | [#2](https://github.com/h-ingi/freelens-exec-node-shell/pull/2) |
| 2    | `feat/node-shell-rbac`           | `feat/node-shell-lifecycle-core` | RBAC 진단                            | [#3](https://github.com/h-ingi/freelens-exec-node-shell/pull/3) |
| 3    | `feat/node-shell-settings`       | `feat/node-shell-rbac`           | 설정 저장                            | [#4](https://github.com/h-ingi/freelens-exec-node-shell/pull/4) |
| 4    | `feat/node-shell-sessions`       | `feat/node-shell-settings`       | 세션 UI·orphan 정리·시작/종료 안정화 | [#5](https://github.com/h-ingi/freelens-exec-node-shell/pull/5) |
| 5    | `docs/node-shell-architecture`   | `feat/node-shell-sessions`       | 기술 설명·검증 기록·패키지 버전      | [#6](https://github.com/h-ingi/freelens-exec-node-shell/pull/6) |
| 6    | `ci/release-packages`            | `docs/node-shell-architecture`   | tgz 배포 자동화·설치 안내            | [#7](https://github.com/h-ingi/freelens-exec-node-shell/pull/7) |
| 7    | `feat/node-shell-lifecycle`      | `ci/release-packages`            | 최종 통합본 및 브랜치 운영 문서      | [#1](https://github.com/h-ingi/freelens-exec-node-shell/pull/1) |

기존 PR #1의 대화와 브랜치는 보존하되 기준 브랜치를 `ci/release-packages`로 바꿨습니다.
따라서 #1은 더 이상 모든 기능을 한꺼번에 main에 병합하는 PR이 아닙니다.
기능 코드의 시작·종료 안정화 수정은 해당 코드가 필요한 4단계에 함께 묶었습니다.
기술 문서 단계에는 기존 커밋에 포함된 패키지 버전 변경도 들어 있습니다.

## 검토와 병합

이번 분리는 브랜치/PR 생성과 문서 반영이며 main 병합이나 버전 태그 게시를 수행하지 않습니다.

1. #2부터 위 순서대로 검토합니다. Files changed와 해당 단계 테스트 결과를 확인합니다.
2. 준비가 끝난 PR은 Draft를 해제한 뒤 main에 **Create a merge commit** 방식으로 병합합니다.
3. 다음 PR의 base를 main으로 바꾸고 앞 단계 변경이 차이에서 빠졌는지 확인합니다.
4. 다음 PR이 더 이상 이전 브랜치를 기준으로 삼지 않는 것을 확인한 뒤 이전 브랜치를 삭제할 수 있습니다.
5. #1까지 병합한 최종 main에서 실제 환경 검증을 마친 뒤 [배포 안내](releases.ko.md)에 따라 태그를 push합니다.

Squash 또는 rebase 방식은 원래 커밋의 관계를 바꾸므로 이 절차에서는 사용하지 않습니다.
저장소 정책상 merge commit을 사용할 수 없다면 후속 브랜치를 새 main 기준으로 재구성한 뒤
PR 차이를 다시 확인해야 합니다. 자동 병합이나 강제 push는 설정하지 않았습니다.

## 앞 단계 수정 반영

검토 중에는 수정할 기능의 브랜치에서 작업합니다. 앞 단계 변경은 뒤 단계에 자동 복사되지 않습니다.
수정한 브랜치를 바로 다음 브랜치에 merge하고 테스트한 뒤, 같은 작업을 최종 브랜치까지 순서대로 반복합니다.

예를 들어 RBAC 수정 후 설정 단계에 전달할 때:

```sh
git fetch origin
git switch feat/node-shell-settings
git merge origin/feat/node-shell-rbac
pnpm type:check
pnpm test:unit
git push origin feat/node-shell-settings
```

이후 sessions → architecture → release-packages → 기존 lifecycle 브랜치에도 차례로 전달합니다.
충돌이 생기면 해당 단계의 의도를 보존하여 해결하고, 최종 통합본에서 빌드와 패키징을 확인합니다.

## 검증 범위

분리 전 최종 통합본은 타입 검사, 38개 단위 테스트, production 빌드 및 tgz 구성을 확인했습니다.
이번 분리는 기존 커밋을 재작성하지 않으며 문서 이외 기능 코드를 변경하지 않습니다.
브랜치 끝 커밋과 단계별 조상 관계를 확인합니다. 각 중간 단계의 독립 실행 검증은 별도입니다.
실제 Windows FreeLens/PowerShell/EKS 검증과 GitHub Release 게시 확인은 여전히 남아 있습니다.
Trunk는 내부 오류로 실패한 이력이 있으며, 이번 문서도 실행 결과와 대체 형식 검사 결과를 PR에 기록합니다.

## 화면 개선 반영 (1.10.3-15)

설정 UI·확장 이름·셸 프롬프트 변경은 settings 단계부터 후속 브랜치에 반영합니다.
Services 형태의 세션 목록 개선은 sessions 단계부터 후속 브랜치에 반영합니다.
CI와 최종 통합본에는 모든 변경이 포함되며, main 병합은 별도입니다.
