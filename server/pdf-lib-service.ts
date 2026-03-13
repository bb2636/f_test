import { PDFDocument, PDFPage, PDFFont, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { db } from "./db";
import {
  cases,
  caseDocuments,
  drawings,
  estimates,
  estimateRows,
  users,
} from "@shared/schema";
import { eq, and, inArray, ilike, sql } from "drizzle-orm";
import { ObjectStorageService } from "./replit_integrations/object_storage/objectStorage";

const objectStorage = new ObjectStorageService();

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;

interface ImageProcessingConfig {
  maxDimension: number;
  quality: number;
}

const PROCESSING_LEVELS: ImageProcessingConfig[] = [
  { maxDimension: 1600, quality: 60 },
  { maxDimension: 1400, quality: 50 },
  { maxDimension: 1200, quality: 40 },
  { maxDimension: 1000, quality: 30 },
  { maxDimension: 800, quality: 25 },
  { maxDimension: 700, quality: 20 },
];

const SUPPORTED_IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".heic",
  ".heif",
  ".webp",
];
const UNSUPPORTED_EXTENSIONS = [".mov", ".mp4", ".avi", ".tiff", ".raw"];

interface FontSet {
  regular: PDFFont;
  bold: PDFFont;
}

let cachedFonts: { regular: Buffer; bold: Buffer } | null = null;

function loadFontBytes(): { regular: Buffer; bold: Buffer } {
  if (cachedFonts) return cachedFonts;

  const fontsDir = path.join(process.cwd(), "server/fonts");

  // Use Pretendard (2.6MB - much smaller than NotoSansKR 16MB)
  const regularTtf = path.join(fontsDir, "Pretendard-Regular.ttf");
  const boldTtf = path.join(fontsDir, "Pretendard-SemiBold.ttf");

  let regular: Buffer | null = null;
  let bold: Buffer | null = null;

  try {
    if (fs.existsSync(regularTtf)) {
      regular = fs.readFileSync(regularTtf);
      console.log(
        `[pdf-lib] Pretendard-Regular.ttf 로드 완료 (${Math.round((regular.length / 1024 / 1024) * 10) / 10}MB)`,
      );
    }
  } catch (err) {
    console.error("[pdf-lib] Pretendard-Regular.ttf 로드 실패:", err);
  }

  try {
    if (fs.existsSync(boldTtf)) {
      bold = fs.readFileSync(boldTtf);
      console.log(`[pdf-lib] Pretendard-SemiBold.ttf 로드 완료`);
    }
  } catch (err) {
    console.error("[pdf-lib] Pretendard-SemiBold.ttf 로드 실패:", err);
  }

  if (!regular || !bold) {
    throw new Error(
      "한글 폰트를 로드할 수 없습니다. server/fonts 디렉토리에 Pretendard-Regular.ttf 파일이 있는지 확인하세요.",
    );
  }

  cachedFonts = { regular, bold };
  return cachedFonts;
}

async function embedFonts(pdfDoc: PDFDocument): Promise<FontSet> {
  pdfDoc.registerFontkit(fontkit);

  const fontBytes = loadFontBytes();

  // subset: false로 전체 폰트 임베딩 (한글 글자 누락 방지)
  const regular = await pdfDoc.embedFont(fontBytes.regular, { subset: false });
  const bold = await pdfDoc.embedFont(fontBytes.bold, { subset: false });

  return { regular, bold };
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
  } catch {
    return dateStr;
  }
}

function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return "0";
  return num.toLocaleString("ko-KR");
}

interface DrawTextOptions {
  x: number;
  y: number;
  text: string;
  font: PDFFont;
  size?: number;
  color?: { r: number; g: number; b: number };
  maxWidth?: number;
  lineHeight?: number;
  align?: "left" | "center" | "right";
}

// 기본 텍스트 너비 측정 (pdf-lib 기본 메서드 사용)
function measureTextWidth(text: string, font: PDFFont, size: number): number {
  if (!text) return 0;
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
}

// 특수문자 뒤 글리프 간격을 조정하여 실제 시각적 너비 계산
function measureTextWidthAdjusted(
  text: string,
  font: PDFFont,
  size: number,
): number {
  if (!text) return 0;

  let totalWidth = 0;
  const chars = Array.from(text);

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    try {
      let charWidth = font.widthOfTextAtSize(char, size);

      totalWidth += charWidth;
    } catch {
      totalWidth += size * 0.5;
    }
  }

  return totalWidth;
}

