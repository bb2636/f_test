import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { User, Case } from "@shared/schema";
import { Search, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format, startOfMonth, endOfMonth, parseISO, isWithinInterval, isBefore, differenceInDays, differenceInMonths } from "date-fns";
import { ko } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const headerStyle = {
  padding: "12px 8px",
  fontFamily: "Pretendard",
  fontSize: "14px",
  fontWeight: 600,
  lineHeight: "128%",
  letterSpacing: "-0.02em",
  color: "rgba(12, 12, 12, 0.6)",
  borderRight: "1px solid rgba(12, 12, 12, 0.06)",
  borderBottom: "1px solid rgba(12, 12, 12, 0.06)",
  textAlign: "center" as const,
  background: "rgba(12, 12, 12, 0.04)",
};

const cellStyle = {
  padding: "12px 8px",
  fontFamily: "Pretendard",
  fontSize: "14px",
  lineHeight: "128%",
  letterSpacing: "-0.02em",
  color: "rgba(12, 12, 12, 0.8)",
  borderRight: "1px solid rgba(12, 12, 12, 0.06)",
  borderBottom: "1px solid rgba(12, 12, 12, 0.06)",
  textAlign: "center" as const,
};

// 종결 상태 목록
const CLOSED_STATUSES = [
  "정산완료",
  "입금완료",
  "부분입금",
  "접수취소",
];

// 직접복구 관련 상태 확인
const isDirectRecovery = (caseItem: Case): boolean => {
  return caseItem.recoveryType === "직접복구" || 
         caseItem.restorationMethod === "직접복구" ||
         caseItem.status === "직접복구" ||
         caseItem.status === "청구자료제출(복구)";
};

// 선견적요청 관련 상태 확인
const isPreEstimate = (caseItem: Case): boolean => {
  return caseItem.recoveryType === "선견적요청" || 
         caseItem.restorationMethod === "선견적요청" ||
         caseItem.status === "선견적요청" ||
         caseItem.status === "출동비청구(선견적)";
};

// 종결 상태인지 확인
const isClosed = (caseItem: Case): boolean => {
  return CLOSED_STATUSES.includes(caseItem.status);
};

// 상태 매핑 (DB 상태 -> 표시용 상태)
const mapStatusToProgress = (status: string): string => {
  if (status === "접수완료") return "접수완료";
  if (status === "현장방문") return "현장방문";
  if (status === "현장정보입력") return "현장정보입력";
  if (status === "현장정보제출" || status === "검토중" || status === "1차승인") return "현장정보제출";
  if (status === "복구요청(2차승인)" || status === "직접복구") return "복구요청";
  if (status === "선견적요청" || status === "출동비청구(선견적)") return "출동비청구";
  if (status === "청구" || status === "청구자료제출(복구)") return "청구";
  if (status === "접수취소") return "접수취소";
  return "접수완료";
};

// 수리비 금액 계층 분류
const getRepairCostTier = (amount: number): string => {
  if (amount < 1000000) return "1백만미만";
  if (amount < 2000000) return "2백만미만";
  if (amount < 3000000) return "3백만미만";
  if (amount < 5000000) return "5백만미만";
  if (amount < 10000000) return "1천만미만";
  return "1천만초과";
};

// 기간 계층 분류 (현재 날짜 기준으로 케이스 생성일부터 경과된 기간)
const getPeriodTier = (createdAt: Date, now: Date): string => {
  const months = differenceInMonths(now, createdAt);
  const days = differenceInDays(now, createdAt);
  
  if (months < 1 || days < 30) return "~1개월";
  if (months < 3) return "~3개월";
  if (months < 6) return "~6개월";
  if (months < 12) return "~1년";
  return "1년~";
};

interface StatisticsOverviewProps {
  mode?: "closed" | "unsettled";
}

