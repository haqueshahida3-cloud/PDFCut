// Watermark & numbering: text watermark, page numbers, headers and footers, Bates numbers.
// Tokens: {n} page number, {total} page count, {bates} prefix + padded number.
import { Stamp as StampIcon } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Dropzone, Field, Input, Segmented, Slider, Toggle } from '../components/ui';
import { InlineJob, Page, loadPdfFile, outName } from '../components/Page';
import { PdfCanvas } from '../components/PdfView';
import type { PdfDoc } from '../lib/pdfjs';
import { downloadBlob, errMessage } from '../lib/util';
import { toast } from '../store/app';
import { enqueue } from '../store/jobs';

const PRESETS: Array<{ label: string; apply: (s: StampState) => StampState }> = [
  { label: 'Page X of Y', apply: (s) => ({ ...s, numOn: true, position: 'bottom', center: 'Page {n} of {total}', prefix: '', digits: 0 }) },
  { label: 'Bates numbers', apply: (s) => ({ ...s, numOn: true, position: 'bottom', left: '', center: '', right: '{bates}', prefix: 'ABC-', digits: 6 }) },
  { label: 'Draft watermark', apply: (s) => ({ ...s, wmOn: true, wmText: 'DRAFT', wmOpacity: 0.15, wmAngle: 45 }) },
  { label: 'Confidential header', apply: (s) => ({ ...s, numOn: true, position: 'top', left: 'CONFIDENTIAL', center: '', right: '{n}/{total}', color: '#991b1b' }) },
];

interface StampState {
  wmOn: boolean;
  wmText: string;
  wmSize: number;
  wmOpacity: number;
  wmAngle: number;
  wmColor: string;
  numOn: boolean;
  position: 'top' | 'bottom';
  left: string;
  center: string;
  right: string;
  size: number;
  margin: number;
  startAt: number;
  prefix: string;
  digits: number;
  color: string;
}

const INITIAL: StampState = {
  wmOn: true,
  wmText: 'CONFIDENTIAL',
  wmSize: 54,
  wmOpacity: 0.18,
  wmAngle: 45,
  wmColor: '#6b7280',
  numOn: true,
  position: 'bottom',
  left: '',
  center: 'Page {n} of {total}',
  right: '',
  size: 9,
  margin: 24,
  startAt: 1,
  prefix: '',
  digits: 0,
  color: '#374151',
};

function fill(tpl: string, n: number, total: number, s: StampState): string {
  const bates = s.prefix + String(n).padStart(s.digits, '0');
  return tpl.split('{n}').join(String(n)).split('{total}').join(String(total)).split('{bates}').join(bates);
}

