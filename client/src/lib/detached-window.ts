// 별도 브라우저 창(window.open)으로 열린 "분리창"인지 판별한다.
// window.open 시 URL에 detached=1 을 붙여 열고, 최초 진입 시 sessionStorage에 기록해
// 분리창 안에서 다른 경로로 이동(쿼리스트링 유실)해도 분리창 상태가 유지되도록 한다.
// 각 브라우저 창은 별도 JS 컨텍스트라 모듈 캐시도 창 단위로 격리된다.
const DETACHED_KEY = "floxn:detached";
let cached: boolean | null = null;

export function isDetachedWindow(): boolean {
  if (cached !== null) return cached;
  try {
    const fromQuery =
      new URLSearchParams(window.location.search).get("detached") === "1";
    if (fromQuery) {
      sessionStorage.setItem(DETACHED_KEY, "1");
      cached = true;
      return cached;
    }
    cached = sessionStorage.getItem(DETACHED_KEY) === "1";
  } catch {
    cached = false;
  }
  return cached;
}
