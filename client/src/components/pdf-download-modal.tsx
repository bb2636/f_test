import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, FileText, Download, Image as ImageIcon, File } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CaseDocument } from "@shared/schema";

interface PdfDownloadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: string;
  caseNumber?: string;
}

type SectionKey = "cover" | "fieldReport" | "drawing" | "evidence" | "estimate" | "etc";

const SECTION_LABELS: Record<SectionKey, string> = {
  cover: "표지 (현장출동확인서)",
  fieldReport: "출동보고서",
  drawing: "도면",
  evidence: "증빙자료",
  estimate: "견적서",
  etc: "기타사항",
};

const DOCUMENT_TABS = ["전체", "현장사진", "기본자료", "증빙자료", "청구자료"] as const;
type DocumentTab = typeof DOCUMENT_TABS[number];

const CATEGORY_TO_TAB: Record<string, DocumentTab> = {
  "현장출동사진": "현장사진",
  "현장": "현장사진",
  "수리중 사진": "현장사진",
  "수리중": "현장사진",
  "복구완료 사진": "현장사진",
  "복구완료": "현장사진",
  "보험금 청구서": "기본자료",
  "개인정보 동의서(가족용)": "기본자료",
  "주민등록등본": "증빙자료",
  "등기부등본": "증빙자료",
  "건축물대장": "증빙자료",
  "기타증빙자료(민원일지 등)": "증빙자료",
  "위임장": "청구자료",
  "도급계약서": "청구자료",
  "복구완료확인서": "청구자료",
  "부가세 청구자료": "청구자료",
  "청구": "청구자료",
};

