// Batch & workflows: run one operation (or a saved workflow) over many files with an error report,
// build reusable multi-step workflows, and watch a folder (Chromium's File System Access API).
import { ArrowDown, ArrowUp, FolderOpen, Layers, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Dropzone, Field, Input, Select } from '../components/ui';
import { InlineJob, Page, outName, readFileBytes, zipFiles } from '../components/Page';

import { downloadBlob, errMessage, uid } from '../lib/util';
import { deleteWorkflow, saveWorkflow, toast, useApp, type Workflow, type WorkflowStep } from '../store/app';
import { enqueue, type JobCtx } from '../store/jobs';

const STEP_KINDS: Array<{ kind: WorkflowStep['kind']; label: string }> = [
  { kind: 'lossless', label: 'Lossless rebuild' },
  { kind: 'clean', label: 'Clean metadata (safe share)' },
  { kind: 'rotate', label: 'Rotate pages' },
  { kind: 'watermark', label: 'Text watermark' },
  { kind: 'footer', label: 'Page number footer' },
  { kind: 'compress', label: 'Raster compress' },
];

const PRESETS: Array<{ name: string; steps: WorkflowStep[] }> = [
  { name: 'Archive: compress + clean metadata', steps: [{ kind: 'compress', scale: 1.25, quality: 0.7 }, { kind: 'clean' }] },
  { name: 'Draft: watermark + page numbers', steps: [{ kind: 'watermark', text: 'DRAFT' }, { kind: 'footer', template: 'Page {n} of {total}' }] },
  { name: 'Lossless tidy-up', steps: [{ kind: 'lossless' }] },
];

function defaultStep(kind: WorkflowStep['kind']): WorkflowStep {
  switch (kind) {
    case 'lossless':
      return { kind };
    case 'clean':
      return { kind };
    case 'rotate':
      return { kind, deg: 90 };
    case 'watermark':
      return { kind, text: 'DRAFT' };
    case 'footer':
      return { kind, template: 'Page {n} of {total}' };
    case 'compress':
      return { kind, scale: 1.5, quality: 0.75 };
  }
}

export function stepLabel(s: WorkflowStep): string {
  switch (s.kind) {
    case 'lossless':
      return 'Lossless rebuild';
    case 'clean':
      return 'Clean metadata';
    case 'rotate':
      return `Rotate ${s.deg}°`;
    case 'watermark':
      return `Watermark “${s.text}”`;
    case 'footer':
      return `Footer “${s.template}”`;
    case 'compress':
      return `Compress ${s.scale}× · ${Math.round(s.quality * 100)}%`;
  }
}

/** Runs workflow steps in order. Each step is a worker operation, or raster compression on the main thread. */
export async function runWorkflow(steps: WorkflowStep[], input: Uint8Array, job: JobCtx): Promise<Uint8Array> {
  let bytes = input;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await job.checkpoint();
    job.report(i / steps.length, stepLabel(s));
    switch (s.kind) {
      case 'lossless':
        bytes = await job.work<Uint8Array>('rebuild', { bytes });
        break;
      case 'clean':
        bytes = await job.work<Uint8Array>('clean', { bytes });
        break;
      case 'rotate':
        bytes = await job.work<Uint8Array>('rotate', { bytes, deg: s.deg });
        break;
      case 'watermark':
        bytes = await job.work<Uint8Array>('watermark', {
          bytes,
          opts: { text: s.text, size: 54, opacity: 0.18, angle: 45, color: '#6b7280' },
        });
        break;
      case 'footer':
        bytes = await job.work<Uint8Array>('stamp', {
          bytes,
          opts: { position: 'bottom', left: '', center: s.template, right: '', size: 9, margin: 24, startAt: 1, batesPrefix: '', batesDigits: 0, color: '#374151' },
        });
        break;
      case 'compress':
        bytes = await job.work<Uint8Array>('raster.compress', { bytes, opts: { scale: s.scale, quality: s.quality } });
        break;
    }
  }
  return bytes;
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

