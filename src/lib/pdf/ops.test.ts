import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import {
  addOutline,
  addWatermark,
  annotatePdf,
  buildPages,
  cleanPdf,
  everyN,
  hexRgb,
  loadPdf,
  mergeFiles,
  rebuildPdf,
  rotateAll,
  setMetadata,
  silentCtx,
  splitBySize,
  splitGroups,
  stampPages,
  textToPdf,
  winAnsi,
} from './ops';

async function makePdf(pages: number, opts: { annotate?: boolean; rotate?: number } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([300, 400]);
    p.drawText(`Page ${i + 1}`, { x: 20, y: 300, size: 24 });
    if (opts.rotate) p.setRotation(degrees(opts.rotate));
    if (opts.annotate) {
      const annot = doc.context.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: [0, 0, 50, 20] });
      const ref = doc.context.register(annot);
      p.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
    }
  }
  return doc.save();
}

describe('pure helpers', () => {
  it('everyN chunks pages without gaps', () => {
    expect(everyN(10, 4)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9],
    ]);
  });

  it('hexRgb converts colours to 0..1 floats', () => {
    expect(hexRgb('#ff0000')).toEqual([1, 0, 0]);
    expect(hexRgb('#0f0')[1]).toBeCloseTo(1);
  });

  it('winAnsi replaces characters the standard fonts cannot encode', () => {
    expect(winAnsi('hi 日')).toBe('hi ?');
    expect(winAnsi('café')).toBe('café');
  });

  it('loadPdf reports unreadable input clearly', async () => {
    await expect(loadPdf(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/could not be read/);
  });
});

describe('split', () => {
  it('splitGroups writes one document per group with the right page counts', async () => {
    const parts = await splitGroups(await makePdf(5), [[0, 1], [2, 3, 4]], silentCtx);
    const counts = await Promise.all(parts.map(async (p) => (await loadPdf(p)).getPageCount()));
    expect(counts).toEqual([2, 3]);
  });

  it('splitBySize keeps every page exactly once', async () => {
    const bytes = await makePdf(8);
    const parts = await splitBySize(bytes, Math.floor(bytes.length / 2), silentCtx);
    expect(parts.length).toBeGreaterThan(1);
    let total = 0;
    for (const p of parts) total += (await loadPdf(p)).getPageCount();
    expect(total).toBe(8);
  });
});

describe('merge', () => {
  it('combines pages in order and adds one bookmark per file', async () => {
    const merged = await mergeFiles(
      [
        { bytes: await makePdf(2), name: 'alpha.pdf', bookmark: true },
        { bytes: await makePdf(3), name: 'beta.pdf', bookmark: true },
      ],
      silentCtx,
    );
    const doc = await loadPdf(merged);
    expect(doc.getPageCount()).toBe(5);
    expect(doc.catalog.has(PDFName.of('Outlines'))).toBe(true);
  });

  it('honours per-file page selections', async () => {
    const merged = await mergeFiles([{ bytes: await makePdf(6), name: 'x.pdf', pages: [0, 5] }], silentCtx);
    expect((await loadPdf(merged)).getPageCount()).toBe(2);
  });

  it('addOutline is a no-op for an empty list', async () => {
    const doc = await PDFDocument.create();
    addOutline(doc, []);
    expect(doc.catalog.has(PDFName.of('Outlines'))).toBe(false);
  });
});

