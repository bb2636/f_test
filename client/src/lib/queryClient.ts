import { QueryClient, QueryFunction } from "@tanstack/react-query";

// queryClient는 아래에서 정의되므로 여기서는 참조만
let queryClientInstance: QueryClient | null = null;

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    // 401 에러 발생 시 세션 체크 (중복 로그인 감지)
    if (res.status === 401) {
      // 로그인 페이지에서는 401 에러를 무시 (무한 리다이렉트 방지)
      const currentPath = window.location.pathname;
      if (currentPath === "/" || currentPath === "/login" || currentPath === "/mobile-login") {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      
      try {
        const checkRes = await fetch("/api/check-session", { credentials: "include" });
        const checkData = await checkRes.json();
        if (!checkData.authenticated) {
          // 세션이 무효화되었으면 로그아웃 처리
          if (queryClientInstance) {
            queryClientInstance.clear();
          }
          window.location.href = "/";
          return;
        }
      } catch {
        // check-session 실패 시에도 로그아웃 (단, 로그인 페이지가 아닐 때만)
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
