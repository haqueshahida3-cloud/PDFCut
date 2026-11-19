/* eslint-disable @typescript-eslint/no-explicit-any -- payloads cross the worker boundary; each handler's shape is documented by its caller */
// Web Worker that runs heavy PDF work off the UI thread. Each job gets its own worker, so cancelling is
// simply terminate(). Rasterization (pdf.js + OffscreenCanvas) and analysis run here too.
import '../polyfills'; // pdf.js (used for rasterization in this worker) needs Map.getOrInsertComputed
import * as ops from '../lib/pdf/ops';
import { runQpdf } from '../lib/pdf/qpdf';
import { analyzeStructure } from '../lib/pdf/analyze';
import { structureFacts } from '../lib/pdf/a11y';
import { createFields, fillFields, flattenForms, inspectForms, type NewField } from '../lib/pdf/forms';
import { rasterCompress, redactPages, replacePages, type CompressOpts, type NormBox, type ReplaceEdit } from '../lib/pdf/raster-core';

interface Request {
  id: number;
  op: string;
  payload: any;
}

const port = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

let paused = false;
let waiters: Array<() => void> = [];

function checkpoint(): Promise<void> {
  if (!paused) return Promise.resolve();
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function collect(value: unknown): Transferable[] {
  if (value instanceof Uint8Array) return [value.buffer as ArrayBuffer];
  if (Array.isArray(value)) return value.flatMap(collect);
  return [];
}

const handlers: Record<string, (payload: any, ctx: ops.Ctx) => Promise<unknown>> = {
  ping: async () => Date.now(),
  'split.groups': (p, c) => ops.splitGroups(p.bytes, p.groups, c),
  'split.size': (p, c) => ops.splitBySize(p.bytes, p.maxBytes, c),
  merge: (p, c) => ops.mergeFiles(p.inputs, c),
  'pages.build': async (p, c) => {
    const out = await ops.buildPages(p.bytes, p.items, p.layout, c);
    return p.labels ? ops.setPageLabels(out, p.labels as ops.LabelSpec, c) : out;
  },
  rotate: (p, c) => ops.rotateAll(p.bytes, p.deg, c),
  watermark: (p, c) => ops.addWatermark(p.bytes, p.opts, c),
  stamp: (p, c) => ops.stampPages(p.bytes, p.opts, c),
  'metadata.set': (p, c) => ops.setMetadata(p.bytes, p.meta, c),
  clean: (p, c) => ops.cleanPdf(p.bytes, c),
  rebuild: (p, c) => ops.rebuildPdf(p.bytes, c),
  'images.pages': (p, c) => ops.imagePages(p.pages, c),
  'text.pdf': (p, c) => ops.textToPdf(p.text, p.opts, c),
  annotate: (p, c) => ops.annotatePdf(p.bytes, p.annots, p.overrides, c),
  'ocr.pdf': (p, c) => ops.searchablePdf(p.pages, c),
  qpdf: (p) => runQpdf(p.bytes, p.args, p.wasmUrl),
  'raster.compress': (p, c) => rasterCompress(p.bytes, p.opts as CompressOpts, c),
  'raster.redact': (p, c) => redactPages(p.bytes, p.pages as Record<number, NormBox[]>, c),
  'raster.replace': (p, c) => replacePages(p.bytes, p.edits as ReplaceEdit[], c),
  'analyze.structure': (p) => analyzeStructure(p.bytes),
  'a11y.structure': (p) => structureFacts(p.bytes),
  'forms.inspect': (p) => inspectForms(p.bytes),
  'forms.create': (p, c) => createFields(p.bytes, p.fields as NewField[], c),
  'forms.fill': (p, c) => fillFields(p.bytes, p.values, c),
  'forms.flatten': (p, c) => flattenForms(p.bytes, c),
};

port.onmessage = async (e: MessageEvent) => {
  const data = e.data as { type?: string } & Partial<Request>;
  if (data.type === 'pause') {
    paused = true;
    return;
  }
  if (data.type === 'resume') {
    paused = false;
    const pending = waiters;
    waiters = [];
    pending.forEach((resolve) => resolve());
    return;
  }
  const id = data.id ?? 0;
  const ctx: ops.Ctx = {
    report: (progress, message) => port.postMessage({ id, type: 'progress', progress, message }),
    checkpoint,
  };
  try {
    const handler = data.op ? handlers[data.op] : undefined;
    if (!handler) throw new Error(`Unknown operation: ${data.op}`);
    const result = await handler(data.payload, ctx);
    port.postMessage({ id, type: 'done', result }, collect(result));
  } catch (err) {
    port.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
