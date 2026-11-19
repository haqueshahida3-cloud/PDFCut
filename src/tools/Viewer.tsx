// Built-in PDF viewer: tabs, split view, virtualized continuous/single/two-page layouts,
// zoom, thumbnails, outline, full-text search with highlights, dark/sepia reading modes,
// presentation mode, auto-scroll, read-aloud, focus mode and reading-progress memory.
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { FixedSizeList, VariableSizeList, type ListChildComponentProps } from 'react-window';
import {
  BookOpen,
  Columns2,
  Focus,
  Images,
  List,
  Mic,
  MicOff,
  MonitorPlay,
  Pause,
  Play,
  Plus,
  Printer,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button, Dropzone, EmptyState, Segmented, Select, useDebounced } from '../components/ui';
import { PdfCanvas, PdfThumb, type NormRect } from '../components/PdfView';
import { Page, loadPdfFile, printPdf } from '../components/Page';
import { openPdf, pageText, readOutline, type OutlineItem, type PdfDoc } from '../lib/pdfjs';
import { errMessage, uid, whenIdle } from '../lib/util';
import { addRecent, loadRecentBytes, setOpenTabs, setReadingPage, takePending, toast, useApp } from '../store/app';
import { cn } from '../utils/cn';

interface Tab {
  recentId?: string;
  id: string;
  name: string;
  size: number;
  bytes: Uint8Array;
  doc: PdfDoc;
}

