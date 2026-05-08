import { useState, useMemo, useEffect } from "react";
import { useCompactPagination } from "@/lib/use-compact-pagination";
import { CompactPagination } from "@/components/ui/compact-pagination";
import { useQuery } from "@tanstack/react-query";
import { User, Case, Settlement, CaseStatusHistory } from "@shared/schema";
import { Search, Calendar as CalendarIcon, ChevronRight, Star, Download, History } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { format, parseISO, subDays } from "date-fns";
import { ko } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const CLOSED_STATUSES = ["접수취소", "종결"];

const isUnsettled = (c: Case): boolean => !CLOSED_STATUSES.includes(c.status);

const isDirectRecovery = (c: Case): boolean => {
  return c.recoveryType === "직접복구" || c.restorationMethod === "직접복구" || c.status === "직접복구" || c.status === "청구자료제출(복구)";
};

const isPreEstimate = (c: Case): boolean => {
  return c.recoveryType === "선견적요청" || c.restorationMethod === "선견적요청" || c.status === "선견적요청" || c.status === "출동비청구(선견적)";
};

const formatAmount = (amount: number): string => {
  if (!amount) return "-";
  return amount.toLocaleString("ko-KR") + "원";
};

const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "-";
  try {
    const d = parseISO(dateStr);
    return format(d, "yyyy.MM.dd");
  } catch {
    return dateStr;
  }
};

const REGION_NORMALIZE: Record<string, string> = {
  "서울특별시": "서울", "서울시": "서울", "서울": "서울",
  "부산광역시": "부산", "부산시": "부산", "부산": "부산",
  "대구광역시": "대구", "대구시": "대구", "대구": "대구",
  "인천광역시": "인천", "인천시": "인천", "인천": "인천",
  "광주광역시": "광주", "광주": "광주",
  "대전광역시": "대전", "대전시": "대전", "대전": "대전",
  "울산광역시": "울산", "울산시": "울산", "울산": "울산",
  "세종특별자치시": "세종", "세종시": "세종", "세종": "세종",
  "경기도": "경기", "경기": "경기",
  "강원특별자치도": "강원", "강원도": "강원", "강원": "강원",
  "충청북도": "충북", "충북": "충북",
  "충청남도": "충남", "충남": "충남",
  "전북특별자치도": "전북", "전라북도": "전북", "전북": "전북",
  "전라남도": "전남", "전남": "전남",
  "경상북도": "경북", "경북": "경북",
  "경상남도": "경남", "경남": "경남",
  "제주특별자치도": "제주", "제주도": "제주", "제주": "제주",
};

const PROVINCE_KEYS = ["경기도", "경기", "강원특별자치도", "강원도", "강원",
  "충청북도", "충북", "충청남도", "충남", "전북특별자치도", "전라북도", "전북",
  "전라남도", "전남", "경상북도", "경북", "경상남도", "경남",
  "제주특별자치도", "제주도", "제주"];

const parseAddress = (address: string | null | undefined): { region: string; district: string } => {
  if (!address || typeof address !== "string") return { region: "-", district: "-" };
  const addr = address.replace(/\s+/g, " ").trim();
  if (!addr) return { region: "-", district: "-" };

  const fullNamePattern = /^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도|제주도)\s*/;
  const fullMatch = addr.match(fullNamePattern);
  if (fullMatch) {
    const region = REGION_NORMALIZE[fullMatch[1]] || fullMatch[1];
    const rest = addr.slice(fullMatch[0].length).trim();
    const districtMatch = rest.match(/^([가-힣]+(?:시|구|군))/);
    return { region, district: districtMatch ? districtMatch[1] : "-" };
  }

  const tokens = addr.split(" ");
  const firstToken = tokens[0];

  if (REGION_NORMALIZE[firstToken]) {
    const region = REGION_NORMALIZE[firstToken];
    const isProvince = PROVINCE_KEYS.includes(firstToken);

    if (isProvince && tokens.length >= 2) {
      const secondToken = tokens[1];
      const districtMatch = secondToken.match(/^([가-힣]+(?:시|구|군))$/);
      return { region, district: districtMatch ? districtMatch[1] : secondToken };
    }

    if (!isProvince && tokens.length >= 2) {
      const secondToken = tokens[1];
      const guMatch = secondToken.match(/^([가-힣]+(?:구|군))$/);
      if (guMatch) return { region, district: guMatch[1] };
      const siMatch = secondToken.match(/^([가-힣]+시)$/);
      if (siMatch) return { region, district: siMatch[1] };
      return { region, district: secondToken };
    }

    return { region, district: "-" };
  }

  return { region: "-", district: "-" };
};

const extractRegion = (address: string | null | undefined): string => {
  return parseAddress(address).region;
};

const extractCityDistrict = (address: string | null | undefined): string => {
  return parseAddress(address).district;
};

const STATUS_ORDER = [
  "배당대기", "접수완료", "현장방문", "현장정보입력", "검토중", "반려",
  "1차승인", "현장정보제출", "복구요청(2차승인)", "직접복구", "선견적요청",
  "청구자료제출(복구)", "출동비청구(선견적)", "청구", "입금완료", "부분입금",
  "부분지급", "지급완료", "정산완료", "종결", "접수취소",
];

const getActiveCases = (groupCases: Case[]): Case[] => {
  return groupCases.filter(c => c.status !== "접수취소");
};

const getGroupRestorationMethod = (groupCases: Case[]): string => {
  const active = getActiveCases(groupCases);
  const hasDirectRecovery = active.some(c => isDirectRecovery(c));
  if (hasDirectRecovery) return "직접복구";
  const hasPreEstimate = active.some(c => isPreEstimate(c));
  if (hasPreEstimate) return "선견적요청";
  const rep = active[0] || groupCases[0];
  return rep?.restorationMethod || rep?.recoveryType || "-";
};

const getLatestStatus = (groupCases: Case[]): string => {
  const active = getActiveCases(groupCases);
  if (active.length === 0) return groupCases[0]?.status || "-";

  const hasDirectRecovery = active.some(c => isDirectRecovery(c));
  const targetCases = hasDirectRecovery
    ? active.filter(c => isDirectRecovery(c))
    : active;

  let minIndex = STATUS_ORDER.length;
  let latestStatus = targetCases[0]?.status || "-";
  for (const c of targetCases) {
    const idx = STATUS_ORDER.indexOf(c.status);
    if (idx !== -1 && idx < minIndex) {
      minIndex = idx;
      latestStatus = c.status;
    }
  }
  return latestStatus;
};

const isOnlyPreEstimate = (groupCases: Case[]): boolean => {
  const active = getActiveCases(groupCases);
  if (active.length === 0) return false;
  return active.every(c => isPreEstimate(c));
};

const getGroupDate = (groupCases: Case[], field: keyof Case): string | null => {
  const active = getActiveCases(groupCases);
  const dates = active.map(c => c[field] as string).filter(d => d && d.trim() !== "");
  if (dates.length === 0) return null;
  return dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
};

const groupHasAnyPreEstimate = (groupCases: Case[]): boolean => {
  const active = getActiveCases(groupCases);
  return active.some(c => isPreEstimate(c));
};

const getRepresentativeCase = (groupCases: Case[]): Case => {
  const sorted = [...groupCases].sort((a, b) => (a.caseNumber || "").localeCompare(b.caseNumber || ""));
  const zeroCase = sorted.find(c => (c.caseNumber || "").endsWith("-0"));
  if (zeroCase) return zeroCase;
  const oneCase = sorted.find(c => (c.caseNumber || "").endsWith("-1"));
  return oneCase || sorted[0];
};

