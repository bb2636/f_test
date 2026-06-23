---
name: overflow-y-auto가 가로스크롤 유발
description: 한 축만 auto면 다른 축 visible→auto 승격되어 의도치 않은 좌우 슬라이드 발생
---

스크롤 컨테이너에 `overflow-y-auto`(overflow-y:auto, overflow-x:visible)만 주면, CSS overflow 규칙상 한 축이 visible이고 다른 축이 non-visible이면 visible이 **auto로 승격**된다. 그래서 내부 컨텐츠가 뷰포트보다 넓으면 세로 스크롤만 원했는데 **가로 스크롤(좌우 슬라이드)이 같이 생긴다**.

**Why:** 모바일 앱(WebView, useIsMobileApp) 현장입력(field-management)에서 "화면이 불필요하게 좌우로 슬라이드" 신고. FieldSurveyLayout 모바일 main이 overflow-y-auto뿐이라, 내부 고정폭(w-[220px], min-w-[300px])·grid col-span-7/5가 폭을 넘기면 가로 스크롤로 노출됐다.

**How to apply:** 세로만 스크롤하려는 모바일 컨테이너는 `overflow-y-auto overflow-x-hidden`을 명시. 단, overflow-x-hidden은 넘치는 컨텐츠를 잘라버리므로 함께 내부 고정폭을 모바일에서 유동화해야 함 — 입력은 w-full/flex-1 min-w-0, 2열 grid는 col-span-12로 스택, 외곽 패딩은 한쪽(pl-8)만 주지 말고 px-로 양쪽. 데스크톱 깨지지 않게 전부 isMobileApp 분기.
