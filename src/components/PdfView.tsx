// PDF page views: a page canvas that renders a low-res preview first and then sharpens,
// cancels in-flight renders on unmount, and a shared thumbnail renderer with an LRU cache
// and a concurrency limit so scrolling a 5000-page file never floods the renderer.
import { useEffect, useRef, useState } from 'react';
import { isRenderCancelled, renderPageTo, type PdfDoc, type RenderTask } from '../lib/pdfjs';
import { log } from '../lib/util';
import { thumbCache } from '../lib/caches';
import { cn } from '../utils/cn';
import { Skeleton } from './ui';

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The thumbnail cache lives in lib/caches.ts so desktop start-up can resize it.
let inFlight = 0;
const waiting: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inFlight < 2) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) =>
    waiting.push(() => {
      inFlight++;
      resolve();
    }),
  );
}

function release(): void {
  inFlight--;
  const next = waiting.shift();
  if (next) next();
}

export function clearThumbCache(): void {
  thumbCache.clear();
}

export async function thumbnailUrl(
  doc: PdfDoc,
  docKey: string,
  pageNo: number,
  width: number,
  cancelled: () => boolean,
): Promise<string | null> {
  const key = `${docKey}:${pageNo}:${width}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  await acquire();
  try {
    if (cancelled()) return null;
    const cached = thumbCache.get(key);
    if (cached) return cached;
    const page = await doc.getPage(pageNo);
    const vp1 = page.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    await renderPageTo(page, canvas, width / vp1.width).promise;
    page.cleanup();
    const url = canvas.toDataURL('image/jpeg', 0.8);
    thumbCache.set(key, url);
    return url;
  } catch (e) {
    if (!isRenderCancelled(e)) log('warn', `Thumbnail failed for page ${pageNo}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    release();
  }
}

export function PdfThumb({
  doc,
  docKey,
  pageNo,
  width,
  height,
  rotate = 0,
  className,
}: {
  doc: PdfDoc;
  docKey: string;
  pageNo: number;
  width: number;
  height: number;
  rotate?: number;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void thumbnailUrl(doc, docKey, pageNo, width, () => !alive).then((u) => {
      if (alive && u) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [doc, docKey, pageNo, width]);
  return (
    <div
      role="img"
      aria-label={`Page ${pageNo}`}
      className={cn('relative overflow-hidden rounded-md bg-white', className)}
      style={{ width, height }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          className="h-full w-full object-contain transition-transform duration-200"
          style={{ transform: `rotate(${rotate}deg)` }}
        />
      ) : (
        <Skeleton className="h-full w-full rounded-md" />
      )}
    </div>
  );
}

export function PdfCanvas({
  doc,
  pageNo,
  width,
  height,
  highlights,
}: {
  doc: PdfDoc;
  pageNo: number;
  width: number;
  height: number;
  highlights?: NormRect[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    let task: RenderTask | null = null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const run = async (): Promise<void> => {
      const page = await doc.getPage(pageNo);
      const canvas = ref.current;
      if (!alive || !canvas) return;
      const vp1 = page.getViewport({ scale: 1 });
      const full = (width * dpr) / vp1.width;
      task = renderPageTo(page, canvas, full * 0.3);
      await task.promise;
      if (!alive) return;
      task = renderPageTo(page, canvas, full);
      await task.promise;
      page.cleanup();
    };
    run().catch((e: unknown) => {
      if (!isRenderCancelled(e)) log('warn', `Render failed on page ${pageNo}: ${e instanceof Error ? e.message : String(e)}`);
    });
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [doc, pageNo, width]);
  return (
    <div className="relative bg-white shadow-md" style={{ width, height }}>
      <canvas ref={ref} className="block h-full w-full" aria-label={`Page ${pageNo}`} role="img" />
      {highlights?.map((r, i) => (
        <div
          key={i}
          className="pointer-events-none absolute rounded-sm bg-yellow-300/60 mix-blend-multiply"
          style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
        />
      ))}
    </div>
  );
}
