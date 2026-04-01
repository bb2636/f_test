# 암호화/해시/마스킹 감사 문서

**프로젝트**: 누수 사고 관리 시스템 (FLOXN Co., Ltd.)  
**작성일**: 2026-04-01  
**대상 범위**: 프론트엔드(React/Vite), 백엔드(Express), 데이터베이스(PostgreSQL/Neon)

---

## 1. 실제 암호화/해시 처리 항목

### 1-1. 비밀번호 해시

| 대상 | 방식 | 적용 위치 | 실제 암호화 여부 | 비고 |
|------|------|-----------|:---:|------|
| 사용자 비밀번호 (DB 저장) | bcrypt (salt rounds: 10) | `server/storage.ts` | ✅ 해시 | 단방향 해시, 복호화 불가 |
| 비밀번호 검증 (로그인) | bcrypt.compare | `server/storage.ts` → `verifyPassword()` | ✅ 해시 비교 | 해시값과 입력값 비교 |
| 비밀번호 변경 | bcrypt.hash | `server/storage.ts` → `changePassword()` | ✅ 해시 | 새 비밀번호를 해시 후 저장 |
| 비밀번호 초기화 (관리자) | bcrypt.hash | `server/storage.ts` → `changePassword()` | ✅ 해시 | 초기값("0000" 등)도 해시 처리 |
| 사용자 생성 시 초기 비밀번호 | bcrypt.hash("1234", 10) | `server/storage.ts` → `initializeDefaultUser()`, `createUser()` | ✅ 해시 | 기본 비밀번호도 평문 저장하지 않음 |

### 1-2. 세션/토큰 관리

| 대상 | 방식 | 적용 위치 | 실제 암호화 여부 | 비고 |
|------|------|-----------|:---:|------|
| 세션 ID | express-session 자동 생성 (uid-safe 기반 랜덤) | `server/index.ts` | ✅ 암호학적 난수 | 세션 ID 자체가 예측 불가능한 랜덤 문자열 |
| 세션 쿠키 서명 | HMAC (SESSION_SECRET 기반) | `server/index.ts` → `session({ secret })` | ✅ 서명 | `connect.sid` 쿠키에 `s:` 접두사 + HMAC 서명 |
| 세션 저장소 | connect-pg-simple (PostgreSQL `session` 테이블) | `server/index.ts` | ✅ 서버 측 저장 | 클라이언트에는 세션 ID만 전달 |
| 세션 캐시 | 인메모리 Map (SESSION_CACHE) | `server/index.ts` | ❌ 평문 캐시 | 성능 최적화용, 서버 메모리 내 60초 TTL |
| 중복 로그인 방지 | activeUserSessions Map (userId → sessionId) | `server/session-store.ts` | ❌ 평문 매핑 | 서버 메모리 내 관리 |

### 1-3. 쿠키 보안 설정

| 대상 | 방식 | 적용 위치 | 실제 암호화 여부 | 비고 |
|------|------|-----------|:---:|------|
| httpOnly | `true` (항상) | `server/index.ts` → `cookie.httpOnly` | ✅ 보안 설정 | JavaScript에서 쿠키 접근 차단 |
| secure | 운영: `true` / 개발: `false` | `server/index.ts` → `cookie.secure` | ✅ 보안 설정 | 운영 환경에서 HTTPS 전송만 허용 |
| sameSite | 운영: `'none'` / 개발: `'lax'` | `server/index.ts` → `cookie.sameSite` | ✅ 보안 설정 | CSRF 방어 |
| maxAge | 24시간 (86,400,000ms) | `server/index.ts` → `cookie.maxAge` | — | 세션 만료 시간 |

### 1-4. Object Storage 인증

| 대상 | 방식 | 적용 위치 | 실제 암호화 여부 | 비고 |
|------|------|-----------|:---:|------|
| Storage 접근 토큰 | Replit Sidecar token exchange (access_token) | `server/replit_integrations/object_storage/objectStorage.ts` | ✅ 토큰 기반 인증 | Sidecar 엔드포인트에서 토큰 발급 |
| Presigned URL (파일 업로드) | 서명된 URL (시간 제한) | `server/routes.ts` → `request-upload` | ✅ 서명 URL | 만료 시간 포함, 직접 업로드용 |

### 1-5. 이메일(SMTP) 인증

