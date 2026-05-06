# 누수 사고 관리 시스템 (Water Damage Management System - FLOXN)

## Overview
본 시스템은 **누수 사고의 접수부터 현장조사, 견적, 정산, 통계, 기준정보 관리까지 전 과정을 디지털화한 통합 관리 플랫폼**입니다. This comprehensive Insurance Accident Management System digitalizes and automates the entire workflow for water damage insurance claims. It serves insurance companies, platform administrators (FLOXN), repair companies, clients, assessors, and investigators, focusing on automating document generation, transmission, and approvals. The platform features robust role-based authentication, an administrator panel for user management, and an intuitive dashboard, all built with a clean, responsive UI/UX and clear FLOXN branding.

## Testing
- **자동 저장 회귀 테스트** (`client/src/lib/auto-save-scheduler.test.ts`): 탭 전환 시 자동 저장 동작의 4가지 회귀 시나리오(변경 없음 skip / 실 변경 저장 / 디바운스 윈도우 내 누락 방지 / 연속 no-op skip) + 협력업체 가드를 vitest로 검증. 자동 저장 트리거 로직은 `client/src/lib/auto-save-scheduler.ts`로 추출되어 React 외부에서 단위 테스트 가능. 실행: `npm test`.

## 2026-05-04 회귀 수정 (6종)
1. **협력업체 +/- 버튼 복구** (Bug 5): `material-cost-section.tsx` / `labor-cost-section.tsx`의 `(isPartner && isLinkedRow)` / `(isPartner && row.isLinkedFromRecovery)` 가드를 제거. 협력업체에서도 +/- 버튼 항상 노출, `isReadOnly`(제출 후 미반려)일 때만 disabled.
2. **노무비 수량 ".5" → "0.5" 표기 정규화** (Bug 4): `labor-cost-section.tsx` 수량 input에 `onBlur` 추가. blur 시 `parseFloat` 후 `String(num)`으로 표시값을 정규화 (산식·상태값은 onChange에서 처리되므로 미변경).
3. **자재비 보양재 중복 누적 차단** (Bug 1): `field-estimate.tsx` 자재비 dedup `useEffect`에서 `isPartnerRef.current` 가드 제거 — 협력업체에서도 동일 `공종|공사명` 키로 dedup 동작. 자동저장 차단은 별도 계층(저장 mutation)에서 그대로 유지.
4. **실크/합지 수량 합치기** (Bug 6): `8dca8f1` commit에서 dedup key를 `공종|공사명`(자재항목 제외)로 유지해 이미 fix됨. 추가 변경 없음.
5. **샘플견적 손방 화장실 — 원인공사 방수 보통인부 단가** (Bug 3): `applyLossPreventionSampleTemplate`에서 정확매칭(공종+공사명+노임항목/세부항목) 실패 시, 공사명+노임항목/세부항목으로 카탈로그 검색 → 후보가 정확히 1개일 때만 단가 채택(다수 후보면 모호성으로 폴백 포기). 단가>0 조건 추가. **[2026-05-04 후속]** 적용단가(`pricePerSqm`)가 0으로 남던 부수 회귀 보강: 손해방지 케이스는 복구면적(C)이 없어 `calculateAppliedUnitPriceWithTiers` 경로가 작동하지 않으므로, 샘플 적용 시 `pricePerSqm = matchedStandardPrice`(E)로 초기 채움 (수동 detailItem 선택 시 L1219의 동일 동작과 일치). 산식 미변경.
6. **석고보드 철거 수량/금액 누락 재발** (Bug 2): `field-estimate.tsx` L3478~3498(자동 동기화 reconcile의 철거공사 행 업데이트)에서 카탈로그 lookup 시 `laborRow.workName`(예: '석고보드')을 그대로 사용하여 `mergedIlwidaegaCatalog`(공사명='석고')와 매칭 실패 → D/E가 0으로 남아 수량·금액이 영구 0으로 굳던 회귀. `matchDemolitionWorkName` + `DEMOLITION_WORKNAME_ALIASES`로 canonical 이름 산출 후 원본 또는 alias 중 하나만 일치해도 매치하도록 변경. 산식·계산 로직 미변경, 매칭 가드만 보강.