export function PdfDownloadModal({ open, onOpenChange, caseId, caseNumber }: PdfDownloadModalProps) {
  const { toast } = useToast();
  
  const [sections, setSections] = useState<Record<SectionKey, boolean>>({
    cover: true,
    fieldReport: true,
    drawing: true,
    evidence: true,
    estimate: true,
    etc: false,
  });
  
  const [selectedTab, setSelectedTab] = useState<DocumentTab>("전체");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  
  const { data: documents = [], isLoading: isLoadingDocuments } = useQuery<CaseDocument[]>({
    queryKey: ["/api/documents/case", caseId],
    enabled: open && !!caseId,
  });
  
  const filteredDocuments = useMemo(() => {
    if (selectedTab === "전체") return documents;
    return documents.filter(doc => CATEGORY_TO_TAB[doc.category] === selectedTab);
  }, [documents, selectedTab]);
  
  const handleSectionChange = (key: SectionKey, checked: boolean) => {
    setSections(prev => ({ ...prev, [key]: checked }));
    if (key === "evidence" && !checked) {
      setSelectedFileIds([]);
    }
  };
  
  const handleFileSelect = (fileId: string, checked: boolean) => {
    setSelectedFileIds(prev => 
      checked ? [...prev, fileId] : prev.filter(id => id !== fileId)
    );
  };
  
  const handleSelectAllInTab = (checked: boolean) => {
    if (checked) {
      const currentTabFileIds = filteredDocuments.map(doc => doc.id);
      setSelectedFileIds(prev => Array.from(new Set([...prev, ...currentTabFileIds])));
    } else {
      const currentTabFileIds = new Set(filteredDocuments.map(doc => doc.id));
      setSelectedFileIds(prev => prev.filter(id => !currentTabFileIds.has(id)));
    }
  };
  
  const allInTabSelected = useMemo(() => {
    if (filteredDocuments.length === 0) return false;
    return filteredDocuments.every(doc => selectedFileIds.includes(doc.id));
  }, [filteredDocuments, selectedFileIds]);
  
  const downloadMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        caseId,
        sections,
        evidence: {
          tab: selectedTab,
          selectedFileIds: sections.evidence ? selectedFileIds : [],
        },
      };
      
      const response = await apiRequest("POST", "/api/pdf/download", payload);
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "PDF 생성 실패");
      }
      
      return response.blob();
    },
    onSuccess: (blob) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = caseNumber 
        ? `현장출동보고서_${caseNumber}.pdf` 
        : `현장출동보고서_${caseId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "PDF 다운로드 완료",
        description: "현장출동보고서 PDF가 다운로드되었습니다.",
      });
      
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "PDF 생성 실패",
        description: error.message,
      });
    },
  });
  
  const getFileIcon = (fileType: string) => {
    if (fileType?.startsWith("image/")) return <ImageIcon className="w-4 h-4" />;
    if (fileType === "application/pdf") return <FileText className="w-4 h-4" />;
    return <File className="w-4 h-4" />;
  };
  
  const getFileThumbnail = (doc: CaseDocument) => {
    if (doc.fileType?.startsWith("image/") && doc.fileData) {
      return (
        <img 
          src={doc.fileData} 
          alt={doc.fileName}
          className="w-16 h-16 object-cover rounded border"
        />
      );
    }
    return (
      <div className="w-16 h-16 flex items-center justify-center bg-muted rounded border">
        {getFileIcon(doc.fileType)}
      </div>
    );
  };
  
  const hasAnySectionSelected = Object.values(sections).some(v => v);
  
  return (
    <Dialog open={open} onOpenChange={downloadMutation.isPending ? undefined : onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col relative">
        {/* 다운로드 중 로딩 오버레이 */}
        {downloadMutation.isPending && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center rounded-lg">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-lg font-medium">PDF 생성 중...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  잠시만 기다려주세요. 페이지를 벗어나지 마세요.
                </p>
              </div>
            </div>
          </div>
        )}
        
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5" />
            PDF 다운로드
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          <div className="space-y-3">
            <Label className="text-sm font-medium">포함할 항목 선택</Label>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(SECTION_LABELS) as SectionKey[]).map(key => (
                <div key={key} className="flex items-center space-x-2">
                  <Checkbox
                    id={`section-${key}`}
                    checked={sections[key]}
                    onCheckedChange={(checked) => handleSectionChange(key, !!checked)}
                    data-testid={`checkbox-section-${key}`}
                  />
                  <Label 
                    htmlFor={`section-${key}`}
                    className="text-sm cursor-pointer"
                  >
                    {SECTION_LABELS[key]}
                  </Label>
                </div>
              ))}
            </div>
          </div>
          
          {sections.evidence && (
            <div className="flex-1 overflow-hidden flex flex-col border rounded-lg">
              <div className="p-3 border-b bg-muted/30">
                <Label className="text-sm font-medium">증빙자료 파일 선택</Label>
              </div>
              
              <Tabs 
                value={selectedTab} 
                onValueChange={(v) => setSelectedTab(v as DocumentTab)}
                className="flex-1 flex flex-col overflow-hidden"
              >
                <TabsList className="w-full justify-start px-3 pt-2 h-auto flex-wrap gap-1">
                  {DOCUMENT_TABS.map(tab => (
                    <TabsTrigger 
                      key={tab} 
                      value={tab}
                      className="text-xs"
                      data-testid={`tab-${tab}`}
                    >
                      {tab}
                    </TabsTrigger>
                  ))}
                </TabsList>
                
                <div className="px-3 py-2 border-b flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="select-all"
                      checked={allInTabSelected}
                      onCheckedChange={(checked) => handleSelectAllInTab(!!checked)}
                      disabled={filteredDocuments.length === 0}
                      data-testid="checkbox-select-all"
                    />
                    <Label htmlFor="select-all" className="text-xs cursor-pointer">
                      전체 선택 ({selectedFileIds.filter(id => 
                        filteredDocuments.some(d => d.id === id)
                      ).length}/{filteredDocuments.length})
                    </Label>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    총 {selectedFileIds.length}개 선택됨
                  </span>
                </div>
                
                <ScrollArea className="flex-1 px-3 py-2" style={{ maxHeight: "200px" }}>
                  {isLoadingDocuments ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : filteredDocuments.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      해당 탭에 파일이 없습니다.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredDocuments.map(doc => (
                        <div 
                          key={doc.id}
                          className="flex items-center gap-3 p-2 rounded border hover:bg-muted/30 transition-colors"
                        >
                          <Checkbox
                            id={`file-${doc.id}`}
                            checked={selectedFileIds.includes(doc.id)}
                            onCheckedChange={(checked) => handleFileSelect(doc.id, !!checked)}
                            data-testid={`checkbox-file-${doc.id}`}
                          />
                          {getFileThumbnail(doc)}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{doc.fileName}</p>
                            <p className="text-xs text-muted-foreground">{doc.category}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </Tabs>
            </div>
          )}
        </div>
        
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel"
          >
            취소
          </Button>
          <Button
            onClick={() => downloadMutation.mutate()}
            disabled={downloadMutation.isPending || !hasAnySectionSelected}
            data-testid="button-download-pdf"
          >
            {downloadMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                생성 중...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                PDF 다운로드
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
