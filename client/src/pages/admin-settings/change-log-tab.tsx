import type { CaseChangeLog } from "@shared/schema";

interface ChangeLogTabProps {
  changeLogs: Array<CaseChangeLog & { caseNumber: string }>;
  changeLogsLoading: boolean;
  changeLogCaseNumberFilter: string;
  setChangeLogCaseNumberFilter: (v: string) => void;
  changeLogDateFrom: string;
  setChangeLogDateFrom: (v: string) => void;
  changeLogDateTo: string;
  setChangeLogDateTo: (v: string) => void;
}

export function ChangeLogTab({
  changeLogs,
  changeLogsLoading,
  changeLogCaseNumberFilter,
  setChangeLogCaseNumberFilter,
  changeLogDateFrom,
  setChangeLogDateFrom,
  changeLogDateTo,
  setChangeLogDateTo,
}: ChangeLogTabProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1
          style={{
            fontFamily: "Pretendard",
            fontSize: "28px",
            fontWeight: 600,
            lineHeight: "128%",
            letterSpacing: "-0.02em",
            color: "#56687f",
          }}
        >
          변경 로그 관리
        </h1>
      </div>

      <div
        className="rounded-xl p-6 mb-6 flxn-search-card"
        style={{
          background: "#FFFFFF",
          boxShadow: "0px 0px 20px #DBE9F5",
        }}
      >
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label
              className="block mb-2"
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 500,
                color: "#686A6E",
              }}
            >
              사고 번호 검색
            </label>
            <input
              type="text"
              value={changeLogCaseNumberFilter}
              onChange={(e) => setChangeLogCaseNumberFilter(e.target.value)}
              placeholder="사고번호를 입력해주세요"
              className="w-full px-3 py-2 outline-none"
              style={{
                background: "#FFFFFF",
                border: "1px solid rgba(12, 12, 12, 0.08)",
                borderRadius: "6px",
                fontFamily: "Pretendard",
                fontSize: "13px",
              }}
              data-testid="input-changelog-case-number"
            />
          </div>
          <div>
            <label
              className="block mb-2"
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 500,
                color: "#686A6E",
              }}
            >
              시작일
            </label>
            <input
              type="date"
              value={changeLogDateFrom}
              onChange={(e) => setChangeLogDateFrom(e.target.value)}
              className="px-3 py-2 outline-none"
              style={{
                background: "#FFFFFF",
                border: "1px solid rgba(12, 12, 12, 0.08)",
                borderRadius: "6px",
                fontFamily: "Pretendard",
                fontSize: "13px",
              }}
              data-testid="input-changelog-date-from"
            />
          </div>
          <div>
            <label
              className="block mb-2"
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 500,
                color: "#686A6E",
              }}
            >
              종료일
            </label>
            <input
              type="date"
              value={changeLogDateTo}
              onChange={(e) => setChangeLogDateTo(e.target.value)}
              className="px-3 py-2 outline-none"
              style={{
                background: "#FFFFFF",
                border: "1px solid rgba(12, 12, 12, 0.08)",
                borderRadius: "6px",
                fontFamily: "Pretendard",
                fontSize: "13px",
              }}
              data-testid="input-changelog-date-to"
            />
          </div>
          <button
            onClick={() => {
              setChangeLogCaseNumberFilter("");
              setChangeLogDateFrom("");
              setChangeLogDateTo("");
            }}
            className="px-4 py-2"
            style={{
              background: "rgba(12, 12, 12, 0.08)",
              borderRadius: "6px",
              fontFamily: "Pretendard",
              fontSize: "14px",
              fontWeight: 500,
              color: "rgba(12, 12, 12, 0.8)",
            }}
            data-testid="button-changelog-reset"
          >
            초기화
          </button>
        </div>
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "#FFFFFF",
          boxShadow: "0px 0px 20px #DBE9F5",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full" style={{ tableLayout: "auto" }}>
            <thead>
              <tr className="compact-row" style={{ background: "rgba(12, 12, 12, 0.04)", borderBottom: "1px solid rgba(12, 12, 12, 0.12)" }}>
                {["사고번호", "변경자", "변경일시", "변경 항목", "변경 내용"].map((label) => (
                  <th
                    key={label}
                    className="px-4 py-3 text-left"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#0C0C0C",
                      borderRight: label !== "변경 내용" ? "1px solid rgba(12, 12, 12, 0.08)" : "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {changeLogsLoading ? (
                <tr className="compact-row">
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 400,
                      color: "#686A6E",
                    }}
                  >
                    로딩 중...
                  </td>
                </tr>
              ) : changeLogs.length === 0 ? (
                <tr className="compact-row">
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 400,
                      color: "#686A6E",
                    }}
                  >
                    변경 로그가 없습니다.
                  </td>
                </tr>
              ) : (
                changeLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="compact-row hover:bg-gray-50 transition-colors"
                    style={{ borderBottom: "1px solid rgba(12, 12, 12, 0.08)" }}
                    data-testid={`row-changelog-${log.id}`}
                  >
                    <td
                      className="px-4 py-3"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        color: "#008FED",
                        borderRight: "1px solid rgba(12, 12, 12, 0.08)",
                        verticalAlign: "top",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {log.caseNumber || "-"}
                    </td>
                    <td
                      className="px-4 py-3"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        color: "rgba(12, 12, 12, 0.8)",
                        borderRight: "1px solid rgba(12, 12, 12, 0.08)",
                        verticalAlign: "top",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {log.changedByName || "-"}
                    </td>
                    <td
                      className="px-4 py-3"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        color: "rgba(12, 12, 12, 0.8)",
                        borderRight: "1px solid rgba(12, 12, 12, 0.08)",
                        verticalAlign: "top",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {log.changedAt
                        ? new Date(log.changedAt).toLocaleString("ko-KR", {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "-"}
                    </td>
                    <td
                      className="px-4 py-3"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 400,
                        color: "rgba(12, 12, 12, 0.7)",
                        borderRight: "1px solid rgba(12, 12, 12, 0.08)",
                        verticalAlign: "top",
                      }}
                    >
                      {log.changes && log.changes.length > 0
                        ? log.changes.map((c) => c.fieldLabel).join(", ")
                        : "-"}
                    </td>
                    <td
                      className="px-4 py-3"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 400,
                        color: "rgba(12, 12, 12, 0.7)",
                        verticalAlign: "top",
                      }}
                    >
                      {log.changes && log.changes.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          {log.changes.map((change, idx) => (
                            <div key={idx} style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                              <span style={{ fontWeight: 500, color: "rgba(12, 12, 12, 0.8)" }}>{change.fieldLabel}:</span>
                              <span style={{ color: "#ED1C00", textDecoration: "line-through" }}>
                                {change.before || "(없음)"}
                              </span>
                              <span style={{ color: "rgba(12, 12, 12, 0.4)" }}>→</span>
                              <span style={{ color: "#00A651" }}>
                                {change.after || "(없음)"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
