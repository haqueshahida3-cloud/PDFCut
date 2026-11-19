// Convert: PDF to PNG/JPEG/WebP (zip), images to PDF, PDF to text/Markdown/HTML, text/Markdown to PDF.
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Dropzone, Field, Input, Segmented, Select } from '../components/ui';
import { InlineJob, Page, loadPdfFile, outName, readFileBytes, zipFiles } from '../components/Page';
import { openPdf, pageText } from '../lib/pdfjs';
import { downloadBlob, errMessage, parseRanges, stripExt } from '../lib/util';
import { toast } from '../store/app';
import { enqueue } from '../store/jobs';

type Tab = 'pdf-images' | 'images-pdf' | 'pdf-text' | 'text-pdf';

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function PdfToImages() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [scale, setScale] = useState('2');
  const [range, setRange] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);

  const run = (): void => {
    if (!file) return;
    const f = file;
    const j = enqueue(`Export images from ${f.name}`, async (job) => {
      const bytes = await readFileBytes(f);
      const doc = await openPdf(bytes);
      try {
        const pages = range.trim() ? parseRanges(range, doc.numPages) : Array.from({ length: doc.numPages }, (_, i) => i);
        const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
        const ext = format === 'jpeg' ? 'jpg' : format;
        const out: Array<{ name: string; data: Uint8Array }> = [];
        for (let k = 0; k < pages.length; k++) {
          await job.checkpoint();
          const page = await doc.getPage(pages[k] + 1);
          const vp = page.getViewport({ scale: Number(scale) });
          const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(vp.width)), Math.max(1, Math.ceil(vp.height)));
          const cx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
          cx.fillStyle = '#ffffff';
          cx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: cx, viewport: vp, canvas: canvas as unknown as HTMLCanvasElement }).promise;
          const blob = await canvas.convertToBlob({ type: mime, quality: 0.92 });
          out.push({
            name: `${stripExt(f.name)}-page-${String(pages[k] + 1).padStart(4, '0')}.${ext}`,
            data: new Uint8Array(await blob.arrayBuffer()),
          });
          page.cleanup();
          job.report((k + 1) / pages.length, `Page ${k + 1} of ${pages.length}`);
        }
        return out;
      } finally {
        await doc.destroy();
      }
    });
    setJobId(j.id);
    j.promise
      .then(async (files) => {
        const zip = await zipFiles(files);
        downloadBlob(zip, outName(f.name, '-images', 'zip'), 'application/zip');
        toast({ kind: 'success', title: `Exported ${files.length} image${files.length === 1 ? '' : 's'}` });
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) toast({ kind: 'error', title: 'Export failed', message: errMessage(e) });
      });
  };

  return (
    <Card className="space-y-4">
      {!file ? (
        <Dropzone accept="application/pdf,.pdf" title="Drop a PDF" onFiles={(f) => setFile(f[0] ?? null)} compact />
      ) : (
        <div className="flex items-center gap-3 text-sm">
          <span className="truncate font-medium">{file.name}</span>
          <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
            Change
          </Button>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Format">
          <Segmented id="img-format" label="Image format" value={format} onChange={setFormat} options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpeg', label: 'JPEG' },
            { value: 'webp', label: 'WebP' },
          ]} />
        </Field>
        <Field label="Resolution">
          <Select value={scale} onChange={(e) => setScale(e.target.value)}>
            <option value="1">72 dpi</option>
            <option value="2">144 dpi</option>
            <option value="3">216 dpi</option>
            <option value="4">288 dpi</option>
          </Select>
        </Field>
        <Field label="Pages" hint="Empty = all pages. Example: 1-3,8">
          <Input value={range} onChange={(e) => setRange(e.target.value)} placeholder="All pages" />
        </Field>
      </div>
      <p className="text-xs text-muted">TIFF export is not available in the browser build.</p>
      <div className="flex justify-end">
        <Button variant="primary" onClick={run} disabled={!file}>
          Export as ZIP
        </Button>
      </div>
      <InlineJob jobId={jobId} />
    </Card>
  );
}

