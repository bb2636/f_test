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

## 알려진 제한 / 미해결
- **토스트(Toaster)는 메인 루트에만** 있어 분리창 작업 중 알림이 메인 창에 뜬다.
- 분리창에서 `document`/`window` 직접 참조(click-outside 리스너 등)는 메인 창 기준 → 분리창에선 안 잡힘. 커스텀 드롭다운(예: SMS 다이얼로그의 cancelReason)은 분리 전 ownerDocument 기준으로 고쳐야 함.
- **테스트 한계:** 별도 OS 창은 screenshot 불가 + 미리보기 iframe이 팝업 차단할 수 있음 → 사용자 실브라우저/듀얼모니터 검증 필수(팝업 1회 허용 필요).

## 어떤 팝업을 분리? (사용자 의도)
- 종합진행관리의 **돋보기(진행건 상세보기 Sheet)는 in-tab 유지**. 분리 대상은 거기서 "접수건 상세보기" 버튼이 여는 **접수 폼(IntakePage, isModal)** 창.
- `intake.tsx`는 `isModal ? content : createPortal(content, document.body)`로 모달모드에선 이미 inline 렌더 → DetachedWindow(isModal=true)에선 내부 팝업이 분리창 안에 그대로 뜸. intake.tsx 손댈 필요 없음.

## SheetTitle/DialogTitle 주의
- Sheet/Dialog를 DetachedWindow로 바꿀 때 `SheetTitle`/`DialogTitle`(Radix Title)은 Root context가 필요하므로 **일반 div로 교체**. `SheetHeader`는 plain div라 그대로 둬도 됨.
