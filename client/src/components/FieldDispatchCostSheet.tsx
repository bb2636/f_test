import { useState, useRef, useEffect, useMemo } from "react";
import { format } from "date-fns";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { usePermissions } from "@/hooks/use-permissions";

interface CaseDocument {
  id: string;
  fileName: string;
  fileType: string;
  category: string;
  fileUrl?: string;
}

const DOCUMENT_CATEGORIES = ["사진-수리중", "사진-복구완료", "기본자료", "증빙자료", "청구자료"] as const;

interface FieldDispatchCostSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseData: {
    id: string;
    caseNumber?: string | null;
    insuranceCompany?: string | null;
    insuranceAccidentNo?: string | null;
    receptionDate?: string | null;
    fieldDispatchInvoiceAmount?: string | null;
    fieldDispatchInvoiceRemarks?: string | null;
    assessorEmail?: string | null;
    investigatorEmail?: string | null;
  } | null;
  relatedCases?: Array<{
    id: string;
    caseNumber?: string | null;
  }>;
}

export function FieldDispatchCostSheet({ open, onOpenChange, caseData, relatedCases = [] }: FieldDispatchCostSheetProps) {
  const { toast } = useToast();
  const { hasItem } = usePermissions();
  const invoicePdfRef = useRef<HTMLDivElement>(null);
  
  // 인보이스 승인 권한 체크
  const canApproveInvoice = hasItem("관리자 설정", "인보이스 승인");
  
  // 선견적요청 현장출동비용은 항상 10만원 고정
  const FIXED_FIELD_DISPATCH_AMOUNT = "100000";
  const [invoiceRemarks, setInvoiceRemarks] = useState<string>("");
  const [invoiceRecipientEmail, setInvoiceRecipientEmail] = useState<string>("");
  const [isSendingPdf, setIsSendingPdf] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);

  const { data: documents = [] } = useQuery<CaseDocument[]>({
    queryKey: ['/api/cases', caseData?.id, 'documents'],
    enabled: open && !!caseData?.id,
  });

  const documentsByCategory = useMemo(() => {
    const grouped: Record<string, CaseDocument[]> = {};
    for (const category of DOCUMENT_CATEGORIES) {
      grouped[category] = documents.filter(doc => doc.category === category);
    }
    return grouped;
  }, [documents]);

  const toggleEmail = (email: string) => {
    setSelectedEmails(prev => {
      if (prev.includes(email)) {
        return prev.filter(e => e !== email);
      } else {
        return [...prev, email];
      }
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

  useEffect(() => {
    if (selectedEmails.length > 0) {
      setInvoiceRecipientEmail(selectedEmails.join(", "));
    }
  }, [selectedEmails]);

  useEffect(() => {
    if (open && caseData) {
      // 비고는 기존 저장된 값이 있으면 불러오기
      setInvoiceRemarks(caseData.fieldDispatchInvoiceRemarks || "");
      setInvoiceRecipientEmail("");
      setSelectedEmails([]);
      setSelectedDocumentIds([]);
    } else if (!open) {
      setInvoiceRemarks("");
      setInvoiceRecipientEmail("");
      setSelectedEmails([]);
      setSelectedDocumentIds([]);
    }
  }, [open, caseData]);

  const totalBeforeTruncation = parseInt(FIXED_FIELD_DISPATCH_AMOUNT) || 0;
  
  // 만원단위절사 (용어는 '천원단위절사')
  const truncation = totalBeforeTruncation % 10000;
  const totalAmount = totalBeforeTruncation - truncation;

  const handleSendInvoicePdf = async () => {
    if (!invoicePdfRef.current) {
      toast({
        title: "PDF 생성 실패",
        description: "변환할 청구서 정보를 찾을 수 없습니다.",
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

    setIsSendingPdf(true);

    try {
      const jsPDF = (await import("jspdf")).default;
      const html2canvas = (await import("html2canvas")).default;

      const pdfContainer = invoicePdfRef.current;
      const inputFields = pdfContainer.querySelectorAll('.invoice-input-field');
      const spanFields = pdfContainer.querySelectorAll('.invoice-span-field');
      const wonLabels = pdfContainer.querySelectorAll('.invoice-input-field + span');
      
      inputFields.forEach(el => (el as HTMLElement).style.display = 'none');
      wonLabels.forEach(el => (el as HTMLElement).style.display = 'none');
      spanFields.forEach(el => (el as HTMLElement).style.display = 'inline');

      const canvas = await html2canvas(invoicePdfRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#FFFFFF",
      });

      inputFields.forEach(el => (el as HTMLElement).style.display = '');
      wonLabels.forEach(el => (el as HTMLElement).style.display = '');
      spanFields.forEach(el => (el as HTMLElement).style.display = 'none');

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 10;
      
      const imgWidth = pageWidth - (margin * 2);
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight);

      const pdfBase64 = pdf.output('datauristring').split(',')[1];

      const response = await fetch('/api/send-field-dispatch-invoice-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: invoiceRecipientEmail,
          pdfBase64,
          caseId: caseData?.id || '',
          caseNumber: caseData?.caseNumber || '',
          insuranceCompany: caseData?.insuranceCompany || '',
          accidentNo: caseData?.insuranceAccidentNo || '',
          fieldDispatchAmount: parseInt(FIXED_FIELD_DISPATCH_AMOUNT) || 0,
          totalAmount,
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
          description: `${invoiceRecipientEmail}으로 현장출동비용 청구서 PDF가 전송되었습니다.`,
        });
        
        // PDF 발송 성공 시 동일사고번호 케이스들의 상태를 "청구"로 업데이트
        try {
          await apiRequest("POST", "/api/field-dispatch-invoice/send", {
            caseId: caseData?.id,
            relatedCaseIds: relatedCases.map(c => c.id),
            fieldDispatchAmount: parseInt(FIXED_FIELD_DISPATCH_AMOUNT) || 0,
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
        
        onOpenChange(false);
      } else {
        throw new Error(result.error || "이메일 전송에 실패했습니다");
      }
    } catch (error) {
      console.error("현장출동비용 청구서 PDF 이메일 전송 중 오류 발생", error);
      toast({
        title: "이메일 전송 실패",
        description: error instanceof Error ? error.message : "다시 시도해주세요.",
        variant: "destructive",
      });
    } finally {
      setIsSendingPdf(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        style={{
          width: "680px",
          maxWidth: "95vw",
          padding: 0,
          background: "#FFFFFF",
          overflow: "auto",
          boxShadow: "0px -2px 70px rgba(179, 193, 205, 0.8)",
          borderRadius: "12px 0 0 12px",
        }}
        data-testid="dialog-field-dispatch-invoice"
      >
        <div style={{
          display: "flex",
          flexDirection: "column",
          padding: "38px 0px 0px",
          gap: "24px",
        }}>
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            width: "100%",
          }}>
            <div style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              padding: "0px 38px",
            }}>
              <h2 style={{
                fontFamily: "Pretendard",
                fontWeight: 600,
                fontSize: "32px",
                lineHeight: "128%",
                color: "#0C0C0C",
                margin: 0,
              }}>
                INVOICE
              </h2>
            </div>
            <div style={{
              width: "100%",
              height: "0px",
              border: "1px solid rgba(12, 12, 12, 0.1)",
            }} />
          </div>

          <div 
            ref={invoicePdfRef}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              padding: "0px 38px",
              gap: "26px",
              background: "#FFFFFF",
            }}
          >
            <div style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: "8px",
              width: "100%",
            }}>
              <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                padding: "15px 16px",
                gap: "15px",
                flex: 1,
                background: "rgba(12, 12, 12, 0.04)",
                backdropFilter: "blur(7px)",
                borderRadius: "12px",
              }}>
                <div style={{
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                }}>
                  <span style={{
                    fontFamily: "Pretendard",
                    fontWeight: 400,
                    fontSize: "15px",
                    lineHeight: "128%",
                    letterSpacing: "-0.01em",
                    color: "rgba(12, 12, 12, 0.7)",
                  }}>
                    수신
                  </span>
                  <span style={{
                    fontFamily: "Pretendard",
                    fontWeight: 600,
                    fontSize: "15px",
                    lineHeight: "128%",
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.9)",
                  }}>
                    {caseData?.insuranceCompany || "-"}
                  </span>
                </div>
                <div style={{
                  width: "100%",
                  height: "0px",
                  border: "1px solid rgba(12, 12, 12, 0.1)",
                }} />
                <div style={{
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                }}>
                  <span style={{
                    fontFamily: "Pretendard",
                    fontWeight: 400,
                    fontSize: "15px",
                    lineHeight: "128%",
                    letterSpacing: "-0.01em",
                    color: "rgba(12, 12, 12, 0.7)",
                  }}>
                    사고번호
                  </span>
                  <span style={{
                    fontFamily: "Pretendard",
                    fontWeight: 600,
                    fontSize: "15px",
                    lineHeight: "128%",
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.9)",
                  }}>
                    {caseData?.insuranceAccidentNo || "-"}
                  </span>
                </div>
              </div>

              <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                padding: "15px 16px",
                gap: "15px",
                flex: 1,
                background: "rgba(12, 12, 12, 0.04)",
                backdropFilter: "blur(7px)",
                borderRadius: "12px",
              }}>
                <div style={{
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                }}>
                  <span style={{
                    fontFamily: "Pretendard",
                    fontWeight: 400,
                    fontSize: "15px",
                    lineHeight: "128%",
                    letterSpacing: "-0.01em",
                    color: "rgba(12, 12, 12, 0.7)",
                  }}>
                    수임일자
                  </span>
                  <span style={{
                    fontFamily: "Pretendard",
                    fontWeight: 600,
                    fontSize: "15px",
                    lineHeight: "128%",
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.9)",
                  }}>
                    {caseData?.receptionDate || "-"}
                  </span>
                </div>
                <div style={{
                  width: "100%",
                  height: "0px",
                  border: "1px solid rgba(12, 12, 12, 0.1)",
                }} />
                <div style={{
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                }}>
                  <span style={{
                    fontFamily: "Pretendard",
                    fontWeight: 400,
                    fontSize: "15px",
                    lineHeight: "128%",
                    letterSpacing: "-0.01em",
                    color: "rgba(12, 12, 12, 0.7)",
                  }}>
                    제출일자
                  </span>
                  <span style={{
                    fontFamily: "Pretendard",
                    fontWeight: 600,
                    fontSize: "15px",
                    lineHeight: "128%",
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.9)",
                  }}>
                    {format(new Date(), "yyyy.MM.dd")}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ width: "100%" }}>
              <div style={{
                fontFamily: "Pretendard",
                fontWeight: 400,
                fontSize: "14px",
                lineHeight: "128%",
                letterSpacing: "-0.01em",
                color: "rgba(12, 12, 12, 0.5)",
                marginBottom: "8px",
              }}>
                Particulars
              </div>
              <div style={{
                fontFamily: "Pretendard",
                fontWeight: 500,
                fontSize: "16px",
                lineHeight: "128%",
                letterSpacing: "-0.02em",
                color: "rgba(12, 12, 12, 0.9)",
              }}>
                사고번호 {caseData?.insuranceAccidentNo || "-"}
              </div>
            </div>

            <div style={{ width: "100%" }}>
              <div style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 0",
                borderBottom: "1px solid rgba(12, 12, 12, 0.1)",
              }}>
                <span style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "14px",
                  lineHeight: "128%",
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.5)",
                }}>
                  PARTICULARS
                </span>
                <span style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "14px",
                  lineHeight: "128%",
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.5)",
                }}>
                  AMOUNT
                </span>
              </div>

              <div style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 0",
                borderBottom: "1px solid rgba(12, 12, 12, 0.1)",
              }}>
                <span style={{
                  fontFamily: "Pretendard",
                  fontWeight: 500,
                  fontSize: "15px",
                  lineHeight: "128%",
                  letterSpacing: "-0.01em",
                  color: "rgba(12, 12, 12, 0.7)",
                }}>
                  ◾현장출동비용
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span
                    className="invoice-input-field"
                    style={{
                      fontFamily: "Pretendard",
                      fontWeight: 500,
                      fontSize: "15px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "rgba(12, 12, 12, 0.9)",
                      textAlign: "right",
                    }}
                    data-testid="text-field-dispatch-cost"
                  >
                    {Number(FIXED_FIELD_DISPATCH_AMOUNT).toLocaleString()}
                  </span>
                  <span style={{
                    fontFamily: "Pretendard",
                    fontWeight: 500,
                    fontSize: "15px",
                    color: "rgba(12, 12, 12, 0.9)",
                  }}>원</span>
                  <span 
                    className="invoice-span-field"
                    style={{
                      display: "none",
                      fontFamily: "Pretendard",
                      fontWeight: 500,
                      fontSize: "15px",
                      lineHeight: "128%",
                      letterSpacing: "-0.01em",
                      color: "rgba(12, 12, 12, 0.9)",
                    }}
                  >
                    {Number(FIXED_FIELD_DISPATCH_AMOUNT).toLocaleString()}원
                  </span>
                </div>
              </div>

              {/* 천원단위절사 */}
              <div style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 0",
                borderBottom: "1px solid rgba(12, 12, 12, 0.1)",
              }}>
                <span style={{
                  fontFamily: "Pretendard",
                  fontWeight: 500,
                  fontSize: "14px",
                  lineHeight: "128%",
                  letterSpacing: "-0.01em",
                  color: "rgba(12, 12, 12, 0.7)",
                }}>
                  천원단위 절사
                </span>
                <span style={{
                  fontFamily: "Pretendard",
                  fontWeight: 500,
                  fontSize: "14px",
                  lineHeight: "128%",
                  letterSpacing: "-0.01em",
                  color: "rgba(12, 12, 12, 0.9)",
                }}
                data-testid="text-truncation">
                  -{truncation.toLocaleString()}원
                </span>
              </div>

              <div style={{
                display: "flex",
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 0",
              }}>
                <span style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "15px",
                  lineHeight: "128%",
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.9)",
                }}>
                  TOTAL AMOUNT
                </span>
                <span style={{
                  fontFamily: "Pretendard",
                  fontWeight: 700,
                  fontSize: "18px",
                  lineHeight: "128%",
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.9)",
                }}>
                  {totalAmount.toLocaleString()}원
                </span>
              </div>
            </div>

            <div style={{
              display: "flex",
              flexDirection: "row",
              gap: "24px",
              width: "100%",
            }}>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "15px",
                  lineHeight: "128%",
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.9)",
                  marginBottom: "12px",
                }}>
                  비고
                </div>
                <textarea
                  value={invoiceRemarks}
                  onChange={(e) => setInvoiceRemarks(e.target.value)}
                  placeholder="내용을 입력해주세요"
                  style={{
                    width: "100%",
                    height: "120px",
                    fontFamily: "Pretendard",
                    fontWeight: 400,
                    fontSize: "14px",
                    lineHeight: "150%",
                    letterSpacing: "-0.01em",
                    color: "rgba(12, 12, 12, 0.9)",
                    background: "rgba(12, 12, 12, 0.04)",
                    border: "none",
                    borderRadius: "8px",
                    padding: "12px",
                    resize: "none",
                    outline: "none",
                  }}
                  data-testid="textarea-field-dispatch-remarks"
                />
              </div>

              <div style={{
                flex: 1,
                background: "rgba(12, 149, 246, 0.1)",
                borderRadius: "12px",
                padding: "16px",
              }}>
                <div style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "15px",
                  lineHeight: "128%",
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.9)",
                  marginBottom: "16px",
                }}>
                  입금 정보
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      color: "rgba(12, 12, 12, 0.7)",
                    }}>
                      은행명
                    </span>
                    <span style={{
                      fontFamily: "Pretendard",
                      fontWeight: 500,
                      fontSize: "14px",
                      color: "rgba(12, 12, 12, 0.9)",
                    }}>
                      신한
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      color: "rgba(12, 12, 12, 0.7)",
                    }}>
                      계좌번호
                    </span>
                    <span style={{
                      fontFamily: "Pretendard",
                      fontWeight: 500,
                      fontSize: "14px",
                      color: "rgba(12, 12, 12, 0.9)",
                    }}>
                      140-015-744120
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      color: "rgba(12, 12, 12, 0.7)",
                    }}>
                      예금주
                    </span>
                    <span style={{
                      fontFamily: "Pretendard",
                      fontWeight: 500,
                      fontSize: "14px",
                      color: "rgba(12, 12, 12, 0.9)",
                    }}>
                      플록슨
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{
                      fontFamily: "Pretendard",
                      fontWeight: 400,
                      fontSize: "14px",
                      color: "rgba(12, 12, 12, 0.7)",
                    }}>
                      사업자등록번호
                    </span>
                    <span style={{
                      fontFamily: "Pretendard",
                      fontWeight: 500,
                      fontSize: "14px",
                      color: "rgba(12, 12, 12, 0.9)",
                    }}>
                      517-89-03490
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ 
            padding: "20px 38px", 
            borderTop: "1px solid rgba(12, 12, 12, 0.08)",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}>
            {/* Document Attachment Section */}
            {documents.length > 0 && (
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}>
                <span style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "15px",
                  lineHeight: "128%",
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.9)",
                }}>
                  첨부 문서 선택
                </span>
                {DOCUMENT_CATEGORIES.map(category => {
                  const categoryDocs = documentsByCategory[category];
                  if (!categoryDocs || categoryDocs.length === 0) return null;
                  return (
                    <div key={category} style={{ marginBottom: "8px" }}>
                      <div style={{
                        fontFamily: "Pretendard",
                        fontWeight: 500,
                        fontSize: "14px",
                        color: "rgba(12, 12, 12, 0.7)",
                        marginBottom: "6px",
                      }}>
                        {category}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {categoryDocs.map(doc => (
                          <div 
                            key={doc.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              padding: "6px 10px",
                              background: "rgba(12, 12, 12, 0.04)",
                              borderRadius: "6px",
                            }}
                          >
                            <Checkbox
                              id={`doc-field-${doc.id}`}
                              checked={selectedDocumentIds.includes(doc.id)}
                              onCheckedChange={() => toggleDocumentId(doc.id)}
                              data-testid={`checkbox-field-doc-${doc.id}`}
                            />
                            <label
                              htmlFor={`doc-field-${doc.id}`}
                              style={{
                                fontFamily: "Pretendard",
                                fontWeight: 400,
                                fontSize: "13px",
                                color: "rgba(12, 12, 12, 0.8)",
                                cursor: "pointer",
                              }}
                            >
                              {doc.fileName} ({doc.fileType})
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Email Recipient Checkboxes */}
            {(caseData?.assessorEmail || caseData?.investigatorEmail) && (
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}>
                <span style={{
                  fontFamily: "Pretendard",
                  fontWeight: 600,
                  fontSize: "15px",
                  lineHeight: "128%",
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.9)",
                }}>
                  이메일 수신자 선택
                </span>
                {caseData?.assessorEmail && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Checkbox
                      id="assessor-email-field"
                      checked={selectedEmails.includes(caseData.assessorEmail)}
                      onCheckedChange={() => toggleEmail(caseData.assessorEmail!)}
                      data-testid="checkbox-field-assessor-email"
                    />
                    <label
                      htmlFor="assessor-email-field"
                      style={{
                        fontFamily: "Pretendard",
                        fontWeight: 400,
                        fontSize: "14px",
                        color: "rgba(12, 12, 12, 0.8)",
                        cursor: "pointer",
                      }}
                    >
                      심사자 이메일: {caseData.assessorEmail}
                    </label>
                  </div>
                )}
                {caseData?.investigatorEmail && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Checkbox
                      id="investigator-email-field"
                      checked={selectedEmails.includes(caseData.investigatorEmail)}
                      onCheckedChange={() => toggleEmail(caseData.investigatorEmail!)}
                      data-testid="checkbox-field-investigator-email"
                    />
                    <label
                      htmlFor="investigator-email-field"
                      style={{
                        fontFamily: "Pretendard",
                        fontWeight: 400,
                        fontSize: "14px",
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

            <div style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: "12px",
            }}>
              <span style={{
                fontFamily: "Pretendard",
                fontWeight: 500,
                fontSize: "14px",
                color: "rgba(12, 12, 12, 0.7)",
                whiteSpace: "nowrap",
              }}>
                수신자 이메일
              </span>
              <input
                type="email"
                value={invoiceRecipientEmail}
                onChange={(e) => setInvoiceRecipientEmail(e.target.value)}
                placeholder="보험사 이메일 주소를 입력해주세요"
                style={{
                  flex: 1,
                  fontFamily: "Pretendard",
                  fontWeight: 400,
                  fontSize: "14px",
                  lineHeight: "128%",
                  letterSpacing: "-0.01em",
                  color: "rgba(12, 12, 12, 0.9)",
                  background: "rgba(12, 12, 12, 0.04)",
                  border: "1px solid rgba(12, 12, 12, 0.1)",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  outline: "none",
                }}
                data-testid="input-field-dispatch-email"
              />
            </div>

            <div style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
            }}>
              {canApproveInvoice ? (
                <Button
                  variant="outline"
                  onClick={handleSendInvoicePdf}
                  disabled={isSendingPdf || !invoiceRecipientEmail}
                  data-testid="button-field-dispatch-pdf"
                >
                  {isSendingPdf ? "발송 중..." : "PDF 발송"}
                </Button>
              ) : (
                <span style={{
                  fontFamily: "Pretendard",
                  fontWeight: 400,
                  fontSize: "14px",
                  color: "rgba(12, 12, 12, 0.5)",
                }}>
                  인보이스 승인 권한이 필요합니다
                </span>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function getCaseNumberPrefix(caseNumber: string | null | undefined): string | null {
  if (!caseNumber) return null;
  const dashIndex = caseNumber.lastIndexOf('-');
  if (dashIndex > 0) {
    return caseNumber.substring(0, dashIndex);
  }
  return caseNumber;
}