function ImagesToPdf() {
  const [files, setFiles] = useState<File[]>([]);
  const [dpi, setDpi] = useState('150');
  const [jobId, setJobId] = useState<string | null>(null);

  const run = (): void => {
    if (files.length === 0) return;
    const list = files;
    const perInch = Number(dpi);
    const j = enqueue(`Images to PDF (${list.length})`, async (job) => {
      const pages: Array<{ bytes: Uint8Array; kind: 'png' | 'jpg'; width: number; height: number }> = [];
      for (let i = 0; i < list.length; i++) {
        await job.checkpoint();
        const f = list[i];
        const bmp = await createImageBitmap(f);
        let bytes: Uint8Array;
        let kind: 'png' | 'jpg';
        if (f.type === 'image/jpeg' || f.type === 'image/png') {
          bytes = new Uint8Array(await f.arrayBuffer());
          kind = f.type === 'image/png' ? 'png' : 'jpg';
        } else {
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const cx = c.getContext('2d') as unknown as CanvasRenderingContext2D;
          cx.fillStyle = '#ffffff';
          cx.fillRect(0, 0, bmp.width, bmp.height);
          cx.drawImage(bmp, 0, 0);
          bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
          kind = 'png';
        }
        pages.push({ bytes, kind, width: (bmp.width * 72) / perInch, height: (bmp.height * 72) / perInch });
        bmp.close();
        job.report((i + 1) / list.length, `Image ${i + 1} of ${list.length}`);
      }
      return job.work<Uint8Array>('images.pages', { pages });
    });
    setJobId(j.id);
    j.promise
      .then((out) => {
        downloadBlob(out, 'images.pdf', 'application/pdf');
        toast({ kind: 'success', title: 'PDF created', message: `${list.length} page${list.length === 1 ? '' : 's'}` });
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) toast({ kind: 'error', title: 'Could not create the PDF', message: errMessage(e) });
      });
  };

  return (
    <Card className="space-y-4">
      <Dropzone
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        title="Drop images (PNG, JPEG, WebP, GIF, BMP)"
        hint={files.length ? `${files.length} image${files.length === 1 ? '' : 's'} selected: ${files.map((f) => f.name).slice(0, 3).join(', ')}${files.length > 3 ? '…' : ''}` : 'Each image becomes one page, in the order listed.'}
        onFiles={(f) => setFiles((prev) => [...prev, ...f])}
        compact
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Scan resolution (pixels per inch)">
          <Select value={dpi} onChange={(e) => setDpi(e.target.value)} className="w-48">
            <option value="72">72 (screen)</option>
            <option value="150">150 (standard)</option>
            <option value="300">300 (print)</option>
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setFiles([])} disabled={files.length === 0}>
            Clear
          </Button>
          <Button variant="primary" onClick={run} disabled={files.length === 0}>
            Create PDF
          </Button>
        </div>
      </div>
      <InlineJob jobId={jobId} />
    </Card>
  );
}

