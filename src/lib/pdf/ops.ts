// Pure PDF operations built on pdf-lib. No DOM access, so they run in a Web Worker,
// in unit tests, and in the command-line tool alike.
import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  StandardFonts,
  degrees,
  rgb,
  type PDFEmbeddedPage,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib';
import { range, stripExt } from '../util';

export interface Ctx {
  report(progress: number, message?: string): void;
  checkpoint(): Promise<void>;
}
export const silentCtx: Ctx = { report: () => undefined, checkpoint: () => Promise.resolve() };

export const PAPERS: Record<string, [number, number]> = {
  a3: [841.89, 1190.55],
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  letter: [612, 792],
  legal: [612, 1008],
};
const A4 = PAPERS.a4;

const norm = (a: number): number => ((a % 360) + 360) % 360;

/** "#rrggbb" or "#rgb" -> [r,g,b] in 0..1 */
export function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Standard PDF fonts only cover WinAnsi; replace anything else. */
export function winAnsi(text: string): string {
  return text.replace(/[^\t\n\r\x20-\x7e\xa0-\xff]/g, '?');
}

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (e instanceof EncryptedPDFError) {
      throw new Error('This PDF is password-protected. Open it in Security → Remove password first.');
    }
    throw new Error('This PDF could not be read. It may be damaged — try Security → Repair.');
  }
}

async function newDoc(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.setProducer('PDFCut');
  doc.setCreator('PDFCut');
  return doc;
}

export async function extractPages(src: PDFDocument, indices: number[]): Promise<Uint8Array> {
  const out = await newDoc();
  const copied = await out.copyPages(src, indices);
  for (const p of copied) out.addPage(p);
  return out.save();
}

export function everyN(total: number, n: number): number[][] {
  const groups: number[][] = [];
  const step = Math.max(1, Math.floor(n));
  for (let s = 0; s < total; s += step) groups.push(range(s, Math.min(total, s + step)));
  return groups;
}

export async function splitGroups(bytes: Uint8Array, groups: number[][], ctx: Ctx): Promise<Uint8Array[]> {
  const src = await loadPdf(bytes);
  const out: Uint8Array[] = [];
  for (let g = 0; g < groups.length; g++) {
    await ctx.checkpoint();
    out.push(await extractPages(src, groups[g]));
    ctx.report((g + 1) / groups.length, `Writing part ${g + 1} of ${groups.length}`);
  }
  return out;
}

/** Greedy split that keeps every part under maxBytes (single pages may exceed it). */
export async function splitBySize(bytes: Uint8Array, maxBytes: number, ctx: Ctx): Promise<Uint8Array[]> {
  const src = await loadPdf(bytes);
  const total = src.getPageCount();
  const perPage = bytes.length / Math.max(1, total);
  const out: Uint8Array[] = [];
  let start = 0;
  while (start < total) {
    await ctx.checkpoint();
    let end = Math.min(total, start + Math.max(1, Math.floor(maxBytes / perPage)));
    let data = await extractPages(src, range(start, end));
    for (let tries = 0; data.length > maxBytes && end - start > 1 && tries < 12; tries++) {
      end = start + Math.max(1, Math.floor((end - start) * 0.75));
      data = await extractPages(src, range(start, end));
    }
    out.push(data);
    start = end;
    ctx.report(start / total, `${start} of ${total} pages`);
  }
  return out;
}

/** Adds a PDF outline (bookmarks) pointing at the given pages. */
export function addOutline(doc: PDFDocument, entries: { title: string; pageRef: PDFRef }[]): void {
  if (entries.length === 0) return;
  const ctx = doc.context;
  const outlineRef = ctx.nextRef();
  const itemRefs = entries.map(() => ctx.nextRef());
  entries.forEach((entry, i) => {
    const item = PDFDict.withContext(ctx);
    item.set(PDFName.of('Title'), PDFHexString.fromText(entry.title));
    item.set(PDFName.of('Parent'), outlineRef);
    if (i > 0) item.set(PDFName.of('Prev'), itemRefs[i - 1]);
    if (i < itemRefs.length - 1) item.set(PDFName.of('Next'), itemRefs[i + 1]);
    const dest = PDFArray.withContext(ctx);
    dest.push(entry.pageRef);
    dest.push(PDFName.of('Fit'));
    item.set(PDFName.of('Dest'), dest);
    ctx.assign(itemRefs[i], item);
  });
  const outline = PDFDict.withContext(ctx);
  outline.set(PDFName.of('Type'), PDFName.of('Outlines'));
  outline.set(PDFName.of('First'), itemRefs[0]);
  outline.set(PDFName.of('Last'), itemRefs[itemRefs.length - 1]);
  outline.set(PDFName.of('Count'), PDFNumber.of(itemRefs.length));
  ctx.assign(outlineRef, outline);
  doc.catalog.set(PDFName.of('Outlines'), outlineRef);
}