function BatchSection({ workflows }: { workflows: Workflow[] }) {
  const [files, setFiles] = useState<File[]>([]);
  const [op, setOp] = useState<string>('lossless');
  const [jobId, setJobId] = useState<string | null>(null);

  const run = (): void => {
    if (files.length === 0) return;
    const list = files;
    let steps: WorkflowStep[];
    if (op.startsWith('wf:')) steps = workflows.find((w) => w.id === op.slice(3))?.steps ?? [];
    else steps = [defaultStep(op as WorkflowStep['kind'])];
    if (steps.length === 0) {
      toast({ kind: 'error', title: 'Choose a workflow with at least one step' });
      return;
    }
    const j = enqueue(`Batch · ${list.length} file${list.length === 1 ? '' : 's'}`, async (job) => {
      const outputs: Array<{ name: string; data: Uint8Array | string }> = [];
      const errors: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        job.report(i / list.length, `${f.name} (${i + 1}/${list.length})`);
        try {
          const out = await runWorkflow(steps, await readFileBytes(f), job);
          outputs.push({ name: outName(f.name, '-batch'), data: out });
        } catch (e) {
          if (isAbort(e)) throw e;
          errors.push(`${f.name}: ${errMessage(e)}`);
        }
      }
      const report = [
        'PDFCut batch report',
        `Files: ${list.length}`,
        `Succeeded: ${outputs.length}`,
        `Failed: ${errors.length}`,
        '',
        ...errors,
      ].join('\n');
      outputs.push({ name: 'report.txt', data: report });
      return { outputs, errors };
    });
    setJobId(j.id);
    j.promise
      .then(async ({ outputs, errors }) => {
        const zip = await zipFiles(outputs);
        downloadBlob(zip, 'batch-output.zip', 'application/zip');
        if (errors.length === 0) toast({ kind: 'success', title: 'Batch finished', message: `${outputs.length - 1} files processed` });
        else toast({ kind: 'error', title: `${errors.length} file(s) failed`, message: 'See report.txt in the ZIP.' });
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) toast({ kind: 'error', title: 'Batch failed', message: errMessage(e) });
      });
  };

  return (
    <Card className="space-y-4">
      <div className="text-lg font-semibold">Batch</div>
      <Dropzone multiple compact accept="application/pdf,.pdf" title="Drop PDFs for batch processing" hint={`${files.length} file(s) selected`} onFiles={(f) => setFiles((prev) => [...prev, ...f])} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Operation">
          <Select value={op} onChange={(e) => setOp(e.target.value)} className="w-72">
            {STEP_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
            {workflows.map((w) => (
              <option key={w.id} value={`wf:${w.id}`}>
                Workflow: {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="ghost" onClick={() => setFiles([])} disabled={files.length === 0}>
          Clear list
        </Button>
        <Button variant="primary" className="ms-auto" onClick={run} disabled={files.length === 0}>
          Run on {files.length} file{files.length === 1 ? '' : 's'}
        </Button>
      </div>
      <p className="text-xs text-muted">Files run one after another in the background queue. Failures are listed in report.txt and do not stop the batch.</p>
      <InlineJob jobId={jobId} />
    </Card>
  );
}

function WorkflowSection({ workflows }: { workflows: Workflow[] }) {
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState('My workflow');
  const [steps, setSteps] = useState<WorkflowStep[]>([{ kind: 'compress', scale: 1.5, quality: 0.75 }]);
  const [addKind, setAddKind] = useState<WorkflowStep['kind']>('lossless');
  const [runFile, setRunFile] = useState<File | null>(null);
  const [runWf, setRunWf] = useState<string>('');
  const [jobId, setJobId] = useState<string | null>(null);

  const edit = (w: Workflow): void => {
    setId(w.id);
    setName(w.name);
    setSteps(w.steps);
  };
  const reset = (): void => {
    setId(null);
    setName('My workflow');
    setSteps([]);
  };
  const updateStep = (i: number, patch: Record<string, unknown>): void =>
    setSteps((prev) => prev.map((s, k) => (k === i ? ({ ...s, ...patch } as WorkflowStep) : s)));
  const move = (i: number, d: number): void =>
    setSteps((prev) => {
      const next = prev.slice();
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = (): void => {
    if (steps.length === 0) {
      toast({ kind: 'error', title: 'Add at least one step' });
      return;
    }
    const wid = id ?? uid();
    saveWorkflow({ id: wid, name: name.trim() || 'Workflow', steps });
    setId(wid);
    toast({ kind: 'success', title: 'Workflow saved', message: name });
  };

  const runOne = (): void => {
    const wf = workflows.find((w) => w.id === runWf);
    if (!runFile || !wf) return;
    const f = runFile;
    const j = enqueue(`Workflow ${wf.name}: ${f.name}`, async (job) => {
      const out = await runWorkflow(wf.steps, await readFileBytes(f), job);
      return out;
    });
    setJobId(j.id);
    j.promise
      .then((out) => {
        downloadBlob(out, outName(f.name, `-${wf.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`));
        toast({ kind: 'success', title: 'Workflow finished' });
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) toast({ kind: 'error', title: 'Workflow failed', message: errMessage(e) });
      });
  };

  return (
    <Card className="space-y-5">
      <div className="text-lg font-semibold">Workflows</div>
      <p className="text-sm text-muted">Chain steps into a preset. Save it, run it with one click here, or pick it in Batch.</p>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button key={p.name} size="sm" variant="secondary" onClick={() => {
            setId(null);
            setName(p.name);
            setSteps(p.steps);
          }}>
            <Plus className="h-4 w-4" /> {p.name}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <Field label="Workflow name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={reset}>
            New
          </Button>
          <Button variant="primary" onClick={save}>
            {id ? 'Update' : 'Save'} workflow
          </Button>
        </div>
      </div>

      <ol className="space-y-2" aria-label="Workflow steps">
        {steps.length === 0 && <li className="text-sm text-muted">No steps yet. Add one below.</li>}
        {steps.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-line/30 px-3 py-2">
            <span className="w-6 text-center text-sm tabular-nums text-muted">{i + 1}</span>
            <span className="min-w-[12rem] flex-1 text-sm font-medium">{STEP_KINDS.find((k) => k.kind === s.kind)?.label}</span>
            {s.kind === 'rotate' && (
              <Select value={s.deg} onChange={(e) => updateStep(i, { deg: Number(e.target.value) })} className="w-28" aria-label="Rotation">
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </Select>
            )}
            {s.kind === 'watermark' && <Input value={s.text} onChange={(e) => updateStep(i, { text: e.target.value })} aria-label="Watermark text" className="w-44" />}
            {s.kind === 'footer' && <Input value={s.template} onChange={(e) => updateStep(i, { template: e.target.value })} aria-label="Footer template" className="w-56" />}
            {s.kind === 'compress' && (
              <>
                <Input type="number" step={0.25} min={0.5} max={3} value={s.scale} onChange={(e) => updateStep(i, { scale: Number(e.target.value) || 1 })} aria-label="Render scale" className="w-24" />
                <Input type="number" step={0.05} min={0.1} max={1} value={s.quality} onChange={(e) => updateStep(i, { quality: Number(e.target.value) || 0.5 })} aria-label="JPEG quality" className="w-24" />
              </>
            )}
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" aria-label="Move step up" onClick={() => move(i, -1)} disabled={i === 0}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" aria-label="Move step down" onClick={() => move(i, 1)} disabled={i === steps.length - 1}>
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" aria-label="Remove step" onClick={() => setSteps((prev) => prev.filter((_, k) => k !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-end gap-2">
        <Select value={addKind} onChange={(e) => setAddKind(e.target.value as WorkflowStep['kind'])} className="w-64" aria-label="Step to add">
          {STEP_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </Select>
        <Button variant="secondary" onClick={() => setSteps((prev) => [...prev, defaultStep(addKind)])}>
          Add step
        </Button>
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <div className="text-sm font-semibold">Saved workflows</div>
        {workflows.length === 0 && <p className="text-sm text-muted">Nothing saved yet.</p>}
        <ul className="space-y-2">
          {workflows.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-line/30 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{w.name}</span>
              <span className="truncate text-xs text-muted">{w.steps.map(stepLabel).join(' → ')}</span>
              <Button size="sm" variant="ghost" onClick={() => edit(w)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { deleteWorkflow(w.id); if (id === w.id) reset(); }} aria-label={`Delete ${w.name}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        {workflows.length > 0 && (
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <Field label="Workflow">
              <Select value={runWf} onChange={(e) => setRunWf(e.target.value)}>
                <option value="">Choose…</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="File">
              {runFile ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate">{runFile.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => setRunFile(null)}>
                    Remove
                  </Button>
                </div>
              ) : (
                <Dropzone compact accept="application/pdf,.pdf" title="Drop a PDF" onFiles={(f) => setRunFile(f[0] ?? null)} />
              )}
            </Field>
            <Button variant="primary" onClick={runOne} disabled={!runFile || !runWf}>
              Run once
            </Button>
          </div>
        )}
        <InlineJob jobId={jobId} />
      </div>
    </Card>
  );
}

interface FileHandleLike {
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
}
interface DirHandleLike {
  entries(): AsyncIterable<[string, FileHandleLike]>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
}

function WatchSection({ workflows }: { workflows: Workflow[] }) {
  const [wfId, setWfId] = useState('');
  const [watching, setWatching] = useState(false);
  const [folder, setFolder] = useState('');
  const dirRef = useRef<DirHandleLike | null>(null);
  const seenRef = useRef(new Set<string>());
  const supported = typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
  const steps = workflows.find((w) => w.id === wfId)?.steps ?? [];

  const start = async (): Promise<void> => {
    const picker = (window as unknown as { showDirectoryPicker: (o?: { mode?: string }) => Promise<DirHandleLike & { name: string }> }).showDirectoryPicker;
    try {
      const dir = await picker({ mode: 'readwrite' });
      dirRef.current = dir;
      seenRef.current = new Set();
      setFolder(dir.name);
      setWatching(true);
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) toast({ kind: 'error', title: 'Could not open the folder', message: errMessage(e) });
    }
  };

  useEffect(() => {
    if (!watching || steps.length === 0) return;
    const tick = async (): Promise<void> => {
      const dir = dirRef.current;
      if (!dir) return;
      for await (const [name, handle] of dir.entries()) {
        if (!/\.pdf$/i.test(name) || /-processed\.pdf$/i.test(name) || seenRef.current.has(name)) continue;
        seenRef.current.add(name);
        const file = await handle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        const j = enqueue(`Watch: ${name}`, (job) => runWorkflow(steps, bytes, job));
        j.promise
          .then(async (out) => {
            const target = await dir.getFileHandle(outName(name, '-processed'), { create: true });
            const w = await target.createWritable();
            await w.write(out);
            await w.close();
            toast({ kind: 'success', title: `Processed ${name}`, message: 'Saved next to the original.' });
          })
          .catch((e: unknown) => {
            if (!isAbort(e)) toast({ kind: 'error', title: `Could not process ${name}`, message: errMessage(e) });
          });
      }
    };
    const id = window.setInterval(() => void tick().catch(() => undefined), 4000);
    void tick().catch(() => undefined);
    return () => window.clearInterval(id);
  }, [watching, steps]);

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <FolderOpen className="h-5 w-5 text-accent" aria-hidden="true" />
        Watch folder
      </div>
      {!supported ? (
        <p className="text-sm text-muted">Watch folder needs a Chromium-based browser (File System Access API). Batch processing works everywhere.</p>
      ) : (
        <>
          <p className="text-sm text-muted">Every new PDF that appears in the folder is processed with the chosen workflow and saved next to it as “-processed”.</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Workflow">
              <Select value={wfId} onChange={(e) => setWfId(e.target.value)} disabled={watching} className="w-72">
                <option value="">Choose a workflow…</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            {!watching ? (
              <Button variant="primary" onClick={() => void start()} disabled={!wfId}>
                Choose folder and watch
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setWatching(false)}>
                Stop watching {folder}
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

export default function Batch() {
  const workflows = useApp((s) => s.workflows);
  return (
    <Page title="Batch & workflows" desc="Process many files, build reusable workflows, and watch a folder." icon={<Layers className="h-5 w-5" />}>
      <BatchSection workflows={workflows} />
      <WorkflowSection workflows={workflows} />
      <WatchSection workflows={workflows} />
    </Page>
  );
}
