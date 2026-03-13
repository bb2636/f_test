import { useState, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { User, Case } from "@shared/schema";
import { Calendar as CalendarIcon, Clock, X, Plus, Check, Pencil, RotateCcw, Minus, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCaseNumber } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const normalizeBoolean = (value: any): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
};

export default function FieldManagement() {
  const { toast } = useToast();
  const [selectedCase, setSelectedCase] = useState<string>(() => {
    const rawCaseId = localStorage.getItem('selectedFieldSurveyCaseId');
    return (rawCaseId && rawCaseId !== 'null' && rawCaseId !== 'undefined') ? rawCaseId : "";
  });
  
  const [accidentDate, setAccidentDate] = useState<Date | undefined>(undefined);
  const [accidentTime, setAccidentTime] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  
  const [visitDate, setVisitDate] = useState<Date | undefined>(undefined);
  const [visitTime, setVisitTime] = useState("");
  const [visitDatePickerOpen, setVisitDatePickerOpen] = useState(false);
  const [dispatchLocation, setDispatchLocation] = useState("");
  const [accompaniedPerson, setAccompaniedPerson] = useState("");
  const [accidentCategory, setAccidentCategory] = useState("");
  const [accidentCause, setAccidentCause] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");
  const [victimName, setVictimName] = useState("");
  const [victimContact, setVictimContact] = useState("");
  const [victimAddress, setVictimAddress] = useState("");
  const [victimAddressDetail, setVictimAddressDetail] = useState("");
  const [additionalVictims, setAdditionalVictims] = useState<Array<{name: string, phone: string, address: string}>>([]);
  const [voc, setVoc] = useState("");
  
  const [newVictimName, setNewVictimName] = useState("");
  const [newVictimContact, setNewVictimContact] = useState("");
  const [newVictimAddress, setNewVictimAddress] = useState("");
  const [newVictimAddressDetail, setNewVictimAddressDetail] = useState("");
  const [sameAsInsured, setSameAsInsured] = useState(false);
  
  const [editVictimDialogOpen, setEditVictimDialogOpen] = useState(false);
  const [editingVictimCase, setEditingVictimCase] = useState<Case | null>(null);
  const [editVictimName, setEditVictimName] = useState("");
  const [editVictimContact, setEditVictimContact] = useState("");
  const [editVictimAddress, setEditVictimAddress] = useState("");
  const [editVictimAddressDetail, setEditVictimAddressDetail] = useState("");
  const [isEditingVictim, setIsEditingVictim] = useState(false);
  const [originalVictimName, setOriginalVictimName] = useState("");
  const [originalVictimContact, setOriginalVictimContact] = useState("");
  const [originalVictimAddress, setOriginalVictimAddress] = useState("");
  const [originalVictimAddressDetail, setOriginalVictimAddressDetail] = useState("");
  
  const [processingTypes, setProcessingTypes] = useState<Set<string>>(new Set());
  const [processingTypeOther, setProcessingTypeOther] = useState("");
  const [recoveryMethodType, setRecoveryMethodType] = useState("부분수리");
  
  const [leakTypes, setLeakTypes] = useState<Set<string>>(new Set());
  const [leakTypeOther, setLeakTypeOther] = useState("");

  const isUserTypingRef = useRef(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();

  const caseSelectTriggerRef = useRef<HTMLButtonElement>(null);
  const accidentDateTriggerRef = useRef<HTMLButtonElement>(null);
  const visitDateTriggerRef = useRef<HTMLButtonElement>(null);
  
  const lastLoadedCaseIdRef = useRef<string | null>(null);

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const { data: allCases, isLoading: casesLoading } = useQuery<Case[]>({
    queryKey: ["/api/cases"],
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
  });

  const { data: drawingData, isLoading: isLoadingDrawing } = useQuery({
    queryKey: ["/api/drawings", "case", selectedCase],
    enabled: !!selectedCase,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
  });

  const { data: documentsData, isLoading: isLoadingDocuments } = useQuery({
    queryKey: ["/api/documents/case", selectedCase],
    enabled: !!selectedCase,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
  });

  const { data: estimateData, isLoading: isLoadingEstimate } = useQuery({
    queryKey: ["/api/estimates", selectedCase, "latest"],
    enabled: !!selectedCase,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000,
  });

  const { data: selectedCaseDetail, isLoading: isLoadingSelectedCaseDetail } = useQuery<Case>({
    queryKey: [`/api/cases/${selectedCase}`],
    enabled: !!selectedCase,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000,
  });

  if (!user) {
    return null;
  }

  const isPartner = user.role === "협력사";
  const isAdmin = user.role === "관리자";

  const availableCases = useMemo(() => {
    return isPartner 
      ? allCases?.filter(c => c.assignedPartner === user.company) || []
      : allCases || [];
  }, [isPartner, allCases, user.company]);

  const selectedCaseData = useMemo(() => {
    if (selectedCaseDetail) return selectedCaseDetail;
    if (!selectedCase || !availableCases) return null;
    return availableCases.find(c => c.id === selectedCase) || null;
  }, [selectedCase, availableCases, selectedCaseDetail]);

  const relatedCases = useMemo(() => {
    if (!availableCases || !selectedCaseData) return [];
    
    // 1순위: 사고번호로 조회, 2순위: 증권번호로 조회
    if (selectedCaseData.insuranceAccidentNo) {
      return availableCases
        .filter(c => c.insuranceAccidentNo === selectedCaseData.insuranceAccidentNo)
        .sort((a, b) => (a.caseNumber || "").localeCompare(b.caseNumber || ""));
    } else if (selectedCaseData.insurancePolicyNo) {
      return availableCases
        .filter(c => c.insurancePolicyNo === selectedCaseData.insurancePolicyNo)
        .sort((a, b) => (a.caseNumber || "").localeCompare(b.caseNumber || ""));
    }
    
    return [];
  }, [selectedCaseData, availableCases]);

  useEffect(() => {
    if (!selectedCaseData) return;
    
    console.log("=== 현장조사 케이스 데이터 체크 ===");
    console.log("접수번호:", selectedCaseData.caseNumber);
    
    const missingFields: string[] = [];
    
    if (!selectedCaseData.assignedPartner) missingFields.push("접수사 (협력사)");
    if (!selectedCaseData.assignedPartnerManager) missingFields.push("협력사 담당자명");
    if (!selectedCaseData.assignedPartnerContact) missingFields.push("협력사 담당자 연락처");
    if (!(selectedCaseData as any).managerName) missingFields.push("당사 담당자명");
    
    if (!selectedCaseData.insuranceCompany) missingFields.push("보험사");
    if (!selectedCaseData.insurancePolicyNo) missingFields.push("증권번호");
    if (!selectedCaseData.insuranceAccidentNo) missingFields.push("사고접수번호");
    
    if (!selectedCaseData.policyHolderName) missingFields.push("보험계약자");
    if (!selectedCaseData.insuredName) missingFields.push("피보험자");
    if (!selectedCaseData.insuredContact) missingFields.push("피보험자 연락처");
    
    if (!selectedCaseData.victimName) missingFields.push("피해자 성명");
    if (!selectedCaseData.victimContact) missingFields.push("피해자 연락처");
    
    if (missingFields.length > 0) {
      console.warn("⚠️ 누락된 정보:", missingFields.join(", "));
    } else {
      console.log("✅ 모든 기본 정보가 입력되어 있습니다.");
    }
    
    console.log("================================");
  }, [selectedCaseData?.id]);

  const canEdit = isPartner || isAdmin;
  const isSubmitted = selectedCaseData?.fieldSurveyStatus === "submitted";
  const isRejected = selectedCaseData?.status === "반려";
  const isReadOnly = !canEdit || (isPartner && isSubmitted && !isRejected);

  const isFieldInputComplete = useMemo(() => {
    const hasVisitDate = visitDate || selectedCaseData?.visitDate;
    const hasVisitTime = visitTime || selectedCaseData?.visitTime;
    const hasAccidentCategory = !!accidentCategory;
    const hasVictimName = victimName || selectedCaseData?.victimName;
    
    return !!(hasVisitDate && hasVisitTime && hasAccidentCategory && hasVictimName);
  }, [visitDate, visitTime, accidentCategory, victimName, selectedCaseData?.visitDate, selectedCaseData?.visitTime, selectedCaseData?.victimName]);

  const isDrawingComplete = useMemo(() => {
    return !isLoadingDrawing && !!drawingData && typeof drawingData === 'object' && 'id' in drawingData;
  }, [drawingData, isLoadingDrawing]);

  const isDocumentsComplete = useMemo(() => {
    return !isLoadingDocuments && Array.isArray(documentsData) && documentsData.length > 0;
  }, [documentsData, isLoadingDocuments]);

  const isEstimateComplete = useMemo(() => {
    return !isLoadingEstimate && !!estimateData && typeof estimateData === 'object' && 'id' in estimateData;
  }, [estimateData, isLoadingEstimate]);

  const canSubmit = isFieldInputComplete;

  const availableCaseIds = useMemo(() => {
    return availableCases.map(c => c.id).join(',');
  }, [availableCases]);

  useEffect(() => {
    // selectedCaseDetail이 아직 로딩 중이면 자동 선택을 하지 않음
    // 이는 "관련접수건 전환"으로 선택한 케이스가 로딩 완료될 때까지 기다림
    if (selectedCase && isLoadingSelectedCaseDetail) {
      return;
    }
    
    // selectedCaseDetail이 있으면 (직접 API로 조회 성공) 리셋하지 않음
    // 이는 "관련접수건 전환"으로 선택한 케이스가 availableCases에 없어도 유지되게 함
    if (selectedCase && selectedCaseDetail) {
      return;
    }
    
    if (availableCases.length === 0) {
      if (selectedCase && !selectedCaseDetail && !isLoadingSelectedCaseDetail) {
        setSelectedCase("");
        localStorage.removeItem('selectedFieldSurveyCaseId');
      }
      return;
    }

    const isCurrentCaseAvailable = selectedCase && availableCases.some(c => c.id === selectedCase);
    
    if (!isCurrentCaseAvailable && !selectedCaseDetail && !isLoadingSelectedCaseDetail) {
      const newCaseId = availableCases[0].id;
      setSelectedCase(newCaseId);
      localStorage.setItem('selectedFieldSurveyCaseId', newCaseId);
    }
  }, [availableCaseIds, selectedCase, selectedCaseDetail, isLoadingSelectedCaseDetail]);

  const handleCaseChange = (caseId: string) => {
    setSelectedCase(caseId);
    localStorage.setItem('selectedFieldSurveyCaseId', caseId);
  };

  const [autoReviewUpdated, setAutoReviewUpdated] = useState<Set<string>>(new Set());
  
  useEffect(() => {
    const autoUpdateToReview = async () => {
      if (!selectedCaseData || !isAdmin || !selectedCase) return;
      
      if (autoReviewUpdated.has(selectedCase)) return;
      
      if (selectedCaseData.status === "현장정보 입력") {
        try {
          await apiRequest("PATCH", `/api/cases/${selectedCaseData.id}/field-survey`, {
            status: "검토중",
          });
          
          setAutoReviewUpdated(prev => {
            const updated = new Set(Array.from(prev));
            updated.add(selectedCase);
            return updated;
          });
          
          queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
        } catch (error) {
          console.error("상태 자동 변경 실패:", error);
        }
      }
    };

    autoUpdateToReview();
  }, [selectedCase, isAdmin]);

  const [visitStatusUpdated, setVisitStatusUpdated] = useState<Set<string>>(new Set());
  
  useEffect(() => {
    const autoUpdateToVisit = async () => {
      if (!selectedCaseData || !selectedCase) return;
      
      if (isReadOnly) return;
      
      if (visitStatusUpdated.has(selectedCase)) return;
      
      if (!visitDate || !visitTime) return;
      
      const eligibleStatuses = ["협력사 배정", "접수완료", "배당완료"];
      if (!eligibleStatuses.includes(selectedCaseData.status || "")) return;
      
      try {
        console.log(`[Auto Status] 방문일시 입력됨 - 상태를 '현장방문'으로 변경: ${selectedCaseData.caseNumber}`);
        await apiRequest("PATCH", `/api/cases/${selectedCaseData.id}/field-survey`, {
          status: "현장방문",
          visitDate: format(visitDate, "yyyy-MM-dd"),
          visitTime: visitTime,
        });
        
        setVisitStatusUpdated(prev => {
          const updated = new Set(Array.from(prev));
          updated.add(selectedCase);
          return updated;
        });
        
        queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
        
        toast({
          title: "상태 변경됨",
          description: "방문일시 입력으로 '현장방문' 상태로 변경되었습니다.",
        });
      } catch (error) {
        console.error("현장방문 상태 자동 변경 실패:", error);
      }
    };

    autoUpdateToVisit();
  }, [selectedCase, visitDate, visitTime, selectedCaseData?.status]);

  const handleUserInput = () => {
    isUserTypingRef.current = true;
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      isUserTypingRef.current = false;
    }, 2000);
  };

  const handleOpenEditVictimDialog = async (caseItem: Case) => {
    setEditingVictimCase(caseItem);
    
    console.log(`[피해자 수정] 다이얼로그 열기: caseItem.id=${caseItem.id}`);
    console.log(`[피해자 수정] caseItem 데이터:`, {
      victimName: caseItem.victimName,
      victimContact: caseItem.victimContact,
      victimAddress: caseItem.victimAddress,
      victimAddressDetail: caseItem.victimAddressDetail,
    });
    
    // 모든 피해세대 케이스(-1, -2, -3 등)는 victimAddress + victimAddressDetail 사용
    if (caseItem.id === selectedCase && selectedCaseDetail) {
      console.log(`[피해자 수정] selectedCaseDetail 사용:`, {
        victimName: selectedCaseDetail.victimName,
        victimContact: selectedCaseDetail.victimContact,
        victimAddress: selectedCaseDetail.victimAddress,
        victimAddressDetail: selectedCaseDetail.victimAddressDetail,
      });
      
      setEditVictimName(selectedCaseDetail.victimName || "");
      setEditVictimContact(selectedCaseDetail.victimContact || "");
      setEditVictimAddress(selectedCaseDetail.victimAddress || "");
      setEditVictimAddressDetail(selectedCaseDetail.victimAddressDetail || "");
      
      setOriginalVictimName(victimName);
      setOriginalVictimContact(victimContact);
      setOriginalVictimAddress(victimAddress);
      setOriginalVictimAddressDetail(victimAddressDetail);
      
      setEditVictimDialogOpen(true);
    } else {
      try {
        const response = await fetch(`/api/cases/${caseItem.id}`);
        if (response.ok) {
          const caseData = await response.json();
          console.log(`[피해자 수정] API 응답:`, {
            victimName: caseData.victimName,
            victimContact: caseData.victimContact,
            victimAddress: caseData.victimAddress,
            victimAddressDetail: caseData.victimAddressDetail,
          });
          
          setEditVictimName(caseData.victimName || "");
          setEditVictimContact(caseData.victimContact || "");
          setEditVictimAddress(caseData.victimAddress || "");
          setEditVictimAddressDetail(caseData.victimAddressDetail || "");
        } else {
          console.log(`[피해자 수정] API 실패, caseItem 데이터 사용`);
          
          setEditVictimName(caseItem.victimName || "");
          setEditVictimContact(caseItem.victimContact || "");
          setEditVictimAddress(caseItem.victimAddress || "");
          setEditVictimAddressDetail(caseItem.victimAddressDetail || "");
        }
      } catch (error) {
        console.error("케이스 조회 실패:", error);
        
        setEditVictimName(caseItem.victimName || "");
        setEditVictimContact(caseItem.victimContact || "");
        setEditVictimAddress(caseItem.victimAddress || "");
        setEditVictimAddressDetail(caseItem.victimAddressDetail || "");
      }
      setEditVictimDialogOpen(true);
    }
  };

  const handleSaveEditVictim = async () => {
    if (!editingVictimCase) return;
    
    setIsEditingVictim(true);
    try {
      // 모든 피해세대 케이스(-1, -2, -3 등)는 victimAddress + victimAddressDetail 사용
      const patchData = {
        victimName: editVictimName,
        victimContact: editVictimContact,
        victimAddress: editVictimAddress,
        victimAddressDetail: editVictimAddressDetail,
      };
      
      await apiRequest("PATCH", `/api/cases/${editingVictimCase.id}`, patchData);
      
      if (editingVictimCase.id === selectedCase) {
        setVictimName(editVictimName);
        setVictimContact(editVictimContact);
        setVictimAddress(editVictimAddress);
        setVictimAddressDetail(editVictimAddressDetail);
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${editingVictimCase.id}`] });
      
      toast({
        title: "저장 완료",
        description: "피해자 정보가 수정되었습니다.",
      });
      
      setEditVictimDialogOpen(false);
      setEditingVictimCase(null);
    } catch (error) {
      console.error("피해자 정보 수정 실패:", error);
      toast({
        title: "저장 실패",
        description: "피해자 정보 수정 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsEditingVictim(false);
    }
  };

  useEffect(() => {
    if (isUserTypingRef.current) {
      console.log(`[Load Skip] 사용자 입력 중 - 데이터 로드 스킵: ${selectedCase}`);
      return;
    }

    if (!selectedCaseData || !selectedCase) {
      lastLoadedCaseIdRef.current = null;
      return;
    }

    if (lastLoadedCaseIdRef.current === selectedCase) {
      return;
    }

    lastLoadedCaseIdRef.current = selectedCase;
    console.log(`[Load Data] 케이스 데이터 로드: ${selectedCase}, caseNumber: ${selectedCaseData.caseNumber}`);

    if (selectedCaseData.visitDate) {
      try {
        setVisitDate(new Date(selectedCaseData.visitDate));
      } catch (e) {
        setVisitDate(undefined);
      }
    } else {
      setVisitDate(undefined);
    }
    setVisitTime(selectedCaseData.visitTime || "");

    if (selectedCaseData.accidentDate) {
      try {
        const accDateStr = selectedCaseData.accidentDate;
        if (accDateStr.includes(' ')) {
          const [datePart, timePart] = accDateStr.split(' ');
          setAccidentDate(new Date(datePart));
          setAccidentTime(timePart || "");
        } else {
          setAccidentDate(new Date(accDateStr));
          setAccidentTime("");
        }
      } catch (e) {
        setAccidentDate(undefined);
        setAccidentTime("");
      }
    } else {
      setAccidentDate(undefined);
      setAccidentTime("");
    }

    setAccompaniedPerson(selectedCaseData.accompaniedPerson || "");
    setDispatchLocation(selectedCaseData.dispatchLocation || "");

    setAccidentCategory(selectedCaseData.accidentCategory || "");
    setAccidentCause(selectedCaseData.accidentCause || "");
    setSpecialNotes(selectedCaseData.specialNotes || "");

    setVictimName(selectedCaseData.victimName || "");
    setVictimContact(selectedCaseData.victimContact || "");
    setVictimAddress(selectedCaseData.victimAddress || "");
    setVictimAddressDetail(selectedCaseData.victimAddressDetail || "");
    
    if (selectedCaseData.additionalVictims) {
      try {
        const parsed = JSON.parse(selectedCaseData.additionalVictims);
        setAdditionalVictims(Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        console.error("Error parsing additionalVictims:", e);
        setAdditionalVictims([]);
      }
    } else {
      setAdditionalVictims([]);
    }

    setVoc((selectedCaseData as any).vocContent || "");

    if (selectedCaseData.processingTypes) {
      try {
        const parsed = JSON.parse(selectedCaseData.processingTypes);
        setProcessingTypes(new Set(Array.isArray(parsed) ? parsed : []));
      } catch (e) {
        console.error("Error parsing processingTypes:", e);
        setProcessingTypes(new Set());
      }
    } else {
      setProcessingTypes(new Set());
    }
    setProcessingTypeOther(selectedCaseData.processingTypeOther || "");
    
    setRecoveryMethodType(selectedCaseData.recoveryMethodType || "부분수리");
    
    // 누수유형 로드: 콤마로 구분된 값을 파싱하고 기타(값) 형태에서 값 추출
    if (selectedCaseData.accidentCategory) {
      const types = selectedCaseData.accidentCategory.split(",").map(t => t.trim());
      const parsedTypes: string[] = [];
      let otherValue = "";
      
      types.forEach(type => {
        const otherMatch = type.match(/^기타\((.+)\)$/);
        if (otherMatch) {
          parsedTypes.push("기타");
          otherValue = otherMatch[1];
        } else {
          parsedTypes.push(type);
        }
      });
      
      setLeakTypes(new Set(parsedTypes));
      setLeakTypeOther(otherValue);
    } else {
      setLeakTypes(new Set());
      setLeakTypeOther("");
    }

  }, [selectedCase]);

  const handleReset = () => {
    if (!selectedCaseData) return;
    
    if (selectedCaseData.visitDate) {
      try {
        setVisitDate(new Date(selectedCaseData.visitDate));
      } catch (e) {
        setVisitDate(undefined);
      }
    } else {
      setVisitDate(undefined);
    }
    setVisitTime(selectedCaseData.visitTime || "");
    
    setAccidentCategory(selectedCaseData.accidentCategory || "");
    setAccidentCause(selectedCaseData.accidentCause || "");
    
    setVictimName(selectedCaseData.victimName || "");
    setVictimContact(selectedCaseData.victimContact || "");
    setVictimAddress(selectedCaseData.victimAddress || "");
    setVictimAddressDetail(selectedCaseData.victimAddressDetail || "");
    
    setVoc((selectedCaseData as any).vocContent || "");
    
    if (selectedCaseData.processingTypes) {
      try {
        const parsed = JSON.parse(selectedCaseData.processingTypes);
        setProcessingTypes(new Set(Array.isArray(parsed) ? parsed : []));
      } catch (e) {
        setProcessingTypes(new Set());
      }
    } else {
      setProcessingTypes(new Set());
    }
    setProcessingTypeOther(selectedCaseData.processingTypeOther || "");
    
    setRecoveryMethodType(selectedCaseData.recoveryMethodType || "부분수리");
    
    setNewVictimName("");
    setNewVictimContact("");
    setNewVictimAddress("");
    setNewVictimAddressDetail("");
    setSameAsInsured(false);
    
    // 누수유형 로드: 콤마로 구분된 값을 파싱하고 기타(값) 형태에서 값 추출
    if (selectedCaseData.accidentCategory) {
      const types = selectedCaseData.accidentCategory.split(",").map(t => t.trim());
      const parsedTypes: string[] = [];
      let otherValue = "";
      
      types.forEach(type => {
        const otherMatch = type.match(/^기타\((.+)\)$/);
        if (otherMatch) {
          parsedTypes.push("기타");
          otherValue = otherMatch[1];
        } else {
          parsedTypes.push(type);
        }
      });
      
      setLeakTypes(new Set(parsedTypes));
      setLeakTypeOther(otherValue);
    } else {
      setLeakTypes(new Set());
      setLeakTypeOther("");
    }
    
    toast({
      title: "초기화 완료",
      description: "입력 내용이 초기화되었습니다.",
    });
  };

  const handleSave = async () => {
    console.log("=== 제출 조건 체크 (임시저장) ===");
    console.log("현장입력 완료:", isFieldInputComplete);
    console.log("제출 가능:", canSubmit);
    console.log("누수유형 선택:", Array.from(leakTypes));
    console.log("누수유형 기타 입력값:", leakTypeOther);
    console.log("================================");
    
    if (!selectedCaseData?.id) {
      toast({
        title: "저장 실패",
        description: "선택된 접수건이 없습니다.",
        variant: "destructive",
      });
      return;
    }

    const missingFields: string[] = [];
    if (!visitDate) missingFields.push("방문일자");
    if (!visitTime) missingFields.push("방문시간");
    if (!accidentCategory && leakTypes.size === 0) missingFields.push("카테고리");
    if (!victimName && !selectedCaseData?.victimName) missingFields.push("피해자 성명");
    if (!victimContact && !selectedCaseData?.victimContact) missingFields.push("피해자 연락처");
    
    if (missingFields.length > 0) {
      console.warn("⚠️ 임시저장 - 누락된 필드 (저장은 진행됨):", missingFields.join(", "));
    }

    try {
      let status = "현장방문";
      
      const hasVictimName = victimName || selectedCaseData?.victimName;
      // 누수유형: 모든 선택된 타입을 저장하고, 기타인 경우 입력값도 포함
      let categoryToSave = "";
      if (leakTypes.size > 0) {
        const selectedTypes = Array.from(leakTypes);
        // "기타"가 선택되었고 입력값이 있으면 "기타(입력값)" 형태로 저장
        const typesWithOther = selectedTypes.map(type => 
          type === "기타" && leakTypeOther ? `기타(${leakTypeOther})` : type
        );
        categoryToSave = typesWithOther.join(",");
      } else if (accidentCategory) {
        categoryToSave = accidentCategory;
      }
      if (visitDate && visitTime && categoryToSave && hasVictimName) {
        status = "현장정보 입력";
      }

      const payload = {
        visitDate: visitDate ? format(visitDate, "yyyy-MM-dd") : null,
        visitTime,
        dispatchLocation,
        accompaniedPerson,
        accidentDate: accidentDate ? `${format(accidentDate, "yyyy-MM-dd")} ${accidentTime || "00:00"}` : null,
        accidentTime,
        accidentCategory: categoryToSave || null,
        accidentCause,
        vocContent: voc,
        victimName: victimName || selectedCaseData?.victimName || null,
        victimContact: victimContact || selectedCaseData?.victimContact || null,
        victimAddress: victimAddress || selectedCaseData?.victimAddress || null,
        victimAddressDetail: victimAddressDetail || selectedCaseData?.victimAddressDetail || null,
        additionalVictims: JSON.stringify(additionalVictims),
        processingTypes: JSON.stringify(Array.from(processingTypes)),
        processingTypeOther,
        recoveryMethodType,
        fieldSurveyStatus: "draft",
        status,
      };

      console.log("=== 저장 페이로드 ===");
      console.log("accidentCategory 저장값:", categoryToSave);
      console.log("payload:", JSON.stringify(payload, null, 2));
      console.log("=====================");

      const data = await apiRequest("PATCH", `/api/cases/${selectedCaseData.id}/field-survey`, payload);

      const syncedCases = (data as any)?.syncedCases || 0;
      const syncMessage = syncedCases > 0 
        ? ` (${syncedCases}건의 연관 케이스에도 동기화됨)`
        : "";

      // 관리자인 경우 status/fieldSurveyStatus 변경이 무시되므로 다른 메시지 표시
      if (isAdmin) {
        toast({
          title: "저장 완료",
          description: `현장조사 정보가 저장되었습니다.${syncMessage}`,
        });
      } else {
        toast({
          title: "임시저장 완료",
          description: `현장조사 정보가 임시저장되었습니다. (상태: ${status})${syncMessage}`,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-surveys", selectedCaseData.id, "report"] });
    } catch (error: any) {
      console.error("임시저장 에러:", error);
      
      let errorMessage = "현장조사 정보 임시저장 중 오류가 발생했습니다.";
      if (error?.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: "임시저장 실패",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleAddNewVictim = async () => {
    if (newVictimName && newVictimContact && newVictimAddress && selectedCaseData) {
      try {
        const parentCaseNumber = selectedCaseData.caseNumber || "";
        const casePrefix = parentCaseNumber.split('-')[0];
        
        const newCasePayload = {
          parentCasePrefix: casePrefix,
          receptionDate: selectedCaseData.receptionDate,
          accidentDate: selectedCaseData.accidentDate,
          insuranceCompany: selectedCaseData.insuranceCompany,
          insurancePolicyNo: selectedCaseData.insurancePolicyNo,
          insuranceAccidentNo: selectedCaseData.insuranceAccidentNo,
          clientResidence: selectedCaseData.clientResidence,
          clientDepartment: selectedCaseData.clientDepartment,
          clientName: selectedCaseData.clientName,
          clientContact: selectedCaseData.clientContact,
          assessorId: selectedCaseData.assessorId,
          assessorDepartment: selectedCaseData.assessorDepartment,
          assessorTeam: selectedCaseData.assessorTeam,
          assessorContact: selectedCaseData.assessorContact,
          investigatorTeam: selectedCaseData.investigatorTeam,
          investigatorDepartment: selectedCaseData.investigatorDepartment,
          investigatorTeamName: selectedCaseData.investigatorTeamName,
          investigatorContact: selectedCaseData.investigatorContact,
          policyHolderName: selectedCaseData.policyHolderName,
          policyHolderIdNumber: selectedCaseData.policyHolderIdNumber,
          policyHolderAddress: selectedCaseData.policyHolderAddress,
          insuredName: selectedCaseData.insuredName,
          insuredIdNumber: selectedCaseData.insuredIdNumber,
          insuredContact: selectedCaseData.insuredContact,
          insuredAddress: selectedCaseData.insuredAddress,
          insuredAddressDetail: selectedCaseData.insuredAddressDetail,
          sameAsPolicyHolder: selectedCaseData.sameAsPolicyHolder,
          victimName: newVictimName,
          victimContact: newVictimContact,
          victimAddress: newVictimAddress,
          victimAddressDetail: newVictimAddressDetail,
          damageItems: "[]",
          processingTypes: JSON.stringify(["피해세대복구"]),
          victimIncidentAssistance: "true",
          damagePreventionCost: "false",
          managerId: selectedCaseData.managerId,
          assignedPartner: selectedCaseData.assignedPartner,
          assignmentDate: selectedCaseData.assignmentDate,
          recoveryType: selectedCaseData.recoveryType,
          status: "접수완료",
          progressStatus: null,
          reviewDecision: null,
          reviewComment: null,
          reviewedAt: null,
          reviewedBy: null,
          visitDate: null,
          visitTime: null,
          fieldSurveyStatus: "draft",
          accompaniedPerson: null,
          travelDistance: null,
          dispatchLocation: null,
          accidentTime: null,
          accidentCategory: null,
          processingTypeOther: null,
          recoveryMethodType: null,
          clientPhone: null,
          clientAddress: null,
          accidentLocation: null,
          accidentDescription: null,
          accidentType: null,
          accidentCause: null,
          restorationMethod: null,
          otherVendorEstimate: null,
          additionalVictims: "[]",
          assignedPartnerManager: null,
          assignedPartnerContact: null,
          urgency: null,
          specialRequests: null,
          specialNotes: null,
          specialNotesConfirmedBy: null,
          additionalNotes: null,
          estimateAmount: null,
          assignedTo: selectedCaseData.assignedTo,
          inspectionDate: null,
          siteVisitDate: null,
          fieldSurveyDate: null,
          siteInvestigationSubmitDate: null,
          firstInspectionDate: null,
          firstApprovalDate: null,
          secondApprovalDate: null,
          firstInvoiceDate: null,
          approvalRequestDate: null,
          approvalDate: null,
          approvalCompletionDate: null,
          constructionStartDate: null,
          constructionCompletionDate: null,
          constructionReportSubmitDate: null,
          totalWorkDate: null,
          contractorReportDate: null,
          contractorRepairDate: null,
          completionDate: null,
          claimDate: null,
        };
        
        console.log("🏠 New Victim Payload Debug:");
        console.log("  - victimName:", newVictimName);
        console.log("  - victimAddress:", newVictimAddress);
        console.log("  - victimAddressDetail:", newVictimAddressDetail);
        console.log("  - sameAsInsured:", sameAsInsured);
        console.log("  - insuredAddress:", selectedCaseData.insuredAddress);
        console.log("  - insuredAddressDetail:", selectedCaseData.insuredAddressDetail);
        
        await apiRequest("POST", "/api/cases", newCasePayload);
        
        toast({
          title: "추가 피해자 등록 완료",
          description: `${newVictimName} 님의 케이스가 생성되었습니다.`,
        });
        
        setNewVictimName("");
        setNewVictimContact("");
        setNewVictimAddress("");
        setNewVictimAddressDetail("");
        setSameAsInsured(false);
        
        queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      } catch (error) {
        toast({
          title: "케이스 생성 실패",
          description: error instanceof Error ? error.message : "케이스 생성 중 오류가 발생했습니다.",
          variant: "destructive",
        });
      }
    }
  };

  const toggleLeakType = (type: string) => {
    const newLeakTypes = new Set(leakTypes);
    if (newLeakTypes.has(type)) {
      newLeakTypes.delete(type);
    } else {
      newLeakTypes.add(type);
    }
    setLeakTypes(newLeakTypes);
    if (newLeakTypes.size > 0) {
      setAccidentCategory(Array.from(newLeakTypes)[0]);
    } else {
      setAccidentCategory("");
    }
  };

  const toggleProcessingType = (type: string) => {
    const newTypes = new Set(processingTypes);
    if (newTypes.has(type)) {
      newTypes.delete(type);
    } else {
      newTypes.add(type);
    }
    setProcessingTypes(newTypes);
  };

  return (
    <>
      <div className="flex-1 py-6 pl-8">
        <div className="text-[18px] font-bold" data-testid="page-title">현장입력</div>

        {casesLoading ? (
          <div className="text-center py-8 text-[#6B7280]">접수건을 불러오는 중...</div>
        ) : !selectedCaseData ? (
          <div className="text-center py-8 text-[#6B7280]">
            {isPartner ? "배당된 접수건이 없습니다." : "선택된 접수건이 없습니다."}
          </div>
        ) : (
          <>
            <div className="mt-4 text-[12px] font-semibold text-[#6B7280]">작성중인 접수건</div>

            <div className="mt-2 rounded-lg bg-[#F3F6FA] px-4 py-3" data-testid="selected-case-info">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <span className="inline-flex h-2 w-2 rounded-full bg-[#008FED]"></span>
                <span>{selectedCaseData.insuranceCompany || "보험사 미지정"}</span>
                <span className="text-[#6B7280]">
                  {selectedCaseData.insuranceAccidentNo 
                    ? `${selectedCaseData.insuranceAccidentNo}(사고번호)` 
                    : selectedCaseData.insurancePolicyNo 
                      ? `${selectedCaseData.insurancePolicyNo}(증권번호)` 
                      : ""}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-[#6B7280]">
                <span>접수번호 {formatCaseNumber(selectedCaseData.caseNumber) || "-"}</span>
                <span>피보험자 {selectedCaseData.insuredName || "-"}</span>
                <span>담당자 {selectedCaseData.assignedPartnerManager || "-"}</span>
              </div>
            </div>

            <section className="mt-6">
              <div className="text-[14px] font-bold">기본 정보</div>
              <div className="mt-2 border-t border-[#E5E7EB]"></div>

              <div className="mt-10 space-y-10">
                <div className="flex items-center flex-wrap gap-y-4">
                  <div className="text-[12px] text-[#6B7280] w-[100px]">협력사</div>
                  <div className="text-[13px] font-semibold text-[#0C0C0C] min-w-[120px]" data-testid="text-partner">{selectedCaseData.assignedPartner || "-"}</div>

                  <div className="text-[12px] text-[#6B7280] ml-12 w-[80px]">담당자명</div>
                  <div className="text-[13px] font-semibold text-[#0C0C0C] min-w-[100px]" data-testid="text-manager-name">{selectedCaseData.assignedPartnerManager || "-"}</div>

                  <div className="text-[12px] text-[#6B7280] ml-12 w-[100px]">담당자 연락처</div>
                  <div className="text-[13px] font-semibold text-[#0C0C0C]" data-testid="text-manager-contact">{selectedCaseData.assignedPartnerContact || "-"}</div>
                </div>

                <div className="flex items-center flex-wrap gap-y-4">
                  <div className="text-[12px] text-[#6B7280] w-[100px]">보험사 사고번호</div>
                  <div className="text-[13px] font-semibold text-[#0C0C0C] min-w-[120px]" data-testid="text-accident-no">{selectedCaseData.insuranceAccidentNo || "-"}</div>

                  <div className="text-[12px] text-[#6B7280] ml-12 w-[80px]">보험사</div>
                  <div className="text-[13px] font-semibold text-[#0C0C0C]" data-testid="text-insurance-company">{selectedCaseData.insuranceCompany || "-"}</div>
                </div>

                <div className="flex items-center flex-wrap gap-y-4">
                  <div className="text-[12px] text-[#6B7280] w-[100px]">보험계약자</div>
                  <div className="text-[13px] font-semibold text-[#0C0C0C] min-w-[120px]" data-testid="text-policyholder">{selectedCaseData.policyHolderName || "-"}</div>

                  <div className="text-[12px] text-[#6B7280] ml-12 w-[80px]">피보험자</div>
                  <div className="text-[13px] font-semibold text-[#0C0C0C] min-w-[100px]" data-testid="text-insured-name">{selectedCaseData.insuredName || "-"}</div>

                  <div className="text-[12px] text-[#6B7280] ml-12 w-[60px]">연락처</div>
                  <div className="text-[13px] font-semibold text-[#0C0C0C]" data-testid="text-insured-contact">{selectedCaseData.insuredContact || "-"}</div>
                </div>

                <div className="flex items-center gap-x-8">
                  <div className="text-[12px] text-[#6B7280]">사고 발생 일시</div>
                  <div className="flex w-full max-w-[440px]">
                    <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen} modal={false}>
                      <PopoverTrigger asChild>
                        <button
                          ref={accidentDateTriggerRef}
                          type="button"
                          className="flex h-11 w-1/2 items-center justify-between rounded-l-md border border-[#E5E7EB] bg-white px-5"
                          disabled={isReadOnly}
                          data-testid="button-accident-date"
                        >
                          <span className={`text-[13px] ${accidentDate ? "text-[#0C0C0C]" : "text-[#9CA3AF]"}`}>
                            {accidentDate ? format(accidentDate, "yyyy.MM.dd", { locale: ko }) : "날짜 선택"}
                          </span>
                          <CalendarIcon className="h-4 w-4 text-[#9CA3AF]" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent 
                        className="w-auto p-0"
                        onOpenAutoFocus={(e) => e.preventDefault()}
                        onCloseAutoFocus={(e) => e.preventDefault()}
                      >
                        <Calendar
                          mode="single"
                          selected={accidentDate}
                          onSelect={(date) => {
                            setAccidentDate(date);
                            setDatePickerOpen(false);
                          }}
                        />
                      </PopoverContent>
                    </Popover>

                    <div className="flex h-11 w-1/2 items-center justify-between rounded-r-md border border-l-0 border-[#E5E7EB] bg-white px-5">
                      <input
                        type="time"
                        value={accidentTime}
                        onChange={(e) => { handleUserInput(); setAccidentTime(e.target.value); }}
                        className="w-full text-[13px] bg-transparent outline-none"
                        disabled={isReadOnly}
                        data-testid="input-accident-time"
                        placeholder="시간 선택"
                      />
                      <Clock className="h-4 w-4 text-[#9CA3AF]" />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="mt-8">
              <div className="text-[14px] font-bold">현장조사 정보</div>
              <div className="mt-3 border-t border-[#E5E7EB]"></div>

              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-[120px] text-[12px] text-[#6B7280]">방문 일시</div>

                  <div className="flex items-center gap-2">
                    <Popover open={visitDatePickerOpen} onOpenChange={setVisitDatePickerOpen} modal={false}>
                      <PopoverTrigger asChild>
                        <button
                          ref={visitDateTriggerRef}
                          type="button"
                          className="flex h-9 w-[180px] items-center justify-between rounded-md border border-[#E5E7EB] bg-white px-3"
                          disabled={isReadOnly}
                          data-testid="button-visit-date"
                        >
                          <span className={`text-[12px] ${visitDate ? "text-[#0C0C0C]" : "text-[#9CA3AF]"}`}>
                            {visitDate ? format(visitDate, "yyyy.MM.dd", { locale: ko }) : "날짜 선택"}
                          </span>
                          <CalendarIcon className="h-4 w-4 text-[#9CA3AF]" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent 
                        className="w-auto p-0"
                        onOpenAutoFocus={(e) => e.preventDefault()}
                        onCloseAutoFocus={(e) => e.preventDefault()}
                      >
                        <Calendar
                          mode="single"
                          selected={visitDate}
                          onSelect={(date) => {
                            setVisitDate(date);
                            setVisitDatePickerOpen(false);
                          }}
                        />
                      </PopoverContent>
                    </Popover>

                    <div className="flex h-9 w-[180px] items-center justify-between rounded-md border border-[#E5E7EB] bg-white px-3">
                      <input
                        type="time"
                        value={visitTime}
                        onChange={(e) => { handleUserInput(); setVisitTime(e.target.value); }}
                        className="w-full text-[12px] bg-transparent outline-none"
                        disabled={isReadOnly}
                        data-testid="input-visit-time"
                      />
                      <Clock className="h-4 w-4 text-[#9CA3AF]" />
                    </div>
                  </div>

                  <div className="ml-2 flex items-center gap-3">
                    <div className="text-[12px] text-[#6B7280]">출동 담당자</div>
                    <input
                      className="h-9 w-[260px] rounded-md border border-[#E5E7EB] px-3 text-[13px] outline-none placeholder:text-[#9CA3AF]"
                      placeholder="출동 담당자"
                      value={selectedCaseData.assignedPartnerManager || ""}
                      readOnly
                      data-testid="input-dispatch-manager"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-[120px] text-[12px] text-[#6B7280]">누수유형</div>

                  <div className="flex flex-wrap items-center gap-6 text-[13px] text-[#374151]">
                    {["배관", "방수", "코킹", "기타"].map((type) => (
                      <label key={type} className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={leakTypes.has(type)}
                          onChange={() => toggleLeakType(type)}
                          disabled={isReadOnly}
                          className="h-4 w-4 accent-[#008FED]"
                          data-testid={`checkbox-leak-type-${type}`}
                        />
                        <span className={leakTypes.has(type) ? "text-[#008FED]" : "text-[#0C0C0C]"}>
                          {type}
                        </span>
                      </label>
                    ))}
                    
                    {leakTypes.has("기타") && (
                      <input
                        type="text"
                        className="h-8 w-[180px] rounded-md border border-[#E5E7EB] px-3 text-[13px] outline-none placeholder:text-[#9CA3AF]"
                        placeholder="기타 누수유형 입력"
                        value={leakTypeOther}
                        onChange={(e) => { handleUserInput(); setLeakTypeOther(e.target.value); }}
                        disabled={isReadOnly}
                        data-testid="input-leak-type-other"
                      />
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="mt-2 w-[120px] text-[12px] text-[#6B7280]">사고원인</div>
                  <textarea
                    className="min-h-[70px] w-full rounded-md border border-[#E5E7EB] p-3 text-[13px] outline-none placeholder:text-[#9CA3AF]"
                    placeholder="사고원인"
                    value={accidentCause}
                    onChange={(e) => { handleUserInput(); setAccidentCause(e.target.value); }}
                    disabled={isReadOnly}
                    data-testid="textarea-accident-cause"
                  />
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-[120px] text-[12px] text-[#6B7280]">처리유형</div>

                  <div className="flex flex-wrap items-center gap-6 text-[13px] text-[#374151]">
                    {["수리", "비교견적", "기타"].map((type) => (
                      <label key={type} className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={processingTypes.has(type)}
                          onChange={() => toggleProcessingType(type)}
                          disabled={isReadOnly}
                          className="h-4 w-4 accent-[#008FED]"
                          data-testid={`checkbox-processing-type-${type}`}
                        />
                        <span className={processingTypes.has(type) ? "text-[#008FED]" : "text-[#0C0C0C]"}>
                          {type}
                        </span>
                      </label>
                    ))}

                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-[#6B7280]">기타사항입력</span>
                      <input
                        className="h-9 w-[260px] rounded-md border border-[#E5E7EB] px-3 text-[13px] outline-none placeholder:text-[#9CA3AF]"
                        placeholder="기타사항"
                        value={processingTypeOther}
                        onChange={(e) => { handleUserInput(); setProcessingTypeOther(e.target.value); }}
                        disabled={isReadOnly}
                        data-testid="input-processing-type-other"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-[120px] text-[12px] text-[#6B7280]">복구방식</div>

                  <div className="flex items-center gap-6 text-[13px] text-[#374151]">
                    {["부분수리", "전체수리"].map((method) => (
                      <label key={method} className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={recoveryMethodType === method}
                          onChange={() => setRecoveryMethodType(method)}
                          disabled={isReadOnly}
                          className="h-4 w-4 accent-[#008FED]"
                          data-testid={`checkbox-recovery-method-${method}`}
                        />
                        <span className={recoveryMethodType === method ? "text-[#008FED]" : "text-[#0C0C0C]"}>
                          {method}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="mt-8">
              <div className="text-[14px] font-bold">동일사고번호 공사대상건</div>

              <div className="mt-3 rounded-lg border border-[#E5E7EB] bg-white">
                <div className="px-4 py-3 text-[13px] font-semibold">총 {relatedCases.length}건</div>
                <div className="border-t border-[#E5E7EB]"></div>

                {relatedCases.map((caseItem, index) => {
                  const isLossPreventionCase = /-0$/.test(caseItem.caseNumber || '');
                  const isSelected = caseItem.id === selectedCaseData?.id;

                  return (
                    <div key={caseItem.id}>
                      {index > 0 && <div className="border-t border-[#E5E7EB]"></div>}
                      <div className={`px-4 py-3 ${isSelected ? "bg-[#F9FAFB]" : ""}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-[13px] font-semibold">
                              {caseItem.insuranceCompany || "-"}
                              <span className="ml-1 text-[#6B7280]">
                                {caseItem.insuranceAccidentNo 
                                  ? `${caseItem.insuranceAccidentNo}(사고번호)` 
                                  : caseItem.insurancePolicyNo 
                                    ? `${caseItem.insurancePolicyNo}(증권번호)` 
                                    : ""}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-[#6B7280]">
                              {(() => {
                                const caseSuffix = parseInt((caseItem.caseNumber || "").split("-")[1] || "0");
                                const isInsuredCase = caseSuffix === 0;
                                
                                let name: string;
                                let contact: string;
                                let detailAddress: string;
                                
                                if (isInsuredCase) {
                                  // -0 케이스: 피보험자 정보 표시
                                  name = caseItem.insuredName || "-";
                                  contact = caseItem.insuredContact || "-";
                                  detailAddress = caseItem.insuredAddressDetail || "-";
                                } else {
                                  // -1 이상 케이스: 피해자 정보 표시
                                  name = caseItem.victimName || "-";
                                  contact = caseItem.victimContact || "-";
                                  detailAddress = caseItem.victimAddressDetail || "-";
                                }
                                
                                return (
                                  <>
                                    <span>접수번호 {formatCaseNumber(caseItem.caseNumber) || "-"}</span>
                                    <span>성명 {name}</span>
                                    <span>연락처 {contact}</span>
                                    <span>상세주소 {detailAddress}</span>
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                          
                          {!isReadOnly && !isLossPreventionCase && (caseItem.fieldSurveyStatus !== "submitted" || caseItem.status === "반려") && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenEditVictimDialog(caseItem);
                              }}
                              className="p-2 hover:bg-gray-100 rounded"
                              data-testid={`button-edit-victim-${caseItem.id}`}
                            >
                              <Pencil size={16} className="text-[#6B7280]" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 피해자 추가 섹션 - 관리자만 접근 가능 (관리자는 제출 후에도 추가 가능) */}
            {isAdmin && (
            <section className="mt-8">
              <div className="flex items-center justify-between">
                <div className="text-[14px] font-bold">피해자 추가</div>
                {(isAdmin || (!isReadOnly && !isSubmitted)) && (
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#E5E7EB] text-[#6B7280] hover:bg-[#F3F6FA]"
                    aria-label="add"
                    onClick={handleAddNewVictim}
                    disabled={!newVictimName || !newVictimContact || !newVictimAddress}
                    data-testid="button-add-victim"
                  >
                    +
                  </button>
                )}
              </div>
              <div className="mt-3 border-t border-[#E5E7EB]"></div>

              {(isAdmin || (!isReadOnly && !isSubmitted)) && (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 flex items-center gap-3">
                      <div
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#CBD5E1] bg-white text-[12px] text-[#6B7280] cursor-pointer hover:bg-gray-100"
                        onClick={() => {
                          setNewVictimName("");
                          setNewVictimContact("");
                          setNewVictimAddress("");
                          setNewVictimAddressDetail("");
                          setSameAsInsured(false);
                        }}
                        data-testid="button-remove-new-victim"
                      >
                        −
                      </div>

                      <div className="flex flex-1 flex-wrap gap-4">
                        <div className="flex items-center gap-2">
                          <div className="w-[60px] text-[12px] text-[#6B7280]">성명</div>
                          <input
                            className="h-9 w-[220px] rounded-md border border-[#E5E7EB] px-3 text-[13px] outline-none placeholder:text-[#9CA3AF]"
                            placeholder="성명"
                            value={newVictimName}
                            onChange={(e) => { handleUserInput(); setNewVictimName(e.target.value); }}
                            data-testid="input-new-victim-name"
                          />
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="w-[60px] text-[12px] text-[#6B7280]">연락처</div>
                          <input
                            className="h-9 w-[220px] rounded-md border border-[#E5E7EB] px-3 text-[13px] outline-none placeholder:text-[#9CA3AF]"
                            placeholder="연락처"
                            value={newVictimContact}
                            onChange={(e) => { handleUserInput(); setNewVictimContact(e.target.value); }}
                            data-testid="input-new-victim-contact"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="col-span-12 grid grid-cols-12 gap-4">
                      <div className="col-span-7 flex items-center gap-2">
                        <div className="w-[60px] text-[12px] text-[#6B7280]">피해 주소</div>
                        <div className="relative flex-1">
                          <input
                            className="h-9 w-full rounded-md border border-[#E5E7EB] px-3 pr-10 text-[13px] outline-none placeholder:text-[#9CA3AF]"
                            placeholder="도로명 주소, 동/호 포함"
                            value={newVictimAddress}
                            onChange={(e) => { handleUserInput(); setNewVictimAddress(e.target.value); }}
                            disabled={sameAsInsured}
                            data-testid="input-new-victim-address"
                          />
                          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                        </div>
                      </div>

                      <div className="col-span-5 flex items-center gap-2">
                        <div className="w-[60px] text-[12px] text-[#6B7280]">상세주소</div>
                        <div className="relative flex-1">
                          <input
                            className="h-9 w-full rounded-md border border-[#E5E7EB] px-3 pr-10 text-[13px] outline-none placeholder:text-[#9CA3AF]"
                            placeholder="상세주소"
                            value={newVictimAddressDetail}
                            onChange={(e) => { handleUserInput(); setNewVictimAddressDetail(e.target.value); }}
                            data-testid="input-new-victim-address-detail"
                          />
                          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                        </div>
                      </div>

                      <div className="col-span-12 flex items-center justify-end">
                        <label className="inline-flex items-center gap-2 text-[12px] text-[#6B7280] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={sameAsInsured}
                            onChange={(e) => {
                              setSameAsInsured(e.target.checked);
                              if (e.target.checked) {
                                setNewVictimAddress(selectedCaseData?.insuredAddress || "");
                              } else {
                                setNewVictimAddress("");
                                setNewVictimAddressDetail("");
                              }
                            }}
                            className="h-4 w-4 accent-[#008FED]"
                            data-testid="checkbox-same-as-insured"
                          />
                          주소지 동일
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
            )}

            <section className="mt-8">
              <div className="text-[14px] font-bold">VOC(고객의 소리)</div>
              <div className="mt-3 border-t border-[#E5E7EB]"></div>

              <div className="mt-4">
                <textarea
                  className="min-h-[110px] w-full rounded-md border border-[#E5E7EB] p-3 text-[13px] outline-none placeholder:text-[#9CA3AF]"
                  placeholder="내용을 적어주세요"
                  value={voc}
                  onChange={(e) => { handleUserInput(); setVoc(e.target.value); }}
                  maxLength={800}
                  disabled={isReadOnly}
                  data-testid="textarea-voc"
                />
                <div className="text-right mt-1 text-[12px] text-[#6B7280]">
                  {voc.length}/800
                </div>
              </div>
            </section>

            {canEdit && (
              <div className="mt-8 rounded-lg border border-[#E5E7EB] bg-white px-6 py-5">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={isReadOnly}
                    className="text-[14px] font-semibold text-[#EF4444] hover:underline disabled:opacity-50"
                    data-testid="button-reset"
                  >
                    초기화
                  </button>

                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isReadOnly}
                    className="h-10 rounded-md bg-[#008FED] px-7 text-[14px] font-semibold text-white hover:bg-[#0077CC] disabled:opacity-50"
                    data-testid="button-save"
                  >
                    저장
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={editVictimDialogOpen} onOpenChange={setEditVictimDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-[18px] font-semibold">
              피해자 정보 수정
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-victim-name" className="text-[14px] font-medium text-[#6B7280]">
                피해자 성함
              </Label>
              <Input
                id="edit-victim-name"
                value={editVictimName}
                onChange={(e) => {
                  setEditVictimName(e.target.value);
                  if (editingVictimCase?.id === selectedCase) {
                    setVictimName(e.target.value);
                  }
                }}
                placeholder="성함을 입력해주세요"
                data-testid="input-edit-victim-name"
                className="text-[15px]"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit-victim-contact" className="text-[14px] font-medium text-[#6B7280]">
                연락처
              </Label>
              <Input
                id="edit-victim-contact"
                value={editVictimContact}
                onChange={(e) => {
                  setEditVictimContact(e.target.value);
                  if (editingVictimCase?.id === selectedCase) {
                    setVictimContact(e.target.value);
                  }
                }}
                placeholder="연락처를 입력해주세요"
                data-testid="input-edit-victim-contact"
                className="text-[15px]"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit-victim-address" className="text-[14px] font-medium text-[#6B7280]">
                주소
              </Label>
              <Input
                id="edit-victim-address"
                value={editVictimAddress}
                onChange={(e) => {
                  setEditVictimAddress(e.target.value);
                  if (editingVictimCase?.id === selectedCase) {
                    setVictimAddress(e.target.value);
                  }
                }}
                placeholder="주소를 입력해주세요"
                data-testid="input-edit-victim-address"
                className="text-[15px]"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit-victim-address-detail" className="text-[14px] font-medium text-[#6B7280]">
                상세주소
              </Label>
              <Input
                id="edit-victim-address-detail"
                value={editVictimAddressDetail}
                onChange={(e) => {
                  setEditVictimAddressDetail(e.target.value);
                  if (editingVictimCase?.id === selectedCase) {
                    setVictimAddressDetail(e.target.value);
                  }
                }}
                placeholder="상세주소를 입력해주세요"
                data-testid="input-edit-victim-address-detail"
                className="text-[15px]"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (editingVictimCase?.id === selectedCase) {
                  setVictimName(originalVictimName);
                  setVictimContact(originalVictimContact);
                  setVictimAddress(originalVictimAddress);
                  setVictimAddressDetail(originalVictimAddressDetail);
                }
                setEditVictimDialogOpen(false);
              }}
              data-testid="button-cancel-edit-victim"
              className="text-[14px] font-medium"
            >
              취소
            </Button>
            <Button
              onClick={handleSaveEditVictim}
              disabled={isEditingVictim}
              data-testid="button-save-edit-victim"
              className="text-[14px] font-medium bg-[#008FED] text-white hover:bg-[#0077CC]"
            >
              {isEditingVictim ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
