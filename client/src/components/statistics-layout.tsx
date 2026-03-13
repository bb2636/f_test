import { ReactNode } from "react";
import { AppSidebarStatistics } from "@/components/app-sidebar-statistics";
import { GlobalHeader } from "@/components/global-header";

interface StatisticsLayoutProps {
  children: ReactNode;
}

export function StatisticsLayout({ children }: StatisticsLayoutProps) {
  return (
    <div className="min-h-screen bg-white relative overflow-hidden">

      <GlobalHeader />

      {/* Main Content */}
      <div className="relative flex" style={{ height: "calc(100vh - 89px)" }}>
        <AppSidebarStatistics />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
