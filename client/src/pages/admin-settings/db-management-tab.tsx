import { Star, Upload, Download, Printer, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LaborRateTiersButton } from "@/components/labor-rate-tiers-modal";
import { IlwidaegaLinkSettingsButton } from "@/components/ilwidaega-link-settings-modal";
import * as XLSX from "xlsx";
import type { ExcelData, User } from "@shared/schema";
import type { UseMutationResult } from "@tanstack/react-query";

interface DbManagementTabProps {
  user: User | undefined;
  dbTab: string;
  setDbTab: (v: string) => void;
  uploadTitle: string;
  setUploadTitle: (v: string) => void;
  isDbManagementFavorite: boolean;
  toggleFavoriteMutation: UseMutationResult<any, any, string, any>;
  toast: (opts: any) => void;
  laborVersions: ExcelData[];
  materialVersions: ExcelData[];
  unitPriceVersions: ExcelData[];
  laborVersionsLoading: boolean;
  materialVersionsLoading: boolean;
  unitPriceVersionsLoading: boolean;
  selectedLaborVersionId: string | null;
  setSelectedLaborVersionId: (v: string | null) => void;
  selectedMaterialVersionId: string | null;
  setSelectedMaterialVersionId: (v: string | null) => void;
  selectedUnitPriceVersionId: string | null;
  setSelectedUnitPriceVersionId: (v: string | null) => void;
  laborExcelData: any[];
  setLaborExcelData: (v: any[]) => void;
  laborExcelHeaders: string[];
  setLaborExcelHeaders: (v: string[]) => void;
  materialExcelData: any[];
  setMaterialExcelData: (v: any[]) => void;
  materialExcelHeaders: string[];
  setMaterialExcelHeaders: (v: string[]) => void;
  unitPriceExcelData: any[];
  setUnitPriceExcelData: (v: any[]) => void;
  unitPriceExcelHeaders: string[];
  setUnitPriceExcelHeaders: (v: string[]) => void;
  editedDValues: Record<string, string>;
  setEditedDValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  overridesMap: Map<string, number>;
  saveExcelDataMutation: UseMutationResult<any, any, any, any>;
  deleteVersionMutation: UseMutationResult<any, any, string, any>;
  saveDValueMutation: UseMutationResult<any, any, any, any>;
  parseXlsxFallback: (file: File) => Promise<{ headers: string[], data: any[][] }>;
}