export default function Viewer() {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [splitId, setSplitId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useApp((s) => s.pending);
  const pendingTool = useApp((s) => s.pendingTool);
  const tabsRef = useRef<Tab[]>([]);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const openFiles = useCallback(async (files: File[]) => {
    setLoading(true);
    for (const file of files) {
      try {
        const { bytes, doc } = await loadPdfFile(file);
        const id = uid();
        const recentId = await addRecent(file.name, file.size, doc.numPages, bytes);
        setTabs((ts) => [...ts, { id, name: file.name, size: file.size, bytes, doc, recentId }]);
        setActiveId(id);
      } catch (e) {
        toast({ kind: 'error', title: `Could not open ${file.name}`, message: errMessage(e) });
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (pending.length > 0 && pendingTool === 'viewer') void openFiles(takePending('viewer'));
  }, [pending, pendingTool, openFiles]);

  // Workspace restore: reopen the tabs that were open last time (bytes come from IndexedDB, when stored).
  const hydrated = useRef(false);
  useEffect(() => {
    let alive = true;
    const saved = useApp.getState().openTabs;
    if (useApp.getState().pending.length > 0 || saved.length === 0) {
      hydrated.current = true;
      return;
    }
    void (async () => {
      const restored: Tab[] = [];
      for (const s of saved) {
        const bytes = await loadRecentBytes(s.recentId);
        if (!bytes) continue;
        try {
          const doc = await openPdf(bytes);
          restored.push({ id: uid(), name: s.name, size: s.size, bytes, doc, recentId: s.recentId });
        } catch {
          // An unreadable file is skipped; the rest of the workspace still restores.
        }
      }
      if (!alive) {
        restored.forEach((t) => void t.doc.destroy().catch(() => undefined));
        return;
      }
      if (restored.length > 0) {
        setTabs(restored);
        setActiveId(restored[0].id);
      }
      hydrated.current = true;
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    setOpenTabs(tabs.filter((t) => t.recentId).map((t) => ({ recentId: t.recentId as string, name: t.name, size: t.size })));
  }, [tabs]);

  useEffect(() => {
    const onOpen = (): void => fileRef.current?.click();
    window.addEventListener('pdfcut:open-file', onOpen);
    return () => window.removeEventListener('pdfcut:open-file', onOpen);
  }, []);

  useEffect(
    () => () => {
      tabsRef.current.forEach((tab) => void tab.doc.destroy().catch(() => undefined));
    },
    [],
  );

  const active = tabs.find((x) => x.id === activeId) ?? null;
  const second = tabs.find((x) => x.id === splitId) ?? null;

  useEffect(() => {
    const onPrint = (): void => {
      if (active) printPdf(active.bytes);
    };
    window.addEventListener('pdfcut:print', onPrint);
    return () => window.removeEventListener('pdfcut:print', onPrint);
  }, [active]);

  const closeTab = (id: string): void => {
    const tab = tabs.find((x) => x.id === id);
    void tab?.doc.destroy().catch(() => undefined);
    const rest = tabs.filter((x) => x.id !== id);
    setTabs(rest);
    if (activeId === id) setActiveId(rest.length > 0 ? rest[rest.length - 1].id : null);
    if (splitId === id) setSplitId(null);
  };

  if (tabs.length === 0) {
    return (
      <Page title={t('nav.viewer')} desc={t('desc.viewer')} icon={<BookOpen className="h-5 w-5" />}>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void openFiles(files);
          }}
        />
        {loading ? (
          <div className="skeleton h-64 rounded-card" aria-busy="true" />
        ) : (
          <Dropzone
            multiple
            accept="application/pdf,.pdf"
            title={t('common.drop_hint')}
            hint="Everything stays on this computer."
            onFiles={(files) => void openFiles(files)}
            icon={<BookOpen className="h-7 w-7" />}
          />
        )}
        <EmptyState icon={<BookOpen className="h-6 w-6" />} title="Tip" text="Press Ctrl+O to open a PDF, or drop one anywhere in the window." />
      </Page>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void openFiles(files);
        }}
      />
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2 py-1.5" role="tablist">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            className={cn(
              'flex max-w-[220px] shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm',
              tab.id === activeId ? 'bg-surface shadow-sm' : 'hover:bg-line/50',
            )}
          >
            <button type="button" className="truncate text-start" onClick={() => setActiveId(tab.id)}>
              {tab.name}
            </button>
            <button type="button" aria-label={`Close ${tab.name}`} onClick={() => closeTab(tab.id)} className="opacity-60 hover:opacity-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
          Open
        </Button>
        <Button
          size="sm"
          variant={second ? 'primary' : 'ghost'}
          icon={<Columns2 className="h-4 w-4" />}
          onClick={() => {
            if (second) setSplitId(null);
            else {
              const other = tabs.find((x) => x.id !== activeId);
              setSplitId(other ? other.id : activeId);
            }
          }}
        >
          Split view
        </Button>
        {loading && <span className="ms-2 text-xs text-muted">Opening…</span>}
      </div>
      <div className="flex min-h-0 flex-1">
        {active && (
          <div className={cn('min-w-0', second ? 'w-1/2 border-e border-line' : 'flex-1')}>
            <ViewPane key={active.id} tab={active} />
          </div>
        )}
        {second && (
          <div className="min-w-0 w-1/2">
            <ViewPane key={`split-${second.id}`} tab={second} />
          </div>
        )}
      </div>
    </div>
  );
}

type ViewMode = 'continuous' | 'single' | 'two';
type Side = 'thumbs' | 'outline' | 'search' | null;
type Reading = 'normal' | 'dark' | 'sepia';
const GAP = 16;

interface RowData {
  doc: PdfDoc;
  mode: ViewMode;
  n: number;
  sizes: Array<[number, number]>;
  baseW: number;
  factor: number;
  hits: Record<number, NormRect[]>;
}

function Row({ index, style, data }: ListChildComponentProps<RowData>) {
  const { doc, mode, n, sizes, baseW, factor, hits } = data;
  const pages = mode === 'two' ? [index * 2, index * 2 + 1].filter((p) => p < n) : [index];
  return (
    <div style={style}>
      <div className="flex justify-center gap-4 px-6 pt-2">
        {pages.map((p) => {
          const [w, h] = sizes[p] ?? [612, 792];
          const pw = baseW * factor;
          return <PdfCanvas key={p} doc={doc} pageNo={p + 1} width={pw} height={(pw * h) / w} highlights={hits[p + 1]} />;
        })}
      </div>
    </div>
  );
}

