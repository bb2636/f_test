import { PDFDocument, PDFPage, PDFFont, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

interface InvoiceData {
  recipientName: string;
  caseNumber: string;
  acceptanceDate: string;
  submissionDate: string;
  insuranceAccidentNo?: string;
  particulars: Array<{
    title: string;
    detail?: string;
    amount: number;
  }>;
  totalAmount: number;
  remarks?: string;
}

interface FontSet {
  regular: PDFFont;
  bold: PDFFont;
}

interface FontCache {
  regular: Buffer | null;
  semiBold: Buffer | null;
}

const fontCache: FontCache = {
  regular: null,
  semiBold: null,
};

/**
 * PDF 출력 전에 텍스트 정규화
 * - NBSP/유니코드 공백 포함 제거
 * - 하이픈/대시(-, –, —, −)를 '-'로 통일
 * - 특수기호 주변 공백 제거 (주로 사고번호/코드/날짜 같은 값에서 문제 해결)
 * - 일반 단어 사이 공백은 유지 (문장/주소 깨짐 방지)
 */
function normalizePdfText(text: string): string {
  if (text == null) return "";

  let s = String(text);

  // 1) 유니코드 공백을 일반 공백으로 통일 (NBSP 포함)
  s = s.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ");

  // 2) 대시류 통일
  //    - (hyphen-minus) / – (en dash) / — (em dash) / − (minus)
  s = s.replace(/[–—−]/g, "-");

  // 3) 특수기호 주변 공백 제거 (중요)
  //    - 사고번호: "HM- 900- 200" -> "HM-900-200"
  //    - 콜론: "사고번호 : 123" -> "사고번호:123"
  //    - 슬래시/점도 포함 (필요시)
  s = s
    .replace(/\s*-\s*/g, "-") // 하이픈 주변 공백 제거
    .replace(/\s*:\s*/g, ":") // 콜론 주변 공백 제거
    .replace(/\s*\/\s*/g, "/") // 슬래시 주변 공백 제거
    .replace(/\s*\.\s*/g, "."); // 점 주변 공백 제거

  // 4) 연속 공백 축소 (단어 사이 공백은 1개 유지)
  s = s.replace(/ {2,}/g, " ");

  return s.trim();
}

function loadPretendardFonts(): { regular: Buffer; semiBold: Buffer } {
  const fontsDir = path.join(process.cwd(), "server/fonts");

  // TTF 파일만 사용 (OTF는 "Not a CFF Font" 에러 발생)
  const regularPath = path.join(fontsDir, "Pretendard-Regular.ttf");
  const semiBoldPath = path.join(fontsDir, "Pretendard-SemiBold.ttf");

  console.log(`[Invoice PDF] ========== TTF 폰트 로딩 ==========`);
  console.log(`[Invoice PDF] Regular 경로: ${regularPath}`);
  console.log(`[Invoice PDF] SemiBold 경로: ${semiBoldPath}`);

  // 파일 존재 확인 - 없으면 즉시 에러
  if (!fs.existsSync(regularPath)) {
    throw new Error(
      `Pretendard-Regular.ttf를 찾을 수 없습니다: ${regularPath}`,
    );
  }
  if (!fs.existsSync(semiBoldPath)) {
    throw new Error(
      `Pretendard-SemiBold.ttf를 찾을 수 없습니다: ${semiBoldPath}`,
    );
  }

  // 파일 크기 확인 및 로그
  const regularStat = fs.statSync(regularPath);
  const semiBoldStat = fs.statSync(semiBoldPath);
  console.log(
    `[Invoice PDF] Regular 파일 크기: ${regularStat.size} bytes (${(regularStat.size / 1024 / 1024).toFixed(2)}MB)`,
  );
  console.log(
    `[Invoice PDF] SemiBold 파일 크기: ${semiBoldStat.size} bytes (${(semiBoldStat.size / 1024 / 1024).toFixed(2)}MB)`,
  );

  // 캐시된 버전과 크기가 다르면 재로드
  if (!fontCache.regular || fontCache.regular.length !== regularStat.size) {
    fontCache.regular = fs.readFileSync(regularPath);

    // 파일 시그니처 검증 (TTF: 0x00010000)
    const signature = fontCache.regular.slice(0, 4).toString("hex");
    console.log(`[Invoice PDF] Regular 시그니처: ${signature}`);

    // HTML/에러 페이지 감지 (<!DOCTYPE 또는 <html로 시작하는 경우)
    const firstChars = fontCache.regular.slice(0, 10).toString("utf8");
    if (firstChars.includes("<!") || firstChars.includes("<html")) {
      throw new Error(
        `Regular 폰트 파일이 HTML/에러 페이지입니다. 첫 10자: ${firstChars}`,
      );
    }

    if (signature !== "00010000") {
      throw new Error(
        `Regular 폰트가 TTF 형식이 아닙니다. 시그니처: ${signature} (예상: 00010000)`,
      );
    }
  }

  if (!fontCache.semiBold || fontCache.semiBold.length !== semiBoldStat.size) {
    fontCache.semiBold = fs.readFileSync(semiBoldPath);

    // 파일 시그니처 검증
    const signature = fontCache.semiBold.slice(0, 4).toString("hex");
    console.log(`[Invoice PDF] SemiBold 시그니처: ${signature}`);

    // HTML/에러 페이지 감지
    const firstChars = fontCache.semiBold.slice(0, 10).toString("utf8");
    if (firstChars.includes("<!") || firstChars.includes("<html")) {
      throw new Error(
        `SemiBold 폰트 파일이 HTML/에러 페이지입니다. 첫 10자: ${firstChars}`,
      );
    }

    if (signature !== "00010000") {
      throw new Error(
        `SemiBold 폰트가 TTF 형식이 아닙니다. 시그니처: ${signature} (예상: 00010000)`,
      );
    }
  }

  console.log(`[Invoice PDF] TTF 폰트 로딩 완료`);
  console.log(`[Invoice PDF] ================================`);

  return { regular: fontCache.regular, semiBold: fontCache.semiBold };
}

function collectAllInvoiceText(data: InvoiceData): string {
  const texts: string[] = [
    // 헤더
    "INVOICE",
    // 정보 레이블
    "수 신",
    "수신",
    ":",
    "수임일자",
    "사고번호",
    "청구일자",
    // 테이블 헤더
    "PARTICULARS",
    "AMOUNT",
    "TOTAL AMOUNT",
    "TOTAL",
    // 계좌 정보 박스
    "아래의 계좌로 입금 부탁드립니다.",
    "은행명",
    "은행",
    "계좌번호",
    "예금주",
    "사업자등록번호",
    "사업자 등록번호",
    "신한은행",
    "신한",
    "㈜플록슨",
    "플록슨",
    "140-015-744120",
    "517-87-03490",
    // 푸터
    "FLOXN., Inc",
    "FLOXN",
    // 비고
    "비 고",
    "비고",
    // 동적 데이터
    data.recipientName || "-",
    data.caseNumber || "-",
    data.insuranceAccidentNo || "-",
    formatDate(data.acceptanceDate),
    formatDate(data.submissionDate),
    formatAmount(data.totalAmount),
    data.remarks || "",
    // 특수 문자 및 숫자
    "0123456789",
    ",원₩.-/()[]{}:;",
    "㈜株",
    // 흔히 사용되는 한글 문자
    "가나다라마바사아자차카타파하",
    "보험사손해방지비용대물복구청구금액합계",
    "접수등록번호일자",
  ];

  // 항목 데이터
  for (const item of data.particulars) {
    texts.push(item.title || "");
    texts.push(item.detail || "");
    texts.push(formatAmount(item.amount));
  }

  const allText = texts.join("");
  const uniqueChars = Array.from(new Set(allText.split(""))).join("");

  console.log(`[Invoice PDF] 수집된 고유 문자 수: ${uniqueChars.length}개`);
  console.log(`[Invoice PDF] 샘플 문자: ${uniqueChars.substring(0, 50)}...`);

  return uniqueChars;
}

async function embedPretendardFonts(pdfDoc: PDFDocument): Promise<FontSet> {
  pdfDoc.registerFontkit(fontkit);

  const { regular, semiBold } = loadPretendardFonts();

  console.log(
    `[Invoice PDF] ========== 폰트 임베딩 (subset: false - 전체 폰트) ==========`,
  );

  // subset: false로 전체 폰트 임베딩 (글자 깨짐 방지)
  let regularFont: PDFFont;
  let semiBoldFont: PDFFont;

  try {
    regularFont = await pdfDoc.embedFont(regular, { subset: false });
    console.log(`[Invoice PDF] Regular 폰트 임베딩 성공 (전체 폰트)`);
  } catch (error) {
    throw new Error(`Pretendard-Regular.ttf embedFont 실패: ${error}`);
  }

  try {
    semiBoldFont = await pdfDoc.embedFont(semiBold, { subset: false });
    console.log(`[Invoice PDF] SemiBold 폰트 임베딩 성공 (전체 폰트)`);
  } catch (error) {
    throw new Error(`Pretendard-SemiBold.ttf embedFont 실패: ${error}`);
  }

  console.log(`[Invoice PDF] 폰트 임베딩 완료 (subset: false)`);
  console.log(
    `[Invoice PDF] =====================================================`,
  );

  return { regular: regularFont, bold: semiBoldFont };
}

function measureTextWidth(text: string, font: PDFFont, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
}

function formatAmount(amount: number): string {
  return amount.toLocaleString("ko-KR") + "원";
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) {
    return new Date()
      .toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .replace(/\. /g, ".")
      .replace(/\.$/, "");
  }

  try {
    const date = new Date(dateStr);
    return date
      .toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .replace(/\. /g, ".")
      .replace(/\.$/, "");
  } catch {
    return dateStr;
  }
}

