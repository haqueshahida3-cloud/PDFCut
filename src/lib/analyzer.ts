// Main-thread checks that need pdf.js: blank-page detection, text direction per page, find-and-replace match
// boxes, residual-text verification, and the sampling used by the accessibility checker. The pure rules live in
// lib/pdf/*.ts. Limit: text positions are taken from PDF user space, so matches on rotated pages can be offset.
import type { NormBox } from './pdf/raster-core';
import { dominantQuarter, type AngleSample } from './pdf/analyze';
import { countResidual } from './pdf/verify';
import { openPdf, pageText, readOutline, renderPageTo, type PdfDoc } from './pdfjs';

export interface PageVisual {
  blank: boolean;
  quarter: number | null; // dominant text direction (0, 90, 180, 270) or null without text
}

export interface MatchBoxes {
  page: number; // 0-based
  boxes: NormBox[];
}

function isBlankCanvas(canvas: HTMLCanvasElement): boolean {
  const cx = canvas.getContext('2d');
  if (!cx || canvas.width === 0 || canvas.height === 0) return false;
  const data = cx.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) ink++;
  }
  return ink / (data.length / 4) < 0.002;
}

/**
 * Walks every page: a small render decides "blank", and the text layer decides text direction.
 * Yields to the event loop regularly so the UI stays responsive. Stops early when isCancelled() is true.
 */
export async function scanPageVisuals(
  doc: PdfDoc,
  isCancelled: () => boolean,
  onPage: (index: number, visual: PageVisual) => void,
): Promise<void> {
  for (let p = 1; p <= doc.numPages; p++) {
    if (isCancelled()) return;
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const samples: AngleSample[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str) continue;
      samples.push({ angle: (Math.atan2(it.transform[1], it.transform[0]) * 180) / Math.PI, weight: it.str.length });
    }
    const quarter = dominantQuarter(samples)?.quarter ?? null;
    const canvas = document.createElement('canvas');
    await renderPageTo(page, canvas, 60 / page.getViewport({ scale: 1 }).width).promise;
    const blank = isBlankCanvas(canvas);
    page.cleanup();
    onPage(p - 1, { blank, quarter });
    if (p % 10 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/** Boxes (normalized, top-left origin) of every occurrence of `needle` inside a single text item. */
export async function findTextBoxes(doc: PdfDoc, needle: string, caseSensitive: boolean): Promise<MatchBoxes[]> {
  const q = caseSensitive ? needle : needle.toLowerCase();
  if (!q) return [];
  const out: MatchBoxes[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const text = await pageText(page);
    page.cleanup();
    const boxes: NormBox[] = [];
    for (const b of text.boxes) {
      const s = caseSensitive ? b.str : b.str.toLowerCase();
      const len = b.str.length || 1;
      let i = s.indexOf(q);
      while (i >= 0) {
        boxes.push({
          x: b.x / text.width + (b.w / text.width) * (i / len),
          y: (text.height - (b.y + b.h)) / text.height,
          w: (b.w / text.width) * (q.length / len),
          h: b.h / text.height,
        });
        i = s.indexOf(q, i + q.length);
      }
    }
    if (boxes.length > 0) out.push({ page: p - 1, boxes });
  }
  return out;
}

/** For each needle, how many times it still appears in the text layer of `bytes`. */
export async function residualCounts(bytes: Uint8Array, needles: string[], caseSensitive: boolean): Promise<number[]> {
  // The verification reads the whole output once; the counts are per needle.
  const doc = await openPdf(bytes);
  try {
    const texts: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      texts.push((await pageText(page)).text);
      page.cleanup();
    }
    return needles.map((n) => countResidual(texts, n, caseSensitive));
  } finally {
    await doc.destroy();
  }
}

/** Bookmark count plus text presence on a spread of pages, for the accessibility checker. */
export async function sampleTextAndBookmarks(
  doc: PdfDoc,
  maxSamples = 12,
): Promise<{ bookmarks: number; sampledPages: number; sampledWithText: number }> {
  const bookmarks = (await readOutline(doc)).length;
  const step = Math.max(1, Math.floor(doc.numPages / maxSamples));
  const pages: number[] = [];
  for (let p = 1; p <= doc.numPages; p += step) pages.push(p);
  let withText = 0;
  for (const p of pages) {
    const page = await doc.getPage(p);
    const text = await pageText(page);
    page.cleanup();
    if (text.text.trim().length > 0) withText++;
  }
  return { bookmarks, sampledPages: pages.length, sampledWithText: withText };
}
