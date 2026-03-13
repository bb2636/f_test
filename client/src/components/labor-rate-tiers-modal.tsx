import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { LaborRateTier } from "@shared/schema";
import { useLaborRateTiers, useUpdateLaborRateTiers, DEFAULT_LABOR_RATE_TIERS_FALLBACK } from "@/hooks/use-labor-rate-tiers";
import { Settings, Plus, Minus } from "lucide-react";

interface LaborRateTiersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LaborRateTiersModal({ open, onOpenChange }: LaborRateTiersModalProps) {
  const { toast } = useToast();
  const { data: tiers, isLoading } = useLaborRateTiers();
  const updateMutation = useUpdateLaborRateTiers();
  
  const [editedTiers, setEditedTiers] = useState<{ id: number; minRatio: number; rateMultiplier: number }[]>([]);
  
  useEffect(() => {
    if (tiers && tiers.length > 0) {
      setEditedTiers(tiers.map(t => ({
        id: t.id,
        minRatio: t.minRatio,
        rateMultiplier: t.rateMultiplier,
      })));
    } else if (!isLoading) {
      setEditedTiers(DEFAULT_LABOR_RATE_TIERS_FALLBACK.map(t => ({
        id: t.id,
        minRatio: t.minRatio,
        rateMultiplier: t.rateMultiplier,
      })));
    }
  }, [tiers, isLoading]);
  
  const handleMinRatioChange = (id: number, value: string) => {
    const numValue = parseInt(value) || 0;
    setEditedTiers(prev => prev.map(t => 
      t.id === id ? { ...t, minRatio: numValue } : t
    ));
  };
  
  const handleRateMultiplierChange = (id: number, value: string) => {
    const numValue = parseInt(value) || 0;
    setEditedTiers(prev => prev.map(t => 
      t.id === id ? { ...t, rateMultiplier: numValue } : t
    ));
  };
  
  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync(editedTiers);
      toast({
        title: "저장 완료",
        description: "노임단가 적용비율이 성공적으로 저장되었습니다.",
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "저장 실패",
        description: "노임단가 적용비율 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };
  
  const handleAddRow = () => {
    const newId = Math.max(...editedTiers.map(t => t.id), 0) + 1;
    const sorted = [...editedTiers].sort((a, b) => b.minRatio - a.minRatio);
    const lastTier = sorted[sorted.length - 1];
    const secondLastTier = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
    const newMinRatio = secondLastTier ? Math.max(lastTier.minRatio + 1, Math.floor((secondLastTier.minRatio + lastTier.minRatio) / 2)) : lastTier.minRatio + 5;
    setEditedTiers(prev => [...prev, { id: newId, minRatio: newMinRatio, rateMultiplier: 50 }]);
  };

  const handleRemoveRow = () => {
    if (editedTiers.length <= 2) return;
    const sorted = [...editedTiers].sort((a, b) => b.minRatio - a.minRatio);
    const secondLastTier = sorted[sorted.length - 2];
    setEditedTiers(prev => prev.filter(t => t.id !== secondLastTier.id));
  };

  const handleReset = () => {
    setEditedTiers(DEFAULT_LABOR_RATE_TIERS_FALLBACK.map(t => ({
      id: t.id,
      minRatio: t.minRatio,
      rateMultiplier: t.rateMultiplier,
    })));
  };
  
  const sortedTiers = [...editedTiers].sort((a, b) => b.minRatio - a.minRatio);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-lg"
        style={{ 
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <DialogHeader>
          <DialogTitle 
            className="flex items-center gap-2"
            style={{
              fontFamily: "Pretendard",
              fontSize: "18px",
              fontWeight: 600,
              color: "#0C0C0C",
            }}
          >
            C/D 범주·적용비율 편집
          </DialogTitle>
          <DialogDescription style={{ fontFamily: "Pretendard", fontSize: "14px", color: "#686A6E" }}>
            C/D 범주의 노임단가 적용비율(%)을 조정해 현장 난이도를 보정합니다.
          </DialogDescription>
        </DialogHeader>
        
        <div className="mt-4">
          <div 
            className="rounded-lg border overflow-hidden"
            style={{ borderColor: "rgba(12, 12, 12, 0.1)" }}
          >
            <table className="w-full" style={{ fontFamily: "Pretendard" }}>
              <thead>
                <tr style={{ backgroundColor: "#F4F5F6" }}>
                  <th 
                    className="text-left px-4 py-3"
                    style={{ 
                      fontSize: "13px", 
                      fontWeight: 600,
                      color: "#686A6E",
                      borderBottom: "1px solid rgba(12, 12, 12, 0.1)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span>범주</span>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={handleAddRow}
                        className="h-6 w-6 min-h-0"
                        style={{ borderColor: "rgba(12, 12, 12, 0.15)" }}
                        data-testid="button-add-tier-row"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={handleRemoveRow}
                        disabled={editedTiers.length <= 2}
                        className="h-6 w-6 min-h-0"
                        style={{ borderColor: "rgba(12, 12, 12, 0.15)" }}
                        data-testid="button-remove-tier-row"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </th>
                  <th 
                    className="text-left px-4 py-3"
                    style={{ 
                      fontSize: "13px", 
                      fontWeight: 600,
                      color: "#686A6E",
                      borderBottom: "1px solid rgba(12, 12, 12, 0.1)",
                    }}
                  >
                    적용 비율(%)
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedTiers.map((tier, index) => (
                  <tr 
                    key={tier.id}
                    style={{ 
                      borderBottom: index < sortedTiers.length - 1 ? "1px solid rgba(12, 12, 12, 0.05)" : "none",
                    }}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={tier.minRatio}
                          onChange={(e) => handleMinRatioChange(tier.id, e.target.value)}
                          className="text-center h-9 w-20"
                          style={{ 
                            fontSize: "14px",
                            borderColor: "rgba(12, 12, 12, 0.15)",
                          }}
                          min={0}
                          max={100}
                          data-testid={`input-min-ratio-${tier.id}`}
                        />
                        <span style={{ fontSize: "14px", color: "#686A6E" }}>%</span>
                        <span style={{ fontSize: "14px", color: "#686A6E" }}>
                          {index === sortedTiers.length - 1 
                            ? `< (${sortedTiers[index - 1]?.minRatio || 0}% 미만)` 
                            : "≥"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={tier.rateMultiplier}
                          onChange={(e) => handleRateMultiplierChange(tier.id, e.target.value)}
                          className="text-center h-9 w-20"
                          style={{ 
                            fontSize: "14px",
                            borderColor: "rgba(12, 12, 12, 0.15)",
                          }}
                          min={0}
                          max={200}
                          data-testid={`input-rate-multiplier-${tier.id}`}
                        />
                        <span style={{ fontSize: "14px", color: "#686A6E" }}>%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        
        <DialogFooter className="mt-6 flex justify-between w-full">
          <Button
            variant="ghost"
            onClick={handleReset}
            style={{ 
              color: "#686A6E",
            }}
            data-testid="button-reset-tiers"
          >
            기본값
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            style={{ 
              backgroundColor: "#008FED",
              color: "white",
            }}
            data-testid="button-save-tiers"
          >
            {updateMutation.isPending ? "저장 중..." : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LaborRateTiersButton() {
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
        data-testid="button-open-labor-rate-tiers"
      >
        <Settings className="h-4 w-4" />
        적용비율 설정
      </Button>
      <LaborRateTiersModal open={modalOpen} onOpenChange={setModalOpen} />
    </>
  );
}
