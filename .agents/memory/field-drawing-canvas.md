---
name: field-drawing 캔버스 선택/삭제 동작
description: field-drawing.tsx 도형 선택·삭제·컨트롤 패널 위치의 비자명한 함정
---

# field-drawing 캔버스 선택/삭제 함정

## 컨트롤 패널이 화면 밖으로 나감
사각형(및 이미지/사고영역) 컨트롤 패널(삭제 버튼 포함)은 도형의 x좌표(`x * DISPLAY_SCALE`, DISPLAY_SCALE=0.05)에 **왼쪽 정렬**된다. 캔버스 오른쪽에 그린 도형은 패널이 캔버스 폭을 넘어가 삭제 버튼이 안 보인다.
**적용:** 패널 left는 `canvasRef.current.clientWidth` 기준으로 clamp해야 함.

## z-index 적층으로 선택이 가로채짐
zIndex: 사각형 5/15 < 사고영역 50/60 < 누수마커 100/110. 사고영역은 반투명 배경에 pointerEvents가 살아있어, 사각형이 사고영역/마커에 겹치면 클릭이 위 요소에 먹혀 사각형 선택 불가.
**Why:** "포인터 모드에서 사각형 클릭/삭제가 안 됨" 리포트의 잠재 원인. 단, 빈 캔버스에 새로 그린 단일 사각형은 겹침이 없어 해당 안 됨.
**적용:** 겹침 상황 선택 보장이 필요하면 hit-test 우선순위 또는 레이어 토글 설계 필요(시각적 적층 변경 트레이드오프 → 사용자 합의 필요).

## 키보드 삭제
데스크톱 관리자는 Delete/Backspace로 선택 항목 삭제 기대. INPUT/TEXTAREA/contentEditable 포커스 및 isReadOnly(협력사) 시 무시.

## locked 교착이 진짜 원인이었음 + DB 환경 분리 함정 (확정)
"잠긴(locked:true) 사각형은 클릭해도 선택이 안 돼서 잠금해제/삭제가 원천 불가" — 구버전 코드에서 handleRectangleMouseDown이 `setSelectedRectangleId` 전에 `if(rect.locked) return`을 실행해 교착. 한 번 잠그면 선택·해제·삭제 모두 막힘.
**중요(DB 환경 함정):** 운영 DB는 한 개가 아님. 메인 PROD(ep-gentle-base)엔 이 케이스(예: 260604018-0)가 없어 locked 집계가 0건으로 나왔지만, 실제 문제 케이스는 **별도 배포 DB**에 있었음. → "PROD에서 0건"을 근거로 locked를 섣불리 배제하지 말 것. case_number ILIKE로 못 찾으면 다른 배포 DB 의심.
**수정(반영·배포 완료):** image/rectangle/accident-area mousedown 모두 선택 setter들을 먼저 실행하고 그 뒤에 `if(locked) return`(이동/리사이즈만 차단). 잠긴 도형도 클릭하면 선택→패널에서 잠금해제/삭제 가능.
**잔여 엣지케이스:** 잠긴 도형이 캔버스 밖(예: x가 매우 큰 값)으로 완전히 벗어나면 클릭 자체가 불가 → 선택 기반 삭제로도 못 지움. 필요시 "전체 선택/목록에서 삭제" 같은 위치무관 진입점 고려.
