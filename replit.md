# FLOXN - Water Damage Management System

## Run & Operate
- To run tests: `npm test`
- Environment Variables: `PII_ENCRYPTION_KEY` (64-char hex), `UPLOAD_PRESIGNED_ONLY`, `UPLOAD_MULTIPART_FALLBACK`, `UPLOAD_DB_FALLBACK`, `STORAGE_HEALTHCACHE_SUCCESS_TTL_SEC`, `STORAGE_HEALTHCACHE_FAILURE_TTL_SEC`.

## Stack
- Frontend: React, TypeScript, Wouter (routing), TanStack Query (data fetching), React Hook Form (forms) with Zod (validation), Shadcn UI, Tailwind CSS, Lucide React (icons).
- Backend: Express.js, bcrypt, express-session, memorystore, Zod (API validation).
- Database: PostgreSQL (Neon-backed) with Drizzle ORM.
- Build Tool: _Populate as you build_

## Where things live
- `client/`: Frontend source code.
    - `client/src/lib/auto-save-scheduler.ts`: Auto-save logic.
    - `client/src/pages/field-estimate.tsx`: Core estimate management logic.
    - `client/src/pages/admin-settings/`: Admin panel components.
- `server/`: Backend source code.
    - `server/routes.ts`: API route definitions.
    - `server/storage.ts`: Database interaction logic.
    - `server/crypto.ts`: PII encryption utilities.
    - `server/pii-service.ts`: PII handling services.
    - `server/backfill-pii.ts`: PII auto-backfill on startup.
    - `server/auto-schema-sync.ts`: Automatic DB schema migration.
    - `server/font-loader.ts`: Font loading and caching.
    - `server/email-templates/`: Email template modules.
    - `server/solapi.ts`: Solapi SMS/LMS integration.
    - `server/validators/`: Zod API validation schemas.
- `docs/pii-encryption-guide.md`: PII encryption guide.
- `design_guidelines.md`: UI/UX design guidelines (Do not modify).
- DB Schema: Managed by Drizzle ORM and `server/auto-schema-sync.ts`.
- API Contracts: Defined by Zod schemas in `server/validators/`.

## Architecture decisions
- **PII Encryption**: AES-256-GCM encryption for sensitive DB data with SHA-256 for duplicate checks. Transitional mode retains plain columns.
- **Server-side Caching**: Multi-layer caching for user and case data with robust invalidation.
- **Role-Based Access Control**: Comprehensive RBAC with roles like Assessor, Investigator, Insurer, Partner, Client, Administrator.
- **Date Handling**: All date creations are in Korean Standard Time (KST).
- **Automated Schema Sync**: Essential DB migrations (`ALTER TABLE IF NOT EXISTS`) are automatically applied on server startup for both DEV and PROD environments.

## Product
- **Core Functionality**: Digitalizes and automates the entire water damage insurance claim workflow from reception to settlement.
- **User Roles**: Supports insurance companies, platform administrators, repair companies, clients, assessors, and investigators.
- **Document Automation**: Automates generation, transmission, and approval of documents.
- **Admin Panel**: For user management and master data configuration.
- **Dashboard**: Intuitive overview with key metrics.
- **Case Intake**: Multi-section form for new insurance claims.
- **Field Survey Workflow**: Drawing creation, document upload (presigned URLs), estimate management (with versioning, PDF/Excel export, recovery area sync), and field reports.
- **Finance & Settlement**: Statistics, receivables, payment matching, and invoice systems (reusable and field dispatch cost).
- **Progress Management**: Tracks case progress, approvals, rejections, and notifications.
- **Master Data Management**: Admin-only feature for managing dropdown options.

## User preferences
- I prefer simple language.
- I want iterative development.
- Ask before making major changes.
- I prefer detailed explanations.
- Do not make changes to the `design_guidelines.md` file.
- Features may be added but NEVER removed - maintain all functionality from documentation
- 헤더 디자인과 네비게이션 기능은 절대 변경 금지 (Top header design and navigation ABSOLUTELY NEVER change)

## Pagination convention
- `client/src/lib/use-compact-pagination.ts` (10건/페이지 기본) + `client/src/components/ui/compact-pagination.tsx`.
- `< >` = 데이터 페이지 ±1. `<< >>` = 하단 번호 그룹 표시만 ±10 이동(currentPage 유지). 그룹 내 번호 클릭 시에만 currentPage 변경.
- 검색/필터 변경 시 `useEffect`로 `setPage(1)` 호출.
- 적용 페이지: settlement-action, closed-case-statistics, unsettled-case-statistics (확장 예정: 종합진행관리/정산청구/접수취소).

## Gotchas
- **Estimate Versioning**: `createdAt` for an estimate version (v1) is immutable; `updatedAt` reflects the latest save.
- **Recovery Area Sync Cutoff**: Automatic synchronization of recovery area data to labor/material costs only applies to cases created after `AUTO_SYNC_CUTOFF_KST` (currently "2026-04-24T13:00:00+09:00"). Manual sync is always available.
- **Ilwidaega Overrides**: New Excel uploads of unit prices (`D` values) automatically clear existing `unit_price_overrides` to ensure the new data is reflected.
- **Nusutamji (Leak Detection) Expenses**: Labor costs related to leak detection are automatically marked as expenses (`includeInEstimate=false`) and excluded from general management fees/profit calculation.
- **Labor Row Locking**: Rows marked `lockedAtSave` (`lockedAtSave && damageArea > 0 && amount > 0`) are protected from automatic synchronization overwrites. Exceptions for `damageArea=0` or `amount=0` allow self-correction.
- **협력사(Partner) 노무비 자동연동** (2026-05-06): 협력사 작성 중(isReadOnly=false)에는 (1) 노무비 탭 진입 sync 발동, (2) 면적 변경→노무비 자동반영(source-guard 면제), (3) 자동저장 허용. 자동저장 차단 분기는 `field-estimate.tsx` `isPartnerSession`(L6433) `() => !currentUser || (isPartner && isReadOnly)` + `auto-save-scheduler.ts` L89. 협력사 제출 후엔 자동저장 차단(원본 보존). 관리자 직접 추가행은 `isLinkedFromRecovery=false`로 `syncLaborFromRecoveryArea`(L1277)에서 보존.
- **DB Connection Stability**: PostgreSQL connection pools are configured for resilience with auto-reconnect for Neon WebSocket issues.

## Pointers
- Relevant skills: React, TypeScript, Express.js, PostgreSQL, Drizzle ORM, Zod, Tailwind CSS.
- External docs: TanStack Query, React Hook Form, Shadcn UI, Solapi SMS/LMS API, Neon DB.