/**
 * 사고 케이스 진행상태 공통 유틸
 *
 * 색상 매핑 / 표시 텍스트 변환 함수.
 * 산식·로직 변경 없음 — comprehensive-progress.tsx 의 기존 함수를 그대로 추출.
 *
 * 적용 대상 페이지:
 *  - comprehensive-progress (적용)
 *  - cancelled-cases (동일 로직, 추후 적용 예정 — 현재 보류)
 *
 * ⚠ dashboard.tsx 의 getStatusColor 는 시그니처({text,bg})와 상태값(작성중/제출 등)이
 *    완전히 달라 이 모듈에 통합하지 않음.
 */

export const STATUS_COLORS = {
  primary: "#008FED",        // 1차승인
  success: "#00C853",        // 복구요청(2차승인)
  danger: "#ED1C00",         // 접수취소 / 반려
  warning: "#F59E0B",        // 취소대기
  completed: "#4CAF50",      // 입금완료/부분지급/지급완료/정산완료/종결
  default: "rgba(12, 12, 12, 0.7)",
} as const;

const COMPLETED_STATUSES = new Set([
  "입금완료",
  "부분지급",
  "지급완료",
  "정산완료",
  "종결",
]);

export function getStatusColor(status: string | null | undefined): string {
  if (status === "1차승인") return STATUS_COLORS.primary;
  if (status === "복구요청(2차승인)") return STATUS_COLORS.success;
  if (status === "접수취소" || status === "반려") return STATUS_COLORS.danger;
  if (status === "취소대기") return STATUS_COLORS.warning;
  if (status && COMPLETED_STATUSES.has(status)) return STATUS_COLORS.completed;
  return STATUS_COLORS.default;
}

export function getStatusDisplayText(
  status: string | null | undefined,
): string {
  if (!status) return "배당대기";
  return status;
}
