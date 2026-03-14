import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  User,
  CaseWithLatestProgress,
  type UserFavorite,
  type Invoice,
  type Settlement,
} from "@shared/schema";
import { Search, Cloud, Star, Plus, CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import logoIcon from "@assets/Frame 2_1762217940686.png";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCaseNumber } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { GlobalHeader } from "@/components/global-header";
import { PdfCanvasViewer } from "@/components/pdf-canvas-viewer";
import IntakePage from "@/pages/intake";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  SmsNotificationDialog,
  type NotificationStage,
  type RecipientConfig,
} from "@/components/sms-notification-dialog";
import { InvoiceSheet, getCaseNumberPrefix } from "@/components/InvoiceSheet";
import { FieldDispatchCostSheet } from "@/components/FieldDispatchCostSheet";
import type { Case as SchemaCase } from "@shared/schema";

// Safe JSON parse helper for notes history
const safeParseNotesHistory = (
  json: string | null | undefined,
): Array<{ content: string; createdAt: string; createdByName?: string }> => {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// 금액 포맷 함수 (DB에 저장된 값 그대로 표시)
const formatAmount = (amount: string | number | null | undefined): string => {
  if (!amount) return "-";
  const numAmount = typeof amount === "string" ? parseInt(amount) : amount;
  if (isNaN(numAmount)) return "-";
  return `₩${numAmount.toLocaleString()}`;
};

// SMS 자동 발송을 위한 수신자 기본 설정
const STAGE_RECIPIENT_DEFAULTS: Record<NotificationStage, RecipientConfig> = {
  접수완료: { partner: true, manager: false, assessorInvestigator: false },
  현장정보입력: { partner: false, manager: false, assessorInvestigator: false },
  반려: { partner: false, manager: false, assessorInvestigator: false },
  승인반려: { partner: false, manager: false, assessorInvestigator: false },
  현장정보제출: { partner: false, manager: false, assessorInvestigator: false },
  복구요청: { partner: true, manager: false, assessorInvestigator: false },
  직접복구: { partner: false, manager: false, assessorInvestigator: false },
  미복구: { partner: false, manager: false, assessorInvestigator: false },
  청구자료제출: { partner: false, manager: false, assessorInvestigator: false },
  "출동비청구(선견적)": {
    partner: false,
    manager: false,
    assessorInvestigator: false,
  },
  청구: { partner: false, manager: false, assessorInvestigator: true },
  접수취소: { partner: false, manager: false, assessorInvestigator: true },
  입금완료: { partner: true, manager: false, assessorInvestigator: false },
  부분입금: { partner: true, manager: false, assessorInvestigator: false },
  부분지급: { partner: true, manager: false, assessorInvestigator: false },
  지급완료: { partner: true, manager: false, assessorInvestigator: false },
  정산완료: { partner: true, manager: true, assessorInvestigator: false },
  선견적요청: { partner: true, manager: true, assessorInvestigator: false },
  종결: { partner: true, manager: false, assessorInvestigator: false },
};

// 진행상태 목록 - DB에 저장되는 값
const CASE_STATUSES = [
  "배당대기",
  "접수완료",
  "현장방문",
  "현장정보입력",
  "검토중",
  "반려",
  "1차승인",
  "현장정보제출",
  "복구요청(2차승인)",
  "직접복구",
  "선견적요청",
  "청구자료제출(복구)",
  "출동비청구(선견적)",
  "청구",
  "입금완료",
  "부분입금",
  "부분지급",
  "지급완료",
  "정산완료",
  "종결",
  "접수취소",
] as const;

// 상태값을 화면 표시용 텍스트로 변환하는 함수 (변환 없이 그대로 반환)
const getStatusDisplayText = (status: string | null | undefined): string => {
  if (!status) return "배당대기";
  return status;
};

// 상태별 색상
const getStatusColor = (status: string | null | undefined) => {
  if (status === "1차승인") return "#008FED"; // 파란색
  if (status === "복구요청(2차승인)") return "#00C853"; // 초록색
  if (status === "접수취소" || status === "반려") return "#ED1C00"; // 빨간색
  if (
    status === "입금완료" ||
    status === "부분지급" ||
    status === "지급완료" ||
    status === "정산완료" ||
    status === "종결"
  )
    return "#4CAF50"; // 완료 초록색
  return "rgba(12, 12, 12, 0.7)"; // 기본 회색
};

const specialNotesFormSchema = z.object({
  specialNotes: z
    .string()
    .max(1000, "특이사항은 최대 1000자까지 입력 가능합니다"),
});

const progressFormSchema = z.object({
  content: z.string().min(1, "진행상황 내용을 입력해주세요"),
});

export default function ComprehensiveProgress() {
  const [activeMenu, setActiveMenu] = useState("종합진행관리");
  const [selectedStatus, setSelectedStatus] = useState("전체");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedManager, setSelectedManager] = useState<string>("__INIT__");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("caseId") || null;
  });
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [detailTab, setDetailTab] = useState("기본정보");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [showReceptionDetailDialog, setShowReceptionDetailDialog] =
    useState(false);
  const [isReceptionEditMode, setIsReceptionEditMode] = useState(false);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showFieldDispatchInvoiceDialog, setShowFieldDispatchInvoiceDialog] =
    useState(false);
  const [invoiceCaseId, setInvoiceCaseId] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [showFieldReportPdfDialog, setShowFieldReportPdfDialog] =
    useState(false);
  const [showInvoicePdfDialog, setShowInvoicePdfDialog] = useState(false);
  const [fieldReportPdfData, setFieldReportPdfData] =
    useState<ArrayBuffer | null>(null);
  const [invoicePdfData, setInvoicePdfData] = useState<ArrayBuffer | null>(
    null,
  );
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // SMS 알림 다이얼로그 상태 (추가 정보가 필요한 상태에서만 사용)
  const [smsDialogOpen, setSmsDialogOpen] = useState(false);
  const [smsStage, setSmsStage] = useState<NotificationStage>("복구요청");
  const [smsCaseData, setSmsCaseData] = useState<CaseWithLatestProgress | null>(
    null,
  );

  // 접수취소 확인 다이얼로그 상태
  const [cancelConfirmDialogOpen, setCancelConfirmDialogOpen] = useState(false);
  const [cancelTargetCase, setCancelTargetCase] =
    useState<CaseWithLatestProgress | null>(null);

  // 상태 변경 확인 다이얼로그 상태
  const [statusChangeDialogOpen, setStatusChangeDialogOpen] = useState(false);
  const [statusChangeTarget, setStatusChangeTarget] = useState<{
    caseId: string;
    status: string;
  } | null>(null);

  // 청구하기 버튼 표시 조건: 연관된 모든 케이스가 "청구" 상태인 경우에만 버튼 표시
  // (접수취소 건은 종결된 건으로 간주하여 제외)
  const canShowClaimButton = (
    caseItem: CaseWithLatestProgress,
    allCases: CaseWithLatestProgress[] | undefined,
  ): boolean => {
    if (!allCases) return false;

    // 해당 케이스가 "청구" 또는 청구자료제출 관련 상태인 경우에만 체크
    const claimStatuses = ["청구", "청구자료제출(복구)", "출동비청구(선견적)", "직접복구"];

    // 현재 케이스가 청구 상태가 아니면 버튼 숨김
    if (!claimStatuses.includes(caseItem.status || "")) {
      return false;
    }

    // 같은 prefix를 가진 모든 연관 케이스 찾기
    const groupPrefix = getCaseNumberPrefix(caseItem.caseNumber);
    if (!groupPrefix) return false;

    const relatedCases = allCases.filter((c) => {
      const prefix = getCaseNumberPrefix(c.caseNumber);
      return prefix === groupPrefix;
    });

    // 접수취소 건은 종결된 건으로 간주하여 제외
    const activeCases = relatedCases.filter((c) => c.status !== "접수취소");

    // 활성 케이스가 없으면 버튼 숨김
    if (activeCases.length === 0) return false;

    // 활성 케이스만 청구 관련 상태인지 확인
    return activeCases.every((c) => claimStatuses.includes(c.status || ""));
  };

  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const { hasItem } = usePermissions();
  const canDeleteCases = hasItem("종합진행관리", "접수건 삭제 권한");

  const { data: cases, isLoading } = useQuery<CaseWithLatestProgress[]>({
    queryKey: ["/api/cases"],
  });

  const { data: favorites = [] } = useQuery<UserFavorite[]>({
    queryKey: ["/api/favorites"],
    enabled: !!user,
  });

  // 기본 사용자 정보 타입 (협력사도 접근 가능)
  type BasicUser = {
    id: string;
    name: string | null;
    username: string;
    contact: string | null;
    role: string;
    bankName: string | null;
    accountNumber: string | null;
    company: string | null;
  };

  // 사용자 목록 가져오기 (담당자 이름 표시용) - 협력사도 접근 가능한 basic 엔드포인트 사용
  const { data: allUsers = [] } = useQuery<BasicUser[]>({
    queryKey: ["/api/users/basic"],
  });

  // 승인된 인보이스 목록 가져오기
  const { data: approvedInvoices = [] } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices/approved"],
  });

  const { data: allSettlements = [] } = useQuery<Settlement[]>({
    queryKey: ["/api/settlements"],
  });

  // 사용자 ID로 이름 가져오기
  const getUserName = (userId: string | null | undefined): string => {
    if (!userId) return "-";
    const foundUser = allUsers.find((u) => u.id === userId);
    return foundUser?.name || foundUser?.username || userId;
  };

  // 인보이스 승인된 그룹 프리픽스 목록 (Set for O(1) lookup)
  const approvedInvoicePrefixes = new Set(
    approvedInvoices.map((inv) => inv.caseGroupPrefix),
  );

  // 케이스 그룹별로 모든 케이스가 "청구" 상태인지 확인
  const isGroupReadyForComprehensiveProgress = (
    caseItem: CaseWithLatestProgress,
    allCases: CaseWithLatestProgress[] | undefined,
  ): boolean => {
    if (!allCases) return false;

    const groupPrefix = getCaseNumberPrefix(caseItem.caseNumber);
    if (!groupPrefix) return false;

    // 1. 인보이스가 승인되었는지 확인
    if (!approvedInvoicePrefixes.has(groupPrefix)) {
      return false;
    }

    // 2. 같은 그룹의 모든 케이스가 "청구" 관련 상태인지 확인
    const casesInGroup = allCases.filter(
      (c) => getCaseNumberPrefix(c.caseNumber) === groupPrefix,
    );
    const claimRelatedStatuses = [
      "청구",
      "청구자료제출(복구)",
      "출동비청구(선견적)",
      "입금완료",
      "부분입금",
      "부분지급",
      "지급완료",
      "정산완료",
    ];

    const allHaveClaimStatus = casesInGroup.every((c) =>
      claimRelatedStatuses.includes(c.status || ""),
    );

    return allHaveClaimStatus;
  };

  const isFavorite = favorites.some((f) => f.menuName === "종합진행관리");

  const toggleFavoriteMutation = useMutation({
    mutationFn: async () => {
      if (isFavorite) {
        await apiRequest(
          "DELETE",
          `/api/favorites/${encodeURIComponent("종합진행관리")}`,
        );
      } else {
        await apiRequest("POST", "/api/favorites", {
          menuName: "종합진행관리",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      toast({
        title: isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가",
        description: isFavorite
          ? "종합진행관리가 즐겨찾기에서 제거되었습니다."
          : "종합진행관리가 즐겨찾기에 추가되었습니다.",
      });
    },
    onError: () => {
      toast({
        title: "즐겨찾기 처리 실패",
        description: "다시 시도해주세요.",
        variant: "destructive",
      });
    },
  });

  const deleteCaseMutation = useMutation({
    mutationFn: async (caseId: string) => {
      return await apiRequest("DELETE", `/api/cases/${caseId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setSelectedCaseId(null);
      setShowDeleteDialog(false);
      toast({
        title: "삭제 완료",
        description: "접수건이 삭제되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "삭제 실패",
        description: error?.message || "접수건 삭제 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (caseIds: string[]) => {
      const results = await Promise.allSettled(
        caseIds.map((caseId) => apiRequest("DELETE", `/api/cases/${caseId}`)),
      );
      const failedCount = results.filter((r) => r.status === "rejected").length;
      if (failedCount > 0) {
        throw new Error(`${failedCount}건 삭제 실패`);
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setSelectedCaseIds([]);
      setShowBulkDeleteDialog(false);
      toast({
        title: "삭제 완료",
        description: `선택한 ${selectedCaseIds.length}건이 삭제되었습니다.`,
      });
    },
    onError: (error: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setSelectedCaseIds([]);
      setShowBulkDeleteDialog(false);
      toast({
        title: "일부 삭제 실패",
        description:
          error?.message || "일부 접수건 삭제 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({
      caseId,
      status,
    }: {
      caseId: string;
      status: string;
    }) => {
      // 백엔드에서 미복구→출동비 청구 전환 처리
      return await apiRequest("PATCH", `/api/cases/${caseId}/status`, {
        status,
      });
    },
    onMutate: async ({ caseId, status }) => {
      // 진행 중인 refetch 취소
      await queryClient.cancelQueries({ queryKey: ["/api/cases"] });

      // 이전 데이터 저장 (롤백용 및 SMS 다이얼로그용)
      const previousCases = queryClient.getQueryData<CaseWithLatestProgress[]>([
        "/api/cases",
      ]);

      // SMS 다이얼로그용 케이스 데이터 스냅샷 저장 (변경 전 상태)
      const targetCase = previousCases?.find((c) => c.id === caseId) || null;

      // 미복구는 출동비 청구로 정규화 (백엔드와 동일한 로직)
      const normalizedStatus = status === "미복구" ? "출동비 청구" : status;

      // Optimistic update: 즉시 UI 업데이트 (status만 변경, 나머지는 그대로 유지)
      queryClient.setQueryData<CaseWithLatestProgress[]>(
        ["/api/cases"],
        (old) => {
          if (!old) return old;
          return old.map((c) =>
            c.id === caseId ? { ...c, status: normalizedStatus } : c,
          );
        },
      );

      return { previousCases, targetCase };
    },
    onSuccess: async (data, variables, context) => {
      // 백엔드에서 반환된 실제 데이터로 업데이트
      // 서버에서 { success: true, case: updatedCase } 형태로 반환
      let updatedCaseData: CaseWithLatestProgress | null = null;
      const responseData = data as { success?: boolean; case?: unknown };
      if (
        responseData &&
        responseData.case &&
        typeof responseData.case === "object" &&
        "id" in responseData.case
      ) {
        updatedCaseData =
          responseData.case as unknown as CaseWithLatestProgress;
        queryClient.setQueryData<CaseWithLatestProgress[]>(
          ["/api/cases"],
          (old) => {
            if (!old) return old;
            return old.map((c) =>
              c.id === updatedCaseData!.id ? { ...c, ...updatedCaseData } : c,
            );
          },
        );
      }

      // 서버 응답에 case가 없으면 onMutate에서 저장한 스냅샷 사용
      if (!updatedCaseData && context?.targetCase) {
        updatedCaseData = context.targetCase;
      }

      // ro�F��라운드 refetch로 전체 데이터 동기화
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });

      // SMS 자동 발송 (Dialog 없이 바로 발송) - 추가 정보가 필요없는 상태에 사용
      const sendSmsAutomatically = async (
        caseData: CaseWithLatestProgress,
        stage: NotificationStage,
        previousStatus?: string,
      ) => {
        try {
          const recipients = STAGE_RECIPIENT_DEFAULTS[stage];

          // recipients가 모두 false인 경우 API 호출하지 않음
          if (
            !recipients.partner &&
            !recipients.manager &&
            !recipients.assessorInvestigator
          ) {
            return;
          }

          const payload: {
            caseId: string;
            stage: NotificationStage;
            recipients: typeof recipients;
            previousStatus?: string;
          } = {
            caseId: caseData.id,
            stage,
            recipients,
          };

          // 반려 시 이전 상태 전달
          if (stage === "반려" && previousStatus) {
            payload.previousStatus = previousStatus;
          }

          await apiRequest("POST", "/api/send-stage-notification", payload);
          toast({
            title: "문자 발송 완료",
            description: `${stage} 알림이 자동 발송되었습니다.`,
          });
        } catch (error) {
          console.error("SMS 자동 발송 실패:", error);
          toast({
            title: "문자 발송 실패",
            description: "문자 발송 중 오류가 발생했습니다.",
            variant: "destructive",
          });
        }
      };

      // 추가 정보 입력이 필요한 상태 (취소 사유 등)
      const stagesRequiringDialog: NotificationStage[] = ["접수취소"];

      // 미복구 선택 시 자동 전환 알림 (백엔드에서 출동비 청구로 변경됨)
      if (variables.status === "미복구") {
        toast({
          title: "상태 자동 변경",
          description:
            "미복구 선택으로 인해 상태가 '출동비 청구'로 자동 변경되었습니다.",
        });
        // 미복구 SMS 자동 발송
        if (updatedCaseData) {
          sendSmsAutomatically(updatedCaseData, "미복구");
        }
      } else {
        toast({
          title: "상태 변경 완료",
          description: "진행상태가 성공적으로 변경되었습니다.",
        });

        // 특정 상태 변경 시 SMS 발송 (표에 맞게 전체 상태 매핑)
        const smsRequiredStages: Record<string, NotificationStage> = {
          접수완료: "접수완료",
          현장정보입력: "현장정보입력",
          반려: "반려",
          현장정보제출: "현장정보제출",
          "복구요청(2차승인)": "복구요청",
          직접복구: "직접복구",
          선견적요청: "선견적요청",
          "청구자료제출(복구)": "청구자료제출",
          "출동비청구(선견적)": "출동비청구(선견적)",
          청구자료제출: "청구자료제출",
          청구: "청구",
          입금완료: "입금완료",
          부분입금: "부분입금",
          부분지급: "부분지급",
          지급완료: "지급완료",
          정산완료: "정산완료",
          접수취소: "접수취소",
          종결: "종결",
        };

        const stage = smsRequiredStages[variables.status];
        if (stage && updatedCaseData) {
          // 추가 정보가 필요한 상태는 Dialog 표시, 나머지는 자동 발송
          if (stagesRequiringDialog.includes(stage)) {
            setSmsCaseData(updatedCaseData);
            setSmsStage(stage);
            setSmsDialogOpen(true);
          } else {
            // 반려 시 이전 상태(변경 전 상태)를 전달
            const prevStatus =
              stage === "반려" ? context?.targetCase?.status : undefined;
            sendSmsAutomatically(updatedCaseData, stage, prevStatus);
          }
        }
      }
    },
    onError: (error, variables, context) => {
      // 롤백: 이전 데이터 복원
      if (context?.previousCases) {
        queryClient.setQueryData(["/api/cases"], context.previousCases);
      }

      toast({
        title: "상태 변경 실패",
        description: "상태 변경 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const updateSpecialNotesMutation = useMutation({
    mutationFn: async ({
      caseId,
      specialNotes,
    }: {
      caseId: string;
      specialNotes: string | null;
    }) => {
      return await apiRequest("PATCH", `/api/cases/${caseId}/special-notes`, {
        specialNotes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      specialNotesForm.reset();
      toast({
        variant: "snackbar",
        title: "특이사항이 저장되었습니다",
      });
    },
    onError: () => {
      toast({
        title: "저장 실패",
        description: "특이사항 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const confirmSpecialNotesMutation = useMutation({
    mutationFn: async (caseId: string) => {
      return await apiRequest(
        "PATCH",
        `/api/cases/${caseId}/special-notes-confirm`,
        {},
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({
        variant: "snackbar",
        title: "특이사항이 확인되었습니다",
      });
    },
    onError: () => {
      toast({
        title: "확인 실패",
        description: "특이사항 확인 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 특이사항 히스토리 입력 상태
  const [newNoteContent, setNewNoteContent] = useState("");

  // 특이사항 히스토리 추가 mutation
  const addNotesHistoryMutation = useMutation({
    mutationFn: async ({
      caseId,
      content,
    }: {
      caseId: string;
      content: string;
    }) => {
      return await apiRequest("POST", `/api/cases/${caseId}/notes-history`, {
        content,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setNewNoteContent("");
      toast({
        variant: "snackbar",
        title: "특이사항이 저장되었습니다",
      });
    },
    onError: () => {
      toast({
        title: "저장 실패",
        description: "특이사항 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 특이사항 확인 mutation (상대방 메모 확인 처리)
  const ackNotesMutation = useMutation({
    mutationFn: async (caseId: string) => {
      return await apiRequest("POST", `/api/cases/${caseId}/notes-ack`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({
        variant: "snackbar",
        title: "확인 처리되었습니다",
      });
    },
    onError: () => {
      toast({
        title: "확인 실패",
        description: "확인 처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // LMS 발송 관련 상태
  const [lmsMessageType, setLmsMessageType] = useState("");
  const [lmsRecipientType, setLmsRecipientType] = useState("");
  const [showLmsConfirmDialog, setShowLmsConfirmDialog] = useState(false);
  const [showManualHistoryForm, setShowManualHistoryForm] = useState(false);
  const [manualHistoryDate, setManualHistoryDate] = useState("");
  const [manualHistoryMedium, setManualHistoryMedium] = useState("");
  const [manualHistoryContent, setManualHistoryContent] = useState("");
  const [manualHistoryRecipient, setManualHistoryRecipient] = useState("");

  const sendLmsMutation = useMutation({
    mutationFn: async ({
      caseId,
      messageType,
      recipientType,
    }: {
      caseId: string;
      messageType: string;
      recipientType: string;
    }) => {
      return await apiRequest("POST", `/api/cases/${caseId}/send-lms`, {
        messageType,
        recipientType,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setLmsMessageType("");
      setLmsRecipientType("");
      setShowLmsConfirmDialog(false);
      toast({
        variant: "snackbar",
        title: "LMS 발송이 완료되었습니다",
      });
    },
    onError: (error: any) => {
      setShowLmsConfirmDialog(false);
      toast({
        title: "LMS 발송 실패",
        description: error?.message || "LMS 발송 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const addManualHistoryMutation = useMutation({
    mutationFn: async ({
      caseId,
      date,
      medium,
      content,
      recipient,
    }: {
      caseId: string;
      date: string;
      medium: string;
      content: string;
      recipient: string;
    }) => {
      return await apiRequest("POST", `/api/cases/${caseId}/manual-history`, {
        date,
        medium,
        content,
        recipient,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setShowManualHistoryForm(false);
      setManualHistoryDate("");
      setManualHistoryMedium("");
      setManualHistoryContent("");
      setManualHistoryRecipient("");
      toast({
        variant: "snackbar",
        title: "수기 이력이 추가되었습니다",
      });
    },
    onError: (error: any) => {
      toast({
        title: "수기 이력 추가 실패",
        description: error?.message || "수기 이력 추가 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const addProgressMutation = useMutation({
    mutationFn: async ({
      caseId,
      content,
    }: {
      caseId: string;
      content: string;
    }) => {
      return await apiRequest("POST", `/api/cases/${caseId}/progress`, {
        content,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      setShowProgressDialog(false);
      toast({
        variant: "snackbar",
        title: "진행상황이 추가되었습니다",
      });
    },
    onError: () => {
      toast({
        title: "추가 실패",
        description: "진행상황 추가 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // Find selected case
  const selectedCase = cases?.find((c) => c.id === selectedCaseId);

  // Form for special notes
  const specialNotesForm = useForm<z.infer<typeof specialNotesFormSchema>>({
    resolver: zodResolver(specialNotesFormSchema),
    defaultValues: {
      specialNotes: "",
    },
  });

  // Form for progress
  const progressForm = useForm<z.infer<typeof progressFormSchema>>({
    resolver: zodResolver(progressFormSchema),
    defaultValues: {
      content: "",
    },
  });

  const menuItems = [
    { name: "홈" },
    { name: "접수하기" },
    { name: "현장조사" },
    { name: "종합진행관리" },
    { name: "정산 및 통계" },
    { name: "관리자 설정" },
  ];

  const FILTER_STATUSES = [
    "배당대기",
    "접수완료",
    "현장정보제출",
    "복구요청(2차승인)",
    "청구자료제출(복구)",
    "출동비청구(선견적)",
    "청구",
  ] as const;

  const statusOptions = [
    { name: "전체", key: "all" },
    ...FILTER_STATUSES.map((status) => ({
      name: getStatusDisplayText(status),
      key: status,
    })),
  ];

  // 진행상태 필터링 + 협력사 필터링 (모든 케이스 표시)
  const filteredByStatus = (cases || []).filter((caseItem) => {
    if (caseItem.status === "종결") return false;

    // 협력사인 경우: 자신에게 배정된 모든 케이스 표시 (배당대기 제외)
    if (user?.role === "협력사") {
      const isAssignedToMe = caseItem.assignedPartner === user.company;
      const isNotPending = caseItem.status !== "배당대기";

      // 협력사도 진행상태 필터를 선택할 수 있음
      if (selectedStatus === "전체") {
        return isAssignedToMe && isNotPending;
      }
      if (selectedStatus === "미복구") {
        return (
          isAssignedToMe &&
          (caseItem.status === "미복구" || caseItem.status === "출동비 청구")
        );
      }
      if (selectedStatus === "출동비 청구") {
        return (
          isAssignedToMe &&
          (caseItem.status === "출동비 청구" || caseItem.status === "미복구")
        );
      }
      return isAssignedToMe && caseItem.status === selectedStatus;
    }

    // 다른 역할은 기존 필터링 로직 유지
    if (selectedStatus === "전체") return true;
    // 미복구는 출동비 청구로 정규화되어 저장되므로 둘 다 매칭
    if (selectedStatus === "미복구") {
      return caseItem.status === "미복구" || caseItem.status === "출동비 청구";
    }
    if (selectedStatus === "출동비 청구") {
      return caseItem.status === "출동비 청구" || caseItem.status === "미복구";
    }
    return caseItem.status === selectedStatus;
  });

  // 검색 필터링
  const filteredDataUnsorted = filteredByStatus.filter((caseItem) => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    if (normalizedQuery === "") {
      return true;
    }

    const insuranceCompany = (caseItem.insuranceCompany || "").toLowerCase();
    const insuranceAccidentNo = (
      caseItem.insuranceAccidentNo || ""
    ).toLowerCase();
    const caseNumber = (caseItem.caseNumber || "").toLowerCase();
    const insuredName = (caseItem.insuredName || "").toLowerCase();
    const managerName = (caseItem.managerName || "").toLowerCase();
    const insuredAddress = (caseItem.insuredAddress || "").toLowerCase();
    const insuredAddressDetail = (
      (caseItem as any).insuredAddressDetail || ""
    ).toLowerCase();

    return (
      insuranceCompany.includes(normalizedQuery) ||
      insuranceAccidentNo.includes(normalizedQuery) ||
      caseNumber.includes(normalizedQuery) ||
      insuredName.includes(normalizedQuery) ||
      managerName.includes(normalizedQuery) ||
      insuredAddress.includes(normalizedQuery) ||
      insuredAddressDetail.includes(normalizedQuery)
    );
  });

  const filteredByRole = filteredDataUnsorted.filter((caseItem) => {
    if (user?.role === "협력사") {
      return (caseItem.assignedPartner || "") === (user.company || "");
    }
    if (user?.role === "심사사") {
      return (caseItem.assessorId || "") === (user.company || "");
    }
    if (user?.role === "조사사") {
      return (caseItem.investigatorTeam || "") === (user.company || "");
    }
    return true;
  });

  const filteredByManager = filteredByRole.filter((caseItem) => {
    const managerValue =
      selectedManager === "__INIT__" ? "전체" : selectedManager;
    if (managerValue === "전체") return true;
    if (user?.role === "협력사") {
      return (caseItem.assignedPartnerManager || "") === managerValue;
    }
    if (user?.role === "심사사") {
      return (caseItem.assessorTeam || "") === managerValue;
    }
    if (user?.role === "조사사") {
      return (caseItem.investigatorTeamName || "") === managerValue;
    }
    return (caseItem.managerName || "") === managerValue;
  });

  // 최신순으로 정렬 (caseNumber 기준 내림차순 - yyMMddxxx 형식)
  const filteredData = [...filteredByManager].sort((a, b) => {
    // caseNumber에서 숫자 부분만 추출 (예: "251201001" -> 251201001, "251201001-1" -> 2512010011)
    const extractNumericValue = (caseNumber: string | null) => {
      if (!caseNumber) return 0;
      // 하이픈 제거하고 숫자만 추출
      const numericStr = caseNumber.replace(/-/g, "");
      return parseInt(numericStr, 10) || 0;
    };

    const numA = extractNumericValue(a.caseNumber);
    const numB = extractNumericValue(b.caseNumber);
    return numB - numA;
  });

  const totalCount = filteredData.length;

  // 협력사가 변경 가능한 상태 목록
  const PARTNER_ALLOWED_STATUSES = ["직접복구", "선견적요청"];
  // 협력사가 상태 변경 가능한 현재 상태들
  const PARTNER_CHANGEABLE_FROM_STATUSES = [
    "현장정보제출",
    "복구요청(2차승인)",
  ];

  // 상태 자동 전환 매핑 (선견적요청만 자동전환, 직접복구는 자동전환 없음)
  const STATUS_AUTO_TRANSITION: Record<string, string> = {
    선견적요청: "출동비청구(선견적)",
  };

  // 상태 변경 핸들러
  const handleStatusChange = (caseId: string, status: string) => {
    // 자동 전환이 필요한 상태인지 확인
    const targetStatus = STATUS_AUTO_TRANSITION[status] || status;

    // 접수취소인 경우 확인 팝업 먼저 표시
    if (targetStatus === "접수취소") {
      const targetCase = cases?.find((c) => c.id === caseId);
      if (targetCase) {
        setCancelTargetCase(targetCase);
        setCancelConfirmDialogOpen(true);
      }
      return;
    }

    // 협력사 권한 체크
    if (user?.role === "협력사") {
      if (!PARTNER_ALLOWED_STATUSES.includes(status)) {
        toast({
          title: "권한 없음",
          description:
            "협력사는 '직접복구' 또는 '선견적요청' 상태만 선택할 수 있습니다.",
          variant: "destructive",
        });
        return;
      }
    }

    // 관리자 또는 허용된 협력사: 확인 팝업 표시
    if (user?.role === "관리자" || user?.role === "협력사") {
      setStatusChangeTarget({ caseId, status: targetStatus });
      setStatusChangeDialogOpen(true);
      return;
    }

    // 그 외 역할은 상태 변경 불가
    toast({
      title: "권한 없음",
      description: "상태 변경 권한이 없습니다.",
      variant: "destructive",
    });
  };

  // 진행상황 Dialog 열기 핸들러 (관리자만)
  const handleOpenProgressDialog = () => {
    if (!selectedCaseId) {
      toast({
        title: "케이스 선택 필요",
        description: "케이스를 먼저 선택해주세요.",
        variant: "destructive",
      });
      return;
    }
    if (user?.role !== "관리자") {
      toast({
        title: "권한 없음",
        description: "관리자만 진행상황을 입력할 수 있습니다.",
        variant: "destructive",
      });
      return;
    }
    setShowProgressDialog(true);
  };

  // 특이사항 확인 핸들러 (관리자만)
  const handleConfirmSpecialNotes = () => {
    if (!selectedCaseId) return;
    if (user?.role !== "관리자") {
      toast({
        title: "권한 없음",
        description: "관리자만 특이사항을 확인할 수 있습니다.",
        variant: "destructive",
      });
      return;
    }
    confirmSpecialNotesMutation.mutate(selectedCaseId);
  };

  // 특이사항 제출 핸들러
  const handleSpecialNotesSubmit = (
    values: z.infer<typeof specialNotesFormSchema>,
  ) => {
    if (!selectedCaseId) return;

    // 빈 문자열을 null로 변환
    const specialNotes =
      values.specialNotes.trim() === "" ? null : values.specialNotes.trim();

    updateSpecialNotesMutation.mutate({
      caseId: selectedCaseId,
      specialNotes,
    });
  };

  // 진행상황 제출 핸들러
  const handleProgressSubmit = (values: z.infer<typeof progressFormSchema>) => {
    if (!selectedCaseId) return;

    addProgressMutation.mutate({
      caseId: selectedCaseId,
      content: values.content.trim(),
    });
  };

  // Dialog 열릴 때 form reset
  useEffect(() => {
    if (showProgressDialog) {
      progressForm.reset({
        content: "",
      });
    }
  }, [showProgressDialog, progressForm]);

  // 협력사 진행상황 폼 초기화 (탭 전환 시 또는 케이스 변경 시)
  useEffect(() => {
    if (detailTab === "진행상황" && user?.role === "협력사" && selectedCase) {
      specialNotesForm.reset({
        specialNotes: selectedCase.specialNotes || "",
      });
    }
  }, [detailTab, selectedCase, user?.role, specialNotesForm]);

  useEffect(() => {
    if (selectedManager === "__INIT__" && user) {
      if (user.role === "협력사" || user.role === "심사사" || user.role === "조사사") {
        setSelectedManager("전체");
      } else if (user.name) {
        setSelectedManager(user.name);
      }
    }
  }, [user, selectedManager]);

  const adminUsers = allUsers.filter((u) => u.role === "관리자");

  // 로그인한 유저 역할에 따라 드롭다운에 표시할 유저 목록
  const dropdownUsers = (() => {
    if (!user) return adminUsers;
    if (user.role === "협력사") {
      return allUsers.filter((u) => u.role === "협력사" && u.company === user.company);
    }
    if (user.role === "심사사") {
      return allUsers.filter((u) => u.role === "심사사" && u.company === user.company);
    }
    if (user.role === "조사사") {
      return allUsers.filter((u) => u.role === "조사사" && u.company === user.company);
    }
    return adminUsers;
  })();

  // 당일차 계산 (접수일부터 오늘까지)
  const calculateDays = (createdAt: string | null) => {
    if (!createdAt) return 0;
    const created = new Date(createdAt);
    const today = new Date();
    const diffTime = Math.abs(today.getTime() - created.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // 날짜 포맷팅 (YYYY-MM-DD)
  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  if (userLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">로딩 중...</div>
      </div>
    );
  }

  if (!user) {
    setLocation("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-white">
      <GlobalHeader />
      {/* Main Content */}
      <div
        style={{
          maxWidth: "1595px",
          margin: "0 auto",
          padding: "32px 20px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Page Title */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "24px",
          }}
        >
          <h1
            style={{
              fontFamily: "Pretendard",
              fontWeight: 600,
              fontSize: "28px",
              lineHeight: "128%",
              letterSpacing: "-0.02em",
              color: "#0C0C0C",
            }}
          >
            종합진행관리
          </h1>
          <button
            type="button"
            onClick={() => toggleFavoriteMutation.mutate()}
            className="flex items-center justify-center hover-elevate active-elevate-2 rounded transition-all"
            style={{
              width: "24px",
              height: "24px",
              padding: "4px",
            }}
            data-testid="favorite-종합진행관리"
          >
            <Star
              size={16}
              fill={isFavorite ? "#FFB800" : "none"}
              stroke={isFavorite ? "#FFB800" : "rgba(12, 12, 12, 0.3)"}
              strokeWidth={2}
            />
          </button>
        </div>

        {/* Search Section */}
        <div
          style={{
            background: "#FFFFFF",
            boxShadow: "0px 0px 20px #DBE9F5",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "16px",
          }}
        >
          {/* Header */}
          {/* Status Filter Dropdown + Search Input (한 줄 배치) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            {/* Status Filter Dropdown */}
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger
                className="w-[180px] h-[52px]"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 400,
                  letterSpacing: "-0.02em",
                  border: "1px solid rgba(12, 12, 12, 0.1)",
                  borderRadius: "6px",
                }}
                data-testid="select-status-filter"
              >
                <SelectValue placeholder="진행상태 선택" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem
                    key={option.key}
                    value={option.name}
                    data-testid={`option-${option.key}`}
                  >
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Search Input */}
            <div style={{ position: "relative", flex: 1 }}>
              <Search
                className="absolute left-4 top-1/2 transform -translate-y-1/2"
                style={{
                  width: "20px",
                  height: "20px",
                  color: "rgba(12, 12, 12, 0.4)",
                }}
              />
              <input
                type="text"
                placeholder="보험사 사고번호, 접수번호, 피보험자, 피보험자 주소, 당사 담당자 등으로 검색해주세요."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                  }
                }}
                style={{
                  width: "100%",
                  height: "52px",
                  padding: "0 20px 0 52px",
                  background: "#FDFDFD",
                  border: "1px solid rgba(12, 12, 12, 0.1)",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 400,
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                }}
                data-testid="input-search"
              />
            </div>

            {/* Search Button */}
            <button
              onClick={() => {
                // 검색 기능은 실시간으로 이미 작동 중
              }}
              style={{
                width: "100px",
                height: "52px",
                background: "#008FED",
                borderRadius: "8px",
                border: "none",
                fontFamily: "Pretendard",
                fontSize: "16px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "#FFFFFF",
                cursor: "pointer",
              }}
              data-testid="button-search"
            >
              검색
            </button>

            <div
              style={{
                width: "1px",
                height: "32px",
                background: "rgba(12,12,12,0.1)",
                flexShrink: 0,
              }}
            />

            <span
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "#0C0C0C",
                whiteSpace: "nowrap",
              }}
            >구   분</span>

            <Select
              value={selectedManager === "__INIT__" ? "전체" : selectedManager}
              onValueChange={setSelectedManager}
            >
              <SelectTrigger
                className="w-[140px] h-[52px]"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 400,
                  letterSpacing: "-0.02em",
                  border: "1px solid rgba(12, 12, 12, 0.1)",
                  borderRadius: "6px",
                  flexShrink: 0,
                }}
                data-testid="select-manager-filter"
              >
                <SelectValue placeholder="담당자 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="전체" data-testid="option-manager-all">
                  전체
                </SelectItem>
                {dropdownUsers.map((u) => (
                  <SelectItem
                    key={u.id}
                    value={u.name || u.username}
                    data-testid={`option-manager-${u.id}`}
                  >
                    {u.name || u.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <button
              onClick={() => {
                // 조회 트리거 - 필터링은 이미 실시간
              }}
              style={{
                height: "52px",
                padding: "0 20px",
                background: "#008FED",
                borderRadius: "8px",
                border: "none",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "#FFFFFF",
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
              data-testid="button-manager-search"
            >
              조회하기
            </button>
          </div>
        </div>

        {/* Count and Bulk Delete Button */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 4px",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span
              style={{
                fontFamily: "Pretendard",
                fontWeight: 700,
                fontSize: "20px",
                lineHeight: "128%",
                letterSpacing: "-0.02em",
                color: "rgba(12, 12, 12, 0.7)",
              }}
            >
              전체건
            </span>
            <span
              style={{
                fontFamily: "Pretendard",
                fontWeight: 700,
                fontSize: "20px",
                lineHeight: "128%",
                letterSpacing: "-0.02em",
                color: "#008FED",
              }}
            >
              {totalCount}
            </span>
          </div>
          {canDeleteCases && selectedCaseIds.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowBulkDeleteDialog(true)}
              disabled={bulkDeleteMutation.isPending}
              data-testid="button-bulk-delete"
            >
              {bulkDeleteMutation.isPending
                ? "삭제 중..."
                : `선택된 ${selectedCaseIds.length}건 삭제`}
            </Button>
          )}
        </div>

        {/* Table */}
        <div
          style={{
            background: "#FFFFFF",
            boxShadow: "0px 0px 20px #DBE9F5",
            borderRadius: "12px",
            overflow: "hidden",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            {/* Table Header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  user?.role === "협력사"
                    ? "40px 100px 110px 100px 80px 1fr 90px 90px 90px 60px 130px 50px 90px 160px"
                    : "40px 100px 110px 100px 80px 1fr 90px 90px 90px 60px 130px 50px 160px",
                padding: "14px 20px",
                background: "rgba(12, 12, 12, 0.04)",
                borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                gap: "8px",
              }}
            >
              {canDeleteCases && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Checkbox
                    checked={
                      filteredData.length > 0 &&
                      selectedCaseIds.length === filteredData.length
                    }
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedCaseIds(filteredData.map((c) => c.id));
                      } else {
                        setSelectedCaseIds([]);
                      }
                    }}
                    data-testid="checkbox-select-all"
                  />
                </div>
              )}
              {!canDeleteCases && <div style={{ width: "40px" }} />}
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                }}
              >
                사고번호
              </div>
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                }}
              >
                접수번호
              </div>
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                }}
              >
                보험사
              </div>
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                }}
              >
                피보험자
              </div>
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                  textAlign: "center",
                }}
              >
                주소
              </div>
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                }}
              >
                담당자
              </div>
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                }}
              >
                협력사
              </div>
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                  textAlign: "center",
                }}
              >
                승인금액
              </div>
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                  textAlign: "center",
                }}
              >
                경과일
              </div>
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                  textAlign: "center",
                }}
              >
                진행상태
              </div>
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                }}
              >
                특이사항
              </div>
              {user?.role === "협력사" && (
                <div
                  style={{
                    fontFamily: "Pretendard",
                    fontWeight: 600,
                    fontSize: "13px",
                    color: "rgba(12, 12, 12, 0.6)",
                  }}
                >
                  수행업무
                </div>
              )}
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: "rgba(12, 12, 12, 0.6)",
                  textAlign: "center",
                }}
              >
                자세히 보기
              </div>
            </div>

            {/* Table Body */}
            {filteredData.length === 0 ? (
              <div
                style={{
                  padding: "80px 20px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "24px",
                }}
              >
                <Cloud
                  style={{
                    width: "80px",
                    height: "80px",
                    color: "#008FED",
                    opacity: 0.3,
                  }}
                />
                <div
                  style={{
                    fontFamily: "Pretendard",
                    fontWeight: 500,
                    fontSize: "18px",
                    color: "rgba(12, 12, 12, 0.6)",
                  }}
                >
                  검색 결과가 없습니다.
                </div>
                <div
                  style={{
                    padding: "20px 24px",
                    background: "rgba(12, 12, 12, 0.02)",
                    borderRadius: "8px",
                    display: "flex",
                    gap: "8px",
                    alignItems: "flex-start",
                  }}
                >
                  <div
                    style={{
                      width: "20px",
                      height: "20px",
                      borderRadius: "50%",
                      background: "rgba(12, 12, 12, 0.1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "Pretendard",
                      fontWeight: 600,
                      fontSize: "12px",
                      color: "rgba(12, 12, 12, 0.6)",
                      flexShrink: 0,
                    }}
                  >
                    i
                  </div>
                  <div>
                    <div
                      style={{
                        fontFamily: "Pretendard",
                        fontWeight: 600,
                        fontSize: "14px",
                        color: "rgba(12, 12, 12, 0.7)",
                        marginBottom: "8px",
                      }}
                    >
                      이렇게 검색해보세요
                    </div>
                    <ul
                      style={{
                        listStyle: "none",
                        padding: 0,
                        margin: 0,
                        fontFamily: "Pretendard",
                        fontWeight: 400,
                        fontSize: "13px",
                        color: "rgba(12, 12, 12, 0.6)",
                        lineHeight: "1.6",
                      }}
                    >
                      <li>
                        • 검색어를 콤마(,)로 분리하면 다중검색이 가능합니다
                      </li>
                      <li>
                        • 보험사명, 사고번호, 접수번호, 피보험자, 당사 담당자
                        등으로 검색해보세요.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              filteredData.map((caseItem, index) => {
                return (
                  <div
                    key={caseItem.id}
                    onClick={() => setSelectedCaseId(caseItem.id)}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        user?.role === "협력사"
                          ? "40px 100px 110px 100px 80px 1fr 90px 90px 90px 60px 130px 50px 90px 160px"
                          : "40px 100px 110px 100px 80px 1fr 90px 90px 90px 60px 130px 50px 160px",
                      padding: "14px 20px",
                      borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                      gap: "8px",
                      alignItems: "center",
                      cursor: "pointer",
                    }}
                    data-testid={`case-row-${caseItem.id}`}
                  >
                    {canDeleteCases && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedCaseIds.includes(caseItem.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedCaseIds((prev) => [
                                ...prev,
                                caseItem.id,
                              ]);
                            } else {
                              setSelectedCaseIds((prev) =>
                                prev.filter((id) => id !== caseItem.id),
                              );
                            }
                          }}
                          data-testid={`checkbox-case-${caseItem.id}`}
                        />
                      </div>
                    )}
                    {!canDeleteCases && <div style={{ width: "40px" }} />}
                    <div
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {caseItem.insuranceAccidentNo || "-"}
                    </div>
                    <div
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {formatCaseNumber(caseItem.caseNumber) || "-"}
                    </div>
                    <div
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {caseItem.insuranceCompany || "-"}
                    </div>
                    <div
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {caseItem.insuredName || "-"}
                    </div>
                    {(() => {
                      const caseNumberSuffix =
                        caseItem.caseNumber?.match(/-(\d+)$/)?.[1] || "0";
                      const suffixNum = parseInt(caseNumberSuffix);
                      const isInsuredCase = suffixNum === 0;
                      const isAdditionalVictim = suffixNum >= 2;

                      let addressText: string;
                      if (isInsuredCase) {
                        // -0 케이스 (손해방지): 피보험자 주소 + 피보험자 상세주소
                        addressText =
                          [
                            caseItem.insuredAddress,
                            caseItem.insuredAddressDetail,
                          ]
                            .filter(Boolean)
                            .join(" ") || "-";
                      } else {
                        // -1, -2, -3 등 피해세대 케이스: 피해자 주소 + 피해자 상세주소 (없으면 피보험자 주소로 대체)
                        const victimAddr = [
                          caseItem.victimAddress,
                          caseItem.victimAddressDetail,
                        ]
                          .filter(Boolean)
                          .join(" ");

                        if (victimAddr) {
                          addressText = victimAddr;
                        } else {
                          // 피해자 주소가 없으면 피보험자 주소로 대체
                          addressText =
                            [
                              caseItem.insuredAddress,
                              caseItem.insuredAddressDetail,
                            ]
                              .filter(Boolean)
                              .join(" ") || "-";
                        }
                      }
                      const fontSize =
                        addressText.length > 40 ? "11px" : "13px";
                      return (
                        <div
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: fontSize,
                            color: "rgba(12, 12, 12, 0.8)",
                            lineHeight: "1.4",
                            wordBreak: "keep-all",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                          title={addressText}
                          data-testid={`text-address-${caseItem.id}`}
                        >
                          {addressText}
                        </div>
                      );
                    })()}
                    <div
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {caseItem.managerName || "-"}
                    </div>
                    <div
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {caseItem.assignedPartner || "-"}
                    </div>
                    <div
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        color: "rgba(12, 12, 12, 0.8)",
                        textAlign: "right",
                      }}
                    >
                      {formatAmount(caseItem.approvedAmount)}
                    </div>
                    <div
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        color: "rgba(12, 12, 12, 0.8)",
                        textAlign: "center",
                      }}
                    >
                      {calculateDays(caseItem.createdAt)}
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      {/* 관리자: 모든 상태에서 변경 가능, 협력사: 현장정보제출/복구요청(2차승인) 상태에서만 변경 가능 */}
                      {user?.role === "관리자" ||
                      (user?.role === "협력사" &&
                        PARTNER_CHANGEABLE_FROM_STATUSES.includes(
                          caseItem.status || "",
                        )) ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            asChild
                            disabled={updateStatusMutation.isPending}
                          >
                            <div
                              style={{
                                padding: "6px 12px",
                                background: "rgba(12, 12, 12, 0.05)",
                                borderRadius: "6px",
                                fontFamily: "Pretendard",
                                fontSize: "12px",
                                fontWeight: 600,
                                color: getStatusColor(caseItem.status),
                                textAlign: "center",
                                lineHeight: "1.4",
                                maxWidth: "140px",
                                wordBreak: "keep-all",
                                cursor: updateStatusMutation.isPending
                                  ? "not-allowed"
                                  : "pointer",
                                opacity: updateStatusMutation.isPending
                                  ? 0.6
                                  : 1,
                              }}
                              data-testid={`button-status-${caseItem.id}`}
                            >
                              {getStatusDisplayText(caseItem.status)}
                            </div>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="start"
                            style={{
                              width: "200px",
                              background: "rgba(200, 200, 200, 0.95)",
                              backdropFilter: "blur(10px)",
                              border: "none",
                              borderRadius: "8px",
                              padding: "8px",
                            }}
                          >
                            {(user?.role === "협력사"
                              ? PARTNER_ALLOWED_STATUSES
                              : ([
                                  "반려",
                                  "직접복구",
                                  "선견적요청",
                                  "청구",
                                  "종결",
                                  "접수취소",
                                ] as const)
                            ).map((status) => (
                              <DropdownMenuItem
                                key={status}
                                onClick={() =>
                                  handleStatusChange(caseItem.id, status)
                                }
                                style={{
                                  display: "flex",
                                  justifyContent: "center",
                                  alignItems: "center",
                                  padding: "10px 12px",
                                  margin: "0",
                                  cursor: "pointer",
                                  fontFamily: "Pretendard",
                                  fontSize: "14px",
                                  fontWeight: 500,
                                  color: getStatusColor(status),
                                  background: "transparent",
                                  borderRadius: "4px",
                                }}
                                data-testid={`button-status-option-${status}`}
                              >
                                {getStatusDisplayText(status)}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <div
                          style={{
                            padding: "6px 12px",
                            background: "rgba(12, 12, 12, 0.05)",
                            borderRadius: "6px",
                            fontFamily: "Pretendard",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: getStatusColor(caseItem.status),
                            textAlign: "center",
                            lineHeight: "1.4",
                            maxWidth: "140px",
                            wordBreak: "keep-all",
                          }}
                          data-testid={`text-status-${caseItem.id}`}
                        >
                          {getStatusDisplayText(caseItem.status)}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      {/* 협력사 특이사항 빨간색 점 (협력사 메모가 1개라도 있으면 항상 표시) */}
                      {(caseItem.specialNotes ||
                        safeParseNotesHistory(
                          caseItem.partnerNotesHistory as string,
                        ).length > 0) && (
                          <div
                            style={{
                              width: "8px",
                              height: "8px",
                              borderRadius: "50%",
                              background: "#ED1C00",
                            }}
                            title="협력사 특이사항 (미확인)"
                            data-testid={`partner-notes-indicator-${caseItem.id}`}
                          />
                        )}
                      {/* 관리자 특이사항 파란색 점 (관리자 메모가 있으면 항상 표시) */}
                      {safeParseNotesHistory(
                        caseItem.adminNotesHistory as string,
                      ).length > 0 && (
                          <div
                            style={{
                              width: "8px",
                              height: "8px",
                              borderRadius: "50%",
                              background: "#008FED",
                            }}
                            title="관리자 특이사항"
                            data-testid={`admin-notes-indicator-${caseItem.id}`}
                          />
                        )}
                    </div>
                    {user?.role === "협력사" && (
                      <div
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "13px",
                          color: "#008FED",
                          fontWeight: 500,
                          cursor: "pointer",
                          textDecoration: "underline",
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          localStorage.setItem(
                            "selectedFieldSurveyCaseId",
                            caseItem.id,
                          );
                          setLocation("/field-survey/management");
                        }}
                        data-testid={`button-field-survey-${caseItem.id}`}
                      >
                        {caseItem.status === "청구자료제출(복구)" ||
                        caseItem.status === "선견적요청" ||
                        caseItem.status === "출동비청구(선견적)" ||
                        caseItem.status === "청구" ||
                        caseItem.status === "입금대기" ||
                        caseItem.status === "입금완료" ||
                        caseItem.status === "정산완료" ||
                        caseItem.status === "종결"
                          ? "자료보기"
                          : caseItem.status === "직접복구" ||
                              caseItem.status?.includes("직접복구")
                            ? "청구자료 입력"
                            : "현장조사 입력"}
                      </div>
                    )}
                    <div>
                      {caseItem.status === "배당대기" ? (
                        // 배당대기 상태 - 임시 저장 건이므로 이어서 작성하기 버튼
                        (<button
                          onClick={(e) => {
                            e.stopPropagation();
                            localStorage.setItem("editCaseId", caseItem.id);
                            setLocation("/intake");
                          }}
                          style={{
                            padding: "6px 12px",
                            background: "#EFF6FF",
                            border: "1px solid #008FED",
                            borderRadius: "6px",
                            fontFamily: "Pretendard",
                            fontSize: "12px",
                            fontWeight: 500,
                            color: "#008FED",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                          data-testid={`button-continue-draft-${caseItem.id}`}
                        >이어서 작성하기
                                                  </button>)
                      ) : (
                        // 접수완료 이후 상태 - 상세보기 버튼 및 청구하기 버튼
                        (<div
                          style={{
                            display: "flex",
                            gap: "8px",
                            alignItems: "center",
                          }}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsReceptionEditMode(false); // 새 케이스 열 때 수정모드 리셋
                              setSelectedCaseId(caseItem.id);
                            }}
                            style={{
                              padding: "6px 12px",
                              background: "#FFFFFF",
                              border: "1px solid rgba(12, 12, 12, 0.2)",
                              borderRadius: "6px",
                              fontFamily: "Pretendard",
                              fontSize: "12px",
                              fontWeight: 500,
                              color: "rgba(12, 12, 12, 0.7)",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                            data-testid={`button-detail-${caseItem.id}`}
                          >
                            자세히 보기
                          </button>
                          {canShowClaimButton(caseItem, cases) &&
                            user?.role !== "협력사" &&
                            user?.role !== "심사사" &&
                            user?.role !== "조사사" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setInvoiceCaseId(caseItem.id);
                                  // 통합 인보이스 다이얼로그 표시 (혼합 복구타입 지원)
                                  setShowInvoiceDialog(true);
                                }}
                                style={{
                                  padding: "6px 12px",
                                  background: "#008FED",
                                  border: "none",
                                  borderRadius: "6px",
                                  fontFamily: "Pretendard",
                                  fontSize: "12px",
                                  fontWeight: 500,
                                  color: "#FFFFFF",
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                }}
                                data-testid={`button-claim-${caseItem.id}`}
                              >
                                청구하기
                              </button>
                            )}
                        </div>)
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      {/* 상세보기 Sheet */}
      <Sheet
        open={selectedCaseId !== null}
        onOpenChange={(open) => !open && setSelectedCaseId(null)}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-[600px] overflow-y-auto"
          style={{
            background: "rgba(253, 253, 253, 0.95)",
            backdropFilter: "blur(17px)",
            padding: "50px 20px 32px 20px",
          }}
          data-testid="sheet-case-detail"
        >
          <SheetHeader
            style={{
              padding: "24px 20px",
              borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
              marginBottom: "0",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <SheetTitle
                style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "22px",
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                }}
              >
                진행건 상세보기
              </SheetTitle>
              <div style={{ display: "flex", gap: "8px" }}>
                {/* 접수완료 이후 상태에서만 접수건 상세보기 버튼 표시 (심사사/조사사는 숨김) */}
                {user?.role !== "심사사" &&
                  user?.role !== "조사사" &&
                  (() => {
                    const currentCase = cases?.find(
                      (c) => c.id === selectedCaseId,
                    );
                    const status = currentCase?.status || "";
                    const isAfterReceptionComplete = status !== "배당대기";
                    return isAfterReceptionComplete ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setIsReceptionEditMode(false); // 수정모드 리셋
                          setShowReceptionDetailDialog(true);
                        }}
                        data-testid="button-reception-detail"
                      >
                        접수건 상세보기
                      </Button>
                    ) : null;
                  })()}
              </div>
            </div>
          </SheetHeader>

          {selectedCaseId &&
            (() => {
              const selectedCase = cases?.find((c) => c.id === selectedCaseId);
              if (!selectedCase) return null;

              return (
                <>
                  {/* 탭 메뉴 */}
                  <div
                    style={{
                      display: "flex",
                      gap: "0px",
                      borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                      padding: "0 20px",
                    }}
                  >
                    {(user?.role === "심사사" || user?.role === "조사사"
                      ? ["기본정보", "일자", "진행단계"]
                      : ["기본정보", "일자", "진행단계", "진행메모"]
                    ).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setDetailTab(tab)}
                        style={{
                          padding: "16px 24px",
                          background: "transparent",
                          border: "none",
                          borderBottom:
                            detailTab === tab
                              ? "2px solid #008FED"
                              : "2px solid transparent",
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: detailTab === tab ? 600 : 400,
                          color:
                            detailTab === tab
                              ? "#008FED"
                              : "rgba(12, 12, 12, 0.6)",
                          cursor: "pointer",
                          transition: "all 0.2s",
                        }}
                        data-testid={`tab-${tab}`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                  <ScrollArea className="h-[calc(100vh-220px)]">
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "16px",
                        padding: "16px 20px 20px 20px",
                      }}
                    >
                      {/* 기본정보 탭 */}
                      {detailTab === "기본정보" && (
                        <>
                          {/* 진행상태 섹션 */}
                          <div
                            style={{
                              background: "rgba(12, 12, 12, 0.02)",
                              borderRadius: "8px",
                              padding: "16px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "0px",
                            }}
                          >
                            {/* 진행상태 */}
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                padding: "10px 0px",
                                gap: "16px",
                              }}
                            >
                              <div
                                style={{
                                  width: "100px",
                                  fontFamily: "Pretendard",
                                  fontWeight: 500,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.6)",
                                }}
                              >
                                진행상태
                              </div>
                              <div
                                style={{
                                  padding: "6px 16px",
                                  background: "#008FED",
                                  borderRadius: "4px",
                                  fontFamily: "Pretendard",
                                  fontWeight: 500,
                                  fontSize: "14px",
                                  color: "#FFFFFF",
                                }}
                              >
                                {selectedCase.status || "접수완료"}
                              </div>
                            </div>

                            {/* 당사 담당자 */}
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                padding: "10px 0px",
                                gap: "16px",
                              }}
                            >
                              <div
                                style={{
                                  width: "100px",
                                  fontFamily: "Pretendard",
                                  fontWeight: 500,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.6)",
                                }}
                              >
                                담당자
                              </div>
                              <div
                                style={{
                                  fontFamily: "Pretendard",
                                  fontWeight: 400,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.9)",
                                }}
                              >
                                {selectedCase.managerName || "-"}
                              </div>
                            </div>

                            {/* 관리사 */}
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                padding: "10px 0px",
                                gap: "16px",
                              }}
                            >
                              <div
                                style={{
                                  width: "100px",
                                  fontFamily: "Pretendard",
                                  fontWeight: 500,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.6)",
                                }}
                              >
                                협력사
                              </div>
                              <div
                                style={{
                                  fontFamily: "Pretendard",
                                  fontWeight: 400,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.9)",
                                }}
                              >
                                {selectedCase.assignedPartner || "-"}
                              </div>
                            </div>

                            {/* 경과일수 */}
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                padding: "10px 0px",
                                gap: "16px",
                              }}
                            >
                              <div
                                style={{
                                  width: "100px",
                                  fontFamily: "Pretendard",
                                  fontWeight: 500,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.6)",
                                }}
                              >
                                경과일수
                              </div>
                              <div
                                style={{
                                  fontFamily: "Pretendard",
                                  fontWeight: 400,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.9)",
                                }}
                              >
                                {calculateDays(selectedCase.createdAt)}
                              </div>
                            </div>

                            {/* 견적금액 */}
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                padding: "10px 0px",
                                gap: "16px",
                              }}
                            >
                              <div
                                style={{
                                  width: "100px",
                                  fontFamily: "Pretendard",
                                  fontWeight: 500,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.6)",
                                }}
                              >
                                견적금액
                              </div>
                              <div
                                style={{
                                  fontFamily: "Pretendard",
                                  fontWeight: 400,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.9)",
                                }}
                              >
                                {formatAmount(
                                  selectedCase.initialEstimateAmount,
                                )}
                              </div>
                            </div>

                            {/* 승인금액 */}
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                padding: "10px 0px",
                                gap: "16px",
                              }}
                            >
                              <div
                                style={{
                                  width: "100px",
                                  fontFamily: "Pretendard",
                                  fontWeight: 500,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.6)",
                                }}
                              >
                                승인금액
                              </div>
                              <div
                                style={{
                                  fontFamily: "Pretendard",
                                  fontWeight: 400,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.9)",
                                }}
                              >
                                {formatAmount(selectedCase.approvedAmount)}
                              </div>
                            </div>
                          </div>

                          {/* 구분선 */}
                          <div
                            style={{
                              width: "100%",
                              height: "1px",
                              background: "rgba(12, 12, 12, 0.1)",
                              margin: "8px 0",
                            }}
                          ></div>

                          {/* 심사 정보 섹션 */}
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "0px",
                            }}
                          >
                            {/* 의뢰사 */}
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                padding: "10px 0px",
                                gap: "16px",
                              }}
                            >
                              <div
                                style={{
                                  width: "100px",
                                  fontFamily: "Pretendard",
                                  fontWeight: 500,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.6)",
                                }}
                              >
                                의뢰사
                              </div>
                              <div
                                style={{
                                  fontFamily: "Pretendard",
                                  fontWeight: 400,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.9)",
                                }}
                              >
                                {selectedCase.insuranceCompany || "-"}
                              </div>
                            </div>

                            {/* 심사사 */}
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                padding: "10px 0px",
                                gap: "16px",
                              }}
                            >
                              <div
                                style={{
                                  width: "100px",
                                  fontFamily: "Pretendard",
                                  fontWeight: 500,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.6)",
                                }}
                              >
                                심사사
                              </div>
                              <div
                                style={{
                                  fontFamily: "Pretendard",
                                  fontWeight: 400,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.9)",
                                }}
                              >
                                {selectedCase.assessorId || "-"}
                              </div>
                            </div>

                            {/* 심사 담당자 */}
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                padding: "10px 0px",
                                gap: "16px",
                              }}
                            >
                              <div
                                style={{
                                  width: "100px",
                                  fontFamily: "Pretendard",
                                  fontWeight: 500,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.6)",
                                }}
                              >
                                심사 담당자
                              </div>
                              <div
                                style={{
                                  fontFamily: "Pretendard",
                                  fontWeight: 400,
                                  fontSize: "14px",
                                  color: "rgba(12, 12, 12, 0.9)",
                                }}
                              >
                                {selectedCase.assessorDepartment &&
                                selectedCase.assessorTeam
                                  ? `${selectedCase.assessorDepartment} ${selectedCase.assessorTeam}`
                                  : selectedCase.assessorId || "-"}
                              </div>
                            </div>
                          </div>

                          {/* 심사사/조사사: 두 개의 PDF 팝업 버튼 표시 */}
                          {user?.role === "심사사" ||
                          user?.role === "조사사" ? (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px",
                                marginTop: "16px",
                              }}
                            >
                              <button
                                onClick={async () => {
                                  setShowFieldReportPdfDialog(true);
                                  setPdfLoading(true);
                                  setPdfError(null);
                                  setFieldReportPdfData(null);
                                  try {
                                    const response = await fetch(
                                      `/api/view-field-report-pdf/${selectedCase.id}`,
                                      { credentials: "include" },
                                    );
                                    if (!response.ok) {
                                      const errData = await response
                                        .json()
                                        .catch(() => null);
                                      throw new Error(
                                        errData?.error ||
                                          `PDF 생성 실패 (${response.status})`,
                                      );
                                    }
                                    const arrayBuffer =
                                      await response.arrayBuffer();
                                    setFieldReportPdfData(arrayBuffer);
                                  } catch (err) {
                                    setPdfError(
                                      err instanceof Error
                                        ? err.message
                                        : "PDF를 불러올 수 없습니다",
                                    );
                                  } finally {
                                    setPdfLoading(false);
                                  }
                                }}
                                style={{
                                  width: "100%",
                                  padding: "14px",
                                  background: "#008FED",
                                  borderRadius: "8px",
                                  border: "none",
                                  fontFamily: "Pretendard",
                                  fontWeight: 600,
                                  fontSize: "16px",
                                  color: "#FFFFFF",
                                  cursor: "pointer",
                                }}
                                data-testid="button-view-field-report-pdf"
                              >
                                현장출동보고서 PDF보기
                              </button>
                              <button
                                onClick={async () => {
                                  setShowInvoicePdfDialog(true);
                                  setPdfLoading(true);
                                  setPdfError(null);
                                  setInvoicePdfData(null);
                                  try {
                                    const response = await fetch(
                                      `/api/view-invoice-pdf/${selectedCase.id}`,
                                      { credentials: "include" },
                                    );
                                    if (!response.ok) {
                                      const errData = await response
                                        .json()
                                        .catch(() => null);
                                      throw new Error(
                                        errData?.error ||
                                          `PDF 생성 실패 (${response.status})`,
                                      );
                                    }
                                    const arrayBuffer =
                                      await response.arrayBuffer();
                                    setInvoicePdfData(arrayBuffer);
                                  } catch (err) {
                                    setPdfError(
                                      err instanceof Error
                                        ? err.message
                                        : "PDF를 불러올 수 없습니다",
                                    );
                                  } finally {
                                    setPdfLoading(false);
                                  }
                                }}
                                disabled={
                                  ![
                                    "청구",
                                    "입금완료",
                                    "부분입금",
                                    "부분지급",
                                    "지급완료",
                                    "정산완료",
                                    "종결",
                                  ].includes(selectedCase.status || "")
                                }
                                style={{
                                  width: "100%",
                                  padding: "14px",
                                  background: [
                                    "청구",
                                    "입금완료",
                                    "부분입금",
                                    "부분지급",
                                    "지급완료",
                                    "정산완료",
                                    "종결",
                                  ].includes(selectedCase.status || "")
                                    ? "#008FED"
                                    : "#ccc",
                                  borderRadius: "8px",
                                  border: "none",
                                  fontFamily: "Pretendard",
                                  fontWeight: 600,
                                  fontSize: "16px",
                                  color: "#FFFFFF",
                                  cursor: [
                                    "청구",
                                    "입금완료",
                                    "부분입금",
                                    "정산완료",
                                    "종결",
                                  ].includes(selectedCase.status || "")
                                    ? "pointer"
                                    : "not-allowed",
                                  opacity: [
                                    "청구",
                                    "입금완료",
                                    "부분입금",
                                    "정산완료",
                                    "종결",
                                  ].includes(selectedCase.status || "")
                                    ? 1
                                    : 0.6,
                                }}
                                data-testid="button-view-invoice-pdf"
                              >
                                Invoice(청구서) PDF보기
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                localStorage.setItem(
                                  "selectedFieldSurveyCaseId",
                                  selectedCase.id,
                                );
                                localStorage.setItem(
                                  "returnToComprehensiveProgress",
                                  "true",
                                );
                                setLocation("/field-survey/report");
                              }}
                              style={{
                                width: "100%",
                                padding: "14px",
                                background: "#008FED",
                                borderRadius: "8px",
                                border: "none",
                                fontFamily: "Pretendard",
                                fontWeight: 600,
                                fontSize: "16px",
                                color: "#FFFFFF",
                                cursor: "pointer",
                                marginTop: "16px",
                              }}
                              data-testid="button-view-report"
                            >
                              보고서 열람
                            </button>
                          )}
                        </>
                      )}

                      {/* 일자 탭 */}
                      {detailTab === "일자" && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "12px",
                          }}
                        >
                          {[
                            {
                              label: "접수일",
                              value: selectedCase?.receptionDate,
                            },
                            {
                              label: "배당일",
                              value: selectedCase?.assignmentDate,
                            },
                            {
                              label: "현장방문일",
                              value: selectedCase?.visitDate,
                            },
                            {
                              label: "현장자료 제출일",
                              value: selectedCase?.siteInvestigationSubmitDate,
                            },
                            {
                              label: "1차 승인일(내부)",
                              value: selectedCase?.firstApprovalDate,
                            },
                            {
                              label: "2차 승인일(복구 요청일)",
                              value: selectedCase?.secondApprovalDate,
                            },
                            {
                              label: "복구완료일",
                              value: selectedCase?.constructionCompletionDate,
                            },
                            { label: "청구일", value: selectedCase?.claimDate },
                            {
                              label: "일부입금일(최초)",
                              value: (() => {
                                if (!selectedCase) return undefined;
                                if (selectedCase.partialPaymentDate)
                                  return selectedCase.partialPaymentDate;
                                const settlement = allSettlements.find(
                                  (s) => s.caseId === selectedCase.id,
                                );
                                if (!settlement?.depositEntries)
                                  return undefined;
                                const entries =
                                  settlement.depositEntries as Array<{
                                    depositDate?: string;
                                  }>;
                                const dates = entries
                                  .map((e) => e.depositDate)
                                  .filter((d): d is string => !!d)
                                  .sort();
                                return dates[0] || undefined;
                              })(),
                            },
                            {
                              label: "일부지급일(최초)",
                              value: (() => {
                                if (!selectedCase) return undefined;
                                const settlement = allSettlements.find(
                                  (s) => s.caseId === selectedCase.id,
                                );
                                if (!settlement?.paymentEntries)
                                  return undefined;
                                const entries =
                                  settlement.paymentEntries as Array<{
                                    paymentDate?: string;
                                  }>;
                                const dates = entries
                                  .map((e) => e.paymentDate)
                                  .filter((d): d is string => !!d)
                                  .sort();
                                return dates[0] || undefined;
                              })(),
                            },
                            {
                              label: "입금완료일",
                              value: selectedCase?.paymentCompletedDate,
                            },
                            {
                              label: "지급완료일(정산)",
                              value: selectedCase?.settlementCompletedDate,
                            },
                          ].map((item) => (
                            <div
                              key={item.label}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                paddingBottom: "12px",
                                borderBottom:
                                  "1px solid rgba(12, 12, 12, 0.05)",
                              }}
                            >
                              <span
                                style={{
                                  width: "180px",
                                  fontFamily: "Pretendard",
                                  fontSize: "16px",
                                  fontWeight: 400,
                                  letterSpacing: "-0.02em",
                                  color: "rgba(12, 12, 12, 0.5)",
                                }}
                              >
                                {item.label}
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
                                {formatDate(item.value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 진행메모 탭 */}
                      {detailTab === "진행단계" && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "16px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <div
                              style={{
                                fontFamily: "Pretendard",
                                fontWeight: 600,
                                fontSize: "16px",
                                letterSpacing: "-0.02em",
                                color: "rgba(12, 12, 12, 0.9)",
                              }}
                            >
                              진행단계
                            </div>
                          </div>

                          <div
                            style={{
                              width: "100%",
                              minHeight: "200px",
                              padding: "16px",
                              background: "rgba(12, 12, 12, 0.04)",
                              border: "1px solid rgba(12, 12, 12, 0.1)",
                              borderRadius: "8px",
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              lineHeight: "1.6",
                              color: selectedCase.latestProgress?.content
                                ? "rgba(12, 12, 12, 0.9)"
                                : "rgba(12, 12, 12, 0.5)",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                            data-testid="text-progress-display"
                          >
                            {selectedCase.latestProgress?.content ||
                              "관리자가 입력한 진행단계가 없습니다."}
                          </div>
                        </div>
                      )}

                      {/* 진행메모 탭 */}
                      {detailTab === "진행메모" && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "24px",
                          }}
                        >
                          {/* 협력사 특이사항 섹션 */}
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "12px",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                            >
                              <div
                                style={{
                                  width: "10px",
                                  height: "10px",
                                  borderRadius: "50%",
                                  background: "#ED1C00",
                                }}
                              />
                              <div
                                style={{
                                  fontFamily: "Pretendard",
                                  fontWeight: 600,
                                  fontSize: "16px",
                                  letterSpacing: "-0.02em",
                                  color: "rgba(12, 12, 12, 0.9)",
                                }}
                              >
                                협력사 진행메모
                              </div>
                            </div>

                            {/* 협력사 특이사항 히스토리 */}
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px",
                                padding: "16px",
                                background: "rgba(237, 28, 0, 0.04)",
                                border: "1px solid rgba(237, 28, 0, 0.1)",
                                borderRadius: "8px",
                                minHeight: "80px",
                              }}
                            >
                              {(() => {
                                const partnerHistory = safeParseNotesHistory(
                                  selectedCase.partnerNotesHistory as string,
                                );
                                const legacyNote = selectedCase.specialNotes;

                                if (
                                  partnerHistory.length === 0 &&
                                  !legacyNote
                                ) {
                                  return (
                                    <div
                                      style={{
                                        fontFamily: "Pretendard",
                                        fontSize: "14px",
                                        color: "rgba(12, 12, 12, 0.5)",
                                      }}
                                    >
                                      협력사가 입력한 진행메모가 없습니다.
                                    </div>
                                  );
                                }

                                return (
                                  <>
                                    {legacyNote && (
                                      <div
                                        style={{
                                          fontFamily: "Pretendard",
                                          fontSize: "14px",
                                          lineHeight: "1.6",
                                          color: "rgba(12, 12, 12, 0.9)",
                                          whiteSpace: "pre-wrap",
                                          wordBreak: "break-word",
                                          paddingBottom:
                                            partnerHistory.length > 0
                                              ? "8px"
                                              : 0,
                                          borderBottom:
                                            partnerHistory.length > 0
                                              ? "1px solid rgba(12, 12, 12, 0.1)"
                                              : "none",
                                        }}
                                      >
                                        {legacyNote}
                                      </div>
                                    )}
                                    {partnerHistory.map(
                                      (
                                        note: {
                                          content: string;
                                          createdAt: string;
                                          createdByName?: string;
                                        },
                                        idx: number,
                                      ) => (
                                        <div
                                          key={idx}
                                          style={{
                                            fontFamily: "Pretendard",
                                            fontSize: "14px",
                                            lineHeight: "1.6",
                                            color: "rgba(12, 12, 12, 0.9)",
                                            whiteSpace: "pre-wrap",
                                            wordBreak: "break-word",
                                            paddingTop:
                                              idx > 0 || legacyNote ? "8px" : 0,
                                            borderTop:
                                              idx > 0
                                                ? "1px solid rgba(12, 12, 12, 0.1)"
                                                : "none",
                                          }}
                                        >
                                          <span
                                            style={{
                                              color: "rgba(12, 12, 12, 0.5)",
                                              fontSize: "12px",
                                            }}
                                          >
                                            [
                                            {new Date(
                                              note.createdAt,
                                            ).toLocaleDateString("ko-KR")}
                                            ]
                                          </span>{" "}
                                          {note.content}
                                        </div>
                                      ),
                                    )}
                                  </>
                                );
                              })()}
                            </div>

                            {/* 협력사만 입력 가능 */}
                            {user?.role === "협력사" && (
                              <div
                                style={{
                                  display: "flex",
                                  gap: "8px",
                                  alignItems: "flex-start",
                                }}
                              >
                                <textarea
                                  value={newNoteContent}
                                  onChange={(e) =>
                                    setNewNoteContent(e.target.value)
                                  }
                                  placeholder="추가 특이사항을 입력하세요"
                                  maxLength={1000}
                                  style={{
                                    flex: 1,
                                    minHeight: "60px",
                                    padding: "12px",
                                    background: "rgba(12, 12, 12, 0.02)",
                                    border: "1px solid rgba(12, 12, 12, 0.15)",
                                    borderRadius: "8px",
                                    fontFamily: "Pretendard",
                                    fontSize: "14px",
                                    lineHeight: "1.5",
                                    color: "rgba(12, 12, 12, 0.9)",
                                    resize: "vertical",
                                  }}
                                  data-testid="textarea-partner-notes"
                                />
                                <button
                                  onClick={() => {
                                    if (
                                      selectedCase.id &&
                                      newNoteContent.trim()
                                    ) {
                                      addNotesHistoryMutation.mutate({
                                        caseId: selectedCase.id,
                                        content: newNoteContent,
                                      });
                                    }
                                  }}
                                  disabled={
                                    addNotesHistoryMutation.isPending ||
                                    !newNoteContent.trim()
                                  }
                                  style={{
                                    padding: "12px 20px",
                                    background: "#ED1C00",
                                    border: "none",
                                    borderRadius: "8px",
                                    fontFamily: "Pretendard",
                                    fontWeight: 600,
                                    fontSize: "14px",
                                    color: "#FFFFFF",
                                    cursor:
                                      addNotesHistoryMutation.isPending ||
                                      !newNoteContent.trim()
                                        ? "not-allowed"
                                        : "pointer",
                                    opacity:
                                      addNotesHistoryMutation.isPending ||
                                      !newNoteContent.trim()
                                        ? 0.6
                                        : 1,
                                    whiteSpace: "nowrap",
                                  }}
                                  data-testid="button-save-partner-notes"
                                >
                                  {addNotesHistoryMutation.isPending
                                    ? "저장 중..."
                                    : "저장"}
                                </button>
                              </div>
                            )}

                            {/* 관리자가 협력사 특이사항 확인 버튼 */}
                            {user?.role === "관리자" &&
                              (safeParseNotesHistory(
                                selectedCase.partnerNotesHistory as string,
                              ).length > 0 ||
                                selectedCase.specialNotes) &&
                              selectedCase.partnerNotesAckedByAdmin !==
                                "true" && (
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "flex-end",
                                  }}
                                >
                                  <button
                                    onClick={() => {
                                      if (selectedCase.id) {
                                        ackNotesMutation.mutate(
                                          selectedCase.id,
                                        );
                                      }
                                    }}
                                    disabled={ackNotesMutation.isPending}
                                    style={{
                                      padding: "8px 16px",
                                      background: "transparent",
                                      border: "1px solid #ED1C00",
                                      borderRadius: "8px",
                                      fontFamily: "Pretendard",
                                      fontWeight: 600,
                                      fontSize: "13px",
                                      color: "#ED1C00",
                                      cursor: ackNotesMutation.isPending
                                        ? "not-allowed"
                                        : "pointer",
                                      opacity: ackNotesMutation.isPending
                                        ? 0.6
                                        : 1,
                                    }}
                                    data-testid="button-ack-partner-notes"
                                  >
                                    {ackNotesMutation.isPending
                                      ? "처리 중..."
                                      : "확인"}
                                  </button>
                                </div>
                              )}
                          </div>

                          {/* 관리자 특이사항 섹션 */}
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "12px",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                            >
                              <div
                                style={{
                                  width: "10px",
                                  height: "10px",
                                  borderRadius: "50%",
                                  background: "#008FED",
                                }}
                              />
                              <div
                                style={{
                                  fontFamily: "Pretendard",
                                  fontWeight: 600,
                                  fontSize: "16px",
                                  letterSpacing: "-0.02em",
                                  color: "rgba(12, 12, 12, 0.9)",
                                }}
                              >
                                관리자 진행메모
                              </div>
                            </div>

                            {/* 관리자 특이사항 히스토리 */}
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px",
                                padding: "16px",
                                background: "rgba(0, 143, 237, 0.04)",
                                border: "1px solid rgba(0, 143, 237, 0.1)",
                                borderRadius: "8px",
                                minHeight: "80px",
                              }}
                            >
                              {(() => {
                                const adminHistory = safeParseNotesHistory(
                                  selectedCase.adminNotesHistory as string,
                                );

                                if (adminHistory.length === 0) {
                                  return (
                                    <div
                                      style={{
                                        fontFamily: "Pretendard",
                                        fontSize: "14px",
                                        color: "rgba(12, 12, 12, 0.5)",
                                      }}
                                    >
                                      관리자가 입력한 진행메모가 없습니다.
                                    </div>
                                  );
                                }

                                return adminHistory.map(
                                  (
                                    note: {
                                      content: string;
                                      createdAt: string;
                                      createdByName?: string;
                                    },
                                    idx: number,
                                  ) => (
                                    <div
                                      key={idx}
                                      style={{
                                        fontFamily: "Pretendard",
                                        fontSize: "14px",
                                        lineHeight: "1.6",
                                        color: "rgba(12, 12, 12, 0.9)",
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-word",
                                        paddingTop: idx > 0 ? "8px" : 0,
                                        borderTop:
                                          idx > 0
                                            ? "1px solid rgba(12, 12, 12, 0.1)"
                                            : "none",
                                      }}
                                    >
                                      <span
                                        style={{
                                          color: "rgba(12, 12, 12, 0.5)",
                                          fontSize: "12px",
                                        }}
                                      >
                                        [
                                        {new Date(
                                          note.createdAt,
                                        ).toLocaleDateString("ko-KR")}
                                        ]
                                      </span>{" "}
                                      {note.content}
                                    </div>
                                  ),
                                );
                              })()}
                            </div>

                            {/* 관리자만 입력 가능 */}
                            {user?.role === "관리자" && (
                              <div
                                style={{
                                  display: "flex",
                                  gap: "8px",
                                  alignItems: "flex-start",
                                }}
                              >
                                <textarea
                                  value={newNoteContent}
                                  onChange={(e) =>
                                    setNewNoteContent(e.target.value)
                                  }
                                  placeholder="추가 특이사항을 입력하세요"
                                  maxLength={1000}
                                  style={{
                                    flex: 1,
                                    minHeight: "60px",
                                    padding: "12px",
                                    background: "rgba(12, 12, 12, 0.02)",
                                    border: "1px solid rgba(12, 12, 12, 0.15)",
                                    borderRadius: "8px",
                                    fontFamily: "Pretendard",
                                    fontSize: "14px",
                                    lineHeight: "1.5",
                                    color: "rgba(12, 12, 12, 0.9)",
                                    resize: "vertical",
                                  }}
                                  data-testid="textarea-admin-notes"
                                />
                                <button
                                  onClick={() => {
                                    if (
                                      selectedCase.id &&
                                      newNoteContent.trim()
                                    ) {
                                      addNotesHistoryMutation.mutate({
                                        caseId: selectedCase.id,
                                        content: newNoteContent,
                                      });
                                    }
                                  }}
                                  disabled={
                                    addNotesHistoryMutation.isPending ||
                                    !newNoteContent.trim()
                                  }
                                  style={{
                                    padding: "12px 20px",
                                    background: "#008FED",
                                    border: "none",
                                    borderRadius: "8px",
                                    fontFamily: "Pretendard",
                                    fontWeight: 600,
                                    fontSize: "14px",
                                    color: "#FFFFFF",
                                    cursor:
                                      addNotesHistoryMutation.isPending ||
                                      !newNoteContent.trim()
                                        ? "not-allowed"
                                        : "pointer",
                                    opacity:
                                      addNotesHistoryMutation.isPending ||
                                      !newNoteContent.trim()
                                        ? 0.6
                                        : 1,
                                    whiteSpace: "nowrap",
                                  }}
                                  data-testid="button-save-admin-notes"
                                >
                                  {addNotesHistoryMutation.isPending
                                    ? "저장중..."
                                    : "저장"}
                                </button>
                              </div>
                            )}

                            {/* 협력사가 관리자 특이사항 확인 버튼 */}
                            {user?.role === "협력사" &&
                              safeParseNotesHistory(
                                selectedCase.adminNotesHistory as string,
                              ).length > 0 &&
                              selectedCase.adminNotesAckedByPartner !==
                                "true" && (
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "flex-end",
                                  }}
                                >
                                  <button
                                    onClick={() => {
                                      if (selectedCase.id) {
                                        ackNotesMutation.mutate(
                                          selectedCase.id,
                                        );
                                      }
                                    }}
                                    disabled={ackNotesMutation.isPending}
                                    style={{
                                      padding: "8px 16px",
                                      background: "transparent",
                                      border: "1px solid #008FED",
                                      borderRadius: "8px",
                                      fontFamily: "Pretendard",
                                      fontWeight: 600,
                                      fontSize: "13px",
                                      color: "#008FED",
                                      cursor: ackNotesMutation.isPending
                                        ? "not-allowed"
                                        : "pointer",
                                      opacity: ackNotesMutation.isPending
                                        ? 0.6
                                        : 1,
                                    }}
                                    data-testid="button-ack-admin-notes"
                                  >
                                    {ackNotesMutation.isPending
                                      ? "처리 중..."
                                      : "확인"}
                                  </button>
                                </div>
                              )}
                          </div>

                          {/* 진행관리 LMS 발송 섹션 */}
                          {user?.role === "관리자" && (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "12px",
                                borderTop: "1px solid rgba(12, 12, 12, 0.1)",
                                paddingTop: "24px",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={true}
                                  readOnly
                                  style={{
                                    accentColor: "#008FED",
                                    width: "14px",
                                    height: "14px",
                                  }}
                                />
                                <div
                                  style={{
                                    fontFamily: "Pretendard",
                                    fontWeight: 600,
                                    fontSize: "16px",
                                    letterSpacing: "-0.02em",
                                    color: "rgba(12, 12, 12, 0.9)",
                                  }}
                                >진행관리이력</div>
                              </div>

                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "10px",
                                  padding: "16px",
                                  background: "rgba(0, 143, 237, 0.04)",
                                  border: "1px solid rgba(0, 143, 237, 0.1)",
                                  borderRadius: "8px",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    gap: "8px",
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontFamily: "Pretendard",
                                      fontSize: "13px",
                                      fontWeight: 500,
                                      color: "rgba(12, 12, 12, 0.6)",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    문자유형
                                  </div>
                                  <select
                                    value={lmsMessageType}
                                    onChange={(e) =>
                                      setLmsMessageType(e.target.value)
                                    }
                                    style={{
                                      flex: 1,
                                      minWidth: "140px",
                                      padding: "8px 12px",
                                      background: "#FFFFFF",
                                      border:
                                        "1px solid rgba(12, 12, 12, 0.15)",
                                      borderRadius: "6px",
                                      fontFamily: "Pretendard",
                                      fontSize: "13px",
                                      color: lmsMessageType
                                        ? "rgba(12, 12, 12, 0.9)"
                                        : "rgba(12, 12, 12, 0.4)",
                                    }}
                                    data-testid="select-lms-message-type"
                                  >
                                    <option value="">내용을 선택하세요</option>
                                    <option value="청구금액 지급요청">
                                      청구금액 지급요청
                                    </option>
                                    <option value="중복보험 미지급금 요청">
                                      중복보험 미지급금 요청
                                    </option>
                                  </select>

                                  <select
                                    value={lmsRecipientType}
                                    onChange={(e) =>
                                      setLmsRecipientType(e.target.value)
                                    }
                                    style={{
                                      minWidth: "140px",
                                      padding: "8px 12px",
                                      background: "#FFFFFF",
                                      border:
                                        "1px solid rgba(12, 12, 12, 0.15)",
                                      borderRadius: "6px",
                                      fontFamily: "Pretendard",
                                      fontSize: "13px",
                                      color: lmsRecipientType
                                        ? "rgba(12, 12, 12, 0.9)"
                                        : "rgba(12, 12, 12, 0.4)",
                                    }}
                                    data-testid="select-lms-recipient-type"
                                  >
                                    <option value="">수신자 선택</option>
                                    {selectedCase?.assessorTeam && (() => {
                                      const phone = (selectedCase.assessorContact || "").replace(/[^0-9]/g, "");
                                      const isValidMobile = /^01[016789]\d{7,8}$/.test(phone);
                                      return (
                                        <option value="심사자" disabled={!isValidMobile}>
                                          심사자:{" "}
                                          {selectedCase.assessorId
                                            ? `(${selectedCase.assessorId}) `
                                            : ""}
                                          {selectedCase.assessorTeam}
                                          {!isValidMobile ? " [연락처 없음]" : ""}
                                        </option>
                                      );
                                    })()}
                                    {selectedCase?.investigatorTeamName && (() => {
                                      const phone = (selectedCase.investigatorContact || "").replace(/[^0-9]/g, "");
                                      const isValidMobile = /^01[016789]\d{7,8}$/.test(phone);
                                      return (
                                        <option value="조사자" disabled={!isValidMobile}>
                                          조사자:{" "}
                                          {selectedCase.investigatorTeam
                                            ? `(${selectedCase.investigatorTeam}) `
                                            : ""}
                                          {selectedCase.investigatorTeamName}
                                          {!isValidMobile ? " [연락처 없음]" : ""}
                                        </option>
                                      );
                                    })()}
                                    {!selectedCase?.assessorTeam &&
                                      !selectedCase?.investigatorTeamName && (
                                        <option value="" disabled>
                                          배정된 심사자/조사자가 없습니다
                                        </option>
                                      )}
                                  </select>
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "center",
                                    gap: "8px",
                                  }}
                                >
                                  <button
                                    onClick={() => {
                                      if (lmsMessageType && lmsRecipientType) {
                                        setShowLmsConfirmDialog(true);
                                      }
                                    }}
                                    disabled={
                                      !lmsMessageType ||
                                      !lmsRecipientType ||
                                      sendLmsMutation.isPending
                                    }
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "6px",
                                      padding: "8px 20px",
                                      background:
                                        lmsMessageType && lmsRecipientType
                                          ? "#008FED"
                                          : "rgba(12, 12, 12, 0.15)",
                                      border: "none",
                                      borderRadius: "6px",
                                      fontFamily: "Pretendard",
                                      fontWeight: 600,
                                      fontSize: "13px",
                                      color:
                                        lmsMessageType && lmsRecipientType
                                          ? "#FFFFFF"
                                          : "rgba(12, 12, 12, 0.4)",
                                      cursor:
                                        lmsMessageType && lmsRecipientType
                                          ? "pointer"
                                          : "not-allowed",
                                    }}
                                    data-testid="button-send-lms"
                                  >
                                    {sendLmsMutation.isPending
                                      ? "발송 중..."
                                      : "발송하기"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setShowManualHistoryForm(!showManualHistoryForm);
                                      if (!manualHistoryDate) {
                                        const now = new Date();
                                        const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
                                        setManualHistoryDate(kst.toISOString().slice(0, 10));
                                      }
                                    }}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "6px",
                                      padding: "8px 20px",
                                      background: showManualHistoryForm
                                        ? "rgba(12, 12, 12, 0.08)"
                                        : "#FFFFFF",
                                      border: "1px solid rgba(12, 12, 12, 0.15)",
                                      borderRadius: "6px",
                                      fontFamily: "Pretendard",
                                      fontWeight: 600,
                                      fontSize: "13px",
                                      color: "rgba(12, 12, 12, 0.7)",
                                      cursor: "pointer",
                                    }}
                                    data-testid="button-toggle-manual-history"
                                  >
                                    수기입력
                                  </button>
                                </div>

                                {showManualHistoryForm && (
                                  <div
                                    style={{
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: "8px",
                                      padding: "12px",
                                      background: "#FFFFFF",
                                      border: "1px solid rgba(12, 12, 12, 0.12)",
                                      borderRadius: "6px",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        gap: "8px",
                                        alignItems: "center",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <div
                                        style={{
                                          fontFamily: "Pretendard",
                                          fontSize: "12px",
                                          fontWeight: 500,
                                          color: "rgba(12, 12, 12, 0.5)",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        일자
                                      </div>
                                      <input
                                        type="date"
                                        value={manualHistoryDate}
                                        onChange={(e) => setManualHistoryDate(e.target.value)}
                                        style={{
                                          padding: "6px 10px",
                                          background: "#FFFFFF",
                                          border: "1px solid rgba(12, 12, 12, 0.15)",
                                          borderRadius: "6px",
                                          fontFamily: "Pretendard",
                                          fontSize: "13px",
                                          color: "rgba(12, 12, 12, 0.9)",
                                          minWidth: "130px",
                                        }}
                                        data-testid="input-manual-history-date"
                                      />
                                    </div>
                                    <div
                                      style={{
                                        display: "flex",
                                        gap: "8px",
                                        alignItems: "center",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <div
                                        style={{
                                          fontFamily: "Pretendard",
                                          fontSize: "12px",
                                          fontWeight: 500,
                                          color: "rgba(12, 12, 12, 0.5)",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        매체
                                      </div>
                                      <select
                                        value={manualHistoryMedium}
                                        onChange={(e) => setManualHistoryMedium(e.target.value)}
                                        style={{
                                          padding: "6px 10px",
                                          background: "#FFFFFF",
                                          border: "1px solid rgba(12, 12, 12, 0.15)",
                                          borderRadius: "6px",
                                          fontFamily: "Pretendard",
                                          fontSize: "13px",
                                          color: manualHistoryMedium
                                            ? "rgba(12, 12, 12, 0.9)"
                                            : "rgba(12, 12, 12, 0.4)",
                                          minWidth: "130px",
                                        }}
                                        data-testid="select-manual-history-medium"
                                      >
                                        <option value="">매체 선택</option>
                                        <option value="문자">문자</option>
                                        <option value="카톡">카톡</option>
                                        <option value="전화">전화</option>
                                        <option value="이메일">이메일</option>
                                      </select>
                                    </div>
                                    <div
                                      style={{
                                        display: "flex",
                                        gap: "8px",
                                        alignItems: "center",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <div
                                        style={{
                                          fontFamily: "Pretendard",
                                          fontSize: "12px",
                                          fontWeight: 500,
                                          color: "rgba(12, 12, 12, 0.5)",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        내용
                                      </div>
                                      <input
                                        type="text"
                                        value={manualHistoryContent}
                                        onChange={(e) => setManualHistoryContent(e.target.value)}
                                        placeholder="이력 내용을 입력하세요"
                                        style={{
                                          flex: 1,
                                          minWidth: "140px",
                                          padding: "6px 10px",
                                          background: "#FFFFFF",
                                          border: "1px solid rgba(12, 12, 12, 0.15)",
                                          borderRadius: "6px",
                                          fontFamily: "Pretendard",
                                          fontSize: "13px",
                                          color: "rgba(12, 12, 12, 0.9)",
                                        }}
                                        data-testid="input-manual-history-content"
                                      />
                                    </div>
                                    <div
                                      style={{
                                        display: "flex",
                                        gap: "8px",
                                        alignItems: "center",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <div
                                        style={{
                                          fontFamily: "Pretendard",
                                          fontSize: "12px",
                                          fontWeight: 500,
                                          color: "rgba(12, 12, 12, 0.5)",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        수신자
                                      </div>
                                      <input
                                        type="text"
                                        value={manualHistoryRecipient}
                                        onChange={(e) => setManualHistoryRecipient(e.target.value)}
                                        placeholder="수신자 (선택)"
                                        style={{
                                          flex: 1,
                                          minWidth: "140px",
                                          padding: "6px 10px",
                                          background: "#FFFFFF",
                                          border: "1px solid rgba(12, 12, 12, 0.15)",
                                          borderRadius: "6px",
                                          fontFamily: "Pretendard",
                                          fontSize: "13px",
                                          color: "rgba(12, 12, 12, 0.9)",
                                        }}
                                        data-testid="input-manual-history-recipient"
                                      />
                                    </div>
                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "flex-end",
                                        gap: "6px",
                                      }}
                                    >
                                      <button
                                        onClick={() => {
                                          setShowManualHistoryForm(false);
                                          setManualHistoryDate("");
                                          setManualHistoryMedium("");
                                          setManualHistoryContent("");
                                          setManualHistoryRecipient("");
                                        }}
                                        style={{
                                          padding: "6px 14px",
                                          background: "#FFFFFF",
                                          border: "1px solid rgba(12, 12, 12, 0.15)",
                                          borderRadius: "6px",
                                          fontFamily: "Pretendard",
                                          fontWeight: 500,
                                          fontSize: "12px",
                                          color: "rgba(12, 12, 12, 0.6)",
                                          cursor: "pointer",
                                        }}
                                        data-testid="button-cancel-manual-history"
                                      >
                                        취소
                                      </button>
                                      <button
                                        onClick={() => {
                                          if (selectedCase && manualHistoryDate && manualHistoryContent) {
                                            addManualHistoryMutation.mutate({
                                              caseId: String(selectedCase.id),
                                              date: manualHistoryDate,
                                              medium: manualHistoryMedium,
                                              content: manualHistoryContent,
                                              recipient: manualHistoryRecipient,
                                            });
                                          }
                                        }}
                                        disabled={
                                          !manualHistoryDate ||
                                          !manualHistoryContent ||
                                          addManualHistoryMutation.isPending
                                        }
                                        style={{
                                          padding: "6px 14px",
                                          background:
                                            manualHistoryDate && manualHistoryContent
                                              ? "#008FED"
                                              : "rgba(12, 12, 12, 0.15)",
                                          border: "none",
                                          borderRadius: "6px",
                                          fontFamily: "Pretendard",
                                          fontWeight: 600,
                                          fontSize: "12px",
                                          color:
                                            manualHistoryDate && manualHistoryContent
                                              ? "#FFFFFF"
                                              : "rgba(12, 12, 12, 0.4)",
                                          cursor:
                                            manualHistoryDate && manualHistoryContent
                                              ? "pointer"
                                              : "not-allowed",
                                        }}
                                        data-testid="button-save-manual-history"
                                      >
                                        {addManualHistoryMutation.isPending
                                          ? "저장 중..."
                                          : "저장"}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* LMS 발송 이력 테이블 */}
                              {(() => {
                                let lmsHistory: any[] = [];
                                try {
                                  if (selectedCase.lmsSendHistory) {
                                    lmsHistory = JSON.parse(
                                      selectedCase.lmsSendHistory as string,
                                    );
                                    lmsHistory.sort((a: any, b: any) =>
                                      (b.sentAt || "").localeCompare(
                                        a.sentAt || "",
                                      ),
                                    );
                                  }
                                } catch {}

                                return (
                                  <div
                                    style={{
                                      borderRadius: "8px",
                                      border: "1px solid rgba(12, 12, 12, 0.1)",
                                      overflow: "hidden",
                                      maxHeight: "200px",
                                      overflowY: "auto",
                                    }}
                                  >
                                    <table
                                      style={{
                                        width: "100%",
                                        borderCollapse: "collapse",
                                        fontFamily: "Pretendard",
                                        fontSize: "13px",
                                      }}
                                    >
                                      <thead>
                                        <tr
                                          style={{
                                            background:
                                              "rgba(12, 12, 12, 0.04)",
                                            position: "sticky",
                                            top: 0,
                                          }}
                                        >
                                          <th
                                            style={{
                                              padding: "10px 12px",
                                              textAlign: "left",
                                              fontWeight: 600,
                                              color: "rgba(12, 12, 12, 0.7)",
                                              borderBottom:
                                                "1px solid rgba(12, 12, 12, 0.1)",
                                              whiteSpace: "nowrap",
                                            }}
                                          >
                                            일자
                                          </th>
                                          <th
                                            style={{
                                              padding: "10px 12px",
                                              textAlign: "left",
                                              fontWeight: 600,
                                              color: "rgba(12, 12, 12, 0.7)",
                                              borderBottom:
                                                "1px solid rgba(12, 12, 12, 0.1)",
                                              whiteSpace: "nowrap",
                                            }}
                                          >
                                            매체
                                          </th>
                                          <th
                                            style={{
                                              padding: "10px 12px",
                                              textAlign: "left",
                                              fontWeight: 600,
                                              color: "rgba(12, 12, 12, 0.7)",
                                              borderBottom:
                                                "1px solid rgba(12, 12, 12, 0.1)",
                                              whiteSpace: "nowrap",
                                            }}
                                          >
                                            발송유형
                                          </th>
                                          <th
                                            style={{
                                              padding: "10px 12px",
                                              textAlign: "left",
                                              fontWeight: 600,
                                              color: "rgba(12, 12, 12, 0.7)",
                                              borderBottom:
                                                "1px solid rgba(12, 12, 12, 0.1)",
                                              whiteSpace: "nowrap",
                                            }}
                                          >
                                            수신자
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {lmsHistory.length === 0 ? (
                                          <tr>
                                            <td
                                              colSpan={4}
                                              style={{
                                                padding: "20px 12px",
                                                textAlign: "center",
                                                color: "rgba(12, 12, 12, 0.4)",
                                              }}
                                            >
                                              발송 이력이 없습니다
                                            </td>
                                          </tr>
                                        ) : (
                                          lmsHistory.map(
                                            (entry: any, idx: number) => (
                                              <tr
                                                key={entry.id || idx}
                                                style={{
                                                  borderBottom:
                                                    idx < lmsHistory.length - 1
                                                      ? "1px solid rgba(12, 12, 12, 0.06)"
                                                      : "none",
                                                }}
                                              >
                                                <td
                                                  style={{
                                                    padding: "10px 12px",
                                                    color:
                                                      "rgba(12, 12, 12, 0.8)",
                                                    whiteSpace: "nowrap",
                                                  }}
                                                >
                                                  {entry.sentAt || ""}
                                                </td>
                                                <td
                                                  style={{
                                                    padding: "10px 12px",
                                                    color:
                                                      "rgba(12, 12, 12, 0.8)",
                                                    whiteSpace: "nowrap",
                                                  }}
                                                >
                                                  {entry.isManual
                                                    ? (entry.medium || "")
                                                    : "문자"}
                                                </td>
                                                <td
                                                  style={{
                                                    padding: "10px 12px",
                                                    color:
                                                      "rgba(12, 12, 12, 0.8)",
                                                  }}
                                                >
                                                  {entry.isManual && (
                                                    <span
                                                      style={{
                                                        display: "inline-block",
                                                        padding: "1px 5px",
                                                        background: "rgba(12, 12, 12, 0.06)",
                                                        borderRadius: "3px",
                                                        fontSize: "11px",
                                                        color: "rgba(12, 12, 12, 0.5)",
                                                        marginRight: "4px",
                                                      }}
                                                    >
                                                      수기
                                                    </span>
                                                  )}
                                                  {entry.messageType || ""}
                                                </td>
                                                <td
                                                  style={{
                                                    padding: "10px 12px",
                                                    color:
                                                      "rgba(12, 12, 12, 0.8)",
                                                  }}
                                                >
                                                  {entry.isManual
                                                    ? (entry.recipientName || "")
                                                    : (<>{entry.recipientCompany}{" "}{entry.recipientName}</>)}
                                                </td>
                                              </tr>
                                            ),
                                          )
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </>
              );
            })()}
        </SheetContent>
      </Sheet>
      {/* LMS 발송 확인 다이얼로그 */}
      <AlertDialog
        open={showLmsConfirmDialog}
        onOpenChange={setShowLmsConfirmDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>LMS 발송 확인</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                if (!selectedCaseId) return "";
                const caseItem = cases?.find(
                  (c: CaseWithLatestProgress) => c.id === selectedCaseId,
                );
                if (!caseItem) return "";
                let recipientCompany = "";
                let recipientName = "";
                if (lmsRecipientType === "심사자") {
                  recipientCompany = caseItem.assessorId || "";
                  recipientName = caseItem.assessorTeam || "";
                } else if (lmsRecipientType === "조사자") {
                  recipientCompany = caseItem.investigatorTeam || "";
                  recipientName = caseItem.investigatorTeamName || "";
                }
                return `'${lmsMessageType}'을(를) (${recipientCompany}) ${recipientName}에게 발송하시겠습니까?`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-lms-send">
              발송취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedCaseId && lmsMessageType && lmsRecipientType) {
                  sendLmsMutation.mutate({
                    caseId: selectedCaseId,
                    messageType: lmsMessageType,
                    recipientType: lmsRecipientType,
                  });
                }
              }}
              disabled={sendLmsMutation.isPending}
              style={{ background: "#008FED" }}
              data-testid="button-confirm-lms-send"
            >
              {sendLmsMutation.isPending ? "발송 중..." : "발송확인"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* 삭제 확인 Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>접수건 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              이 접수건을 삭제하시겠습니까? 삭제된 데이터는 복구할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedCaseId) {
                  deleteCaseMutation.mutate(selectedCaseId);
                }
              }}
              disabled={deleteCaseMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteCaseMutation.isPending ? "삭제 중..." : "확인"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* 대량 삭제 확인 Dialog */}
      <AlertDialog
        open={showBulkDeleteDialog}
        onOpenChange={setShowBulkDeleteDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>선택된 접수건 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              선택한 {selectedCaseIds.length}건의 접수건을 삭제하시겠습니까?
              삭제된 데이터는 복구할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-delete">
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                bulkDeleteMutation.mutate(selectedCaseIds);
              }}
              disabled={bulkDeleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-bulk-delete"
            >
              {bulkDeleteMutation.isPending ? "삭제 중..." : "확인"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* 진행상황 추가 Dialog (관리자 전용) */}
      <Dialog open={showProgressDialog} onOpenChange={setShowProgressDialog}>
        <DialogContent
          style={{
            maxWidth: "600px",
            background: "rgba(253, 253, 253, 0.9)",
            backdropFilter: "blur(17px)",
            border: "none",
            boxShadow:
              "0px 0px 60px rgba(170, 177, 194, 0.3), 6px 0px 40px rgba(219, 233, 245, 0.3)",
            borderRadius: "24px",
          }}
        >
          <DialogHeader>
            <DialogTitle
              style={{
                fontFamily: "Pretendard",
                fontWeight: 600,
                fontSize: "20px",
                color: "#0C0C0C",
              }}
            >
              진행상황 추가
            </DialogTitle>
          </DialogHeader>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "24px",
              marginTop: "20px",
            }}
          >
            {/* 케이스 정보 */}
            <div
              style={{
                padding: "16px",
                background: "rgba(12, 12, 12, 0.03)",
                borderRadius: "12px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: "8px 16px",
                }}
              >
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontWeight: 500,
                    color: "rgba(12, 12, 12, 0.6)",
                  }}
                >
                  접수번호
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontWeight: 400,
                    color: "rgba(12, 12, 12, 0.8)",
                  }}
                >
                  {formatCaseNumber(selectedCase?.caseNumber) || "-"}
                </span>

                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontWeight: 500,
                    color: "rgba(12, 12, 12, 0.6)",
                  }}
                >
                  보험사
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontWeight: 400,
                    color: "rgba(12, 12, 12, 0.8)",
                  }}
                >
                  {selectedCase?.insuranceCompany || "-"}
                </span>
              </div>
            </div>

            {/* 진행상황 Form */}
            <Form {...progressForm}>
              <form
                onSubmit={progressForm.handleSubmit(handleProgressSubmit)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "24px",
                }}
              >
                <FormField
                  control={progressForm.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <div
                        style={{
                          fontFamily: "Pretendard",
                          fontWeight: 500,
                          fontSize: "14px",
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                          marginBottom: "8px",
                        }}
                      >
                        진행상황 내용
                      </div>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="진행상황을 입력하세요"
                          style={{
                            minHeight: "155px",
                            borderRadius: "12px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                          }}
                          data-testid="input-progress-content"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {/* 버튼 */}
                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    justifyContent: "flex-end",
                  }}
                >
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowProgressDialog(false)}
                    data-testid="button-cancel-progress"
                  >
                    취소
                  </Button>
                  <Button
                    type="submit"
                    disabled={addProgressMutation.isPending}
                    data-testid="button-save-progress"
                  >
                    {addProgressMutation.isPending ? "추가 중..." : "추가"}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </DialogContent>
      </Dialog>
      {/* 접수건 상세보기 Dialog - IntakePage 재사용 */}
      <Dialog
        open={showReceptionDetailDialog}
        onOpenChange={(open) => {
          setShowReceptionDetailDialog(open);
          if (!open) {
            setIsReceptionEditMode(false); // 닫을 때 수정 모드 리셋
          }
        }}
        modal={true}
      >
        <DialogContent
          style={{
            maxWidth: "95vw",
            width: "1700px",
            maxHeight: "90vh",
            overflow: "hidden",
            padding: 0,
            background: "#F5F7FA",
            border: "none",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            zIndex: 100,
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          data-testid="dialog-reception-detail"
        >
          {/* 수정 버튼 - 다이얼로그 상단 우측 (협력사 계정에서는 숨김) */}
          {user?.role !== "협력사" && (
            <div
              style={{
                position: "absolute",
                top: "16px",
                right: "56px",
                zIndex: 10,
                display: "flex",
                gap: "8px",
              }}
            >
              {!isReceptionEditMode ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsReceptionEditMode(true)}
                  style={{
                    fontFamily: "Pretendard",
                    fontWeight: 500,
                  }}
                  data-testid="button-enable-edit-mode"
                >
                  수정
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsReceptionEditMode(false)}
                  style={{
                    fontFamily: "Pretendard",
                    fontWeight: 500,
                    color: "rgba(12, 12, 12, 0.5)",
                  }}
                  data-testid="button-cancel-edit-mode"
                >
                  수정 취소
                </Button>
              )}
            </div>
          )}
          {selectedCaseId && (
            <div
              style={{
                flex: 1,
                overflow: "auto",
                maxHeight: "calc(90vh - 60px)",
              }}
            >
              <IntakePage
                isModal={true}
                initialCaseId={selectedCaseId}
                readOnly={!isReceptionEditMode}
                onClose={() => {
                  setShowReceptionDetailDialog(false);
                  setIsReceptionEditMode(false);
                }}
                onSuccess={() => {
                  setShowReceptionDetailDialog(false);
                  setIsReceptionEditMode(false);
                  queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* INVOICE 다이얼로그 - 직접복구 케이스용 (손해방지비용 + 대물복구비용) */}
      <InvoiceSheet
        open={showInvoiceDialog}
        onOpenChange={setShowInvoiceDialog}
        caseData={cases?.find((c) => c.id === invoiceCaseId) || null}
        relatedCases={(() => {
          const invoiceCase = cases?.find((c) => c.id === invoiceCaseId);
          const invoiceCasePrefix = getCaseNumberPrefix(
            invoiceCase?.caseNumber,
          );
          return invoiceCasePrefix
            ? cases?.filter(
                (c) =>
                  getCaseNumberPrefix(c.caseNumber) === invoiceCasePrefix &&
                  c.status !== "접수취소",
              ) || []
            : invoiceCase && invoiceCase.status !== "접수취소"
              ? [invoiceCase]
              : [];
        })()}
      />
      {/* 현장출동비용 청구 다이얼로그 - 선견적요청 케이스용 (현장출동비용만) */}
      <FieldDispatchCostSheet
        open={showFieldDispatchInvoiceDialog}
        onOpenChange={setShowFieldDispatchInvoiceDialog}
        caseData={cases?.find((c) => c.id === invoiceCaseId) || null}
        relatedCases={(() => {
          const invoiceCase = cases?.find((c) => c.id === invoiceCaseId);
          const invoiceCasePrefix = getCaseNumberPrefix(
            invoiceCase?.caseNumber,
          );
          return invoiceCasePrefix
            ? cases?.filter(
                (c) =>
                  getCaseNumberPrefix(c.caseNumber) === invoiceCasePrefix &&
                  c.status !== "접수취소",
              ) || []
            : invoiceCase && invoiceCase.status !== "접수취소"
              ? [invoiceCase]
              : [];
        })()}
      />
      {/* SMS 알림 발송 다이얼로그 - 추가 정보 입력이 필요한 상태에서만 사용 (접수취소) */}
      {smsCaseData && (
        <SmsNotificationDialog
          open={smsDialogOpen}
          onOpenChange={setSmsDialogOpen}
          caseData={smsCaseData as unknown as SchemaCase}
          stage={smsStage}
          onSuccess={() => {
            setSmsDialogOpen(false);
            setSmsCaseData(null);
          }}
        />
      )}
      {/* 상태 변경 확인 다이얼로그 */}
      <AlertDialog
        open={statusChangeDialogOpen}
        onOpenChange={setStatusChangeDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>상태 변경 확인</AlertDialogTitle>
            <AlertDialogDescription>
              상태를{" "}
              <span
                style={{
                  fontWeight: 700,
                  color: getStatusColor(statusChangeTarget?.status || ""),
                }}
              >
                "{statusChangeTarget?.status}"
              </span>
              (으)로 변경하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setStatusChangeDialogOpen(false);
                setStatusChangeTarget(null);
              }}
              data-testid="button-cancel-status-change"
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (statusChangeTarget) {
                  setStatusChangeDialogOpen(false);
                  updateStatusMutation.mutate({
                    caseId: statusChangeTarget.caseId,
                    status: statusChangeTarget.status,
                  });
                  setStatusChangeTarget(null);
                }
              }}
              data-testid="button-confirm-status-change"
            >
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* 접수취소 확인 다이얼로그 */}
      <AlertDialog
        open={cancelConfirmDialogOpen}
        onOpenChange={setCancelConfirmDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>접수 취소 확인</AlertDialogTitle>
            <AlertDialogDescription>
              [
              {cancelTargetCase?.accidentNumber || cancelTargetCase?.caseNumber}
              ] 건을 접수 취소 하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setCancelConfirmDialogOpen(false);
                setCancelTargetCase(null);
              }}
              data-testid="button-cancel-cancellation"
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (cancelTargetCase) {
                  setCancelConfirmDialogOpen(false);
                  updateStatusMutation.mutate({
                    caseId: cancelTargetCase.id,
                    status: "접수취소",
                  });
                  setCancelTargetCase(null);
                }
              }}
              data-testid="button-confirm-cancellation"
            >
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={showFieldReportPdfDialog}
        onOpenChange={(open) => {
          setShowFieldReportPdfDialog(open);
          if (!open) {
            setFieldReportPdfData(null);
            setPdfError(null);
          }
        }}
      >
        <DialogContent
          style={{
            maxWidth: "95vw",
            width: "1100px",
            height: "90vh",
            padding: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>현장출동보고서 PDF</DialogTitle>
          </DialogHeader>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <PdfCanvasViewer
              pdfData={fieldReportPdfData}
              loading={pdfLoading}
              error={pdfError}
              fileName="현장출동보고서.pdf"
            />
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={showInvoicePdfDialog}
        onOpenChange={(open) => {
          setShowInvoicePdfDialog(open);
          if (!open) {
            setInvoicePdfData(null);
            setPdfError(null);
          }
        }}
      >
        <DialogContent
          style={{
            maxWidth: "95vw",
            width: "1100px",
            height: "90vh",
            padding: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Invoice(청구서) PDF</DialogTitle>
          </DialogHeader>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <PdfCanvasViewer
              pdfData={invoicePdfData}
              loading={pdfLoading}
              error={pdfError}
              fileName="Invoice_청구서.pdf"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
