# 디자인 리뉴얼 변경 내역 백업

작업 기간: STEP 1 ~ 종합진행관리 헤더 축소까지
대상 페이지: 종합진행관리(메인), 정산조회(정산청구/정산종결/접수취소), 사이드바 전역
작업 원칙: 산식·라우팅·권한·gridTemplateColumns 절대 미변경, 한국어 응답, 단계별 검증

---

## 0. 롤백 기준점

| 항목 | 값 |
|---|---|
| 현재 HEAD | `c7dd008` (Reduce the height of the header in the comprehensive progress page) |
| 디자인 작업 직전 추정 커밋 | `c74ee84` 이전 — `Make status colors and text consistent across pages` (`42ecb6c`) 정도가 디자인 리뉴얼 시작 직전 베이스 |
| 권장 롤백 대상 체크포인트 | "디자인 토큰 적용" 이전 시점 |

> 채팅 상단 **체크포인트 롤백** 으로 위 시점 이전을 선택하면 일괄 복원됩니다.

---

## 1. 변경된 파일 목록

| # | 파일 | 변경 종류 |
|---|---|---|
| 1 | `client/src/index.css` | 디자인 토큰 추가 (--color-bg, --color-text 등) |
| 2 | `client/src/lib/case-status.ts` | getStatusColor 컬러 매핑 일부 색상 조정 (시그니처 동일) |
| 3 | `client/src/pages/comprehensive-progress.tsx` | 페이지 토큰 적용·진행상태 pill·청구버튼·페이지네이션·제목/전체건 색·헤더 padding·GlobalHeader 제거·외부 wrapper 변경 |
| 4 | `client/src/pages/settlements-inquiry.tsx` | 메인 테이블 헤더 padding 증가 (3px→8px) |
| 5 | `client/src/pages/cancelled-cases.tsx` | 그리드 헤더 padding 증가 (3px→8px) |
| 6 | `client/src/components/global-header.tsx` | **변경 없음** (참조용) |
| 7 | `client/src/components/statistics-layout.tsx` | GlobalHeader 제거, 100vh 사용 |
| 8 | `client/src/components/app-sidebar-statistics.tsx` | 신규/대규모 — 로고·상단메뉴·사용자프로필 사이드바 내부화, 색상 #eff0f5/#253297, 활성 탭 직사각형 풀폭, 서브메뉴 둥근, 하위 항목 버튼형, 폭 220px |
| 9 | `client/src/components/floating-intake-button.tsx` | bottom 32px → 120px (사용자 프로필 가림 방지) |
| 10 | `client/src/App.tsx` | `/comprehensive-progress` 라우트를 StatisticsLayout으로 래핑 |

---

## 2. STEP별 변경 내역

### STEP 1~5 — 종합진행관리 페이지 토큰/Pill/페이지네이션

**`client/src/index.css`**
- 디자인 토큰 추가: `--color-bg`, 페이지 배경 등
- 테이블 보더/헤더 가독성 향상

**`client/src/pages/comprehensive-progress.tsx`**
- 진행상태 pill:
  - 기본 배경 `#e7e7f5`, 텍스트 `#253396`
  - `getStatusColor` 색지정 상태(1차승인/복구요청(2차승인)/접수취소/반려/완료계열)는 기존 컬러 유지
  - `fontWeight: 400`, `borderRadius: 9999px`
- 청구하기 버튼: pill과 동일 스타일(`#e7e7f5` bg, `#253396` text, fontWeight 400, rounded)
- 페이지네이션: 활성 페이지 배경 → `#253396`
- 페이지 제목·"전체 N건" 텍스트 색 → `#56687f`
- 검색 버튼 색·전체건 숫자 색 일관성 조정
- 셀렉트 컴포넌트 배경/보더 통일
- 테이블 hover 효과·카드 스타일·셀 패딩 압축·페이지당 항목 수 조정

**`client/src/lib/case-status.ts`**
- `getStatusColor`/`getStatusDisplayText`/`STATUS_COLORS` 통합·일부 색 조정 (시그니처 그대로)

