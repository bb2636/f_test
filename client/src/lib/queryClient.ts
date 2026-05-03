import { QueryClient, QueryFunction } from "@tanstack/react-query";

// queryClient는 아래에서 정의되므로 여기서는 참조만
let queryClientInstance: QueryClient | null = null;

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 401) {
      const currentPath = window.location.pathname;
      if (currentPath === "/" || currentPath === "/login" || currentPath === "/mobile-login") {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      
      try {
        const resClone = res.clone();
        const errorBody = await resClone.json().catch(() => null);
        
        const isDuplicate = errorBody?.code === "DUPLICATE_LOGIN";
        const message = isDuplicate
          ? "다른 기기에서 로그인되어 현재 세션이 종료되었습니다.\n다시 로그인해 주세요."
          : "세션이 만료되었습니다. 다시 로그인해 주세요.";
        const title = isDuplicate ? "중복 로그인 감지" : "세션 만료";
        
        alert(`[${title}]\n${message}`);
        
        if (queryClientInstance) {
          queryClientInstance.clear();
        }
        window.location.href = "/";
        return;
      } catch {
        if (queryClientInstance) {
          queryClientInstance.clear();
        }
        window.location.href = "/";
        return;
      }
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// [세션 keep-alive] 인증된 API 요청은 사용자 활동 신호로 간주.
// useIdleTimeout이 이 이벤트를 들어 자동 로그아웃 타이머를 리셋함.
// (자동 저장/조회 요청 중에 mouse/keyboard 이벤트 미감지로 인한 부당한 30분 로그아웃 방지)
function notifyUserActivity() {
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("app:user-activity"));
    }
  } catch {
    // ignore
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  if (res.ok) notifyUserActivity();
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    if (res.ok) notifyUserActivity();
    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true, // 창 포커스 시 데이터 새로고침
      staleTime: 30 * 1000, // 30초 후 데이터 stale 처리
      gcTime: 5 * 60 * 1000, // 5분간 캐시 유지
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// queryClient 인스턴스를 throwIfResNotOk에서 사용할 수 있도록 설정
queryClientInstance = queryClient;
