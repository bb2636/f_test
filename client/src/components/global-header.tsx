import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { User } from "@shared/schema";
import logoIcon from "@assets/Frame 2_1762217940686.png";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { MyPageDialog } from "./my-page-dialog";

export function GlobalHeader() {
  const [, setLocation] = useLocation();
  const [location] = useLocation();
  const { toast } = useToast();
  const { hasCategory, hasItem, isLoading: permissionsLoading } = usePermissions();
  const [myPageOpen, setMyPageOpen] = useState(false);

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/logout", {}),
    onSuccess: () => {
      setLocation("/");
    },
    onError: () => {
      toast({
        title: "로그아웃 실패",
        description: "다시 시도해주세요.",
        variant: "destructive",
      });
    },
  });

  // All possible menu items with their permission categories
  const allMenuItems = [
    { name: "홈", category: "홈" },
    { name: "접수하기", category: "새로운접수" },
    { name: "종합진행관리", category: "종합진행관리" },
    { name: "정산 및 통계", category: "정산 및 통계" },
    { name: "관리자 설정", category: "관리자 설정" },
  ];

  // Filter menu items based on user permissions
  const menuItems = allMenuItems.filter((item) => {
    // Don't show any menu items while loading permissions
    if (permissionsLoading) return false;
    return hasCategory(item.category);
  });

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

  // Check if we're on a mobile route
  const isMobileRoute = location.startsWith("/mobile");

  if (!user) {
    return null;
  }

  // Mobile route: simplified header (logo + profile only, no navigation)
  if (isMobileRoute) {
    return (
      <>
        <header
          className="flex relative w-full bg-white"
          style={{
            borderBottom: "1px solid #E5E7EB",
          }}
        >
          <div
            className="flex items-center justify-between w-full"
            style={{
              height: "58px",
              padding: "0px 20px",
            }}
          >
            {/* Logo */}
            <div
              className="flex items-center gap-2"
              style={{
                filter: "drop-shadow(0px 0px 20px #DBE9F5)",
              }}
            >
              <img
                src={logoIcon}
                alt="FLOXN Logo"
                style={{
                  width: "28px",
                  height: "26px",
                }}
              />
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "18px",
                  fontWeight: 700,
                  color: "#0C0C0C",
                }}
              >
                FLOXN
              </span>
            </div>

            {/* User Profile */}
            <button
              onClick={() => setMyPageOpen(true)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100/50 transition-colors"
              data-testid="button-mobile-profile"
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-[#008FED]"
                style={{ background: "rgba(0, 143, 237, 0.2)" }}
              >
                {user.name ? user.name.charAt(0) : "U"}
              </div>
              <div className="flex items-center gap-1">
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.7)",
                  }}
                >
                  {user.username}
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                    color: "rgba(12, 12, 12, 0.4)",
                  }}
                >
                  {user.position || user.role || "사용자"}
                </span>
              </div>
            </button>
          </div>
        </header>
        <MyPageDialog
          open={myPageOpen}
          onOpenChange={setMyPageOpen}
          user={user}
        />
      </>
    );
  }

  return (
    <>
      {/* Mobile Header (viewport responsive) */}
      <header
        className="lg:hidden flex relative w-full bg-white"
        style={{
          borderBottom: "1px solid #E5E7EB",
        }}
      >
        {/* Logo and User Profile */}
        <div
          className="flex items-center justify-between w-full"
          style={{
            height: "58px",
            padding: "0px 20px",
          }}
        >
          {/* Logo */}
          <div
            className="flex items-center gap-2"
            style={{
              filter: "drop-shadow(0px 0px 20px #DBE9F5)",
            }}
          >
            <img
              src={logoIcon}
              alt="FLOXN Logo"
              style={{
                width: "28px",
                height: "26px",
              }}
            />
            <span
              style={{
                fontFamily: "Pretendard",
                fontSize: "18px",
                fontWeight: 700,
                color: "#0C0C0C",
              }}
            >
              FLOXN
            </span>
          </div>

          {/* User Profile */}
          <button
            onClick={() => setMyPageOpen(true)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100/50 transition-colors"
            data-testid="button-mobile-profile"
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-[#008FED]"
              style={{ background: "rgba(0, 143, 237, 0.2)" }}
            >
              {user.name ? user.name.charAt(0) : "U"}
            </div>
            <div className="flex items-center gap-1">
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.7)",
                }}
              >
                {user.username}
              </span>
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                  color: "rgba(12, 12, 12, 0.4)",
                }}
              >
                {user.position || user.role || "사용자"}
              </span>
            </div>
          </button>
        </div>
      </header>

      {/* Desktop Header */}
      <header
        className="hidden lg:flex relative w-full h-[89px] pl-20 items-center justify-between bg-white"
        style={{
          borderBottom: "1px solid #E5E7EB",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 w-[240px] ml-24">
          <img src={logoIcon} alt="FLOXN Logo" className="w-6 h-6" />
          <div className="text-2xl font-bold text-gray-900">FLOXN</div>
        </div>

        {/* Navigation Menu */}
        <div className="flex items-center gap-6 flex-1 px-4">
          {menuItems.map((item) => {
            return (
              <button
                key={item.name}
                type="button"
                onClick={() => {
                  if (item.name === "홈") {
                    setLocation("/dashboard");
                  } else if (item.name === "접수하기") {
                    setLocation("/intake");
                  } else if (item.name === "종합진행관리") {
                    setLocation("/comprehensive-progress");
                  } else if (item.name === "관리자 설정") {
                    setLocation("/admin-settings");
                  } else if (item.name === "정산 및 통계") {
                    if (hasItem("정산 및 통계", "정산조회")) {
                      setLocation("/settlements/claim");
                    } else if (hasItem("정산 및 통계", "통계")) {
                      setLocation("/statistics/closed");
                    }
                  }
                }}
                className="px-6 py-3 rounded-lg transition-colors"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "18px",
                  fontWeight: activeMenu === item.name ? 600 : 500,
                  letterSpacing: "-0.02em",
                  color:
                    activeMenu === item.name
                      ? "#0C0C0C"
                      : "rgba(12, 12, 12, 0.5)",
                }}
                data-testid={`menu-${item.name}`}
              >
                {item.name}
              </button>
            );
          })}
        </div>

        {/* User Profile - Clickable */}
        <button
          onClick={() => setMyPageOpen(true)}
          className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100/50 transition-colors cursor-pointer"
          data-testid="button-open-mypage"
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-[#008FED]"
            style={{ background: "rgba(0, 143, 237, 0.2)" }}
          >
            {user.name ? user.name.charAt(0) : "U"}
          </div>
          <div className="flex items-center gap-2">
            <span
              style={{
                fontFamily: "Pretendard",
                fontSize: "15px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "rgba(12, 12, 12, 0.7)",
              }}
              data-testid="user-info"
            >
              {user.username}
            </span>
            <span
              style={{
                fontFamily: "Pretendard",
                fontSize: "15px",
                fontWeight: 500,
                letterSpacing: "-0.01em",
                color: "rgba(12, 12, 12, 0.4)",
              }}
              data-testid="user-position"
            >
              {user.position || user.role || "사용자"}
            </span>
          </div>
        </button>
      </header>

      {/* My Page Dialog */}
      <MyPageDialog
        open={myPageOpen}
        onOpenChange={setMyPageOpen}
        user={user}
      />
    </>
  );
}
