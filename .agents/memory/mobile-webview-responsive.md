---
name: 모바일앱(WebView) 반응형 게이팅
description: Floxn 모바일 WebView 전용 UI를 데스크톱 무영향으로 추가하는 패턴
---

모바일 WebView 전용 UI는 `useIsMobileApp()`(UA에 "FloxnMobileApp"이면 true)로만 분기. 모든 분기는 삼항으로 데스크톱 값 보존.

**상단 탭 내비**: 모바일 셸은 햄버거(MobileNavShell) 대신 `mobile-tab-nav.tsx`(상단 가로스크롤 탭+서브탭+우측 아바타). 두 사이드바(app-sidebar-statistics / app-sidebar-field-survey)의 isMobileApp 분기에서만 교체. field-survey 서브탭은 도면작성(/field-survey/drawing) 제외(Web 전용).

**종합진행관리 테이블(comprehensive-progress.tsx)**: 데스크톱은 "가로스크롤 제거(컨테이너 100% 폭)" 의도. header 그리드와 row 그리드는 **별도 style 객체**(들여쓰기로 구분)라 gridTemplateColumns/minWidth 변경은 **둘 다** 똑같이 해야 sticky 헤더와 본문 행 정렬이 유지된다(한쪽만 바꾸면 어긋남). 상위 div는 overflowX:auto.

**모바일 컬럼 축소**: 모바일은 컬럼을 줄여 폰 폭에 맞추므로 minWidth는 둘 다 `undefined`(과거 1040px 강제 스크롤은 폐기). 핵심 함정 — **헤더는 라벨 배열 .map(데이터 주도)지만 본문 셀은 하드코딩 div 나열(소스 순서 고정)**. 그래서 모바일 컬럼 변경 시: 헤더는 모바일 전용 배열을 시각 순서로 새로 만들고, 본문은 소스를 못 바꾸니 보이는 셀마다 `style.order = isMobileApp ? N : undefined`로 재배치 + 숨길 셀은 `{!isMobileApp && ...}` 게이팅. **보이는 본문 셀 개수 == 모바일 gridTemplateColumns 트랙 수**(협력사 8 / 그외 6)가 정확히 맞아야 정렬이 안 깨진다. 본문 셀에 일부만 order를 주면 order:0(미지정) 셀이 앞으로 쏠리므로, 보이는 셀은 전부 또는 전무로 order 지정.

**Why**: header/body가 별개 그리드라 한쪽만 손대면 어긋나고, body가 데이터 주도가 아니라 하드코딩이라 컬럼 추가·재배치를 CSS order로만 풀 수 있다. 트랙 수와 보이는 셀 수가 불일치하면 그리드 자동배치가 틀어진다.

**견적서 가로고정(네이티브)**: mobile-app/App.tsx onNav에서 url에 "/field-survey/estimate" 포함 시 ScreenOrientation LANDSCAPE lock, 아니면 PORTRAIT_UP lock. app.json orientation="default". SPA pushState 전환 시 onNavigationStateChange 발화 신뢰성은 Expo Go 실기기 검증 필요.

**검증**: UA 게이팅이라 데스크톱 프리뷰로 검증 불가 → floxn-test 재배포 + Expo Go 리로드 필수.
