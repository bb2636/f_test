---
name: 모바일 견적서 비고 컬럼 제거 패턴
description: 데스크톱 표를 모바일에서 재사용하며 특정 컬럼만 숨길 때의 안전한 토글 방법
---

# 모바일에서 표 컬럼만 숨기기 (비고란 제거)

데스크톱 페이지(field-estimate, labor-cost-section, material-cost-section)를 모바일
케이스 상세에서 그대로 재사용하면서 "비고란만" 숨겨야 할 때 사용하는 패턴.

**규칙:** 컬럼 하나를 숨기려면 그 컬럼의 `thead/th`, `tbody/td`, 그리고 `tfoot`의
대응 셀(또는 `colSpan`)을 **반드시 한꺼번에** 조건부 처리해야 정렬이 안 깨진다.

- 신호: `client/src/lib/mobile-mode.tsx`의 `useMobileMode()` 컨텍스트. mobile-case-detail이
  `<MobileModeProvider value={true}>`로 감싸므로 그 트리 안에서만 true. 기본값 false라
  데스크톱/기존 경로는 전혀 영향 없음.
- 컴포넌트에서 `const showNote = !useMobileMode();` 후 `{showNote && (<th/td>...)}`로 감쌈.
- tfoot 주의: labor는 trailing 빈셀 `colSpan={showNote ? 2 : 1}`로 줄임. material은 경비여부
  빈셀은 남기고 비고(자재비 구성비/빈셀) 셀만 `{showNote && (...)}`로 감쌈.
- field-estimate에는 비고 컬럼을 가진 표가 **둘**(편집형 복구면적산출표 + 조회형 견적서 요약표)
  이라 양쪽 다 처리해야 함.
- InvoiceSheet(정산 청구서 다이얼로그)는 견적서 탭(mobile-case-detail→FieldEstimate)에
  렌더되지 않으므로 제외 대상. 컨텍스트도 도달 안 함.

**Why:** 노출만 바꾸고 산식(labor-merge 등 계산)은 절대 건드리지 않기 위함. 컬럼을 td만 빼고
th/tfoot을 남기면 표 셀 수가 어긋나 레이아웃이 깨진다(특히 colSpan 정책이 박힌 표).

**How to apply:** 모바일에서 기존 표의 특정 컬럼만 노출/비노출할 때 useMobileMode로
같은 패턴을 재사용. 새 컬럼 추가 시 thead/tbody/tfoot 3곳 동기화 잊지 말 것.
