import html2canvas, { type Options as Html2CanvasOptions } from "html2canvas";
import jsPDF, { type jsPDFOptions } from "jspdf";

type MarginValue = number | [number, number] | [number, number, number, number];

interface Html2PdfOptions {
  margin?: MarginValue;
  filename?: string;
  html2canvas?: Partial<Html2CanvasOptions>;
  jsPDF?: jsPDFOptions;
}

interface NormalizedMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const DEFAULT_FILENAME = "document.pdf";
const DEFAULT_MARGIN: NormalizedMargin = { top: 0, right: 0, bottom: 0, left: 0 };

class Html2PdfWorker {
  private sourceElement: HTMLElement | null = null;
  private options: Html2PdfOptions;

  constructor(options?: Html2PdfOptions) {
    this.options = options || {};
  }

  from(source: HTMLElement | string): this {
    if (typeof source === "string") {
      const targetElement = document.querySelector(source);
      this.sourceElement = targetElement as HTMLElement | null;
      return this;
    }

    this.sourceElement = source;
    return this;
  }

  set(options: Html2PdfOptions): this {
    this.options = {
      ...this.options,
      ...options,
      html2canvas: { ...this.options.html2canvas, ...options.html2canvas },
      jsPDF: { ...this.options.jsPDF, ...options.jsPDF },
    };

    return this;
  }

  async save(): Promise<void> {
    if (!this.sourceElement) {
      throw new Error("PDF로 변환할 요소를 찾을 수 없습니다.");
    }

    const html2canvasOptions = (this.options.html2canvas ?? {}) as Html2CanvasOptions;
    const canvas = await html2canvas(this.sourceElement, html2canvasOptions);
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF(this.options.jsPDF || {});

    const margin = this.normalizeMargin(this.options.margin);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const availableWidth = pageWidth - margin.left - margin.right;
    const availableHeight = pageHeight - margin.top - margin.bottom;

    const canvasRatio = canvas.height / canvas.width;

    let renderWidth = availableWidth;
    let renderHeight = availableWidth * canvasRatio;

    if (renderHeight > availableHeight) {
      renderHeight = availableHeight;
      renderWidth = availableHeight / canvasRatio;
    }

    pdf.addImage(imgData, "PNG", margin.left, margin.top, renderWidth, renderHeight);

    pdf.save(this.options.filename || DEFAULT_FILENAME);
  }

  private normalizeMargin(margin?: MarginValue): NormalizedMargin {
    if (margin === undefined) {
      return DEFAULT_MARGIN;
    }

    if (typeof margin === "number") {
      return { top: margin, right: margin, bottom: margin, left: margin };
    }

    if (margin.length === 2) {
      const [vertical, horizontal] = margin;
      return { top: vertical, right: horizontal, bottom: vertical, left: horizontal };
    }

    const [top, right, bottom, left] = margin;
    return { top, right, bottom, left };
  }
}

export default function html2pdf(options?: Html2PdfOptions): Html2PdfWorker {
  return new Html2PdfWorker(options);
}
