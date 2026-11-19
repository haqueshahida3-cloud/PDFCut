// Annotate & redact: highlight, boxes, ink, text, notes and signatures. Redaction burns boxes into the page
// pixels inside the PDF worker; afterwards the text layer is checked for any text that should be gone.
import { EyeOff, Highlighter, Pen, PenLine, Redo2, Search, Square, StickyNote, Trash2, Type, Undo2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { residualCounts } from '../lib/analyzer';
import { PdfCanvas } from '../components/PdfView';
import { Button, Card, Dropzone, Field, Input, Modal, Segmented } from '../components/ui';
import { InlineJob, Page, loadPdfFile, outName } from '../components/Page';
import { pageText, type PdfDoc } from '../lib/pdfjs';
import type { AnnotIn } from '../lib/pdf/ops';
import type { NormBox } from '../lib/pdf/raster-core';
import { downloadBlob, errMessage, uid } from '../lib/util';
import { toast } from '../store/app';
import { enqueue } from '../store/jobs';
import { cn } from '../utils/cn';

type Tool = 'highlight' | 'rect' | 'ink' | 'text' | 'note' | 'redact' | 'sign';

interface Annot {
  id: string;
  page: number; // 0-based
  type: Exclude<Tool, 'sign'> | 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  text?: string; // for redactions: the matched text, used by the verification step
  points?: number[];
  sig?: { bytes: Uint8Array; url: string };
}

const COLORS = ['#fde047', '#f97316', '#ef4444', '#22c55e', '#3b82f6', '#111827'];
const PATTERNS: Array<{ id: string; label: string; re: RegExp }> = [
  { id: 'email', label: 'Email addresses', re: /[\w.+-]+@[\w-]+\.[\w.-]+/gi },
  { id: 'phone', label: 'Phone numbers', re: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3}[\s.-]\d{3,4}(?:[\s.-]\d{3,4})?/g },
  { id: 'card', label: 'Card numbers', re: /\b(?:\d[ -]?){13,19}\b/g },
  { id: 'ssn', label: 'SSN-style IDs', re: /\b\d{3}-\d{2}-\d{4}\b/g },
];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function SignaturePad({ onSave }: { onSave: (bytes: Uint8Array, url: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typed, setTyped] = useState('');

  const pos = (e: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const c = ref.current;
    if (!c) return [0, 0];
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height];
  };

  const save = (): void => {
    let canvas = ref.current;
    if (mode === 'type') {
      canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 240;
      const cx = canvas.getContext('2d');
      if (cx) {
        cx.font = 'italic 120px "Brush Script MT", "Segoe Script", cursive';
        cx.fillStyle = '#111827';
        cx.textBaseline = 'middle';
        cx.fillText(typed, 20, 120);
      }
    }
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      onSave(new Uint8Array(await blob.arrayBuffer()), URL.createObjectURL(blob));
    }, 'image/png');
  };

  return (
    <div className="space-y-3">
      <Segmented
        id="sig-mode"
        label="Signature method"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'draw', label: 'Draw' },
          { value: 'type', label: 'Type' },
        ]}
      />
      {mode === 'draw' ? (
        <canvas
          ref={ref}
          width={800}
          height={240}
          aria-label="Signature pad"
          className="w-full touch-none rounded-xl border border-line bg-white"
          onPointerDown={(e) => {
            drawing.current = true;
            const c = ref.current?.getContext('2d');
            if (!c) return;
            const [x, y] = pos(e);
            c.lineWidth = 4;
            c.lineCap = 'round';
            c.strokeStyle = '#111827';
            c.beginPath();
            c.moveTo(x, y);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const c = ref.current?.getContext('2d');
            if (!c) return;
            const [x, y] = pos(e);
            c.lineTo(x, y);
            c.stroke();
          }}
          onPointerUp={() => {
            drawing.current = false;
          }}
          onPointerLeave={() => {
            drawing.current = false;
          }}
        />
      ) : (
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your name" aria-label="Typed signature" className="h-12 text-lg" />
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            const c = ref.current?.getContext('2d');
            if (c && ref.current) c.clearRect(0, 0, ref.current.width, ref.current.height);
            setTyped('');
          }}
        >
          Clear
        </Button>
        <Button variant="primary" onClick={save} disabled={mode === 'type' && !typed.trim()}>
          Use signature
        </Button>
      </div>
    </div>
  );
}

