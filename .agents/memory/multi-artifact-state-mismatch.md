---
name: 멀티아티팩트 상태 불일치(레거시 단일앱인데 플랫폼은 pnpm_workspace로 분류)
description: Expo/추가 아티팩트 추가 시 migration이 거부되는 이유와 안전한 우회 전략, 웹 프리뷰 부재 원인
---

# 규칙: 이 프로젝트에서 createArtifact 금지
물리적으로는 레거시 npm 단일앱(client/server/shared, package-lock.json, npm run dev 포트 5000)이지만 플랫폼 메타데이터는 pnpm_workspace로 분류되어 `proposeMigration`이 "already pnpm_workspace"로 거부되고 `listArtifacts()`는 빈 배열이다.

**Why:** 이 반쪽 상태에서 `createArtifact`를 강행하면 백그라운드 `pnpm install`이 기존 npm node_modules/락파일을 재구성해 가동 중인 프로덕션 앱(실데이터·이메일·PII 암호화)을 깨뜨릴 위험이 있다.

**How to apply:** 새 아티팩트(Expo 등)가 필요하면 아티팩트 시스템을 우회해 루트와 완전 분리된 **서브폴더 standalone 앱**으로 만든다:
- 자체 package.json/node_modules만 갖는 서브폴더. 루트 package.json·[deployment] 무변경.
- 실행은 별도 콘솔 워크플로(`npx expo start --tunnel`), Expo Go QR로 실기기 테스트.
- 의존성 버전은 `node_modules/expo/bundledNativeModules.json`에서 SDK 호환 버전 확인.
- 검증: tsc + `curl localhost:8081/index.bundle?platform=ios` 풀 번들 컴파일(hasError:false).
- 트레이드오프: Replit Expo Launch(정식 iOS 빌드/preview) 미사용. 헤드리스 컨테이너의 `libglib-2.0.so.0` 에러는 무해(디버거 UI만 실패).

# 웹 프리뷰(Webview) 안 뜨는 원인
포트 매핑과 서버 200이어도 워크플로에 `outputType="webview"` 메타데이터가 없으면 프리뷰 패널에 웹뷰가 안 뜬다. 수정은 .replit 직접 편집 대신 configureWorkflow로. 단, 프리뷰 패널은 아티팩트(v3) 기반이라 미등록 레거시 웹앱은 outputType을 고쳐도 목록에 안 뜰 수 있다 — 등록하려면 createArtifact(금지)라서 대안은 캔버스 iframe 또는 새 탭 URL.