## 자재비 명칭 = 자재비DB 진실의 원천 + 가설공사 보양 양방향 매칭 (2026-05-05 후속)
- **사용자 지시**: 화면 표시 명칭은 DB관리(노무비/자재비/일위대가)에 등록된 값을 기본으로 함. DB값 변경 시 연동 화면에도 즉시 반영. 가설공사 '건축물현장정리'와 '건축물보양'은 같은 항목으로 취급하되 표시는 현재 DB 등록 명칭으로.
- **잔여 회귀 원인**: 다른 레플릿 환경의 자재비DB가 '건축물보양'으로 등록되어 있는 경우, sync의 자재비DB lookup이 한 방향(`item.공사명 === data.공사명`)만 매칭 → 매칭 실패로 매번 새 행 누적·공사명 불일치.
- **수정** (모두 `field-estimate.tsx` `syncMaterialFromRecoveryArea` 내부, 산식 미변경):
  1. 자재비DB lookup 양방향 매칭(L1849~): 가설공사 + ('건축물현장정리' or '건축물보양')일 때 카탈로그의 두 명칭 모두 매칭. 다른 공종은 종전과 동일.
  2. sync 결과 행의 공사명을 카탈로그 명칭으로 강제 갱신 — 3개 분기(`isOverridden` update, 일반 update, 신규 생성) 모두에 `공사명: material.공사명 || data.공사명` 적용. DB에서 명칭 변경 시 다음 sync에 화면 명칭이 자동으로 신규로 통일됨.
  3. `existingAutoRowsMap` autoKey 별칭 환원 코멘트 정리(L1761~).
- **결과**: 자재비DB가 어느 명칭으로 등록되어 있든 매칭 hit → 단일 행 유지. 화면 표시 명칭은 자재비DB의 현재 등록 명칭과 항상 일치. 옛 명칭으로 저장된 행도 sync 한 번이면 신규 명칭으로 통일.

## 보양재 중복 누적 회귀 — 자재비 키 정규화 (2026-05-05)
- **증상**: "복구면적 가져오기" 클릭 시 보양재 행이 중복으로 누적. 추가된 보양재 삭제 시 +/- 버튼이 위치한 행 정렬이 흐트러짐.
- **원인**: `syncMaterialFromRecoveryArea`는 가설공사+'건축물보양'을 자재비 lookup용으로 '건축물현장정리'로 정규화하여 autoKey=`가설공사|건축물현장정리|보양재`를 생성하지만, 옛 경로(노무비→자재비 useEffect나 이전 sync) 또는 사용자 수동행에서 만들어진 자재비 행은 공사명='건축물보양'(또는 autoKey에 '건축물보양' 포함)로 남아 있어 다음과 같은 곳에서 키가 매칭되지 않아 매 클릭마다 새 행이 누적됨:
  1. `existingAutoRowsMap`(L1748~) 키 fallback `공종|공사명` — '건축물보양' 행이 새 autoKey와 매칭 실패 → 신규 행 생성.
  2. dedup useEffect(L519~) 키 `공종|공사명` — '건축물보양'/'건축물현장정리' 두 명칭이 다른 키로 인식되어 dedup 누락.
  3. `filteredManualRows`(L2188~) `manualKey` — 사용자 수동 보양 행이 새 autoKey와 매칭 실패 → 보존되어 자동행과 양립.
  결국 그룹 내 행 수가 2~N으로 늘어나면서 `rowSpan`(공종 셀) 기반 레이아웃이 흐트러져 +/- 버튼 정렬이 깨짐.
- **해결**: `normalizeMaterialWorkName(공종, 공사명)` 헬퍼 신설 — 가설공사+'건축물보양' → '건축물현장정리'로 단일 명칭으로 환원. 위 3곳 키 생성에 일괄 적용. `existingAutoRowsMap`은 row.autoKey가 '|건축물보양'을 포함할 경우 '|건축물현장정리'로 치환한 키로 저장. **산식·계산 로직 미변경, dedup/매칭 키 정규화만 추가.**
- **부수효과**: 중복 행이 사라지면 가설공사 그룹은 1행으로 환원되어 `rowSpan` 계산이 흐트러질 여지가 없어지므로 +/- 버튼 정렬 깨짐도 동시에 해소.

## 가설공사 '건축물현장정리' ↔ '건축물보양' 별칭 처리 (2026-05-05)
- **증상**: 일위대가 DB에서 '건축물현장정리'를 '건축물보양'으로 변경했으나, 화면에서는 여전히 '건축물현장정리'로 표시/매칭됨.
- **원인**: 코드 내 5곳에 '건축물현장정리'가 하드코딩되어 새 일위대가 DB 명칭('건축물보양')과 매칭되지 않음.
- **해결** (가드/매칭만 변경, 산식 미변경):
  1. `field-estimate.tsx` `AUTO_SYNC_MATERIAL_WORK_NAMES`(L1722) 및 `AUTO_MATERIAL_SYNC_WORK_NAMES`(L2733)에 '건축물보양' 추가 — 두 명칭 모두 자동연동 화이트리스트에 포함.
  2. `field-estimate.tsx` 가설공사 가드(L2741): `workName !== '건축물현장정리' && workName !== '건축물보양'` — 두 명칭 모두 통과 허용.
  3. `field-estimate.tsx` `DEFAULT_WORK_NAMES_BY_LOCATION_AND_TYPE` 바닥/가설공사 디폴트(L2447): '건축물현장정리' → '건축물보양'(신규 일위대가 DB 명칭 반영).
  4. `ilwidaega-link-settings-modal.tsx` 디폴트 시드(L60): '건축물현장정리' → '건축물보양'.
  5. `field-estimate.tsx` L1771~1781의 자재비 역매핑('건축물보양' → '건축물현장정리')은 유지 — 자재비 DB는 여전히 '건축물현장정리'-보양재 명칭이므로 자재비 lookup 시에만 옛 명칭으로 매핑. 사용자가 자재비 DB도 변경 시 재정리 필요.
