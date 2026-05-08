import { useEffect, useMemo, useState } from "react";

/**
 * useCompactPagination
 * - 한 페이지 10건 고정(필요 시 pageSize 인자로 변경)
 * - items 길이가 줄어 현재 페이지가 totalPages를 초과하면 자동 보정
 * - 검색 등 외부 리셋이 필요하면 반환된 setPage(1) 호출
 *
 * 산식 변경 없음 — 단순 slice + page state 관리
 */
export function useCompactPagination<T>(items: T[], pageSize = 10) {
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil((items?.length ?? 0) / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageItems = useMemo(
    () => (items ?? []).slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  );

  return { page, setPage, totalPages, pageItems, pageSize };
}
