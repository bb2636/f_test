---
name: 모바일앱(WebView) 반응형 게이팅
description: Floxn 모바일 WebView 전용 UI를 데스크톱 무영향으로 추가하는 패턴
---

모바일 WebView 전용 UI는 `useIsMobileApp()`(UA에 "FloxnMobileApp"이면 true)로만 분기. 모든 분기는 삼항으로 데스크톱 값 보존.

**상단 탭 내비**: 모바일 셸은 햄버거(MobileNavShell) 대신 `mobile-tab-nav.tsx`(상단 가로스크롤 탭+서브탭+우측 아바타). 두 사이드바(app-sidebar-statistics / app-sidebar-field-survey)의 isMobileApp 분기에서만 교체. field-survey 서브탭은 도면작성(/field-survey/drawing) 제외(Web 전용).

**종합진행관리 테이블**: 데스크톱은 "가로스크롤 제거(컨테이너 100% 폭)" 의도. 모바일 가독성 위해 header 그리드와 row 그리드 **둘 다** `minWidth: isMobileApp ? "1040px" : undefined` 적용해야 정렬 유지. 둘은 별도 style 객체(들여쓰기로 구분)라 한쪽만 넣으면 헤더/행 어긋남. 상위 div는 이미 overflowX:auto.

**Why**: 한 그리드에만 minWidth를 넣으면 sticky 헤더와 본문 행의 컬럼 폭이 달라져 스크롤 시 어긋난다.

**견적서 가로고정(네이티브)**: mobile-app/App.tsx onNav에서 url에 "/field-survey/estimate" 포함 시 ScreenOrientation LANDSCAPE lock, 아니면 PORTRAIT_UP lock. app.json orientation="default". SPA pushState 전환 시 onNavigationStateChange 발화 신뢰성은 Expo Go 실기기 검증 필요.

**검증**: UA 게이팅이라 데스크톱 프리뷰로 검증 불가 → floxn-test 재배포 + Expo Go 리로드 필수.
