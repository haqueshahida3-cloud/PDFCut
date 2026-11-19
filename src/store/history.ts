// Operation history: every finished background job is recorded here (persisted in localStorage).
// Only metadata is stored, never file contents.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface HistoryEntry {
  id: string;
  title: string;
  status: 'done' | 'error' | 'cancelled';
  startedAt: number;
  finishedAt: number;
  error?: string;
}

interface HistoryState {
  entries: HistoryEntry[];
}

const MAX_ENTRIES = 200;

export const useHistory = create<HistoryState>()(
  persist((): HistoryState => ({ entries: [] }), { name: 'pdfcut-history', version: 1 }),
);

export function recordHistory(entry: HistoryEntry): void {
  useHistory.setState((s) => ({ entries: [entry, ...s.entries].slice(0, MAX_ENTRIES) }));
}

export function clearHistory(): void {
  useHistory.setState({ entries: [] });
}
