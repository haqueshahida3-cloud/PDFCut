// Page editor: non-destructive model (order, rotation, crop, blanks) with unlimited undo/redo,
// autosave and crash recovery. Thumbnails are virtualized, and the PDF is only rebuilt on save.
import { ArrowLeftRight, Copy, FilePlus, Redo2, RotateCcw, RotateCw, Scissors, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Button, Card, Dropzone, Field, Input, Segmented, Select, Toggle } from '../components/ui';
import { InlineJob, Page, ThumbGrid, loadPdfFile, outName } from '../components/Page';
import { PdfThumb } from '../components/PdfView';
import type { PdfDoc } from '../lib/pdfjs';
import { errMessage, downloadBlob, uid } from '../lib/util';
import { kvDel, kvGet, kvSet } from '../lib/util';
import { toast } from '../store/app';
import { enqueue } from '../store/jobs';
import { FloatingPanel } from '../components/FloatingPanel';
import { deltaToUpright, type PageStructure } from '../lib/pdf/analyze';
import { scanPageVisuals, type PageVisual } from '../lib/analyzer';
import type { LabelSpec } from '../lib/pdf/ops';
import { cn } from '../utils/cn';

interface Item {
  id: string;
  src: number;
  rotate: number;
  crop?: { l: number; r: number; t: number; b: number };
}

interface Hist {
  past: Item[][];
  present: Item[];
  future: Item[][];
}

