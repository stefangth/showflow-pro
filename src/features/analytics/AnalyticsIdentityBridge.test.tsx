import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
  consent: { analytics: false, sessionReplay: false, errorTracking: false },
  posthog: { identify: vi.fn(), reset: vi.fn() },
}));

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/features/consent/ConsentContext', () => ({ useConsent: () => ({ consent: state.consent }) }));
vi.mock('posthog-js', () => ({ default: state.posthog }));

import { AnalyticsIdentityBridge } from './AnalyticsIdentityBridge';

describe('AnalyticsIdentityBridge', () => {
  beforeEach(() => {
    state.user = null;
    state.consent = { analytics: false, sessionReplay: false, errorTracking: false };
    state.posthog.identify.mockClear();
    state.posthog.reset.mockClear();
  });

  it('identifies only after analytics consent is granted', async () => {
    state.user = { id: 'u1', email: 'a@example.com' };
    const view = render(<AnalyticsIdentityBridge />);
    expect(state.posthog.identify).not.toHaveBeenCalled();

    state.consent = { analytics: true, sessionReplay: false, errorTracking: false };
    view.rerender(<AnalyticsIdentityBridge />);

    await waitFor(() => expect(state.posthog.identify).toHaveBeenCalledWith('u1', { $email: 'a@example.com' }));
  });

  it('identifies with error-tracking-only consent and resets on sign-out', async () => {
    state.user = { id: 'u1', email: 'a@example.com' };
    state.consent = { analytics: false, sessionReplay: false, errorTracking: true };
    const view = render(<AnalyticsIdentityBridge />);
    await waitFor(() => expect(state.posthog.identify).toHaveBeenCalledTimes(1));

    state.user = null;
    view.rerender(<AnalyticsIdentityBridge />);
    await waitFor(() => expect(state.posthog.reset).toHaveBeenCalledTimes(1));
  });

  it('does not issue a duplicate reset when all telemetry consent is withdrawn', async () => {
    state.user = { id: 'u1', email: 'a@example.com' };
    state.consent = { analytics: true, sessionReplay: false, errorTracking: false };
    const view = render(<AnalyticsIdentityBridge />);
    await waitFor(() => expect(state.posthog.identify).toHaveBeenCalledTimes(1));

    state.consent = { analytics: false, sessionReplay: false, errorTracking: false };
    view.rerender(<AnalyticsIdentityBridge />);
    expect(state.posthog.reset).not.toHaveBeenCalled();
  });
});