| 대상 | 방식 | 적용 위치 | 실제 암호화 여부 | 비고 |
|------|------|-----------|:---:|------|
| SMTP 비밀번호 | 환경변수 (`SMTP_PASSWORD`) | `server/hiworks-email.ts` | ✅ 환경변수 관리 | 코드에 평문 미포함, Replit Secrets로 관리 |
| SMTP 연결 | SMTPS (포트 465, TLS) | `server/hiworks-email.ts` | ✅ TLS 암호화 | 전송 구간 암호화 |

---

## 2. 마스킹 처리 항목 (시각적 가림, 암호화 아님)

| 대상 | 방식 | 적용 위치 | 실제 암호화 여부 | 비고 |
|------|------|-----------|:---:|------|
| 비밀번호 입력 필드 | `<input type="password">` | `client/src/pages/login.tsx`, `mobile-login.tsx`, `force-change-password-modal.tsx`, `my-page-dialog.tsx` | ❌ UI 마스킹 | 브라우저 렌더링 시 `●●●` 표시, 실제 값은 평문으로 전송 |
| DB URL 로그 출력 | 정규식 치환 (`//***:***@`) | `server/routes.ts` (디버깅 API) | ❌ 로그 마스킹 | 로그에서 DB 인증정보 가림 |
| API 응답에서 비밀번호 제외 | 구조분해 (`const { password, ...userWithoutPassword }`) | `server/routes.ts` (모든 사용자 API 응답) | ❌ 응답 필터링 | 비밀번호 해시값이 클라이언트에 전달되지 않도록 제거 |

---

## 3. 암호화되지 않는 항목 (평문 저장/전송)

| 대상 | 저장 방식 | 적용 위치 | 비고 |
|------|-----------|-----------|------|
| 사용자 이름/이메일/전화번호 | 평문 (PostgreSQL text 컬럼) | `shared/schema.ts` → `users` 테이블 | 개인정보이나 별도 암호화 없음 |
| 사건 정보 (주소, 전화번호 등) | 평문 (PostgreSQL text 컬럼) | `shared/schema.ts` → `cases` 테이블 (`clientPhone`, `addressDetail` 등) | 고객 연락처 포함 |
| 심사사/조사사 이메일 | 평문 (PostgreSQL text 컬럼) | `shared/schema.ts` → `cases` 테이블 (`assessorEmail`, `investigatorEmail`) | |
| 증빙자료 파일 데이터 (레거시) | Base64 인코딩 (PostgreSQL text 컬럼) | `shared/schema.ts` → `documents` 테이블 (`fileData`) | 인코딩 ≠ 암호화, 누구나 디코딩 가능 |
| 도면 캔버스 이미지 | Base64 인코딩 (PostgreSQL text 컬럼) | `shared/schema.ts` → `drawings` 테이블 (`canvasImage`) | PDF 생성용 스냅샷, 암호화 아님 |
| 로그인 요청 (비밀번호 전송) | HTTPS (TLS) | 클라이언트 → 서버 | 전송 구간은 TLS로 보호, 서버 도착 시 평문 |

---

## 4. 환경변수/시크릿 관리

| 대상 | 관리 방식 | 비고 |
|------|-----------|------|
| `SESSION_SECRET` | Replit Secrets | 운영에서 필수, 미설정 시 서버 시작 거부 |
| `DATABASE_URL` | Replit Secrets | Neon PostgreSQL 연결 문자열 |
| `SMTP_PASSWORD` | Replit Secrets | 이메일 발송용 SMTP 인증 |
| `SMTP_USER` | Replit Secrets / 환경변수 | SMTP 사용자 계정 |

---

## 5. 요약

| 구분 | 항목 수 | 주요 내용 |
|------|:---:|------|
| ✅ 실제 해시/암호화 | 5개 영역 | 비밀번호(bcrypt), 세션(HMAC 서명), 쿠키(httpOnly/secure), Storage(토큰/서명URL), SMTP(TLS) |
| ⚠️ 마스킹 (비암호화) | 3개 항목 | 비밀번호 입력 UI, DB URL 로그, API 응답 필터링 |
| ❌ 평문 저장 | 6개 항목 | 개인정보(이름/이메일/전화번호), 사건정보, 파일 데이터(Base64) |

### 보안 개선 권고사항

1. **개인정보 컬럼 암호화**: 전화번호, 이메일 등 개인정보를 AES-256 등으로 암호화 저장 검토
2. **Base64 파일 데이터**: 레거시 `fileData` 컬럼은 인코딩일 뿐 암호화가 아님, Object Storage 전환 완료 시 제거 권장
3. **세션 비밀키 로테이션**: `SESSION_SECRET` 주기적 교체 정책 수립 권장
