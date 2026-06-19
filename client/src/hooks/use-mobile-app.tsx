// 모바일 "앱"(WebView) 안에서 열렸는지 감지한다.
// mobile-app/App.tsx 의 WebView 가 applicationNameForUserAgent="FloxnMobileApp" 로
// userAgent 끝에 식별자를 붙이므로, 그 신호가 있을 때만 true.
// 데스크톱 브라우저(창을 좁게 줄여도)는 영향받지 않음 = "모바일앱만" 적용.
export function useIsMobileApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return /FloxnMobileApp/i.test(navigator.userAgent);
}
