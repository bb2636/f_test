// PDF 생성 동시성 제어 큐
// [지연/안정성 개선 2026-05-07] PDF 생성은 큰 이미지 압축으로 메모리/CPU 부하가 큼.
// 동시에 여러 개가 돌면 메모리 압박으로 빈 PDF/생성 실패 발생 가능.
// 모든 PDF 생성 호출을 이 큐로 통과시켜 한 번에 1개만 처리(직렬화) → 빈 PDF 버그 차단.
type Task<T> = () => Promise<T>;

class PdfQueue {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private concurrency: number = 1) {}

  async run<T>(task: Task<T>, label?: string): Promise<T> {
    await this.acquire(label);
    const start = Date.now();
    try {
      return await task();
    } finally {
      const elapsed = Date.now() - start;
      this.release();
      console.log(
        `[PdfQueue] ${label || "task"} done in ${elapsed}ms (active=${this.active}, waiting=${this.waiters.length})`,
      );
    }
  }

  private acquire(label?: string): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      if (label)
        console.log(
          `[PdfQueue] ${label} started immediately (active=${this.active})`,
        );
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const queueLen = this.waiters.length + 1;
      if (label)
        console.log(
          `[PdfQueue] ${label} queued (waiting=${queueLen})`,
        );
      this.waiters.push(() => {
        this.active++;
        if (label)
          console.log(
            `[PdfQueue] ${label} starting after wait (active=${this.active})`,
          );
        resolve();
      });
    });
  }

  private release() {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }

  getStatus() {
    return { active: this.active, waiting: this.waiters.length };
  }
}

// 전역 단일 큐 (concurrency=1: 한 번에 1개씩 직렬 처리)
export const pdfQueue = new PdfQueue(1);
