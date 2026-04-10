export interface FieldReportV2TemplateData {
  accidentNo: string;
  assessorTeam: string;
  investigatorTeamName: string;
  insuredName: string;
  caseNumber: string;
  sendDate: string;
  logoBuffer: Buffer | null;
}

export function renderFieldReportV2Template(data: FieldReportV2TemplateData): { html: string; text: string } {
  const {
    accidentNo, assessorTeam, investigatorTeamName,
    insuredName, caseNumber, sendDate, logoBuffer,
  } = data;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 40px; border-radius: 8px;">
    <h1 style="font-size: 24px; font-weight: bold; margin-bottom: 8px; color: #333;">현장출동보고서 송부</h1>
    <hr style="border: none; border-top: 3px solid #e85a1b; margin-bottom: 24px;">
    
    <p style="color: #333; margin-bottom: 16px;">안녕하세요.<br>아래 접수건에 대한 현장출동보고서를 첨부하여 송부드립니다.</p>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
      <tr>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold; width: 120px;">사고번호(증권번호)</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;" colspan="4">${accidentNo || "-"}</td>
      </tr>
      <tr>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold;">담당자</td>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold; width: 80px;">심사자</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;">${assessorTeam || "-"}</td>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold; width: 80px;">조사자</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;">${investigatorTeamName || "-"}</td>
      </tr>
      <tr>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold;">피보험자</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;" colspan="4">${insuredName || "-"}</td>
      </tr>
      <tr>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold;">접수번호</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;" colspan="4">${caseNumber || "-"}</td>
      </tr>
      <tr>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold;">발송일</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;" colspan="4">${sendDate}</td>
      </tr>
    </table>
    
    <p style="color: #333; margin-bottom: 24px;">첨부된 PDF 파일을 확인해 주시기 바랍니다.</p>
    
    <p style="color: #333; margin-bottom: 16px;">감사합니다.</p>
    
    <div style="border-top: 1px solid #e0e0e0; padding-top: 16px; margin-top: 24px;">
      ${logoBuffer ? '<img src="cid:floxn-logo" alt="FLOXN" style="height: 24px; margin-bottom: 8px;">' : '<p style="font-size: 18px; font-weight: bold; color: #333; margin: 0 0 4px 0;">FLOXN</p>'}
      <p style="font-size: 12px; color: #666; margin: 0 0 8px 0;">Front·Line·Ops·Xpert·Net</p>
      <p style="font-size: 12px; color: #666; margin: 0;">주식회사 플록슨(FLOXN Co., Ltd.)</p>
      <p style="font-size: 12px; color: #666; margin: 0;">서울특별시 영등포구 당산로 133, 서림빌딩 3층 302호</p>
    </div>
  </div>
</body>
</html>`;

  const text = `현장출동보고서 송부

안녕하세요.
아래 접수건에 대한 현장출동보고서를 첨부하여 송부드립니다.

사고번호: ${accidentNo || "-"}
심사자: ${assessorTeam || "-"}
조사자: ${investigatorTeamName || "-"}
피보험자: ${insuredName || "-"}
접수번호: ${caseNumber || "-"}
발송일: ${sendDate}

첨부된 PDF 파일을 확인해 주시기 바랍니다.

감사합니다.

---
FLOXN`;

  return { html, text };
}
