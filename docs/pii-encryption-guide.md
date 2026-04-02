# 개인정보(PII) 암호화 구현 가이드

**프로젝트**: 누수 사고 관리 시스템 (FLOXN Co., Ltd.)  
**작성일**: 2026-04-02  
**적용 방식**: AES-256-GCM 대칭키 암호화 + SHA-256 해시 (중복 체크용)

---

## 1. 개요

DB에 평문 저장되던 개인정보(전화번호, 이메일, 주소, 주민등록번호 등)를 AES-256-GCM으로 암호화하여 저장합니다. 이메일/전화번호 중복 체크가 필요한 필드는 정규화 후 SHA-256 해시 컬럼도 함께 저장합니다.

### 핵심 설계 원칙

- **점진 적용**: 기존 평문 컬럼 유지 + 새 `_enc`/`_hash` 컬럼 병행 (과도기)
- **자동 백필**: 서버 시작 시 `_enc` 컬럼이 비어있는 레코드를 자동 암호화
- **투명 복호화**: storage 레이어에서 읽을 때 자동 복호화 → API/프론트엔드 변경 없음
- **비활성화 가능**: `PII_ENCRYPTION_KEY` 미설정 시 기존 평문 모드로 동작

---

## 2. 암호화 대상 필드

### 2-1. users 테이블

| 평문 컬럼 | 암호화 컬럼 | 해시 컬럼 | 비고 |
|-----------|------------|----------|------|
| `email` | `email_enc` | `email_hash` | 정규화: lowercase + trim |
| `phone` | `phone_enc` | `phone_hash` | 정규화: 숫자만 추출 |
| `address` | `address_enc` | — | |
| `address_detail` | `address_detail_enc` | — | |

### 2-2. cases 테이블

| 평문 컬럼 | 암호화 컬럼 | 해시 컬럼 | 비고 |
|-----------|------------|----------|------|
| `client_phone` | `client_phone_enc` | `client_phone_hash` | 정규화: 숫자만 추출 |
| `client_contact` | `client_contact_enc` | — | |
| `client_address` | `client_address_enc` | — | |
| `assessor_contact` | `assessor_contact_enc` | — | |
| `assessor_email` | `assessor_email_enc` | `assessor_email_hash` | 정규화: lowercase + trim |
| `investigator_contact` | `investigator_contact_enc` | — | |
| `investigator_email` | `investigator_email_enc` | `investigator_email_hash` | 정규화: lowercase + trim |
| `policy_holder_id_number` | `policy_holder_id_number_enc` | — | 주민등록번호 |
| `policy_holder_address` | `policy_holder_address_enc` | — | |
| `insured_id_number` | `insured_id_number_enc` | — | 주민등록번호 |
| `insured_contact` | `insured_contact_enc` | — | |
| `insured_address` | `insured_address_enc` | — | |
| `insured_address_detail` | `insured_address_detail_enc` | — | |
| `victim_contact` | `victim_contact_enc` | — | |
| `victim_address` | `victim_address_enc` | — | |
| `victim_address_detail` | `victim_address_detail_enc` | — | |
| `assigned_partner_contact` | `assigned_partner_contact_enc` | — | |

---

## 3. 수정된 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `server/crypto.ts` | **신규** — AES-256-GCM 암/복호화, SHA-256 해시, 정규화 함수 |
| `server/pii-service.ts` | **신규** — 사용자/케이스 PII 필드 암호화/복호화/스트립 서비스 |
| `server/backfill-pii.ts` | **신규** — 기존 평문 데이터를 암호화로 백필하는 스크립트 |
| `shared/schema.ts` | **수정** — `_enc`, `_hash` 컬럼 추가 (users, cases) |
| `server/storage.ts` | **수정** — CRUD 시 암호화/복호화 통합 |
| `server/routes.ts` | **수정** — API 응답에서 `_enc`/`_hash` 컬럼 자동 제거 |
| `server/index.ts` | **수정** — 서버 시작 시 백필 자동 실행 |

---

## 4. 암호화 방식 상세

### 4-1. AES-256-GCM 암호화 (`encryptPii`)

