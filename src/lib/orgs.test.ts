import { describe, expect, it } from 'vitest';
import { isOrgSuspended, orgOptionLabel } from './orgs';

describe('isOrgSuspended', () => {
  it('is true only for the suspended status', () => {
    expect(isOrgSuspended({ status: 'suspended' })).toBe(true);
    expect(isOrgSuspended({ status: 'active' })).toBe(false);
    expect(isOrgSuspended({ status: null })).toBe(false);
    expect(isOrgSuspended({})).toBe(false);
  });
});

describe('orgOptionLabel', () => {
  it('returns the bare name for an active org', () => {
    expect(orgOptionLabel({ name: 'Acme', status: 'active' })).toBe('Acme');
  });

  it('marks a suspended org inline, since a flat option has no room for a chip', () => {
    expect(orgOptionLabel({ name: 'Dormant Co', status: 'suspended' })).toBe('Dormant Co (suspended)');
  });
});
