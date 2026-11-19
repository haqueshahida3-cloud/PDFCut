// Compress: lossless structure rebuild, or raster compression with presets, custom quality/scale,
// or an automatic ladder that aims for a target file size. Shows before/after size and preview.
import { Minimize2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, Dropzone, Field, Input, Segmented, Slider, Toggle } from '../components/ui';
import { InlineJob, Page, loadPdfFile, outName } from '../components/Page';
import { PdfCanvas } from '../components/PdfView';
import type { CompressOpts } from '../lib/pdf/raster-core';
import { openPdf, type PdfDoc } from '../lib/pdfjs';
import { downloadBlob, errMessage, formatBytes, formatPercent } from '../lib/util';
import { takePending, toast } from '../store/app';
import { enqueue } from '../store/jobs';
import { setSettings, useSettings } from '../store/settings';

type Preset = 'lossless' | 'light' | 'medium' | 'strong' | 'custom';

const PRESETS: Record<Exclude<Preset, 'lossless' | 'custom'>, CompressOpts> = {
  light: { scale: 2, quality: 0.9 },
  medium: { scale: 1.5, quality: 0.75 },
  strong: { scale: 1, quality: 0.5 },
};

const LADDER: Array<{ label: string; opts: CompressOpts }> = [
  { label: 'high quality', opts: { scale: 1.5, quality: 0.8 } },
  { label: 'good quality', opts: { scale: 1.25, quality: 0.65 } },
  { label: 'balanced', opts: { scale: 1, quality: 0.5 } },
  { label: 'small', opts: { scale: 0.9, quality: 0.35 } },
  { label: 'smallest', opts: { scale: 0.75, quality: 0.25 } },
];

interface Result {
  out: Uint8Array;
  note: string;
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

export default function Compress() {
  const preset = useSettings((s) => s.compressPreset);
  const [file, setFile] = useState<{ name: string; size: number; bytes: Uint8Array; doc: PdfDoc } | null>(null);
  const [quality, setQuality] = useState(0.7);
  const [scale, setScale] = useState(1.5);
  const [targetOn, setTargetOn] = useState(false);
  const [targetMB, setTargetMB] = useState(2);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [afterDoc, setAfterDoc] = useState<PdfDoc | null>(null);

  useEffect(() => {
    if (!result) {
      setAfterDoc(null);
      return;
    }
    let alive = true;
    let doc: PdfDoc | null = null;
    void openPdf(result.out).then((d) => {
      if (!alive) {
        void d.destroy();
        return;
      }
      doc = d;
      setAfterDoc(d);
    });
    return () => {
      alive = false;
      void doc?.destroy().catch(() => undefined);
    };
  }, [result]);

  const load = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (!f) return;
    try {
      const { bytes, doc } = await loadPdfFile(f);
      setResult(null);
      setFile({ name: f.name, size: f.size, bytes, doc });
    } catch (e) {
      toast({ kind: 'error', title: 'Could not open this PDF', message: errMessage(e) });
    }
  };

