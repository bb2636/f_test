import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, bigint, serial, timestamp, json, unique, doublePrecision, numeric, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("사원"),
  name: text("name").notNull(),
  company: text("company").notNull(),
  department: text("department"),
  position: text("position"),
  email: text("email"),
  phone: text("phone"),
  office: text("office"),
  address: text("address"),
  addressDetail: text("address_detail"), // 상세주소
  // Partner-specific fields
  businessRegistrationNumber: text("business_registration_number"), // 사업자 등록번호
  representativeName: text("representative_name"), // 대표자 명
  bankName: text("bank_name"),
  accountNumber: text("account_number"),
  accountHolder: text("account_holder"),
  serviceRegions: text("service_regions").array(),
  attachments: text("attachments").array(),
  accountType: text("account_type").default("개인"), // "개인" | "회사"
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  status: text("status").notNull().default("active"), // "active" | "deleted"
  mustChangePassword: boolean("must_change_password").notNull().default(true), // 최초 로그인 시 비밀번호 변경 필요 여부
  createdAt: text("created_at").notNull(),
});

export const VALID_ROLES = ["심사사", "조사사", "보험사", "협력사", "관리자"] as const;
export type UserRole = typeof VALID_ROLES[number];

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
}).extend({
  role: z.enum(VALID_ROLES).default("보험사"),
});

export const loginSchema = z.object({
  username: z.string().min(1, "아이디를 입력해주세요"),
  password: z.string().min(1, "비밀번호를 입력해주세요"),
  rememberMe: z.boolean().default(false),
});

export const updatePasswordSchema = z.object({
  username: z.string().min(1, "사용자 이름이 필요합니다"),
  newPassword: z.string().min(1, "새 비밀번호가 필요합니다"),
});

