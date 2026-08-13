import type { ConsentChoices } from '@/features/consent/ConsentContext';

/**
 * Consent-gated PostHog integration.
 *
 * PostHog must stay dark until the user opts in. This module maps the GDPR
 * `ConsentChoices` onto PostHog's capture state so nothing is loaded, no
 * identity cookie is written, and no event is sent before consent is given:
 *
 *   - PostHog is not initialized until `analytics` OR `errorTracking` is granted.
 *   - `analytics`      → autocapture + pageviews.
 *   - `sessionReplay`  → session recording (requires `analytics`, matching the consent UI).
 *   - `errorTracking`  → exception capture (independent category — PostHog is the
 *                        disclosed processor for it; see CookieConsentDialog + the
 *                        privacy policy, which name PostHog with 12-month retention).
 *   - all withdrawn    → opt out + reset (clears the distinct id / persistence).
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
  captureException(error: unknown): void;
  capture(event: string): void;
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

  const active = choices.analytics || choices.errorTracking;

  if (!initialized) {
    // Don't load PostHog at all until at least one telemetry category is consented.
    if (!active) return;
    client.init(config.key, {
      api_host: config.host,
      autocapture: choices.analytics,
      // Route changes are captured explicitly by AnalyticsBridge. Keeping the
      // SDK's history extension off makes errorTracking → analytics consent
      // transitions reliable because extensions only attach during init.
      capture_pageview: false,
      capture_exceptions: choices.errorTracking,
      disable_session_recording: true, // toggled below via start/stopSessionRecording
      opt_out_capturing_by_default: true, // capture only after the explicit opt-in below
    });
    initialized = true;
  } else {
    client.set_config({
      autocapture: choices.analytics,
      capture_pageview: false,
      capture_exceptions: choices.errorTracking,
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

/**
 * Capture a React-boundary exception only when error tracking is actively
 * consented and the PostHog client has already been initialized. Errors before
 * consent are deliberately discarded rather than queued.
 */
export function captureException(
  client: AnalyticsClient,
  choices: ConsentChoices,
  error: unknown,
): boolean {
  if (!initialized || !choices.errorTracking) return false;
  client.captureException(error);
  return true;
}

/** Capture a route pageview only after analytics consent and initialization. */
export function capturePageview(client: AnalyticsClient, choices: ConsentChoices): boolean {
  if (!initialized || !choices.analytics) return false;
  client.capture('$pageview');
  return true;
}
