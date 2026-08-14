import 'react-i18next';
import type enCommon from './locales/en/common.json';
import type enHelp from './locales/en/help.json';
import type enDashboard from './locales/en/dashboard.json';
import type enBookings from './locales/en/bookings.json';
import type enAvailability from './locales/en/availability.json';
import type enSettings from './locales/en/settings.json';
import type enSettingsDocs from './locales/en/settingsDocs.json';
import type enSettingsCastsCoverage from './locales/en/settingsCastsCoverage.json';
import type enSettingsSkills from './locales/en/settingsSkills.json';
import type enSettingsTrust from './locales/en/settingsTrust.json';
import type enSettingsAirtable from './locales/en/settingsAirtable.json';
import type enSettingsBookingFlow from './locales/en/settingsBookingFlow.json';
import type enSettingsHireOrders from './locales/en/settingsHireOrders.json';
import type enSettingsEmailTemplates from './locales/en/settingsEmailTemplates.json';
import type enSettingsRolesRights from './locales/en/settingsRolesRights.json';
import type enSettingsEditor from './locales/en/settingsEditor.json';
import type enAuth from './locales/en/auth.json';
import type enAdmin from './locales/en/admin.json';
import type enArtists from './locales/en/artists.json';
import type enProductions from './locales/en/productions.json';
import type enHireOrdersPages from './locales/en/hireOrdersPages.json';
import type enShowsDetail from './locales/en/showsDetail.json';
import type enChats from './locales/en/chats.json';
import type enProfile from './locales/en/profile.json';
import type enFlowCopy from './locales/en/flowCopy.json';

// Typed resources: `t('nav.help')` autocompletes and an unknown key is a compile error.
// English is the canonical shape; the key-parity test enforces German matches it.
declare module 'react-i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof enCommon;
      help: typeof enHelp;
      dashboard: typeof enDashboard;
      bookings: typeof enBookings;
      availability: typeof enAvailability;
      settings: typeof enSettings;
      settingsDocs: typeof enSettingsDocs;
      settingsCastsCoverage: typeof enSettingsCastsCoverage;
      settingsSkills: typeof enSettingsSkills;
      settingsTrust: typeof enSettingsTrust;
      settingsAirtable: typeof enSettingsAirtable;
      settingsBookingFlow: typeof enSettingsBookingFlow;
      settingsHireOrders: typeof enSettingsHireOrders;
      settingsEmailTemplates: typeof enSettingsEmailTemplates;
      settingsRolesRights: typeof enSettingsRolesRights;
      settingsEditor: typeof enSettingsEditor;
      auth: typeof enAuth;
      admin: typeof enAdmin;
      artists: typeof enArtists;
      productions: typeof enProductions;
      hireOrdersPages: typeof enHireOrdersPages;
      showsDetail: typeof enShowsDetail;
      chats: typeof enChats;
      profile: typeof enProfile;
      flowCopy: typeof enFlowCopy;
    };
  }
}
