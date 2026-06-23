---
name: 접수번호 미리보기는 저장값을 미러링
description: intake 화면 접수번호 표시는 라이브 예측이며 서버 저장 로직과 반드시 일치해야 함
---

접수(intake) 화면의 접수번호 칸은 고정값이 아니라 입력에 따라 재계산되는 **라이브 미리보기**다. 표시되는 prefix는 서버가 저장 시점에 부여할 실제 번호를 미러링한다.

**핵심 설계:** 시스템은 같은 보험사고번호(insuranceAccidentNo)의 건들을 **하나의 prefix로 묶는다**(getNextCaseSequence가 기존 prefix 재사용, 새 suffix 부여). 지급정보·상태 변경의 형제건(sibling) 자동 동기화가 이 prefix 그룹(=caseGroupId)에 의존한다.

**Why:** "접수번호가 입력 중 생겼다가 변한다"는 신고가 있었는데, 이는 버그가 아니라 보험사고번호 입력 전 임시 추측값(오늘 새 prefix)이 입력 후 정답(기존 그룹 prefix)으로 교정되는 정상 동작이었다. 사용자가 "오늘 새 번호로 고정"을 원했지만, 미리보기만 바꾸면 표시≠저장이 되고, 서버까지 바꾸면 그룹핑/형제동기화가 깨진다.

**How to apply:** 미리보기는 절대 서버 저장 로직과 다르게 만들지 말 것. "변하는" 불편을 없애려면 보험사고번호 입력 전엔 미리보기를 비우고(predictedPrefix 사용을 hasAccidentNo로 게이팅 + 빈값일 때 fetch 생략/초기화), 입력 후 서버 prefix로 1회만 표시. 빠른 타이핑 out-of-order 응답은 effect cleanup의 cancelled 플래그로 차단. useMemo 게이팅이 insuranceAccidentNo에 의존하면 deps 배열에도 반드시 추가(안 하면 삭제 시 즉시 안 비워짐).
