// @vitest-environment jsdom
/**
 * [Task #14] 복구면적 변경 → 자재비 자동 연동 useEffect를 1회만 트리거하도록 보장하는 통합 테스트
 *
 * Task #13에서는 자재비/노무비 **탭 진입** useEffect 두 곳의 dep 배열만 정적/통합으로
 * 보호했다. 그러나 복구면적 산출표가 바뀔 때 자재비를 자동 연동하는
 * useEffect(`field-estimate.tsx` L2510~L2565)도 동일한 위험이 있다:
 *
 *   - dep 배열에 derived state(예: useMemo로 계산된 값, 매 렌더 새 객체 등)가
 *     끼어들면, 사용자가 한 번 면적을 수정했는데 effect가 2회 이상 재실행되어
 *     `triggerAutoSaveAfterSync("material:recoverySignature")`도 2회 이상 호출되고,
 *     그 결과 디바운스 윈도우 안에서 baseline이 새 sync 결과로 오염되어
 *     변경 감지가 무력화될 수 있다.
 *
 * ─ 본 통합 테스트의 두 축 ─
 *
 *  (A) React Testing Library 통합 테스트
 *      field-estimate.tsx 안 복구면적 변경 useEffect와 **1:1 동일한** 구조와
 *      dep 배열을 가진 TestHarness를 마운트하고, 실제 scheduler
 *      (`createAutoSaveScheduler`)와 함께 동작시켜 다음을 검증:
 *        1) 복구면적 한 번 변경 → trigger 1회
 *        2) 협력업체 세션 → trigger 0회
 *        3) cutoff 이전 케이스(isAutoSyncEligibleCase=false) → trigger 0회
 *        4) 손해방지 케이스 → trigger 0회
 *        5) 같은 복구면적인 채로 dep 외 prop 변경 → 추가 trigger 없음
 *
 *  (B) field-estimate.tsx 소스 정적 검증
 *      위 (A)는 패턴이 올바르게 동작함을 보장할 뿐, 누가 실제 파일의 dep 배열을
 *      수정해도 자동으로 잡히지 않는다. 그래서 field-estimate.tsx 소스를 읽어
 *      복구면적 변경 useEffect 한 곳의 의존성 배열을 정확히 매칭하고,
 *      허용된 식별자 외 값(특히 `derived`/`computed` 류)이 추가되면
 *      테스트가 실패하도록 한다.
 */
import React, { useEffect, useRef } from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createAutoSaveScheduler,
  type AutoSaveScheduler,
} from "./auto-save-scheduler";

// ─────────────────────────────────────────────────────────────────────
// (A) React Testing Library 통합 테스트
// ─────────────────────────────────────────────────────────────────────

interface HarnessProps {
  recoverySignature: string;
  isLossPreventionCase: boolean;
  isReadOnly: boolean;
  isAutoSyncEligibleCase: boolean;
  isPartner: boolean;
  currentUser: { id: string } | null;
  triggerSpy: (reason: string) => void;
  syncMaterialSpy: () => void;
}

/**
 * field-estimate.tsx L2510~L2565의 복구면적 변경 useEffect를
 * **dep 배열까지 1:1로 동일하게** 재현한 테스트 컴포넌트.
 *
 * - `isHydratedRef.current`는 원본과 동일하게 항상 true (마운트 시 hydration 완료 상태 가정).
 * - `skipAutoSyncRef.current`는 원본과 동일하게 초기 true → 첫 effect 실행 시 false로 전환.
 *   따라서 마운트 직후의 첫 useEffect 실행에서는 trigger가 호출되지 않고,
 *   이후 recoverySignature가 실제로 변경될 때 trigger가 호출된다.
 *
 * 실제 파일의 dep 배열이 바뀌면 (B) 정적 테스트가 잡고, 이 컴포넌트는
 * "현재 dep 배열 형태에서 trigger가 어떻게 호출되는지"를 React 런타임으로
 * 직접 관찰한다.
 */
