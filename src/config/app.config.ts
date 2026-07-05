/**
 * ShowFlow — Central Application Configuration
 * All feature flags, intervals, weights, and role definitions live here.
 */

/** Feature flags to enable/disable modules */
export const FEATURES = {
  /** Enable auto-suggest booking engine */
  AUTO_SUGGEST: true,
  /** Enable in-app notifications */
  NOTIFICATIONS: true,
  /** Enable understudy management */
  UNDERSTUDY: true,
  /** Enable booking audit trail */
  AUDIT_TRAIL: true,
} as const;

/**
 * Canonical fallback defaults for the org-tunable booking-engine settings.
 *
 * These mirror the edge-function fallbacks in
 * `supabase/functions/_shared/settings.ts` (BOOKING_ENGINE_DEFAULTS) — the two
 * runtimes can't share an import, so keep them in sync. At runtime an org
 * override (Settings → Booking Engine) or a platform default (Platform →
 * Defaults) wins via resolveOrgSetting; these literals are the last-resort
 * fallback used only when neither row exists.
 */
export const BOOKING_ENGINE_DEFAULTS = {
  /** Hours an artist has to respond to an offer before it expires. */
  offer_response_window_hours: 48,
  /** Hour (Berlin, 0–23) the daily offer digest is sent. */
  offer_digest_hour_berlin: 19,
  /** Hour (Berlin, 0–23) the daily confirmation digest is sent. */
  confirmation_digest_hour_berlin: 20,
  /** Default Resend sender address for transactional email. */
  resend_from_address: 'ShowFlow <noreply@showflow.pro>',
} as const;

/** Platform System Health console thresholds (super-admin tab).
 *  Mirrors the spec; tune p95BudgetMs from real cold-start data. */
export const SYSTEM_HEALTH = {
  /** Analytics lookback window (minutes). The Management API caps the range at 24h. */
  windowMinutes: 1440,
  /** Dashboard auto-refresh (ms). */
  refetchMs: 60_000,
  /** p95 latency (ms) above which an otherwise-healthy job/function reads as Degraded.
   *  Deliberately cold-start tolerant — functions legitimately boot 3–10s. */
  p95BudgetMs: 12_000,
  /** Recent 5xx fraction (0..1) above which a job/function reads as Degraded. */
  errorRateBudget: 0.05,
} as const;

/** Health budget for the systemHealth derivation functions — defined once, imported by every
 *  System Health panel/shell so the object isn't redeclared per component. */
export const SYSTEM_HEALTH_BUDGET = {
  p95Ms: SYSTEM_HEALTH.p95BudgetMs,
  errorRate: SYSTEM_HEALTH.errorRateBudget,
};

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
  PRODUCTIONS: '/productions',
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
  ACCEPT_INVITE: '/accept-invite',
  PLATFORM: '/platform',
} as const;

/** Number of days after a show date that its chat is hidden from the UI */
export const CHAT_ARCHIVE_DAYS = 30;

/** App metadata */
export const APP_META = {
  NAME: 'ShowFlow',
  DESCRIPTION: 'Artist Booking SaaS for live show productions',
  VERSION: '1.8.0',
  /** Public marketing site — used for the "Book a demo" CTA on the login page. */
  MARKETING_URL: 'https://showflow.pro',
} as const;
