import type { LaborRateTier } from "./schema";

export function calculateFWithTiers(
  C: number,
  D: number,
  E: number,
  tiers: LaborRateTier[],
): number {
  if (D <= 0 || E <= 0) return 0;

  const ratio = C / D;
  const ratioPercent = ratio * 100;

  const sortedTiers = [...tiers].sort((a, b) => b.minRatio - a.minRatio);

  for (const tier of sortedTiers) {
    if (ratioPercent >= tier.minRatio) {
      return E * (tier.rateMultiplier / 100);
    }
  }

  const lastTier = sortedTiers[sortedTiers.length - 1];
  return E * ((lastTier?.rateMultiplier ?? 45) / 100);
}

export function calculateHWithTiers(
  C: number,
  D: number,
  E: number,
  F: number,
): number {
  if (D <= 0) return 0;

  if (C >= D) {
    return (C - D) * (E / D);
  } else {
    return 0;
  }
}

export function calculateIWithTiers(
  C: number,
  D: number,
  E: number,
  tiers: LaborRateTier[],
): number {
  if (D <= 0 || C <= 0) return 0;

  const F = calculateFWithTiers(C, D, E, tiers);
  const H = calculateHWithTiers(C, D, E, F);
  const I = F + H;

  return Math.round(I);
}

export function calculateAppliedUnitPriceWithTiers(
  C: number,
  D: number,
  E: number,
  tiers: LaborRateTier[],
): number {
  if (E <= 0) return 0;
  return Math.round(E);
}

export function calculateQuantityWithTiers(
  C: number,
  D: number,
  E: number,
  tiers: LaborRateTier[],
): number {
  if (D <= 0 || E <= 0 || C <= 0) return 0;
  const I = calculateIWithTiers(C, D, E, tiers);
  if (E <= 0) return 0;
  const raw = I / E;
  return raw >= 0.1
    ? Math.round(raw * 10) / 10
    : parseFloat(raw.toPrecision(1));
}

export const DEFAULT_LABOR_RATE_TIERS_FALLBACK: LaborRateTier[] = [
  { id: 1, minRatio: 85, rateMultiplier: 100, sortOrder: 1, createdAt: new Date(), updatedAt: new Date() },
  { id: 2, minRatio: 80, rateMultiplier: 95, sortOrder: 2, createdAt: new Date(), updatedAt: new Date() },
  { id: 3, minRatio: 75, rateMultiplier: 90, sortOrder: 3, createdAt: new Date(), updatedAt: new Date() },
  { id: 4, minRatio: 70, rateMultiplier: 85, sortOrder: 4, createdAt: new Date(), updatedAt: new Date() },
  { id: 5, minRatio: 65, rateMultiplier: 80, sortOrder: 5, createdAt: new Date(), updatedAt: new Date() },
  { id: 6, minRatio: 60, rateMultiplier: 75, sortOrder: 6, createdAt: new Date(), updatedAt: new Date() },
  { id: 7, minRatio: 55, rateMultiplier: 70, sortOrder: 7, createdAt: new Date(), updatedAt: new Date() },
  { id: 8, minRatio: 50, rateMultiplier: 65, sortOrder: 8, createdAt: new Date(), updatedAt: new Date() },
  { id: 9, minRatio: 45, rateMultiplier: 60, sortOrder: 9, createdAt: new Date(), updatedAt: new Date() },
  { id: 10, minRatio: 40, rateMultiplier: 55, sortOrder: 10, createdAt: new Date(), updatedAt: new Date() },
  { id: 11, minRatio: 35, rateMultiplier: 50, sortOrder: 11, createdAt: new Date(), updatedAt: new Date() },
  { id: 12, minRatio: 30, rateMultiplier: 45, sortOrder: 12, createdAt: new Date(), updatedAt: new Date() },
  { id: 13, minRatio: 0, rateMultiplier: 40, sortOrder: 13, createdAt: new Date(), updatedAt: new Date() },
];
