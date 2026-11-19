// Rasterization that runs inside the PDF worker (pdf.js + OffscreenCanvas). The main thread only receives
// finished bytes. Used by compression, permanent redaction and find-and-replace.
import type { PdfDoc, PdfPage } from '../pdfjs';
import { openPdf } from '../pdfjs';
import { annotatePdf, imagePages, mergeFiles, type Ctx, type ImagePage } from './ops';

export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ReplaceBox extends NormBox {
  text: string;
}
export interface ReplaceEdit {
  page: number; // 0-based
  boxes: ReplaceBox[];
}
export interface CompressOpts {
  scale: number; // 1 = 72 dpi
  quality: number; // JPEG quality 0..1
  batch?: number;
}

const silent = (ctx: Ctx): Ctx => ({ report: () => undefined, checkpoint: ctx.checkpoint });

/** Renders one page to a JPEG. The optional overlay draws on top before encoding. */
export async function renderJpeg(
  page: PdfPage,
  scale: number,
  quality: number,
  overlay?: (cx: CanvasRenderingContext2D, w: number, h: number) => void,
): Promise<ImagePage> {
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale });
  const w = Math.max(1, Math.ceil(vp.width));
  const h = Math.max(1, Math.ceil(vp.height));
  const canvas = new OffscreenCanvas(w, h);
  const cx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  cx.fillStyle = '#ffffff';
  cx.fillRect(0, 0, w, h);
  await page.render({ canvasContext: cx, viewport: vp, canvas: canvas as unknown as HTMLCanvasElement }).promise;
  if (overlay) overlay(cx, w, h);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), kind: 'jpg', width: vp1.width, height: vp1.height };
}

/** Rebuilds every page as a JPEG, in batches, so memory stays bounded for long documents. */
export async function rasterCompress(bytes: Uint8Array, o: CompressOpts, ctx: Ctx): Promise<Uint8Array> {
  const pdf: PdfDoc = await openPdf(bytes);
  const n = pdf.numPages;
  const batch = Math.max(1, o.batch ?? 25);
  const parts: Uint8Array[] = [];
  try {
    for (let start = 1; start <= n; start += batch) {
      const pages: ImagePage[] = [];
      const end = Math.min(n, start + batch - 1);
      for (let p = start; p <= end; p++) {
        await ctx.checkpoint();
        const page = await pdf.getPage(p);
        pages.push(await renderJpeg(page, o.scale, o.quality));
        page.cleanup();
        ctx.report((p - 1) / n, `Rendering page ${p} of ${n}`);
      }
      parts.push(await imagePages(pages, silent(ctx)));
    }
  } finally {
    await pdf.destroy();
  }
  if (parts.length === 1) return parts[0];
  return mergeFiles(
    parts.map((b, i) => ({ bytes: b, name: `part-${i}.pdf` })),
    silent(ctx),
  );
}

/** Burns black boxes into the pixels of the given pages. The hidden text under them is removed. */
export async function redactPages(bytes: Uint8Array, pages: Record<number, NormBox[]>, ctx: Ctx): Promise<Uint8Array> {
  const keys = Object.keys(pages)
    .map(Number)
    .sort((a, b) => a - b);
  if (keys.length === 0) return bytes;
  const pdf = await openPdf(bytes);
  const overrides: Record<number, ImagePage> = {};
  try {
    for (let k = 0; k < keys.length; k++) {
      await ctx.checkpoint();
      const idx = keys[k];
      const boxes = pages[idx];
      const page = await pdf.getPage(idx + 1);
      overrides[idx] = await renderJpeg(page, 2, 0.92, (cx, w, h) => {
        cx.fillStyle = '#000000';
        for (const b of boxes) cx.fillRect(b.x * w, b.y * h, b.w * w, b.h * h);
      });
      page.cleanup();
      ctx.report((k + 1) / keys.length, `Redacting page ${idx + 1}`);
    }
  } finally {
    await pdf.destroy();
  }
  return annotatePdf(bytes, [], overrides, silent(ctx));
}

/**
 * Covers each matched box with white and draws the replacement in its place. Only the edited pages are
 * rasterized, so their original text is gone from the file; other pages stay vector.
 */
export async function replacePages(bytes: Uint8Array, edits: ReplaceEdit[], ctx: Ctx): Promise<Uint8Array> {
  if (edits.length === 0) return bytes;
  const pdf = await openPdf(bytes);
  const overrides: Record<number, ImagePage> = {};
  try {
    for (let k = 0; k < edits.length; k++) {
      await ctx.checkpoint();
      const edit = edits[k];
      const page = await pdf.getPage(edit.page + 1);
      overrides[edit.page] = await renderJpeg(page, 2, 0.92, (cx, w, h) => {
        for (const b of edit.boxes) {
          const x = b.x * w;
          const y = b.y * h;
          const bw = b.w * w;
          const bh = b.h * h;
          cx.fillStyle = '#ffffff';
          cx.fillRect(x - 1, y - 1, bw + 2, bh + 2);
          if (!b.text) continue;
          let size = Math.max(6, bh * 0.8);
          cx.font = `${size}px Helvetica, Arial, sans-serif`;
          const tw = cx.measureText(b.text).width;
          if (tw > bw && tw > 0) size = Math.max(4, size * (bw / tw));
          cx.font = `${size}px Helvetica, Arial, sans-serif`;
          cx.fillStyle = '#000000';
          cx.textBaseline = 'alphabetic';
          cx.fillText(b.text, x, y + bh * 0.8);
        }
      });
      page.cleanup();
      ctx.report((k + 1) / edits.length, `Replacing text on page ${edit.page + 1}`);
    }
  } finally {
    await pdf.destroy();
  }
  return annotatePdf(bytes, [], overrides, silent(ctx));
}