function PdfToText() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<'txt' | 'md' | 'html'>('txt');
  const [jobId, setJobId] = useState<string | null>(null);

  const run = (): void => {
    if (!file) return;
    const f = file;
    const j = enqueue(`Extract text from ${f.name}`, async (job) => {
      const bytes = await readFileBytes(f);
      const doc = await openPdf(bytes);
      try {
        const parts: string[] = [];
        for (let p = 1; p <= doc.numPages; p++) {
          await job.checkpoint();
          const page = await doc.getPage(p);
          const text = await pageText(page);
          page.cleanup();
          parts.push(text.text);
          job.report(p / doc.numPages, `Page ${p} of ${doc.numPages}`);
        }
        if (format === 'txt') return parts.map((t, i) => `--- Page ${i + 1} ---\n${t}`).join('\n\n');
        if (format === 'md') return `# ${stripExt(f.name)}\n\n${parts.map((t, i) => `## Page ${i + 1}\n\n${t}`).join('\n\n')}\n`;
        const body = parts
          .map((t, i) => `<section id="page-${i + 1}"><h2>Page ${i + 1}</h2><p>${esc(t).replace(/\n/g, '<br>')}</p></section>`)
          .join('\n');
        return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(stripExt(f.name))}</title></head>\n<body>\n${body}\n</body></html>\n`;
      } finally {
        await doc.destroy();
      }
    });
    setJobId(j.id);
    j.promise
      .then((text) => {
        const mime = format === 'html' ? 'text/html' : format === 'md' ? 'text/markdown' : 'text/plain';
        downloadBlob(text, outName(f.name, '', format), `${mime};charset=utf-8`);
        toast({ kind: 'success', title: 'Text extracted' });
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) toast({ kind: 'error', title: 'Extraction failed', message: errMessage(e) });
      });
  };

  return (
    <Card className="space-y-4">
      {!file ? (
        <Dropzone accept="application/pdf,.pdf" title="Drop a PDF" onFiles={(f) => setFile(f[0] ?? null)} compact />
      ) : (
        <div className="flex items-center gap-3 text-sm">
          <span className="truncate font-medium">{file.name}</span>
          <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
            Change
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Segmented id="txt-format" label="Text format" value={format} onChange={setFormat} options={[
          { value: 'txt', label: 'Plain text' },
          { value: 'md', label: 'Markdown' },
          { value: 'html', label: 'HTML' },
        ]} />
        <Button variant="primary" onClick={run} disabled={!file}>
          Extract text
        </Button>
      </div>
      <p className="text-xs text-muted">Scanned pages have no text layer. Run OCR first. Word, Excel and PowerPoint export needs the desktop engine.</p>
      <InlineJob jobId={jobId} />
    </Card>
  );
}

function TextToPdf() {
  const [text, setText] = useState('Hello from PDFCut!\n\nType or paste text here, or open a .txt or .md file.');
  const [sourceName, setSourceName] = useState('document');
  const [font, setFont] = useState<'Helvetica' | 'Courier' | 'TimesRoman'>('Helvetica');
  const [size, setSize] = useState('11');
  const [paper, setPaper] = useState<'a4' | 'letter' | 'legal'>('a4');
  const [jobId, setJobId] = useState<string | null>(null);

  const run = (): void => {
    const snapshot = text;
    const j = enqueue('Text to PDF', (job) =>
      job.work<Uint8Array>('text.pdf', { text: snapshot, opts: { font, size: Number(size), paper } }),
    );
    setJobId(j.id);
    j.promise
      .then((out) => {
        downloadBlob(out, outName(sourceName, ''), 'application/pdf');
        toast({ kind: 'success', title: 'PDF created' });
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) toast({ kind: 'error', title: 'Could not create the PDF', message: errMessage(e) });
      });
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Dropzone
          compact
          accept=".txt,.md,text/plain,text/markdown"
          title="Open a .txt or .md file"
          onFiles={(files) => {
            const f = files[0];
            if (!f) return;
            void f.text().then((t) => {
              setText(t);
              setSourceName(stripExt(f.name));
            });
          }}
        />
      </div>
      <Field label="Text">
        <textarea className="input min-h-48 w-full font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} aria-label="Text to convert" />
      </Field>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <Field label="Font">
            <Select value={font} onChange={(e) => setFont(e.target.value as typeof font)}>
              <option value="Helvetica">Sans-serif</option>
              <option value="TimesRoman">Serif</option>
              <option value="Courier">Monospace</option>
            </Select>
          </Field>
          <Field label="Size (pt)">
            <Input type="number" min={6} max={36} value={size} onChange={(e) => setSize(e.target.value)} className="w-24" />
          </Field>
          <Field label="Paper">
            <Select value={paper} onChange={(e) => setPaper(e.target.value as typeof paper)}>
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
              <option value="legal">Legal</option>
            </Select>
          </Field>
        </div>
        <Button variant="primary" onClick={run} disabled={!text.trim()}>
          Create PDF
        </Button>
      </div>
      <p className="text-xs text-muted">Markdown is laid out as plain text. Characters outside Western European scripts are replaced with “?”.</p>
      <InlineJob jobId={jobId} />
    </Card>
  );
}

export default function Convert() {
  const [tab, setTab] = useState<Tab>('pdf-images');
  return (
    <Page
      title="Convert"
      desc="PDF to images or text, images or text to PDF. Everything runs locally."
      icon={<RefreshCw className="h-5 w-5" />}
    >
      <Segmented
        id="convert-tab"
        label="Conversion type"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'pdf-images', label: 'PDF → Images' },
          { value: 'images-pdf', label: 'Images → PDF' },
          { value: 'pdf-text', label: 'PDF → Text / Markdown / HTML' },
          { value: 'text-pdf', label: 'Text / Markdown → PDF' },
        ]}
      />
      {tab === 'pdf-images' && <PdfToImages />}
      {tab === 'images-pdf' && <ImagesToPdf />}
      {tab === 'pdf-text' && <PdfToText />}
      {tab === 'text-pdf' && <TextToPdf />}
    </Page>
  );
}

export { loadPdfFile };
