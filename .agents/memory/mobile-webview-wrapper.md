---
name: 모바일 WebView 래퍼(App.tsx) 함정 + EAS 빌드 제약
description: 로그인 후 무한로딩의 진짜 원인(네이티브 로딩 오버레이 고정)과 메인에이전트 셸에서 EAS APK 빌드가 막히는 이유
---

# "로그인 후 무한 로딩" = 네이티브 로딩 오버레이가 안 사라짐 (서버/웹앱 정상)

- 증상: standalone Expo WebView 앱에서 로그인은 성공하는데 이후 스피너만 계속.
- 진단 핵심: **배포 로그로 서버가 정상임을 먼저 증명**. POST /api/login 200 → /api/user, /api/cases, /api/dashboard/stats 200 → 이후 30초 check-session가 몇 분간 authenticated:true. 대시보드 쿼리가 떴다는 건 대시보드 컴포넌트가 실제 마운트·렌더됐다는 뜻 → 웹앱은 정상. 보이는 스피너는 그 위를 덮은 네이티브 오버레이.
- 근본 원인: mobile-app/App.tsx의 WebView 로딩 오버레이가 `onLoadStart→setLoading(true)`, `onLoadEnd→setLoading(false)`로만 제어됨. 웹앱이 로그인 후 wouter `setLocation`(pushState, 전체 새로고침 아님)로 화면 전환하면, Android WebView가 onLoadStart는 다시 쏘지만 onLoadEnd는 안 와서 loading=true 고정 → 흰 오버레이가 영원히 화면을 덮음. 초기 로드(로그인 화면)는 정상 표시되므로 "로그인까진 되는데 그 다음 멈춤"으로 보임.
- **수정 패턴**: 네이티브 풀스크린 로더는 **최초 1회 로드 때만** 표시. `hasLoadedOnce` ref로 첫 onLoadEnd 이후 onLoadStart에서 다시 true로 안 만들고, onLoadProgress>=1이면 즉시 false. 이후 화면 내 로딩은 웹앱 자체 로더가 담당.
- 교훈: WebView로 SPA를 감쌀 때 네이티브 로더를 onLoadStart/End에만 묶지 말 것. SPA 내부 라우팅이 가짜 onLoadStart를 유발한다.

# 메인 에이전트 셸에서 EAS APK 빌드가 막힘 (uncommitted 변경 반영 빌드)

- git(VCS) 경로: eas가 .git/index.lock 쓰기를 시도 → 샌드박스가 "Destructive git operations are not allowed in the main agent"로 차단. 게다가 VCS는 HEAD(커밋본)를 아카이브하므로 **uncommitted 수정이 빌드에 안 들어감**. git commit도 메인에이전트에서 차단.
- EAS_NO_VCS=1 경로: 작업폴더를 직접 아카이브(uncommitted 반영 OK)하지만, "Compressing project files"에서 멈추고 eas build 프로세스가 SIGTERM(exit 143)으로 반복 종료됨. **OOM 아님(여유 11GB 확인).** node_modules를 워크폴더 밖으로 옮겨 ~800KB로 줄여도 동일하게 143 종료 → 이 환경이 eas build 업로드 프로세스 자체를 죽이는 것으로 보임.
- 결론: 메인 에이전트 셸에서 새 APK 빌드는 신뢰 불가. 대안 — (1) 실기기 검증은 Expo Go + 실행 중 tunnel(`exp://...exp.direct`)로 즉시 무료 확인, (2) APK 빌드는 다른 채널(사용자 직접 트리거 또는 격리 환경) 필요.
- mobile-app/.easignore는 이미 node_modules/.expo/dist/android/ios 등 제외함.