interface ThumbData {
  doc: PdfDoc;
  docKey: string;
  current: number;
  goTo: (p: number) => void;
}

function ThumbRow({ index, style, data }: ListChildComponentProps<ThumbData>) {
  const p = index + 1;
  return (
    <button
      type="button"
      style={style}
      onClick={() => data.goTo(p)}
      aria-current={data.current === p ? 'page' : undefined}
      className={cn('flex flex-col items-center gap-1 rounded-lg p-2', data.current === p ? 'bg-accent-soft' : 'hover:bg-line/50')}
    >
      <PdfThumb doc={data.doc} docKey={data.docKey} pageNo={p} width={120} height={170} />
      <span className="text-xs tabular-nums text-muted">{p}</span>
    </button>
  );
}

function ViewPane({ tab }: { tab: Tab }) {
  const { t } = useTranslation();
  const doc = tab.doc;
  const n = doc.numPages;
  const key = `${tab.name}:${tab.size}`;
  const docKey = `${tab.name}-${tab.size}-${tab.id}`;
  const [mode, setMode] = useState<ViewMode>('continuous');
  const [zoomSel, setZoomSel] = useState<string>('100');
  const [reading, setReading] = useState<Reading>('normal');
  const [side, setSide] = useState<Side>('thumbs');
  const [focus, setFocus] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [autoScroll, setAutoScroll] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [current, setCurrent] = useState(1);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [sizeTick, setSizeTick] = useState(0);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [query, setQuery] = useState('');
  const dq = useDebounced(query, 350);
  const [hits, setHits] = useState<Record<number, NormRect[]>>({});
  const [results, setResults] = useState<Array<{ page: number; snippet: string }>>([]);
  const [searchProgress, setSearchProgress] = useState<number | null>(null);
  const sizesRef = useRef<Array<[number, number]>>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<VariableSizeList>(null);
  const offsetRef = useRef(0);
  const restoredRef = useRef(false);

  // Page sizes load progressively in idle slices; the list re-measures as they arrive.
  useEffect(() => {
    let alive = true;
    const arr = new Array<[number, number]>(n);
    sizesRef.current = arr;
    (async () => {
      const first = await doc.getPage(1);
      const v = first.getViewport({ scale: 1 });
      arr.fill([v.width, v.height]);
      setSizeTick((x) => x + 1);
      for (let start = 2; start <= n && alive; start += 100) {
        const end = Math.min(n, start + 99);
        for (let p = start; p <= end && alive; p++) {
          const pg = await doc.getPage(p);
          const vv = pg.getViewport({ scale: 1 });
          arr[p - 1] = [vv.width, vv.height];
          pg.cleanup();
        }
        setSizeTick((x) => x + 1);
        await new Promise<void>((r) => whenIdle(() => r()));
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [doc, n]);

  useEffect(() => {
    let alive = true;
    void readOutline(doc).then((items) => {
      if (alive) setOutline(items);
    });
    return () => {
      alive = false;
    };
  }, [doc]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setBox({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sizes = sizesRef.current;
  const pad = box.w < 500 ? 8 : 24;
  const baseW = Math.max(100, mode === 'two' ? (box.w - pad * 2 - GAP) / 2 : box.w - pad * 2);
  const ratio = (p: number): number => {
    const s = sizes[p] ?? [612, 792];
    return s[1] / s[0];
  };
  const fitPage = Math.max(0.1, (box.h - pad * 2) / (baseW * ratio(0)));
  const factor = zoomSel === 'page' ? fitPage : Number(zoomSel) / 100;
  const pageW = baseW * factor;
  const rowCount = mode === 'two' ? Math.ceil(n / 2) : n;
  const rowHeight = (i: number): number => {
    const ids = mode === 'two' ? [i * 2, i * 2 + 1].filter((p) => p < n) : [i];
    const h = Math.max(...ids.map((p) => pageW * ratio(p)));
    return h + GAP;
  };
  const innerW = Math.max(box.w, pageW * (mode === 'two' ? 2 : 1) + pad * 2 + (mode === 'two' ? GAP : 0));
  const Inner = useMemo(
    () =>
      forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Inner(props, ref) {
        return <div ref={ref} {...props} style={{ ...props.style, width: innerW }} />;
      }),
    [innerW],
  );

  useEffect(() => {
    listRef.current?.resetAfterIndex(0, true);
  }, [mode, factor, baseW, sizeTick]);

  const rowOf = (p: number): number => (mode === 'two' ? Math.floor((p - 1) / 2) : p - 1);
  const goTo = useCallback(
    (p: number) => {
      const page = Math.min(n, Math.max(1, Math.round(p) || 1));
      setCurrent(page);
      if (mode !== 'single') listRef.current?.scrollToItem(rowOf(page), 'start');
    },
    // rowOf depends on mode only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, mode],
  );

  // Restore reading progress once the viewport is measured.
  useEffect(() => {
    if (restoredRef.current || box.h === 0) return;
    restoredRef.current = true;
    const saved = useApp.getState().progress[key];
    if (saved && saved > 1) window.setTimeout(() => goTo(saved), 60);
  }, [box.h, goTo, key]);

  useEffect(() => {
    if (current > 0) setReadingPage(key, current);
  }, [current, key]);

  // Auto-scroll, driven by the list's own scroll offset (no DOM reads).
  useEffect(() => {
    if (!autoScroll || mode === 'single') return;
    const id = window.setInterval(() => listRef.current?.scrollTo(offsetRef.current + 1.5), 16);
    return () => window.clearInterval(id);
  }, [autoScroll, mode]);

  // Full-text search across all pages, chunked so the UI stays responsive.
  useEffect(() => {
    const q = dq.trim();
    setHits({});
    setResults([]);
    setSearchProgress(null);
    if (q.length < 2) return;
    let cancelled = false;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    (async () => {
      const map: Record<number, NormRect[]> = {};
      const found: Array<{ page: number; snippet: string }> = [];
      for (let p = 1; p <= n; p++) {
        if (cancelled) return;
        const page = await doc.getPage(p);
        const text = await pageText(page);
        page.cleanup();
        const rects: NormRect[] = [];
        let snippet = '';
        for (const b of text.boxes) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(b.str)) !== null) {
            const len = b.str.length || 1;
            rects.push({
              x: b.x / text.width + (b.w / text.width) * (m.index / len),
              y: (text.height - (b.y + b.h)) / text.height,
              w: (b.w / text.width) * (m[0].length / len),
              h: b.h / text.height,
            });
            if (!snippet) snippet = b.str.slice(Math.max(0, m.index - 30), m.index + m[0].length + 40);
            if (m[0].length === 0) re.lastIndex++;
          }
        }
        if (rects.length > 0) {
          map[p] = rects;
          found.push({ page: p, snippet });
        }
        if (p % 20 === 0 || p === n) {
          if (cancelled) return;
          setHits({ ...map });
          setResults([...found]);
          setSearchProgress(p / n);
          await new Promise<void>((r) => window.setTimeout(r, 0));
        }
      }
      if (!cancelled) setSearchProgress(null);
    })().catch(() => {
      if (!cancelled) setSearchProgress(null);
    });
    return () => {
      cancelled = true;
    };
  }, [dq, doc, n]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        setCurrent((c) => Math.min(n, c + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setCurrent((c) => Math.max(1, c - 1));
      } else if (e.key === 'Escape') {
        setPresenting(false);
      }
    };
    window.addEventListener('keydown', onKey);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, [presenting, n]);

  const speak = async (): Promise<void> => {
    if (!('speechSynthesis' in window)) {
      toast({ kind: 'error', title: 'Read-aloud is not supported in this browser' });
      return;
    }
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const page = await doc.getPage(current);
    const text = (await pageText(page)).text.slice(0, 6000);
    page.cleanup();
    if (!text.trim()) {
      toast({ kind: 'info', title: 'No selectable text on this page' });
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  };

  const bump = (d: number): void => {
    const base = zoomSel === 'page' ? 100 : Number(zoomSel);
    setZoomSel(String(Math.min(400, Math.max(25, base + d))));
  };

  const pageIcon = (
    <div className="flex items-center gap-1">
      <button type="button" className="btn btn-ghost btn-sm h-8 w-8 p-0" aria-label="Previous page" onClick={() => goTo(current - 1)}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <input
        type="number"
        min={1}
        max={n}
        value={current}
        onChange={(e) => goTo(Number(e.target.value))}
        aria-label="Current page"
        className="input h-8 w-16 text-center tabular-nums"
      />
      <span className="text-sm tabular-nums text-muted">/ {n}</span>
      <button type="button" className="btn btn-ghost btn-sm h-8 w-8 p-0" aria-label="Next page" onClick={() => goTo(current + 1)}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  const [sw, sh] = sizes[current - 1] ?? [612, 792];
  const singleW = Math.max(100, Math.min(pageW, (box.h - pad * 2) * (sw / sh)));
  const pw = Math.min(window.innerWidth, window.innerHeight * (sw / sh));

  return (
    <div
      tabIndex={0}
      className="flex h-full min-w-0 flex-col outline-none"
      onKeyDown={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        if (e.key === 'ArrowRight' || e.key === 'PageDown') {
          e.preventDefault();
          goTo(current + 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          e.preventDefault();
          goTo(current - 1);
        } else if (e.key === 'Home') goTo(1);
        else if (e.key === 'End') goTo(n);
        else if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
          e.preventDefault();
          bump(25);
        } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
          e.preventDefault();
          bump(-25);
        } else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'f') setFocus((v) => !v);
        else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'p') setPresenting(true);
      }}
      aria-label={tab.name}
    >
      {!focus && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <Segmented
            id={`side-${docKey}`}
            label="Side panel"
            value={side ?? 'none'}
            onChange={(v) => setSide(v === 'none' ? null : (v as Side))}
            options={[
              { value: 'thumbs', label: <Images className="h-4 w-4" aria-label="Thumbnails" /> },
              { value: 'outline', label: <List className="h-4 w-4" aria-label="Bookmarks" /> },
              { value: 'search', label: <Search className="h-4 w-4" aria-label="Search" /> },
            ]}
          />
          {pageIcon}
          <Select value={zoomSel} onChange={(e) => setZoomSel(e.target.value)} aria-label="Zoom" className="h-8 w-28">
            <option value="page">Fit page</option>
            {[50, 75, 100, 125, 150, 200, 300].map((z) => (
              <option key={z} value={z}>
                {z}%
              </option>
            ))}
          </Select>
          <Segmented
            id={`mode-${docKey}`}
            label="View mode"
            value={mode}
            onChange={(v) => setMode(v)}
            options={[
              { value: 'continuous', label: 'Scroll' },
              { value: 'single', label: 'Single' },
              { value: 'two', label: 'Two-page' },
            ]}
          />
          <Select value={reading} onChange={(e) => setReading(e.target.value as Reading)} aria-label="Reading mode" className="h-8 w-28">
            <option value="normal">Normal</option>
            <option value="dark">Dark</option>
            <option value="sepia">Sepia</option>
          </Select>
          <div className="ms-auto flex items-center gap-1">
            <button
              type="button"
              className="btn btn-ghost btn-sm h-8 w-8 p-0"
              aria-pressed={autoScroll}
              aria-label={autoScroll ? 'Stop auto-scroll' : 'Start auto-scroll'}
              onClick={() => setAutoScroll((v) => !v)}
            >
              {autoScroll ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm h-8 w-8 p-0"
              aria-pressed={speaking}
              aria-label={speaking ? 'Stop reading aloud' : 'Read page aloud'}
              onClick={() => void speak()}
            >
              {speaking ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button type="button" className="btn btn-ghost btn-sm h-8 w-8 p-0" aria-label="Presentation mode" onClick={() => setPresenting(true)}>
              <MonitorPlay className="h-4 w-4" />
            </button>
            <button type="button" className="btn btn-ghost btn-sm h-8 w-8 p-0" aria-label="Focus mode" onClick={() => setFocus(true)}>
              <Focus className="h-4 w-4" />
            </button>
            <button type="button" className="btn btn-ghost btn-sm h-8 w-8 p-0" aria-label={t('common.save')} onClick={() => printPdf(tab.bytes)}>
              <Printer className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {focus && (
        <button type="button" className="btn btn-secondary btn-sm absolute end-3 top-14 z-10" onClick={() => setFocus(false)}>
          Exit focus
        </button>
      )}

      <div className="flex min-h-0 flex-1">
        {!focus && side && (
          <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-e border-line">
            {side === 'thumbs' && (
              <FixedSizeList height={Math.max(0, box.h)} width={224} itemCount={n} itemSize={200} itemData={{ doc, docKey, current, goTo }}>
                {ThumbRow}
              </FixedSizeList>
            )}
            {side === 'outline' && (
              <ul className="space-y-0.5 overflow-auto p-2">
                {outline.length === 0 && <li className="p-3 text-sm text-muted">No bookmarks in this file.</li>}
                {outline.map((o, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => goTo(o.page + 1)}
                      style={{ paddingInlineStart: `${0.5 + o.depth * 0.9}rem` }}
                      className="w-full truncate rounded-lg py-1.5 pe-2 text-start text-sm hover:bg-line/50"
                    >
                      {o.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {side === 'search' && (
              <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
                <Input2 value={query} onChange={setQuery} placeholder={t('common.search')} />
                {searchProgress !== null && <div className="text-xs text-muted">Searching… {Math.round(searchProgress * 100)}%</div>}
                <div className="text-xs text-muted">
                  {results.length} page{results.length === 1 ? '' : 's'} with matches
                </div>
                <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
                  {results.slice(0, 500).map((r) => (
                    <li key={r.page}>
                      <button type="button" onClick={() => goTo(r.page)} className="w-full rounded-lg p-2 text-start text-xs hover:bg-line/50">
                        <span className="block font-semibold">Page {r.page}</span>
                        <span className="block truncate text-muted">{r.snippet}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        )}

        <div ref={bodyRef} className={cn('relative min-h-0 min-w-0 flex-1', reading === 'dark' && 'reading-dark', reading === 'sepia' && 'reading-sepia')}>
          {box.w > 0 && mode !== 'single' && (
            <VariableSizeList
              ref={listRef}
              height={box.h}
              width={box.w}
              itemCount={rowCount}
              itemSize={rowHeight}
              overscanCount={2}
              innerElementType={Inner}
              itemData={{ doc, mode, n, sizes, baseW, factor, hits }}
              onItemsRendered={({ visibleStartIndex }) => setCurrent(mode === 'two' ? visibleStartIndex * 2 + 1 : visibleStartIndex + 1)}
              onScroll={({ scrollOffset }) => {
                offsetRef.current = scrollOffset;
              }}
            >
              {Row}
            </VariableSizeList>
          )}
          {box.w > 0 && mode === 'single' && (
            <div className="flex h-full justify-center overflow-auto p-6">
              <PdfCanvas doc={doc} pageNo={current} width={singleW} height={singleW * (sh / sw)} highlights={hits[current]} />
            </div>
          )}
        </div>
      </div>

      {presenting && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black" onClick={() => setCurrent((c) => (c < n ? c + 1 : c))}>
          <PdfCanvas doc={doc} pageNo={current} width={pw} height={pw * (sh / sw)} />
          <div className="absolute bottom-4 text-sm text-white/70">
            {current} / {n} · ← → to move · Esc to exit
          </div>
        </div>
      )}
    </div>
  );
}

function Input2({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="input w-full"
    />
  );
}
