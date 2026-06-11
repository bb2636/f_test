---
name: 접수취소 연관 대물건(피해세대) 그룹핑 불일치
description: 접수취소 시 연관 케이스를 caseNumber 문자열 prefix로 묶어 누락되는 원인 — 정식 그룹키는 caseGroupId
---

# 접수취소 연관 건이 단건으로만 뜨는 원인

**증상**: 접수취소 시 같은 사고의 연관 대물건(피해세대/원인세대)이 함께 취소되어야 하는데
취소 확인 팝업에 클릭한 1건만 뜸.

**후보 생성 위치**: comprehensive-progress.tsx `handleStatusChange`(targetStatus==="접수취소" 분기).
전체 `cases`(/api/cases 전체 목록, 화면 필터/페이지네이션 아님)에서
`getCaseNumberPrefix(caseNumber)`가 같은 건을 후보로 모음.

**핵심 원인 — 그룹핑 기준 3종이 서로 다름**:
- 취소 후보(클라): `getCaseNumberPrefix`(InvoiceSheet.tsx) = caseNumber를 `-`로 잘라 **마지막 세그먼트만 제거**(`parts.slice(0,-1)`).
- 서버 연관조회: `getCasesByCaseNumberPrefix`(storage.ts) = `caseNumber.split("-")[0]`(**첫 토큰**) + LIKE.
- 세대 접미사 판정: `getCancelSuffix`(sms-notification-dialog.tsx) = `/-(\d+)$/`(**끝의 -숫자만**).
세 규칙은 `prefix-N`(하이픈 1개) 형식일 때만 우연히 일치. base에 하이픈이 있거나
(예: `YYMMDD-NNN-세대`), 원인세대가 접미사 없는 bare prefix(구형식)면 키가 어긋나
원인세대↔피해세대가 다른 그룹으로 분리됨.

**더 근본**: 시스템 정식 연관 키는 `caseGroupId`(schema: "동일 보험사고번호 내 케이스",
insuranceAccidentNo 기반, 서버 `getCasesByGroupId` 존재). 취소 후보는 이 caseGroupId를
안 쓰고 caseNumber 문자열 휴리스틱으로 재계산해서 깨짐. caseGroup<->caseNumber prefix가
항상 일치한다는 보장이 없음(별도 접수/번호채번 차이).

**Why**: 연관 건 묶음은 caseNumber 문자열이 아니라 caseGroupId(보험사고번호)가 진실원천.
**How to apply**: 접수취소/인보이스 등 "연관 건 모으기"는 caseGroupId(or 서버 getCasesByGroupId)
기준으로 해야 안전. 부득이 caseNumber로 묶을 땐 세 규칙(prefix/suffix)을 단일 헬퍼로 통일.

**확인법**: 실패 사고그룹의 실제 `case_number`, `case_group_id` 값 대조
(개발/프로덕션 replit DB는 cases 0건 → 실데이터는 다른 곳, 화면/실DB에서 직접 확인 필요).
