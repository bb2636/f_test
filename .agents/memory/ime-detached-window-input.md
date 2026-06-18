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