- **주의**: 이미 DB에 저장된 일위대가 연동 설정에 '건축물현장정리'이 남아있으면, 관리자가 일위대가 연동 설정 모달에서 직접 수정해야 함(서버 자동 마이그레이션 미수행).

## 일위대가 D값 오버라이드 — 신규 엑셀 업로드 시 자동 초기화 (2026-05-05)
- **증상**: 새 일위대가 엑셀을 업로드해도 변경된 기준작업량(D값)이 견적/표시에 반영 안 됨. 셀별 수동 편집만 저장된 듯 보임.
- **원인**: `unit_price_overrides`(D값 셀별 오버라이드)는 업로드와 별개 테이블. 새 엑셀 업로드 후에도 이전 오버라이드가 남아 `mergedIlwidaegaCatalog`(field-estimate.tsx L688) 및 admin 입력 폼(db-management-tab.tsx L740~742)이 신규 엑셀의 D값을 가림.
- **해결**: 가드 추가 — `POST /api/excel-data` 라우트에서 `type === "일위대가"`이면 저장 직후 `storage.deleteAllUnitPriceOverrides()` 호출(server/routes.ts L4458~4475, server/storage.ts L7733~7738). 클라이언트 `saveExcelDataMutation.onSuccess`에서 `/api/unit-price-overrides`, `/api/ilwidaega-catalog` 캐시 무효화(client/src/pages/admin-settings.tsx L991~995). 산식·UI·계산 미변경.

## 누수탐지 항목 경비여부 자동 체크 (2026-05-04 후속)
누수탐지 관련 노무비 항목은 보험 정산 관행상 **경비**로 분류되어 일반관리비/이윤 산정 대상에서 제외되어야 함. 사용자 매번 수동 체크하는 불편을 제거하기 위해 5개 진입점에 자동 체크 가드 추가 (`includeInEstimate=false` 자동 설정, 사용자가 필요 시 직접 토글 가능):
1. **`labor-cost-section.tsx` `handleWorkNameChange` (L219~225)**: `updateRow`에 위임만 하도록 단순화. (이전 분기 우회 로직은 카탈로그 매칭/하위필드 리셋 누락 위험으로 제거)
2. **`labor-cost-section.tsx` `updateRow` workName 분기 (L1086~1090)**: value="누수탐지"면 기존 카탈로그 매칭/리셋 로직 그대로 두고 `includeInEstimate=false`만 추가 패치.
3. **`labor-cost-section.tsx` `updateRow` category 분기 (L813~852)**: 공종이 "누수탐지" 또는 "누수탐지비용"으로 바뀌면 includeInEstimate=false 자동.
4. **`labor-cost-section.tsx` `addRowInCategory` (L1771~1802)**: 누수탐지/누수탐지비용 그룹에서 + 추가 시 신규 행 `includeInEstimate=false` 초기화.
5. **`field-estimate.tsx` 견적서 공종 Select (L8631~8656)** 및 **`applyLossPreventionSampleTemplate` (L4616~4633)**: 동일 가드 적용.

산식 미변경, 매칭/가드만 추가. 합계 분리 로직(L4947~4992)은 그대로 — `includeInEstimate` 값만 자동 채워준다. 사용자가 수동으로 경비 체크박스를 토글한 뒤 다시 공종/공사명을 "누수탐지"로 바꾸면 자동 false가 다시 적용되는 구조.

## 노무비 행 잠금(lockedAtSave) 가드 정책
- **목적**: 저장 시점에 박힌 표준값(`lockedAtSave=true`)을 자동 동기화가 덮어쓰지 못하도록 보호.
- **가드 공통 조건** (8곳: `labor-cost-section.tsx` L319/L446, `field-estimate.tsx` L1479/L1560/L3401/L3521/L3574/L3859):
  `lockedAtSave && damageArea > 0 && amount > 0` 이면 SKIP.
- **두 가지 자가복구 출구**:
  1) **면적=0 빈 lock**: 산출표 면적이 흘러들어와 자동 채움 허용 (단가/카탈로그는 채워졌지만 면적이 0으로 저장된 행 보강).
  2) **합계=0 빈 lock**: 잘못 박힌 lock으로 간주, 정규화/자동 동기화 허용 (저장 시 FIXED 항목의 amount 보정이 SKIP되어 0으로 박힌 행 자가복구).
