// Compare two PDFs: a line-level text diff (LCS) and a per-page visual diff (pixel comparison).
import { GitCompare } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Dropzone } from '../components/ui';
import { InlineJob, Page, loadPdfFile } from '../components/Page';
import { pageText, renderPageTo, type PdfDoc } from '../lib/pdfjs';
import { errMessage, formatPercent } from '../lib/util';
import { toast } from '../store/app';
import { enqueue, type JobCtx } from '../store/jobs';
import { cn } from '../utils/cn';

type Row = { t: 'eq' | 'add' | 'del'; s: string };

/** Longest-common-subsequence line diff. Falls back to a set difference for very large inputs. */
export function lineDiff(a: string[], b: string[]): Row[] {
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    const sa = new Set(a);
    const sb = new Set(b);
    return [...a.filter((s) => !sb.has(s)).map((s) => ({ t: 'del' as const, s })), ...b.filter((s) => !sa.has(s)).map((s) => ({ t: 'add' as const, s }))];
  }
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const out: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: 'eq', s: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      out.push({ t: 'del', s: a[i++] });
    } else {
      out.push({ t: 'add', s: b[j++] });
    }
  }
  while (i < n) out.push({ t: 'del', s: a[i++] });
  while (j < m) out.push({ t: 'add', s: b[j++] });
  return out;
}

async function textLines(doc: PdfDoc, job: JobCtx): Promise<string[]> {
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    await job.checkpoint();
    const page = await doc.getPage(p);
    const t = await pageText(page);
    page.cleanup();
    out.push(`— page ${p} —`, ...t.lines);
    job.report((p / doc.numPages) * 0.4, `Reading text ${p}/${doc.numPages}`);
  }
  return out;
}

async function pageImage(doc: PdfDoc, p: number): Promise<ImageData> {
  const page = await doc.getPage(p);
  const canvas = document.createElement('canvas');
  await renderPageTo(page, canvas, 0.6).promise;
  page.cleanup();
  const cx = canvas.getContext('2d');
  if (!cx) throw new Error('Canvas unavailable');
  return cx.getImageData(0, 0, canvas.width, canvas.height);
}

function compareImages(a: ImageData, b: ImageData): { pct: number; url: string } {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const out = new ImageData(w, h);
  let changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (y * a.width + x) * 4;
      const ib = (y * b.width + x) * 4;
      const io = (y * w + x) * 4;
      const d = Math.abs(a.data[ia] - b.data[ib]) + Math.abs(a.data[ia + 1] - b.data[ib + 1]) + Math.abs(a.data[ia + 2] - b.data[ib + 2]);
      if (d > 60) {
        changed++;
        out.data[io] = 255;
        out.data[io + 1] = 40;
        out.data[io + 2] = 40;
      } else {
        const g = 255 - (255 - (a.data[ia] + a.data[ia + 1] + a.data[ia + 2]) / 3) * 0.25;
        out.data[io] = g;
        out.data[io + 1] = g;
        out.data[io + 2] = g;
      }
      out.data[io + 3] = 255;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')?.putImageData(out, 0, 0);
  return { pct: w * h === 0 ? 1 : changed / (w * h), url: canvas.toDataURL('image/png') };
}

interface Result {
  rows: Row[];
  added: number;
  removed: number;
  pages: Array<{ page: number; pct: number; url?: string; note?: string }>;
  visualPages: number;
}

