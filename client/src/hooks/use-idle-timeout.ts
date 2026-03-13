import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

const IDLE_TIMEOUT = 30 * 60 * 1000; // 30분

export function useIdleTimeout() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isLoggedOutRef = useRef(false);

  const logout = useCallback(async () => {
    if (isLoggedOutRef.current) return;
    isLoggedOutRef.current = true;

    try {
      await apiRequest("POST", "/api/logout", {});
    } catch (error) {
      console.error("Logout error:", error);
    }

    queryClient.clear();
    
    toast({
      title: "자동 로그아웃",
      description: "30분 동안 활동이 없어 자동으로 로그아웃되었습니다.",
      variant: "destructive",
    });

    setLocation("/login");
  }, [setLocation, toast]);

  const resetTimer = useCallback(() => {
    if (isLoggedOutRef.current) return;
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      logout();
    }, IDLE_TIMEOUT);
  }, [logout]);

  useEffect(() => {
    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click"];
    
    const handleActivity = () => {
      resetTimer();
    };

    // 초기 타이머 시작
    resetTimer();

    // 이벤트 리스너 등록
    events.forEach((event) => {
      document.addEventListener(event, handleActivity);
    });

    return () => {
      // 클린업
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
    };
  }, [resetTimer]);

  return { resetTimer };
}
