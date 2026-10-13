"use client";
import { MAX_PAGE_BYTES } from "./pdf-schema";

/** Files read by the PDF reader rather than the spreadsheet reader. */
export const isPdfLike = (f: { name: string }) => /\.(pdf|jpe?g|png)$/i.test(f.name);
export const MAX_PDF_PAGES = 40;

type PdfJs = typeof import("pdfjs-dist");
let pdfjs: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m;
  });
  return pdfjs;
}

const canvasJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("The page could not be converted to an image."))), "image/jpeg", quality));

/** A JPEG under the size limit: lower quality first, then a smaller picture. */
async function fitJpeg(draw: (scale: number) => HTMLCanvasElement): Promise<Blob> {
  for (const scale of [1, 0.75, 0.55]) {
    const canvas = draw(scale);
    for (const q of [0.85, 0.7, 0.55]) {
      const b = await canvasJpeg(canvas, q);
      if (b.size <= MAX_PAGE_BYTES) return b;
    }
  }
  throw new Error("This page is too large to send even as an image. Scan it at a lower resolution.");
}

/** One uploaded PDF or scanned image, opened in the browser: its page count, each page ready to send, and a picture of each page. */
export interface OpenedFile {
  name: string;
  pages: number;
  /** The page as a one-page PDF, or as a JPEG when the PDF page is too large or the file is an image. */
  page(n: number): Promise<Blob>;
  /** A picture of the page about `width` pixels wide, for checking what was read. */
  preview(n: number, width: number): Promise<string>;
}

export async function openFile(file: File): Promise<OpenedFile> {
  const data = new Uint8Array(await file.arrayBuffer());
  if (/\.(jpe?g|png)$/i.test(file.name)) {
    const bmp = await createImageBitmap(new Blob([data]));
    // Scans are read at up to 2,400 pixels on the long side: enough for small print, small enough to send.
    const draw = (scale: number) => {
      const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height)) * scale;
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      return c;
    };
    const blob = fitJpeg(draw);
    return { name: file.name, pages: 1, page: () => blob, preview: async () => URL.createObjectURL(await blob) };
  }

  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: data.slice() }).promise.catch((e: Error) => {
    throw new Error(/password/i.test(e?.name + e?.message) ? `${file.name} is protected by a password. Save it without the password and upload it again.` : `${file.name} could not be opened as a PDF.`);
  });
  const render = async (n: number, width: number) => {
    const pg = await doc.getPage(n);
    const base = pg.getViewport({ scale: 1 });
    const viewport = pg.getViewport({ scale: width / base.width });
    const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(viewport.width), height: Math.round(viewport.height) });
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pg.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas;
  };
  // pdf-lib cuts single pages without re-encoding them; a damaged or locked file falls back to pictures of its pages.
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false }).catch(() => null);
  const asJpeg = async (n: number) => {
    const pg = await doc.getPage(n);
    const w = pg.getViewport({ scale: 150 / 72 }).width; // 150 dpi
    const canvas = await render(n, Math.min(w, 2400));
    return fitJpeg((scale) => {
      if (scale === 1) return canvas;
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(canvas.width * scale), height: Math.round(canvas.height * scale) });
      c.getContext("2d")!.drawImage(canvas, 0, 0, c.width, c.height);
      return c;
    });
  };
  return {
    name: file.name,
    pages: doc.numPages,
    async page(n) {
      if (src) {
        try {
          const one = await PDFDocument.create();
          const [p] = await one.copyPages(src, [n - 1]);
          one.addPage(p);
          const bytes = await one.save({ useObjectStreams: false });
          if (bytes.byteLength <= MAX_PAGE_BYTES) return new Blob([bytes as BlobPart], { type: "application/pdf" });
        } catch { /* fall back to a picture of the page */ }
      }
      return asJpeg(n);
    },
    async preview(n, width) {
      const c = await render(n, width);
      return URL.createObjectURL(await canvasJpeg(c, 0.8));
    },
  };
}