interface Side {
  name: string;
  doc: PdfDoc;
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

function FileSlot({ label, side, onChange }: { label: string; side: Side | null; onChange: (s: Side | null) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card className="space-y-3">
      <div className="text-sm font-semibold">{label}</div>
      {side ? (
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-sm">
            {side.name} · {side.doc.numPages} pages
          </span>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      ) : (
        <Dropzone
          compact
          accept="application/pdf,.pdf"
          title={busy ? 'Opening…' : 'Drop a PDF'}
          onFiles={(files) => {
            const f = files[0];
            if (!f) return;
            setBusy(true);
            void loadPdfFile(f)
              .then(({ doc }) => onChange({ name: f.name, doc }))
              .catch((e: unknown) => toast({ kind: 'error', title: 'Could not open this PDF', message: errMessage(e) }))
              .finally(() => setBusy(false));
          }}
        />
      )}
    </Card>
  );
}

export default function Compare() {
  const [a, setA] = useState<Side | null>(null);
  const [b, setB] = useState<Side | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [showAll, setShowAll] = useState(false);

  const run = (): void => {
    if (!a || !b) return;
    const sa = a;
    const sb = b;
    const j = enqueue('Compare PDFs', async (job) => {
      const linesA = await textLines(sa.doc, job);
      const linesB = await textLines(sb.doc, job);
      const rows = lineDiff(linesA, linesB);
      const maxPages = Math.min(60, Math.min(sa.doc.numPages, sb.doc.numPages));
      const pages: Result['pages'] = [];
      for (let p = 1; p <= maxPages; p++) {
        await job.checkpoint();
        const ia = await pageImage(sa.doc, p);
        const ib = await pageImage(sb.doc, p);
        if (ia.width !== ib.width || ia.height !== ib.height) {
          pages.push({ page: p, pct: 1, note: 'Page size differs' });
        } else {
          const { pct, url } = compareImages(ia, ib);
          if (pct > 0.0005) pages.push({ page: p, pct, url });
        }
        job.report(0.4 + (p / maxPages) * 0.6, `Visual check ${p}/${maxPages}`);
      }
      if (sa.doc.numPages !== sb.doc.numPages) {
        pages.push({ page: Math.min(sa.doc.numPages, sb.doc.numPages) + 1, pct: 1, note: `Page count differs (${sa.doc.numPages} vs ${sb.doc.numPages})` });
      }
      return {
        rows,
        added: rows.filter((r) => r.t === 'add').length,
        removed: rows.filter((r) => r.t === 'del').length,
        pages,
        visualPages: maxPages,
      } satisfies Result;
    });
    setJobId(j.id);
    setShowAll(false);
    j.promise
      .then((r) => {
        setResult(r);
        toast({ kind: 'success', title: 'Comparison ready', message: `${r.added} added · ${r.removed} removed lines` });
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) toast({ kind: 'error', title: 'Comparison failed', message: errMessage(e) });
      });
  };

  const changedRows = result ? result.rows.filter((r) => r.t !== 'eq') : [];
  const shown = showAll ? changedRows : changedRows.slice(0, 300);

  return (
    <Page title="Compare PDFs" desc="Text diff and visual diff between two versions of a document." icon={<GitCompare className="h-5 w-5" />}>
      <div className="grid gap-4 md:grid-cols-2">
        <FileSlot label="Original" side={a} onChange={setA} />
        <FileSlot label="Revised" side={b} onChange={setB} />
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={run} disabled={!a || !b}>
          Compare
        </Button>
      </div>
      <InlineJob jobId={jobId} />

      {result && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Stat label="Lines added" value={String(result.added)} tone="text-emerald-600" />
            <Stat label="Lines removed" value={String(result.removed)} tone="text-red-500" />
            <Stat label="Pages visually changed" value={`${result.pages.length} of ${result.visualPages}`} tone="text-accent" />
          </div>

          <Card className="space-y-3">
            <div className="text-sm font-semibold">Text differences</div>
            {changedRows.length === 0 ? (
              <p className="text-sm text-muted">The extracted text is identical.</p>
            ) : (
              <ul className="max-h-[420px] overflow-auto rounded-xl border border-line font-mono text-xs">
                {shown.map((r, i) => (
                  <li
                    key={i}
                    className={cn('whitespace-pre-wrap break-all px-3 py-0.5', r.t === 'add' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/15 text-red-600 dark:text-red-300')}
                  >
                    {r.t === 'add' ? '+ ' : '− '}
                    {r.s}
                  </li>
                ))}
              </ul>
            )}
            {changedRows.length > 300 && !showAll && (
              <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
                Show all {changedRows.length} changes
              </Button>
            )}
          </Card>

          <Card className="space-y-3">
            <div className="text-sm font-semibold">Visual differences (first {result.visualPages} pages)</div>
            {result.pages.length === 0 && <p className="text-sm text-muted">No visible differences were found.</p>}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {result.pages.map((p) => (
                <figure key={p.page} className="space-y-1.5">
                  <figcaption className="text-sm font-medium">
                    Page {p.page} · {p.note ?? `${formatPercent(p.pct)} of pixels changed`}
                  </figcaption>
                  {p.url && <img src={p.url} alt={`Visual differences on page ${p.page}`} className="w-full rounded-xl border border-line bg-white" />}
                </figure>
              ))}
            </div>
            <p className="text-xs text-muted">Red marks pixels that differ. Unchanged areas are faded.</p>
          </Card>
        </>
      )}
    </Page>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="glass rounded-card p-5">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', tone)}>{value}</div>
    </div>
  );
}
