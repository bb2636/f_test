import { useState, useRef, useEffect, useMemo } from "react";
import { format } from "date-fns";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Image as ImageIcon, File } from "lucide-react";

interface CaseDocument {
  id: string;
  fileName: string;
  fileType: string;
  category: string;
  fileData?: string;
}

interface InvoiceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseData: {
    id: string;
    caseNumber?: string | null;
    insuranceCompany?: string | null;
    insuranceAccidentNo?: string | null;
    receptionDate?: string | null;
    invoiceDamagePreventionAmount?: string | null;
    invoicePropertyRepairAmount?: string | null;
    invoiceRemarks?: string | null;
    invoicePdfGenerated?: string | null;
    recoveryType?: string | null;
    estimateAmount?: string | null;
    assessorId?: string | null;
    assessorEmail?: string | null;
    investigatorEmail?: string | null;
  } | null;
  relatedCases?: Array<{
    id: string;
    caseNumber?: string | null;
    recoveryType?: string | null;
    estimateAmount?: string | null;
  }>;
}

const getCaseSuffix = (caseNumber: string | null | undefined): number => {
  if (!caseNumber) return 0;
  const parts = caseNumber.split("-");
  return parts.length > 1 ? parseInt(parts[parts.length - 1]) || 0 : 0;
};

export function getCaseNumberPrefix(caseNumber: string | null | undefined): string | null {
  if (!caseNumber) return null;
  const parts = caseNumber.split("-");
  if (parts.length < 2) return caseNumber;
  return parts.slice(0, -1).join("-");
}

const DOCUMENT_CATEGORIES = ["사진-수리중", "사진-복구완료", "기본자료", "증빙자료", "청구자료"] as const;

const DOCUMENT_TABS = ["전체", "현장사진", "기본자료", "증빙자료", "청구자료"] as const;
type DocumentTab = typeof DOCUMENT_TABS[number];

const CATEGORY_TO_TAB: Record<string, DocumentTab> = {
  "현장출동사진": "현장사진",
  "현장": "현장사진",
  "수리중 사진": "현장사진",
  "수리중": "현장사진",
  "사진-수리중": "현장사진",
  "복구완료 사진": "현장사진",
  "복구완료": "현장사진",
  "사진-복구완료": "현장사진",
  "보험금 청구서": "기본자료",
  "개인정보 동의서(가족용)": "기본자료",
  "기본자료": "기본자료",
  "주민등록등본": "증빙자료",
  "등기부등본": "증빙자료",
  "건축물대장": "증빙자료",
  "기타증빙자료(민원일지 등)": "증빙자료",
  "증빙자료": "증빙자료",
  "위임장": "청구자료",
  "도급계약서": "청구자료",
  "복구완료확인서": "청구자료",
  "부가세 청구자료": "청구자료",
  "청구": "청구자료",
  "청구자료": "청구자료",
};

// 세부 카테고리 정의
const SUB_CATEGORIES: Record<DocumentTab, string[]> = {
  "전체": [],
  "현장사진": ["전체", "현장출동사진", "수리중 사진", "복구완료 사진"],
  "기본자료": ["전체", "보험금 청구서", "개인정보 동의서(가족용)"],
  "증빙자료": ["전체", "주민등록등본", "등기부등본", "건축물대장", "기타증빙자료(민원일지 등)"],
  "청구자료": ["전체", "위임장", "도급계약서", "복구완료확인서", "부가세 청구자료"],
};

// 카테고리가 세부 카테고리에 매칭되는지 확인
const matchesSubCategory = (docCategory: string, subCategory: string): boolean => {
  if (subCategory === "전체") return true;
  
  // 정확한 매칭
  if (docCategory === subCategory) return true;
  
  // 유사 매칭
  const categoryMappings: Record<string, string[]> = {
    "현장출동사진": ["현장출동사진", "현장"],
    "수리중 사진": ["수리중 사진", "수리중", "사진-수리중"],
    "복구완료 사진": ["복구완료 사진", "복구완료", "사진-복구완료"],
    "보험금 청구서": ["보험금 청구서"],
    "개인정보 동의서(가족용)": ["개인정보 동의서(가족용)"],
    "주민등록등본": ["주민등록등본"],
    "등기부등본": ["등기부등본"],
    "건축물대장": ["건축물대장"],
    "기타증빙자료(민원일지 등)": ["기타증빙자료(민원일지 등)"],
    "위임장": ["위임장"],
    "도급계약서": ["도급계약서"],
    "복구완료확인서": ["복구완료확인서"],
    "부가세 청구자료": ["부가세 청구자료"],
  };
  
  const matchingCategories = categoryMappings[subCategory] || [];
  return matchingCategories.includes(docCategory);
};

