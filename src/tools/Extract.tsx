// Extract: all text, tables to CSV (layout heuristic), embedded attachments, and document facts.
import { Table } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Dropzone, Field, Input } from '../components/ui';
import { Page, loadPdfFile, outName, zipFiles } from '../components/Page';
import { pageText, readAttachments, readInfo, type PdfDoc, type TextBox } from '../lib/pdfjs';
import { downloadBlob, errMessage, formatBytes, parseRanges } from '../lib/util';
import { toast } from '../store/app';
import { enqueue } from '../store/jobs';

/** Groups text boxes into rows, then splits each row into cells at large horizontal gaps. */
export function tableRows(boxes: TextBox[]): string[][] {
  const rows: TextBox[][] = [];
  const sorted = [...boxes].sort((p, q) => q.y - p.y || p.x - q.x);
  for (const b of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - b.y) < Math.max(2, b.h * 0.5));
    if (row) row.push(b);
    else rows.push([b]);
  }
  return rows
    .map((row) => {
      row.sort((p, q) => p.x - q.x);
      const cells: string[] = [];
      let cur = '';
      let lastEnd: number | null = null;
      for (const b of row) {
        if (lastEnd === null) cur = b.str;
        else if (b.x - lastEnd > Math.max(6, b.h * 1.2)) {
          cells.push(cur.trim());
          cur = b.str;
        } else cur += (b.x - lastEnd > b.h * 0.15 ? ' ' : '') + b.str;
        lastEnd = b.x + b.w;
      }
      cells.push(cur.trim());
      return cells;
    })
    .filter((r) => r.length >= 2 && r.some((c) => c.length > 0));
}

function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}

interface Loaded {
  name: string;
  size: number;
  doc: PdfDoc;
}

export default function Extract() {
  const [file, setFile] = useState<Loaded | null>(null);
  const [range, setRange] = useState('');
  const [facts, setFacts] = useState<Record<string, string> | null>(null);

  const load = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (!f) return;
    try {
      const { doc } = await loadPdfFile(f);
      setFile({ name: f.name, size: f.size, doc });
      setFacts(null);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not open this PDF', message: errMessage(e) });
    }
  };

  const pagesFor = (doc: PdfDoc): number[] => (range.trim() ? parseRanges(range, doc.numPages) : Array.from({ length: doc.numPages }, (_, i) => i));

  const runExport = (title: string, build: (f: Loaded) => Promise<{ data: Uint8Array | string; name: string; type: string } | Array<{ name: string; data: Uint8Array }>>): void => {
    if (!file) return;
    const f = file;
    const j = enqueue(title, async (job) => {
      job.report(0.01, title);
      return build(f);
    });
    j.promise
      .then(async (out) => {
        if (Array.isArray(out)) {
          if (out.length === 0) {
            toast({ kind: 'info', title: 'Nothing found' });
            return;
          }
          if (out.length === 1) downloadBlob(out[0].data, out[0].name);
          else downloadBlob(await zipFiles(out), outName(f.name, '-extracted', 'zip'), 'application/zip');
          toast({ kind: 'success', title: `${out.length} file${out.length === 1 ? '' : 's'} extracted` });
          return;
        }
        downloadBlob(out.data, out.name, out.type);
        toast({ kind: 'success', title: 'Extracted', message: out.name });
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error && e.name === 'AbortError')) toast({ kind: 'error', title: 'Extraction failed', message: errMessage(e) });
      });
  };

  const textAll = (f: Loaded): Promise<{ data: string; name: string; type: string }> =>
    (async () => {
      const parts: string[] = [];
      for (const p of pagesFor(f.doc)) {
        const page = await f.doc.getPage(p + 1);
        const t = await pageText(page);
        page.cleanup();
        parts.push(`--- Page ${p + 1} ---\n${t.text}`);
      }
      return { data: parts.join('\n\n'), name: outName(f.name, '-text', 'txt'), type: 'text/plain;charset=utf-8' };
    })();

  const tablesCsv = (f: Loaded): Promise<{ data: string; name: string; type: string }> =>
    (async () => {
      const rows: string[][] = [];
      for (const p of pagesFor(f.doc)) {
        const page = await f.doc.getPage(p + 1);
        const t = await pageText(page);
        page.cleanup();
        rows.push(...tableRows(t.boxes), []);
      }
      return { data: toCsv(rows), name: outName(f.name, '-tables', 'csv'), type: 'text/csv;charset=utf-8' };
    })();

  const attachments = async (f: Loaded): Promise<Array<{ name: string; data: Uint8Array }>> => {
    const list = await readAttachments(f.doc);
    return list.map((a) => ({ name: a.filename, data: a.content }));
  };

  const showFacts = async (f: Loaded): Promise<void> => {
    const info = await readInfo(f.doc);
    const page = await f.doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    page.cleanup();
    const att = await readAttachments(f.doc);
    setFacts({
      Pages: String(f.doc.numPages),
      'First page size': `${Math.round(vp.width)} × ${Math.round(vp.height)} pt`,
      'File size': formatBytes(f.size),
      Title: info.Title ?? '—',
      Author: info.Author ?? '—',
      Producer: info.Producer ?? '—',
      'Attachments': String(att.length),
      'Embedded fonts and images': 'Not listed in this build (see README)',
    });
  };

  if (!file) {
    return (
      <Page title="Extract" desc="Text, tables to CSV, attachments and document facts." icon={<Table className="h-5 w-5" />}>
        <Dropzone accept="application/pdf,.pdf" title="Drop a PDF" onFiles={(f) => void load(f)} icon={<Table className="h-7 w-7" />} />
      </Page>
    );
  }

  return (
    <Page title="Extract" desc={file.name} icon={<Table className="h-5 w-5" />} actions={<Button variant="ghost" onClick={() => setFile(null)}>Choose another</Button>}>
      <Card className="max-w-md">
        <Field label="Pages (optional)" hint="Leave empty for all pages. Example: 1-5,9">
          <Input value={range} onChange={(e) => setRange(e.target.value)} placeholder="All pages" />
        </Field>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="space-y-3">
          <div className="font-semibold">All text</div>
          <p className="text-sm text-muted">Plain text with page markers. Scanned pages need OCR first.</p>
          <Button onClick={() => runExport('Extract text', textAll)}>Export .txt</Button>
        </Card>
        <Card className="space-y-3">
          <div className="font-semibold">Tables → CSV</div>
          <p className="text-sm text-muted">Heuristic detection of aligned columns. Check the result for complex layouts.</p>
          <Button onClick={() => runExport('Extract tables', tablesCsv)}>Export .csv</Button>
        </Card>
        <Card className="space-y-3">
          <div className="font-semibold">Attachments</div>
          <p className="text-sm text-muted">Files embedded inside the PDF, downloaded as-is.</p>
          <Button onClick={() => runExport('Extract attachments', attachments)}>Extract files</Button>
        </Card>
        <Card className="space-y-3">
          <div className="font-semibold">Document facts</div>
          <p className="text-sm text-muted">Pages, size, metadata and attachment count.</p>
          <Button onClick={() => void showFacts(file)}>Show facts</Button>
        </Card>
      </div>
      {facts && (
        <Card>
          <dl className="grid gap-2 sm:grid-cols-2">
            {Object.entries(facts).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 rounded-xl bg-line/30 px-3 py-2 text-sm">
                <dt className="text-muted">{k}</dt>
                <dd className="truncate font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
      <p className="text-xs text-muted">Embedded image and font extraction is not included in this web build; use the desktop engine for those.</p>
    </Page>
  );
}