// 문자별로 렌더링하여 특수문자 뒤 간격 조정
function drawTextCharByChar(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color: { r: number; g: number; b: number },
): void {
  if (!text) return;

  let currentX = x;
  const chars = Array.from(text);

  for (const char of chars) {
    try {
      page.drawText(char, {
        x: currentX,
        y,
        size,
        font,
        color: rgb(color.r, color.g, color.b),
      });

      let charWidth = 0;

      try {
        charWidth = font.widthOfTextAtSize(char, size);
      } catch {
        charWidth = size * 0.5;
      }

      // ✅ 핵심 보정 구간
      if (char === "-" || char === "–" || char === "—" || char === "−") {
        // 하이픈 폭 강제 축소 (pdf-lib + 한글폰트 버그 대응)
        charWidth = charWidth * 0.55;
      }

      currentX += charWidth;
    } catch {
      currentX += size * 0.5;
    }
  }
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }

    let currentLine = "";
    const chars = paragraph.split("");

    for (const char of chars) {
      const testLine = currentLine + char;
      const width = measureTextWidth(testLine, font, size);

      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

// 유니코드 공백(눈에 안 보이는 공백)까지 정규화 + 특수기호 전/후 공백 제거
// 단, 콜론(:) 뒤의 공백은 유지 (예: "단위: ㎡")
function normalizeText(text: string): string {
  if (!text) return "";

  return (
    text
      // 1) 보이지 않는 공백/특수 공백을 일반 공백으로 통일
      .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
      // 2) 특수문자(콜론 제외) 뒤의 공백 제거
      .replace(
        /([-–—;/\\()[\]{}<>@#$%^&*+=|~`!?,.'"「」『』【】〔〕《》〈〉•·…])\s+/g,
        "$1",
      )
      // 3) 특수문자(콜론 제외) 앞의 공백 제거
      .replace(
        /\s+([-–—;/\\()[\]{}<>@#$%^&*+=|~`!?,.'"「」『』【】〔〕《》〈〉•·…])/g,
        "$1",
      )
  );
}

// 증빙 PDF 헤더 전용 정규화 (헤더 텍스트는 하이픈/콜론 주변 공백이 섞여 들어오는 경우가 많음)
// - normalizeText로 유니코드 공백 통일
// - 하이픈(-) 앞뒤 공백 제거
// - 콜론(:) 앞 공백 제거 + 콜론 뒤 공백 1개만 유지(너무 붙지 않게)
function normalizeEvidenceHeaderText(text: string): string {
  if (!text) return "";

  return normalizeText(text)
    .replace(/\s*-\s*/g, "-") // "2026 - 01 - 15" -> "2026-01-15"
    .replace(/\s*:\s*/g, ": ") // "13 : 07" -> "13: 07"
    .replace(/:\s+/g, ": ") // 콜론 뒤 공백은 1개로
    .replace(/\s+/g, " ") // 연속 공백 정리
    .trim();
}

function drawText(page: PDFPage, options: DrawTextOptions): number {
  const {
    x,
    y,
    text,
    font,
    size = 10,
    color = { r: 0, g: 0, b: 0 },
    maxWidth,
    lineHeight = 1.4,
    align = "left",
  } = options;

  if (!text) return y;

  // 모든 텍스트에서 특수기호 뒤 공백 제거
  const normalizedText = normalizeText(text);

  let lines: string[];
  if (maxWidth) {
    lines = wrapText(normalizedText, font, size, maxWidth);
  } else {
    lines = normalizedText.split("\n");
  }

  let currentY = y;
  const actualLineHeight = size * lineHeight;

  for (const line of lines) {
    let drawX = x;

    // 정렬 시 조정된 너비 사용
    if (align === "center" && maxWidth) {
      const textWidth = measureTextWidthAdjusted(line, font, size);
      drawX = x + (maxWidth - textWidth) / 2;
    } else if (align === "right" && maxWidth) {
      const textWidth = measureTextWidthAdjusted(line, font, size);
      drawX = x + maxWidth - textWidth;
    }

    try {
      // 문자별로 렌더링하여 특수문자 간격 조정
      drawTextCharByChar(page, line, drawX, currentY, font, size, color);
    } catch (e) {
      console.warn(
        `[pdf-lib] Failed to draw text: "${line.substring(0, 20)}..."`,
      );
    }

    currentY -= actualLineHeight;
  }

  return currentY;
}

interface TableCell {
  text: string;
  width: number;
  align?: "left" | "center" | "right";
  isHeader?: boolean;
  rowSpan?: number;
  colSpan?: number;
}

interface DrawTableOptions {
  x: number;
  y: number;
  rows: TableCell[][];
  fonts: FontSet;
  fontSize?: number;
  headerBgColor?: { r: number; g: number; b: number };
  rowHeight?: number;
  borderWidth?: number;
}

function drawTable(page: PDFPage, options: DrawTableOptions): number {
  const {
    x,
    y,
    rows,
    fonts,
    fontSize = 9,
    headerBgColor = { r: 0.94, g: 0.94, b: 0.94 },
    rowHeight = 22,
    borderWidth = 0.5,
  } = options;

  let currentY = y;

  for (const row of rows) {
    let cellX = x;
    const isHeaderRow = row.some((cell) => cell.isHeader);

    for (const cell of row) {
      if (cell.isHeader) {
        page.drawRectangle({
          x: cellX,
          y: currentY - rowHeight,
          width: cell.width,
          height: rowHeight,
          color: rgb(headerBgColor.r, headerBgColor.g, headerBgColor.b),
        });
      }

      page.drawRectangle({
        x: cellX,
        y: currentY - rowHeight,
        width: cell.width,
        height: rowHeight,
        borderColor: rgb(0.3, 0.3, 0.3),
        borderWidth,
      });

      const font = cell.isHeader ? fonts.bold : fonts.regular;
      const padding = 4;
      const rightPadding = cell.align === "right" ? 8 : padding; // 오른쪽 정렬 시 여백 더 확보
      const maxTextWidth = cell.width - padding - rightPadding;

      // 텍스트가 셀 너비를 초과할 경우 폰트 크기 자동 축소
      let actualFontSize = fontSize;
      // 특수기호 뒤 공백 제거
      const cellText = normalizeText(cell.text || "");

      // 음수 처리: 마이너스 기호와 숫자를 분리해서 정렬
      const isNegative =
        cell.align === "right" &&
        cellText.startsWith("-") &&
        cellText.length > 1;
      const displayText = isNegative ? cellText.substring(1) : cellText;
      const minusSign = isNegative ? "-" : "";

      // 조정된 너비 계산 사용
      let textWidth = measureTextWidthAdjusted(
        displayText,
        font,
        actualFontSize,
      );
      const minusWidth = isNegative
        ? measureTextWidthAdjusted(minusSign, font, actualFontSize)
        : 0;

      while (textWidth + minusWidth > maxTextWidth && actualFontSize > 5) {
        actualFontSize -= 0.5;
        textWidth = measureTextWidthAdjusted(displayText, font, actualFontSize);
      }

      const textY = currentY - rowHeight / 2 - actualFontSize / 3;

      let textX = cellX + padding;
      if (cell.align === "center") {
        const fullWidth = measureTextWidthAdjusted(
          cellText,
          font,
          actualFontSize,
        );
        textX = cellX + (cell.width - fullWidth) / 2;
      } else if (cell.align === "right") {
        // 숫자 부분만 오른쪽 정렬
        textX = cellX + cell.width - textWidth - rightPadding;
      }

      const defaultColor = { r: 0, g: 0, b: 0 };

      try {
        if (isNegative) {
          // 마이너스 기호를 숫자 왼쪽에 고정 간격으로 배치
          const minusX = textX - minusWidth - 2;
          drawTextCharByChar(
            page,
            minusSign,
            minusX,
            textY,
            font,
            actualFontSize,
            defaultColor,
          );
          drawTextCharByChar(
            page,
            displayText,
            textX,
            textY,
            font,
            actualFontSize,
            defaultColor,
          );
        } else {
          // 문자별로 렌더링하여 특수문자 간격 조정
          drawTextCharByChar(
            page,
            cellText,
            textX,
            textY,
            font,
            actualFontSize,
            defaultColor,
          );
        }
      } catch (e) {
        console.warn(
          `[pdf-lib] Table cell text failed: "${cellText.substring(0, 10)}..."`,
        );
      }

      cellX += cell.width;
    }

    currentY -= rowHeight;
  }

  return currentY;
}

// 페이지네이션을 지원하는 테이블 렌더링 함수
interface PaginatedTableResult {
  page: PDFPage;
  y: number;
}

function drawPaginatedTable(
  pdfDoc: PDFDocument,
  currentPage: PDFPage,
  options: DrawTableOptions & {
    pageBottomY?: number;
    headerRow?: TableCell[];
  },
): PaginatedTableResult {
  const {
    x,
    y,
    rows,
    fonts,
    fontSize = 9,
    headerBgColor = { r: 0.94, g: 0.94, b: 0.94 },
    rowHeight = 22,
    borderWidth = 0.5,
    pageBottomY = MARGIN + 60,
    headerRow,
  } = options;

  let page = currentPage;
  let currentY = y;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];

    // 페이지 하단을 넘어가면 새 페이지 생성
    if (currentY - rowHeight < pageBottomY) {
      page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
      currentY = A4_HEIGHT - MARGIN;

      // 헤더 행이 있으면 새 페이지에 헤더 먼저 그리기
      if (headerRow) {
        currentY = drawTableRow(
          page,
          headerRow,
          x,
          currentY,
          fonts,
          fontSize,
          headerBgColor,
          rowHeight,
          borderWidth,
        );
      }
    }

    currentY = drawTableRow(
      page,
      row,
      x,
      currentY,
      fonts,
      fontSize,
      headerBgColor,
      rowHeight,
      borderWidth,
    );
  }

  return { page, y: currentY };
}

// 단일 행 렌더링 헬퍼 함수
function drawTableRow(
  page: PDFPage,
  row: TableCell[],
  x: number,
  currentY: number,
  fonts: FontSet,
  fontSize: number,
  headerBgColor: { r: number; g: number; b: number },
  rowHeight: number,
  borderWidth: number,
): number {
  let cellX = x;
  const isHeaderRow = row.some((cell) => cell.isHeader);

  for (const cell of row) {
    if (cell.isHeader) {
      page.drawRectangle({
        x: cellX,
        y: currentY - rowHeight,
        width: cell.width,
        height: rowHeight,
        color: rgb(headerBgColor.r, headerBgColor.g, headerBgColor.b),
      });
    }

    page.drawRectangle({
      x: cellX,
      y: currentY - rowHeight,
      width: cell.width,
      height: rowHeight,
      borderColor: rgb(0.3, 0.3, 0.3),
      borderWidth,
    });

    const font = cell.isHeader ? fonts.bold : fonts.regular;
    const padding = 4;
    const rightPadding = cell.align === "right" ? 8 : padding;
    const maxTextWidth = cell.width - padding - rightPadding;

    let actualFontSize = fontSize;
    const cellText = normalizeText(cell.text || "");

    const isNegative =
      cell.align === "right" && cellText.startsWith("-") && cellText.length > 1;
    const displayText = isNegative ? cellText.substring(1) : cellText;
    const minusSign = isNegative ? "-" : "";

    let textWidth = measureTextWidthAdjusted(displayText, font, actualFontSize);
    const minusWidth = isNegative
      ? measureTextWidthAdjusted(minusSign, font, actualFontSize)
      : 0;

    while (textWidth + minusWidth > maxTextWidth && actualFontSize > 5) {
      actualFontSize -= 0.5;
      textWidth = measureTextWidthAdjusted(displayText, font, actualFontSize);
    }

    const textY = currentY - rowHeight / 2 - actualFontSize / 3;

    let textX = cellX + padding;
    if (cell.align === "center") {
      const fullWidth = measureTextWidthAdjusted(
        cellText,
        font,
        actualFontSize,
      );
      textX = cellX + (cell.width - fullWidth) / 2;
    } else if (cell.align === "right") {
      textX = cellX + cell.width - textWidth - rightPadding;
    }

    const defaultColor = { r: 0, g: 0, b: 0 };

    try {
      if (isNegative) {
        const minusX = textX - minusWidth - 2;
        drawTextCharByChar(
          page,
          minusSign,
          minusX,
          textY,
          font,
          actualFontSize,
          defaultColor,
        );
        drawTextCharByChar(
          page,
          displayText,
          textX,
          textY,
          font,
          actualFontSize,
          defaultColor,
        );
      } else {
        drawTextCharByChar(
          page,
          cellText,
          textX,
          textY,
          font,
          actualFontSize,
          defaultColor,
        );
      }
    } catch (e) {
      console.warn(
        `[pdf-lib] Table cell text failed: "${cellText.substring(0, 10)}..."`,
      );
    }

    cellX += cell.width;
  }

  return currentY - rowHeight;
}

async function normalizeImage(
  base64Data: string,
  config: ImageProcessingConfig = PROCESSING_LEVELS[0],
): Promise<{ success: boolean; data?: Buffer; error?: string }> {
  const { maxDimension, quality } = config;

  try {
    let imageBuffer: Buffer;

    if (base64Data.startsWith("data:")) {
      const matches = base64Data.match(/^data:[^;]+;base64,(.+)$/);
      if (matches) {
        imageBuffer = Buffer.from(matches[1], "base64");
      } else {
        return { success: false, error: "잘못된 이미지 데이터 형식" };
      }
    } else {
      imageBuffer = Buffer.from(base64Data, "base64");
    }

    const image = sharp(imageBuffer, { failOnError: false });

    const processedImage = image.resize(maxDimension, maxDimension, {
      fit: "inside",
      withoutEnlargement: true,
    });

    const compressedBuffer = await processedImage
      .jpeg({ quality, mozjpeg: true, force: true })
      .toBuffer();

    return { success: true, data: compressedBuffer };
  } catch (error: any) {
    return { success: false, error: error.message || "이미지 처리 오류" };
  }
}

async function embedImage(
  pdfDoc: PDFDocument,
  page: PDFPage,
  imageData: string,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  config: ImageProcessingConfig,
): Promise<{ success: boolean; error?: string }> {
  try {
    const normalized = await normalizeImage(imageData, config);

    if (!normalized.success || !normalized.data) {
      return { success: false, error: normalized.error || "이미지 처리 실패" };
    }

    let embeddedImage;
    try {
      embeddedImage = await pdfDoc.embedJpg(normalized.data);
    } catch {
      try {
        embeddedImage = await pdfDoc.embedPng(normalized.data);
      } catch {
        return { success: false, error: "이미지 포맷 처리 불가" };
      }
    }

    const imgWidth = embeddedImage.width;
    const imgHeight = embeddedImage.height;
    const aspectRatio = imgWidth / imgHeight;

    let drawWidth = maxWidth;
    let drawHeight = drawWidth / aspectRatio;

    if (drawHeight > maxHeight) {
      drawHeight = maxHeight;
      drawWidth = drawHeight * aspectRatio;
    }

    const drawX = x + (maxWidth - drawWidth) / 2;
    const drawY = y + (maxHeight - drawHeight) / 2;

    page.drawImage(embeddedImage, {
      x: drawX,
      y: drawY,
      width: drawWidth,
      height: drawHeight,
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "이미지 임베딩 실패" };
  }
}

function drawErrorSection(
  page: PDFPage,
  fonts: FontSet,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  message: string,
): void {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(0.99, 0.95, 0.95),
    borderColor: rgb(0.8, 0.2, 0.2),
    borderWidth: 1,
  });

  const centerX = x + width / 2;
  const centerY = y + height / 2;

  drawText(page, {
    x: centerX - 30,
    y: centerY + 20,
    text: "⚠ 오류",
    font: fonts.bold,
    size: 14,
    color: { r: 0.6, g: 0.1, b: 0.1 },
  });

  drawText(page, {
    x: x + 10,
    y: centerY - 10,
    text: title,
    font: fonts.bold,
    size: 10,
    maxWidth: width - 20,
    align: "center",
  });

  drawText(page, {
    x: x + 10,
    y: centerY - 30,
    text: message,
    font: fonts.regular,
    size: 9,
    color: { r: 0.4, g: 0.4, b: 0.4 },
    maxWidth: width - 20,
    align: "center",
  });
}

async function renderCoverPage(
  pdfDoc: PDFDocument,
  fonts: FontSet,
  caseData: any,
  partnerData: any,
): Promise<void> {
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;

  // Title: 현장출동확인서
  drawText(page, {
    x: MARGIN,
    y: y - 30,
    text: "현장출동확인서",
    font: fonts.bold,
    size: 24,
    maxWidth: CONTENT_WIDTH,
    align: "center",
  });

  y -= 90;

  // 수 신 line with underline
  const recipientName = caseData.insuranceCompany || "-";
  drawText(page, {
    x: MARGIN,
    y,
    text: "수 신",
    font: fonts.bold,
    size: 12,
  });

  drawText(page, {
    x: MARGIN + 60,
    y,
    text: recipientName,
    font: fonts.regular,
    size: 12,
  });

  // Underline under recipient name
  const recipientWidth = recipientName.length * 8;
  page.drawLine({
    start: { x: MARGIN + 60, y: y - 4 },
    end: { x: MARGIN + 60 + Math.max(recipientWidth, 150), y: y - 4 },
    thickness: 0.5,
    color: rgb(0.3, 0.3, 0.3),
  });

  drawText(page, {
    x: A4_WIDTH - MARGIN - 30,
    y,
    text: "귀하",
    font: fonts.regular,
    size: 12,
  });

  y -= 40;

  // 케이스 번호에서 suffix 추출 (-0: 손해방지, -1 이상: 피해세대 복구)
  const caseNumber = caseData.caseNumber || "";
  const suffixMatch = caseNumber.match(/-(\d+)$/);
  const caseSuffix = suffixMatch ? parseInt(suffixMatch[1], 10) : 0;

  // -0 (손해방지)인 경우 피보험자 주소, -1 이상인 경우 피해자 주소 사용
  const fullAddress =
    caseSuffix === 0
      ? [caseData.insuredAddress, caseData.insuredAddressDetail]
          .filter(Boolean)
          .join(" ")
      : [caseData.victimAddress, caseData.victimAddressDetail]
          .filter(Boolean)
          .join(" ") ||
        [caseData.insuredAddress, caseData.insuredAddressDetail]
          .filter(Boolean)
          .join(" ");

  // 날짜/시간 형식에서 불필요한 공백 제거 (예: "2026- 01- 15 13: 07" -> "2026-01-15 13:07")
  const formatDateTimeStr = (str: string): string => {
    return str
      .replace(/- /g, "-")
      .replace(/: /g, ":")
      .replace(/\s+/g, " ")
      .trim();
  };

  const dispatchDateTime = formatDateTimeStr(
    [caseData.visitDate, caseData.visitTime].filter(Boolean).join(" "),
  );

  // 출동담당자: accompaniedPerson이 없으면 assignedPartnerManager(협력사 담당자) 사용
  const dispatchManager =
    caseData.accompaniedPerson || caseData.assignedPartnerManager || "-";

  // Main info table
  // 특수기호 뒤 공백 제거
  const cleanAccidentNo = (
    caseData.insuranceAccidentNo ||
    caseData.insurancePolicyNo ||
    "-"
  )
    .replace(/-\s+/g, "-")
    .replace(/:\s+/g, ":");
  const tableRows: TableCell[][] = [
    [
      {
        text: "사고번호(증권번호)",
        width: 100,
        isHeader: true,
        align: "center",
      },
      { text: cleanAccidentNo, width: 150, align: "left" },
      { text: "출동담당자", width: 100, isHeader: true, align: "center" },
      { text: dispatchManager, width: 165, align: "left" },
    ],
    [
      { text: "피보험자명", width: 100, isHeader: true, align: "center" },
      {
        text: caseData.insuredName || caseData.victimName || "-",
        width: 150,
        align: "left",
      },
      { text: "협력업체", width: 100, isHeader: true, align: "center" },
      { text: caseData.assignedPartner || "-", width: 165, align: "left" },
    ],
    [
      { text: "주소", width: 100, isHeader: true, align: "center" },
      { text: fullAddress || "-", width: 415, align: "left" },
    ],
    [
      { text: "출동일시", width: 100, isHeader: true, align: "center" },
      { text: dispatchDateTime || "-", width: 415, align: "left" },
    ],
  ];

  y = drawTable(page, {
    x: MARGIN,
    y,
    rows: tableRows,
    fonts,
    fontSize: 10,
    rowHeight: 28,
  });

  y -= 40;

  // Body text - two lines
  drawText(page, {
    x: MARGIN,
    y,
    text: "상기 건에 대하여 현장 출동 조사를 실시하였으며,",
    font: fonts.regular,
    size: 11,
  });

  y -= 22;

  drawText(page, {
    x: MARGIN,
    y,
    text: "조사 결과를 별첨 보고서와 같이 제출합니다.",
    font: fonts.regular,
    size: 11,
  });

  y -= 50;

  // Confirmation text (bold, centered)
  drawText(page, {
    x: MARGIN,
    y,
    text: "위 내용이 사실과 다름없음을 확인합니다.",
    font: fonts.bold,
    size: 12,
    maxWidth: CONTENT_WIDTH,
    align: "center",
  });

  y -= 50;

  // Date (centered)
  const now = new Date();
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  drawText(page, {
    x: MARGIN,
    y,
    text: dateStr,
    font: fonts.regular,
    size: 13,
    maxWidth: CONTENT_WIDTH,
    align: "center",
  });

  y -= 70;

  // Company info (right-aligned label: value format)
  const infoX = A4_WIDTH / 2 + 30;
  const labelWidth = 70;
  const valueX = infoX + labelWidth + 20;

  drawText(page, {
    x: infoX,
    y,
    text: "회 사 명 :",
    font: fonts.bold,
    size: 11,
  });
  drawText(page, {
    x: valueX,
    y,
    text: caseData.assignedPartner || "-",
    font: fonts.regular,
    size: 11,
  });

  y -= 25;

  drawText(page, {
    x: infoX,
    y,
    text: "담 당 자 :",
    font: fonts.bold,
    size: 11,
  });
  drawText(page, {
    x: valueX,
    y,
    text: caseData.assignedPartnerManager || partnerData?.name || "-",
    font: fonts.regular,
    size: 11,
  });

  y -= 25;

  drawText(page, {
    x: infoX,
    y,
    text: "연 락 처 :",
    font: fonts.bold,
    size: 11,
  });
  drawText(page, {
    x: valueX,
    y,
    text: caseData.assignedPartnerContact || partnerData?.phone || "-",
    font: fonts.regular,
    size: 11,
  });

  // FLOXN logo at bottom center (using image file)
  const logoY = MARGIN + 20;
  const centerX = A4_WIDTH / 2;

  try {
    const logoPath = path.join(process.cwd(), "server/assets/floxn-logo.png");
    if (fs.existsSync(logoPath)) {
      const logoData = fs.readFileSync(logoPath);
      const logoImage = await pdfDoc.embedPng(logoData);
      const logoDims = logoImage.scale(1);

      // Scale logo to fit nicely (max width ~120px)
      const maxLogoWidth = 120;
      const logoScale = Math.min(maxLogoWidth / logoDims.width, 1);
      const drawLogoWidth = logoDims.width * logoScale;
      const drawLogoHeight = logoDims.height * logoScale;

      page.drawImage(logoImage, {
        x: centerX - drawLogoWidth / 2,
        y: logoY,
        width: drawLogoWidth,
        height: drawLogoHeight,
      });
    }
  } catch (err) {
    console.error("[pdf-lib] 로고 이미지 로드 실패:", err);
  }
}

async function renderFieldReportPage(
  pdfDoc: PDFDocument,
  fonts: FontSet,
  caseData: any,
  partnerData: any,
  repairItems: any[],
): Promise<void> {
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;

  // Title: 출동확인서 (centered)
  drawText(page, {
    x: MARGIN,
    y: y - 25,
    text: "출동확인서",
    font: fonts.bold,
    size: 20,
    maxWidth: CONTENT_WIDTH,
    align: "center",
  });

  y -= 55;

  const insuredFullAddress = [
    caseData.insuredAddress,
    caseData.insuredAddressDetail,
  ]
    .filter(Boolean)
    .join(" ");

  // 날짜/시간 형식에서 불필요한 공백 제거 (예: "2026- 01- 15 13: 07" -> "2026-01-15 13:07")
  const formatDateTime = (str: string): string => {
    return str
      .replace(/- /g, "-") // "- " -> "-"
      .replace(/: /g, ":") // ": " -> ":"
      .replace(/\s+/g, " ") // 연속 공백 제거
      .trim();
  };

  const visitDateTime = formatDateTime(
    [caseData.visitDate, caseData.visitTime].filter(Boolean).join(" "),
  );

  // accidentDate에 이미 시간이 포함되어 있으면 accidentTime 추가하지 않음
  // 예: "2026-01-19 13:53"에 "13:53"을 추가하면 중복됨
  const accidentDateHasTime =
    caseData.accidentDate && /\d{2}:\d{2}/.test(caseData.accidentDate);
  const accidentDateTime = formatDateTime(
    accidentDateHasTime
      ? caseData.accidentDate
      : [caseData.accidentDate, caseData.accidentTime]
          .filter(Boolean)
          .join(" "),
  );

  // Helper function to draw section header with grey background
  const drawSectionHeader = (title: string, currentY: number): number => {
    const headerHeight = 22;
    page.drawRectangle({
      x: MARGIN,
      y: currentY - headerHeight,
      width: CONTENT_WIDTH,
      height: headerHeight,
      color: rgb(0.85, 0.85, 0.85),
    });

    drawText(page, {
      x: MARGIN + 8,
      y: currentY - 15,
      text: title,
      font: fonts.bold,
      size: 10,
    });

    return currentY - headerHeight - 5;
  };

  // Section 1: 현장정보
  y = drawSectionHeader("현장정보", y);

  const fieldInfoRows: TableCell[][] = [
    [
      { text: "방문일시", width: 90, isHeader: true, align: "center" },
      { text: visitDateTime || "-", width: 168, align: "left" },
      { text: "출동 담당자", width: 90, isHeader: true, align: "center" },
      {
        text: caseData.assignedPartnerManager || partnerData?.name || "-",
        width: 167,
        align: "left",
      },
    ],
    [
      { text: "피보험자명", width: 90, isHeader: true, align: "center" },
      { text: caseData.insuredName || "-", width: 168, align: "left" },
      { text: "협력업체", width: 90, isHeader: true, align: "center" },
      { text: caseData.assignedPartner || "-", width: 167, align: "left" },
    ],
    [
      { text: "피보험자 주소", width: 90, isHeader: true, align: "center" },
      { text: insuredFullAddress || "-", width: 425, align: "left" },
    ],
  ];

  y = drawTable(page, {
    x: MARGIN,
    y,
    rows: fieldInfoRows,
    fonts,
    fontSize: 9,
    rowHeight: 24,
  });

  y -= 15;

  // Section 2: 사고 원인(+수리항목)
  y = drawSectionHeader("사고 원인(+수리항목)", y);

  const accidentInfoRows: TableCell[][] = [
    [
      { text: "사고 발생일시", width: 90, isHeader: true, align: "center" },
      { text: accidentDateTime || "-", width: 168, align: "left" },
      { text: "누수유형", width: 90, isHeader: true, align: "center" },
      {
        text: caseData.leakType || caseData.accidentCategory || "-",
        width: 167,
        align: "left",
      },
    ],
    [
      { text: "사고원인", width: 90, isHeader: true, align: "center" },
      { text: caseData.accidentCause || "-", width: 425, align: "left" },
    ],
  ];

  y = drawTable(page, {
    x: MARGIN,
    y,
    rows: accidentInfoRows,
    fonts,
    fontSize: 9,
    rowHeight: 24,
  });

  y -= 15;

  // Section 3: 특이사항 및 요청사항 (VOC) - 현장 특이사항 섹션 제거됨
  y = drawSectionHeader("특이사항 및 요청사항 (VOC)", y);

  // VOC는 vocContent 필드 사용 (specialNotes는 폴백)
  const vocText = caseData.vocContent || caseData.specialNotes || "-";

  page.drawRectangle({
    x: MARGIN,
    y: y - 45,
    width: CONTENT_WIDTH,
    height: 50,
    borderColor: rgb(0.7, 0.7, 0.7),
    borderWidth: 0.5,
  });

  drawText(page, {
    x: MARGIN + 8,
    y: y - 12,
    text: vocText,
    font: fonts.regular,
    size: 9,
    maxWidth: CONTENT_WIDTH - 16,
  });

  y -= 60;

  const caseNumber = caseData.caseNumber || "";
  const suffixMatch = caseNumber.match(/-(\d+)$/);
  const suffix = suffixMatch ? parseInt(suffixMatch[1], 10) : 0;
  // Section 5: 피해 복구방식 및 처리 유형
  if (suffix === 0) {
    y = drawSectionHeader("복구방식 및 처리 유형", y);
  } else {
    y = drawSectionHeader("피해 복구방식 및 처리 유형", y);
  }

  const victimFullAddress =
    [caseData.victimAddress, caseData.victimAddressDetail]
      .filter(Boolean)
      .join(" ") || insuredFullAddress;

  // 처리유형 파싱 (JSON 배열)
  let processingTypesStr = "-";
  try {
    if (caseData.processingTypes) {
      const types =
        typeof caseData.processingTypes === "string"
          ? JSON.parse(caseData.processingTypes)
          : caseData.processingTypes;
      if (Array.isArray(types) && types.length > 0) {
        processingTypesStr = types.join(", ");
        if (caseData.processingTypeOther) {
          processingTypesStr += ` (${caseData.processingTypeOther})`;
        }
      }
    }
  } catch (e) {
    processingTypesStr = caseData.processingTypes?.toString() || "-";
  }

  const recoveryInfoRows_1: TableCell[][] = [
    // 2️⃣ 피해자명 / 피해자 연락처
    [
      { text: "피해자명", width: 90, isHeader: true, align: "center" },
      { text: caseData.victimName || "-", width: 180, align: "left" },
      { text: "피해자 연락처", width: 110, isHeader: true, align: "center" },
      { text: caseData.victimContact || "-", width: 135, align: "left" },
    ],

    // 3️⃣ 피해주소 (우측 병합)
    [
      { text: "피해주소", width: 90, isHeader: true, align: "center" },
      {
        text:
          [caseData.victimAddress, caseData.victimAddressDetail]
            .filter(Boolean)
            .join(" ") || "-",
        width: 425,
        align: "left",
      },
    ],

    // 4️⃣ 처리유형
    [
      { text: "처리유형", width: 90, isHeader: true, align: "center" },
      { text: processingTypesStr || "-", width: 425, align: "left" },
    ],

    // 5️⃣ 복구방식
    [
      { text: "복구방식", width: 90, isHeader: true, align: "center" },
      {
        text:
          caseData.recoveryMethodType ||
          caseData.restorationMethod ||
          caseData.recoveryMethod ||
          "-",
        width: 425,
        align: "left",
      },
    ],
  ];

  const recoveryInfoRows_0: TableCell[][] = [
    [
      { text: "처리유형", width: 90, isHeader: true, align: "center" },
      { text: processingTypesStr, width: 425, align: "left" },
    ],
    [
      { text: "복구방식", width: 90, isHeader: true, align: "center" },
      {
        text:
          caseData.recoveryMethodType ||
          caseData.restorationMethod ||
          caseData.recoveryMethod ||
          "-",
        width: 425,
        align: "left",
      },
    ],
  ];

  const recoveryInfoRows: TableCell[][] =
    suffix === 0 ? recoveryInfoRows_0 : recoveryInfoRows_1;

  y = drawTable(page, {
    x: MARGIN,
    y,
    rows: recoveryInfoRows,
    fonts,
    fontSize: 9,
    rowHeight: 24,
  });

  // Footer: 작성일 and 작성자
  const footerY = MARGIN + 20;
  const now = new Date();
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;

  drawText(page, {
    x: MARGIN,
    y: footerY,
    text: `작성일:${dateStr}`,
    font: fonts.regular,
    size: 9,
  });

  const partnerName = caseData.assignedPartner || "-";
  const managerName =
    caseData.assignedPartnerManager || partnerData?.name || "-";

  drawText(page, {
    x: A4_WIDTH - MARGIN - 180,
    y: footerY,
    text: `작성자:${managerName} (${partnerName})`,
    font: fonts.regular,
    size: 9,
  });
}

async function renderDrawingPage(
  pdfDoc: PDFDocument,
  fonts: FontSet,
  caseData: any,
  drawingData: any,
): Promise<void> {
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;

  // Header: 현장 피해상황 도면 with gray background
  const headerHeight = 35;
  page.drawRectangle({
    x: MARGIN,
    y: y - headerHeight,
    width: CONTENT_WIDTH,
    height: headerHeight,
    color: rgb(0.92, 0.92, 0.92),
    borderColor: rgb(0.7, 0.7, 0.7),
    borderWidth: 0.5,
  });

  drawText(page, {
    x: MARGIN + 15,
    y: y - 25,
    text: "현장 피해상황 도면",
    font: fonts.bold,
    size: 14,
  });

  // 사고번호(계약번호) on the right - 헤더박스 내에 맞도록 폰트 크기 조정
  // 특수기호 뒤 공백 제거
  const rawAccidentNo =
    caseData.insuranceAccidentNo || caseData.insurancePolicyNo || "-";
  const accidentNo = rawAccidentNo.replace(/-\s+/g, "-").replace(/:\s+/g, ":");
  const accidentNoText = `사고번호(증권번호):${accidentNo}`;
  // 텍스트 길이에 따라 폰트 크기 조정 (헤더 영역 안에 들어가도록)
  const accidentNoFontSize =
    accidentNoText.length > 25 ? 8 : accidentNoText.length > 20 ? 9 : 10;
  drawText(page, {
    x: A4_WIDTH - MARGIN - 180, // 더 왼쪽으로 이동
    y: y - 25,
    text: accidentNoText,
    font: fonts.regular,
    size: accidentNoFontSize,
  });

  y -= headerHeight + 15;

  // Info line: 보험사, 피보험자, 주소 (해당건의 주소 사용)
  const insuranceCompany = caseData.insuranceCompany || "-";
  const insuredName = caseData.insuredName || caseData.victimName || "-";
  // 케이스 번호에서 suffix 추출 (-0: 손해방지, -1 이상: 피해세대 복구)
  const drawingCaseNumber = caseData.caseNumber || "";
  const drawingSuffixMatch = drawingCaseNumber.match(/-(\d+)$/);
  const drawingCaseSuffix = drawingSuffixMatch
    ? parseInt(drawingSuffixMatch[1], 10)
    : 0;

  // -0 (손해방지)인 경우 피보험자 주소, -1 이상인 경우 피해자 주소 사용
  let fullAddress = "-";
  if (drawingCaseSuffix === 0) {
    fullAddress =
      [caseData.insuredAddress, caseData.insuredAddressDetail]
        .filter(Boolean)
        .join(" ") || "-";
  } else {
    fullAddress =
      [caseData.victimAddress, caseData.victimAddressDetail]
        .filter(Boolean)
        .join(" ") ||
      [caseData.insuredAddress, caseData.insuredAddressDetail]
        .filter(Boolean)
        .join(" ") ||
      "-";
  }

  drawText(page, {
    x: MARGIN,
    y,
    text: `보험사:${insuranceCompany}     피보험자:${insuredName}     주소:${fullAddress}`,
    font: fonts.regular,
    size: 9,
  });

  y -= 20; // 간격 축소하여 도면 영역 확대

  // Drawing area - large box for the drawing image (도면 영역 최대화)
  const drawingAreaHeight = A4_HEIGHT - MARGIN * 2 - headerHeight - 50; // 여백 축소 (80 → 50)
  const drawingAreaWidth = CONTENT_WIDTH;

  page.drawRectangle({
    x: MARGIN,
    y: y - drawingAreaHeight,
    width: drawingAreaWidth,
    height: drawingAreaHeight,
    borderColor: rgb(0.7, 0.7, 0.7),
    borderWidth: 0.5,
  });

  // Try to embed drawing image if available
  // 우선순위: canvasImage (전체 캔버스 스냅샷) > uploadedImages (개별 이미지)
  console.log("[pdf-lib] ===== 도면 섹션 생성 시작 =====");
  console.log("[pdf-lib] 도면 데이터 존재 여부:", !!drawingData);
  if (drawingData) {
    console.log(
      "[pdf-lib] 도면 상세:",
      JSON.stringify({
        id: drawingData.id,
        caseId: drawingData.caseId,
        hasCanvasImage: !!(drawingData as any).canvasImage,
        canvasImageLength: (drawingData as any).canvasImage?.length || 0,
        uploadedImagesCount: Array.isArray(drawingData.uploadedImages)
          ? drawingData.uploadedImages.length
          : "not array",
        rectanglesCount: Array.isArray(drawingData.rectangles)
          ? drawingData.rectangles.length
          : "not array",
      }),
    );
  }

  // 새 방식: 원본 이미지에 마커/사각형을 직접 합성 (크롭으로 인한 마커 위치 이동 문제 해결)
  if (
    drawingData &&
    drawingData.uploadedImages &&
    drawingData.uploadedImages.length > 0
  ) {
    console.log("[pdf-lib] 분기: 원본 이미지 + 마커/사각형 합성 방식");
    try {
      const mainImage = drawingData.uploadedImages[0];
      if (mainImage.src) {
        let imageData: Buffer;

        if (mainImage.src.startsWith("data:image/")) {
          const base64Data = mainImage.src.split(",")[1];
          imageData = Buffer.from(base64Data, "base64");
        } else {
          imageData = Buffer.from(mainImage.src, "base64");
        }

        // 원본 이미지 메타데이터 가져오기
        const originalMeta = await sharp(imageData).metadata();
        const origWidth = originalMeta.width || 1;
        const origHeight = originalMeta.height || 1;
        
        console.log(`[pdf-lib] 원본 이미지 크기: ${origWidth}x${origHeight}`);
        console.log(`[pdf-lib] 캔버스 이미지 위치: (${mainImage.x}, ${mainImage.y}), 크기: ${mainImage.width}x${mainImage.height}`);

        // ============================================
        // objectFit: "contain" 보정 로직
        // 프론트엔드에서 이미지가 objectFit: "contain"으로 표시되므로
        // 영역과 이미지 비율이 다르면 여백이 생김
        // 마커 좌표는 영역 기준으로 저장되므로 여백을 보정해야 함
        // ============================================
        
        const areaRatio = mainImage.width / mainImage.height;
        const imageRatio = origWidth / origHeight;
        
        let displayWidth: number, displayHeight: number, offsetX: number, offsetY: number;
        
        if (imageRatio > areaRatio) {
          // 이미지가 더 넓음 - 너비에 맞춤
          displayWidth = mainImage.width;
          displayHeight = mainImage.width / imageRatio;
          offsetX = 0;
          offsetY = (mainImage.height - displayHeight) / 2;
        } else {
          // 이미지가 더 높음 (또는 같음) - 높이에 맞춤
          displayHeight = mainImage.height;
          displayWidth = mainImage.height * imageRatio;
          offsetX = (mainImage.width - displayWidth) / 2;
          offsetY = 0;
        }
        
        console.log(`[pdf-lib] 영역 비율: ${areaRatio.toFixed(4)}, 이미지 비율: ${imageRatio.toFixed(4)}`);
        console.log(`[pdf-lib] objectFit 보정: displaySize=${displayWidth.toFixed(2)}x${displayHeight.toFixed(2)}, offset=(${offsetX.toFixed(2)}, ${offsetY.toFixed(2)})`);

        // SVG 오버레이 생성 (마커와 사각형을 합성)
        const overlays: { input: Buffer; top: number; left: number }[] = [];

        // 누수 마커 합성
        const leakMarkers = (drawingData as any).leakMarkers || [];
        console.log(`[pdf-lib] 누수 마커 개수: ${leakMarkers.length}`);
        
        // 고정 마커 크기 (프론트엔드와 동일한 비율 유지)
        const markerRadius = Math.max(8, Math.round(Math.min(origWidth, origHeight) * 0.015));
        const markerSize = markerRadius * 2 + 4;
        const markerCenterOffset = markerRadius + 2;
        
        for (const marker of leakMarkers) {
          // objectFit: "contain" 여백 보정
          // 마커의 이미지 내 실제 위치 계산 (영역 기준 → 이미지 기준)
          const markerInImageX = marker.x - mainImage.x - offsetX;
          const markerInImageY = marker.y - mainImage.y - offsetY;
          
          // 원본 이미지 좌표로 변환
          const imgXPrecise = markerInImageX * (origWidth / displayWidth);
          const imgYPrecise = markerInImageY * (origHeight / displayHeight);
          
          // 상대 위치 비율 확인 (디버깅용)
          const relativeX = markerInImageX / displayWidth;
          const relativeY = markerInImageY / displayHeight;
          
          console.log(`[pdf-lib] 마커 상대위치 (보정 후): (${(relativeX * 100).toFixed(2)}%, ${(relativeY * 100).toFixed(2)}%)`);
          console.log(`[pdf-lib] 마커 변환: 캔버스(${marker.x.toFixed(2)}, ${marker.y.toFixed(2)}) → 이미지(${imgXPrecise.toFixed(2)}, ${imgYPrecise.toFixed(2)})`);
          
          // 최종 좌표 반올림 (sharp.composite은 정수만 허용)
          const imgX = Math.round(imgXPrecise);
          const imgY = Math.round(imgYPrecise);
          
          // 이미지 범위 내에 있는지 확인
          if (imgX >= 0 && imgX < origWidth && imgY >= 0 && imgY < origHeight) {
            // 빨간 원 마커 SVG (채워진 원)
            const markerSvg = Buffer.from(`
              <svg width="${markerSize}" height="${markerSize}">
                <circle cx="${markerCenterOffset}" cy="${markerCenterOffset}" r="${markerRadius}" 
                        fill="#E53935" stroke="#B71C1C" stroke-width="2"/>
              </svg>
            `);
            
            // 마커 중심이 imgX, imgY에 오도록 배치
            const overlayLeft = Math.max(0, imgX - markerCenterOffset);
            const overlayTop = Math.max(0, imgY - markerCenterOffset);
            
            overlays.push({
              input: markerSvg,
              top: overlayTop,
              left: overlayLeft,
            });
            
            console.log(`[pdf-lib] 마커 SVG 배치: left=${overlayLeft}, top=${overlayTop}, 크기=${markerSize}x${markerSize}`);
          } else {
            console.log(`[pdf-lib] 마커 범위 벗어남: (${imgX}, ${imgY}) - 스킵`);
          }
        }

        // 사각형 합성
        const rectangles = drawingData.rectangles || [];
        console.log(`[pdf-lib] 사각형 개수: ${rectangles.length}`);
        
        for (const rect of rectangles) {
          // objectFit: "contain" 여백 보정
          const rectInImageX = rect.x - mainImage.x - offsetX;
          const rectInImageY = rect.y - mainImage.y - offsetY;
          
          const imgX = Math.round(rectInImageX * (origWidth / displayWidth));
          const imgY = Math.round(rectInImageY * (origHeight / displayHeight));
          const imgWidth = Math.round(rect.width * (origWidth / displayWidth));
          const imgHeight = Math.round(rect.height * (origHeight / displayHeight));
          
          // 이미지 범위와 겹치는 부분이 있는지 확인
          if (imgX + imgWidth > 0 && imgX < origWidth && imgY + imgHeight > 0 && imgY < origHeight) {
            // 사각형 SVG (파란색 테두리)
            const rectSvg = Buffer.from(`
              <svg width="${imgWidth}" height="${imgHeight}">
                <rect x="1" y="1" width="${imgWidth - 2}" height="${imgHeight - 2}" 
                      fill="rgba(59, 130, 246, 0.1)" stroke="#3B82F6" stroke-width="2"/>
              </svg>
            `);
            
            overlays.push({
              input: rectSvg,
              top: Math.max(0, imgY),
              left: Math.max(0, imgX),
            });
            
            console.log(`[pdf-lib] 사각형 추가: 캔버스(${rect.x}, ${rect.y}) → 이미지(${imgX}, ${imgY}), 크기: ${imgWidth}x${imgHeight}`);
          }
        }

        // 사고 범위 합성
        const accidentAreas = (drawingData as any).accidentAreas || [];
        console.log(`[pdf-lib] 사고 범위 개수: ${accidentAreas.length}`);
        
        for (const area of accidentAreas) {
          // objectFit: "contain" 여백 보정
          const areaInImageX = area.x - mainImage.x - offsetX;
          const areaInImageY = area.y - mainImage.y - offsetY;
          
          const imgX = Math.round(areaInImageX * (origWidth / displayWidth));
          const imgY = Math.round(areaInImageY * (origHeight / displayHeight));
          const imgWidth = Math.round(area.width * (origWidth / displayWidth));
          const imgHeight = Math.round(area.height * (origHeight / displayHeight));
          
          // 이미지 범위와 겹치는 부분이 있는지 확인
          if (imgX + imgWidth > 0 && imgX < origWidth && imgY + imgHeight > 0 && imgY < origHeight) {
            // 사고 범위 SVG (빨간색 테두리, 투명 배경)
            const areaSvg = Buffer.from(`
              <svg width="${imgWidth}" height="${imgHeight}">
                <rect x="1" y="1" width="${imgWidth - 2}" height="${imgHeight - 2}" 
                      fill="rgba(239, 68, 68, 0.1)" stroke="#EF4444" stroke-width="2" stroke-dasharray="8,4"/>
              </svg>
            `);
            
            overlays.push({
              input: areaSvg,
              top: Math.max(0, imgY),
              left: Math.max(0, imgX),
            });
            
            console.log(`[pdf-lib] 사고범위 추가: 캔버스(${area.x}, ${area.y}) → 이미지(${imgX}, ${imgY}), 크기: ${imgWidth}x${imgHeight}`);
          }
        }

        // 오버레이 합성
        let compositeBuffer: Buffer;
        if (overlays.length > 0) {
          console.log(`[pdf-lib] 총 ${overlays.length}개 오버레이 합성 중...`);
          compositeBuffer = await sharp(imageData)
            .composite(overlays)
            .png()
            .toBuffer();
        } else {
          compositeBuffer = imageData;
        }

        // PNG/JPG에 따라 임베드
        let embeddedImage;
        const srcLower = mainImage.src.toLowerCase();
        if (srcLower.includes("image/png") || srcLower.includes(".png")) {
          embeddedImage = await pdfDoc.embedPng(compositeBuffer);
        } else {
          const jpegBuffer = await sharp(compositeBuffer)
            .jpeg({ quality: 90 })
            .toBuffer();
          embeddedImage = await pdfDoc.embedJpg(jpegBuffer);
        }

        // PDF 영역에 맞게 스케일링
        const imgDims = embeddedImage.scale(1);
        const maxWidth = drawingAreaWidth - 10;
        const maxHeight = drawingAreaHeight - 10;

        const scaleX = maxWidth / imgDims.width;
        const scaleY = maxHeight / imgDims.height;
        const scale = Math.min(scaleX, scaleY);

        let drawWidth = imgDims.width * scale;
        let drawHeight = imgDims.height * scale;

        console.log(
          `[pdf-lib] PDF 영역: ${maxWidth}x${maxHeight}, 합성 이미지: ${imgDims.width}x${imgDims.height}`,
        );
        console.log(
          `[pdf-lib] 도면 표시 크기: ${Math.round(drawWidth)}x${Math.round(drawHeight)}, scale: ${scale.toFixed(3)}`,
        );

        // 중앙 정렬
        const drawX = MARGIN + (drawingAreaWidth - drawWidth) / 2;
        const drawY =
          y - drawingAreaHeight + (drawingAreaHeight - drawHeight) / 2;

        page.drawImage(embeddedImage, {
          x: drawX,
          y: drawY,
          width: drawWidth,
          height: drawHeight,
        });

        console.log(
          `[pdf-lib] 도면 이미지 삽입 완료 (원본+마커 합성, 최종 크기: ${Math.round(drawWidth)}x${Math.round(drawHeight)})`,
        );
      }
    } catch (err) {
      console.error("[pdf-lib] 도면 이미지 합성 실패:", err);
      // 실패 시 placeholder 표시
      drawText(page, {
        x: MARGIN + drawingAreaWidth / 2 - 50,
        y: y - drawingAreaHeight / 2,
        text: "도면 이미지 로드 실패",
        font: fonts.regular,
        size: 12,
        color: { r: 0.6, g: 0.6, b: 0.6 },
      });
    }
  } else if (drawingData && (drawingData as any).canvasImage) {
    // Fallback: 첨부 이미지 없이 사각형만 그린 경우 canvasImage 사용 (기존 크롭 방식)
    console.log("[pdf-lib] 분기: canvasImage fallback 사용 (사각형만 있는 도면)");
    const canvasImage = (drawingData as any).canvasImage;
    try {
      let imageData: Buffer;

      if (canvasImage.startsWith("data:image/")) {
        const base64Data = canvasImage.split(",")[1];
        imageData = Buffer.from(base64Data, "base64");
      } else {
        imageData = Buffer.from(canvasImage, "base64");
      }

      console.log(`[pdf-lib] canvasImage 처리 시작...`);

      const originalMeta = await sharp(imageData).metadata();
      console.log(
        `[pdf-lib] 원본 크기: ${originalMeta.width}x${originalMeta.height}`,
      );

      // 자동 크롭 적용
      let processedImageData = imageData;
      try {
        const flattenedBuffer = await sharp(imageData)
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .png()
          .toBuffer();

        const trimmedBuffer = await sharp(flattenedBuffer)
          .trim({
            background: "#ffffff",
            threshold: 50,
          })
          .extend({
            top: 30,
            bottom: 30,
            left: 30,
            right: 30,
            background: { r: 255, g: 255, b: 255 },
          })
          .png()
          .toBuffer();

        const trimmedMeta = await sharp(trimmedBuffer).metadata();
        console.log(
          `[pdf-lib] 크롭 후 크기: ${trimmedMeta.width}x${trimmedMeta.height}`,
        );

        if (
          trimmedMeta.width &&
          trimmedMeta.height &&
          trimmedMeta.width > 100 &&
          trimmedMeta.height > 100
        ) {
          processedImageData = trimmedBuffer;
          console.log(`[pdf-lib] 자동 크롭 적용됨`);
        }
      } catch (trimErr) {
        console.log(`[pdf-lib] 자동 크롭 실패, 원본 사용:`, trimErr);
      }

      const embeddedImage = await pdfDoc.embedPng(processedImageData);

      const maxWidth = drawingAreaWidth - 10;
      const maxHeight = drawingAreaHeight - 10;

      const imgDims = embeddedImage.scale(1);

      const scaleX = maxWidth / imgDims.width;
      const scaleY = maxHeight / imgDims.height;
      const scale = Math.min(scaleX, scaleY);

      let drawWidth = imgDims.width * scale;
      let drawHeight = imgDims.height * scale;

      console.log(
        `[pdf-lib] PDF 영역: ${maxWidth}x${maxHeight}, 이미지: ${imgDims.width}x${imgDims.height}`,
      );
      console.log(
        `[pdf-lib] 도면 표시 크기: ${Math.round(drawWidth)}x${Math.round(drawHeight)}, scale: ${scale.toFixed(3)}`,
      );

      const drawX = MARGIN + (drawingAreaWidth - drawWidth) / 2;
      const drawY =
        y - drawingAreaHeight + (drawingAreaHeight - drawHeight) / 2;

      page.drawImage(embeddedImage, {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight,
      });

      console.log(
        `[pdf-lib] canvasImage 도면 삽입 완료 (크기: ${Math.round(drawWidth)}x${Math.round(drawHeight)})`,
      );
    } catch (err) {
      console.error("[pdf-lib] canvasImage 도면 삽입 실패:", err);
      drawText(page, {
        x: MARGIN + drawingAreaWidth / 2 - 50,
        y: y - drawingAreaHeight / 2,
        text: "도면 이미지 로드 실패",
        font: fonts.regular,
        size: 12,
        color: { r: 0.6, g: 0.6, b: 0.6 },
      });
    }
  } else {
    // No drawing data - show placeholder
    console.log("[pdf-lib] 분기: 도면 없음 (등록된 도면이 없습니다 표시)");
    drawText(page, {
      x: MARGIN + drawingAreaWidth / 2 - 60,
      y: y - drawingAreaHeight / 2,
      text: "등록된 도면이 없습니다",
      font: fonts.regular,
      size: 12,
      color: { r: 0.6, g: 0.6, b: 0.6 },
    });
  }
  console.log("[pdf-lib] ===== 도면 섹션 생성 완료 =====");

  // Footer
  const footerY = MARGIN + 15;
  const now = new Date();
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;

  drawText(page, {
    x: MARGIN,
    y: footerY,
    text: `작성일:${dateStr} | 사고접수번호:${accidentNo}`,
    font: fonts.regular,
    size: 9,
  });
}

async function renderEvidencePages(
  pdfDoc: PDFDocument,
  fonts: FontSet,
  caseData: any,
  documents: any[],
  processingConfig: ImageProcessingConfig,
): Promise<{ errors: Array<{ fileName: string; reason: string }> }> {
  const errors: Array<{ fileName: string; reason: string }> = [];

  const categoryToTab: Record<string, string> = {
    현장출동사진: "현장사진",
    현장: "현장사진",
    "수리중 사진": "현장사진",
    수리중: "현장사진",
    "복구완료 사진": "현장사진",
    복구완료: "현장사진",
    "보험금 청구서": "기본자료",
    "개인정보 동의서(가족용)": "기본자료",
    주민등록등본: "증빙자료",
    등기부등본: "증빙자료",
    건축물대장: "증빙자료",
    "기타증빙자료(민원일지 등)": "증빙자료",
    "복구완료 및 위임장": "청구자료",
    도급계약서: "청구자료",
    "부가세 청구자료": "청구자료",
    청구: "청구자료",
  };

  // 증빙자료 순서 정의 (사진 → 기본자료 → 증빙자료 → 청구자료)
  const CATEGORY_ORDER: string[] = [
    // 사진 (현장사진, 수리중, 복구완료)
    "현장출동사진",
    "현장",
    "현장사진",
    "수리중 사진",
    "수리중",
    "복구완료 사진",
    "복구완료",
    // 기본자료 (보험금청구서, 개인정보동의서)
    "보험금 청구서",
    "개인정보 동의서(가족용)",
    // 증빙자료 (주민등록등본, 등기부등본, 건축물대장, 기타증빙자료)
    "주민등록등본",
    "등기부등본",
    "건축물대장",
    "기타증빙자료(민원일지 등)",
    // 청구자료 (복구완료 및 위임장, 도급계약서, 부가세 청구자료)
    "복구완료 및 위임장",
    "도급계약서",
    "부가세 청구자료",
    "청구",
  ];

  // 문서 정렬 함수
  const getCategoryOrder = (category: string): number => {
    const idx = CATEGORY_ORDER.indexOf(category);
    return idx >= 0 ? idx : CATEGORY_ORDER.length;
  };

  // 문서를 카테고리 순서대로 정렬
  const sortedDocuments = [...documents].sort((a, b) => {
    return getCategoryOrder(a.category) - getCategoryOrder(b.category);
  });

  // 통합 문서 리스트 (이미지와 PDF를 함께 카테고리 순서대로 처리)
  type UnifiedDoc = {
    doc: any;
    tab: string;
    type: "image" | "pdf";
    data: string | Buffer; // 이미지는 base64 string, PDF는 Buffer
  };
  const unifiedDocs: UnifiedDoc[] = [];

  for (const doc of sortedDocuments) {
    const isImage = doc.fileType?.startsWith("image/");
    const isPdf =
      doc.fileType === "application/pdf" ||
      doc.fileName?.toLowerCase().endsWith(".pdf");
    const hasStorageKey = doc.storageKey && doc.storageKey.length > 0;
    const hasFileData = doc.fileData && doc.fileData.length > 100;
    const canLoadFromDb = !!doc.id;

    if (isImage && (hasStorageKey || hasFileData || canLoadFromDb)) {
      const tab = categoryToTab[doc.category] || "기타";
      const imageBuffer = await getImageBuffer(doc);
      if (imageBuffer) {
        const base64Data = imageBuffer.toString("base64");
        unifiedDocs.push({ doc, tab, type: "image", data: base64Data });
      } else {
        errors.push({ fileName: doc.fileName, reason: "이미지 로드 실패" });
      }
    } else if (isPdf && (hasStorageKey || hasFileData || canLoadFromDb)) {
      const tab = categoryToTab[doc.category] || "기타";
      const pdfBuffer = await getImageBuffer(doc);
      if (pdfBuffer) {
        unifiedDocs.push({ doc, tab, type: "pdf", data: pdfBuffer });
      } else {
        errors.push({ fileName: doc.fileName, reason: "PDF 로드 실패" });
      }
    } else if (isImage) {
      errors.push({ fileName: doc.fileName, reason: "이미지 데이터 없음" });
    } else if (isPdf) {
      errors.push({ fileName: doc.fileName, reason: "PDF 데이터 없음" });
    }
  }

  if (unifiedDocs.length === 0) {
    return { errors };
  }

  // PDF 헤더 상수
  const PDF_HEADER_HEIGHT = 35;
  const HEADER_CONTENT_GAP = 10;
  const TOTAL_HEADER_SPACE = PDF_HEADER_HEIGHT + HEADER_CONTENT_GAP;

  // 사진 카테고리 목록 (2장/페이지 처리용)
  const PHOTO_CATEGORIES = [
    "현장출동사진",
    "현장",
    "현장사진",
    "수리중 사진",
    "수리중",
    "복구완료 사진",
    "복구완료",
  ];
  const isPhotoCategory = (category: string) =>
    PHOTO_CATEGORIES.includes(category);

  // 통합 처리: 카테고리 순서대로 처리
  // 사진 카테고리 이미지는 2장씩 모아서 처리, 나머지는 1개씩
  let i = 0;
  while (i < unifiedDocs.length) {
    const current = unifiedDocs[i];
    const isPhoto = isPhotoCategory(current.doc.category);

    if (current.type === "pdf") {
      // PDF 문서: 1개씩 처리 (카테고리와 무관)
      try {
        console.log(`[pdf-lib] PDF 문서 삽입: ${current.doc.fileName}`);
        const externalPdf = await PDFDocument.load(current.data as Buffer, {
          ignoreEncryption: true,
        });
        const pageCount = externalPdf.getPageCount();

        // 케이스 번호에서 suffix 추출 (-0: 손해방지, -1 이상: 피해세대 복구)
        const pdfCaseNum = caseData.caseNumber || "";
        const pdfSuffixMatch = pdfCaseNum.match(/-(\d+)$/);
        const pdfCaseSuffix = pdfSuffixMatch
          ? parseInt(pdfSuffixMatch[1], 10)
          : 0;

        // -0 (손해방지)인 경우 피보험자 주소, -1 이상인 경우 피해자 주N � 사용
        let pdfFullAddress = "";
        if (pdfCaseSuffix === 0) {
          pdfFullAddress = [
            caseData.insuredAddress,
            caseData.insuredAddressDetail,
          ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s*-\s*/g, "-");
        } else {
          pdfFullAddress = (
            [caseData.victimAddress, caseData.victimAddressDetail]
              .filter(Boolean)
              .join(" ") ||
            [caseData.insuredAddress, caseData.insuredAddressDetail]
              .filter(Boolean)
              .join(" ")
          ).replace(/\s*-\s*/g, "-"); // 괄호로 전체 결과에 적용!
        }
        // 사고번호 처리: normalizeText 후 하이픈 앞뒤 공백 완전 제거
        const pdfAccidentNo = normalizeText(
          caseData.insuranceAccidentNo || caseData.insurancePolicyNo || "",
        )
          .replace(/\s+/g, " ") // 모든 연속 공백을 하나로
          .replace(/\s*-\s*/g, "-") // 하이픈 앞뒤 공백 제거
          .trim(); // 앞뒤 공백 제거

        const pdfCategoryDisplay = normalizeText(
          current.doc.category
            ? `${current.tab.trim()}-${current.doc.category.trim()}`
            : current.tab.trim(),
        ).replace(/\s*-\s*/g, "-");
        const headerRaw = `사고번호(증권번호) ${pdfAccidentNo}    ${normalizeText(pdfFullAddress)}    ${pdfCategoryDisplay}`;

        const headerText = headerRaw
          // 유니코드 공백/제로폭 공백 제거
          .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u2060\u3000]/g, " ")
          // 대시류 통일
          .replace(/[–—−]/g, "-")
          // 하이픈 주변 공백 제거 (핵심)
          .replace(/\s*-\s*/g, "-")
          // 연속 공백 축소
          .replace(/\s+/g, " ")
          .trim();

        const normalizedHeaderText = normalizeEvidenceHeaderText(headerRaw);

        const pdfFontSize =
          normalizedHeaderText.length > 60
            ? 8
            : normalizedHeaderText.length > 45
              ? 9
              : 10;

        for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
          const srcPage = externalPdf.getPage(pageIdx);
          const { width, height } = srcPage.getSize();
          const newPage = pdfDoc.addPage([width, height + TOTAL_HEADER_SPACE]);
          const embeddedPage = await pdfDoc.embedPage(srcPage);
          newPage.drawPage(embeddedPage, { x: 0, y: 0, width, height });

          const headerBaseY = height + HEADER_CONTENT_GAP;
          newPage.drawRectangle({
            x: 0,
            y: headerBaseY,
            width,
            height: PDF_HEADER_HEIGHT,
            color: rgb(0.2, 0.2, 0.2),
          });
          newPage.drawLine({
            start: { x: 0, y: headerBaseY },
            end: { x: width, y: headerBaseY },
            thickness: 1,
            color: rgb(0.3, 0.3, 0.3),
          });

          const textY = headerBaseY + (PDF_HEADER_HEIGHT - pdfFontSize) / 2;
          try {
            // 1) 최종 헤더 문자열 (공백 제거는 유지하되, 렌더링이 핵심)
            const headerText = normalizeText(normalizedHeaderText)
              .replace(/[–—−]/g, "-") // 대시류 통일
              .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u2060\u3000]/g, " ") // 유니코드 공백 통일
              .replace(/\s*-\s*/g, "-") // 하이픈 전후 공백 제거 (핵심)
              .replace(/\s+/g, " ")
              .trim();

            // 2) 헤더 영역 폭(오른쪽 페이지번호 영역 확보)
            const headerLeftPadding = 10;
            const headerRightPadding = 60;
            const headerMaxWidth =
              width - headerLeftPadding - headerRightPadding;

            // 3) 길면 폰트만 줄이기 (줄바꿈/문자쪼개기 금지)
            let headerFontSize = pdfFontSize;
            while (
              measureTextWidthAdjusted(headerText, fonts.bold, headerFontSize) >
                headerMaxWidth &&
              headerFontSize > 6
            ) {
              headerFontSize -= 0.5;
            }

            // 4) 한 번에 drawText (중요)
            drawTextCharByChar(
              newPage,
              headerText,
              10,
              textY,
              fonts.bold,
              pdfFontSize,
              { r: 1, g: 1, b: 1 },
            );
          } catch {}

          try {
            newPage.drawText(`${pageIdx + 1}/${pageCount}`, {
              x: width - 50,
              y: textY,
              size: 8,
              font: fonts.regular,
              color: rgb(1, 1, 1),
            });
          } catch {}
        }
        console.log(
          `[pdf-lib] PDF 문서 삽입 완료: ${current.doc.fileName} (${pageCount}페이지)`,
        );
      } catch (pdfError) {
        console.error(
          `[pdf-lib] PDF 삽입 오류 (${current.doc.fileName}):`,
          pdfError,
        );
        errors.push({
          fileName: current.doc.fileName,
          reason: "PDF 삽입 실패",
        });
      }
      i++;
    } else if (isPhoto && current.type === "image") {
      // 사진 카테고리 이미지: 2장씩 한 페이지에 처리
      // 다음 문서도 사진 카테고리 이미지인지 확인
      const next = unifiedDocs[i + 1];
      const nextIsPhotoImage =
        next && next.type === "image" && isPhotoCategory(next.doc.category);

      const imagesToRender = [current];
      if (nextIsPhotoImage) {
        imagesToRender.push(next);
      }

      // 사진 2장 한 페이지 렌더링
      await renderPhotoPage(
        pdfDoc,
        fonts,
        caseData,
        imagesToRender,
        processingConfig,
        errors,
      );

      i += imagesToRender.length;
    } else {
      // 비사진 카테고리 이미지: 1장씩 처리
      await renderSingleImagePage(
        pdfDoc,
        fonts,
        caseData,
        current,
        processingConfig,
        errors,
      );
      i++;
    }
  }

  return { errors };
}

