# 누수 사고 관리 시스템 (Water Damage Management System - FLOXN)

## Overview
본 시스템은 **누수 사고의 접수부터 현장조사, 견적, 정산, 통계, 기준정보 관리까지 전 과정을 디지털화한 통합 관리 플랫폼**입니다. This comprehensive Insurance Accident Management System digitalizes and automates the entire workflow for water damage insurance claims. It serves insurance companies, platform administrators (FLOXN), repair companies, clients, assessors, and investigators, focusing on automating document generation, transmission, and approvals. The platform features robust role-based authentication, an administrator panel for user management, and an intuitive dashboard, all built with a clean, responsive UI/UX and clear FLOXN branding.

## User Preferences
- I prefer simple language.
- I want iterative development.
- Ask before making major changes.
- I prefer detailed explanations.
- Do not make changes to the `design_guidelines.md` file.
- **CRITICAL**: Features may be added but NEVER removed - maintain all functionality from documentation
- **CRITICAL x3**: 헤더 디자인과 네비게이션 기능은 절대 변경 금지 (Top header design and navigation ABSOLUTELY NEVER change)

## System Architecture
The system is a full-stack web application utilizing a React-based frontend and an Express.js backend.

### UI/UX Decisions
- **Language**: Korean-first interface using Pretendard and Noto Sans KR fonts.
- **Branding**: FLOXN branding with a distinctive cream/orange and purple/blue gradient background.
- **Responsiveness**: Designed for optimal viewing across mobile, tablet, and desktop devices.
- **Theming**: Supports dark mode.
- **Feedback**: Implements loading and error states.
- **Design Guidelines**: Adherence to a strict design guide emphasizing consistent spacing, blur effects, and Noto Sans KR font, prioritizing accessibility.

