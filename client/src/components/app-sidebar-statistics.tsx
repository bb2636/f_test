import { useLocation } from "wouter";
import { ChevronDown } from "lucide-react";
import { useState, useMemo } from "react";
import { usePermissions } from "@/hooks/use-permissions";

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

export function AppSidebarStatistics() {
  const [location, setLocation] = useLocation();
  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(new Set(["정산 조회", "통계"]));
  const { hasItem, isAdmin, permissions } = usePermissions();

  const menuItems = useMemo(() => {
    return allMenuItems.filter((item) => {
      if (!item.permissionItem) return true;
      return hasItem("정산 및 통계", item.permissionItem);
    });
  }, [permissions, hasItem]);

  const isSettlementActive = location.startsWith("/settlements");

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
    <div
      className="flex flex-col bg-white"
      style={{
        width: "260px",
        borderRight: "1px solid #E5E7EB",
      }}
    >
      <div className="px-8 py-4">
        <span
          style={{
            fontFamily: "Pretendard",
            fontSize: "15px",
            fontWeight: 500,
            letterSpacing: "-0.01em",
            color: "rgba(12, 12, 12, 0.5)",
          }}
        >
          정산 및 통계
        </span>
      </div>
      <div className="flex flex-col px-3 gap-1">
        {menuItems.map((item) => {
          if (item.children) {
            const isExpanded = expandedMenus.has(item.title);
            const isChildActive = item.children.some(child => location === child.url || (child.url === "/statistics/closed" && location === "/statistics"));
            return (
              <div key={item.title}>
                <button
                  onClick={() => toggleMenu(item.title)}
                  className="flex items-center justify-between w-full px-5 py-3 rounded-lg transition-colors"
                  style={{
                    background: isChildActive ? "rgba(12, 12, 12, 0.04)" : "transparent",
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: isChildActive ? 700 : 500,
                    letterSpacing: "-0.02em",
                    color: isChildActive ? "#008FED" : "rgba(12, 12, 12, 0.8)",
                  }}
                  data-testid={item.testId}
                >
                  <span>{item.title}</span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    style={{ color: isChildActive ? "#008FED" : "rgba(12, 12, 12, 0.4)" }}
                  />
                </button>
                {isExpanded && (
                  <div className="flex flex-col gap-0.5 ml-4 mt-0.5">
                    {item.children.map((child) => (
                      <button
                        key={child.title}
                        onClick={() => setLocation(child.url)}
                        className="flex items-center px-4 py-2.5 rounded-lg transition-colors text-left"
                        style={{
                          background: (location === child.url || (child.url === "/statistics/closed" && location === "/statistics")) ? "rgba(12, 12, 12, 0.08)" : "transparent",
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: (location === child.url || (child.url === "/statistics/closed" && location === "/statistics")) ? 700 : 400,
                          letterSpacing: "-0.02em",
                          color: (location === child.url || (child.url === "/statistics/closed" && location === "/statistics")) ? "#008FED" : "rgba(12, 12, 12, 0.65)",
                        }}
                        data-testid={child.testId}
                      >
                        <span style={{ marginRight: "6px", color: (location === child.url || (child.url === "/statistics/closed" && location === "/statistics")) ? "#008FED" : "rgba(12, 12, 12, 0.3)" }}>•</span>
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
              key={item.title}
              onClick={() => item.url && setLocation(item.url)}
              className="flex items-center px-5 py-3 rounded-lg transition-colors"
              style={{
                background: location === item.url ? "rgba(12, 12, 12, 0.08)" : "transparent",
                fontFamily: "Pretendard",
                fontSize: "16px",
                fontWeight: location === item.url ? 700 : 500,
                letterSpacing: "-0.02em",
                color: location === item.url ? "#008FED" : "rgba(12, 12, 12, 0.8)",
              }}
              data-testid={item.testId}
            >
              {item.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}
