---
name: 분리형 창(DetachedWindow) 아키텍처
description: 팝업을 window.open 별도 브라우저 창으로 띄울 때의 핵심 제약과 배선 규칙
---

# 분리형 창(별도 브라우저 창) 렌더링

`client/src/components/detached-window.tsx` = window.open + 자식 창에 **별도 createRoot**.

## 핵심 결정
- 단순 `createPortal(child, otherWindow.body)`만으로는 **React 합성이벤트가 깨진다**(루트가 원본 document 기준). 그래서 자식 창에 별도 `createRoot`를 만들고 그 안에서 Provider들을 **재제공**한다.
  - **Why:** 합성이벤트/포커스/Radix가 루트 document에 묶여 있어 타 창에서 오작동.
- 재제공 대상: `QueryClientProvider` + `TooltipProvider`. auth는 query 기반이라 별도 context 없음. **새 전역 context가 생기면 여기서도 재제공해야 함.**
- 자식 root는 `children`이 매 렌더 새 객체라 deps 없는 effect로 매 렌더 `root.render` 재호출 → 부모 상태가 자식 창에 전파됨(reconcile라 remount/포커스 손실 없음).

## 분리창 안의 포털/문서 커플링 규칙
- 분리창 내부에서 쓰는 **모든 포털은 분리창 document로 라우팅**해야 한다. `PortalContainerContext` + `usePortalContainer()`로 분리창 body를 노출.
  - 공용 Radix UI(`ui/popover|select|dropdown-menu|alert-dialog`)는 Portal에 `container={usePortalContainer()}` 배선됨(없으면 기본 body, 하위호환). **AlertDialog도 반드시 배선해야** 분리창 안의 확인창이 메인창이 아닌 분리창에 뜬다(미배선시 확인창이 메인창으로 샘).
  - 직접 `createPortal(x, document.body)` 하는 커스텀 컴포넌트(예: comprehensive-progress의 `HeaderTooltip`)는 `portalContainer ?? document.body`로 바꿔야 분리창 안에 뜬다.
- `getBoundingClientRect`/`position:fixed`는 각 창 뷰포트 기준이라, 포털만 같은(분리창) 문서로 보내면 좌표도 자동으로 맞는다.

## 메인 창 잠금 누수(중요)
- 분리창은 메인 창과 **같은 JS realm**을 공유한다(window.open, 같은 origin). 그래서 분리창 안에서 열리는 **Radix 모달류(Dialog/Select/Popover) + react-remove-scroll**가 스크롤락/`pointer-events:none`/`aria-hidden`을 **메인 창 document.body**에 건다 → 메인 창 전체 클릭이 막힌다(증상: floating "신규접수/문자발송" 버튼이 클릭조차 안 됨).
  - **Why:** Radix/remove-scroll가 모듈 전역 `document`(=메인 창) 기준으로 본문을 잠그는데, 분리창에서 close/window 닫힘 시 정리가 메인 본문에 안 닿아 잠금이 남음. 비모달 요구사항(분리창 띄운 채 메인 작업)과도 충돌.
  - **How to apply:** 클릭을 막는 잠금은 모두 메인 **body 자체**에 걸린다(Dialog `pointer-events:none`, remove-scroll `data-scroll-locked`/`overflow`). DetachedWindow가 열려있는 동안 메인 `document.body` **자체 속성만** `MutationObserver`로 감시해 즉시 해제(`unlockMainBody`/`lockGuard`). 감시 범위를 body 자식까지 넓히면 메인 창의 **정상 모달**까지 풀려버리니 금지. body 자식 `aria-hidden`은 클릭을 막지 않는 접근성 잔재라 **닫힐 때 1회만** 정리.

