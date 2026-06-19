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
- mobile-app/.easignore는 이미 node_modules/.expo/dist/android/ios 등 제외함(업로드 실제 대상 ~800KB).
