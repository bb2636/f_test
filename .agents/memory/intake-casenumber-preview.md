---
name: 접수번호 prefix 정책(묶음 공유 안 함) + 미리보기 미러링
description: 신규 접수는 항상 그 날짜의 새 순번 prefix를 받는다(보험사고번호 묶음 prefix 재사용 폐지). 미리보기는 저장 로직을 미러링.
---

접수(intake) 화면의 접수번호 칸은 고정값이 아니라 입력에 따라 재계산되는 **라이브 미리보기**다. 표시 prefix는 서버가 저장 시 부여할 실제 번호를 미러링해야 한다.

**현행 정책 (2026-06-23 변경):** `getNextCaseSequence(date, insuranceAccidentNo)`의 **보험사고번호 prefix 재사용 분기를 제거**했다(DbStorage·MemStorage 양쪽). 이제 신규 접수는 보험사고번호가 기존 건과 같아도 **항상 해당 date 기준의 새 순번 prefix**를 받는다. `insuranceAccidentNo` 인자는 호출부 호환을 위해 남겨두되 prefix 산정엔 미사용(`void`).

**같은 사고에 케이스 추가는 prefix를 어떻게 잇나:** 같은 접수 1건 내 손해방지(-0)+피해세대(-1)는 한 번 만든 prefix를 공유(둘다 경로). 기존 사고에 피해세대를 더하는 정식 흐름은 **`parentCasePrefix` + `getNextVictimSuffix`**(추가 피해세대 액션)로 prefix를 명시적으로 잇는다 — 이건 그대로 유지된다.

**Why:** "새 접수 번호가 260623…였다가 260601…(기존 묶음 옛 날짜)로 바뀌고 -0 중복으로 접수 실패" 신고. 원인은 재사용 분기가 기존 그룹의 옛 prefix(옛 날짜 인코딩)를 가져오고, 그 묶음에 이미 -0이 있으면 또 -0을 만들어 23505. 사용자가 "새 접수는 항상 오늘 날짜 새 번호, 묶음 공유 안 함"을 명시 선택. 재사용 제거로 날짜 드리프트와 -0 충돌이 동시에 해소(날짜기반 경로는 항상 maxSeq+1 새 prefix라 -0 신선).

**그룹핑 키 2종 주의(split-brain, 이번 변경의 영향 범위):**
- **prefix 기반**: `getCasesByGroupId`(이름과 달리 `LIKE prefix%`), 인보이스(`caseGroupPrefix`), `syncIntakeDataToRelatedCases`, 현장조사 동기화. → 신규 접수가 새 prefix를 받으므로 **다른 접수와는 prefix 그룹에서 분리됨**(= 사용자가 원한 "묶음 공유 안 함"). 같은 접수 내/추가피해세대는 prefix 공유라 정상 동작.
- **insuranceAccidentNo(=caseGroupId) 기반**: 상태/지급정보 sibling 동기화(routes.ts:3318,3459), sibling 삭제(routes.ts:2848). → **이번 변경과 무관, 기존대로** 같은 사고번호면 계속 동기화. 사용자가 말한 "자동 동기화 기능"은 이쪽이라 보존.

**How to apply:** 미리보기는 절대 서버 저장 로직과 다르게 만들지 말 것. 보험사고번호로 prefix를 다시 묶고 싶다는 요구가 오면 정책을 되돌리기 전에 두 그룹핑 키(prefix vs caseGroupId)를 먼저 통일할지 결정. caseGroupId까지 접수별 고유로 바꾸면 상태/지급 sibling 동기화가 끊기니 사용자 의도 재확인 필수.
