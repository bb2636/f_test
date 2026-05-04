import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

const IDLE_TIMEOUT = 30 * 60 * 1000; // 30분

// [멀티탭 동기화] 같은 사이트를 여러 탭에 열어두고 한 탭에서만 작업하더라도
// 비활성 탭의 idle 타이머가 만료되어 전체 세션이 끊기던 문제를 해결.
// 어느 한 탭에서 활동이 발생하면 다른 탭에도 신호를 전파해 함께 타이머를 리셋.
const BC_NAME = "floxn-session-activity";
const LS_KEY = "floxn:session-activity";
const LS_LOGOUT_KEY = "floxn:session-logout";
const BROADCAST_THROTTLE = 5000; // 5초: 폭주 방지(매 마우스 무브마다 broadcast 안 함)

type ChannelMessage =
  | { type: "activity"; t: number }
  | { type: "logout"; t: number };

export function useIdleTimeout() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isLoggedOutRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastBroadcastRef = useRef(0);

  const broadcastActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastBroadcastRef.current < BROADCAST_THROTTLE) return;
    lastBroadcastRef.current = now;

    try {
      channelRef.current?.postMessage({ type: "activity", t: now } satisfies ChannelMessage);
    } catch {
      // ignore
    }
    // localStorage fallback (BroadcastChannel 미지원 브라우저용)
    try {
      localStorage.setItem(LS_KEY, String(now));
    } catch {
      // ignore (시크릿 모드 등)
    }
  }, []);

  const logout = useCallback(async () => {
    if (isLoggedOutRef.current) return;
    isLoggedOutRef.current = true;

    // 다른 탭에도 즉시 로그아웃 알림 (서버 401 기다리지 않고 동기화)
    try {
      channelRef.current?.postMessage({ type: "logout", t: Date.now() } satisfies ChannelMessage);
    } catch {
      // ignore
    }
    try {
      localStorage.setItem(LS_LOGOUT_KEY, String(Date.now()));
    } catch {
      // ignore
    }

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

  // 다른 탭에서 로그아웃 신호 받았을 때: 본 탭은 서버 호출 없이 즉시 정리
  const handleRemoteLogout = useCallback(() => {
    if (isLoggedOutRef.current) return;
    isLoggedOutRef.current = true;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    queryClient.clear();

    toast({
      title: "세션 종료",
      description: "다른 탭에서 로그아웃되어 이 탭도 종료됩니다.",
      variant: "destructive",
    });

    setLocation("/login");
  }, [setLocation, toast]);

  // resetTimer: 본인 탭 타이머 리셋. fromBroadcast=true면 다른 탭에 재전파하지 않음(무한 루프 방지).
  const resetTimer = useCallback(
    (opts?: { fromBroadcast?: boolean }) => {
      if (isLoggedOutRef.current) return;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        logout();
      }, IDLE_TIMEOUT);

      if (!opts?.fromBroadcast) {
        broadcastActivity();
      }
    },
    [logout, broadcastActivity],
  );

  useEffect(() => {
    // BroadcastChannel 초기화 (지원 브라우저)
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(BC_NAME);
        channelRef.current = channel;
        channel.onmessage = (e: MessageEvent<ChannelMessage>) => {
          const msg = e?.data;
          if (!msg || typeof msg !== "object") return;
          if (msg.type === "activity") {
            resetTimer({ fromBroadcast: true });
          } else if (msg.type === "logout") {
            handleRemoteLogout();
          }
        };
      }
    } catch {
      // ignore
    }

    // localStorage storage 이벤트 fallback (다른 탭에서 setItem 시 트리거)
    const handleStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY) {
        resetTimer({ fromBroadcast: true });
      } else if (e.key === LS_LOGOUT_KEY) {
        handleRemoteLogout();
      }
    };
    window.addEventListener("storage", handleStorage);

    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click"];

    const handleActivity = () => {
      resetTimer();
    };

    // 초기 타이머 시작
    resetTimer();

    // 이벤트 리스너 등록 (capture: true → 모달/dialog 안에서도 캐치)
    events.forEach((event) => {
      document.addEventListener(event, handleActivity, true);
    });

    // [세션 keep-alive] API 요청도 활동으로 간주 (queryClient apiRequest/getQueryFn에서 dispatch).
    // 자동 저장/조회 중 마우스·키보드 이벤트가 잡히지 않아도 30분 idle 오판 방지.
    window.addEventListener("app:user-activity", handleActivity);

    // 다른 탭/창에서 돌아왔을 때도 활동으로 간주
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        resetTimer();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      // 클린업
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity, true);
      });
      window.removeEventListener("app:user-activity", handleActivity);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("storage", handleStorage);
      try {
        channel?.close();
      } catch {
        // ignore
      }
      channelRef.current = null;
    };
  }, [resetTimer, handleRemoteLogout]);

  return { resetTimer };
}
