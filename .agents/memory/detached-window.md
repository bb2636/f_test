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
  - 공용 Radix UI(`ui/popover|select|dropdown-menu`)는 Portal에 `container={usePortalContainer()}` 배선됨(없으면 기본 body, 하위호환).
  - 직접 `createPortal(x, document.body)` 하는 커스텀 컴포넌트(예: comprehensive-progress의 `HeaderTooltip`)는 `portalContainer ?? document.body`로 바꿔야 분리창 안에 뜬다.
- `getBoundingClientRect`/`position:fixed`는 각 창 뷰포트 기준이라, 포털만 같은(분리창) 문서로 보내면 좌표도 자동으로 맞는다.

## 메인 창 잠금 누수(중요)
- 분리창은 메인 창과 **같은 JS realm**을 공유한다(window.open, 같은 origin). 그래서 분리창 안에서 열리는 **Radix 모달류(Dialog/Select/Popover) + react-remove-scroll**가 스크롤락/`pointer-events:none`/`aria-hidden`을 **메인 창 document.body**에 건다 → 메인 창 전체 클릭이 막힌다(증상: floating "신규접수/문자발송" 버튼이 클릭조차 안 됨).
  - **Why:** Radix/remove-scroll가 모듈 전역 `document`(=메인 창) 기준으로 본문을 잠그는데, 분리창에서 close/window 닫힘 시 정리가 메인 본문에 안 닿아 잠금이 남음. 비모달 요구사항(분리창 띄운 채 메인 작업)과도 충돌.
  - **How to apply:** 클릭을 막는 잠금은 모두 메인 **body 자체**에 걸린다(Dialog `pointer-events:none`, remove-scroll `data-scroll-locked`/`overflow`). DetachedWindow가 열려있는 동안 메인 `document.body` **자체 속성만** `MutationObserver`로 감시해 즉시 해제(`unlockMainBody`/`lockGuard`). 감시 범위를 body 자식까지 넓히면 메인 창의 **정상 모달**까지 풀려버리니 금지. body 자식 `aria-hidden`은 클릭을 막지 않는 접근성 잔재라 **닫힐 때 1회만** 정리.

## 알려진 제한 / 미해결
- **토스트(Toaster)는 메인 루트에만** 있어 분리창 작업 중 알림이 메인 창에 뜬다.
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