### STEP 6-1 ~ 6-5 — 사이드바 신설 (StatisticsLayout 한정)

**`client/src/components/app-sidebar-statistics.tsx`** (신규/대대적)
- GlobalHeader의 다음 요소를 사이드바 내부로 이동:
  - 로고 영역 (FLOXN + 아이콘, height 72px, drop-shadow #DBE9F5)
  - 상단 메뉴 5개 (홈/접수하기/종합진행관리/정산 및 통계/관리자 설정) — `topLevelMenu`/`hasCategory` 권한 필터 그대로 복제
  - 사용자 프로필 (아바타+이름+직책, MyPageDialog 연동)
- 활성 메뉴 판정 로직(`getActiveMenu`)은 GlobalHeader와 동일 규칙 복제
- 권한·라우팅 이동(`handleTopMenuClick`) 동일 동작 보존
- 폭 260px → 이후 220px로 축소

**`client/src/components/statistics-layout.tsx`**
- `<GlobalHeader />` 제거
- 외부 wrapper `min-h-screen` → `height: 100vh`
- 사이드바(좌) + 메인(우) flex 구조 + `<main className="flex-1 overflow-y-auto">`

**`client/src/components/global-header.tsx`** — **변경 없음** (StatisticsLayout 외 페이지 영향 차단)

### STEP 6-6 — 사이드바 구조·플로팅 버튼

**`client/src/components/app-sidebar-statistics.tsx`**
- 중복 "정산 및 통계" 섹션 헤더 제거
- 상단 "정산 및 통계" 활성 시에만 그 바로 아래에 서브메뉴(정산 조회/통계) 중첩 표시
- 서브메뉴 expand/collapse·하위 항목(정산 청구/종결/접수취소, 종결건 통계/미결건 통계) 라우팅 그대로

**`client/src/components/floating-intake-button.tsx`**
- `bottom: 32px` → **`120px`** (사이드바 하단 사용자 프로필 가림 방지)

### 사이드바 색상

**`client/src/components/app-sidebar-statistics.tsx`**
| 대상 | 변경 |
|---|---|
| 사이드바 배경 | `bg-white` → **`#eff0f5`** |
| 활성 탭 배경 (전 레벨) | **`#253297`** |
| 활성 탭 글씨 | **`#FFFFFF`** |
| 비활성 글씨 (메뉴/dot/ChevronDown) | **`#57677d`** |
| 사용자 프로필 텍스트 | `#57677d` / 직책 `rgba(87,103,125,0.6)` |

### 활성 탭 형태 변경 (반복 조정)

| 단계 | 상단 메뉴 | 서브메뉴 (정산 조회/통계) | 하위 항목 (정산 청구 등) |
|---|---|---|---|
| 좌측 풀블리드 | borderRadius `0 9999px 9999px 0` | rounded 8px | rounded 8px |
| 양옆 풀폭 pill | `9999px` 풀폭 | `9999px` 풀폭 | `9999px` 풀폭 |
| 직사각형 풀폭 | **`borderRadius: "0"`** 풀폭 | `"0"` 풀폭 | `"0"` 풀폭 |
| 들여쓰기 롤백 | (변경 없음) | `ml-2` 복원 | `ml-4` 복원 |
| 둥근 처리 | (직사각형 유지) | `borderRadius: "12px"` + `mr-3` | `borderRadius: "12px"` + `mr-2` |
| 버튼형 사이즈 | (유지) | (유지) | + `self-start` (제목 폭만 차지) |

**최종 상태**:
- 상단 메뉴: 좌우 풀폭 직사각형 (`borderRadius: 0`)
- 서브메뉴: 들여쓰기(ml-2) + 우측 여백(mr-3) + 둥근 모서리(12px) (행 폭)
- 하위 항목: 들여쓰기(ml-4) + 우측 여백(mr-2) + 둥근(12px) + `self-start` (제목 폭)

### 종합진행관리 페이지에 사이드바 적용

**`client/src/App.tsx`**
- `/comprehensive-progress` 라우트를 `<StatisticsLayout>` 으로 래핑

**`client/src/pages/comprehensive-progress.tsx`**
- `<GlobalHeader />` 호출 제거
- 외부 wrapper `<div className="min-h-screen">` → `<div style={{ minHeight: "100%" }}>`

### 사이드바 폭 축소

**`client/src/components/app-sidebar-statistics.tsx`**
- 폭 `260px` → **`220px`**

### 정산조회 탭 헤더 높이 증가

**`client/src/pages/settlements-inquiry.tsx`**
- `thBaseStyle.padding` `3px 16px` → **`8px 16px`**

**`client/src/pages/cancelled-cases.tsx`**
- 그리드 헤더 div `paddingTop/Bottom` `3px` → **`8px`**

### 종합진행관리 헤더 높이 축소

**`client/src/pages/comprehensive-progress.tsx`**
- 헤더 셀 `paddingTop/Bottom` `2px` → **`0px`**
- 헤더 셀 `lineHeight: "115%"` 추가
- 체크박스 컬럼 `paddingTop/Bottom` `2px` → **`0px`**

---

## 3. 보존된 항목 (변경 금지 대상)

- 모든 산식 (견적·정산·VAT·자기부담금·할인·수수료 계산 등)
- `gridTemplateColumns` 컬럼 폭 정의 (테이블 행 레이아웃)
- 라우팅 경로·권한 체크 로직 (`hasCategory`, `hasItem`, `usePermissions`)
- 메뉴 카테고리 이름·구조
- `global-header.tsx` 본체
- `getStatusColor` 시그니처

---

## 4. 관련 커밋 해시 (최근 → 오래된 순)

```
c7dd008 Reduce the height of the header in the comprehensive progress page
d1abc7c Increase table header height for better readability
d6b2975 Reduce the width of the sidebar to make more space for the main content
2612392 Apply a consistent sidebar UI to the comprehensive progress page
4b0ac78 Adjust sub-menu styling to appear as buttons
a99b90d Round the corners of active sub-menu and child tabs
a2a2d4f Restore indentation for sidebar sub-menus and items
7e6c5ff Update sidebar navigation to use sharp rectangular active tab backgrounds
2617870 Make sidebar navigation fill the full width of the page
4a34450 Update sidebar active tab styling for flush left background and rounded right edge
5e6a7b2 Update sidebar colors and text for better visual distinction
8477453 Restructure sidebar to nest settlement and statistics menus and adjust button positioning
f80be04 Move global header navigation and user profile to the sidebar
1f6ccaf Remove bold text from progress status pills
c408aab Update active page styling for pagination to a darker blue
b99ab50 Update font color for progress status and button
17250b4 Update progress status and billing button colors
6eab500 Update progress status pills and billing button styles
b12bdbe Update pill styling to match design specifications
58e8322 Update progress status pills and billing button styles
8c39fbc Update page title and text color to a new shade
de8a7a3 Update page title and summary text colors to new shade
b6a5deb Update font colors for page titles and specific text elements
8228298 Improve dropdown visibility and appearance in progress tracking
baee071 Update select components to use consistent background and border styles
cb919ae Update colors for total count and search button
94ab3dd Update table display to improve visual clarity and organization
0fb4924 Update background and input styles for the progress page
8c5ffdb Add design tokens for global styling and apply them to table elements
c74ee84 Make table borders, header, and row dividers more visible  ← (이 부근이 디자인 리뉴얼 시작점)
```

---

## 5. 롤백 방법

### 권장: 체크포인트 롤백 (한 번에 전체 복원)

1. 채팅 상단 **시계/되돌리기 아이콘** 클릭
2. **`Make status colors and text consistent across pages` (42ecb6c) 또는 그 이전** 체크포인트 선택
3. 확인하여 코드 + DB 일괄 복원

### 대안: git revert (코드만 단계적 되돌리기)

위 커밋 해시 목록을 최신 → 오래된 순으로 `git revert` 가능 (충돌 가능성 있음).

---

> 본 문서는 롤백 후 재작업 시 동일한 디자인을 재현하기 위한 참고 자료입니다.