  // Files sent from "Open with PDFCut" or the file manager arrive when this tool opens.
  useEffect(() => {
    const incoming = takePending('compress');
    if (incoming.length > 0) void load(incoming);
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosenOpts = (): CompressOpts => {
    if (preset === 'custom') return { scale, quality };
    if (preset === 'lossless') return { scale: 1, quality: 1 };
    return PRESETS[preset];
  };

  const run = (): void => {
    if (!file) return;
    const { bytes, name, size } = file;
    const target = targetMB * 1024 * 1024;
    const j = enqueue(`Compress ${name}`, async (job) => {
      if (preset === 'lossless' && !targetOn) {
        const out = await job.work<Uint8Array>('rebuild', { bytes });
        return { out, note: 'Lossless: file structure rebuilt. Text and images are unchanged.' };
      }
      if (!targetOn) {
        const opts = chosenOpts();
        const out = await job.work<Uint8Array>('raster.compress', { bytes, opts });
        return { out, note: `Pages rendered at ${opts.scale}× and JPEG quality ${Math.round(opts.quality * 100)}%. Text is no longer selectable.` };
      }
      let best: { out: Uint8Array; label: string } | null = null;
      for (let i = 0; i < LADDER.length; i++) {
        job.report(i / LADDER.length, `Trying ${LADDER[i].label} (${i + 1}/${LADDER.length})`);
        const out = await job.work<Uint8Array>('raster.compress', { bytes, opts: LADDER[i].opts });
        if (!best || out.length < best.out.length) best = { out, label: LADDER[i].label };
        if (out.length <= target) {
          return { out, note: `Reached ${formatBytes(target)} target with ${LADDER[i].label} quality.` };
        }
      }
      if (!best) throw new Error('Compression produced no output');
      return { out: best.out, note: `Target of ${formatBytes(target)} not reachable; kept the smallest result (${best.label}).` };
    });
    setJobId(j.id);
    j.promise
      .then((r) => {
        setResult(r);
        if (r.out.length < size) toast({ kind: 'success', title: 'Compressed', message: `${formatBytes(size)} → ${formatBytes(r.out.length)}` });
        else toast({ kind: 'info', title: 'No size reduction', message: 'The original was already efficient.' });
        downloadBlob(r.out, outName(name, '-compressed'));
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) toast({ kind: 'error', title: 'Compression failed', message: errMessage(e) });
      });
  };

  return (
    <Page title="Compress PDF" desc="Shrink files with quality presets, a custom setting or a target size, with before/after preview." icon={<Minimize2 className="h-5 w-5" />}>
      {!file ? (
        <Dropzone accept="application/pdf,.pdf" title="Drop a PDF to compress" onFiles={(f) => void load(f)} icon={<Minimize2 className="h-7 w-7" />} />
      ) : (
        <>
          <Card className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{file.name}</div>
                <div className="text-sm text-muted">
                  {file.doc.numPages} pages · {formatBytes(file.size)}
                </div>
              </div>
              <Button variant="ghost" onClick={() => setFile(null)}>
                Choose another
              </Button>
            </div>
            <Segmented
              id="compress-preset"
              label="Compression level"
              value={preset}
              onChange={(v) => setSettings({ compressPreset: v })}
              options={[
                { value: 'lossless', label: 'Lossless' },
                { value: 'light', label: 'Light' },
                { value: 'medium', label: 'Medium' },
                { value: 'strong', label: 'Strong' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            {preset === 'lossless' && <p className="text-sm text-muted">Keeps text, images and quality. Removes unused data. Best for files that are already optimized.</p>}
            {preset === 'custom' && (
              <div className="grid gap-5 md:grid-cols-2">
                <Slider label="JPEG quality" value={Math.round(quality * 100)} min={20} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => setQuality(v / 100)} />
                <Slider label="Render scale (dpi)" value={scale} min={0.5} max={3} step={0.25} format={(v) => `${Math.round(v * 72)} dpi`} onChange={setScale} />
              </div>
            )}
            {preset !== 'lossless' && (
              <div className="flex flex-wrap items-center gap-4">
                <Toggle checked={targetOn} onChange={setTargetOn} label="Target a file size" />
                <span className="text-sm">Target file size</span>
                {targetOn && (
                  <Field label="Maximum size (MB)" className="w-40">
                    <Input type="number" min={0.1} step={0.5} value={targetMB} onChange={(e) => setTargetMB(Math.max(0.1, Number(e.target.value) || 0.1))} />
                  </Field>
                )}
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="primary" onClick={run}>
                Compress and download
              </Button>
            </div>
          </Card>

          {result && (
            <Card className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <Stat label="Before" value={formatBytes(file.size)} />
                <Stat label="After" value={formatBytes(result.out.length)} />
                <Stat label="Saved" value={formatPercent(1 - result.out.length / file.size)} />
              </div>
              <p className="text-sm text-muted">{result.note}</p>
              <div className="grid gap-6 md:grid-cols-2">
                <Preview label="Before" doc={file.doc} />
                {afterDoc ? <Preview label="After" doc={afterDoc} /> : <div className="skeleton h-72 rounded-card" />}
              </div>
            </Card>
          )}
          <InlineJob jobId={jobId} />
        </>
      )}
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-line/30 p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Preview({ label, doc }: { label: string; doc: PdfDoc }) {
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-medium">{label} · page 1</figcaption>
      <div className="overflow-hidden rounded-xl bg-line/30 p-3">
        <PdfCanvas doc={doc} pageNo={1} width={280} height={280 * 1.4} />
      </div>
    </figure>
  );
}