describe('page model builds', () => {
  it('applies rotation, blanks and duplicates', async () => {
    const out = await buildPages(
      await makePdf(3),
      [
        { src: 0, rotate: 90 },
        { src: -1, rotate: 0 },
        { src: 1, rotate: 0 },
        { src: 1, rotate: 0 },
      ],
      { mode: 'single', paper: 'none', cols: 1, rows: 1, landscape: false },
      silentCtx,
    );
    const doc = await loadPdf(out);
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
  });

  it('imposes booklets: 5 pages become 2 sheets, 4 printed sides', async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ src: i, rotate: 0 }));
    const out = await buildPages(await makePdf(5), items, { mode: 'booklet', paper: 'a4', cols: 1, rows: 1, landscape: false }, silentCtx);
    expect((await loadPdf(out)).getPageCount()).toBe(4);
  });

  it('lays out N-up sheets (2×2 for 5 pages gives 2 sheets)', async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ src: i, rotate: i === 0 ? 90 : 0 }));
    const out = await buildPages(await makePdf(5, { rotate: 0 }), items, { mode: 'nup', paper: 'letter', cols: 2, rows: 2, landscape: false }, silentCtx);
    expect((await loadPdf(out)).getPageCount()).toBe(2);
  });

  it('crops selected pages with a crop box', async () => {
    const out = await buildPages(
      await makePdf(1),
      [{ src: 0, rotate: 0, crop: { l: 0, r: 0.5, t: 0, b: 0 } }],
      { mode: 'single', paper: 'none', cols: 1, rows: 1, landscape: false },
      silentCtx,
    );
    const box = (await loadPdf(out)).getPage(0).getCropBox();
    expect(box.width).toBeCloseTo(150);
  });

  it('rotateAll adds the rotation to every page', async () => {
    const doc = await loadPdf(await rotateAll(await makePdf(2), 90, silentCtx));
    expect(doc.getPage(1).getRotation().angle).toBe(90);
  });
});

describe('stamping, metadata and text', () => {
  it('adds a watermark and page numbers without changing the page count', async () => {
    const wm = await addWatermark(await makePdf(2), { text: 'DRAFT', size: 40, opacity: 0.3, angle: 45, color: '#999999' }, silentCtx);
    const stamped = await stampPages(
      wm,
      {
        position: 'bottom',
        left: 'Doc',
        center: 'Page {n} of {total}',
        right: '{bates}',
        size: 9,
        margin: 20,
        startAt: 1,
        batesPrefix: 'ABC-',
        batesDigits: 4,
        color: '#000000',
      },
      silentCtx,
    );
    expect((await loadPdf(stamped)).getPageCount()).toBe(2);
  });

  it('sets document metadata', async () => {
    const out = await setMetadata(await makePdf(1), { title: 'Quarterly report', author: 'Ada', subject: '', keywords: 'a, b', creator: '', producer: '' }, silentCtx);
    expect((await loadPdf(out)).getTitle()).toBe('Quarterly report');
  });

  it('textToPdf paginates long text', async () => {
    const text = Array.from({ length: 200 }, (_, i) => `Line number ${i + 1}`).join('\n');
    const out = await textToPdf(text, { font: 'Helvetica', size: 11, paper: 'a4' }, silentCtx);
    expect((await loadPdf(out)).getPageCount()).toBeGreaterThan(1);
  });
});

describe('privacy and annotations', () => {
  it('cleanPdf removes annotations so no page references them', async () => {
    const src = await makePdf(2, { annotate: true });
    const before = await loadPdf(src);
    expect(before.getPage(0).node.has(PDFName.of('Annots'))).toBe(true);
    const cleaned = await loadPdf(await cleanPdf(src, silentCtx));
    expect(cleaned.getPageCount()).toBe(2);
    expect(cleaned.getPage(0).node.has(PDFName.of('Annots'))).toBe(false);
  });

  it('rebuildPdf keeps every page', async () => {
    expect((await loadPdf(await rebuildPdf(await makePdf(4), silentCtx))).getPageCount()).toBe(4);
  });

  it('annotatePdf draws highlights and ink and keeps the page count', async () => {
    const out = await annotatePdf(
      await makePdf(2),
      [
        { page: 0, type: 'highlight', x: 0.1, y: 0.1, w: 0.3, h: 0.05, color: '#fde047' },
        { page: 1, type: 'ink', x: 0.1, y: 0.2, w: 0.5, h: 0.5, color: '#ef4444', points: [0.1, 0.2, 0.3, 0.4, 0.6, 0.7], stroke: 2 },
        { page: 0, type: 'text', x: 0.2, y: 0.5, w: 0.4, h: 0.05, color: '#000000', text: 'Approved' },
      ],
      {},
      silentCtx,
    );
    expect((await loadPdf(out)).getPageCount()).toBe(2);
  });

  it('annotatePdf replaces overridden pages with full-page images (redaction)', async () => {
    const pngPixel = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
      (c) => c.charCodeAt(0),
    );
    const out = await annotatePdf(
      await makePdf(2),
      [],
      { 1: { bytes: pngPixel, kind: 'png', width: 300, height: 400 } },
      silentCtx,
    );
    const doc = await loadPdf(out);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(1).node.has(PDFName.of('Contents'))).toBe(true);
  });
});
