import { useQuery, useMutation } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatCaseNumber } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/use-permissions";
import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type {
  Drawing,
  CaseDocument as SchemaDocument,
  Case as SchemaCase,
  CaseDocument,
} from "@shared/schema";
import { SmsNotificationDialog } from "@/components/sms-notification-dialog";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";
import { NotoSansKR_Regular } from "@/lib/notoSansKRFont";

// 도면 표시 스케일: field-drawing.tsx와 동일하게 적용 (20mm = 1px)
const DISPLAY_SCALE = 0.05;

interface Case {
  id: string;
  caseNumber: string;
  insuranceCompany: string;
  insuranceAccidentNo: string;
  clientName: string;
  policyHolderName: string;
  insuredName: string;
  insuredContact: string;
  insuredAddress: string;
  accidentDate: string;
  accidentTime: string;
  assignedPartner: string;
  assignedPartnerManager: string;
  assignedPartnerContact: string;
  // 현장조사 정보
  visitDate: string | null;
  visitTime: string | null;
  travelDistance: string | null;
  dispatchLocation: string | null;
  accompaniedPerson: string | null;
  accidentCategory: string | null;
  accidentCause: string | null;
  specialNotes: string | null;
  victimName: string | null;
  victimContact: string | null;
  victimAddress: string | null;
  victimAddressDetail: string | null;
  additionalVictims: string | null;
  specialRequests: string | null;
  processingTypes: string | null;
  processingTypeOther: string | null;
  recoveryMethodType: string | null;
  additionalNotes: string | null;
  // 추가 필드
  fieldSurveyStatus?: string | null;
  progressStatus?: string | null;
  createdAt?: string | null;
  assignmentDate?: string | null;
  urgency?: string | null;
  status?: string | null;
  reportApprovalDecision?: string | null;
  // 심사사/조사사 정보
  assessorId?: string | null;
  assessorTeam?: string | null;
  assessorEmail?: string | null;
  investigatorTeam?: string | null;
  investigatorTeamName?: string | null;
  investigatorEmail?: string | null;
}

interface LaborCostRow {
  id?: string;
  category: string;
  workName: string;
  detailWork: string;
  detailItem?: string;
  priceStandard?: string;
  unit: string;
  standardPrice: number;
  quantity: number;
  amount: number;
  applicationRates?: {
    ceiling: boolean;
    wall: boolean;
    floor: boolean;
    molding: boolean;
  };
  pricePerSqm?: number;
  damageArea?: number;
  includeInEstimate?: boolean;
  request?: string;
}

interface MaterialCostRow {
  id?: string;
  공종: string;
  공사명?: string;
  자재?: string;
  자재항목?: string;
  규격?: string;
  단위?: string;
  단가?: number;
  기준단가?: number;
  수량?: number;
  합계?: number;
  금액?: number;
  비고?: string;
}

interface Estimate {
  id: string;
  caseId: string;
  version: number;
  status: string;
  laborCostData?: LaborCostRow[] | string | null;
  materialCostData?: MaterialCostRow[] | string | null;
  createdAt?: string;
}

interface EstimateRow {
  id: string;
  category: string;
  location: string;
  workName: string;
  damageWidth?: number;
  damageHeight?: number;
  damageArea: number;
  repairWidth?: number;
  repairHeight?: number;
  repairArea: number;
  note: string;
}

interface CompletionStatus {
  fieldSurvey: boolean;
  drawing: boolean;
  documents: boolean;
  estimate: boolean;
  isComplete: boolean;
  missingItems: string[]; // 미입력 항목 목록
}

interface ReportData {
  case: Case;
  drawing: Drawing | null;
  documents: SchemaDocument[];
  estimate: {
    estimate: Estimate | null;
    rows: EstimateRow[];
  };
  completionStatus: CompletionStatus;
}

// Safe parsing helpers with numeric field coercion and object validation
function safeParseLaborCosts(
  data: LaborCostRow[] | string | null | undefined,
): LaborCostRow[] {
  if (!data) return [];

  let rawData: any[];
  if (Array.isArray(data)) {
    rawData = data;
  } else if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      rawData = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  } else {
    return [];
  }

  // Filter out non-object entries and coerce numeric fields to ensure type safety
  return rawData
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({
      ...row,
      standardPrice: Number(row.standardPrice) || 0,
      quantity: Number(row.quantity) || 0,
      amount: Number(row.amount) || 0,
    }));
}

function safeParseMaterialCosts(
  data: MaterialCostRow[] | string | null | undefined,
): MaterialCostRow[] {
  if (!data) return [];

  let rawData: any[];
  if (Array.isArray(data)) {
    rawData = data;
  } else if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      rawData = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  } else {
    return [];
  }

  // Filter out non-object entries and coerce numeric fields to ensure type safety
  return rawData
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({
      ...row,
      기준단가: Number(row.기준단가) || 0,
      수량: Number(row.수량) || 0,
      금액: Number(row.금액) || 0,
    }));
}

