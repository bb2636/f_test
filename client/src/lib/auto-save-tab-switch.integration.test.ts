/**
 * [Task #13] 탭 전환이 자동 저장을 1회만 트리거하도록 보장하는 통합 테스트
 *
 * 목적
 *   Task #12의 단위 테스트는 `auto-save-scheduler`의 trigger 호출을 직접
 *   조작해 디바운스/no-op skip/가드 차단을 검증한다. 이 통합 테스트는
 *   field-estimate.tsx의 탭 전환 useEffect 패턴을 가벼운 시뮬레이터로 모델링해
 *   "사용자 1회 상호작용 = 자동 저장 1회 이하"가 보장되는지 회귀 검증한다.
 *
 *   다음 회귀 위험을 자동 검증한다:
 *     1) 단일 탭 진입 (useEffect 1회 실행, sync no-op) → 자동 저장 0회.
 *     2) StrictMode 더블 effect 시뮬레이션 → 자동 저장 1회 이하.
 *     3) A→B→A 빠른 탭 전환 (1.5초 디바운스 윈도우 내 effect 3회) →
 *        실제 변경이 한 번만 발생했더라도 자동 저장 1회 (중복 X).
 *     4) 같은 탭에서 의존성 배열의 다른 값(예: rows.length) 변경으로 effect가
 *        재실행되더라도 sync가 no-op이면 자동 저장 0회.
 *
 *   field-estimate.tsx와 auto-save-scheduler.ts는 변경하지 않으며, RTL/jsdom
 *   같은 추가 의존성을 들이지 않고 vitest + node 환경에서 검증한다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createAutoSaveScheduler,
  type AutoSaveSchedulerDeps,
  type AutoSaveSchedulerLogger,
} from "./auto-save-scheduler";

/**
 * field-estimate.tsx의 탭 진입 useEffect를 모델링하는 가벼운 시뮬레이터.
 *
 *   - `selectedCategory`가 "노무비" 또는 "자재비"로 들어오면 sync 함수가
 *     호출되고 그 직후 `scheduler.trigger(reason)`이 호출된다.
 *   - `strictMode: true`이면 React 18 StrictMode가 dev에서 effect를 두 번
 *     호출하는 동작을 시뮬레이션 (cleanup → re-run).
 *   - sync 자체는 외부에서 주입한 `runSync` 콜백으로 모델링되어, 호출 시
 *     hash 변경 여부를 테스트가 직접 제어할 수 있다.
 */
interface TabSwitchHarnessOptions {
  strictMode?: boolean;
  debounceMs?: number;
}

interface TabSwitchHarness {
  hash: { value: string };
  performSaveCalls: number;
  triggerCalls: number;
  syncCalls: number;
  logs: string[];
  setSelectedCategory: (category: string) => void;
  /** 의존성 배열의 다른 값(rows.length 등)이 바뀌어 effect가 재실행되는 경우 */
  bumpDependency: () => void;
  /** sync 호출 시 실제 변경(=hash 변경)을 발생시키도록 한 번만 무장 */
  armNextSyncToChangeHash: (newHash: string) => void;
}

function makeTabSwitchHarness(opts: TabSwitchHarnessOptions = {}): TabSwitchHarness {
  const hash = { value: "initial" };
  const harness: TabSwitchHarness = {
    hash,
    performSaveCalls: 0,
    triggerCalls: 0,
    syncCalls: 0,
    logs: [],
    setSelectedCategory: () => {},
    bumpDependency: () => {},
    armNextSyncToChangeHash: () => {},
  };

  const deps: AutoSaveSchedulerDeps = {
    isPartnerSession: () => false,
    isEligible: () => true,
    computeHash: () => hash.value,
    validateGuards: () => ({ ok: true, violations: [] }),
    onPerformSave: () => {
      harness.performSaveCalls += 1;
    },
  };

  const logger: AutoSaveSchedulerLogger = {
    log: (msg) => harness.logs.push(msg),
    error: (msg, ...args) =>
      harness.logs.push(
        `${msg} ${args.map((a) => JSON.stringify(a)).join(" ")}`.trim(),
      ),
  };

  const scheduler = createAutoSaveScheduler(deps, {
    logger,
    debounceMs: opts.debounceMs,
  });

  let pendingHashChange: string | null = null;
  harness.armNextSyncToChangeHash = (newHash) => {
    pendingHashChange = newHash;
  };

  // 탭별 sync 함수를 reason과 매핑 — field-estimate.tsx의 두 useEffect와 동일.
  //   sync 함수는 setState로 행을 갱신하지만 React setState는 비동기이므로
  //   trigger 호출 시점에는 아직 직전 상태의 hash가 잡힌다 (baseline). 다음
  //   렌더 후 디바운스 만료 시점에는 변경된 hash로 비교된다. 시뮬레이터도
  //   이 순서를 그대로 모방해, 무장된 hash 변경을 trigger 호출 후에 적용한다.
  const runEffectFor = (category: string) => {
    let reason: string | null = null;
    if (category === "자재비") reason = "material:tabEnter";
    else if (category === "노무비") reason = "labor:tabEnter";
    if (!reason) return;

    harness.syncCalls += 1;
    const queuedHash = pendingHashChange;
    pendingHashChange = null;
    harness.triggerCalls += 1;
    scheduler.trigger(reason); // baseline은 이 시점의 hash로 캡쳐된다
    // setState 비동기 의미 모방: trigger 다음 줄에서 hash 변경 적용
    if (queuedHash !== null) {
      hash.value = queuedHash;
    }
  };

  let currentCategory: string | null = null;
  let currentDepBump = 0;

  const runEffectIfChanged = (
    nextCategory: string,
    nextDepBump: number,
  ) => {
    // useEffect 의존성 변경 모델: selectedCategory 또는 부수 의존성이 바뀌면
    // effect를 (StrictMode면 두 번) 실행한다. 같은 값이면 실행하지 않음.
    if (
      nextCategory === currentCategory &&
      nextDepBump === currentDepBump
    ) {
      return;
    }
    currentCategory = nextCategory;
    currentDepBump = nextDepBump;

    runEffectFor(nextCategory);
    if (opts.strictMode) {
      runEffectFor(nextCategory);
    }
  };

  harness.setSelectedCategory = (category) => {
    runEffectIfChanged(category, currentDepBump);
  };

  harness.bumpDependency = () => {
    if (currentCategory === null) return;
    runEffectIfChanged(currentCategory, currentDepBump + 1);
  };

  return harness;
}

