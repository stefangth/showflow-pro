import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, detectInitialLang } from './config';
import enCommon from './locales/en/common.json';
import deCommon from './locales/de/common.json';
import enHelp from './locales/en/help.json';
import deHelp from './locales/de/help.json';
import enDashboard from './locales/en/dashboard.json';
import deDashboard from './locales/de/dashboard.json';
import enBookings from './locales/en/bookings.json';
import deBookings from './locales/de/bookings.json';
import enAvailability from './locales/en/availability.json';
import deAvailability from './locales/de/availability.json';

export const resources = {
  en: { common: enCommon, help: enHelp, dashboard: enDashboard, bookings: enBookings, availability: enAvailability },
  de: { common: deCommon, help: deHelp, dashboard: deDashboard, bookings: deBookings, availability: deAvailability },
} as const;

i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLang(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
  ns: ['common', 'help', 'dashboard', 'bookings', 'availability'],
  defaultNS: 'common',
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});

export default i18n;