export default function FieldReport() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // 현장입력에서 선택한 케이스 ID 가져오기 (문자열 "null" 방지)
  const getInitialCaseId = () => {
    const rawCaseId = localStorage.getItem("selectedFieldSurveyCaseId");
    return rawCaseId && rawCaseId !== "null" && rawCaseId !== "undefined"
      ? rawCaseId
      : "";
  };
  const [selectedCaseId, setSelectedCaseId] = useState(getInitialCaseId);

  // 종합진행관리에서 왔는지 확인
  const returnToComprehensiveProgress =
    localStorage.getItem("returnToComprehensiveProgress") === "true";

  // 현재 사용자 정보 가져오기
  const { data: currentUser, isLoading: isUserLoading } = useQuery<{
    id: string;
    role: string;
  }>({
    queryKey: ["/api/user"],
  });

  const isAdmin = currentUser?.role === "관리자";
  const isPartner = currentUser?.role === "협력사";

  // 권한 체크 - 보고서 승인 권한
  const { hasItem } = usePermissions();
  const canApproveReport = hasItem("관리자 설정", "보고서 승인");

  // 통합 보고서 데이터 가져오기
  const {
    data: reportData,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    status,
    fetchStatus,
  } = useQuery<ReportData>({
    queryKey: ["/api/field-surveys", selectedCaseId, "report"],
    enabled: !!selectedCaseId,
    retry: 2, // 실패 시 2회 재시도
    retryDelay: 1000, // 1초 후 재시도
    staleTime: 30000, // 30초 동안 데이터를 fresh로 유지
  });

  // 디버깅 로그
  useEffect(() => {
    console.log("[FieldReport] Query state:", {
      selectedCaseId,
      status,
      fetchStatus,
      isLoading,
      isFetching,
      isError,
      hasData: !!reportData,
      dataShape: reportData ? Object.keys(reportData) : null,
      error: error?.message,
    });
  }, [
    selectedCaseId,
    status,
    fetchStatus,
    isLoading,
    isFetching,
    isError,
    reportData,
    error,
  ]);

  // 협력사가 제출 후에는 증빙자료 외 모든 섹션 수정 불가 (반려 시는 수정 가능)
  const isPartnerReadOnly =
    isPartner &&
    reportData?.case?.fieldSurveyStatus === "submitted" &&
    reportData?.case?.status !== "반려";

  // 증빙자료 문서 목록 조회 (팝업용)
  const { data: allDocuments = [] } = useQuery<CaseDocument[]>({
    queryKey: ["/api/documents/case", selectedCaseId],
    enabled: !!selectedCaseId,
  });

  // 관련 접수건 조회 (심사하기용) - status 포함하여 현장출동보고서 제출건 필터링
  const { data: relatedCasesData } = useQuery<{
    relatedCases: Array<{
      caseId: string;
      caseNumber: string;
      status: string | null;
    }>;
  }>({
    queryKey: ["/api/cases", selectedCaseId, "related-drawings"],
    enabled: !!selectedCaseId,
  });

  // 손해방지(-0) 케이스 상태 조회 (승인 버튼 표시용)
  const { data: preventionCaseData } = useQuery<{
    preventionCase: {
      id: string;
      caseNumber: string;
      status: string;
      fieldSurveyStatus: string;
      reportApprovalDecision: string | null;
    } | null;
  }>({
    queryKey: ["/api/cases", selectedCaseId, "prevention-case-status"],
    enabled: !!selectedCaseId,
  });

  // 관련 접수건 심사하기 팝오버 상태
  const [isRelatedCasesPopoverOpen, setIsRelatedCasesPopoverOpen] =
    useState(false);

  // 기타사항 상태
  const [additionalNotes, setAdditionalNotes] = useState("");

  // 제출 확인 다이얼로그 상태
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);

  // 심사 다이얼로그 상태
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewDecision, setReviewDecision] = useState<"승인" | "비승인">(
    "승인",
  );
  const [reviewComment, setReviewComment] = useState("");

  // 보고서 승인 다이얼로그 상태 (2차 승인)
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [approvalDecision, setApprovalDecision] = useState<"승인" | "비승인">(
    "승인",
  );
  const [approvalComment, setApprovalComment] = useState("");

  // 이메일 입력 다이얼로그 상태 (Step 2)
  const [showEmailInputDialog, setShowEmailInputDialog] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  // 청구자료제출 다이얼로그 상태
  const [showClaimSubmitDialog, setShowClaimSubmitDialog] = useState(false);

  // 이메일 수신자 선택 상태 (심사사, 조사사 체크박스)
  const [selectedEmailRecipients, setSelectedEmailRecipients] = useState<{
    assessor: boolean;
    investigator: boolean;
    custom: boolean;
  }>({ assessor: false, investigator: false, custom: false });

  // 통합 PDF 다운로드/이메일 다이얼로그 상태 (Step 1)
  const [showPdfDialog, setShowPdfDialog] = useState(false);
  const [pdfDialogMode, setPdfDialogMode] = useState<"download" | "email">(
    "download",
  );
  const [downloadSections, setDownloadSections] = useState({
    현장입력: true,
    도면: true,
    증빙자료: true,
    견적서: true,
    기타사항: true,
  });

  // 증빙자료 문서 선택 상태
  type DocumentTabCategory =
    | "전체"
    | "현장사진"
    | "기본자료"
    | "증빙자료"
    | "청구자료";
  const [documentTab, setDocumentTab] = useState<DocumentTabCategory>("전체");
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(
    new Set(),
  );
  const [documentsInitialized, setDocumentsInitialized] = useState(false);

  // 증빙자료 체크 시 모든 문서 자동 선택 (다이얼로그 열릴 때만)
  useEffect(() => {
    if (
      showPdfDialog &&
      downloadSections.증빙자료 &&
      allDocuments.length > 0 &&
      !documentsInitialized
    ) {
      setSelectedDocuments(new Set(allDocuments.map((d) => d.id)));
      setDocumentsInitialized(true);
    }
  }, [
    showPdfDialog,
    downloadSections.증빙자료,
    allDocuments,
    documentsInitialized,
  ]);

  // 다이얼로그 닫힐 때 초기화 플래그 리셋
  useEffect(() => {
    if (!showPdfDialog) {
      setDocumentsInitialized(false);
    }
  }, [showPdfDialog]);

  // 케이스 변경 시 선택 상태 초기화 (다른 케이스의 문서가 섞이지 않도록)
  useEffect(() => {
    setSelectedDocuments(new Set());
    setDocumentsInitialized(false);
  }, [selectedCaseId]);

  // 탭별 문서 필터링
  const getFilteredDocuments = useMemo(() => {
    if (!allDocuments) return [];

    const categoryMapping: Record<DocumentTabCategory, string[]> = {
      전체: [],
      현장사진: ["현장출동사진", "수리중 사진", "복구완료 사진"],
      기본자료: ["보험금 청구서", "개인정보 동의서(가족용)"],
      증빙자료: [
        "주민등록등본",
        "등기부등본",
        "건축물대장",
        "기타증빙자료(민원일지 등)",
      ],
      청구자료: ["복구완료 및 위임장", "도급계약서", "부가세 청구자료"],
    };

    if (documentTab === "전체") {
      return allDocuments;
    }

    const allowedCategories = categoryMapping[documentTab];
    return allDocuments.filter((doc) =>
      allowedCategories.includes(doc.category),
    );
  }, [allDocuments, documentTab]);

  // 탭별 선택 상태 계산
  const getTabSelectedCount = (tab: DocumentTabCategory) => {
    if (tab === "전체") {
      return allDocuments.filter((d) => selectedDocuments.has(d.id)).length;
    }

    const categoryMapping: Record<DocumentTabCategory, string[]> = {
      전체: [],
      현장사진: ["현장출동사진", "수리중 사진", "복구완료 사진"],
      기본자료: ["보험금 청구서", "개인정보 동의서(가족용)"],
      증빙자료: [
        "주민등록등본",
        "등기부등본",
        "건축물대장",
        "기타증빙자료(민원일지 등)",
      ],
      청구자료: ["복구완료 및 위임장", "도급계약서", "부가세 청구자료"],
    };

    const allowedCategories = categoryMapping[tab];
    return allDocuments.filter(
      (d) =>
        allowedCategories.includes(d.category) && selectedDocuments.has(d.id),
    ).length;
  };

  // 탭별 문서 전체 선택/해제
  const toggleTabDocuments = (tab: DocumentTabCategory, checked: boolean) => {
    const categoryMapping: Record<DocumentTabCategory, string[]> = {
      전체: [],
      현장사진: ["현장출동사진", "수리중 사진", "복구완료 사진"],
      기본자료: ["보험금 청구서", "개인정보 동의서(가족용)"],
      증빙자료: [
        "주민등록등본",
        "등기부등본",
        "건축물대장",
        "기타증빙자료(민원일지 등)",
      ],
      청구자료: ["복구완료 및 위임장", "도급계약서", "부가세 청구자료"],
    };

    const newSelected = new Set(selectedDocuments);

    if (tab === "전체") {
      if (checked) {
        allDocuments.forEach((d) => newSelected.add(d.id));
      } else {
        allDocuments.forEach((d) => newSelected.delete(d.id));
      }
    } else {
      const allowedCategories = categoryMapping[tab];
      allDocuments
        .filter((d) => allowedCategories.includes(d.category))
        .forEach((d) => {
          if (checked) {
            newSelected.add(d.id);
          } else {
            newSelected.delete(d.id);
          }
        });
    }

    setSelectedDocuments(newSelected);
  };

  // 활성 탭 상태 (PDF 캡처를 위해 제어 컴포넌트로 사용)
  const [activeTab, setActiveTab] = useState("현장조사");

  // SMS 알림 다이얼로그 상태
  const [smsDialogOpen, setSmsDialogOpen] = useState(false);
  const [smsStage, setSmsStage] = useState<
    "현장정보입력" | "반려" | "현장정보제출" | "승인반려"
  >("현장정보입력");
  const [smsPreviousStatus, setSmsPreviousStatus] = useState<
    string | undefined
  >(undefined);

  // 필수 서류 검증 함수 (현장출동보고서 제출 전)
  const validateRequiredDocuments = (): {
    valid: boolean;
    missingDocs: string[];
  } => {
    const missingDocs: string[] = [];

    // 1. 사진 탭 - 현장출동사진 필수
    const hasFieldPhoto = allDocuments.some(
      (doc) => doc.category === "현장출동사진",
    );
    if (!hasFieldPhoto) {
      missingDocs.push("현장출동사진");
    }

    // 2. 기본자료 탭 - 보험금 청구서 (손해방지건 -0은 선택, 부건 -1,-2,-3 등도 선택)

    // 3. 기본자료 탭 - 개인정보 동의서 (손해방지건 -0은 선택, 부건 -1,-2,-3 등도 선택)

    // 4. 증빙자료 탭 - 건축물대장 또는 등기부등본 (택1) 필수
    const hasBuildingLedger = allDocuments.some(
      (doc) => doc.category === "건축물대장",
    );
    const hasPropertyRegistry = allDocuments.some(
      (doc) => doc.category === "등기부등본",
    );
    if (!hasBuildingLedger && !hasPropertyRegistry) {
      missingDocs.push("건축물대장 또는 등기부등본");
    }

    return {
      valid: missingDocs.length === 0,
      missingDocs,
    };
  };

  // 테이블 체크박스 상태 관리
  const [areaChecked, setAreaChecked] = useState<Record<number, boolean>>({});
  const [laborChecked, setLaborChecked] = useState<Record<number, boolean>>({});
  const [materialChecked, setMaterialChecked] = useState<
    Record<number, boolean>
  >({});

  // reportData가 변경될 때 additionalNotes 상태 업데이트
  useEffect(() => {
    if (reportData?.case.additionalNotes !== undefined) {
      setAdditionalNotes(reportData.case.additionalNotes || "");
    }
  }, [reportData?.case.additionalNotes]);

  // Parse and memoize labor cost and material cost data
  // 저장된 값을 그대로 사용 (총합계 일치를 위해 재계산하지 않음)
  const parsedLaborCosts = useMemo(() => {
    return safeParseLaborCosts(reportData?.estimate?.estimate?.laborCostData);
  }, [reportData?.estimate?.estimate?.laborCostData]);

  const recoveryAreaByWorkName = useMemo(() => {
    const estimateRows = reportData?.estimate?.rows || [];
    if (estimateRows.length === 0) return {} as Record<string, number>;
    const workNameAreas: Record<string, number> = {};
    const lengthBasedWorkNames = ["걸레받이", "몰딩"];
    estimateRows.forEach((row: EstimateRow) => {
      const workName = row.workName || "";
      if (!workName) return;
      const area = Number(row.repairArea) || 0;
      const location = row.location || "";
      const isLengthBased = lengthBasedWorkNames.includes(workName);
      const isCeiling = !isLengthBased && (location.includes("천장") || location === "천장");
      let adjustedArea = area;
      if (isCeiling) {
        adjustedArea = area * 1.3;
      }
      if (!workNameAreas[workName]) workNameAreas[workName] = 0;
      workNameAreas[workName] += adjustedArea;
    });
    Object.keys(workNameAreas).forEach((wn) => {
      const isLengthBased = lengthBasedWorkNames.includes(wn);
      if (isLengthBased) {
        workNameAreas[wn] = Math.round(workNameAreas[wn] * 100) / 100;
      } else {
        workNameAreas[wn] = Math.round(workNameAreas[wn] * 10) / 10;
      }
    });
    return workNameAreas;
  }, [reportData?.estimate?.rows]);

  // materialCostData에서 자재비 배열과 VAT 옵션 추출
  // 저장된 금액을 그대로 사용 (총합계 일치를 위해 재계산하지 않음)
  const { materialRows: parsedMaterialCosts, vatIncluded } = useMemo(() => {
    const materialData = reportData?.estimate?.estimate
      ?.materialCostData as any;
    // 새 형식 (객체: {rows, vatIncluded}) 또는 기존 형식 (배열)
    if (materialData && !Array.isArray(materialData) && materialData.rows) {
      return {
        materialRows: safeParseMaterialCosts(materialData.rows),
        vatIncluded: materialData.vatIncluded ?? true,
      };
    }
    return {
      materialRows: safeParseMaterialCosts(materialData),
      vatIncluded: true,
    };
  }, [reportData?.estimate?.estimate?.materialCostData]);

  // 견적 합계 계산
  const calculateTotals = useMemo(() => {
    // 노무비 총합 - 경비 여부에 따라 분리
    // includeInEstimate === true → 경비가 아닌 항목 (관리비/이윤에 포함)
    // includeInEstimate === false → 경비 항목 (관리비/이윤에서 제외)
    const laborTotalNonExpense = parsedLaborCosts.reduce((sum, row) => {
      if (row.includeInEstimate) {
        return sum + (row.amount || 0);
      }
      return sum;
    }, 0);

    const laborTotalExpense = parsedLaborCosts.reduce((sum, row) => {
      if (!row.includeInEstimate) {
        return sum + (row.amount || 0);
      }
      return sum;
    }, 0);

    // 자재비 총합
    const materialTotal = parsedMaterialCosts.reduce((sum, row) => {
      return sum + (row.금액 || 0);
    }, 0);

    // 소계 (전체)
    const subtotal = laborTotalNonExpense + laborTotalExpense + materialTotal;

    // 일반관리비와 이윤 계산 대상 (경비가 아닌 항목 + 자재비)
    const baseForFees = laborTotalNonExpense + materialTotal;

    // 일반관리비 (6%) - 경비 제외 항목에만 적용
    const managementFee = Math.round(baseForFees * 0.06);

    // 이윤 (15%) - 경비 제외 항목에만 적용
    const profit = Math.round(baseForFees * 0.15);

    // VAT 기준액 (소계 + 일반관리비 + 이윤)
    const vatBase = subtotal + managementFee + profit;

    // 만원단위절사 (VAT 적용 전에 절사)
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
      vatIncluded,
    };
  }, [parsedLaborCosts, parsedMaterialCosts, vatIncluded]);

  // 데이터 로드 시 체크박스 초기화 (모두 체크된 상태로)
  useEffect(() => {
    if (reportData?.estimate?.rows) {
      const initial: Record<number, boolean> = {};
      reportData.estimate.rows.forEach((_, index) => {
        initial[index] = true;
      });
      setAreaChecked(initial);
    }
  }, [reportData?.estimate?.rows]);

  useEffect(() => {
    if (parsedLaborCosts.length > 0) {
      const initial: Record<number, boolean> = {};
      parsedLaborCosts.forEach((_, index) => {
        initial[index] = true;
      });
      setLaborChecked(initial);
    }
  }, [parsedLaborCosts]);

  useEffect(() => {
    if (parsedMaterialCosts.length > 0) {
      const initial: Record<number, boolean> = {};
      parsedMaterialCosts.forEach((_, index) => {
        initial[index] = true;
      });
      setMaterialChecked(initial);
    }
  }, [parsedMaterialCosts]);

  // 기타사항 저장 mutation
  const saveNotesMutation = useMutation({
    mutationFn: async (notes: string) => {
      return apiRequest(
        "PATCH",
        `/api/cases/${selectedCaseId}/additional-notes`,
        { additionalNotes: notes },
      );
    },
    onSuccess: () => {
      toast({
        title: "저장 완료",
        description: "기타사항이 저장되었습니다.",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/field-surveys", selectedCaseId, "report"],
      });
    },
    onError: (error: Error) => {
      toast({
        title: "저장 실패",
        description: error.message || "기타사항 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 보고서 제출 mutation
  const submitReportMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/cases/${selectedCaseId}/submit`);
    },
    onSuccess: async () => {
      toast({
        title: "제출 완료",
        description: "현장출동보고서가 성공적으로 제출되었습니다.",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/field-surveys", selectedCaseId, "report"],
      });
      setShowSubmitDialog(false);

    },
    onError: (error: Error) => {
      toast({
        title: "제출 실패",
        description: error.message || "보고서 제출 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 보고서 심사 mutation
  const reviewMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/cases/${selectedCaseId}/review`, {
        decision: reviewDecision,
        reviewComment: reviewComment || "",
      });
    },
    onSuccess: () => {
      toast({
        title: "심사 완료",
        description: `보고서가 ${reviewDecision} 처리되었습니다.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/field-surveys", selectedCaseId, "report"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setShowReviewDialog(false);

      // 비승인(반려) 시 SMS 알림 다이얼로그 표시
      if (reviewDecision === "비승인") {
        // 반려 전 상태 저장 (현재 상태)
        setSmsPreviousStatus(caseData?.status || "현장정보입력");
        setSmsStage("반려");
        setSmsDialogOpen(true);
      }

      setReviewDecision("승인");
      setReviewComment("");
    },
    onError: (error: Error) => {
      toast({
        title: "심사 실패",
        description: error.message || "보고서 심사 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 보고서 승인 mutation (2차 승인) - 각 케이스 개별적으로 승인 가능
  const approvalMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(
        "PATCH",
        `/api/cases/${selectedCaseId}/approve-report`,
        {
          decision: approvalDecision,
          approvalComment: approvalComment || "",
        },
      );
    },
    onSuccess: () => {
      toast({
        title: "승인 완료",
        description: `보고서가 ${approvalDecision} 처리되었습니다.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/field-surveys", selectedCaseId, "report"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/cases", selectedCaseId, "prevention-case-status"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setShowApprovalDialog(false);

      // 승인/비승인 시 SMS 알림 다이얼로그 표시
      if (approvalDecision === "비승인") {
        // 반려 전 상태 저장 (현재 상태)
        setSmsPreviousStatus(caseData?.status || "현장정보제출");
        setSmsStage("승인반려");
        setSmsDialogOpen(true);
      } else if (approvalDecision === "승인") {
        // 복구요청(2차승인) 시 협력업체 SMS 알림 다이얼로그 표시
        setSmsStage("복구요청");
        setSmsDialogOpen(true);
      }

      setApprovalDecision("승인");
      setApprovalComment("");
    },
    onError: (error: Error) => {
      toast({
        title: "승인 실패",
        description: error.message || "보고서 승인 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 청구자료제출 mutation (직접복구 → 청구자료제출)
  const claimSubmitMutation = useMutation({
    mutationFn: async () => {
      // KST 오늘 날짜
      const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
      const constructionCompletionDateStr = kstNow.toISOString().split("T")[0];

      return apiRequest("PATCH", `/api/cases/${selectedCaseId}`, {
        status: "청구자료제출(복구)",
        constructionCompletionDate: constructionCompletionDateStr, // 복구완료일 설정
      });
    },
    onSuccess: () => {
      toast({
        title: "청구자료 제출 완료",
        description: "청구자료가 성공적으로 제출되었습니다.",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/field-surveys", selectedCaseId, "report"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setShowClaimSubmitDialog(false);
    },
    onError: (error: Error) => {
      toast({
        title: "청구자료 제출 실패",
        description: error.message || "청구자료 제출 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 청구자료 필수 서류 검증 함수
  const validateClaimDocuments = (): {
    valid: boolean;
    missingDocs: string[];
  } => {
    const missingDocs: string[] = [];

    // 청구자료 필수 서류: 복구완료 및 위임장, 도급계약서
    const hasCompletionDelegation = allDocuments.some(
      (doc) => doc.category === "복구완료 및 위임장",
    );
    if (!hasCompletionDelegation) missingDocs.push("복구완료 및 위임장");

    const hasContract = allDocuments.some(
      (doc) => doc.category === "도급계약서",
    );
    if (!hasContract) missingDocs.push("도급계약서");

    return { valid: missingDocs.length === 0, missingDocs };
  };

  if (!selectedCaseId) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">케이스를 먼저 선택해주세요.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 상태 1: 초기 로딩 중 (데이터가 없고 로딩 중)
  // isLoading: 초기 로딩 (캐시 데이터 없음)
  // isFetching && !reportData: 데이터 없는 상태에서 fetch 진행 중
  const isInitialLoading =
    isLoading || isUserLoading || (isFetching && !reportData);

  if (isInitialLoading) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="p-6 text-center">
            <div className="flex flex-col items-center gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-muted-foreground">
                보고서 데이터를 불러오는 중...
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 상태 2: 에러 발생
  if (isError) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="p-6 text-center">
            <div className="flex flex-col items-center gap-4">
              <p className="text-destructive">
                데이터를 불러오는 중 오류가 발생했습니다.
              </p>
              <p className="text-sm text-muted-foreground">
                {error?.message || "알 수 없는 오류"}
              </p>
              <Button
                variant="outline"
                onClick={() => refetch()}
                data-testid="button-retry-report"
              >
                다시 시도
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 상태 3: 데이터가 진짜 없음 (로딩 완료 후 데이터 없음, 에러 아님)
  // status === 'success'이고 reportData가 없거나 빈 객체인 경우
  if (!reportData || (status === "success" && !reportData?.case)) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="p-6 text-center">
            <div className="flex flex-col items-center gap-4">
              <p className="text-muted-foreground">
                보고서 데이터를 찾을 수 없습니다.
              </p>
              <p className="text-sm text-muted-foreground">
                케이스 ID: {selectedCaseId}
              </p>
              <Button
                variant="outline"
                onClick={() => refetch()}
                data-testid="button-retry-report-notfound"
              >
                다시 시도
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const {
    case: caseData,
    drawing,
    documents,
    estimate,
    completionStatus,
  } = reportData;

  // 손해방지 케이스 여부 확인 (-0으로 끝나는 케이스)
  const isLossPreventionCase =
    caseData?.caseNumber && /-0$/.test(caseData.caseNumber);

  return (
    <div
      className="relative min-h-screen bg-white"
      style={{
        padding: "32px",
      }}
    >
      {/* 페이지 타이틀 및 버튼 */}
      <div
        className="relative flex items-center justify-between mb-4"
        style={{ zIndex: 1 }}
      >
        <div className="flex items-center gap-4">
          {/* 뒤로 가기 버튼 (종합진행관리에서 온 경우만) */}
          {returnToComprehensiveProgress && (
            <button
              onClick={() => {
                localStorage.removeItem("returnToComprehensiveProgress");
                setLocation("/comprehensive-progress");
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 12px",
                background: "rgba(253, 253, 253, 0.8)",
                backdropFilter: "blur(7px)",
                borderRadius: "6px",
                border: "1px solid rgba(12, 12, 12, 0.1)",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 500,
                color: "rgba(12, 12, 12, 0.7)",
                cursor: "pointer",
              }}
              data-testid="button-back-to-comprehensive"
            >
              <ArrowLeft size={16} />
              종합진행관리
            </button>
          )}

          <div className="flex items-center gap-2">
            <h1
              style={{
                fontFamily: "Pretendard",
                fontSize: "24px",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: "#0C0C0C",
              }}
            >
              현장출동보고서
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
        </div>

        {/* 역할별 버튼 */}
        <div className="flex items-center gap-3">
          {/* 역할 확인 중일 때는 버튼 표시하지 않음 */}
          {!isUserLoading && isPartner && (
            <>
              <Button
                data-testid="button-submit-report"
                onClick={() => {
                  console.log("=== 제출 조건 체크 (보고서 제출) ===");
                  console.log("현장입력 완료:", completionStatus.fieldSurvey);
                  console.log("도면 완료:", completionStatus.drawing);
                  console.log("증빙자료 완료:", completionStatus.documents);
                  console.log("견적 완료:", completionStatus.estimate);
                  console.log(
                    "전체 완료 (isComplete):",
                    completionStatus.isComplete,
                  );
                  console.log("미입력 항목:", completionStatus.missingItems);
                  console.log("================================");

                  // 미입력 항목 체크 - 최대 2개만 표시
                  if (
                    !completionStatus.isComplete &&
                    completionStatus.missingItems?.length > 0
                  ) {
                    const items = completionStatus.missingItems;
                    let message = "";
                    if (items.length === 1) {
                      message = `${items[0]} 미입력 되어있습니다.`;
                    } else if (items.length === 2) {
                      message = `${items[0]}, ${items[1]} 미입력 되어있습니다.`;
                    } else {
                      message = `${items[0]}, ${items[1]} 등 미입력 되어있습니다.`;
                    }
                    toast({
                      title: "누락된 서류 안내",
                      description: message,
                      variant: "destructive",
                    });
                    return;
                  }

                  // 필수 서류 검증
                  const validation = validateRequiredDocuments();
                  if (!validation.valid) {
                    const docs = validation.missingDocs;
                    let message = "";
                    if (docs.length === 1) {
                      message = `${docs[0]} 미입력 되어있습니다.`;
                    } else if (docs.length === 2) {
                      message = `${docs[0]}, ${docs[1]} 미입력 되어있습니다.`;
                    } else {
                      message = `${docs[0]}, ${docs[1]} 등 미입력 되어있습니다.`;
                    }
                    toast({
                      title: "누락된 서류 안내",
                      description: message,
                      variant: "destructive",
                    });
                    return;
                  }

                  setShowSubmitDialog(true);
                }}
                disabled={submitReportMutation.isPending || isPartnerReadOnly}
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                {submitReportMutation.isPending ? "제출 중..." : "제출"}
              </Button>
            </>
          )}

          {/* 심사 버튼: 항상 표시, reviewDecision에 따라 텍스트/스타일 변경 */}
          {!isUserLoading &&
            isAdmin &&
            caseData.fieldSurveyStatus === "submitted" && (
              <Button
                data-testid="button-review"
                onClick={() => {
                  // 심사 안됐거나 반려된 경우만 다이얼로그 열기
                  if (
                    !caseData.reviewDecision ||
                    caseData.reviewDecision === "비승인"
                  ) {
                    setShowReviewDialog(true);
                  }
                }}
                disabled={
                  reviewMutation.isPending || caseData.reviewDecision === "승인"
                }
                className={
                  caseData.reviewDecision === "승인"
                    ? "bg-blue-100 text-blue-700 hover:bg-blue-100 cursor-default"
                    : caseData.reviewDecision === "비승인"
                      ? "bg-red-100 text-red-700 hover:bg-red-200"
                      : ""
                }
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                {reviewMutation.isPending
                  ? "심사 중..."
                  : caseData.reviewDecision === "승인"
                    ? "심사완료"
                    : caseData.reviewDecision === "비승인"
                      ? "심사반려"
                      : "심사"}
              </Button>
            )}

          {/* 승인 버튼: 모든 케이스에서 개별적으로 2차 승인 가능 (-0, -1, -2, -3 등) */}
          {!isUserLoading &&
            canApproveReport &&
            caseData?.caseNumber &&
            caseData.status === "현장정보제출" && (
              <Button
                data-testid="button-approve-report"
                onClick={() => {
                  // 각 케이스 개별적으로 승인 가능 (현재 케이스만 영향)
                  if (!caseData.reportApprovalDecision) {
                    setShowApprovalDialog(true);
                  }
                }}
                disabled={
                  approvalMutation.isPending ||
                  !!caseData.reportApprovalDecision
                }
                className={
                  caseData.reportApprovalDecision === "승인"
                    ? "bg-green-100 text-green-700 hover:bg-green-100 cursor-default"
                    : caseData.reportApprovalDecision === "비승인"
                      ? "bg-red-100 text-red-700 hover:bg-red-100 cursor-default"
                      : "bg-green-500 hover:bg-green-600"
                }
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                {approvalMutation.isPending
                  ? "승인 중..."
                  : caseData.reportApprovalDecision === "승인"
                    ? "승인완료"
                    : caseData.reportApprovalDecision === "비승인"
                      ? "승인반려"
                      : "승인"}
              </Button>
            )}
        </div>
      </div>

      {/* 관련 접수건 전환 버튼 - 동일 사고번호의 현장출동보고서를 제출한 모든 접수건 표시 */}
      {(() => {
        // 현재 케이스 번호에서 기본 번호 추출 (예: "123-456-0" -> "123-456")
        const currentCaseNumber = caseData?.caseNumber || "";
        const baseMatch = currentCaseNumber.match(/^(.+)-(\d+)$/);
        if (!baseMatch) return null;

        const baseCaseNumber = baseMatch[1];

        // 관련 케이스 중 같은 기본 번호를 가진 케이스들 필터링 (모든 상태 표시)
        const suffixCases =
          relatedCasesData?.relatedCases?.filter((rc) => {
            const match = rc.caseNumber.match(/^(.+)-(\d+)$/);
            if (!match) return false;
            const rcBase = match[1];
            // 같은 기본 번호를 가진 모든 케이스 표시
            return rcBase === baseCaseNumber;
          }) || [];

        // 현재 케이스도 목록에 추가 (중복 방지, 현재 케이스의 상태 포함)
        const currentCaseStatus = caseData?.status || "";
        const allSuffixCases = [
          {
            caseId: selectedCaseId,
            caseNumber: currentCaseNumber,
            status: currentCaseStatus,
          },
          ...suffixCases.filter((rc) => rc.caseId !== selectedCaseId),
        ].sort((a, b) => {
          const suffixA = a.caseNumber.match(/-(\d+)$/)?.[1] || "0";
          const suffixB = b.caseNumber.match(/-(\d+)$/)?.[1] || "0";
          return parseInt(suffixA) - parseInt(suffixB);
        });

        // 항상 버튼 표시 (관리자 및 협력사 모두 가능) - 관련 케이스가 1개만 있어도 표시
        if (!isUserLoading && (isAdmin || isPartner)) {
          return (
            <div className="flex justify-end mb-4">
              <Popover
                open={isRelatedCasesPopoverOpen}
                onOpenChange={setIsRelatedCasesPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    data-testid="button-related-cases-review"
                    className="bg-yellow-400 hover:bg-yellow-500 text-yellow-900 border-yellow-500"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: "500",
                    }}
                  >
                    <ExternalLink className="w-4 h-4 mr-1" />
                    관련 접수건 전환
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-64 p-0"
                  align="end"
                  style={{
                    background: "white",
                    border: "1px solid rgba(0, 0, 0, 0.1)",
                    borderRadius: "12px",
                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
                  }}
                >
                  <div
                    className="p-3 border-b"
                    style={{ borderColor: "rgba(0, 0, 0, 0.06)" }}
                  >
                    <p
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "#0C0C0C",
                      }}
                    >
                      관련 접수건 전환
                    </p>
                    <p
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "11px",
                        color: "rgba(12, 12, 12, 0.5)",
                        marginTop: "4px",
                      }}
                    >
                      동일 접수번호의 케이스로 전환합니다
                    </p>
                  </div>
                  <div className="p-2 max-h-48 overflow-y-auto">
                    {allSuffixCases.length <= 1 ? (
                      <p
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "12px",
                          color: "rgba(12, 12, 12, 0.5)",
                          padding: "8px",
                          textAlign: "center",
                        }}
                      >
                        전환 가능한 다른 접수건이 없습니다
                      </p>
                    ) : (
                      allSuffixCases.map((suffixCase) => {
                        const isCurrentCase =
                          suffixCase.caseId === selectedCaseId;
                        const suffix =
                          suffixCase.caseNumber.match(/-(\d+)$/)?.[1] || "0";
                        const label =
                          suffix === "0" ? "손해방지" : `피해세대 ${suffix}`;

                        return (
                          <button
                            key={suffixCase.caseId}
                            onClick={() => {
                              if (!isCurrentCase) {
                                // localStorage와 상태 모두 업데이트
                                localStorage.setItem(
                                  "selectedFieldSurveyCaseId",
                                  suffixCase.caseId,
                                );
                                setSelectedCaseId(suffixCase.caseId);
                                setIsRelatedCasesPopoverOpen(false);
                                // React Query 캐시 무효화하여 새 데이터 fetch
                                queryClient.invalidateQueries({
                                  queryKey: ["/api/field-surveys"],
                                });
                                queryClient.invalidateQueries({
                                  queryKey: ["/api/documents/case"],
                                });
                                queryClient.invalidateQueries({
                                  queryKey: ["/api/cases"],
                                });
                              }
                            }}
                            className={`w-full text-left px-3 py-2 rounded-lg transition-all ${
                              isCurrentCase
                                ? "bg-yellow-100 cursor-default"
                                : "hover-elevate active-elevate-2"
                            }`}
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "13px",
                              color: isCurrentCase ? "#B45309" : "#0C0C0C",
                            }}
                            disabled={isCurrentCase}
                            data-testid={`button-switch-${suffixCase.caseNumber}`}
                          >
                            <span
                              style={{ fontWeight: isCurrentCase ? 600 : 500 }}
                            >
                              {formatCaseNumber(suffixCase.caseNumber)}
                            </span>
                            <span
                              style={{
                                marginLeft: "8px",
                                fontSize: "11px",
                                color: isCurrentCase
                                  ? "#B45309"
                                  : "rgba(12, 12, 12, 0.5)",
                              }}
                            >
                              ({label}){isCurrentCase ? " - 현재" : ""}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          );
        }
        return null;
      })()}

      {/* 제출 확인 다이얼로그 */}
      <AlertDialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle
              style={{
                fontFamily: "Pretendard",
                fontSize: "18px",
                fontWeight: "600",
              }}
            >
              보고서 제출 확인
            </AlertDialogTitle>
            <AlertDialogDescription
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
            >
              현장출동보고서를 제출하시겠습니까?{"\n"}
              제출 후에는 수정이 불가능합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="button-cancel-submit"
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-submit"
              onClick={() => submitReportMutation.mutate()}
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
            >
              제출
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 청구자료제출 확인 다이얼로그 */}
      <AlertDialog
        open={showClaimSubmitDialog}
        onOpenChange={setShowClaimSubmitDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle
              style={{
                fontFamily: "Pretendard",
                fontSize: "18px",
                fontWeight: "600",
              }}
            >
              청구자료 제출 확인
            </AlertDialogTitle>
            <AlertDialogDescription
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                lineHeight: "1.6",
              }}
            >
              청구자료를 제출하시겠습니까? 제출 후에는 수정이 불가능합니다.
              {"\n"}
              그리고, 지금 청구는 보험사 사고번호 기준으로{"\n"}
              손방 및 대물 각 건의 청구자료제출이 완료된 후 일괄하여 진행됨을
              안내 드립니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="button-cancel-claim-submit"
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-claim-submit"
              onClick={() => claimSubmitMutation.mutate()}
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
            >
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 심사 다이얼로그 */}
      <AlertDialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle
              style={{
                fontFamily: "Pretendard",
                fontSize: "18px",
                fontWeight: "600",
              }}
            >
              심사하기
            </AlertDialogTitle>
          </AlertDialogHeader>

          {/* 심사중인 건 정보 */}
          <div className="space-y-2 mb-4">
            <div
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 400,
                color: "rgba(12, 12, 12, 0.5)",
              }}
            >
              심사중인 건
            </div>
            <div
              className="p-3 rounded-lg"
              style={{ background: "rgba(12, 12, 12, 0.03)" }}
            >
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "#0C0C0C",
                }}
              >
                {caseData.insuranceCompany || "보험사 미정"}{" "}
                {caseData.insuranceAccidentNo || ""}
              </div>
              <div
                className="mt-1"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                }}
              >
                접수일:{" "}
                {caseData.createdAt
                  ? new Date(caseData.createdAt).toLocaleDateString("ko-KR")
                  : "-"}{" "}
                | 처리담당: {caseData.assignedPartner || "-"} | 의뢰일:{" "}
                {caseData.assignmentDate || "-"} | 긴급여부:{" "}
                {caseData.urgency || "-"}
              </div>
            </div>
          </div>

          {/* 심사결과 */}
          <div className="space-y-3 mb-4">
            <Label
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 500,
              }}
            >
              심사결과
            </Label>
            <RadioGroup
              value={reviewDecision}
              onValueChange={(value) =>
                setReviewDecision(value as "승인" | "비승인")
              }
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="승인"
                  id="approve"
                  data-testid="radio-approve"
                />
                <Label
                  htmlFor="approve"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    cursor: "pointer",
                  }}
                >
                  승인
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="비승인"
                  id="reject"
                  data-testid="radio-reject"
                />
                <Label
                  htmlFor="reject"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    cursor: "pointer",
                  }}
                >
                  비승인
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* 검토 의견 */}
          <div className="space-y-2 mb-4">
            <div className="flex justify-between items-center">
              <Label
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                }}
              >
                검토 의견(선택)
              </Label>
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "12px",
                  color: "rgba(12, 12, 12, 0.5)",
                }}
              >
                {reviewComment.length}/800
              </span>
            </div>
            <Textarea
              data-testid="textarea-review-comment"
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value.slice(0, 800))}
              placeholder="검토 의견을 입력해주세요"
              className="resize-none"
              rows={4}
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="button-cancel-review"
              onClick={() => {
                setReviewDecision("승인");
                setReviewComment("");
              }}
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-review"
              onClick={() => reviewMutation.mutate()}
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
            >
              제출
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* 보고서 승인 다이얼로그 (2차 승인) - 현재 케이스만 승인 가능 */}
      <AlertDialog
        open={showApprovalDialog}
        onOpenChange={setShowApprovalDialog}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle
              style={{
                fontFamily: "Pretendard",
                fontSize: "18px",
                fontWeight: "600",
              }}
            >
              보고서 승인
            </AlertDialogTitle>
          </AlertDialogHeader>

          {/* 승인대상 건 정보 */}
          <div className="space-y-2 mb-4">
            <div
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 400,
                color: "rgba(12, 12, 12, 0.5)",
              }}
            >
              승인대상 건
            </div>
            <div
              className="p-3 rounded-lg"
              style={{ background: "rgba(12, 12, 12, 0.03)" }}
            >
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "#0C0C0C",
                }}
              >
                {caseData.insuranceCompany || "보험사 미정"}{" "}
                {caseData.insuranceAccidentNo || ""}
              </div>
              <div
                className="mt-1"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                }}
              >
                접수일:{" "}
                {caseData.createdAt
                  ? new Date(caseData.createdAt).toLocaleDateString("ko-KR")
                  : "-"}{" "}
                | 처리담당: {caseData.assignedPartner || "-"} | 의뢰일:{" "}
                {caseData.assignmentDate || "-"} | 긴급여부:{" "}
                {caseData.urgency || "-"}
              </div>
            </div>
          </div>

          {/* 승인결과 */}
          <div className="space-y-3 mb-4">
            <Label
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 500,
              }}
            >
              승인결과
            </Label>
            <RadioGroup
              value={approvalDecision}
              onValueChange={(value) =>
                setApprovalDecision(value as "승인" | "비승인")
              }
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="승인"
                  id="approve-report"
                  data-testid="radio-approve-report"
                />
                <Label
                  htmlFor="approve-report"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    cursor: "pointer",
                  }}
                >
                  승인
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem
                  value="비승인"
                  id="reject-report"
                  data-testid="radio-reject-report"
                />
                <Label
                  htmlFor="reject-report"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    cursor: "pointer",
                  }}
                >
                  비승인
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* 승인 의견 */}
          <div className="space-y-2 mb-4">
            <div className="flex justify-between items-center">
              <Label
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                }}
              >
                승인 의견(선택)
              </Label>
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "12px",
                  color: "rgba(12, 12, 12, 0.5)",
                }}
              >
                {approvalComment.length}/800
              </span>
            </div>
            <Textarea
              data-testid="textarea-approval-comment"
              value={approvalComment}
              onChange={(e) => setApprovalComment(e.target.value.slice(0, 800))}
              placeholder="승인 의견을 입력해주세요"
              className="resize-none"
              rows={4}
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="button-cancel-approval"
              onClick={() => {
                setApprovalDecision("승인");
                setApprovalComment("");
              }}
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-approval"
              onClick={() => approvalMutation.mutate()}
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
            >
              제출
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* 통합 PDF 다운로드/이메일 전송 Dialog */}
      <Dialog open={showPdfDialog} onOpenChange={setShowPdfDialog}>
        <DialogContent
          style={{
            maxWidth: "700px",
            background: "rgba(253, 253, 253, 0.95)",
            backdropFilter: "blur(17px)",
            border: "none",
            borderRadius: "12px",
            padding: "32px",
          }}
        >
          <div
            style={{
              fontFamily: "Pretendard",
              fontWeight: 600,
              fontSize: "18px",
              color: "#0C0C0C",
              textAlign: "center",
              marginBottom: "24px",
            }}
          >
            PDF 다운로드
          </div>

          <div style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
              {Object.entries(downloadSections).map(([key, value]) => (
                <label
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    cursor: "pointer",
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    color: "#0C0C0C",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) =>
                      setDownloadSections((prev) => ({
                        ...prev,
                        [key]: e.target.checked,
                      }))
                    }
                    style={{
                      width: "18px",
                      height: "18px",
                      accentColor: "#008FED",
                      cursor: "pointer",
                    }}
                  />
                  {key}
                </label>
              ))}
            </div>
          </div>

          {downloadSections.증빙자료 && (
            <div style={{ marginBottom: "24px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: "1px solid rgba(12, 12, 12, 0.1)",
                  marginBottom: "16px",
                }}
              >
                <div style={{ display: "flex", gap: "0px" }}>
                  {(
                    [
                      "전체",
                      "현장사진",
                      "기본자료",
                      "증빙자료",
                      "청구자료",
                    ] as DocumentTabCategory[]
                  ).map((tab) => {
                    const count = getTabSelectedCount(tab);
                    const categoryMapping: Record<
                      DocumentTabCategory,
                      string[]
                    > = {
                      전체: [],
                      현장사진: [
                        "현장출동사진",
                        "수리중 사진",
                        "복구완료 사진",
                      ],
                      기본자료: ["보험금 청구서", "개인정보 동의서(가족용)"],
                      증빙자료: [
                        "주민등록등본",
                        "등기부등본",
                        "건축물대장",
                        "기타증빙자료(민원일지 등)",
                      ],
                      청구자료: [
                        "복구완료 및 위임장",
                        "도급계약서",
                        "부가세 청구자료",
                      ],
                    };
                    const totalInTab =
                      tab === "전체"
                        ? allDocuments.length
                        : allDocuments.filter((d) =>
                            categoryMapping[tab].includes(d.category),
                          ).length;
                    const isAllSelected =
                      totalInTab > 0 && count === totalInTab;

                    return (
                      <button
                        key={tab}
                        onClick={() => setDocumentTab(tab)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "12px 16px",
                          background: "transparent",
                          border: "none",
                          borderBottom:
                            documentTab === tab
                              ? "2px solid #008FED"
                              : "2px solid transparent",
                          marginBottom: "-1px",
                          cursor: "pointer",
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: documentTab === tab ? 600 : 400,
                          color:
                            documentTab === tab
                              ? "#008FED"
                              : "rgba(12, 12, 12, 0.6)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleTabDocuments(tab, e.target.checked);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            width: "14px",
                            height: "14px",
                            accentColor: "#008FED",
                            cursor: "pointer",
                          }}
                        />
                        {tab}
                        {count > 0 && (
                          <span
                            style={{
                              fontSize: "12px",
                              color: "#008FED",
                              fontWeight: 500,
                            }}
                          >
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#008FED",
                  }}
                >
                  {selectedDocuments.size}개
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: "12px",
                  maxHeight: "300px",
                  overflowY: "auto",
                  padding: "4px",
                }}
              >
                {getFilteredDocuments.map((doc) => {
                  const isSelected = selectedDocuments.has(doc.id);
                  const isImage = doc.fileName?.match(
                    /\.(jpg|jpeg|png|gif|webp)$/i,
                  );

                  return (
                    <div
                      key={doc.id}
                      onClick={() => {
                        const newSelected = new Set(selectedDocuments);
                        if (isSelected) {
                          newSelected.delete(doc.id);
                        } else {
                          newSelected.add(doc.id);
                        }
                        setSelectedDocuments(newSelected);
                      }}
                      style={{
                        position: "relative",
                        width: "100%",
                        height: "0",
                        paddingBottom: "100%",
                        borderRadius: "8px",
                        overflow: "hidden",
                        cursor: "pointer",
                        border: isSelected
                          ? "2px solid #008FED"
                          : "1px solid rgba(12, 12, 12, 0.1)",
                        background: "rgba(12, 12, 12, 0.03)",
                        boxSizing: "border-box",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: "0",
                          left: "0",
                          right: "0",
                          bottom: "0",
                          display: "flex",
                          flexDirection: "column",
                        }}
                      >
                        {isImage && (doc.storageKey || doc.fileData) ? (
                          <img
                            src={
                              doc.storageKey
                                ? `/api/documents/${doc.id}/image`
                                : `data:${doc.fileType};base64,${doc.fileData}`
                            }
                            alt={doc.fileName || ""}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: "100%",
                              height: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: "rgba(12, 12, 12, 0.05)",
                            }}
                          >
                            <svg
                              width="32"
                              height="32"
                              viewBox="0 0 24 24"
                              fill="none"
                            >
                              <path
                                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                                stroke="rgba(12,12,12,0.3)"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <polyline
                                points="14 2 14 8 20 8"
                                stroke="rgba(12,12,12,0.3)"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </div>
                        )}

                        <div
                          style={{
                            position: "absolute",
                            top: "6px",
                            right: "6px",
                            width: "20px",
                            height: "20px",
                            borderRadius: "4px",
                            background: isSelected
                              ? "#008FED"
                              : "rgba(255, 255, 255, 0.9)",
                            border: isSelected
                              ? "none"
                              : "1px solid rgba(12, 12, 12, 0.2)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {isSelected && (
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                            >
                              <polyline
                                points="20 6 9 17 4 12"
                                stroke="white"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </div>

                        <div
                          style={{
                            position: "absolute",
                            bottom: "0",
                            left: "0",
                            right: "0",
                            padding: "6px 8px",
                            background:
                              "linear-gradient(transparent, rgba(0,0,0,0.7))",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "11px",
                              color: "white",
                              display: "block",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {doc.fileName || doc.category}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {getFilteredDocuments.length === 0 && (
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      textAlign: "center",
                      padding: "32px",
                      color: "rgba(12, 12, 12, 0.5)",
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                    }}
                  >
                    해당 카테고리에 문서가 없습니다.
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={() => setShowPdfDialog(false)}
              style={{
                flex: 1,
                padding: "14px",
                background: "transparent",
                borderRadius: "8px",
                border: "none",
                fontFamily: "Pretendard",
                fontWeight: 600,
                fontSize: "14px",
                color: "#008FED",
                cursor: "pointer",
              }}
              data-testid="button-cancel-pdf-dialog"
            >
              취소
            </button>
            <button
              onClick={async () => {
                if (pdfDialogMode === "email") {
                  setShowPdfDialog(false);
                  setShowEmailInputDialog(true);
                } else {
                  try {
                    toast({
                      title: "PDF 생성 중",
                      description: "보고서를 생성하고 있습니다...",
                    });

                    const selectedSectionKeys = Object.entries(downloadSections)
                      .filter(([_, checked]) => checked)
                      .map(([key]) => key);

                    if (selectedSectionKeys.length === 0) {
                      toast({
                        title: "섹션 선택 필요",
                        description: "최소 1개 이상의 섹션을 선택해주세요.",
                        variant: "destructive",
                      });
                      return;
                    }

                    const payload = {
                      caseId: selectedCaseId,
                      sections: {
                        cover: true,
                        fieldReport: downloadSections["현장입력"] || false,
                        drawing: downloadSections["도면"] || false,
                        evidence: downloadSections["증빙자료"] || false,
                        estimate: downloadSections["견적서"] || false,
                        etc: downloadSections["기타사항"] || false,
                      },
                      evidence: {
                        tab: documentTab || "전체",
                        selectedFileIds: downloadSections["증빙자료"]
                          ? Array.from(selectedDocuments)
                          : [],
                      },
                    };

                    const response = await fetch("/api/pdf/download", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload),
                      credentials: "include",
                    });

                    if (!response.ok) {
                      const errorText = await response.text();
                      let errorMessage = "PDF 생성 실패";
                      try {
                        const errorData = JSON.parse(errorText);
                        errorMessage = errorData.error || errorMessage;
                      } catch {
                        errorMessage = errorText || errorMessage;
                      }
                      throw new Error(errorMessage);
                    }

                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `현장출동보고서_${caseData?.caseNumber || "report"}_${new Date().toISOString().split("T")[0]}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);

                    // 다운로드 성공 시 케이스 상태를 "현장정보제출"로 변경
                    try {
                      await apiRequest(
                        "PATCH",
                        `/api/cases/${selectedCaseId}/status`,
                        {
                          status: "현장정보제출",
                        },
                      );
                      // 케이스 데이터 새로고침
                      queryClient.invalidateQueries({
                        queryKey: [
                          "/api/field-surveys",
                          selectedCaseId,
                          "report",
                        ],
                      });
                      queryClient.invalidateQueries({
                        queryKey: ["/api/cases"],
                      });

                      // 현장정보제출 상태 변경 시 심사자/조사자에게 SMS 발송
                      try {
                        await apiRequest(
                          "POST",
                          "/api/send-stage-notification",
                          {
                            caseId: selectedCaseId,
                            stage: "현장정보제출",
                            recipients: {
                              partner: false,
                              manager: false,
                              assessorInvestigator: true,
                            },
                          },
                        );
                        console.log("현장정보제출 SMS 발송 완료 (PDF 다운로드)");
                      } catch (smsError) {
                        console.error("SMS 발송 오류:", smsError);
                      }
                    } catch (statusError) {
                      console.error("상태 업데이트 오류:", statusError);
                    }

                    setShowPdfDialog(false);
                    toast({
                      title: "PDF 다운로드 완료",
                      description: "보고서가 성공적으로 다운로드되었습니다.",
                    });
                  } catch (error) {
                    console.error("PDF 생성 오류:", error);
                    toast({
                      title: "PDF 생성 실패",
                      description:
                        error instanceof Error
                          ? error.message
                          : "보고서 생성 중 오류가 발생했습니다.",
                      variant: "destructive",
                    });
                  }
                }
              }}
              style={{
                flex: 1,
                padding: "14px",
                background: "#008FED",
                borderRadius: "8px",
                border: "none",
                fontFamily: "Pretendard",
                fontWeight: 600,
                fontSize: "14px",
                color: "#FFFFFF",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
              data-testid="button-confirm-pdf-action"
            >
              {pdfDialogMode === "download" ? "다운 ↓" : "전송"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {/* 이메일 입력 Dialog (Step 2) */}
      <Dialog
        open={showEmailInputDialog}
        onOpenChange={setShowEmailInputDialog}
      >
        <DialogContent
          style={{
            maxWidth: "500px",
            background: "rgba(253, 253, 253, 0.95)",
            backdropFilter: "blur(17px)",
            border: "none",
            borderRadius: "12px",
            padding: "32px",
          }}
        >
          <div
            style={{
              fontFamily: "Pretendard",
              fontWeight: 600,
              fontSize: "18px",
              color: "#0C0C0C",
              textAlign: "center",
              marginBottom: "24px",
            }}
          >
            이메일 전송
          </div>

          {/* 수신자 선택 체크박스 */}
          <div style={{ marginBottom: "24px" }}>
            <label
              style={{
                display: "block",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 500,
                color: "rgba(12, 12, 12, 0.6)",
                marginBottom: "12px",
              }}
            >
              수신자 선택
            </label>

            {/* 심사사 이메일 */}
            {caseData?.assessorEmail && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "12px 16px",
                  background: selectedEmailRecipients.assessor
                    ? "rgba(0, 143, 237, 0.1)"
                    : "rgba(12, 12, 12, 0.02)",
                  borderRadius: "8px",
                  marginBottom: "8px",
                  cursor: "pointer",
                  border: selectedEmailRecipients.assessor
                    ? "1px solid rgba(0, 143, 237, 0.3)"
                    : "1px solid rgba(12, 12, 12, 0.08)",
                }}
                onClick={() =>
                  setSelectedEmailRecipients((prev) => ({
                    ...prev,
                    assessor: !prev.assessor,
                  }))
                }
                data-testid="checkbox-recipient-assessor"
              >
                <input
                  type="checkbox"
                  checked={selectedEmailRecipients.assessor}
                  onChange={(e) =>
                    setSelectedEmailRecipients((prev) => ({
                      ...prev,
                      assessor: e.target.checked,
                    }))
                  }
                  style={{ width: "18px", height: "18px", cursor: "pointer" }}
                />
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#0C0C0C",
                    }}
                  >
                    심사사 (
                    {caseData.assessorTeam || caseData.assessorId || "미지정"})
                  </div>
                  <div
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "12px",
                      color: "rgba(12, 12, 12, 0.5)",
                    }}
                  >
                    {caseData.assessorEmail}
                  </div>
                </div>
              </div>
            )}

            {/* 조사사 이메일 */}
            {caseData?.investigatorEmail && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "12px 16px",
                  background: selectedEmailRecipients.investigator
                    ? "rgba(0, 143, 237, 0.1)"
                    : "rgba(12, 12, 12, 0.02)",
                  borderRadius: "8px",
                  marginBottom: "8px",
                  cursor: "pointer",
                  border: selectedEmailRecipients.investigator
                    ? "1px solid rgba(0, 143, 237, 0.3)"
                    : "1px solid rgba(12, 12, 12, 0.08)",
                }}
                onClick={() =>
                  setSelectedEmailRecipients((prev) => ({
                    ...prev,
                    investigator: !prev.investigator,
                  }))
                }
                data-testid="checkbox-recipient-investigator"
              >
                <input
                  type="checkbox"
                  checked={selectedEmailRecipients.investigator}
                  onChange={(e) =>
                    setSelectedEmailRecipients((prev) => ({
                      ...prev,
                      investigator: e.target.checked,
                    }))
                  }
                  style={{ width: "18px", height: "18px", cursor: "pointer" }}
                />
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#0C0C0C",
                    }}
                  >
                    조사사 (
                    {caseData.investigatorTeamName ||
                      caseData.investigatorTeam ||
                      "미지정"}
                    )
                  </div>
                  <div
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "12px",
                      color: "rgba(12, 12, 12, 0.5)",
                    }}
                  >
                    {caseData.investigatorEmail}
                  </div>
                </div>
              </div>
            )}

            {/* 심사사/조사사 이메일이 없는 경우 안내 메시지 */}
            {!caseData?.assessorEmail && !caseData?.investigatorEmail && (
              <div
                style={{
                  padding: "12px 16px",
                  background: "rgba(12, 12, 12, 0.02)",
                  borderRadius: "8px",
                  marginBottom: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.5)",
                }}
              >
                등록된 심사사/조사사 이메일이 없습니다. 접수 시 이메일 정보를
                입력해주세요.
              </div>
            )}

            {/* 직접 입력 체크박스 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "12px 16px",
                background: selectedEmailRecipients.custom
                  ? "rgba(0, 143, 237, 0.1)"
                  : "rgba(12, 12, 12, 0.02)",
                borderRadius: "8px",
                cursor: "pointer",
                border: selectedEmailRecipients.custom
                  ? "1px solid rgba(0, 143, 237, 0.3)"
                  : "1px solid rgba(12, 12, 12, 0.08)",
              }}
              onClick={() =>
                setSelectedEmailRecipients((prev) => ({
                  ...prev,
                  custom: !prev.custom,
                }))
              }
              data-testid="checkbox-recipient-custom"
            >
              <input
                type="checkbox"
                checked={selectedEmailRecipients.custom}
                onChange={(e) =>
                  setSelectedEmailRecipients((prev) => ({
                    ...prev,
                    custom: e.target.checked,
                  }))
                }
                style={{ width: "18px", height: "18px", cursor: "pointer" }}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#0C0C0C",
                  }}
                >
                  직접 입력
                </div>
              </div>
            </div>
          </div>

          {/* 직접 입력 이메일 주소 */}
          {selectedEmailRecipients.custom && (
            <div style={{ marginBottom: "24px" }}>
              <label
                style={{
                  display: "block",
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                  color: "rgba(12, 12, 12, 0.6)",
                  marginBottom: "8px",
                }}
              >
                직접 입력 이메일 주소
              </label>
              <input
                type="email"
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
                placeholder="example@email.com"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  borderRadius: "8px",
                  border: "1px solid rgba(12, 12, 12, 0.15)",
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  color: "#0C0C0C",
                  outline: "none",
                }}
                data-testid="input-email-address"
              />
            </div>
          )}

          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={() => {
                setShowEmailInputDialog(false);
                setEmailAddress("");
                setSelectedEmailRecipients({
                  assessor: false,
                  investigator: false,
                  custom: false,
                });
              }}
              style={{
                flex: 1,
                padding: "14px",
                background: "rgba(12, 12, 12, 0.05)",
                borderRadius: "8px",
                border: "none",
                fontFamily: "Pretendard",
                fontWeight: 500,
                fontSize: "14px",
                color: "rgba(12, 12, 12, 0.6)",
                cursor: "pointer",
              }}
              data-testid="button-cancel-email-send"
            >
              취소
            </button>
            <button
              onClick={async () => {
                // 선택된 이메일 주소 수집
                const emailRecipients: string[] = [];
                if (
                  selectedEmailRecipients.assessor &&
                  caseData?.assessorEmail
                ) {
                  emailRecipients.push(caseData.assessorEmail);
                }
                if (
                  selectedEmailRecipients.investigator &&
                  caseData?.investigatorEmail
                ) {
                  emailRecipients.push(caseData.investigatorEmail);
                }
                if (
                  selectedEmailRecipients.custom &&
                  emailAddress &&
                  emailAddress.includes("@")
                ) {
                  emailRecipients.push(emailAddress);
                }

                if (emailRecipients.length === 0) {
                  toast({
                    title: "입력 오류",
                    description: "최소 하나의 수신자를 선택해주세요.",
                    variant: "destructive",
                  });
                  return;
                }

                if (
                  selectedEmailRecipients.custom &&
                  (!emailAddress || !emailAddress.includes("@"))
                ) {
                  toast({
                    title: "입력 오류",
                    description: "올바른 이메일 주소를 입력해주세요.",
                    variant: "destructive",
                  });
                  return;
                }

                setIsSendingEmail(true);

                toast({
                  title: "전송 중",
                  description: "보고서를 이메일로 전송하고 있습니다...",
                });

                try {
                  // 서버 측에서 PDF 생성 및 이메일 전송 (다운로드와 동일한 PDF 형식 및 섹션 설정 사용)
                  const response = await fetch(
                    "/api/send-field-report-email-v2",
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        emails: emailRecipients,
                        caseId: selectedCaseId,
                        sections: {
                          cover: true,
                          fieldReport: downloadSections["현장입력"] || false,
                          drawing: downloadSections["도면"] || false,
                          evidence: downloadSections["증빙자료"] || false,
                          estimate: downloadSections["견적서"] || false,
                          etc: downloadSections["기타사항"] || false,
                        },
                        evidence: {
                          tab: documentTab || "전체",
                          selectedFileIds: downloadSections["증빙자료"]
                            ? Array.from(selectedDocuments)
                            : [],
                        },
                      }),
                    },
                  );

                  // 502/프록시 에러 대응: text()로 먼저 받고 안전하게 JSON 파싱
                  const responseText = await response.text();
                  let result: any;
                  try {
                    result = JSON.parse(responseText);
                  } catch (parseError) {
                    console.error("JSON 파싱 실패. 원본 응답:", responseText);
                    throw new Error(
                      `서버 응답 오류 (${response.status}): ${responseText.substring(0, 100)}`,
                    );
                  }

                  if (response.ok) {
                    // 이메일 전송 성공 시 케이스 상태를 "현장정보제출"로 변경
                    try {
                      await apiRequest(
                        "PATCH",
                        `/api/cases/${selectedCaseId}/status`,
                        {
                          status: "현장정보제출",
                        },
                      );
                      // 케이스 데이터 새로고침
                      queryClient.invalidateQueries({
                        queryKey: [
                          "/api/field-surveys",
                          selectedCaseId,
                          "report",
                        ],
                      });
                      queryClient.invalidateQueries({
                        queryKey: ["/api/cases"],
                      });

                      // 현장정보제출 상태 변경 시 심사자/조사자에게 SMS 발송
                      try {
                        await apiRequest(
                          "POST",
                          "/api/send-stage-notification",
                          {
                            caseId: selectedCaseId,
                            stage: "현장정보제출",
                            recipients: {
                              partner: false,
                              manager: false,
                              assessorInvestigator: true,
                            },
                          },
                        );
                        console.log("현장정보제출 SMS 발송 완료");
                      } catch (smsError) {
                        console.error("SMS 발송 오류:", smsError);
                      }
                    } catch (statusError) {
                      console.error("상태 업데이트 오류:", statusError);
                    }

                    const recipientList = emailRecipients.join(", ");
                    toast({
                      title: "전송 완료",
                      description: `${recipientList}로 보고서가 전송되었습니다.`,
                    });
                    setShowEmailInputDialog(false);
                    setEmailAddress("");
                    setSelectedEmailRecipients({
                      assessor: false,
                      investigator: false,
                      custom: false,
                    });
                  } else {
                    throw new Error(
                      result.error || "이메일 전송에 실패했습니다",
                    );
                  }
                } catch (error) {
                  console.error("이메일 전송 오류:", error);
                  toast({
                    title: "전송 실패",
                    description:
                      error instanceof Error
                        ? error.message
                        : "이메일 전송 중 오류가 발생했습니다.",
                    variant: "destructive",
                  });
                } finally {
                  setIsSendingEmail(false);
                }
              }}
              disabled={isSendingEmail}
              style={{
                flex: 1,
                padding: "14px",
                background: isSendingEmail
                  ? "rgba(0, 143, 237, 0.5)"
                  : "#008FED",
                borderRadius: "8px",
                border: "none",
                fontFamily: "Pretendard",
                fontWeight: 600,
                fontSize: "14px",
                color: "#FFFFFF",
                cursor: isSendingEmail ? "not-allowed" : "pointer",
              }}
              data-testid="button-confirm-email-send"
            >
              {isSendingEmail ? "전송 중..." : "전송"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {/* 작성중인 건 */}
      <div className="relative mb-4" style={{ zIndex: 1 }}>
        <div
          style={{
            fontFamily: "Pretendard",
            fontSize: "15px",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "rgba(12, 12, 12, 0.7)",
            marginBottom: "16px",
            padding: "24px 0px",
          }}
        >
          작성중인 건
        </div>

        <div
          className="p-4 flex items-center justify-between"
          style={{
            background: "rgba(12, 12, 12, 0.04)",
            backdropFilter: "blur(7px)",
            borderRadius: "12px",
          }}
        >
          {/* 왼쪽: 케이스 정보 */}
          <div className="flex flex-col gap-2">
            {/* 첫 번째 줄: 보험사명 + 사고번호 */}
            <div className="flex items-center gap-4">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "#008FED" }}
              />
              <div className="flex items-center gap-2">
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "18px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.9)",
                  }}
                >
                  {caseData.insuranceCompany || "보험사 미정"}
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "18px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.9)",
                  }}
                >
                  {caseData.insuranceAccidentNo || ""}
                </span>
              </div>
            </div>

            {/* 두 번째 줄: 접수번호, 계약자, 담당자 */}
            <div
              className="flex items-center gap-6"
              style={{
                paddingLeft: "24px",
              }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 400,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.5)",
                  }}
                >
                  접수번호
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 400,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.7)",
                  }}
                >
                  {formatCaseNumber(caseData.caseNumber)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 400,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.5)",
                  }}
                >
                  계약자
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 400,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.7)",
                  }}
                >
                  {caseData.policyHolderName || caseData.clientName || "미정"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 400,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.5)",
                  }}
                >
                  담당자
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 400,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.7)",
                  }}
                >
                  {caseData.assignedPartnerManager || "미정"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* 탭 메뉴 + 다운로드/이메일 버튼 */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="relative w-full"
        style={{ zIndex: 1 }}
      >
        {/* 탭 헤더 - 새로운 디자인 */}
        <div
          className="flex items-center border-b-2 mb-0"
          style={{
            borderColor: "rgba(12, 12, 12, 0.1)",
          }}
        >
          {["현장조사", "도면", "증빙자료", "견적서", "기타사항/원인"].map(
            (tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="flex-1 flex items-center justify-center py-5"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "18px",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color:
                    activeTab === tab ? "#0C0C0C" : "rgba(12, 12, 12, 0.7)",
                  background: "transparent",
                  border: "none",
                  borderBottom:
                    activeTab === tab
                      ? "2px solid #008FED"
                      : "2px solid transparent",
                  marginBottom: "-2px",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
                data-testid={`tab-${tab}`}
              >
                {tab === "기타사항/원인" ? "기타사항입력" : tab}
              </button>
            ),
          )}
        </div>

        {/* 메인 콘텐츠 컨테이너 - blur 효과 */}
        <div
          style={{
            background: "rgba(12, 12, 12, 0.04)",
            backdropFilter: "blur(7px)",
            borderRadius: "12px",
            padding: "8px 0 20px",
            marginTop: "16px",
          }}
        >
          {/* 탭 콘텐츠 헤더 및 다운로드 버튼 - 증빙자료 탭 제외 (증빙자료는 자체 헤더 사용) */}
          {activeTab !== "증빙자료" && (
            <div className="flex items-center justify-between px-6 py-6">
              <h2
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "24px",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                }}
              >
                {activeTab === "현장조사" && "현장조사"}
                {activeTab === "도면" && "도면"}
                {activeTab === "견적서" && "견적서"}
                {activeTab === "기타사항/원인" && "기타사항/원인"}
              </h2>
              {/* 협력사용 저장 버튼 - 모든 탭에서 표시 (증빙자료 제외, 증빙자료는 자체 헤더 사용) */}
              {!isAdmin && !isPartnerReadOnly && (
                <Button
                  data-testid="button-save-notes-header"
                  onClick={() => saveNotesMutation.mutate(additionalNotes)}
                  disabled={saveNotesMutation.isPending}
                  className="px-6 py-3"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: "600",
                    minWidth: "100px",
                  }}
                >
                  {saveNotesMutation.isPending ? "저장 중..." : "저장"}
                </Button>
              )}
              {/* 관리자만 다운로드/이메일 버튼 표시 */}
              {isAdmin && (
                <div className="flex items-center gap-3">
                  {/* 이메일 전송 버튼: 1차승인(심사 승인) 이후에만 표시 */}
                  {caseData?.reviewDecision === "승인" && (
                    <button
                      onClick={() => {
                        setPdfDialogMode("email");
                        setShowPdfDialog(true);
                      }}
                      className="flex items-center gap-2 px-4 py-3"
                      style={{
                        background: "#FDFDFD",
                        boxShadow: "2px 4px 30px #BDD1F0",
                        borderRadius: "10px",
                        border: "none",
                        cursor: "pointer",
                      }}
                      data-testid="button-email-report"
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
                          stroke="#008FED"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <polyline
                          points="22,6 12,13 2,6"
                          stroke="#008FED"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "18px",
                          fontWeight: 600,
                          letterSpacing: "-0.02em",
                          color: "#008FED",
                        }}
                      >
                        이메일 전송
                      </span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setPdfDialogMode("download");
                      setShowPdfDialog(true);
                    }}
                    className="flex items-center gap-2 px-4 py-3"
                    style={{
                      background: "#FDFDFD",
                      boxShadow: "2px 4px 30px #BDD1F0",
                      borderRadius: "10px",
                      border: "none",
                      cursor: "pointer",
                    }}
                    data-testid="button-download-report"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"
                        stroke="#008FED"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "18px",
                        fontWeight: 600,
                        letterSpacing: "-0.02em",
                        color: "#008FED",
                      }}
                    >
                      전체 다운로드
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 현장조사 탭 */}
          <TabsContent
            value="현장조사"
            className="space-y-6 px-6"
            id="pdf-section-현장조사"
          >
            {/* 현장조사 정보 섹션 */}
            <div>
              <h2
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "20px",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                  marginBottom: "24px",
                }}
              >
                현장조사 정보
              </h2>

              {/* 현장정보 */}
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 600,
                      color: "rgba(12, 12, 12, 0.8)",
                    }}
                  >
                    현장정보
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center">
                    <span
                      className="w-32"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        color: "rgba(12, 12, 12, 0.6)",
                      }}
                    >
                      방문일시
                    </span>
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        color: "#0C0C0C",
                      }}
                    >
                      {caseData.visitDate && caseData.visitTime
                        ? `${caseData.visitDate} ${caseData.visitTime}`
                        : caseData.visitDate || "-"}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span
                      className="w-32"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        color: "rgba(12, 12, 12, 0.6)",
                      }}
                    >
                      출동 담당자
                    </span>
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        color: "#0C0C0C",
                      }}
                    >
                      {caseData.assignedPartnerManager || "-"}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span
                      className="w-32"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        color: "rgba(12, 12, 12, 0.6)",
                      }}
                    >
                      출동 업장지
                    </span>
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        color: "#0C0C0C",
                      }}
                    >
                      {caseData.assignedPartner || "-"}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span
                      className="w-32"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        color: "rgba(12, 12, 12, 0.6)",
                      }}
                    >
                      피보험자 주소
                    </span>
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        color: "#0C0C0C",
                      }}
                    >
                      {[
                        caseData.insuredAddress,
                        (caseData as any).insuredAddressDetail,
                      ]
                        .filter(Boolean)
                        .join(" ") || "-"}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* 사고 원인(누수원천) */}
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 600,
                      color: "rgba(12, 12, 12, 0.8)",
                    }}
                  >
                    사고 원인(누수원천)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center">
                    <span
                      className="w-32"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        color: "rgba(12, 12, 12, 0.6)",
                      }}
                    >
                      사고 발생일시
                    </span>
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        color: "#0C0C0C",
                      }}
                    >
                      {caseData.accidentDate || "-"}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span
                      className="w-32"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        color: "rgba(12, 12, 12, 0.6)",
                      }}
                    >
                      카테고리
                    </span>
                    <div
                      className="px-3 py-1 rounded"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        color: "#008FED",
                        background: "rgba(0, 143, 237, 0.1)",
                      }}
                    >
                      {caseData.accidentCategory || "-"}
                    </div>
                  </div>
                  <div>
                    <span
                      className="block mb-2"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        color: "rgba(12, 12, 12, 0.6)",
                      }}
                    >
                      사고원인
                    </span>
                    <div
                      className="p-4 rounded"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        color: "#0C0C0C",
                        background: "rgba(12, 12, 12, 0.03)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {caseData.accidentCause ||
                        "이 안에는 사고원인이 적성됩니다."}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* VOC(고객의 소리) - 협력사가 현장입력시 작성한 VOC */}
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 600,
                      color: "rgba(12, 12, 12, 0.8)",
                    }}
                  >
                    VOC(고객의 소리)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className="p-4 rounded"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      color: "#0C0C0C",
                      background: "rgba(12, 12, 12, 0.03)",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {(caseData as any).vocContent || "-"}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 피해 복구방식 및 처리 유형 섹션 */}
            <div>
              <h2
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "20px",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                  marginBottom: "24px",
                }}
              >
                피해 복구방식 및 처리 유형
              </h2>

              {/* 피해자 정보 - -1 이상 케이스에서만 표시 */}
              {(() => {
                const caseNumberSuffix =
                  caseData.caseNumber?.match(/-(\d+)$/)?.[1] || "0";
                const suffixNum = parseInt(caseNumberSuffix);
                const isInsuredCase = suffixNum === 0;

                if (isInsuredCase) {
                  return null;
                }

                return (
                  <Card className="mb-6">
                    <CardHeader>
                      <CardTitle
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 600,
                          color: "rgba(12, 12, 12, 0.8)",
                        }}
                      >
                        피해자 정보
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {(() => {
                        const victims = [];

                        if (caseData.victimName) {
                          const fullAddress = [
                            caseData.victimAddress,
                            caseData.victimAddressDetail,
                          ]
                            .filter(Boolean)
                            .join(" ");
                          victims.push({
                            name: caseData.victimName,
                            contact: caseData.victimContact || "",
                            address: fullAddress || "",
                          });
                        }

                        if (
                          caseData.additionalVictims &&
                          caseData.additionalVictims.trim()
                        ) {
                          try {
                            const additional = JSON.parse(
                              caseData.additionalVictims,
                            );
                            if (Array.isArray(additional)) {
                              victims.push(
                                ...additional.map((v: any) => ({
                                  name: v.name || "",
                                  contact: v.contact || "",
                                  address:
                                    [v.address, v.addressDetail]
                                      .filter(Boolean)
                                      .join(" ") || "",
                                })),
                              );
                            }
                          } catch (e) {
                            console.error(
                              "Error parsing additional victims:",
                              e,
                            );
                          }
                        }

                        return victims.length > 0 ? (
                          victims.map((victim, index) => (
                            <div
                              key={index}
                              className="p-3 rounded flex items-center gap-3"
                              style={{ background: "rgba(12, 12, 12, 0.03)" }}
                            >
                              <div
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ background: "#008FED" }}
                              />
                              <span
                                style={{
                                  fontFamily: "Pretendard",
                                  fontSize: "14px",
                                  fontWeight: 600,
                                  color: "#0C0C0C",
                                }}
                              >
                                {victim.name}
                              </span>
                              <span
                                style={{
                                  fontFamily: "Pretendard",
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.6)",
                                }}
                              >
                                {victim.contact}
                              </span>
                              <span
                                style={{
                                  fontFamily: "Pretendard",
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.6)",
                                }}
                              >
                                {victim.address}
                              </span>
                            </div>
                          ))
                        ) : (
                          <p
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              color: "rgba(12, 12, 12, 0.5)",
                            }}
                          >
                            등록된 피해자가 없습니다.
                          </p>
                        );
                      })()}
                    </CardContent>
                  </Card>
                );
              })()}

              {/* 처리 유형 및 복구 방식 */}
              <Card>
                <CardHeader>
                  <CardTitle
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 600,
                      color: "rgba(12, 12, 12, 0.8)",
                    }}
                  >
                    처리 유형 및 복구 방식
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <span
                        className="w-32"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 500,
                          color: "rgba(12, 12, 12, 0.6)",
                        }}
                      >
                        처리 유형
                      </span>
                      <div className="flex gap-2 flex-wrap">
                        {(() => {
                          let types: string[] = [];

                          if (
                            caseData.processingTypes &&
                            caseData.processingTypes.trim()
                          ) {
                            try {
                              const parsed = JSON.parse(
                                caseData.processingTypes,
                              );
                              if (Array.isArray(parsed)) {
                                types = parsed;
                              }
                            } catch (e) {
                              console.error(
                                "Error parsing processing types:",
                                e,
                              );
                            }
                          }

                          return types.length > 0 ? (
                            types.map((type: string, index: number) => (
                              <div
                                key={index}
                                className="px-3 py-1 rounded"
                                style={{
                                  fontFamily: "Pretendard",
                                  fontSize: "14px",
                                  color: "#008FED",
                                  background: "rgba(0, 143, 237, 0.1)",
                                }}
                              >
                                {type}
                              </div>
                            ))
                          ) : (
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                color: "rgba(12, 12, 12, 0.5)",
                              }}
                            >
                              -
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                    {/* 기타 처리 유형 상세 */}
                    {caseData.processingTypeOther && (
                      <div className="flex items-start">
                        <span
                          className="w-32 pt-1"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 500,
                            color: "rgba(12, 12, 12, 0.6)",
                          }}
                        >
                          기타 상세
                        </span>
                        <div
                          className="p-3 rounded flex-1"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            color: "#0C0C0C",
                            background: "rgba(12, 12, 12, 0.03)",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {caseData.processingTypeOther}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center">
                    <span
                      className="w-32"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        color: "rgba(12, 12, 12, 0.6)",
                      }}
                    >
                      복구 방식
                    </span>
                    <div
                      className="px-3 py-1 rounded"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        color: "#008FED",
                        background: "rgba(0, 143, 237, 0.1)",
                      }}
                    >
                      {caseData.recoveryMethodType || "-"}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 도면 탭 */}
          <TabsContent value="도면" className="px-6" id="pdf-section-도면">
            <div>
              <h2
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "20px",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                  marginBottom: "24px",
                }}
              >
                피해 복구방식 및 처리 유형
              </h2>

              {/* 도면 작성 */}
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 600,
                      color: "rgba(12, 12, 12, 0.8)",
                    }}
                  >
                    도면 작성
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {drawing ? (
                    (() => {
                      // 도면 요소들의 경계 계산
                      let minX = Infinity,
                        minY = Infinity,
                        maxX = 0,
                        maxY = 0;

                      drawing.rectangles?.forEach((rect) => {
                        const x = rect.x * DISPLAY_SCALE;
                        const y = rect.y * DISPLAY_SCALE;
                        const w = rect.width * DISPLAY_SCALE;
                        const h = rect.height * DISPLAY_SCALE;
                        minX = Math.min(minX, x);
                        minY = Math.min(minY, y);
                        maxX = Math.max(maxX, x + w + 50); // 우측 mm 표시 공간
                        maxY = Math.max(maxY, y + h + 20); // 하단 mm 표시 공간
                      });

                      drawing.uploadedImages?.forEach((img) => {
                        const x = img.x * DISPLAY_SCALE;
                        const y = img.y * DISPLAY_SCALE;
                        const w = img.width * DISPLAY_SCALE;
                        const h = img.height * DISPLAY_SCALE;
                        minX = Math.min(minX, x);
                        minY = Math.min(minY, y);
                        maxX = Math.max(maxX, x + w);
                        maxY = Math.max(maxY, y + h);
                      });

                      drawing.accidentAreas?.forEach((area) => {
                        const x = area.x * DISPLAY_SCALE;
                        const y = area.y * DISPLAY_SCALE;
                        const w = area.width * DISPLAY_SCALE;
                        const h = area.height * DISPLAY_SCALE;
                        minX = Math.min(minX, x);
                        minY = Math.min(minY, y);
                        maxX = Math.max(maxX, x + w);
                        maxY = Math.max(maxY, y + h);
                      });

                      drawing.leakMarkers?.forEach((marker) => {
                        const x = marker.x * DISPLAY_SCALE;
                        const y = marker.y * DISPLAY_SCALE;
                        minX = Math.min(minX, x - 12);
                        minY = Math.min(minY, y - 12);
                        maxX = Math.max(maxX, x + 12);
                        maxY = Math.max(maxY, y + 12);
                      });

                      // 컨테이너 크기
                      const containerWidth = 800;
                      const containerHeight = 600;

                      // 콘텐츠 크기 계산 (패딩 추가) - minX/minY 기준으로 정규화
                      const contentWidth = maxX - minX + 60;
                      const contentHeight = maxY - minY + 40;
                      // 모든 요소 좌표에서 뺄 오프셋 (0 기준 정규화용)
                      const normalizeX = minX;
                      const normalizeY = minY;

                      // 스케일 계산 (전체가 보이도록 축소)
                      const scaleX = containerWidth / contentWidth;
                      const scaleY = containerHeight / contentHeight;
                      const fitScale = Math.min(scaleX, scaleY, 1); // 1보다 크면 축소 안함

                      // 오프셋 계산 (중앙 정렬)
                      const offsetX =
                        (containerWidth - contentWidth * fitScale) / 2;
                      const offsetY = 20;

                      return (
                        <div
                          className="relative overflow-hidden"
                          style={{
                            width: "100%",
                            height: `${containerHeight}px`,
                            background: "white",
                            backgroundImage: `
                        linear-gradient(rgba(218, 218, 218, 0.5) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(218, 218, 218, 0.5) 1px, transparent 1px)
                      `,
                            backgroundSize: "10px 10px",
                          }}
                        >
                          <div
                            style={{
                              position: "absolute",
                              left: `${offsetX}px`,
                              top: `${offsetY}px`,
                              transform: `scale(${fitScale})`,
                              transformOrigin: "top left",
                              width: `${contentWidth}px`,
                              height: `${contentHeight}px`,
                            }}
                          >
                            {/* 업로드된 이미지 */}
                            {drawing.uploadedImages?.map((img) => (
                              <img
                                key={img.id}
                                src={img.src}
                                alt={`도면 이미지 ${img.id}`}
                                style={{
                                  position: "absolute",
                                  left: `${img.x * DISPLAY_SCALE - normalizeX}px`,
                                  top: `${img.y * DISPLAY_SCALE - normalizeY}px`,
                                  width: `${img.width * DISPLAY_SCALE}px`,
                                  height: `${img.height * DISPLAY_SCALE}px`,
                                  objectFit: "contain",
                                  userSelect: "none",
                                  zIndex: 1,
                                }}
                              />
                            ))}

                            {/* 사각형 - 항상 맨 아래 (z-index: 5) */}
                            {drawing.rectangles?.map((rect) => (
                              <div
                                key={rect.id}
                                style={{
                                  position: "absolute",
                                  left: `${rect.x * DISPLAY_SCALE - normalizeX}px`,
                                  top: `${rect.y * DISPLAY_SCALE - normalizeY}px`,
                                  width: `${rect.width * DISPLAY_SCALE}px`,
                                  height: `${rect.height * DISPLAY_SCALE}px`,
                                  border: "1px solid #0C0C0C",
                                  background:
                                    (rect as any).backgroundColor || "#FFFFFF",
                                  zIndex: 5,
                                }}
                              >
                                {/* 텍스트 */}
                                <div className="w-full h-full flex items-center justify-center">
                                  <span
                                    style={{
                                      fontFamily: "Pretendard",
                                      fontSize: "10px",
                                      color: "#0C0C0C",
                                    }}
                                  >
                                    {rect.text || ""}
                                  </span>
                                </div>

                                {/* mm 표시 (하단) */}
                                <div
                                  style={{
                                    position: "absolute",
                                    bottom: "-16px",
                                    left: "50%",
                                    transform: "translateX(-50%)",
                                    background: "rgba(218, 218, 218, 0.9)",
                                    padding: "1px 4px",
                                    borderRadius: "2px",
                                    fontSize: "9px",
                                    fontFamily: "Pretendard",
                                    color: "#0C0C0C",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {rect.width} mm
                                </div>

                                {/* mm 표시 (우측) */}
                                <div
                                  style={{
                                    position: "absolute",
                                    right: "-40px",
                                    top: "50%",
                                    transform: "translateY(-50%) rotate(90deg)",
                                    background: "rgba(218, 218, 218, 0.9)",
                                    padding: "1px 4px",
                                    borderRadius: "2px",
                                    fontSize: "9px",
                                    fontFamily: "Pretendard",
                                    color: "#0C0C0C",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {rect.height} mm
                                </div>
                              </div>
                            ))}

                            {/* 사고 영역 - 사각형보다 위 (z-index: 50) */}
                            {drawing.accidentAreas?.map((area) => (
                              <div
                                key={area.id}
                                style={{
                                  position: "absolute",
                                  left: `${area.x * DISPLAY_SCALE - normalizeX}px`,
                                  top: `${area.y * DISPLAY_SCALE - normalizeY}px`,
                                  width: `${area.width * DISPLAY_SCALE}px`,
                                  height: `${area.height * DISPLAY_SCALE}px`,
                                  border: "2px dashed #9E9E9E",
                                  background: "rgba(189, 189, 189, 0.3)",
                                  zIndex: 50,
                                }}
                              />
                            ))}

                            {/* 누수 마커 - 항상 맨 위 (z-index: 100) */}
                            {/* 부모의 scale(fitScale) 변환을 상쇄하기 위해 역스케일 적용 */}
                            {drawing.leakMarkers?.map((marker) => (
                              <div
                                key={marker.id}
                                style={{
                                  position: "absolute",
                                  left: `${marker.x * DISPLAY_SCALE - normalizeX}px`,
                                  top: `${marker.y * DISPLAY_SCALE - normalizeY}px`,
                                  width: "24px",
                                  height: "24px",
                                  transform: `translate(-50%, -50%) scale(${1 / fitScale})`,
                                  transformOrigin: "center",
                                  zIndex: 100,
                                }}
                              >
                                <svg
                                  width="24"
                                  height="24"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <circle
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    fill="#FF4D4F"
                                    opacity="0.2"
                                  />
                                  <circle
                                    cx="12"
                                    cy="12"
                                    r="6"
                                    fill="none"
                                    stroke="#FF4D4F"
                                    strokeWidth="2"
                                  />
                                  <line
                                    x1="12"
                                    y1="2"
                                    x2="12"
                                    y2="22"
                                    stroke="#FF4D4F"
                                    strokeWidth="2"
                                  />
                                  <line
                                    x1="2"
                                    y1="12"
                                    x2="22"
                                    y2="12"
                                    stroke="#FF4D4F"
                                    strokeWidth="2"
                                  />
                                </svg>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <p
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        color: "rgba(12, 12, 12, 0.5)",
                        textAlign: "center",
                        padding: "60px 0",
                      }}
                    >
                      등록된 도면이 없습니다.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 증빙자료 탭 */}
          <TabsContent
            value="증빙자료"
            className="px-6"
            id="pdf-section-증빙자료"
          >
            {/* 증빙자료 헤더 - 하나만 표시 */}
            <div className="flex items-center justify-between px-6 py-6">
              <h2
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "24px",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                }}
              >
                증빙자료 {documents?.length || 0}
              </h2>
              <div className="flex items-center gap-3">
                {/* 협력사용 저장 버튼 */}
                {!isAdmin && !isPartnerReadOnly && (
                  <Button
                    data-testid="button-save-notes-documents"
                    onClick={() => saveNotesMutation.mutate(additionalNotes)}
                    disabled={saveNotesMutation.isPending}
                    className="px-6 py-3"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: "600",
                      minWidth: "100px",
                    }}
                  >
                    {saveNotesMutation.isPending ? "저장 중..." : "저장"}
                  </Button>
                )}
                {/* 청구자료제출 버튼 - 직접복구 상태일 때만 표시 */}
                {caseData.status === "직접복구" && (
                  <Button
                    data-testid="button-claim-submit"
                    onClick={() => {
                      // 청구자료 필수 서류 검증
                      const validation = validateClaimDocuments();
                      if (!validation.valid) {
                        const docs = validation.missingDocs;
                        let message = "";
                        if (docs.length === 1) {
                          message = `'${docs[0]}' 미등록 되어있습니다.`;
                        } else if (docs.length === 2) {
                          message = `'${docs[0]}, ${docs[1]}' 미등록 되어있습니다.`;
                        } else {
                          message = `'${docs[0]}, ${docs[1]}' 등 미등록 되어있습니다.`;
                        }
                        toast({
                          title: "청구자료 제출 불가",
                          description: message,
                          variant: "destructive",
                        });
                        return;
                      }
                      setShowClaimSubmitDialog(true);
                    }}
                    disabled={claimSubmitMutation.isPending}
                    style={{
                      background: "#008FED",
                      color: "#FFFFFF",
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 600,
                      borderRadius: "10px",
                      padding: "12px 20px",
                    }}
                  >
                    {claimSubmitMutation.isPending
                      ? "제출 중..."
                      : "청구자료제출"}
                  </Button>
                )}
                <button
                  onClick={async () => {
                    if (documents && documents.length > 0) {
                      for (const doc of documents) {
                        if (doc.storageKey) {
                          try {
                            const response = await fetch(
                              `/api/documents/${doc.id}/download-url`,
                            );
                            if (response.ok) {
                              const data = await response.json();
                              const link = document.createElement("a");
                              link.href = data.downloadURL;
                              link.download = data.fileName || doc.fileName;
                              link.target = "_blank";
                              document.body.appendChild(link);
                              link.click();
                              document.body.removeChild(link);
                            }
                          } catch (e) {
                            console.error("Download error:", e);
                          }
                        } else if (doc.fileData) {
                          const link = document.createElement("a");
                          const mimeType = doc.fileType || "image/jpeg";
                          const dataUrl = doc.fileData.startsWith("data:")
                            ? doc.fileData
                            : `data:${mimeType};base64,${doc.fileData}`;
                          link.href = dataUrl;
                          link.download = doc.fileName;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }
                      }
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-3"
                  style={{
                    background: "#FDFDFD",
                    boxShadow: "2px 4px 30px #BDD1F0",
                    borderRadius: "10px",
                    border: "none",
                    cursor: "pointer",
                  }}
                  data-testid="button-download-all-documents"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"
                      stroke="#008FED"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "18px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "#008FED",
                    }}
                  >
                    전체 다운로드
                  </span>
                </button>
              </div>
            </div>

            <div
              className="flex flex-col px-6"
              style={{ padding: "0 24px", gap: "16px" }}
            >
              {/* 카테고리별 문서 리스트 */}
              {documents && documents.length > 0 ? (
                <div className="flex flex-col" style={{ gap: "16px" }}>
                  {[
                    // 사진
                    "현장출동사진",
                    "수리중 사진",
                    "복구완료 사진",
                    // 기본자료
                    "보험금 청구서",
                    "개인정보 동의서(가족용)",
                    // 증빙자료
                    "주민등록등본",
                    "등기부등본",
                    "건축물대장",
                    "기타증빙자료(민원일지 등)",
                    // 청구자료
                    "복구완료 및 위임장",
                    "도급계약서",
                    "부가세 청구자료",
                  ].map((category) => {
                    const categoryDocs = documents.filter(
                      (doc) => doc.category === category,
                    );
                    if (categoryDocs.length === 0) return null;

                    return (
                      <div
                        key={category}
                        style={{
                          background: "#FDFDFD",
                          borderRadius: "12px",
                          padding: "8px 16px 16px",
                        }}
                      >
                        {/* 카테고리 헤더 - 가운데 정렬 */}
                        <div
                          className="flex items-center justify-center"
                          style={{
                            padding: "12px 0",
                            fontFamily: "Pretendard",
                            fontSize: "20px",
                            fontWeight: 600,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {category} {categoryDocs.length}
                        </div>
                        {/* 파일 리스트 */}
                        <div className="flex flex-col" style={{ gap: "12px" }}>
                          {categoryDocs.map((doc) => {
                            // 모든 이미지는 API를 통해 로드 (Object Storage + 레거시 DB 파일 모두 지원)
                            const imageSrc = `/api/documents/${doc.id}/image`;
                            const isImage =
                              doc.fileType?.startsWith("image/") ||
                              doc.fileName?.match(
                                /\.(jpg|jpeg|png|gif|webp|bmp)$/i,
                              );

                            return (
                              <div
                                key={doc.id}
                                className="flex items-center justify-between"
                                style={{ gap: "12px", height: "64px" }}
                              >
                                {/* 왼쪽: 마이너스 아이콘 + 파일 아이콘/썸네일 + 파일명 */}
                                <div
                                  className="flex items-center"
                                  style={{ gap: "8px" }}
                                >
                                  {/* 마이너스(-) 삭제 아이콘 */}
                                  <button
                                    onClick={() => {
                                      // 삭제 기능 (필요시 구현)
                                      console.log("Delete document:", doc.id);
                                    }}
                                    style={{
                                      width: "24px",
                                      height: "24px",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      background: "transparent",
                                      border: "none",
                                      cursor: "pointer",
                                    }}
                                    data-testid={`button-delete-${doc.id}`}
                                  >
                                    <svg
                                      width="24"
                                      height="24"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                    >
                                      <circle
                                        cx="12"
                                        cy="12"
                                        r="10"
                                        stroke="rgba(12, 12, 12, 0.3)"
                                        strokeWidth="2"
                                      />
                                      <path
                                        d="M8 12h8"
                                        stroke="rgba(12, 12, 12, 0.3)"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                      />
                                    </svg>
                                  </button>

                                  {/* 파일 썸네일/아이콘 (64x64) */}
                                  <div
                                    style={{
                                      width: "64px",
                                      height: "64px",
                                      background: "rgba(12, 12, 12, 0.04)",
                                      borderRadius: "6px",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      overflow: "hidden",
                                      flexShrink: 0,
                                    }}
                                  >
                                    {isImage ? (
                                      <img
                                        src={imageSrc}
                                        alt={doc.fileName}
                                        style={{
                                          width: "100%",
                                          height: "100%",
                                          objectFit: "cover",
                                        }}
                                        data-testid={`image-preview-${doc.id}`}
                                      />
                                    ) : (
                                      <svg
                                        width="15"
                                        height="24"
                                        viewBox="0 0 15 24"
                                        fill="none"
                                      >
                                        <path
                                          d="M14.44 10.05l-6.19 6.19a4 4 0 0 1-5.66-5.66l6.19-6.19a2.67 2.67 0 0 1 3.77 3.77l-6.2 6.19a1.33 1.33 0 0 1-1.88-1.88l5.66-5.66"
                                          stroke="rgba(12, 12, 12, 0.8)"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      </svg>
                                    )}
                                  </div>

                                  {/* 파일명 - 밑줄 */}
                                  <span
                                    style={{
                                      fontFamily: "Pretendard",
                                      fontSize: "16px",
                                      fontWeight: 500,
                                      letterSpacing: "-0.02em",
                                      color: "rgba(12, 12, 12, 0.9)",
                                      textDecoration: "underline",
                                    }}
                                  >
                                    {doc.fileName}
                                  </span>
                                </div>

                                {/* 오른쪽: 다운로드 버튼 */}
                                <button
                                  onClick={async () => {
                                    if (doc.storageKey) {
                                      try {
                                        const response = await fetch(
                                          `/api/documents/${doc.id}/download-url`,
                                        );
                                        if (response.ok) {
                                          const data = await response.json();
                                          const link =
                                            document.createElement("a");
                                          link.href = data.downloadURL;
                                          link.download =
                                            data.fileName || doc.fileName;
                                          link.target = "_blank";
                                          document.body.appendChild(link);
                                          link.click();
                                          document.body.removeChild(link);
                                        }
                                      } catch (e) {
                                        console.error("Download error:", e);
                                      }
                                    } else {
                                      const link = document.createElement("a");
                                      link.href = imageSrc;
                                      link.download = doc.fileName;
                                      document.body.appendChild(link);
                                      link.click();
                                      document.body.removeChild(link);
                                    }
                                  }}
                                  style={{
                                    width: "24px",
                                    height: "24px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    background: "transparent",
                                    border: "none",
                                    cursor: "pointer",
                                  }}
                                  data-testid={`button-download-${doc.id}`}
                                >
                                  <svg
                                    width="24"
                                    height="24"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                  >
                                    <path
                                      d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"
                                      stroke="#008FED"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  style={{
                    background: "#FDFDFD",
                    borderRadius: "12px",
                    padding: "40px",
                    textAlign: "center",
                  }}
                >
                  <p
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      color: "rgba(12, 12, 12, 0.5)",
                    }}
                  >
                    등록된 증빙자료가 없습니다.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* 견적서 탭 */}
          <TabsContent value="견적서" className="px-6" id="pdf-section-견적서">
            <div className="min-w-0">
              {estimate.estimate &&
              (estimate.rows.length > 0 ||
                parsedLaborCosts.length > 0 ||
                parsedMaterialCosts.length > 0) ? (
                <>
                  {/* 헤더 */}
                  <div className="flex items-center justify-between mb-6">
                    <h2
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "20px",
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                        color: "#0C0C0C",
                      }}
                    >
                      견적서{" "}
                      {estimate.estimate.createdAt
                        ? new Date(estimate.estimate.createdAt)
                            .toISOString()
                            .split("T")[0]
                        : ""}
                    </h2>
                    {/* 관리자만 다운로드/이메일 버튼 표시 */}
                    {isAdmin && (
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            const caseNo = caseData?.caseNumber || "estimate";
                            toast({
                              title: "PDF 생성 중",
                              description: "잠시만 기다려주세요...",
                            });
                            try {
                              const response = await fetch("/api/pdf/download", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  caseId: selectedCaseId,
                                  sections: {
                                    cover: false,
                                    fieldReport: false,
                                    drawing: false,
                                    evidence: false,
                                    estimate: true,
                                    etc: false,
                                  },
                                  evidence: { tab: "전체", selectedFileIds: [] },
                                }),
                              });
                              if (!response.ok) {
                                throw new Error("PDF 생성 실패");
                              }
                              const blob = await response.blob();
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `견적서_${caseNo}.pdf`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              window.URL.revokeObjectURL(url);
                              toast({
                                title: "PDF 다운로드 완료",
                                description: "견적서가 다운로드되었습니다.",
                              });
                            } catch (error) {
                              console.error("PDF 생성 오류:", error);
                              toast({
                                title: "PDF 생성 실패",
                                description: "PDF 파일 생성 중 오류가 발생했습니다.",
                                variant: "destructive",
                              });
                            }
                          }}
                          className="flex items-center gap-2 px-4 py-2 rounded hover-elevate"
                          style={{
                            background: "rgba(0, 143, 237, 0.1)",
                            border: "1px solid rgba(0, 143, 237, 0.3)",
                          }}
                          data-testid="button-download-estimate"
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <path
                              d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"
                              stroke="#008FED"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 600,
                              color: "#008FED",
                            }}
                          >
                            다운로드
                          </span>
                        </button>
                        {/* 이메일 전송 버튼: 1차승인(심사 승인) 이후에만 표시 */}
                        {caseData?.reviewDecision === "승인" && (
                          <button
                            onClick={() => {
                              setPdfDialogMode("email");
                              setShowPdfDialog(true);
                            }}
                            className="flex items-center gap-2 px-4 py-2 rounded hover-elevate"
                            style={{
                              background: "rgba(0, 143, 237, 0.1)",
                              border: "1px solid rgba(0, 143, 237, 0.3)",
                            }}
                            data-testid="button-email-estimate"
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                            >
                              <path
                                d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
                                stroke="#008FED"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path
                                d="M22 6l-10 7L2 6"
                                stroke="#008FED"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 600,
                                color: "#008FED",
                              }}
                            >
                              이메일 전송
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 복구면적 산출표 - 손해방지 케이스는 숨김 */}
                  {!isLossPreventionCase && (
                    <Card className="mb-6 min-w-0">
                      <CardHeader>
                        <CardTitle
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 600,
                            color: "rgba(12, 12, 12, 0.8)",
                          }}
                        >
                          복구면적 산출표{" "}
                          {estimate.estimate.createdAt
                            ? new Date(estimate.estimate.createdAt)
                                .toISOString()
                                .split("T")[0]
                            : ""}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table
                            style={{
                              minWidth: "1100px",
                              width: "100%",
                              borderCollapse: "collapse",
                              fontFamily: "Pretendard",
                              fontSize: "13px",
                            }}
                          >
                            <thead>
                              <tr
                                style={{ background: "rgba(12, 12, 12, 0.03)" }}
                              >
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                  }}
                                >
                                  장소
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                  }}
                                >
                                  위치
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                  }}
                                >
                                  공사내용
                                </th>
                                <th
                                  colSpan={3}
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    borderLeft:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                  }}
                                >
                                  피해면적
                                </th>
                                <th
                                  colSpan={3}
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    borderLeft:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                  }}
                                >
                                  복구면적
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    borderLeft:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                  }}
                                >
                                  비고
                                </th>
                              </tr>
                              <tr
                                style={{ background: "rgba(12, 12, 12, 0.02)" }}
                              >
                                <th
                                  colSpan={3}
                                  style={{
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                  }}
                                ></th>
                                <th
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                    fontSize: "12px",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    borderLeft:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                  }}
                                >
                                  가로(m)
                                </th>
                                <th
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                    fontSize: "12px",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                  }}
                                >
                                  세로(m)
                                </th>
                                <th
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                    fontSize: "12px",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                  }}
                                >
                                  면적(㎡)
                                </th>
                                <th
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                    fontSize: "12px",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    borderLeft:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                  }}
                                >
                                  가로(m)
                                </th>
                                <th
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                    fontSize: "12px",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                  }}
                                >
                                  세로(m)
                                </th>
                                <th
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                    fontSize: "12px",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                  }}
                                >
                                  면적(㎡)
                                </th>
                                <th
                                  style={{
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    borderLeft:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                  }}
                                ></th>
                              </tr>
                            </thead>
                            <tbody>
                              {estimate.rows.map((row, index) => (
                                <tr
                                  key={row.id}
                                  style={{
                                    borderBottom:
                                      index === estimate.rows.length - 1
                                        ? "none"
                                        : "1px solid rgba(12, 12, 12, 0.06)",
                                  }}
                                >
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                    }}
                                  >
                                    {row.category || "-"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                    }}
                                  >
                                    {row.location || "-"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                    }}
                                  >
                                    {row.workName || "-"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                      borderLeft:
                                        "1px solid rgba(12, 12, 12, 0.06)",
                                    }}
                                  >
                                    {row.damageWidth || "0"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                    }}
                                  >
                                    {row.damageHeight || "0"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                    }}
                                  >
                                    {row.damageArea
                                      ? parseFloat(
                                          String(row.damageArea),
                                        ).toFixed(2)
                                      : "0"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                      borderLeft:
                                        "1px solid rgba(12, 12, 12, 0.06)",
                                    }}
                                  >
                                    {row.repairWidth || "0"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                    }}
                                  >
                                    {row.repairHeight || "0"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                    }}
                                  >
                                    {row.repairArea
                                      ? parseFloat(
                                          String(row.repairArea),
                                        ).toFixed(2)
                                      : "0"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                      borderLeft:
                                        "1px solid rgba(12, 12, 12, 0.06)",
                                    }}
                                  >
                                    {row.note || "-"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* 노무비 */}
                  <Card className="mb-6 min-w-0">
                    <CardHeader>
                      <CardTitle
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 600,
                          color: "rgba(12, 12, 12, 0.8)",
                        }}
                      >
                        노무비{" "}
                        {estimate.estimate.createdAt
                          ? new Date(estimate.estimate.createdAt)
                              .toISOString()
                              .split("T")[0]
                          : ""}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {parsedLaborCosts.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table
                            style={{
                              minWidth: "1100px",
                              width: "100%",
                              borderCollapse: "collapse",
                              fontFamily: "Pretendard",
                              fontSize: "13px",
                            }}
                          >
                            <thead>
                              <tr
                                style={{ background: "rgba(12, 12, 12, 0.03)" }}
                              >
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "100px",
                                  }}
                                >
                                  공종
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "100px",
                                  }}
                                >
                                  공사명
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "100px",
                                  }}
                                >
                                  노임항목
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "90px",
                                  }}
                                >
                                  복구면적
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "90px",
                                  }}
                                >
                                  적용단가
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "70px",
                                  }}
                                >
                                  수량(인)
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "100px",
                                  }}
                                >
                                  합계
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "80px",
                                  }}
                                >
                                  경비 여부
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "120px",
                                  }}
                                >
                                  비고
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {(() => {
                                const categoryGroups: { category: string; rows: (LaborCostRow & { isLinkedFromRecovery?: boolean })[]; workNameSubGroups: { workName: string; rows: (LaborCostRow & { isLinkedFromRecovery?: boolean })[] }[] }[] = [];

                                const extendedRows = parsedLaborCosts.map((row: any) => ({
                                  ...row,
                                  isLinkedFromRecovery: row.isLinkedFromRecovery || false,
                                }));

                                const linkedRows = extendedRows.filter((r: any) => r.isLinkedFromRecovery || r.sourceAreaRowId);
                                const independentRows = extendedRows.filter((r: any) => !r.isLinkedFromRecovery && !r.sourceAreaRowId);

                                const linkedCategories: string[] = [];
                                linkedRows.forEach((r: any) => {
                                  const cat = r.category || "미지정";
                                  if (!linkedCategories.includes(cat)) linkedCategories.push(cat);
                                });

                                const categoryRowsMap = new Map<string, any[]>();
                                linkedRows.forEach((row: any) => {
                                  const cat = row.category || "미지정";
                                  if (!categoryRowsMap.has(cat)) categoryRowsMap.set(cat, []);
                                  categoryRowsMap.get(cat)!.push(row);
                                });
                                categoryRowsMap.forEach((rows) => {
                                  rows.sort((a: any, b: any) => (a.workName || "").localeCompare(b.workName || ""));
                                });

                                const usedIndependent = new Set<string>();
                                linkedCategories.forEach((cat) => {
                                  independentRows.filter((r: any) => (r.category || "미지정") === cat).forEach((row: any) => {
                                    categoryRowsMap.get(cat)!.push(row);
                                    usedIndependent.add(row.id || "");
                                  });
                                });

                                independentRows.filter((r: any) => !usedIndependent.has(r.id || "")).forEach((row: any) => {
                                  const cat = row.category || "미지정";
                                  if (!categoryRowsMap.has(cat)) categoryRowsMap.set(cat, []);
                                  categoryRowsMap.get(cat)!.push(row);
                                });

                                const independentOnlyCategories: string[] = [];
                                independentRows.filter((r: any) => !usedIndependent.has(r.id || "")).forEach((r: any) => {
                                  const cat = r.category || "미지정";
                                  if (!linkedCategories.includes(cat) && !independentOnlyCategories.includes(cat)) independentOnlyCategories.push(cat);
                                });

                                const allCategories = [...linkedCategories, ...independentOnlyCategories];
                                const sortedRows: any[] = [];
                                allCategories.forEach((cat) => {
                                  sortedRows.push(...(categoryRowsMap.get(cat) || []));
                                });

                                let currentCat: string | null = null;
                                let currentGroup: typeof categoryGroups[0] | null = null;
                                sortedRows.forEach((row: any) => {
                                  const cat = row.category || "미지정";
                                  if (cat !== currentCat) {
                                    if (currentGroup) categoryGroups.push(currentGroup);
                                    currentGroup = { category: cat, rows: [row], workNameSubGroups: [] };
                                    currentCat = cat;
                                  } else {
                                    currentGroup!.rows.push(row);
                                  }
                                });
                                if (currentGroup) categoryGroups.push(currentGroup);

                                categoryGroups.forEach((group) => {
                                  let currentWn: string | null = null;
                                  let currentSub: typeof group.workNameSubGroups[0] | null = null;
                                  group.rows.forEach((row: any) => {
                                    const wn = row.workName || "";
                                    if (wn !== currentWn) {
                                      if (currentSub) group.workNameSubGroups.push(currentSub);
                                      currentSub = { workName: wn, rows: [row] };
                                      currentWn = wn;
                                    } else {
                                      currentSub!.rows.push(row);
                                    }
                                  });
                                  if (currentSub) group.workNameSubGroups.push(currentSub);
                                });

                                let globalIdx = 0;
                                return categoryGroups.map((group) => {
                                  let catRowIdx = 0;
                                  return group.workNameSubGroups.map((subGroup) => {
                                    return subGroup.rows.map((row, subRowIdx) => {
                                      const isFirstOfCategory = catRowIdx === 0;
                                      const isFirstOfWorkName = subRowIdx === 0;
                                      const rowElement = (
                                        <tr
                                          key={row.id || globalIdx}
                                          style={{
                                            borderBottom:
                                              globalIdx === sortedRows.length - 1
                                                ? "none"
                                                : "1px solid rgba(12, 12, 12, 0.06)",
                                          }}
                                        >
                                          {isFirstOfCategory && (
                                            <td
                                              rowSpan={group.rows.length}
                                              style={{
                                                padding: "10px 8px",
                                                textAlign: "center",
                                                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                                                verticalAlign: "middle",
                                                fontWeight: 600,
                                              }}
                                            >
                                              {group.category || "-"}
                                            </td>
                                          )}
                                          {isFirstOfWorkName && (
                                            <td
                                              rowSpan={subGroup.rows.length}
                                              style={{
                                                padding: "10px 8px",
                                                textAlign: "center",
                                                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                                                verticalAlign: "middle",
                                              }}
                                            >
                                              {subGroup.workName || "-"}
                                            </td>
                                          )}
                                          <td
                                            style={{
                                              padding: "10px 8px",
                                              textAlign: "center",
                                            }}
                                          >
                                            {row.detailItem || "-"}
                                          </td>
                                          {isFirstOfWorkName && (
                                            <td
                                              rowSpan={subGroup.rows.length}
                                              style={{
                                                padding: "10px 8px",
                                                textAlign: "right",
                                                borderLeft: "1px solid rgba(12, 12, 12, 0.06)",
                                                borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                                                verticalAlign: "middle",
                                              }}
                                            >
                                              {(recoveryAreaByWorkName[subGroup.workName] ?? row.damageArea ?? 0).toLocaleString()}
                                            </td>
                                          )}
                                          <td
                                            style={{
                                              padding: "10px 8px",
                                              textAlign: "right",
                                            }}
                                          >
                                            {(row.standardPrice || 0).toLocaleString()}
                                          </td>
                                          <td
                                            style={{
                                              padding: "10px 8px",
                                              textAlign: "center",
                                            }}
                                          >
                                            {(row.standardPrice > 0
                                              ? (row.amount || 0) / row.standardPrice
                                              : 0
                                            ).toFixed(1)}
                                          </td>
                                          <td
                                            style={{
                                              padding: "10px 8px",
                                              textAlign: "right",
                                              fontWeight: 600,
                                            }}
                                          >
                                            {(row.amount || 0).toLocaleString()}
                                          </td>
                                          <td
                                            style={{
                                              padding: "10px 8px",
                                              textAlign: "center",
                                            }}
                                          >
                                            {row.includeInEstimate ? "부" : "여"}
                                          </td>
                                          <td
                                            style={{
                                              padding: "10px 8px",
                                              textAlign: "center",
                                            }}
                                          >
                                            {row.request || "-"}
                                          </td>
                                        </tr>
                                      );
                                      globalIdx++;
                                      catRowIdx++;
                                      return rowElement;
                                    });
                                  });
                                });
                              })()}
                            </tbody>
                            <tfoot>
                              <tr
                                style={{
                                  background: "rgba(12, 12, 12, 0.04)",
                                  borderTop: "2px solid rgba(12, 12, 12, 0.2)",
                                }}
                              >
                                <td
                                  colSpan={6}
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "right",
                                    fontFamily: "Pretendard",
                                    fontSize: "14px",
                                    fontWeight: 600,
                                  }}
                                >
                                  총합계
                                </td>
                                <td
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "right",
                                    fontFamily: "Pretendard",
                                    fontSize: "16px",
                                    fontWeight: 700,
                                    color: "#008FED",
                                    background: "rgba(0, 143, 237, 0.05)",
                                  }}
                                >
                                  {parsedLaborCosts
                                    .reduce(
                                      (sum, row) => sum + (row.amount || 0),
                                      0,
                                    )
                                    .toLocaleString()}
                                </td>
                                <td colSpan={2}></td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <p
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            color: "rgba(12, 12, 12, 0.5)",
                            textAlign: "center",
                            padding: "40px 0",
                          }}
                        >
                          노무비 데이터가 없습니다.
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  {/* 자재비 */}
                  <Card className="mb-6 min-w-0">
                    <CardHeader>
                      <CardTitle
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 600,
                          color: "rgba(12, 12, 12, 0.8)",
                        }}
                      >
                        자재비{" "}
                        {estimate.estimate.createdAt
                          ? new Date(estimate.estimate.createdAt)
                              .toISOString()
                              .split("T")[0]
                          : ""}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {parsedMaterialCosts.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table
                            style={{
                              minWidth: "950px",
                              width: "100%",
                              borderCollapse: "collapse",
                              fontFamily: "Pretendard",
                              fontSize: "13px",
                            }}
                          >
                            <thead>
                              <tr
                                style={{ background: "rgba(12, 12, 12, 0.03)" }}
                              >
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "100px",
                                  }}
                                >
                                  공종
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "100px",
                                  }}
                                >
                                  공사명
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "120px",
                                  }}
                                >
                                  자재항목
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "90px",
                                  }}
                                >
                                  단가
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "70px",
                                  }}
                                >
                                  수량
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "60px",
                                  }}
                                >
                                  단위
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "100px",
                                  }}
                                >
                                  합계
                                </th>
                                <th
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "center",
                                    borderBottom:
                                      "1px solid rgba(12, 12, 12, 0.1)",
                                    minWidth: "120px",
                                  }}
                                >
                                  비고
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {parsedMaterialCosts.map((row, index) => (
                                <tr
                                  key={row.id || index}
                                  style={{
                                    borderBottom:
                                      index === parsedMaterialCosts.length - 1
                                        ? "none"
                                        : "1px solid rgba(12, 12, 12, 0.06)",
                                  }}
                                >
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                    }}
                                  >
                                    {row.공종 || "-"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                    }}
                                  >
                                    {row.공사명 || "-"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                    }}
                                  >
                                    {row.자재항목 || row.자재 || "-"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "right",
                                    }}
                                  >
                                    {(
                                      row.단가 ||
                                      row.기준단가 ||
                                      0
                                    ).toLocaleString()}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                    }}
                                  >
                                    {row.수량 || 0}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                    }}
                                  >
                                    {row.단위 || "-"}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "right",
                                      fontWeight: 600,
                                    }}
                                  >
                                    {(
                                      row.합계 ||
                                      row.금액 ||
                                      0
                                    ).toLocaleString()}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 8px",
                                      textAlign: "center",
                                    }}
                                  >
                                    {row.비고 || "-"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr
                                style={{
                                  background: "rgba(12, 12, 12, 0.04)",
                                  borderTop: "2px solid rgba(12, 12, 12, 0.2)",
                                }}
                              >
                                <td
                                  colSpan={6}
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "right",
                                    fontFamily: "Pretendard",
                                    fontSize: "14px",
                                    fontWeight: 600,
                                  }}
                                >
                                  총합계
                                </td>
                                <td
                                  style={{
                                    padding: "12px 8px",
                                    textAlign: "right",
                                    fontFamily: "Pretendard",
                                    fontSize: "16px",
                                    fontWeight: 700,
                                    color: "#008FED",
                                    background: "rgba(0, 143, 237, 0.05)",
                                  }}
                                >
                                  {parsedMaterialCosts
                                    .reduce(
                                      (sum, row) =>
                                        sum + (row.합계 || row.금액 || 0),
                                      0,
                                    )
                                    .toLocaleString()}
                                </td>
                                <td></td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <p
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            color: "rgba(12, 12, 12, 0.5)",
                            textAlign: "center",
                            padding: "40px 0",
                          }}
                        >
                          자재비 데이터가 없습니다.
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  {/* 합계 섹션 */}
                  <Card>
                    <CardContent className="p-6">
                      <div style={{ maxWidth: "400px", marginLeft: "auto" }}>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center py-2">
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 500,
                              }}
                            >
                              소계
                            </span>
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 600,
                              }}
                            >
                              {calculateTotals.subtotal.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-2">
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 500,
                              }}
                            >
                              일반관리비 (6%)
                            </span>
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 600,
                              }}
                            >
                              {calculateTotals.managementFee.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-2">
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 500,
                              }}
                            >
                              이윤 (15%)
                            </span>
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 600,
                              }}
                            >
                              {calculateTotals.profit.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-2">
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 500,
                              }}
                            >
                              천원단위 절사
                            </span>
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 600,
                              }}
                            >
                              -{calculateTotals.truncation.toLocaleString()}원
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-2">
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 500,
                              }}
                            >
                              VAT (10%)
                            </span>
                            <div className="flex items-center gap-3">
                              <label className="flex items-center gap-1">
                                <input
                                  type="radio"
                                  name="vat"
                                  checked={calculateTotals.vatIncluded}
                                  disabled
                                  style={{ accentColor: "#008FED" }}
                                />
                                <span
                                  style={{
                                    fontFamily: "Pretendard",
                                    fontSize: "13px",
                                    color: calculateTotals.vatIncluded
                                      ? "#008FED"
                                      : "#686A6E",
                                  }}
                                >
                                  포함
                                </span>
                              </label>
                              <label className="flex items-center gap-1">
                                <input
                                  type="radio"
                                  name="vat"
                                  checked={!calculateTotals.vatIncluded}
                                  disabled
                                  style={{ accentColor: "#008FED" }}
                                />
                                <span
                                  style={{
                                    fontFamily: "Pretendard",
                                    fontSize: "13px",
                                    color: !calculateTotals.vatIncluded
                                      ? "#008FED"
                                      : "#686A6E",
                                  }}
                                >
                                  별도
                                </span>
                              </label>
                              <span
                                style={{
                                  fontFamily: "Pretendard",
                                  fontSize: "14px",
                                  fontWeight: 600,
                                }}
                              >
                                {calculateTotals.vat.toLocaleString()}원
                              </span>
                            </div>
                          </div>
                          <div
                            className="flex justify-between items-center py-3 border-t"
                            style={{ borderTopWidth: "2px" }}
                          >
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "16px",
                                fontWeight: 700,
                                color: "#008FED",
                              }}
                            >
                              총 합계
                            </span>
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "18px",
                                fontWeight: 700,
                                color: "#008FED",
                              }}
                            >
                              {calculateTotals.total.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardContent className="p-6">
                    <p
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        color: "rgba(12, 12, 12, 0.5)",
                        textAlign: "center",
                        padding: "40px 0",
                      }}
                    >
                      등록된 견적서가 없습니다.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* 기타사항/원인 탭 */}
          <TabsContent
            value="기타사항/원인"
            className="px-6-relative"
            id="pdf-section-기타사항"
          >
            <Card>
              <CardContent className="p-6 space-y-4">
                <div>
                  <label
                    htmlFor="additional-notes"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: "500",
                      color: "#0C0C0C",
                      display: "block",
                      marginBottom: "8px",
                    }}
                  >
                    기타사항 입력
                  </label>
                  <Textarea
                    id="additional-notes"
                    data-testid="textarea-additional-notes"
                    placeholder={
                      isAdmin ? "" : "추가 메모 또는 특별 사항을 입력해주세요"
                    }
                    value={additionalNotes}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value.length <= 800) {
                        setAdditionalNotes(value);
                      }
                    }}
                    rows={10}
                    readOnly={isAdmin || isPartnerReadOnly}
                    disabled={isPartnerReadOnly}
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      resize: "none",
                      opacity: isPartnerReadOnly ? 0.6 : 1,
                    }}
                  />
                  <div
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "12px",
                      color: "rgba(12, 12, 12, 0.5)",
                      textAlign: "right",
                      marginTop: "8px",
                    }}
                  >
                    {additionalNotes.length}/800
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
      {/* SMS 알림 발송 다이얼로그 */}
      {reportData?.case && (
        <SmsNotificationDialog
          open={smsDialogOpen}
          onOpenChange={setSmsDialogOpen}
          caseData={reportData.case as unknown as SchemaCase}
          stage={smsStage}
          previousStatus={smsPreviousStatus}
          onSuccess={() => {
            setSmsDialogOpen(false);
            setSmsPreviousStatus(undefined);
          }}
        />
      )}
    </div>
  );
}
