export interface InvoiceV2TemplateData {
  accidentNo: string;
  assessorName: string;
  investigatorName: string;
  amountLines: string[];
  allCaseNumbers: string;
  dateStr: string;
  logoBuffer: Buffer | null;
}

export function renderInvoiceV2Template(data: InvoiceV2TemplateData): { html: string; text: string } {
  const {
    accidentNo, assessorName, investigatorName,
    amountLines, allCaseNumbers, dateStr, logoBuffer,
  } = data;

  const html = `
        <div style="font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">INVOICE 전달드립니다</h2>
          
          <p style="color: #666; line-height: 1.8;">안녕하세요,</p>
          
          <p style="color: #666; line-height: 1.8;">
            아래 내용의 <strong>INVOICE</strong>를 첨부하여 송부드립니다.
          </p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; width: 140px; font-weight: bold;">사고번호</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">${accidentNo || "-"}</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">담당자</td>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold; width: 80px;">심사자</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${assessorName}</td>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold; width: 80px;">조사자</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${investigatorName}</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">청구금액</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">
                ${amountLines.map((line) => `<div>${line}</div>`).join("")}
              </td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">접수번호</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;" colspan="4">${allCaseNumbers}</td>
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
          
          <div style="border-top: 1px solid #ddd; padding-top: 16px; margin-top: 24px;">
            ${logoBuffer ? '<img src="cid:floxn-logo" alt="FLOXN" style="height: 24px; margin-bottom: 8px;">' : '<p style="font-size: 18px; font-weight: bold; color: #333; margin: 0 0 4px 0;">FLOXN</p>'}
            <p style="font-size: 12px; color: #666; margin: 0 0 8px 0;">Front·Line·Ops·Xpert·Net</p>
            <p style="font-size: 12px; color: #666; margin: 0;">주식회사 플록슨(FLOXN Co., Ltd.)</p>
            <p style="font-size: 12px; color: #666; margin: 0;">서울특별시 영등포구 당산로 133, 서림빌딩 3층 302호</p>
          </div>
        </div>
      `;

  const text = `안녕하세요,

INVOICE를 첨부하여 전달드립니다.

- 사고번호: ${accidentNo || "-"}
- 담당자: 심사자 ${assessorName} / 조사자 ${investigatorName}

청구금액:
${amountLines.join("\n")}

- 접수번호: ${allCaseNumbers}
- 발송일: ${dateStr}

첨부된 PDF 파일을 확인해 주시기 바랍니다.

감사합니다.

---
FLOXN
Front·Line·Ops·Xpert·Net
주식회사 플록슨(FLOXN Co., Ltd.)
서울특별시 영등포구 당산로 133, 서림빌딩 3층 302호`;

  return { html, text };
}
