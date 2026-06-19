import { ReactNode, useState } from "react";
import { Menu, X } from "lucide-react";
import logoIcon from "@assets/logo-frame.svg";

interface MobileNavShellProps {
  // 햄버거 메뉴를 열었을 때 보일 내비게이션 본문.
  // close() 를 호출하면 패널이 닫힌다(메뉴 항목 선택 시 호출).
  render: (close: () => void) => ReactNode;
}

// 모바일 앱(WebView) 전용 상단바 + 슬라이드 메뉴 껍데기.
// 좌측 고정 사이드바 대신 상단에 로고 + 햄버거 버튼을 두고,
// 누르면 전체 너비 패널로 내비게이션이 펼쳐진다.
export function MobileNavShell({ render }: MobileNavShellProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="relative shrink-0" style={{ zIndex: 50 }}>
      {/* 상단바 */}
      <div
        className="flex items-center justify-between px-4"
        style={{
          height: "56px",
          background: "#FFFFFF",
          borderBottom: "1px solid #E5E7EB",
        }}
      >
        <div className="flex items-center gap-2">
          <img src={logoIcon} alt="FLOXN" className="w-6 h-6" />
          <span className="text-xl font-bold" style={{ color: "#0C0C0C" }}>
            FLOXN
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-center"
          style={{ width: "40px", height: "40px", color: "#253396" }}
          aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
          data-testid="button-mobile-menu"
        >
          {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* 오버레이 + 슬라이드 패널 */}
      {open && (
        <>
          <div
            className="fixed left-0 right-0 bottom-0"
            style={{
              top: "56px",
              background: "rgba(0, 0, 0, 0.35)",
              zIndex: 40,
            }}
            onClick={close}
            data-testid="overlay-mobile-menu"
          />
          <div
            className="absolute left-0 right-0 overflow-y-auto"
            style={{
              top: "56px",
              maxHeight: "calc(100vh - 56px)",
              background: "#FFFFFF",
              borderBottom: "1px solid #E5E7EB",
              boxShadow: "0 12px 24px rgba(0, 0, 0, 0.12)",
              zIndex: 50,
            }}
            data-testid="panel-mobile-menu"
          >
            {render(close)}
          </div>
        </>
      )}
    </div>
  );
}
