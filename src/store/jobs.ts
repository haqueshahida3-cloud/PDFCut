// Background job queue. Every heavy task runs as a job: it executes off the UI thread (ctx.work runs in a
// Web Worker) and reports progress, ETA, pause/resume and cancel. Failed jobs can be retried, and every
// finished job is written to the operation history.
import { create } from 'zustand';
import PdfWorker from '../workers/pdf.worker.ts?worker&inline';
import { errMessage, log, uid } from '../lib/util';
import { recordHistory } from './history';

export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled';

export interface Job {
  id: string;
  title: string;
  status: JobStatus;
  progress: number;
  message: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  eta?: number;
  error?: string;
}

export interface JobCtx {
  report(progress: number, message?: string): void;
  checkpoint(): Promise<void>;
  signal: AbortSignal;
  work<T>(op: string, payload: unknown): Promise<T>;
}

export type Runner<T> = (ctx: JobCtx) => Promise<T>;

interface Internal {
  paused: boolean;
  waiters: Array<() => void>;
  ctl: AbortController;
  workers: Set<Worker>;
  lastReport: number;
  started: number;
  runner: Runner<unknown>;
  run: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

interface JobsState {
  jobs: Job[];
  queuePaused: boolean;
}

export const useJobs = create<JobsState>(() => ({ jobs: [], queuePaused: false }));

const internals = new Map<string, Internal>();
/** Runners of recently failed jobs, kept so the user can retry them in this session. */
const failedRunners = new Map<string, Runner<unknown>>();
const MAX_FAILED = 20;
const queue: string[] = [];
let running: string | null = null;

function patch(id: string, p: Partial<Job>): void {
  useJobs.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) }));
}

function abortError(): Error {
  const e = new Error('Cancelled');
  e.name = 'AbortError';
  return e;
}

function reportJob(id: string, progress: number, message?: string): void {
  const it = internals.get(id);
  if (!it) return;
  const now = performance.now();
  if (progress < 1 && now - it.lastReport < 100) return;
  it.lastReport = now;
  const p = Math.min(1, Math.max(0, progress));
  const elapsed = Date.now() - it.started;
  const eta = p > 0.03 ? (elapsed / p) * (1 - p) : undefined;
  patch(id, { progress: p, message: message ?? '', eta });
}

function callWorker<T>(id: string, op: string, payload: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const it = internals.get(id);
    if (!it || it.ctl.signal.aborted) {
      reject(abortError());
      return;
    }
    const worker = new PdfWorker();
    it.workers.add(worker);
    if (it.paused) worker.postMessage({ type: 'pause' });
    const cleanup = (): void => {
      it.workers.delete(worker);
      it.ctl.signal.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = (): void => {
      cleanup();
      reject(abortError());
    };
    it.ctl.signal.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; progress?: number; message?: string; result?: T };
      if (m.type === 'progress') reportJob(id, m.progress ?? 0, m.message);
      else if (m.type === 'done') {
        cleanup();
        resolve(m.result as T);
      } else if (m.type === 'error') {
        cleanup();
        reject(new Error(m.message ?? 'Operation failed'));
      }
    };
    worker.onerror = (ev: ErrorEvent) => {
      cleanup();
      reject(new Error(ev.message || 'Background worker failed (possibly out of memory)'));
    };
    worker.postMessage({ id: 0, op, payload });
  });
}

function makeCtx(id: string): JobCtx {
  const it = internals.get(id);
  if (!it) throw new Error('Job is not active');
  return {
    signal: it.ctl.signal,
    report: (progress, message) => reportJob(id, progress, message),
    checkpoint: () => {
      if (it.ctl.signal.aborted) return Promise.reject(abortError());
      if (!it.paused) return Promise.resolve();
      return new Promise<void>((resolve) => it.waiters.push(resolve));
    },
    work: <T,>(op: string, payload: unknown) => callWorker<T>(id, op, payload),
  };
}

function pump(): void {
  if (running !== null || useJobs.getState().queuePaused) return;
  const id = queue.shift();
  if (id === undefined) return;
  const it = internals.get(id);
  if (!it) {
    pump();
    return;
  }
  running = id;
  it.started = Date.now();
  patch(id, { status: 'running', startedAt: it.started });
  Promise.resolve()
    .then(() => it.run())
    .then(
      (value) => finish(id, 'done', value),
      (err: unknown) => {
        const cancelled = err instanceof Error && err.name === 'AbortError';
        finish(id, cancelled ? 'cancelled' : 'error', undefined, err);
      },
    );
}