export default function Stamp() {
  const [file, setFile] = useState<{ name: string; size: number; bytes: Uint8Array; doc: PdfDoc } | null>(null);
  const [s, setS] = useState<StampState>(INITIAL);
  const [jobId, setJobId] = useState<string | null>(null);

  function set<K extends keyof StampState>(k: K, v: StampState[K]): void {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  const load = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (!f) return;
    try {
      const { bytes, doc } = await loadPdfFile(f);
      setFile({ name: f.name, size: f.size, bytes, doc });
    } catch (e) {
      toast({ kind: 'error', title: 'Could not open this PDF', message: errMessage(e) });
    }
  };

  const apply = (): void => {
    if (!file) return;
    if (!s.wmOn && !s.numOn) {
      toast({ kind: 'info', title: 'Turn on a watermark or numbering first' });
      return;
    }
    const { bytes, name } = file;
    const snap = s;
    const j = enqueue(`Stamp ${name}`, async (job) => {
      let out = bytes;
      if (snap.wmOn) {
        out = await job.work<Uint8Array>('watermark', {
          bytes: out,
          opts: { text: snap.wmText, size: snap.wmSize, opacity: snap.wmOpacity, angle: snap.wmAngle, color: snap.wmColor },
        });
      }
      if (snap.numOn) {
        out = await job.work<Uint8Array>('stamp', {
          bytes: out,
          opts: {
            position: snap.position,
            left: snap.left,
            center: snap.center,
            right: snap.right,
            size: snap.size,
            margin: snap.margin,
            startAt: snap.startAt,
            batesPrefix: snap.prefix,
            batesDigits: snap.digits,
            color: snap.color,
          },
        });
      }
      return out;
    });
    setJobId(j.id);
    j.promise
      .then((out) => {
        downloadBlob(out, outName(name, '-stamped'));
        toast({ kind: 'success', title: 'Stamped PDF saved', message: outName(name, '-stamped') });
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error && e.name === 'AbortError')) toast({ kind: 'error', title: 'Stamping failed', message: errMessage(e) });
      });
  };

  if (!file) {
    return (
      <Page title="Watermark & numbers" desc="Text watermarks, page numbers, headers, footers and Bates numbering." icon={<StampIcon className="h-5 w-5" />}>
        <Dropzone accept="application/pdf,.pdf" title="Drop a PDF to stamp" onFiles={(f) => void load(f)} icon={<StampIcon className="h-7 w-7" />} />
      </Page>
    );
  }

  const total = file.doc.numPages;
  const previewW = 300;
  const previewH = previewW * 1.414;

  return (
    <Page
      title="Watermark & numbers"
      desc={`${file.name} · ${total} pages`}
      icon={<StampIcon className="h-5 w-5" />}
      actions={
        <Button variant="primary" onClick={apply}>
          Apply and save
        </Button>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold">Text watermark</div>
              <Toggle checked={s.wmOn} onChange={(v) => set('wmOn', v)} label="Enable watermark" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Text">
                <Input value={s.wmText} onChange={(e) => set('wmText', e.target.value)} disabled={!s.wmOn} />
              </Field>
              <Field label="Colour">
                <input type="color" value={s.wmColor} onChange={(e) => set('wmColor', e.target.value)} disabled={!s.wmOn} className="h-9 w-full rounded-xl border border-line bg-transparent" aria-label="Watermark colour" />
              </Field>
              <Slider label="Size" value={s.wmSize} min={12} max={120} onChange={(v) => set('wmSize', v)} format={(v) => `${v} pt`} />
              <Slider label="Opacity" value={Math.round(s.wmOpacity * 100)} min={5} max={100} step={5} onChange={(v) => set('wmOpacity', v / 100)} format={(v) => `${v}%`} />
              <Slider label="Angle" value={s.wmAngle} min={-90} max={90} step={5} onChange={(v) => set('wmAngle', v)} format={(v) => `${v}°`} />
            </div>
          </Card>

          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold">Page numbers, headers & footers, Bates</div>
              <Toggle checked={s.numOn} onChange={(v) => set('numOn', v)} label="Enable numbering" />
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Button key={p.label} size="sm" variant="secondary" onClick={() => setS((prev) => p.apply(prev))}>
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Left">
                <Input value={s.left} onChange={(e) => set('left', e.target.value)} disabled={!s.numOn} />
              </Field>
              <Field label="Centre">
                <Input value={s.center} onChange={(e) => set('center', e.target.value)} disabled={!s.numOn} />
              </Field>
              <Field label="Right">
                <Input value={s.right} onChange={(e) => set('right', e.target.value)} disabled={!s.numOn} />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Position">
                <Segmented id="stamp-pos" label="Position" value={s.position} onChange={(v) => set('position', v)} options={[
                  { value: 'top', label: 'Header (top)' },
                  { value: 'bottom', label: 'Footer (bottom)' },
                ]} />
              </Field>
              <Slider label="Font size" value={s.size} min={6} max={18} onChange={(v) => set('size', v)} format={(v) => `${v} pt`} />
              <Slider label="Margin" value={s.margin} min={8} max={72} onChange={(v) => set('margin', v)} format={(v) => `${v} pt`} />
              <Field label="Start at">
                <Input type="number" min={0} value={s.startAt} onChange={(e) => set('startAt', Math.max(0, Number(e.target.value) || 0))} className="w-28" />
              </Field>
              <Field label="Bates prefix">
                <Input value={s.prefix} onChange={(e) => set('prefix', e.target.value)} className="w-40" />
              </Field>
              <Field label="Bates digits (0 = no padding)">
                <Input type="number" min={0} max={12} value={s.digits} onChange={(e) => set('digits', Math.max(0, Math.min(12, Number(e.target.value) || 0)))} className="w-28" />
              </Field>
            </div>
            <p className="text-xs text-muted">Tokens: {'{n}'} page number · {'{total}'} page count · {'{bates}'} prefix plus padded number. Standard fonts cover Western European characters.</p>
          </Card>
          <InlineJob jobId={jobId} />
        </div>

        <Card className="h-fit space-y-3">
          <div className="text-sm font-semibold">Preview · page 1</div>
          <div className="relative mx-auto overflow-hidden rounded-xl shadow" style={{ width: previewW, height: previewH }}>
            <PdfCanvas doc={file.doc} pageNo={1} width={previewW} height={previewH} />
            {s.wmOn && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
                <span style={{ transform: `rotate(${-s.wmAngle}deg)`, opacity: s.wmOpacity, color: s.wmColor, fontSize: Math.max(8, s.wmSize * 0.4), fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {s.wmText}
                </span>
              </div>
            )}
            {s.numOn && (
              <div className="pointer-events-none absolute inset-x-0 flex justify-between px-3 text-[9px]" style={{ color: s.color, ...(s.position === 'top' ? { top: 8 } : { bottom: 8 }) }}>
                <span>{fill(s.left, 1, total, s)}</span>
                <span>{fill(s.center, 1, total, s)}</span>
                <span>{fill(s.right, 1, total, s)}</span>
              </div>
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}