// 사진 카테고리 2장 페이지 렌더링 헬퍼
async function renderPhotoPage(
  pdfDoc: PDFDocument,
  fonts: FontSet,
  caseData: any,
  images: Array<{ doc: any; tab: string; data: string | Buffer }>,
  processingConfig: ImageProcessingConfig,
  errors: Array<{ fileName: string; reason: string }>,
) {
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  const firstImage = images[0];

  // 케이스 번호에서 suffix 추출 (-0: 손해방지, -1 이상: 피해세대 복구)
  const photoCaseNum = caseData.caseNumber || "";
  const photoSuffixMatch = photoCaseNum.match(/-(\d+)$/);
  const photoCaseSuffix = photoSuffixMatch
    ? parseInt(photoSuffixMatch[1], 10)
    : 0;

  // -0 (손해방지)인 경우 피보험자 주소, -1 이상인 경우 피해자 주소 사용
  let fullAddress = "";
  if (photoCaseSuffix === 0) {
    fullAddress = [caseData.insuredAddress, caseData.insuredAddressDetail]
      .filter(Boolean)
      .join(" ");
  } else {
    fullAddress =
      [caseData.victimAddress, caseData.victimAddressDetail]
        .filter(Boolean)
        .join(" ") ||
      [caseData.insuredAddress, caseData.insuredAddressDetail]
        .filter(Boolean)
        .join(" ");
  }

  const accidentNo = normalizeText(
    caseData.insuranceAccidentNo || caseData.insurancePolicyNo || "",
  ).replace(/\s*-\s*/g, "-");
  const leftText = `사고번호(증권번호) ${accidentNo}`;
  const centerText = normalizeText(fullAddress);
  const rightText = normalizeText(
    firstImage.doc.category
      ? `${firstImage.tab}-${firstImage.doc.category}`
      : firstImage.tab,
  );

  page.drawRectangle({
    x: MARGIN,
    y: A4_HEIGHT - MARGIN - 30,
    width: CONTENT_WIDTH,
    height: 30,
    color: rgb(0.2, 0.2, 0.2),
  });

  const totalTextLength =
    leftText.length + centerText.length + rightText.length;
  const fontSize = totalTextLength > 70 ? 8 : totalTextLength > 50 ? 9 : 10;

  drawText(page, {
    x: MARGIN + 15,
    y: A4_HEIGHT - MARGIN - 22,
    text: leftText,
    font: fonts.bold,
    size: fontSize,
    color: { r: 1, g: 1, b: 1 },
  });

  const centerTextWidth = fonts.bold.widthOfTextAtSize(centerText, fontSize);
  const centerX = MARGIN + (CONTENT_WIDTH - centerTextWidth) / 2;
  drawText(page, {
    x: centerX,
    y: A4_HEIGHT - MARGIN - 22,
    text: centerText,
    font: fonts.bold,
    size: fontSize,
    color: { r: 1, g: 1, b: 1 },
  });

  const rightTextWidth = fonts.bold.widthOfTextAtSize(rightText, fontSize);
  drawText(page, {
    x: A4_WIDTH - MARGIN - 15 - rightTextWidth,
    y: A4_HEIGHT - MARGIN - 22,
    text: rightText,
    font: fonts.bold,
    size: fontSize,
    color: { r: 1, g: 1, b: 1 },
  });

  const categoryLabelHeight = 22;
  const imageHeight = 295;
  const imageWidth = CONTENT_WIDTH;
  const spacing = 8;
  const footerHeight = 20;

  // 첫 번째 사진의 카테고리 레이블
  const firstCategory = normalizeText(firstImage.doc.category || "");
  const firstCategoryY = A4_HEIGHT - MARGIN - 30 - spacing;

  // 카테고리 레이블 배경 (하늘색 배경)
  page.drawRectangle({
    x: MARGIN,
    y: firstCategoryY - categoryLabelHeight,
    width: CONTENT_WIDTH,
    height: categoryLabelHeight,
    color: rgb(0.88, 0.95, 1), // 연한 하늘색 배경
  });

  // 카테고리 레이블 텍스트
  drawText(page, {
    x: MARGIN + 10,
    y: firstCategoryY - categoryLabelHeight + 7,
    text: firstCategory,
    font: fonts.bold,
    size: 10,
    color: { r: 0.2, g: 0.4, b: 0.6 },
  });

  const firstY =
    firstCategoryY - categoryLabelHeight - imageHeight - footerHeight;

  page.drawRectangle({
    x: MARGIN,
    y: firstY + footerHeight,
    width: CONTENT_WIDTH,
    height: imageHeight,
    borderColor: rgb(0.8, 0.8, 0.8),
    borderWidth: 0.5,
  });

  const firstResult = await embedImage(
    pdfDoc,
    page,
    firstImage.data as string,
    MARGIN + 5,
    firstY + footerHeight + 5,
    imageWidth - 10,
    imageHeight - 10,
    processingConfig,
  );
  if (!firstResult.success) {
    drawErrorSection(
      page,
      fonts,
      MARGIN + 5,
      firstY + footerHeight + 5,
      imageWidth - 10,
      imageHeight - 10,
      firstImage.doc.fileName,
      firstResult.error || "첨부 실패",
    );
    errors.push({
      fileName: firstImage.doc.fileName,
      reason: firstResult.error || "첨부 실패",
    });
  }


  if (images[1]) {
    const secondImage = images[1];
    const secondCategory = normalizeText(secondImage.doc.category || "");

    // 두 번째 사진의 카테고리 레이블
    const secondCategoryY = firstY - spacing;

    page.drawRectangle({
      x: MARGIN,
      y: secondCategoryY - categoryLabelHeight,
      width: CONTENT_WIDTH,
      height: categoryLabelHeight,
      color: rgb(0.88, 0.95, 1), // 연한 하늘색 배경
    });

    drawText(page, {
      x: MARGIN + 10,
      y: secondCategoryY - categoryLabelHeight + 7,
      text: secondCategory,
      font: fonts.bold,
      size: 10,
      color: { r: 0.2, g: 0.4, b: 0.6 },
    });

    const secondY =
      secondCategoryY - categoryLabelHeight - imageHeight - footerHeight;

    page.drawRectangle({
      x: MARGIN,
      y: secondY + footerHeight,
      width: CONTENT_WIDTH,
      height: imageHeight,
      borderColor: rgb(0.8, 0.8, 0.8),
      borderWidth: 0.5,
    });

    const secondResult = await embedImage(
      pdfDoc,
      page,
      secondImage.data as string,
      MARGIN + 5,
      secondY + footerHeight + 5,
      imageWidth - 10,
      imageHeight - 10,
      processingConfig,
    );
    if (!secondResult.success) {
      drawErrorSection(
        page,
        fonts,
        MARGIN + 5,
        secondY + footerHeight + 5,
        imageWidth - 10,
        imageHeight - 10,
        secondImage.doc.fileName,
        secondResult.error || "첨부 실패",
      );
      errors.push({
        fileName: secondImage.doc.fileName,
        reason: secondResult.error || "첨부 실패",
      });
    }

  }
}

