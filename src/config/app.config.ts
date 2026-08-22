/**
 * ShowFlow — Central Application Configuration
 * All feature flags, intervals, weights, and role definitions live here.
 */

import type { FeatureKey } from '@/lib/entitlements';
import type { HireOrderTermsSetting } from '@/lib/hireOrders/terms';

/**
 * Routes owned by a gated (entitlement-controlled) module. Checked by
 * ProtectedRoute via requiredFeatureForPath: a route listed here renders
 * FeatureDisabledScreen instead of its page when the current org doesn't
 * have the feature enabled (see src/hooks/useEntitlements.ts).
 *
 * Keys may be dynamic route patterns with `:param` segments (e.g.
 * `/contracts/:id`); requiredFeatureForPath matches those against the
 * concrete pathname so the gate fires for dynamic routes too.
 */
export const ROUTE_FEATURES: Record<string, FeatureKey> = {
  '/contracts': 'hire_orders',
  '/contracts/:id': 'hire_orders',
  '/contracts/:id/edit': 'hire_orders',
  '/settings/contracts/template': 'hire_orders',
  '/availability': 'booking_flow',
};

/** Whether a route pattern (which may carry `:param` segments) matches a
 *  concrete pathname. Pure and segment-based — `/contracts/:id` matches
 *  `/contracts/abc-uuid` but not `/contracts` or `/contracts/a/b`. */
function matchesRoutePattern(pattern: string, pathname: string): boolean {
  const patternSegs = pattern.split('/');
  const pathSegs = pathname.split('/');
  if (patternSegs.length !== pathSegs.length) return false;
  return patternSegs.every((seg, i) =>
    seg.startsWith(':') ? pathSegs[i].length > 0 : seg === pathSegs[i],
  );
}

/**
 * Pure lookup: which FeatureKey (if any) gates a given pathname. Exact static
 * matches win first (fast path); dynamic patterns (keys containing `:`) are
 * then matched segment-by-segment so a real URL like `/contracts/<uuid>`
 * still resolves to its feature. Without this the route-level entitlement gate
 * would silently never fire for `:param` routes.
 */
export function requiredFeatureForPath(pathname: string): FeatureKey | undefined {
  const exact = ROUTE_FEATURES[pathname];
  if (exact) return exact;
  for (const [pattern, feature] of Object.entries(ROUTE_FEATURES)) {
    if (pattern.includes(':') && matchesRoutePattern(pattern, pathname)) return feature;
  }
  return undefined;
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
  /** Recent 4xx fraction (0..1) above which a job/function reads as Degraded.
   *  Looser than errorRateBudget: an occasional validation 400 is normal traffic,
   *  a sustained rejection rate is a broken caller. */
  rejectRateBudget: 0.2,
  /** Days shown by the uptime bar. Cells fill in one per day from the health-rollup deploy;
   *  anything earlier renders as "no data" because the Analytics API retains only 24h and
   *  there is nothing to backfill from. */
  uptimeDays: 30,
  /** cron-health-watcher prunes cron_health_log at this age — the incident timeline and the
   *  failure list cannot show anything older, so it is what the UI labels itself with. */
  logRetentionDays: 30,
} as const;

/** Health budget for the systemHealth derivation functions — defined once, imported by every
 *  System Health panel/shell so the object isn't redeclared per component. */
export const SYSTEM_HEALTH_BUDGET = {
  p95Ms: SYSTEM_HEALTH.p95BudgetMs,
  errorRate: SYSTEM_HEALTH.errorRateBudget,
  rejectRate: SYSTEM_HEALTH.rejectRateBudget,
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

// Re-exported so existing importers of HireOrderClause (and the newer
// HireOrderTemplate/HireOrderTermsSetting types) from app.config keep working
// via one home: the lib module (src/lib/hireOrders/terms.ts) is canonical.
export type { HireOrderClause, HireOrderTemplate, HireOrderTermsSetting } from '@/lib/hireOrders/terms';

/**
 * Fallback for an org that has never saved terms: three seeded, clause-less
 * templates (Lean / Standard / Full, default Standard).
 *
 * ShowFlow deliberately ships NO default clause text. Contract terms are the
 * hiring org's own legal responsibility and vary by jurisdiction and engagement,
 * so an admin authors them in Settings → Hire orders → Terms before issuing.
 * Seeding plausible-looking boilerplate would invite orgs to issue legal
 * documents nobody on their side had actually reviewed.
 */
export const HIRE_ORDER_DEFAULT_TERMS: HireOrderTermsSetting = {
  templates: [
    { id: 'lean', name: 'Lean', clauses: [] },
    { id: 'standard', name: 'Standard', clauses: [] },
    { id: 'full', name: 'Full', clauses: [] },
  ],
  default_id: 'standard',
};

/** Role definitions */
export const ROLES = {
  ADMIN: 'admin',
  PRODUCER: 'producer',
  ARTIST: 'artist',
} as const;

export type AppRole = (typeof ROLES)[keyof typeof ROLES];

// >>> ROLE LABELS MIRROR (keep byte-identical with the twin file) >>>
/**
 * Human-facing labels for each org role. The `producer` role now covers both
 * show producers and project managers (hire orders), so it reads "Production Team"
 * in the UI (and in the org-invitation email) while the enum value stays `producer` —
 * the DB enum, RLS policies, and edge functions all key off the literal `producer`,
 * so only the display label changes. Mirrored to
 * supabase/functions/_shared/roles.ts (npm run sync:mirrors) so the invite email
 * renders the same label; the surrounding imports differ per runtime.
 */
export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Admin',
  producer: 'Production Team',
  artist: 'Artist',
};

