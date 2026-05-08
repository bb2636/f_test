import { Star } from "lucide-react";
import type { MasterData, InsertMasterData } from "@shared/schema";
import type { UseMutationResult } from "@tanstack/react-query";

interface MasterDataTabProps {
  selectedCategory: string;
  setSelectedCategory: (v: string) => void;
  masterDataSearchQuery: string;
  setMasterDataSearchQuery: (v: string) => void;
  selectedMasterDataIds: Set<string>;
  setSelectedMasterDataIds: (v: Set<string>) => void;
  editingMasterData: Record<string, { value: string; note: string }>;
  setEditingMasterData: React.Dispatch<React.SetStateAction<Record<string, { value: string; note: string }>>>;
  allCategories: string[];
  isMasterDataCategory: (category: string) => boolean;
  getCategoryCount: (category: string) => number;
  getCategoryItems: (category: string) => any[];
  MASTER_DATA_CATEGORIES: Record<string, string>;
  isMasterDataManagementFavorite: boolean;
  toggleFavoriteMutation: UseMutationResult<any, any, string, any>;
  createMasterDataMutation: UseMutationResult<any, any, InsertMasterData, any>;
  updateMasterDataMutation: UseMutationResult<any, any, { id: string; value: string; note?: string }, any>;
  deleteSelectedMasterData: () => void;
  draggedItemId: string | null;
  dragOverItemId: string | null;
  handleDragStart: (e: React.DragEvent, itemId: string) => void;
  handleDragOver: (e: React.DragEvent, itemId: string) => void;
  handleDragLeave: () => void;
  handleDrop: (e: React.DragEvent, targetItemId: string) => void;
  handleDragEnd: () => void;
}

