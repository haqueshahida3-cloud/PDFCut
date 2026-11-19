// Desktop (Electron) integration for the renderer. In a normal browser every function here is a no-op.
// The preload script exposes window.pdfcut; this module turns its requests into app navigation.
import { toast, navigate, setPending } from '../store/app';
import { errMessage } from './util';
import { setThumbCacheLimit } from './caches';
import { setSettings, useSettings } from '../store/settings';

/** Machines with this much RAM or less get smaller caches and, on first run, performance mode. */
const LOW_MEMORY_MB = 4608;

export interface OpenRequest {
  /** Tool to open (split, merge, compress, viewer, ...) or null for the viewer. */
  tool: string | null;
  /** Absolute paths of PDFs to open. */
  paths: string[];
}

export interface AppInfo {
  totalMemMB?: number;
  cpus?: number;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  packaged: boolean;
}

export interface PdfcutBridge {
  isElectron: true;
  platform: string;
  launch(): Promise<OpenRequest[]>;
  onOpenRequest(callback: (request: OpenRequest) => void): () => void;
  readFile(path: string): Promise<Uint8Array>;
  info(): Promise<AppInfo>;
  integrate(): Promise<string[]>;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximizeChange(callback: (maximized: boolean) => void): () => void;
  };
}

declare global {
  interface Window {
    pdfcut?: PdfcutBridge;
  }
}

/** Tools that can take files directly from "Open with" or the file manager. */
const FILE_TOOLS = new Set(['split', 'merge', 'compress']);

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.pdfcut !== undefined;
}

export async function handleOpenRequest(request: OpenRequest): Promise<void> {
  const bridge = window.pdfcut;
  if (!bridge) return;
  const files: File[] = [];
  for (const path of request.paths) {
    const name = path.split(/[\\/]/).pop() || 'document.pdf';
    try {
      const bytes = await bridge.readFile(path);
      files.push(new File([new Uint8Array(bytes) as unknown as BlobPart], name, { type: 'application/pdf' }));
    } catch (e) {
      toast({ kind: 'error', title: `Could not open ${name}`, message: errMessage(e) });
    }
  }
  if (request.tool && FILE_TOOLS.has(request.tool)) {
    if (files.length > 0) setPending(files, request.tool);
    navigate(request.tool);
    return;
  }
  if (files.length > 0) {
    setPending(files, 'viewer');
    navigate('viewer');
    return;
  }
  if (request.tool) navigate(request.tool);
}

/** Call once at startup. Marks the document so CSS can draw the custom title bar. */
export async function initDesktop(): Promise<void> {
  const bridge = window.pdfcut;
  if (!bridge) return;
  const root = document.documentElement;
  root.dataset.desktop = 'true';
  root.dataset.platform = bridge.platform;
  const info = await bridge.info();
  if (info.totalMemMB !== undefined && info.totalMemMB <= LOW_MEMORY_MB) {
    setThumbCacheLimit(150);
    if (!useSettings.getState().onboardingDone) setSettings({ performanceMode: true });
  }
  bridge.onOpenRequest((request) => {
    void handleOpenRequest(request);
  });
  const requests = await bridge.launch();
  for (const request of requests) await handleOpenRequest(request);
}
