import { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut } from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

interface PdfCanvasViewerProps {
  pdfData: ArrayBuffer | null;
  loading: boolean;
  error: string | null;
  fileName?: string;
}

interface PageData {
  canvas: HTMLCanvasElement;
  thumbnail: HTMLCanvasElement;
}

export function PdfCanvasViewer({ pdfData, loading, error, fileName }: PdfCanvasViewerProps) {
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const thumbnailContainerRef = useRef<HTMLDivElement>(null);
  const [pageDataList, setPageDataList] = useState<PageData[]>([]);
  const [rendering, setRendering] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(100);
  const scrollingToPage = useRef(false);

  const renderPdf = useCallback(async (data: ArrayBuffer) => {
    setRendering(true);
    try {
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
      setTotalPages(pdf.numPages);
      setCurrentPage(1);
      const results: PageData[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);

        const mainScale = 2.0;
        const mainViewport = page.getViewport({ scale: mainScale });
        const mainCanvas = document.createElement("canvas");
        const mainCtx = mainCanvas.getContext("2d")!;
        mainCanvas.width = mainViewport.width;
        mainCanvas.height = mainViewport.height;
        await page.render({ canvasContext: mainCtx, viewport: mainViewport, canvas: mainCanvas } as any).promise;

        const thumbScale = 0.3;
        const thumbViewport = page.getViewport({ scale: thumbScale });
        const thumbCanvas = document.createElement("canvas");
        const thumbCtx = thumbCanvas.getContext("2d")!;
        thumbCanvas.width = thumbViewport.width;
        thumbCanvas.height = thumbViewport.height;
        await page.render({ canvasContext: thumbCtx, viewport: thumbViewport, canvas: thumbCanvas } as any).promise;

        results.push({ canvas: mainCanvas, thumbnail: thumbCanvas });
      }
      setPageDataList(results);
    } catch (err) {
      console.error("PDF render error:", err);
    } finally {
      setRendering(false);
    }
  }, []);

  useEffect(() => {
    if (pdfData) {
      renderPdf(pdfData);
    } else {
      setPageDataList([]);
      setTotalPages(0);
      setCurrentPage(1);
      setZoomLevel(100);
    }
  }, [pdfData, renderPdf]);

  useEffect(() => {
    const container = mainContainerRef.current;
    if (!container || pageDataList.length === 0) return;

    container.innerHTML = "";
    pageDataList.forEach((pd, idx) => {
      const wrapper = document.createElement("div");
      wrapper.style.marginBottom = "16px";
      wrapper.style.display = "flex";
      wrapper.style.justifyContent = "center";
      wrapper.dataset.pageIndex = String(idx + 1);

      const canvasClone = pd.canvas.cloneNode(true) as HTMLCanvasElement;
      const ctx = canvasClone.getContext("2d");
      if (ctx) {
        ctx.drawImage(pd.canvas, 0, 0);
      }
      canvasClone.style.width = `${zoomLevel}%`;
      canvasClone.style.height = "auto";
      canvasClone.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
      canvasClone.style.background = "#fff";

      wrapper.appendChild(canvasClone);
      container.appendChild(wrapper);
    });
  }, [pageDataList, zoomLevel]);

  const handleMainScroll = useCallback(() => {
    if (scrollingToPage.current) return;
    const container = mainContainerRef.current;
    if (!container) return;
    const children = container.children;
    const containerRect = container.getBoundingClientRect();

    for (let i = 0; i < children.length; i++) {
      const child = children[i] as HTMLElement;
      const rect = child.getBoundingClientRect();
      const relativeTop = rect.top - containerRect.top;

      if (relativeTop + rect.height > 0 && relativeTop < containerRect.height / 2) {
        setCurrentPage(i + 1);
        break;
      }
    }
  }, []);

  const scrollToPage = useCallback((pageNum: number) => {
    const container = mainContainerRef.current;
    if (!container) return;
    const target = container.children[pageNum - 1] as HTMLElement;
    if (!target) return;

    scrollingToPage.current = true;
    setCurrentPage(pageNum);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => { scrollingToPage.current = false; }, 500);
  }, []);

  useEffect(() => {
    const thumbContainer = thumbnailContainerRef.current;
    if (!thumbContainer) return;
    const activeThumb = thumbContainer.children[currentPage - 1] as HTMLElement;
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [currentPage]);

  const handleDownload = useCallback(() => {
    if (!pdfData) return;
    const blob = new Blob([pdfData], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "document.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }, [pdfData, fileName]);

  if (loading || rendering) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "12px" }}>
        <div className="animate-spin" style={{ width: "40px", height: "40px", border: "3px solid #e5e7eb", borderTop: "3px solid #008FED", borderRadius: "50%" }} />
        <span style={{ fontFamily: "Pretendard", fontSize: "14px", color: "#6b7280" }}>PDF 생성 중...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "12px", padding: "20px" }}>
        <span style={{ fontFamily: "Pretendard", fontSize: "14px", color: "#ef4444" }}>{error}</span>
      </div>
    );
  }

  if (!pdfData || pageDataList.length === 0) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "Pretendard" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 48px 8px 16px",
        borderBottom: "1px solid #e5e7eb",
        background: "#f8f9fa",
        flexShrink: 0,
        gap: "8px",
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", color: "#374151", minWidth: 0 }} data-testid="pdf-file-info">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <path d="M7 18h10v-2H7v2zm0-4h10v-2H7v2zm-2 8c-.55 0-1.02-.196-1.412-.587A1.926 1.926 0 013 20V4c0-.55.196-1.02.588-1.413A1.926 1.926 0 015 2h8l6 6v12c0 .55-.196 1.02-.587 1.413A1.926 1.926 0 0117 22H5zm7-13V4H5v16h12V9h-5z" fill="#ef4444"/>
          </svg>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {fileName || "PDF 문서"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            style={{ background: "none", border: "none", cursor: currentPage <= 1 ? "not-allowed" : "pointer", padding: "4px", borderRadius: "4px", display: "flex", opacity: currentPage <= 1 ? 0.3 : 1 }}
            data-testid="button-pdf-prev-page"
          >
            <ChevronLeft size={18} color="#374151" />
          </button>
          <span style={{ fontSize: "13px", color: "#374151", whiteSpace: "nowrap" }}>
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => scrollToPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            style={{ background: "none", border: "none", cursor: currentPage >= totalPages ? "not-allowed" : "pointer", padding: "4px", borderRadius: "4px", display: "flex", opacity: currentPage >= totalPages ? 0.3 : 1 }}
            data-testid="button-pdf-next-page"
          >
            <ChevronRight size={18} color="#374151" />
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            onClick={() => setZoomLevel(z => Math.max(50, z - 25))}
            disabled={zoomLevel <= 50}
            style={{ background: "none", border: "none", cursor: zoomLevel <= 50 ? "not-allowed" : "pointer", padding: "4px", borderRadius: "4px", display: "flex", opacity: zoomLevel <= 50 ? 0.3 : 1 }}
            data-testid="button-pdf-zoom-out"
          >
            <ZoomOut size={18} color="#374151" />
          </button>
          <span style={{ fontSize: "12px", color: "#6b7280", minWidth: "40px", textAlign: "center" }}>{zoomLevel}%</span>
          <button
            onClick={() => setZoomLevel(z => Math.min(200, z + 25))}
            disabled={zoomLevel >= 200}
            style={{ background: "none", border: "none", cursor: zoomLevel >= 200 ? "not-allowed" : "pointer", padding: "4px", borderRadius: "4px", display: "flex", opacity: zoomLevel >= 200 ? 0.3 : 1 }}
            data-testid="button-pdf-zoom-in"
          >
            <ZoomIn size={18} color="#374151" />
          </button>
          <div style={{ width: "1px", height: "18px", background: "#d1d5db", margin: "0 4px" }} />
          <button
            onClick={handleDownload}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", borderRadius: "4px", display: "flex" }}
            data-testid="button-pdf-download"
          >
            <Download size={18} color="#374151" />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div
          ref={thumbnailContainerRef}
          style={{
            width: "160px",
            minWidth: "160px",
            borderRight: "1px solid #e5e7eb",
            overflowY: "auto",
            overflowX: "hidden",
            background: "#f3f4f6",
            padding: "12px 8px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
          data-testid="pdf-thumbnail-panel"
        >
          {pageDataList.map((pd, idx) => {
            const isActive = currentPage === idx + 1;
            return (
              <div
                key={idx}
                onClick={() => scrollToPage(idx + 1)}
                style={{
                  cursor: "pointer",
                  border: isActive ? "2px solid #008FED" : "2px solid transparent",
                  borderRadius: "4px",
                  padding: "4px",
                  background: isActive ? "#dbeafe" : "transparent",
                  transition: "border-color 0.15s, background 0.15s",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "4px",
                }}
                data-testid={`pdf-thumbnail-${idx + 1}`}
              >
                <canvas
                  ref={(el) => {
                    if (el && pd.thumbnail) {
                      el.width = pd.thumbnail.width;
                      el.height = pd.thumbnail.height;
                      const ctx = el.getContext("2d");
                      if (ctx) ctx.drawImage(pd.thumbnail, 0, 0);
                    }
                  }}
                  style={{ width: "100%", height: "auto", boxShadow: "0 1px 3px rgba(0,0,0,0.12)", background: "#fff" }}
                />
                <span style={{ fontSize: "11px", color: isActive ? "#008FED" : "#9ca3af", fontWeight: isActive ? 600 : 400 }}>
                  {idx + 1}
                </span>
              </div>
            );
          })}
        </div>

        <div
          ref={mainContainerRef}
          onScroll={handleMainScroll}
          style={{
            flex: 1,
            overflow: "auto",
            padding: "16px",
            background: "#e5e7eb",
          }}
          data-testid="pdf-canvas-container"
        />
      </div>
    </div>
  );
}