export function MasterDataTab({
  selectedCategory,
  setSelectedCategory,
  masterDataSearchQuery,
  setMasterDataSearchQuery,
  selectedMasterDataIds,
  setSelectedMasterDataIds,
  editingMasterData,
  setEditingMasterData,
  allCategories,
  isMasterDataCategory,
  getCategoryCount,
  getCategoryItems,
  MASTER_DATA_CATEGORIES,
  isMasterDataManagementFavorite,
  toggleFavoriteMutation,
  createMasterDataMutation,
  updateMasterDataMutation,
  deleteSelectedMasterData,
  draggedItemId,
  dragOverItemId,
  handleDragStart,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleDragEnd,
}: MasterDataTabProps) {
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
            기준정보 관리
          </h1>
          <button
            onClick={() => toggleFavoriteMutation.mutate("기준정보 관리")}
            className="hover:opacity-70 transition-opacity cursor-pointer"
            data-testid="button-toggle-masterdata-favorite"
          >
            <Star 
              className="w-5 h-5" 
              style={{ 
                color: isMasterDataManagementFavorite ? '#FFD700' : 'rgba(12, 12, 12, 0.24)',
                fill: isMasterDataManagementFavorite ? '#FFD700' : 'none',
              }} 
            />
          </button>
        </div>
      </div>

      <div className="flex gap-6">
        <div
          className="w-80 rounded-xl p-6 flxn-search-card"
          style={{
            background: "#FFFFFF",
            boxShadow: "0px 0px 20px #DBE9F5",
          }}
        >
          <h3
            className="mb-4"
            style={{
              fontFamily: "Pretendard",
              fontSize: "18px",
              fontWeight: 600,
              color: "#0C0C0C",
            }}
          >
            기준정보 목록
          </h3>

          <div className="mb-4">
            <label
              className="block mb-2"
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 500,
                color: "#686A6E",
              }}
            >
              항목 검색
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={masterDataSearchQuery}
                onChange={(e) => setMasterDataSearchQuery(e.target.value)}
                placeholder="검색어를 입력하세요"
                className="flex-1 px-3 py-2 outline-none"
                style={{
                  background: "#FFFFFF",
                  border: "1px solid rgba(12, 12, 12, 0.08)",
                  borderRadius: "6px",
                  fontFamily: "Pretendard",
                  fontSize: "13px",
                }}
                data-testid="input-master-search"
              />
              <button
                className="px-4 py-2"
                style={{
                  background: "var(--color-button-primary)",
                  borderRadius: "6px",
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#FFFFFF",
                }}
                data-testid="button-master-search"
              >
                검색
              </button>
            </div>
          </div>

          <div className="space-y-2" style={{ maxHeight: "400px", overflowY: "auto" }}>
            {allCategories
              .filter(category => 
                masterDataSearchQuery === "" || 
                category.toLowerCase().includes(masterDataSearchQuery.toLowerCase())
              )
              .map((category) => (
              <div key={category}>
                <button
                  onClick={() => {
                    setSelectedCategory(category);
                    setSelectedMasterDataIds(new Set());
                  }}
                  className="w-full text-left px-4 py-3 rounded-lg transition-colors"
                  style={{
                    background: selectedCategory === category ? "rgba(86, 104, 127, 0.08)" : "transparent",
                    fontFamily: "Pretendard",
                    fontSize: "15px",
                    fontWeight: selectedCategory === category ? 600 : 400,
                    color: selectedCategory === category ? "var(--color-button-primary)" : "#0C0C0C",
                    border: selectedCategory === category ? "1px solid rgba(86, 104, 127, 0.25)" : "1px solid transparent",
                  }}
                  data-testid={`category-${category}`}
                >
                  <div className="flex items-center justify-between">
                    <span>{category}</span>
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 400,
                      color: "#686A6E",
                      marginTop: "4px",
                    }}
                  >
                    {category} 목록
                  </div>
                  <div className="mt-2">
                    <span
                      className="inline-block px-2 py-1 rounded"
                      style={{
                        background: "rgba(86, 104, 127, 0.12)",
                        fontSize: "11px",
                        fontWeight: 500,
                        color: "var(--color-button-primary)",
                      }}
                    >
                      {["사고 유형", "사고 원인", "복구 유형", "타업체 견적 여부", "피해품목", "피해유형"].includes(category) ? "현장입력" : "복구면적 산출표"}
                    </span>
                  </div>
                </button>
              </div>
            ))}
          </div>
        </div>

        <div
          className="flex-1 rounded-xl p-6"
          style={{
            background: "#FFFFFF",
            boxShadow: "0px 0px 20px #DBE9F5",
          }}
        >
          <h3
            className="mb-6"
            style={{
              fontFamily: "Pretendard",
              fontSize: "20px",
              fontWeight: 600,
              color: "#0C0C0C",
            }}
          >
            선택된 항목
          </h3>

          <div className="flex items-center gap-3 mb-6">
            <span style={{ color: "var(--color-button-primary)", fontSize: "16px" }}>●</span>
            <span
              style={{
                fontFamily: "Pretendard",
                fontSize: "16px",
                fontWeight: 600,
                color: "#0C0C0C",
              }}
            >
              {selectedCategory}
            </span>
            <span
              className="px-2 py-1 rounded"
              style={{
                background: "rgba(86, 104, 127, 0.12)",
                fontSize: "12px",
                fontWeight: 500,
                color: "var(--color-button-primary)",
              }}
            >
              {["사고 유형", "사고 원인", "복구 유형", "타업체 견적 여부", "피해품목", "피해유형"].includes(selectedCategory) ? "현장입력" : "복구면적 산출표"}
            </span>
            <span
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 400,
                color: "#686A6E",
              }}
            >
              {selectedCategory} 목록
            </span>
          </div>

          <div className="flex gap-3 mb-6">
            <button
              onClick={() => {
                if (isMasterDataCategory(selectedCategory)) {
                  const categoryKey = MASTER_DATA_CATEGORIES[selectedCategory];
                  const currentCount = getCategoryCount(selectedCategory);
                  const timestamp = Date.now();
                  createMasterDataMutation.mutate({
                    category: categoryKey,
                    value: `(새 항목 ${timestamp})`,
                    isActive: "true",
                    displayOrder: currentCount,
                  });
                }
              }}
              className="px-4 py-2"
              style={{
                background: "var(--color-button-primary)",
                borderRadius: "6px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 600,
                color: "#FFFFFF",
              }}
              data-testid="button-add-row"
            >
              행 추가
            </button>
            <button
              onClick={deleteSelectedMasterData}
              className="px-4 py-2"
              style={{
                background: "#FFFFFF",
                border: "1px solid rgba(12, 12, 12, 0.1)",
                borderRadius: "6px",
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 500,
                color: "#686A6E",
              }}
              data-testid="button-delete-selected"
            >
              선택 행 삭제
            </button>
          </div>

          <div>
            <table className="w-full">
              <thead
                style={{
                  background: "rgba(248, 248, 248, 1)",
                }}
              >
                <tr className="compact-row">
                  <th
                    className="px-4 py-3 text-left"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#686A6E",
                      width: "60px",
                    }}
                  >
                    정렬
                  </th>
                  <th
                    className="px-4 py-3 text-center"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#686A6E",
                      width: "50px",
                    }}
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      style={{ accentColor: "#008FED" }}
                      checked={(() => {
                        const items = getCategoryItems(selectedCategory);
                        if (items.length === 0) return false;
                        const isMaster = isMasterDataCategory(selectedCategory);
                        if (!isMaster) return false;
                        return (items as MasterData[]).every(item => selectedMasterDataIds.has(item.id));
                      })()}
                      onChange={(e) => {
                        const items = getCategoryItems(selectedCategory);
                        const isMaster = isMasterDataCategory(selectedCategory);
                        if (!isMaster) return;
                        if (e.target.checked) {
                          const newIds = new Set((items as MasterData[]).map(item => item.id));
                          setSelectedMasterDataIds(newIds);
                        } else {
                          setSelectedMasterDataIds(new Set());
                        }
                      }}
                      data-testid="checkbox-select-all"
                    />
                  </th>
                  <th
                    className="px-4 py-3 text-left"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#686A6E",
                    }}
                  >
                    내용
                  </th>
                  <th
                    className="px-4 py-3 text-left"
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "#686A6E",
                      width: "200px",
                    }}
                  >
                    메모
                  </th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const items = getCategoryItems(selectedCategory);
                  const isMasterCategory = isMasterDataCategory(selectedCategory);
                  
                  if (items.length === 0) {
                    return (
                      <tr className="compact-row">
                        <td
                          colSpan={4}
                          className="px-4 py-8 text-center"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            color: "#686A6E",
                          }}
                        >
                          등록된 항목이 없습니다. 행 추가 버튼을 클릭해주세요.
                        </td>
                      </tr>
                    );
                  }
                  
                  return items.map((item, idx) => {
                    const itemValue = isMasterCategory ? (item as MasterData).value : (item as string);
                    const itemNote = isMasterCategory ? (item as MasterData).note || "" : "";
                    const itemId = isMasterCategory ? (item as MasterData).id : `mem-${idx}`;
                    const isEditing = editingMasterData[itemId];
                    const isDragging = draggedItemId === itemId;
                    const isDragOver = dragOverItemId === itemId;
                    
                    return (
                      <tr className="compact-row"
                        key={itemId}
                        draggable={isMasterCategory}
                        onDragStart={(e) => isMasterCategory && handleDragStart(e, itemId)}
                        onDragOver={(e) => isMasterCategory && handleDragOver(e, itemId)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => isMasterCategory && handleDrop(e, itemId)}
                        onDragEnd={handleDragEnd}
                        style={{
                          borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                          opacity: isDragging ? 0.5 : 1,
                          background: isDragOver ? "rgba(0, 143, 237, 0.1)" : "transparent",
                          transition: "background 0.2s ease",
                        }}
                      >
                        <td
                          className="px-4 py-3"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            color: "#686A6E",
                            cursor: isMasterCategory ? "grab" : "default",
                          }}
                        >
                          ≡
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            className="w-4 h-4"
                            style={{ accentColor: "#008FED" }}
                            checked={selectedMasterDataIds.has(itemId)}
                            onChange={(e) => {
                              const newIds = new Set(selectedMasterDataIds);
                              if (e.target.checked) {
                                newIds.add(itemId);
                              } else {
                                newIds.delete(itemId);
                              }
                              setSelectedMasterDataIds(newIds);
                            }}
                            data-testid={`checkbox-item-${idx}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <input
                              type="text"
                              value={isEditing.value}
                              onChange={(e) => {
                                setEditingMasterData(prev => ({
                                  ...prev,
                                  [itemId]: { ...prev[itemId], value: e.target.value }
                                }));
                              }}
                              onBlur={() => {
                                if (isMasterCategory && isEditing.value !== itemValue) {
                                  updateMasterDataMutation.mutate({
                                    id: itemId,
                                    value: isEditing.value,
                                    note: isEditing.note,
                                  });
                                }
                                setEditingMasterData(prev => {
                                  const newData = { ...prev };
                                  delete newData[itemId];
                                  return newData;
                                });
                              }}
                              className="w-full px-3 py-2 outline-none"
                              style={{
                                background: "#FFFFFF",
                                border: "1px solid #008FED",
                                borderRadius: "4px",
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                              }}
                              autoFocus
                              data-testid={`input-value-${idx}`}
                            />
                          ) : (
                            <div
                              onClick={() => {
                                setEditingMasterData(prev => ({
                                  ...prev,
                                  [itemId]: { value: itemValue, note: itemNote }
                                }));
                              }}
                              className="px-3 py-2 cursor-text"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: itemValue ? "#0C0C0C" : "#ABABAB",
                                background: "rgba(248, 248, 248, 0.5)",
                                borderRadius: "4px",
                              }}
                              data-testid={`text-value-${idx}`}
                            >
                              {itemValue || "내용을 입력하세요"}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 400,
                              color: itemNote ? "#0C0C0C" : "#ABABAB",
                            }}
                          >
                            {itemNote || "-"}
                          </span>
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
