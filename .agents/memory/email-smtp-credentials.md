---
name: SMTP 자격증명 일원화
description: 메일 발송 경로별로 다른 비밀번호 env를 쓰다 일부만 인증실패한 사고와 그 규칙
---

# SMTP 비밀번호 env 드리프트 → 일부 경로만 535 인증실패

여러 메일 발송 경로가 **서로 다른 비밀번호 환경변수**를 참조하다가, 그 중 하나만
만료/오타가 나면서 해당 경로만 조용히 실패했다.
- 유효: `SMTP_PASSWORD`(+`MAIL_APP_PASSWORD`) — hiworks-email.ts(현장출동보고서 등) 사용, 정상.
- 무효: `SMTP_PASS` — invoice-pdf-service.ts / routes.ts `/send-pdf` 가 단독 사용 → 535 EAUTH.

**규칙(How to apply):** 새 메일 발송 코드는 비밀번호를 반드시
`process.env.SMTP_PASSWORD || process.env.MAIL_APP_PASSWORD || process.env.SMTP_PASS`
순으로 해석한다(검증된 자격증명 우선, 구버전은 마지막 폴백). 호스트/유저/포트는
공유 env(SMTP_HOST/SMTP_USER/SMTP_PORT)로 이미 통일돼 있음.

**Why:** 같은 발신 계정인데도 비밀번호 env가 둘로 갈라져 드리프트하면
"왜 어떤 메일만 안 가지?"가 재발한다. 자격증명은 단일 소스로 모아야 한다.

## 진단 팁 (중요)
"SMTP 설정을 확인해주세요" 토스트/메시지는 **설정 누락이 아니라 send-time 인증실패(535)**
일 수 있다. 코드의 guard 문구만 보고 env 누락이라 단정하지 말 것.
- SMTP는 `nodemailer.verify()`만으로는 부족 — verify가 통과해도 다른 비밀번호로 만든
  transporter는 실제 sendMail에서 535날 수 있다. 워크스페이스 루트에서 임시 .cjs로
  `require('nodemailer')` 후 verify+실발송(회사 자기주소로)으로 경로별 자격증명을 실측하라.
- code_execution 샌드박스에는 process.env(시크릿)가 없다 → bash로 node 스크립트 실행해야
  실제 env가 주입된다. /tmp에서 실행하면 nodemailer 모듈 못 찾음 → 워크스페이스 루트에서 실행.
