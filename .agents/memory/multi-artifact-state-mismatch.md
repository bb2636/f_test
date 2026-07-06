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

# 채택한 해법: 격리형 standalone Expo (createArtifact 우회)

createArtifact 대신 **루트와 완전 분리된 서브폴더 Expo 앱**으로 가면 프로덕션 위험 0:
- 자체 `package.json`/`node_modules`만 가지는 서브폴더(아티팩트 시스템 미사용). 루트
  package.json·`[deployment]`(build/run) 무변경 → 기존 앱 빌드/배포에 절대 안 섞임.
- 실행은 별도 워크플로(console)로 `npx expo start --tunnel`. 단일 폴더라 `--port`/PORT
  주입 불필요. Expo Go QR/`exp://...exp.direct`로 실기기 테스트.
- WebView(react-native-webview)로 운영 사이트를 감싸고 네이티브 기능만 입힘
  (expo-screen-capture 캡처차단, expo-screen-orientation, 카메라/사진 권한).
- 버전은 추측 말고 `node_modules/expo/bundledNativeModules.json`에서 SDK 호환 버전 확인
  (`npx expo` 직접 실행 금지 규칙 회피). 검증은 tsc + `curl localhost:8081/index.bundle?platform=ios`로 풀 번들 강제 컴파일(hasError:false).
- **Why:** 정합화 안 된 반쪽 workspace에서 createArtifact의 pnpm install이 npm node_modules를
  깨는 리스크를 아예 회피. 트레이드오프=Replit Expo Launch(정식 iOS 빌드/preview) 미사용.
- 헤드리스 컨테이너에서 `libglib-2.0.so.0` (React Native DevTools) 에러는 무해(디버거 UI만 실패, 번들/Expo Go 무관).

# 웹 프리뷰(Webview) 안 뜨는 원인 (2026-07-06)
포트 매핑([[ports]] 5000→80)이 있고 서버가 200이어도, 워크플로에
`outputType = "webview"` 메타데이터가 없으면 프리뷰 패널이 웹뷰를 표시하지 않는다.

**Why:** 이 프로젝트의 "Start application" 워크플로는 metadata가 없어 콘솔 취급됐고,
listArtifacts()도 빈 배열이라 아티팩트 기반 프리뷰도 없었음 → 사용자에겐 웹뷰 부재로 보임.

**How to apply:** 웹 프리뷰가 안 뜨면 (1) [[ports]] 매핑, (2) 워크플로 metadata의
outputType="webview" 둘 다 확인. 수정은 .replit 직접 편집 대신 configureWorkflow
(command/waitForPort/outputType 재지정)로 — 레거시 npm 구조에서도 안전하게 동작 확인됨.

추가(2026-07-06): outputType="webview" 수정 후에도 사용자 프리뷰 패널에는 "Mobile App"만 표시.
listArtifacts()=[] 이라 presentArtifact로 웹앱을 프리뷰 패널에 올릴 수도 없음(v2 id도 not found).
프리뷰 패널이 아티팩트(v3) 기반이라 미등록 레거시 웹앱은 목록에 안 뜨는 것으로 추정 —
등록하려면 createArtifact(pnpm) 필요 = 금지. 대안: 캔버스 iframe(Start application) 또는 새 탭 URL.