### Technical Implementations
- **Authentication**: Username-based login, bcrypt for password hashing, express-session with PostgreSQL session store for persistent session management, DB-based single-session enforcement (users.current_session_id / last_login_at — duplicate login from another device invalidates the previous session with 401 + DUPLICATE_LOGIN code), common auth middleware on all /api/* routes, and robust role-based access control (Assessor, Investigator, Insurer, Partner, Client, Administrator) with protected routes.
- **PII Encryption**: AES-256-GCM encryption for personal data stored in DB (`server/crypto.ts`, `server/pii-service.ts`). SHA-256 hash columns for email/phone duplicate checks. Controlled by `PII_ENCRYPTION_KEY` env var (64-char hex). Transitional mode: plain columns retained alongside `_enc`/`_hash` columns. Auto-backfill on startup (`server/backfill-pii.ts`). API response middleware strips encrypted columns. Guide: `docs/pii-encryption-guide.md`.
- **Server-side Caching**: Multi-layer caching strategy for performance including user and case data, with invalidation on create/update/delete operations.
- **User Management (Admin)**: Features a user account table with search, role-based filtering, detailed viewing/editing modals, and a two-step account creation flow with validation, password generation, and soft deletion. Includes super admin access control.
- **Case Intake System**: Multi-section collapsible form for new insurance claim cases, including automatic case number generation and extensive fields.
- **Date Handling**: All date creations are in Korean Standard Time (KST).

### Feature Specifications
- **Home**: Overview of progress, key metrics, and quick navigation.
- **Reception Management**: New water damage case registration and management, including assigning repair companies, with a read-only mode by default for case details.
- **Field Survey Workflow**: A sequential process for managing field investigations.
  - **Drawing Creation**: Digital drawing workspace for damage scope with tools for images, rectangles, and leak markers, supporting high-resolution PNG export.
  - **Documents Upload**: Presigned URL 전용 업로드 시스템. (1) `POST /api/documents/request-upload` → storage auth 캐시 확인 후 presigned URL 발급, (2) 클라이언트가 Object Storage에 직접 PUT, (3) `POST /api/documents/complete-upload` → 메타데이터만 DB 저장 (file.exists 체크 생략, 빠른 응답). 운영 환경: presignedOnly=true, multipartFallback=false, dbFallback=false. 개발 환경: multipart/DB fallback 허용 (1MB 이하). PDF는 비동기 압축 (processing → ready, 실패 시 failed). `direct-upload`는 deprecated (Sunset: 2026-06-01). Storage auth 캐시: 성공 60초, 실패 30초. 환경변수: UPLOAD_PRESIGNED_ONLY, UPLOAD_MULTIPART_FALLBACK, UPLOAD_DB_FALLBACK, STORAGE_HEALTHCACHE_SUCCESS_TTL_SEC, STORAGE_HEALTHCACHE_FAILURE_TTL_SEC.
  - **Estimate Management**: Create and submit restoration cost estimates with dynamic calculation tables linked to master data, version tracking, and PDF/Excel export. Includes a Recovery Area Table and configurable Labor Rate Tiers.
  - **Field Reports**: Generate comprehensive reports integrating all collected field survey data.
- **Master Data Management**: Administrator-only feature for managing dropdown options used throughout the system.
- **Progress Management**: Track case progress, manage approvals/rejections, and send notifications. Includes a refined field survey approval workflow (Review → 1차승인 → 현장정보제출 → 복구요청). **진행단계 이력 자동 기록**: 발생일자 변경 시 `progress_updates` + `lmsSendHistory`에 자동 기록, 인보이스/현장출동비용 청구서 발송 시 `progress_updates`(추가 발송 구분 포함) + `lmsSendHistory`에 자동 기록. 추가 발송 여부는 케이스별 기존 상태("청구")를 기준으로 판단.
- **Finance & Settlement**: View statistics, manage settlements, track receivables, and match payments. Includes an Invoice System with two distinct types (Reusable Invoice and Field Dispatch Cost Invoice) and a feature for viewing historical pending cases. **인보이스 재청구 안전장치**: 진행단계를 PRE_CLAIM 상태(접수완료~출동비청구(선견적))로 되돌릴 때, claimDate 외에 invoiceDamagePreventionAmount, invoicePropertyRepairAmount, invoiceRemarks, fieldDispatchInvoiceAmount, fieldDispatchInvoiceRemarks, invoicePdfGenerated도 모두 null로 초기화되어, 재청구 시 최신 견적 금액으로 자동 fallback됨.
- **Statistics Grouping**: Cases are grouped by Union-Find algorithm using case-number prefix and insuranceAccidentNo as edges, ensuring transitive closure (A~B by prefix, B~C by accidentNo → all in one group). CSV export uses "-" for zero/null monetary values, matching table display. **출동비청구(선견적) 케이스 처리**: 순수 출동비청구 그룹/개별 건은 `fieldDispatchInvoiceAmount`를 견적/승인금액으로 표시하고, 날짜는 `claimDate`를 사용. 그룹 날짜는 `getGroupDate` 헬퍼로 그룹 내 최신 날짜를 선택.

### System Design Choices
- **Frontend**: React with TypeScript, Wouter for routing, TanStack Query for data fetching, React Hook Form with Zod for form validation, Shadcn UI and Tailwind CSS for component styling, and Lucide React for icons.
- **Backend**: Express.js, bcrypt, express-session, memorystore, and Zod for API validation.
- **Database**: PostgreSQL (Neon-backed) with Drizzle ORM for persistent data storage and automatic schema management.
- **DB 안정성**: 메인 풀 max=10, 세션 풀 max=5, `idleTimeoutMillis=20000`, `maxUses=7500`으로 연결 재활용. pool/client `error` 이벤트 핸들러 추가로 uncaught exception 방지. Neon WebSocket 연결 끊김 시 자동 재연결.
- **자동 스키마 동기화**: 서버 시작 시 `auto-schema-sync.ts`가 DEV·PROD DB 모두에 필수 마이그레이션 자동 실행 (ALTER TABLE IF NOT EXISTS 패턴). 새 컬럼 추가 시 해당 파일의 `migrations` 배열에 SQL 추가하면 다른 환경에서도 자동 적용.
- **일위대가 연동 설정**: `ilwidaega_link_settings` 테이블에서 위치(천장/벽면/바닥)별 공종+공사명 매핑을 관리자가 동적으로 설정 가능. 설정 항목은 복구면적 산출표의 드롭다운 옵션에 반영되며, 복구면적 → 노무비 자동 연동에 활용. DB 설정이 없으면 기존 하드코딩 기본값으로 fallback. 관리자 설정 > DB관리 > 일위대가 탭의 "일위대가 연동 설정" 버튼으로 접근.

### Refactoring Modules
- **`server/font-loader.ts`**: Pretendard TTF 폰트 로딩/캐싱/검증 통합 모듈. `loadPretendardRegular()`, `loadPretendardSemiBold()`, `loadPretendardFontPair()` export. 3개 PDF 서비스(pdf-lib-service, invoice-pdf-service, evidence-pdf-service)에서 공유.
- **`server/email-templates/`**: routes.ts에서 분리한 이메일 HTML/텍스트 템플릿 모듈. 각 파일은 순수 함수로 데이터를 받아 `{ html, text }` 반환.
  - `invoice-v1.ts` — INVOICE 송부 (단건 첨부, 구 버전)
  - `invoice-v2.ts` — INVOICE 전달 (다중 수신자, 로고 CID, 신 버전)
  - `field-dispatch-invoice.ts` — 현장출동비용 청구서
  - `field-report-v2.ts` — 현장출동보고서 v2 (로고 CID)
  - `cancellation.ts` — 접수취소 안내
  - `index.ts` — barrel export
- **`server/solapi.ts`**: Solapi SMS/LMS HMAC-SHA256 인증 헤더 생성(`createSolapiAuthHeader`) 및 HTTPS 요청 함수(`solapiHttpsRequest`) 통합 모듈. routes.ts 내 6개 SMS/LMS 발송 지점에서 공유.
- **`server/validators/`**: routes.ts에서 분리한 Zod 요청 검증 스키마 모듈.
  - `email-schemas.ts` — 이메일 발송 관련 스키마 6개 (sendFieldDispatchReportEmail, generateInvoicePdf, sendInvoiceEmailV2, sendFieldReportEmail, sendFieldReportEmailV2, cancellationEmail)
  - `sms-schemas.ts` — SMS/LMS 발송 관련 스키마 3개 (sendSms, sendCustomSms, sendCaseLms)
  - `misc-schemas.ts` — 기타 스키마 3개 (manualHistory, accountNotification, batchEstimates, pdfDownload)
  - `index.ts` — barrel export

## External Dependencies
- **Frontend Libraries**: React, TypeScript, Wouter, TanStack Query, React Hook Form, Zod, Shadcn UI, Tailwind CSS, Lucide React.
- **Backend Libraries**: Express.js, bcrypt, express-session, memorystore, Zod.
- **Database**: PostgreSQL (Neon-backed) with Drizzle ORM.