let drawTextCallCount = 0;

function resetDrawTextCounter(): void {
  drawTextCallCount = 0;
}

function getDrawTextCount(): number {
  return drawTextCallCount;
}

function drawTextLine(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 },
): void {
  drawTextCallCount++;
  try {
    // 한 번의 drawText로 전체 텍스트 렌더링 (문자 단위 분리 금지)
    // characterSpacing, wordSpacing 사용 안함 (기본값 0)
    const normalized = normalizePdfText(text);

    page.drawText(normalized, {
      x,
      y,
      size,
      font,
      color: rgb(color.r, color.g, color.b),
    });
  } catch (e) {
    console.warn(
      `[Invoice PDF] Failed to draw text: "${text.substring(0, 20)}..." - ${e}`,
    );
  }
}

// 하이픈 간격 보정 버전 (폰트 메트릭 문제 해결)
function drawTextLineTight(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 },
): void {
  drawTextCallCount++;
  try {
    const normalized = normalizePdfText(text);
    
    // 하이픈이 없으면 일반 렌더링
    if (!normalized.includes('-')) {
      page.drawText(normalized, {
        x,
        y,
        size,
        font,
        color: rgb(color.r, color.g, color.b),
      });
      return;
    }
    
    // 하이픈 간격 보정 (6% offset)
    const offset = size * 0.06;
    const parts = normalized.split('-');
    let cursorX = x;
    const hyphenWidth = font.widthOfTextAtSize('-', size);
    const textColor = rgb(color.r, color.g, color.b);
    
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) {
        page.drawText(parts[i], { x: cursorX, y, size, font, color: textColor });
        cursorX += font.widthOfTextAtSize(parts[i], size);
      }
      if (i < parts.length - 1) {
        page.drawText('-', { x: cursorX, y, size, font, color: textColor });
        cursorX += hyphenWidth - offset;
      }
    }
  } catch (e) {
    console.warn(
      `[Invoice PDF] Failed to draw tight text: "${text.substring(0, 20)}..." - ${e}`,
    );
  }
}

