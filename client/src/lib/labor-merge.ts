// 노무비 머지 로직은 shared로 이동됨. client/server 동일 로직 사용 보장.
export {
  FIXED_LABOR_WORK_NAMES,
  isFixedLaborWorkName,
  isMergeableLaborRow,
  mergeDemolitionRows,
  getMergedRowAmount,
  type MergedLaborCostRow,
} from "@shared/labor-merge";
