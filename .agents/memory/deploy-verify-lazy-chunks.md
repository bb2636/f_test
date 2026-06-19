---
name: 배포 반영 확인은 lazy 청크에서
description: floxn 배포본에 특정 페이지/기능이 들어갔는지 확인할 때 main index 번들 말고 lazy 청크를 grep해야 함
---

규칙: FLOXN 클라(React+Vite)는 페이지/큰 컴포넌트를 `lazy(() => import())`로 코드스플릿한다. 배포본 `index-*.js`(메인 번들)에는 앱 셸 + eager import(예: queryClient의 "중복 로그인 감지"/DUPLICATE_LOGIN)만 들어있고, login/dashboard/my-page-dialog/field-* 등 페이지 코드는 각각 `assets/<name>-<hash>.js` 청크에 있다.

**Why:** 배포본 메인 번들에서 `mustChangePassword`·`min-w-[620px]`·`password-change/send-code`·`force-change-password` 같은 페이지 마커를 grep하면 0이 나와 "배포 안 됨"으로 오판함(이 오판으로 불필요한 재배포까지 함). 실제로는 `login-*.js`·`dashboard-*.js`·`my-page-dialog-*.js` 청크에 멀쩡히 들어있었다.

**How to apply:**
- `curl /` → index.html → 메인 js 받고 `grep -oE 'assets/[A-Za-z0-9_-]+-[A-Za-z0-9_]{8,}\.js'`로 청크 목록 추출 → login/dashboard 등 해당 청크를 받아 거기서 grep.
- 배포 소스 = 이 repl 워크스페이스 스냅샷(로컬 HEAD)에서 `npm run build`. origin(github bb2636/f_test)은 로컬보다 수십 커밋 뒤처져 있고 tip이 "Remove mobile development work"라도 무시 — 배포본은 로컬 워크스페이스 기준(배포 login 청크에 로컬 전용 변경이 들어있어 확인됨).
