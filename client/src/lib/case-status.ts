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

// 진행상태 보여지는 이름 매핑 (DB 저장값은 그대로 유지, 표시 라벨만 변경)
const STATUS_DISPLAY_MAP: Record<string, string> = {
  "배당대기": "배정 대기",
  "접수완료": "배정완료",
  "검토중": "플록슨 심사 중",
  "1차승인": "플록슨 심사완료",
  "현장정보제출": "보험사 심사 중",
  "복구요청(2차승인)": "복구 요청",
  "청구자료제출(복구)": "복구완료 보고",
  "출동비청구(선견적)": "비교견적완료 보고",
  "현장방문": "보고서 작성중",
  "현장정보입력": "보고서 작성중",
};

export function getStatusDisplayText(
  status: string | null | undefined,
): string {
  if (!status) return STATUS_DISPLAY_MAP["배당대기"];
  return STATUS_DISPLAY_MAP[status] ?? status;
}

// 케이스 객체 단위 상태 라벨 — "청구" 상태는 복구 방식(recoveryType)에 따라 분기 표시
// (DB 저장값 변경 없음, 보여지는 라벨만 분기)
// 다중 접수건의 경우 본 케이스에 recoveryType 이 없으면 같은 사고번호(접수번호 prefix)를
// 가진 연관 케이스에서 recoveryType 을 조회해 동일 라벨로 표시.
type CaseLite = {
  caseNumber?: string | null;
  status?: string | null;
  recoveryType?: string | null;
};

function caseNumberPrefix(caseNumber?: string | null): string {
  if (!caseNumber) return "";
  return caseNumber.split("-")[0] || "";
}

export function getCaseStatusDisplayText(
  caseItem: CaseLite,
  allCases?: ReadonlyArray<CaseLite>,
): string {
  if (caseItem.status === "청구") {
    let recoveryType = caseItem.recoveryType ?? null;
    if (!recoveryType && allCases && caseItem.caseNumber) {
      const prefix = caseNumberPrefix(caseItem.caseNumber);
      if (prefix) {
        const related = allCases.find(
          (c) =>
            caseNumberPrefix(c.caseNumber) === prefix &&
            (c.recoveryType === "직접복구" ||
              c.recoveryType === "선견적요청"),
        );
        recoveryType = related?.recoveryType ?? null;
      }
    }
    if (recoveryType === "선견적요청") return "비교견적비 청구";
    if (recoveryType === "직접복구") return "공사비 청구";
    return "청구";
  }
  return getStatusDisplayText(caseItem.status);
}
