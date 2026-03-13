const BASE = 'https://sendmail-43925.bubbleapps.io/version-test/api/1.1/wf';
const WORKFLOW = 'send-file';

interface BubbleEmailPayload {
  sender: string;
  title: string;
  to: string;
  content: string;
}

interface BubbleResponse {
  status?: string;
  [key: string]: unknown;
}

async function callBubbleWF(payload: BubbleEmailPayload): Promise<Record<string, unknown>> {
  const TOKEN = process.env.BUBBLE_API_TOKEN;

  if (!TOKEN) {
    throw new Error('BUBBLE_API_TOKEN environment variable is required');
  }

  const res = await fetch(`${BASE}/${WORKFLOW}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({})) as BubbleResponse;

  if (!res.ok || data?.status === 'error') {
    throw new Error(
      `Bubble WF fail: ${res.status} ${res.statusText}\n` +
        `${typeof data === 'object' ? JSON.stringify(data) : String(data)}`
    );
  }

  return data as Record<string, unknown>;
}

export async function sendVerificationEmail(email: string, code: string): Promise<boolean> {
  try {
    await callBubbleWF({
      sender: 'FLOXN',
      title: 'FLOXN 이메일 인증',
      to: email,
      content: code,
    });
    console.log(`[Email] Verification email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send verification email:', error);
    throw new Error('이메일 전송에 실패했습니다');
  }
}

export async function sendPasswordResetEmail(email: string, code: string): Promise<boolean> {
  try {
    await callBubbleWF({
      sender: 'FLOXN',
      title: 'FLOXN 비밀번호 재설정',
      to: email,
      content: code,
    });
    console.log(`[Email] Password reset email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send password reset email:', error);
    throw new Error('이메일 전송에 실패했습니다');
  }
}

export async function sendNotificationEmail(
  email: string, 
  title: string, 
  emailContent: string
): Promise<boolean> {
  try {
    await callBubbleWF({
      sender: 'FLOXN',
      title: title,
      to: email,
      content: emailContent,
    });
    console.log(`[Email] Notification email sent to ${email}: ${title}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send notification email:', error);
    throw new Error('이메일 전송에 실패했습니다');
  }
}

export async function sendCaseNotificationEmail(
  email: string,
  stage: string,
  caseInfo: {
    caseNumber: string;
    insuranceCompany?: string;
    insurancePolicyNo?: string;
    insuranceAccidentNo?: string;
    insuredName?: string;
    insuredAddress?: string;
    insuredAddressDetail?: string;
    cancelReason?: string;
    recoveryAmount?: number;
    feeRate?: number;
    paymentAmount?: number;
  }
): Promise<boolean> {
  let content = '';
  
  // 기본주소 + 상세주소 결합
  const fullAddress = [caseInfo.insuredAddress, caseInfo.insuredAddressDetail].filter(Boolean).join(" ") || "-";
  
  if (stage === '접수완료') {
    content = `[${stage} 알림]

접수번호 : ${caseInfo.caseNumber}
보험사 : ${caseInfo.insuranceCompany || '-'}
증권번호 : ${caseInfo.insurancePolicyNo || '-'}
사고번호 : ${caseInfo.insuranceAccidentNo || '-'}
피보험자 : ${caseInfo.insuredName || '-'}
사고장소 : ${fullAddress}`;
  } else if (stage === '접수취소') {
    content = `[${stage} 알림]

접수번호 : ${caseInfo.caseNumber}
보험사 : ${caseInfo.insuranceCompany || '-'}
증권번호 : ${caseInfo.insurancePolicyNo || '-'}
사고번호 : ${caseInfo.insuranceAccidentNo || '-'}
피보험자 : ${caseInfo.insuredName || '-'}
사고장소 : ${fullAddress}

위 접수건은 접수 취소 되었음을 알려드립니다.
취소 사유 : ${caseInfo.cancelReason || '-'}`;
  } else if (stage === '결정금액/수수료') {
    content = `[결정금액 및 수수료 안내]

접수번호 : ${caseInfo.caseNumber}
보험사 : ${caseInfo.insuranceCompany || '-'}
증권번호 : ${caseInfo.insurancePolicyNo || '-'}
사고번호 : ${caseInfo.insuranceAccidentNo || '-'}
피보험자 : ${caseInfo.insuredName || '-'}
사고장소 : ${fullAddress}
복구금액 : ${caseInfo.recoveryAmount?.toLocaleString() || '-'}원
수수료 : 최종금액의 ${caseInfo.feeRate || '-'}%
지급금액 : ${caseInfo.paymentAmount?.toLocaleString() || '-'}원`;
  } else {
    content = `[${stage} 알림]

접수번호 : ${caseInfo.caseNumber}
보험사 : ${caseInfo.insuranceCompany || '-'}
증권번호 : ${caseInfo.insurancePolicyNo || '-'}
사고번호 : ${caseInfo.insuranceAccidentNo || '-'}
피보험자 : ${caseInfo.insuredName || '-'}
사고장소 : ${fullAddress}
진행사항 : ${stage}`;
  }

  try {
    await callBubbleWF({
      sender: 'FLOXN',
      title: `[FLOXN] ${stage} 알림`,
      to: email,
      content: content,
    });
    console.log(`[Email] Case notification (${stage}) sent to ${email}`);
    return true;
  } catch (error) {
    console.error(`[Email] Failed to send case notification (${stage}):`, error);
    throw new Error('이메일 전송에 실패했습니다');
  }
}

export async function sendAccountCreationEmail(
  email: string,
  accountInfo: {
    name: string;
    username: string;
    password: string;
    role: string;
    company?: string;
  }
): Promise<boolean> {
  const roleNames: Record<string, string> = {
    admin: '관리자',
    insurer: '보험사',
    partner: '협력사',
    assessor: '심사사',
    investigator: '조사사',
    client: '의뢰사',
  };

  const roleName = roleNames[accountInfo.role] || accountInfo.role;
  
  const content = `[FLOXN 계정 생성 안내]

안녕하세요, ${accountInfo.name}님.

FLOXN 플랫폼 계정이 생성되었습니다.

━━━━━━━━━━━━━━━━━━━━
■ 계정 정보
━━━━━━━━━━━━━━━━━━━━
- 이름: ${accountInfo.name}
- 소속: ${accountInfo.company || '-'}
- 역할: ${roleName}
- 아이디: ${accountInfo.username}
- 비밀번호: ${accountInfo.password}

━━━━━━━━━━━━━━━━━━━━
■ 로그인 안내
━━━━━━━━━━━━━━━━━━━━
아래 주소에서 로그인하실 수 있습니다.
https://www.floxn.co.kr/

로그인 후 반드시 비밀번호를 변경해 주세요.

FLOXN 드림`;

  try {
    await callBubbleWF({
      sender: 'FLOXN',
      title: '[FLOXN] 계정 생성 안내',
      to: email,
      content: content,
    });
    console.log(`[Email] Account creation notification sent to ${email}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send account creation email:', error);
    throw new Error('이메일 전송에 실패했습니다');
  }
}

export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