// 비사진 카테고리 이미지 1장 페이지 렌더링 헬퍼
async function renderSingleImagePage(
  pdfDoc: PDFDocument,
  fonts: FontSet,
  caseData: any,
  imageDoc: { doc: any; tab: string; data: string | Buffer },
  processingConfig: ImageProcessingConfig,
  errors: Array<{ fileName: string; reason: string }>,
) {
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

  // 케이스 번호에서 suffix 추출 (-0: 손해방지, -1 이상: 피해세대 복구)
  const singleCaseNum = caseData.caseNumber || "";
  const singleSuffixMatch = singleCaseNum.match(/-(\d+)$/);
  const singleCaseSuffix = singleSuffixMatch
    ? parseInt(singleSuffixMatch[1], 10)
    : 0;

  // -0 (손해방지)인 경우 피보험자 주소, -1 이상인 경우 피해자 주소 사용
  let fullAddress = "";
  if (singleCaseSuffix === 0) {
    fullAddress = [caseData.insuredAddress, caseData.insuredAddressDetail]
      .filter(Boolean)
      .join(" ");
  } else {
    fullAddress =
      [caseData.victimAddress, caseData.victimAddressDetail]
        .filter(Boolean)
        .join(" ") ||
      [caseData.insuredAddress, caseData.insuredAddressDetail]
        .filter(Boolean)
        .join(" ");
  }

  const accidentNo = normalizeText(
    caseData.insuranceAccidentNo || caseData.insurancePolicyNo || "",
  ).replace(/\s*-\s*/g, "-");
  const leftText = `사고번호(증권번호) ${accidentNo}`;
  const centerText = normalizeText(fullAddress);
  const rightText = normalizeText(
    imageDoc.doc.category
      ? `${imageDoc.tab}-${imageDoc.doc.category}`
      : imageDoc.tab,
  );

  page.drawRectangle({
    x: MARGIN,
    y: A4_HEIGHT - MARGIN - 30,
    width: CONTENT_WIDTH,
    height: 30,
    color: rgb(0.2, 0.2, 0.2),
  });

  const totalTextLength =
    leftText.length + centerText.length + rightText.length;
  const fontSize = totalTextLength > 70 ? 8 : totalTextLength > 50 ? 9 : 10;

  drawText(page, {
    x: MARGIN + 15,
    y: A4_HEIGHT - MARGIN - 22,
    text: leftText,
    font: fonts.bold,
    size: fontSize,
    color: { r: 1, g: 1, b: 1 },
  });

  const centerTextWidth = fonts.bold.widthOfTextAtSize(centerText, fontSize);
  const centerX = MARGIN + (CONTENT_WIDTH - centerTextWidth) / 2;
  drawText(page, {
    x: centerX,
    y: A4_HEIGHT - MARGIN - 22,
    text: centerText,
    font: fonts.bold,
    size: fontSize,
    color: { r: 1, g: 1, b: 1 },
  });

  const rightTextWidth = fonts.bold.widthOfTextAtSize(rightText, fontSize);
  drawText(page, {
    x: A4_WIDTH - MARGIN - 15 - rightTextWidth,
    y: A4_HEIGHT - MARGIN - 22,
    text: rightText,
    font: fonts.bold,
    size: fontSize,
    color: { r: 1, g: 1, b: 1 },
  });

  const singleImageHeight = 650;

  page.drawRectangle({
    x: MARGIN,
    y: A4_HEIGHT - MARGIN - 30 - 8 - singleImageHeight,
    width: CONTENT_WIDTH,
    height: singleImageHeight,
    borderColor: rgb(0.8, 0.8, 0.8),
    borderWidth: 0.5,
  });

  const imageResult = await embedImage(
    pdfDoc,
    page,
    imageDoc.data as string,
    MARGIN + 5,
    A4_HEIGHT - MARGIN - 30 - 8 - singleImageHeight + 5,
    CONTENT_WIDTH - 10,
    singleImageHeight - 10,
    processingConfig,
  );
  if (!imageResult.success) {
    drawErrorSection(
      page,
      fonts,
      MARGIN + 5,
      A4_HEIGHT - MARGIN - 30 - 8 - singleImageHeight + 5,
      CONTENT_WIDTH - 10,
      singleImageHeight - 10,
      imageDoc.doc.fileName,
      imageResult.error || "첨부 실패",
    );
    errors.push({
      fileName: imageDoc.doc.fileName,
      reason: imageResult.error || "첨부 실패",
    });
  }

}