export interface MergeInput {
  bytes: Uint8Array;
  name: string;
  pages?: number[] | null;
  bookmark?: boolean;
}

export async function mergeFiles(inputs: MergeInput[], ctx: Ctx): Promise<Uint8Array> {
  const out = await newDoc();
  const bookmarks: { title: string; pageRef: PDFRef }[] = [];
  for (let i = 0; i < inputs.length; i++) {
    await ctx.checkpoint();
    const inp = inputs[i];
    const src = await loadPdf(inp.bytes);
    const idx = inp.pages && inp.pages.length > 0 ? inp.pages : range(0, src.getPageCount());
    const copied = await out.copyPages(src, idx);
    const first = out.getPageCount();
    for (const p of copied) out.addPage(p);
    if (inp.bookmark && copied.length > 0) {
      bookmarks.push({ title: stripExt(inp.name), pageRef: out.getPage(first).ref });
    }
    ctx.report((i + 1) / inputs.length, `Merged ${i + 1} of ${inputs.length}`);
  }
  addOutline(out, bookmarks);
  return out.save();
}

export interface PageItem {
  src: number; // 0-based source index, -1 = blank page
  rotate: number; // degrees added to the page's rotation
  crop?: { l: number; r: number; t: number; b: number }; // fractions 0..1
}
export interface LayoutOpts {
  mode: 'single' | 'nup' | 'booklet';
  paper: 'none' | 'a3' | 'a4' | 'a5' | 'letter' | 'legal';
  cols: number;
  rows: number;
  landscape: boolean;
}

/** Draws an embedded page into a rectangle, honouring the page's /Rotate. */
function drawFit(
  sheet: PDFPage,
  emb: PDFEmbeddedPage,
  rot: number,
  x0: number,
  y0: number,
  tw: number,
  th: number,
): void {
  const ew = emb.width;
  const eh = emb.height;
  const swap = rot === 90 || rot === 270;
  const bw = swap ? eh : ew;
  const bh = swap ? ew : eh;
  const s = Math.min(tw / bw, th / bh);
  const dw = bw * s;
  const dh = bh * s;
  const ox = x0 + (tw - dw) / 2;
  const oy = y0 + (th - dh) / 2;
  const W = ew * s;
  const H = eh * s;
  const ccw = norm(360 - rot);
  let x = ox;
  let y = oy;
  if (ccw === 90) x = ox + H;
  else if (ccw === 180) {
    x = ox + W;
    y = oy + H;
  } else if (ccw === 270) y = oy + W;
  sheet.drawPage(emb, { x, y, xScale: s, yScale: s, rotate: degrees(ccw) });
}

