import { ReactNode } from "react";

export interface MobileTab {
  key: string;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}

interface MobileTabNavProps {
  // 최상단 바로가기 탭(상위 메뉴).
  tabs: MobileTab[];
  // 선택된 상위 탭의 하위 항목을 보여주는 두 번째 탭 행(없으면 미표시).
  subTabs?: MobileTab[];
  // 우측 고정 영역(프로필 아바타 등).
  trailing?: ReactNode;
}

// 모바일 앱(WebView) 전용 상단 탭 내비게이션.
// 햄버거 드로어 대신 항상 보이는 가로 스크롤 탭으로 바로가기를 제공한다.
export function MobileTabNav({ tabs, subTabs, trailing }: MobileTabNavProps) {
  return (
    <div
      className="shrink-0"
      style={{ background: "#FFFFFF", borderBottom: "1px solid #E5E7EB", zIndex: 30 }}
    >
      <div className="flex items-center" style={{ minHeight: "52px" }}>
        <div
          className="floxn-hscroll flex-1 min-w-0 flex items-center gap-1.5 px-3 py-2"
          style={{ overflowX: "auto" }}
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={t.onClick}
              disabled={t.disabled}
              className="shrink-0 rounded-full px-4"
              style={{
                height: "36px",
                background: t.active ? "#253396" : "#eff0f5",
                color: t.active ? "#FFFFFF" : "#57677d",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: t.active ? 700 : 500,
                letterSpacing: "-0.02em",
                whiteSpace: "nowrap",
              }}
              data-testid={t.testId}
            >
              {t.label}
            </button>
          ))}
        </div>
        {trailing && <div className="shrink-0 pr-2 pl-1">{trailing}</div>}
      </div>

      {subTabs && subTabs.length > 0 && (
        <div
          className="floxn-hscroll flex items-center gap-1.5 px-3 pb-2"
          style={{ overflowX: "auto", borderTop: "1px solid #F1F2F6" }}
        >
          {subTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={t.onClick}
              disabled={t.disabled}
              className="shrink-0 rounded-md px-3 mt-2"
              style={{
                height: "30px",
                background: t.active ? "rgba(37, 51, 150, 0.1)" : "transparent",
                color: t.disabled
                  ? "rgba(87, 103, 125, 0.5)"
                  : t.active
                    ? "#253396"
                    : "#57677d",
                border: t.active
                  ? "1px solid rgba(37, 51, 150, 0.35)"
                  : "1px solid #E5E7EB",
                fontFamily: "Pretendard",
                fontSize: "13px",
                fontWeight: t.active ? 700 : 500,
                letterSpacing: "-0.02em",
                whiteSpace: "nowrap",
                cursor: t.disabled ? "default" : "pointer",
              }}
              data-testid={t.testId}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