async function renderRecoveryAreaPage(
  pdfDoc: PDFDocument,
  fonts: FontSet,
  caseData: any,
  estimateRowsData: any[],
): Promise<void> {
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;

  // Title (no Excel icon)
  drawText(page, {
    x: MARGIN,
    y: y - 18,
    text: "현장 피해/복구 면적 산출표",
    font: fonts.bold,
    size: 16,
  });

  y -= 45;

  // 케이스 번호에서 suffix 추출 (-0: 손해비용방지, -1/-2/-3: 피해세대 복구)
  const caseNumber = caseData.caseNumber || "";
  const suffixMatch = caseNumber.match(/-(\d+)$/);
  const suffix = suffixMatch ? parseInt(suffixMatch[1], 10) : 0;

  // -0인 경우 피보험자 주소, -1 이상인 경우 피해자 주소 사용
  const fullAddress =
    suffix === 0
      ? [caseData.insuredAddress, caseData.insuredAddressDetail]
          .filter(Boolean)
          .join(" ")
      : [caseData.victimAddress, caseData.victimAddressDetail]
          .filter(Boolean)
          .join(" ") ||
        [caseData.insuredAddress, caseData.insuredAddressDetail]
          .filter(Boolean)
          .join(" ");

  const now = new Date();
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;

  // Info table
  // 특수기호 뒤 공백 제거 함수
  const removeSymbolSpaces = (text: string) =>
    text.replace(/-\s+/g, "-").replace(/:\s+/g, ":");
  const headerRows: TableCell[][] = [
    [
      {
        text: "사고번호(증권번호)",
        width: 70,
        isHeader: true,
        align: "center",
      },
      {
        text: removeSymbolSpaces(
          caseData.insuranceAccidentNo || caseData.insurancePolicyNo || "-",
        ),
        width: 120,
        align: "left",
      },
      { text: "보험사", width: 60, isHeader: true, align: "center" },
      { text: caseData.insuranceCompany || "-", width: 100, align: "left" },
      { text: "플록슨접수번호", width: 70, isHeader: true, align: "center" },
      {
        text: removeSymbolSpaces(caseData.caseNumber || "-"),
        width: 95,
        align: "left",
      },
    ],
    [
      { text: "장소", width: 70, isHeader: true, align: "center" },
      { text: fullAddress || "-", width: 280, align: "left" },
      { text: "작성일자", width: 70, isHeader: true, align: "center" },
      { text: dateStr, width: 95, align: "left" },
    ],
  ];

  y = drawTable(page, {
    x: MARGIN,
    y,
    rows: headerRows,
    fonts,
    fontSize: 9,
    rowHeight: 24,
  });

  y -= 20;

  // 표 전체 너비 계산: 55 + 70 + 70 + 130 + 130 + 60 = 515
  const tableWidth = 515;
  const rightPadding = 4;
  const unitTextWidth = fonts.regular.widthOfTextAtSize("단위 : m, m²", 9);
  drawText(page, {
    x: MARGIN + tableWidth - unitTextWidth - rightPadding,
    y,
    text: "단위 : m, m²",
    font: fonts.regular,
    size: 9,
  });

  y -= 15;

  // 헤더 높이 설정 (2행 병합용)
  const headerRowHeight = 20;
  const totalHeaderHeight = headerRowHeight * 2;

  // 병합 셀 너비 정의
  const colWidths = {
    gubun: 55,
    content: 70,
    category: 70,
    damage: 130,
    recovery: 130,
    note: 60,
  };

  // 구분, 공사내용, 공사분류 병합 셀 그리기 (2행 병합)
  const mergedCells = [
    { text: "구분", width: colWidths.gubun, x: MARGIN },
    { text: "공사내용", width: colWidths.content, x: MARGIN + colWidths.gubun },
    {
      text: "공사분류",
      width: colWidths.category,
      x: MARGIN + colWidths.gubun + colWidths.content,
    },
  ];

  for (const cell of mergedCells) {
    // 배경색
    page.drawRectangle({
      x: cell.x,
      y: y - totalHeaderHeight,
      width: cell.width,
      height: totalHeaderHeight,
      color: rgb(0.94, 0.94, 0.94),
    });
    // 테두리
    page.drawRectangle({
      x: cell.x,
      y: y - totalHeaderHeight,
      width: cell.width,
      height: totalHeaderHeight,
      borderColor: rgb(0.3, 0.3, 0.3),
      borderWidth: 0.5,
    });
    // 텍스트 (세로 중앙 정렬)
    const textWidth = fonts.bold.widthOfTextAtSize(cell.text, 8);
    drawText(page, {
      x: cell.x + (cell.width - textWidth) / 2,
      y: y - totalHeaderHeight / 2 - 3,
      text: cell.text,
      font: fonts.bold,
      size: 8,
    });
  }

  // 비고 병합 셀 그리기 (2행 병합)
  const noteX =
    MARGIN +
    colWidths.gubun +
    colWidths.content +
    colWidths.category +
    colWidths.damage +
    colWidths.recovery;
  page.drawRectangle({
    x: noteX,
    y: y - totalHeaderHeight,
    width: colWidths.note,
    height: totalHeaderHeight,
    color: rgb(0.94, 0.94, 0.94),
  });
  page.drawRectangle({
    x: noteX,
    y: y - totalHeaderHeight,
    width: colWidths.note,
    height: totalHeaderHeight,
    borderColor: rgb(0.3, 0.3, 0.3),
    borderWidth: 0.5,
  });
  const noteTextWidth = fonts.bold.widthOfTextAtSize("비고", 8);
  drawText(page, {
    x: noteX + (colWidths.note - noteTextWidth) / 2,
    y: y - totalHeaderHeight / 2 - 3,
    text: "비고",
    font: fonts.bold,
    size: 8,
  });

  // 피해면적/복구면적 상단 헤더 (1행)
  const damageX =
    MARGIN + colWidths.gubun + colWidths.content + colWidths.category;
  const areaHeaders = [
    { text: "피해면적", width: colWidths.damage, x: damageX },
    {
      text: "복구면적",
      width: colWidths.recovery,
      x: damageX + colWidths.damage,
    },
  ];

  for (const cell of areaHeaders) {
    page.drawRectangle({
      x: cell.x,
      y: y - headerRowHeight,
      width: cell.width,
      height: headerRowHeight,
      color: rgb(0.94, 0.94, 0.94),
    });
    page.drawRectangle({
      x: cell.x,
      y: y - headerRowHeight,
      width: cell.width,
      height: headerRowHeight,
      borderColor: rgb(0.3, 0.3, 0.3),
      borderWidth: 0.5,
    });
    const textWidth = fonts.bold.widthOfTextAtSize(cell.text, 8);
    drawText(page, {
      x: cell.x + (cell.width - textWidth) / 2,
      y: y - headerRowHeight / 2 - 3,
      text: cell.text,
      font: fonts.bold,
      size: 8,
    });
  }

  // 피해면적/복구면적 하단 서브헤더 (2행)
  const subHeaders = [
    { text: "면적", width: 43, x: damageX },
    { text: "가로", width: 43, x: damageX + 43 },
    { text: "세로", width: 44, x: damageX + 86 },
    { text: "면적", width: 43, x: damageX + colWidths.damage },
    { text: "가로", width: 43, x: damageX + colWidths.damage + 43 },
    { text: "세로", width: 44, x: damageX + colWidths.damage + 86 },
  ];

  for (const cell of subHeaders) {
    page.drawRectangle({
      x: cell.x,
      y: y - totalHeaderHeight,
      width: cell.width,
      height: headerRowHeight,
      color: rgb(0.94, 0.94, 0.94),
    });
    page.drawRectangle({
      x: cell.x,
      y: y - totalHeaderHeight,
      width: cell.width,
      height: headerRowHeight,
      borderColor: rgb(0.3, 0.3, 0.3),
      borderWidth: 0.5,
    });
    const textWidth = fonts.bold.widthOfTextAtSize(cell.text, 8);
    drawText(page, {
      x: cell.x + (cell.width - textWidth) / 2,
      y: y - totalHeaderHeight + headerRowHeight / 2 - 3,
      text: cell.text,
      font: fonts.bold,
      size: 8,
    });
  }

  y -= totalHeaderHeight;

  // Group rows by category (location)
  const groupedRows: Record<string, any[]> = {};
  if (estimateRowsData && estimateRowsData.length > 0) {
    for (const row of estimateRowsData) {
      const category = row.category || "기타";
      if (!groupedRows[category]) {
        groupedRows[category] = [];
      }
      groupedRows[category].push(row);
    }
  }

  // Draw data rows grouped by category with merged cells
  const categories = Object.keys(groupedRows);
  const dataRowHeight = 22;
  const categoryColWidth = 55;

  if (categories.length > 0) {
    for (const category of categories) {
      const rows = groupedRows[category];
      const groupHeight = rows.length * dataRowHeight;
      const groupStartY = y;

      // Draw merged category cell (spans all rows in this group)
      page.drawRectangle({
        x: MARGIN,
        y: groupStartY - groupHeight,
        width: categoryColWidth,
        height: groupHeight,
        color: rgb(1, 1, 1),
      });
      page.drawRectangle({
        x: MARGIN,
        y: groupStartY - groupHeight,
        width: categoryColWidth,
        height: groupHeight,
        borderColor: rgb(0.3, 0.3, 0.3),
        borderWidth: 0.5,
      });

      // Draw category text centered vertically in merged cell
      const normalizedCategory = normalizeText(category);
      const categoryTextWidth = measureTextWidthAdjusted(
        normalizedCategory,
        fonts.regular,
        8,
      );
      // i��자별로 렌더링하여 특수문자 간격 조정
      drawTextCharByChar(
        page,
        normalizedCategory,
        MARGIN + (categoryColWidth - categoryTextWidth) / 2,
        groupStartY - groupHeight / 2 - 3,
        fonts.regular,
        8,
        { r: 0, g: 0, b: 0 },
      );

      // Draw individual rows (excluding category column)
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const damageW = row.damageWidth
          ? Number(row.damageWidth).toFixed(1)
          : "0.0";
        const damageH = row.damageHeight
          ? Number(row.damageHeight).toFixed(1)
          : "0.0";
        const damageAreaM2 = row.damageArea
          ? Number(row.damageArea).toFixed(1)
          : "0.0";

        const repairW = row.repairWidth
          ? Number(row.repairWidth).toFixed(1)
          : "0.0";
        const repairH = row.repairHeight
          ? Number(row.repairHeight).toFixed(1)
          : "0.0";
        const repairAreaM2 = row.repairArea
          ? Number(row.repairArea).toFixed(1)
          : "0.0";

        // Row without category column (starts after category column)
        const dataRow: TableCell[] = [
          { text: row.location || "-", width: 70, align: "center" },
          { text: row.workName || "-", width: 70, align: "center" },
          { text: damageAreaM2, width: 43, align: "center" },
          { text: damageW, width: 43, align: "center" },
          { text: damageH, width: 44, align: "center" },
          { text: repairAreaM2, width: 43, align: "center" },
          { text: repairW, width: 43, align: "center" },
          { text: repairH, width: 44, align: "center" },
          { text: row.note || "-", width: 60, align: "center" },
        ];

        drawTable(page, {
          x: MARGIN + categoryColWidth,
          y: groupStartY - i * dataRowHeight,
          rows: [dataRow],
          fonts,
          fontSize: 8,
          rowHeight: dataRowHeight,
        });
      }

      y = groupStartY - groupHeight;
    }
  } else {
    const emptyRow: TableCell[] = [
      {
        text: "등록된 복구면적 데이터가 없습니다.",
        width: 515,
        align: "center",
      },
    ];

    drawTable(page, {
      x: MARGIN,
      y,
      rows: [emptyRow],
      fonts,
      fontSize: 8,
      rowHeight: 22,
    });
  }

  // Footer
  const footerY = MARGIN + 20;
  drawText(page, {
    x: A4_WIDTH - MARGIN - 120,
    y: footerY,
    text: `작성일:${dateStr}`,
    font: fonts.regular,
    size: 9,
  });
}

