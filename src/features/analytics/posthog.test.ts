import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsentChoices } from '@/features/consent/ConsentContext';
import {
  applyConsent,
  captureException,
  readAnalyticsConfig,
  resetAnalyticsForTests,
  type AnalyticsClient,
  type AnalyticsConfig,
} from './posthog';

function makeClient() {
  const client: AnalyticsClient = {
    init: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    reset: vi.fn(),
    set_config: vi.fn(),
    startSessionRecording: vi.fn(),
    stopSessionRecording: vi.fn(),
    captureException: vi.fn(),
  };
  return client;
}

const HOST = 'https://eu.i.posthog.com';
const configured: AnalyticsConfig = { key: 'phc_test', host: HOST };

const choices = (over: Partial<ConsentChoices> = {}): ConsentChoices => ({
  analytics: false,
  sessionReplay: false,
  errorTracking: false,
  ...over,
});

describe('readAnalyticsConfig', () => {
  it('reads the key and defaults the host to EU cloud', () => {
    const cfg = readAnalyticsConfig({ VITE_POSTHOG_KEY: 'phc_abc' });
    expect(cfg).toEqual({ key: 'phc_abc', host: HOST });
  });

  it('honours an explicit host override', () => {
    const cfg = readAnalyticsConfig({
      VITE_POSTHOG_KEY: 'phc_abc',
      VITE_POSTHOG_HOST: 'https://ph.example.com',
    });
    expect(cfg.host).toBe('https://ph.example.com');
  });

  it('leaves the key undefined when unset', () => {
    expect(readAnalyticsConfig({}).key).toBeUndefined();
  });
});

describe('applyConsent', () => {
  beforeEach(() => resetAnalyticsForTests());

  it('does nothing when PostHog is not configured (no key)', () => {
    const client = makeClient();
    applyConsent(client, { key: undefined, host: HOST }, choices({ analytics: true }));
    expect(client.init).not.toHaveBeenCalled();
    expect(client.opt_in_capturing).not.toHaveBeenCalled();
  });

  it('does not initialize while nothing is consented', () => {
    const client = makeClient();
    applyConsent(client, configured, choices());
    expect(client.init).not.toHaveBeenCalled();
    expect(client.opt_out_capturing).not.toHaveBeenCalled();
  });

  it('initializes opted-out-by-default with recording disabled when analytics is granted', () => {
    const client = makeClient();
    applyConsent(client, configured, choices({ analytics: true }));

    expect(client.init).toHaveBeenCalledTimes(1);
    const [key, opts] = (client.init as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(key).toBe('phc_test');
    expect(opts).toMatchObject({
      api_host: HOST,
      autocapture: true,
      capture_pageview: 'history_change',
      capture_exceptions: false,
      disable_session_recording: true,
      opt_out_capturing_by_default: true,
    });
    expect(client.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(client.stopSessionRecording).toHaveBeenCalled();
    expect(client.startSessionRecording).not.toHaveBeenCalled();
  });

  it('starts session recording only when analytics AND sessionReplay are on', () => {
    const client = makeClient();
    applyConsent(client, configured, choices({ analytics: true, sessionReplay: true }));
    expect(client.startSessionRecording).toHaveBeenCalledTimes(1);
    expect(client.stopSessionRecording).not.toHaveBeenCalled();
  });

  it('captures exceptions for error-tracking-only consent without pageviews or autocapture', () => {
    const client = makeClient();
    applyConsent(client, configured, choices({ errorTracking: true }));

    const [, opts] = (client.init as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts).toMatchObject({ autocapture: false, capture_pageview: false, capture_exceptions: true });
    expect(client.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(client.startSessionRecording).not.toHaveBeenCalled();
  });

  it('initializes once, then reconfigures on subsequent consent changes (no re-init)', () => {
    const client = makeClient();
    applyConsent(client, configured, choices({ analytics: true }));
    applyConsent(client, configured, choices({ analytics: true, sessionReplay: true, errorTracking: true }));

    expect(client.init).toHaveBeenCalledTimes(1);
    expect(client.set_config).toHaveBeenLastCalledWith({
      autocapture: true,
      capture_pageview: 'history_change',
      capture_exceptions: true,
    });
    expect(client.startSessionRecording).toHaveBeenCalled();
  });

  it('opts out and resets identity when all consent is withdrawn after being active', () => {
    const client = makeClient();
    applyConsent(client, configured, choices({ analytics: true, sessionReplay: true }));
    (client.opt_out_capturing as ReturnType<typeof vi.fn>).mockClear();

    applyConsent(client, configured, choices());

    expect(client.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(client.reset).toHaveBeenCalledTimes(1);
    expect(client.stopSessionRecording).toHaveBeenCalled();
    expect(client.init).toHaveBeenCalledTimes(1);
  });

  it('captures explicit exceptions only after error-tracking consent initialized PostHog', () => {
    const client = makeClient();
    const error = new Error('boom');

    expect(captureException(client, choices({ errorTracking: true }), error)).toBe(false);

    applyConsent(client, configured, choices({ errorTracking: true }));
    expect(captureException(client, choices(), error)).toBe(false);

    expect(captureException(client, choices({ errorTracking: true }), error)).toBe(true);
    expect(client.captureException).toHaveBeenCalledWith(error);
  });
});
