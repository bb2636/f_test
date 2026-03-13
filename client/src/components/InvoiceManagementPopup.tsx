import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar as CalendarIcon, Plus, Minus } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/use-permissions";

interface RelatedCase {
  id: string;
  caseNumber?: string | null;
  recoveryType?: string | null;
  estimateAmount?: number | null;
  paymentCompletedDate?: string | null;
  partialPaymentDate?: string | null;
  settlementCompletedDate?: string | null;
}

interface InvoiceManagementPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseData: {
    id: string;
    caseNumber?: string | null;
    insuranceCompany?: string | null;
    insuranceAccidentNo?: string | null;
    receptionDate?: string | null;
    clientName?: string | null;
    clientContact?: string | null;
    recoveryType?: string | null;
    invoiceDamagePreventionAmount?: string | null;
    invoicePropertyRepairAmount?: string | null;
    fieldDispatchInvoiceAmount?: string | null;
    status?: string | null;
    claimDate?: string | null;
    assignedPartner?: string | null;
    assignedPartnerManager?: string | null;
    assignedPartnerContact?: string | null;
    accidentType?: string | null;
    taxInvoiceConfirmDate?: string | null;
    invoiceConfirmDate?: string | null;
    invoiceAttribute?: string | null;
    mainInvoiceLink?: string | null;
    paymentCompletedDate?: string | null;
    partialPaymentDate?: string | null;
    settlementCompletedDate?: string | null;
    insuredName?: string | null;
    assessorId?: string | null;
    invoicePdfGenerated?: string | null;
    fieldDispatchCost?: string | null;
    managerId?: string | null;
  } | null;
  estimateData?: {
    preventionEstimate: number;
    preventionApproved: number;
    propertyEstimate: number;
    propertyApproved: number;
  } | null;
  relatedCases?: RelatedCase[];
  managerName?: string;
  managerContact?: string;
  settlementCommission?: number;
  settlementClaimAmount?: number;
}

const FIXED_FIELD_DISPATCH_COST = 100000;

interface DepositEntry {
  id: string;
  depositDate: string;
  insuranceCompany: string;
  claimAmount: number;
  depositStatus: "입금" | "미입금";
  depositAmount: number;
  memo: string;
  depositCategory?: string;
}

interface PaymentEntry {
  id: string;
  paymentDate: string;
  insuranceCompany: string;
  depositAmount: number;
  paymentAmount: number;
  commission: number;
  paymentCategory: string;
  memo: string;
}

function getCaseSuffix(caseNumber: string | null | undefined): number {
  if (!caseNumber) return -1;
  const parts = caseNumber.split("-");
  if (parts.length < 2) return -1;
  const suffix = parseInt(parts[parts.length - 1], 10);
  return isNaN(suffix) ? -1 : suffix;
}

function getCaseNumberPrefix(caseNumber: string | null | undefined): string {
  if (!caseNumber) return "";
  const parts = caseNumber.split("-");
  return parts[0] || caseNumber;
}

const SECTION_HEADER_STYLE: React.CSSProperties = {
  background: "#4A90D9",
  color: "#FFFFFF",
  fontWeight: 700,
  fontSize: "16px",
  padding: "10px 16px",
};

const TABLE_CELL_STYLE: React.CSSProperties = {
  border: "1px solid #E0E0E0",
  padding: "8px 12px",
  fontSize: "14px",
  textAlign: "center",
  verticalAlign: "middle",
};

const TABLE_HEADER_CELL_STYLE: React.CSSProperties = {
  ...TABLE_CELL_STYLE,
  background: "#F5F7FA",
  fontWeight: 600,
  fontSize: "13px",
  color: "rgba(12, 12, 12, 0.7)",
};

const INLINE_COL_BASE: React.CSSProperties = {
  padding: "4px",
  fontSize: "13px",
  textAlign: "center",
  verticalAlign: "middle",
  borderRight: "1px solid #E0E0E0",
  boxSizing: "border-box",
};
const DEPOSIT_COLS = {
  col1: {
    ...INLINE_COL_BASE,
    flex: "0 0 120px",
    width: "120px",
  } as React.CSSProperties,
  col2: {
    ...INLINE_COL_BASE,
    flex: "0 0 110px",
    width: "110px",
  } as React.CSSProperties,
  col3: { ...INLINE_COL_BASE, flex: 1 } as React.CSSProperties,
  col4: { ...INLINE_COL_BASE, flex: 1 } as React.CSSProperties,
  col5: {
    ...INLINE_COL_BASE,
    flex: "0 0 120px",
    width: "120px",
  } as React.CSSProperties,
  col6: {
    ...INLINE_COL_BASE,
    flex: 1,
    borderRight: "none",
  } as React.CSSProperties,
};
const PAYMENT_COLS = {
  col1: {
    ...INLINE_COL_BASE,
    flex: "0 0 120px",
    width: "120px",
  } as React.CSSProperties,
  col2: {
    ...INLINE_COL_BASE,
    flex: "0 0 110px",
    width: "110px",
  } as React.CSSProperties,
  colDeposit: { ...INLINE_COL_BASE, flex: 1 } as React.CSSProperties,
  col3: { ...INLINE_COL_BASE, flex: 1 } as React.CSSProperties,
  col4: { ...INLINE_COL_BASE, flex: 1 } as React.CSSProperties,
  col5: {
    ...INLINE_COL_BASE,
    flex: "0 0 120px",
    width: "120px",
  } as React.CSSProperties,
  col6: {
    ...INLINE_COL_BASE,
    flex: 1,
    borderRight: "none",
  } as React.CSSProperties,
};

