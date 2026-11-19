// Diagnostics: startup time, memory, UI frame rate, worker round-trip and render benchmarks
// against explicit targets, a log viewer, and a shareable diagnostic report.
import { Activity, Download, Gauge, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, Select } from '../components/ui';
import { Page } from '../components/Page';
import { openPdf } from '../lib/pdfjs';
import { renderPageTo } from '../lib/pdfjs';
import { downloadBlob, getLogs, heapInfo, isLowEndDevice, formatBytes, type LogEntry } from '../lib/util';
import { setSettings, useSettings } from '../store/settings';
import { enqueue } from '../store/jobs';
import { toast } from '../store/app';
import { cn } from '../utils/cn';

interface Bench {
  ping: number;
  create: number;
  load: number;
  render: number;
}

const TARGETS = {
  startup: 2000,
  ping: 100,
  render: 150,
  fps: 55,
};

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export default function Diagnostics() {
  const perf = useSettings((s) => s.performanceMode);
  const [startup, setStartup] = useState<number | null>(null);
  const [dcl, setDcl] = useState<number | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [bench, setBench] = useState<Bench | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(getLogs());
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all');
  const [heap, setHeap] = useState(heapInfo());
  const lowEnd = isLowEndDevice();

  useEffect(() => {
    const ready = performance.getEntriesByName('pdfcut:ready')[0];
    setStartup(ready ? Math.round(ready.startTime) : null);
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    setDcl(nav ? Math.round(nav.domContentLoadedEventEnd) : null);
    setHeap(heapInfo());
  }, []);

  const measureFps = (): void => {
    let frames = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      frames++;
      if (now - start < 2000) requestAnimationFrame(tick);
      else setFps(Math.round(frames / ((now - start) / 1000)));
    };
    requestAnimationFrame(tick);
  };

  const runBench = (): void => {
    setRunning(true);
    const j = enqueue('Benchmark', async (job) => {
      const t0 = performance.now();
      await job.work('ping', {});
      const ping = performance.now() - t0;
      const sample = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}: the quick brown fox jumps over the lazy dog 0123456789.`).join('\n');
      const t1 = performance.now();
      const bytes = await job.work<Uint8Array>('text.pdf', { text: sample, opts: { font: 'Helvetica', size: 10, paper: 'a4' } });
      const create = performance.now() - t1;
      const t2 = performance.now();
      const doc = await openPdf(bytes);
      const load = performance.now() - t2;
      const page = await doc.getPage(1);
      const canvas = document.createElement('canvas');
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t3 = performance.now();
        await renderPageTo(page, canvas, 1.5).promise;
        times.push(performance.now() - t3);
      }
      await doc.destroy();
      return { ping, create, load, render: median(times) } satisfies Bench;
    });
    j.promise
      .then((b) => {
        setBench(b);
        toast({ kind: 'success', title: 'Benchmark complete' });
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error && e.name === 'AbortError')) toast({ kind: 'error', title: 'Benchmark failed', message: String(e) });
      })
      .finally(() => setRunning(false));
  };

  const exportReport = (): void => {
    const s = useSettings.getState();
    const report = {
      app: 'PDFCut',
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      language: navigator.language,
      cores: navigator.hardwareConcurrency,
      deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      lowEndDevice: lowEnd,
      metrics: { firstFrameMs: startup, domContentLoadedMs: dcl, fps, heap, benchmark: bench },
      targets: TARGETS,
      settings: { ...s, wallpaperImage: s.wallpaperImage ? '[omitted]' : '' },
      logs: getLogs(),
    };
    downloadBlob(JSON.stringify(report, null, 2), 'pdfcut-diagnostics.json', 'application/json');
  };

  const rows: Array<{ label: string; value: string; ok: boolean | null; target: string }> = [
    { label: 'Startup (first frame)', value: startup === null ? 'n/a' : `${startup} ms`, ok: startup === null ? null : startup < TARGETS.startup, target: '< 2000 ms' },
    { label: 'UI frame rate', value: fps === null ? 'Measure to see' : `${fps} FPS`, ok: fps === null ? null : fps >= TARGETS.fps, target: '≥ 55 FPS' },
    { label: 'Worker round-trip', value: bench ? `${Math.round(bench.ping)} ms` : 'Run benchmark', ok: bench ? bench.ping < TARGETS.ping : null, target: '< 100 ms' },
    { label: 'Page render (A4, 1.5×)', value: bench ? `${Math.round(bench.render)} ms` : 'Run benchmark', ok: bench ? bench.render < TARGETS.render : null, target: '< 150 ms' },
  ];

  const shown = logs.filter((l) => level === 'all' || (level === 'warn' ? l.level !== 'info' : l.level === 'error')).slice(-200).reverse();

  return (
    <Page title="Diagnostics" desc="Measure startup, rendering and background work. Share a report if something feels slow." icon={<Activity className="h-5 w-5" />}>
      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Gauge className="h-4 w-4" />} onClick={runBench} loading={running}>
              Run benchmark
            </Button>
            <Button variant="secondary" onClick={measureFps}>
              Measure frame rate (2 s)
            </Button>
            <Button variant="ghost" icon={<Download className="h-4 w-4" />} onClick={exportReport}>
              Export diagnostic report
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-start text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="py-2 text-start font-semibold">Metric</th>
                <th className="py-2 text-start font-semibold">Result</th>
                <th className="py-2 text-start font-semibold">Target</th>
                <th className="py-2 text-end font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="py-2.5">{r.label}</td>
                  <td className="py-2.5 tabular-nums">{r.value}</td>
                  <td className="py-2.5 text-muted">{r.target}</td>
                  <td className="py-2.5 text-end">
                    <span className={cn('badge', r.ok === false ? 'bg-red-500' : r.ok ? 'bg-emerald-500' : 'bg-line text-muted')}>
                      {r.ok === null ? '—' : r.ok ? 'Pass' : 'Slow'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {bench && (
            <p className="text-xs text-muted">
              Document creation in the worker: {Math.round(bench.create)} ms · open: {Math.round(bench.load)} ms. The benchmark runs as a background job.
            </p>
          )}
        </Card>

        <div className="space-y-5">
          <Card className="space-y-3">
            <div className="text-sm font-semibold">Memory and device</div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted">JS heap</dt>
              <dd className="tabular-nums">{heap ? `${formatBytes(heap.used)} / ${formatBytes(heap.limit)}` : 'Not reported by this browser'}</dd>
              <dt className="text-muted">Cores</dt>
              <dd>{navigator.hardwareConcurrency || 'unknown'}</dd>
              <dt className="text-muted">Low-end device</dt>
              <dd>{lowEnd ? 'Yes' : 'No'}</dd>
              <dt className="text-muted">Performance mode</dt>
              <dd>{perf ? 'On' : 'Off'}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={perf ? 'secondary' : 'primary'} onClick={() => setSettings({ performanceMode: !perf })}>
                {perf ? 'Turn off performance mode' : 'Turn on performance mode'}
              </Button>
              <Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setHeap(heapInfo())}>
                Refresh memory
              </Button>
            </div>
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Logs</div>
              <div className="flex items-center gap-2">
                <Select value={level} onChange={(e) => setLevel(e.target.value as typeof level)} aria-label="Log level" className="h-8 w-28">
                  <option value="all">All</option>
                  <option value="warn">Warnings+</option>
                  <option value="error">Errors</option>
                </Select>
                <Button size="sm" variant="ghost" onClick={() => setLogs(getLogs())}>
                  Refresh
                </Button>
              </div>
            </div>
            <ul className="max-h-72 space-y-1 overflow-auto font-mono text-xs">
              {shown.length === 0 && <li className="text-muted">No log entries.</li>}
              {shown.map((l, i) => (
                <li key={`${l.t}-${i}`} className={cn('rounded px-2 py-1', l.level === 'error' ? 'bg-red-500/10 text-red-600' : l.level === 'warn' ? 'bg-amber-500/10' : 'bg-line/30')}>
                  <span className="text-muted">{new Date(l.t).toLocaleTimeString()}</span> {l.msg}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}
