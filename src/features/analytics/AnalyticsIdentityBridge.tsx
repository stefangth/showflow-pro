import { useEffect, useRef } from 'react';
import posthog from 'posthog-js';
import { useAuth } from '@/features/auth/AuthContext';
import { useConsent } from '@/features/consent/ConsentContext';
import { reconcileIdentity, type IdentityClient } from './identity';

const client = posthog as unknown as IdentityClient;

/** Associates a consented, authenticated user with the PostHog singleton. */
export function AnalyticsIdentityBridge(): null {
  const { user } = useAuth();
  const { consent } = useConsent();
  const previousUserId = useRef<string | null>(null);
  const active = consent.analytics || consent.errorTracking;

  useEffect(() => {
    previousUserId.current = reconcileIdentity(
      client,
      previousUserId.current,
      user?.email ? { id: user.id, email: user.email } : null,
      active,
    );
  }, [active, user?.id, user?.email]);

  return null;
}
