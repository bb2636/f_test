import { Suspense, lazy, useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ChevronLeft } from "lucide-react";
import { setFieldSurveyCaseId } from "@/lib/detached-window";
import { MobileModeProvider } from "@/lib/mobile-mode";
import type { User } from "@shared/schema";

const FieldManagement = lazy(() => import("@/pages/field-management"));
const FieldDocuments = lazy(() => import("@/pages/field-documents"));
const FieldEstimate = lazy(() => import("@/pages/field-estimate"));

type DetailTab = "현장입력" | "증빙자료" | "견적서";
const TABS: DetailTab[] = ["현장입력", "증빙자료", "견적서"];

export default function MobileCaseDetail() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/mobile-case/:id");
  const caseId = params?.id ?? "";
  const [activeTab, setActiveTab] = useState<DetailTab>("현장입력");

  // 수행업무(현장입력/증빙자료/견적서 편집)는 협력사 전용.
  // UI 숨김에만 의존하지 않고, URL 직접 접근도 페이지 레벨에서 차단한다.
  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/user"],
  });
  const isPartner = user?.role === "협력사";

  // 모바일 진입 시 대상 케이스 ID 를 필드조사 컨텍스트에 설정 (기존 페이지가 이 값을 읽음)
  useEffect(() => {
    if (caseId) setFieldSurveyCaseId(caseId);
  }, [caseId]);

  // 인증/권한 가드: 비로그인 또는 협력사가 아니면 접근 차단
  useEffect(() => {
    if (userLoading) return;
    if (!user) {
      setLocation("/");
      return;
    }
    if (!isPartner) {
      setLocation("/mobile-home");
    }
  }, [userLoading, user, isPartner, setLocation]);

  if (userLoading || !user || !isPartner) {
    return (
      <div
        className="flex items-center justify-center w-full bg-white"
        style={{ minHeight: "calc(var(--vh, 1vh) * 100)" }}
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className="relative w-full bg-white flex flex-col"
      style={{ minHeight: "calc(var(--vh, 1vh) * 100)" }}
    >
      {/* 상단 바 */}
      <div
        className="flex items-center px-2"
        style={{
          height: "52px",
          borderBottom: "1px solid rgba(12, 12, 12, 0.06)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setLocation("/mobile-home")}
          className="flex items-center justify-center"
          style={{ width: "40px", height: "40px" }}
          data-testid="button-back"
        >
          <ChevronLeft style={{ width: "24px", height: "24px", color: "#0C0C0C" }} />
        </button>
        <span
          style={{
            fontFamily: "Pretendard",
            fontWeight: 600,
            fontSize: "16px",
            letterSpacing: "-0.02em",
            color: "#0C0C0C",
          }}
        >
          수행업무
        </span>
      </div>

      {/* 탭 */}
      <div
        className="flex items-center"
        style={{ height: "44px", flexShrink: 0, borderBottom: "1px solid rgba(12, 12, 12, 0.06)" }}
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 flex justify-center items-center"
            style={{
              height: "44px",
              borderBottom: activeTab === tab ? "2px solid #253396" : "2px solid transparent",
              fontFamily: "Pretendard",
              fontWeight: activeTab === tab ? 600 : 400,
              fontSize: "14px",
              letterSpacing: "-0.01em",
              color: activeTab === tab ? "#0C0C0C" : "rgba(12, 12, 12, 0.5)",
            }}
            data-testid={`tab-detail-${tab}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-auto">
        <MobileModeProvider value={true}>
          <Suspense
            fallback={
              <div className="flex items-center justify-center" style={{ height: "200px" }}>
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            {activeTab === "현장입력" && <FieldManagement />}
            {activeTab === "증빙자료" && <FieldDocuments />}
            {activeTab === "견적서" && (
              <div className="overflow-x-auto">
                <FieldEstimate />
              </div>
            )}
          </Suspense>
        </MobileModeProvider>
      </div>
    </div>
  );
}