- **보호 범위**: 정상 값(damageArea>0 && amount>0)으로 박힌 행은 어떤 자동 경로로도 덮어쓰지 않음. 산식·계산 로직은 손대지 않음.
- **행 삭제 가드**(`field-estimate.tsx` L3304)는 별개: 잠긴 행은 자동 reconcile에서도 무조건 살려두며, 합계 보정은 다른 8곳에서 처리.

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
  - **Estimate Management**: Create and submit restoration cost estimates with dynamic calculation tables linked to master data, version tracking, and PDF/Excel export. Includes a Recovery Area Table and configurable Labor Rate Tiers. **견적 버전 createdAt 보존**: `estimates` 테이블은 저장할 때마다 새 version 행이 INSERT 되지만, `server/storage.ts`의 `createEstimateVersion`이 `nextVersion > 1`일 때 v1의 `createdAt`을 트랜잭션 내에서 SELECT 후 INSERT에 그대로 명시. 따라서 `createdAt` = 최초 v1 생성 시각(불변), `updatedAt` = 이번 저장 시각(매번 갱신). **복구면적 → 노무비/자재비 자동 동기화 cutoff 안전장치**: `client/src/pages/field-estimate.tsx`의 `AUTO_SYNC_CUTOFF_KST`(현재 `"2026-04-24T13:00:00+09:00"`, KST 시각 단위) 이후 생성된 신규 접수건에서만 5개 자동 동기화 useEffect(자재비 recoverySignature/탭진입, 노무비 탭진입, rows→노무비 직접연동, 철거공사 reconcile)가 동작. 비교는 `cases.created_at_timestamp`(text, nullable, ISO 8601 KST `+09:00` 오프셋, 신규 케이스에만 채워짐) 와 사전 비교. 기존 케이스(NULL)나 잘못된 포맷은 안전하게 legacy(false) 처리되어 자동 동기화가 트리거되지 않음. 노무비/자재비 탭의 "복구면적 가져오기" 수동 버튼은 cutoff 무관하게 항상 동작.
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
- **일위대가 연동 설정**: `ilwidaega_link_settings` 테이블에서 위치(천장/벽면/바닥)별 공종+공사명 매핑을 관리자가 동적으로 설정 가능. 설정 항목은 복구면적 산출표의 드롭다운 옵션에 반영되며, 복구면적 → 노무비/자재비 자동 연동에 활용. 연동 설정에 등록된 항목은 기존 하드코딩 제외 목록(`AREA_DISPLAY_ONLY_WORK_TYPES`, `AREA_DISPLAY_ONLY_WORK_NAMES`)을 우회하여 노무비·자재비까지 완전 연동됨. `isItemInLinkSettings()` 헬퍼가 모든 차단 지점에서 연동 설정 항목을 허용. DB 설정이 없으면 기존 하드코딩 기본값으로 fallback. 관리자 설정 > DB관리 > 일위대가 탭의 "일위대가 연동 설정" 버튼으로 접근.

### Refactoring Modules
- **`server/font-loader.ts`**: Pretendard TTF 폰트 비동기 로딩/캐싱/검증 통합 모듈. `loadPretendardRegular()`, `loadPretendardSemiBold()`, `loadPretendardFontPair()` export (모두 async/Promise). 3개 PDF 서비스(pdf-lib-service, invoice-pdf-service, evidence-pdf-service)에서 공유. `loadPretendardFontPair()`는 두 폰트를 `Promise.all`로 병렬 로드.
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
- **`client/src/pages/admin-settings/`**: admin-settings.tsx(10,502줄)에서 분리한 탭별 presentational 컴포넌트.
  - `notice-management-tab.tsx` — 공지사항 관리 탭 (292줄)
  - `db-management-tab.tsx` — DB 관리 탭 (857줄, 엑셀 업로드/다운로드/일위대가 D값 편집 포함)
  - `master-data-tab.tsx` — 기준정보 관리 탭 (551줄, 드래그 앤 드롭 정렬 포함)
  - `change-log-tab.tsx` — 변경 로그 관리 탭 (323줄)
  - `index.ts` — barrel export
  - 부모(admin-settings.tsx)가 상태/mutation/query 소유, props 기반 전달. 1:1 문의 관리/사용자 계정 관리 탭은 모달 결합도가 높아 인라인 유지.

## External Dependencies
- **Frontend Libraries**: React, TypeScript, Wouter, TanStack Query, React Hook Form, Zod, Shadcn UI, Tailwind CSS, Lucide React.
- **Backend Libraries**: Express.js, bcrypt, express-session, memorystore, Zod.
- **Database**: PostgreSQL (Neon-backed) with Drizzle ORM.