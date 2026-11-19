// Split: page ranges, every N pages, bookmarks, file size, blank pages, text pattern or visual selection.
// Detection runs on the main thread with pdf.js; the byte-level split runs in the worker.
import { Scissors } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Dropzone, Field, Input, Segmented, Toggle } from '../components/ui';
import { InlineJob, Page, ThumbGrid, loadPdfFile, outName, readFileBytes, zipFiles } from '../components/Page';
import { PdfThumb } from '../components/PdfView';
import { pageText, readOutline, renderPageTo, type OutlineItem, type PdfDoc, type PdfPage } from '../lib/pdfjs';
import { errMessage, parseRangeParts, range, downloadBlob } from '../lib/util';
import { takePending, toast } from '../store/app';
import { enqueue, type JobCtx } from '../store/jobs';
import { cn } from '../utils/cn';

type Mode = 'ranges' | 'every' | 'bookmarks' | 'size' | 'blank' | 'text' | 'selected';
const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'ranges', label: 'Page ranges' },
  { value: 'every', label: 'Every N pages' },
  { value: 'bookmarks', label: 'Bookmarks' },
  { value: 'size', label: 'File size' },
  { value: 'blank', label: 'Blank pages' },
  { value: 'text', label: 'Text pattern' },
  { value: 'selected', label: 'Visual select' },
];

function everyGroups(total: number, n: number): number[][] {
  const out: number[][] = [];
  const step = Math.max(1, Math.floor(n));
  for (let s = 0; s < total; s += step) out.push(range(s, Math.min(total, s + step)));
  return out;
}

/** Turns "new part starts at these pages" into contiguous groups. */
function segmentsFrom(total: number, starts: number[]): number[][] {
  const sorted = [...new Set(starts)].filter((p) => p >= 0 && p < total).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const groups: number[][] = [];
  if (sorted[0] > 0) groups.push(range(0, sorted[0]));
  sorted.forEach((s, i) => groups.push(range(s, i + 1 < sorted.length ? sorted[i + 1] : total)));
  return groups;
}

async function isBlankPage(page: PdfPage): Promise<boolean> {
  const canvas = document.createElement('canvas');
  await renderPageTo(page, canvas, 0.2).promise;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 16) {
    total++;
    if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) ink++;
  }
  return total === 0 || ink / total < 0.0015;
}

