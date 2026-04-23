import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { LaborRateTier } from "@shared/schema";

// 계산 함수들은 shared로 이동됨. client/server 동일 로직 사용 보장.
export {
  calculateFWithTiers,
  calculateHWithTiers,
  calculateIWithTiers,
  calculateAppliedUnitPriceWithTiers,
  calculateQuantityWithTiers,
  DEFAULT_LABOR_RATE_TIERS_FALLBACK,
} from "@shared/labor-rate-tiers-utils";

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
