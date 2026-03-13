# 누수 사고 관리 시스템 (Water Damage Management System - FLOXN)

## Overview
본 시스템은 **누수 사고의 접수부터 현장조사, 견적, 정산, 통계, 기준정보 관리까지 전 과정을 디지털화한 통합 관리 플랫폼**입니다.
This comprehensive Insurance Accident Management System digitalizes and automates the entire workflow for water damage insurance claims. It serves insurance companies, platform administrators (FLOXN), repair companies, clients, assessors, and investigators. The platform focuses on automating document generation, transmission, and approvals, featuring robust role-based authentication, an administrator panel for user management, and an intuitive dashboard, all built with a clean, responsive UI/UX and clear FLOXN branding.

**Key Stakeholders:**
- 보험사 (Insurance Companies)
- 플랫폼 관리자/플록슨 (Platform Administrators - FLOXN)
- 수리업체/협력사 (Repair Companies/Partners)
- 의뢰사 (Clients)
- 심사사 (Assessors)
- 조사사 (Investigators)

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
- **Responsiveness**: Designed for optimal viewing across mobile, tablet, and desktop devices with specific header and dashboard layouts for different screen sizes.
- **Theming**: Supports dark mode.
- **Feedback**: Implements beautiful loading and error states.
- **Design Guidelines**: Adherence to a strict design guide emphasizing consistent spacing, blur effects, and Noto Sans KR font, prioritizing accessibility.

### Technical Implementations
- **Authentication**: Username-based login, bcrypt for password hashing, express-session with PostgreSQL session store (connect-pg-simple) for persistent session management, and robust role-based access control (Assessor, Investigator, Insurer, Partner, Client, Administrator) with protected routes. Sessions survive server restarts/redeployments. Session store uses in-memory cache with PG persistence (thundering herd protection, 60s cache TTL, 5min touch throttle, non-blocking set). Separate connection pool (max:5) for session queries.
- **Server-side Caching**: Multi-layer caching strategy for performance:
  - Users cache (5min TTL, deduplication) - warm on startup
  - Cases + ProgressUpdates cache (30s TTL, deduplication) - warm on startup
  - `getUser()` and `getUserByUsername()` use cached users with DB fallback
  - Cache invalidation on create/update/delete operations
  - Main DB pool: max 20 connections
- **User Management (Admin)**: Features a user account table with search and role-based filtering, a detailed right-sliding modal for viewing/editing, and a two-step account creation flow with validation, password generation, and soft deletion.
- **Case Intake System**: Multi-section collapsible form for new insurance claim cases, including automatic case number generation (CLM-{timestamp}), and extensive fields for various information categories.
- **Date Handling**: All date creations are in Korean Standard Time (KST).

### Feature Specifications
- **Home**: Overview of progress, key metrics, and quick navigation for all users.
- **Reception Management**: New water damage case registration and management, including assigning repair companies.
  - **Read-Only Mode**: Case details open in read-only mode by default; a "수정" button enables editing. Edit mode resets when closing the dialog or switching cases. All form fields, Select dropdowns, input fields, buttons, checkboxes, textareas, and clickable elements respect the readOnly prop.
- **Field Survey Workflow**: A sequential process for managing field investigations for a selected case.
  - **Field Survey Management**: Input and manage field investigation data.
  - **Drawing Creation**: Digital drawing workspace for damage scope with tools for images, rectangles, and leak markers, supporting high-resolution PNG export. Each case manages its own drawing individually (no auto-sync between related cases).
  - **Documents Upload**: Document and photo upload system with persistent storage, categorization, download, and delete functionalities. Each case manages its own documents individually (no auto-sync between related cases).
  - **Estimate Management**: Create and submit restoration cost estimates with dynamic calculation tables linked to master data, version tracking, and PDF/Excel export.
    - **Recovery Area Table (복구면적 산출표)**: Grouped layout by location (장소) with rowspan, +/- buttons for adding/removing rows within each location group, columns: 장소, +/-, 위치, 공종, 공사명, 피해면적(가로/세로/면적), 복구면적(가로/세로/면적), 비고.
    - **Labor Rate Tiers (노임단가 적용비율)**: Configurable 8-tier rate structure based on C/D ratio stored in database. Accessible via "적용비율 설정" button in labor cost section. Tiers determine rate multipliers (e.g., 85%+ = 100%, 50%+ = 115%, etc.) with edit/reset functionality.
  - **Field Reports**: Generate comprehensive reports integrating all collected field survey data.
