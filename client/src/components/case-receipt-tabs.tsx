import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Case } from "@shared/schema";
import { format } from "date-fns";
import {
  isDetachedWindow,
  getDetachedReportCaseId,
  setDetachedReportCaseId,
  REPORT_CASE_CHANGE_EVENT,
} from "@/lib/detached-window";

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

// [2026-05-14] 라벨용 동/호 추출. "○○동 ○○호" 패턴만 매칭, 실패 시 빈 문자열.
function extractUnitLabel(
  addressDetail?: string | null,
  address?: string | null,
): string {
  const combined = [address, addressDetail].filter(Boolean).join(" ").trim();
  if (!combined) return "";
  const dongMatch = combined.match(/([0-9A-Za-z가-힣]+동)/);
  const hoMatch = combined.match(/([0-9A-Za-z가-힣\-]+호)/);
  const parts: string[] = [];
  if (dongMatch) parts.push(dongMatch[1]);
  if (hoMatch) parts.push(hoMatch[1]);
  return parts.join(" ");
}

export function CaseReceiptTabs() {
  // 별도 창(보고서 분리창)에서는 공유 localStorage를 폴링하면 다른 창에서 건을 바꿀 때
  // 같이 동기화돼 버린다. 분리창은 창 단위(sessionStorage) + 같은 창 CustomEvent로만 동작.
  const detached = isDetachedWindow();
  const [selectedCaseId, setSelectedCaseId] = useState<string>(() => {
    if (detached) {
      // URL의 caseId가 그 창이 처음 요청한 건 — field-report와 동일하게 URL을 우선한다.
      // (새 창은 opener의 sessionStorage를 복사하므로 stale 값이 URL을 덮어쓰지 않게.)
      const fromQuery =
        new URLSearchParams(window.location.search).get("caseId") || "";
      return fromQuery || getDetachedReportCaseId();
    }
    const raw = localStorage.getItem("selectedFieldSurveyCaseId");
    return raw && raw !== "null" && raw !== "undefined" ? raw : "";
  });

  // 동기화: 분리창은 같은 창에만 도는 CustomEvent, 인앱은 공유 localStorage(폴링+storage).
  useEffect(() => {
    if (detached) {
      const onCaseChange = (e: Event) => {
        const next = (e as CustomEvent<string>).detail || "";
        if (next) setSelectedCaseId((prev) => (prev !== next ? next : prev));
      };
      window.addEventListener(REPORT_CASE_CHANGE_EVENT, onCaseChange);
      return () =>
        window.removeEventListener(REPORT_CASE_CHANGE_EVENT, onCaseChange);
    }
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
  }, [detached]);

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
    setSelectedCaseId(id);
    if (detached) {
      // 분리창: 공유 localStorage 대신 창 단위로만 전환(다른 창에 누수 X).
      setDetachedReportCaseId(id);
      return;
    }
    localStorage.setItem("selectedFieldSurveyCaseId", id);
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
        const visit = formatVisitDate(c.visitDate);
        // [2026-05-14] 라벨 형식 변경: "구분 · 방문일 · 동호(또는 상세주소)"
        // 원인세대(-0): 피보험자 주소, 피해세대(-1+): 피해자 주소(없으면 피보험자 주소 fallback)
        const dongHo = isVictim
          ? extractUnitLabel(c.victimAddressDetail, c.victimAddress) ||
            extractUnitLabel(c.insuredAddressDetail, c.insuredAddress)
          : extractUnitLabel(c.insuredAddressDetail, c.insuredAddress);
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
            {label} · {visit}{dongHo ? ` · ${dongHo}` : ""}
          </button>
        );
      })}
    </div>
  );
}
