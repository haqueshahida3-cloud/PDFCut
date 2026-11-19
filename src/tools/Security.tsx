// Security: metadata editor, safe-share cleaning, AES-256 password protection and permissions,
// password removal, repair and web optimization. Encryption and repair use qpdf compiled to WebAssembly.
import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, Dropzone, Field, Input, Select, Toggle } from '../components/ui';
import { InlineJob, Page, loadPdfFile, outName } from '../components/Page';
import { readAttachments, readInfo, type PdfDoc } from '../lib/pdfjs';
import { sampleTextAndBookmarks } from '../lib/analyzer';
import { evaluateAccessibility, type A11yCheck, type StructureFacts } from '../lib/pdf/a11y';
import { downloadBlob, errMessage } from '../lib/util';
import { toast } from '../store/app';
import { enqueue, type JobCtx } from '../store/jobs';

const FIELDS = [
  ['title', 'Title'],
  ['author', 'Author'],
  ['subject', 'Subject'],
  ['keywords', 'Keywords (comma separated)'],
  ['creator', 'Creator'],
  ['producer', 'Producer'],
] as const;

type MetaKey = (typeof FIELDS)[number][0];

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

function AccessibilityCard({ file }: { file: { bytes: Uint8Array; doc: PdfDoc | null } }) {
  const [checks, setChecks] = useState<A11yCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (): void => {
    const doc = file.doc;
    if (!doc) return;
    setBusy(true);
    const job = enqueue('Accessibility check', (ctx) => ctx.work<StructureFacts>('a11y.structure', { bytes: file.bytes }));
    job.promise
      .then(async (facts) => {
        const sample = await sampleTextAndBookmarks(doc);
        setChecks(evaluateAccessibility({ ...facts, ...sample }));
      })
      .catch((e: unknown) => toast({ kind: 'error', title: 'Accessibility check failed', message: errMessage(e) }))
      .finally(() => setBusy(false));
  };
  const tone = { pass: 'bg-emerald-500', warn: 'bg-amber-500', fail: 'bg-red-500' } as const;
  return (
    <Card className="space-y-3 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Accessibility checker</div>
          <p className="text-xs text-muted">
            Automated checks for title, language, tagging, bookmarks and selectable text. Passing them does not guarantee WCAG or PDF/UA conformance.
          </p>
        </div>
        <Button onClick={run} loading={busy} disabled={!file.doc}>
          Run check
        </Button>
      </div>
      {checks && (
        <ul className="divide-y divide-line">
          {checks.map((c) => (
            <li key={c.id} className="flex items-start gap-3 py-2 text-sm">
              <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-white ${tone[c.status]}`}>{c.status}</span>
              <div>
                <div className="font-medium">{c.label}</div>
                <div className="text-xs text-muted">{c.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function Security() {
  const [file, setFile] = useState<{ name: string; size: number; bytes: Uint8Array; doc: PdfDoc | null } | null>(null);
  const [meta, setMeta] = useState<Record<MetaKey, string>>({ title: '', author: '', subject: '', keywords: '', creator: '', producer: '' });
  const [attachments, setAttachments] = useState(0);
  const [userPw, setUserPw] = useState('');
  const [ownerPw, setOwnerPw] = useState('');
  const [canPrint, setCanPrint] = useState(true);
  const [canCopy, setCanCopy] = useState(true);
  const [canModify, setCanModify] = useState(false);
  const [removePw, setRemovePw] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);

  const wasmUrl = new URL(`${import.meta.env.BASE_URL}wasm/qpdf.wasm`, window.location.href).href;

  useEffect(() => {
    if (!file?.doc) return;
    const doc = file.doc;
    let alive = true;
    void readInfo(doc).then((info) => {
      if (!alive) return;
      setMeta({
        title: info.Title ?? '',
        author: info.Author ?? '',
        subject: info.Subject ?? '',
        keywords: info.Keywords ?? '',
        creator: info.Creator ?? '',
        producer: info.Producer ?? '',
      });
    });
    void readAttachments(doc).then((a) => {
      if (alive) setAttachments(a.length);
    });
    return () => {
      alive = false;
    };
  }, [file]);

  const load = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (!f) return;
    try {
      const { bytes, doc } = await loadPdfFile(f);
      setFile({ name: f.name, size: f.size, bytes, doc });
    } catch (e) {
      // Encrypted files cannot be previewed without their password, but qpdf can still process them.
      const message = errMessage(e);
      if (/password/i.test(message)) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        setFile({ name: f.name, size: f.size, bytes, doc: null });
        toast({ kind: 'info', title: 'Password-protected file', message: 'Use “Remove password” below to unlock it.' });
      } else toast({ kind: 'error', title: 'Could not open this PDF', message });
    }
  };

  const start = (title: string, run: (bytes: Uint8Array, job: JobCtx) => Promise<Uint8Array>, suffix: string): void => {
    if (!file) return;
    const { bytes, name } = file;
    const j = enqueue(title, (job) => run(bytes, job));
    setJobId(j.id);
    j.promise
      .then((out) => {
        downloadBlob(out, outName(name, suffix));
        toast({ kind: 'success', title: `${title} finished`, message: outName(name, suffix) });
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) toast({ kind: 'error', title: `${title} failed`, message: errMessage(e) });
      });
  };

  const runQpdf = (title: string, args: string[], suffix: string): void =>
    start(title, (bytes, job) => job.work<Uint8Array>('qpdf', { bytes, args, wasmUrl }), suffix);

  if (!file) {
    return (
      <Page title="Security" desc="Metadata, safe sharing, passwords, permissions and repair." icon={<ShieldCheck className="h-5 w-5" />}>
        <Dropzone accept="application/pdf,.pdf" title="Drop a PDF to secure" onFiles={(f) => void load(f)} icon={<ShieldCheck className="h-7 w-7" />} />
      </Page>
    );
  }

  const encryptArgs = [
    '--encrypt',
    userPw,
    ownerPw || userPw,
    '256',
    canPrint ? '--print=full' : '--print=none',
    canCopy ? '--extract=y' : '--extract=n',
    canModify ? '--modify=all' : '--modify=none',
    '--',
  ];

  return (
    <Page
      title="Security"
      desc={`${file.name} · everything runs on this computer`}
      icon={<ShieldCheck className="h-5 w-5" />}
      actions={
        <Button variant="ghost" onClick={() => setFile(null)}>
          Choose another
        </Button>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-3 lg:col-span-2">
          <div className="text-sm font-semibold">Metadata editor</div>
          {!file.doc && <p className="text-xs text-muted">Unlock the file first to edit its metadata.</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {FIELDS.map(([k, label]) => (
              <Field key={k} label={label}>
                <Input value={meta[k]} onChange={(e) => setMeta((m) => ({ ...m, [k]: e.target.value }))} disabled={!file.doc} />
              </Field>
            ))}
          </div>
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={!file.doc}
              onClick={() => start('Save metadata', (bytes, job) => job.work<Uint8Array>('metadata.set', { bytes, meta }), '-metadata')}
            >
              Save as new file
            </Button>
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="text-sm font-semibold">Safe share</div>
          <p className="text-sm text-muted">
            Creates a copy without metadata, annotations, comments, attachments, scripts or XMP history. Attachments found: {attachments}.
          </p>
          <Button
            onClick={() => start('Safe share copy', (bytes, job) => job.work<Uint8Array>('clean', { bytes }), '-shared')}
          >
            Create safe copy
          </Button>
        </Card>

        <Card className="space-y-3">
          <div className="text-sm font-semibold">Repair and web optimization</div>
          <p className="text-sm text-muted">Repair rewrites damaged cross-references. Web optimization (linearize) lets pages open before the whole file downloads.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => runQpdf('Repair', [], '-repaired')}>Repair</Button>
            <Button onClick={() => runQpdf('Optimize for web', ['--linearize'], '-web')}>Optimize for web</Button>
          </div>
        </Card>

        <Card className="space-y-4 lg:col-span-2">
          <div className="text-sm font-semibold">Password protection (AES-256)</div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Open password" hint="Required to open the file. Leave empty to only restrict permissions.">
              <Input type="password" value={userPw} onChange={(e) => setUserPw(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Owner password" hint="Required to change permissions. Defaults to the open password.">
              <Input type="password" value={ownerPw} onChange={(e) => setOwnerPw(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex items-center justify-between gap-2 text-sm">
              Allow printing <Toggle checked={canPrint} onChange={setCanPrint} label="Allow printing" />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm">
              Allow copying text <Toggle checked={canCopy} onChange={setCanCopy} label="Allow copying text" />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm">
              Allow editing <Toggle checked={canModify} onChange={setCanModify} label="Allow editing" />
            </label>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" disabled={!userPw && !ownerPw && canPrint && canCopy && !canModify} onClick={() => runQpdf('Password protection', encryptArgs, '-protected')}>
              Protect and download
            </Button>
          </div>
        </Card>

        <Card className="space-y-3 lg:col-span-2">
          <div className="text-sm font-semibold">Remove password</div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Current password">
              <Input type="password" value={removePw} onChange={(e) => setRemovePw(e.target.value)} autoComplete="current-password" className="w-72" />
            </Field>
            <Button onClick={() => runQpdf('Remove password', [`--password=${removePw}`, '--decrypt'], '-unlocked')} disabled={!removePw}>
              Remove password
            </Button>
          </div>
        </Card>

        <AccessibilityCard file={file} />
        <Card className="space-y-2 lg:col-span-2">
          <div className="text-sm font-semibold">Digital signatures</div>
          <p className="text-sm text-muted">
            Signing with a PKCS#12 certificate and verifying signatures need OpenSSL and a desktop build. They are not included in this web version, so PDFCut will not pretend to sign documents.
          </p>
          <Select disabled aria-label="Certificate" className="max-w-xs">
            <option>Not available in this build</option>
          </Select>
        </Card>
      </div>
      <InlineJob jobId={jobId} />
    </Page>
  );
}