async function renderEstimatePage(
  pdfDoc: PDFDocument,
  fonts: FontSet,
  caseData: any,
  estimateData: any,
  estimateRowsData: any[],
  partnerData: any,
): Promise<void> {
  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;

  // ===== 견적서 타이틀 =====
  drawText(page, {
    x: MARGIN,
    y: y - 10,
    text: "견 적 서",
    font: fonts.bold,
    size: 18,
    maxWidth: CONTENT_WIDTH,
    align: "center",
  });

  y -= 40;

  // ===== 상단 정보 테이블 =====
  // 케이스 번호에서 suffix 추출 (-0: 손해방지, -1 이상: 피해세대 복구)
  const caseNumber = caseData.caseNumber || "";
  const suffixMatch = caseNumber.match(/-(\d+)$/);
  const caseSuffix = suffixMatch ? parseInt(suffixMatch[1], 10) : 0;

  // -0 (손해방지)인 경우 피보험자 주소, -1 이상인 경우 피해자 주소 사용
  const addressMain =
    caseSuffix === 0
      ? caseData.insuredAddress || caseData.victimAddress || ""
      : caseData.victimAddress || caseData.insuredAddress || "";
  const addressDetail =
    caseSuffix === 0
      ? caseData.insuredAddressDetail || caseData.victimAddressDetail || ""
      : caseData.victimAddressDetail || caseData.insuredAddressDetail || "";
  const fullAddress = [addressMain, addressDetail].filter(Boolean).join(" ");

  const partnerCompany =
    partnerData?.company || caseData.assignedPartner || "-";
  const partnerBusinessNo = partnerData?.businessRegistrationNumber || "-";
  const partnerRepName =
    partnerData?.representativeName || partnerData?.name || "-";

  const rowHeight = 20;
  const leftTableWidth = 320; // 현장명/보험사/사고번호 테이블 (넓힘)
  const supplierLabelWidth = 25; // 공/급/자 병합 셀 (줄임)
  const rightTableWidth = 170; // 사업자번호/상호명/대표자 테이블 (줄임)

  // 좌측 테이블 (현장명/보험사/사고번호)
  // 특수기호 뒤 공백 제거 함수
  const removeAccidentSpaces = (text: string) =>
    text.replace(/-\s+/g, "-").replace(/:\s+/g, ":");
  const leftTableRows: TableCell[][] = [
    [
      { text: "현장명(주소)", width: 70, isHeader: true, align: "center" },
      { text: fullAddress || "-", width: 250, align: "left" },
    ],
    [
      { text: "보험사", width: 70, isHeader: true, align: "center" },
      { text: caseData.insuranceCompany || "-", width: 250, align: "left" },
    ],
    [
      {
        text: "사고번호(증권번호)",
        width: 70,
        isHeader: true,
        align: "center",
      },
      {
        text: removeAccidentSpaces(
          caseData.insuranceAccidentNo || caseData.insurancePolicyNo || "-",
        ),
        width: 250,
        align: "left",
      },
    ],
  ];

  drawTable(page, {
    x: MARGIN,
    y,
    rows: leftTableRows,
    fonts,
    fontSize: 9,
    rowHeight,
  });

  // 공급자 병합 셀 (3행 세로 병합)
  const supplierX = MARGIN + leftTableWidth;
  const supplierHeight = rowHeight * 3;

  // 공급자 셀 배경
  page.drawRectangle({
    x: supplierX,
    y: y - supplierHeight,
    width: supplierLabelWidth,
    height: supplierHeight,
    color: rgb(0.94, 0.94, 0.94),
  });

  // 공급자 셀 테두리
  page.drawRectangle({
    x: supplierX,
    y: y - supplierHeight,
    width: supplierLabelWidth,
    height: supplierHeight,
    borderColor: rgb(0.3, 0.3, 0.3),
    borderWidth: 0.5,
  });

  // 공/급/자 텍스트 (세로 중앙에 배치)
  const supplierLabels = ["공", "급", "자"];
  supplierLabels.forEach((label, idx) => {
    const labelY = y - (idx + 0.5) * rowHeight;
    const labelWidth = measureTextWidth(label, fonts.bold, 9);
    page.drawText(label, {
      x: supplierX + (supplierLabelWidth - labelWidth) / 2,
      y: labelY - 3,
      size: 9,
      font: fonts.bold,
      color: rgb(0, 0, 0),
    });
  });

  // 우측 테이블 (사업자번호/상호명/대표자)
  const rightTableRows: TableCell[][] = [
    [
      { text: "사업자번호", width: 55, isHeader: true, align: "center" },
      { text: partnerBusinessNo, width: 115, align: "left" },
    ],
    [
      { text: "상호명", width: 55, isHeader: true, align: "center" },
      { text: partnerCompany, width: 115, align: "left" },
    ],
    [
      { text: "대표자", width: 55, isHeader: true, align: "center" },
      { text: partnerRepName, width: 115, align: "left" },
    ],
  ];

  drawTable(page, {
    x: supplierX + supplierLabelWidth,
    y,
    rows: rightTableRows,
    fonts,
    fontSize: 9,
    rowHeight,
  });

  y -= supplierHeight;

  y -= 10;

  // ===== 노무비 테이블 =====
  page.drawRectangle({
    x: MARGIN,
    y: y - 15,
    width: CONTENT_WIDTH,
    height: 15,
    color: rgb(0.95, 0.9, 0.7),
  });

  drawText(page, {
    x: MARGIN + 5,
    y: y - 12,
    text: "노무비",
    font: fonts.bold,
    size: 9,
  });

  y -= 20;

  let laborCostItems: any[] = [];
  if (estimateData?.laborCostData) {
    try {
      const rawLaborData =
        typeof estimateData.laborCostData === "string"
          ? JSON.parse(estimateData.laborCostData)
          : estimateData.laborCostData;
      if (Array.isArray(rawLaborData)) {
        laborCostItems = rawLaborData;
      } else if (rawLaborData.rows && Array.isArray(rawLaborData.rows)) {
        laborCostItems = rawLaborData.rows;
      }
    } catch {}
  }

  // Golden Master 노무비 컬럼: 공종 | 공사명 | 노임항목 | 복구면적 | 적용단가 | 수량(인) | 합계 | 경비 | 비고
  const laborHeader: TableCell[] = [
    { text: "공종", width: 55, isHeader: true, align: "center" },
    { text: "공사명", width: 60, isHeader: true, align: "center" },
    { text: "노임항목", width: 60, isHeader: true, align: "center" },
    { text: "복구면적(m²)", width: 55, isHeader: true, align: "center" },
    { text: "적용단가(원)", width: 65, isHeader: true, align: "center" },
    { text: "수량(인)", width: 45, isHeader: true, align: "center" },
    { text: "합계(원)", width: 70, isHeader: true, align: "center" },
    { text: "경비 여부", width: 50, isHeader: true, align: "center" },
    { text: "비고", width: 55, isHeader: true, align: "center" },
  ];

  const laborRows: TableCell[][] = [laborHeader];
  let laborTotal = 0;
  // includeInEstimate === true → 경비가 아닌 항목 (관리비/이윤에 포함)
  // includeInEstimate === false → 경비 항목 (관리비/이윤에서 제외)
  let laborNonExpenseTotal = 0; // 경비가 아닌 항목 합계 (관리비/이윤 계산 대상)

  if (laborCostItems.length > 0) {
    laborCostItems.forEach((row) => {
      // LaborCostRow 필드명: category(공종), workName(공사명), detailItem(세부항목/노임항목)
      // damageArea(피해면적), standardPrice(기준가), pricePerSqm(기준가m²)
      // quantity(수량), amount(금액), includeInEstimate(경비여부), request(요청/비고)
      const damageArea =
        Number(row.damageArea) ||
        Number(row.repairArea) ||
        Number(row.area) ||
        0;
      const unitPrice =
        Number(row.standardPrice) ||
        Number(row.pricePerSqm) ||
        Number(row.unitPrice) ||
        0;
      const amount = Number(row.amount) || 0;
      // 수량 = 합계 / 적용단가 (견적서 작성 페이지와 동일한 계산 방식)
      const quantity = unitPrice > 0 ? amount / unitPrice : 0;
      // includeInEstimate=false → 경비 항목 (화면에 표시)
      const expense = !row.includeInEstimate ? amount : 0;
      laborTotal += amount;
      // includeInEstimate=true → 경비가 아닌 항목 (관리비/이윤 계산에 포함)
      if (row.includeInEstimate) {
        laborNonExpenseTotal += amount;
      }

      laborRows.push([
        {
          text: row.category || row.workType || "-",
          width: 55,
          align: "center",
        },
        { text: row.workName || "-", width: 60, align: "left" },
        {
          text: row.detailItem || row.laborItem || "-",
          width: 60,
          align: "left",
        },
        {
          text: damageArea > 0 ? damageArea.toFixed(2) : "-",
          width: 55,
          align: "right",
        },
        {
          text: unitPrice > 0 ? formatNumber(unitPrice) : "-",
          width: 65,
          align: "right",
        },
        {
          text: quantity > 0 ? quantity.toFixed(1) : "-",
          width: 45,
          align: "center",
        },
        { text: formatNumber(amount), width: 70, align: "right" },
        {
          text: row.includeInEstimate ? "부" : "여",
          width: 50,
          align: "center",
        },
        { text: row.request || row.note || "-", width: 55, align: "left" },
      ]);
    });
  } else {
    laborRows.push([
      { text: "등록된 노무비 데이터가 없습니다.", width: 515, align: "center" },
    ]);
  }

  // 노무비 소계 행 (전체 너비에 맞춤: 55+60+60+55+65+45+70+50+55 = 515)
  laborRows.push([
    { text: "노무비 소계", width: 400, isHeader: true, align: "center" },
    { text: formatNumber(laborTotal), width: 115, align: "right" },
  ]);

  // 페이지네이션 적용 노무비 테이블
  const laborResult = drawPaginatedTable(pdfDoc, page, {
    x: MARGIN,
    y,
    rows: laborRows,
    fonts,
    fontSize: 7,
    rowHeight: 16,
    pageBottomY: MARGIN + 80,
    headerRow: laborHeader,
  });
  page = laborResult.page;
  y = laborResult.y;

  y -= 15;

  // 자재비 섹션 시작 전 페이지 경계 체크
  if (y - 35 < MARGIN + 80) {
    page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
    y = A4_HEIGHT - MARGIN;
  }

  // ===== 자재비 테이블 =====
  page.drawRectangle({
    x: MARGIN,
    y: y - 15,
    width: CONTENT_WIDTH,
    height: 15,
    color: rgb(0.95, 0.9, 0.7),
  });

  drawText(page, {
    x: MARGIN + 5,
    y: y - 12,
    text: "자재비",
    font: fonts.bold,
    size: 9,
  });

  y -= 20;

  let materialCostItems: any[] = [];
  if (estimateData?.materialCostData) {
    try {
      const rawMaterialData =
        typeof estimateData.materialCostData === "string"
          ? JSON.parse(estimateData.materialCostData)
          : estimateData.materialCostData;
      if (Array.isArray(rawMaterialData)) {
        materialCostItems = rawMaterialData;
      } else if (rawMaterialData.rows && Array.isArray(rawMaterialData.rows)) {
        materialCostItems = rawMaterialData.rows;
      }
    } catch {}
  }

  // Golden Master 자재비 컬럼: 공종 | 공사명 | 자재항목 | 단가 | 수량 | 단위 | 합계 | 비고
  const materialHeader: TableCell[] = [
    { text: "공종", width: 55, isHeader: true, align: "center" },
    { text: "공사명", width: 70, isHeader: true, align: "center" },
    { text: "자재항목", width: 90, isHeader: true, align: "center" },
    { text: "단가(원)", width: 70, isHeader: true, align: "center" },
    { text: "수량", width: 50, isHeader: true, align: "center" },
    { text: "단위", width: 40, isHeader: true, align: "center" },
    { text: "합계(원)", width: 80, isHeader: true, align: "center" },
    { text: "비고", width: 60, isHeader: true, align: "center" },
  ];

  const materialRows: TableCell[][] = [materialHeader];
  let materialTotal = 0;

  if (materialCostItems.length > 0) {
    materialCostItems.forEach((row) => {
      // MaterialRow 필드명: 공종, 공사명, 자재항목, 자재, 규격, 단위, 단가, 기준단가
      // 수량m2, 수량EA, 수량, 합계, 금액, 비고
      const qty =
        Number(row["수량"]) ||
        Number(row["수량m2"]) ||
        Number(row.quantity) ||
        1;
      const unitPrice =
        Number(row["단가"]) ||
        Number(row["기준단가"]) ||
        Number(row.unitPrice) ||
        0;
      const amount =
        Number(row["합계"]) ||
        Number(row["금액"]) ||
        Number(row.amount) ||
        qty * unitPrice;
      materialTotal += amount;

      materialRows.push([
        {
          text: row["공종"] || row.workType || row.category || "-",
          width: 55,
          align: "center",
        },
        {
          text: row["공사명"] || row.workName || "-",
          width: 70,
          align: "left",
        },
        {
          text:
            row["자재항목"] ||
            row["자재"] ||
            row.materialItem ||
            row.materialName ||
            "-",
          width: 90,
          align: "left",
        },
        {
          text: unitPrice > 0 ? formatNumber(unitPrice) : "-",
          width: 70,
          align: "right",
        },
        { text: String(qty), width: 50, align: "center" },
        { text: row["단위"] || row.unit || "-", width: 40, align: "center" },
        { text: formatNumber(amount), width: 80, align: "right" },
        { text: row["비고"] || row.note || "-", width: 60, align: "left" },
      ]);
    });
  } else {
    materialRows.push([
      { text: "등록된 자재비 데이터가 없습니다.", width: 515, align: "center" },
    ]);
  }

  // 자재비 소계 행 (전체 너비에 맞춤: 55+70+90+70+50+40+80+60 = 515)
  materialRows.push([
    { text: "자재비 소계", width: 400, isHeader: true, align: "center" },
    { text: formatNumber(materialTotal), width: 115, align: "right" },
  ]);

  // 페이지네이션 적용 자재비 테이블
  const materialResult = drawPaginatedTable(pdfDoc, page, {
    x: MARGIN,
    y,
    rows: materialRows,
    fonts,
    fontSize: 7,
    rowHeight: 16,
    pageBottomY: MARGIN + 80,
    headerRow: materialHeader,
  });
  page = materialResult.page;
  y = materialResult.y;

  y -= 20;

  // 합계/정산 섹션 전 페이지 경계 체크 (약 200px 필요)
  if (y - 200 < MARGIN + 60) {
    page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
    y = A4_HEIGHT - MARGIN;
  }

  // ===== 합계/정산 구간 (Golden Master 양식) =====
  const subtotal = laborTotal + materialTotal;
  const adminFeeRate = 0.06;
  const profitRate = 0.15;
  const vatRate = 0.1;

  // 일반관리비/이윤 계산 기준: 경비가 아닌 항목(includeInEstimate=true) + 자재비
  // field-report.tsx 계산 로직과 동일:
  // baseForFees = laborTotalNonExpense + materialTotal
  const feeBase = laborNonExpenseTotal + materialTotal;
  const adminFee = Math.round(feeBase * adminFeeRate);
  const profit = Math.round(feeBase * profitRate);

  // 디버그 로그: 일반관리비/이윤 계산 확인
  console.log("[PDF 견적서] 일반관리비/이윤 계산:", {
    laborTotal,
    laborNonExpenseTotal,
    materialTotal,
    subtotal,
    feeBase,
    adminFee,
    profit,
    laborItems: laborCostItems.length,
    laborItemsSample: laborCostItems.slice(0, 3).map((r) => ({
      category: r.category,
      amount: r.amount,
      includeInEstimate: r.includeInEstimate,
      includeInEstimateType: typeof r.includeInEstimate,
    })),
  });
  const beforeRounding = subtotal + adminFee + profit;
  // 만원단위 절사 (10000원 단위) - 용어는 '천원단위 절사'로 표시
  const rounded = Math.floor(beforeRounding / 10000) * 10000;
  const roundingDiff = beforeRounding - rounded;
  const vat = Math.round(rounded * vatRate);
  const grandTotal = rounded + vat;

  const totalRows: TableCell[][] = [
    [
      { text: "노무비 합계", width: 150, isHeader: true, align: "center" },
      { text: formatNumber(laborTotal), width: 120, align: "right" },
    ],
    [
      { text: "자재비 합계", width: 150, isHeader: true, align: "center" },
      { text: formatNumber(materialTotal), width: 120, align: "right" },
    ],
    [
      { text: "소계", width: 150, isHeader: true, align: "center" },
      { text: formatNumber(subtotal), width: 120, align: "right" },
    ],
    [
      { text: "일반관리비 (6%)", width: 150, isHeader: true, align: "center" },
      { text: formatNumber(adminFee), width: 120, align: "right" },
    ],
    [
      { text: "이윤 (15%)", width: 150, isHeader: true, align: "center" },
      { text: formatNumber(profit), width: 120, align: "right" },
    ],
    [
      { text: "천원단위 절사", width: 150, isHeader: true, align: "center" },
      {
        text: roundingDiff > 0 ? formatNumber(-roundingDiff) : "0",
        width: 120,
        align: "right",
      },
    ],
    [
      { text: "합계", width: 150, isHeader: true, align: "center" },
      { text: formatNumber(rounded), width: 120, align: "right" },
    ],
    [
      {
        text: "부가세 (10%) - 포함",
        width: 150,
        isHeader: true,
        align: "center",
      },
      { text: formatNumber(vat), width: 120, align: "right" },
    ],
    [
      { text: "총 합계", width: 150, isHeader: true, align: "center" },
      { text: formatNumber(grandTotal), width: 120, align: "right" },
    ],
  ];

  // 단위 표시 (테이블 위에 우측 정렬)
  drawText(page, {
    x: A4_WIDTH - MARGIN - 270,
    y: y + 5,
    text: "단위: 원",
    font: fonts.regular,
    size: 7,
    maxWidth: 266,
    align: "right",
  });

  const totalTableRowHeight = 18;
  const totalTableHeight = totalRows.length * totalTableRowHeight;

  drawTable(page, {
    x: A4_WIDTH - MARGIN - 270,
    y,
    rows: totalRows,
    fonts,
    fontSize: 9,
    rowHeight: totalTableRowHeight,
  });

  // 안내문구 (총합계 테이블 바로 아래) - 가운데 정렬
  const disclaimerY = y - totalTableHeight - 20;
  const disclaimerText =
    "상기 견적은 시공 전 예상금액이며, 현장 상황 및 실제 시공범위에 따라 일부 변동될 수 있습니다.";
  const disclaimerSize = 9;
  const disclaimerWidth = fonts.regular.widthOfTextAtSize(
    disclaimerText,
    disclaimerSize,
  );
  drawText(page, {
    x: (A4_WIDTH - disclaimerWidth) / 2,
    y: disclaimerY,
    text: disclaimerText,
    font: fonts.regular,
    size: disclaimerSize,
    color: { r: 0.8, g: 0.2, b: 0.2 },
  });

  // ===== 하단 문구 및 작성일 =====
  const footerY = MARGIN + 30;

  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;

  // 작성일
  drawText(page, {
    x: MARGIN,
    y: footerY + 10,
    text: `작성일:${dateStr}`,
    font: fonts.regular,
    size: 9,
  });

  // 회사명 (오른쪽)
  drawText(page, {
    x: A4_WIDTH - MARGIN - 80,
    y: footerY + 10,
    text: partnerCompany,
    font: fonts.regular,
    size: 9,
  });
}