async function layoutDocument(edited: PDFDocument, layout: LayoutOpts, ctx: Ctx): Promise<Uint8Array> {
  const pages = edited.getPages();
  const out = await newDoc();
  const embedded = await out.embedPages(pages);
  const rots = pages.map((p) => norm(p.getRotation().angle));
  const n = embedded.length;
  let [W, H] = PAPERS[layout.paper === 'none' ? 'a4' : layout.paper] ?? A4;
  if (layout.landscape) [W, H] = [H, W];

  if (layout.mode === 'booklet') {
    // Saddle-stitch imposition: each sheet is landscape, two pages per side.
    const padded = Math.ceil(n / 4) * 4;
    const at = (i: number): number => (i < n ? i : -1);
    const SW = Math.max(W, H);
    const SH = Math.min(W, H);
    const place = (sheet: PDFPage, left: number, right: number): void => {
      if (left >= 0) drawFit(sheet, embedded[left], rots[left], 0, 0, SW / 2, SH);
      if (right >= 0) drawFit(sheet, embedded[right], rots[right], SW / 2, 0, SW / 2, SH);
    };
    for (let k = 0; k < padded / 4; k++) {
      await ctx.checkpoint();
      place(out.addPage([SW, SH]), at(padded - 1 - 2 * k), at(2 * k));
      place(out.addPage([SW, SH]), at(2 * k + 1), at(padded - 2 - 2 * k));
      ctx.report(0.7 + 0.3 * ((k + 1) / (padded / 4)), 'Imposing booklet');
    }
  } else if (layout.mode === 'nup') {
    const cols = Math.max(1, layout.cols);
    const rows = Math.max(1, layout.rows);
    const per = cols * rows;
    const cw = W / cols;
    const ch = H / rows;
    const m = 10;
    for (let s = 0; s < n; s += per) {
      await ctx.checkpoint();
      const sheet = out.addPage([W, H]);
      for (let k = 0; k < per && s + k < n; k++) {
        const c = k % cols;
        const r = Math.floor(k / cols);
        drawFit(sheet, embedded[s + k], rots[s + k], c * cw + m, H - (r + 1) * ch + m, cw - 2 * m, ch - 2 * m);
      }
      ctx.report(0.7 + 0.3 * Math.min(1, (s + per) / n), 'Laying out sheets');
    }
  } else {
    for (let i = 0; i < n; i++) {
      if (i % 50 === 0) await ctx.checkpoint();
      const sheet = out.addPage([W, H]);
      drawFit(sheet, embedded[i], rots[i], 0, 0, W, H);
      ctx.report(0.7 + 0.3 * ((i + 1) / n), 'Laying out pages');
    }
  }
  return out.save();
}

/** Builds the edited document from a page model (order, rotation, crop, blanks) + optional layout. */
export async function buildPages(bytes: Uint8Array, items: PageItem[], layout: LayoutOpts, ctx: Ctx): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  const edited = await newDoc();
  const srcIdx = [...new Set(items.filter((i) => i.src >= 0).map((i) => i.src))];
  const copiedAll = srcIdx.length > 0 ? await edited.copyPages(src, srcIdx) : [];
  const firstCopy = new Map<number, PDFPage>();
  srcIdx.forEach((s, k) => firstCopy.set(s, copiedAll[k]));
  const used = new Set<number>();
  let lastSize: [number, number] = A4;
  for (let i = 0; i < items.length; i++) {
    if (i % 100 === 0) {
      await ctx.checkpoint();
      ctx.report((i / items.length) * 0.7, `Preparing page ${i + 1} of ${items.length}`);
    }
    const it = items[i];
    if (it.src < 0) {
      edited.addPage(lastSize);
      continue;
    }
    let page: PDFPage | undefined;
    if (!used.has(it.src)) {
      used.add(it.src);
      page = firstCopy.get(it.src);
    } else {
      const [dup] = await edited.copyPages(src, [it.src]);
      page = dup;
    }
    if (!page) throw new Error('Internal error while copying pages');
    page.setRotation(degrees(norm(page.getRotation().angle + it.rotate)));
    if (it.crop) {
      const box = page.getMediaBox();
      const { l, r, t, b } = it.crop;
      page.setCropBox(
        box.x + box.width * l,
        box.y + box.height * b,
        box.width * (1 - l - r),
        box.height * (1 - t - b),
      );
    }
    edited.addPage(page);
    const sz = page.getSize();
    lastSize = [sz.width, sz.height];
  }
  if (edited.getPageCount() === 0) throw new Error('The document would have no pages');
  if (layout.mode === 'single' && layout.paper === 'none') return edited.save();
  return layoutDocument(edited, layout, ctx);
}

export interface LabelSpec {
  style: 'decimal' | 'roman' | 'ROMAN' | 'alpha' | 'ALPHA' | 'none';
  start: number;
  prefix: string;
}
const LABEL_STYLE: Record<Exclude<LabelSpec['style'], 'none'>, string> = {
  decimal: 'D',
  roman: 'r',
  ROMAN: 'R',
  alpha: 'a',
  ALPHA: 'A',
};

