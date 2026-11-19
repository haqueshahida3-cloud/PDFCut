// Settings: appearance and schedule, 20 colour themes plus a custom theme (JSON import/export),
// wallpapers, layout and typography, motion and performance, 210 languages, privacy, and backups.
import { Settings as SettingsIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Dropzone, Field, Input, Segmented, Select, Slider, Toggle } from '../components/ui';
import { Page } from '../components/Page';
import { changeLanguage } from '../i18n';
import { isDesktop } from '../lib/desktop';
import { LANGUAGES, RTL_CODES, resolveLanguage } from '../i18n/languages';
import { errMessage, downloadBlob } from '../lib/util';
import { toast } from '../store/app';
import { DEFAULT_SETTINGS, resetSettings, setSettings, useSettings, type CustomTheme, type Settings as SettingsShape } from '../store/settings';
import { COLOR_THEMES, WALLPAPERS, parseThemeJson } from '../themes/themes';
import { cn } from '../utils/cn';

const OCR_LANGS: Array<[string, string]> = [
  ['eng', 'English'],
  ['spa', 'Español'],
  ['fra', 'Français'],
  ['deu', 'Deutsch'],
  ['ara', 'العربية'],
  ['ben', 'বাংলা'],
  ['hin', 'हिन्दी'],
  ['urd', 'اردو'],
  ['chi_sim', '简体中文'],
  ['jpn', '日本語'],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

export default function Settings() {
  const { t, i18n } = useTranslation();
  const s = useSettings();
  const [langQ, setLangQ] = useState('');
  const themeInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);

  const pickLanguage = (code: string): void => {
    setSettings({ language: code });
    void changeLanguage(code);
  };

  const q = langQ.trim().toLowerCase();
  const langs = LANGUAGES.filter(
    (l) => !q || l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q) || l.english.toLowerCase().includes(q),
  );

  const onWallpaper = (files: File[]): void => {
    const f = files[0];
    if (!f) return;
    if (f.size > 1.5 * 1024 * 1024) {
      toast({ kind: 'error', title: 'Choose an image under 1.5 MB', message: 'Larger images are kept out of local storage.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSettings({ wallpaperImage: String(reader.result) });
    reader.readAsDataURL(f);
  };

  const importBackup = async (file: File): Promise<void> => {
    try {
      const obj = JSON.parse(await file.text()) as Partial<SettingsShape>;
      const clean: Partial<SettingsShape> = {};
      for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof SettingsShape>) {
        if (k in obj) Object.assign(clean, { [k]: obj[k] });
      }
      setSettings(clean);
      toast({ kind: 'success', title: 'Settings restored', message: `${Object.keys(clean).length} values imported` });
    } catch (e) {
      toast({ kind: 'error', title: 'Not a valid settings backup', message: errMessage(e) });
    }
  };

  const setCustom = (patch: Partial<CustomTheme>): void => setSettings({ custom: { ...s.custom, ...patch }, themeId: 'custom' });

  return (
    <Page title={t('nav.settings')} desc="Everything stays on this computer. No accounts, no telemetry." icon={<SettingsIcon className="h-5 w-5" />}>
      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Appearance">
          <Segmented
            id="theme-mode"
            label="Theme mode"
            value={s.themeMode}
            onChange={(v) => setSettings({ themeMode: v })}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'amoled', label: 'AMOLED black' },
              { value: 'system', label: 'System' },
            ]}
          />
          <div className="flex flex-wrap items-center gap-4">
            <Toggle checked={s.scheduleDark} onChange={(v) => setSettings({ scheduleDark: v })} label="Dark at night" />
            <span className="text-sm">Dark at night (system or light mode)</span>
          </div>
          {s.scheduleDark && (
            <div className="flex flex-wrap gap-4">
              <Field label="Dark from (hour)">
                <Input type="number" min={0} max={23} value={s.darkFrom} onChange={(e) => setSettings({ darkFrom: clampHour(e.target.value) })} className="w-24" />
              </Field>
              <Field label="Light again (hour)">
                <Input type="number" min={0} max={23} value={s.darkTo} onChange={(e) => setSettings({ darkTo: clampHour(e.target.value) })} className="w-24" />
              </Field>
            </div>
          )}
        </Section>

        <Section title="Colour theme">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {COLOR_THEMES.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={s.themeId === c.id}
                onClick={() => setSettings({ themeId: c.id })}
                className={cn('flex flex-col items-center gap-1.5 rounded-xl p-2 text-xs', s.themeId === c.id ? 'bg-accent-soft ring-2 ring-accent' : 'hover:bg-line/50')}
              >
                <span className="h-7 w-7 rounded-full shadow-inner" style={{ background: c.accent }} />
                <span className="truncate">{c.name}</span>
              </button>
            ))}
            <button
              type="button"
              aria-pressed={s.themeId === 'custom'}
              onClick={() => setSettings({ themeId: 'custom' })}
              className={cn('flex flex-col items-center gap-1.5 rounded-xl p-2 text-xs', s.themeId === 'custom' ? 'bg-accent-soft ring-2 ring-accent' : 'hover:bg-line/50')}
            >
              <span className="h-7 w-7 rounded-full" style={{ background: `conic-gradient(${s.custom.accent}, ${s.custom.bg}, ${s.custom.accent})` }} />
              <span>Custom</span>
            </button>
          </div>
          <div className="space-y-3 border-t border-line pt-4">
            <div className="text-sm font-semibold">Custom theme editor</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {(['accent', 'bg', 'surface', 'text'] as const).map((k) => (
                <Field key={k} label={k === 'bg' ? 'Background' : k.charAt(0).toUpperCase() + k.slice(1)}>
                  <input
                    type="color"
                    value={s.custom[k]}
                    onChange={(e) => setCustom({ [k]: e.target.value })}
                    className="h-9 w-full rounded-xl border border-line bg-transparent"
                    aria-label={`Custom ${k} colour`}
                  />
                </Field>
              ))}
            </div>
            <Field label="Theme name">
              <Input value={s.custom.name} onChange={(e) => setCustom({ name: e.target.value })} className="max-w-xs" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  const json = JSON.stringify({ name: s.custom.name, accent: s.custom.accent, bg: s.custom.bg, surface: s.custom.surface, text: s.custom.text }, null, 2);
                  downloadBlob(json, `${s.custom.name.replace(/\W+/g, '-').toLowerCase() || 'theme'}.theme.json`, 'application/json');
                }}
              >
                Export theme JSON
              </Button>
              <Button size="sm" variant="ghost" onClick={() => themeInput.current?.click()}>
                Import theme JSON
              </Button>
              <input
                ref={themeInput}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  void f.text().then((text) => {
                    try {
                      setSettings({ custom: parseThemeJson(text), themeId: 'custom' });
                      toast({ kind: 'success', title: 'Theme imported' });
                    } catch (err) {
                      toast({ kind: 'error', title: 'Invalid theme file', message: errMessage(err) });
                    }
                  });
                }}
              />
            </div>
          </div>
        </Section>

        <Section title="Wallpaper">
          <div className="grid grid-cols-5 gap-2">
            {WALLPAPERS.map((w) => (
              <button
                key={w.id}
                type="button"
                aria-pressed={!s.wallpaperImage && s.wallpaper === w.id}
                onClick={() => setSettings({ wallpaper: w.id, wallpaperImage: '' })}
                className={cn('flex flex-col items-center gap-1 rounded-xl p-1.5 text-[11px]', !s.wallpaperImage && s.wallpaper === w.id ? 'ring-2 ring-accent' : 'hover:bg-line/50')}
              >
                <span className="h-10 w-full rounded-lg border border-line" style={{ background: w.id === 'none' ? 'transparent' : w.css }} />
                <span className="truncate">{w.name}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Dropzone compact accept="image/*" title="Use your own image" onFiles={onWallpaper} />
            {s.wallpaperImage && (
              <Button size="sm" variant="ghost" onClick={() => setSettings({ wallpaperImage: '' })}>
                Remove image
              </Button>
            )}
          </div>
          <Slider label="Blur" value={s.wallpaperBlur} min={0} max={20} onChange={(v) => setSettings({ wallpaperBlur: v })} format={(v) => `${v}px`} />
          <Slider label="Dim" value={s.wallpaperDim} min={0} max={80} onChange={(v) => setSettings({ wallpaperDim: v })} format={(v) => `${v}%`} />
          <Slider label="Opacity" value={s.wallpaperOpacity} min={20} max={100} onChange={(v) => setSettings({ wallpaperOpacity: v })} format={(v) => `${v}%`} />
        </Section>

        <Section title="Layout and typography">
          <Field label="UI density">
            <Segmented id="density" label="UI density" value={s.density} onChange={(v) => setSettings({ density: v })} options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' },
            ]} />
          </Field>
          <Slider label="Corner radius" value={s.radius} min={4} max={28} onChange={(v) => setSettings({ radius: v })} format={(v) => `${v}px`} />
          <Slider label="Font size" value={s.fontSize} min={13} max={18} onChange={(v) => setSettings({ fontSize: v })} format={(v) => `${v}px`} />
          <Field label="Font">
            <Segmented id="font" label="Font family" value={s.fontFamily} onChange={(v) => setSettings({ fontFamily: v })} options={[
              { value: 'system', label: 'System' },
              { value: 'serif', label: 'Serif' },
              { value: 'mono', label: 'Mono' },
              { value: 'rounded', label: 'Rounded' },
            ]} />
          </Field>
        </Section>

        <Section title="Motion and performance">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">Animations</span>
            <Toggle checked={s.animations} onChange={(v) => setSettings({ animations: v })} label="Animations" />
          </div>
          {s.animations && <Slider label="Animation speed" value={s.animSpeed} min={0.5} max={2} step={0.25} onChange={(v) => setSettings({ animSpeed: v })} format={(v) => `${v}×`} />}
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">Reduce motion</span>
            <Toggle checked={s.reduceMotion} onChange={(v) => setSettings({ reduceMotion: v })} label="Reduce motion" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">Performance mode (no blur, no animated wallpapers)</span>
            <Toggle checked={s.performanceMode} onChange={(v) => setSettings({ performanceMode: v })} label="Performance mode" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">High contrast</span>
            <Toggle checked={s.highContrast} onChange={(v) => setSettings({ highContrast: v })} label="High contrast" />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">Window transparency (glass)</span>
            <Toggle checked={s.transparency} onChange={(v) => setSettings({ transparency: v })} label="Transparency" />
          </div>
          <Slider label="Memory limit per file" value={s.memoryLimitMB} min={256} max={4096} step={256} onChange={(v) => setSettings({ memoryLimitMB: v })} format={(v) => `${v} MB`} />
        </Section>

        <Section title="Language">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">
              Current: {LANGUAGES.find((l) => l.code === i18n.language)?.name ?? i18n.language}
              {RTL_CODES.has(i18n.language) ? ' · right-to-left' : ''}
            </span>
            <Button size="sm" variant="ghost" onClick={() => pickLanguage(resolveLanguage(navigator.language))}>
              Use system language
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSettings({ language: 'auto' })}>
              Auto-detect
            </Button>
          </div>
          <Input type="search" value={langQ} onChange={(e) => setLangQ(e.target.value)} placeholder={`Search ${LANGUAGES.length} languages…`} aria-label="Search languages" />
          <ul className="grid max-h-72 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2">
            {langs.map((l) => (
              <li key={l.code}>
                <button
                  type="button"
                  aria-pressed={i18n.language === l.code}
                  onClick={() => pickLanguage(l.code)}
                  className={cn('flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-start text-sm', i18n.language === l.code ? 'bg-accent-soft font-semibold' : 'hover:bg-line/50')}
                >
                  <span className="truncate">{l.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {l.english}
                    {RTL_CODES.has(l.code) ? ' · RTL' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Full interface translations are included for the most-used languages. Other languages show English for untranslated text.</p>
        </Section>

        <Section title="Privacy, OCR and updates">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">Check for updates (off by default)</span>
            <Toggle checked={s.updateCheck} onChange={(v) => setSettings({ updateCheck: v })} label="Check for updates" />
          </div>
          <p className="text-xs text-muted">This web build never sends your files or usage data anywhere. There is no telemetry and no account.</p>
          <Field label="OCR language">
            <Select value={s.ocrLanguage} onChange={(e) => setSettings({ ocrLanguage: e.target.value })} className="w-60">
              {OCR_LANGS.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        {isDesktop() && (
          <Section title="Desktop integration">
            <p className="text-sm text-muted">
              Adds “Split with PDFCut”, “Merge with PDFCut” and “Compress with PDFCut” to the right-click menu in Nautilus (GNOME Files), Thunar and Dolphin (KDE). It applies to your account only and needs no admin rights.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  window.pdfcut?.integrate().then(
                    (lines) => toast({ kind: 'success', title: 'Right-click actions added', message: lines.join(' · ') }),
                    (e: unknown) => toast({ kind: 'error', title: 'Could not add the actions', message: errMessage(e) }),
                  );
                }}
              >
                Add right-click actions
              </Button>
            </div>
          </Section>
        )}

        <Section title="Backup and reset">
          <p className="text-sm text-muted">Export your preferences to a JSON file, restore them later, or reset everything to defaults. Recent files are not included.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                const { wallpaperImage: _omit, ...rest } = useSettings.getState();
                void _omit;
                downloadBlob(JSON.stringify(rest, null, 2), 'pdfcut-settings.json', 'application/json');
              }}
            >
              Export settings
            </Button>
            <Button variant="ghost" onClick={() => backupInput.current?.click()}>
              Import settings
            </Button>
            <input
              ref={backupInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void importBackup(f);
              }}
            />
            <Button
              variant="danger"
              onClick={() => {
                resetSettings();
                void changeLanguage('en');
                toast({ kind: 'info', title: 'Settings reset to defaults' });
              }}
            >
              Reset to defaults
            </Button>
          </div>
        </Section>
      </div>
    </Page>
  );
}

function clampHour(v: string): number {
  return Math.max(0, Math.min(23, Math.floor(Number(v) || 0)));
}
