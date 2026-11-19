// Find & replace. Matches are located with pdf.js. Each affected page is rasterized in the PDF worker with the
// match covered and the replacement drawn in its place, so the original text is removed from those pages.
import { Replace as ReplaceIcon } from 'lucide-react';
import { useState } from 'react';
import { residualCounts, findTextBoxes, type MatchBoxes } from '../lib/analyzer';
import { Button, Card, Dropzone, Field, Input, Toggle } from '../components/ui';
import { InlineJob, Page, loadPdfFile, outName } from '../components/Page';
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

export default function Replace() {
  const [file, setFile] = useState<Loaded | null>(null);
  const [find, setFind] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<MatchBoxes[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const total = matches?.reduce((n, m) => n + m.boxes.length, 0) ?? 0;

  const load = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (!f) return;
    try {
      const { bytes, doc } = await loadPdfFile(f);
      setFile({ name: f.name, size: f.size, bytes, doc });
      setMatches(null);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not open this PDF', message: errMessage(e) });
    }
  };

  const scan = async (): Promise<void> => {
    if (!file || !find.trim()) return;
    setScanning(true);
    try {
      setMatches(await findTextBoxes(file.doc, find, caseSensitive));
    } catch (e) {
      toast({ kind: 'error', title: 'Search failed', message: errMessage(e) });
    } finally {
      setScanning(false);
    }
  };

  const run = (): void => {
    if (!file || !matches || total === 0) return;
    const { bytes, name } = file;
    const pages = matches.length;
    const edits = matches.map((m) => ({ page: m.page, boxes: m.boxes.map((b) => ({ ...b, text: replacement })) }));
    const j = enqueue(`Replace in ${name}`, (job) => job.work<Uint8Array>('raster.replace', { bytes, edits }));
    setJobId(j.id);
    j.promise
      .then(async (out) => {
        const [left] = await residualCounts(out, [find], caseSensitive);
        downloadBlob(out, outName(name, '-replaced'));
        toast({
          kind: left === 0 ? 'success' : 'error',
          title: `Replaced ${total} match${total === 1 ? '' : 'es'} on ${pages} page${pages === 1 ? '' : 's'}`,
          message: left === 0 ? 'Verified: no matches remain in the text layer.' : `${left} match(es) still in the text layer; check the output.`,
          duration: 9000,
        });
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error && e.name === 'AbortError')) toast({ kind: 'error', title: 'Replacement failed', message: errMessage(e) });
      });
  };

  if (!file) {
    return (
      <Page title="Find & replace" desc="Replace visible text. Only the edited pages are rasterized, so their original text is removed." icon={<ReplaceIcon className="h-5 w-5" />}>
        <Dropzone accept="application/pdf,.pdf" title="Drop a PDF to search" onFiles={(f) => void load(f)} icon={<ReplaceIcon className="h-7 w-7" />} />
      </Page>
    );
  }

  return (
    <Page title="Find & replace" desc={`${file.name} · ${file.doc.numPages} pages`} icon={<ReplaceIcon className="h-5 w-5" />} actions={<Button variant="ghost" onClick={() => setFile(null)}>Choose another</Button>}>
      <Card className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Find">
            <Input value={find} onChange={(e) => { setFind(e.target.value); setMatches(null); }} placeholder="Text to find" aria-label="Text to find" />
          </Field>
          <Field label="Replace with">
            <Input value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Replacement text" aria-label="Replacement text" />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Toggle checked={caseSensitive} onChange={(v) => { setCaseSensitive(v); setMatches(null); }} label="Match case" />
          <span className="text-sm">Match case</span>
          <Button variant="secondary" onClick={() => void scan()} loading={scanning} disabled={!find.trim()}>
            Scan
          </Button>
          {matches && (
            <span className="text-sm text-muted">
              {total === 0 ? 'No matches found.' : `${total} match${total === 1 ? '' : 'es'} on ${matches.length} page${matches.length === 1 ? '' : 's'}`}
            </span>
          )}
          <Button variant="primary" className="ms-auto" onClick={run} disabled={!matches || total === 0 || jobId !== null && false}>
            Replace all and save
          </Button>
        </div>
        <p className="text-xs text-muted">
          Matches are found inside single text runs. A phrase split across lines or styles may not be found. Replacement text is drawn in a standard font, and the affected pages become image-only.
        </p>
      </Card>
      <InlineJob jobId={jobId} />
    </Page>
  );
}