/** Writes PDF page labels (the numbers a viewer shows), so printed numbering can be corrected. */
export async function setPageLabels(bytes: Uint8Array, spec: LabelSpec, ctx: Ctx): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const c = doc.context;
  if (spec.style === 'none' && !spec.prefix && spec.start === 1) {
    doc.catalog.delete(PDFName.of('PageLabels'));
  } else {
    const entry = PDFDict.withContext(c);
    if (spec.style !== 'none') entry.set(PDFName.of('S'), PDFName.of(LABEL_STYLE[spec.style]));
    if (spec.prefix) entry.set(PDFName.of('P'), PDFHexString.fromText(spec.prefix));
    if (spec.start !== 1) entry.set(PDFName.of('St'), PDFNumber.of(Math.max(1, Math.floor(spec.start))));
    const nums = PDFArray.withContext(c);
    nums.push(PDFNumber.of(0));
    nums.push(entry);
    const tree = PDFDict.withContext(c);
    tree.set(PDFName.of('Nums'), nums);
    doc.catalog.set(PDFName.of('PageLabels'), tree);
  }
  ctx.report(1);
  return doc.save();
}

export async function rotateAll(bytes: Uint8Array, deg: number, ctx: Ctx): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  doc.getPages().forEach((p, i) => {
    p.setRotation(degrees(norm(p.getRotation().angle + deg)));
    if (i % 200 === 0) ctx.report(i / doc.getPageCount());
  });
  return doc.save();
}

export interface WatermarkOpts {
  text: string;
  size: number;
  opacity: number;
  angle: number;
  color: string;
}

export async function addWatermark(bytes: Uint8Array, o: WatermarkOpts, ctx: Ctx): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = winAnsi(o.text);
  const tw = font.widthOfTextAtSize(text, o.size);
  const rad = (o.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const half = o.size * 0.35;
  const color = rgb(...hexRgb(o.color));
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const { width: w, height: h } = page.getSize();
    const x = w / 2 - (tw / 2) * cos + half * sin;
    const y = h / 2 - (tw / 2) * sin - half * cos;
    page.drawText(text, { x, y, size: o.size, font, color, opacity: o.opacity, rotate: degrees(o.angle) });
    if (i % 100 === 0) ctx.report(i / pages.length);
  });
  return doc.save();
}

export interface StampOpts {
  position: 'top' | 'bottom';
  left: string;
  center: string;
  right: string;
  size: number;
  margin: number;
  startAt: number;
  batesPrefix: string;
  batesDigits: number;
  color: string;
}

function fillTokens(tpl: string, n: number, total: number, bates: string): string {
  return tpl.split('{n}').join(String(n)).split('{total}').join(String(total)).split('{bates}').join(bates);
}

/** Page numbers, headers/footers and Bates numbering. Tokens: {n} {total} {bates} */
export async function stampPages(bytes: Uint8Array, o: StampOpts, ctx: Ctx): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  const color = rgb(...hexRgb(o.color));
  const slots: [string, 'l' | 'c' | 'r'][] = [
    [o.left, 'l'],
    [o.center, 'c'],
    [o.right, 'r'],
  ];
  for (let i = 0; i < total; i++) {
    const n = o.startAt + i;
    const bates = o.batesPrefix + String(n).padStart(o.batesDigits, '0');
    const page = pages[i];
    const { width: w, height: h } = page.getSize();
    const y = o.position === 'top' ? h - o.margin - o.size : o.margin;
    for (const [tpl, pos] of slots) {
      if (!tpl.trim()) continue;
      const txt = winAnsi(fillTokens(tpl, n, total, bates));
      const tw = font.widthOfTextAtSize(txt, o.size);
      const x = pos === 'l' ? o.margin : pos === 'c' ? (w - tw) / 2 : w - o.margin - tw;
      page.drawText(txt, { x, y, size: o.size, font, color });
    }
    if (i % 100 === 0) {
      await ctx.checkpoint();
      ctx.report(i / total);
    }
  }
  return doc.save();
}

export interface MetaOpts {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

export async function setMetadata(bytes: Uint8Array, m: MetaOpts, ctx: Ctx): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  doc.setTitle(m.title);
  doc.setAuthor(m.author);
  doc.setSubject(m.subject);
  doc.setKeywords(m.keywords.split(',').map((s) => s.trim()).filter(Boolean));
  doc.setCreator(m.creator);
  doc.setProducer(m.producer || 'PDFCut');
  doc.setModificationDate(new Date());
  ctx.report(1);
  return doc.save();
}

