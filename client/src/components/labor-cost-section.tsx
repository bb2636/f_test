import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Copy,
  Search,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Lock,
  Trash2,
} from "lucide-react";
import type { LaborRateTier } from "@shared/schema";
import {
  calculateFWithTiers,
  calculateHWithTiers,
  calculateIWithTiers,
  DEFAULT_LABOR_RATE_TIERS_FALLBACK,
} from "@/hooks/use-labor-rate-tiers";

// ===== 노임비 계산 공식 (알파벳 정의) =====
// D = 기준작업량 (일위대가 DB)
// C = 복구면적 (노무비 계산값)
// E = 노임단가 (일위대가 DB)
// F = C/D 비율에 따른 적용단가 (E 기준 할인율 적용) - DB에서 가져온 요율 사용
// H = C≥D: (C-D)×(E÷D) / C<D: 0
// I = F + H (최종 노임비)
// 적용단가 = I / C
// 합계 = I

// 복구면적 산출표 행 인터페이스
export interface AreaCalculationRowForLabor {
  id: string;
  category: string; // 장소
  location: string; // 위치
  workType: string; // 공종
  workName: string; // 공사명
  damageArea: string; // 피해면적
  repairArea: string; // 복구면적
  width?: string; // 가로(mm)
  height?: string; // 세로(mm)
}

// 노무비 카탈로그 항목 (from excel_data)
export interface LaborCatalogItem {
  공종: string;
  공사명: string;
  세부공사: string; // '노무비' | '일위대가'
  세부항목: string;
  단위: string;
  단가_인: number | null;
  단가_천장: number | null;
  단가_벽체: number | null;
  단가_바닥: number | null;
  단가_길이: number | null;
}

// 일위대가 카탈로그 항목 (복구면적 연동용)
export interface IlwidaegaCatalogItem {
  공종: string;
  공사명: string;
  노임항목: string;
  기준작업량: number | null; // D
  노임단가: number | null; // E (노임단가(인당))
  일위대가: number | null; // E/D (참고용)
}

// 노무비 테이블 행
export interface LaborCostRow {
  id: string;
  sourceAreaRowId?: string; // 복구면적 산출표 행 ID (연동 추적용)
  isLinkedFromRecovery?: boolean; // 복구면적에서 연동 생성된 행인지 (true: 수정불가, false/undefined: 수정가능)
  sourceWorkType?: string; // 철거공사 행의 경우 부모 노무비 행의 공종 (복구면적 계산용)
  place: string; // 장소 - 복구면적 산출표에서 가져옴 (읽기전용)
  position: string; // 위치 - 복구면적 산출표에서 가져옴 (읽기전용)
  category: string; // 공종 - select
  workName: string; // 공사명 - select (filtered by category)
  detailWork: string; // 세부공사 - select (filtered by workName)
  detailItem: string; // 세부항목 - select (filtered by detailWork)
  priceStandard: string; // 단가 기준 - select (민/위/기/JV)
  unit: string; // 단위 - readonly
  standardPrice: number; // 기준가(단위) - readonly (단가_인 for 노무비)
  standardWorkQuantity?: number; // 기준작업량 - 일위대가DB에서 가져옴
  quantity: number; // 수량 - 자동계산 (복구면적 ÷ 기준작업량)
  applicationRates: {
    // 적용면 - radio buttons (only one can be selected)
    ceiling: boolean; // 천장
    wall: boolean; // 벽체
    floor: boolean; // 바닥
    molding: boolean; // 길이
  };
  salesMarkupRate: number; // 판매가 마진율 - editable
  pricePerSqm: number; // 기준가(m²) - calculated
  damageArea: number; // 피해면적 - editable
  deduction: number; // 공제(원) - calculated
  includeInEstimate: boolean; // 경비여부 - checkbox
  request: string; // 요청 - editable input
  amount: number; // 금액 - calculated
}

interface LaborCostSectionProps {
  rows: LaborCostRow[];
  onRowsChange: (rows: LaborCostRow[]) => void;
  catalog: LaborCatalogItem[];
  ilwidaegaCatalog?: IlwidaegaCatalogItem[]; // 일위대가 카탈로그 (복구면적 연동용)
  selectedRows: Set<string>;
  onSelectRow: (rowId: string) => void;
  onSelectAll: () => void;
  isLoading?: boolean;
  areaCalculationRows?: AreaCalculationRowForLabor[]; // 복구면적 산출표 데이터
  filteredWorkTypes?: string[]; // 케이스 유형에 따라 필터링된 공종 목록
  isReadOnly?: boolean; // 읽기 전용 모드
  onAreaImportToMaterial?: (workType: string, totalArea: number) => void; // 피해면적 산출표 불러오기 시 자재비 수량 업데이트 콜백
  enableAreaImport?: boolean; // 피해면적 불러오기 활성화 (손해방지 케이스만 true)
  isHydrated?: boolean; // 데이터 로딩 완료 여부 (재계산 방지용)
  laborRateTiers?: LaborRateTier[]; // C/D 비율 적용률 데이터 (DB에서 가져옴)
  isLossPreventionCase?: boolean; // 손해방지 케이스 여부 (누수탐지 경비여부 자동체크용)
}

