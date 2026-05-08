import { ReactNode } from "react";
import { AppSidebarStatistics } from "@/components/app-sidebar-statistics";

interface StatisticsLayoutProps {
  children: ReactNode;
}

export function StatisticsLayout({ children }: StatisticsLayoutProps) {
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
