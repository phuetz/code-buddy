import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enTranslations from './locales/en.json';
import frTranslations from './locales/fr.json';
import zhTranslations from './locales/zh.json';

i18n
  .use(LanguageDetector) // detect browser language
  .use(initReactI18next) // initialize react-i18next
  .init({
    resources: {
      en: {
        translation: enTranslations,
      },
      fr: {
        translation: frTranslations,
      },
      zh: {
        translation: zhTranslations,
      },
    },
    // Default language — English. Worldwide-showcase default: a fresh
    // install presents English so screenshots/demos are globally legible
    // regardless of the host OS locale. French and Chinese remain fully
    // available via the language switcher (Settings › General and the
    // onboarding wizard), and a user's explicit choice is persisted in
    // localStorage and always wins on the next launch. Navigator
    // auto-detection is intentionally NOT in the order: it made the UI
    // follow the host OS locale (French on FR-FR machines), which defeats
    // the English-first showcase default. en.json and fr.json have full
    // parity (2809 keys each) so nothing is untranslated in either.
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr', 'zh'],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    interpolation: {
      escapeValue: false, // React already escapes XSS
    },
    pluralSeparator: '_',
    contextSeparator: '_',
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
  });

export default i18n;