export const changeMyPasswordSchema = z.object({
  currentPassword: z.string().min(1, "현재 비밀번호를 입력해주세요"),
  newPassword: z.string()
    .min(8, "비밀번호는 8자 이상이어야 합니다")
    .regex(/[A-Za-z]/, "비밀번호에 영문자가 포함되어야 합니다")
    .regex(/[0-9]/, "비밀번호에 숫자가 포함되어야 합니다"),
  confirmPassword: z.string().min(1, "비밀번호 확인을 입력해주세요"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "새 비밀번호가 일치하지 않습니다",
  path: ["confirmPassword"],
});

export type ChangeMyPasswordInput = z.infer<typeof changeMyPasswordSchema>;

export const forceChangePasswordSchema = z.object({
  newPassword: z.string()
    .min(6, "비밀번호는 6자 이상이어야 합니다")
    .regex(/[A-Za-z]/, "비밀번호에 영문자가 포함되어야 합니다")
    .regex(/[0-9]/, "비밀번호에 숫자가 포함되어야 합니다")
    .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, "비밀번호에 특수문자가 포함되어야 합니다"),
  confirmPassword: z.string().min(1, "비밀번호 확인을 입력해주세요"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "새 비밀번호가 일치하지 않습니다",
  path: ["confirmPassword"],
});

export type ForceChangePasswordInput = z.infer<typeof forceChangePasswordSchema>;

export const deleteAccountSchema = z.object({
  username: z.string().min(1, "사용자 이름이 필요합니다"),
});

export const createAccountSchema = z.object({
  username: z.string().min(3, "아이디는 3자 이상이어야 합니다"),
  password: z.string().min(4, "비밀번호는 4자 이상이어야 합니다"),
  role: z.enum(VALID_ROLES),
  name: z.string().min(1, "이름을 입력해주세요"),
  company: z.string().min(1, "회사명을 입력해주세요"),
  department: z.string().optional(),
  position: z.string().optional(),
  email: z.string().email("올바른 이메일 주소를 입력해주세요").optional().or(z.literal("")),
  phone: z.string().optional(),
  office: z.string().optional(),
  address: z.string().optional(),
  addressDetail: z.string().optional(), // 상세주소
  // Partner-specific fields
  businessRegistrationNumber: z.string().optional(),
  representativeName: z.string().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  accountHolder: z.string().optional(),
  serviceRegions: z.array(z.string()).optional(),
  attachments: z.array(z.string()).optional(),
  accountType: z.enum(["개인", "회사"]).optional().default("개인"),
  isSuperAdmin: z.boolean().optional().default(false),
});

export const updateUserSchema = z.object({
  name: z.string().min(1, "이름을 입력해주세요").optional(),
  role: z.enum(VALID_ROLES).optional(),
  accountType: z.enum(["개인", "회사"]).optional().nullable(),
  department: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  email: z.string().email("올바른 이메일 주소를 입력해주세요").optional().or(z.literal("")).nullable(),
  phone: z.string().optional().nullable(),
  office: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  addressDetail: z.string().optional().nullable(), // 상세주소
  // Partner-specific fields
  businessRegistrationNumber: z.string().optional().nullable(),
  representativeName: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  accountNumber: z.string().optional().nullable(),
  accountHolder: z.string().optional().nullable(),
  serviceRegions: z.array(z.string()).optional().nullable(),
  attachments: z.array(z.string()).optional().nullable(),
  isSuperAdmin: z.boolean().optional().nullable(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const cases = pgTable("cases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseNumber: text("case_number").unique(),
  caseGroupId: text("case_group_id"), // 케이스 그룹 식별자 (동일 보험사고번호 내 케이스들)
  status: text("status").notNull().default("배당대기"),
  recoveryType: text("recovery_type"), // 복구 타입: "직접복구" | "선견적요청" | null
  
  // 담당자 정보 (관리자)
  managerId: varchar("manager_id").references(() => users.id),
  
  // 기본 정보
  accidentDate: text("accident_date"),
  
  // 보험 정보
  insuranceCompany: text("insurance_company"),
  insurancePolicyNo: text("insurance_policy_no"),
  insuranceAccidentNo: text("insurance_accident_no"),
  
  // 의뢰자 정보
  clientResidence: text("client_residence"),
  clientDepartment: text("client_department"),
  clientName: text("client_name"),
  clientContact: text("client_contact"),
  
  // 심사자 정보
  assessorId: text("assessor_id"), // 심사사 회사명
  assessorDepartment: text("assessor_department"),
  assessorTeam: text("assessor_team"),
  assessorContact: text("assessor_contact"),
  assessorEmail: text("assessor_email"), // 심사사 이메일
  
  // 조사자 정보
  investigatorTeam: text("investigator_team"),
  investigatorDepartment: text("investigator_department"),
  investigatorTeamName: text("investigator_team_name"),
  investigatorContact: text("investigator_contact"),
  investigatorEmail: text("investigator_email"), // 조사사 이메일
  
  // 피보험자 및 피해자 정보
  // 보험계약자 정보
  policyHolderName: text("policy_holder_name"),
  policyHolderIdNumber: text("policy_holder_id_number"),
  policyHolderAddress: text("policy_holder_address"),
  
  // 피보험자 정보
  insuredName: text("insured_name"),
  insuredIdNumber: text("insured_id_number"),
  insuredContact: text("insured_contact"),
  insuredAddress: text("insured_address"),
  insuredAddressDetail: text("insured_address_detail"),
  sameAsPolicyHolder: text("same_as_policy_holder"), // "true" | "false" | null
  
  // 피해자 정보
  victimName: text("victim_name"),
  victimContact: text("victim_contact"),
  victimAddress: text("victim_address"),
  victimAddressDetail: text("victim_address_detail"),
  additionalVictims: text("additional_victims"), // JSON string of additional victims array
  
  // 현장조사 정보 (향후 fieldSurveyData 테이블로 이동 예정, 현재는 호환성 유지)
  visitDate: text("visit_date"), // 방문 일시 (날짜)
  visitTime: text("visit_time"), // 방문 일시 (시간)
  accompaniedPerson: text("accompanied_person"), // 출동담당자
  travelDistance: text("travel_distance"), // 현장 이동 거리
  dispatchLocation: text("dispatch_location"), // 출동 업장지
  accidentTime: text("accident_time"), // 사고 발생 시각
  accidentCategory: text("accident_category"), // 사고 원인 카테고리 (배관, 교체, 방수, 기타)
  processingTypes: text("processing_types"), // 처리 유형 (JSON array)
  processingTypeOther: text("processing_type_other"), // 기타 처리 유형
  recoveryMethodType: text("recovery_method_type"), // 복구 방식 (부분수리, 전체수리)
  fieldSurveyStatus: text("field_survey_status").default("draft"), // 현장조사 상태 (draft/submitted)
  
  // 기타 (기존 필드)
  clientPhone: text("client_phone"),
  clientAddress: text("client_address"),
  accidentLocation: text("accident_location"),
  accidentDescription: text("accident_description"),
  
  // 사고 및 복구 정보
  accidentType: text("accident_type"), // 사고 유형
  accidentCause: text("accident_cause"), // 사고 원인
  restorationMethod: text("restoration_method"), // 복구 방식 (없음, 플랫폼 복구, 선견적요청)
  otherVendorEstimate: text("other_vendor_estimate"), // 타 업체 견적
  
  // 피해 사항 (JSON으로 저장)
  damageItems: text("damage_items"), // JSON string of damage items array
  
  // 손방 및 대물 선택
  damagePreventionCost: text("damage_prevention_cost"), // "true" | "false" | null (손해방지 체크)
  victimIncidentAssistance: text("victim_incident_assistance"), // "true" | "false" | null (피해세대복구 체크)
  
  // 배당사항
  assignedPartner: text("assigned_partner"), // 협력사명
  assignedPartnerManager: text("assigned_partner_manager"), // 담당자명
  assignedPartnerContact: text("assigned_partner_contact"), // 담당자 연락처
  urgency: text("urgency"), // 긴급도
  specialRequests: text("special_requests"), // 특이사항 및 요청사항
  
  // 진행상황 관련 필드
  progressStatus: text("progress_status"), // 주요진행사항 (서류보완요청 등)
  specialNotes: text("special_notes"), // 협력사 특이사항 메모 (기존 - 레거시)
  specialNotesConfirmedBy: varchar("special_notes_confirmed_by").references(() => users.id), // 관리자 확인자 ID
  additionalNotes: text("additional_notes"), // 협력사 기타사항 (800자 제한)
  vocContent: text("voc_content"), // VOC(고객의 소리) - 협력사가 현장에서 작성 (특이사항과 별개)
  
  // 특이사항 히스토리 (협력사/관리자 별도 입력)
  partnerNotesHistory: text("partner_notes_history"), // JSON: [{content, createdAt, createdBy}]
  adminNotesHistory: text("admin_notes_history"), // JSON: [{content, createdAt, createdBy}]
  partnerNotesAckedByAdmin: text("partner_notes_acked_by_admin"), // "true" when admin confirmed partner notes
  adminNotesAckedByPartner: text("admin_notes_acked_by_partner"), // "true" when partner confirmed admin notes
  
  // 일정 관련 필드
  receptionDate: text("reception_date"), // 접수일 (접수완료 된 날짜)
  inspectionDate: text("inspection_date"), // 검수일
  assignmentDate: text("assignment_date"), // 배당일 (접수완료되고 협력사가 배당 받은 날짜)
  siteVisitDate: text("site_visit_date"), // 현장방문일 (협력사가 현장 방문일자를 입력한 날짜)
  fieldSurveyDate: text("field_survey_date"), // 현장조사당일 배당
  siteInvestigationSubmitDate: text("site_investigation_submit_date"), // 현장자료 제출일 (협력사가 현장출동 보고서를 제출한 날짜)
  firstInspectionDate: text("first_inspection_date"), // 1차 실사일 (심사)
  firstApprovalDate: text("first_approval_date"), // 1차 승인일(내부) - 플록슨 관리자가 1차 승인 한 날짜
  secondApprovalDate: text("second_approval_date"), // 2차 승인일(복구 요청일) - 플록슨 관리자가 2차 승인으로 변경한 날짜
  firstInvoiceDate: text("first_invoice_date"), // 1차 송장일 (내부)
  approvalRequestDate: text("approval_request_date"), // 승인요청일
  approvalDate: text("approval_date"), // 승인일(공사 시작일)
  approvalCompletionDate: text("approval_completion_date"), // 승인완성일정
  constructionStartDate: text("construction_start_date"), // 공사시작일
  constructionCompletionDate: text("construction_completion_date"), // 복구완료일 (협력사가 증빙자료 제출에 청구자료를 업로드 한 날짜)
  constructionReportSubmitDate: text("construction_report_submit_date"), // 공사완료보고 제출일
  totalWorkDate: text("total_work_date"), // 총공일
  contractorReportDate: text("contractor_report_date"), // 공사업체보고 배당
  contractorRepairDate: text("contractor_repair_date"), // 공사업체보수 배당
  completionDate: text("completion_date"), // 완공일
  claimDate: text("claim_date"), // 청구일 (청구 상태로 변경된 날짜)
  paymentCompletedDate: text("payment_completed_date"), // 입금완료일 (입금완료 상태로 변경된 날짜)
  partialPaymentDate: text("partial_payment_date"), // 일부입금일 (부분입금 상태로 변경된 날짜)
  settlementCompletedDate: text("settlement_completed_date"), // 정산완료일 (정산완료 상태로 변경된 날짜)
  cancellationDate: text("cancellation_date"), // 접수취소일 (접수취소 상태로 변경된 날짜)
  
  // 심사 관련 필드 (1차 승인)
  reviewDecision: text("review_decision"), // 심사결과: "승인" | "비승인" | null
  reviewComment: text("review_comment"), // 검토 의견
  reviewedAt: text("reviewed_at"), // 심사 일시
  reviewedBy: varchar("reviewed_by").references(() => users.id), // 심사자 ID
  
  // 보고서 승인 관련 필드 (2차 승인)
  reportApprovalDecision: text("report_approval_decision"), // 보고서 승인결과: "승인" | "비승인" | null
  reportApprovalComment: text("report_approval_comment"), // 보고서 승인 의견
  reportApprovedAt: text("report_approved_at"), // 보고서 승인 일시
  reportApprovedBy: varchar("report_approved_by").references(() => users.id), // 보고서 승인자 ID
  
  // 금액 관련 필드
  estimateAmount: text("estimate_amount"), // 견적금액 (최종 총액)
  initialEstimateAmount: text("initial_estimate_amount"), // 최초 견적금액 (첫 현장출동보고서 제출 시점의 견적금액)
  initialPreventionEstimateAmount: text("initial_prevention_estimate_amount"), // 최초 손해방지비용 견적금액 (첫 현장출동보고서 제출 시점)
  initialPropertyEstimateAmount: text("initial_property_estimate_amount"), // 최초 대물비용 견적금액 (첫 현장출동보고서 제출 시점)
  approvedAmount: text("approved_amount"), // 승인금액 (2차승인 시점의 견적금액)
  
  // 인보이스 관련 필드
  invoiceDamagePreventionAmount: text("invoice_damage_prevention_amount"), // 재사용 인보이스 - 손해방지비용
  invoicePropertyRepairAmount: text("invoice_property_repair_amount"), // 재사용 인보이스 - 대물복구비용
  invoiceRemarks: text("invoice_remarks"), // 재사용 인보이스 - 비고
  fieldDispatchInvoiceAmount: text("field_dispatch_invoice_amount"), // 현장출동비용 청구 - 현장출동비용
  fieldDispatchInvoiceRemarks: text("field_dispatch_invoice_remarks"), // 현장출동비용 청구 - 비고
  invoiceConfirmDate: text("invoice_confirm_date"), // 인보이스 확인 날짜 (승인 권한자가 확인한 날짜)
  taxInvoiceConfirmDate: text("tax_invoice_confirm_date"), // 세금계산서 확인 날짜
  invoicePdfGenerated: text("invoice_pdf_generated"), // 청구 PDF 다운로드/발송 기록 (타임스탬프)
  lmsSendHistory: text("lms_send_history"), // LMS 발송 이력 (JSON 배열)
  
  assignedTo: varchar("assigned_to").references(() => users.id),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const CASE_STATUSES = [
  "배당대기",      // 관리자가 접수하기에서 접수정보를 입력했으나, 배당협력사 정보를 입력하지 않은 상태
  "접수완료",      // 관리자가 배당협력사 정보와 접수하기에 있는 정보를 모두 입력하고 '접수완료'를 눌러 접수를 완료한 상태
  "현장방문",      // 배당받은 협력사가 현장정보를 입력할때 방문일시를 입력한 상태
  "현장정보입력",  // 협력업체가 의뢰된 사고에 대해 현장조사 후 현장조사입력을 마친 상태
  "검토중",        // 현장정보입력이 제출 된 후, 플록슨 담당자가 페이지를 열어본 상태
  "반려",          // 현장정보 입력이 미흡해 재입력을 요구한 상태
  "1차승인",       // 협력업체가 입력한 현장 정보에 문제가 없어 플록슨 담당자가 승인한 경우
  "현장정보제출",  // 승인된 현장 정보를 플록슨 담당자가 심사자 또는 조사자에게 발송
  "복구요청(2차승인)", // 심사자 또는 조사자가 현장 정보를 확인하고, 플록슨 또는 협력업체에 복구를 요청
  "직접복구",      // 플록슨 담당자 또는 협력업체가 해당 사고건의 복구가 진행되는 경우
  "선견적요청",    // 관리자가 접수하기에서 복구방식을 '선견적 요청'으로 했을경우 선견적만 제출하고 종결되는 경우
  "청구자료제출(복구)", // 현장복구를 완료 한 후 청구증빙자료를 제출한 상태
  "출동비청구(선견적)", // 선견적요청 상태 선택시 자동으로 청구 상태 변환
  "청구",          // 복구 완료 자료(복구 or 선견적요청 인보이스 포함)를 심사자 및 조사자에게 발송
  "입금완료",      // 청구한 인보이스 금액이 모두 입금된 상태 (자부담 제외)
  "부분입금",      // 청구한 인보이스 금액중 비례보상에 따른 일부 금액이 입금된 상태
  "부분지급",      // 협력사에 일부 금액만 지급한 상태 (지급관리에 '일부'만 있는 경우)
  "지급완료",      // 협력사에 최종 금액을 지급한 상태 (지급관리에 '최종액'이 있는 경우)
  "정산완료",      // 입금이 완료되어 수수료에 대한 세금계산서가 발행 완료된 상태
  "접수취소",      // 플록슨에 사고가 의뢰 되었으나, 어떠한 사유로 인해 접수가 취소된 상태
] as const;
export type CaseStatus = typeof CASE_STATUSES[number];

export const RECOVERY_TYPES = ["직접복구", "선견적요청"] as const;
export type RecoveryType = typeof RECOVERY_TYPES[number];

export const insertCaseSchema = createInsertSchema(cases).omit({
  id: true,
  caseNumber: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(CASE_STATUSES).default("배당대기"),
  recoveryType: z.enum(RECOVERY_TYPES).optional().nullable(),
});

export const insertCaseRequestSchema = insertCaseSchema.omit({
  createdBy: true,
}).extend({
  caseNumber: z.string().optional(),
  id: z.string().optional(), // For draft resume and deletion
});

export type InsertCase = z.infer<typeof insertCaseSchema>;
export type InsertCaseRequest = z.infer<typeof insertCaseRequestSchema>;
export type Case = typeof cases.$inferSelect;

export type CaseWithLatestProgress = Case & {
  latestProgress?: {
    content: string;
    createdAt: string;
  } | null;
  managerName?: string | null;
};

// 진행상황 업데이트 테이블
export const progressUpdates = pgTable("progress_updates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  content: text("content").notNull(), // 주요 진행사항 내용
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(),
});

export const insertProgressUpdateSchema = createInsertSchema(progressUpdates).omit({
  id: true,
  createdAt: true,
});

export type InsertProgressUpdate = z.infer<typeof insertProgressUpdateSchema>;
export type ProgressUpdate = typeof progressUpdates.$inferSelect;

// 보고서 심사 스키마
export const reviewCaseSchema = z.object({
  decision: z.enum(["승인", "비승인"]),
  reviewComment: z.string().max(800, "검토 의견은 800자를 초과할 수 없습니다").optional().or(z.literal("")),
});

export type ReviewCaseInput = z.infer<typeof reviewCaseSchema>;

// 보고서 승인 스키마 (2차승인)
export const approveReportSchema = z.object({
  decision: z.enum(["승인", "비승인"]),
  approvalComment: z.string().max(800, "승인 의견은 800자를 초과할 수 없습니다").optional().or(z.literal("")),
});

export type ApproveReportInput = z.infer<typeof approveReportSchema>;

// 역할 권한 관리 테이블
export const rolePermissions = pgTable("role_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roleName: text("role_name").notNull().unique(), // 역할명 (예: "보험사", "협력사", "심사사")
  permissions: text("permissions").notNull(), // JSON string: { [category]: string[] }
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateRolePermissionSchema = insertRolePermissionSchema.partial().extend({
  roleName: z.string().min(1, "역할명을 입력해주세요"),
});

export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;
export type UpdateRolePermission = z.infer<typeof updateRolePermissionSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;

// 권한 카테고리 및 항목 정의
export const PERMISSION_CATEGORIES = {
  "홈": [],
  "새로운접수": [],
  "현장조사": ["현장입력", "도면작성", "증빙자료 업로드", "견적서 작성", "보고서 작성"],
  "종합진행관리": ["종합진행관리", "접수건 삭제 권한"],
  "정산 및 통계": ["통계", "정산조회"],
  "관리자 설정": ["계정관리", "DB관리", "기준정보 관리", "접근권한관리", "인보이스 승인", "보고서 승인"],
} as const;

// 엑셀 데이터 저장 테이블 (노무비/자재비)
export const excelData = pgTable("excel_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(), // "노무비" | "자재비"
  title: text("title").notNull(), // "2025-09-01 전국 - 정부노임단가"
  headers: json("headers").$type<string[]>().notNull(),
  data: json("data").$type<any[][]>().notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  typeTitleUnique: unique("type_title_unique").on(table.type, table.title),
}));

export const insertExcelDataSchema = createInsertSchema(excelData).omit({
  id: true,
  uploadedAt: true,
  updatedAt: true,
});

export type InsertExcelData = z.infer<typeof insertExcelDataSchema>;
export type ExcelData = typeof excelData.$inferSelect;

// 1:1 문의 테이블
export const inquiries = pgTable("inquiries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("대기"), // "대기" | "완료"
  responseTitle: text("response_title"),
  response: text("response"),
  respondedBy: varchar("responded_by").references(() => users.id),
  respondedAt: timestamp("responded_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertInquirySchema = createInsertSchema(inquiries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateInquirySchema = insertInquirySchema.partial().extend({
  id: z.string(),
});

export const respondInquirySchema = z.object({
  responseTitle: z.string().min(1, "답변 제목을 입력해주세요"),
  response: z.string().min(1, "답변 내용을 입력해주세요"),
});

export type InsertInquiry = z.infer<typeof insertInquirySchema>;
export type UpdateInquiry = z.infer<typeof updateInquirySchema>;
export type RespondInquiry = z.infer<typeof respondInquirySchema>;
export type Inquiry = typeof inquiries.$inferSelect;

// 현장조사 데이터 공유 테이블 (같은 보험사고번호의 모든 케이스가 공유)
export const fieldSurveyData = pgTable("field_survey_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseGroupId: text("case_group_id").notNull().unique(), // 케이스 그룹 식별자 (보험사고번호 기반)
  
  // 현장조사 정보
  visitDate: text("visit_date"), // 방문 일시 (날짜)
  visitTime: text("visit_time"), // 방문 일시 (시간)
  accompaniedPerson: text("accompanied_person"), // 출동담당자
  travelDistance: text("travel_distance"), // 현장 이동 거리
  dispatchLocation: text("dispatch_location"), // 출동 업장지
  accidentTime: text("accident_time"), // 사고 발생 시각
  accidentCategory: text("accident_category"), // 사고 원인 카테고리 (배관, 교체, 방수, 기타)
  processingTypes: text("processing_types"), // 처리 유형 (JSON array)
  processingTypeOther: text("processing_type_other"), // 기타 처리 유형
  recoveryMethodType: text("recovery_method_type"), // 복구 방식 (부분수리, 전체수리)
  fieldSurveyStatus: text("field_survey_status").default("draft"), // 현장조사 상태 (draft/submitted)
  
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertFieldSurveyDataSchema = createInsertSchema(fieldSurveyData).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFieldSurveyData = z.infer<typeof insertFieldSurveyDataSchema>;
export type FieldSurveyData = typeof fieldSurveyData.$inferSelect;

// 공유 도면 테이블 (같은 보험사고번호의 모든 케이스가 공유)
export const sharedDrawings = pgTable("shared_drawings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseGroupId: text("case_group_id").notNull().unique(), // 케이스 그룹 식별자
  uploadedImages: json("uploaded_images").$type<{
    id: string;
    src: string;
    x: number;
    y: number;
    width: number;
    height: number;
    locked: boolean;
  }[]>().notNull().default(sql`'[]'`),
  rectangles: json("rectangles").$type<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    locked: boolean;
  }[]>().notNull().default(sql`'[]'`),
  accidentAreas: json("accident_areas").$type<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    locked: boolean;
  }[]>().notNull().default(sql`'[]'`),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSharedDrawingSchema = createInsertSchema(sharedDrawings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSharedDrawing = z.infer<typeof insertSharedDrawingSchema>;
export type SharedDrawing = typeof sharedDrawings.$inferSelect;

// 개별 도면 테이블 (케이스별 독립 수정 가능)
export const drawings = pgTable("drawings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().unique(), // 케이스당 하나의 도면만 존재
  uploadedImages: json("uploaded_images").$type<{
    id: string;
    src: string;
    x: number;
    y: number;
    width: number;
    height: number;
    locked: boolean;
  }[]>().notNull().default(sql`'[]'`),
  rectangles: json("rectangles").$type<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    locked: boolean;
  }[]>().notNull().default(sql`'[]'`),
  accidentAreas: json("accident_areas").$type<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    locked: boolean;
  }[]>().notNull().default(sql`'[]'`),
  leakMarkers: json("leak_markers").$type<{
    id: string;
    x: number;
    y: number;
  }[]>().notNull().default(sql`'[]'`),
  canvasImage: text("canvas_image"), // Base64 encoded canvas snapshot for PDF export
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDrawingSchema = createInsertSchema(drawings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDrawing = z.infer<typeof insertDrawingSchema>;
export type Drawing = typeof drawings.$inferSelect;

// 증빙자료 문서 테이블
export const caseDocuments = pgTable("case_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  category: text("category").notNull(), // 서브카테고리: 현장출동사진, 수리중 사진, 복구완료 사진, 보험금 청구서, 등
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  fileData: text("file_data"), // Base64 encoded file data (레거시 호환용, 신규는 NULL)
  // Object Storage 관련 필드 (신규 업로드용)
  storageKey: text("storage_key"), // Object Storage 키
  status: text("status").notNull().default("ready"), // pending | ready | failed
  checksum: text("checksum"), // MD5 또는 SHA256 체크섬
  displayOrder: integer("display_order").notNull().default(0), // 표시 순서
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 문서 서브카테고리 (탭별)
export const DOCUMENT_CATEGORIES = [
  // 사진 탭
  "현장출동사진", "수리중 사진", "복구완료 사진",
  // 기본자료 탭
  "보험금 청구서", "개인정보 동의서(가족용)",
  // 증빙자료 탭
  "주민등록등본", "등기부등본", "건축물대장", "기타증빙자료(민원일지 등)",
  // 청구자료 탭
  "복구완료 및 위임장", "도급계약서", "부가세 청구자료"
] as const;
export type DocumentCategory = typeof DOCUMENT_CATEGORIES[number];

export const insertCaseDocumentSchema = createInsertSchema(caseDocuments).omit({
  id: true,
  createdAt: true,
}).extend({
  parentCategory: z.string().optional(), // 탭 정보 (청구자료 등) - DB에 저장되지 않음, 상태 변경 로직에만 사용
});

export type InsertCaseDocument = z.infer<typeof insertCaseDocumentSchema>;
export type CaseDocument = typeof caseDocuments.$inferSelect;

// 마스터 데이터 테이블 (관리자 기준정보관리용)
export const masterData = pgTable("master_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: text("category").notNull(), // "room_category" | "location" | "work_name"
  value: text("value").notNull(), // 실제 표시 값
  note: text("note"), // 메모
  tag: text("tag").default("공통"), // 태그: 공통, 새로운 접수, 현장입력 등
  isActive: text("is_active").notNull().default("true"), // "true" | "false"
  displayOrder: integer("display_order").notNull().default(0), // 표시 순서
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // unique constraint: 같은 카테고리에서 같은 값 중복 방지
  unq: unique().on(table.category, table.value),
}));

export const MASTER_DATA_CATEGORIES = ["room_category", "location", "work_name", "work_type"] as const;
export type MasterDataCategory = typeof MASTER_DATA_CATEGORIES[number];

export const insertMasterDataSchema = createInsertSchema(masterData).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMasterData = z.infer<typeof insertMasterDataSchema>;
export type MasterData = typeof masterData.$inferSelect;

// 견적서 테이블 (부모 테이블)
export const estimates = pgTable("estimates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id),
  version: integer("version").notNull().default(1), // 버전 관리
  status: text("status").notNull().default("draft"), // "draft" | "submitted" | "approved"
  createdBy: varchar("created_by").notNull().references(() => users.id),
  laborCostData: json("labor_cost_data"), // 노무비 데이터 (JSON)
  materialCostData: json("material_cost_data"), // 자재비 데이터 (JSON)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // unique constraint: 케이스당 버전별로 하나만 허용
  unq: unique().on(table.caseId, table.version),
}));

// 복구면적 산출표 행 테이블 (자식 테이블)
export const estimateRows = pgTable("estimate_rows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id),
  category: text("category").notNull(), // 장소: 주방, 화장실, 방안, 거실 등
  location: text("location"), // 위치: 천장, 벽면, 바닥
  workType: text("work_type"), // 공종: 목공사, 수장공사, 철거공사 등
  workName: text("work_name"), // 공사명: 합판, 석고보드, 도배 등
  damageWidth: numeric("damage_width", { precision: 20, scale: 4, mode: 'number' }), // 피해면적 가로 (m) - 소수점 허용
  damageHeight: numeric("damage_height", { precision: 20, scale: 4, mode: 'number' }), // 피해면적 세로 (m) - 소수점 허용
  damageArea: numeric("damage_area", { precision: 20, scale: 4, mode: 'number' }), // 피해면적 면적 (m²) - 계산된 값, 소수점 허용
  repairWidth: numeric("repair_width", { precision: 20, scale: 4, mode: 'number' }), // 복구면적 가로 (m) - 소수점 허용
  repairHeight: numeric("repair_height", { precision: 20, scale: 4, mode: 'number' }), // 복구면적 세로 (m) - 소수점 허용
  repairArea: numeric("repair_area", { precision: 20, scale: 4, mode: 'number' }), // 복구면적 면적 (m²) - 계산된 값, 소수점 허용
  note: text("note"), // 비고
  rowOrder: integer("row_order").notNull(), // 행 순서
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // unique constraint: 각 견적 내에서 행 순서는 중복되지 않음
  unqOrder: unique().on(table.estimateId, table.rowOrder),
}));

