// OCR with Tesseract (WebAssembly, runs locally). Produces plain text and a searchable PDF
// (scanned image with an invisible, selectable text layer). Engine files ship in /ocr;
// language data is fetched once from the Tesseract CDN unless you host it yourself.
import { ScanText } from 'lucide-react';
import { createWorker } from 'tesseract.js';
import { useState } from 'react';
import { Button, Card, Dropzone, Field, Toggle } from '../components/ui';
import { InlineJob, Page, outName, readFileBytes } from '../components/Page';
import { openPdf, type PdfPage } from '../lib/pdfjs';
import { downloadBlob, errMessage } from '../lib/util';
import type { OcrPage, OcrWord } from '../lib/pdf/ops';
import { toast } from '../store/app';
import { enqueue, type JobCtx } from '../store/jobs';

const LANGUAGES: Array<[string, string]> = [
  ['eng', 'English'],
  ['spa', 'Español'],
  ['fra', 'Français'],
  ['deu', 'Deutsch'],
  ['ita', 'Italiano'],
  ['por', 'Português'],
  ['nld', 'Nederlands'],
  ['rus', 'Русский'],
  ['ara', 'العربية'],
  ['fas', 'فارسی'],
  ['urd', 'اردو'],
  ['hin', 'हिन्दी'],
  ['ben', 'বাংলা'],
  ['tam', 'தமிழ்'],
  ['chi_sim', '简体中文'],
  ['chi_tra', '繁體中文'],
  ['jpn', '日本語'],
  ['kor', '한국어'],
  ['tha', 'ไทย'],
  ['vie', 'Tiếng Việt'],
  ['ind', 'Bahasa Indonesia'],
  ['tur', 'Türkçe'],
  ['pol', 'Polski'],
];

const SCALE = 2;
const DPI = 150;

interface OcrResult {
  text: string;
  pdf: Uint8Array;
}

async function toCanvas(src: OffscreenCanvas | ImageBitmap, enhance: boolean): Promise<OffscreenCanvas> {
  const out = new OffscreenCanvas(src.width, src.height);
  const cx = out.getContext('2d') as unknown as CanvasRenderingContext2D;
  cx.fillStyle = '#ffffff';
  cx.fillRect(0, 0, out.width, out.height);
  if (enhance) cx.filter = 'grayscale(1) contrast(1.6)';
  cx.drawImage(src, 0, 0);
  return out;
}

async function renderPdfPage(page: PdfPage): Promise<OffscreenCanvas> {
  const vp = page.getViewport({ scale: SCALE });
  const canvas = new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const cx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  cx.fillStyle = '#ffffff';
  cx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: cx, viewport: vp, canvas: canvas as unknown as HTMLCanvasElement }).promise;
  return canvas;
}

async function recognizeCanvas(
  worker: Awaited<ReturnType<typeof createWorker>>,
  canvas: OffscreenCanvas,
  ptPerPx: number,
): Promise<{ text: string; words: OcrWord[]; widthPt: number; heightPt: number; jpeg: Uint8Array }> {
  const png = await canvas.convertToBlob({ type: 'image/png' });
  const { data } = await worker.recognize(png, {}, { blocks: true, text: true });
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const w of line.words) {
          const b = w.bbox;
          words.push({
            text: w.text,
            x: b.x0 * ptPerPx,
            y: b.y0 * ptPerPx,
            w: (b.x1 - b.x0) * ptPerPx,
            h: (b.y1 - b.y0) * ptPerPx,
          });
        }
      }
    }
  }
  const jpeg = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })).arrayBuffer());
  return { text: data.text, words, widthPt: canvas.width * ptPerPx, heightPt: canvas.height * ptPerPx, jpeg };
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

