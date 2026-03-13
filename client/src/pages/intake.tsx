import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { User, MasterData, Case } from "@shared/schema";
import { formatCaseNumber } from "@/lib/utils";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Star, X, Calendar as CalendarIcon, Search, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { GlobalHeader } from "@/components/global-header";

const extractCityFromAddress = (address: string): string => {
  if (!address) return "";
  const specialCityMatch = address.match(
    /(서울|부산|대구|인천|광주|대전|울산|세종)/,
  );
  if (specialCityMatch) return specialCityMatch[1];
  const cityMatch = address.match(/([가-힣]+)시/);
  if (cityMatch) return cityMatch[1];
  const guMatch = address.match(/([가-힣]+)구/);
  if (guMatch) return guMatch[1];
  const parts = address
    .trim()
    .split(/[\s/]+/)
    .filter((p) => p.length > 0);
  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1];
    if (!lastPart.endsWith("도")) return lastPart;
    if (parts.length > 2) return parts[parts.length - 2];
  }
  return address.trim();
};

interface IntakeProps {
  isModal?: boolean;
  onClose?: () => void;
  onSuccess?: () => void;
  initialCaseId?: string | null;
  readOnly?: boolean;
}

const inputClasses =
  "h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100";
const disabledInputClasses =
  "h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400 outline-none";
const selectTriggerClasses =
  "h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 [&>span]:text-left";

const labelClasses =
  "text-xs font-medium text-slate-500 whitespace-nowrap min-w-[70px] shrink-0";
const fieldRowClasses = "flex items-center gap-2";

const RequiredMark = () => <span className="text-sky-500 ml-0.5">*</span>;

