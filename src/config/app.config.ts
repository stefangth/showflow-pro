/**
 * Showflow Pro — Central Application Configuration
 * All feature flags, intervals, weights, and role definitions live here.
 */

/** Feature flags to enable/disable modules */
export const FEATURES = {
  /** Enable Airtable sync polling */
  AIRTABLE_SYNC: false,
  /** Enable auto-suggest booking engine */
  AUTO_SUGGEST: true,
  /** Enable in-app notifications */
  NOTIFICATIONS: true,
  /** Enable understudy management */
  UNDERSTUDY: true,
  /** Enable booking audit trail */
  AUDIT_TRAIL: true,
} as const;

/** Airtable sync configuration */
export const SYNC_CONFIG = {
  /** Polling interval in milliseconds (default: 5 minutes) */
  POLL_INTERVAL_MS: 5 * 60 * 1000,
  /** Cache TTL before data is considered stale (default: 24 hours) */
  CACHE_TTL_MS: 24 * 60 * 60 * 1000,
  /** Max records per sync batch */
  BATCH_SIZE: 100,
} as const;

/** Booking engine configuration */
export const BOOKING_CONFIG = {
  /** Hours before a soft-book auto-expires (default: 48h) */
  SOFT_BOOK_EXPIRY_HOURS: 48,
} as const;

/** Role definitions */
export const ROLES = {
  ADMIN: 'admin',
  PRODUCER: 'producer',
  ARTIST: 'artist',
} as const;

export type AppRole = (typeof ROLES)[keyof typeof ROLES];

/** Route paths */
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  SIGNUP: '/signup',
  DASHBOARD: '/dashboard',
  BOOKINGS: '/bookings',
  ARTISTS: '/artists',
  AVAILABILITY: '/availability',
  ADMIN: '/admin',
  SETTINGS: '/settings',
  PROFILE: '/profile',
  RESET_PASSWORD: '/reset-password',
  CHATS: '/chats',
  PRIVACY: '/privacy',
  IMPRESSUM: '/impressum',
  UNSUBSCRIBE: '/unsubscribe',
} as const;

/** Number of days after a show date that its chat is hidden from the UI */
export const CHAT_ARCHIVE_DAYS = 30;

/** App metadata */
export const APP_META = {
  NAME: 'Showflow Pro',
  DESCRIPTION: 'Artist Booking SaaS for live show productions',
  VERSION: '1.0.0',
} as const;