/** Rebuilds the file with only reachable objects: drops unused data, metadata, annotations, scripts and attachments. */
export async function cleanPdf(bytes: Uint8Array, ctx: Ctx): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  // Remove annotations from the source pages first so copies never reference them.
  for (const p of src.getPages()) {
    p.node.delete(PDFName.of('Annots'));
    p.node.delete(PDFName.of('Metadata'));
    p.node.delete(PDFName.of('PieceInfo'));
  }
  const out = await newDoc();
  const copied = await out.copyPages(src, range(0, src.getPageCount()));
  for (const p of copied) out.addPage(p);
  out.setTitle('');
  out.setAuthor('');
  out.setSubject('');
  out.setKeywords([]);
  out.setCreator('PDFCut');
  out.setProducer('PDFCut');
  ctx.report(1);
  return out.save();
}

/** Lossless rebuild: copies pages (and basic info) into a fresh file, dropping unused objects. */
export async function rebuildPdf(bytes: Uint8Array, ctx: Ctx): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  const out = await newDoc();
  const copied = await out.copyPages(src, range(0, src.getPageCount()));
  for (let i = 0; i < copied.length; i++) {
    out.addPage(copied[i]);
    if (i % 200 === 0) {
      await ctx.checkpoint();
      ctx.report(i / copied.length);
    }
  }
  const title = src.getTitle();
  if (title) out.setTitle(title);
  const author = src.getAuthor();
  if (author) out.setAuthor(author);
  return out.save();
}

export interface ImagePage {
  bytes: Uint8Array;
  kind: 'png' | 'jpg';
  width: number; // page width in points
  height: number; // page height in points
}

export async function imagePages(pages: ImagePage[], ctx: Ctx): Promise<Uint8Array> {
  const doc = await newDoc();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const img = p.kind === 'png' ? await doc.embedPng(p.bytes) : await doc.embedJpg(p.bytes);
    const page = doc.addPage([p.width, p.height]);
    page.drawImage(img, { x: 0, y: 0, width: p.width, height: p.height });
    if (i % 10 === 0) {
      await ctx.checkpoint();
      ctx.report((i + 1) / pages.length, `Page ${i + 1} of ${pages.length}`);
    }
  }
  return doc.save();
}

export interface TextOpts {
  font: 'Helvetica' | 'Courier' | 'TimesRoman';
  size: number;
  paper: 'a4' | 'letter' | 'legal';
}

export async function textToPdf(text: string, o: TextOpts, ctx: Ctx): Promise<Uint8Array> {
  const doc = await newDoc();
  const font = await doc.embedFont(StandardFonts[o.font]);
  const [W, H] = PAPERS[o.paper] ?? A4;
  const margin = 54;
  const lh = o.size * 1.4;
  const maxW = W - margin * 2;
  const lines: string[] = [];
  for (const para of winAnsi(text).split(/\r?\n/)) {
    if (para === '') {
      lines.push('');
      continue;
    }
    let cur = '';
    for (const word of para.split(' ')) {
      const trial = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(trial, o.size) <= maxW) {
        cur = trial;
        continue;
      }
      if (cur) lines.push(cur);
      let rest = word;
      while (font.widthOfTextAtSize(rest, o.size) > maxW && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), o.size) > maxW) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      cur = rest;
    }
    lines.push(cur);
  }
  const perPage = Math.max(1, Math.floor((H - margin * 2) / lh));
  for (let s = 0; s < lines.length || doc.getPageCount() === 0; s += perPage) {
    const page = doc.addPage([W, H]);
    lines.slice(s, s + perPage).forEach((ln, k) => {
      page.drawText(ln, { x: margin, y: H - margin - o.size - k * lh, size: o.size, font });
    });
    await ctx.checkpoint();
    ctx.report(Math.min(1, (s + perPage) / Math.max(1, lines.length)));
    if (lines.length === 0) break;
  }
  return doc.save();
}

export interface AnnotIn {
  page: number;
  type: 'highlight' | 'rect' | 'text' | 'note' | 'ink' | 'image';
  x: number; // normalized 0..1, top-left origin
  y: number;
  w: number;
  h: number;
  color: string;
  text?: string;
  points?: number[]; // flat normalized [x0,y0,x1,y1,...] for ink
  stroke?: number;
  image?: { bytes: Uint8Array; kind: 'png' | 'jpg' };
}

