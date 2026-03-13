import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { User, Case, CaseDocument } from "@shared/schema";
import {
  Upload,
  X,
  Check,
  Search,
  Info,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { FieldSurveyLayout } from "@/components/field-survey-layout";
import { formatCaseNumber } from "@/lib/utils";
import pLimit from "p-limit";
import pRetry from "p-retry";

type DocumentCategory = "전체" | "사진" | "기본자료" | "증빙자료" | "청구자료";

type UploadStatus = "pending" | "uploading" | "completed" | "failed";

interface UploadingFile {
  id: string;
  file: File;
  category: string;
  progress: number;
  uploaded: boolean;
  status: UploadStatus;
  error?: string;
  documentId?: string;
}

// Helper function to convert File to Base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/png;base64,")
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

// 이미지 압축 함수: PNG/JPEG → JPEG, 최대 1600px, quality 35-40
const compressImage = (file: File): Promise<File> => {
  return new Promise((resolve, reject) => {
    // 이미지 파일이 아니면 원본 반환
    if (!file.type.startsWith("image/") || file.type === "image/gif") {
      resolve(file);
      return;
    }

    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    img.onload = () => {
      try {
        // 최대 가로폭 1600px로 리사이즈
        const MAX_WIDTH = 1600;
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;

        if (!ctx) {
          reject(new Error("Canvas context not available"));
          return;
        }

        // 이미지 그리기
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // JPEG로 변환 (quality 0.38 = 약 38%)
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("이미지 변환 실패"));
              return;
            }

            // 파일명에서 확장자 변경 (.png → .jpg)
            const originalName = file.name;
            const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");
            const newFileName = `${nameWithoutExt}.jpg`;

            const compressedFile = new File([blob], newFileName, {
              type: "image/jpeg",
              lastModified: Date.now(),
            });

            console.log(
              `[압축] ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB) → ${newFileName} (${(compressedFile.size / 1024 / 1024).toFixed(2)}MB)`,
            );
            resolve(compressedFile);
          },
          "image/jpeg",
          0.38, // JPEG quality 38%
        );
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error("이미지 로드 실패"));
    };

    // 파일을 이미지로 로드
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("파일 읽기 실패"));
    reader.readAsDataURL(file);
  });
};

// Helper function to download a file from Base64
const downloadFile = (
  fileName: string,
  fileType: string,
  base64Data: string,
) => {
  // Create blob from base64
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: fileType });

  // Create download link
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

