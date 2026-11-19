// Bottom status bar: current view, background work, memory, and the privacy and performance state.
import { Loader2, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatBytes, heapInfo } from '../lib/util';
import { useApp } from '../store/app';
import { useJobs } from '../store/jobs';
import { useSettings } from '../store/settings';

export function StatusBar() {
  const { t, i18n } = useTranslation();
  const route = useApp((s) => s.route);
  const active = useJobs((s) => s.jobs.filter((j) => j.status === 'running' || j.status === 'queued' || j.status === 'paused').length);
  const perf = useSettings((s) => s.performanceMode);
  const heap = heapInfo();
  return (
    <footer role="contentinfo" className="glass relative z-20 flex h-7 shrink-0 items-center gap-4 border-t border-line px-3 text-xs text-muted">
      <span className="font-medium text-fg">{t(`nav.${route}`, { defaultValue: route })}</span>
      {active > 0 && (
        <span className="flex items-center gap-1" role="status">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          {active} background task{active === 1 ? '' : 's'}
        </span>
      )}
      <span className="ms-auto flex items-center gap-1">
        <Lock className="h-3 w-3" aria-hidden="true" />
        Offline · files stay on this computer
      </span>
      {perf && <span>Performance mode</span>}
      {heap && <span className="tabular-nums">JS heap {formatBytes(heap.used)}</span>}
      <span className="uppercase">{i18n.language}</span>
    </footer>
  );
}