function renderErrorPage(
  pdfDoc: PDFDocument,
  fonts: FontSet,
  sectionName: string,
  errorMessage: string,
): void {
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

  page.drawRectangle({
    x: MARGIN,
    y: MARGIN,
    width: CONTENT_WIDTH,
    height: A4_HEIGHT - MARGIN * 2,
    color: rgb(0.99, 0.96, 0.96),
    borderColor: rgb(0.8, 0.3, 0.3),
    borderWidth: 2,
  });

  const centerX = A4_WIDTH / 2;
  const centerY = A4_HEIGHT / 2;

  drawText(page, {
    x: centerX - 60,
    y: centerY + 60,
    text: "⚠ 섹션 생성 오류",
    font: fonts.bold,
    size: 18,
    color: { r: 0.6, g: 0.1, b: 0.1 },
  });

  drawText(page, {
    x: MARGIN + 30,
    y: centerY + 20,
    text: `섹션:${sectionName}`,
    font: fonts.bold,
    size: 14,
    maxWidth: CONTENT_WIDTH - 60,
    align: "center",
  });

  drawText(page, {
    x: MARGIN + 30,
    y: centerY - 20,
    text: errorMessage,
    font: fonts.regular,
    size: 11,
    color: { r: 0.4, g: 0.4, b: 0.4 },
    maxWidth: CONTENT_WIDTH - 60,
    align: "center",
  });

  drawText(page, {
    x: MARGIN + 30,
    y: centerY - 80,
    text: "이 섹션의 생성에 실패하여 안내 페이지로 대체되었습니다.",
    font: fonts.regular,
    size: 10,
    color: { r: 0.5, g: 0.5, b: 0.5 },
    maxWidth: CONTENT_WIDTH - 60,
    align: "center",
  });
}

interface PdfGenerationPayload {
  caseId: string;
  sections: {
    cover: boolean;
    fieldReport: boolean;
    drawing: boolean;
    evidence: boolean;
    estimate: boolean;
    etc: boolean;
  };
  evidence: {
    tab: string;
    selectedFileIds: string[];
  };
  skipEvidence?: boolean; // 본문 PDF에서 증빙 이미지 제외 (이메일 용량 제한용)
  skipPdfAttachments?: boolean; // PDF 첨부 파일 제외 (이미지만 포함, 이메일 용량 제한용)
}

export async function generatePdfWithPdfLib(
  payload: PdfGenerationPayload,
  processingLevel: number = 0,
): Promise<Buffer> {
  const { caseId, sections, evidence, skipEvidence, skipPdfAttachments } =
    payload;
  const processingConfig =
    PROCESSING_LEVELS[processingLevel] || PROCESSING_LEVELS[0];

  console.log(
    `[pdf-lib] PDF 생성 시작 - 레벨 ${processingLevel}: ${processingConfig.maxDimension}px / ${processingConfig.quality}%`,
  );
  if (skipEvidence) {
    console.log("[pdf-lib] skipEvidence=true: 본문 PDF에서 증빙 이미지 제외");
  }

  const [caseData] = await db.select().from(cases).where(eq(cases.id, caseId));
  if (!caseData) {
    throw new Error("케이스를 찾을 수 없습니다.");
  }

  let partnerData: any = null;
  if (caseData.assignedPartner) {
    const trimmedPartnerName = caseData.assignedPartner.trim();
    let partners = await db
      .select()
      .from(users)
      .where(sql`TRIM(${users.company}) = ${trimmedPartnerName}`);

    if (partners.length === 0) {
      partners = await db
        .select()
        .from(users)
        .where(ilike(users.company, `%${trimmedPartnerName}%`));
    }

    if (partners.length === 0 && caseData.assignedPartnerManager) {
      partners = await db
        .select()
        .from(users)
        .where(eq(users.name, caseData.assignedPartnerManager.trim()));
    }

    if (partners.length > 0) {
      partnerData = partners.find((p) => p.role === "협력사") || partners[0];
      console.log(`[pdf-lib] partnerData 조회 결과:`, {
        company: partnerData?.company,
        businessRegistrationNumber: partnerData?.businessRegistrationNumber,
        representativeName: partnerData?.representativeName,
        name: partnerData?.name,
      });
    } else {
      console.log(
        `[pdf-lib] partnerData 조회 실패 - 협력사 정보 없음 (assignedPartner: ${caseData.assignedPartner})`,
      );
    }
  }

  const pdfDoc = await PDFDocument.create();
  let fonts: FontSet;

  try {
    fonts = await embedFonts(pdfDoc);
  } catch (fontError: any) {
    console.error("[pdf-lib] 폰트 로드 실패:", fontError.message);
    const fallbackFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    fonts = { regular: fallbackFont, bold: fallbackFont };
  }

  if (sections.cover) {
    try {
      await renderCoverPage(pdfDoc, fonts, caseData, partnerData);
      console.log("[pdf-lib] 표지 페이지 생성 완료");
    } catch (err: any) {
      console.error("[pdf-lib] 표지 페이지 생성 실패:", err.message);
      renderErrorPage(pdfDoc, fonts, "현장출동확인서 (표지)", err.message);
    }
  }

  if (sections.fieldReport) {
    try {
      let repairItems: any[] = [];
      const estimateList = await db
        .select()
        .from(estimates)
        .where(eq(estimates.caseId, caseId))
        .orderBy(estimates.version);

      if (estimateList.length > 0) {
        const latestEstimate = estimateList[estimateList.length - 1];
        repairItems = await db
          .select()
          .from(estimateRows)
          .where(eq(estimateRows.estimateId, latestEstimate.id))
          .orderBy(estimateRows.rowOrder);
      }

      await renderFieldReportPage(
        pdfDoc,
        fonts,
        caseData,
        partnerData,
        repairItems,
      );
      console.log("[pdf-lib] 출동확인서 페이지 생성 완료");
    } catch (err: any) {
      console.error("[pdf-lib] 출동확인서 페이지 생성 실패:", err.message);
      renderErrorPage(pdfDoc, fonts, "출동확인서", err.message);
    }
  }

  if (sections.drawing) {
    try {
      // Get drawing data for this case
      const [drawingData] = await db
        .select()
        .from(drawings)
        .where(eq(drawings.caseId, caseId));

      await renderDrawingPage(pdfDoc, fonts, caseData, drawingData);
      console.log("[pdf-lib] 도면 페이지 생성 완료");
    } catch (err: any) {
      console.error("[pdf-lib] 도면 페이지 생성 실패:", err.message);
      renderErrorPage(pdfDoc, fonts, "현장 피해상황 도면", err.message);
    }
  }

  if (sections.estimate) {
    try {
      const estimateList = await db
        .select()
        .from(estimates)
        .where(eq(estimates.caseId, caseId))
        .orderBy(estimates.version);

      let estimateData: any = null;
      let estimateRowsData: any[] = [];

      if (estimateList.length > 0) {
        estimateData = estimateList[estimateList.length - 1];
        estimateRowsData = await db
          .select()
          .from(estimateRows)
          .where(eq(estimateRows.estimateId, estimateData.id))
          .orderBy(estimateRows.rowOrder);
      }

      if (estimateRowsData.length > 0) {
        await renderRecoveryAreaPage(pdfDoc, fonts, caseData, estimateRowsData);
        console.log("[pdf-lib] 복구면적 산출표 페이지 생성 완료");
      }

      await renderEstimatePage(
        pdfDoc,
        fonts,
        caseData,
        estimateData,
        estimateRowsData,
        partnerData,
      );
      console.log("[pdf-lib] 견적서 페이지 생성 완료");
    } catch (err: any) {
      console.error("[pdf-lib] 견적서 섹션 생성 실패:", err.message);
      renderErrorPage(pdfDoc, fonts, "견적서", err.message);
    }
  }

  // skipEvidence가 true면 증빙 섹션 스킵 (이메일 용량 제한용)
  if (
    sections.evidence &&
    evidence.selectedFileIds.length > 0 &&
    !skipEvidence
  ) {
    try {
      console.log(
        `[pdf-lib] 증빙자료 조회 - caseId: ${caseId}, selectedFileIds: ${evidence.selectedFileIds.length}개`,
      );

      const selectedDocs = await db
        .select()
        .from(caseDocuments)
        .where(
          and(
            eq(caseDocuments.caseId, caseId),
            inArray(caseDocuments.id, evidence.selectedFileIds),
          ),
        );

      // 디버그 로그: 각 문서의 caseId 확인
      console.log(`[pdf-lib] 조회된 증빙자료 ${selectedDocs.length}개:`);
      selectedDocs.forEach((doc, idx) => {
        console.log(
          `[pdf-lib]   [${idx + 1}] id=${doc.id}, caseId=${doc.caseId}, category=${doc.category}, fileName=${doc.fileName}`,
        );
      });

      // 추가 안전장치: caseId가 다른 문서 제외 (이론상 불필요하지만 확실하게 처리)
      const filteredDocs = selectedDocs.filter((doc) => doc.caseId === caseId);
      if (filteredDocs.length !== selectedDocs.length) {
        console.warn(
          `[pdf-lib] 경고: caseId가 다른 문서 ${selectedDocs.length - filteredDocs.length}개 제외됨!`,
        );
      }

      // 증빙자료 순서 정의 (사진 → 기본자료 → 증빙자료 → 청구자료)
      const CATEGORY_ORDER: string[] = [
        // 사진 (현장사진, 수리중, 복구완료)
        "현장출동사진",
        "현장",
        "현장사진",
        "수리중 사진",
        "수리중",
        "복구완료 사진",
        "복구완료",
        // 기본자료 (보험금청구서, 개인정보동의서)
        "보험금 청구서",
        "개인정보 동의서(가족용)",
        // 증빙자료 (주민등록등본, 등기부등본, 건축물대장, 기타증빙자료)
        "주민등록등본",
        "등기부등본",
        "건축물대장",
        "기타증빙자료(민원일지 등)",
        // 청구자료 (복구완료 및 위임장, 도급계약서, 부가세 청구자료)
        "복구완료 및 위임장",
        "도급계약서",
        "부가세 청구자료",
        "청구",
      ];
      const getCategoryOrder = (category: string): number => {
        const idx = CATEGORY_ORDER.indexOf(category);
        return idx >= 0 ? idx : CATEGORY_ORDER.length;
      };

      // 문서를 카테고리 순서대로 정렬
      const sortedFilteredDocs = [...filteredDocs].sort((a, b) => {
        return getCategoryOrder(a.category) - getCategoryOrder(b.category);
      });

      // skipPdfAttachments=true 면 PDF 제외, 그 외에는 모든 문서 포함
      const docsToProcess = skipPdfAttachments
        ? sortedFilteredDocs.filter((doc) => doc.fileType?.startsWith("image/"))
        : sortedFilteredDocs;

      const imageDocs = docsToProcess.filter((doc) =>
        doc.fileType?.startsWith("image/"),
      );
      const pdfDocs = docsToProcess.filter(
        (doc) =>
          doc.fileType === "application/pdf" ||
          doc.fileName?.toLowerCase().endsWith(".pdf"),
      );

      console.log(
        `[pdf-lib] 선택된 문서: 이미지 ${imageDocs.length}개, PDF ${pdfDocs.length}개 (skipPdfAttachments=${skipPdfAttachments})`,
      );
      if (skipPdfAttachments) {
        console.log(
          "[pdf-lib] skipPdfAttachments=true: PDF 첨부 파일 제외, 이미지만 포함",
        );
      }

      // 카테고리 순서대로 이미지와 PDF를 통합 처리 (renderEvidencePages가 이미 통합 처리 지원)
      if (docsToProcess.length > 0) {
        const { errors } = await renderEvidencePages(
          pdfDoc,
          fonts,
          caseData,
          docsToProcess,
          processingConfig,
        );
        if (errors.length > 0) {
          console.log(
            `[pdf-lib] 증빙자료 처리 중 오류 ${errors.length}개:`,
            errors,
          );
        }
        console.log(
          "[pdf-lib] 증빙자료 페이지 생성 완료 (이미지+PDF 통합 처리)",
        );
      }
    } catch (err: any) {
      console.error("[pdf-lib] 증빙자료 섹션 생성 실패:", err.message);
      renderErrorPage(pdfDoc, fonts, "증빙자료", err.message);
    }
  }

  if (pdfDoc.getPageCount() === 0) {
    const emptyPage = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
    drawText(emptyPage, {
      x: MARGIN,
      y: A4_HEIGHT / 2,
      text: "생성된 콘텐츠가 없습니다.",
      font: fonts.regular,
      size: 14,
      maxWidth: CONTENT_WIDTH,
      align: "center",
    });
  }

  const pdfBytes = await pdfDoc.save();
  console.log(
    `[pdf-lib] PDF 생성 완료 - 크기: ${Math.round(pdfBytes.length / 1024)}KB, 페이지: ${pdfDoc.getPageCount()}`,
  );

  return Buffer.from(pdfBytes);
}

