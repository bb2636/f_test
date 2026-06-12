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

// 도면작성/증빙자료 "전용" 팝업(사이드바 팝업 아이콘으로 새로 띄운 단독 창)인지 판별.
// 이 경우에만 좌측 사이드바를 전체 제거한다. 보고서 열람 팝업 안에서 제목 클릭으로
// 도면/증빙으로 이동하는 경우(solo 아님)는 보고서 팝업 사이드바를 그대로 유지한다.
const SOLO_KEY = "floxn:soloFieldPopup";
let soloCached: boolean | null = null;

export function isSoloFieldPopup(): boolean {
  if (soloCached !== null) return soloCached;
  try {
    const fromQuery =
      new URLSearchParams(window.location.search).get("solo") === "1";
    if (fromQuery) {
      sessionStorage.setItem(SOLO_KEY, "1");
      soloCached = true;
      return soloCached;
    }
    soloCached = sessionStorage.getItem(SOLO_KEY) === "1";
  } catch {
    soloCached = false;
  }
  return soloCached;
}
