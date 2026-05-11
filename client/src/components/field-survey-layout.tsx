import { ReactNode, useEffect } from "react";
import { AppSidebarFieldSurvey } from "@/components/app-sidebar-field-survey";

interface FieldSurveyLayoutProps {
  children: ReactNode;
}

export function FieldSurveyLayout({ children }: FieldSurveyLayoutProps) {
  // 모바일 viewport 높이를 CSS 변수로 설정 (초기 설정만)
  useEffect(() => {
    const setVh = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };

    setVh();

    let resizeTimeout: NodeJS.Timeout;
    const handleResize = () => {
      const activeElement = document.activeElement;
      if (activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(setVh, 300);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(resizeTimeout);
    };
  }, []);

  return (
    <div
      className="bg-white relative overflow-hidden"
      style={{
        height: 'calc(var(--vh, 1vh) * 100)',
        background: 'var(--color-bg)',
      }}
    >
      {/* Main Content: Sidebar(좌) + Main(우) — GlobalHeader 는 사이드바 내부로 이동 */}
      <div className="relative flex h-full">
        <AppSidebarFieldSurvey />
        <main className="flex-1 flex flex-col overflow-y-auto min-h-0">
          {children}
        </main>
      </div>
    </div>
  );
}
