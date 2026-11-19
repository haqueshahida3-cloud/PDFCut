// pdf.js helpers for the main thread: document loading, page rendering, text extraction,
// outlines and metadata. Parsing runs in pdf.js's own worker (inlined into the bundle).
import * as pdfjs from 'pdfjs-dist';

/**
 * URL of pdf.js's parser worker. It is served from public/pdfjs so it stays out of the JS bundle.
 * Resolved from the origin (not the full href) so it also works inside a blob: worker.
 */
export function pdfWorkerUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}pdfjs/worker-entry.mjs`, globalThis.location.origin).href;
}

let configured = false;
export function pdfjsLib(): typeof pdfjs {
  if (!configured) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl();
    configured = true;
  }
  return pdfjs;
}

export type PdfDoc = pdfjs.PDFDocumentProxy;
export type PdfPage = pdfjs.PDFPageProxy;
export type RenderTask = ReturnType<PdfPage['render']>;

let nestedWorker: pdfjs.PDFWorker | null = null;

/**
 * Inside a Web Worker there is no window, so pdf.js cannot start its parser worker by itself. It then runs the
 * parser in the same thread, which takes over this worker's message handler. Passing an explicit worker keeps
 * the parser in its own thread.
 */
function workerForThisContext(): pdfjs.PDFWorker | undefined {
  if (typeof window !== 'undefined') return undefined;
  if (!nestedWorker) {
    nestedWorker = pdfjs.PDFWorker.create({ port: new Worker(pdfWorkerUrl(), { type: 'module' }) });
  }
  return nestedWorker;
}

export function openPdf(bytes: Uint8Array, password?: string): Promise<PdfDoc> {
  // pdf.js may transfer the buffer it receives, so always hand it a copy.
  return pdfjsLib().getDocument({
    data: bytes.slice(),
    password,
    isEvalSupported: false,
    useSystemFonts: true,
    worker: workerForThisContext(),
  }).promise;
}

export function isRenderCancelled(e: unknown): boolean {
  return e instanceof Error && e.name === 'RenderingCancelledException';
}

/** Renders a page into a canvas on a white background. Returns the cancellable task. */
export function renderPageTo(page: PdfPage, canvas: HTMLCanvasElement, scale: number): RenderTask {
  const vp = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.ceil(vp.width));
  canvas.height = Math.max(1, Math.ceil(vp.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return page.render({ canvasContext: ctx, viewport: vp, canvas });
}

export interface TextBox {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PageText {
  width: number;
  height: number;
  boxes: TextBox[];
  lines: string[];
  text: string;
}

/** Text of one page grouped into visual lines (top to bottom, left to right). */
export async function pageText(page: PdfPage): Promise<PageText> {
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const boxes: TextBox[] = [];
  for (const it of content.items) {
    if (!('str' in it) || !it.str) continue;
    boxes.push({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      h: Math.abs(it.transform[3]) || it.height || 10,
    });
  }
  const sorted = [...boxes].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: string[] = [];
  let curY: number | null = null;
  let cur = '';
  let lastEnd = 0;
  for (const b of sorted) {
    if (curY === null || Math.abs(b.y - curY) > b.h * 0.5) {
      if (cur) lines.push(cur);
      cur = b.str;
      curY = b.y;
    } else {
      const gap = b.x - lastEnd;
      cur += (gap > b.h * 0.2 ? ' ' : '') + b.str;
    }
    lastEnd = b.x + b.w;
  }
  if (cur) lines.push(cur);
  return { width: vp.width, height: vp.height, boxes, lines, text: lines.join('\n') };
}

type DestRef = Parameters<PdfDoc['getPageIndex']>[0];

/** Resolves an outline destination to a 0-based page index. */
export async function destPage(doc: PdfDoc, dest: unknown): Promise<number | null> {
  try {
    const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(d) || d.length === 0) return null;
    const ref = d[0];
    if (typeof ref === 'number') return ref;
    return await doc.getPageIndex(ref as DestRef);
  } catch {
    return null;
  }
}

export interface OutlineItem {
  title: string;
  page: number;
  depth: number;
}
interface OutlineNode {
  title: string;
  dest: unknown;
  items?: OutlineNode[];
}

export async function readOutline(doc: PdfDoc): Promise<OutlineItem[]> {
  const out: OutlineItem[] = [];
  const walk = async (nodes: OutlineNode[], depth: number): Promise<void> => {
    for (const n of nodes) {
      const page = await destPage(doc, n.dest);
      if (page !== null) out.push({ title: n.title, page, depth });
      if (n.items && n.items.length) await walk(n.items, depth + 1);
    }
  };
  const tree = (await doc.getOutline()) as unknown as OutlineNode[] | null;
  if (tree) await walk(tree, 0);
  return out;
}

export async function readInfo(doc: PdfDoc): Promise<Record<string, string>> {
  const meta = await doc.getMetadata();
  const info = (meta.info ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(info)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export interface Attachment {
  filename: string;
  content: Uint8Array;
}
export async function readAttachments(doc: PdfDoc): Promise<Attachment[]> {
  const map = await doc.getAttachments();
  if (!map) return [];
  const list = Object.values(map) as Array<{ filename: string; content: Uint8Array }>;
  return list.map((a) => ({ filename: a.filename, content: a.content }));
}
