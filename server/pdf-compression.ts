import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

interface CompressionResult {
  success: boolean;
  compressedBuffer?: Buffer;
  originalSize: number;
  compressedSize?: number;
  compressionRatio?: number;
  error?: string;
}

const PDF_SIZE_THRESHOLD = 2 * 1024 * 1024; // 2MB 이상일 때만 압축
const MAX_PDF_SIZE = 15 * 1024 * 1024; // 15MB 이상은 거부
const EMAIL_TARGET_SIZE = 7 * 1024 * 1024; // 이메일 첨부용 7MB 타겟 (base64 인코딩 시 ~9.3MB)

export async function compressPdf(inputBuffer: Buffer): Promise<CompressionResult> {
  const originalSize = inputBuffer.length;
  
  // 2MB 미만은 압축 불필요
  if (originalSize < PDF_SIZE_THRESHOLD) {
    console.log(`[pdf-compress] 파일 크기 ${(originalSize / 1024 / 1024).toFixed(2)}MB - 압축 불필요`);
    return {
      success: true,
      compressedBuffer: inputBuffer,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 100,
    };
  }
  
  // 15MB 초과는 거부
  if (originalSize > MAX_PDF_SIZE) {
    console.log(`[pdf-compress] 파일 크기 ${(originalSize / 1024 / 1024).toFixed(2)}MB - 최대 크기 초과`);
    return {
      success: false,
      originalSize,
      error: `PDF 파일이 너무 큽니다 (${(originalSize / 1024 / 1024).toFixed(1)}MB). 최대 15MB까지 업로드 가능합니다.`,
    };
  }
  
  const tempDir = os.tmpdir();
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const inputPath = path.join(tempDir, `input_${uniqueId}.pdf`);
  const outputPath = path.join(tempDir, `output_${uniqueId}.pdf`);
  
  try {
    // 임시 파일에 PDF 저장
    fs.writeFileSync(inputPath, inputBuffer);
    
    console.log(`[pdf-compress] Ghostscript 압축 시작: ${(originalSize / 1024 / 1024).toFixed(2)}MB`);
    
    // Ghostscript로 PDF 압축 (ebook 품질 - 중간 수준 압축)
    const gsCommand = [
      'gs',
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      '-dPDFSETTINGS=/ebook',  // /screen(최저) /ebook(중간) /printer(고품질)
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      // 폰트 보존 옵션 - 압축 시 글자 깨짐 방지
      '-dEmbedAllFonts=true',
      '-dSubsetFonts=false',
      '-dCompressFonts=true',
      // 이미지 압축 옵션
      '-dColorImageResolution=150',
      '-dGrayImageResolution=150',
      '-dMonoImageResolution=150',
      `-sOutputFile=${outputPath}`,
      inputPath,
    ];
    
    await new Promise<void>((resolve, reject) => {
      const gs = spawn(gsCommand[0], gsCommand.slice(1), {
        timeout: 60000, // 60초 타임아웃
      });
      
      let stderr = '';
      gs.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      gs.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Ghostscript failed with code ${code}: ${stderr}`));
        }
      });
      
      gs.on('error', (err) => {
        reject(err);
      });
    });
    
    // 압축된 파일 읽기
    if (!fs.existsSync(outputPath)) {
      throw new Error('압축된 PDF 파일이 생성되지 않았습니다');
    }
    
    const compressedBuffer = fs.readFileSync(outputPath);
    const compressedSize = compressedBuffer.length;
    const compressionRatio = Math.round((compressedSize / originalSize) * 100);
    
    console.log(`[pdf-compress] 압축 완료: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressedSize / 1024 / 1024).toFixed(2)}MB (${compressionRatio}%)`);
    
    // 압축된 파일이 더 작으면 압축 버전 사용, 아니면 원본 사용
    if (compressedSize < originalSize) {
      return {
        success: true,
        compressedBuffer,
        originalSize,
        compressedSize,
        compressionRatio,
      };
    } else {
      console.log(`[pdf-compress] 압축 효과 없음 - 원본 사용`);
      return {
        success: true,
        compressedBuffer: inputBuffer,
        originalSize,
        compressedSize: originalSize,
        compressionRatio: 100,
      };
    }
  } catch (error) {
    console.error('[pdf-compress] 압축 오류:', error);
    
    // 압축 실패 시 원본 반환 (오류로 중단하지 않음)
    return {
      success: true,
      compressedBuffer: inputBuffer,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 100,
      error: `압축 실패 (원본 사용): ${(error as Error).message}`,
    };
  } finally {
    // 임시 파일 정리
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch (cleanupError) {
      console.warn('[pdf-compress] 임시 파일 정리 실패:', cleanupError);
    }
  }
}

export function isPdfFile(fileType: string | undefined, fileName: string | undefined): boolean {
  if (fileType === 'application/pdf') return true;
  if (fileName?.toLowerCase().endsWith('.pdf')) return true;
  return false;
}

// 단계적 압축 설정 (ebook → screen)
const COMPRESSION_PRESETS = [
  { name: 'ebook', settings: '/ebook', dpi: 150 },
  { name: 'screen', settings: '/screen', dpi: 72 },
] as const;

/**
 * PDF를 목표 크기 이하로 압축하는 함수
 * 단계적으로 더 강력한 압축을 적용하여 타겟 크기까지 줄임
 */
export async function compressPdfToTarget(
  inputBuffer: Buffer, 
  targetSizeBytes: number = EMAIL_TARGET_SIZE
): Promise<CompressionResult> {
  const originalSize = inputBuffer.length;
  
  // 이미 타겟 크기 이하면 압축 불필요
  if (originalSize <= targetSizeBytes) {
    console.log(`[pdf-compress-target] 파일 크기 ${(originalSize / 1024 / 1024).toFixed(2)}MB - 타겟 ${(targetSizeBytes / 1024 / 1024).toFixed(1)}MB 이하, 압축 불필요`);
    return {
      success: true,
      compressedBuffer: inputBuffer,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 100,
    };
  }
  
  console.log(`[pdf-compress-target] 압축 시작: ${(originalSize / 1024 / 1024).toFixed(2)}MB → 타겟 ${(targetSizeBytes / 1024 / 1024).toFixed(1)}MB`);
  
  let currentBuffer = inputBuffer;
  let currentSize = originalSize;
  
  // 단계적으로 더 강력한 압축 적용
  for (const preset of COMPRESSION_PRESETS) {
    if (currentSize <= targetSizeBytes) {
      break; // 이미 목표 달성
    }
    
    console.log(`[pdf-compress-target] ${preset.name} 압축 시도 (${preset.settings}, ${preset.dpi}dpi)`);
    
    const tempDir = os.tmpdir();
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const inputPath = path.join(tempDir, `input_${uniqueId}.pdf`);
    const outputPath = path.join(tempDir, `output_${uniqueId}.pdf`);
    
    try {
      fs.writeFileSync(inputPath, currentBuffer);
      
      const gsCommand = [
        'gs',
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        `-dPDFSETTINGS=${preset.settings}`,
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        // 폰트 보존 옵션 - 압축 시 글자 깨짐 방지
        '-dEmbedAllFonts=true',
        '-dSubsetFonts=false',
        '-dCompressFonts=true',
        // 이미지 압축 옵션
        `-dColorImageResolution=${preset.dpi}`,
        `-dGrayImageResolution=${preset.dpi}`,
        `-dMonoImageResolution=${preset.dpi}`,
        '-dDownsampleColorImages=true',
        '-dDownsampleGrayImages=true',
        '-dDownsampleMonoImages=true',
        `-sOutputFile=${outputPath}`,
        inputPath,
      ];
      
      await new Promise<void>((resolve, reject) => {
        const gs = spawn(gsCommand[0], gsCommand.slice(1), {
          timeout: 120000, // 2분 타임아웃
        });
        
        let stderr = '';
        gs.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        gs.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Ghostscript failed with code ${code}: ${stderr}`));
          }
        });
        
        gs.on('error', (err) => {
          reject(err);
        });
      });
      
      if (fs.existsSync(outputPath)) {
        const compressedBuffer = fs.readFileSync(outputPath);
        const compressedSize = compressedBuffer.length;
        
        console.log(`[pdf-compress-target] ${preset.name}: ${(currentSize / 1024 / 1024).toFixed(2)}MB → ${(compressedSize / 1024 / 1024).toFixed(2)}MB`);
        
        // 압축이 효과가 있으면 결과 사용
        if (compressedSize < currentSize) {
          currentBuffer = compressedBuffer;
          currentSize = compressedSize;
        }
      }
    } catch (error) {
      console.error(`[pdf-compress-target] ${preset.name} 압축 실패:`, error);
    } finally {
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (cleanupError) {
        console.warn('[pdf-compress-target] 임시 파일 정리 실패:', cleanupError);
      }
    }
  }
  
  const compressionRatio = Math.round((currentSize / originalSize) * 100);
  console.log(`[pdf-compress-target] 최종 결과: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(currentSize / 1024 / 1024).toFixed(2)}MB (${compressionRatio}%)`);
  
  // 타겟 크기를 초과하면 경고
  if (currentSize > targetSizeBytes) {
    console.warn(`[pdf-compress-target] 경고: 목표 크기 미달성 (${(currentSize / 1024 / 1024).toFixed(2)}MB > ${(targetSizeBytes / 1024 / 1024).toFixed(1)}MB)`);
  }
  
  return {
    success: true,
    compressedBuffer: currentBuffer,
    originalSize,
    compressedSize: currentSize,
    compressionRatio,
  };
}

/**
 * 이메일 첨부용 PDF 압축 (7MB 타겟)
 */
export async function compressPdfForEmail(inputBuffer: Buffer): Promise<Buffer> {
  const result = await compressPdfToTarget(inputBuffer, EMAIL_TARGET_SIZE);
  return result.compressedBuffer || inputBuffer;
}
