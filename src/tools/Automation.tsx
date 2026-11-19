// Automation: naming rules with a live preview, duplicate-file detection (SHA-256), the operation history with
// retry for failed jobs, and the command for scheduled folder processing.
import { Copy, History as HistoryIcon, RotateCw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, Dropzone, Field, Input } from '../components/ui';
import { Page } from '../components/Page';
import { sha256Hex } from '../lib/hash';
import { applyNamingRule } from '../lib/naming';
import { downloadBlob, formatDate } from '../lib/util';
import { toast } from '../store/app';
import { clearHistory, useHistory } from '../store/history';
import { canRetry, retryJob } from '../store/jobs';
import { cn } from '../utils/cn';

const SAMPLES = ['Invoice 2026.pdf', 'Scan 01.PDF', 'report: final?.pdf'];

interface Seen {
  name: string;
  size: number;
  hash: string;
}

export default function Automation() {
  const [rule, setRule] = useState('{name}-{op}-{date}');
  const [files, setFiles] = useState<Seen[]>([]);
  const [hashing, setHashing] = useState(false);
  const entries = useHistory((s) => s.entries);
  const preview = useMemo(() => {
    const now = new Date();
    return SAMPLES.map((name, i) => ({ name, out: applyNamingRule(rule, { name, op: 'clean', index: i + 1, date: now }) }));
  }, [rule]);

  const addFiles = async (list: File[]): Promise<void> => {
    setHashing(true);
    const added: Seen[] = [];
    for (const f of list) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      added.push({ name: f.name, size: f.size, hash: await sha256Hex(bytes) });
    }
    setFiles((prev) => [...prev, ...added]);
    setHashing(false);
  };

  const groups = useMemo(() => {
    const byHash = new Map<string, Seen[]>();
    for (const f of files) byHash.set(f.hash, [...(byHash.get(f.hash) ?? []), f]);
    return files.map((f) => {
      const same = byHash.get(f.hash) ?? [f];
      return { ...f, duplicateOf: same[0].name !== f.name || same[0].size !== f.size ? same[0].name : null, copies: same.length };
    });
  }, [files]);

  const retry = (id: string): void => {
    const next = retryJob(id);
    if (next) toast({ kind: 'info', title: 'Retrying the job' });
    else toast({ kind: 'error', title: 'This job cannot be retried', message: 'Only failures from this session can be retried.' });
  };

  return (
    <Page title="Automation" desc="Naming rules, duplicate detection, operation history, and scheduled processing." icon={<HistoryIcon className="h-5 w-5" />}>
      <Card className="space-y-4">
        <div className="text-sm font-semibold">Naming rule</div>
        <Field label="Pattern" hint="Tokens: {name} {op} {index} or {index:3} {date} (YYYY-MM-DD) {time} (HH-MM)">
          <Input value={rule} onChange={(e) => setRule(e.target.value)} className="max-w-md" aria-label="Naming rule" />
        </Field>
        <ul className="grid gap-1 text-sm sm:grid-cols-3">
          {preview.map((p) => (
            <li key={p.name} className="rounded-lg bg-line/30 px-3 py-2">
              <div className="truncate text-xs text-muted">{p.name}</div>
              <div className="truncate font-medium">→ {p.out}</div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">Characters that are not allowed in file names are replaced. Batch and folder runs use this rule.</p>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Duplicate files</div>
          <Button variant="ghost" size="sm" onClick={() => setFiles([])} disabled={files.length === 0} icon={<Trash2 className="h-4 w-4" />}>
            Clear list
          </Button>
        </div>
        <Dropzone multiple accept="application/pdf,.pdf" title={hashing ? 'Hashing…' : 'Drop PDFs to compare'} hint="Files are compared by content (SHA-256), so renamed copies are found too." onFiles={(f) => void addFiles(f)} compact />
        {groups.length > 0 && (
          <ul className="divide-y divide-line text-sm">
            {groups.map((g, i) => (
              <li key={`${g.hash}-${i}`} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{g.name}</span>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', g.copies > 1 && g.duplicateOf ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300')}>
                  {g.duplicateOf ? `Same as ${g.duplicateOf}` : g.copies > 1 ? `Original (${g.copies} copies)` : 'Unique'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Operation history</div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => downloadBlob(JSON.stringify(entries, null, 2), 'pdfcut-history.json', 'application/json')} disabled={entries.length === 0} icon={<Copy className="h-4 w-4" />}>
              Export JSON
            </Button>
            <Button variant="ghost" size="sm" onClick={clearHistory} disabled={entries.length === 0}>
              Clear
            </Button>
          </div>
        </div>
        {entries.length === 0 && <p className="text-sm text-muted">Finished background jobs appear here. The history stores titles and results only, never file contents.</p>}
        <ul className="max-h-80 divide-y divide-line overflow-auto text-sm">
          {entries.slice(0, 100).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate">{e.title}</span>
              <span className="text-xs text-muted">{formatDate(e.finishedAt)}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', e.status === 'done' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : e.status === 'error' ? 'bg-red-500/15 text-red-600 dark:text-red-300' : 'bg-line text-muted')}>
                {e.status}
              </span>
              {e.error && <span className="w-full truncate text-xs text-red-500">{e.error}</span>}
              {e.status === 'error' && canRetry(e.id) && (
                <Button size="sm" variant="secondary" onClick={() => retry(e.id)} icon={<RotateCw className="h-3.5 w-3.5" />}>
                  Retry
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3">
        <div className="text-sm font-semibold">Scheduled folder processing</div>
        <p className="text-sm text-muted">
          The command line watches a folder and processes new PDFs at an interval. Each run writes results to <code>processed/</code>, moves broken files to <code>failed/</code>, and skips files it has already handled.
        </p>
        <pre className="overflow-auto rounded-xl bg-line/40 p-3 text-xs">{`pdfcut watch ~/Scans --op clean --interval 300 --naming "{name}-{date}"
pdfcut watch ~/Scans --op split --every 10 --once`}</pre>
        <p className="text-xs text-muted">A scheduler inside the desktop window is not included yet. The command above works from the terminal and from any cron or systemd timer.</p>
      </Card>
    </Page>
  );
}
