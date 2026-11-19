// Form fields: inspect the AcroForm fields of a PDF, add text or checkbox fields (click the preview to place
// them), and flatten the form. All PDF work runs in the worker.
import { ListChecks } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Dropzone, Field, Input, Segmented } from '../components/ui';
import { PdfCanvas } from '../components/PdfView';
import { InlineJob, Page, loadPdfFile, outName } from '../components/Page';
import type { FormFieldInfo, NewField } from '../lib/pdf/forms';
import type { PdfDoc } from '../lib/pdfjs';
import { downloadBlob, errMessage } from '../lib/util';
import { toast } from '../store/app';
import { enqueue } from '../store/jobs';

interface Loaded {
  name: string;
  size: number;
  bytes: Uint8Array;
  doc: PdfDoc;
}

interface Draft {
  type: 'text' | 'checkbox';
  name: string;
  page: number;
  x: number; // percent
  y: number;
  w: number;
  h: number;
}

const PREVIEW_W = 340;
const PREVIEW_H = PREVIEW_W * 1.414;

export default function Forms() {
  const [file, setFile] = useState<Loaded | null>(null);
  const [fields, setFields] = useState<FormFieldInfo[] | null>(null);
  const [draft, setDraft] = useState<Draft>({ type: 'text', name: 'field_1', page: 0, x: 10, y: 10, w: 40, h: 6 });
  const [pending, setPending] = useState<NewField[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);

  const load = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (!f) return;
    try {
      const { bytes, doc } = await loadPdfFile(f);
      setFile({ name: f.name, size: f.size, bytes, doc });
      setPending([]);
      const j = enqueue(`Read fields of ${f.name}`, (ctx) => ctx.work<FormFieldInfo[]>('forms.inspect', { bytes }));
      j.promise.then(setFields).catch((e: unknown) => toast({ kind: 'error', title: 'Could not read form fields', message: errMessage(e) }));
    } catch (e) {
      toast({ kind: 'error', title: 'Could not open this PDF', message: errMessage(e) });
    }
  };

  const addPending = (): void => {
    if (!draft.name.trim()) {
      toast({ kind: 'info', title: 'Give the field a name first' });
      return;
    }
    if (pending.some((p) => p.name === draft.name) || fields?.some((f) => f.name === draft.name)) {
      toast({ kind: 'error', title: `"${draft.name}" already exists` });
      return;
    }
    setPending((prev) => [...prev, { type: draft.type, name: draft.name.trim(), page: draft.page, x: draft.x / 100, y: draft.y / 100, w: draft.w / 100, h: draft.h / 100 }]);
    setDraft((d) => ({ ...d, name: nextName(d.name) }));
  };

  const run = (kind: 'create' | 'flatten'): void => {
    if (!file) return;
    const { bytes, name } = file;
    const j = enqueue(kind === 'create' ? `Add form fields to ${name}` : `Flatten ${name}`, (ctx) =>
      kind === 'create' ? ctx.work<Uint8Array>('forms.create', { bytes, fields: pending }) : ctx.work<Uint8Array>('forms.flatten', { bytes }),
    );
    setJobId(j.id);
    j.promise
      .then((out) => {
        downloadBlob(out, outName(name, kind === 'create' ? '-forms' : '-flattened'));
        toast({ kind: 'success', title: kind === 'create' ? 'Fields added' : 'Form flattened', message: 'Saved as a new file.' });
        if (kind === 'create') setPending([]);
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error && e.name === 'AbortError')) toast({ kind: 'error', title: 'Could not change the form', message: errMessage(e) });
      });
  };

  if (!file) {
    return (
      <Page title="Form fields" desc="Add text and checkbox fields, or flatten an existing form." icon={<ListChecks className="h-5 w-5" />}>
        <Dropzone accept="application/pdf,.pdf" title="Drop a PDF" onFiles={(f) => void load(f)} icon={<ListChecks className="h-7 w-7" />} />
      </Page>
    );
  }

  const onPreviewClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    setDraft((d) => ({ ...d, x: Math.round(((e.clientX - r.left) / r.width) * 100), y: Math.round(((e.clientY - r.top) / r.height) * 100) }));
  };

  return (
    <Page title="Form fields" desc={`${file.name} · ${fields?.length ?? '…'} existing field(s)`} icon={<ListChecks className="h-5 w-5" />} actions={<Button variant="ghost" onClick={() => setFile(null)}>Choose another</Button>}>
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Card className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Type">
              <Segmented id="field-type" label="Field type" value={draft.type} onChange={(v) => setDraft((d) => ({ ...d, type: v }))} options={[
                { value: 'text', label: 'Text' },
                { value: 'checkbox', label: 'Checkbox' },
              ]} />
            </Field>
            <Field label="Name">
              <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} aria-label="Field name" />
            </Field>
            <Field label="Page">
              <Input type="number" min={1} value={draft.page + 1} onChange={(e) => setDraft((d) => ({ ...d, page: Math.max(0, (Number(e.target.value) || 1) - 1) }))} aria-label="Page number" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <Field key={k} label={{ x: 'Left %', y: 'Top %', w: 'Width %', h: 'Height %' }[k]}>
                <Input type="number" min={0} max={100} value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))} aria-label={k} />
              </Field>
            ))}
          </div>
          <p className="text-xs text-muted">Click the preview to set the top-left corner. Fields are added on save.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={addPending}>Add field to list</Button>
            <Button variant="primary" onClick={() => run('create')} disabled={pending.length === 0}>Save with {pending.length} new field{pending.length === 1 ? '' : 's'}</Button>
            <Button variant="ghost" onClick={() => run('flatten')} disabled={!fields || fields.length === 0}>Flatten existing form</Button>
          </div>
          {pending.length > 0 && (
            <ul className="space-y-1 text-sm">
              {pending.map((p, i) => (
                <li key={`${p.name}-${i}`} className="flex items-center justify-between rounded-lg bg-line/30 px-3 py-1.5">
                  <span>{p.name} <span className="text-muted">({p.type}, page {p.page + 1})</span></span>
                  <Button size="sm" variant="ghost" onClick={() => setPending((prev) => prev.filter((_, k) => k !== i))}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
          <InlineJob jobId={jobId} />
        </Card>

        <div className="space-y-3">
          <Card className="space-y-2">
            <div className="text-sm font-semibold">Preview · page {draft.page + 1}</div>
            <div className="relative mx-auto cursor-crosshair overflow-hidden rounded-xl shadow" style={{ width: PREVIEW_W, height: PREVIEW_H }} onClick={onPreviewClick} role="presentation">
              <PdfCanvas doc={file.doc} pageNo={Math.min(file.doc.numPages, draft.page + 1)} width={PREVIEW_W} height={PREVIEW_H} />
              {pending.filter((p) => p.page === draft.page).map((p, i) => (
                <div key={i} className="pointer-events-none absolute border-2 border-accent bg-accent/10" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.w * 100}%`, height: `${p.h * 100}%` }} />
              ))}
              <div className="pointer-events-none absolute border-2 border-dashed border-accent" style={{ left: `${draft.x}%`, top: `${draft.y}%`, width: `${draft.w}%`, height: `${draft.h}%` }} />
            </div>
          </Card>
          <Card className="space-y-2">
            <div className="text-sm font-semibold">Existing fields</div>
            {!fields && <p className="text-xs text-muted">Reading…</p>}
            {fields && fields.length === 0 && <p className="text-xs text-muted">This PDF has no form fields.</p>}
            <ul className="max-h-64 space-y-1 overflow-auto text-xs">
              {fields?.map((f) => (
                <li key={f.name} className="flex justify-between gap-2 rounded-lg bg-line/30 px-2 py-1">
                  <span className="truncate font-medium">{f.name}</span>
                  <span className="shrink-0 text-muted">{f.type}{f.page >= 0 ? ` · p${f.page + 1}` : ''}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}

function nextName(name: string): string {
  const m = /^(.*?)(\d+)$/.exec(name);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${name}_2`;
}