/** Applies annotations. Pages in `overrides` are replaced by a full-page image (used for redaction). */
export async function annotatePdf(
  bytes: Uint8Array,
  annots: AnnotIn[],
  overrides: Record<number, ImagePage>,
  ctx: Ctx,
): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  const out = await newDoc();
  const n = src.getPageCount();
  const keep = range(0, n).filter((i) => !overrides[i]);
  const copied = await out.copyPages(src, keep);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const o = overrides[i];
    if (o) {
      const img = o.kind === 'png' ? await out.embedPng(o.bytes) : await out.embedJpg(o.bytes);
      const pg = out.addPage([o.width, o.height]);
      pg.drawImage(img, { x: 0, y: 0, width: o.width, height: o.height });
    } else {
      out.addPage(copied[k++]);
    }
  }
  const helv = await out.embedFont(StandardFonts.Helvetica);
  const pages = out.getPages();
  for (let i = 0; i < annots.length; i++) {
    const a = annots[i];
    const page = pages[a.page];
    if (!page) continue;
    const box = page.getCropBox();
    const rx = box.x + a.x * box.width;
    const ry = box.y + box.height - (a.y + a.h) * box.height;
    const rw = a.w * box.width;
    const rh = a.h * box.height;
    const color = rgb(...hexRgb(a.color));
    const stroke = a.stroke ?? 2;
    switch (a.type) {
      case 'highlight':
        page.drawRectangle({ x: rx, y: ry, width: rw, height: rh, color, opacity: 0.35, borderWidth: 0 });
        break;
      case 'rect':
        page.drawRectangle({ x: rx, y: ry, width: rw, height: rh, borderColor: color, borderWidth: stroke });
        break;
      case 'text':
        page.drawText(winAnsi(a.text ?? ''), { x: rx, y: ry + rh * 0.25, size: Math.max(6, rh * 0.6), font: helv, color });
        break;
      case 'note':
        page.drawRectangle({
          x: rx,
          y: ry,
          width: rw,
          height: rh,
          color: rgb(1, 0.95, 0.55),
          borderColor: rgb(0.8, 0.7, 0.1),
          borderWidth: 0.75,
        });
        page.drawText(winAnsi(a.text ?? '').slice(0, 200), { x: rx + 4, y: ry + rh - 13, size: 9, font: helv, color: rgb(0, 0, 0) });
        break;
      case 'ink': {
        const pts = a.points ?? [];
        for (let p = 0; p + 3 < pts.length; p += 2) {
          page.drawLine({
            start: { x: box.x + pts[p] * box.width, y: box.y + box.height - pts[p + 1] * box.height },
            end: { x: box.x + pts[p + 2] * box.width, y: box.y + box.height - pts[p + 3] * box.height },
            thickness: stroke,
            color,
          });
        }
        break;
      }
      case 'image':
        if (a.image) {
          const img = a.image.kind === 'png' ? await out.embedPng(a.image.bytes) : await out.embedJpg(a.image.bytes);
          page.drawImage(img, { x: rx, y: ry, width: rw, height: rh });
        }
        break;
    }
    if (i % 50 === 0) {
      await ctx.checkpoint();
      ctx.report(i / annots.length);
    }
  }
  return out.save();
}

export interface OcrWord {
  text: string;
  x: number; // points, top-left origin
  y: number;
  w: number;
  h: number;
}
export interface OcrPage {
  image: ImagePage;
  words: OcrWord[];
}

/** Scanned page images with an invisible, selectable text layer on top. */
export async function searchablePdf(pages: OcrPage[], ctx: Ctx): Promise<Uint8Array> {
  const doc = await newDoc();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages.length; i++) {
    const { image, words } = pages[i];
    const img = image.kind === 'png' ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
    const page = doc.addPage([image.width, image.height]);
    page.drawImage(img, { x: 0, y: 0, width: image.width, height: image.height });
    for (const wd of words) {
      const txt = winAnsi(wd.text).trim();
      if (!txt || wd.h <= 0) continue;
      const size = Math.max(2, wd.h * 0.85);
      page.drawText(txt, { x: wd.x, y: image.height - wd.y - wd.h * 0.8, size, font, opacity: 0 });
    }
    await ctx.checkpoint();
    ctx.report((i + 1) / pages.length, `OCR layer for page ${i + 1}`);
  }
  return doc.save();
}
