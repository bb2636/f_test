---
name: 비번변경 SMS 문자인증 / 고위험 리셋 가드
description: 비밀번호 변경 시 휴대폰 인증 흐름과 verificationCode 전달 방식, 고위험 일괄 리셋 엔드포인트 권한 가드
---

# 비번변경 SMS 문자인증

- 인증코드는 스키마 변경 없이 클라가 mutation payload에 `verificationCode`를 넣고, 서버는 `req.body.verificationCode`를 **직접** 읽어 검증한다.
  - **Why:** zod parse는 unknown 필드를 strip하지만 `req.body` 원본은 그대로 남으므로 schema(forceChangePasswordSchema/changeMyPasswordSchema)를 건드리지 않아도 됨.
  - **How to apply:** 서버 검증은 `if (user.phone) { verifyCode(user.id, code) }` — **phone 없으면 인증 생략**(락아웃 방지). 클라는 send-code가 NO_PHONE(400) 주면 `phoneRequired=false`로 전환해 인증 없이 변경 허용.
- 코드 저장/검증은 in-memory(server/auth-security.ts): TTL 5분, 재발송 쿨다운 60s. SMS 발송은 server/sms.ts(SOLAPI, byte>90이면 LMS).
- apiRequest는 raw `Response`를 반환하고 실패 시 `new Error("<status>: <body텍스트>")`를 throw한다.
  - **How to apply:** send-code 성공 body(masked phone)는 `await res.json()`으로 파싱. 에러 분기는 `error.message` 문자열 매칭("휴대폰 번호가 없"/"NO_PHONE")으로 판별. (`error.error` 같은 필드는 존재하지 않음 — 기존 코드의 `error?.error` 분기는 사실상 항상 fallback이었음.)

# 고위험 일괄 리셋 엔드포인트 가드

- `/api/reset-admin-passwords`(admin 전체 비번 1234 초기화)는 원래 전역 인증 미들웨어만 적용돼 **권한 체크가 없어** 일반 로그인 사용자도 호출 가능했음(권한 상승 취약점).
  - **Why:** 라우트 자체 가드가 없으면 세션만 있으면 통과 → 운영 탈취 가능.
  - **How to apply:** 고위험 일괄/파괴적 라우트는 라우트 진입부에서 `req.session.userId`(401) + `req.session.userRole==="관리자" && req.session.isSuperAdmin`(403) 명시 확인. 세션 role/isSuperAdmin은 login(서버 routes.ts ~299)과 /api/user에서 채워짐.
