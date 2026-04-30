import type { LaborRateTier } from "./schema";
import {
  calculateIWithTiers,
  calculateAppliedUnitPriceWithTiers,
  calculateQuantityWithTiers,
} from "./labor-rate-tiers-utils";

export interface LaborCostRowLike {
  id?: string;
  category?: string;
  workName?: string;
  detailItem?: string;
  detailWork?: string;
  unit?: string;
  standardPrice?: number;
  damageArea?: number;
  standardWorkQuantity?: number;
  pricePerSqm?: number;
  quantity?: number;
  amount?: number;
  includeInEstimate?: boolean;
  [key: string]: any;
}

export interface MergedLaborCostRow extends LaborCostRowLike {
  mergedSourceIds?: string[];
  mergedQuantity?: number;
  mergedAmount?: number;
}

export const FIXED_LABOR_WORK_NAMES = [
  "SMC",
  "리빙보드",
  "도기류",
  "붙박이장",
  "상부장",
  "하부장",
  "상부장&하부장",
  "키큰장",
  "상부장&키큰장",
  "상부장&하부장&키큰장",
];

export const isFixedLaborWorkName = (wn?: string): boolean =>
  FIXED_LABOR_WORK_NAMES.includes(wn || "");

export const isMergeableLaborRow = (row: LaborCostRowLike): boolean => {
  if (row.category === "철거공사" || row.category === "피해철거공사") return true;
  if (
    (row.category === "가구공사" || row.category === "욕실공사") &&
    isFixedLaborWorkName(row.workName || "")
  )
    return true;
  return false;
};

export function mergeDemolitionRows<T extends LaborCostRowLike>(
  inputRows: T[],
  laborRateTiers: LaborRateTier[],
): MergedLaborCostRow[] {
  const result: MergedLaborCostRow[] = [];
  const demolitionMap = new Map<string, MergedLaborCostRow>();

  inputRows.forEach((row) => {
    if (isMergeableLaborRow(row)) {
      const mergeKey = `${row.category}|${row.workName}|${row.detailItem}|${row.unit}|${row.standardPrice}`;
      const isFixedItem = isFixedLaborWorkName(row.workName || "");

      if (demolitionMap.has(mergeKey)) {
        const existing = demolitionMap.get(mergeKey)!;
        existing.mergedSourceIds = existing.mergedSourceIds || [existing.id!];
        existing.mergedSourceIds.push(row.id!);
        existing.damageArea =
          (existing.damageArea || 0) + (row.damageArea || 0);

        if (isFixedItem) {
          const prevQty = existing.mergedQuantity ?? existing.quantity ?? 0;
          const prevAmt = existing.mergedAmount ?? existing.amount ?? 0;
          existing.mergedQuantity =
            Math.round((prevQty + (row.quantity || 0)) * 10) / 10;
          existing.mergedAmount = prevAmt + (row.amount || 0);
        } else {
          const C = existing.damageArea || 0;
          const D = existing.standardWorkQuantity || 0;
          const E = existing.standardPrice || 0;
          if (D > 0 && E > 0 && C > 0) {
            existing.mergedAmount = calculateIWithTiers(
              C,
              D,
              E,
              laborRateTiers,
            );
            existing.pricePerSqm = calculateAppliedUnitPriceWithTiers(
              C,
              D,
              E,
              laborRateTiers,
            );
            existing.mergedQuantity = calculateQuantityWithTiers(
              C,
              D,
              E,
              laborRateTiers,
            );
          } else {
            existing.mergedQuantity =
              (existing.mergedQuantity || existing.quantity || 0) + (row.quantity || 0);
            existing.mergedAmount = Math.round(
              C * (existing.pricePerSqm || 0),
            );
          }
        }
      } else {
        const mergedRow: MergedLaborCostRow = {
          ...row,
          mergedSourceIds: [row.id!],
          mergedQuantity: row.quantity,
          mergedAmount: row.amount,
        };
        demolitionMap.set(mergeKey, mergedRow);
        result.push(mergedRow);
      }
    } else {
      result.push({ ...row });
    }
  });

  return result;
}

export function getMergedRowAmount(
  row: MergedLaborCostRow,
  laborRateTiers: LaborRateTier[],
): number {
  // [금액일관성] 관리자 노무비 화면(labor-cost-section.tsx 합계 셀)과 동일 로직.
  // - FIXED 일위대가(가구/욕실 SMC·리빙보드·도기류·붙박이장 등)는 면적 무관 합산이므로
  //   머지/저장값(mergedAmount→amount) 우선.
  // - 그 외 일반 일위대가(C>0, D>0, E>0)는 매번 calculateIWithTiers로 동적 계산.
  //   DB에 옛 산식 mergedAmount/amount가 박혀 있어도 화면/PDF/footer 표시가 항상 새 산식과 일치.
  // - 비일위대가/손해방지/D=0 등은 기존 동작대로 머지값→저장값 폴백 (피해복구·손방 안전 보존).
  const isIlw = row.detailWork === "일위대가";
  const isFixed = isIlw && isFixedLaborWorkName(row.workName);
  if (isFixed) {
    return row.mergedAmount ?? row.amount ?? 0;
  }
  const C = row.damageArea || 0;
  const D = row.standardWorkQuantity || 0;
  const E = row.standardPrice || 0;
  if (isIlw && C > 0 && D > 0 && E > 0) {
    return calculateIWithTiers(C, D, E, laborRateTiers);
  }
  return row.mergedAmount ?? row.amount ?? 0;
}
