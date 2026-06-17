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

// 보고서 분리창의 "현재 보는 건"은 창 단위로만 관리한다(공유 localStorage 금지).
//   localStorage.setItem은 같은 origin의 다른 창 전체에 storage 이벤트를 발생시켜
//   내용이 동기화돼 버린다(다른 건으로 새 팝업을 열면 여는 쪽이 localStorage를 덮어써
//   기존 팝업까지 따라 바뀜). 그래서 분리창에서는 sessionStorage(창 단위)에 저장하고
//   같은 창 안에서만 전파되는 CustomEvent로 컴포넌트 간 동기화한다(창 간 누수 없음).
export const REPORT_DETACHED_KEY = "floxn:reportDetached";
export const REPORT_CASEID_KEY = "floxn:reportCaseId";
export const REPORT_CASE_CHANGE_EVENT = "floxn:reportCaseChange";

export function getDetachedReportCaseId(): string {
  try {
    const v = sessionStorage.getItem(REPORT_CASEID_KEY);
    return v && v !== "null" && v !== "undefined" ? v : "";
  } catch {
    return "";
  }
}

// 분리창 안에서 보는 건을 바꾼다 — sessionStorage에 고정 + 같은 창에만 CustomEvent 전파.
// localStorage는 절대 건드리지 않는다(다른 창으로 새어나감).
export function setDetachedReportCaseId(caseId: string): void {
  try {
    sessionStorage.setItem(REPORT_CASEID_KEY, caseId);
  } catch {}
  try {
    window.dispatchEvent(
      new CustomEvent(REPORT_CASE_CHANGE_EVENT, { detail: caseId }),
    );
  } catch {}
}

// 보고서 열람 팝업 열기 — 건별로 분리된 창으로 띄운다.
// 핵심: 창 이름을 건별로 유니크하게 줘서 다른 건은 새 창으로 열리고,
//   같은 건을 다시 열면 기존 창을 그대로 포커스한다(중복 방지).
// 또한 window.open에 위치를 지정하지 않으면 브라우저가 매번 같은 자리에 새 창을
//   겹쳐 띄워(별도 창이지만) 앞 창을 완전히 가려 "내용이 바뀐 것처럼" 보인다.
//   → 열 때마다 위치를 계단식으로 어긋나게 해 시각적으로도 분리되게 한다.
const REPORT_WIN_W = 1500;
const REPORT_WIN_H = 920;
const REPORT_CASCADE_STEP = 36; // 창마다 어긋나는 픽셀
const REPORT_CASCADE_MAX = 8; // 이 횟수 후 처음 위치로 순환
const openReportWindows = new Map<string, Window>();
let reportCascadeIndex = 0;

export function openReportWindow(
  caseId: string,
  from?: string,
): Window | null {
  const name = `reportViewer-${caseId}`;

  // 이미 같은 건의 창이 열려 있으면 새로 열지 않고 그 창을 포커스한다.
  const existing = openReportWindows.get(name);
  if (existing && !existing.closed) {
    existing.focus();
    return existing;
  }

  // 화면 중앙을 기준으로 열 때마다 조금씩 어긋나게 한다(화면 밖으로 나가지 않도록 클램프).
  const offset = (reportCascadeIndex % REPORT_CASCADE_MAX) * REPORT_CASCADE_STEP;
  reportCascadeIndex += 1;
  const availW = window.screen?.availWidth ?? REPORT_WIN_W;
  const availH = window.screen?.availHeight ?? REPORT_WIN_H;
  const baseLeft = Math.max(0, Math.round((availW - REPORT_WIN_W) / 2));
  const baseTop = Math.max(0, Math.round((availH - REPORT_WIN_H) / 2));
  const left = Math.max(0, Math.min(baseLeft + offset, availW - REPORT_WIN_W));
  const top = Math.max(0, Math.min(baseTop + offset, availH - REPORT_WIN_H));

  const fromParam = from ? `&from=${from}` : "";
  const win = window.open(
    `/field-survey/report?detached=1&caseId=${caseId}${fromParam}`,
    name,
    `width=${REPORT_WIN_W},height=${REPORT_WIN_H},left=${left},top=${top}`,
  );
  if (win) openReportWindows.set(name, win);
  return win;
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

// "보고서 열람 분리창"인지 단일 판정 — 탭(전환을 쏘는 쪽)과 보고서 본문(전환을 받는 쪽)이
// 같은 기준으로 판단해야 한다. 둘이 다른 신호(서로 다른 sessionStorage 키, 한쪽만 solo 고려)를
// 쓰면 한쪽은 CustomEvent로 쏘고 다른 쪽은 localStorage만 보고 있어 전환이 먹지 않는다.
// 규칙:
//  1) 분리창이 아니면(인앱) false → 인앱은 공유 localStorage로 동기화.
//  2) 라우트가 /field-survey/report 면 무조건 true(보고서 본문이 뜨는 창).
//     solo 플래그가 sessionStorage 복사로 새어들어와도 라우트가 우선.
//  3) 보고서 단독팝업(solo)은 false → 도면/증빙 solo는 인앱과 동일하게 localStorage 공유.
//  4) 보고서 창 안에서 도면/증빙으로 잠깐 이동한 경우(비solo)는 REPORT 한정 sticky로 유지.
export function isDetachedReportWindow(): boolean {
  if (!isDetachedWindow()) return false;
  try {
    if (window.location.pathname.includes("/field-survey/report")) return true;
  } catch {}
  if (isSoloFieldPopup()) return false;
  try {
    return sessionStorage.getItem(REPORT_DETACHED_KEY) === "1";
  } catch {
    return false;
  }
}