## 토스트(Toaster)는 surface 스토어로 활성 창에만 표시 (해결됨)
- use-toast는 전역 단일 memoryState라 Toaster를 메인+분리창 양쪽 마운트하면 같은 토스트가 두 창에 **중복**된다.
  - **How to apply:** `client/src/lib/toast-surface.ts`(열린 분리창 스택 추적) + `Toaster`의 optional `detachedId` prop + `useSyncExternalStore`로 활성 surface 구독. 분리창이 열려있으면 활성(스택 top) 분리창 Toaster만 보이고 **메인 Toaster는 null 반환**. DetachedWindow가 열릴 때 `acquireDetachedToastSurface()`, 닫힐 때 release, 분리창 트리 안에 `<Toaster detachedId={...}/>` 렌더. ToastViewport는 Radix 비포털 `position:fixed`라 분리창 DOM에 그대로 뜬다.
  - **부수효과(의도됨):** 분리창이 열려있는 동안은 메인 창 액션 토스트도 활성 분리창에 표시된다(단일 포커스 surface). 비모달 작업 흐름엔 적절.

## 알려진 제한 / 미해결
- 분리창에서 `document`/`window` 직접 참조(click-outside 리스너 등)는 메인 창 기준 → 분리창에선 안 잡힘. 커스텀 드롭다운(예: SMS 다이얼로그의 cancelReason)은 분리 전 ownerDocument 기준으로 고쳐야 함.
- **테스트 한계:** 별도 OS 창은 screenshot 불가 + 미리보기 iframe이 팝업 차단할 수 있음 → 사용자 실브라우저/듀얼모니터 검증 필수(팝업 1회 허용 필요).

## 어떤 팝업을 분리? (사용자 의도)
- 종합진행관리의 **돋보기(진행건 상세보기 Sheet)는 in-tab 유지**. 분리 대상은 거기서 "접수건 상세보기" 버튼이 여는 **접수 폼(IntakePage, isModal)** 창.
- `intake.tsx`는 `isModal ? content : createPortal(content, document.body)`로 모달모드에선 이미 inline 렌더 → DetachedWindow(isModal=true)에선 내부 팝업이 분리창 안에 그대로 뜸. intake.tsx 손댈 필요 없음.

## 분리창은 공용 선택 state에 묶지 말 것(내용 사라짐)
- 분리창 렌더/`initialCaseId`를 메인 창과 공유하는 선택 state(예: `selectedCaseId`)에 바인딩하면, 메인 창에서 다른 행 클릭/상세 닫힘으로 그 값이 바뀔 때 `{selectedCaseId && ...}` 게이트가 무너져 분리창 내용이 통째로 사라진다(비모달이라 메인 작업이 계속 일어남).
  - **Why:** 분리창은 부모 컴포넌트가 매 렌더 `root.render`로 전파하므로 부모 state 변화에 그대로 반응. 공용 선택값은 메인 창 조작의 부수효과로 수시로 바뀐다.
  - **How to apply:** 분리창마다 **전용 pinned state**(예: `receptionDetailCaseId`)를 두고, 여는 버튼 onClick에서 현재 선택값을 한 번 고정 → 렌더/`initialCaseId`는 전용 state 사용 → 모든 close/onSuccess 경로에서 null 리셋. 같은 패턴을 route 기반 분리창은 query param 고정(detached report)으로 해결.

## SheetTitle/DialogTitle 주의
- Sheet/Dialog를 DetachedWindow로 바꿀 때 `SheetTitle`/`DialogTitle`(Radix Title)은 Root context가 필요하므로 **일반 div로 교체**. `SheetHeader`는 plain div라 그대로 둬도 됨.
- 모달 셸 교체 시 내부 스크롤 영역의 `maxHeight: calc(90vh - N)` 같은 모달 기준 높이는 분리창(100vh)에선 빈공간이 생기므로 `flex:1 + minHeight:0`(부모는 height:100vh flex column)으로 바꿔 창을 꽉 채운다.

## query param 기반 분리창 감지는 sessionStorage로 고정
- 분리창을 `?detached=1`로 열고 query param만으로 감지하면, 분리창 안에서 다른 경로로 setLocation 이동 시 query가 유실돼 감지가 풀린다(사이드바/플로팅이 다시 나타남).
  - **Why:** wouter setLocation은 쿼리스트링을 보존하지 않음. 각 브라우저 창은 별도 JS 컨텍스트라 모듈 캐시/sessionStorage가 창 단위로 격리됨.
  - **How to apply:** `isDetachedWindow()` 같은 헬퍼에서 최초 진입 시 `?detached=1`을 감지하면 sessionStorage에 기록 후 모듈변수 캐시. 이후엔 sessionStorage로 판정 → 창 내 라우팅에도 분리창 상태 유지. 팝업 차단 fallback(같은 탭)은 detached 미설정이라 자연히 일반 모드.
