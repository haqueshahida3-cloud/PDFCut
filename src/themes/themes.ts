// Themes: light / dark / AMOLED / system (with night schedule), 20 accent palettes,
// a custom theme editor (JSON import/export), and built-in wallpapers.
import { useSettings, type CustomTheme, type Settings } from '../store/settings';

export interface ColorTheme {
  id: string;
  name: string;
  accent: string;
}

export const COLOR_THEMES: ColorTheme[] = [
  { id: 'indigo', name: 'Indigo', accent: '#4f46e5' },
  { id: 'blue', name: 'Ocean blue', accent: '#3b82f6' },
  { id: 'sky', name: 'Sky', accent: '#0ea5e9' },
  { id: 'cyan', name: 'Cyan', accent: '#06b6d4' },
  { id: 'teal', name: 'Teal', accent: '#14b8a6' },
  { id: 'emerald', name: 'Emerald', accent: '#10b981' },
  { id: 'green', name: 'Forest', accent: '#22c55e' },
  { id: 'lime', name: 'Lime', accent: '#84cc16' },
  { id: 'amber', name: 'Amber', accent: '#f59e0b' },
  { id: 'orange', name: 'Orange', accent: '#f97316' },
  { id: 'coral', name: 'Coral', accent: '#ff6b6b' },
  { id: 'red', name: 'Crimson', accent: '#ef4444' },
  { id: 'rose', name: 'Rose', accent: '#f43f5e' },
  { id: 'pink', name: 'Pink', accent: '#ec4899' },
  { id: 'fuchsia', name: 'Fuchsia', accent: '#d946ef' },
  { id: 'purple', name: 'Purple', accent: '#a855f7' },
  { id: 'violet', name: 'Violet', accent: '#8b5cf6' },
  { id: 'slate', name: 'Slate', accent: '#64748b' },
  { id: 'stone', name: 'Stone', accent: '#78716c' },
  { id: 'mint', name: 'Mint', accent: '#5eead4' },
];

export interface Wallpaper {
  id: string;
  name: string;
  css: string;
  animated?: boolean;
}

export const WALLPAPERS: Wallpaper[] = [
  { id: 'none', name: 'None', css: 'none' },
  { id: 'aurora', name: 'Aurora', css: 'linear-gradient(135deg,#0f2027,#203a43 50%,#2c5364)', animated: true },
  { id: 'sunset', name: 'Sunset', css: 'linear-gradient(160deg,#ff9a9e 0%,#fad0c4 60%,#fbc2eb 100%)' },
  { id: 'ocean', name: 'Ocean', css: 'linear-gradient(180deg,#2193b0,#6dd5ed)' },
  { id: 'forest', name: 'Forest', css: 'linear-gradient(160deg,#134e5e,#71b280)' },
  { id: 'dunes', name: 'Dunes', css: 'linear-gradient(170deg,#f6d365,#fda085)', animated: true },
  {
    id: 'nebula',
    name: 'Nebula',
    css: 'radial-gradient(circle at 20% 20%,#7f00ff55,transparent 40%),radial-gradient(circle at 80% 60%,#e100ff44,transparent 45%),#0b0320',
    animated: true,
  },
  { id: 'mint', name: 'Mint', css: 'linear-gradient(135deg,#d4fc79,#96e6a1)' },
  { id: 'paper', name: 'Paper dots', css: 'radial-gradient(#cbd5e1 1px,transparent 1px) 0 0/18px 18px #f8fafc' },
  {
    id: 'blueprint',
    name: 'Blueprint',
    css: 'linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px) 0 0/32px 32px,linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px) 0 0/32px 32px,#0b3d91',
  },
];

type Mode = 'light' | 'dark' | 'amoled';

const PALETTES: Record<Mode, { bg: string; surface: string; text: string; muted: string; line: string; scheme: string }> = {
  // Muted text is darkened to meet WCAG AA contrast on both the page and the surface.
  light: { bg: '#f4f5f9', surface: '#ffffff', text: '#0f172a', muted: '#556070', line: '#e2e8f0', scheme: 'light' },
  // Dark workspace: deeper background so document pages and panels stand out.
  dark: { bg: '#0b0d12', surface: '#141821', text: '#e6e8ee', muted: '#9aa3b5', line: '#252b38', scheme: 'dark' },
  amoled: { bg: '#000000', surface: '#0b0b0e', text: '#f2f3f5', muted: '#9ca3af', line: '#1c1f26', scheme: 'dark' },
};

