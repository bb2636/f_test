import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  User,
  CaseWithLatestProgress,
} from "@shared/schema";
import { Search, Cloud, Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCaseNumber } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";

const safeParseNotesHistory = (
  json: string | null | undefined,
): Array<{ content: string; createdAt: string; createdByName?: string }> => {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getStatusColor = (status: string | null | undefined) => {
  if (status === "1차승인") return "#008FED";
  if (status === "복구요청(2차승인)") return "#00C853";
  if (status === "접수취소" || status === "반려") return "#ED1C00";
  if (
    status === "입금완료" ||
    status === "부분지급" ||
    status === "지급완료" ||
    status === "정산완료" ||
    status === "종결"
  )
    return "#4CAF50";
  return "rgba(12, 12, 12, 0.7)";
};

const getStatusDisplayText = (status: string | null | undefined): string => {
  if (!status) return "배당대기";
  return status;
};

const formatAmount = (amount: string | number | null | undefined): string => {
  if (!amount) return "-";
  const numAmount = typeof amount === "string" ? parseInt(amount) : amount;
  if (isNaN(numAmount)) return "-";
  return `₩${numAmount.toLocaleString()}`;
};

const formatDate = (dateString: string | null | undefined) => {
  if (!dateString) return "-";
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const calculateDays = (createdAt: string | null) => {
  if (!createdAt) return 0;
  const created = new Date(createdAt);
  const today = new Date();
  const diffTime = Math.abs(today.getTime() - created.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

type BasicUser = {
  id: string;
  name: string | null;
  username: string;
  contact: string | null;
  role: string;
  bankName: string | null;
  accountNumber: string | null;
  company: string | null;
};

export default function CancelledCases() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [insuranceCompany, setInsuranceCompany] = useState("전체");
  const [assessor, setAssessor] = useState("전체");
  const [manager, setManager] = useState("전체");
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState("기본정보");
  const [newNoteContent, setNewNoteContent] = useState("");
  const { toast } = useToast();

  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/user"],
  });
  const { hasCategory: hasPermCategory, hasItem: hasPermItem } = usePermissions();
  const hasFieldSurveyAccess = hasPermCategory("현장조사");
  const canEditStatus = hasFieldSurveyAccess && hasPermItem("정산 및 통계", "진행상태 수정");
  const canViewDetail = hasFieldSurveyAccess && hasPermItem("정산 및 통계", "자세히 보기");

  const { data: cases = [], isLoading } = useQuery<CaseWithLatestProgress[]>({
    queryKey: ["/api/cases"],
  });

  const { data: allUsers = [] } = useQuery<BasicUser[]>({
    queryKey: ["/api/users/basic"],
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ caseId, status }: { caseId: string; status: string }) => {
      return await apiRequest("PATCH", `/api/cases/${caseId}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ title: "상태 변경 완료", description: "진행상태가 성공적으로 변경되었습니다." });
    },
    onError: () => {
      toast({ title: "상태 변경 실패", description: "상태 변경 중 오류가 발생했습니다.", variant: "destructive" });
    },
  });

  const addNotesHistoryMutation = useMutation({
    mutationFn: async ({ caseId, content }: { caseId: string; content: string }) => {
      return await apiRequest("POST", `/api/cases/${caseId}/notes-history`, { content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setNewNoteContent("");
      toast({ variant: "snackbar", title: "메모가 저장되었습니다" });
    },
    onError: () => {
      toast({ title: "저장 실패", description: "메모 저장 중 오류가 발생했습니다.", variant: "destructive" });
    },
  });

  const ackNotesMutation = useMutation({
    mutationFn: async (caseId: string) => {
      return await apiRequest("POST", `/api/cases/${caseId}/notes-ack`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ variant: "snackbar", title: "특이사항이 확인되었습니다" });
    },
    onError: () => {
      toast({ title: "확인 실패", description: "특이사항 확인 중 오류가 발생했습니다.", variant: "destructive" });
    },
  });

  const cancelledCases = useMemo(() => {
    return cases.filter((c) => c.status === "접수취소");
  }, [cases]);

  const insuranceCompanyOptions = useMemo(() => {
    const companies = new Set<string>();
    cancelledCases.forEach((c) => {
      if (c.insuranceCompany) companies.add(c.insuranceCompany);
    });
    return Array.from(companies).sort();
  }, [cancelledCases]);

  const assessorOptions = useMemo(() => {
    const names = new Set<string>();
    allUsers.forEach((u) => {
      if (u.role === "심사사" && u.name) {
        names.add(u.name);
      }
    });
    return Array.from(names).sort();
  }, [allUsers]);

  const managerOptions = useMemo(() => {
    return allUsers
      .filter((u) => u.role === "관리자" && u.name)
      .map((u) => u.name!)
      .sort();
  }, [allUsers]);

  const assessorNameToIdMap = useMemo(() => {
    const map = new Map<string, string[]>();
    allUsers.forEach((u) => {
      if (u.role === "심사사" && u.name && u.company) {
        const existing = map.get(u.name) || [];
        existing.push(u.company);
        map.set(u.name, existing);
      }
    });
    return map;
  }, [allUsers]);

  const filteredData = useMemo(() => {
    let filtered = cancelledCases;

    if (insuranceCompany !== "전체") {
      filtered = filtered.filter((c) => c.insuranceCompany === insuranceCompany);
    }

    if (assessor !== "전체") {
      const companies = assessorNameToIdMap.get(assessor) || [];
      filtered = filtered.filter((c) => companies.includes(c.assessorId || ""));
    }

    if (manager !== "전체") {
      filtered = filtered.filter((c) => c.managerName === manager);
    }

    if (startDate && endDate) {
      filtered = filtered.filter((c) => {
        if (!c.cancellationDate) return false;
        const cancelDate = new Date(c.cancellationDate);
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return cancelDate >= start && cancelDate <= end;
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((c) => {
        return (
          (c.insuranceCompany || "").toLowerCase().includes(query) ||
          (c.insuranceAccidentNo || "").toLowerCase().includes(query) ||
          (c.caseNumber || "").toLowerCase().includes(query) ||
          (c.insuredName || "").toLowerCase().includes(query) ||
          (c.managerName || "").toLowerCase().includes(query) ||
          (c.insuredAddress || "").toLowerCase().includes(query) ||
          (c.insurancePolicyNo || "").toLowerCase().includes(query) ||
          (c.assignedPartner || "").toLowerCase().includes(query)
        );
      });
    }

    return [...filtered].sort((a, b) => {
      const extractNumericValue = (caseNumber: string | null) => {
        if (!caseNumber) return 0;
        const numericStr = caseNumber.replace(/-/g, "");
        return parseInt(numericStr, 10) || 0;
      };
      return extractNumericValue(b.caseNumber) - extractNumericValue(a.caseNumber);
    });
  }, [cancelledCases, insuranceCompany, assessor, manager, startDate, endDate, searchQuery]);

  const handleReset = () => {
    setSearchQuery("");
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

  if (userLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-full">
        <div className="text-lg">로딩 중...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const gridTemplateColumns = "110px 100px 110px 100px 70px 1fr 80px 90px 90px 60px 130px 100px 50px 160px";

  return (
    <div className="p-8 bg-white min-h-full">
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
          접수취소
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

      <div
        className="mb-6"
        style={{
          background: "rgba(255, 255, 255, 0.7)",
          borderRadius: "12px",
          padding: "16px 24px",
          border: "1px solid rgba(12, 12, 12, 0.08)",
        }}
      >
        <div className="flex items-end gap-3 flex-wrap">
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
                data-testid="select-insurance-company-cancelled"
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
              심사자
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
                data-testid="select-assessor-cancelled"
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
                data-testid="select-manager-cancelled"
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
                  data-testid="button-date-range-cancelled"
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
            data-testid="button-reset-cancelled"
          >
            초기화
          </Button>

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
            data-testid="button-search-with-filters-cancelled"
          >
            선택된 조건 검색하기
          </Button>

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
              data-testid="input-search-cancelled"
            />
          </div>

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
            data-testid="button-search-cancelled"
          >
            검색
          </Button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span
            style={{
              fontFamily: "Pretendard",
              fontWeight: 700,
              fontSize: "20px",
              lineHeight: "128%",
              letterSpacing: "-0.02em",
              color: "rgba(12, 12, 12, 0.7)",
            }}
          >
            전체건
          </span>
          <span
            style={{
              fontFamily: "Pretendard",
              fontWeight: 700,
              fontSize: "20px",
              lineHeight: "128%",
              letterSpacing: "-0.02em",
              color: "#008FED",
            }}
          >
            {filteredData.length}
          </span>
        </div>
      </div>

      <div
        style={{
          background: "#FFFFFF",
          boxShadow: "0px 0px 20px #DBE9F5",
          borderRadius: "12px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "calc(100vh - 320px)",
        }}
      >
        <div style={{ overflowX: "auto", overflowY: "auto", flex: 1 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns,
              padding: "0 20px",
              background: "#F5F5F6",
              borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
              position: "sticky",
              top: 0,
              zIndex: 10,
            }}
          >
            {[
              { label: "증권번호" },
              { label: "사고번호" },
              { label: "접수번호" },
              { label: "보험사" },
              { label: "피보험자" },
              { label: "주소", textAlign: "center" as const },
              { label: "담당자" },
              { label: "협력사" },
              { label: "승인금액", textAlign: "center" as const },
              { label: "경과일", textAlign: "center" as const },
              { label: "진행상태", textAlign: "center" as const },
              { label: "취소일자", textAlign: "center" as const },
              { label: "특이사항" },
              { label: "자세히 보기", textAlign: "center" as const },
            ].map((col) => (
              <div
                key={col.label}
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                  textAlign: col.textAlign || "left",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: col.textAlign === "center" ? "center" : "flex-start",
                  paddingRight: "4px",
                  paddingLeft: "4px",
                  paddingTop: "14px",
                  paddingBottom: "14px",
                  whiteSpace: "nowrap",
                }}
              >
                {col.label}
              </div>
            ))}
          </div>

          {filteredData.length === 0 ? (
            <div
              style={{
                padding: "80px 20px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "24px",
              }}
            >
              <Cloud
                style={{
                  width: "80px",
                  height: "80px",
                  color: "#008FED",
                  opacity: 0.3,
                }}
              />
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 500,
                  fontSize: "18px",
                  color: "rgba(12, 12, 12, 0.6)",
                }}
              >
                접수취소된 건이 없습니다.
              </div>
            </div>
          ) : (
            filteredData.map((caseItem) => {
              const caseNumberSuffix =
                caseItem.caseNumber?.match(/-(\d+)$/)?.[1] || "0";
              const suffixNum = parseInt(caseNumberSuffix);
              const isInsuredCase = suffixNum === 0;

              let addressText: string;
              if (isInsuredCase) {
                addressText =
                  [caseItem.insuredAddress, (caseItem as any).insuredAddressDetail]
                    .filter(Boolean)
                    .join(" ") || "-";
              } else {
                const victimAddr = [
                  (caseItem as any).victimAddress,
                  (caseItem as any).victimAddressDetail,
                ]
                  .filter(Boolean)
                  .join(" ");
                if (victimAddr) {
                  addressText = victimAddr;
                } else {
                  addressText =
                    [caseItem.insuredAddress, (caseItem as any).insuredAddressDetail]
                      .filter(Boolean)
                      .join(" ") || "-";
                }
              }
              const addressFontSize = addressText.length > 40 ? "11px" : "13px";

              const latestNote = (() => {
                try {
                  const history = (caseItem as any).specialNotesHistory;
                  if (!history) return (caseItem as any).specialNotes || "-";
                  const parsed = JSON.parse(history);
                  if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed[parsed.length - 1].content || "-";
                  }
                  return (caseItem as any).specialNotes || "-";
                } catch {
                  return (caseItem as any).specialNotes || "-";
                }
              })();

              const cellStyle: React.CSSProperties = {
                fontFamily: "Pretendard",
                fontSize: "13px",
                color: "rgba(12, 12, 12, 0.8)",
                paddingRight: "4px",
                paddingLeft: "4px",
                paddingTop: "14px",
                paddingBottom: "14px",
                display: "flex",
                alignItems: "center",
              };

              return (
                <div
                  key={caseItem.id}
                  onClick={() => { if (canViewDetail) { setDetailTab("기본정보"); setSelectedCaseId(caseItem.id); } }}
                  style={{
                    display: "grid",
                    gridTemplateColumns,
                    padding: "0 20px",
                    borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                    alignItems: "stretch",
                    cursor: canViewDetail ? "pointer" : "default",
                  }}
                  data-testid={`cancelled-case-row-${caseItem.id}`}
                >
                  <div style={cellStyle}>
                    {caseItem.insurancePolicyNo || "-"}
                  </div>
                  <div style={cellStyle}>
                    {caseItem.insuranceAccidentNo || "-"}
                  </div>
                  <div style={cellStyle}>
                    {formatCaseNumber(caseItem.caseNumber) || "-"}
                  </div>
                  <div style={cellStyle}>
                    {caseItem.insuranceCompany || "-"}
                  </div>
                  <div style={cellStyle}>
                    {caseItem.insuredName || "-"}
                  </div>
                  <div
                    style={{
                      ...cellStyle,
                      fontSize: addressFontSize,
                      lineHeight: "1.4",
                      wordBreak: "keep-all" as const,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical" as const,
                      overflow: "hidden",
                    }}
                    title={addressText}
                  >
                    {addressText}
                  </div>
                  <div style={cellStyle}>
                    {caseItem.managerName || "-"}
                  </div>
                  <div style={cellStyle}>
                    {caseItem.assignedPartner || "-"}
                  </div>
                  <div style={{ ...cellStyle, justifyContent: "flex-end" }}>
                    {formatAmount(caseItem.approvedAmount)}
                  </div>
                  <div style={{ ...cellStyle, justifyContent: "center" }}>
                    {calculateDays(caseItem.createdAt)}
                  </div>
                  <div onClick={(e) => e.stopPropagation()} style={{ ...cellStyle, justifyContent: "center" }}>
                    {user?.role === "관리자" && canEditStatus ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild disabled={updateStatusMutation.isPending}>
                          <div
                            style={{
                              padding: "6px 12px",
                              background: "rgba(12, 12, 12, 0.05)",
                              borderRadius: "6px",
                              fontFamily: "Pretendard",
                              fontSize: "12px",
                              fontWeight: 600,
                              color: getStatusColor(caseItem.status),
                              textAlign: "center",
                              lineHeight: "1.4",
                              maxWidth: "140px",
                              wordBreak: "keep-all",
                              cursor: updateStatusMutation.isPending ? "not-allowed" : "pointer",
                              opacity: updateStatusMutation.isPending ? 0.6 : 1,
                            }}
                          >
                            {getStatusDisplayText(caseItem.status)}
                          </div>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          style={{
                            width: "200px",
                            background: "rgba(200, 200, 200, 0.95)",
                            backdropFilter: "blur(10px)",
                            border: "none",
                            borderRadius: "8px",
                            padding: "8px",
                          }}
                        >
                          {([
                            "접수완료",
                            "검토중",
                            "반려",
                            "직접복구",
                            "선견적요청",
                            "청구",
                            "종결",
                            "접수취소",
                          ] as const).map((status) => (
                            <DropdownMenuItem
                              key={status}
                              onClick={() => {
                                const targetStatus = status === "선견적요청" ? "출동비청구(선견적)" : status;
                                updateStatusMutation.mutate({ caseId: caseItem.id, status: targetStatus });
                              }}
                              style={{
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                padding: "10px 12px",
                                margin: "0",
                                cursor: "pointer",
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 500,
                                color: getStatusColor(status),
                                background: "transparent",
                                borderRadius: "4px",
                              }}
                            >
                              {getStatusDisplayText(status)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <div
                        style={{
                          padding: "6px 12px",
                          background: "rgba(12, 12, 12, 0.05)",
                          borderRadius: "6px",
                          fontFamily: "Pretendard",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: getStatusColor(caseItem.status),
                          textAlign: "center",
                          lineHeight: "1.4",
                          maxWidth: "140px",
                          wordBreak: "keep-all",
                        }}
                      >
                        {getStatusDisplayText(caseItem.status)}
                      </div>
                    )}
                  </div>
                  <div style={{ ...cellStyle, justifyContent: "center" }}>
                    {formatDate(caseItem.cancellationDate)}
                  </div>
                  <div
                    style={{
                      ...cellStyle,
                      fontSize: "12px",
                      lineHeight: "1.4",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical" as const,
                      overflow: "hidden",
                    }}
                    title={latestNote}
                  >
                    {latestNote}
                  </div>
                  <div style={{ ...cellStyle, justifyContent: "center" }}>
                    {canViewDetail ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailTab("기본정보");
                          setSelectedCaseId(caseItem.id);
                        }}
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "13px",
                          fontWeight: 500,
                          color: "#008FED",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                        data-testid={`button-detail-${caseItem.id}`}
                      >
                        자세히 보기
                      </button>
                    ) : (
                      <span style={{ fontFamily: "Pretendard", fontSize: "12px", color: "rgba(12,12,12,0.3)" }}>-</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <Sheet
        open={selectedCaseId !== null}
        onOpenChange={(open) => !open && setSelectedCaseId(null)}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-[600px] overflow-y-auto"
          style={{
            background: "rgba(253, 253, 253, 0.95)",
            backdropFilter: "blur(17px)",
            padding: "50px 20px 32px 20px",
          }}
        >
          <SheetHeader
            style={{
              padding: "24px 20px",
              borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
              marginBottom: "0",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <SheetTitle
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "22px",
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                }}
              >
                진행건 상세보기
              </SheetTitle>
            </div>
          </SheetHeader>

          {selectedCaseId &&
            (() => {
              const selectedCase = cases?.find((c) => c.id === selectedCaseId);
              if (!selectedCase) return null;

              return (
                <>
                  <div
                    style={{
                      display: "flex",
                      gap: "0px",
                      borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                      padding: "0 20px",
                    }}
                  >
                    {(user?.role === "심사사" || user?.role === "조사사"
                      ? ["기본정보", "일자", "진행단계"]
                      : ["기본정보", "일자", "진행단계", "진행메모"]
                    ).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setDetailTab(tab)}
                        style={{
                          padding: "16px 24px",
                          background: "transparent",
                          border: "none",
                          borderBottom:
                            detailTab === tab
                              ? "2px solid #008FED"
                              : "2px solid transparent",
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: detailTab === tab ? 600 : 400,
                          color:
                            detailTab === tab
                              ? "#008FED"
                              : "rgba(12, 12, 12, 0.6)",
                          cursor: "pointer",
                          transition: "all 0.2s",
                        }}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                  <ScrollArea className="h-[calc(100vh-220px)]">
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "16px",
                        padding: "16px 20px 20px 20px",
                      }}
                    >
                      {detailTab === "기본정보" && (
                        <>
                          <div
                            style={{
                              background: "rgba(12, 12, 12, 0.02)",
                              borderRadius: "8px",
                              padding: "16px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "0px",
                            }}
                          >
                            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", padding: "10px 0px", gap: "16px" }}>
                              <div style={{ width: "100px", fontFamily: "Pretendard", fontWeight: 500, fontSize: "14px", color: "rgba(12, 12, 12, 0.6)" }}>진행상태</div>
                              <div style={{ padding: "6px 16px", background: getStatusColor(selectedCase.status) || "#008FED", borderRadius: "4px", fontFamily: "Pretendard", fontWeight: 500, fontSize: "14px", color: "#FFFFFF" }}>
                                {selectedCase.status || "접수완료"}
                              </div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", padding: "10px 0px", gap: "16px" }}>
                              <div style={{ width: "100px", fontFamily: "Pretendard", fontWeight: 500, fontSize: "14px", color: "rgba(12, 12, 12, 0.6)" }}>담당자</div>
                              <div style={{ fontFamily: "Pretendard", fontWeight: 400, fontSize: "14px", color: "rgba(12, 12, 12, 0.9)" }}>{selectedCase.managerName || "-"}</div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", padding: "10px 0px", gap: "16px" }}>
                              <div style={{ width: "100px", fontFamily: "Pretendard", fontWeight: 500, fontSize: "14px", color: "rgba(12, 12, 12, 0.6)" }}>협력사</div>
                              <div style={{ fontFamily: "Pretendard", fontWeight: 400, fontSize: "14px", color: "rgba(12, 12, 12, 0.9)" }}>{selectedCase.assignedPartner || "-"}</div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", padding: "10px 0px", gap: "16px" }}>
                              <div style={{ width: "100px", fontFamily: "Pretendard", fontWeight: 500, fontSize: "14px", color: "rgba(12, 12, 12, 0.6)" }}>경과일수</div>
                              <div style={{ fontFamily: "Pretendard", fontWeight: 400, fontSize: "14px", color: "rgba(12, 12, 12, 0.9)" }}>{calculateDays(selectedCase.createdAt)}</div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", padding: "10px 0px", gap: "16px" }}>
                              <div style={{ width: "100px", fontFamily: "Pretendard", fontWeight: 500, fontSize: "14px", color: "rgba(12, 12, 12, 0.6)" }}>견적금액</div>
                              <div style={{ fontFamily: "Pretendard", fontWeight: 400, fontSize: "14px", color: "rgba(12, 12, 12, 0.9)" }}>{formatAmount(selectedCase.initialEstimateAmount)}</div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", padding: "10px 0px", gap: "16px" }}>
                              <div style={{ width: "100px", fontFamily: "Pretendard", fontWeight: 500, fontSize: "14px", color: "rgba(12, 12, 12, 0.6)" }}>승인금액</div>
                              <div style={{ fontFamily: "Pretendard", fontWeight: 400, fontSize: "14px", color: "rgba(12, 12, 12, 0.9)" }}>{formatAmount(selectedCase.approvedAmount)}</div>
                            </div>
                          </div>

                          <div style={{ width: "100%", height: "1px", background: "rgba(12, 12, 12, 0.1)", margin: "8px 0" }}></div>

                          <div style={{ display: "flex", flexDirection: "column", gap: "0px" }}>
                            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", padding: "10px 0px", gap: "16px" }}>
                              <div style={{ width: "100px", fontFamily: "Pretendard", fontWeight: 500, fontSize: "14px", color: "rgba(12, 12, 12, 0.6)" }}>의뢰사</div>
                              <div style={{ fontFamily: "Pretendard", fontWeight: 400, fontSize: "14px", color: "rgba(12, 12, 12, 0.9)" }}>{selectedCase.insuranceCompany || "-"}</div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", padding: "10px 0px", gap: "16px" }}>
                              <div style={{ width: "100px", fontFamily: "Pretendard", fontWeight: 500, fontSize: "14px", color: "rgba(12, 12, 12, 0.6)" }}>심사사</div>
                              <div style={{ fontFamily: "Pretendard", fontWeight: 400, fontSize: "14px", color: "rgba(12, 12, 12, 0.9)" }}>{selectedCase.assessorId || "-"}</div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", padding: "10px 0px", gap: "16px" }}>
                              <div style={{ width: "100px", fontFamily: "Pretendard", fontWeight: 500, fontSize: "14px", color: "rgba(12, 12, 12, 0.6)" }}>심사 담당자</div>
                              <div style={{ fontFamily: "Pretendard", fontWeight: 400, fontSize: "14px", color: "rgba(12, 12, 12, 0.9)" }}>
                                {selectedCase.assessorDepartment && selectedCase.assessorTeam
                                  ? `${selectedCase.assessorDepartment} ${selectedCase.assessorTeam}`
                                  : selectedCase.assessorId || "-"}
                              </div>
                            </div>
                          </div>

                          {user?.role === "심사사" || user?.role === "조사사" ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px" }}>
                              <button
                                onClick={async () => {
                                  try {
                                    const response = await fetch(`/api/view-field-report-pdf/${selectedCase.id}`, { credentials: "include" });
                                    if (!response.ok) throw new Error("PDF 생성 실패");
                                    const blob = await response.blob();
                                    const url = URL.createObjectURL(blob);
                                    window.open(url, "_blank");
                                  } catch {
                                    toast({ title: "PDF 열기 실패", variant: "destructive" });
                                  }
                                }}
                                style={{
                                  width: "100%", padding: "14px", background: "#008FED", borderRadius: "8px",
                                  border: "none", fontFamily: "Pretendard", fontWeight: 600, fontSize: "16px",
                                  color: "#FFFFFF", cursor: "pointer",
                                }}
                              >
                                현장출동보고서 PDF보기
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                localStorage.setItem("selectedFieldSurveyCaseId", selectedCase.id);
                                localStorage.setItem("returnToComprehensiveProgress", "true");
                                setLocation("/field-survey/report");
                              }}
                              style={{
                                width: "100%", padding: "14px", background: "#008FED", borderRadius: "8px",
                                border: "none", fontFamily: "Pretendard", fontWeight: 600, fontSize: "16px",
                                color: "#FFFFFF", cursor: "pointer", marginTop: "16px",
                              }}
                            >
                              보고서 열람
                            </button>
                          )}
                        </>
                      )}

                      {detailTab === "일자" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          {[
                            { label: "접수일", value: selectedCase?.receptionDate },
                            { label: "배당일", value: selectedCase?.assignmentDate },
                            { label: "현장방문일", value: selectedCase?.visitDate },
                            { label: "현장자료 제출일", value: selectedCase?.siteInvestigationSubmitDate },
                            { label: "1차 승인일(내부)", value: selectedCase?.firstApprovalDate },
                            { label: "2차 승인일(복구 요청일)", value: selectedCase?.secondApprovalDate },
                            { label: "복구완료일", value: selectedCase?.constructionCompletionDate },
                            { label: "청구일", value: selectedCase?.claimDate },
                            { label: "입금완료일", value: selectedCase?.paymentCompletedDate },
                            { label: "지급완료일(정산)", value: selectedCase?.settlementCompletedDate },
                          ].map((item) => (
                            <div
                              key={item.label}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                paddingBottom: "12px",
                                borderBottom: "1px solid rgba(12, 12, 12, 0.05)",
                              }}
                            >
                              <span style={{ width: "180px", fontFamily: "Pretendard", fontSize: "16px", fontWeight: 400, letterSpacing: "-0.02em", color: "rgba(12, 12, 12, 0.5)" }}>
                                {item.label}
                              </span>
                              <span style={{ fontFamily: "Pretendard", fontSize: "16px", fontWeight: 400, letterSpacing: "-0.02em", color: "rgba(12, 12, 12, 0.7)" }}>
                                {formatDate(item.value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {detailTab === "진행단계" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                          <div style={{ fontFamily: "Pretendard", fontWeight: 600, fontSize: "16px", letterSpacing: "-0.02em", color: "rgba(12, 12, 12, 0.9)" }}>진행단계</div>
                          <div
                            style={{
                              width: "100%", minHeight: "200px", padding: "16px",
                              background: "rgba(12, 12, 12, 0.04)", border: "1px solid rgba(12, 12, 12, 0.1)",
                              borderRadius: "8px", fontFamily: "Pretendard", fontSize: "14px", lineHeight: "1.6",
                              color: selectedCase.latestProgress?.content ? "rgba(12, 12, 12, 0.9)" : "rgba(12, 12, 12, 0.5)",
                              whiteSpace: "pre-wrap", wordBreak: "break-word",
                            }}
                          >
                            {selectedCase.latestProgress?.content || "관리자가 입력한 진행단계가 없습니다."}
                          </div>
                        </div>
                      )}

                      {detailTab === "진행메모" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ED1C00" }} />
                              <div style={{ fontFamily: "Pretendard", fontWeight: 600, fontSize: "16px", letterSpacing: "-0.02em", color: "rgba(12, 12, 12, 0.9)" }}>협력사 진행메모</div>
                            </div>
                            <div
                              style={{
                                display: "flex", flexDirection: "column", gap: "8px", padding: "16px",
                                background: "rgba(237, 28, 0, 0.04)", border: "1px solid rgba(237, 28, 0, 0.1)",
                                borderRadius: "8px", minHeight: "80px",
                              }}
                            >
                              {(() => {
                                const partnerHistory = safeParseNotesHistory(selectedCase.partnerNotesHistory as string);
                                const legacyNote = selectedCase.specialNotes;
                                if (partnerHistory.length === 0 && !legacyNote) {
                                  return <div style={{ fontFamily: "Pretendard", fontSize: "14px", color: "rgba(12, 12, 12, 0.5)" }}>협력사가 입력한 진행메모가 없습니다.</div>;
                                }
                                return (
                                  <>
                                    {legacyNote && (
                                      <div style={{ fontFamily: "Pretendard", fontSize: "14px", lineHeight: "1.6", color: "rgba(12, 12, 12, 0.9)", whiteSpace: "pre-wrap", wordBreak: "break-word", paddingBottom: partnerHistory.length > 0 ? "8px" : 0, borderBottom: partnerHistory.length > 0 ? "1px solid rgba(12, 12, 12, 0.1)" : "none" }}>
                                        {legacyNote}
                                      </div>
                                    )}
                                    {partnerHistory.map((note, idx) => (
                                      <div key={idx} style={{ fontFamily: "Pretendard", fontSize: "14px", lineHeight: "1.6", color: "rgba(12, 12, 12, 0.9)", whiteSpace: "pre-wrap", wordBreak: "break-word", paddingTop: idx > 0 || legacyNote ? "8px" : 0, borderTop: idx > 0 ? "1px solid rgba(12, 12, 12, 0.1)" : "none" }}>
                                        <span style={{ color: "rgba(12, 12, 12, 0.5)", fontSize: "12px" }}>[{new Date(note.createdAt).toLocaleDateString("ko-KR")}]</span>{" "}{note.content}
                                      </div>
                                    ))}
                                  </>
                                );
                              })()}
                            </div>
                            {user?.role === "협력사" && (
                              <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                                <textarea
                                  value={newNoteContent}
                                  onChange={(e) => setNewNoteContent(e.target.value)}
                                  placeholder="추가 특이사항을 입력하세요"
                                  maxLength={1000}
                                  style={{
                                    flex: 1, minHeight: "60px", padding: "12px",
                                    background: "rgba(12, 12, 12, 0.02)", border: "1px solid rgba(12, 12, 12, 0.15)",
                                    borderRadius: "8px", fontFamily: "Pretendard", fontSize: "14px", lineHeight: "1.5",
                                    color: "rgba(12, 12, 12, 0.9)", resize: "vertical",
                                  }}
                                />
                                <button
                                  onClick={() => {
                                    if (selectedCase.id && newNoteContent.trim()) {
                                      addNotesHistoryMutation.mutate({ caseId: selectedCase.id, content: newNoteContent });
                                    }
                                  }}
                                  disabled={addNotesHistoryMutation.isPending || !newNoteContent.trim()}
                                  style={{
                                    padding: "12px 20px", background: "#ED1C00", border: "none", borderRadius: "8px",
                                    fontFamily: "Pretendard", fontWeight: 600, fontSize: "14px", color: "#FFFFFF",
                                    cursor: addNotesHistoryMutation.isPending || !newNoteContent.trim() ? "not-allowed" : "pointer",
                                    opacity: addNotesHistoryMutation.isPending || !newNoteContent.trim() ? 0.6 : 1,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {addNotesHistoryMutation.isPending ? "저장 중..." : "저장"}
                                </button>
                              </div>
                            )}
                            {user?.role === "관리자" &&
                              (safeParseNotesHistory(selectedCase.partnerNotesHistory as string).length > 0 || selectedCase.specialNotes) &&
                              selectedCase.partnerNotesAckedByAdmin !== "true" && (
                                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                  <button
                                    onClick={() => { if (selectedCase.id) ackNotesMutation.mutate(selectedCase.id); }}
                                    disabled={ackNotesMutation.isPending}
                                    style={{
                                      padding: "8px 16px", background: "transparent", border: "1px solid #ED1C00",
                                      borderRadius: "8px", fontFamily: "Pretendard", fontWeight: 600, fontSize: "13px",
                                      color: "#ED1C00", cursor: ackNotesMutation.isPending ? "not-allowed" : "pointer",
                                      opacity: ackNotesMutation.isPending ? 0.6 : 1,
                                    }}
                                  >
                                    {ackNotesMutation.isPending ? "처리 중..." : "확인"}
                                  </button>
                                </div>
                              )}
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#008FED" }} />
                              <div style={{ fontFamily: "Pretendard", fontWeight: 600, fontSize: "16px", letterSpacing: "-0.02em", color: "rgba(12, 12, 12, 0.9)" }}>관리자 진행메모</div>
                            </div>
                            <div
                              style={{
                                display: "flex", flexDirection: "column", gap: "8px", padding: "16px",
                                background: "rgba(0, 143, 237, 0.04)", border: "1px solid rgba(0, 143, 237, 0.1)",
                                borderRadius: "8px", minHeight: "80px",
                              }}
                            >
                              {(() => {
                                const adminHistory = safeParseNotesHistory(selectedCase.adminNotesHistory as string);
                                if (adminHistory.length === 0) {
                                  return <div style={{ fontFamily: "Pretendard", fontSize: "14px", color: "rgba(12, 12, 12, 0.5)" }}>관리자가 입력한 진행메모가 없습니다.</div>;
                                }
                                return adminHistory.map((note, idx) => (
                                  <div key={idx} style={{ fontFamily: "Pretendard", fontSize: "14px", lineHeight: "1.6", color: "rgba(12, 12, 12, 0.9)", whiteSpace: "pre-wrap", wordBreak: "break-word", paddingTop: idx > 0 ? "8px" : 0, borderTop: idx > 0 ? "1px solid rgba(12, 12, 12, 0.1)" : "none" }}>
                                    <span style={{ color: "rgba(12, 12, 12, 0.5)", fontSize: "12px" }}>[{new Date(note.createdAt).toLocaleDateString("ko-KR")}]</span>{" "}{note.content}
                                  </div>
                                ));
                              })()}
                            </div>
                            {user?.role === "관리자" && (
                              <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                                <textarea
                                  value={newNoteContent}
                                  onChange={(e) => setNewNoteContent(e.target.value)}
                                  placeholder="추가 특이사항을 입력하세요"
                                  maxLength={1000}
                                  style={{
                                    flex: 1, minHeight: "60px", padding: "12px",
                                    background: "rgba(12, 12, 12, 0.02)", border: "1px solid rgba(12, 12, 12, 0.15)",
                                    borderRadius: "8px", fontFamily: "Pretendard", fontSize: "14px", lineHeight: "1.5",
                                    color: "rgba(12, 12, 12, 0.9)", resize: "vertical",
                                  }}
                                />
                                <button
                                  onClick={() => {
                                    if (selectedCase.id && newNoteContent.trim()) {
                                      addNotesHistoryMutation.mutate({ caseId: selectedCase.id, content: newNoteContent });
                                    }
                                  }}
                                  disabled={addNotesHistoryMutation.isPending || !newNoteContent.trim()}
                                  style={{
                                    padding: "12px 20px", background: "#008FED", border: "none", borderRadius: "8px",
                                    fontFamily: "Pretendard", fontWeight: 600, fontSize: "14px", color: "#FFFFFF",
                                    cursor: addNotesHistoryMutation.isPending || !newNoteContent.trim() ? "not-allowed" : "pointer",
                                    opacity: addNotesHistoryMutation.isPending || !newNoteContent.trim() ? 0.6 : 1,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {addNotesHistoryMutation.isPending ? "저장중..." : "저장"}
                                </button>
                              </div>
                            )}
                            {user?.role === "협력사" &&
                              safeParseNotesHistory(selectedCase.adminNotesHistory as string).length > 0 &&
                              selectedCase.adminNotesAckedByPartner !== "true" && (
                                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                  <button
                                    onClick={() => { if (selectedCase.id) ackNotesMutation.mutate(selectedCase.id); }}
                                    disabled={ackNotesMutation.isPending}
                                    style={{
                                      padding: "8px 16px", background: "transparent", border: "1px solid #008FED",
                                      borderRadius: "8px", fontFamily: "Pretendard", fontWeight: 600, fontSize: "13px",
                                      color: "#008FED", cursor: ackNotesMutation.isPending ? "not-allowed" : "pointer",
                                      opacity: ackNotesMutation.isPending ? 0.6 : 1,
                                    }}
                                  >
                                    {ackNotesMutation.isPending ? "처리 중..." : "확인"}
                                  </button>
                                </div>
                              )}
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </>
              );
            })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
