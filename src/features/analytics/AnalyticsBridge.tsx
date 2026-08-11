import { useEffect } from 'react';
import posthog from 'posthog-js';
import { useConsent } from '@/features/consent/ConsentContext';
import { applyConsent, readAnalyticsConfig, type AnalyticsClient } from './posthog';

/**
 * Bridges the GDPR consent state to PostHog. Renders nothing; it only reconciles
 * PostHog's capture state whenever the analytics/sessionReplay/errorTracking
 * consent toggles change. PostHog is not loaded until the user opts in, and the
 * whole thing no-ops when `VITE_POSTHOG_KEY` is unset (local/dev, or if the key
 * has not been configured for the environment yet).
 *
 * Mounted inside `ConsentProvider`. See `./posthog.ts` for the consent mapping.
 */
const config = readAnalyticsConfig();
const client = posthog as unknown as AnalyticsClient;

export function AnalyticsBridge(): null {
  const { consent } = useConsent();

  useEffect(() => {
    // `consent` is a stable useState value that only changes when a category flips.
    applyConsent(client, config, consent);
  }, [consent]);

  return null;
}