export default function FieldDocuments() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedCategory, setSelectedCategory] =
    useState<DocumentCategory>("전체");
  const [photoSubFilter, setPhotoSubFilter] = useState<
    "전체" | "현장출동사진" | "수리중 사진" | "복구완료 사진"
  >("전체");
  const [basicDataSubFilter, setBasicDataSubFilter] = useState<
    "전체" | "보험금 청구서" | "개인정보 동의서(가족용)"
  >("전체");
  const [evidenceSubFilter, setEvidenceSubFilter] = useState<
    | "전체"
    | "주민등록등본"
    | "등기부등본"
    | "건축물대장"
    | "기타증빙자료(민원일지 등)"
  >("전체");
  const [claimDataSubFilter, setClaimDataSubFilter] = useState<
    "전체" | "복구완료 및 위임장" | "도급계약서" | "부가세 청구자료"
  >("전체");
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [caseSearchModalOpen, setCaseSearchModalOpen] = useState(false);
  const [showRelatedCasesDropdown, setShowRelatedCasesDropdown] = useState(false);
  const [caseSearchQuery, setCaseSearchQuery] = useState("");
  const [showClaimSubmitDialog, setShowClaimSubmitDialog] = useState(false);

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  // 선택된 케이스 ID (초기값: localStorage, 문자열 "null" 방지)
  const [selectedCaseId, setSelectedCaseId] = useState(() => {
    const rawCaseId = localStorage.getItem("selectedFieldSurveyCaseId");
    return rawCaseId && rawCaseId !== "null" && rawCaseId !== "undefined"
      ? rawCaseId
      : "";
  });

  // 모든 케이스 목록 조회 (검색용)
  const { data: allCases = [] } = useQuery<Case[]>({
    queryKey: ["/api/cases"],
    enabled: caseSearchModalOpen,
  });

  // 케이스 필터링 (검색어 기준 + 협력사 필터링) - 안전한 null 처리
  const filteredCases = allCases.filter((c) => {
    // 협력사 사용자인 경우: 본인 협력사에 배당된 케이스만 표시
    if (user?.role === "협력사") {
      if (c.assignedPartner !== user.company) return false;
    }

    if (!caseSearchQuery) return true;
    const query = caseSearchQuery.toLowerCase();
    const caseNumber = c.caseNumber?.toLowerCase() ?? "";
    const insuranceCompany = c.insuranceCompany?.toLowerCase() ?? "";
    const insuranceAccidentNo = c.insuranceAccidentNo?.toLowerCase() ?? "";
    const policyHolderName = c.policyHolderName?.toLowerCase() ?? "";
    const victimName = c.victimName?.toLowerCase() ?? "";

    return (
      caseNumber.includes(query) ||
      insuranceCompany.includes(query) ||
      insuranceAccidentNo.includes(query) ||
      policyHolderName.includes(query) ||
      victimName.includes(query)
    );
  });

  // 선택된 케이스 데이터 가져오기
  const { data: selectedCase, isLoading: isLoadingCase } = useQuery<Case>({
    queryKey: [`/api/cases/${selectedCaseId}`],
    enabled: !!selectedCaseId,
  });

  // 동일 사고번호(증권번호) 관련 케이스 조회
  const { data: relatedCases = [] } = useQuery<Case[]>({
    queryKey: ["/api/cases"],
    enabled: !!selectedCase?.insuranceAccidentNo,
    select: (cases) => {
      if (!selectedCase?.insuranceAccidentNo) return [];
      return cases.filter(
        (c) => c.insuranceAccidentNo === selectedCase.insuranceAccidentNo
      );
    },
  });

  // 증빙자료 등록은 제출 후에도 전체 수정 가능 (파일 업로드/삭제, 카테고리 변경 모두 허용)
  const isSubmitted = selectedCase?.fieldSurveyStatus === "submitted";
  const isCategoryReadOnly = false; // 증빙자료는 항상 수정 가능

  // 청구자료 탭 활성화 조건: 케이스 상태가 직접복구 또는 이후 단계일 때
  const claimDocumentStatuses = [
    "직접복구",
    "청구자료제출(복구)",
    "출동비청구(선견적)",
    "청구자료제출",
    "출동비 청구",
    "청구",
    "결정금액/수수료",
    "입금완료",
    "부분입금",
    "정산완료",
  ];
  const isClaimDocumentEnabled = claimDocumentStatuses.includes(
    selectedCase?.status || "",
  );

  // 직접복구 상태 확인 (청구자료 버튼 표시 조건)
  const isDirectRecoveryStatus = selectedCase?.status === "직접복구";

  // 케이스 선택 핸들러
  const handleCaseSelect = (caseId: string) => {
    setSelectedCaseId(caseId);
    localStorage.setItem("selectedFieldSurveyCaseId", caseId);
    setCaseSearchModalOpen(false);
    setCaseSearchQuery("");
    toast({
      title: "케이스가 선택되었습니다",
      description: "선택한 케이스의 증빙자료를 관리할 수 있습니다.",
    });
  };

  // 문서 목록 조회 (전체 데이터 포함)
  const { data: documents = [], isLoading } = useQuery<CaseDocument[]>({
    queryKey: ["/api/documents/case", selectedCaseId],
    enabled: !!selectedCaseId,
  });

  // 파일 다운로드 (Object Storage 또는 레거시)
  const handleDownload = useCallback(
    async (doc: CaseDocument) => {
      if (doc.storageKey && doc.status === "ready") {
        try {
          const response = await apiRequest(
            "GET",
            `/api/documents/${doc.id}/download-url`,
          );
          if (!response.ok) {
            throw new Error("다운로드 URL 생성 실패");
          }
          const { downloadURL } = await response.json();
          window.open(downloadURL, "_blank");
        } catch (error) {
          console.error("Download error:", error);
          toast({
            title: "다운로드 실패",
            description: "파일을 다운로드할 수 없습니다",
            variant: "destructive",
          });
        }
      } else if (doc.fileData) {
        downloadFile(doc.fileName, doc.fileType, doc.fileData);
      }
    },
    [toast],
  );

  // 도면 데이터 조회 (제출 조건 체크용)
  const { data: drawingData, isLoading: isLoadingDrawing } = useQuery({
    queryKey: ["/api/drawings", "case", selectedCaseId],
    enabled: !!selectedCaseId,
  });

  // 견적 데이터 조회 (제출 조건 체크용)
  const { data: estimateData, isLoading: isLoadingEstimate } = useQuery({
    queryKey: ["/api/estimates", selectedCaseId, "latest"],
    enabled: !!selectedCaseId,
  });

  // 제출 조건 상태 계산
  const isFieldInputComplete = useMemo(() => {
    return !!(
      selectedCase?.visitDate &&
      selectedCase?.visitTime &&
      selectedCase?.accidentCategory &&
      selectedCase?.victimName
    );
  }, [selectedCase]);

  const isDrawingComplete = useMemo(() => {
    return (
      !isLoadingDrawing &&
      !!drawingData &&
      typeof drawingData === "object" &&
      "id" in drawingData
    );
  }, [drawingData, isLoadingDrawing]);

  const isDocumentsComplete = useMemo(() => {
    return !isLoading && Array.isArray(documents) && documents.length > 0;
  }, [documents, isLoading]);

  const isEstimateComplete = useMemo(() => {
    return (
      !isLoadingEstimate &&
      !!estimateData &&
      typeof estimateData === "object" &&
      "estimate" in estimateData &&
      !!estimateData.estimate
    );
  }, [estimateData, isLoadingEstimate]);

  const canSubmit =
    isFieldInputComplete &&
    isDrawingComplete &&
    isDocumentsComplete &&
    isEstimateComplete;

  // 관련 케이스 문서 확인 (같은 사고번호의 다른 케이스에 문서가 있는지)
  const { data: relatedDocumentsInfo } = useQuery<{
    hasRelatedDocuments: boolean;
    sourceCaseId?: string;
    sourceCaseNumber?: string;
    documentCount?: number;
  }>({
    queryKey: ["/api/cases", selectedCaseId, "related-documents"],
    enabled: !!selectedCaseId && documents.length === 0 && !isLoading,
  });

  // 문서 복제 mutation
  const cloneDocumentsMutation = useMutation({
    mutationFn: async (sourceCaseId: string) => {
      const response = await apiRequest(
        "POST",
        `/api/cases/${selectedCaseId}/clone-documents`,
        {
          sourceCaseId,
        },
      );
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "문서 복제 실패");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/documents/case", selectedCaseId],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/cases", selectedCaseId, "related-documents"],
      });
      toast({
        title: "문서 동기화 완료",
        description: "관련 케이스의 문서들이 동기화되었습니다.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "문서 동기화 실패",
        description: error.message || "알 수 없는 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 문서 자동 동기화 비활성화 - 각 케이스 개별 관리
  // Auto-sync disabled - each case manages its own documents

  // 문서 업로드 mutation
  const uploadMutation = useMutation({
    mutationFn: async (data: {
      caseId: string;
      category: string;
      parentCategory?: string;
      fileName: string;
      fileType: string;
      fileSize: number;
      fileData: string;
      createdBy: string;
    }) => {
      return await apiRequest("POST", "/api/documents", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/documents/case", selectedCaseId],
      });
      toast({
        title: "파일이 업로드 되었습니다",
        description: "",
        className: "bg-[#008FED] text-white border-0",
      });
    },
  });

  // 삭제 중인 문서 ID 추적
  const [deletingDocIds, setDeletingDocIds] = useState<Set<string>>(new Set());

  // 문서 삭제 mutation
  const deleteMutation = useMutation({
    mutationFn: async (documentId: string) => {
      return await apiRequest("DELETE", `/api/documents/${documentId}`);
    },
    onMutate: (documentId: string) => {
      // 즉시 UI에서 제거 (낙관적 업데이트)
      setDeletingDocIds((prev) => new Set(prev).add(documentId));
    },
    onSuccess: (_, documentId: string) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/documents/case", selectedCaseId],
      });
      setDeletingDocIds((prev) => {
        const next = new Set(prev);
        next.delete(documentId);
        return next;
      });
      toast({
        title: "파일이 삭제되었습니다",
        description: "",
        className: "bg-[#008FED] text-white border-0",
      });
    },
    onError: (error, documentId: string) => {
      setDeletingDocIds((prev) => {
        const next = new Set(prev);
        next.delete(documentId);
        return next;
      });
      toast({
        title: "삭제 실패",
        description: "파일 삭제 중 오류가 발생했습니다",
        variant: "destructive",
      });
    },
  });

  // 카테고리 변경 mutation
  const updateCategoryMutation = useMutation({
    mutationFn: async ({
      documentId,
      category,
    }: {
      documentId: string;
      category: string;
    }) => {
      return await apiRequest("PATCH", `/api/documents/${documentId}`, {
        category,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/documents/case", selectedCaseId],
      });
      const fileName =
        documents.find((d) => d.id === variables.documentId)?.fileName ||
        "파일";
      toast({
        title: `${fileName}을(를) ${variables.category} 카테고리로 이동했습니다.`,
        description: "",
      });
    },
  });

  // 청구자료 제출 mutation (동일 사고번호 직접복구 케이스 일괄 상태 변경 + SMS 발송)
  const claimSubmitMutation = useMutation({
    mutationFn: async (): Promise<{
      success: boolean;
      message: string;
      updatedCount: number;
    }> => {
      // 동일 사고번호의 모든 직접복구 케이스 상태 변경 + 플록슨 담당자 SMS 발송
      const response = await apiRequest("POST", "/api/submit-claim-documents", {
        caseId: selectedCaseId,
      });
      return await response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/cases/${selectedCaseId}`],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({
        title: "청구자료가 제출되었습니다",
        description: data.message || "제출이 완료되었습니다.",
        className: "bg-[#008FED] text-white border-0",
      });
      setShowClaimSubmitDialog(false);
    },
    onError: (error: Error) => {
      toast({
        title: "제출 실패",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#F5F7FA]">
        <div
          style={{
            fontFamily: "Pretendard",
            fontSize: "16px",
            fontWeight: 500,
            color: "rgba(12, 12, 12, 0.5)",
          }}
        >
          로그인이 필요합니다
        </div>
      </div>
    );
  }

  // 케이스가 선택되지 않은 경우 케이스 선택 UI 표시
  if (!selectedCaseId) {
    return (
      <FieldSurveyLayout>
        <div className="flex-1 flex flex-col items-center justify-center bg-[#F5F7FA] p-6">
          <div
            className="mb-6"
            style={{
              fontFamily: "Pretendard",
              fontSize: "16px",
              fontWeight: 500,
              color: "rgba(12, 12, 12, 0.5)",
            }}
          >
            케이스를 선택해주세요
          </div>
          <button
            type="button"
            onClick={() => setCaseSearchModalOpen(true)}
            className="px-6 py-3 rounded-lg hover-elevate active-elevate-2"
            style={{
              fontFamily: "Pretendard",
              fontSize: "15px",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "#FFFFFF",
              background: "#008FED",
              border: "none",
            }}
            data-testid="button-select-case-empty"
          >
            케이스 선택
          </button>
        </div>
      </FieldSurveyLayout>
    );
  }

  // 케이스 데이터 로딩 중일 때
  if (isLoadingCase) {
    return (
      <FieldSurveyLayout>
        <div className="flex-1 flex items-center justify-center bg-[#F5F7FA]">
          <div
            style={{
              fontFamily: "Pretendard",
              fontSize: "16px",
              fontWeight: 500,
              color: "rgba(12, 12, 12, 0.5)",
            }}
          >
            케이스 정보를 불러오는 중...
          </div>
        </div>
      </FieldSurveyLayout>
    );
  }

  // 케이스 데이터가 없는 경우 (로딩 완료 후에도 없을 때)
  if (!selectedCase) {
    return (
      <FieldSurveyLayout>
        <div className="flex-1 flex items-center justify-center bg-[#F5F7FA]">
          <div
            style={{
              fontFamily: "Pretendard",
              fontSize: "16px",
              fontWeight: 500,
              color: "rgba(12, 12, 12, 0.5)",
            }}
          >
            케이스 정보를 찾을 수 없습니다
          </div>
        </div>
      </FieldSurveyLayout>
    );
  }

  const categories: DocumentCategory[] = [
    "전체",
    "사진",
    "기본자료",
    "증빙자료",
    "청구자료",
  ];

  // 탭별 서브카테고리 옵션 반환 (전체 제외)
  const getSubCategoryOptions = (
    tab: DocumentCategory,
    submitted: boolean,
    claimEnabled: boolean,
  ): string[] => {
    switch (tab) {
      case "사진":
        return submitted
          ? ["현장출동사진", "수리중 사진", "복구완료 사진"]
          : ["현장출동사진"];
      case "기본자료":
        return ["보험금 청구서", "개인정보 동의서(가족용)"];
      case "증빙자료":
        return [
          "주민등록등본",
          "등기부등본",
          "건축물대장",
          "기타증빙자료(민원일지 등)",
        ];
      case "청구자료":
        return claimEnabled
          ? ["복구완료 및 위임장", "도급계약서", "부가세 청구자료"]
          : [];
      case "전체":
      default:
        // 전체 탭에서는 모든 카테고리 옵션 표시 (파일 이동 가능)
        // 청구자료 항목은 청구자료 탭이 활성화된 경우에만 표시
        const allOptions = [
          "현장출동사진",
          ...(submitted ? ["수리중 사진", "복구완료 사진"] : []),
          "보험금 청구서",
          "개인정보 동의서(가족용)",
          "주민등록등본",
          "등기부등본",
          "건축물대장",
          "기타증빙자료(민원일지 등)",
          ...(claimEnabled
            ? ["복구완료 및 위임장", "도급계약서", "부가세 청구자료"]
            : []),
        ];
        return allOptions;
    }
  };

  // 현재 탭의 서브카테고리 옵션
  const currentSubCategories = getSubCategoryOptions(
    selectedCategory,
    isSubmitted,
    isClaimDocumentEnabled,
  );

  // 현재 선택된 서브필터 값 가져오기
  const getCurrentSubFilter = (): string => {
    switch (selectedCategory) {
      case "사진":
        return photoSubFilter === "전체" ? "현장출동사진" : photoSubFilter;
      case "기본자료":
        return basicDataSubFilter === "전체"
          ? "보험금 청구서"
          : basicDataSubFilter;
      case "증빙자료":
        return evidenceSubFilter === "전체"
          ? "주민등록등본"
          : evidenceSubFilter;
      case "청구자료":
        return claimDataSubFilter === "전체" ? "복구완료 및 위임장" : claimDataSubFilter;
      case "전체":
      default:
        return "현장출동사진";
    }
  };

  // 동시 업로드 제한 (5개 - presign 요청 포함)
  const uploadLimit = pLimit(5);

  // 단일 파일 업로드 함수 (2단계 API: presign → PUT → upload-complete)
  const uploadSingleFile = async (
    uploadingFile: UploadingFile,
  ): Promise<void> => {
    const updateProgress = (
      progress: number,
      status?: UploadStatus,
      error?: string,
      documentId?: string,
    ) => {
      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.id === uploadingFile.id
            ? {
                ...f,
                progress,
                ...(status && { status }),
                ...(error !== undefined && { error }),
                ...(documentId && { documentId }),
              }
            : f,
        ),
      );
    };

    // 1단계: presign 호출 (DB 저장 없음, 메타데이터만 전송)
    updateProgress(5, "uploading");

    const presignResponse = await apiRequest("POST", "/api/documents/presign", {
      caseId: selectedCaseId,
      fileName: uploadingFile.file.name,
      fileType: uploadingFile.file.type,
      fileSize: uploadingFile.file.size,
    });

    if (!presignResponse.ok) {
      const errorData = await presignResponse
        .json()
        .catch(() => ({ error: "presigned URL 발급 실패" }));
      throw new Error(
        errorData.error || errorData.details || "presigned URL 발급 실패",
      );
    }

    const { uploadURL, storageKey } = await presignResponse.json();
    updateProgress(15);

    // 2단계: PUT으로 파일 직접 업로드 (XMLHttpRequest로 진행률 추적)
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const percentComplete =
            Math.round((event.loaded / event.total) * 65) + 15;
          updateProgress(percentComplete);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`업로드 실패: ${xhr.status} ${xhr.statusText}`));
        }
      });

      xhr.addEventListener("error", () => {
        reject(new Error("네트워크 오류로 업로드 실패"));
      });

      xhr.addEventListener("abort", () => {
        reject(new Error("업로드가 취소되었습니다"));
      });

      xhr.open("PUT", uploadURL);
      xhr.setRequestHeader("Content-Type", uploadingFile.file.type);
      xhr.send(uploadingFile.file);
    });

    updateProgress(85);

    // 3단계: upload-complete 호출 (업로드 확인 후 DB 저장)
    const completeResponse = await apiRequest(
      "POST",
      "/api/documents/upload-complete",
      {
        caseId: selectedCaseId,
        category: uploadingFile.category,
        fileName: uploadingFile.file.name,
        fileType: uploadingFile.file.type,
        fileSize: uploadingFile.file.size,
        storageKey,
        displayOrder: 0,
      },
    );

    if (!completeResponse.ok) {
      const errorData = await completeResponse
        .json()
        .catch(() => ({ error: "업로드 완료 처리 실패" }));
      throw new Error(
        errorData.error || errorData.details || "업로드 완료 처리 실패",
      );
    }

    const { documentId } = await completeResponse.json();
    updateProgress(100, "completed", undefined, documentId);
  };

  // 파일 업로드 재시도 래퍼
  const uploadWithRetry = async (
    uploadingFile: UploadingFile,
  ): Promise<void> => {
    try {
      await pRetry(
        async () => {
          await uploadSingleFile(uploadingFile);
        },
        {
          retries: 5,
          minTimeout: 2000,
          maxTimeout: 10000,
          factor: 2,
          onFailedAttempt: (error: {
            attemptNumber: number;
            retriesLeft: number;
          }) => {
            console.log(
              `[Upload] ${uploadingFile.file.name} 재시도 ${error.attemptNumber}/3`,
            );
          },
        },
      );

      queryClient.invalidateQueries({
        queryKey: ["/api/documents/case", selectedCaseId],
      });

      toast({
        title: "파일이 업로드 되었습니다",
        description: uploadingFile.file.name,
        className: "bg-[#008FED] text-white border-0",
      });

      setTimeout(() => {
        setUploadingFiles((prev) =>
          prev.filter((f) => f.id !== uploadingFile.id),
        );
      }, 1500);
    } catch (error) {
      console.error("Upload failed after retries:", error);

      setUploadingFiles((prev) =>
        prev.map((f) =>
          f.id === uploadingFile.id
            ? {
                ...f,
                status: "failed",
                error: error instanceof Error ? error.message : "업로드 실패",
              }
            : f,
        ),
      );

      if (uploadingFile.documentId) {
        try {
          await apiRequest("POST", "/api/documents/fail-upload", {
            documentId: uploadingFile.documentId,
          });
        } catch (e) {
          console.error("Failed to mark document as failed:", e);
        }
      }
    }
  };

  // 파일 선택 핸들러 (Object Storage 기반 + 이미지 자동 압축)
  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const defaultSubCategory = getCurrentSubFilter();

    // 1단계: 이미지 압축 변환 (PNG/JPEG → JPEG 1600px, quality 38%)
    const compressedFiles = await Promise.all(
      Array.from(files).map(async (file) => {
        try {
          return await compressImage(file);
        } catch (error) {
          console.error(`[압축 실패] ${file.name}:`, error);
          return file; // 압축 실패 시 원본 사용
        }
      }),
    );

    const newFiles: UploadingFile[] = compressedFiles.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      category: defaultSubCategory,
      progress: 0,
      uploaded: false,
      status: "pending" as UploadStatus,
    }));

    setUploadingFiles((prev) => [...prev, ...newFiles]);

    const uploadPromises = newFiles.map((uploadingFile) =>
      uploadLimit(() => uploadWithRetry(uploadingFile)),
    );

    await Promise.allSettled(uploadPromises);
  };

  // 실패한 파일 재업로드
  const handleRetryUpload = async (uploadingFile: UploadingFile) => {
    setUploadingFiles((prev) =>
      prev.map((f) =>
        f.id === uploadingFile.id
          ? {
              ...f,
              progress: 0,
              status: "pending" as UploadStatus,
              error: undefined,
              documentId: undefined,
            }
          : f,
      ),
    );

    await uploadWithRetry(uploadingFile);
  };

  // 실패한 파일 목록에서 제거
  const handleRemoveFailedUpload = (uploadId: string) => {
    setUploadingFiles((prev) => prev.filter((f) => f.id !== uploadId));
  };

  // 파일 삭제 (중복 호출 방지)
  const handleFileRemove = (documentId: string) => {
    // 이미 삭제 중인 문서는 무시
    if (deletingDocIds.has(documentId)) {
      return;
    }
    deleteMutation.mutate(documentId);
  };

  // 카테고리 변경
  const handleCategoryChange = (documentId: string, newCategory: string) => {
    updateCategoryMutation.mutate({ documentId, category: newCategory });
  };

  // 드래그 앤 드롭 핸들러
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  // 파일 크기 포맷
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 MB";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)}MB`;
  };

  // 서브카테고리와 탭 매핑
  const getParentTab = (subCategory: string): DocumentCategory => {
    const photoCategories = ["현장출동사진", "수리중 사진", "복구완료 사진"];
    const basicCategories = ["보험금 청구서", "개인정보 동의서(가족용)"];
    const evidenceCategories = [
      "주민등록등본",
      "등기부등본",
      "건축물대장",
      "기타증빙자료(민원일지 등)",
    ];
    const claimCategories = [
      "복구완료 및 위임장",
      "도급계약서",
      "부가세 청구자료",
    ];

    if (photoCategories.includes(subCategory)) return "사진";
    if (basicCategories.includes(subCategory)) return "기본자료";
    if (evidenceCategories.includes(subCategory)) return "증빙자료";
    if (claimCategories.includes(subCategory)) return "청구자료";
    return "사진"; // 기본값
  };

  // 현재 서브필터 원본 값 가져오기 (필터링용 - "전체" 포함)
  const getCurrentSubFilterRaw = (): string => {
    switch (selectedCategory) {
      case "사진":
        return photoSubFilter;
      case "기본자료":
        return basicDataSubFilter;
      case "증빙자료":
        return evidenceSubFilter;
      case "청구자료":
        return claimDataSubFilter;
      default:
        return "전체";
    }
  };

  // 필터링된 파일 목록 (탭별 서브카테고리로 필터링 + 삭제 중인 파일 제외)
  const filteredDocuments = (() => {
    // 삭제 중인 문서 제외
    const activeDocuments = documents.filter((d) => !deletingDocIds.has(d.id));

    if (selectedCategory === "전체") {
      return activeDocuments;
    }

    // 먼저 탭별 필터링
    const tabFilteredDocs = activeDocuments.filter(
      (d) => getParentTab(d.category) === selectedCategory,
    );

    // 서브 필터 적용 (원본 값 사용)
    const currentSubFilter = getCurrentSubFilterRaw();
    if (currentSubFilter === "전체") {
      return tabFilteredDocs;
    }

    // 서브 필터가 선택되면 해당 카테고리만 표시
    return tabFilteredDocs.filter((d) => d.category === currentSubFilter);
  })();

  // 청구자료 단계 필수 서류 검증 함수
  const validateClaimDocuments = (): {
    valid: boolean;
    missingDocs: string[];
  } => {
    const missingDocs: string[] = [];

    // 청구자료 단계 필수 서류 목록 (부가세 청구자료는 선택)
    const requiredCategories = [
      "수리중 사진",
      "복구완료 사진",
      "복구완료 및 위임장",
      "도급계약서",
    ];

    for (const category of requiredCategories) {
      const hasDocument = documents.some((doc) => doc.category === category);
      if (!hasDocument) {
        missingDocs.push(category);
      }
    }

    return {
      valid: missingDocs.length === 0,
      missingDocs,
    };
  };

  // 저장 핸들러
  const handleSave = () => {
    // 제출 조건 상태 콘솔 로그
    console.log("=== 제출 조건 체크 (증빙자료 저장) ===");
    console.log("현장입력 완료:", isFieldInputComplete);
    console.log("도면 완료:", isDrawingComplete);
    console.log("증빙자료 완료:", isDocumentsComplete);
    console.log("견적 완료:", isEstimateComplete);
    console.log("제출 가능:", canSubmit);
    console.log("청구자료 단계:", isClaimDocumentEnabled);
    console.log("====================================");

    // 청구자료 단계일 때만 필수 서류 검증
    if (isClaimDocumentEnabled) {
      const validation = validateClaimDocuments();
      if (!validation.valid) {
        toast({
          title: "필수 서류 누락",
          description: `다음 서류가 누락되었습니다:\n${validation.missingDocs.join(", ")}`,
          variant: "destructive",
        });
        return;
      }
    }

    const { dismiss } = toast({
      title: "증빙자료가 저장되었습니다",
      description: "",
      className: "bg-[#008FED] text-white border-0",
      action: (
        <button
          onClick={() => {
            dismiss();
          }}
          className="px-4 py-2 rounded"
          style={{
            background: "white",
            color: "#008FED",
            fontFamily: "Pretendard",
            fontSize: "14px",
            fontWeight: 600,
            textDecoration: "underline",
          }}
        >
          확인하기
        </button>
      ),
    });
  };

  // 청구자료 제출 버튼 클릭 핸들러
  const handleClaimSubmitClick = () => {
    // 필수 서류 검증
    const validation = validateClaimDocuments();
    if (!validation.valid) {
      // 누락된 항목이 2개 이상이면 앞 2개만 표시 + "등"
      const missingDocs = validation.missingDocs;
      let displayText: string;
      if (missingDocs.length <= 2) {
        displayText = missingDocs.join(", ");
      } else {
        displayText = `${missingDocs[0]}, ${missingDocs[1]} 등`;
      }

      toast({
        title: "미등록 항목 안내",
        description: `${displayText} 미입력(미등록) 되어있습니다.`,
        variant: "destructive",
      });
      return;
    }
    // 누락 없으면 확인 다이얼로그 표시
    setShowClaimSubmitDialog(true);
  };

  return (
    <div className="flex-1 overflow-y-auto p-8">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-8">
        <h1
          style={{
            fontFamily: "Pretendard",
            fontSize: "26px",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "#0C0C0C",
          }}
        >
          증빙자료 등록
        </h1>

        {/* 버튼 그룹 */}
        <div className="flex items-center gap-3">
          {/* 저장 버튼 */}
          <button
            type="button"
            onClick={handleSave}
            className="px-8 py-3 rounded-lg hover-elevate active-elevate-2"
            style={{
              background: "#008FED",
              color: "white",
              fontFamily: "Pretendard",
              fontSize: "16px",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              border: "none",
            }}
            data-testid="button-save"
          >
            저장
          </button>

          {/* 청구자료 버튼 - 직접복구 상태일 때만 표시 */}
          {isDirectRecoveryStatus && (
            <button
              type="button"
              onClick={handleClaimSubmitClick}
              className="px-8 py-3 rounded-lg hover-elevate active-elevate-2"
              style={{
                background: "#10B981",
                color: "white",
                fontFamily: "Pretendard",
                fontSize: "16px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                border: "none",
              }}
              data-testid="button-claim-submit"
            >
              청구자료제출
            </button>
          )}
        </div>
      </div>

      {/* 작성중인 건 */}
      {selectedCase && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 400,
                letterSpacing: "-0.02em",
                color: "rgba(12, 12, 12, 0.5)",
              }}
            >
              작성중인 건
            </div>

            {/* 다른 건 선택 버튼 */}
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRelatedCasesDropdown(!showRelatedCasesDropdown)}
                className="h-8"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "13px",
                  fontWeight: 500,
                }}
                data-testid="button-select-other-case"
              >
                <Search className="w-3.5 h-3.5 mr-1.5" />
                다른 건 선택
              </Button>

              {showRelatedCasesDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-[99]"
                    onClick={() => setShowRelatedCasesDropdown(false)}
                  />
                  <div
                    className="absolute right-0 top-full mt-2 z-[100] rounded-lg shadow-lg overflow-hidden"
                    style={{
                      width: "340px",
                      background: "#FFFFFF",
                      border: "1px solid rgba(12, 12, 12, 0.1)",
                    }}
                  >
                    <div
                      className="px-4 py-3"
                      style={{
                        borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "15px",
                          fontWeight: 600,
                          color: "#0C0C0C",
                          marginBottom: "4px",
                        }}
                      >
                        관련 케이스 선택
                      </div>
                      <div
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "12px",
                          fontWeight: 400,
                          color: "rgba(12, 12, 12, 0.5)",
                        }}
                      >
                        동일 접수번호의 케이스로 전환합니다
                      </div>
                    </div>
                    <div className="py-1">
                      {relatedCases.length <= 1 ? (
                        <div
                          className="px-4 py-3 text-center"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "13px",
                            color: "rgba(12, 12, 12, 0.4)",
                          }}
                        >
                          관련 케이스가 없습니다
                        </div>
                      ) : (
                        relatedCases.map((rc) => {
                          const isCurrent = rc.id === selectedCaseId;
                          const suffix = rc.caseNumber?.split("-").pop() || "";
                          const label = suffix === "0" ? "손해방지"
                            : `피해세대 ${suffix}`;
                          return (
                            <div
                              key={rc.id}
                              onClick={() => {
                                if (!isCurrent && rc.id) {
                                  handleCaseSelect(rc.id);
                                  setShowRelatedCasesDropdown(false);
                                }
                              }}
                              className={`px-4 py-3 flex items-center gap-2 ${isCurrent ? "" : "cursor-pointer hover:bg-gray-50"}`}
                              style={{
                                borderBottom: "1px solid rgba(12, 12, 12, 0.05)",
                                background: isCurrent ? "rgba(255, 193, 7, 0.08)" : undefined,
                              }}
                              data-testid={`related-case-${rc.id}`}
                            >
                              <span
                                style={{
                                  fontFamily: "Pretendard",
                                  fontSize: "14px",
                                  fontWeight: isCurrent ? 600 : 400,
                                  color: isCurrent ? "#D97706" : "#0C0C0C",
                                }}
                              >
                                {formatCaseNumber(rc.caseNumber)}
                              </span>
                              <span
                                style={{
                                  fontFamily: "Pretendard",
                                  fontSize: "13px",
                                  fontWeight: 400,
                                  color: "rgba(12, 12, 12, 0.5)",
                                }}
                              >
                                ({label})
                              </span>
                              {isCurrent && (
                                <span
                                  style={{
                                    fontFamily: "Pretendard",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    color: "#D97706",
                                  }}
                                >
                                  - 현재
                                </span>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div
            className="p-4 rounded-lg"
            style={{
              background: "rgba(12, 12, 12, 0.03)",
            }}
          >
            {/* 첫 번째 줄: 보험사명 + 사고번호 */}
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "#008FED" }}
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
                {selectedCase.insuranceCompany || "보험사 미정"}{" "}
                {selectedCase.insuranceAccidentNo || ""}
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
              <span>
                피보험자{" "}
                {selectedCase.policyHolderName ||
                  selectedCase.clientName ||
                  "미정"}
              </span>
              <span>
                담당자 {selectedCase.assignedPartnerManager || "미정"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 카테고리 탭 */}
      <div
        className="flex gap-8 mb-6"
        style={{
          borderBottom: "2px solid rgba(12, 12, 12, 0.08)",
        }}
      >
        {categories.map((category) => {
          const isDisabled = category === "청구자료" && !isClaimDocumentEnabled;

          const getTooltipContent = (cat: DocumentCategory) => {
            switch (cat) {
              case "사진":
                return (
                  <div className="text-left">
                    <div className="font-semibold mb-1">필수 서류 안내</div>
                    <div>• 제출 전: 현장출동사진 필수</div>
                    <div>• 청구 단계: 수리중 사진, 복구완료 사진 필수</div>
                  </div>
                );
              case "기본자료": {
                return (
                  <div className="text-left">
                    <div className="font-semibold mb-1">서류 안내</div>
                    <div>
                      • 보험금 청구서, 개인정보 동의서 (선택)
                    </div>
                  </div>
                );
              }
              case "증빙자료":
                return (
                  <div className="text-left">
                    <div className="font-semibold mb-1">필수 서류 안내</div>
                    <div>• 제출 전: 건축물대장 또는 등기부등본 (택1) 필수</div>
                  </div>
                );
              case "청구자료":
                return (
                  <div className="text-left">
                    <div className="font-semibold mb-1">필수 서류 안내</div>
                    <div>
                      • 청구 단계: 복구완료 및 위임장, 도급계약서 필수
                      (부가세 청구자료는 선택)
                    </div>
                  </div>
                );
              default:
                return null;
            }
          };

          const tooltipContent = getTooltipContent(category);

          return (
            <div
              key={category}
              className="flex items-center gap-1 pb-3 relative"
            >
              <button
                type="button"
                onClick={() => !isDisabled && setSelectedCategory(category)}
                disabled={isDisabled}
                className="transition-all"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: selectedCategory === category ? 600 : 400,
                  letterSpacing: "-0.02em",
                  background: "transparent",
                  color: isDisabled
                    ? "rgba(12, 12, 12, 0.25)"
                    : selectedCategory === category
                      ? "#008FED"
                      : "rgba(12, 12, 12, 0.5)",
                  border: "none",
                  cursor: isDisabled ? "not-allowed" : "pointer",
                }}
                data-testid={`tab-${category}`}
              >
                {category}
              </button>

              {tooltipContent && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="p-0.5 rounded-full hover:bg-gray-100 transition-colors"
                      data-testid={`tab-info-${category}`}
                    >
                      <Info
                        className="w-4 h-4"
                        style={{
                          color:
                            selectedCategory === category
                              ? "#008FED"
                              : "rgba(12, 12, 12, 0.35)",
                        }}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-xs"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "13px",
                    }}
                  >
                    {tooltipContent}
                  </TooltipContent>
                </Tooltip>
              )}

              {selectedCategory === category && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "-2px",
                    left: 0,
                    right: 0,
                    height: "2px",
                    background: "#008FED",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 사진 탭 서브 필터 */}
      {selectedCategory === "사진" && (
        <div className="mb-6">
          <div
            className="inline-flex items-center p-1 gap-1.5"
            style={{
              background: "#E0E2F3",
              borderRadius: "6px",
            }}
            data-testid="photo-sub-filter"
          >
            <button
              type="button"
              onClick={() => setPhotoSubFilter("전체")}
              className="flex items-center justify-center px-1.5 py-1"
              style={{
                background:
                  photoSubFilter === "전체" ? "#FDFDFD" : "transparent",
                boxShadow:
                  photoSubFilter === "전체"
                    ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                    : "none",
                borderRadius: "4px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: photoSubFilter === "전체" ? 500 : 400,
                letterSpacing: "-0.01em",
                color:
                  photoSubFilter === "전체"
                    ? "#0C0C0C"
                    : "rgba(12, 12, 12, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
              data-testid="button-filter-all"
            >
              전체
            </button>
            <button
              type="button"
              onClick={() => setPhotoSubFilter("현장출동사진")}
              className="flex items-center justify-center px-1.5 py-1"
              style={{
                background:
                  photoSubFilter === "현장출동사진" ? "#FDFDFD" : "transparent",
                boxShadow:
                  photoSubFilter === "현장출동사진"
                    ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                    : "none",
                borderRadius: "4px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: photoSubFilter === "현장출동사진" ? 500 : 400,
                letterSpacing: "-0.01em",
                color:
                  photoSubFilter === "현장출동사진"
                    ? "#0C0C0C"
                    : "rgba(12, 12, 12, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
              data-testid="button-filter-field-photo"
            >
              현장출동사진
            </button>
            {/* 청구 후에만 표시되는 추가 필터 */}
            {isSubmitted && (
              <>
                <button
                  type="button"
                  onClick={() => setPhotoSubFilter("수리중 사진")}
                  className="flex items-center justify-center px-1.5 py-1"
                  style={{
                    background:
                      photoSubFilter === "수리중 사진"
                        ? "#FDFDFD"
                        : "transparent",
                    boxShadow:
                      photoSubFilter === "수리중 사진"
                        ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                        : "none",
                    borderRadius: "4px",
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: photoSubFilter === "수리중 사진" ? 500 : 400,
                    letterSpacing: "-0.01em",
                    color:
                      photoSubFilter === "수리중 사진"
                        ? "#0C0C0C"
                        : "rgba(12, 12, 12, 0.6)",
                    border: "none",
                    cursor: "pointer",
                  }}
                  data-testid="button-filter-repair-photo"
                >
                  수리중 사진
                </button>
                <button
                  type="button"
                  onClick={() => setPhotoSubFilter("복구완료 사진")}
                  className="flex items-center justify-center px-1.5 py-1"
                  style={{
                    background:
                      photoSubFilter === "복구완료 사진"
                        ? "#FDFDFD"
                        : "transparent",
                    boxShadow:
                      photoSubFilter === "복구완료 사진"
                        ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                        : "none",
                    borderRadius: "4px",
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: photoSubFilter === "복구완료 사진" ? 500 : 400,
                    letterSpacing: "-0.01em",
                    color:
                      photoSubFilter === "복구완료 사진"
                        ? "#0C0C0C"
                        : "rgba(12, 12, 12, 0.6)",
                    border: "none",
                    cursor: "pointer",
                  }}
                  data-testid="button-filter-complete-photo"
                >
                  복구완료 사진
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 기본자료 탭 서브 필터 */}
      {selectedCategory === "기본자료" && (
        <div className="mb-6">
          <div
            className="inline-flex items-center p-1 gap-1.5"
            style={{
              background: "#E0E2F3",
              borderRadius: "6px",
            }}
            data-testid="basic-data-sub-filter"
          >
            <button
              type="button"
              onClick={() => setBasicDataSubFilter("전체")}
              className="flex items-center justify-center px-1.5 py-1"
              style={{
                background:
                  basicDataSubFilter === "전체" ? "#FDFDFD" : "transparent",
                boxShadow:
                  basicDataSubFilter === "전체"
                    ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                    : "none",
                borderRadius: "4px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: basicDataSubFilter === "전체" ? 500 : 400,
                letterSpacing: "-0.01em",
                color:
                  basicDataSubFilter === "전체"
                    ? "#0C0C0C"
                    : "rgba(12, 12, 12, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
              data-testid="button-basic-filter-all"
            >
              전체
            </button>
            <button
              type="button"
              onClick={() => setBasicDataSubFilter("보험금 청구서")}
              className="flex items-center justify-center px-1.5 py-1"
              style={{
                background:
                  basicDataSubFilter === "보험금 청구서"
                    ? "#FDFDFD"
                    : "transparent",
                boxShadow:
                  basicDataSubFilter === "보험금 청구서"
                    ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                    : "none",
                borderRadius: "4px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: basicDataSubFilter === "보험금 청구서" ? 500 : 400,
                letterSpacing: "-0.01em",
                color:
                  basicDataSubFilter === "보험금 청구서"
                    ? "#0C0C0C"
                    : "rgba(12, 12, 12, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
              data-testid="button-basic-filter-insurance-claim"
            >
              보험금 청구서
            </button>
            <button
              type="button"
              onClick={() => setBasicDataSubFilter("개인정보 동의서(가족용)")}
              className="flex items-center justify-center px-1.5 py-1"
              style={{
                background:
                  basicDataSubFilter === "개인정보 동의서(가족용)"
                    ? "#FDFDFD"
                    : "transparent",
                boxShadow:
                  basicDataSubFilter === "개인정보 동의서(가족용)"
                    ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                    : "none",
                borderRadius: "4px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight:
                  basicDataSubFilter === "개인정보 동의서(가족용)" ? 500 : 400,
                letterSpacing: "-0.01em",
                color:
                  basicDataSubFilter === "개인정보 동의서(가족용)"
                    ? "#0C0C0C"
                    : "rgba(12, 12, 12, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
              data-testid="button-basic-filter-privacy-consent"
            >
              개인정보 동의서(가족용)
            </button>
          </div>
        </div>
      )}

      {/* 증빙자료 탭 서브 필터 */}
      {selectedCategory === "증빙자료" && (
        <div className="mb-6">
          <div
            className="inline-flex items-center p-1 gap-1.5"
            style={{
              background: "#E0E2F3",
              borderRadius: "6px",
            }}
            data-testid="evidence-sub-filter"
          >
            <button
              type="button"
              onClick={() => setEvidenceSubFilter("전체")}
              className="flex items-center justify-center px-1.5 py-1"
              style={{
                background:
                  evidenceSubFilter === "전체" ? "#FDFDFD" : "transparent",
                boxShadow:
                  evidenceSubFilter === "전체"
                    ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                    : "none",
                borderRadius: "4px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: evidenceSubFilter === "전체" ? 500 : 400,
                letterSpacing: "-0.01em",
                color:
                  evidenceSubFilter === "전체"
                    ? "#0C0C0C"
                    : "rgba(12, 12, 12, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
              data-testid="button-evidence-filter-all"
            >
              전체
            </button>
            <button
              type="button"
              onClick={() => setEvidenceSubFilter("주민등록등본")}
              className="flex items-center justify-center px-1.5 py-1"
              style={{
                background:
                  evidenceSubFilter === "주민등록등본"
                    ? "#FDFDFD"
                    : "transparent",
                boxShadow:
                  evidenceSubFilter === "주민등록등본"
                    ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                    : "none",
                borderRadius: "4px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: evidenceSubFilter === "주민등록등본" ? 500 : 400,
                letterSpacing: "-0.01em",
                color:
                  evidenceSubFilter === "주민등록등본"
                    ? "#0C0C0C"
                    : "rgba(12, 12, 12, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
              data-testid="button-evidence-filter-resident"
            >
              주민등록등본
            </button>
            <button
              type="button"
              onClick={() => setEvidenceSubFilter("등기부등본")}
              className="flex items-center justify-center px-1.5 py-1"
              style={{
                background:
                  evidenceSubFilter === "등기부등본"
                    ? "#FDFDFD"
                    : "transparent",
                boxShadow:
                  evidenceSubFilter === "등기부등본"
                    ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                    : "none",
                borderRadius: "4px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: evidenceSubFilter === "등기부등본" ? 500 : 400,
                letterSpacing: "-0.01em",
                color:
                  evidenceSubFilter === "등기부등본"
                    ? "#0C0C0C"
                    : "rgba(12, 12, 12, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
              data-testid="button-evidence-filter-registry"
            >
              등기부등본
            </button>
            <button
              type="button"
              onClick={() => setEvidenceSubFilter("건축물대장")}
              className="flex items-center justify-center px-1.5 py-1"
              style={{
                background:
                  evidenceSubFilter === "건축물대장"
                    ? "#FDFDFD"
                    : "transparent",
                boxShadow:
                  evidenceSubFilter === "건축물대장"
                    ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                    : "none",
                borderRadius: "4px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: evidenceSubFilter === "건축물대장" ? 500 : 400,
                letterSpacing: "-0.01em",
                color:
                  evidenceSubFilter === "건축물대장"
                    ? "#0C0C0C"
                    : "rgba(12, 12, 12, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
              data-testid="button-evidence-filter-building"
            >
              건축물대장
            </button>
            <button
              type="button"
              onClick={() => setEvidenceSubFilter("기타증빙자료(민원일지 등)")}
              className="flex items-center justify-center px-1.5 py-1"
              style={{
                background:
                  evidenceSubFilter === "기타증빙자료(민원일지 등)"
                    ? "#FDFDFD"
                    : "transparent",
                boxShadow:
                  evidenceSubFilter === "기타증빙자료(민원일지 등)"
                    ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                    : "none",
                borderRadius: "4px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight:
                  evidenceSubFilter === "기타증빙자료(민원일지 등)" ? 500 : 400,
                letterSpacing: "-0.01em",
                color:
                  evidenceSubFilter === "기타증빙자료(민원일지 등)"
                    ? "#0C0C0C"
                    : "rgba(12, 12, 12, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
              data-testid="button-evidence-filter-other"
            >
              기타증빙자료(민원일지 등)
            </button>
          </div>
        </div>
      )}

      {/* 청구자료 탭 서브 필터 (청구자료 탭 활성화 시 표시) */}
      {selectedCategory === "청구자료" && isClaimDocumentEnabled && (
        <div className="mb-6">
          <div
            className="inline-flex items-center p-1 gap-1.5"
            style={{
              background: "#E0E2F3",
              borderRadius: "6px",
            }}
            data-testid="claim-data-sub-filter"
          >
            <button
              type="button"
              onClick={() => setClaimDataSubFilter("전체")}
              className="flex items-center justify-center px-1.5 py-1"
              style={{
                background:
                  claimDataSubFilter === "전체" ? "#FDFDFD" : "transparent",
                boxShadow:
                  claimDataSubFilter === "전체"
                    ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                    : "none",
                borderRadius: "4px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: claimDataSubFilter === "전체" ? 500 : 400,
                letterSpacing: "-0.01em",
                color:
                  claimDataSubFilter === "전체"
                    ? "#0C0C0C"
                    : "rgba(12, 12, 12, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
              data-testid="button-claim-filter-all"
            >
              전체
            </button>
            <button
              type="button"
              onClick={() => setClaimDataSubFilter("복구완료 및 위임장")}
              className="flex items-center justify-center px-1.5 py-1"
              style={{
                background:
                  claimDataSubFilter === "복구완료 및 위임장" ? "#FDFDFD" : "transparent",
                boxShadow:
                  claimDataSubFilter === "복구완료 및 위임장"
                    ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                    : "none",
                borderRadius: "4px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: claimDataSubFilter === "복구완료 및 위임장" ? 500 : 400,
                letterSpacing: "-0.01em",
                color:
                  claimDataSubFilter === "복구완료 및 위임장"
                    ? "#0C0C0C"
                    : "rgba(12, 12, 12, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
              data-testid="button-claim-filter-completion-delegation"
            >
              복구완료 및 위임장
            </button>
            <button
              type="button"
              onClick={() => setClaimDataSubFilter("도급계약서")}
              className="flex items-center justify-center px-1.5 py-1"
              style={{
                background:
                  claimDataSubFilter === "도급계약서"
                    ? "#FDFDFD"
                    : "transparent",
                boxShadow:
                  claimDataSubFilter === "도급계약서"
                    ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                    : "none",
                borderRadius: "4px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: claimDataSubFilter === "도급계약서" ? 500 : 400,
                letterSpacing: "-0.01em",
                color:
                  claimDataSubFilter === "도급계약서"
                    ? "#0C0C0C"
                    : "rgba(12, 12, 12, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
              data-testid="button-claim-filter-contract"
            >
              도급계약서
            </button>
            <button
              type="button"
              onClick={() => setClaimDataSubFilter("부가세 청구자료")}
              className="flex items-center justify-center px-1.5 py-1"
              style={{
                background:
                  claimDataSubFilter === "부가세 청구자료"
                    ? "#FDFDFD"
                    : "transparent",
                boxShadow:
                  claimDataSubFilter === "부가세 청구자료"
                    ? "0px 2px 14px rgba(0, 0, 0, 0.12)"
                    : "none",
                borderRadius: "4px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight:
                  claimDataSubFilter === "부가세 청구자료" ? 500 : 400,
                letterSpacing: "-0.01em",
                color:
                  claimDataSubFilter === "부가세 청구자료"
                    ? "#0C0C0C"
                    : "rgba(12, 12, 12, 0.6)",
                border: "none",
                cursor: "pointer",
              }}
              data-testid="button-claim-filter-vat"
            >
              부가세 청구자료
            </button>
          </div>
        </div>
      )}

      {/* 파일 업로드 영역 - 전체 탭이 아닐 때와 하위탭이 전체가 아닐 때만 표시 */}
      {selectedCategory !== "전체" &&
        !(
          (selectedCategory === "사진" && photoSubFilter === "전체") ||
          (selectedCategory === "기본자료" && basicDataSubFilter === "전체") ||
          (selectedCategory === "증빙자료" && evidenceSubFilter === "전체") ||
          (selectedCategory === "청구자료" && claimDataSubFilter === "전체")
        ) && (
          <div
            className="mb-6 rounded-xl p-12 transition-all cursor-pointer"
            style={{
              background: isDragging
                ? "rgba(0, 143, 237, 0.08)"
                : "rgba(0, 143, 237, 0.03)",
              border: "none",
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            data-testid="upload-area"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => handleFileSelect(e.target.files)}
              className="hidden"
              data-testid="file-input"
            />
            <div className="flex flex-col items-center gap-4">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: "rgba(0, 143, 237, 0.1)" }}
              >
                <Upload className="w-8 h-8" style={{ color: "#008FED" }} />
              </div>
              <div className="text-center">
                <div
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "15px",
                    fontWeight: 400,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.5)",
                    marginBottom: "12px",
                  }}
                >
                  파일 또는 이미지를 이곳에 올려주세요
                </div>
                <button
                  type="button"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "15px",
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                    color: "#008FED",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                  data-testid="button-select-file"
                >
                  파일 찾기
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Uploading files (progress) */}
      {uploadingFiles.length > 0 && (
        <div className="mb-6">
          <div
            className="mb-2"
            style={{
              fontFamily: "Pretendard",
              fontSize: "15px",
              fontWeight: 500,
              letterSpacing: "-0.02em",
              color: "rgba(12, 12, 12, 0.7)",
            }}
          >
            업로드 중 {uploadingFiles.length}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {uploadingFiles.map((uploadingFile) => (
              <div
                key={uploadingFile.id}
                className="relative p-4 rounded-xl flex items-start gap-4"
                style={{
                  background: "white",
                  border: "1px solid rgba(12, 12, 12, 0.08)",
                }}
              >
                <div
                  className="flex-shrink-0 rounded-lg overflow-hidden"
                  style={{
                    width: "64px",
                    height: "64px",
                    background: "rgba(12, 12, 12, 0.04)",
                  }}
                >
                  {uploadingFile.file.type.startsWith("image/") ? (
                    <img
                      src={URL.createObjectURL(uploadingFile.file)}
                      alt={uploadingFile.file.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Upload
                        className="w-6 h-6"
                        style={{ color: "rgba(12, 12, 12, 0.3)" }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div
                    className="truncate mb-1"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 500,
                      letterSpacing: "-0.02em",
                      color: "#0C0C0C",
                    }}
                  >
                    {uploadingFile.file.name}
                  </div>
                  <div
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "12px",
                      fontWeight: 400,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.5)",
                      marginBottom: "8px",
                    }}
                  >
                    {formatFileSize(uploadingFile.file.size)}
                  </div>

                  {/* Progress bar */}
                  {uploadingFile.status !== "failed" && (
                    <Progress
                      value={uploadingFile.progress}
                      className="h-1.5"
                    />
                  )}

                  {uploadingFile.status === "completed" && (
                    <div
                      className="mt-2 flex items-center gap-1"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "12px",
                        fontWeight: 500,
                        letterSpacing: "-0.02em",
                        color: "#008FED",
                      }}
                    >
                      <Check className="w-3 h-3" />
                      업로드 완료
                    </div>
                  )}

                  {uploadingFile.status === "failed" && (
                    <div className="mt-2">
                      <div
                        className="flex items-center gap-1 mb-2"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "12px",
                          fontWeight: 500,
                          letterSpacing: "-0.02em",
                          color: "#EF4444",
                        }}
                      >
                        <AlertCircle className="w-3 h-3" />
                        {uploadingFile.error || "업로드 실패"}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRetryUpload(uploadingFile)}
                          className="h-7 text-xs gap-1"
                          data-testid={`button-retry-upload-${uploadingFile.id}`}
                        >
                          <RefreshCw className="w-3 h-3" />
                          재시도
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            handleRemoveFailedUpload(uploadingFile.id)
                          }
                          className="h-7 text-xs"
                          data-testid={`button-remove-failed-${uploadingFile.id}`}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {uploadingFile.status === "uploading" && (
                    <div
                      className="mt-2 flex items-center gap-1"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "12px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.5)",
                      }}
                    >
                      <Loader2 className="w-3 h-3 animate-spin" />
                      업로드 중... {uploadingFile.progress}%
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 파일 목록 */}
      <div
        className="mb-2"
        style={{
          fontFamily: "Pretendard",
          fontSize: "15px",
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: "rgba(12, 12, 12, 0.7)",
        }}
      >
        파일 목록 {filteredDocuments.length}
      </div>

      {/* 업로드된 문서들 */}
      {isLoading ? (
        <div className="text-center py-12">
          <div
            style={{
              fontFamily: "Pretendard",
              fontSize: "16px",
              fontWeight: 400,
              color: "rgba(12, 12, 12, 0.5)",
            }}
          >
            불러오는 중...
          </div>
        </div>
      ) : filteredDocuments.length === 0 ? (
        <div className="text-center py-12">
          <div
            style={{
              fontFamily: "Pretendard",
              fontSize: "16px",
              fontWeight: 400,
              color: "rgba(12, 12, 12, 0.5)",
            }}
          >
            업로드된 파일이 없습니다
          </div>
        </div>
      ) : (
        /* 모든 탭에서 동일한 그리드 형식으로 사진/파일 표시 (사진 탭과 동일한 스타일) */
        <div className="grid grid-cols-4 gap-3">
          {filteredDocuments.map((doc, index) => {
            const isImage = doc.fileType.startsWith("image/");
            return (
              <div key={doc.id} className="flex flex-col gap-2">
                <div
                  className="relative rounded-lg overflow-hidden cursor-pointer group"
                  style={{
                    aspectRatio: "4/3",
                    background: "rgba(12, 12, 12, 0.04)",
                    border: "1px solid rgba(12, 12, 12, 0.08)",
                  }}
                  onClick={() => handleDownload(doc)}
                  data-testid={`photo-thumbnail-${doc.id}`}
                >
                  {isImage ? (
                    <img
                      src={`/api/documents/${doc.id}/image`}
                      alt={doc.fileName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        e.currentTarget.nextElementSibling?.classList.remove(
                          "hidden",
                        );
                      }}
                    />
                  ) : null}
                  <div
                    className={`w-full h-full flex items-center justify-center ${isImage ? "hidden" : ""}`}
                  >
                    <Upload
                      className="w-8 h-8"
                      style={{ color: "rgba(12, 12, 12, 0.3)" }}
                    />
                  </div>

                  <div
                    className="absolute bottom-0 left-0 right-0 px-2 py-1"
                    style={{
                      background:
                        "linear-gradient(transparent, rgba(0,0,0,0.5))",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "12px",
                        fontWeight: 500,
                        color: "white",
                      }}
                    >
                      {isImage
                        ? `사진${index + 1}`
                        : doc.fileName.substring(0, 15)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFileRemove(doc.id);
                    }}
                    className="absolute top-1 right-1 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{
                      background: "rgba(255, 255, 255, 0.9)",
                    }}
                    data-testid={`button-delete-photo-${doc.id}`}
                  >
                    <X
                      className="w-4 h-4"
                      style={{ color: "rgba(12, 12, 12, 0.6)" }}
                    />
                  </button>
                </div>

                {/* Category dropdown */}
                <Select
                  value={doc.category}
                  onValueChange={(value) => handleCategoryChange(doc.id, value)}
                  disabled={isCategoryReadOnly}
                >
                  <SelectTrigger
                    className="w-full h-8"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "12px",
                      fontWeight: 400,
                      opacity: isCategoryReadOnly ? 0.5 : 1,
                      cursor: isCategoryReadOnly ? "not-allowed" : "pointer",
                    }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    style={{
                      filter: "drop-shadow(12px 12px 50px #C7D5E1)",
                      borderRadius: "8px",
                    }}
                  >
                    {currentSubCategories.map((subCategory) => {
                      const isSelected = doc.category === subCategory;
                      return (
                        <SelectItem
                          key={subCategory}
                          value={subCategory}
                          className="flex items-center justify-between"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: isSelected ? 600 : 500,
                            letterSpacing: "-0.02em",
                            color: isSelected
                              ? "rgba(12, 12, 12, 0.8)"
                              : "rgba(12, 12, 12, 0.4)",
                            background: isSelected
                              ? "linear-gradient(0deg, rgba(0, 143, 237, 0.07), rgba(0, 143, 237, 0.07)), #FDFDFD"
                              : "#FFFFFF",
                            paddingTop: "10px",
                            paddingBottom: "10px",
                            paddingRight: "12px",
                            paddingLeft: "32px",
                          }}
                        >
                          {subCategory}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      )}

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
              placeholder="접수번호, 보험사, 사고번호, 계약자명, 피해자명 검색..."
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
                  selectedCaseId === caseItem.id ? "ring-2 ring-blue-500" : ""
                }`}
                style={{
                  background:
                    selectedCaseId === caseItem.id
                      ? "rgba(0, 143, 237, 0.05)"
                      : "rgba(12, 12, 12, 0.02)",
                  border: "1px solid rgba(12, 12, 12, 0.08)",
                }}
                data-testid={`case-item-${caseItem.id}`}
              >
                <div className="flex items-center gap-3">
                  {/* 선택 표시 */}
                  {selectedCaseId === caseItem.id && (
                    <div className="flex-shrink-0">
                      <Check className="w-5 h-5" style={{ color: "#008FED" }} />
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
                      {caseItem.insuranceCompany || "보험사 미정"}{" "}
                      {caseItem.insuranceAccidentNo || ""}
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
                      <span>
                        접수번호: {formatCaseNumber(caseItem.caseNumber)}
                      </span>
                      <span>
                        계약자:{" "}
                        {caseItem.policyHolderName ||
                          caseItem.clientName ||
                          "미정"}
                      </span>
                      <span>피해자: {caseItem.victimName || "미정"}</span>
                      <span
                        className="px-2 py-0.5 rounded"
                        style={{
                          background: "rgba(0, 143, 237, 0.1)",
                          color: "#008FED",
                          fontSize: "12px",
                        }}
                      >
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

      {/* 청구자료 제출 확인 다이얼로그 */}
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
              청구자료 제출확인
            </AlertDialogTitle>
            <AlertDialogDescription
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                lineHeight: "1.8",
                whiteSpace: "pre-line",
              }}
            >
              청구자료를 제출하시겠습니까? 제출 후에는 수정이 불가능 합니다.
              {"\n\n"}
              그리고, 지급청구는 보험사 사고번호 기준으로 손방 및 대물 각 건의
              청구자료제출이 완료된 후 일괄하여 진행됨을 안내드립니다.
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
              제출
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
