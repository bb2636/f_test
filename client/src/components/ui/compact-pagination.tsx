import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * CompactPagination
 * - 가운데 정렬, 한 페이지 10건 고정(상위에서 slice)
 * - 페이지 번호는 최대 10개씩 그룹으로 보여줌 (1~10 / 11~20 / ...)
 * - << : 현재 페이지 -10 (최소 1)
 * -  < : 현재 페이지 -1
 * -  > : 현재 페이지 +1
 * - >> : 현재 페이지 +10 (최대 totalPages)
 *
 * 색상/폰트: 기존 shadcn Button(outline/ghost) 그대로 사용 — 디자인 시스템 변경 없음
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
  if (totalPages <= 1) return null;

  const groupStart = Math.floor((currentPage - 1) / 10) * 10 + 1;
  const groupEnd = Math.min(groupStart + 9, totalPages);
  const pageNumbers: number[] = [];
  for (let p = groupStart; p <= groupEnd; p++) pageNumbers.push(p);

  const goTo = (target: number) => {
    const clamped = Math.min(totalPages, Math.max(1, target));
    if (clamped !== currentPage) onPageChange(clamped);
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
        onClick={() => goTo(currentPage - 10)}
        disabled={currentPage <= 1}
        aria-label="10페이지 이전"
        data-testid={`${testIdPrefix}-prev-10`}
      >
        <ChevronsLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => goTo(currentPage - 1)}
        disabled={currentPage <= 1}
        aria-label="이전 페이지"
        data-testid={`${testIdPrefix}-prev`}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {pageNumbers.map((p) => (
        <Button
          key={p}
          variant={p === currentPage ? "outline" : "ghost"}
          size="icon"
          className="h-8 w-8 text-sm"
          onClick={() => goTo(p)}
          aria-current={p === currentPage ? "page" : undefined}
          aria-label={`${p}페이지`}
          data-testid={`${testIdPrefix}-page-${p}`}
        >
          {p}
        </Button>
      ))}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => goTo(currentPage + 1)}
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
        onClick={() => goTo(currentPage + 10)}
        disabled={currentPage >= totalPages}
        aria-label="10페이지 다음"
        data-testid={`${testIdPrefix}-next-10`}
      >
        <ChevronsRight className="h-4 w-4" />
      </Button>
    </nav>
  );
}
