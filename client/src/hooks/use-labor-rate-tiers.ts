import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { LaborRateTier } from "@shared/schema";

export function useLaborRateTiers() {
  return useQuery<LaborRateTier[]>({
    queryKey: ["/api/labor-rate-tiers"],
  });
}

export function useUpdateLaborRateTiers() {
  return useMutation({
    mutationFn: async (tiers: { id: number; minRatio: number; rateMultiplier: number }[]) => {
      const response = await apiRequest("PUT", "/api/labor-rate-tiers", { tiers });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rate-tiers"] });
    },
  });
}

export function calculateFWithTiers(
  C: number,
  D: number,
  E: number,
  tiers: LaborRateTier[]
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
  F: number
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
  tiers: LaborRateTier[]
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
  tiers: LaborRateTier[]
): number {
  if (C <= 0 || D <= 0) return 0;

  const I = calculateIWithTiers(C, D, E, tiers);
  return Math.round(I / C);
}

export const DEFAULT_LABOR_RATE_TIERS_FALLBACK: LaborRateTier[] = [
  { id: 1, minRatio: 85, rateMultiplier: 100, sortOrder: 1, createdAt: new Date(), updatedAt: new Date() },
  { id: 2, minRatio: 80, rateMultiplier: 95, sortOrder: 2, createdAt: new Date(), updatedAt: new Date() },
  { id: 3, minRatio: 75, rateMultiplier: 82, sortOrder: 3, createdAt: new Date(), updatedAt: new Date() },
  { id: 4, minRatio: 70, rateMultiplier: 74, sortOrder: 4, createdAt: new Date(), updatedAt: new Date() },
  { id: 5, minRatio: 65, rateMultiplier: 66, sortOrder: 5, createdAt: new Date(), updatedAt: new Date() },
  { id: 6, minRatio: 60, rateMultiplier: 58, sortOrder: 6, createdAt: new Date(), updatedAt: new Date() },
  { id: 7, minRatio: 50, rateMultiplier: 50, sortOrder: 7, createdAt: new Date(), updatedAt: new Date() },
  { id: 8, minRatio: 0, rateMultiplier: 45, sortOrder: 8, createdAt: new Date(), updatedAt: new Date() },
];
