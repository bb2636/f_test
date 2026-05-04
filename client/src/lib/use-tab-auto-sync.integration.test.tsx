// @vitest-environment jsdom
/**
 * [Task #13] 탭 전환이 자동 저장을 1회만 트리거하도록 보장하는 통합 테스트
 *
 * Task #12에서 `auto-save-scheduler` 자체의 동작은 단위 테스트로 검증되지만,
 * 정작 "탭 전환 시 `triggerAutoSaveAfterSync`가 정확히 1회만 호출되는지"는
 * field-estimate.tsx 안의 useEffect **의존성 배열**에 의존한다.
 *
 * 누군가 자재비/노무비 탭 진입 useEffect deps에 새 값(특히 derived state)을
 * 넣으면 같은 탭 전환 동안 effect가 2회 이상 재실행되어 trigger가 중복 호출되고,
 * 그 결과 baseline이 새 sync 결과로 오염되어 변경 감지가 무력화될 수 있다.
 *
 * ─ 본 통합 테스트의 두 축 ─
 *
 *  (A) React Testing Library 통합 테스트
 *      field-estimate.tsx 안 자재비/노무비 탭 진입 useEffect와 **1:1 동일한**
 *      구조와 dep 배열을 가진 TestHarness를 마운트하고, 실제 scheduler
 *      (`createAutoSaveScheduler`)와 함께 동작시켜 다음을 검증:
 *        1) 자재비 탭으로 전환 → trigger 1회
 *        2) 노무비 탭으로 전환 → trigger 1회
 *        3) 변경 없는 탭 왕복(자재비↔노무비) → 디바운스 만료 시 저장 0회
 *
 *  (B) field-estimate.tsx 소스 정적 검증
 *      위 (A)는 패턴이 올바르게 동작함을 보장할 뿐, 누가 실제 파일의 dep 배열을
 *      수정해도 자동으로 잡히지 않는다. 그래서 field-estimate.tsx 소스를 읽어
 *      자재비/노무비 탭 진입 useEffect 두 곳의 의존성 배열을 정확히 매칭하고,
 *      허용된 식별자 외 값(특히 `derived`/`Ref`/`computed` 류)이 추가되면
 *      테스트가 실패하도록 한다.
 */
import React, { useEffect, useRef, useState } from "react";
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
  selectedCategory: string;
  isPartner: boolean;
  currentUser: { id: string } | null;
  isAutoSyncEligibleCase: boolean;
  isLossPreventionCase: boolean;
  rowsLength: number;
  mergedIlwidaegaCatalogLength: number;
  triggerSpy: (reason: string) => void;
  syncMaterialSpy: () => void;
  syncLaborSpy: () => void;
}

/**
 * field-estimate.tsx L2567~L2624의 자재비/노무비 탭 진입 useEffect 두 곳을
 * **dep 배열까지 1:1로 동일하게** 재현한 테스트 컴포넌트.
 *
 * 실제 파일의 dep 배열이 바뀌면 (B) 정적 테스트가 잡고, 이 컴포넌트는
 * "현재 dep 배열 형태에서 trigger가 어떻게 호출되는지"를 React 런타임으로
 * 직접 관찰한다.
 */
function TabAutoSyncHarness(props: HarnessProps) {
  const {
    selectedCategory,
    isPartner,
    currentUser,
    isAutoSyncEligibleCase,
    isLossPreventionCase,
    rowsLength,
    mergedIlwidaegaCatalogLength,
    triggerSpy,
    syncMaterialSpy,
    syncLaborSpy,
  } = props;

  const isHydratedRef = useRef(true);

  // ── field-estimate.tsx L2567~L2588 (자재비 탭 진입) 1:1 미러 ──
  useEffect(() => {
    if (selectedCategory !== "자재비") return;
    if (!currentUser || isPartner) return;
    if (!isHydratedRef.current) return;
    if (isLossPreventionCase) return;
    if (!isAutoSyncEligibleCase) return;
    syncMaterialSpy();
    triggerSpy("material:tabEnter");
    // ⚠️ 이 deps는 field-estimate.tsx 원본과 정확히 일치해야 한다.
  }, [selectedCategory, isAutoSyncEligibleCase, isPartner, currentUser]);

  // ── field-estimate.tsx L2591~L2624 (노무비 탭 진입) 1:1 미러 ──
  useEffect(() => {
    if (selectedCategory !== "노무비") return;
    if (!currentUser || isPartner) return;
    if (!isHydratedRef.current) return;
    if (isLossPreventionCase) return;
    if (rowsLength === 0) return;
    if (mergedIlwidaegaCatalogLength === 0) return;
    if (!isAutoSyncEligibleCase) return;
    syncLaborSpy();
    triggerSpy("labor:tabEnter");
    // ⚠️ 이 deps는 field-estimate.tsx 원본과 정확히 일치해야 한다.
  }, [
    selectedCategory,
    mergedIlwidaegaCatalogLength,
    rowsLength,
    isAutoSyncEligibleCase,
    isPartner,
    currentUser,
  ]);

  return <div data-testid="tab">{selectedCategory}</div>;
}

