import nodemailer from 'nodemailer';

const SMTP_CONFIGS = {
  hiworks: {
    host: process.env.SMTP_HOST || 'smtps.hiworks.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: true,
    user: process.env.SMTP_USER || 'master@floxn.co.kr',
  },
  gmail: {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    user: process.env.GMAIL_USER || '',
  },
};

function getSmtpConfig() {
  const provider = (process.env.MAIL_PROVIDER || 'hiworks').toLowerCase();
  const config = SMTP_CONFIGS[provider as keyof typeof SMTP_CONFIGS] || SMTP_CONFIGS.hiworks;
  
  if (provider === 'gmail' && process.env.GMAIL_USER) {
    config.user = process.env.GMAIL_USER;
  }
  
  return { provider, config };
}

let transporter: nodemailer.Transporter | null = null;

export function initializeEmailTransporter(): void {
  const password = process.env.SMTP_PASSWORD || process.env.MAIL_APP_PASSWORD;
  
  if (!password) {
    console.warn('[Email] SMTP_PASSWORD not set - email sending will be disabled');
    return;
  }

  const { provider, config } = getSmtpConfig();
  
  console.log('[Email] Initializing SMTP transporter...');
  console.log(`[Email] Provider: ${provider}`);
  console.log(`[Email] Host: ${config.host}, Port: ${config.port}, Secure: ${config.secure}`);
  console.log(`[Email] User: ${config.user}`);

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: password,
    },
  });

  transporter.verify((error, success) => {
    if (error) {
      const err = error as any;
      console.error('[Email] ========== SMTP VERIFICATION FAILED ==========');
      console.error(`[Email] Provider: ${provider}`);
      console.error(`[Email] Host: ${config.host}:${config.port}`);
      console.error(`[Email] User: ${config.user}`);
      console.error(`[Email] Error code: ${err.code || 'N/A'}`);
      console.error(`[Email] Error command: ${err.command || 'N/A'}`);
      console.error(`[Email] Error responseCode: ${err.responseCode || 'N/A'}`);
      console.error(`[Email] Error response: ${err.response || 'N/A'}`);
      console.error(`[Email] Error message: ${err.message || 'N/A'}`);
      console.error('[Email] ==============================================');
    } else {
      console.log('[Email] SMTP connection verified successfully');
    }
  });
}

interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
  cid?: string; // Content-ID for inline images (e.g., 'floxn-logo')
}