interface Loaded {
  name: string;
  size: number;
  bytes: Uint8Array;
  doc: PdfDoc;
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

export default function PageEditor() {
  const [file, setFile] = useState<Loaded | null>(null);
  const [hist, setHist] = useState<Hist>({ past: [], present: [], future: [] });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [mode, setMode] = useState<'single' | 'nup' | 'booklet'>('single');
  const [paper, setPaper] = useState<'none' | 'a4' | 'letter' | 'a3' | 'a5' | 'legal'>('none');
  const [cols, setCols] = useState(2);
  const [rows, setRows] = useState(2);
  const [landscape, setLandscape] = useState(false);
  const [crop, setCrop] = useState({ t: 0, b: 0, l: 0, r: 0 });
  const [jobId, setJobId] = useState<string | null>(null);
  const dragRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const items = hist.present;
  const docKey = file ? `${file.name}-${file.size}` : '';

  // Page analysis: structure (sizes, duplicates, rotations) runs in the worker; blank pages and text
  // direction are scanned on the main thread in small steps, and the results arrive progressively.
  const [structure, setStructure] = useState<PageStructure | null>(null);
  const [visuals, setVisuals] = useState<Array<PageVisual | undefined>>([]);
  const [labelStyle, setLabelStyle] = useState<LabelSpec['style']>('decimal');
  const [labelStart, setLabelStart] = useState(1);
  const [labelPrefix, setLabelPrefix] = useState('');
  useEffect(() => {
    if (!file) return;
    let alive = true;
    setStructure(null);
    setVisuals([]);
    const structureJob = enqueue(`Analyze ${file.name}`, (ctx) => ctx.work<PageStructure>('analyze.structure', { bytes: file.bytes }));
    structureJob.promise.then((s) => alive && setStructure(s)).catch(() => undefined);
    const acc: Array<PageVisual | undefined> = [];
    void scanPageVisuals(file.doc, () => !alive, (index, v) => {
      acc[index] = v;
      if (index % 25 === 24) setVisuals([...acc]);
    })
      .then(() => {
        if (alive) setVisuals([...acc]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [file]);

  const commit = (fn: (list: Item[]) => Item[]): void => {
    dirtyRef.current = true;
    setHist((h) => ({ past: [...h.past.slice(-199), h.present], present: fn(h.present), future: [] }));
  };
  const undo = (): void =>
    setHist((h) => (h.past.length === 0 ? h : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }));
  const redo = (): void =>
    setHist((h) => (h.future.length === 0 ? h : { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }));

  useEffect(() => {
    const onUndo = (): void => undo();
    const onRedo = (): void => redo();
    window.addEventListener('pdfcut:undo', onUndo);
    window.addEventListener('pdfcut:redo', onRedo);
    return () => {
      window.removeEventListener('pdfcut:undo', onUndo);
      window.removeEventListener('pdfcut:redo', onRedo);
    };
  }, []);

  // Autosave the model (a few KB) so a crash or reload never loses edits.
  useEffect(() => {
    if (!file || !dirtyRef.current) return;
    const key = `pages:${file.name}:${file.size}`;
    const t = window.setTimeout(() => {
      void kvSet(key, { items }).catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(t);
  }, [items, file]);

  const load = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (!f) return;
    try {
      const { bytes, doc } = await loadPdfFile(f);
      const initial: Item[] = Array.from({ length: doc.numPages }, (_, i) => ({ id: uid(), src: i, rotate: 0 }));
      const saved = await kvGet<{ items: Item[] }>(`pages:${f.name}:${f.size}`).catch(() => undefined);
      file?.doc.destroy().catch(() => undefined);
      setFile({ name: f.name, size: f.size, bytes, doc });
      setHist({ past: [], present: initial, future: [] });
      setSel(new Set());
      dirtyRef.current = false;
      if (saved && saved.items.length > 0) {
        const recovered = saved.items;
        toast({
          kind: 'info',
          title: 'Unsaved page edits found',
          message: `${recovered.length} pages from your last session`,
          actionLabel: 'Restore',
          duration: 12000,
          onAction: () => commit(() => recovered),
        });
      }
    } catch (e) {
      toast({ kind: 'error', title: 'Could not open this PDF', message: errMessage(e) });
    }
  };

  const select = (i: number, e: MouseEvent): void => {
    const id = items[i].id;
    if (e.shiftKey && anchor !== null) {
      const a = Math.min(anchor, i);
      const b = Math.max(anchor, i);
      setSel(new Set(items.slice(a, b + 1).map((x) => x.id)));
    } else if (e.ctrlKey || e.metaKey) {
      setSel((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setAnchor(i);
    } else {
      setSel(new Set([id]));
      setAnchor(i);
    }
  };

  const rotateSel = (d: number): void =>
    commit((list) => list.map((it) => (sel.has(it.id) ? { ...it, rotate: (((it.rotate + d) % 360) + 360) % 360 } : it)));
  const deleteSel = (): void => {
    commit((list) => list.filter((it) => !sel.has(it.id)));
    setSel(new Set());
  };
  const duplicateSel = (): void => commit((list) => list.flatMap((it) => (sel.has(it.id) ? [it, { ...it, id: uid() }] : [it])));
  const blankAfterSel = (): void =>
    commit((list) => list.flatMap((it) => (sel.has(it.id) ? [it, { id: uid(), src: -1, rotate: 0 }] : [it])));
  const halvesSel = (): void =>
    commit((list) =>
      list.flatMap((it) =>
        it.src < 0 || !sel.has(it.id)
          ? [it]
          : [
              { ...it, id: uid(), crop: { t: 0, b: 0, l: 0, r: 0.5 } },
              { ...it, id: uid(), crop: { t: 0, b: 0, l: 0.5, r: 0 } },
            ],
      ),
    );
  const cropSel = (): void =>
    commit((list) =>
      list.map((it) =>
        sel.has(it.id) && it.src >= 0 ? { ...it, crop: { t: crop.t / 100, b: crop.b / 100, l: crop.l / 100, r: crop.r / 100 } } : it,
      ),
    );
  const moveItem = (from: number, to: number): void => {
    if (from === to) return;
    commit((list) => {
      const next = list.slice();
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  };

  const save = (): void => {
    if (!file || items.length === 0) return;
    const { name, size, bytes } = file;
    const snapshot = items.map((it) => ({ src: it.src, rotate: it.rotate, crop: it.crop }));
    const j = enqueue(`Build ${name}`, (job) =>
      job.work<Uint8Array>('pages.build', {
        bytes,
        items: snapshot,
        layout: { mode, paper, cols, rows, landscape },
        labels: { style: labelStyle, start: labelStart, prefix: labelPrefix },
      }),
    );
    setJobId(j.id);
    j.promise
      .then((out) => {
        downloadBlob(out, outName(name, '-edited'));
        void kvDel(`pages:${name}:${size}`).catch(() => undefined);
        dirtyRef.current = false;
        toast({ kind: 'success', title: 'Saved as a new file', message: outName(name, '-edited') });
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) toast({ kind: 'error', title: 'Could not build the PDF', message: errMessage(e) });
      });
  };

  if (!file) {
    return (
      <Page title="Page editor" desc="Rotate, delete, reorder, duplicate, crop, split in half, N-up and booklet layouts." icon={<Scissors className="h-5 w-5" />}>
        <Dropzone accept="application/pdf,.pdf" title="Drop a PDF to edit its pages" onFiles={(f) => void load(f)} icon={<FilePlus className="h-7 w-7" />} />
      </Page>
    );
  }

  const hasSel = sel.size > 0;
  const iconBtn = 'btn btn-ghost btn-sm';

  return (
    <Page
      title="Page editor"
      desc={`${file.name} · ${items.length} pages · changes are applied when you save`}
      icon={<Scissors className="h-5 w-5" />}
      actions={
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" />} onClick={undo} disabled={hist.past.length === 0}>
            Undo
          </Button>
          <Button size="sm" variant="ghost" icon={<Redo2 className="h-4 w-4" />} onClick={redo} disabled={hist.future.length === 0}>
            Redo
          </Button>
          <Button size="sm" variant="primary" onClick={save} disabled={items.length === 0}>
            Save as new PDF
          </Button>
        </div>
      }
    >
      <Card className="flex flex-wrap items-center gap-1 py-2">
        <button type="button" className={iconBtn} onClick={() => setSel(new Set(items.map((x) => x.id)))}>
          Select all
        </button>
        <button type="button" className={iconBtn} onClick={() => setSel(new Set())} disabled={!hasSel}>
          Clear
        </button>
        <span className="mx-2 h-5 w-px bg-line" aria-hidden="true" />
        <button
          type="button"
          className={iconBtn}
          onClick={() => setSel(new Set(items.filter((it) => it.src >= 0 && (structure?.groups ?? []).some((g) => g.includes(it.src) && g.indexOf(it.src) > 0)).map((it) => it.id)))}
          disabled={!structure || structure.groups.length === 0}
          title="Select pages that repeat an earlier page exactly (the first copy is kept)"
        >
          Select duplicates
        </button>
        <button
          type="button"
          className={iconBtn}
          onClick={() => setSel(new Set(items.filter((it) => it.src >= 0 && visuals[it.src]?.blank).map((it) => it.id)))}
          title="Select pages with almost no ink"
        >
          Select blank
        </button>
        <button
          type="button"
          className={iconBtn}
          disabled={!hasSel}
          title="Rotate selected pages so their text reads upright (needs a text layer)"
          onClick={() =>
            commit((list) =>
              list.map((it) => {
                const q = it.src >= 0 ? visuals[it.src]?.quarter : undefined;
                if (!sel.has(it.id) || q === undefined || q === null) return it;
                const effective = (((structure?.rotations[it.src] ?? 0) + it.rotate) % 360 + 360) % 360;
                return { ...it, rotate: (it.rotate + deltaToUpright(effective, q)) % 360 };
              }),
            )
          }
        >
          Auto-orient
        </button>
        <button type="button" className={iconBtn} onClick={() => rotateSel(-90)} disabled={!hasSel} aria-label="Rotate left">
          <RotateCcw className="h-4 w-4" />
        </button>
        <button type="button" className={iconBtn} onClick={() => rotateSel(90)} disabled={!hasSel} aria-label="Rotate right">
          <RotateCw className="h-4 w-4" />
        </button>
        <button type="button" className={iconBtn} onClick={duplicateSel} disabled={!hasSel}>
          <Copy className="h-4 w-4" /> Duplicate
        </button>
        <button type="button" className={iconBtn} onClick={blankAfterSel} disabled={!hasSel}>
          <FilePlus className="h-4 w-4" /> Blank after
        </button>
        <button type="button" className={iconBtn} onClick={halvesSel} disabled={!hasSel}>
          <ArrowLeftRight className="h-4 w-4" /> Split in half
        </button>
        <button type="button" className={cn(iconBtn, 'text-red-500')} onClick={deleteSel} disabled={!hasSel}>
          <Trash2 className="h-4 w-4" /> Delete
        </button>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <div className="h-[560px] min-w-0">
          <ThumbGrid
            count={items.length}
            cellW={130}
            cellH={190}
            label="Pages"
            renderCell={(i) => {
              const it = items[i];
              const on = sel.has(it.id);
              return (
                <div
                  role="checkbox"
                  aria-checked={on}
                  tabIndex={0}
                  draggable
                  onDragStart={() => {
                    dragRef.current = i;
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragRef.current !== null) moveItem(dragRef.current, i);
                    dragRef.current = null;
                  }}
                  onClick={(e) => select(i, e)}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      select(i, e as unknown as MouseEvent);
                    }
                    if (e.key === 'Delete') deleteSel();
                  }}
                  className={cn('cursor-pointer rounded-xl p-1.5 transition-shadow', on ? 'bg-accent-soft ring-2 ring-accent' : 'hover:bg-line/40')}
                >
                  {it.src >= 0 ? (
                    <PdfThumb doc={file.doc} docKey={docKey} pageNo={it.src + 1} width={116} height={150} rotate={it.rotate} />
                  ) : (
                    <div className="grid place-items-center rounded-md border-2 border-dashed border-line bg-white text-xs text-muted" style={{ width: 116, height: 150 }}>
                      Blank
                    </div>
                  )}
                  <div className="mt-1 truncate text-center text-xs tabular-nums text-muted">
                    {i + 1}
                    {it.src >= 0 ? ` · orig ${it.src + 1}` : ''}
                    {it.rotate ? ` · ${it.rotate}°` : ''}
                    {it.crop ? ' · cropped' : ''}
                  </div>
                </div>
              );
            }}
          />
        </div>

        <div className="space-y-4">
          <Card className="space-y-3">
            <div className="text-sm font-semibold">Crop selected pages (%)</div>
            <div className="grid grid-cols-4 gap-2">
              {(['t', 'b', 'l', 'r'] as const).map((k) => (
                <Field key={k} label={{ t: 'Top', b: 'Bottom', l: 'Left', r: 'Right' }[k]}>
                  <Input
                    type="number"
                    min={0}
                    max={90}
                    value={crop[k]}
                    onChange={(e) => setCrop((c) => ({ ...c, [k]: Math.max(0, Math.min(90, Number(e.target.value) || 0)) }))}
                  />
                </Field>
              ))}
            </div>
            <Button size="sm" onClick={cropSel} disabled={!hasSel}>
              Apply crop to selection
            </Button>
          </Card>

          <Card className="space-y-3">
            <div className="text-sm font-semibold">Output layout</div>
            <Segmented
              id="page-layout"
              label="Layout"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'single', label: 'Pages' },
                { value: 'nup', label: 'N-up' },
                { value: 'booklet', label: 'Booklet' },
              ]}
            />
            <Field label="Paper size" hint={paper === 'none' ? 'Keep each page at its original size.' : 'Pages are scaled to fit the paper.'}>
              <Select value={paper} onChange={(e) => setPaper(e.target.value as typeof paper)}>
                <option value="none">Original size</option>
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
                <option value="legal">Legal</option>
                <option value="a3">A3</option>
                <option value="a5">A5</option>
              </Select>
            </Field>
            {mode === 'nup' && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Columns">
                  <Input type="number" min={1} max={6} value={cols} onChange={(e) => setCols(Math.max(1, Number(e.target.value) || 1))} />
                </Field>
                <Field label="Rows">
                  <Input type="number" min={1} max={6} value={rows} onChange={(e) => setRows(Math.max(1, Number(e.target.value) || 1))} />
                </Field>
              </div>
            )}
            {(mode !== 'single' || paper !== 'none') && (
              <div className="flex items-center justify-between text-sm">
                <span>Landscape</span>
                <Toggle checked={landscape} onChange={setLandscape} label="Landscape sheets" />
              </div>
            )}
            {mode === 'booklet' && <p className="text-xs text-muted">Booklet pages are imposed for saddle-stitch printing: print double-sided, then fold and staple in the middle.</p>}
          </Card>
          <p className="text-xs text-muted">
            Tip: click to select, Shift+click for a range, Ctrl+click to add. Drag thumbnails to reorder. Ctrl+Z / Ctrl+Shift+Z undo and redo.
          </p>
        </div>
      </div>
      <Card className="space-y-3">
        <div className="text-sm font-semibold">Page numbering (labels that viewers show)</div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Style">
            <Select value={labelStyle} onChange={(e) => setLabelStyle(e.target.value as LabelSpec['style'])} className="w-40" aria-label="Page label style">
              <option value="decimal">1, 2, 3</option>
              <option value="roman">i, ii, iii</option>
              <option value="ROMAN">I, II, III</option>
              <option value="alpha">a, b, c</option>
              <option value="ALPHA">A, B, C</option>
              <option value="none">None</option>
            </Select>
          </Field>
          <Field label="Start at">
            <Input type="number" min={1} value={labelStart} onChange={(e) => setLabelStart(Math.max(1, Number(e.target.value) || 1))} className="w-28" />
          </Field>
          <Field label="Prefix">
            <Input value={labelPrefix} onChange={(e) => setLabelPrefix(e.target.value)} className="w-40" />
          </Field>
        </div>
        <p className="text-xs text-muted">Written into the saved file. Useful after removing front matter, so printed and PDF numbers match.</p>
      </Card>
      <FloatingPanel title="Selection and document">
        <div className="space-y-1 text-xs">
          <div>
            <span className="font-semibold">{sel.size}</span> selected of {items.length}
          </div>
          <div className="text-muted">
            Sizes: {[...new Set(items.filter((it) => sel.has(it.id) && it.src >= 0).map((it) => structure?.sizes[it.src] ?? '…'))].join(', ') || '—'}
          </div>
          <div className="text-muted">Duplicate pages: {structure ? structure.groups.reduce((n, g) => n + g.length - 1, 0) : '…'}</div>
          <div className="text-muted">Blank pages: {visuals.length ? visuals.filter((v) => v?.blank).length : '…'}</div>
        </div>
      </FloatingPanel>
      <InlineJob jobId={jobId} />
    </Page>
  );
}
