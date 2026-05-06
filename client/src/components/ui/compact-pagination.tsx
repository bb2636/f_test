import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * CompactPagination
 * - 가운데 정렬, 한 페이지 10건 고정(상위에서 slice)
 * - 페이지 번호는 최대 10개씩 그룹으로 보여줌 (1~10 / 11~20 / ...)
 *
 * [동작 사양 2026-05-06 — 사용자 요구]
 *  -  < : currentPage -1 (실제 데이터 페이지 이동)
 *  -  > : currentPage +1 (실제 데이터 페이지 이동)
 *  - << : pageGroupStart -10 (하단 페이지 번호 범위만 이동, currentPage 유지)
 *  - >> : pageGroupStart +10 (하단 페이지 번호 범위만 이동, currentPage 유지)
 *  - 그룹 내 번호 클릭 시 그때 비로소 currentPage 변경
 *
 * 상태 분리:
 *  - currentPage:    실제 데이터 페이지 (외부에서 주입)
 *  - pageGroupStart: 하단 표시 그룹의 시작값 (내부 state)
 *
 * 색상/폰트: 기존 shadcn Button(outline/ghost) 그대로 — 디자인 변경 없음.
 */
export interface CompactPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  testIdPrefix?: string;
}

export function CompactPagination({
  currentPage,
  totalPages,
  onPageChange,
  testIdPrefix = "pagination",
}: CompactPaginationProps) {
  const computeGroupStart = (p: number) => Math.floor((p - 1) / 10) * 10 + 1;

  const [pageGroupStart, setPageGroupStart] = useState<number>(() =>
    computeGroupStart(currentPage),
  );

  // currentPage가 외부에서 변경(예: 검색/필터로 1페이지 리셋, 직접 < > 클릭)되면
  // 해당 페이지가 보이도록 pageGroupStart를 동기화.
  useEffect(() => {
    setPageGroupStart(computeGroupStart(currentPage));
  }, [currentPage]);

  if (totalPages <= 1) return null;

  // pageGroupStart 가용 범위 보정 (totalPages 변동 대응)
  const maxGroupStart = computeGroupStart(totalPages);
  const safeGroupStart = Math.min(Math.max(1, pageGroupStart), maxGroupStart);
  const groupEnd = Math.min(safeGroupStart + 9, totalPages);
  const pageNumbers: number[] = [];
  for (let p = safeGroupStart; p <= groupEnd; p++) pageNumbers.push(p);

  const goToPage = (target: number) => {
    const clamped = Math.min(totalPages, Math.max(1, target));
    if (clamped !== currentPage) onPageChange(clamped);
  };

  const shiftGroup = (deltaGroups: number) => {
    // <<: 표시 그룹만 -10페이지, currentPage 그대로
    // >>: 표시 그룹만 +10페이지, currentPage 그대로
    const next = safeGroupStart + deltaGroups * 10;
    const clamped = Math.min(maxGroupStart, Math.max(1, next));
    setPageGroupStart(clamped);
  };

  return (
    <nav
      role="navigation"
      aria-label="pagination"
      className="flex items-center justify-center gap-1 py-3"
      data-testid={`${testIdPrefix}-nav`}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => shiftGroup(-1)}
        disabled={safeGroupStart <= 1}
        aria-label="이전 페이지 그룹"
        data-testid={`${testIdPrefix}-prev-group`}
      >
        <ChevronsLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage <= 1}
        aria-label="이전 페이지"
        data-testid={`${testIdPrefix}-prev`}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {pageNumbers.map((p) => {
        const isActive = p === currentPage;
        return (
          <Button
            key={p}
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-sm"
            style={
              isActive
                ? {
                    background: "#253396",
                    color: "#FFFFFF",
                    border: "1px solid #253396",
                    fontWeight: 600,
                  }
                : undefined
            }
            onClick={() => goToPage(p)}
            aria-current={isActive ? "page" : undefined}
            aria-label={`${p}페이지`}
            data-testid={`${testIdPrefix}-page-${p}`}
          >
            {p}
          </Button>
        );
      })}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage >= totalPages}
        aria-label="다음 페이지"
        data-testid={`${testIdPrefix}-next`}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => shiftGroup(1)}
        disabled={safeGroupStart + 10 > maxGroupStart}
        aria-label="다음 페이지 그룹"
        data-testid={`${testIdPrefix}-next-group`}
      >
        <ChevronsRight className="h-4 w-4" />
      </Button>
    </nav>
  );
}