interface SendEmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export async function sendEmailWithAttachment(options: SendEmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { provider, config } = getSmtpConfig();
  
  if (!transporter) {
    const password = process.env.SMTP_PASSWORD || process.env.MAIL_APP_PASSWORD;
    if (!password) {
      return { success: false, error: 'SMTP_PASSWORD not configured' };
    }
    
    console.log('[Email] Creating transporter on-demand...');
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: password,
      },
    });
  }

  try {
    console.log(`[Email] Sending email via ${provider}`);
    console.log(`[Email] To: ${options.to}`);
    console.log(`[Email] Subject: ${options.subject}`);
    console.log(`[Email] Attachments: ${options.attachments?.length || 0} files`);
    
    // 상세 첨부 파일 로깅
    let totalAttachmentBytes = 0;
    let totalBase64Bytes = 0;
    if (options.attachments && options.attachments.length > 0) {
      console.log('[Email] ========== 첨부 파일 상세 정보 ==========');
      for (const att of options.attachments) {
        const rawBytes = att.content.length;
        const base64Bytes = Math.ceil(rawBytes * 4 / 3); // base64 인코딩 후 예상 크기
        totalAttachmentBytes += rawBytes;
        totalBase64Bytes += base64Bytes;
        console.log(`[Email]   ${att.filename}: ${(rawBytes / 1024 / 1024).toFixed(3)}MB (raw) → ${(base64Bytes / 1024 / 1024).toFixed(3)}MB (base64)`);
      }
      console.log('[Email] ------------------------------------------');
      console.log(`[Email] 총 첨부 파일: ${options.attachments.length}개`);
      console.log(`[Email] 총 raw 용량: ${(totalAttachmentBytes / 1024 / 1024).toFixed(3)}MB`);
      console.log(`[Email] 총 base64 용량 (예상): ${(totalBase64Bytes / 1024 / 1024).toFixed(3)}MB`);
      
      // 이메일 본문 크기 추가
      const textBytes = options.text?.length || 0;
      const htmlBytes = options.html?.length || 0;
      const headerEstimate = 2000; // MIME 헤더 예상
      const totalMessageEstimate = totalBase64Bytes + textBytes + htmlBytes + headerEstimate;
      console.log(`[Email] 본문(text/html): ${((textBytes + htmlBytes) / 1024).toFixed(1)}KB`);
      console.log(`[Email] 전체 메시지 예상 크기: ${(totalMessageEstimate / 1024 / 1024).toFixed(3)}MB`);
      console.log('[Email] ==============================================');
    }
    
    const fromAddress = process.env.SMTP_FROM || config.user;
    const mailOptions: nodemailer.SendMailOptions = {
      from: `"FLOXN" <${fromAddress}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments?.map(att => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType || 'application/pdf',
        ...(att.cid ? { cid: att.cid } : {}), // CID for inline images
      })),
    };

    const result = await transporter.sendMail(mailOptions);
    console.log(`[Email] Email sent successfully. MessageId: ${result.messageId}`);
    
    return { success: true, messageId: result.messageId };
  } catch (error: any) {
    console.error('[Email] ========== SEND MAIL FAILED ==========');
    console.error(`[Email] Provider: ${provider}`);
    console.error(`[Email] To: ${options.to}`);
    console.error(`[Email] Error code: ${error.code || 'N/A'}`);
    console.error(`[Email] Error command: ${error.command || 'N/A'}`);
    console.error(`[Email] Error responseCode: ${error.responseCode || 'N/A'}`);
    console.error(`[Email] Error response: ${error.response || 'N/A'}`);
    console.error(`[Email] Error message: ${error.message || 'N/A'}`);
    console.error('[Email] ==========================================');
    return { success: false, error: error.message };
  }
}

export interface FieldReportEmailData {
  insuranceAccidentNo?: string;
  policyNumber?: string;
  assessorTeam?: string;
  investigatorTeam?: string;
}

export async function sendFieldReportEmail(
  to: string,
  caseNumber: string,
  insuredName: string,
  pdfBuffer: Buffer,
  additionalData?: FieldReportEmailData
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  // 사고번호(증권번호) 필드: 사고번호 우선, 없으면 증권번호, 둘 다 없으면 '-'
  const accidentNo = additionalData?.insuranceAccidentNo || additionalData?.policyNumber || '-';
  const policyNo = additionalData?.policyNumber || '-';
  const assessor = additionalData?.assessorTeam || '-';
  const investigator = additionalData?.investigatorTeam || '-';
  
  // 이메일 제목: 보험사 사고번호 우선, 없으면 증권번호, 둘 다 없으면 접수번호
  const subjectIdentifier = additionalData?.insuranceAccidentNo || additionalData?.policyNumber || caseNumber;
  const subject = `[FLOXN] 현장출동보고서 - ${subjectIdentifier}`;
  
  const htmlContent = `
    <div style="font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">현장출동보고서 송부</h2>
      
      <p style="color: #666; line-height: 1.8;">안녕하세요,</p>
      
      <p style="color: #666; line-height: 1.8;">
        아래 접수건에 대한 <strong>현장출동보고서</strong>를 첨부하여 송부드립니다.
      </p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; table-layout: fixed;">
        <tr>
          <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; width: 20%; font-weight: bold;">사고번호(증권번호)</td>
          <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">${accidentNo}</td>
        </tr>
        <tr>
          <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; width: 20%; font-weight: bold;">담당자</td>
          <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; width: 15%; font-weight: bold; text-align: center;">심사자</td>
          <td style="padding: 10px 15px; border: 1px solid #ddd; width: 25%; word-break: break-word;">${assessor}</td>
          <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; width: 15%; font-weight: bold; text-align: center;">조사자</td>
          <td style="padding: 10px 15px; border: 1px solid #ddd; width: 25%; word-break: break-word;">${investigator}</td>
        </tr>
        <tr>
          <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">피보험자</td>
          <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">${insuredName || '-'}</td>
        </tr>
        <tr>
          <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">접수번호</td>
          <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">${caseNumber}</td>
        </tr>
        <tr>
          <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">발송일</td>
          <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">${dateStr}</td>
        </tr>
      </table>
      
      <p style="color: #666; line-height: 1.8;">
        첨부된 PDF 파일을 확인해 주시기 바랍니다.
      </p>
      
      <p style="color: #666; line-height: 1.8; margin-top: 30px;">
        감사합니다.
      </p>
      
      <div style="border-top: 1px solid #e0e0e0; padding-top: 16px; margin-top: 24px;">
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIoAAAAZCAYAAADudbaJAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAbUSURBVHgB7VpLUiM3GP5tTA1Fo8LsktWYE4w5wTQnwHMCzAkwWafK5gSYE2CWWcGcgJ5dduPsspueXRap4BRQRfFyvq/5u5Fl9dNQiaf8VcndVkvqlvTpf0mV9fX1+v39/RcRWZcMjEaj/evr654c/n2Of55kohIgbcr+26HMMdOogiQ7koMkij05vKjnIwkxQtm7uswx86jJa2O0+INMgZWVleNKpVKXchjWarVdLIZTK//z1dVVV0pgdXXVw2Ubide6jC+yAaTuoFqtfrq8vDxz1OvY7eHbdm9ubgJJwNraWhNt7tn56NfHu7u7HYxN03qU2Td8yyEuDSNrgDr7aXVenyhTAoPuYaDqUgKoF8jTRHqO/EIAYRuYlEO7LQSS0D7LZQPcO37EWEwET4mqGPXx4Qf47LlakzNgmOxJD7abw8BkIjv8qxqHt7j832S8p2S3o8JVGWOTGDS2yAA7Tgvbx1KQUziKSatG+VRuuFi22se23e14SIJ4MNOPJIU4L3H8sKYEyUDFP0qSSaA/AAXX9MgoYlORAQIgQCTeOBop7O0tFQ387SOZ+ZRElJVSQZIUpVeL4aZIwoHC2K1kidh5W3IFKDox8VFEh/Jg1rZwHu2NG1CYmxgkvp2YRItIkLoNT7VH3uVqqD4vSSP473dNHvGQtsm3zSYS5QUPDw8dBz2UU+J8dkuT4kB8nDFd+1nJhFoiEqKClLj27ZL+iDZieTHGPmmxZwo6fDMPyr6j7IqgUQHqpbG2oKkCCefhiieT6gQShGoDEqchv1ekPZAiiPR/imKOVESQHfWIU38vKL/8fGxZ+fBnd2O7tUbssuQSHuO5nKpHPXmfDPPZf+UQQ2Nk925CqMcxWWxKGvl5pu8IPAN63kMNfYryzvIqP/eHhe4u2cFmphQTXSdcYnVB1TDASRFM839L6pyNG5kRtqpgmhnfZQpUONgwrL/Bx/0LqswPuAkDMcf/oWXVt5nlRcy/OefAnlZcAC6OcoFSKWJQkLaeSSf5MTi4uIQ42XXH2uTKgikpwo6d7VRRuXQToK6ObA8tSYlZEZsJRVhwA1isG9mUpeyE3ZhxgSQtke/vNsFwc7y1JlVaBxkLA8TH+SsHk4Yxspuc4J8GojjuLm2UfwCXk4MelacJzFsLMZWMEWbZecotlE40SQCpMtXDMgF7kdg5lfmUcdp4Igin9HHc0Yq6cYxxI5nF1EdpC/I25EZhyt6u7Cw8FZyQl1ru03n4pOEvTaMc0tD/4XBDVyrLUZ5S8dWQonCTkHEUfyNrSLdY+lAx9HAijrDwFJIFopWxyrhsz462KS+fGkpo+LYk1dGgu1GdTvIUx9jU7fz1MaLkbT/Y31HKUkAqTJQEnaN7DbyPkkJVClJSBLDoPLJZE19zYvI0GVgCfknmsfEDvRYnnsQhlvYnIbBaYA4/pYnyRRAP3535DVyVg+NYUd9P7rnuOO/K84xtOqUlgRYqEe2m142vF81rW5ONINJsFlOmPDfOdi24Yv/YXkaxoxWKpGIdlnR+V9DDT97FbeiWEgW4CFNxC/gHsfkw+R3bW+H0hLJtUFYahwphdDeWLxGtYQnBVE1trDPHO7kh+id/OGuqOpeT/MphrkyxmwS6PK2PA/ytswuJuIceVY3Rb6DBP3IMIUd2BJHvASLdosqQxxenaqgXCQ1oYTvyZSgMdvQD/Hth7rbycBTl/9VDNaj52Qrz0MwHmDWU30a6fK6zCgoumVSqnB1n7qCWOoQcFImyBS5ubrQUvdxGNkVyxbSsS+lNnR+prIVU8+j0MXDhX65Uzej8xe6AtJQeBW8NtSbaGWVg6po8UyJQ69zcTR55iSyAexFZCEmgWv/iCoH4zi22Lgf5Dii2uRutn0oKgt6dmWXxx6kJChRfN44TkrFMJ4N0IGYGLhvuco71NPMgjEm29WMYOj7tMNVXZUQocqh+rYLUOXYeUlHEkjaMiF5JZcvJRETRZ5ORnXtAprn8R4f2VO1EtVp29KG4hcrIY4K5tlE+7+DASw9QhDkraNxGC8iSR6V43qvZBxJKIKEg1N569aOwOiWrgjuXn7AfSjaVJJ4vFfxeKL3+4yjyJMhywBbH/cDrjB6UfJsl/TKRBZN4F30FAIjK5Di8KUE0J/Y61M1vMHx0VAAF0jDKh9gM5DhBe7PjO31QI01lWiBkT2MiJQE3buZIIZuWvL7fCM7SGvLCO/bDkam1A8jSlHALUl8apBry5x0PfTrOqr31DAGS89mzPEdYIE/IMDw9vb26M2bN2RoHelHfe4j9bHBtQvm/2lWRPk/lpeXfzU2uliHYu03pBbKz7zKmeMZ/wIRNShQKfpKwwAAAABJRU5ErkJggg==" alt="FLOXN" style="height: 24px; margin-bottom: 8px;">
        <p style="font-size: 12px; color: #666; margin: 0 0 8px 0;">Front·Line·Ops·Xpert·Net</p>
        <p style="font-size: 12px; color: #666; margin: 0;">주식회사 플록슨(FLOXN Co., Ltd.)</p>
        <p style="font-size: 12px; color: #666; margin: 0;">서울특별시 영등포구 당산로 133, 서림빌딩 3층 302호</p>
      </div>
    </div>
  `;

  const textContent = `
현장출동보고서 송부

안녕하세요,

아래 접수건에 대한 현장출동보고서를 첨부하여 송부드립니다.

- 사고번호(증권번호): ${accidentNo}
- 담당자: 심사자 ${assessor} / 조사자 ${investigator}
- 피보험자: ${insuredName || '-'}
- 접수번호: ${caseNumber}
- 발송일: ${dateStr}

첨부된 PDF 파일을 확인해 주시기 바랍니다.

감사합니다.
FLOXN
  `;

  // 파일명도 이메일 제목과 동일한 우선순위: 사고번호 > 증권번호 > 접수번호
  const filenameIdentifier = additionalData?.insuranceAccidentNo || additionalData?.policyNumber || caseNumber;
  const filename = `현장출동보고서_${filenameIdentifier}_${dateStr}.pdf`;

  return sendEmailWithAttachment({
    to,
    subject,
    text: textContent,
    html: htmlContent,
    attachments: [
      {
        filename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}

export async function sendFieldReportEmailWithLink(
  to: string,
  caseNumber: string,
  insuredName: string,
  pdfUrl: string,
  additionalData?: FieldReportEmailData
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  // 사고번호(증권번호) 필드: 사고번호 우선, 없으면 증권번호, 둘 다 없으면 '-'
  const accidentNo = additionalData?.insuranceAccidentNo || additionalData?.policyNumber || '-';
  const assessor = additionalData?.assessorTeam || '-';
  const investigator = additionalData?.investigatorTeam || '-';
  
  const subjectIdentifier = additionalData?.insuranceAccidentNo || additionalData?.policyNumber || caseNumber;
  const subject = `[FLOXN] 현장출동보고서 - ${subjectIdentifier}`;
  
  const htmlContent = `
    <div style="font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">현장출동보고서 송부</h2>
      
      <p style="color: #666; line-height: 1.8;">안녕하세요,</p>
      
      <p style="color: #666; line-height: 1.8;">
        아래 접수건에 대한 <strong>현장출동보고서</strong>를 송부드립니다.
      </p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; table-layout: fixed;">
        <tr>
          <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; width: 20%; font-weight: bold;">사고번호(증권번호)</td>
          <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">${accidentNo}</td>
        </tr>
        <tr>
          <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; width: 20%; font-weight: bold;">담당자</td>
          <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; width: 15%; font-weight: bold; text-align: center;">심사자</td>
          <td style="padding: 10px 15px; border: 1px solid #ddd; width: 25%; word-break: break-word;">${assessor}</td>
          <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; width: 15%; font-weight: bold; text-align: center;">조사자</td>
          <td style="padding: 10px 15px; border: 1px solid #ddd; width: 25%; word-break: break-word;">${investigator}</td>
        </tr>
        <tr>
          <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">피보험자</td>
          <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">${insuredName || '-'}</td>
        </tr>
        <tr>
          <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">접수번호</td>
          <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">${caseNumber}</td>
        </tr>
        <tr>
          <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">발송일</td>
          <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">${dateStr}</td>
        </tr>
      </table>
      
      <div style="background: #f0f7ff; border: 1px solid #0066cc; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
        <p style="color: #333; margin: 0 0 15px 0; font-weight: bold;">📎 PDF 다운로드</p>
        <a href="${pdfUrl}" style="display: inline-block; background: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
          현장출동보고서 다운로드
        </a>
        <p style="color: #666; font-size: 12px; margin: 15px 0 0 0;">
          (링크는 7일간 유효합니다)
        </p>
      </div>
      
      <p style="color: #666; line-height: 1.8; margin-top: 30px;">
        감사합니다.
      </p>
      
      <div style="border-top: 1px solid #e0e0e0; padding-top: 16px; margin-top: 24px;">
        <img src="data:image/png;base64,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" alt="FLOXN" style="height: 24px; margin-bottom: 8px;">
        <p style="font-size: 12px; color: #666; margin: 0 0 8px 0;">Front·Line·Ops·Xpert·Net</p>
        <p style="font-size: 12px; color: #666; margin: 0;">주식회사 플록슨(FLOXN Co., Ltd.)</p>
        <p style="font-size: 12px; color: #666; margin: 0;">서울특별시 영등포구 당산로 133, 서림빌딩 3층 302호</p>
      </div>
    </div>
  `;

  const textContent = `
현장출동보고서 송부

안녕하세요,

아래 접수건에 대한 현장출동보고서를 송부드립니다.

- 사고번호(증권번호): ${accidentNo}
- 담당자: 심사자 ${assessor} / 조사자 ${investigator}
- 피보험자: ${insuredName || '-'}
- 접수번호: ${caseNumber}
- 발송일: ${dateStr}

▶ PDF 다운로드 링크 (7일간 유효):
${pdfUrl}

감사합니다.
FLOXN
  `;

  return sendEmailWithAttachment({
    to,
    subject,
    text: textContent,
    html: htmlContent,
    attachments: [],
  });
}
