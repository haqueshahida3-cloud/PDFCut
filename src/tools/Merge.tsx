// Merge: drag-and-drop ordering, per-file page selection, and automatic bookmarks per file.
import { ArrowDown, ArrowUp, Combine, FileText, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Dropzone, Input, Toggle } from '../components/ui';
import { InlineJob, Page, outName, readFileBytes } from '../components/Page';
import { openPdf } from '../lib/pdfjs';
import { downloadBlob, errMessage, formatBytes, parseRanges, uid } from '../lib/util';
import { takePending, toast } from '../store/app';
import { enqueue } from '../store/jobs';
import { cn } from '../utils/cn';

interface Item {
  id: string;
  name: string;
  size: number;
  bytes: Uint8Array;
  pages: number;
  spec: string;
  bookmark: boolean;
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

export default function Merge() {
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState('merged');
  const [jobId, setJobId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);

  const add = async (files: File[]): Promise<void> => {
    setAdding(true);
    const added: Item[] = [];
    for (const f of files) {
      try {
        const bytes = await readFileBytes(f);
        const doc = await openPdf(bytes);
        const pages = doc.numPages;
        await doc.destroy();
        added.push({ id: uid(), name: f.name, size: f.size, bytes, pages, spec: '', bookmark: true });
      } catch (e) {
        toast({ kind: 'error', title: `Could not add ${f.name}`, message: errMessage(e) });
      }
    }
    setItems((prev) => [...prev, ...added]);
    setAdding(false);
  };

  // Files sent from "Open with PDFCut" or the file manager are added when this tool opens.
  useEffect(() => {
    const incoming = takePending('merge');
    if (incoming.length > 0) void add(incoming);
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (from: number, to: number): void => {
    if (from === to || to < 0 || to >= items.length) return;
    setItems((prev) => {
      const next = prev.slice();
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  };

  const patch = (id: string, p: Partial<Item>): void => setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const run = (): void => {
    if (items.length < 2) {
      toast({ kind: 'info', title: 'Add at least two PDFs to merge' });
      return;
    }
    let inputs: Array<{ bytes: Uint8Array; name: string; pages: number[] | null; bookmark: boolean }>;
    try {
      inputs = items.map((it) => ({
        bytes: it.bytes,
        name: it.name,
        pages: it.spec.trim() ? parseRanges(it.spec, it.pages) : null,
        bookmark: it.bookmark,
      }));
    } catch (e) {
      toast({ kind: 'error', title: 'Check the page selections', message: errMessage(e) });
      return;
    }
    const j = enqueue(`Merge ${items.length} files`, (job) => job.work<Uint8Array>('merge', { inputs }));
    setJobId(j.id);
    j.promise
      .then((out) => {
        downloadBlob(out, outName(name || 'merged', ''));
        toast({ kind: 'success', title: 'Merged PDF saved', message: `${items.length} files combined` });
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) toast({ kind: 'error', title: 'Merge failed', message: errMessage(e) });
      });
  };

  return (
    <Page
      title="Merge PDFs"
      desc="Drag to reorder, pick pages from each file, and add a bookmark per file."
      icon={<Combine className="h-5 w-5" />}
      actions={
        <Button variant="primary" onClick={run} disabled={items.length < 2 || adding}>
          Merge {items.length > 0 ? `${items.length} files` : ''}
        </Button>
      }
    >
      {items.length === 0 ? (
        <Dropzone
          multiple
          accept="application/pdf,.pdf"
          title="Drop PDFs to merge"
          hint="Add two or more files, then drag them into the order you want."
          onFiles={(f) => void add(f)}
          icon={<Combine className="h-7 w-7" />}
        />
      ) : (
        <>
          <Card className="flex flex-wrap items-center gap-4">
            <Toggle
              checked={items.every((x) => x.bookmark)}
              onChange={(v) => setItems((prev) => prev.map((x) => ({ ...x, bookmark: v })))}
              label="Add a bookmark for each file"
            />
            <span className="text-sm">Bookmark for each file</span>
            <label className="ms-auto flex items-center gap-2 text-sm">
              <span className="text-muted">Output name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="w-48" />
              <span className="text-muted">.pdf</span>
            </label>
          </Card>

          <ol className="space-y-2" aria-label="Files in merge order">
            {items.map((it, i) => (
              <li
                key={it.id}
                draggable
                onDragStart={() => {
                  dragRef.current = i;
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverIdx(i);
                }}
                onDragLeave={() => setOverIdx(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragRef.current !== null) move(dragRef.current, i);
                  dragRef.current = null;
                  setOverIdx(null);
                }}
                onDragEnd={() => {
                  dragRef.current = null;
                  setOverIdx(null);
                }}
                className={cn(
                  'glass flex flex-wrap items-center gap-3 rounded-card px-4 py-3 transition-shadow',
                  overIdx === i && 'ring-2 ring-accent',
                )}
              >
                <span className="grid h-8 w-8 shrink-0 cursor-grab place-items-center rounded-lg bg-line/60 text-sm font-semibold tabular-nums" aria-hidden="true">
                  {i + 1}
                </span>
                <FileText className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{it.name}</div>
                  <div className="text-xs text-muted">
                    {it.pages} pages · {formatBytes(it.size)}
                  </div>
                </div>
                <Input
                  value={it.spec}
                  onChange={(e) => patch(it.id, { spec: e.target.value })}
                  placeholder="All pages (e.g. 1-3,7)"
                  aria-label={`Pages to include from ${it.name}`}
                  className="w-44"
                />
                <label className="flex items-center gap-2 text-xs text-muted">
                  <Toggle checked={it.bookmark} onChange={(v) => patch(it.id, { bookmark: v })} label={`Bookmark for ${it.name}`} />
                  Bookmark
                </label>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Move ${it.name} up`} onClick={() => move(i, i - 1)} disabled={i === 0}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Move ${it.name} down`} onClick={() => move(i, i + 1)} disabled={i === items.length - 1}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${it.name}`} onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>

          <Dropzone compact multiple accept="application/pdf,.pdf" title="Add more PDFs" onFiles={(f) => void add(f)} />
          <InlineJob jobId={jobId} />
        </>
      )}
    </Page>
  );
}
