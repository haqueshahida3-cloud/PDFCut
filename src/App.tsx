// Application root: layout shell, route transitions (opacity + transform only), global keyboard shortcuts,
// theme wiring and the status bar. Tools are lazy-loaded on first visit.
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Suspense, useEffect } from 'react';
import { StatusBar } from './components/StatusBar';
import {
  CommandPalette,
  DropOverlay,
  JobsDock,
  LowEndBanner,
  OnboardingModal,
  ShortcutsModal,
  Sidebar,
  TitleBar,
  ViewSkeleton,
  Wallpaper,
} from './components/Shell';
import { ToastHost } from './components/ui';
import { navigate, useApp } from './store/app';
import { useSettings } from './store/settings';
import { watchTheme } from './themes/themes';
import { findTool } from './tools/registry';

export default function App() {
  const route = useApp((s) => s.route);
  const reduce = useSettings((s) => s.reduceMotion || s.performanceMode || !s.animations);
  const def = findTool(route) ?? findTool('home');
  const Screen = def?.component;

  useEffect(() => watchTheme(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      const key = e.key.toLowerCase();
      if (mod && key === 'k') {
        e.preventDefault();
        useApp.setState((s) => ({ paletteOpen: !s.paletteOpen }));
      } else if (mod && key === ',') {
        e.preventDefault();
        navigate('settings');
      } else if (mod && key === 'o') {
        e.preventDefault();
        navigate('viewer');
        window.dispatchEvent(new Event('pdfcut:open-file'));
      } else if (mod && key === 'p') {
        e.preventDefault();
        window.dispatchEvent(new Event('pdfcut:print'));
      } else if (mod && key === 'z' && !typing) {
        e.preventDefault();
        window.dispatchEvent(new Event(e.shiftKey ? 'pdfcut:redo' : 'pdfcut:undo'));
      } else if (mod && key === 'y' && !typing) {
        e.preventDefault();
        window.dispatchEvent(new Event('pdfcut:redo'));
      } else if (e.key === '?' && !typing) {
        useApp.setState({ shortcutsOpen: true });
      } else if (e.key === 'Escape') {
        useApp.setState({ paletteOpen: false, shortcutsOpen: false });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <MotionConfig reducedMotion={reduce ? 'always' : 'user'}>
      <div className="fixed inset-0 flex flex-col bg-bg text-fg">
        <Wallpaper />
        <TitleBar />
        <div className="relative z-10 flex min-h-0 flex-1">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <main id="main" className="relative min-w-0 flex-1 overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={def?.id ?? route}
                  className="h-full"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.16 }}
                >
                  <Suspense fallback={<ViewSkeleton />}>{Screen && <Screen />}</Suspense>
                </motion.div>
              </AnimatePresence>
            </main>
            <StatusBar />
          </div>
        </div>
        <LowEndBanner />
        <ToastHost />
        <JobsDock />
        <CommandPalette />
        <ShortcutsModal />
        <OnboardingModal />
        <DropOverlay />
      </div>
    </MotionConfig>
  );
}
