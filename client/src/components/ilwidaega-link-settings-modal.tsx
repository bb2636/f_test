import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Link2, Plus, Trash2 } from "lucide-react";
import type { IlwidaegaLinkSetting } from "@shared/schema";

interface LinkSettingRow {
  id: string;
  location: string;
  category: string;
  workName: string;
}

const LOCATIONS = ["천장", "벽면", "바닥"];

const DEFAULT_LINK_ITEMS: Array<{ location: string; category: string; workName: string }> = [
  { location: "천장", category: "목공사", workName: "반자틀" },
  { location: "천장", category: "목공사", workName: "합판" },
  { location: "천장", category: "목공사", workName: "석고보드" },
  { location: "천장", category: "목공사", workName: "몰딩" },
  { location: "천장", category: "수장공사", workName: "도배" },
  { location: "천장", category: "도장공사", workName: "수성페인트" },
  { location: "천장", category: "도장공사", workName: "탄성코트" },
  { location: "천장", category: "도장공사", workName: "무늬코트" },
  { location: "천장", category: "욕실공사", workName: "SMC" },
  { location: "천장", category: "욕실공사", workName: "리빙보드" },
  { location: "천장", category: "욕실공사", workName: "도기류" },
  { location: "벽면", category: "목공사", workName: "합판" },
  { location: "벽면", category: "목공사", workName: "석고보드" },
  { location: "벽면", category: "목공사", workName: "걸레받이" },
  { location: "벽면", category: "수장공사", workName: "도배" },
  { location: "벽면", category: "도장공사", workName: "수성페인트" },
  { location: "벽면", category: "도장공사", workName: "탄성코트" },
  { location: "벽면", category: "도장공사", workName: "무늬코트" },
  { location: "벽면", category: "타일공사", workName: "줄눈" },
  { location: "벽면", category: "타일공사", workName: "타일" },
  { location: "바닥", category: "수장공사", workName: "마루" },
  { location: "바닥", category: "수장공사", workName: "장판" },
  { location: "바닥", category: "가설공사", workName: "건축물현장정리" },
  { location: "바닥", category: "타일공사", workName: "줄눈" },
  { location: "바닥", category: "타일공사", workName: "타일" },
  { location: "바닥", category: "욕실공사", workName: "SMC" },
  { location: "바닥", category: "욕실공사", workName: "리빙보드" },
  { location: "바닥", category: "욕실공사", workName: "도기류" },
];

