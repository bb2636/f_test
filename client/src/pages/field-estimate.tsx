import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Case, MasterData, LaborCost, User, LaborRateTier, UnitPriceOverride } from "@shared/schema";
import {
  useLaborRateTiers,
  calculateIWithTiers,
  calculateAppliedUnitPriceWithTiers,
  calculateQuantityWithTiers,
  DEFAULT_LABOR_RATE_TIERS_FALLBACK,
} from "@/hooks/use-labor-rate-tiers";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Check, Search, Copy, GripVertical } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FieldSurveyLayout } from "@/components/field-survey-layout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCaseNumber } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  getFieldSurveyCaseId,
  setFieldSurveyCaseId,
  subscribeFieldSurveyCaseId,
} from "@/lib/detached-window";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LaborCostSection, type LaborCatalogItem, type LaborCostRow } from "@/components/labor-cost-section";
import { mergeDemolitionRows as mergeLaborRowsForTotal, getMergedRowAmount, isFixedLaborWorkName, isMergeableLaborRow } from "@/lib/labor-merge";
import { MaterialCostSection, type MaterialCatalogItem, type MaterialRow } from "@/components/material-cost-section";
import { useMobileMode } from "@/lib/mobile-mode";
import {
  createAutoSaveScheduler,
  type AutoSaveSchedulerDeps,
} from "@/lib/auto-save-scheduler";

// 복구면적 → 노무비/자재비 자동 동기화 적용 시작 시각 (KST, ISO 8601)
// 이 시각(포함) 이후 생성된 신규 접수건에서만 자동 동기화가 동작한다.
// 그 이전에 생성된 모든 기존 접수건은 자동 동기화가 트리거되지 않는다.
// 비교는 케이스의 createdAtTimestamp(시각 포함) 필드와 문자열 사전 순서 비교로 수행한다.
// (모든 시각 문자열이 동일한 +09:00 오프셋을 사용하므로 사전 비교 = 시간 비교가 성립)
// 기존 케이스는 createdAtTimestamp가 NULL이므로 자동으로 legacy 처리된다.
// (사용자가 노무비/자재비 탭의 "복구면적 가져오기" 수동 버튼을 직접 누르는 경우는 별개)
const AUTO_SYNC_CUTOFF_KST = "2026-04-24T13:00:00+09:00";

interface AreaCalculationRow {
  id: string;
  category: string; // 장소: 주방, 화장실, 방안, 거실상
  location: string; // 위치
  workType: string; // 공종: 방수공사, 도배공사 등
  workName: string; // 공사명
  damageWidth: string; // 피해면적 가로 (mm)
  damageHeight: string; // 피해면적 세로 (mm)
  damageArea: string; // 피해면적 면적 (m²)
  repairWidth: string; // 복구면적 가로 (mm)
  repairHeight: string; // 복구면적 세로 (mm)
  repairArea: string; // 복구면적 면적 (m²)
  note: string; // 비고
}

// 대물피해 케이스 복구면적 산출표 샘플 템플릿
// 각 샘플은 장소/위치/공종/공사명만 미리 채우고 면적값은 사용자가 직접 입력
type SampleRowSeed = Pick<AreaCalculationRow, "category" | "location" | "workType" | "workName">;
interface SampleTemplate {
  key: string;
  label: string;
  rows: SampleRowSeed[];
}
const PROPERTY_DAMAGE_SAMPLE_TEMPLATES: SampleTemplate[] = [
  {
    key: "bathroom",
    label: "화장실(대물)",
    rows: [
      { category: "화장실1", location: "천장", workType: "욕실공사", workName: "SMC" },
      { category: "화장실1", location: "바닥", workType: "가설공사", workName: "건축물보양" },
      { category: "거실/복도", location: "바닥", workType: "가설공사", workName: "건축물보양" },
    ],
  },
  {
    key: "balcony",
    label: "발코니(대물)",
    rows: [
      { category: "거실", location: "바닥", workType: "가설공사", workName: "건축물보양" },
      { category: "발코니", location: "천장", workType: "도장공사", workName: "" },
      { category: "발코니", location: "벽면", workType: "도장공사", workName: "" },
      { category: "발코니", location: "바닥", workType: "가설공사", workName: "건축물보양" },
    ],
  },
  {
    key: "bedroom",
    label: "침실(대물)",
    rows: [
      { category: "주방(복도)", location: "바닥", workType: "가설공사", workName: "건축물보양" },
      { category: "침실1", location: "천장", workType: "목공사", workName: "반자틀" },
      { category: "침실1", location: "천장", workType: "목공사", workName: "석고보드" },
      { category: "침실1", location: "천장", workType: "수장공사", workName: "도배" },
      { category: "침실1", location: "벽면", workType: "수장공사", workName: "도배" },
      { category: "침실1", location: "바닥", workType: "가설공사", workName: "건축물보양" },
    ],
  },
  {
    key: "kitchen_living",
    label: "주방 및 거실(대물)",
    rows: [
      { category: "거실", location: "천장", workType: "목공사", workName: "반자틀" },
      { category: "거실", location: "천장", workType: "목공사", workName: "석고보드" },
      { category: "거실", location: "천장", workType: "수장공사", workName: "도배" },
      { category: "거실", location: "벽면", workType: "수장공사", workName: "도배" },
      { category: "거실", location: "바닥", workType: "가설공사", workName: "건축물보양" },
      { category: "거실(복도)", location: "천장", workType: "목공사", workName: "반자틀" },
      { category: "거실(복도)", location: "천장", workType: "목공사", workName: "석고보드" },
      { category: "거실(복도)", location: "천장", workType: "수장공사", workName: "도배" },
      { category: "거실(복도)", location: "벽면", workType: "수장공사", workName: "도배" },
      { category: "거실(복도)", location: "바닥", workType: "가설공사", workName: "건축물보양" },
      { category: "주방", location: "천장", workType: "목공사", workName: "반자틀" },
      { category: "주방", location: "천장", workType: "목공사", workName: "석고보드" },
      { category: "주방", location: "천장", workType: "수장공사", workName: "도배" },
      { category: "주방", location: "벽면", workType: "수장공사", workName: "도배" },
      { category: "주방", location: "바닥", workType: "가설공사", workName: "건축물보양" },
    ],
  },
];

// ===== 손해방지(원인세대) 케이스용 노무비/자재비 샘플 템플릿 =====
interface LossSampleLaborSeed {
  category: string;   // 공종 (누수탐지/원인공사/원인철거)
  workName: string;   // 공사명
  detailItem: string; // 노임항목
}
interface LossSampleMaterialSeed {
  workType: string;   // 공종
  workName: string;   // 공사명
  materialName: string; // 자재항목
}
interface LossPreventionSampleTemplate {
  key: string;
  label: string;
  laborRows: LossSampleLaborSeed[];
  materialRows: LossSampleMaterialSeed[];
}
const LOSS_PREVENTION_SAMPLE_TEMPLATES: LossPreventionSampleTemplate[] = [
  {
    key: "lp_bathroom",
    label: "화장실(손방)",
    laborRows: [
      { category: "누수탐지", workName: "누수탐지", detailItem: "누수탐지1회" },
      { category: "원인공사", workName: "방수", detailItem: "방수공" },
      { category: "원인공사", workName: "방수", detailItem: "보통인부" },
      { category: "원인철거", workName: "철거", detailItem: "보통인부" },
    ],
    materialRows: [
      { workType: "원인공사", workName: "방수", materialName: "도막방수재 고뫄스 18L" },
      { workType: "원인공사", workName: "방수", materialName: "방수프라이머 18L" },
      { workType: "원인공사", workName: "방수", materialName: "액체모르타르방수재 가사리(20L)" },
      { workType: "원인공사", workName: "방수", materialName: "레미탈" },
    ],
  },
  {
    key: "lp_caulking",
    label: "코킹(손방)",
    laborRows: [
      { category: "누수탐지", workName: "누수탐지", detailItem: "육안탐지" },
      { category: "원인공사", workName: "코킹", detailItem: "코킹공" },
      { category: "원인철거", workName: "철거", detailItem: "보통인부" },
    ],
    materialRows: [
      { workType: "원인공사", workName: "코킹", materialName: "실란트" },
    ],
  },
  {
    key: "lp_pipe",
    label: "배관(손방)",
    laborRows: [
      { category: "누수탐지", workName: "누수탐지", detailItem: "누수탐지1회" },
      { category: "원인공사", workName: "배관", detailItem: "배관공" },
      { category: "원인철거", workName: "철거", detailItem: "보통인부" },
    ],
    materialRows: [
      { workType: "원인공사", workName: "배관", materialName: "" },
    ],
  },
  {
    key: "lp_floor_drain",
    label: "유가방수(손방)",
    laborRows: [
      { category: "누수탐지", workName: "누수탐지", detailItem: "누수탐지1회" },
      { category: "원인공사", workName: "방수", detailItem: "방수공" },
    ],
    materialRows: [
      { workType: "원인공사", workName: "방수", materialName: "" },
    ],
  },
];

// Import LaborCatalogItem and LaborCostRow from labor-cost-section.tsx (removed duplicates)

interface Material {
  id: number; // DB ID
  workType: string; // 공종: 방수공사, 도배공사 등
  materialName: string; // 자재명
  specification: string; // 규격
  unit: string; // 단위
  standardPrice: number; // 단가 (숫자)
  isActive: string; // "true" | "false"
  createdAt: string; // ISO timestamp string from API
  updatedAt: string; // ISO timestamp string from API
}

// 일위대가 카탈로그 아이템 인터페이스
interface IlwidaegaCatalogItem {
  공종: string;
  공사명: string;
  노임항목: string;
  기준작업량: number | null;  // D
  노임단가: number | null;    // E (노임단가(인당))
  일위대가: number | null;    // E/D (참고용)
}

// 자재비 카탈로그 아이템 (공사명 기준 조회용)
interface MaterialByWorknameCatalogItem {
  공종: string; // 공종: 원인공사, 목공사, 수장공사 등
  공사명: string; // 공사명: 방수, 합판, 도배 등
  자재항목: string; // 자재비DB의 자재항목 컬럼
  규격?: string; // 규격 (선택 필드)
  단위: string;
  금액: number | string | null;
}

// MaterialRow는 "@/components/material-cost-section"에서 import

// ===== 노임비 계산 공식 (알파벳 정의) =====
// D = 기준작업량 (일위대가 DB)
// C = 복구면적 (노무비 계산값)
// E = 노임단가 (일위대가 DB)
// F = C/D 비율에 따른 적용단가 (E 기준 할인율 적용) - DB에서 가져온 요율 사용
// H = C≥D: (C-D)×(E÷D) / C<D: 0
// I = F + H (최종 노임비)
// 적용단가 = E (노임단가, DB 값)
// 수량(인) = I / E (합계 / 적용단가)
// 합계 = I
// (calculateF, calculateH, calculateI, calculateAppliedUnitPrice는 use-labor-rate-tiers.ts에서 import)

const CATEGORIES = ["복구면적 산출표", "노무비", "자재비", "견적서"];
// 손해방지 케이스용 카테고리 (복구면적 산출표 제외)
const CATEGORIES_LOSS_PREVENTION = ["노무비", "자재비", "견적서"];

// 노무비 행을 공종별로 정렬하는 헬퍼 함수 (같은 공종끼리 묶음)
// 독립 추가 행(isLinkedFromRecovery=false, sourceAreaRowId 없음)은 맨 아래에 유지
const sortLaborRowsByCategory = (rows: LaborCostRow[]): LaborCostRow[] => {
  // 연동 행과 독립 행 분리
  const linkedRows = rows.filter(r => r.isLinkedFromRecovery || r.sourceAreaRowId);
  const independentRows = rows.filter(r => !r.isLinkedFromRecovery && !r.sourceAreaRowId);
  
  // 연동 행만 정렬 (공종 → 공사명 순)
  const sortedLinkedRows = [...linkedRows].sort((a, b) => {
    const categoryA = a.category || '';
    const categoryB = b.category || '';
    if (categoryA !== categoryB) {
      return categoryA.localeCompare(categoryB, 'ko');
    }
    // 같은 공종 내에서는 공사명으로 정렬
    const workNameA = a.workName || '';
    const workNameB = b.workName || '';
    return workNameA.localeCompare(workNameB, 'ko');
  });
  
  // 독립 행은 맨 아래에 순서 유지하며 추가
  return [...sortedLinkedRows, ...independentRows];
};

export default function FieldEstimate() {
  // Hydration guard: 기존 견적 복원 완료 추적 (중복 행 방지)
  const isHydratedRef = useRef(false);
  const [isHydratedState, setIsHydratedState] = useState(false); // 컴포넌트 전달용 상태
  
  // 초기 로드 직후 자동 동기화 방지 (새 행 자동 생성 방지)
  const skipAutoSyncRef = useRef(true);

  // [원본보존-협력업체] 협력업체 진입 시 어떠한 자동 변형(useEffect)도 발동되지 않도록
  // 컴포넌트 함수 최상단에 ref를 두고 currentUser 로드 시 갱신.
  // ref이므로 isPartner 변수 선언(2200행대) 이전에 위치한 dedup useEffect에서도 안전하게 참조 가능.
  // currentUser가 아직 undefined면 ref는 false 유지 → 다른 가드(`!currentUser || isPartner`)와 함께 보수적으로 차단.
  const isPartnerRef = useRef(false);
  const isUserLoadedRef = useRef(false);

  // 싱크 결과 자동 저장: 화면(sync 결과)과 DB가 항상 일치하도록 자동 저장
  // - isAutoSavingRef: 자동 저장 중인지 표시 → onSuccess에서 toast 스킵
  // [Task #12] 디바운스 타이머/baseline hash는 `auto-save-scheduler.ts`로 이동.
  //   - 자동 저장 트리거 모듈은 단위 테스트(client/src/lib/auto-save-scheduler.test.ts)
  //     로 회귀 시나리오 4종 + 협력업체 가드를 자동 검증한다.
  const isAutoSavingRef = useRef(false);
  const rowsRef = useRef<AreaCalculationRow[]>([]);
  const laborCostRowsRef = useRef<LaborCostRow[]>([]);
  const materialRowsRef = useRef<MaterialRow[]>([]);
  // [Task #11] 자동 저장 가드 검증용 — deletedLinkedLaborKeys latest 추적.
  const deletedLinkedLaborKeysRef = useRef<Set<string>>(new Set());

  // 노임단가 적용비율 데이터 (DB에서 가져옴)
  const { data: laborRateTiersData } = useLaborRateTiers();
  const laborRateTiers = laborRateTiersData || DEFAULT_LABOR_RATE_TIERS_FALLBACK;

  const [selectedCategory, setSelectedCategory] = useState("복구면적 산출표");
  const [rows, setRows] = useState<AreaCalculationRow[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [laborCostRows, setLaborCostRows] = useState<LaborCostRow[]>([]);
  const [selectedLaborRows, setSelectedLaborRows] = useState<Set<string>>(new Set());
  const [materialRows, setMaterialRows] = useState<MaterialRow[]>([]);
  const [selectedMaterialRows, setSelectedMaterialRows] = useState<Set<string>>(new Set());
  const [deletedLinkedLaborKeys, setDeletedLinkedLaborKeys] = useState<Set<string>>(new Set()); // 수동 삭제된 연동 노무비 키 추적 (철거공사 + 다른 공사명)
  const [exclusionsLoaded, setExclusionsLoaded] = useState(false); // exclusions 로드 완료 여부
  const [vatIncluded, setVatIncluded] = useState(true); // VAT 포함 여부
  const [estimateCase, setEstimateCase] = useState<Case | null>(null); // 견적서용 선택된 케이스
  const [caseSearchModalOpen, setCaseSearchModalOpen] = useState(false); // 케이스 검색 모달
  const [customWorkTypes, setCustomWorkTypes] = useState<string[]>([]); // 사용자가 추가한 공종 목록
  const [workTypeInputMode, setWorkTypeInputMode] = useState<{[rowId: string]: boolean}>({}); // 행별 직접입력 모드
  const [customWorkNames, setCustomWorkNames] = useState<string[]>([]); // 사용자가 추가한 공사내용 목록
  const [workNameInputMode, setWorkNameInputMode] = useState<{[rowId: string]: boolean}>({}); // 행별 직접입력 모드
  const [selectedCaseId, setSelectedCaseId] = useState(() => getFieldSurveyCaseId());

  // [Task #11] latest state ref 동기화 — triggerAutoSaveAfterSync의 setTimeout
  //   콜백이 stale closure를 보지 않도록, 매 렌더에서 ref를 최신 state로 갱신.
  //   기존 state/sync 로직은 일절 미변경 (읽기 전용 ref).
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => { laborCostRowsRef.current = laborCostRows; }, [laborCostRows]);
  useEffect(() => { materialRowsRef.current = materialRows; }, [materialRows]);
  useEffect(() => { deletedLinkedLaborKeysRef.current = deletedLinkedLaborKeys; }, [deletedLinkedLaborKeys]);

  // 케이스 변경 시 DB에서 삭제된 연동 노무비 키 로드 (영속화된 데이터)
  useEffect(() => {
    const currentCaseId = estimateCase?.id || selectedCaseId;
    if (!currentCaseId) {
      setDeletedLinkedLaborKeys(new Set());
      setExclusionsLoaded(false);
      return;
    }
    
    // 케이스 변경 시 먼저 로드 상태 리셋
    setExclusionsLoaded(false);
    
    const loadExclusions = async () => {
      try {
        // 철거공사 + 다른 공사명 삭제 키 모두 로드
        const response = await fetch(`/api/cases/${currentCaseId}/estimate-exclusions?type=linked_labor_deletion`, {
          credentials: 'include',
        });
        if (response.ok) {
          const exclusions = await response.json();
          const keys = new Set<string>(exclusions.map((e: { deletionKey: string }) => e.deletionKey));
          // [증거 2] LOADED_EXCLUSION_KEYS
          console.log('LOADED_EXCLUSION_KEYS', { 
            caseId: currentCaseId, 
            keys: Array.from(keys), 
            count: keys.size 
          });
          setDeletedLinkedLaborKeys(keys);
          setExclusionsLoaded(true);
        } else {
          // 오류 시에도 로드 완료 처리 (빈 상태)
          setExclusionsLoaded(true);
        }
      } catch (err) {
        console.error('[연동 노무비 exclusions 로드 오류]', err);
        setExclusionsLoaded(true); // 오류 시에도 로드 완료 처리
      }
    };
    
    loadExclusions();
  }, [selectedCaseId, estimateCase?.id]);
  

  // 케이스 변경 감지 (현장입력/접수번호 탭에서 케이스 선택 시).
  // 보고서 열람 분리창이면 창 단위(CustomEvent+sessionStorage), 인앱이면 공유 localStorage.
  useEffect(() => {
    return subscribeFieldSurveyCaseId((newCaseId) => {
      setSelectedCaseId(prevId => (newCaseId !== prevId ? newCaseId : prevId));
    });
  }, []); // dependency 제거 (한 번만 설정)

  // 자재비 동기화 중복 호출 방지 ref (공종+공사명별 진행 중인 동기화 추적)
  const materialSyncInProgressRef = useRef<Set<string>>(new Set());
  
  // 수동 동기화(복구면적 가져오기) 실행 중 가드 — 다른 useEffect가 간섭하지 않도록 보호
  const syncGuardRef = useRef<boolean>(false);
  const lastLaborSetSourceRef = useRef<string>('init');
  const lastLaborSyncedAreaHashRef = useRef<string>('');
  const lastMaterialSyncedAreaHashRef = useRef<string>('');
  
  useEffect(() => {
    const linkedCount = laborCostRows.filter(r => r.isLinkedFromRecovery).length;
    const independentCount = laborCostRows.filter(r => !r.isLinkedFromRecovery).length;
    const demolitionCount = laborCostRows.filter(r => r.category === '철거공사').length;
    console.log('[LABOR_STATE_TRACKER]', {
      source: lastLaborSetSourceRef.current,
      total: laborCostRows.length,
      linked: linkedCount,
      independent: independentCount,
      demolition: demolitionCount,
      syncGuard: syncGuardRef.current,
      ids: laborCostRows.slice(0, 5).map(r => r.id?.substring(0, 25)),
    });
  }, [laborCostRows]);

  // 노무비 행 중복 자동 제거 (React 배치 처리로 인한 중복 방지)
  // 연동된 행(isLinkedFromRecovery=true)에서 같은 키 조합은 첫 번째만 유지
  // 철거공사 행: sourceAreaRowId|공종|공사명|노임항목 (각 복구면적 행별 개별 관리)
  // 일반 행: 공종|공사명|노임항목
  const lastDeduplicationRef = useRef<string>('');
  useEffect(() => {
    // [원본보존-협력업체] currentUser 미로드 또는 협력업체이면 dedup 자체를 건너뛴다.
    // (감지 key와 제거 key가 미세하게 다른 잠재적 위험을 차단)
    if (!isUserLoadedRef.current || isPartnerRef.current) return;
    if (laborCostRows.length === 0) return;
    
    if (syncGuardRef.current) {
      console.log('[노무비 중복 제거] syncGuard 활성 — 건너뛰기');
      return;
    }
    
    const linkedRows = laborCostRows.filter(r => r.isLinkedFromRecovery);
    const keyCount: Record<string, number> = {};
    let hasDuplicates = false;
    
    for (const row of linkedRows) {
      // 위치별 행 보존: 모든 연동 행은 sourceAreaRowId까지 키에 포함
      // (욕실/가구 FIXED 본체 행 + 철거공사 동반행 등 위치별 다수 행 보존)
      const key = row.sourceAreaRowId
        ? `${row.sourceAreaRowId}|${row.category}|${row.workName}|${row.detailItem}`
        : `${row.category}|${row.workName}|${row.detailItem}`;
      keyCount[key] = (keyCount[key] || 0) + 1;
      if (keyCount[key] > 1) {
        hasDuplicates = true;
      }
    }
    
    if (!hasDuplicates) return;
    
    const currentStateKey = laborCostRows.map(r => r.id).join(',');
    if (currentStateKey === lastDeduplicationRef.current) return;
    
    console.log('[노무비 중복 제거] 중복 감지, 자동 제거 실행');
    
    const seen = new Set<string>();
    const deduplicatedRows = laborCostRows.filter(row => {
      if (!row.isLinkedFromRecovery) return true;
      
      const needsSourceRowKey = row.category === '철거공사' && row.sourceAreaRowId;
      const key = needsSourceRowKey
        ? `${row.sourceAreaRowId}|${row.category}|${row.workName}|${row.detailItem}`
        : `${row.category}|${row.workName}|${row.detailItem}`;
      if (seen.has(key)) {
        console.log('[노무비 중복 제거] 제거:', row.category, row.workName, row.detailItem);
        return false;
      }
      seen.add(key);
      return true;
    });
    
    if (deduplicatedRows.length !== laborCostRows.length) {
      lastDeduplicationRef.current = deduplicatedRows.map(r => r.id).join(',');
      lastLaborSetSourceRef.current = 'deduplication';
      setLaborCostRows(deduplicatedRows);
    }
  }, [laborCostRows]);

  // 자재비 행 중복 자동 제거 (React 배치 처리로 인한 중복 방지)
  // 연동된 행(isLinkedFromRecovery=true)에서 같은 공종+공사명 조합은 첫 번째만 유지
  // [회귀 수정 2026-05-04 재롤백] 직전 fix(자재항목 포함 키)는 가설공사/건축물보양 같이
  // syncMaterialFromRecoveryArea가 매칭에 실패해 매번 새 행을 만드는 케이스에서 4중복을
  // 그대로 통과시켰다. 사용자 요청(실크+합지 수량 1로 합산)도 동일하게 공종+공사명 단위
  // dedup이어야 충족된다. 따라서 키를 다시 `공종|공사명`으로 되돌린다.
  // [Bug 1 fix 2026-05-04] 협력업체 가드 제거.
  //   - 직전 commits(3f9e4bf, fce921b)로 협력업체에서도 sync useEffect가 실행되도록 변경됨.
  //   - 그러나 dedup useEffect만 isPartnerRef 가드를 유지해 협력업체에서는 중복 제거가 발동하지
  //     않아 "복구면적 가져오기" 클릭 시 보양재 등이 매 클릭마다 누적되는 회귀 발생.
  //   - sync 로직과 동일하게 협력업체에서도 dedup이 동작하도록 가드를 제거. 자동 저장 차단은
  //     별도(저장 mutation 단계)에서 그대로 유지되므로 데이터 정합성 위험 없음.
  // [별칭 정규화 2026-05-05] 자재비 매칭/dedup 키에서 동의어를 단일 명칭으로 환원.
  // 가설공사: '건축물보양'(일위대가DB 신규 명칭) ↔ '건축물현장정리'(자재비DB 명칭) → '건축물현장정리'로 통일.
  // 이로써 두 명칭으로 생성된 자재비 행들이 동일 key로 dedup·매칭되어 중복 누적이 차단된다.
  const normalizeMaterialWorkName = (공종: string, 공사명: string): string => {
    const w = (공종 || '').trim();
    const n = (공사명 || '').trim();
    if (w === '가설공사' && n === '건축물보양') return '건축물현장정리';
    return n;
  };

  const lastMaterialDeduplicationRef = useRef<string>('');
  // [Bug 1 fix 2026-05-04] 가드 변경 — partner도 dedup 동작.
  useEffect(() => {
    // currentUser 미로드 시에만 dedup 보류 (partner 가드 제거 — Bug 1).
    if (!isUserLoadedRef.current) return;
    if (materialRows.length === 0) return;
    
    // 중복 체크: 연동된 행에서 같은 key가 여러 개인지 확인
    // [2026-05-05] 별칭 정규화 적용 — '건축물보양'/'건축물현장정리' 두 행이 양립하던 회귀 차단.
    const linkedRows = materialRows.filter(r => r.isLinkedFromRecovery);
    const keyCount: Record<string, number> = {};
    let hasDuplicates = false;
    
    // [정책 2026-05-12] 다중 매칭 공사명(도배=실크/합지 등)은 dedup 키에 자재항목 포함 →
    //   사용자가 선택한 합지/실크가 같은 키로 묶여 한쪽이 제거되는 회귀 차단.
    //   단일 매칭(보양재 등)은 기존 키(공종|공사명) 유지하여 누적 중복 자동 제거 회귀 방지.
    const MULTI_MATERIAL_WORK_NAMES = ['도배'];
    const buildMaterialDedupKey = (row: MaterialRow): string => {
      const baseName = normalizeMaterialWorkName(row.공종 || '', row.공사명 || '');
      const isMultiMaterial = MULTI_MATERIAL_WORK_NAMES.includes(row.공사명 || '');
      const itemPart = isMultiMaterial ? `|${(row.자재항목 || '').trim()}` : '';
      return `${row.공종}|${baseName}${itemPart}`;
    };
    
    for (const row of linkedRows) {
      const key = buildMaterialDedupKey(row);
      keyCount[key] = (keyCount[key] || 0) + 1;
      if (keyCount[key] > 1) {
        hasDuplicates = true;
      }
    }
    
    if (!hasDuplicates) return;
    
    // 중복 제거 (무한 루프 방지를 위해 key 비교)
    const currentStateKey = materialRows.map(r => r.id).join(',');
    if (currentStateKey === lastMaterialDeduplicationRef.current) return;
    
    console.log('[자재비 중복 제거] 중복 감지, 자동 제거 실행');
    
    // 우선순위: syncMaterialFromRecoveryArea가 만든 행(isAutoGenerated=true, autoKey 보유)을
    // 다른 경로(labor→material useEffect)로 만들어진 stale 행보다 우선 유지.
    // 정렬 후 첫 번째 행을 keeper로 선택.
    const rowPriority = (row: MaterialRow): number => {
      if (row.isAutoGenerated && row.autoKey) return 0; // 최우선: sync 출처 + autoKey 일치
      if (row.isAutoGenerated) return 1;
      return 2;
    };
    const indexedRows = materialRows.map((row, idx) => ({ row, idx }));
    const sortedForDedup = [...indexedRows].sort((a, b) => {
      const pa = rowPriority(a.row);
      const pb = rowPriority(b.row);
      if (pa !== pb) return pa - pb;
      return a.idx - b.idx;
    });
    const keepIds = new Set<string>();
    const seen = new Set<string>();
    sortedForDedup.forEach(({ row }) => {
      if (!row.isLinkedFromRecovery) {
        keepIds.add(row.id);
        return;
      }
      const key = buildMaterialDedupKey(row);
      if (seen.has(key)) {
        console.log('[자재비 중복 제거] 제거:', row.공종, row.공사명, '자재항목:', row.자재항목);
        return;
      }
      seen.add(key);
      keepIds.add(row.id);
    });
    const deduplicatedRows = materialRows.filter(row => keepIds.has(row.id));
    
    if (deduplicatedRows.length !== materialRows.length) {
      lastMaterialDeduplicationRef.current = deduplicatedRows.map(r => r.id).join(',');
      setMaterialRows(deduplicatedRows);
    }
  }, [materialRows]);

  // 빈 자재비 행 생성 함수
  const createBlankMaterialRow = (공종 = '', 공사명 = '', sourceLaborRowId?: string): MaterialRow => {
    // 공종/공사명에 따른 자재 자동 설정
    let 자재 = '';
    if (공종 === '도장공사') {
      자재 = '페인트';
    } else if (공종 === '목공사' && 공사명 === '반자틀') {
      자재 = '각재';
    } else if (공종 === '목공사' && 공사명 === '걸레받이') {
      자재 = '걸레받이';
    } else if (공종 === '목공사' && 공사명 === '몰딩') {
      자재 = '몰딩';
    }
    
    return {
      id: `material-${Date.now()}-${Math.random()}`,
      공사명,
      공종,
      자재항목: 자재,
      자재,
      규격: '',
      단위: '',
      단가: 0,
      기준단가: 0,
      수량m2: 0,
      수량EA: 0,
      수량: 0,
      합계: 0,
      금액: 0,
      includeInEstimate: true,
      비고: '',
      sourceLaborRowId,
    };
  };

  // 문자열 정규화 헬퍼 (공백 제거, 소문자 변환) - 일위대가 매칭에 사용
  const normalizeForMatch = (str: string): string => {
    return (str || '').trim().toLowerCase().replace(/\s+/g, '');
  };

  // 철거공사 필요한 공사명 목록 (컴포넌트 레벨 - 삭제 추적 및 reconcile에서 공통 사용)
  // 철거공사 자동 연동 대상 (복구면적산출표의 공사명이 이 목록에 있으면 철거공사 행 자동 생성)
  // 허용: 합판, 석고(=석고보드), 도배, 마루, 장판, 상부장, 상부장&하부장, 상부장&키큰장, 상부장&하부장&키큰장, 붙박이장, SMC, 리빙보드
  // 제외: 하부장 단독, 도기류, 반자틀, 몰딩, 걸레받이 등
  // '석고보드'는 '석고'와 동일 항목으로 alias 처리 (DEMOLITION_WORKNAME_ALIASES 참조)
  const DEMOLITION_WORK_NAMES = ['합판', '석고', '석고보드', '도배', '마루', '장판', '상부장', '상부장&하부장', '상부장&키큰장', '상부장&하부장&키큰장', '붙박이장', 'SMC', '리빙보드'];
  // UI/정렬용 표준 순서 (사용자 지정)
  const DEMOLITION_WORK_NAMES_CANONICAL = ['합판', '석고', '도배', '마루', '장판', '상부장', '상부장&하부장', '상부장&키큰장', '상부장&하부장&키큰장', '붙박이장', 'SMC', '리빙보드'];
  
  // FIXED 일위대가 항목: 면적 무관하게 일위대가DB의 '일위대가' 컬럼을 합계로 사용 (욕실/가구/철거의 SMC~붙박이장)
  // - 복구면적: 면적 그대로 (천장 할증 미적용)
  // - 적용단가: 노임단가 (E)
  // - 합계: 일위대가 (DB 고정값)
  // - 수량: 합계 / 적용단가
  const FIXED_ILWIDAEGA_WORK_NAMES = ['SMC', '리빙보드', '도기류', '붙박이장', '상부장', '하부장', '상부장&하부장', '키큰장', '상부장&키큰장', '상부장&하부장&키큰장'];
  const isFixedIlwidaegaWorkName = (workName: string): boolean => {
    return FIXED_ILWIDAEGA_WORK_NAMES.includes(workName);
  };
  
  // 정규화된 공사명 → 원본 DEMOLITION_WORK_NAMES 매핑 함수
  const matchDemolitionWorkName = (workName: string): string | null => {
    const normalized = normalizeForMatch(workName);
    for (const name of DEMOLITION_WORK_NAMES) {
      if (normalizeForMatch(name) === normalized) {
        return name;
      }
    }
    return null;
  };

  // 연동된 노무비 삭제 키 생성 함수
  // 형식: category|workName|detailItem (sourceRowId 제외 - 저장마다 변경되므로)
  const makeLinkedLaborDeletionKey = (sourceAreaRowId: string, category: string, workName: string, detailItem: string): string => {
    // 모든 노무비에서 sourceRowId 제외 (복구면적 행 ID가 저장마다 변경되므로)
    // 형식: "category|workName|detailItem"
    // 철거공사의 경우 workName을 표준화 + alias canonical 적용 ('석고보드'→'석고')
    // → '석고' 행 삭제와 '석고보드' 행 삭제가 동일한 key로 매핑되어 일관성 보장
    let normalizedWorkName = workName || '';
    if (category === '철거공사') {
      const matched = matchDemolitionWorkName(workName);
      const base = matched || workName || '';
      normalizedWorkName = DEMOLITION_WORKNAME_ALIASES[base] || base;
    }
    
    // sourceRowId 제외, category|workName|detailItem 형식만 사용
    return `${category || ''}|${normalizedWorkName}|${detailItem || ''}`;
  };

  // 노무비 카탈로그 조회 (from excel_data)
  const { data: laborCatalog = [], isLoading: isLoadingLaborCatalog } = useQuery<LaborCatalogItem[]>({
    queryKey: ['/api/labor-catalog'],
    staleTime: 5 * 60 * 1000,
  });

  // 자재비 카탈로그 조회 (from excel_data)
  const { data: materialCatalog = [], isLoading: isLoadingMaterialCatalog } = useQuery<MaterialCatalogItem[]>({
    queryKey: ['/api/materials'],
    staleTime: 5 * 60 * 1000,
  });

  // 일위대가 카탈로그 조회 (from excel_data) - 복구면적 → 노무비 자동생성용
  const { data: ilwidaegaCatalog = [] } = useQuery<IlwidaegaCatalogItem[]>({
    queryKey: ['/api/ilwidaega-catalog'],
    staleTime: 5 * 60 * 1000,
  });

  const { data: ilwidaegaLinkSettings = [] } = useQuery<Array<{ id: number; location: string; category: string; workName: string }>>({
    queryKey: ['/api/ilwidaega-link-settings'],
    staleTime: 5 * 60 * 1000,
  });

  // 단가 오버라이드 조회 (admin-configured D values)
  const { data: unitPriceOverrides = [] } = useQuery<UnitPriceOverride[]>({
    queryKey: ['/api/unit-price-overrides'],
    staleTime: 5 * 60 * 1000,
  });

  // 일위대가 카탈로그에 오버라이드 적용 (D값 덮어쓰기, 일위대가 재계산)
  const mergedIlwidaegaCatalog = useMemo(() => {
    if (!ilwidaegaCatalog.length) return [];
    
    // Create lookup map for overrides
    const overrideMap = new Map<string, number>();
    unitPriceOverrides.forEach(override => {
      const key = `${override.category}|${override.workName}|${override.laborItem}`;
      overrideMap.set(key, override.standardWorkQuantity);
    });
    
    return ilwidaegaCatalog.map(item => {
      const key = `${item.공종}|${item.공사명}|${item.노임항목}`;
      const overrideD = overrideMap.get(key);
      
      if (overrideD !== undefined && overrideD > 0) {
        const newD = overrideD;
        const E = item.노임단가;
        // Guard against division by zero - D must be positive
        const newIlwidaega = (E && Number.isFinite(newD) && newD > 0) ? E / newD : null;
        return {
          ...item,
          기준작업량: newD,
          일위대가: newIlwidaega,
        };
      }
      return item;
    });
  }, [ilwidaegaCatalog, unitPriceOverrides]);

  // NOTE: 이후 모든 일위대가 카탈로그 사용은 mergedIlwidaegaCatalog를 사용 (오버라이드 적용된 값)

  // 자재비 카탈로그 조회 (공사명 기준) - 복구면적 → 자재비 자동생성용
  const { data: materialByWorknameCatalog = [] } = useQuery<MaterialByWorknameCatalogItem[]>({
    queryKey: ['/api/materials-by-workname'],
    staleTime: 5 * 60 * 1000,
  });

  // materialByWorknameCatalog를 MaterialCatalogItem 형식으로 변환 (materialCatalog가 비어있을 때 대체)
  const transformedMaterialCatalog: MaterialCatalogItem[] = useMemo(() => {
    // materialCatalog가 있으면 그것을 사용, 없으면 materialByWorknameCatalog에서 변환
    if (materialCatalog.length > 0) {
      return materialCatalog;
    }
    // materialByWorknameCatalog.공종 = 공종 (원인공사, 목공사, 수장공사 등)
    // materialByWorknameCatalog.공사명 = 공사명 (방수, 합판, 도배 등)
    // materialByWorknameCatalog.자재항목 = 자재비DB의 자재항목
    return materialByWorknameCatalog.map(item => ({
      workType: item.공종, // 공종 필드 사용
      workName: item.공사명, // 공사명 필드 사용
      materialName: item.자재항목, // 자재항목 사용
      specification: '',
      unit: item.단위 || '',
      standardPrice: item.금액 ?? 0, // null이면 0으로 변환
    }));
  }, [materialCatalog, materialByWorknameCatalog]);

  // 빈 노무비 행 생성 함수
  const createBlankLaborRow = (options?: {
    sourceAreaRowId?: string;
    isLinkedFromRecovery?: boolean;
    place?: string;
    position?: string;
    category?: string;
    workName?: string;
    detailItem?: string;
    unit?: string;
    standardPrice?: number;
    damageArea?: number;
  }): LaborCostRow => {
    // 빈 행 생성 (세부공사는 기본값 일위대가)
    return {
      id: `labor-${Date.now()}-${Math.random()}`,
      sourceAreaRowId: options?.sourceAreaRowId,
      isLinkedFromRecovery: options?.isLinkedFromRecovery || false,
      place: options?.place || '', // 장소 - 복구면적 산출표에서 가져옴
      position: options?.position || '', // 위치 - 복구면적 산출표에서 가져옴
      category: options?.category || '',
      workName: options?.workName || '',
      detailWork: '일위대가', // 기본값: 일위대가
      detailItem: options?.detailItem || '',
      priceStandard: '',
      unit: options?.unit || '',
      standardPrice: options?.standardPrice || 0,
      // [면적0 보정] options.damageArea가 명시되었고 0 이하이면 quantity 0으로 시작
      // (수동 추가는 damageArea 미지정 → 기존대로 1 유지, 회귀 방지).
      quantity: (options && options.damageArea !== undefined && (Number(options.damageArea) || 0) <= 0) ? 0 : 1,
      applicationRates: {
        ceiling: false,
        wall: false,
        floor: false,
        molding: false,
      },
      salesMarkupRate: 0,
      pricePerSqm: 0,
      damageArea: options?.damageArea || 0,
      deduction: 0,
      includeInEstimate: true,
      request: '',
      amount: 0,
    };
  };

  // 노무비 초기 첫 행 설정 (hydration 완료 후에만 빈 행 생성)
  useEffect(() => {
    // Hydration 완료 전에는 빈 행 생성하지 않음 (DB 데이터 로딩 대기)
    if (!isHydratedRef.current) return;
    if (laborCostRows.length === 0) {
      setLaborCostRows([createBlankLaborRow()]);
    }
  }, [laborCostRows.length]);

  // 자재비 초기 빈 행 설정 (hydration 완료 후에만 빈 행 생성)
  useEffect(() => {
    // Hydration 완료 전에는 빈 행 생성하지 않음 (DB 데이터 로딩 대기)
    if (!isHydratedRef.current) return;
    if (materialRows.length === 0) {
      setMaterialRows([createBlankMaterialRow()]);
    }
  }, [materialRows.length]);

  // 자재비 DB에 있는 공종 목록 추출
  const materialWorkTypes = useMemo(() => {
    const workTypes = new Set(materialCatalog.map(item => item.workType));
    console.log('[DEBUG] materialCatalog 공종 목록:', Array.from(workTypes));
    if (materialCatalog.length > 0) {
      console.log('[DEBUG] materialCatalog 첫 5개 항목:', materialCatalog.slice(0, 5));
    }
    return workTypes;
  }, [materialCatalog]);

  // 노무비 → 자재비 동기화는 isLossPreventionCase 정의 이후에 실행 (아래에 위치)

  // 자동 연동 대상 공종 목록 (도장, 목공, 수장, 도배, 마루)
  const AUTO_SYNC_WORK_TYPES = ['도장공사', '목공사', '수장공사', '도배', '마루'];

  // 노무비 공종 변환 함수 (특수 케이스 처리)
  // 현재는 그대로 반환 (목공사 + 걸레받이 등은 일위대가DB에 목공사로 저장됨)
  const getLaborCategory = (workType: string, workName: string): string => {
    return workType;
  };
  
  // 철거공사 추가 필요 여부 확인 (일위대가DB의 철거공사 공사명과 매칭)
  const needsDemolitionRow = (workType: string, workName: string): boolean => {
    return DEMOLITION_WORK_NAMES.includes(workName);
  };
  
  // 철거공사 공사명 매핑 (복구면적 공사명 → 일위대가DB 철거공사 공사명)
  // 일위대가DB의 철거공사 공사명과 다르게 등록된 항목은 여기서 변환
  const DEMOLITION_WORKNAME_ALIASES: Record<string, string> = {
    '석고보드': '석고', // 복구면적은 '석고보드'로 입력하지만 일위대가DB 철거공사에는 '석고'로 등록됨
  };
  const getDemolitionMapping = (workType: string, workName: string): { demolitionWorkName: string; detailItem: string } => {
    const mapped = DEMOLITION_WORKNAME_ALIASES[workName] || workName;
    return { demolitionWorkName: mapped, detailItem: '보통인부' };
  };
  
  // 철거공사 행 생성 함수 (일위대가DB 기반)
  const createDemolitionLaborRow = (sourceAreaRow: AreaCalculationRow, catalogItem?: IlwidaegaCatalogItem, overrideDamageArea?: number): LaborCostRow => {
    const { demolitionWorkName, detailItem } = getDemolitionMapping(sourceAreaRow.workType, sourceAreaRow.workName);
    
    // FIXED 항목 여부 (SMC, 리빙보드, 도기류, 붙박이장, 상부장 시리즈)
    const isFixed = isFixedIlwidaegaWorkName(demolitionWorkName);
    
    // 안전한 피해면적 변환 (FIXED는 천장 할증 미적용, 나머지는 적용)
    const rawArea = overrideDamageArea ?? (parseFloat(sourceAreaRow.repairArea) || 0);
    const ceilingMult = isFixed ? 1.0 : getCeilingMultiplier(sourceAreaRow.workType || '', sourceAreaRow.location || '');
    const parsedArea = Math.round(rawArea * ceilingMult * 10) / 10;
    const safeDamageArea = Math.round(parsedArea * 10) / 10;
    
    // 기준작업량(D), 노임단가(E), 일위대가(I_fixed) 가져오기
    const standardWorkQty = catalogItem?.기준작업량 || 0;
    const laborPrice = catalogItem?.노임단가 || 0;
    const fixedTotal = catalogItem?.일위대가 || 0;
    
    const C = safeDamageArea;
    const D = standardWorkQty;
    const E = laborPrice;
    
    // [면적0 보정] 면적 0이면 수량 0으로 시작 (사용자 요청: 면적 미입력 시 자동 1 차단).
    // 면적 > 0 이지만 D/E 결손이면 기존대로 1 유지(회귀 방지).
    let calculatedQuantity = C > 0 ? 1 : 0;
    let calculatedAmount = 0;
    let calculatedPricePerSqm = 0;
    
    if (isFixed) {
      // FIXED: 합계=일위대가(DB), 적용단가=노임단가(E), 수량=합계/적용단가
      calculatedAmount = fixedTotal;
      calculatedPricePerSqm = E;
      calculatedQuantity = E > 0 && fixedTotal > 0 ? Math.round((fixedTotal / E) * 10) / 10 : 1;
    } else if (D > 0 && E > 0 && C > 0) {
      calculatedAmount = calculateIWithTiers(C, D, E, laborRateTiers);
      calculatedPricePerSqm = calculateAppliedUnitPriceWithTiers(C, D, E, laborRateTiers);
      calculatedQuantity = calculateQuantityWithTiers(C, D, E, laborRateTiers);
    }
    
    return {
      id: `labor-demolition-${Date.now()}-${Math.random()}`,
      sourceAreaRowId: `demolition-${sourceAreaRow.id}`, // 원본 행 ID에 prefix 추가하여 구분
      isLinkedFromRecovery: true, // 복구면적에서 자동생성된 행
      sourceWorkType: sourceAreaRow.workType || '', // 부모 노무비 행의 공종 (복구면적 계산용)
      place: sourceAreaRow.category || '', // 장소
      position: sourceAreaRow.location || '', // 위치
      category: '철거공사', // 공종 - 일위대가DB 기준
      // 표시명은 영역행 원본 공사명을 우선 사용 (예: 영역에 '석고보드'면 표시도 '석고보드'),
      // 영역에 공사명이 없을 때만 alias 매핑된 DB 공사명('석고') 사용
      workName: sourceAreaRow.workName || demolitionWorkName,
      detailWork: '일위대가', // 세부공사
      detailItem: catalogItem?.노임항목 || detailItem, // 노임항목 (보통인부)
      priceStandard: '',
      unit: '㎡',
      standardPrice: laborPrice, // 노임단가 (E)
      standardWorkQuantity: standardWorkQty, // 기준작업량 (D)
      quantity: calculatedQuantity, // 자동 계산된 수량 (복구면적 ÷ 기준작업량)
      applicationRates: {
        ceiling: sourceAreaRow.location?.includes('천장') || false,
        wall: sourceAreaRow.location?.includes('벽') || false,
        floor: sourceAreaRow.location?.includes('바닥') || false,
        molding: false,
      },
      salesMarkupRate: 0,
      pricePerSqm: calculatedPricePerSqm, // 적용단가 (E)
      damageArea: safeDamageArea, // 복구면적 (C)
      deduction: 0,
      includeInEstimate: true,
      request: '',
      amount: calculatedAmount, // 합계 (I)
    };
  };

  // selectedCaseId 변경 시 hydration guard 및 상태 초기화
  useEffect(() => {
    if (!selectedCaseId) return; // Empty caseId, skip
    
    // Hydration guard reset
    isHydratedRef.current = false;
    setIsHydratedState(false);
    skipAutoSyncRef.current = true; // 자동 동기화 방지 리셋
    materialCatalogLoadedRef.current = false;
    materialAutoSyncOnLoadRef.current = false; // 초기로딩 연동행 수량 자동재계산 1회 가드 리셋
    
    // 이전 케이스 데이터 초기화
    setRows([]);
    setLaborCostRows([]);
    setMaterialRows([]);
    setSelectedRows(new Set());
    setSelectedLaborRows(new Set());
    setSelectedMaterialRows(new Set());

    // [복구면적→노무비 자동반영] 케이스 전환 시 베이스라인/사용자편집 플래그 리셋
    // — 이전 세션 면적이 새 케이스의 동일 id로 오해되어 spurious changedArea 판정되는 것 차단
    prevRepairAreasRef.current = new Map();
    userEditedAreaRef.current = false;
    
    // Query 캐시 무효화 (새 케이스 데이터 강제 로드)
    queryClient.invalidateQueries({ queryKey: ["/api/estimates", selectedCaseId, "latest"] });
    queryClient.invalidateQueries({ queryKey: [`/api/cases/${selectedCaseId}`] });
  }, [selectedCaseId]);

  const { toast } = useToast();

  // 현재 로그인한 사용자 정보
  const { data: currentUser } = useQuery<User>({
    queryKey: ['/api/user'],
  });

  // [원본보존-협력업체] currentUser가 로드되는 즉시 ref를 갱신하여
  // isPartner 변수 선언 이전 위치(dedup 등)의 useEffect에서도 안전하게 차단 가능.
  // 렌더 중 ref 갱신은 idempotent하므로 strict mode 이중 호출에도 무해.
  isPartnerRef.current = currentUser?.role === "협력사";
  isUserLoadedRef.current = currentUser !== undefined;

  // 현재 날짜 (KST) 가져오기
  const getCurrentDate = () => {
    const formatter = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find(p => p.type === 'year')?.value || '';
    const month = parts.find(p => p.type === 'month')?.value || '';
    const day = parts.find(p => p.type === 'day')?.value || '';
    return `${year}-${month}-${day}`;
  };

  // 케이스 검색
  const [caseSearchQuery, setCaseSearchQuery] = useState('');
  
  // 모든 케이스 조회 (검색용)
  const { data: allCases = [] } = useQuery<Case[]>({
    queryKey: ['/api/cases'],
    enabled: caseSearchModalOpen,
  });

  // 케이스 필터링 (검색어 기준 + 협력사 필터링) - 안전한 null 처리
  const filteredCases = allCases.filter(c => {
    // 협력사 사용자인 경우: 본인 협력사에 배당된 케이스만 표시
    if (currentUser?.role === '협력사') {
      if (c.assignedPartner !== currentUser.company) return false;
    }
    
    if (!caseSearchQuery) return true;
    const query = caseSearchQuery.toLowerCase();
    const caseNumber = c.caseNumber?.toLowerCase() ?? '';
    const insuranceCompany = c.insuranceCompany?.toLowerCase() ?? '';
    const insuranceAccidentNo = c.insuranceAccidentNo?.toLowerCase() ?? '';
    const policyHolderName = c.policyHolderName?.toLowerCase() ?? '';
    const victimName = c.victimName?.toLowerCase() ?? '';
    const insuredAddress = c.insuredAddress?.toLowerCase() ?? '';
    
    return (
      caseNumber.includes(query) ||
      insuranceCompany.includes(query) ||
      insuranceAccidentNo.includes(query) ||
      policyHolderName.includes(query) ||
      victimName.includes(query) ||
      insuredAddress.includes(query)
    );
  });

  // 케이스 선택 핸들러
  const handleCaseSelect = (caseId: string) => {
    setSelectedCaseId(caseId);
    setFieldSurveyCaseId(caseId);
    
    // 선택한 케이스를 estimateCase로 직접 설정 (고객정보 즉시 업데이트)
    const selected = allCases?.find((c: Case) => c.id === caseId);
    if (selected) {
      setEstimateCase(selected);
    }
    
    setCaseSearchModalOpen(false);
    setCaseSearchQuery("");
    toast({
      title: "케이스가 선택되었습니다",
      description: "선택한 케이스의 견적서를 작성할 수 있습니다.",
    });
  };

  // 마스터 데이터 조회
  const { data: masterDataList = [] } = useQuery<MasterData[]>({
    queryKey: ['/api/master-data'],
  });

  // 노무비 데이터 조회
  const { data: laborCostData = [], isLoading: isLoadingLaborCosts } = useQuery<LaborCost[]>({
    queryKey: ['/api/labor-costs'],
  });

  // 노무비 캐스케이딩 선택기 옵션 조회
  const { data: laborOptions } = useQuery<{
    categories: string[];
    workNamesByCategory: Record<string, string[]>;
    detailWorksByWork: Record<string, string[]>;
  }>({
    queryKey: ['/api/labor-costs/options'],
  });

  // 자재비 데이터 조회
  const { data: materialsData = [], isLoading: isLoadingMaterials } = useQuery<Material[]>({
    queryKey: ['/api/materials'],
  });

  // Legacy labor catalog helpers and updateLaborRow removed - replaced by LaborCostSection

  // 노무비 행 추가
  const addLaborRow = () => {
    if (isReadOnly) return;
    const newLaborRow = createBlankLaborRow();
    setLaborCostRows(prev => [...prev, newLaborRow]);
  };

  // 선택된 노무비 행 삭제 (연동된 행은 삭제 키 추적하여 재생성 방지)
  const deleteSelectedLaborRows = async () => {
    if (isReadOnly) return;
    if (selectedLaborRows.size === 0) return;
    
    // 삭제할 연동된 노무비 행의 키를 추적 (재생성 방지) - sourceAreaRowId 포함 형식
    const newDeletedKeys = new Set<string>();
    const keysToSave: string[] = [];
    
    laborCostRows.forEach(row => {
      // 모든 isLinkedFromRecovery 행에 대해 삭제 키 추적 (철거공사 + 다른 공사명)
      if (selectedLaborRows.has(row.id) && row.isLinkedFromRecovery) {
        const processedKeys = new Set<string>();
        
        // 철거공사인 경우: sourceAreaRowId에서 ID 추출 (demolition-row1,row2 형식)
        if (row.category === '철거공사' && row.sourceAreaRowId) {
          // sourceAreaRowId = "demolition-row1Id,row2Id,row3Id"
          const rawId = row.sourceAreaRowId.replace('demolition-', '');
          const sourceRowIds = rawId.split(',').filter(Boolean);
          
          sourceRowIds.forEach(srcId => {
            const key = makeLinkedLaborDeletionKey(srcId, row.category || '', row.workName || '', row.detailItem || '');
            if (!processedKeys.has(key)) {
              processedKeys.add(key);
              newDeletedKeys.add(key);
              keysToSave.push(key);
            }
          });
        } else {
          // 일반 노무비: 복구면적 행에서 같은 workType/workName 찾기
          const relatedAreaRows = rows.filter(areaRow => 
            normalizeForMatch(areaRow.workType || '') === normalizeForMatch(row.category || '') &&
            normalizeForMatch(areaRow.workName || '') === normalizeForMatch(row.workName || '')
          );
          
          // 관련 복구면적 행들의 ID로 삭제 키 저장
          relatedAreaRows.forEach(areaRow => {
            const key = makeLinkedLaborDeletionKey(areaRow.id, row.category || '', row.workName || '', row.detailItem || '');
            if (!processedKeys.has(key)) {
              processedKeys.add(key);
              newDeletedKeys.add(key);
              keysToSave.push(key);
            }
          });
          
          // 저장된 sourceAreaRowId도 처리 (관련 복구면적 행에 없는 경우 대비)
          if (row.sourceAreaRowId) {
            const key = makeLinkedLaborDeletionKey(row.sourceAreaRowId, row.category || '', row.workName || '', row.detailItem || '');
            if (!processedKeys.has(key)) {
              processedKeys.add(key);
              newDeletedKeys.add(key);
              keysToSave.push(key);
            }
          }
        }
      }
    });
    
    if (newDeletedKeys.size > 0) {
      setDeletedLinkedLaborKeys(prev => new Set([...Array.from(prev), ...Array.from(newDeletedKeys)]));
      
      // DB에 영속화 (케이스 ID가 있는 경우)
      const currentCaseId = estimateCase?.id || selectedCaseId;
      if (currentCaseId) {
        keysToSave.forEach(async (key) => {
          try {
            await apiRequest('POST', `/api/cases/${currentCaseId}/estimate-exclusions`, {
              exclusionType: 'linked_labor_deletion',
              deletionKey: key,
            });
            console.log('[연동 노무비 삭제 영속화] 저장:', key);
          } catch (err) {
            console.error('[연동 노무비 삭제 영속화] 오류:', err);
          }
        });
      }
    }
    
    setLaborCostRows(prev => prev.filter(row => !selectedLaborRows.has(row.id)));
    setSelectedLaborRows(new Set());
  };

  // 노무비 행 변경 핸들러 (LaborCostSection에서 - 버튼으로 삭제 시 연동된 행 키 추적)
  const handleLaborRowsChange = (newRows: LaborCostRow[]) => {
    // 삭제된 행 감지 (현재 행에서 새 행에 없는 것 = 삭제된 행)
    const newRowIds = new Set(newRows.map(r => r.id));
    const deletedRows = laborCostRows.filter(r => !newRowIds.has(r.id));
    
    // 삭제된 연동된 노무비 행의 키 추적 - sourceAreaRowId 포함 형식
    const newDeletedKeys = new Set<string>();
    const keysToSave: string[] = [];
    const currentCaseId = estimateCase?.id || selectedCaseId;
    
    deletedRows.forEach(row => {
      // 모든 isLinkedFromRecovery 행에 대해 삭제 키 추적 (철거공사 + 다른 공사명)
      if (row.isLinkedFromRecovery) {
        const processedKeys = new Set<string>();
        
        // 철거공사인 경우: sourceAreaRowId에서 ID 추출 (demolition-row1,row2 형식)
        if (row.category === '철거공사' && row.sourceAreaRowId) {
          // sourceAreaRowId = "demolition-row1Id,row2Id,row3Id"
          const rawId = row.sourceAreaRowId.replace('demolition-', '');
          const sourceRowIds = rawId.split(',').filter(Boolean);
          
          sourceRowIds.forEach(srcId => {
            const key = makeLinkedLaborDeletionKey(srcId, row.category || '', row.workName || '', row.detailItem || '');
            if (!processedKeys.has(key)) {
              processedKeys.add(key);
              newDeletedKeys.add(key);
              keysToSave.push(key);
            }
          });
        } else {
          // 일반 노무비: 복구면적 행에서 같은 workType/workName 찾기
          const relatedAreaRows = rows.filter(areaRow => 
            normalizeForMatch(areaRow.workType || '') === normalizeForMatch(row.category || '') &&
            normalizeForMatch(areaRow.workName || '') === normalizeForMatch(row.workName || '')
          );
          
          // 관련 복구면적 행들의 ID로 삭제 키 저장
          relatedAreaRows.forEach(areaRow => {
            const key = makeLinkedLaborDeletionKey(areaRow.id, row.category || '', row.workName || '', row.detailItem || '');
            if (!processedKeys.has(key)) {
              processedKeys.add(key);
              newDeletedKeys.add(key);
              keysToSave.push(key);
            }
          });
          
          // 저장된 sourceAreaRowId도 처리 (관련 복구면적 행에 없는 경우 대비)
          if (row.sourceAreaRowId) {
            const key = makeLinkedLaborDeletionKey(row.sourceAreaRowId, row.category || '', row.workName || '', row.detailItem || '');
            if (!processedKeys.has(key)) {
              processedKeys.add(key);
              newDeletedKeys.add(key);
              keysToSave.push(key);
            }
          }
        }
        
        // [증거 1] SAVE_EXCLUSION_KEY - 삭제 클릭 시 (모든 관련 키 로깅)
        console.log('SAVE_EXCLUSION_KEY', { 
          caseId: currentCaseId, 
          exclusion_type: 'linked_labor_deletion', 
          deletion_keys: Array.from(processedKeys),
          count: processedKeys.size
        });
      }
    });
    
    if (newDeletedKeys.size > 0) {
      setDeletedLinkedLaborKeys(prev => new Set([...Array.from(prev), ...Array.from(newDeletedKeys)]));
      
      // DB에 영속화 (케이스 ID가 있는 경우)
      if (currentCaseId) {
        keysToSave.forEach(async (key) => {
          try {
            const response = await apiRequest('POST', `/api/cases/${currentCaseId}/estimate-exclusions`, {
              exclusionType: 'linked_labor_deletion',
              deletionKey: key,
            });
            console.log('SAVE_EXCLUSION_KEY_DB_RESPONSE', { 
              caseId: currentCaseId, 
              deletion_key: key, 
              success: true,
              response
            });
          } catch (err) {
            console.error('SAVE_EXCLUSION_KEY_DB_ERROR', { caseId: currentCaseId, deletion_key: key, error: err });
          }
        });
      }
    }
    
    lastLaborSetSourceRef.current = 'handleLaborRowsChange';
    setLaborCostRows(sortLaborRowsByCategory(newRows));
  };

  // 복구면적 산출표에서 노무비로 동기화 (일위대가DB 기반 자동 생성)
  // 일위대가DB에서 공종+공사명으로 조회하여 ALL matching 노임항목 행을 자동 생성
  // [Task #10] clearDeletedKeys: 사용자가 명시적으로 "복구면적 가져오기" 버튼을 누른 경우에만 true.
  //   자동 호출(노무비 탭 진입 등)에서는 false → 메모리 삭제 키 보존 → 부활 윈도우 차단.
  const syncLaborFromRecoveryArea = (opts?: { clearDeletedKeys?: boolean }) => {
    const clearDeletedKeys = opts?.clearDeletedKeys === true;
    console.log('[복구면적가져오기] START', {
      isReadOnly,
      rowsCount: rows.length,
      laborCostRowsCount: laborCostRows.length,
      catalogCount: mergedIlwidaegaCatalog.length,
      deletedKeysCount: deletedLinkedLaborKeys.size,
      deletedKeysSample: Array.from(deletedLinkedLaborKeys).slice(0, 10),
      clearDeletedKeys,
    });
    // 협력업체(readOnly)도 동일한 화면값을 보도록 isReadOnly 가드 제거 (저장은 별도로 차단됨)
    if (rows.length === 0) return;
    
    // ★ 메모리 삭제 키 초기화 — 사용자가 명시적으로 "복구면적 가져오기" 버튼을 눌렀을 때만 작동.
    //   자동 호출(노무비 탭 진입 등)에서 무조건 클리어하면 같은 케이스 안에서 케이스 ID가
    //   바뀌기 전까지 DB 재로드가 일어나지 않아, 사용자가 삭제했던 행이 일시적으로 부활하는
    //   윈도우가 생겼다 (위험 ⑩). DB 삭제 키는 항상 유지 (자동 동기화에서 계속 보호).
    if (clearDeletedKeys && deletedLinkedLaborKeys.size > 0) {
      console.log('[복구면적가져오기] deletedLinkedLaborKeys 메모리 초기화:', deletedLinkedLaborKeys.size, '개 키 (DB 유지, 사용자 명시 버튼)');
      setDeletedLinkedLaborKeys(new Set());
    }
    
    // 기존 독립 추가 행 (isLinkedFromRecovery = false) 보존
    const independentRows = laborCostRows.filter(row => !row.isLinkedFromRecovery);
    
    // 기존 연동 행을 키(공종|공사명|노임항목)로 매핑하여 보존용
    const existingLinkedRows = laborCostRows.filter(row => row.isLinkedFromRecovery);
    const existingLinkedMap = new Map<string, LaborCostRow>();
    existingLinkedRows.forEach(row => {
      const key = `${normalizeForMatch(row.category || '')}|${normalizeForMatch(row.workName || '')}|${normalizeForMatch(row.detailItem || '')}`;
      existingLinkedMap.set(key, row);
    });
    
    // 복구면적 산출표에서 고유한 공종+공사명 조합 추출 및 면적 합산
    const workTypeMap = new Map<string, Map<string, { totalArea: number; areaRows: AreaCalculationRow[] }>>();
    
    rows.forEach(row => {
      const workType = row.workType || '';
      const workName = row.workName || '';
      if (!workType) return;
      
      if (AREA_DISPLAY_ONLY_WORK_TYPES.includes(workType) && !isItemInLinkSettings(workType, workName)) return;
      if (AREA_DISPLAY_ONLY_WORK_NAMES.includes(workName) && !isItemInLinkSettings(workType, workName)) return;
      
      if (!workTypeMap.has(workType)) {
        workTypeMap.set(workType, new Map());
      }
      
      const workNameMap = workTypeMap.get(workType)!;
      if (!workNameMap.has(workName)) {
        workNameMap.set(workName, { totalArea: 0, areaRows: [] });
      }
      
      const workNameData = workNameMap.get(workName)!;
      const rawArea = parseFloat(row.repairArea) || 0;
      const ceilingMult = getCeilingMultiplier(workType, row.location || '');
      workNameData.totalArea += Math.round(rawArea * ceilingMult * 10) / 10;
      workNameData.areaRows.push(row);
    });

    workTypeMap.forEach((workNameMap, wt) => {
      const companionEntries: Array<{ companionName: string; data: { totalArea: number; areaRows: AreaCalculationRow[] } }> = [];
      workNameMap.forEach((data, wn) => {
        const companions = getCompanionWorkNames(wt, wn);
        companions.forEach(cn => {
          if (!workNameMap.has(cn)) {
            companionEntries.push({ companionName: cn, data: { totalArea: data.totalArea, areaRows: [...data.areaRows] } });
          }
        });
      });
      companionEntries.forEach(e => workNameMap.set(e.companionName, e.data));
    });
    
    // 철거공사 행: 기존 보존 + 삭제된 항목 복구
    // 키 정규화에 alias canonical 적용 ('석고보드'→'석고') — 표시는 영역 입력 그대로 유지하되
    // 중복/매칭 판정만 canonical로 일관 처리
    const canonicalizeDemo = (wn: string): string => {
      const matched = matchDemolitionWorkName(wn);
      const base = matched || wn || '';
      return DEMOLITION_WORKNAME_ALIASES[base] || base;
    };
    // [공종 꼬임 방지] 산출표 변경 후 "복구면적 가져오기" 시,
    // 산출표에 더 이상 없는 철거공사 항목(예: 화장실 SMC → 침실 변경 후 SMC 잔류)을 제거하기 위해
    // 현재 산출표 rows에서 생성될 valid한 철거공사 키 집합을 미리 계산.
    const validDemoKeySet = new Set<string>();
    rows.forEach(areaRow => {
      if (!areaRow.workType || !areaRow.workName || areaRow.workType === '철거공사') return;
      if (AREA_DISPLAY_ONLY_WORK_TYPES.includes(areaRow.workType) && !isItemInLinkSettings(areaRow.workType, areaRow.workName)) return;
      if (AREA_DISPLAY_ONLY_WORK_NAMES.includes(areaRow.workName) && !isItemInLinkSettings(areaRow.workType, areaRow.workName)) return;
      const matchedName = matchDemolitionWorkName(areaRow.workName);
      if (!matchedName) return;
      const canonicalName = DEMOLITION_WORKNAME_ALIASES[matchedName] || matchedName;
      const catalogItems = mergedIlwidaegaCatalog.filter(
        item => normalizeForMatch(item.공종 || '') === normalizeForMatch('철거공사') &&
               normalizeForMatch(item.공사명 || '') === normalizeForMatch(canonicalName)
      );
      const detailItems = catalogItems.length > 0
        ? catalogItems.map(c => c.노임항목 || '보통인부')
        : ['보통인부'];
      detailItems.forEach(detail => {
        validDemoKeySet.add(`${normalizeForMatch(canonicalName)}|${normalizeForMatch(detail)}`);
      });
    });

    // 기존 철거공사 행 중 산출표에 여전히 존재하는 항목만 보존 (사용자 수정값 유지).
    // 산출표에서 빠진 항목은 자동 제거 — 공종 변경(화장실→침실) 시 잔류 행 정리.
    const existingDemolitionRows = existingLinkedRows.filter(row => {
      if (row.category !== '철거공사') return false;
      const k = `${normalizeForMatch(canonicalizeDemo(row.workName || ''))}|${normalizeForMatch(row.detailItem || '')}`;
      return validDemoKeySet.has(k);
    });
    const demolitionKeySet = new Set(existingDemolitionRows.map(row =>
      `${normalizeForMatch(canonicalizeDemo(row.workName || ''))}|${normalizeForMatch(row.detailItem || '')}`
    ));
    const demolitionLinkedRows: LaborCostRow[] = [...existingDemolitionRows];

    rows.forEach(row => {
      if (!row.workType || !row.workName || row.workType === '철거공사') return;
      if (AREA_DISPLAY_ONLY_WORK_TYPES.includes(row.workType) && !isItemInLinkSettings(row.workType, row.workName)) return;
      if (AREA_DISPLAY_ONLY_WORK_NAMES.includes(row.workName) && !isItemInLinkSettings(row.workType, row.workName)) return;
      const matchedName = matchDemolitionWorkName(row.workName);
      if (!matchedName) return;
      // 카탈로그 lookup용 canonical 공사명 ('석고보드'→'석고')
      const canonicalName = DEMOLITION_WORKNAME_ALIASES[matchedName] || matchedName;

      const catalogItems = mergedIlwidaegaCatalog.filter(
        item => normalizeForMatch(item.공종 || '') === normalizeForMatch('철거공사') &&
               normalizeForMatch(item.공사명 || '') === normalizeForMatch(canonicalName)
      );

      const itemsToProcess = catalogItems.length > 0
        ? catalogItems.map(c => ({ detailItem: c.노임항목 || '보통인부', D: c.기준작업량 || 0, E: c.노임단가 || 0 }))
        : [{ detailItem: '보통인부', D: 0, E: 0 }];

      itemsToProcess.forEach((item, idx) => {
        // 중복 판정은 canonical 키로 ('석고'와 '석고보드'를 같은 항목으로 취급)
        const demoKey = `${normalizeForMatch(canonicalName)}|${normalizeForMatch(item.detailItem)}`;
        if (demolitionKeySet.has(demoKey)) return;
        demolitionKeySet.add(demoKey);

        const rawRepairArea = Number(row.repairArea) || 0;
        const demoCeilingMult = getCeilingMultiplier(row.workType || '', row.location || '');
        const repairArea = Math.round(rawRepairArea * demoCeilingMult * 10) / 10;
        // [면적0 보정] 복구면적이 0이면 수량/합계도 0으로 시작.
        // - 면적 0: quantity 0 (사용자 요청 - 합계 0과 일관성).
        // - 면적 > 0 이지만 카탈로그 D/E 결손: 기존대로 1 유지(회귀 방지).
        const hasArea = repairArea > 0;
        const hasCatalog = item.D > 0 && item.E > 0;
        let qty = !hasArea ? 0 : (hasCatalog ? 1 : 1);
        let amt = 0, ppsqm = 0;
        if (hasCatalog && hasArea) {
          amt = calculateIWithTiers(repairArea, item.D, item.E, laborRateTiers);
          ppsqm = calculateAppliedUnitPriceWithTiers(repairArea, item.D, item.E, laborRateTiers);
          qty = calculateQuantityWithTiers(repairArea, item.D, item.E, laborRateTiers);
        }

        demolitionLinkedRows.push({
          id: `labor-demolition-sync-${Date.now()}-${Math.random()}-${idx}`,
          sourceAreaRowId: `demolition-${row.id}`,
          isLinkedFromRecovery: true,
          place: row.category || '',
          position: row.location || '',
          category: '철거공사',
          // 표시는 영역행 원본 (예: '석고보드')
          workName: matchedName,
          detailWork: '일위대가',
          detailItem: item.detailItem,
          priceStandard: '',
          unit: '㎡',
          standardPrice: item.E,
          standardWorkQuantity: item.D,
          quantity: qty,
          applicationRates: { ceiling: false, wall: false, floor: false, molding: false },
          salesMarkupRate: 0,
          pricePerSqm: ppsqm,
          damageArea: repairArea,
          deduction: 0,
          includeInEstimate: true,
          request: '',
          amount: amt,
        });
      });
    });
    
    console.log('[복구면적가져오기] workTypeMap', {
      entries: Array.from(workTypeMap.entries()).map(([wt, wn]) => ({
        workType: wt,
        workNames: Array.from(wn.keys()),
        areas: Array.from(wn.entries()).map(([n, d]) => ({ name: n, area: d.totalArea })),
      })),
      independentCount: independentRows.length,
      existingLinkedCount: existingLinkedRows.length,
      demolitionLinkedCount: demolitionLinkedRows.length,
    });
    
    const newLaborRows: LaborCostRow[] = [];
    const sortedWorkTypes = Array.from(workTypeMap.keys()).sort();
    
    sortedWorkTypes.forEach(workType => {
      const workNameMap = workTypeMap.get(workType)!;
      const sortedWorkNames = Array.from(workNameMap.keys()).sort();
      
      sortedWorkNames.forEach(workName => {
        const workNameData = workNameMap.get(workName)!;
        const isBatangCompanion = Object.values(BATANG_COMPANION_MAP).includes(workName);
        const rawSourceAreaRowId = workNameData.areaRows[0]?.id || '';
        const sourceAreaRowId = isBatangCompanion ? `${rawSourceAreaRowId}::batang` : rawSourceAreaRowId;
        const totalArea = Math.round(workNameData.totalArea * 10) / 10;
        
        const matchingCatalogItems = mergedIlwidaegaCatalog.filter(
          item => normalizeForMatch(item.공종 || '') === normalizeForMatch(workType) && 
                 normalizeForMatch(item.공사명 || '') === normalizeForMatch(workName)
        );
        
        const uniquePlaces = Array.from(new Set(workNameData.areaRows.map(r => r.category).filter(Boolean)));
        const combinedPlace = uniquePlaces.join('/') || '';
        const uniqueLocations = Array.from(new Set(workNameData.areaRows.map(r => r.location).filter(Boolean)));
        const combinedPosition = uniqueLocations.join('/') || '';
        
        // 가구공사/욕실공사 FIXED 항목: 위치별로 노임항목별 1행씩 생성 (내장공 1.0, 보통인부 0.5)
        const isFixedFurnitureBath = isFixedIlwidaegaWorkName(workName) &&
          (workType === '가구공사' || workType === '욕실공사');
        
        if (matchingCatalogItems.length > 0) {
          if (isFixedFurnitureBath) {
            // FIXED: 보통인부는 철거공사 자동연동에서 별도 생성 → 여기서 제외
            const fixedItemsNoHelper = matchingCatalogItems.filter(
              item => normalizeForMatch(item.노임항목 || '') !== normalizeForMatch('보통인부')
            );
            // workNameData.areaRows의 위치마다 노임항목별 1행 생성
            workNameData.areaRows.forEach((areaRow) => {
              const perAreaSourceId = isBatangCompanion ? `${areaRow.id}::batang` : areaRow.id;
              const singleArea = Math.round((Number(areaRow.repairArea) || 0) * 10) / 10;
              fixedItemsNoHelper.forEach((catalogItem, idx) => {
                const detailItem = catalogItem.노임항목 || '';
                const perLocation = 1.0;
                const E = catalogItem.노임단가 || 0;
                const D = catalogItem.기준작업량 || 0;
                const totalAmount = Math.round(E * perLocation);
                
                const linkedKey = `${normalizeForMatch(workType)}|${normalizeForMatch(workName)}|${normalizeForMatch(detailItem)}|${areaRow.id}`;
                const existingRow = existingLinkedMap.get(linkedKey);
                
                if (existingRow) {
                  // [LOCK] 저장 시점에 확정된 행은 표준값 덮어쓰지 않음.
                  // 단, 피해면적(C)이 0인 행은 lock 효과 없음 → 산출표 면적이 흘러들어와 자동 채워지도록 허용
                  // (단가/카탈로그는 채워졌지만 면적이 0으로 저장된 빈 lock 행 보강용).
                  // 추가: 합계(amount)가 0인 잠금은 잘못 박힌 빈 lock으로 간주 → 자동 보정 허용.
                  const isEffectiveLock = existingRow.lockedAtSave &&
                    (Number(existingRow.damageArea) || 0) > 0 &&
                    (Number(existingRow.amount) || 0) > 0;
                  if (isEffectiveLock) {
                    // 메타필드(소스/장소/위치)만 갱신.
                    newLaborRows.push({
                      ...existingRow,
                      sourceAreaRowId: perAreaSourceId,
                      place: areaRow.category || existingRow.place,
                      position: areaRow.location || existingRow.position,
                    });
                  } else {
                    newLaborRows.push({
                      ...existingRow,
                      sourceAreaRowId: perAreaSourceId,
                      place: areaRow.category || '',
                      position: areaRow.location || '',
                      damageArea: singleArea,
                      standardPrice: E,
                      standardWorkQuantity: D,
                      quantity: perLocation,
                      pricePerSqm: E,
                      amount: totalAmount,
                    });
                  }
                  existingLinkedMap.delete(linkedKey);
                } else {
                  newLaborRows.push({
                    id: `labor-linked-${Date.now()}-${Math.random()}-${idx}-${areaRow.id.slice(-6)}`,
                    sourceAreaRowId: perAreaSourceId,
                    isLinkedFromRecovery: true,
                    place: areaRow.category || '',
                    position: areaRow.location || '',
                    category: workType,
                    workName: workName,
                    detailWork: '일위대가',
                    detailItem: detailItem,
                    priceStandard: '',
                    unit: '㎡',
                    standardPrice: E,
                    standardWorkQuantity: D,
                    quantity: perLocation,
                    applicationRates: { ceiling: false, wall: false, floor: false, molding: false },
                    salesMarkupRate: 0,
                    pricePerSqm: E,
                    damageArea: singleArea,
                    deduction: 0,
                    includeInEstimate: true,
                    request: '',
                    amount: totalAmount,
                  });
                }
              });
            });
          } else {
            matchingCatalogItems.forEach((catalogItem, idx) => {
              const detailItem = catalogItem.노임항목 || '';
              const standardWorkQty = catalogItem.기준작업량 || 0;
              const C = totalArea;
              const D = standardWorkQty;
              const E = catalogItem.노임단가 || 0;
              
              let appliedUnitPrice = 0;
              let totalAmount = 0;
              // [면적0 보정] 복구면적이 0이면 수량도 0으로 시작.
              // 예: 건축물보양 면적을 입력하지 않은 상태에서 자동 1로 잡혀 사용자 혼동.
              // 면적 > 0 이지만 카탈로그 D/E가 결손이면 기존대로 1 유지(회귀 방지).
              let calculatedQuantity = C > 0 ? 1 : 0;
              if (D > 0 && E > 0 && C > 0) {
                totalAmount = calculateIWithTiers(C, D, E, laborRateTiers);
                appliedUnitPrice = calculateAppliedUnitPriceWithTiers(C, D, E, laborRateTiers);
                calculatedQuantity = calculateQuantityWithTiers(C, D, E, laborRateTiers);
              }
              
              const linkedKey = `${normalizeForMatch(workType)}|${normalizeForMatch(workName)}|${normalizeForMatch(detailItem)}`;
              const existingRow = existingLinkedMap.get(linkedKey);
              
              if (existingRow) {
                // [LOCK] 저장 시점에 확정된 행은 표준값 덮어쓰지 않음.
                // 단, 피해면적(C)이 0인 행은 lock 효과 없음 → 산출표 면적이 흘러들어와 자동 채워지도록 허용.
                // 추가: 합계(amount)가 0인 잠금은 잘못 박힌 빈 lock으로 간주 → 자동 보정 허용.
                const isEffectiveLock = existingRow.lockedAtSave &&
                  (Number(existingRow.damageArea) || 0) > 0 &&
                  (Number(existingRow.amount) || 0) > 0;
                if (isEffectiveLock) {
                  // 메타필드(소스/장소/위치)만 갱신.
                  newLaborRows.push({
                    ...existingRow,
                    sourceAreaRowId: sourceAreaRowId,
                    place: combinedPlace || existingRow.place,
                    position: combinedPosition || existingRow.position,
                  });
                } else {
                  newLaborRows.push({
                    ...existingRow,
                    sourceAreaRowId: sourceAreaRowId,
                    place: combinedPlace,
                    position: combinedPosition,
                    damageArea: totalArea,
                    standardPrice: E,
                    standardWorkQuantity: standardWorkQty,
                    quantity: calculatedQuantity,
                    pricePerSqm: appliedUnitPrice,
                    amount: totalAmount,
                  });
                }
                existingLinkedMap.delete(linkedKey);
              } else {
                newLaborRows.push({
                  id: `labor-linked-${Date.now()}-${Math.random()}-${idx}`,
                  sourceAreaRowId: sourceAreaRowId,
                  isLinkedFromRecovery: true,
                  place: combinedPlace,
                  position: combinedPosition,
                  category: workType,
                  workName: workName,
                  detailWork: '일위대가',
                  detailItem: catalogItem.노임항목,
                  priceStandard: '',
                  unit: '㎡',
                  standardPrice: E,
                  standardWorkQuantity: standardWorkQty,
                  quantity: calculatedQuantity,
                  applicationRates: { ceiling: false, wall: false, floor: false, molding: false },
                  salesMarkupRate: 0,
                  pricePerSqm: appliedUnitPrice,
                  damageArea: totalArea,
                  deduction: 0,
                  includeInEstimate: true,
                  request: '',
                  amount: totalAmount,
                });
              }
            });
          }
        } else {
          const linkedKey = `${normalizeForMatch(workType)}|${normalizeForMatch(workName)}|`;
          const existingRow = existingLinkedMap.get(linkedKey);
          
          if (existingRow) {
            // [면적0 보정] 기존 fallback 행도 면적 0이면 quantity/amount/단가 0으로 override (사용자 요청).
            const isZeroArea = (Number(totalArea) || 0) <= 0;
            newLaborRows.push({
              ...existingRow,
              sourceAreaRowId,
              place: combinedPlace,
              position: combinedPosition,
              damageArea: totalArea,
              ...(isZeroArea ? { quantity: 0, amount: 0, pricePerSqm: 0 } : {}),
            });
            existingLinkedMap.delete(linkedKey);
          } else {
            const fallbackRow = createBlankLaborRow({
              sourceAreaRowId,
              isLinkedFromRecovery: true,
              place: combinedPlace,
              position: combinedPosition,
              category: workType,
              workName: workName,
              damageArea: totalArea,
            });
            // [면적0 보정] 카탈로그 매칭 없는 fallback도 면적 0이면 quantity/금액 0으로 시작.
            if ((Number(fallbackRow.damageArea) || 0) <= 0) {
              fallbackRow.quantity = 0;
              fallbackRow.amount = 0;
            }
            newLaborRows.push(fallbackRow);
          }
        }
      });
    });
    
    console.log('[복구면적가져오기] RESULT', {
      newLaborRowsCount: newLaborRows.length,
      demolitionLinkedCount: demolitionLinkedRows.length,
      independentCount: independentRows.length,
      newLaborRowsSample: newLaborRows.slice(0, 5).map(r => ({
        id: r.id, category: r.category, workName: r.workName, detailItem: r.detailItem, isLinked: r.isLinkedFromRecovery
      })),
    });
    
    // [수동행 보호] 사용자가 직접 추가한 행과 같은 공종|공사명|노임항목 조합의 자동 연동 행은 생성 skip.
    // 자동 sync 중복 체크는 isLinkedFromRecovery=true 행만 보므로, 수동행이 있어도 모르고 또 만들어 견적 중복 합산 발생.
    // → 수동행 우선: 같은 키면 자동 연동 행은 만들지 않음 (수동행이 그대로 보존).
    const manualKeySetForSync = new Set(
      independentRows.map(r =>
        `${normalizeForMatch(r.category || '')}|${normalizeForMatch(r.workName || '')}|${normalizeForMatch(r.detailItem || '')}`
      )
    );
    const dedupedNewLaborRows = newLaborRows.filter(r => {
      const key = `${normalizeForMatch(r.category || '')}|${normalizeForMatch(r.workName || '')}|${normalizeForMatch(r.detailItem || '')}`;
      if (manualKeySetForSync.has(key)) {
        console.log('[복구면적가져오기] 수동행 우선 - 자동 연동 행 생성 skip:', r.category, r.workName, r.detailItem);
        return false;
      }
      return true;
    });
    const dedupedDemolitionRows = demolitionLinkedRows.filter(r => {
      const key = `${normalizeForMatch(r.category || '')}|${normalizeForMatch(r.workName || '')}|${normalizeForMatch(r.detailItem || '')}`;
      if (manualKeySetForSync.has(key)) {
        console.log('[복구면적가져오기] 수동행 우선 - 자동 철거 행 생성 skip:', r.category, r.workName, r.detailItem);
        return false;
      }
      return true;
    });
    const allRows = [...dedupedNewLaborRows, ...dedupedDemolitionRows, ...independentRows];
    
    if (allRows.length > 0) {
      syncGuardRef.current = true;
      lastLaborSetSourceRef.current = 'syncLaborFromRecoveryArea';
      console.log('[복구면적가져오기] GUARD_ON, setting laborCostRows', {
        allRowsCount: allRows.length,
        newLinked: newLaborRows.length,
        demolition: demolitionLinkedRows.length,
        independent: independentRows.length,
      });
      setLaborCostRows(allRows);
      setSelectedLaborRows(new Set());
      setTimeout(() => {
        syncGuardRef.current = false;
        console.log('[복구면적가져오기] GUARD_OFF');
      }, 1500);
      toast({
        title: "노무비 동기화 완료",
        description: `복구면적 산출표에서 ${newLaborRows.length}개 항목이 동기화되었습니다.`,
      });
    } else {
      console.log('[복구면적가져오기] WARNING: allRows is empty, not updating');
    }
  };

  // 자동 연동 대상 공사명 (반자틀 제외)
  // '건축물현장정리' / '건축물보양' 둘 다 허용 (일위대가DB는 '건축물보양'으로 표기됨, 구 데이터/자재비DB 호환을 위해 옛 명칭도 유지)
  const AUTO_SYNC_MATERIAL_WORK_NAMES = ['합판', '석고', '석고보드', '몰딩', '걸레받이', '도배', '마루', '장판', '건축물현장정리', '건축물보양', '수성페인트', '무늬코트', '탄성코트', 'SMC', '리빙보드', '도기류', '붙박이장', '상부장', '하부장', '상부장&하부장', '키큰장', '상부장&키큰장', '상부장&하부장&키큰장'];
  
  // 복구면적 산출표에서 자재비로 동기화 (자재비DB 기반 자동 생성)
  // 핵심: 동일 Key(공종+공사명+자재항목)는 1행으로 merge, 전체 합산 후 마지막에 ceil 적용
  // isOverridden=true인 행은 사용자 수정값 보존 (autoQuantity만 업데이트)
  // RECONCILE: 복구면적에 없는 자동 생성 행은 삭제
  const syncMaterialFromRecoveryArea = (forceUnlock: boolean = false) => {
    // 협력업체(readOnly)도 동일한 화면값을 보도록 isReadOnly 가드 제거 (저장은 별도로 차단됨)
    // [정책 2026-05-13] forceUnlock=true: 수동 "복구면적 가져오기" 버튼 호출 → 저장 lock(lockedAtSave) 무효화하고 강제 갱신.
    //   forceUnlock=false(기본): 자동 useEffect 호출 → lockedAtSave=true 행은 자동 sync 차단.
    if (rows.length === 0) return;
    
    // 기존 행 분류
    // 수동 행: isAutoGenerated=false AND isLinkedFromRecovery=false (또는 undefined)
    const manualRows = materialRows.filter(row => !row.isAutoGenerated && !row.isLinkedFromRecovery);
    
    // 기존 자동 생성 행을 autoKey로 매핑 (재사용 위해)
    // isAutoGenerated=true 또는 isLinkedFromRecovery=true인 모든 행
    const existingAutoRows = materialRows.filter(row => row.isAutoGenerated || row.isLinkedFromRecovery);
    const existingAutoRowsMap = new Map<string, MaterialRow>();
    existingAutoRows.forEach(row => {
      // autoKey가 우선. fallback은 공종|공사명만 사용 (dedup useEffect와 일관성).
      // [회귀 수정 2026-05-04 재롤백] 자재항목 포함 키는 가설공사/건축물보양처럼 sync가
      // 매칭 실패해 매 클릭마다 새 행을 만드는 회귀를 유발했음. autoKey가 있는 행은
      // 그대로 매칭되고, autoKey 없는 행은 공종|공사명로 1:1 매칭하도록 보수적으로 복원.
      // [별칭 정규화 2026-05-05] 가설공사 '건축물보양' / '건축물현장정리' 둘 다 단일 canonical 키로 환원.
      // 옛/신규 어떤 명칭으로 생성된 행이든 새 sync의 autoKey와 매칭되도록 양방향 정규화.
      const norm = (v: any) => (v ?? "").toString().trim();
      const normalizedName = normalizeMaterialWorkName(norm(row.공종), norm(row.공사명));
      let key = row.autoKey || `${norm(row.공종)}|${normalizedName}`;
      if (row.autoKey && norm(row.공종) === '가설공사') {
        // autoKey 자체에 가설공사 보양 별칭이 들어있으면 canonical('건축물현장정리')로 환원.
        if (row.autoKey.includes('|건축물보양')) {
          key = row.autoKey.replace('|건축물보양', '|건축물현장정리');
        }
      }
      // [정책 2026-05-13] forceUnlock=true(수동 버튼)면 lock을 풀어서 가드 분기를 우회.
      //   → 갱신값이 자연스럽게 lockedAtSave=false로 저장돼 다음 진입까지 자유로움.
      //   다음 저장 시 다시 lockedAtSave=true로 박힘.
      const rowForMap = forceUnlock ? { ...row, lockedAtSave: false } : row;
      existingAutoRowsMap.set(key, rowForMap);
    });
    
    // 복구면적에서 공종+공사명별 면적 합산 (반자틀 제외)
    const workMap = new Map<string, { 
      공종: string; 
      공사명: string; 
      totalArea: number; 
      sourceAreaRowIds: string[];
      uniqueLocations: Set<string>;
    }>();
    
    rows.forEach(row => {
      const workType = row.workType || '';
      const rawWorkName = row.workName || '';
      if (!workType || !rawWorkName) return;
      
      if (AREA_DISPLAY_ONLY_WORK_TYPES.includes(workType) && !isItemInLinkSettings(workType, rawWorkName) && !AUTO_SYNC_MATERIAL_WORK_NAMES.includes(rawWorkName)) return;
      
      // 반자틀은 자동 연동 제외
      if (rawWorkName === '반자틀') return;
      
      // 바탕만들기 행은 자재비 연동 제외
      if (rawWorkName.startsWith('바탕만들기')) return;
      
      // 자동 연동 대상 또는 일위대가 연동 설정에 등록된 항목만 처리
      if (!AUTO_SYNC_MATERIAL_WORK_NAMES.includes(rawWorkName) && !isItemInLinkSettings(workType, rawWorkName)) return;
      
      // 가설공사: 자재비DB에는 '건축물현장정리'-보양재만 존재.
      // 일위대가DB 명칭이 '건축물보양'으로 변경되어 두 명칭을 동의어로 처리.
      // '건축물보양' / '건축물현장정리' 둘 다 자재비 lookup 시 '건축물현장정리'으로 정규화.
      // '준공청소' 등 다른 가설공사 항목은 보양재와 무관하므로 자재비 연동 제외(면적 합산 금지).
      let normalizedWorkName = rawWorkName;
      if (workType === '가설공사') {
        if (rawWorkName === '건축물보양' || rawWorkName === '건축물현장정리') {
          normalizedWorkName = '건축물현장정리';
        } else {
          return; // 준공청소 등 가설공사 기타 항목은 자재비 연동에서 제외
        }
      }
      
      // 가구공사 조합 항목: 자재비DB에는 단독 항목(상부장, 하부장, 키큰장)만 존재.
      // 조합을 구성 단독 항목으로 분해하여 각각 자재비 행을 생성.
      const COMPOUND_FURNITURE_MAP: Record<string, string[]> = {
        '상부장&하부장': ['상부장', '하부장'],
        '상부장&키큰장': ['상부장', '키큰장'],
        '상부장&하부장&키큰장': ['상부장', '하부장', '키큰장'],
      };
      const expandedWorkNames = (workType === '가구공사' && COMPOUND_FURNITURE_MAP[normalizedWorkName])
        ? COMPOUND_FURNITURE_MAP[normalizedWorkName]
        : [normalizedWorkName];
      
      const repairArea = parseFloat(row.repairArea) || 0;
      // 장소 구분 키: 복구면적산출표의 category(장소: 화장실1, 화장실2 등)를 사용
      // location 필드는 위치(천장/벽면/바닥)이므로 사용하지 않음
      const locationKey = (row.category || '').trim();
      expandedWorkNames.forEach(workName => {
        const key = `${workType}|${workName}`;
        if (!workMap.has(key)) {
          workMap.set(key, { 
            공종: workType, 
            공사명: workName, 
            totalArea: 0,
            sourceAreaRowIds: [],
            uniqueLocations: new Set<string>()
          });
        }
        const data = workMap.get(key)!;
        data.totalArea += repairArea;
        data.sourceAreaRowIds.push(row.id);
        if (locationKey) data.uniqueLocations.add(locationKey);
      });
    });
    
    // 공사명별 자재 항목 생성/업데이트 (자재비DB 매칭)
    // Map으로 autoKey 기준 merge: 동일한 autoKey는 1행만 유지
    // nextAutoKeys: 현재 복구면적에서 생성되어야 하는 모든 autoKey
    const nextAutoKeys = new Set<string>();
    const resultRowsMap = new Map<string, MaterialRow>();
    
    const PAINTING_WORK_NAMES = ['수성페인트', '무늬코트', '탄성코트'];

    workMap.forEach((data) => {
      const isPaintingMaterial = data.공종 === '도장공사' && PAINTING_WORK_NAMES.includes(data.공사명);

      // 자재비DB에서 공사명으로 매칭되는 자재 찾기
      // [별칭 정규화 2026-05-05] 가설공사 '건축물현장정리' / '건축물보양' 둘 다 동일 항목으로 lookup.
      // 자재비DB에 어느 명칭으로 등록되어 있어도 매칭되도록 양방향 처리.
      const matchingMaterials = materialByWorknameCatalog.filter(item => {
        const itemName = normalizeForMatch(item.공사명 || '');
        const dataName = normalizeForMatch(data.공사명 || '');
        if (itemName === dataName) return true;
        if (data.공종 === '가설공사') {
          const aliases = ['건축물현장정리', '건축물보양'].map(normalizeForMatch);
          if (aliases.includes(itemName) && aliases.includes(dataName)) return true;
        }
        return false;
      });
      
      // 수량 계산 (단위별 산식 적용)
      const ratio = MATERIAL_UNIT_RATIOS[data.공사명];
      let calculatedQty: number;
      let calculatedUnit: string;
      let autoUnitType: 'm2' | 'EA';
      
      const exactCategoryMatch = matchingMaterials.find(
        item => normalizeForMatch(item.공종 || '') === normalizeForMatch(data.공종 || '')
      );
      const dbUnit = exactCategoryMatch ? (exactCategoryMatch.단위 || 'EA') : (matchingMaterials.length > 0 ? (matchingMaterials[0].단위 || 'EA') : 'EA');

      // FIXED 일위대가 항목 (욕실/가구 SMC, 리빙보드, 도기류, 붙박이장, 상부장 시리즈)
      // 자재비DB의 단위(EA)/단가/자재항목을 그대로 사용
      const FIXED_ILWIDAEGA_WORK_NAMES_INLINE = ['SMC', '리빙보드', '도기류', '붙박이장', '상부장', '하부장', '상부장&하부장', '키큰장', '상부장&키큰장', '상부장&하부장&키큰장'];
      const isFixedMaterial = FIXED_ILWIDAEGA_WORK_NAMES_INLINE.includes(data.공사명);

      if (isPaintingMaterial) {
        calculatedQty = Math.round(data.totalArea * 10) / 10;
        calculatedUnit = dbUnit;
        autoUnitType = 'EA';
        console.log(`[자재비 집계] 도장공사 ${data.공사명}: 총면적 ${data.totalArea}㎡ (실면적 그대로, 단위: ${dbUnit})`);
      } else if (isFixedMaterial) {
        // 가구공사 FIXED: 단위 '1자' = 30cm. 수량 = ceil(복구면적(m) ÷ 0.3m)
        if (data.공종 === '가구공사') {
          calculatedQty = data.totalArea > 0 ? Math.ceil(data.totalArea / 0.3) : 0;
          calculatedUnit = dbUnit || '자';
          autoUnitType = 'EA';
          console.log(`[자재비 집계] 가구공사 FIXED ${data.공사명}: 총길이 ${data.totalArea}m ÷ 0.3m = ${data.totalArea / 0.3} → ceil → ${calculatedQty} ${calculatedUnit}`);
        } else {
          // 욕실공사 FIXED (SMC, 리빙보드, 도기류): 위치별 1개씩 카운트
          // 화장실1, 화장실2 → 2개. 같은 위치 내 여러 행은 1개.
          const locationCount = data.uniqueLocations.size;
          calculatedQty = locationCount > 0 ? locationCount : (data.totalArea > 0 ? 1 : 0);
          calculatedUnit = dbUnit;
          autoUnitType = 'EA';
          console.log(`[자재비 집계] FIXED ${data.공종} ${data.공사명}: 위치 수 ${locationCount}개 (위치: ${Array.from(data.uniqueLocations).join(', ')}) → 수량 ${calculatedQty} ${dbUnit}`);
        }
      } else if (ratio) {
        // EA 단위: 전체 합산 후 마지막에 한 번만 ceil
        calculatedQty = Math.ceil(data.totalArea / ratio.unitSize);
        calculatedUnit = ratio.unit;
        autoUnitType = 'EA';
        console.log(`[자재비 집계] ${data.공사명}: 총면적 ${data.totalArea} ÷ ${ratio.unitSize} = ${data.totalArea / ratio.unitSize} → ceil → ${calculatedQty} ${calculatedUnit}`);
      } else {
        // m² 단위 (도배, 마루, 장판): 합산값 그대로
        calculatedQty = Math.round(data.totalArea * 10) / 10;
        calculatedUnit = '㎡';
        autoUnitType = 'm2';
        console.log(`[자재비 집계] ${data.공사명}: 총면적 ${data.totalArea}㎡ 그대로 사용`);
      }

      if (isPaintingMaterial) {
        const norm = (v: any) => (v ?? "").toString().trim();
        const autoKey = `${norm(data.공종)}|${norm(data.공사명)}|__PAINT__`;
        nextAutoKeys.add(autoKey);

        const ilwidaegaItem = mergedIlwidaegaCatalog.find(
          item => item.공종 === data.공종 && normalizeForMatch(item.공사명 || '') === normalizeForMatch(data.공사명 || '')
        );
        const laborUnitPrice = ilwidaegaItem?.노임단가 || 0;

        // 자재비DB 카탈로그에서 페인트 메인 자재항목(자재항목 == 공사명) 단가 조회
        // 예: 도장공사/수성페인트/수성페인트의 단가 (1,290원 또는 "직접입력")
        // 모든 케이스에 자재비DB 카탈로그 단가가 자동 반영됨 (사용자가 수동 오버라이드한 행은 보존).
        const paintMainCatalog = matchingMaterials.find(
          item => normalizeForMatch(item.공종 || '') === normalizeForMatch(data.공종 || '')
                  && normalizeForMatch(item.자재항목 || '') === normalizeForMatch(data.공사명 || '')
        );
        const catalogPriceRaw = paintMainCatalog?.금액;
        const catalogIsManualEntry = typeof catalogPriceRaw === 'string'
          && (catalogPriceRaw.includes('입력') || catalogPriceRaw === '입력' || catalogPriceRaw === '직접입력');
        const catalogUnitPrice = typeof catalogPriceRaw === 'number' ? catalogPriceRaw : 0;
        const isManualPriceEntryFlag = catalogIsManualEntry || catalogUnitPrice <= 0;

        const existingRow = existingAutoRowsMap.get(autoKey);

        if (existingRow && existingRow.lockedAtSave) {
          // [정책 2026-05-13] 저장 후 lock 행: 자동 sync 완전 차단 — 메타데이터만 추적용 갱신.
          //   사용자가 명시적으로 "복구면적 가져오기"를 누르기 전엔 어떤 값도 안 바뀜.
          resultRowsMap.set(autoKey, {
            ...existingRow,
            autoKey,
            sourceAreaRowIds: data.sourceAreaRowIds,
          });
          console.log(`[자재비 집계] 도장공사 ${data.공사명}: lockedAtSave=true, 자동 sync 차단`);
        } else if (existingRow && existingRow.isOverridden) {
          // 사용자 직접 수정 행: 단가/수량은 보존, 면적/메타만 갱신
          resultRowsMap.set(autoKey, {
            ...existingRow,
            autoKey,
            수량m2: calculatedQty,
            autoQuantity: calculatedQty,
            sourceAreaRowIds: data.sourceAreaRowIds,
            isManualPriceEntry: isManualPriceEntryFlag,
          });
          console.log(`[자재비 집계] 도장공사 ${data.공사명}: isOverridden, 사용자 값 보존`);
        } else if (existingRow) {
          // 자동 생성 행 (사용자 미수정): 카탈로그 단가가 숫자면 갱신, 아니면 기존값 유지
          const newPrice = catalogUnitPrice > 0 ? catalogUnitPrice : (existingRow.단가 || 0);
          // [표시 수량 정합화 2026-05-06] 페인트 행 수량은 복구면적(바닥+벽체+천장) 그대로 표시.
          // 기존엔 amt/노임단가로 환산된 값(예 42.9)을 보여줘 사용자가 단가×수량으로 검산 시 합계와 안 맞음.
          // 합계 산식(단가×복구면적)은 변경하지 않음.
          const qty = calculatedQty;
          const amt = Math.round(newPrice * qty);
          resultRowsMap.set(autoKey, {
            ...existingRow,
            autoKey,
            단위: dbUnit,
            단가: newPrice,
            기준단가: laborUnitPrice,
            수량m2: qty,
            수량EA: 0,
            수량: qty,
            합계: amt,
            금액: amt,
            sourceAreaRowIds: data.sourceAreaRowIds,
            autoQuantity: calculatedQty,
            autoUnitType: 'EA',
            isManualPriceEntry: isManualPriceEntryFlag,
          });
          console.log(`[자재비 집계] 도장공사 ${data.공사명}: 기존 행 업데이트 (노임단가: ${laborUnitPrice}, 단가: ${newPrice}, 카탈로그단가: ${catalogPriceRaw}, 단위: ${dbUnit}, 표시수량=복구면적: ${qty})`);
        } else {
          // 새 행 생성: 카탈로그 단가가 숫자면 그것 사용, "직접입력"이면 0
          const newPrice = catalogUnitPrice > 0 ? catalogUnitPrice : 0;
          // [표시 수량 정합화 2026-05-06] 동일: 페인트 행 수량 = 복구면적
          const qty = calculatedQty;
          const amt = Math.round(newPrice * qty);
          resultRowsMap.set(autoKey, {
            id: `material-auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            공종: data.공종,
            공사명: data.공사명,
            자재항목: data.공사명,
            자재: data.공사명,
            규격: '',
            단위: dbUnit,
            단가: newPrice,
            기준단가: laborUnitPrice,
            수량m2: qty,
            수량EA: 0,
            수량: qty,
            합계: amt,
            금액: amt,
            includeInEstimate: true,
            비고: '',
            sourceAreaRowIds: data.sourceAreaRowIds,
            isLinkedFromRecovery: true,
            autoKey,
            isAutoGenerated: true,
            isOverridden: false,
            autoQuantity: calculatedQty,
            autoUnitType: 'EA',
            isManualPriceEntry: isManualPriceEntryFlag,
          });
          console.log(`[자재비 집계] 도장공사 ${data.공사명}: 새 행 생성 (노임단가: ${laborUnitPrice}, 단가: ${newPrice}, 카탈로그단가: ${catalogPriceRaw})`);
        }
        return;
      }

      
      if (matchingMaterials.length > 0) {
        // [단일행 정책 2026-05-07] 한 공종+공사명에 자재비DB가 여러 자재(예: 도배의 실크벽지/합지벽지)를
        // 등록한 경우, 자동연동 시에는 1행만 생성하고 자재항목은 비워 사용자가 드롭다운에서 선택하도록 함.
        // (단일 매칭이면 그 자재로 자동 채움 — 기존 동작 유지)
        // 산식 변경 없음, 매칭 정책만 조정.
        const isSingleMaterialMatch = matchingMaterials.length === 1;
        const materialsToCreate = isSingleMaterialMatch ? matchingMaterials : [null];
        materialsToCreate.forEach(materialOrNull => {
          const norm = (v: any) => (v ?? "").toString().trim();
          // 복수 매칭일 때는 빈 자재로 단일 행 생성 (자재항목 비움)
          const material = materialOrNull ?? {
            공종: data.공종,
            공사명: data.공사명,
            자재항목: '',
            규격: '',
            단위: dbUnit,
            금액: 0,
          } as typeof matchingMaterials[number];
          const itemKey = norm(material.자재항목) || "__NONE__";
          const autoKey = `${norm(data.공종)}|${norm(data.공사명)}|${itemKey}`;
          nextAutoKeys.add(autoKey);
          
          // 단가가 '입력', '직접입력' 문자열인 경우 직접 입력 필요
          const priceValue = material.금액;
          const isManualEntry = typeof priceValue === 'string' && 
            (priceValue.includes('입력') || priceValue === '입력' || priceValue === '직접입력');
          const unitPrice = typeof priceValue === 'number' ? priceValue : 0;
          
          // 기존 행이 있는지 확인.
          // [중복 누적 fix 2026-05-06] autoKey 없이 저장된 옛 행은 fallback key=`공종|공사명`로
          // 등록되어 있으므로 자재항목 포함 autoKey lookup만으로는 MISS → 매번 새 행 생성되던 회귀.
          // autoKey 매칭 실패 시 `공종|공사명`(자재항목 제외) fallback도 시도해 1:1 매칭 확보.
          const norm2 = (v: any) => (v ?? "").toString().trim();
          const fallbackKey = `${norm2(data.공종)}|${norm2(data.공사명)}`;
          const existingRow = existingAutoRowsMap.get(autoKey) || existingAutoRowsMap.get(fallbackKey);
          
          if (existingRow && existingRow.lockedAtSave) {
            // [정책 2026-05-13] 저장 후 lock 행: 자동 sync 완전 차단 — 메타데이터만 추적용 갱신.
            //   사용자가 "복구면적 가져오기"를 누르기 전엔 진입만으로 어떤 값도 안 바뀜.
            resultRowsMap.set(autoKey, {
              ...existingRow,
              autoKey,
              sourceAreaRowIds: data.sourceAreaRowIds,
            });
            console.log(`[자재비 집계] ${autoKey}: lockedAtSave=true, 자동 sync 차단`);
          } else if (existingRow && existingRow.isOverridden) {
            // [정책 2026-05-12] 사용자 수정값 절대 우선 — FIXED라도 isOverridden=true면 수량 강제 갱신 금지.
            //   기존엔 욕실/가구 FIXED는 사용자 수정 표식이 있어도 자동 카운트로 강제 덮어썼음(증상 4·5 root cause).
            //   isOverridden=true는 사용자가 의도적으로 수량/단가를 수정한 표식이므로 절대 산식값으로 회귀시키지 않는다.
            const isFixedAutoQty = false;
            const preservedPriceForOverride = existingRow.단가 || existingRow.기준단가 || 0;
            // [정책 2026-05-12] 자재항목 보존 — 사용자가 선택한 값(예: 합지벽지) 절대 강제 갱신 금지.
            //   기존엔 카탈로그 자재항목으로 강제 덮어써서 합지/실크 선택값이 다음 sync에 소실됐음.
            const preservedItemName = (existingRow.자재항목 && (existingRow.자재항목 || '').trim() !== '')
              ? existingRow.자재항목
              : material.자재항목;
            resultRowsMap.set(autoKey, {
              ...existingRow,
              autoKey,
              공사명: material.공사명 || data.공사명,
              자재항목: preservedItemName,
              자재: preservedItemName,
              규격: material.규격 || existingRow.규격 || '',
              autoQuantity: calculatedQty,
              sourceAreaRowIds: data.sourceAreaRowIds,
              isManualPriceEntry: existingRow.isManualPriceEntry ?? isManualEntry,
              ...(isFixedAutoQty ? {
                단위: calculatedUnit,
                수량m2: autoUnitType === 'm2' ? calculatedQty : (data.공종 === '가구공사' ? 0 : data.totalArea),
                수량EA: autoUnitType === 'EA' ? calculatedQty : 0,
                수량: calculatedQty,
                합계: Math.round(preservedPriceForOverride * calculatedQty),
                금액: Math.round(preservedPriceForOverride * calculatedQty),
                autoUnitType,
              } : {}),
            });
            console.log(`[자재비 집계] ${autoKey}: isOverridden=true, 사용자 값 보존${isFixedAutoQty ? ' (FIXED 수량 강제 갱신: ' + calculatedQty + ')' : ''}`);
          } else if (existingRow) {
            // 기존 자동 행: 값 업데이트 (ID 유지)
            // 단, 사용자가 이미 입력한 단가는 보존 (0이 아닌 경우)
            // 자재항목/자재/규격/공사명은 카탈로그를 진실의 원천으로 강제 갱신 (autoKey와 일치 보장)
            // [DB 명칭 연동 2026-05-05] 공사명도 카탈로그 명칭으로 강제 갱신 — DB에서 명칭 변경 시 화면도 즉시 반영.
            const existingPrice = existingRow.단가 || existingRow.기준단가 || 0;
            const preservedPrice = existingPrice > 0 ? existingPrice : unitPrice;
            // 사용자가 단가를 입력한 경우 isManualPriceEntry 유지 (isOverridden도 설정)
            const shouldPreserveManualFlag = existingRow.isManualPriceEntry && existingPrice > 0;
            // [정책 2026-05-13] 자재항목 보존 강화 — isItemOverridden=true이거나 기존 값이 비어있지 않으면 보존.
            //   사용자가 합지/실크 선택값에 isItemOverridden 플래그를 박아 두므로, 면적 기반 수량은 갱신하되
            //   자재명·단가는 절대 카탈로그로 회귀시키지 않는다. ("이후 면적만 변경 시 연동" 정책 충족)
            const hasUserPickedItem = existingRow.isItemOverridden ||
              (existingRow.자재항목 && (existingRow.자재항목 || '').trim() !== '');
            const preservedItemName2 = hasUserPickedItem ? existingRow.자재항목 : material.자재항목;
            resultRowsMap.set(autoKey, {
              ...existingRow,
              autoKey,
              공사명: material.공사명 || data.공사명,
              자재항목: preservedItemName2,
              자재: preservedItemName2,
              규격: material.규격 || existingRow.규격 || '',
              단위: calculatedUnit,
              단가: preservedPrice,
              기준단가: preservedPrice,
              수량m2: autoUnitType === 'm2' ? calculatedQty : (data.공종 === '가구공사' ? 0 : data.totalArea),
              수량EA: autoUnitType === 'EA' ? calculatedQty : 0,
              수량: calculatedQty,
              합계: Math.round(preservedPrice * calculatedQty),
              금액: Math.round(preservedPrice * calculatedQty),
              sourceAreaRowIds: data.sourceAreaRowIds,
              autoQuantity: calculatedQty,
              autoUnitType,
              isManualPriceEntry: shouldPreserveManualFlag ? false : (existingRow.isManualPriceEntry ?? isManualEntry),
              isOverridden: shouldPreserveManualFlag ? true : existingRow.isOverridden,
              isItemOverridden: existingRow.isItemOverridden,
            });
            console.log(`[자재비 집계] ${autoKey}: 기존 행 업데이트 (단가 보존: ${existingPrice > 0}, 직접입력: ${existingRow.isManualPriceEntry ?? isManualEntry})`);
          } else {
            // 새 자동 생성 행
            // [DB 명칭 연동 2026-05-05] 공사명은 카탈로그(자재비DB) 명칭을 우선 채택.
            // DB에서 명칭이 변경되면 화면에도 즉시 반영. 가설공사 '건축물현장정리'/'건축물보양'은
            // 자재비DB 등록 명칭을 그대로 사용 → 환경별 DB 명칭 차이를 자동 흡수.
            resultRowsMap.set(autoKey, {
              id: `material-auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              공종: data.공종,
              공사명: material.공사명 || data.공사명,
              자재항목: material.자재항목,
              자재: material.자재항목,
              규격: material.규격 || '',
              단위: calculatedUnit,
              단가: unitPrice,
              기준단가: unitPrice,
              수량m2: autoUnitType === 'm2' ? calculatedQty : (data.공종 === '가구공사' ? 0 : data.totalArea),
              수량EA: autoUnitType === 'EA' ? calculatedQty : 0,
              수량: calculatedQty,
              합계: Math.round(unitPrice * calculatedQty),
              금액: Math.round(unitPrice * calculatedQty),
              includeInEstimate: true,
              비고: '',
              sourceAreaRowIds: data.sourceAreaRowIds,
              isLinkedFromRecovery: true,
              autoKey,
              isAutoGenerated: true,
              isOverridden: false,
              isItemOverridden: false,
              autoQuantity: calculatedQty,
              autoUnitType,
              isManualPriceEntry: isManualEntry,
            });
            console.log(`[자재비 집계] ${autoKey}: 새 행 생성 (직접입력: ${isManualEntry})`);
          }
        });
      } else {
        // 매칭되는 자재가 없으면 빈 행 생성
        const norm = (v: any) => (v ?? "").toString().trim();
        const autoKey = `${norm(data.공종)}|${norm(data.공사명)}|__NONE__`;
        nextAutoKeys.add(autoKey);
        
        const existingRow = existingAutoRowsMap.get(autoKey);
        
        if (existingRow && existingRow.lockedAtSave) {
          // [정책 2026-05-13] 저장 후 lock 행: 자동 sync 완전 차단.
          resultRowsMap.set(autoKey, {
            ...existingRow,
            autoKey,
            sourceAreaRowIds: data.sourceAreaRowIds,
          });
          console.log(`[자재비 집계] ${autoKey}(빈매칭): lockedAtSave=true, 자동 sync 차단`);
        } else if (existingRow && existingRow.isOverridden) {
          resultRowsMap.set(autoKey, {
            ...existingRow,
            autoKey,
            autoQuantity: calculatedQty,
            sourceAreaRowIds: data.sourceAreaRowIds,
          });
        } else if (existingRow) {
          resultRowsMap.set(autoKey, {
            ...existingRow,
            autoKey,
            수량m2: autoUnitType === 'm2' ? calculatedQty : data.totalArea,
            수량EA: autoUnitType === 'EA' ? calculatedQty : 0,
            수량: calculatedQty,
            sourceAreaRowIds: data.sourceAreaRowIds,
            autoQuantity: calculatedQty,
            autoUnitType,
          });
        } else {
          resultRowsMap.set(autoKey, {
            id: `material-auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            공종: data.공종,
            공사명: data.공사명,
            자재항목: '',
            자재: '',
            규격: '',
            단위: calculatedUnit,
            단가: 0,
            기준단가: 0,
            수량m2: autoUnitType === 'm2' ? calculatedQty : data.totalArea,
            수량EA: autoUnitType === 'EA' ? calculatedQty : 0,
            수량: calculatedQty,
            합계: 0,
            금액: 0,
            includeInEstimate: true,
            비고: '',
            sourceAreaRowIds: data.sourceAreaRowIds,
            isLinkedFromRecovery: true,
            autoKey,
            isAutoGenerated: true,
            isOverridden: false,
            autoQuantity: calculatedQty,
            autoUnitType,
          });
        }
      }
    });
    
    // RECONCILE: 자동 행 분류 및 병합
    // 1. 비대상 공사명 행 (도장공사, 가설공사 등): 그대로 유지 (삭제 안 함)
    // 2. 대상 공사명 행 (AUTO_SYNC_MATERIAL_WORK_NAMES): resultRowsMap 사용 (stale 행 자동 제거)
    
    const isBatangRow = (workName: string) => (workName || '').startsWith('바탕만들기');

    // 비대상 공사명 자동 행: 그대로 유지 (바탕만들기 제외 - 자재비DB에 없는 항목)
    const nonTargetAutoRows = existingAutoRows.filter(row => 
      !AUTO_SYNC_MATERIAL_WORK_NAMES.includes(row.공사명 || '') && !isBatangRow(row.공사명 || '')
    );
    
    // 대상 공사명 중 stale 행 개수 (로깅용)
    const targetAutoRows = existingAutoRows.filter(row => 
      AUTO_SYNC_MATERIAL_WORK_NAMES.includes(row.공사명 || '')
    );
    // [정책 2026-05-13] lockedAtSave 자동행은 stale이어도 자동 sync에서 삭제 금지(수동 forceUnlock만 허용).
    //   사용자가 면적을 0으로 만들거나 영역행을 지워서 autoKey가 사라져도 저장된 자재비 행은 유지.
    const lockedStaleSurvivors: MaterialRow[] = [];
    const deletedCount = targetAutoRows.filter(row => {
      const norm = (v: any) => (v ?? "").toString().trim();
      const key = row.autoKey || `${norm(row.공종)}|${norm(row.공사명)}|${norm(row.자재항목) || "__NONE__"}`;
      const isStale = !nextAutoKeys.has(key);
      if (isStale && row.lockedAtSave && !forceUnlock) {
        lockedStaleSurvivors.push(row);
        return false;
      }
      return isStale;
    }).length;
    
    if (deletedCount > 0) {
      console.log(`[MATERIAL RECONCILE] ${deletedCount}개 stale 자동 행 삭제됨`);
    }
    if (lockedStaleSurvivors.length > 0) {
      console.log(`[MATERIAL RECONCILE] ${lockedStaleSurvivors.length}개 lockedAtSave stale 행 보존됨(자동 sync 삭제 차단)`);
    }
    
    // 수동 행 필터링 로직:
    // 1. AUTO_SYNC_MATERIAL_WORK_NAMES에 해당하는 공사명: 복구면적 연동 대상이므로 제거 (자동 행으로 대체)
    // 2. 그 외 공사명: 수동 입력이므로 유지
    // 이렇게 하면: 복구면적에서 항목 삭제 시 자재비도 함께 삭제됨
    const filteredManualRows = manualRows.filter(row => {
      const norm = (v: any) => (v ?? "").toString().trim();
      const workName = (row.공사명 || '').toString().trim();
      // 바탕만들기 수동행: 자재비DB에 없는 항목 → 항상 제거
      if (isBatangRow(workName)) {
        console.log('[자재비 수동행 제거 - 바탕만들기]', row.공종, row.공사명, row.자재항목);
        return false;
      }
      // 자동연동 대상 공사명: 동일 키의 자동행이 있을 때만 수동행 제거 (중복 방지).
      // 자동행이 없으면(예: 산출표에서 영역행이 없거나, 면적 결손으로 자동키 미생성) 사용자 수동행 보존.
      if (AUTO_SYNC_MATERIAL_WORK_NAMES.includes(workName)) {
        // [별칭 정규화 2026-05-05] 가설공사 '건축물보양' 수동행을 신규 autoKey('건축물현장정리')로 매칭.
        const normalizedName = normalizeMaterialWorkName(norm(row.공종), norm(row.공사명));
        const manualKey = `${norm(row.공종)}|${normalizedName}|${norm(row.자재항목) || "__NONE__"}`;
        if (nextAutoKeys.has(manualKey)) {
          console.log('[자재비 수동행 제거 - 자동행과 중복]', row.공종, row.공사명, row.자재항목);
          return false;
        }
        console.log('[자재비 수동행 보존 - 매칭 자동행 없음]', row.공종, row.공사명, row.자재항목);
        return true;
      }
      return true;
    });
    
    console.log("[MATERIAL RECONCILE]", {
      nextKeys: Array.from(nextAutoKeys).sort(),
      before: materialRows.length,
      beforeAuto: existingAutoRows.length,
      beforeManual: manualRows.length,
      filteredManual: filteredManualRows.length,
      targetAuto: targetAutoRows.length,
      nonTargetAuto: nonTargetAutoRows.length,
      afterTargetAuto: resultRowsMap.size,
      deleted: deletedCount,
    });
    
    // 결과 병합: 대상 공사명 자동 행(resultRowsMap) + 비대상 공사명 자동 행(유지) + 필터된 수동 행
    const resultAutoRows = Array.from(resultRowsMap.values());
    const allRows = [...resultAutoRows, ...lockedStaleSurvivors, ...nonTargetAutoRows, ...filteredManualRows];
    
    console.log("[RECONCILE RESULT]", {
      nextKeys: Array.from(nextAutoKeys),
      finalRows: allRows.map(r => ({
        id: r.id,
        auto: r.isAutoGenerated,
        key: r.autoKey,
        work: r.공사명,
        material: r.자재항목
      }))
    });
    
    if (allRows.length > 0 || materialRows.length > 0) {
      setMaterialRows(allRows);
      setSelectedMaterialRows(new Set());
    }
  };

  // 자재비 행 추가
  const addMaterialRow = () => {
    if (isReadOnly) return;
    setMaterialRows(prev => [...prev, createBlankMaterialRow()]);
  };

  // 선택된 자재비 행 삭제
  const deleteSelectedMaterialRows = () => {
    if (isReadOnly) return;
    if (selectedMaterialRows.size === 0) return;
    // 삭제된 행과 연결된 노무비 행 정보 제거
    const deletedSourceIds = new Set(
      materialRows
        .filter(row => selectedMaterialRows.has(row.id))
        .map(row => row.sourceLaborRowId)
        .filter(Boolean)
    );
    setMaterialRows(prev => prev.filter(row => !selectedMaterialRows.has(row.id)));
    setSelectedMaterialRows(new Set());
  };

  // 자재비 행 전체 선택/해제
  const toggleSelectAllMaterialRows = () => {
    if (selectedMaterialRows.size === materialRows.length) {
      setSelectedMaterialRows(new Set());
    } else {
      setSelectedMaterialRows(new Set(materialRows.map(row => row.id)));
    }
  };

  // 자재비 행 개별 선택
  const toggleSelectMaterialRow = (rowId: string) => {
    setSelectedMaterialRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(rowId)) {
        newSet.delete(rowId);
      } else {
        newSet.add(rowId);
      }
      return newSet;
    });
  };

  // 노무비 공종 목록 (자재비에서 사용)
  const laborCategories = useMemo(() => {
    if (!laborCatalog.length) return [];
    console.log('[DEBUG] laborCatalog 첫 5개 항목:', laborCatalog.slice(0, 5));
    console.log('[DEBUG] laborCatalog 공종 필드 샘플:', laborCatalog.slice(0, 5).map(item => item.공종));
    const unique = new Set(laborCatalog.map(item => item.공종));
    const result = Array.from(unique).sort();
    console.log('[DEBUG] 추출된 공종 목록:', result);
    return result;
  }, [laborCatalog]);
  
  // 공종별 공사명 매핑 (복구면적 산출표에서 사용)
  const workNamesByWorkType = useMemo(() => {
    if (!laborCatalog.length) return {} as Record<string, string[]>;
    const mapping: Record<string, Set<string>> = {};
    const batangPrefixes = ['바탕만들기(', '바탕만들기 ('];
    laborCatalog.forEach(item => {
      const isBatang = batangPrefixes.some(prefix => (item.공사명 || '').startsWith(prefix));
      if (isBatang) return;
      if (!mapping[item.공종]) {
        mapping[item.공종] = new Set();
      }
      if (normalizeForMatch(item.공종 || '') === normalizeForMatch('목공사') && normalizeForMatch(item.공사명 || '') === normalizeForMatch('목공사')) {
        mapping[item.공종].add('걸레받이');
      } else {
        mapping[item.공종].add(item.공사명);
      }
    });
    const result: Record<string, string[]> = {};
    Object.keys(mapping).forEach(key => {
      result[key] = Array.from(mapping[key]).sort();
    });
    return result;
  }, [laborCatalog]);

  // 자재비 선택기 state
  const [selectedMaterialCategory, setSelectedMaterialCategory] = useState("");
  const [selectedMaterialName, setSelectedMaterialName] = useState("");
  const [selectedMaterialSpec, setSelectedMaterialSpec] = useState("");

  // 카테고리별 마스터 데이터 필터링
  const roomCategories = masterDataList
    .filter(item => item.category === 'room_category')
    .map(item => item.value);
  const locations = masterDataList
    .filter(item => item.category === 'location')
    .map(item => item.value);
  const workNames = masterDataList
    .filter(item => item.category === 'work_name')
    .map(item => item.value);

  // 선택된 케이스 데이터 가져오기
  const { data: selectedCase, isLoading: isLoadingSelectedCase } = useQuery<Case>({
    queryKey: [`/api/cases/${selectedCaseId}`],
    enabled: !!selectedCaseId,
  });

  // 도면 데이터 조회 (제출 조건 체크용)
  const { data: drawingData, isLoading: isLoadingDrawing } = useQuery({
    queryKey: ["/api/drawings", "case", selectedCaseId],
    enabled: !!selectedCaseId,
  });

  // 문서 데이터 조회 (제출 조건 체크용)
  const { data: documentsData, isLoading: isLoadingDocuments } = useQuery({
    queryKey: ["/api/documents/case", selectedCaseId],
    enabled: !!selectedCaseId,
  });

  // 제출 조건 상태 계산
  const isFieldInputComplete = useMemo(() => {
    return !!(selectedCase?.visitDate && selectedCase?.visitTime && selectedCase?.accidentCategory && selectedCase?.victimName);
  }, [selectedCase]);

  const isDrawingComplete = useMemo(() => {
    return !isLoadingDrawing && !!drawingData && typeof drawingData === 'object' && 'id' in drawingData;
  }, [drawingData, isLoadingDrawing]);

  const isDocumentsComplete = useMemo(() => {
    return !isLoadingDocuments && Array.isArray(documentsData) && documentsData.length > 0;
  }, [documentsData, isLoadingDocuments]);

  // 현장출동보고서 제출 후 협력사는 수정 불가 (반려 시 수정 가능)
  const isPartner = currentUser?.role === "협력사";
  const isRejected = selectedCase?.status === "반려";
  const isSubmitted = selectedCase?.fieldSurveyStatus === "submitted";
  // 협력사는 제출 후 수정 불가 (반려 시 수정 가능)
  const isReadOnly = isPartner && isSubmitted && !isRejected;
  // 모바일(네이티브/모바일웹) 견적서에서는 비고란만 숨김 (산식·도면 영향 없음)
  const showNote = !useMobileMode();
  
  const DAMAGE_PREVENTION_KEYWORDS = ['누수탐지', '원인공사', '원인철거', '원인(기타)'];
  const VICTIM_RECOVERY_ORDER = ['가설공사', '목공사', '수장공사', '도장공사', '전기공사', '타일공사', '가구공사', '욕실공사', '철거공사', '폐기물', '기타'];

  // 공종 정렬: 정해진 순서를 우선하고, 그 외는 뒤에 가나다순
  const sortByCanonicalOrder = (items: string[], canonical: string[]): string[] => {
    const inOrder = canonical.filter(c => items.includes(c));
    const extras = items.filter(c => !canonical.includes(c)).sort();
    return [...inOrder, ...extras];
  };

  const DAMAGE_PREVENTION_WORK_TYPES = useMemo(() => {
    if (laborCategories.length === 0) return DAMAGE_PREVENTION_KEYWORDS;
    const fromDB = laborCategories.filter(cat => DAMAGE_PREVENTION_KEYWORDS.includes(cat));
    if (fromDB.length === 0) return DAMAGE_PREVENTION_KEYWORDS;
    return sortByCanonicalOrder(fromDB, DAMAGE_PREVENTION_KEYWORDS);
  }, [laborCategories]);

  const VICTIM_RECOVERY_WORK_TYPES = useMemo(() => {
    if (laborCategories.length === 0) return VICTIM_RECOVERY_ORDER;
    const fromDB = laborCategories.filter(cat => !DAMAGE_PREVENTION_KEYWORDS.includes(cat));
    if (fromDB.length === 0) return VICTIM_RECOVERY_ORDER;
    return sortByCanonicalOrder(fromDB, VICTIM_RECOVERY_ORDER);
  }, [laborCategories]);
  
  // 복구면적 산출표와 연동되는 공종 목록 (피해복구에서 도장/목공/수장만 연동)
  const AREA_LINKED_WORK_TYPES = ['도장공사', '목공사', '수장공사'];
  
  // 복구면적 산출표 전용 공종 목록 (케이스 유형과 관계없이 항상 도장/목공/수장만)
  const AREA_CALCULATION_WORK_TYPES = ['도장공사', '목공사', '수장공사'];
  
  // 산출표 표기 전용 공사명 (노무비/자재비 연동 제외)
  const AREA_DISPLAY_ONLY_WORK_NAMES = ['수성페인트', '탄성코트', '무늬코트', '줄눈', '타일', 'SMC', '리빙보드', '도기류', '상부장', '상부장&하부장', '키큰장', '상부장&키큰장', '상부장&하부장&키큰장', '붙박이장'];
  
  // 노무비/자재비 연동 제외 공종 (공종 단위로 연동 차단)
  const AREA_DISPLAY_ONLY_WORK_TYPES = ['타일공사', '욕실공사'];

  const isItemInLinkSettings = (workType: string, workName: string): boolean => {
    return ilwidaegaLinkSettings.some(s => s.category === workType && s.workName === workName);
  };

  const getCeilingMultiplier = (workType: string, location: string): number => {
    if (workType === '욕실공사') return 1.0;
    if (location === '천장') {
      if (workType === '도장공사') return 1.2;
      return 1.3;
    }
    return 1.0;
  };

  const BATANG_COMPANION_MAP: Record<string, string> = {
    '수성페인트': '바탕만들기(수성페인트)',
    '무늬코트': '바탕만들기(무늬코트)',
    '탄성코트': '바탕만들기(탄성코트)',
  };
  const getCompanionWorkNames = (workType: string, workName: string): string[] => {
    if (workType !== '도장공사') return [];
    const companion = BATANG_COMPANION_MAP[workName];
    return companion ? [companion] : [];
  };
  const isCompanionSourceId = (sourceAreaRowId: string | undefined): boolean => {
    return !!sourceAreaRowId && sourceAreaRowId.includes('::batang');
  };
  const extractOriginalSourceId = (sourceAreaRowId: string): string => {
    return sourceAreaRowId.replace(/::batang$/, '');
  };
  
  const DEFAULT_WORK_TYPES_BY_LOCATION: Record<string, string[]> = {
    '천장': ['목공사', '수장공사', '도장공사', '욕실공사'],
    '벽면': ['목공사', '수장공사', '도장공사', '타일공사'],
    '바닥': ['수장공사', '가설공사', '타일공사', '욕실공사'],
  };
  
  const DEFAULT_WORK_NAMES_BY_LOCATION_AND_TYPE: Record<string, Record<string, string[]>> = {
    '천장': {
      '목공사': ['반자틀', '합판', '석고보드', '몰딩'],
      '수장공사': ['도배'],
      '도장공사': ['수성페인트', '탄성코트', '무늬코트'],
      '욕실공사': ['SMC', '리빙보드', '도기류'],
    },
    '벽면': {
      '목공사': ['합판', '석고보드', '걸레받이'],
      '수장공사': ['도배'],
      '도장공사': ['수성페인트', '탄성코트', '무늬코트'],
      '타일공사': ['줄눈', '타일'],
    },
    '바닥': {
      '수장공사': ['마루', '장판'],
      '가설공사': ['건축물보양'],
      '타일공사': ['줄눈', '타일'],
      '욕실공사': ['SMC', '리빙보드', '도기류'],
    },
  };

  const WORK_TYPES_BY_LOCATION = useMemo(() => {
    if (ilwidaegaLinkSettings.length === 0) return DEFAULT_WORK_TYPES_BY_LOCATION;
    const result: Record<string, string[]> = {};
    ilwidaegaLinkSettings.forEach(s => {
      if (!result[s.location]) result[s.location] = [];
      if (!result[s.location].includes(s.category)) {
        result[s.location].push(s.category);
      }
    });
    // 정해진 공종 순서(VICTIM_RECOVERY_ORDER) 적용
    Object.keys(result).forEach(loc => {
      result[loc] = sortByCanonicalOrder(result[loc], VICTIM_RECOVERY_ORDER);
    });
    return result;
  }, [ilwidaegaLinkSettings]);

  const WORK_NAMES_BY_LOCATION_AND_TYPE = useMemo(() => {
    if (ilwidaegaLinkSettings.length === 0) return DEFAULT_WORK_NAMES_BY_LOCATION_AND_TYPE;
    const result: Record<string, Record<string, string[]>> = {};
    ilwidaegaLinkSettings.forEach(s => {
      if (!result[s.location]) result[s.location] = {};
      if (!result[s.location][s.category]) result[s.location][s.category] = [];
      if (!result[s.location][s.category].includes(s.workName)) {
        result[s.location][s.category].push(s.workName);
      }
    });
    return result;
  }, [ilwidaegaLinkSettings]);
  
  const getWorkTypesByLocation = (location: string): string[] => {
    return WORK_TYPES_BY_LOCATION[location] || AREA_CALCULATION_WORK_TYPES;
  };
  
  const getWorkNamesByWorkType = (workType: string, location?: string): string[] => {
    if (location && WORK_NAMES_BY_LOCATION_AND_TYPE[location]?.[workType]) {
      return WORK_NAMES_BY_LOCATION_AND_TYPE[location][workType];
    }
    return workNamesByWorkType[workType] || [];
  };
  
  // 손해방지 vs 피해복구 케이스 판별
  // 접수번호에 -0이 붙으면 손해방지(원인세대), -1/-2 등이 붙으면 피해복구(피해세대)
  const isLossPreventionCase = useMemo(() => {
    const caseNumber = selectedCase?.caseNumber || '';
    // -0이 붙으면 손해방지
    return /-0$/.test(caseNumber);
  }, [selectedCase?.caseNumber]);

  // 손해방지 케이스일 때 "복구면적 산출표" 탭이 선택되어 있으면 "노무비"로 자동 변경
  useEffect(() => {
    if (isLossPreventionCase && selectedCategory === "복구면적 산출표") {
      setSelectedCategory("노무비");
    }
  }, [isLossPreventionCase, selectedCategory]);

  // 복구면적 변경 시 자재비 자동 동기화를 위한 signature
  // rows 배열 참조가 같아도 내부 필드(workName, repairArea) 변경을 감지
  const recoverySignature = useMemo(
    () => rows.map(r => `${r.id}|${r.workType}|${r.workName}|${r.repairArea}`).join(','),
    [rows]
  );

  // 복구면적 → 노무비/자재비 자동 동기화 적용 대상 케이스인지 판정
  // - cutoff 시각(KST) 이후 생성된 신규 접수건만 자동 동기화 대상
  // - 그 이전에 생성된 모든 기존 접수건은 자동 동기화가 트리거되지 않도록 false
  // - 케이스 데이터 미로드 / createdAtTimestamp 누락(기존 케이스) → 안전하게 false → legacy 처리
  // - cases.createdAtTimestamp는 "YYYY-MM-DDTHH:mm:ss+09:00" ISO 8601 문자열 (getKSTTimestamp 결과)
  //   동일 +09:00 오프셋이므로 사전 비교 = 시간 비교
  // - "복구면적 가져오기" 수동 버튼은 이 가드를 적용하지 않음(사용자 의도적 액션)
  const isAutoSyncEligibleCase = useMemo(() => {
    const createdAtTs = (estimateCase as any)?.createdAtTimestamp;
    if (!createdAtTs || typeof createdAtTs !== "string") return false;
    // 엄격한 포맷 검증: "YYYY-MM-DDTHH:mm:ss+09:00" (KST). 다른 시간대 오프셋이나 잘못된 포맷이면 false.
    // 동일 +09:00 오프셋끼리만 사전 비교가 시간 비교로 성립하기 때문.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(createdAtTs)) return false;
    return createdAtTs >= AUTO_SYNC_CUTOFF_KST;
  }, [(estimateCase as any)?.createdAtTimestamp]);

  // 복구면적 변경 → 자재비 자동 동기화 useEffect
  useEffect(() => {
    // [정책 변경 2026-05-04] 협력업체 화면에서도 자재비 자동 동기화 발동.
    // 노무비 철거 자동연동을 협력업체에 풀어준 것과 일관되게, 자재비도 노무비/복구면적
    // 변화에 맞춰 자동 동기화한다(사용자 요청). 자동저장 자체는 별도 가드(L6150)로
    // 여전히 차단되므로 화면 표시만 갱신되고 DB 반영은 협력업체가 명시 저장 시 일어난다.
    if (!currentUser) {
      console.log("[SYNC SKIP] No current user");
      return;
    }

    // Hydration 완료 전에는 동기화 건너뛰기
    if (!isHydratedRef.current) {
      console.log("[SYNC SKIP] Hydration not complete");
      return;
    }
    
    // 초기 로드 직후 자동 동기화 방지
    if (skipAutoSyncRef.current) {
      console.log("[SYNC SKIP] Initial load, skipping auto sync");
      skipAutoSyncRef.current = false;
      return;
    }
    
    // 손해방지 케이스면 자동 연동하지 않음
    if (isLossPreventionCase) {
      console.log("[SYNC SKIP] Loss prevention case");
      return;
    }

    // cutoff 이전에 생성된 기존 접수건은 자동 동기화 차단 (수동 버튼은 별개)
    if (!isAutoSyncEligibleCase) {
      console.log("[SYNC SKIP] Legacy case (created before auto-sync cutoff)", {
        cutoff: AUTO_SYNC_CUTOFF_KST,
        caseCreatedAt: (estimateCase as any)?.createdAt,
      });
      return;
    }
    
    // [정책 2026-05-12] source-guard — 사용자 명시 면적 편집(updateRow)에서만 자동 sync 발동.
    //   hydration/외부 polling/케이스 전환으로 들어온 recoverySignature 변화는 SKIP.
    //   (사용자 저장값을 진입만으로 덮어쓰지 않기 위함. 수동은 "복구면적 가져오기" 버튼 L8745.)
    if (!userEditedAreaRef.current && materialRows.length > 0) {
      console.log('[SYNC SKIP] recoverySignature 변화이지만 사용자 편집 없음 — 진입 자동 덮어쓰기 차단');
      return;
    }
    console.log("[SYNC CALL] syncMaterialFromRecoveryArea triggered", {
      time: Date.now(),
      userEdited: userEditedAreaRef.current,
      materialRowsCount: materialRows.length,
    });
    
    syncMaterialFromRecoveryArea();
    triggerAutoSaveAfterSync("material:recoverySignature");
  }, [recoverySignature, isLossPreventionCase, isReadOnly, isAutoSyncEligibleCase, isPartner, currentUser]);

  useEffect(() => {
    if (selectedCategory !== "자재비") return;
    // [정책 2026-05-12] 화면 진입 자동 덮어쓰기 차단 — 사용자 저장값을 진입만으로 변경하지 않는다.
    //   1) 기존 자재비 행이 하나라도 있으면 자동 sync/autosave 모두 SKIP
    //   2) 진짜 빈 상태(초기 진입)일 때만 자동 카운트 기반 연동 1회 수행
    //   3) 이후 갱신은 사용자가 "복구면적 가져오기" 버튼(L8745)으로 명시 실행
    if (!currentUser) return;
    if (!isHydratedRef.current) return;
    if (isLossPreventionCase) return;
    if (!isAutoSyncEligibleCase) return;
    if (materialRows.length > 0) {
      // [버그수정 2026-06-16] 복구면적 편집 중 중간합으로 생성·lock된 연동행(예: 건축물보양/보양재)이
      //   자재비 탭 첫 진입 시 stale 수량으로 보이던 문제. 신규 케이스에서는 자재비 탭을 열기 전
      //   복구면적 편집(recoverySignature sync)이 먼저 연동행을 만들어 lock시키므로, on-load 1회 재계산
      //   (materialAutoSyncOnLoadRef, L2946)은 "이미 연동행이 존재"하는 케이스 재진입에만 적용되어
      //   이 흐름을 못 잡았다. 자재비 탭 진입 시 연동/자동행이 있으면 forceUnlock으로 현재 복구면적 기준
      //   1회 재계산하여 표시를 정정한다. 카탈로그/복구면적 미로드 시엔 건너뛰어 중복행·0합을 방지.
      //   forceUnlock은 lockedAtSave만 우회하고 사용자 수정행(isOverridden/isItemOverridden)·수동행은
      //   그대로 보존하며, 자동저장은 하지 않는다(진입만으로 옛 저장본을 덮어쓰지 않음). 산식 불변.
      if (
        materialByWorknameCatalog.length > 0 &&
        rows.length > 0 &&
        materialRows.some(r => r.isLinkedFromRecovery || r.isAutoGenerated)
      ) {
        console.log("[자재비 탭 진입] 연동행 수량을 복구면적 기준으로 1회 재계산(forceUnlock, 저장 안 함)");
        syncMaterialFromRecoveryArea(true);
      } else {
        console.log("[자동연동 SKIP] 자재비 탭 진입: 기존 행 존재(연동행 없음/미로드) — 수동 버튼 사용");
      }
      return;
    }
    syncMaterialFromRecoveryArea();
    // 자재비 탭 진입 시 싱크 결과를 DB에 자동 저장
    triggerAutoSaveAfterSync("material:tabEnter");
  }, [selectedCategory, isAutoSyncEligibleCase, isPartner, currentUser, materialByWorknameCatalog, rows.length]);

  // 노무비 탭 진입 시 복구면적 자동 동기화 (협력업체도 동일한 화면값을 보도록 readOnly 가드 제거)
  useEffect(() => {
    if (selectedCategory !== "노무비") return;
    // [Bug 2 fix 2026-05-06] 협력업체 최초 작성 중에도 노무비 자동연동 발동.
    //   기존엔 isPartner이면 무조건 SKIP했으나, 사용자 요구는 "협력업체에서 입력·수정한
    //   값이 자동으로 관리자 화면에 반영"이므로 가드를 완화. 자동저장 정책은
    //   `latestAutoSaveDepsRef.current.isPartnerSession`(L6433)에서 `isPartner && isReadOnly`로
    //   분기 — 협력사 작성 중(미제출)은 자동저장 허용, 제출 후엔 차단(원본 보존).
    //   관리자 직접 추가행(isLinkedFromRecovery=false)은 syncLaborFromRecoveryArea의
    //   independentRows 분기(L1277)로 보존하므로 안전.
    if (!currentUser) {
      console.log("[자동연동 SKIP] 노무비 탭 진입: 사용자 미로드");
      return;
    }
    if (!isHydratedRef.current) return;
    // 손해방지(원인세대) 케이스는 복구면적 산출표를 사용하지 않으므로 자동 동기화 차단
    if (isLossPreventionCase) return;
    if (rows.length === 0) return;
    // 카탈로그가 아직 로드되지 않았으면 건너뛰기 (다음 변화 시 재실행)
    if (mergedIlwidaegaCatalog.length === 0) return;
    // cutoff 이전에 생성된 기존 접수건은 자동 동기화 차단 (수동 버튼은 별개)
    if (!isAutoSyncEligibleCase) {
      console.log("[자동연동 SKIP] 노무비 탭 진입: 기존 케이스(cutoff 이전 생성)", {
        cutoff: AUTO_SYNC_CUTOFF_KST,
        caseCreatedAt: (estimateCase as any)?.createdAt,
      });
      return;
    }
    // [정책 2026-05-12] 화면 진입 자동 덮어쓰기 차단.
    //   기존 노무비 행이 있으면 자동 sync 발동 금지 — "복구면적 가져오기"(L8745) 수동 버튼으로만 갱신.
    if (laborCostRows.length > 0) {
      console.log('[자동연동 SKIP] 노무비 탭 진입: 기존 행 존재 — 수동 버튼 사용');
      return;
    }
    console.log("[자동연동] 노무비 탭 진입(초기) → syncLaborFromRecoveryArea 호출");
    syncLaborFromRecoveryArea();
    triggerAutoSaveAfterSync("labor:tabEnter");
  }, [selectedCategory, mergedIlwidaegaCatalog.length, rows.length, isAutoSyncEligibleCase, isPartner, currentUser, laborCostRows.length]);

  // [복구면적 변경 → 노무비 자동 반영] 협력업체 포함, 모든 사용자 대상.
  // - 기존 "노무비 탭 진입 sync"는 협력업체 SKIP되고, 저장된 행은 lockedAtSave로 잠겨
  //   협력업체가 면적을 수정해도 노무비에 반영되지 않는 회귀가 있었다.
  // - 본 effect는 산식을 변경하지 않고(calculate*WithTiers 그대로 사용) 면적이 바뀐
  //   복구면적 행에 매핑된 노무비 행만 좁게 재계산한다.
  //   · 매핑은 sourceAreaRowId(`demolition-`/`::batang` 접두/접미 포함)로 식별
  //   · FIXED 일위대가(가구/욕실 SMC 등)는 위치별 고정 인분 유지 — 면적/금액만 갱신
  //   · 잠금(lockedAtSave)은 본 분기에 한해 무효화(사용자 명시 면적 수정 = 의도적 갱신)
  // - 다른 자동 sync 분기(탭 진입/manual button/reconcile)는 변경 없음.
  const prevRepairAreasRef = useRef<Map<string, number>>(new Map());
  const userEditedAreaRef = useRef<boolean>(false);
  useEffect(() => {
    if (!currentUser) return;
    if (!isHydratedRef.current) return;
    if (isLossPreventionCase) return;
    if (!isAutoSyncEligibleCase) return;

    // 현재 면적 스냅샷
    const currentMap = new Map<string, number>();
    rows.forEach(r => currentMap.set(r.id, parseFloat(r.repairArea) || 0));

    // 첫 실행: 베이스라인만 기록하고 종료 (초기 hydration 직후 spurious 트리거 방지)
    if (prevRepairAreasRef.current.size === 0) {
      prevRepairAreasRef.current = currentMap;
      return;
    }

    // [source-guard] 사용자 명시 편집(updateRow)에서 set된 플래그가 없으면
    // hydration/polling/외부 동기화로 들어온 변화 → lock 해제하지 않고 베이스라인만 갱신.
    // (관리자 저장 스냅샷 보존 의도와 충돌 회피)
    // [Bug 3 fix 2026-05-06] 협력업체 "작성 중"에만 source-guard 면제.
    //   협력업체 화면에서 면적이 바뀌는 경로(updateRow + 복구면적 가져오기 버튼)는
    //   모두 의도적 편집이며, 관리자 화면에 자동 반영되어야 한다는 사용자 요구사항.
    //   단, 제출 후(isReadOnly=true)에는 가드 재활성화 → rehydrate/외부변경에 의한
    //   불필요한 재계산/lockedAtSave 해제 차단(원본보존).
    //   관리자(isPartner=false)는 기존대로 명시 편집만 trigger.
    if (!userEditedAreaRef.current && !(isPartner && !isReadOnly)) {
      prevRepairAreasRef.current = currentMap;
      return;
    }

    // 면적이 실제로 바뀐 area row id 집합
    const changedAreaIds = new Set<string>();
    currentMap.forEach((area, id) => {
      const prev = prevRepairAreasRef.current.get(id);
      if (prev !== undefined && prev !== area) changedAreaIds.add(id);
    });
    prevRepairAreasRef.current = currentMap;
    // 사용자 편집 플래그는 1회 소비
    userEditedAreaRef.current = false;
    if (changedAreaIds.size === 0) return;

    console.log("[복구면적→노무비 자동반영] 변경 감지", {
      changedCount: changedAreaIds.size,
      isPartner,
    });

    setLaborCostRows(prevLabor => {
      let mutated = false;
      const next = prevLabor.map(laborRow => {
        if (!laborRow.isLinkedFromRecovery || !laborRow.sourceAreaRowId) return laborRow;

        // 매핑된 원본 area row id 추출 (demolition-/::batang 처리)
        let origId = laborRow.sourceAreaRowId;
        const isDemolition = origId.startsWith('demolition-');
        if (isDemolition) origId = origId.replace('demolition-', '');
        if (isCompanionSourceId(origId)) origId = extractOriginalSourceId(origId);

        if (!changedAreaIds.has(origId)) return laborRow;

        const areaRow = rows.find(r => r.id === origId);
        if (!areaRow) return laborRow;

        const rawArea = parseFloat(areaRow.repairArea) || 0;

        // FIXED 일위대가 (가구공사/욕실공사 SMC/리빙보드/도기류/붙박이장/상부장 시리즈)
        // 위치별 고정 수량(내장공 1.0, 보통인부 0.5) 유지. 면적/금액만 갱신.
        // 단, 철거 동반행(`demolition-*`)은 FIXED 인분 분기를 타지 않고 일반 분기에서
        // 카탈로그 D/E + calculate*WithTiers로 재계산 (기존 reconcile L3503 의미와 일치).
        const isFixedLaborItem =
          !isDemolition &&
          laborRow.category !== '철거공사' &&
          isFixedIlwidaegaWorkName(areaRow.workName || '') &&
          (areaRow.workType === '가구공사' || areaRow.workType === '욕실공사');
        if (isFixedLaborItem) {
          const singleArea = Math.round(rawArea * 10) / 10;
          const isHelper = normalizeForMatch(laborRow.detailItem || '') === normalizeForMatch('보통인부');
          const fixedQty = isHelper ? 0.5 : 1.0;
          const E = laborRow.standardPrice || 0;
          const newAmount = Math.round(E * fixedQty);
          if (
            laborRow.damageArea === singleArea &&
            laborRow.quantity === fixedQty &&
            laborRow.amount === newAmount
          ) return laborRow;
          mutated = true;
          // [핑퐁 차단 2026-05-11] lockedAtSave를 풀지 않음.
          //   값 자체는 산식대로 재계산해서 정확히 갱신했으므로, lock을 풀어 다른 sync가
          //   끼어들 윈도우(1.5초 자동저장 디바운스 동안)를 만들 필요가 없다.
          //   자동저장 onSuccess(L6307)가 어차피 다시 lockedAtSave=true로 박는다.
          return {
            ...laborRow,
            damageArea: singleArea,
            quantity: fixedQty,
            amount: newAmount,
            pricePerSqm: E,
          };
        }

        // 일반/철거 행: 천장 할증 적용된 면적으로 산식 재적용
        const ceilingMult = getCeilingMultiplier(areaRow.workType || '', areaRow.location || '');
        const C = Math.round(rawArea * ceilingMult * 10) / 10;
        const D = laborRow.standardWorkQuantity || 0;
        const E = laborRow.standardPrice || 0;

        let newQuantity = laborRow.quantity;
        let newAmount = laborRow.amount;
        let newPricePerSqm = laborRow.pricePerSqm;

        if (C > 0 && D > 0 && E > 0) {
          newAmount = calculateIWithTiers(C, D, E, laborRateTiers);
          newPricePerSqm = calculateAppliedUnitPriceWithTiers(C, D, E, laborRateTiers);
          newQuantity = calculateQuantityWithTiers(C, D, E, laborRateTiers);
        } else if (C <= 0) {
          // [면적0 보정] 산출표 면적이 0으로 변경되면 수량/금액/단가 0으로 명시 override
          newAmount = 0;
          newQuantity = 0;
          newPricePerSqm = 0;
        }

        if (
          laborRow.damageArea === C &&
          laborRow.quantity === newQuantity &&
          laborRow.amount === newAmount &&
          laborRow.pricePerSqm === newPricePerSqm
        ) return laborRow;

        mutated = true;
        // [핑퐁 차단 2026-05-11] lockedAtSave를 풀지 않음 (FIXED 분기와 동일 정책).
        //   - 산식 결과로 면적/금액/수량/단가는 정확히 갱신됨.
        //   - lock을 풀면 reconcile/demolitionReconcile/addNewRows useEffect가
        //     1.5초 자동저장 디바운스 사이에 끼어들어 같은 행을 다시 손댈 수 있음.
        //   - 자동저장 onSuccess(L6307)가 다시 lockedAtSave=true로 박으므로 lock 유지가 안전.
        return {
          ...laborRow,
          damageArea: C,
          quantity: newQuantity,
          amount: newAmount,
          pricePerSqm: newPricePerSqm,
        };
      });

      if (!mutated) return prevLabor;
      lastLaborSetSourceRef.current = 'recoveryAreaChange';
      return next;
    });

    // 갱신된 노무비를 DB에 자동 저장 (관리자/협력업체 모두 화면값과 저장본 일치)
    triggerAutoSaveAfterSync("labor:recoveryAreaChange");
  }, [recoverySignature, isLossPreventionCase, isAutoSyncEligibleCase, currentUser, isPartner]);

  const materialCatalogLoadedRef = useRef(false);
  // [버그수정 2026-06-16] 복구면적 연동 자재행 수량이 초기 로딩 시 stale 표시 문제.
  //   기존엔 수동 "복구면적 가져오기" 버튼을 눌러야만 현재 복구면적 기준으로 재계산됐다
  //   (저장 시 lockedAtSave=true로 잠겨, 진입 자동 sync가 가드(L2702/2729)에 막힘).
  //   → 하이드레이션 완료 후 1회, 연동행 수량을 복구면적 기준으로 자동 재계산한다.
  //   - syncMaterialFromRecoveryArea(true)는 lockedAtSave만 우회하며, 사용자 수정행
  //     (isOverridden/isItemOverridden)과 수동행(isAutoGenerated/isLinkedFromRecovery=false)은
  //     그대로 보존하므로 안전. 산식(수량·합계 공식)은 변경하지 않음.
  //   - 화면 표시 정정만 수행하고 자동저장은 하지 않는다(옛 저장본을 진입만으로 덮어쓰지 않음).
  //     사용자가 이후 명시 저장 시 올바른 값이 영속된다.
  const materialAutoSyncOnLoadRef = useRef(false);
  useEffect(() => {
    if (!currentUser || isPartner) return;       // 협력업체는 관리자 저장본 그대로 표시
    if (!isHydratedRef.current) return;
    if (isLossPreventionCase) return;            // 손방(원인세대)은 복구면적 산출표 미사용
    if (rows.length === 0) return;               // 복구면적 아직 미로드 → stale 0 계산 방지
    if (materialByWorknameCatalog.length === 0) return; // 단가 정확성 위해 카탈로그 대기
    if (materialAutoSyncOnLoadRef.current) return;
    // 연동/자동 자재행이 하나도 없으면(사용자가 자재비 미설정) 진입만으로 새 행을 만들지 않는다.
    if (!materialRows.some(r => r.isLinkedFromRecovery || r.isAutoGenerated)) return;
    materialAutoSyncOnLoadRef.current = true;
    console.log('[자재비 초기로딩] 연동행 수량을 복구면적 기준으로 1회 자동 재계산(forceUnlock, 저장 안 함)');
    syncMaterialFromRecoveryArea(true);
  }, [isHydratedState, materialByWorknameCatalog, rows.length, isLossPreventionCase, currentUser, isPartner]);

  useEffect(() => {
    // [원본보존] 협력업체는 관리자가 저장한 자재비 단위를 그대로 봐야 함
    if (!currentUser || isPartner) return;
    if (!isHydratedRef.current) return;
    if (materialByWorknameCatalog.length === 0) return;
    if (materialCatalogLoadedRef.current) return;
    materialCatalogLoadedRef.current = true;

    const PAINTING_WORK_NAMES = ['수성페인트', '무늬코트', '탄성코트'];
    const FIXED_ILWIDAEGA_WORK_NAMES = ['SMC', '리빙보드', '도기류', '붙박이장', '상부장', '하부장', '상부장&하부장', '키큰장', '상부장&키큰장', '상부장&하부장&키큰장'];

    setMaterialRows(prev => {
      let changed = false;
      const updated = prev.map(row => {
        const isPaint = row.autoKey?.includes('__PAINT__');
        const isFixed = row.autoKey?.includes('__FIXED__');
        if (!isPaint && !isFixed) return row;

        const workName = row.공사명 || '';
        const category = row.공종 || '';
        const match = materialByWorknameCatalog.find(
          item => normalizeForMatch(item.공종 || '') === normalizeForMatch(category) &&
                  normalizeForMatch(item.공사명 || '') === normalizeForMatch(workName)
        ) || materialByWorknameCatalog.find(
          item => normalizeForMatch(item.공사명 || '') === normalizeForMatch(workName)
        );
        if (match && match.단위 && match.단위 !== row.단위) {
          changed = true;
          return { ...row, 단위: match.단위 };
        }
        return row;
      });
      return changed ? updated : prev;
    });
  }, [isHydratedState, materialByWorknameCatalog, currentUser, isPartner]);
  
  // 공종 목록 (노무비 DB에서 가져온 후 케이스 유형별 필터링)
  // 손해방지 케이스: DAMAGE_PREVENTION_WORK_TYPES만 표시
  // 피해복구 케이스: VICTIM_RECOVERY_WORK_TYPES만 표시
  const workTypes = useMemo(() => {
    // 케이스 유형에 따른 허용 공종 목록
    const allowedWorkTypes = isLossPreventionCase 
      ? DAMAGE_PREVENTION_WORK_TYPES 
      : VICTIM_RECOVERY_WORK_TYPES;
    
    // 노무비 카탈로그에서 공종 목록 가져오기 (허용된 공종만 필터링 + 정해진 순서 적용)
    if (laborCategories.length > 0) {
      const filtered = laborCategories.filter(cat => allowedWorkTypes.includes(cat));
      if (filtered.length === 0) return allowedWorkTypes;
      const canonical = isLossPreventionCase ? DAMAGE_PREVENTION_KEYWORDS : VICTIM_RECOVERY_ORDER;
      return sortByCanonicalOrder(filtered, canonical);
    }
    
    // 카탈로그가 없으면 케이스 유형에 따른 기본값 사용
    return allowedWorkTypes;
  }, [laborCategories, isLossPreventionCase]);

  // 노무비 행 변화 감지 및 자재비 행 동기화 (공종, 공사명 그대로 복사)
  // 피해복구 케이스에서만 작동 (손해방지 케이스 제외)
  // 주의: 새 행 생성은 skipAutoSyncRef.current가 false일 때만 실행
  useEffect(() => {
    // [정책 변경 2026-05-04] 협력업체 화면에서도 노무비→자재비 자동 동기화 발동.
    // 노무비에 추가/변경된 행에 맞춰 자재비도 동일한 공종/공사명으로 자동 생성된다(사용자 요청).
    // 자동저장은 별도 가드(L6150)로 여전히 차단되므로 DB 반영은 명시 저장 시 함께 들어간다.
    if (!currentUser) return;

    // Hydration 완료 전에는 동기화 건너뛰기 (중복 행 방지)
    if (!isHydratedRef.current) {
      return;
    }
    
    // 손해방지 케이스면 자동 연동하지 않음
    if (isLossPreventionCase) {
      return;
    }
    
    // 자재비 연동 제외 대상 확인 함수
    // 1. 복구면적 연동 행(isLinkedFromRecovery)만 자재비에 연동됨 (별도 경로)
    // 2. 노무비에서 수동 추가한 행은 자재비에 연동하지 않음
    // 3. 목공사-반자틀, 철거공사는 자재비 연동 제외
    // 4. 자동 연동 대상 공사명(합판, 석고보드, 도배 등)은 syncMaterialFromRecoveryArea에서 처리하므로 제외
    // syncMaterialFromRecoveryArea가 처리하는 모든 공사명 (이중 생성 방지)
    // 가구공사/욕실공사 FIXED 항목 포함 — 노무비→자재비 useEffect는 이들을 제외
    const AUTO_MATERIAL_SYNC_WORK_NAMES = [
      '합판', '석고', '석고보드', '몰딩', '걸레받이', '도배', '마루', '장판', '건축물현장정리', '건축물보양',
      '수성페인트', '무늬코트', '탄성코트',
      'SMC', '리빙보드', '도기류', '붙박이장',
      '상부장', '하부장', '상부장&하부장', '키큰장', '상부장&키큰장', '상부장&하부장&키큰장',
    ];
    const shouldExcludeFromMaterialSync = (category: string, workName: string, isLinkedFromRecovery?: boolean): boolean => {
      if (!isLinkedFromRecovery) return true;
      // 반자틀은 공종(category)과 무관하게 자재비 자동연동 제외 (복구면적→자재비 sync line 1808과 동일 규칙).
      //   복구면적에서 공종 미선택 등으로 category가 ''/'목공사'가 아닌 채 들어온 반자틀 행이
      //   기존 (category === '목공사') 조건을 빠져나가 빈 반자틀 자재행이 삭제 후에도 재생성되던 문제 해결.
      if (workName === '반자틀' || category === '철거공사') return true;
      if (category === '가설공사' && workName !== '건축물현장정리' && workName !== '건축물보양') return true;
      if ((workName || '').startsWith('바탕만들기')) return true;
      if (AUTO_MATERIAL_SYNC_WORK_NAMES.includes(workName) || isItemInLinkSettings(category, workName)) {
        console.log('[노무비→자재비 useEffect] 자동연동 대상 제외:', category, workName);
        return true;
      }
      return false;
    };

    setMaterialRows(prev => {
      // 1. 먼저 제외 대상 자재비 행 제거 (바탕만들기, 목공사-반자틀 등)
      const filteredRows = prev.filter(matRow => {
        // 자재비 행의 공사명이 바탕만들기면 직접 제거 (모든 경로)
        if ((matRow.공사명 || '').startsWith('바탕만들기')) return false;
        
        // 복구면적 연동 자재비 행은 유지 (별도 경로로 관리)
        if (matRow.isLinkedFromRecovery) return true;
        if (!matRow.sourceLaborRowId) return true;
        
        const linkedLaborRow = laborCostRows.find(lr => lr.id === matRow.sourceLaborRowId);
        if (!linkedLaborRow) return true;
        
        // 연결된 노무비 행이 제외 대상이면 자재비 행 제거
        return !shouldExcludeFromMaterialSync(linkedLaborRow.category || '', linkedLaborRow.workName || '', linkedLaborRow.isLinkedFromRecovery);
      });
      
      // 초기 로드 직후에는 새 행 생성을 건너뜀 (기존 데이터 유지)
      // skipAutoSyncRef는 hydration 완료 후에만 false가 됨
      if (skipAutoSyncRef.current) {
        return filteredRows;
      }
      
      // 이미 연결된 노무비 행 ID 목록
      const existingSourceIds = new Set(filteredRows.map(row => row.sourceLaborRowId).filter(Boolean));
      
      // 자재비 행이 없는 노무비 행 찾기 (목공사-반자틀 제외, 복구면적 연동 행 제외)
      const laborRowsNeedingMaterial = laborCostRows.filter(laborRow => 
        laborRow.id && 
        !existingSourceIds.has(laborRow.id) &&
        !shouldExcludeFromMaterialSync(laborRow.category || '', laborRow.workName || '', laborRow.isLinkedFromRecovery)
      );
      
      // 기존 행 업데이트 + 새 행 추가 (한 번에 처리)
      const updatedRows = filteredRows.map((matRow) => {
        // sourceLaborRowId가 있으면 해당 노무비 행과 동기화
        if (matRow.sourceLaborRowId) {
          const linkedLaborRow = laborCostRows.find(lr => lr.id === matRow.sourceLaborRowId);
          if (linkedLaborRow) {
            const needsCategoryUpdate = linkedLaborRow.category !== matRow.공종;
            const needsWorkNameUpdate = linkedLaborRow.workName !== matRow.공사명;
            
            if (needsCategoryUpdate || needsWorkNameUpdate) {
              // 공종, 공사명 그대로 복사
              return { 
                ...matRow, 
                공종: linkedLaborRow.category || '',
                공사명: linkedLaborRow.workName || ''
              };
            }
            // linked 행 정상 매칭 + 변경 없음 → 그대로 반환 (자동 플래그/autoKey 보존)
            return matRow;
          }
          // [orphan 강등 — Task #9] linked 노무비 행이 사라진 진짜 orphan에만 한정.
          // (사용자가 노무비 행 삭제 후 자재비 잔존 등) 사용자 수동행으로 강등하여
          // reconcile/자동 동기화에서 stale로 판단되어 삭제되는 위험을 차단한다.
          // hydration orphan 보호 패턴(L4279~4289)과 동일: 자동 플래그만 끄고 sourceLaborRowId는 보존.
          // 이미 강등된 행은 그대로 반환되어 loop 없음 (idempotent).
          if (matRow.isAutoGenerated || matRow.isLinkedFromRecovery || matRow.autoKey) {
            console.log('[노무비→자재비] orphan 자재행 강등(수동행화):', matRow.공종, matRow.공사명, matRow.자재항목);
            return { ...matRow, isAutoGenerated: false, isLinkedFromRecovery: false, autoKey: undefined };
          }
          return matRow;
        }
        
        // [인덱스 fallback 차단 — Task #9]
        // 이전엔 sourceLaborRowId가 없는 자재비 행을 같은 인덱스의 노무비 행과 동기화했으나,
        // 사용자가 노무비 중간 행을 삭제하면 인덱스가 밀려 엉뚱한 자재비의 공종/공사명이
        // 사용자 모르게 변경되는 위험 ⑨이 발생한다. 또 사용자 수동 자재비 행
        // (createBlankMaterialRow를 sourceLaborRowId 없이 호출, L776/L2186/L4522/L5003)도
        // 영향 받아 위험 ②가 우회될 수 있다.
        // → sourceLaborRowId 없는 자재비 행은 자동 동기화 대상에서 제외.
        // 노무비→자재비 신규 연결은 아래 newRows 단계에서 sourceLaborRowId를 부여한 채 추가된다.
        return matRow;
      });
      
      // 새로운 자재비 행 추가 (공종, 공사명 그대로 복사)
      const newRows = laborRowsNeedingMaterial.map(laborRow => {
        return createBlankMaterialRow(laborRow.category || '', laborRow.workName || '', laborRow.id);
      });
      
      return [...updatedRows, ...newRows];
    });
  }, [laborCostRows, isLossPreventionCase, isPartner, currentUser]);

  // 복구면적 산출표 → 노무비 자동 연동 (피해복구 케이스에서만)
  // 일위대가DB에서 공종+공사명으로 조회하여 ALL matching 노임항목 행을 자동 생성
  // 복구면적 → 피해면적 추가 복사
  useEffect(() => {
    // [원본보존] 협력업체에서는 복구면적→노무비 자동 연동 차단
    // (관리자 저장본을 그대로 표시. setLaborCostRows 변형 금지.)
    if (!currentUser || isPartner) return;

    if (!isHydratedRef.current) {
      return;
    }

    if (syncGuardRef.current) {
      console.log('[자동동기화] syncGuard 활성 — 건너뛰기');
      return;
    }

    // [정책 2026-05-12] 화면 진입 자동 덮어쓰기 차단 (관리자/협력사 비대칭 해소).
    //   이미 노무비에 연동행이 있고 사용자가 면적을 직접 수정한 흔적이 없으면 SKIP.
    //   진입 시 자동 산식 재계산으로 사용자 수정값(철거공사 수량 등)이 회귀하는 경로를 차단.
    const hasLinkedLabor = laborCostRows.some(r => r.isLinkedFromRecovery);
    if (hasLinkedLabor && !userEditedAreaRef.current) {
      console.log('[자동동기화 SKIP] 복구면적→노무비: 연동행 존재 + 사용자 면적 편집 없음 — 수동 버튼 사용');
      return;
    }

    if (!mergedIlwidaegaCatalog || mergedIlwidaegaCatalog.length === 0) {
      return;
    }

    // cutoff 이전에 생성된 기존 접수건은 자동 동기화 차단 (수동 버튼은 별개)
    if (!isAutoSyncEligibleCase) {
      console.log('[자동동기화 SKIP] rows→노무비 자동 연동: 기존 케이스(cutoff 이전 생성)', {
        cutoff: AUTO_SYNC_CUTOFF_KST,
        caseCreatedAt: (estimateCase as any)?.createdAt,
      });
      return;
    }

    // 이미 연동된 복구면적 산출표 행 ID 목록 (demolition- 접두사, ::batang 접미사 제거하여 원본 ID 추출)
    const existingSourceAreaIds = new Set(
      laborCostRows.map(row => {
        let sourceId = row.sourceAreaRowId;
        if (!sourceId) return null;
        if (sourceId.startsWith('demolition-')) sourceId = sourceId.replace('demolition-', '');
        if (sourceId.includes('::batang')) sourceId = extractOriginalSourceId(sourceId);
        return sourceId;
      }).filter(Boolean)
    );

    // [수동행 가드 정밀화 — Task #8]
    // 이전 manualKeySetForAutoSync 글로벌 키 차단은 제거됨.
    // 사유: 같은 영역행 중복은 existingSourceAreaIds / existingFixedFurnitureBathSourceIds로,
    //       같은 workName 중복(다른 영역행)은 existingLinkedWorkNames로 이미 차단되어 있어
    //       글로벌 (공종|공사명|노임항목) 키 차단은 사용자가 자동행을 모두 삭제하고
    //       수동행으로 운영 중인 경우, 새 영역행이 추가되어도 자동행 생성을 막아 견적 누락을 일으킨다.
    //       사용자 요청: "수동행도 기존 자동연동 로직에 충돌 및 중복이 안 된다면 자동연동에 추가".
    // Task #7의 deletion 가드(deletedLinkedLaborKeys)는 filteredNewLaborRows에서 유지된다.

    // 가구/욕실 FIXED 본체(내장공) 행 전용 sync set — 철거공사/바탕만들기 동반행은 제외
    const existingFixedFurnitureBathSourceIds = new Set(
      laborCostRows
        .filter(row =>
          (row.category === '가구공사' || row.category === '욕실공사') &&
          isFixedIlwidaegaWorkName(row.workName || '') &&
          row.sourceAreaRowId &&
          !row.sourceAreaRowId.startsWith('demolition-') &&
          !row.sourceAreaRowId.includes('::batang'))
        .map(r => r.sourceAreaRowId!)
    );
    
    // 철거공사 alias 역매핑 (예: '석고' → ['석고','석고보드'])
    const reverseDemolitionAliases: Record<string, string[]> = {};
    Object.entries(DEMOLITION_WORKNAME_ALIASES).forEach(([from, to]) => {
      if (!reverseDemolitionAliases[to]) reverseDemolitionAliases[to] = [to];
      reverseDemolitionAliases[to].push(from);
    });
    const existingLinkedWorkNames = new Set<string>();
    laborCostRows
      .filter(row => row.isLinkedFromRecovery && row.workName)
      .forEach(row => {
        const wn = row.workName || '';
        existingLinkedWorkNames.add(normalizeForMatch(wn));
        // alias가 있는 경우 양방향 추가 (예: 노무비 '석고' → 영역 '석고보드'도 매칭)
        const aliases = reverseDemolitionAliases[wn] || [];
        aliases.forEach(a => existingLinkedWorkNames.add(normalizeForMatch(a)));
        // forward alias (예: 노무비 '석고보드' → '석고'도 매칭)
        const fwd = DEMOLITION_WORKNAME_ALIASES[wn];
        if (fwd) existingLinkedWorkNames.add(normalizeForMatch(fwd));
      });

    // 완성된 복구면적 산출표 행 찾기 (공종, 공사명 필수 입력)
    const completedAreaRows = rows.filter(row => {
      const hasRequiredFields = 
        row.workType && row.workType !== '' &&
        row.workName && row.workName !== '선택' && row.workName !== '';
      
      // FIXED 일위대가 항목(욕실공사 SMC/리빙보드/도기류/붙박이장, 가구공사 상부장 시리즈)은
      // AREA_DISPLAY_ONLY 공종이라도 노무비 행을 자동 생성 (위치별 합산은 mergeDemolitionRows에서 처리)
      const isFixedItem = isFixedIlwidaegaWorkName(row.workName || '');
      if (!isFixedItem) {
        if (AREA_DISPLAY_ONLY_WORK_TYPES.includes(row.workType || '') && !isItemInLinkSettings(row.workType || '', row.workName || '')) return false;
        if (AREA_DISPLAY_ONLY_WORK_NAMES.includes(row.workName || '') && !isItemInLinkSettings(row.workType || '', row.workName || '')) return false;
      }
      
      // FIXED 가구/욕실: 위치별로 행 생성 (같은 source area row id 단위로 1행)
      // 철거공사 동반행이 이미 있어도 본체 노무비행이 없으면 만들어야 하므로 별도 set 사용
      const notYetSynced = isFixedItem
        ? !existingFixedFurnitureBathSourceIds.has(row.id)
        : (!existingSourceAreaIds.has(row.id) &&
           !existingLinkedWorkNames.has(normalizeForMatch(row.workName || '')));
      
      return hasRequiredFields && notYetSynced;
    });

    // [진단2]
    {
      const fbAll = rows.filter(r => (r.workType === '가구공사' || r.workType === '욕실공사') && isFixedIlwidaegaWorkName(r.workName || ''));
      console.log('[진단2-A] 가구/욕실 FIXED 영역행:', fbAll.map(r => `${r.workName}/${r.location}/id=${r.id?.slice(-8)}/inExist=${existingSourceAreaIds.has(r.id)}/inFB=${existingFixedFurnitureBathSourceIds.has(r.id)}`));
      const fbCompleted = completedAreaRows.filter(r => (r.workType === '가구공사' || r.workType === '욕실공사') && isFixedIlwidaegaWorkName(r.workName || ''));
      console.log('[진단2-B] completedAreaRows 中 가구/욕실 FIXED', fbCompleted.length, '개:', fbCompleted.map(r => `${r.workName}/${r.location}/id=${r.id?.slice(-8)}`));
      console.log('[진단2-C] existingFixedFurnitureBathSourceIds:', Array.from(existingFixedFurnitureBathSourceIds).map(id => (id as string).slice(-8)));
    }

    console.log('[진단D-1] demolitionOnlyAreaRows 계산 직전');
    // AREA_DISPLAY_ONLY로 제외된 항목 중 철거공사가 필요한 항목 (가구공사/욕실공사 FIXED 항목)
    const demolitionOnlyAreaRows = rows.filter(row => {
      const hasRequiredFields = 
        row.workType && row.workType !== '' &&
        row.workName && row.workName !== '선택' && row.workName !== '';
      if (!hasRequiredFields) return false;
      if (!needsDemolitionRow(row.workType || '', row.workName || '')) return false;
      // completedAreaRows에 이미 포함되어 있으면 제외
      if (completedAreaRows.find(r => r.id === row.id)) return false;
      // 이미 철거공사 행이 생성되어 있으면 제외
      const demolitionSourceId = `demolition-${row.id}`;
      if (laborCostRows.find(r => r.sourceAreaRowId === demolitionSourceId)) return false;
      return true;
    });

    // [공종 꼬임 방지] 산출표가 변경되어 더 이상 유효하지 않은 stale 철거 행 자동 제거
    // 예: 화장실(욕실공사 SMC) → 침실(목공사 석고보드) 변경 후 SMC 철거공사 행 잔존 케이스.
    // alreadySyncedDemolitionRefreshes는 빈 행만 갱신 → FIXED 항목(SMC 등)은 정리 못함 → 별도 정리 필요.
    const staleDemolitionRemoveIds = new Set<string>();
    laborCostRows.forEach(row => {
      if (!row.isLinkedFromRecovery) return;
      if (row.category !== '철거공사') return;
      if (!row.sourceAreaRowId || !row.sourceAreaRowId.startsWith('demolition-')) return;
      const areaRowId = row.sourceAreaRowId.replace('demolition-', '');
      const areaRow = rows.find(r => r.id === areaRowId);
      // 산출표 영역행이 사라졌으면 stale
      if (!areaRow) {
        staleDemolitionRemoveIds.add(row.id);
        return;
      }
      if (!areaRow.workType || !areaRow.workName) return;
      // 영역행이 더 이상 demolition 대상이 아니면 stale
      if (!needsDemolitionRow(areaRow.workType, areaRow.workName)) {
        staleDemolitionRemoveIds.add(row.id);
        return;
      }
      // 영역행의 새 demolition 매핑과 기존 노무비 행의 workName이 다르면 stale
      const expectedDemoName = getDemolitionMapping(areaRow.workType, areaRow.workName).demolitionWorkName;
      const expectedCanon = DEMOLITION_WORKNAME_ALIASES[expectedDemoName] || expectedDemoName;
      const existingMatched = matchDemolitionWorkName(row.workName || '');
      const existingCanon = existingMatched
        ? (DEMOLITION_WORKNAME_ALIASES[existingMatched] || existingMatched)
        : (row.workName || '');
      if (normalizeForMatch(existingCanon) !== normalizeForMatch(expectedCanon)) {
        staleDemolitionRemoveIds.add(row.id);
      }
    });
    if (staleDemolitionRemoveIds.size > 0) {
      console.log('[자동연동] stale 철거공사 행 제거:', staleDemolitionRemoveIds.size, '개 (산출표 변경으로 매핑 불일치)');
      lastLaborSetSourceRef.current = 'autoSync-stale-demo';
      setLaborCostRows(prev => prev.filter(r => !staleDemolitionRemoveIds.has(r.id)));
      return;
    }

    // [공종 꼬임 방지] 산출표가 변경되어 더 이상 유효하지 않은 stale 바탕만들기 동반행 자동 제거
    // 예: 산출표 영역행의 공사명이 바탕만들기를 더 이상 필요로 하지 않는 항목으로 변경된 경우.
    // 마킹만 하고 hard return하지 않음 — useEffect deps에 laborCostRows가 없어 재진입 안 되므로,
    // 같은 사이클에서 새 companion 생성이 동시에 진행되도록 furnitureBathHelperRemoveIds 패턴을 따른다.
    const staleBatangRemoveIds = new Set<string>();
    laborCostRows.forEach(row => {
      if (!row.isLinkedFromRecovery) return;
      if (!row.sourceAreaRowId || !row.sourceAreaRowId.includes('::batang')) return;
      const areaRowId = extractOriginalSourceId(row.sourceAreaRowId);
      const areaRow = rows.find(r => r.id === areaRowId);
      // 부모 영역행이 사라졌으면 stale
      if (!areaRow) {
        staleBatangRemoveIds.add(row.id);
        return;
      }
      if (!areaRow.workType || !areaRow.workName) return;
      // 부모 영역행이 더 이상 같은 바탕만들기 companion을 요구하지 않으면 stale
      const expectedCompanions = getCompanionWorkNames(areaRow.workType, areaRow.workName);
      if (!expectedCompanions.includes(row.workName || '')) {
        staleBatangRemoveIds.add(row.id);
      }
    });
    if (staleBatangRemoveIds.size > 0) {
      console.log('[자동연동] stale 바탕만들기 동반행 제거 마킹:', staleBatangRemoveIds.size, '개 (부모 공사명 변경)');
      // [원복 2026-05-11] hard return 시도했으나 회귀 위험으로 원복.
      //   이 useEffect의 deps는 [rows, mergedIlwidaegaCatalog, laborRateTiers, isAutoSyncEligibleCase,
      //   isPartner, currentUser, deletedLinkedLaborKeys]로 laborCostRows 미포함.
      //   hard return으로 사이클 종료 시 stale 제거만 적용되고 신규 companion 재생성이
      //   다음 rows/catalog 변경 전까지 트리거되지 않아 견적 누락 가능.
      //   기존대로 마킹만 하고 같은 사이클의 setLaborCostRows에서 일괄 처리(L3537 근방).
    }

    // 이미 연동된 철거공사 행 마이그레이션: workName 매핑이 변경된 경우(예: '석고보드' → '석고') 갱신
    const alreadySyncedDemolitionRefreshes: { oldId: string; newRow: LaborCostRow }[] = [];
    rows.forEach(areaRow => {
      if (!areaRow.workType || !areaRow.workName) return;
      if (!needsDemolitionRow(areaRow.workType, areaRow.workName)) return;
      const demolitionSourceId = `demolition-${areaRow.id}`;
      const existing = laborCostRows.find(r => r.sourceAreaRowId === demolitionSourceId);
      if (!existing) return;
      const mappedName = getDemolitionMapping(areaRow.workType, areaRow.workName).demolitionWorkName;
      const catalogItem = mergedIlwidaegaCatalog.find(
        item => normalizeForMatch(item.공종 || '') === normalizeForMatch('철거공사') &&
               normalizeForMatch(item.공사명 || '') === normalizeForMatch(mappedName)
      );
      if (!catalogItem) return;
      const isEmpty = (!existing.standardPrice || existing.standardPrice === 0) &&
                      (!existing.amount || existing.amount === 0);
      // 표시명은 영역행 원본을 따르므로 nameMismatch 마이그레이션은 더 이상 필요 없음
      if (isEmpty) {
        const rawArea = Number(areaRow.repairArea) || 0;
        const refreshed = createDemolitionLaborRow(areaRow, catalogItem, rawArea);
        alreadySyncedDemolitionRefreshes.push({ oldId: existing.id, newRow: { ...refreshed, id: existing.id } });
        console.log('[자동연동] 이미연동된 철거공사 빈행 채우기:', existing.workName);
      }
    });
    if (alreadySyncedDemolitionRefreshes.length > 0) {
      const refreshMap = new Map(alreadySyncedDemolitionRefreshes.map(r => [r.oldId, r.newRow]));
      lastLaborSetSourceRef.current = 'autoSync-migrate';
      setLaborCostRows(prev => prev.map(row => refreshMap.get(row.id) || row));
    }

    console.log('[진단D-2] 보통인부 cleanup 직전');
    // 가구공사/욕실공사 FIXED 항목의 보통인부 행 정리 (철거공사 자동연동에서만 생성)
    // return 하지 않고 forEach까지 진행 — 같은 사이클에서 보통인부 제거 + 새 행 추가를 함께 처리
    const furnitureBathHelperRemoveIds = new Set<string>();
    laborCostRows.forEach(row => {
      if (!row.isLinkedFromRecovery) return;
      if (normalizeForMatch(row.detailItem || '') !== normalizeForMatch('보통인부')) return;
      if (row.category !== '가구공사' && row.category !== '욕실공사') return;
      if (!isFixedIlwidaegaWorkName(row.workName || '')) return;
      if (!row.sourceAreaRowId) return;
      if (row.sourceAreaRowId.startsWith('demolition-') || row.sourceAreaRowId.includes('::batang')) return;
      furnitureBathHelperRemoveIds.add(row.id);
    });
    if (furnitureBathHelperRemoveIds.size > 0) {
      console.log('[자동연동] 가구/욕실 보통인부 행 제거:', furnitureBathHelperRemoveIds.size, '개 (cleanup만, forEach 계속 진행)');
    }

    console.log('[진단4] if-블록 도달 여부 체크. completedAreaRows=', completedAreaRows.length, 'demolitionOnlyAreaRows=', demolitionOnlyAreaRows.length, 'alreadySyncedRefreshes=', alreadySyncedDemolitionRefreshes.length);

    // 연동할 행이 있으면 노무비에 추가 (일위대가DB 기반 모든 노임항목 생성)
    if (completedAreaRows.length > 0 || demolitionOnlyAreaRows.length > 0) {
      console.log('[진단4-B] if-블록 진입 OK. completedAreaRows IDs:', completedAreaRows.map(r => `${r.workName}/${r.id?.slice(-8)}`));
      const newLaborRows: LaborCostRow[] = [];
      const staleEmptyDemolitionRefreshes: { oldId: string; newRow: LaborCostRow }[] = [];
      
      // 가구/욕실 FIXED 포함 모든 영역행을 위치별로 처리 — 표시단(mergeDemolitionRows)에서 합산
      completedAreaRows.forEach(areaRow => {
        console.log('[진단4-C] forEach iter:', areaRow.workName, '/', areaRow.location, '/', areaRow.id?.slice(-8));
        const workType = areaRow.workType;
        const workName = areaRow.workName;
        const rawRepairArea = Number(areaRow.repairArea) || 0;
        const isFixed = isFixedIlwidaegaWorkName(workName);
        const addNewCeilingMult = isFixed ? 1.0 : getCeilingMultiplier(workType, areaRow.location || '');
        const damageAreaValue = Math.round(rawRepairArea * addNewCeilingMult * 10) / 10;
        const laborCategory = getLaborCategory(workType, workName);
        
        // 일위대가DB에서 공종+공사명으로 ALL matching 노임항목 조회 (오버라이드 적용된 값 사용)
        const matchingCatalogItems = mergedIlwidaegaCatalog.filter(
          item => normalizeForMatch(item.공종 || '') === normalizeForMatch(laborCategory) && 
                 normalizeForMatch(item.공사명 || '') === normalizeForMatch(workName)
        );
        
        console.log('[연동] 일위대가 조회:', { workType, workName, laborCategory, matchCount: matchingCatalogItems.length, isFixed, areaRowId: areaRow.id?.slice(-8) });
        if ((workType === '가구공사' || workType === '욕실공사') && isFixedIlwidaegaWorkName(workName)) {
          console.log('[진단3-FB] forEach 진입:', workName, '/loc=', areaRow.location, '/areaId=', areaRow.id?.slice(-8), '/catalogMatchCount=', matchingCatalogItems.length, '/items=', matchingCatalogItems.map(i => i.노임항목));
        }
        
        // 가구/욕실 FIXED는 보통인부를 제외 (철거공사 자동연동에서 별도 생성).
        // 내장공만 위치별로 행 생성 → 표시단(mergeDemolitionRows)에서 위치별 합산.
        const augmentedCatalogItems = (isFixed && (workType === '가구공사' || workType === '욕실공사'))
          ? matchingCatalogItems.filter(
              item => normalizeForMatch(item.노임항목 || '') !== normalizeForMatch('보통인부')
            )
          : matchingCatalogItems;

        if (augmentedCatalogItems.length > 0) {
          // 일위대가DB에서 매칭된 모든 노임항목으로 행 생성
          augmentedCatalogItems.forEach((catalogItem, idx) => {
            const C = damageAreaValue; // 복구면적
            const D = catalogItem.기준작업량 || 0; // 기준작업량
            const E = catalogItem.노임단가 || 0; // 노임단가(인당)
            const fixedTotal = catalogItem.일위대가 || 0; // 일위대가 (FIXED 합계)
            
            // [면적0 보정] 면적 0이면 수량 0으로 시작 (사용자 요청).
            // 면적 > 0 + D/E 결손이면 기존 1 유지.
            let calculatedQuantity = C > 0 ? 1 : 0;
            let calculatedAmount = 0;
            let calculatedPricePerSqm = 0;
            
            if (isFixed) {
              // FIXED: 합계=일위대가(DB), 적용단가=노임단가(E), 수량=합계/적용단가
              calculatedAmount = fixedTotal;
              calculatedPricePerSqm = E;
              calculatedQuantity = E > 0 && fixedTotal > 0 ? Math.round((fixedTotal / E) * 10) / 10 : 1;
            } else if (D > 0 && E > 0 && C > 0) {
              calculatedAmount = calculateIWithTiers(C, D, E, laborRateTiers);
              calculatedPricePerSqm = calculateAppliedUnitPriceWithTiers(C, D, E, laborRateTiers);
              calculatedQuantity = calculateQuantityWithTiers(C, D, E, laborRateTiers);
            }
            
            newLaborRows.push({
              id: `labor-linked-${Date.now()}-${Math.random()}-${idx}`,
              sourceAreaRowId: areaRow.id,
              isLinkedFromRecovery: true, // 복구면적에서 연동 생성된 행 (수정 불가)
              place: areaRow.category || '',
              position: areaRow.location || '',
              category: laborCategory,
              workName: workName,
              detailWork: '일위대가',
              detailItem: catalogItem.노임항목,
              priceStandard: '',
              unit: '㎡',
              standardPrice: E, // 노임단가 (E)
              standardWorkQuantity: D, // 기준작업량 (D)
              quantity: calculatedQuantity, // 수량 (C/D)
              applicationRates: { ceiling: false, wall: false, floor: false, molding: false },
              salesMarkupRate: 0,
              pricePerSqm: calculatedPricePerSqm, // 적용단가 (E)
              damageArea: C, // 복구면적 (C)
              deduction: 0,
              includeInEstimate: true,
              request: '',
              amount: calculatedAmount, // 합계 (I)
            });
          });
        } else {
          // 일위대가DB에 없으면 빈 행 생성 (수동 입력용)
          const mainRow = createBlankLaborRow({
            sourceAreaRowId: areaRow.id,
            isLinkedFromRecovery: true,
            place: areaRow.category || '',
            position: areaRow.location || '',
            category: laborCategory,
            workName: workName,
            damageArea: damageAreaValue,
          });
          // [면적0 보정] 카탈로그 매칭 없는 fallback도 면적 0이면 quantity/금액 0으로 시작.
          if ((Number(mainRow.damageArea) || 0) <= 0) {
            mainRow.quantity = 0;
            mainRow.amount = 0;
          }
          newLaborRows.push(mainRow);
        }
        
        // 바탕만들기 companion 행 자동 생성
        const autoCompanions = getCompanionWorkNames(workType, workName);
        autoCompanions.forEach(companionName => {
          const companionSourceId = `${areaRow.id}::batang`;
          const companionItems = mergedIlwidaegaCatalog.filter(
            item => normalizeForMatch(item.공종 || '') === normalizeForMatch(laborCategory) &&
                   normalizeForMatch(item.공사명 || '') === normalizeForMatch(companionName)
          );
          companionItems.forEach((catalogItem, cidx) => {
            const cD = catalogItem.기준작업량 || 0;
            const cE = catalogItem.노임단가 || 0;
            // [면적0 보정] 면적 0이면 수량 0으로 시작 (사용자 요청).
            // 면적 > 0 + D/E 결손이면 기존 1 유지.
            let cQty = damageAreaValue > 0 ? 1 : 0;
            let cAmt = 0, cPps = 0;
            if (cD > 0 && cE > 0 && damageAreaValue > 0) {
              cAmt = calculateIWithTiers(damageAreaValue, cD, cE, laborRateTiers);
              cPps = calculateAppliedUnitPriceWithTiers(damageAreaValue, cD, cE, laborRateTiers);
              cQty = calculateQuantityWithTiers(damageAreaValue, cD, cE, laborRateTiers);
            }
            newLaborRows.push({
              id: `labor-linked-${Date.now()}-${Math.random()}-batang-${cidx}`,
              sourceAreaRowId: companionSourceId,
              isLinkedFromRecovery: true,
              place: areaRow.category || '',
              position: areaRow.location || '',
              category: laborCategory,
              workName: companionName,
              detailWork: '일위대가',
              detailItem: catalogItem.노임항목,
              priceStandard: '',
              unit: '㎡',
              standardPrice: cE,
              standardWorkQuantity: cD,
              quantity: cQty,
              applicationRates: { ceiling: false, wall: false, floor: false, molding: false },
              salesMarkupRate: 0,
              pricePerSqm: cPps,
              damageArea: damageAreaValue,
              deduction: 0,
              includeInEstimate: true,
              request: '',
              amount: cAmt,
            });
          });
        });

        // 철거공사 자동 생성 (needsDemolitionRow 대상 항목)
        // 복구면적이 0인 경우 0원 행이 생성되므로 건너뜀 (FIXED 항목은 demolitionOnlyAreaRows에서 별도 처리)
        if (needsDemolitionRow(workType, workName) && rawRepairArea > 0) {
          const demolitionSourceId = `demolition-${areaRow.id}`;
          const existingDemolition = laborCostRows.find(r => r.sourceAreaRowId === demolitionSourceId);
          const mappedDemolitionName = getDemolitionMapping(workType, workName).demolitionWorkName;
          const demolitionCatalogItem = mergedIlwidaegaCatalog.find(
            item => normalizeForMatch(item.공종 || '') === normalizeForMatch('철거공사') &&
                   normalizeForMatch(item.공사명 || '') === normalizeForMatch(mappedDemolitionName)
          );
          if (!existingDemolition) {
            const demolitionRow = createDemolitionLaborRow(areaRow, demolitionCatalogItem, rawRepairArea);
            newLaborRows.push(demolitionRow);
            console.log('[자동연동] 철거공사 행 생성:', workName, demolitionCatalogItem ? '(DB매칭)' : '(빈행)');
          } else if (demolitionCatalogItem) {
            // 카탈로그 매칭이 가능한 경우 빈 행만 채움 (표시명은 영역행 원본 유지하므로 nameMismatch 불필요)
            const isEmpty = (!existingDemolition.standardPrice || existingDemolition.standardPrice === 0) &&
                            (!existingDemolition.amount || existingDemolition.amount === 0);
            if (isEmpty) {
              const refreshedRow = createDemolitionLaborRow(areaRow, demolitionCatalogItem, rawRepairArea);
              staleEmptyDemolitionRefreshes.push({ oldId: existingDemolition.id, newRow: { ...refreshedRow, id: existingDemolition.id } });
              console.log('[자동연동] 철거공사 행 갱신(빈행 채우기):', workName);
            }
          }
        }
      });

      // AREA_DISPLAY_ONLY 항목의 철거공사 행 생성 (가구공사/욕실공사 FIXED 항목)
      demolitionOnlyAreaRows.forEach(areaRow => {
        const workName = areaRow.workName;
        const rawRepairArea = Number(areaRow.repairArea) || 0;
        const demolitionSourceId = `demolition-${areaRow.id}`;
        // 같은 사이클에서 completedAreaRows.forEach가 이미 같은 영역행에 대해
        // 철거공사 행을 push했을 수 있으므로 newLaborRows 내 중복 가드
        if (newLaborRows.find(r => r.sourceAreaRowId === demolitionSourceId)) {
          console.log('[자동연동] FIXED 철거공사 행 중복 스킵(같은 사이클):', workName, areaRow.id?.slice(-8));
          return;
        }
        const mappedDemolitionName = getDemolitionMapping(areaRow.workType, workName).demolitionWorkName;
        const demolitionCatalogItem = mergedIlwidaegaCatalog.find(
          item => normalizeForMatch(item.공종 || '') === normalizeForMatch('철거공사') &&
                 normalizeForMatch(item.공사명 || '') === normalizeForMatch(mappedDemolitionName)
        );
        const demolitionRow = createDemolitionLaborRow(areaRow, demolitionCatalogItem, rawRepairArea);
        newLaborRows.push(demolitionRow);
        console.log('[자동연동] FIXED 항목 철거공사 행 생성:', workName, areaRow.location, areaRow.id?.slice(-8), demolitionCatalogItem ? '(DB매칭)' : '(빈행)');
      });

      console.log('[진단5] newLaborRows push 결과', newLaborRows.length, '개:',
        newLaborRows.map(r => `${r.category}/${r.workName}/${r.detailItem}/srcId=${r.sourceAreaRowId?.slice(-8)}/qty=${r.quantity}/std=${r.standardPrice}`));
      // [삭제키 가드 — Task #7] 사용자가 의도적으로 삭제한 자동행 키는 다시 생성하지 않음
      //   - 철거공사 reconcile useEffect와 동일한 makeLinkedLaborDeletionKey 사용 → 키 형식 일관성 보장
      //   - 키 형식: `${category}|${normalizedWorkName}|${detailItem}` (sourceAreaRowId는 무시)
      //   - 적용 대상: 일반 행, FIXED 본체, companion(바탕만들기), demolitionOnly 철거공사 행 모두
      // [수동행 가드 — Task #8에서 정밀화]
      //   - 이전 manualKeySetForAutoSync 글로벌 키 차단은 제거됨.
      //   - 같은 영역행 중복은 existingSourceAreaIds 등 sourceAreaRowId 기반 가드,
      //     같은 workName 다른 영역행 중복은 existingLinkedWorkNames로 이미 차단되어 있다.
      //   - 사용자 요청: "수동행도 기존 자동연동 로직에 충돌 및 중복이 안 된다면 자동연동에 추가".
      const filteredNewLaborRows = newLaborRows.filter(r => {
        const deletionKey = makeLinkedLaborDeletionKey(
          r.sourceAreaRowId || '',
          r.category || '',
          r.workName || '',
          r.detailItem || ''
        );
        if (deletedLinkedLaborKeys.has(deletionKey)) {
          console.log('[자동연동] 삭제키 가드 - 자동 행 생성 skip:', r.category, r.workName, r.detailItem, 'key=', deletionKey);
          return false;
        }
        return true;
      });
      lastLaborSetSourceRef.current = 'autoSync-addNewRows';
      setLaborCostRows(prev => {
        const refreshMap = new Map(staleEmptyDemolitionRefreshes.map(r => [r.oldId, r.newRow]));
        const nonEmptyRows = prev
          .filter(row => row.sourceAreaRowId || row.place || row.position || row.category || row.workName)
          .filter(row => !furnitureBathHelperRemoveIds.has(row.id))
          .filter(row => !staleBatangRemoveIds.has(row.id))
          .map(row => refreshMap.get(row.id) || row);
        const result = [...nonEmptyRows, ...filteredNewLaborRows];
        const fbResult = result.filter(r => (r.category === '가구공사' || r.category === '욕실공사') && r.workName && r.detailItem !== '보통인부' && (r.workName === 'SMC' || r.workName === '상부장'));
        console.log('[진단5-B] setLaborCostRows 직후 SMC/상부장 본체 행:', fbResult.map(r => `${r.workName}/${r.detailItem}/srcId=${r.sourceAreaRowId?.slice(-8)}/qty=${r.quantity}`));
        return result;
      });
    } else if (furnitureBathHelperRemoveIds.size > 0 || staleBatangRemoveIds.size > 0) {
      // 새로 추가할 행은 없지만 보통인부/stale 바탕만들기 정리만 필요한 경우
      lastLaborSetSourceRef.current = 'autoSync-removeFurnitureBathHelperOrBatang';
      setLaborCostRows(prev => prev.filter(r => !furnitureBathHelperRemoveIds.has(r.id) && !staleBatangRemoveIds.has(r.id)));
    }

    lastLaborSetSourceRef.current = 'autoSync-reconcile';
    setLaborCostRows(prev => {
      const filteredRows = prev.filter(laborRow => {
        // [LOCK] 저장 시점에 확정된 행은 어떤 이유로도 자동 삭제하지 않음 (스냅샷 보존)
        if (laborRow.lockedAtSave) return true;
        if (!laborRow.isLinkedFromRecovery || !laborRow.sourceAreaRowId) return true;
        
        const isDemolitionRow = laborRow.sourceAreaRowId.startsWith('demolition-');
        const isBatangRow = isCompanionSourceId(laborRow.sourceAreaRowId);
        let originalAreaRowId = laborRow.sourceAreaRowId;
        if (isDemolitionRow) originalAreaRowId = originalAreaRowId.replace('demolition-', '');
        if (isBatangRow) originalAreaRowId = extractOriginalSourceId(originalAreaRowId);
        
        let linkedAreaRow = rows.find(r => r.id === originalAreaRowId);
        
        if (!linkedAreaRow && laborRow.workName) {
          if (isDemolitionRow) {
            linkedAreaRow = rows.find(r => {
              const matchedName = matchDemolitionWorkName(r.workName || '');
              return matchedName && normalizeForMatch(matchedName) === normalizeForMatch(laborRow.workName || '');
            });
          } else if (isBatangRow) {
            const parentWorkName = Object.entries(BATANG_COMPANION_MAP).find(([, v]) => v === laborRow.workName)?.[0];
            if (parentWorkName) {
              linkedAreaRow = rows.find(r =>
                normalizeForMatch(r.workName || '') === normalizeForMatch(parentWorkName)
              );
            }
          } else {
            linkedAreaRow = rows.find(r =>
              normalizeForMatch(r.workName || '') === normalizeForMatch(laborRow.workName || '')
            );
          }
          if (linkedAreaRow) {
            if (isDemolitionRow) laborRow.sourceAreaRowId = `demolition-${linkedAreaRow.id}`;
            else if (isBatangRow) laborRow.sourceAreaRowId = `${linkedAreaRow.id}::batang`;
            else laborRow.sourceAreaRowId = linkedAreaRow.id;
          }
        }
        
        if (!linkedAreaRow) {
          console.log('[Reconcile] 원본 복구면적 행 삭제됨 → 노무비 행 삭제:', laborRow.workName, '| sourceAreaRowId:', laborRow.sourceAreaRowId);
          return false;
        }
        
        if (isDemolitionRow) {
          const { demolitionWorkName } = getDemolitionMapping(linkedAreaRow.workType, linkedAreaRow.workName);
          const needsDemolition = needsDemolitionRow(linkedAreaRow.workType, linkedAreaRow.workName);
          const areaWorkName = linkedAreaRow.workName || '';
          
          // 표시명은 영역행 원본('석고보드') 또는 alias 매핑('석고') 모두 허용
          const matchesArea = normalizeForMatch(laborRow.workName || '') === normalizeForMatch(areaWorkName);
          const matchesAlias = normalizeForMatch(laborRow.workName || '') === normalizeForMatch(demolitionWorkName || '');
          if (!matchesArea && !matchesAlias) {
            console.log('[Reconcile] 철거공사 공사명 변경 → 기존 행 삭제:', laborRow.workName, '→', areaWorkName, '/', demolitionWorkName);
            return false;
          }
          
          if (!needsDemolition) {
            console.log('[Reconcile] 철거공사 불필요 → 기존 행 삭제:', laborRow.workName);
            return false;
          }
          
          return true;
        } else if (isBatangRow) {
          const expectedCompanions = getCompanionWorkNames(linkedAreaRow.workType || '', linkedAreaRow.workName || '');
          if (!expectedCompanions.includes(laborRow.workName || '')) {
            console.log('[Reconcile] 바탕만들기 companion 불일치 → 기존 행 삭제:', laborRow.workName);
            return false;
          }
          return true;
        } else {
          // FIXED 일위대가 항목은 AREA_DISPLAY_ONLY 공종이라도 노무비 행을 유지
          const isFixedItem = isFixedIlwidaegaWorkName(linkedAreaRow.workName || '');
          if (!isFixedItem &&
              (AREA_DISPLAY_ONLY_WORK_TYPES.includes(linkedAreaRow.workType || '') || 
              AREA_DISPLAY_ONLY_WORK_NAMES.includes(linkedAreaRow.workName || '')) &&
              !isItemInLinkSettings(linkedAreaRow.workType || '', linkedAreaRow.workName || '')) {
            console.log('[Reconcile] 연동 제외 대상 → 기존 행 삭제:', linkedAreaRow.workType, linkedAreaRow.workName);
            return false;
          }
          if (normalizeForMatch(laborRow.workName || '') !== normalizeForMatch(linkedAreaRow.workName || '')) {
            console.log('[Reconcile] 공사명 변경 → 기존 행 삭제:', laborRow.workName, '→', linkedAreaRow.workName);
            return false;
          }
          return true;
        }
      });
      
      // 2. 나머지 행 업데이트 (장소, 위치, 피해면적 동기화)
      return filteredRows.map(laborRow => {
        // [LOCK] 저장 시점에 확정된 행은 어떤 update 분기(철거/FIXED/일반)에서도 표준값 덮어쓰지 않음.
        // 단, 피해면적(C)이 0인 행은 lock 효과 없음 → 산출표 면적이 흘러들어와 자동 채워지도록 허용.
        // 추가: 합계(amount)가 0인 잠금은 잘못 박힌 빈 lock으로 간주 → 자동 보정 허용.
        const isEffectiveLockTop = laborRow.lockedAtSave &&
          (Number(laborRow.damageArea) || 0) > 0 &&
          (Number(laborRow.amount) || 0) > 0;
        if (isEffectiveLockTop) return laborRow;
        if (!laborRow.sourceAreaRowId) return laborRow;
        
        // 피해철거공사 행인지 확인 (demolition- 접두사)
        const isDemolitionRow = laborRow.sourceAreaRowId.startsWith('demolition-');
        const isBatangRow2 = isCompanionSourceId(laborRow.sourceAreaRowId);
        let originalAreaRowId2 = laborRow.sourceAreaRowId;
        if (isDemolitionRow) originalAreaRowId2 = originalAreaRowId2.replace('demolition-', '');
        if (isBatangRow2) originalAreaRowId2 = extractOriginalSourceId(originalAreaRowId2);
        
        let linkedAreaRow = rows.find(r => r.id === originalAreaRowId2);
        if (!linkedAreaRow && laborRow.workName) {
          if (isDemolitionRow) {
            linkedAreaRow = rows.find(r => {
              const matchedName = matchDemolitionWorkName(r.workName || '');
              return matchedName && normalizeForMatch(matchedName) === normalizeForMatch(laborRow.workName || '');
            });
          } else if (isBatangRow2) {
            const parentWorkName2 = Object.entries(BATANG_COMPANION_MAP).find(([, v]) => v === laborRow.workName)?.[0];
            if (parentWorkName2) {
              linkedAreaRow = rows.find(r =>
                normalizeForMatch(r.workName || '') === normalizeForMatch(parentWorkName2)
              );
            }
          } else {
            linkedAreaRow = rows.find(r =>
              normalizeForMatch(r.workName || '') === normalizeForMatch(laborRow.workName || '')
            );
          }
          if (linkedAreaRow) {
            if (isDemolitionRow) laborRow.sourceAreaRowId = `demolition-${linkedAreaRow.id}`;
            else if (isBatangRow2) laborRow.sourceAreaRowId = `${linkedAreaRow.id}::batang`;
            else laborRow.sourceAreaRowId = linkedAreaRow.id;
          }
        }
        if (!linkedAreaRow) return laborRow;
        
        // 복구면적 값 (숫자로 변환) + 천장 할증 계수 적용 (항상 원본 면적 행의 workType 사용)
        const rawDamageArea = Number(linkedAreaRow.repairArea) || 0;
        const autoSyncCeilingMult = getCeilingMultiplier(linkedAreaRow.workType || '', linkedAreaRow.location || '');
        const damageAreaValue = Math.round(rawDamageArea * autoSyncCeilingMult * 10) / 10;
        
        if (isDemolitionRow) {
          // 피해철거공사 행 업데이트 (장소, 위치, 피해면적 + 적용단가/수량/합계 재계산)
          // standardWorkQuantity가 0이면 카탈로그 동기화 강제 (D/E 조회 필요)
          // pricePerSqm이 0이고 standardPrice가 있으면 재계산 필요 (새로 추가된 행)
          const needsPriceRecalc = laborRow.pricePerSqm === 0 && laborRow.standardPrice && Number(laborRow.standardPrice) > 0 && damageAreaValue > 0;
          const needsUpdate = 
            laborRow.place !== linkedAreaRow.category ||
            laborRow.position !== linkedAreaRow.location ||
            laborRow.damageArea !== damageAreaValue ||
            !laborRow.standardWorkQuantity ||
            !laborRow.standardPrice ||
            needsPriceRecalc;
          
          if (needsUpdate) {
            // 적용단가, 수량, 합계 재계산 (C=복구면적, D=기준작업량, E=노임단가)
            const C = damageAreaValue;
            let D = laborRow.standardWorkQuantity || 0;
            let E = laborRow.standardPrice || 0;
            
            // D가 0이면 일위대가 카탈로그에서 조회 (오버라이드 적용된 값 사용)
            // [Bug 2 fix 2026-05-04] 철거공사 공사명에 alias 매핑 적용 ('석고보드'→'석고').
            //   카탈로그는 '석고'로 등록돼 있는데 표시명은 영역행 원본('석고보드')을 따르므로,
            //   alias를 적용하지 않으면 D=0인 빈 행에서 카탈로그 매칭이 실패하여
            //   수량/금액이 영구적으로 0에 머무는 회귀가 발생. 산식 변경 없음 - 매칭만 보정.
            if (D === 0 && laborRow.category && laborRow.workName) {
              const matchedRaw = matchDemolitionWorkName(laborRow.workName) || laborRow.workName;
              const canonicalLookupName = DEMOLITION_WORKNAME_ALIASES[matchedRaw] || matchedRaw;
              const catalogItem = mergedIlwidaegaCatalog.find(item => 
                normalizeForMatch(item.공종) === normalizeForMatch(laborRow.category) &&
                (normalizeForMatch(item.공사명) === normalizeForMatch(laborRow.workName) ||
                 normalizeForMatch(item.공사명) === normalizeForMatch(canonicalLookupName)) &&
                (!laborRow.detailItem || normalizeForMatch(item.노임항목) === normalizeForMatch(laborRow.detailItem))
              );
              if (catalogItem) {
                D = catalogItem.기준작업량 || 0;
                E = catalogItem.노임단가 || E;
              }
            }
            
            let newPricePerSqm = laborRow.pricePerSqm;
            let newQuantity = laborRow.quantity;
            let newAmount = laborRow.amount;
            let newStandardWorkQuantity = D;
            let newStandardPrice = E;
            
            if (D > 0 && E > 0 && C > 0) {
              newPricePerSqm = calculateAppliedUnitPriceWithTiers(C, D, E, laborRateTiers);
              newQuantity = calculateQuantityWithTiers(C, D, E, laborRateTiers);
              newAmount = calculateIWithTiers(C, D, E, laborRateTiers);
            } else if (C <= 0) {
              // [면적0 보정] 산출표 면적이 0으로 변경되면 수량/금액/단가 0으로 명시 override (사용자 요청).
              newPricePerSqm = 0;
              newQuantity = 0;
              newAmount = 0;
            }
            
            return {
              ...laborRow,
              place: linkedAreaRow.category,
              position: linkedAreaRow.location,
              damageArea: damageAreaValue,
              pricePerSqm: newPricePerSqm,
              quantity: newQuantity,
              amount: newAmount,
              standardWorkQuantity: newStandardWorkQuantity,
              standardPrice: newStandardPrice,
            };
          }
        } else {
          // 일반 행 업데이트 (장소, 위치, 피해면적 + 적용단가/수량/합계 재계산)
          const laborCategory = getLaborCategory(linkedAreaRow.workType, linkedAreaRow.workName);
          const catalogLookupWorkName = isBatangRow2 ? (laborRow.workName || linkedAreaRow.workName) : linkedAreaRow.workName;
          
          // FIXED 일위대가 항목(가구공사/욕실공사 SMC/리빙보드/도기류/붙박이장/상부장 시리즈):
          // 위치별로 고정 인분(내장공 1.0, 보통인부 0.5) 행 1개씩 유지. 면적/장소/위치는 본 영역행 값.
          // 위치별 인분 합산 표시는 mergeDemolitionRows에서 처리.
          const isFixedLaborItem = isFixedIlwidaegaWorkName(linkedAreaRow.workName || '') &&
            (linkedAreaRow.workType === '가구공사' || linkedAreaRow.workType === '욕실공사');
          if (isFixedLaborItem) {
            // [LOCK] 저장 시점에 확정된 FIXED 행은 자동 동기화로 덮어쓰지 않음.
            // 단, 피해면적(C)이 0인 행은 lock 효과 없음 → 산출표 면적이 흘러들어와 자동 채워지도록 허용.
            // 추가: 합계(amount)가 0인 잠금은 잘못 박힌 빈 lock으로 간주 → 자동 보정 허용.
            const isEffectiveLockFixed = laborRow.lockedAtSave &&
              (Number(laborRow.damageArea) || 0) > 0 &&
              (Number(laborRow.amount) || 0) > 0;
            if (isEffectiveLockFixed) {
              return laborRow;
            }
            const isHelper = normalizeForMatch(laborRow.detailItem || '') === normalizeForMatch('보통인부');
            const fixedQuantity = isHelper ? 0.5 : 1.0;
            const singleDamageArea = Math.round((Number(linkedAreaRow.repairArea) || 0) * 10) / 10;
            // standardPrice가 0이면 카탈로그에서 보충
            let E = laborRow.standardPrice || 0;
            let D = laborRow.standardWorkQuantity || 0;
            if (E === 0 && laborCategory && laborRow.workName) {
              const catalogItem = mergedIlwidaegaCatalog.find(item =>
                normalizeForMatch(item.공종) === normalizeForMatch(laborCategory) &&
                normalizeForMatch(item.공사명) === normalizeForMatch(laborRow.workName) &&
                (!laborRow.detailItem || normalizeForMatch(item.노임항목) === normalizeForMatch(laborRow.detailItem))
              );
              if (catalogItem) {
                E = catalogItem.노임단가 || 0;
                D = catalogItem.기준작업량 || D;
              }
            }
            const fixedAmount = Math.round(E * fixedQuantity);
            const needsFixedUpdate =
              laborRow.place !== linkedAreaRow.category ||
              laborRow.position !== linkedAreaRow.location ||
              laborRow.damageArea !== singleDamageArea ||
              laborRow.quantity !== fixedQuantity ||
              laborRow.amount !== fixedAmount ||
              laborRow.pricePerSqm !== E ||
              laborRow.standardPrice !== E ||
              laborRow.standardWorkQuantity !== D;
            if (needsFixedUpdate) {
              return {
                ...laborRow,
                place: linkedAreaRow.category,
                position: linkedAreaRow.location,
                category: laborCategory,
                damageArea: singleDamageArea,
                quantity: fixedQuantity,
                amount: fixedAmount,
                pricePerSqm: E,
                standardPrice: E,
                standardWorkQuantity: D,
              };
            }
            return laborRow;
          }
          
          // [LOCK] 저장 시점에 확정된 행은 자동 동기화로 덮어쓰지 않음.
          // 단, 피해면적(C)이 0인 행은 lock 효과 없음 → 산출표 면적이 흘러들어와 자동 채워지도록 허용.
          // 추가: 합계(amount)가 0인 잠금은 잘못 박힌 빈 lock으로 간주 → 자동 보정 허용.
          const isEffectiveLockGen = laborRow.lockedAtSave &&
            (Number(laborRow.damageArea) || 0) > 0 &&
            (Number(laborRow.amount) || 0) > 0;
          if (isEffectiveLockGen) {
            return laborRow;
          }
          // standardWorkQuantity가 0이면 카탈로그 동기화 강제 (D/E 조회 필요)
          // pricePerSqm이 0이고 standardPrice가 있으면 재계산 필요 (새로 추가된 행)
          const needsPriceRecalc = laborRow.pricePerSqm === 0 && laborRow.standardPrice && Number(laborRow.standardPrice) > 0 && damageAreaValue > 0;
          const needsUpdate = 
            laborRow.place !== linkedAreaRow.category ||
            laborRow.position !== linkedAreaRow.location ||
            laborRow.category !== laborCategory ||
            laborRow.damageArea !== damageAreaValue ||
            !laborRow.standardWorkQuantity ||
            !laborRow.standardPrice ||
            needsPriceRecalc;
          
          if (needsUpdate) {
            // 적용단가, 수량, 합계 재계산 (C=복구면적, D=기준작업량, E=노임단가)
            const C = damageAreaValue;
            let D = laborRow.standardWorkQuantity || 0;
            let E = laborRow.standardPrice || 0;
            
            // D가 0이면 일위대가 카탈로그에서 조회 (companion은 laborRow.workName 사용, 오버라이드 적용된 값 사용)
            if (D === 0 && laborCategory && catalogLookupWorkName) {
              const catalogItem = mergedIlwidaegaCatalog.find(item => 
                normalizeForMatch(item.공종) === normalizeForMatch(laborCategory) &&
                normalizeForMatch(item.공사명) === normalizeForMatch(catalogLookupWorkName) &&
                (!laborRow.detailItem || normalizeForMatch(item.노임항목) === normalizeForMatch(laborRow.detailItem))
              );
              if (catalogItem) {
                D = catalogItem.기준작업량 || 0;
                E = catalogItem.노임단가 || E;
              }
            }
            
            let newPricePerSqm = laborRow.pricePerSqm;
            let newQuantity = laborRow.quantity;
            let newAmount = laborRow.amount;
            let newStandardWorkQuantity = D;
            let newStandardPrice = E;
            
            if (D > 0 && E > 0 && C > 0) {
              newPricePerSqm = calculateAppliedUnitPriceWithTiers(C, D, E, laborRateTiers);
              newQuantity = calculateQuantityWithTiers(C, D, E, laborRateTiers);
              newAmount = calculateIWithTiers(C, D, E, laborRateTiers);
            } else if (C <= 0) {
              // [면적0 보정] 산출표 면적이 0으로 변경되면 수량/금액/단가 0으로 명시 override (사용자 요청).
              newPricePerSqm = 0;
              newQuantity = 0;
              newAmount = 0;
            }
            
            return {
              ...laborRow,
              place: linkedAreaRow.category,
              position: linkedAreaRow.location,
              category: laborCategory,
              damageArea: damageAreaValue,
              pricePerSqm: newPricePerSqm,
              quantity: newQuantity,
              amount: newAmount,
              standardWorkQuantity: newStandardWorkQuantity,
              standardPrice: newStandardPrice,
            };
          }
        }
        
        return laborRow;
      });
    });
  }, [rows, mergedIlwidaegaCatalog, laborRateTiers, isAutoSyncEligibleCase, isPartner, currentUser, deletedLinkedLaborKeys]); // rows(복구면적 산출표), 일위대가 카탈로그, 노임단가 비율 변경 시 실행 + cutoff 적용 대상 변화 감지 + 협력업체 가드 + 삭제키 가드 (사용자 삭제 직후 useEffect 재발화로 정합 상태 유지)

  // ========== 철거공사 Reconcile useEffect ==========
  // 복구면적 산출표(rows)의 공사명을 기반으로 철거공사 노무비를 자동 생성/삭제
  // 각 복구면적 행별로 개별 철거공사 행 생성 (sourceRowId 기반 1:1 매칭)
  // 키 형식: sourceRowId|matchedName|detailItem (일관된 정규화된 공사명 사용)
  const demolitionReconcileRef = useRef<string>('');
  const demolitionPendingRef = useRef<boolean>(false);
  
  useEffect(() => {
    // [정책 변경 2026-05-04] 협력업체 화면에서도 철거공사 자동 Reconcile 발동.
    // 협력업체가 견적 작성 시 도배/석고보드 등에 대응하는 철거 행이 자동 추가되어
    // 관리자 화면과 일관된 결과를 보여주도록 한다(사용자 요청).
    // 다른 자동연동/dedup의 isPartner 원본보존 가드는 그대로 유지된다.
    if (!currentUser) {
      demolitionPendingRef.current = false;
      return;
    }

    // Hydration 완료 전에는 건너뛰기
    if (!isHydratedRef.current) {
      demolitionPendingRef.current = false; // 조기 종료 시 플래그 리셋
      return;
    }
    
    // [타이밍 가드] exclusions 로드 완료 전에는 건너뛰기 (부활 방지)
    if (!exclusionsLoaded) {
      console.log('RECONCILE_WAITING_EXCLUSIONS', { exclusionsLoaded: false });
      demolitionPendingRef.current = false;
      return;
    }
    
    if (!mergedIlwidaegaCatalog || mergedIlwidaegaCatalog.length === 0) {
      demolitionPendingRef.current = false;
      return;
    }
    
    if (syncGuardRef.current) {
      console.log('[철거공사 Reconcile] syncGuard 활성 — 건너뛰기');
      demolitionPendingRef.current = false;
      return;
    }

    // cutoff 이전에 생성된 기존 접수건은 자동 동기화 차단 (수동 버튼은 별개)
    if (!isAutoSyncEligibleCase) {
      console.log('[철거공사 Reconcile SKIP] 기존 케이스(cutoff 이전 생성)', {
        cutoff: AUTO_SYNC_CUTOFF_KST,
        caseCreatedAt: (estimateCase as any)?.createdAt,
      });
      demolitionPendingRef.current = false;
      return;
    }
    
    console.log('RECONCILE_START', { 
      exclusionsLoaded: true, 
      excludedCount: deletedLinkedLaborKeys.size, 
      sampleExcluded: Array.from(deletedLinkedLaborKeys).slice(0, 5) 
    });
    
    // DEMOLITION_WORK_NAMES와 matchDemolitionWorkName은 컴포넌트 레벨에 정의됨 (중복 제거)
    
    // 1. 복구면적 산출표에서 철거공사가 필요한 모든 행 추출 (일반 노무비와 동일하게 공사명별 합산)
    // 같은 공사명은 복구면적을 합산하여 1개 entry만 생성
    // alias canonical 적용: '석고보드' / '석고' 입력 모두 canonical='석고'로 합산되며,
    // 화면 표시명(displayWorkName)은 영역행 원본을 우선 사용 ('석고보드' 그대로 표기)
    type RequiredDemolitionEntry = { 
      matchedWorkName: string; // canonical 공사명 (키/카탈로그 lookup용, 예: '석고')
      displayWorkName: string; // 표시용 공사명 (영역행 원본, 예: '석고보드')
      totalRepairArea: number; // 합산된 복구면적
      sourceRowIds: string[]; // 관련 복구면적 행 ID들
    };
    const demolitionEntryMap = new Map<string, RequiredDemolitionEntry>();
    
    rows.forEach(row => {
      if (row.workType && row.workName && row.workType !== '철거공사') {
        // 연동 제외 공종/공사명은 철거공사 연동도 제외 (일위대가 연동 설정 항목은 허용)
        if (AREA_DISPLAY_ONLY_WORK_TYPES.includes(row.workType) && !isItemInLinkSettings(row.workType, row.workName)) return;
        if (AREA_DISPLAY_ONLY_WORK_NAMES.includes(row.workName) && !isItemInLinkSettings(row.workType, row.workName)) return;
        
        const matchedRaw = matchDemolitionWorkName(row.workName);
        if (matchedRaw) {
          // canonical: '석고보드' → '석고' (DB 매칭/키 일관성용)
          const canonical = DEMOLITION_WORKNAME_ALIASES[matchedRaw] || matchedRaw;
          const rawRepairArea = Number(row.repairArea) || 0;
          const demoCeilingMult = getCeilingMultiplier(row.workType || '', row.location || '');
          const repairArea = Math.round(rawRepairArea * demoCeilingMult * 10) / 10;
          
          if (demolitionEntryMap.has(canonical)) {
            // 기존 entry에 면적 합산
            const existing = demolitionEntryMap.get(canonical)!;
            existing.totalRepairArea += repairArea;
            existing.sourceRowIds.push(row.id);
          } else {
            // 새 entry 생성 (display는 영역행 원본 표기 사용 → 사용자가 입력한 '석고보드' 보존)
            demolitionEntryMap.set(canonical, {
              matchedWorkName: canonical,
              displayWorkName: matchedRaw,
              totalRepairArea: repairArea,
              sourceRowIds: [row.id],
            });
          }
        }
      }
    });
    
    const requiredDemolitionEntries = Array.from(demolitionEntryMap.values());
    
    // 2. 현재 노무비에서 철거공사 행 분석 (laborCostRows 직접 접근)
    // 복합키: matchedWorkName|detailItem (일반 노무비와 동일하게 공사명 기준)
    // 기존 행의 workName도 표준화하여 비교
    type ExistingDemolitionInfo = {
      id: string;
      matchedWorkName: string; // 표준화된 공사명
      detailItem: string;
      isLinkedFromRecovery: boolean;
    };
    const existingDemolitionMap = new Map<string, ExistingDemolitionInfo>(); // key: matchedWorkName|detailItem
    const manualDemolitionKeys = new Set<string>(); // 수동 생성 철거공사 행 키 (보호용)
    
    laborCostRows.forEach(row => {
      if (row.category === '철거공사') {
        // workName을 표준화 + alias canonical 적용 ('석고보드' → '석고')
        // → 기존 저장된 '석고' 행과 새로 표시될 '석고보드' 행이 동일한 key로 매칭됨
        const matchedRaw = matchDemolitionWorkName(row.workName || '') || row.workName || '';
        const matchedWorkName = DEMOLITION_WORKNAME_ALIASES[matchedRaw] || matchedRaw;
        const key = `${matchedWorkName}|${row.detailItem || ''}`;
        
        existingDemolitionMap.set(key, {
          id: row.id,
          matchedWorkName,
          detailItem: row.detailItem || '',
          isLinkedFromRecovery: row.isLinkedFromRecovery || false,
        });
        
        // 수동 생성 행 키 추적 (보호용)
        if (!row.isLinkedFromRecovery) {
          manualDemolitionKeys.add(key);
        }
      }
    });
    
    // 3. 각 철거공사 entry에 대해 필요한 노임항목 조회 (공사명별 합산된 면적 사용)
    type RequiredDemolitionKey = {
      key: string; // matchedWorkName(canonical)|detailItem (일반 노무비와 동일)
      matchedWorkName: string; // canonical (예: '석고')
      displayWorkName: string; // 화면 표시용 (예: '석고보드')
      detailItem: string;
      totalRepairArea: number; // 합산된 복구면적
      sourceRowIds: string[]; // 관련 복구면적 행 ID들
      catalogItem: IlwidaegaCatalogItem;
    };
    const requiredDemolitionKeys: RequiredDemolitionKey[] = [];
    
    requiredDemolitionEntries.forEach(entry => {
      // 일위대가DB에서 canonical 공사명으로 조회 (오버라이드 적용된 값 사용)
      // entry.matchedWorkName은 이미 canonical ('석고') 이므로 DB 매칭 성공
      const items = mergedIlwidaegaCatalog.filter(
        item => normalizeForMatch(item.공종 || '') === normalizeForMatch('철거공사') && 
               normalizeForMatch(item.공사명 || '') === normalizeForMatch(entry.matchedWorkName)
      );
      
      if (items.length > 0) {
        items.forEach(item => {
          const detailItem = item.노임항목 || '보통인부';
          const key = `${entry.matchedWorkName}|${detailItem}`;
          requiredDemolitionKeys.push({
            key,
            matchedWorkName: entry.matchedWorkName,
            displayWorkName: entry.displayWorkName,
            detailItem,
            totalRepairArea: entry.totalRepairArea,
            sourceRowIds: entry.sourceRowIds,
            catalogItem: item,
          });
        });
      } else {
        // 일위대가DB에 없으면 기본 '보통인부' 사용
        const detailItem = '보통인부';
        const key = `${entry.matchedWorkName}|${detailItem}`;
        requiredDemolitionKeys.push({
          key,
          matchedWorkName: entry.matchedWorkName,
          displayWorkName: entry.displayWorkName,
          detailItem,
          totalRepairArea: entry.totalRepairArea,
          sourceRowIds: entry.sourceRowIds,
          catalogItem: { 공종: '철거공사', 공사명: entry.matchedWorkName, 노임항목: '보통인부', 기준작업량: null, 노임단가: null, 일위대가: null },
        });
      }
    });
    
    // 4. 누락된 항목 찾기 (수동 생성 행 보호: 같은 sourceRowId+matchedWorkName+detailItem은 스킵)
    //    + 기존 자동 생성 행의 면적/가격 갱신 대상(stale) 감지
    type StaleDemolitionUpdate = {
      rowId: string;
      D: number; E: number; C: number;
      amount: number; ppsqm: number; quantity: number;
    };
    const missingEntries: RequiredDemolitionKey[] = [];
    const staleEntries: StaleDemolitionUpdate[] = [];
    requiredDemolitionKeys.forEach(entry => {
      // 수동 생성 행이 이미 있으면 스킵 (보호)
      if (manualDemolitionKeys.has(entry.key)) {
        return;
      }
      // 자동 생성 행이 이미 있으면 면적/가격 변경 여부 확인 (수동 변경분은 보존)
      const existing = existingDemolitionMap.get(entry.key);
      if (existing) {
        if (!existing.isLinkedFromRecovery) return; // 수동 행 보호
        const currentRow = laborCostRows.find(r => r.id === existing.id);
        if (!currentRow) return;
        // [2026-05-13] lockedAtSave 가드 완화.
        //   다중 영역행 합산이 lock된 옛값을 못 덮어써서 합계 불일치(철거 도배 보통인부 등)
        //   가 발생함. 합산 면적(C)이 현재 damageArea와 동일하면 자연 skip,
        //   다르면 lock을 무시하고 정합 갱신 (아래 areaDiff/amtDiff 체크가 가드 역할).
        const D = entry.catalogItem.기준작업량 || 0;
        const E = entry.catalogItem.노임단가 || 0;
        const C = entry.totalRepairArea;
        const fixedIlwidaega = Number(entry.catalogItem.일위대가) || 0;
        const isFixed = isFixedIlwidaegaWorkName(entry.matchedWorkName) && fixedIlwidaega > 0 && E > 0;

        // [면적0 보정] 면적 0이면 수량/금액도 0으로 시작 (사용자 요청).
        // 면적 > 0 + D/E 결손이면 기존 1 유지.
        let amt = 0, ppsqm = 0, qty = C > 0 ? 1 : 0;
        if (isFixed) {
          amt = fixedIlwidaega;
          ppsqm = E;
          qty = Math.round((fixedIlwidaega / E) * 10) / 10;
        } else if (D > 0 && E > 0 && C > 0) {
          amt = calculateIWithTiers(C, D, E, laborRateTiers);
          ppsqm = calculateAppliedUnitPriceWithTiers(C, D, E, laborRateTiers);
          qty = calculateQuantityWithTiers(C, D, E, laborRateTiers);
        }

        const areaDiff = Math.abs((currentRow.damageArea || 0) - C) > 0.01;
        const amtDiff = Math.abs((currentRow.amount || 0) - amt) > 0.5;
        const ppsqmDiff = Math.abs((currentRow.pricePerSqm || 0) - ppsqm) > 0.5;
        const qtyDiff = Math.abs((currentRow.quantity || 0) - qty) > 0.01;
        const stdPriceDiff = (currentRow.standardPrice || 0) !== E;
        const stdQtyDiff = (currentRow.standardWorkQuantity || 0) !== D;

        // [2026-05-13] lock 행은 areaDiff(또는 표준값 D/E 변경)일 때만 갱신.
        //   수동 편집된 amount/qty/ppsqm는 보존.
        const shouldUpdate = currentRow.lockedAtSave
          ? (areaDiff || stdPriceDiff || stdQtyDiff)
          : (areaDiff || amtDiff || ppsqmDiff || qtyDiff || stdPriceDiff || stdQtyDiff);

        if (shouldUpdate) {
          staleEntries.push({ rowId: existing.id, D, E, C, amount: amt, ppsqm, quantity: qty });
        }
        return;
      }
      // 수동 삭제된 철거공사 행은 재생성하지 않음 (sourceRowId 기반 체크)
      // 모든 sourceRowIds가 삭제 목록에 있으면 건너뛰기, 하나라도 없으면 생성
      const deletionKeyChecks: { srcId: string; key: string; exists: boolean }[] = [];
      const allSourceRowsDeleted = entry.sourceRowIds.every(srcId => {
        const deletionKey = makeLinkedLaborDeletionKey(srcId, '철거공사', entry.matchedWorkName, entry.detailItem);
        const exists = deletedLinkedLaborKeys.has(deletionKey);
        deletionKeyChecks.push({ srcId, key: deletionKey, exists });
        return exists;
      });
      
      // [디버그] 삭제 키 체크 결과 로깅
      console.log('DEMOLITION_DELETION_KEY_CHECK', {
        matchedWorkName: entry.matchedWorkName,
        detailItem: entry.detailItem,
        sourceRowIds: entry.sourceRowIds,
        checks: deletionKeyChecks,
        allDeleted: allSourceRowsDeleted,
        deletedKeysCount: deletedLinkedLaborKeys.size,
        deletedKeysSample: Array.from(deletedLinkedLaborKeys).slice(0, 10)
      });
      
      if (allSourceRowsDeleted && entry.sourceRowIds.length > 0) {
        // [증거 3] SKIP_CREATE_DEMOLITION_LABOR - 삭제된 키로 인해 생성 스킵
        console.log('SKIP_CREATE_DEMOLITION_LABOR', { 
          sourceRowIds: entry.sourceRowIds, 
          matchedWorkName: entry.matchedWorkName, 
          detailItem: entry.detailItem 
        });
        return;
      }
      missingEntries.push(entry);
    });
    
    // 5. 불필요한 자동생성 행 찾기 (더 이상 필요하지 않은 행)
    const requiredKeySet = new Set(requiredDemolitionKeys.map(e => e.key));
    const orphanedIds: string[] = [];
    
    laborCostRows.forEach(row => {
      if (row.isLinkedFromRecovery && row.category === '철거공사') {
        // 동일한 표준화 + alias canonical 로직 사용 (matchedWorkName|detailItem 기준)
        // → '석고' 행이 '석고보드' 입력에 의해 orphan 오판되는 버그 방지
        const matchedRaw = matchDemolitionWorkName(row.workName || '') || row.workName || '';
        const matchedWorkName = DEMOLITION_WORKNAME_ALIASES[matchedRaw] || matchedRaw;
        const key = `${matchedWorkName}|${row.detailItem || ''}`;
        if (!requiredKeySet.has(key)) {
          orphanedIds.push(row.id);
        }
      }
    });
    
    // 무한 루프 방지: 현재 상태 스냅샷 키 생성 (stale 정보 포함하여 가격/면적 변경도 감지)
    const stateKey = [
      requiredDemolitionKeys.map(e => e.key).sort().join(','),
      missingEntries.map(e => e.key).sort().join(','),
      orphanedIds.sort().join(','),
      staleEntries.map(s => `${s.rowId}:${s.amount}:${s.C}:${s.E}:${s.D}`).sort().join(',')
    ].join('|');
    
    // 변경이 없거나 이미 처리된 상태면 조기 종료
    if (demolitionReconcileRef.current === stateKey) {
      demolitionPendingRef.current = false;
      return;
    }
    
    // 실제 변경이 없으면 ref만 업데이트하고 종료
    if (missingEntries.length === 0 && orphanedIds.length === 0 && staleEntries.length === 0) {
      demolitionReconcileRef.current = stateKey;
      demolitionPendingRef.current = false;
      return;
    }
    
    // 이미 업데이트가 예약되어 있으면 스킵 (queueMicrotask 중복 방지)
    if (demolitionPendingRef.current) {
      return;
    }
    
    console.log('[철거공사 Reconcile] 상태 변경 감지');
    console.log('[철거공사 Reconcile] 필요 키:', requiredDemolitionKeys.map(e => e.key));
    console.log('[철거공사 Reconcile] 누락 항목:', missingEntries.map(e => e.key));
    console.log('[철거공사 Reconcile] 불필요 ID:', orphanedIds);
    
    // ref 먼저 업데이트 및 pending 플래그 설정
    demolitionReconcileRef.current = stateKey;
    demolitionPendingRef.current = true;
    
    queueMicrotask(() => {
      demolitionPendingRef.current = false;
      
      lastLaborSetSourceRef.current = 'demolitionReconcile';
      setLaborCostRows(prev => {
        let updatedRows = [...prev];
        
        // 6. 불필요한 자동생성 철거공사 행 제거
        if (orphanedIds.length > 0) {
          const orphanedIdSet = new Set(orphanedIds);
          updatedRows = updatedRows.filter(row => {
            if (orphanedIdSet.has(row.id)) {
              console.log('[철거공사 Reconcile] 삭제:', row.workName, row.detailItem);
              return false;
            }
            return true;
          });
        }
        
        // 6.5 자동 생성 행의 면적/가격 갱신 (수동 변경분은 manualDemolitionKeys로 이미 제외됨)
        if (staleEntries.length > 0) {
          const staleMap = new Map(staleEntries.map(s => [s.rowId, s]));
          updatedRows = updatedRows.map(row => {
            const s = staleMap.get(row.id);
            if (!s) return row;
            console.log('[철거공사 Reconcile] 갱신:', row.workName, row.detailItem, '면적', row.damageArea, '→', s.C, '합계', row.amount, '→', s.amount);
            return {
              ...row,
              damageArea: s.C,
              standardPrice: s.E,
              standardWorkQuantity: s.D,
              quantity: s.quantity,
              pricePerSqm: s.ppsqm,
              amount: s.amount,
            };
          });
        }
        
        // 7. 누락된 철거공사 행 생성 (일반 노무비와 동일하게 공사명별 1개 행, 합산 면적으로 I 계산)
        const newDemolitionRows: LaborCostRow[] = [];
        
        missingEntries.forEach(entry => {
          const { matchedWorkName, displayWorkName, detailItem, totalRepairArea, sourceRowIds, catalogItem } = entry;
          
          const D = catalogItem.기준작업량 || 0;
          const E = catalogItem.노임단가 || 0;
          const C = totalRepairArea; // 합산된 면적 사용
          const fixedIlwidaega = Number(catalogItem.일위대가) || 0;
          const isFixed = isFixedIlwidaegaWorkName(matchedWorkName) && fixedIlwidaega > 0 && E > 0;

          let calculatedAmount = 0;
          let calculatedPricePerSqm = 0;
          // [면적0 보정] 면적 0이면 수량 0으로 시작 (사용자 요청).
          // 면적 > 0 + D/E 결손이면 기존 1 유지.
          let calculatedQuantity = C > 0 ? 1 : 0;
          if (isFixed) {
            // FIXED: 합계=일위대가(DB), 적용단가=노임단가(E), 수량=합계/E
            calculatedAmount = fixedIlwidaega;
            calculatedPricePerSqm = E;
            calculatedQuantity = Math.round((fixedIlwidaega / E) * 10) / 10;
          } else if (D > 0 && E > 0 && C > 0) {
            calculatedAmount = calculateIWithTiers(C, D, E, laborRateTiers);
            calculatedPricePerSqm = calculateAppliedUnitPriceWithTiers(C, D, E, laborRateTiers);
            calculatedQuantity = calculateQuantityWithTiers(C, D, E, laborRateTiers);
          }
          
          // uniqueId는 canonical 키로 (중복 방지 일관성)
          const uniqueId = `demolition-${matchedWorkName}-${detailItem.replace(/\s+/g, '')}`;
          
          if (updatedRows.some(r => r.id === uniqueId) || newDemolitionRows.some(r => r.id === uniqueId)) {
            return;
          }
          
          newDemolitionRows.push({
            id: uniqueId,
            sourceAreaRowId: `demolition-${sourceRowIds.join(',')}`,
            isLinkedFromRecovery: true,
            sourceWorkType: '철거공사',
            place: '',
            position: '',
            category: '철거공사',
            // 화면 표시는 영역행 원본 (예: '석고보드') — 사용자가 입력한 표기 유지
            workName: displayWorkName || matchedWorkName,
            detailWork: '일위대가',
            detailItem: detailItem,
            priceStandard: '',
            unit: '㎡',
            standardPrice: E,
            standardWorkQuantity: D,
            quantity: calculatedQuantity,
            applicationRates: { ceiling: false, wall: false, floor: false, molding: false },
            salesMarkupRate: 0,
            pricePerSqm: calculatedPricePerSqm,
            damageArea: C,
            deduction: 0,
            includeInEstimate: true,
            request: '',
            amount: calculatedAmount,
          });
          
          console.log('[철거공사 Reconcile] 생성:', '철거공사', matchedWorkName, detailItem, '면적:', C);
        });
        
        return [...updatedRows, ...newDemolitionRows];
      });
    });
  }, [rows, laborCostRows, mergedIlwidaegaCatalog, deletedLinkedLaborKeys, exclusionsLoaded, laborRateTiers, isAutoSyncEligibleCase, isPartner, currentUser]); // laborCostRows, 노임단가 비율, exclusionsLoaded 포함 + cutoff 적용 대상 변화 감지 + 협력업체 가드

  // ========== 일반 노무비(비-철거) 면적 집계 Reconcile useEffect ==========
  // 같은 workType+workName 의 복구면적 산출표 행들이 여러 개일 때,
  // 자동연동된 단일 노무비 행에 면적 합계를 반영(C 갱신)하고 산식으로 합계 재계산.
  // 산식 자체는 그대로(shared/labor-rate-tiers-utils.ts 미수정), C 입력값만 보정.
  const laborAggregationRef = useRef<string>('');
  const laborAggregationPendingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isAutoSyncEligibleCase) return;
    if (!exclusionsLoaded) return;
    if (!mergedIlwidaegaCatalog || mergedIlwidaegaCatalog.length === 0) return;
    if (syncGuardRef.current) return;
    if (!laborCostRows || laborCostRows.length === 0) return;

    // 1. 비-철거 영역행을 (laborCategory|workName)별로 합산
    type AggregatedAreaEntry = {
      workType: string;
      workName: string;
      laborCategory: string;
      totalArea: number;
      sourceRowIds: string[];
    };
    const areaMap = new Map<string, AggregatedAreaEntry>();

    rows.forEach(areaRow => {
      if (!areaRow.workType || !areaRow.workName) return;
      if (areaRow.workType === '철거공사') return; // 철거는 별도 reconcile에서 합산 처리
      if (isFixedIlwidaegaWorkName(areaRow.workName)) return; // FIXED는 위치별 행 유지
      if (AREA_DISPLAY_ONLY_WORK_TYPES.includes(areaRow.workType) && !isItemInLinkSettings(areaRow.workType, areaRow.workName)) return;
      if (AREA_DISPLAY_ONLY_WORK_NAMES.includes(areaRow.workName) && !isItemInLinkSettings(areaRow.workType, areaRow.workName)) return;

      const rawArea = Number(areaRow.repairArea) || 0;
      if (rawArea <= 0) return;
      const ceilingMult = getCeilingMultiplier(areaRow.workType, areaRow.location || '');
      const adjArea = rawArea * ceilingMult;
      const laborCategory = getLaborCategory(areaRow.workType, areaRow.workName);
      const key = `${laborCategory}|${areaRow.workName}`;

      const existing = areaMap.get(key);
      if (existing) {
        existing.totalArea = Math.round((existing.totalArea + adjArea) * 10) / 10;
        existing.sourceRowIds.push(areaRow.id);
      } else {
        areaMap.set(key, {
          workType: areaRow.workType,
          workName: areaRow.workName,
          laborCategory,
          totalArea: Math.round(adjArea * 10) / 10,
          sourceRowIds: [areaRow.id],
        });
      }
    });

    // 2. 갱신 대상 노무비 행 수집
    type LaborStaleUpdate = {
      rowId: string;
      C: number;
      amount: number;
      pricePerSqm: number;
      quantity: number;
    };
    const staleUpdates: LaborStaleUpdate[] = [];

    laborCostRows.forEach(laborRow => {
      if (!laborRow.isLinkedFromRecovery) return;
      // [2026-05-13] lockedAtSave 가드 제거.
      //   합산 면적(C)이 현재 row.damageArea와 다를 때만 staleUpdates에 push되므로
      //   수동 편집된 lock 행도 영역행 합산 결과와 동일하면 자연 skip된다(아래 areaDiff 체크).
      //   다중 영역행이 단일 노무비에 합산되어야 하는데 lock 때문에 옛값이 그대로 남는
      //   문제(반자틀/도배공 합계 불일치) 해결.
      if (laborRow.category === '철거공사') return;
      if (!laborRow.sourceAreaRowId) return;
      if (laborRow.sourceAreaRowId.startsWith('demolition-')) return;
      if (isFixedIlwidaegaWorkName(laborRow.workName || '')) return; // FIXED는 위치별 유지

      // 바탕만들기 동반행: 자신의 workName(예: '바탕만들기')이 아닌 부모 공사명으로 매칭
      const isBatang = laborRow.sourceAreaRowId.includes('::batang');
      const lookupWorkName = isBatang
        ? (Object.entries(BATANG_COMPANION_MAP).find(([, v]) => v === (laborRow.workName || ''))?.[0] || '')
        : (laborRow.workName || '');
      if (!lookupWorkName) return;

      const key = `${laborRow.category || ''}|${lookupWorkName}`;
      const aggregated = areaMap.get(key);
      if (!aggregated) return;
      if (aggregated.sourceRowIds.length <= 1) return; // 단일 영역행이면 기존 값과 동일 → skip

      const C = aggregated.totalArea;
      const D = laborRow.standardWorkQuantity || 0;
      const E = laborRow.standardPrice || 0;

      let newAmount = 0, newPpsqm = 0, newQty = C > 0 ? 1 : 0;
      if (D > 0 && E > 0 && C > 0) {
        newAmount = calculateIWithTiers(C, D, E, laborRateTiers);
        newPpsqm = calculateAppliedUnitPriceWithTiers(C, D, E, laborRateTiers);
        newQty = calculateQuantityWithTiers(C, D, E, laborRateTiers);
      }

      const areaDiff = Math.abs((laborRow.damageArea || 0) - C) > 0.01;
      const amtDiff = Math.abs((laborRow.amount || 0) - newAmount) > 0.5;
      const ppsqmDiff = Math.abs((laborRow.pricePerSqm || 0) - newPpsqm) > 0.5;
      const qtyDiff = Math.abs((laborRow.quantity || 0) - newQty) > 0.01;

      // [2026-05-13] lock 행은 areaDiff일 때만 갱신 (수동 편집된 amount/qty/ppsqm 보존).
      //   비-lock 행은 산식 정합 위해 어떤 차이라도 갱신.
      const shouldUpdate = laborRow.lockedAtSave
        ? areaDiff
        : (areaDiff || amtDiff || ppsqmDiff || qtyDiff);

      if (shouldUpdate) {
        staleUpdates.push({ rowId: laborRow.id, C, amount: newAmount, pricePerSqm: newPpsqm, quantity: newQty });
      }
    });

    // 3. 무한 루프 방지 stateKey
    const stateKey = staleUpdates.map(s => `${s.rowId}:${s.C.toFixed(2)}:${s.amount}:${s.quantity.toFixed(2)}:${s.pricePerSqm}`).sort().join('|');
    if (laborAggregationRef.current === stateKey) return;

    if (staleUpdates.length === 0) {
      laborAggregationRef.current = stateKey;
      return;
    }
    if (laborAggregationPendingRef.current) return;

    laborAggregationRef.current = stateKey;
    laborAggregationPendingRef.current = true;

    queueMicrotask(() => {
      laborAggregationPendingRef.current = false;
      const updateMap = new Map(staleUpdates.map(s => [s.rowId, s]));
      lastLaborSetSourceRef.current = 'laborAggregation';
      setLaborCostRows(prev => prev.map(row => {
        const u = updateMap.get(row.id);
        if (!u) return row;
        console.log('[노무비 집계] 갱신:', row.workName, '/', row.detailItem,
          '면적', row.damageArea, '→', u.C,
          '합계', row.amount, '→', u.amount);
        return {
          ...row,
          damageArea: u.C,
          quantity: u.quantity,
          pricePerSqm: u.pricePerSqm,
          amount: u.amount,
        };
      }));
    });
  }, [rows, laborCostRows, mergedIlwidaegaCatalog, exclusionsLoaded, laborRateTiers, isAutoSyncEligibleCase, isPartner, currentUser]);

  // 최신 견적 가져오기
  // [핑퐁 차단 2026-05-11] 협력업체 30초 폴링 제거.
  //   관리자/협력업체가 동시에 화면을 열고 있을 때 협력업체 측이 30초마다 DB를 다시 읽고
  //   sync 분기가 다시 돌아 자동저장 → 관리자 변경분이 즉시 협력업체 sync 결과로 덮어써지는
  //   "DB 차원 핑퐁"의 핵심 원인. 양측 모두 케이스당 1회 hydrate로 통일.
  //   상대편 변경 반영은 새로고침/재진입 시점에만 발생.
  const { data: latestEstimate, isLoading: isLoadingEstimate } = useQuery<{ estimate: any; rows: any[] }>({
    queryKey: ["/api/estimates", selectedCaseId, "latest"],
    enabled: !!selectedCaseId,
  });

  // 제출 조건 상태 계산 (견적 완료 상태)
  const isEstimateComplete = useMemo(() => {
    return !isLoadingEstimate && !!latestEstimate && typeof latestEstimate === 'object' && 'estimate' in latestEstimate && !!latestEstimate.estimate;
  }, [latestEstimate, isLoadingEstimate]);

  const canSubmitAll = isFieldInputComplete && isDrawingComplete && isDocumentsComplete && isEstimateComplete;

  // 관련 케이스 견적서 확인 (같은 사고번호의 다른 케이스에 견적서가 있는지)
  const { data: relatedEstimateInfo } = useQuery<{
    hasRelatedEstimate: boolean;
    sourceCaseId?: string;
    sourceCaseNumber?: string;
  }>({
    queryKey: ["/api/cases", selectedCaseId, "related-estimate"],
    enabled: !!selectedCaseId && !latestEstimate?.estimate && !isLoadingEstimate,
  });

  // 견적서 복제 mutation
  const cloneEstimateMutation = useMutation({
    mutationFn: async (sourceCaseId: string) => {
      const response = await apiRequest("POST", `/api/cases/${selectedCaseId}/clone-estimate`, {
        sourceCaseId,
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "견적서 복제 실패");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", selectedCaseId, "latest"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", selectedCaseId, "related-estimate"] });
      toast({
        title: "견적서 복제 완료",
        description: "관련 케이스의 견적서가 복제되었습니다.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "견적서 복제 실패",
        description: error.message || "알 수 없는 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 현재 작성중인 건 정보를 견적서에 자동 설정
  // selectedCase가 변경되면 estimateCase도 항상 업데이트 (고객정보 즉시 반영)
  useEffect(() => {
    if (selectedCase) {
      setEstimateCase(selectedCase);
    }
  }, [selectedCase]);

  // 초기 빈 행 생성 또는 견적 불러오기
  useEffect(() => {
    // Query가 resolve될 때까지 대기 (undefined 상태 skip)
    if (latestEstimate === undefined) return;
    
    // Hydration이 이미 완료되었거나, 케이스가 선택되지 않았으면 skip
    // [Bug fix 2026-05-06] 협력사 자동저장 허용 후, 협력사 재hydrate 분기를 제거.
    //   기존 분기(`isHydratedRef && !isPartner`)는 관리자 신규 저장값이 협력사에 즉시
    //   보이게 하려는 의도였으나, 자동저장 onSuccess가 invalidate→refetch를 트리거하면
    //   사용자가 막 입력한 값/샘플 초기화 상태를 DB값으로 덮어써 무한 루프(폭주)를 일으킴.
    //   협력사 화면도 "케이스당 1회 hydrate"로 통일 — 관리자 변경 반영은 새로고침/재진입 시.
    if (isHydratedRef.current || !selectedCaseId) return;
    
    // 마스터 데이터가 로드될 때까지 대기
    if (masterDataList.length === 0) return;
    
    if (latestEstimate) {
      // 소수점 첫째자리 형식으로 변환 (예: "2" -> "2.0")
      const toDecimalFormat = (val: any): string => {
        const num = parseFloat(val);
        if (isNaN(num)) return "0.0";
        return num.toFixed(1);
      };
      
      let loadedRows: any[] = [];
      
      // 복구면적 산출표 데이터 불러오기
      if (latestEstimate.rows && latestEstimate.rows.length > 0) {
        // [E] 프론트엔드 로깅: API 응답 데이터 확인
        console.log("========================================");
        console.log("[E] 프론트엔드: latestEstimate.rows[0] API 응답 원본");
        console.log("  repairWidth:", latestEstimate.rows[0].repairWidth, "타입:", typeof latestEstimate.rows[0].repairWidth);
        console.log("  repairHeight:", latestEstimate.rows[0].repairHeight, "타입:", typeof latestEstimate.rows[0].repairHeight);
        console.log("  repairArea:", latestEstimate.rows[0].repairArea, "타입:", typeof latestEstimate.rows[0].repairArea);
        console.log("========================================");
        
        loadedRows = latestEstimate.rows.map((row: any) => ({
          id: `row-${row.id}`,
          category: row.category || (roomCategories[0] || ""),
          location: row.location || (locations[0] || ""),
          workType: row.workType || "",
          workName: row.workName || (workNames[0] || ""),
          damageWidth: toDecimalFormat(row.damageWidth),
          damageHeight: toDecimalFormat(row.damageHeight),
          damageArea: row.damageArea ? parseFloat(row.damageArea).toFixed(2) : "0",
          repairWidth: toDecimalFormat(row.repairWidth),
          repairHeight: toDecimalFormat(row.repairHeight),
          repairArea: row.repairArea ? parseFloat(row.repairArea).toFixed(2) : "0",
          note: row.note || "",
        }));
        
        // [F] 프론트엔드 로깅: 변환 후 데이터 확인
        console.log("========================================");
        console.log("[F] 프론트엔드: loadedRows[0] 변환 후");
        console.log("  repairWidth:", loadedRows[0].repairWidth, "타입:", typeof loadedRows[0].repairWidth);
        console.log("  repairHeight:", loadedRows[0].repairHeight, "타입:", typeof loadedRows[0].repairHeight);
        console.log("  repairArea:", loadedRows[0].repairArea, "타입:", typeof loadedRows[0].repairArea);
        console.log("========================================");
        
        setRows(loadedRows);
        
        // 기존 workType 값을 customWorkTypes에 추가
        const existingWorkTypes = latestEstimate.rows
          .map((row: any) => row.workType)
          .filter((wt: string) => wt && wt.trim() !== '');
        const uniqueWorkTypes = Array.from(new Set(existingWorkTypes)) as string[];
        if (uniqueWorkTypes.length > 0) {
          setCustomWorkTypes(prev => {
            const combined = Array.from(new Set([...prev, ...uniqueWorkTypes]));
            return combined;
          });
        }
        
        // 기존 workName 값을 customWorkNames에 추가 (마스터 데이터에 없는 것만)
        const existingWorkNames = latestEstimate.rows
          .map((row: any) => row.workName)
          .filter((wn: string) => wn && wn.trim() !== '');
        const uniqueWorkNames = Array.from(new Set(existingWorkNames)) as string[];
        if (uniqueWorkNames.length > 0) {
          setCustomWorkNames(prev => {
            const combined = Array.from(new Set([...prev, ...uniqueWorkNames]));
            return combined;
          });
        }
      } else {
        // 복구면적 데이터가 없으면 빈 행 생성
        addRow();
      }
      
      // 노무비 데이터 불러오기
      if (latestEstimate.estimate?.laborCostData && Array.isArray(latestEstimate.estimate.laborCostData)) {
        const loadedLaborRows = latestEstimate.estimate.laborCostData.map((row: any, index: number) => {
          const { rowIndex, ...rest } = row; // rowIndex 제거
          // 결정적 ID 사용: rowIndex 기반으로 일관된 ID 생성 (모든 뷰에서 동일)
          const stableIndex = typeof rowIndex === 'number' ? rowIndex : index;
          
          // 걸레받이는 일위대가 DB에서 조회해야 하므로 detailWork 수정 (마이그레이션)
          let fixedDetailWork = rest.detailWork;
          if (rest.workName === '걸레받이' && rest.detailWork === '노무비') {
            fixedDetailWork = '일위대가';
          }
          
          return {
            id: `labor-saved-${stableIndex}`,
            ...rest,
            detailWork: fixedDetailWork,
            includeInEstimate: rest.includeInEstimate === false || rest.includeInEstimate === "false" ? false : true,
            isDetailItemDirectInput: rest.isDetailItemDirectInput || false,
          };
        });
        const remappedLaborRows = loadedLaborRows.map((laborRow: any) => {
          if (!laborRow.sourceAreaRowId || !laborRow.isLinkedFromRecovery) return laborRow;
          
          if (loadedRows.some((r: any) => r.id === laborRow.sourceAreaRowId)) return laborRow;
          
          const isBatangHydrate = laborRow.sourceAreaRowId.includes('::batang');
          const strippedSourceId = isBatangHydrate ? laborRow.sourceAreaRowId.replace(/::batang$/, '') : laborRow.sourceAreaRowId;
          
          if (isBatangHydrate && loadedRows.some((r: any) => r.id === strippedSourceId)) return laborRow;
          
          if (laborRow.sourceAreaRowId.startsWith('demolition-')) {
            const rawIds = laborRow.sourceAreaRowId.replace('demolition-', '');
            const alreadyValid = rawIds.split(',').some((srcId: string) =>
              loadedRows.some((r: any) => r.id === srcId)
            );
            if (alreadyValid) return laborRow;
            
            const matchingAreaRows = loadedRows.filter((areaRow: any) => {
              const matchedName = matchDemolitionWorkName(areaRow.workName || '');
              return matchedName && normalizeForMatch(matchedName) === normalizeForMatch(laborRow.workName || '');
            });
            if (matchingAreaRows.length > 0) {
              return { ...laborRow, sourceAreaRowId: 'demolition-' + matchingAreaRows.map((r: any) => r.id).join(',') };
            }
          } else if (isBatangHydrate) {
            const parentWorkName = Object.entries(BATANG_COMPANION_MAP).find(([, v]) => v === laborRow.workName)?.[0];
            if (parentWorkName) {
              const matchingAreaRow = loadedRows.find((areaRow: any) =>
                normalizeForMatch(areaRow.workName || '') === normalizeForMatch(parentWorkName)
              );
              if (matchingAreaRow) {
                return { ...laborRow, sourceAreaRowId: `${matchingAreaRow.id}::batang` };
              }
            }
          } else {
            const matchingAreaRow = loadedRows.find((areaRow: any) =>
              normalizeForMatch(areaRow.workName || '') === normalizeForMatch(laborRow.workName || '')
            );
            if (matchingAreaRow) {
              return { ...laborRow, sourceAreaRowId: matchingAreaRow.id };
            }
          }
          return laborRow;
        });
        lastLaborSetSourceRef.current = 'hydration';
        setLaborCostRows(sortLaborRowsByCategory(remappedLaborRows));
        
        // 자재비 데이터 불러오기 (노무비 ID 매핑 후)
        // materialCostData가 객체(새 형식: {rows, vatIncluded}) 또는 배열(기존 형식)일 수 있음
        const materialData = latestEstimate.estimate?.materialCostData;
        const materialRowsData = Array.isArray(materialData) 
          ? materialData 
          : (materialData?.rows || []);
        
        if (materialRowsData.length > 0) {
          const loadedMaterialRows = materialRowsData.map((row: any, index: number) => {
            const { sourceLaborRowIndex, ...rest } = row; // sourceLaborRowIndex 제거
            
            // sourceLaborRowIndex를 사용하여 새로운 laborRow의 ID로 매핑
            const sourceLaborRowId = 
              typeof sourceLaborRowIndex === 'number' && sourceLaborRowIndex >= 0 
                ? loadedLaborRows[sourceLaborRowIndex]?.id 
                : undefined;
            
            // [Orphan 보호] 저장 시점에 sourceLaborRowIndex가 있었지만 노무비 행이 사라져 매칭 실패한 자재 행은
            // 자동행(isAutoGenerated=true) 상태로 두면 reconcile에서 stale로 판단해 삭제될 위험.
            // → 수동행으로 다운그레이드하여 보존 (사용자가 입력한 자재 정보 유실 방지).
            const isOrphan =
              typeof sourceLaborRowIndex === 'number' && sourceLaborRowIndex >= 0 && !sourceLaborRowId;
            const safeRest = isOrphan
              ? { ...rest, isAutoGenerated: false, isLinkedFromRecovery: false, autoKey: undefined }
              : rest;
            if (isOrphan) {
              console.log('[Hydration] orphan 자재행 보호 - 수동행으로 보존:', rest.공종, rest.공사명, rest.자재항목);
            }
            
            // 결정적 ID 사용: 인덱스 기반으로 일관된 ID 생성 (모든 뷰에서 동일)
            return {
              id: `material-saved-${index}`,
              ...safeRest,
              includeInEstimate: rest.includeInEstimate === false || rest.includeInEstimate === "false" ? false : true,
              sourceLaborRowId,
            };
          });
          setMaterialRows(loadedMaterialRows);
        }

        // VAT 포함/별도 옵션 복원 (새 형식에서는 materialCostData.vatIncluded에 저장)
        if (materialData?.vatIncluded !== undefined) {
          setVatIncluded(materialData.vatIncluded);
        }
      } else if (latestEstimate.estimate?.materialCostData) {
        // 노무비 데이터는 없지만 자재비 데이터만 있는 경우
        const materialData = latestEstimate.estimate.materialCostData;
        const materialRowsData = Array.isArray(materialData) 
          ? materialData 
          : (materialData?.rows || []);
        
        if (materialRowsData.length > 0) {
          const loadedMaterialRows = materialRowsData.map((row: any, index: number) => {
            const { sourceLaborRowIndex, ...rest } = row;
            // 결정적 ID 사용: 인덱스 기반으로 일관된 ID 생성
            return {
              id: `material-saved-${index}`,
              ...rest,
              includeInEstimate: rest.includeInEstimate === false || rest.includeInEstimate === "false" ? false : true,
              sourceLaborRowId: undefined,
            };
          });
          setMaterialRows(loadedMaterialRows);
        }

        // VAT 포함/별도 옵션 복원
        if (materialData?.vatIncluded !== undefined) {
          setVatIncluded(materialData.vatIncluded);
        }
      }

      // Hydration 완료 표시 (노무비-자재비 동기화 활성화)
      isHydratedRef.current = true;
      setIsHydratedState(true);
      // 자동 동기화 활성화 - 데이터 로드 완료 후 새 행 생성 허용
      skipAutoSyncRef.current = false;
    } else {
      // 견적 데이터가 아예 없으면 빈 행만 생성
      addRow();
      isHydratedRef.current = true;
      setIsHydratedState(true);
      skipAutoSyncRef.current = false;
    }
  }, [latestEstimate, masterDataList, selectedCaseId, isPartner, currentUser]);

  // 소수점 첫째자리 형식으로 변환하는 함수 (예: "2" -> "2.0", "2.5" -> "2.5")
  const formatDecimal = (value: string): string => {
    const num = parseFloat(value);
    if (isNaN(num)) return "0.0";
    return num.toFixed(1);
  };

  // 빈 행 생성 함수 - 모든 선택 필드는 빈 값으로 시작
  const createBlankRow = (): AreaCalculationRow => ({
    id: `row-${Date.now()}-${Math.random()}`,
    category: "",
    location: "",
    workType: "",
    workName: "",
    damageWidth: "0.0",
    damageHeight: "0.0",
    damageArea: "0",
    repairWidth: "0.0",
    repairHeight: "0.0",
    repairArea: "0",
    note: "",
  });

  // 행 추가 (기존 호환성 유지)
  const addRow = () => {
    if (isReadOnly) return;
    setRows(prev => [...prev, createBlankRow()]);
  };

  // 위치 정렬 순서 (천장 → 벽면 → 바닥)
  const locationSortOrder: Record<string, number> = {
    '천장': 1,
    '벽면': 2,
    '바닥': 3,
  };
  
  // 위치 기준 정렬 함수
  const getLocationOrder = (location: string): number => {
    return locationSortOrder[location] || 99; // 정의되지 않은 위치는 맨 뒤로
  };

  // 장소 그룹화 헬퍼 함수 - 동일 장소를 그룹으로 묶고, 위치(천장/벽면/바닥) 순 정렬
  const groupRowsByCategory = (rowList: AreaCalculationRow[]) => {
    // 1. 먼저 장소별로 그룹화
    const categoryMap = new Map<string, AreaCalculationRow[]>();
    
    rowList.forEach((row) => {
      const category = row.category || '';
      if (!categoryMap.has(category)) {
        categoryMap.set(category, []);
      }
      categoryMap.get(category)!.push(row);
    });
    
    // 2. 각 그룹 내에서 위치(천장, 벽면, 바닥) 순으로 정렬
    const groups: { category: string; rows: AreaCalculationRow[]; startIndex: number }[] = [];
    let startIndex = 0;
    
    categoryMap.forEach((categoryRows, category) => {
      // 1차: 위치 기준 정렬 (천장 → 벽면 → 바닥), 2차: 공종db 순서
      const getWorkTypeOrder = (wt: string): number => {
        const idx = VICTIM_RECOVERY_ORDER.indexOf(wt || '');
        return idx === -1 ? 999 : idx;
      };
      const sortedRows = [...categoryRows].sort((a, b) => {
        const locDiff = getLocationOrder(a.location) - getLocationOrder(b.location);
        if (locDiff !== 0) return locDiff;
        return getWorkTypeOrder(a.workType) - getWorkTypeOrder(b.workType);
      });
      
      groups.push({ 
        category, 
        rows: sortedRows, 
        startIndex 
      });
      startIndex += sortedRows.length;
    });
    
    return groups;
  };

  // 장소 추가 (새 장소 그룹 추가)
  const addLocation = () => {
    if (isReadOnly) return;
    setRows(prev => [...prev, createBlankRow()]);
  };

  // 대물피해 샘플 템플릿 적용 - 확인 다이얼로그용 pending state
  const [pendingSampleKey, setPendingSampleKey] = useState<string | null>(null);

  const applySampleTemplate = (key: string) => {
    const template = PROPERTY_DAMAGE_SAMPLE_TEMPLATES.find(t => t.key === key);
    if (!template) return;
    const baseTs = Date.now();
    const newRows: AreaCalculationRow[] = template.rows.map((seed, idx) => ({
      ...createBlankRow(),
      id: `row-${baseTs}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
      category: seed.category,
      location: seed.location,
      workType: seed.workType,
      workName: seed.workName,
    }));
    // 복구면적 산출표 탭으로 이동 후 행 전체 교체
    setSelectedCategory("복구면적 산출표");
    setRows(newRows);
    setSelectedRows(new Set());
    // [샘플 재적용] 연동된 노무비/자재비/견적서까지 모두 초기화 → 새 면적 행에 따라 자동 재연동.
    //   견적서는 laborCostRows + materialRows 합산으로 자동 계산되므로 둘만 비우면 0이 됨.
    //   메모리 삭제 키도 비워서 새 면적 항목들이 막히지 않도록 한다 (DB 삭제 키는 별도 유지).
    setLaborCostRows([createBlankLaborRow()]);
    setSelectedLaborRows(new Set());
    setMaterialRows([createBlankMaterialRow()]);
    setSelectedMaterialRows(new Set());
    if (deletedLinkedLaborKeys.size > 0) {
      setDeletedLinkedLaborKeys(new Set());
    }
    console.log("[샘플 적용] 대물피해 샘플 템플릿 적용:", template.label, `${newRows.length}행 (노무비/자재비/견적서 초기화)`);
  };

  const handleSampleConfirm = () => {
    if (pendingSampleKey) {
      applySampleTemplate(pendingSampleKey);
    }
    setPendingSampleKey(null);
  };

  // 손해방지(원인세대) 샘플 적용 - 노무비/자재비 동시 교체
  const [pendingLossSampleKey, setPendingLossSampleKey] = useState<string | null>(null);

  const applyLossPreventionSampleTemplate = (key: string) => {
    const template = LOSS_PREVENTION_SAMPLE_TEMPLATES.find(t => t.key === key);
    if (!template) return;
    const baseTs = Date.now();
    const newLaborRows: LaborCostRow[] = template.laborRows.map((seed, idx) => {
      // 1) 일위대가 카탈로그 매칭 (공종+공사명+노임항목)
      let ilwiItem = mergedIlwidaegaCatalog.find(
        item =>
          item.공종 === seed.category &&
          item.공사명 === seed.workName &&
          item.노임항목 === seed.detailItem,
      );
      // [Bug 3 fix 2026-05-04] 1-fallback) 공종 무관 매칭 (예: 원인공사+방수+보통인부 누락 시
      //   방수공사+방수+보통인부에서 단가 가져오기).
      //   안전장치: 후보가 정확히 1개일 때만 적용 (단가 모호성 차단).
      //   2개 이상이면 자동선택을 포기하고 0으로 두어 사용자가 수동 보정하도록 함.
      if (!ilwiItem) {
        const ilwiCandidates = mergedIlwidaegaCatalog.filter(
          item =>
            normalizeForMatch(item.공사명 || '') === normalizeForMatch(seed.workName) &&
            normalizeForMatch(item.노임항목 || '') === normalizeForMatch(seed.detailItem) &&
            (Number(item.노임단가) || 0) > 0,
        );
        if (ilwiCandidates.length === 1) {
          ilwiItem = ilwiCandidates[0];
          console.log('[Bug3 폴백] 일위대가 공종무관 매칭 적용:', seed.category, seed.workName, seed.detailItem, '→', ilwiItem.공종);
        } else if (ilwiCandidates.length > 1) {
          console.log('[Bug3 폴백] 일위대가 후보 다수 — 모호성으로 폴백 포기:', seed.workName, seed.detailItem, ilwiCandidates.map(c => c.공종));
        }
      }
      // 2) 노무비 카탈로그 폴백 매칭 (공종+공사명+세부항목)
      let laborItem = !ilwiItem
        ? laborCatalog.find(
            item =>
              item.공종 === seed.category &&
              item.공사명 === seed.workName &&
              item.세부항목 === seed.detailItem,
          )
        : null;
      // [Bug 3 fix 2026-05-04] 2-fallback) 공종 무관 노무비 매칭. 단일 후보일 때만 적용.
      if (!ilwiItem && !laborItem) {
        const laborCandidates = laborCatalog.filter(
          item =>
            normalizeForMatch(item.공사명 || '') === normalizeForMatch(seed.workName) &&
            normalizeForMatch(item.세부항목 || '') === normalizeForMatch(seed.detailItem) &&
            (Number(item.단가_인) || 0) > 0,
        );
        if (laborCandidates.length === 1) {
          laborItem = laborCandidates[0];
          console.log('[Bug3 폴백] 노무비 공종무관 매칭 적용:', seed.category, seed.workName, seed.detailItem, '→', laborItem.공종);
        } else if (laborCandidates.length > 1) {
          console.log('[Bug3 폴백] 노무비 후보 다수 — 모호성으로 폴백 포기:', seed.workName, seed.detailItem, laborCandidates.map(c => c.공종));
        }
      }

      const matchedDetailWork: '노무비' | '일위대가' = ilwiItem ? '일위대가' : '노무비';
      const matchedStandardPrice = ilwiItem
        ? Number(ilwiItem.노임단가) || 0
        : Number(laborItem?.단가_인) || 0;
      const matchedUnit = ilwiItem ? '인' : (laborItem?.단위 || '인');

      const blank = createBlankLaborRow({
        category: seed.category,
        workName: seed.workName,
        detailItem: seed.detailItem,
        unit: matchedUnit,
        standardPrice: matchedStandardPrice,
      });
      // [누수탐지 경비여부 자동체크 2026-05-04] 누수탐지/누수탐지비용 항목은 경비로 자동 분류
      //   (includeInEstimate=false → 관리비/이윤 산정 대상에서 제외). 산식 변경 없음, 가드만 추가.
      const isLeakDetection = seed.category === "누수탐지" || seed.category === "누수탐지비용";
      return {
        ...blank,
        id: `labor-${baseTs}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        detailWork: matchedDetailWork,
        // [손방] 손해방지 샘플은 사용자가 직접 수량을 입력해야 하므로 기본값 0으로 셋팅
        // (createBlankLaborRow의 기본 quantity:1을 override) → 합계도 0으로 시작
        quantity: 0,
        amount: 0,
        // [손방 적용단가 보강 2026-05-04] 손해방지 케이스는 복구면적(C)이 없어 자동
        //   재계산 경로(C>0 && D>0 && E>0)가 작동하지 않아 pricePerSqm이 0으로 남음.
        //   수동 detailItem 선택 시(L1219) pricePerSqm = 단가_인을 채워주는 동작과 동일하게,
        //   샘플 적용 시점에도 적용단가 = E(노임단가)를 즉시 표시. 산식 변경 없음.
        pricePerSqm: matchedStandardPrice,
        includeInEstimate: isLeakDetection ? false : blank.includeInEstimate,
      };
    });

    const newMaterialRows: MaterialRow[] = template.materialRows.map((seed, idx) => {
      const blank = createBlankMaterialRow(seed.workType, seed.workName);
      // 자재비 카탈로그 매칭 (workType+workName+materialName)
      const matItem = seed.materialName
        ? transformedMaterialCatalog.find(
            item =>
              item.workType === seed.workType &&
              item.workName === seed.workName &&
              item.materialName === seed.materialName,
          )
        : null;
      const priceVal = matItem?.standardPrice;
      const numericPrice = typeof priceVal === 'number' ? priceVal : Number(priceVal) || 0;
      const isManual = typeof priceVal === 'string' && (priceVal === '입력' || priceVal === '직접입력');
      return {
        ...blank,
        id: `material-${baseTs}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        자재항목: seed.materialName,
        자재: seed.materialName,
        규격: matItem?.specification || '',
        단위: matItem?.unit || '',
        단가: numericPrice,
        기준단가: numericPrice,
        isManualPriceEntry: isManual,
      };
    });
    setLaborCostRows(newLaborRows);
    setSelectedLaborRows(new Set());
    setMaterialRows(newMaterialRows);
    setSelectedMaterialRows(new Set());
    // [손방 샘플 재적용] 메모리 삭제 키도 함께 정리해 잔재로 새 템플릿 항목이 막히지 않도록 한다.
    //   견적서는 laborCostRows + materialRows 합산으로 자동 갱신되므로 별도 처리 불필요.
    if (deletedLinkedLaborKeys.size > 0) {
      setDeletedLinkedLaborKeys(new Set());
    }
    console.log("[손방 샘플 적용]", template.label, `노무비 ${newLaborRows.length}행 / 자재비 ${newMaterialRows.length}행 (견적서 자동 갱신)`);
  };

  const handleLossSampleConfirm = () => {
    if (pendingLossSampleKey) {
      applyLossPreventionSampleTemplate(pendingLossSampleKey);
    }
    setPendingLossSampleKey(null);
  };

  // 특정 장소 그룹 내에 행 추가 (같은 장소 값으로)
  const addRowInCategory = (categoryValue: string, afterRowId: string) => {
    if (isReadOnly) return;
    const newRow = createBlankRow();
    newRow.category = categoryValue; // 같은 장소 값 설정
    
    setRows(prev => {
      const newRows = [...prev];
      const insertIndex = newRows.findIndex(r => r.id === afterRowId);
      if (insertIndex !== -1) {
        // 해당 행 뒤에 삽입
        newRows.splice(insertIndex + 1, 0, newRow);
      } else {
        newRows.push(newRow);
      }
      return newRows;
    });
  };

  // 특정 행 삭제 (장소 그룹 내 행 삭제) + 연동된 노무비/자재비도 삭제
  const deleteRowById = (rowId: string) => {
    if (isReadOnly) return;
    
    // 삭제할 행의 공사명 확인
    const deletingRow = rows.find(r => r.id === rowId);
    const deletingWorkName = deletingRow?.workName?.trim() || '';
    
    // 삭제 후 같은 공사명을 가진 다른 행이 있는지 확인
    const remainingWithSameWork = rows.filter(r => r.id !== rowId && r.workName?.trim() === deletingWorkName);
    const isLastOfWorkName = remainingWithSameWork.length === 0 && AUTO_SYNC_MATERIAL_WORK_NAMES.includes(deletingWorkName);
    
    // 연동된 노무비 행 삭제 (원래 행 + 철거공사 행)
    setLaborCostRows(prev => prev.filter(row => 
      row.sourceAreaRowId !== rowId && 
      row.sourceAreaRowId !== `${rowId}::demolition` &&
      row.sourceAreaRowId !== `demolition-${rowId}`
    ));
    
    // 연동된 자재비 행 삭제 또는 업데이트
    setMaterialRows(prev => {
      return prev.map(row => {
        const workName = (row.공사명 || '').toString().trim();
        
        // 1. 해당 공사명의 마지막 복구면적 행 삭제 시 → 자재비도 삭제
        if (isLastOfWorkName && workName === deletingWorkName) {
          console.log('[자재비 삭제] 복구면적 마지막 행 삭제로 인한 자재비 삭제:', workName);
          return { ...row, _delete: true };
        }
        
        // 2. sourceAreaRowId가 직접 매칭되는 경우
        if (row.sourceAreaRowId === rowId) {
          const updatedIds = (row.sourceAreaRowIds || []).filter(id => id !== rowId);
          if (updatedIds.length === 0) {
            return { ...row, _delete: true };
          }
          return { ...row, sourceAreaRowId: updatedIds[0], sourceAreaRowIds: updatedIds };
        }
        // 3. sourceAreaRowIds 배열에 포함된 경우
        if (row.sourceAreaRowIds && row.sourceAreaRowIds.includes(rowId)) {
          const updatedIds = row.sourceAreaRowIds.filter(id => id !== rowId);
          if (updatedIds.length === 0) {
            return { ...row, _delete: true };
          }
          return { ...row, sourceAreaRowId: updatedIds[0], sourceAreaRowIds: updatedIds };
        }
        return row;
      }).filter(row => !(row as any)._delete);
    });
    
    // 복구면적 행 삭제
    setRows(prev => prev.filter(row => row.id !== rowId));
    
    console.log('[연동] 복구면적 행 삭제 → 노무비/자재비 연동 삭제:', rowId, isLastOfWorkName ? `(마지막 ${deletingWorkName})` : '');
  };

  // 선택된 행 삭제 (체크박스 기반) + 연동된 노무비/자재비도 삭제
  const deleteSelectedRows = () => {
    if (isReadOnly) return;
    if (selectedRows.size === 0) return;
    
    const rowIdsToDelete = Array.from(selectedRows);
    
    // 삭제할 복구면적 행에서 공사명 목록 수집
    const deletingWorkNames = new Set<string>();
    rows.filter(r => selectedRows.has(r.id)).forEach(r => {
      if (r.workName) deletingWorkNames.add(r.workName.trim());
    });
    
    // 삭제 후 남아있는 복구면적 행의 공사명 목록
    const remainingWorkNames = new Set<string>();
    rows.filter(r => !selectedRows.has(r.id)).forEach(r => {
      if (r.workName) remainingWorkNames.add(r.workName.trim());
    });
    
    // 완전히 삭제되는 공사명 (삭제 후 남지 않는 공사명)
    const fullyDeletedWorkNames = new Set<string>();
    deletingWorkNames.forEach(wn => {
      if (!remainingWorkNames.has(wn)) {
        fullyDeletedWorkNames.add(wn);
      }
    });
    
    // 연동된 노무비 행 삭제
    setLaborCostRows(prev => prev.filter(row => {
      if (!row.sourceAreaRowId) return true;
      // 원래 행 또는 철거공사 행인지 확인
      const baseRowId = row.sourceAreaRowId.replace('::demolition', '').replace('demolition-', '');
      return !rowIdsToDelete.includes(baseRowId);
    }));
    
    // 연동된 자재비 행 삭제 또는 업데이트
    setMaterialRows(prev => {
      return prev.map(row => {
        const workName = (row.공사명 || '').toString().trim();
        
        // 1. AUTO_SYNC_MATERIAL_WORK_NAMES에 해당하고, 해당 공사명이 완전히 삭제되는 경우 제거
        if (AUTO_SYNC_MATERIAL_WORK_NAMES.includes(workName) && fullyDeletedWorkNames.has(workName)) {
          console.log('[자재비 삭제] 복구면적 삭제로 인한 자재비 삭제:', workName);
          return { ...row, _delete: true };
        }
        
        // 2. sourceAreaRowId가 삭제 대상에 포함된 경우
        if (row.sourceAreaRowId && rowIdsToDelete.includes(row.sourceAreaRowId)) {
          const updatedIds = (row.sourceAreaRowIds || []).filter(id => !rowIdsToDelete.includes(id));
          if (updatedIds.length === 0) {
            return { ...row, _delete: true };
          }
          return { ...row, sourceAreaRowId: updatedIds[0], sourceAreaRowIds: updatedIds };
        }
        // 3. sourceAreaRowIds 배열에 삭제 대상이 포함된 경우
        if (row.sourceAreaRowIds && row.sourceAreaRowIds.some(id => rowIdsToDelete.includes(id))) {
          const updatedIds = row.sourceAreaRowIds.filter(id => !rowIdsToDelete.includes(id));
          if (updatedIds.length === 0) {
            return { ...row, _delete: true };
          }
          return { ...row, sourceAreaRowId: updatedIds[0], sourceAreaRowIds: updatedIds };
        }
        return row;
      }).filter(row => !(row as any)._delete);
    });
    
    // 복구면적 행 삭제
    setRows(prev => prev.filter(row => !selectedRows.has(row.id)));
    setSelectedRows(new Set());
    
    console.log('[연동] 복구면적 행 일괄 삭제 → 노무비/자재비 연동 삭제:', rowIdsToDelete, '완전삭제 공사명:', Array.from(fullyDeletedWorkNames));
  };

  // 체크박스 토글
  const toggleRowSelection = (rowId: string) => {
    const newSelected = new Set(selectedRows);
    if (newSelected.has(rowId)) {
      newSelected.delete(rowId);
    } else {
      newSelected.add(rowId);
    }
    setSelectedRows(newSelected);
  };

  // 가로 입력만 받는 공사 여부 체크 함수 (걸레받이/몰딩 + 가구공사 전체)
  // 세로는 1m로 고정, 면적 = 가로 * 1
  const isLinearWorkName = (workName: string, workType?: string): boolean => {
    if (workType === '가구공사') return true;
    return workName === '걸레받이' || workName === '몰딩';
  };

  // 행 업데이트
  const updateRow = (rowId: string, field: keyof AreaCalculationRow, value: string) => {
    // 읽기 전용 모드에서는 업데이트 불가
    if (isReadOnly) return;

    // [복구면적→노무비 자동반영] 사용자 명시 편집 표식 — hydration/polling 유입은 false 유지.
    // 면적 관련 필드 변경시에만 표식 (workType/workName 등 다른 필드는 별도 sync 경로 사용).
    if (field === 'repairWidth' || field === 'repairHeight' || field === 'repairArea' ||
        field === 'damageWidth' || field === 'damageHeight' || field === 'damageArea') {
      userEditedAreaRef.current = true;
    }
    
    // 현재 행의 인덱스 찾기 (노무비/자재비 연동용)
    const currentRowIndex = rows.findIndex(r => r.id === rowId);
    
    setRows(prev => prev.map(row => {
      if (row.id === rowId) {
        const updated = { ...row, [field]: value };
        
        // 공사명/공종 변경 시 세로 값 처리 (가구공사 또는 걸레받이/몰딩)
        if (field === 'workName' || field === 'workType') {
          const newWorkType = field === 'workType' ? value : updated.workType;
          const newWorkName = field === 'workName' ? value : updated.workName;
          const wasLinear = isLinearWorkName(row.workName, row.workType);
          const isLinearNow = isLinearWorkName(newWorkName, newWorkType);
          if (isLinearNow) {
            // 가로만 입력: 세로를 1m로 고정
            updated.damageHeight = '1.0';
            updated.repairHeight = '1.0';
            // 면적 재계산: 가로(m) * 1(m) = 가로 (m²)
            const damageWidth = parseFloat(updated.damageWidth) || 0;
            const repairWidth = parseFloat(updated.repairWidth) || 0;
            const damageAreaM2 = (damageWidth * 1).toFixed(2);
            const repairAreaM2 = (repairWidth * 1).toFixed(2);
            updated.damageArea = parseFloat(damageAreaM2) > 0 ? damageAreaM2 : '0.00';
            updated.repairArea = parseFloat(repairAreaM2) > 0 ? repairAreaM2 : '0.00';
          } else if (wasLinear && !isLinearNow) {
            // 가로 전용에서 일반 공사로 변경 시 세로를 0으로 리셋
            updated.damageHeight = '0.0';
            updated.repairHeight = '0.0';
            // 면적 재계산 (세로가 0이므로 면적도 0)
            updated.damageArea = '0';
            updated.repairArea = '0';
          }
        }
        
        // 공사명 변경 시 노무비/자재비 자동 연동 (공종이 이미 설정된 경우)
        if (field === 'workName' && updated.workType && value) {
          // 복구면적 값 가져오기
          const repairAreaValue = parseFloat(updated.repairArea) || 0;
          // 동기 방식으로 연동 (setLaborCostRows/setMaterialRows 내부에서 중복 체크)
          syncAreaRowToLaborAndMaterial(updated.workType, value, rowId, repairAreaValue, updated.location || '');
        }
        
        // 공종 변경 시 노무비/자재비 자동 연동 (공사명이 이미 설정된 경우)
        if (field === 'workType' && updated.workName && value) {
          const repairAreaValue = parseFloat(updated.repairArea) || 0;
          syncAreaRowToLaborAndMaterial(value, updated.workName, rowId, repairAreaValue, updated.location || '');
        }
        
        // 가로/세로 변경 시 면적 자동 계산
        if (field === 'damageWidth' || field === 'damageHeight') {
          const currentWorkName = updated.workName || row.workName;
          const currentWorkType = updated.workType || row.workType;
          const width = parseFloat(field === 'damageWidth' ? value : row.damageWidth) || 0;
          
          if (isLinearWorkName(currentWorkName, currentWorkType)) {
            // 가로만 입력: 세로 1m 고정, 면적 = 가로 * 1 (m²)
            updated.damageHeight = '1.0';
            const areaM2 = (width * 1).toFixed(2);
            updated.damageArea = parseFloat(areaM2) > 0 ? areaM2 : '0.00';
          } else {
            // 일반: 가로(m) * 세로(m) = 면적(m²)
            const height = parseFloat(field === 'damageHeight' ? value : row.damageHeight) || 0;
            const area = (width * height).toFixed(2);
            updated.damageArea = area;
          }
        }
        
        if (field === 'repairWidth' || field === 'repairHeight') {
          const currentWorkName = updated.workName || row.workName;
          const currentWorkType = updated.workType || row.workType;
          const width = parseFloat(field === 'repairWidth' ? value : row.repairWidth) || 0;
          
          if (isLinearWorkName(currentWorkName, currentWorkType)) {
            // 가로만 입력: 세로 1m 고정, 면적 = 가로 * 1 (m²)
            updated.repairHeight = '1.0';
            const areaM2 = (width * 1).toFixed(2);
            updated.repairArea = parseFloat(areaM2) > 0 ? areaM2 : '0.00';
          } else {
            // 일반: 가로(m) * 세로(m) = 면적(m²)
            const height = parseFloat(field === 'repairHeight' ? value : row.repairHeight) || 0;
            const area = (width * height).toFixed(2);
            updated.repairArea = area;
          }
          
          // 복구면적 변경 시 자재비 수량 업데이트 (공종과 공사명이 설정된 경우)
          if (updated.workType && updated.workName) {
            const repairAreaValue = parseFloat(updated.repairArea) || 0;
            // setTimeout으로 비동기 호출하여 rows 상태 업데이트 후 실행
            setTimeout(() => {
              syncAreaRowToLaborAndMaterial(updated.workType, updated.workName, rowId, repairAreaValue, updated.location || '');
            }, 0);
          }
        }
        
        return updated;
      }
      return row;
    }));
  };

  // 총 비용 계산 (견적서 탭용)
  const estimateSummary = useMemo(() => {
    // 노무비 총합 - 경비 여부에 따라 분리
    // includeInEstimate === true → 경비가 아닌 항목 (관리비/이윤에 포함)
    // includeInEstimate === false → 경비 항목 (관리비/이윤에서 제외)
    // 노무비 탭 footer와 동일하게 위치별 병합 후 합산.
    // calculateIWithTiers 비선형성으로 인해 행 단위 합산과 병합 후 합산이 다르므로
    // 화면에 보이는 값(병합 후)과 견적서/인보이스 합계가 일치하도록 통일.
    const mergedLaborForTotal = mergeLaborRowsForTotal(laborCostRows, laborRateTiers);
    const getRowAmount = (row: LaborCostRow) => getMergedRowAmount(row as any, laborRateTiers);

    const laborTotalNonExpense = mergedLaborForTotal.reduce((sum, row) => {
      if (row.includeInEstimate) {
        return sum + getMergedRowAmount(row, laborRateTiers);
      }
      return sum;
    }, 0);

    const laborTotalExpense = mergedLaborForTotal.reduce((sum, row) => {
      if (!row.includeInEstimate) {
        return sum + getMergedRowAmount(row, laborRateTiers);
      }
      return sum;
    }, 0);

    // 자재비 총합 (금액 필드 합계)
    const materialTotal = materialRows.reduce((sum, row) => {
      return sum + (row.금액 || 0);
    }, 0);

    // 자재비 경비가 아닌 항목 (관리비/이윤 포함 대상)
    const materialTotalNonExpense = materialRows.reduce((sum, row) => {
      if (row.includeInEstimate) {
        return sum + (row.금액 || 0);
      }
      return sum;
    }, 0);

    // 소계 (전체)
    const subtotal = laborTotalNonExpense + laborTotalExpense + materialTotal;

    // 일반관리비와 이윤 계산 대상 (경비가 아닌 노무비 + 경비가 아닌 자재비)
    const baseForFees = laborTotalNonExpense + materialTotalNonExpense;

    // 일반관리비 (6%) - 경비 제외 항목에만 적용
    const managementFee = Math.round(baseForFees * 0.06);

    // 이윤 (15%) - 경비 제외 항목에만 적용
    const profit = Math.round(baseForFees * 0.15);

    // VAT 기준액 (소계 + 일반관리비 + 이윤)
    const vatBase = subtotal + managementFee + profit;

    // 만원단위절사 (10000원 미만 버림) - VAT 적용 전에 절사 (용어는 '천원단위 절사')
    const truncation = vatBase % 10000;
    const truncatedVatBase = vatBase - truncation;

    // VAT (10%) - 절사된 금액에 적용
    const vat = vatIncluded ? Math.round(truncatedVatBase * 0.1) : 0;

    // 총 합계 = 만원단위절사된 금액 + VAT
    const total = truncatedVatBase + vat;

    return {
      subtotal,
      managementFee,
      profit,
      vat,
      truncation,
      total,
    };
  }, [laborCostRows, materialRows, vatIncluded, laborRateTiers]);

  // 초기화
  const handleReset = () => {
    if (masterDataList.length === 0) {
      toast({
        title: "잠시만 기다려주세요",
        description: "마스터 데이터를 로딩 중입니다.",
        variant: "destructive",
      });
      return;
    }
    if (confirm("입력한 내용을 모두 초기화하시겠습니까?")) {
      setRows([createBlankRow()]);
      setSelectedRows(new Set());
    }
  };
  
  // 자재비 관련 computed values
  const availableMaterialCategories = useMemo(() => {
    const categories = new Set<string>();
    materialsData.forEach(m => {
      // materialsData에서 category 필드가 있으면 추출, 없으면 자재명을 카테고리로 사용
      const category = m.materialName; // DB에 category 컬럼이 없으므로 materialName을 사용
      categories.add(category);
    });
    return Array.from(categories).sort();
  }, [materialsData]);

  const materialNames = useMemo(() => {
    const names = new Set<string>();
    materialsData.forEach(m => names.add(m.materialName));
    return Array.from(names).sort();
  }, [materialsData]);

  const materialSpecifications = useMemo(() => {
    if (!selectedMaterialName) return [];
    return materialsData
      .filter(m => m.materialName === selectedMaterialName)
      .map(m => ({ 
        id: m.id,
        label: `${m.specification} (${m.unit})` 
      }));
  }, [materialsData, selectedMaterialName]);

  // 자재 추가 함수
  const handleAddMaterial = () => {
    if (!selectedMaterialName || !selectedMaterialSpec) {
      toast({
        title: "자재를 선택하세요",
        description: "공종과 자재를 모두 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    const selectedMaterial = materialsData.find(m => m.id === Number(selectedMaterialSpec));

    if (!selectedMaterial) {
      toast({
        title: "자재를 찾을 수 없습니다",
        description: "선택한 자재 정보를 찾을 수 없습니다.",
        variant: "destructive",
      });
      return;
    }

    const unitPrice = selectedMaterial.standardPrice || 0;
    const newRow: MaterialRow = {
      id: `material-${Date.now()}-${Math.random()}`,
      공사명: '', // 수동 추가 시 공사명은 빈 값
      공종: selectedMaterialName, // 선택된 공종 사용
      자재항목: selectedMaterial.materialName,
      자재: selectedMaterial.materialName,
      규격: selectedMaterial.specification,
      단위: selectedMaterial.unit,
      단가: unitPrice,
      기준단가: unitPrice,
      수량m2: 0,
      수량EA: 1,
      수량: 1,
      합계: unitPrice,
      금액: unitPrice,
      includeInEstimate: true,
      비고: "",
    };

    setMaterialRows(prev => [...prev, newRow]);
    
    // 선택 초기화 (연속 추가 가능하도록)
    setSelectedMaterialSpec("");
    
    toast({
      title: "자재가 추가되었습니다",
      description: `${selectedMaterial.materialName} - ${selectedMaterial.specification}`,
    });
  };

  // 자재비 빈 행 추가
  const addBlankMaterialRow = () => {
    setMaterialRows(prev => [...prev, createBlankMaterialRow()]);
  };

  // 자재비 행 수정
  const updateMaterialRow = (rowId: string, updates: Partial<MaterialRow>) => {
    setMaterialRows(prev => 
      prev.map(row => {
        if (row.id !== rowId) return row;
        
        const updatedRow = { ...row, ...updates };
        
        // 수량이 변경되면 금액 재계산
        if (updates.수량 !== undefined) {
          updatedRow.금액 = updatedRow.수량 * updatedRow.기준단가;
        }
        
        return updatedRow;
      })
    );
  };

  // 자재비 행 삭제
  const deleteMaterialRows = () => {
    if (selectedMaterialRows.size === 0) {
      toast({
        title: "삭제할 항목을 선택하세요",
        description: "삭제할 자재 항목을 먼저 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    if (confirm(`선택한 ${selectedMaterialRows.size}개의 항목을 삭제하시겠습니까?`)) {
      setMaterialRows(prev => prev.filter(row => !selectedMaterialRows.has(row.id)));
      setSelectedMaterialRows(new Set());
    }
  };

  // 자재비 행 체크박스 토글
  const toggleMaterialRow = (rowId: string) => {
    setSelectedMaterialRows(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  // 자재비 전체 선택/해제
  const toggleAllMaterialRows = () => {
    if (selectedMaterialRows.size === materialRows.length) {
      setSelectedMaterialRows(new Set());
    } else {
      setSelectedMaterialRows(new Set(materialRows.map(row => row.id)));
    }
  };

  // 피해면적 산출표에서 불러온 면적을 자재비의 해당 공종 수량에 반영
  const handleAreaImportToMaterial = (workType: string, totalArea: number) => {
    if (!workType || totalArea <= 0) return;
    
    setMaterialRows(prev => 
      prev.map(row => {
        // 공종이 일치하는 자재비 행의 수량을 업데이트
        if (row.공종 === workType) {
          const updatedRow = { ...row, 수량: totalArea };
          // 금액 재계산
          updatedRow.금액 = updatedRow.수량 * updatedRow.기준단가;
          return updatedRow;
        }
        return row;
      })
    );
  };
  
  // 철거공사 행도 함께 생성해야 하는 공사명 목록
  // 사용자가 이 공사명들을 선택하면 '철거공사' 공종으로 추가 행 생성
  const DEMOLITION_REQUIRED_WORK_NAMES = ['합판', '석고보드', '도배', '마루', '장판'];
  
  // 노무비 행 생성 또는 업데이트 헬퍼 (중복 방지 및 정렬 포함)
  const createOrUpdateLaborRow = (
    workType: string,
    workName: string,
    sourceRowId: string,
    matchingLaborItems: typeof laborCatalog
  ) => {
    const laborItem = matchingLaborItems.length > 0 ? matchingLaborItems[0] : null;
    const isSingleMatch = matchingLaborItems.length === 1;
    const detailItem = isSingleMatch && laborItem ? (laborItem.세부항목 || '') : '';
    const unitPrice = isSingleMatch && laborItem ? (laborItem.단가_인 || 0) : 0;
    
    setLaborCostRows(prev => {
      // 이미 같은 sourceAreaRowId를 가진 행이 있는지 확인
      const existingRowIndex = prev.findIndex(r => r.sourceAreaRowId === sourceRowId);
      
      if (existingRowIndex !== -1) {
        // 기존 행이 있으면 공종/공사명만 업데이트 (사용자 입력은 유지)
        const existingRow = prev[existingRowIndex];
        if (existingRow.category === workType && existingRow.workName === workName) {
          // 동일하면 변경 없음
          return prev;
        }
        
        console.log('[연동] 노무비 행 업데이트:', existingRow.category, existingRow.workName, '→', workType, workName);
        
        // 걸레받이는 일위대가 DB에서 조회해야 함
        const updatedDetailWork = workName === '걸레받이' ? '일위대가' : existingRow.detailWork;
        
        const updatedRows = [...prev];
        updatedRows[existingRowIndex] = {
          ...existingRow,
          category: workType,
          workName: workName,
          detailWork: updatedDetailWork,
          // DB 매칭이 있으면 세부항목/단가도 업데이트
          detailItem: matchingLaborItems.length > 0 ? detailItem : existingRow.detailItem,
          standardPrice: matchingLaborItems.length > 0 ? unitPrice : existingRow.standardPrice,
          unit: isSingleMatch && laborItem ? (laborItem.단위 || '인') : existingRow.unit,
          pricePerSqm: matchingLaborItems.length > 0 ? unitPrice : existingRow.pricePerSqm,
          amount: matchingLaborItems.length > 0 ? Math.round(unitPrice * existingRow.quantity) : existingRow.amount,
        };
        return sortLaborRowsByCategory(updatedRows);
      }
      
      // 새 행 생성 (DB 매칭이 없어도 빈 행으로 생성)
      // 걸레받이는 일위대가 DB에서 조회해야 하므로 detailWork='일위대가'로 설정
      const detailWorkValue = workName === '걸레받이' ? '일위대가' : '노무비';
      const newLaborRow: LaborCostRow = {
        id: `labor-${Date.now()}-${Math.random()}`,
        sourceAreaRowId: sourceRowId,
        place: '',
        position: '',
        category: workType,
        workName: workName,
        detailWork: detailWorkValue,
        detailItem: detailItem,
        priceStandard: '',
        unit: isSingleMatch && laborItem ? (laborItem.단위 || '인') : '',
        standardPrice: unitPrice,
        quantity: 1,
        applicationRates: { ceiling: false, wall: false, floor: false, molding: false },
        salesMarkupRate: 0,
        pricePerSqm: unitPrice,
        damageArea: 0,
        deduction: 0,
        includeInEstimate: false,
        request: '',
        amount: Math.round(unitPrice * 1),
      };
      
      console.log('[연동] 노무비 행 생성:', workType, workName, 
        matchingLaborItems.length > 0 
          ? (isSingleMatch ? `자동: ${detailItem} ${unitPrice}원` : `수동선택필요 (${matchingLaborItems.length}개 옵션)`)
          : '(DB 매칭 없음)');
      return sortLaborRowsByCategory([...prev, newLaborRow]);
    });
  };
  
  // 노무비 DB에서 해당 공종의 노무비 항목 찾기 (폴백 로직 포함)
  // OLD 형식 Excel에서는 개별 공사명(몰딩, 반자틀 등)이 세부공사='일위대가'로 되어 있고,
  // 노무비 항목은 '공종-공종-노무비' 구조로 되어 있음 (예: 목공사-목공사-노무비)
  // 예외: 피해철거공사-피해철거-노무비 (공사명이 공종과 다름)
  const findLaborItemsWithFallback = (
    normalizedWorkType: string, 
    normalizedWorkName: string
  ): typeof laborCatalog => {
    // 1순위: 정확한 매칭 (공종+공사명+세부공사=노무비)
    let items = laborCatalog.filter(item => 
      normalizeForMatch(item.공종) === normalizedWorkType && 
      normalizeForMatch(item.공사명) === normalizedWorkName &&
      item.세부공사 === '노무비'
    );
    
    if (items.length > 0) {
      console.log('[연동] 정확한 노무비 매칭:', normalizedWorkType, normalizedWorkName, `${items.length}개`);
      return items;
    }
    
    // 2순위: 같은 공종의 카테고리 노무비로 폴백 (예: 목공사-몰딩 → 목공사-목공사-노무비)
    items = laborCatalog.filter(item => 
      normalizeForMatch(item.공종) === normalizedWorkType && 
      normalizeForMatch(item.공사명) === normalizedWorkType && // 공사명이 공종과 동일한 항목
      item.세부공사 === '노무비'
    );
    
    if (items.length > 0) {
      console.log('[연동] 카테고리 노무비로 폴백:', normalizedWorkType, normalizedWorkName, 
        `→ ${items[0].공종}-${items[0].공사명}-${items[0].세부공사} (${items.length}개 옵션)`);
      return items;
    }
    
    // 3순위: 공종이 공사명으로 시작하는 경우 (예: 피해철거공사 → 피해철거공사-피해철거-노무비)
    items = laborCatalog.filter(item => 
      normalizeForMatch(item.공종) === normalizedWorkType && 
      normalizedWorkType.startsWith(normalizeForMatch(item.공사명)) && // 공종이 공사명으로 시작
      item.세부공사 === '노무비'
    );
    
    if (items.length > 0) {
      console.log('[연동] 부분 매칭 노무비로 폴백:', normalizedWorkType, normalizedWorkName, 
        `→ ${items[0].공종}-${items[0].공사명}-${items[0].세부공사} (${items.length}개 옵션)`);
      return items;
    }
    
    console.log('[연동] 노무비 매칭 없음:', normalizedWorkType, normalizedWorkName);
    return [];
  };
  
  // 자재비 단위 규격 상수 (공사명별 자재 규격)
  // type: 'length' = 길이(m) 기준, 'area' = 면적(㎡) 기준
  const MATERIAL_UNIT_RATIOS: Record<string, { type: 'length' | 'area'; unitSize: number; unit: string }> = {
    '몰딩': { type: 'length', unitSize: 2.44, unit: 'EA' },        // 한 개 길이 2.44m
    '걸레받이': { type: 'length', unitSize: 2.44, unit: 'EA' },   // 한 개 길이 2.44m
    '합판': { type: 'area', unitSize: 1.65, unit: 'EA' },          // 한 장 면적 1.65㎡
    '석고보드': { type: 'area', unitSize: 1.62, unit: 'EA' },      // 한 장 면적 1.62㎡
    '석고': { type: 'area', unitSize: 1.62, unit: 'EA' },          // 석고보드와 동일
  };
  
  // 자재비 수량 계산 헬퍼 함수
  // workName: 공사명, totalArea: 복구면적(㎡), totalLength: 복구 길이(m, 몰딩/걸레받이용)
  const computeMaterialQuantity = (workName: string, totalArea: number, totalLength?: number): { quantity: number; quantityEA: number; unit: string } => {
    const ratio = MATERIAL_UNIT_RATIOS[workName];
    
    if (ratio) {
      // 공사명별 단위 규격 적용
      const baseValue = ratio.type === 'length' ? (totalLength || totalArea) : totalArea;
      const calculatedQty = Math.ceil(baseValue / ratio.unitSize); // 올림
      console.log(`[자재비 수량] ${workName}: ${baseValue} ÷ ${ratio.unitSize} = ${baseValue / ratio.unitSize} → 올림 → ${calculatedQty} ${ratio.unit}`);
      return { 
        quantity: calculatedQty, 
        quantityEA: calculatedQty,
        unit: ratio.unit 
      };
    }
    
    // 규격 없는 경우 면적 그대로 사용
    return { 
      quantity: Math.round(totalArea * 10) / 10, 
      quantityEA: 0,
      unit: '㎡' 
    };
  };
  
  // 복구면적 산출표 → 노무비/자재비 자동 연동 함수 (일위대가DB 기반)
  // 일위대가DB에서 공종+공사명으로 조회하여 ALL matching 노임항목 행을 자동 생성
  const syncAreaRowToLaborAndMaterial = (workType: string, workName: string, sourceRowId: string, repairArea?: number, location?: string) => {
    if (!workType || !workName) return;
    
    // 연동 제외 공종/공사명으로 변경된 경우: 기존 연동 행 제거
    if ((AREA_DISPLAY_ONLY_WORK_TYPES.includes(workType) || AREA_DISPLAY_ONLY_WORK_NAMES.includes(workName)) && !isItemInLinkSettings(workType, workName)) {
      console.log('[일위대가 연동] 연동 제외 대상 - 기존 행 제거:', workType, workName);
      setLaborCostRows(prev => prev.filter(r => 
        r.sourceAreaRowId !== sourceRowId && 
        !r.sourceAreaRowId?.startsWith(`${sourceRowId}::`)
      ));
      setMaterialRows(prev => prev.filter(r => 
        r.sourceAreaRowId !== sourceRowId
      ));
      return;
    }
    
    // 삭제 키가 로드되기 전에는 노무비 생성하지 않음 (삭제한 노무비가 재생성되는 것 방지)
    if (!exclusionsLoaded) {
      console.log('[일위대가 연동] 삭제 키 미로드 - 대기:', workType, workName);
      return;
    }
    
    // 중복 호출 방지: 같은 공종+공사명에 대한 동기화가 진행 중이면 건너뛰기
    const materialSyncKey = `${workType}|${workName}`;
    if (materialSyncInProgressRef.current.has(materialSyncKey)) {
      console.log('[자재비 동기화] 중복 호출 방지:', materialSyncKey);
      return;
    }
    materialSyncInProgressRef.current.add(materialSyncKey);
    // 동기화 완료 후 제거 (다음 렌더 사이클에서)
    setTimeout(() => {
      materialSyncInProgressRef.current.delete(materialSyncKey);
    }, 100);
    
    // 면적 합산 대상 공사명: 도배, 마루, 장판, 합판, 석고보드, 석고
    const areaAggregationWorkNames = ['도배', '마루', '장판', '합판', '석고보드', '석고'];
    // 길이(m) 합산 대상 공사명: 몰딩, 걸레받이
    const lengthAggregationWorkNames = ['몰딩', '걸레받이'];
    
    // 천장 할증 계수 적용 (노무비용) — 자재비는 실면적 기준으로 별도
    const syncCeilingMult = getCeilingMultiplier(workType, location || '');
    const adjustedRepairArea = repairArea ? Math.round(repairArea * syncCeilingMult * 10) / 10 : 0;

    // 기본값: 전달받은 repairArea 사용 (자재비는 실면적)
    let totalMaterialArea = repairArea || 0;
    let totalMaterialLength = repairArea || 0; // 몰딩/걸레받이는 가로값이 길이(m)
    
    if (areaAggregationWorkNames.includes(workName)) {
      // 같은 공사명의 모든 행에서 면적 합산 (천장 ×1.3 적용 안 함 - 자재비는 실면적 기준)
      // 주의: rows 상태가 stale할 수 있으므로, 현재 행의 값(repairArea)을 별도로 반영
      let sumArea = 0;
      let currentRowIncluded = false;
      
      rows.forEach(row => {
        if (row.workName === workName) {
          if (row.id === sourceRowId) {
            // 현재 편집 중인 행: 전달받은 repairArea 사용 (최신값)
            sumArea += (repairArea || 0);
            currentRowIncluded = true;
          } else {
            // 다른 행: rows 상태에서 읽기
            const rowArea = parseFloat(row.repairArea) || 0;
            sumArea += rowArea;
          }
        }
      });
      
      // 현재 행이 rows에 없는 경우 (새로 추가되는 경우) repairArea 추가
      if (!currentRowIncluded && repairArea) {
        sumArea += repairArea;
      }
      
      if (sumArea > 0) {
        totalMaterialArea = Math.round(sumArea * 10) / 10;
      }
      console.log(`[자재비 수량] ${workName} 전체 면적 합계: ${totalMaterialArea}㎡ (rows: ${rows.filter(r => r.workName === workName).length}개, 현재행포함: ${currentRowIncluded})`);
    } else if (lengthAggregationWorkNames.includes(workName)) {
      // 몰딩/걸레받이: 길이 합산 (repairArea 필드 값은 m 단위)
      let sumLengthM = 0; // m 단위 합계
      let currentRowIncluded = false;
      
      rows.forEach(row => {
        if (row.workName === workName) {
          if (row.id === sourceRowId) {
            // 현재 편집 중인 행: 전달받은 repairArea 사용 (m 단위)
            sumLengthM += (repairArea || 0);
            currentRowIncluded = true;
          } else {
            // 다른 행: rows 상태에서 읽기 (m 단위)
            const rowLengthM = parseFloat(row.repairArea) || 0;
            sumLengthM += rowLengthM;
          }
        }
      });
      
      // 현재 행이 rows에 없는 경우 (새로 추가되는 경우) repairArea 추가
      if (!currentRowIncluded && repairArea) {
        sumLengthM += repairArea;
      }
      
      // 이미 m 단위이므로 변환 불필요
      if (sumLengthM > 0) {
        totalMaterialLength = Math.round(sumLengthM * 100) / 100; // 소수점 둘째 자리
        totalMaterialArea = totalMaterialLength; // computeMaterialQuantity에서 사용
      }
      console.log(`[자재비 수량] ${workName} 전체 길이 합계: ${totalMaterialLength}m (rows: ${rows.filter(r => r.workName === workName).length}개, 현재행포함: ${currentRowIncluded})`);
    }
    
    console.log('[일위대가 연동] 복구면적 → 노무비:', workType, workName);
    
    // 일위대가DB에서 공종+공사명으로 ALL matching 노임항목 조회
    // 정규화된 비교 사용 (공백, 대소문자 등 무시)
    const normalizedWorkType = normalizeForMatch(workType);
    const normalizedWorkName = normalizeForMatch(workName);
    
    const matchingIlwidaegaItems = mergedIlwidaegaCatalog.filter(item => {
      const itemWorkType = normalizeForMatch(item.공종 || '');
      const itemWorkName = normalizeForMatch(item.공사명 || '');
      return itemWorkType === normalizedWorkType && itemWorkName === normalizedWorkName;
    });
    
    console.log('[일위대가 연동] 매칭된 노임항목:', matchingIlwidaegaItems.length, '개',
      matchingIlwidaegaItems.map(item => `${item.노임항목}(E:${item.노임단가}원)`).join(', '));
    
    // 노무비 행 생성/업데이트 (일위대가DB 기반)
    // 중복 제거: 같은 공종+공사명+노임항목은 하나의 행만 유지
    setLaborCostRows(prev => {
      // 현재 sourceRowId를 가진 행 제거 (재생성을 위해)
      let filteredRows = prev.filter(r => 
        r.sourceAreaRowId !== sourceRowId && 
        !r.sourceAreaRowId?.startsWith(`${sourceRowId}::`)
      );
      
      // 이미 같은 공종+공사명으로 연동된 노무비 행들 (다른 sourceAreaRowId, 철거 제외)
      const existingSameWorkLaborRows = filteredRows.filter(r => 
        r.isLinkedFromRecovery && 
        r.category === workType && 
        r.workName === workName &&
        !r.sourceAreaRowId?.includes('::demolition')
      );
      
      // 이미 같은 철거공사+공사명으로 연동된 철거 행들 (다른 sourceAreaRowId)
      const { demolitionWorkName } = getDemolitionMapping(workType, workName);
      const existingSameDemolitionRows = filteredRows.filter(r => 
        r.isLinkedFromRecovery && 
        r.category === '철거공사' && 
        r.workName === demolitionWorkName
      );
      
      // 중복 체크: 이미 같은 공종+공사명 노무비 행이 있으면 새로 생성하지 않음
      // (rows 상태가 stale할 수 있으므로 filteredRows만으로 판단)
      if (existingSameWorkLaborRows.length > 0) {
        console.log('[일위대가 연동] 중복 건너뛰기: 이미 같은 공종+공사명 노무비 행 존재', 
          workType, workName, existingSameWorkLaborRows.length, '개',
          existingSameDemolitionRows.length > 0 ? `(철거도 존재: ${existingSameDemolitionRows.length}개)` : '');
        
        // 조기 반환 시에도 중복 제거 적용 (이미 존재하는 중복 행 제거)
        // 철거공사 행은 sourceAreaRowId 포함하여 고유 키 생성 (각 복구면적 행별로 개별 관리)
        const seenEarly = new Set<string>();
        const deduplicatedFilteredRows = filteredRows.filter(row => {
          if (!row.isLinkedFromRecovery) return true;
          // 철거공사 행은 sourceAreaRowId 포함하여 각 복구면적 행별로 개별 관리
          const key = row.category === '철거공사' && row.sourceAreaRowId
            ? `${row.sourceAreaRowId}|${row.category}|${row.workName}|${row.detailItem}`
            : `${row.category}|${row.workName}|${row.detailItem}`;
          if (seenEarly.has(key)) {
            console.log('[일위대가 연동] 기존 중복 행 제거:', row.category, row.workName, row.detailItem);
            return false;
          }
          seenEarly.add(key);
          return true;
        });
        
        // 복구면적은 useEffect에서 calculateRecoveryAreaByWorkName으로 자동 계산됨
        return deduplicatedFilteredRows;
      }
      
      // 독립 추가 행은 유지 (isLinkedFromRecovery = false이고 sourceAreaRowId가 없는 행)
      const newLaborRows: LaborCostRow[] = [];
      
      if (matchingIlwidaegaItems.length > 0) {
        // 일위대가DB에서 매칭된 모든 노임항목으로 행 생성
        matchingIlwidaegaItems.forEach((catalogItem, idx) => {
          // D = 기준작업량, E = 노임단가(인당)
          const D = catalogItem.기준작업량 || 0;
          const E = catalogItem.노임단가 || 0;
          
          // 복구면적 = 전달받은 repairArea에 천장 할증 계수 적용
          const currentRepairArea = adjustedRepairArea;
          
          // 삭제된 노무비인지 체크 (사용자가 삭제한 행은 재생성하지 않음)
          const detailItem = catalogItem.노임항목 || '';
          const deletionKey = makeLinkedLaborDeletionKey(sourceRowId, workType, workName, detailItem);
          if (deletedLinkedLaborKeys.has(deletionKey)) {
            console.log('[일위대가 연동] 삭제된 노무비 스킵:', workType, workName, detailItem, 'key:', deletionKey);
            return; // 삭제된 노무비 - 재생성 안 함
          }
          
          // 중복 체크: 같은 공종+공사명+노임항목 행이 이미 있으면 건너뛰기
          const existingRow = filteredRows.find(r => 
            r.isLinkedFromRecovery && 
            r.category === workType && 
            r.workName === workName && 
            r.detailItem === catalogItem.노임항목
          );
          
          if (existingRow) {
            console.log('[일위대가 연동] 중복 행 건너뛰기:', workType, workName, catalogItem.노임항목);
            return; // 중복 - 건너뛰기
          }
          
          newLaborRows.push({
            id: `labor-ilwidaega-${Date.now()}-${Math.random()}-${idx}`,
            sourceAreaRowId: sourceRowId,
            isLinkedFromRecovery: true, // 복구면적에서 연동 생성된 행 (수정 불가)
            place: '',
            position: '',
            category: workType,
            workName: workName,
            detailWork: '일위대가',
            detailItem: catalogItem.노임항목 || '',
            priceStandard: '',
            unit: '㎡',
            standardPrice: E, // 노임단가 (E)
            standardWorkQuantity: D, // 기준작업량 (D)
            // [면적0 보정] 면적 0이면 수량 0으로 시작 (사용자 요청).
            quantity: currentRepairArea > 0 ? 1 : 0,
            applicationRates: { ceiling: false, wall: false, floor: false, molding: false },
            salesMarkupRate: 0,
            pricePerSqm: 0, // 초기값 0, useEffect에서 E 기준으로 계산됨
            damageArea: currentRepairArea, // 복구면적 (C) - repairArea 사용
            deduction: 0,
            includeInEstimate: true,
            request: '',
            amount: 0, // 초기값 0, useEffect에서 I로 계산됨
          });
        });
        console.log('[일위대가 연동] 노무비 행 생성:', workType, workName, 
          `${newLaborRows.length}개 노임항목 (${matchingIlwidaegaItems.map(i => i.노임항목).join(', ')})`);
      } else {
        // 일위대가DB에 없으면 빈 행 생성 (수동 입력용)
        const currentRepairArea = adjustedRepairArea;
        
        // 삭제된 노무비인지 체크 (사용자가 삭제한 행은 재생성하지 않음)
        const deletionKey = makeLinkedLaborDeletionKey(sourceRowId, workType, workName, '');
        if (deletedLinkedLaborKeys.has(deletionKey)) {
          console.log('[일위대가 연동] 삭제된 노무비 스킵 (DB 매칭 없음):', workType, workName);
          return filteredRows; // 삭제된 노무비 - 재생성 안 함
        }
        
        // 중복 체크: 이미 같은 공종+공사명 행이 있으면 건너뛰기
        const existingRow = filteredRows.find(r => 
          r.isLinkedFromRecovery && 
          r.category === workType && 
          r.workName === workName
        );
        
        if (!existingRow) {
          newLaborRows.push({
            id: `labor-manual-${Date.now()}-${Math.random()}`,
            sourceAreaRowId: sourceRowId,
            isLinkedFromRecovery: true,
            place: '',
            position: '',
            category: workType,
            workName: workName,
            detailWork: '일위대가',
            detailItem: '',
            priceStandard: '',
            unit: '㎡',
            standardPrice: 0,
            standardWorkQuantity: 0,
            // [면적0 보정] 면적 0이면 수량 0으로 시작 (사용자 요청).
            quantity: currentRepairArea > 0 ? 1 : 0,
            applicationRates: { ceiling: false, wall: false, floor: false, molding: false },
            salesMarkupRate: 0,
            pricePerSqm: 0,
            damageArea: currentRepairArea, // 복구면적 (C) - repairArea 사용
            deduction: 0,
            includeInEstimate: true,
            request: '',
            amount: 0,
          });
          console.log('[일위대가 연동] 노무비 행 생성 (DB 매칭 없음):', workType, workName);
        }
      }
      
      // 바탕만들기 companion 행 생성 (도장공사 + 수성페인트/무늬코트/탄성코트)
      const companions = getCompanionWorkNames(workType, workName);
      companions.forEach(companionName => {
        const companionSourceId = `${sourceRowId}::batang`;
        const companionCatalogItems = mergedIlwidaegaCatalog.filter(item =>
          normalizeForMatch(item.공종 || '') === normalizedWorkType &&
          normalizeForMatch(item.공사명 || '') === normalizeForMatch(companionName)
        );
        if (companionCatalogItems.length > 0) {
          companionCatalogItems.forEach((catalogItem, idx) => {
            const detailItem = catalogItem.노임항목 || '';
            const deletionKey = makeLinkedLaborDeletionKey(companionSourceId, workType, companionName, detailItem);
            if (deletedLinkedLaborKeys.has(deletionKey)) return;
            const existingRow = filteredRows.find(r =>
              r.isLinkedFromRecovery && r.category === workType && r.workName === companionName && r.detailItem === detailItem
            );
            if (existingRow) return;
            if (newLaborRows.some(r => r.category === workType && r.workName === companionName && r.detailItem === detailItem)) return;
            const D = catalogItem.기준작업량 || 0;
            const E = catalogItem.노임단가 || 0;
            newLaborRows.push({
              id: `labor-ilwidaega-${Date.now()}-${Math.random()}-companion-${idx}`,
              sourceAreaRowId: companionSourceId,
              isLinkedFromRecovery: true,
              place: '',
              position: '',
              category: workType,
              workName: companionName,
              detailWork: '일위대가',
              detailItem,
              priceStandard: '',
              unit: '㎡',
              standardPrice: E,
              standardWorkQuantity: D,
              // [면적0 보정] 면적 0이면 수량 0으로 시작 (사용자 요청).
              quantity: adjustedRepairArea > 0 ? 1 : 0,
              applicationRates: { ceiling: false, wall: false, floor: false, molding: false },
              salesMarkupRate: 0,
              pricePerSqm: 0,
              damageArea: adjustedRepairArea,
              deduction: 0,
              includeInEstimate: true,
              request: '',
              amount: 0,
            });
          });
          console.log('[일위대가 연동] 바탕만들기 행 생성:', companionName, companionCatalogItems.length, '개');
        }
      });

      // 철거공사는 별도 Reconcile useEffect에서 자동 생성됨 (중복 방지)
      // 철거공사 Reconcile useEffect가 rows 변경 감지하여 생성함
      
      // 최종 결과 생성
      const allRows = [...filteredRows, ...newLaborRows];
      
      // 중복 제거: 같은 공종+공사명+노임항목 조합은 첫 번째 행만 유지
      // (React 배치 처리로 인해 동시에 생성된 중복 방지)
      // 철거공사 행은 sourceAreaRowId 포함하여 고유 키 생성 (각 복구면적 행별로 개별 관리)
      // [수동행 보호] 사용자가 직접 추가한 행(isLinkedFromRecovery=false)과 같은 공종|공사명|노임항목 키의 자동행은 제거.
      // 비교는 normalizeForMatch 기반(공백/대소문자 차이로 인한 매칭 누락 방지).
      const manualPlainKeys = new Set<string>();
      allRows.forEach(row => {
        if (!row.isLinkedFromRecovery) {
          manualPlainKeys.add(
            `${normalizeForMatch(row.category || '')}|${normalizeForMatch(row.workName || '')}|${normalizeForMatch(row.detailItem || '')}`
          );
        }
      });
      const seen = new Set<string>();
      const deduplicatedRows = allRows.filter(row => {
        // 연동되지 않은 수동 행은 중복 체크에서 제외
        if (!row.isLinkedFromRecovery) return true;
        
        const plainKey = `${row.category}|${row.workName}|${row.detailItem}`;
        const normalizedPlainKey = `${normalizeForMatch(row.category || '')}|${normalizeForMatch(row.workName || '')}|${normalizeForMatch(row.detailItem || '')}`;
        if (manualPlainKeys.has(normalizedPlainKey)) {
          console.log('[일위대가 연동] 수동행 충돌 - 자동행 제거:', row.category, row.workName, row.detailItem);
          return false;
        }
        
        // 철거공사 행은 sourceAreaRowId 포함하여 각 복구면적 행별로 개별 관리
        const key = row.category === '철거공사' && row.sourceAreaRowId
          ? `${row.sourceAreaRowId}|${row.category}|${row.workName}|${row.detailItem}`
          : plainKey;
        if (seen.has(key)) {
          console.log('[일위대가 연동] 중복 행 제거:', row.category, row.workName, row.detailItem);
          return false;
        }
        seen.add(key);
        return true;
      });
      
      return deduplicatedRows;
    });
    
    // 자재비 연동 대상 공사명 (이 공사명만 자재비에 연동됨)
    // 합판, 석고(석고보드), 몰딩, 걸레받이, 도배, 마루, 장판
    const MATERIAL_LINKED_WORK_NAMES = ['합판', '석고보드', '석고', '몰딩', '걸레받이', '도배', '마루', '장판'];
    const isMaterialLinkedWorkName = MATERIAL_LINKED_WORK_NAMES.some(
      name => normalizeForMatch(name) === normalizedWorkName
    );
    
    // 자재비 연동 대상 공사명이 아니면 자재비 생성 스킵
    if (!isMaterialLinkedWorkName) {
      console.log('[연동] 자재비 스킵 (연동 대상 아님):', workType, workName);
      return; // 자재비 생성하지 않음
    }
    
    // 자재비 DB에서 해당 공종+공사명의 자재 찾기 (materialByWorknameCatalog 사용)
    // materialByWorknameCatalog 구조:
    //   - 공종 = 원인공사, 목공사, 수장공사 등 (workType과 매칭)
    //   - 공사명 = 방수, 합판, 도배 등 (workName과 매칭)
    //   - 자재항목 = 실제 자재 이름
    
    // 1순위: 공종 + 공사명 모두 일치
    const exactMatch = materialByWorknameCatalog.filter(item => 
      normalizeForMatch(item.공종) === normalizedWorkType &&
      normalizeForMatch(item.공사명) === normalizedWorkName
    );
    
    // 2순위: 공종 일치 + 공사명이 부분 일치 (예: 석고보드 -> 석고) - exactMatch 제외
    const exactMatchIds = new Set(exactMatch.map(m => `${m.공종}|${m.공사명}|${m.자재항목}`));
    const partialWorkNameMatch = materialByWorknameCatalog.filter(item => {
      const itemWorkType = normalizeForMatch(item.공종);
      const itemWorkName = normalizeForMatch(item.공사명);
      const itemKey = `${item.공종}|${item.공사명}|${item.자재항목}`;
      
      // exactMatch에 포함된 항목은 제외
      if (exactMatchIds.has(itemKey)) return false;
      
      return itemWorkType === normalizedWorkType && (
        itemWorkName.includes(normalizedWorkName) ||
        normalizedWorkName.includes(itemWorkName)
      );
    });
    
    // 3순위: 공종만 일치
    const matchByWorkType = materialByWorknameCatalog.filter(item => 
      normalizeForMatch(item.공종) === normalizedWorkType
    );
    
    // 우선순위 적용
    const materialsToUse = exactMatch.length > 0 ? exactMatch :
                           partialWorkNameMatch.length > 0 ? partialWorkNameMatch :
                           matchByWorkType;
    
    console.log('[연동] 자재비 DB 조회:', workType, workName, '→ 매칭:', materialsToUse.length, '개',
      exactMatch.length > 0 ? '(정확 매칭)' : partialWorkNameMatch.length > 0 ? '(부분 매칭)' : '(공종만 매칭)');
    
    // 자재 행 생성/업데이트 (1개면 자동완성, 여러개면 드롭다운에서 선택)
    const isSingleMatch = materialsToUse.length === 1;
    const materialItem = materialsToUse.length > 0 ? materialsToUse[0] : null;
    const materialName = isSingleMatch && materialItem ? materialItem.자재항목 : '';
    const spec = isSingleMatch && materialItem ? (materialItem.규격 || '') : '';
    const unit = isSingleMatch && materialItem ? (materialItem.단위 || 'EA') : '';
    
    // 단가 처리: '입력', '직접입력' 문자열인 경우 직접입력 필요
    const priceValue = isSingleMatch && materialItem ? materialItem.금액 : null;
    const isManualPriceEntry = typeof priceValue === 'string' && 
      (priceValue.includes('입력') || priceValue === '입력' || priceValue === '직접입력');
    const unitPrice = isSingleMatch && materialItem && !isManualPriceEntry
      ? (typeof materialItem.금액 === 'number' ? materialItem.금액 : 0) 
      : 0;
    
    setMaterialRows(prev => {
      // 공종+공사명 기준으로 기존 자재비 행 찾기 (하나의 공종+공사명에 하나의 자재비 행)
      const existingRowIndex = prev.findIndex(r => 
        r.공종 === workType && r.공사명 === workName && r.isLinkedFromRecovery === true
      );
      
      // 수량 계산
      const { quantity: computedQty, quantityEA: computedEA, unit: computedUnit } = computeMaterialQuantity(workName, totalMaterialArea);
      const useEA = computedUnit === 'EA';
      
      if (existingRowIndex !== -1) {
        // 기존 행이 있으면 수량만 업데이트 (공종+공사명 당 1개 행 유지)
        const existingRow = prev[existingRowIndex];
        
        console.log('[연동] 자재비 행 업데이트:', workType, workName, `면적: ${totalMaterialArea}, 계산수량: ${computedQty}`);
        
        const updatedRows = [...prev];
        const newPrice = materialsToUse.length > 0 && !existingRow.자재항목 ? unitPrice : (existingRow.단가 || existingRow.기준단가 || 0);
        const newM2 = useEA ? 0 : computedQty;
        const newEA = useEA ? computedQty : 0;
        const totalQty = computedQty;
        
        updatedRows[existingRowIndex] = {
          ...existingRow,
          isLinkedFromRecovery: true,
          수량m2: newM2,
          수량EA: newEA,
          수량: totalQty,
          합계: Math.round(newPrice * totalQty),
          금액: Math.round(newPrice * totalQty),
          // sourceAreaRowIds 배열로 연결된 복구면적 행 추적 (삭제 시 사용)
          sourceAreaRowIds: Array.from(new Set([...(existingRow.sourceAreaRowIds || []), sourceRowId])),
        };
        return updatedRows;
      }
      
      // 새 행 생성 (공종+공사명별 1개만)
      const materialQuantity = computedQty;
      const materialAmount = Math.round(unitPrice * materialQuantity);
      
      const newMaterialRow: MaterialRow = {
        id: `material-linked-${Date.now()}-${Math.random()}`,
        공종: workType,
        공사명: workName,
        자재항목: materialName,
        자재: materialName,
        규격: spec,
        단위: useEA ? 'EA' : unit,
        단가: unitPrice,
        기준단가: unitPrice,
        수량m2: useEA ? 0 : materialQuantity,
        수량EA: useEA ? materialQuantity : 0,
        수량: materialQuantity,
        합계: materialAmount,
        금액: materialAmount,
        includeInEstimate: true,
        비고: '',
        sourceAreaRowId: sourceRowId, // 첫 번째 복구면적 행 ID
        sourceAreaRowIds: [sourceRowId], // 연결된 모든 복구면적 행 ID 배열
        isLinkedFromRecovery: true,
        isManualPriceEntry: isManualPriceEntry,
      };
      
      console.log('[연동] 자재비 행 생성:', workType, workName, 
        `면적: ${totalMaterialArea}, 계산수량: ${materialQuantity} ${computedUnit}`,
        materialsToUse.length > 0
          ? (isSingleMatch ? `자동: ${materialName} ${unitPrice}원` : `수동선택필요 (${materialsToUse.length}개 옵션)`)
          : '(DB 매칭 없음)');
      return [...prev, newMaterialRow];
    });
    
    // 표면마감재(도배/마루/장판)의 경우 같은 공사명의 모든 자재비 행 수량 동기화
    const surfaceFinishes = ['도배', '마루', '장판'];
    if (surfaceFinishes.includes(workName)) {
      // 약간의 지연 후 동기화 (상태 업데이트 완료 대기)
      setTimeout(() => {
        setMaterialRows(prev => {
          // 같은 공사명의 모든 행에서 최대 수량 찾기 (가장 최근 계산된 합계)
          const sameWorkNameRows = prev.filter(r => r.공사명 === workName);
          if (sameWorkNameRows.length <= 1) return prev;
          
          // 가장 큰 수량 값을 찾아서 동기화 (합계가 가장 큰 값)
          const maxQty = Math.max(...sameWorkNameRows.map(r => (r.수량m2 || 0) + (r.수량EA || 0)));
          
          console.log(`[자재비 수량 동기화] ${workName}: ${sameWorkNameRows.length}개 행 → 수량 ${maxQty}로 통일`);
          
          return prev.map(r => {
            if (r.공사명 === workName) {
              const currentQty = (r.수량m2 || 0) + (r.수량EA || 0);
              if (currentQty !== maxQty) {
                const newTotal = Math.round((r.단가 || r.기준단가 || 0) * maxQty);
                return { 
                  ...r, 
                  수량m2: maxQty, 
                  수량EA: 0, 
                  수량: maxQty, 
                  합계: newTotal, 
                  금액: newTotal 
                };
              }
            }
            return r;
          });
        });
      }, 100);
    }
  };
  

  // 노무비 행 체크박스 토글
  const toggleLaborRow = (rowId: string) => {
    setSelectedLaborRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(rowId)) {
        newSet.delete(rowId);
      } else {
        newSet.add(rowId);
      }
      return newSet;
    });
  };
  
  // 노무비 테이블 리셋
  const resetLaborTable = () => {
    if (isReadOnly) return;
    if (laborCatalog.length === 0) {
      toast({
        title: "잠시만 기다려주세요",
        description: "노무비 데이터를 로딩 중입니다.",
        variant: "destructive",
      });
      return;
    }
    if (confirm("노무비 입력 내용을 모두 초기화하시겠습니까?")) {
      setLaborCostRows([createBlankLaborRow()]);
      setSelectedLaborRows(new Set());
    }
  };

  // 저장 mutation (복구면적 산출표 + 노무비 + 자재비 통합 저장)
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCaseId) {
        throw new Error("케이스가 선택되지 않았습니다");
      }

      // 문자열을 숫자로 변환하는 헬퍼 함수
      const toNumber = (val: string | number | null | undefined): number | null => {
        if (val === null || val === undefined || val === '') return null;
        const num = typeof val === 'string' ? parseFloat(val) : val;
        return isNaN(num) ? null : num;
      };
      
      // UI 데이터를 API 형식으로 변환 (rowOrder는 서버에서 자동 할당)
      // category가 비어있는 행은 필터링 (손해방지 케이스에서 복구면적 산출표를 사용하지 않을 때)
      const apiRows = rows
        .filter((row) => row.category && row.category.trim() !== "")
        .map((row) => ({
          category: row.category,
          location: row.location === "선택" ? null : row.location,
          workType: row.workType || null,
          workName: row.workName === "선택" ? null : row.workName,
          damageWidth: toNumber(row.damageWidth),
          damageHeight: toNumber(row.damageHeight),
          damageArea: toNumber(row.damageArea),
          repairWidth: toNumber(row.repairWidth),
          repairHeight: toNumber(row.repairHeight),
          repairArea: toNumber(row.repairArea),
          note: row.note,
        }));

      // 노무비 데이터 (id 제외, rowIndex 추가)
      // [고정] 모든 행에 lockedAtSave: true 박아 저장 → 다시 열 때 자동 동기화가 표준값을 덮어쓰지 않음.
      //   견적서/현장출동보고서/인보이스가 모두 동일한 "저장 시점 데이터"를 기준으로 표시되도록 보장.
      //   "복구면적 가져오기" 등 명시적 수동 액션은 별도 경로이므로 영향 없음.
      const laborCostData = laborCostRows.map(({ id, ...rest }, index) => {
        const isIlw = rest.detailWork === "일위대가";
        const C = rest.damageArea || 0;
        const D = rest.standardWorkQuantity || 0;
        const E = rest.standardPrice || 0;
        // 머지 대상 항목(철거공사 전체 + 가구공사/욕실공사의 FIXED 항목)은
        // 위치별 raw 수량을 그대로 저장해야 어떤 화면에서 머지하든 같은 합계가 나옴.
        // 일위대가 보정(calculateIWithTiers)을 적용하면 위치당 quantity가 위치 면적만큼 부풀려지고,
        // 다시 머지될 때 위치 수만큼 곱해져 합계가 폭증함. 따라서 보정 대상에서 제외한다.
        const isMergeable = isMergeableLaborRow(rest as any);
        if (isIlw && C > 0 && D > 0 && E > 0 && !isMergeable) {
          const correctedAmount = calculateIWithTiers(C, D, E, laborRateTiers);
          const correctedPricePerSqm = calculateAppliedUnitPriceWithTiers(C, D, E, laborRateTiers);
          const correctedQuantity = calculateQuantityWithTiers(C, D, E, laborRateTiers);
          return {
            ...rest,
            amount: correctedAmount,
            pricePerSqm: correctedPricePerSqm,
            quantity: correctedQuantity,
            lockedAtSave: true,
            rowIndex: index,
          };
        }
        return {
          ...rest,
          lockedAtSave: true,
          rowIndex: index,
        };
      });

      // 자재비 데이터 (id 제외, sourceLaborRowIndex 추가)
      // [정책 2026-05-13] 모든 자재 행에 lockedAtSave: true 박아 저장 → 다시 열 때 자동 sync가 사용자 값을 덮어쓰지 않음.
      //   사용자가 직접 수정하지 않는 한 진입만으로는 어떤 값도 변하지 않도록 보장.
      //   "복구면적 가져오기" 수동 버튼은 별도 경로(lock 해제 후 강제 sync).
      const materialCostData = materialRows.map(({ id, sourceLaborRowId, ...rest }) => {
        // sourceLaborRowId를 인덱스로 변환
        const laborIndex = laborCostRows.findIndex(lr => lr.id === sourceLaborRowId);
        return {
          ...rest,
          lockedAtSave: true,
          sourceLaborRowIndex: laborIndex >= 0 ? laborIndex : null,
        };
      });

      // [A] 프론트엔드 로깅: 저장 버튼 클릭 직전 payload
      console.log("========================================");
      console.log("[A] 프론트엔드: 저장 직전 payload");
      console.log("케이스 ID:", selectedCaseId);
      console.log("첫 번째 행 데이터:");
      if (apiRows.length > 0) {
        console.log("  repairWidth:", apiRows[0].repairWidth, "타입:", typeof apiRows[0].repairWidth);
        console.log("  repairHeight:", apiRows[0].repairHeight, "타입:", typeof apiRows[0].repairHeight);
        console.log("  repairArea:", apiRows[0].repairArea, "타입:", typeof apiRows[0].repairArea);
        console.log("  damageWidth:", apiRows[0].damageWidth, "타입:", typeof apiRows[0].damageWidth);
        console.log("  damageHeight:", apiRows[0].damageHeight, "타입:", typeof apiRows[0].damageHeight);
        console.log("  damageArea:", apiRows[0].damageArea, "타입:", typeof apiRows[0].damageArea);
      }
      console.log("전체 apiRows:", JSON.stringify(apiRows, null, 2));
      console.log("========================================");

      // [Bug fix 2026-05-06] 30초 timeout으로 mutation hang 방지.
      //   네트워크/서버 지연으로 fetch가 응답을 못 받으면 saveMutation.isPending이
      //   영구 true로 갇혀 scheduler isEligible 가드(`!saveMutation.isPending`)에
      //   걸려 모든 후속 자동저장이 SKIP되고 저장 버튼이 "저장 중..."에 멈춤.
      //   AbortController + 30초로 강제 회복 → onError 발동 → isPending=false.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        return await apiRequest("POST", `/api/estimates/${selectedCaseId}`, {
          rows: apiRows,
          laborCostData,
          materialCostData,
          totalAmount: estimateSummary.total, // 견적 총액 전송
          vatIncluded, // VAT 포함/별도 옵션
        }, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
    },
    onSuccess: () => {
      const wasAutoSave = isAutoSavingRef.current;
      isAutoSavingRef.current = false;

      // [LOCK] race 방지: 저장 완료 즉시 로컬 노무비/자재비 state도 lockedAtSave=true 박기.
      // refetch/hydration 사이 자동 sync useEffect가 lock 없는 이전 state를 보고
      // 표준값을 덮어쓰는 윈도우를 차단(저장 시점 스냅샷이 견적서/보고서/인보이스에 일관 적용되도록).
      setLaborCostRows(prev => prev.map(row => ({ ...row, lockedAtSave: true })));
      setMaterialRows(prev => prev.map(row => ({ ...row, lockedAtSave: true })));

      if (wasAutoSave) {
        // 자동 저장: 사용자에게 토스트 노출하지 않음 (조용히 동기화)
        console.log("[AUTO-SAVE] 싱크 결과 자동 저장 완료 (toast 생략)");
      } else {
        toast({
          title: "저장 완료",
          description: "견적이 성공적으로 저장되었습니다.",
        });
      }
      // 견적 목록 및 최신 견적 갱신
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", selectedCaseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", selectedCaseId, "latest"] });
      // 케이스 목록 갱신 (견적금액이 업데이트되었으므로)
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      // 보고서 데이터 갱신 (견적서 탭에서 실시간 반영)
      queryClient.invalidateQueries({ queryKey: ["/api/field-surveys", selectedCaseId, "report"] });
    },
    onError: (error: any) => {
      const wasAutoSave = isAutoSavingRef.current;
      isAutoSavingRef.current = false;
      if (wasAutoSave) {
        // 자동 저장 실패는 사용자에게 노출하지 않고 콘솔에만 기록
        console.error("[AUTO-SAVE] 자동 저장 실패:", error);
        return;
      }
      toast({
        title: "저장 실패",
        description: error.message || "견적 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 싱크 결과 자동 저장 트리거
  // - sync useEffect 끝에서 호출 → 짧은 디바운스(1.5초) 후 saveMutation 실행
  // - readOnly / 케이스 미선택 / 미수화 / 저장 진행 중인 경우 스킵
  // - 사용자가 직접 누르는 "저장"과는 분리 (toast 미표시)
  // [Task #11] 자동 저장 가드 통과 검증 (안전망).
  //   - 선행 task #7~#10에서 sync 자체에 가드를 추가했지만, 자동 저장 직전에도
  //     latest state가 가드를 통과한 상태인지 한 번 더 확인하여, 어떤 경로로든
  //     부활/오매칭이 들어오면 DB write를 차단.
  //   - 검증 항목:
  //     ⑧ 삭제된 연동 노무비 키 부활: isLinkedFromRecovery=true && deletionKey가
  //        deletedLinkedLaborKeys에 들어있으면 위반.
  //     ⑩ 자재비 orphan: 자동/연동 플래그가 살아있는 자재비 행의 sourceLaborRowId가
  //        현재 laborCostRows에 없으면 위반 (정상 demote는 통과).
  //     ⑪ 자동행 중복: 동일 deletionKey를 가진 isLinkedFromRecovery 자동행이 2개
  //        이상이면 sync 가드 우회 → 위반.
  //   - 셋 모두 violations에 누적되어 자동 저장 자체를 차단한다.
  const validateAutoSyncGuards = (): { ok: boolean; violations: string[] } => {
    const violations: string[] = [];
    const labor = laborCostRowsRef.current;
    const material = materialRowsRef.current;
    const deletedKeys = deletedLinkedLaborKeysRef.current;

    // ⑧ 삭제 키 부활 검증
    //   - 노무비 연동 행은 makeLinkedLaborDeletionKey(`category|normalizedWorkName|
    //     detailItem`)로 추적된다 (L635, L3272 등). 자동 sync 가드(L3271)와
    //     동일한 키를 사용해 부활 여부 일관 검증.
    for (const row of labor) {
      if (!row.isLinkedFromRecovery) continue;
      const deletionKey = makeLinkedLaborDeletionKey(
        row.sourceAreaRowId || '',
        row.category || '',
        row.workName || '',
        row.detailItem || '',
      );
      if (deletedKeys.has(deletionKey)) {
        violations.push(`위험⑧: 삭제 키 부활 (key=${deletionKey}, pos=${row.position || ''})`);
      }
    }

    // ⑩ 자재비 orphan 검증
    //   - 사용자가 정상적으로 노무비 행을 삭제하면 Task #9 demote 경로가 자재비
    //     행의 isAutoGenerated/isLinkedFromRecovery를 false로 풀어 수동행으로
    //     강등시키되 sourceLaborRowId는 보존한다. 따라서 "수동행 + sourceLaborRowId
    //     stale" 조합은 정상 케이스이므로 차단하지 않음.
    //   - 차단 대상: 여전히 자동/연동 플래그가 살아있는데 sourceLaborRowId가
    //     존재하지 않는 노무비 행을 가리키는 경우 (= demote가 누락된 진짜 orphan).
    const laborIds = new Set(labor.map(r => r.id));
    for (const row of material) {
      const stillAuto = row.isAutoGenerated || row.isLinkedFromRecovery;
      if (!stillAuto) continue;
      if (row.sourceLaborRowId && !laborIds.has(row.sourceLaborRowId)) {
        violations.push(
          `위험⑩: 자재비 orphan auto행 (id=...${row.id.slice(-8)}, srcId=...${row.sourceLaborRowId.slice(-8)})`,
        );
      }
    }

    // ⑪ 자동행 중복 패턴 (blocking)
    //   - sync 함수들은 동일한 면적행 source(sourceAreaRowId) 기준으로 자동행을
    //     매칭/재사용한다. 따라서 (sourceAreaRowId + category + workName +
    //     detailItem) 조합이 동일한 isLinkedFromRecovery 자동행이 2개 이상이면
    //     같은 source가 중복 매칭된 명백한 가드 우회 → 차단.
    //   - 주의: makeLinkedLaborDeletionKey는 sourceAreaRowId를 포함하지 않아
    //     FIXED 가구/욕조 등 위치별로 행이 생성되는 정상 케이스에서 false positive
    //     를 일으킨다. ⑪ 중복 검증은 반드시 sourceAreaRowId까지 포함한 키로 한다.
    const dupKey = (row: LaborCostRow) =>
      `${row.sourceAreaRowId || ''}|${row.category || ''}|${row.workName || ''}|${row.detailItem || ''}`;
    const autoLaborKeyCount = new Map<string, number>();
    for (const row of labor) {
      if (!row.isLinkedFromRecovery) continue;
      if (!row.sourceAreaRowId) continue; // source가 없으면 비교 불가 → skip
      const k = dupKey(row);
      autoLaborKeyCount.set(k, (autoLaborKeyCount.get(k) ?? 0) + 1);
    }
    autoLaborKeyCount.forEach((count, key) => {
      if (count > 1) {
        violations.push(`위험⑪: 동일 source+키 노무비 자동행 ${count}개 중복 (key=${key})`);
      }
    });

    return { ok: violations.length === 0, violations };
  };

  // [Task #11] sync 결과 변경 감지용 hash.
  //   - JSON.stringify로 핵심 state 3종(rows/labor/material)을 통째로 직렬화.
  //   - sync 함수들은 매칭된 기존 행의 id를 보존하므로(existingLinkedMap 등),
  //     실제 변경이 없으면 hash 동일 → false positive 적음.
  //   - 신규 행이 생기면 새 id가 부여돼 hash가 달라지므로 변경 감지됨.
  //   - 모든 필드는 plain serializable (LaborCostRow/MaterialRow/AreaCalculationRow)
  //     이므로 직렬화 실패는 발생하지 않는다.
  const computeAutoSaveHash = () =>
    JSON.stringify({
      rows: rowsRef.current,
      labor: laborCostRowsRef.current,
      material: materialRowsRef.current,
    });

  // [Task #12] 스케줄러 동작은 `client/src/lib/auto-save-scheduler.ts`로 추출하여
  //   회귀 시나리오를 단위 테스트로 자동 검증한다. 이 컴포넌트에서는 의존성을
  //   주입하는 얇은 어댑터만 유지한다.
  //   - 스케줄러 인스턴스는 ref로 1회만 생성 (디바운스 타이머/baseline state 보존).
  //   - 매 렌더에서 `latestAutoSaveDepsRef.current`를 갱신하여, 스케줄러가 호출될
  //     때마다 latest closure(currentUser/isPartner/isReadOnly/selectedCaseId/
  //     saveMutation 포함)를 보도록 한다 → stale state 차단.
  //   - 동작은 기존 in-line 구현과 1:1 동일 (architect 1차 리뷰의 baseline 보호 포함).
  const latestAutoSaveDepsRef = useRef<AutoSaveSchedulerDeps>({
    isPartnerSession: () => true, // 초기값: 안전 측 (어떤 호출이든 즉시 차단)
    isEligible: () => false,
    computeHash: () => "",
    validateGuards: () => ({ ok: true, violations: [] }),
    onPerformSave: () => {},
  });
  latestAutoSaveDepsRef.current = {
    // [Bug 2/3 fix 2026-05-06] 협력사 작성 중(isReadOnly=false)에는 자동저장 허용 →
    //   협력사 면적/노무비 수정이 즉시 DB 저장되어 관리자 화면에 자동 반영.
    //   협력사 제출 후(isReadOnly=true)에는 기존대로 차단(원본 보존).
    isPartnerSession: () => !currentUser || (isPartner && isReadOnly),
    isEligible: () =>
      !isReadOnly &&
      !!selectedCaseId &&
      isHydratedRef.current &&
      !saveMutation.isPending,
    computeHash: computeAutoSaveHash,
    validateGuards: validateAutoSyncGuards,
    onPerformSave: () => {
      isAutoSavingRef.current = true;
      saveMutation.mutate();
    },
  };
  const autoSaveSchedulerRef = useRef<ReturnType<typeof createAutoSaveScheduler> | null>(null);
  if (autoSaveSchedulerRef.current === null) {
    autoSaveSchedulerRef.current = createAutoSaveScheduler({
      isPartnerSession: () => latestAutoSaveDepsRef.current.isPartnerSession(),
      isEligible: () => latestAutoSaveDepsRef.current.isEligible(),
      computeHash: () => latestAutoSaveDepsRef.current.computeHash(),
      validateGuards: () => latestAutoSaveDepsRef.current.validateGuards(),
      onPerformSave: () => latestAutoSaveDepsRef.current.onPerformSave(),
    });
  }
  const triggerAutoSaveAfterSync = (reason: string) => {
    autoSaveSchedulerRef.current?.trigger(reason);
  };

  // 저장
  const handleSave = () => {
    // 제출 조건 상태 콘솔 로그
    console.log("=== 제출 조건 체크 (견적 저장) ===");
    console.log("현장입력 완료:", isFieldInputComplete);
    console.log("도면 완료:", isDrawingComplete);
    console.log("증빙자료 완료:", isDocumentsComplete);
    console.log("견적 완료:", isEstimateComplete);
    console.log("제출 가능:", canSubmitAll);
    console.log("================================");
    
    saveMutation.mutate();
  };

  if (isLoadingSelectedCase) {
    return (
      <FieldSurveyLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p style={{ fontFamily: "Pretendard", color: "rgba(12, 12, 12, 0.6)" }}>
              로딩 중...
            </p>
          </div>
        </div>
      </FieldSurveyLayout>
    );
  }

  if (!selectedCase) {
    return (
      <FieldSurveyLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <p style={{ fontFamily: "Pretendard", fontSize: "16px", color: "rgba(12, 12, 12, 0.6)" }}>
              현장입력에서 케이스를 먼저 선택해주세요.
            </p>
          </div>
        </div>
      </FieldSurveyLayout>
    );
  }

  return (
    <FieldSurveyLayout>
      <div
        className="relative p-8"
      >
        {/* 페이지 타이틀 */}
        <div className="flex items-center gap-2 mb-8">
          <h1
            style={{
              fontFamily: "Pretendard",
              fontSize: "24px",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "#253396",
            }}
          >
            견적서 작성
          </h1>
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "rgba(12, 12, 12, 0.2)",
            }}
          />
        </div>

        {/* 작성중인 건 */}
        <div className="mb-6">
          <div
            className="flex items-center justify-between mb-2"
            style={{
              fontFamily: "Pretendard",
              fontSize: "14px",
              fontWeight: 400,
              letterSpacing: "-0.02em",
              color: "rgba(12, 12, 12, 0.5)",
            }}
          >
            <span>작성중인 건</span>
            <button
              type="button"
              onClick={() => setCaseSearchModalOpen(true)}
              className="px-3 py-1.5 rounded-lg hover-elevate active-elevate-2"
              style={{
                fontFamily: "Pretendard",
                fontSize: "13px",
                fontWeight: 500,
                letterSpacing: "-0.02em",
                color: "#253396",
                background: "rgba(37, 51, 150, 0.08)",
                border: "1px solid rgba(37, 51, 150, 0.2)",
              }}
              data-testid="button-select-other-case"
            >
              다른 건 선택
            </button>
          </div>
          
          <div 
            className="p-4 rounded-lg"
            style={{
              background: "white",
              border: "1px solid rgba(12, 12, 12, 0.2)",
            }}
          >
            {/* 첫 번째 줄: 보험사명 + 사고번호 */}
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "#253396" }}
              />
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "15px",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                }}
              >
                {selectedCase.insuranceCompany || "보험사 미정"} {selectedCase.insuranceAccidentNo || ""}
              </span>
            </div>
            
            {/* 두 번째 줄: 접수번호, 피보험자, 담당자 */}
            <div 
              className="flex items-center gap-4"
              style={{
                fontFamily: "Pretendard",
                fontSize: "13px",
                fontWeight: 400,
                letterSpacing: "-0.02em",
                color: "rgba(12, 12, 12, 0.5)",
                paddingLeft: "12px",
              }}
            >
              <span>접수번호 {formatCaseNumber(selectedCase.caseNumber)}</span>
              <span>피보험자 {selectedCase.insuredName || "미정"}</span>
              <span>담당자 {(selectedCase as any).managerName || "미정"}</span>
              {selectedCase.insuredAddress && (
                <span>
                  <span style={{ color: "rgba(12, 12, 12, 0.5)" }}>주소</span>{" "}
                  <span style={{ color: "rgba(12, 12, 12, 0.7)" }}>
                    {selectedCase.insuredAddress}{(() => {
                      const suffix = selectedCase.caseNumber?.split("-").pop();
                      const detail = suffix === "0" ? selectedCase.insuredAddressDetail : selectedCase.victimAddressDetail;
                      return detail ? ` (${detail})` : "";
                    })()}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 카테고리 탭 - 손해방지 케이스는 복구면적 산출표 숨김 */}
        <div 
          className="flex gap-8 mb-6"
          style={{
            borderBottom: "2px solid rgba(12, 12, 12, 0.08)",
          }}
        >
          {(isLossPreventionCase ? CATEGORIES_LOSS_PREVENTION : CATEGORIES).map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setSelectedCategory(category)}
              className="pb-3 transition-all relative"
              style={{
                fontFamily: "Pretendard",
                fontSize: "16px",
                fontWeight: selectedCategory === category ? 600 : 400,
                letterSpacing: "-0.02em",
                background: "transparent",
                color: selectedCategory === category ? "#253396" : "rgba(12, 12, 12, 0.5)",
                border: "none",
              }}
              data-testid={`tab-${category}`}
            >
              {category}
              {selectedCategory === category && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "-2px",
                    left: 0,
                    right: 0,
                    height: "2px",
                    background: "#253396",
                  }}
                />
              )}
            </button>
          ))}
        </div>

        {/* 복구면적 산출표 컨텐츠 */}
        {selectedCategory === "복구면적 산출표" && (
          <div>
            {/* 복구면적 산출표 헤더 */}
            <div className="flex items-start justify-between mb-4">
              <h2
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "18px",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                }}
              >
                복구면적 산출표
              </h2>
              <div className="flex flex-col items-end gap-2">
                {/* 대물피해 샘플 버튼: 피해복구(대물) 케이스에서만, 장소추가 바로 위에 표시 */}
                {!isLossPreventionCase && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {PROPERTY_DAMAGE_SAMPLE_TEMPLATES.map(template => (
                      <button
                        key={template.key}
                        type="button"
                        onClick={() => setPendingSampleKey(template.key)}
                        disabled={isReadOnly}
                        className="px-3 py-2 rounded-md hover-elevate active-elevate-2"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "13px",
                          fontWeight: 500,
                          background: isReadOnly ? "#f5f5f5" : "white",
                          color: isReadOnly ? "rgba(12, 12, 12, 0.3)" : "#253396",
                          border: isReadOnly ? "1px solid rgba(12, 12, 12, 0.1)" : "1px solid #253396",
                          cursor: isReadOnly ? "not-allowed" : "pointer",
                          opacity: isReadOnly ? 0.6 : 1,
                        }}
                        data-testid={`button-sample-${template.key}`}
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                <button
                  type="button"
                  onClick={addLocation}
                  disabled={masterDataList.length === 0 || isReadOnly}
                  className="px-4 py-2 rounded-md flex items-center gap-2 hover-elevate active-elevate-2"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    background: (masterDataList.length === 0 || isReadOnly) ? "#f5f5f5" : "white",
                    color: (masterDataList.length === 0 || isReadOnly) ? "rgba(12, 12, 12, 0.3)" : "#253396",
                    border: (masterDataList.length === 0 || isReadOnly) ? "1px solid rgba(12, 12, 12, 0.1)" : "1px solid #253396",
                    cursor: (masterDataList.length === 0 || isReadOnly) ? "not-allowed" : "pointer",
                    opacity: (masterDataList.length === 0 || isReadOnly) ? 0.6 : 1,
                  }}
                  data-testid="button-add-location"
                >
                  장소추가
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedRows}
                  disabled={selectedRows.size === 0 || isReadOnly}
                  className="px-4 py-2 rounded-md flex items-center gap-2 hover-elevate active-elevate-2"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    background: (selectedRows.size === 0 || isReadOnly) ? "#f5f5f5" : "#FF4D4F",
                    color: (selectedRows.size === 0 || isReadOnly) ? "rgba(12, 12, 12, 0.3)" : "white",
                    border: "none",
                    cursor: (selectedRows.size === 0 || isReadOnly) ? "not-allowed" : "pointer",
                    opacity: (selectedRows.size === 0 || isReadOnly) ? 0.6 : 1,
                  }}
                  data-testid="button-delete-rows"
                >
                  삭제
                </button>
                </div>
              </div>
            </div>

            {/* 테이블 */}
            <div
              style={{
                background: "white",
                borderRadius: "8px",
                overflow: "auto",
                border: "1px solid rgba(12, 12, 12, 0.2)",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: "1200px",
                  borderRadius: "8px 8px 0px 0px",
                  overflow: "hidden",
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "#f4f5fa",
                      borderBottom: "1px solid rgba(12, 12, 12, 0.06)",
                    }}
                  >
                    <th 
                      style={{ 
                        width: "40px", 
                        padding: "17.5px 8px",
                        borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                      }}
                    >
                    </th>
                    <th 
                      style={{ 
                        width: "120px", 
                        padding: "17.5px 8px", 
                        fontFamily: "Pretendard", 
                        fontSize: "15px", 
                        fontWeight: 600, 
                        color: "rgba(12, 12, 12, 0.6)", 
                        textAlign: "center",
                        borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                      }}
                    >
                      장소
                    </th>
                    <th 
                      style={{ 
                        width: "60px", 
                        padding: "17.5px 4px",
                        borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                        fontFamily: "Pretendard", 
                        fontSize: "12px", 
                        fontWeight: 500, 
                        color: "rgba(12, 12, 12, 0.4)", 
                        textAlign: "center",
                      }}
                    >
                      +/-
                    </th>
                    <th 
                      style={{ 
                        width: "120px", 
                        padding: "17.5px 8px", 
                        fontFamily: "Pretendard", 
                        fontSize: "15px", 
                        fontWeight: 600, 
                        color: "rgba(12, 12, 12, 0.6)", 
                        textAlign: "center",
                        borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                      }}
                    >
                      위치
                    </th>
                    <th 
                      style={{ 
                        width: "140px", 
                        padding: "17.5px 8px", 
                        fontFamily: "Pretendard", 
                        fontSize: "15px", 
                        fontWeight: 600, 
                        color: "rgba(12, 12, 12, 0.6)", 
                        textAlign: "center",
                        borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                      }}
                    >
                      공종
                    </th>
                    <th 
                      style={{ 
                        width: "140px", 
                        padding: "17.5px 8px", 
                        fontFamily: "Pretendard", 
                        fontSize: "15px", 
                        fontWeight: 600, 
                        color: "rgba(12, 12, 12, 0.6)", 
                        textAlign: "center",
                        borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                      }}
                    >공사명
</th>
                    <th 
                      style={{ 
                        width: "393px",
                        padding: "0",
                        borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                      }} 
                      colSpan={3}
                    >
                      <div style={{ width: "100%", display: "flex", flexDirection: "column" }}>
                        <div 
                          style={{ 
                            padding: "17.5px 8px", 
                            fontFamily: "Pretendard", 
                            fontSize: "15px", 
                            fontWeight: 600, 
                            color: "rgba(12, 12, 12, 0.6)", 
                            textAlign: "center",
                            height: "43px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderBottom: "1px solid rgba(12, 12, 12, 0.1)",
                          }}
                        >
                          피해면적
                        </div>
                        <div style={{ display: "flex", width: "100%" }}>
                          <div 
                            style={{ 
                              flex: 1,
                              padding: "17.5px 8px", 
                              fontFamily: "Pretendard", 
                              fontSize: "15px", 
                              fontWeight: 600, 
                              color: "rgba(12, 12, 12, 0.6)", 
                              textAlign: "center",
                              height: "43px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            가로(m)
                          </div>
                          <div 
                            style={{ 
                              flex: 1,
                              padding: "17.5px 8px", 
                              fontFamily: "Pretendard", 
                              fontSize: "15px", 
                              fontWeight: 600, 
                              color: "rgba(12, 12, 12, 0.6)", 
                              textAlign: "center",
                              height: "43px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            세로(m)
                          </div>
                          <div 
                            style={{ 
                              flex: 1,
                              padding: "17.5px 8px", 
                              fontFamily: "Pretendard", 
                              fontSize: "15px", 
                              fontWeight: 600, 
                              color: "rgba(12, 12, 12, 0.6)", 
                              textAlign: "center",
                              height: "43px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            면적(㎡)
                          </div>
                        </div>
                      </div>
                    </th>
                    <th 
                      style={{ 
                        width: "393px",
                        padding: "0",
                        borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                      }} 
                      colSpan={3}
                    >
                      <div style={{ width: "100%", display: "flex", flexDirection: "column" }}>
                        <div 
                          style={{ 
                            padding: "17.5px 8px", 
                            fontFamily: "Pretendard", 
                            fontSize: "15px", 
                            fontWeight: 600, 
                            color: "rgba(12, 12, 12, 0.6)", 
                            textAlign: "center",
                            height: "43px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderBottom: "1px solid rgba(12, 12, 12, 0.1)",
                          }}
                        >
                          복구면적
                        </div>
                        <div style={{ display: "flex", width: "100%" }}>
                          <div 
                            style={{ 
                              flex: 1,
                              padding: "17.5px 8px", 
                              fontFamily: "Pretendard", 
                              fontSize: "15px", 
                              fontWeight: 600, 
                              color: "rgba(12, 12, 12, 0.6)", 
                              textAlign: "center",
                              height: "43px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            가로(m)
                          </div>
                          <div 
                            style={{ 
                              flex: 1,
                              padding: "17.5px 8px", 
                              fontFamily: "Pretendard", 
                              fontSize: "15px", 
                              fontWeight: 600, 
                              color: "rgba(12, 12, 12, 0.6)", 
                              textAlign: "center",
                              height: "43px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            세로(m)
                          </div>
                          <div 
                            style={{ 
                              flex: 1,
                              padding: "17.5px 8px", 
                              fontFamily: "Pretendard", 
                              fontSize: "15px", 
                              fontWeight: 600, 
                              color: "rgba(12, 12, 12, 0.6)", 
                              textAlign: "center",
                              height: "43px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            면적(㎡)
                          </div>
                        </div>
                      </div>
                    </th>
                    {showNote && (
                    <th 
                      style={{ 
                        width: "205px", 
                        padding: "17.5px 8px", 
                        fontFamily: "Pretendard", 
                        fontSize: "15px", 
                        fontWeight: 600, 
                        color: "rgba(12, 12, 12, 0.6)", 
                        textAlign: "center",
                      }}
                    >
                      비고
                    </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {groupRowsByCategory(rows).map((group, groupIndex) => (
                    group.rows.map((row, rowIndexInGroup) => {
                      const globalIndex = group.startIndex + rowIndexInGroup;
                      const isFirstRowInGroup = rowIndexInGroup === 0;
                      const isLastRowInGroup = rowIndexInGroup === group.rows.length - 1;
                      
                      return (
                        <tr
                          key={row.id}
                          style={{
                            borderBottom: isLastRowInGroup ? "2px solid rgba(12, 12, 12, 0.15)" : "1px solid rgba(12, 12, 12, 0.06)",
                          }}
                        >
                          {/* 체크박스 컬럼 - 그룹 첫 번째 행에만 rowspan 적용 */}
                          {isFirstRowInGroup && (
                            <td 
                              rowSpan={group.rows.length}
                              style={{ 
                                padding: "8px",
                                verticalAlign: "middle",
                                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                                background: "white",
                                textAlign: "center",
                              }}
                            >
                              <input
                                type="checkbox"
                                style={{ accentColor: "#253396" }}
                                checked={group.rows.every(r => selectedRows.has(r.id))}
                                onChange={() => {
                                  const allSelected = group.rows.every(r => selectedRows.has(r.id));
                                  const newSelected = new Set(selectedRows);
                                  group.rows.forEach(r => {
                                    if (allSelected) {
                                      newSelected.delete(r.id);
                                    } else {
                                      newSelected.add(r.id);
                                    }
                                  });
                                  setSelectedRows(newSelected);
                                }}
                                style={{ width: "16px", height: "16px", cursor: "pointer" }}
                                data-testid={`checkbox-group-${groupIndex}`}
                              />
                            </td>
                          )}
                          
                          {/* 장소 컬럼 - 그룹 첫 번째 행에만 rowspan 적용 */}
                          {isFirstRowInGroup && (
                            <td 
                              rowSpan={group.rows.length}
                              style={{ 
                                padding: "8px",
                                verticalAlign: "top",
                                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                                background: "white",
                              }}
                            >
                              <Select
                                value={row.category}
                                onValueChange={(value) => {
                                  group.rows.forEach(r => updateRow(r.id, 'category', value));
                                }}
                                disabled={isReadOnly}
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
                                  data-testid={`select-category-${globalIndex}`}
                                >
                                  <SelectValue>
                                    {row.category || "장소 선택"}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {roomCategories.filter(cat => cat && cat.trim() !== '').map(cat => (
                                    <SelectItem key={cat} value={cat}>
                                      {cat}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                          )}
                          
                          {/* +/- 버튼 컬럼 */}
                          <td style={{ padding: "4px", textAlign: "center", width: "60px" }}>
                            <div style={{ display: "flex", gap: "2px", justifyContent: "center" }}>
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
                                  background: isReadOnly ? "#f5f5f5" : "#253396",
                                  color: "white",
                                  border: "none",
                                  borderRadius: "4px",
                                  cursor: isReadOnly ? "not-allowed" : "pointer",
                                  fontSize: "16px",
                                  fontWeight: "bold",
                                }}
                                data-testid={`button-add-row-${globalIndex}`}
                              >
                                +
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteRowById(row.id)}
                                disabled={isReadOnly || group.rows.length <= 1}
                                style={{
                                  width: "24px",
                                  height: "24px",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  background: (isReadOnly || group.rows.length <= 1) ? "#f5f5f5" : "#FF4D4F",
                                  color: "white",
                                  border: "none",
                                  borderRadius: "4px",
                                  cursor: (isReadOnly || group.rows.length <= 1) ? "not-allowed" : "pointer",
                                  fontSize: "16px",
                                  fontWeight: "bold",
                                }}
                                data-testid={`button-delete-row-${globalIndex}`}
                              >
                                −
                              </button>
                            </div>
                          </td>
                          
                          {/* 위치 */}
                          <td style={{ padding: "8px" }}>
                            <Select
                              value={row.location}
                              onValueChange={(value) => updateRow(row.id, 'location', value)}
                              disabled={isReadOnly}
                            >
                              <SelectTrigger 
                                className="border focus:ring-0"
                                style={{
                                  width: "100%",
                                  height: "40px",
                                  fontFamily: "Pretendard",
                                  fontSize: "14px",
                                  borderColor: "rgba(12, 12, 12, 0.2)",
                                  borderRadius: "6px",
                                }}
                                data-testid={`select-location-${globalIndex}`}
                              >
                                <SelectValue>
                                  {row.location || "위치 선택"}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {locations.filter(loc => loc && loc.trim() !== '').map(loc => (
                                  <SelectItem key={loc} value={loc}>
                                    {loc}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                      <td style={{ padding: "8px" }}>
                        <Select
                          value={row.workType || undefined}
                          onValueChange={(value) => {
                            // 공종 변경 시 공사명도 초기화
                            updateRow(row.id, 'workType', value);
                            updateRow(row.id, 'workName', '');
                          }}
                          disabled={isReadOnly || !row.location}
                        >
                          <SelectTrigger 
                            className="border focus:ring-0"
                            style={{
                              width: "100%",
                              height: "40px",
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              borderColor: "rgba(12, 12, 12, 0.2)",
                              borderRadius: "6px",
                            }}
                            data-testid={`select-worktype-${globalIndex}`}
                          >
                            <SelectValue placeholder="공종 선택" />
                          </SelectTrigger>
                          <SelectContent>
                            {getWorkTypesByLocation(row.location).map(wt => (
                              <SelectItem key={wt} value={wt}>
                                {wt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td style={{ padding: "8px" }}>
                        <Select
                          value={row.workName || undefined}
                          onValueChange={(value) => updateRow(row.id, 'workName', value)}
                          disabled={isReadOnly || !row.workType}
                        >
                          <SelectTrigger 
                            className="border focus:ring-0"
                            style={{
                              width: "100%",
                              height: "40px",
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              borderColor: "rgba(12, 12, 12, 0.2)",
                              borderRadius: "6px",
                            }}
                            data-testid={`select-workname-${globalIndex}`}
                          >
                            <SelectValue placeholder="공사명 선택" />
                          </SelectTrigger>
                          <SelectContent>
                            {getWorkNamesByWorkType(row.workType, row.location).filter(wn => wn && wn.trim() !== '').map(wn => (
                              <SelectItem key={wn} value={wn}>
                                {wn}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="text"
                          value={row.damageWidth}
                          onChange={(e) => updateRow(row.id, 'damageWidth', e.target.value)}
                          onFocus={() => {
                            if (row.damageWidth === '0' || row.damageWidth === '0.0') {
                              updateRow(row.id, 'damageWidth', '');
                            }
                          }}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            updateRow(row.id, 'damageWidth', formatDecimal(val || '0'));
                          }}
                          disabled={isReadOnly}
                          placeholder="0.0"
                          className="input-focus-blue"
                          style={{
                            width: "100%",
                            padding: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            border: "1px solid rgba(12, 12, 12, 0.1)",
                            borderRadius: "8px",
                            textAlign: "center",
                            background: isReadOnly ? "white" : undefined,
                          }}
                          data-testid={`input-damage-width-${globalIndex}`}
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="text"
                          value={row.damageHeight}
                          onChange={(e) => updateRow(row.id, 'damageHeight', e.target.value)}
                          onFocus={() => {
                            if ((row.damageHeight === '0' || row.damageHeight === '0.0' || row.damageHeight === '1' || row.damageHeight === '1.0') && !isLinearWorkName(row.workName, row.workType)) {
                              updateRow(row.id, 'damageHeight', '');
                            }
                          }}
                          onBlur={(e) => {
                            if (!isLinearWorkName(row.workName, row.workType)) {
                              const val = e.target.value.trim();
                              updateRow(row.id, 'damageHeight', formatDecimal(val || '0'));
                            }
                          }}
                          disabled={isReadOnly}
                          readOnly={isLinearWorkName(row.workName, row.workType)}
                          placeholder="0.0"
                          className="input-focus-blue"
                          style={{
                            width: "100%",
                            padding: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            border: "1px solid rgba(12, 12, 12, 0.1)",
                            borderRadius: "8px",
                            textAlign: "center",
                            background: (isReadOnly || isLinearWorkName(row.workName, row.workType)) ? "white" : undefined,
                          }}
                          data-testid={`input-damage-height-${globalIndex}`}
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        {/* [정책 2026-05-12] 자동계산 면적 — 인접 입력 셀과 동일 외형(radius 8px)으로 통일 */}
                        <input
                          type="text"
                          value={row.damageArea}
                          readOnly
                          className="keep-border"
                          style={{
                            width: "100%",
                            padding: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            border: "1px solid rgba(12, 12, 12, 0.1)",
                            borderRadius: "8px",
                            textAlign: "center",
                            background: "white",
                            cursor: "default",
                          }}
                          data-testid={`input-damage-area-${globalIndex}`}
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="text"
                          value={row.repairWidth}
                          onChange={(e) => updateRow(row.id, 'repairWidth', e.target.value)}
                          onFocus={() => {
                            if (row.repairWidth === '0' || row.repairWidth === '0.0') {
                              updateRow(row.id, 'repairWidth', '');
                            }
                          }}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            updateRow(row.id, 'repairWidth', formatDecimal(val || '0'));
                          }}
                          disabled={isReadOnly}
                          placeholder="0.0"
                          className="input-focus-blue"
                          style={{
                            width: "100%",
                            padding: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            border: "1px solid rgba(12, 12, 12, 0.1)",
                            borderRadius: "8px",
                            textAlign: "center",
                            background: isReadOnly ? "white" : undefined,
                          }}
                          data-testid={`input-repair-width-${globalIndex}`}
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="text"
                          value={row.repairHeight}
                          onChange={(e) => updateRow(row.id, 'repairHeight', e.target.value)}
                          onFocus={() => {
                            if ((row.repairHeight === '0' || row.repairHeight === '0.0' || row.repairHeight === '1' || row.repairHeight === '1.0') && !isLinearWorkName(row.workName, row.workType)) {
                              updateRow(row.id, 'repairHeight', '');
                            }
                          }}
                          onBlur={(e) => {
                            if (!isLinearWorkName(row.workName, row.workType)) {
                              const val = e.target.value.trim();
                              updateRow(row.id, 'repairHeight', formatDecimal(val || '0'));
                            }
                          }}
                          disabled={isReadOnly}
                          readOnly={isLinearWorkName(row.workName, row.workType)}
                          placeholder="0.0"
                          className="input-focus-blue"
                          style={{
                            width: "100%",
                            padding: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            border: "1px solid rgba(12, 12, 12, 0.1)",
                            borderRadius: "8px",
                            textAlign: "center",
                            background: (isReadOnly || isLinearWorkName(row.workName, row.workType)) ? "white" : undefined,
                          }}
                          data-testid={`input-repair-height-${globalIndex}`}
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        {/* [정책 2026-05-12] 자동계산 면적 — 인접 입력 셀과 동일 외형(radius 8px)으로 통일 */}
                        <input
                          type="text"
                          value={row.repairArea}
                          readOnly
                          className="keep-border"
                          style={{
                            width: "100%",
                            padding: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            border: "1px solid rgba(12, 12, 12, 0.1)",
                            borderRadius: "8px",
                            textAlign: "center",
                            background: "white",
                            cursor: "default",
                          }}
                          data-testid={`input-repair-area-${globalIndex}`}
                        />
                      </td>
                      {showNote && (
                      <td style={{ padding: "8px" }}>
                        <input
                          type="text"
                          value={row.note}
                          onChange={(e) => updateRow(row.id, 'note', e.target.value)}
                          disabled={isReadOnly}
                          className="input-focus-blue"
                          style={{
                            width: "100%",
                            padding: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            border: "1px solid rgba(12, 12, 12, 0.1)",
                            borderRadius: "8px",
                            background: isReadOnly ? "white" : undefined,
                          }}
                          data-testid={`input-note-${globalIndex}`}
                        />
                          </td>
                      )}
                        </tr>
                      );
                    })
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* 저장 버튼 */}
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={isReadOnly || saveMutation.isPending}
                className="px-6 py-2.5 rounded-md flex items-center gap-2 hover-elevate active-elevate-2"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                  background: (isReadOnly || saveMutation.isPending) ? "#f5f5f5" : "#253396",
                  color: (isReadOnly || saveMutation.isPending) ? "rgba(12, 12, 12, 0.3)" : "white",
                  border: "none",
                  cursor: (isReadOnly || saveMutation.isPending) ? "not-allowed" : "pointer",
                  opacity: (isReadOnly || saveMutation.isPending) ? 0.6 : 1,
                }}
                data-testid="button-save-area-calculation"
              >
                {saveMutation.isPending ? "저장 중..." : "저장"}
              </button>
            </div>

            {/* 대물피해 샘플 적용 확인 다이얼로그 */}
            <AlertDialog
              open={pendingSampleKey !== null}
              onOpenChange={(open) => { if (!open) setPendingSampleKey(null); }}
            >
              <AlertDialogContent data-testid="dialog-sample-confirm">
                <AlertDialogHeader>
                  <AlertDialogTitle>샘플 불러오기 확인</AlertDialogTitle>
                  <AlertDialogDescription>
                    샘플을 불러오면 현재 입력 중인 내용이 초기화됩니다. 계속하시겠습니까?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-sample-cancel">취소</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleSampleConfirm}
                    data-testid="button-sample-confirm"
                    className="bg-[#253396] text-white hover:bg-[#253396]/90"
                  >
                    확인
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}


        {/* 자재비, 견적서는 준비중 표시 */}
        {/* 견적서 탭 */}
        {selectedCategory === "견적서" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            }}
          >
            {/* 견적서 제목 */}
            <div
              style={{
                fontFamily: "Pretendard",
                fontWeight: 600,
                fontSize: "20px",
                lineHeight: "128%",
                letterSpacing: "-0.02em",
                color: "#0C0C0C",
                marginBottom: "24px",
              }}
            >
              견적서
            </div>

            {/* 작성자 정보 & 고객 정보 섹션 */}
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                gap: "20px",
              }}
            >
              {/* 작성자 정보 */}
              <div
                style={{
                  flex: 1,
                  background: "white",
                  borderRadius: "12px",
                  padding: "24px",
                }}
              >
                <h3
                  style={{
                    fontFamily: "Pretendard",
                    fontWeight: 600,
                    fontSize: "16px",
                    lineHeight: "128%",
                    letterSpacing: "-0.02em",
                    color: "#0C0C0C",
                    marginBottom: "20px",
                  }}
                >
                  작성자 정보
                </h3>

                {/* [2026-05-13] 작성자 정보: 값 박스에 테두리 추가 (이미지2 기본정보 스타일과 통일) */}
                {/* 담당자 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginBottom: "12px",
                  }}
                >
                  <label
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "rgba(12, 12, 12, 0.6)",
                      width: "100px",
                      flexShrink: 0,
                    }}
                  >
                    담당자
                  </label>
                  <div
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      background: "white",
                      border: "1px solid rgba(12, 12, 12, 0.1)",
                      borderRadius: "8px",
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "#0C0C0C",
                    }}
                  >
                    {currentUser?.name || "-"}
                  </div>
                </div>

                {/* 협력사명 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginBottom: "12px",
                  }}
                >
                  <label
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "rgba(12, 12, 12, 0.6)",
                      width: "100px",
                      flexShrink: 0,
                    }}
                  >
                    협력사명
                  </label>
                  <div
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      background: "white",
                      border: "1px solid rgba(12, 12, 12, 0.1)",
                      borderRadius: "8px",
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "#0C0C0C",
                    }}
                  >
                    {currentUser?.company || "-"}
                  </div>
                </div>

                {/* 연락처 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <label
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "rgba(12, 12, 12, 0.6)",
                      width: "100px",
                      flexShrink: 0,
                    }}
                  >
                    연락처
                  </label>
                  <div
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      background: "white",
                      border: "1px solid rgba(12, 12, 12, 0.1)",
                      borderRadius: "8px",
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "#0C0C0C",
                    }}
                  >
                    {currentUser?.phone || "-"}
                  </div>
                </div>
              </div>

              {/* 고객 정보 */}
              <div
                style={{
                  flex: 1,
                  background: "white",
                  borderRadius: "12px",
                  padding: "24px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                  <h3
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 500,
                      fontSize: "18px",
                      lineHeight: "128%",
                      letterSpacing: "-0.02em",
                      color: "#0C0C0C",
                      margin: 0,
                    }}
                  >
                    고객 정보
                  </h3>
                  <button
                    onClick={() => setCaseSearchModalOpen(true)}
                    className="hover-elevate active-elevate-2"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 16px",
                      background: "#253396",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      fontFamily: "Pretendard",
                      fontWeight: 500,
                      fontSize: "14px",
                      cursor: "pointer",
                    }}
                    data-testid="button-search-case"
                  >
                    <Search className="w-4 h-4" />
                    케이스 검색
                  </button>
                </div>
                
                {/* [2026-05-13] 고객 정보 — 작성자 정보와 동일한 가로 정렬(라벨 좌측, 값 우측) + 값 박스 테두리 추가로 통일 */}
                {/* 접수번호 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginBottom: "12px",
                  }}
                >
                  <label
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "rgba(12, 12, 12, 0.6)",
                      width: "100px",
                      flexShrink: 0,
                    }}
                  >
                    접수번호
                  </label>
                  <div
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      background: "white",
                      border: "1px solid rgba(12, 12, 12, 0.1)",
                      borderRadius: "8px",
                      fontFamily: "Pretendard",
                      fontWeight: 600,
                      fontSize: "14px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "#0C0C0C",
                    }}
                    data-testid="text-case-number"
                  >
                    {formatCaseNumber(estimateCase?.caseNumber) || "-"}
                  </div>
                </div>

                {/* 피보험자명 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginBottom: "12px",
                  }}
                >
                  <label
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "rgba(12, 12, 12, 0.6)",
                      width: "100px",
                      flexShrink: 0,
                    }}
                  >
                    피보험자명
                  </label>
                  <div
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      background: "white",
                      border: "1px solid rgba(12, 12, 12, 0.1)",
                      borderRadius: "8px",
                      fontFamily: "Pretendard",
                      fontWeight: 600,
                      fontSize: "14px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "#0C0C0C",
                    }}
                    data-testid="text-insured-name"
                  >
                    {estimateCase?.insuredName || "-"}
                  </div>
                </div>

                {/* 주소 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <label
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "rgba(12, 12, 12, 0.6)",
                      width: "100px",
                      flexShrink: 0,
                    }}
                  >
                    주소
                  </label>
                  <div
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      background: "white",
                      border: "1px solid rgba(12, 12, 12, 0.1)",
                      borderRadius: "8px",
                      fontFamily: "Pretendard",
                      fontWeight: 600,
                      fontSize: "14px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "#0C0C0C",
                    }}
                    data-testid="text-address"
                  >
                    {[estimateCase?.insuredAddress, (estimateCase as any)?.insuredAddressDetail].filter(Boolean).join(" ") || "-"}
                  </div>
                </div>
              </div>
            </div>

            {/* 복구면적 산출표 섹션 - 손해방지 케이스에서는 숨김 */}
            {!isLossPreventionCase && (
            <div style={{ marginTop: "40px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "12px",
                }}
              >
                <div>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 600,
                      fontSize: "16px",
                      letterSpacing: "-0.02em",
                      color: "#0C0C0C",
                    }}
                  >
                    복구면적 산출표
                  </span>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      color: "#686A6E",
                      marginLeft: "12px",
                    }}
                  >
                    {getCurrentDate()}
                  </span>
                </div>
                {/* [정책 2026-05-12] 견적서 탭의 복구면적 산출표는 결과 조회 전용 → 행 추가/삭제 버튼 제거 */}
              </div>
              
              {/* 복구면적 산출표 테이블 */}
              {rows.length > 0 && (
                <div
                  style={{
                    background: "white",
                    boxShadow: "0px 0px 20px #DBE9F5",
                    borderRadius: "8px",
                    overflow: "auto",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      minWidth: "1400px",
                      tableLayout: "auto",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: "#f4f5fa",
                          borderBottom: "1px solid rgba(12, 12, 12, 0.06)",
                        }}
                      >
                        {/* [정책 2026-05-12] 견적서 탭은 조회 전용 → 행별 체크박스 컬럼 제거 */}
                        {/* [2026-05-13] 장소/위치/공종/공사명은 한국어 텍스트가 줄바꿈되지 않도록 whiteSpace nowrap + 헤더 padding 축소 */}
                        <th style={{ padding: "12px 8px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "rgba(12, 12, 12, 0.6)", whiteSpace: "nowrap" }}>장소</th>
                        <th style={{ padding: "12px 8px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "rgba(12, 12, 12, 0.6)", whiteSpace: "nowrap" }}>위치</th>
                        <th style={{ padding: "12px 8px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "rgba(12, 12, 12, 0.6)", whiteSpace: "nowrap" }}>공종</th>
                        <th style={{ padding: "12px 8px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "rgba(12, 12, 12, 0.6)", whiteSpace: "nowrap" }}>공사명</th>
                        <th style={{ padding: "12px 8px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "rgba(12, 12, 12, 0.6)", whiteSpace: "nowrap" }}>피해면적 가로(m)</th>
                        <th style={{ padding: "12px 8px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "rgba(12, 12, 12, 0.6)", whiteSpace: "nowrap" }}>피해면적 세로(m)</th>
                        <th style={{ padding: "12px 8px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "rgba(12, 12, 12, 0.6)", whiteSpace: "nowrap" }}>피해면적(㎡)</th>
                        <th style={{ padding: "12px 8px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "rgba(12, 12, 12, 0.6)", whiteSpace: "nowrap" }}>복구면적 가로(m)</th>
                        <th style={{ padding: "12px 8px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "rgba(12, 12, 12, 0.6)", whiteSpace: "nowrap" }}>복구면적 세로(m)</th>
                        <th style={{ padding: "12px 8px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "rgba(12, 12, 12, 0.6)", whiteSpace: "nowrap" }}>복구면적(㎡)</th>
                        {showNote && (
                        <th style={{ padding: "12px 8px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "rgba(12, 12, 12, 0.6)", whiteSpace: "nowrap" }}>비고</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={row.id} style={{ borderBottom: "1px solid rgba(12, 12, 12, 0.06)" }}>
                          {/* [정책 2026-05-12] 견적서 탭은 조회 전용 → 행별 체크박스 셀 제거 */}
                          {/* [정책 2026-05-12] 장소/위치/공종/공사명 — disabled select 대신 plain text div로 표시.
                              이유: native select는 옵션 목록(마스터데이터 roomCategories/locations 등)에 row 값이 없으면 빈 "선택"으로 표시되어 실제 저장값이 누락된 듯 보임.
                              조회 전용이므로 row 값을 직접 표시하면 마스터데이터 의존성 제거 + 면적 칸과 동일 외형으로 통일. */}
                          <td style={{ padding: "8px" }}>
                            <div
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                border: "1px solid rgba(12, 12, 12, 0.1)",
                                borderRadius: "4px",
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                color: row.category ? "#0C0C0C" : "rgba(12, 12, 12, 0.4)",
                                background: "white",
                                minHeight: "32px",
                                display: "flex",
                                alignItems: "center",
                                whiteSpace: "nowrap",
                              }}
                            >{row.category || "-"}</div>
                          </td>
                          <td style={{ padding: "8px" }}>
                            <div
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                border: "1px solid rgba(12, 12, 12, 0.1)",
                                borderRadius: "4px",
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                color: row.location ? "#0C0C0C" : "rgba(12, 12, 12, 0.4)",
                                background: "white",
                                minHeight: "32px",
                                display: "flex",
                                alignItems: "center",
                                whiteSpace: "nowrap",
                              }}
                            >{row.location || "-"}</div>
                          </td>
                          <td style={{ padding: "8px" }}>
                            <div
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                border: "1px solid rgba(12, 12, 12, 0.1)",
                                borderRadius: "4px",
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                color: row.workType ? "#0C0C0C" : "rgba(12, 12, 12, 0.4)",
                                background: "white",
                                minHeight: "32px",
                                display: "flex",
                                alignItems: "center",
                                whiteSpace: "nowrap",
                              }}
                            >{row.workType || "-"}</div>
                          </td>
                          <td style={{ padding: "8px" }}>
                            <div
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                border: "1px solid rgba(12, 12, 12, 0.1)",
                                borderRadius: "4px",
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                color: row.workName ? "#0C0C0C" : "rgba(12, 12, 12, 0.4)",
                                background: "white",
                                minHeight: "32px",
                                display: "flex",
                                alignItems: "center",
                                whiteSpace: "nowrap",
                              }}
                            >{row.workName || "-"}</div>
                          </td>
                          <td style={{ padding: "8px" }}>
                            <input
                              type="text"
                              value={row.damageWidth}
                              onChange={(e) => updateRow(row.id, 'damageWidth', e.target.value)}
                              disabled={true}
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                border: "1px solid rgba(12, 12, 12, 0.1)",
                                borderRadius: "4px",
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                textAlign: "right",
                                background: isReadOnly ? "white" : undefined,
                              }}
                            />
                          </td>
                          <td style={{ padding: "8px" }}>
                            <input
                              type="text"
                              value={row.damageHeight}
                              onChange={(e) => updateRow(row.id, 'damageHeight', e.target.value)}
                              disabled={true}
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                border: "1px solid rgba(12, 12, 12, 0.1)",
                                borderRadius: "4px",
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                textAlign: "right",
                                background: isReadOnly ? "white" : undefined,
                              }}
                            />
                          </td>
                          {/* [정책 2026-05-12] 견적서 탭 자동계산 면적 — 인접 disabled 입력과 동일 외형(border + radius 4px)으로 통일
                              [2026-05-13] plain div는 disabled input보다 테두리가 옅게 렌더링되어 시각적으로 사라지는 문제 → border rgba 0.1 → 0.2로 진하게 */}
                          <td style={{ padding: "8px" }}>
                            <div
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                border: "1px solid rgba(12, 12, 12, 0.2)",
                                borderRadius: "4px",
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                textAlign: "right",
                                background: "white",
                              }}
                            >{row.damageArea}</div>
                          </td>
                          <td style={{ padding: "8px" }}>
                            <input
                              type="text"
                              value={row.repairWidth}
                              onChange={(e) => updateRow(row.id, 'repairWidth', e.target.value)}
                              disabled={true}
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                border: "1px solid rgba(12, 12, 12, 0.1)",
                                borderRadius: "4px",
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                textAlign: "right",
                                background: isReadOnly ? "white" : undefined,
                              }}
                            />
                          </td>
                          <td style={{ padding: "8px" }}>
                            <input
                              type="text"
                              value={row.repairHeight}
                              onChange={(e) => updateRow(row.id, 'repairHeight', e.target.value)}
                              disabled={true}
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                border: "1px solid rgba(12, 12, 12, 0.1)",
                                borderRadius: "4px",
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                textAlign: "right",
                                background: isReadOnly ? "white" : undefined,
                              }}
                            />
                          </td>
                          {/* [정책 2026-05-12] 견적서 탭 자동계산 면적 — 인접 disabled 입력과 동일 외형(border + radius 4px)으로 통일
                              [2026-05-13] plain div는 disabled input보다 테두리가 옅게 렌더링되어 시각적으로 사라지는 문제 → border rgba 0.1 → 0.2로 진하게 */}
                          <td style={{ padding: "8px" }}>
                            <div
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                border: "1px solid rgba(12, 12, 12, 0.2)",
                                borderRadius: "4px",
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                textAlign: "right",
                                background: "white",
                              }}
                            >{row.repairArea}</div>
                          </td>
                          {showNote && (
                          <td style={{ padding: "8px" }}>
                            <input
                              type="text"
                              value={row.note}
                              onChange={(e) => updateRow(row.id, 'note', e.target.value)}
                              disabled={true}
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                border: "1px solid rgba(12, 12, 12, 0.1)",
                                borderRadius: "4px",
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                background: isReadOnly ? "white" : undefined,
                              }}
                            />
                          </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            )}

            {/* 노무비 섹션 - 노무비 탭과 동일 */}
            <div style={{ marginTop: "40px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "12px",
                }}
              >
                <div>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 600,
                      fontSize: "16px",
                      letterSpacing: "-0.02em",
                      color: "#0C0C0C",
                    }}
                  >
                    노무비
                  </span>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      color: "#686A6E",
                      marginLeft: "12px",
                    }}
                  >
                    {getCurrentDate()}
                  </span>
                </div>
              </div>
              
              {/* 노무비 테이블 - 노무비 탭과 동일한 LaborCostSection 사용 */}
              <LaborCostSection
                rows={laborCostRows}
                onRowsChange={handleLaborRowsChange}
                catalog={laborCatalog}
                ilwidaegaCatalog={mergedIlwidaegaCatalog}
                selectedRows={selectedLaborRows}
                onSelectRow={toggleLaborRow}
                onSelectAll={() => {
                  if (selectedLaborRows.size === laborCostRows.length) {
                    setSelectedLaborRows(new Set());
                  } else {
                    setSelectedLaborRows(new Set(laborCostRows.map(r => r.id)));
                  }
                }}
                isLoading={isLoadingLaborCatalog}
                areaCalculationRows={rows.map(r => ({
                  id: r.id,
                  category: r.category,
                  location: r.location,
                  workType: r.workType,
                  workName: r.workName,
                  damageArea: r.damageArea,
                  repairArea: r.repairArea,
                  width: r.repairWidth,
                  height: r.repairHeight,
                }))}
                filteredWorkTypes={workTypes}
                isReadOnly={true}
                onAreaImportToMaterial={handleAreaImportToMaterial}
                enableAreaImport={!isLossPreventionCase}
                isHydrated={isHydratedState}
                laborRateTiers={laborRateTiers}
                isLossPreventionCase={isLossPreventionCase}
                isPartner={isPartner}
              />
            </div>

            {/* 자재비 섹션 - 자재비 탭과 동일 */}
            <div style={{ marginTop: "40px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "12px",
                }}
              >
                <div>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 600,
                      fontSize: "16px",
                      letterSpacing: "-0.02em",
                      color: "#0C0C0C",
                    }}
                  >
                    자재비
                  </span>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      color: "#686A6E",
                      marginLeft: "12px",
                    }}
                  >
                    {getCurrentDate()}
                  </span>
                </div>
              </div>
              
              {/* 자재비 테이블 - 자재비 탭과 동일한 MaterialCostSection 사용 (견적서 탭은 결과 조회 전용) */}
              <MaterialCostSection
                rows={materialRows}
                onRowsChange={setMaterialRows}
                catalog={transformedMaterialCatalog}
                laborCategories={workTypes}
                selectedRows={selectedMaterialRows}
                onSelectRow={toggleSelectMaterialRow}
                onSelectAll={toggleSelectAllMaterialRows}
                isLoading={isLoadingMaterialCatalog}
                isReadOnly={true}
                caseNumber={selectedCase?.caseNumber || ''}
                isPartner={isPartner}
              />
            </div>

            {/* 합계 섹션 */}
            <div
              style={{
                marginTop: "40px",
                background: "white",
                borderRadius: "12px",
                padding: "24px 32px",
              }}
            >
              {/* [2026-05-13] 합계 섹션 — 현장출동보고서 견적서 탭과 동일하게 가로 폭 좁히고 행간/폰트 축소
                  · 소계~VAT: fontSize 16→14, marginBottom 16→0(부모 gap 8px), VAT 라디오 라벨 14→13
                  · 구분선 margin 20→12, borderTopWidth 2px
                  · 총 합계: 라벨 18/600 #0C0C0C → 16/700 #253396, 금액 24/700 → 18/700 (#253396 유지)
                  · [2026-05-13 추가] maxWidth 400px + marginLeft auto → 우측 정렬해서 라벨↔금액 사이 빈공간 축소 (현장출동보고서와 동일) */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "400px", marginLeft: "auto" }}>
              {/* 소계 */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                }}
              >
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#0C0C0C",
                  }}
                >
                  소계
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#0C0C0C",
                  }}
                  data-testid="text-subtotal"
                >
                  {estimateSummary.subtotal.toLocaleString()}원
                </span>
              </div>

              {/* 일반관리비 (6%) */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                }}
              >
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#0C0C0C",
                  }}
                >
                  일반관리비 (6%)
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#0C0C0C",
                  }}
                  data-testid="text-managementFee"
                >
                  {estimateSummary.managementFee.toLocaleString()}원
                </span>
              </div>

              {/* 이윤 (15%) */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                }}
              >
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#0C0C0C",
                  }}
                >
                  이윤 (15%)
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#0C0C0C",
                  }}
                  data-testid="text-profit"
                >
                  {estimateSummary.profit.toLocaleString()}원
                </span>
              </div>

              {/* 만원단위절사 */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                }}
              >
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#0C0C0C",
                  }}
                >천원단위 절사</span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#0C0C0C",
                  }}
                  data-testid="text-truncation"
                >
                  -{estimateSummary.truncation.toLocaleString()}원
                </span>
              </div>

              {/* VAT */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "#0C0C0C",
                    }}
                  >
                    VAT (10%)
                  </span>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="vat"
                        checked={vatIncluded}
                        onChange={() => setVatIncluded(true)}
                        style={{ cursor: "pointer", accentColor: "#253396" }}
                        data-testid="radio-vat-included"
                      />
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "13px",
                          fontWeight: 500,
                          color: vatIncluded ? "#253396" : "#686A6E",
                        }}
                      >
                        포함
                      </span>
                    </label>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="vat"
                        checked={!vatIncluded}
                        onChange={() => setVatIncluded(false)}
                        style={{ cursor: "pointer", accentColor: "#253396" }}
                        data-testid="radio-vat-excluded"
                      />
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "13px",
                          fontWeight: 500,
                          color: !vatIncluded ? "#253396" : "#686A6E",
                        }}
                      >
                        별도
                      </span>
                    </label>
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#0C0C0C",
                  }}
                  data-testid="text-vat"
                >
                  {estimateSummary.vat.toLocaleString()}원
                </span>
              </div>

              {/* 총 합계 — 상단 2px border로 구분 */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 0 0",
                  marginTop: "4px",
                  borderTop: "2px solid rgba(12, 12, 12, 0.1)",
                }}
              >
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 700,
                    color: "#253396",
                  }}
                >
                  총 합계
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "18px",
                    fontWeight: 700,
                    color: "#253396",
                  }}
                  data-testid="text-total"
                >
                  {estimateSummary.total.toLocaleString()}원
                </span>
              </div>
              </div>
            </div>

            {/* 저장 버튼 */}
            <div
              style={{
                marginTop: "24px",
                display: "flex",
                justifyContent: "flex-end",
                gap: "12px",
              }}
            >
              {/* 관련 케이스에서 견적서 복제 버튼 */}
              {relatedEstimateInfo?.hasRelatedEstimate && !latestEstimate?.estimate && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      disabled={cloneEstimateMutation.isPending}
                      style={{
                        padding: "12px 32px",
                        background: cloneEstimateMutation.isPending ? "#ccc" : "#F59E0B",
                        border: "none",
                        borderRadius: "8px",
                        fontFamily: "Pretendard",
                        fontSize: "16px",
                        fontWeight: 600,
                        color: "white",
                        cursor: cloneEstimateMutation.isPending ? "not-allowed" : "pointer",
                        boxShadow: "0px 2px 8px rgba(245, 158, 11, 0.3)",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                      data-testid="button-clone-estimate"
                    >
                      <Copy className="w-4 h-4" />
                      {cloneEstimateMutation.isPending ? "복제 중..." : "관련 견적서 가져오기"}
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>관련 케이스에서 견적서 복제</AlertDialogTitle>
                      <AlertDialogDescription>
                        <span className="font-semibold">{formatCaseNumber(relatedEstimateInfo.sourceCaseNumber)}</span> 케이스의 견적서를 복제하시겠습니까?
                        <br />
                        복제 후에도 개별적으로 수정할 수 있습니다.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>취소</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          if (relatedEstimateInfo.sourceCaseId) {
                            cloneEstimateMutation.mutate(relatedEstimateInfo.sourceCaseId);
                          }
                        }}
                        data-testid="button-confirm-clone-estimate"
                      >
                        복제하기
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending || isReadOnly}
                style={{
                  padding: "12px 32px",
                  background: (saveMutation.isPending || isReadOnly) ? "#ccc" : "#253396",
                  border: "none",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "white",
                  cursor: (saveMutation.isPending || isReadOnly) ? "not-allowed" : "pointer",
                  boxShadow: (saveMutation.isPending || isReadOnly) ? "none" : "0px 2px 8px rgba(37, 51, 150, 0.3)",
                }}
                data-testid="button-save-estimate"
              >
                {isReadOnly ? "수정 불가" : saveMutation.isPending ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        )}

        {/* 노무비 컨텐츠 - NEW */}
        {selectedCategory === "노무비" && (
          <div>
            {/* 노무비 섹션 */}
            <div style={{ marginTop: "40px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "12px",
                }}
              >
                <div>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 600,
                      fontSize: "16px",
                      letterSpacing: "-0.02em",
                      color: "#0C0C0C",
                    }}
                  >
                    노무비
                  </span>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      color: "#686A6E",
                      marginLeft: "12px",
                    }}
                  >
                    {getCurrentDate()}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {/* 손방 케이스용 샘플 버튼: 노무비/자재비 동시 교체 */}
                  {isLossPreventionCase && (
                    <div className="flex flex-wrap justify-end gap-2">
                      {LOSS_PREVENTION_SAMPLE_TEMPLATES.map(template => (
                        <button
                          key={template.key}
                          type="button"
                          onClick={() => setPendingLossSampleKey(template.key)}
                          disabled={isReadOnly}
                          className="px-3 py-2 rounded-md hover-elevate active-elevate-2"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "13px",
                            fontWeight: 500,
                            background: isReadOnly ? "#f5f5f5" : "white",
                            color: isReadOnly ? "rgba(12, 12, 12, 0.3)" : "#253396",
                            border: isReadOnly ? "1px solid rgba(12, 12, 12, 0.1)" : "1px solid #253396",
                            cursor: isReadOnly ? "not-allowed" : "pointer",
                            opacity: isReadOnly ? 0.6 : 1,
                          }}
                          data-testid={`button-loss-sample-labor-${template.key}`}
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>
                  )}
                <div style={{ display: "flex", gap: "6px" }}>
                  {/* 손해방지 케이스는 복구면적 산출표가 없으므로 숨김 */}
                  {!isLossPreventionCase && (
                    <Button
                      onClick={() => syncLaborFromRecoveryArea({ clearDeletedKeys: true })}
                      variant="outline"
                      size="sm"
                      disabled={rows.length === 0 || isReadOnly}
                      style={{
                        borderColor: rows.length === 0 ? "#d1d5db" : "#10B981",
                        color: rows.length === 0 ? "#9ca3af" : "#10B981",
                      }}
                      data-testid="button-sync-labor-from-recovery"
                    >
                      <Copy className="h-4 w-4 mr-1" />
                      복구면적 가져오기
                    </Button>
                  )}
                  <Button
                    onClick={addLaborRow}
                    variant="outline"
                    size="sm"
                    disabled={isLoadingLaborCatalog || isReadOnly}
                    style={{
                      borderColor: "#253396",
                      color: "#253396",
                    }}
                    data-testid="button-add-labor-category"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    공종추가
                  </Button>
                  <Button
                    onClick={deleteSelectedLaborRows}
                    variant="outline"
                    size="sm"
                    disabled={selectedLaborRows.size === 0 || isReadOnly || (isPartner && laborCostRows.some(r => selectedLaborRows.has(r.id) && r.isLinkedFromRecovery))}
                    style={{
                      borderColor: (selectedLaborRows.size === 0 || (isPartner && laborCostRows.some(r => selectedLaborRows.has(r.id) && r.isLinkedFromRecovery))) ? "#d1d5db" : "#FF4D4F",
                      color: (selectedLaborRows.size === 0 || (isPartner && laborCostRows.some(r => selectedLaborRows.has(r.id) && r.isLinkedFromRecovery))) ? "#9ca3af" : "#FF4D4F",
                    }}
                    data-testid="button-delete-labor-rows"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    삭제
                  </Button>
                </div>
                </div>
              </div>

              {/* 손방 샘플 적용 확인 다이얼로그 (노무비 탭) */}
              <AlertDialog
                open={pendingLossSampleKey !== null}
                onOpenChange={(open) => { if (!open) setPendingLossSampleKey(null); }}
              >
                <AlertDialogContent data-testid="dialog-loss-sample-confirm">
                  <AlertDialogHeader>
                    <AlertDialogTitle>샘플 불러오기 확인</AlertDialogTitle>
                    <AlertDialogDescription>
                      샘플을 불러오면 현재 입력 중인 내용이 초기화됩니다. 계속하시겠습니까?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-loss-sample-cancel">취소</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleLossSampleConfirm}
                      data-testid="button-loss-sample-confirm"
                      className="bg-[#253396] text-white hover:bg-[#253396]/90"
                    >
                      확인
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {/* 노무비 테이블 컴포넌트 - 새로운 프롬프트 기반 UI */}
              <LaborCostSection
                rows={laborCostRows}
                onRowsChange={handleLaborRowsChange}
                catalog={laborCatalog}
                ilwidaegaCatalog={mergedIlwidaegaCatalog}
                selectedRows={selectedLaborRows}
                onSelectRow={toggleLaborRow}
                onSelectAll={() => {
                  if (selectedLaborRows.size === laborCostRows.length) {
                    setSelectedLaborRows(new Set());
                  } else {
                    setSelectedLaborRows(new Set(laborCostRows.map(r => r.id)));
                  }
                }}
                isLoading={isLoadingLaborCatalog}
                areaCalculationRows={rows.map(r => ({
                  id: r.id,
                  category: r.category,
                  location: r.location,
                  workType: r.workType,
                  workName: r.workName,
                  damageArea: r.damageArea,
                  repairArea: r.repairArea,
                  width: r.repairWidth,
                  height: r.repairHeight,
                }))}
                filteredWorkTypes={workTypes}
                isReadOnly={isReadOnly}
                onAreaImportToMaterial={handleAreaImportToMaterial}
                enableAreaImport={!isLossPreventionCase}
                isHydrated={isHydratedState}
                laborRateTiers={laborRateTiers}
                isLossPreventionCase={isLossPreventionCase}
                isPartner={isPartner}
              />
            </div>

            {/* 기존 노무비 테이블 (임시 주석 처리) */}
            {false && laborCostRows.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "separate",
                      borderSpacing: 0,
                      minWidth: "1800px",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: "#f4f5fa",
                          height: "48px",
                        }}
                      >
                        <th style={{ width: "50px", padding: "0 12px", textAlign: "center", borderBottom: "1px solid #E5E7EB" }}>
                          <Checkbox
                            data-testid="checkbox-select-all-labor"
                            className="data-[state=checked]:bg-[#253396] data-[state=checked]:border-[#253396] data-[state=checked]:text-white border-[#253396]"
                          />
                        </th>
                        <th style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.6)", textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>공종</th>
                        <th style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.6)", textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>공사명</th>
                        <th style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.6)", textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>세부공사</th>
                        <th style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.6)", textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>세부항목</th>
                        <th style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.6)", textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>단가 기준</th>
                        <th style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.6)", textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>단위</th>
                        <th style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.6)", textAlign: "right", borderBottom: "1px solid #E5E7EB" }}>기준가(단위)</th>
                        <th style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.6)", textAlign: "right", borderBottom: "1px solid #E5E7EB" }}>수량(인)</th>
                        <th style={{ width: "200px", padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.6)", textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>적용률</th>
                        <th style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.6)", textAlign: "right", borderBottom: "1px solid #E5E7EB" }}>적용단가</th>
                        <th style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.6)", textAlign: "right", borderBottom: "1px solid #E5E7EB" }}>피해면적</th>
                        <th style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.6)", textAlign: "right", borderBottom: "1px solid #E5E7EB" }}>공제(원)</th>
                        <th style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.6)", textAlign: "center", borderBottom: "1px solid #E5E7EB" }}>경비여부</th>
                        <th style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.6)", textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>요청</th>
                      </tr>
                    </thead>
                    <tbody>
                      {laborCostRows.map((row, index) => (
                        <tr key={row.id} style={{ height: "56px", borderBottom: "1px solid #E5E7EB" }}>
                          {/* 체크박스 */}
                          <td style={{ padding: "0 12px", textAlign: "center" }}>
                            <Checkbox 
                              className="data-[state=checked]:bg-[#253396] data-[state=checked]:border-[#253396] data-[state=checked]:text-white border-[#253396]"
                              checked={selectedLaborRows.has(row.id)}
                              onCheckedChange={(checked) => {
                                const newSet = new Set(selectedLaborRows);
                                if (checked) {
                                  newSet.add(row.id);
                                } else {
                                  newSet.delete(row.id);
                                }
                                setSelectedLaborRows(newSet);
                              }}
                              data-testid={`checkbox-labor-${index}`}
                            />
                          </td>
                          
                          {/* 공종 - Select */}
                          <td style={{ padding: "0 8px" }}>
                            <Select value={row.category || undefined} onValueChange={(value) => {
                              setLaborCostRows(prev => prev.map(r => {
                                if (r.id === row.id) {
                                  // 누수탐지비용 선택 시 초기화
                                  if (value === "누수탐지비용") {
                                    return {
                                      ...r,
                                      category: value,
                                      workName: "종합검사",
                                      detailWork: "",
                                      standardPrice: 0,
                                      unit: "회",
                                      // [누수탐지 경비여부 자동체크 2026-05-04] 누수탐지비용 = 경비 항목
                                      includeInEstimate: false,
                                    };
                                  }
                                  // [누수탐지 경비여부 자동체크 2026-05-04] 공종이 "누수탐지"면 경비 자동 체크
                                  if (value === "누수탐지") {
                                    return { ...r, category: value, includeInEstimate: false };
                                  }
                                  return { ...r, category: value };
                                }
                                return r;
                              }));
                            }}>
                              <SelectTrigger 
                                className="h-9 border-0" 
                                style={{ fontFamily: "Pretendard", fontSize: "14px" }}
                                data-testid={`select-category-${index}`}
                              >
                                <SelectValue placeholder="공종 선택" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="가구공사">가구공사</SelectItem>
                                <SelectItem value="도배공사">도배공사</SelectItem>
                                <SelectItem value="미장공사">미장공사</SelectItem>
                                <SelectItem value="수장공사">수장공사</SelectItem>
                                <SelectItem value="누수탐지비용">누수탐지비용</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          
                          {/* 공사명 - Read-only */}
                          <td style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", color: "rgba(12, 12, 12, 0.8)" }}>
                            {row.workName}
                          </td>
                          
                          {/* 세부공사 - 누수탐지비용일 때만 Select, 나머지는 Read-only */}
                          <td style={{ padding: row.category === "누수탐지비용" ? "0 8px" : "0 12px" }}>
                            {row.category === "누수탐지비용" ? (
                              <Select 
                                value={row.detailWork || undefined} 
                                onValueChange={(value) => {
                                  setLaborCostRows(prev => prev.map(r => {
                                    if (r.id === row.id) {
                                      // 세부공사에 따라 기준가 설정
                                      let price = 0;
                                      if (value === "1회") price = 300000;
                                      else if (value === "2회") price = 400000;
                                      else if (value === "3회 이상") price = 500000;
                                      
                                      return {
                                        ...r,
                                        detailWork: value,
                                        standardPrice: price
                                      };
                                    }
                                    return r;
                                  }));
                                }}
                              >
                                <SelectTrigger 
                                  className="h-9 border-0" 
                                  style={{ fontFamily: "Pretendard", fontSize: "14px" }}
                                  data-testid={`select-detail-work-${index}`}
                                >
                                  <SelectValue placeholder="선택하세요" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="1회">1회</SelectItem>
                                  <SelectItem value="2회">2회</SelectItem>
                                  <SelectItem value="3회 이상">3회 이상</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <span style={{ fontFamily: "Pretendard", fontSize: "14px", color: "rgba(12, 12, 12, 0.8)" }}>
                                {row.detailWork}
                              </span>
                            )}
                          </td>
                          
                          {/* 세부항목 - Read-only */}
                          <td style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", color: "rgba(12, 12, 12, 0.6)" }}>
                            {row.detailItem || "-"}
                          </td>
                          
                          {/* 단가 기준 - Select */}
                          <td style={{ padding: "0 8px" }}>
                            <Select value={row.priceStandard || undefined} onValueChange={(value) => {
                              setLaborCostRows(prev => prev.map(r => r.id === row.id ? { ...r, priceStandard: value } : r));
                            }}>
                              <SelectTrigger 
                                className="h-9 border-0" 
                                style={{ fontFamily: "Pretendard", fontSize: "14px" }}
                                data-testid={`select-price-standard-${index}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="민">민</SelectItem>
                                <SelectItem value="위">위</SelectItem>
                                <SelectItem value="기">기</SelectItem>
                                <SelectItem value="JV">JV</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          
                          {/* 단위 - Read-only */}
                          <td style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", color: "rgba(12, 12, 12, 0.8)" }} data-testid={`text-unit-${index}`}>
                            {row.unit || "-"}
                          </td>
                          
                          {/* 기준가(단위) - Read-only */}
                          <td style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", color: "rgba(12, 12, 12, 0.8)", textAlign: "right" }}>
                            {Number(row.standardPrice).toLocaleString()}
                          </td>
                          
                          {/* 수량(인) - Editable Input */}
                          <td style={{ padding: "0 8px", background: "white" }}>
                            <Input
                              value={row.quantity}
                              onChange={(e) => {
                                setLaborCostRows(prev => prev.map(r => r.id === row.id ? { ...r, quantity: Number(e.target.value) || 0 } : r));
                              }}
                              className="h-9 border-0 bg-transparent text-right"
                              style={{ fontFamily: "Pretendard", fontSize: "14px" }}
                              data-testid={`input-quantity-${index}`}
                            />
                          </td>
                          
                          {/* 적용률 - Checkboxes + Input */}
                          <td style={{ padding: "0 8px", background: "white" }}>
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                <Checkbox 
                                  checked={row.applicationRates.ceiling}
                                  onCheckedChange={(checked) => {
                                    setLaborCostRows(prev => prev.map(r => r.id === row.id ? { 
                                      ...r, 
                                      applicationRates: { ...r.applicationRates, ceiling: !!checked }
                                    } : r));
                                  }}
                                  data-testid={`checkbox-ceiling-${index}`}
                                />
                                <label style={{ fontFamily: "Pretendard", fontSize: "13px", color: row.applicationRates.ceiling ? "#222" : "rgba(12, 12, 12, 0.6)" }}>천장</label>
                              </div>
                              <div className="flex items-center gap-1">
                                <Checkbox 
                                  checked={row.applicationRates.wall}
                                  onCheckedChange={(checked) => {
                                    setLaborCostRows(prev => prev.map(r => r.id === row.id ? { 
                                      ...r, 
                                      applicationRates: { ...r.applicationRates, wall: !!checked }
                                    } : r));
                                  }}
                                  data-testid={`checkbox-wall-${index}`}
                                />
                                <label style={{ fontFamily: "Pretendard", fontSize: "13px", color: row.applicationRates.wall ? "#222" : "rgba(12, 12, 12, 0.6)" }}>벽체</label>
                              </div>
                              <div className="flex items-center gap-1">
                                <Checkbox 
                                  checked={row.applicationRates.floor}
                                  onCheckedChange={(checked) => {
                                    setLaborCostRows(prev => prev.map(r => r.id === row.id ? { 
                                      ...r, 
                                      applicationRates: { ...r.applicationRates, floor: !!checked }
                                    } : r));
                                  }}
                                  data-testid={`checkbox-floor-${index}`}
                                />
                                <label style={{ fontFamily: "Pretendard", fontSize: "13px", color: row.applicationRates.floor ? "#222" : "rgba(12, 12, 12, 0.6)" }}>바닥</label>
                              </div>
                              <div className="flex items-center gap-1">
                                <Checkbox 
                                  checked={row.applicationRates.molding}
                                  onCheckedChange={(checked) => {
                                    setLaborCostRows(prev => prev.map(r => r.id === row.id ? { 
                                      ...r, 
                                      applicationRates: { ...r.applicationRates, molding: !!checked }
                                    } : r));
                                  }}
                                  data-testid={`checkbox-molding-${index}`}
                                />
                                <label style={{ fontFamily: "Pretendard", fontSize: "13px", color: row.applicationRates.molding ? "#222" : "rgba(12, 12, 12, 0.6)" }}>몰이</label>
                              </div>
                              <Input
                                value={row.salesMarkupRate}
                                onChange={(e) => {
                                  setLaborCostRows(prev => prev.map(r => r.id === row.id ? { ...r, salesMarkupRate: Number(e.target.value) || 0 } : r));
                                }}
                                className="h-9 w-16 border-0 bg-white text-right"
                                style={{ fontFamily: "Pretendard", fontSize: "14px" }}
                                data-testid={`input-rate-${index}`}
                              />
                            </div>
                          </td>
                          
                          {/* 적용단가 - Editable Input with comma formatting */}
                          <td style={{ padding: "0 8px", background: "white" }}>
                            <Input
                              type="text"
                              inputMode="numeric"
                              defaultValue={row.pricePerSqm > 0 ? row.pricePerSqm.toLocaleString() : ''}
                              key={`price-sqm-${row.id}-${row.pricePerSqm}`}
                              onFocus={(e) => {
                                const rawValue = e.target.value.replace(/[,\s]/g, '');
                                e.target.value = rawValue;
                              }}
                              onBlur={(e) => {
                                const rawValue = e.target.value.replace(/[,\s]/g, '');
                                const val = parseInt(rawValue, 10) || 0;
                                e.target.value = val > 0 ? val.toLocaleString() : '';
                                setLaborCostRows(prev => prev.map(r => r.id === row.id ? { ...r, pricePerSqm: val } : r));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                }
                              }}
                              className="h-9 border-0 bg-transparent text-right"
                              style={{ fontFamily: "Pretendard", fontSize: "14px", minWidth: "100px" }}
                              data-testid={`input-price-sqm-${index}`}
                            />
                          </td>

                          {/* 피해면적 - Read-only */}
                          <td style={{ padding: "0 12px", fontFamily: "Pretendard", fontSize: "14px", color: "rgba(12, 12, 12, 0.8)", textAlign: "right" }}>
                            {(row.damageArea || 0) > 0 ? Number(row.damageArea).toLocaleString() : "-"}
                          </td>

                          {/* 공제(원) - Editable Input */}
                          <td style={{ padding: "0 8px", background: "white" }}>
                            <Input
                              type="text"
                              inputMode="numeric"
                              defaultValue={row.deduction > 0 ? row.deduction.toLocaleString() : ''}
                              key={`deduction-${row.id}-${row.deduction}`}
                              onFocus={(e) => {
                                const rawValue = e.target.value.replace(/[,\s]/g, '');
                                e.target.value = rawValue;
                              }}
                              onBlur={(e) => {
                                const rawValue = e.target.value.replace(/[,\s]/g, '');
                                const val = parseInt(rawValue, 10) || 0;
                                e.target.value = val > 0 ? val.toLocaleString() : '';
                                setLaborCostRows(prev => prev.map(r => r.id === row.id ? { ...r, deduction: val } : r));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                }
                              }}
                              className="h-9 border-0 bg-transparent text-right"
                              style={{ fontFamily: "Pretendard", fontSize: "14px", minWidth: "80px" }}
                              data-testid={`input-deduction-${index}`}
                            />
                          </td>

                          {/* 경비여부 - Checkbox toggle */}
                          <td style={{ padding: "0 12px", textAlign: "center" }}>
                            <Checkbox
                              checked={!row.includeInEstimate}
                              onCheckedChange={(checked) => {
                                setLaborCostRows(prev => prev.map(r => r.id === row.id ? { ...r, includeInEstimate: !checked } : r));
                              }}
                              data-testid={`checkbox-expense-${index}`}
                            />
                          </td>

                          {/* 요청 - Editable Input */}
                          <td style={{ padding: "0 8px", background: "white" }}>
                            <Input
                              value={row.request || ''}
                              onChange={(e) => {
                                setLaborCostRows(prev => prev.map(r => r.id === row.id ? { ...r, request: e.target.value } : r));
                              }}
                              className="h-9 border-0 bg-transparent"
                              style={{ fontFamily: "Pretendard", fontSize: "14px", minWidth: "80px" }}
                              data-testid={`input-request-${index}`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        )}

        {/* 자재비 섹션 */}
        {selectedCategory === "자재비" && (
          <div style={{ marginTop: "40px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
              }}
            >
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "18px",
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                }}
              >
                자재비
              </span>
              <div className="flex flex-col items-end gap-2">
                {/* 손방 케이스용 샘플 버튼: 노무비/자재비 동시 교체 */}
                {isLossPreventionCase && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {LOSS_PREVENTION_SAMPLE_TEMPLATES.map(template => (
                      <button
                        key={template.key}
                        type="button"
                        onClick={() => setPendingLossSampleKey(template.key)}
                        disabled={isReadOnly}
                        className="px-3 py-2 rounded-md hover-elevate active-elevate-2"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "13px",
                          fontWeight: 500,
                          background: isReadOnly ? "#f5f5f5" : "white",
                          color: isReadOnly ? "rgba(12, 12, 12, 0.3)" : "#253396",
                          border: isReadOnly ? "1px solid rgba(12, 12, 12, 0.1)" : "1px solid #253396",
                          cursor: isReadOnly ? "not-allowed" : "pointer",
                          opacity: isReadOnly ? 0.6 : 1,
                        }}
                        data-testid={`button-loss-sample-material-${template.key}`}
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: "8px" }}>
                  {/* 손해방지 케이스는 복구면적 산출표가 없으므로 숨김 */}
                  {!isLossPreventionCase && (
                    <Button
                      onClick={() => syncMaterialFromRecoveryArea(true)}
                      variant="outline"
                      size="sm"
                      disabled={rows.length === 0 || isReadOnly}
                      style={{
                        borderColor: rows.length === 0 ? "#d1d5db" : "#10B981",
                        color: rows.length === 0 ? "#9ca3af" : "#10B981",
                      }}
                      data-testid="button-sync-material-from-recovery"
                    >
                      <Copy className="w-4 h-4 mr-1" />
                      복구면적 가져오기
                    </Button>
                  )}
                  <Button
                    onClick={addMaterialRow}
                    variant="outline"
                    size="sm"
                    disabled={isReadOnly}
                    data-testid="button-add-material-row"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    행 추가
                  </Button>
                  <Button
                    onClick={deleteSelectedMaterialRows}
                    variant="outline"
                    size="sm"
                    disabled={selectedMaterialRows.size === 0 || isReadOnly || (isPartner && materialRows.some(r => selectedMaterialRows.has(r.id) && (r.isLinkedFromRecovery || r.isAutoGenerated)))}
                    data-testid="button-delete-material-rows"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    선택 삭제
                  </Button>
                </div>
              </div>
            </div>

            {/* 손방 샘플 적용 확인 다이얼로그 (자재비 탭) */}
            <AlertDialog
              open={pendingLossSampleKey !== null}
              onOpenChange={(open) => { if (!open) setPendingLossSampleKey(null); }}
            >
              <AlertDialogContent data-testid="dialog-loss-sample-confirm-material">
                <AlertDialogHeader>
                  <AlertDialogTitle>샘플 불러오기 확인</AlertDialogTitle>
                  <AlertDialogDescription>
                    샘플을 불러오면 현재 입력 중인 내용이 초기화됩니다. 계속하시겠습니까?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-loss-sample-cancel-material">취소</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleLossSampleConfirm}
                    data-testid="button-loss-sample-confirm-material"
                    className="bg-[#253396] text-white hover:bg-[#253396]/90"
                  >
                    확인
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <MaterialCostSection
              rows={materialRows}
              onRowsChange={setMaterialRows}
              catalog={transformedMaterialCatalog}
              laborCategories={workTypes}
              selectedRows={selectedMaterialRows}
              onSelectRow={toggleSelectMaterialRow}
              onSelectAll={toggleSelectAllMaterialRows}
              isLoading={isLoadingMaterialCatalog}
              isReadOnly={isReadOnly}
              caseNumber={selectedCase?.caseNumber || ''}
              laborTotal={laborCostRows.reduce((sum, row) => sum + (row.amount || 0), 0)}
              isAdmin={currentUser?.role === "관리자"}
              isPartner={isPartner}
            />

            {/* 하단 버튼 */}
            <div
              className="flex justify-end items-center mt-8"
              style={{ padding: "20px 0" }}
            >
              <button
                type="button"
                onClick={handleSave}
                disabled={isReadOnly}
                className="hover-elevate active-elevate-2"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: 600,
                  height: "52px",
                  padding: "12px 48px",
                  background: isReadOnly ? "#ccc" : "#253396",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "8px",
                  cursor: isReadOnly ? "not-allowed" : "pointer",
                }}
                data-testid="button-save-material"
              >
                {isReadOnly ? "수정 불가" : "저장"}
              </button>
            </div>
          </div>
        )}

        {/* 하단 버튼 - 노무비 */}
        {selectedCategory === "노무비" && (
          <div
            className="flex justify-between items-center mt-8"
            style={{
              padding: "20px 0",
            }}
          >
            <button
              type="button"
              onClick={resetLaborTable}
              disabled={isReadOnly}
              style={{
                fontFamily: "Pretendard",
                fontSize: "16px",
                fontWeight: 600,
                color: isReadOnly ? "#ccc" : "#FF4D4F",
                background: "transparent",
                border: "none",
                cursor: isReadOnly ? "not-allowed" : "pointer",
              }}
              data-testid="button-reset-labor"
            >
              초기화
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={isReadOnly}
              className="hover-elevate active-elevate-2"
              style={{
                fontFamily: "Pretendard",
                fontSize: "16px",
                fontWeight: 600,
                height: "52px",
                padding: "12px 48px",
                background: isReadOnly ? "#ccc" : "#253396",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "8px",
                cursor: isReadOnly ? "not-allowed" : "pointer",
              }}
              data-testid="button-save-labor"
            >
              {isReadOnly ? "수정 불가" : "저장"}
            </button>
          </div>
        )}

        {/* 자재비 컨텐츠 */}

        {/* 하단 버튼 - 자재비 */}
      </div>
      {/* 케이스 선택 모달 */}
      <Dialog open={caseSearchModalOpen} onOpenChange={setCaseSearchModalOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle
              style={{
                fontFamily: "Pretendard",
                fontSize: "20px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "#0C0C0C",
              }}
            >
              케이스 선택
            </DialogTitle>
          </DialogHeader>

          {/* 검색 입력 */}
          <div className="mb-4">
            <Input
              placeholder="접수번호, 보험사, 보험사고번호, 계약자명, 피해자명, 피보험자주소 검색..."
              value={caseSearchQuery}
              onChange={(e) => setCaseSearchQuery(e.target.value)}
              className="w-full"
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
              data-testid="input-case-search"
            />
          </div>

          {/* 케이스 목록 */}
          <div className="space-y-2">
            {filteredCases.map((caseItem) => (
              <div
                key={caseItem.id}
                onClick={() => handleCaseSelect(caseItem.id!)}
                className={`p-4 rounded-lg cursor-pointer transition-all hover-elevate ${
                  selectedCaseId === caseItem.id ? 'ring-2 ring-blue-500' : ''
                }`}
                style={{
                  background: selectedCaseId === caseItem.id ? "rgba(37, 51, 150, 0.05)" : "white",
                  border: "1px solid rgba(12, 12, 12, 0.08)",
                }}
                data-testid={`case-item-${caseItem.id}`}
              >
                <div className="flex items-center gap-3">
                  {/* 선택 표시 */}
                  {selectedCaseId === caseItem.id && (
                    <div className="flex-shrink-0">
                      <Check className="w-5 h-5" style={{ color: "#253396" }} />
                    </div>
                  )}
                  
                  <div className="flex-1">
                    {/* 첫 번째 줄: 보험사 + 사고번호 */}
                    <div
                      className="mb-1"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "15px",
                        fontWeight: 600,
                        letterSpacing: "-0.02em",
                        color: "#0C0C0C",
                      }}
                    >
                      {caseItem.insuranceCompany || "보험사 미정"} {caseItem.insuranceAccidentNo || ""}
                    </div>

                    {/* 두 번째 줄: 접수번호, 계약자, 피해자, 상태 */}
                    <div
                      className="flex items-center gap-3 flex-wrap"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.6)",
                      }}
                    >
                      <span>접수번호: {formatCaseNumber(caseItem.caseNumber)}</span>
                      <span>피보험자: {caseItem.insuredName || caseItem.policyHolderName || caseItem.clientName || "미정"}</span>
                      <span>피해자: {caseItem.victimName || "미정"}</span>
                      <span className="px-2 py-0.5 rounded" style={{
                        background: "rgba(37, 51, 150, 0.1)",
                        color: "#253396",
                        fontSize: "12px",
                      }}>
                        {caseItem.status}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {filteredCases.length === 0 && (
              <div
                className="text-center py-12"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 400,
                  color: "rgba(12, 12, 12, 0.5)",
                }}
              >
                검색 결과가 없습니다
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </FieldSurveyLayout>
  );
}
