import type { Request } from "express";

// ============================================================
// 휴대폰 인증번호 임시 저장 (in-memory, 단일 프로세스 가정)
// - 비밀번호 변경 시 본인확인용 6자리 코드.
// - TTL 5분, 1회 사용 후 폐기, 재발송 쿨다운 60초.
// - 서버 재기동 시 코드는 사라지지만(짧은 수명) 사용자가 재발송하면 되므로 허용.
// ============================================================
type CodeEntry = { code: string; expiresAt: number; lastSentAt: number };

const codeStore = new Map<string, CodeEntry>();
const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

export function canSendCode(userId: string): { ok: boolean; waitSec: number } {
  const entry = codeStore.get(userId);
  if (entry) {
    const elapsed = Date.now() - entry.lastSentAt;
    if (elapsed < RESEND_COOLDOWN_MS) {
      return { ok: false, waitSec: Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000) };
    }
  }
  return { ok: true, waitSec: 0 };
}

export function issueCode(userId: string): string {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  codeStore.set(userId, {
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
    lastSentAt: Date.now(),
  });
  return code;
}

export function verifyCode(userId: string, code: string): boolean {
  const entry = codeStore.get(userId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    codeStore.delete(userId);
    return false;
  }
  if (entry.code !== String(code).trim()) return false;
  codeStore.delete(userId); // 1회용
  return true;
}

// ============================================================
// 휴대폰 번호 마스킹 (010-****-1234)
// ============================================================
export function maskPhone(phone: string): string {
  const d = (phone || "").replace(/[^0-9]/g, "");
  if (d.length < 7) return "***";
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

// ============================================================
// User-Agent 파싱 (OS / 디바이스 추정)
// 브라우저는 PC 호스트명을 제공하지 않으므로 OS+브라우저로 대체 표기한다.
// ============================================================
export function parseUserAgent(ua: string): { device: string; os: string } {
  const s = ua || "";

  let os = "알 수 없음";
  if (/Windows NT 10/.test(s)) os = "Windows 10/11";
  else if (/Windows NT 6\.3/.test(s)) os = "Windows 8.1";
  else if (/Windows NT 6\.1/.test(s)) os = "Windows 7";
  else if (/Windows/.test(s)) os = "Windows";
  else if (/iPhone|iPad|iPod/.test(s)) {
    const m = s.match(/OS (\d+)[._](\d+)/);
    os = m ? `iOS ${m[1]}.${m[2]}` : "iOS";
  } else if (/Mac OS X/.test(s)) os = "macOS";
  else if (/Android/.test(s)) {
    const m = s.match(/Android (\d+(?:\.\d+)?)/);
    os = m ? `Android ${m[1]}` : "Android";
  } else if (/Linux/.test(s)) os = "Linux";

  let browser = "브라우저";
  if (/Edg\//.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/.test(s)) browser = "Opera";
  else if (/SamsungBrowser/.test(s)) browser = "Samsung Internet";
  else if (/Chrome\//.test(s)) browser = "Chrome";
  else if (/Firefox\//.test(s)) browser = "Firefox";
  else if (/Safari\//.test(s)) browser = "Safari";

  const isMobile = /Mobile|Android|iPhone|iPad|iPod/.test(s);
  const device = `${browser} (${isMobile ? "모바일" : "PC"})`;

  return { device, os };
}

// ============================================================
// 클라이언트 IP 추출 (trust proxy=1, x-forwarded-for 우선)
// ============================================================
export function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return (req.ip || req.socket?.remoteAddress || "알 수 없음").replace(/^::ffff:/, "");
}
