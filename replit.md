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
- **Authentication**: Username-based login, bcrypt for password hashing, express-session with PostgreSQL session store for persistent session management, and robust role-based access control (Assessor, Investigator, Insurer, Partner, Client, Administrator) with protected routes.
- **Server-side Caching**: Multi-layer caching strategy for performance including user and case data, with invalidation on create/update/delete operations.
- **User Management (Admin)**: Features a user account table with search, role-based filtering, detailed viewing/editing modals, and a two-step account creation flow with validation, password generation, and soft deletion. Includes super admin access control.
- **Case Intake System**: Multi-section collapsible form for new insurance claim cases, including automatic case number generation and extensive fields.
- **Date Handling**: All date creations are in Korean Standard Time (KST).

### Feature Specifications
- **Home**: Overview of progress, key metrics, and quick navigation.
- **Reception Management**: New water damage case registration and management, including assigning repair companies, with a read-only mode by default for case details.
- **Field Survey Workflow**: A sequential process for managing field investigations.
  - **Drawing Creation**: Digital drawing workspace for damage scope with tools for images, rectangles, and leak markers, supporting high-resolution PNG export.
  - **Documents Upload**: Document and photo upload system with persistent storage (Object Storage preferred, fallback to DB base64), categorization, download, and delete functionalities. Multipart and direct upload endpoints use Object Storage when PRIVATE_OBJECT_DIR is available, storing only metadata in PostgreSQL for faster uploads.
  - **Estimate Management**: Create and submit restoration cost estimates with dynamic calculation tables linked to master data, version tracking, and PDF/Excel export. Includes a Recovery Area Table and configurable Labor Rate Tiers.
  - **Field Reports**: Generate comprehensive reports integrating all collected field survey data.
- **Master Data Management**: Administrator-only feature for managing dropdown options used throughout the system.
- **Progress Management**: Track case progress, manage approvals/rejections, and send notifications. Includes a refined field survey approval workflow (Review → 1차승인 → 현장정보제출 → 복구요청).
- **Finance & Settlement**: View statistics, manage settlements, track receivables, and match payments. Includes an Invoice System with two distinct types (Reusable Invoice and Field Dispatch Cost Invoice) and a feature for viewing historical pending cases.

### System Design Choices
- **Frontend**: React with TypeScript, Wouter for routing, TanStack Query for data fetching, React Hook Form with Zod for form validation, Shadcn UI and Tailwind CSS for component styling, and Lucide React for icons.
- **Backend**: Express.js, bcrypt, express-session, memorystore, and Zod for API validation.
- **Database**: PostgreSQL (Neon-backed) with Drizzle ORM for persistent data storage and automatic schema management.

## External Dependencies
- **Frontend Libraries**: React, TypeScript, Wouter, TanStack Query, React Hook Form, Zod, Shadcn UI, Tailwind CSS, Lucide React.
- **Backend Libraries**: Express.js, bcrypt, express-session, memorystore, Zod.
- **Database**: PostgreSQL (Neon-backed) with Drizzle ORM.