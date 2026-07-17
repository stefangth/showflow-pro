/**
 * ShowFlow — Central Application Configuration
 * All feature flags, intervals, weights, and role definitions live here.
 */

import type { FeatureKey } from '@/lib/entitlements';

/**
 * Routes owned by a gated (entitlement-controlled) module. Checked by
 * ProtectedRoute via requiredFeatureForPath: a route listed here renders
 * FeatureDisabledScreen instead of its page when the current org doesn't
 * have the feature enabled (see src/hooks/useEntitlements.ts). Filled in as
 * gated modules land — starts empty.
 */
export const ROUTE_FEATURES: Record<string, FeatureKey> = {};

/** Pure lookup: which FeatureKey (if any) gates a given pathname. */
export function requiredFeatureForPath(pathname: string): FeatureKey | undefined {
  return ROUTE_FEATURES[pathname];
}

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

/** Email-delivery health thresholds + windows for the System Health "Email delivery" domain.
 *  Rates are deliverability-industry norms. Alert-only knobs (window/min-volume) gate the watcher. */
export const EMAIL_HEALTH = {
  /** Warn/critical bounce fraction (0..1). */
  bounceWarn: 0.02,
  bounceDown: 0.05,
  /** Warn/critical spam-complaint fraction (0..1). */
  complaintWarn: 0.001,
  complaintDown: 0.003,
  /** Below this delivery fraction (0..1) the domain reads Degraded. */
  deliveryWarn: 0.95,
  /** Panel default lookback (minutes) + the toggle options (24h / 7d). */
  windowMinutes: 1440,
  windowOptions: [1440, 10080] as const,
  /** Watcher-only: rolling alert window + false-alarm guards. */
  alertWindowMinutes: 180,
  minVolumeForAlert: 20,
  failureAlertCount: 3,
} as const;

/** A single hire-order terms clause: a titled paragraph of contract copy. */
export interface HireOrderClause {
  title: string;
  body: string;
}

/**
 * Default hire-order terms clauses, org-editable via Settings → Hire orders → Terms
 * before any real order is ever issued (the module ships default-off, see
 * FEATURE_REGISTRY.hire_orders in src/lib/entitlements.ts).
 *
 * `standard` holds the four clauses used by the standard variant; `full` holds the
 * four additional clauses appended when the full variant is selected (rendering is
 * a later task's concern — this settings tab only stores the two lists). `lean`
 * starts empty: orgs that want the shortest possible document add their own.
 *
 * EN copy only, no em/en dashes per house style. This starter copy is generic
 * boilerplate, not legal advice — every clause is editable per org before use.
 */
export const HIRE_ORDER_DEFAULT_TERMS: { lean: HireOrderClause[]; standard: HireOrderClause[]; full: HireOrderClause[] } = {
  lean: [],
  standard: [
    {
      title: 'Engagement',
      body: 'This order confirms the engagement of the artist named above for the performance, date, and venue specified. The artist agrees to arrive in time for the running order listed on this document.',
    },
    {
      title: 'Payment terms',
      body: "The engagement fee stated above is payable to the artist upon completion of the performance, unless another payment schedule has been agreed in writing between the parties.",
    },
    {
      title: 'Cancellation',
      body: "Either party may cancel this engagement by written notice. Any cancellation fee or notice period is as agreed between the parties and recorded in this order's notes.",
    },
    {
      title: 'Force majeure',
      body: 'Neither party is liable for a delay or failure to perform caused by circumstances beyond its reasonable control, including illness, accident, severe weather, or venue closure.',
    },
  ],
  full: [
    {
      title: 'Confidentiality',
      body: "Each party agrees to keep the commercial terms of this engagement confidential, except where disclosure is required by law or needed to carry out this order.",
    },
    {
      title: 'Image and recording rights',
      body: 'The artist consents to the production company using photography, audio, and video recorded during the engagement for reasonable promotional purposes, unless otherwise agreed in writing.',
    },
    {
      title: 'Independent contractor status',
      body: 'The artist performs this engagement as an independent contractor, not as an employee of the production company. Nothing in this order creates an employment relationship.',
    },
    {
      title: 'Governing law',
      body: "This order is governed by the laws of the jurisdiction stated in the organization's registration details, without regard to conflict of law principles.",
    },
  ],
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
  VERSION: '1.9.0',
  /** Public marketing site — used for the "Book a demo" CTA on the login page. */
  MARKETING_URL: 'https://showflow.pro',
} as const;
