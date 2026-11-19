// User preferences, persisted to localStorage. Only plain data lives here, so backup/restore is trivial.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CustomTheme {
  name: string;
  accent: string;
  bg: string;
  surface: string;
  text: string;
}

export interface Settings {
  themeMode: 'light' | 'dark' | 'amoled' | 'system';
  scheduleDark: boolean;
  darkFrom: number;
  darkTo: number;
  themeId: string;
  custom: CustomTheme;
  wallpaper: string;
  wallpaperImage: string;
  wallpaperBlur: number;
  wallpaperDim: number;
  wallpaperOpacity: number;
  density: 'compact' | 'comfortable';
  radius: number;
  fontSize: number;
  fontFamily: 'system' | 'serif' | 'mono' | 'rounded';
  animations: boolean;
  animSpeed: number;
  reduceMotion: boolean;
  performanceMode: boolean;
  highContrast: boolean;
  transparency: boolean;
  language: string;
  updateCheck: boolean;
  onboardingDone: boolean;
  lowEndHintDismissed: boolean;
  sidebarCollapsed: boolean;
  memoryLimitMB: number;
  safeMode: boolean;
  ocrLanguage: string;
  compressPreset: 'lossless' | 'light' | 'medium' | 'strong' | 'custom';
}

export const DEFAULT_SETTINGS: Settings = {
  themeMode: 'system',
  scheduleDark: false,
  darkFrom: 20,
  darkTo: 7,
  themeId: 'indigo',
  custom: { name: 'My theme', accent: '#6366f1', bg: '#f4f5f9', surface: '#ffffff', text: '#0f172a' },
  wallpaper: 'none',
  wallpaperImage: '',
  wallpaperBlur: 0,
  wallpaperDim: 0,
  wallpaperOpacity: 100,
  density: 'comfortable',
  radius: 16,
  fontSize: 15,
  fontFamily: 'system',
  animations: true,
  animSpeed: 1,
  reduceMotion: false,
  performanceMode: false,
  highContrast: false,
  transparency: false,
  language: 'auto',
  updateCheck: false,
  onboardingDone: false,
  lowEndHintDismissed: false,
  sidebarCollapsed: false,
  memoryLimitMB: 1024,
  safeMode: true,
  ocrLanguage: 'eng',
  compressPreset: 'medium',
};

export const useSettings = create<Settings>()(
  persist(() => DEFAULT_SETTINGS, { name: 'pdfcut-settings', version: 1 }),
);

export function setSettings(p: Partial<Settings>): void {
  useSettings.setState(p);
}

export function resetSettings(): void {
  useSettings.setState({ ...DEFAULT_SETTINGS }, true);
}
