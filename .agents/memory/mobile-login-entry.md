---
name: 모바일 앱 로그인 진입은 desktop Login
description: WebView가 루트(/)로 진입 → 라우트 "/"=desktop Login. mobile-login.tsx/mobile-home.tsx는 orphan
---

사실: mobile-app/App.tsx WebView는 `https://floxn-test.replit.app/`(루트)로 진입하고, client App.tsx 라우트는 `"/" → Login`(데스크톱). UA(FloxnMobileApp) 기반 `/mobile-login` 리다이렉트는 코드 어디에도 없다. `useIsMobileApp`은 컴포넌트 내부 분기에만 쓰이지 루트 라우팅을 바꾸지 않는다.

`mobile-login.tsx`·`mobile-home.tsx`는 사실상 orphan: `/mobile-login`은 mobile-home에서만 네비게이트되고, `/mobile-home`으로는 아무도 setLocation 안 함(라벨 비교 `location === "/mobile-home"`만 존재). 즉 모바일도 desktop `Login`을 본다.

**How to apply:** 모바일 전용 로그인 동작은 (a)desktop `Login`(또는 공용 컴포넌트)에 있으면 모바일에도 자동 적용되고, (b)`mobile-login.tsx`는 방어적으로만 동기화하면 된다. 예: 비번 강제변경(mustChangePassword)은 desktop Login에는 원래 있었고 mobile-login엔 없어, login.tsx 패턴(checkSession/onSuccess 분기 + ForceChangePasswordModal)을 mirror로 추가함. ForceChangePasswordModal은 휴대폰 문자인증(send-code/force-change-password)을 포함한 공용 컴포넌트.
