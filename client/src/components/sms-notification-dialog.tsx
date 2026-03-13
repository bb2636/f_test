import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { MessageSquare, Send, Loader2, Check, X } from "lucide-react";
import type { Case } from "@shared/schema";

type NotificationStage =
  | "접수완료"
  | "현장정보입력"
  | "반려"
  | "승인반려"
  | "현장정보제출"
  | "복구요청"
  | "직접복구"
  | "미복구"
  | "청구자료제출"
  | "출동비청구(선견적)"
  | "청구"
  | "접수취소"
  | "입금완료"
  | "부분입금"
  | "부분지급"
  | "지급완료"
  | "정산완료"
  | "선견적요청"
  | "종결";

interface RecipientConfig {
  partner: boolean;
  manager: boolean;
  assessorInvestigator: boolean;
}

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

interface SmsNotificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseData: Case;
  stage: NotificationStage;
  cancelReason?: string;
  recoveryAmount?: number;
  feeRate?: number;
  paymentAmount?: number;
  previousStatus?: string;
  onSuccess?: () => void;
}

export function SmsNotificationDialog({
  open,
  onOpenChange,
  caseData,
  stage,
  cancelReason: initialCancelReason = "",
  recoveryAmount: initialRecoveryAmount,
  feeRate: initialFeeRate,
  paymentAmount: initialPaymentAmount,
  previousStatus,
  onSuccess,
}: SmsNotificationDialogProps) {
  const { toast } = useToast();
  const [recipients, setRecipients] = useState<RecipientConfig>(
    STAGE_RECIPIENT_DEFAULTS[stage],
  );
  const [additionalMessage, setAdditionalMessage] = useState("");
  const [cancelReason, setCancelReason] = useState(initialCancelReason);
  const [recoveryAmount, setRecoveryAmount] = useState<number | undefined>(
    initialRecoveryAmount,
  );
  const [feeRate, setFeeRate] = useState<number | undefined>(initialFeeRate);
  const [paymentAmount, setPaymentAmount] = useState<number | undefined>(
    initialPaymentAmount,
  );

  // 접수취소 수신자 선택 상태
  const [sendToAssessor, setSendToAssessor] = useState(false);
  const [sendToInvestigator, setSendToInvestigator] = useState(false);
  const [sendToManual, setSendToManual] = useState(false);
  const [manualEmail, setManualEmail] = useState("");

  useEffect(() => {
    if (open) {
      setRecipients(STAGE_RECIPIENT_DEFAULTS[stage]);
      setAdditionalMessage("");
      setCancelReason(initialCancelReason);
      setRecoveryAmount(initialRecoveryAmount);
      setFeeRate(initialFeeRate);
      setPaymentAmount(initialPaymentAmount);
      // 접수취소 수신자 선택 초기화
      setSendToAssessor(false);
      setSendToInvestigator(false);
      setSendToManual(false);
      setManualEmail("");
    }
  }, [
    open,
    stage,
    initialCancelReason,
    initialRecoveryAmount,
    initialFeeRate,
    initialPaymentAmount,
  ]);

  const sendNotificationMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        "/api/send-stage-notification",
        {
          caseId: caseData.id,
          stage,
          recipients,
          additionalMessage: additionalMessage || undefined,
          cancelReason: stage === "접수취소" ? cancelReason : undefined,
          previousStatus:
            stage === "반려" || stage === "승인반려"
              ? previousStatus
              : undefined,
        },
      );
      return response;
    },
    onSuccess: (data: any) => {
      toast({
        title: "알림 발송 완료",
        description: data.message || "문자 알림이 발송되었습니다.",
      });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: any) => {
      toast({
        title: "알림 발송 실패",
        description: error?.message || "문자 발송에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const sendCancellationEmailMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        "/api/send-cancellation-email",
        {
          caseId: caseData.id,
          cancelReason: cancelReason || undefined,
          recipients: {
            sendToAssessor,
            sendToInvestigator,
            manualEmail: manualEmail.trim() || undefined,
          },
        },
      );
      return response;
    },
    onSuccess: (data: any) => {
      toast({
        title: "이메일 발송 완료",
        description: data.message || "접수취소 이메일이 발송되었습니다.",
      });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: any) => {
      toast({
        title: "이메일 발송 실패",
        description: error?.message || "이메일 발송에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleSend = () => {
    if (
      !recipients.partner &&
      !recipients.manager &&
      !recipients.assessorInvestigator
    ) {
      toast({
        title: "수신자 선택 필요",
        description: "최소 1명의 수신자를 선택해주세요.",
        variant: "destructive",
      });
      return;
    }
    sendNotificationMutation.mutate();
  };

  const getStageDisplayName = () => {
    return stage;
  };

  // 의뢰범위 계산 (손방/대물)
  const getRequestScope = () => {
    const items = [];
    if (caseData.damagePreventionCost === "true") items.push("손방");
    if (caseData.victimIncidentAssistance === "true") items.push("대물");
    return items.length > 0 ? items.join(", ") : "기타";
  };

  // 케이스 접미사에 따른 주소 결정: -0은 피보험자 주소, -1 이상은 피해자 주소
  const getFullAddress = () => {
    const caseNumber = caseData.caseNumber || "";
    const suffixMatch = caseNumber.match(/-(\d+)$/);
    const suffix = suffixMatch ? parseInt(suffixMatch[1], 10) : 0;

    if (suffix === 0) {
      // 손해방지(-0): 피보험자 주소 + 상세주소
      return (
        [caseData.insuredAddress, caseData.insuredAddressDetail]
          .filter(Boolean)
          .join(" ") || "-"
      );
    } else {
      // 피해세대(-1, -2, ...): 피해자 주소 + 상세주소 (없으면 피보험자 주소로 대체)
      const victimAddr = [caseData.victimAddress, caseData.victimAddressDetail]
        .filter(Boolean)
        .join(" ");
      if (victimAddr) {
        return victimAddr;
      }
      return (
        [caseData.insuredAddress, caseData.insuredAddressDetail]
          .filter(Boolean)
          .join(" ") || "-"
      );
    }
  };

  const getMessagePreview = () => {
    if (stage === "접수완료") {
      const lines: string[] = [];

      if (caseData.caseNumber) lines.push(`접수번호 : ${caseData.caseNumber}`);
      if (caseData.insuranceCompany)
        lines.push(`보험사 : ${caseData.insuranceCompany}`);
      if (caseData.insurancePolicyNo)
        lines.push(`증권번호 : ${caseData.insurancePolicyNo}`);
      if (caseData.insuranceAccidentNo)
        lines.push(`사고번호 : ${caseData.insuranceAccidentNo}`);

      // 피보험자 라인: 이름 또는 연락처가 있을 때만 표시
      if (caseData.insuredName || caseData.insuredContact) {
        const insuredParts = [];
        if (caseData.insuredName) insuredParts.push(caseData.insuredName);
        if (caseData.insuredContact)
          insuredParts.push(`연락처 ${caseData.insuredContact}`);
        lines.push(`피보험자 : ${insuredParts.join("  ")}`);
      }

      // 피해자 라인: 이름 또는 연락처가 있을 때만 표시
      if (caseData.victimName || caseData.victimContact) {
        const victimParts = [];
        if (caseData.victimName) victimParts.push(caseData.victimName);
        if (caseData.victimContact)
          victimParts.push(`연락처 ${caseData.victimContact}`);
        lines.push(`피해자 : ${victimParts.join("  ")}`);
      }

      // 심사자 라인: 이름과 연락처가 있을 때만 표시 (assessorTeam 또는 assessorId 사용)
      const assessorName = caseData.assessorTeam || caseData.assessorId;
      if (assessorName && caseData.assessorContact) {
        lines.push(
          `심사자 : ${assessorName}  연락처 ${caseData.assessorContact}`,
        );
      }

      // 조사자 라인: 이름과 연락처가 있을 때만 표시
      if (caseData.investigatorTeamName && caseData.investigatorContact) {
        lines.push(
          `조사자 : ${caseData.investigatorTeamName}  연락처 ${caseData.investigatorContact}`,
        );
      }

      lines.push(`사고장소 : ${getFullAddress()}`);

      const requestScope = getRequestScope();
      if (requestScope !== "기타") lines.push(`의뢰범위 : ${requestScope}`);

      return lines.join("\n");
    } else if (stage === "접수취소") {
      return `접수번호 : ${caseData.caseNumber || "-"}
보험사 : ${caseData.insuranceCompany || "-"}
증권번호 : ${caseData.insurancePolicyNo || "-"}
사고번호 : ${caseData.insuranceAccidentNo || "-"}
피보험자 : ${caseData.insuredName || "-"}
사고장소 : ${getFullAddress()}

위 접수건은 접수 취소 되었음을 알려드립니다.
취소 사유 : ${cancelReason || "-"}`;
    } else if (stage === "반려" || stage === "승인반려") {
      const rejectionStatus = previousStatus
        ? `${previousStatus}에서 반려`
        : "반려";
      return `접수번호 : ${caseData.caseNumber || "-"}
보험사 : ${caseData.insuranceCompany || "-"}
증권번호 : ${caseData.insurancePolicyNo || "-"}
사고번호 : ${caseData.insuranceAccidentNo || "-"}
피보험자 : ${caseData.insuredName || "-"}
사고장소 : ${getFullAddress()}
진행상태 : ${rejectionStatus}`;
    } else if (stage === "종결") {
      // 종결은 다이얼로그 없이 자동 발송되므로 이 미리보기는 사용되지 않음
      // 실제 메시지는 백엔드에서 정산 정보를 조회하여 생성됨
      return `접수번호 : ${caseData.caseNumber || "-"}
보험사 : ${caseData.insuranceCompany || "-"}
증권번호 : ${caseData.insurancePolicyNo || "-"}
사고번호 : ${caseData.insuranceAccidentNo || "-"}
피보험자 : ${caseData.insuredName || "-"}
사고장소 : ${getFullAddress()}

위 접수건이 종결되었음을 알려드립니다.
지급금액 : (정산조회 데이터)원
자기부담금 : (정산조회 데이터)원
수수료 : (정산조회 데이터)원
합계금액 : (지급금액+자기부담금+수수료)원`;
    } else {
      return `접수번호 : ${caseData.caseNumber || "-"}
보험사 : ${caseData.insuranceCompany || "-"}
증권번호 : ${caseData.insurancePolicyNo || "-"}
사고번호 : ${caseData.insuranceAccidentNo || "-"}
피보험자 : ${caseData.insuredName || "-"}
사고장소 : ${getFullAddress()}
진행사항 : ${stage}`;
    }
  };

  // 접수취소 전용 UI
  if (stage === "접수취소") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-md"
          style={{ padding: 0, overflow: "hidden" }}
        >
          {/* 헤더 */}
          <div
            style={{
              padding: "20px 24px",
              borderBottom: "1px solid #E5E7EB",
              background: "#FFFFFF",
            }}
          >
            <DialogTitle
              style={{
                fontFamily: "Pretendard",
                fontSize: "18px",
                fontWeight: 700,
                color: "#0C0C0C",
                margin: 0,
              }}
            >
              접수취소 이메일 보험사 통지하기
            </DialogTitle>
          </div>

          {/* 케이스 정보 */}
          <div
            style={{
              margin: "16px 24px",
              background: "#F5F5F5",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            <div
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 600,
                color: "#0C0C0C",
                marginBottom: "8px",
              }}
            >
              {caseData.insuranceCompany || "보험사"}{" "}
              {caseData.insuranceAccidentNo || caseData.insurancePolicyNo}
            </div>
            <div
              style={{
                fontFamily: "Pretendard",
                fontSize: "12px",
                color: "#666666",
              }}
            >
              접수일:{" "}
              {caseData.receptionDate
                ? new Date(caseData.receptionDate).toLocaleDateString("ko-KR")
                : "-"}{" "}
              | 처리담당: {caseData.assignedPartner || "-"} | 의뢰일:{" "}
              {caseData.assignmentDate
                ? new Date(caseData.assignmentDate).toLocaleDateString("ko-KR")
                : "-"}{" "}
              | 긴급여부: {caseData.urgency || "-"}
            </div>
          </div>

          {/* 정보 테이블 */}
          <div style={{ margin: "0 24px 16px 24px" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "13px",
              }}
            >
              <tbody>
                <tr>
                  <td
                    style={{
                      padding: "10px 12px",
                      background: "rgba(0, 143, 237, 0.1)",
                      fontWeight: 500,
                      color: "#0C0C0C",
                      width: "40%",
                      border: "1px solid #E5E7EB",
                    }}
                  >
                    사고번호(증권번호)
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      background: "#FFFFFF",
                      border: "1px solid #E5E7EB",
                    }}
                  >
                    {caseData.insuranceAccidentNo || "-"} (
                    {caseData.insurancePolicyNo || "-"})
                  </td>
                </tr>
                <tr>
                  <td
                    style={{
                      padding: "10px 12px",
                      background: "rgba(0, 143, 237, 0.1)",
                      fontWeight: 500,
                      color: "#0C0C0C",
                      border: "1px solid #E5E7EB",
                    }}
                  >
                    접수번호
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      background: "#FFFFFF",
                      border: "1px solid #E5E7EB",
                    }}
                  >
                    {caseData.caseNumber || "-"}
                  </td>
                </tr>
                <tr>
                  <td
                    style={{
                      padding: "10px 12px",
                      background: "rgba(0, 143, 237, 0.1)",
                      fontWeight: 500,
                      color: "#0C0C0C",
                      border: "1px solid #E5E7EB",
                    }}
                  >
                    피보험자명
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      background: "#FFFFFF",
                      border: "1px solid #E5E7EB",
                    }}
                  >
                    {caseData.insuredName || "-"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 취소사유 입력 */}
          <div style={{ margin: "0 24px 20px 24px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
              }}
            >
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#0C0C0C",
                }}
              >
                취소사유 입력
              </span>
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "12px",
                  color: "#999999",
                }}
              >
                {cancelReason.length}/800
              </span>
            </div>
            <Textarea
              placeholder="취소사유를 입력해주세요"
              value={cancelReason}
              onChange={(e) => {
                if (e.target.value.length <= 800) {
                  setCancelReason(e.target.value);
                }
              }}
              style={{
                minHeight: "100px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                resize: "none",
              }}
              data-testid="textarea-cancel-reason"
            />
          </div>

          {/* 수신자 이메일 */}
          <div style={{ margin: "0 24px 20px 24px" }}>
            <div
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 600,
                color: "#0C0C0C",
                marginBottom: "12px",
              }}
            >
              수신자 이메일
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: caseData.assessorEmail ? "pointer" : "default",
                }}
              >
                <Checkbox
                  id="assessor-recipient"
                  checked={sendToAssessor}
                  onCheckedChange={(checked) =>
                    setSendToAssessor(checked === true)
                  }
                  disabled={!caseData.assessorEmail}
                  data-testid="checkbox-assessor-recipient"
                />
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    color: caseData.assessorEmail ? "#0C0C0C" : "#999999",
                  }}
                >
                  {caseData.assessorEmail
                    ? `심사자 이메일: ${caseData.assessorEmail}`
                    : "심사자 정보없음"}
                </span>
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: caseData.investigatorEmail ? "pointer" : "default",
                }}
              >
                <Checkbox
                  id="investigator-recipient"
                  checked={sendToInvestigator}
                  onCheckedChange={(checked) =>
                    setSendToInvestigator(checked === true)
                  }
                  disabled={!caseData.investigatorEmail}
                  data-testid="checkbox-investigator-recipient"
                />
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    color: caseData.investigatorEmail ? "#0C0C0C" : "#999999",
                  }}
                >
                  {caseData.investigatorEmail
                    ? `조사자 이메일: ${caseData.investigatorEmail}`
                    : "조사자 정보없음"}
                </span>
              </label>
              <Input
                type="email"
                placeholder="이메일 주소를 입력해주세요"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                style={{
                  marginTop: "4px",
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                }}
                data-testid="input-manual-email"
              />
            </div>
          </div>

          {/* 버튼 */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "8px",
              padding: "16px 24px",
              borderTop: "1px solid #E5E7EB",
              background: "#FAFAFA",
            }}
          >
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={sendCancellationEmailMutation.isPending}
              data-testid="button-cancel-notification"
              style={{ minWidth: "80px" }}
            >
              취소
            </Button>
            <Button
              onClick={() => {
                if (!sendToAssessor && !sendToInvestigator && !manualEmail.trim()) {
                  toast({
                    title: "수신자 선택 필요",
                    description: "최소 1명의 수신자를 선택해주세요.",
                    variant: "destructive",
                  });
                  return;
                }
                sendCancellationEmailMutation.mutate();
              }}
              disabled={sendCancellationEmailMutation.isPending}
              data-testid="button-send-notification"
              style={{
                minWidth: "100px",
                background: "#008FED",
              }}
            >
              {sendCancellationEmailMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  발송 중...
                </>
              ) : (
                <>이메일 발송</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            {getStageDisplayName()} 알림 발송
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted/50 p-4 rounded-md">
            <Label className="text-sm font-medium mb-2 block">
              메시지 미리보기
            </Label>
            <pre className="text-xs whitespace-pre-wrap font-mono bg-background p-3 rounded border">
              &lt;{getStageDisplayName()} 알림&gt;{"\n\n"}
              {getMessagePreview()}
              {additionalMessage && `\n\n추가사항 : ${additionalMessage}`}
            </pre>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">추가 메시지 (선택)</Label>
            <Textarea
              placeholder="추가 메시지를 입력해주세요 (선택사항)"
              value={additionalMessage}
              onChange={(e) => setAdditionalMessage(e.target.value)}
              className="min-h-[60px]"
              data-testid="textarea-additional-message"
            />
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">수신자 선택</Label>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="partner"
                  checked={recipients.partner}
                  onCheckedChange={(checked) =>
                    setRecipients((prev) => ({ ...prev, partner: !!checked }))
                  }
                  data-testid="checkbox-partner"
                />
                <Label
                  htmlFor="partner"
                  className="text-sm cursor-pointer flex items-center gap-1"
                >
                  협력업체
                  {caseData.assignedPartnerContact ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <X className="h-3 w-3 text-muted-foreground" />
                  )}
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="manager"
                  checked={recipients.manager}
                  onCheckedChange={(checked) =>
                    setRecipients((prev) => ({ ...prev, manager: !!checked }))
                  }
                  data-testid="checkbox-manager"
                />
                <Label
                  htmlFor="manager"
                  className="text-sm cursor-pointer flex items-center gap-1"
                >
                  플록슨담당자
                  {caseData.managerId ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <X className="h-3 w-3 text-muted-foreground" />
                  )}
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="assessorInvestigator"
                  checked={recipients.assessorInvestigator}
                  onCheckedChange={(checked) =>
                    setRecipients((prev) => ({
                      ...prev,
                      assessorInvestigator: !!checked,
                    }))
                  }
                  data-testid="checkbox-assessor-investigator"
                />
                <Label
                  htmlFor="assessorInvestigator"
                  className="text-sm cursor-pointer flex items-center gap-1"
                >
                  심사자 및 조사자
                  {caseData.assessorContact || caseData.investigatorContact ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <X className="h-3 w-3 text-muted-foreground" />
                  )}
                </Label>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              * 연락처가 등록된 수신자에게만 발송됩니다.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sendNotificationMutation.isPending}
            data-testid="button-cancel-notification"
          >
            취소
          </Button>
          <Button
            onClick={handleSend}
            disabled={sendNotificationMutation.isPending}
            data-testid="button-send-notification"
          >
            {sendNotificationMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                발송 중...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                발송
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { NotificationStage, RecipientConfig };