export function InvoiceSheet({ open, onOpenChange, caseData, relatedCases = [] }: InvoiceSheetProps) {
  const { toast } = useToast();
  const invoicePdfRef = useRef<HTMLDivElement>(null);
  
  const [invoiceDamagePreventionAmount, setInvoiceDamagePreventionAmount] = useState<string>("");
  const [invoicePropertyRepairAmount, setInvoicePropertyRepairAmount] = useState<string>("");
  const [fieldDispatchPreventionAmount, setFieldDispatchPreventionAmount] = useState<string>("");
  const [fieldDispatchPropertyAmount, setFieldDispatchPropertyAmount] = useState<string>("");
  const [invoiceRemarks, setInvoiceRemarks] = useState<string>("");
  const [invoiceRecipientEmail, setInvoiceRecipientEmail] = useState<string>("");
  const [isSendingPdf, setIsSendingPdf] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [hasPdfAction, setHasPdfAction] = useState(false); // PDF 다운로드 또는 발송 완료 여부
  const [dialogInitialized, setDialogInitialized] = useState(false); // 다이얼로그 초기화 여부 추적
  const [isLoadingAmounts, setIsLoadingAmounts] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [selectedDocTabByCaseId, setSelectedDocTabByCaseId] = useState<Record<string, DocumentTab>>({});
  const [selectedSubCategoryByCaseId, setSelectedSubCategoryByCaseId] = useState<Record<string, string>>({});

  // Fetch documents from main case
  const { data: mainCaseDocuments = [], isLoading: isLoadingMainDocs, isFetching: isFetchingMainDocs } = useQuery<CaseDocument[]>({
    queryKey: [`/api/documents/case/${caseData?.id}`],
    enabled: open && !!caseData?.id,
  });

  // Fetch documents from all related cases (피해세대 subcases)
  const relatedCaseIds = useMemo(() => {
    return relatedCases.map(c => c.id).filter(id => id !== caseData?.id);
  }, [relatedCases, caseData?.id]);

  const relatedDocsQueries = useQueries({
    queries: relatedCaseIds.map(caseId => ({
      queryKey: [`/api/documents/case/${caseId}`],
      enabled: open && !!caseId,
    })),
  });

  // Check loading state for each case's documents
  const isLoadingDocsForCase = (caseId: string): boolean => {
    if (caseId === caseData?.id) {
      return isLoadingMainDocs || isFetchingMainDocs;
    }
    const index = relatedCaseIds.indexOf(caseId);
    if (index >= 0 && relatedDocsQueries[index]) {
      return relatedDocsQueries[index].isLoading || relatedDocsQueries[index].isFetching;
    }
    return false;
  };

  // Build all cases list (main case + related cases) - sorted by case suffix (-0, -1, -2, ...)
  const allCases = useMemo(() => {
    const cases: Array<{ id: string; caseNumber: string | null; recoveryType?: string | null }> = [];
    if (caseData) {
      cases.push({ id: caseData.id, caseNumber: caseData.caseNumber || null, recoveryType: caseData.recoveryType });
    }
    for (const rc of relatedCases) {
      if (rc.id !== caseData?.id) {
        cases.push({ id: rc.id, caseNumber: rc.caseNumber || null, recoveryType: rc.recoveryType });
      }
    }
    // Sort by case suffix to ensure -0, -1, -2 order
    return cases.sort((a, b) => getCaseSuffix(a.caseNumber) - getCaseSuffix(b.caseNumber));
  }, [caseData, relatedCases]);

  // Build documents by caseId
  const documentsByCaseId = useMemo(() => {
    const result: Record<string, CaseDocument[]> = {};
    if (caseData?.id) {
      result[caseData.id] = mainCaseDocuments;
    }
    relatedCaseIds.forEach((caseId, index) => {
      const query = relatedDocsQueries[index];
      if (query?.data) {
        result[caseId] = query.data as CaseDocument[];
      } else {
        result[caseId] = [];
      }
    });
    return result;
  }, [caseData?.id, mainCaseDocuments, relatedCaseIds, relatedDocsQueries]);

  // Merge all documents from main case and related cases
  const documents = useMemo(() => {
    const allDocs: CaseDocument[] = [...mainCaseDocuments];
    for (const query of relatedDocsQueries) {
      if (query.data) {
        allDocs.push(...(query.data as CaseDocument[]));
      }
    }
    return allDocs;
  }, [mainCaseDocuments, relatedDocsQueries]);

  // Get filtered documents for a specific case
  const getFilteredDocsForCase = (caseId: string) => {
    const caseDocs = documentsByCaseId[caseId] || [];
    const selectedTab = selectedDocTabByCaseId[caseId] || "전체";
    const selectedSubCategory = selectedSubCategoryByCaseId[caseId] || "전체";
    
    if (selectedTab === "전체") return caseDocs;
    
    // 먼저 메인 탭으로 필터링
    const tabFiltered = caseDocs.filter(doc => CATEGORY_TO_TAB[doc.category] === selectedTab);
    
    // 세부 카테고리가 "전체"가 아니면 추가 필터링
    if (selectedSubCategory !== "전체") {
      return tabFiltered.filter(doc => matchesSubCategory(doc.category, selectedSubCategory));
    }
    
    return tabFiltered;
  };

  // Get tab for a specific case
  const getTabForCase = (caseId: string): DocumentTab => {
    return selectedDocTabByCaseId[caseId] || "전체";
  };

  // Get sub-category for a specific case
  const getSubCategoryForCase = (caseId: string): string => {
    return selectedSubCategoryByCaseId[caseId] || "전체";
  };

  // Set tab for a specific case (also reset sub-category)
  const setTabForCase = (caseId: string, tab: DocumentTab) => {
    setSelectedDocTabByCaseId(prev => ({ ...prev, [caseId]: tab }));
    setSelectedSubCategoryByCaseId(prev => ({ ...prev, [caseId]: "전체" }));
  };

  // Set sub-category for a specific case
  const setSubCategoryForCase = (caseId: string, subCategory: string) => {
    setSelectedSubCategoryByCaseId(prev => ({ ...prev, [caseId]: subCategory }));
  };

  const getFileIcon = (fileType: string) => {
    if (fileType?.startsWith("image/")) return <ImageIcon className="w-6 h-6 text-muted-foreground" />;
    if (fileType === "application/pdf") return <FileText className="w-6 h-6 text-muted-foreground" />;
    return <File className="w-6 h-6 text-muted-foreground" />;
  };

  const getFileThumbnail = (doc: CaseDocument) => {
    // 이미지는 API를 통해 로드 (Object Storage + 레거시 DB 파일 모두 지원)
    if (doc.fileType?.startsWith("image/")) {
      return (
        <img 
          src={`/api/documents/${doc.id}/image`}
          alt={doc.fileName}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
          onError={(e) => {
            // 이미지 로드 실패 시 아이콘 표시
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      );
    }
    return (
      <div style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(12, 12, 12, 0.04)",
        borderRadius: "8px",
      }}>
        {getFileIcon(doc.fileType)}
      </div>
    );
  };

  const toggleEmail = (email: string) => {
    setSelectedEmails(prev => {
      let newSelectedEmails: string[];
      if (prev.includes(email)) {
        newSelectedEmails = prev.filter(e => e !== email);
      } else {
        newSelectedEmails = [...prev, email];
      }
      // 체크박스 변경 시 즉시 이메일 입력 필드에 반영
      setInvoiceRecipientEmail(newSelectedEmails.join(", "));
      return newSelectedEmails;
    });
  };

  const toggleDocumentId = (docId: string) => {
    setSelectedDocumentIds(prev => {
      if (prev.includes(docId)) {
        return prev.filter(id => id !== docId);
      } else {
        return [...prev, docId];
      }
    });
  };


  const categorizedAmounts = useMemo(() => {
    let damagePreventionAmount = 0;
    let damagePreventionFieldDispatch = 0;
    let propertyRepairAmount = 0;
    let propertyFieldDispatch = 0;
    
    const allCases = relatedCases.length > 0 ? relatedCases : (caseData ? [caseData] : []);
    
    for (const c of allCases) {
      const suffix = getCaseSuffix(c.caseNumber);
      const isFieldDispatch = c.recoveryType === "선견적요청";
      
      if (suffix === 0) {
        if (isFieldDispatch) {
          damagePreventionFieldDispatch++;
        } else {
          damagePreventionAmount += parseInt(c.estimateAmount || "0") || 0;
        }
      } else if (suffix > 0) {
        if (isFieldDispatch) {
          propertyFieldDispatch++;
        } else {
          propertyRepairAmount += parseInt(c.estimateAmount || "0") || 0;
        }
      }
    }
    
    const hasAnyDirectRecovery = allCases.some(c => c.recoveryType && c.recoveryType !== "선견적요청");
    
    return {
      damagePreventionAmount,
      damagePreventionFieldDispatch,
      propertyRepairAmount,
      propertyFieldDispatch,
      hasDirectRecoveryPrevention: damagePreventionAmount > 0 || allCases.some(c => getCaseSuffix(c.caseNumber) === 0 && c.recoveryType !== "선견적요청"),
      hasFieldDispatchPrevention: damagePreventionFieldDispatch > 0 && !hasAnyDirectRecovery,
      hasDirectRecoveryProperty: propertyRepairAmount > 0 || allCases.some(c => getCaseSuffix(c.caseNumber) > 0 && c.recoveryType !== "선견적요청"),
      hasFieldDispatchProperty: propertyFieldDispatch > 0 && !hasAnyDirectRecovery,
    };
  }, [relatedCases, caseData]);

  useEffect(() => {
    const fetchApprovedAmounts = async () => {
      if (open && caseData) {
        const hasOnlyFieldDispatchPrevention = !categorizedAmounts.hasDirectRecoveryPrevention && categorizedAmounts.hasFieldDispatchPrevention;
        const hasOnlyFieldDispatchProperty = !categorizedAmounts.hasDirectRecoveryProperty && categorizedAmounts.hasFieldDispatchProperty;
        
        if (hasOnlyFieldDispatchPrevention) {
          setInvoiceDamagePreventionAmount("0");
        } else if (caseData.invoiceDamagePreventionAmount) {
          setInvoiceDamagePreventionAmount(caseData.invoiceDamagePreventionAmount);
        } else if (categorizedAmounts.damagePreventionAmount > 0) {
          setInvoiceDamagePreventionAmount(categorizedAmounts.damagePreventionAmount.toString());
        } else {
          const prefix = getCaseNumberPrefix(caseData.caseNumber);
          if (prefix && categorizedAmounts.hasDirectRecoveryPrevention) {
            setIsLoadingAmounts(true);
            try {
              const response = await fetch(`/api/invoice-amounts/${encodeURIComponent(prefix)}`);
              if (response.ok) {
                const data = await response.json();
                setInvoiceDamagePreventionAmount(data.damagePreventionAmount?.toString() || "0");
              }
            } catch (error) {
              console.error("Failed to fetch approved amounts:", error);
            } finally {
              setIsLoadingAmounts(false);
            }
          } else {
            setInvoiceDamagePreventionAmount("0");
          }
        }
        
        if (hasOnlyFieldDispatchProperty) {
          setInvoicePropertyRepairAmount("0");
        } else if (caseData.invoicePropertyRepairAmount) {
          setInvoicePropertyRepairAmount(caseData.invoicePropertyRepairAmount);
        } else if (categorizedAmounts.propertyRepairAmount > 0) {
          setInvoicePropertyRepairAmount(categorizedAmounts.propertyRepairAmount.toString());
        } else {
          const prefix = getCaseNumberPrefix(caseData.caseNumber);
          if (prefix && categorizedAmounts.hasDirectRecoveryProperty) {
            setIsLoadingAmounts(true);
            try {
              const response = await fetch(`/api/invoice-amounts/${encodeURIComponent(prefix)}`);
              if (response.ok) {
                const data = await response.json();
                setInvoicePropertyRepairAmount(data.propertyRepairAmount?.toString() || "0");
              }
            } catch (error) {
              console.error("Failed to fetch approved amounts:", error);
            } finally {
              setIsLoadingAmounts(false);
            }
          } else {
            setInvoicePropertyRepairAmount("0");
          }
        }
        
        // 선견적요청 현장출동비용은 케이스 수와 관계없이 1회만 100,000원 청구
        // 손해방지(-0) 또는 대물복구(-1 이상) 중 하나라도 선견적요청이 있으면 100,000원 1회만 청구
        const hasAnyFieldDispatch = categorizedAmounts.hasFieldDispatchPrevention || categorizedAmounts.hasFieldDispatchProperty;
        
        if (hasAnyFieldDispatch) {
          // 손해방지 쪽에만 100,000원 설정 (1회만 청구)
          if (categorizedAmounts.hasFieldDispatchPrevention) {
            setFieldDispatchPreventionAmount("100000");
            setFieldDispatchPropertyAmount("0");
          } else {
            setFieldDispatchPreventionAmount("0");
            setFieldDispatchPropertyAmount("100000");
          }
        } else {
          setFieldDispatchPreventionAmount("0");
          setFieldDispatchPropertyAmount("0");
        }
        
        setInvoiceRemarks(caseData.invoiceRemarks || "");
        setInvoiceRecipientEmail("");
        setSelectedEmails([]);
        setSelectedDocumentIds([]);
        
        // 다이얼로그가 처음 열릴 때만 DB 값을 기반으로 hasPdfAction 설정
        // 이후에는 PDF 다운로드/발송 시 직접 설정된 값 유지
        if (!dialogInitialized) {
          const hasExistingInvoiceData = !!(
            caseData.invoicePdfGenerated ||
            caseData.invoiceDamagePreventionAmount || 
            caseData.invoicePropertyRepairAmount || 
            caseData.invoiceRemarks
          );
          setHasPdfAction(hasExistingInvoiceData);
          setDialogInitialized(true);
        }
      } else if (!open) {
        setInvoiceDamagePreventionAmount("");
        setInvoicePropertyRepairAmount("");
        setFieldDispatchPreventionAmount("");
        setFieldDispatchPropertyAmount("");
        setInvoiceRemarks("");
        setInvoiceRecipientEmail("");
        setSelectedEmails([]);
        setSelectedDocumentIds([]);
        setSelectedDocTabByCaseId({});
        setSelectedSubCategoryByCaseId({});
        setHasPdfAction(false); // 시트 닫을 때 PDF 액션 상태 초기화
        setDialogInitialized(false); // 다이얼로그 닫을 때 초기화 플래그 리셋
      }
    };
    
    fetchApprovedAmounts();
  }, [open, caseData, categorizedAmounts, relatedCases, dialogInitialized]);

  // 절사 없이 합계 계산
  const totalAmount = 
    (parseInt(invoiceDamagePreventionAmount || "0") || 0) + 
    (parseInt(invoicePropertyRepairAmount || "0") || 0) +
    (parseInt(fieldDispatchPreventionAmount || "0") || 0) +
    (parseInt(fieldDispatchPropertyAmount || "0") || 0);

  const handleDownloadPdf = async () => {
    if (!caseData?.id) {
      toast({
        title: "PDF 다운로드 실패",
        description: "케이스 정보를 찾을 수 없습니다.",
        variant: "destructive",
      });
      return;
    }

    // Show warning toast if many documents are selected
    if (selectedDocumentIds.length >= 5) {
      toast({
        title: "PDF 생성 중",
        description: "PDF파일 용량이 커 다운받는데 시간이 소요될 수 있습니다.",
        duration: 5000,
      });
    }

    setIsDownloadingPdf(true);

    try {
      const damagePreventionAmt = parseInt(invoiceDamagePreventionAmount || "0") || 0;
      const propertyRepairAmt = parseInt(invoicePropertyRepairAmount || "0") || 0;
      const fieldDispatchPreventionAmt = parseInt(fieldDispatchPreventionAmount || "0") || 0;
      const fieldDispatchPropertyAmt = parseInt(fieldDispatchPropertyAmount || "0") || 0;
      
      const response = await fetch('/api/generate-invoice-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caseId: caseData.id,
          damagePreventionAmount: damagePreventionAmt,
          propertyRepairAmount: propertyRepairAmt,
          fieldDispatchPreventionAmount: fieldDispatchPreventionAmt,
          fieldDispatchPropertyAmount: fieldDispatchPropertyAmt,
          totalAmount: totalAmount,
          remarks: invoiceRemarks,
          selectedDocumentIds: selectedDocumentIds,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "PDF 생성 실패");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `INVOICE_${caseData.insuranceAccidentNo || caseData.caseNumber || caseData.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "PDF 다운로드 완료",
        description: "인보이스 PDF가 다운로드되었습니다.",
      });
      
      // DB에 PDF 생성 기록 저장
      try {
        await fetch('/api/invoice/mark-pdf-generated', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caseId: caseData.id,
            relatedCaseIds: relatedCases.map(c => c.id),
          }),
        });
      } catch (e) {
        console.error("PDF 생성 기록 저장 실패:", e);
      }
      
      setHasPdfAction(true); // PDF 다운로드 완료 시 저장 버튼 활성화
    } catch (error: any) {
      console.error("PDF 다운로드 오류:", error);
      toast({
        title: "PDF 다운로드 실패",
        description: error?.message || "PDF 다운로드 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleSendInvoicePdf = async () => {
    if (!caseData?.id) {
      toast({
        title: "PDF 생성 실패",
        description: "케이스 정보를 찾을 수 없습니다.",
        variant: "destructive",
      });
      return;
    }

    if (!invoiceRecipientEmail) {
      toast({
        title: "이메일 주소 필요",
        description: "수신자 이메일 주소를 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    // 사고번호 확인 - 없으면 발송 차단
    if (!caseData?.insuranceAccidentNo) {
      toast({
        title: "사고번호가 없습니다",
        description: "해당 접수건에 사고번호가 등록되어 있지 않습니다.",
        variant: "destructive",
      });
      return;
    }

    // Show warning toast if many documents are selected
    if (selectedDocumentIds.length >= 5) {
      toast({
        title: "PDF 생성 중",
        description: "PDF파일 용량이 커 전송에 시간이 소요될 수 있습니다.",
        duration: 5000,
      });
    }

    setIsSendingPdf(true);

    try {
      const damagePreventionAmt = parseInt(invoiceDamagePreventionAmount || "0") || 0;
      const propertyRepairAmt = parseInt(invoicePropertyRepairAmount || "0") || 0;
      const fieldDispatchPreventionAmt = parseInt(fieldDispatchPreventionAmount || "0") || 0;
      const fieldDispatchPropertyAmt = parseInt(fieldDispatchPropertyAmount || "0") || 0;
      
      const response = await fetch('/api/send-invoice-email-v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: invoiceRecipientEmail,
          caseId: caseData.id,
          recipientName: caseData.insuranceCompany || '',
          damagePreventionAmount: damagePreventionAmt,
          propertyRepairAmount: propertyRepairAmt,
          fieldDispatchPreventionAmount: fieldDispatchPreventionAmt,
          fieldDispatchPropertyAmount: fieldDispatchPropertyAmt,
          totalAmount: totalAmount,
          remarks: invoiceRemarks,
          selectedDocumentIds: selectedDocumentIds,
        }),
      });

      // 502/프록시 에러 대응: text()로 먼저 받고 안전하게 JSON 파싱
      const responseText = await response.text();
      let result: any;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        console.error("JSON 파싱 실패. 원본 응답:", responseText);
        throw new Error(`서버 응답 오류 (${response.status}): ${responseText.substring(0, 100)}`);
      }

      if (response.ok) {
        toast({
          title: "이메일 전송 완료",
          description: `${invoiceRecipientEmail}으로 INVOICE PDF가 첨부파일로 전송되었습니다.`,
        });
        
        // DB에 PDF 생성 기록 저장
        try {
          await fetch('/api/invoice/mark-pdf-generated', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              caseId: caseData.id,
              relatedCaseIds: relatedCases.map(c => c.id),
            }),
          });
        } catch (e) {
          console.error("PDF 생성 기록 저장 실패:", e);
        }
        
        // PDF 발송 성공 시 동일사고번호 케이스들의 상태를 "청구"로 업데이트
        try {
          await apiRequest("POST", "/api/invoice/send", {
            caseId: caseData?.id,
            relatedCaseIds: relatedCases.map(c => c.id),
            damagePreventionAmount: parseInt(invoiceDamagePreventionAmount || "0") || 0,
            propertyRepairAmount: parseInt(invoicePropertyRepairAmount || "0") || 0,
            fieldDispatchPreventionAmount: parseInt(fieldDispatchPreventionAmount || "0") || 0,
            fieldDispatchPropertyAmount: parseInt(fieldDispatchPropertyAmount || "0") || 0,
            remarks: invoiceRemarks,
            totalAmount: totalAmount,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
        } catch (e) {
          console.error("청구 상태 업데이트 실패:", e);
        }

        // 청구 상태 변경 시 심사자/조사자 SMS 자동 발송
        try {
          await apiRequest("POST", "/api/send-stage-notification", {
            caseId: caseData?.id,
            stage: "청구",
            recipients: {
              partner: false,
              manager: false,
              assessorInvestigator: true,
            },
          });
        } catch (e) {
          console.error("청구 SMS 발송 실패:", e);
        }
        
        setHasPdfAction(true);
        onOpenChange(false);
      } else {
        throw new Error(result.error || "이메일 전송에 실패했습니다");
      }
    } catch (error) {
      console.error("INVOICE PDF 이메일 전송 중 오류 발생", error);
      toast({
        title: "이메일 전송 실패",
        description: error instanceof Error ? error.message : "다시 시도해주세요.",
        variant: "destructive",
      });
    } finally {
      setIsSendingPdf(false);
    }
  };

  // Common styles from CSS spec
  const labelStyle: React.CSSProperties = {
    fontFamily: "'Pretendard'",
    fontStyle: "normal",
    fontWeight: 400,
    fontSize: "15px",
    lineHeight: "128%",
    letterSpacing: "-0.01em",
    color: "rgba(12, 12, 12, 0.7)",
  };

  const valueStyle: React.CSSProperties = {
    fontFamily: "'Pretendard'",
    fontStyle: "normal",
    fontWeight: 600,
    fontSize: "15px",
    lineHeight: "128%",
    letterSpacing: "-0.02em",
    color: "rgba(12, 12, 12, 0.9)",
  };

  const infoBoxStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    padding: "15px 16px",
    gap: "15px",
    width: "298px",
    height: "98px",
    background: "rgba(12, 12, 12, 0.04)",
    backdropFilter: "blur(7px)",
    borderRadius: "12px",
    flex: "none",
    flexGrow: 1,
  };

  const infoRowStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0px",
    width: "100%",
    height: "19px",
  };

  const dividerStyle: React.CSSProperties = {
    width: "100%",
    height: "0px",
    border: "1px solid rgba(12, 12, 12, 0.1)",
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          alignItems: "flex-start",
          padding: "38px 0px 38px",
          gap: "24px",
          width: "680px",
          maxWidth: "95vw",
          maxHeight: "100vh",
          background: "#FFFFFF",
          boxShadow: "0px -2px 70px rgba(179, 193, 205, 0.8)",
          borderRadius: "12px 0 0 12px",
          overflowY: "auto",
          overflowX: "hidden",
        }}
        data-testid="dialog-invoice"
      >
        {/* Header Section */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "0px",
          gap: "16px",
          width: "680px",
        }}>
          {/* INVOICE Title */}
          <div style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            padding: "0px 38px",
            gap: "10px",
            width: "680px",
            height: "41px",
          }}>
            <span style={{
              fontFamily: "'Pretendard'",
              fontStyle: "normal",
              fontWeight: 600,
              fontSize: "32px",
              lineHeight: "128%",
              textAlign: "center",
              color: "#0C0C0C",
            }}>
              INVOICE
            </span>
          </div>
          {/* Divider */}
          <div style={{ ...dividerStyle, width: "680px" }} />
        </div>

        {/* Main Content */}
        <div 
          ref={invoicePdfRef}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            padding: "0px 38px",
            gap: "26px",
            width: "604px",
            background: "#FFFFFF",
          }}
        >
          {/* Info Boxes Row */}
          <div style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            padding: "0px",
            gap: "8px",
            width: "604px",
            height: "98px",
          }}>
            {/* Left Info Box - 수신, 사고번호 */}
            <div style={infoBoxStyle}>
              <div style={infoRowStyle}>
                <span style={labelStyle}>수신</span>
                <span style={valueStyle}>{caseData?.insuranceCompany || "-"}</span>
              </div>
              <div style={dividerStyle} />
              <div style={infoRowStyle}>
                <span style={labelStyle}>사고번호</span>
                <span style={valueStyle}>{caseData?.insuranceAccidentNo || "-"}</span>
              </div>
            </div>

            {/* Right Info Box - 수임일자, 제출일자 */}
            <div style={infoBoxStyle}>
              <div style={infoRowStyle}>
                <span style={labelStyle}>수임일자</span>
                <span style={valueStyle}>{caseData?.receptionDate?.replace(/-/g, ".") || "0000.00.00"}</span>
              </div>
              <div style={dividerStyle} />
              <div style={infoRowStyle}>
                <span style={labelStyle}>제출일자</span>
                <span style={valueStyle}>{format(new Date(), "yyyy.MM.dd")}</span>
              </div>
            </div>
          </div>

          {/* Particulars Section */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            padding: "0px",
            gap: "12px",
            width: "604px",
          }}>
            {/* Particulars Label */}
            <div style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              padding: "16px 0px",
              gap: "10px",
              width: "604px",
              height: "50px",
            }}>
              <span style={{
                fontFamily: "'Pretendard'",
                fontStyle: "normal",
                fontWeight: 400,
                fontSize: "14px",
                lineHeight: "128%",
                letterSpacing: "-0.01em",
                color: "rgba(12, 12, 12, 0.5)",
              }}>
                Particulars
              </span>
            </div>

            {/* Accident Number Header */}
            <div style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              padding: "0px 4px",
              gap: "8px",
              width: "604px",
              height: "19px",
            }}>
              <span style={valueStyle}>사고번호</span>
              <span style={valueStyle}>{caseData?.insuranceAccidentNo || "-"}</span>
            </div>

            {/* Table Container */}
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              padding: "0px",
              width: "604px",
              borderRadius: "12px",
            }}>
              {/* Table Header */}
              <div style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0px",
                width: "604px",
                height: "44px",
                background: "rgba(12, 12, 12, 0.04)",
              }}>
                <div style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  padding: "0px 16px",
                  gap: "10px",
                  height: "44px",
                }}>
                  <span style={{
                    fontFamily: "'Pretendard'",
                    fontStyle: "normal",
                    fontWeight: 400,
                    fontSize: "14px",
                    lineHeight: "128%",
                    letterSpacing: "-0.01em",
                    color: "rgba(12, 12, 12, 0.5)",
                  }}>
                    PARTICULARS
                  </span>
                </div>
                <div style={{
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  padding: "0px 16px",
                  gap: "10px",
                  height: "44px",
                  flexGrow: 1,
                }}>
                  <span style={{
                    fontFamily: "'Pretendard'",
                    fontStyle: "normal",
                    fontWeight: 400,
                    fontSize: "14px",
                    lineHeight: "128%",
                    letterSpacing: "-0.01em",
                    color: "rgba(12, 12, 12, 0.5)",
                  }}>
                    AMOUNT
                  </span>
                </div>
              </div>

              {/* Table Rows */}
              <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                padding: "0px",
                width: "604px",
              }}>
                {/* 손해방지비용 Row */}
                {categorizedAmounts.hasDirectRecoveryPrevention && (
                  <div style={{
                    display: "flex",
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0px",
                    width: "604px",
                    height: "54px",
                  }}>
                    <div style={{
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      padding: "0px 16px",
                      gap: "10px",
                      height: "54px",
                    }}>
                      <span style={labelStyle}>손해방지비용</span>
                    </div>
                    <div style={{
                      display: "flex",
                      flexDirection: "row",
                      justifyContent: "flex-end",
                      alignItems: "center",
                      padding: "0px 16px",
                      gap: "4px",
                      height: "54px",
                      flexGrow: 1,
                    }}>
                      <span
                        style={{
                          fontFamily: "'Pretendard'",
                          fontStyle: "normal",
                          fontWeight: 400,
                          fontSize: "15px",
                          lineHeight: "128%",
                          letterSpacing: "-0.01em",
                          color: "#0C0C0C",
                          textAlign: "right",
                        }}
                        data-testid="text-damage-prevention-amount"
                      >
                        {invoiceDamagePreventionAmount ? Number(invoiceDamagePreventionAmount).toLocaleString() : "0"}
                      </span>
                      <span style={{
                        fontFamily: "'Pretendard'",
                        fontStyle: "normal",
                        fontWeight: 400,
                        fontSize: "15px",
                        lineHeight: "128%",
                        letterSpacing: "-0.01em",
                        color: "#0C0C0C",
                      }}>원</span>
                    </div>
                  </div>
                )}

                {/* 대물복구비용 Row */}
                {categorizedAmounts.hasDirectRecoveryProperty && (
                  <div style={{
                    display: "flex",
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0px",
                    width: "604px",
                    height: "54px",
                  }}>
                    <div style={{
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      padding: "0px 16px",
                      gap: "10px",
                      height: "54px",
                    }}>
                      <span style={labelStyle}>대물복구비용</span>
                    </div>
                    <div style={{
                      display: "flex",
                      flexDirection: "row",
                      justifyContent: "flex-end",
                      alignItems: "center",
                      padding: "0px 16px",
                      gap: "4px",
                      height: "54px",
                      flexGrow: 1,
                    }}>
                      <span
                        style={{
                          fontFamily: "'Pretendard'",
                          fontStyle: "normal",
                          fontWeight: 400,
                          fontSize: "15px",
                          lineHeight: "128%",
                          letterSpacing: "-0.01em",
                          color: "#0C0C0C",
                          textAlign: "right",
                        }}
                        data-testid="text-property-repair-amount"
                      >
                        {invoicePropertyRepairAmount ? Number(invoicePropertyRepairAmount).toLocaleString() : "0"}
                      </span>
                      <span style={{
                        fontFamily: "'Pretendard'",
                        fontStyle: "normal",
                        fontWeight: 400,
                        fontSize: "15px",
                        lineHeight: "128%",
                        letterSpacing: "-0.01em",
                        color: "#0C0C0C",
                      }}>원</span>
                    </div>
                  </div>
                )}

                {/* TOTAL AMOUNT Row */}
                <div style={{
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0px",
                  width: "604px",
                  height: "54px",
                  borderTop: "1px solid rgba(12, 12, 12, 0.1)",
                }}>
                  <div style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    padding: "0px 16px",
                    gap: "10px",
                    height: "54px",
                    background: "rgba(12, 12, 12, 0.04)",
                  }}>
                    <span style={{
                      fontFamily: "'Pretendard'",
                      fontStyle: "normal",
                      fontWeight: 400,
                      fontSize: "14px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "rgba(12, 12, 12, 0.7)",
                    }}>
                      TOTAL AMOUNT
                    </span>
                  </div>
                  <div style={{
                    display: "flex",
                    flexDirection: "row",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    padding: "0px 16px",
                    gap: "10px",
                    height: "54px",
                    flexGrow: 1,
                  }}>
                    <span style={{
                      fontFamily: "'Pretendard'",
                      fontStyle: "normal",
                      fontWeight: 600,
                      fontSize: "18px",
                      lineHeight: "128%",
                      letterSpacing: "-0.02em",
                      color: "#0C0C0C",
                    }} data-testid="text-total-amount">
                      {totalAmount.toLocaleString()}원
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Section - 비고 & 입금정보 */}
          <div style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            padding: "0px",
            gap: "8px",
            width: "604px",
            height: "261px",
          }}>
            {/* 비고 Box */}
            <div style={{
              boxSizing: "border-box",
              width: "298px",
              height: "261px",
              border: "1px solid rgba(12, 12, 12, 0.04)",
              backdropFilter: "blur(7px)",
              borderRadius: "12px",
              position: "relative",
            }}>
              <span style={{
                position: "absolute",
                left: "16px",
                top: "15px",
                ...valueStyle,
              }}>
                비고
              </span>
              <div style={{
                position: "absolute",
                left: "16px",
                top: "54px",
                width: "266px",
                height: "186px",
              }}>
                <textarea
                  value={invoiceRemarks}
                  onChange={(e) => setInvoiceRemarks(e.target.value)}
                  placeholder="내용을 입력해주세요"
                  style={{
                    width: "100%",
                    height: "100%",
                    fontFamily: "'Pretendard'",
                    fontStyle: "normal",
                    fontWeight: 400,
                    fontSize: "15px",
                    lineHeight: "128%",
                    letterSpacing: "-0.01em",
                    color: "#0C0C0C",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    resize: "none",
                  }}
                  data-testid="textarea-invoice-remarks"
                />
              </div>
            </div>

            {/* 입금 정보 Box */}
            <div style={{
              width: "298px",
              height: "261px",
              background: "rgba(12, 12, 12, 0.04)",
              backdropFilter: "blur(7px)",
              borderRadius: "12px",
              position: "relative",
            }}>
              <span style={{
                position: "absolute",
                left: "16px",
                top: "15px",
                ...valueStyle,
              }}>
                입금 정보
              </span>
              <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                padding: "0px",
                gap: "15px",
                position: "absolute",
                width: "266px",
                left: "16px",
                top: "64px",
              }}>
                {/* 은행명 */}
                <div style={infoRowStyle}>
                  <span style={labelStyle}>은행명</span>
                  <span style={valueStyle}>신한은행
</span>
                </div>
                <div style={dividerStyle} />
                {/* 계좌번호 */}
                <div style={infoRowStyle}>
                  <span style={labelStyle}>계좌번호</span>
                  <span style={valueStyle}>140-015-744120</span>
                </div>
                <div style={dividerStyle} />
                {/* 예금주 */}
                <div style={infoRowStyle}>
                  <span style={labelStyle}>예금주</span>
                  <span style={valueStyle}>주식회사 플록슨</span>
                </div>
                <div style={dividerStyle} />
                {/* 사업자등록번호 */}
                <div style={infoRowStyle}>
                  <span style={labelStyle}>사업자등록번호</span>
                  <span style={valueStyle}>517-87-03490</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 접수번호별 증빙자료 선택 Section */}
        {allCases.map((caseItem, caseIndex) => {
          const caseDocs = documentsByCaseId[caseItem.id] || [];
          const currentTab = getTabForCase(caseItem.id);
          const filteredDocs = getFilteredDocsForCase(caseItem.id);
          const caseSelectedCount = caseDocs.filter(doc => selectedDocumentIds.includes(doc.id)).length;
          
          return (
            <div 
              key={caseItem.id}
              style={{
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                padding: "16px 38px",
                gap: "12px",
                width: "680px",
                borderTop: caseIndex > 0 ? "1px solid rgba(12, 12, 12, 0.1)" : "none",
              }}
            >
              <div style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
              <span style={{
                fontFamily: "'Pretendard'",
                fontStyle: "normal",
                fontWeight: 500,
                fontSize: "14px",
                lineHeight: "128%",
                letterSpacing: "-0.01em",
                color: "rgba(12, 12, 12, 0.7)",
              }}>
                증빙자료 선택 (접수번호: {caseItem.caseNumber || caseItem.id})
              </span>
              <span style={{
                fontFamily: "'Pretendard'",
                fontSize: "12px",
                color: "#008FED",
                fontWeight: 500,
              }}>
                {caseSelectedCount}/{caseDocs.length}개 선택
              </span>
              </div>
              
              {/* Category Tabs */}
              <div style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: "4px",
                flexWrap: "wrap",
              }}>
                {DOCUMENT_TABS.map(tab => {
                  const isSelected = currentTab === tab;
                  const tabCount = tab === "전체" 
                    ? caseDocs.length 
                    : caseDocs.filter(doc => CATEGORY_TO_TAB[doc.category] === tab).length;
                  return (
                    <button
                      key={tab}
                      onClick={() => setTabForCase(caseItem.id, tab)}
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        padding: "6px 12px",
                        gap: "4px",
                        background: isSelected ? "#008FED" : "rgba(12, 12, 12, 0.04)",
                        borderRadius: "16px",
                        border: "none",
                        cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                      data-testid={`tab-doc-${caseItem.id}-${tab}`}
                    >
                      <span style={{
                        fontFamily: "'Pretendard'",
                        fontStyle: "normal",
                        fontWeight: 500,
                        fontSize: "12px",
                        lineHeight: "128%",
                        letterSpacing: "-0.01em",
                        color: isSelected ? "#FFFFFF" : "rgba(12, 12, 12, 0.7)",
                      }}>
                        {tab}
                      </span>
                      {tabCount > 0 && (
                        <span style={{
                          fontFamily: "'Pretendard'",
                          fontWeight: 500,
                          fontSize: "11px",
                          color: isSelected ? "rgba(255, 255, 255, 0.8)" : "rgba(12, 12, 12, 0.5)",
                        }}>
                          {tabCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Sub-Category Tabs - 메인 탭이 "전체"가 아닐 때만 표시 */}
              {currentTab !== "전체" && SUB_CATEGORIES[currentTab].length > 0 && (
                <div style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                  padding: "8px 0",
                  borderBottom: "1px solid rgba(12, 12, 12, 0.06)",
                }}>
                  {SUB_CATEGORIES[currentTab].map(subCat => {
                    const isSubSelected = getSubCategoryForCase(caseItem.id) === subCat;
                    const tabDocs = caseDocs.filter(doc => CATEGORY_TO_TAB[doc.category] === currentTab);
                    const subCatCount = subCat === "전체" 
                      ? tabDocs.length 
                      : tabDocs.filter(doc => matchesSubCategory(doc.category, subCat)).length;
                    
                    return (
                      <button
                        key={subCat}
                        onClick={() => setSubCategoryForCase(caseItem.id, subCat)}
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          alignItems: "center",
                          padding: "4px 10px",
                          gap: "4px",
                          background: isSubSelected ? "rgba(0, 143, 237, 0.1)" : "transparent",
                          borderRadius: "4px",
                          border: isSubSelected ? "1px solid #008FED" : "1px solid transparent",
                          cursor: "pointer",
                          transition: "all 0.2s",
                        }}
                        data-testid={`subtab-doc-${caseItem.id}-${subCat}`}
                      >
                        <span style={{
                          fontFamily: "'Pretendard'",
                          fontStyle: "normal",
                          fontWeight: isSubSelected ? 600 : 400,
                          fontSize: "11px",
                          lineHeight: "128%",
                          letterSpacing: "-0.01em",
                          color: isSubSelected ? "#008FED" : "rgba(12, 12, 12, 0.6)",
                        }}>
                          {subCat}
                        </span>
                        {subCatCount > 0 && (
                          <span style={{
                            fontFamily: "'Pretendard'",
                            fontWeight: 400,
                            fontSize: "10px",
                            color: isSubSelected ? "#008FED" : "rgba(12, 12, 12, 0.4)",
                          }}>
                            {subCatCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Select All Row */}
              <div style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 0",
                borderBottom: "1px solid rgba(12, 12, 12, 0.1)",
              }}>
                <label style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                }}>
                  <Checkbox
                    checked={filteredDocs.length > 0 && filteredDocs.every(doc => selectedDocumentIds.includes(doc.id))}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        const newIds = filteredDocs.map(doc => doc.id);
                        setSelectedDocumentIds(prev => Array.from(new Set([...prev, ...newIds])));
                      } else {
                        const currentDocIds = new Set(filteredDocs.map(doc => doc.id));
                        setSelectedDocumentIds(prev => prev.filter(id => !currentDocIds.has(id)));
                      }
                    }}
                    disabled={filteredDocs.length === 0}
                    data-testid={`checkbox-select-all-${caseItem.id}`}
                  />
                  <span style={{
                    fontFamily: "'Pretendard'",
                    fontSize: "12px",
                    color: "rgba(12, 12, 12, 0.7)",
                  }}>
                    전체 선택
                  </span>
                </label>
                <span style={{
                  fontFamily: "'Pretendard'",
                  fontSize: "12px",
                  color: "rgba(12, 12, 12, 0.5)",
                }}>
                  {filteredDocs.filter(doc => selectedDocumentIds.includes(doc.id)).length}개 선택됨 / {filteredDocs.length}개
                </span>
              </div>

              {/* Document Grid */}
              <ScrollArea style={{ maxHeight: "280px" }}>
                {isLoadingDocsForCase(caseItem.id) ? (
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "40px",
                    gap: "12px",
                  }}>
                    <div style={{
                      width: "32px",
                      height: "32px",
                      border: "3px solid rgba(0, 143, 237, 0.2)",
                      borderTopColor: "#008FED",
                      borderRadius: "50%",
                      animation: "spin 1s linear infinite",
                    }} />
                    <span style={{
                      color: "rgba(12, 12, 12, 0.5)",
                      fontFamily: "'Pretendard'",
                      fontSize: "13px",
                    }}>
                      증빙자료 불러오는 중...
                    </span>
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  </div>
                ) : filteredDocs.length === 0 ? (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "40px",
                    color: "rgba(12, 12, 12, 0.5)",
                    fontFamily: "'Pretendard'",
                    fontSize: "13px",
                  }}>
                    해당 카테고리에 자료가 없습니다.
                  </div>
                ) : (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, 90px)",
                    gap: "12px",
                    padding: "4px",
                  }}>
                    {filteredDocs.map(doc => {
                      const isSelected = selectedDocumentIds.includes(doc.id);
                      return (
                        <div
                          key={doc.id}
                          onClick={() => toggleDocumentId(doc.id)}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                            cursor: "pointer",
                            position: "relative",
                          }}
                          data-testid={`doc-thumbnail-${doc.id}`}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleDocumentId(doc.id);
                            }
                          }}
                        >
                          <div style={{
                            width: "100%",
                            aspectRatio: "1",
                            borderRadius: "8px",
                            overflow: "hidden",
                            border: isSelected ? "2px solid #008FED" : "1px solid rgba(12, 12, 12, 0.1)",
                            position: "relative",
                            background: "rgba(12, 12, 12, 0.04)",
                          }}>
                            <div style={{
                              width: "100%",
                              height: "100%",
                              overflow: "hidden",
                              borderRadius: "6px",
                            }}>
                              {getFileThumbnail(doc)}
                            </div>
                            {/* Selection indicator overlay */}
                            <div style={{
                              position: "absolute",
                              top: "6px",
                              right: "6px",
                              width: "20px",
                              height: "20px",
                              borderRadius: "4px",
                              background: isSelected ? "#008FED" : "rgba(255, 255, 255, 0.9)",
                              border: isSelected ? "none" : "1px solid rgba(12, 12, 12, 0.2)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                              pointerEvents: "none",
                            }}>
                              {isSelected && (
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                  <path d="M2.5 6L5 8.5L9.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </div>
                          </div>
                          <span style={{
                            fontFamily: "'Pretendard'",
                            fontStyle: "normal",
                            fontWeight: 400,
                            fontSize: "11px",
                            lineHeight: "128%",
                            letterSpacing: "-0.01em",
                            color: "rgba(12, 12, 12, 0.7)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: "100%",
                          }}>
                            {doc.fileName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>
          );
        })}

        {/* 이메일 수신자 선택 Section */}
        <div style={{
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          padding: "16px 38px",
          gap: "12px",
          width: "680px",
        }}>
          <span style={{
            fontFamily: "'Pretendard'",
            fontStyle: "normal",
            fontWeight: 500,
            fontSize: "14px",
            lineHeight: "128%",
            letterSpacing: "-0.01em",
            color: "rgba(12, 12, 12, 0.7)",
          }}>수신자 이메일</span>
          
          {/* Email Checkboxes */}
          {(caseData?.assessorEmail || caseData?.investigatorEmail) && (
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              paddingLeft: "8px",
            }}>
              {caseData?.assessorEmail && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: "8px",
                  }}
                  data-testid="checkbox-assessor-email"
                >
                  <Checkbox
                    id="invoice-assessor-email-checkbox"
                    checked={selectedEmails.includes(caseData.assessorEmail)}
                    onCheckedChange={() => toggleEmail(caseData.assessorEmail!)}
                  />
                  <label
                    htmlFor="invoice-assessor-email-checkbox"
                    style={{
                      fontFamily: "'Pretendard'",
                      fontStyle: "normal",
                      fontWeight: 400,
                      fontSize: "13px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "rgba(12, 12, 12, 0.8)",
                      cursor: "pointer",
                    }}
                  >
                    심사자 이메일: {caseData.assessorEmail}
                  </label>
                </div>
              )}
              {caseData?.investigatorEmail && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: "8px",
                  }}
                  data-testid="checkbox-investigator-email"
                >
                  <Checkbox
                    id="invoice-investigator-email-checkbox"
                    checked={selectedEmails.includes(caseData.investigatorEmail)}
                    onCheckedChange={() => toggleEmail(caseData.investigatorEmail!)}
                  />
                  <label
                    htmlFor="invoice-investigator-email-checkbox"
                    style={{
                      fontFamily: "'Pretendard'",
                      fontStyle: "normal",
                      fontWeight: 400,
                      fontSize: "13px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "rgba(12, 12, 12, 0.8)",
                      cursor: "pointer",
                    }}
                  >
                    조사자 이메일: {caseData.investigatorEmail}
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Email Input */}
          <input
            type="email"
            value={invoiceRecipientEmail}
            onChange={(e) => {
              setInvoiceRecipientEmail(e.target.value);
              setSelectedEmails([]);
            }}
            placeholder="보험사 이메일 주소를 입력해주세요"
            style={{
              flex: 1,
              fontFamily: "'Pretendard'",
              fontStyle: "normal",
              fontWeight: 400,
              fontSize: "14px",
              lineHeight: "128%",
              letterSpacing: "-0.01em",
              color: "#0C0C0C",
              background: "rgba(12, 12, 12, 0.04)",
              border: "1px solid rgba(12, 12, 12, 0.1)",
              borderRadius: "8px",
              padding: "10px 12px",
              outline: "none",
            }}
            data-testid="input-recipient-email"
          />
        </div>

        {/* Footer */}
        <div style={{
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          padding: "20px 38px",
          gap: "10px",
          width: "680px",
          borderTop: "1px solid rgba(12, 12, 12, 0.1)",
        }}>
          <div style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "flex-end",
            alignItems: "center",
            padding: "0px",
            gap: "8px",
            width: "604px",
            height: "40px",
          }}>
            {/* PDF 다운로드 Button */}
            <button
              onClick={handleDownloadPdf}
              disabled={isDownloadingPdf}
              style={{
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "row",
                justifyContent: "center",
                alignItems: "center",
                padding: "10px 16px",
                gap: "10px",
                minWidth: "100px",
                height: "40px",
                border: "1px solid rgba(12, 12, 12, 0.1)",
                borderRadius: "8px",
                background: "transparent",
                cursor: isDownloadingPdf ? "not-allowed" : "pointer",
                opacity: isDownloadingPdf ? 0.5 : 1,
                whiteSpace: "nowrap",
              }}
              data-testid="button-invoice-download-pdf">
              <span style={{
                fontFamily: "'Pretendard'",
                fontStyle: "normal",
                fontWeight: 600,
                fontSize: "16px",
                lineHeight: "128%",
                letterSpacing: "-0.02em",
                color: "#0C0C0C",
                whiteSpace: "nowrap",
              }}>
                {isDownloadingPdf ? "다운로드 중..." : "PDF 다운로드"}
              </span>
            </button>

            {/* PDF 발송 Button */}
            <button
              onClick={handleSendInvoicePdf}
              disabled={isSendingPdf || !invoiceRecipientEmail}
              style={{
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "row",
                justifyContent: "center",
                alignItems: "center",
                padding: "10px 16px",
                gap: "10px",
                minWidth: "100px",
                height: "40px",
                border: "1px solid rgba(12, 12, 12, 0.1)",
                borderRadius: "8px",
                background: "transparent",
                cursor: isSendingPdf || !invoiceRecipientEmail ? "not-allowed" : "pointer",
                opacity: isSendingPdf || !invoiceRecipientEmail ? 0.5 : 1,
                whiteSpace: "nowrap",
              }}
              data-testid="button-invoice-pdf">
              <span style={{
                fontFamily: "'Pretendard'",
                fontStyle: "normal",
                fontWeight: 600,
                fontSize: "16px",
                lineHeight: "128%",
                letterSpacing: "-0.02em",
                color: "#008FED",
                whiteSpace: "nowrap",
              }}>
                {isSendingPdf ? "발송 중..." : "PDF 발송"}
              </span>
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
