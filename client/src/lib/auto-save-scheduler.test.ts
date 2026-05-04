/**
 * [Task #12] 자동 저장 스케줄러 회귀 시나리오 자동 검증
 *
 * field-estimate.tsx의 탭 전환 시 자동 저장 동작이 의도치 않게 회귀하는 것을
 * 막기 위한 단위 테스트. 다음 4가지 시나리오 + 협력업체 가드를 자동 검증한다.
 *
 *   1) 변경 없는 탭 진입 → 1회 trigger, 자동 저장 0회 (skip 로그)
 *   2) 산출표 편집 후 자재비 탭 진입 → 1회 trigger, 자동 저장 1회 (변경 감지)
 *   3) 짧은 시간(1.5초 안) 동안 실 변경 trigger → no-op trigger 연속
 *      → 자동 저장 1회 (실 변경 누락 없음)
 *   4) no-op trigger 연속 → 자동 저장 0회
 *   + 협력업체 세션은 어떤 경로로도 자동 저장이 발동되지 않는다.
 *
 * 또한 (a) 가드 검증 실패 시 자동 저장 차단, (b) 디바운스 만료 시점에 진행 불가
 * 상태(예: 다른 저장 진행 중)면 skip 되는 보호 동작도 함께 확인한다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createAutoSaveScheduler,
  type AutoSaveSchedulerDeps,
  type AutoSaveSchedulerLogger,
} from "./auto-save-scheduler";

interface SchedulerHarness {
  hashSource: { value: string };
  validation: { ok: boolean; violations: string[] };
  partner: { value: boolean };
  eligible: { value: boolean };
  performSaveCalls: number;
  validateGuardCalls: number;
  computeHashCalls: number;
  logs: string[];
  errors: string[];
  scheduler: ReturnType<typeof createAutoSaveScheduler>;
}

function makeHarness(initial: Partial<{
  hash: string;
  partner: boolean;
  eligible: boolean;
  validation: { ok: boolean; violations: string[] };
}> = {}): SchedulerHarness {
  const hashSource = { value: initial.hash ?? "baseline" };
  const validation = initial.validation ?? { ok: true, violations: [] };
  const partner = { value: initial.partner ?? false };
  const eligible = { value: initial.eligible ?? true };

  const harness: SchedulerHarness = {
    hashSource,
    validation,
    partner,
    eligible,
    performSaveCalls: 0,
    validateGuardCalls: 0,
    computeHashCalls: 0,
    logs: [],
    errors: [],
    scheduler: null as unknown as ReturnType<typeof createAutoSaveScheduler>,
  };

  const deps: AutoSaveSchedulerDeps = {
    isPartnerSession: () => partner.value,
    isEligible: () => eligible.value,
    computeHash: () => {
      harness.computeHashCalls += 1;
      return hashSource.value;
    },
    validateGuards: () => {
      harness.validateGuardCalls += 1;
      return harness.validation;
    },
    onPerformSave: () => {
      harness.performSaveCalls += 1;
    },
  };

  const logger: AutoSaveSchedulerLogger = {
    log: (msg) => {
      harness.logs.push(msg);
    },
    error: (msg, ...args) => {
      harness.errors.push(`${msg} ${args.map((a) => JSON.stringify(a)).join(" ")}`.trim());
    },
  };

  harness.scheduler = createAutoSaveScheduler(deps, { logger });
  return harness;
}

describe("auto-save-scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // ─── 시나리오 1 ──────────────────────────────────────────────
  it("[시나리오1] 변경 없는 탭 진입: trigger 1회 → 자동 저장 0회 + skip 로그", () => {
    const h = makeHarness({ hash: "stable" });

    // sync 함수가 호출되었지만 행/필드 변경이 없는 경우(=hash 불변) trigger 발생
    h.scheduler.trigger("material:tabEnter");

    expect(h.scheduler.isPending()).toBe(true);
    expect(h.performSaveCalls).toBe(0); // 디바운스 만료 전

    // 디바운스 만료 (1500ms)
    vi.advanceTimersByTime(1500);

    expect(h.performSaveCalls).toBe(0);
    expect(h.scheduler.isPending()).toBe(false);
    // skip 로그 확인 — '시작 사유'와 '마지막 사유'가 모두 첫 trigger의 reason
    const skipLog = h.logs.find((m) => m.startsWith("[AUTO-SAVE SKIP] no-op sync"));
    expect(skipLog).toBeDefined();
    expect(skipLog).toContain("시작 사유: material:tabEnter");
    expect(skipLog).toContain("마지막 사유: material:tabEnter");
    // 가드 검증은 호출되지 않아야 함 (skip이 우선)
    expect(h.validateGuardCalls).toBe(0);
  });

  // ─── 시나리오 2 ──────────────────────────────────────────────
  it("[시나리오2] 산출표 편집 후 탭 진입: trigger 1회 + hash 변경 → 자동 저장 1회", () => {
    const h = makeHarness({ hash: "before-edit" });

    // 사용자가 복구면적 산출표를 편집해 sync 결과가 달라진 직후 탭 진입
    h.scheduler.trigger("material:tabEnter");

    // 실 sync가 setState로 이어져 다음 디바운스 만료 시점에는 hash가 달라진 상태
    h.hashSource.value = "after-edit";

    vi.advanceTimersByTime(1500);

    expect(h.performSaveCalls).toBe(1);
    expect(h.validateGuardCalls).toBe(1);
    const startLog = h.logs.find((m) =>
      m.startsWith("[AUTO-SAVE] 싱크 결과 자동 저장 시작"),
    );
    expect(startLog).toBeDefined();
    expect(startLog).toContain("시작 사유: material:tabEnter");
  });

  // ─── 시나리오 3 ──────────────────────────────────────────────
  it("[시나리오3] 실 변경 trigger 후 no-op trigger 연속: 실 변경 누락 없이 자동 저장 1회", () => {
    const h = makeHarness({ hash: "v0" });

    // Trigger A — 실 변경(예: 산출표 편집 직후 sync)
    h.scheduler.trigger("material:recoverySignature");
    // sync가 적용되어 hash가 "v1"로 변경됨
    h.hashSource.value = "v1";

    // 1초 뒤 Trigger B — 탭 전환만으로 발동된 no-op sync (hash 동일)
    vi.advanceTimersByTime(1000);
    h.scheduler.trigger("material:tabEnter");
    // (no-op이므로 hash는 그대로 "v1")

    // 다시 0.5초 뒤 Trigger C — 또 다른 no-op
    vi.advanceTimersByTime(500);
    h.scheduler.trigger("labor:tabEnter");

    expect(h.performSaveCalls).toBe(0); // 아직 디바운스 윈도우 내

    // Trigger C 기준 1500ms까지 진행 (마지막 trigger 기준 디바운스 reset)
    vi.advanceTimersByTime(1500);

    // 실 변경이 누락되지 않고 1회 저장
    expect(h.performSaveCalls).toBe(1);
    const startLog = h.logs.find((m) =>
      m.startsWith("[AUTO-SAVE] 싱크 결과 자동 저장 시작"),
    );
    expect(startLog).toBeDefined();
    // baseline은 가장 이른 trigger(Trigger A)의 reason을 보존해야 함
    expect(startLog).toContain("시작 사유: material:recoverySignature");
    expect(startLog).toContain("마지막 사유: labor:tabEnter");
    // skip 로그는 없어야 함
    expect(h.logs.find((m) => m.startsWith("[AUTO-SAVE SKIP] no-op sync"))).toBeUndefined();
  });

  // ─── 시나리오 4 ──────────────────────────────────────────────
  it("[시나리오4] no-op trigger 연속: 자동 저장 0회", () => {
    const h = makeHarness({ hash: "stable" });

    h.scheduler.trigger("material:tabEnter");
    vi.advanceTimersByTime(700);
    h.scheduler.trigger("labor:tabEnter");
    vi.advanceTimersByTime(700);
    h.scheduler.trigger("material:recoverySignature");

    // 마지막 trigger 기준 1500ms 후 만료
    vi.advanceTimersByTime(1500);

    expect(h.performSaveCalls).toBe(0);
    expect(h.validateGuardCalls).toBe(0);
    const skipLog = h.logs.find((m) => m.startsWith("[AUTO-SAVE SKIP] no-op sync"));
    expect(skipLog).toBeDefined();
    // baseline reason은 첫 trigger를 보존
    expect(skipLog).toContain("시작 사유: material:tabEnter");
    // 마지막 reason은 마지막 trigger
    expect(skipLog).toContain("마지막 사유: material:recoverySignature");
  });

  // ─── 협력업체 세션 가드 ───────────────────────────────────────
  it("[협력업체] 어떤 경로로도 자동 저장이 발동되지 않는다", () => {
    const h = makeHarness({ partner: true, hash: "anything" });

    // 다양한 경로 시뮬레이션 — 탭 전환, 변경 trigger, 연속 trigger 모두 차단
    h.scheduler.trigger("material:tabEnter");
    h.scheduler.trigger("labor:tabEnter");
    h.hashSource.value = "changed-anyway";
    h.scheduler.trigger("material:recoverySignature");

    // 디바운스 자체가 시작되지 않아야 함
    expect(h.scheduler.isPending()).toBe(false);
    vi.advanceTimersByTime(5000);

    expect(h.performSaveCalls).toBe(0);
    expect(h.validateGuardCalls).toBe(0);
    expect(h.computeHashCalls).toBe(0); // hash조차 계산 안 함
    // 모든 trigger에 대해 partner skip 로그가 기록됨
    const partnerLogs = h.logs.filter((m) => m.startsWith("[AUTO-SAVE SKIP] Partner role"));
    expect(partnerLogs).toHaveLength(3);
    expect(partnerLogs[0]).toContain("사유: material:tabEnter");
    expect(partnerLogs[1]).toContain("사유: labor:tabEnter");
    expect(partnerLogs[2]).toContain("사유: material:recoverySignature");
  });

  // ─── 보조: 가드 검증 실패 시 차단 ──────────────────────────
  it("[보호] 가드 검증 실패(⑧/⑩/⑪) 시 자동 저장 차단", () => {
    const h = makeHarness({
      hash: "v0",
      validation: { ok: false, violations: ["위험⑧: 삭제 키 부활"] },
    });

    h.scheduler.trigger("material:recoverySignature");
    h.hashSource.value = "v1"; // 변경 있음 → 가드 검증까지 진입
    vi.advanceTimersByTime(1500);

    expect(h.performSaveCalls).toBe(0);
    expect(h.errors.some((m) => m.includes("[AUTO-SAVE BLOCK]"))).toBe(true);
  });

  // ─── 보조: ineligible(저장 진행 중 등) 상태에서는 trigger 자체가 무시 ─
  it("[보호] 디바운스 만료 시점에 ineligible(예: 저장 진행 중)이면 skip", () => {
    const h = makeHarness({ hash: "v0" });

    h.scheduler.trigger("material:tabEnter");
    h.hashSource.value = "v1";
    // 만료 직전에 다른 저장이 시작된 상황을 시뮬레이션
    h.eligible.value = false;
    vi.advanceTimersByTime(1500);

    expect(h.performSaveCalls).toBe(0);
    expect(h.scheduler.isPending()).toBe(false);
  });

  // ─── 보조: trigger 시점에 ineligible이면 디바운스도 시작되지 않음 ──
  it("[보호] trigger 시점에 ineligible이면 즉시 무시 (디바운스 미시작)", () => {
    const h = makeHarness({ hash: "v0", eligible: false });

    h.scheduler.trigger("material:tabEnter");

    expect(h.scheduler.isPending()).toBe(false);
    expect(h.computeHashCalls).toBe(0);
    expect(h.performSaveCalls).toBe(0);
  });

  // ─── 보조: cancel은 진행 중인 디바운스를 취소한다 ─────────
  it("[보호] cancel() 호출 시 디바운스 취소 + baseline 폐기", () => {
    const h = makeHarness({ hash: "v0" });
    h.scheduler.trigger("material:tabEnter");
    h.hashSource.value = "v1";

    h.scheduler.cancel();
    vi.advanceTimersByTime(5000);

    expect(h.performSaveCalls).toBe(0);
    expect(h.scheduler.isPending()).toBe(false);
  });
});