function RecoveryAutoSyncHarness(props: HarnessProps) {
  const {
    recoverySignature,
    isLossPreventionCase,
    isReadOnly,
    isAutoSyncEligibleCase,
    isPartner,
    currentUser,
    triggerSpy,
    syncMaterialSpy,
  } = props;

  const isHydratedRef = useRef(true);
  const skipAutoSyncRef = useRef(true);

  // ── field-estimate.tsx L2510~L2565 (복구면적 변경 → 자재비 자동연동) 1:1 미러 ──
  useEffect(() => {
    if (!currentUser || isPartner) return;
    if (!isHydratedRef.current) return;
    if (skipAutoSyncRef.current) {
      skipAutoSyncRef.current = false;
      return;
    }
    if (isLossPreventionCase) return;
    if (!isAutoSyncEligibleCase) return;
    syncMaterialSpy();
    triggerSpy("material:recoverySignature");
    // ⚠️ 이 deps는 field-estimate.tsx 원본과 정확히 일치해야 한다.
  }, [
    recoverySignature,
    isLossPreventionCase,
    isReadOnly,
    isAutoSyncEligibleCase,
    isPartner,
    currentUser,
  ]);

  return <div data-testid="sig">{recoverySignature}</div>;
}

interface SchedulerProbe {
  scheduler: AutoSaveScheduler;
  performSaveCalls: () => number;
  setHash: (next: string) => void;
}

function makeSchedulerProbe(initialHash = "stable"): SchedulerProbe {
  let hash = initialHash;
  let performSaveCalls = 0;
  const scheduler = createAutoSaveScheduler(
    {
      isPartnerSession: () => false,
      isEligible: () => true,
      computeHash: () => hash,
      validateGuards: () => ({ ok: true, violations: [] }),
      onPerformSave: () => {
        performSaveCalls += 1;
      },
    },
    {
      logger: { log: () => {}, error: () => {} },
    },
  );
  return {
    scheduler,
    performSaveCalls: () => performSaveCalls,
    setHash: (next: string) => {
      hash = next;
    },
  };
}

function defaultHarnessProps(
  overrides: Partial<HarnessProps> = {},
): HarnessProps {
  return {
    recoverySignature: "row-1|벽지|벽지작업|10",
    isLossPreventionCase: false,
    isReadOnly: false,
    isAutoSyncEligibleCase: true,
    isPartner: false,
    currentUser: { id: "admin-1" },
    triggerSpy: vi.fn(),
    syncMaterialSpy: vi.fn(),
    ...overrides,
  };
}