export function InvoiceManagementPopup({
  open,
  onOpenChange,
  caseData,
  estimateData,
  relatedCases = [],
  managerName = "-",
  managerContact = "-",
  settlementCommission,
  settlementClaimAmount,
}: InvoiceManagementPopupProps) {
  const { toast } = useToast();
  const { hasItem, isAdmin } = usePermissions();

  const { data: insuranceCompanyNames = [] } = useQuery<string[]>({
    queryKey: ["/api/insurance-companies"],
  });

  const lastLoadedCaseId = useRef<string | null>(null);

  const [submissionDate, setSubmissionDate] = useState<Date | undefined>(
    undefined,
  );
  const [acceptanceDate, setAcceptanceDate] = useState<string>("");
  const [settlementStatus, setSettlementStatus] = useState<string>("");

  const [preventionApprovedAmount, setPreventionApprovedAmount] =
    useState<string>("");
  const [propertyApprovedAmount, setPropertyApprovedAmount] =
    useState<string>("");
  const [deductibleAmount, setDeductibleAmount] = useState<string>("0");
  const [fieldDispatchCostAmount, setFieldDispatchCostAmount] =
    useState<string>(FIXED_FIELD_DISPATCH_COST.toString());

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [taxInvoiceDate, setTaxInvoiceDate] = useState<Date | undefined>(
    undefined,
  );
  const [partnerPaymentDate, setPartnerPaymentDate] = useState<string>("");
  const [depositDate, setDepositDate] = useState<Date | undefined>(undefined);
  const [totalApprovedAmountInput, setTotalApprovedAmountInput] =
    useState<string>("0");
  const [totalApprovedAmountOverride, setTotalApprovedAmountOverride] =
    useState<string | null>(null);
  const [showApprovalConfirm, setShowApprovalConfirm] = useState(false);
  const [showClosingConfirm, setShowClosingConfirm] = useState(false);
  const [invoiceIssued, setInvoiceIssued] = useState(false);
  const [closingProcessDate, setClosingProcessDate] = useState<
    Date | undefined
  >(undefined);
  const [depositEntries, setDepositEntries] = useState<DepositEntry[]>([]);
  const [paymentEntries, setPaymentEntries] = useState<PaymentEntry[]>([]);

  const [localInvoiceConfirmDate, setLocalInvoiceConfirmDate] = useState<
    string | null
  >(caseData?.invoiceConfirmDate || null);

  useEffect(() => {
    setLocalInvoiceConfirmDate(caseData?.invoiceConfirmDate || null);
  }, [caseData?.invoiceConfirmDate]);

  useEffect(() => {
    setTotalApprovedAmountOverride(null);
  }, [caseData?.id]);

  const isInvoiceApproved = !!localInvoiceConfirmDate;
  const canApproveInvoice = hasItem("관리자 설정", "인보이스 승인");

  const handleSettlementStatusChange = (value: string) => {
    setSettlementStatus(value);
  };

  const baseTotalApprovedAmount = useMemo(() => {
    if (caseData?.recoveryType === "선견적요청") {
      return (
        parseInt(caseData?.fieldDispatchInvoiceAmount || "0") ||
        FIXED_FIELD_DISPATCH_COST
      );
    }
    return (
      (parseInt(preventionApprovedAmount || "0") || 0) +
      (parseInt(propertyApprovedAmount || "0") || 0)
    );
  }, [
    caseData?.recoveryType,
    caseData?.fieldDispatchInvoiceAmount,
    preventionApprovedAmount,
    propertyApprovedAmount,
  ]);

  const totalApprovedAmount = useMemo(() => {
    if (totalApprovedAmountOverride !== null) {
      return parseInt(totalApprovedAmountOverride || "0") || 0;
    }
    return baseTotalApprovedAmount;
  }, [baseTotalApprovedAmount, totalApprovedAmountOverride]);

  const feeAmount = useMemo(() => {
    if (
      settlementCommission !== undefined &&
      settlementCommission > 0 &&
      totalApprovedAmountOverride === null
    ) {
      return settlementCommission;
    }
    return Math.round(totalApprovedAmount * 0.077);
  }, [totalApprovedAmount, settlementCommission, totalApprovedAmountOverride]);

  const partnerPaymentAmount = useMemo(() => {
    return totalApprovedAmount - feeAmount;
  }, [totalApprovedAmount, feeAmount]);

  const depositTotals = useMemo(() => {
    const totalClaim = depositEntries.reduce(
      (sum, entry) => sum + entry.claimAmount,
      0,
    );
    const totalDeposit = depositEntries.reduce(
      (sum, entry) => sum + entry.depositAmount,
      0,
    );
    return { totalClaim, totalDeposit };
  }, [depositEntries]);

  const paymentTotals = useMemo(() => {
    const totalPayment = paymentEntries.reduce(
      (sum, entry) => sum + entry.paymentAmount,
      0,
    );
    const totalCommission = paymentEntries.reduce(
      (sum, entry) => sum + entry.commission,
      0,
    );
    return { totalPayment, totalCommission };
  }, [paymentEntries]);

  const claimAmount = useMemo(() => {
    const deductible = parseInt(deductibleAmount || "0");
    return totalApprovedAmount - deductible;
  }, [totalApprovedAmount, deductibleAmount]);

  const outstandingAmount = useMemo(() => {
    return claimAmount - depositTotals.totalDeposit;
  }, [claimAmount, depositTotals.totalDeposit]);

  const handleAddDepositRow = () => {
    const newEntry: DepositEntry = {
      id: `deposit-${Date.now()}`,
      depositDate: "",
      insuranceCompany: caseData?.insuranceCompany || "전체",
      claimAmount: 0,
      depositStatus: "미입금",
      depositAmount: 0,
      memo: "",
      depositCategory: "",
    };
    setDepositEntries([...depositEntries, newEntry]);
  };

  const handleRemoveDepositRow = () => {
    if (depositEntries.length > 0) {
      setDepositEntries(depositEntries.slice(0, -1));
    }
  };

  const handleUpdateDepositEntry = (
    index: number,
    field: keyof DepositEntry,
    value: unknown,
  ) => {
    const updated = [...depositEntries];
    (updated[index] as Record<string, unknown>)[field] = value;
    updated[index] = { ...updated[index] };
    setDepositEntries(updated);
  };

  const handleAddPaymentRow = () => {
    const newEntry: PaymentEntry = {
      id: `payment-${Date.now()}`,
      paymentDate: "",
      insuranceCompany: caseData?.insuranceCompany || "전체",
      depositAmount: 0,
      paymentAmount: 0,
      commission: 0,
      paymentCategory: "",
      memo: "",
    };
    setPaymentEntries([...paymentEntries, newEntry]);
  };

  const handleRemovePaymentRow = () => {
    if (paymentEntries.length > 0) {
      setPaymentEntries(paymentEntries.slice(0, -1));
    }
  };

  const handleUpdatePaymentEntry = (
    index: number,
    field: keyof PaymentEntry,
    value: unknown,
  ) => {
    const updated = [...paymentEntries];
    const entry = { ...updated[index], [field]: value } as PaymentEntry;

    if (field === "depositAmount") {
      const dep = (value as number) || 0;
      const payment = Math.round(dep / 1.077);
      const comm = dep - payment;
      entry.paymentAmount = payment;
      entry.commission = comm;
    } else if (field === "paymentAmount") {
      const payment = (value as number) || 0;
      entry.commission = Math.round(payment * 0.077);
    }

    updated[index] = entry;
    setPaymentEntries(updated);
  };

  const handleSaveComplete = async () => {
    if (!caseData) return;

    setIsSubmitting(true);
    try {
      const caseGroupPrefix = getCaseNumberPrefix(caseData.caseNumber);
      const todayDate = format(new Date(), "yyyy-MM-dd");

      if (caseGroupPrefix) {
        const existingInvoice = await fetch(
          `/api/invoices/group/${encodeURIComponent(caseGroupPrefix)}`,
        );
        const existingInvoiceData = await existingInvoice.json();

        if (existingInvoiceData && existingInvoiceData.id) {
          const updateData: Record<string, string> = {
            deductible: deductibleAmount || "0",
            settlementStatus: settlementStatus || "",
          };
          if (totalApprovedAmountOverride !== null) {
            updateData.totalApprovedAmount = totalApprovedAmount.toString();
          }
          await apiRequest(
            "PATCH",
            `/api/invoices/${existingInvoiceData.id}`,
            updateData,
          );
        } else {
          const invoiceType =
            caseData.recoveryType === "선견적요청" ? "선견적요청" : "직접복구";
          const createData: Record<string, string> = {
            caseGroupPrefix: caseGroupPrefix,
            caseId: caseData.id,
            type: invoiceType,
            deductible: deductibleAmount || "0",
            settlementStatus: settlementStatus || "",
          };
          if (totalApprovedAmountOverride !== null) {
            createData.totalApprovedAmount = totalApprovedAmount.toString();
          }
          await apiRequest("POST", "/api/invoices", createData);
        }
      }

      const settlementResponse = await fetch(
        `/api/settlements/case/${caseData.id}/latest`,
      );
      const settlementData = await settlementResponse.json();

      const totalDepositAmount = depositEntries.reduce(
        (sum, entry) => sum + entry.depositAmount,
        0,
      );

      const savedCommission = paymentTotals.totalCommission > 0 ? paymentTotals.totalCommission.toString() : "0";
      const savedPartnerPayment = paymentTotals.totalPayment > 0 ? paymentTotals.totalPayment.toString() : "0";

      if (settlementData && settlementData.id) {
        const settlementUpdateData: Record<string, unknown> = {
          deductible: deductibleAmount || "0",
          discount: totalDepositAmount.toString(),
          depositEntries: depositEntries,
          paymentEntries: paymentEntries,
          commission: savedCommission,
          partnerPaymentAmount: savedPartnerPayment,
        };

        if (settlementStatus === "정산") {
          settlementUpdateData.partnerPaymentDate = todayDate;
          settlementUpdateData.settlementDate = todayDate;
          settlementUpdateData.closingDate = todayDate;
          setPartnerPaymentDate(todayDate);
          setDepositDate(new Date());
        } else {
          settlementUpdateData.settlementDate = "";
          setDepositDate(undefined);
        }

        await apiRequest(
          "PATCH",
          `/api/settlements/${settlementData.id}`,
          settlementUpdateData,
        );
      } else {
        const settlementCreateData: Record<string, unknown> = {
          caseId: caseData.id,
          settlementAmount: "0",
          settlementDate: settlementStatus === "정산" ? todayDate : "",
          deductible: deductibleAmount || "0",
          discount: totalDepositAmount.toString(),
          depositEntries: depositEntries,
          paymentEntries: paymentEntries,
          commission: savedCommission,
          partnerPaymentAmount: savedPartnerPayment,
        };

        if (settlementStatus === "정산") {
          settlementCreateData.partnerPaymentDate = todayDate;
          settlementCreateData.closingDate = todayDate;
          setPartnerPaymentDate(todayDate);
          setDepositDate(new Date());
        } else {
          setDepositDate(undefined);
        }

        await apiRequest("POST", "/api/settlements", settlementCreateData);
      }

      const hasTaxInvoiceDate = !!taxInvoiceDate;
      const taxInvoiceDateStr = taxInvoiceDate
        ? format(taxInvoiceDate, "yyyy-MM-dd")
        : null;

      const hasMaxPayment = paymentEntries.some(
        (e) => e.paymentCategory === "최종액",
      );
      const hasPartialPaymentOnly =
        paymentEntries.length > 0 &&
        paymentEntries.every((e) => e.paymentCategory === "일부");

      if (
        settlementStatus === "정산" ||
        settlementStatus === "부분입금" ||
        hasTaxInvoiceDate ||
        hasMaxPayment ||
        hasPartialPaymentOnly
      ) {
        let newStatus: string;
        if (hasTaxInvoiceDate) {
          newStatus = "종결";
        } else if (hasMaxPayment) {
          newStatus = "지급완료";
        } else if (hasPartialPaymentOnly) {
          newStatus = "부분지급";
        } else if (settlementStatus === "정산") {
          newStatus = "입금완료";
        } else {
          newStatus = "부분입금";
        }

        const caseUpdateData: Record<string, unknown> = {
          status: newStatus,
          paymentCompletedDate: caseData.paymentCompletedDate || undefined,
          partialPaymentDate: caseData.partialPaymentDate || undefined,
          settlementCompletedDate:
            caseData.settlementCompletedDate || undefined,
        };

        if (settlementStatus === "정산") {
          caseUpdateData.paymentCompletedDate = todayDate;
        } else if (settlementStatus === "부분입금") {
          caseUpdateData.partialPaymentDate = todayDate;
        }

        if (hasTaxInvoiceDate && taxInvoiceDateStr) {
          caseUpdateData.taxInvoiceConfirmDate = taxInvoiceDateStr;
          caseUpdateData.settlementCompletedDate = taxInvoiceDateStr;
        }

        Object.keys(caseUpdateData).forEach((key) => {
          if (caseUpdateData[key] === undefined) {
            delete caseUpdateData[key];
          }
        });

        await apiRequest("PATCH", `/api/cases/${caseData.id}`, caseUpdateData);

        if (relatedCases && relatedCases.length > 0) {
          const updatePromises = relatedCases
            .filter((rc) => rc.id !== caseData.id)
            .map((rc) => {
              const rcUpdateData: Record<string, unknown> = {
                status: newStatus,
              };

              if (settlementStatus === "정산") {
                rcUpdateData.paymentCompletedDate = todayDate;
                if (rc.partialPaymentDate) {
                  rcUpdateData.partialPaymentDate = rc.partialPaymentDate;
                }
              } else if (settlementStatus === "부분입금") {
                rcUpdateData.partialPaymentDate = todayDate;
                if (rc.paymentCompletedDate) {
                  rcUpdateData.paymentCompletedDate = rc.paymentCompletedDate;
                }
              }

              if (hasTaxInvoiceDate && taxInvoiceDateStr) {
                rcUpdateData.settlementCompletedDate = taxInvoiceDateStr;
              } else if (rc.settlementCompletedDate) {
                rcUpdateData.settlementCompletedDate =
                  rc.settlementCompletedDate;
              }

              return apiRequest("PATCH", `/api/cases/${rc.id}`, rcUpdateData);
            });
          await Promise.all(updatePromises);
        }
      }

      if (hasTaxInvoiceDate) {
        try {
          await apiRequest("POST", "/api/send-stage-notification", {
            caseId: caseData.id,
            stage: "종결",
            recipients: {
              partner: true,
              manager: false,
              assessorInvestigator: false,
            },
          });
        } catch (smsError) {
          console.error("종결 SMS 발송 실패:", smsError);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settlements"] });

      const updatedCount = relatedCases ? relatedCases.length : 1;
      toast({
        title: "저장 완료",
        description: hasTaxInvoiceDate
          ? `종결 처리되었습니다. (${updatedCount}건 상태 변경)`
          : settlementStatus === "정산"
            ? `정산이 완료되었습니다. (${updatedCount}건 상태 변경)`
            : settlementStatus === "부분입금"
              ? `부분입금 처리되었습니다. (${updatedCount}건 상태 변경)`
              : "정산 정보가 저장되었습니다.",
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "저장 실패",
        description: "저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDeposits = async () => {
    if (!caseData) return;

    const missingCategory = depositEntries.some(
      (entry) =>
        (entry.depositDate || entry.depositAmount > 0) &&
        !entry.depositCategory,
    );
    if (missingCategory) {
      toast({
        title: "입력 오류",
        description: "입금구분을 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const settlementResponse = await fetch(
        `/api/settlements/case/${caseData.id}/latest`,
      );
      const settlementData = await settlementResponse.json();

      const totalDepositAmount = depositEntries.reduce(
        (sum, entry) => sum + entry.depositAmount,
        0,
      );

      const depositCategory =
        depositEntries.length > 0
          ? depositEntries[depositEntries.length - 1].depositCategory || ""
          : "";

      if (settlementData && settlementData.id) {
        await apiRequest("PATCH", `/api/settlements/${settlementData.id}`, {
          depositEntries: depositEntries,
          discount: totalDepositAmount.toString(),
        });
      } else {
        await apiRequest("POST", "/api/settlements", {
          caseId: caseData.id,
          settlementAmount: "0",
          settlementDate: "",
          depositEntries: depositEntries,
          discount: totalDepositAmount.toString(),
        });
      }

      const finalEntry = depositEntries.find(
        (entry) => entry.depositCategory === "최종액",
      );
      if (finalEntry && finalEntry.depositDate && caseData.id) {
        await apiRequest("PATCH", `/api/cases/${caseData.id}`, {
          paymentCompletedDate: finalEntry.depositDate,
        });
        if (relatedCases && relatedCases.length > 0) {
          const rcPromises = relatedCases
            .filter((rc) => rc.id !== caseData.id)
            .map((rc) =>
              apiRequest("PATCH", `/api/cases/${rc.id}`, {
                paymentCompletedDate: finalEntry.depositDate,
              }),
            );
          await Promise.all(rcPromises);
        }
        queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/settlements"] });

      toast({
        title: "저장 완료",
        description: "입금내역이 저장되었습니다.",
      });
    } catch (error) {
      toast({
        title: "저장 실패",
        description: "입금내역 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSavePayments = async () => {
    if (!caseData) return;

    const missingCategory = paymentEntries.some(
      (entry) =>
        (entry.paymentAmount > 0 || entry.commission > 0) &&
        !entry.paymentCategory,
    );
    if (missingCategory) {
      toast({
        title: "입력 오류",
        description: "지급구분을 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const settlementResponse = await fetch(
        `/api/settlements/case/${caseData.id}/latest`,
      );
      const settlementData = await settlementResponse.json();

      if (settlementData && settlementData.id) {
        await apiRequest("PATCH", `/api/settlements/${settlementData.id}`, {
          paymentEntries: paymentEntries,
        });
      } else {
        await apiRequest("POST", "/api/settlements", {
          caseId: caseData.id,
          settlementAmount: "0",
          settlementDate: "",
          paymentEntries: paymentEntries,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/settlements"] });

      toast({
        title: "저장 완료",
        description: "지급내역이 저장되었습니다.",
      });
    } catch (error) {
      toast({
        title: "저장 실패",
        description: "지급내역 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTaxInvoiceDateSelect = (date: Date | undefined) => {
    setTaxInvoiceDate(date);
  };

  const handleInvoiceConfirm = async (dateStr: string) => {
    if (!caseData) return;

    setLocalInvoiceConfirmDate(dateStr);

    try {
      await apiRequest("PATCH", `/api/cases/${caseData.id}`, {
        invoiceConfirmDate: dateStr,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settlements"] });

      toast({
        title: "인보이스 확인",
        description: `인보이스가 확인되었습니다. (${dateStr})`,
      });
    } catch (error) {
      setLocalInvoiceConfirmDate(caseData?.invoiceConfirmDate || null);
      toast({
        title: "확인 실패",
        description: "인보이스 확인 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const handleInvoiceCancel = async () => {
    if (!caseData) return;

    const previousDate = localInvoiceConfirmDate;

    setLocalInvoiceConfirmDate(null);

    try {
      await apiRequest("PATCH", `/api/cases/${caseData.id}`, {
        invoiceConfirmDate: null,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settlements"] });

      toast({
        title: "인보이스 취소",
        description: "인보이스 확인이 취소되었습니다.",
      });
    } catch (error) {
      setLocalInvoiceConfirmDate(previousDate);
      toast({
        title: "취소 실패",
        description: "인보이스 취소 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const categorizedCases = useMemo(() => {
    const allCases =
      relatedCases.length > 0
        ? relatedCases
        : caseData
          ? [
              {
                id: caseData.id,
                caseNumber: caseData.caseNumber,
                recoveryType: caseData.recoveryType,
                estimateAmount: estimateData?.preventionEstimate || 0,
              },
            ]
          : [];

    const prevention = {
      directRecovery: [] as RelatedCase[],
      fieldDispatch: [] as RelatedCase[],
    };
    const property = {
      directRecovery: [] as RelatedCase[],
      fieldDispatch: [] as RelatedCase[],
    };

    allCases.forEach((c) => {
      const suffix = getCaseSuffix(c.caseNumber);
      if (suffix === 0) {
        if (c.recoveryType === "선견적요청") {
          prevention.fieldDispatch.push(c);
        } else {
          prevention.directRecovery.push(c);
        }
      } else if (suffix > 0) {
        if (c.recoveryType === "선견적요청") {
          property.fieldDispatch.push(c);
        } else {
          property.directRecovery.push(c);
        }
      }
    });

    return { prevention, property };
  }, [relatedCases, caseData, estimateData]);

  const displayEstimates = useMemo(() => {
    if (estimateData) {
      return {
        preventionEstimate: estimateData.preventionEstimate || 0,
        preventionApproved: estimateData.preventionApproved || 0,
        propertyEstimate: estimateData.propertyEstimate || 0,
        propertyApproved: estimateData.propertyApproved || 0,
      };
    }

    const preventionEstimate =
      categorizedCases.prevention.directRecovery.reduce(
        (sum, c) => sum + (c.estimateAmount || 0),
        0,
      );
    const propertyEstimate = categorizedCases.property.directRecovery.reduce(
      (sum, c) => sum + (c.estimateAmount || 0),
      0,
    );

    return {
      preventionEstimate,
      preventionApproved: preventionEstimate,
      propertyEstimate,
      propertyApproved: propertyEstimate,
    };
  }, [categorizedCases, estimateData]);

  useEffect(() => {
    if (!open) {
      lastLoadedCaseId.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (open && caseData) {
      const alreadyLoaded = lastLoadedCaseId.current === caseData.id;

      if (!alreadyLoaded) {
        lastLoadedCaseId.current = caseData.id;

        if (caseData.claimDate) {
          setSubmissionDate(new Date(caseData.claimDate));
        } else {
          setSubmissionDate(undefined);
        }
        setAcceptanceDate(caseData.receptionDate || "");

        setPreventionApprovedAmount(
          caseData.invoiceDamagePreventionAmount ||
            displayEstimates.preventionApproved.toString() ||
            "0",
        );

        setPropertyApprovedAmount(
          caseData.invoicePropertyRepairAmount ||
            displayEstimates.propertyApproved.toString() ||
            "0",
        );

        if (caseData.fieldDispatchCost) {
          setFieldDispatchCostAmount(caseData.fieldDispatchCost);
        } else {
          setFieldDispatchCostAmount(FIXED_FIELD_DISPATCH_COST.toString());
        }

        const loadAllData = async () => {
          let loadedDeductible = "0";
          let loadedSettlementStatus = "";

          try {
            const settlementResponse = await fetch(
              `/api/settlements/case/${caseData.id}/latest`,
            );
            if (settlementResponse.ok) {
              const settlementData = await settlementResponse.json();
              if (settlementData && settlementData.id) {
                if (settlementData.settlementDate) {
                  setDepositDate(new Date(settlementData.settlementDate));
                } else {
                  setDepositDate(undefined);
                }

                if (settlementData.partnerPaymentDate) {
                  setPartnerPaymentDate(settlementData.partnerPaymentDate);
                } else {
                  setPartnerPaymentDate("");
                }

                if (
                  settlementData.deductible &&
                  parseInt(settlementData.deductible) > 0
                ) {
                  loadedDeductible = settlementData.deductible;
                }

                if (
                  settlementData.depositEntries &&
                  Array.isArray(settlementData.depositEntries) &&
                  settlementData.depositEntries.length > 0
                ) {
                  setDepositEntries(settlementData.depositEntries);
                } else if (
                  settlementData.discount &&
                  parseInt(settlementData.discount) > 0
                ) {
                  const depositEntry: DepositEntry = {
                    id: `deposit-loaded-${Date.now()}`,
                    depositDate:
                      settlementData.settlementDate ||
                      format(new Date(), "yyyy-MM-dd"),
                    insuranceCompany: caseData.insuranceCompany || "전체",
                    claimAmount: 0,
                    depositStatus: "입금",
                    depositAmount: parseInt(settlementData.discount) || 0,
                    memo: "",
                  };
                  setDepositEntries([depositEntry]);
                } else {
                  setDepositEntries([]);
                }

                if (
                  settlementData.paymentEntries &&
                  Array.isArray(settlementData.paymentEntries) &&
                  settlementData.paymentEntries.length > 0
                ) {
                  setPaymentEntries(settlementData.paymentEntries);
                } else {
                  setPaymentEntries([]);
                }
              } else {
                setDepositDate(undefined);
                setDepositEntries([]);
                setPaymentEntries([]);
                setPartnerPaymentDate("");
              }
            } else {
              setDepositDate(undefined);
              setDepositEntries([]);
              setPaymentEntries([]);
              setPartnerPaymentDate("");
            }
          } catch (error) {
            console.error("Failed to load settlement data:", error);
            setDepositDate(undefined);
            setDepositEntries([]);
            setPaymentEntries([]);
            setPartnerPaymentDate("");
          }

          try {
            const caseGroupPrefix = caseData.caseNumber?.split("-")[0] || "";
            if (caseGroupPrefix) {
              const response = await fetch(
                `/api/invoices/group/${encodeURIComponent(caseGroupPrefix)}`,
                {
                  cache: "no-store",
                  headers: { "Cache-Control": "no-cache" },
                },
              );
              if (response.ok) {
                const invoiceData = await response.json();
                if (invoiceData) {
                  if (
                    invoiceData.deductible &&
                    parseInt(invoiceData.deductible) > 0
                  ) {
                    loadedDeductible = invoiceData.deductible;
                  }
                  if (invoiceData.settlementStatus) {
                    loadedSettlementStatus = invoiceData.settlementStatus;
                  }
                  if (
                    invoiceData.totalApprovedAmount &&
                    parseInt(invoiceData.totalApprovedAmount) > 0
                  ) {
                    setTotalApprovedAmountOverride(
                      invoiceData.totalApprovedAmount,
                    );
                  }
                }
              }
            }
          } catch (error) {
            console.error("Failed to load invoice data:", error);
          }

          setDeductibleAmount(loadedDeductible);
          setSettlementStatus(loadedSettlementStatus);
        };
        loadAllData();

        if (caseData.taxInvoiceConfirmDate) {
          setTaxInvoiceDate(new Date(caseData.taxInvoiceConfirmDate));
          setInvoiceIssued(true);
          setClosingProcessDate(new Date(caseData.taxInvoiceConfirmDate));
        } else {
          setTaxInvoiceDate(undefined);
          setInvoiceIssued(false);
          setClosingProcessDate(undefined);
        }
      }
    }
  }, [open, caseData, displayEstimates]);

  const handleApprove = async () => {
    if (!caseData) return;

    setIsSubmitting(true);
    try {
      const caseGroupPrefix = getCaseNumberPrefix(caseData.caseNumber);
      const todayDate = format(new Date(), "yyyy-MM-dd");

      const invoiceData = {
        caseId: caseData.id,
        caseGroupPrefix,
        type: caseData.recoveryType || "직접복구",
        status: "approved" as const,
        damagePreventionEstimate:
          displayEstimates.preventionEstimate.toString(),
        damagePreventionApproved: preventionApprovedAmount || "0",
        propertyRepairEstimate: displayEstimates.propertyEstimate.toString(),
        propertyRepairApproved: propertyApprovedAmount || "0",
        fieldDispatchAmount: null,
        totalApprovedAmount: totalApprovedAmount.toString(),
        deductible: deductibleAmount || "0",
        submissionDate: submissionDate
          ? format(submissionDate, "yyyy-MM-dd")
          : null,
        settlementStatus,
        remarks: null,
      };

      const existingInvoice = await fetch(
        `/api/invoices/group/${encodeURIComponent(caseGroupPrefix)}`,
      );
      const existingInvoiceData = await existingInvoice.json();

      if (existingInvoiceData && existingInvoiceData.id) {
        await apiRequest("PATCH", `/api/invoices/${existingInvoiceData.id}`, {
          ...invoiceData,
          approvedAt: new Date().toISOString(),
        });
      } else {
        await apiRequest("POST", "/api/invoices", invoiceData);
      }

      const today = new Date();
      const invoiceConfirmDateValue = format(today, "yyyy.MM.dd");

      const settlementResponse = await fetch(
        `/api/settlements/case/${caseData.id}/latest`,
      );
      const settlementData = await settlementResponse.json();

      const totalDepositAmount = depositEntries.reduce(
        (sum, entry) => sum + entry.depositAmount,
        0,
      );

      const savedCommission2 = paymentTotals.totalCommission > 0 ? paymentTotals.totalCommission.toString() : "0";
      const savedPartnerPayment2 = paymentTotals.totalPayment > 0 ? paymentTotals.totalPayment.toString() : "0";

      if (settlementData && settlementData.id) {
        const settlementUpdateData: Record<string, unknown> = {
          deductible: deductibleAmount || "0",
          discount: totalDepositAmount.toString(),
          depositEntries: depositEntries,
          paymentEntries: paymentEntries,
          commission: savedCommission2,
          partnerPaymentAmount: savedPartnerPayment2,
        };

        if (settlementStatus === "정산") {
          settlementUpdateData.partnerPaymentDate = todayDate;
          settlementUpdateData.settlementDate = todayDate;
          settlementUpdateData.closingDate = todayDate;
          setPartnerPaymentDate(todayDate);
          setDepositDate(new Date());
        } else {
          settlementUpdateData.settlementDate = "";
          setDepositDate(undefined);
        }

        await apiRequest(
          "PATCH",
          `/api/settlements/${settlementData.id}`,
          settlementUpdateData,
        );
      } else {
        const settlementCreateData: Record<string, unknown> = {
          caseId: caseData.id,
          settlementAmount: "0",
          settlementDate: settlementStatus === "정산" ? todayDate : "",
          deductible: deductibleAmount || "0",
          discount: totalDepositAmount.toString(),
          depositEntries: depositEntries,
          paymentEntries: paymentEntries,
          commission: savedCommission2,
          partnerPaymentAmount: savedPartnerPayment2,
        };

        if (settlementStatus === "정산") {
          settlementCreateData.partnerPaymentDate = todayDate;
          settlementCreateData.closingDate = todayDate;
          setPartnerPaymentDate(todayDate);
          setDepositDate(new Date());
        } else {
          setDepositDate(undefined);
        }

        await apiRequest("POST", "/api/settlements", settlementCreateData);
      }

      if (settlementStatus === "정산" || settlementStatus === "부분입금") {
        const newStatus = settlementStatus === "정산" ? "정산완료" : "부분입금";

        await apiRequest("PATCH", `/api/cases/${caseData.id}`, {
          invoiceDamagePreventionAmount: preventionApprovedAmount,
          invoicePropertyRepairAmount: propertyApprovedAmount,
          invoiceConfirmDate: invoiceConfirmDateValue,
          status: newStatus,
        });

        if (relatedCases && relatedCases.length > 0) {
          const updatePromises = relatedCases
            .filter((rc) => rc.id !== caseData.id)
            .map((rc) =>
              apiRequest("PATCH", `/api/cases/${rc.id}`, {
                status: newStatus,
              }),
            );
          await Promise.all(updatePromises);
        }
      } else {
        await apiRequest("PATCH", `/api/cases/${caseData.id}`, {
          invoiceDamagePreventionAmount: preventionApprovedAmount,
          invoicePropertyRepairAmount: propertyApprovedAmount,
          invoiceConfirmDate: invoiceConfirmDateValue,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settlements"] });

      const updatedCount = relatedCases ? relatedCases.length : 1;
      toast({
        title: "인보이스 승인 완료",
        description:
          settlementStatus === "정산"
            ? `정산이 완료되었습니다. (${updatedCount}건 상태 변경)`
            : settlementStatus === "부분입금"
              ? `부분입금 처리되었습니다. (${updatedCount}건 상태 변경)`
              : `총 승인금액: ${totalApprovedAmount.toLocaleString()}원`,
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: "승인 실패",
        description: "인보이스 승인 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!caseData) return null;

  const preventionAmount = parseInt(preventionApprovedAmount || "0") || 0;
  const propertyAmount = parseInt(propertyApprovedAmount || "0") || 0;
  const claimTotal = preventionAmount + propertyAmount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[810px] p-0 gap-0"
        style={{
          fontFamily: "Pretendard",
          background: "#FDFDFD",
          boxShadow: "0px 0px 20px #DBE9F5",
          borderRadius: "12px",
          maxHeight: "90vh",
          overflow: "hidden",
        }}
      >
        <DialogHeader
          className="flex flex-row items-center justify-center px-6 py-6"
          style={{
            borderBottom: "2px solid rgba(12, 12, 12, 0.1)",
          }}
        >
          <DialogTitle
            style={{
              fontFamily: "Pretendard",
              fontSize: "22px",
              fontWeight: 600,
              color: "#0C0C0C",
              textAlign: "center",
            }}
          >
            인보이스 관리
          </DialogTitle>
        </DialogHeader>

        <div
          className="overflow-y-auto"
          style={{
            padding: "24px 24px 0 24px",
            maxHeight: "calc(90vh - 187px)",
          }}
        >
          <div className="flex flex-col gap-5 p-0">
            {/* Section 1: 기본정보 */}
            <div style={{ overflow: "hidden" }}>
              <div
                style={SECTION_HEADER_STYLE}
                data-testid="section-basic-info"
              >
                기본정보
              </div>
              <div style={{ border: "1px solid #E0E0E0", borderTop: "none" }}>
                <div
                  className="flex"
                  style={{ borderBottom: "1px solid #E0E0E0" }}
                >
                  <div
                    style={{
                      ...TABLE_HEADER_CELL_STYLE,
                      width: "120px",
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderLeft: "none",
                      borderTop: "none",
                    }}
                  >
                    보험사
                  </div>
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      flex: 1,
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderTop: "none",
                    }}
                    data-testid="text-insurance-company"
                  >
                    {caseData.insuranceCompany || "-"}
                  </div>
                  <div
                    style={{
                      ...TABLE_HEADER_CELL_STYLE,
                      width: "120px",
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderTop: "none",
                    }}
                  >
                    (보험사) 심사자
                  </div>
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      flex: 1,
                      borderBottom: "none",
                      borderRight: "none",
                      borderTop: "none",
                    }}
                    data-testid="text-assessor"
                  >
                    {caseData.assessorId || "-"}
                  </div>
                </div>
                <div
                  className="flex"
                  style={{ borderBottom: "1px solid #E0E0E0" }}
                >
                  <div
                    style={{
                      ...TABLE_HEADER_CELL_STYLE,
                      width: "120px",
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderLeft: "none",
                      borderTop: "none",
                    }}
                  >
                    사고번호
                  </div>
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      flex: 1,
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderTop: "none",
                    }}
                    data-testid="text-accident-no"
                  >
                    {caseData.insuranceAccidentNo || "-"}
                  </div>
                  <div
                    style={{
                      ...TABLE_HEADER_CELL_STYLE,
                      width: "120px",
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderTop: "none",
                    }}
                  >
                    보험사 청구일
                  </div>
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      flex: 1,
                      borderBottom: "none",
                      borderRight: "none",
                      borderTop: "none",
                    }}
                    data-testid="text-invoice-date"
                  >
                    {caseData.invoicePdfGenerated || "-"}
                  </div>
                </div>
                <div className="flex">
                  <div
                    style={{
                      ...TABLE_HEADER_CELL_STYLE,
                      width: "120px",
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderLeft: "none",
                      borderTop: "none",
                    }}
                  >
                    협력업체
                  </div>
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      flex: 1,
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderTop: "none",
                    }}
                    data-testid="text-partner"
                  >
                    {caseData.assignedPartner || "-"}
                  </div>
                  <div
                    style={{
                      ...TABLE_HEADER_CELL_STYLE,
                      width: "120px",
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderTop: "none",
                    }}
                  >
                    (플록슨) 담당자
                  </div>
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      flex: 1,
                      borderBottom: "none",
                      borderRight: "none",
                      borderTop: "none",
                    }}
                    data-testid="text-manager"
                  >
                    {managerName}
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: 청구내역 */}
            <div style={{ overflow: "hidden" }}>
              <div
                style={SECTION_HEADER_STYLE}
                data-testid="section-claim-details"
              >
                청구내역
              </div>
              <div style={{ border: "1px solid #E0E0E0", borderTop: "none" }}>
                {/* Header row */}
                <div
                  className="flex"
                  style={{ borderBottom: "1px solid #E0E0E0" }}
                >
                  <div
                    style={{
                      ...TABLE_HEADER_CELL_STYLE,
                      width: "120px",
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderLeft: "none",
                      borderTop: "none",
                    }}
                  >
                    청구금액 구분
                  </div>
                  <div
                    style={{
                      ...TABLE_HEADER_CELL_STYLE,
                      flex: 1,
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderTop: "none",
                    }}
                  >
                    손해방지비용
                  </div>
                  <div
                    style={{
                      ...TABLE_HEADER_CELL_STYLE,
                      flex: 1,
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderTop: "none",
                    }}
                  >
                    대물비용
                  </div>
                  <div
                    style={{
                      ...TABLE_HEADER_CELL_STYLE,
                      flex: 1,
                      borderBottom: "none",
                      borderRight: "none",
                      borderTop: "none",
                    }}
                  >
                    합계
                  </div>
                </div>
                {/* Data row */}
                <div
                  className="flex"
                  style={{ borderBottom: "1px solid #E0E0E0" }}
                >
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      width: "120px",
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderLeft: "none",
                      borderTop: "none",
                      background: "#F5F7FA",
                      color: "rgba(12,12,12,0.7)",
                      fontWeight: 600,
                      fontSize: "13px",
                    }}
                  ></div>
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      flex: 1,
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderTop: "none",
                    }}
                    data-testid="text-prevention-amount"
                  >
                    {preventionAmount.toLocaleString()}원
                  </div>
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      flex: 1,
                      borderRight: "1px solid #E0E0E0",
                      borderBottom: "none",
                      borderTop: "none",
                    }}
                    data-testid="text-property-amount"
                  >
                    {propertyAmount.toLocaleString()}원
                  </div>
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      flex: 1,
                      borderBottom: "none",
                      borderRight: "none",
                      borderTop: "none",
                      fontWeight: 600,
                    }}
                    data-testid="text-claim-total"
                  >
                    {claimTotal.toLocaleString()}원
                  </div>
                </div>
                {/* 자기부담금 row */}
                <div
                  className="flex"
                  style={{ borderBottom: "1px solid #E0E0E0" }}
                >
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      width: "120px",
                      borderRight: "none",
                      borderBottom: "none",
                      borderLeft: "none",
                      borderTop: "none",
                      background: "#F5F7FA",
                      color: "rgba(12,12,12,0.7)",
                      fontWeight: 600,
                      fontSize: "13px",
                    }}
                  >
                    자기부담금
                  </div>
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      flex: 2,
                      borderRight: "none",
                      borderBottom: "none",
                      borderTop: "none",
                    }}
                  ></div>
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      flex: 1,
                      borderBottom: "none",
                      borderRight: "none",
                      borderTop: "none",
                      borderLeft: "none",
                      padding: "4px 8px",
                    }}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <Input
                        type="text"
                        value={
                          deductibleAmount
                            ? parseInt(deductibleAmount).toLocaleString()
                            : "0"
                        }
                        onChange={(e) => {
                          const value = e.target.value
                            .replace(/,/g, "")
                            .replace(/[^0-9]/g, "");
                          setDeductibleAmount(value || "0");
                        }}
                        data-testid="input-deductible-amount"
                        style={{
                          width: "100px",
                          textAlign: "right",
                          fontWeight: 400,
                          fontSize: "14px",
                          padding: "4px 8px",
                          height: "32px",
                          border: "2px dashed #E53935",
                          borderRadius: "4px",
                          background: "#FFFFFF",
                        }}
                      />
                      <span style={{ fontSize: "14px" }}>원</span>
                    </div>
                  </div>
                </div>
                {/* 출동비 row */}
                <div className="flex">
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      width: "120px",
                      borderRight: "none",
                      borderBottom: "none",
                      borderLeft: "none",
                      borderTop: "none",
                      background: "#F5F7FA",
                      color: "rgba(12,12,12,0.7)",
                      fontWeight: 600,
                      fontSize: "13px",
                    }}
                  >
                    출동비
                  </div>
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      flex: 2,
                      borderRight: "none",
                      borderBottom: "none",
                      borderTop: "none",
                    }}
                  ></div>
                  <div
                    style={{
                      ...TABLE_CELL_STYLE,
                      flex: 1,
                      borderBottom: "none",
                      borderRight: "none",
                      borderTop: "none",
                      borderLeft: "none",
                      padding: "4px 8px",
                    }}
                  >
                    {caseData?.recoveryType === "선견적요청" ? (
                    <div className="flex items-center justify-center gap-1">
                      <Input
                        type="text"
                        value={
                          fieldDispatchCostAmount
                            ? parseInt(fieldDispatchCostAmount).toLocaleString()
                            : "100,000"
                        }
                        onChange={(e) => {
                          const value = e.target.value
                            .replace(/,/g, "")
                            .replace(/[^0-9]/g, "");
                          setFieldDispatchCostAmount(value || "100000");
                        }}
                        data-testid="input-field-dispatch-cost"
                        style={{
                          width: "100px",
                          textAlign: "right",
                          fontWeight: 400,
                          fontSize: "14px",
                          padding: "4px 8px",
                          height: "32px",
                          border: "2px dashed #4A90D9",
                          borderRadius: "4px",
                          background: "#FFFFFF",
                        }}
                      />
                      <span style={{ fontSize: "14px" }}>원</span>
                    </div>
                    ) : (
                      <span style={{ fontSize: "14px", color: "rgba(12,12,12,0.5)" }}>-</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Section 3: 입금관리 */}
              <div style={{ overflow: "hidden" }}>
                <div
                  className="flex items-center justify-between"
                  style={SECTION_HEADER_STYLE}
                  data-testid="section-deposit-management"
                >
                  <span>입금관리</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleAddDepositRow}
                      data-testid="button-add-deposit-row"
                      style={{
                        width: "24px",
                        height: "24px",
                        borderRadius: "4px",
                        background: "#3B82F6",
                        color: "#FFFFFF",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "16px",
                        fontWeight: 700,
                      }}
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      onClick={handleRemoveDepositRow}
                      data-testid="button-remove-deposit-row"
                      style={{
                        width: "24px",
                        height: "24px",
                        borderRadius: "4px",
                        background: "#EF4444",
                        color: "#FFFFFF",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "16px",
                        fontWeight: 700,
                      }}
                    >
                      <Minus size={14} />
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    border: "1px solid #E0E0E0",
                    borderTop: "none",
                    overflowX: "auto",
                  }}
                >
                  {/* Header */}
                  <div
                    className="flex"
                    style={{
                      borderBottom: "1px solid #E0E0E0",
                      minWidth: "750px",
                    }}
                  >
                    <div
                      style={{
                        ...DEPOSIT_COLS.col1,
                        background: "#F5F7FA",
                        fontWeight: 600,
                        color: "rgba(12,12,12,0.7)",
                        padding: "6px 4px",
                      }}
                    >
                      입금일자
                    </div>
                    <div
                      style={{
                        ...DEPOSIT_COLS.col2,
                        background: "#F5F7FA",
                        fontWeight: 600,
                        color: "rgba(12,12,12,0.7)",
                        padding: "6px 4px",
                      }}
                    >
                      보험사
                    </div>
                    <div
                      style={{
                        ...DEPOSIT_COLS.col3,
                        background: "#F5F7FA",
                        fontWeight: 600,
                        color: "rgba(12,12,12,0.7)",
                        padding: "6px 4px",
                      }}
                    >
                      청구액
                    </div>
                    <div
                      style={{
                        ...DEPOSIT_COLS.col4,
                        background: "#F5F7FA",
                        fontWeight: 600,
                        color: "rgba(12,12,12,0.7)",
                        padding: "6px 4px",
                      }}
                    >
                      입금액
                    </div>
                    <div
                      style={{
                        ...DEPOSIT_COLS.col5,
                        background: "#F5F7FA",
                        fontWeight: 600,
                        color: "rgba(12,12,12,0.7)",
                        padding: "6px 4px",
                      }}
                    >
                      입금구분
                    </div>
                    <div
                      style={{
                        ...DEPOSIT_COLS.col6,
                        background: "#F5F7FA",
                        fontWeight: 600,
                        color: "rgba(12,12,12,0.7)",
                        padding: "6px 4px",
                      }}
                    >
                      메모
                    </div>
                  </div>

                  {/* Data rows */}
                  {depositEntries.length === 0 ? (
                    <div
                      className="flex items-center justify-center"
                      style={{
                        padding: "20px",
                        color: "rgba(12, 12, 12, 0.4)",
                        fontSize: "14px",
                      }}
                    >
                      입금 내역이 없습니다. + 버튼을 눌러 추가하세요.
                    </div>
                  ) : (
                    depositEntries.map((entry, index) => (
                      <div
                        key={entry.id}
                        className="flex"
                        style={{
                          borderBottom:
                            index < depositEntries.length - 1
                              ? "1px solid #E0E0E0"
                              : "none",
                          minWidth: "750px",
                        }}
                      >
                        {/* 입금일자 */}
                        <div style={DEPOSIT_COLS.col1}>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className="justify-start text-left font-normal w-full"
                                data-testid={`button-deposit-date-${index}`}
                                style={{
                                  height: "32px",
                                  fontSize: "12px",
                                  padding: "0 6px",
                                  border: "1px solid #E0E0E0",
                                }}
                              >
                                <CalendarIcon
                                  size={12}
                                  style={{ marginRight: "4px", flexShrink: 0 }}
                                />
                                <span
                                  style={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {entry.depositDate || "날짜"}
                                </span>
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              className="w-auto p-0"
                              align="start"
                            >
                              <Calendar
                                mode="single"
                                selected={
                                  entry.depositDate
                                    ? new Date(entry.depositDate)
                                    : undefined
                                }
                                onSelect={(date) =>
                                  handleUpdateDepositEntry(
                                    index,
                                    "depositDate",
                                    date ? format(date, "yyyy-MM-dd") : "",
                                  )
                                }
                                locale={ko}
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                        {/* 보험사 */}
                        <div style={DEPOSIT_COLS.col2}>
                          <Select
                            value={entry.insuranceCompany}
                            onValueChange={(value) =>
                              handleUpdateDepositEntry(
                                index,
                                "insuranceCompany",
                                value,
                              )
                            }
                          >
                            <SelectTrigger
                              data-testid={`select-deposit-insurance-${index}`}
                              style={{
                                height: "32px",
                                fontSize: "12px",
                                border: "1px solid #E0E0E0",
                              }}
                            >
                              <SelectValue placeholder="전체" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="전체">전체</SelectItem>
                              {insuranceCompanyNames.map((companyName) => (
                                <SelectItem
                                  key={companyName}
                                  value={companyName}
                                >
                                  {companyName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {/* 청구액 */}
                        <div style={DEPOSIT_COLS.col3}>
                          <div className="flex items-center gap-1">
                            <Input
                              type="text"
                              value={
                                entry.claimAmount
                                  ? entry.claimAmount.toLocaleString()
                                  : ""
                              }
                              onChange={(e) => {
                                const value = e.target.value
                                  .replace(/,/g, "")
                                  .replace(/[^0-9]/g, "");
                                handleUpdateDepositEntry(
                                  index,
                                  "claimAmount",
                                  parseInt(value) || 0,
                                );
                              }}
                              data-testid={`input-deposit-claim-${index}`}
                              placeholder="0"
                              style={{
                                height: "32px",
                                fontSize: "12px",
                                padding: "4px 6px",
                                textAlign: "right",
                                flex: 1,
                              }}
                            />
                            <span style={{ fontSize: "12px", flexShrink: 0 }}>
                              원
                            </span>
                          </div>
                        </div>
                        {/* 입금액 */}
                        <div style={DEPOSIT_COLS.col4}>
                          <div className="flex items-center gap-1">
                            <Input
                              type="text"
                              value={
                                entry.depositAmount
                                  ? entry.depositAmount.toLocaleString()
                                  : ""
                              }
                              onChange={(e) => {
                                const value = e.target.value
                                  .replace(/,/g, "")
                                  .replace(/[^0-9]/g, "");
                                handleUpdateDepositEntry(
                                  index,
                                  "depositAmount",
                                  parseInt(value) || 0,
                                );
                              }}
                              data-testid={`input-deposit-amount-${index}`}
                              placeholder="0"
                              style={{
                                height: "32px",
                                fontSize: "12px",
                                padding: "4px 6px",
                                textAlign: "right",
                                flex: 1,
                              }}
                            />
                            <span style={{ fontSize: "12px", flexShrink: 0 }}>
                              원
                            </span>
                          </div>
                        </div>
                        {/* 입금구분 */}
                        <div style={DEPOSIT_COLS.col5}>
                          <Select
                            value={entry.depositCategory || ""}
                            onValueChange={(value) =>
                              handleUpdateDepositEntry(
                                index,
                                "depositCategory",
                                value,
                              )
                            }
                          >
                            <SelectTrigger
                              data-testid={`select-deposit-category-${index}`}
                              style={{
                                height: "32px",
                                fontSize: "12px",
                                border: "1px solid #E0E0E0",
                              }}
                            >
                              <SelectValue placeholder="선택" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="일부">일부</SelectItem>
                              <SelectItem value="최종액">최종액</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {/* 메모 */}
                        <div style={DEPOSIT_COLS.col6}>
                          <Input
                            type="text"
                            value={entry.memo || ""}
                            onChange={(e) =>
                              handleUpdateDepositEntry(
                                index,
                                "memo",
                                e.target.value,
                              )
                            }
                            data-testid={`input-deposit-memo-${index}`}
                            placeholder="메모"
                            style={{
                              height: "32px",
                              fontSize: "12px",
                              padding: "4px 6px",
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}

                  {/* Summary row */}
                  <div
                    className="flex items-center"
                    style={{
                      background: "#F5F7FA",
                      borderTop: "1px solid #E0E0E0",
                      minWidth: "750px",
                    }}
                  >
                    <div style={{ ...DEPOSIT_COLS.col1, fontWeight: 600 }}>
                      합계
                    </div>
                    <div style={DEPOSIT_COLS.col2}></div>
                    <div style={{ ...DEPOSIT_COLS.col3, fontWeight: 600 }}>
                      {depositTotals.totalClaim.toLocaleString()}원
                    </div>
                    <div style={{ ...DEPOSIT_COLS.col4, fontWeight: 600 }}>
                      {depositTotals.totalDeposit.toLocaleString()}원
                    </div>
                    <div
                      style={{
                        ...DEPOSIT_COLS.col5,
                        fontWeight: 600,
                        fontSize: "11px",
                        color: outstandingAmount > 0 ? "#E53935" : "#0C0C0C",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {(
                        depositTotals.totalDeposit - depositTotals.totalClaim
                      ).toLocaleString()}
                      원
                    </div>
                    <div style={{ ...DEPOSIT_COLS.col6, padding: "4px 8px" }}>
                      <Button
                        onClick={handleSaveDeposits}
                        disabled={isSubmitting}
                        data-testid="button-save-deposits"
                        style={{
                          height: "32px",
                          background: "#4A90D9",
                          color: "#FFFFFF",
                          fontWeight: 600,
                          fontSize: "13px",
                          padding: "0 8px",
                          borderRadius: "4px",
                          width: "100%",
                        }}
                      >
                        저장
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

            {/* Section 4: 지급일자 */}
              <div style={{ overflow: "hidden" }}>
                <div
                  className="flex items-center justify-between"
                  style={SECTION_HEADER_STYLE}
                  data-testid="section-payment-management"
                >
                  <span>지급관리</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleAddPaymentRow}
                      data-testid="button-add-payment-row"
                      style={{
                        width: "24px",
                        height: "24px",
                        borderRadius: "4px",
                        background: "#3B82F6",
                        color: "#FFFFFF",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "16px",
                        fontWeight: 700,
                      }}
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      onClick={handleRemovePaymentRow}
                      data-testid="button-remove-payment-row"
                      style={{
                        width: "24px",
                        height: "24px",
                        borderRadius: "4px",
                        background: "#EF4444",
                        color: "#FFFFFF",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "16px",
                        fontWeight: 700,
                      }}
                    >
                      <Minus size={14} />
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    border: "1px solid #E0E0E0",
                    borderTop: "none",
                    overflowX: "auto",
                  }}
                >
                  {/* Header */}
                  <div
                    className="flex"
                    style={{
                      borderBottom: "1px solid #E0E0E0",
                      minWidth: "900px",
                    }}
                  >
                    <div
                      style={{
                        ...PAYMENT_COLS.col1,
                        background: "#F5F7FA",
                        fontWeight: 600,
                        color: "rgba(12,12,12,0.7)",
                        padding: "6px 4px",
                      }}
                    >
                      지급일자
                    </div>
                    <div
                      style={{
                        ...PAYMENT_COLS.col2,
                        background: "#F5F7FA",
                        fontWeight: 600,
                        color: "rgba(12,12,12,0.7)",
                        padding: "6px 4px",
                      }}
                    >
                      보험사
                    </div>
                    <div
                      style={{
                        ...PAYMENT_COLS.colDeposit,
                        background: "#F5F7FA",
                        fontWeight: 600,
                        color: "rgba(12,12,12,0.7)",
                        padding: "6px 4px",
                      }}
                    >
                      입금액
                    </div>
                    <div
                      style={{
                        ...PAYMENT_COLS.col3,
                        background: "#F5F7FA",
                        fontWeight: 600,
                        color: "rgba(12,12,12,0.7)",
                        padding: "6px 4px",
                      }}
                    >
                      지급액
                    </div>
                    <div
                      style={{
                        ...PAYMENT_COLS.col4,
                        background: "#F5F7FA",
                        fontWeight: 600,
                        color: "rgba(12,12,12,0.7)",
                        padding: "6px 4px",
                      }}
                    >
                      수수료
                    </div>
                    <div
                      style={{
                        ...PAYMENT_COLS.col5,
                        background: "#F5F7FA",
                        fontWeight: 600,
                        color: "rgba(12,12,12,0.7)",
                        padding: "6px 4px",
                      }}
                    >
                      지급구분
                    </div>
                    <div
                      style={{
                        ...PAYMENT_COLS.col6,
                        background: "#F5F7FA",
                        fontWeight: 600,
                        color: "rgba(12,12,12,0.7)",
                        padding: "6px 4px",
                      }}
                    >
                      메모
                    </div>
                  </div>

                  {/* Data rows */}
                  {paymentEntries.length === 0 ? (
                    <div
                      className="flex items-center justify-center"
                      style={{
                        padding: "20px",
                        color: "rgba(12, 12, 12, 0.4)",
                        fontSize: "14px",
                      }}
                    >
                      지급 내역이 없습니다. + 버튼을 눌러 추가하세요.
                    </div>
                  ) : (
                    paymentEntries.map((entry, index) => (
                      <div
                        key={entry.id}
                        className="flex"
                        style={{
                          borderBottom:
                            index < paymentEntries.length - 1
                              ? "1px solid #E0E0E0"
                              : "none",
                          minWidth: "900px",
                        }}
                      >
                        {/* 지급일자 */}
                        <div style={PAYMENT_COLS.col1}>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className="justify-start text-left font-normal w-full"
                                data-testid={`button-payment-date-${index}`}
                                style={{
                                  height: "32px",
                                  fontSize: "12px",
                                  padding: "0 6px",
                                  border: "1px solid #E0E0E0",
                                }}
                              >
                                <CalendarIcon
                                  size={12}
                                  style={{ marginRight: "4px", flexShrink: 0 }}
                                />
                                <span
                                  style={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {entry.paymentDate || "날짜"}
                                </span>
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              className="w-auto p-0"
                              align="start"
                            >
                              <Calendar
                                mode="single"
                                selected={
                                  entry.paymentDate
                                    ? new Date(entry.paymentDate)
                                    : undefined
                                }
                                onSelect={(date) =>
                                  handleUpdatePaymentEntry(
                                    index,
                                    "paymentDate",
                                    date ? format(date, "yyyy-MM-dd") : "",
                                  )
                                }
                                locale={ko}
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                        {/* 보험사 */}
                        <div style={PAYMENT_COLS.col2}>
                          <Select
                            value={entry.insuranceCompany}
                            onValueChange={(value) =>
                              handleUpdatePaymentEntry(
                                index,
                                "insuranceCompany",
                                value,
                              )
                            }
                          >
                            <SelectTrigger
                              data-testid={`select-payment-insurance-${index}`}
                              style={{
                                height: "32px",
                                fontSize: "12px",
                                border: "1px solid #E0E0E0",
                              }}
                            >
                              <SelectValue placeholder="전체" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="전체">전체</SelectItem>
                              {insuranceCompanyNames.map((companyName) => (
                                <SelectItem
                                  key={companyName}
                                  value={companyName}
                                >
                                  {companyName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {/* 입금액 */}
                        <div style={PAYMENT_COLS.colDeposit}>
                          <div className="flex items-center gap-1">
                            <Input
                              type="text"
                              value={
                                entry.depositAmount
                                  ? entry.depositAmount.toLocaleString()
                                  : ""
                              }
                              onChange={(e) => {
                                const value = e.target.value
                                  .replace(/,/g, "")
                                  .replace(/[^0-9]/g, "");
                                handleUpdatePaymentEntry(
                                  index,
                                  "depositAmount",
                                  parseInt(value) || 0,
                                );
                              }}
                              data-testid={`input-deposit-amount-${index}`}
                              placeholder="0"
                              style={{
                                height: "32px",
                                fontSize: "12px",
                                padding: "4px 6px",
                                textAlign: "right",
                                flex: 1,
                              }}
                            />
                            <span style={{ fontSize: "12px", flexShrink: 0 }}>원</span>
                          </div>
                        </div>
                        {/* 지급액 */}
                        <div style={PAYMENT_COLS.col3}>
                          <div className="flex items-center gap-1">
                            <Input
                              type="text"
                              value={
                                entry.paymentAmount
                                  ? entry.paymentAmount.toLocaleString()
                                  : ""
                              }
                              onChange={(e) => {
                                const value = e.target.value
                                  .replace(/,/g, "")
                                  .replace(/[^0-9]/g, "");
                                handleUpdatePaymentEntry(
                                  index,
                                  "paymentAmount",
                                  parseInt(value) || 0,
                                );
                              }}
                              data-testid={`input-payment-amount-${index}`}
                              placeholder="0"
                              style={{
                                height: "32px",
                                fontSize: "12px",
                                padding: "4px 6px",
                                textAlign: "right",
                                flex: 1,
                              }}
                            />
                            <span style={{ fontSize: "12px", flexShrink: 0 }}>
                              원
                            </span>
                          </div>
                        </div>
                        {/* 수수료 */}
                        <div style={PAYMENT_COLS.col4}>
                          <div className="flex items-center gap-1">
                            <Input
                              type="text"
                              value={
                                entry.commission
                                  ? entry.commission.toLocaleString()
                                  : ""
                              }
                              onChange={(e) => {
                                const value = e.target.value
                                  .replace(/,/g, "")
                                  .replace(/[^0-9]/g, "");
                                handleUpdatePaymentEntry(
                                  index,
                                  "commission",
                                  parseInt(value) || 0,
                                );
                              }}
                              data-testid={`input-payment-commission-${index}`}
                              placeholder="0"
                              style={{
                                height: "32px",
                                fontSize: "12px",
                                padding: "4px 6px",
                                textAlign: "right",
                                flex: 1,
                              }}
                            />
                            <span style={{ fontSize: "12px", flexShrink: 0 }}>
                              원
                            </span>
                          </div>
                        </div>
                        {/* 지급구분 */}
                        <div style={PAYMENT_COLS.col5}>
                          <Select
                            value={entry.paymentCategory || ""}
                            onValueChange={(value) =>
                              handleUpdatePaymentEntry(
                                index,
                                "paymentCategory",
                                value,
                              )
                            }
                          >
                            <SelectTrigger
                              data-testid={`select-payment-category-${index}`}
                              style={{
                                height: "32px",
                                fontSize: "12px",
                                border: "1px solid #E0E0E0",
                              }}
                            >
                              <SelectValue placeholder="선택" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="일부">일부</SelectItem>
                              <SelectItem value="최종액">최종액</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {/* 메모 */}
                        <div style={PAYMENT_COLS.col6}>
                          <Input
                            type="text"
                            value={entry.memo || ""}
                            onChange={(e) =>
                              handleUpdatePaymentEntry(
                                index,
                                "memo",
                                e.target.value,
                              )
                            }
                            data-testid={`input-payment-memo-${index}`}
                            placeholder="메모"
                            style={{
                              height: "32px",
                              fontSize: "12px",
                              padding: "4px 6px",
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}

                  {/* Summary row */}
                  <div
                    className="flex items-center"
                    style={{
                      background: "#F5F7FA",
                      borderTop: "1px solid #E0E0E0",
                      minWidth: "900px",
                    }}
                  >
                    <div style={{ ...PAYMENT_COLS.col1, fontWeight: 600 }}>
                      합계
                    </div>
                    <div style={PAYMENT_COLS.col2}></div>
                    <div style={{ ...PAYMENT_COLS.colDeposit, fontWeight: 600 }}>
                      {paymentEntries.reduce((s, e) => s + (e.depositAmount || 0), 0).toLocaleString()}원
                    </div>
                    <div style={{ ...PAYMENT_COLS.col3, fontWeight: 600 }}>
                      {paymentTotals.totalPayment.toLocaleString()}원
                    </div>
                    <div style={{ ...PAYMENT_COLS.col4, fontWeight: 600 }}>
                      {paymentTotals.totalCommission.toLocaleString()}원
                    </div>
                    <div style={{ ...PAYMENT_COLS.col5, fontWeight: 600 }}>
                      {(
                        paymentTotals.totalPayment +
                        paymentTotals.totalCommission
                      ).toLocaleString()}
                      원
                    </div>
                    <div style={{ ...PAYMENT_COLS.col6, padding: "4px 8px" }}>
                      <Button
                        onClick={handleSavePayments}
                        disabled={isSubmitting}
                        data-testid="button-save-payments"
                        style={{
                          height: "32px",
                          background: "#4A90D9",
                          color: "#FFFFFF",
                          fontWeight: 600,
                          fontSize: "13px",
                          padding: "0 16px",
                          borderRadius: "4px",
                          width: "100%",
                        }}
                      >
                        저장
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
          </div>
        </div>

        {/* Bottom button area */}
        <div
          className="flex items-center justify-between px-5 gap-3"
          style={{
            height: "64px",
            background: "#FDFDFD",
            borderTop: "1px solid rgba(12, 12, 12, 0.1)",
          }}
        >
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="invoice-issued"
                checked={invoiceIssued}
                onCheckedChange={(checked) => {
                  setInvoiceIssued(!!checked);
                  if (!checked) {
                    setClosingProcessDate(undefined);
                    setTaxInvoiceDate(undefined);
                  }
                }}
                data-testid="checkbox-invoice-issued"
              />
              <Label
                htmlFor="invoice-issued"
                style={{
                  fontSize: "14px",
                  fontWeight: 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                계산서 발행(종결 여부)
              </Label>
            </div>
            {invoiceIssued && (
              <div className="flex items-center gap-2">
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#555",
                    whiteSpace: "nowrap",
                  }}
                >
                  처리일자
                </span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      data-testid="button-closing-process-date"
                      style={{
                        height: "36px",
                        fontSize: "13px",
                        fontWeight: 400,
                        minWidth: "140px",
                        justifyContent: "flex-start",
                        gap: "6px",
                      }}
                    >
                      <CalendarIcon style={{ width: "14px", height: "14px" }} />
                      {closingProcessDate
                        ? format(closingProcessDate, "yyyy-MM-dd")
                        : "날짜 선택"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={closingProcessDate}
                      onSelect={(date) => {
                        setClosingProcessDate(date);
                        setTaxInvoiceDate(date);
                      }}
                      locale={ko}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {isAdmin && (
              <Button
                onClick={() => {
                  if (invoiceIssued && closingProcessDate) {
                    setShowClosingConfirm(true);
                  } else {
                    handleSaveComplete();
                  }
                }}
                disabled={
                  isSubmitting || (invoiceIssued && !closingProcessDate)
                }
                data-testid="button-save-complete"
                style={{
                  padding: "10px 20px",
                  height: "40px",
                  background: "#008FED",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "14px",
                  color: "#FDFDFD",
                }}
              >
                {isSubmitting
                  ? "처리중..."
                  : invoiceIssued
                    ? "종결 확정하기"
                    : "저장완료"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
      {/* Approval confirm dialog */}
      <AlertDialog
        open={showApprovalConfirm}
        onOpenChange={setShowApprovalConfirm}
      >
        <AlertDialogContent
          style={{
            maxWidth: "400px",
            padding: "32px",
            borderRadius: "16px",
            background: "#FFFFFF",
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle
              style={{
                fontWeight: 700,
                fontSize: "20px",
                color: "#0C0C0C",
                textAlign: "center",
                marginBottom: "8px",
              }}
            >
              인보이스를 승인하시겠습니까?
            </AlertDialogTitle>
            <AlertDialogDescription
              style={{
                fontWeight: 400,
                fontSize: "15px",
                color: "rgba(12, 12, 12, 0.6)",
                textAlign: "center",
              }}
            >
              승인 후 인보이스 발행·전송 기능이 활성화됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter
            className="flex justify-center gap-3 mt-6"
            style={{ justifyContent: "center" }}
          >
            <AlertDialogCancel
              data-testid="button-cancel-approval"
              style={{
                padding: "10px 24px",
                height: "44px",
                borderRadius: "6px",
                fontWeight: 500,
                fontSize: "16px",
                color: "#008FED",
                background: "transparent",
                border: "none",
              }}
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowApprovalConfirm(false);
                handleApprove();
              }}
              data-testid="button-confirm-approval"
              style={{
                padding: "10px 32px",
                height: "44px",
                background: "#008FED",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "16px",
                color: "#FFFFFF",
              }}
            >
              승인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Closing confirm dialog */}
      <AlertDialog
        open={showClosingConfirm}
        onOpenChange={setShowClosingConfirm}
      >
        <AlertDialogContent
          style={{
            maxWidth: "400px",
            padding: "32px",
            borderRadius: "16px",
            background: "#FFFFFF",
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle
              style={{
                fontWeight: 700,
                fontSize: "20px",
                color: "#0C0C0C",
                textAlign: "center",
                marginBottom: "8px",
              }}
            >
              종결로 확정하시겠습니까?
            </AlertDialogTitle>
            <AlertDialogDescription
              style={{
                fontWeight: 400,
                fontSize: "15px",
                color: "rgba(12, 12, 12, 0.6)",
                textAlign: "center",
              }}
            >
              확정 후 해당 건의 상태가 종결로 변경됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter
            className="flex justify-center gap-3 mt-6"
            style={{ justifyContent: "center" }}
          >
            <AlertDialogCancel
              data-testid="button-cancel-closing"
              style={{
                padding: "10px 24px",
                height: "44px",
                borderRadius: "6px",
                fontWeight: 500,
                fontSize: "16px",
                color: "#008FED",
                background: "transparent",
                border: "none",
              }}
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowClosingConfirm(false);
                handleSaveComplete();
              }}
              data-testid="button-confirm-closing"
              style={{
                padding: "10px 32px",
                height: "44px",
                background: "#008FED",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "16px",
                color: "#FFFFFF",
              }}
            >
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
