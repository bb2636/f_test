import { useLocation } from "wouter";
import { ChevronDown } from "lucide-react";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { User } from "@shared/schema";
import logoIcon from "@assets/logo-frame.svg";
import { usePermissions } from "@/hooks/use-permissions";
import { MyPageDialog } from "./my-page-dialog";

interface MenuItem {
  title: string;
  url?: string;
  testId: string;
  permissionItem?: string;
  children?: { title: string; url: string; testId: string }[];
}

const allMenuItems: MenuItem[] = [
  {
    title: "정산 조회",
    testId: "submenu-settlement-inquiry",
    permissionItem: "정산조회",
    children: [
      {
        title: "정산 청구",
        url: "/settlements/claim",
        testId: "submenu-settlement-claim",
      },
      {
        title: "정산 종결",
        url: "/settlements/closed",
        testId: "submenu-settlement-closed",
      },
      {
        title: "접수취소",
        url: "/settlements/cancelled",
        testId: "submenu-settlement-cancelled",
      },
    ],
  },
  {
    title: "통계",
    testId: "submenu-statistics",
    permissionItem: "통계",
    children: [
      {
        title: "종결건 통계",
        url: "/statistics/closed",
        testId: "submenu-statistics-closed",
      },
      {
        title: "미결건 통계",
        url: "/statistics/unsettled",
        testId: "submenu-statistics-unsettled",
      },
    ],
  },
];

// GlobalHeader 상단 메뉴 (구조/이름/카테고리 그대로 유지)
const topLevelMenu = [
  { name: "홈", category: "홈" },
  { name: "접수하기", category: "새로운접수" },
  { name: "종합진행관리", category: "종합진행관리" },
  { name: "정산 및 통계", category: "정산 및 통계" },
  { name: "관리자 설정", category: "관리자 설정" },
];