export function DbManagementTab({
  user,
  dbTab,
  setDbTab,
  uploadTitle,
  setUploadTitle,
  isDbManagementFavorite,
  toggleFavoriteMutation,
  toast,
  laborVersions,
  materialVersions,
  unitPriceVersions,
  laborVersionsLoading,
  materialVersionsLoading,
  unitPriceVersionsLoading,
  selectedLaborVersionId,
  setSelectedLaborVersionId,
  selectedMaterialVersionId,
  setSelectedMaterialVersionId,
  selectedUnitPriceVersionId,
  setSelectedUnitPriceVersionId,
  laborExcelData,
  setLaborExcelData,
  laborExcelHeaders,
  setLaborExcelHeaders,
  materialExcelData,
  setMaterialExcelData,
  materialExcelHeaders,
  setMaterialExcelHeaders,
  unitPriceExcelData,
  setUnitPriceExcelData,
  unitPriceExcelHeaders,
  setUnitPriceExcelHeaders,
  editedDValues,
  setEditedDValues,
  overridesMap,
  saveExcelDataMutation,
  deleteVersionMutation,
  saveDValueMutation,
  parseXlsxFallback,
}: DbManagementTabProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h1
            style={{
              fontFamily: "Pretendard",
              fontSize: "28px",
              fontWeight: 600,
              lineHeight: "128%",
              letterSpacing: "-0.02em",
              color: "#56687f",
            }}
          >
            DB 관리
          </h1>
          <button
            onClick={() => toggleFavoriteMutation.mutate("DB 관리")}
            className="hover:opacity-70 transition-opacity cursor-pointer"
            data-testid="button-toggle-db-favorite"
          >
            <Star 
              className="w-5 h-5" 
              style={{ 
                color: isDbManagementFavorite ? '#FFD700' : 'rgba(12, 12, 12, 0.24)',
                fill: isDbManagementFavorite ? '#FFD700' : 'none',
              }} 
            />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            value={uploadTitle}
            onChange={(e) => setUploadTitle(e.target.value)}
            placeholder="버전 제목 입력 (예: 2025-01 기준)"
            className="px-4 py-2"
            style={{
              border: "1px solid rgba(12, 12, 12, 0.1)",
              borderRadius: "6px",
              fontFamily: "Pretendard",
              fontSize: "14px",
              fontWeight: 400,
              color: "#0C0C0C",
              width: "240px",
            }}
            data-testid="input-excel-title"
          />
          <button
          onClick={() => {
            if (!uploadTitle.trim()) {
              toast({
                title: "버전 제목 필요",
                description: "버전 제목을 입력해주세요.",
                variant: "destructive",
              });
              return;
            }

            const currentTab = dbTab;
            const setData = currentTab === "노무비" ? setLaborExcelData : currentTab === "자재비" ? setMaterialExcelData : setUnitPriceExcelData;
            const setHeaders = currentTab === "노무비" ? setLaborExcelHeaders : currentTab === "자재비" ? setMaterialExcelHeaders : setUnitPriceExcelHeaders;
            
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.xlsx, .xls';
            input.onchange = async (e: any) => {
              const file = e.target.files[0];
              if (file) {
                try {
                  let headers: string[] = [];
                  let rows: any[][] = [];
                  
                  const arrayBuffer = await file.arrayBuffer();
                  const data = new Uint8Array(arrayBuffer);
                  const workbook = XLSX.read(data, { type: 'array' });
                  const sheetName = workbook.SheetNames[0];
                  const worksheet = workbook.Sheets[sheetName];
                  
                  if (worksheet && Object.keys(worksheet).length > 0) {
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: null });
                    if (jsonData.length > 0) {
                      let headerRowIdx = 0;
                      for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
                        const row = jsonData[i] as any[];
                        if (!row) continue;
                        const rowStr = row.map(c => c?.toString() || '').join('|');
                        if (rowStr.includes('공종') && rowStr.includes('공사명')) {
                          headerRowIdx = i;
                          console.log('[Excel] Found header row at index:', i, 'Row:', row);
                          break;
                        }
                      }
                      
                      headers = (jsonData[headerRowIdx] as any[]).map(h => h?.toString() || '');
                      const maxCols = headers.length;
                      
                      const rawRows: any[][] = [];
                      for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
                        const srcRow = jsonData[i] as any[];
                        const normalizedRow: any[] = [];
                        for (let j = 0; j < maxCols; j++) {
                          let cellValue = srcRow?.[j];
                          if (typeof cellValue === 'string' && (cellValue.includes('\n') || cellValue.includes('\r'))) {
                            cellValue = cellValue.split(/\r?\n|\r/)[0].trim();
                          }
                          if (cellValue === '' || cellValue === undefined) {
                            cellValue = null;
                          }
                          normalizedRow.push(cellValue);
                        }
                        rawRows.push(normalizedRow);
                      }
                      
                      rows = [];
                      for (let rowIdx = 0; rowIdx < rawRows.length; rowIdx++) {
                        const srcRow = rawRows[rowIdx];
                        const processedRow: any[] = [];
                        
                        for (let colIdx = 0; colIdx < maxCols; colIdx++) {
                          const cellValue = srcRow[colIdx];
                          
                          if (cellValue === null && rowIdx > 0) {
                            const prevRow = rows[rowIdx - 1];
                            if (prevRow && prevRow[colIdx] !== null) {
                              processedRow.push(prevRow[colIdx]);
                              continue;
                            }
                          }
                          processedRow.push(cellValue);
                        }
                        rows.push(processedRow);
                      }
                      
                      console.log('[Excel] Processed with merged cell handling:', { 
                        headerCount: headers.length, 
                        rowCount: rows.length,
                        sampleRows: rows.slice(0, 5)
                      });
                    }
                  }
                  
                  if (headers.length === 0 || rows.length === 0) {
                    console.log('Using fallback xlsx parser...');
                    const parsed = await parseXlsxFallback(file);
                    headers = parsed.headers;
                    rows = parsed.data;
                  }
                  
                  if (headers.length > 0) {
                    setHeaders(headers);
                    setData(rows);
                    
                    await saveExcelDataMutation.mutateAsync({
                      type: currentTab,
                      title: uploadTitle.trim(),
                      headers,
                      data: rows,
                    });
                    
                    toast({
                      title: "업로드 완료",
                      description: `${currentTab} 엑셀 파일이 성공적으로 업로드되어 저장되었습니다.`,
                    });
                    
                    setUploadTitle("");
                  } else {
                    toast({
                      title: "파싱 실패",
                      description: "엑셀 파일에서 데이터를 읽을 수 없습니다.",
                      variant: "destructive",
                    });
                  }
                } catch (error: any) {
                  console.error('Excel upload error:', error);
                  if (error?.status === 409 || error?.response?.status === 409) {
                    toast({
                      title: "중복된 제목",
                      description: "이미 같은 제목의 버전이 존재합니다. 다른 제목을 사용해주세요.",
                      variant: "destructive",
                    });
                  } else {
                    toast({
                      title: "저장 실패",
                      description: error?.message || "데이터베이스 저장 중 오류가 발생했습니다.",
                      variant: "destructive",
                    });
                  }
                }
              }
            };
            input.click();
          }}
          className="flex items-center gap-2 px-4 py-2"
          style={{
            background: "var(--color-button-primary)",
            borderRadius: "6px",
            fontFamily: "Pretendard",
            fontSize: "14px",
            fontWeight: 600,
            color: "#FFFFFF",
          }}
          data-testid="button-upload-excel"
          disabled={saveExcelDataMutation.isPending}
        >
          <Upload size={16} />
          {saveExcelDataMutation.isPending ? "업로드 중..." : `${dbTab} 엑셀 업로드`}
        </button>
        </div>
      </div>

      <div className="flex gap-4 mb-6 border-b-2" style={{ borderColor: "rgba(12, 12, 12, 0.1)" }}>
        <button
          onClick={() => setDbTab("노무비")}
          className="pb-3"
          style={{
            fontFamily: "Pretendard",
            fontSize: "16px",
            fontWeight: 600,
            color: dbTab === "노무비" ? "var(--color-button-primary)" : "#686A6E",
            borderBottom: dbTab === "노무비" ? "3px solid var(--color-button-primary)" : "none",
            marginBottom: dbTab === "노무비" ? "-2px" : "0",
          }}
          data-testid="tab-labor-cost"
        >
          노무비
        </button>
        <button
          onClick={() => setDbTab("자재비")}
          className="pb-3"
          style={{
            fontFamily: "Pretendard",
            fontSize: "16px",
            fontWeight: 600,
            color: dbTab === "자재비" ? "var(--color-button-primary)" : "#686A6E",
            borderBottom: dbTab === "자재비" ? "3px solid var(--color-button-primary)" : "none",
            marginBottom: dbTab === "자재비" ? "-2px" : "0",
          }}
          data-testid="tab-material-cost"
        >
          자재비
        </button>
        <button
          onClick={() => setDbTab("일위대가")}
          className="pb-3"
          style={{
            fontFamily: "Pretendard",
            fontSize: "16px",
            fontWeight: 600,
            color: dbTab === "일위대가" ? "var(--color-button-primary)" : "#686A6E",
            borderBottom: dbTab === "일위대가" ? "3px solid var(--color-button-primary)" : "none",
            marginBottom: dbTab === "일위대가" ? "-2px" : "0",
          }}
          data-testid="tab-unit-price"
        >
          일위대가
        </button>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="flex-1">
          <label
            style={{
              fontFamily: "Pretendard",
              fontSize: "14px",
              fontWeight: 500,
              color: "#686A6E",
              marginBottom: "8px",
              display: "block",
            }}
          >
            버전 선택
          </label>
          <Select
            value={dbTab === "노무비" ? (selectedLaborVersionId || "") : dbTab === "자재비" ? (selectedMaterialVersionId || "") : (selectedUnitPriceVersionId || "")}
            onValueChange={(value) => {
              if (dbTab === "노무비") {
                setSelectedLaborVersionId(value);
              } else if (dbTab === "자재비") {
                setSelectedMaterialVersionId(value);
              } else {
                setSelectedUnitPriceVersionId(value);
              }
            }}
          >
            <SelectTrigger
              className="w-full"
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                borderRadius: "6px",
              }}
              data-testid="select-excel-version"
            >
              <SelectValue placeholder="버전을 선택하세요" />
            </SelectTrigger>
            <SelectContent>
              {(() => {
                const versions = dbTab === "노무비" ? laborVersions : dbTab === "자재비" ? materialVersions : unitPriceVersions;
                const isLoading = dbTab === "노무비" ? laborVersionsLoading : dbTab === "자재비" ? materialVersionsLoading : unitPriceVersionsLoading;
                
                if (isLoading) {
                  return (
                    <SelectItem value="loading" disabled>
                      로딩 중...
                    </SelectItem>
                  );
                }
                
                if (versions.length === 0) {
                  return (
                    <SelectItem value="empty" disabled>
                      등록된 버전이 없습니다
                    </SelectItem>
                  );
                }
                
                return versions.map((version, index) => (
                  <SelectItem key={version.id} value={version.id} data-testid={`select-version-${version.id}`}>
                    {version.title} · {new Date(version.uploadedAt).toLocaleString('ko-KR', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {index === 0 && " (최신)"}
                  </SelectItem>
                ));
              })()}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        {dbTab === "일위대가" && (
          <LaborRateTiersButton />
        )}
        {dbTab === "일위대가" && (
          <IlwidaegaLinkSettingsButton />
        )}
        <button
          onClick={() => {
            const currentData = dbTab === "노무비" ? laborExcelData : dbTab === "자재비" ? materialExcelData : unitPriceExcelData;
            const currentHeaders = dbTab === "노무비" ? laborExcelHeaders : dbTab === "자재비" ? materialExcelHeaders : unitPriceExcelHeaders;
            
            if (currentData.length === 0) {
              toast({
                title: "데이터 없음",
                description: "다운로드할 데이터가 없습니다.",
                variant: "destructive",
              });
              return;
            }
            
            const worksheet = XLSX.utils.aoa_to_sheet([currentHeaders, ...currentData]);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, dbTab);
            XLSX.writeFile(workbook, `${dbTab}_${new Date().toISOString().split('T')[0]}.xlsx`);
            
            toast({
              title: "다운로드 완료",
              description: `${dbTab} 엑셀 파일이 다운로드되었습니다.`,
            });
          }}
          className="flex items-center gap-2 px-4 py-2"
          style={{
            background: "#4CAF50",
            borderRadius: "6px",
            fontFamily: "Pretendard",
            fontSize: "14px",
            fontWeight: 500,
            color: "#FFFFFF",
          }}
          data-testid="button-download-excel"
        >
          <Download size={16} />
          엑셀 다운로드
        </button>
        <button
          onClick={() => {
            window.print();
          }}
          className="flex items-center gap-2 px-4 py-2"
          style={{
            background: "rgba(12, 12, 12, 0.08)",
            borderRadius: "6px",
            fontFamily: "Pretendard",
            fontSize: "14px",
            fontWeight: 500,
            color: "#0C0C0C",
          }}
          data-testid="button-print"
        >
          <Printer size={16} />
          인쇄
        </button>
        <button
          onClick={async () => {
            const selectedVersionId = dbTab === "노무비" ? selectedLaborVersionId : dbTab === "자재비" ? selectedMaterialVersionId : selectedUnitPriceVersionId;
            const versions = dbTab === "노무비" ? laborVersions : dbTab === "자재비" ? materialVersions : unitPriceVersions;
            const selectedVersion = versions.find(v => v.id === selectedVersionId);
            
            if (!selectedVersionId || !selectedVersion) {
              toast({
                title: "버전 선택 필요",
                description: "삭제할 버전을 선택해주세요.",
                variant: "destructive",
              });
              return;
            }
            
            if (confirm(`정말로 "${selectedVersion.title}" 버전을 삭제하시겠습니까?`)) {
              try {
                await deleteVersionMutation.mutateAsync(selectedVersionId);
                
                toast({
                  title: "버전 삭제 완료",
                  description: `"${selectedVersion.title}" 버전이 삭제되었습니다.`,
                });
              } catch (error) {
                toast({
                  title: "삭제 실패",
                  description: "데이터베이스 삭제 중 오류가 발생했습니다.",
                  variant: "destructive",
                });
              }
            }
          }}
          className="flex items-center gap-2 px-4 py-2"
          style={{
            background: "#EF4444",
            borderRadius: "6px",
            fontFamily: "Pretendard",
            fontSize: "14px",
            fontWeight: 500,
            color: "#FFFFFF",
          }}
          data-testid="button-delete-version"
          disabled={deleteVersionMutation.isPending}
        >
          <X size={16} />
          {deleteVersionMutation.isPending ? "삭제 중..." : "선택 버전 삭제"}
        </button>
      </div>

      <div className="overflow-x-auto" style={{ background: "#FFFFFF", borderRadius: "8px", padding: "16px" }}>
        <table className="w-full" style={{ borderCollapse: "collapse", border: "1px solid rgba(12, 12, 12, 0.08)" }}>
          <thead
            style={{
              background: "rgba(248, 248, 248, 1)",
            }}
          >
            <tr className="compact-row">
              {(() => {
                const currentHeaders = dbTab === "노무비" ? laborExcelHeaders : dbTab === "자재비" ? materialExcelHeaders : unitPriceExcelHeaders;
                return currentHeaders.length > 0 ? (
                  currentHeaders.map((header: string, idx: number) => (
                    <th
                      key={idx}
                      className="px-4 py-4 text-left"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 600,
                        letterSpacing: "-0.01em",
                        color: "#686A6E",
                        whiteSpace: "nowrap",
                        borderRight: "1px solid rgba(12, 12, 12, 0.08)",
                        borderBottom: "2px solid rgba(12, 12, 12, 0.15)",
                      }}
                    >
                      {header}
                    </th>
                  ))
                ) : (
                  <>
                    <th className="px-4 py-4 text-left" style={{ fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "#686A6E" }}>공종</th>
                    <th className="px-4 py-4 text-left" style={{ fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "#686A6E" }}>공사명</th>
                    <th className="px-4 py-4 text-left" style={{ fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "#686A6E" }}>규격</th>
                    <th className="px-4 py-4 text-left" style={{ fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "#686A6E" }}>세부공사</th>
                    <th className="px-4 py-4 text-left" style={{ fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "#686A6E" }}>유형</th>
                    <th className="px-4 py-4 text-left" style={{ fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "#686A6E" }}>단위</th>
                    <th className="px-4 py-4 text-left" style={{ fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "#686A6E" }}>직종명</th>
                    <th className="px-4 py-4 text-left" style={{ fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "#686A6E" }}>할상임(분)</th>
                    <th className="px-4 py-4 text-left" style={{ fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "#686A6E" }}>기준노임(원)</th>
                    <th className="px-4 py-4 text-left" style={{ fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "#686A6E" }}>제품주수</th>
                    <th className="px-4 py-4 text-left" style={{ fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "#686A6E" }}>산정단가(원)</th>
                    <th className="px-4 py-4 text-left" style={{ fontFamily: "Pretendard", fontSize: "14px", fontWeight: 600, color: "#686A6E" }}>지역</th>
                  </>
                );
              })()}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const currentData = dbTab === "노무비" ? laborExcelData : dbTab === "자재비" ? materialExcelData : unitPriceExcelData;
              if (currentData.length === 0) {
                return (
                  <tr className="compact-row">
                    <td
                      colSpan={12}
                      className="px-4 py-8 text-center"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        color: "#686A6E",
                      }}
                    >
                      {dbTab} 엑셀 파일을 업로드하면 데이터가 표시됩니다.
                    </td>
                  </tr>
                );
              }
              
              const mergeableCols = dbTab === "노무비" ? [0, 1, 2, 3] : [0, 1];
              const mergeInfo: { [rowIdx: number]: { [colIdx: number]: { skip: boolean; rowspan: number } } } = {};
              
              const normalizeValue = (val: any): string => {
                if (val === null || val === undefined) return '';
                if (typeof val === 'number') return Math.round(val).toString();
                return val.toString().replace(/,/g, '').trim();
              };
              
              mergeableCols.forEach(colIdx => {
                let currentValue: string = '';
                let startRowIdx = 0;
                
                currentData.forEach((row: any[], rowIdx: number) => {
                  const cellValue = Array.isArray(row) ? row[colIdx] : null;
                  const normalizedValue = normalizeValue(cellValue);
                  
                  if (!mergeInfo[rowIdx]) mergeInfo[rowIdx] = {};
                  
                  if (rowIdx === 0 || normalizedValue !== currentValue) {
                    if (rowIdx > 0 && mergeInfo[startRowIdx]?.[colIdx]) {
                      mergeInfo[startRowIdx][colIdx].rowspan = rowIdx - startRowIdx;
                    }
                    currentValue = normalizedValue;
                    startRowIdx = rowIdx;
                    mergeInfo[rowIdx][colIdx] = { skip: false, rowspan: 1 };
                  } else {
                    mergeInfo[rowIdx][colIdx] = { skip: true, rowspan: 0 };
                  }
                });
                
                if (currentData.length > 0 && mergeInfo[startRowIdx]?.[colIdx]) {
                  mergeInfo[startRowIdx][colIdx].rowspan = currentData.length - startRowIdx;
                }
              });
              
              const currentHeaders = dbTab === "노무비" ? laborExcelHeaders : dbTab === "자재비" ? materialExcelHeaders : unitPriceExcelHeaders;
              const dValueColIndex = dbTab === "일위대가" ? currentHeaders.findIndex(h => 
                h.includes("기준작업량") || h.includes("기준 작업량") || h === "D" || h.includes("D값") || h.includes("D 값")
              ) : -1;
              const laborRateColIndex = dbTab === "일위대가" ? currentHeaders.findIndex(h => 
                h.includes("노임단가") || h.includes("단가_인") || h.includes("단가(인당)")
              ) : -1;
              const unitPriceColIndex = dbTab === "일위대가" ? currentHeaders.findIndex(h => 
                h.includes("일위대가") && (h.includes("노임단가") || h.includes("기준작업량"))
              ) : -1;
              
              return currentData.map((row: any, rowIdx: number) => {
                let category = '';
                let workName = '';
                let laborItem = '';
                
                if (dbTab === "일위대가" && Array.isArray(row)) {
                  category = String(row[0] || '').trim();
                  workName = String(row[1] || '').trim();
                  laborItem = String(row[2] || '').trim();
                  
                  if (!category || !workName) {
                    for (let i = rowIdx - 1; i >= 0; i--) {
                      const prevRow = currentData[i];
                      if (Array.isArray(prevRow)) {
                        if (!category && prevRow[0]) category = String(prevRow[0]).trim();
                        if (!workName && prevRow[1]) workName = String(prevRow[1]).trim();
                        if (category && workName) break;
                      }
                    }
                  }
                }
                
                const overrideKey = `${category}|${workName}|${laborItem}`;
                
                return (
                  <tr key={rowIdx} className="compact-row">
                    {Array.isArray(row) && row.map((cell: any, cellIdx: number) => {
                      const cellMerge = mergeInfo[rowIdx]?.[cellIdx];
                      if (cellMerge?.skip) {
                        return null;
                      }
                      
                      let displayValue = cell;
                      if (typeof cell === 'number') {
                        displayValue = Number(cell.toFixed(1));
                      }
                      
                      const rowspan = cellMerge?.rowspan || 1;
                      
                      const isEditableDColumn = dbTab === "일위대가" && cellIdx === dValueColIndex && dValueColIndex !== -1;
                      const isAdmin = user?.role === "관리자";
                      const originalDValue = typeof cell === 'number' ? Number(cell.toFixed(1)) : cell;
                      const overriddenDValue = overridesMap.get(overrideKey);
                      const hasOverride = overriddenDValue !== undefined;
                      const currentEditValue = editedDValues[overrideKey];
                      
                      const isUnitPriceColumn = dbTab === "일위대가" && cellIdx === unitPriceColIndex && unitPriceColIndex !== -1;
                      if (isUnitPriceColumn && laborRateColIndex !== -1 && dValueColIndex !== -1 && Array.isArray(row)) {
                        const laborRate = typeof row[laborRateColIndex] === 'number' ? row[laborRateColIndex] : parseFloat(String(row[laborRateColIndex]).replace(/,/g, '')) || 0;
                        const originalD = typeof row[dValueColIndex] === 'number' ? row[dValueColIndex] : parseFloat(String(row[dValueColIndex]).replace(/,/g, '')) || 0;
                        const effectiveD = hasOverride ? Number(overriddenDValue) : originalD;
                        const calculatedUnitPrice = effectiveD > 0 ? Math.round(laborRate / effectiveD) : 0;
                        
                        return (
                          <td
                            key={cellIdx}
                            className="px-4 py-4"
                            rowSpan={rowspan > 1 ? rowspan : undefined}
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 400,
                              color: hasOverride ? "#253396" : "#0C0C0C",
                              whiteSpace: "nowrap",
                              verticalAlign: rowspan > 1 ? "middle" : undefined,
                              borderRight: "1px solid rgba(12, 12, 12, 0.08)",
                              borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                              background: hasOverride ? "rgba(37, 51, 150, 0.05)" : (rowspan > 1 ? "rgba(248, 248, 248, 0.5)" : undefined),
                            }}
                          >
                            {calculatedUnitPrice.toLocaleString()}
                          </td>
                        );
                      }
                      
                      if (isEditableDColumn && isAdmin && laborItem) {
                        const formattedOverride = hasOverride ? Number(Number(overriddenDValue).toFixed(1)).toString() : '';
                        const formattedOriginal = originalDValue?.toString() || '';
                        const inputValue = currentEditValue !== undefined 
                          ? currentEditValue 
                          : (hasOverride ? formattedOverride : formattedOriginal);
                        
                        return (
                          <td
                            key={cellIdx}
                            className="px-2 py-2"
                            rowSpan={rowspan > 1 ? rowspan : undefined}
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 400,
                              color: "#0C0C0C",
                              whiteSpace: "nowrap",
                              verticalAlign: rowspan > 1 ? "middle" : undefined,
                              borderRight: "1px solid rgba(12, 12, 12, 0.08)",
                              borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                              background: hasOverride ? "rgba(37, 51, 150, 0.1)" : "rgba(255, 255, 255, 1)",
                            }}
                          >
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                value={inputValue}
                                onChange={(e) => {
                                  setEditedDValues(prev => ({
                                    ...prev,
                                    [overrideKey]: e.target.value
                                  }));
                                }}
                                onBlur={(e) => {
                                  const rawValue = parseFloat(e.target.value);
                                  const newValue = Math.round(rawValue * 10) / 10;
                                  if (!isNaN(newValue) && newValue > 0) {
                                    saveDValueMutation.mutate({
                                      category,
                                      workName,
                                      laborItem,
                                      standardWorkQuantity: newValue
                                    });
                                  }
                                  setEditedDValues(prev => {
                                    const newState = { ...prev };
                                    delete newState[overrideKey];
                                    return newState;
                                  });
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                className="w-20 px-2 py-1 text-center outline-none"
                                style={{
                                  border: "1px solid rgba(12, 12, 12, 0.2)",
                                  borderRadius: "4px",
                                  fontFamily: "Pretendard",
                                  fontSize: "13px",
                                  background: hasOverride ? "rgba(37, 51, 150, 0.05)" : "#FFFFFF",
                                }}
                                data-testid={`input-d-value-${rowIdx}`}
                              />
                              {hasOverride && (
                                <span
                                  title="사용자 지정값 (기본값과 다름)"
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: "16px",
                                    height: "16px",
                                    borderRadius: "50%",
                                    background: "#253396",
                                    color: "#FFFFFF",
                                    fontSize: "10px",
                                    fontWeight: 700,
                                  }}
                                >
                                  ✓
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      }
                      
                      return (
                        <td
                          key={cellIdx}
                          className="px-4 py-4"
                          rowSpan={rowspan > 1 ? rowspan : undefined}
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            color: "#0C0C0C",
                            whiteSpace: "nowrap",
                            verticalAlign: rowspan > 1 ? "middle" : undefined,
                            borderRight: "1px solid rgba(12, 12, 12, 0.08)",
                            borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                            background: rowspan > 1 ? "rgba(248, 248, 248, 0.5)" : undefined,
                          }}
                        >
                          {displayValue}
                        </td>
                      );
                    })}
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>
    </>
  );
}
