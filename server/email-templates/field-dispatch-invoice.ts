export interface FieldDispatchInvoiceTemplateData {
  insuranceCompany: string | null;
  accidentNo: string | null;
  caseNumber: string | null;
  fieldDispatchAmount: number;
  remarks: string | null;
  dateStr: string;
  formatAmount: (amount: number) => string;
}

export function renderFieldDispatchInvoiceTemplate(data: FieldDispatchInvoiceTemplateData): { html: string; text: string } {
  const {
    insuranceCompany, accidentNo, caseNumber,
    fieldDispatchAmount, remarks, dateStr, formatAmount,
  } = data;

  const html = `
        <div style="font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">현장출동비용 청구서</h2>
          
          <p style="color: #666; line-height: 1.8;">안녕하세요,</p>
          
          <p style="color: #666; line-height: 1.8;">
            아래 청구건에 대한 <strong>현장출동비용 청구서</strong>를 첨부하여 송부드립니다.
          </p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; width: 30%; font-weight: bold;">보험사</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${insuranceCompany || "-"}</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">사고번호</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${accidentNo || "-"}</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">사건번호</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${caseNumber || "-"}</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">현장출동비용</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd; font-weight: bold; color: #0066cc;">${formatAmount(fieldDispatchAmount || 0)}원</td>
            </tr>
            ${
              remarks
                ? `<tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">비고</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${remarks}</td>
            </tr>`
                : ""
            }
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">발송일</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${dateStr}</td>
            </tr>
          </table>
          
          <p style="color: #666; line-height: 1.8;">
            첨부된 현장출동비용 청구서 PDF 파일을 확인해 주시기 바랍니다.
          </p>
          
          <p style="color: #666; line-height: 1.8; margin-top: 30px;">
            감사합니다.<br/>
            <strong>FLOXN</strong><br/>
            <span style="font-size: 12px; color: #999;">주식회사 플록슨(FLOXN Co., Ltd.)</span>
          </p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;" />
          
          <p style="color: #999; font-size: 12px;">
            본 메일은 FLOXN 시스템에서 자동 발송되었습니다.
          </p>
        </div>
      `;

  const text = `현장출동비용 청구서

안녕하세요,

아래 청구건에 대한 현장출동비용 청구서를 첨부하여 송부드립니다.

- 보험사: ${insuranceCompany || "-"}
- 사고번호: ${accidentNo || "-"}
- 사건번호: ${caseNumber || "-"}
- 현장출동비용: ${formatAmount(fieldDispatchAmount || 0)}원
${remarks ? `- 비고: ${remarks}` : ""}
- 발송일: ${dateStr}

첨부된 현장출동비용 청구서 PDF 파일을 확인해 주시기 바랍니다.

감사합니다.
FLOXN
주식회사 플록슨(FLOXN Co., Ltd.)`;

  return { html, text };
}