export const insertEstimateSchema = createInsertSchema(estimates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEstimateRowSchema = createInsertSchema(estimateRows).omit({
  id: true,
  createdAt: true,
});

export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimates.$inferSelect;
export type InsertEstimateRow = z.infer<typeof insertEstimateRowSchema>;
export type EstimateRow = typeof estimateRows.$inferSelect;

// 노무비 마스터 테이블
export const laborCosts = pgTable("labor_costs", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // 공종: 가구공사, 도배공사 등
  workName: text("work_name").notNull(), // 공사명: 고정, 철거 등
  detailWork: text("detail_work").notNull(), // 세부공사: 실리콘, 타일 등
  detailItem: text("detail_item"), // 세부항목: 선택적
  priceStandard: text("price_standard").notNull(), // 단가기준: 인, 일, 시간 등
  unit: text("unit").notNull(), // 단위: 일, 시간, ㎡ 등
  standardPrice: integer("standard_price").notNull(), // 기준가(원) = 노임단가(E)
  standardWorkQuantity: real("standard_work_quantity").notNull().default(100), // 기준작업량(D값), 일위대가 = E/D - 소수점 지원
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertLaborCostSchema = createInsertSchema(laborCosts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLaborCost = z.infer<typeof insertLaborCostSchema>;
export type LaborCost = typeof laborCosts.$inferSelect;

// 자재비 마스터 테이블 (공종별 자재 관리)
export const materials = pgTable("materials", {
  id: serial("id").primaryKey(),
  workType: text("work_type").notNull(), // 공종: 방수공사, 도배공사, 장판공사 등
  materialName: text("material_name").notNull(), // 자재명: 우레탄, 실리콘, 합지 등
  specification: text("specification").notNull().default(""), // 규격: 빈 문자열 허용
  unit: text("unit").notNull(), // 단위: EA, ㎡, 롤 등
  standardPrice: integer("standard_price").notNull(), // 기준단가(원)
  isActive: text("is_active").notNull().default("true"), // "true" | "false"
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // unique constraint: 같은 공종에서 같은 자재명+규격 중복 방지
  unq: unique().on(table.workType, table.materialName, table.specification),
}));

export const insertMaterialSchema = createInsertSchema(materials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMaterial = z.infer<typeof insertMaterialSchema>;
export type Material = typeof materials.$inferSelect;

// 사용자 즐겨찾기 테이블
export const userFavorites = pgTable("user_favorites", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  menuName: text("menu_name").notNull(), // 메뉴 이름 (홈, 접수하기, 현장조사, 종합진행관리, 정산 및 통계, 관리자 설정)
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // 한 사용자가 같은 메뉴를 중복으로 즐겨찾기 할 수 없도록
  unq: unique().on(table.userId, table.menuName),
}));

export const MENU_ITEMS = ["홈", "접수하기", "현장조사", "종합진행관리", "정산 및 통계", "관리자 설정"] as const;

export const insertUserFavoriteSchema = createInsertSchema(userFavorites).omit({
  id: true,
  createdAt: true,
}).extend({
  menuName: z.enum(MENU_ITEMS),
});

export type UserFavorite = typeof userFavorites.$inferSelect;
export type InsertUserFavorite = z.infer<typeof insertUserFavoriteSchema>;

// 공지사항 테이블
export const notices = pgTable("notices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  content: text("content").notNull(),
  authorId: varchar("author_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertNoticeSchema = createInsertSchema(notices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Notice = typeof notices.$inferSelect;
export type InsertNotice = z.infer<typeof insertNoticeSchema>;

// 케이스 변경 로그 테이블
export const caseChangeLogs = pgTable("case_change_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  changedBy: varchar("changed_by").references(() => users.id), // 변경자 (사용자 ID)
  changedByName: text("changed_by_name"), // 변경자 이름 (조회 편의용)
  changedAt: timestamp("changed_at").defaultNow().notNull(), // 변경 시간
  changeType: text("change_type").notNull(), // 변경 유형: "create" | "update" | "status_change"
  changes: json("changes").$type<Array<{field: string; fieldLabel: string; before: string | null; after: string | null}>>(), // 변경 내용
  note: text("note"), // 변경 사유/메모
});

export const insertCaseChangeLogSchema = createInsertSchema(caseChangeLogs).omit({
  id: true,
  changedAt: true,
});

export type CaseChangeLog = typeof caseChangeLogs.$inferSelect;
export type InsertCaseChangeLog = z.infer<typeof insertCaseChangeLogSchema>;

// 입금내역 타입 정의
export interface DepositEntryData {
  id: string;
  depositDate: string;
  insuranceCompany: string;
  claimAmount: number;
  depositStatus: "입금" | "미입금";
  depositAmount: number;
  memo: string;
  depositCategory?: string;
}

// LMS 발송 이력 타입 정의
export interface LmsSendEntry {
  id: string;
  sentAt: string;
  messageType: string;
  recipientType: string;
  recipientCompany: string;
  recipientName: string;
  recipientPhone: string;
  senderName: string;
}

// 지급내역 타입 정의
export interface PaymentEntryData {
  id: string;
  paymentDate: string;
  insuranceCompany: string;
  paymentAmount: number;
  commission: number;
  paymentCategory: string;
  memo: string;
}

// 정산 테이블
export const settlements = pgTable("settlements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  settlementAmount: text("settlement_amount").notNull(), // 정산금액
  settlementDate: text("settlement_date").notNull(), // 정산일자
  commission: text("commission"), // 수수료
  discount: text("discount"), // 입금액 (레거시, 하위 호환용)
  deductible: text("deductible"), // 자기부담금
  invoiceDate: text("invoice_date"), // 계산서 발행일
  memo: text("memo"), // 정산 메모
  bank: text("bank"), // 입금은행
  closingDate: text("closing_date"), // 종결일 (정산완료 시 설정)
  partnerPaymentAmount: text("partner_payment_amount"), // 협력업체 지급금액
  partnerPaymentDate: text("partner_payment_date"), // 협력업체 지급일
  depositEntries: json("deposit_entries").$type<DepositEntryData[]>(), // 입금내역 배열
  paymentEntries: json("payment_entries").$type<PaymentEntryData[]>(), // 지급내역 배열
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(),
});

export const insertSettlementSchema = createInsertSchema(settlements).omit({
  id: true,
  createdAt: true,
  createdBy: true,
});

export type Settlement = typeof settlements.$inferSelect;
export type InsertSettlement = z.infer<typeof insertSettlementSchema>;

// 인보이스 테이블
export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  caseGroupPrefix: text("case_group_prefix"), // 사건번호 그룹 접두사 (예: "251217005")
  type: text("type").notNull(), // "직접복구" | "선견적요청"
  status: text("status").notNull().default("draft"), // "draft" | "approved" | "partial" | "rejected"
  
  // 금액 정보
  damagePreventionEstimate: text("damage_prevention_estimate"), // 손해방지비용 견적금액
  damagePreventionApproved: text("damage_prevention_approved"), // 손해방지비용 승인금액
  propertyRepairEstimate: text("property_repair_estimate"), // 대물복구비용 견적금액
  propertyRepairApproved: text("property_repair_approved"), // 대물복구비용 승인금액
  fieldDispatchAmount: text("field_dispatch_amount"), // 현장출동비용 (선견적요청)
  totalApprovedAmount: text("total_approved_amount"), // 총 승인 금액
  deductible: text("deductible"), // 자기부담금
  
  // 승인 정보
  submissionDate: text("submission_date"), // 제출일
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: text("approved_at"), // 승인일시
  settlementStatus: text("settlement_status"), // "정산" | "부분입금" | "청구변경"
  remarks: text("remarks"), // 비고
  
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
});

