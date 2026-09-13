import { describe, it, expect } from 'vitest';
import { isDemoOrg } from '@/features/demo/demoAccess';

describe('isDemoOrg', () => {
  it('true only when the org is a demo', () => {
    expect(isDemoOrg({ id: 'o', name: 'n', slug: 's', status: 'active', is_demo: true, org_kind: "production", org_kind_set_at: null })).toBe(true);
    expect(isDemoOrg({ id: 'o', name: 'n', slug: 's', status: 'active', is_demo: false, org_kind: "production", org_kind_set_at: null })).toBe(false);
    expect(isDemoOrg(null)).toBe(false);
  });
});
