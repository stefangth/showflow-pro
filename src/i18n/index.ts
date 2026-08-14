import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, detectInitialLang } from './config';
import enCommon from './locales/en/common.json';
import deCommon from './locales/de/common.json';
import enHelp from './locales/en/help.json';
import deHelp from './locales/de/help.json';
import enDashboard from './locales/en/dashboard.json';
import deDashboard from './locales/de/dashboard.json';

export const resources = {
  en: { common: enCommon, help: enHelp, dashboard: enDashboard },
  de: { common: deCommon, help: deHelp, dashboard: deDashboard },
} as const;

i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLang(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
  ns: ['common', 'help', 'dashboard'],
  defaultNS: 'common',
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});

export default i18n;