- **분리창에서는 공유 localStorage(+storage 이벤트)를 창 단위 상태에 쓰지 말 것 — 모든 창에 누수된다.** localStorage는 동일 origin 모든 창이 공유하고 `localStorage.setItem`은 다른 창에 자동으로 storage 이벤트를 발생시킨다. 그래서 분리창이 공유 키(예: `selectedFieldSurveyCaseId`)를 폴링/리스닝하면, 다른 창(또는 여는 쪽 버튼)이 그 키를 바꿀 때 열린 분리창 전부가 "마지막 값"으로 동기화돼 버린다. 같은 함정이 **레이아웃에 항상 붙는 보조 컴포넌트**(탭바 등 본문 옆 동기화 컴포넌트)에도 숨어 있으니, 본문만 고치지 말고 그 창에 렌더되는 동기화 컴포넌트를 전부 점검.
  - **Why:** sessionStorage는 window.open으로 연 창마다 별도(opener 값 1회 복사 후 비공유)지만, localStorage·storage 이벤트는 창을 가로지른다.
  - **How to apply:** 분리창 상태는 sessionStorage(창 단위 고정값) + **같은 창 안에서만 도는 CustomEvent**(window.dispatchEvent — 창을 안 넘음)로 컴포넌트 간 동기화. 초기값은 URL 쿼리 우선(opener의 stale sessionStorage 복사본이 URL을 덮지 않게), 이후 전환은 CustomEvent. 폴링/storage 동기화는 `if (detached) return;`로 끄고, 분리 여부도 query 유실 대비 sessionStorage에 고정.
- **여러 분리창은 위치도 어긋나게:** `window.open(url, name, features)`에 left/top을 안 주면 매번 같은 자리에 겹쳐 떠 앞 창을 가려 "내용이 바뀐 것처럼" 보인다. 창 이름 건별 유니크 + 계단식 offset(화면 밖 클램프), 같은 건 재클릭은 Map+`closed` 체크로 기존 창 focus.

## 분리창 종류별로 건(case) 선택 소스가 다름 — 한 덩어리로 묶지 말 것
- 모든 detached 창을 `if (detached)` 한 분기로 처리하면 안 된다. 종류가 둘이다:
  - **보고서 열람 분리창**: caseId를 URL 쿼리에 싣고 열며, 창 단위 sessionStorage(`REPORT_CASEID_KEY`) + 같은 창 CustomEvent(`REPORT_CASE_CHANGE_EVENT`)로 건을 관리(다른 창에 누수 X).
  - **도면작성/증빙 단독 팝업(solo, `?detached=1&solo=1`)**: caseId를 **URL에 안 싣고** 공유 localStorage(`selectedFieldSurveyCaseId`)로만 넘긴다. 그래서 이 창은 인앱과 **동일하게 localStorage 폴링/storage**로 건을 읽어야 한다. sessionStorage 경로를 타면 `selectedCaseId`가 비어 컴포넌트가 `return null` → 상단 바/카드 통째 미렌더.
  - **How to apply:** `useReportDetached = detached && !isSoloFieldPopup()`로 갈라서 초기 state·sync effect(+deps)·handleSelect를 모두 분기. 보고서만 sessionStorage+CustomEvent, solo는 localStorage. `isSoloFieldPopup()`은 detached-window.ts(solo=1 / SOLO_KEY).
  - **주의:** "분리창엔 localStorage 쓰지 말 것"(위 49행)은 **창 단위로 격리돼야 하는** 상태(보고서 건 선택)에 한정. solo 팝업처럼 **일부러 인앱과 같은 건을 공유**해야 하는 경우는 localStorage가 정답.

