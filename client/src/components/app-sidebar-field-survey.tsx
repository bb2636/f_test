import { useLocation } from "wouter";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { User } from "@shared/schema";
import logoIcon from "@assets/logo-frame.svg";
import { usePermissions } from "@/hooks/use-permissions";
import { MyPageDialog } from "./my-page-dialog";

const homeMenuItems = [
  { name: "홈", category: "홈", url: "/dashboard" },
  { name: "접수하기", category: "새로운접수", url: "/intake" },
  { name: "종합진행관리", category: "종합진행관리", url: "/comprehensive-progress" },
  { name: "정산 및 통계", category: "정산 및 통계", url: "/settlements/claim" },
  { name: "관리자 설정", category: "관리자 설정", url: "/admin-settings" },
];

const reportMenuItems = [
  {
    title: "현장조사",
    url: null,
    testId: "submenu-field-survey-label",
    permissionItem: "현장입력",
  },
  {
    title: "현장입력",
    url: "/field-survey/management",
    testId: "submenu-field-management",
    permissionItem: "현장입력",
  },
  {
    title: "도면작성",
    url: "/field-survey/drawing",
    testId: "submenu-drawing",
    permissionItem: "도면작성",
  },
  {
    title: "증빙자료 등록",
    url: "/field-survey/documents",
    testId: "submenu-documents",
    permissionItem: "증빙자료 업로드",
  },
  {
    title: "견적서 작성",
    url: "/field-survey/estimate",
    testId: "submenu-estimate",
    permissionItem: "견적서 작성",
  },
  {
    title: "현장출동보고서",
    url: "/field-survey/report",
    testId: "submenu-report",
    permissionItem: "보고서 작성",
  },
];

