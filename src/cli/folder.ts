// Folder processing for the command line and scheduled runs (Node.js only, no DOM). Each run finds PDFs
// that are new, skips byte-identical copies, applies one operation, writes results to <folder>/processed/,
// and records failures in <folder>/failed/ with an error note. Files that were already processed are skipped.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyNamingRule } from '../lib/naming';
import { cleanPdf, everyN, loadPdf, rebuildPdf, silentCtx, splitGroups } from '../lib/pdf/ops';
import { stripExt } from '../lib/util';

export type FolderOp = 'rebuild' | 'clean' | 'split';

export interface FolderOptions {
  op: FolderOp;
  every?: number; // pages per part, for op 'split'
  naming: string; // see lib/naming.ts
  skipDuplicates: boolean;
}

export type FolderStatus = 'done' | 'skipped' | 'duplicate' | 'failed';

export interface FolderResult {
  file: string;
  status: FolderStatus;
  outputs: string[];
  error?: string;
}

interface FolderState {
  hashes: Record<string, string>; // sha256 -> file name that was processed
  failed: Record<string, string>; // sha256 -> error, so an unchanged broken file is not retried forever
}

const STATE_FILE = '.pdfcut-state.json';

function loadState(dir: string): FolderState {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, STATE_FILE), 'utf8')) as Partial<FolderState>;
    return { hashes: parsed.hashes ?? {}, failed: parsed.failed ?? {} };
  } catch {
    return { hashes: {}, failed: {} };
  }
}

function saveState(dir: string, state: FolderState): void {
  writeFileSync(join(dir, STATE_FILE), JSON.stringify(state, null, 2));
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function runOp(bytes: Uint8Array, opts: FolderOptions): Promise<Uint8Array[]> {
  if (opts.op === 'split') {
    const total = (await loadPdf(bytes)).getPageCount();
    return splitGroups(bytes, everyN(total, opts.every ?? 10), silentCtx);
  }
  return [opts.op === 'clean' ? await cleanPdf(bytes, silentCtx) : await rebuildPdf(bytes, silentCtx)];
}

/** Processes the PDFs currently in the folder once. Safe to call repeatedly. */
export async function processFolderOnce(dir: string, opts: FolderOptions, now: Date = new Date()): Promise<FolderResult[]> {
  const outDir = join(dir, 'processed');
  const failDir = join(dir, 'failed');
  mkdirSync(outDir, { recursive: true });
  const state = loadState(dir);
  const files = readdirSync(dir)
    .filter((f) => /\.pdf$/i.test(f))
    .sort();
  const results: FolderResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const path = join(dir, file);
    let hash = '';
    try {
      const bytes = new Uint8Array(readFileSync(path));
      hash = sha256(bytes);
      const known = state.hashes[hash];
      if (known === file) {
        results.push({ file, status: 'skipped', outputs: [] });
        continue;
      }
      if (known && opts.skipDuplicates) {
        results.push({ file, status: 'duplicate', outputs: [], error: `same content as ${known}` });
        continue;
      }
      if (state.failed[hash]) {
        results.push({ file, status: 'failed', outputs: [], error: state.failed[hash] });
        continue;
      }
      const parts = await runOp(bytes, opts);
      const outputs: string[] = [];
      parts.forEach((data, k) => {
        const label = parts.length > 1 ? `${stripExt(file)}-part-${String(k + 1).padStart(3, '0')}` : stripExt(file);
        const out = join(outDir, applyNamingRule(opts.naming, { name: label, op: opts.op, index: i + 1, date: now }));
        writeFileSync(out, data);
        outputs.push(out);
      });
      state.hashes[hash] = file;
      results.push({ file, status: 'done', outputs });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      mkdirSync(failDir, { recursive: true });
      writeFileSync(join(failDir, `${file}.error.txt`), `${message}\n`);
      if (hash) state.failed[hash] = message;
      results.push({ file, status: 'failed', outputs: [], error: message });
    }
  }
  saveState(dir, state);
  return results;
}

/** Runs processFolderOnce on an interval (minimum 5 s). Overlapping runs are skipped. Returns a stop function. */
export function startFolderWatch(
  dir: string,
  opts: FolderOptions,
  intervalSeconds: number,
  onResults: (results: FolderResult[]) => void,
): () => void {
  let running = false;
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const results = await processFolderOnce(dir, opts);
      if (!stopped && results.some((r) => r.status !== 'skipped')) onResults(results);
    } catch (e) {
      if (!stopped) {
        onResults([{ file: dir, status: 'failed', outputs: [], error: e instanceof Error ? e.message : String(e) }]);
      }
    } finally {
      running = false;
    }
  };
  void tick();
  const id = setInterval(() => void tick(), Math.max(5, intervalSeconds) * 1000);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}
