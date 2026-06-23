import { ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { AppSidebarFieldSurvey } from "@/components/app-sidebar-field-survey";
import { CaseReceiptTabs } from "@/components/case-receipt-tabs";
import { isDetachedWindow, isSoloFieldPopup } from "@/lib/detached-window";
import { useIsMobileApp } from "@/hooks/use-mobile-app";

interface FieldSurveyLayoutProps {
  children: ReactNode;
}

export function FieldSurveyLayout({ children }: FieldSurveyLayoutProps) {
  const [location] = useLocation();
  const detached = isDetachedWindow();
  const isMobileApp = useIsMobileApp();
  // 도면작성/증빙자료 "전용" 팝업(아이콘으로 새로 띄운 단독 창)만 좌측 사이드바 전체 제거.
  // 보고서 열람 팝업 안에서 제목 클릭으로 도면/증빙을 열람할 땐 사이드바를 유지하고 내용만 교체.
  const hideSidebar =
    detached &&
    isSoloFieldPopup() &&
    (location.startsWith("/field-survey/drawing") ||
      location.startsWith("/field-survey/documents"));
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

  if (isMobileApp) {
    // 모바일 앱: 사이드바를 상단 바로 올리고 본문을 전체 너비로.
    return (
      <div
        className="bg-white relative overflow-hidden"
        style={{
          height: 'calc(var(--vh, 1vh) * 100)',
          background: 'var(--color-bg)',
        }}
      >
        <div className="relative flex flex-col h-full">
          {!hideSidebar && <AppSidebarFieldSurvey hidePersonal={detached} />}
          <main className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden min-h-0">
            <CaseReceiptTabs />
            {children}
          </main>
        </div>
      </div>
    );
  }

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
        {!hideSidebar && <AppSidebarFieldSurvey hidePersonal={detached} />}
        <main className="flex-1 flex flex-col overflow-y-auto min-h-0">
          <CaseReceiptTabs />
          {children}
        </main>
      </div>
    </div>
  );
}