export default function Ocr() {
  const [file, setFile] = useState<File | null>(null);
  const [langs, setLangs] = useState<string[]>(['eng']);
  const [enhance, setEnhance] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);

  const toggleLang = (code: string): void => {
    setLangs((prev) => {
      if (prev.includes(code)) return prev.length > 1 ? prev.filter((c) => c !== code) : prev;
      return [...prev, code];
    });
  };

  const run = (): void => {
    if (!file) return;
    const f = file;
    const lang = langs.join('+');
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    const j = enqueue(`OCR ${f.name}`, async (job: JobCtx) => {
      const base = import.meta.env.BASE_URL;
      let current = 0;
      const worker = await createWorker(lang, 1, {
        workerPath: `${base}ocr/worker.min.js`,
        langPath: `${base}ocr/lang`,
        corePath: `${base}ocr/`,
        logger: (m: { status: string; progress: number }) => {
          job.report(current, `${m.status} ${Math.round(m.progress * 100)}%`);
        },
      });
      const pages: OcrPage[] = [];
      const texts: string[] = [];
      try {
        if (isPdf) {
          const doc = await openPdf(await readFileBytes(f));
          try {
            for (let p = 1; p <= doc.numPages; p++) {
              await job.checkpoint();
              const page = await doc.getPage(p);
              const canvas = await toCanvas(await renderPdfPage(page), enhance);
              page.cleanup();
              const r = await recognizeCanvas(worker, canvas, 1 / SCALE);
              texts.push(r.text.trim());
              pages.push({ image: { bytes: r.jpeg, kind: 'jpg', width: r.widthPt, height: r.heightPt }, words: r.words });
              current = p / doc.numPages;
              job.report(current, `Page ${p} of ${doc.numPages}`);
            }
          } finally {
            await doc.destroy();
          }
        } else {
          const bmp = await createImageBitmap(f);
          const canvas = await toCanvas(bmp, enhance);
          bmp.close();
          const r = await recognizeCanvas(worker, canvas, 72 / DPI);
          texts.push(r.text.trim());
          pages.push({ image: { bytes: r.jpeg, kind: 'jpg', width: r.widthPt, height: r.heightPt }, words: r.words });
        }
      } finally {
        await worker.terminate();
      }
      job.report(0.98, 'Building searchable PDF');
      const pdf = await job.work<Uint8Array>('ocr.pdf', { pages });
      return { text: texts.join('\n\n'), pdf };
    });
    setJobId(j.id);
    j.promise
      .then((r) => {
        setResult(r);
        toast({ kind: 'success', title: 'OCR complete', message: `${r.text.length.toLocaleString()} characters recognized` });
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) toast({ kind: 'error', title: 'OCR failed', message: errMessage(e) });
      });
  };

  return (
    <Page
      title="OCR"
      desc="Make scanned PDFs searchable and extract text from images. Runs locally with Tesseract."
      icon={<ScanText className="h-5 w-5" />}
    >
      <Card className="space-y-5">
        {!file ? (
          <Dropzone
            accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,image/bmp"
            title="Drop a scanned PDF or an image"
            hint="Pages are processed one at a time to keep memory low."
            onFiles={(f) => {
              setFile(f[0] ?? null);
              setResult(null);
            }}
            icon={<ScanText className="h-7 w-7" />}
          />
        ) : (
          <div className="flex items-center gap-3 text-sm">
            <span className="truncate font-medium">{file.name}</span>
            <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
              Change
            </Button>
          </div>
        )}
        <Field label="Languages" hint="Select one or more. Combining languages slightly slows recognition.">
          <div className="flex flex-wrap gap-1.5">
            {LANGUAGES.map(([code, name]) => (
              <button
                key={code}
                type="button"
                aria-pressed={langs.includes(code)}
                onClick={() => toggleLang(code)}
                className={`btn btn-sm ${langs.includes(code) ? 'btn-primary' : 'btn-secondary'}`}
              >
                {name}
              </button>
            ))}
          </div>
        </Field>
        <div className="flex flex-wrap items-center gap-4">
          <Toggle checked={enhance} onChange={setEnhance} label="Enhance scan (grayscale and contrast)" />
          <span className="text-sm">Enhance scan: grayscale and contrast</span>
          <Button variant="primary" className="ms-auto" onClick={run} disabled={!file}>
            Run OCR
          </Button>
        </div>
        <InlineJob jobId={jobId} />
      </Card>

      {result && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => downloadBlob(result.pdf, outName(file?.name ?? 'scan', '-searchable'), 'application/pdf')}>
              Download searchable PDF
            </Button>
            <Button variant="ghost" onClick={() => downloadBlob(result.text, outName(file?.name ?? 'scan', '', 'txt'), 'text/plain;charset=utf-8')}>
              Download text
            </Button>
          </div>
          <textarea readOnly className="input min-h-56 w-full font-mono text-sm" value={result.text} aria-label="Recognized text" />
        </Card>
      )}
    </Page>
  );
}
