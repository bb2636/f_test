import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Case } from "@shared/schema";
import { format } from "date-fns";
import { formatCaseNumber } from "@/lib/utils";
import {
  isDetachedWindow,
  isDetachedReportWindow,
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
  const [location] = useLocation();
  // 보고서 열람 분리창만 창 단위(sessionStorage+CustomEvent)로 건을 관리한다.
  // 도면작성/증빙자료 단독 팝업(solo)은 인앱과 동일하게 localStorage(selectedFieldSurveyCaseId)로
  // 건을 공유한다 — 열 때 caseId를 URL에 싣지 않고 localStorage로만 넘기기 때문.
  const useReportDetached = isDetachedReportWindow();
  const [selectedCaseId, setSelectedCaseId] = useState<string>(() => {
    if (useReportDetached) {
      // URL의 caseId가 그 창이 처음 요청한 건 — field-report와 동일하게 URL을 우선한다.
      // (새 창은 opener의 sessionStorage를 복사하므로 stale 값이 URL을 덮어쓰지 않게.)
      const fromQuery =
        new URLSearchParams(window.location.search).get("caseId") || "";
      return fromQuery || getDetachedReportCaseId();
    }
    const raw = localStorage.getItem("selectedFieldSurveyCaseId");
    return raw && raw !== "null" && raw !== "undefined" ? raw : "";
  });

  // 동기화: 보고서 분리창은 같은 창에만 도는 CustomEvent, 인앱·solo 팝업은 공유 localStorage(폴링+storage).
  useEffect(() => {
    if (useReportDetached) {
      const onCaseChange = (e: Event) => {
        const next = (e as CustomEvent<string>).detail || "";
        if (next) setSelectedCaseId((prev) => (prev !== next ? next : prev));
      };
      window.addEventListener(REPORT_CASE_CHANGE_EVENT, onCaseChange);
      // CustomEvent 누락 대비: 창 단위 sessionStorage 폴백 폴링(다른 창 누수 없음).
      // 보고서 본문(field-report)과 동일 sticky를 보고 탭 하이라이트도 함께 따라가게 한다.
      const pollId = setInterval(() => {
        const next = getDetachedReportCaseId();
        if (next) setSelectedCaseId((prev) => (prev !== next ? next : prev));
      }, 500);
      return () => {
        window.removeEventListener(REPORT_CASE_CHANGE_EVENT, onCaseChange);
        clearInterval(pollId);
      };
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
  }, [useReportDetached]);

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

  const showTabs = groupCases.length > 1;
  // 도면 작성 분리창(팝업)은 사이드바가 없으므로 기초정보 카드를 상단 바(전환 버튼과 같은 줄)에 표시.
  const showInfo =
    detached && location.startsWith("/field-survey/drawing");

  // 표시할 것이 아무것도 없으면(단일 케이스 + 정보카드 비표시) 렌더 생략.
  if (!showTabs && !showInfo) return null;

  const handleSelect = (id: string) => {
    if (id === selectedCaseId) return;
    setSelectedCaseId(id);
    if (useReportDetached) {
      // 보고서 분리창: 공유 localStorage 대신 창 단위로만 전환(다른 창에 누수 X).
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

  // 정보 카드 주소: 피해자 주소 우선, 없으면 피보험자 주소.
  const infoAddress = (() => {
    const [base, detail] = current.victimAddress
      ? [current.victimAddress, current.victimAddressDetail]
      : [current.insuredAddress, current.insuredAddressDetail];
    if (!base) return "";
    return `${base}${detail ? ` (${detail})` : ""}`;
  })();

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "12px 24px",
        borderBottom: "1px solid #E5E7EB",
        background: "#FFFFFF",
      }}
      data-testid="case-receipt-tabs"
    >
      {showTabs && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
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
      )}

      {showInfo && (
        <div
          className="px-4 py-3 rounded-lg"
          style={{
            background: "white",
            border: "1px solid rgba(37, 51, 150, 0.15)",
            maxWidth: "min(640px, 70vw)",
            marginLeft: "auto",
          }}
          data-ui="case-info-bar"
        >
          {/* 첫 번째 줄: 보험사명 + 사고번호 */}
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: "#253396" }} />
            <span
              style={{
                fontFamily: "Pretendard",
                fontSize: "15px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "#0C0C0C",
              }}
            >
              {current.insuranceCompany || "보험사 미정"}{" "}
              {current.insuranceAccidentNo || ""}
            </span>
          </div>

          {/* 두 번째 줄: 접수번호, 피보험자, 담당자, 주소 */}
          <div
            className="flex items-center gap-4 flex-wrap mt-2"
            style={{
              fontFamily: "Pretendard",
              fontSize: "13px",
              fontWeight: 400,
              letterSpacing: "-0.02em",
              color: "rgba(12, 12, 12, 0.5)",
              paddingLeft: "16px",
            }}
          >
            <span>접수번호 {formatCaseNumber(current.caseNumber)}</span>
            <span>피보험자 {current.insuredName || "미정"}</span>
            <span>담당자 {current.assignedPartnerManager || "미정"}</span>
            {infoAddress && (
              <span>
                <span style={{ color: "rgba(12, 12, 12, 0.5)" }}>주소</span>{" "}
                <span style={{ color: "rgba(12, 12, 12, 0.7)" }}>{infoAddress}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
