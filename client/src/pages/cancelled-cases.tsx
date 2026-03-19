import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { formatCaseNumber } from "@/lib/utils";

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

  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const { data: cases = [], isLoading } = useQuery<CaseWithLatestProgress[]>({
    queryKey: ["/api/cases"],
  });

  const { data: allUsers = [] } = useQuery<BasicUser[]>({
    queryKey: ["/api/users/basic"],
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
                  onClick={() => setSelectedCaseId(caseItem.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns,
                    padding: "0 20px",
                    borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                    alignItems: "stretch",
                    cursor: "pointer",
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
                  <div style={{ ...cellStyle, justifyContent: "center" }}>
                    <div
                      style={{
                        padding: "6px 12px",
                        background: "rgba(12, 12, 12, 0.05)",
                        borderRadius: "6px",
                        fontFamily: "Pretendard",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#ED1C00",
                        textAlign: "center",
                        lineHeight: "1.4",
                        maxWidth: "140px",
                        wordBreak: "keep-all",
                      }}
                    >
                      접수취소
                    </div>
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setLocation(`/progress?caseId=${caseItem.id}`);
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
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
