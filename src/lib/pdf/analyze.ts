// Page analysis. analyzeStructure() runs in the PDF worker and returns page sizes, rotations, and a fingerprint
// per page: the decoded content stream (with pdf-lib's random resource suffixes removed), the fonts it names,
// and a hash of every image/form XObject it uses. Pages with equal fingerprints are reported as duplicates.
// The helpers below are pure and unit-tested. Visual checks (blank pages, text direction) live in lib/analyzer.ts.
import { PDFArray, PDFDict, PDFName, PDFRef, type PDFDocument, type PDFPage } from 'pdf-lib';
import { sha256Hex } from '../hash';
import { loadPdf } from './ops';

const KNOWN_SIZES: Array<[string, number, number]> = [
  ['A3', 841.89, 1190.55],
  ['A4', 595.28, 841.89],
  ['A5', 419.53, 595.28],
  ['Letter', 612, 792],
  ['Legal', 612, 1008],
  ['Tabloid', 792, 1224],
];

/** Names the standard paper size (either orientation), or reports the size in millimetres. */
export function pageSizeLabel(width: number, height: number): string {
  const lo = Math.min(width, height);
  const hi = Math.max(width, height);
  for (const [name, a, b] of KNOWN_SIZES) {
    if (Math.abs(lo - a) < 2 && Math.abs(hi - b) < 2) return name;
  }
  return `Custom ${Math.round((width * 25.4) / 72)}×${Math.round((height * 25.4) / 72)} mm`;
}

export interface AngleSample {
  angle: number; // degrees, counter-clockwise, from the text matrix
  weight: number; // e.g. number of characters
}

/** Dominant text direction rounded to a quarter turn, weighted by text length. Null when there is no text. */
export function dominantQuarter(samples: AngleSample[]): { quarter: number; confidence: number } | null {
  const bins = [0, 0, 0, 0];
  let total = 0;
  for (const s of samples) {
    if (!(s.weight > 0) || !Number.isFinite(s.angle)) continue;
    const a = ((s.angle % 360) + 360) % 360;
    bins[Math.round(a / 90) % 4] += s.weight;
    total += s.weight;
  }
  if (total === 0) return null;
  const best = bins.indexOf(Math.max(...bins));
  return { quarter: best * 90, confidence: bins[best] / total };
}

/** Clockwise degrees to add to the current /Rotate so that text running in direction `quarter` reads upright. */
export function deltaToUpright(currentRotation: number, quarter: number): number {
  return (((quarter - currentRotation) % 360) + 360) % 360;
}

/** pdf-lib names embedded resources with random suffixes (e.g. /Helvetica-7098480789). Remove them so equal pages compare equal. */
export function normalizeGeneratedNames(text: string): string {
  return text.replace(/(\/[A-Za-z][A-Za-z0-9_+-]*?)-\d{6,}/g, '$1');
}

function contentChunks(doc: PDFDocument, contents: unknown): Uint8Array[] {
  const out: Uint8Array[] = [];
  const visit = (value: unknown): void => {
    const obj = value instanceof PDFRef ? doc.context.lookup(value) : value;
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) visit(obj.get(i));
    } else if (obj && typeof (obj as { getContents?: unknown }).getContents === 'function') {
      out.push((obj as { getContents(): Uint8Array }).getContents());
    }
  };
  visit(contents);
  return out;
}

/** Decompresses a FlateDecode stream (zlib format). Compressed bytes can differ even for identical content. */
async function inflateOrKeep(raw: Uint8Array): Promise<Uint8Array> {
  try {
    const stream = new Blob([raw as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return raw;
  }
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function pageFingerprint(doc: PDFDocument, page: PDFPage): Promise<string> {
  const chunks = await Promise.all(contentChunks(doc, page.node.Contents()).map(inflateOrKeep));
  const parts: string[] = [normalizeGeneratedNames(new TextDecoder('latin1').decode(concatBytes(chunks)))];
  const resources = page.node.Resources();
  if (resources) {
    const fonts = resources.lookup(PDFName.of('Font'));
    if (fonts instanceof PDFDict) {
      for (const [name, ref] of fonts.entries()) {
        const font = doc.context.lookup(ref);
        const base = font instanceof PDFDict ? String(font.get(PDFName.of('BaseFont')) ?? '') : '';
        parts.push(`font ${normalizeGeneratedNames(name.toString())} ${base}`);
      }
    }
    const xobjects = resources.lookup(PDFName.of('XObject'));
    if (xobjects instanceof PDFDict) {
      for (const [name, ref] of xobjects.entries()) {
        const obj = doc.context.lookup(ref) as { getContents?: () => Uint8Array } | undefined;
        const bytes = obj && typeof obj.getContents === 'function' ? obj.getContents() : new Uint8Array();
        parts.push(`xobject ${normalizeGeneratedNames(name.toString())} ${await sha256Hex(bytes)}`);
      }
    }
  }
  return sha256Hex(new TextEncoder().encode(parts.join('\n')));
}

export interface PageStructure {
  pageCount: number;
  sizes: string[];
  rotations: number[];
  /** Groups of 0-based page indices with identical size and fingerprint (length > 1). */
  groups: number[][];
}

export async function analyzeStructure(bytes: Uint8Array): Promise<PageStructure> {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const sizes: string[] = [];
  const rotations: number[] = [];
  const keys: string[] = [];
  for (const page of pages) {
    const { width, height } = page.getSize();
    sizes.push(pageSizeLabel(width, height));
    rotations.push(((page.getRotation().angle % 360) + 360) % 360);
    keys.push(`${Math.round(width)}x${Math.round(height)}:${await pageFingerprint(doc, page)}`);
  }
  const byKey = new Map<string, number[]>();
  keys.forEach((k, i) => {
    const list = byKey.get(k);
    if (list) list.push(i);
    else byKey.set(k, [i]);
  });
  const groups = [...byKey.values()].filter((g) => g.length > 1);
  return { pageCount: pages.length, sizes, rotations, groups };
}
