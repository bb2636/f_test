export interface CancellationTemplateData {
  accidentNo: string;
  insuredName: string;
  cancelReason: string | null;
  // [2026-05-19] 라디오 선택값(취소사유 카테고리). 별도 행으로 표시
  cancelReasonCategory?: string | null;
  dateStr: string;
  caseNumber: string;
  logoBuffer: Buffer | null;
  // [2026-06-09] 접수취소 다중세대 연동: 함께 취소되는 대상(원인/피해세대) 라벨 목록
  cancelTargets?: string[];
}

export function renderCancellationTemplate(data: CancellationTemplateData): { html: string; text: string } {
  const { accidentNo, insuredName, cancelReason, cancelReasonCategory, dateStr, caseNumber, logoBuffer, cancelTargets } = data;
  // [2026-05-15] 이메일 표시용으로 라디오 항목의 'ㆍ' 불릿 접두어를 제거
  // (예: "ㆍ현장방문거절" → "현장방문거절"). 라벨 셀에 '취소사유'가 이미 있으므로 값만 표시.
  const displayCancelReason = cancelReason
    ? cancelReason
        .split("\n")
        .map((l) => l.replace(/^ㆍ\s*/, ""))
        .join("\n")
    : cancelReason;
  const displayCategory = cancelReasonCategory && cancelReasonCategory.trim() ? cancelReasonCategory.trim() : "-";
  // [2026-06-10] 취소 대상(다중세대)은 별도 행이 아니라 '취소내용' 셀 안(취소사유 아래)에 포함시킨다.
  const targets = (cancelTargets || []).filter((t) => t && t.trim());
  const cancelTargetsHtmlInline =
    targets.length > 0 ? `\n\n취소 대상:\n${targets.join("\n")}` : "";
  const cancelTargetsTextInline =
    targets.length > 0
      ? `\n  취소 대상:\n${targets.map((t) => `    ${t}`).join("\n")}`
      : "";

  const html = `
        <div style="font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; text-align: center; border-bottom: 2px solid #333; padding-bottom: 15px; margin-bottom: 20px;">접수취소 안내드립니다.</h2>
          
          <p style="color: #333; line-height: 1.8; margin-bottom: 20px;">
            안녕하세요.<br/>
            아래 내용의 <strong>접수취소</strong> 사유를 첨부하여 송부드립니다.
          </p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="background: #f8f8f8; padding: 10px 15px; border: 1px solid #ccc; width: 35%; font-weight: bold;">사고번호(증권번호)</td>
              <td style="padding: 10px 15px; border: 1px solid #ccc;">${accidentNo}</td>
            </tr>
            <tr>
              <td style="background: #f8f8f8; padding: 10px 15px; border: 1px solid #ccc; font-weight: bold;">피보험자명</td>
              <td style="padding: 10px 15px; border: 1px solid #ccc;">${insuredName}</td>
            </tr>
            <tr>
              <!-- [2026-05-19] 취소사유/취소내용 칸 통합 — 취소내용 한 칸에 "취소사유: {선택값}" + 다음 줄에 자유텍스트 -->
              <td style="background: #f8f8f8; padding: 10px 15px; border: 1px solid #ccc; font-weight: bold; vertical-align: top;">취소내용</td>
              <td style="padding: 10px 15px; border: 1px solid #ccc; white-space: pre-line; word-break: break-word;">취소사유: ${displayCategory}
${displayCancelReason || "-"}${cancelTargetsHtmlInline}</td>
            </tr>
            <tr>
              <td style="background: #f8f8f8; padding: 10px 15px; border: 1px solid #ccc; font-weight: bold;">발송일</td>
              <td style="padding: 10px 15px; border: 1px solid #ccc;">${dateStr}</td>
            </tr>
          </table>
          
          <p style="color: #333; line-height: 1.8; margin: 20px 0;">
            첨부된 PDF 파일을 확인해주시길 바랍니다. 감사합니다.
          </p>
          
          <div style="border-top: 1px solid #e0e0e0; padding-top: 16px; margin-top: 24px;">
            ${logoBuffer ? '<img src="cid:floxn-logo" alt="FLOXN" style="height: 24px; margin-bottom: 8px;">' : '<p style="font-size: 14px; font-weight: bold; color: #333; margin: 0 0 8px 0;">FLOXN</p>'}
            <p style="font-size: 12px; color: #666; margin: 0 0 4px 0;">Front Line Ops Xpert Net</p>
            <p style="font-size: 12px; color: #666; margin: 0 0 4px 0;">주식회사 플록슨(FLOXN Co., Ltd.)</p>
            <p style="font-size: 12px; color: #666; margin: 0;">서울특별시 영등포구 당산로 133, 서림빌딩 3층 302호</p>
          </div>
        </div>
      `;

  const text = `접수취소 안내드립니다.

안녕하세요.
아래 내용의 접수취소 사유를 송부드립니다.

- 사고번호(증권번호): ${accidentNo}
- 접수번호: ${caseNumber}
- 피보험자명: ${insuredName}
- 취소내용:
  취소사유: ${displayCategory}
  ${displayCancelReason || "-"}${cancelTargetsTextInline}
- 발송일: ${dateStr}

감사합니다.
FLOXN`;

  return { html, text };
}
