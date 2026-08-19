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
import enSettings from './locales/en/settings.json';
import deSettings from './locales/de/settings.json';
import enSettingsDocs from './locales/en/settingsDocs.json';
import deSettingsDocs from './locales/de/settingsDocs.json';
import enSettingsCastsCoverage from './locales/en/settingsCastsCoverage.json';
import deSettingsCastsCoverage from './locales/de/settingsCastsCoverage.json';
import enSettingsSkills from './locales/en/settingsSkills.json';
import deSettingsSkills from './locales/de/settingsSkills.json';
import enSettingsTrust from './locales/en/settingsTrust.json';
import deSettingsTrust from './locales/de/settingsTrust.json';
import enSettingsAirtable from './locales/en/settingsAirtable.json';
import deSettingsAirtable from './locales/de/settingsAirtable.json';
import enSettingsBookingFlow from './locales/en/settingsBookingFlow.json';
import deSettingsBookingFlow from './locales/de/settingsBookingFlow.json';
import enSettingsHireOrders from './locales/en/settingsHireOrders.json';
import deSettingsHireOrders from './locales/de/settingsHireOrders.json';
import enSettingsEmailTemplates from './locales/en/settingsEmailTemplates.json';
import deSettingsEmailTemplates from './locales/de/settingsEmailTemplates.json';
import enSettingsRolesRights from './locales/en/settingsRolesRights.json';
import deSettingsRolesRights from './locales/de/settingsRolesRights.json';
import enSettingsEditor from './locales/en/settingsEditor.json';
import deSettingsEditor from './locales/de/settingsEditor.json';
import enAuth from './locales/en/auth.json';
import deAuth from './locales/de/auth.json';
import enAdmin from './locales/en/admin.json';
import deAdmin from './locales/de/admin.json';
import enArtists from './locales/en/artists.json';
import deArtists from './locales/de/artists.json';
import enProductions from './locales/en/productions.json';
import deProductions from './locales/de/productions.json';
import enHireOrdersPages from './locales/en/hireOrdersPages.json';
import deHireOrdersPages from './locales/de/hireOrdersPages.json';
import enShowsDetail from './locales/en/showsDetail.json';
import deShowsDetail from './locales/de/showsDetail.json';
import enChats from './locales/en/chats.json';
import deChats from './locales/de/chats.json';
import enProfile from './locales/en/profile.json';
import deProfile from './locales/de/profile.json';
import enOnboarding from './locales/en/onboarding.json';
import deOnboarding from './locales/de/onboarding.json';
import enFlowCopy from './locales/en/flowCopy.json';
import deFlowCopy from './locales/de/flowCopy.json';
import enBookingCopy from './locales/en/bookingCopy.json';
import deBookingCopy from './locales/de/bookingCopy.json';
import enGetRunning from './locales/en/getRunning.json';
import deGetRunning from './locales/de/getRunning.json';
import enToday from './locales/en/today.json';
import deToday from './locales/de/today.json';

export const resources = {
  en: {
    common: enCommon, help: enHelp, dashboard: enDashboard, bookings: enBookings, availability: enAvailability,
    settings: enSettings, settingsDocs: enSettingsDocs, settingsCastsCoverage: enSettingsCastsCoverage,
    settingsSkills: enSettingsSkills, settingsTrust: enSettingsTrust, settingsAirtable: enSettingsAirtable,
    settingsBookingFlow: enSettingsBookingFlow, settingsHireOrders: enSettingsHireOrders,
    settingsEmailTemplates: enSettingsEmailTemplates, settingsRolesRights: enSettingsRolesRights,
    settingsEditor: enSettingsEditor,
    auth: enAuth, admin: enAdmin, artists: enArtists, productions: enProductions,
    hireOrdersPages: enHireOrdersPages, showsDetail: enShowsDetail, chats: enChats, profile: enProfile,
    onboarding: enOnboarding, flowCopy: enFlowCopy, bookingCopy: enBookingCopy,
    getRunning: enGetRunning, today: enToday,
  },
  de: {
    common: deCommon, help: deHelp, dashboard: deDashboard, bookings: deBookings, availability: deAvailability,
    settings: deSettings, settingsDocs: deSettingsDocs, settingsCastsCoverage: deSettingsCastsCoverage,
    settingsSkills: deSettingsSkills, settingsTrust: deSettingsTrust, settingsAirtable: deSettingsAirtable,
    settingsBookingFlow: deSettingsBookingFlow, settingsHireOrders: deSettingsHireOrders,
    settingsEmailTemplates: deSettingsEmailTemplates, settingsRolesRights: deSettingsRolesRights,
    settingsEditor: deSettingsEditor,
    auth: deAuth, admin: deAdmin, artists: deArtists, productions: deProductions,
    hireOrdersPages: deHireOrdersPages, showsDetail: deShowsDetail, chats: deChats, profile: deProfile,
    onboarding: deOnboarding, flowCopy: deFlowCopy, bookingCopy: deBookingCopy,
    getRunning: deGetRunning, today: deToday,
  },
} as const;

i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLang(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
  ns: [
    'common', 'help', 'dashboard', 'bookings', 'availability',
    'settings', 'settingsDocs', 'settingsCastsCoverage', 'settingsSkills', 'settingsTrust',
    'settingsAirtable', 'settingsBookingFlow', 'settingsHireOrders', 'settingsEmailTemplates',
    'settingsRolesRights', 'settingsEditor',
    'auth', 'admin', 'artists', 'productions', 'hireOrdersPages', 'showsDetail', 'chats', 'profile',
    'onboarding', 'flowCopy', 'bookingCopy', 'getRunning', 'today',
  ],
  defaultNS: 'common',
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});

export default i18n;