interface IlwidaegaLinkSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IlwidaegaLinkSettingsModal({ open, onOpenChange }: IlwidaegaLinkSettingsModalProps) {
  const { toast } = useToast();
  const [rows, setRows] = useState<LinkSettingRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: savedSettings, isLoading: isLoadingSettings } = useQuery<IlwidaegaLinkSetting[]>({
    queryKey: ["/api/ilwidaega-link-settings"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/ilwidaega-link-settings");
      return res.json();
    },
    enabled: open,
  });

  const { data: ilwidaegaCatalog } = useQuery<Array<{ 공종: string; 공사명: string; 노임항목: string }>>({
    queryKey: ["/api/ilwidaega-catalog"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/ilwidaega-catalog");
      return res.json();
    },
    enabled: open,
  });

  const categories = useMemo(() => {
    if (!ilwidaegaCatalog) return [];
    const set = new Set(ilwidaegaCatalog.map(item => item.공종));
    return Array.from(set).sort();
  }, [ilwidaegaCatalog]);

  const workNamesByCategory = useMemo(() => {
    if (!ilwidaegaCatalog) return {} as Record<string, string[]>;
    const map: Record<string, Set<string>> = {};
    ilwidaegaCatalog.forEach(item => {
      if (!map[item.공종]) map[item.공종] = new Set();
      map[item.공종].add(item.공사명);
    });
    const result: Record<string, string[]> = {};
    for (const [key, val] of Object.entries(map)) {
      result[key] = Array.from(val).sort();
    }
    return result;
  }, [ilwidaegaCatalog]);

  useEffect(() => {
    if (!open) return;
    if (savedSettings && savedSettings.length > 0) {
      setRows(savedSettings.map(s => ({
        id: `saved-${s.id}`,
        location: s.location,
        category: s.category,
        workName: s.workName,
      })));
    } else if (savedSettings && savedSettings.length === 0) {
      setRows(DEFAULT_LINK_ITEMS.map((item, idx) => ({
        id: `default-${idx}`,
        location: item.location,
        category: item.category,
        workName: item.workName,
      })));
    }
    setSelectedIds(new Set());
  }, [savedSettings, open]);

  const saveMutation = useMutation({
    mutationFn: async (items: Array<{ location: string; category: string; workName: string }>) => {
      const res = await apiRequest("POST", "/api/ilwidaega-link-settings", { items });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ilwidaega-link-settings"] });
      toast({
        title: "저장 완료",
        description: "일위대가 연동 설정이 저장되었습니다.",
      });
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "저장 실패",
        description: "일위대가 연동 설정 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const addRow = () => {
    setRows(prev => [...prev, {
      id: `new-${Date.now()}-${Math.random()}`,
      location: "",
      category: "",
      workName: "",
    }]);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === rows.length && rows.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map(r => r.id)));
    }
  };

  const removeSelected = () => {
    if (selectedIds.size === 0) return;
    setRows(prev => prev.filter(r => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
  };

  const updateRow = (id: string, field: keyof LinkSettingRow, value: string) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, [field]: value };
      if (field === "category") {
        updated.workName = "";
      }
      return updated;
    }));
  };

  const handleSave = () => {
    const incompleteRows = rows.filter(r => !r.location || !r.category || !r.workName);
    if (incompleteRows.length > 0) {
      toast({
        title: "입력 확인",
        description: `${incompleteRows.length}개의 항목이 미완성입니다. 위치, 공종, 공사명을 모두 선택해주세요.`,
        variant: "destructive",
      });
      return;
    }
    const seen = new Set<string>();
    for (const r of rows) {
      const key = `${r.location}|${r.category}|${r.workName}`;
      if (seen.has(key)) {
        toast({
          title: "중복 항목",
          description: `${r.location} - ${r.category} - ${r.workName} 항목이 중복됩니다.`,
          variant: "destructive",
        });
        return;
      }
      seen.add(key);
    }
    saveMutation.mutate(rows.map(r => ({
      location: r.location,
      category: r.category,
      workName: r.workName,
    })));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        style={{
          maxWidth: "720px",
          maxHeight: "85vh",
          fontFamily: "Pretendard",
          padding: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <DialogHeader style={{ padding: "24px 24px 0 24px" }}>
          <DialogTitle style={{ fontSize: "18px", fontWeight: 600, color: "#0C0C0C" }}>
            일위대가 연동 설정
          </DialogTitle>
          <DialogDescription style={{ fontSize: "13px", color: "#686A6E" }}>
            복구면적 산출표에서 사용할 위치별 공종/공사명을 설정합니다. 여기서 추가하거나 삭제한 항목은 복구면적 산출표에 반영됩니다.
          </DialogDescription>
        </DialogHeader>

        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 24px",
        }}>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginBottom: "12px" }}>
            <Button
              variant="outline"
              size="sm"
              onClick={addRow}
              style={{
                borderColor: "#008FED",
                color: "#008FED",
                gap: "4px",
              }}
            >
              <Plus className="h-4 w-4" />
              행추가
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={removeSelected}
              disabled={selectedIds.size === 0}
              style={{
                borderColor: selectedIds.size > 0 ? "#FF4D4F" : "rgba(12, 12, 12, 0.15)",
                color: selectedIds.size > 0 ? "#FF4D4F" : "#9ca3af",
                gap: "4px",
              }}
            >
              <Trash2 className="h-4 w-4" />
              선택 삭제
            </Button>
          </div>

          <div style={{
            border: "1px solid rgba(12, 12, 12, 0.08)",
            borderRadius: "8px",
            overflow: "hidden",
          }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{
                  background: "rgba(248, 248, 248, 1)",
                  height: "40px",
                }}>
                  <th style={{
                    padding: "8px 12px",
                    textAlign: "center",
                    borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                    borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                    width: "44px",
                  }}>
                    <Checkbox
                      checked={rows.length > 0 && selectedIds.size === rows.length}
                      onCheckedChange={toggleSelectAll}
                      style={{ display: "block", margin: "0 auto" }}
                    />
                  </th>
                  <th style={{
                    padding: "8px 12px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#0C0C0C",
                    textAlign: "center",
                    borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                    borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                    width: "140px",
                  }}>위치</th>
                  <th style={{
                    padding: "8px 12px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#0C0C0C",
                    textAlign: "center",
                    borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                    borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                    width: "180px",
                  }}>공종</th>
                  <th style={{
                    padding: "8px 12px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#0C0C0C",
                    textAlign: "center",
                    borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                  }}>공사명</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingSettings ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", padding: "24px", color: "#9ca3af", fontSize: "14px" }}>
                      로딩 중...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", padding: "24px", color: "#9ca3af", fontSize: "14px" }}>
                      등록된 연동 항목이 없습니다. "행추가" 버튼으로 항목을 추가하세요.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} style={{
                      height: "48px",
                      borderBottom: "1px solid rgba(12, 12, 12, 0.06)",
                      background: selectedIds.has(row.id) ? "rgba(0, 143, 237, 0.04)" : "transparent",
                    }}>
                      <td style={{
                        textAlign: "center",
                        borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                        padding: "4px",
                      }}>
                        <Checkbox
                          checked={selectedIds.has(row.id)}
                          onCheckedChange={() => toggleSelect(row.id)}
                          style={{ display: "block", margin: "0 auto" }}
                        />
                      </td>
                      <td style={{
                        padding: "4px 8px",
                        borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                      }}>
                        <Select
                          value={row.location}
                          onValueChange={(val) => updateRow(row.id, "location", val)}
                        >
                          <SelectTrigger style={{ height: "36px", fontSize: "13px" }}>
                            <SelectValue placeholder="선택" />
                          </SelectTrigger>
                          <SelectContent>
                            {LOCATIONS.map(loc => (
                              <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td style={{
                        padding: "4px 8px",
                        borderRight: "1px solid rgba(12, 12, 12, 0.06)",
                      }}>
                        <Select
                          value={row.category}
                          onValueChange={(val) => updateRow(row.id, "category", val)}
                        >
                          <SelectTrigger style={{ height: "36px", fontSize: "13px" }}>
                            <SelectValue placeholder="선택" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map(cat => (
                              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td style={{
                        padding: "4px 8px",
                      }}>
                        <Select
                          value={row.workName}
                          onValueChange={(val) => updateRow(row.id, "workName", val)}
                          disabled={!row.category}
                        >
                          <SelectTrigger style={{ height: "36px", fontSize: "13px" }}>
                            <SelectValue placeholder={row.category ? "선택" : "공종 먼저 선택"} />
                          </SelectTrigger>
                          <SelectContent>
                            {(workNamesByCategory[row.category] || []).map(wn => (
                              <SelectItem key={wn} value={wn}>{wn}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter style={{
          padding: "16px 24px",
          borderTop: "1px solid rgba(12, 12, 12, 0.08)",
        }}>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            style={{
              backgroundColor: "#008FED",
              color: "white",
            }}
          >
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IlwidaegaLinkSettingsButton() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setModalOpen(true)}
        className="gap-1.5"
        style={{
          borderColor: "rgba(12, 12, 12, 0.15)",
          color: "#686A6E",
        }}
        data-testid="button-open-ilwidaega-link-settings"
      >
        <Link2 className="h-4 w-4" />
        일위대가 연동 설정
      </Button>
      <IlwidaegaLinkSettingsModal open={modalOpen} onOpenChange={setModalOpen} />
    </>
  );
}