const getCaseEstimateForStats = (c: Case): number => {
  return parseFloat(c.approvedAmount || c.estimateAmount || c.initialEstimateAmount || "0") || 0;
};

const APPROVED_STATUSES = ["청구", "청구자료제출(복구)", "출동비청구(선견적)", "입금완료", "부분입금", "부분지급", "지급완료", "정산완료", "종결"];

const getCaseApprovedForStats = (c: Case): number => {
  const approved = parseFloat(c.approvedAmount || "0") || 0;
  if (approved > 0) return approved;
  const isApproved = c.reviewDecision === "승인" || APPROVED_STATUSES.includes(c.status);
  if (isApproved) return getCaseEstimateForStats(c);
  return 0;
};

const getCaseInvoiceClaimAmount = (c: Case): number => {
  const invoiceDamage = parseFloat(c.invoiceDamagePreventionAmount || "0") || 0;
  const invoiceProperty = parseFloat(c.invoicePropertyRepairAmount || "0") || 0;
  if (invoiceDamage > 0 || invoiceProperty > 0) return invoiceDamage + invoiceProperty;
  return 0;
};

const getClaimAmount = (c: Case): number => {
  if (isPreEstimate(c)) {
    return parseFloat(c.fieldDispatchInvoiceAmount || "0") || 0;
  }
  const invoiceClaim = getCaseInvoiceClaimAmount(c);
  if (invoiceClaim > 0) return invoiceClaim;
  return getCaseApprovedForStats(c);
};

const getEstimateEligibleCases = (groupCases: Case[]): Case[] => {
  return groupCases.filter(c => c.status !== "접수취소" && !isPreEstimate(c));
};

const getPreEstimateClaimFallback = (c: Case, settMap?: Record<string, Settlement>): number => {
  const fd = parseFloat(c.fieldDispatchInvoiceAmount || "0") || 0;
  if (fd > 0) return fd;
  if (settMap) {
    const sett = settMap[c.id];
    if (sett?.depositEntries && sett.depositEntries.length > 0) {
      const dc = sett.depositEntries.reduce((s, e) => s + (e.claimAmount || 0), 0);
      if (dc > 0) return dc;
    }
  }
  return 0;
};

const getGroupEstimateAmount = (groupCases: Case[]): number | null => {
  const active = getActiveCases(groupCases);
  if (active.length === 0) return null;
  const preEstimateCases = active.filter(c => isPreEstimate(c));
  const nonPreEstimateCases = active.filter(c => !isPreEstimate(c));
  if (nonPreEstimateCases.length === 0) {
    return null;
  }
  const hasDirectRecovery = nonPreEstimateCases.some(c => isDirectRecovery(c));
  const targets = hasDirectRecovery ? nonPreEstimateCases.filter(c => isDirectRecovery(c)) : nonPreEstimateCases;
  return targets.reduce((sum, c) => sum + getCaseEstimateForStats(c), 0);
};

const getGroupApprovedAmount = (groupCases: Case[]): number | null => {
  const active = getActiveCases(groupCases);
  if (active.length === 0) return null;
  const preEstimateCases = active.filter(c => isPreEstimate(c));
  const nonPreEstimateCases = active.filter(c => !isPreEstimate(c));
  if (nonPreEstimateCases.length === 0) {
    return null;
  }
  const hasDirectRecovery = nonPreEstimateCases.some(c => isDirectRecovery(c));
  const targets = hasDirectRecovery ? nonPreEstimateCases.filter(c => isDirectRecovery(c)) : nonPreEstimateCases;
  return targets.reduce((sum, c) => sum + getCaseApprovedForStats(c), 0);
};

interface GroupedRow {
  accidentNo: string;
  rep: Case;
  cases: Case[];
  totalEstimate: number | null;
  totalApproved: number | null;
  totalClaim: number | null;
}

// [테이블 압축 2026-05-06] 행/헤더 높이 압축 — 좌우 padding·폰트·정렬·색상은 유지.
// 변경: padding 상하만 축소, line-height 축소.
//   header: padding 12px 8px → 6px 8px (≈ 12px 절감/행), line-height 128% → 118%
//   cell:   padding 10px 8px → 4px 8px (≈ 12px 절감/행), line-height 128% → 118%
//   대략 row 높이 38~40px → 26~28px 수준으로 압축.
const headerStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontFamily: "Pretendard",
  fontSize: "14px",
  fontWeight: 600,
  lineHeight: "118%",
  letterSpacing: "-0.02em",
  color: "rgba(12, 12, 12, 0.6)",
  borderRight: "1px solid rgba(12, 12, 12, 0.06)",
  borderBottom: "1px solid rgba(12, 12, 12, 0.06)",
  textAlign: "center",
  background: "rgba(240, 240, 240, 1)",
  whiteSpace: "nowrap",
};

const cellStyle: React.CSSProperties = {
  padding: "4px 8px",
  fontFamily: "Pretendard",
  fontSize: "13px",
  lineHeight: "118%",
  letterSpacing: "-0.02em",
  color: "rgba(12, 12, 12, 0.8)",
  borderRight: "1px solid rgba(12, 12, 12, 0.06)",
  borderBottom: "1px solid rgba(12, 12, 12, 0.06)",
  textAlign: "center",
  whiteSpace: "nowrap",
};

