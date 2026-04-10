export interface InvoiceV1TemplateData {
  insuranceCompany: string | null;
  accidentNo: string | null;
  caseNumber: string | null;
  damagePreventionAmount: number;
  propertyRepairAmount: number;
  totalAmount: number;
  remarks: string | null;
  dateStr: string;
  formatAmount: (amount: number) => string;
}

export function renderInvoiceV1Template(data: InvoiceV1TemplateData): { html: string; text: string } {
  const {
    insuranceCompany, accidentNo, caseNumber,
    damagePreventionAmount, propertyRepairAmount, totalAmount,
    remarks, dateStr, formatAmount,
  } = data;

  const html = `
        <div style="font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">INVOICE 송부</h2>
          
          <p style="color: #666; line-height: 1.8;">안녕하세요,</p>
          
          <p style="color: #666; line-height: 1.8;">
            아래 청구건에 대한 <strong>INVOICE</strong>를 첨부하여 송부드립니다.
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
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">손해방지비용</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${formatAmount(damagePreventionAmount || 0)}원</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">대물복구비용</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd;">${formatAmount(propertyRepairAmount || 0)}원</td>
            </tr>
            <tr>
              <td style="background: #f5f5f5; padding: 10px 15px; border: 1px solid #ddd; font-weight: bold;">합계</td>
              <td style="padding: 10px 15px; border: 1px solid #ddd; font-weight: bold; color: #0066cc;">${formatAmount(totalAmount || 0)}원</td>
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
            첨부된 INVOICE PDF 파일을 확인해 주시기 바랍니다.
          </p>
          
          <p style="color: #666; line-height: 1.8; margin-top: 30px;">
            감사합니다.<br/>
            <strong>FLOXN</strong>
          </p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;" />
          
          <p style="color: #999; font-size: 12px;">
            본 메일은 FLOXN 시스템에서 자동 발송되었습니다.
          </p>
        </div>
      `;

  const text = `INVOICE 송부

안녕하세요,

아래 청구건에 대한 INVOICE를 첨부하여 송부드립니다.

- 보험사: ${insuranceCompany || "-"}
- 사고번호: ${accidentNo || "-"}
- 사건번호: ${caseNumber || "-"}
- 손해방지비용: ${formatAmount(damagePreventionAmount || 0)}원
- 대물복구비용: ${formatAmount(propertyRepairAmount || 0)}원
- 합계: ${formatAmount(totalAmount || 0)}원
${remarks ? `- 비고: ${remarks}` : ""}
- 발송일: ${dateStr}

첨부된 INVOICE PDF 파일을 확인해 주시기 바랍니다.

감사합니다.
FLOXN`;

  return { html, text };
}
