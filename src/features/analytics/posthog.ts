import type { ConsentChoices } from '@/features/consent/ConsentContext';

/**
 * Consent-gated PostHog integration.
 *
 * PostHog must stay dark until the user opts in. This module maps the GDPR
 * `ConsentChoices` onto PostHog's capture state so nothing is loaded, no
 * identity cookie is written, and no event is sent before consent is given:
 *
 *   - PostHog is not initialized until `analytics` is granted.
 *   - `analytics`      → autocapture + pageviews.
 *   - `sessionReplay`  → session recording (requires `analytics`, matching the consent UI).
 *   - all withdrawn    → opt out + reset (clears the distinct id / persistence).
 *
 * `errorTracking` is intentionally NOT wired to PostHog. That consent category is
 * disclosed to users as Sentry — "Error tracking (Sentry)" in the cookie dialog,
 * and the privacy policy names Sentry as the processor with 90-day retention and
 * "Sentry SDK identifiers". Routing it to PostHog (a different processor, 12-month
 * retention) would make that consent uninformed under GDPR Art. 6(1)(a). It stays
 * inert until a real Sentry integration lands, or the category is relabelled to
 * PostHog and the privacy policy updated to match.
 *
 * The state machine (`applyConsent`) is pure over an injected `AnalyticsClient`
 * so it can be unit-tested without loading posthog-js. The real wiring lives in
 * `AnalyticsBridge`, which feeds it `useConsent()` and the posthog-js singleton.
 */

/** The slice of the posthog-js surface this integration drives. */
export interface AnalyticsClient {
  init(key: string, options: Record<string, unknown>): void;
  opt_in_capturing(): void;
  opt_out_capturing(): void;
  reset(): void;
  set_config(config: Record<string, unknown>): void;
  startSessionRecording(): void;
  stopSessionRecording(): void;
}

export interface AnalyticsConfig {
  key: string | undefined;
  host: string;
}

/** PostHog EU Cloud — this app is GDPR-scoped, so EU is the default region. */
const DEFAULT_HOST = 'https://eu.i.posthog.com';

type AnalyticsEnv = {
  VITE_POSTHOG_KEY?: string;
  VITE_POSTHOG_HOST?: string;
};

export function readAnalyticsConfig(
  env: AnalyticsEnv = import.meta.env as AnalyticsEnv,
): AnalyticsConfig {
  const key = env.VITE_POSTHOG_KEY?.trim() || undefined;
  const host = env.VITE_POSTHOG_HOST?.trim() || DEFAULT_HOST;
  return { key, host };
}

// Module-level init latch. PostHog is a singleton script; it must be initialized
// at most once per page load, after which config changes go through `set_config`.
let initialized = false;

/** Test-only: clear the init latch between cases. */
export function resetAnalyticsForTests(): void {
  initialized = false;
}

/**
 * Reconcile PostHog's capture state with the current consent choices.
 * Idempotent and safe to call on every consent change.
 */
export function applyConsent(
  client: AnalyticsClient,
  config: AnalyticsConfig,
  choices: ConsentChoices,
): void {
  if (!config.key) return; // PostHog not configured for this environment — no-op.

  // Only `analytics` drives PostHog. `errorTracking` is deliberately excluded —
  // see the module comment above (disclosed as Sentry, not PostHog).
  const active = choices.analytics;

  if (!initialized) {
    // Don't load PostHog at all until analytics is consented.
    if (!active) return;
    client.init(config.key, {
      api_host: config.host,
      autocapture: choices.analytics,
      capture_pageview: choices.analytics,
      disable_session_recording: true, // toggled below via start/stopSessionRecording
      opt_out_capturing_by_default: true, // capture only after the explicit opt-in below
    });
    initialized = true;
  } else {
    client.set_config({
      autocapture: choices.analytics,
      capture_pageview: choices.analytics,
    });
  }

  if (active) {
    client.opt_in_capturing();
  } else {
    client.opt_out_capturing();
    client.reset(); // withdrawal clears the distinct id and persisted state
  }

  if (choices.analytics && choices.sessionReplay) {
    client.startSessionRecording();
  } else {
    client.stopSessionRecording();
  }
}
