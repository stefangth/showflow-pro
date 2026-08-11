import { describe, it, expect } from 'vitest';
import { toErrorMessage } from './errors';

describe('toErrorMessage', () => {
  it("returns an Error's message", () => {
    expect(toErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('returns a duck-typed .message string (e.g. a supabase-js plain-object error)', () => {
    expect(toErrorMessage({ message: 'duplicate key value', code: '23505' }, 'fallback')).toBe('duplicate key value');
  });

  it('returns the fallback for a value without a string message', () => {
    expect(toErrorMessage('a bare string', 'fallback')).toBe('fallback');
    expect(toErrorMessage({ code: 'no-message' }, 'fallback')).toBe('fallback');
    expect(toErrorMessage(null, 'fallback')).toBe('fallback');
    expect(toErrorMessage(undefined, 'fallback')).toBe('fallback');
    expect(toErrorMessage({ message: 42 }, 'fallback')).toBe('fallback');
  });
});
