import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Case } from "@shared/schema";
import { format } from "date-fns";

function getCaseNumberPrefix(caseNumber?: string | null): string {
  if (!caseNumber) return "";
  const parts = caseNumber.split("-");
  if (parts.length <= 1) return caseNumber;
  return parts.slice(0, -1).join("-");
}

function getCaseNumberSuffix(caseNumber?: string | null): string {
  if (!caseNumber) return "";
  const parts = caseNumber.split("-");
  if (parts.length <= 1) return "";
  return parts[parts.length - 1] || "";
}

function formatVisitDate(d?: string | null): string {
  if (!d) return "미방문";
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "미방문";
    return format(dt, "M/d");
  } catch {
    return "미방문";
  }
}

export function CaseReceiptTabs() {
  const [selectedCaseId, setSelectedCaseId] = useState<string>(() => {
    const raw = localStorage.getItem("selectedFieldSurveyCaseId");
    return raw && raw !== "null" && raw !== "undefined" ? raw : "";
  });

  // localStorage 폴링 + storage 이벤트 (다른 페이지/탭과 동기화)
  useEffect(() => {
    const sync = () => {
      const raw = localStorage.getItem("selectedFieldSurveyCaseId");
      const next = raw && raw !== "null" && raw !== "undefined" ? raw : "";
      setSelectedCaseId((prev) => (prev !== next ? next : prev));
    };
    window.addEventListener("storage", sync);
    const id = setInterval(sync, 500);
    return () => {
      window.removeEventListener("storage", sync);
      clearInterval(id);
    };
  }, []);

  const { data: cases } = useQuery<Case[]>({
    queryKey: ["/api/cases"],
  });

  if (!selectedCaseId || !cases || cases.length === 0) return null;

  const current = cases.find((c) => c.id === selectedCaseId);
  if (!current) return null;

  const prefix = getCaseNumberPrefix(current.caseNumber);
  if (!prefix) return null;

  const groupCases = cases
    .filter((c) => getCaseNumberPrefix(c.caseNumber) === prefix)
    .filter((c) => c.status !== "접수취소" && c.status !== "취소대기")
    .sort((a, b) => {
      const na = parseInt(getCaseNumberSuffix(a.caseNumber) || "0", 10);
      const nb = parseInt(getCaseNumberSuffix(b.caseNumber) || "0", 10);
      return (Number.isFinite(na) ? na : 0) - (Number.isFinite(nb) ? nb : 0);
    });

  // 단일 케이스(피해세대 없음)이면 탭 미표시
  if (groupCases.length <= 1) return null;

  const handleSelect = (id: string) => {
    if (id === selectedCaseId) return;
    localStorage.setItem("selectedFieldSurveyCaseId", id);
    setSelectedCaseId(id);
    // 같은 탭의 다른 페이지가 즉시 반응하도록 storage 이벤트 강제 dispatch
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: "selectedFieldSurveyCaseId", newValue: id }));
    } catch {
      window.dispatchEvent(new Event("storage"));
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
        padding: "12px 24px",
        borderBottom: "1px solid #E5E7EB",
        background: "#FFFFFF",
      }}
      data-testid="case-receipt-tabs"
    >
      {groupCases.map((c) => {
        const sfx = getCaseNumberSuffix(c.caseNumber);
        const isVictim = sfx !== "" && sfx !== "0";
        const label = isVictim ? "피해세대" : "원인세대";
        const name = isVictim
          ? (c.victimName || "(이름없음)")
          : (c.insuredName || c.victimName || "(이름없음)");
        const visit = formatVisitDate(c.visitDate);
        const active = c.id === selectedCaseId;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => handleSelect(c.id)}
            style={{
              padding: "8px 14px",
              borderRadius: "8px",
              border: active ? "1px solid #253396" : "1px solid #E5E7EB",
              background: active ? "#253396" : "#FFFFFF",
              color: active ? "#FFFFFF" : "rgba(12, 12, 12, 0.8)",
              fontFamily: "Pretendard",
              fontSize: "13px",
              fontWeight: active ? 700 : 500,
              letterSpacing: "-0.02em",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            data-testid={`tab-receipt-${sfx || "0"}`}
            title={c.caseNumber || ""}
          >
            {label} · {name} · {visit}
          </button>
        );
      })}
    </div>
  );
}
