import { usePermissions } from "@/hooks/use-permissions";
import { useLocation } from "wouter";
import { useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface ProtectedRouteProps {
  category: string;
  item?: string;
  children: React.ReactNode;
}

const categoryRouteMap: { category: string; path: string }[] = [
  { category: "홈", path: "/dashboard" },
  { category: "종합진행관리", path: "/comprehensive-progress" },
  { category: "새로운접수", path: "/intake" },
  { category: "현장조사", path: "/field-survey/management" },
  { category: "정산 및 통계", path: "/statistics" },
  { category: "관리자 설정", path: "/admin-settings" },
];

const itemRouteMap: { category: string; item: string; path: string }[] = [
  { category: "정산 및 통계", item: "정산조회", path: "/settlements/claim" },
  { category: "정산 및 통계", item: "통계", path: "/statistics/closed" },
];

const SESSION_POLL_INTERVAL = 30000;

export function ProtectedRoute({ category, item, children }: ProtectedRouteProps) {
  const { hasCategory, hasItem, isLoading, user } = usePermissions();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isRedirectingRef = useRef(false);

  const hasAccess = hasCategory(category) && (!item || hasItem(category, item));

  // 세션 폴링: 30초마다 세션 유효성 체크 (중복 로그인 감지)
  useEffect(() => {
    if (!user) return;

    const checkSession = async () => {
      if (isRedirectingRef.current) return;
      try {
        const res = await fetch("/api/check-session", { credentials: "include" });
        const data = await res.json();
        if (!data.authenticated) {
          isRedirectingRef.current = true;
          queryClient.invalidateQueries({ queryKey: ["/api/user"] });
          toast({
            title: "자동 로그아웃",
            description: "다른 기기에서 로그인되어 자동으로 로그아웃됩니다.",
            variant: "destructive",
          });
          setTimeout(() => {
            queryClient.clear();
            setLocation("/");
          }, 1500);
        }
      } catch {
        // 네트워크 오류는 무시
      }
    };

    const interval = setInterval(checkSession, SESSION_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [user, setLocation, toast]);

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      setLocation("/");
      return;
    }

    if (!hasAccess) {
      if (item && hasCategory(category)) {
        const sameCategoryFallback = itemRouteMap.find(
          (r) => r.category === category && r.item !== item && hasItem(category, r.item)
        );
        if (sameCategoryFallback) {
          setLocation(sameCategoryFallback.path);
          return;
        }
      }

      const fallback = categoryRouteMap.find(
        (r) => r.category !== category && hasCategory(r.category)
      );
      if (fallback) {
        setLocation(fallback.path);
      } else {
        setLocation("/forbidden");
      }
      return;
    }
  }, [isLoading, user, category, item, hasAccess, hasCategory, hasItem, setLocation]);

  if (isLoading || !user || !hasAccess) {
    return null;
  }

  return <>{children}</>;
}
