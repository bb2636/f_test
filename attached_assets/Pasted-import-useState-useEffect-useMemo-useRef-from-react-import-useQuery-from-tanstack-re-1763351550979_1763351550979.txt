import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { User, Case } from "@shared/schema";
import { ChevronDown, ChevronRight, ChevronUp, Calendar as CalendarIcon, Clock, X, Plus, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Helper function to normalize boolean values from string/boolean storage
const normalizeBoolean = (value: any): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
};

export default function FieldManagement() {
  const { toast } = useToast();
  const [selectedCase, setSelectedCase] = useState<string>(() => {
    // Load from localStorage on mount
    return localStorage.getItem('selectedFieldSurveyCaseId') || "";
  });
  
  // Collapsible states - intake.tsx 스타일
  const [scheduleOpen, setScheduleOpen] = useState(true);
  const [basicInfoOpen, setBasicInfoOpen] = useState(true);
  const [damageInfoOpen, setDamageInfoOpen] = useState(true);
  const [insuranceInfoOpen, setInsuranceInfoOpen] = useState(true);
  const [insuredInfoOpen, setInsuredInfoOpen] = useState(true);
  const [recoveryMethodOpen, setRecoveryMethodOpen] = useState(true);
  

  const [accidentDate, setAccidentDate] = useState<Date | undefined>(undefined);
  const [accidentTime, setAccidentTime] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  
  // 현장조사 정보 관련 상태
  const [visitDate, setVisitDate] = useState<Date | undefined>(undefined);
  const [visitTime, setVisitTime] = useState("");
  const [visitDatePickerOpen, setVisitDatePickerOpen] = useState(false);
  const [travelDistance, setTravelDistance] = useState("");
  const [dispatchLocation, setDispatchLocation] = useState("");
  const [accompaniedPerson, setAccompaniedPerson] = useState("");
  const [accidentCategory, setAccidentCategory] = useState("배관");
  const [accidentCause, setAccidentCause] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");
  const [victimName, setVictimName] = useState("");
  const [victimContact, setVictimContact] = useState("");
  const [victimAddress, setVictimAddress] = useState("");
  const [additionalVictims, setAdditionalVictims] = useState<Array<{name: string, phone: string, address: string}>>([]);
  const [voc, setVoc] = useState("");
  
  // 새 피해자 입력용 state
  const [newVictimName, setNewVictimName] = useState("");
  const [newVictimContact, setNewVictimContact] = useState("");
  const [newVictimAddress, setNewVictimAddress] = useState("");
  const [sameAsInsured, setSameAsInsured] = useState(false);
  
  // 피해 복구 방식 및 차액 유형 관련 상태
  const [processingTypes, setProcessingTypes] = useState<Set<string>>(new Set());
  const [processingTypeOther, setProcessingTypeOther] = useState("");
  const [recoveryMethodType, setRecoveryMethodType] = useState("부분수리");

  // Refs for preventing scroll on focus
  const caseSelectTriggerRef = useRef<HTMLButtonElement>(null);
  const accidentDateTriggerRef = useRef<HTMLButtonElement>(null);
  const visitDateTriggerRef = useRef<HTMLButtonElement>(null);

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  // 접수건 목록 가져오기
  const { data: allCases, isLoading: casesLoading } = useQuery<Case[]>({
    queryKey: ["/api/cases"],
  });

  // 백엔드 데이터에서 각 단계 완료 상태 확인
  // 도면 데이터 조회
  const { data: drawingData, isLoading: isLoadingDrawing } = useQuery({
    queryKey: ["/api/drawings", "case", selectedCase],
    enabled: !!selectedCase,
  });

  // 문서 데이터 조회
  const { data: documentsData, isLoading: isLoadingDocuments } = useQuery({
    queryKey: ["/api/documents/case", selectedCase],
    enabled: !!selectedCase,
  });

  // 견적 데이터 조회
  const { data: estimateData, isLoading: isLoadingEstimate } = useQuery({
    queryKey: ["/api/estimates", selectedCase, "latest"],
    enabled: !!selectedCase,
  });

  if (!user) {
    return null;
  }

  // 협력사만 입력 가능, 단 검토중 상태에서는 협력사도 수정 불가
  const isPartner = user.role === "협력사";
  const isAdmin = user.role === "관리자";

  // 협력사는 자신에게 배당된 케이스만, 관리자는 모든 케이스 표시
  const availableCases = isPartner 
    ? allCases?.filter(c => c.assignedPartner === user.company) || []
    : allCases || [];

  // 선택한 케이스 데이터 가져오기
  const selectedCaseData = useMemo(() => {
    if (!selectedCase || !availableCases) return null;
    return availableCases.find(c => c.id === selectedCase) || null;
  }, [selectedCase, availableCases]);

  const isReadOnly = !isPartner || (selectedCaseData?.status === "검토중");

  // 각 섹션 완료 상태 체크
  // 현장입력 완료: 필수 필드 입력 완료
  const isFieldInputComplete = useMemo(() => {
    return !!(visitDate && visitTime && accidentCategory && victimName);
  }, [visitDate, visitTime, accidentCategory, victimName]);

  // 도면 완료: 도면이 저장되어 있으면 완료 (도면 객체에 id가 있으면 저장된 것으로 판단)
  const isDrawingComplete = useMemo(() => {
    return !isLoadingDrawing && !!drawingData && typeof drawingData === 'object' && 'id' in drawingData;
  }, [drawingData, isLoadingDrawing]);

  // 문서 완료: 파일이 1개 이상 업로드되어 있으면 완료
  const isDocumentsComplete = useMemo(() => {
    return !isLoadingDocuments && Array.isArray(documentsData) && documentsData.length > 0;
  }, [documentsData, isLoadingDocuments]);

  // 견적 완료: 견적이 저장되어 있으면 완료 (견적 객체에 id가 있으면 저장된 것으로 판단)
  const isEstimateComplete = useMemo(() => {
    return !isLoadingEstimate && !!estimateData && typeof estimateData === 'object' && 'id' in estimateData;
  }, [estimateData, isLoadingEstimate]);

  // 모든 섹션이 완료되어야 제출 가능 (로딩 중이 아닐 때만 판단)
  const isCompletionDataReady = !isLoadingDrawing && !isLoadingDocuments && !isLoadingEstimate;
  const canSubmit = isCompletionDataReady && isFieldInputComplete && isDrawingComplete && isDocumentsComplete && isEstimateComplete;

  // 케이스 선택 관리: 첫 번째 케이스 자동 선택 & 현재 선택된 케이스가 목록에 없으면 초기화
  useEffect(() => {
    if (availableCases.length === 0) {
      // 케이스가 없으면 선택 해제
      setSelectedCase("");
      localStorage.removeItem('selectedFieldSurveyCaseId');
      return;
    }

    // 현재 선택된 케이스가 목록에 없으면 (재배당되거나 삭제됨)
    const isCurrentCaseAvailable = selectedCase && availableCases.some(c => c.id === selectedCase);
    
    if (!isCurrentCaseAvailable) {
      // 첫 번째 케이스로 자동 선택
      const newCaseId = availableCases[0].id;
      setSelectedCase(newCaseId);
      localStorage.setItem('selectedFieldSurveyCaseId', newCaseId);
    }
  }, [availableCases, selectedCase]);

  // 케이스 선택 변경 시 localStorage에 저장
  const handleCaseChange = (caseId: string) => {
    setSelectedCase(caseId);
    localStorage.setItem('selectedFieldSurveyCaseId', caseId);
  };

  // 관리자가 "현장정보 입력" 상태의 케이스를 열면 "검토중"으로 자동 변경
  useEffect(() => {
    const autoUpdateToReview = async () => {
      if (!selectedCaseData || !isAdmin) return;
      
      // 상태가 "현장정보 입력"일 때만 "검토중"으로 변경
      if (selectedCaseData.status === "현장정보 입력") {
        try {
          await apiRequest("PATCH", `/api/cases/${selectedCaseData.id}/field-survey`, {
            status: "검토중",
          });
          
          // 케이스 목록 새로고침
          queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
        } catch (error) {
          console.error("상태 자동 변경 실패:", error);
        }
      }
    };

    autoUpdateToReview();
  }, [selectedCaseData?.id, selectedCaseData?.status, isAdmin]);

  // 선택한 케이스의 데이터를 폼에 로드
  useEffect(() => {
    if (!selectedCaseData) {
      // 케이스가 없으면 모든 state 초기화
      setAccidentDate(undefined);
      setAccidentTime("");
      setVisitDate(undefined);
      setVisitTime("");
      setTravelDistance("");
      setDispatchLocation("");
      setAccompaniedPerson("");
      setAccidentCategory("배관");
      setAccidentCause("");
      setSpecialNotes("");
      setVictimName("");
      setVictimContact("");
      setVictimAddress("");
      setAdditionalVictims([]);
      setVoc("");
      setProcessingTypes(new Set());
      setProcessingTypeOther("");
      setRecoveryMethodType("부분수리");
      return;
    }

    // 사고 발생일시
    if (selectedCaseData.accidentDate) {
      try {
        const [datePart, timePart] = selectedCaseData.accidentDate.split(' ');
        if (datePart) {
          setAccidentDate(new Date(datePart));
        }
        if (timePart) {
          setAccidentTime(timePart);
        }
      } catch (e) {
        console.error("Error parsing accident date:", e);
      }
    } else {
      setAccidentDate(undefined);
      setAccidentTime("");
    }

    // 현장조사 정보
    if (selectedCaseData.fieldSurveyDate) {
      try {
        const [datePart, timePart] = selectedCaseData.fieldSurveyDate.split(' ');
        if (datePart) {
          setVisitDate(new Date(datePart));
        }
        if (timePart) {
          setVisitTime(timePart);
        }
      } catch (e) {
        console.error("Error parsing visit date:", e);
      }
    } else {
      setVisitDate(undefined);
      setVisitTime("");
    }

    // 출동담당자 및 현장 정보
    setAccompaniedPerson(selectedCaseData.accompaniedPerson || "");
    setTravelDistance(selectedCaseData.travelDistance || "");
    setDispatchLocation(selectedCaseData.dispatchLocation || "");

    // 사고 정보
    setAccidentCategory(selectedCaseData.accidentType || "배관");
    setAccidentCause(selectedCaseData.accidentCause || "");
    setSpecialNotes(selectedCaseData.specialNotes || "");

    // 피해자 정보
    setVictimName(selectedCaseData.victimName || "");
    setVictimContact(selectedCaseData.victimContact || "");
    setVictimAddress(selectedCaseData.victimAddress || "");
    
    // 추가 피해자 목록 (JSON 파싱)
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

    // VOC 정보
    setVoc(selectedCaseData.specialRequests || "");

  }, [selectedCaseData]);

  // intake.tsx 스타일 입력 필드 클래스
  const intakeFieldClass = "h-[68px] px-5 py-2.5 bg-[#FDFDFD] border-2 border-[rgba(12,12,12,0.08)] rounded-lg";
  const intakeFieldStyle = {
    fontFamily: "Pretendard",
    fontWeight: 600,
    fontSize: "16px",
    letterSpacing: "-0.02em",
    color: "#0C0C0C",
  };
  
  // intake.tsx 스타일 버튼 클래스 (68px 높이 통일)
  const intakeButtonClass = "h-[68px] px-4 rounded transition-colors";
  const intakeButtonStyle = {
    fontFamily: "Pretendard",
    fontSize: "14px",
    fontWeight: 500,
  };

  // SectionCard: intake.tsx 스타일의 Collapsible 카드
  const SectionCard = ({
    title,
    isOpen,
    onToggle,
    children,
    disabled = false,
  }: {
    title: string;
    isOpen: boolean;
    onToggle: () => void;
    children: React.ReactNode;
    disabled?: boolean;
  }) => (
    <div
      style={{
        background: 'transparent',
        borderRadius: '12px',
        marginBottom: '20px',
      }}
    >
      <Collapsible open={isOpen} onOpenChange={onToggle}>
        {/* 헤더 */}
        <div
          style={{
            padding: '24px',
            height: '82px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3
            style={{
              fontFamily: "Pretendard",
              fontSize: "20px",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "#0C0C0C",
            }}
          >
            {title}
          </h3>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 px-3 py-2 rounded hover-elevate active-elevate-2"
              disabled={disabled}
              data-testid={`button-toggle-${title}`}
            >
              {isOpen ? (
                <ChevronUp className="w-5 h-5" style={{ color: "rgba(12, 12, 12, 0.6)" }} />
              ) : (
                <ChevronDown className="w-5 h-5" style={{ color: "rgba(12, 12, 12, 0.6)" }} />
              )}
            </button>
          </CollapsibleTrigger>
        </div>

        {/* 콘텐츠 */}
        <CollapsibleContent>
          <div style={{ padding: '0 24px 24px 24px' }}>
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );

  return (
    <>
    <div className="relative p-8">
      {/* 현장입력 섹션 */}
      <SectionCard
        title="현장입력"
        isOpen={scheduleOpen}
        onToggle={() => setScheduleOpen(!scheduleOpen)}
      >
        <div>
          <p 
            className="mb-3"
            style={{
              fontFamily: "Pretendard",
              fontSize: "14px",
              fontWeight: 500,
              color: "rgba(12, 12, 12, 0.7)",
            }}
          >
            접수건 선택
          </p>
            
            {/* 접수건 드롭다운 */}
            {casesLoading ? (
              <div className="text-center py-8" style={{ fontFamily: "Pretendard", color: "rgba(12, 12, 12, 0.5)" }}>
                접수건을 불러오는 중...
              </div>
            ) : availableCases.length === 0 ? (
              <div className="text-center py-8" style={{ fontFamily: "Pretendard", color: "rgba(12, 12, 12, 0.5)" }}>
                {isPartner ? "배당된 접수건이 없습니다." : "등록된 접수건이 없습니다."}
              </div>
            ) : (
              <Select
                value={selectedCase}
                onValueChange={handleCaseChange}
              >
                <SelectTrigger 
                  ref={caseSelectTriggerRef}
                  className="border-0 focus:ring-0"
                  style={{
                    width: "788px",
                    height: "auto",
                    padding: "20px 24px",
                    background: "rgba(12, 12, 12, 0.03)",
                    borderRadius: "12px",
                  }}
                  data-testid="select-case"
                >
                  {selectedCaseData ? (
                    <div className="flex flex-col gap-2 w-full">
                      {/* 첫 번째 줄: 파란 점 + 보험사명 + 케이스 번호 */}
                      <div className="flex items-center gap-2">
                        <span 
                          className="rounded-full"
                          style={{
                            width: "8px",
                            height: "8px",
                            background: "#008FED",
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "18px",
                            fontWeight: 600,
                            letterSpacing: "-0.02em",
                            color: "#0C0C0C",
                          }}
                        >
                          {selectedCaseData.insuranceCompany || "보험사 미지정"} {selectedCaseData.caseNumber || ""}
                        </span>
                      </div>
                      {/* 두 번째 줄: 접수번호, 계약자, 담당자 */}
                      <div 
                        className="flex items-center gap-4"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 500,
                          color: "rgba(12, 12, 12, 0.6)",
                        }}
                      >
                        <span>접수번호 {selectedCaseData.insuranceAccidentNo || "-"}</span>
                        <span>계약자 {selectedCaseData.policyHolderName || "-"}</span>
                        <span>담당자 {selectedCaseData.assignedPartnerManager || "-"}</span>
                      </div>
                    </div>
                  ) : (
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "16px",
                        color: "rgba(12, 12, 12, 0.5)",
                      }}
                    >
                      접수건을 선택하세요
                    </span>
                  )}
                </SelectTrigger>
                <SelectContent 
                  position="popper" 
                  sideOffset={4}
                  onOpenAutoFocus={(e) => {
                    e.preventDefault();
                    caseSelectTriggerRef.current?.focus({ preventScroll: true });
                  }}
                  onCloseAutoFocus={(e) => {
                    e.preventDefault();
                    caseSelectTriggerRef.current?.focus({ preventScroll: true });
                  }}
                >
                  {availableCases.map((caseItem) => (
                    <SelectItem 
                      key={caseItem.id} 
                      value={caseItem.id}
                      data-testid={`case-option-${caseItem.id}`}
                    >
                      <div className="flex flex-col gap-1 py-1">
                        {/* 첫 번째 줄: 파란 점 + 보험사명 + 케이스 번호 */}
                        <div className="flex items-center gap-2">
                          <span 
                            className="rounded-full"
                            style={{
                              width: "6px",
                              height: "6px",
                              background: "#008FED",
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "16px",
                              fontWeight: 600,
                              letterSpacing: "-0.02em",
                              color: "#0C0C0C",
                            }}
                          >
                            {caseItem.insuranceCompany || "보험사 미지정"} {caseItem.caseNumber || ""}
                          </span>
                        </div>
                        {/* 두 번째 줄: 접수번호, 계약자, 담당자 */}
                        <div 
                          className="flex items-center gap-3 pl-4"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "12px",
                            fontWeight: 500,
                            color: "rgba(12, 12, 12, 0.6)",
                          }}
                        >
                          <span>접수번호 {caseItem.insuranceAccidentNo || "-"}</span>
                          <span>계약자 {caseItem.policyHolderName || "-"}</span>
                          <span>담당자 {caseItem.assignedPartnerManager || "-"}</span>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </SectionCard>

        {/* 기본정보 섹션 */}
        <SectionCard
          title="기본정보"
          isOpen={basicInfoOpen}
          onToggle={() => setBasicInfoOpen(!basicInfoOpen)}
          disabled={!selectedCaseData}
        >
          <div className="space-y-5">
            {/* 접수사, 담당자명, 담당자 연락처 - 3열 */}
            <div className="grid grid-cols-3 gap-5">
              <div>
                <Label 
                  className="mb-2"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#686A6E",
                  }}
                >
                  접수사
                </Label>
                <Input
                  value={selectedCaseData?.assignedPartner || ""}
                  readOnly
                  placeholder="담당사명"
                  className={intakeFieldClass}
                  style={{
                    ...intakeFieldStyle,
                    background: "rgba(12, 12, 12, 0.04)",
                    color: "rgba(12, 12, 12, 0.4)",
                  }}
                  data-testid="input-intake-company"
                />
              </div>
              <div>
                <Label 
                  className="mb-2"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#686A6E",
                  }}
                >
                  담당자명
                </Label>
                <Input
                  value={selectedCaseData?.assignedPartnerManager || ""}
                  readOnly
                  placeholder="담당자명"
                  className={intakeFieldClass}
                  style={{
                    ...intakeFieldStyle,
                    background: "rgba(12, 12, 12, 0.04)",
                    color: "rgba(12, 12, 12, 0.4)",
                  }}
                  data-testid="input-manager-name"
                />
              </div>
              <div>
                <Label 
                  className="mb-2"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#686A6E",
                  }}
                >
                  담당자 연락처
                </Label>
                <Input
                  value={selectedCaseData?.assignedPartnerContact || ""}
                  readOnly
                  placeholder="담당자 연락처"
                  className={intakeFieldClass}
                  style={{
                    ...intakeFieldStyle,
                    background: "rgba(12, 12, 12, 0.04)",
                    color: "rgba(12, 12, 12, 0.4)",
                  }}
                  data-testid="input-manager-contact"
                />
              </div>
            </div>

            {/* 접수정보 소제목 */}
            <div
              style={{
                fontFamily: "Pretendard",
                fontSize: "18px",
                fontWeight: 600,
                color: "#0C0C0C",
                marginTop: "24px",
                marginBottom: "16px",
              }}
            >
              접수정보
            </div>

            {/* 접수번호, 보험사 - 2열 */}
            <div className="grid grid-cols-2 gap-5">
              <div>
                <Label 
                  className="mb-2"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#686A6E",
                  }}
                >
                  접수번호
                </Label>
                <Input
                  value={selectedCaseData?.insuranceAccidentNo || ""}
                  readOnly
                  placeholder="접수번호"
                  className={intakeFieldClass}
                  style={{
                    ...intakeFieldStyle,
                    background: "rgba(12, 12, 12, 0.04)",
                    color: "rgba(12, 12, 12, 0.4)",
                  }}
                  data-testid="input-insurance-accident-no"
                />
              </div>
              <div>
                <Label 
                  className="mb-2"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#686A6E",
                  }}
                >
                  보험사
                </Label>
                <Input
                  value={selectedCaseData?.insuranceCompany || ""}
                  readOnly
                  placeholder="보험사 선택"
                  className={intakeFieldClass}
                  style={{
                    ...intakeFieldStyle,
                    background: "rgba(12, 12, 12, 0.04)",
                    color: "rgba(12, 12, 12, 0.4)",
                  }}
                  data-testid="input-insurance-company"
                />
              </div>
            </div>

            {/* 보험계약자 및 피보험자 정보 소제목 + 체크박스 */}
            <div 
              className="flex items-center justify-between"
              style={{
                marginTop: "24px",
                marginBottom: "16px",
              }}
            >
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "18px",
                  fontWeight: 600,
                  color: "#0C0C0C",
                }}
              >
                보험계약자 및 피보험자 정보
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="same-as-policyholder"
                  checked={normalizeBoolean(selectedCaseData?.sameAsPolicyHolder)}
                  disabled
                  data-testid="checkbox-same-as-policyholder"
                />
                <label
                  htmlFor="same-as-policyholder"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#686A6E",
                    cursor: "not-allowed",
                  }}
                >
                  보험계약자 = 피보험자
                </label>
              </div>
            </div>

            {/* 보험계약자, 피보험자, 피보험자 연락처 - 3열 */}
            <div className="grid grid-cols-3 gap-5">
              <div>
                <Label 
                  className="mb-2"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#686A6E",
                  }}
                >
                  보험계약자
                </Label>
                <Input
                  value={selectedCaseData?.policyHolderName || ""}
                  readOnly
                  placeholder="보험계약자 성명"
                  className={intakeFieldClass}
                  style={{
                    ...intakeFieldStyle,
                    background: "rgba(12, 12, 12, 0.04)",
                    color: "rgba(12, 12, 12, 0.4)",
                  }}
                  data-testid="input-policyholder-name"
                />
              </div>
              <div>
                <Label 
                  className="mb-2"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#686A6E",
                  }}
                >
                  피보험자
                </Label>
                <Input
                  value={selectedCaseData?.insuredName || ""}
                  readOnly
                  placeholder="피보험자 성명"
                  className={intakeFieldClass}
                  style={{
                    ...intakeFieldStyle,
                    background: "rgba(12, 12, 12, 0.04)",
                    color: "rgba(12, 12, 12, 0.4)",
                  }}
                  data-testid="input-insured-name"
                />
              </div>
              <div>
                <Label 
                  className="mb-2"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#686A6E",
                  }}
                >
                  피보험자 연락처
                </Label>
                <Input
                  value={selectedCaseData?.insuredContact || ""}
                  readOnly
                  placeholder="피보험자 연락처"
                  className={intakeFieldClass}
                  style={{
                    ...intakeFieldStyle,
                    background: "rgba(12, 12, 12, 0.04)",
                    color: "rgba(12, 12, 12, 0.4)",
                  }}
                  data-testid="input-insured-contact"
                />
              </div>
            </div>

            {/* 피보험자 주소 - 전체 너비 */}
            <div>
              <Label 
                className="mb-2"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                  color: "#686A6E",
                }}
              >
                피보험자 주소
              </Label>
              <Input
                value={selectedCaseData?.insuredAddress || ""}
                readOnly
                placeholder="도로명 주소, 동/호수 포함"
                className={intakeFieldClass}
                style={{
                  ...intakeFieldStyle,
                  background: "rgba(12, 12, 12, 0.04)",
                  color: "rgba(12, 12, 12, 0.4)",
                }}
                data-testid="input-insured-address"
              />
            </div>

            {/* 사고 발생 일시 */}
            <div>
              <Label 
                className="mb-2"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                  color: "#686A6E",
                }}
              >
                사고 발생일시
              </Label>
              <div className="flex gap-2">
                <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen} modal={false}>
                  <PopoverTrigger asChild>
                    <Button
                      ref={accidentDateTriggerRef}
                      type="button"
                      variant="outline"
                      className={intakeButtonClass}
                      style={{
                        ...intakeButtonStyle,
                        justifyContent: "flex-start",
                        background: "#FDFDFD",
                        border: isReadOnly ? "none" : "2px solid rgba(12,12,12,0.08)",
                        flex: 1,
                      }}
                      disabled={isReadOnly}
                      data-testid="button-accident-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {accidentDate ? format(accidentDate, "yyyy.MM.dd", { locale: ko }) : <span>날짜 선택</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent 
                    className="w-auto p-0"
                    onOpenAutoFocus={(e) => {
                      e.preventDefault();
                      accidentDateTriggerRef.current?.focus({ preventScroll: true });
                    }}
                    onCloseAutoFocus={(e) => {
                      e.preventDefault();
                      accidentDateTriggerRef.current?.focus({ preventScroll: true });
                    }}
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
                <Input
                  type="time"
                  value={accidentTime}
                  onChange={(e) => setAccidentTime(e.target.value)}
                  className={intakeFieldClass}
                  style={{
                    ...intakeFieldStyle,
                    flex: 1,
                    border: isReadOnly ? "none" : undefined,
                  }}
                  disabled={isReadOnly}
                  data-testid="input-accident-time"
                />
              </div>
            </div>
          </div>
        </SectionCard>

        {/* 현장조사 정보 섹션 */}
        <SectionCard
          title="현장조사 정보"
          isOpen={true}
          onToggle={() => {}}
          disabled={!selectedCaseData}
        >
          <div className="space-y-6">
            {/* 현장정보 서브섹션 */}
            <div>
              <h3
                className="mb-4"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "18px",
                  fontWeight: 600,
                  color: "rgba(12, 12, 12, 0.8)",
                }}
              >
                현장정보
              </h3>
              <div className="grid grid-cols-3 gap-4">
                {/* 방문 일시 */}
                <div>
                  <Label 
                    htmlFor="visit-date"
                    className="mb-3"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "rgba(12, 12, 12, 0.7)",
                    }}
                  >
                    방문 일시
                  </Label>
                  <div className="flex gap-2">
                    <Popover open={visitDatePickerOpen} onOpenChange={setVisitDatePickerOpen} modal={false}>
                      <PopoverTrigger asChild>
                        <Button
                          ref={visitDateTriggerRef}
                          type="button"
                          variant="outline"
                          className={intakeButtonClass}
                          style={{
                            ...intakeButtonStyle,
                            justifyContent: "flex-start",
                            background: "#FDFDFD",
                            border: "2px solid rgba(12,12,12,0.08)",
                            flex: 1,
                          }}
                          disabled={isReadOnly}
                          data-testid="button-visit-date"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {visitDate ? format(visitDate, "yyyy.MM.dd", { locale: ko }) : <span>날짜 선택</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent 
                        className="w-auto p-0"
                        onOpenAutoFocus={(e) => {
                          e.preventDefault();
                          visitDateTriggerRef.current?.focus({ preventScroll: true });
                        }}
                        onCloseAutoFocus={(e) => {
                          e.preventDefault();
                          visitDateTriggerRef.current?.focus({ preventScroll: true });
                        }}
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
                    <Input
                      type="time"
                      value={visitTime}
                      onChange={(e) => setVisitTime(e.target.value)}
                      className={intakeFieldClass}
                      style={{
                        ...intakeFieldStyle,
                        flex: 1,
                      }}
                      disabled={isReadOnly}
                      data-testid="input-visit-time"
                    />
                  </div>
                </div>

                {/* 현장 이동 거리 */}
                <div>
                  <Label 
                    htmlFor="travel-distance"
                    className="mb-3"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "rgba(12, 12, 12, 0.7)",
                    }}
                  >
                    현장 이동 거리
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="travel-distance"
                      type="text"
                      value={travelDistance}
                      onChange={(e) => {
                        const value = e.target.value;
                        // 숫자만 입력 가능 (빈 문자열 허용)
                        if (value === '' || /^\d+$/.test(value)) {
                          setTravelDistance(value);
                        }
                      }}
                      className={intakeFieldClass}
                      style={{
                        ...intakeFieldStyle,
                        flex: 1,
                      }}
                      disabled={isReadOnly}
                      placeholder="0"
                      data-testid="input-travel-distance"
                    />
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "16px",
                        fontWeight: 600,
                        color: "#0C0C0C",
                      }}
                    >
                      km
                    </span>
                  </div>
                </div>

                {/* 출동 담당자 */}
                <div>
                  <Label 
                    htmlFor="dispatch-manager"
                    className="mb-3"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "rgba(12, 12, 12, 0.7)",
                    }}
                  >
                    출동 담당자
                  </Label>
                  <Input
                    id="dispatch-manager"
                    value={selectedCaseData?.accompaniedPerson || ""}
                    readOnly
                    className={intakeFieldClass}
                    style={{
                      ...intakeFieldStyle,
                      background: "rgba(12, 12, 12, 0.04)",
                      color: "rgba(12, 12, 12, 0.4)",
                    }}
                    placeholder="출동 담당자 성명"
                    data-testid="input-dispatch-manager"
                  />
                </div>
              </div>
            </div>

            {/* 사고 원인(누수소견서) 서브섹션 */}
            <div>
              <h3
                className="mb-4"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "20px",
                  fontWeight: 600,
                  color: "rgba(12, 12, 12, 0.8)",
                  letterSpacing: "-0.02em",
                }}
              >
                사고 원인(누수소견서)
              </h3>
              <div className="space-y-4">
                {/* 카테고리 */}
                <div>
                  <Label 
                    className="mb-2"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "#686A6E",
                    }}
                  >
                    카테고리
                  </Label>
                  <div className="flex gap-2">
                    {["배관", "교체", "방수", "기타"].map((category) => (
                      <Button
                        key={category}
                        type="button"
                        onClick={() => setAccidentCategory(category)}
                        disabled={isReadOnly}
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 600,
                          height: "52px",
                          padding: "12px 16px",
                          borderRadius: "6px",
                          border: accidentCategory === category 
                            ? "2px solid rgba(255, 255, 255, 0.04)" 
                            : "1px solid rgba(12, 12, 12, 0.3)",
                          background: accidentCategory === category 
                            ? "rgba(0, 143, 237, 0.1)" 
                            : "#FDFDFD",
                          color: accidentCategory === category 
                            ? "#008FED" 
                            : "rgba(12, 12, 12, 0.9)",
                          boxShadow: accidentCategory === category 
                            ? "inset 0px -2px 4px rgba(0, 0, 0, 0.05), inset 0px 2px 4px rgba(0, 0, 0, 0.05)" 
                            : "none",
                          backdropFilter: accidentCategory === category ? "blur(7px)" : "none",
                        }}
                        data-testid={`button-category-${category}`}
                      >
                        {category}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* 사고원인 */}
                <div>
                  <Label 
                    htmlFor="accident-cause-detail"
                    className="mb-2"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "#686A6E",
                    }}
                  >
                    사고원인
                  </Label>
                  <Textarea
                    id="accident-cause-detail"
                    value={accidentCause}
                    onChange={(e) => setAccidentCause(e.target.value)}
                    placeholder="누수원인, 누수지점 등 기타 특이사항을 입력해주세요."
                    className="min-h-[200px]"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      padding: "16px 20px",
                      background: "#FDFDFD",
                      border: "2px solid rgba(12,12,12,0.08)",
                      borderRadius: "8px",
                      resize: "none",
                    }}
                    disabled={isReadOnly}
                    data-testid="textarea-accident-cause"
                  />
                  <div 
                    className="text-right mt-1"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "12px",
                      color: "rgba(12, 12, 12, 0.5)",
                    }}
                  >
                    {accidentCause.length}/800
                  </div>
                </div>

                {/* 특이사항 */}
                <div>
                  <Label 
                    htmlFor="special-notes"
                    className="mb-2"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "#686A6E",
                    }}
                  >
                    특이사항
                  </Label>
                  <Textarea
                    id="special-notes"
                    value={specialNotes}
                    onChange={(e) => setSpecialNotes(e.target.value)}
                    placeholder="특이사항 입력"
                    className="min-h-[120px]"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      padding: "16px 20px",
                      background: "#FDFDFD",
                      border: "2px solid rgba(12,12,12,0.08)",
                      borderRadius: "8px",
                      resize: "none",
                    }}
                    disabled={isReadOnly}
                    data-testid="textarea-special-notes"
                  />
                </div>
              </div>
            </div>

            {/* 피해자 정보 서브섹션 */}
            <div>
              <h3
                className="mb-4"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "20px",
                  fontWeight: 600,
                  color: "rgba(12, 12, 12, 0.8)",
                  letterSpacing: "-0.02em",
                }}
              >
                총 {1 + additionalVictims.length}명의 피해자
              </h3>
              
              <div className="space-y-3">
                {/* 기본 피해자 (접수건에서 로드) */}
                {victimName && (
                  <div
                    style={{
                      background: "rgba(12, 12, 12, 0.04)",
                      borderRadius: "8px",
                      padding: "16px 20px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: "#008FED",
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 600,
                          color: "rgba(12, 12, 12, 0.8)",
                        }}
                      >
                        {victimName}
                      </span>
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 500,
                          color: "rgba(12, 12, 12, 0.6)",
                        }}
                      >
                        {victimContact}
                      </span>
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 500,
                          color: "rgba(12, 12, 12, 0.6)",
                        }}
                      >
                        {victimAddress}
                      </span>
                    </div>
                    {!isReadOnly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setVictimName("");
                          setVictimContact("");
                          setVictimAddress("");
                        }}
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "50%",
                          background: "rgba(12, 12, 12, 0.1)",
                        }}
                        data-testid="button-remove-primary-victim"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                      </Button>
                    )}
                  </div>
                )}

                {/* 추가 피해자 목록 */}
                {additionalVictims.map((victim, index) => (
                  <div
                    key={index}
                    style={{
                      background: "rgba(12, 12, 12, 0.04)",
                      borderRadius: "8px",
                      padding: "16px 20px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: "#008FED",
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 600,
                          color: "rgba(12, 12, 12, 0.8)",
                        }}
                      >
                        {victim.name}
                      </span>
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 500,
                          color: "rgba(12, 12, 12, 0.6)",
                        }}
                      >
                        {victim.phone}
                      </span>
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 500,
                          color: "rgba(12, 12, 12, 0.6)",
                        }}
                      >
                        {victim.address}
                      </span>
                    </div>
                    {!isReadOnly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          const updated = additionalVictims.filter((_, i) => i !== index);
                          setAdditionalVictims(updated);
                        }}
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "50%",
                          background: "rgba(12, 12, 12, 0.1)",
                        }}
                        data-testid={`button-remove-victim-${index}`}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              {/* 새 피해자 추가 폼 */}
              {!isReadOnly && (
                <div className="mt-6 space-y-4">
                  <div
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 600,
                      color: "rgba(12, 12, 12, 0.8)",
                    }}
                  >
                    피해자 추가
                  </div>
                  
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-2">
                      <Input
                        value={newVictimName}
                        onChange={(e) => setNewVictimName(e.target.value)}
                        placeholder="성함을 입력해주세요"
                        className={intakeFieldClass}
                        style={intakeFieldStyle}
                        data-testid="input-new-victim-name"
                      />
                      <Input
                        value={newVictimContact}
                        onChange={(e) => setNewVictimContact(e.target.value)}
                        placeholder="연락처를 입력해주세요"
                        className={intakeFieldClass}
                        style={intakeFieldStyle}
                        data-testid="input-new-victim-contact"
                      />
                      <div className="flex items-center gap-2">
                        <Input
                          value={newVictimAddress}
                          onChange={(e) => setNewVictimAddress(e.target.value)}
                          placeholder="상세주소"
                          className={intakeFieldClass}
                          style={{
                            ...intakeFieldStyle,
                            flex: 1,
                          }}
                          disabled={sameAsInsured}
                          data-testid="input-new-victim-address"
                        />
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="same-as-insured-address"
                            checked={sameAsInsured}
                            onCheckedChange={(checked) => {
                              setSameAsInsured(checked === true);
                              if (checked === true) {
                                setNewVictimAddress(selectedCaseData?.insuredAddress || "");
                              } else {
                                setNewVictimAddress("");
                              }
                            }}
                            data-testid="checkbox-same-as-insured"
                          />
                          <label
                            htmlFor="same-as-insured-address"
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 500,
                              color: "#686A6E",
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                            }}
                          >
                            주소지 등일
                          </label>
                        </div>
                      </div>
                    </div>
                    
                    <Button
                      type="button"
                      onClick={() => {
                        if (newVictimName && newVictimContact && newVictimAddress) {
                          setAdditionalVictims([
                            ...additionalVictims,
                            {
                              name: newVictimName,
                              phone: newVictimContact,
                              address: newVictimAddress,
                            },
                          ]);
                          setNewVictimName("");
                          setNewVictimContact("");
                          setNewVictimAddress("");
                          setSameAsInsured(false);
                        }
                      }}
                      disabled={!newVictimName || !newVictimContact || !newVictimAddress}
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "16px",
                        fontWeight: 600,
                        height: "68px",
                        width: "120px",
                        background: newVictimName && newVictimContact && newVictimAddress 
                          ? "#ECECEC" 
                          : "rgba(12, 12, 12, 0.04)",
                        color: newVictimName && newVictimContact && newVictimAddress 
                          ? "rgba(12, 12, 12, 0.8)" 
                          : "rgba(12, 12, 12, 0.3)",
                        border: "none",
                        borderRadius: "8px",
                      }}
                      data-testid="button-add-new-victim"
                    >
                      입력
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* VOC(고객의 소리) 서브섹션 */}
            <div>
              <h3
                className="mb-4"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "20px",
                  fontWeight: 600,
                  color: "rgba(12, 12, 12, 0.8)",
                  letterSpacing: "-0.02em",
                }}
              >
                VOC(고객의 소리)
              </h3>
              <div>
                <Textarea
                  id="voc"
                  value={voc}
                  onChange={(e) => setVoc(e.target.value)}
                  placeholder="내용을 적어주세요"
                  className="min-h-[120px]"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    padding: "16px 20px",
                    background: "#FDFDFD",
                    border: "2px solid rgba(12,12,12,0.08)",
                    borderRadius: "8px",
                    resize: "none",
                  }}
                  disabled={isReadOnly}
                  data-testid="textarea-voc"
                />
                <div 
                  className="text-right mt-1"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "12px",
                    color: "rgba(12, 12, 12, 0.5)",
                  }}
                >
                  {voc.length}/800
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* 피해 복구 방식 및 처리 유형 섹션 */}
        <SectionCard
          title="피해 복구 방식 및 처리 유형"
          isOpen={true}
          onToggle={() => {}}
          disabled={!selectedCaseData}
        >
          <div className="space-y-6">
            {/* 처리 유형(복수선택) */}
            <div>
              <Label 
                className="mb-2"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                  color: "#686A6E",
                }}
              >
                처리 유형(복수선택)
              </Label>
              <div className="flex gap-2">
                {["수리", "비교견적", "기타"].map((type) => (
                  <Button
                    key={type}
                    type="button"
                    onClick={() => {
                      const newTypes = new Set(processingTypes);
                      if (newTypes.has(type)) {
                        newTypes.delete(type);
                      } else {
                        newTypes.add(type);
                      }
                      setProcessingTypes(newTypes);
                    }}
                    disabled={isReadOnly}
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 600,
                      height: "52px",
                      padding: "12px 16px",
                      borderRadius: "6px",
                      border: processingTypes.has(type)
                        ? "2px solid rgba(255, 255, 255, 0.04)" 
                        : "1px solid rgba(12, 12, 12, 0.3)",
                      background: processingTypes.has(type)
                        ? "rgba(0, 143, 237, 0.1)" 
                        : "#FDFDFD",
                      color: processingTypes.has(type)
                        ? "#008FED" 
                        : "rgba(12, 12, 12, 0.9)",
                      boxShadow: processingTypes.has(type)
                        ? "inset 0px -2px 4px rgba(0, 0, 0, 0.05), inset 0px 2px 4px rgba(0, 0, 0, 0.05)" 
                        : "none",
                      backdropFilter: processingTypes.has(type) ? "blur(7px)" : "none",
                    }}
                    data-testid={`button-processing-type-${type}`}
                  >
                    {type}
                  </Button>
                ))}
                <Input
                  value={processingTypeOther}
                  onChange={(e) => setProcessingTypeOther(e.target.value)}
                  placeholder="기타사항을 입력해주세요"
                  className="h-[52px] flex-1"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 600,
                    padding: "12px 16px",
                    background: "#FDFDFD",
                    border: "1px solid rgba(12, 12, 12, 0.3)",
                    borderRadius: "6px",
                    color: "rgba(12, 12, 12, 0.9)",
                  }}
                  disabled={isReadOnly}
                  data-testid="input-processing-type-other"
                />
              </div>
            </div>

            {/* 복구 방식 */}
            <div>
              <Label 
                className="mb-2"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                  color: "#686A6E",
                }}
              >
                복구 방식
              </Label>
              <div className="flex gap-2">
                {["부분수리", "전체수리"].map((method) => (
                  <Button
                    key={method}
                    type="button"
                    onClick={() => setRecoveryMethodType(method)}
                    disabled={isReadOnly}
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 600,
                      height: "52px",
                      padding: "12px 16px",
                      borderRadius: "6px",
                      border: recoveryMethodType === method
                        ? "2px solid rgba(255, 255, 255, 0.04)" 
                        : "1px solid rgba(12, 12, 12, 0.3)",
                      background: recoveryMethodType === method
                        ? "rgba(0, 143, 237, 0.1)" 
                        : "#FDFDFD",
                      color: recoveryMethodType === method
                        ? "#008FED" 
                        : "rgba(12, 12, 12, 0.9)",
                      boxShadow: recoveryMethodType === method
                        ? "inset 0px -2px 4px rgba(0, 0, 0, 0.05), inset 0px 2px 4px rgba(0, 0, 0, 0.05)" 
                        : "none",
                      backdropFilter: recoveryMethodType === method ? "blur(7px)" : "none",
                    }}
                    data-testid={`button-recovery-method-${method}`}
                  >
                    {method}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

      {/* 하단 액션 버튼 영역 */}
      {selectedCaseData && (
        <div
          style={{
            maxWidth: "1400px",
            margin: "40px auto 60px",
            padding: "0 40px",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          {/* 역할별 버튼 */}
          <div className="flex gap-3">
            {isPartner && (
              <>
                {/* 임시저장 버튼 */}
                <Button
                  type="button"
                  onClick={async () => {
                    if (!selectedCaseData?.id) return;

                    try {
                      // 상태 자동 변경 로직
                      let status = "현장방문"; // 기본값: 방문일시만 입력된 경우
                      
                      // 모든 필수 필드가 입력된 경우 → "현장정보 입력"
                      if (visitDate && visitTime && accidentCategory && victimName) {
                        status = "현장정보 입력";
                      }

                      const payload = {
                        visitDate: visitDate ? format(visitDate, "yyyy-MM-dd") : null,
                        visitTime,
                        travelDistance,
                        dispatchLocation,
                        accompaniedPerson,
                        accidentTime,
                        accidentCategory,
                        accidentCause,
                        specialNotes,
                        victimName,
                        victimContact,
                        victimAddress,
                        additionalVictims: JSON.stringify(additionalVictims),
                        specialRequests: voc,
                        processingTypes: JSON.stringify(Array.from(processingTypes)),
                        processingTypeOther,
                        recoveryMethodType,
                        fieldSurveyStatus: "draft",
                        status, // 자동 변경된 상태 추가
                      };

                      await apiRequest("PATCH", `/api/cases/${selectedCaseData.id}/field-survey`, payload);

                      toast({
                        title: "임시저장 완료",
                        description: `현장조사 정보가 임시저장되었습니다. (상태: ${status})`,
                      });

                      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
                    } catch (error) {
                      console.error("임시저장 에러:", error);
                      toast({
                        title: "임시저장 실패",
                        description: "현장조사 정보 임시저장 중 오류가 발생했습니다.",
                        variant: "destructive",
                      });
                    }
                  }}
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 600,
                    height: "52px",
                    padding: "12px 32px",
                    background: "#FFFFFF",
                    color: "rgba(12, 12, 12, 0.7)",
                    border: "1px solid rgba(12, 12, 12, 0.2)",
                    borderRadius: "8px",
                  }}
                  data-testid="button-temp-save"
                >
                  임시저장
                </Button>

                {/* 제출 버튼 - 모든 필수 필드 입력 시 활성화 */}
                <Button
                  type="button"
                  onClick={async () => {
                    if (!selectedCaseData?.id) return;

                    try {
                      const payload = {
                        visitDate: visitDate ? format(visitDate, "yyyy-MM-dd") : null,
                        visitTime,
                        travelDistance,
                        dispatchLocation,
                        accompaniedPerson,
                        accidentTime,
                        accidentCategory,
                        accidentCause,
                        specialNotes,
                        victimName,
                        victimContact,
                        victimAddress,
                        additionalVictims: JSON.stringify(additionalVictims),
                        specialRequests: voc,
                        processingTypes: JSON.stringify(Array.from(processingTypes)),
                        processingTypeOther,
                        recoveryMethodType,
                        fieldSurveyStatus: "submitted",
                        status: "현장정보 입력", // 제출 시 상태 변경
                      };

                      await apiRequest("PATCH", `/api/cases/${selectedCaseData.id}/field-survey`, payload);

                      toast({
                        title: "제출 완료",
                        description: "현장조사 보고서가 제출되었습니다.",
                      });

                      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
                    } catch (error) {
                      console.error("제출 에러:", error);
                      toast({
                        title: "제출 실패",
                        description: "현장조사 보고서 제출 중 오류가 발생했습니다.",
                        variant: "destructive",
                      });
                    }
                  }}
                  disabled={!canSubmit}
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 600,
                    height: "52px",
                    padding: "12px 32px",
                    background: canSubmit ? "#008FED" : "rgba(12, 12, 12, 0.1)",
                    color: canSubmit ? "#FFFFFF" : "rgba(12, 12, 12, 0.3)",
                    border: "none",
                    borderRadius: "8px",
                    cursor: canSubmit ? "pointer" : "not-allowed",
                  }}
                  data-testid="button-submit"
                >
                  제출
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  );
}