export const INVOICE_TYPES = ["직접복구", "선견적요청"] as const;
export type InvoiceType = typeof INVOICE_TYPES[number];

export const INVOICE_STATUSES = ["draft", "approved", "partial", "rejected"] as const;
export type InvoiceStatus = typeof INVOICE_STATUSES[number];

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;

// 노임단가 적용비율 테이블 (C/D 비율에 따른 E 적용률)
export const laborRateTiers = pgTable("labor_rate_tiers", {
  id: serial("id").primaryKey(),
  minRatio: integer("min_ratio").notNull(), // 최소 C/D 비율 (백분율, 예: 85 = 85%)
  rateMultiplier: integer("rate_multiplier").notNull(), // E 적용률 (백분율, 예: 100 = 100%)
  sortOrder: integer("sort_order").notNull(), // 정렬 순서 (높은 비율부터)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertLaborRateTierSchema = createInsertSchema(laborRateTiers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateLaborRateTierSchema = z.object({
  id: z.number(),
  minRatio: z.number().min(0).max(100),
  rateMultiplier: z.number().min(0).max(100),
});

export const updateLaborRateTiersSchema = z.object({
  tiers: z.array(updateLaborRateTierSchema),
});

export type LaborRateTier = typeof laborRateTiers.$inferSelect;
export type InsertLaborRateTier = z.infer<typeof insertLaborRateTierSchema>;
export type UpdateLaborRateTier = z.infer<typeof updateLaborRateTierSchema>;