```
저장 형식: {IV(base64)}:{AuthTag(base64)}:{Ciphertext(base64)}

- 알고리즘: AES-256-GCM
- IV 길이: 12바이트 (랜덤 생성)
- AuthTag 길이: 16바이트
- 키 길이: 32바이트 (64자 hex 문자열)
```

### 4-2. SHA-256 해시 (`hashPii`)

```
이메일 정규화: trim() + toLowerCase()
전화번호 정규화: 숫자만 추출 (하이픈/공백 제거)
해시 결과: 64자 hex 문자열
```

### 4-3. 중복 체크 방법

```sql
-- 이메일 중복 체크 예시
SELECT * FROM users WHERE email_hash = SHA256('example@test.com');
```

---

## 5. 환경변수

| 변수명 | 용도 | 형식 | 필수 여부 |
|--------|------|------|-----------|
| `PII_ENCRYPTION_KEY` | AES-256 암호화 키 | 64자 hex 문자열 (32바이트) | 선택 (미설정 시 암호화 비활성) |

### 키 생성 방법

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 6. 마이그레이션 방법

### 6-1. 스키마 적용

```bash
# 개발 DB
DATABASE_URL="$DEV_DATABASE_URL" npx drizzle-kit push --force

# 운영 DB
DATABASE_URL="$PROD_DATABASE_URL" npx drizzle-kit push --force
```

### 6-2. 백필 실행

- **자동**: 서버 시작 시 `PII_ENCRYPTION_KEY`가 설정되어 있으면 자동으로 실행됨
- `_enc` 컬럼이 NULL인 레코드만 처리 (멱등성 보장)
- 개발 DB 기준: Users 42명 + Cases 40건 → 약 35초 소요

### 6-3. 과도기 운영

현재 단계에서는 **평문 컬럼과 암호화 컬럼이 모두 존재**합니다:

1. **쓰기**: 평문 + `_enc` + `_hash` 모두 저장
2. **읽기**: `_enc` 우선 복호화, 없으면 평문 fallback
3. **API 응답**: `_enc`/`_hash` 컬럼은 자동 제거

### 6-4. 향후 평문 컬럼 제거 (최종 단계)

백필 완료 후 충분한 검증 기간을 거친 뒤:

1. 모든 `_enc` 컬럼이 채워졌는지 확인
2. 평문 컬럼을 NULL로 초기화 (`UPDATE users SET email = NULL WHERE email_enc IS NOT NULL`)
3. 정상 동작 확인 후 스키마에서 평문 컬럼 제거

---

## 7. 주의사항

### 7-1. 키 관리

- `PII_ENCRYPTION_KEY`를 분실하면 **암호화된 데이터 복구 불가** — 반드시 별도 백업
- 키 로테이션 시 모든 `_enc` 컬럼을 새 키로 재암호화해야 함

### 7-2. 검색 기능

- 주소/전화번호 등의 **부분 검색(LIKE 검색)**은 암호화된 상태에서 불가
- 현재 과도기에는 평문 컬럼이 남아있어 기존 검색이 동작함
- 평문 컬럼 제거 시: 클라이언트 사이드 검색 또는 별도 검색 인덱스 구현 필요

### 7-3. 로그

- API 요청/응답 로그에 PII가 노출될 수 있음 — 현재 routes.ts의 `_enc`/`_hash` strip은 JSON 응답에만 적용
- 추가 보안이 필요하면 로그 미들웨어에서 PII 마스킹 처리 권장

### 7-4. 성능

- 암호화/복호화 오버헤드: 건당 ~0.1ms (무시 가능)
- 백필: 레코드당 ~400ms (DB 왕복 포함, 배치 처리 가능)
- 해시 조회: 평문 조회와 동일 성능 (인덱스 적용 가능)

### 7-5. PDF/이메일 서비스

- `server/pdf-lib-service.ts`, `server/invoice-pdf-service.ts`, `server/hiworks-email.ts`
- 이 서비스들은 storage 레이어를 통해 복호화된 데이터를 받으므로 변경 불필요
