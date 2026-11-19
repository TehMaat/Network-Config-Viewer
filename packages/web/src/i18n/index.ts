import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import it from './it.json';

export const LANGUAGES = ['it', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'ncv.language';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      it: { translation: it },
      en: { translation: en },
    },
    supportedLngs: [...LANGUAGES],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  });

function syncDocument(language: string) {
  document.documentElement.lang = language;
  document.title = i18n.t('app.title');
}

syncDocument(i18n.resolvedLanguage ?? 'en');
i18n.on('languageChanged', () => syncDocument(i18n.resolvedLanguage ?? 'en'));

export function currentLanguage(): Language {
  const lang = i18n.resolvedLanguage;
  return lang === 'it' ? 'it' : 'en';
}

export default i18n;
