import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { User, Case } from "@shared/schema";
import { ChevronRight, Search } from "lucide-react";
import { getStatusColor, getCaseStatusDisplayText } from "@/lib/case-status";
import { setFieldSurveyCaseId } from "@/lib/detached-window";

// 손방(0) / 대물(>0) 판별 — InvoiceSheet.getCaseSuffix 와 동일 규칙
function getCaseSuffix(caseNumber: string | null | undefined): number {
  if (!caseNumber) return 0;
  const parts = caseNumber.split("-");
  return parts.length > 1 ? parseInt(parts[parts.length - 1]) || 0 : 0;
}

interface MobileComprehensiveProgressProps {
  user: User | undefined;
  cases: Case[];
}

export default function MobileComprehensiveProgress({
  user,
  cases,
}: MobileComprehensiveProgressProps) {
  const [, setLocation] = useLocation();
  const [searchText, setSearchText] = useState("");

  // 협력사(협력업체)만 수행업무 노출. 그 외(심사사 등)는 조회만.
  const canPerformTasks = user?.role === "협력사";

  const visibleCases = useMemo(() => {
    const list = cases.filter((c) => c.status !== "작성중");
    const q = searchText.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      const fields = [
        c.insuranceCompany,
        c.insuranceAccidentNo,
        c.insuredName,
        c.victimAddress,
      ];
      return fields.some((f) => (f || "").toLowerCase().includes(q));
    });
  }, [cases, searchText]);

  const handlePerformTask = (caseItem: Case) => {
    setFieldSurveyCaseId(caseItem.id);
    setLocation(`/mobile-case/${caseItem.id}`);
  };

  return (
    <div className="flex flex-col" style={{ paddingBottom: "24px" }}>
      {/* 검색 */}
      <div className="px-5 pt-4 pb-2">
        <div
          className="flex items-center gap-2 px-3"
          style={{
            height: "44px",
            background: "rgba(12, 12, 12, 0.04)",
            borderRadius: "10px",
          }}
        >
          <Search style={{ width: "18px", height: "18px", color: "rgba(12, 12, 12, 0.4)" }} />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="보험사 · 사고번호 · 피보험자 · 주소 검색"
            className="flex-1 bg-transparent outline-none"
            style={{
              fontFamily: "Pretendard",
              fontWeight: 400,
              fontSize: "14px",
              letterSpacing: "-0.01em",
              color: "#0C0C0C",
            }}
            data-testid="input-search-comprehensive"
          />
        </div>
      </div>

      <div
        className="px-5 pb-2"
        style={{
          fontFamily: "Pretendard",
          fontWeight: 500,
          fontSize: "13px",
          color: "rgba(12, 12, 12, 0.5)",
        }}
        data-testid="text-case-count"
      >
        총 {visibleCases.length}건
      </div>

      {/* 케이스 리스트 */}
      <div className="flex flex-col px-4" style={{ gap: "10px" }}>
        {visibleCases.length === 0 ? (
          <div
            className="flex items-center justify-center"
            style={{
              height: "120px",
              fontFamily: "Pretendard",
              fontWeight: 400,
              fontSize: "14px",
              color: "rgba(12, 12, 12, 0.5)",
            }}
          >
            데이터가 없습니다
          </div>
        ) : (
          visibleCases.map((caseItem) => {
            const suffix = getCaseSuffix(caseItem.caseNumber);
            const damageType = suffix === 0 ? "손방" : "대물";
            const statusText = getCaseStatusDisplayText(caseItem, cases);
            const statusColor = getStatusColor(caseItem.status);

            return (
              <div
                key={caseItem.id}
                className="flex flex-col"
                style={{
                  background: "#FDFDFD",
                  border: "1px solid rgba(12, 12, 12, 0.06)",
                  boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.04)",
                  borderRadius: "12px",
                  padding: "14px 16px",
                  gap: "10px",
                }}
                data-testid={`card-case-${caseItem.id}`}
              >
                {/* 상단: 보험사 + 진행상태 */}
                <div className="flex justify-between items-center">
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 600,
                      fontSize: "15px",
                      letterSpacing: "-0.02em",
                      color: "#0C0C0C",
                    }}
                    data-testid={`text-insurance-${caseItem.id}`}
                  >
                    {caseItem.insuranceCompany || "-"}
                  </span>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 600,
                      fontSize: "12px",
                      letterSpacing: "-0.01em",
                      color: statusColor,
                      background: `${statusColor}14`,
                      padding: "4px 8px",
                      borderRadius: "6px",
                      whiteSpace: "nowrap",
                    }}
                    data-testid={`text-status-${caseItem.id}`}
                  >
                    {statusText}
                  </span>
                </div>

                {/* 정보 그리드 */}
                <div className="flex flex-col" style={{ gap: "6px" }}>
                  <InfoRow label="사고번호" value={caseItem.insuranceAccidentNo || "-"} />
                  <div className="flex" style={{ gap: "16px" }}>
                    <div className="flex-1">
                      <InfoRow label="피보험자" value={caseItem.insuredName || "-"} />
                    </div>
                    <div style={{ width: "90px" }}>
                      <InfoRow label="구분" value={damageType} />
                    </div>
                  </div>
                  <InfoRow label="주소" value={caseItem.victimAddress || "-"} />
                </div>

                {/* 수행업무 (협력사만) */}
                {canPerformTasks && (
                  <button
                    onClick={() => handlePerformTask(caseItem)}
                    className="flex justify-center items-center gap-1"
                    style={{
                      marginTop: "2px",
                      height: "40px",
                      background: "#253396",
                      borderRadius: "8px",
                      fontFamily: "Pretendard",
                      fontWeight: 600,
                      fontSize: "14px",
                      letterSpacing: "-0.01em",
                      color: "#FFFFFF",
                    }}
                    data-testid={`button-perform-task-${caseItem.id}`}
                  >
                    수행업무
                    <ChevronRight style={{ width: "16px", height: "16px" }} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start" style={{ gap: "8px" }}>
      <span
        style={{
          flexShrink: 0,
          width: "56px",
          fontFamily: "Pretendard",
          fontWeight: 400,
          fontSize: "13px",
          letterSpacing: "-0.01em",
          color: "rgba(12, 12, 12, 0.45)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          flex: 1,
          fontFamily: "Pretendard",
          fontWeight: 500,
          fontSize: "13px",
          letterSpacing: "-0.01em",
          color: "rgba(12, 12, 12, 0.85)",
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}
