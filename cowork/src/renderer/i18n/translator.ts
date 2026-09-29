import { createInstance, type TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import fr from './locales/fr.json';

// Pure model callers and isolated component tests retain the historical French
// presentation until the renderer initializes its selected language.
const fallback = createInstance();
void fallback.init({
  lng: 'fr',
  resources: { fr: { translation: fr } },
  initImmediate: false,
  interpolation: { escapeValue: false },
});

export const frenchT: TFunction = fallback.getFixedT('fr');

export function useCoworkTranslation(): TFunction {
  const { t, i18n } = useTranslation();
  return i18n?.isInitialized ? t : frenchT;
}
