import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, X, ChevronDown, Upload, ChevronRight, Download, Printer, CheckCircle2, Star, ZoomIn, Trash2, Shield } from "lucide-react";
import logoIcon from "@assets/Frame 2_1762217940686.png";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { User, VALID_ROLES, type ExcelData, type Inquiry, type MasterData, type InsertMasterData, type Notice, type CaseChangeLog, type UnitPriceOverride } from "@shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GlobalHeader } from "@/components/global-header";
import { AccessControlPanel } from "@/components/access-control-panel";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { LaborRateTiersButton } from "@/components/labor-rate-tiers-modal";
import { usePermissions } from "@/hooks/use-permissions";

// Fallback xlsx parser for files with XML namespace prefixes that xlsx library can't handle
async function parseXlsxFallback(file: File): Promise<{ headers: string[], data: any[][] }> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  
  // Get shared strings
  const sharedStringsFile = zip.file('xl/sharedStrings.xml');
  const sharedStrings: string[] = [];
  if (sharedStringsFile) {
    const ssXml = await sharedStringsFile.async('string');
    const siMatches = ssXml.match(/<(?:si|x:si)>[\s\S]*?<\/(?:si|x:si)>/g) || [];
    siMatches.forEach(si => {
      const tMatch = si.match(/<(?:t|x:t)[^>]*>([^<]*)<\/(?:t|x:t)>/);
      sharedStrings.push(tMatch ? tMatch[1] : '');
    });
  }
  
  // Get sheet data
  const sheetFile = zip.file('xl/worksheets/sheet1.xml');
  if (!sheetFile) {
    throw new Error('Sheet1 not found in xlsx file');
  }
  
  const sheetXml = await sheetFile.async('string');
  const rawRows: Map<number, any>[] = [];
  const rowMatches = sheetXml.match(/<(?:row|x:row)[^>]*>[\s\S]*?<\/(?:row|x:row)>/g) || [];
  
  rowMatches.forEach(rowXml => {
    // Parse cells by matching self-closing and content cells separately
    // Self-closing: <x:c ... /> (empty cells)
    const selfClosingCells = rowXml.match(/<(?:c|x:c)\s+[^>]*\/>/g) || [];
    // Content cells: <x:c ...><x:v>...</x:v></x:c> (cells with values)
    const contentCells = rowXml.match(/<(?:c|x:c)\s[^>]*>(?!\s*<(?:c|x:c))[^<]*<(?:v|x:v)>[^<]*<\/(?:v|x:v)><\/(?:c|x:c)>/g) || [];
    const allCells = [...selfClosingCells, ...contentCells];
    
    const rowMap = new Map<number, any>();
    
    allCells.forEach(cellXml => {
      const refMatch = cellXml.match(/r="([A-Z]+)\d+"/);
      if (!refMatch) return;
      
      const colLetter = refMatch[1];
      let colIdx = 0;
      for (let i = 0; i < colLetter.length; i++) {
        colIdx = colIdx * 26 + (colLetter.charCodeAt(i) - 64);
      }
      colIdx -= 1;
      
      const typeMatch = cellXml.match(/t="([^"]+)"/);
      const cellType = typeMatch ? typeMatch[1] : 'n';
      
      const valMatch = cellXml.match(/<(?:v|x:v)>([^<]*)<\/(?:v|x:v)>/);
      let value: any = valMatch ? valMatch[1] : null;
      
      if (cellType === 's' && value !== null) {
        const idx = parseInt(value);
        value = sharedStrings[idx] || '';
      } else if (value !== null) {
        const num = parseFloat(value);
        value = isNaN(num) ? value : num;
      }
      
      rowMap.set(colIdx, value);
    });
    
    if (rowMap.size > 0) rawRows.push(rowMap);
  });
  
  if (rawRows.length === 0) {
    throw new Error('No data found in xlsx file');
  }
  
  // Find required header columns: 공종, 공사명, 노임항목, 금액
  const requiredHeaders = ['공종', '공사명', '노임항목', '금액'];
  const headerRow = rawRows[0];
  const columnMapping: number[] = [];
  
  requiredHeaders.forEach(headerName => {
    const entries = Array.from(headerRow.entries());
    for (const [colIdx, value] of entries) {
      if (value === headerName && !columnMapping.includes(colIdx)) {
        columnMapping.push(colIdx);
        break;
      }
    }
  });
  
  // If we found all 4 required columns, use mapping; otherwise fallback to raw
  let headers: string[];
  let data: any[][];
  
  if (columnMapping.length === 4) {
    headers = requiredHeaders;
    data = rawRows.slice(1).map(rowMap => {
      return columnMapping.map(colIdx => rowMap.get(colIdx) ?? null);
    });
  } else {
    // Fallback: just use raw columns in order
    const maxCol = Math.max(...rawRows.flatMap(r => Array.from(r.keys())));
    headers = [];
    for (let i = 0; i <= maxCol; i++) {
      headers.push(headerRow.get(i)?.toString() || '');
    }
    data = rawRows.slice(1).map(rowMap => {
      const row: any[] = [];
      for (let i = 0; i <= maxCol; i++) {
        row.push(rowMap.get(i) ?? null);
      }
      return row;
    });
  }
  
  return { headers, data };
}

// 한국 행정구역 데이터
const KOREA_REGIONS: Record<string, string[]> = {
  서울: [
    "강남구",
    "강동구",
    "강북구",
    "강서구",
    "관악구",
    "광진구",
    "구로구",
    "금천구",
    "노원구",
    "도봉구",
    "동대문구",
    "동작구",
    "마포구",
    "서대문구",
    "서초구",
    "성동구",
    "성북구",
    "송파구",
    "양천구",
    "영등포구",
    "용산구",
    "은평구",
    "종로구",
    "중구",
    "중랑구",
  ],
  경기: [
    "고양시",
    "과천시",
    "광명시",
    "광주시",
    "구리시",
    "군포시",
    "김포시",
    "남양주시",
    "동두천시",
    "부천시",
    "성남시",
    "수원시",
    "시흥시",
    "안산시",
    "안성시",
    "안양시",
    "양주시",
    "오산시",
    "용인시",
    "의왕시",
    "의정부시",
    "이천시",
    "파주시",
    "평택시",
    "포천시",
    "하남시",
    "화성시",
    "가평군",
    "양평군",
    "여주군",
    "연천군",
  ],
  인천: [
    "계양구",
    "남동구",
    "동구",
    "미추홀구",
    "부평구",
    "서구",
    "연수구",
    "중구",
    "강화군",
    "옹진군",
  ],
  대전: ["대덕구", "동구", "서구", "유성구", "중구"],
  세종: ["세종시"],
  충남: [
    "계룡시",
    "공주시",
    "논산시",
    "당진시",
    "보령시",
    "서산시",
    "아산시",
    "천안시",
    "금산군",
    "부여군",
    "서천군",
    "예산군",
    "청양군",
    "태안군",
    "홍성군",
  ],
  충북: [
    "제천시",
    "청주시",
    "충주시",
    "괴산군",
    "단양군",
    "보은군",
    "영동군",
    "옥천군",
    "음성군",
    "증평군",
    "진천군",
  ],
  광주: ["광산구", "남구", "동구", "북구", "서구"],
  전남: [
    "광양시",
    "나주시",
    "목포시",
    "순천시",
    "여수시",
    "강진군",
    "고흥군",
    "곡성군",
    "구례군",
    "담양군",
    "무안군",
    "보성군",
    "신안군",
    "영광군",
    "영암군",
    "완도군",
    "장성군",
    "장흥군",
    "진도군",
    "함평군",
    "해남군",
    "화순군",
  ],
  전북: [
    "군산시",
    "김제시",
    "남원시",
    "익산시",
    "전주시",
    "정읍시",
    "고창군",
    "무주군",
    "부안군",
    "순창군",
    "완주군",
    "임실군",
    "장수군",
    "진안군",
  ],
  대구: ["남구", "달서구", "동구", "북구", "서구", "수성구", "중구", "달성군"],
  경북: [
    "경산시",
    "경주시",
    "구미시",
    "김천시",
    "문경시",
    "상주시",
    "안동시",
    "영주시",
    "영천시",
    "포항시",
    "고령군",
    "군위군",
    "봉화군",
    "성주군",
    "영덕군",
    "영양군",
    "예천군",
    "울릉군",
    "울진군",
    "의성군",
    "청도군",
    "청송군",
    "칠곡군",
  ],
  부산: [
    "강서구",
    "금정구",
    "남구",
    "동구",
    "동래구",
    "부산진구",
    "북구",
    "사상구",
    "사하구",
    "서구",
    "수영구",
    "연제구",
    "영도구",
    "중구",
    "해운대구",
    "기장군",
  ],
  울산: ["남구", "동구", "북구", "중구", "울주군"],
  경남: [
    "거제시",
    "김해시",
    "밀양시",
    "사천시",
    "양산시",
    "진주시",
    "창원시",
    "통영시",
    "거창군",
    "고성군",
    "남해군",
    "산청군",
    "의령군",
    "창녕군",
    "하동군",
    "함안군",
    "함양군",
    "합천군",
  ],
  강원: [
    "강릉시",
    "동해시",
    "삼척시",
    "속초시",
    "원주시",
    "춘천시",
    "태백시",
    "고성군",
    "양구군",
    "양양군",
    "영월군",
    "인제군",
    "정선군",
    "철원군",
    "평창군",
    "홍천군",
    "화천군",
    "횡성군",
  ],
  제주: ["서귀포시", "제주시"],
};