export function AppSidebarStatistics() {
  const [location, setLocation] = useLocation();
  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(new Set(["정산 조회", "통계"]));
  const { hasCategory, hasItem, isLoading: permissionsLoading, permissions } = usePermissions();
  const [myPageOpen, setMyPageOpen] = useState(false);

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const menuItems = useMemo(() => {
    return allMenuItems.filter((item) => {
      if (!item.permissionItem) return true;
      return hasItem("정산 및 통계", item.permissionItem);
    });
  }, [permissions, hasItem]);

  // GlobalHeader 와 동일한 권한 필터
  const topMenu = topLevelMenu.filter((item) => {
    if (permissionsLoading) return false;
    return hasCategory(item.category);
  });

  // GlobalHeader 와 동일한 활성 판정
  const getActiveMenu = () => {
    if (location === "/dashboard" || location === "/mobile-home") return "홈";
    if (location === "/intake") return "접수하기";
    if (location === "/comprehensive-progress") return "종합진행관리";
    if (
      location.startsWith("/statistics") ||
      location.startsWith("/settlements")
    )
      return "정산 및 통계";
    if (location === "/admin-settings") return "관리자 설정";
    return "";
  };
  const activeMenu = getActiveMenu();

  const handleTopMenuClick = (name: string) => {
    if (name === "홈") {
      setLocation("/dashboard");
    } else if (name === "접수하기") {
      // 새 접수 시작: 이전 "이어서 작성하기" 잔여 editCaseId 정리
      localStorage.removeItem("editCaseId");
      setLocation("/intake");
    } else if (name === "종합진행관리") {
      setLocation("/comprehensive-progress");
    } else if (name === "관리자 설정") {
      setLocation("/admin-settings");
    } else if (name === "정산 및 통계") {
      if (hasItem("정산 및 통계", "정산조회")) {
        setLocation("/settlements/claim");
      } else if (hasItem("정산 및 통계", "통계")) {
        setLocation("/statistics/closed");
      }
    }
  };

  const toggleMenu = (title: string) => {
    setExpandedMenus(prev => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  return (
    <>
      <div
        className="flex flex-col"
        style={{
          width: "260px",
          background: "#eff0f5",
          borderRight: "1px solid #E5E7EB",
          height: "100vh",
        }}
      >
        {/* Logo (GlobalHeader 에서 이동) */}
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

        {/* Top-level Navigation (GlobalHeader 에서 이동) — '정산 및 통계' 활성 시 그 아래에 서브메뉴 중첩 표시 */}
        <div className="flex flex-col gap-1 px-3 pt-3 flex-1 overflow-y-auto">
          {topMenu.map((item) => {
            const isActive = activeMenu === item.name;
            return (
              <div key={item.name}>
                <button
                  type="button"
                  onClick={() => handleTopMenuClick(item.name)}
                  className="flex items-center px-5 py-3 rounded-lg transition-colors text-left w-full"
                  style={{
                    background: isActive ? "#253297" : "transparent",
                    fontFamily: "Pretendard",
                    fontSize: "15px",
                    fontWeight: isActive ? 600 : 500,
                    letterSpacing: "-0.02em",
                    color: isActive ? "#FFFFFF" : "#57677d",
                  }}
                  data-testid={`menu-${item.name}`}
                >
                  {item.name}
                </button>

                {/* '정산 및 통계' 활성일 때만 그 아래에 서브메뉴(정산 조회/통계) 중첩 표시 */}
                {item.name === "정산 및 통계" && isActive && (
                  <div className="flex flex-col gap-1 ml-2 mt-1">
                    {menuItems.map((sub) => {
                      if (sub.children) {
                        const isExpanded = expandedMenus.has(sub.title);
                        const isChildActive = sub.children.some(child => location === child.url || (child.url === "/statistics/closed" && location === "/statistics"));
                        return (
                          <div key={sub.title}>
                            <button
                              onClick={() => toggleMenu(sub.title)}
                              className="flex items-center justify-between w-full px-5 py-3 rounded-lg transition-colors"
                              style={{
                                background: isChildActive ? "#253297" : "transparent",
                                fontFamily: "Pretendard",
                                fontSize: "16px",
                                fontWeight: isChildActive ? 700 : 500,
                                letterSpacing: "-0.02em",
                                color: isChildActive ? "#FFFFFF" : "#57677d",
                              }}
                              data-testid={sub.testId}
                            >
                              <span>{sub.title}</span>
                              <ChevronDown
                                className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                style={{ color: isChildActive ? "#FFFFFF" : "#57677d" }}
                              />
                            </button>
                            {isExpanded && (
                              <div className="flex flex-col gap-0.5 ml-4 mt-0.5">
                                {sub.children.map((child) => (
                                  <button
                                    key={child.title}
                                    onClick={() => setLocation(child.url)}
                                    className="flex items-center px-4 py-2.5 rounded-lg transition-colors text-left"
                                    style={{
                                      background: (location === child.url || (child.url === "/statistics/closed" && location === "/statistics")) ? "#253297" : "transparent",
                                      fontFamily: "Pretendard",
                                      fontSize: "14px",
                                      fontWeight: (location === child.url || (child.url === "/statistics/closed" && location === "/statistics")) ? 700 : 400,
                                      letterSpacing: "-0.02em",
                                      color: (location === child.url || (child.url === "/statistics/closed" && location === "/statistics")) ? "#FFFFFF" : "#57677d",
                                    }}
                                    data-testid={child.testId}
                                  >
                                    <span style={{ marginRight: "6px", color: (location === child.url || (child.url === "/statistics/closed" && location === "/statistics")) ? "#FFFFFF" : "#57677d" }}>•</span>
                                    {child.title}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }
                      return (
                        <button
                          key={sub.title}
                          onClick={() => sub.url && setLocation(sub.url)}
                          className="flex items-center px-5 py-3 rounded-lg transition-colors"
                          style={{
                            background: location === sub.url ? "#253297" : "transparent",
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: location === sub.url ? 700 : 500,
                            letterSpacing: "-0.02em",
                            color: location === sub.url ? "#FFFFFF" : "#57677d",
                          }}
                          data-testid={sub.testId}
                        >
                          {sub.title}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* User Profile (GlobalHeader 에서 이동) */}
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
              className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-[#008FED]"
              style={{ background: "rgba(0, 143, 237, 0.2)" }}
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
                  color: "#57677d",
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
                  color: "rgba(87, 103, 125, 0.6)",
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
        <MyPageDialog
          open={myPageOpen}
          onOpenChange={setMyPageOpen}
          user={user}
        />
      )}
    </>
  );
}
