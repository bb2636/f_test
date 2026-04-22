import type { LaborCostRow } from "@/components/labor-cost-section";
import type { LaborRateTier } from "@shared/schema";
import {
  calculateIWithTiers,
  calculateAppliedUnitPriceWithTiers,
  calculateQuantityWithTiers,
} from "@/hooks/use-labor-rate-tiers";

export interface MergedLaborCostRow extends LaborCostRow {
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

export const isMergeableLaborRow = (row: LaborCostRow): boolean => {
  if (row.category === "철거공사" || row.category === "피해철거공사") return true;
  if (
    (row.category === "가구공사" || row.category === "욕실공사") &&
    isFixedLaborWorkName(row.workName || "")
  )
    return true;
  return false;
};

export function mergeDemolitionRows(
  inputRows: LaborCostRow[],
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
        existing.mergedSourceIds = existing.mergedSourceIds || [existing.id];
        existing.mergedSourceIds.push(row.id);
        existing.damageArea =
          (existing.damageArea || 0) + (row.damageArea || 0);

        if (isFixedItem) {
          const prevQty = existing.mergedQuantity ?? existing.quantity ?? 0;
          const prevAmt = existing.mergedAmount ?? existing.amount ?? 0;
          existing.mergedQuantity =
            Math.round((prevQty + (row.quantity || 0)) * 10) / 10;
          existing.mergedAmount = prevAmt + (row.amount || 0);
        } else {
          const C = existing.damageArea;
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
              (existing.mergedQuantity || existing.quantity) + row.quantity;
            existing.mergedAmount = Math.round(
              C * (existing.pricePerSqm || 0),
            );
          }
        }
      } else {
        const mergedRow: MergedLaborCostRow = {
          ...row,
          mergedSourceIds: [row.id],
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
  if (row.mergedAmount != null) return row.mergedAmount;
  const isIlw = row.detailWork === "일위대가";
  const C = row.damageArea || 0;
  const D = row.standardWorkQuantity || 0;
  const E = row.standardPrice || 0;
  if (isIlw && C > 0 && D > 0 && E > 0) {
    return calculateIWithTiers(C, D, E, laborRateTiers);
  }
  return row.amount || 0;
}
