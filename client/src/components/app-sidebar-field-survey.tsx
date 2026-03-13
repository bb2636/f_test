import { useLocation } from "wouter";
import { usePermissions } from "@/hooks/use-permissions";

const menuItems = [
  {
    title: "현장입력",
    url: "/field-survey/management",
    testId: "submenu-field-management",
    permissionItem: "현장입력",
  },
  {
    title: "도면작성",
    url: "/field-survey/drawing",
    testId: "submenu-drawing",
    permissionItem: "도면작성",
  },
  {
    title: "증빙자료 등록",
    url: "/field-survey/documents",
    testId: "submenu-documents",
    permissionItem: "증빙자료 업로드",
  },
  {
    title: "견적서 작성",
    url: "/field-survey/estimate",
    testId: "submenu-estimate",
    permissionItem: "견적서 작성",
  },
  {
    title: "현장출동보고서",
    url: "/field-survey/report",
    testId: "submenu-report",
    permissionItem: "보고서 작성",
  },
];

export function AppSidebarFieldSurvey() {
  const [location, setLocation] = useLocation();
  const { hasItem, hasCategory, isAdmin, isLoading, user } = usePermissions();

  const visibleItems = menuItems.filter((item) => {
    if (isLoading) return false;
    if (isAdmin) {
      return hasItem("현장조사", item.permissionItem);
    }
    if (!hasCategory("현장조사")) return false;
    return hasItem("현장조사", item.permissionItem);
  });

  const isPartner = user?.role === "협력사";

  return (
    <div
      className="flex flex-col"
      style={{
        width: "260px",
        background: "rgba(255, 255, 255, 0.06)",
        borderRight: "1px solid rgba(0, 143, 237, 0.2)",
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
          현장조사
        </span>
      </div>

      <div className="flex flex-col px-3 gap-2">
        {visibleItems.map((item) => (
          <button
            type="button"
            key={item.title}
            onClick={() => setLocation(item.url)}
            className="flex items-center px-5 py-3 rounded-lg transition-colors"
            style={{
              background:
                location === item.url
                  ? "rgba(12, 12, 12, 0.08)"
                  : "transparent",
              fontFamily: "Pretendard",
              fontSize: "16px",
              fontWeight: location === item.url ? 700 : 500,
              letterSpacing: "-0.02em",
              color:
                location === item.url
                  ? "#008FED"
                  : "rgba(12, 12, 12, 0.8)",
            }}
            data-testid={item.testId}
          >
            {item.title}
          </button>
        ))}
      </div>

      {isPartner && (
        <div
          className="mx-3 mt-4 rounded-lg p-4"
          style={{
            background: "rgba(0, 143, 237, 0.06)",
            border: "1px solid rgba(0, 143, 237, 0.2)",
          }}
        >
          <p
            style={{
              fontFamily: "Pretendard",
              fontSize: "12px",
              fontWeight: 700,
              color: "#008FED",
              marginBottom: "6px",
              letterSpacing: "-0.01em",
            }}
          >
            현장출동보고서 절차
          </p>
          <div
            style={{
              fontFamily: "Pretendard",
              fontSize: "11px",
              fontWeight: 400,
              color: "rgba(12, 12, 12, 0.75)",
              lineHeight: "1.7",
              letterSpacing: "-0.01em",
            }}
          >
            <p>① 현장입력</p>
            <p>② 도면작성</p>
            <p>③ 증빙자료 등록</p>
            <p style={{ paddingLeft: "12px" }}>▷ 사진 (현장출동사진)</p>
            <p style={{ paddingLeft: "12px" }}>▷ 기타자료</p>
            <p style={{ paddingLeft: "12px" }}>▷ 증빙자료</p>
            <p>④ 견적서 작성</p>
            <p>⑤ 현장출동보고서 (제출)</p>
          </div>

          <div
            style={{
              borderTop: "1px solid rgba(0, 143, 237, 0.2)",
              marginTop: "10px",
              paddingTop: "10px",
            }}
          >
            <p
              style={{
                fontFamily: "Pretendard",
                fontSize: "12px",
                fontWeight: 700,
                color: "#008FED",
                marginBottom: "6px",
                letterSpacing: "-0.01em",
              }}
            >
              복구 완료 후 자료제출 절차
            </p>
            <div
              style={{
                fontFamily: "Pretendard",
                fontSize: "11px",
                fontWeight: 400,
                color: "rgba(12, 12, 12, 0.75)",
                lineHeight: "1.7",
                letterSpacing: "-0.01em",
              }}
            >
              <p>① 증빙자료 등록</p>
              <p style={{ paddingLeft: "12px" }}>▷ 사진 (수리중 사진, 복구완료 사진)</p>
              <p style={{ paddingLeft: "12px" }}>▷ 청구자료</p>
              <p>② 증빙자료 등록 화면의</p>
              <p>　우측 상단의</p>
              <p>　(청구자료)제출 버튼 클릭</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