## 분리창 판정은 단일 헬퍼로 — dispatch/수신 양쪽이 같은 신호 (중요)
- 보고서 분리창에서 "건 전환"을 **쏘는 쪽**(상단 탭)과 **받는 쪽**(보고서 본문)이 "여기가 보고서 분리창인가"를 **서로 다른 신호**로 판정하면 split-brain이 된다: 한쪽은 CustomEvent로 쏘고 다른 쪽은 localStorage 폴링만 봐서 **탭 하이라이트는 바뀌는데 본문이 안 바뀜**.
  - **Why:** 과거 탭은 `isDetachedWindow()`(렌더 중 동기 설정되는 `floxn:detached`)+`!solo`로, 본문은 `queryDetached||sticky(floxn:reportDetached, queryDetached 의존 deferred effect로만 설정)`로 따로 판정 → URL에서 detached=1이 먼저 유실되거나 solo가 sessionStorage 복사로 새어들면 두 판정이 어긋남.
  - **How to apply:** `isDetachedReportWindow()`(detached-window.ts) **하나만** 쓴다. 우선순위: 분리창 아니면 false → 라우트가 `/field-survey/report`면 무조건 true(solo보다 라우트 우선) → solo면 false → 비solo는 `REPORT_DETACHED_KEY` sticky. 새 분리창 동작 추가 시 컴포넌트별 ad-hoc 판정 만들지 말 것.

## 분리창 건 전환은 CustomEvent만 믿지 말고 sessionStorage 폴백 폴링 (중요)
- 분리창에서 상단 탭으로 건 전환 시 같은 창 CustomEvent에만 의존하면 이벤트 누락 시 본문이 안 따라온다. 인앱(현장/증빙/견적)은 localStorage 폴링이라 안정적이었던 것.
  - **Why:** 분리창은 cross-window 누수 방지로 공유 localStorage 대신 **창단위 sessionStorage(REPORT_CASEID_KEY)**를 쓰는데 폴백 폴링이 없어서, dispatch/수신이 같은 창이어도 리스너 부착 타이밍 등으로 전환이 한 번씩 먹지 않았다. 내부 팝오버 전환(setSelectedCaseId 직접호출)은 멀쩡한 게 단서.
  - **How to apply:** 분리창 detached 분기에선 CustomEvent(즉시성)+sessionStorage 500ms 폴링(폴백)을 **둘 다** 둔다. sessionStorage는 창단위라 다른 창으로 안 샌다(인앱 localStorage 폴링과 동일 패턴). field-report와 CaseReceiptTabs 양쪽 모두.

## 분리창 안에서 라우팅으로 도달하는 "모든" 페이지를 점검 — 본문/탭만으론 부족 (중요)
- 보고서 분리창 사이드바로 현장입력/견적서/증빙자료로 전환해도 페이지가 안 바뀌는 버그: field-report(본문)·CaseReceiptTabs(탭)만 detached-aware로 고쳤고, **사이드바로 들어가는 페이지 컴포넌트들**(field-management/field-estimate/field-documents)은 여전히 `selectedFieldSurveyCaseId` localStorage만 직접 읽/쓰/폴링 → 분리창에선 stale/빈 localStorage라 전환 실패 + 탭 CustomEvent 미수신.
  - **Why:** 보고서 분리창은 라우트가 `/field-survey/report`가 아니어도(현장입력 등으로 이동해도) `isDetachedReportWindow()`가 `REPORT_DETACHED_KEY` sticky로 여전히 true. 즉 그 창 안 모든 페이지가 분리창 규칙(sessionStorage)을 따라야 하는데 페이지들이 인앱 가정(localStorage)으로 짜여 있었음.
  - **How to apply:** 케이스 소스를 컴포넌트마다 인라인하지 말고 `detached-window.ts`의 단일 헬퍼(`getFieldSurveyCaseId`/`setFieldSurveyCaseId`/`clearFieldSurveyCaseId`/`subscribeFieldSurveyCaseId`)로 통일. 헬퍼가 `isDetachedReportWindow()`로 분기(분리창=sessionStorage+CustomEvent, 인앱/solo=localStorage+storage). 구독 콜백은 **빈 문자열(클리어)도 전파**해야 stale 잔존 안 됨. 새 현장조사 페이지/팝업 추가 시 반드시 이 헬퍼 경유.