function drawCenteredText(
  page: PDFPage,
  text: string,
  y: number,
  font: PDFFont,
  size: number,
  color: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 },
): void {
  const normalized = normalizePdfText(text);
  const textWidth = measureTextWidth(normalized, font, size);
  const x = (A4_WIDTH - textWidth) / 2;
  drawTextLine(page, normalized, x, y, font, size, color);
}

function drawRightAlignedText(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  font: PDFFont,
  size: number,
  color: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 },
): void {
  const normalized = normalizePdfText(text);
  const textWidth = measureTextWidth(normalized, font, size);
  const x = rightX - textWidth;
  drawTextLine(page, normalized, x, y, font, size, color);
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  console.log(
    "[Invoice PDF] Generating PDF with Pretendard (전체 폰트 임베딩)...",
  );

  // drawText 호출 횟수 카운터 초기화
  resetDrawTextCounter();

  const pdfDoc = await PDFDocument.create();
  const fonts = await embedPretendardFonts(pdfDoc);

  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

  // === 1. 타이틀 섹션 ===
  let y = A4_HEIGHT - 60;

  // INVOICE 제목 (가운데 정렬)
  drawCenteredText(page, "INVOICE", y, fonts.bold, 24);
  y -= 30;

  // 타이틀 아래 수평선
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4_WIDTH - MARGIN, y },
    thickness: 1.5,
    color: rgb(0, 0, 0),
  });

  // === 2. 정보 섹션 ===
  y -= 35;

  const leftColX = MARGIN;
  const rightColX = 320;
  const colonX1 = 95;
  const valueX1 = 110;
  const colonX2 = 395;
  const valueX2 = 410;
  const fontSize = 11;
  const lineHeight = 22;

  // 첫 번째 행: 수신 / 수임일자
  drawTextLine(page, "수 신", leftColX, y, fonts.regular, fontSize);
  drawTextLine(page, ":", colonX1, y, fonts.regular, fontSize);
  drawTextLine(
    page,
    data.recipientName || "-",
    valueX1,
    y,
    fonts.regular,
    fontSize,
    { r: 0.2, g: 0.4, b: 0.7 },
  );

  drawTextLine(page, "수임일자", rightColX, y, fonts.regular, fontSize);
  drawTextLine(page, ":", colonX2, y, fonts.regular, fontSize);
  drawTextLine(
    page,
    formatDate(data.acceptanceDate),
    valueX2,
    y,
    fonts.regular,
    fontSize,
    { r: 0.2, g: 0.4, b: 0.7 },
  );

  y -= lineHeight;

  // 🔍 사고번호 원본 로그 확인
  const raw = data.insuranceAccidentNo || data.caseNumber || "-";
  console.log("[ACC RAW]", raw);
  console.log(
    "[ACC RAW CODES]",
    Array.from(raw).map((c) => c.charCodeAt(0).toString(16)),
  );
  console.log("[ACC NORM]", normalizePdfText(raw));
  // 두 번째 행: 사고번호 / 청구일자
  drawTextLine(page, "사고번호", leftColX, y, fonts.regular, fontSize);
  drawTextLine(page, ":", colonX1, y, fonts.regular, fontSize);
  drawTextLineTight(
    page,
    data.insuranceAccidentNo || data.caseNumber || "-",
    valueX1,
    y,
    fonts.regular,
    fontSize,
    { r: 0.2, g: 0.4, b: 0.7 },
  );

  drawTextLine(page, "청구일자", rightColX, y, fonts.regular, fontSize);
  drawTextLine(page, ":", colonX2, y, fonts.regular, fontSize);
  drawTextLine(
    page,
    formatDate(data.submissionDate),
    valueX2,
    y,
    fonts.regular,
    fontSize,
    { r: 0.2, g: 0.4, b: 0.7 },
  );

  // === 3. 테이블 섹션 ===
  y -= 45;

  const tableX = MARGIN;
  const tableWidth = CONTENT_WIDTH;
  const particularsColWidth = tableWidth * 0.7;
  const amountColWidth = tableWidth * 0.3;
  const headerHeight = 35;
  const cellPadding = 12;

  // 테이블 헤더 - PARTICULARS
  page.drawRectangle({
    x: tableX,
    y: y - headerHeight,
    width: particularsColWidth,
    height: headerHeight,
    color: rgb(0.96, 0.96, 0.96),
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.5,
  });

  // 테이블 헤더 - AMOUNT
  page.drawRectangle({
    x: tableX + particularsColWidth,
    y: y - headerHeight,
    width: amountColWidth,
    height: headerHeight,
    color: rgb(0.96, 0.96, 0.96),
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.5,
  });

  // 헤더 텍스트
  const headerTextY = y - headerHeight / 2 - 4;
  const particularsHeaderWidth = measureTextWidth(
    "PARTICULARS",
    fonts.bold,
    11,
  );
  drawTextLine(
    page,
    "PARTICULARS",
    tableX + (particularsColWidth - particularsHeaderWidth) / 2,
    headerTextY,
    fonts.bold,
    11,
  );

  const amountHeaderWidth = measureTextWidth("AMOUNT", fonts.bold, 11);
  drawTextLine(
    page,
    "AMOUNT",
    tableX + particularsColWidth + (amountColWidth - amountHeaderWidth) / 2,
    headerTextY,
    fonts.bold,
    11,
  );

  y -= headerHeight;

  // 내용 행 높이 계산
  const itemRowHeight = 25;
  let contentHeight = 0;
  for (const item of data.particulars) {
    contentHeight += itemRowHeight;
    if (item.detail) {
      contentHeight += 18;
    }
  }
  contentHeight = Math.max(contentHeight + 30, 80);

  // 내용 셀 - PARTICULARS
  page.drawRectangle({
    x: tableX,
    y: y - contentHeight,
    width: particularsColWidth,
    height: contentHeight,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.5,
  });

  // 내용 셀 - AMOUNT
  page.drawRectangle({
    x: tableX + particularsColWidth,
    y: y - contentHeight,
    width: amountColWidth,
    height: contentHeight,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.5,
  });

  // 항목 렌더링
  let itemY = y - cellPadding - 12;

  for (const item of data.particulars) {
    // 항목 제목 (현장출동비용만 단독인 경우 ■ 기호 생략)
    const itemTitle =
      item.title === "현장출동비용" ? item.title : "\u25A0 " + item.title;
    drawTextLineTight(
      page,
      itemTitle,
      tableX + cellPadding,
      itemY,
      fonts.regular,
      10,
    );

    // 금액 (오른쪽 정렬, 빨간색)
    drawRightAlignedText(
      page,
      formatAmount(item.amount),
      tableX + tableWidth - cellPadding,
      itemY,
      fonts.regular,
      11,
      { r: 0.8, g: 0, b: 0 },
    );

    itemY -= itemRowHeight;

    // 상세 설명이 있으면 추가
    if (item.detail) {
      drawTextLine(
        page,
        item.detail,
        tableX + cellPadding + 18,
        itemY + 8,
        fonts.regular,
        9,
        { r: 0.5, g: 0.5, b: 0.5 },
      );
      itemY -= 18;
    }
  }

  y -= contentHeight;

  // TOTAL AMOUNT 행
  const totalRowHeight = 35;

  page.drawRectangle({
    x: tableX,
    y: y - totalRowHeight,
    width: particularsColWidth,
    height: totalRowHeight,
    color: rgb(0.98, 0.98, 0.98),
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.5,
  });

  page.drawRectangle({
    x: tableX + particularsColWidth,
    y: y - totalRowHeight,
    width: amountColWidth,
    height: totalRowHeight,
    color: rgb(0.98, 0.98, 0.98),
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.5,
  });

  const totalTextY = y - totalRowHeight / 2 - 4;
  drawTextLine(
    page,
    "TOTAL AMOUNT",
    tableX + cellPadding,
    totalTextY,
    fonts.bold,
    11,
  );
  drawRightAlignedText(
    page,
    formatAmount(data.totalAmount),
    tableX + tableWidth - cellPadding,
    totalTextY,
    fonts.bold,
    12,
    { r: 0.8, g: 0, b: 0 },
  );

  // === 4. 계좌 정보 박스 ===
  y -= totalRowHeight + 35;

  const accountBoxWidth = CONTENT_WIDTH;

  // 헤더 박스
  page.drawRectangle({
    x: tableX,
    y: y - 28,
    width: accountBoxWidth,
    height: 28,
    color: rgb(0.96, 0.96, 0.96),
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.5,
  });

  const accountHeaderText = "아래의 계좌로 입금 부탁드립니다.";
  const accountHeaderTextWidth = measureTextWidth(
    accountHeaderText,
    fonts.bold,
    10,
  );
  drawTextLine(
    page,
    accountHeaderText,
    tableX + (accountBoxWidth - accountHeaderTextWidth) / 2,
    y - 18,
    fonts.bold,
    10,
  );

  y -= 28;

  // 계좌 정보 본문
  const accountBodyHeight = 90;
  page.drawRectangle({
    x: tableX,
    y: y - accountBodyHeight,
    width: accountBoxWidth,
    height: accountBodyHeight,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.5,
  });

  const accountLabelX = tableX + 100;
  const accountValueX = tableX + accountBoxWidth / 2 + 30;
  const accountLineHeight = 20;
  let accountY = y - 22;

  const accountData = [
    { label: "은행명", value: "신한은행" },
    { label: "계좌번호", value: "140-015-744120" },
    { label: "예금주", value: "주식회사 플록슨" },
    { label: "사업자등록번호", value: "517-87-03490" },
  ];

  for (const row of accountData) {
    drawTextLine(page, row.label, accountLabelX, accountY, fonts.bold, 10);
    drawTextLineTight(page, row.value, accountValueX, accountY, fonts.regular, 10);
    accountY -= accountLineHeight;
  }

  // === 5. 푸터 ===
  y -= accountBodyHeight + 35;

  // 푸터 수평선
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4_WIDTH - MARGIN, y },
    thickness: 1.5,
    color: rgb(0, 0, 0),
  });

  y -= 25;

  // FLOXN., Inc 로고
  drawCenteredText(page, "FLOXN., Inc", y, fonts.bold, 14);

  const pdfBytes = await pdfDoc.save();
  const buffer = Buffer.from(pdfBytes);

  // 진단 로깅: PDF 구성 요소 분석
  console.log("[Invoice PDF] ========== 최종 PDF 결과 ==========");
  console.log(`[Invoice PDF] 페이지 수: ${pdfDoc.getPageCount()}`);
  console.log(`[Invoice PDF] 폰트: Pretendard (Regular + SemiBold)`);
  console.log(`[Invoice PDF] 이미지: 0개 (텍스트/표만 포함)`);
  console.log(
    `[Invoice PDF] 최종 PDF 크기: ${(buffer.length / 1024).toFixed(1)}KB (${(buffer.length / 1024 / 1024).toFixed(3)}MB)`,
  );

  // 크기 검증
  const maxSizeMB = 3;
  if (buffer.length > maxSizeMB * 1024 * 1024) {
    console.warn(
      `[Invoice PDF] ⚠️ 경고: PDF 크기가 ${maxSizeMB}MB 초과 (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`,
    );
  } else {
    console.log(`[Invoice PDF] ✓ PDF 크기 정상 (${maxSizeMB}MB 이하)`);
  }
  console.log("[Invoice PDF] ==============================================");

  return buffer;
}

