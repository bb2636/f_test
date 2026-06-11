let fieldReportPrefetched = false;

// 보고서 열람(현장출동보고서)은 별도 창에서 /field-survey/report 라우트를 새로
// 부팅하는데, field-report 페이지는 lazy 청크라 창을 연 뒤에야 추가로 받아온다.
// 버튼 hover/focus 시 미리 청크를 받아두면 클릭 후 창 로딩이 빨라진다
// (운영환경에서 HTTP 캐시로 새 창에서도 재사용됨).
export function prefetchFieldReport() {
  if (fieldReportPrefetched) return;
  fieldReportPrefetched = true;
  import("@/pages/field-report").catch(() => {
    // 일시적 네트워크 오류 시 다음 기회에 재시도 허용
    fieldReportPrefetched = false;
  });
}