describe("[Task #14] 복구면적 변경 → 자재비 자동연동 통합 테스트 (React)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("[시나리오1] 복구면적 한 번 변경 → triggerAutoSaveAfterSync 1회", () => {
    const triggerSpy = vi.fn();
    const syncMaterialSpy = vi.fn();
    const props = defaultHarnessProps({
      triggerSpy,
      syncMaterialSpy,
      recoverySignature: "row-1|벽지|벽지작업|10",
    });

    const { rerender } = render(<RecoveryAutoSyncHarness {...props} />);

    // 마운트 직후의 첫 effect 실행은 skipAutoSyncRef로 인해 trigger 없음
    expect(triggerSpy).not.toHaveBeenCalled();
    expect(syncMaterialSpy).not.toHaveBeenCalled();

    // 사용자가 복구면적을 한 번 수정
    rerender(
      <RecoveryAutoSyncHarness
        {...props}
        recoverySignature="row-1|벽지|벽지작업|20"
      />,
    );

    // 한 번의 변경 → 정확히 1회의 sync + trigger
    expect(syncMaterialSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledWith("material:recoverySignature");
  });

  it("[시나리오2] 협력업체 세션에서는 복구면적이 바뀌어도 trigger 0회", () => {
    const triggerSpy = vi.fn();
    const syncMaterialSpy = vi.fn();
    const props = defaultHarnessProps({
      triggerSpy,
      syncMaterialSpy,
      isPartner: true,
      recoverySignature: "row-1|벽지|벽지작업|10",
    });

    const { rerender } = render(<RecoveryAutoSyncHarness {...props} />);
    expect(triggerSpy).not.toHaveBeenCalled();

    rerender(
      <RecoveryAutoSyncHarness
        {...props}
        recoverySignature="row-1|벽지|벽지작업|20"
      />,
    );

    expect(syncMaterialSpy).not.toHaveBeenCalled();
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it("[시나리오3] cutoff 이전 케이스(isAutoSyncEligibleCase=false)에서는 trigger 0회", () => {
    const triggerSpy = vi.fn();
    const syncMaterialSpy = vi.fn();
    const props = defaultHarnessProps({
      triggerSpy,
      syncMaterialSpy,
      isAutoSyncEligibleCase: false,
      recoverySignature: "row-1|벽지|벽지작업|10",
    });

    const { rerender } = render(<RecoveryAutoSyncHarness {...props} />);
    expect(triggerSpy).not.toHaveBeenCalled();

    rerender(
      <RecoveryAutoSyncHarness
        {...props}
        recoverySignature="row-1|벽지|벽지작업|20"
      />,
    );

    expect(syncMaterialSpy).not.toHaveBeenCalled();
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it("[시나리오4] 손해방지 케이스에서는 trigger 0회", () => {
    const triggerSpy = vi.fn();
    const syncMaterialSpy = vi.fn();
    const props = defaultHarnessProps({
      triggerSpy,
      syncMaterialSpy,
      isLossPreventionCase: true,
      recoverySignature: "row-1|벽지|벽지작업|10",
    });

    const { rerender } = render(<RecoveryAutoSyncHarness {...props} />);
    expect(triggerSpy).not.toHaveBeenCalled();

    rerender(
      <RecoveryAutoSyncHarness
        {...props}
        recoverySignature="row-1|벽지|벽지작업|20"
      />,
    );

    expect(syncMaterialSpy).not.toHaveBeenCalled();
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it("[보호1] 같은 recoverySignature 채로 dep 외 prop이 변해도 trigger는 추가 호출되지 않는다", () => {
    // dep 배열에 들어 있지 않은 외부 변경(예: 다른 상위 prop 리렌더)이 있어도
    // recoverySignature가 그대로면 effect는 재실행되지 않아야 한다.
    const triggerSpy = vi.fn();
    const syncMaterialSpy = vi.fn();
    const props = defaultHarnessProps({
      triggerSpy,
      syncMaterialSpy,
      recoverySignature: "row-1|벽지|벽지작업|10",
    });

    const { rerender } = render(<RecoveryAutoSyncHarness {...props} />);
    expect(triggerSpy).not.toHaveBeenCalled();

    // 한 번 변경 → trigger 1회
    rerender(
      <RecoveryAutoSyncHarness
        {...props}
        recoverySignature="row-1|벽지|벽지작업|20"
      />,
    );
    expect(triggerSpy).toHaveBeenCalledTimes(1);

    // 동일 recoverySignature로 부모가 단순히 새 함수 props만 다시 내려보내는 케이스.
    // dep 배열에 derived state(예: 매 렌더 새로 만든 객체)가 끼어들면 여기서
    // effect가 또 한 번 실행되어 trigger가 2회로 누적되었을 것이다.
    rerender(
      <RecoveryAutoSyncHarness
        {...props}
        triggerSpy={triggerSpy}
        syncMaterialSpy={syncMaterialSpy}
        recoverySignature="row-1|벽지|벽지작업|20"
      />,
    );
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it("[보호2] 면적이 두 번 연속 바뀌어도 디바운스 만료 시 실제 저장은 1회", () => {
    // 실제 scheduler를 그대로 사용해 디바운스가 trigger를 정확히 1회의
    // performSave로 합치는지 검증. 만약 dep 배열에 derived state가 끼어들어
    // 같은 변경에 대해 effect가 2회 실행되었다면, 이 카운트는 변하지 않더라도
    // 위의 시나리오1/보호1의 triggerSpy 카운트가 먼저 깨진다.
    const probe = makeSchedulerProbe("hash:v1");
    const triggerSpy = vi.fn((reason: string) =>
      probe.scheduler.trigger(reason),
    );
    const syncMaterialSpy = vi.fn();

    const props = defaultHarnessProps({
      triggerSpy,
      syncMaterialSpy,
      recoverySignature: "row-1|벽지|벽지작업|10",
    });

    const { rerender } = render(<RecoveryAutoSyncHarness {...props} />);
    expect(triggerSpy).not.toHaveBeenCalled();

    // 면적 변경 1회차
    rerender(
      <RecoveryAutoSyncHarness
        {...props}
        recoverySignature="row-1|벽지|벽지작업|20"
      />,
    );
    expect(triggerSpy).toHaveBeenCalledTimes(1);

    // 1회차 trigger 이후 sync 결과로 hash가 바뀐 것처럼 시뮬레이션
    probe.setHash("hash:v2");

    // 면적 변경 2회차 (디바운스 윈도우 내) → trigger는 누적 2회, debounce는 reset
    rerender(
      <RecoveryAutoSyncHarness
        {...props}
        recoverySignature="row-1|벽지|벽지작업|30"
      />,
    );
    expect(triggerSpy).toHaveBeenCalledTimes(2);

    // 디바운스 만료 → 두 번의 trigger가 단 1회의 performSave로 합쳐진다
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(probe.performSaveCalls()).toBe(1);
    expect(syncMaterialSpy).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// (B) field-estimate.tsx 소스 정적 검증
//   실제 파일의 dep 배열이 변경되면 즉시 실패하여 회귀를 차단한다.
// ─────────────────────────────────────────────────────────────────────

function readFieldEstimateSource(): string {
  // npm test는 워크스페이스 루트에서 실행되므로 process.cwd()는 monorepo root.
  // vite root는 client/지만 vitest는 npm 스크립트의 cwd를 그대로 사용한다.
  // 양쪽 케이스를 모두 안전하게 다루기 위해 두 후보 경로를 순차 시도.
  const candidates = [
    resolve(process.cwd(), "client/src/pages/field-estimate.tsx"),
    resolve(process.cwd(), "src/pages/field-estimate.tsx"),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      // try next
    }
  }
  throw new Error(
    `field-estimate.tsx 소스를 찾지 못했습니다. 시도한 경로: ${candidates.join(", ")}`,
  );
}

function normalizeDeps(deps: string): string[] {
  return deps
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
}

describe("[Task #14] field-estimate.tsx 복구면적 변경 useEffect deps 정적 검증", () => {
  const SOURCE = readFieldEstimateSource();

  it("복구면적 변경 useEffect의 dep 배열이 허용된 식별자 집합과 정확히 일치한다", () => {
    // L2510~L2565 useEffect 시그니처 매칭. 본문에 "material:recoverySignature"
    // trigger가 있는 useEffect의 dep 배열을 캡쳐.
    const re =
      /useEffect\(\(\)\s*=>\s*\{[^]*?triggerAutoSaveAfterSync\("material:recoverySignature"\);\s*\}\s*,\s*\[([^\]]+)\]\);/;
    const match = SOURCE.match(re);
    expect(
      match,
      "복구면적 변경 useEffect 블록을 찾지 못했습니다 — dep 배열 검증을 위해 구조를 유지해야 합니다.",
    ).not.toBeNull();
    const deps = normalizeDeps(match![1]);
    expect(deps.sort()).toEqual(
      [
        "recoverySignature",
        "isLossPreventionCase",
        "isReadOnly",
        "isAutoSyncEligibleCase",
        "isPartner",
        "currentUser",
      ].sort(),
    );
  });

  it("복구면적 변경 useEffect의 dep 배열에 derived/computed/Ref 식별자가 없다", () => {
    // 추가 방어선: 위 정확 매칭이 깨지지 않더라도, 누군가 새 식별자를 끼워 넣었을 때
    // 의심스러운 패턴(파생 상태 표시자) 자체를 더 명시적으로 차단한다.
    const re =
      /useEffect\(\(\)\s*=>\s*\{[^]*?triggerAutoSaveAfterSync\("material:recoverySignature"\);\s*\}\s*,\s*\[([^\]]+)\]\);/;
    const match = SOURCE.match(re);
    expect(match).not.toBeNull();
    const deps = normalizeDeps(match![1]);
    for (const dep of deps) {
      expect(
        /derived|computed|Ref$|memo(ized)?/i.test(dep),
        `복구면적 변경 useEffect의 dep 배열에 의심스러운 파생 상태가 추가되었습니다: ${dep}`,
      ).toBe(false);
    }
  });
});
