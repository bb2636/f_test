---
name: 이메일 master 참조(CC)와 단체발송
description: master@floxn.co.kr 참조가 어디서 1회 붙는지, 수신자별 루프 발송이 왜 참조를 중복시키는지
---

# 이메일 참조(master CC)는 발송 헬퍼 내부에서 1회만 붙는다 → 단체발송은 to 콤마결합 1회 호출

참조(master@floxn.co.kr)는 `server/hiworks-email.ts`의 `sendEmailWithAttachment`가
`to`에 master가 들어있지 않을 때만 CC로 1회 추가한다(`MASTER_CC_EMAIL` 중복 가드).

**Why:** 그래서 수신자별로 `sendEmailWithAttachment`를 반복 호출(루프 발송)하면
호출 횟수만큼 master에게 참조 메일이 중복 도착한다. 접수취소·현장출동보고서 발송이
이 문제로 master가 인원수만큼 메일을 받았다.

**How to apply:** 같은 본문/첨부를 여러 명에게 보낼 때는 루프 발송하지 말고,
수신자들을 `to: emails.join(", ")` 로 묶어 **1회만** 호출한다(단체발송). 그러면 참조도 1건.
- 보내기 전 `trim()+toLowerCase()` 기준으로 중복 수신자 제거(첫 등장 표기 유지) 권장 — 카운트 부풀림/중복 To 방지.
- 진행상황 폴링/상태자동전환이 `successCount`에 의존하면, 단일 발송 성공 시 결과 배열을 수신자 수만큼 채워 기존 카운트 로직을 유지한다.
