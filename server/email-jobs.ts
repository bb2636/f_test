// 이메일 발송 백그라운드 작업 추적
// [지연 개선 2026-05-07] 현장출동보고서 PDF 생성+이메일 발송이 동기 처리되어
// 클라이언트가 7~20초 대기. 백그라운드로 돌리고 클라이언트는 jobId로 폴링.
export type EmailJobStatus =
  | "queued"
  | "generating_pdf"
  | "sending"
  | "completed"
  | "failed";

export interface EmailJob {
  id: string;
  status: EmailJobStatus;
  caseId?: string;
  recipients?: string[];
  createdAt: number;
  updatedAt: number;
  message?: string;
  successCount?: number;
  failCount?: number;
  errors?: string[];
  ownerUserId?: string;
}

const jobs = new Map<string, EmailJob>();
const JOB_TTL_MS = 24 * 60 * 60 * 1000; // 24시간 후 자동 정리

export function createEmailJob(
  init: Partial<EmailJob> & { ownerUserId: string },
): EmailJob {
  const id = `emailjob-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const job: EmailJob = {
    id,
    status: "queued",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...init,
  };
  jobs.set(id, job);
  console.log(
    `[EmailJob] Created ${id} for case=${job.caseId} recipients=${job.recipients?.length || 0}`,
  );
  return job;
}

export function updateEmailJob(
  id: string,
  patch: Partial<EmailJob>,
): EmailJob | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  Object.assign(job, patch, { updatedAt: Date.now() });
  console.log(
    `[EmailJob] ${id} → ${job.status}${job.message ? ` (${job.message})` : ""}`,
  );
  return job;
}

export function getEmailJob(id: string): EmailJob | undefined {
  return jobs.get(id);
}

// 1시간마다 만료된 작업 정리
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [id, job] of Array.from(jobs.entries())) {
    if (now - job.updatedAt > JOB_TTL_MS) {
      jobs.delete(id);
      removed++;
    }
  }
  if (removed > 0) console.log(`[EmailJob] Cleaned up ${removed} expired jobs`);
}, 60 * 60 * 1000);
cleanupTimer.unref?.();
