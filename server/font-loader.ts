import fs from "fs";
import path from "path";

const FONTS_DIR = path.join(process.cwd(), "server/fonts");

const FONT_FILES = {
  regular: "Pretendard-Regular.ttf",
  semiBold: "Pretendard-SemiBold.ttf",
} as const;

interface FontBufferCache {
  regular: Buffer | null;
  semiBold: Buffer | null;
  regularSize: number;
  semiBoldSize: number;
}

const fontBufferCache: FontBufferCache = {
  regular: null,
  semiBold: null,
  regularSize: 0,
  semiBoldSize: 0,
};

function validateTtfBuffer(buffer: Buffer, label: string): void {
  const firstChars = buffer.slice(0, 10).toString("utf8");
  if (firstChars.includes("<!") || firstChars.includes("<html")) {
    throw new Error(
      `${label} 폰트 파일이 HTML/에러 페이지입니다. 첫 10자: ${firstChars}`,
    );
  }

  const signature = buffer.slice(0, 4).toString("hex");
  if (signature !== "00010000") {
    throw new Error(
      `${label} 폰트가 TTF 형식이 아닙니다. 시그니처: ${signature} (예상: 00010000)`,
    );
  }
}

function loadSingleFont(
  fileName: string,
  label: string,
  cached: Buffer | null,
  cachedSize: number,
): { buffer: Buffer; size: number } {
  const fontPath = path.join(FONTS_DIR, fileName);

  if (!fs.existsSync(fontPath)) {
    throw new Error(`${fileName}를 찾을 수 없습니다: ${fontPath}`);
  }

  const stat = fs.statSync(fontPath);

  if (cached && cached.length === stat.size && cachedSize === stat.size) {
    return { buffer: cached, size: stat.size };
  }

  const buffer = fs.readFileSync(fontPath);
  validateTtfBuffer(buffer, label);

  console.log(
    `[font-loader] ${label} 로드 완료 (${(stat.size / 1024 / 1024).toFixed(2)}MB)`,
  );

  return { buffer, size: stat.size };
}

export function loadPretendardRegular(): Buffer {
  const result = loadSingleFont(
    FONT_FILES.regular,
    "Pretendard-Regular",
    fontBufferCache.regular,
    fontBufferCache.regularSize,
  );
  fontBufferCache.regular = result.buffer;
  fontBufferCache.regularSize = result.size;
  return result.buffer;
}

export function loadPretendardSemiBold(): Buffer {
  const result = loadSingleFont(
    FONT_FILES.semiBold,
    "Pretendard-SemiBold",
    fontBufferCache.semiBold,
    fontBufferCache.semiBoldSize,
  );
  fontBufferCache.semiBold = result.buffer;
  fontBufferCache.semiBoldSize = result.size;
  return result.buffer;
}

export function loadPretendardFontPair(): { regular: Buffer; bold: Buffer } {
  return {
    regular: loadPretendardRegular(),
    bold: loadPretendardSemiBold(),
  };
}
