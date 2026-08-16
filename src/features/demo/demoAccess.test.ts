import { describe, it, expect } from 'vitest';
import { isDemoOrg } from '@/features/demo/demoAccess';

describe('isDemoOrg', () => {
  it('true only when the org is a demo', () => {
    expect(isDemoOrg({ id: 'o', name: 'n', slug: 's', status: 'active', is_demo: true })).toBe(true);
    expect(isDemoOrg({ id: 'o', name: 'n', slug: 's', status: 'active', is_demo: false })).toBe(false);
    expect(isDemoOrg(null)).toBe(false);
  });
});
