---
name: 분리창 IME(한글) 입력 중복/깨짐
description: window.open 분리창의 controlled input에서 한글 조합이 깨지는 이유와 공용 컴포넌트 차원 해결
---

# 분리창(DetachedWindow) controlled input에서 한글/CJK 조합 깨짐

분리창은 별도 React root(`createRoot`, detached-window.tsx)로 렌더된다. 이 환경에서 controlled
input(`value`+`onChange`)에 한글을 타이핑하면 조합 중 onChange가 발화→state→value 되돌림이
IME 조합 버퍼를 깨서 글자가 중복/분해되어 들어간다(예: "안녕"→"ㅇ이안ㄴ녕").

**규칙(How to apply):** 새 텍스트 입력은 공용 `ui/input.tsx`/`ui/textarea.tsx`를 쓰면 자동 보호됨.
이 컴포넌트들은 `isComposingRef`를 onCompositionStart/End로 토글하고, **조합 중 onChange를 억제**한 뒤
**compositionend에서 1회 onChange로 확정**한다. 브라우저별 input↔compositionend 순서에 견고
(끝 input이 먼저 와도 억제, compositionend가 먼저 와도 확정; 뒤따르는 동일값 onChange는 멱등).
raw `<input>`/`<textarea>`를 분리창 안에서 직접 쓰면 같은 버그가 재발한다. 인라인 style 등으로
공용 `ui/input`/`ui/textarea`(Tailwind class 부착)로 못 바꾸는 raw 태그는 **native passthrough**인
`ui/ime-input.tsx`의 `IMEInput`/`IMETextarea`로 치환할 것(모든 props 그대로 전달 + 동일 composition 가드,
시각/동작 동일). 분리창 컴포넌트의 raw 태그는 텍스트가 아닌 type(radio/checkbox/date/email/button)도
같이 치환돼도 가드가 no-op이라 무해.

**Why:** ASCII는 composition 이벤트가 없어 영향 0 → 메인창 동작 보존하면서 분리창만 고쳐진다.
입력별로 일일이 핸들링하면 분리창 모든 텍스트필드(InvoiceSheet/FieldDispatchCostSheet/접수검색팝업 등)에서
whack-a-mole이 되므로 공용 부품 한 곳에서 해결한다.

**주의:** compositionend에서 onChange를 한 번 더 쏘므로, onChange가 side-effect(라이브 검색/네트워크)를
일으키는 곳은 중복 호출 가능. 문제되면 호출부에서 `e.nativeEvent.isComposing` 또는 값 dedupe로 가드.

**가드는 분리창 안에서만 적용할 것(가장 중요).** 메인 창은 React가 조합 중 controlled value
덮어쓰기를 자체 처리하므로 가드가 불필요하다. 메인 창에 가드를 "항상" 적용하면 **회귀**가 난다:
조합 중 onChange 억제 → state가 stale → 폴링/잦은 리렌더 페이지(예: comprehensive-progress 진행메모
in-tab Sheet)에서 조합 도중 백그라운드 리렌더가 stale value로 textarea를 덮어써 "입력이 안 되는"
증상이 생긴다. 그래서 공용 훅 `useIMEComposition`(ui/ime-composition.ts)이 `useIsDetachedWindow()`
(detached-window.tsx, `PortalContainerContext !== undefined`)로 **분리창일 때만** 보정을 켜고
메인 창에선 plain native로 통과시킨다.

**"onChange 억제"만으로는 부족 — 분리창은 로컬 미러 state 필요(2차 회귀 핵심).** 조합 중 onChange만
억제하면, 부모가 조합 도중 리렌더될 때 React가 controlled `value`를 stale 값으로 되돌려 진행 중인
조합을 지운다. 인보이스 팝업(InvoiceManagementPopup의 `Input` 메모, InvoiceSheet의 `IMETextarea`)은
배열/useMemo 재계산으로 리렌더가 잦아 이 증상으로 한글이 아예 입력 안 됐다. 해결: 분리창 분기에서
**로컬 미러 state(inner)** 로 표시값을 보유하고, **조합 중에는 외부 value 동기화를 차단**(useEffect는
`!isComposing`일 때만 setInner). 비조합 입력은 즉시 부모 onChange 전파, IME는 compositionend에 1회 전파.
이로써 조합 도중 리렌더에도 입력이 살아남는다. **Why:** 분리창은 별도 document라 React가 composition을
메인 document 기준으로만 추적 → controlled+IME가 깨지고, 단순 억제로는 리렌더 덮어쓰기를 못 막는다.