- **Master Data Management**: Administrator-only feature for managing dropdown options (e.g., room categories, locations, work names) used throughout the system, with API endpoints for management and real-time updates.
- **Progress Management**: Track case progress, manage approvals/rejections, and send notifications.
- **Finance & Settlement**: View statistics, manage settlements, track receivables, and match payments.
  - **Invoice System**: Two distinct invoice types based on case recovery type:
    - **재사용 인보이스 (Reusable Invoice)**: For 직접복구 (direct restoration) cases - displays 손해방지비용 + 대물복구비용
    - **현장출동비용 청구 (Field Dispatch Cost Invoice)**: For 선견적요청 (pre-estimate request) cases - displays only 현장출동비용
  - Invoice data is persisted in the database (invoiceDamagePreventionAmount, invoicePropertyRepairAmount, invoiceRemarks, fieldDispatchInvoiceAmount, fieldDispatchInvoiceRemarks)
  - PDFs can be generated and emailed to recipients

### System Design Choices
- **Frontend**: React with TypeScript, Wouter for routing, TanStack Query for data fetching, React Hook Form with Zod for form validation, Shadcn UI and Tailwind CSS for component styling, and Lucide React for icons.
- **Backend**: Express.js, bcrypt, express-session, memorystore, and Zod for API validation.
- **Database**: PostgreSQL (Neon-backed) with Drizzle ORM for persistent data storage and automatic schema management.
  - **IMPORTANT**: 스키마 변경 시 반드시 DEV 데이터베이스에 동기화해야 합니다:
    ```bash
    DATABASE_URL="$DEV_DATABASE_URL" npm run db:push
    ```
  - 또는 스크립트 사용: `bash scripts/db-push-dev.sh`

## External Dependencies
- **Frontend Libraries**: React, TypeScript, Wouter, TanStack Query, React Hook Form, Zod, Shadcn UI, Tailwind CSS, Lucide React.
- **Backend Libraries**: Express.js, bcrypt, express-session, memorystore, Zod.
- **Database**: PostgreSQL (Neon-backed) with Drizzle ORM.

## Recent Changes (2026-02-24)
- **최고관리자 접근권한 관리**: Super admin access control for 접근 권한 관리
  - Added `isSuperAdmin` boolean field to users table (default: false)
  - 계정 생성/수정 시 관리자 역할 선택 시 최고관리자/일반관리자 선택 가능
  - 접근 권한 관리 사이드바 메뉴: 최고관리자만 표시
  - role-permissions API (GET/POST/DELETE): 최고관리자만 접근 가능
  - Security: Only super admins can set isSuperAdmin on other users
  - Security: isSuperAdmin auto-resets to false when role changes from 관리자
  - Profile card shows 최고관리자 badge for super admin users
- **미결건 통계 과거 조회 기능**: Historical pending case lookup feature
  - New `case_status_history` table tracks every status change with timestamp
  - Status changes are recorded automatically in `updateCase` and `updateCaseStatus` storage methods
  - Baseline history seeded on first startup for existing cases
  - "과거 조회" toggle button in 미결건 통계 page
  - Date picker to select a historical date (defaults to 7 days ago)
  - Shows which cases were 미결건 (pending) at the selected past date
  - API endpoint: GET `/api/case-status-history`
  - CLOSED_STATUSES = ["정산완료", "입금완료", "부분입금", "부분지급", "지급완료", "접수취소", "종결"] - everything else is 미결건
  - 케이스 상태 흐름 (정산): 청구 → 입금완료 → 부분지급 → 지급완료 → 정산완료
  - 부분지급: 지급관리 paymentEntries에 "일부"만 있는 경우 (InvoiceManagementPopup 저장 시 자동 설정)
  - 지급완료: 지급관리 paymentEntries에 "최종액"이 있는 경우 (InvoiceManagementPopup 저장 시 자동 설정)
  - 협력사 미정산 = 부분지급 + 지급완료 상태

