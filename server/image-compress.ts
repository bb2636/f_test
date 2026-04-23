import sharp from "sharp";

const PDF_IMAGE_MAX_DIMENSION = 2000;
const PDF_IMAGE_JPEG_QUALITY = 80;
const PDF_IMAGE_MIN_COMPRESS_BYTES = 200 * 1024;

export async function compressJpegBufferForPdf(
  buffer: Buffer | Uint8Array,
): Promise<Buffer> {
  const inputBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!inputBuffer || inputBuffer.length === 0) return inputBuffer;
  if (inputBuffer.length < PDF_IMAGE_MIN_COMPRESS_BYTES) return inputBuffer;

  try {
    const compressed = await sharp(inputBuffer, { failOnError: false })
      .rotate()
      .resize(PDF_IMAGE_MAX_DIMENSION, PDF_IMAGE_MAX_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: PDF_IMAGE_JPEG_QUALITY, mozjpeg: true, force: true })
      .toBuffer();

    if (compressed.length >= inputBuffer.length) {
      return inputBuffer;
    }

    return compressed;
  } catch (err) {
    console.warn(
      "[image-compress] sharp 압축 실패, 원본 사용:",
      (err as any)?.message ?? err,
    );
    return inputBuffer;
  }
}