async function blankGroups(doc: PdfDoc, job: JobCtx): Promise<number[][]> {
  const groups: number[][] = [];
  let cur: number[] = [];
  for (let p = 0; p < doc.numPages; p++) {
    await job.checkpoint();
    const page = await doc.getPage(p + 1);
    const blank = await isBlankPage(page);
    page.cleanup();
    if (blank) {
      if (cur.length) groups.push(cur);
      cur = [];
    } else cur.push(p);
    job.report((p + 1) / doc.numPages, `Checking page ${p + 1} of ${doc.numPages}`);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

async function textStarts(doc: PdfDoc, re: RegExp, job: JobCtx): Promise<number[]> {
  const starts: number[] = [];
  for (let p = 0; p < doc.numPages; p++) {
    await job.checkpoint();
    const page = await doc.getPage(p + 1);
    const text = await pageText(page);
    page.cleanup();
    if (re.test(text.text)) starts.push(p);
    job.report((p + 1) / doc.numPages, `Scanning page ${p + 1} of ${doc.numPages}`);
  }
  return starts;
}

interface Loaded {
  name: string;
  size: number;
  bytes: Uint8Array;
  doc: PdfDoc;
  outline: OutlineItem[];
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

export default function Split() {
  const [file, setFile] = useState<Loaded | null>(null);
  const [mode, setMode] = useState<Mode>('ranges');
  const [rangeSpec, setRangeSpec] = useState('1-3');
  const [perPart, setPerPart] = useState(true);
  const [everyN, setEveryN] = useState(10);
  const [maxMB, setMaxMB] = useState(5);
  const [pattern, setPattern] = useState('Chapter');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const n = file?.doc.numPages ?? 0;

  useEffect(
    () => () => {
      void file?.doc.destroy().catch(() => undefined);
    },
    [file],
  );

  const load = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (!f) return;
    try {
      const { bytes, doc } = await loadPdfFile(f);
      const outline = await readOutline(doc);
      setSelected(new Set());
      setRangeSpec(`1-${Math.min(3, doc.numPages)}`);
      setFile({ name: f.name, size: f.size, bytes, doc, outline });
      setError(null);
    } catch (e) {
      setError(errMessage(e));
    }
  };

  // Files sent from "Open with PDFCut" or the file manager arrive when this tool opens.
  useEffect(() => {
    const incoming = takePending('split');
    if (incoming.length > 0) void load(incoming);
    // Runs once on mount; `load` only uses state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rangeCheck = useMemo(() => {
    if (!file || mode !== 'ranges') return { ok: true, count: 0, msg: '' };
    try {
      const parts = parseRangeParts(rangeSpec, n);
      return { ok: true, count: perPart ? parts.length : 1, msg: '' };
    } catch (e) {
      return { ok: false, count: 0, msg: errMessage(e) };
    }
  }, [file, mode, rangeSpec, n, perPart]);

  const previewCount = ((): number | null => {
    if (!file) return null;
    if (mode === 'ranges') return rangeCheck.ok ? rangeCheck.count : null;
    if (mode === 'every') return Math.ceil(n / Math.max(1, everyN));
    if (mode === 'bookmarks') return segmentsFrom(n, file.outline.filter((o) => o.depth === 0).map((o) => o.page)).length;
    if (mode === 'selected') return selected.size > 0 ? 1 : 0;
    return null;
  })();

  const run = (): void => {
    if (!file) return;
    if (mode === 'ranges' && !rangeCheck.ok) {
      toast({ kind: 'error', title: 'Check the page ranges', message: rangeCheck.msg });
      return;
    }
    const { bytes, name, doc, outline } = file;
    const picked = [...selected].sort((a, b) => a - b);
    const j = enqueue(`Split ${name}`, async (job) => {
      if (mode === 'size') return job.work<Uint8Array[]>('split.size', { bytes, maxBytes: maxMB * 1024 * 1024 });
      let groups: number[][];
      if (mode === 'ranges') {
        const parts = parseRangeParts(rangeSpec, n);
        groups = perPart ? parts : [[...new Set(parts.flat())]];
      } else if (mode === 'every') groups = everyGroups(n, everyN);
      else if (mode === 'bookmarks') groups = segmentsFrom(n, outline.filter((o) => o.depth === 0).map((o) => o.page));
      else if (mode === 'blank') groups = await blankGroups(doc, job);
      else if (mode === 'text') {
        const re = new RegExp(pattern, 'i');
        groups = segmentsFrom(n, await textStarts(doc, re, job));
      } else groups = [picked];
      if (groups.length === 0 || groups.every((g) => g.length === 0)) {
        throw new Error('No pages matched this rule, so there is nothing to split.');
      }
      job.report(0.02, `${groups.length} part(s) to write`);
      return job.work<Uint8Array[]>('split.groups', { bytes, groups });
    });
    setJobId(j.id);
    j.promise
      .then(async (parts) => {
        if (parts.length === 1) downloadBlob(parts[0], outName(name, '-split'));
        else {
          const zip = await zipFiles(
            parts.map((b, i) => ({ name: outName(name, `-part-${String(i + 1).padStart(3, '0')}`), data: b })),
          );
          downloadBlob(zip, outName(name, '-parts', 'zip'), 'application/zip');
        }
        toast({ kind: 'success', title: `Created ${parts.length} file${parts.length === 1 ? '' : 's'}` });
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) toast({ kind: 'error', title: 'Split failed', message: errMessage(e) });
      });
  };

  return (
    <Page
      title="Split PDF"
      desc="Cut by page ranges, every N pages, bookmarks, size, blank pages, text patterns or visual selection."
      icon={<Scissors className="h-5 w-5" />}
      actions={
        file && (
          <Button variant="ghost" onClick={() => setFile(null)}>
            Choose another file
          </Button>
        )
      }
    >
      {!file ? (
        <>
          <Dropzone
            accept="application/pdf,.pdf"
            title="Drop a PDF to split"
            hint="Your file is processed on this computer only."
            onFiles={(f) => void load(f)}
            icon={<Scissors className="h-7 w-7" />}
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
        </>
      ) : (
        <>
          <Card className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{file.name}</div>
              <div className="text-sm text-muted">{n} pages</div>
            </div>
          </Card>

          <Card className="space-y-5">
            <Segmented id="split-mode" label="Split mode" value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m.value, label: m.label }))} />

            {mode === 'ranges' && (
              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <Field label="Pages" hint="Example: 1-3,5,8-10. Each comma part can become its own file.">
                  <Input value={rangeSpec} onChange={(e) => setRangeSpec(e.target.value)} aria-invalid={!rangeCheck.ok} aria-label="Pages" />
                </Field>
                <Toggle checked={perPart} onChange={setPerPart} label="One file per range" />
              </div>
            )}
            {mode === 'every' && (
              <Field label="Pages per file">
                <Input type="number" min={1} max={n} value={everyN} onChange={(e) => setEveryN(Math.max(1, Number(e.target.value) || 1))} className="w-32" />
              </Field>
            )}
            {mode === 'bookmarks' && (
              <p className="text-sm text-muted">
                {file.outline.length > 0
                  ? `Each top-level bookmark starts a new file (${file.outline.filter((o) => o.depth === 0).length} found).`
                  : 'This PDF has no bookmarks. Choose another mode.'}
              </p>
            )}
            {mode === 'size' && (
              <Field label="Maximum size per file (MB)" hint="Pages are grouped so every file stays under this size. A single page larger than the limit is kept whole.">
                <Input type="number" min={0.1} step={0.5} value={maxMB} onChange={(e) => setMaxMB(Math.max(0.1, Number(e.target.value) || 0.1))} className="w-32" />
              </Field>
            )}
            {mode === 'blank' && <p className="text-sm text-muted">Blank pages are used as separators and removed. Each run renders every page, so large files take longer.</p>}
            {mode === 'text' && (
              <Field label="Start a new file at pages containing" hint="Case-insensitive. Regular expressions are allowed, e.g. ^Invoice #\d+">
                <Input value={pattern} onChange={(e) => setPattern(e.target.value)} />
              </Field>
            )}
            {mode === 'selected' && <p className="text-sm text-muted">Click pages below to select them. The selection is saved as one new file.</p>}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted">
                {previewCount !== null ? `Will create ${previewCount} file${previewCount === 1 ? '' : 's'}` : ' '}
                {mode === 'ranges' && !rangeCheck.ok && <span className="ms-2 text-red-500">{rangeCheck.msg}</span>}
              </span>
              <Button variant="primary" onClick={run} disabled={previewCount === 0}>
                Split PDF
              </Button>
            </div>
          </Card>

          {mode === 'selected' && (
            <div className="h-[460px] rounded-card">
              <ThumbGrid
                count={n}
                cellW={120}
                cellH={170}
                label="Pages"
                renderCell={(i) => {
                  const on = selected.has(i);
                  return (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`Page ${i + 1}`}
                      onClick={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        })
                      }
                      className={cn('relative rounded-xl p-1 transition-shadow', on ? 'ring-2 ring-accent bg-accent-soft' : 'hover:bg-line/40')}
                    >
                      <PdfThumb doc={file.doc} docKey={`${file.name}-${file.size}`} pageNo={i + 1} width={108} height={150} />
                      <span className="mt-1 block text-center text-xs tabular-nums text-muted">{i + 1}</span>
                      {on && <span className="absolute end-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-accent text-xs font-bold text-accent-fg">✓</span>}
                    </button>
                  );
                }}
              />
            </div>
          )}

          <InlineJob jobId={jobId} />
        </>
      )}
    </Page>
  );
}

export { readFileBytes };
