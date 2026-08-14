import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, detectInitialLang } from './config';
import enCommon from './locales/en/common.json';
import deCommon from './locales/de/common.json';
import enHelp from './locales/en/help.json';
import deHelp from './locales/de/help.json';

export const resources = {
  en: { common: enCommon, help: enHelp },
  de: { common: deCommon, help: deHelp },
} as const;

i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLang(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
  ns: ['common', 'help'],
  defaultNS: 'common',
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});

export default i18n;
