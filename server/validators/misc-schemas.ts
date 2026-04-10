import { z } from "zod";

export const manualHistorySchema = z.object({
  date: z.string().min(1),
  medium: z.string().optional().default(""),
  content: z.string().min(1),
  recipient: z.string().optional().default(""),
});

export const accountNotificationSchema = z.object({
  sendEmail: z.boolean().default(false),
  sendSms: z.boolean().default(false),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  name: z.string(),
  username: z.string(),
  password: z.string(),
  role: z.string(),
  company: z.string().optional().nullable(),
});

export const batchEstimatesSchema = z.object({
  caseIds: z.array(z.string().min(1)).max(100),
});

export const pdfDownloadSchema = z.object({
  caseId: z.string().min(1),
  sections: z.object({
    cover: z.boolean().default(false),
    fieldReport: z.boolean().default(false),
    drawing: z.boolean().default(false),
    evidence: z.boolean().default(false),
    estimate: z.boolean().default(false),
    etc: z.boolean().default(false),
  }),
  evidence: z
    .object({
      tab: z.string().default("전체"),
      selectedFileIds: z.array(z.string()).default([]),
    })
    .default({ tab: "전체", selectedFileIds: [] }),
});
