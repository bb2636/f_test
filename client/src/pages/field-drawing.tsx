import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { User, Drawing, Case } from "@shared/schema";
import { MousePointer2, ImagePlus, Square, Target, Lock, Trash2, Focus, ChevronDown, Undo2, Copy } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import html2canvas from "html2canvas";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { formatCaseNumber } from "@/lib/utils";

interface UploadedImage {
  id: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked: boolean;
}

interface DrawnRectangle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  locked: boolean;
  backgroundColor?: string; // 배경 색상 (기본값: 흰색)
}

interface AccidentArea {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked: boolean;
}

interface LeakMarker {
  id: string;
  x: number;
  y: number;
}

type ToolType = "pointer" | "upload" | "rectangle" | "leak" | "accident-area";
type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';
type EntityType = 'image' | 'rectangle' | 'accident-area';

// 도면 표시 스케일: 20mm = 1px (4000mm → 200px로 표시)
const DISPLAY_SCALE = 0.05;

interface ActiveTransform {
  entityType: EntityType;
  entityId: string;
  mode: 'drag' | 'resize';
  handle?: ResizeHandle;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startEntityX: number;
  startEntityY: number;
}

export default function FieldDrawing() {
  const [location, setLocation] = useLocation();
  const [selectedTool, setSelectedTool] = useState<ToolType>("pointer");
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [rectangles, setRectangles] = useState<DrawnRectangle[]>([]);
  const [accidentAreas, setAccidentAreas] = useState<AccidentArea[]>([]);
  const [leakMarkers, setLeakMarkers] = useState<LeakMarker[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedRectangleId, setSelectedRectangleId] = useState<string | null>(null);
  const [selectedAccidentAreaId, setSelectedAccidentAreaId] = useState<string | null>(null);
  const [selectedLeakId, setSelectedLeakId] = useState<string | null>(null);
  const [activeTransform, setActiveTransform] = useState<ActiveTransform | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState({ x: 0, y: 0 });
  const [drawCurrent, setDrawCurrent] = useState({ x: 0, y: 0 });
  
  // 되돌리기(Undo) 기능을 위한 히스토리 상태
  interface HistoryState {
    uploadedImages: UploadedImage[];
    rectangles: DrawnRectangle[];
    accidentAreas: AccidentArea[];
    leakMarkers: LeakMarker[];
  }
  const [history, setHistory] = useState<HistoryState[]>([]);
  const maxHistoryLength = 50; // 최대 히스토리 개수
  
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Hybrid approach: activeTransformRef prevents stale closures in document-level listeners
  // while activeTransform state drives UI updates (resize handles, selection highlights)
  const activeTransformRef = useRef<ActiveTransform | null>(null);
  const { toast} = useToast();

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  // 현장입력에서 선택한 케이스 ID 가져오기 (문자열 "null" 방지)
  const rawCaseId = localStorage.getItem('selectedFieldSurveyCaseId');
  const selectedCaseId = (rawCaseId && rawCaseId !== 'null' && rawCaseId !== 'undefined') ? rawCaseId : '';

  // 선택된 케이스 데이터 가져오기
  const { data: selectedCase, isLoading: isLoadingSelectedCase } = useQuery<Case>({
    queryKey: ["/api/cases", selectedCaseId],
    enabled: !!selectedCaseId,
  });

  // 케이스 ID로 저장된 도면 로드
  const { data: savedDrawing, isLoading: isLoadingDrawing } = useQuery<Drawing>({
    queryKey: ["/api/drawings", "case", selectedCaseId],
    enabled: !!selectedCaseId && !!user,
    staleTime: 0,
  });

  // 관련 케이스 도면 목록 가져오기 (수동 복사용)
  const { data: relatedCasesWithDrawings } = useQuery<{
    relatedCases: Array<{ caseId: string; caseNumber: string }>;
  }>({
    queryKey: ["/api/cases", selectedCaseId, "related-drawings"],
    enabled: !!selectedCaseId,
  });

  // 문서 데이터 조회 (제출 조건 체크용)
  const { data: documentsData, isLoading: isLoadingDocuments } = useQuery({
    queryKey: ["/api/documents/case", selectedCaseId],
    enabled: !!selectedCaseId,
  });

  // 견적 데이터 조회 (제출 조건 체크용)
  const { data: estimateData, isLoading: isLoadingEstimate } = useQuery({
    queryKey: ["/api/estimates", selectedCaseId, "latest"],
    enabled: !!selectedCaseId,
  });

  // 제출 조건 상태 계산
  const isFieldInputComplete = useMemo(() => {
    return !!(selectedCase?.visitDate && selectedCase?.visitTime && selectedCase?.accidentCategory && selectedCase?.victimName);
  }, [selectedCase]);

  const isDrawingComplete = useMemo(() => {
    return !isLoadingDrawing && !!savedDrawing && typeof savedDrawing === 'object' && 'id' in savedDrawing;
  }, [savedDrawing, isLoadingDrawing]);

  const isDocumentsComplete = useMemo(() => {
    return !isLoadingDocuments && Array.isArray(documentsData) && documentsData.length > 0;
  }, [documentsData, isLoadingDocuments]);

  const isEstimateComplete = useMemo(() => {
    return !isLoadingEstimate && !!estimateData && typeof estimateData === 'object' && 'estimate' in estimateData && !!estimateData.estimate;
  }, [estimateData, isLoadingEstimate]);

  const canSubmit = isFieldInputComplete && isDrawingComplete && isDocumentsComplete && isEstimateComplete;

  // 도면 가져오기 팝오버 상태
  const [isImportPopoverOpen, setIsImportPopoverOpen] = useState(false);

  // 도면 복제 mutation
  const cloneDrawingMutation = useMutation({
    mutationFn: async (sourceCaseId: string) => {
      const response = await apiRequest("POST", `/api/cases/${selectedCaseId}/clone-drawing`, {
        sourceCaseId,
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "도면 복제 실패");
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.drawing) {
        setUploadedImages(data.drawing.uploadedImages || []);
        setRectangles(data.drawing.rectangles || []);
        setAccidentAreas(data.drawing.accidentAreas || []);
        setLeakMarkers(data.drawing.leakMarkers || []);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/drawings", "case", selectedCaseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", selectedCaseId, "related-drawings"] });
      setIsImportPopoverOpen(false);
      toast({
        title: "도면 가져오기 완료",
        description: "관련 케이스의 도면을 가져왔습니다. 수정 후 저장해주세요.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "도면 복제 실패",
        description: error.message || "알 수 없는 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 로드된 도면으로 canvas state 초기화
  useEffect(() => {
    if (savedDrawing && !isLoadingDrawing) {
      // Valid drawing - hydrate canvas state
      setUploadedImages(savedDrawing.uploadedImages || []);
      setRectangles(savedDrawing.rectangles || []);
      setAccidentAreas(savedDrawing.accidentAreas || []);
      setLeakMarkers(savedDrawing.leakMarkers || []);
    } else if (!isLoadingDrawing && selectedCaseId) {
      // No drawing exists for this case - reset canvas
      setUploadedImages([]);
      setRectangles([]);
      setAccidentAreas([]);
      setLeakMarkers([]);
    }
  }, [savedDrawing, isLoadingDrawing, selectedCaseId]);

  // 도면 자동 동기화 비활성화 - 각 케이스 개별 관리
  // Auto-sync disabled - each case manages its own drawing

  // Check if save is ready
  const isSaveReady = Boolean(user && !isLoadingSelectedCase && selectedCase && !isLoadingDrawing);

  // 현장출동보고서 제출 후 협력사는 수정 불가 (반려 시 수정 가능)
  const isPartner = user?.role === "협력사";
  const isRejected = selectedCase?.status === "반려";
  const isSubmitted = selectedCase?.fieldSurveyStatus === "submitted";
  // 협력사는 제출 후 수정 불가 (반려 시 수정 가능)
  const isReadOnly = isPartner && isSubmitted && !isRejected;

  // 도면 저장 mutation
  const saveDrawingMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCase) {
        throw new Error("선택된 케이스가 없습니다");
      }
      
      // 캔버스를 이미지로 캡처 (PDF용)
      let canvasImage: string | null = null;
      console.log('[Drawing Save] canvasRef.current:', !!canvasRef.current);
      if (canvasRef.current) {
        try {
          // UI 요소들을 일시적으로 숨김
          const toolbar = document.querySelector('[data-ui="toolbar"]') as HTMLElement;
          const saveButtons = document.querySelector('[data-ui="save-buttons"]') as HTMLElement;
          const controls = document.querySelectorAll('[data-ui="control-panel"]');
          const elementsToHide = [toolbar, saveButtons, ...Array.from(controls)].filter(Boolean);
          
          elementsToHide.forEach(el => {
            if (el instanceof HTMLElement) el.style.display = 'none';
          });
          
          console.log('[Drawing Save] Starting html2canvas capture...');
          console.log('[Drawing Save] Canvas ref dimensions:', {
            width: canvasRef.current.offsetWidth,
            height: canvasRef.current.offsetHeight,
            scrollWidth: canvasRef.current.scrollWidth,
            scrollHeight: canvasRef.current.scrollHeight,
          });
          
          const canvas = await html2canvas(canvasRef.current, {
            backgroundColor: '#ffffff',
            scale: 2, // 고해상도
            logging: true, // 디버깅을 위해 로깅 활성화
            useCORS: true, // CORS 이미지 허용
          });
          
          console.log('[Drawing Save] html2canvas completed, canvas size:', canvas.width, 'x', canvas.height);
          
          try {
            canvasImage = canvas.toDataURL('image/png');
            console.log('[Drawing Save] Canvas captured successfully:', {
              length: canvasImage?.length || 0,
              prefix: canvasImage?.substring(0, 50) || 'null',
            });
          } catch (toDataUrlErr) {
            console.error('[Drawing Save] toDataURL failed (CORS/taint issue):', toDataUrlErr);
          }
          
          // UI 요소들 다시 표시
          elementsToHide.forEach(el => {
            if (el instanceof HTMLElement) el.style.display = '';
          });
        } catch (err) {
          console.error('캔버스 이미지 생성 실패:', err);
        }
      } else {
        console.warn('[Drawing Save] canvasRef.current is null - skipping canvas capture');
      }
      
      const response = await apiRequest("POST", "/api/drawings", {
        drawingId: savedDrawing?.id, // Include drawing ID for updates if exists
        caseId: selectedCase.id,
        uploadedImages,
        rectangles,
        accidentAreas,
        leakMarkers,
        canvasImage, // PDF 출력용 캔버스 스냅샷
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Failed to save drawing: ${response.status}`);
      }
      
      return await response.json();
    },
    onSuccess: (data) => {
      const isNewDrawing = !savedDrawing;
      
      // Update query cache directly
      queryClient.setQueryData(["/api/drawings", data.id], data);
      queryClient.setQueryData(["/api/drawings", "case", data.caseId], data);
      
      const timestamp = new Date().toLocaleTimeString('ko-KR');
      const action = isNewDrawing ? "생성" : "업데이트";
      toast({
        title: `도면 ${action} 완료`,
        description: `도면이 저장되었습니다 (${timestamp})`,
      });
    },
    onError: (error) => {
      console.error("Save drawing error:", error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      toast({
        title: "저장 실패",
        description: errorMessage || "도면 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // Document level mouse event handlers for drag/resize
  // Dependencies: [isDrawing, selectedTool] only - activeTransform removed to prevent listener re-creation
  // This ensures document handlers persist and always read fresh transform state from ref
  useEffect(() => {
    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!canvasRef.current) return;

      // Read from ref to avoid stale closure - critical for delta accumulation
      const transform = activeTransformRef.current;
      if (!transform) return;

      // Get canvas bounding rect
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - canvasRect.left;
      const y = e.clientY - canvasRect.top;

      // Handle drag or resize (픽셀 이동을 mm 단위로 변환)
      const deltaX = (e.clientX - transform.startX) / DISPLAY_SCALE;
      const deltaY = (e.clientY - transform.startY) / DISPLAY_SCALE;

        if (transform.mode === 'drag') {
          // Drag mode - 자유롭게 아무 곳에서나 이동 가능
          const newX = transform.startEntityX + deltaX;
          const newY = transform.startEntityY + deltaY;

          if (transform.entityType === 'image') {
            setUploadedImages(prev =>
              prev.map(img =>
                img.id === transform.entityId
                  ? { ...img, x: newX, y: newY }
                  : img
              )
            );
          } else if (transform.entityType === 'rectangle') {
            setRectangles(prev =>
              prev.map(rect =>
                rect.id === transform.entityId
                  ? { ...rect, x: newX, y: newY }
                  : rect
              )
            );
          } else if (transform.entityType === 'accident-area') {
            setAccidentAreas(prev =>
              prev.map(area =>
                area.id === transform.entityId
                  ? { ...area, x: newX, y: newY }
                  : area
              )
            );
          }
        } else if (transform.mode === 'resize' && transform.handle) {
          // Resize mode - reuse existing logic
          const handle = transform.handle;
          let newX = transform.startEntityX;
          let newY = transform.startEntityY;
          let newWidth = transform.startWidth;
          let newHeight = transform.startHeight;

          const rightEdge = transform.startEntityX + transform.startWidth;
          const bottomEdge = transform.startEntityY + transform.startHeight;

          // Development logging for resize debugging
          if (import.meta.env.DEV) {
            console.log('[Resize Debug]', { handle, deltaX, deltaY, startEntityX: transform.startEntityX, startEntityY: transform.startEntityY, rightEdge, bottomEdge });
          }

          // Apply delta based on handle direction
          if (handle.includes('n')) {
            newY = transform.startEntityY + deltaY;
            newHeight = transform.startHeight - deltaY;
          } else if (handle.includes('s')) {
            newHeight = transform.startHeight + deltaY;
          }

          if (handle.includes('w')) {
            newX = transform.startEntityX + deltaX;
            newWidth = transform.startWidth - deltaX;
          } else if (handle.includes('e')) {
            newWidth = transform.startWidth + deltaX;
          }

          // Minimum size constraint only (no boundary clamping - 자유롭게 리사이즈)
          // 최소 500mm (표시상 50px)
          const minSize = 500;
          if (newWidth < minSize) {
            newWidth = minSize;
            // For west handles, preserve the right edge (if possible)
            if (handle.includes('w')) {
              newX = rightEdge - minSize;
              // Re-clamp to prevent negative coordinates
              if (newX < 0) {
                newX = 0;
                newWidth = Math.min(minSize, rightEdge);
              }
            }
          }
          if (newHeight < minSize) {
            newHeight = minSize;
            // For north handles, preserve the bottom edge (if possible)
            if (handle.includes('n')) {
              newY = bottomEdge - minSize;
            }
          }

          // Update entity state
          if (transform.entityType === 'image') {
            setUploadedImages(prev =>
              prev.map(img =>
                img.id === transform.entityId
                  ? { ...img, x: newX, y: newY, width: newWidth, height: newHeight }
                  : img
              )
            );
          } else if (transform.entityType === 'rectangle') {
            setRectangles(prev =>
              prev.map(rect =>
                rect.id === transform.entityId
                  ? { ...rect, x: newX, y: newY, width: newWidth, height: newHeight }
                  : rect
              )
            );
          } else if (transform.entityType === 'accident-area') {
            setAccidentAreas(prev =>
              prev.map(area =>
                area.id === transform.entityId
                  ? { ...area, x: newX, y: newY, width: newWidth, height: newHeight }
                  : area
              )
            );
          }
        }
    };

    const handleDocumentMouseUp = () => {
      activeTransformRef.current = null;
      setActiveTransform(null);
      setIsDrawing(false);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [isDrawing, selectedTool]);

  // 리사이즈 핸들 마우스 다운 핸들러
  const handleResizeHandleMouseDown = (
    e: React.MouseEvent,
    handle: ResizeHandle,
    entity: UploadedImage | DrawnRectangle | AccidentArea,
    entityType: EntityType
  ) => {
    e.stopPropagation();
    if (isReadOnly) return;
    
    const newTransform = {
      entityType,
      entityId: entity.id,
      mode: 'resize' as const,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: entity.width,
      startHeight: entity.height,
      startEntityX: entity.x,
      startEntityY: entity.y,
    };
    
    // Update ref first to prevent stale closures
    activeTransformRef.current = newTransform;
    // Then update state for UI
    setActiveTransform(newTransform);
    
    // Ensure selection is set so resize handles render
    if (entityType === 'image') {
      setSelectedImageId(entity.id);
      setSelectedRectangleId(null);
      setSelectedAccidentAreaId(null);
      setSelectedLeakId(null);
    } else if (entityType === 'rectangle') {
      setSelectedRectangleId(entity.id);
      setSelectedImageId(null);
      setSelectedAccidentAreaId(null);
      setSelectedLeakId(null);
    } else if (entityType === 'accident-area') {
      setSelectedAccidentAreaId(entity.id);
      setSelectedImageId(null);
      setSelectedRectangleId(null);
      setSelectedLeakId(null);
    }
  };

  const fieldSurveyMenuItems = [
    { title: "현장입력", url: "/field-survey/management" },
    { title: "도면작성", url: "/field-survey/drawing" },
    { title: "증빙자료 등록", url: "/field-survey/documents" },
    { title: "견적서 작성", url: "/field-survey/estimate" },
    { title: "현장출동보고서", url: "/field-survey/report" },
  ];

  const tools = [
    { id: "pointer" as ToolType, icon: MousePointer2, label: "선택" },
    { id: "upload" as ToolType, icon: ImagePlus, label: "이미지 업로드" },
    { id: "rectangle" as ToolType, icon: Square, label: "사각형" },
    { id: "leak" as ToolType, icon: Target, label: "누수 지점" },
    { id: "accident-area" as ToolType, icon: Focus, label: "사고 영역" },
  ];

  // 이미지를 캔버스에 추가하는 공통 함수
  const addImageToCanvas = (dataUrl: string) => {
    const img = new Image();
    img.onload = () => {
      saveToHistory(); // 이미지 추가 전 히스토리 저장
      // 이미지 크기를 mm 단위로 저장 (화면에 약 300px로 표시되도록 3000mm)
      const displayWidth = 3000; // mm (화면에 300px로 표시됨)
      const aspectRatio = img.height / img.width;
      const newImage: UploadedImage = {
        id: `img-${Date.now()}`,
        src: dataUrl,
        x: 500, // mm
        y: 500, // mm
        width: displayWidth,
        height: displayWidth * aspectRatio,
        locked: false,
      };
      setUploadedImages(prev => [...prev, newImage]);
      setSelectedImageId(newImage.id);
      setSelectedRectangleId(null);
      setSelectedAccidentAreaId(null);
      setSelectedLeakId(null);
      toast({
        title: "이미지 추가",
        description: "이미지가 추가되었습니다.",
      });
    };
    img.src = dataUrl;
  };

  // 파일 업로드 핸들러
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.type.startsWith('image/')) {
      toast({
        title: "오류",
        description: "이미지 파일만 업로드할 수 있습니다.",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        addImageToCanvas(event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 클립보드 붙여넣기 핸들러
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // 이미지 타입인 경우
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;

          const reader = new FileReader();
          reader.onload = (event) => {
            if (event.target?.result) {
              addImageToCanvas(event.target.result as string);
            }
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    };

    // 전역 paste 이벤트 리스너 등록
    document.addEventListener('paste', handlePaste);

    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, []);

  // 도면 저장 핸들러
  const handleSave = () => {
    // 제출 조건 상태 콘솔 로그
    console.log("=== 제출 조건 체크 (도면 저장) ===");
    console.log("현장입력 완료:", isFieldInputComplete);
    console.log("도면 완료:", isDrawingComplete);
    console.log("증빙자료 완료:", isDocumentsComplete);
    console.log("견적 완료:", isEstimateComplete);
    console.log("제출 가능:", canSubmit);
    console.log("================================");
    
    // Guard: prevent save before validation complete
    if (!isSaveReady) return;
    saveDrawingMutation.mutate();
  };

  // PNG 저장 핸들러
  const handleSavePNG = async () => {
    if (!canvasRef.current) return;
    
    // UI 요소들을 일시적으로 숨김
    const toolbar = document.querySelector('[data-ui="toolbar"]') as HTMLElement;
    const saveButtons = document.querySelector('[data-ui="save-buttons"]') as HTMLElement;
    const controls = document.querySelectorAll('[data-ui="control-panel"]');
    
    const elementsToHide = [toolbar, saveButtons, ...Array.from(controls)].filter(Boolean);
    
    try {
      elementsToHide.forEach(el => {
        if (el instanceof HTMLElement) el.style.display = 'none';
      });
      
      // 캔버스 캡처
      const canvas = await html2canvas(canvasRef.current, {
        backgroundColor: null,
        scale: 2, // 고해상도
        logging: false,
      });
      
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `도면_${new Date().toISOString().split('T')[0]}.png`;
        a.click();
        URL.revokeObjectURL(url);
        
        toast({
          title: "저장 완료",
          description: "도면이 PNG 파일로 저장되었습니다.",
        });
      });
    } catch (error) {
      toast({
        title: "저장 실패",
        description: "도면 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      // UI 요소들 다시 표시 (항상 실행)
      elementsToHide.forEach(el => {
        if (el instanceof HTMLElement) el.style.display = '';
      });
    }
  };

  // 툴 선택 핸들러
  const handleToolClick = (toolId: ToolType) => {
    if (toolId === "upload") {
      fileInputRef.current?.click();
    } else {
      setSelectedTool(toolId);
      setSelectedImageId(null);
      setSelectedRectangleId(null);
      setSelectedAccidentAreaId(null);
      setSelectedLeakId(null);
    }
  };

  // 캔버스 클릭 핸들러
  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return;
    if (isReadOnly) return;
    
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - canvasRect.left;
    const y = e.clientY - canvasRect.top;

    if (selectedTool === "leak") {
      saveToHistory(); // 누수마커 추가 전 히스토리 저장
      // 누수 지점 마커 추가 (픽셀 좌표를 mm 단위로 변환)
      const newMarker: LeakMarker = {
        id: `leak-${Date.now()}`,
        x: x / DISPLAY_SCALE,
        y: y / DISPLAY_SCALE,
      };
      setLeakMarkers(prev => [...prev, newMarker]);
      toast({
        title: "누수 지점 표시",
        description: "누수 발생 지점이 표시되었습니다.",
      });
    }
  };

  // 이미지 마우스 다운 핸들러
  const handleImageMouseDown = (e: React.MouseEvent, image: UploadedImage) => {
    // In drawing modes (rectangle/accident-area/leak), let event bubble to canvas
    if (selectedTool !== "pointer") return;
    if (isReadOnly) return;
    
    // In pointer mode, stop propagation and handle selection/drag
    e.stopPropagation();
    if (image.locked) return;
    
    setSelectedImageId(image.id);
    setSelectedRectangleId(null);
    setSelectedAccidentAreaId(null);
    setSelectedLeakId(null);
    
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    
    const newTransform = {
      entityType: 'image' as const,
      entityId: image.id,
      mode: 'drag' as const,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: image.width,
      startHeight: image.height,
      startEntityX: image.x,
      startEntityY: image.y,
    };
    
    activeTransformRef.current = newTransform;
    setActiveTransform(newTransform);
  };

  // 사각형 마우스 다운 핸들러
  const handleRectangleMouseDown = (e: React.MouseEvent, rect: DrawnRectangle) => {
    // In drawing modes, let event bubble to canvas
    if (selectedTool !== "pointer") return;
    if (isReadOnly) return;
    
    // In pointer mode, stop propagation and handle selection/drag
    e.stopPropagation();
    if (rect.locked) return;
    
    setSelectedRectangleId(rect.id);
    setSelectedImageId(null);
    setSelectedAccidentAreaId(null);
    setSelectedLeakId(null);
    
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    
    const newTransform = {
      entityType: 'rectangle' as const,
      entityId: rect.id,
      mode: 'drag' as const,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      startEntityX: rect.x,
      startEntityY: rect.y,
    };
    
    activeTransformRef.current = newTransform;
    setActiveTransform(newTransform);
  };

  // 사고영역 마우스 다운 핸들러
  const handleAccidentAreaMouseDown = (e: React.MouseEvent, area: AccidentArea) => {
    // In drawing modes, let event bubble to canvas
    if (selectedTool !== "pointer") return;
    if (isReadOnly) return;
    
    // In pointer mode, stop propagation and handle selection/drag
    e.stopPropagation();
    if (area.locked) return;
    
    setSelectedAccidentAreaId(area.id);
    setSelectedImageId(null);
    setSelectedRectangleId(null);
    setSelectedLeakId(null);
    
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    
    const newTransform = {
      entityType: 'accident-area' as const,
      entityId: area.id,
      mode: 'drag' as const,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: area.width,
      startHeight: area.height,
      startEntityX: area.x,
      startEntityY: area.y,
    };
    
    activeTransformRef.current = newTransform;
    setActiveTransform(newTransform);
  };

  // 누수 마커 클릭 핸들러
  const handleLeakMarkerClick = (e: React.MouseEvent, leakId: string) => {
    e.stopPropagation();
    if (selectedTool === "pointer") {
      setSelectedLeakId(leakId);
      setSelectedImageId(null);
      setSelectedRectangleId(null);
      setSelectedAccidentAreaId(null);
    }
  };

  // 누수 마커 드래그 핸들러
  const handleLeakMarkerMouseDown = (e: React.MouseEvent, marker: LeakMarker) => {
    if (selectedTool !== "pointer") return;
    
    e.stopPropagation();
    
    setSelectedLeakId(marker.id);
    setSelectedImageId(null);
    setSelectedRectangleId(null);
    setSelectedAccidentAreaId(null);
    
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    
    // 드래그 시작 위치 저장
    const startX = e.clientX;
    const startY = e.clientY;
    const startMarkerX = marker.x;
    const startMarkerY = marker.y;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = (moveEvent.clientX - startX) / DISPLAY_SCALE;
      const deltaY = (moveEvent.clientY - startY) / DISPLAY_SCALE;
      
      setLeakMarkers(prev =>
        prev.map(m =>
          m.id === marker.id
            ? { ...m, x: startMarkerX + deltaX, y: startMarkerY + deltaY }
            : m
        )
      );
    };
    
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // 삭제 핸들러
  const handleDelete = () => {
    saveToHistory(); // 삭제 전 히스토리 저장
    if (selectedImageId) {
      setUploadedImages(prev => prev.filter(img => img.id !== selectedImageId));
      setSelectedImageId(null);
      toast({ title: "삭제 완료", description: "이미지가 삭제되었습니다." });
    } else if (selectedRectangleId) {
      setRectangles(prev => prev.filter(rect => rect.id !== selectedRectangleId));
      setSelectedRectangleId(null);
      toast({ title: "삭제 완료", description: "사각형이 삭제되었습니다." });
    } else if (selectedAccidentAreaId) {
      setAccidentAreas(prev => prev.filter(area => area.id !== selectedAccidentAreaId));
      setSelectedAccidentAreaId(null);
      toast({ title: "삭제 완료", description: "사고 영역이 삭제되었습니다." });
    } else if (selectedLeakId) {
      setLeakMarkers(prev => prev.filter(leak => leak.id !== selectedLeakId));
      setSelectedLeakId(null);
      toast({ title: "삭제 완료", description: "누수 지점이 삭제되었습니다." });
    }
  };

  // 잠금 토글
  const handleToggleLock = () => {
    if (selectedImageId) {
      setUploadedImages(prev =>
        prev.map(img =>
          img.id === selectedImageId ? { ...img, locked: !img.locked } : img
        )
      );
    } else if (selectedRectangleId) {
      setRectangles(prev =>
        prev.map(rect =>
          rect.id === selectedRectangleId ? { ...rect, locked: !rect.locked } : rect
        )
      );
    } else if (selectedAccidentAreaId) {
      setAccidentAreas(prev =>
        prev.map(area =>
          area.id === selectedAccidentAreaId ? { ...area, locked: !area.locked } : area
        )
      );
    }
  };

  // 사각형 너비 변경
  const handleRectangleWidthChange = (value: string) => {
    const width = parseInt(value) || 0;
    if (selectedRectangleId) {
      setRectangles(prev =>
        prev.map(rect =>
          rect.id === selectedRectangleId ? { ...rect, width } : rect
        )
      );
    }
  };

  // 사각형 높이 변경
  const handleRectangleHeightChange = (value: string) => {
    const height = parseInt(value) || 0;
    if (selectedRectangleId) {
      setRectangles(prev =>
        prev.map(rect =>
          rect.id === selectedRectangleId ? { ...rect, height } : rect
        )
      );
    }
  };

  // 사각형 텍스트 변경
  const handleRectangleTextChange = (value: string) => {
    if (selectedRectangleId) {
      setRectangles(prev =>
        prev.map(rect =>
          rect.id === selectedRectangleId ? { ...rect, text: value } : rect
        )
      );
    }
  };

  // 사각형 배경 색상 변경
  const handleRectangleBackgroundColorChange = (color: string) => {
    if (selectedRectangleId) {
      setRectangles(prev =>
        prev.map(rect =>
          rect.id === selectedRectangleId ? { ...rect, backgroundColor: color } : rect
        )
      );
    }
  };

  // 색상 옵션 목록
  const colorOptions = [
    { value: "#FFFFFF", label: "흰색" },
    { value: "#FFFACD", label: "연노랑" },
    { value: "#FFD1DC", label: "연분홍" },
    { value: "#90EE90", label: "연두색" },
    { value: "#87CEEB", label: "하늘색" },
  ];

  // 현재 상태를 히스토리에 저장
  const saveToHistory = () => {
    const currentState: HistoryState = {
      uploadedImages: JSON.parse(JSON.stringify(uploadedImages)),
      rectangles: JSON.parse(JSON.stringify(rectangles)),
      accidentAreas: JSON.parse(JSON.stringify(accidentAreas)),
      leakMarkers: JSON.parse(JSON.stringify(leakMarkers)),
    };
    setHistory(prev => {
      const newHistory = [...prev, currentState];
      if (newHistory.length > maxHistoryLength) {
        return newHistory.slice(-maxHistoryLength);
      }
      return newHistory;
    });
  };

  // 되돌리기(Undo) 함수
  const handleUndo = () => {
    if (history.length === 0) {
      toast({
        title: "되돌리기 불가",
        description: "더 이상 되돌릴 수 없습니다.",
        variant: "destructive",
      });
      return;
    }
    
    const previousState = history[history.length - 1];
    setUploadedImages(previousState.uploadedImages);
    setRectangles(previousState.rectangles);
    setAccidentAreas(previousState.accidentAreas);
    setLeakMarkers(previousState.leakMarkers);
    
    // 선택 해제
    setSelectedImageId(null);
    setSelectedRectangleId(null);
    setSelectedAccidentAreaId(null);
    setSelectedLeakId(null);
    
    // 히스토리에서 제거
    setHistory(prev => prev.slice(0, -1));
    
    toast({
      title: "되돌리기",
      description: "이전 상태로 복원되었습니다.",
    });
  };

  // 사각형/사고영역 그리기 시작
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return;
    if (isReadOnly) return;
    
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - canvasRect.left;
    const y = e.clientY - canvasRect.top;

    if (selectedTool === "rectangle" || selectedTool === "accident-area") {
      setIsDrawing(true);
      setDrawStart({ x, y });
      setDrawCurrent({ x, y });
    } else if (selectedTool === "pointer") {
      // 드래그 시작 로직
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return;
    
    // 사각형 그리기 미리보기 업데이트
    if (isDrawing && (selectedTool === "rectangle" || selectedTool === "accident-area")) {
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - canvasRect.left;
      const y = e.clientY - canvasRect.top;
      setDrawCurrent({ x, y });
    }
    
    // All drag/resize logic moved to document listeners
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return;
    
    // 사각형 그리기 완료
    if (isDrawing && selectedTool === "rectangle") {
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const endX = e.clientX - canvasRect.left;
      const endY = e.clientY - canvasRect.top;
      
      const widthPx = Math.abs(endX - drawStart.x);
      const heightPx = Math.abs(endY - drawStart.y);
      
      if (widthPx > 10 && heightPx > 10) {
        saveToHistory(); // 사각형 추가 전 히스토리 저장
        // 픽셀 좌표를 mm 단위로 변환
        const newRectangle: DrawnRectangle = {
          id: `rect-${Date.now()}`,
          x: Math.min(drawStart.x, endX) / DISPLAY_SCALE,
          y: Math.min(drawStart.y, endY) / DISPLAY_SCALE,
          width: widthPx / DISPLAY_SCALE,
          height: heightPx / DISPLAY_SCALE,
          text: "",
          locked: false,
          backgroundColor: "#FFFFFF", // 기본 흰색
        };
        setRectangles(prev => [...prev, newRectangle]);
        setSelectedRectangleId(newRectangle.id);
        setSelectedImageId(null);
        setSelectedAccidentAreaId(null);
        setSelectedLeakId(null);
      }
      
      setIsDrawing(false);
    }
    
    // 사고영역 그리기 완료
    if (isDrawing && selectedTool === "accident-area") {
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const endX = e.clientX - canvasRect.left;
      const endY = e.clientY - canvasRect.top;
      
      const widthPx = Math.abs(endX - drawStart.x);
      const heightPx = Math.abs(endY - drawStart.y);
      
      if (widthPx > 10 && heightPx > 10) {
        saveToHistory(); // 피해면적 추가 전 히스토리 저장
        // 픽셀 좌표를 mm 단위로 변환
        const newArea: AccidentArea = {
          id: `area-${Date.now()}`,
          x: Math.min(drawStart.x, endX) / DISPLAY_SCALE,
          y: Math.min(drawStart.y, endY) / DISPLAY_SCALE,
          width: widthPx / DISPLAY_SCALE,
          height: heightPx / DISPLAY_SCALE,
          locked: false,
        };
        setAccidentAreas(prev => [...prev, newArea]);
        setSelectedAccidentAreaId(newArea.id);
        setSelectedImageId(null);
        setSelectedRectangleId(null);
        setSelectedLeakId(null);
      }
      
      setIsDrawing(false);
    }
    
    // 드래그/리사이즈 완료
    if (activeTransform) {
      setActiveTransform(null);
    }
  };

  if (!user) {
    return null;
  }

  const selectedImage = uploadedImages.find(img => img.id === selectedImageId);
  const selectedRectangle = rectangles.find(rect => rect.id === selectedRectangleId);
  const selectedAccidentArea = accidentAreas.find(area => area.id === selectedAccidentAreaId);

  return (
    <>
      <div className="flex h-[calc(100vh-89px)] min-h-0 overflow-hidden">
        {/* 왼쪽 사이드바 */}
        <div 
          className="w-[180px] border-r flex-shrink-0 flex flex-col"
          style={{
            background: "white",
            borderRight: "1px solid rgba(0, 143, 237, 0.15)",
          }}
        >
          {/* 도면 작성 타이틀 */}
          <div 
            className="p-4 border-b flex-shrink-0"
            style={{
              borderBottom: "1px solid rgba(0, 143, 237, 0.15)",
            }}
          >
            <h2 
              style={{
                fontFamily: "Pretendard",
                fontSize: "18px",
                fontWeight: 700,
                color: "#0C0C0C",
              }}
            >
              도면 작성
            </h2>
          </div>

          {/* 케이스 정보 */}
          <div 
            className="p-4 border-b flex-shrink-0"
            style={{
              borderBottom: "1px solid rgba(0, 143, 237, 0.15)",
            }}
          >
            {isLoadingSelectedCase ? (
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "12px",
                  color: "rgba(12, 12, 12, 0.5)",
                }}
              >
                로딩 중...
              </span>
            ) : selectedCase ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <div 
                    className="w-2 h-2 rounded-full"
                    style={{ background: "#008FED" }}
                  />
                  <span
                    style={{
                      fontFamily: "Pretendard",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#0C0C0C",
                    }}
                  >
                    {selectedCase.insuranceCompany} {selectedCase.insuranceAccidentNo}
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "11px",
                    color: "rgba(12, 12, 12, 0.5)",
                  }}
                >
                  {formatCaseNumber(selectedCase.caseNumber)}
                </span>
              </>
            ) : selectedCaseId ? (
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "12px",
                  color: "#ef4444",
                }}
              >
                케이스를 찾을 수 없습니다
              </span>
            ) : (
              <span
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "12px",
                  color: "rgba(12, 12, 12, 0.5)",
                }}
              >
                케이스를 선택해주세요
              </span>
            )}
          </div>

          {/* 메뉴 아이템들 */}
          <div className="p-2 flex-1 overflow-y-auto">
            {fieldSurveyMenuItems.map((item) => (
              <button
                key={item.title}
                onClick={() => setLocation(item.url)}
                data-testid={`menu-${item.title}`}
                className="w-full text-left px-3 py-2.5 rounded mb-1 hover-elevate active-elevate-2"
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "14px",
                  fontWeight: location === item.url ? 600 : 500,
                  color: location === item.url ? "#008FED" : "rgba(12, 12, 12, 0.7)",
                  background: location === item.url ? "rgba(0, 143, 237, 0.08)" : "transparent",
                }}
              >
                {item.title}
              </button>
            ))}
          </div>
        </div>

        {/* 메인 콘텐츠 영역 */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
          {/* 숨겨진 파일 입력 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
            data-testid="input-file-upload"
          />

          {/* 작성중인 건 표시 */}
          {selectedCase && (
            <div 
              className="absolute top-4 left-4 z-10 px-4 py-3 rounded-lg"
              data-ui="case-info"
              style={{
                background: "white",
                border: "1px solid rgba(0, 143, 237, 0.15)",
              }}
            >
              <div
                style={{
                  fontFamily: "Pretendard",
                  fontSize: "12px",
                  fontWeight: 400,
                  letterSpacing: "-0.02em",
                  color: "rgba(12, 12, 12, 0.5)",
                  marginBottom: "6px",
                }}
              >
                작성중인 건
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: "#008FED" }}
                />
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "14px",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "#0C0C0C",
                  }}
                >
                  {selectedCase.assignedPartnerManager || selectedCase.clientName || selectedCase.insuranceCompany}
                </span>
                <span
                  style={{
                    fontFamily: "Pretendard",
                    fontSize: "12px",
                    fontWeight: 400,
                    letterSpacing: "-0.02em",
                    color: "rgba(12, 12, 12, 0.5)",
                  }}
                >
                  {formatCaseNumber(selectedCase.caseNumber)}
                </span>
              </div>
            </div>
          )}

          {/* 저장 버튼 (우측 상단) */}
          <div className="absolute top-4 right-4 z-10 flex gap-2" data-ui="save-buttons">
            {/* 관련접수건 도면 가져오기 버튼 - 항상 표시 */}
            {!isReadOnly && (
              <Popover open={isImportPopoverOpen} onOpenChange={setIsImportPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    className="px-4 py-2.5 rounded-lg font-medium transition-all hover-elevate active-elevate-2 flex items-center gap-2"
                    style={{
                      background: "#F59E0B",
                      color: "white",
                      fontFamily: "Pretendard",
                      fontSize: "14px",
                    }}
                    data-testid="button-import-drawing"
                  >
                    <Copy className="w-4 h-4" />
                    관련접수건 도면 가져오기
                  </button>
                </PopoverTrigger>
                <PopoverContent 
                  className="w-64 p-0" 
                  align="end"
                  style={{
                    background: "white",
                    border: "1px solid rgba(0, 0, 0, 0.1)",
                    borderRadius: "12px",
                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
                  }}
                >
                  <div className="p-3 border-b" style={{ borderColor: "rgba(0, 0, 0, 0.06)" }}>
                    <p
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "#0C0C0C",
                      }}
                    >
                      도면 가져오기
                    </p>
                    <p
                      style={{
                        fontFamily: "Pretendard",
                        fontSize: "11px",
                        color: "rgba(12, 12, 12, 0.5)",
                        marginTop: "4px",
                      }}
                    >
                      관련 접수건의 도면을 복사합니다
                    </p>
                  </div>
                  <div className="p-2 max-h-48 overflow-y-auto">
                    {(!relatedCasesWithDrawings?.relatedCases || relatedCasesWithDrawings.relatedCases.length === 0) ? (
                      <p
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "12px",
                          color: "rgba(12, 12, 12, 0.5)",
                          padding: "8px",
                          textAlign: "center",
                        }}
                      >
                        가져올 수 있는 관련 접수건 도면이 없습니다
                      </p>
                    ) : (
                      relatedCasesWithDrawings.relatedCases.map((relatedCase) => (
                        <button
                          key={relatedCase.caseId}
                          onClick={() => cloneDrawingMutation.mutate(relatedCase.caseId)}
                          disabled={cloneDrawingMutation.isPending}
                          className="w-full text-left px-3 py-2 rounded-lg hover-elevate active-elevate-2 transition-all"
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "13px",
                            color: "#0C0C0C",
                            opacity: cloneDrawingMutation.isPending ? 0.6 : 1,
                          }}
                          data-testid={`button-import-from-${relatedCase.caseNumber}`}
                        >
                          <span style={{ fontWeight: 500 }}>
                            {formatCaseNumber(relatedCase.caseNumber)}
                          </span>
                          {cloneDrawingMutation.isPending && (
                            <span 
                              className="ml-2"
                              style={{ 
                                fontSize: "11px", 
                                color: "#F59E0B" 
                              }}
                            >
                              복사 중...
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <button
              onClick={handleSave}
              disabled={!isSaveReady || saveDrawingMutation.isPending || isReadOnly}
              className="px-6 py-2.5 rounded-lg font-medium transition-all hover-elevate active-elevate-2"
              style={{
                background: "white",
                color: "#008FED",
                border: "1px solid #008FED",
                fontFamily: "Pretendard",
                fontSize: "14px",
                opacity: (!isSaveReady || saveDrawingMutation.isPending || isReadOnly) ? 0.6 : 1,
                cursor: (!isSaveReady || saveDrawingMutation.isPending || isReadOnly) ? "not-allowed" : "pointer",
              }}
              data-testid="button-save"
            >
              {isReadOnly ? "수정 불가" : !isSaveReady ? "준비 중..." : saveDrawingMutation.isPending ? "저장 중..." : "저장"}
            </button>
            <button
              onClick={handleSavePNG}
              className="px-6 py-2.5 rounded-lg font-medium transition-all hover-elevate active-elevate-2"
              style={{
                background: "#008FED",
                color: "white",
                fontFamily: "Pretendard",
                fontSize: "14px",
              }}
              data-testid="button-save-png"
            >
              PNG 저장
            </button>
          </div>

          {/* 툴바 (하단 중앙) */}
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10" data-ui="toolbar">
            <div 
              className="flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg"
              style={{
                background: "white",
                border: "1px solid rgba(0, 0, 0, 0.08)",
              }}
            >
              {/* 되돌리기 버튼 */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleUndo}
                    data-testid="button-undo"
                    disabled={isReadOnly}
                    className="p-3 rounded-lg transition-all hover:bg-gray-100"
                    style={{
                      background: "transparent",
                      color: isReadOnly ? "#CCCCCC" : (history.length > 0 ? "#0C0C0C" : "#CCCCCC"),
                      cursor: isReadOnly ? "not-allowed" : "pointer",
                    }}
                  >
                    <Undo2 className="w-6 h-6" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-gray-900 text-white px-3 py-1.5 text-sm rounded-md">
                  되돌리기 (Ctrl+Z)
                </TooltipContent>
              </Tooltip>
              <div className="w-px h-8 bg-gray-200 mx-1" />
              {tools.map((tool) => (
                <Tooltip key={tool.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => !isReadOnly && handleToolClick(tool.id)}
                      data-testid={`tool-${tool.id}`}
                      disabled={isReadOnly}
                      className="p-3 rounded-lg transition-all"
                      style={{
                        background: selectedTool === tool.id ? "#008FED" : "transparent",
                        color: isReadOnly ? "#CCCCCC" : (selectedTool === tool.id ? "white" : "#0C0C0C"),
                        cursor: isReadOnly ? "not-allowed" : "pointer",
                        opacity: isReadOnly ? 0.5 : 1,
                      }}
                    >
                      <tool.icon className="w-6 h-6" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-gray-900 text-white px-3 py-1.5 text-sm rounded-md">
                    {tool.label}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>

          {/* 선택된 사각형의 컨트롤 (상단 중앙 아래) */}
          {selectedRectangle && selectedTool === "pointer" && (
            <div 
              className="absolute z-10"
              data-ui="control-panel"
              style={{
                left: `calc(${selectedRectangle.x * DISPLAY_SCALE}px + 180px)`,
                top: `${Math.max(selectedRectangle.y * DISPLAY_SCALE - 60, 80)}px`,
              }}
            >
              <div 
                className="flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg"
                style={{
                  background: "#2C2C2C",
                }}
              >
                <div className="flex items-center gap-2">
                  <span style={{ color: "white", fontSize: "12px", fontWeight: 500 }}>W</span>
                  <input
                    type="number"
                    value={selectedRectangle.width}
                    onChange={(e) => handleRectangleWidthChange(e.target.value)}
                    className="w-20 px-2 py-1 rounded text-white text-sm"
                    style={{
                      background: "#1C1C1C",
                      border: "1px solid #008FED",
                    }}
                    data-testid="input-rectangle-width"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ color: "white", fontSize: "12px", fontWeight: 500 }}>H</span>
                  <input
                    type="number"
                    value={selectedRectangle.height}
                    onChange={(e) => handleRectangleHeightChange(e.target.value)}
                    className="w-20 px-2 py-1 rounded text-white text-sm"
                    style={{
                      background: "#1C1C1C",
                      border: "none",
                    }}
                    data-testid="input-rectangle-height"
                  />
                </div>
                {/* 색상 선택 드롭다운 */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className="flex items-center gap-1 p-1 rounded hover:bg-white/10"
                      data-testid="button-color-picker"
                    >
                      <div 
                        className="w-5 h-5 rounded border border-white/30"
                        style={{ 
                          background: selectedRectangle.backgroundColor || "#FFFFFF"
                        }}
                      />
                      <ChevronDown className="w-3 h-3 text-white" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent 
                    className="w-auto p-2" 
                    style={{ background: "#2C2C2C", border: "1px solid #444" }}
                  >
                    <div className="flex flex-col gap-1">
                      {colorOptions.map((color) => (
                        <button
                          key={color.value}
                          onClick={() => handleRectangleBackgroundColorChange(color.value)}
                          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/10"
                          data-testid={`color-option-${color.value}`}
                        >
                          <div 
                            className="w-4 h-4 rounded"
                            style={{ background: color.value }}
                          />
                          <span style={{ color: "white", fontSize: "12px" }}>
                            {color.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <button
                  onClick={handleToggleLock}
                  className="p-1 rounded hover:bg-white/10"
                  data-testid="button-toggle-lock"
                >
                  <Lock className="w-4 h-4 text-white" />
                </button>
                <button
                  onClick={handleDelete}
                  className="p-1 rounded hover:bg-white/10"
                  data-testid="button-delete"
                >
                  <Trash2 className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
          )}

          {/* 선택된 이미지의 컨트롤 */}
          {selectedImage && selectedTool === "pointer" && (
            <div 
              className="absolute z-10"
              data-ui="control-panel"
              style={{
                left: `calc(${selectedImage.x * DISPLAY_SCALE}px + 180px)`,
                top: `${Math.max(selectedImage.y * DISPLAY_SCALE - 50, 80)}px`,
              }}
            >
              <div 
                className="flex items-center gap-3 px-3 py-2 rounded-lg shadow-lg"
                style={{
                  background: "#2C2C2C",
                }}
              >
                <button
                  onClick={handleToggleLock}
                  className="p-2 rounded hover:bg-white/10"
                  data-testid="button-toggle-lock-image"
                >
                  <Lock className="w-5 h-5 text-white" />
                </button>
                <button
                  onClick={handleDelete}
                  className="p-2 rounded hover:bg-white/10"
                  data-testid="button-delete-selected"
                >
                  <Trash2 className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>
          )}

          {/* 선택된 누수 마커의 컨트롤 - 마커 바로 위에 표시 */}
          {selectedLeakId && selectedTool === "pointer" && (() => {
            const selectedMarker = leakMarkers.find(l => l.id === selectedLeakId);
            if (!selectedMarker) return null;
            return (
              <div 
                className="absolute z-20"
                data-ui="control-panel-leak"
                style={{
                  left: `calc(${selectedMarker.x * DISPLAY_SCALE}px + 180px - 18px)`,
                  top: `${Math.max(selectedMarker.y * DISPLAY_SCALE - 55, 80)}px`,
                }}
              >
                <div 
                  className="flex items-center px-2 py-2 rounded-lg shadow-lg"
                  style={{
                    background: "#2C2C2C",
                  }}
                >
                  <button
                    onClick={handleDelete}
                    className="p-1 rounded hover:bg-white/10"
                    data-testid="button-delete-leak"
                  >
                    <Trash2 className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
            );
          })()}

          {/* 선택된 피해면적의 컨트롤 (삭제 버튼) */}
          {selectedAccidentArea && selectedTool === "pointer" && (
            <div 
              className="absolute z-10"
              data-ui="control-panel"
              style={{
                left: `calc(${(selectedAccidentArea.x + selectedAccidentArea.width / 2) * DISPLAY_SCALE}px + 180px - 20px)`,
                top: `${Math.max(selectedAccidentArea.y * DISPLAY_SCALE - 50, 80)}px`,
              }}
            >
              <div 
                className="flex items-center gap-2 px-2 py-2 rounded-lg shadow-lg"
                style={{
                  background: "#2C2C2C",
                }}
              >
                <button
                  onClick={handleToggleLock}
                  className="p-2 rounded hover:bg-white/10"
                  data-testid="button-toggle-lock-accident-area"
                >
                  <Lock className="w-5 h-5 text-white" />
                </button>
                <button
                  onClick={handleDelete}
                  className="p-2 rounded hover:bg-white/10"
                  data-testid="button-delete-accident-area"
                >
                  <Trash2 className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>
          )}

          {/* 캔버스 영역 - 전체 화면 */}
          <div 
            ref={canvasRef}
            className="flex-1 relative overflow-hidden"
            style={{
              background: "linear-gradient(0deg, rgba(218, 218, 218, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(218, 218, 218, 0.5) 1px, transparent 1px)",
              backgroundSize: "10px 10px",
              cursor: selectedTool === "rectangle" || selectedTool === "accident-area" || selectedTool === "leak" ? "crosshair" : "default",
            }}
            data-testid="canvas-area"
            onClick={handleCanvasClick}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
                {/* 업로드된 이미지들 */}
                {uploadedImages.map((image) => (
                  <div
                    key={image.id}
                    onMouseDown={(e) => handleImageMouseDown(e, image)}
                    style={{
                      position: "absolute",
                      left: `${image.x * DISPLAY_SCALE}px`,
                      top: `${image.y * DISPLAY_SCALE}px`,
                      width: `${image.width * DISPLAY_SCALE}px`,
                      height: `${image.height * DISPLAY_SCALE}px`,
                      border: selectedImageId === image.id ? "2px solid #008FED" : "none",
                      cursor: selectedTool === "pointer" && !image.locked ? "move" : "pointer",
                      zIndex: selectedImageId === image.id ? 10 : 1,
                    }}
                    data-testid={`image-${image.id}`}
                  >
                    <img
                      src={image.src}
                      alt="Uploaded"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        pointerEvents: "none",
                      }}
                    />
                    
                    {/* 리사이즈 핸들 */}
                    {selectedImageId === image.id && !image.locked && (
                      <>
                        {/* 모서리 핸들 */}
                        <div data-testid={`resize-handle-nw-${image.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 'nw', image, 'image')} style={{ position: 'absolute', top: -4, left: -4, width: 8, height: 8, background: '#008FED', cursor: 'nw-resize', zIndex: 10, pointerEvents: 'auto' }} />
                        <div data-testid={`resize-handle-ne-${image.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 'ne', image, 'image')} style={{ position: 'absolute', top: -4, right: -4, width: 8, height: 8, background: '#008FED', cursor: 'ne-resize', zIndex: 10, pointerEvents: 'auto' }} />
                        <div data-testid={`resize-handle-sw-${image.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 'sw', image, 'image')} style={{ position: 'absolute', bottom: -4, left: -4, width: 8, height: 8, background: '#008FED', cursor: 'sw-resize', zIndex: 10, pointerEvents: 'auto' }} />
                        <div data-testid={`resize-handle-se-${image.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 'se', image, 'image')} style={{ position: 'absolute', bottom: -4, right: -4, width: 8, height: 8, background: '#008FED', cursor: 'se-resize', zIndex: 10, pointerEvents: 'auto' }} />
                        {/* 엣지 핸들 */}
                        <div data-testid={`resize-handle-n-${image.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 'n', image, 'image')} style={{ position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)', width: 8, height: 8, background: '#008FED', cursor: 'n-resize', zIndex: 10, pointerEvents: 'auto' }} />
                        <div data-testid={`resize-handle-s-${image.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 's', image, 'image')} style={{ position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)', width: 8, height: 8, background: '#008FED', cursor: 's-resize', zIndex: 10, pointerEvents: 'auto' }} />
                        <div data-testid={`resize-handle-e-${image.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 'e', image, 'image')} style={{ position: 'absolute', top: '50%', right: -4, transform: 'translateY(-50%)', width: 8, height: 8, background: '#008FED', cursor: 'e-resize', zIndex: 10, pointerEvents: 'auto' }} />
                        <div data-testid={`resize-handle-w-${image.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 'w', image, 'image')} style={{ position: 'absolute', top: '50%', left: -4, transform: 'translateY(-50%)', width: 8, height: 8, background: '#008FED', cursor: 'w-resize', zIndex: 10, pointerEvents: 'auto' }} />
                      </>
                    )}
                  </div>
                ))}

                {/* 사각형들 */}
                {rectangles.map((rect) => (
                  <div
                    key={rect.id}
                    onMouseDown={(e) => handleRectangleMouseDown(e, rect)}
                    style={{
                      position: "absolute",
                      left: `${rect.x * DISPLAY_SCALE}px`,
                      top: `${rect.y * DISPLAY_SCALE}px`,
                      width: `${rect.width * DISPLAY_SCALE}px`,
                      height: `${rect.height * DISPLAY_SCALE}px`,
                      border: selectedRectangleId === rect.id 
                        ? `2px solid #0C0C0C` 
                        : `1px solid #0C0C0C`,
                      boxShadow: selectedRectangleId === rect.id ? "0 0 0 2px #008FED" : "none",
                      background: rect.backgroundColor || "#FFFFFF",
                      cursor: selectedTool === "pointer" && !rect.locked ? "move" : "pointer",
                      zIndex: selectedRectangleId === rect.id ? 15 : 5,
                    }}
                    data-testid={`rectangle-${rect.id}`}
                  >
                    {/* 텍스트 입력 */}
                    {selectedRectangleId === rect.id ? (
                      <input
                        type="text"
                        value={rect.text}
                        onChange={(e) => handleRectangleTextChange(e.target.value)}
                        placeholder="텍스트 입력"
                        className="w-full h-full text-center border-none outline-none bg-transparent"
                        style={{
                          fontFamily: "Pretendard",
                          fontSize: "14px",
                          color: "#0C0C0C",
                        }}
                        data-testid="input-rectangle-text"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span
                          style={{
                            fontFamily: "Pretendard",
                            fontSize: "14px",
                            color: "#0C0C0C",
                          }}
                        >
                          {rect.text || ""}
                        </span>
                      </div>
                    )}

                    {/* mm 표시 (하단 - 도형 하단 가장자리) */}
                    <div
                      style={{
                        position: "absolute",
                        bottom: "2px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "rgba(255, 255, 255, 0.95)",
                        padding: "2px 6px",
                        borderRadius: "3px",
                        fontSize: "10px",
                        fontFamily: "Pretendard",
                        fontWeight: 500,
                        color: "#0C0C0C",
                        whiteSpace: "nowrap",
                        border: "1px solid rgba(12, 12, 12, 0.2)",
                        zIndex: 10,
                      }}
                    >
                      {rect.width.toLocaleString()} mm
                    </div>

                    {/* mm 표시 (우측 - 도형 우측 가장자리) */}
                    <div
                      style={{
                        position: "absolute",
                        right: "2px",
                        top: "50%",
                        transform: "translateY(-50%) rotate(90deg)",
                        transformOrigin: "center center",
                        background: "rgba(255, 255, 255, 0.95)",
                        padding: "2px 6px",
                        borderRadius: "3px",
                        fontSize: "10px",
                        fontFamily: "Pretendard",
                        fontWeight: 500,
                        color: "#0C0C0C",
                        whiteSpace: "nowrap",
                        border: "1px solid rgba(12, 12, 12, 0.2)",
                        zIndex: 10,
                      }}
                    >
                      {rect.height.toLocaleString()} mm
                    </div>
                  </div>
                ))}

                {/* 사각형 드래그 미리보기 (윈도우 캡처 스타일) */}
                {isDrawing && selectedTool === "rectangle" && (() => {
                  const previewX = Math.min(drawStart.x, drawCurrent.x);
                  const previewY = Math.min(drawStart.y, drawCurrent.y);
                  const previewWidth = Math.abs(drawCurrent.x - drawStart.x);
                  const previewHeight = Math.abs(drawCurrent.y - drawStart.y);
                  
                  // 치수 계산 (화면 픽셀 → 실제 mm)
                  const widthMm = previewWidth / DISPLAY_SCALE;
                  const heightMm = previewHeight / DISPLAY_SCALE;
                  
                  // 항상 mm로 표시
                  const formatDimension = (mm: number) => {
                    return `${Math.round(mm)} mm`;
                  };
                  
                  return (
                    <div
                      style={{
                        position: "absolute",
                        left: `${previewX}px`,
                        top: `${previewY}px`,
                        width: `${previewWidth}px`,
                        height: `${previewHeight}px`,
                        border: "2px solid #008FED",
                        background: "rgba(0, 143, 237, 0.1)",
                        pointerEvents: "none",
                        zIndex: 100,
                      }}
                    >
                      {/* 가로 치수 표시 (상단 중앙) */}
                      {previewWidth > 40 && (
                        <div
                          style={{
                            position: "absolute",
                            top: "-22px",
                            left: "50%",
                            transform: "translateX(-50%)",
                            background: "rgba(0, 143, 237, 0.9)",
                            color: "white",
                            padding: "2px 6px",
                            borderRadius: "3px",
                            fontSize: "11px",
                            fontWeight: "bold",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatDimension(widthMm)}
                        </div>
                      )}
                      {/* 세로 치수 표시 (우측 중앙) */}
                      {previewHeight > 30 && (
                        <div
                          style={{
                            position: "absolute",
                            top: "50%",
                            right: "-8px",
                            transform: "translateY(-50%) translateX(100%)",
                            background: "rgba(0, 143, 237, 0.9)",
                            color: "white",
                            padding: "2px 6px",
                            borderRadius: "3px",
                            fontSize: "11px",
                            fontWeight: "bold",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatDimension(heightMm)}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* 사고 영역들 */}
                {accidentAreas.map((area) => (
                  <div
                    key={area.id}
                    onMouseDown={(e) => handleAccidentAreaMouseDown(e, area)}
                    style={{
                      position: "absolute",
                      left: `${area.x * DISPLAY_SCALE}px`,
                      top: `${area.y * DISPLAY_SCALE}px`,
                      width: `${area.width * DISPLAY_SCALE}px`,
                      height: `${area.height * DISPLAY_SCALE}px`,
                      border: selectedAccidentAreaId === area.id ? "2px dashed #008FED" : "2px dashed #9E9E9E",
                      background: "rgba(189, 189, 189, 0.3)",
                      cursor: selectedTool === "pointer" && !area.locked ? "move" : "pointer",
                      zIndex: selectedAccidentAreaId === area.id ? 60 : 50,
                    }}
                    data-testid={`accident-area-${area.id}`}
                  >
                    {/* 리사이즈 핸들 */}
                    {selectedAccidentAreaId === area.id && !area.locked && (
                      <>
                        {/* 모서리 핸들 */}
                        <div data-testid={`resize-handle-nw-${area.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 'nw', area, 'accident-area')} style={{ position: 'absolute', top: -4, left: -4, width: 8, height: 8, background: '#008FED', cursor: 'nw-resize', zIndex: 10, pointerEvents: 'auto' }} />
                        <div data-testid={`resize-handle-ne-${area.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 'ne', area, 'accident-area')} style={{ position: 'absolute', top: -4, right: -4, width: 8, height: 8, background: '#008FED', cursor: 'ne-resize', zIndex: 10, pointerEvents: 'auto' }} />
                        <div data-testid={`resize-handle-sw-${area.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 'sw', area, 'accident-area')} style={{ position: 'absolute', bottom: -4, left: -4, width: 8, height: 8, background: '#008FED', cursor: 'sw-resize', zIndex: 10, pointerEvents: 'auto' }} />
                        <div data-testid={`resize-handle-se-${area.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 'se', area, 'accident-area')} style={{ position: 'absolute', bottom: -4, right: -4, width: 8, height: 8, background: '#008FED', cursor: 'se-resize', zIndex: 10, pointerEvents: 'auto' }} />
                        {/* 엣지 핸들 */}
                        <div data-testid={`resize-handle-n-${area.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 'n', area, 'accident-area')} style={{ position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)', width: 8, height: 8, background: '#008FED', cursor: 'n-resize', zIndex: 10, pointerEvents: 'auto' }} />
                        <div data-testid={`resize-handle-s-${area.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 's', area, 'accident-area')} style={{ position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)', width: 8, height: 8, background: '#008FED', cursor: 's-resize', zIndex: 10, pointerEvents: 'auto' }} />
                        <div data-testid={`resize-handle-e-${area.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 'e', area, 'accident-area')} style={{ position: 'absolute', top: '50%', right: -4, transform: 'translateY(-50%)', width: 8, height: 8, background: '#008FED', cursor: 'e-resize', zIndex: 10, pointerEvents: 'auto' }} />
                        <div data-testid={`resize-handle-w-${area.id}`} onMouseDown={(e) => handleResizeHandleMouseDown(e, 'w', area, 'accident-area')} style={{ position: 'absolute', top: '50%', left: -4, transform: 'translateY(-50%)', width: 8, height: 8, background: '#008FED', cursor: 'w-resize', zIndex: 10, pointerEvents: 'auto' }} />
                      </>
                    )}
                  </div>
                ))}

                {/* 사고 영역 드래그 미리보기 */}
                {isDrawing && selectedTool === "accident-area" && (() => {
                  const previewX = Math.min(drawStart.x, drawCurrent.x);
                  const previewY = Math.min(drawStart.y, drawCurrent.y);
                  const previewWidth = Math.abs(drawCurrent.x - drawStart.x);
                  const previewHeight = Math.abs(drawCurrent.y - drawStart.y);
                  
                  return (
                    <div
                      style={{
                        position: "absolute",
                        left: `${previewX}px`,
                        top: `${previewY}px`,
                        width: `${previewWidth}px`,
                        height: `${previewHeight}px`,
                        border: "2px dashed #9E9E9E",
                        background: "rgba(189, 189, 189, 0.2)",
                        pointerEvents: "none",
                        zIndex: 100,
                      }}
                    />
                  );
                })()}

                {/* 누수 마커들 */}
                {leakMarkers.map((marker) => (
                  <div
                    key={marker.id}
                    onMouseDown={(e) => handleLeakMarkerMouseDown(e, marker)}
                    style={{
                      position: "absolute",
                      left: `${marker.x * DISPLAY_SCALE - 15}px`,
                      top: `${marker.y * DISPLAY_SCALE - 15}px`,
                      width: "30px",
                      height: "30px",
                      cursor: selectedTool === "pointer" ? "move" : "pointer",
                      zIndex: selectedLeakId === marker.id ? 110 : 100,
                    }}
                    data-testid={`leak-marker-${marker.id}`}
                  >
                    {/* 빨간 원 */}
                    <div
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        background: "#E53935",
                        position: "absolute",
                        top: "5px",
                        left: "5px",
                        border: selectedLeakId === marker.id ? "2px solid #008FED" : "none",
                      }}
                    />
                    {/* 파란 삼각형 (하단) */}
                    <div
                      style={{
                        width: "0",
                        height: "0",
                        borderLeft: "8px solid transparent",
                        borderRight: "8px solid transparent",
                        borderTop: "12px solid #1976D2",
                        position: "absolute",
                        bottom: "0",
                        left: "7px",
                      }}
                    />
                  </div>
                ))}
          </div>
        </div>
      </div>
    </>
  );
}