export async function sendInvoiceEmailWithAttachment(
  recipientEmail: string,
  invoiceData: InvoiceData,
  pdfBuffer: Buffer,
): Promise<boolean> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || "587");
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
    throw new Error(
      "SMTP 설정이 필요합니다. SMTP_HOST, SMTP_USER, SMTP_PASS를 확인해주세요.",
    );
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const fileName = `INVOICE_${invoiceData.caseNumber}_${Date.now()}.pdf`;
  const dateStr = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const emailContent = `안녕하세요,

INVOICE를 첨부하여 전송드립니다.

- 접수번호: ${invoiceData.caseNumber || "-"}
- 수임일자: ${formatDate(invoiceData.acceptanceDate)}
- 제출일자: ${formatDate(invoiceData.submissionDate)}
- 청구금액: ${formatAmount(invoiceData.totalAmount)}

첨부된 PDF 파일을 확인해 주세요.

감사합니다.

---
FLOXN
Front·Line·Ops·Xpert·Net
주식회사 플록슨(FLOXN Co., Ltd.)
서울특별시 영등포구 당산로 133, 서림빌딩 3층 302호`;

  const emailHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 24px;">
    <h2 style="color: #333; font-size: 22px; margin-bottom: 8px;">INVOICE 송부</h2>
    <hr style="border: none; border-top: 3px solid #e85a1b; margin-bottom: 24px;">
    
    <p style="color: #333; margin-bottom: 16px;">안녕하세요.<br>INVOICE를 첨부하여 전송드립니다.</p>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
      <tr>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold; width: 120px;">접수번호</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;">${invoiceData.caseNumber || "-"}</td>
      </tr>
      <tr>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold;">수임일자</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;">${formatDate(invoiceData.acceptanceDate)}</td>
      </tr>
      <tr>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold;">제출일자</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0;">${formatDate(invoiceData.submissionDate)}</td>
      </tr>
      <tr>
        <td style="background-color: #f8f8f8; padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold;">청구금액</td>
        <td style="padding: 12px 16px; border: 1px solid #e0e0e0; font-weight: bold; color: #e85a1b;">${formatAmount(invoiceData.totalAmount)}</td>
      </tr>
    </table>
    
    <p style="color: #333; margin-bottom: 24px;">첨부된 PDF 파일을 확인해 주세요.</p>
    
    <p style="color: #333; margin-bottom: 16px;">감사합니다.</p>
    
    <div style="border-top: 1px solid #e0e0e0; padding-top: 16px; margin-top: 24px;">
      <img src="data:image/png;base64,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" alt="FLOXN" style="height: 24px; margin-bottom: 8px;">
      <p style="font-size: 12px; color: #666; margin: 0 0 8px 0;">Front·Line·Ops·Xpert·Net</p>
      <p style="font-size: 12px; color: #666; margin: 0;">주식회사 플록슨(FLOXN Co., Ltd.)</p>
      <p style="font-size: 12px; color: #666; margin: 0;">서울특별시 영등포구 당산로 133, 서림빌딩 3층 302호</p>
    </div>
  </div>
</body>
</html>`;

  const mailOptions = {
    from: `FLOXN <${smtpUser}>`,
    to: recipientEmail,
    subject: `[FLOXN] INVOICE - ${invoiceData.caseNumber || dateStr}`,
    text: emailContent,
    html: emailHtml,
    attachments: [
      {
        filename: fileName,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(
      `[Email] Invoice PDF sent to ${recipientEmail} with attachment`,
    );
    return true;
  } catch (error) {
    console.error(
      "[Email] Failed to send invoice email with attachment:",
      error,
    );
    throw new Error("이메일 전송에 실패했습니다");
  }
}
