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

## locked는 "클릭/커서 안됨" 증상의 원인이 아님 (확인됨)
PROD 207개 도면 전체에서 locked=true인 사각형/사고영역 0개. clone-drawing(가져오기)도 사각형을 잠그지 않음(원본 그대로 복사). handleCanvasClick/handleCanvasMouseDown은 pointer 모드에서 선택 해제 안 함. 도형 mousedown은 stopPropagation으로 선택 setter 실행 → 잠금없는 도형 선택/패널은 정상 동작.
**Why:** "배포 화면에서 사각형 hover시 커서 안변함+클릭안됨"은 locked 교착이 아니라 **배포 아티팩트가 구버전**(패널 clamp/키보드삭제/locked-selectable 수정 미반영)이라서임. 재배포로 해결.
**적용:** locked 가설 재추적 금지. 현장 버전 불일치 의심 시 빌드 SHA/버전 배지로 확정.
