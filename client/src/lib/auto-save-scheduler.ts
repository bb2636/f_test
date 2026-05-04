/**
 * [Task #11 / Task #12] 자동 저장 스케줄러
 *
 * field-estimate.tsx의 `triggerAutoSaveAfterSync` 로직을 React 외부에서도
 * 단위 테스트 가능한 순수 모듈로 추출한 것이다. 동작은 기존 코드와 1:1로 동일하며,
 * 의존성(가드/해시/저장 함수)은 모두 호출자가 주입한다.
 *
 * 호출자는 매 렌더에서 `updateDeps`로 최신 의존성을 갱신해도 되고, 클로저로
 * latest ref를 캡쳐해도 된다 (테스트는 클로저 캡쳐 방식으로 검증).
 *
 * ─ 핵심 동작 (변경 없이 보존) ─
 *  1) 협력업체 세션은 즉시 차단 (skip 로그).
 *  2) readOnly / 케이스 미선택 / 미수화 / 저장 진행 중이면 조용히 skip.
 *  3) 디바운스 비어있을 때만 baseline hash 캡쳐 (architect 1차 리뷰의
 *     "디바운스 윈도우 내 baseline 덮어쓰기" 결함 방지).
 *  4) 디바운스 reset은 매 trigger마다 수행 → 마지막 trigger 기준 1500ms.
 *  5) 디바운스 만료 시 latest hash와 baseline 비교 → 동일하면 no-op skip.
 *  6) 가드 검증(⑧/⑩/⑪) 실패 시 자동 저장 차단.
 *  7) 모두 통과 시 `onPerformSave` 호출.
 */

export interface AutoSaveSchedulerLogger {
  log: (msg: string) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

export interface AutoSaveValidationResult {
  ok: boolean;
  violations: string[];
}

export interface AutoSaveSchedulerDeps {
  /** true이면 협력업체 세션이거나 currentUser 미로딩 상태 — 즉시 차단 + 로그 */
  isPartnerSession: () => boolean;
  /** false이면 (readOnly / no caseId / not hydrated / save pending 등) 조용히 skip */
  isEligible: () => boolean;
  /** 자동 저장 변경 감지용 hash. 디바운스 시작 시점과 만료 시점에 호출. */
  computeHash: () => string;
  /** 위험 ⑧/⑩/⑪ 가드 검증 (선행 task에서 이미 구현됨) */
  validateGuards: () => AutoSaveValidationResult;
  /** 가드까지 모두 통과하면 호출되는 실제 저장 액션 */
  onPerformSave: () => void;
}

export interface AutoSaveSchedulerOptions {
  debounceMs?: number;
  setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  logger?: AutoSaveSchedulerLogger;
}

export interface AutoSaveScheduler {
  trigger: (reason: string) => void;
  cancel: () => void;
  isPending: () => boolean;
}

const DEFAULT_DEBOUNCE_MS = 1500;

export function createAutoSaveScheduler(
  deps: AutoSaveSchedulerDeps,
  options: AutoSaveSchedulerOptions = {},
): AutoSaveScheduler {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const setTimeoutFn =
    options.setTimeoutFn ??
    ((handler: () => void, ms: number) => setTimeout(handler, ms) as unknown);
  const clearTimeoutFn =
    options.clearTimeoutFn ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const logger: AutoSaveSchedulerLogger = options.logger ?? {
    log: (msg) => console.log(msg),
    error: (msg, ...args) => console.error(msg, ...args),
  };

  let debounceHandle: unknown = null;
  let baseline: { hash: string; reason: string } | null = null;

  const cancel = () => {
    if (debounceHandle !== null) {
      clearTimeoutFn(debounceHandle);
      debounceHandle = null;
    }
    baseline = null;
  };

  const trigger = (reason: string) => {
    // [원본보존] 협력업체 세션은 어떤 경로로 호출되더라도 즉시 차단
    if (deps.isPartnerSession()) {
      logger.log(`[AUTO-SAVE SKIP] Partner role (사유: ${reason})`);
      return;
    }
    // readOnly / 케이스 미선택 / 미수화 / 저장 진행 중 등은 조용히 skip
    if (!deps.isEligible()) return;

    // [Task #11] baseline은 "디바운스 윈도우 시작 시점"에만 캡쳐.
    //   디바운스가 비어있을 때만 baseline 캡쳐 → 윈도우 안에서 Trigger A(실 변경)
    //   후 Trigger B(no-op)가 와도 baseline이 A 이전 상태로 보존되어
    //   누적 변경이 정확히 감지된다 (architect 1차 리뷰 반영).
    if (debounceHandle === null) {
      baseline = { hash: deps.computeHash(), reason };
    } else {
      clearTimeoutFn(debounceHandle);
    }

    debounceHandle = setTimeoutFn(() => {
      debounceHandle = null;
      // 만료 직전 다시 한 번 진행 가능 여부 확인 (저장 중복 방지 등)
      if (!deps.isEligible()) {
        baseline = null;
        return;
      }
      const baselineSnapshot = baseline;
      baseline = null;
      const baselineReason = baselineSnapshot?.reason ?? reason;

      // [Task #11] 1단계 변경 감지: latest hash와 baseline 비교
      if (baselineSnapshot) {
        const currentHash = deps.computeHash();
        if (currentHash === baselineSnapshot.hash) {
          logger.log(
            `[AUTO-SAVE SKIP] no-op sync (변경 없음, 시작 사유: ${baselineReason}, 마지막 사유: ${reason})`,
          );
          return;
        }
      }

      // [Task #11] 2단계 가드 통과 검증 (⑧/⑩/⑪)
      const validation = deps.validateGuards();
      if (!validation.ok) {
        logger.error(
          `[AUTO-SAVE BLOCK] 가드 검증 실패로 자동 저장 차단 (사유: ${baselineReason}):`,
          validation.violations,
        );
        return;
      }

      logger.log(
        `[AUTO-SAVE] 싱크 결과 자동 저장 시작 (가드 통과, 시작 사유: ${baselineReason}, 마지막 사유: ${reason})`,
      );
      deps.onPerformSave();
    }, debounceMs);
  };

  return {
    trigger,
    cancel,
    isPending: () => debounceHandle !== null,
  };
}