export default function UnsettledCaseStatistics() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState<"사고번호" | "접수번호">("사고번호");
  const [historicalMode, setHistoricalMode] = useState(false);
  const [historicalDate, setHistoricalDate] = useState<Date>(subDays(new Date(), 7));
  const [historicalCalendarOpen, setHistoricalCalendarOpen] = useState(false);

  const { data: cases = [] } = useQuery<Case[]>({
    queryKey: ["/api/cases"],
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users/basic"],
  });

  const { data: settlements = [] } = useQuery<Settlement[]>({
    queryKey: ["/api/settlements"],
  });

  const { data: statusHistory = [] } = useQuery<CaseStatusHistory[]>({
    queryKey: ["/api/case-status-history"],
    enabled: historicalMode,
  });

  interface InvoiceData {
    id: string;
    caseGroupPrefix: string | null;
    totalApprovedAmount: string | null;
    deductible: string | null;
  }
  const { data: allInvoices = [] } = useQuery<InvoiceData[]>({
    queryKey: ["/api/invoices"],
  });

  const invoicesByPrefixMap = useMemo(() => {
    const map: Record<string, InvoiceData> = {};
    allInvoices.forEach((inv) => {
      if (inv.caseGroupPrefix) {
        map[inv.caseGroupPrefix] = inv;
      }
    });
    return map;
  }, [allInvoices]);

  const settlementMap = useMemo(() => {
    const map: Record<string, Settlement> = {};
    settlements.forEach((s) => {
      map[s.caseId] = s;
    });
    return map;
  }, [settlements]);

  const userMap = useMemo(() => {
    const map: Record<string, User> = {};
    users.forEach((u) => {
      map[u.id] = u;
    });
    return map;
  }, [users]);

  const historicalUnsettledCaseIds = useMemo(() => {
    if (!historicalMode) return new Set<string>();

    const targetDateStr = format(historicalDate, "yyyy-MM-dd");
    const targetEndOfDay = targetDateStr + "T23:59:59";

    const caseStatusAtDate = new Map<string, string>();

    cases.forEach((c) => {
      try {
        const createdDate = c.createdAt.substring(0, 10);
        if (createdDate <= targetDateStr) {
          caseStatusAtDate.set(c.id, c.status);
        }
      } catch {}
    });

    const historyBeforeDate = statusHistory
      .filter((h) => {
        try {
          const changedDate = h.changedAt.substring(0, 19);
          return changedDate <= targetEndOfDay;
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.id - b.id);

    historyBeforeDate.forEach((h) => {
      if (caseStatusAtDate.has(h.caseId)) {
        caseStatusAtDate.set(h.caseId, h.newStatus);
      }
    });

    const unsettledIds = new Set<string>();
    caseStatusAtDate.forEach((status, caseId) => {
      if (!CLOSED_STATUSES.includes(status)) {
        unsettledIds.add(caseId);
      }
    });

    return unsettledIds;
  }, [historicalMode, historicalDate, cases, statusHistory]);

  const filteredCases = useMemo(() => {
    if (searchType !== "접수번호") return [];

    let result: Case[];

    if (historicalMode) {
      result = cases.filter((c) => historicalUnsettledCaseIds.has(c.id));
    } else {
      result = cases.filter((c) => isUnsettled(c));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((c) => {
        const cn = (c.caseNumber || "").toLowerCase();
        const accNo = (c.insuranceAccidentNo || "").toLowerCase();
        const policyNo = (c.insurancePolicyNo || "").toLowerCase();
        return cn.includes(q) || accNo.includes(q) || policyNo.includes(q);
      });
    }

    result = [...result].sort((a, b) =>
      (a.caseNumber || "").localeCompare(b.caseNumber || "")
    );

    return result;
  }, [cases, searchQuery, searchType, historicalMode, historicalUnsettledCaseIds]);

  const preEstimateGroupCaseIds = useMemo((): Set<string> => {
    const getCasePrefix = (c: Case): string => {
      const cn = c.caseNumber || "";
      const lastDash = cn.lastIndexOf("-");
      return lastDash > 0 ? cn.substring(0, lastDash) : cn;
    };
    const parent: Record<string, string> = {};
    const find = (x: string): string => {
      if (!parent[x]) parent[x] = x;
      if (parent[x] !== x) parent[x] = find(parent[x]);
      return parent[x];
    };
    const union = (a: string, b: string) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    cases.forEach(c => { if (!parent[c.id]) parent[c.id] = c.id; });
    const prefixMap: Record<string, string[]> = {};
    cases.forEach(c => {
      const prefix = getCasePrefix(c);
      if (!prefix) return;
      if (!prefixMap[prefix]) prefixMap[prefix] = [];
      prefixMap[prefix].push(c.id);
    });
    Object.values(prefixMap).forEach(ids => {
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
    });
    const accNoMap: Record<string, string[]> = {};
    cases.forEach(c => {
      const accNo = (c.insuranceAccidentNo || "").trim();
      if (!accNo) return;
      if (!accNoMap[accNo]) accNoMap[accNo] = [];
      accNoMap[accNo].push(c.id);
    });
    Object.values(accNoMap).forEach(ids => {
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
    });
    const components: Record<string, Case[]> = {};
    cases.forEach(c => {
      const root = find(c.id);
      if (!components[root]) components[root] = [];
      components[root].push(c);
    });
    const result = new Set<string>();
    Object.values(components).forEach(groupCases => {
      if (groupHasAnyPreEstimate(groupCases)) {
        groupCases.forEach(c => result.add(c.id));
      }
    });
    return result;
  }, [cases]);

  const groupedRows = useMemo((): GroupedRow[] => {
    if (searchType !== "사고번호") return [];

    const getCasePrefix = (c: Case): string => {
      const cn = c.caseNumber || "";
      const lastDash = cn.lastIndexOf("-");
      return lastDash > 0 ? cn.substring(0, lastDash) : cn;
    };

    const parent: Record<string, string> = {};
    const find = (x: string): string => {
      if (!parent[x]) parent[x] = x;
      if (parent[x] !== x) parent[x] = find(parent[x]);
      return parent[x];
    };
    const union = (a: string, b: string) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };

    cases.forEach(c => {
      if (!parent[c.id]) parent[c.id] = c.id;
    });

    const prefixMap: Record<string, string[]> = {};
    cases.forEach(c => {
      const prefix = getCasePrefix(c);
      if (!prefix) return;
      if (!prefixMap[prefix]) prefixMap[prefix] = [];
      prefixMap[prefix].push(c.id);
    });
    Object.values(prefixMap).forEach(ids => {
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
    });

    const accNoMap: Record<string, string[]> = {};
    cases.forEach(c => {
      const accNo = (c.insuranceAccidentNo || "").trim();
      if (!accNo) return;
      if (!accNoMap[accNo]) accNoMap[accNo] = [];
      accNoMap[accNo].push(c.id);
    });
    Object.values(accNoMap).forEach(ids => {
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
    });

    const components: Record<string, Case[]> = {};
    cases.forEach(c => {
      const root = find(c.id);
      if (!components[root]) components[root] = [];
      components[root].push(c);
    });

    const grouped: Record<string, Case[]> = {};
    Object.values(components).forEach(groupCases => {
      const rep = getRepresentativeCase(groupCases);
      const accNo = (rep.insuranceAccidentNo || "").trim() || `no-acc-${rep.id}`;
      if (grouped[accNo]) {
        grouped[accNo].push(...groupCases);
      } else {
        grouped[accNo] = groupCases;
      }
    });

    let entries = Object.entries(grouped).filter(([, groupCases]) => {
      if (historicalMode) {
        return groupCases.some((c) => historicalUnsettledCaseIds.has(c.id));
      }
      return groupCases.some((c) => isUnsettled(c));
    });

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      entries = entries.filter(([accNo, groupCases]) => {
        if (accNo.toLowerCase().includes(q)) return true;
        return groupCases.some(c => {
          const cn = (c.caseNumber || "").toLowerCase();
          const policyNo = (c.insurancePolicyNo || "").toLowerCase();
          return cn.includes(q) || policyNo.includes(q);
        });
      });
    }

    const rows: GroupedRow[] = entries.map(([accNo, groupCases]) => {
      const uniqueCases = Array.from(new Map(groupCases.map(c => [c.id, c])).values());
      const rep = getRepresentativeCase(uniqueCases);
      return {
        accidentNo: accNo,
        rep,
        cases: uniqueCases,
        totalEstimate: getGroupEstimateAmount(uniqueCases),
        totalApproved: getGroupApprovedAmount(uniqueCases),
        totalClaim: (() => {
          const active = getActiveCases(uniqueCases);
          const onlyPreEstimate = active.length > 0 && active.every(c => isPreEstimate(c));
          const hasPreEstimate = active.some(c => isPreEstimate(c));
          const preEstimateClaim = hasPreEstimate ? 100000 : 0;
          const nonPreEstimate = active.filter(c => !isPreEstimate(c));
          const hasDirectRecovery = nonPreEstimate.some(c => isDirectRecovery(c));
          const targets = hasDirectRecovery ? nonPreEstimate.filter(c => isDirectRecovery(c)) : nonPreEstimate;

          const seenPrefixes = new Set<string>();
          const directClaim = targets.reduce((sum, c) => {
            const cn = c.caseNumber || "";
            const lastDash = cn.lastIndexOf("-");
            const pf = lastDash > 0 ? cn.substring(0, lastDash) : cn;
            if (pf && !seenPrefixes.has(pf)) {
              const inv = invoicesByPrefixMap[pf];
              const invAmt = inv?.totalApprovedAmount ? parseInt(inv.totalApprovedAmount) : 0;
              if (invAmt > 0) {
                seenPrefixes.add(pf);
                return sum + invAmt;
              }
            } else if (pf && seenPrefixes.has(pf)) {
              return sum;
            }
            const invoiceClaim = getCaseInvoiceClaimAmount(c);
            if (invoiceClaim > 0) return sum + invoiceClaim;
            return sum + getCaseApprovedForStats(c);
          }, 0);
          const total = preEstimateClaim + directClaim;
          if (total > 0) return total;
          const hasClaimDate = active.some(c => c.claimDate && c.claimDate.trim() !== "");
          if (hasClaimDate && onlyPreEstimate) return 100000;
          if (hasClaimDate && !onlyPreEstimate) {
            const fallback = targets.reduce((sum, c) => sum + getCaseApprovedForStats(c), 0);
            if (fallback > 0) return fallback;
            const settClaimFallback = active.reduce((sum, c) => {
              const sett = settlementMap[c.id];
              if (sett?.depositEntries?.length) {
                return sum + sett.depositEntries.reduce((s: number, e: any) => s + (e.claimAmount || 0), 0);
              }
              return sum;
            }, 0);
            if (settClaimFallback > 0) return settClaimFallback;
            const estFallback = targets.reduce((sum, c) => sum + getCaseEstimateForStats(c), 0);
            if (estFallback > 0) return estFallback;
          }
          return total;
        })(),
      };
    });

    rows.sort((a, b) => {
      const dateA = a.rep.createdAt || "";
      const dateB = b.rep.createdAt || "";
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const compA = a.rep.insuranceCompany || "";
      const compB = b.rep.insuranceCompany || "";
      if (compA !== compB) return compA.localeCompare(compB);
      return a.accidentNo.localeCompare(b.accidentNo);
    });

    return rows;
  }, [cases, searchQuery, searchType, historicalMode, historicalUnsettledCaseIds, settlementMap, invoicesByPrefixMap]);

  const displayCount = searchType === "사고번호" ? groupedRows.length : filteredCases.length;

  // [페이지네이션 2026-05-06] 한 페이지 10건. searchType에 따라 대상 리스트만 슬라이스.
  // 산식/렌더 함수(renderGroupedRow, renderIndividualRow) 변경 없음 — 입력 배열만 슬라이스.
  const currentList: any[] = searchType === "사고번호" ? groupedRows : filteredCases;
  const { page, setPage, totalPages, pageItems } = useCompactPagination<any>(currentList, 15);
  useEffect(() => { setPage(1); }, [searchQuery, searchType, historicalMode, historicalDate, setPage]);

  const getManagerName = (c: Case): string => {
    if (c.managerId && userMap[c.managerId]) {
      return userMap[c.managerId].name;
    }
    if ((c as any).managerName) return (c as any).managerName;
    return "-";
  };

  const getDepositInfo = (c: Case): { amount: number; date: string } => {
    const settlement = settlementMap[c.id];
    if (settlement?.depositEntries && settlement.depositEntries.length > 0) {
      const totalDeposit = settlement.depositEntries.reduce((sum, entry) => sum + (entry.depositAmount || 0), 0);
      const validDates = settlement.depositEntries
        .map((e) => e.depositDate)
        .filter(Boolean);
      let latestDate = "-";
      if (validDates.length > 0) {
        latestDate = validDates.sort((a, b) => {
          try {
            return parseISO(a).getTime() - parseISO(b).getTime();
          } catch {
            return a.localeCompare(b);
          }
        }).pop() || "-";
      }
      return { amount: totalDeposit, date: latestDate };
    }
    return { amount: 0, date: "-" };
  };

  const getGroupDepositInfo = (groupCases: Case[]): { amount: number; date: string } => {
    let totalAmount = 0;
    let latestDate = "";
    groupCases.forEach((c) => {
      const info = getDepositInfo(c);
      totalAmount += info.amount;
      if (info.date !== "-" && info.date > latestDate) {
        latestDate = info.date;
      }
    });
    return { amount: totalAmount, date: latestDate || "-" };
  };

  const getLatestPaymentDate = (s: Settlement): string => {
    let latest = s.partnerPaymentDate || "";
    const entries = s.paymentEntries as any[];
    if (entries && entries.length > 0) {
      entries.forEach((e: any) => {
        const d = e.paymentDate || "";
        if (d && d > latest) latest = d;
      });
    }
    return latest;
  };

  const getGroupSettlementTotals = (groupCases: Case[]) => {
    let partnerPayment = 0;
    let commission = 0;
    let latestPartnerDate = "";
    let latestClosingDate = "";
    groupCases.forEach((c) => {
      const s = settlementMap[c.id];
      if (s) {
        const topAmount = parseFloat(s.partnerPaymentAmount || "0") || 0;
        if (topAmount > 0) {
          partnerPayment += topAmount;
        } else {
          const entries = s.paymentEntries as any[];
          if (entries && entries.length > 0) {
            partnerPayment += entries.reduce((sum: number, e: any) => sum + (parseFloat(e.paymentAmount || "0") || 0), 0);
          }
        }
        commission += parseFloat(s.commission || "0") || 0;
        const payDate = getLatestPaymentDate(s);
        if (payDate && payDate > latestPartnerDate) latestPartnerDate = payDate;
        const closeDate = s.closingDate || "";
        if (closeDate && closeDate > latestClosingDate) latestClosingDate = closeDate;
      }
    });
    return { partnerPayment, commission, partnerPaymentDate: latestPartnerDate || null, closingDate: latestClosingDate || null };
  };

  const handleExcelDownload = () => {
    const headers = [
      "보험사", "증권번호", "사고번호",
      ...(searchType === "접수번호" ? ["접수번호"] : []),
      "플록슨 담당자", "접수 일자",
      "의뢰사", "의뢰자", "심사사", "심사자",
      "조사사", "조사자", "협력사", "담당자", "배당일자",
      "사고유형", "사고원인", "손방 유무", "대물 유무", "복구방식", "지역", "시군구", "진행상태",
      "견적금액", "견적일자", "승인금액", "승인일자",
      ...(searchType !== "접수번호" ? ["청구액", "청구일자", "입금액계", "입금완료일", "지급액계", "지급완료일", "수수료계", "종결일자"] : []),
    ];

    let rows: string[][];

    if (searchType === "접수번호") {
      rows = filteredCases.map((c) => {
        const deposit = getDepositInfo(c);
        const settlement = settlementMap[c.id];
        const damagePrevention = c.damagePreventionCost === "true" || (c.damagePreventionCost as any) === true;
        const victimIncident = c.victimIncidentAssistance === "true" || (c.victimIncidentAssistance as any) === true;
        const address = c.insuredAddress || c.victimAddress || "";
        return [
          c.insuranceCompany || "",
          c.insurancePolicyNo || "",
          c.insuranceAccidentNo || "",
          c.caseNumber || "",
          getManagerName(c),
          formatDate(c.createdAt),
          c.clientResidence || "",
          c.clientName || "",
          c.assessorId || "",
          c.assessorTeam || "",
          c.investigatorTeam || "",
          c.investigatorTeamName || "",
          c.assignedPartner || "",
          c.assignedPartnerManager || "",
          formatDate(c.assignmentDate),
          c.accidentType || "",
          c.accidentCause || "",
          damagePrevention ? "손방" : "-",
          victimIncident ? "대물" : "-",
          c.restorationMethod || c.recoveryType || "",
          extractRegion(address),
          extractCityDistrict(address),
          c.status,
          c.status === "접수취소" ? "-" : (isPreEstimate(c) ? "-" : (getCaseEstimateForStats(c) ? getCaseEstimateForStats(c).toLocaleString() : "")),
          c.status === "접수취소" ? "-" : (isPreEstimate(c) ? "-" : formatDate(c.siteInvestigationSubmitDate)),
          c.status === "접수취소" ? "-" : (isPreEstimate(c) ? "-" : (() => { const cn = c.caseNumber || ""; const ld = cn.lastIndexOf("-"); const pf = ld > 0 ? cn.substring(0, ld) : cn; const inv = pf ? invoicesByPrefixMap[pf] : null; const invAmt = inv?.totalApprovedAmount ? parseInt(inv.totalApprovedAmount) : 0; if (invAmt > 0) return invAmt.toLocaleString(); const caseClaim = getCaseInvoiceClaimAmount(c) || getCaseApprovedForStats(c); return caseClaim ? caseClaim.toLocaleString() : ""; })()),
          c.status === "접수취소" ? "-" : (isPreEstimate(c) ? "-" : formatDate(c.secondApprovalDate)),
        ];
      });
    } else {
      rows = groupedRows.map((g) => {
        const rep = g.rep;
        const deposit = getGroupDepositInfo(g.cases);
        const sett = getGroupSettlementTotals(g.cases);
        const damagePrevention = rep.damagePreventionCost === "true" || (rep.damagePreventionCost as any) === true;
        const victimIncident = rep.victimIncidentAssistance === "true" || (rep.victimIncidentAssistance as any) === true;
        const address = rep.insuredAddress || rep.victimAddress || "";
        const claimAmount = g.totalClaim;
        return [
          rep.insuranceCompany || "",
          rep.insurancePolicyNo || "",
          g.accidentNo.startsWith("no-acc-") ? "-" : g.accidentNo,
          getManagerName(rep),
          formatDate(rep.createdAt),
          rep.clientResidence || "",
          rep.clientName || "",
          rep.assessorId || "",
          rep.assessorTeam || "",
          rep.investigatorTeam || "",
          rep.investigatorTeamName || "",
          rep.assignedPartner || "",
          rep.assignedPartnerManager || "",
          formatDate(rep.assignmentDate),
          rep.accidentType || "",
          rep.accidentCause || "",
          damagePrevention ? "손방" : "-",
          victimIncident ? "대물" : "-",
          getGroupRestorationMethod(g.cases),
          extractRegion(address),
          extractCityDistrict(address),
          getLatestStatus(g.cases),
          isOnlyPreEstimate(g.cases) ? "-" : (g.totalEstimate !== null ? (g.totalEstimate ? g.totalEstimate.toLocaleString() : "0") : "-"),
          isOnlyPreEstimate(g.cases) ? "-" : (g.totalEstimate !== null ? formatDate(getGroupDate(g.cases, "siteInvestigationSubmitDate") || rep.siteInvestigationSubmitDate) : "-"),
          (() => { if (isOnlyPreEstimate(g.cases)) return "-"; const ad = getGroupDate(g.cases, "secondApprovalDate") || rep.secondApprovalDate; if (!ad) return "-"; return g.totalApproved !== null ? (g.totalApproved ? g.totalApproved.toLocaleString() : "0") : "-"; })(),
          (() => { if (isOnlyPreEstimate(g.cases)) return "-"; const ad = getGroupDate(g.cases, "secondApprovalDate") || rep.secondApprovalDate; if (!ad) return "-"; return g.totalApproved !== null ? formatDate(ad) : "-"; })(),
          (() => { const cd = getGroupDate(g.cases, "claimDate") || rep.claimDate; const hasPreEst = groupHasAnyPreEstimate(g.cases); if (hasPreEst) { if (claimAmount && claimAmount > 0) return claimAmount.toLocaleString(); return "100,000"; } if (!cd) return "-"; if (claimAmount && claimAmount > 0) return claimAmount.toLocaleString(); if (g.totalApproved && g.totalApproved > 0) return g.totalApproved.toLocaleString(); if (g.totalEstimate && g.totalEstimate > 0) return g.totalEstimate.toLocaleString(); return "-"; })(),
          formatDate(getGroupDate(g.cases, "claimDate") || rep.claimDate),
          deposit.amount ? deposit.amount.toLocaleString() : "-",
          formatDate(deposit.date),
          sett.partnerPayment > 0 ? sett.partnerPayment.toLocaleString() : "-",
          sett.partnerPayment > 0 ? formatDate(sett.partnerPaymentDate) : "-",
          sett.commission ? sett.commission.toLocaleString() : "-",
          formatDate(sett.closingDate),
        ];
      });
    }

    const csvContent = [headers.join(","), ...rows.map((r) => r.map((v) => `"${v}"`).join(","))].join("\n");
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const suffix = historicalMode ? `_과거조회_${format(historicalDate, "yyyyMMdd")}` : "";
    link.download = `미결건_통계${suffix}_${format(new Date(), "yyyyMMdd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const stickyColWidths = searchType === "접수번호"
    ? [120, 140, 140, 140, 80, 110]
    : [120, 140, 140, 80, 110];
  const stickyColCount = stickyColWidths.length;
  const stickyColLefts = stickyColWidths.map((_, i) => stickyColWidths.slice(0, i).reduce((a, b) => a + b, 0));

  const stickyTd = (colIdx: number, extra?: React.CSSProperties): React.CSSProperties => ({
    ...cellStyle,
    position: "sticky",
    left: stickyColLefts[colIdx],
    zIndex: 2,
    background: "#FFFFFF",
    minWidth: stickyColWidths[colIdx],
    width: stickyColWidths[colIdx],
    ...(colIdx === stickyColCount - 1 ? { boxShadow: "2px 0 4px rgba(0,0,0,0.06)" } : {}),
    ...extra,
  });

  const stickyTh = (colIdx: number, extra?: React.CSSProperties): React.CSSProperties => ({
    ...headerStyle,
    position: "sticky",
    left: stickyColLefts[colIdx],
    zIndex: 32,
    minWidth: stickyColWidths[colIdx],
    width: stickyColWidths[colIdx],
    ...(colIdx === stickyColCount - 1 ? { boxShadow: "2px 0 4px rgba(0,0,0,0.06)" } : {}),
    ...extra,
  });

  const renderGroupedRow = (g: GroupedRow) => {
    const rep = g.rep;
    const deposit = getGroupDepositInfo(g.cases);
    const sett = getGroupSettlementTotals(g.cases);

    return (
      <tr key={g.accidentNo} data-testid={`row-unsettled-group-${g.accidentNo}`}>
        <td style={stickyTd(0)}>{rep.insuranceCompany || "-"}</td>
        <td style={stickyTd(1, { fontSize: "12px" })}>{rep.insurancePolicyNo || "-"}</td>
        <td style={stickyTd(2, { fontSize: "12px" })}>{g.accidentNo.startsWith("no-acc-") ? "-" : (g.accidentNo || "-")}</td>
        <td style={stickyTd(3)}>{getManagerName(rep)}</td>
        <td style={stickyTd(4)}>{formatDate(rep.createdAt)}</td>
        <td style={cellStyle}>{rep.clientResidence || "-"}</td>
        <td style={cellStyle}>{rep.clientName || "-"}</td>
        <td style={cellStyle}>{rep.assessorId || "-"}</td>
        <td style={cellStyle}>{rep.assessorTeam || "-"}</td>
        <td style={cellStyle}>{rep.investigatorTeam || "-"}</td>
        <td style={cellStyle}>{rep.investigatorTeamName || "-"}</td>
        <td style={cellStyle}>{rep.assignedPartner || "-"}</td>
        <td style={cellStyle}>{rep.assignedPartnerManager || "-"}</td>
        <td style={cellStyle}>{formatDate(rep.assignmentDate)}</td>
        <td style={cellStyle}>{rep.accidentType || "-"}</td>
        <td style={{ ...cellStyle, whiteSpace: "normal", wordBreak: "break-word", maxWidth: "200px" }}>{rep.accidentCause || "-"}</td>
        <td style={cellStyle}>{(rep.damagePreventionCost === "true" || (rep.damagePreventionCost as any) === true) ? "손방" : "-"}</td>
        <td style={cellStyle}>{(rep.victimIncidentAssistance === "true" || (rep.victimIncidentAssistance as any) === true) ? "대물" : "-"}</td>
        <td style={cellStyle}>{getGroupRestorationMethod(g.cases)}</td>
        <td style={cellStyle}>{extractRegion(rep.insuredAddress || rep.victimAddress)}</td>
        <td style={cellStyle}>{extractCityDistrict(rep.insuredAddress || rep.victimAddress)}</td>
        <td style={{ ...cellStyle, fontWeight: 500 }}>{getLatestStatus(g.cases)}</td>
        <td style={{ ...cellStyle, textAlign: "right" }}>{isOnlyPreEstimate(g.cases) ? "-" : (g.totalEstimate !== null ? formatAmount(g.totalEstimate) : "-")}</td>
        <td style={cellStyle}>{isOnlyPreEstimate(g.cases) ? "-" : (g.totalEstimate !== null ? formatDate(getGroupDate(g.cases, "siteInvestigationSubmitDate") || rep.siteInvestigationSubmitDate) : "-")}</td>
        <td style={{ ...cellStyle, textAlign: "right" }}>{(() => { if (isOnlyPreEstimate(g.cases)) return "-"; const approvalDate = getGroupDate(g.cases, "secondApprovalDate") || rep.secondApprovalDate; if (!approvalDate) return "-"; return g.totalApproved !== null ? formatAmount(g.totalApproved) : "-"; })()}</td>
        <td style={cellStyle}>{(() => { if (isOnlyPreEstimate(g.cases)) return "-"; const approvalDate = getGroupDate(g.cases, "secondApprovalDate") || rep.secondApprovalDate; if (!approvalDate) return "-"; return g.totalApproved !== null ? formatDate(approvalDate) : "-"; })()}</td>
        <td style={{ ...cellStyle, textAlign: "right" }}>{(() => { const claimDate = getGroupDate(g.cases, "claimDate") || rep.claimDate; const hasPreEst = groupHasAnyPreEstimate(g.cases); if (hasPreEst) { if (g.totalClaim && g.totalClaim > 0) return formatAmount(g.totalClaim); return formatAmount(100000); } if (!claimDate) return "-"; if (g.totalClaim && g.totalClaim > 0) return formatAmount(g.totalClaim); if (g.totalApproved && g.totalApproved > 0) return formatAmount(g.totalApproved); if (g.totalEstimate && g.totalEstimate > 0) return formatAmount(g.totalEstimate); return "-"; })()}</td>
        <td style={cellStyle}>{formatDate(getGroupDate(g.cases, "claimDate") || rep.claimDate)}</td>
        <td style={{ ...cellStyle, textAlign: "right" }}>{formatAmount(deposit.amount)}</td>
        <td style={cellStyle}>{formatDate(deposit.date)}</td>
        <td style={{ ...cellStyle, textAlign: "right" }}>{sett.partnerPayment > 0 ? formatAmount(sett.partnerPayment) : "-"}</td>
        <td style={cellStyle}>{sett.partnerPayment > 0 ? formatDate(sett.partnerPaymentDate) : "-"}</td>
        <td style={{ ...cellStyle, textAlign: "right" }}>{formatAmount(sett.commission)}</td>
        <td style={{ ...cellStyle, borderRight: "none" }}>{formatDate(sett.closingDate)}</td>
      </tr>
    );
  };

  const renderIndividualRow = (c: Case) => {
    const deposit = getDepositInfo(c);
    const settlement = settlementMap[c.id];
    const preEst = isPreEstimate(c);
    const fieldDispatchAmt = parseFloat(c.fieldDispatchInvoiceAmount || "0") || 0;
    const preEstClaimAmt = (() => {
      if (fieldDispatchAmt > 0) return fieldDispatchAmt;
      const sett = settlementMap[c.id];
      if (sett?.depositEntries?.length) {
        const dc = sett.depositEntries.reduce((s: number, e: any) => s + (e.claimAmount || 0), 0);
        if (dc > 0) return dc;
      }
      return 0;
    })();
    const estimateAmt = preEst ? 0 : getCaseEstimateForStats(c);
    const approvedAmt = preEst ? 0 : getCaseApprovedForStats(c);
    const blankAmounts = c.status === "접수취소";

    return (
      <tr key={c.id} data-testid={`row-unsettled-case-${c.id}`}>
        <td style={stickyTd(0)}>{c.insuranceCompany || "-"}</td>
        <td style={stickyTd(1, { fontSize: "12px" })}>{c.insurancePolicyNo || "-"}</td>
        <td style={stickyTd(2, { fontSize: "12px" })}>{c.insuranceAccidentNo || "-"}</td>
        <td style={stickyTd(3, { fontSize: "12px" })}>{c.caseNumber || "-"}</td>
        <td style={stickyTd(4)}>{getManagerName(c)}</td>
        <td style={stickyTd(5)}>{formatDate(c.createdAt)}</td>
        <td style={cellStyle}>{c.clientResidence || "-"}</td>
        <td style={cellStyle}>{c.clientName || "-"}</td>
        <td style={cellStyle}>{c.assessorId || "-"}</td>
        <td style={cellStyle}>{c.assessorTeam || "-"}</td>
        <td style={cellStyle}>{c.investigatorTeam || "-"}</td>
        <td style={cellStyle}>{c.investigatorTeamName || "-"}</td>
        <td style={cellStyle}>{c.assignedPartner || "-"}</td>
        <td style={cellStyle}>{c.assignedPartnerManager || "-"}</td>
        <td style={cellStyle}>{formatDate(c.assignmentDate)}</td>
        <td style={cellStyle}>{c.accidentType || "-"}</td>
        <td style={{ ...cellStyle, whiteSpace: "normal", wordBreak: "break-word", maxWidth: "200px" }}>{c.accidentCause || "-"}</td>
        <td style={cellStyle}>{(c.damagePreventionCost === "true" || (c.damagePreventionCost as any) === true) ? "손방" : "-"}</td>
        <td style={cellStyle}>{(c.victimIncidentAssistance === "true" || (c.victimIncidentAssistance as any) === true) ? "대물" : "-"}</td>
        <td style={cellStyle}>{c.restorationMethod || c.recoveryType || "-"}</td>
        <td style={cellStyle}>{extractRegion(c.insuredAddress || c.victimAddress)}</td>
        <td style={cellStyle}>{extractCityDistrict(c.insuredAddress || c.victimAddress)}</td>
        <td style={{ ...cellStyle, fontWeight: 500 }}>{c.status}</td>
        <td style={{ ...cellStyle, textAlign: "right" }}>{blankAmounts ? "-" : (preEst ? "-" : formatAmount(estimateAmt))}</td>
        <td style={cellStyle}>{blankAmounts ? "-" : (preEst ? "-" : formatDate(c.siteInvestigationSubmitDate))}</td>
        <td style={{ ...cellStyle, textAlign: "right" }}>{blankAmounts ? "-" : (preEst ? "-" : formatAmount(approvedAmt))}</td>
        <td style={{ ...cellStyle, borderRight: "none" }}>{blankAmounts ? "-" : (preEst ? "-" : formatDate(c.secondApprovalDate))}</td>
      </tr>
    );
  };

  return (
    <div className="flxn-page" style={{ padding: "32px", fontFamily: "Pretendard", background: "var(--color-bg)", minHeight: "100%" }}>
      <div className="flex items-center gap-2 mb-6">
        <h1
          style={{
            fontFamily: "Pretendard",
            fontWeight: 600,
            fontSize: "28px",
            lineHeight: "128%",
            letterSpacing: "-0.02em",
            color: "#56687f",
          }}
        >
          미결건 통계
        </h1>
        <Star size={16} stroke="rgba(12, 12, 12, 0.3)" strokeWidth={2} fill="none" />
      </div>
      <div
        className="flxn-search-card"
        style={{
          background: "#FFFFFF",
          boxShadow: "0px 0px 20px #DBE9F5",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "16px",
        }}
      >
        <div className="flex items-center gap-3" style={{ maxWidth: "640px" }}>
          <div className="relative flex-1">
            <Search size={20} style={{ position: "absolute", left: "16px", top: "50%", transform: "translateY(-50%)", color: "rgba(12, 12, 12, 0.4)" }} />
            <Input
              placeholder="증권번호, 사고번호 또는 접수번호를 입력해주세요"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                }
              }}
              className="w-full"
              style={{
                paddingLeft: "48px",
                height: "52px",
                borderRadius: "8px",
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
              data-testid="input-unsettled-search"
            />
          </div>
          <Button
            style={{
              width: "100px",
              height: "52px",
              background: "var(--color-button-primary)",
              color: "#FFFFFF",
              borderRadius: "8px",
              fontFamily: "Pretendard",
              fontSize: "16px",
              fontWeight: 600,
            }}
            data-testid="button-unsettled-search"
          >
            검색
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {historicalMode && (
          <div className="flex items-center gap-2">
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#D97706", whiteSpace: "nowrap", fontFamily: "Pretendard" }}>
              과거 조회일 :
            </span>
            <Popover open={historicalCalendarOpen} onOpenChange={setHistoricalCalendarOpen}>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-2"
                  style={{
                    height: "36px",
                    padding: "0 12px",
                    border: "1px solid #D97706",
                    borderRadius: "6px",
                    background: "rgba(217, 119, 6, 0.05)",
                    fontSize: "13px",
                    fontFamily: "Pretendard",
                    fontWeight: 500,
                    color: "#D97706",
                    cursor: "pointer",
                  }}
                  data-testid="button-historical-date"
                >
                  <CalendarIcon size={14} />
                  {format(historicalDate, "yyyy.MM.dd")}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <div style={{ padding: "8px 12px", fontSize: "12px", fontWeight: 600, color: "rgba(12,12,12,0.5)", fontFamily: "Pretendard", borderBottom: "1px solid rgba(12,12,12,0.06)" }}>
                  조회할 과거 날짜 선택
                </div>
                <Calendar
                  mode="single"
                  selected={historicalDate}
                  onSelect={(date) => {
                    if (date) {
                      setHistoricalDate(date);
                      setHistoricalCalendarOpen(false);
                    }
                  }}
                  locale={ko}
                  disabled={(date) => date > new Date()}
                />
              </PopoverContent>
            </Popover>
          </div>
        )}

        <div style={{ width: "1px", height: "24px", background: "rgba(12, 12, 12, 0.1)" }} />

        <div className="flex items-center" style={{ borderRadius: "8px", overflow: "hidden", border: "1px solid rgba(12, 12, 12, 0.1)" }}>
          <button
            onClick={() => setSearchType("사고번호")}
            style={{
              height: "36px",
              padding: "0 16px",
              background: searchType === "사고번호" ? "var(--color-button-primary)" : "#FFFFFF",
              color: searchType === "사고번호" ? "#FFFFFF" : "rgba(12, 12, 12, 0.5)",
              fontSize: "13px",
              fontWeight: 600,
              fontFamily: "Pretendard",
              border: "none",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            data-testid="toggle-unsettled-accident-number"
          >
            사고번호
          </button>
          <button
            onClick={() => setSearchType("접수번호")}
            style={{
              height: "36px",
              padding: "0 16px",
              background: searchType === "접수번호" ? "var(--color-button-primary)" : "#FFFFFF",
              color: searchType === "접수번호" ? "#FFFFFF" : "rgba(12, 12, 12, 0.5)",
              fontSize: "13px",
              fontWeight: 600,
              fontFamily: "Pretendard",
              border: "none",
              borderLeft: "1px solid rgba(12, 12, 12, 0.1)",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            data-testid="toggle-unsettled-receipt-number"
          >
            접수번호
          </button>
        </div>

        <div style={{ width: "1px", height: "24px", background: "rgba(12, 12, 12, 0.1)" }} />

        <button
          onClick={() => setHistoricalMode(!historicalMode)}
          className="flex items-center gap-1.5"
          style={{
            height: "36px",
            padding: "0 14px",
            borderRadius: "8px",
            border: historicalMode ? "1px solid #D97706" : "1px solid rgba(12, 12, 12, 0.1)",
            background: historicalMode ? "rgba(217, 119, 6, 0.08)" : "#FFFFFF",
            color: historicalMode ? "#D97706" : "rgba(12, 12, 12, 0.5)",
            fontSize: "13px",
            fontWeight: 600,
            fontFamily: "Pretendard",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
          data-testid="toggle-historical-mode"
        >
          <History size={14} />
          과거 조회
        </button>
      </div>

      {historicalMode && (
        <div
          className="flex items-center gap-2 mb-3"
          style={{
            padding: "10px 16px",
            borderRadius: "8px",
            background: "rgba(217, 119, 6, 0.06)",
            border: "1px solid rgba(217, 119, 6, 0.15)",
            fontSize: "13px",
            fontFamily: "Pretendard",
            color: "#92400E",
          }}
          data-testid="text-historical-notice"
        >
          <History size={14} />
          <span>
            <strong>{format(historicalDate, "yyyy년 MM월 dd일")}</strong> 시점에 미결 상태였던 케이스를 조회합니다.
            상태 변경 이력이 기록된 이후의 데이터만 정확하게 조회됩니다.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <div style={{ display: "flex", alignItems: "center", gap: "4px", fontFamily: "Pretendard" }}>
          <span style={{ fontWeight: 700, fontSize: "20px", lineHeight: "128%", letterSpacing: "-0.02em", color: "#56687f" }}>전체건</span>
          <span style={{ fontWeight: 700, fontSize: "20px", lineHeight: "128%", letterSpacing: "-0.02em", color: "#253396" }}>{displayCount}</span>
          {historicalMode && (
            <span style={{ marginLeft: "8px", color: "#D97706", fontWeight: 600, fontSize: "14px" }}>
              ({format(historicalDate, "yyyy.MM.dd")} 기준)
            </span>
          )}
        </div>
        <Button
          variant="outline"
          onClick={handleExcelDownload}
          className="flex items-center gap-2"
          style={{
            height: "36px",
            borderRadius: "8px",
            fontSize: "13px",
            fontFamily: "Pretendard",
            fontWeight: 500,
            color: "rgba(12, 12, 12, 0.7)",
            border: "1px solid rgba(12, 12, 12, 0.12)",
          }}
          data-testid="button-unsettled-excel-download"
        >
          <Download size={14} />
          엑셀 다운로드
        </Button>
      </div>
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: "12px",
          border: "1px solid rgba(12, 12, 12, 0.06)",
          overflow: "hidden",
        }}
      >
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 280px)", position: "relative" }}>
        <table style={{ width: "max-content", minWidth: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 30 }}>
            <tr>
              <th colSpan={3} style={{ ...headerStyle, borderBottom: "1px solid rgba(12, 12, 12, 0.06)", position: "sticky", left: 0, zIndex: 32, background: "rgba(240,240,240,1)" }}>보험사</th>
              <th colSpan={searchType === "접수번호" ? 3 : 2} style={{ ...headerStyle, borderBottom: "1px solid rgba(12, 12, 12, 0.06)", position: "sticky", left: stickyColLefts[3], zIndex: 32, background: "rgba(240,240,240,1)", boxShadow: "2px 0 4px rgba(0,0,0,0.06)" }}>플록슨</th>
              <th colSpan={2} style={{ ...headerStyle, borderBottom: "1px solid rgba(12, 12, 12, 0.06)" }}>의뢰사</th>
              <th colSpan={2} style={{ ...headerStyle, borderBottom: "1px solid rgba(12, 12, 12, 0.06)" }}>심사사</th>
              <th colSpan={2} style={{ ...headerStyle, borderBottom: "1px solid rgba(12, 12, 12, 0.06)" }}>조사사</th>
              <th colSpan={3} style={{ ...headerStyle, borderBottom: "1px solid rgba(12, 12, 12, 0.06)" }}>협력사</th>
              <th rowSpan={2} style={{ ...headerStyle, width: "100px" }}>사고 유형</th>
              <th rowSpan={2} style={{ ...headerStyle, width: "200px" }}>사고 원인</th>
              <th rowSpan={2} style={{ ...headerStyle, width: "70px" }}>손방 유무</th>
              <th rowSpan={2} style={{ ...headerStyle, width: "70px" }}>대물 유무</th>
              <th rowSpan={2} style={{ ...headerStyle, width: "100px" }}>복구 방식</th>
              <th rowSpan={2} style={{ ...headerStyle, width: "80px" }}>지역</th>
              <th rowSpan={2} style={{ ...headerStyle, width: "100px" }}>시군구</th>
              <th rowSpan={2} style={{ ...headerStyle, width: "120px" }}>진행 상태</th>
              <th colSpan={2} style={{ ...headerStyle, borderBottom: "1px solid rgba(12, 12, 12, 0.06)" }}>견적금액</th>
              <th colSpan={2} style={{ ...headerStyle, borderBottom: "1px solid rgba(12, 12, 12, 0.06)", ...(searchType === "접수번호" ? { borderRight: "none" } : {}) }}>승인금액</th>
              {searchType !== "접수번호" && (
                <>
                  <th colSpan={2} style={{ ...headerStyle, borderBottom: "1px solid rgba(12, 12, 12, 0.06)" }}>청구액</th>
                  <th colSpan={2} style={{ ...headerStyle, borderBottom: "1px solid rgba(12, 12, 12, 0.06)" }}>입금</th>
                  <th colSpan={4} style={{ ...headerStyle, borderBottom: "1px solid rgba(12, 12, 12, 0.06)", borderRight: "none" }}>정산</th>
                </>
              )}
            </tr>
            <tr>
              <th style={stickyTh(0, { width: "120px" })}>보험사</th>
              <th style={stickyTh(1, { width: "140px" })}>증권번호</th>
              <th style={stickyTh(2, { width: "140px" })}>사고번호</th>
              {searchType === "접수번호" && (
                <th style={stickyTh(3, { width: "140px" })}>접수번호</th>
              )}
              <th style={stickyTh(searchType === "접수번호" ? 4 : 3, { width: "80px" })}>담당자</th>
              <th style={stickyTh(searchType === "접수번호" ? 5 : 4, { width: "110px" })}>최초 접수 일자</th>
              <th style={{ ...headerStyle, width: "100px" }}>의뢰사</th>
              <th style={{ ...headerStyle, width: "80px" }}>의뢰자</th>
              <th style={{ ...headerStyle, width: "100px" }}>심사사</th>
              <th style={{ ...headerStyle, width: "80px" }}>심사자</th>
              <th style={{ ...headerStyle, width: "100px" }}>조사사</th>
              <th style={{ ...headerStyle, width: "80px" }}>조사자</th>
              <th style={{ ...headerStyle, width: "100px" }}>협력사</th>
              <th style={{ ...headerStyle, width: "80px" }}>담당자</th>
              <th style={{ ...headerStyle, width: "110px" }}>배당일자</th>
              <th style={{ ...headerStyle, width: "120px" }}>견적금액</th>
              <th style={{ ...headerStyle, width: "110px" }}>견적일자</th>
              <th style={{ ...headerStyle, width: "120px" }}>승인금액</th>
              <th style={{ ...headerStyle, width: "110px", ...(searchType === "접수번호" ? { borderRight: "none" } : {}) }}>승인일자</th>
              {searchType !== "접수번호" && (
                <>
                  <th style={{ ...headerStyle, width: "120px" }}>청구액</th>
                  <th style={{ ...headerStyle, width: "110px" }}>청구일자</th>
                  <th style={{ ...headerStyle, width: "120px" }}>입금액계</th>
                  <th style={{ ...headerStyle, width: "110px" }}>입금완료일</th>
                  <th style={{ ...headerStyle, width: "120px" }}>지급액계</th>
                  <th style={{ ...headerStyle, width: "110px" }}>지급완료일</th>
                  <th style={{ ...headerStyle, width: "120px" }}>수수료계</th>
                  <th style={{ ...headerStyle, width: "110px", borderRight: "none" }}>종결일자</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {displayCount === 0 ? (
              <tr>
                <td
                  colSpan={searchType === "접수번호" ? 27 : 34}
                  style={{
                    padding: "60px 20px",
                    textAlign: "center",
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    color: "rgba(12, 12, 12, 0.4)",
                  }}
                >
                  {historicalMode
                    ? `${format(historicalDate, "yyyy.MM.dd")} 시점의 미결건이 없습니다.`
                    : "해당 기간의 미결건이 없습니다."}
                </td>
              </tr>
            ) : searchType === "사고번호" ? (
              pageItems.map((g) => renderGroupedRow(g))
            ) : (
              pageItems.map((c) => renderIndividualRow(c))
            )}
          </tbody>
        </table>
        </div>
      </div>
      <CompactPagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        testIdPrefix="pagination-unsettled-stats"
      />
    </div>
  );
}
