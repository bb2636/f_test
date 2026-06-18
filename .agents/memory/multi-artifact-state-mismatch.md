---
name: 멀티아티팩트 상태 불일치(레거시 단일앱인데 플랫폼은 pnpm_workspace로 분류)
description: Expo/추가 아티팩트 추가 시 migration이 거부되는 이유와 안전 판단
---

# 프로젝트 구조 상태 불일치 (Expo 래퍼 추가 시도 중 발견)

이 프로젝트(FLOXN, rest-express)는 **물리적으로는 레거시 npm 단일앱**이다:
client/server/shared 루트 구조, `package-lock.json`(npm), `pnpm-workspace.yaml` 없음,
`artifacts/` 디렉터리 없음, `npm run dev`로 구동(포트 5000).

그런데 **플랫폼 메타데이터는 이 프로젝트를 pnpm_workspace로 분류**한다:
- `proposeMigration(...)` → `{ success:false, "This project is already a pnpm_workspace — no migration needed." }` 로 **거부**됨.
- `listArtifacts()` → `{ artifacts: [] }` (서브시스템은 동작하나 등록된 아티팩트 0개).
- `.replit`에 추가 포트(5173, 22965→3000, 8080)와 `[postMerge] scripts/post-merge.sh`가 이미 있음(태스크 에이전트/멀티아티팩트 플랫폼 사용 이력).

**결론/판단:** Expo 같은 새 아티팩트를 추가하려면 보통 migrate-to-multi-artifact가
선행돼야 하는데, 이 프로젝트는 migration 툴이 "이미 workspace"라며 거부한다. 하지만
실제 워크스페이스 스캐폴드(pnpm-workspace.yaml, lib/*, api-server)는 없다.

**Why:** 이 반쪽 상태에서 `createArtifact`를 강행하면 npm 루트 + pnpm 아티팩트
하이브리드가 되거나, 백그라운드 `pnpm install`이 기존 node_modules/락파일을 재구성해
**가동 중인 프로덕션 앱(실데이터·이메일·PII 암호화)** 을 흔들 위험이 있다.

**How to apply:** 레거시 단일앱에 Expo/추가 아티팩트를 붙여야 하는데 proposeMigration이
"already pnpm_workspace"로 거부하면, 프로덕션 앱에서 createArtifact를 무턱대고 돌리지 말 것.
사용자에게 알리고 합의(또는 Replit 지원으로 프로젝트 상태 정합화)를 받은 뒤 진행.
체크포인트(롤백)는 있으니, 시도한다면 직후 기존 앱(포트 5000) 정상 구동을 반드시 재확인.