export function AppSidebarFieldSurvey() {
  const [location, setLocation] = useLocation();
  const { hasItem, hasCategory, isAdmin, isLoading, user: permsUser } = usePermissions();
  const [myPageOpen, setMyPageOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["홈", "보고서"])
  );

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const visibleHomeItems = homeMenuItems.filter((item) => {
    if (isLoading) return false;
    return hasCategory(item.category);
  });

  const visibleReportItems = reportMenuItems.filter((item) => {
    if (isLoading) return false;
    if (isAdmin) return hasItem("현장조사", item.permissionItem);
    if (!hasCategory("현장조사")) return false;
    return hasItem("현장조사", item.permissionItem);
  });

  const isPartner = permsUser?.role === "협력사";

  const toggleGroup = (name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleHomeNavigate = (item: typeof homeMenuItems[number]) => {
    if (item.name === "접수하기") {
      localStorage.removeItem("editCaseId");
      setLocation("/intake");
      return;
    }
    if (item.name === "정산 및 통계") {
      if (hasItem("정산 및 통계", "정산조회")) {
        setLocation("/settlements/claim");
      } else if (hasItem("정산 및 통계", "통계")) {
        setLocation("/statistics/closed");
      }
      return;
    }
    setLocation(item.url);
  };

  const isHomeChildActive = (item: typeof homeMenuItems[number]) => {
    if (item.name === "홈") return location === "/dashboard" || location === "/mobile-home";
    if (item.name === "접수하기") return location === "/intake";
    if (item.name === "종합진행관리") return location === "/comprehensive-progress";
    if (item.name === "정산 및 통계")
      return location.startsWith("/statistics") || location.startsWith("/settlements");
    if (item.name === "관리자 설정") return location.startsWith("/admin-settings");
    return false;
  };

  const homeExpanded = expandedGroups.has("홈");
  const reportExpanded = expandedGroups.has("보고서");

  return (
    <>
      <div
        className="flex flex-col"
        style={{
          width: "240px",
          background: "var(--color-table-header)",
          borderRight: "1px solid var(--color-table-border)",
          height: "100vh",
        }}
      >
        {/* Logo */}
        <div
          className="flex items-center gap-2 px-6"
          style={{
            height: "72px",
            borderBottom: "1px solid #E5E7EB",
            filter: "drop-shadow(0px 0px 20px #DBE9F5)",
          }}
        >
          <img src={logoIcon} alt="FLOXN Logo" className="w-6 h-6" />
          <div className="text-2xl font-bold text-gray-900">FLOXN</div>
        </div>

        {/* Navigation */}
        <div className="flex flex-col pt-3 flex-1 overflow-y-auto">
          {/* 홈 그룹 */}
          {visibleHomeItems.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => toggleGroup("홈")}
                className="flex items-center justify-between w-full px-6 py-3 transition-colors"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "15px",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#253396",
                  background: "transparent",
                }}
                data-testid="group-home-toggle"
              >
                <span>홈</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${homeExpanded ? "" : "rotate-180"}`}
                  style={{ color: "#253396" }}
                />
              </button>
              {homeExpanded && (
                <div className="flex flex-col">
                  {visibleHomeItems.map((item) => {
                    const active = isHomeChildActive(item);
                    return (
                      <button
                        type="button"
                        key={item.name}
                        onClick={() => handleHomeNavigate(item)}
                        className="flex items-center px-8 py-2.5 transition-colors text-left"
                        style={{
                          background: active ? "#253396" : "transparent",
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: active ? 700 : 500,
                          letterSpacing: "-0.02em",
                          color: active ? "#FFFFFF" : "rgba(12, 12, 12, 0.8)",
                        }}
                        data-testid={`menu-${item.name}`}
                      >
                        {item.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 보고서 그룹 */}
          {visibleReportItems.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => toggleGroup("보고서")}
                className="flex items-center justify-between w-full px-6 py-3 transition-colors"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "15px",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#253396",
                  background: "transparent",
                }}
                data-testid="group-report-toggle"
              >
                <span>보고서</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${reportExpanded ? "" : "rotate-180"}`}
                  style={{ color: "#253396" }}
                />
              </button>
              {reportExpanded && (
                <div className="flex flex-col">
                  {visibleReportItems.map((item) => {
                    const active = item.url ? location === item.url : false;
                    const isLabel = !item.url;
                    return (
                      <button
                        type="button"
                        key={item.title}
                        onClick={() => item.url && setLocation(item.url)}
                        disabled={isLabel}
                        className="flex items-center px-8 py-2.5 transition-colors text-left"
                        style={{
                          background: active ? "#253396" : "transparent",
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: active ? 700 : 500,
                          letterSpacing: "-0.02em",
                          color: active
                            ? "#FFFFFF"
                            : isLabel
                            ? "rgba(12, 12, 12, 0.45)"
                            : "rgba(12, 12, 12, 0.8)",
                          cursor: isLabel ? "default" : "pointer",
                        }}
                        data-testid={item.testId}
                      >
                        {item.title}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 협력업체 안내 */}
          {isPartner && (
            <div
              className="mx-3 mt-4 rounded-lg p-4"
              style={{
                background: "#e7e7f5",
                border: "1px solid var(--color-table-border)",
              }}
            >
              <p
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "#253396",
                  marginBottom: "6px",
                  letterSpacing: "-0.01em",
                }}
              >
                현장출동보고서 절차
              </p>
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "11px",
                  fontWeight: 400,
                  color: "rgba(12, 12, 12, 0.75)",
                  lineHeight: "1.7",
                  letterSpacing: "-0.01em",
                }}
              >
                <p>① 현장입력</p>
                <p>② 도면작성</p>
                <p>③ 증빙자료 등록</p>
                <p style={{ paddingLeft: "12px" }}>▷ 사진 (현장출동사진)</p>
                <p style={{ paddingLeft: "12px" }}>▷ 기타자료</p>
                <p style={{ paddingLeft: "12px" }}>▷ 증빙자료</p>
                <p>④ 견적서 작성</p>
                <p>⑤ 현장출동보고서 (제출)</p>
              </div>

              <div
                style={{
                  borderTop: "1px solid var(--color-table-border)",
                  marginTop: "10px",
                  paddingTop: "10px",
                }}
              >
                <p
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#253396",
                    marginBottom: "6px",
                    letterSpacing: "-0.01em",
                  }}
                >
                  복구 완료 후 자료제출 절차
                </p>
                <div
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "11px",
                    fontWeight: 400,
                    color: "rgba(12, 12, 12, 0.75)",
                    lineHeight: "1.7",
                    letterSpacing: "-0.01em",
                  }}
                >
                  <p>① 증빙자료 등록</p>
                  <p style={{ paddingLeft: "12px" }}>▷ 사진 (수리중 사진, 복구완료 사진)</p>
                  <p style={{ paddingLeft: "12px" }}>▷ 청구자료</p>
                  <p>② 증빙자료 등록 화면의</p>
                  <p>　우측 상단의</p>
                  <p>　(청구자료)제출 버튼 클릭</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User Profile */}
        {user && (
          <button
            onClick={() => setMyPageOpen(true)}
            className="flex items-center gap-3 px-5 py-4 hover:bg-gray-100/50 transition-colors cursor-pointer"
            style={{
              borderTop: "1px solid #E5E7EB",
            }}
            data-testid="button-open-mypage"
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-[#253396]"
              style={{ background: "rgba(37, 51, 150, 0.2)" }}
            >
              {user.name ? user.name.charAt(0) : "U"}
            </div>
            <div className="flex flex-col items-start gap-0.5 min-w-0">
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.8)",
                }}
                data-testid="user-info"
              >
                {user.username}
              </span>
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "12px",
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                  color: "rgba(12, 12, 12, 0.5)",
                }}
                data-testid="user-position"
              >
                {user.position || user.role || "사용자"}
              </span>
            </div>
          </button>
        )}
      </div>

      {user && (
        <MyPageDialog open={myPageOpen} onOpenChange={setMyPageOpen} user={user} />
      )}
    </>
  );
}