export default function StatisticsOverview({ mode = "closed" }: StatisticsOverviewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const defaultTab = mode === "unsettled" ? "미결" : "수임";
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [activeSubFilter, setActiveSubFilter] = useState(mode === "unsettled" ? "진행과정별" : "");

  useEffect(() => {
    const newDefaultTab = mode === "unsettled" ? "미결" : "수임";
    setActiveTab(newDefaultTab);
    if (mode === "unsettled") {
      setActiveSubFilter("진행과정별");
    } else {
      setActiveSubFilter("");
    }
  }, [mode]);
  
  const [startDate, setStartDate] = useState<Date>(startOfMonth(new Date()));
  const [endDate, setEndDate] = useState<Date>(endOfMonth(new Date()));
  const [calendarOpen, setCalendarOpen] = useState(false);

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const { data: cases = [] } = useQuery<Case[]>({
    queryKey: ["/api/cases"],
  });

  // 평균 수리비 항목별 통계 쿼리
  interface AvgRepairCostByCategoryData {
    손해정지비용: Record<string, number>;
    대물수리비용: Record<string, number>;
    총계: number;
    건수: number;
  }
  const { data: avgRepairCostData } = useQuery<AvgRepairCostByCategoryData>({
    queryKey: ["/api/statistics/avg-repair-cost-by-category", format(startDate, "yyyy-MM-dd"), format(endDate, "yyyy-MM-dd")],
  });

  // 수임 탭 통계 계산
  const statistics = useMemo(() => {
    if (!cases.length) {
      return {
        이월: { 직접복구: 0, 선견적요청: 0, 계: 0 },
        수임: { 직접복구: 0, 선견적요청: 0, 계: 0 },
        종결: {
          직접복구: { 직접복구: 0, 선견적요청: 0, 접수취소: 0, 소계: 0 },
          선견적요청: { 직접복구: 0, 선견적요청: 0, 접수취소: 0, 소계: 0 },
          합계: { 직접복구: 0, 선견적요청: 0, 접수취소: 0, 소계: 0 },
        },
        처리율: 0,
        미결: { 직접복구: 0, 선견적요청: 0, 계: 0 },
      };
    }

    const 이월_직접복구 = cases.filter(c => {
      const createdAt = parseISO(c.createdAt);
      return isBefore(createdAt, startDate) && !isClosed(c) && isDirectRecovery(c);
    }).length;

    const 이월_선견적요청 = cases.filter(c => {
      const createdAt = parseISO(c.createdAt);
      return isBefore(createdAt, startDate) && !isClosed(c) && isPreEstimate(c);
    }).length;

    const 수임_직접복구 = cases.filter(c => {
      try {
        const createdAt = parseISO(c.createdAt);
        return isWithinInterval(createdAt, { start: startDate, end: endDate }) && isDirectRecovery(c);
      } catch {
        return false;
      }
    }).length;

    const 수임_선견적요청 = cases.filter(c => {
      try {
        const createdAt = parseISO(c.createdAt);
        return isWithinInterval(createdAt, { start: startDate, end: endDate }) && isPreEstimate(c);
      } catch {
        return false;
      }
    }).length;

    const closedInPeriod = cases.filter(c => {
      try {
        const createdAt = parseISO(c.createdAt);
        return isClosed(c) && isWithinInterval(createdAt, { start: startDate, end: endDate });
      } catch {
        return false;
      }
    });

    const 종결_직접복구_직접복구 = closedInPeriod.filter(c => 
      isDirectRecovery(c) && c.status === "정산완료"
    ).length;
    const 종결_직접복구_선견적요청 = closedInPeriod.filter(c => 
      isDirectRecovery(c) && (c.status === "입금완료" || c.status === "부분입금")
    ).length;
    const 종결_직접복구_접수취소 = closedInPeriod.filter(c => 
      isDirectRecovery(c) && c.status === "접수취소"
    ).length;

    const 종결_선견적요청_직접복구 = closedInPeriod.filter(c => 
      isPreEstimate(c) && c.status === "정산완료"
    ).length;
    const 종결_선견적요청_선견적요청 = closedInPeriod.filter(c => 
      isPreEstimate(c) && (c.status === "입금완료" || c.status === "부분입금")
    ).length;
    const 종결_선견적요청_접수취소 = closedInPeriod.filter(c => 
      isPreEstimate(c) && c.status === "접수취소"
    ).length;

    const 종결_직접복구_소계 = 종결_직접복구_직접복구 + 종결_직접복구_선견적요청 + 종결_직접복구_접수취소;
    const 종결_선견적요청_소계 = 종결_선견적요청_직접복구 + 종결_선견적요청_선견적요청 + 종결_선견적요청_접수취소;

    const 종결_합계_직접복구 = 종결_직접복구_직접복구 + 종결_선견적요청_직접복구;
    const 종결_합계_선견적요청 = 종결_직접복구_선견적요청 + 종결_선견적요청_선견적요청;
    const 종결_합계_접수취소 = 종결_직접복구_접수취소 + 종결_선견적요청_접수취소;
    const 종결_합계_소계 = 종결_직접복구_소계 + 종결_선견적요청_소계;

    const 이월_계 = 이월_직접복구 + 이월_선견적요청;
    const 수임_계 = 수임_직접복구 + 수임_선견적요청;
    const 종결_계 = 종결_합계_소계;

    const 미결_직접복구 = 이월_직접복구 + 수임_직접복구 - 종결_직접복구_소계;
    const 미결_선견적요청 = 이월_선견적요청 + 수임_선견적요청 - 종결_선견적요청_소계;
    const 미결_계 = 미결_직접복구 + 미결_선견적요청;

    const total = 이월_계 + 수임_계;
    const 처리율 = total > 0 ? Math.round((종결_계 / total) * 100) : 0;

    return {
      이월: { 직접복구: 이월_직접복구, 선견적요청: 이월_선견적요청, 계: 이월_계 },
      수임: { 직접복구: 수임_직접복구, 선견적요청: 수임_선견적요청, 계: 수임_계 },
      종결: {
        직접복구: { 
          직접복구: 종결_직접복구_직접복구, 
          선견적요청: 종결_직접복구_선견적요청, 
          접수취소: 종결_직접복구_접수취소, 
          소계: 종결_직접복구_소계 
        },
        선견적요청: { 
          직접복구: 종결_선견적요청_직접복구, 
          선견적요청: 종결_선견적요청_선견적요청, 
          접수취소: 종결_선견적요청_접수취소, 
          소계: 종결_선견적요청_소계 
        },
        합계: { 
          직접복구: 종결_합계_직접복구, 
          선견적요청: 종결_합계_선견적요청, 
          접수취소: 종결_합계_접수취소, 
          소계: 종결_합계_소계 
        },
      },
      처리율,
      미결: { 직접복구: 미결_직접복구, 선견적요청: 미결_선견적요청, 계: 미결_계 },
    };
  }, [cases, startDate, endDate]);

  // 미결 - 진행과정별 통계 계산
  const progressStatistics = useMemo(() => {
    if (!cases.length) {
      return {
        직접복구: { 접수완료: 0, 현장방문: 0, 현장정보입력: 0, 현장정보제출: 0, 복구요청: 0, 출동비청구: 0, 청구: 0, 접수취소: 0, 계: 0 },
        선견적요청: { 접수완료: 0, 현장방문: 0, 현장정보입력: 0, 현장정보제출: 0, 복구요청: 0, 출동비청구: 0, 청구: 0, 접수취소: 0, 계: 0 },
        합계: { 접수완료: 0, 현장방문: 0, 현장정보입력: 0, 현장정보제출: 0, 복구요청: 0, 출동비청구: 0, 청구: 0, 접수취소: 0, 계: 0 },
      };
    }

    const unsettledCases = cases.filter(c => {
      try {
        const createdAt = parseISO(c.createdAt);
        const isInPeriod = isWithinInterval(createdAt, { start: startDate, end: endDate }) || isBefore(createdAt, startDate);
        return !isClosed(c) && isInPeriod;
      } catch {
        return false;
      }
    });

    const directRecoveryCases = unsettledCases.filter(isDirectRecovery);
    const 직접복구_접수완료 = directRecoveryCases.filter(c => mapStatusToProgress(c.status) === "접수완료").length;
    const 직접복구_현장방문 = directRecoveryCases.filter(c => mapStatusToProgress(c.status) === "현장방문").length;
    const 직접복구_현장정보입력 = directRecoveryCases.filter(c => mapStatusToProgress(c.status) === "현장정보입력").length;
    const 직접복구_현장정보제출 = directRecoveryCases.filter(c => mapStatusToProgress(c.status) === "현장정보제출").length;
    const 직접복구_복구요청 = directRecoveryCases.filter(c => mapStatusToProgress(c.status) === "복구요청").length;
    const 직접복구_출동비청구 = directRecoveryCases.filter(c => mapStatusToProgress(c.status) === "출동비청구").length;
    const 직접복구_청구 = directRecoveryCases.filter(c => mapStatusToProgress(c.status) === "청구").length;
    const 직접복구_접수취소 = directRecoveryCases.filter(c => mapStatusToProgress(c.status) === "접수취소").length;
    const 직접복구_계 = directRecoveryCases.length;

    const preEstimateCases = unsettledCases.filter(isPreEstimate);
    const 선견적요청_접수완료 = preEstimateCases.filter(c => mapStatusToProgress(c.status) === "접수완료").length;
    const 선견적요청_현장방문 = preEstimateCases.filter(c => mapStatusToProgress(c.status) === "현장방문").length;
    const 선견적요청_현장정보입력 = preEstimateCases.filter(c => mapStatusToProgress(c.status) === "현장정보입력").length;
    const 선견적요청_현장정보제출 = preEstimateCases.filter(c => mapStatusToProgress(c.status) === "현장정보제출").length;
    const 선견적요청_복구요청 = preEstimateCases.filter(c => mapStatusToProgress(c.status) === "복구요청").length;
    const 선견적요청_출동비청구 = preEstimateCases.filter(c => mapStatusToProgress(c.status) === "출동비청구").length;
    const 선견적요청_청구 = preEstimateCases.filter(c => mapStatusToProgress(c.status) === "청구").length;
    const 선견적요청_접수취소 = preEstimateCases.filter(c => mapStatusToProgress(c.status) === "접수취소").length;
    const 선견적요청_계 = preEstimateCases.length;

    return {
      직접복구: { 접수완료: 직접복구_접수완료, 현장방문: 직접복구_현장방문, 현장정보입력: 직접복구_현장정보입력, 현장정보제출: 직접복구_현장정보제출, 복구요청: 직접복구_복구요청, 출동비청구: 직접복구_출동비청구, 청구: 직접복구_청구, 접수취소: 직접복구_접수취소, 계: 직접복구_계 },
      선견적요청: { 접수완료: 선견적요청_접수완료, 현장방문: 선견적요청_현장방문, 현장정보입력: 선견적요청_현장정보입력, 현장정보제출: 선견적요청_현장정보제출, 복구요청: 선견적요청_복구요청, 출동비청구: 선견적요청_출동비청구, 청구: 선견적요청_청구, 접수취소: 선견적요청_접수취소, 계: 선견적요청_계 },
      합계: {
        접수완료: 직접복구_접수완료 + 선견적요청_접수완료,
        현장방문: 직접복구_현장방문 + 선견적요청_현장방문,
        현장정보입력: 직접복구_현장정보입력 + 선견적요청_현장정보입력,
        현장정보제출: 직접복구_현장정보제출 + 선견적요청_현장정보제출,
        복구요청: 직접복구_복구요청 + 선견적요청_복구요청,
        출동비청구: 직접복구_출동비청구 + 선견적요청_출동비청구,
        청구: 직접복구_청구 + 선견적요청_청구,
        접수취소: 직접복구_접수취소 + 선견적요청_접수취소,
        계: 직접복구_계 + 선견적요청_계,
      },
    };
  }, [cases, startDate, endDate]);

  // 미결 - 수리비 금액계층별 통계 계산
  const repairCostStatistics = useMemo(() => {
    const tiers = ["1백만미만", "2백만미만", "3백만미만", "5백만미만", "1천만미만", "1천만초과"];
    const defaultTier = { 건수: 0, 퍼센트: 0 };
    const defaultStats = Object.fromEntries(tiers.map(t => [t, { ...defaultTier }])) as Record<string, { 건수: number; 퍼센트: number }>;

    if (!cases.length) {
      return { ...defaultStats, 계: 0 };
    }

    const unsettledCases = cases.filter(c => {
      try {
        const createdAt = parseISO(c.createdAt);
        const isInPeriod = isWithinInterval(createdAt, { start: startDate, end: endDate }) || isBefore(createdAt, startDate);
        return !isClosed(c) && isInPeriod;
      } catch {
        return false;
      }
    });

    const total = unsettledCases.length;
    const tierCounts = Object.fromEntries(tiers.map(t => [t, 0])) as Record<string, number>;

    unsettledCases.forEach(c => {
      const amount = c.estimateAmount ? parseInt(c.estimateAmount, 10) : 0;
      const tier = getRepairCostTier(amount);
      if (tierCounts[tier] !== undefined) {
        tierCounts[tier]++;
      }
    });

    const result = Object.fromEntries(
      tiers.map(t => [t, {
        건수: tierCounts[t],
        퍼센트: total > 0 ? Math.round((tierCounts[t] / total) * 100) : 0,
      }])
    ) as Record<string, { 건수: number; 퍼센트: number }>;

    return { ...result, 계: total };
  }, [cases, startDate, endDate]);

  // 미결 - 기간별 통계 계산
  const periodStatistics = useMemo(() => {
    const tiers = ["~1개월", "~3개월", "~6개월", "~1년", "1년~"];
    const defaultTier = { 건수: 0, 퍼센트: 0 };
    const defaultStats = Object.fromEntries(tiers.map(t => [t, { ...defaultTier }])) as Record<string, { 건수: number; 퍼센트: number }>;

    if (!cases.length) {
      return { ...defaultStats, 계: 0 };
    }

    const now = new Date();
    const unsettledCases = cases.filter(c => {
      try {
        const createdAt = parseISO(c.createdAt);
        const isInPeriod = isWithinInterval(createdAt, { start: startDate, end: endDate }) || isBefore(createdAt, startDate);
        return !isClosed(c) && isInPeriod;
      } catch {
        return false;
      }
    });

    const total = unsettledCases.length;
    const tierCounts = Object.fromEntries(tiers.map(t => [t, 0])) as Record<string, number>;

    unsettledCases.forEach(c => {
      try {
        const createdAt = parseISO(c.createdAt);
        const tier = getPeriodTier(createdAt, now);
        if (tierCounts[tier] !== undefined) {
          tierCounts[tier]++;
        }
      } catch {
        // Skip invalid dates
      }
    });

    const result = Object.fromEntries(
      tiers.map(t => [t, {
        건수: tierCounts[t],
        퍼센트: total > 0 ? Math.round((tierCounts[t] / total) * 100) : 0,
      }])
    ) as Record<string, { 건수: number; 퍼센트: number }>;

    return { ...result, 계: total };
  }, [cases, startDate, endDate]);

  // 직접복구 - 완료건 금액계층별 통계 계산
  const completedCostStatistics = useMemo(() => {
    const tiers = ["~1,000,000", "~2,000,000", "~3,000,000", "~5,000,000", "~10,000,000", "10,000,000~"];
    const defaultTier = { 건수: 0, 퍼센트: 0 };
    const defaultStats = Object.fromEntries(tiers.map(t => [t, { ...defaultTier }])) as Record<string, { 건수: number; 퍼센트: number }>;

    if (!cases.length) {
      return { ...defaultStats, 총건수: 0, 평균수리비: 0 };
    }

    // 완료된 직접복구 케이스 (기간 내)
    const completedCases = cases.filter(c => {
      try {
        const createdAt = parseISO(c.createdAt);
        const isInPeriod = isWithinInterval(createdAt, { start: startDate, end: endDate });
        return isClosed(c) && isDirectRecovery(c) && isInPeriod;
      } catch {
        return false;
      }
    });

    const total = completedCases.length;
    const tierCounts = Object.fromEntries(tiers.map(t => [t, 0])) as Record<string, number>;
    let totalAmount = 0;

    completedCases.forEach(c => {
      const amount = c.estimateAmount ? parseInt(c.estimateAmount, 10) : 0;
      totalAmount += amount;
      
      // 금액 계층 분류
      if (amount < 1000000) {
        tierCounts["~1,000,000"]++;
      } else if (amount < 2000000) {
        tierCounts["~2,000,000"]++;
      } else if (amount < 3000000) {
        tierCounts["~3,000,000"]++;
      } else if (amount < 5000000) {
        tierCounts["~5,000,000"]++;
      } else if (amount < 10000000) {
        tierCounts["~10,000,000"]++;
      } else {
        tierCounts["10,000,000~"]++;
      }
    });

    const result = Object.fromEntries(
      tiers.map(t => [t, {
        건수: tierCounts[t],
        퍼센트: total > 0 ? Math.round((tierCounts[t] / total) * 100) : 0,
      }])
    ) as Record<string, { 건수: number; 퍼센트: number }>;

    const avgRepairCost = total > 0 ? Math.round(totalAmount / total) : 0;

    return { ...result, 총건수: total, 평균수리비: avgRepairCost };
  }, [cases, startDate, endDate]);

  // 직접복구 - 종결건 진행과정별 통계 계산
  const closedProgressStatistics = useMemo(() => {
    const defaultStats = {
      현장방문: 0,
      현장정보입력: 0,
      직접복구: 0,
      청구자료제출: 0,
      청구: 0,
      입금완료: 0,
    };

    if (!cases.length) {
      return {
        직접복구의뢰건: { ...defaultStats },
        선견적의뢰건: { ...defaultStats },
      };
    }

    // 종결된 케이스만 필터링 (기간 내)
    const closedCases = cases.filter(c => {
      try {
        const createdAt = parseISO(c.createdAt);
        const isInPeriod = isWithinInterval(createdAt, { start: startDate, end: endDate });
        return isClosed(c) && isInPeriod;
      } catch {
        return false;
      }
    });

    // 직접복구 의뢰건 (직접복구 타입으로 종결된 건)
    const directRecoveryClosed = closedCases.filter(isDirectRecovery);
    const 직접복구_현장방문 = directRecoveryClosed.filter(c => c.status === "현장방문" || c.visitDate).length;
    const 직접복구_현장정보입력 = directRecoveryClosed.filter(c => c.status === "현장정보입력" || c.fieldInfoInputDate).length;
    const 직접복구_직접복구 = directRecoveryClosed.filter(c => c.status === "직접복구" || c.recoveryType === "직접복구").length;
    const 직접복구_청구자료제출 = directRecoveryClosed.filter(c => c.status === "청구자료제출(복구)" || c.claimSubmitDate).length;
    const 직접복구_청구 = directRecoveryClosed.filter(c => c.status === "청구").length;
    const 직접복구_입금완료 = directRecoveryClosed.filter(c => c.status === "입금완료" || c.status === "정산완료").length;

    // 선견적 의뢰건 (선견적요청 타입으로 종결된 건)
    const preEstimateClosed = closedCases.filter(isPreEstimate);
    const 선견적_현장방문 = preEstimateClosed.filter(c => c.status === "현장방문" || c.visitDate).length;
    const 선견적_현장정보입력 = preEstimateClosed.filter(c => c.status === "현장정보입력" || c.fieldInfoInputDate).length;
    const 선견적_직접복구 = preEstimateClosed.filter(c => c.status === "직접복구" || c.recoveryType === "직접복구").length;
    const 선견적_청구자료제출 = preEstimateClosed.filter(c => c.status === "청구자료제출(복구)" || c.claimSubmitDate).length;
    const 선견적_청구 = preEstimateClosed.filter(c => c.status === "청구").length;
    const 선견적_입금완료 = preEstimateClosed.filter(c => c.status === "입금완료" || c.status === "정산완료").length;

    return {
      직접복구의뢰건: {
        현장방문: 직접복구_현장방문,
        현장정보입력: 직접복구_현장정보입력,
        직접복구: 직접복구_직접복구,
        청구자료제출: 직접복구_청구자료제출,
        청구: 직접복구_청구,
        입금완료: 직접복구_입금완료,
      },
      선견적의뢰건: {
        현장방문: 선견적_현장방문,
        현장정보입력: 선견적_현장정보입력,
        직접복구: 선견적_직접복구,
        청구자료제출: 선견적_청구자료제출,
        청구: 선견적_청구,
        입금완료: 선견적_입금완료,
      },
    };
  }, [cases, startDate, endDate]);

  // 사고 원인별 통계 계산
  const accidentCauseStatistics = useMemo(() => {
    const result = {
      배관: 0,
      방수: 0,
      코킹: 0,
      공용부: 0,
      복합: 0,
      합계: 0,
    };

    if (!cases.length) {
      return result;
    }

    // 기간 내 케이스 필터링
    const filteredCases = cases.filter(c => {
      try {
        const createdAt = parseISO(c.createdAt);
        return isWithinInterval(createdAt, { start: startDate, end: endDate });
      } catch {
        return false;
      }
    });

    filteredCases.forEach(c => {
      const cause = c.accidentCause || '';
      if (cause.includes('배관')) {
        result.배관++;
      } else if (cause.includes('방수')) {
        result.방수++;
      } else if (cause.includes('코킹')) {
        result.코킹++;
      } else if (cause.includes('공용부')) {
        result.공용부++;
      } else if (cause.includes('복합')) {
        result.복합++;
      }
    });

    result.합계 = result.배관 + result.방수 + result.코킹 + result.공용부 + result.복합;
    return result;
  }, [cases, startDate, endDate]);

  // 출동비 청구 - 진행항목 통계 계산
  const dispatchFeeStatistics = useMemo(() => {
    const defaultStats = {
      현장방문: 0,
      현장정보입력: 0,
      청구: 0,
      입금완료: 0,
    };

    if (!cases.length) {
      return {
        직접복구진행항목: { ...defaultStats },
        선견적의뢰건진행항목: { ...defaultStats },
      };
    }

    // 기간 내 케이스 필터링
    const filteredCases = cases.filter(c => {
      try {
        const createdAt = parseISO(c.createdAt);
        return isWithinInterval(createdAt, { start: startDate, end: endDate });
      } catch {
        return false;
      }
    });

    // 직접복구 케이스
    const directRecoveryCases = filteredCases.filter(isDirectRecovery);
    const 직접_현장방문 = directRecoveryCases.filter(c => c.visitDate || c.status === "현장방문").length;
    const 직접_현장정보입력 = directRecoveryCases.filter(c => c.fieldInfoInputDate || c.status === "현장정보입력").length;
    const 직접_청구 = directRecoveryCases.filter(c => c.status === "청구" || c.status === "청구자료제출(복구)").length;
    const 직접_입금완료 = directRecoveryCases.filter(c => c.status === "입금완료" || c.status === "정산완료" || c.status === "부분입금").length;

    // 선견적 의뢰건 케이스
    const preEstimateCases = filteredCases.filter(isPreEstimate);
    const 선견적_현장방문 = preEstimateCases.filter(c => c.visitDate || c.status === "현장방문").length;
    const 선견적_현장정보입력 = preEstimateCases.filter(c => c.fieldInfoInputDate || c.status === "현장정보입력").length;
    const 선견적_청구 = preEstimateCases.filter(c => c.status === "청구" || c.status === "출동비청구(선견적)").length;
    const 선견적_입금완료 = preEstimateCases.filter(c => c.status === "입금완료" || c.status === "정산완료" || c.status === "부분입금").length;

    return {
      직접복구진행항목: {
        현장방문: 직접_현장방문,
        현장정보입력: 직접_현장정보입력,
        청구: 직접_청구,
        입금완료: 직접_입금완료,
      },
      선견적의뢰건진행항목: {
        현장방문: 선견적_현장방문,
        현장정보입력: 선견적_현장정보입력,
        청구: 선견적_청구,
        입금완료: 선견적_입금완료,
      },
    };
  }, [cases, startDate, endDate]);

  if (!user) {
    return null;
  }

  const subFiltersMap: Record<string, string[]> = {
    "미결": ["진행과정별", "수리비 금액계층별", "기간별"],
    "직접복구": ["전체", "종결건 진행과정별", "완료건 금액계층별", "평균 수리비 항목별"],
    "출동비 청구": ["전체"],
    "사고확인": ["사고 원인별"],
  };

  const tabList = mode === "unsettled"
    ? ["미결"]
    : ["수임", "직접복구", "출동비 청구", "사고확인"];

  const pageTitle = mode === "unsettled" ? "미결건 통계" : "종결건 통계";
  
  const currentSubFilters = subFiltersMap[activeTab] || [];
  const periodText = `${format(startDate, "yyyy.MM.dd")} - ${format(endDate, "yyyy.MM.dd")}`;

  // 수임 테이블 렌더링
  const renderSuimTable = () => (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1800px" }}>
        <thead>
          <tr>
            <th rowSpan={3} style={{ ...headerStyle, width: "100px", verticalAlign: "middle" }}>구분값</th>
            <th colSpan={3} style={headerStyle}>이월</th>
            <th colSpan={3} style={headerStyle}>수임</th>
            <th colSpan={12} style={headerStyle}>종결</th>
            <th rowSpan={3} style={{ ...headerStyle, width: "80px", verticalAlign: "middle" }}>처리율</th>
            <th colSpan={3} style={headerStyle}>미결</th>
          </tr>
          <tr>
            <th rowSpan={2} style={headerStyle}>직접복구</th>
            <th rowSpan={2} style={headerStyle}>선견적요청</th>
            <th rowSpan={2} style={headerStyle}>계</th>
            <th rowSpan={2} style={headerStyle}>직접복구</th>
            <th rowSpan={2} style={headerStyle}>선견적요청</th>
            <th rowSpan={2} style={headerStyle}>계</th>
            <th colSpan={4} style={headerStyle}>직접복구</th>
            <th colSpan={4} style={headerStyle}>선견적요청</th>
            <th colSpan={4} style={headerStyle}>합계</th>
            <th rowSpan={2} style={headerStyle}>직접복구</th>
            <th rowSpan={2} style={headerStyle}>선견적요청</th>
            <th rowSpan={2} style={headerStyle}>계</th>
          </tr>
          <tr>
            <th style={headerStyle}>직접복구</th>
            <th style={headerStyle}>선견적요청</th>
            <th style={headerStyle}>접수취소</th>
            <th style={headerStyle}>소계</th>
            <th style={headerStyle}>직접복구</th>
            <th style={headerStyle}>선견적요청</th>
            <th style={headerStyle}>접수취소</th>
            <th style={headerStyle}>소계</th>
            <th style={headerStyle}>직접복구</th>
            <th style={headerStyle}>선견적요청</th>
            <th style={headerStyle}>접수취소</th>
            <th style={headerStyle}>소계</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{format(startDate, "yyyy.MM", { locale: ko })}</td>
            <td style={cellStyle}>{statistics.이월.직접복구}</td>
            <td style={cellStyle}>{statistics.이월.선견적요청}</td>
            <td style={{ ...cellStyle, fontWeight: 600, background: "rgba(0, 143, 237, 0.05)" }}>{statistics.이월.계}</td>
            <td style={cellStyle}>{statistics.수임.직접복구}</td>
            <td style={cellStyle}>{statistics.수임.선견적요청}</td>
            <td style={{ ...cellStyle, fontWeight: 600, background: "rgba(0, 143, 237, 0.05)" }}>{statistics.수임.계}</td>
            <td style={cellStyle}>{statistics.종결.직접복구.직접복구}</td>
            <td style={cellStyle}>{statistics.종결.직접복구.선견적요청}</td>
            <td style={cellStyle}>{statistics.종결.직접복구.접수취소}</td>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{statistics.종결.직접복구.소계}</td>
            <td style={cellStyle}>{statistics.종결.선견적요청.직접복구}</td>
            <td style={cellStyle}>{statistics.종결.선견적요청.선견적요청}</td>
            <td style={cellStyle}>{statistics.종결.선견적요청.접수취소}</td>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{statistics.종결.선견적요청.소계}</td>
            <td style={cellStyle}>{statistics.종결.합계.직접복구}</td>
            <td style={cellStyle}>{statistics.종결.합계.선견적요청}</td>
            <td style={cellStyle}>{statistics.종결.합계.접수취소}</td>
            <td style={{ ...cellStyle, fontWeight: 600, background: "rgba(0, 143, 237, 0.05)" }}>{statistics.종결.합계.소계}</td>
            <td style={{ ...cellStyle, fontWeight: 600, color: "#008FED" }}>{statistics.처리율}%</td>
            <td style={cellStyle}>{statistics.미결.직접복구}</td>
            <td style={cellStyle}>{statistics.미결.선견적요청}</td>
            <td style={{ ...cellStyle, fontWeight: 600, background: "rgba(255, 77, 79, 0.05)", color: "#FF4D4F" }}>{statistics.미결.계}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  // 미결 - 진행과정별 테이블 렌더링
  const renderProgressTable = () => (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1400px" }}>
        <thead>
          <tr>
            <th rowSpan={2} style={{ ...headerStyle, width: "100px", verticalAlign: "middle" }}>구분값</th>
            <th rowSpan={2} style={{ ...headerStyle, width: "100px", verticalAlign: "middle" }}>유형값</th>
            <th colSpan={9} style={headerStyle}>직접복구</th>
            <th colSpan={4} style={headerStyle}>선견적요청</th>
          </tr>
          <tr>
            <th style={headerStyle}>접수완료</th>
            <th style={headerStyle}>현장방문</th>
            <th style={headerStyle}>현장정보입력</th>
            <th style={headerStyle}>현장정보제출</th>
            <th style={headerStyle}>복구요청</th>
            <th style={headerStyle}>출동비청구</th>
            <th style={headerStyle}>청구</th>
            <th style={headerStyle}>접수취소</th>
            <th style={{ ...headerStyle, background: "rgba(0, 143, 237, 0.08)" }}>계</th>
            <th style={headerStyle}>접수완료</th>
            <th style={headerStyle}>현장방문</th>
            <th style={headerStyle}>현장정보입력</th>
            <th style={{ ...headerStyle, background: "rgba(0, 143, 237, 0.08)" }}>계</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{format(startDate, "yyyy.MM", { locale: ko })}</td>
            <td style={cellStyle}>전체</td>
            <td style={cellStyle}>{progressStatistics.직접복구.접수완료}</td>
            <td style={cellStyle}>{progressStatistics.직접복구.현장방문}</td>
            <td style={cellStyle}>{progressStatistics.직접복구.현장정보입력}</td>
            <td style={cellStyle}>{progressStatistics.직접복구.현장정보제출}</td>
            <td style={cellStyle}>{progressStatistics.직접복구.복구요청}</td>
            <td style={cellStyle}>{progressStatistics.직접복구.출동비청구}</td>
            <td style={cellStyle}>{progressStatistics.직접복구.청구}</td>
            <td style={cellStyle}>{progressStatistics.직접복구.접수취소}</td>
            <td style={{ ...cellStyle, fontWeight: 600, background: "rgba(0, 143, 237, 0.05)" }}>{progressStatistics.직접복구.계}</td>
            <td style={cellStyle}>{progressStatistics.선견적요청.접수완료}</td>
            <td style={cellStyle}>{progressStatistics.선견적요청.현장방문}</td>
            <td style={cellStyle}>{progressStatistics.선견적요청.현장정보입력}</td>
            <td style={{ ...cellStyle, fontWeight: 600, background: "rgba(0, 143, 237, 0.05)" }}>{progressStatistics.선견적요청.계}</td>
          </tr>
          <tr style={{ background: "rgba(12, 12, 12, 0.02)" }}>
            <td style={{ ...cellStyle, fontWeight: 600 }}>합계</td>
            <td style={cellStyle}>-</td>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{progressStatistics.합계.접수완료}</td>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{progressStatistics.합계.현장방문}</td>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{progressStatistics.합계.현장정보입력}</td>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{progressStatistics.합계.현장정보제출}</td>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{progressStatistics.합계.복구요청}</td>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{progressStatistics.합계.출동비청구}</td>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{progressStatistics.합계.청구}</td>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{progressStatistics.합계.접수취소}</td>
            <td style={{ ...cellStyle, fontWeight: 700, background: "rgba(0, 143, 237, 0.08)", color: "#008FED" }}>{progressStatistics.합계.계}</td>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{progressStatistics.선견적요청.접수완료}</td>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{progressStatistics.선견적요청.현장방문}</td>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{progressStatistics.선견적요청.현장정보입력}</td>
            <td style={{ ...cellStyle, fontWeight: 700, background: "rgba(0, 143, 237, 0.08)", color: "#008FED" }}>{progressStatistics.선견적요청.계}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  // 미결 - 수리비 금액계층별 테이블 렌더링
  const renderRepairCostTable = () => (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1200px" }}>
        <thead>
          <tr>
            <th rowSpan={2} style={{ ...headerStyle, width: "100px", verticalAlign: "middle" }}>구분값</th>
            <th colSpan={2} style={headerStyle}>1백만 미만</th>
            <th colSpan={2} style={headerStyle}>2백만 미만</th>
            <th colSpan={2} style={headerStyle}>3백만 미만</th>
            <th colSpan={2} style={headerStyle}>5백만 미만</th>
            <th colSpan={2} style={headerStyle}>1천만 미만</th>
            <th colSpan={2} style={headerStyle}>1천만 초과</th>
            <th rowSpan={2} style={{ ...headerStyle, width: "80px", verticalAlign: "middle", background: "rgba(0, 143, 237, 0.08)" }}>계</th>
          </tr>
          <tr>
            <th style={headerStyle}>건수</th>
            <th style={headerStyle}>%</th>
            <th style={headerStyle}>건수</th>
            <th style={headerStyle}>%</th>
            <th style={headerStyle}>건수</th>
            <th style={headerStyle}>%</th>
            <th style={headerStyle}>건수</th>
            <th style={headerStyle}>%</th>
            <th style={headerStyle}>건수</th>
            <th style={headerStyle}>%</th>
            <th style={headerStyle}>건수</th>
            <th style={headerStyle}>%</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{format(startDate, "yyyy.MM", { locale: ko })}</td>
            <td style={cellStyle}>{repairCostStatistics["1백만미만"]?.건수 || 0}</td>
            <td style={cellStyle}>{repairCostStatistics["1백만미만"]?.퍼센트 || 0}%</td>
            <td style={cellStyle}>{repairCostStatistics["2백만미만"]?.건수 || 0}</td>
            <td style={cellStyle}>{repairCostStatistics["2백만미만"]?.퍼센트 || 0}%</td>
            <td style={cellStyle}>{repairCostStatistics["3백만미만"]?.건수 || 0}</td>
            <td style={cellStyle}>{repairCostStatistics["3백만미만"]?.퍼센트 || 0}%</td>
            <td style={cellStyle}>{repairCostStatistics["5백만미만"]?.건수 || 0}</td>
            <td style={cellStyle}>{repairCostStatistics["5백만미만"]?.퍼센트 || 0}%</td>
            <td style={cellStyle}>{repairCostStatistics["1천만미만"]?.건수 || 0}</td>
            <td style={cellStyle}>{repairCostStatistics["1천만미만"]?.퍼센트 || 0}%</td>
            <td style={cellStyle}>{repairCostStatistics["1천만초과"]?.건수 || 0}</td>
            <td style={cellStyle}>{repairCostStatistics["1천만초과"]?.퍼센트 || 0}%</td>
            <td style={{ ...cellStyle, fontWeight: 700, background: "rgba(0, 143, 237, 0.08)", color: "#008FED" }}>{repairCostStatistics.계}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  // 미결 - 기간별 테이블 렌더링
  const renderPeriodTable = () => (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1000px" }}>
        <thead>
          <tr>
            <th rowSpan={2} style={{ ...headerStyle, width: "100px", verticalAlign: "middle" }}>구분값</th>
            <th colSpan={2} style={headerStyle}>~1개월</th>
            <th colSpan={2} style={headerStyle}>~3개월</th>
            <th colSpan={2} style={headerStyle}>~6개월</th>
            <th colSpan={2} style={headerStyle}>~1년</th>
            <th colSpan={2} style={headerStyle}>1년~</th>
            <th rowSpan={2} style={{ ...headerStyle, width: "80px", verticalAlign: "middle", background: "rgba(0, 143, 237, 0.08)" }}>계</th>
          </tr>
          <tr>
            <th style={headerStyle}>건수</th>
            <th style={headerStyle}>%</th>
            <th style={headerStyle}>건수</th>
            <th style={headerStyle}>%</th>
            <th style={headerStyle}>건수</th>
            <th style={headerStyle}>%</th>
            <th style={headerStyle}>건수</th>
            <th style={headerStyle}>%</th>
            <th style={headerStyle}>건수</th>
            <th style={headerStyle}>%</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{format(startDate, "yyyy.MM", { locale: ko })}</td>
            <td style={cellStyle}>{periodStatistics["~1개월"]?.건수 || 0}</td>
            <td style={cellStyle}>{periodStatistics["~1개월"]?.퍼센트 || 0}%</td>
            <td style={cellStyle}>{periodStatistics["~3개월"]?.건수 || 0}</td>
            <td style={cellStyle}>{periodStatistics["~3개월"]?.퍼센트 || 0}%</td>
            <td style={cellStyle}>{periodStatistics["~6개월"]?.건수 || 0}</td>
            <td style={cellStyle}>{periodStatistics["~6개월"]?.퍼센트 || 0}%</td>
            <td style={cellStyle}>{periodStatistics["~1년"]?.건수 || 0}</td>
            <td style={cellStyle}>{periodStatistics["~1년"]?.퍼센트 || 0}%</td>
            <td style={cellStyle}>{periodStatistics["1년~"]?.건수 || 0}</td>
            <td style={cellStyle}>{periodStatistics["1년~"]?.퍼센트 || 0}%</td>
            <td style={{ ...cellStyle, fontWeight: 700, background: "rgba(0, 143, 237, 0.08)", color: "#008FED" }}>{periodStatistics.계}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  // 직접복구 - 완료건 금액계층별 테이블 렌더링
  const renderCompletedCostTable = () => {
    const formatNumber = (num: number) => num.toLocaleString();
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1400px" }}>
          <thead>
            <tr>
              <th rowSpan={2} style={{ ...headerStyle, width: "100px", verticalAlign: "middle" }}>구분값</th>
              <th colSpan={2} style={headerStyle}>~1,000,000</th>
              <th colSpan={2} style={headerStyle}>~2,000,000</th>
              <th colSpan={2} style={headerStyle}>~3,000,000</th>
              <th colSpan={2} style={headerStyle}>~5,000,000</th>
              <th colSpan={2} style={headerStyle}>~10,000,000</th>
              <th colSpan={2} style={headerStyle}>10,000,000~</th>
              <th rowSpan={2} style={{ ...headerStyle, width: "80px", verticalAlign: "middle" }}>건수</th>
              <th rowSpan={2} style={{ ...headerStyle, width: "120px", verticalAlign: "middle", background: "rgba(0, 143, 237, 0.08)" }}>평균수리비</th>
            </tr>
            <tr>
              <th style={headerStyle}>건수</th>
              <th style={headerStyle}>%</th>
              <th style={headerStyle}>건수</th>
              <th style={headerStyle}>%</th>
              <th style={headerStyle}>건수</th>
              <th style={headerStyle}>%</th>
              <th style={headerStyle}>건수</th>
              <th style={headerStyle}>%</th>
              <th style={headerStyle}>건수</th>
              <th style={headerStyle}>%</th>
              <th style={headerStyle}>건수</th>
              <th style={headerStyle}>%</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...cellStyle, fontWeight: 600 }}>{format(startDate, "yyyy.MM", { locale: ko })}</td>
              <td style={cellStyle}>{completedCostStatistics["~1,000,000"]?.건수 || 0}</td>
              <td style={cellStyle}>{completedCostStatistics["~1,000,000"]?.퍼센트 || 0}%</td>
              <td style={cellStyle}>{completedCostStatistics["~2,000,000"]?.건수 || 0}</td>
              <td style={cellStyle}>{completedCostStatistics["~2,000,000"]?.퍼센트 || 0}%</td>
              <td style={cellStyle}>{completedCostStatistics["~3,000,000"]?.건수 || 0}</td>
              <td style={cellStyle}>{completedCostStatistics["~3,000,000"]?.퍼센트 || 0}%</td>
              <td style={cellStyle}>{completedCostStatistics["~5,000,000"]?.건수 || 0}</td>
              <td style={cellStyle}>{completedCostStatistics["~5,000,000"]?.퍼센트 || 0}%</td>
              <td style={cellStyle}>{completedCostStatistics["~10,000,000"]?.건수 || 0}</td>
              <td style={cellStyle}>{completedCostStatistics["~10,000,000"]?.퍼센트 || 0}%</td>
              <td style={cellStyle}>{completedCostStatistics["10,000,000~"]?.건수 || 0}</td>
              <td style={cellStyle}>{completedCostStatistics["10,000,000~"]?.퍼센트 || 0}%</td>
              <td style={{ ...cellStyle, fontWeight: 600 }}>{completedCostStatistics.총건수}</td>
              <td style={{ ...cellStyle, fontWeight: 700, background: "rgba(0, 143, 237, 0.08)", color: "#008FED" }}>{formatNumber(completedCostStatistics.평균수리비)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  // 직접복구 - 평균 수리비 항목별 테이블 렌더링
  const renderAvgRepairCostByCategoryTable = () => {
    const formatNumber = (num: number) => num.toLocaleString();
    const data = avgRepairCostData || {
      손해정지비용: { 누수탐지비: 0, 배관공사: 0, 방수공사: 0, 코킹공사: 0, 철거공사: 0, 계: 0 },
      대물수리비용: { 가설공사: 0, 목공사: 0, 수장공사: 0, 도장공사: 0, 욕실공사: 0, 가구공사: 0, 전기공사: 0, 철거공사: 0, 기타공사: 0, 계: 0 },
      총계: 0,
      건수: 0,
    };
    
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1600px" }}>
          <thead>
            <tr>
              <th rowSpan={2} style={{ ...headerStyle, width: "80px", verticalAlign: "middle" }}>구분값</th>
              <th colSpan={6} style={headerStyle}>손해정지비용</th>
              <th colSpan={10} style={headerStyle}>대물수리비용</th>
              <th rowSpan={2} style={{ ...headerStyle, width: "100px", verticalAlign: "middle", background: "rgba(0, 143, 237, 0.08)" }}>계</th>
            </tr>
            <tr>
              <th style={headerStyle}>누수탐지비</th>
              <th style={headerStyle}>배관공사</th>
              <th style={headerStyle}>방수공사</th>
              <th style={headerStyle}>코킹공사</th>
              <th style={headerStyle}>철거공사</th>
              <th style={{ ...headerStyle, background: "rgba(12, 12, 12, 0.06)" }}>계</th>
              <th style={headerStyle}>가설공사</th>
              <th style={headerStyle}>목공사</th>
              <th style={headerStyle}>수장공사</th>
              <th style={headerStyle}>도장공사</th>
              <th style={headerStyle}>욕실공사</th>
              <th style={headerStyle}>가구공사</th>
              <th style={headerStyle}>전기공사</th>
              <th style={headerStyle}>철거공사</th>
              <th style={headerStyle}>기타공사</th>
              <th style={{ ...headerStyle, background: "rgba(12, 12, 12, 0.06)" }}>계</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...cellStyle, fontWeight: 600 }}>{format(startDate, "yyyy.MM", { locale: ko })}</td>
              <td style={cellStyle}>{formatNumber(data.손해정지비용.누수탐지비 || 0)}</td>
              <td style={cellStyle}>{formatNumber(data.손해정지비용.배관공사 || 0)}</td>
              <td style={cellStyle}>{formatNumber(data.손해정지비용.방수공사 || 0)}</td>
              <td style={cellStyle}>{formatNumber(data.손해정지비용.코킹공사 || 0)}</td>
              <td style={cellStyle}>{formatNumber(data.손해정지비용.철거공사 || 0)}</td>
              <td style={{ ...cellStyle, fontWeight: 600, background: "rgba(12, 12, 12, 0.03)" }}>{formatNumber(data.손해정지비용.계 || 0)}</td>
              <td style={cellStyle}>{formatNumber(data.대물수리비용.가설공사 || 0)}</td>
              <td style={cellStyle}>{formatNumber(data.대물수리비용.목공사 || 0)}</td>
              <td style={cellStyle}>{formatNumber(data.대물수리비용.수장공사 || 0)}</td>
              <td style={cellStyle}>{formatNumber(data.대물수리비용.도장공사 || 0)}</td>
              <td style={cellStyle}>{formatNumber(data.대물수리비용.욕실공사 || 0)}</td>
              <td style={cellStyle}>{formatNumber(data.대물수리비용.가구공사 || 0)}</td>
              <td style={cellStyle}>{formatNumber(data.대물수리비용.전기공사 || 0)}</td>
              <td style={cellStyle}>{formatNumber(data.대물수리비용.철거공사 || 0)}</td>
              <td style={cellStyle}>{formatNumber(data.대물수리비용.기타공사 || 0)}</td>
              <td style={{ ...cellStyle, fontWeight: 600, background: "rgba(12, 12, 12, 0.03)" }}>{formatNumber(data.대물수리비용.계 || 0)}</td>
              <td style={{ ...cellStyle, fontWeight: 700, background: "rgba(0, 143, 237, 0.08)", color: "#008FED" }}>{formatNumber(data.총계 || 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  // 사고 원인별 테이블 렌더링
  const renderAccidentCauseTable = () => (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "800px" }}>
        <thead>
          <tr>
            <th rowSpan={2} style={{ ...headerStyle, width: "100px", verticalAlign: "middle" }}>구분값</th>
            <th colSpan={5} style={headerStyle}>사고원인</th>
            <th rowSpan={2} style={{ ...headerStyle, width: "100px", verticalAlign: "middle", background: "rgba(0, 143, 237, 0.08)" }}>합계</th>
          </tr>
          <tr>
            <th style={headerStyle}>배관</th>
            <th style={headerStyle}>방수</th>
            <th style={headerStyle}>코킹</th>
            <th style={headerStyle}>공용부</th>
            <th style={headerStyle}>복합</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{format(startDate, "yyyy.MM", { locale: ko })}</td>
            <td style={cellStyle}>{accidentCauseStatistics.배관}</td>
            <td style={cellStyle}>{accidentCauseStatistics.방수}</td>
            <td style={cellStyle}>{accidentCauseStatistics.코킹}</td>
            <td style={cellStyle}>{accidentCauseStatistics.공용부}</td>
            <td style={cellStyle}>{accidentCauseStatistics.복합}</td>
            <td style={{ ...cellStyle, fontWeight: 700, background: "rgba(0, 143, 237, 0.08)", color: "#008FED" }}>{accidentCauseStatistics.합계}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  // 출동비 청구 - 진행항목 테이블 렌더링
  const renderDispatchFeeTable = () => (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1000px" }}>
        <thead>
          <tr>
            <th rowSpan={2} style={{ ...headerStyle, width: "100px", verticalAlign: "middle" }}>구분값</th>
            <th colSpan={4} style={headerStyle}>직접복구 진행항목</th>
            <th colSpan={4} style={headerStyle}>선견적의뢰건 진행항목</th>
          </tr>
          <tr>
            <th style={headerStyle}>현장방문</th>
            <th style={headerStyle}>현장정보입력</th>
            <th style={headerStyle}>청구</th>
            <th style={{ ...headerStyle, background: "rgba(0, 143, 237, 0.08)" }}>입금완료</th>
            <th style={headerStyle}>현장방문</th>
            <th style={headerStyle}>현장정보입력</th>
            <th style={headerStyle}>청구</th>
            <th style={{ ...headerStyle, background: "rgba(0, 143, 237, 0.08)" }}>입금완료</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{format(startDate, "yyyy.MM", { locale: ko })}</td>
            <td style={cellStyle}>{dispatchFeeStatistics.직접복구진행항목.현장방문}</td>
            <td style={cellStyle}>{dispatchFeeStatistics.직접복구진행항목.현장정보입력}</td>
            <td style={cellStyle}>{dispatchFeeStatistics.직접복구진행항목.청구}</td>
            <td style={{ ...cellStyle, fontWeight: 600, background: "rgba(0, 143, 237, 0.05)" }}>{dispatchFeeStatistics.직접복구진행항목.입금완료}</td>
            <td style={cellStyle}>{dispatchFeeStatistics.선견적의뢰건진행항목.현장방문}</td>
            <td style={cellStyle}>{dispatchFeeStatistics.선견적의뢰건진행항목.현장정보입력}</td>
            <td style={cellStyle}>{dispatchFeeStatistics.선견적의뢰건진행항목.청구}</td>
            <td style={{ ...cellStyle, fontWeight: 600, background: "rgba(0, 143, 237, 0.05)" }}>{dispatchFeeStatistics.선견적의뢰건진행항목.입금완료}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  // 직접복구 - 종결건 진행과정별 테이블 렌더링
  const renderClosedProgressTable = () => (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1400px" }}>
        <thead>
          <tr>
            <th rowSpan={2} style={{ ...headerStyle, width: "100px", verticalAlign: "middle" }}>구분값</th>
            <th colSpan={6} style={headerStyle}>직접복구 의뢰건</th>
            <th colSpan={6} style={headerStyle}>선견적의뢰건</th>
          </tr>
          <tr>
            <th style={headerStyle}>현장방문</th>
            <th style={headerStyle}>현장정보입력</th>
            <th style={headerStyle}>직접복구</th>
            <th style={headerStyle}>청구자료제출</th>
            <th style={headerStyle}>청구</th>
            <th style={{ ...headerStyle, background: "rgba(0, 143, 237, 0.08)" }}>입금완료</th>
            <th style={headerStyle}>현장방문</th>
            <th style={headerStyle}>현장정보입력</th>
            <th style={headerStyle}>직접복구</th>
            <th style={headerStyle}>청구자료제출</th>
            <th style={headerStyle}>청구</th>
            <th style={{ ...headerStyle, background: "rgba(0, 143, 237, 0.08)" }}>입금완료</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{format(startDate, "yyyy.MM", { locale: ko })}</td>
            <td style={cellStyle}>{closedProgressStatistics.직접복구의뢰건.현장방문}</td>
            <td style={cellStyle}>{closedProgressStatistics.직접복구의뢰건.현장정보입력}</td>
            <td style={cellStyle}>{closedProgressStatistics.직접복구의뢰건.직접복구}</td>
            <td style={cellStyle}>{closedProgressStatistics.직접복구의뢰건.청구자료제출}</td>
            <td style={cellStyle}>{closedProgressStatistics.직접복구의뢰건.청구}</td>
            <td style={{ ...cellStyle, fontWeight: 600, background: "rgba(0, 143, 237, 0.05)" }}>{closedProgressStatistics.직접복구의뢰건.입금완료}</td>
            <td style={cellStyle}>{closedProgressStatistics.선견적의뢰건.현장방문}</td>
            <td style={cellStyle}>{closedProgressStatistics.선견적의뢰건.현장정보입력}</td>
            <td style={cellStyle}>{closedProgressStatistics.선견적의뢰건.직접복구}</td>
            <td style={cellStyle}>{closedProgressStatistics.선견적의뢰건.청구자료제출}</td>
            <td style={cellStyle}>{closedProgressStatistics.선견적의뢰건.청구}</td>
            <td style={{ ...cellStyle, fontWeight: 600, background: "rgba(0, 143, 237, 0.05)" }}>{closedProgressStatistics.선견적의뢰건.입금완료}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  // 현재 탭에 따른 테이블 렌더링
  const renderTable = () => {
    if (activeTab === "수임") {
      return renderSuimTable();
    }
    if (activeTab === "미결") {
      if (activeSubFilter === "진행과정별") {
        return renderProgressTable();
      }
      if (activeSubFilter === "수리비 금액계층별") {
        return renderRepairCostTable();
      }
      if (activeSubFilter === "기간별") {
        return renderPeriodTable();
      }
    }
    if (activeTab === "직접복구") {
      if (activeSubFilter === "종결건 진행과정별") {
        return renderClosedProgressTable();
      }
      if (activeSubFilter === "완료건 금액계층별") {
        return renderCompletedCostTable();
      }
      if (activeSubFilter === "평균 수리비 항목별") {
        return renderAvgRepairCostByCategoryTable();
      }
    }
    if (activeTab === "출동비 청구") {
      return renderDispatchFeeTable();
    }
    if (activeTab === "사고확인") {
      if (activeSubFilter === "사고 원인별") {
        return renderAccidentCauseTable();
      }
    }
    return (
      <div className="p-8 text-center" style={{ color: "rgba(12, 12, 12, 0.5)" }}>
        해당 탭의 데이터를 준비 중입니다.
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-white p-8">
      <div className="flex items-center gap-2 mb-6">
        <h1
          style={{
            fontFamily: "Pretendard",
            fontSize: "26px",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "#0C0C0C",
          }}
        >
          {pageTitle}
        </h1>
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "rgba(12, 12, 12, 0.2)",
          }}
        />
      </div>

      <div className="mb-6">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2"
              size={20}
              style={{ color: "rgba(12, 12, 12, 0.4)" }}
            />
            <Input
              type="text"
              placeholder="검색어를 입력해주세요"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                height: "48px",
                paddingLeft: "48px",
                background: "#FAFAFA",
                border: "1px solid rgba(12, 12, 12, 0.1)",
                borderRadius: "8px",
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
              data-testid="input-search-statistics"
            />
          </div>
          <Button
            style={{
              height: "48px",
              padding: "0 32px",
              background: "#008FED",
              borderRadius: "8px",
              fontFamily: "Pretendard",
              fontSize: "14px",
              fontWeight: 600,
              color: "#FFFFFF",
            }}
            data-testid="button-search-statistics"
          >
            검색
          </Button>
        </div>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                style={{
                  height: "40px",
                  padding: "0 16px",
                  background: "#FFFFFF",
                  border: "1px solid rgba(12, 12, 12, 0.2)",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                  color: "rgba(12, 12, 12, 0.7)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                data-testid="button-add-period"
              >
                <CalendarIcon size={16} style={{ color: "rgba(12, 12, 12, 0.5)" }} />
                기간추가
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="p-4">
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">시작일</label>
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => date && setStartDate(date)}
                    locale={ko}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">종료일</label>
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={(date) => date && setEndDate(date)}
                    locale={ko}
                  />
                </div>
                <Button 
                  className="w-full mt-4"
                  onClick={() => setCalendarOpen(false)}
                >
                  적용
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <div style={{ width: "1px", height: "24px", background: "rgba(12, 12, 12, 0.1)" }} />

          <div className="flex items-center gap-2">
            {tabList.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab);
                    if (subFiltersMap[tab]) {
                      setActiveSubFilter(subFiltersMap[tab][0]);
                    }
                  }}
                  style={{
                    height: "40px",
                    padding: "0 20px",
                    background: isActive ? "#FFFFFF" : "transparent",
                    border: isActive ? "1px solid rgba(12, 12, 12, 0.2)" : "none",
                    borderRadius: "8px",
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: isActive ? "#008FED" : "rgba(12, 12, 12, 0.5)",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                  data-testid={`tab-${tab}`}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          {currentSubFilters.length > 0 && (
            <>
              <div style={{ width: "1px", height: "24px", background: "rgba(12, 12, 12, 0.1)" }} />
              <div className="flex items-center gap-2">
                {currentSubFilters.map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setActiveSubFilter(filter)}
                    style={{
                      height: "40px",
                      padding: "0 20px",
                      background: activeSubFilter === filter ? "#FFFFFF" : "transparent",
                      border: activeSubFilter === filter ? "1px solid rgba(12, 12, 12, 0.2)" : "none",
                      borderRadius: "8px",
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: activeSubFilter === filter ? "#0C0C0C" : "rgba(12, 12, 12, 0.5)",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                    data-testid={`subfilter-${filter}`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div
        className="mb-4"
        style={{
          fontFamily: "Pretendard",
          fontSize: "14px",
          fontWeight: 500,
          color: "rgba(12, 12, 12, 0.6)",
        }}
      >
        총 {cases.length}건의 통계
      </div>

      <div
        style={{
          background: "#FFFFFF",
          borderRadius: "12px",
          border: "1px solid rgba(12, 12, 12, 0.06)",
          overflow: "hidden",
        }}
      >
        {renderTable()}
      </div>
    </div>
  );
}