const FONTS: Record<Settings['fontFamily'], string> = {
  system:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Arabic", "Noto Sans Bengali", "Noto Sans Devanagari", sans-serif',
  serif: 'Georgia, "Noto Serif", "Noto Naskh Arabic", serif',
  mono: 'ui-monospace, "JetBrains Mono", "Noto Sans Mono", monospace',
  rounded: 'ui-rounded, "Nunito", system-ui, sans-serif',
};

export function resolveMode(s: Settings, now: Date = new Date()): Mode {
  const systemDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (s.themeMode === 'light' || s.themeMode === 'dark' || s.themeMode === 'amoled') return s.themeMode;
  const h = now.getHours();
  if (s.scheduleDark) {
    const inNight = s.darkFrom > s.darkTo ? h >= s.darkFrom || h < s.darkTo : h >= s.darkFrom && h < s.darkTo;
    if (inNight) return 'dark';
  }
  return systemDark ? 'dark' : 'light';
}

function contrastText(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(n)) return '#ffffff';
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0b0b0f' : '#ffffff';
}

export function accentFor(s: Settings): string {
  if (s.themeId === 'custom') return s.custom.accent;
  return COLOR_THEMES.find((t) => t.id === s.themeId)?.accent ?? '#6366f1';
}

/** Writes CSS variables and data-attributes on <html>. Cheap enough to call on every change. */
export function applyTheme(s: Settings): void {
  const root = document.documentElement;
  const mode = resolveMode(s);
  const pal = PALETTES[mode];
  const useCustom = s.themeId === 'custom' && mode !== 'amoled';
  const c: CustomTheme = s.custom;
  const colors = useCustom ? { bg: c.bg, surface: c.surface, text: c.text, muted: pal.muted, line: pal.line } : pal;
  const accent = accentFor(s);
  const set = (k: string, v: string): void => root.style.setProperty(k, v);
  set('--accent', accent);
  set('--accent-fg', contrastText(accent));
  set('--bg', colors.bg);
  set('--surface', colors.surface);
  set('--text', colors.text);
  set('--muted', colors.muted);
  set('--line', colors.line);
  set('--radius', `${s.radius}px`);
  set('--font', FONTS[s.fontFamily]);
  root.style.fontSize = `${s.fontSize}px`;
  root.style.colorScheme = pal.scheme;
  root.lang = root.lang || 'en';
  root.dataset.mode = mode;
  root.dataset.density = s.density;
  root.dataset.perf = s.performanceMode ? 'on' : 'off';
  root.dataset.anim = s.animations && !s.reduceMotion && !s.performanceMode ? 'on' : 'off';
  root.dataset.contrast = s.highContrast ? 'high' : 'normal';
  root.dataset.transparency = s.transparency ? 'on' : 'off';
}

export function watchTheme(): () => void {
  applyTheme(useSettings.getState());
  const unsubscribe = useSettings.subscribe((s) => applyTheme(s));
  const timer = window.setInterval(() => applyTheme(useSettings.getState()), 60_000);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onMedia = (): void => applyTheme(useSettings.getState());
  media.addEventListener('change', onMedia);
  return () => {
    unsubscribe();
    window.clearInterval(timer);
    media.removeEventListener('change', onMedia);
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Validates a custom theme JSON document: {"name","accent","bg","surface","text"}. */
export function parseThemeJson(text: string): CustomTheme {
  const o = JSON.parse(text) as Partial<CustomTheme>;
  for (const k of ['accent', 'bg', 'surface', 'text'] as const) {
    if (typeof o[k] !== 'string' || !HEX.test(o[k])) throw new Error(`"${k}" must be a #rrggbb colour`);
  }
  return {
    name: typeof o.name === 'string' ? o.name.slice(0, 40) : 'Imported theme',
    accent: o.accent as string,
    bg: o.bg as string,
    surface: o.surface as string,
    text: o.text as string,
  };
}
