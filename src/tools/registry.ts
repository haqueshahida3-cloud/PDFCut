// Tool registry: every screen in the app is a tool. Plugins can add more with registerTool().
import { lazy, type ComponentType } from 'react';
import {
  Activity,
  BookOpen,
  Combine,
  GitCompare,
  History,
  Home,
  Layers,
  LayoutGrid,
  ListChecks,
  Minimize2,
  PenLine,
  RefreshCw,
  Replace,
  ScanText,
  Scissors,
  Settings,
  ShieldCheck,
  Stamp,
  Table,
  type LucideIcon,
} from 'lucide-react';

export type ToolGroup = 'start' | 'edit' | 'organize' | 'optimize' | 'secure' | 'automate' | 'system';
export const GROUP_ORDER: ToolGroup[] = ['start', 'organize', 'optimize', 'edit', 'secure', 'automate', 'system'];

export interface ToolDef {
  id: string;
  group: ToolGroup;
  icon: LucideIcon;
  keywords: string[];
  component: ComponentType;
}

export const TOOLS: ToolDef[] = [
  { id: 'home', group: 'start', icon: Home, keywords: ['start', 'dashboard'], component: lazy(() => import('./Home')) },
  { id: 'viewer', group: 'start', icon: BookOpen, keywords: ['read', 'view', 'reader', 'tabs', 'search', 'presentation'], component: lazy(() => import('./Viewer')) },
  { id: 'split', group: 'organize', icon: Scissors, keywords: ['cut', 'split', 'range', 'extract pages', 'bookmarks'], component: lazy(() => import('./Split')) },
  { id: 'merge', group: 'organize', icon: Combine, keywords: ['join', 'combine', 'merge'], component: lazy(() => import('./Merge')) },
  { id: 'pages', group: 'organize', icon: LayoutGrid, keywords: ['rotate', 'delete', 'reorder', 'crop', 'booklet', 'n-up', 'page', 'duplicate', 'blank', 'labels', 'orientation'], component: lazy(() => import('./PageEditor')) },
  { id: 'compress', group: 'optimize', icon: Minimize2, keywords: ['shrink', 'size', 'compress', 'optimize'], component: lazy(() => import('./Compress')) },
  { id: 'convert', group: 'optimize', icon: RefreshCw, keywords: ['image', 'png', 'jpg', 'word', 'text', 'markdown', 'convert'], component: lazy(() => import('./Convert')) },
  { id: 'ocr', group: 'optimize', icon: ScanText, keywords: ['ocr', 'text recognition', 'searchable', 'scan'], component: lazy(() => import('./Ocr')) },
  { id: 'extract', group: 'optimize', icon: Table, keywords: ['text', 'csv', 'table', 'attachments', 'fonts'], component: lazy(() => import('./Extract')) },
  { id: 'compare', group: 'optimize', icon: GitCompare, keywords: ['diff', 'compare', 'changes'], component: lazy(() => import('./Compare')) },
  { id: 'annotate', group: 'edit', icon: PenLine, keywords: ['highlight', 'sign', 'redact', 'draw', 'note', 'annotate', 'text'], component: lazy(() => import('./Annotate')) },
  { id: 'replace', group: 'edit', icon: Replace, keywords: ['find', 'replace', 'search', 'text', 'edit'], component: lazy(() => import('./Replace')) },
  { id: 'forms', group: 'edit', icon: ListChecks, keywords: ['form', 'fields', 'fillable', 'acroform', 'flatten', 'checkbox'], component: lazy(() => import('./Forms')) },
  { id: 'stamp', group: 'edit', icon: Stamp, keywords: ['watermark', 'header', 'footer', 'bates', 'page numbers'], component: lazy(() => import('./Stamp')) },
  { id: 'security', group: 'secure', icon: ShieldCheck, keywords: ['password', 'encrypt', 'metadata', 'permissions', 'repair', 'clean', 'linearize', 'accessibility'], component: lazy(() => import('./Security')) },
  { id: 'batch', group: 'automate', icon: Layers, keywords: ['batch', 'workflow', 'macro', 'preset', 'chain'], component: lazy(() => import('./Batch')) },
  { id: 'automation', group: 'automate', icon: History, keywords: ['naming', 'duplicate', 'history', 'retry', 'schedule', 'watch', 'rules'], component: lazy(() => import('./Automation')) },
  { id: 'settings', group: 'system', icon: Settings, keywords: ['theme', 'language', 'wallpaper', 'font', 'backup'], component: lazy(() => import('./Settings')) },
  { id: 'diagnostics', group: 'system', icon: Activity, keywords: ['benchmark', 'performance', 'logs', 'memory', 'report'], component: lazy(() => import('./Diagnostics')) },
];

const plugins: ToolDef[] = [];

/** Plugin API: register an additional tool. Ids must be unique. */
export function registerTool(def: ToolDef): void {
  if (!allTools().some((t) => t.id === def.id)) plugins.push(def);
}

export function allTools(): ToolDef[] {
  return [...TOOLS, ...plugins];
}

export function findTool(id: string): ToolDef | undefined {
  return allTools().find((t) => t.id === id);
}
