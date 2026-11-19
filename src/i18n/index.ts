// i18next setup. English is bundled; every other locale is fetched on demand from
// public/locales/<code>.json, so startup only pays for the active language.
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import { LANGUAGES, RTL_CODES, resolveLanguage } from './languages';
import { setLocale } from '../lib/util';

export async function initI18n(preferred: string): Promise<void> {
  await i18next.use(initReactI18next).init({
    resources: { en: { translation: en } },
    lng: 'en',
    fallbackLng: 'en',
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  const code = preferred === 'auto' ? resolveLanguage(navigator.language) : preferred;
  await changeLanguage(code);
}

export async function changeLanguage(code: string): Promise<void> {
  const target = LANGUAGES.some((l) => l.code === code) ? code : 'en';
  if (target !== 'en' && !i18next.hasResourceBundle(target, 'translation')) {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}locales/${target}.json`);
      if (res.ok) i18next.addResourceBundle(target, 'translation', await res.json(), true, true);
    } catch {
      // Offline or file:// — missing keys simply fall back to English.
    }
  }
  await i18next.changeLanguage(target);
  document.documentElement.lang = target;
  document.documentElement.dir = RTL_CODES.has(target) ? 'rtl' : 'ltr';
  setLocale(target);
}