export async function generatePdfWithSizeLimitPdfLib(
  payload: PdfGenerationPayload,
): Promise<Buffer> {
  const totalLevels = PROCESSING_LEVELS.length;

  for (let level = 0; level < totalLevels; level++) {
    const config = PROCESSING_LEVELS[level];
    console.log(
      `[pdf-lib] 레벨 ${level + 1}/${totalLevels}: ${config.maxDimension}px / ${config.quality}%로 PDF 생성 시도`,
    );

    try {
      const pdfBuffer = await generatePdfWithPdfLib(payload, level);
      const sizeInMB = pdfBuffer.length / (1024 * 1024);

      console.log(
        `[pdf-lib] PDF 크기: ${sizeInMB.toFixed(2)}MB (제한: ${MAX_PDF_SIZE_BYTES / (1024 * 1024)}MB)`,
      );

      if (pdfBuffer.length <= MAX_PDF_SIZE_BYTES) {
        console.log(
          `[pdf-lib] 레벨 ${level + 1} 성공 - 크기: ${sizeInMB.toFixed(2)}MB`,
        );
        return pdfBuffer;
      }

      if (level < totalLevels - 1) {
        const nextConfig = PROCESSING_LEVELS[level + 1];
        console.log(
          `[pdf-lib] PDF 크기 초과 - 레벨 ${level + 2} (${nextConfig.maxDimension}px/${nextConfig.quality}%)로 재시도`,
        );
      }
    } catch (err: any) {
      console.error(`[pdf-lib] 레벨 ${level + 1} 생성 실패:`, err.message);
      if (level < totalLevels - 1) {
        console.log(`[pdf-lib] 다음 레벨로 재시도...`);
        continue;
      }
    }
  }

  const lastLevel = totalLevels - 1;
  const lastConfig = PROCESSING_LEVELS[lastLevel];
  console.warn(
    `[pdf-lib] 최저 레벨 (${lastConfig.maxDimension}px/${lastConfig.quality}%)로도 10MB 초과 - 마지막 결과 반환`,
  );

  try {
    return await generatePdfWithPdfLib(payload, lastLevel);
  } catch (err: any) {
    console.error(`[pdf-lib] 최종 생성 실패:`, err.message);
    const emptyPdf = await PDFDocument.create();
    emptyPdf.addPage();
    return Buffer.from(await emptyPdf.save());
  }
}

// ========================================================
// 탭별 증빙 PDF 생성 (이메일 용량 제한용)
// ========================================================

const TAB_NAMES = ["현장사진", "기본자료", "증빙자료", "청구자료"] as const;
type TabName = (typeof TAB_NAMES)[number];

const CATEGORY_TO_TAB: Record<string, TabName> = {
  현장출동사진: "현장사진",
  현장: "현장사진",
  "수리중 사진": "현장사진",
  수리중: "현장사진",
  "복구완료 사진": "현장사진",
  복구완료: "현장사진",
  "보험금 청구서": "기본자료",
  "개인정보 동의서(가족용)": "기본자료",
  주민등록등본: "증빙자료",
  등기부등본: "증빙자료",
  건축물대장: "증빙자료",
  "기타증빙자료(민원일지 등)": "증빙자료",
  "복구완료 및 위임장": "청구자료",
  도급계약서: "청구자료",
  "부가세 청구자료": "청구자료",
  청구: "청구자료",
};

const MAX_EVIDENCE_PDF_SIZE_BYTES = 8 * 1024 * 1024; // 8MB 제한

interface EvidencePdfResult {
  tabName: string;
  fileName: string;
  buffer: Buffer;
  pageCount: number;
  imageCount: number;
}

// 단계적 압축으로 이미지를 PDF에 추가할 버퍼로 변환
async function compressImageForPdf(
  imageData: Buffer,
  targetMaxBytes: number = 500 * 1024, // 기본 500KB 목표
): Promise<{ buffer: Buffer; format: "jpeg" | "png" }> {
  const levels = [
    { maxDimension: 1600, quality: 60 },
    { maxDimension: 1400, quality: 50 },
    { maxDimension: 1200, quality: 40 },
    { maxDimension: 1000, quality: 30 },
    { maxDimension: 800, quality: 25 },
    { maxDimension: 700, quality: 20 },
  ];

  for (const level of levels) {
    try {
      const compressed = await sharp(imageData)
        .resize(level.maxDimension, level.maxDimension, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: level.quality })
        .toBuffer();

      if (compressed.length <= targetMaxBytes) {
        return { buffer: compressed, format: "jpeg" };
      }
    } catch (err) {
      continue;
    }
  }

  // 최저 레벨로도 안되면 마지막 결과 반환
  try {
    const lastLevel = levels[levels.length - 1];
    const compressed = await sharp(imageData)
      .resize(lastLevel.maxDimension, lastLevel.maxDimension, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: lastLevel.quality })
      .toBuffer();
    return { buffer: compressed, format: "jpeg" };
  } catch (err) {
    // 변환 실패 시 원본 반환 시도
    return { buffer: imageData, format: "jpeg" };
  }
}

// Object Storage 또는 fileData에서 이미지 Buffer 가져오기
async function getImageBuffer(doc: {
  id?: string;
  fileData?: string | null;
  storageKey?: string | null;
}): Promise<Buffer | null> {
  try {
    // 1. Object Storage에서 가져오기 (우선)
    if (doc.storageKey) {
      console.log(
        `[pdf-lib] Object Storage에서 이미지 로드: ${doc.storageKey}`,
      );
      // PRIVATE_OBJECT_DIR을 앞에 붙여서 전체 경 �� 생성
      const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
      if (!privateObjectDir) {
        console.error("[pdf-lib] PRIVATE_OBJECT_DIR이 설정되지 않음");
        return null;
      }
      const fullPath = `${privateObjectDir}/${doc.storageKey}`;
      console.log(`[pdf-lib] 전체 경로: ${fullPath}`);
      const buffer = await objectStorage.downloadToBuffer(fullPath);
      return buffer;
    }

    // 2. fileData에서 가져오기 (레거시)
    if (doc.fileData) {
      if (doc.fileData.startsWith("data:")) {
        const base64Data = doc.fileData.split(",")[1];
        return Buffer.from(base64Data, "base64");
      } else {
        return Buffer.from(doc.fileData, "base64");
      }
    }

    // 3. fileData가 없으면 DB에서 직접 가져오기 (레거시 파일 지원)
    if (doc.id) {
      console.log(`[pdf-lib] DB에서 레거시 이미지 로드: ${doc.id}`);
      const { storage } = await import("./storage");
      const fileData = await storage.getDocumentFileData(doc.id);
      if (fileData) {
        if (fileData.startsWith("data:")) {
          const base64Data = fileData.split(",")[1];
          return Buffer.from(base64Data, "base64");
        } else {
          return Buffer.from(fileData, "base64");
        }
      }
    }

    return null;
  } catch (error) {
    console.error("[pdf-lib] 이미지 로드 실패:", error);
    return null;
  }
}

// 단일 탭의 증빙 PDF 생성 (8MB 초과 시 분할)
async function generateSingleTabEvidencePdf(
  tabName: string,
  documents: Array<{
    id: string;
    fileName: string;
    fileType: string;
    fileData?: string | null;
    storageKey?: string | null;
    category: string;
  }>,
  caseData: any,
  fonts: FontSet,
  accidentNo: string,
): Promise<EvidencePdfResult[]> {
  const results: EvidencePdfResult[] = [];

  if (documents.length === 0) {
    return results;
  }

  console.log(
    `[pdf-lib] 탭 "${tabName}" 증빙 PDF 생성 시작 - ${documents.length}개 이미지`,
  );

  let currentPdfDoc = await PDFDocument.create();
  currentPdfDoc.registerFontkit(fontkit);
  let currentFonts = await embedFonts(currentPdfDoc);

  let currentPartIndex = 1;
  let currentImageCount = 0;
  let estimatedSize = 0;

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];

    try {
      // Object Storage 또는 fileData에서 이미지 로드
      const imageData = await getImageBuffer(doc);
      if (!imageData) {
        console.warn(`[pdf-lib] 이미지 데이터 없음: ${doc.fileName}`);
        continue;
      }

      // 이미지 압축
      const { buffer: compressedBuffer, format } =
        await compressImageForPdf(imageData);

      // 현재 PDF 크기 체크 (예상치 - 이미지 + 텍스트 오버헤드)
      const estimatedImageSize = compressedBuffer.length + 5000; // 5KB 오버헤드

      // 8MB 초과 예상 시 현재 PDF 저장하고 새 PDF 시작
      if (
        estimatedSize + estimatedImageSize > MAX_EVIDENCE_PDF_SIZE_BYTES &&
        currentImageCount > 0
      ) {
        // 현재 PDF 저장
        const pdfBytes = await currentPdfDoc.save();
        const partSuffix = currentPartIndex > 1 ? `_${currentPartIndex}` : "";
        results.push({
          tabName,
          fileName: `Evidence_${tabName}${partSuffix}.pdf`,
          buffer: Buffer.from(pdfBytes),
          pageCount: currentPdfDoc.getPageCount(),
          imageCount: currentImageCount,
        });

        console.log(
          `[pdf-lib] 탭 "${tabName}" 파트 ${currentPartIndex} 완료 - ${currentImageCount}개 이미지, ${Math.round(pdfBytes.length / 1024)}KB`,
        );

        // 새 PDF 시작 (폰트도 새 문서에 재할당)
        currentPdfDoc = await PDFDocument.create();
        currentPdfDoc.registerFontkit(fontkit);
        currentFonts = await embedFonts(currentPdfDoc);
        currentPartIndex++;
        currentImageCount = 0;
        estimatedSize = 0;
      }

      // 페이지 추가
      const page = currentPdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

      // 헤더
      const headerHeight = 25;
      page.drawRectangle({
        x: MARGIN,
        y: A4_HEIGHT - MARGIN - headerHeight,
        width: CONTENT_WIDTH,
        height: headerHeight,
        color: rgb(0.95, 0.95, 0.95),
      });

      drawText(page, {
        x: MARGIN + 10,
        y: A4_HEIGHT - MARGIN - 17,
        text: `[${tabName}] ${doc.category || "증빙자료"} - ${doc.fileName}`,
        font: currentFonts.bold,
        size: 10,
        maxWidth: CONTENT_WIDTH - 20,
      });

      // 이미지 영역
      const imageAreaTop = A4_HEIGHT - MARGIN - headerHeight - 15;
      const imageAreaHeight = imageAreaTop - MARGIN - 30;

      // 이미지 삽입
      const embeddedImage =
        format === "png"
          ? await currentPdfDoc.embedPng(compressedBuffer)
          : await currentPdfDoc.embedJpg(compressedBuffer);

      const imgDims = embeddedImage.scale(1);
      const maxWidth = CONTENT_WIDTH - 20;
      const maxHeight = imageAreaHeight - 20;

      const scaleX = maxWidth / imgDims.width;
      const scaleY = maxHeight / imgDims.height;
      const scale = Math.min(scaleX, scaleY, 1);

      const drawWidth = imgDims.width * scale;
      const drawHeight = imgDims.height * scale;

      const drawX = MARGIN + (CONTENT_WIDTH - drawWidth) / 2;
      const drawY = MARGIN + 30 + (imageAreaHeight - drawHeight) / 2;

      page.drawImage(embeddedImage, {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight,
      });

      // 푸터
      // 특수기호 뒤 공백 제거
      const cleanedAccidentNo = accidentNo
        .replace(/-\s+/g, "-")
        .replace(/:\s+/g, ":");
      drawText(page, {
        x: MARGIN,
        y: MARGIN + 10,
        text: `사고접수번호:${cleanedAccidentNo} | ${i + 1}/${documents.length}`,
        font: currentFonts.regular,
        size: 8,
        color: { r: 0.5, g: 0.5, b: 0.5 },
      });

      currentImageCount++;
      estimatedSize += estimatedImageSize;
    } catch (err: any) {
      console.error(
        `[pdf-lib] 이미지 처리 실패 (${doc.fileName}):`,
        err.message,
      );
    }
  }

  // 마지막 PDF 저장
  if (currentImageCount > 0) {
    const pdfBytes = await currentPdfDoc.save();
    const partSuffix = currentPartIndex > 1 ? `_${currentPartIndex}` : "";
    results.push({
      tabName,
      fileName: `Evidence_${tabName}${partSuffix}.pdf`,
      buffer: Buffer.from(pdfBytes),
      pageCount: currentPdfDoc.getPageCount(),
      imageCount: currentImageCount,
    });

    console.log(
      `[pdf-lib] 탭 "${tabName}" 파트 ${currentPartIndex} 완료 - ${currentImageCount}개 이미지, ${Math.round(pdfBytes.length / 1024)}KB`,
    );
  }

  return results;
}

// 탭별 증빙 PDF 생성 메인 함수
export async function generateEvidencePDFsByTab(
  caseId: string,
  selectedFileIds: string[],
): Promise<EvidencePdfResult[]> {
  console.log(`[pdf-lib] ===== 탭별 증빙 PDF 생성 시작 =====`);
  console.log(
    `[pdf-lib] 케이스: ${caseId}, 선택된 파일: ${selectedFileIds.length}개`,
  );

  if (selectedFileIds.length === 0) {
    console.log("[pdf-lib] 선택된 파일 없음");
    return [];
  }

  // 케이스 정보
  const [caseData] = await db.select().from(cases).where(eq(cases.id, caseId));
  if (!caseData) {
    throw new Error("케이스를 찾을 수 없습니다.");
  }

  const accidentNo =
    caseData.insuranceAccidentNo ||
    caseData.insurancePolicyNo ||
    caseData.caseNumber ||
    "UNKNOWN";

  // 선택된 문서 조회
  const selectedDocs = await db
    .select()
    .from(caseDocuments)
    .where(
      and(
        eq(caseDocuments.caseId, caseId),
        inArray(caseDocuments.id, selectedFileIds),
      ),
    );

  // 이미지만 필터링
  const imageDocs = selectedDocs.filter((doc) =>
    doc.fileType?.startsWith("image/"),
  );
  console.log(`[pdf-lib] 이미지 문서: ${imageDocs.length}개`);

  // 탭 내 카테고리 순서 정의
  const CATEGORY_ORDER_WITHIN_TAB: Record<TabName, string[]> = {
    현장사진: [
      "현장출동사진",
      "현장",
      "현장사진",
      "수리중 사진",
      "수리중",
      "복구완료 사진",
      "복구완료",
    ],
    기본자료: ["보험금 청구서", "개인정보 동의서(가족용)"],
    증빙자료: [
      "주민등록등본",
      "등기부등본",
      "건축물대장",
      "기타증빙자료(민원일지 등)",
    ],
    청구자료: [
      "복구완료 및 위임장",
      "도급계약서",
      "부가세 청구자료",
      "청구",
    ],
  };

  // 탭별로 분류
  const docsByTab: Record<TabName, typeof imageDocs> = {
    현장사진: [],
    기본자료: [],
    증빙자료: [],
    청구자료: [],
  };

  for (const doc of imageDocs) {
    const tab = CATEGORY_TO_TAB[doc.category] || "현장사진"; // 기본값
    docsByTab[tab].push(doc);
  }

  // 각 탭 내 문서를 카테고리 순서대로 정렬
  for (const tabName of TAB_NAMES) {
    const categoryOrder = CATEGORY_ORDER_WITHIN_TAB[tabName];
    docsByTab[tabName].sort((a, b) => {
      const aIdx = categoryOrder.indexOf(a.category);
      const bIdx = categoryOrder.indexOf(b.category);
      return (
        (aIdx >= 0 ? aIdx : categoryOrder.length) -
        (bIdx >= 0 ? bIdx : categoryOrder.length)
      );
    });
  }

  // 폰트 로드
  const fontBytes = loadFontBytes();
  const tempPdfDoc = await PDFDocument.create();
  tempPdfDoc.registerFontkit(fontkit);
  const fonts = await embedFonts(tempPdfDoc);

  // 각 탭별 PDF 생성
  const allResults: EvidencePdfResult[] = [];

  for (const tabName of TAB_NAMES) {
    const tabDocs = docsByTab[tabName];
    if (tabDocs.length === 0) continue;

    const tabResults = await generateSingleTabEvidencePdf(
      tabName,
      tabDocs,
      caseData,
      fonts,
      accidentNo,
    );

    allResults.push(...tabResults);
  }

  console.log(
    `[pdf-lib] ===== 탭별 증빙 PDF 생성 완료: ${allResults.length}개 파일 =====`,
  );
  for (const result of allResults) {
    console.log(
      `[pdf-lib]   - ${result.fileName}: ${Math.round(result.buffer.length / 1024)}KB, ${result.imageCount}개 이미지, ${result.pageCount}페이지`,
    );
  }

  return allResults;
}
