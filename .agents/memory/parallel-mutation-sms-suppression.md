---
name: 병렬 mutation의 부수효과 억제
description: 같은 useMutation을 동시에 여러 번 mutate할 때 SMS/팝업 등 onSuccess 부수효과를 끄는 방법
---

# 병렬 mutation에서 onSuccess 부수효과 억제는 공유 ref가 아니라 mutation 변수로

여러 건을 동시에 같은 mutation으로 `mutate`할 때(예: 접수취소 다중세대 동시처리),
"이번 호출들에서는 onSuccess의 팝업/문자 재오픈을 끈다"는 판단을 **공유 ref 카운터**로 하면 안 된다.
대신 `mutate({ ..., suppressXxx: true })`처럼 **mutation 변수에 플래그를 실어** onSuccess/onError에서 `variables.suppressXxx`로 건별 판단한다.

**Why:** 공유 ref(카운터/불리언)는 성공·실패가 섞여 비동기로 settle될 때 경합이 난다.
- 첫 성공이 카운터를 깎고 navigation 플래그를 내리면, 이후 실패의 onError가 리셋 조건을 못 만나 잔량이 남아 *무관한* 다음 작업까지 부수효과가 잘못 억제됨.
- 반대로 실패가 먼저 카운터를 0으로 만들면, 늦게 도착한 성공 콜백이 팝업을 다시 열어버림.
변수 플래그는 각 호출에 고정 동봉되므로 도착 순서·성공/실패 무관하게 정확하다.

**How to apply:** mutationFn 파라미터 타입에 optional 플래그를 추가하고, onSuccess/onError에서 `variables.<flag>`로 분기. 동시 호출 시 공유 useRef 상태에 의존하지 말 것.
