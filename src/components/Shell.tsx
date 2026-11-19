// App chrome: custom title bar, collapsible sidebar, command palette (Ctrl+K), shortcut sheet,
// onboarding tour, background-task dock, global drag-and-drop, wallpaper and low-end hint.
import { AnimatePresence, motion } from 'framer-motion';
import {
  Gauge,
  Keyboard,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings as SettingsIcon,
  Square,
  Sun,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cancelJob, clearFinishedJobs, pauseJob, resumeJob, setQueuePaused, useJobs, type Job } from '../store/jobs';
import { navigate, setPending, toast, useApp } from '../store/app';
import { resetSettings, setSettings, useSettings } from '../store/settings';
import { WALLPAPERS } from '../themes/themes';
import { GROUP_ORDER, TOOLS, allTools, type ToolDef } from '../tools/registry';
import { isLowEndDevice, formatDuration } from '../lib/util';
import { isDesktop } from '../lib/desktop';
import { cn } from '../utils/cn';
import { Button, Kbd, Modal, ProgressBar } from './ui';

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="pdfcut-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#pdfcut-logo-g)" />
      <path d="M21 12h15l10 10v30H21z" fill="#fff" opacity="0.96" />
      <path d="M36 12v10h10" fill="none" stroke="#c4b5fd" strokeWidth="2" />
      <path d="M15 36h34" stroke="#fff" strokeWidth="2.5" strokeDasharray="4 3" />
      <circle cx="18" cy="36" r="3.5" fill="none" stroke="#fff" strokeWidth="2.5" />
      <circle cx="46" cy="36" r="3.5" fill="none" stroke="#fff" strokeWidth="2.5" />
    </svg>
  );
}

export function ViewSkeleton() {
  return (
    <div className="space-y-4 p-6" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-8 w-56 rounded-lg" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton h-28 rounded-card" />
        ))}
      </div>
    </div>
  );
}

export function Wallpaper() {
  const s = useSettings();
  const wp = WALLPAPERS.find((w) => w.id === s.wallpaper);
  const background = s.wallpaperImage ? `url(${s.wallpaperImage}) center / cover no-repeat` : wp?.css ?? 'none';
  if (!s.wallpaperImage && (!wp || wp.id === 'none')) return null;
  const animated = wp?.animated && !s.performanceMode && !s.reduceMotion && s.animations;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0 scale-105"
        style={{
          background,
          opacity: s.wallpaperOpacity / 100,
          filter: !s.performanceMode && s.wallpaperBlur > 0 ? `blur(${s.wallpaperBlur}px)` : undefined,
        }}
      />
      {animated && <div className="wallpaper-blob" />}
      <div className="absolute inset-0 bg-black" style={{ opacity: s.wallpaperDim / 100 }} />
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="btn btn-ghost btn-sm h-8 w-8 p-0">
      {children}
    </button>
  );
}