export default function AdminSettings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { hasItem: hasPermItem, isLoading: permissionsLoading } = usePermissions();
  const [activeMenu, setActiveMenu] = useState("사용자 계정 관리");
  const [roleFilter, setRoleFilter] = useState("전체");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selectedUser, setSelectedUser] = useState<Omit<
    User,
    "password"
  > | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedUserData, setEditedUserData] = useState<Partial<Omit<User, 'id' | 'username' | 'password' | 'company' | 'createdAt' | 'status'>>>({});
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [resetPasswordValue, setResetPasswordValue] = useState("0000");
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  
  // DB 관리 states
  const [dbTab, setDbTab] = useState("노무비");
  const [uploadTitle, setUploadTitle] = useState("");
  const [selectedLaborVersionId, setSelectedLaborVersionId] = useState<string | null>(null);
  const [selectedMaterialVersionId, setSelectedMaterialVersionId] = useState<string | null>(null);
  const [selectedUnitPriceVersionId, setSelectedUnitPriceVersionId] = useState<string | null>(null);
  // 노무비 데이터
  const [laborExcelData, setLaborExcelData] = useState<any[]>([]);
  const [laborExcelHeaders, setLaborExcelHeaders] = useState<string[]>([]);
  // 자재비 데이터
  const [materialExcelData, setMaterialExcelData] = useState<any[]>([]);
  const [materialExcelHeaders, setMaterialExcelHeaders] = useState<string[]>([]);
  // 일위대가 데이터
  const [unitPriceExcelData, setUnitPriceExcelData] = useState<any[]>([]);
  const [unitPriceExcelHeaders, setUnitPriceExcelHeaders] = useState<string[]>([]);
  // 일위대가 D값 편집 상태 (key: `${category}|${workName}|${laborItem}`, value: 편집된 D값)
  const [editedDValues, setEditedDValues] = useState<Record<string, string>>({});
  
  // 기준정보 관리 states
  const [selectedCategory, setSelectedCategory] = useState("장소");
  const [categoryItems, setCategoryItems] = useState<Record<string, string[]>>({});
  const [newItemInput, setNewItemInput] = useState("");
  const [masterDataSearchQuery, setMasterDataSearchQuery] = useState("");
  const [selectedMasterDataIds, setSelectedMasterDataIds] = useState<Set<string>>(new Set());
  const [editingMasterData, setEditingMasterData] = useState<Record<string, { value: string; note: string }>>({}); // 인라인 편집용
  const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);
  const [showDelegateConfirmModal, setShowDelegateConfirmModal] = useState(false);
  const [delegateTargetUser, setDelegateTargetUser] = useState<User | null>(null);
  const [isDelegating, setIsDelegating] = useState(false);
  const [showAccountCreatedModal, setShowAccountCreatedModal] = useState(false);
  const [showCancelConfirmModal, setShowCancelConfirmModal] = useState(false);
  const [sendEmailNotification, setSendEmailNotification] = useState(false);
  const [sendSmsNotification, setSendSmsNotification] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState("0000");
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [replyTitle, setReplyTitle] = useState("");
  const [replyContent, setReplyContent] = useState("");
  const [inquiryStatusFilter, setInquiryStatusFilter] = useState("전체");
  
  // Notice states
  const [showAddNoticeModal, setShowAddNoticeModal] = useState(false);
  const [showNoticeConfirmModal, setShowNoticeConfirmModal] = useState(false);
  const [showNoticeCancelConfirmModal, setShowNoticeCancelConfirmModal] = useState(false);
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeContent, setNoticeContent] = useState("");
  const [viewingNotice, setViewingNotice] = useState<Notice | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "inquiry" | "notice"; id: string; title: string } | null>(null);
  const [createAccountForm, setCreateAccountForm] = useState({
    role: "보험사",
    accountType: "개인" as "개인" | "회사",
    isSuperAdmin: false,
    name: "",
    company: "",
    department: "",
    position: "",
    email: "",
    username: "",
    password: "",
    phone: "",
    office: "",
    address: "",
    addressDetail: "",
    businessRegistrationNumber: "",
    representativeName: "",
    bankName: "",
    accountNumber: "",
    accountHolder: "",
    serviceRegions: [] as string[],
    attachments: [] as string[],
  });
  const [attachmentFilesData, setAttachmentFilesData] = useState<Array<{id: string, name: string, data: string, type: string}>>([]);
  const [pendingFileReads, setPendingFileReads] = useState(0);
  const [previewAttachment, setPreviewAttachment] = useState<{name: string, data: string, type: string} | null>(null);
  const [selectedAttachmentIndices, setSelectedAttachmentIndices] = useState<Set<number>>(new Set());
  const [showDeleteAttachmentsConfirm, setShowDeleteAttachmentsConfirm] = useState(false);
  const [regionSearchTerm, setRegionSearchTerm] = useState("");
  const [showRegionModal, setShowRegionModal] = useState(false);
  const [regionModalForEdit, setRegionModalForEdit] = useState(false);
  const [selectedProvince, setSelectedProvince] = useState("서울");
  const [tempSelectedRegions, setTempSelectedRegions] = useState<string[]>([]);
  
  // 다음 포스트코드 상태 (협력사 주소)
  const [showAddressSearch, setShowAddressSearch] = useState(false);

  // Check authentication
  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/user"],
  });
  const loggedInUser = user;

  // 마스터 데이터 카테고리 매핑 (UI 표시명 → DB 카테고리명)
  const MASTER_DATA_CATEGORIES: Record<string, string> = {
    "장소": "room_category",
    "위치": "location",
    "공사내용": "work_name",
    "사고 유형": "accident_type",
    "사고 원인": "accident_cause",
    "복구 유형": "recovery_type",
    "타업체 견적 여부": "other_company_estimate",
    "피해품목": "damage_item",
    "피해유형": "damage_type",
  };

  // DB 연동 마스터 데이터 조회 (관리자용: 비활성 데이터 포함)
  const { data: masterDataList = [], refetch: refetchMasterData } = useQuery<MasterData[]>({
    queryKey: ["/api/master-data", { includeInactive: "true" }],
    queryFn: async () => {
      const response = await fetch("/api/master-data?includeInactive=true", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch master data");
      return response.json();
    },
    enabled: !!user && user.role === "관리자",
  });

  // 선택된 카테고리의 마스터 데이터 필터링 (활성 항목만 표시)
  const currentMasterData = masterDataList.filter(
    (item) => item.category === MASTER_DATA_CATEGORIES[selectedCategory] && item.isActive === "true"
  );

  // 전체 카테고리 목록 (DB 연동 + 메모리 state)
  const allCategories = [...Object.keys(MASTER_DATA_CATEGORIES), ...Object.keys(categoryItems)];

  // 카테고리가 DB 연동 카테고리인지 확인
  const isMasterDataCategory = (category: string) => category in MASTER_DATA_CATEGORIES;

  // 카테고리의 항목 개수 계산 (활성 항목만)
  const getCategoryCount = (category: string) => {
    if (isMasterDataCategory(category)) {
      return masterDataList.filter(item => item.category === MASTER_DATA_CATEGORIES[category] && item.isActive === "true").length;
    }
    return categoryItems[category]?.length || 0;
  };

  // 카테고리의 항목 목록 가져오기 (활성 항목만)
  const getCategoryItems = (category: string) => {
    if (isMasterDataCategory(category)) {
      return masterDataList.filter(item => item.category === MASTER_DATA_CATEGORIES[category] && item.isActive === "true");
    }
    return categoryItems[category] || [];
  };

  // 마스터 데이터 생성 mutation
  const createMasterDataMutation = useMutation({
    mutationFn: async (data: InsertMasterData) => {
      return await apiRequest("POST", "/api/master-data", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/master-data"] });
      toast({
        title: "항목 추가 완료",
        description: "항목이 성공적으로 추가되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "추가 실패",
        description: error.message || "항목을 추가하는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 마스터 데이터 삭제 mutation
  const deleteMasterDataMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/master-data/${id}`);
    },
    onSuccess: async () => {
      // 캐시 무효화 후 명시적 refetch
      await queryClient.invalidateQueries({ queryKey: ["/api/master-data"] });
      await refetchMasterData();
      toast({
        title: "삭제 완료",
        description: "항목이 삭제되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "삭제 실패",
        description: error.message || "항목을 삭제하는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 마스터 데이터 수정 mutation
  const updateMasterDataMutation = useMutation({
    mutationFn: async (data: { id: string; value: string; note?: string }) => {
      return await apiRequest("PATCH", `/api/master-data/${data.id}`, { value: data.value, note: data.note });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/master-data"] });
      setEditingMasterData({});
      toast({
        title: "수정 완료",
        description: "항목이 수정되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "수정 실패",
        description: error.message || "항목을 수정하는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 드래그 앤 드롭 정렬용 상태
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);

  // 마스터 데이터 순서 변경 mutation
  const reorderMasterDataMutation = useMutation({
    mutationFn: async (updates: Array<{ id: string; displayOrder: number }>) => {
      await Promise.all(
        updates.map(update => 
          apiRequest("PATCH", `/api/master-data/${update.id}`, { displayOrder: update.displayOrder })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/master-data"] });
      toast({
        title: "순서 변경 완료",
        description: "항목 순서가 변경되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "순서 변경 실패",
        description: error.message || "순서를 변경하는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 드래그 앤 드롭 핸들러
  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggedItemId(itemId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, itemId: string) => {
    e.preventDefault();
    if (draggedItemId && draggedItemId !== itemId) {
      setDragOverItemId(itemId);
    }
  };

  const handleDragLeave = () => {
    setDragOverItemId(null);
  };

  const handleDrop = (e: React.DragEvent, targetItemId: string) => {
    e.preventDefault();
    if (!draggedItemId || draggedItemId === targetItemId) {
      setDraggedItemId(null);
      setDragOverItemId(null);
      return;
    }

    const items = getCategoryItems(selectedCategory);
    const isMasterCategory = isMasterDataCategory(selectedCategory);
    
    if (isMasterCategory) {
      const masterItems = items as MasterData[];
      const draggedIdx = masterItems.findIndex(item => item.id === draggedItemId);
      const targetIdx = masterItems.findIndex(item => item.id === targetItemId);
      
      if (draggedIdx !== -1 && targetIdx !== -1) {
        const newItems = [...masterItems];
        const [removed] = newItems.splice(draggedIdx, 1);
        newItems.splice(targetIdx, 0, removed);
        
        const updates = newItems.map((item, idx) => ({
          id: item.id,
          displayOrder: idx,
        }));
        
        reorderMasterDataMutation.mutate(updates);
      }
    }

    setDraggedItemId(null);
    setDragOverItemId(null);
  };

  const handleDragEnd = () => {
    setDraggedItemId(null);
    setDragOverItemId(null);
  };

  // 선택된 마스터 데이터 일괄 삭제
  const deleteSelectedMasterData = () => {
    if (selectedMasterDataIds.size === 0) {
      toast({
        title: "선택된 항목이 없습니다",
        description: "삭제할 항목을 선택해주세요.",
        variant: "destructive",
      });
      return;
    }
    selectedMasterDataIds.forEach(id => {
      deleteMasterDataMutation.mutate(id);
    });
    setSelectedMasterDataIds(new Set());
  };

  // Fetch all users from server
  const { data: rawUsers, isLoading: usersLoading, isError: usersError, error: usersQueryError, refetch: refetchUsers } = useQuery<
    Omit<User, "password">[]
  >({
    queryKey: ["/api/users"],
    enabled: !!user,
    queryFn: async () => {
      try {
        const res = await fetch("/api/users", { credentials: "include" });
        if (res.status === 401) {
          console.warn("[AdminSettings] /api/users returned 401, session may have expired");
          return [];
        }
        if (!res.ok) {
          throw new Error(`${res.status}: ${res.statusText}`);
        }
        return await res.json();
      } catch (err) {
        console.error("[AdminSettings] /api/users fetch error:", err);
        throw err;
      }
    },
    retry: 10,
    retryDelay: (attemptIndex) => {
      if (attemptIndex < 3) return 2000;
      if (attemptIndex < 6) return 3000;
      return 5000;
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const allUsers = rawUsers ?? [];

  useEffect(() => {
    if (usersError && allUsers.length === 0) {
      console.error("[AdminSettings] Users query failed, auto-retrying in 5s:", usersQueryError?.message);
      const timer = setTimeout(() => {
        refetchUsers();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [usersError, allUsers.length, usersQueryError, refetchUsers]);

  useEffect(() => {
    if (selectedUser?.id) {
      fetch(`/api/users/${selectedUser.id}/attachments`, { credentials: "include" })
        .then(res => res.ok ? res.json() : { attachments: [] })
        .then(data => {
          setSelectedUser(prev => prev ? { ...prev, attachments: data.attachments || [] } : null);
        })
        .catch(() => {});
    }
  }, [selectedUser?.id]);

  // Fetch labor cost Excel versions
  const { data: laborVersions = [], isLoading: laborVersionsLoading } = useQuery<ExcelData[]>({
    queryKey: ["/api/excel-data/노무비/versions"],
    enabled: !!user && activeMenu === "DB 관리",
  });

  // Fetch material cost Excel versions
  const { data: materialVersions = [], isLoading: materialVersionsLoading } = useQuery<ExcelData[]>({
    queryKey: ["/api/excel-data/자재비/versions"],
    enabled: !!user && activeMenu === "DB 관리",
  });

  // Fetch unit price Excel versions
  const { data: unitPriceVersions = [], isLoading: unitPriceVersionsLoading } = useQuery<ExcelData[]>({
    queryKey: ["/api/excel-data/일위대가/versions"],
    enabled: !!user && activeMenu === "DB 관리",
  });

  // Fetch selected labor version detail
  const { data: selectedLaborVersion } = useQuery<ExcelData | null>({
    queryKey: [`/api/excel-data/detail/${selectedLaborVersionId}`],
    enabled: !!selectedLaborVersionId && activeMenu === "DB 관리",
  });

  // Fetch selected material version detail
  const { data: selectedMaterialVersion } = useQuery<ExcelData | null>({
    queryKey: [`/api/excel-data/detail/${selectedMaterialVersionId}`],
    enabled: !!selectedMaterialVersionId && activeMenu === "DB 관리",
  });

  // Fetch selected unit price version detail
  const { data: selectedUnitPriceVersion } = useQuery<ExcelData | null>({
    queryKey: [`/api/excel-data/detail/${selectedUnitPriceVersionId}`],
    enabled: !!selectedUnitPriceVersionId && activeMenu === "DB 관리",
  });

  // Fetch D value overrides for 일위대가
  const { data: unitPriceOverrides = [] } = useQuery<UnitPriceOverride[]>({
    queryKey: ["/api/unit-price-overrides"],
    enabled: !!user && activeMenu === "DB 관리" && dbTab === "일위대가",
  });

  // Create a lookup map for D value overrides (key: `${category}|${workName}|${laborItem}`)
  const overridesMap = new Map<string, number>();
  unitPriceOverrides.forEach((override) => {
    const key = `${override.category}|${override.workName}|${override.laborItem}`;
    overridesMap.set(key, override.standardWorkQuantity);
  });

  // Mutation for saving D value override
  const saveDValueMutation = useMutation({
    mutationFn: async (data: { category: string; workName: string; laborItem: string; standardWorkQuantity: number }) => {
      return await apiRequest("POST", "/api/unit-price-overrides", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/unit-price-overrides"] });
      toast({
        title: "저장 완료",
        description: "기준작업량이 성공적으로 저장되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "저장 실패",
        description: error.message || "기준작업량을 저장하는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // Auto-select latest version when versions change (validates selection still exists)
  useEffect(() => {
    if (laborVersions.length > 0 && !laborVersions.find(v => v.id === selectedLaborVersionId)) {
      setSelectedLaborVersionId(laborVersions[0].id);
    } else if (laborVersions.length === 0 && selectedLaborVersionId !== null) {
      setSelectedLaborVersionId(null);
    }
  }, [laborVersions, selectedLaborVersionId]);

  useEffect(() => {
    if (materialVersions.length > 0 && !materialVersions.find(v => v.id === selectedMaterialVersionId)) {
      setSelectedMaterialVersionId(materialVersions[0].id);
    } else if (materialVersions.length === 0 && selectedMaterialVersionId !== null) {
      setSelectedMaterialVersionId(null);
    }
  }, [materialVersions, selectedMaterialVersionId]);

  useEffect(() => {
    if (unitPriceVersions.length > 0 && !unitPriceVersions.find(v => v.id === selectedUnitPriceVersionId)) {
      setSelectedUnitPriceVersionId(unitPriceVersions[0].id);
    } else if (unitPriceVersions.length === 0 && selectedUnitPriceVersionId !== null) {
      setSelectedUnitPriceVersionId(null);
    }
  }, [unitPriceVersions, selectedUnitPriceVersionId]);

  // Sync selected version data to local state
  useEffect(() => {
    if (selectedLaborVersion) {
      setLaborExcelHeaders(selectedLaborVersion.headers);
      setLaborExcelData(selectedLaborVersion.data);
    } else {
      setLaborExcelHeaders([]);
      setLaborExcelData([]);
    }
  }, [selectedLaborVersion]);

  useEffect(() => {
    if (selectedMaterialVersion) {
      setMaterialExcelHeaders(selectedMaterialVersion.headers);
      setMaterialExcelData(selectedMaterialVersion.data);
    } else {
      setMaterialExcelHeaders([]);
      setMaterialExcelData([]);
    }
  }, [selectedMaterialVersion]);

  useEffect(() => {
    if (selectedUnitPriceVersion) {
      setUnitPriceExcelHeaders(selectedUnitPriceVersion.headers);
      
      // 일위대가 데이터 중복 제거 (공종+공사명+노임항목 기준)
      // Forward-fill 적용하여 빈 셀 처리
      const rawData = selectedUnitPriceVersion.data || [];
      const seen = new Set<string>();
      let prevCategory = '';
      let prevWorkName = '';
      
      const uniqueData = rawData.filter((row: any[]) => {
        if (!Array.isArray(row) || row.length < 3) return true; // Keep non-data rows
        
        // Forward-fill: 현재 값이 없으면 이전 값 사용
        const rawCategory = String(row[0] || '').trim();
        const rawWorkName = String(row[1] || '').trim();
        const laborItem = String(row[2] || '').trim();
        
        const category = rawCategory || prevCategory;
        const workName = rawWorkName || prevWorkName;
        
        // Update forward-fill values
        if (rawCategory) prevCategory = rawCategory;
        if (rawWorkName) prevWorkName = rawWorkName;
        
        // Skip header rows
        if (category === '공종' || laborItem === '노임항목') return true;
        
        // Skip rows without essential data
        if (!category && !workName && !laborItem) return true;
        if (!laborItem) return true; // 노임항목 필수
        
        const key = `${category}|${workName}|${laborItem}`;
        if (seen.has(key)) {
          return false; // Duplicate
        }
        seen.add(key);
        return true;
      });
      
      setUnitPriceExcelData(uniqueData);
    } else {
      setUnitPriceExcelHeaders([]);
      setUnitPriceExcelData([]);
    }
  }, [selectedUnitPriceVersion]);

  useEffect(() => {
    if (!userLoading && !user) {
      setLocation("/");
    }
  }, [user, userLoading, setLocation]);

  // 다음 포스트코드 스크립트 로드
  useEffect(() => {
    const script = document.createElement('script');
    script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    script.async = true;
    document.head.appendChild(script);
    return () => {
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, []);

  const allSidebarMenus = [
    { name: "사용자 계정 관리", active: true, permissionItem: "계정관리" },
    ...(user?.isSuperAdmin ? [{ name: "접근 권한 관리", active: false, permissionItem: null }] : []),
    { name: "1:1 문의 관리", active: false, permissionItem: null },
    { name: "공지사항 관리", active: false, permissionItem: null },
    { name: "DB 관리", active: false, permissionItem: "DB관리" },
    { name: "기준정보 관리", active: false, permissionItem: "기준정보 관리" },
    { name: "변경 로그 관리", active: false, permissionItem: null },
  ];

  const sidebarMenus = allSidebarMenus.filter((menu) => {
    if (permissionsLoading) return true;
    if (!menu.permissionItem) return true;
    return hasPermItem("관리자 설정", menu.permissionItem);
  });

  useEffect(() => {
    if (permissionsLoading) return;
    const isCurrentMenuVisible = sidebarMenus.some((m) => m.name === activeMenu);
    if (!isCurrentMenuVisible && sidebarMenus.length > 0) {
      setActiveMenu(sidebarMenus[0].name);
    }
  }, [permissionsLoading, sidebarMenus.map(m => m.name).join(",")]);

  // Excel data mutations
  const saveExcelDataMutation = useMutation({
    mutationFn: async (data: { type: string; title: string; headers: string[]; data: any[][] }) => {
      const response = await apiRequest("POST", "/api/excel-data", data);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(errorData.error || "업로드 실패") as any;
        error.status = response.status;
        throw error;
      }
      return await response.json();
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/excel-data/${variables.type}/versions`] });
      // Auto-select newly created version
      if (result && result.id) {
        if (variables.type === "노무비") {
          setSelectedLaborVersionId(result.id);
        } else if (variables.type === "자재비") {
          setSelectedMaterialVersionId(result.id);
        } else if (variables.type === "일위대가") {
          setSelectedUnitPriceVersionId(result.id);
        }
      }
    },
  });

  const deleteVersionMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/excel-data/id/${id}`);
    },
    onSuccess: async (_, deletedId) => {
      const currentType = dbTab;
      
      // Clear selection if deleted version was selected
      if (currentType === "노무비" && selectedLaborVersionId === deletedId) {
        setSelectedLaborVersionId(null);
      } else if (currentType === "자재비" && selectedMaterialVersionId === deletedId) {
        setSelectedMaterialVersionId(null);
      } else if (currentType === "일위대가" && selectedUnitPriceVersionId === deletedId) {
        setSelectedUnitPriceVersionId(null);
      }
      
      // Invalidate and refetch versions (useEffect will auto-select latest)
      await queryClient.invalidateQueries({ queryKey: [`/api/excel-data/${currentType}/versions`] });
    },
  });

  // Fetch inquiries
  const { data: inquiries = [], isLoading: inquiriesLoading } = useQuery<Inquiry[]>({
    queryKey: ["/api/inquiries"],
    enabled: !!user && activeMenu === "1:1 문의 관리",
  });

  // Fetch favorites for admin
  const { data: favorites = [] } = useQuery<{ id: string; menuName: string }[]>({
    queryKey: ["/api/favorites"],
    enabled: !!user,
  });

  // Check if pages are favorites
  const isInquiryManagementFavorite = favorites.some(fav => fav.menuName === "1:1 문의 관리");
  const isNoticeManagementFavorite = favorites.some(fav => fav.menuName === "공지사항 관리");
  const isDbManagementFavorite = favorites.some(fav => fav.menuName === "DB 관리");
  const isMasterDataManagementFavorite = favorites.some(fav => fav.menuName === "기준정보 관리");

  // Filter inquiries based on status
  const filteredInquiries = inquiries.filter((inquiry) => {
    if (inquiryStatusFilter === "전체") return true;
    if (inquiryStatusFilter === "완료") return inquiry.response !== null && inquiry.response !== "";
    if (inquiryStatusFilter === "대기") return inquiry.response === null || inquiry.response === "";
    return true;
  });

  // Toggle favorite mutation
  const toggleFavoriteMutation = useMutation({
    mutationFn: async (menuName: string) => {
      const isFavorite = favorites.some(fav => fav.menuName === menuName);
      if (isFavorite) {
        return await apiRequest("DELETE", `/api/favorites/${encodeURIComponent(menuName)}`);
      } else {
        return await apiRequest("POST", "/api/favorites", { menuName });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      toast({
        description: isInquiryManagementFavorite ? "즐겨찾기에서 해제되었습니다" : "즐겨찾기에 추가되었습니다",
      });
    },
  });

  // Inquiry mutations
  const updateInquiryMutation = useMutation({
    mutationFn: async ({ id, responseTitle, response }: { id: string; responseTitle: string; response: string }) => {
      return await apiRequest("PATCH", `/api/inquiries/${id}`, { responseTitle, response });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inquiries"] });
    },
  });

  const deleteInquiryMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/inquiries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inquiries"] });
      toast({ description: "문의가 삭제되었습니다." });
    },
  });

  const deleteNoticeMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/notices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notices"] });
      toast({ description: "공지사항이 삭제되었습니다." });
    },
  });

  // Fetch notices
  const { data: notices = [], isLoading: noticesLoading } = useQuery<Notice[]>({
    queryKey: ["/api/notices"],
    enabled: !!user && activeMenu === "공지사항 관리",
  });

  // Change log state and query
  const [changeLogCaseNumberFilter, setChangeLogCaseNumberFilter] = useState("");
  const [changeLogDateFrom, setChangeLogDateFrom] = useState("");
  const [changeLogDateTo, setChangeLogDateTo] = useState("");

  // Fetch change logs (admin only)
  const { data: changeLogs = [], isLoading: changeLogsLoading } = useQuery<Array<CaseChangeLog & { caseNumber: string }>>({
    queryKey: ["/api/case-change-logs", changeLogCaseNumberFilter, changeLogDateFrom, changeLogDateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (changeLogCaseNumberFilter) params.append("caseNumber", changeLogCaseNumberFilter);
      if (changeLogDateFrom) params.append("dateFrom", changeLogDateFrom);
      if (changeLogDateTo) params.append("dateTo", changeLogDateTo);
      const res = await fetch(`/api/case-change-logs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch change logs");
      return res.json();
    },
    enabled: !!user && activeMenu === "변경 로그 관리",
  });

  // Notice mutations
  const createNoticeMutation = useMutation({
    mutationFn: async (data: { title: string; content: string }) => {
      return await apiRequest("POST", "/api/notices", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notices"] });
      setShowAddNoticeModal(false);
      setNoticeTitle("");
      setNoticeContent("");
      toast({
        description: (
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5" />
            <span>공지사항이 등록되었습니다</span>
          </div>
        ),
        action: (
          <button
            onClick={() => {}}
            style={{
              fontFamily: "Pretendard",
              fontSize: "14px",
              fontWeight: 600,
              color: "#FDFDFD",
              padding: "0 8px",
            }}
          >
            확인하기
          </button>
        ),
        className: "border-none shadow-lg",
        style: {
          background: "#008FED",
          color: "#FDFDFD",
          fontFamily: "Pretendard",
          fontSize: "14px",
          fontWeight: 500,
        } as React.CSSProperties,
      });
    },
    onError: (error: any) => {
      toast({
        title: "등록 실패",
        description: error.message || "공지사항을 등록하는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, data }: { userId: string; data: Partial<Omit<User, 'id' | 'username' | 'password' | 'company' | 'createdAt' | 'status'>> }) => {
      return await apiRequest("PATCH", `/api/users/${userId}`, data);
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      const freshUsers = queryClient.getQueryData<any[]>(["/api/users"]);
      const freshUser = freshUsers?.find((u: any) => u.id === variables.userId);
      setIsEditMode(false);
      setEditedUserData({});
      toast({
        description: (
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5" />
            <span>계정 정보가 수정되었습니다</span>
          </div>
        ),
        className: "border-none shadow-lg",
        style: {
          background: "#008FED",
          color: "#FDFDFD",
          fontFamily: "Pretendard",
          fontSize: "14px",
          fontWeight: 500,
        } as React.CSSProperties,
      });
      if (freshUser) {
        setSelectedUser(freshUser);
      } else if (selectedUser) {
        setSelectedUser(prev => prev ? { ...prev, ...editedUserData } : null);
      }
    },
    onError: (error: any) => {
      toast({
        title: "수정 실패",
        description: error.message || "계정 정보 수정 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // Use VALID_ROLES from schema for role filter options
  const roleFilters = ["전체", ...VALID_ROLES];

  // Apply filtering and search
  const filteredUsers = allUsers.filter((u) => {
    // Role filter
    const matchesRole = roleFilter === "전체" || u.role === roleFilter;

    // Search filter - improved with trim and lowercase
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const normalizedName = u.name.toLowerCase();
    const matchesSearch =
      normalizedQuery === "" || normalizedName.includes(normalizedQuery);

    return matchesRole && matchesSearch;
  });

  const handleSearch = () => {
    setSearchQuery(searchInput);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  if (userLoading || usersLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">로딩 중...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (usersError && allUsers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <div className="text-lg font-medium" style={{ color: "#DC2626" }}>
          사용자 목록을 불러오지 못했습니다
        </div>
        <div className="text-sm" style={{ color: "#6B7280" }}>
          자동으로 다시 시도 중입니다... 잠시만 기다려 주세요.
        </div>
        <button
          className="px-6 py-2 text-white rounded-md hover-elevate active-elevate-2"
          style={{ background: "#008FED" }}
          onClick={() => {
            queryClient.removeQueries({ queryKey: ["/api/users"] });
            queryClient.invalidateQueries({ queryKey: ["/api/user"] });
            window.location.reload();
          }}
          data-testid="button-retry-users"
        >
          페이지 새로고침
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-screen overflow-hidden bg-white">
      <GlobalHeader />
      {/* Main Content */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <div
          className="flex flex-col bg-white"
          style={{
            width: "260px",
            borderRight: "1px solid #E5E7EB",
          }}
        >
          {/* Section Header */}
          {/* Menu Items */}
          <div className="flex flex-col px-3 gap-2">
            {sidebarMenus.map((menu) => (
              <button
                key={menu.name}
                onClick={() => setActiveMenu(menu.name)}
                className="flex items-center px-5 py-3 rounded-lg transition-colors"
                style={{
                  background:
                    activeMenu === menu.name
                      ? "rgba(12, 12, 12, 0.08)"
                      : "transparent",
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: activeMenu === menu.name ? 700 : 500,
                  letterSpacing: "-0.02em",
                  color:
                    activeMenu === menu.name
                      ? "#008FED"
                      : "rgba(12, 12, 12, 0.8)",
                }}
                data-testid={`sidebar-${menu.name}`}
              >
                {menu.name}
              </button>
            ))}
          </div>
        </div>

        {/* Main Section */}
        <div className="flex-1 px-8 py-6 h-full overflow-y-auto">
          {activeMenu === "접근 권한 관리" ? (
            <AccessControlPanel />
          ) : activeMenu === "1:1 문의 관리" ? (
            <>
              {/* Title with notification icon */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <h1
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "26px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "#0C0C0C",
                    }}
                  >
                    1:1 문의 관리
                  </h1>
                  <button
                    onClick={() => toggleFavoriteMutation.mutate("1:1 문의 관리")}
                    className="hover:opacity-70 transition-opacity cursor-pointer"
                    data-testid="button-toggle-inquiry-favorite"
                  >
                    <Star 
                      className="w-5 h-5" 
                      style={{ 
                        color: isInquiryManagementFavorite ? '#FFD700' : 'rgba(12, 12, 12, 0.24)',
                        fill: isInquiryManagementFavorite ? '#FFD700' : 'none',
                      }} 
                    />
                  </button>
                </div>
              </div>

              {/* Inquiry Count and Filter */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 500,
                      letterSpacing: "-0.01em",
                      color: "#686A6E",
                    }}
                  >
                    문의 목록
                  </span>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: "#008FED",
                    }}
                  >
                    {filteredInquiries.length}
                  </span>
                </div>
                <Select value={inquiryStatusFilter} onValueChange={setInquiryStatusFilter}>
                  <SelectTrigger
                    className="w-[120px]"
                    style={{
                      background: "#FDFDFD",
                      border: "2px solid rgba(12, 12, 12, 0.08)",
                      borderRadius: "8px",
                      height: "40px",
                    }}
                    data-testid="select-inquiry-filter"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="전체">전체</SelectItem>
                    <SelectItem value="완료">완료</SelectItem>
                    <SelectItem value="대기">대기</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Inquiry Table */}
              <div
                className="rounded-xl overflow-hidden"
                style={{
                  background: "#FFFFFF",
                  boxShadow: "0px 0px 20px #DBE9F5",
                }}
              >
                <table className="w-full">
                  <thead>
                    <tr
                      style={{
                        background: "#F8F9FA",
                        borderBottom: "2px solid rgba(12, 12, 12, 0.1)",
                      }}
                    >
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        날짜
                      </th>
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        제목
                      </th>
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        내용
                      </th>
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        작성자
                      </th>
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        역할
                      </th>
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        아이디
                      </th>
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        이메일 주소
                      </th>
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        답변여부
                      </th>
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        요청
                      </th>
                      <th
                        className="px-4 py-4 text-center"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                          width: "60px",
                        }}
                      >
                        삭제
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {inquiriesLoading ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center">
                          <div className="text-sm text-gray-500">로딩 중...</div>
                        </td>
                      </tr>
                    ) : filteredInquiries.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center">
                          <div className="text-sm text-gray-500">
                            {inquiryStatusFilter === "전체" ? "등록된 문의가 없습니다" : 
                             inquiryStatusFilter === "완료" ? "답변 완료된 문의가 없습니다" : 
                             "대기 중인 문의가 없습니다"}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredInquiries.map((inquiry) => {
                        const inquiryUser = allUsers.find(u => u.id === inquiry.userId);
                        const date = new Date(inquiry.createdAt).toLocaleDateString('ko-KR', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit'
                        }).replace(/\. /g, '-').replace('.', '');
                        
                        return (
                          <tr
                            key={inquiry.id}
                            onClick={() => setSelectedInquiry(inquiry as any)}
                            className="cursor-pointer hover:bg-gray-50"
                            style={{
                              borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                            }}
                            data-testid={`row-inquiry-${inquiry.id}`}
                          >
                            <td
                              className="px-4 py-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "#0C0C0C",
                              }}
                            >
                              {date}
                            </td>
                            <td
                              className="px-4 py-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 500,
                                color: "#0C0C0C",
                                maxWidth: "300px",
                                wordBreak: "break-all",
                                overflowWrap: "break-word",
                              }}
                            >
                              {inquiry.title}
                            </td>
                            <td
                              className="px-4 py-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "#686A6E",
                                maxWidth: "200px",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {inquiry.content.substring(0, 30)}...
                            </td>
                            <td
                              className="px-4 py-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "#0C0C0C",
                              }}
                            >
                              {inquiryUser?.role || "-"}
                            </td>
                            <td
                              className="px-4 py-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "#686A6E",
                              }}
                            >
                              {inquiryUser?.name || "-"}
                            </td>
                            <td
                              className="px-4 py-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "#0C0C0C",
                              }}
                            >
                              {inquiryUser?.username || "-"}
                            </td>
                            <td
                              className="px-4 py-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "#0C0C0C",
                              }}
                            >
                              {inquiryUser?.email || "-"}
                            </td>
                            <td
                              className="px-4 py-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "#0C0C0C",
                              }}
                            >
                              {inquiry.status}
                            </td>
                            <td className="px-4 py-4">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedInquiry(inquiry as any);
                                }}
                                className="px-4 py-2"
                                style={{
                                  background: "rgba(0, 143, 237, 0.1)",
                                  borderRadius: "6px",
                                  fontFamily: "Pretendard",
                                  fontSize: "13px",
                                  fontWeight: 500,
                                  letterSpacing: "-0.01em",
                                  color: "#008FED",
                                }}
                                data-testid={`button-inquiry-detail-${inquiry.id}`}
                              >
                                자세히보기
                              </button>
                            </td>
                            <td className="px-4 py-4 text-center">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTarget({ type: "inquiry", id: inquiry.id, title: inquiry.title });
                                }}
                                className="p-1.5 hover:bg-red-50 rounded-md transition-colors"
                                data-testid={`button-delete-inquiry-${inquiry.id}`}
                              >
                                <Trash2 size={18} style={{ color: "#9CA3AF" }} />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* 1:1 문의 상세보기 Modal */}
              {selectedInquiry && (() => {
                const inquiryUser = allUsers.find(u => u.id === selectedInquiry.userId);
                const inquiryDate = new Date(selectedInquiry.createdAt).toLocaleDateString('ko-KR', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit'
                }).replace(/\. /g, '-').replace('.', '');
                
                return (
                  <>
                    {/* Modal Overlay */}
                    <div
                      className="fixed inset-0 bg-black bg-opacity-50 z-40"
                      onClick={() => {
                        setSelectedInquiry(null);
                        setReplyTitle("");
                        setReplyContent("");
                      }}
                      data-testid="modal-overlay-inquiry"
                    />
                    {/* Modal Panel */}
                    <div
                      className="fixed right-0 top-0 h-screen w-[600px] bg-white z-50 shadow-2xl overflow-y-auto"
                      style={{
                        animation: "slideInRight 0.3s ease-out",
                      }}
                      data-testid="modal-inquiry-detail"
                    >
                      {/* Header */}
                      <div
                        className="sticky top-0 bg-white z-10 flex items-center justify-between px-8 py-6"
                        style={{
                          borderBottom: "2px solid rgba(12, 12, 12, 0.1)",
                        }}
                      >
                        <h2
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "24px",
                            fontWeight: 600,
                            letterSpacing: "-0.02em",
                            color: "#0C0C0C",
                          }}
                        >
                          1:1 문의 상세보기
                        </h2>
                        <button
                          onClick={() => {
                            setSelectedInquiry(null);
                            setReplyTitle("");
                            setReplyContent("");
                          }}
                          className="text-gray-400 hover:text-gray-600"
                          data-testid="button-close-inquiry-detail"
                        >
                          <X size={24} />
                        </button>
                      </div>

                      {/* Content */}
                      <div className="px-8 py-6">
                        {/* Author Info */}
                        <div
                          className="flex items-center justify-between px-4 py-3 mb-6"
                          style={{
                            background: "rgba(12, 12, 12, 0.04)",
                            borderRadius: "8px",
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "16px",
                                fontWeight: 600,
                                color: "#0C0C0C",
                              }}
                            >
                              {inquiryUser?.name || "-"}
                            </span>
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "#686A6E",
                              }}
                            >
                              · {inquiryUser?.company || "-"}
                          </span>
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 500,
                              color: "#008FED",
                            }}
                          >
                            {inquiryUser?.role || "-"}
                          </span>
                        </div>
                      </div>

                      <div className="mb-4">
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            color: "#686A6E",
                          }}
                        >
                          {inquiryUser?.email || selectedInquiry.userId}
                        </span>
                        <span className="mx-2">·</span>
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            color: "#686A6E",
                          }}
                        >
                          {inquiryUser?.phone || "-"}
                        </span>
                      </div>

                      {/* Date */}
                      <div className="mb-4">
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            color: "#686A6E",
                          }}
                        >
                          {inquiryDate} 작성
                        </span>
                      </div>

                      {/* Title */}
                      <h3
                        className="mb-6"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "20px",
                          fontWeight: 600,
                          letterSpacing: "-0.02em",
                          color: "#0C0C0C",
                          wordBreak: "break-all",
                          overflowWrap: "break-word",
                        }}
                      >
                        {selectedInquiry.title}
                      </h3>

                      {/* Content */}
                      <div
                        className="p-4 mb-6"
                        style={{
                          background: "rgba(12, 12, 12, 0.04)",
                          borderRadius: "8px",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          overflowWrap: "break-word",
                        }}
                      >
                        <p
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            lineHeight: "1.6",
                            color: "#0C0C0C",
                          }}
                        >
                          {selectedInquiry.content}
                        </p>
                      </div>

                      {/* Reply Section */}
                      <div
                        className="border-t-2 pt-6"
                        style={{
                          borderColor: "rgba(12, 12, 12, 0.1)",
                        }}
                      >
                        {selectedInquiry.status === "완료" && selectedInquiry.response ? (
                          <>
                            <h4
                              className="mb-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "18px",
                                fontWeight: 600,
                                color: "#0C0C0C",
                              }}
                            >
                              등록된 답변
                            </h4>
                            
                            {/* 답변일 */}
                            {selectedInquiry.respondedAt && (
                              <div
                                className="mb-4"
                                style={{
                                  fontFamily: "Pretendard",
                                  fontSize: "12px",
                                  fontWeight: 400,
                                  color: "#686A6E",
                                }}
                              >
                                {new Date(selectedInquiry.respondedAt).toLocaleDateString('ko-KR', {
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit'
                                }).replace(/\. /g, '-').replace('.', '')} 답변
                              </div>
                            )}
                            
                            {/* 답변 제목 */}
                            {selectedInquiry.responseTitle && (
                              <h5
                                className="mb-4"
                                style={{
                                  fontFamily: "Pretendard",
                                  fontSize: "16px",
                                  fontWeight: 600,
                                  letterSpacing: "-0.02em",
                                  color: "#0C0C0C",
                                }}
                              >
                                {selectedInquiry.responseTitle}
                              </h5>
                            )}
                            
                            {/* 답변 내용 */}
                            <div
                              className="p-4"
                              style={{
                                background: "rgba(0, 143, 237, 0.04)",
                                borderRadius: "8px",
                                border: "1px solid rgba(0, 143, 237, 0.2)",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-all",
                                overflowWrap: "break-word",
                              }}
                            >
                              <p
                                style={{
                                  fontFamily: "Pretendard",
                                  fontSize: "14px",
                                  fontWeight: 400,
                                  lineHeight: "1.6",
                                  color: "#0C0C0C",
                                }}
                              >
                                {selectedInquiry.response}
                              </p>
                            </div>
                          </>
                        ) : (
                          <>
                            <h4
                              className="mb-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "18px",
                                fontWeight: 600,
                                color: "#0C0C0C",
                              }}
                            >
                              답변하기
                            </h4>

                            {/* Reply Title */}
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
                                답변 제목
                              </label>
                              <input
                                type="text"
                                value={replyTitle}
                                onChange={(e) => setReplyTitle(e.target.value)}
                                placeholder="답변 제목을 입력하세요"
                                className="w-full px-4 py-3 outline-none"
                                style={{
                                  background: "#FDFDFD",
                                  border: "2px solid rgba(12, 12, 12, 0.08)",
                                  borderRadius: "8px",
                                  fontFamily: "Pretendard",
                                  fontSize: "14px",
                                }}
                                data-testid="input-reply-title"
                              />
                            </div>

                            {/* Reply Content */}
                            <div className="mb-2">
                              <label
                                className="block mb-2"
                                style={{
                                  fontFamily: "Pretendard",
                                  fontSize: "14px",
                                  fontWeight: 500,
                                  color: "#686A6E",
                                }}
                              >
                                답변 내용
                              </label>
                              <textarea
                                value={replyContent}
                                onChange={(e) => setReplyContent(e.target.value)}
                                placeholder="문의 내용을 입력하세요"
                                className="w-full px-4 py-3 outline-none resize-none"
                                rows={10}
                                maxLength={800}
                                style={{
                                  background: "#FDFDFD",
                                  border: "2px solid rgba(12, 12, 12, 0.08)",
                                  borderRadius: "8px",
                                  fontFamily: "Pretendard",
                                  fontSize: "14px",
                                }}
                                data-testid="textarea-reply-content"
                              />
                            </div>

                            {/* Character Count */}
                            <div className="flex justify-end mb-6">
                              <span
                                style={{
                                  fontFamily: "Pretendard",
                                  fontSize: "12px",
                                  fontWeight: 400,
                                  color: "#686A6E",
                                }}
                              >
                                {replyContent.length} /800
                              </span>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-3">
                              <button
                                onClick={() => {
                                  setReplyTitle("");
                                  setReplyContent("");
                                }}
                                className="flex-1 py-3"
                                style={{
                                  background: "rgba(12, 12, 12, 0.08)",
                                  borderRadius: "8px",
                                  fontFamily: "Pretendard",
                                  fontSize: "16px",
                                  fontWeight: 600,
                                  color: "#686A6E",
                                }}
                                data-testid="button-reset-reply"
                              >
                                초기화
                              </button>
                              <button
                                onClick={async () => {
                                  if (!replyTitle.trim() || !replyContent.trim()) {
                                    toast({
                                      title: "입력 오류",
                                      description: "답변 제목과 내용을 모두 입력해주세요.",
                                      variant: "destructive",
                                    });
                                    return;
                                  }
                                  
                                  try {
                                    await apiRequest("PATCH", `/api/inquiries/${selectedInquiry.id}`, { 
                                      responseTitle: replyTitle,
                                      response: replyContent 
                                    });
                                    
                                    await queryClient.invalidateQueries({ queryKey: ["/api/inquiries"] });
                                    
                                    toast({
                                      title: "답변 완료",
                                      description: "답변이 등록되었습니다.",
                                    });
                                    
                                    setSelectedInquiry(null);
                                    setReplyTitle("");
                                    setReplyContent("");
                                  } catch (error) {
                                    toast({
                                      title: "답변 실패",
                                      description: "답변 등록에 실패했습니다.",
                                      variant: "destructive",
                                    });
                                  }
                                }}
                                className="flex-1 py-3"
                                style={{
                                  background: "#008FED",
                                  borderRadius: "8px",
                                  fontFamily: "Pretendard",
                                  fontSize: "16px",
                                  fontWeight: 600,
                                  color: "#FDFDFD",
                                }}
                                data-testid="button-submit-reply"
                              >
                                확인
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  </>
                );
            })()}
          </>
          ) : activeMenu === "공지사항 관리" ? (
            <>
              {/* Title with info icon */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <h1
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "26px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "#0C0C0C",
                    }}
                  >
                    공지사항 관리
                  </h1>
                  <button
                    onClick={() => toggleFavoriteMutation.mutate("공지사항 관리")}
                    className="hover:opacity-70 transition-opacity cursor-pointer"
                    data-testid="button-toggle-notice-favorite"
                  >
                    <Star 
                      className="w-5 h-5" 
                      style={{ 
                        color: isNoticeManagementFavorite ? '#FFD700' : 'rgba(12, 12, 12, 0.24)',
                        fill: isNoticeManagementFavorite ? '#FFD700' : 'none',
                      }} 
                    />
                  </button>
                </div>
                <button
                  onClick={() => setShowAddNoticeModal(true)}
                  className="px-6 py-3"
                  style={{
                    background: "#008FED",
                    borderRadius: "8px",
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                    color: "#FDFDFD",
                  }}
                  data-testid="button-add-notice"
                >
                  새 공지 추가
                </button>
              </div>

              {/* Notice Count */}
              <div className="flex items-center gap-2 mb-4">
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                    color: "#686A6E",
                  }}
                >
                  등록된 공지
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    color: "#008FED",
                  }}
                >
                  {notices.length}
                </span>
              </div>

              {/* Notice Table */}
              <div
                className="rounded-xl overflow-hidden"
                style={{
                  background: "#FFFFFF",
                  boxShadow: "0px 0px 20px #DBE9F5",
                }}
              >
                <table className="w-full">
                  <thead>
                    <tr
                      style={{
                        background: "#F8F9FA",
                        borderBottom: "2px solid rgba(12, 12, 12, 0.1)",
                      }}
                    >
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        제목
                      </th>
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        내용
                      </th>
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        게시일
                      </th>
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        수정일
                      </th>
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        작성자
                      </th>
                      <th
                        className="px-4 py-4 text-left"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        조회
                      </th>
                      <th
                        className="px-4 py-4 text-center"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                          width: "60px",
                        }}
                      >
                        삭제
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {noticesLoading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center">
                          <div className="text-sm text-gray-500">로딩 중...</div>
                        </td>
                      </tr>
                    ) : notices.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center">
                          <div className="text-sm text-gray-500">등록된 공지사항이 없습니다</div>
                        </td>
                      </tr>
                    ) : (
                      notices.map((notice, index) => {
                        const author = allUsers.find(u => u.id === notice.authorId);
                        const createdDate = new Date(notice.createdAt).toLocaleDateString('ko-KR', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit'
                        }).replace(/\. /g, '-').replace('.', '');
                        
                        const updatedDate = notice.updatedAt && new Date(notice.createdAt).getTime() !== new Date(notice.updatedAt).getTime()
                          ? new Date(notice.updatedAt).toLocaleDateString('ko-KR', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit'
                            }).replace(/\. /g, '-').replace('.', '')
                          : '-';

                        return (
                          <tr
                            key={notice.id}
                            className="hover:bg-gray-50 cursor-pointer"
                            style={{
                              borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                            }}
                            data-testid={`row-notice-${index}`}
                          >
                            <td
                              className="px-4 py-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 500,
                                color: "#0C0C0C",
                              }}
                            >
                              {notice.title}
                            </td>
                            <td
                              className="px-4 py-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "#686A6E",
                                maxWidth: "200px",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {notice.content.substring(0, 30)}...
                            </td>
                            <td
                              className="px-4 py-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "#0C0C0C",
                              }}
                            >
                              {createdDate}
                            </td>
                            <td
                              className="px-4 py-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "#686A6E",
                              }}
                            >
                              {updatedDate}
                            </td>
                            <td
                              className="px-4 py-4"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "#0C0C0C",
                              }}
                            >
                              {author?.name || "-"}
                            </td>
                            <td className="px-4 py-4">
                              <button
                                className="px-4 py-2"
                                style={{
                                  background: "rgba(0, 143, 237, 0.1)",
                                  borderRadius: "6px",
                                  fontFamily: "Pretendard",
                                  fontSize: "13px",
                                  fontWeight: 500,
                                  letterSpacing: "-0.01em",
                                  color: "#008FED",
                                }}
                                onClick={() => setViewingNotice(notice)}
                                data-testid={`button-notice-view-${index}`}
                              >
                                보기
                              </button>
                            </td>
                            <td className="px-4 py-4 text-center">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTarget({ type: "notice", id: notice.id, title: notice.title });
                                }}
                                className="p-1.5 hover:bg-red-50 rounded-md transition-colors"
                                data-testid={`button-delete-notice-${index}`}
                              >
                                <Trash2 size={18} style={{ color: "#9CA3AF" }} />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : activeMenu === "DB 관리" ? (
            <>
              {/* Title */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <h1
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "26px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "#0C0C0C",
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
                    // Validate title
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
                          
                          // Try xlsx library first
                          const arrayBuffer = await file.arrayBuffer();
                          const data = new Uint8Array(arrayBuffer);
                          const workbook = XLSX.read(data, { type: 'array' });
                          const sheetName = workbook.SheetNames[0];
                          const worksheet = workbook.Sheets[sheetName];
                          
                          // Check if xlsx library successfully parsed the data
                          if (worksheet && Object.keys(worksheet).length > 0) {
                            // Use raw: false to keep formatted values (preserves decimals like 37.5)
                            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: null });
                            if (jsonData.length > 0) {
                              // Find header row: look for row containing both "공종" and "공사명"
                              let headerRowIdx = 0;
                              for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
                                const row = jsonData[i] as any[];
                                if (!row) continue;
                                const rowStr = row.map(c => c?.toString() || '').join('|');
                                // Header row must contain both "공종" and "공사명"
                                if (rowStr.includes('공종') && rowStr.includes('공사명')) {
                                  headerRowIdx = i;
                                  console.log('[Excel] Found header row at index:', i, 'Row:', row);
                                  break;
                                }
                              }
                              
                              headers = (jsonData[headerRowIdx] as any[]).map(h => h?.toString() || '');
                              const maxCols = headers.length;
                              
                              // Process raw rows - normalize to full-width arrays with null for missing cells
                              // Start from row after header row
                              const rawRows: any[][] = [];
                              for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
                                const srcRow = jsonData[i] as any[];
                                const normalizedRow: any[] = [];
                                for (let j = 0; j < maxCols; j++) {
                                  let cellValue = srcRow?.[j];
                                  // Handle newlines in cell values
                                  if (typeof cellValue === 'string' && (cellValue.includes('\n') || cellValue.includes('\r'))) {
                                    cellValue = cellValue.split(/\r?\n|\r/)[0].trim();
                                  }
                                  // Treat empty string as null for merge handling
                                  if (cellValue === '' || cellValue === undefined) {
                                    cellValue = null;
                                  }
                                  normalizedRow.push(cellValue);
                                }
                                rawRows.push(normalizedRow);
                              }
                              
                              // Handle merged cells: fill empty cells with previous row's value
                              // Must process sequentially to correctly reference previous processed rows
                              rows = [];
                              for (let rowIdx = 0; rowIdx < rawRows.length; rowIdx++) {
                                const srcRow = rawRows[rowIdx];
                                const processedRow: any[] = [];
                                
                                for (let colIdx = 0; colIdx < maxCols; colIdx++) {
                                  const cellValue = srcRow[colIdx];
                                  
                                  // If cell is null/empty and there's a previous row, use previous row's value
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
                          
                          // Fallback parser for files with XML namespace prefixes
                          if (headers.length === 0 || rows.length === 0) {
                            console.log('Using fallback xlsx parser...');
                            const parsed = await parseXlsxFallback(file);
                            headers = parsed.headers;
                            rows = parsed.data;
                          }
                          
                          if (headers.length > 0) {
                            setHeaders(headers);
                            setData(rows);
                            
                            // Save to database
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
                            
                            // Clear title input
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
                          // Check for duplicate title error (409)
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
                    background: "#008FED",
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

              {/* Tabs */}
              <div className="flex gap-4 mb-6 border-b-2" style={{ borderColor: "rgba(12, 12, 12, 0.1)" }}>
                <button
                  onClick={() => setDbTab("노무비")}
                  className="pb-3"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 600,
                    color: dbTab === "노무비" ? "#008FED" : "#686A6E",
                    borderBottom: dbTab === "노무비" ? "3px solid #008FED" : "none",
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
                    color: dbTab === "자재비" ? "#008FED" : "#686A6E",
                    borderBottom: dbTab === "자재비" ? "3px solid #008FED" : "none",
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
                    color: dbTab === "일위대가" ? "#008FED" : "#686A6E",
                    borderBottom: dbTab === "일위대가" ? "3px solid #008FED" : "none",
                    marginBottom: dbTab === "일위대가" ? "-2px" : "0",
                  }}
                  data-testid="tab-unit-price"
                >
                  일위대가
                </button>
              </div>

              {/* Version Selector */}
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

              {/* Action Buttons */}
              <div className="flex gap-3 mb-6">
                {dbTab === "일위대가" && (
                  <LaborRateTiersButton />
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

              {/* Table */}
              <div className="overflow-x-auto" style={{ background: "#FFFFFF", borderRadius: "8px", padding: "16px" }}>
                <table className="w-full" style={{ borderCollapse: "collapse", border: "1px solid rgba(12, 12, 12, 0.08)" }}>
                  <thead
                    style={{
                      background: "rgba(248, 248, 248, 1)",
                    }}
                  >
                    <tr>
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
                          <tr>
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
                      
                      // 모든 DB 타입에 대해 병합 정보 계산 (같은 값을 가진 연속된 셀 병합)
                      // 노무비: 공종(0), 공사명(1), 직종명(2), 금액(3) 병합
                      // 자재비: 공종(0), 공사명(1) 병합
                      // 일위대가: 공종(0), 공사명(1) 병합
                      const mergeableCols = dbTab === "노무비" ? [0, 1, 2, 3] : [0, 1];
                      const mergeInfo: { [rowIdx: number]: { [colIdx: number]: { skip: boolean; rowspan: number } } } = {};
                      
                      // 각 병합 가능 컬럼에 대해 rowspan 계산 (같은 값인 경우 병합)
                      // 숫자와 문자열 모두 정규화해서 비교
                      const normalizeValue = (val: any): string => {
                        if (val === null || val === undefined) return '';
                        // 숫자인 경우 정수로 변환 후 문자열로
                        if (typeof val === 'number') return Math.round(val).toString();
                        // 문자열에서 콤마, 공백 제거하고 비교
                        return val.toString().replace(/,/g, '').trim();
                      };
                      
                      mergeableCols.forEach(colIdx => {
                        let currentValue: string = '';
                        let startRowIdx = 0;
                        
                        currentData.forEach((row: any[], rowIdx: number) => {
                          const cellValue = Array.isArray(row) ? row[colIdx] : null;
                          const normalizedValue = normalizeValue(cellValue);
                          
                          if (!mergeInfo[rowIdx]) mergeInfo[rowIdx] = {};
                          
                          // 첫 행이거나 값이 이전 행과 다른 경우 새 그룹 시작
                          if (rowIdx === 0 || normalizedValue !== currentValue) {
                            // 이전 그룹 마무리
                            if (rowIdx > 0 && mergeInfo[startRowIdx]?.[colIdx]) {
                              mergeInfo[startRowIdx][colIdx].rowspan = rowIdx - startRowIdx;
                            }
                            // 새 그룹 시작
                            currentValue = normalizedValue;
                            startRowIdx = rowIdx;
                            mergeInfo[rowIdx][colIdx] = { skip: false, rowspan: 1 };
                          } else {
                            // 같은 값: 위 그룹에 병합됨
                            mergeInfo[rowIdx][colIdx] = { skip: true, rowspan: 0 };
                          }
                        });
                        
                        // 마지막 그룹 rowspan 설정
                        if (currentData.length > 0 && mergeInfo[startRowIdx]?.[colIdx]) {
                          mergeInfo[startRowIdx][colIdx].rowspan = currentData.length - startRowIdx;
                        }
                      });
                      
                      // Find 기준작업량(D), 노임단가(E), 일위대가 column indices for 일위대가 tab
                      const currentHeaders = dbTab === "노무비" ? laborExcelHeaders : dbTab === "자재비" ? materialExcelHeaders : unitPriceExcelHeaders;
                      const dValueColIndex = dbTab === "일위대가" ? currentHeaders.findIndex(h => 
                        h.includes("기준작업량") || h.includes("기준 작업량") || h === "D" || h.includes("D값") || h.includes("D 값")
                      ) : -1;
                      // 노임단가(인당) 컬럼 인덱스
                      const laborRateColIndex = dbTab === "일위대가" ? currentHeaders.findIndex(h => 
                        h.includes("노임단가") || h.includes("단가_인") || h.includes("단가(인당)")
                      ) : -1;
                      // 일위대가 컬럼 인덱스 (노임단가/기준작업량)
                      const unitPriceColIndex = dbTab === "일위대가" ? currentHeaders.findIndex(h => 
                        h.includes("일위대가") && (h.includes("노임단가") || h.includes("기준작업량"))
                      ) : -1;
                      
                      return currentData.map((row: any, rowIdx: number) => {
                        // Forward-fill for 일위대가 rows
                        let category = '';
                        let workName = '';
                        let laborItem = '';
                        
                        if (dbTab === "일위대가" && Array.isArray(row)) {
                          // Forward-fill 로직
                          category = String(row[0] || '').trim();
                          workName = String(row[1] || '').trim();
                          laborItem = String(row[2] || '').trim();
                          
                          // If empty, try to get from previous rows
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
                          <tr key={rowIdx}>
                            {Array.isArray(row) && row.map((cell: any, cellIdx: number) => {
                              // 병합 가능 컬럼: skip이면 렌더링 안함
                              const cellMerge = mergeInfo[rowIdx]?.[cellIdx];
                              if (cellMerge?.skip) {
                                return null;
                              }
                              
                              // 숫자인 경우 소수점 한자리까지 표시 (두자리 이상은 반올림)
                              let displayValue = cell;
                              if (typeof cell === 'number') {
                                displayValue = Number(cell.toFixed(1));
                              }
                              
                              const rowspan = cellMerge?.rowspan || 1;
                              
                              // 일위대가 탭에서 기준작업량(D) 컬럼인 경우 편집 가능하게 렌더링
                              const isEditableDColumn = dbTab === "일위대가" && cellIdx === dValueColIndex && dValueColIndex !== -1;
                              const isAdmin = user?.role === "관리자";
                              // 소수점 한자리로 반올림해서 표시
                              const originalDValue = typeof cell === 'number' ? Number(cell.toFixed(1)) : cell;
                              const overriddenDValue = overridesMap.get(overrideKey);
                              const hasOverride = overriddenDValue !== undefined;
                              const currentEditValue = editedDValues[overrideKey];
                              
                              // 일위대가 컬럼인 경우 노임단가/기준작업량으로 동적 계산
                              const isUnitPriceColumn = dbTab === "일위대가" && cellIdx === unitPriceColIndex && unitPriceColIndex !== -1;
                              if (isUnitPriceColumn && laborRateColIndex !== -1 && dValueColIndex !== -1 && Array.isArray(row)) {
                                // 노임단가(E) 가져오기
                                const laborRate = typeof row[laborRateColIndex] === 'number' ? row[laborRateColIndex] : parseFloat(String(row[laborRateColIndex]).replace(/,/g, '')) || 0;
                                // 기준작업량(D) 가져오기 - override 있으면 override 값 사용
                                const originalD = typeof row[dValueColIndex] === 'number' ? row[dValueColIndex] : parseFloat(String(row[dValueColIndex]).replace(/,/g, '')) || 0;
                                const effectiveD = hasOverride ? Number(overriddenDValue) : originalD;
                                // 일위대가 계산: 노임단가 / 기준작업량
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
                                      color: hasOverride ? "#008FED" : "#0C0C0C",
                                      whiteSpace: "nowrap",
                                      verticalAlign: rowspan > 1 ? "middle" : undefined,
                                      borderRight: "1px solid rgba(12, 12, 12, 0.08)",
                                      borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                                      background: hasOverride ? "rgba(0, 143, 237, 0.05)" : (rowspan > 1 ? "rgba(248, 248, 248, 0.5)" : undefined),
                                    }}
                                  >
                                    {calculatedUnitPrice.toLocaleString()}
                                  </td>
                                );
                              }
                              
                              if (isEditableDColumn && isAdmin && laborItem) {
                                // 소수점 한자리로 표시
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
                                      background: hasOverride ? "rgba(0, 143, 237, 0.1)" : "rgba(255, 255, 255, 1)",
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
                                          // 소수점 한자리로 반올림해서 저장
                                          const newValue = Math.round(rawValue * 10) / 10;
                                          if (!isNaN(newValue) && newValue > 0) {
                                            saveDValueMutation.mutate({
                                              category,
                                              workName,
                                              laborItem,
                                              standardWorkQuantity: newValue
                                            });
                                          }
                                          // Clear edited state after save
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
                                          background: hasOverride ? "rgba(0, 143, 237, 0.05)" : "#FFFFFF",
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
                                            background: "#008FED",
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
          ) : activeMenu === "기준정보 관리" ? (
            <>
              {/* Title */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <h1
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "26px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "#0C0C0C",
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

              {/* Main Content */}
              <div className="flex gap-6">
                {/* Left Sidebar - Category List */}
                <div
                  className="w-80 rounded-xl p-6"
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

                  {/* 검색 영역 */}
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
                          background: "#008FED",
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
                            background: selectedCategory === category ? "rgba(0, 143, 237, 0.05)" : "transparent",
                            fontFamily: "Pretendard",
                            fontSize: "15px",
                            fontWeight: selectedCategory === category ? 600 : 400,
                            color: selectedCategory === category ? "#008FED" : "#0C0C0C",
                            border: selectedCategory === category ? "1px solid rgba(0, 143, 237, 0.2)" : "1px solid transparent",
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
                                background: "rgba(0, 143, 237, 0.1)",
                                fontSize: "11px",
                                fontWeight: 500,
                                color: "#008FED",
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

                {/* Right Content - Selected Category Management */}
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

                  {/* Selected Category Info */}
                  <div className="flex items-center gap-3 mb-6">
                    <span style={{ color: "#008FED", fontSize: "16px" }}>●</span>
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
                        background: "rgba(0, 143, 237, 0.1)",
                        fontSize: "12px",
                        fontWeight: 500,
                        color: "#008FED",
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

                  {/* Action Buttons */}
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
                        background: "#008FED",
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

                  {/* Items Table */}
                  <div>
                    <table className="w-full">
                      <thead
                        style={{
                          background: "rgba(248, 248, 248, 1)",
                        }}
                      >
                        <tr>
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
                              <tr>
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
                              <tr
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
          ) : activeMenu === "사용자 계정 관리" ? (
            <>
              {/* Title */}
              <div className="flex items-center mb-6">
                <h1
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "26px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "#0C0C0C",
                  }}
                >
                  사용자 계정 관리
                </h1>
              </div>

          {/* Search & Role Filter */}
          <div
            className="mb-6 rounded-xl px-6 py-5"
            style={{
              background: "#FFFFFF",
              border: "1px solid rgba(12, 12, 12, 0.08)",
            }}
          >
            <div className="flex items-end gap-8 flex-wrap">
              {/* Role Filter */}
              <div>
                <label
                  className="mb-2 block"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "13px",
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                    color: "#686A6E",
                  }}
                >
                  역할
                </label>
                <div className="flex items-center gap-2">
                  {roleFilters.map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setRoleFilter(filter)}
                      className="px-4 py-2 rounded-md"
                      style={{
                        background:
                          roleFilter === filter
                            ? "rgba(0, 143, 237, 0.1)"
                            : "transparent",
                        border:
                          roleFilter === filter
                            ? "2px solid rgba(255, 255, 255, 0.04)"
                            : "1px solid rgba(12, 12, 12, 0.2)",
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: roleFilter === filter ? 600 : 400,
                        letterSpacing: "-0.02em",
                        color:
                          roleFilter === filter
                            ? "#008FED"
                            : "rgba(12, 12, 12, 0.9)",
                      }}
                      data-testid={`filter-${filter}`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search Input */}
              <div className="flex-1 min-w-[280px]">
                <label
                  className="mb-2 block"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "13px",
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                    color: "#686A6E",
                  }}
                >
                  검색
                </label>
                <div className="flex items-center gap-0">
                  <div
                    className="flex items-center flex-1 px-4 gap-2"
                    style={{
                      height: "42px",
                      background: "#FDFDFD",
                      border: "1px solid rgba(12, 12, 12, 0.1)",
                      borderRight: "none",
                      borderRadius: "6px 0 0 6px",
                    }}
                  >
                    <Search className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    <input
                      type="text"
                      placeholder="성함을 입력해주세요."
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      className="flex-1 outline-none bg-transparent"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.9)",
                      }}
                      data-testid="input-search"
                    />
                  </div>
                  <button
                    onClick={handleSearch}
                    style={{
                      height: "42px",
                      padding: "0 20px",
                      background: "#008FED",
                      border: "none",
                      borderRadius: "0 6px 6px 0",
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "#FFFFFF",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                    data-testid="button-search"
                  >
                    검색
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* User List Section */}
          <div>
            {/* Header with Count */}
            <div className="flex items-center justify-between px-5 py-6">
              <div className="flex items-center gap-4">
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "20px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "#0C0C0C",
                  }}
                >
                  계정
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "20px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "#008FED",
                  }}
                  data-testid="text-user-count"
                >
                  {filteredUsers.length}
                </span>
              </div>
              <button
                className="flex items-center justify-center px-6 hover-elevate active-elevate-2"
                style={{
                  height: "48px",
                  background: "#008FED",
                  borderRadius: "6px",
                }}
                onClick={() => setShowCreateAccountModal(true)}
                data-testid="button-create-account"
              >
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "#FDFDFD",
                  }}
                >
                  계정 생성
                </span>
              </button>
            </div>

            {/* User Table */}
            <div className="flex flex-col gap-4">
              {/* Table Header */}
              <div
                className="flex items-center px-3 rounded-lg"
                style={{
                  height: "54px",
                  background: "rgba(12, 12, 12, 0.04)",
                }}
              >
                <div className="px-2" style={{ width: "90px" }}>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "15px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.6)",
                    }}
                  >
                    역할
                  </span>
                </div>
                <div className="px-2" style={{ width: "155px" }}>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "15px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.6)",
                    }}
                  >
                    회사명
                  </span>
                </div>
                <div className="px-2" style={{ width: "80px" }}>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "15px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.6)",
                    }}
                  >
                    성함
                  </span>
                </div>
                <div className="px-2" style={{ width: "100px" }}>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "15px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.6)",
                    }}
                  >
                    소속부서
                  </span>
                </div>
                <div className="px-2" style={{ width: "70px" }}>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "15px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.6)",
                    }}
                  >
                    직급
                  </span>
                </div>
                <div className="px-2" style={{ width: "220px" }}>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "15px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.6)",
                    }}
                  >
                    이메일 주소
                  </span>
                </div>
                <div className="px-2" style={{ width: "230px" }}>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "15px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.6)",
                    }}
                  >
                    ID
                  </span>
                </div>
                <div className="px-2" style={{ width: "163px" }}>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "15px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.6)",
                    }}
                  >
                    연락처
                  </span>
                </div>
                <div className="px-2" style={{ width: "163px" }}>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "15px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.6)",
                    }}
                  >
                    사무실 전화
                  </span>
                </div>
                <div className="px-2" style={{ width: "120px" }}>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "15px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.6)",
                    }}
                  >
                    계정 생성일
                  </span>
                </div>
                <div className="px-2" style={{ width: "120px" }}>
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "15px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.6)",
                    }}
                  >
                    요청
                  </span>
                </div>
                {user?.isSuperAdmin && (
                  <div className="px-2 flex-1">
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "15px",
                        fontWeight: 600,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.6)",
                      }}
                    >
                      관리자 위임
                    </span>
                  </div>
                )}
              </div>

              {/* Table Rows */}
              {filteredUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center px-3 hover:bg-black/5 transition-colors"
                  style={{
                    height: "44px",
                  }}
                  data-testid={`user-row-${user.id}`}
                >
                  <div
                    className="px-2 cursor-pointer"
                    style={{ width: "90px" }}
                    onClick={() => setSelectedUser(user)}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {user.role}
                    </span>
                  </div>
                  <div
                    className="px-2 cursor-pointer"
                    style={{ width: "155px" }}
                    onClick={() => setSelectedUser(user)}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {user.company}
                    </span>
                  </div>
                  <div
                    className="px-2 cursor-pointer"
                    style={{ width: "80px" }}
                    onClick={() => setSelectedUser(user)}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {user.name}
                    </span>
                  </div>
                  <div
                    className="px-2 cursor-pointer"
                    style={{ width: "100px" }}
                    onClick={() => setSelectedUser(user)}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {user.department}
                    </span>
                  </div>
                  <div
                    className="px-2 cursor-pointer"
                    style={{ width: "70px" }}
                    onClick={() => setSelectedUser(user)}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {user.position}
                    </span>
                  </div>
                  <div
                    className="px-2 cursor-pointer"
                    style={{ width: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    onClick={() => setSelectedUser(user)}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {user.email}
                    </span>
                  </div>
                  <div
                    className="px-2 cursor-pointer"
                    style={{ width: "230px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    onClick={() => setSelectedUser(user)}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {user.username}
                    </span>
                  </div>
                  <div
                    className="px-2 cursor-pointer"
                    style={{ width: "163px" }}
                    onClick={() => setSelectedUser(user)}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {user.phone}
                    </span>
                  </div>
                  <div
                    className="px-2 cursor-pointer"
                    style={{ width: "163px" }}
                    onClick={() => setSelectedUser(user)}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {user.office}
                    </span>
                  </div>
                  <div
                    className="px-2 cursor-pointer"
                    style={{ width: "120px" }}
                    onClick={() => setSelectedUser(user)}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.8)",
                      }}
                    >
                      {user.createdAt}
                    </span>
                  </div>
                  <div className="px-2" style={{ width: "120px" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedUser(user);
                      }}
                      className="flex items-center justify-center"
                      style={{
                        width: "92px",
                        height: "28px",
                        background: "#FFFFFF",
                        border: "1px solid rgba(12, 12, 12, 0.2)",
                        borderRadius: "6px",
                      }}
                      data-testid={`button-view-detail-${user.id}`}
                    >
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 500,
                          letterSpacing: "-0.01em",
                          color: "rgba(12, 12, 12, 0.8)",
                        }}
                      >
                        자세히 보기
                      </span>
                    </button>
                  </div>
                  {loggedInUser?.isSuperAdmin && (
                    <div className="px-2 flex-1">
                      {user.role === "관리자" && user.id !== loggedInUser?.id && !user.isSuperAdmin && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDelegateTargetUser(user);
                            setShowDelegateConfirmModal(true);
                          }}
                          className="flex items-center justify-center"
                          style={{
                            width: "92px",
                            height: "28px",
                            background: "#E3F2FD",
                            border: "1px solid #008FED",
                            borderRadius: "6px",
                          }}
                          data-testid={`button-delegate-super-admin-${user.id}`}
                        >
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "13px",
                              fontWeight: 600,
                              letterSpacing: "-0.01em",
                              color: "#008FED",
                            }}
                          >
                            위임
                          </span>
                        </button>
                      )}
                      {user.role === "관리자" && user.id === loggedInUser?.id && user.isSuperAdmin && (
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "13px",
                            fontWeight: 500,
                            color: "#008FED",
                          }}
                        >
                          최고관리자
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          </>
          ) : activeMenu === "변경 로그 관리" ? (
            <>
              {/* Title */}
              <div className="flex items-center justify-between mb-6">
                <h1
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "26px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "#0C0C0C",
                  }}
                >
                  변경 로그 관리
                </h1>
              </div>

              {/* Filters */}
              <div
                className="rounded-xl p-6 mb-6"
                style={{
                  background: "#FFFFFF",
                  boxShadow: "0px 0px 20px #DBE9F5",
                }}
              >
                <div className="flex gap-4 items-end">
                  <div className="flex-1">
                    <label
                      className="block mb-2"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        color: "#686A6E",
                      }}
                    >
                      사고 번호 검색
                    </label>
                    <input
                      type="text"
                      value={changeLogCaseNumberFilter}
                      onChange={(e) => setChangeLogCaseNumberFilter(e.target.value)}
                      placeholder="사고번호를 입력해주세요"
                      className="w-full px-3 py-2 outline-none"
                      style={{
                        background: "#FFFFFF",
                        border: "1px solid rgba(12, 12, 12, 0.08)",
                        borderRadius: "6px",
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                      }}
                      data-testid="input-changelog-case-number"
                    />
                  </div>
                  <div>
                    <label
                      className="block mb-2"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        color: "#686A6E",
                      }}
                    >
                      시작일
                    </label>
                    <input
                      type="date"
                      value={changeLogDateFrom}
                      onChange={(e) => setChangeLogDateFrom(e.target.value)}
                      className="px-3 py-2 outline-none"
                      style={{
                        background: "#FFFFFF",
                        border: "1px solid rgba(12, 12, 12, 0.08)",
                        borderRadius: "6px",
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                      }}
                      data-testid="input-changelog-date-from"
                    />
                  </div>
                  <div>
                    <label
                      className="block mb-2"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        color: "#686A6E",
                      }}
                    >
                      종료일
                    </label>
                    <input
                      type="date"
                      value={changeLogDateTo}
                      onChange={(e) => setChangeLogDateTo(e.target.value)}
                      className="px-3 py-2 outline-none"
                      style={{
                        background: "#FFFFFF",
                        border: "1px solid rgba(12, 12, 12, 0.08)",
                        borderRadius: "6px",
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                      }}
                      data-testid="input-changelog-date-to"
                    />
                  </div>
                  <button
                    onClick={() => {
                      setChangeLogCaseNumberFilter("");
                      setChangeLogDateFrom("");
                      setChangeLogDateTo("");
                    }}
                    className="px-4 py-2"
                    style={{
                      background: "rgba(12, 12, 12, 0.08)",
                      borderRadius: "6px",
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "rgba(12, 12, 12, 0.8)",
                    }}
                    data-testid="button-changelog-reset"
                  >
                    초기화
                  </button>
                </div>
              </div>

              {/* Change Logs Table */}
              <div
                className="rounded-xl overflow-hidden"
                style={{
                  background: "#FFFFFF",
                  boxShadow: "0px 0px 20px #DBE9F5",
                }}
              >
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ background: "rgba(12, 12, 12, 0.04)" }}>
                        <th
                          className="px-4 py-3 text-left"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 600,
                            color: "#0C0C0C",
                          }}
                        >
                          사고번호
                        </th>
                        <th
                          className="px-4 py-3 text-left"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 600,
                            color: "#0C0C0C",
                          }}
                        >
                          변경자
                        </th>
                        <th
                          className="px-4 py-3 text-left"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 600,
                            color: "#0C0C0C",
                          }}
                        >
                          변경일시
                        </th>
                        <th
                          className="px-4 py-3 text-left"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 600,
                            color: "#0C0C0C",
                          }}
                        >
                          변경 항목
                        </th>
                        <th
                          className="px-4 py-3 text-left"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 600,
                            color: "#0C0C0C",
                          }}
                        >
                          변경 내용
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {changeLogsLoading ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-8 text-center"
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 400,
                              color: "#686A6E",
                            }}
                          >
                            로딩 중...
                          </td>
                        </tr>
                      ) : changeLogs.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-8 text-center"
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 400,
                              color: "#686A6E",
                            }}
                          >
                            변경 로그가 없습니다.
                          </td>
                        </tr>
                      ) : (
                        changeLogs.map((log) => (
                          <tr
                            key={log.id}
                            className="border-b hover:bg-gray-50 transition-colors"
                            style={{ borderColor: "rgba(12, 12, 12, 0.08)" }}
                            data-testid={`row-changelog-${log.id}`}
                          >
                            <td
                              className="px-4 py-3"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 500,
                                color: "#008FED",
                              }}
                            >
                              {log.caseNumber || "-"}
                            </td>
                            <td
                              className="px-4 py-3"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "rgba(12, 12, 12, 0.8)",
                              }}
                            >
                              {log.changedByName || "-"}
                            </td>
                            <td
                              className="px-4 py-3"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "rgba(12, 12, 12, 0.8)",
                              }}
                            >
                              {log.changedAt
                                ? new Date(log.changedAt).toLocaleString("ko-KR", {
                                    year: "numeric",
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : "-"}
                            </td>
                            <td
                              className="px-4 py-3"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "rgba(12, 12, 12, 0.8)",
                              }}
                            >
                              {log.changes && log.changes.length > 0
                                ? log.changes.map((c) => c.fieldLabel).join(", ")
                                : "-"}
                            </td>
                            <td
                              className="px-4 py-3"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "13px",
                                fontWeight: 400,
                                color: "rgba(12, 12, 12, 0.7)",
                              }}
                            >
                              {log.changes && log.changes.length > 0 ? (
                                <div className="space-y-1">
                                  {log.changes.map((change, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                      <span className="font-medium">{change.fieldLabel}:</span>
                                      <span className="text-red-500 line-through">
                                        {change.before || "(없음)"}
                                      </span>
                                      <span>→</span>
                                      <span className="text-green-600">
                                        {change.after || "(없음)"}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                "-"
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {/* Super Admin Delegate Confirm Modal */}
      {showDelegateConfirmModal && delegateTargetUser && (
        <>
          <div
            className="fixed inset-0 z-[60]"
            style={{ background: "rgba(0, 0, 0, 0.5)" }}
            onClick={() => {
              setShowDelegateConfirmModal(false);
              setDelegateTargetUser(null);
            }}
          />
          <div
            className="fixed z-[61] rounded-xl"
            style={{
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "440px",
              background: "#FFFFFF",
              boxShadow: "0px 8px 40px rgba(0, 0, 0, 0.15)",
              padding: "32px",
            }}
          >
            <div className="flex flex-col items-center gap-5">
              <div
                className="flex items-center justify-center"
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  background: "rgba(0, 143, 237, 0.1)",
                }}
              >
                <Shield style={{ width: "28px", height: "28px", color: "#008FED" }} />
              </div>
              <div className="flex flex-col items-center gap-2">
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "20px",
                    fontWeight: 700,
                    color: "#0C0C0C",
                  }}
                >
                  최고관리자 위임
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "15px",
                    fontWeight: 400,
                    color: "rgba(12, 12, 12, 0.6)",
                    textAlign: "center",
                    lineHeight: "1.6",
                  }}
                >
                  <strong style={{ color: "#008FED" }}>{delegateTargetUser.name || delegateTargetUser.username}</strong>님에게
                  최고관리자 권한을 위임하시겠습니까?
                  <br />
                  위임 후 본인은 일반관리자로 변경됩니다.
                </span>
              </div>
              <div className="flex items-center gap-3 w-full mt-2">
                <button
                  className="flex-1 flex items-center justify-center hover-elevate active-elevate-2"
                  style={{
                    height: "44px",
                    background: "#F5F5F5",
                    borderRadius: "8px",
                    fontFamily: "Pretendard",
                    fontSize: "15px",
                    fontWeight: 600,
                    color: "rgba(12, 12, 12, 0.7)",
                  }}
                  onClick={() => {
                    setShowDelegateConfirmModal(false);
                    setDelegateTargetUser(null);
                  }}
                  disabled={isDelegating}
                  data-testid="button-delegate-cancel"
                >
                  취소
                </button>
                <button
                  className="flex-1 flex items-center justify-center hover-elevate active-elevate-2"
                  style={{
                    height: "44px",
                    background: "#008FED",
                    borderRadius: "8px",
                    fontFamily: "Pretendard",
                    fontSize: "15px",
                    fontWeight: 600,
                    color: "#FFFFFF",
                    opacity: isDelegating ? 0.6 : 1,
                  }}
                  onClick={async () => {
                    setIsDelegating(true);
                    try {
                      await apiRequest("POST", "/api/delegate-super-admin", { targetUserId: delegateTargetUser.id });
                      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
                      toast({ title: `${delegateTargetUser.name || delegateTargetUser.username}님에게 최고관리자 권한이 위임되었습니다` });
                      setShowDelegateConfirmModal(false);
                      setDelegateTargetUser(null);
                    } catch (err) {
                      toast({ title: "위임 중 오류가 발생했습니다", variant: "destructive" });
                    } finally {
                      setIsDelegating(false);
                    }
                  }}
                  disabled={isDelegating}
                  data-testid="button-delegate-confirm"
                >
                  {isDelegating ? "처리 중..." : "위임하기"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {activeMenu === "사용자 계정 관리" && (
        <>
      {/* Account Detail Modal */}
      {selectedUser && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-40"
            style={{
              background: "rgba(0, 0, 0, 0.7)",
              opacity: 0.4,
            }}
            onClick={() => {
              setSelectedUser(null);
              setIsEditMode(false);
              setEditedUserData({});
              setSelectedAttachmentIndices(new Set());
            }}
            data-testid="modal-overlay"
          />

          {/* Modal Panel */}
          <div
            className="fixed right-0 top-0 z-50 bg-white flex flex-col"
            style={{
              width: "609px",
              height: "100vh",
            }}
            data-testid="modal-account-detail"
          >
            {/* Header */}
            <div
              className="flex items-center justify-center relative"
              style={{
                height: "128px",
                padding: "24px 20px",
              }}
            >
              <h2
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "22px",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                }}
              >
                {isEditMode ? "계정 정보 수정" : "계정 상세보기"}
              </h2>
              <div className="absolute right-5 flex items-center gap-3">
                {!isEditMode && (
                  <button
                    onClick={() => {
                      setIsEditMode(true);
                      setEditedUserData({
                        name: selectedUser.name,
                        role: selectedUser.role as "심사사" | "조사사" | "보험사" | "협력사" | "관리자",
                        isSuperAdmin: selectedUser.isSuperAdmin || false,
                        department: selectedUser.department,
                        position: selectedUser.position,
                        email: selectedUser.email,
                        phone: selectedUser.phone,
                        office: selectedUser.office,
                        address: selectedUser.address,
                        businessRegistrationNumber: selectedUser.businessRegistrationNumber,
                        representativeName: selectedUser.representativeName,
                        bankName: selectedUser.bankName,
                        accountNumber: selectedUser.accountNumber,
                        accountHolder: selectedUser.accountHolder,
                        serviceRegions: selectedUser.serviceRegions,
                      });
                    }}
                    className="px-4 py-2 rounded-lg"
                    style={{
                      background: "#008FED",
                      color: "#FDFDFD",
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 600,
                    }}
                    data-testid="button-edit-account"
                  >
                    수정
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelectedUser(null);
                    setIsEditMode(false);
                    setEditedUserData({});
                    setSelectedAttachmentIndices(new Set());
                  }}
                  style={{
                    width: "24px",
                    height: "24px",
                  }}
                  data-testid="button-close-modal"
                >
                  <X className="w-6 h-6" color="#1C1B1F" />
                </button>
              </div>
            </div>

            {/* Profile Card */}
            <div
              className="mx-5 flex flex-col gap-2.5 p-4"
              style={{
                background: "rgba(12, 12, 12, 0.04)",
                backdropFilter: "blur(7px)",
                borderRadius: "12px",
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "18px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.9)",
                  }}
                >
                  {selectedUser.name}
                </span>
                <div
                  className="w-1 h-1 rounded-full"
                  style={{ background: "rgba(0, 143, 237, 0.9)" }}
                />
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "18px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.9)",
                  }}
                >
                  {selectedUser.company}
                </span>
                <div
                  className="flex items-center justify-center px-2.5 py-1 rounded-full"
                  style={{
                    background: "rgba(12, 12, 12, 0.1)",
                    backdropFilter: "blur(7px)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 400,
                      letterSpacing: "-0.01em",
                      color: "rgba(12, 12, 12, 0.7)",
                    }}
                  >
                    {selectedUser.role}
                  </span>
                  {selectedUser.accountType && (
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "12px",
                        fontWeight: 500,
                        padding: "2px 8px",
                        borderRadius: "4px",
                        background: selectedUser.accountType === "회사" ? "rgba(0, 143, 237, 0.1)" : "rgba(12, 12, 12, 0.06)",
                        color: selectedUser.accountType === "회사" ? "#008FED" : "rgba(12, 12, 12, 0.6)",
                      }}
                      data-testid="badge-account-type"
                    >
                      {selectedUser.accountType}
                    </span>
                  )}
                  {selectedUser.role === "관리자" && selectedUser.isSuperAdmin && (
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "12px",
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: "4px",
                        background: "rgba(239, 68, 68, 0.1)",
                        color: "#EF4444",
                      }}
                      data-testid="badge-super-admin"
                    >
                      최고관리자
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-6">
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 400,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.7)",
                  }}
                >
                  {selectedUser.username}
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 400,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.7)",
                  }}
                >
                  {selectedUser.phone}
                </span>
              </div>
            </div>

            {/* Content Sections - Scrollable */}
            <div className="flex flex-col px-5 mt-8 flex-1 overflow-y-auto">
              {/* Basic Info Section */}
              <div
                className="flex flex-col pb-7"
                style={{ borderBottom: "1px solid rgba(12, 12, 12, 0.1)" }}
              >
                <div className="px-4 py-2.5">
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "15px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.9)",
                    }}
                  >
                    {selectedUser.role === "보험사"
                      ? "기본 정보"
                      : "사용자 정보"}
                  </span>
                </div>
                <div className="flex flex-col gap-4">
                  {/* Row 1 */}
                  <div className="flex gap-5">
                    <div className="flex-1 flex flex-col gap-2">
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "rgba(12, 12, 12, 0.5)",
                        }}
                      >
                        성함
                      </span>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={editedUserData.name || ""}
                          onChange={(e) => setEditedUserData({ ...editedUserData, name: e.target.value })}
                          className="px-3 py-2 rounded-lg border"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            color: "rgba(12, 12, 12, 0.9)",
                            borderColor: "rgba(12, 12, 12, 0.1)",
                          }}
                          data-testid="input-edit-name"
                        />
                      ) : (
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {selectedUser.name}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 flex flex-col gap-2">
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "rgba(12, 12, 12, 0.5)",
                        }}
                      >
                        ID
                      </span>
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 400,
                          letterSpacing: "-0.02em",
                          color: isEditMode ? "rgba(12, 12, 12, 0.4)" : "rgba(12, 12, 12, 0.9)",
                        }}
                      >
                        {selectedUser.username}
                      </span>
                    </div>
                  </div>
                  {/* Row 2 */}
                  <div className="flex gap-5">
                    <div className="flex-1 flex flex-col gap-2">
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "rgba(12, 12, 12, 0.5)",
                        }}
                      >
                        연락처
                      </span>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={editedUserData.phone || ""}
                          onChange={(e) => setEditedUserData({ ...editedUserData, phone: e.target.value })}
                          className="px-3 py-2 rounded-lg border"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            color: "rgba(12, 12, 12, 0.9)",
                            borderColor: "rgba(12, 12, 12, 0.1)",
                          }}
                          data-testid="input-edit-phone"
                        />
                      ) : (
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {selectedUser.phone}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 flex flex-col gap-2">
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "rgba(12, 12, 12, 0.5)",
                        }}
                      >
                        이메일 주소
                      </span>
                      {isEditMode ? (
                        <input
                          type="email"
                          value={editedUserData.email || ""}
                          onChange={(e) => setEditedUserData({ ...editedUserData, email: e.target.value })}
                          className="px-3 py-2 rounded-lg border"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            color: "rgba(12, 12, 12, 0.9)",
                            borderColor: "rgba(12, 12, 12, 0.1)",
                          }}
                          data-testid="input-edit-email"
                        />
                      ) : (
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {selectedUser.email}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Row 3 */}
                  <div className="flex gap-5">
                    <div className="flex-1 flex flex-col gap-2">
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "rgba(12, 12, 12, 0.5)",
                        }}
                      >
                        계정 생성일
                      </span>
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 400,
                          letterSpacing: "-0.02em",
                          color: isEditMode ? "rgba(12, 12, 12, 0.4)" : "rgba(12, 12, 12, 0.9)",
                        }}
                      >
                        {selectedUser.createdAt}
                      </span>
                    </div>
                    <div className="flex-1 flex flex-col gap-2">
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "rgba(12, 12, 12, 0.5)",
                        }}
                      >
                        역할
                      </span>
                      {isEditMode ? (
                        <Select
                          value={editedUserData.role || selectedUser.role}
                          onValueChange={(value) => setEditedUserData({ ...editedUserData, role: value as "심사사" | "조사사" | "보험사" | "협력사" | "관리자", isSuperAdmin: value === "관리자" ? editedUserData.isSuperAdmin : false })}
                        >
                          <SelectTrigger className="w-full" data-testid="select-edit-role">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {VALID_ROLES.map((role) => (
                              <SelectItem key={role} value={role}>{role}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {selectedUser.role}
                        </span>
                      )}
                    </div>
                    {selectedUser.role === "관리자" && (
                      <div className="flex flex-col gap-1.5">
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.01em",
                            color: "rgba(12, 12, 12, 0.5)",
                          }}
                        >
                          관리자 유형
                        </span>
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: selectedUser.isSuperAdmin ? "#008FED" : "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {selectedUser.isSuperAdmin ? "최고관리자" : "일반관리자"}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-col gap-1.5">
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "13px",
                          fontWeight: 500,
                          color: "rgba(12, 12, 12, 0.5)",
                        }}
                      >
                        구분
                      </span>
                      {isEditMode ? (
                        <div className="flex items-center gap-3" style={{ height: "36px" }}>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="editAccountType"
                              checked={(editedUserData.accountType || selectedUser.accountType || "개인") === "개인"}
                              onChange={() => setEditedUserData({ ...editedUserData, accountType: "개인" })}
                              style={{ accentColor: "#008FED", width: "16px", height: "16px" }}
                              data-testid="radio-edit-account-type-individual"
                            />
                            <span style={{ fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.8)" }}>개인</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="editAccountType"
                              checked={(editedUserData.accountType || selectedUser.accountType || "개인") === "회사"}
                              onChange={() => setEditedUserData({ ...editedUserData, accountType: "회사" })}
                              style={{ accentColor: "#008FED", width: "16px", height: "16px" }}
                              data-testid="radio-edit-account-type-company"
                            />
                            <span style={{ fontFamily: "Pretendard", fontSize: "14px", fontWeight: 500, color: "rgba(12, 12, 12, 0.8)" }}>회사</span>
                          </label>
                        </div>
                      ) : (
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {selectedUser.accountType || "개인"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Company Info Section */}
              <div className="flex flex-col py-7">
                <div className="px-4 py-2.5">
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "15px",
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      color: "rgba(12, 12, 12, 0.9)",
                    }}
                  >
                    {selectedUser.role === "보험사"
                      ? "보험사 정보"
                      : selectedUser.role === "관리자"
                        ? "관리자 정보"
                        : selectedUser.role === "심사사"
                          ? "심사사 정보"
                          : selectedUser.role === "조사사"
                            ? "조사사 정보"
                            : selectedUser.role === "협력사"
                              ? "협력사 정보"
                              : "회사 정보"}
                  </span>
                </div>
                <div className="flex flex-col gap-4">
                  {/* Row 1 */}
                  <div className="flex gap-5">
                    <div className="flex-1 flex flex-col gap-2">
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "rgba(12, 12, 12, 0.5)",
                        }}
                      >
                        회사명
                      </span>
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 400,
                          letterSpacing: "-0.02em",
                          color: isEditMode ? "rgba(12, 12, 12, 0.4)" : "rgba(12, 12, 12, 0.9)",
                        }}
                      >
                        {selectedUser.company}
                      </span>
                    </div>
                    <div className="flex-1 flex flex-col gap-2">
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "rgba(12, 12, 12, 0.5)",
                        }}
                      >
                        소속부서
                      </span>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={editedUserData.department || ""}
                          onChange={(e) => setEditedUserData({ ...editedUserData, department: e.target.value })}
                          className="px-3 py-2 rounded-lg border"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            color: "rgba(12, 12, 12, 0.9)",
                            borderColor: "rgba(12, 12, 12, 0.1)",
                          }}
                          data-testid="input-edit-department"
                        />
                      ) : (
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {selectedUser.department}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Row 2 */}
                  <div className="flex gap-5">
                    <div className="flex-1 flex flex-col gap-2">
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "rgba(12, 12, 12, 0.5)",
                        }}
                      >
                        직급
                      </span>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={editedUserData.position || ""}
                          onChange={(e) => setEditedUserData({ ...editedUserData, position: e.target.value })}
                          className="px-3 py-2 rounded-lg border"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            color: "rgba(12, 12, 12, 0.9)",
                            borderColor: "rgba(12, 12, 12, 0.1)",
                          }}
                          data-testid="input-edit-position"
                        />
                      ) : (
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {selectedUser.position}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 flex flex-col gap-2">
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "rgba(12, 12, 12, 0.5)",
                        }}
                      >
                        사무실 전화
                      </span>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={editedUserData.office || ""}
                          onChange={(e) => setEditedUserData({ ...editedUserData, office: e.target.value })}
                          className="px-3 py-2 rounded-lg border"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            color: "rgba(12, 12, 12, 0.9)",
                            borderColor: "rgba(12, 12, 12, 0.1)",
                          }}
                          data-testid="input-edit-office"
                        />
                      ) : (
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {selectedUser.office}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Row 3 */}
                  <div className="flex gap-5">
                    <div className="flex-1 flex flex-col gap-2">
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "rgba(12, 12, 12, 0.5)",
                        }}
                      >
                        주소
                      </span>
                      {isEditMode ? (
                        <input
                          type="text"
                          value={editedUserData.address || ""}
                          onChange={(e) => setEditedUserData({ ...editedUserData, address: e.target.value })}
                          className="px-3 py-2 rounded-lg border"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            color: "rgba(12, 12, 12, 0.9)",
                            borderColor: "rgba(12, 12, 12, 0.1)",
                          }}
                          data-testid="input-edit-address"
                        />
                      ) : (
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {selectedUser.address}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Partner-specific fields */}
                  {selectedUser.role === "협력사" && (
                    <>
                      {/* Row: Business Registration Number + Representative Name */}
                      <div className="flex gap-5">
                        <div className="flex-1 flex flex-col gap-2">
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 400,
                              letterSpacing: "-0.01em",
                              color: "rgba(12, 12, 12, 0.5)",
                            }}
                          >
                            사업자 등록번호
                          </span>
                          {isEditMode ? (
                            <input
                              type="text"
                              value={editedUserData.businessRegistrationNumber || ""}
                              onChange={(e) => setEditedUserData({ ...editedUserData, businessRegistrationNumber: e.target.value })}
                              className="px-3 py-2 rounded-lg border"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "16px",
                                fontWeight: 400,
                                color: "rgba(12, 12, 12, 0.9)",
                                borderColor: "rgba(12, 12, 12, 0.1)",
                              }}
                              data-testid="input-edit-businessRegistrationNumber"
                            />
                          ) : (
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "16px",
                                fontWeight: 400,
                                letterSpacing: "-0.02em",
                                color: "rgba(12, 12, 12, 0.9)",
                              }}
                            >
                              {selectedUser.businessRegistrationNumber || "-"}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 flex flex-col gap-2">
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 400,
                              letterSpacing: "-0.01em",
                              color: "rgba(12, 12, 12, 0.5)",
                            }}
                          >
                            대표자 명
                          </span>
                          {isEditMode ? (
                            <input
                              type="text"
                              value={editedUserData.representativeName || ""}
                              onChange={(e) => setEditedUserData({ ...editedUserData, representativeName: e.target.value })}
                              className="px-3 py-2 rounded-lg border"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "16px",
                                fontWeight: 400,
                                color: "rgba(12, 12, 12, 0.9)",
                                borderColor: "rgba(12, 12, 12, 0.1)",
                              }}
                              data-testid="input-edit-representativeName"
                            />
                          ) : (
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "16px",
                                fontWeight: 400,
                                letterSpacing: "-0.02em",
                                color: "rgba(12, 12, 12, 0.9)",
                              }}
                            >
                              {selectedUser.representativeName || "-"}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Row 4: Bank Info */}
                      <div className="flex gap-5">
                        <div className="flex-1 flex flex-col gap-2">
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 400,
                              letterSpacing: "-0.01em",
                              color: "rgba(12, 12, 12, 0.5)",
                            }}
                          >
                            은행명
                          </span>
                          {isEditMode ? (
                            <input
                              type="text"
                              value={editedUserData.bankName || ""}
                              onChange={(e) => setEditedUserData({ ...editedUserData, bankName: e.target.value })}
                              className="px-3 py-2 rounded-lg border"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "16px",
                                fontWeight: 400,
                                color: "rgba(12, 12, 12, 0.9)",
                                borderColor: "rgba(12, 12, 12, 0.1)",
                              }}
                              data-testid="input-edit-bankName"
                            />
                          ) : (
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "16px",
                                fontWeight: 400,
                                letterSpacing: "-0.02em",
                                color: "rgba(12, 12, 12, 0.9)",
                              }}
                            >
                              {selectedUser.bankName || "-"}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 flex flex-col gap-2">
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 400,
                              letterSpacing: "-0.01em",
                              color: "rgba(12, 12, 12, 0.5)",
                            }}
                          >
                            계좌번호
                          </span>
                          {isEditMode ? (
                            <input
                              type="text"
                              value={editedUserData.accountNumber || ""}
                              onChange={(e) => setEditedUserData({ ...editedUserData, accountNumber: e.target.value })}
                              className="px-3 py-2 rounded-lg border"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "16px",
                                fontWeight: 400,
                                color: "rgba(12, 12, 12, 0.9)",
                                borderColor: "rgba(12, 12, 12, 0.1)",
                              }}
                              data-testid="input-edit-accountNumber"
                            />
                          ) : (
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "16px",
                                fontWeight: 400,
                                letterSpacing: "-0.02em",
                                color: "rgba(12, 12, 12, 0.9)",
                              }}
                            >
                              {selectedUser.accountNumber || "-"}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Row 5: Account Holder */}
                      <div className="flex gap-5">
                        <div className="flex-1 flex flex-col gap-2">
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 400,
                              letterSpacing: "-0.01em",
                              color: "rgba(12, 12, 12, 0.5)",
                            }}
                          >
                            예금주
                          </span>
                          {isEditMode ? (
                            <input
                              type="text"
                              value={editedUserData.accountHolder || ""}
                              onChange={(e) => setEditedUserData({ ...editedUserData, accountHolder: e.target.value })}
                              className="px-3 py-2 rounded-lg border"
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "16px",
                                fontWeight: 400,
                                color: "rgba(12, 12, 12, 0.9)",
                                borderColor: "rgba(12, 12, 12, 0.1)",
                              }}
                              data-testid="input-edit-accountHolder"
                            />
                          ) : (
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "16px",
                                fontWeight: 400,
                                letterSpacing: "-0.02em",
                                color: "rgba(12, 12, 12, 0.9)",
                              }}
                            >
                              {selectedUser.accountHolder || "-"}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Row 6: Service Regions */}
                      {(isEditMode || (selectedUser.serviceRegions && selectedUser.serviceRegions.length > 0)) && (
                          <div className="flex gap-5">
                            <div className="flex-1 flex flex-col gap-2">
                              <span
                                style={{
                                  fontFamily: "Pretendard",
                                  fontSize: "14px",
                                  fontWeight: 400,
                                  letterSpacing: "-0.01em",
                                  color: "rgba(12, 12, 12, 0.5)",
                                }}
                              >
                                출동가능지역
                              </span>
                              {isEditMode ? (
                                <div
                                  className="px-4 py-3 cursor-pointer flex flex-wrap gap-2 min-h-[46px]"
                                  style={{
                                    background: "#FDFDFD",
                                    border: "2px solid rgba(12, 12, 12, 0.08)",
                                    borderRadius: "8px",
                                  }}
                                  onClick={() => {
                                    const currentRegions = editedUserData.serviceRegions || selectedUser.serviceRegions || [];
                                    setTempSelectedRegions([...currentRegions]);
                                    setRegionModalForEdit(true);
                                    setShowRegionModal(true);
                                  }}
                                  data-testid="button-edit-region-selector"
                                >
                                  {(editedUserData.serviceRegions || selectedUser.serviceRegions || []).length === 0 ? (
                                    <span
                                      style={{
                                        fontFamily: "Pretendard",
                                        fontSize: "14px",
                                        fontWeight: 400,
                                        letterSpacing: "-0.02em",
                                        color: "rgba(12, 12, 12, 0.4)",
                                      }}
                                    >
                                      지역 선택
                                    </span>
                                  ) : (
                                    (editedUserData.serviceRegions || selectedUser.serviceRegions || []).map(
                                      (region, index) => (
                                        <div
                                          key={index}
                                          className="px-3 py-1.5"
                                          style={{
                                            background: "#E3F2FD",
                                            borderRadius: "6px",
                                          }}
                                          data-testid={`edit-region-${index}`}
                                        >
                                          <span
                                            style={{
                                              fontFamily: "Pretendard",
                                              fontSize: "13px",
                                              fontWeight: 400,
                                              color: "#008FED",
                                            }}
                                          >
                                            {region}
                                          </span>
                                        </div>
                                      ),
                                    )
                                  )}
                                </div>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {(selectedUser.serviceRegions || []).map(
                                    (region, index) => (
                                      <div
                                        key={index}
                                        className="px-3 py-1.5"
                                        style={{
                                          background: "#E3F2FD",
                                          borderRadius: "6px",
                                        }}
                                        data-testid={`detail-region-${index}`}
                                      >
                                        <span
                                          style={{
                                            fontFamily: "Pretendard",
                                            fontSize: "13px",
                                            fontWeight: 400,
                                            color: "#008FED",
                                          }}
                                        >
                                          {region}
                                        </span>
                                      </div>
                                    ),
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                      {/* Row 7: Attachments */}
                      {(isEditMode || (selectedUser.attachments && selectedUser.attachments.length > 0)) && (
                          <div className="flex gap-5">
                            <div className="flex-1 flex flex-col gap-2">
                              <span
                                style={{
                                  fontFamily: "Pretendard",
                                  fontSize: "14px",
                                  fontWeight: 400,
                                  letterSpacing: "-0.01em",
                                  color: "rgba(12, 12, 12, 0.5)",
                                }}
                              >
                                첨부파일
                              </span>
                              {isEditMode && (
                                <div
                                  className="flex flex-col items-center justify-center gap-2"
                                  style={{
                                    border: "2px dashed rgba(0, 143, 237, 0.3)",
                                    borderRadius: "8px",
                                    padding: "16px",
                                    background: "#F8FCFF",
                                    cursor: "pointer",
                                    transition: "background 0.2s",
                                  }}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.currentTarget.style.background = "#EDF5FF";
                                  }}
                                  onDragLeave={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.currentTarget.style.background = "#F8FCFF";
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.currentTarget.style.background = "#F8FCFF";
                                    const files = Array.from(e.dataTransfer.files || []);
                                    if (files.length > 0 && selectedUser) {
                                      let processedCount = 0;
                                      const newFileJsons: string[] = [];
                                      files.forEach((file) => {
                                        const reader = new FileReader();
                                        reader.onload = (ev) => {
                                          const dataUrl = ev.target?.result as string;
                                          newFileJsons.push(JSON.stringify({ name: file.name, data: dataUrl, type: file.type }));
                                          processedCount++;
                                          if (processedCount === files.length) {
                                            const currentAttachments = selectedUser.attachments || [];
                                            const updatedAttachments = [...newFileJsons, ...currentAttachments];
                                            updateUserMutation.mutate({
                                              userId: selectedUser.id.toString(),
                                              data: { attachments: updatedAttachments },
                                            });
                                            setSelectedUser(prev => prev ? { ...prev, attachments: updatedAttachments } : null);
                                          }
                                        };
                                        reader.readAsDataURL(file);
                                      });
                                    }
                                  }}
                                  onClick={() => {
                                    const input = document.createElement("input");
                                    input.type = "file";
                                    input.multiple = true;
                                    input.accept = "*/*";
                                    input.onchange = (e) => {
                                      const files = Array.from((e.target as HTMLInputElement).files || []);
                                      if (files.length > 0 && selectedUser) {
                                        let processedCount = 0;
                                        const newFileJsons: string[] = [];
                                        files.forEach((file) => {
                                          const reader = new FileReader();
                                          reader.onload = (ev) => {
                                            const dataUrl = ev.target?.result as string;
                                            newFileJsons.push(JSON.stringify({ name: file.name, data: dataUrl, type: file.type }));
                                            processedCount++;
                                            if (processedCount === files.length) {
                                              const currentAttachments = selectedUser.attachments || [];
                                              const updatedAttachments = [...newFileJsons, ...currentAttachments];
                                              updateUserMutation.mutate({
                                                userId: selectedUser.id.toString(),
                                                data: { attachments: updatedAttachments },
                                              });
                                              setSelectedUser(prev => prev ? { ...prev, attachments: updatedAttachments } : null);
                                            }
                                          };
                                          reader.readAsDataURL(file);
                                        });
                                      }
                                    };
                                    input.click();
                                  }}
                                  data-testid="edit-file-upload-area"
                                >
                                  <Upload size={20} style={{ color: "#008FED" }} />
                                  <span
                                    style={{
                                      fontFamily: "Pretendard",
                                      fontSize: "13px",
                                      fontWeight: 400,
                                      color: "rgba(12, 12, 12, 0.5)",
                                    }}
                                  >
                                    파일을 드래그하거나 클릭하여 업로드
                                  </span>
                                </div>
                              )}
                              {isEditMode && selectedUser.attachments && selectedUser.attachments.length > 0 && (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    className="flex items-center gap-1"
                                    style={{ cursor: selectedAttachmentIndices.size > 0 ? "pointer" : "default" }}
                                    onClick={() => {
                                      if (selectedAttachmentIndices.size > 0) {
                                        setShowDeleteAttachmentsConfirm(true);
                                      }
                                    }}
                                    data-testid="button-delete-selected-attachments"
                                  >
                                    <Trash2 size={14} style={{ color: selectedAttachmentIndices.size > 0 ? "#E53E3E" : "rgba(12, 12, 12, 0.3)" }} />
                                    <span
                                      style={{
                                        fontFamily: "Pretendard",
                                        fontSize: "13px",
                                        fontWeight: 500,
                                        color: selectedAttachmentIndices.size > 0 ? "#E53E3E" : "rgba(12, 12, 12, 0.3)",
                                      }}
                                    >
                                      선택 삭제하기
                                    </span>
                                  </button>
                                </div>
                              )}
                              {selectedUser.attachments && selectedUser.attachments.length > 0 && (
                              <div className="flex flex-col gap-1">
                                {selectedUser.attachments.map((file, index) => {
                                  let fileName = file;
                                  let fileData: {name: string, data: string, type: string} | null = null;
                                  try {
                                    const parsed = JSON.parse(file);
                                    if (parsed && parsed.name && parsed.data) {
                                      fileName = parsed.name;
                                      fileData = parsed;
                                    }
                                  } catch {}
                                  return (
                                    <div key={index} className="flex items-center gap-2">
                                      {isEditMode && (
                                        <input
                                          type="checkbox"
                                          checked={selectedAttachmentIndices.has(index)}
                                          onChange={(e) => {
                                            const newSet = new Set(selectedAttachmentIndices);
                                            if (e.target.checked) {
                                              newSet.add(index);
                                            } else {
                                              newSet.delete(index);
                                            }
                                            setSelectedAttachmentIndices(newSet);
                                          }}
                                          style={{ accentColor: "#008FED", cursor: "pointer" }}
                                          data-testid={`checkbox-attachment-${index}`}
                                        />
                                      )}
                                      <span
                                        style={{
                                          fontFamily: "Pretendard",
                                          fontSize: "14px",
                                          fontWeight: 400,
                                          color: "#008FED",
                                        }}
                                        data-testid={`detail-attachment-${index}`}
                                      >
                                        {fileName}
                                      </span>
                                      {fileData && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const isPdf = fileData.type === "application/pdf" || fileData.name.toLowerCase().endsWith(".pdf");
                                            if (isPdf) {
                                              try {
                                                const base64Match = fileData.data.match(/^data:([^;]+);base64,(.+)$/);
                                                if (base64Match) {
                                                  const byteCharacters = atob(base64Match[2]);
                                                  const byteNumbers = new Array(byteCharacters.length);
                                                  for (let i = 0; i < byteCharacters.length; i++) {
                                                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                                                  }
                                                  const byteArray = new Uint8Array(byteNumbers);
                                                  const blob = new Blob([byteArray], { type: "application/pdf" });
                                                  const blobUrl = URL.createObjectURL(blob);
                                                  window.open(blobUrl, "_blank");
                                                }
                                              } catch {
                                                window.open(fileData.data, "_blank");
                                              }
                                            } else {
                                              setPreviewAttachment(fileData);
                                            }
                                          }}
                                          style={{ cursor: "pointer", flexShrink: 0 }}
                                          data-testid={`button-preview-attachment-${index}`}
                                        >
                                          <ZoomIn size={16} style={{ color: "#008FED" }} />
                                        </button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              )}
                            </div>
                          </div>
                        )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Buttons - Fixed at bottom */}
            <div
              className="flex gap-5 px-8 bg-white"
              style={{
                height: "84px",
                alignItems: "center",
                borderTop: "1px solid rgba(12, 12, 12, 0.08)",
                flexShrink: 0,
              }}
            >
              {isEditMode ? (
                <>
                  <button
                    className="flex-1 flex items-center justify-center rounded-xl"
                    style={{
                      height: "64px",
                      background: "rgba(12, 12, 12, 0.1)",
                    }}
                    onClick={() => {
                      setIsEditMode(false);
                      setEditedUserData({});
                      setSelectedAttachmentIndices(new Set());
                    }}
                    data-testid="button-cancel-edit"
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "20px",
                        fontWeight: 600,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.7)",
                      }}
                    >
                      취소
                    </span>
                  </button>
                  <button
                    className="flex-1 flex items-center justify-center rounded-xl"
                    style={{
                      height: "64px",
                      background: "#008FED",
                      boxShadow: "2px 4px 30px #BDD1F0",
                    }}
                    onClick={() => {
                      if (selectedUser) {
                        updateUserMutation.mutate({
                          userId: selectedUser.id.toString(),
                          data: editedUserData,
                        });
                      }
                    }}
                    disabled={updateUserMutation.isPending}
                    data-testid="button-save-edit"
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "20px",
                        fontWeight: 600,
                        letterSpacing: "-0.02em",
                        color: "#FDFDFD",
                      }}
                    >
                      {updateUserMutation.isPending ? "저장 중..." : "저장"}
                    </span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="flex-1 flex items-center justify-center rounded-xl"
                    style={{
                      height: "64px",
                      background: "#D02B20",
                      boxShadow: "2px 4px 30px #BDD1F0",
                    }}
                    onClick={() => {
                      setShowDeleteAccountModal(true);
                    }}
                    data-testid="button-delete-account"
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "20px",
                        fontWeight: 600,
                        letterSpacing: "-0.02em",
                        color: "#FDFDFD",
                      }}
                    >
                      계정 삭제
                    </span>
                  </button>
                  <button
                    className="flex-1 flex items-center justify-center rounded-xl"
                    style={{
                      height: "64px",
                      background: "transparent",
                      boxShadow: "2px 4px 30px #BDD1F0",
                    }}
                    onClick={() => {
                      setShowResetPasswordModal(true);
                    }}
                    data-testid="button-reset-password"
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "20px",
                        fontWeight: 600,
                        letterSpacing: "-0.02em",
                        color: "#D02B20",
                      }}
                    >
                      비밀번호 초기화
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Attachment Preview Modal */}
      {previewAttachment && (
        <>
          <div
            className="fixed inset-0 z-[60]"
            style={{ background: "rgba(0, 0, 0, 0.7)" }}
            onClick={() => setPreviewAttachment(null)}
          />
          <div
            className="fixed z-[61] flex flex-col"
            style={{
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "#FFFFFF",
              borderRadius: "12px",
              maxWidth: "90vw",
              maxHeight: "90vh",
              minWidth: "400px",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
            }}
          >
            <div
              className="flex items-center justify-between px-6"
              style={{
                height: "56px",
                borderBottom: "1px solid rgba(12, 12, 12, 0.08)",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "#0C0C0C",
                  letterSpacing: "-0.02em",
                }}
              >
                {previewAttachment.name}
              </span>
              <button
                onClick={() => setPreviewAttachment(null)}
                className="flex items-center justify-center"
                style={{ width: "28px", height: "28px" }}
                data-testid="button-close-preview"
              >
                <X size={20} style={{ color: "#686A6E" }} />
              </button>
            </div>
            <div
              className="flex items-center justify-center overflow-auto"
              style={{ padding: "24px", maxHeight: "calc(90vh - 56px)" }}
            >
              {previewAttachment.type.startsWith("image/") ? (
                <img
                  src={previewAttachment.data}
                  alt={previewAttachment.name}
                  style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }}
                  data-testid="preview-image"
                />
              ) : (previewAttachment.type === "application/pdf" || previewAttachment.name.toLowerCase().endsWith(".pdf")) ? (
                (() => {
                  let pdfSrc = previewAttachment.data;
                  try {
                    const base64Match = previewAttachment.data.match(/^data:([^;]+);base64,(.+)$/);
                    if (base64Match) {
                      const byteCharacters = atob(base64Match[2]);
                      const byteNumbers = new Array(byteCharacters.length);
                      for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                      }
                      const byteArray = new Uint8Array(byteNumbers);
                      const blob = new Blob([byteArray], { type: "application/pdf" });
                      pdfSrc = URL.createObjectURL(blob);
                    }
                  } catch {}
                  return (
                    <iframe
                      src={pdfSrc}
                      title={previewAttachment.name}
                      style={{ width: "700px", height: "70vh", border: "none" }}
                      data-testid="preview-pdf"
                    />
                  );
                })()
              ) : (
                <div className="flex flex-col items-center gap-4 py-8">
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 400,
                      color: "#686A6E",
                    }}
                  >
                    미리보기를 지원하지 않는 파일 형식입니다.
                  </span>
                  <a
                    href={previewAttachment.data}
                    download={previewAttachment.name}
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "#008FED",
                      textDecoration: "underline",
                    }}
                    data-testid="link-download-attachment"
                  >
                    파일 다운로드
                  </a>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Delete Attachments Confirmation Modal */}
      {showDeleteAttachmentsConfirm && selectedUser && (
        <>
          <div
            className="fixed inset-0 z-[70]"
            style={{ background: "rgba(0, 0, 0, 0.5)" }}
            onClick={() => setShowDeleteAttachmentsConfirm(false)}
          />
          <div
            className="fixed z-[71] flex flex-col"
            style={{
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "#FFFFFF",
              borderRadius: "12px",
              width: "400px",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
              padding: "32px",
            }}
          >
            <span
              style={{
                fontFamily: "Pretendard",
                fontSize: "18px",
                fontWeight: 600,
                color: "#0C0C0C",
                letterSpacing: "-0.02em",
                textAlign: "center",
                marginBottom: "24px",
              }}
            >
              파일 {selectedAttachmentIndices.size}개를 삭제하시겠습니까?
            </span>
            <div className="flex gap-3">
              <button
                className="flex-1 flex items-center justify-center rounded-lg"
                style={{
                  height: "48px",
                  background: "rgba(12, 12, 12, 0.1)",
                }}
                onClick={() => setShowDeleteAttachmentsConfirm(false)}
                data-testid="button-cancel-delete-attachments"
              >
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "15px",
                    fontWeight: 600,
                    color: "rgba(12, 12, 12, 0.7)",
                  }}
                >
                  취소
                </span>
              </button>
              <button
                className="flex-1 flex items-center justify-center rounded-lg"
                style={{
                  height: "48px",
                  background: "#E53E3E",
                }}
                onClick={() => {
                  if (selectedUser && selectedUser.attachments) {
                    const remainingAttachments = selectedUser.attachments.filter(
                      (_, idx) => !selectedAttachmentIndices.has(idx)
                    );
                    updateUserMutation.mutate({
                      userId: selectedUser.id.toString(),
                      data: { attachments: remainingAttachments },
                    });
                    setSelectedUser(prev => prev ? { ...prev, attachments: remainingAttachments } : null);
                    setSelectedAttachmentIndices(new Set());
                    setShowDeleteAttachmentsConfirm(false);
                  }
                }}
                data-testid="button-confirm-delete-attachments"
              >
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "15px",
                    fontWeight: 600,
                    color: "#FFFFFF",
                  }}
                >
                  확인
                </span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Password Reset Modal */}
      {showResetPasswordModal && selectedUser && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-50"
            style={{
              background: "rgba(0, 0, 0, 0.7)",
              opacity: 0.4,
            }}
            onClick={() => setShowResetPasswordModal(false)}
            data-testid="modal-overlay-reset"
          />

          {/* Modal */}
          <div
            className="fixed z-50 bg-white flex flex-col"
            style={{
              width: "747px",
              height: "516px",
              left: "calc(50% - 747px/2 + 0.5px)",
              top: "calc(50% - 516px/2 + 0.5px)",
              boxShadow: "0px -2px 70px rgba(179, 193, 205, 0.8)",
              borderRadius: "12px",
              gap: "32px",
            }}
            data-testid="modal-reset-password"
          >
            {/* Header */}
            <div
              className="flex flex-col items-center"
              style={{
                width: "747px",
                height: "396px",
                gap: "16px",
              }}
            >
              <div
                className="flex flex-row justify-center items-center"
                style={{
                  width: "747px",
                  height: "60px",
                  gap: "321px",
                }}
              >
                <h2
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "18px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "#0C0C0C",
                  }}
                >
                  비밀번호 초기화
                </h2>
              </div>

              {/* Content */}
              <div
                className="flex flex-col"
                style={{
                  width: "707px",
                  height: "320px",
                  gap: "24px",
                }}
              >
                {/* Selected Account Section */}
                <div
                  className="flex flex-col"
                  style={{
                    width: "707px",
                    height: "244px",
                    gap: "20px",
                  }}
                >
                  {/* Section Title */}
                  <div
                    className="flex flex-col"
                    style={{ width: "707px", height: "114px", gap: "8px" }}
                  >
                    <div
                      className="flex flex-row"
                      style={{ width: "707px", height: "18px", gap: "2px" }}
                    >
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 500,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        선택 계정
                      </span>
                    </div>

                    {/* Profile Card */}
                    <div
                      className="flex flex-col justify-center p-5"
                      style={{
                        width: "707px",
                        height: "88px",
                        background: "rgba(12, 12, 12, 0.04)",
                        backdropFilter: "blur(7px)",
                        borderRadius: "12px",
                        gap: "8px",
                      }}
                    >
                      <div
                        className="flex flex-row items-center"
                        style={{ width: "667px", height: "26px", gap: "16px" }}
                      >
                        <div
                          className="flex flex-row items-center"
                          style={{ width: "180px", height: "26px", gap: "9px" }}
                        >
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "18px",
                              fontWeight: 600,
                              letterSpacing: "-0.02em",
                              color: "rgba(12, 12, 12, 0.9)",
                            }}
                          >
                            {selectedUser.name}
                          </span>
                          <div
                            style={{
                              width: "4px",
                              height: "4px",
                              background: "rgba(0, 143, 237, 0.9)",
                              borderRadius: "50%",
                            }}
                          />
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "18px",
                              fontWeight: 600,
                              letterSpacing: "-0.02em",
                              color: "rgba(12, 12, 12, 0.9)",
                            }}
                          >
                            {selectedUser.company}
                          </span>
                          <div
                            className="flex items-center justify-center"
                            style={{
                              width: "57px",
                              height: "26px",
                              padding: "4px 10px",
                              background: "rgba(12, 12, 12, 0.1)",
                              backdropFilter: "blur(7px)",
                              borderRadius: "20px",
                            }}
                          >
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                letterSpacing: "-0.01em",
                                color: "rgba(12, 12, 12, 0.7)",
                              }}
                            >
                              {selectedUser.role}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div
                        className="flex flex-row"
                        style={{ width: "400px", height: "20px", gap: "24px" }}
                      >
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.7)",
                          }}
                        >
                          {selectedUser.username}
                        </span>
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "16px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.7)",
                          }}
                        >
                          {selectedUser.phone}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* New Password Section */}
                  <div
                    className="flex flex-col"
                    style={{
                      width: "707px",
                      height: "110px",
                      gap: "10px",
                    }}
                  >
                    <div
                      className="flex flex-col"
                      style={{ width: "432px", height: "76px", gap: "8px" }}
                    >
                      <div
                        className="flex flex-row"
                        style={{ width: "432px", height: "18px", gap: "2px" }}
                      >
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 500,
                            letterSpacing: "-0.01em",
                            color: "#686A6E",
                          }}
                        >
                          새 비밀번호(자동)
                        </span>
                      </div>

                      {/* Input Field + Reset Button */}
                      <div
                        className="flex flex-row items-center"
                        style={{ width: "432px", height: "50px", gap: "8px" }}
                      >
                        <div
                          className="flex flex-row items-center"
                          style={{
                            width: "343px",
                            height: "50px",
                            padding: "10px 20px",
                            background: "#FDFDFD",
                            border: "2px solid rgba(12, 12, 12, 0.08)",
                            borderRadius: "8px",
                            gap: "10px",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "16px",
                              fontWeight: 600,
                              letterSpacing: "-0.02em",
                              color: "#0C0C0C",
                            }}
                          >
                            {resetPasswordValue}
                          </span>
                        </div>

                        <button
                          className="flex flex-row items-center justify-center"
                          style={{
                            width: "81px",
                            height: "50px",
                            padding: "10px 20px",
                            background: "rgba(208, 43, 32, 0.1)",
                            border: "1px solid #D02B20",
                            borderRadius: "8px",
                            gap: "10px",
                          }}
                          onClick={() => setResetPasswordValue("0000")}
                          data-testid="button-trigger-reset"
                        >
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "16px",
                              fontWeight: 600,
                              letterSpacing: "-0.02em",
                              color: "#D02B20",
                            }}
                          >
                            초기화
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Warning Message */}
                    <div
                      className="flex flex-row justify-center items-center"
                      style={{
                        width: "707px",
                        height: "52px",
                        padding: "16px 12px",
                        background: "rgba(255, 226, 85, 0.2)",
                        backdropFilter: "blur(7px)",
                        borderRadius: "20px",
                        gap: "10px",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 500,
                          letterSpacing: "-0.02em",
                          color: "#A16000",
                        }}
                      >
                        초기화 후 기존 세션은 로그아웃됩니다.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Buttons */}
            <div
              className="flex flex-col"
              style={{
                width: "747px",
                height: "88px",
                padding: "20px",
                background: "#FDFDFD",
                borderTop: "1px solid rgba(12, 12, 12, 0.08)",
                gap: "10px",
              }}
            >
              <div
                className="flex flex-row justify-between items-center"
                style={{
                  width: "707px",
                  height: "48px",
                }}
              >
                <button
                  className="flex flex-row justify-center items-center"
                  style={{
                    width: "353.5px",
                    height: "48px",
                    padding: "10px",
                    borderRadius: "6px",
                    gap: "10px",
                  }}
                  onClick={() => setShowResetPasswordModal(false)}
                  data-testid="button-cancel-reset"
                >
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 500,
                      letterSpacing: "-0.02em",
                      color: "#D02B20",
                    }}
                  >
                    취소
                  </span>
                </button>

                <button
                  className="flex flex-row justify-center items-center"
                  style={{
                    width: "353.5px",
                    height: "48px",
                    padding: "10px",
                    background: "#008FED",
                    borderRadius: "6px",
                    gap: "10px",
                  }}
                  onClick={async () => {
                    if (!selectedUser) return;

                    try {
                      await apiRequest("POST", "/api/update-password", {
                        username: selectedUser.username,
                        newPassword: resetPasswordValue,
                      });

                      // Show success message
                      toast({
                        title: "비밀번호 초기화 완료",
                        description: `${selectedUser.name}님의 비밀번호가 ${resetPasswordValue}로 변경되었습니다.`,
                      });

                      // Close modals
                      setShowResetPasswordModal(false);
                      setSelectedUser(null);
                    } catch (error) {
                      console.error("Failed to reset password:", error);

                      // Show error message
                      toast({
                        variant: "destructive",
                        title: "비밀번호 초기화 실패",
                        description:
                          error instanceof Error
                            ? error.message
                            : "비밀번호 변경 중 오류가 발생했습니다.",
                      });
                    }
                  }}
                  data-testid="button-confirm-reset"
                >
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: "#FDFDFD",
                    }}
                  >
                    확인
                  </span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Delete Account Modal */}
      {showDeleteAccountModal && selectedUser && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-50"
            style={{
              background: "rgba(0, 0, 0, 0.7)",
              opacity: 0.4,
            }}
            onClick={() => setShowDeleteAccountModal(false)}
            data-testid="modal-overlay-delete"
          />

          {/* Modal */}
          <div
            className="fixed z-50 bg-white flex flex-col"
            style={{
              width: "747px",
              height: "386px",
              left: "calc(50% - 747px/2 + 0.5px)",
              top: "calc(50% - 386px/2 + 0.5px)",
              boxShadow: "0px -2px 70px rgba(179, 193, 205, 0.8)",
              borderRadius: "12px",
              gap: "32px",
            }}
            data-testid="modal-delete-account"
          >
            {/* Content */}
            <div
              className="flex flex-col items-center"
              style={{
                width: "747px",
                height: "266px",
                gap: "16px",
              }}
            >
              {/* Header */}
              <div
                className="flex flex-row justify-center items-center"
                style={{
                  width: "747px",
                  height: "60px",
                  gap: "321px",
                }}
              >
                <h2
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "18px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "#0C0C0C",
                  }}
                >
                  계정 삭제
                </h2>
              </div>

              {/* Body */}
              <div
                className="flex flex-col"
                style={{
                  width: "707px",
                  height: "190px",
                  gap: "24px",
                }}
              >
                {/* Selected Account Section */}
                <div
                  className="flex flex-col"
                  style={{
                    width: "707px",
                    height: "114px",
                    gap: "20px",
                  }}
                >
                  {/* Section Title */}
                  <div
                    className="flex flex-row"
                    style={{ width: "707px", height: "18px", gap: "2px" }}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        letterSpacing: "-0.01em",
                        color: "#686A6E",
                      }}
                    >
                      선택 계정
                    </span>
                  </div>

                  {/* Profile Card */}
                  <div
                    className="flex flex-col justify-center p-5"
                    style={{
                      width: "707px",
                      height: "88px",
                      background: "rgba(12, 12, 12, 0.04)",
                      backdropFilter: "blur(7px)",
                      borderRadius: "12px",
                      gap: "8px",
                    }}
                  >
                    {/* Top row: Name, Company, Role */}
                    <div
                      className="flex flex-row items-center"
                      style={{
                        width: "667px",
                        height: "26px",
                        gap: "16px",
                      }}
                    >
                      <div className="flex flex-row items-center gap-2.5">
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "18px",
                            fontWeight: 600,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {selectedUser.name}
                        </span>
                        <div
                          style={{
                            width: "4px",
                            height: "4px",
                            background: "rgba(0, 143, 237, 0.9)",
                            borderRadius: "50%",
                          }}
                        />
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "18px",
                            fontWeight: 600,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {selectedUser.company}
                        </span>
                      </div>
                      <div
                        className="flex items-center justify-center px-2.5"
                        style={{
                          height: "26px",
                          background: "rgba(12, 12, 12, 0.1)",
                          backdropFilter: "blur(7px)",
                          borderRadius: "20px",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.01em",
                            color: "rgba(12, 12, 12, 0.7)",
                          }}
                        >
                          {selectedUser.role}
                        </span>
                      </div>
                    </div>

                    {/* Bottom row: Username, Phone */}
                    <div
                      className="flex flex-row"
                      style={{
                        width: "400px",
                        height: "20px",
                        gap: "24px",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 400,
                          letterSpacing: "-0.02em",
                          color: "rgba(12, 12, 12, 0.7)",
                        }}
                      >
                        {selectedUser.username}
                      </span>
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 400,
                          letterSpacing: "-0.02em",
                          color: "rgba(12, 12, 12, 0.7)",
                        }}
                      >
                        {selectedUser.phone}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Warning Message */}
                <div
                  className="flex flex-row justify-center items-center"
                  style={{
                    width: "707px",
                    height: "52px",
                    padding: "16px 12px",
                    gap: "10px",
                    background: "rgba(208, 43, 32, 0.2)",
                    backdropFilter: "blur(7px)",
                    borderRadius: "20px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 500,
                      letterSpacing: "-0.02em",
                      color: "#D02B20",
                    }}
                  >
                    계정 삭제 시 즉시 로그아웃됩니다. 활동 로그/정산 기록 등
                    이력 데이터는 보존됩니다.
                  </span>
                </div>
              </div>
            </div>

            {/* Footer with Buttons */}
            <div
              className="flex flex-col items-start p-5"
              style={{
                width: "747px",
                height: "88px",
                background: "#FDFDFD",
                borderTop: "1px solid rgba(12, 12, 12, 0.08)",
                gap: "10px",
              }}
            >
              <div
                className="flex flex-row justify-between items-center"
                style={{
                  width: "707px",
                  height: "48px",
                }}
              >
                {/* Cancel Button */}
                <button
                  className="flex-1 flex items-center justify-center"
                  style={{
                    height: "48px",
                    borderRadius: "6px",
                  }}
                  onClick={() => setShowDeleteAccountModal(false)}
                  data-testid="button-cancel-delete"
                >
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 500,
                      letterSpacing: "-0.02em",
                      color: "#D02B20",
                    }}
                  >
                    취소
                  </span>
                </button>

                {/* Confirm Delete Button */}
                <button
                  className="flex-1 flex items-center justify-center"
                  style={{
                    height: "48px",
                    background: "#D02B20",
                    borderRadius: "6px",
                  }}
                  onClick={async () => {
                    try {
                      // Call delete account API
                      await apiRequest("POST", "/api/delete-account", {
                        username: selectedUser.username,
                      });

                      // Invalidate users query to refetch from server
                      await queryClient.invalidateQueries({
                        queryKey: ["/api/users"],
                      });

                      // Show success message
                      toast({
                        title: "계정 삭제 완료",
                        description: `${selectedUser.name}님의 계정이 삭제되었습니다. 활동 로그 및 정산 기록은 보존됩니다.`,
                      });

                      // Close modals
                      setShowDeleteAccountModal(false);
                      setSelectedUser(null);
                    } catch (error) {
                      console.error("Failed to delete account:", error);

                      // Show error message
                      toast({
                        variant: "destructive",
                        title: "계정 삭제 실패",
                        description:
                          error instanceof Error
                            ? error.message
                            : "계정 삭제 중 오류가 발생했습니다.",
                      });
                    }
                  }}
                  data-testid="button-confirm-delete"
                >
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: "#FDFDFD",
                    }}
                  >
                    영구 삭제
                  </span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Create Account Modal */}
      {showCreateAccountModal && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 flex items-center justify-center"
            style={{
              background: "rgba(0, 0, 0, 0.28)",
              zIndex: 9999,
            }}
            onClick={() => setShowCancelConfirmModal(true)}
          />

          {/* Modal */}
          <div
            className="fixed flex flex-col"
            style={{
              width: "1016px",
              maxWidth: "90vw",
              maxHeight: "90vh",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              background: "#FFFFFF",
              boxShadow: "0px 0px 20px #DBE9F5",
              borderRadius: "12px",
              zIndex: 10000,
            }}
            onClick={(e) => e.stopPropagation()}
            data-testid="modal-create-account"
          >
            {/* Header */}
            <div
              className="flex flex-row justify-between items-center px-6 py-6"
              style={{
                borderBottom: "2px solid rgba(12, 12, 12, 0.1)",
              }}
            >
              <div style={{ width: "28px" }} />
              <h2
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "22px",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                }}
              >
                새로운 계정 생성
              </h2>
              <button
                className="flex items-center justify-center hover-elevate active-elevate-2"
                style={{
                  width: "28px",
                  height: "28px",
                }}
                onClick={() => setShowCancelConfirmModal(true)}
                data-testid="button-close-create-modal"
              >
                <X size={20} style={{ color: "rgba(12, 12, 12, 0.8)" }} />
              </button>
            </div>

            {/* Form Content */}
            <div
              className="flex-1 flex flex-col px-6 py-6 gap-6 overflow-y-auto"
              style={{
                maxHeight: "calc(90vh - 170px)",
              }}
            >
              {/* Role Selection */}
              <div className="flex flex-col gap-2">
                <label
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                    color: "#686A6E",
                  }}
                >
                  역할
                </label>
                <div className="flex items-center gap-4">
                  <div className="relative" style={{ width: "97px" }}>
                    <select
                      value={createAccountForm.role}
                      onChange={(e) =>
                        setCreateAccountForm({
                          ...createAccountForm,
                          role: e.target.value,
                          isSuperAdmin: e.target.value === "관리자" ? createAccountForm.isSuperAdmin : false,
                        })
                      }
                      className="flex items-center justify-center px-4 pr-8 appearance-none cursor-pointer"
                      style={{
                        width: "100%",
                        height: "46px",
                        background: "rgba(255, 255, 255, 0.04)",
                        border: "1px solid rgba(12, 12, 12, 0.3)",
                        boxShadow:
                          "inset 0px -2px 4px rgba(0, 0, 0, 0.05), inset 0px 2px 4px rgba(0, 0, 0, 0.05)",
                        backdropFilter: "blur(7px)",
                        borderRadius: "6px",
                        fontFamily: "Pretendard",
                        fontSize: "16px",
                        fontWeight: 500,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.9)",
                      }}
                      data-testid="select-role"
                    >
                      {VALID_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={22}
                      className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ color: "rgba(12, 12, 12, 0.6)" }}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <label
                      className="flex items-center gap-1.5 cursor-pointer"
                      data-testid="label-account-type-individual"
                    >
                      <input
                        type="radio"
                        name="accountType"
                        checked={createAccountForm.accountType === "개인"}
                        onChange={() =>
                          setCreateAccountForm({
                            ...createAccountForm,
                            accountType: "개인",
                          })
                        }
                        style={{ accentColor: "#008FED", width: "16px", height: "16px" }}
                        data-testid="radio-account-type-individual"
                      />
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "15px",
                          fontWeight: 500,
                          color: "rgba(12, 12, 12, 0.8)",
                        }}
                      >
                        개인
                      </span>
                    </label>
                    <label
                      className="flex items-center gap-1.5 cursor-pointer"
                      data-testid="label-account-type-company"
                    >
                      <input
                        type="radio"
                        name="accountType"
                        checked={createAccountForm.accountType === "회사"}
                        onChange={() =>
                          setCreateAccountForm({
                            ...createAccountForm,
                            accountType: "회사",
                          })
                        }
                        style={{ accentColor: "#008FED", width: "16px", height: "16px" }}
                        data-testid="radio-account-type-company"
                      />
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "15px",
                          fontWeight: 500,
                          color: "rgba(12, 12, 12, 0.8)",
                        }}
                      >
                        회사
                      </span>
                    </label>
                  </div>
                </div>
              </div>


              {/* Form Inputs */}
              <div className="flex flex-col gap-4">
                <h3
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "#0C0C0C",
                  }}
                >
                  기본 정보
                </h3>

                {/* 기본 정보: 성함, ID, 연락처, 이메일 주소 */}
                <div className="flex gap-3" style={{ width: "100%" }}>
                  <div className="flex-1">
                    <label
                      className="block mb-2"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        letterSpacing: "-0.01em",
                        color: "#686A6E",
                      }}
                    >
                      성함
                    </label>
                    <input
                      type="text"
                      placeholder="성함"
                      value={createAccountForm.name}
                      onChange={(e) =>
                        setCreateAccountForm({
                          ...createAccountForm,
                          name: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 outline-none"
                      style={{
                        background: "#FDFDFD",
                        border: "2px solid rgba(12, 12, 12, 0.08)",
                        borderRadius: "8px",
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.9)",
                      }}
                      data-testid="input-name"
                    />
                  </div>
                  <div className="flex-1">
                    <label
                      className="block mb-2"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        letterSpacing: "-0.01em",
                        color: "#686A6E",
                      }}
                    >
                      ID
                    </label>
                    <input
                      type="text"
                      placeholder="사용자 ID"
                      value={createAccountForm.username}
                      onChange={(e) =>
                        setCreateAccountForm({
                          ...createAccountForm,
                          username: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 outline-none"
                      style={{
                        background: "#FDFDFD",
                        border: "2px solid rgba(12, 12, 12, 0.08)",
                        borderRadius: "8px",
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.9)",
                      }}
                      data-testid="input-username"
                    />
                  </div>
                  <div className="flex-1">
                    <label
                      className="block mb-2"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        letterSpacing: "-0.01em",
                        color: "#686A6E",
                      }}
                    >
                      연락처
                    </label>
                    <input
                      type="tel"
                      placeholder="- 빼고 입력"
                      value={createAccountForm.phone}
                      onChange={(e) =>
                        setCreateAccountForm({
                          ...createAccountForm,
                          phone: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 outline-none"
                      style={{
                        background: "#FDFDFD",
                        border: "2px solid rgba(12, 12, 12, 0.08)",
                        borderRadius: "8px",
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.9)",
                      }}
                      data-testid="input-phone"
                    />
                  </div>
                  <div className="flex-1">
                    <label
                      className="block mb-2"
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        letterSpacing: "-0.01em",
                        color: "#686A6E",
                      }}
                    >
                      이메일 주소
                    </label>
                    <input
                      type="email"
                      placeholder="이메일 주소"
                      value={createAccountForm.email}
                      onChange={(e) =>
                        setCreateAccountForm({
                          ...createAccountForm,
                          email: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 outline-none"
                      style={{
                        background: "#FDFDFD",
                        border: "2px solid rgba(12, 12, 12, 0.08)",
                        borderRadius: "8px",
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 400,
                        letterSpacing: "-0.02em",
                        color: "rgba(12, 12, 12, 0.9)",
                      }}
                      data-testid="input-email"
                    />
                  </div>
                </div>

                <h3
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "#0C0C0C",
                    marginTop: "12px",
                  }}
                >
                  {createAccountForm.role === "보험사"
                    ? "보험사 정보"
                    : createAccountForm.role === "관리자"
                      ? "관리자 정보"
                      : createAccountForm.role === "심사사"
                        ? "심사사 정보"
                        : createAccountForm.role === "조사사"
                          ? "조사사 정보"
                          : createAccountForm.role === "협력사"
                            ? "협력사 정보"
                            : "회사 정보"}
                </h3>

                {createAccountForm.role === "협력사" ? (
                  <>
                    {/* 협력사 정보: Row 1 - 회사명, 소속부서, 직급, 사무실 전화 */}
                    <div className="flex gap-3" style={{ width: "100%" }}>
                      <div className="flex-1">
                        <label
                          className="block mb-2"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.01em",
                            color: "#686A6E",
                          }}
                        >
                          회사명
                        </label>
                        <input
                          type="text"
                          placeholder="회사명"
                          value={createAccountForm.company}
                          onChange={(e) =>
                            setCreateAccountForm({
                              ...createAccountForm,
                              company: e.target.value,
                            })
                          }
                          className="w-full px-4 py-3 outline-none"
                          style={{
                            background: "#FDFDFD",
                            border: "2px solid rgba(12, 12, 12, 0.08)",
                            borderRadius: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                          data-testid="input-company"
                        />
                      </div>
                      <div className="flex-1">
                        <label
                          className="block mb-2"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.01em",
                            color: "#686A6E",
                          }}
                        >
                          소속부서
                        </label>
                        <input
                          type="text"
                          placeholder="소속부서"
                          value={createAccountForm.department}
                          onChange={(e) =>
                            setCreateAccountForm({
                              ...createAccountForm,
                              department: e.target.value,
                            })
                          }
                          className="w-full px-4 py-3 outline-none"
                          style={{
                            background: "#FDFDFD",
                            border: "2px solid rgba(12, 12, 12, 0.08)",
                            borderRadius: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                          data-testid="input-department"
                        />
                      </div>
                      <div className="flex-1">
                        <label
                          className="block mb-2"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.01em",
                            color: "#686A6E",
                          }}
                        >
                          직급
                        </label>
                        <Select
                          value={createAccountForm.position}
                          onValueChange={(value) =>
                            setCreateAccountForm({
                              ...createAccountForm,
                              position: value,
                            })
                          }
                        >
                          <SelectTrigger
                            className="w-full px-4 py-3 outline-none"
                            style={{
                              background: "#FDFDFD",
                              border: "2px solid rgba(12, 12, 12, 0.08)",
                              borderRadius: "8px",
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 400,
                              letterSpacing: "-0.02em",
                              color: "rgba(12, 12, 12, 0.9)",
                              height: "48px",
                            }}
                            data-testid="select-position"
                          >
                            <SelectValue placeholder="직급 선택" />
                          </SelectTrigger>
                          <SelectContent className="z-[10001]">
                            <SelectItem value="사원">사원</SelectItem>
                            <SelectItem value="주임">주임</SelectItem>
                            <SelectItem value="대리">대리</SelectItem>
                            <SelectItem value="과장">과장</SelectItem>
                            <SelectItem value="차장">차장</SelectItem>
                            <SelectItem value="부장">부장</SelectItem>
                            <SelectItem value="이사">이사</SelectItem>
                            <SelectItem value="상무">상무</SelectItem>
                            <SelectItem value="전무">전무</SelectItem>
                            <SelectItem value="부사장">부사장</SelectItem>
                            <SelectItem value="사장">사장</SelectItem>
                            <SelectItem value="대표이사">대표이사</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex-1">
                        <label
                          className="block mb-2"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.01em",
                            color: "#686A6E",
                          }}
                        >
                          사무실 전화
                        </label>
                        <input
                          type="tel"
                          placeholder="-빼고 입력"
                          value={createAccountForm.office}
                          onChange={(e) =>
                            setCreateAccountForm({
                              ...createAccountForm,
                              office: e.target.value,
                            })
                          }
                          className="w-full px-4 py-3 outline-none"
                          style={{
                            background: "#FDFDFD",
                            border: "2px solid rgba(12, 12, 12, 0.08)",
                            borderRadius: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                          data-testid="input-office"
                        />
                      </div>
                    </div>

                    {/* 협력사 정보: Row 2 - 은행 선택, 계좌번호, 예금주 */}
                    <div className="flex gap-3" style={{ width: "100%" }}>
                      <div className="flex-1">
                        <label
                          className="block mb-2"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.01em",
                            color: "#686A6E",
                          }}
                        >
                          은행 선택
                        </label>
                        <div className="relative">
                          <select
                            value={createAccountForm.bankName}
                            onChange={(e) =>
                              setCreateAccountForm({
                                ...createAccountForm,
                                bankName: e.target.value,
                              })
                            }
                            className="w-full px-4 pr-8 appearance-none cursor-pointer outline-none"
                            style={{
                              height: "46px",
                              background: "#FDFDFD",
                              border: "2px solid rgba(12, 12, 12, 0.08)",
                              borderRadius: "8px",
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 400,
                              letterSpacing: "-0.02em",
                              color: "rgba(12, 12, 12, 0.9)",
                            }}
                            data-testid="select-bank"
                          >
                            <option value="">은행명</option>
                            <option value="KB국민은행">KB국민은행</option>
                            <option value="신한은행">신한은행</option>
                            <option value="우리은행">우리은행</option>
                            <option value="하나은행">하나은행</option>
                            <option value="NH농협은행">NH농협은행</option>
                            <option value="IBK기업은행">IBK기업은행</option>
                            <option value="SC제일은행">SC제일은행</option>
                            <option value="카카오뱅크">카카오뱅크</option>
                            <option value="토스뱅크">토스뱅크</option>
                            <option value="MG새마을금고">MG새마을금고</option>
                            <option value="광주은행">광주은행</option>
                          </select>
                          <ChevronDown
                            size={22}
                            className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
                            style={{ color: "rgba(12, 12, 12, 0.6)" }}
                          />
                        </div>
                      </div>
                      <div className="flex-1">
                        <label
                          className="block mb-2"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.01em",
                            color: "#686A6E",
                          }}
                        >
                          계좌번호
                        </label>
                        <input
                          type="text"
                          placeholder="'-' 빼고 입력"
                          value={createAccountForm.accountNumber}
                          onChange={(e) =>
                            setCreateAccountForm({
                              ...createAccountForm,
                              accountNumber: e.target.value,
                            })
                          }
                          className="w-full px-4 py-3 outline-none"
                          style={{
                            background: "#FDFDFD",
                            border: "2px solid rgba(12, 12, 12, 0.08)",
                            borderRadius: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                          data-testid="input-account-number"
                        />
                      </div>
                      <div className="flex-1">
                        <label
                          className="block mb-2"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.01em",
                            color: "#686A6E",
                          }}
                        >
                          예금주
                        </label>
                        <input
                          type="text"
                          placeholder="예금주"
                          value={createAccountForm.accountHolder}
                          onChange={(e) =>
                            setCreateAccountForm({
                              ...createAccountForm,
                              accountHolder: e.target.value,
                            })
                          }
                          className="w-full px-4 py-3 outline-none"
                          style={{
                            background: "#FDFDFD",
                            border: "2px solid rgba(12, 12, 12, 0.08)",
                            borderRadius: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                          data-testid="input-account-holder"
                        />
                      </div>
                    </div>

                    {/* 협력사 정보: Row 2.5 - 사업자 등록번호 + 대표자 명 */}
                    <div className="flex gap-4" style={{ width: "100%" }}>
                      <div style={{ flex: 1 }}>
                        <label
                          className="block mb-2"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.01em",
                            color: "#686A6E",
                          }}
                        >
                          사업자 등록번호
                        </label>
                        <input
                          type="text"
                          placeholder="사업자 등록번호 입력 (예: 123-45-67890)"
                          value={createAccountForm.businessRegistrationNumber}
                          onChange={(e) =>
                            setCreateAccountForm({
                              ...createAccountForm,
                              businessRegistrationNumber: e.target.value,
                            })
                          }
                          className="w-full px-4 py-3 outline-none"
                          style={{
                            background: "#FDFDFD",
                            border: "2px solid rgba(12, 12, 12, 0.08)",
                            borderRadius: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                          data-testid="input-business-registration-number"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label
                          className="block mb-2"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.01em",
                            color: "#686A6E",
                          }}
                        >
                          대표자 명
                        </label>
                        <input
                          type="text"
                          placeholder="대표자 명 입력"
                          value={createAccountForm.representativeName}
                          onChange={(e) =>
                            setCreateAccountForm({
                              ...createAccountForm,
                              representativeName: e.target.value,
                            })
                          }
                          className="w-full px-4 py-3 outline-none"
                          style={{
                            background: "#FDFDFD",
                            border: "2px solid rgba(12, 12, 12, 0.08)",
                            borderRadius: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                          data-testid="input-representative-name"
                        />
                      </div>
                    </div>

                    {/* 협력사 정보: Row 3 - 주소 (full width) */}
                    <div style={{ width: "100%" }}>
                      <label
                        className="block mb-2"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        주소
                      </label>
                      <input
                        type="text"
                        placeholder="클릭하여 주소 검색"
                        value={createAccountForm.address}
                        onClick={() => setShowAddressSearch(true)}
                        readOnly
                        className="w-full px-4 py-3 outline-none cursor-pointer"
                        style={{
                          background: "#FDFDFD",
                          border: "2px solid rgba(12, 12, 12, 0.08)",
                          borderRadius: "8px",
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.02em",
                          color: "rgba(12, 12, 12, 0.9)",
                        }}
                        data-testid="input-address"
                      />
                      {/* 다음 포스트코드 주소 검색 */}
                      {showAddressSearch && (
                        <div 
                          style={{
                            marginTop: '8px',
                            border: '1px solid rgba(12, 12, 12, 0.12)',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            position: 'relative',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setShowAddressSearch(false)}
                            style={{
                              position: 'absolute',
                              right: '8px',
                              top: '8px',
                              zIndex: 10,
                              background: 'white',
                              border: '1px solid #ddd',
                              borderRadius: '4px',
                              padding: '4px 8px',
                              cursor: 'pointer',
                              fontSize: '12px',
                            }}
                          >
                            닫기
                          </button>
                          <div
                            ref={(el) => {
                              if (el && (window as any).daum?.Postcode) {
                                el.innerHTML = '';
                                new (window as any).daum.Postcode({
                                  oncomplete: function(data: any) {
                                    let fullAddress = data.address;
                                    let extraAddress = '';
                                    
                                    if (data.addressType === 'R') {
                                      if (data.bname !== '') {
                                        extraAddress += data.bname;
                                      }
                                      if (data.buildingName !== '') {
                                        extraAddress += (extraAddress !== '' ? ', ' + data.buildingName : data.buildingName);
                                      }
                                      fullAddress += (extraAddress !== '' ? ` (${extraAddress})` : '');
                                    }
                                    
                                    setCreateAccountForm({
                                      ...createAccountForm,
                                      address: fullAddress,
                                    });
                                    setShowAddressSearch(false);
                                  },
                                  width: '100%',
                                  height: 400,
                                }).embed(el);
                                const noticeBar = el.querySelector('.postcode_search_announce');
                                if (noticeBar) (noticeBar as HTMLElement).style.display = 'none';
                                setTimeout(() => {
                                  const iframes = el.querySelectorAll('iframe');
                                  iframes.forEach((iframe: HTMLIFrameElement) => {
                                    try {
                                      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                                      if (iframeDoc) {
                                        const style = iframeDoc.createElement('style');
                                        style.textContent = '.postcode_search_announce, .postcode_banner, [class*="announce"], [class*="banner"] { display: none !important; }';
                                        iframeDoc.head.appendChild(style);
                                      }
                                    } catch(e) {}
                                  });
                                }, 500);
                              }
                            }}
                            style={{ width: '100%', height: '400px' }}
                          />
                        </div>
                      )}
                      {/* 상세주소 입력 */}
                      <input
                        type="text"
                        placeholder="상세주소 입력 (동/호수 등)"
                        value={createAccountForm.addressDetail}
                        onChange={(e) =>
                          setCreateAccountForm({
                            ...createAccountForm,
                            addressDetail: e.target.value,
                          })
                        }
                        className="w-full px-4 py-3 outline-none mt-2"
                        style={{
                          background: "#FDFDFD",
                          border: "2px solid rgba(12, 12, 12, 0.08)",
                          borderRadius: "8px",
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.02em",
                          color: "rgba(12, 12, 12, 0.9)",
                        }}
                        data-testid="input-address-detail"
                      />
                    </div>

                    {/* 협력사 정보: Row 4 - 출동가능지역선택 */}
                    <div style={{ width: "100%" }}>
                      <label
                        className="block mb-2"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        출동가능지역선택
                      </label>
                      <div
                        className="px-4 py-3 cursor-pointer flex flex-wrap gap-2 min-h-[46px]"
                        style={{
                          background: "#FDFDFD",
                          border: "2px solid rgba(12, 12, 12, 0.08)",
                          borderRadius: "8px",
                        }}
                        onClick={() => {
                          setTempSelectedRegions([
                            ...createAccountForm.serviceRegions,
                          ]);
                          setShowRegionModal(true);
                        }}
                        data-testid="button-region-selector"
                      >
                        {createAccountForm.serviceRegions.length === 0 ? (
                          <span
                            style={{
                              fontFamily: "Pretendard",
                              fontSize: "14px",
                              fontWeight: 400,
                              letterSpacing: "-0.02em",
                              color: "rgba(12, 12, 12, 0.4)",
                            }}
                          >
                            지역 선택
                          </span>
                        ) : (
                          createAccountForm.serviceRegions.map(
                            (region, idx) => (
                              <div
                                key={idx}
                                className="px-3 py-1"
                                style={{
                                  background: "#E3F2FD",
                                  borderRadius: "6px",
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCreateAccountForm({
                                    ...createAccountForm,
                                    serviceRegions:
                                      createAccountForm.serviceRegions.filter(
                                        (_, i) => i !== idx,
                                      ),
                                  });
                                }}
                              >
                                <span
                                  style={{
                                    fontFamily: "Pretendard",
                                    fontSize: "13px",
                                    fontWeight: 400,
                                    color: "#008FED",
                                  }}
                                >
                                  {region} ×
                                </span>
                              </div>
                            ),
                          )
                        )}
                      </div>
                    </div>

                    {/* 협력사 정보: Row 5 - 첨부파일 */}
                    <div style={{ width: "100%" }}>
                      <label
                        className="block mb-2"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        첨부파일
                      </label>
                      <input
                        type="file"
                        id="file-upload-input"
                        multiple
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          if (files.length > 0) {
                            const fileEntries = files.map((f) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file: f }));
                            setCreateAccountForm({
                              ...createAccountForm,
                              attachments: [
                                ...createAccountForm.attachments,
                                ...fileEntries.map((e) => e.id),
                              ],
                            });
                            setPendingFileReads((c) => c + files.length);
                            fileEntries.forEach(({ id, file }) => {
                              const reader = new FileReader();
                              reader.onload = (ev) => {
                                const dataUrl = ev.target?.result as string;
                                setAttachmentFilesData((prev) => [...prev, { id, name: file.name, data: dataUrl, type: file.type }]);
                                setPendingFileReads((c) => c - 1);
                              };
                              reader.readAsDataURL(file);
                            });
                          }
                          e.target.value = "";
                        }}
                        data-testid="input-file-upload"
                      />
                      <div
                        className="flex flex-col items-center justify-center cursor-pointer"
                        style={{
                          width: "100%",
                          minHeight: "120px",
                          background: "#F8FCFF",
                          border: "2px dashed rgba(0, 143, 237, 0.3)",
                          borderRadius: "8px",
                        }}
                        onClick={() => {
                          document.getElementById("file-upload-input")?.click();
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget.style.background =
                            "rgba(0, 143, 237, 0.05)";
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget.style.background = "#F8FCFF";
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget.style.background = "#F8FCFF";

                          const files = Array.from(e.dataTransfer.files || []);
                          if (files.length > 0) {
                            const fileEntries = files.map((f) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file: f }));
                            setCreateAccountForm({
                              ...createAccountForm,
                              attachments: [
                                ...createAccountForm.attachments,
                                ...fileEntries.map((e) => e.id),
                              ],
                            });
                            setPendingFileReads((c) => c + files.length);
                            fileEntries.forEach(({ id, file }) => {
                              const reader = new FileReader();
                              reader.onload = (ev) => {
                                const dataUrl = ev.target?.result as string;
                                setAttachmentFilesData((prev) => [...prev, { id, name: file.name, data: dataUrl, type: file.type }]);
                                setPendingFileReads((c) => c - 1);
                              };
                              reader.readAsDataURL(file);
                            });
                          }
                        }}
                        data-testid="file-upload-area"
                      >
                        {createAccountForm.attachments.length === 0 ? (
                          <div className="flex flex-col items-center gap-2 py-4">
                            <div
                              className="flex items-center justify-center"
                              style={{
                                width: "48px",
                                height: "48px",
                                background: "rgba(0, 143, 237, 0.1)",
                                borderRadius: "50%",
                              }}
                            >
                              <Upload size={24} style={{ color: "#008FED" }} />
                            </div>
                            <span
                              style={{
                                fontFamily: "Pretendard",
                                fontSize: "14px",
                                fontWeight: 400,
                                color: "#686A6E",
                              }}
                            >
                              파일 또는 이미지를 이곳에 올려주세요
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2 w-full p-4">
                            {createAccountForm.attachments.map(
                              (fileId, idx) => {
                                const fileInfo = attachmentFilesData.find((f) => f.id === fileId);
                                const displayName = fileInfo ? fileInfo.name : fileId;
                                return (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between px-3 py-2"
                                    style={{
                                      background: "#FFFFFF",
                                      border: "1px solid rgba(0, 143, 237, 0.2)",
                                      borderRadius: "6px",
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    data-testid={`file-item-${idx}`}
                                  >
                                    <span
                                      style={{
                                        fontFamily: "Pretendard",
                                        fontSize: "13px",
                                        fontWeight: 400,
                                        color: "#0C0C0C",
                                      }}
                                    >
                                      {displayName}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setCreateAccountForm({
                                          ...createAccountForm,
                                          attachments:
                                            createAccountForm.attachments.filter(
                                              (_, i) => i !== idx,
                                            ),
                                        });
                                        setAttachmentFilesData((prev) => prev.filter((f) => f.id !== fileId));
                                      }}
                                      data-testid={`button-remove-file-${idx}`}
                                    >
                                      <X size={16} style={{ color: "#686A6E" }} />
                                    </button>
                                  </div>
                                );
                              },
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  /* 다른 역할: 회사명, 소속부서, 직급, 사무실 전화 */
                  (<div className="flex gap-3" style={{ width: "100%" }}>
                    <div className="flex-1">
                      <label
                        className="block mb-2"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        회사명
                      </label>
                      <input
                        type="text"
                        placeholder="회사명"
                        value={createAccountForm.company}
                        onChange={(e) =>
                          setCreateAccountForm({
                            ...createAccountForm,
                            company: e.target.value,
                          })
                        }
                        className="w-full px-4 py-3 outline-none"
                        style={{
                          background: "#FDFDFD",
                          border: "2px solid rgba(12, 12, 12, 0.08)",
                          borderRadius: "8px",
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.02em",
                          color: "rgba(12, 12, 12, 0.9)",
                        }}
                        data-testid="input-company"
                      />
                    </div>
                    <div className="flex-1">
                      <label
                        className="block mb-2"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        소속부서
                      </label>
                      <input
                        type="text"
                        placeholder="소속부서"
                        value={createAccountForm.department}
                        onChange={(e) =>
                          setCreateAccountForm({
                            ...createAccountForm,
                            department: e.target.value,
                          })
                        }
                        className="w-full px-4 py-3 outline-none"
                        style={{
                          background: "#FDFDFD",
                          border: "2px solid rgba(12, 12, 12, 0.08)",
                          borderRadius: "8px",
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.02em",
                          color: "rgba(12, 12, 12, 0.9)",
                        }}
                        data-testid="input-department"
                      />
                    </div>
                    <div className="flex-1">
                      <label
                        className="block mb-2"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        직급
                      </label>
                      <Select
                        value={createAccountForm.position}
                        onValueChange={(value) =>
                          setCreateAccountForm({
                            ...createAccountForm,
                            position: value,
                          })
                        }
                      >
                        <SelectTrigger
                          className="w-full px-4 py-3 outline-none"
                          style={{
                            background: "#FDFDFD",
                            border: "2px solid rgba(12, 12, 12, 0.08)",
                            borderRadius: "8px",
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                            height: "48px",
                          }}
                          data-testid="select-position"
                        >
                          <SelectValue placeholder="직급 선택" />
                        </SelectTrigger>
                        <SelectContent className="z-[10001]">
                          <SelectItem value="사원">사원</SelectItem>
                          <SelectItem value="주임">주임</SelectItem>
                          <SelectItem value="대리">대리</SelectItem>
                          <SelectItem value="과장">과장</SelectItem>
                          <SelectItem value="차장">차장</SelectItem>
                          <SelectItem value="부장">부장</SelectItem>
                          <SelectItem value="이사">이사</SelectItem>
                          <SelectItem value="상무">상무</SelectItem>
                          <SelectItem value="전무">전무</SelectItem>
                          <SelectItem value="부사장">부사장</SelectItem>
                          <SelectItem value="사장">사장</SelectItem>
                          <SelectItem value="대표이사">대표이사</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      <label
                        className="block mb-2"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        사무실 전화
                      </label>
                      <input
                        type="tel"
                        placeholder="-빼고 입력"
                        value={createAccountForm.office}
                        onChange={(e) =>
                          setCreateAccountForm({
                            ...createAccountForm,
                            office: e.target.value,
                          })
                        }
                        className="w-full px-4 py-3 outline-none"
                        style={{
                          background: "#FDFDFD",
                          border: "2px solid rgba(12, 12, 12, 0.08)",
                          borderRadius: "8px",
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 400,
                          letterSpacing: "-0.02em",
                          color: "rgba(12, 12, 12, 0.9)",
                        }}
                        data-testid="input-office"
                      />
                    </div>
                  </div>)
                )}
              </div>
            </div>

            {/* Footer with Buttons */}
            <div
              className="flex flex-row justify-between items-center px-6 py-4"
              style={{
                background: "#FDFDFD",
                borderTop: "1px solid rgba(12, 12, 12, 0.08)",
              }}
            >
              <button
                className="flex items-center justify-center hover-elevate active-elevate-2"
                style={{
                  height: "48px",
                  padding: "0 24px",
                  background: "transparent",
                  borderRadius: "6px",
                }}
                onClick={() => {
                  setCreateAccountForm({
                    role: "보험사",
                    accountType: "개인",
                    isSuperAdmin: false,
                    name: "",
                    company: "",
                    department: "",
                    position: "",
                    email: "",
                    username: "",
                    password: "",
                    phone: "",
                    office: "",
                    address: "",
                    addressDetail: "",
                    businessRegistrationNumber: "",
                    representativeName: "",
                    bankName: "",
                    accountNumber: "",
                    accountHolder: "",
                    serviceRegions: [] as string[],
                    attachments: [] as string[],
                  });
                  setAttachmentFilesData([]);
                  setPendingFileReads(0);
                  setRegionSearchTerm("");
                }}
                data-testid="button-reset-form"
              >
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                    color: "#0C0C0C4D",
                  }}
                >
                  초기화
                </span>
              </button>

              <button
                type="button"
                className="flex items-center justify-center hover-elevate active-elevate-2"
                style={{
                  height: "48px",
                  padding: "0 32px",
                  background: "#008FED",
                  borderRadius: "6px",
                }}
                onClick={() => {
                  // Validate required fields
                  if (
                    !createAccountForm.name ||
                    !createAccountForm.company ||
                    !createAccountForm.username
                  ) {
                    toast({
                      variant: "destructive",
                      title: "입력 오류",
                      description: "필수 항목을 모두 입력해주세요.",
                    });
                    return;
                  }

                  // Set default password
                  setGeneratedPassword("0000");

                  // Close account creation modal and show password generation modal
                  setShowCreateAccountModal(false);
                  setShowAccountCreatedModal(true);
                }}
                data-testid="button-generate-password"
              >
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    color: "#FDFDFD",
                  }}
                >
                  비밀번호 생성
                </span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Account Created Modal */}
      {showAccountCreatedModal && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-50"
            style={{
              background: "rgba(0, 0, 0, 0.7)",
              opacity: 0.4,
            }}
            onClick={() => setShowCancelConfirmModal(true)}
            data-testid="modal-overlay-account-created"
          />

          {/* Modal */}
          <div
            className="fixed z-50 bg-white flex flex-col"
            style={{
              width: "747px",
              height: "440px",
              left: "calc(50% - 747px/2 + 0.5px)",
              top: "calc(50% - 440px/2 + 0.5px)",
              boxShadow: "0px -2px 70px rgba(179, 193, 205, 0.8)",
              borderRadius: "12px",
              gap: "32px",
            }}
            data-testid="modal-account-created"
          >
            {/* Content */}
            <div
              className="flex flex-col items-center"
              style={{
                width: "747px",
                height: "320px",
                gap: "16px",
              }}
            >
              {/* Header */}
              <div
                className="flex flex-row justify-center items-center"
                style={{
                  width: "747px",
                  height: "60px",
                  gap: "321px",
                }}
              >
                <h2
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "18px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "#0C0C0C",
                  }}
                >
                  비밀번호 생성
                </h2>
              </div>

              {/* Body */}
              <div
                className="flex flex-col"
                style={{
                  width: "707px",
                  height: "244px",
                  gap: "20px",
                }}
              >
                {/* Profile Card Section */}
                <div
                  className="flex flex-col"
                  style={{
                    width: "707px",
                    height: "114px",
                    gap: "20px",
                  }}
                >
                  {/* Section Title */}
                  <div
                    className="flex flex-row"
                    style={{ width: "707px", height: "18px", gap: "2px" }}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "14px",
                        fontWeight: 500,
                        letterSpacing: "-0.01em",
                        color: "#686A6E",
                      }}
                    >
                      생성 계정
                    </span>
                  </div>

                  {/* Profile Card */}
                  <div
                    className="flex flex-col justify-center p-5"
                    style={{
                      width: "707px",
                      height: "88px",
                      background: "rgba(12, 12, 12, 0.04)",
                      backdropFilter: "blur(7px)",
                      borderRadius: "12px",
                      gap: "8px",
                    }}
                  >
                    {/* Top row: Name, Company, Role */}
                    <div
                      className="flex flex-row items-center"
                      style={{
                        width: "667px",
                        height: "26px",
                        gap: "16px",
                      }}
                    >
                      <div className="flex flex-row items-center gap-2.5">
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "18px",
                            fontWeight: 600,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {createAccountForm.name}
                        </span>
                        <div
                          style={{
                            width: "4px",
                            height: "4px",
                            background: "rgba(0, 143, 237, 0.9)",
                            borderRadius: "50%",
                          }}
                        />
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "18px",
                            fontWeight: 600,
                            letterSpacing: "-0.02em",
                            color: "rgba(12, 12, 12, 0.9)",
                          }}
                        >
                          {createAccountForm.company}
                        </span>
                      </div>
                      <div
                        className="flex items-center justify-center px-2.5"
                        style={{
                          height: "26px",
                          background: "rgba(12, 12, 12, 0.1)",
                          backdropFilter: "blur(7px)",
                          borderRadius: "20px",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            fontWeight: 400,
                            letterSpacing: "-0.01em",
                            color: "rgba(12, 12, 12, 0.7)",
                          }}
                        >
                          {createAccountForm.role}
                        </span>
                      </div>
                    </div>

                    {/* Bottom row: Username, Phone */}
                    <div
                      className="flex flex-row"
                      style={{
                        width: "400px",
                        height: "20px",
                        gap: "24px",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 400,
                          letterSpacing: "-0.02em",
                          color: "rgba(12, 12, 12, 0.7)",
                        }}
                      >
                        {createAccountForm.username}
                      </span>
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 400,
                          letterSpacing: "-0.02em",
                          color: "rgba(12, 12, 12, 0.7)",
                        }}
                      >
                        {createAccountForm.phone || "010-0000-0000"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Password Section */}
                <div
                  className="flex flex-col"
                  style={{
                    width: "707px",
                    height: "110px",
                    gap: "10px",
                  }}
                >
                  <div
                    className="flex flex-col"
                    style={{ width: "419px", height: "76px", gap: "8px" }}
                  >
                    <div
                      className="flex flex-row"
                      style={{ width: "419px", height: "18px", gap: "2px" }}
                    >
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 500,
                          letterSpacing: "-0.01em",
                          color: "#686A6E",
                        }}
                      >
                        비밀번호 생성(자동)
                      </span>
                    </div>

                    {/* Input Field */}
                    <div
                      className="flex flex-row items-center"
                      style={{ width: "419px", height: "50px" }}
                    >
                      <input
                        type="text"
                        value={generatedPassword}
                        onChange={(e) => setGeneratedPassword(e.target.value)}
                        className="flex flex-row items-center"
                        style={{
                          width: "100%",
                          height: "50px",
                          padding: "10px 20px",
                          background: "#FDFDFD",
                          border: "2px solid rgba(12, 12, 12, 0.08)",
                          borderRadius: "8px",
                          fontFamily: "Pretendard",
                          fontSize: "16px",
                          fontWeight: 600,
                          letterSpacing: "-0.02em",
                          color: "#0C0C0C",
                          outline: "none",
                        }}
                        data-testid="input-password"
                      />
                    </div>
                  </div>

                  {/* Notification Options */}
                  <div
                    className="flex flex-row items-center"
                    style={{
                      gap: "32px",
                    }}
                  >
                    {/* Email notification checkbox */}
                    <div
                      className="flex flex-row items-center cursor-pointer"
                      style={{ gap: "6px" }}
                      onClick={() =>
                        setSendEmailNotification(!sendEmailNotification)
                      }
                    >
                      <div
                        style={{
                          width: "24px",
                          height: "24px",
                          border: "2px solid rgba(12, 12, 12, 0.24)",
                          borderRadius: "4px",
                          background: sendEmailNotification
                            ? "#008FED"
                            : "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {sendEmailNotification && (
                          <span style={{ color: "white", fontSize: "16px" }}>
                            ✓
                          </span>
                        )}
                      </div>
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 500,
                          letterSpacing: "-0.01em",
                          color: "rgba(12, 12, 12, 0.8)",
                        }}
                      >
                        이메일로 안내 발송
                      </span>
                    </div>

                    {/* SMS notification checkbox */}
                    <div
                      className="flex flex-row items-center cursor-pointer"
                      style={{ gap: "6px" }}
                      onClick={() =>
                        setSendSmsNotification(!sendSmsNotification)
                      }
                    >
                      <div
                        style={{
                          width: "24px",
                          height: "24px",
                          border: "2px solid rgba(12, 12, 12, 0.24)",
                          borderRadius: "4px",
                          background: sendSmsNotification
                            ? "#008FED"
                            : "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {sendSmsNotification && (
                          <span style={{ color: "white", fontSize: "16px" }}>
                            ✓
                          </span>
                        )}
                      </div>
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          fontWeight: 500,
                          letterSpacing: "-0.01em",
                          color: "rgba(12, 12, 12, 0.8)",
                        }}
                      >
                        문자로 안내 발송
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer with Buttons */}
            <div
              className="flex flex-col items-start p-5"
              style={{
                width: "747px",
                height: "88px",
                background: "#FDFDFD",
                borderTop: "1px solid rgba(12, 12, 12, 0.08)",
                gap: "10px",
              }}
            >
              <div
                className="flex flex-row justify-between items-center"
                style={{
                  width: "707px",
                  height: "48px",
                }}
              >
                {/* Cancel Button */}
                <button
                  className="flex-1 flex items-center justify-center"
                  style={{
                    height: "48px",
                    borderRadius: "6px",
                  }}
                  onClick={() => {
                    setShowAccountCreatedModal(false);
                    setSendEmailNotification(false);
                    setSendSmsNotification(false);
                    setGeneratedPassword("0000");
                  }}
                  data-testid="button-cancel-account-created"
                >
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 500,
                      letterSpacing: "-0.02em",
                      color: "#D02B20",
                    }}
                  >
                    취소
                  </span>
                </button>

                {/* Confirm Button */}
                <button
                  className="flex-1 flex items-center justify-center"
                  style={{
                    height: "48px",
                    background: "#008FED",
                    borderRadius: "6px",
                  }}
                  onClick={async () => {
                    try {
                      // Call create account API with user-entered password
                      if (pendingFileReads > 0) {
                        toast({ variant: "destructive", title: "파일 업로드 중", description: "파일 읽기가 완료될 때까지 잠시 기다려주세요." });
                        return;
                      }
                      const attachmentsWithData = createAccountForm.attachments.map((fileId) => {
                        const fileData = attachmentFilesData.find((f) => f.id === fileId);
                        if (fileData) {
                          return JSON.stringify({ name: fileData.name, data: fileData.data, type: fileData.type });
                        }
                        return fileId;
                      });
                      await apiRequest("POST", "/api/create-account", {
                        ...createAccountForm,
                        attachments: attachmentsWithData,
                        password: generatedPassword,
                      });

                      // Invalidate users query to refetch from server
                      await queryClient.invalidateQueries({
                        queryKey: ["/api/users"],
                      });

                      // Send notifications if requested
                      let notificationResult = { emailSent: false, smsSent: false };
                      if (sendEmailNotification || sendSmsNotification) {
                        try {
                          const response = await apiRequest("POST", "/api/send-account-notification", {
                            sendEmail: sendEmailNotification,
                            sendSms: sendSmsNotification,
                            email: createAccountForm.email,
                            phone: createAccountForm.phone,
                            name: createAccountForm.name,
                            username: createAccountForm.username,
                            password: generatedPassword,
                            role: createAccountForm.role,
                            company: createAccountForm.company,
                          });
                          const result = await response.json() as { emailSent?: boolean; smsSent?: boolean };
                          notificationResult = {
                            emailSent: result.emailSent || false,
                            smsSent: result.smsSent || false,
                          };
                        } catch (notifyError) {
                          console.error("Notification send error:", notifyError);
                        }
                      }

                      // Show success message
                      let description = `${createAccountForm.name}님의 계정이 생성되었습니다. 초기 비밀번호: ${generatedPassword}`;
                      if (notificationResult.emailSent && notificationResult.smsSent) {
                        description += "\n이메일과 문자로 안내가 발송되었습니다.";
                      } else if (notificationResult.emailSent) {
                        description += "\n이메일로 안내가 발송되었습니다.";
                      } else if (notificationResult.smsSent) {
                        description += "\n문자로 안내가 발송되었습니다.";
                      } else if (sendEmailNotification || sendSmsNotification) {
                        description += "\n안내 발송에 실패했습니다. (이메일/전화번호를 확인해주세요)";
                      }

                      toast({
                        title: "계정 생성 완료",
                        description,
                      });

                      // Close modals and reset form
                      setShowAccountCreatedModal(false);
                      setShowCreateAccountModal(false);
                      setSendEmailNotification(false);
                      setSendSmsNotification(false);
                      setGeneratedPassword("0000");
                      setCreateAccountForm({
                        role: "보험사",
                        accountType: "개인",
                        isSuperAdmin: false,
                        name: "",
                        company: "",
                        department: "",
                        position: "",
                        email: "",
                        username: "",
                        password: "",
                        phone: "",
                        office: "",
                        address: "",
                        addressDetail: "",
                        businessRegistrationNumber: "",
                        representativeName: "",
                        bankName: "",
                        accountNumber: "",
                        accountHolder: "",
                        serviceRegions: [] as string[],
                        attachments: [] as string[],
                      });
                      setAttachmentFilesData([]);
                      setPendingFileReads(0);
                      setRegionSearchTerm("");
                    } catch (error: any) {
                      console.error("Failed to create account:", error);

                      // Show error message
                      const errorMessage =
                        error?.error ||
                        error?.message ||
                        "계정 생성 중 오류가 발생했습니다.";
                      toast({
                        variant: "destructive",
                        title: "계정 생성 실패",
                        description: errorMessage,
                      });
                    }
                  }}
                  data-testid="button-confirm-account-created"
                >
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: "#FDFDFD",
                    }}
                  >
                    완료
                  </span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelConfirmModal && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0"
            style={{
              background: "rgba(0, 0, 0, 0.7)",
              opacity: 0.4,
              zIndex: 10001,
            }}
            onClick={() => setShowCancelConfirmModal(false)}
            data-testid="modal-overlay-cancel-confirm"
          />

          {/* Modal */}
          <div
            className="fixed flex flex-col items-center"
            style={{
              width: "400px",
              height: "199px",
              left: "calc(50% - 400px/2)",
              top: "calc(50% - 199px/2)",
              background: "#FFFFFF",
              boxShadow: "0px -2px 70px rgba(179, 193, 205, 0.8)",
              borderRadius: "12px",
              padding: "32px 0px 0px",
              gap: "24px",
              zIndex: 10002,
              boxSizing: "border-box",
            }}
            onClick={(e) => e.stopPropagation()}
            data-testid="modal-cancel-confirm"
          >
            {/* Content */}
            <div
              className="flex flex-col items-center"
              style={{
                width: "222px",
                height: "55px",
                gap: "8px",
              }}
            >
              <h2
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "18px",
                  fontWeight: 600,
                  lineHeight: "148%",
                  textAlign: "center",
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                }}
              >
                계정 생성을 그만두시겠습니까?
              </h2>
              <p
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: 500,
                  lineHeight: "128%",
                  textAlign: "center",
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.8)",
                }}
              >
                지금 나가면 모든 입력이 사라집니다.
              </p>
            </div>

            {/* Footer with Buttons */}
            <div
              className="flex flex-col items-start p-5"
              style={{
                width: "400px",
                height: "88px",
                background: "#FDFDFD",
                borderTop: "1px solid rgba(12, 12, 12, 0.08)",
                gap: "10px",
              }}
            >
              <div
                className="flex flex-row justify-between items-center"
                style={{
                  width: "360px",
                  height: "48px",
                }}
              >
                {/* Cancel Button */}
                <button
                  className="flex-1 flex items-center justify-center"
                  style={{
                    height: "48px",
                    borderRadius: "6px",
                  }}
                  onClick={() => setShowCancelConfirmModal(false)}
                  data-testid="button-cancel-confirm-cancel"
                >
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 500,
                      letterSpacing: "-0.02em",
                      color: "#D02B20",
                    }}
                  >
                    취소
                  </span>
                </button>

                {/* Confirm Exit Button */}
                <button
                  className="flex-1 flex items-center justify-center"
                  style={{
                    height: "48px",
                    background: "#008FED",
                    borderRadius: "6px",
                  }}
                  onClick={() => {
                    // Close all modals and reset form
                    setShowCancelConfirmModal(false);
                    setShowAccountCreatedModal(false);
                    setShowCreateAccountModal(false);
                    setSendEmailNotification(false);
                    setSendSmsNotification(false);
                    setGeneratedPassword("0000");
                    setCreateAccountForm({
                      role: "보험사",
                      accountType: "개인",
                      isSuperAdmin: false,
                      name: "",
                      company: "",
                      department: "",
                      position: "",
                      email: "",
                      username: "",
                      password: "",
                      phone: "",
                      office: "",
                      address: "",
                      addressDetail: "",
                      businessRegistrationNumber: "",
                      representativeName: "",
                      bankName: "",
                      accountNumber: "",
                      accountHolder: "",
                      serviceRegions: [] as string[],
                      attachments: [] as string[],
                    });
                    setAttachmentFilesData([]);
                    setPendingFileReads(0);
                    setRegionSearchTerm("");
                  }}
                  data-testid="button-cancel-confirm-exit"
                >
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "16px",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: "#FDFDFD",
                    }}
                  >
                    나가기
                  </span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Region Selection Modal */}
      {showRegionModal && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 flex items-center justify-center"
            style={{
              background: "rgba(0, 0, 0, 0.28)",
              zIndex: 10001,
            }}
            onClick={() => setShowRegionModal(false)}
          />

          {/* Modal */}
          <div
            className="fixed flex flex-col"
            style={{
              width: "467px",
              height: "690px",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              background: "#FFFFFF",
              boxShadow: "0px -2px 70px rgba(179, 193, 205, 0.8)",
              borderRadius: "12px",
              zIndex: 10002,
            }}
            onClick={(e) => e.stopPropagation()}
            data-testid="modal-region-selector"
          >
            {/* Header */}
            <div
              className="flex flex-row justify-between items-center px-5 py-4"
              style={{
                height: "60px",
              }}
            >
              <h2
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "18px",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                }}
              >
                출동가능지역 검색
              </h2>
              <button
                className="flex items-center justify-center hover-elevate active-elevate-2"
                style={{
                  width: "24px",
                  height: "24px",
                }}
                onClick={() => setShowRegionModal(false)}
                data-testid="button-close-region-modal"
              >
                <X size={20} style={{ color: "#1C1B1F" }} />
              </button>
            </div>

            {/* Tab Headers */}
            <div
              className="flex flex-row mx-5 mt-4"
              style={{
                height: "39px",
                background: "#F5F5F5",
              }}
            >
              <div
                className="flex items-center px-3"
                style={{
                  width: "114px",
                }}
              >
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "15px",
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                    color: "#686A6E",
                  }}
                >
                  시/도
                </span>
              </div>
              <div className="flex-1 flex items-center px-3">
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "15px",
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                    color: "#686A6E",
                  }}
                >
                  군/구
                </span>
              </div>
            </div>

            {/* Selection Area */}
            <div
              className="flex flex-row mx-5 mt-0"
              style={{
                height: "342px",
                paddingTop: "6px",
              }}
            >
              {/* Province List */}
              <div
                className="flex flex-col overflow-y-auto"
                style={{
                  width: "114px",
                  borderRight: "1px solid rgba(12, 12, 12, 0.1)",
                  paddingRight: "12px",
                }}
              >
                {Object.keys(KOREA_REGIONS).map((province) => (
                  <button
                    key={province}
                    className="flex flex-row justify-between items-center px-3 py-2.5"
                    style={{
                      height: "44px",
                      background:
                        selectedProvince === province
                          ? "rgba(0, 143, 237, 0.1)"
                          : "transparent",
                    }}
                    onClick={() => setSelectedProvince(province)}
                    data-testid={`province-${province}`}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "15px",
                        fontWeight: selectedProvince === province ? 600 : 500,
                        letterSpacing:
                          selectedProvince === province ? "-0.02em" : "-0.01em",
                        color:
                          selectedProvince === province ? "#008FED" : "#686A6E",
                      }}
                    >
                      {province}
                    </span>
                    {selectedProvince === province && (
                      <ChevronRight size={20} style={{ color: "#008FED" }} />
                    )}
                  </button>
                ))}
              </div>

              {/* District List */}
              <div className="flex-1 flex flex-col overflow-y-auto px-3">
                {KOREA_REGIONS[selectedProvince]?.map((district) => {
                  const regionKey = `${selectedProvince} ${district}`;
                  const isSelected = tempSelectedRegions.includes(regionKey);

                  return (
                    <button
                      key={district}
                      className="flex items-center px-3 py-2.5"
                      style={{
                        height: "44px",
                        background: isSelected
                          ? "rgba(0, 143, 237, 0.1)"
                          : "transparent",
                      }}
                      onClick={() => {
                        if (isSelected) {
                          setTempSelectedRegions(
                            tempSelectedRegions.filter((r) => r !== regionKey),
                          );
                        } else {
                          setTempSelectedRegions([
                            ...tempSelectedRegions,
                            regionKey,
                          ]);
                        }
                      }}
                      data-testid={`district-${district}`}
                    >
                      <span
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "15px",
                          fontWeight: isSelected ? 600 : 500,
                          letterSpacing: isSelected ? "-0.02em" : "-0.01em",
                          color: isSelected ? "#008FED" : "#686A6E",
                        }}
                      >
                        {district}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected Tags Area */}
            <div
              className="flex flex-col mx-5 mt-4"
              style={{
                minHeight: "100px",
                maxHeight: "180px",
              }}
            >
              <div className="flex flex-wrap gap-2 overflow-y-auto">
                {tempSelectedRegions.map((region, idx) => (
                  <div
                    key={idx}
                    className="flex items-center px-3 py-1.5 gap-1"
                    style={{
                      background: "#E3F2FD",
                      borderRadius: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 400,
                        color: "#008FED",
                      }}
                    >
                      {region}
                    </span>
                    <button
                      onClick={() => {
                        setTempSelectedRegions(
                          tempSelectedRegions.filter((_, i) => i !== idx),
                        );
                      }}
                      className="ml-1"
                      style={{
                        color: "#008FED",
                        cursor: "pointer",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer Button */}
            <div
              className="flex justify-center items-center mx-5 mt-auto mb-5"
              style={{
                height: "48px",
              }}
            >
              <button
                className="w-full flex items-center justify-center"
                style={{
                  height: "48px",
                  background: "#008FED",
                  borderRadius: "6px",
                }}
                onClick={() => {
                  if (regionModalForEdit) {
                    setEditedUserData({
                      ...editedUserData,
                      serviceRegions: tempSelectedRegions,
                    });
                    setRegionModalForEdit(false);
                  } else {
                    setCreateAccountForm({
                      ...createAccountForm,
                      serviceRegions: tempSelectedRegions,
                    });
                  }
                  setShowRegionModal(false);
                }}
                data-testid="button-region-confirm"
              >
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "16px",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    color: "#FDFDFD",
                  }}
                >
                  완료
                </span>
              </button>
            </div>
          </div>
        </>
      )}
        </>
      )}
      {/* Add Notice Modal */}
      {showAddNoticeModal && (
        <>
          {/* Modal Overlay */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => {
              if (noticeTitle.trim() || noticeContent.trim()) {
                setShowNoticeCancelConfirmModal(true);
              } else {
                setShowAddNoticeModal(false);
                setNoticeTitle("");
                setNoticeContent("");
              }
            }}
            data-testid="modal-overlay-add-notice"
          />

          {/* Modal Panel */}
          <div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
            style={{
              width: "420px",
              background: "#FDFDFD",
              borderRadius: "12px",
              padding: "24px",
            }}
            data-testid="modal-add-notice"
          >
            {/* Title */}
            <h2
              className="mb-6"
              style={{
                fontFamily: "Pretendard",
                fontSize: "20px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "#0C0C0C",
              }}
            >
              공지사항 추가
            </h2>

            {/* Title Input */}
            <div className="mb-4">
              <label
                className="block mb-2"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                  color: "#0C0C0C",
                }}
              >
                제목
              </label>
              <input
                type="text"
                value={noticeTitle}
                onChange={(e) => setNoticeTitle(e.target.value)}
                placeholder="제목을 작성하세요"
                className="w-full px-4 py-3"
                style={{
                  background: "#FDFDFD",
                  border: "2px solid rgba(12, 12, 12, 0.08)",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  color: "#0C0C0C",
                }}
                data-testid="input-notice-title"
              />
            </div>

            {/* Content Input */}
            <div className="mb-2">
              <label
                className="block mb-2"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                  color: "#0C0C0C",
                }}
              >
                내용
              </label>
              <div className="relative">
                <textarea
                  value={noticeContent}
                  onChange={(e) => {
                    if (e.target.value.length <= 1000) {
                      setNoticeContent(e.target.value);
                    }
                  }}
                  placeholder="내용을 작성하세요"
                  rows={10}
                  className="w-full px-4 py-3 resize-none"
                  style={{
                    background: "#FDFDFD",
                    border: "2px solid rgba(12, 12, 12, 0.08)",
                    borderRadius: "8px",
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    color: "#0C0C0C",
                  }}
                  data-testid="textarea-notice-content"
                />
                <div
                  className="absolute bottom-3 right-3"
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "12px",
                    fontWeight: 400,
                    color: "#686A6E",
                  }}
                >
                  {noticeContent.length}/1000
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  if (noticeTitle.trim() || noticeContent.trim()) {
                    setShowNoticeCancelConfirmModal(true);
                  } else {
                    setShowAddNoticeModal(false);
                    setNoticeTitle("");
                    setNoticeContent("");
                  }
                }}
                className="flex-1 py-3"
                style={{
                  background: "#F5F5F5",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "#686A6E",
                }}
                data-testid="button-cancel-notice"
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (!noticeTitle.trim() || !noticeContent.trim()) {
                    toast({
                      title: "입력 오류",
                      description: "제목과 내용을 입력해주세요.",
                      variant: "destructive",
                    });
                    return;
                  }
                  setShowNoticeConfirmModal(true);
                }}
                className="flex-1 py-3"
                style={{
                  background: "#008FED",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "#FDFDFD",
                }}
                data-testid="button-submit-notice"
              >
                게시
              </button>
            </div>
          </div>
        </>
      )}
      {/* Notice Confirmation Modal */}
      {showNoticeConfirmModal && (
        <>
          {/* Modal Overlay */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-50"
            onClick={() => setShowNoticeConfirmModal(false)}
            data-testid="modal-overlay-confirm-notice"
          />

          {/* Modal Panel */}
          <div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
            style={{
              width: "480px",
              background: "#FDFDFD",
              borderRadius: "12px",
              padding: "32px",
            }}
            data-testid="modal-confirm-notice"
          >
            {/* Title */}
            <h2
              className="mb-4"
              style={{
                fontFamily: "Pretendard",
                fontSize: "20px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "#0C0C0C",
                textAlign: "center",
              }}
            >
              공지를 게시하시겠습니까?
            </h2>

            {/* Message */}
            <p
              className="mb-8"
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 400,
                lineHeight: "1.6",
                color: "#686A6E",
                textAlign: "center",
              }}
            >게시 후에는 즉시 노출됩니다. 내용을 다시 확인해주세요.</p>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowNoticeConfirmModal(false)}
                className="flex-1 py-3"
                style={{
                  background: "transparent",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "#FF4444",
                }}
                data-testid="button-cancel-confirm-notice"
              >
                취소
              </button>
              <button
                onClick={() => {
                  createNoticeMutation.mutate({
                    title: noticeTitle.trim(),
                    content: noticeContent.trim(),
                  });
                  setShowNoticeConfirmModal(false);
                }}
                disabled={createNoticeMutation.isPending}
                className="flex-1 py-3"
                style={{
                  background: createNoticeMutation.isPending ? "#CCC" : "#008FED",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "#FDFDFD",
                  cursor: createNoticeMutation.isPending ? "not-allowed" : "pointer",
                }}
                data-testid="button-confirm-submit-notice"
              >
                {createNoticeMutation.isPending ? "등록 중..." : "게시"}
              </button>
            </div>
          </div>
        </>
      )}
      {/* Notice Cancel Confirmation Modal */}
      {showNoticeCancelConfirmModal && (
        <>
          {/* Modal Overlay */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-50"
            onClick={() => setShowNoticeCancelConfirmModal(false)}
            data-testid="modal-overlay-cancel-confirm-notice"
          />

          {/* Modal Panel */}
          <div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
            style={{
              width: "480px",
              background: "#FDFDFD",
              borderRadius: "12px",
              padding: "32px",
            }}
            data-testid="modal-cancel-confirm-notice"
          >
            {/* Title */}
            <h2
              className="mb-4"
              style={{
                fontFamily: "Pretendard",
                fontSize: "20px",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "#0C0C0C",
                textAlign: "center",
              }}
            >
              작성을 중료하시겠습니까?
            </h2>

            {/* Message */}
            <p
              className="mb-8"
              style={{
                fontFamily: "Pretendard",
                fontSize: "14px",
                fontWeight: 400,
                lineHeight: "1.6",
                color: "#686A6E",
                textAlign: "center",
              }}
            >
              나가시게 되면 입력 내용이 사라집니다.
            </p>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowNoticeCancelConfirmModal(false)}
                className="flex-1 py-3"
                style={{
                  background: "transparent",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "#FF4444",
                }}
                data-testid="button-stay-writing"
              >
                취소
              </button>
              <button
                onClick={() => {
                  setShowNoticeCancelConfirmModal(false);
                  setShowAddNoticeModal(false);
                  setNoticeTitle("");
                  setNoticeContent("");
                }}
                className="flex-1 py-3"
                style={{
                  background: "#008FED",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "#FDFDFD",
                }}
                data-testid="button-leave-writing"
              >
                나가기
              </button>
            </div>
          </div>
        </>
      )}
      {/* View Notice Modal */}
      {viewingNotice && (
        <>
          {/* Modal Overlay */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => setViewingNotice(null)}
            data-testid="modal-overlay-view-notice"
          />

          {/* Modal Panel */}
          <div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
            style={{
              width: "520px",
              maxHeight: "80vh",
              background: "#FDFDFD",
              borderRadius: "12px",
              padding: "24px",
              overflow: "auto",
            }}
            data-testid="modal-view-notice"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h2
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "20px",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "#0C0C0C",
                }}
              >
                공지사항
              </h2>
              <button
                onClick={() => setViewingNotice(null)}
                className="p-1 hover:bg-gray-100 rounded"
                data-testid="button-close-view-notice"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Title */}
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
                제목
              </label>
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "#0C0C0C",
                }}
              >
                {viewingNotice.title}
              </div>
            </div>

            {/* Date */}
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
                게시일
              </label>
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 400,
                  color: "#0C0C0C",
                }}
              >
                {viewingNotice.createdAt
                  ? new Date(viewingNotice.createdAt).toLocaleDateString("ko-KR", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    })
                  : "-"}
              </div>
            </div>

            {/* Content */}
            <div className="mb-6">
              <label
                className="block mb-2"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                  color: "#686A6E",
                }}
              >
                내용
              </label>
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 400,
                  lineHeight: "1.8",
                  color: "#0C0C0C",
                  whiteSpace: "pre-wrap",
                  padding: "16px",
                  background: "#F9FAFB",
                  borderRadius: "8px",
                  minHeight: "120px",
                }}
              >
                {viewingNotice.content}
              </div>
            </div>

            {/* Close Button */}
            <div className="flex justify-center">
              <button
                onClick={() => setViewingNotice(null)}
                className="px-8 py-3"
                style={{
                  background: "#008FED",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "#FDFDFD",
                }}
                data-testid="button-close-view-notice-bottom"
              >
                닫기
              </button>
            </div>
          </div>
        </>
      )}

      {deleteTarget && (
        <>
          <div
            className="fixed inset-0 z-[9999]"
            style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
            onClick={() => setDeleteTarget(null)}
          />
          <div
            className="fixed z-[10000] bg-white rounded-xl shadow-xl p-6"
            style={{
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "400px",
              maxWidth: "90vw",
            }}
          >
            <p
              style={{
                fontFamily: "Pretendard",
                fontSize: "16px",
                fontWeight: 500,
                color: "#0C0C0C",
                textAlign: "center",
                marginBottom: "24px",
              }}
            >
              해당 {deleteTarget.type === "inquiry" ? "1:1문의사항" : "공지사항"}을 삭제하시겠습니까?
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-6 py-2.5"
                style={{
                  border: "1px solid rgba(12, 12, 12, 0.15)",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 500,
                  color: "#686A6E",
                  background: "#FFFFFF",
                }}
                data-testid="button-delete-cancel"
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (deleteTarget.type === "inquiry") {
                    deleteInquiryMutation.mutate(deleteTarget.id);
                  } else {
                    deleteNoticeMutation.mutate(deleteTarget.id);
                  }
                  setDeleteTarget(null);
                }}
                className="px-6 py-2.5"
                style={{
                  background: "#E53E3E",
                  borderRadius: "8px",
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#FFFFFF",
                }}
                data-testid="button-delete-confirm"
              >
                확인
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
