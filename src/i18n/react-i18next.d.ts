import 'react-i18next';
import type enCommon from './locales/en/common.json';
import type enHelp from './locales/en/help.json';
import type enDashboard from './locales/en/dashboard.json';
import type enBookings from './locales/en/bookings.json';
import type enAvailability from './locales/en/availability.json';

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
    };
  }
}