/** Minimize / maximize / close for the frameless desktop window. Not rendered in the browser. */
function WindowControls() {
  const bridge = window.pdfcut;
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    void bridge.window.isMaximized().then(setMaximized);
    return bridge.window.onMaximizeChange(setMaximized);
  }, [bridge]);
  if (!bridge) return null;
  return (
    <div className="ms-1 flex items-center gap-0.5 border-s border-line ps-2">
      <button type="button" className="win-btn" aria-label="Minimize window" title="Minimize" onClick={() => bridge.window.minimize()}>
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="win-btn"
        aria-label={maximized ? 'Restore window' : 'Maximize window'}
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => bridge.window.toggleMaximize()}
      >
        <Square className="h-3.5 w-3.5" />
      </button>
      <button type="button" className="win-btn win-close" aria-label="Close window" title="Close" onClick={() => bridge.window.close()}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function TitleBar() {
  const { t } = useTranslation();
  const jobsActive = useJobs((s) => s.jobs.filter((j) => j.status === 'running' || j.status === 'queued' || j.status === 'paused').length);
  const mode = document.documentElement.dataset.mode ?? 'light';
  return (
    <header className="app-titlebar glass relative z-20 flex h-12 shrink-0 select-none items-center gap-3 border-b border-line px-3">
      <div className="flex items-center gap-2">
        <Logo className="h-7 w-7" />
        <span className="font-semibold tracking-tight">{t('app.name')}</span>
      </div>
      <button
        type="button"
        onClick={() => useApp.setState({ paletteOpen: true })}
        className="input mx-auto flex max-w-md flex-1 items-center gap-2 text-start text-muted"
        aria-label={t('app.search')}
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate">{t('app.search')}</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <div className="flex items-center gap-1">
        {jobsActive > 0 && <span className="badge">{jobsActive}</span>}
        <IconBtn
          label="Toggle theme"
          onClick={() => setSettings({ themeMode: mode === 'light' ? 'dark' : 'light' })}
        >
          {mode === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </IconBtn>
        <IconBtn label={t('nav.help')} onClick={() => useApp.setState({ shortcutsOpen: true })}>
          <Keyboard className="h-4 w-4" />
        </IconBtn>
        <IconBtn label={t('nav.settings')} onClick={() => navigate('settings')}>
          <SettingsIcon className="h-4 w-4" />
        </IconBtn>
        {isDesktop() && <WindowControls />}
      </div>
    </header>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const route = useApp((s) => s.route);
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        'glass relative z-10 flex shrink-0 flex-col overflow-y-auto border-e border-line py-3 transition-[width] duration-200',
        collapsed ? 'w-16 px-2' : 'w-60 px-3',
      )}
    >
      {GROUP_ORDER.map((group) => {
        const items = TOOLS.filter((x) => x.group === group);
        if (items.length === 0) return null;
        return (
          <nav key={group} className="mb-2" aria-label={t(`nav.group.${group}`)}>
            {!collapsed && (
              <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t(`nav.group.${group}`)}
              </div>
            )}
            {items.map((tool) => (
              <NavItem key={tool.id} tool={tool} active={route === tool.id} collapsed={collapsed} label={t(`nav.${tool.id}`, { defaultValue: tool.id })} />
            ))}
          </nav>
        );
      })}
      <div className="mt-auto space-y-1 pt-2">
        <button
          type="button"
          onClick={() => setSettings({ sidebarCollapsed: !collapsed })}
          className={cn('btn btn-ghost w-full', collapsed ? 'justify-center px-0' : 'justify-start')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

function NavItem({ tool, active, collapsed, label }: { tool: ToolDef; active: boolean; collapsed: boolean; label: string }) {
  const Icon = tool.icon;
  return (
    <button
      type="button"
      onClick={() => navigate(tool.id)}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={cn(
        'relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
        active ? 'text-accent-fg' : 'text-fg hover:bg-line/60',
        collapsed && 'justify-center px-0',
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-xl bg-accent"
          transition={{ type: 'spring', stiffness: 520, damping: 40 }}
        />
      )}
      <Icon className="relative h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className={cn('relative truncate', collapsed && 'sr-only')}>{label}</span>
    </button>
  );
}

interface Command {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const { t } = useTranslation();
  const open = useApp((s) => s.paletteOpen);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const close = (): void => {
    useApp.setState({ paletteOpen: false });
  };

  const commands = useMemo<Command[]>(() => {
    const toolCmds: Command[] = allTools().map((tool) => {
      const Icon = tool.icon;
      return { id: tool.id, label: t(`nav.${tool.id}`, { defaultValue: tool.id }), icon: <Icon className="h-4 w-4" />, run: () => navigate(tool.id) };
    });
    return [
      ...toolCmds,
      { id: 'open', label: t('common.open'), icon: <Search className="h-4 w-4" />, run: () => { navigate('viewer'); window.dispatchEvent(new Event('pdfcut:open-file')); } },
      { id: 'theme', label: 'Toggle light / dark', icon: <Sun className="h-4 w-4" />, run: () => setSettings({ themeMode: document.documentElement.dataset.mode === 'light' ? 'dark' : 'light' }) },
      { id: 'perf', label: 'Toggle performance mode', icon: <Gauge className="h-4 w-4" />, run: () => setSettings({ performanceMode: !useSettings.getState().performanceMode }) },
      { id: 'shortcuts', label: t('nav.help'), icon: <Keyboard className="h-4 w-4" />, run: () => useApp.setState({ shortcutsOpen: true }) },
    ];
  }, [t]);

  const needle = q.trim().toLowerCase();
  const results = commands.filter((c) => c.label.toLowerCase().includes(needle) || c.id.includes(needle));

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
    }
  }, [open]);

  const runAt = (i: number): void => {
    const cmd = results[i];
    if (!cmd) return;
    close();
    cmd.run();
  };

  return (
    <Modal open={open} onClose={close} title={t('app.search')} width="max-w-xl">
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIdx((i) => Math.min(results.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIdx((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            runAt(idx);
          }
        }}
        placeholder={t('palette.placeholder')}
        className="input mb-3 w-full"
        aria-label={t('palette.placeholder')}
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
      />
      <ul id="palette-list" role="listbox" className="space-y-1">
        {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{t('palette.empty')}</li>}
        {results.map((c, i) => (
          <li key={c.id} role="option" aria-selected={i === idx}>
            <button
              type="button"
              onMouseEnter={() => setIdx(i)}
              onClick={() => runAt(i)}
              className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-sm', i === idx ? 'bg-accent text-accent-fg' : 'hover:bg-line/60')}
            >
              {c.icon}
              <span className="flex-1">{c.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-center text-xs text-muted">{t('palette.hint')}</p>
    </Modal>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl + K', 'Command palette'],
  ['Ctrl + O', 'Open a PDF'],
  ['Ctrl + ,', 'Settings'],
  ['Ctrl + Z / Ctrl + Shift + Z', 'Undo / redo (page editor, annotations)'],
  ['Ctrl + P', 'Print the current PDF'],
  ['← → / PageUp PageDown', 'Previous / next page (viewer)'],
  ['Ctrl + + / Ctrl + -', 'Zoom in / out (viewer)'],
  ['F', 'Focus mode (viewer)'],
  ['P', 'Presentation mode (viewer)'],
  ['Delete', 'Delete selected item (annotations)'],
  ['?', 'This cheat sheet'],
  ['Esc', 'Close dialogs and panels'],
];

export function ShortcutsModal() {
  const open = useApp((s) => s.shortcutsOpen);
  const close = (): void => {
    useApp.setState({ shortcutsOpen: false });
  };
  return (
    <Modal open={open} onClose={close} title="Keyboard shortcuts">
      <dl className="grid gap-2">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys} className="flex items-center justify-between gap-4 rounded-xl px-3 py-2 odd:bg-line/30">
            <dt className="text-sm">{what}</dt>
            <dd>
              <Kbd>{keys}</Kbd>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-muted">
        Everything runs on this computer. Files are never uploaded. Press <Kbd>?</Kbd> at any time to see this sheet.
      </p>
    </Modal>
  );
}

const TOUR = [
  { title: 'Welcome to PDFCut', text: 'Split, merge, compress, convert, OCR, annotate and secure PDFs. Free, private and offline.' },
  { title: 'Drop files anywhere', text: 'Drag a PDF onto any screen to open it in the viewer. Your files never leave this computer.' },
  { title: 'Work in the background', text: 'Long jobs run in the task dock. You can keep working, pause, resume or cancel them.' },
  { title: 'Make it yours', text: 'Pick a theme, wallpaper, language and motion settings in Settings. Press Ctrl+K to jump anywhere.' },
];

export function OnboardingModal() {
  const done = useSettings((s) => s.onboardingDone);
  const [step, setStep] = useState(0);
  const finish = (): void => setSettings({ onboardingDone: true });
  const last = step === TOUR.length - 1;
  return (
    <Modal
      open={!done}
      onClose={finish}
      title={TOUR[step].title}
      footer={
        <>
          <Button variant="ghost" onClick={finish}>
            Skip
          </Button>
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          <Button variant="primary" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? 'Finish' : 'Next'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">{TOUR[step].text}</p>
        <div className="flex justify-center gap-1.5" aria-label={`Step ${step + 1} of ${TOUR.length}`}>
          {TOUR.map((_, i) => (
            <span key={i} className={cn('h-1.5 rounded-full transition-all duration-300', i === step ? 'w-6 bg-accent' : 'w-1.5 bg-line')} />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function JobRow({ job }: { job: Job }) {
  const { t } = useTranslation();
  const active = job.status === 'running' || job.status === 'paused' || job.status === 'queued';
  const statusText: Record<Job['status'], string> = {
    queued: 'Waiting',
    running: job.message || 'Working',
    paused: 'Paused',
    done: 'Finished',
    error: job.error ?? 'Failed',
    cancelled: 'Cancelled',
  };
  return (
    <li className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate font-medium">{job.title}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted">{Math.round(job.progress * 100)}%</span>
      </div>
      <ProgressBar value={job.progress} indeterminate={job.status === 'queued'} />
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="truncate">{statusText[job.status]}</span>
        <span className="flex shrink-0 items-center gap-1">
          {job.eta !== undefined && job.status === 'running' && <span>{t('jobs.eta', { time: formatDuration(job.eta) })}</span>}
          {job.status === 'running' && (
            <button type="button" className="btn btn-ghost btn-sm h-6 px-2" onClick={() => pauseJob(job.id)}>
              {t('common.pause')}
            </button>
          )}
          {job.status === 'paused' && (
            <button type="button" className="btn btn-ghost btn-sm h-6 px-2" onClick={() => resumeJob(job.id)}>
              {t('common.resume')}
            </button>
          )}
          {active && (
            <button type="button" className="btn btn-ghost btn-sm h-6 px-2 text-red-500" onClick={() => cancelJob(job.id)}>
              Cancel
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

export function JobsDock() {
  const { t } = useTranslation();
  const jobs = useJobs((s) => s.jobs);
  const queuePaused = useJobs((s) => s.queuePaused);
  const now = Date.now();
  const visible = jobs.filter((j) => j.status !== 'done' || (j.finishedAt !== undefined && now - j.finishedAt < 8000));
  return (
    <AnimatePresence>
      {visible.length > 0 && (
        <motion.section
          key="dock"
          layout
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          aria-label={t('jobs.title')}
          className="glass fixed bottom-4 end-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-card p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">{t('jobs.title')}</span>
            <div className="flex gap-1">
              <button type="button" className="btn btn-ghost btn-sm h-6 px-2" onClick={() => setQueuePaused(!queuePaused)}>
                {queuePaused ? t('common.resume') : t('common.pause')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm h-6 px-2" onClick={clearFinishedJobs}>
                {t('jobs.clear')}
              </button>
            </div>
          </div>
          <ul className="max-h-72 space-y-3 overflow-auto">
            {visible.slice(0, 6).map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </ul>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

export function DropOverlay() {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const onLeave = (): void => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const onOver = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent): void => {
      depth = 0;
      setOver(false);
      if (e.defaultPrevented || !e.dataTransfer?.files.length) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
      if (pdfs.length === 0) {
        toast({ kind: 'info', title: 'Only PDF files open here', message: 'Use Convert to turn images or text into PDF.' });
        return;
      }
      setPending(pdfs);
      navigate('viewer');
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
  return (
    <AnimatePresence>
      {over && (
        <motion.div
          key="drop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-0 z-[55] grid place-items-center bg-accent/10 backdrop-blur-sm"
        >
          <div className="glass rounded-card px-8 py-6 text-lg font-semibold shadow-2xl">{t('drop.overlay')}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function LowEndBanner() {
  const s = useSettings();
  if (s.performanceMode || s.lowEndHintDismissed || !isLowEndDevice()) return null;
  return (
    <div className="glass fixed bottom-4 start-4 z-40 flex max-w-md items-center gap-3 rounded-card px-4 py-3 text-sm shadow-lg">
      <Gauge className="h-4 w-4 text-accent" aria-hidden="true" />
      <span>This computer looks low-powered. Performance mode keeps things smooth.</span>
      <Button size="sm" variant="primary" onClick={() => setSettings({ performanceMode: true, lowEndHintDismissed: true })}>
        Enable
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setSettings({ lowEndHintDismissed: true })}>
        Later
      </Button>
    </div>
  );
}

export { resetSettings, X };
