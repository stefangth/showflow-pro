import { useEffect } from 'react';
import posthog from 'posthog-js';
import { useLocation } from 'react-router-dom';
import { readStoredConsent, useConsent } from '@/features/consent/ConsentContext';
import { applyConsent, bootstrapAnalytics, capturePageview, readAnalyticsConfig, type AnalyticsClient } from './posthog';

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
// Keep the client eagerly available to the root error boundary: deferring a
// dynamic import until consent would create a race that loses the initial
// consented render error. The SDK remains uninitialized and network-silent
// until `applyConsent` sees explicit consent.
const client = posthog as unknown as AnalyticsClient;
bootstrapAnalytics(client, config, readStoredConsent());

export function AnalyticsBridge(): null {
  const { consent } = useConsent();
  const location = useLocation();

  useEffect(() => {
    // `consent` is a stable useState value that only changes when a category flips.
    // Manual pageviews deliberately follow React Router instead of PostHog's
    // history extension: the extension only attaches at init, while analytics
    // consent may be granted after error tracking initialized the SDK.
    applyConsent(client, config, consent);
    capturePageview(client, consent);
  }, [consent, location.pathname, location.search, location.hash]);

  return null;
}