export function LaborCostSection({
  rows,
  onRowsChange,
  catalog,
  ilwidaegaCatalog = [],
  selectedRows,
  onSelectRow,
  onSelectAll,
  isLoading = false,
  areaCalculationRows = [],
  filteredWorkTypes,
  isReadOnly = false,
  onAreaImportToMaterial,
  enableAreaImport = true, // 기본값 true (하위 호환)
  isHydrated = true, // 기본값 true (하위 호환)
  laborRateTiers = DEFAULT_LABOR_RATE_TIERS_FALLBACK, // 기본값: 하드코딩된 요율 (하위 호환)
  isLossPreventionCase = false, // 기본값 false
}: LaborCostSectionProps) {
  const [detailItemInputMode, setDetailItemInputMode] = useState<{[rowId: string]: boolean}>({});

  // 서버에서 로드된 행에 커스텀 detailItem 값이 있으면 자동으로 입력 모드 활성화
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    const newModes: { [rowId: string]: boolean } = {};
    let changed = false;
    rows.forEach((row) => {
      if (!row.detailItem || row.detailItem === "") return;
      if (detailItemInputMode[row.id]) return;
      const options = getDetailItemOptions(row.category, row.workName, row.detailWork || "노무비");
      if (!options.includes(row.detailItem)) {
        newModes[row.id] = true;
        changed = true;
      }
    });
    if (changed) {
      setDetailItemInputMode(prev => ({ ...prev, ...newModes }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, catalog, ilwidaegaCatalog]);

  // 드래그 앤 드롭 상태
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);

  // 드래그 앤 드롭 핸들러
  const handleDragStart = (e: React.DragEvent, rowId: string) => {
    if (isReadOnly) return;
    setDraggedRowId(rowId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", rowId);
  };

  const handleDragOver = (e: React.DragEvent, rowId: string) => {
    e.preventDefault();
    if (draggedRowId && draggedRowId !== rowId) {
      setDragOverRowId(rowId);
    }
  };

  const handleDragLeave = () => {
    setDragOverRowId(null);
  };

  const handleDrop = (e: React.DragEvent, targetRowId: string) => {
    e.preventDefault();
    const sourceRowId = e.dataTransfer.getData("text/plain");

    if (!sourceRowId || sourceRowId === targetRowId) {
      setDraggedRowId(null);
      setDragOverRowId(null);
      return;
    }

    const newRows = [...rows];
    const draggedIndex = newRows.findIndex((r) => r.id === sourceRowId);
    const targetIndex = newRows.findIndex((r) => r.id === targetRowId);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      const [draggedRow] = newRows.splice(draggedIndex, 1);
      newRows.splice(targetIndex, 0, draggedRow);
      onRowsChange(newRows);
    }

    setDraggedRowId(null);
    setDragOverRowId(null);
  };

  const handleDragEnd = () => {
    setDraggedRowId(null);
    setDragOverRowId(null);
  };

  // 공사명 선택 시 단순 업데이트 (팝업 제거됨)
  // 손해방지 케이스에서 공사명이 "누수탐지"면 경비여부 자동 체크
  const handleWorkNameChange = (rowId: string, workName: string) => {
    // 손해방지 케이스이고 공사명이 "누수탐지"면 updateRow 후 includeInEstimate 체크
    if (isLossPreventionCase && workName === "누수탐지") {
      // 먼저 updateRow로 workName 업데이트 및 금액 계산 수행
      // updateRow 내부 로직을 복사하여 includeInEstimate도 함께 설정
      const updatedRows = rows.map((row) => {
        if (row.id === rowId) {
          const updated = { ...row, workName, includeInEstimate: false };

          // 금액 계산 (standardPrice * quantity)
          const standardPrice = Number(updated.standardPrice) || 0;
          const quantity = Number(updated.quantity) || 0;
          updated.amount = Math.round(standardPrice * quantity);

          return updated;
        }
        return row;
      });
      onRowsChange(updatedRows);
    } else {
      updateRow(rowId, "workName", workName);
    }
  };

  // 공사명별 복구면적 자동 계산 함수
  // - 천장: ×1.3 적용
  // - 걸레받이/몰딩: 복구면적 산출표에서 이미 m² 단위로 계산됨 (변환 불필요)
  //   - 복구면적 산출표: 가로(mm) × 1000(mm) / 1000000 = 가로/1000 (m²)
  //   - 즉, repairArea 값이 4.00이면 4m 길이를 의미 (높이 1m 고정이므로)
  const calculateRecoveryAreaByWorkName = useMemo(() => {
    // 공사명별로 복구면적 산출표 데이터를 그룹화하여 합계 계산
    const workNameAreas: Record<string, number> = {};

    // 길이 기반 공사 (복구면적 산출표에서 이미 올바르게 계산됨)
    const lengthBasedWorkNames = ["걸레받이", "몰딩"];

    areaCalculationRows.forEach((row) => {
      const workName = row.workName || "";
      if (!workName) return;

      const area = parseFloat(row.repairArea) || 0;
      const location = row.location || "";

      const isLengthBased = lengthBasedWorkNames.includes(workName);

      // 천장인 경우 × 1.3 적용 (걸레받이/몰딩은 제외)
      const isCeiling =
        !isLengthBased && (location.includes("천장") || location === "천장");

      let adjustedArea = area;
      // 걸레받이/몰딩: 복구면적 산출표에서 이미 올바른 값 (m 단위)으로 계산됨
      // 변환 불필요 - repairArea가 그대로 복구면적(m)으로 사용됨
      if (isCeiling) {
        // 천장: ×1.3
        adjustedArea = area * 1.3;
      }

      if (!workNameAreas[workName]) {
        workNameAreas[workName] = 0;
      }
      workNameAreas[workName] += adjustedArea;
    });

    // 소수점 둘째 자리까지 반올림 (길이 기반은 더 정밀하게)
    Object.keys(workNameAreas).forEach((workName) => {
      const isLengthBased = lengthBasedWorkNames.includes(workName);
      if (isLengthBased) {
        // 걸레받이/몰딩: 소수점 둘째 자리
        workNameAreas[workName] =
          Math.round(workNameAreas[workName] * 100) / 100;
      } else {
        // 일반: 소수점 첫째 자리
        workNameAreas[workName] = Math.round(workNameAreas[workName] * 10) / 10;
      }
    });

    return workNameAreas;
  }, [areaCalculationRows]);

  // 연동된 행의 복구면적 및 수량 자동 업데이트 (공사명 기준)
  // 수량 = 복구면적 ÷ 기준작업량
  // 주의: hydration 완료 전에는 재계산하지 않음 (저장된 값 유지)
  useEffect(() => {
    if (!enableAreaImport) return;
    if (rows.length === 0) return;
    if (!isHydrated) return; // hydration 완료 전에는 재계산 건너뛰기

    // 연동된 행 중 복구면적/수량이 업데이트 필요한 행 찾기
    let hasChanges = false;
    const updatedRows = rows.map((row) => {
      // 연동된 행만 대상
      if (!row.isLinkedFromRecovery) return row;

      // 공사명이 없으면 업데이트하지 않음
      if (!row.workName) return row;

      // 공사명으로 복구면적 조회
      const newDamageArea = calculateRecoveryAreaByWorkName[row.workName] || 0;

      // 수량 계산: 복구면적 ÷ 기준작업량
      // 일위대가 카탈로그에서 최신 D 값 가져오기 (공종+공사명+노임항목으로 검색)
      let standardWorkQty = row.standardWorkQuantity || 0;
      if (row.detailWork === "일위대가" && ilwidaegaCatalog.length > 0) {
        const ilwidaegaItem = ilwidaegaCatalog.find(
          (item) =>
            item.공종 === row.category &&
            item.공사명 === row.workName &&
            item.노임항목 === row.detailItem,
        );
        if (ilwidaegaItem?.기준작업량) {
          standardWorkQty = ilwidaegaItem.기준작업량;
        }
      }
      // 수량 반올림: 0.1 이상은 소수점 1자리, 미만은 유효숫자 1자리
      const rawQuantity = newDamageArea / standardWorkQty;
      const newQuantity =
        standardWorkQty > 0
          ? rawQuantity >= 0.1
            ? Math.round(rawQuantity * 10) / 10
            : parseFloat(rawQuantity.toPrecision(1))
          : row.quantity;

      // 기존 값과 동일하고, 가격이 이미 계산되어 있으면 업데이트하지 않음
      // pricePerSqm이 0이면 재계산 필요 (새로 추가된 행)
      const needsPriceRecalc =
        row.pricePerSqm === 0 &&
        row.detailWork === "일위대가" &&
        row.standardPrice &&
        Number(row.standardPrice) > 0;
      if (
        row.damageArea === newDamageArea &&
        row.quantity === newQuantity &&
        !needsPriceRecalc
      )
        return row;

      hasChanges = true;

      // 금액 재계산: 일위대가 공식 (C, D, E → I)
      let newPricePerSqm = row.pricePerSqm;
      let newAmount = row.amount;

      if (row.detailWork === "일위대가") {
        // C = 복구면적, D = 기준작업량, E = 노임단가 (standardPrice)
        const C = newDamageArea;
        const D = standardWorkQty;
        const E = Number(row.standardPrice) || 0;

        if (D > 0 && E > 0 && C > 0) {
          // I 계산 (최종 노임비 = 합계) - DB 요율 사용
          newAmount = calculateIWithTiers(C, D, E, laborRateTiers);
          // 적용단가 = F (구간별 요율 적용된 노임단가)
          newPricePerSqm = calculateFWithTiers(C, D, E, laborRateTiers);
        } else {
          newAmount = 0;
          newPricePerSqm = 0;
        }
      }

      return {
        ...row,
        damageArea: newDamageArea,
        quantity: newQuantity,
        pricePerSqm: newPricePerSqm,
        amount: newAmount,
      };
    });

    // 변경된 행이 있으면 업데이트
    if (hasChanges) {
      onRowsChange(updatedRows);
    }
  }, [
    calculateRecoveryAreaByWorkName,
    enableAreaImport,
    rows,
    onRowsChange,
    isHydrated,
    ilwidaegaCatalog,
    laborRateTiers,
  ]);

  // 캐스케이딩 옵션 생성 - filteredWorkTypes가 제공되면 우선 사용
  const categoryOptions = useMemo(() => {
    // filteredWorkTypes가 제공되면 그것을 사용
    if (filteredWorkTypes && filteredWorkTypes.length > 0) {
      return filteredWorkTypes;
    }
    // 기본 로직: 카탈로그에서 공종 추출
    if (!catalog.length) return ["누수탐지비용"]; // 누수탐지비용은 항상 표시
    const unique = new Set(catalog.map((item) => item.공종));
    const categories = Array.from(unique);
    // 누수탐지비용이 catalog에 없으면 추가
    if (!categories.includes("누수탐지비용")) {
      return ["누수탐지비용", ...categories];
    }
    return categories;
  }, [catalog, filteredWorkTypes]);

  // 공사명 조회용 (변환 없이 그대로 사용)
  const mapWorkNameForLookup = (workName: string) => {
    return workName;
  };

  const getWorkNameOptions = (category: string, currentValue?: string) => {
    if (!category) return currentValue ? [currentValue] : [];
    // 누수탐지비용 특수 케이스
    if (category === "누수탐지비용") {
      return ["종합검사"];
    }
    if (!catalog.length) return currentValue ? [currentValue] : [];
    const filtered = catalog.filter((item) => item.공종 === category);
    const unique = new Set(filtered.map((item) => item.공사명));
    const options = Array.from(unique);
    // 현재 값이 옵션에 없으면 추가
    if (currentValue && !options.includes(currentValue)) {
      options.unshift(currentValue);
    }
    return options;
  };

  const getDetailWorkOptions = (
    category: string,
    workName: string,
    currentValue?: string,
  ) => {
    if (!category || !workName) return currentValue ? [currentValue] : [];
    // 누수탐지비용 특수 케이스
    if (category === "누수탐지비용" && workName === "종합검사") {
      return ["1회", "2회", "3회 이상"];
    }
    // 목공사-걸레받이 특수 케이스: 일위대가만 표시
    if (category === "목공사" && workName === "걸레받이") {
      return ["일위대가"];
    }
    if (!catalog.length) return currentValue ? [currentValue] : [];
    // 걸레a��이 -> 목공사 변환하여 조회
    const lookupWorkName = mapWorkNameForLookup(workName);
    const filtered = catalog.filter(
      (item) => item.공종 === category && item.공사명 === lookupWorkName,
    );
    const unique = new Set(filtered.map((item) => item.세부공사));
    // 현재 값이 옵션에 없으면 추가
    if (currentValue && !unique.has(currentValue)) {
      unique.add(currentValue);
    }
    return Array.from(unique);
  };

  const getDetailItemOptions = (
    category: string,
    workName: string,
    detailWork: string,
  ) => {
    if (!category) return [];

    // 노무비 DB용: 걸레받이 -> 목공사 변환
    const lookupWorkNameForLabor = mapWorkNameForLookup(workName);
    // 일위대가 DB용: 원본 공사명 그대로 사용
    const lookupWorkNameForIlwidaega = workName;

    // 일위대가인 경우: ilwidaegaCatalog에서 먼저 조회하고, 없으면 노무비 DB에서 조회
    if (detailWork === "일위대가") {
      const unique = new Set<string>();

      // 1. 일위대가 DB에서 노임항목 조회 (원본 공사명 사용)
      if (ilwidaegaCatalog.length > 0) {
        const ilwidaegaFiltered = ilwidaegaCatalog.filter(
          (item) =>
            item.공종 === category &&
            item.공사명 === lookupWorkNameForIlwidaega,
        );
        ilwidaegaFiltered.forEach((item) => {
          if (item.노임항목) unique.add(item.노임항목);
        });
      }

      // 2. 노무비 DB에서도 노임항목 조회 (수동 추가 행을 위한 폴백)
      if (catalog.length > 0) {
        const laborFiltered = catalog.filter(
          (item) => item.공종 === category && item.세부공사 === "노무비",
        );
        laborFiltered.forEach((item) => {
          if (item.세부항목) unique.add(item.세부항목);
        });
      }

      return Array.from(unique);
    }

    // 노무비인 경우: 기존 catalog에서 세부항목 조회
    if (!catalog.length) return [];

    // 노무비 DB는 공종만으로 필터링 (공사명과 무관하게 해당 공종의 모든 노임항목 표시)
    const filtered = catalog.filter(
      (item) => item.공종 === category && item.세부공사 === "노무비",
    );

    // 세부항목(노임항목)에서 중복 제거
    const unique = new Set(
      filtered.map((item) => item.세부항목).filter(Boolean),
    );
    return Array.from(unique);
  };

  const getApplicationRateOptions = (
    category: string,
    workName: string,
    detailWork: string,
    detailItem: string,
  ) => {
    if (!category || !workName || !detailWork || !detailItem) return [];
    // 목공사-걸레받이 특수 케이스: 길이(molding)만 표시 (일위대가DB 기준 내장공)
    if (
      category === "목공사" &&
      workName === "걸레받이" &&
      detailWork === "일위대가" &&
      detailItem === "내장공"
    ) {
      return ["molding"] as Array<"ceiling" | "wall" | "floor" | "molding">;
    }
    if (!catalog.length) return [];
    // 걸레받이 -> 목공사 변환하여 조회
    const lookupWorkName = mapWorkNameForLookup(workName);
    // 동일한 세부항목이 여러 개 있을 수 있으므로 모든 항목 찾기
    const items = catalog.filter(
      (i) =>
        i.공종 === category &&
        i.공사명 === lookupWorkName &&
        i.세부공사 === detailWork &&
        i.세부항목 === detailItem,
    );
    if (items.length === 0) return [];

    const options: Array<"ceiling" | "wall" | "floor" | "molding"> = [];
    // 모든 항목의 가격 정보를 합쳐서 적용면 옵션 생성
    let hasCeiling = false;
    let hasWall = false;
    let hasFloor = false;
    let hasMolding = false;

    items.forEach((item) => {
      if (item.단가_천장 !== null) hasCeiling = true;
      if (item.단가_벽체 !== null) hasWall = true;
      if (item.단가_바닥 !== null) hasFloor = true;
      if (item.단가_길이 !== null) hasMolding = true;
    });

    if (hasCeiling) options.push("ceiling");
    if (hasWall) options.push("wall");
    if (hasFloor) options.push("floor");
    if (hasMolding) options.push("molding");

    return options;
  };

  // 피해철거공사 행 자동 생성 함수
  const createDemolitionRow = (
    sourceRow: LaborCostRow,
    demolitionDetailItem: string,
  ): LaborCostRow => {
    // sourceRow의 공사명에서 철거공사 공사명 도출
    // 예: 목공사-석고보드 → 철거공사-석고보드
    const demolitionWorkName = sourceRow.workName;

    // 새 형식으로 먼저 검색: 철거공사-<공사명>-일위대가-<세부항목>
    let demolitionCatalogItem = catalog.find(
      (item) =>
        item.공종 === "철거공사" &&
        item.공사명 === demolitionWorkName &&
        item.세부공사 === "일위대가",
    );

    // 새 형식 없으면 기존 형식으로 검색: 피해철거공사-피해철거-일위대가-<세부항목>
    if (!demolitionCatalogItem) {
      demolitionCatalogItem = catalog.find(
        (item) =>
          item.공종 === "피해철거공사" &&
          item.공사명 === "피해철거" &&
          item.세부공사 === "일위대가" &&
          item.세부항목 === demolitionDetailItem,
      );
    }

    // 사용할 카탈로그 항목에서 공종/공사명/세부항목 결정
    const useCategory = demolitionCatalogItem?.공종 || "철거공사";
    const useWorkName = demolitionCatalogItem?.공사명 || demolitionWorkName;

    // 일위대가 카탈로그에서 기준작업량(D)과 노임단가(E) 조회
    // 철거공사는 공종+공사명으로만 검색 (노임항목은 일위대가 DB에서 자동 매칭)
    const ilwidaegaItem = ilwidaegaCatalog.find(
      (item) => item.공종 === useCategory && item.공사명 === useWorkName,
    );

    // 일위대가 카탈로그에서 노임항목 가져오기 (보통인부, 내장공 등)
    const useDetailItem =
      ilwidaegaItem?.노임항목 ||
      demolitionCatalogItem?.세부항목 ||
      demolitionDetailItem;

    // 기준작업량과 노임단가 가져오기
    const standardWorkQty = ilwidaegaItem?.기준작업량 || 0;
    const laborUnitPrice = ilwidaegaItem?.노임단가 || 0;

    console.log(
      "[철거공사 생성]",
      useCategory,
      useWorkName,
      useDetailItem,
      "D:",
      standardWorkQty,
      "E:",
      laborUnitPrice,
    );

    // 피해면적과 수량 계산 (수량 = 피해면적 / 기준작업량)
    // 수량 반올림: 0.1 이상은 소수점 1자리, 미만은 유효숫자 1자리
    const damageArea = sourceRow.damageArea || 0;
    const rawQuantity = standardWorkQty > 0 ? damageArea / standardWorkQty : 1;
    const quantity =
      standardWorkQty > 0
        ? rawQuantity >= 0.1
          ? Math.round(rawQuantity * 10) / 10
          : parseFloat(rawQuantity.toPrecision(1))
        : 1;

    const newRow: LaborCostRow = {
      id: `labor-demolition-${sourceRow.id}-${Date.now()}`,
      sourceAreaRowId: `demolition-${sourceRow.id}`, // 중복 방지를 위한 추적 ID
      place: sourceRow.place,
      position: sourceRow.position,
      category: useCategory,
      workName: useWorkName,
      detailWork: "일위대가",
      detailItem: useDetailItem,
      priceStandard: sourceRow.priceStandard,
      unit: demolitionCatalogItem?.단위 || "m²",
      standardPrice: laborUnitPrice, // 노임단가 (E)
      standardWorkQuantity: standardWorkQty, // 기준작업량 (D)
      quantity: quantity,
      applicationRates: {
        ceiling: false,
        wall: false,
        floor: false,
        molding: false,
      },
      salesMarkupRate: 0,
      pricePerSqm: 0,
      damageArea: damageArea,
      deduction: 0,
      includeInEstimate: true,
      request: "",
      amount: 0,
    };

    // 적용면 기본 설정 (바닥 우선)
    if (demolitionCatalogItem) {
      if (demolitionCatalogItem.단가_바닥 !== null) {
        newRow.applicationRates.floor = true;
      } else if (demolitionCatalogItem.단가_천장 !== null) {
        newRow.applicationRates.ceiling = true;
      } else if (demolitionCatalogItem.단가_벽체 !== null) {
        newRow.applicationRates.wall = true;
      } else if (demolitionCatalogItem.단가_길이 !== null) {
        newRow.applicationRates.molding = true;
      }
    }

    // 금액 계산 (일위대가 공식: calculateI(C, D, E))
    // C = 피해면적, D = 기준작업량, E = 노임단가
    const C = damageArea;
    const D = standardWorkQty;
    const E = laborUnitPrice;

    if (D > 0 && E > 0 && C > 0) {
      // I 계산 (최종 노임비) - DB 요율 사용
      const I = calculateIWithTiers(C, D, E, laborRateTiers);
      // 적용단가 = F (구간별 요율 적용된 노임단가)
      const appliedUnitPrice = calculateFWithTiers(C, D, E, laborRateTiers);

      newRow.pricePerSqm = appliedUnitPrice;
      newRow.amount = I;
    } else {
      newRow.pricePerSqm = 0;
      newRow.amount = 0;
    }

    return newRow;
  };

  // 행 업데이트
  const updateRow = (rowId: string, field: keyof LaborCostRow, value: any) => {
    if (isReadOnly) return;

    // 연동 행은 수정 불가 (복구면적에서 자동 생성된 행)
    const targetRow = rows.find((r) => r.id === rowId);
    if (targetRow?.isLinkedFromRecovery) return;

    // 수량(quantity)은 음수가 될 수 없음 - 0 미만이면 0으로 설정
    if (field === "quantity") {
      const numValue = Number(value) || 0;
      if (numValue < 0) {
        value = 0;
      }
    }

    let demolitionRowToAdd: LaborCostRow | null = null;
    const currentRow = rows.find((r) => r.id === rowId);

    const updatedRows = rows.map((row) => {
      if (row.id === rowId) {
        const updated = { ...row, [field]: value };

        // category 변경 시 하위 필드 리셋
        if (field === "category") {
          // 누수탐지비용 선택 시 특수 처리
          if (value === "누수탐지비용") {
            updated.workName = "종합검사";
            updated.detailWork = "";
            updated.detailItem = "";
            updated.unit = "회";
            updated.standardPrice = 0;
            updated.applicationRates = {
              ceiling: false,
              wall: false,
              floor: false,
              molding: false,
            };
            updated.pricePerSqm = 0;
          } else {
            updated.workName = "";
            updated.detailWork = "";
            updated.detailItem = "";
            updated.unit = "";
            updated.standardPrice = 0;
            updated.applicationRates = {
              ceiling: false,
              wall: false,
              floor: false,
              molding: false,
            };
            updated.pricePerSqm = 0;
          }
        }

        // workName 변경 시 하위 필드 리셋
        if (field === "workName") {
          // 수동 추가 행 (isLinkedFromRecovery = false): 노무비 DB 사용
          // 연동 행 (isLinkedFromRecovery = true): 일위대가 DB 사용 (특수 케이스 포함)

          if (updated.isLinkedFromRecovery) {
            // === 연동 행: 일위대가 DB 기반 처리 ===
            // 목공사-반자틀 선택 시 자동으로 일위대가-반자틀설치 설정
            if (updated.category === "목공사" && value === "반자틀") {
              updated.detailWork = "일위대가";
              updated.detailItem = "반자틀설치";

              // 카탈로그에서 데이터 가져오기
              const catalogItem = catalog.find(
                (item) =>
                  item.공종 === "목공사" &&
                  item.공사명 === "반자틀" &&
                  item.세부공사 === "일위대가" &&
                  item.세부항목 === "반자틀설치",
              );

              if (catalogItem) {
                updated.unit = catalogItem.단위 || "";
                updated.standardPrice = catalogItem.단가_인 || 0;

                // applicationRates 기본값 설정
                updated.applicationRates = {
                  ceiling: false,
                  wall: false,
                  floor: false,
                  molding: false,
                };
                if (catalogItem.단가_천장 !== null) {
                  updated.applicationRates.ceiling = true;
                  updated.pricePerSqm = catalogItem.단가_천장;
                } else if (catalogItem.단가_벽체 !== null) {
                  updated.applicationRates.wall = true;
                  updated.pricePerSqm = catalogItem.단가_벽체;
                } else if (catalogItem.단가_바닥 !== null) {
                  updated.applicationRates.floor = true;
                  updated.pricePerSqm = catalogItem.단가_바닥;
                } else if (catalogItem.단가_길이 !== null) {
                  updated.applicationRates.molding = true;
                  updated.pricePerSqm = catalogItem.단가_길이;
                }
              } else {
                updated.unit = "";
                updated.standardPrice = 0;
                updated.applicationRates = {
                  ceiling: false,
                  wall: false,
                  floor: false,
                  molding: false,
                };
                updated.pricePerSqm = 0;
              }

              // 반자틀설치에 대한 피해철거공사(반자틀해체) 행 자동 추가
              const demolitionSourceId = `demolition-${rowId}`;
              const existingDemolition = rows.find(
                (r) => r.sourceAreaRowId === demolitionSourceId,
              );
              if (!existingDemolition) {
                demolitionRowToAdd = createDemolitionRow(
                  { ...updated },
                  "반자틀해체",
                );
              }
            }
            // 목공사-걸레받이 선택 시 자동으로 일위대가-내장공 설정 (일위대가DB 기준)
            else if (updated.category === "목공사" && value === "걸레받이") {
              updated.detailWork = "일위대가";
              updated.detailItem = "내장공";

              // 일위대가 카탈로그에서 데이터 가져오기 (목공사-걸레받이-내장공)
              const ilwidaegaItem = ilwidaegaCatalog.find(
                (item) =>
                  item.공종 === "목공사" &&
                  item.공사명 === "걸레받이" &&
                  item.노임항목 === "내장공",
              );

              if (ilwidaegaItem) {
                updated.unit = "m"; // 걸레받이는 길이 단위
                updated.standardPrice = ilwidaegaItem.노임단가 || 0;
                updated.standardWorkQuantity = ilwidaegaItem.기준작업량 || 0;

                // applicationRates 기본값 설정 (걸레받이는 길이 기준)
                updated.applicationRates = {
                  ceiling: false,
                  wall: false,
                  floor: false,
                  molding: true,
                };
              } else {
                updated.unit = "m";
                updated.standardPrice = 75; // 일위대가DB 기본값
                updated.pricePerSqm = 75;
                updated.applicationRates = {
                  ceiling: false,
                  wall: false,
                  floor: false,
                  molding: true,
                };
              }
            }
            // 그 외 연동 행: 일위대가 DB에서 조회
            else {
              updated.detailWork = "일위대가";
              updated.unit = "㎡";
              updated.standardPrice = 0;
              updated.applicationRates = {
                ceiling: false,
                wall: false,
                floor: false,
                molding: false,
              };
              updated.pricePerSqm = 0;

              // 일위대가 DB에서 노임항목 조회
              const lookupWorkName = mapWorkNameForLookup(value);
              const matchingIlwidaegaItems = ilwidaegaCatalog.filter(
                (item) =>
                  item.공종 === updated.category &&
                  item.공사명 === lookupWorkName,
              );
              const uniqueDetailItems = Array.from(
                new Set(
                  matchingIlwidaegaItems
                    .map((item) => item.노임항목)
                    .filter(Boolean),
                ),
              );

              if (uniqueDetailItems.length === 1) {
                updated.detailItem = uniqueDetailItems[0];
                const ilwidaegaItem = matchingIlwidaegaItems[0];
                if (ilwidaegaItem) {
                  updated.standardPrice = ilwidaegaItem.노임단가 || 0;
                  updated.standardWorkQuantity = ilwidaegaItem.기준작업량 || 0;
                }
                console.log(
                  "[연동행 일위대가 자동선택]",
                  updated.category,
                  "->",
                  value,
                  "->",
                  updated.detailItem,
                );
              } else {
                updated.detailItem = "";
                console.log(
                  "[연동행 일위대가 다중옵션]",
                  updated.category,
                  "->",
                  value,
                  "옵션:",
                  uniqueDetailItems,
                );
              }
            }
          } else {
            // === 수동 추가 행: 노무비 DB 기반 처리 ===
            updated.detailWork = "노무비";
            updated.unit = "인";
            updated.standardPrice = 0;
            updated.applicationRates = {
              ceiling: false,
              wall: false,
              floor: false,
              molding: false,
            };
            updated.pricePerSqm = 0;

            // 노무비 DB에서 공종+공사명으로 노임항목 조회
            const lookupWorkName = mapWorkNameForLookup(value);
            const matchingItems = catalog.filter(
              (item) =>
                item.공종 === updated.category &&
                item.공사명 === lookupWorkName &&
                item.세부공사 === "노무비",
            );
            const uniqueDetailItems = Array.from(
              new Set(
                matchingItems.map((item) => item.세부항목).filter(Boolean),
              ),
            );

            // 노임항목이 하나만 있으면 자동 선택
            if (uniqueDetailItems.length === 1) {
              updated.detailItem = uniqueDetailItems[0];

              // 노무비 카탈로그에서 해당 항목의 단가 가져오기
              const catalogItem = matchingItems.find(
                (item) => item.세부항목 === uniqueDetailItems[0],
              );
              if (catalogItem) {
                updated.unit = catalogItem.단위 || "인";
                updated.standardPrice = catalogItem.단가_인 || 0;
                updated.pricePerSqm = catalogItem.단가_인 || 0; // 적용단가도 설정
              }
              console.log(
                "[수동행 노무비 자동선택]",
                updated.category,
                "->",
                value,
                "->",
                updated.detailItem,
                "단가:",
                updated.pricePerSqm,
              );
            } else if (uniqueDetailItems.length > 1) {
              // 노임항목이 여러 개면 선택 대기
              updated.detailItem = "";
              console.log(
                "[수동행 노무비 다중옵션]",
                updated.category,
                "->",
                value,
                "옵션:",
                uniqueDetailItems,
              );
            } else {
              updated.detailItem = "";
              console.log(
                "[수동행 노무비 옵션없음]",
                updated.category,
                "->",
                value,
                "매칭항목:",
                matchingItems.length,
              );
            }
          }
        }

        // detailWork 변경 시 하위 필드 리셋
        if (field === "detailWork") {
          // 누수탐지비용인 경우 pricing 로직 적용
          if (updated.category === "누수탐지비용") {
            updated.detailItem = "";
            // unit은 이미 "회"로 설정되어 있으므로 유지
            // detailWork에 따라 standardPrice 설정
            if (value === "1회") updated.standardPrice = 300000;
            else if (value === "2회") updated.standardPrice = 400000;
            else if (value === "3회 이상") updated.standardPrice = 500000;
            else updated.standardPrice = 0;
            updated.applicationRates = {
              ceiling: false,
              wall: false,
              floor: false,
              molding: false,
            };
            updated.pricePerSqm = 0;
          } else {
            updated.detailItem = "";
            updated.unit = "";
            updated.standardPrice = 0;
            updated.applicationRates = {
              ceiling: false,
              wall: false,
              floor: false,
              molding: false,
            };
            updated.pricePerSqm = 0;
          }
        }

        // detailItem 변경 시 카탈로그에서 데이터 채우기
        if (field === "detailItem") {
          // 노무비 DB용: 걸레받이 -> 목공사 변환
          const lookupWorkNameForLabor = mapWorkNameForLookup(updated.workName);
          // 일위대가 DB용: 원본 공사명 그대로 사용 (걸레받이는 '걸레받이'로 저장됨)
          const lookupWorkNameForIlwidaega = updated.workName;

          // 일위대가인 경우: ilwidaegaCatalog에서 D, E 가져오기
          if (updated.detailWork === "일위대가") {
            const ilwidaegaItem = ilwidaegaCatalog.find(
              (item) =>
                item.공종 === updated.category &&
                item.공사명 === lookupWorkNameForIlwidaega &&
                item.노임항목 === value,
            );
            if (ilwidaegaItem) {
              updated.unit = "㎡";
              updated.standardPrice = ilwidaegaItem.노임단가 || 0; // E
              updated.standardWorkQuantity = ilwidaegaItem.기준작업량 || 0; // D
              // 적용면 기본 설정 (바닥 우선)
              updated.applicationRates = {
                ceiling: false,
                wall: false,
                floor: true,
                molding: false,
              };
              console.log(
                "[일위대가 detailItem 선택]",
                updated.category,
                lookupWorkNameForIlwidaega,
                value,
                "D:",
                ilwidaegaItem.기준작업량,
                "E:",
                ilwidaegaItem.노임단가,
              );
            } else {
              // 일위대가DB에 없으면 노무비DB에서 조회 (수동 추가 행의 폴백)
              const laborCatalogItem = catalog.find(
                (item) =>
                  item.공종 === updated.category && item.세부항목 === value,
              );
              if (laborCatalogItem) {
                updated.unit = "인";
                updated.standardPrice = laborCatalogItem.단가_인 || 0;
                updated.standardWorkQuantity = 0; // 노무비DB는 기준작업량 없음
                updated.applicationRates = {
                  ceiling: false,
                  wall: false,
                  floor: false,
                  molding: false,
                };
                // pricePerSqm에 단가_인 설정 (수량 기반 계산용)
                updated.pricePerSqm = laborCatalogItem.단가_인 || 0;
                console.log(
                  "[노무비DB 폴백 detailItem 선택]",
                  updated.category,
                  value,
                  "단가_인:",
                  laborCatalogItem.단가_인,
                );
              } else {
                updated.standardPrice = 0;
                updated.standardWorkQuantity = 0;
                console.log(
                  "[일위대가+노무비 항목 못찾음]",
                  updated.category,
                  lookupWorkNameForIlwidaega,
                  value,
                );
              }
            }
          } else {
            // 노무비인 경우: 기존 노무비 catalog에서 가져오기
            let catalogItem = catalog.find(
              (item) =>
                item.공종 === updated.category &&
                item.공사명 === lookupWorkNameForLabor &&
                item.세부공사 === updated.detailWork &&
                item.세부항목 === value,
            );

            // 정확한 매치가 없으면 세부항목(노임항목)만으로 폴백 조회
            // 노임항목별 단가는 공종/공사명에 관계없이 동일함
            if (!catalogItem) {
              catalogItem = catalog.find(
                (item) =>
                  item.세부공사 === "노무비" &&
                  item.세부항목 === value &&
                  item.단가_인 !== null &&
                  item.단가_인 > 0,
              );
              if (catalogItem) {
                console.log(
                  "[노무비 폴백 조회] 세부항목만으로 매치:",
                  value,
                  "단가_인:",
                  catalogItem.단가_인,
                  "(원본 공종:",
                  catalogItem.공종,
                  ")",
                );
              }
            }

            if (catalogItem) {
              updated.unit = "인";
              updated.standardPrice = catalogItem.단가_인 || 0;
              // 노무비의 경우 적용단가 = 단가_인 (기본값으로 설정)
              updated.pricePerSqm = catalogItem.단가_인 || 0;

              // applicationRates 기본값 설정 (첫 번째 사용 가능한 옵션 선택)
              updated.applicationRates = {
                ceiling: false,
                wall: false,
                floor: false,
                molding: false,
              };
              if (catalogItem.단가_천장 !== null) {
                updated.applicationRates.ceiling = true;
                updated.pricePerSqm = catalogItem.단가_천장;
              } else if (catalogItem.단가_벽체 !== null) {
                updated.applicationRates.wall = true;
                updated.pricePerSqm = catalogItem.단가_벽체;
              } else if (catalogItem.단가_바닥 !== null) {
                updated.applicationRates.floor = true;
                updated.pricePerSqm = catalogItem.단가_바닥;
              } else if (catalogItem.단가_길이 !== null) {
                updated.applicationRates.molding = true;
                updated.pricePerSqm = catalogItem.단가_길이;
              }
              console.log(
                "[노무비 detailItem 선택]",
                updated.category,
                lookupWorkNameForLabor,
                value,
                "단가_인:",
                catalogItem.단가_인,
                "적용단가:",
                updated.pricePerSqm,
              );
            } else {
              console.log(
                "[노무비 항목 못찾음]",
                updated.category,
                lookupWorkNameForLabor,
                updated.detailWork,
                value,
              );
            }
          }

          // 반자틀설치, 석고보드설치, 합판설치 선택 시 피해철거공사 행 자동 추가 (연동 행만, 수동 추가 행은 제외)
          if (
            updated.isLinkedFromRecovery &&
            updated.category === "목공사" &&
            (value === "반자틀설치" ||
              value === "석고보드설치" ||
              value === "합판설치")
          ) {
            // 반자틀설치 → 반자틀해체, 석고보드설치/합판설치 → 석고보드해체
            const demolitionDetailItem =
              value === "반자틀설치" ? "반자틀해체" : "석고보드해체";
            const demolitionSourceId = `demolition-${rowId}`;

            // 이미 해당 행에 대한 피해철거공사 행이 있는지 확인
            const existingDemolition = rows.find(
              (r) => r.sourceAreaRowId === demolitionSourceId,
            );
            if (!existingDemolition) {
              // 업데이트된 행 정보로 피해철거공사 행 생성
              demolitionRowToAdd = createDemolitionRow(
                { ...updated },
                demolitionDetailItem,
              );
            }
          }
        }

        // applicationRates 변경 시 pricePerSqm 업데이트
        if (field === "applicationRates") {
          // 걸레받이 -> 목공사 변환하여 조회
          const lookupWorkName = mapWorkNameForLookup(updated.workName);
          const catalogItem = catalog.find(
            (item) =>
              item.공종 === updated.category &&
              item.공사명 === lookupWorkName &&
              item.세부공사 === updated.detailWork &&
              item.세부항목 === updated.detailItem,
          );
          if (catalogItem) {
            // 선택된 첫 번째 applicationRate의 가격 사용
            if (value.ceiling) updated.pricePerSqm = catalogItem.단가_천장 || 0;
            else if (value.wall)
              updated.pricePerSqm = catalogItem.단가_벽체 || 0;
            else if (value.floor)
              updated.pricePerSqm = catalogItem.단가_바닥 || 0;
            else if (value.molding)
              updated.pricePerSqm = catalogItem.단가_길이 || 0;
            else updated.pricePerSqm = 0;
          }
        }

        // 금액 계산 (타입을 명시적으로 number로 변환)
        const standardPrice = Number(updated.standardPrice) || 0;
        const quantity = Number(updated.quantity) || 0;
        const damageArea = Number(updated.damageArea) || 0;
        const standardWorkQty = Number(updated.standardWorkQuantity) || 0;

        // 누수탐지비용 또는 누수탐지는 standardPrice * quantity로 계산
        if (
          updated.category === "누수탐지비용" ||
          updated.category === "누수탐지"
        ) {
          updated.amount = Math.round(standardPrice * quantity);
        } else if (updated.detailWork === "노무비") {
          // 노무비: 기준가(단위) * 수량 (피해면적은 표시만, 곱하지 않음)
          // 노임항목 변경 시에도 합계가 즉시 업데이트되도록 항상 재계산
          updated.amount = Math.round(standardPrice * quantity);
        } else if (updated.detailWork === "일위대가") {
          // 일위대가: 새 공식 적용 (C, D, E → I)
          // C = 복구면적 (damageArea)
          // D = 기준작업량 (standardWorkQuantity)
          // E = 노임단가 (standardPrice - 일위대가DB의 금액)
          const C = damageArea;
          const D = standardWorkQty;
          const E = standardPrice;

          if (D > 0 && E > 0 && C > 0) {
            // I 계산 (최종 노임비) - DB 요율 사용
            const I = calculateIWithTiers(C, D, E, laborRateTiers);
            // 적용단가 = F (구간별 요율 적용된 노임단가)
            const appliedUnitPrice = calculateFWithTiers(C, D, E, laborRateTiers);

            updated.pricePerSqm = appliedUnitPrice;
            updated.amount = I;
          } else if (D === 0 && E > 0) {
            // 노무비DB 폴백 케이스: D가 없으면 단순 계산 (단가 × 수량)
            updated.amount = Math.round(E * quantity);
            // pricePerSqm은 이미 설정되어 있음 (단가_인)
          } else {
            updated.pricePerSqm = 0;
            updated.amount = 0;
          }
        } else {
          updated.amount = 0;
        }

        return updated;
      }
      return row;
    });

    // 피해철거공사 행 추가
    if (demolitionRowToAdd) {
      updatedRows.push(demolitionRowToAdd);
    }

    onRowsChange(updatedRows);
  };

  // 행 복제
  const duplicateRow = (row: LaborCostRow) => {
    const newRow = { ...row, id: `labor-${Date.now()}-${Math.random()}` };
    onRowsChange([...rows, newRow]);
  };

  // 병합된 행 인터페이스 (동일 철거공사 합산 표시용)
  interface MergedLaborCostRow extends LaborCostRow {
    mergedSourceIds?: string[]; // 병합된 원본 행 ID들
    mergedQuantity?: number; // 합산된 수량
    mergedAmount?: number; // 합산된 금액
  }

  // 철거공사 동일 항목 병합 함수
  const mergeDemolitionRows = (
    inputRows: LaborCostRow[],
  ): MergedLaborCostRow[] => {
    const result: MergedLaborCostRow[] = [];
    const demolitionMap = new Map<string, MergedLaborCostRow>();

    inputRows.forEach((row) => {
      // 철거공사 카테고리만 병합 대상
      if (row.category === "철거공사" || row.category === "피해철거공사") {
        // 병합 키: 공사명 + 세부항목 + 단위 + 단가
        const mergeKey = `${row.workName}|${row.detailItem}|${row.unit}|${row.standardPrice}`;

        if (demolitionMap.has(mergeKey)) {
          // 기존 병합 행에 합산
          const existing = demolitionMap.get(mergeKey)!;
          existing.mergedSourceIds = existing.mergedSourceIds || [existing.id];
          existing.mergedSourceIds.push(row.id);
          // 면적 합산
          existing.damageArea =
            (existing.damageArea || 0) + (row.damageArea || 0);

          // 합산된 면적으로 금액, 적용단가, 수량 재계산 (일반 노무비와 동일한 I = F + H 공식)
          const C = existing.damageArea;
          const D = existing.standardWorkQuantity || 0;
          const E = existing.standardPrice || 0;
          if (D > 0 && E > 0 && C > 0) {
            existing.mergedAmount = calculateIWithTiers(
              C,
              D,
              E,
              laborRateTiers,
            );
            // 적용단가도 재계산: F (구간별 요율 적용된 노임단가)
            existing.pricePerSqm = calculateFWithTiers(
              C,
              D,
              E,
              laborRateTiers,
            );
            // 수량도 재계산: C / D (0.1 이상은 소수점 1자리, 미만은 유효숫자 1자리)
            const rawMergedQty = C / D;
            existing.mergedQuantity =
              rawMergedQty >= 0.1
                ? Math.round(rawMergedQty * 10) / 10
                : parseFloat(rawMergedQty.toPrecision(1));
          } else {
            // 일위대가 공식 적용 불가 시: 기존 방식
            existing.mergedQuantity =
              (existing.mergedQuantity || existing.quantity) + row.quantity;
            existing.mergedAmount = Math.round(C * (existing.pricePerSqm || 0));
          }
        } else {
          // 새 병합 행 생성
          const mergedRow: MergedLaborCostRow = {
            ...row,
            mergedSourceIds: [row.id],
            mergedQuantity: row.quantity,
            mergedAmount: row.amount,
          };
          demolitionMap.set(mergeKey, mergedRow);
          result.push(mergedRow);
        }
      } else {
        // 철거공사가 아닌 행은 그대로 추가
        result.push({ ...row });
      }
    });

    return result;
  };

  // 공종별 + 공사명별 그룹화 함수 (이미지와 같이 공종과 공사명 모두 rowspan 적용)
  interface WorkNameSubGroup {
    workName: string;
    rows: MergedLaborCostRow[];
    startIndexInCategory: number;
  }
  interface CategoryGroup {
    category: string;
    rows: MergedLaborCostRow[];
    workNameSubGroups: WorkNameSubGroup[];
    startIndex: number;
  }

  const groupRowsByCategory = (inputRows: LaborCostRow[]): CategoryGroup[] => {
    // 철거공사 동일 항목 병합
    const mergedRows = mergeDemolitionRows(inputRows);

    // 연동 행과 독립(수동 추가) 행 분리
    const linkedRows = mergedRows.filter(
      (r) => r.isLinkedFromRecovery || r.sourceAreaRowId,
    );
    const independentRows = mergedRows.filter(
      (r) => !r.isLinkedFromRecovery && !r.sourceAreaRowId,
    );

    // 연동 행의 공종 순서 추출 (등장 순서 유지)
    const linkedCategories: string[] = [];
    linkedRows.forEach((r) => {
      const cat = r.category || "미지정";
      if (!linkedCategories.includes(cat)) {
        linkedCategories.push(cat);
      }
    });

    // 공종별로 연동 행 + 독립 행 병합
    const categoryRowsMap = new Map<string, MergedLaborCostRow[]>();

    // 먼저 연동 행을 공종별로 정리 (공사명으로 정렬)
    linkedRows.forEach((row) => {
      const cat = row.category || "미지정";
      if (!categoryRowsMap.has(cat)) {
        categoryRowsMap.set(cat, []);
      }
      categoryRowsMap.get(cat)!.push(row);
    });

    // 연동 행 공종별 정렬 (공사명 순)
    categoryRowsMap.forEach((rows, cat) => {
      rows.sort((a, b) => (a.workName || "").localeCompare(b.workName || ""));
    });

    // 같은 공종의 독립 행을 해당 공종 그룹에 추가
    const usedIndependentRows = new Set<string>();
    linkedCategories.forEach((cat) => {
      const matchingIndependent = independentRows.filter(
        (r) => (r.category || "미지정") === cat,
      );
      matchingIndependent.forEach((row) => {
        categoryRowsMap.get(cat)!.push(row);
        usedIndependentRows.add(row.id);
      });
    });

    // 연동 공종에 없는 독립 행들은 별도 그룹으로
    const remainingIndependent = independentRows.filter(
      (r) => !usedIndependentRows.has(r.id),
    );
    remainingIndependent.forEach((row) => {
      const cat = row.category || "미지정";
      if (!categoryRowsMap.has(cat)) {
        categoryRowsMap.set(cat, []);
      }
      categoryRowsMap.get(cat)!.push(row);
    });

    // 독립 행만 있는 공종 목록 추출
    const independentOnlyCategories: string[] = [];
    remainingIndependent.forEach((r) => {
      const cat = r.category || "미지정";
      if (
        !linkedCategories.includes(cat) &&
        !independentOnlyCategories.includes(cat)
      ) {
        independentOnlyCategories.push(cat);
      }
    });

    // 최종 정렬된 행 목록 생성 (연동 공종 우선, 독립만 있는 공종 후순위)
    const sortedRows: MergedLaborCostRow[] = [];
    [...linkedCategories, ...independentOnlyCategories].forEach((cat) => {
      const rows = categoryRowsMap.get(cat) || [];
      sortedRows.push(...rows);
    });

    const groups: CategoryGroup[] = [];
    let currentGroup: CategoryGroup | null = null;
    let globalIndex = 0;

    sortedRows.forEach((row) => {
      if (!currentGroup || currentGroup.category !== row.category) {
        if (currentGroup) {
          groups.push(currentGroup);
        }
        currentGroup = {
          category: row.category || "미지정",
          rows: [row],
          workNameSubGroups: [],
          startIndex: globalIndex,
        };
      } else {
        currentGroup.rows.push(row);
      }
      globalIndex++;
    });

    if (currentGroup) {
      groups.push(currentGroup);
    }

    // 각 공종 그룹 내에서 공사명별 서브그룹 생성
    groups.forEach((group) => {
      let currentSubGroup: WorkNameSubGroup | null = null;
      let indexInCategory = 0;

      group.rows.forEach((row) => {
        if (!currentSubGroup || currentSubGroup.workName !== row.workName) {
          if (currentSubGroup) {
            group.workNameSubGroups.push(currentSubGroup);
          }
          currentSubGroup = {
            workName: row.workName || "",
            rows: [row],
            startIndexInCategory: indexInCategory,
          };
        } else {
          currentSubGroup.rows.push(row);
        }
        indexInCategory++;
      });

      if (currentSubGroup) {
        group.workNameSubGroups.push(currentSubGroup);
      }
    });

    return groups;
  };

  // 특정 행이 공사명 서브그룹의 첫 번째 행인지 확인하는 헬퍼
  const isFirstRowInWorkNameSubGroup = (
    group: CategoryGroup,
    rowId: string,
  ): boolean => {
    for (const subGroup of group.workNameSubGroups) {
      if (subGroup.rows[0]?.id === rowId) {
        return true;
      }
    }
    return false;
  };

  // 특정 행이 속한 공사명 서브그룹의 행 수 반환
  const getWorkNameSubGroupRowCount = (
    group: CategoryGroup,
    rowId: string,
  ): number => {
    for (const subGroup of group.workNameSubGroups) {
      if (subGroup.rows.some((r) => r.id === rowId)) {
        return subGroup.rows.length;
      }
    }
    return 1;
  };

  // 공종 그룹 내 행 추가
  const addRowInCategory = (category: string, afterRowId: string) => {
    if (isReadOnly) return;
    const newRow: LaborCostRow = {
      id: `labor-${Date.now()}-${Math.random()}`,
      sourceAreaRowId: "",
      place: "",
      position: "",
      category: category,
      workName: "",
      detailWork: "",
      detailItem: "",
      priceStandard: "",
      unit: "",
      standardPrice: 0,
      quantity: 1,
      applicationRates: {
        ceiling: false,
        wall: false,
        floor: false,
        molding: false,
      },
      salesMarkupRate: 0,
      pricePerSqm: 0,
      damageArea: 0,
      deduction: 0,
      includeInEstimate: true,
      request: "",
      amount: 0,
    };

    const afterIndex = rows.findIndex((r) => r.id === afterRowId);
    if (afterIndex !== -1) {
      const newRows = [...rows];
      newRows.splice(afterIndex + 1, 0, newRow);
      onRowsChange(newRows);
    } else {
      onRowsChange([...rows, newRow]);
    }
  };

  // 특정 행 삭제 (단일 행 그룹도 삭제 가능)
  const deleteRowById = (rowId: string) => {
    if (isReadOnly) return;
    onRowsChange(rows.filter((r) => r.id !== rowId));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          borderSpacing: 0,
          minWidth: "1200px",
        }}
      >
        <thead>
          <tr
            style={{
              background: "rgba(12, 12, 12, 0.04)",
              height: "48px",
            }}
          >
            <th
              style={{
                width: "40px",
                padding: "0 8px",
                textAlign: "center",
                borderBottom: "1px solid #E5E7EB",
                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
              }}
            >
              <Checkbox
                checked={selectedRows.size === rows.length && rows.length > 0}
                onCheckedChange={onSelectAll}
                data-testid="checkbox-select-all-labor"
              />
            </th>
            <th
              style={{
                width: "120px",
                padding: "0 12px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 600,
                color: "rgba(12, 12, 12, 0.6)",
                textAlign: "center",
                borderBottom: "1px solid #E5E7EB",
                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
              }}
            >
              공종
            </th>
            <th
              style={{
                width: "60px",
                padding: "0 4px",
                fontFamily: "Pretendard",
                fontSize: "12px",
                fontWeight: 500,
                color: "rgba(12, 12, 12, 0.4)",
                textAlign: "center",
                borderBottom: "1px solid #E5E7EB",
                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
              }}
            >
              +/-
            </th>
            <th
              style={{
                width: "120px",
                padding: "0 12px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 600,
                color: "rgba(12, 12, 12, 0.6)",
                textAlign: "center",
                borderBottom: "1px solid #E5E7EB",
                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
              }}
            >
              공사명
            </th>
            <th
              style={{
                width: "120px",
                padding: "0 12px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 600,
                color: "rgba(12, 12, 12, 0.6)",
                textAlign: "center",
                borderBottom: "1px solid #E5E7EB",
                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
              }}
            >
              노임항목
            </th>
            <th
              style={{
                width: "100px",
                padding: "0 12px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 600,
                color: "rgba(12, 12, 12, 0.6)",
                textAlign: "center",
                borderBottom: "1px solid #E5E7EB",
                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
              }}
            >
              복구면적
            </th>
            <th
              style={{
                width: "100px",
                padding: "0 12px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 600,
                color: "rgba(12, 12, 12, 0.6)",
                textAlign: "center",
                borderBottom: "1px solid #E5E7EB",
                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
              }}
            >
              적용단가
            </th>
            <th
              style={{
                width: "120px",
                padding: "0 12px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 600,
                color: "rgba(12, 12, 12, 0.6)",
                textAlign: "center",
                borderBottom: "1px solid #E5E7EB",
                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
              }}
            >
              수량(인)
            </th>
            <th
              style={{
                width: "100px",
                padding: "0 12px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 600,
                color: "rgba(12, 12, 12, 0.6)",
                textAlign: "center",
                borderBottom: "1px solid #E5E7EB",
                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
              }}
            >
              합계
            </th>
            <th
              style={{
                width: "80px",
                padding: "0 12px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 600,
                color: "rgba(12, 12, 12, 0.6)",
                textAlign: "center",
                borderBottom: "1px solid #E5E7EB",
                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
              }}
            >
              경비 여부
            </th>
            <th
              style={{
                width: "150px",
                padding: "0 12px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 600,
                color: "rgba(12, 12, 12, 0.6)",
                textAlign: "center",
                borderBottom: "1px solid #E5E7EB",
              }}
            >
              비고
            </th>
          </tr>
        </thead>
        <tbody>
          {groupRowsByCategory(rows).map((group, groupIndex) =>
            group.rows.map((row, rowIndexInGroup) => {
              const globalIndex = group.startIndex + rowIndexInGroup;
              const isFirstRowInGroup = rowIndexInGroup === 0;
              const isLastRowInGroup =
                rowIndexInGroup === group.rows.length - 1;
              // 연동 행인 경우 공종/공사명은 읽기 전용
              const isLinkedRow = row.isLinkedFromRecovery === true;

              return (
                <tr
                  key={row.id}
                  style={{
                    height: "56px",
                    borderBottom: isLastRowInGroup
                      ? "2px solid rgba(12, 12, 12, 0.15)"
                      : "1px solid rgba(12, 12, 12, 0.06)",
                    background: isLinkedRow
                      ? "rgba(59, 130, 246, 0.03)" // 연동 행 배경색
                      : undefined,
                  }}
                  title={
                    isLinkedRow
                      ? "복구면적에서 자동 생성된 행 (공종/공사명 수정 불가)"
                      : undefined
                  }
                >
                  {/* 체크박스 컬럼 - 그룹 첫 번째 행에만 rowspan 적용 */}
                  {isFirstRowInGroup && (
                    <td
                      rowSpan={group.rows.length}
                      style={{
                        padding: "8px",
                        verticalAlign: "middle",
                        borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                        background: "rgba(12, 12, 12, 0.02)",
                        textAlign: "center",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={group.rows.every((r) => {
                          // 병합된 행인 경우 모든 원본 ID 확인
                          const mergedRow = r as MergedLaborCostRow;
                          if (
                            mergedRow.mergedSourceIds &&
                            mergedRow.mergedSourceIds.length > 1
                          ) {
                            return mergedRow.mergedSourceIds.every((id) =>
                              selectedRows.has(id),
                            );
                          }
                          return selectedRows.has(r.id);
                        })}
                        onChange={() => {
                          const allSelected = group.rows.every((r) => {
                            const mergedRow = r as MergedLaborCostRow;
                            if (
                              mergedRow.mergedSourceIds &&
                              mergedRow.mergedSourceIds.length > 1
                            ) {
                              return mergedRow.mergedSourceIds.every((id) =>
                                selectedRows.has(id),
                              );
                            }
                            return selectedRows.has(r.id);
                          });
                          group.rows.forEach((r) => {
                            const mergedRow = r as MergedLaborCostRow;
                            // 병합된 행인 경우 모든 원본 ID 선택/해제
                            if (
                              mergedRow.mergedSourceIds &&
                              mergedRow.mergedSourceIds.length > 1
                            ) {
                              mergedRow.mergedSourceIds.forEach((sourceId) => {
                                if (allSelected) {
                                  if (selectedRows.has(sourceId))
                                    onSelectRow(sourceId);
                                } else if (!selectedRows.has(sourceId)) {
                                  onSelectRow(sourceId);
                                }
                              });
                            } else {
                              if (allSelected) {
                                onSelectRow(r.id);
                              } else if (!selectedRows.has(r.id)) {
                                onSelectRow(r.id);
                              }
                            }
                          });
                        }}
                        style={{
                          width: "16px",
                          height: "16px",
                          cursor: "pointer",
                        }}
                        data-testid={`checkbox-group-labor-${groupIndex}`}
                      />
                    </td>
                  )}

                  {/* 공종 컬럼 - 그룹 첫 번째 행에만 rowspan 적용 */}
                  {isFirstRowInGroup && (
                    <td
                      rowSpan={group.rows.length}
                      style={{
                        padding: "8px",
                        verticalAlign: "top",
                        borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                        background: isLinkedRow
                          ? "rgba(59, 130, 246, 0.05)"
                          : "rgba(12, 12, 12, 0.02)",
                      }}
                    >
                      {/* 연동 행인 경우 읽기 전용 텍스트, 아니면 Select */}
                      {isLinkedRow ? (
                        <div
                          style={{
                            width: "100%",
                            height: "40px",
                            display: "flex",
                            alignItems: "center",
                            padding: "0 12px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 600,
                            color: "rgba(59, 130, 246, 0.9)",
                            background: "rgba(59, 130, 246, 0.08)",
                            borderRadius: "6px",
                            border: "1px solid rgba(59, 130, 246, 0.2)",
                          }}
                          title="복구면적에서 연동된 공종 (수정 불가)"
                        >
                          <Lock
                            style={{
                              width: "14px",
                              height: "14px",
                              marginRight: "6px",
                              opacity: 0.6,
                            }}
                          />
                          {row.category || ""}
                        </div>
                      ) : (
                        <Select
                          value={row.category || undefined}
                          onValueChange={(value) => {
                            group.rows.forEach((r) =>
                              updateRow(r.id, "category", value),
                            );
                          }}
                        >
                          <SelectTrigger
                            className="border focus:ring-0"
                            style={{
                              width: "100%",
                              height: "40px",
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 600,
                              borderColor: "rgba(12, 12, 12, 0.2)",
                              borderRadius: "6px",
                            }}
                            data-testid={`select-category-labor-${globalIndex}`}
                          >
                            <SelectValue placeholder="공종 선택">
                              {row.category || "공종 선택"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {categoryOptions
                              .filter((opt) => opt && opt.trim() !== "")
                              .map((opt) => (
                                <SelectItem key={opt} value={opt}>
                                  {opt}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                  )}

                  {/* +/- 버튼 컬럼 */}
                  <td
                    style={{
                      padding: "4px",
                      textAlign: "center",
                      width: "60px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        gap: "2px",
                        justifyContent: "center",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => addRowInCategory(row.category, row.id)}
                        disabled={isReadOnly}
                        style={{
                          width: "24px",
                          height: "24px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: isReadOnly ? "#f5f5f5" : "#008FED",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: isReadOnly ? "not-allowed" : "pointer",
                          fontSize: "16px",
                          fontWeight: "bold",
                        }}
                        data-testid={`button-add-labor-row-${globalIndex}`}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRowById(row.id)}
                        disabled={isReadOnly}
                        style={{
                          width: "24px",
                          height: "24px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: isReadOnly ? "#f5f5f5" : "#FF4D4F",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: isReadOnly ? "not-allowed" : "pointer",
                          fontSize: "16px",
                          fontWeight: "bold",
                        }}
                        data-testid={`button-delete-labor-row-${globalIndex}`}
                      >
                        −
                      </button>
                    </div>
                  </td>

                  {/* 공사명 - 각 행마다 별도 셀 (연동 행은 잠금 표시) */}
                  <td style={{ padding: "0 8px" }}>
                    {isLinkedRow ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          height: "36px",
                          padding: "0 8px",
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          color: "rgba(59, 130, 246, 0.9)",
                          background: "rgba(59, 130, 246, 0.08)",
                          borderRadius: "6px",
                          border: "1px solid rgba(59, 130, 246, 0.2)",
                        }}
                        title="복구면적에서 연동됨 (수정 불가)"
                      >
                        <Lock
                          style={{
                            width: "12px",
                            height: "12px",
                            marginRight: "6px",
                            opacity: 0.6,
                          }}
                        />
                        {row.workName || ""}
                      </div>
                    ) : row.category?.includes("기타") ? (
                      <Input
                        value={row.workName || ""}
                        onChange={(e) => handleWorkNameChange(row.id, e.target.value)}
                        className="h-9 border-0"
                        style={{ fontFamily: "Pretendard", fontSize: "14px" }}
                        placeholder="공사명 직접 입력"
                        data-testid={`input-workName-labor-${globalIndex}`}
                      />
                    ) : (
                      <Select
                        value={row.workName || undefined}
                        onValueChange={(value) => handleWorkNameChange(row.id, value)}
                        disabled={!row.category}
                      >
                        <SelectTrigger
                          className="h-9 border-0"
                          style={{ fontFamily: "Pretendard", fontSize: "14px" }}
                          data-testid={`select-workName-labor-${globalIndex}`}
                        >
                          <SelectValue placeholder="공사명 선택">
                            {row.workName || "공사명 선택"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {getWorkNameOptions(row.category, row.workName)
                            .filter((opt) => opt && opt.trim() !== "")
                            .map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {opt}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}
                  </td>

                  {/* 노임항목 - 연동 행은 잠금 표시 */}
                  <td style={{ padding: "0 8px" }}>
                    {isLinkedRow ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          height: "36px",
                          padding: "0 8px",
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          color: "rgba(59, 130, 246, 0.9)",
                          background: "rgba(59, 130, 246, 0.08)",
                          borderRadius: "6px",
                          border: "1px solid rgba(59, 130, 246, 0.2)",
                        }}
                        title="복구면적에서 연동됨 (수정 불가)"
                      >
                        <Lock
                          style={{
                            width: "12px",
                            height: "12px",
                            marginRight: "6px",
                            opacity: 0.6,
                          }}
                        />
                        {row.detailItem || ""}
                      </div>
                    ) : detailItemInputMode[row.id] ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={row.detailItem === "직접입력" ? "" : (row.detailItem || "")}
                          onChange={(e) => updateRow(row.id, "detailItem", e.target.value)}
                          className="h-9 border-0 flex-1"
                          style={{ fontFamily: "Pretendard", fontSize: "14px" }}
                          placeholder="직접 입력"
                          data-testid={`input-laborItem-${globalIndex}`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setDetailItemInputMode(prev => ({ ...prev, [row.id]: false }));
                            updateRow(row.id, "detailItem", "");
                          }}
                          style={{
                            width: "20px",
                            height: "20px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            color: "rgba(12, 12, 12, 0.4)",
                            fontSize: "14px",
                          }}
                          title="목록 선택으로 돌아가기"
                          data-testid={`button-laborItem-back-${globalIndex}`}
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <Select
                        value={row.detailItem || undefined}
                        onValueChange={(value) => {
                          if (value === "직접입력") {
                            setDetailItemInputMode(prev => ({ ...prev, [row.id]: true }));
                            updateRow(row.id, "detailItem", "");
                          } else {
                            updateRow(row.id, "detailItem", value);
                          }
                        }}
                        disabled={!row.workName}
                      >
                        <SelectTrigger
                          className="h-9 border-0"
                          style={{ fontFamily: "Pretendard", fontSize: "14px" }}
                          data-testid={`select-laborItem-${globalIndex}`}
                        >
                          <SelectValue placeholder="선택" />
                        </SelectTrigger>
                        <SelectContent>
                          {getDetailItemOptions(
                            row.category,
                            row.workName,
                            row.detailWork || "노무비",
                          )
                            .filter((opt) => opt && opt.trim() !== "")
                            .map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {opt}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}
                  </td>

                  {/* 복구면적 - 연동행만 같은 공사명끼리 rowspan 병합, 직접추가는 개별 셀 (0 고정) */}
                  {/* 복구면적은 공사명별로 합산 (바닥+벽체+천장×1.3) - 연동행만 적용 */}
                  {(() => {
                    // 직접 추가 행은 개별 셀로 표시 (항상 0, 수정 불가)
                    if (!isLinkedRow) {
                      return (
                        <td
                          style={{
                            padding: "0 8px",
                            background: "rgba(12, 12, 12, 0.02)",
                            verticalAlign: "middle",
                          }}
                        >
                          <Input
                            type="number"
                            value={0}
                            className="h-9 border text-center"
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              color: "rgba(12, 12, 12, 0.4)",
                              backgroundColor: "rgba(12, 12, 12, 0.05)",
                            }}
                            disabled={true}
                            title="직접 추가 행의 복구면적은 0 (수정 불가)"
                            data-testid={`input-recoveryArea-labor-${globalIndex}`}
                          />
                        </td>
                      );
                    }

                    // 연동 행만 같은 공사명끼리 rowspan 병합
                    const sameWorkNameLinkedRows = group.rows.filter(
                      (r) =>
                        r.workName === row.workName &&
                        r.isLinkedFromRecovery === true,
                    );
                    const isFirstInWorkNameGroup =
                      sameWorkNameLinkedRows.length > 0 &&
                      sameWorkNameLinkedRows[0].id === row.id;
                    const workNameRowCount = sameWorkNameLinkedRows.length;

                    // 공사명별 합산 복구면적 (calculateRecoveryAreaByWorkName에서 계산된 값 사용)
                    const aggregatedArea =
                      calculateRecoveryAreaByWorkName[row.workName] ||
                      row.damageArea ||
                      0;

                    // 첫 번째 연동 행이 아니면 td 렌더링 스킵 (rowspan으로 병합됨)
                    if (!isFirstInWorkNameGroup) return null;

                    return (
                      <td
                        rowSpan={workNameRowCount}
                        style={{
                          padding: "0 8px",
                          background: "rgba(59, 130, 246, 0.05)",
                          verticalAlign: "middle",
                        }}
                      >
                        <Input
                          type="number"
                          step="0.1"
                          value={Number(aggregatedArea.toFixed(1))}
                          onChange={(e) =>
                            updateRow(
                              row.id,
                              "damageArea",
                              Math.round(Number(e.target.value) * 10) / 10 || 0,
                            )
                          }
                          className="h-9 border text-center"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            color: "rgba(59, 130, 246, 0.9)",
                          }}
                          disabled={true}
                          title="복구면적에서 자동 계산됨 (바닥+벽체+천장×1.3)"
                          data-testid={`input-recoveryArea-labor-${globalIndex}`}
                        />
                      </td>
                    );
                  })()}

                  {/* 적용단가 - 일위대가: F(구간별 요율 적용), 노무비: 기준가(단가_인) 표시 */}
                  <td
                    style={{
                      padding: "0 8px",
                      background: isLinkedRow
                        ? "rgba(59, 130, 246, 0.05)"
                        : undefined,
                    }}
                  >
                    {(() => {
                      const isIlwidaega = row.detailWork === "일위대가";
                      const displayPrice = isIlwidaega
                        ? Math.round(row.pricePerSqm || 0)
                        : (row.standardPrice || 0);
                      return (
                        <Input
                          type="text"
                          inputMode="numeric"
                          defaultValue={
                            displayPrice > 0
                              ? displayPrice.toLocaleString()
                              : "0"
                          }
                          key={`price-${row.id}-${isIlwidaega ? row.pricePerSqm : row.standardPrice}`}
                          onFocus={(e) => {
                            const rawValue = e.target.value.replace(/[,\s]/g, "");
                            e.target.value = rawValue;
                          }}
                          onBlur={(e) => {
                            const rawValue = e.target.value.replace(/[,\s]/g, "");
                            const val = parseInt(rawValue, 10) || 0;
                            e.target.value = val > 0 ? val.toLocaleString() : "0";
                            if (!isIlwidaega) {
                              updateRow(row.id, "standardPrice", val);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur();
                            }
                          }}
                          className="h-9 border text-center"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            color: isLinkedRow
                              ? "rgba(59, 130, 246, 0.9)"
                              : undefined,
                          }}
                          disabled={isLinkedRow || isIlwidaega || isReadOnly}
                          data-testid={`input-unitPrice-labor-${globalIndex}`}
                        />
                      );
                    })()}
                  </td>

                  {/* 수량(인) - 연동행: I÷E (합계÷노임단가), 직접추가행: 화살표/수기 입력 가능 (소수점 1자리, 음수 불가) */}
                  <td
                    style={{
                      padding: "0 8px",
                      background: isLinkedRow
                        ? "rgba(59, 130, 246, 0.05)"
                        : undefined,
                    }}
                  >
                    {(() => {
                      // 연동행: 수량 = I ÷ E (합계 ÷ 노임단가)
                      // 직접추가행: 수기/화살표 입력 가능
                      const I =
                        (row as MergedLaborCostRow).mergedAmount ??
                        row.amount ??
                        0;
                      const E = row.standardPrice || 0;

                      // 연동행은 자동계산된 값 표시, 직접추가행은 row.quantity 사용
                      const displayQuantity = isLinkedRow
                        ? E > 0
                          ? Math.round((I / E) * 100) / 100
                          : 0
                        : row.quantity || 0;

                      return (
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          value={
                            isLinkedRow
                              ? displayQuantity.toFixed(1)
                              : displayQuantity || ""
                          }
                          onChange={(e) => {
                            // 직접추가행만 수정 가능
                            if (isLinkedRow) return;

                            const numValue = parseFloat(e.target.value) || 0;
                            // 음수 방지: 0 미만이면 0으로 설정
                            const safeValue = Math.max(0, numValue);
                            // 소수점 1자리까지 반올림
                            const roundedValue =
                              Math.round(safeValue * 10) / 10;
                            updateRow(row.id, "quantity", roundedValue);
                          }}
                          className="h-9 border text-center"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            color: isLinkedRow
                              ? "rgba(59, 130, 246, 0.9)"
                              : undefined,
                          }}
                          disabled={
                            isLinkedRow ||
                            ((row as MergedLaborCostRow).mergedSourceIds
                              ?.length ?? 0) > 1 ||
                            isReadOnly
                          }
                          placeholder="0"
                          data-testid={`input-quantity-labor-${globalIndex}`}
                        />
                      );
                    })()}
                  </td>

                  {/* 합계 - 병합된 행은 합산값 표시 */}
                  <td
                    style={{
                      padding: "0 12px",
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 600,
                      color: isLinkedRow
                        ? "rgba(59, 130, 246, 0.9)"
                        : "#0C0C0C",
                      textAlign: "center",
                      background: isLinkedRow
                        ? "rgba(59, 130, 246, 0.05)"
                        : "rgba(12, 12, 12, 0.02)",
                    }}
                  >
                    {(
                      (row as MergedLaborCostRow).mergedAmount ??
                      row.amount ??
                      0
                    ).toLocaleString()}
                  </td>

                  {/* 경비 여부 - 연동 행도 수정 가능 */}
                  <td style={{ padding: "0 12px", textAlign: "center" }}>
                    <Checkbox
                      checked={!row.includeInEstimate}
                      onCheckedChange={(checked) => {
                        // 연동 행이어도 경비 여부는 수정 가능
                        onRowsChange(
                          rows.map((r) =>
                            r.id === row.id
                              ? { ...r, includeInEstimate: !checked }
                              : r,
                          ),
                        );
                      }}
                      data-testid={`checkbox-expense-labor-${globalIndex}`}
                    />
                  </td>

                  {/* 비고 - 연동 행도 수정 가능 */}
                  <td style={{ padding: "0 8px" }}>
                    <Input
                      value={row.request}
                      onChange={(e) => {
                        // 연동 행이어도 비고는 수정 가능
                        onRowsChange(
                          rows.map((r) =>
                            r.id === row.id
                              ? { ...r, request: e.target.value }
                              : r,
                          ),
                        );
                      }}
                      className="h-9 border"
                      style={{ fontFamily: "Pretendard", fontSize: "14px" }}
                      placeholder=""
                      data-testid={`input-note-labor-${globalIndex}`}
                    />
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
        <tfoot>
          <tr
            style={{
              height: "48px",
              background: "rgba(12, 12, 12, 0.04)",
              borderTop: "2px solid rgba(12, 12, 12, 0.2)",
            }}
          >
            <td
              colSpan={8}
              style={{
                padding: "0 12px",
                textAlign: "right",
                fontFamily: "Pretendard",
                fontSize: "16px",
                fontWeight: 600,
                color: "#0C0C0C",
              }}
            >
              총합계
            </td>
            <td
              style={{
                padding: "0 12px",
                fontFamily: "Pretendard",
                fontSize: "18px",
                fontWeight: 700,
                color: "#008FED",
                textAlign: "center",
                background: "rgba(0, 143, 237, 0.05)",
              }}
              data-testid="text-labor-total-in-table"
            >
              {rows
                .reduce((sum, row) => sum + (row.amount || 0), 0)
                .toLocaleString()}
            </td>
            <td colSpan={2}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