/** Display label for a role. Tolerant of unknown strings (falls back to the raw value). */
export const roleLabel = (role: string): string =>
  ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role;

/**
 * One-sentence explanation of what each role can do, shown wherever someone needs to
 * understand a role before they act on it: the People pane's role dropdown (a caption
 * under each role option) and the accept-invite success screen are the planned
 * consumers, not yet built. The org-invitation email states its own second-person
 * version instead (org-invitation.roleIntroAdmin/Producer/Artist in
 * src/lib/emailTemplates/emailCopy.ts): "You are joining..." cannot grammatically
 * continue into a third-person clause, so review both together when either changes, but
 * they are not required to match word for word. Mirrored to
 * supabase/functions/_shared/roles.ts (npm run sync:mirrors) so every runtime renders
 * the same text; the surrounding imports differ per runtime.
 *
 * Two constraints keep every sentence true regardless of an org's configuration: stays
 * silent on offers and digests (artist acceptance is a per-org toggle, and a
 * direct-book org never opens an offer at all); and states each role's DEFAULT grant,
 * not one invitee's resolved capabilities (several producer permissions are
 * individually org-toggleable, so a producer may not actually get everything this
 * sentence describes).
 *
 * The artist line deliberately says nothing about declaring availability: that action
 * lives behind /availability, itself gated by the booking_flow entitlement (see
 * ROUTE_FEATURES in src/config/app.config.ts), so an org with that module off has
 * artists who cannot reach it at all. An earlier draft hedged with "where that is
 * turned on" to stay true for that case, but a brand-new invitee has no way to decode
 * who turns it on or where, so the sentence omits the claim entirely instead of
 * hedging it. This matches org-invitation.roleIntroArtist, which never mentioned it
 * either.
 */
export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: 'Full control of this workspace, including people, casts, settings, and every booking.',
  producer: 'Plans productions and show dates, and books artists into them.',
  artist: 'Gets booked for productions and sees every confirmed engagement.',
};

/** One-sentence description of what a role can do. Tolerant of unknown strings
 *  (falls back to an empty string), mirroring roleLabel's fallback semantics so a
 *  future enum value that hasn't been added to the registry yet degrades to "no
 *  second sentence" rather than an undefined-riddled render. */
export function roleDescription(role: string): string {
  return ROLE_DESCRIPTIONS[role as keyof typeof ROLE_DESCRIPTIONS] ?? '';
}
// <<< ROLE LABELS MIRROR <<<

/** Route paths */
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  SIGNUP: '/signup',
  DASHBOARD: '/today',
  GET_RUNNING: '/get-running',
  BOOKINGS: '/dates',
  PRODUCTIONS: '/productions',
  ARTISTS: '/artists',
  AVAILABILITY: '/availability',
  ADMIN: '/admin',
  SETTINGS: '/settings',
  PROFILE: '/profile',
  RESET_PASSWORD: '/reset-password',
  AUTH_CALLBACK: '/auth/callback',
  CHATS: '/chats',
  HELP: '/help',
  PRIVACY: '/privacy',
  IMPRESSUM: '/impressum',
  UNSUBSCRIBE: '/unsubscribe',
  ACCEPT_INVITE: '/accept-invite',
  PLATFORM: '/platform',
  HIRE_ORDERS: '/contracts',
  HIRE_ORDER_DETAIL: '/contracts/:id',
  HIRE_ORDER_EDIT: '/contracts/:id/edit',
  HIRE_ORDER_TEMPLATE: '/settings/contracts/template',
  EMAIL_TEMPLATE: '/settings/email-templates/:templateKey',
  SANDBOX: '/sandbox/:token',
} as const;

/** Number of days after a show date that its chat is hidden from the UI */
export const CHAT_ARCHIVE_DAYS = 30;

/** App metadata */
export const APP_META = {
  NAME: 'ShowFlow',
  DESCRIPTION: 'Artist Booking SaaS for live show productions',
  VERSION: '1.17.2',
  /** Public marketing site — used for the "Book a demo" CTA on the login page. */
  MARKETING_URL: 'https://showflow.pro',
  /** This app's own public origin. Needed where a link must resolve to the app
   *  from somewhere that is not the app — notably the Trust Center document
   *  list, which renders on both hosts. */
  APP_URL: 'https://app.showflow.pro',
  /**
   * Public support contact for surfaces that reach a person entirely outside their
   * own organization (e.g. SuspendedOrgScreen, where the org's own admins may be
   * unreachable). No public support address exists yet — setting a real one is an
   * owner decision, so this ships dark (null) and every consumer must treat null as
   * "say nothing" rather than render a broken contact line.
   */
  SUPPORT_EMAIL: null as string | null,
} as const;

/**
 * Public changelog, opened from the version pill in the brand wordmark.
 *
 * CROSS-REPO CONTRACT: this route is owned by the standalone landing-page repo, which
 * renders it from this repo's `public/changelog.md`. Nothing here can typecheck or test
 * it, so renaming or removing that route silently turns the version pill into a 404.
 * Change it there and here together.
 */
export const CHANGELOG_URL = `${APP_META.MARKETING_URL}/changelog`;

/**
 * Public trust center, linked from Settings > Trust & data.
 *
 * CROSS-REPO CONTRACT: same shape as CHANGELOG_URL above. The landing-page repo
 * owns the `/trust` route and builds it from this repo's `public/trust.json`
 * (generated by `npm run sync:mirrors` from src/lib/trust/facts.ts). Renaming the
 * route there without changing it here turns this link into a 404.
 */
export const TRUST_CENTER_URL = `${APP_META.MARKETING_URL}/trust`;