export default function Annotate() {
  const [file, setFile] = useState<{ name: string; size: number; bytes: Uint8Array; doc: PdfDoc } | null>(null);
  const [page, setPage] = useState(0);
  const [ratio, setRatio] = useState(1.4);
  const [tool, setTool] = useState<Tool>('highlight');
  const [color, setColor] = useState(COLORS[0]);
  const [noteText, setNoteText] = useState('Note');
  const [hist, setHist] = useState<{ past: Annot[][]; present: Annot[]; future: Annot[][] }>({ past: [], present: [], future: [] });
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number; points: number[] } | null>(null);
  const [sig, setSig] = useState<{ bytes: Uint8Array; url: string } | null>(null);
  const [sigOpen, setSigOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [patterns, setPatterns] = useState<string[]>(['email', 'phone']);
  const [customRe, setCustomRe] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [width, setWidth] = useState(780);
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const annots = hist.present;
  const pageAnnots = annots.filter((a) => a.page === page);

  const commit = useCallback((next: Annot[]): void => {
    setHist((h) => ({ past: [...h.past.slice(-99), h.present], present: next, future: [] }));
  }, []);

  const undo = useCallback((): void => {
    setHist((h) => (h.past.length === 0 ? h : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }));
  }, []);
  const redo = useCallback((): void => {
    setHist((h) => (h.future.length === 0 ? h : { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }));
  }, []);

  useEffect(() => {
    const onUndo = (): void => undo();
    const onRedo = (): void => redo();
    window.addEventListener('pdfcut:undo', onUndo);
    window.addEventListener('pdfcut:redo', onRedo);
    return () => {
      window.removeEventListener('pdfcut:undo', onUndo);
      window.removeEventListener('pdfcut:redo', onRedo);
    };
  }, [undo, redo]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.min(860, e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!file) return;
    let alive = true;
    void file.doc.getPage(page + 1).then((p) => {
      const v = p.getViewport({ scale: 1 });
      if (alive) setRatio(v.height / v.width);
      p.cleanup();
    });
    return () => {
      alive = false;
    };
  }, [file, page]);

  const load = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (!f) return;
    try {
      const { bytes, doc } = await loadPdfFile(f);
      setFile({ name: f.name, size: f.size, bytes, doc });
      setHist({ past: [], present: [], future: [] });
      setPage(0);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not open this PDF', message: errMessage(e) });
    }
  };

  const toNorm = (e: ReactPointerEvent): [number, number] => {
    const r = overlayRef.current?.getBoundingClientRect();
    if (!r) return [0, 0];
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const [x, y] = toNorm(e);
    if (tool === 'sign') {
      if (!sig) {
        setSigOpen(true);
        return;
      }
      commit([...annots, { id: uid(), page, type: 'image', x, y, w: 0.24, h: 0.08, color, sig }]);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft({ x0: x, y0: y, x1: x, y1: y, points: [x, y] });
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!draft) return;
    const [x, y] = toNorm(e);
    setDraft({ ...draft, x1: x, y1: y, points: tool === 'ink' ? [...draft.points, x, y] : draft.points });
  };

  const onUp = (): void => {
    if (!draft) return;
    setDraft(null);
    const x = Math.min(draft.x0, draft.x1);
    const y = Math.min(draft.y0, draft.y1);
    const w = Math.abs(draft.x1 - draft.x0);
    const h = Math.abs(draft.y1 - draft.y0);
    if (tool === 'ink') {
      if (draft.points.length < 4) return;
      const xs = draft.points.filter((_, i) => i % 2 === 0);
      const ys = draft.points.filter((_, i) => i % 2 === 1);
      const bx = Math.min(...xs);
      const by = Math.min(...ys);
      commit([...annots, { id: uid(), page, type: 'ink', x: bx, y: by, w: Math.max(...xs) - bx, h: Math.max(...ys) - by, color, points: draft.points }]);
      return;
    }
    const small = w < 0.01 && h < 0.01;
    if ((tool === 'text' || tool === 'note') && small) {
      commit([...annots, { id: uid(), page, type: tool, x: draft.x0, y: draft.y0, w: tool === 'note' ? 0.14 : 0.24, h: tool === 'note' ? 0.1 : 0.05, color, text: noteText }]);
      return;
    }
    if (small) return;
    commit([...annots, { id: uid(), page, type: tool === 'sign' ? 'image' : (tool as Exclude<Tool, 'sign'>), x, y, w, h, color, text: tool === 'note' || tool === 'text' ? noteText : undefined }]);
  };

  const findAndRedact = async (): Promise<void> => {
    if (!file) return;
    const list = PATTERNS.filter((p) => patterns.includes(p.id)).map((p) => p.re);
    if (customRe.trim()) {
      try {
        list.push(new RegExp(customRe, 'gi'));
      } catch {
        toast({ kind: 'error', title: 'Invalid custom pattern' });
        return;
      }
    }
    if (list.length === 0) return;
    const found: Annot[] = [];
    for (let p = 1; p <= file.doc.numPages; p++) {
      const pg = await file.doc.getPage(p);
      const t = await pageText(pg);
      pg.cleanup();
      for (const b of t.boxes) {
        for (const re of list) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(b.str)) !== null) {
            const len = b.str.length || 1;
            found.push({
              id: uid(),
              page: p - 1,
              type: 'redact',
              text: m[0],
              x: b.x / t.width + (b.w / t.width) * (m.index / len),
              y: (t.height - (b.y + b.h)) / t.height,
              w: (b.w / t.width) * (m[0].length / len),
              h: b.h / t.height,
              color: '#000000',
            });
            if (m[0].length === 0) re.lastIndex++;
          }
        }
      }
    }
    if (found.length === 0) {
      toast({ kind: 'info', title: 'Nothing matched', message: 'No text matched the selected patterns.' });
      return;
    }
    commit([...annots, ...found]);
    toast({ kind: 'success', title: `${found.length} match${found.length === 1 ? '' : 'es'} marked for redaction`, message: 'Apply to remove them permanently.' });
  };

  const apply = (): void => {
    if (!file || annots.length === 0) return;
    const { bytes, name } = file;
    const snapshot = annots;
    const j = enqueue(`Annotate ${name}`, async (job) => {
      const redactions: Record<number, NormBox[]> = {};
      for (const a of snapshot) {
        if (a.type !== 'redact') continue;
        (redactions[a.page] ??= []).push({ x: a.x, y: a.y, w: a.w, h: a.h });
      }
      let base = bytes;
      if (Object.keys(redactions).length > 0) {
        job.report(0.05, 'Burning redactions into the page pixels');
        base = await job.work<Uint8Array>('raster.redact', { bytes, pages: redactions });
      }
      const payload: AnnotIn[] = snapshot
        .filter((a) => a.type !== 'redact')
        .map((a) => ({
          page: a.page,
          type: a.type === 'image' ? 'image' : (a.type as AnnotIn['type']),
          x: a.x,
          y: a.y,
          w: a.w,
          h: a.h,
          color: a.color,
          text: a.text,
          points: a.points,
          stroke: 2,
          image: a.sig ? { bytes: a.sig.bytes, kind: 'png' } : undefined,
        }));
      job.report(0.9, 'Writing annotations');
      const out = await job.work<Uint8Array>('annotate', { bytes: base, annots: payload, overrides: {} });
      const needles = snapshot.filter((a) => a.type === 'redact' && a.text).map((a) => a.text as string);
      return { out, needles, manual: snapshot.filter((a) => a.type === 'redact' && !a.text).length };
    });
    setJobId(j.id);
    j.promise
      .then(async ({ out, needles, manual }) => {
        downloadBlob(out, outName(name, '-annotated'));
        if (needles.length === 0) {
          toast({ kind: 'success', title: 'Saved as a new file', message: outName(name, '-annotated') });
          return;
        }
        const left = (await residualCounts(out, needles, false)).reduce((s, n) => s + n, 0);
        const note = left === 0
          ? `Verified: none of the ${needles.length} redacted string(s) remain in the text layer.${manual ? ' Manual boxes were not text-checked.' : ''}`
          : `Warning: ${left} match(es) still found in the text layer.`;
        toast({ kind: left === 0 ? 'success' : 'error', title: 'Redaction check', message: note, duration: 9000 });
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error && e.name === 'AbortError')) toast({ kind: 'error', title: 'Could not apply annotations', message: errMessage(e) });
      });
  };

  if (!file) {
    return (
      <Page title="Annotate & redact" desc="Highlight, draw, sign, add notes and permanently redact." icon={<PenLine className="h-5 w-5" />}>
        <Dropzone accept="application/pdf,.pdf" title="Drop a PDF to annotate" onFiles={(f) => void load(f)} icon={<PenLine className="h-7 w-7" />} />
      </Page>
    );
  }

  const ink = (a: Annot): ReactNode => {
    if (a.type !== 'ink' || !a.points) return null;
    return (
      <svg key={a.id} className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={a.points.join(' ')} fill="none" stroke={a.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  };

  const drawn = draft && tool !== 'sign' ? { x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1), w: Math.abs(draft.x1 - draft.x0), h: Math.abs(draft.y1 - draft.y0) } : null;
  const pageHeight = width * ratio;

  return (
    <Page
      title="Annotate & redact"
      desc={`${file.name} · page ${page + 1} of ${file.doc.numPages}`}
      icon={<PenLine className="h-5 w-5" />}
      actions={
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" />} onClick={undo} disabled={hist.past.length === 0}>
            Undo
          </Button>
          <Button size="sm" variant="ghost" icon={<Redo2 className="h-4 w-4" />} onClick={redo} disabled={hist.future.length === 0}>
            Redo
          </Button>
          <Button size="sm" variant="primary" onClick={apply} disabled={annots.length === 0}>
            Apply & save
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <div ref={wrapRef} className="min-w-0 space-y-3">
          <Card className="flex flex-wrap items-center gap-2 py-2">
            <Button size="sm" variant="ghost" aria-label="Previous page" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} icon={<ChevronLeft className="h-4 w-4" />} />
            <span className="text-sm tabular-nums">
              {page + 1} / {file.doc.numPages}
            </span>
            <Button size="sm" variant="ghost" aria-label="Next page" onClick={() => setPage((p) => Math.min(file.doc.numPages - 1, p + 1))} disabled={page >= file.doc.numPages - 1} icon={<ChevronRight className="h-4 w-4" />} />
            <span className="mx-2 h-5 w-px bg-line" aria-hidden="true" />
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={cn('h-6 w-6 rounded-full border border-line', color === c && 'ring-2 ring-accent ring-offset-2 ring-offset-surface')}
                style={{ background: c }}
              />
            ))}
          </Card>
          <div className="glass overflow-auto rounded-card p-4">
            <div className="relative mx-auto touch-none select-none" style={{ width, height: pageHeight }}>
              <PdfCanvas doc={file.doc} pageNo={page + 1} width={width} height={pageHeight} />
              {pageAnnots.map((a) =>
                a.type === 'ink' ? (
                  ink(a)
                ) : a.type === 'image' && a.sig ? (
                  <img key={a.id} src={a.sig.url} alt="Signature" className="pointer-events-none absolute" style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` }} />
                ) : (
                  <div
                    key={a.id}
                    className={cn(
                      'pointer-events-none absolute flex items-start overflow-hidden text-xs',
                      a.type === 'highlight' && 'mix-blend-multiply',
                      a.type === 'rect' && 'border-2',
                      a.type === 'redact' && 'border border-dashed border-red-500 bg-black/80',
                      a.type === 'note' && 'rounded-sm bg-yellow-200 p-1 shadow',
                      a.type === 'text' && 'font-semibold',
                    )}
                    style={{
                      left: `${a.x * 100}%`,
                      top: `${a.y * 100}%`,
                      width: `${a.w * 100}%`,
                      height: `${a.h * 100}%`,
                      background: a.type === 'highlight' ? a.color + '66' : undefined,
                      borderColor: a.type === 'rect' ? a.color : undefined,
                      color: a.type === 'text' ? a.color : undefined,
                    }}
                  >
                    {(a.type === 'text' || a.type === 'note') && a.text}
                  </div>
                ),
              )}
              {drawn && (
                <div
                  className="pointer-events-none absolute border-2 border-dashed"
                  style={{ left: `${drawn.x * 100}%`, top: `${drawn.y * 100}%`, width: `${drawn.w * 100}%`, height: `${drawn.h * 100}%`, borderColor: tool === 'redact' ? '#ef4444' : color }}
                />
              )}
              {draft && tool === 'ink' && (
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
                  <polyline points={draft.points.join(' ')} fill="none" stroke={color} strokeWidth={3} vectorEffect="non-scaling-stroke" />
                </svg>
              )}
              <div
                ref={overlayRef}
                className="absolute inset-0 cursor-crosshair"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={() => setDraft(null)}
                role="application"
                aria-label="Annotation canvas"
              />
            </div>
          </div>
          <p className="text-xs text-muted">
            Drag to draw boxes. Click to place a text or note. Redaction burns the boxes into the page pixels. Find-and-redact matches are checked against the text layer after saving; manual boxes are not text-checked.
          </p>
          <InlineJob jobId={jobId} />
        </div>

        <div className="space-y-4">
          <Card className="space-y-3">
            <div className="text-sm font-semibold">Tool</div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['highlight', 'Highlight', Highlighter],
                  ['rect', 'Rectangle', Square],
                  ['ink', 'Draw', Pen],
                  ['text', 'Text', Type],
                  ['note', 'Note', StickyNote],
                  ['redact', 'Redact', EyeOff],
                  ['sign', 'Signature', PenLine],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={tool === id}
                  onClick={() => (id === 'sign' && !sig ? setSigOpen(true) : setTool(id))}
                  className={cn('btn btn-sm justify-start', tool === id ? 'btn-primary' : 'btn-secondary')}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
            {(tool === 'text' || tool === 'note') && (
              <Field label="Text">
                <Input value={noteText} onChange={(e) => setNoteText(e.target.value)} />
              </Field>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSigOpen(true)}>
              {sig ? 'Change signature' : 'Create signature'}
            </Button>
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Find & redact</span>
              <Button size="sm" variant="ghost" onClick={() => setFindOpen((v) => !v)}>
                {findOpen ? 'Hide' : 'Show'}
              </Button>
            </div>
            {findOpen && (
              <div className="space-y-3">
                {PATTERNS.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={patterns.includes(p.id)} onChange={(e) => setPatterns((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))} />
                    {p.label}
                  </label>
                ))}
                <Field label="Custom regular expression" hint="Case-insensitive, e.g. ACME-\d{6}">
                  <Input value={customRe} onChange={(e) => setCustomRe(e.target.value)} />
                </Field>
                <Button size="sm" icon={<Search className="h-4 w-4" />} onClick={() => void findAndRedact()}>
                  Find across all pages
                </Button>
              </div>
            )}
          </Card>

          <Card className="space-y-2">
            <div className="text-sm font-semibold">On this page ({pageAnnots.length})</div>
            {pageAnnots.length === 0 && <p className="text-xs text-muted">Nothing yet on this page.</p>}
            <ul className="max-h-60 space-y-1.5 overflow-auto">
              {pageAnnots.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-lg bg-line/30 px-2 py-1.5 text-xs">
                  <span className="w-16 shrink-0 font-medium capitalize">{a.type === 'image' ? 'signature' : a.type}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{a.text ?? ''}</span>
                  <button type="button" aria-label="Delete annotation" className="btn btn-ghost btn-sm h-6 w-6 p-0" onClick={() => commit(annots.filter((x) => x.id !== a.id))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Modal open={sigOpen} onClose={() => setSigOpen(false)} title="Signature">
        <SignaturePad
          onSave={(bytes, url) => {
            setSig({ bytes, url });
            setSigOpen(false);
            setTool('sign');
          }}
        />
      </Modal>
    </Page>
  );
}
