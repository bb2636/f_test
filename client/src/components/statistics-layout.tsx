import { ReactNode } from "react";
import { AppSidebarStatistics } from "@/components/app-sidebar-statistics";
import { useIsMobileApp } from "@/hooks/use-mobile-app";

interface StatisticsLayoutProps {
  children: ReactNode;
}

export function StatisticsLayout({ children }: StatisticsLayoutProps) {
  const isMobileApp = useIsMobileApp();

  if (isMobileApp) {
    // 모바일 앱: 사이드바를 상단 바로 올리고 본문을 전체 너비로.
    return (
      <div className="bg-white relative overflow-hidden" style={{ height: "100vh" }}>
        <div className="relative flex flex-col h-full">
          <AppSidebarStatistics />
          <main className="flex-1 overflow-y-auto min-h-0">
            {children}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white relative overflow-hidden" style={{ height: "100vh" }}>
      {/* Main Content: Sidebar(좌) + Main(우) — GlobalHeader 는 사이드바 내부로 이동 */}
      <div className="relative flex h-full">
        <AppSidebarStatistics />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
