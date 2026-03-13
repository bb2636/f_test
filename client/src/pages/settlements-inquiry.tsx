import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  User,
  CaseWithLatestProgress,
  Estimate,
  Settlement,
} from "@shared/schema";
import { Search, Calendar as CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { formatCaseNumber } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { InvoiceSheet, getCaseNumberPrefix } from "@/components/InvoiceSheet";
import { FieldDispatchCostSheet } from "@/components/FieldDispatchCostSheet";
import { InvoiceManagementPopup } from "@/components/InvoiceManagementPopup";

// 정산 테이블 행 타입
interface SettlementRow {
  id: string; // Primary case ID (first in group)
  caseIds: string[]; // All case IDs in the group
  caseNumber: string | null; // Combined case numbers (e.g., "251225001-0, 251225001-1")
  caseNumberPrefix: string | null; // Case number prefix for grouping
  insuranceCompany: string;
  manager: string;
  managerId: string | null; // 담당자 ID (관리자)
  assignedPartner: string; // 협력업체명
  withdrawalNumber: string;
  accidentNumber: string;
  admin: string;
  withdrawalDate: string;
  constructionStatus: string;
  recoveryType: string | null; // 복구 유형: 직접복구 | 선견적요청
  // 손해방지비용 (from -0 cases)
  preventionEstimateAmount: number;
  preventionApprovedAmount: number;
  preventionDifference: number;
  preventionAdjustmentRate: string;
  // 대물비용 (sum of -1, -2, etc. cases)
  propertyEstimateAmount: number;
  propertyApprovedAmount: number;
  propertyDifference: number;
  propertyAdjustmentRate: string;
  // 청구액
  claimAmount: number;
  // 정산 데이터
  settlementAmount: number;
  settlementDate: string;
  settlementCommission: number; // 수수료 (손해방지/대물비용 있을 때만)
  usageFee: number; // 사용료 (미수리 시 10만원)
  settlementDeposit: number;
  settlementDeductible: number;
  settlementInvoiceDate: string;
  settlementMemo: string;
  status: string;
  // 협력업체 지급 정보
  partnerPaymentAmount: number; // 협력업체 지급금액
  partnerPaymentDate: string; // 협력업체 지급일
  // 추가 필드
  insuredName: string; // 피보험자 이름
  claimDate: string; // 청구일 (invoicePdfGenerated)
}

interface SettlementsInquiryProps {
  filterMode?: "claim" | "closed";
}

export default function SettlementsInquiry({ filterMode = "claim" }: SettlementsInquiryProps) {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [settlementStatus, setSettlementStatus] = useState("전체");
  const [insuranceCompany, setInsuranceCompany] = useState("전체");
  const [assessor, setAssessor] = useState("전체");
  const [manager, setManager] = useState("전체");
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const [managementDialogOpen, setManagementDialogOpen] = useState(false);
  const [selectedCaseForManagement, setSelectedCaseForManagement] =
    useState<SettlementRow | null>(null);
  const [reportPopoverOpen, setReportPopoverOpen] = useState<Record<string, boolean>>({});

  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showFieldDispatchInvoiceDialog, setShowFieldDispatchInvoiceDialog] =
    useState(false);
  const [invoiceCaseId, setInvoiceCaseId] = useState<string | null>(null);
  const [showInvoiceManagementPopup, setShowInvoiceManagementPopup] =
    useState(false);
  const [selectedCaseForInvoice, setSelectedCaseForInvoice] =
    useState<CaseWithLatestProgress | null>(null);
  const [selectedRelatedCasesForInvoice, setSelectedRelatedCasesForInvoice] =
    useState<CaseWithLatestProgress[]>([]);
  const [selectedCommission, setSelectedCommission] = useState<number>(0);
  const [selectedClaimAmount, setSelectedClaimAmount] = useState<number>(0);

  const { data: currentUser } = useQuery<User>({
    queryKey: ["/api/user"],
  });
  const isPartner = currentUser?.role === "협력사";
  const [selectedEstimateData, setSelectedEstimateData] = useState<{
    preventionEstimate: number;
    preventionApproved: number;
    propertyEstimate: number;
    propertyApproved: number;
  } | null>(null);

  useEffect(() => {
    setSettlementStatus("전체");
    setSearchQuery("");
  }, [filterMode]);

  const { toast } = useToast();

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const { data: cases = [], isLoading: casesLoading } = useQuery<
    CaseWithLatestProgress[]
  >({
    queryKey: ["/api/cases"],
  });

  const { data: allUsers = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  // Fetch all settlements
  const { data: allSettlements = [], isLoading: settlementsLoading } = useQuery<
    Settlement[]
  >({
    queryKey: ["/api/settlements"],
  });

  // Fetch all invoices (for totalApprovedAmount override)
  interface Invoice {
    id: string;
    caseGroupPrefix: string | null;
    totalApprovedAmount: string | null;
    deductible: string | null;
  }
  const { data: allInvoices = [], isLoading: invoicesLoading } = useQuery<
    Invoice[]
  >({
    queryKey: ["/api/invoices"],
  });

  // Create a map for quick invoice lookup by caseGroupPrefix
  const invoicesByPrefixMap = useMemo(() => {
    const map = new Map<string, Invoice>();
    allInvoices.forEach((inv) => {
      if (inv.caseGroupPrefix) {
        map.set(inv.caseGroupPrefix, inv);
      }
    });
    return map;
  }, [allInvoices]);

  // Create a map for quick settlement lookup by caseId (get the latest)
  const settlementsByCaseIdMap = useMemo(() => {
    const map = new Map<string, Settlement>();
    allSettlements.forEach((s) => {
      const existing = map.get(s.caseId);
      // Keep the latest settlement (ordered by createdAt descending from API)
      if (!existing) {
        map.set(s.caseId, s);
      }
    });
    return map;
  }, [allSettlements]);

  // Create a map to get all settlements for a case (for history view)
  const allSettlementsByCaseIdMap = useMemo(() => {
    const map = new Map<string, Settlement[]>();
    allSettlements.forEach((s) => {
      const existing = map.get(s.caseId) || [];
      existing.push(s);
      map.set(s.caseId, existing);
    });
    return map;
  }, [allSettlements]);

  // Helper function to open Invoice Management Popup
  const handleOpenManagement = (row: SettlementRow) => {
    // 같은 사고번호의 모든 케이스들 찾기 (row.caseIds 사용) - 접수취소 건 제외
    const relatedCases = row.caseIds
      .map((caseId) => cases.find((c) => c.id === caseId))
      .filter((c): c is CaseWithLatestProgress => c !== undefined && c.status !== "접수취소");

    // 직접복구 건이 있으면 해당 케이스를 선택, 없으면 첫 번째 케이스
    const directRepairCase = relatedCases.find(
      (c) => c.recoveryType === "직접복구",
    );
    const targetCase =
      directRepairCase || relatedCases[0] || cases.find((c) => c.id === row.id);

    if (targetCase) {
      setSelectedCaseForInvoice(targetCase);
      setSelectedRelatedCasesForInvoice(relatedCases);
      setSelectedEstimateData({
        preventionEstimate: row.preventionEstimateAmount || 0,
        preventionApproved: row.preventionApprovedAmount || 0,
        propertyEstimate: row.propertyEstimateAmount || 0,
        propertyApproved: row.propertyApprovedAmount || 0,
      });
      // 해당 케이스의 수수료를 가져옴 (settlementCommission은 이미 그룹별로 계산된 값)
      setSelectedCommission(row.settlementCommission || 0);
      // 청구액 설정
      setSelectedClaimAmount(row.claimAmount || 0);
      setShowInvoiceManagementPopup(true);
    }
  };

  // Helper function to open Invoice Sheet - recoveryType에 따라 적절한 인보이스 표시
  const handleOpenInvoiceSheet = (row: SettlementRow) => {
    const targetCase = cases.find((c) => c.id === row.id);
    if (targetCase) {
      setInvoiceCaseId(targetCase.id);
      // recoveryType에 따라 적절한 인보이스 다이얼로그 표시
      if (targetCase.recoveryType === "선견적요청") {
        setShowFieldDispatchInvoiceDialog(true);
      } else {
        setShowInvoiceDialog(true);
      }
    }
  };

  // Get settlements for the selected case
  const selectedCaseSettlements = useMemo(() => {
    if (!selectedCaseForManagement) return [];
    return allSettlementsByCaseIdMap.get(selectedCaseForManagement.id) || [];
  }, [selectedCaseForManagement, allSettlementsByCaseIdMap]);

  if (!user) {
    return null;
  }

  // Create maps for quick user lookup by ID, username, and company name
  const usersByIdMap = useMemo(() => {
    const map = new Map<string, User>();
    allUsers.forEach((u) => map.set(u.id, u));
    return map;
  }, [allUsers]);

  const usersByUsernameMap = useMemo(() => {
    const map = new Map<string, User>();
    allUsers.forEach((u) => map.set(u.username, u));
    return map;
  }, [allUsers]);

  const usersByCompanyMap = useMemo(() => {
    const map = new Map<string, User>();
    allUsers.forEach((u) => {
      if (u.company) map.set(u.company, u);
    });
    return map;
  }, [allUsers]);

  // 보험사 목록 (role이 '보험사'인 사용자들의 company 중복 제거)
  const insuranceCompanyOptions = useMemo(() => {
    const companies = new Set<string>();
    allUsers.forEach((u) => {
      if (u.role === "보험사" && u.company) {
        companies.add(u.company);
      }
    });
    return Array.from(companies).sort();
  }, [allUsers]);

  // 심사사 목록 (role이 '심사사'인 사용자들의 company 중복 제거)
  const assessorOptions = useMemo(() => {
    const companies = new Set<string>();
    allUsers.forEach((u) => {
      if (u.role === "심사사" && u.company) {
        companies.add(u.company);
      }
    });
    return Array.from(companies).sort();
  }, [allUsers]);

  // 담당자 목록 (role이 '관리자'인 사용자들의 이름)
  const managerOptions = useMemo(() => {
    return allUsers
      .filter((u) => u.role === "관리자" && u.name)
      .map((u) => u.name)
      .sort();
  }, [allUsers]);

  const settlementStatuses = filterMode === "closed"
    ? ["종결"]
    : ["청구", "입금완료", "부분입금", "부분지급", "지급완료", "정산완료"];
  const claimCases = cases.filter((c) => settlementStatuses.includes(c.status));
  const caseIds = claimCases.map((c) => c.id);

  // Fetch all estimates in a single batch request using react-query
  const { data: estimatesData, isLoading: estimatesLoading } = useQuery({
    queryKey: ["/api/estimates/batch/latest", caseIds],
    queryFn: async () => {
      if (caseIds.length === 0) return [];

      const response = await fetch("/api/estimates/batch/latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseIds }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch estimates");
      }

      return response.json();
    },
    enabled: caseIds.length > 0,
    staleTime: 60000, // 1 minute cache
  });

  // Create a map for quick lookup
  const estimatesMap = useMemo(() => {
    const map = new Map();
    if (estimatesData) {
      for (const item of estimatesData) {
        map.set(item.caseId, item);
      }
    }
    return map;
  }, [estimatesData]);

  // Helper function for parsing amounts
  const parseAmountValue = (
    value: string | number | null | undefined,
  ): number => {
    if (value === null || value === undefined) return 0;
    if (typeof value === "number") return isNaN(value) ? 0 : value;
    const cleaned = String(value).replace(/,/g, "");
    const parsed = Number(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };

  // Helper function to get case suffix (e.g., -0, -1, -2)
  const getCaseSuffix = (caseNumber: string | null): number => {
    if (!caseNumber) return 0;
    const dashIndex = caseNumber.lastIndexOf("-");
    if (dashIndex > 0) {
      const suffix = parseInt(caseNumber.substring(dashIndex + 1), 10);
      return isNaN(suffix) ? 0 : suffix;
    }
    return 0;
  };

  // Build table rows using useMemo with grouping by case number prefix
  const tableRows = useMemo(() => {
    if (!user) return [];

    // First, build individual case data
    const individualCaseData = claimCases.map((caseItem) => {
      const estimateData = estimatesMap.get(caseItem.id);

      // Determine if this is prevention (-0) or property (-1, -2, etc.) based on case number suffix
      const casePrefix = getCaseNumberPrefix(caseItem.caseNumber);
      const caseSuffix = getCaseSuffix(caseItem.caseNumber);
      const isPrevention = caseSuffix === 0; // -0 is prevention cost
      const isProperty = caseSuffix > 0; // -1, -2, etc. are property costs

      // 견적금액 결정 로직:
      // 1. initialEstimateAmount (종합진행관리와 동일하게 사용)
      // 2. 그 외 fallback들
      let estimateTotal = 0;

      // 종합진행관리와 동일하게 initialEstimateAmount 우선 사용
      const initialEstimateAmount = (caseItem as any).initialEstimateAmount;

      if (
        initialEstimateAmount !== null &&
        initialEstimateAmount !== undefined &&
        initialEstimateAmount !== ""
      ) {
        // initialEstimateAmount가 있으면 그 값 사용 (종합진행관리와 동일)
        estimateTotal = parseAmountValue(initialEstimateAmount);
      } else if (estimateData?.estimate?.laborCostData) {
        // 초기 견적금액이 없으면 현재 견적 데이터에서 계산 (아직 제출 전인 경우)
        const laborData = estimateData.estimate.laborCostData as any[];
        const laborTotal = laborData.reduce(
          (sum, row) => sum + (row.amount || 0),
          0,
        );
        const managementFee = Math.round(laborTotal * 0.06);
        const profit = Math.round(laborTotal * 0.15);
        const subtotalBeforeVAT = laborTotal + managementFee + profit;
        const vat = Math.round(subtotalBeforeVAT * 0.1);
        estimateTotal = subtotalBeforeVAT + vat;
      } else {
        estimateTotal = parseAmountValue(caseItem.estimateAmount);
      }

      // Use approvedAmount field if available
      const caseApprovedAmount = parseAmountValue(caseItem.approvedAmount);
      const isApproved =
        caseItem.reviewDecision === "승인" || caseApprovedAmount > 0;
      const approvedValue =
        caseApprovedAmount > 0
          ? caseApprovedAmount
          : isApproved
            ? estimateTotal
            : 0;

      // Get assigned partner's bank information
      const assignedPartnerValue = caseItem.assignedPartner || user.username;
      const partnerUser =
        usersByIdMap.get(assignedPartnerValue) ||
        usersByUsernameMap.get(assignedPartnerValue) ||
        usersByCompanyMap.get(assignedPartnerValue);
      const depositBank = partnerUser?.bankName || "-";

      // 당사 관리자 (플록슨 관리자) - managerId(담당자명) 필드에서 가져옴
      const caseManagerId = caseItem.managerId;
      const caseManagerUser = caseManagerId
        ? usersByIdMap.get(caseManagerId)
        : null;
      const adminName = caseManagerUser?.name || "-";

      // 정산 데이터 파싱
      const settlement = settlementsByCaseIdMap.get(caseItem.id);
      const settlementAmount = settlement
        ? parseAmountValue(settlement.settlementAmount)
        : 0;
      // 수수료/협력업체 지급액: 지급관리(paymentEntries)의 합계를 직접 계산
      // paymentEntries가 없으면 -1로 마킹하여 화면에서 '-' 표시
      const isNoRepair = caseItem.recoveryType === "선견적요청";
      const paymentEntriesArr = (settlement?.paymentEntries && Array.isArray(settlement.paymentEntries)) ? settlement.paymentEntries as any[] : [];
      const hasPaymentEntries = paymentEntriesArr.length > 0;
      const settlementCommission = hasPaymentEntries
        ? paymentEntriesArr.reduce((sum: number, e: any) => sum + (parseAmountValue(e.commission) || 0), 0)
        : -1;
      const usageFee = isNoRepair ? 100000 : 0;
      const settlementDeposit = settlement
        ? parseAmountValue(settlement.discount)
        : 0;
      const settlementDeductible = settlement
        ? parseAmountValue(settlement.deductible)
        : 0;

      return {
        id: caseItem.id,
        caseNumber: caseItem.caseNumber,
        casePrefix,
        caseSuffix,
        isPrevention,
        isProperty,
        estimateTotal,
        approvedValue,
        insuranceCompany: caseItem.insuranceCompany || "-",
        manager: caseItem.assessorId || "-",
        managerId: caseItem.managerId || null,
        withdrawalNumber: caseItem.insurancePolicyNo || "-",
        accidentNumber: caseItem.insuranceAccidentNo || "-",
        admin: adminName,
        depositBank,
        withdrawalDate:
          settlement?.closingDate || caseItem.completionDate || "-",
        constructionStatus:
          caseItem.recoveryType === "직접복구"
            ? "수리"
            : caseItem.recoveryType === "선견적요청"
              ? "미수리"
              : "-",
        recoveryType: caseItem.recoveryType || null,
        settlementAmount,
        settlementDate: (() => {
          // 입금내역의 가장 최근 입금일을 표시
          const entries = (settlement as any)?.depositEntries as any[] | undefined;
          if (entries && entries.length > 0) {
            const sorted = [...entries]
              .filter((e: any) => e.depositDate)
              .sort((a: any, b: any) => b.depositDate.localeCompare(a.depositDate));
            if (sorted.length > 0) return sorted[0].depositDate;
          }
          return settlement?.settlementDate || "-";
        })(),
        settlementCommission,
        usageFee,
        settlementDeposit,
        settlementDeductible,
        settlementInvoiceDate:
          caseItem.taxInvoiceConfirmDate || settlement?.invoiceDate || "-",
        settlementMemo: settlement?.memo || "",
        status: caseItem.status,
        partnerPaymentAmount: hasPaymentEntries
          ? paymentEntriesArr.reduce((sum: number, e: any) => sum + (parseAmountValue(e.paymentAmount) || 0), 0)
          : -1,
        partnerPaymentDate: settlement?.partnerPaymentDate || "-",
        assignedPartner: caseItem.assignedPartner || "-",
        insuredName: caseItem.insuredName || "-",
        claimDate: caseItem.claimDate || "-",
      };
    });

    // Group cases by prefix
    const groupedByPrefix = new Map<string, typeof individualCaseData>();
    individualCaseData.forEach((caseData) => {
      const prefix = caseData.casePrefix || caseData.id; // Use ID if no prefix
      if (!groupedByPrefix.has(prefix)) {
        groupedByPrefix.set(prefix, []);
      }
      groupedByPrefix.get(prefix)!.push(caseData);
    });

    // Build combined rows for each group
    const combinedRows: SettlementRow[] = [];
    groupedByPrefix.forEach((casesInGroup, prefix) => {
      // Sort by suffix
      casesInGroup.sort((a, b) => a.caseSuffix - b.caseSuffix);

      // Combine case numbers
      const combinedCaseNumbers = casesInGroup
        .map((c) => c.caseNumber)
        .filter(Boolean)
        .join(", ");

      // Collect all case IDs
      const allCaseIds = casesInGroup.map((c) => c.id);

      // Use first case for common data (typically -0 case has main info)
      const primaryCase = casesInGroup[0];

      // 관리자 정보는 -0 케이스(손해방지)에서 우선 가져옴
      // -0 케이스가 정산 상태가 아닐 경우, 전체 cases에서 같은 prefix의 -0 케이스를 찾음
      const preventionCaseInGroup = casesInGroup.find((c) => c.isPrevention);
      const zeroCase =
        preventionCaseInGroup ||
        cases.find(
          (c) =>
            getCaseNumberPrefix(c.caseNumber) === prefix &&
            getCaseSuffix(c.caseNumber) === 0,
        );
      // 관리자 ID: -0 케이스의 managerId 우선, 없으면 primaryCase의 managerId
      const groupManagerId =
        zeroCase?.managerId ||
        preventionCaseInGroup?.managerId ||
        primaryCase.managerId;
      // 관리자 이름: groupManagerId로 사용자 이름 조회
      const groupManagerUser = groupManagerId
        ? usersByIdMap.get(groupManagerId)
        : null;
      const groupAdminName = groupManagerUser?.name || "-";

      // 그룹 내 직접복구 건이 있는지 확인
      // 직접복구 건이 하나라도 있으면 해당 건들의 금액만 표시, 사용료 없음
      // 모든 건이 선견적요청일 때만 사용료 10만원
      const hasDirectRepair = casesInGroup.some(
        (c) => c.recoveryType === "직접복구",
      );
      const allNoRepair = casesInGroup.every(
        (c) => c.recoveryType === "선견적요청",
      );

      // Calculate prevention costs (from -0 cases)
      // 직접복구 건만 계산 (선견적요청 건은 제외)
      const preventionCases = casesInGroup.filter((c) => c.isPrevention);
      const directRepairPreventionCases = preventionCases.filter(
        (c) => c.recoveryType === "직접복구",
      );
      const preventionEstimateAmount = directRepairPreventionCases.reduce(
        (sum, c) => sum + c.estimateTotal,
        0,
      );
      const preventionApprovedAmount = directRepairPreventionCases.reduce(
        (sum, c) => sum + c.approvedValue,
        0,
      );
      // 차액: 견적금액 - 승인금액 (승인금액이 더 클 경우 음수 표기)
      const preventionDifference =
        preventionEstimateAmount - preventionApprovedAmount;
      // 수정률: (견적 - 승인) ÷ 견적
      const preventionAdjustmentRate =
        preventionEstimateAmount > 0
          ? ((preventionDifference / preventionEstimateAmount) * 100).toFixed(
              1,
            ) + "%"
          : "-";

      // Calculate property costs (from -1, -2, etc. cases - summed)
      // 직접복구 건만 계산 (선견적요청 건은 제외)
      const propertyCases = casesInGroup.filter((c) => c.isProperty);
      const directRepairPropertyCases = propertyCases.filter(
        (c) => c.recoveryType === "직접복구",
      );
      const propertyEstimateAmount = directRepairPropertyCases.reduce(
        (sum, c) => sum + c.estimateTotal,
        0,
      );
      const propertyApprovedAmount = directRepairPropertyCases.reduce(
        (sum, c) => sum + c.approvedValue,
        0,
      );
      // 차액: 견적금액 - 승인금액 (승인금액이 더 클 경우 음수 표기)
      const propertyDifference =
        propertyEstimateAmount - propertyApprovedAmount;
      // 수정률: (견적 - 승인) ÷ 견적
      const propertyAdjustmentRate =
        propertyEstimateAmount > 0
          ? ((propertyDifference / propertyEstimateAmount) * 100).toFixed(1) +
            "%"
          : "-";

      // Sum settlement amounts for all cases in group
      const totalSettlementAmount = casesInGroup.reduce(
        (sum, c) => sum + c.settlementAmount,
        0,
      );
      // 수수료/협력업체 지급액: 인보이스 관리의 대표 케이스(직접복구 우선)의 paymentEntries만 사용
      const directRepairCases = casesInGroup.filter(
        (c) => c.recoveryType === "직접복구",
      );
      const representativeCase = casesInGroup.find((c) => c.recoveryType === "직접복구") || casesInGroup[0];
      const totalSettlementCommission = representativeCase.settlementCommission;
      // 사용료: 모든 건이 선견적요청일 때만 10만원, 직접복구 건이 하나라도 있으면 0
      const totalUsageFee = allNoRepair ? 100000 : 0;
      const totalSettlementDeposit = casesInGroup.reduce(
        (sum, c) => sum + c.settlementDeposit,
        0,
      );
      const totalSettlementDeductible = casesInGroup.reduce(
        (sum, c) => sum + c.settlementDeductible,
        0,
      );

      // 청구액 = 인보이스 청구금액 합계 (총 승인금액)와 동일 (자기부담금 차감하지 않음)
      // 인보이스에 저장된 totalApprovedAmount가 있으면 그것을 사용 (인보이스 관리에서 수정한 값)
      const invoice = invoicesByPrefixMap.get(prefix);
      const invoiceTotalApproved = invoice?.totalApprovedAmount
        ? parseInt(invoice.totalApprovedAmount)
        : 0;
      const invoiceDeductible = invoice?.deductible
        ? parseInt(invoice.deductible)
        : 0;

      // 계산된 총 승인금액 (기본값)
      const calculatedTotalApproved = hasDirectRepair
        ? preventionApprovedAmount + propertyApprovedAmount
        : allNoRepair
          ? 100000
          : 0;

      // 인보이스에 저장된 값이 있으면 그것을 사용, 없으면 계산값 사용
      const totalApprovedAmount =
        invoiceTotalApproved > 0
          ? invoiceTotalApproved
          : calculatedTotalApproved;

      // 자기부담금: 인보이스에 저장된 값이 있으면 우선 사용
      const finalDeductible =
        invoiceDeductible > 0 ? invoiceDeductible : totalSettlementDeductible;

      // 청구액 = 총 승인금액 (자기부담금 차감 없이 인보이스 합계와 동일하게 표시)
      const claimAmount = totalApprovedAmount;

      // 협력업체 지급 정보: 대표 케이스의 paymentEntries 합계만 사용
      const totalPartnerPaymentAmount = representativeCase.partnerPaymentAmount;

      combinedRows.push({
        id: primaryCase.id,
        caseIds: allCaseIds,
        caseNumber: combinedCaseNumbers || primaryCase.caseNumber,
        caseNumberPrefix: prefix,
        insuranceCompany: primaryCase.insuranceCompany,
        manager: primaryCase.manager,
        managerId: groupManagerId,
        assignedPartner: primaryCase.assignedPartner || "-",
        withdrawalNumber: primaryCase.withdrawalNumber,
        accidentNumber: primaryCase.accidentNumber,
        admin: groupAdminName,
        withdrawalDate: primaryCase.withdrawalDate,
        constructionStatus: hasDirectRepair
          ? "수리"
          : allNoRepair
            ? "미수리"
            : "-",
        recoveryType: hasDirectRepair ? "직접복구" : primaryCase.recoveryType,
        preventionEstimateAmount,
        preventionApprovedAmount,
        preventionDifference,
        preventionAdjustmentRate,
        propertyEstimateAmount,
        propertyApprovedAmount,
        propertyDifference,
        propertyAdjustmentRate,
        claimAmount,
        settlementAmount: totalSettlementAmount,
        settlementDate: casesInGroup.find((c) => c.settlementDate && c.settlementDate !== "-")?.settlementDate || primaryCase.settlementDate,
        settlementCommission: totalSettlementCommission,
        usageFee: totalUsageFee,
        settlementDeposit: totalSettlementDeposit,
        settlementDeductible: totalSettlementDeductible,
        settlementInvoiceDate: casesInGroup.find((c) => c.settlementInvoiceDate && c.settlementInvoiceDate !== "-")?.settlementInvoiceDate || primaryCase.settlementInvoiceDate,
        settlementMemo: casesInGroup.find((c) => c.settlementMemo)?.settlementMemo || primaryCase.settlementMemo,
        status: primaryCase.status,
        partnerPaymentAmount: totalPartnerPaymentAmount,
        partnerPaymentDate: casesInGroup.find((c) => c.partnerPaymentDate && c.partnerPaymentDate !== "-")?.partnerPaymentDate || primaryCase.partnerPaymentDate,
        insuredName: primaryCase.insuredName || "-",
        claimDate: primaryCase.claimDate || "-",
      });
    });

    // 최신 접수순으로 정렬 (접수번호 기준 내림차순)
    combinedRows.sort((a, b) => {
      const prefixA = a.caseNumberPrefix || "";
      const prefixB = b.caseNumberPrefix || "";
      return prefixB.localeCompare(prefixA);
    });

    return combinedRows;
  }, [
    claimCases,
    estimatesMap,
    user,
    usersByIdMap,
    usersByUsernameMap,
    usersByCompanyMap,
    settlementsByCaseIdMap,
    invoicesByPrefixMap,
  ]);

  const isLoading =
    casesLoading ||
    estimatesLoading ||
    usersLoading ||
    settlementsLoading ||
    invoicesLoading;

  // 필터링 (검색어 + 정산여부 + 보험사 + 심사사 + 담당자)
  const filteredRows = useMemo(() => {
    let filtered = tableRows;

    // 정산여부 필터 적용
    if (settlementStatus !== "전체") {
      filtered = filtered.filter((row) => row.status === settlementStatus);
    }

    // 보험사 필터 적용
    if (insuranceCompany !== "전체") {
      filtered = filtered.filter(
        (row) => row.insuranceCompany === insuranceCompany,
      );
    }

    // 심사사 필터 적용 (manager는 assessorId로 심사사 회사명을 저장)
    if (assessor !== "전체") {
      filtered = filtered.filter((row) => {
        return row.manager === assessor;
      });
    }

    // 담당자 필터 적용 (managerId는 관리자 ID이므로 해당 사용자의 name과 비교)
    if (manager !== "전체") {
      filtered = filtered.filter((row) => {
        if (!row.managerId) return false;
        const managerUser = usersByIdMap.get(row.managerId);
        return managerUser?.name === manager;
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((row) => {
        return (
          (row.caseNumber || "").toLowerCase().includes(query) ||
          (row.insuranceCompany || "").toLowerCase().includes(query) ||
          (row.accidentNumber || "").toLowerCase().includes(query) ||
          (row.insuredName || "").toLowerCase().includes(query) ||
          (row.manager || "").toLowerCase().includes(query) ||
          (row.assignedPartner || "").toLowerCase().includes(query) ||
          (row.withdrawalNumber || "").toLowerCase().includes(query)
        );
      });
    }

    // 기간 필터 적용 (청구일 기준)
    if (startDate && endDate) {
      filtered = filtered.filter((row) => {
        if (!row.claimDate || row.claimDate === "-") return false;
        const rowDate = new Date(row.claimDate);
        // 시작일 00:00:00부터 종료일 23:59:59까지 포함
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return rowDate >= start && rowDate <= end;
      });
    }

    return filtered;
  }, [
    tableRows,
    searchQuery,
    settlementStatus,
    insuranceCompany,
    assessor,
    manager,
    usersByIdMap,
    usersByUsernameMap,
    usersByCompanyMap,
    startDate,
    endDate,
  ]);

  const handleReset = () => {
    setSearchQuery("");
    setSettlementStatus("전체");
    setInsuranceCompany("전체");
    setAssessor("전체");
    setManager("전체");
    setStartDate(undefined);
    setEndDate(undefined);
  };

  const handleDateRangeApply = () => {
    if (startDate && endDate) {
      setDateRangeOpen(false);
    }
  };

  return (
    <div className="p-8 bg-white min-h-full">
      {/* Page title */}
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
          {filterMode === "closed" ? "정산 종결" : "정산 청구"}
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
      {/* Search and Filter Section */}
      <div
        className="mb-6"
        style={{
          background: "rgba(255, 255, 255, 0.7)",
          borderRadius: "12px",
          padding: "16px 24px",
          border: "1px solid rgba(12, 12, 12, 0.08)",
        }}
      >
        {/* Filters + Search - All in one row */}
        <div className="flex items-end gap-3 flex-wrap">
          {/* 정산여부 */}
          <div style={{ flex: "0 0 auto", minWidth: "100px" }}>
            <label
              className="block mb-2"
              style={{
                fontFamily: "Pretendard",
                fontSize: "13px",
                fontWeight: 500,
                color: "rgba(12, 12, 12, 0.7)",
              }}
            >
              정산여부
            </label>
            <Select
              value={settlementStatus}
              onValueChange={setSettlementStatus}
            >
              <SelectTrigger
                style={{
                  height: "40px",
                  background: "#F5F5F5",
                  border: "1px solid rgba(12, 12, 12, 0.1)",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                }}
                data-testid="select-settlement-status"
              >
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">전체</SelectItem>
                {filterMode === "closed" ? (
                  <>
                    <SelectItem value="종결">종결</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="청구">청구</SelectItem>
                    <SelectItem value="부분입금">부분입금</SelectItem>
                    <SelectItem value="입금완료">입금완료</SelectItem>
                    <SelectItem value="부분지급">부분지급</SelectItem>
                    <SelectItem value="지급완료">지급완료</SelectItem>
                    <SelectItem value="정산완료">정산완료</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* 보험사 */}
          <div style={{ flex: "0 0 auto", minWidth: "100px" }}>
            <label
              className="block mb-2"
              style={{
                fontFamily: "Pretendard",
                fontSize: "13px",
                fontWeight: 500,
                color: "rgba(12, 12, 12, 0.7)",
              }}
            >
              보험사
            </label>
            <Select
              value={insuranceCompany}
              onValueChange={setInsuranceCompany}
            >
              <SelectTrigger
                style={{
                  height: "40px",
                  background: "#F5F5F5",
                  border: "1px solid rgba(12, 12, 12, 0.1)",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                }}
                data-testid="select-insurance-company"
              >
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">전체</SelectItem>
                {insuranceCompanyOptions.map((company) => (
                  <SelectItem key={company} value={company}>
                    {company}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 심사사 */}
          <div style={{ flex: "0 0 auto", minWidth: "100px" }}>
            <label
              className="block mb-2"
              style={{
                fontFamily: "Pretendard",
                fontSize: "13px",
                fontWeight: 500,
                color: "rgba(12, 12, 12, 0.7)",
              }}
            >
              심사사
            </label>
            <Select value={assessor} onValueChange={setAssessor}>
              <SelectTrigger
                style={{
                  height: "40px",
                  background: "#F5F5F5",
                  border: "1px solid rgba(12, 12, 12, 0.1)",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                }}
                data-testid="select-assessor"
              >
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">전체</SelectItem>
                {assessorOptions.map((company) => (
                  <SelectItem key={company} value={company}>
                    {company}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 담당자 */}
          <div style={{ flex: "0 0 auto", minWidth: "100px" }}>
            <label
              className="block mb-2"
              style={{
                fontFamily: "Pretendard",
                fontSize: "13px",
                fontWeight: 500,
                color: "rgba(12, 12, 12, 0.7)",
              }}
            >
              담당자
            </label>
            <Select value={manager} onValueChange={setManager}>
              <SelectTrigger
                style={{
                  height: "40px",
                  background: "#F5F5F5",
                  border: "1px solid rgba(12, 12, 12, 0.1)",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                }}
                data-testid="select-manager"
              >
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="전체">전체</SelectItem>
                {managerOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 날짜 선택 */}
          <div style={{ flex: "0 0 auto" }}>
            <label
              className="block mb-2"
              style={{
                fontFamily: "Pretendard",
                fontSize: "13px",
                fontWeight: 500,
                color: "rgba(12, 12, 12, 0.7)",
              }}
            >
              날짜 선택
            </label>
            <Popover open={dateRangeOpen} onOpenChange={setDateRangeOpen}>
              <PopoverTrigger asChild>
                <button
                  style={{
                    height: "40px",
                    padding: "0 16px",
                    background: "#F5F5F5",
                    border: "1px solid rgba(12, 12, 12, 0.1)",
                    borderRadius: "8px",
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    whiteSpace: "nowrap",
                  }}
                  data-testid="button-date-range"
                >
                  <CalendarIcon
                    size={16}
                    style={{ color: "rgba(12, 12, 12, 0.5)" }}
                  />
                  {startDate && endDate
                    ? `${format(startDate, "yyyy.MM.dd")} ~ ${format(endDate, "yyyy.MM.dd")}`
                    : "기간설정"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-4" align="start">
                <div className="flex gap-4">
                  <div>
                    <p className="text-sm font-medium mb-2">시작일</p>
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={setStartDate}
                      locale={ko}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">종료일</p>
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={setEndDate}
                      locale={ko}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setStartDate(undefined);
                      setEndDate(undefined);
                    }}
                  >
                    초기화
                  </Button>
                  <Button onClick={handleDateRangeApply}>적용</Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* 초기화 */}
          <Button
            variant="outline"
            onClick={handleReset}
            style={{
              height: "40px",
              padding: "0 16px",
              borderRadius: "8px",
              fontFamily: "Pretendard",
              fontSize: "14px",
            }}
            data-testid="button-reset"
          >
            초기화
          </Button>

          {/* 선택된 조건 검색하기 */}
          <Button
            style={{
              height: "40px",
              padding: "0 20px",
              background: "#008FED",
              borderRadius: "8px",
              fontFamily: "Pretendard",
              fontSize: "14px",
              fontWeight: 600,
              color: "#FFFFFF",
              whiteSpace: "nowrap",
            }}
            data-testid="button-search-with-filters"
          >
            선택된 조건 검색하기
          </Button>

          {/* Search input */}
          <div className="relative" style={{ flex: "1 1 auto", minWidth: "180px" }}>
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2"
              size={16}
              style={{ color: "rgba(12, 12, 12, 0.4)" }}
            />
            <Input
              type="text"
              placeholder="검색어를 직접 검색"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                height: "40px",
                paddingLeft: "36px",
                background: "#FAFAFA",
                border: "1px solid rgba(12, 12, 12, 0.1)",
                borderRadius: "8px",
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
              data-testid="input-search-settlements"
            />
          </div>

          {/* 검색 버튼 */}
          <Button
            style={{
              height: "40px",
              padding: "0 24px",
              background: "#008FED",
              borderRadius: "8px",
              fontFamily: "Pretendard",
              fontSize: "14px",
              fontWeight: 600,
              color: "#FFFFFF",
            }}
            data-testid="button-search-settlements"
          >
            검색
          </Button>
        </div>
      </div>
      {/* Results Count */}
      <div className="mb-4 flex items-center gap-2">
        <span
          style={{
            fontFamily: "Pretendard",
            fontSize: "16px",
            fontWeight: 500,
            color: "rgba(12, 12, 12, 0.7)",
          }}
        >
          결과
        </span>
        <span
          style={{
            fontFamily: "Pretendard",
            fontSize: "16px",
            fontWeight: 600,
            color: "#008FED",
          }}
          data-testid="text-results-count"
        >
          {filteredRows.length}
        </span>
      </div>
      {/* Wide Table with Horizontal Scroll and Sticky Header/Columns */}
      {(() => {
        const stickyHeaders = ["보험사", "사고번호", "피보험자", "담당자(플록슨)", "접수번호", "협력업체"];
        const scrollHeaders = ["청구일", "청구액", "자기부담금", "입금일", "입금액", "협력업체 지급액", "수수료", "계산서 발행일", ...(isPartner ? [] : ["관리"]), ...(filterMode === "closed" && !isPartner ? ["보고서열람"] : [])];
        const allHeaders = [...stickyHeaders, ...scrollHeaders];
        const stickyColWidths = [100, 130, 90, 110, 150, 110];
        const stickyColLefts = stickyColWidths.map((_, i) => stickyColWidths.slice(0, i).reduce((a, b) => a + b, 0));
        const totalStickyWidth = stickyColWidths.reduce((a, b) => a + b, 0);
        const thBaseStyle: React.CSSProperties = {
          padding: "16px",
          fontFamily: "Pretendard",
          fontSize: "14px",
          fontWeight: 600,
          color: "rgba(12, 12, 12, 0.8)",
          borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
          borderRight: "1px solid rgba(12, 12, 12, 0.08)",
          textAlign: "center",
          whiteSpace: "nowrap",
          background: "rgba(240, 240, 240, 1)",
        };
        return (
      <div
        style={{
          background: "rgba(255, 255, 255, 0.7)",
          borderRadius: "12px",
          border: "1px solid rgba(12, 12, 12, 0.08)",
          overflow: "hidden",
        }}
      >
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 280px)", position: "relative" }}>
          <table
            style={{
              width: "max-content",
              minWidth: "100%",
              borderCollapse: "separate",
              borderSpacing: 0,
            }}
          >
            <thead style={{ position: "sticky", top: 0, zIndex: 30 }}>
              <tr>
                {allHeaders.map((label, idx) => {
                  const isStickyCol = idx < stickyHeaders.length;
                  const isLast = idx === allHeaders.length - 1;
                  return (
                    <th
                      key={label}
                      style={{
                        ...thBaseStyle,
                        ...(isStickyCol ? {
                          position: "sticky",
                          left: stickyColLefts[idx],
                          zIndex: 32,
                          minWidth: stickyColWidths[idx],
                          width: stickyColWidths[idx],
                          boxShadow: idx === stickyHeaders.length - 1 ? "2px 0 4px rgba(0,0,0,0.06)" : undefined,
                        } : {}),
                        borderRight: isLast ? "none" : "1px solid rgba(12, 12, 12, 0.08)",
                      }}
                    >
                      {label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={isPartner ? 14 : 15}
                    style={{
                      padding: "48px",
                      textAlign: "center",
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      color: "rgba(12, 12, 12, 0.5)",
                    }}
                  >
                    데이터를 불러오는 중...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={isPartner ? 14 : 15}
                    style={{
                      padding: "48px",
                      textAlign: "center",
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      color: "rgba(12, 12, 12, 0.5)",
                    }}
                  >
                    {searchQuery.trim()
                      ? "검색 결과가 없습니다."
                      : filterMode === "closed" ? "종결 상태의 접수건이 없습니다." : "정산 청구 대상 접수건이 없습니다."}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, index) => {
                  const rowBg = index % 2 === 0 ? "rgba(255, 255, 255, 1)" : "rgba(248, 248, 248, 1)";
                  const cellStyle: React.CSSProperties = {
                    padding: "14px 16px",
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    color: "rgba(12, 12, 12, 0.8)",
                    borderRight: "1px solid rgba(12, 12, 12, 0.05)",
                    textAlign: "center",
                  };
                  const stickyCellStyle = (colIdx: number): React.CSSProperties => ({
                    ...cellStyle,
                    position: "sticky",
                    left: stickyColLefts[colIdx],
                    zIndex: 10,
                    background: rowBg,
                    minWidth: stickyColWidths[colIdx],
                    width: stickyColWidths[colIdx],
                    ...(colIdx === stickyHeaders.length - 1 ? { boxShadow: "2px 0 4px rgba(0,0,0,0.06)" } : {}),
                  });
                  const amountStyle: React.CSSProperties = {
                    ...cellStyle,
                    textAlign: "right",
                  };
                  const renderAmount = (val: number) =>
                    val < 0 ? "-" : val > 0 ? val.toLocaleString() + "원" : "-";

                  return (
                    <tr
                      key={row.id}
                      style={{
                        borderBottom:
                          index < filteredRows.length - 1
                            ? "1px solid rgba(12, 12, 12, 0.05)"
                            : "none",
                        background: rowBg,
                      }}
                    >
                      <td style={stickyCellStyle(0)}>{row.insuranceCompany}</td>
                      <td style={stickyCellStyle(1)}>{row.accidentNumber}</td>
                      <td style={stickyCellStyle(2)}>{row.insuredName}</td>
                      <td style={stickyCellStyle(3)}>
                        {row.managerId ? usersByIdMap.get(row.managerId)?.name || "-" : "-"}
                      </td>
                      <td style={{ ...stickyCellStyle(4), padding: "8px 12px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          {row.caseNumber
                            ?.split(", ")
                            .map((num, idx) => (
                              <div key={idx}>{formatCaseNumber(num)}</div>
                            )) || "-"}
                        </div>
                      </td>
                      <td style={stickyCellStyle(5)}>{row.assignedPartner}</td>
                      <td style={cellStyle}>{row.claimDate}</td>
                      <td style={amountStyle}>{renderAmount(row.claimAmount)}</td>
                      <td style={amountStyle}>{renderAmount(row.settlementDeductible)}</td>
                      <td style={cellStyle}>{row.settlementDate}</td>
                      <td style={amountStyle}>{renderAmount(row.settlementDeposit)}</td>
                      <td style={amountStyle}>{renderAmount(row.partnerPaymentAmount)}</td>
                      <td style={amountStyle}>{renderAmount(row.settlementCommission)}</td>
                      <td style={{ ...cellStyle, borderRight: isPartner ? "none" : cellStyle.borderRight }}>{row.settlementInvoiceDate}</td>
                      {!isPartner && (
                        <td style={{ ...cellStyle, borderRight: filterMode === "closed" ? "1px solid rgba(12, 12, 12, 0.08)" : "none" }}>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenManagement(row);
                            }}
                            data-testid={`button-management-${row.id}`}
                            style={{
                              padding: "4px 12px",
                              height: "28px",
                              fontSize: "12px",
                              fontFamily: "Pretendard",
                            }}
                          >
                            관리
                          </Button>
                        </td>
                      )}
                      {filterMode === "closed" && !isPartner && (
                        <td style={{ ...cellStyle, borderRight: "none" }}>
                          <Popover
                            open={!!reportPopoverOpen[row.id]}
                            onOpenChange={(open) =>
                              setReportPopoverOpen((prev) => ({ ...prev, [row.id]: open }))
                            }
                          >
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`button-report-${row.id}`}
                                style={{
                                  padding: "4px 12px",
                                  height: "28px",
                                  fontSize: "12px",
                                  fontFamily: "Pretendard",
                                  background: "#E8F5E9",
                                  borderColor: "#4CAF50",
                                  color: "#2E7D32",
                                }}
                              >
                                보고서열람
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              className="w-64 p-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div style={{ fontFamily: "Pretendard", fontSize: "12px", padding: "4px 8px", color: "rgba(12,12,12,0.5)", fontWeight: 600 }}>
                                접수건 선택
                              </div>
                              {row.caseIds.map((caseId) => {
                                const c = cases.find((x) => x.id === caseId);
                                if (!c) return null;
                                const suffix = c.caseNumber?.match(/-(\d+)$/)?.[1] ?? "";
                                const label = suffix === "0" ? "손해방지" : `직접복구${suffix !== "1" ? ` (${suffix})` : ""}`;
                                return (
                                  <button
                                    key={caseId}
                                    onClick={() => {
                                      setReportPopoverOpen((prev) => ({ ...prev, [row.id]: false }));
                                      localStorage.setItem("selectedFieldSurveyCaseId", caseId);
                                      localStorage.setItem("returnToComprehensiveProgress", "true");
                                      setLocation("/field-survey/report");
                                    }}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      width: "100%",
                                      padding: "8px 12px",
                                      background: "none",
                                      border: "none",
                                      borderRadius: "6px",
                                      cursor: "pointer",
                                      fontFamily: "Pretendard",
                                      fontSize: "13px",
                                      textAlign: "left",
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.05)"; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                                  >
                                    <span style={{ color: "rgba(12,12,12,0.45)", fontSize: "11px", minWidth: "28px" }}>{c.caseNumber?.split("-").slice(-2).join("-")}</span>
                                    <span style={{ color: "rgba(12,12,12,0.85)" }}>{label}</span>
                                  </button>
                                );
                              })}
                            </PopoverContent>
                          </Popover>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div
          className="flex items-center justify-center p-6"
          style={{
            borderTop: "1px solid rgba(12, 12, 12, 0.05)",
          }}
        >
          <span
            style={{
              fontFamily: "Pretendard",
              fontSize: "14px",
              color: "rgba(12, 12, 12, 0.5)",
            }}
          >
            합계
          </span>
        </div>
      </div>
        );
      })()}
      {/* Settlement Management Dialog */}
      <Dialog
        open={managementDialogOpen}
        onOpenChange={setManagementDialogOpen}
      >
        <DialogContent
          className="max-w-4xl max-h-[80vh] overflow-y-auto"
          style={{
            fontFamily: "Pretendard",
          }}
        >
          <DialogHeader>
            <DialogTitle
              style={{
                fontFamily: "Pretendard",
                fontSize: "18px",
                fontWeight: 600,
              }}
            >
              정산 관리 -{" "}
              {selectedCaseForManagement?.caseNumber
                ? formatCaseNumber(selectedCaseForManagement.caseNumber)
                : ""}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Case Info Summary */}
            {selectedCaseForManagement && (
              <div
                className="p-4 rounded-lg"
                style={{
                  background: "rgba(12, 12, 12, 0.03)",
                  border: "1px solid rgba(12, 12, 12, 0.08)",
                }}
              >
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "rgba(12, 12, 12, 0.5)",
                      }}
                    >
                      보험사
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: 500 }}>
                      {selectedCaseForManagement.insuranceCompany}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "rgba(12, 12, 12, 0.5)",
                      }}
                    >
                      사고번호
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: 500 }}>
                      {selectedCaseForManagement.accidentNumber}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "rgba(12, 12, 12, 0.5)",
                      }}
                    >
                      청구액
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: 500 }}>
                      {selectedCaseForManagement.claimAmount.toLocaleString()}원
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "rgba(12, 12, 12, 0.5)",
                      }}
                    >
                      진행상태
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: 500 }}>
                      {selectedCaseForManagement.status}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Settlement History */}
            <div>
              <h3
                style={{
                  fontSize: "16px",
                  fontWeight: 600,
                  marginBottom: "12px",
                }}
              >
                정산 이력 ({selectedCaseSettlements.length}건)
              </h3>

              {selectedCaseSettlements.length === 0 ? (
                <div
                  className="p-8 text-center rounded-lg"
                  style={{
                    background: "rgba(12, 12, 12, 0.03)",
                    border: "1px solid rgba(12, 12, 12, 0.08)",
                  }}
                >
                  <span
                    style={{ fontSize: "14px", color: "rgba(12, 12, 12, 0.5)" }}
                  >
                    정산 이력이 없습니다.
                  </span>
                </div>
              ) : (
                <div
                  className="rounded-lg overflow-hidden"
                  style={{ border: "1px solid rgba(12, 12, 12, 0.08)" }}
                >
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "rgba(12, 12, 12, 0.06)" }}>
                        <th
                          style={{
                            padding: "12px 16px",
                            fontSize: "13px",
                            fontWeight: 600,
                            textAlign: "center",
                            borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                          }}
                        >
                          정산일
                        </th>
                        <th
                          style={{
                            padding: "12px 16px",
                            fontSize: "13px",
                            fontWeight: 600,
                            textAlign: "right",
                            borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                          }}
                        >
                          정산금액
                        </th>
                        <th
                          style={{
                            padding: "12px 16px",
                            fontSize: "13px",
                            fontWeight: 600,
                            textAlign: "right",
                            borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                          }}
                        >
                          수수료
                        </th>
                        <th
                          style={{
                            padding: "12px 16px",
                            fontSize: "13px",
                            fontWeight: 600,
                            textAlign: "right",
                            borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                          }}
                        >
                          할인
                        </th>
                        <th
                          style={{
                            padding: "12px 16px",
                            fontSize: "13px",
                            fontWeight: 600,
                            textAlign: "right",
                            borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                          }}
                        >
                          자기부담금
                        </th>
                        <th
                          style={{
                            padding: "12px 16px",
                            fontSize: "13px",
                            fontWeight: 600,
                            textAlign: "center",
                            borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                          }}
                        >
                          계산서 발행일
                        </th>
                        <th
                          style={{
                            padding: "12px 16px",
                            fontSize: "13px",
                            fontWeight: 600,
                            textAlign: "left",
                            borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                          }}
                        >
                          메모
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedCaseSettlements.map((settlement, index) => (
                        <tr
                          key={settlement.id}
                          style={{
                            background:
                              index % 2 === 0
                                ? "#fff"
                                : "rgba(12, 12, 12, 0.02)",
                          }}
                        >
                          <td
                            style={{
                              padding: "12px 16px",
                              fontSize: "14px",
                              textAlign: "center",
                              borderBottom: "1px solid rgba(12, 12, 12, 0.05)",
                            }}
                          >
                            {settlement.settlementDate || "-"}
                          </td>
                          <td
                            style={{
                              padding: "12px 16px",
                              fontSize: "14px",
                              textAlign: "right",
                              borderBottom: "1px solid rgba(12, 12, 12, 0.05)",
                            }}
                          >
                            {settlement.settlementAmount
                              ? parseInt(
                                  settlement.settlementAmount,
                                ).toLocaleString() + "원"
                              : "-"}
                          </td>
                          <td
                            style={{
                              padding: "12px 16px",
                              fontSize: "14px",
                              textAlign: "right",
                              borderBottom: "1px solid rgba(12, 12, 12, 0.05)",
                            }}
                          >
                            {settlement.commission
                              ? parseInt(
                                  settlement.commission,
                                ).toLocaleString() + "원"
                              : "-"}
                          </td>
                          <td
                            style={{
                              padding: "12px 16px",
                              fontSize: "14px",
                              textAlign: "right",
                              borderBottom: "1px solid rgba(12, 12, 12, 0.05)",
                            }}
                          >
                            {settlement.discount
                              ? parseInt(settlement.discount).toLocaleString() +
                                "원"
                              : "-"}
                          </td>
                          <td
                            style={{
                              padding: "12px 16px",
                              fontSize: "14px",
                              textAlign: "right",
                              borderBottom: "1px solid rgba(12, 12, 12, 0.05)",
                            }}
                          >
                            {settlement.deductible
                              ? parseInt(
                                  settlement.deductible,
                                ).toLocaleString() + "원"
                              : "-"}
                          </td>
                          <td
                            style={{
                              padding: "12px 16px",
                              fontSize: "14px",
                              textAlign: "center",
                              borderBottom: "1px solid rgba(12, 12, 12, 0.05)",
                            }}
                          >
                            {settlement.invoiceDate || "-"}
                          </td>
                          <td
                            style={{
                              padding: "12px 16px",
                              fontSize: "14px",
                              textAlign: "left",
                              borderBottom: "1px solid rgba(12, 12, 12, 0.05)",
                              maxWidth: "200px",
                            }}
                          >
                            <span
                              style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                display: "block",
                              }}
                            >
                              {settlement.memo || "-"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Total Summary */}
            {selectedCaseSettlements.length > 0 && (
              <div
                className="p-4 rounded-lg"
                style={{
                  background: "rgba(0, 143, 237, 0.05)",
                  border: "1px solid rgba(0, 143, 237, 0.15)",
                }}
              >
                <div className="flex justify-between items-center">
                  <span style={{ fontSize: "14px", fontWeight: 500 }}>
                    총 정산금액
                  </span>
                  <span
                    style={{
                      fontSize: "18px",
                      fontWeight: 600,
                      color: "#008FED",
                    }}
                  >
                    {selectedCaseSettlements
                      .reduce(
                        (sum, s) => sum + (parseInt(s.settlementAmount) || 0),
                        0,
                      )
                      .toLocaleString()}
                    원
                  </span>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {/* INVOICE Sheet - 직접복구 케이스용 (손해방지비용 + 대물복구비용) */}
      <InvoiceSheet
        open={showInvoiceDialog}
        onOpenChange={setShowInvoiceDialog}
        caseData={cases?.find((c) => c.id === invoiceCaseId) || null}
        relatedCases={(() => {
          const invoiceCase = cases?.find((c) => c.id === invoiceCaseId);
          const invoiceCasePrefix = getCaseNumberPrefix(
            invoiceCase?.caseNumber,
          );
          return invoiceCasePrefix
            ? cases?.filter(
                (c) => getCaseNumberPrefix(c.caseNumber) === invoiceCasePrefix && c.status !== "접수취소",
              ) || []
            : invoiceCase && invoiceCase.status !== "접수취소"
              ? [invoiceCase]
              : [];
        })()}
      />
      {/* 현장출동비용 청구 Sheet - 선견적요청 케이스용 (현장출동비용만) */}
      <FieldDispatchCostSheet
        open={showFieldDispatchInvoiceDialog}
        onOpenChange={setShowFieldDispatchInvoiceDialog}
        caseData={cases?.find((c) => c.id === invoiceCaseId) || null}
        relatedCases={(() => {
          const invoiceCase = cases?.find((c) => c.id === invoiceCaseId);
          const invoiceCasePrefix = getCaseNumberPrefix(
            invoiceCase?.caseNumber,
          );
          return invoiceCasePrefix
            ? cases?.filter(
                (c) => getCaseNumberPrefix(c.caseNumber) === invoiceCasePrefix && c.status !== "접수취소",
              ) || []
            : invoiceCase && invoiceCase.status !== "접수취소"
              ? [invoiceCase]
              : [];
        })()}
      />
      {/* 인보이스 관리 팝업 */}
      <InvoiceManagementPopup
        open={showInvoiceManagementPopup}
        onOpenChange={setShowInvoiceManagementPopup}
        caseData={selectedCaseForInvoice}
        estimateData={selectedEstimateData}
        relatedCases={selectedRelatedCasesForInvoice.map((c) => ({
          id: c.id,
          caseNumber: c.caseNumber,
          recoveryType: c.recoveryType,
          estimateAmount: null,
        }))}
        managerName={(() => {
          if (!selectedCaseForInvoice?.managerId) return "-";
          const manager = usersByIdMap.get(selectedCaseForInvoice.managerId);
          return manager?.name || "-";
        })()}
        managerContact={(() => {
          if (!selectedCaseForInvoice?.managerId) return "-";
          const manager = usersByIdMap.get(selectedCaseForInvoice.managerId);
          return manager?.phone || "-";
        })()}
        settlementCommission={selectedCommission}
        settlementClaimAmount={selectedClaimAmount}
      />
    </div>
  );
}