// 기본 노임단가 적용비율 (초기 시드 데이터)
export const DEFAULT_LABOR_RATE_TIERS: InsertLaborRateTier[] = [
  { minRatio: 85, rateMultiplier: 100, sortOrder: 1 }, // ≥85%: 100%
  { minRatio: 80, rateMultiplier: 95, sortOrder: 2 },  // ≥80%: 95%
  { minRatio: 75, rateMultiplier: 82, sortOrder: 3 },  // ≥75%: 82%
  { minRatio: 70, rateMultiplier: 74, sortOrder: 4 },  // ≥70%: 74%
  { minRatio: 65, rateMultiplier: 66, sortOrder: 5 },  // ≥65%: 66%
  { minRatio: 60, rateMultiplier: 58, sortOrder: 6 },  // ≥60%: 58%
  { minRatio: 50, rateMultiplier: 50, sortOrder: 7 },  // ≥50%: 50%
  { minRatio: 0, rateMultiplier: 45, sortOrder: 8 },   // <50%: 45%
];

// 일위대가 기준작업량(D값) 오버라이드 테이블
// Excel 데이터의 D값을 사용자가 수정할 수 있도록 저장
export const unitPriceOverrides = pgTable("unit_price_overrides", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // 공종
  workName: text("work_name").notNull(), // 공사명
  laborItem: text("labor_item").notNull(), // 노임항목
  standardWorkQuantity: real("standard_work_quantity").notNull().default(100), // 기준작업량(D값) - 소수점 지원
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // unique constraint: 공종+공사명+노임항목 조합은 유일해야 함
  unqKey: unique().on(table.category, table.workName, table.laborItem),
}));

