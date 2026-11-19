import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RTL_CODES } from './languages';

const LOCALE_DIR = resolve('public/locales');
const english = JSON.parse(readFileSync(resolve('src/i18n/en.json'), 'utf8')) as Record<string, string>;
const files = readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.json'));

describe('locale catalogue', () => {
  it('ships one file per non-English language', () => {
    expect(files).toHaveLength(209);
  });

  for (const file of files) {
    it(`${file} is well formed and covers every English key`, () => {
      const data = JSON.parse(readFileSync(join(LOCALE_DIR, file), 'utf8')) as Record<string, string>;
      const missing = Object.keys(english).filter((k) => typeof data[k] !== 'string');
      expect(missing).toEqual([]);
      const code = file.replace(/\.json$/, '');
      expect(data['_meta.code']).toBe(code);
      expect(data['_meta.rtl'] === 'true').toBe(RTL_CODES.has(code));
    });
  }
});
