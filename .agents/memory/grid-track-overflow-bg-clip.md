---
name: 그리드 트랙 오버플로로 마지막 컬럼 배경 잘림
description: minWidth 컨테이너에 percent+minmax(px,fr) 트랙 합이 넘치면 마지막 컬럼이 배경 밖으로 밀려 헤더 색이 잘려 보임
---

# 증상
div-grid 테이블(예: 종합진행관리)에서 마지막 컬럼(상세보기) 헤더 배경색이
가로로 반쯤 잘려 보임. 특정 역할/권한에서만 두드러짐.

# 원인 (규칙)
헤더/행 컨테이너에 `minWidth`(예 1500px)와 `background`를 주고 `gridTemplateColumns`를
`퍼센트% ... minmax(180px,1.4fr) ... 고정px`로 구성하면, 트랙 합이 minWidth를
초과할 때 **트랙만 컨테이너 박스 밖으로 오버플로**된다. 배경은 컨테이너 폭
(=minWidth)까지만 칠해지므로 넘친 마지막 컬럼은 배경 없이 보인다.
오버플로를 키우는 요인: fr 컬럼의 px 하한(minmax의 첫 인자), 추가 고정 px 컬럼
(삭제권한 시 40px 체크박스), 역할별 퍼센트 합 증가(협력사가 관리자보다 큼).

**Why:** 배경은 grid 컨테이너 요소에 그려지는데, grid 트랙은 컨테이너 폭을
넘쳐도 컨테이너 자체 width는 minWidth로 고정 → 배경 미적용 영역 발생.

# 해결
fr 트랙의 px 하한을 없앤다: `minmax(180px,1.4fr)` → `minmax(0px,1.4fr)`.
그러면 fr이 남은 폭만 흡수해 트랙 합이 minWidth 안에 들어오고 배경이 전 컬럼을
덮는다. 모바일 전용이면 `addrTrack = isMobileApp ? "minmax(0px,1.4fr)" : 원래값`
변수로 분기하고 헤더·행 gridTemplateColumns **양쪽**에 동일 적용(컬럼 드리프트 방지).

**How to apply:** 마지막 컬럼 배경/색 잘림 = 트랙 합 > 컨테이너 폭 의심.
minWidth를 키우는 대신 fr 하한 제거가 더 안전(모든 역할/권한 동시 해결).