function finish(id: string, status: 'done' | 'error' | 'cancelled', value?: unknown, err?: unknown): void {
  const it = internals.get(id);
  internals.delete(id);
  running = null;
  const job = useJobs.getState().jobs.find((j) => j.id === id);
  const finishedAt = Date.now();
  if (status === 'done') {
    patch(id, { status, progress: 1, finishedAt, eta: undefined, message: '' });
    it?.resolve(value);
  } else {
    if (status === 'error') {
      log('error', `Job "${job?.title ?? id}" failed: ${errMessage(err)}`);
      if (it) failedRunners.set(id, it.runner);
      if (failedRunners.size > MAX_FAILED) {
        const oldest = failedRunners.keys().next().value;
        if (oldest !== undefined) failedRunners.delete(oldest);
      }
    }
    patch(id, {
      status,
      finishedAt,
      eta: undefined,
      error: status === 'error' ? errMessage(err) : undefined,
    });
    it?.reject(err ?? abortError());
  }
  recordHistory({
    id,
    title: job?.title ?? id,
    status,
    startedAt: job?.startedAt ?? job?.createdAt ?? finishedAt,
    finishedAt,
    error: status === 'error' ? errMessage(err) : undefined,
  });
  pump();
}

/** Queues a job. The returned promise settles when the job finishes, fails or is cancelled. */
export function enqueue<T>(title: string, runner: Runner<T>): { id: string; promise: Promise<T> } {
  const id = uid();
  const job: Job = { id, title, status: 'queued', progress: 0, message: '', createdAt: Date.now() };
  useJobs.setState((s) => ({ jobs: [job, ...s.jobs].slice(0, 60) }));
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined);
  const erased = runner as Runner<unknown>;
  internals.set(id, {
    paused: false,
    waiters: [],
    ctl: new AbortController(),
    workers: new Set(),
    lastReport: 0,
    started: 0,
    runner: erased,
    run: () => erased(makeCtx(id)),
    resolve: resolve as (v: unknown) => void,
    reject,
  });
  queue.push(id);
  pump();
  return { id, promise };
}

/** Re-queues a failed job with the same runner. Returns the new job id, or null when it cannot be retried. */
export function retryJob(id: string): string | null {
  const job = useJobs.getState().jobs.find((j) => j.id === id);
  const runner = failedRunners.get(id);
  if (!job || !runner) return null;
  failedRunners.delete(id);
  const next = enqueue(job.title, runner);
  return next.id;
}

export function canRetry(id: string): boolean {
  return failedRunners.has(id);
}

export function pauseJob(id: string): void {
  const it = internals.get(id);
  if (!it || it.paused) return;
  it.paused = true;
  it.workers.forEach((w) => w.postMessage({ type: 'pause' }));
  patch(id, { status: 'paused' });
}

export function resumeJob(id: string): void {
  const it = internals.get(id);
  if (!it || !it.paused) return;
  it.paused = false;
  it.workers.forEach((w) => w.postMessage({ type: 'resume' }));
  it.waiters.splice(0).forEach((r) => r());
  patch(id, { status: 'running' });
}

export function cancelJob(id: string): void {
  const it = internals.get(id);
  const qi = queue.indexOf(id);
  if (qi >= 0) {
    queue.splice(qi, 1);
    internals.delete(id);
    it?.reject(abortError());
    patch(id, { status: 'cancelled', finishedAt: Date.now() });
    recordHistory({
      id,
      title: useJobs.getState().jobs.find((j) => j.id === id)?.title ?? id,
      status: 'cancelled',
      startedAt: Date.now(),
      finishedAt: Date.now(),
    });
    return;
  }
  if (!it) return;
  it.ctl.abort();
  it.waiters.splice(0).forEach((r) => r());
}

export function setQueuePaused(paused: boolean): void {
  useJobs.setState({ queuePaused: paused });
  if (!paused) pump();
}

export function clearFinishedJobs(): void {
  useJobs.setState((s) => ({
    jobs: s.jobs.filter((j) => j.status === 'queued' || j.status === 'running' || j.status === 'paused'),
  }));
}
