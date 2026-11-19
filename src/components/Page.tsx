// Shared building blocks for tool screens: page header, inline job progress, a virtualized
// thumbnail grid, file loading with the memory guard, zip export and printing.
import JSZip from 'jszip';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FixedSizeGrid, type GridChildComponentProps } from 'react-window';
import { openPdf, type PdfDoc } from '../lib/pdfjs';
import { blobOf, formatBytes, stripExt } from '../lib/util';
import { cancelJob, pauseJob, resumeJob, useJobs } from '../store/jobs';
import { useSettings } from '../store/settings';
import { Button, ProgressBar } from './ui';

export function Page({
  title,
  desc,
  icon,
  actions,
  children,
}: {
  title: string;
  desc?: string;
  icon: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-6 pb-3 pt-5">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">{icon}</div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {desc && <p className="truncate text-sm text-muted">{desc}</p>}
        </div>
        {actions}
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-auto px-6 pb-8">{children}</div>
    </div>
  );
}

export function InlineJob({ jobId }: { jobId: string | null }) {
  const job = useJobs((s) => s.jobs.find((j) => j.id === jobId));
  if (!job) return null;
  const active = job.status === 'running' || job.status === 'paused' || job.status === 'queued';
  const note =
    job.status === 'error'
      ? job.error
      : job.status === 'paused'
        ? 'Paused'
        : job.status === 'queued'
          ? 'Waiting in the background queue…'
          : job.message;
  return (
    <div className="glass space-y-2 rounded-card p-4" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate font-medium">{job.title}</span>
        <span className="shrink-0 tabular-nums text-muted">{Math.round(job.progress * 100)}%</span>
      </div>
      <ProgressBar value={job.progress} indeterminate={job.status === 'queued'} />
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span className="truncate">{note}</span>
        {active && (
          <span className="flex shrink-0 gap-1">
            {job.status === 'paused' ? (
              <Button size="sm" variant="ghost" onClick={() => resumeJob(job.id)}>
                Resume
              </Button>
            ) : (
              job.status === 'running' && (
                <Button size="sm" variant="ghost" onClick={() => pauseJob(job.id)}>
                  Pause
                </Button>
              )
            )}
            <Button size="sm" variant="ghost" onClick={() => cancelJob(job.id)}>
              Cancel
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}

/** Rejects files above the memory limit with a friendly explanation. */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  const limit = useSettings.getState().memoryLimitMB * 1024 * 1024;
  if (file.size > limit) {
    throw new Error(
      `${file.name} is ${formatBytes(file.size)}, above your ${formatBytes(limit)} memory limit. Raise the limit in Settings to continue.`,
    );
  }
  return new Uint8Array(await file.arrayBuffer());
}

export async function loadPdfFile(file: File): Promise<{ bytes: Uint8Array; doc: PdfDoc }> {
  const bytes = await readFileBytes(file);
  const doc = await openPdf(bytes);
  return { bytes, doc };
}

export function outName(fileName: string, suffix: string, ext = 'pdf'): string {
  return `${stripExt(fileName)}${suffix}.${ext}`;
}

export async function zipFiles(files: Array<{ name: string; data: Uint8Array | string }>): Promise<Blob> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.data);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** Prints a PDF through a hidden iframe so the browser's print dialog handles it. */
export function printPdf(bytes: Uint8Array): void {
  const url = URL.createObjectURL(blobOf(bytes, 'application/pdf'));
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank');
    }
    window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60000);
  };
  document.body.appendChild(frame);
}

interface GridData {
  cols: number;
  count: number;
  renderCell: (index: number) => ReactNode;
}

function GridCell({ columnIndex, rowIndex, style, data }: GridChildComponentProps<GridData>) {
  const i = rowIndex * data.cols + columnIndex;
  if (i >= data.count) return null;
  return <div style={{ ...style, padding: 6 }}>{data.renderCell(i)}</div>;
}

/** Virtualized grid: only the cells in view are mounted, so 5000-page documents stay smooth. */
export function ThumbGrid({
  count,
  cellW,
  cellH,
  renderCell,
  label,
}: {
  count: number;
  cellW: number;
  cellH: number;
  renderCell: (index: number) => ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const gap = 12;
  const cols = Math.max(1, Math.floor((size.w + gap) / (cellW + gap)));
  const rows = Math.ceil(count / cols);
  return (
    <div ref={ref} className="h-full min-h-[240px] w-full" role="grid" aria-label={label}>
      {size.w > 0 && size.h > 0 && (
        <FixedSizeGrid
          columnCount={cols}
          columnWidth={cellW + gap}
          rowCount={rows}
          rowHeight={cellH + gap}
          height={size.h}
          width={size.w}
          itemData={{ cols, count, renderCell }}
        >
          {GridCell}
        </FixedSizeGrid>
      )}
    </div>
  );
}
