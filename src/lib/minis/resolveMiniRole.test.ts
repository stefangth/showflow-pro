import { describe, it, expect } from 'vitest';
import { resolveMiniRole, type MiniRoleCtx } from './resolveMiniRole';
import type { MiniDef, MiniSteps } from './types';

const s = [] as unknown as MiniSteps;
const def = (variants: MiniDef['variants']): MiniDef => ({
  page: 'settings',
  route: '/settings',
  eyebrow: { en: '', de: '' },
  variants,
});
const ctx = (o: { role?: 'admin' | 'producer' | 'artist'; isSuperAdmin?: boolean; impersonating?: boolean }): MiniRoleCtx => ({
  hasRole: (r) => o.role === r,
  isSuperAdmin: o.isSuperAdmin ?? false,
  impersonating: o.impersonating ?? false,
});

describe('resolveMiniRole', () => {
  it('picks producer for a producer viewer', () => {
    expect(resolveMiniRole(def({ admin: s, producer: s }), ctx({ role: 'producer' }))).toBe('producer');
  });
  it('picks admin for an admin viewer', () => {
    expect(resolveMiniRole(def({ admin: s, producer: s }), ctx({ role: 'admin' }))).toBe('admin');
  });
  it('picks artist for an artist-only def', () => {
    expect(resolveMiniRole(def({ artist: s }), ctx({ role: 'artist' }))).toBe('artist');
  });
  it('super-admin without a super variant falls back to admin', () => {
    expect(resolveMiniRole(def({ admin: s }), ctx({ isSuperAdmin: true }))).toBe('admin');
  });
  it('super-admin without a super variant falls back to the only variant (artist)', () => {
    expect(resolveMiniRole(def({ artist: s }), ctx({ isSuperAdmin: true }))).toBe('artist');
  });
  it('super-admin with a super variant uses it', () => {
    expect(resolveMiniRole(def({ admin: s, super: s }), ctx({ isSuperAdmin: true }))).toBe('super');
  });
  it('impersonating super-admin follows the impersonated role', () => {
    expect(
      resolveMiniRole(def({ admin: s, producer: s, super: s }), ctx({ role: 'producer', isSuperAdmin: true, impersonating: true })),
    ).toBe('producer');
  });
  it('returns null when the viewer has no variant', () => {
    expect(resolveMiniRole(def({ admin: s }), ctx({ role: 'artist' }))).toBeNull();
  });
});
