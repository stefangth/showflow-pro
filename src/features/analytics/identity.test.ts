import { describe, expect, it, vi } from 'vitest';
import { reconcileIdentity, type IdentityClient } from './identity';

function makeClient(): IdentityClient & { identify: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> } {
  return { identify: vi.fn(), reset: vi.fn() };
}

describe('reconcileIdentity', () => {
  it('identifies a consented user using only their UUID and email', () => {
    const client = makeClient();

    expect(reconcileIdentity(client, null, { id: 'u1', email: 'a@example.com' }, true)).toBe('u1');
    expect(client.identify).toHaveBeenCalledWith('u1', { $email: 'a@example.com' });
  });

  it('does not identify without active analytics or error-tracking consent', () => {
    const client = makeClient();

    expect(reconcileIdentity(client, null, { id: 'u1', email: 'a@example.com' }, false)).toBeNull();
    expect(client.identify).not.toHaveBeenCalled();
    expect(client.reset).not.toHaveBeenCalled();
  });

  it('resets when an identified user signs out', () => {
    const client = makeClient();

    expect(reconcileIdentity(client, 'u1', null, true)).toBeNull();
    expect(client.reset).toHaveBeenCalledTimes(1);
  });

  it('resets before identifying when the authenticated user changes', () => {
    const client = makeClient();

    expect(reconcileIdentity(client, 'u1', { id: 'u2', email: 'b@example.com' }, true)).toBe('u2');
    expect(client.reset.mock.invocationCallOrder[0]).toBeLessThan(client.identify.mock.invocationCallOrder[0]);
    expect(client.identify).toHaveBeenCalledWith('u2', { $email: 'b@example.com' });
  });

  it('refreshes email without resetting when the UUID is unchanged', () => {
    const client = makeClient();

    expect(reconcileIdentity(client, 'u1', { id: 'u1', email: 'new@example.com' }, true)).toBe('u1');
    expect(client.reset).not.toHaveBeenCalled();
    expect(client.identify).toHaveBeenCalledWith('u1', { $email: 'new@example.com' });
  });
});
