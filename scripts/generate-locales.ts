// Generates public/locales/<code>.json for all 210 locales from the English base file.
// Keys with a native translation (scripts/translations.ts) are used; every other key falls back
// to English, so each file is complete. Run with: npm run locales
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LANGUAGES, RTL_CODES } from '../src/i18n/languages';
import { OVERLAYS } from './translations';

const base = JSON.parse(readFileSync(resolve('src/i18n/en.json'), 'utf8')) as Record<string, string>;
const outDir = resolve('public/locales');
mkdirSync(outDir, { recursive: true });

let written = 0;
let native = 0;
for (const lang of LANGUAGES) {
  if (lang.code === 'en') continue;
  const overlay = OVERLAYS[lang.code] ?? {};
  const data: Record<string, string> = {};
  for (const [key, english] of Object.entries(base)) {
    data[key] = overlay[key] ?? english;
  }
  data['_meta.code'] = lang.code;
  data['_meta.name'] = lang.name;
  data['_meta.english'] = lang.english;
  data['_meta.rtl'] = RTL_CODES.has(lang.code) ? 'true' : 'false';
  data['_meta.nativeKeys'] = `${Object.keys(overlay).length}/${Object.keys(base).length}`;
  writeFileSync(resolve(outDir, `${lang.code}.json`), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  written++;
  if (Object.keys(overlay).length > 0) native++;
}
console.log(`Generated ${written} locale files; ${native} include native translations, the rest use English fallback.`);