describe("auto-save tab-switch integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("[통합1] 단일 탭 진입 + sync no-op → 자동 저장 0회", () => {
    const h = makeTabSwitchHarness();

    h.setSelectedCategory("자재비");

    // 디바운스 만료까지 대기
    vi.advanceTimersByTime(1500);

    expect(h.syncCalls).toBe(1);
    expect(h.triggerCalls).toBe(1);
    expect(h.performSaveCalls).toBe(0);
    const skipLog = h.logs.find((m) =>
      m.startsWith("[AUTO-SAVE SKIP] no-op sync"),
    );
    expect(skipLog).toBeDefined();
    expect(skipLog).toContain("시작 사유: material:tabEnter");
    expect(skipLog).toContain("마지막 사유: material:tabEnter");
  });

  it("[통합2] StrictMode 더블 effect (단일 탭 진입) → 자동 저장 1회 이하", () => {
    const h = makeTabSwitchHarness({ strictMode: true });

    // 첫 effect는 hash를 바꾸고 두 번째 effect는 no-op이라 가정
    // (일반적으로 StrictMode 두 번째 effect는 같은 sync를 다시 호출하지만
    //  화면 상태는 이미 첫 호출에서 적용되어 두 번째는 멱등).
    h.armNextSyncToChangeHash("after-first");
    h.setSelectedCategory("자재비");

    // 두 번 trigger 발생, hash는 "after-first"
    expect(h.triggerCalls).toBe(2);
    expect(h.syncCalls).toBe(2);

    vi.advanceTimersByTime(1500);

    // 디바운스 + 변경 감지로 자동 저장은 정확히 1회만
    expect(h.performSaveCalls).toBe(1);
    const startLogs = h.logs.filter((m) =>
      m.startsWith("[AUTO-SAVE] 싱크 결과 자동 저장 시작"),
    );
    expect(startLogs).toHaveLength(1);
    // StrictMode 더블 effect도 같은 reason을 두 번 호출하므로 baseline reason과
    // 마지막 reason이 모두 첫/마지막 trigger의 reason(="material:tabEnter")이어야 함
    expect(startLogs[0]).toContain("시작 사유: material:tabEnter");
    expect(startLogs[0]).toContain("마지막 사유: material:tabEnter");
  });

  it("[통합3] A→B→A 빠른 탭 전환(디바운스 안에 effect 3회) → 자동 저장 1회", () => {
    const h = makeTabSwitchHarness();

    // 자재비 탭 진입 (이번 한 번은 실제 변경 발생)
    h.armNextSyncToChangeHash("v1");
    h.setSelectedCategory("자재비");

    // 0.5초 뒤 노무비 탭으로 전환 (no-op sync)
    vi.advanceTimersByTime(500);
    h.setSelectedCategory("노무비");

    // 다시 0.5초 뒤 자재비로 복귀 (no-op sync)
    vi.advanceTimersByTime(500);
    h.setSelectedCategory("자재비");

    // 마지막 trigger 기준 1.5초 뒤에 디바운스 만료
    vi.advanceTimersByTime(1500);

    expect(h.triggerCalls).toBe(3);
    // 핵심: 3회 trigger에도 자동 저장은 1회만
    expect(h.performSaveCalls).toBe(1);
    const startLog = h.logs.find((m) =>
      m.startsWith("[AUTO-SAVE] 싱크 결과 자동 저장 시작"),
    );
    expect(startLog).toBeDefined();
    // baseline은 가장 이른 trigger(material:tabEnter)의 reason을 보존
    expect(startLog).toContain("시작 사유: material:tabEnter");
    expect(startLog).toContain("마지막 사유: material:tabEnter");
  });

  it("[통합4] 같은 탭에서 의존성 배열 다른 값 변경 + sync no-op → 자동 저장 0회", () => {
    const h = makeTabSwitchHarness();

    // 자재비 탭 진입 (no-op)
    h.setSelectedCategory("자재비");
    // 같은 탭에서 rows.length 같은 부수 의존성이 바뀌어 effect가 재실행
    h.bumpDependency();
    h.bumpDependency();

    vi.advanceTimersByTime(1500);

    expect(h.triggerCalls).toBe(3); // 1번의 진입 + 2번의 의존성 변경
    expect(h.performSaveCalls).toBe(0);
    const skipLog = h.logs.find((m) =>
      m.startsWith("[AUTO-SAVE SKIP] no-op sync"),
    );
    expect(skipLog).toBeDefined();
    // 가장 이른 trigger(첫 탭 진입)의 reason이 baseline에 보존되어야 하고,
    // 마지막 reason은 마지막 trigger(마지막 의존성 변경)의 reason이어야 함
    expect(skipLog).toContain("시작 사유: material:tabEnter");
    expect(skipLog).toContain("마지막 사유: material:tabEnter");
  });
});
