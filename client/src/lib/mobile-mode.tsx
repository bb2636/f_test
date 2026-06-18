import { createContext, useContext, ReactNode } from "react";

/**
 * 모바일(네이티브 앱/모바일웹) 모드 신호.
 *
 * 기존 데스크톱 페이지(field-management/field-documents/field-estimate 및 하위 컴포넌트)를
 * 모바일 케이스 상세에서 그대로 재사용하되, 모바일에서만 달라지는 노출 규칙
 * (예: 견적 관련 표의 "비고란" 숨김)을 구분하기 위한 컨텍스트.
 *
 * ⚠ 산식/계산 로직에는 절대 영향 없음 — UI 노출 여부에만 사용.
 */
const MobileModeContext = createContext<boolean>(false);

export function MobileModeProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return (
    <MobileModeContext.Provider value={value}>
      {children}
    </MobileModeContext.Provider>
  );
}

export function useMobileMode(): boolean {
  return useContext(MobileModeContext);
}
