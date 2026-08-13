import { describe, expect, it, vi } from 'vitest';
import { captureUnsubscribeToken } from './unsubscribeToken';

describe('captureUnsubscribeToken', () => {
  it('returns the token while removing it from the address bar before effects run', () => {
    const replaceState = vi.fn();

    expect(captureUnsubscribeToken(
      { href: 'https://showflow.pro/unsubscribe?token=opaque-token&source=email' },
      { state: null, replaceState },
    )).toBe('opaque-token');

    expect(replaceState).toHaveBeenCalledWith(null, '', '/unsubscribe?source=email');
  });
});