export default function Intake({
  isModal = false,
  onClose,
  onSuccess,
  initialCaseId = null,
  readOnly = false,
}: IntakeProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [sameAsPolicyHolder, setSameAsPolicyHolder] = useState(false);
  const [additionalVictims, setAdditionalVictims] = useState<
    Array<{ name: string; phone: string; address: string }>
  >([]);

  const [accidentDate, setAccidentDate] = useState<Date | undefined>(
    () => new Date(),
  );
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const [predictedPrefix, setPredictedPrefix] = useState<string>("");
  const [predictedSuffix, setPredictedSuffix] = useState<number>(0);
  const [loadedCaseNumber, setLoadedCaseNumber] = useState<string | null>(null);

  const [isPartnerSearchOpen, setIsPartnerSearchOpen] = useState(false);
  const [partnerSearchQuery, setPartnerSearchQuery] = useState("");
  const [selectedPartner, setSelectedPartner] = useState<any>(null);
  const [tempSelectedPartner, setTempSelectedPartner] = useState<any>(null);

  const [isClientSearchOpen, setIsClientSearchOpen] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [tempSelectedClient, setTempSelectedClient] = useState<any>(null);
  
  // 초기 협력사 정보 저장 (수정 시 협력사 변경 감지용)
  const [initialPartnerInfo, setInitialPartnerInfo] = useState<{
    assignedPartner: string;
    assignedPartnerContact: string;
  } | null>(null);

  const [isAssessorSearchOpen, setIsAssessorSearchOpen] = useState(false);
  const [assessorSearchQuery, setAssessorSearchQuery] = useState("");
  const [tempSelectedAssessor, setTempSelectedAssessor] = useState<any>(null);

  const [isInvestigatorSearchOpen, setIsInvestigatorSearchOpen] =
    useState(false);
  const [investigatorSearchQuery, setInvestigatorSearchQuery] = useState("");
  const [tempSelectedInvestigator, setTempSelectedInvestigator] =
    useState<any>(null);

  const [addressDropdownOpen, setAddressDropdownOpen] = useState<
    "main" | "detail" | null
  >(null);
  const addressContainerRef = useRef<HTMLDivElement>(null);
  const detailAddressContainerRef = useRef<HTMLDivElement>(null);

  const [insuredAddressDropdownOpen, setInsuredAddressDropdownOpen] =
    useState(false);
  const insuredAddressContainerRef = useRef<HTMLDivElement>(null);
  const insuredAddressWrapperRef = useRef<HTMLDivElement>(null);

  // ESC 키로 모달 및 드롭다운 닫기
  useEffect(() => {
    const handleEscKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (addressDropdownOpen) {
          setAddressDropdownOpen(null);
        }
        if (insuredAddressDropdownOpen) {
          setInsuredAddressDropdownOpen(false);
        }
        if (isPartnerSearchOpen) {
          setIsPartnerSearchOpen(false);
        }
        if (isClientSearchOpen) {
          setIsClientSearchOpen(false);
        }
        if (isAssessorSearchOpen) {
          setIsAssessorSearchOpen(false);
        }
        if (isInvestigatorSearchOpen) {
          setIsInvestigatorSearchOpen(false);
        }
        if (datePickerOpen) {
          setDatePickerOpen(false);
        }
      }
    };

    document.addEventListener("keydown", handleEscKey);
    return () => document.removeEventListener("keydown", handleEscKey);
  }, [
    addressDropdownOpen,
    insuredAddressDropdownOpen,
    isPartnerSearchOpen,
    isClientSearchOpen,
    isAssessorSearchOpen,
    isInvestigatorSearchOpen,
    datePickerOpen,
  ]);

  // 외부 클릭 시 피보험자 주소 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        insuredAddressDropdownOpen &&
        insuredAddressWrapperRef.current &&
        !insuredAddressWrapperRef.current.contains(e.target as Node)
      ) {
        setInsuredAddressDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [insuredAddressDropdownOpen]);

  const { data: partnerStats } = useQuery<
    Array<{
      partnerName: string;
      dailyCount: number;
      monthlyCount: number;
      inProgressCount: number;
      pendingCount: number;
    }>
  >({
    queryKey: ["/api/partner-stats"],
  });

  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const { data: masterDataList = [] } = useQuery<MasterData[]>({
    queryKey: ["/api/master-data"],
  });

  const getMasterDataOptions = (category: string) => {
    return masterDataList
      .filter((item) => item.category === category && item.isActive === "true")
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((item) => item.value);
  };

  const { data: favorites = [] } = useQuery<
    Array<{ id: string; userId: string; menuName: string }>
  >({
    queryKey: ["/api/favorites"],
  });

  const isFavorite = favorites.some((f) => f.menuName === "접수하기");

  const addFavoriteMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/favorites", {
        menuName: "접수하기",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      toast({ description: "즐겨찾기에 추가되었습니다.", duration: 2000 });
    },
    onError: () => {
      toast({
        description: "즐겨찾기 추가에 실패했습니다.",
        variant: "destructive",
        duration: 2000,
      });
    },
  });

  const removeFavoriteMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", "/api/favorites/접수하기");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      toast({ description: "즐겨찾기에서 제거되었습니다.", duration: 2000 });
    },
    onError: () => {
      toast({
        description: "즐겨찾기 제거에 실패했습니다.",
        variant: "destructive",
        duration: 2000,
      });
    },
  });

  const handleToggleFavorite = () => {
    if (isFavorite) {
      removeFavoriteMutation.mutate();
    } else {
      addFavoriteMutation.mutate();
    }
  };

  const { data: assessors } = useQuery<User[]>({
    queryKey: ["/api/users"],
    select: (users) => users.filter((u) => u.role === "심사사"),
  });

  const { data: investigators } = useQuery<User[]>({
    queryKey: ["/api/users"],
    select: (users) => users.filter((u) => u.role === "조사사"),
  });

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: partners } = useQuery<User[]>({
    queryKey: ["/api/users"],
    select: (users) => users.filter((u) => u.role === "협력사"),
  });

  const { data: administrators } = useQuery<User[]>({
    queryKey: ["/api/users"],
    select: (users) => users.filter((u) => u.role === "관리자"),
  });

  const { data: insuranceCompanies = [] } = useQuery<string[]>({
    queryKey: ["/api/insurance-companies"],
  });

  const partnersWithStats = useMemo(() => {
    if (!partners) return [];
    const uniqueCompanies = Array.from(new Set(partners.map((p) => p.company)));
    return uniqueCompanies.map((companyName) => {
      const stats = partnerStats?.find((s) => s.partnerName === companyName);
      const partnerUser = partners.find((p) => p.company === companyName);
      return {
        name: companyName,
        dailyCount: stats?.dailyCount || 0,
        monthlyCount: stats?.monthlyCount || 0,
        inProgressCount: stats?.inProgressCount || 0,
        pendingCount: stats?.pendingCount || 0,
        region: partnerUser?.serviceRegions?.join(", ") || "",
      };
    });
  }, [partners, partnerStats]);

  const partnerManagers = useMemo(() => {
    if (!selectedPartner || !partners) return [];
    return partners.filter((p) => p.company === selectedPartner.name);
  }, [selectedPartner, partners]);

  const getTodayDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const [editCaseId, setEditCaseId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    managerId: "",
    managerDepartment: "",
    managerPosition: "",
    managerContact: "",
    accidentDate: getTodayDate(),
    insuranceCompany: "",
    insurancePolicyNo: "",
    insuranceAccidentNo: "",
    clientResidence: "",
    clientDepartment: "",
    clientName: "",
    clientContact: "",
    assessorId: "",
    assessorDepartment: "",
    assessorTeam: "",
    assessorContact: "",
    assessorEmail: "",
    investigatorTeam: "",
    investigatorDepartment: "",
    investigatorTeamName: "",
    investigatorContact: "",
    investigatorEmail: "",
    policyHolderName: "",
    policyHolderIdNumber: "",
    policyHolderAddress: "",
    insuredName: "",
    insuredIdNumber: "",
    insuredContact: "",
    insuredAddress: "",
    insuredAddressDetail: "",
    victimName: "",
    victimContact: "",
    victimAddress: "",
    victimAddressDetail: "",
    accompaniedPerson: "",
    accidentType: "",
    accidentCause: "",
    restorationMethod: "",
    otherVendorEstimate: "",
    accidentDescription: "",
    damageItem: "",
    damageType: "",
    damageQuantity: "1",
    damageDetails: "",
    damageItems: [] as Array<{
      item: string;
      type: string;
      quantity: string;
      details: string;
    }>,
    damagePreventionCost: false,
    victimIncidentAssistance: false,
    assignedPartner: "",
    assignedPartnerManager: "",
    assignedPartnerContact: "",
    urgency: "",
    specialRequests: "",
  });

  const filteredPartners = useMemo(() => {
    if (partnerSearchQuery) {
      return partnersWithStats.filter((p) =>
        p.name.toLowerCase().includes(partnerSearchQuery.toLowerCase()),
      );
    }
    const city = extractCityFromAddress(formData.insuredAddress);
    if (city) {
      const regionFiltered = partnersWithStats.filter((p) =>
        p.region.includes(city),
      );
      if (regionFiltered.length > 0) return regionFiltered;
    }
    return partnersWithStats;
  }, [partnerSearchQuery, partnersWithStats, formData.insuredAddress]);

  const filteredClientEmployees = useMemo(() => {
    if (!formData.clientResidence || !allUsers) return [];
    return allUsers.filter((emp) => emp.company === formData.clientResidence);
  }, [formData.clientResidence, allUsers]);

  const filteredAssessorEmployees = useMemo(() => {
    if (!formData.assessorId || !assessors) return [];
    if (formData.assessorDepartment) {
      return assessors.filter(
        (emp) =>
          emp.company === formData.assessorId &&
          emp.department === formData.assessorDepartment,
      );
    }
    return assessors.filter((emp) => emp.company === formData.assessorId);
  }, [formData.assessorId, formData.assessorDepartment, assessors]);

  const filteredAssessorDepartments = useMemo(() => {
    if (!formData.assessorId || !assessors) return [];
    const departments = assessors
      .filter((emp) => emp.company === formData.assessorId)
      .map((emp) => emp.department)
      .filter((dept): dept is string => !!dept);
    return Array.from(new Set(departments));
  }, [formData.assessorId, assessors]);

  const filteredInvestigatorEmployees = useMemo(() => {
    if (!formData.investigatorTeam || !investigators) return [];
    if (formData.investigatorDepartment) {
      return investigators.filter(
        (emp) =>
          emp.company === formData.investigatorTeam &&
          emp.department === formData.investigatorDepartment,
      );
    }
    return investigators.filter(
      (emp) => emp.company === formData.investigatorTeam,
    );
  }, [
    formData.investigatorTeam,
    formData.investigatorDepartment,
    investigators,
  ]);

  const filteredInvestigatorDepartments = useMemo(() => {
    if (!formData.investigatorTeam || !investigators) return [];
    const departments = investigators
      .filter((emp) => emp.company === formData.investigatorTeam)
      .map((emp) => emp.department)
      .filter((dept): dept is string => !!dept);
    return Array.from(new Set(departments));
  }, [formData.investigatorTeam, investigators]);

  const investigatorCompanies = useMemo(() => {
    if (!investigators) return [];
    const companies = investigators
      .map((inv) => inv.company)
      .filter((company): company is string => !!company);
    return Array.from(new Set(companies));
  }, [investigators]);

  const assessorCompanies = useMemo(() => {
    if (!assessors) return [];
    const companies = assessors
      .map((a) => a.company)
      .filter((company): company is string => !!company);
    return Array.from(new Set(companies));
  }, [assessors]);

  // 의뢰사 = 보험사 + 심사사 + 조사사 회사 모두 포함 (중복 제거)
  const clientCompanies = useMemo(() => {
    const allCompanies = new Set<string>();
    insuranceCompanies.forEach((c) => {
      if (c && c.trim()) allCompanies.add(c.trim());
    });
    assessorCompanies.forEach((c) => {
      if (c && c.trim()) allCompanies.add(c.trim());
    });
    investigatorCompanies.forEach((c) => {
      if (c && c.trim()) allCompanies.add(c.trim());
    });
    return Array.from(allCompanies).sort();
  }, [insuranceCompanies, assessorCompanies, investigatorCompanies]);

  const filteredClientUsers = useMemo(() => {
    if (!allUsers) return [];
    const clientRoleUsers = allUsers.filter((u) => u.role === "의뢰사" || clientCompanies.includes(u.company || ""));
    if (!clientSearchQuery) return clientRoleUsers;
    const q = clientSearchQuery.toLowerCase();
    return clientRoleUsers.filter((u) =>
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.company && u.company.toLowerCase().includes(q)) ||
      (u.department && u.department.toLowerCase().includes(q))
    );
  }, [allUsers, clientCompanies, clientSearchQuery]);

  const filteredAssessorUsers = useMemo(() => {
    if (!assessors) return [];
    if (!assessorSearchQuery) return assessors;
    const q = assessorSearchQuery.toLowerCase();
    return assessors.filter((u) =>
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.company && u.company.toLowerCase().includes(q)) ||
      (u.department && u.department.toLowerCase().includes(q))
    );
  }, [assessors, assessorSearchQuery]);

  const filteredInvestigatorUsers = useMemo(() => {
    if (!investigators) return [];
    if (!investigatorSearchQuery) return investigators;
    const q = investigatorSearchQuery.toLowerCase();
    return investigators.filter((u) =>
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.company && u.company.toLowerCase().includes(q)) ||
      (u.department && u.department.toLowerCase().includes(q))
    );
  }, [investigators, investigatorSearchQuery]);

  const displayCaseNumber = useMemo(() => {
    const hasDamagePrevention =
      formData.damagePreventionCost === true ||
      (formData.damagePreventionCost as unknown) === "true";
    const hasVictimRecovery =
      formData.victimIncidentAssistance === true ||
      (formData.victimIncidentAssistance as unknown) === "true";

    let basePrefix = "";
    if (loadedCaseNumber && loadedCaseNumber !== "-") {
      if (loadedCaseNumber.includes("-")) {
        basePrefix = loadedCaseNumber.split("-")[0];
      } else {
        basePrefix = loadedCaseNumber;
      }
    } else if (predictedPrefix) {
      basePrefix = predictedPrefix;
    }

    if (!basePrefix) return "-";
    if (!hasDamagePrevention && !hasVictimRecovery) return "-";
    if (hasDamagePrevention && hasVictimRecovery)
      return `${basePrefix}-0, ${basePrefix}-1`;
    if (hasDamagePrevention && !hasVictimRecovery) return `${basePrefix}-0`;

    if (loadedCaseNumber && loadedCaseNumber.includes("-")) {
      const existingSuffix = loadedCaseNumber.split("-")[1];
      if (
        existingSuffix &&
        existingSuffix !== "0" &&
        parseInt(existingSuffix) >= 1
      ) {
        return loadedCaseNumber;
      }
    }
    const victimSuffix = predictedSuffix === 0 ? 1 : predictedSuffix;
    return `${basePrefix}-${victimSuffix}`;
  }, [
    loadedCaseNumber,
    predictedPrefix,
    predictedSuffix,
    formData.damagePreventionCost,
    formData.victimIncidentAssistance,
  ]);

  useEffect(() => {
    if (!isModal && !userLoading && !user) {
      setLocation("/");
    }
  }, [user, userLoading, setLocation, isModal]);

  useEffect(() => {
    const script = document.createElement("script");
    script.src =
      "//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
    script.async = true;
    document.head.appendChild(script);
    return () => {
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, []);

  useEffect(() => {
    const fetchPredictedCaseNumber = async () => {
      if (!formData.accidentDate) return;
      try {
        const params = new URLSearchParams({ date: formData.accidentDate });
        if (formData.insuranceAccidentNo) {
          params.append("insuranceAccidentNo", formData.insuranceAccidentNo);
        }
        const response = await apiRequest(
          "GET",
          `/api/cases/next-sequence?${params.toString()}`,
        );
        const data = await response.json();
        setPredictedPrefix(data.prefix);
        setPredictedSuffix(data.suffix);
      } catch (error) {
        console.error("Failed to fetch predicted case number:", error);
      }
    };
    fetchPredictedCaseNumber();
  }, [formData.accidentDate, formData.insuranceAccidentNo]);

  useEffect(() => {
    if (!initialCaseId) return;
    setEditCaseId(initialCaseId);
    apiRequest("GET", `/api/cases/${initialCaseId}`)
      .then((res) => res.json())
      .then((caseData: any) => {
        console.log("🔍 [Intake Modal] Loaded case data:", {
          caseNumber: caseData.caseNumber,
          assessorId: caseData.assessorId,
          assessorDepartment: caseData.assessorDepartment,
          assessorTeam: caseData.assessorTeam,
          assessorContact: caseData.assessorContact,
          investigatorTeam: caseData.investigatorTeam,
          investigatorDepartment: caseData.investigatorDepartment,
          investigatorTeamName: caseData.investigatorTeamName,
          investigatorContact: caseData.investigatorContact,
        });
        if (caseData.caseNumber) setLoadedCaseNumber(caseData.caseNumber);
        const manager = administrators?.find(
          (a) => a.id === caseData.managerId,
        );
        setFormData({
          managerId: caseData.managerId || "",
          managerDepartment: manager?.department || "",
          managerPosition: manager?.position || "",
          managerContact: manager?.phone || "",
          accidentDate: caseData.accidentDate || getTodayDate(),
          insuranceCompany: caseData.insuranceCompany || "",
          insurancePolicyNo: caseData.insurancePolicyNo || "",
          insuranceAccidentNo: caseData.insuranceAccidentNo || "",
          clientResidence: caseData.clientResidence || "",
          clientDepartment: caseData.clientDepartment || "",
          clientName: caseData.clientName || "",
          clientContact: caseData.clientContact || "",
          assessorId: caseData.assessorId || "",
          assessorDepartment: caseData.assessorDepartment || "",
          assessorTeam: caseData.assessorTeam || "",
          assessorContact: caseData.assessorContact || "",
          assessorEmail: caseData.assessorEmail || "",
          investigatorTeam: caseData.investigatorTeam || "",
          investigatorDepartment: caseData.investigatorDepartment || "",
          investigatorTeamName: caseData.investigatorTeamName || "",
          investigatorContact: caseData.investigatorContact || "",
          investigatorEmail: caseData.investigatorEmail || "",
          policyHolderName: caseData.policyHolderName || "",
          policyHolderIdNumber: caseData.policyHolderIdNumber || "",
          policyHolderAddress: caseData.policyHolderAddress || "",
          insuredName: caseData.insuredName || "",
          insuredIdNumber: caseData.insuredIdNumber || "",
          insuredContact: caseData.insuredContact || "",
          insuredAddress: caseData.insuredAddress || "",
          insuredAddressDetail: caseData.insuredAddressDetail || "",
          victimName: caseData.victimName || "",
          victimContact: caseData.victimContact || "",
          victimAddress: caseData.victimAddress || "",
          victimAddressDetail: caseData.victimAddressDetail || "",
          accompaniedPerson: caseData.accompaniedPerson || "",
          accidentType: (caseData.accidentType || "").trim(),
          accidentCause: (caseData.accidentCause || "").trim(),
          restorationMethod: (caseData.restorationMethod || "").trim(),
          otherVendorEstimate: (caseData.otherVendorEstimate || "").trim(),
          accidentDescription: caseData.accidentDescription || "",
          damageItem: "",
          damageType: "",
          damageQuantity: "1",
          damageDetails: "",
          damageItems: caseData.damageItems
            ? JSON.parse(caseData.damageItems)
            : [],
          damagePreventionCost:
            caseData.damagePreventionCost === "true" ||
            (!caseData.damagePreventionCost &&
              caseData.caseNumber &&
              !caseData.caseNumber.includes("-")),
          victimIncidentAssistance:
            caseData.victimIncidentAssistance === "true" ||
            (!caseData.victimIncidentAssistance &&
              caseData.caseNumber &&
              caseData.caseNumber.includes("-")),
          assignedPartner: caseData.assignedPartner || "",
          assignedPartnerManager: caseData.assignedPartnerManager || "",
          assignedPartnerContact: caseData.assignedPartnerContact || "",
          urgency: caseData.urgency || "",
          specialRequests: caseData.specialRequests || "",
        });
        if (caseData.sameAsPolicyHolder === "true") setSameAsPolicyHolder(true);
        if (caseData.additionalVictims) {
          try {
            setAdditionalVictims(JSON.parse(caseData.additionalVictims));
          } catch (e) {}
        }
        if (caseData.assignedPartner) {
          setSelectedPartner({
            name: caseData.assignedPartner,
            dailyCount: 0,
            monthlyCount: 0,
            inProgressCount: 0,
            pendingCount: 0,
            region: "",
          });
          // 초기 협력사 정보 저장 (수정 시 변경 감지용)
          setInitialPartnerInfo({
            assignedPartner: caseData.assignedPartner || "",
            assignedPartnerContact: caseData.assignedPartnerContact || "",
          });
        }
        if (caseData.accidentDate) {
          const dateParts = caseData.accidentDate.split("-");
          if (dateParts.length === 3) {
            setAccidentDate(
              new Date(
                parseInt(dateParts[0]),
                parseInt(dateParts[1]) - 1,
                parseInt(dateParts[2]),
              ),
            );
          }
        }
      })
      .catch((error) => {
        toast({
          description: `케이스 정보를 불러오는 데 실패했습니다.`,
          variant: "destructive",
        });
      });
  }, [initialCaseId, administrators]);

  // 새로운 접수 화면에 들어갈 때 localStorage 클리어 및 폼 초기화 (크롬 브라우저 호환성)
  // 이 useEffect는 다른 localStorage 읽기 useEffect보다 먼저 실행되어야 함
  useEffect(() => {
    // 모달이 아니고 initialCaseId가 null인 경우 = 새로운 접수 화면
    if (!isModal && !initialCaseId) {
      // localStorage 먼저 클리어
      localStorage.removeItem("intakeFormDraft");
      localStorage.removeItem("editCaseId");
      setEditCaseId(null);
      
      // 폼 데이터도 초기화 (이전 접수 정보가 남아있지 않도록)
      setFormData({
        managerId: "",
        managerDepartment: "",
        managerPosition: "",
        managerContact: "",
        accidentDate: getTodayDate(),
        insuranceCompany: "",
        insurancePolicyNo: "",
        insuranceAccidentNo: "",
        clientResidence: "",
        clientDepartment: "",
        clientName: "",
        clientContact: "",
        assessorId: "",
        assessorDepartment: "",
        assessorTeam: "",
        assessorContact: "",
        assessorEmail: "",
        investigatorTeam: "",
        investigatorDepartment: "",
        investigatorTeamName: "",
        investigatorContact: "",
        investigatorEmail: "",
        policyHolderName: "",
        policyHolderIdNumber: "",
        policyHolderAddress: "",
        insuredName: "",
        insuredIdNumber: "",
        insuredContact: "",
        insuredAddress: "",
        insuredAddressDetail: "",
        victimName: "",
        victimContact: "",
        victimAddress: "",
        victimAddressDetail: "",
        accompaniedPerson: "",
        accidentType: "",
        accidentCause: "",
        restorationMethod: "",
        otherVendorEstimate: "",
        accidentDescription: "",
        damageItem: "",
        damageType: "",
        damageQuantity: "1",
        damageDetails: "",
        damageItems: [],
        damagePreventionCost: false,
        victimIncidentAssistance: false,
        assignedPartner: "",
        assignedPartnerManager: "",
        assignedPartnerContact: "",
        urgency: "",
        specialRequests: "",
      });
      setAccidentDate(new Date());
      setSelectedPartner(null);
      setSameAsPolicyHolder(false);
      setAdditionalVictims([]);
      setLoadedCaseNumber(null);
    }
  }, [isModal, initialCaseId]);

  useEffect(() => {
    if (initialCaseId) return;
    // 모달이 아닌 경우 (새로운 접수 화면) localStorage를 읽지 않음
    if (!isModal) return;
    const storedEditCaseId = localStorage.getItem("editCaseId");
    if (storedEditCaseId) {
      setEditCaseId(storedEditCaseId);
      apiRequest("GET", `/api/cases/${storedEditCaseId}`)
        .then((res) => res.json())
        .then((caseData: any) => {
          if (caseData.caseNumber) setLoadedCaseNumber(caseData.caseNumber);
          const manager = administrators?.find(
            (a) => a.id === caseData.managerId,
          );
          setFormData({
            managerId: caseData.managerId || "",
            managerDepartment: manager?.department || "",
            managerPosition: manager?.position || "",
            managerContact: manager?.phone || "",
            accidentDate: caseData.accidentDate || getTodayDate(),
            insuranceCompany: caseData.insuranceCompany || "",
            insurancePolicyNo: caseData.insurancePolicyNo || "",
            insuranceAccidentNo: caseData.insuranceAccidentNo || "",
            clientResidence: caseData.clientResidence || "",
            clientDepartment: caseData.clientDepartment || "",
            clientName: caseData.clientName || "",
            clientContact: caseData.clientContact || "",
            assessorId: caseData.assessorId || "",
            assessorDepartment: caseData.assessorDepartment || "",
            assessorTeam: caseData.assessorTeam || "",
            assessorContact: caseData.assessorContact || "",
            assessorEmail: caseData.assessorEmail || "",
            investigatorTeam: caseData.investigatorTeam || "",
            investigatorDepartment: caseData.investigatorDepartment || "",
            investigatorTeamName: caseData.investigatorTeamName || "",
            investigatorContact: caseData.investigatorContact || "",
            investigatorEmail: caseData.investigatorEmail || "",
            policyHolderName: caseData.policyHolderName || "",
            policyHolderIdNumber: caseData.policyHolderIdNumber || "",
            policyHolderAddress: caseData.policyHolderAddress || "",
            insuredName: caseData.insuredName || "",
            insuredIdNumber: caseData.insuredIdNumber || "",
            insuredContact: caseData.insuredContact || "",
            insuredAddress: caseData.insuredAddress || "",
            insuredAddressDetail: caseData.insuredAddressDetail || "",
            victimName: caseData.victimName || "",
            victimContact: caseData.victimContact || "",
            victimAddress: caseData.victimAddress || "",
            victimAddressDetail: caseData.victimAddressDetail || "",
            accompaniedPerson: caseData.accompaniedPerson || "",
            accidentType: (caseData.accidentType || "").trim(),
            accidentCause: (caseData.accidentCause || "").trim(),
            restorationMethod: (caseData.restorationMethod || "").trim(),
            otherVendorEstimate: (caseData.otherVendorEstimate || "").trim(),
            accidentDescription: caseData.accidentDescription || "",
            damageItem: "",
            damageType: "",
            damageQuantity: "1",
            damageDetails: "",
            damageItems: caseData.damageItems
              ? JSON.parse(caseData.damageItems)
              : [],
            damagePreventionCost:
              caseData.damagePreventionCost === "true" ||
              (!caseData.damagePreventionCost &&
                caseData.caseNumber &&
                !caseData.caseNumber.includes("-")),
            victimIncidentAssistance:
              caseData.victimIncidentAssistance === "true" ||
              (!caseData.victimIncidentAssistance &&
                caseData.caseNumber &&
                caseData.caseNumber.includes("-")),
            assignedPartner: caseData.assignedPartner || "",
            assignedPartnerManager: caseData.assignedPartnerManager || "",
            assignedPartnerContact: caseData.assignedPartnerContact || "",
            urgency: caseData.urgency || "",
            specialRequests: caseData.specialRequests || "",
          });
          if (caseData.sameAsPolicyHolder === "true")
            setSameAsPolicyHolder(true);
          if (caseData.additionalVictims) {
            try {
              setAdditionalVictims(JSON.parse(caseData.additionalVictims));
            } catch (e) {}
          }
          if (caseData.assignedPartner) {
            setSelectedPartner({
              name: caseData.assignedPartner,
              dailyCount: 0,
              monthlyCount: 0,
              inProgressCount: 0,
              pendingCount: 0,
              region: "",
            });
          }
          if (caseData.accidentDate) {
            const dateParts = caseData.accidentDate.split("-");
            if (dateParts.length === 3) {
              setAccidentDate(
                new Date(
                  parseInt(dateParts[0]),
                  parseInt(dateParts[1]) - 1,
                  parseInt(dateParts[2]),
                ),
              );
            }
          }
        })
        .catch(() => {
          toast({
            description: `케이스 정보를 불러오는 데 실패했습니다.`,
            variant: "destructive",
          });
        });
    }
  }, [initialCaseId, administrators]);

  const cleanFormData = (data: typeof formData) => {
    const cleaned: any = { ...data };
    cleaned.additionalVictims = JSON.stringify(additionalVictims);
    cleaned.damageItems = JSON.stringify(data.damageItems);
    cleaned.damagePreventionCost = String(data.damagePreventionCost);
    cleaned.victimIncidentAssistance = String(data.victimIncidentAssistance);
    return cleaned;
  };

  const saveMutation = useMutation({
    mutationFn: async ({
      data,
      sameAsPolicyHolderValue,
    }: {
      data: typeof formData;
      sameAsPolicyHolderValue: boolean;
    }) => {
      const cleanedData = cleanFormData(data);
      cleanedData.sameAsPolicyHolder = sameAsPolicyHolderValue
        ? "true"
        : "false";
      
      // 피해세대복구 체크 시 victimAddress가 비어있으면 insuredAddress 복사
      if (
        cleanedData.victimIncidentAssistance === true ||
        (cleanedData.victimIncidentAssistance as unknown) === "true"
      ) {
        if (!cleanedData.victimAddress && cleanedData.insuredAddress) {
          cleanedData.victimAddress = cleanedData.insuredAddress;
        }
      }
      
      const payload = {
        ...cleanedData,
        status: "배당대기",
        receptionDate: data.accidentDate || getTodayDate(),
        assignedTo: user?.id || null,
        ...(editCaseId ? { id: editCaseId } : {}),
      };
      const response = await apiRequest("POST", "/api/cases", payload);
      return response.json();
    },
    onSuccess: (result) => {
      const cases =
        result && typeof result === "object" && "cases" in result
          ? (result as any).cases
          : [];
      const count = cases.length;
      const caseNumbers = cases
        .map((c: any) => formatCaseNumber(c.caseNumber))
        .join(", ");
      toast({
        description:
          count > 1
            ? `저장되었습니다. (${count}건: ${caseNumbers})`
            : `저장되었습니다. (${caseNumbers})`,
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      localStorage.removeItem("intakeFormDraft");
      localStorage.removeItem("editCaseId");
      setEditCaseId(null);
      if (isModal && onSuccess) {
        onSuccess();
      } else {
        setTimeout(() => setLocation("/dashboard"), 1000);
      }
    },
    onError: (error: Error) => {
      toast({ description: error.message, variant: "destructive" });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async ({
      data,
      sameAsPolicyHolderValue,
    }: {
      data: typeof formData;
      sameAsPolicyHolderValue: boolean;
    }) => {
      const cleanedData = cleanFormData(data);
      cleanedData.sameAsPolicyHolder = sameAsPolicyHolderValue
        ? "true"
        : "false";
      
      // 피해세대복구 체크 시 victimAddress가 비어있으면 insuredAddress 복사
      if (
        cleanedData.victimIncidentAssistance === true ||
        (cleanedData.victimIncidentAssistance as unknown) === "true"
      ) {
        if (!cleanedData.victimAddress && cleanedData.insuredAddress) {
          cleanedData.victimAddress = cleanedData.insuredAddress;
        }
      }
      
      const payload = {
        ...cleanedData,
        status: "접수완료",
        receptionDate: data.accidentDate || getTodayDate(),
        assignedTo: user?.id || null,
        ...(editCaseId ? { id: editCaseId } : {}),
      };
      const response = await apiRequest("POST", "/api/cases", payload);
      return response.json();
    },
    onSuccess: async (result, variables) => {
      const cases =
        result && typeof result === "object" && "cases" in result
          ? (result as any).cases
          : [];
      const count = cases.length;
      const caseNumbers = cases
        .map((c: any) => formatCaseNumber(c.caseNumber))
        .join(", ");
      toast({
        description:
          count > 1
            ? `접수가 완료되었습니다. (${count}건 생성: ${caseNumbers})`
            : `접수가 완료되었습니다. (${caseNumbers})`,
        duration: 3000,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      localStorage.removeItem("intakeFormDraft");
      localStorage.removeItem("editCaseId");
      setEditCaseId(null);

      const submittedData = variables.data;
      if (cases.length > 0) {
        const firstCase = cases[0];
        const validCaseNumbers = cases
          .map((c: any) => c.caseNumber)
          .filter(
            (num: string) =>
              num &&
              num !== "-" &&
              !num.startsWith("DRAFT-") &&
              num.trim() !== "",
          );
        if (validCaseNumbers.length > 0) {
          const sortedCaseNumbers = validCaseNumbers.sort(
            (a: string, b: string) => {
              const suffixA = parseInt(a.split("-")[1] || "0");
              const suffixB = parseInt(b.split("-")[1] || "0");
              return suffixA - suffixB;
            },
          );
          const caseNumber = sortedCaseNumbers
            .map((n: string) => formatCaseNumber(n))
            .join(", ");
          const rawPartnerContact =
            submittedData.assignedPartnerContact?.trim() || "";
          const partnerContact = rawPartnerContact.replace(/[^0-9]/g, "");
          if (partnerContact.length >= 10 && partnerContact.length <= 11) {
            const requestScopeItems = [];
            if (
              submittedData.damagePreventionCost === true ||
              (submittedData.damagePreventionCost as unknown) === "true"
            )
              requestScopeItems.push("손방");
            if (
              submittedData.victimIncidentAssistance === true ||
              (submittedData.victimIncidentAssistance as unknown) === "true"
            )
              requestScopeItems.push("대물");
            if (requestScopeItems.length === 0) requestScopeItems.push("기타");
            const requestScope = requestScopeItems.join(", ");
            const managerName = submittedData.managerId
              ? allUsers?.find((u) => u.id === submittedData.managerId)?.name ||
                user?.name ||
                "-"
              : user?.name || "-";
            const smsPayload = {
              to: partnerContact,
              caseNumber: caseNumber,
              insuranceCompany:
                firstCase.insuranceCompany ||
                submittedData.insuranceCompany ||
                "-",
              managerName: managerName,
              insurancePolicyNo:
                firstCase.insurancePolicyNo ||
                submittedData.insurancePolicyNo ||
                "-",
              insuranceAccidentNo:
                firstCase.insuranceAccidentNo ||
                submittedData.insuranceAccidentNo ||
                "-",
              insuredName:
                firstCase.insuredName || submittedData.insuredName || "-",
              insuredContact:
                firstCase.insuredContact || submittedData.insuredContact || "-",
              victimName:
                firstCase.victimName || submittedData.victimName || "-",
              victimContact:
                firstCase.victimContact || submittedData.victimContact || "-",
              assessorTeam:
                firstCase.assessorTeam ||
                submittedData.assessorTeam ||
                "-",
              assessorContact:
                firstCase.assessorContact ||
                submittedData.assessorContact ||
                "-",
              investigatorTeamName:
                firstCase.investigatorTeamName ||
                submittedData.investigatorTeamName ||
                "-",
              investigatorContact:
                firstCase.investigatorContact ||
                submittedData.investigatorContact ||
                "-",
              accidentLocation:
                firstCase.insuredAddress || submittedData.insuredAddress || "-",
              accidentLocationDetail:
                firstCase.insuredAddressDetail ||
                submittedData.insuredAddressDetail ||
                "",
              victimAddressDetail:
                submittedData.victimAddressDetail || "",
              requestScope: requestScope,
            };
            try {
              await apiRequest("POST", "/api/send-sms", smsPayload);
              toast({
                description: "접수 완료 문자가 전송되었습니다.",
                duration: 3000,
              });
            } catch (error) {
              toast({
                description: "문자 전송에 실패했습니다. 수동으로 전송해주세요.",
                variant: "destructive",
                duration: 3000,
              });
            }
          }
        }
      }

      if (isModal && onSuccess) {
        onSuccess();
      } else {
        setTimeout(() => setLocation("/dashboard"), 1000);
      }
    },
    onError: (error: Error) => {
      toast({ description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!initialCaseId) throw new Error("케이스 ID가 필요합니다");
      const cleanedData = cleanFormData(data);
      cleanedData.sameAsPolicyHolder = sameAsPolicyHolder ? "true" : "false";
      
      // 협력사 변경 여부를 명시적으로 전달
      const isPartnerChanged = initialPartnerInfo && 
        data.assignedPartner && 
        data.assignedPartner !== initialPartnerInfo.assignedPartner;
      if (isPartnerChanged) {
        cleanedData.partnerChanged = true;
        console.log(`[intake] Partner changed from "${initialPartnerInfo?.assignedPartner}" to "${data.assignedPartner}"`);
      }
      
      return await apiRequest(
        "PATCH",
        `/api/cases/${initialCaseId}`,
        cleanedData,
      );
    },
    onSuccess: async () => {
      toast({ description: "수정이 완료되었습니다.", duration: 3000 });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      
      // 협력사가 변경되었는지 확인하고 새 협력사에게 SMS 발송
      const isPartnerChanged = initialPartnerInfo && 
        formData.assignedPartner && 
        formData.assignedPartner !== initialPartnerInfo.assignedPartner;
      
      if (isPartnerChanged) {
        const rawPartnerContact = formData.assignedPartnerContact?.trim() || "";
        const partnerContact = rawPartnerContact.replace(/[^0-9]/g, "");
        
        if (partnerContact.length >= 10 && partnerContact.length <= 11) {
          // 의뢰범위 생성
          const requestScopeItems = [];
          if (formData.damagePreventionCost === true || (formData.damagePreventionCost as unknown) === "true")
            requestScopeItems.push("손방");
          if (formData.victimIncidentAssistance === true || (formData.victimIncidentAssistance as unknown) === "true")
            requestScopeItems.push("대물");
          if (requestScopeItems.length === 0) requestScopeItems.push("기타");
          const requestScope = requestScopeItems.join(", ");
          
          // 담당자 이름
          const managerName = formData.managerId
            ? allUsers?.find((u) => u.id === formData.managerId)?.name || user?.name || "-"
            : user?.name || "-";
          
          // 접수번호 (loadedCaseNumber 사용)
          const caseNumber = loadedCaseNumber ? formatCaseNumber(loadedCaseNumber) : "-";
          
          const smsPayload = {
            to: partnerContact,
            caseNumber: caseNumber,
            insuranceCompany: formData.insuranceCompany || "-",
            managerName: managerName,
            insurancePolicyNo: formData.insurancePolicyNo || "-",
            insuranceAccidentNo: formData.insuranceAccidentNo || "-",
            insuredName: formData.insuredName || "-",
            insuredContact: formData.insuredContact || "-",
            victimName: formData.victimName || "-",
            victimContact: formData.victimContact || "-",
            assessorTeam: formData.assessorTeam || "-",
            assessorContact: formData.assessorContact || "-",
            investigatorTeamName: formData.investigatorTeamName || "-",
            investigatorContact: formData.investigatorContact || "-",
            accidentLocation: formData.insuredAddress || "-",
            accidentLocationDetail: formData.insuredAddressDetail || "",
            victimAddressDetail: formData.victimAddressDetail || "",
            requestScope: requestScope,
          };
          
          try {
            await apiRequest("POST", "/api/send-sms", smsPayload);
            toast({
              description: "변경된 협력사에 접수 완료 문자가 전송되었습니다.",
              duration: 3000,
            });
          } catch (error) {
            toast({
              description: "협력사 문자 전송에 실패했습니다.",
              variant: "destructive",
              duration: 3000,
            });
          }
        }
        
        // 초기 협력사 정보 업데이트
        setInitialPartnerInfo({
          assignedPartner: formData.assignedPartner,
          assignedPartnerContact: formData.assignedPartnerContact || "",
        });
      }
      
      if (isModal && onSuccess) onSuccess();
    },
    onError: (error: Error) => {
      toast({ description: error.message, variant: "destructive" });
    },
  });

  const handleUpdateCase = () => updateMutation.mutate(formData);

  const handleInputChange = (
    field: keyof typeof formData,
    value: string | boolean,
  ) => {
    setFormData((prev) => {
      const updated = { ...prev, [field]: value };

      if (field === "clientResidence" && value && allUsers) {
        const companyUser = allUsers.find((u) => u.company === value);
        updated.clientDepartment = companyUser?.department || "";
        updated.clientName = "";
        updated.clientContact = "";
      }

      if (field === "clientName" && value && typeof value === "string") {
        const selectedEmployee = filteredClientEmployees.find(
          (emp) => emp.name === value,
        );
        if (selectedEmployee) {
          updated.clientContact = selectedEmployee.phone || "";
        }
      }

      if (field === "assessorId") {
        updated.assessorDepartment = "";
        updated.assessorTeam = "";
        updated.assessorContact = "";
        updated.assessorEmail = "";
      }

      if (field === "assessorDepartment") {
        updated.assessorTeam = "";
        updated.assessorContact = "";
        updated.assessorEmail = "";
      }

      if (field === "assessorTeam" && value) {
        const selectedAssessor = filteredAssessorEmployees.find(
          (assessor) => assessor.name === value,
        );
        if (selectedAssessor) {
          updated.assessorContact = selectedAssessor.phone || "";
          updated.assessorEmail = selectedAssessor.email || "";
        }
      }

      if (field === "investigatorTeam") {
        updated.investigatorDepartment = "";
        updated.investigatorTeamName = "";
        updated.investigatorContact = "";
        updated.investigatorEmail = "";
      }

      if (field === "investigatorDepartment") {
        updated.investigatorTeamName = "";
        updated.investigatorContact = "";
        updated.investigatorEmail = "";
      }

      if (field === "investigatorTeamName" && value) {
        const selectedInvestigator = filteredInvestigatorEmployees.find(
          (inv) => inv.name === value,
        );
        if (selectedInvestigator) {
          updated.investigatorContact = selectedInvestigator.phone || "";
          updated.investigatorEmail = selectedInvestigator.email || "";
        }
      }

      if (field === "assignedPartnerManager" && value) {
        const selectedManager = partnerManagers.find(
          (manager) => manager.name === value,
        );
        if (selectedManager)
          updated.assignedPartnerContact = selectedManager.phone || "";
      }

      return updated;
    });
  };

  const handleSave = () =>
    saveMutation.mutate({
      data: formData,
      sameAsPolicyHolderValue: sameAsPolicyHolder,
    });

  const handleReset = () => {
    setFormData({
      managerId: "",
      managerDepartment: "",
      managerPosition: "",
      managerContact: "",
      accidentDate: getTodayDate(),
      insuranceCompany: "",
      insurancePolicyNo: "",
      insuranceAccidentNo: "",
      clientResidence: "",
      clientDepartment: "",
      clientName: "",
      clientContact: "",
      assessorId: "",
      assessorDepartment: "",
      assessorTeam: "",
      assessorContact: "",
      assessorEmail: "",
      investigatorTeam: "",
      investigatorDepartment: "",
      investigatorTeamName: "",
      investigatorContact: "",
      investigatorEmail: "",
      policyHolderName: "",
      policyHolderIdNumber: "",
      policyHolderAddress: "",
      insuredName: "",
      insuredIdNumber: "",
      insuredContact: "",
      insuredAddress: "",
      insuredAddressDetail: "",
      victimName: "",
      victimContact: "",
      victimAddress: "",
      victimAddressDetail: "",
      accompaniedPerson: "",
      accidentType: "",
      accidentCause: "",
      restorationMethod: "",
      otherVendorEstimate: "",
      accidentDescription: "",
      damageItem: "",
      damageType: "",
      damageQuantity: "",
      damageDetails: "",
      damageItems: [],
      damagePreventionCost: false,
      victimIncidentAssistance: false,
      assignedPartner: "",
      assignedPartnerManager: "",
      assignedPartnerContact: "",
      urgency: "",
      specialRequests: "",
    });
    setAccidentDate(new Date());
    setSelectedPartner(null);
    setSameAsPolicyHolder(false);
    setAdditionalVictims([]);
    localStorage.removeItem("intakeFormDraft");
    localStorage.removeItem("editCaseId");
    setEditCaseId(null);
    toast({ description: "입력 내용이 초기화되었습니다.", duration: 2000 });
  };

  const isFormValid = useMemo(() => {
    const missingFields: string[] = [];
    if (!formData.accidentDate) missingFields.push("accidentDate (접수일자)");
    if (!formData.managerId) missingFields.push("managerId (담당자명)");
    if (!formData.insuranceCompany)
      missingFields.push("insuranceCompany (보험사명)");
    if (!formData.clientResidence)
      missingFields.push("clientResidence (의뢰사)");
    if (!formData.clientName) missingFields.push("clientName (의뢰자)");
    if (!formData.insuredName)
      missingFields.push("insuredName (피보험자 성명)");
    if (!formData.insuredContact)
      missingFields.push("insuredContact (피보험자 연락처)");
    if (!formData.insuredAddress)
      missingFields.push("insuredAddress (사고장소)");
    if (!formData.accidentType) missingFields.push("accidentType (사고유형)");
    if (!formData.restorationMethod)
      missingFields.push("restorationMethod (복구/대체)");
    if (!formData.assignedPartner)
      missingFields.push("assignedPartner (협력사)");
    if (!formData.assignedPartnerManager)
      missingFields.push("assignedPartnerManager (협력사 담당자)");

    return true;
  }, [formData]);

  const handleSubmit = () => {
    if (!formData.accidentDate) {
      toast({
        description: "접수일자를 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.managerId) {
      toast({
        description: "담당자를 선택해주세요.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.insuranceCompany) {
      toast({
        description: "보험사명을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.insurancePolicyNo && !formData.insuranceAccidentNo) {
      toast({
        description: "증권번호 또는 사고번호 중 하나는 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.clientResidence) {
      toast({ description: "의뢰사를 선택해주세요.", variant: "destructive" });
      return;
    }
    if (!formData.clientName) {
      toast({ description: "의뢰자를 선택해주세요.", variant: "destructive" });
      return;
    }
    if (!formData.insuredName) {
      toast({
        description: "피보험자 성명을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.insuredContact) {
      toast({
        description: "피보험자 연락처를 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.insuredAddress) {
      toast({
        description: "피보험자 주소를 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.accidentType) {
      toast({
        description: "사고 유형을 선택해주세요.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.restorationMethod) {
      toast({
        description: "복구 유형을 선택해주세요.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.assignedPartner) {
      toast({ description: "협력사를 선택해주세요.", variant: "destructive" });
      return;
    }
    if (!formData.assignedPartnerManager) {
      toast({
        description: "협력사 담당자를 선택해주세요.",
        variant: "destructive",
      });
      return;
    }
    submitMutation.mutate({
      data: formData,
      sameAsPolicyHolderValue: sameAsPolicyHolder,
    });
  };

  const [addressSearchQuery, setAddressSearchQuery] = useState("");
  const [detailAddressSearchQuery, setDetailAddressSearchQuery] = useState("");

  const handleAddressSearch = (type: "main" | "detail") => {
    if (typeof window !== "undefined" && (window as any).daum?.Postcode) {
      const query =
        type === "main" ? addressSearchQuery : detailAddressSearchQuery;
      setAddressDropdownOpen(type);
      setTimeout(() => {
        const container =
          type === "main"
            ? addressContainerRef.current
            : detailAddressContainerRef.current;
        if (container) {
          container.innerHTML = "";
          new (window as any).daum.Postcode({
            oncomplete: function (data: any) {
              handleInputChange("insuredAddress", data.address);
              setAddressSearchQuery("");
              setDetailAddressSearchQuery("");
              setAddressDropdownOpen(null);
            },
            onclose: function () {
              setAddressDropdownOpen(null);
            },
            width: "100%",
            height: "100%",
          }).embed(container, { q: query });
        }
      }, 100);
    } else {
      toast({
        description:
          "주소 검색 서비스를 불러오는 중입니다. 잠시 후 다시 시도해주세요.",
        variant: "destructive",
      });
    }
  };

  // 피보험자 주소 드롭다운이 열리면 Daum Postcode 초기화
  useEffect(() => {
    if (insuredAddressDropdownOpen) {
      setTimeout(() => {
        if (typeof window !== "undefined" && (window as any).daum?.Postcode) {
          const container = insuredAddressContainerRef.current;
          if (container) {
            container.innerHTML = "";
            new (window as any).daum.Postcode({
              oncomplete: function (data: any) {
                handleInputChange("insuredAddress", data.address);
                setInsuredAddressDropdownOpen(false);
              },
              width: "100%",
              height: "100%",
            }).embed(container);
          }
        }
      }, 100);
    }
  }, [insuredAddressDropdownOpen]);

  const openInsuredAddressDropdown = () => {
    if (typeof window !== "undefined" && (window as any).daum?.Postcode) {
      setInsuredAddressDropdownOpen(true);
    } else {
      toast({
        description:
          "주소 검색 서비스를 불러오는 중입니다. 잠시 후 다시 시도해주세요.",
        variant: "destructive",
      });
    }
  };

  if (userLoading || !user) return null;

  return (
    <div
      className={`relative ${isModal ? "bg-white" : "bg-white min-h-screen"}`}
    >
      {!isModal && <GlobalHeader />}
      <main
        className={`mx-auto max-w-[1400px] ${isModal ? "px-4 pb-24 pt-4" : "px-6 pb-24 pt-6"}`}
      >
        {/* Title */}
        <div className="mb-4 flex items-center gap-2">
          {isModal && onClose && (
            <button
              onClick={onClose}
              className="mr-2 p-2 hover:bg-slate-100 rounded-lg transition-colors"
              data-testid="button-close-intake-modal"
            >
              <X size={24} className="text-slate-600" />
            </button>
          )}
          <h1 className="text-xl font-semibold text-slate-900">새로운 접수</h1>
          <button
            onClick={handleToggleFavorite}
            className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50"
            type="button"
            data-testid="button-favorite"
          >
            <Star
              className="w-4 h-4"
              style={{
                color: isFavorite ? "#FFD700" : "currentColor",
                fill: isFavorite ? "#FFD700" : "none",
              }}
            />
          </button>
        </div>

        {/* Form */}
        <form className="space-y-10" onSubmit={(e) => e.preventDefault()}>
          {/* 기본 정보 */}
          <section>
            <div className="mb-4 border-b-2 border-sky-500">
              <h2 className="pb-2 text-sm font-semibold text-sky-600">
                기본 정보
              </h2>
            </div>

            <div className="grid grid-cols-12 gap-x-4 gap-y-3">
              <div className="col-span-6 md:col-span-2">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>접수번호</label>
                  <input
                    className={disabledInputClasses}
                    value={displayCaseNumber}
                    readOnly
                    placeholder="접수번호"
                    type="text"
                    data-testid="input-case-number"
                  />
                </div>
              </div>

              <div className="col-span-6 md:col-span-2">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>접수일자</label>
                  <Popover
                    open={datePickerOpen}
                    onOpenChange={setDatePickerOpen}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={readOnly}
                        className={`${inputClasses} flex items-center justify-between ${readOnly ? "cursor-default" : "cursor-pointer"}`}
                        data-testid="button-date-picker"
                      >
                        <span>
                          {accidentDate
                            ? format(accidentDate, "yyyy-MM-dd", { locale: ko })
                            : "날짜 선택"}
                        </span>
                        <CalendarIcon
                          size={18}
                          className="text-slate-400 opacity-80"
                        />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={accidentDate}
                        onSelect={(date) => {
                          setAccidentDate(date);
                          if (date)
                            handleInputChange(
                              "accidentDate",
                              format(date, "yyyy-MM-dd"),
                            );
                          setDatePickerOpen(false);
                        }}
                        locale={ko}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="col-span-6 md:col-span-2">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>담당자명</label>
                  <Select
                    value={formData.managerId}
                    onValueChange={(value) => {
                      handleInputChange("managerId", value);
                      const mgr = administrators?.find((a) => a.id === value);
                      if (mgr)
                        handleInputChange("managerContact", mgr.phone || "");
                    }}
                  >
                    <SelectTrigger
                      className={selectTriggerClasses}
                      data-testid="select-manager"
                    >
                      <SelectValue placeholder="담당자명" />
                    </SelectTrigger>
                    <SelectContent>
                      {administrators?.map((admin) => (
                        <SelectItem key={admin.id} value={admin.id}>
                          {admin.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="col-span-6 md:col-span-2">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>담당자 연락처</label>
                  <input
                    className={disabledInputClasses}
                    value={formData.managerContact}
                    placeholder="연락처"
                    type="text"
                    data-testid="input-manager-contact"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 보험 정보 */}
          <section>
            <div className="mb-4 border-b-2 border-sky-500 flex items-center justify-between">
              <h2 className="pb-2 text-sm font-semibold text-sky-600">
                보험 정보
              </h2>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => {
                    handleInputChange("insuranceCompany", "");
                    handleInputChange("insurancePolicyNo", "");
                    handleInputChange("insuranceAccidentNo", "");
                    handleInputChange("clientResidence", "");
                    handleInputChange("clientDepartment", "");
                    handleInputChange("clientName", "");
                    handleInputChange("clientContact", "");
                    handleInputChange("assessorId", "");
                    handleInputChange("assessorDepartment", "");
                    handleInputChange("assessorTeam", "");
                    handleInputChange("assessorContact", "");
                    handleInputChange("investigatorTeam", "");
                    handleInputChange("investigatorDepartment", "");
                    handleInputChange("investigatorTeamName", "");
                    handleInputChange("investigatorContact", "");
                    handleInputChange("policyHolderName", "");
                    handleInputChange("insuredName", "");
                    handleInputChange("insuredContact", "");
                    handleInputChange("insuredAddress", "");
                    handleInputChange("insuredAddressDetail", "");
                    handleInputChange("victimName", "");
                    handleInputChange("victimContact", "");
                    handleInputChange("victimAddress", "");
                    handleInputChange("victimAddressDetail", "");
                  }}
                  className="pb-2 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  data-testid="button-reset-insurance"
                >
                  <RotateCcw className="w-3 h-3" />
                  초기화
                </button>
              )}
            </div>

            <div className="grid grid-cols-12 gap-x-4 gap-y-3">
              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>
                    보험사
                    <RequiredMark />
                  </label>
                  <Select
                    value={formData.insuranceCompany}
                    onValueChange={(value) =>
                      handleInputChange("insuranceCompany", value)
                    }
                    disabled={readOnly}
                  >
                    <SelectTrigger
                      className={`${selectTriggerClasses} bg-white`}
                      data-testid="select-insurance-company"
                    >
                      <SelectValue placeholder="보험사 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {insuranceCompanies.map((company) => (
                        <SelectItem key={company} value={company}>
                          {company}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="col-span-12 md:col-span-4">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>
                    증권번호
                    <RequiredMark />
                  </label>
                  <input
                    className={`${inputClasses} bg-white`}
                    value={formData.insurancePolicyNo}
                    onChange={(e) =>
                      handleInputChange("insurancePolicyNo", e.target.value)
                    }
                    disabled={readOnly}
                    placeholder="보험사 증권번호"
                    type="text"
                    data-testid="input-policy-no"
                  />
                </div>
              </div>

              <div className="col-span-12 md:col-span-1 flex items-end justify-center pb-2">
                <span className="text-sm text-slate-500 font-medium">또는</span>
              </div>

              <div className="col-span-12 md:col-span-4">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>
                    사고번호
                    <RequiredMark />
                  </label>
                  <input
                    className={`${inputClasses} bg-white`}
                    value={formData.insuranceAccidentNo}
                    onChange={(e) =>
                      handleInputChange("insuranceAccidentNo", e.target.value)
                    }
                    disabled={readOnly}
                    placeholder="보험사 사고번호"
                    type="text"
                    data-testid="input-accident-no"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 의뢰자/심사자/조사자 정보 */}
          <section>
            <div className="mb-4">
              <h2 className="pb-2 text-sm font-semibold font-bold">
                의뢰자/심사자/조사자 정보
              </h2>
            </div>

            <div className="grid grid-cols-12 gap-x-4 gap-y-3">
              {/* 의뢰사 Row */}
              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>
                    의뢰사
                    <RequiredMark />
                  </label>
                  <input
                    className={disabledInputClasses}
                    value={formData.clientResidence}
                    readOnly
                    placeholder="의뢰자 검색 시 자동입력"
                    type="text"
                    data-testid="input-client-residence"
                  />
                </div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>소속부서명</label>
                  <input
                    className={disabledInputClasses}
                    value={formData.clientDepartment}
                    readOnly
                    placeholder="소속부서명"
                    type="text"
                    data-testid="input-client-department"
                  />
                </div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>
                    의뢰자
                    <RequiredMark />
                  </label>
                  <div
                    className={`${selectTriggerClasses} bg-white flex items-center justify-between cursor-pointer ${readOnly ? "opacity-50 pointer-events-none" : ""}`}
                    onClick={() => {
                      if (!readOnly) {
                        setClientSearchQuery("");
                        setTempSelectedClient(null);
                        setIsClientSearchOpen(true);
                      }
                    }}
                    data-testid="button-open-client-search"
                  >
                    <span className={formData.clientName ? "text-slate-900" : "text-slate-400"}>
                      {formData.clientName || "의뢰자 검색"}
                    </span>
                    <Search className="w-4 h-4 text-slate-400" />
                  </div>
                </div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>의뢰자 연락처</label>
                  <input
                    className={disabledInputClasses}
                    value={formData.clientContact}
                    readOnly
                    placeholder="의뢰사 담당자 연락처"
                    type="text"
                    data-testid="input-client-contact"
                  />
                </div>
              </div>

              {/* 심사사 Row */}
              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>심사사</label>
                  <input
                    className={disabledInputClasses}
                    value={formData.assessorId}
                    readOnly
                    placeholder="심사자 검색 시 자동입력"
                    type="text"
                    data-testid="input-assessor-id"
                  />
                </div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>소속부서명</label>
                  <input
                    className={disabledInputClasses}
                    value={formData.assessorDepartment}
                    readOnly
                    placeholder="심사자 검색 시 자동입력"
                    type="text"
                    data-testid="input-assessor-department"
                  />
                </div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>심사자</label>
                  <div
                    className={`${selectTriggerClasses} bg-white flex items-center justify-between cursor-pointer ${readOnly ? "opacity-50 pointer-events-none" : ""}`}
                    onClick={() => {
                      if (!readOnly) {
                        setAssessorSearchQuery("");
                        setTempSelectedAssessor(null);
                        setIsAssessorSearchOpen(true);
                      }
                    }}
                    data-testid="button-open-assessor-search"
                  >
                    <span className={formData.assessorTeam ? "text-slate-900" : "text-slate-400"}>
                      {formData.assessorTeam || "심사자 검색"}
                    </span>
                    <Search className="w-4 h-4 text-slate-400" />
                  </div>
                </div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>심사자 연락처</label>
                  <input
                    className={disabledInputClasses}
                    value={formData.assessorContact}
                    readOnly
                    placeholder="심사자 연락처"
                    type="text"
                    data-testid="input-assessor-contact"
                  />
                </div>
              </div>

              {/* 손사/조사사 Row */}
              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>조사사</label>
                  <input
                    className={disabledInputClasses}
                    value={formData.investigatorTeam}
                    readOnly
                    placeholder="조사자 검색 시 자동입력"
                    type="text"
                    data-testid="input-investigator-team"
                  />
                </div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>소속부서명</label>
                  <input
                    className={disabledInputClasses}
                    value={formData.investigatorDepartment}
                    readOnly
                    placeholder="조사자 검색 시 자동입력"
                    type="text"
                    data-testid="input-investigator-department"
                  />
                </div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>조사자</label>
                  <div
                    className={`${selectTriggerClasses} bg-white flex items-center justify-between cursor-pointer ${readOnly ? "opacity-50 pointer-events-none" : ""}`}
                    onClick={() => {
                      if (!readOnly) {
                        setInvestigatorSearchQuery("");
                        setTempSelectedInvestigator(null);
                        setIsInvestigatorSearchOpen(true);
                      }
                    }}
                    data-testid="button-open-investigator-search"
                  >
                    <span className={formData.investigatorTeamName ? "text-slate-900" : "text-slate-400"}>
                      {formData.investigatorTeamName || "조사자 검색"}
                    </span>
                    <Search className="w-4 h-4 text-slate-400" />
                  </div>
                </div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>조사자 연락처</label>
                  <input
                    className={disabledInputClasses}
                    value={formData.investigatorContact}
                    readOnly
                    placeholder="조사자 연락처"
                    type="text"
                    data-testid="input-investigator-contact"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 보험계약자 및 피보험자 정보 */}
          <section>
            <div className="mb-4">
              <h2 className="pb-2 text-sm font-bold">
                보험계약자 및 피보험자 정보
              </h2>
            </div>

            <div className="grid grid-cols-12 gap-x-4 gap-y-3">
              <div className="col-span-12 md:col-span-4">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>보험계약자</label>
                  <input
                    className={`${inputClasses} bg-white`}
                    value={formData.policyHolderName}
                    onChange={(e) =>
                      handleInputChange("policyHolderName", e.target.value)
                    }
                    disabled={readOnly}
                    placeholder="보험자 성함"
                    type="text"
                    data-testid="input-policy-holder-name"
                  />
                </div>
              </div>

              <div className="col-span-12 md:col-span-4">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>
                    피보험자
                    <RequiredMark />
                  </label>
                  <input
                    className={`${inputClasses} bg-white`}
                    value={formData.insuredName}
                    onChange={(e) =>
                      handleInputChange("insuredName", e.target.value)
                    }
                    disabled={readOnly}
                    placeholder="피보험자 성함"
                    type="text"
                    data-testid="input-insured-name"
                  />
                </div>
              </div>

              <div className="col-span-12 md:col-span-4">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>
                    피보험자 연락처
                    <RequiredMark />
                  </label>
                  <input
                    className={`${inputClasses} bg-white`}
                    value={formData.insuredContact}
                    onChange={(e) =>
                      handleInputChange("insuredContact", e.target.value)
                    }
                    disabled={readOnly}
                    placeholder="피보험자 연락처"
                    type="text"
                    data-testid="input-insured-contact"
                  />
                </div>
              </div>

              <div className="col-span-12 md:col-span-6">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>
                    피보험자 주소
                    <RequiredMark />
                  </label>
                  <div
                    className="relative flex-1"
                    ref={insuredAddressWrapperRef}
                  >
                    <input
                      className={`${inputClasses} ${!readOnly ? "cursor-pointer" : ""} 
                      bg-white
                      !border
                      !border-slate-300
                      `}
                      value={formData.insuredAddress}
                      onClick={() => !readOnly && openInsuredAddressDropdown()}
                      readOnly
                      disabled={readOnly}
                      placeholder="클릭하여 주소 검색"
                      type="text"
                      data-testid="input-insured-address"
                    />
                    {insuredAddressDropdownOpen && (
                      <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                        <div
                          ref={insuredAddressContainerRef}
                          style={{ height: "400px", width: "100%" }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="col-span-12 md:col-span-6">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>상세주소</label>
                  <input
                    className={`${inputClasses} bg-white`}
                    value={formData.insuredAddressDetail}
                    onChange={(e) =>
                      handleInputChange("insuredAddressDetail", e.target.value)
                    }
                    disabled={readOnly}
                    placeholder="상세주소"
                    type="text"
                    data-testid="input-insured-address-detail"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 피해자 정보 */}
          <section>
            <div className="mb-4">
              <h2 className="pb-2 text-sm font-bold">피해자 정보</h2>
            </div>

            <div className="grid grid-cols-12 gap-x-4 gap-y-3">
              <div className="col-span-12 md:col-span-4">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>피해자</label>
                  <input
                    className={`${inputClasses} bg-white`}
                    value={formData.victimName}
                    onChange={(e) =>
                      handleInputChange("victimName", e.target.value)
                    }
                    disabled={readOnly}
                    placeholder="피해자 성함"
                    type="text"
                    data-testid="input-victim-name"
                  />
                </div>
              </div>

              <div className="col-span-12 md:col-span-4">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>피해자 연락처</label>
                  <input
                    className={`${inputClasses} bg-white`}
                    value={formData.victimContact}
                    onChange={(e) =>
                      handleInputChange("victimContact", e.target.value)
                    }
                    disabled={readOnly}
                    placeholder="피해자 연락처"
                    type="text"
                    data-testid="input-victim-contact"
                  />
                </div>
              </div>

              <div className="col-span-12 md:col-span-4">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>상세주소</label>
                  <input
                    className={`${inputClasses} bg-white`}
                    value={formData.victimAddressDetail}
                    onChange={(e) =>
                      handleInputChange("victimAddressDetail", e.target.value)
                    }
                    disabled={readOnly}
                    placeholder="상세주소"
                    type="text"
                    data-testid="input-victim-address-detail"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 배당사항 */}
          <section>
            <div className="mb-4 border-b-2 border-sky-500 flex items-center justify-between">
              <h2 className="pb-2 text-sm font-semibold text-sky-600">
                배당사항
              </h2>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => {
                    handleInputChange("damagePreventionCost", false);
                    handleInputChange("victimIncidentAssistance", false);
                    handleInputChange("accidentType", "");
                    handleInputChange("restorationMethod", "");
                    handleInputChange("accidentCause", "");
                    handleInputChange("otherVendorEstimate", "");
                  }}
                  className="pb-2 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  data-testid="button-reset-dividend"
                >
                  <RotateCcw className="w-3 h-3" />
                  초기화
                </button>
              )}
            </div>
            <p className="mb-4 text-xs text-slate-500">
              손방 및 대물 선택(중복 가능)
            </p>

            <div className="mb-5 flex flex-wrap items-center gap-6">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-200"
                  type="checkbox"
                  checked={formData.damagePreventionCost === true}
                  onChange={(e) =>
                    handleInputChange("damagePreventionCost", e.target.checked)
                  }
                  disabled={readOnly}
                  data-testid="checkbox-damage-prevention"
                />
                손해방지
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-200"
                  type="checkbox"
                  checked={formData.victimIncidentAssistance === true}
                  onChange={(e) =>
                    handleInputChange(
                      "victimIncidentAssistance",
                      e.target.checked,
                    )
                  }
                  disabled={readOnly}
                  data-testid="checkbox-victim-incident"
                />
                피해세대복구
              </label>
            </div>

            <div className="grid grid-cols-12 gap-x-4 gap-y-3">
              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>
                    사고 유형
                    <RequiredMark />
                  </label>
                  <Select
                    value={formData.accidentType}
                    onValueChange={(value) =>
                      handleInputChange("accidentType", value)
                    }
                    disabled={readOnly}
                  >
                    <SelectTrigger
                      className={`${selectTriggerClasses} bg-white`}
                      data-testid="select-accident-type"
                    >
                      <SelectValue placeholder="사고 유형 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {getMasterDataOptions("accident_type").length > 0 ? (
                        getMasterDataOptions("accident_type").map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="누수">누수</SelectItem>
                          <SelectItem value="급배수">급배수</SelectItem>
                          <SelectItem value="화재">화재</SelectItem>
                          <SelectItem value="기타">기타</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>
                    복구 유형
                    <RequiredMark />
                  </label>
                  <Select
                    value={formData.restorationMethod}
                    onValueChange={(value) =>
                      handleInputChange("restorationMethod", value)
                    }
                    disabled={readOnly}
                  >
                    <SelectTrigger
                      className={selectTriggerClasses}
                      data-testid="select-restoration-method"
                    >
                      <SelectValue placeholder="복구 유형 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {getMasterDataOptions("recovery_type").length > 0 ? (
                        getMasterDataOptions("recovery_type").map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="없음">없음</SelectItem>
                          <SelectItem value="직접복구">직접복구</SelectItem>
                          <SelectItem value="선견적요청">선견적요청</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>사고 원인</label>
                  <Select
                    value={formData.accidentCause}
                    onValueChange={(value) =>
                      handleInputChange("accidentCause", value)
                    }
                    disabled={readOnly}
                  >
                    <SelectTrigger
                      className={selectTriggerClasses}
                      data-testid="select-accident-cause"
                    >
                      <SelectValue placeholder="사고 원인 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {getMasterDataOptions("accident_cause").length > 0 ? (
                        getMasterDataOptions("accident_cause").map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="배관">배관</SelectItem>
                          <SelectItem value="방수">방수</SelectItem>
                          <SelectItem value="코킹">코킹</SelectItem>
                          <SelectItem value="공용부">공용부</SelectItem>
                          <SelectItem value="복합">복합</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>타업체 견적 여부</label>
                  <Select
                    value={formData.otherVendorEstimate}
                    onValueChange={(value) =>
                      handleInputChange("otherVendorEstimate", value)
                    }
                    disabled={readOnly}
                  >
                    <SelectTrigger
                      className={selectTriggerClasses}
                      data-testid="select-other-vendor"
                    >
                      <SelectValue placeholder="타업체 견적 여부 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {getMasterDataOptions("other_company_estimate").length >
                      0 ? (
                        getMasterDataOptions("other_company_estimate").map(
                          (opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ),
                        )
                      ) : (
                        <>
                          <SelectItem value="유">유</SelectItem>
                          <SelectItem value="무">무</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </section>

          {/* 배당 협력사 정보 */}
          <section>
            <div className="mb-4 border-b-2 border-sky-500 flex items-center justify-between">
              <h2 className="pb-2 text-sm font-semibold text-sky-600">
                배당 협력사 정보
              </h2>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => {
                    handleInputChange("assignedPartner", "");
                    handleInputChange("assignedPartnerManager", "");
                    handleInputChange("assignedPartnerContact", "");
                    handleInputChange("specialRequests", "");
                  }}
                  className="pb-2 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  data-testid="button-reset-partner"
                >
                  <RotateCcw className="w-3 h-3" />
                  초기화
                </button>
              )}
            </div>

            <div className="grid grid-cols-12 gap-x-4 gap-y-3">
              <div className="col-span-12 md:col-span-6">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>협력사</label>
                  <input
                    className={`${inputClasses} ${!readOnly ? "cursor-pointer" : ""}`}
                    value={formData.assignedPartner}
                    onClick={() => !readOnly && setIsPartnerSearchOpen(true)}
                    readOnly
                    disabled={readOnly}
                    placeholder="클릭하여 협력사 선택"
                    type="text"
                    data-testid="input-partner"
                  />
                </div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>담당자</label>
                  <Select
                    key={`partner-manager-${initialCaseId || editCaseId || 'new'}-${loadedCaseNumber}-${selectedPartner?.name || ''}`}
                    value={formData.assignedPartnerManager}
                    onValueChange={(value) =>
                      handleInputChange("assignedPartnerManager", value)
                    }
                    disabled={readOnly || !selectedPartner}
                  >
                    <SelectTrigger
                      className={selectTriggerClasses}
                      data-testid="select-partner-manager"
                    >
                      <SelectValue placeholder="담당자" />
                    </SelectTrigger>
                    <SelectContent>
                      {partnerManagers.map((mgr) => (
                        <SelectItem key={mgr.id} value={mgr.name}>
                          {mgr.name}
                        </SelectItem>
                      ))}
                      {/* Fallback for saved value not in current list */}
                      {formData.assignedPartnerManager && 
                        !partnerManagers.some(m => m.name === formData.assignedPartnerManager) && (
                        <SelectItem value={formData.assignedPartnerManager}>
                          {formData.assignedPartnerManager}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="col-span-12 md:col-span-3">
                <div className={fieldRowClasses}>
                  <label className={labelClasses}>담당자 연락처</label>
                  <input
                    className={disabledInputClasses}
                    value={formData.assignedPartnerContact}
                    readOnly
                    placeholder="담당자 연락처"
                    type="text"
                    data-testid="input-partner-contact"
                  />
                </div>
              </div>

              <div className="col-span-12">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-slate-500">
                    특이사항 및 요청사항
                  </label>
                  <div className="relative">
                    <textarea
                      className="min-h-[100px] w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                      placeholder="현장 특이사항, 요청사항 등"
                      value={formData.specialRequests}
                      onChange={(e) => {
                        if (e.target.value.length <= 800)
                          handleInputChange("specialRequests", e.target.value);
                      }}
                      disabled={readOnly}
                      maxLength={800}
                      data-testid="textarea-special-requests"
                    />
                    <div className="absolute bottom-2 right-3 text-xs text-slate-400">
                      {formData.specialRequests.length}/800
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Spacer for fixed bar */}
          <div className="h-20"></div>
        </form>

        {/* Bottom Actions - Fixed */}
        {!readOnly && (
          <div className="fixed inset-x-0 bottom-0 border-t bg-white/95 backdrop-blur z-50">
            <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4">
              {isModal && initialCaseId ? (
                <>
                  <div></div>
                  <button
                    onClick={handleUpdateCase}
                    disabled={updateMutation.isPending}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-sky-500 px-5 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
                    type="button"
                    data-testid="button-update-case"
                  >
                    {updateMutation.isPending ? "수정 중..." : "수정하기"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleReset}
                    className="text-sm font-semibold text-rose-600 hover:text-rose-700"
                    type="button"
                    data-testid="button-reset"
                  >
                    초기화
                  </button>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleSave}
                      disabled={saveMutation.isPending}
                      className="inline-flex h-10 items-center justify-center rounded-md bg-slate-100 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                      type="button"
                      data-testid="button-save"
                    >
                      {saveMutation.isPending ? "저장 중..." : "저장"}
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={submitMutation.isPending || !isFormValid}
                      className="inline-flex h-10 items-center justify-center rounded-md bg-slate-300 px-5 text-sm font-semibold text-white disabled:bg-slate-300 enabled:bg-sky-500 enabled:hover:bg-sky-600"
                      type="button"
                      data-testid="button-submit"
                    >
                      {submitMutation.isPending ? "접수 중..." : "접수완료"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>
      {/* 협력사 검색 팝업 */}
      {isPartnerSearchOpen &&
        (() => {
          const modalContent = (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 999999,
                padding: "16px",
                pointerEvents: "auto" as const,
              }}
              onClick={() => setIsPartnerSearchOpen(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-[864px] max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-xl"
              >
                <div className="flex flex-row justify-between items-center w-full px-5 h-[60px] border-b">
                  <h2 className="font-semibold text-lg text-slate-900">
                    협력사 검색
                  </h2>
                  <button
                    onClick={() => setIsPartnerSearchOpen(false)}
                    className="p-2 hover:bg-slate-100 rounded-lg"
                    data-testid="button-close-partner-search"
                  >
                    <X size={24} className="text-slate-600" />
                  </button>
                </div>
                <div className="flex flex-col items-center w-full px-5 py-4 gap-4">
                  <div className="flex flex-col items-start w-full gap-2">
                    <label className={labelClasses}>협력사 검색</label>
                    <div className="flex flex-row items-center w-full">
                      <input
                        type="text"
                        placeholder="업체명을 입력해주세요."
                        value={partnerSearchQuery}
                        onChange={(e) => setPartnerSearchQuery(e.target.value)}
                        className={`${inputClasses} flex-1 !rounded-r-none`}
                        data-testid="input-partner-search"
                      />
                      <button
                        className="flex items-center justify-center px-4 h-10 bg-sky-500 rounded-r-md text-white font-semibold text-sm hover:bg-sky-600"
                        data-testid="button-partner-search"
                      >
                        검색
                      </button>
                    </div>
                  </div>
                  <div
                    className="flex flex-col items-start w-full gap-4 overflow-x-auto"
                    style={{ maxHeight: "400px" }}
                  >
                    {filteredPartners.length === 0 ? (
                      <div className="flex items-center justify-center w-full py-10">
                        <span className="text-sm text-slate-500">
                          {partnerSearchQuery
                            ? "검색 결과가 없습니다"
                            : "등록된 협력사가 없습니다"}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-start w-full min-w-[700px]">
                        <div className="flex flex-row items-center w-full h-10 bg-slate-100 text-xs font-medium text-slate-600">
                          <div className="px-3 w-[155px]">업체명</div>
                          <div className="px-3 w-[93px]">일배당건수</div>
                          <div className="px-3 w-[93px]">월배당건수</div>
                          <div className="px-3 w-[93px]">진행건수</div>
                          <div className="px-3 w-[93px]">미결건수</div>
                          <div className="px-3 flex-1">지역</div>
                          <div className="px-3 w-[49px]">선택</div>
                        </div>
                        <div
                          className="flex flex-col items-start w-full overflow-y-auto"
                          style={{ maxHeight: "300px" }}
                        >
                          {filteredPartners.map((partner) => (
                            <div
                              key={partner.name}
                              className={`flex flex-row items-stretch w-full min-h-20 cursor-pointer border-b border-slate-100 ${tempSelectedPartner?.name === partner.name ? "bg-sky-50" : "hover:bg-slate-50"}`}
                              onClick={() => setTempSelectedPartner(partner)}
                              data-testid={`row-partner-${partner.name}`}
                            >
                              <div
                                className={`px-3 py-3 w-[155px] text-sm flex items-center ${tempSelectedPartner?.name === partner.name ? "text-sky-600 font-medium" : "text-slate-600"}`}
                              >
                                {partner.name}
                              </div>
                              <div className="px-3 py-3 w-[93px] text-sm text-slate-600 flex items-center">
                                {partner.dailyCount}
                              </div>
                              <div className="px-3 py-3 w-[93px] text-sm text-slate-600 flex items-center">
                                {partner.monthlyCount}
                              </div>
                              <div className="px-3 py-3 w-[93px] text-sm text-slate-600 flex items-center">
                                {partner.inProgressCount}
                              </div>
                              <div className="px-3 py-3 w-[93px] text-sm text-slate-600 flex items-center">
                                {partner.pendingCount}
                              </div>
                              <div
                                className="px-3 py-3 flex-1 min-w-0 text-sm text-slate-600 items-start overflow-y-auto"
                                style={{ wordBreak: "break-word", maxHeight: "80px" }}
                              >
                                {partner.region}
                              </div>
                              <div className="px-3 py-3 w-[49px] flex justify-center items-center">
                                <div
                                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${tempSelectedPartner?.name === partner.name ? "bg-sky-500 border-sky-500" : "border-slate-300"}`}
                                >
                                  {tempSelectedPartner?.name ===
                                    partner.name && (
                                    <div className="w-2 h-2 bg-white rounded-full" />
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {tempSelectedPartner && (
                    <div className="w-full flex flex-col gap-3">
                      <div className="p-4 bg-slate-100 rounded-lg flex items-center gap-4">
                        <div className="w-2 h-2 bg-sky-500 rounded-full" />
                        <span className="font-semibold text-slate-900">
                          {tempSelectedPartner.name}
                        </span>
                      </div>
                      <div className="flex justify-center gap-3">
                        <button
                          onClick={() => setTempSelectedPartner(null)}
                          className="px-4 py-2 text-sm text-slate-400 hover:text-slate-600"
                          data-testid="button-reset-partner"
                        >
                          초기화
                        </button>
                        <button
                          onClick={() => {
                            setSelectedPartner(tempSelectedPartner);
                            handleInputChange(
                              "assignedPartner",
                              tempSelectedPartner.name,
                            );
                            handleInputChange("assignedPartnerManager", "");
                            handleInputChange("assignedPartnerContact", "");
                            setIsPartnerSearchOpen(false);
                            setTempSelectedPartner(null);
                            setPartnerSearchQuery("");
                          }}
                          className="px-4 py-2 bg-sky-500 text-white text-sm font-semibold rounded-md hover:bg-sky-600"
                          data-testid="button-apply-partner"
                        >
                          적용
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
          return createPortal(modalContent, document.body);
        })()}
      {/* 의뢰사 검색 팝업 */}
      {isClientSearchOpen &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 999999,
              padding: "16px",
              pointerEvents: "auto",
            }}
            onClick={() => setIsClientSearchOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[700px] bg-white rounded-xl shadow-xl max-h-[90vh] flex flex-col"
            >
              <div className="flex flex-row justify-between items-center w-full px-5 h-[60px] border-b">
                <h2 className="font-semibold text-lg text-slate-900">
                  의뢰자 검색
                </h2>
                <button
                  onClick={() => setIsClientSearchOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-lg"
                  data-testid="button-close-client-search"
                >
                  <X size={24} className="text-slate-600" />
                </button>
              </div>
              <div className="flex flex-col items-center w-full px-5 py-4 gap-4">
                <div className="flex flex-col items-start w-full gap-2">
                  <label className={labelClasses}>이름/회사/부서 검색</label>
                  <div className="flex flex-row items-center w-full">
                    <input
                      type="text"
                      placeholder="이름, 회사명 또는 부서명을 입력해주세요."
                      value={clientSearchQuery}
                      onChange={(e) => setClientSearchQuery(e.target.value)}
                      className={`${inputClasses} flex-1 !rounded-r-none`}
                      data-testid="input-client-search"
                    />
                    <button
                      className="flex items-center justify-center px-4 h-10 bg-sky-500 rounded-r-md text-white font-semibold text-sm hover:bg-sky-600"
                      data-testid="button-client-search-submit"
                    >
                      검색
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-start w-full px-5 flex-1">
                {filteredClientUsers.length === 0 ? (
                  <div className="flex items-center justify-center w-full py-10">
                    <span className="text-sm text-slate-500">
                      {clientSearchQuery
                        ? "검색 결과가 없습니다"
                        : "등록된 의뢰자가 없습니다"}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-start w-full">
                    <div className="flex flex-row items-center w-full h-10 bg-slate-100 text-xs font-medium text-slate-600 sticky top-0">
                      <div className="px-3 w-[120px]">이름</div>
                      <div className="px-3 flex-1">회사</div>
                      <div className="px-3 w-[120px]">부서</div>
                      <div className="px-3 w-[60px]">선택</div>
                    </div>
                    <div
                      className="flex flex-col items-start w-full overflow-y-auto"
                      style={{ maxHeight: "300px" }}
                    >
                      {filteredClientUsers.map((user) => (
                        <div
                          key={user.id}
                          className={`flex flex-row items-center w-full h-12 cursor-pointer border-b border-slate-100 ${tempSelectedClient?.id === user.id ? "bg-sky-50" : "hover:bg-slate-50"}`}
                          onClick={() => setTempSelectedClient(user)}
                          data-testid={`row-client-user-${user.id}`}
                        >
                          <div className={`px-3 w-[120px] text-sm ${tempSelectedClient?.id === user.id ? "text-sky-600 font-medium" : "text-slate-900"}`}>
                            {user.name}
                          </div>
                          <div className={`px-3 flex-1 text-sm ${tempSelectedClient?.id === user.id ? "text-sky-600" : "text-slate-600"}`}>
                            {user.company || "-"}
                          </div>
                          <div className={`px-3 w-[120px] text-sm ${tempSelectedClient?.id === user.id ? "text-sky-600" : "text-slate-600"}`}>
                            {user.department || "-"}
                          </div>
                          <div className="px-3 w-[60px] flex justify-center">
                            <div
                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${tempSelectedClient?.id === user.id ? "bg-sky-500 border-sky-500" : "border-slate-300"}`}
                            >
                              {tempSelectedClient?.id === user.id && (
                                <div className="w-2 h-2 bg-white rounded-full" />
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {tempSelectedClient && (
                <div className="w-full px-5 pb-5 flex flex-col gap-3">
                  <div className="p-4 bg-slate-100 rounded-lg flex items-center gap-4">
                    <div className="w-2 h-2 bg-sky-500 rounded-full" />
                    <span className="font-semibold text-slate-900">
                      {tempSelectedClient.name}
                    </span>
                    <span className="text-sm text-slate-500">
                      {tempSelectedClient.company || ""} {tempSelectedClient.department ? `/ ${tempSelectedClient.department}` : ""}
                    </span>
                  </div>
                  <div className="flex justify-center gap-3">
                    <button
                      onClick={() => setTempSelectedClient(null)}
                      className="px-4 py-2 text-sm text-slate-400 hover:text-slate-600"
                      data-testid="button-reset-client"
                    >
                      초기화
                    </button>
                    <button
                      onClick={() => {
                        setFormData((prev) => ({
                          ...prev,
                          clientName: tempSelectedClient.name || "",
                          clientResidence: tempSelectedClient.company || "",
                          clientDepartment: tempSelectedClient.department || "",
                          clientContact: tempSelectedClient.phone || "",
                        }));
                        setIsClientSearchOpen(false);
                        setTempSelectedClient(null);
                        setClientSearchQuery("");
                      }}
                      className="px-4 py-2 bg-sky-500 text-white text-sm font-semibold rounded-md hover:bg-sky-600"
                      data-testid="button-apply-client"
                    >
                      적용
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
      {/* 심사자 검색 팝업 */}
      {isAssessorSearchOpen &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 999999,
              padding: "16px",
              pointerEvents: "auto",
            }}
            onClick={() => setIsAssessorSearchOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[700px] bg-white rounded-xl shadow-xl max-h-[90vh] flex flex-col"
            >
              <div className="flex flex-row justify-between items-center w-full px-5 h-[60px] border-b">
                <h2 className="font-semibold text-lg text-slate-900">
                  심사자 검색
                </h2>
                <button
                  onClick={() => setIsAssessorSearchOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-lg"
                  data-testid="button-close-assessor-search"
                >
                  <X size={24} className="text-slate-600" />
                </button>
              </div>
              <div className="flex flex-col items-center w-full px-5 py-4 gap-4">
                <div className="flex flex-col items-start w-full gap-2">
                  <label className={labelClasses}>이름/회사/부서 검색</label>
                  <div className="flex flex-row items-center w-full">
                    <input
                      type="text"
                      placeholder="이름, 회사명 또는 부서명을 입력해주세요."
                      value={assessorSearchQuery}
                      onChange={(e) => setAssessorSearchQuery(e.target.value)}
                      className={`${inputClasses} flex-1 !rounded-r-none`}
                      data-testid="input-assessor-search"
                    />
                    <button
                      className="flex items-center justify-center px-4 h-10 bg-sky-500 rounded-r-md text-white font-semibold text-sm hover:bg-sky-600"
                      data-testid="button-assessor-search-submit"
                    >
                      검색
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-start w-full px-5 flex-1">
                {filteredAssessorUsers.length === 0 ? (
                  <div className="flex items-center justify-center w-full py-10">
                    <span className="text-sm text-slate-500">
                      {assessorSearchQuery
                        ? "검색 결과가 없습니다"
                        : "등록된 심사자가 없습니다"}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-start w-full">
                    <div className="flex flex-row items-center w-full h-10 bg-slate-100 text-xs font-medium text-slate-600 sticky top-0">
                      <div className="px-3 w-[120px]">이름</div>
                      <div className="px-3 flex-1">회사</div>
                      <div className="px-3 w-[120px]">부서</div>
                      <div className="px-3 w-[60px]">선택</div>
                    </div>
                    <div
                      className="flex flex-col items-start w-full overflow-y-auto"
                      style={{ maxHeight: "300px" }}
                    >
                      {filteredAssessorUsers.map((user) => (
                        <div
                          key={user.id}
                          className={`flex flex-row items-center w-full h-12 cursor-pointer border-b border-slate-100 ${tempSelectedAssessor?.id === user.id ? "bg-sky-50" : "hover:bg-slate-50"}`}
                          onClick={() => setTempSelectedAssessor(user)}
                          data-testid={`row-assessor-user-${user.id}`}
                        >
                          <div className={`px-3 w-[120px] text-sm ${tempSelectedAssessor?.id === user.id ? "text-sky-600 font-medium" : "text-slate-900"}`}>
                            {user.name}
                          </div>
                          <div className={`px-3 flex-1 text-sm ${tempSelectedAssessor?.id === user.id ? "text-sky-600" : "text-slate-600"}`}>
                            {user.company || "-"}
                          </div>
                          <div className={`px-3 w-[120px] text-sm ${tempSelectedAssessor?.id === user.id ? "text-sky-600" : "text-slate-600"}`}>
                            {user.department || "-"}
                          </div>
                          <div className="px-3 w-[60px] flex justify-center">
                            <div
                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${tempSelectedAssessor?.id === user.id ? "bg-sky-500 border-sky-500" : "border-slate-300"}`}
                            >
                              {tempSelectedAssessor?.id === user.id && (
                                <div className="w-2 h-2 bg-white rounded-full" />
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {tempSelectedAssessor && (
                <div className="w-full px-5 pb-5 flex flex-col gap-3">
                  <div className="p-4 bg-slate-100 rounded-lg flex items-center gap-4">
                    <div className="w-2 h-2 bg-sky-500 rounded-full" />
                    <span className="font-semibold text-slate-900">
                      {tempSelectedAssessor.name}
                    </span>
                    <span className="text-sm text-slate-500">
                      {tempSelectedAssessor.company || ""} {tempSelectedAssessor.department ? `/ ${tempSelectedAssessor.department}` : ""}
                    </span>
                  </div>
                  <div className="flex justify-center gap-3">
                    <button
                      onClick={() => setTempSelectedAssessor(null)}
                      className="px-4 py-2 text-sm text-slate-400 hover:text-slate-600"
                      data-testid="button-reset-assessor"
                    >
                      초기화
                    </button>
                    <button
                      onClick={() => {
                        setFormData((prev) => ({
                          ...prev,
                          assessorTeam: tempSelectedAssessor.name || "",
                          assessorId: tempSelectedAssessor.company || "",
                          assessorDepartment: tempSelectedAssessor.department || "",
                          assessorContact: tempSelectedAssessor.phone || "",
                          assessorEmail: tempSelectedAssessor.email || "",
                        }));
                        setIsAssessorSearchOpen(false);
                        setTempSelectedAssessor(null);
                        setAssessorSearchQuery("");
                      }}
                      className="px-4 py-2 bg-sky-500 text-white text-sm font-semibold rounded-md hover:bg-sky-600"
                      data-testid="button-apply-assessor"
                    >
                      적용
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
      {/* 조사자 검색 팝업 */}
      {isInvestigatorSearchOpen &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 999999,
              padding: "16px",
              pointerEvents: "auto",
            }}
            onClick={() => setIsInvestigatorSearchOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[700px] bg-white rounded-xl shadow-xl max-h-[90vh] flex flex-col"
            >
              <div className="flex flex-row justify-between items-center w-full px-5 h-[60px] border-b">
                <h2 className="font-semibold text-lg text-slate-900">
                  조사자 검색
                </h2>
                <button
                  onClick={() => setIsInvestigatorSearchOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-lg"
                  data-testid="button-close-investigator-search"
                >
                  <X size={24} className="text-slate-600" />
                </button>
              </div>
              <div className="flex flex-col items-center w-full px-5 py-4 gap-4">
                <div className="flex flex-col items-start w-full gap-2">
                  <label className={labelClasses}>이름/회사/부서 검색</label>
                  <div className="flex flex-row items-center w-full">
                    <input
                      type="text"
                      placeholder="이름, 회사명 또는 부서명을 입력해주세요."
                      value={investigatorSearchQuery}
                      onChange={(e) =>
                        setInvestigatorSearchQuery(e.target.value)
                      }
                      className={`${inputClasses} flex-1 !rounded-r-none`}
                      data-testid="input-investigator-search"
                    />
                    <button
                      className="flex items-center justify-center px-4 h-10 bg-sky-500 rounded-r-md text-white font-semibold text-sm hover:bg-sky-600"
                      data-testid="button-investigator-search-submit"
                    >
                      검색
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-start w-full px-5 flex-1">
                {filteredInvestigatorUsers.length === 0 ? (
                  <div className="flex items-center justify-center w-full py-10">
                    <span className="text-sm text-slate-500">
                      {investigatorSearchQuery
                        ? "검색 결과가 없습니다"
                        : "등록된 조사자가 없습니다"}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-start w-full">
                    <div className="flex flex-row items-center w-full h-10 bg-slate-100 text-xs font-medium text-slate-600 sticky top-0">
                      <div className="px-3 w-[120px]">이름</div>
                      <div className="px-3 flex-1">회사</div>
                      <div className="px-3 w-[120px]">부서</div>
                      <div className="px-3 w-[60px]">선택</div>
                    </div>
                    <div
                      className="flex flex-col items-start w-full overflow-y-auto"
                      style={{ maxHeight: "300px" }}
                    >
                      {filteredInvestigatorUsers.map((user) => (
                        <div
                          key={user.id}
                          className={`flex flex-row items-center w-full h-12 cursor-pointer border-b border-slate-100 ${tempSelectedInvestigator?.id === user.id ? "bg-sky-50" : "hover:bg-slate-50"}`}
                          onClick={() => setTempSelectedInvestigator(user)}
                          data-testid={`row-investigator-user-${user.id}`}
                        >
                          <div className={`px-3 w-[120px] text-sm ${tempSelectedInvestigator?.id === user.id ? "text-sky-600 font-medium" : "text-slate-900"}`}>
                            {user.name}
                          </div>
                          <div className={`px-3 flex-1 text-sm ${tempSelectedInvestigator?.id === user.id ? "text-sky-600" : "text-slate-600"}`}>
                            {user.company || "-"}
                          </div>
                          <div className={`px-3 w-[120px] text-sm ${tempSelectedInvestigator?.id === user.id ? "text-sky-600" : "text-slate-600"}`}>
                            {user.department || "-"}
                          </div>
                          <div className="px-3 w-[60px] flex justify-center">
                            <div
                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${tempSelectedInvestigator?.id === user.id ? "bg-sky-500 border-sky-500" : "border-slate-300"}`}
                            >
                              {tempSelectedInvestigator?.id === user.id && (
                                <div className="w-2 h-2 bg-white rounded-full" />
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {tempSelectedInvestigator && (
                <div className="w-full px-5 pb-5 flex flex-col gap-3">
                  <div className="p-4 bg-slate-100 rounded-lg flex items-center gap-4">
                    <div className="w-2 h-2 bg-sky-500 rounded-full" />
                    <span className="font-semibold text-slate-900">
                      {tempSelectedInvestigator.name}
                    </span>
                    <span className="text-sm text-slate-500">
                      {tempSelectedInvestigator.company || ""} {tempSelectedInvestigator.department ? `/ ${tempSelectedInvestigator.department}` : ""}
                    </span>
                  </div>
                  <div className="flex justify-center gap-3">
                    <button
                      onClick={() => setTempSelectedInvestigator(null)}
                      className="px-4 py-2 text-sm text-slate-400 hover:text-slate-600"
                      data-testid="button-reset-investigator"
                    >
                      초기화
                    </button>
                    <button
                      onClick={() => {
                        setFormData((prev) => ({
                          ...prev,
                          investigatorTeamName: tempSelectedInvestigator.name || "",
                          investigatorTeam: tempSelectedInvestigator.company || "",
                          investigatorDepartment: tempSelectedInvestigator.department || "",
                          investigatorContact: tempSelectedInvestigator.phone || "",
                          investigatorEmail: tempSelectedInvestigator.email || "",
                        }));
                        setIsInvestigatorSearchOpen(false);
                        setTempSelectedInvestigator(null);
                        setInvestigatorSearchQuery("");
                      }}
                      className="px-4 py-2 bg-sky-500 text-white text-sm font-semibold rounded-md hover:bg-sky-600"
                      data-testid="button-apply-investigator"
                    >
                      적용
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
