#!/usr/bin/env node
/**
 * SMTP Test Send Script
 * Usage: node scripts/smtp-test-send.cjs <recipient_email>
 */

const nodemailer = require('nodemailer');

const SMTP_CONFIG = {
  host: 'smtps.hiworks.com',
  port: 465,
  secure: true,
  user: 'hjlee@floxn.co.kr',
};

async function sendTestEmail(recipientEmail) {
  const password = process.env.MAIL_APP_PASSWORD;

  if (!password) {
    console.error('ERROR: MAIL_APP_PASSWORD environment variable is not set');
    process.exit(1);
  }

  if (!recipientEmail) {
    console.error('ERROR: Recipient email is required');
    console.error('Usage: node scripts/smtp-test-send.cjs <recipient_email>');
    process.exit(1);
  }

  console.log('========================================');
  console.log('SMTP Test Email Send');
  console.log('========================================');
  console.log(`From: ${SMTP_CONFIG.user}`);
  console.log(`To: ${recipientEmail}`);
  console.log('========================================');

  const transporter = nodemailer.createTransport({
    host: SMTP_CONFIG.host,
    port: SMTP_CONFIG.port,
    secure: SMTP_CONFIG.secure,
    auth: {
      user: SMTP_CONFIG.user,
      pass: password,
    },
  });

  const testPdfContent = Buffer.from('%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 612 792]\n>>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<<\n/Size 4\n/Root 1 0 R\n>>\nstartxref\n199\n%%EOF');

  const mailOptions = {
    from: `"FLOXN 시스템" <${SMTP_CONFIG.user}>`,
    to: recipientEmail,
    subject: '[FLOXN] SMTP 테스트 이메일 - PDF 첨부',
    text: `안녕하세요,\n\nFLOXN 시스템에서 발송한 테스트 이메일입니다.\n\nPDF 파일이 정상적으로 첨부되었는지 확인해주세요.\n\n발송 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n\n감사합니다.\nFLOXN`,
    html: `
      <div style="font-family: 'Malgun Gothic', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">FLOXN SMTP 테스트</h2>
        <p>안녕하세요,</p>
        <p>FLOXN 시스템에서 발송한 <strong>테스트 이메일</strong>입니다.</p>
        <p>PDF 파일이 정상적으로 첨부되었는지 확인해주세요.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">발송 시간</td>
            <td style="padding: 10px 15px; border: 1px solid #ddd;">${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td>
          </tr>
          <tr>
            <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">발신자</td>
            <td style="padding: 10px 15px; border: 1px solid #ddd;">${SMTP_CONFIG.user}</td>
          </tr>
        </table>
        <p style="color: #666;">감사합니다.<br/><strong>FLOXN</strong></p>
      </div>
    `,
    attachments: [
      {
        filename: 'FLOXN_테스트_문서.pdf',
        content: testPdfContent,
        contentType: 'application/pdf',
      },
    ],
  };

  console.log('\nSending test email...\n');

  try {
    const result = await transporter.sendMail(mailOptions);
    console.log('========================================');
    console.log('SUCCESS: Email sent!');
    console.log('========================================');
    console.log('MessageId:', result.messageId);
    console.log('Response:', result.response);
    process.exit(0);
  } catch (error) {
    console.error('========================================');
    console.error('FAILED: Email send failed');
    console.error('========================================');
    console.error('Error code:', error.code || 'N/A');
    console.error('Error command:', error.command || 'N/A');
    console.error('Error responseCode:', error.responseCode || 'N/A');
    console.error('Error response:', error.response || 'N/A');
    console.error('Error message:', error.message || 'N/A');
    process.exit(1);
  }
}

sendTestEmail(process.argv[2]);
