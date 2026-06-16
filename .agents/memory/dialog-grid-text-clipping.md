---
name: shadcn DialogContent 본문 텍스트 잘림(grid 자식 오버플로)
description: 고정폭 Dialog 안의 긴 텍스트가 줄바꿈되지 않고 우측에서 잘릴 때의 원인과 확실한 해결
---

# shadcn DialogContent 본문이 우측에서 잘리는 문제

shadcn `DialogContent`는 `display:grid` + 암묵적 단일 `auto` 컬럼이다. 그래서 긴 본문의
그리드 트랙이 **max-content 폭으로 늘어나** 컨테이너(예: max-w-[520px])를 넘고,
컨테이너에 `overflow-x-hidden`이 있으면 줄바꿈 대신 **넘친 부분을 잘라낸다**(사용자에겐
"안쪽 여백이 없어 글씨가 잘린" 것처럼 보임).

- **Why:** grid `auto` 트랙의 성장 한계가 max-content라, 자식에 `whitespace-pre-wrap +
  break-words + overflow-wrap:anywhere`를 줘도 트랙 자체가 안 줄어들면 줄바꿈이 안 일어난다.
  자식에 `min-w-0`만 추가하는 것으로는 불충분했다(트랙 사이징이 여전히 max-content로 감).
- **How to apply:** 컨테이너(DialogContent)에 **`grid-cols-[minmax(0,1fr)]`**를 추가해 컬럼을
  컨테이너 폭으로 강제 수축(min 0)시킨다 → 자식이 반드시 줄바꿈된다. 본문 텍스트엔
  `whitespace-pre-wrap`(사용자 줄바꿈 보존) + `break-words [overflow-wrap:anywhere]`,
  그리드 직계 자식엔 `min-w-0`을 함께 둔다. 안쪽 여백이 부족해 보이면 `px-7` 등으로 보강.
  좌우 폭 통일은 `w-full max-w-[520px]`(반응형: 작은 화면 full, 데스크톱 520px).
