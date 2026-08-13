export interface IdentityClient {
  identify(distinctId: string, properties: { $email: string }): void;
  reset(): void;
}

export interface AnalyticsUser {
  id: string;
  email: string;
}

/**
 * Reconcile the currently authenticated user with the consented PostHog
 * identity. Full-consent withdrawal is reset by the PostHog consent state
 * machine, so this function makes no calls while telemetry is inactive.
 */
export function reconcileIdentity(
  client: IdentityClient,
  previousUserId: string | null,
  user: AnalyticsUser | null,
  active: boolean,
): string | null {
  if (!active) return null;

  if (!user) {
    if (previousUserId) client.reset();
    return null;
  }

  if (previousUserId && previousUserId !== user.id) client.reset();
  client.identify(user.id, { $email: user.email });
  return user.id;
}
