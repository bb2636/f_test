import { createSolapiAuthHeader, solapiHttpsRequest } from "./solapi";

// 솔라피 단건 문자 발송 공통 헬퍼.
// 본문 바이트 길이가 90을 넘으면 LMS, 아니면 SMS로 자동 분기한다.
// (기존 /api/send-sms, /api/send-custom-sms 의 발송 로직을 재사용 가능한 형태로 추출)
export async function sendSolapiMessage(
  to: string,
  text: string,
  subject?: string,
): Promise<void> {
  const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
  const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
  const SOLAPI_SENDER = process.env.SOLAPI_SENDER;

  if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !SOLAPI_SENDER) {
    throw new Error("SMS 서비스가 설정되지 않았습니다");
  }

  const normalizedTo = to.replace(/[^0-9]/g, "");
  const normalizedSender = SOLAPI_SENDER.replace(/[^0-9]/g, "");

  if (normalizedTo.length < 10 || normalizedTo.length > 11) {
    throw new Error("유효하지 않은 전화번호 형식입니다");
  }

  const isLms = Buffer.byteLength(text, "utf8") > 90;
  const message: Record<string, string> = {
    to: normalizedTo,
    from: normalizedSender,
    text,
    type: isLms ? "LMS" : "SMS",
  };
  if (isLms && subject) {
    message.subject = subject;
  }

  const body = JSON.stringify({ message });

  await solapiHttpsRequest({
    method: "POST",
    path: "/messages/v4/send",
    headers: {
      Authorization: createSolapiAuthHeader(SOLAPI_API_KEY, SOLAPI_API_SECRET),
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
    body,
  });
}
