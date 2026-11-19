// App-level state: navigation, toasts, recent files (bytes in IndexedDB, up to a size cap), pinned tools,
// saved workflows, reading progress and the open-tab workspace that is restored after navigation.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { kvDel, kvGet, kvSet, uid } from '../lib/util';

export type WorkflowStep =
  | { kind: 'lossless' }
  | { kind: 'clean' }
  | { kind: 'rotate'; deg: number }
  | { kind: 'watermark'; text: string }
  | { kind: 'footer'; template: string }
  | { kind: 'compress'; scale: number; quality: number };

export interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
}

export interface RecentFile {
  id: string;
  name: string;
  size: number;
  pages: number;
  openedAt: number;
  favorite: boolean;
  tags: string[];
  stored: boolean;
}

export interface WorkspaceTab {
  recentId: string;
  name: string;
  size: number;
}

export interface Toast {
  id: string;
  kind: 'success' | 'error' | 'info';
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  duration: number;
}

interface AppState {
  route: string;
  recents: RecentFile[];
  pinned: string[];
  workflows: Workflow[];
  progress: Record<string, number>;
  openTabs: WorkspaceTab[];
  toasts: Toast[];
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  pending: File[];
  /** Tool that should receive the pending files (viewer, split, merge, compress). */
  pendingTool: string;
}

/** Files above this size are listed in Recent but are not copied into IndexedDB, so they cannot be reopened. */
export const MAX_STORED_BYTES = 150 * 1024 * 1024;

export const useApp = create<AppState>()(
  persist(
    (): AppState => ({
      route: 'home',
      recents: [],
      pinned: ['split', 'merge', 'compress', 'pages'],
      workflows: [],
      progress: {},
      openTabs: [],
      toasts: [],
      paletteOpen: false,
      shortcutsOpen: false,
      pending: [],
      pendingTool: 'viewer',
    }),
    {
      name: 'pdfcut-app',
      partialize: (s) => ({
        recents: s.recents,
        pinned: s.pinned,
        workflows: s.workflows,
        progress: s.progress,
        openTabs: s.openTabs,
      }),
    },
  ),
);

export function navigate(route: string): void {
  useApp.setState({ route, paletteOpen: false });
}

export function toast(t: Omit<Toast, 'id' | 'duration'> & { duration?: number }): string {
  const id = uid();
  const full: Toast = { duration: 4500, ...t, id };
  useApp.setState((s) => ({ toasts: [...s.toasts.slice(-3), full] }));
  return id;
}

export function dismissToast(id: string): void {
  useApp.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function setPending(files: File[], tool = 'viewer'): void {
  useApp.setState({ pending: files, pendingTool: tool });
}

/** Returns pending files only for the tool they were meant for, and clears them. */
export function takePending(tool = 'viewer'): File[] {
  const state = useApp.getState();
  if (state.pending.length === 0 || state.pendingTool !== tool) return [];
  useApp.setState({ pending: [] });
  return state.pending;
}

export function togglePin(id: string): void {
  useApp.setState((s) => ({
    pinned: s.pinned.includes(id) ? s.pinned.filter((p) => p !== id) : [...s.pinned, id],
  }));
}

/** Remembers a file: metadata in localStorage, bytes in IndexedDB when under the size cap. Keeps 30 entries. */
export async function addRecent(name: string, size: number, pages: number, bytes: Uint8Array): Promise<string> {
  const id = uid();
  const stored = bytes.length <= MAX_STORED_BYTES;
  if (stored) {
    try {
      await kvSet(`file:${id}`, bytes);
    } catch {
      // Storage is full: the file is still listed, but it cannot be reopened later.
    }
  }
  const state = useApp.getState();
  const entry: RecentFile = { id, name, size, pages, openedAt: Date.now(), favorite: false, tags: [], stored };
  const kept = [entry, ...state.recents.filter((r) => !(r.name === name && r.size === size))].slice(0, 30);
  useApp.setState({ recents: kept });
  // Anything no longer listed (evicted or replaced) must not keep its bytes in IndexedDB.
  for (const r of state.recents) {
    if (!kept.some((k) => k.id === r.id)) void kvDel(`file:${r.id}`).catch(() => undefined);
  }
  return id;
}

export function updateRecent(id: string, p: Partial<RecentFile>): void {
  useApp.setState((s) => ({ recents: s.recents.map((r) => (r.id === id ? { ...r, ...p } : r)) }));
}

export function removeRecent(id: string): void {
  useApp.setState((s) => ({ recents: s.recents.filter((r) => r.id !== id) }));
  void kvDel(`file:${id}`).catch(() => undefined);
}

export async function loadRecentBytes(id: string): Promise<Uint8Array | undefined> {
  return kvGet<Uint8Array>(`file:${id}`);
}

/** Writes reading progress only when the page actually changes (scrolling fires this often). */
export function setReadingPage(key: string, page: number): void {
  if (useApp.getState().progress[key] === page) return;
  useApp.setState((s) => ({ progress: { ...s.progress, [key]: page } }));
}

export function setOpenTabs(tabs: WorkspaceTab[]): void {
  useApp.setState({ openTabs: tabs });
}

export function saveWorkflow(w: Workflow): void {
  useApp.setState((s) => ({
    workflows: s.workflows.some((x) => x.id === w.id)
      ? s.workflows.map((x) => (x.id === w.id ? w : x))
      : [...s.workflows, w],
  }));
}

export function deleteWorkflow(id: string): void {
  useApp.setState((s) => ({ workflows: s.workflows.filter((w) => w.id !== id) }));
}
