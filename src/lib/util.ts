// Shared helpers: page-range parsing, locale-aware formatting, LRU cache,
// logging, IndexedDB key/value storage and file downloads.

export type LogLevel = 'info' | 'warn' | 'error';
export interface LogEntry {
  t: number;
  level: LogLevel;
  msg: string;
}

let locale = 'en';
export function setLocale(code: string): void {
  locale = code;
}
export function currentLocale(): string {
  return locale;
}

export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Unexpected error';
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function whenIdle(fn: () => void): void {
  if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 200);
}

export function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(i);
  return out;
}

/** "1-3,5,8-10" -> one group per comma part, 0-based indices. */
export function parseRangeParts(spec: string, total: number): number[][] {
  const parts = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error('Enter at least one page or range, e.g. 1-3,5');
  return parts.map((part) => {
    const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part);
    if (!m) throw new Error(`Invalid range "${part}". Use numbers and dashes, e.g. 1-3,5`);
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : a;
    if (a < 1 || b < 1 || a > total || b > total) {
      throw new Error(`Range "${part}" is outside 1–${total}`);
    }
    const out: number[] = [];
    const step = a <= b ? 1 : -1;
    for (let i = a; step > 0 ? i <= b : i >= b; i += step) out.push(i - 1);
    return out;
  });
}

/** Flattened, de-duplicated, order-preserving list of 0-based page indices. */
export function parseRanges(spec: string, total: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const group of parseRangeParts(spec, total)) {
    for (const i of group) {
      if (!seen.has(i)) {
        seen.add(i);
        out.push(i);
      }
    }
  }
  return out;
}

export function formatNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: i === 0 ? 0 : 1 }).format(v)} ${units[i]}`;
}

export function formatDate(ts: number): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ts);
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatPercent(v: number): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(v);
}

/** Small LRU cache used for thumbnails and rendered pages. */
export class LRU<K, V> {
  private map = new Map<K, V>();
  constructor(private max: number) {}
  /** Changes the capacity (used on low-memory machines) and evicts the oldest entries immediately. */
  setMax(n: number): void {
    this.max = Math.max(1, n);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }
  has(key: K): boolean {
    return this.map.has(key);
  }
  delete(key: K): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}

const LOGS: LogEntry[] = [];
export function log(level: LogLevel, msg: string): void {
  LOGS.push({ t: Date.now(), level, msg });
  if (LOGS.length > 300) LOGS.splice(0, LOGS.length - 300);
  if (level === 'error') console.error(msg);
  else if (level === 'warn') console.warn(msg);
}
export function getLogs(): LogEntry[] {
  return LOGS.slice();
}

export function isLowEndDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = navigator.hardwareConcurrency || 8;
  const mem = nav.deviceMemory ?? 8;
  return cores <= 4 || mem <= 4;
}

export function heapInfo(): { used: number; limit: number } | null {
  const p = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };
  return p.memory ? { used: p.memory.usedJSHeapSize, limit: p.memory.jsHeapSizeLimit } : null;
}

export function blobOf(data: Blob | Uint8Array | string, type = 'application/octet-stream'): Blob {
  if (data instanceof Blob) return data;
  if (typeof data === 'string') return new Blob([data], { type });
  return new Blob([data as unknown as BlobPart], { type });
}

export function downloadBlob(data: Blob | Uint8Array | string, name: string, type?: string): void {
  const url = URL.createObjectURL(blobOf(data, type));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---- IndexedDB key/value store (recent files, autosave, backups) ----
let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('pdfcut', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function kvTx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction('kv', mode);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function kvGet<T>(key: string): Promise<T | undefined> {
  return kvTx<T | undefined>('readonly', (s) => s.get(key));
}
export function kvSet(key: string, value: unknown): Promise<IDBValidKey> {
  return kvTx<IDBValidKey>('readwrite', (s) => s.put(value, key));
}
export function kvDel(key: string): Promise<undefined> {
  return kvTx<undefined>('readwrite', (s) => s.delete(key));
}