export const insertUnitPriceOverrideSchema = createInsertSchema(unitPriceOverrides).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UnitPriceOverride = typeof unitPriceOverrides.$inferSelect;
export type InsertUnitPriceOverride = z.infer<typeof insertUnitPriceOverrideSchema>;

// 견적서 제외 항목 테이블 (철거공사 자동 생성 노무비 등)
// 사용자가 삭제(제외)한 항목을 영속적으로 저장하여 재마운트/새로고침 후에도 부활 방지
export const estimateExclusions = pgTable("estimate_exclusions", {
  id: serial("id").primaryKey(),
  caseId: text("case_id").notNull(), // 케이스 ID
  exclusionType: text("exclusion_type").notNull(), // 'demolition_auto_labor' 등
  deletionKey: text("deletion_key").notNull(), // 'matchedWorkName|detailItem' 형식
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // unique constraint: 케이스+타입+키 조합은 유일해야 함
  unqKey: unique().on(table.caseId, table.exclusionType, table.deletionKey),
}));

export const insertEstimateExclusionSchema = createInsertSchema(estimateExclusions).omit({
  id: true,
  createdAt: true,
});

export type EstimateExclusion = typeof estimateExclusions.$inferSelect;
export type InsertEstimateExclusion = z.infer<typeof insertEstimateExclusionSchema>;

// 케이스 상태 변경 이력 테이블
export const caseStatusHistory = pgTable("case_status_history", {
  id: serial("id").primaryKey(),
  caseId: text("case_id").notNull(),
  previousStatus: text("previous_status").notNull(),
  newStatus: text("new_status").notNull(),
  changedAt: text("changed_at").notNull(),
});

export const insertCaseStatusHistorySchema = createInsertSchema(caseStatusHistory).omit({
  id: true,
});

export type CaseStatusHistory = typeof caseStatusHistory.$inferSelect;
export type InsertCaseStatusHistory = z.infer<typeof insertCaseStatusHistorySchema>;

// Chat models for AI integration
export * from "./models/chat";
