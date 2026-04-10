import { z } from "zod";

export const sendSmsSchema = z.object({
  to: z.string().min(10, "유효한 전화번호를 입력해주세요").max(20),
  caseNumber: z.string().optional(),
  insuranceCompany: z.string().optional(),
  managerName: z.string().optional(),
  insurancePolicyNo: z.string().optional(),
  insuranceAccidentNo: z.string().optional(),
  insuredName: z.string().optional(),
  insuredContact: z.string().optional(),
  victimName: z.string().optional(),
  victimContact: z.string().optional(),
  assessorTeam: z.string().optional(),
  assessorContact: z.string().optional(),
  investigatorTeamName: z.string().optional(),
  investigatorContact: z.string().optional(),
  accidentLocation: z.string().optional(),
  accidentLocationDetail: z.string().optional(),
  victimAddressDetail: z.string().optional(),
  requestScope: z.string().optional(),
});

export const sendCustomSmsSchema = z.object({
  subject: z.string().min(1, "제목을 입력해주세요"),
  content: z.string().min(1, "내용을 입력해주세요"),
  recipients: z
    .array(
      z.object({
        name: z.string(),
        phone: z.string().min(10, "유효한 전화번호를 입력해주세요").max(20),
      }),
    )
    .min(1, "수신인을 1명 이상 입력해주세요"),
  senderName: z.string().optional(),
});

export const sendCaseLmsSchema = z.object({
  messageType: z.enum(["청구금액 지급요청", "중복보험 미지급금 요청"]),
  recipientType: z.enum(["심사자", "조사자"]),
});
