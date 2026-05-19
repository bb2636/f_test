import { z } from "zod";

export const sendFieldDispatchReportEmailSchema = z.object({
  email: z.string().email("유효한 이메일 주소를 입력해주세요"),
});

export const generateInvoicePdfSchema = z.object({
  caseId: z.string().min(1, "케이스 ID가 필요합니다"),
  recipientName: z.string().optional(),
  damagePreventionAmount: z.number().optional().default(0),
  propertyRepairAmount: z.number().optional().default(0),
  fieldDispatchPreventionAmount: z.number().optional().default(0),
  fieldDispatchPropertyAmount: z.number().optional().default(0),
  totalAmount: z.number().optional(),
  remarks: z.string().optional(),
  selectedDocumentIds: z.array(z.string()).optional().default([]),
  isOnlyFieldDispatch: z.boolean().optional().default(false),
});

export const sendInvoiceEmailV2Schema = z.object({
  email: z.string().min(1, "이메일 주소가 필요합니다"),
  caseId: z.string().min(1, "케이스 ID가 필요합니다"),
  recipientName: z.string().optional(),
  damagePreventionAmount: z.number().optional().default(0),
  propertyRepairAmount: z.number().optional().default(0),
  fieldDispatchPreventionAmount: z.number().optional().default(0),
  fieldDispatchPropertyAmount: z.number().optional().default(0),
  totalAmount: z.number().optional(),
  remarks: z.string().optional(),
  selectedDocumentIds: z.array(z.string()).optional().default([]),
});

export const sendFieldReportEmailSchema = z.object({
  email: z.string().email("올바른 이메일 형식이 아닙니다").optional(),
  emails: z
    .array(z.string().email("올바른 이메일 형식이 아닙니다"))
    .optional(),
  pdfBase64: z.string().min(1, "PDF 데이터가 필요합니다"),
  caseId: z.string().optional(),
  caseNumber: z.string().optional(),
  insuranceCompany: z.string().optional(),
  accidentNo: z.string().optional(),
  clientName: z.string().optional(),
  insuredName: z.string().optional(),
  visitDate: z.string().optional().nullable(),
  accidentCategory: z.string().optional().nullable(),
  accidentCause: z.string().optional().nullable(),
  recoveryMethodType: z.string().optional().nullable(),
});

export const sendFieldReportEmailV2Schema = z.object({
  emails: z
    .array(z.string().email("올바른 이메일 형식이 아닙니다"))
    .min(1, "수신자 이메일이 필요합니다"),
  caseId: z.string().min(1, "케이스 ID가 필요합니다"),
  sections: z.object({
    cover: z.boolean().default(true),
    fieldReport: z.boolean().default(true),
    drawing: z.boolean().default(true),
    evidence: z.boolean().default(true),
    estimate: z.boolean().default(true),
    etc: z.boolean().default(false),
  }),
  evidence: z
    .object({
      tab: z.string().default("전체"),
      selectedFileIds: z.array(z.string()).default([]),
    })
    .default({ tab: "전체", selectedFileIds: [] }),
});

export const cancellationEmailSchema = z.object({
  caseId: z.string(),
  cancelReason: z.string().optional(),
  // [2026-05-19] 라디오 선택값(취소사유 카테고리)을 별도 필드로 전달받음
  cancelReasonCategory: z.string().optional(),
  recipients: z.object({
    sendToAssessor: z.boolean().default(false),
    sendToInvestigator: z.boolean().default(false),
    manualEmail: z.string().optional(),
  }),
});
