import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  consent: { analytics: false, sessionReplay: false, errorTracking: false },
  location: { pathname: '/login', search: '', hash: '' },
  applyConsent: vi.fn(),
  capturePageview: vi.fn(),
}));

vi.mock('@/features/consent/ConsentContext', () => ({ useConsent: () => ({ consent: state.consent }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => state.location }));
vi.mock('posthog-js', () => ({ default: {} }));
vi.mock('./posthog', () => ({
  applyConsent: state.applyConsent,
  capturePageview: state.capturePageview,
  readAnalyticsConfig: () => ({ key: 'phc_test', host: 'https://eu.i.posthog.com' }),
}));

import { AnalyticsBridge } from './AnalyticsBridge';

describe('AnalyticsBridge', () => {
  beforeEach(() => {
    state.consent = { analytics: false, sessionReplay: false, errorTracking: false };
    state.location = { pathname: '/login', search: '', hash: '' };
    state.applyConsent.mockClear();
    state.capturePageview.mockClear();
  });

  it('captures the current route when analytics is enabled after error-tracking-only consent', () => {
    state.consent = { analytics: false, sessionReplay: false, errorTracking: true };
    const view = render(<AnalyticsBridge />);
    expect(state.capturePageview).toHaveBeenCalledWith(expect.anything(), state.consent);

    state.consent = { analytics: true, sessionReplay: false, errorTracking: true };
    view.rerender(<AnalyticsBridge />);

    expect(state.applyConsent.mock.invocationCallOrder[1]).toBeLessThan(state.capturePageview.mock.invocationCallOrder[1]);
    expect(state.capturePageview).toHaveBeenLastCalledWith(expect.anything(), state.consent);
  });

  it('captures each browser route transition only while analytics is enabled', () => {
    state.consent = { analytics: true, sessionReplay: false, errorTracking: false };
    const view = render(<AnalyticsBridge />);
    state.location = { pathname: '/dashboard', search: '?tab=overview', hash: '' };
    view.rerender(<AnalyticsBridge />);

    expect(state.capturePageview).toHaveBeenCalledTimes(2);
  });
});