interface SchedulerProbe {
  scheduler: AutoSaveScheduler;
  performSaveCalls: () => number;
  computeHashCalls: () => number;
  setHash: (next: string) => void;
}

function makeSchedulerProbe(initialHash = "stable"): SchedulerProbe {
  let hash = initialHash;
  let performSaveCalls = 0;
  let computeHashCalls = 0;
  const scheduler = createAutoSaveScheduler(
    {
      isPartnerSession: () => false,
      isEligible: () => true,
      computeHash: () => {
        computeHashCalls += 1;
        return hash;
      },
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
    computeHashCalls: () => computeHashCalls,
    setHash: (next: string) => {
      hash = next;
    },
  };
}

function defaultHarnessProps(
  overrides: Partial<HarnessProps> = {},
): HarnessProps {
  return {
    selectedCategory: "견적",
    isPartner: false,
    currentUser: { id: "admin-1" },
    isAutoSyncEligibleCase: true,
    isLossPreventionCase: false,
    rowsLength: 3,
    mergedIlwidaegaCatalogLength: 5,
    triggerSpy: vi.fn(),
    syncMaterialSpy: vi.fn(),
    syncLaborSpy: vi.fn(),
    ...overrides,
  };
}

describe("[Task #13] 탭 전환 자동 저장 통합 테스트 (React)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("[시나리오1] 자재비 탭으로 전환 → triggerAutoSaveAfterSync 1회", () => {
    const triggerSpy = vi.fn();
    const syncMaterialSpy = vi.fn();
    const props = defaultHarnessProps({
      triggerSpy,
      syncMaterialSpy,
      selectedCategory: "견적",
    });

    const { rerender } = render(<TabAutoSyncHarness {...props} />);

    // 초기 마운트(견적 탭)에서는 trigger 호출 없음
    expect(triggerSpy).not.toHaveBeenCalled();
    expect(syncMaterialSpy).not.toHaveBeenCalled();

    // 자재비 탭으로 전환
    rerender(
      <TabAutoSyncHarness {...props} selectedCategory="자재비" />,
    );

    expect(syncMaterialSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledWith("material:tabEnter");
  });

  it("[시나리오2] 노무비 탭으로 전환 → triggerAutoSaveAfterSync 1회", () => {
    const triggerSpy = vi.fn();
    const syncLaborSpy = vi.fn();
    const props = defaultHarnessProps({
      triggerSpy,
      syncLaborSpy,
      selectedCategory: "견적",
    });

    const { rerender } = render(<TabAutoSyncHarness {...props} />);
    expect(triggerSpy).not.toHaveBeenCalled();

    rerender(
      <TabAutoSyncHarness {...props} selectedCategory="노무비" />,
    );

    expect(syncLaborSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledWith("labor:tabEnter");
  });

  it("[시나리오3] 변경 없는 탭 왕복(자재비↔노무비) → 디바운스 만료 후 저장 0회", () => {
    // 실제 scheduler를 그대로 사용. trigger는 실 scheduler.trigger로 위임.
    const probe = makeSchedulerProbe("stable-hash");
    const triggerSpy = vi.fn((reason: string) => probe.scheduler.trigger(reason));
    const syncMaterialSpy = vi.fn();
    const syncLaborSpy = vi.fn();

    const baseProps = defaultHarnessProps({
      triggerSpy,
      syncMaterialSpy,
      syncLaborSpy,
      selectedCategory: "자재비",
    });

    const { rerender } = render(<TabAutoSyncHarness {...baseProps} />);
    // 자재비 진입 → trigger 1회
    expect(triggerSpy).toHaveBeenCalledTimes(1);

    // 자재비 → 노무비
    rerender(
      <TabAutoSyncHarness {...baseProps} selectedCategory="노무비" />,
    );
    // 자재비 effect는 cleanup만, 노무비 effect가 trigger 1회 추가
    expect(triggerSpy).toHaveBeenCalledTimes(2);

    // 노무비 → 자재비 (왕복 1회 완료)
    rerender(
      <TabAutoSyncHarness {...baseProps} selectedCategory="자재비" />,
    );
    expect(triggerSpy).toHaveBeenCalledTimes(3);

    // 자재비 → 노무비 (왕복 2회)
    rerender(
      <TabAutoSyncHarness {...baseProps} selectedCategory="노무비" />,
    );
    expect(triggerSpy).toHaveBeenCalledTimes(4);

    // 디바운스 만료 시점까지 진행 → 변경이 없으므로 실제 저장은 0회
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(probe.performSaveCalls()).toBe(0);

    // 매 탭 진입마다 trigger는 정확히 1회씩만 더해졌어야 한다.
    // (만약 dep 배열에 derived state가 추가되어 같은 전환 안에 effect가
    //  2번 실행되었다면 4가 아닌 5회 이상이 되어 본 단언이 실패한다.)
    expect(triggerSpy.mock.calls.map((c) => c[0])).toEqual([
      "material:tabEnter",
      "labor:tabEnter",
      "material:tabEnter",
      "labor:tabEnter",
    ]);
  });

  it("[보호] 같은 탭 안에서 무관한 prop이 바뀌어도 trigger는 추가 호출되지 않는다", () => {
    // dep 배열에 들어있지 않은 prop이 변해도 effect는 재실행되지 않아야 함.
    // (rowsLength, mergedIlwidaegaCatalogLength는 노무비 effect의 dep이므로
    //  여기서는 자재비 탭에서 검증)
    const triggerSpy = vi.fn();
    const props = defaultHarnessProps({
      triggerSpy,
      selectedCategory: "자재비",
      rowsLength: 3,
      mergedIlwidaegaCatalogLength: 5,
    });

    const { rerender } = render(<TabAutoSyncHarness {...props} />);
    expect(triggerSpy).toHaveBeenCalledTimes(1);

    // 자재비 effect의 dep이 아닌 값들만 변경 → 추가 trigger 없어야 함
    rerender(
      <TabAutoSyncHarness
        {...props}
        rowsLength={10}
        mergedIlwidaegaCatalogLength={20}
      />,
    );
    expect(triggerSpy).toHaveBeenCalledTimes(1);
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

describe("[Task #13] field-estimate.tsx 탭 진입 useEffect deps 정적 검증", () => {
  const SOURCE = readFieldEstimateSource();

  it("자재비 탭 진입 useEffect의 dep 배열이 허용된 식별자 집합과 정확히 일치한다", () => {
    // L2567~L2588 useEffect 시그니처 매칭. 핵심 본문 + dep 배열을 한 번에 캡쳐.
    const re =
      /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(selectedCategory\s*!==\s*"자재비"\)[^]*?triggerAutoSaveAfterSync\("material:tabEnter"\);\s*\}\s*,\s*\[([^\]]+)\]\);/;
    const match = SOURCE.match(re);
    expect(
      match,
      "자재비 탭 진입 useEffect 블록을 찾지 못했습니다 — dep 배열 검증을 위해 구조를 유지해야 합니다.",
    ).not.toBeNull();
    const deps = normalizeDeps(match![1]);
    expect(deps.sort()).toEqual(
      [
        "selectedCategory",
        "isAutoSyncEligibleCase",
        "isPartner",
        "currentUser",
      ].sort(),
    );
  });

  it("노무비 탭 진입 useEffect의 dep 배열이 허용된 식별자 집합과 정확히 일치한다", () => {
    const re =
      /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(selectedCategory\s*!==\s*"노무비"\)[^]*?triggerAutoSaveAfterSync\("labor:tabEnter"\);\s*\}\s*,\s*\[([^\]]+)\]\);/;
    const match = SOURCE.match(re);
    expect(
      match,
      "노무비 탭 진입 useEffect 블록을 찾지 못했습니다 — dep 배열 검증을 위해 구조를 유지해야 합니다.",
    ).not.toBeNull();
    const deps = normalizeDeps(match![1]);
    expect(deps.sort()).toEqual(
      [
        "selectedCategory",
        "mergedIlwidaegaCatalog.length",
        "rows.length",
        "isAutoSyncEligibleCase",
        "isPartner",
        "currentUser",
      ].sort(),
    );
  });
});