## Recent Changes (2026-01-14)
- **Dashboard Complete Redesign**: Redesigned dashboard with new layout and styling
  - New background: `bg-[#CAD6FF]` with gradient overlay from `#DCE7FF`
  - 12-column grid layout: 9 columns for main content, 3 columns for right sidebar
  - 현황 요약: Insurance company summary TABLE format (분류/접수건/미결건/보험사 미정산/협력사 미정산)
  - 진행건 요약: Tabs (접수/미결/보험사 미정산/협력사 미정산) with staff list
  - 내 작업: Card-style task display with status badges (all tasks shown, no limit)
  - Right sidebar: 내 프로필, 공지사항, 1:1 문의, 즐겨찾기 sections
  - Settlement metrics now use proper fields (insuranceSettlementStatus/partnerSettlementStatus)

- **Intake Form Grid Layout Redesign**: Further refined the 접수단계 (intake) form with a clean grid-based layout
  - Changed from vertical header table style to modern 12-column responsive grid layout
  - Sections now use clean section headers with Tailwind slate/sky color scheme
  - 7 main sections: 기본 정보, 보험 정보, 의뢰자/심사자/조사자 정보, 보험계약자 및 피보험자 정보, 피해자 정보, 배당사항, 배당 협력사 정보
  - Fixed bottom action bar with backdrop blur effect (초기화/저장/접수완료 buttons)
  - Improved input styling with focus states (sky-400 border, sky-100 ring)
  - Required fields marked with sky-colored asterisks (*)
  - 배당사항 section has gray background for visual distinction
  - All existing functionality preserved: search modals, data binding, form validation, SMS notifications

## Recent Changes (2026-03-13)
- **Document Upload: Direct DB Storage (Base64)**: Replaced Object Storage presign+PUT+upload-complete flow with direct base64 upload to database.
  - New endpoint: `POST /api/documents/direct-upload` — accepts base64 `fileData` and saves directly to `caseDocuments.fileData` column
  - Frontend `uploadSingleFile()` now reads files via `FileReader.readAsDataURL`, strips prefix, sends base64 to server
  - Image serving (`GET /api/documents/:id/image`) already supports `fileData` fallback — works seamlessly
  - Download (`GET /api/documents/:id/download-url`) updated to return image endpoint URL for fileData-based docs
  - Added authorization checks: image endpoint now checks user role/ownership; direct-upload validates case access
  - Added server-side file size limit (50MB decoded) on direct-upload
  - Object Storage presign endpoint kept as fallback but not actively used
  - Reason: Object Storage sidecar returns persistent 401 errors for all signed URL requests

## Recent Changes (2026-01-03)
- **Field Survey Status Workflow Update**: Updated the field survey approval workflow
  - 심사 (Review) → status "1차승인" (unchanged)
  - 이메일 전송 (Email Send) → status "현장정보제출" (NEW)
  - 승인 (Approval) → status "복구요청" (NEW - was not updating status before)
  - Email button is visible when status is "1차승인" (after review approved)
  - Approval button is enabled when status is "현장정보제출" (after email sent)

## Recent Changes (2025-12-31)
- **Server Capacity Increase**: Fixed production 500 error for large document files.
  - Increased Express JSON body limit from 50MB to 500MB
  - Increased server timeout to 5 minutes (300 seconds)
  - Increased keepAliveTimeout to 2 minutes
  - Documents now load with full fileData (no lazy loading)