# 사용자 본인 Shell에서 EAS 빌드 (에이전트 셸 제약 우회) + 모노레포 함정
- 에이전트 bash의 git차단/143킬은 **에이전트 샌드박스 한정**. 사용자가 Replit "Shell" 탭에서 `cd mobile-app && npx eas build -p android --profile preview` 실행하면 그 단계는 통과(EXPO_TOKEN 자동인증, eas-cli는 미설치라 `npx eas` 필요).
- **모노레포 함정**: EAS는 git 루트(=workspace 모노레포 전체)를 아카이브 → 루트 node_modules(~853MB)+.cache(~1.1GB)까지 끌어와 tar가 수백MB로 비대. 게다가 루트 `.cache/dotslash/.../React Native DevTools-linux-x64`가 `dr-x------`(쓰기없음)이라 EAS가 임시 shallow-clone 정리(rmdir) 중 EACCES로 실패.
- **해결**: 루트(workspace)에 `.easignore` 생성해 `.cache/`·`node_modules/`·`.git/`·빌드산출물·`.local/`·`.agents/` 제외. mobile-app/.easignore(서브폴더)가 아니라 **git루트 .easignore**가 모노레포 아카이브에 적용됨. + 스테일 `/tmp/runner/eas-cli-nodejs`는 `chmod -R u+rwX` 후 rm.
- **lockfile 안전성**: 루트=npm(package-lock.json), mobile-app=yarn(yarn.lock), 워크스페이스 아님. lockfile은 파일이라 아카이브 포함→node_modules 제외해도 EAS가 yarn install로 복구. **Why**: node_modules 제외가 안전한 건 lockfile이 남아서다.

# 모바일 "앱만" 레이아웃 분기 (사이드바→상단바)

- 모바일앱 전용 UI는 화면폭이 아니라 **WebView 식별 신호**로 가른다: mobile-app/App.tsx WebView에 `applicationNameForUserAgent="FloxnMobileApp"` → 웹앱 `useIsMobileApp()`(client/src/hooks/use-mobile-app.tsx)가 navigator.userAgent로 동기 판별. 데스크톱 창을 좁혀도 false라 "모바일앱만"이 정확히 지켜짐(width 기반 useIsMobile과 별개).
- **적용 위치는 셸 두 곳**: StatisticsLayout/FieldSurveyLayout은 isMobileApp일 때 컨테이너 flex→flex-col(사이드바=상단바가 위), 사이드바 컴포넌트(AppSidebar*)는 isMobileApp 분기에서 좌측 고정열 대신 MobileNavShell(상단바+햄버거 드로어, render(close) 렌더prop) 반환. 분기는 반드시 모든 훅 호출 뒤에.
- **함정(검증 경로)**: 폰의 WebView는 APP_URL=floxn-test.replit.app(배포본)을 로드한다. 따라서 소스 수정은 (1) floxn-test **재배포** + (2) Expo Go **리로드**(새 UA 신호 적용) 둘 다 해야 폰에 보인다. 로컬 Start application 미리보기는 UA가 없어 모바일 분기가 안 보이고, /dashboard는 인증게이트라 스샷 검증도 막힘 → 실기기 검증에 의존.

# 모바일 홈 라우팅 분기 + WebView 파일업로드(카메라/갤러리)

- **홈 탭 라우팅**: 모바일 전용 홈은 /mobile-home(모바일 최적화 페이지), 데스크톱 홈은 /dashboard(grid-cols-12). 사이드바 홈 탭이 모바일에서도 /dashboard로 가면 데스크톱 레이아웃이 좁게 떠 "현황요약 정렬 깨짐"으로 보임 → 홈 네비게이션은 `isMobileApp ? "/mobile-home" : "/dashboard"`. (mobile-login은 이미 /mobile-home로 보냄, 탭만 어긋났던 케이스)
- **WebView 파일업로드 카메라/갤러리**: 안드로이드 WebView `<input type=file>`의 accept에 문서형식(.pdf/.doc/.zip 등)이 섞이면 **파일관리자만** 열린다. 사진 업로드는 `accept="image/*"`만 두면 카메라/갤러리 선택 chooser가 뜸(capture는 주지 말 것 — 주면 카메라 강제·선택 불가). **Why**: 선택지를 주려면 image/* 단독, 데스크톱은 image/*도 그대로 동작해 무영향.
