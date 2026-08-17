import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, groupNavBySections, visibleNavItems } from './navItems';
import { ROUTES } from '@/config/app.config';

const ctx = { isEditorMode: false, isRealAdmin: false, isSuperAdmin: false,
  hasRole: () => true, enabledFeatures: new Set<string>(), entitlementsLoading: false };

describe('nav IA', () => {
  it('has a Get running item first in workspace', () => {
    const ws = NAV_ITEMS.filter(i => i.section === 'workspace');
    expect(ws[0].to).toBe(ROUTES.GET_RUNNING);
  });
  it('Help lives in the system section', () => {
    const help = NAV_ITEMS.find(i => i.to === ROUTES.HELP);
    expect(help?.section).toBe('system');
  });
  it('has no Admin nav item', () => {
    expect(NAV_ITEMS.some(i => i.to === ROUTES.ADMIN)).toBe(false);
  });
  it('Get running stays first after visibility filtering and section grouping', () => {
    const visible = visibleNavItems(NAV_ITEMS, ctx);
    const groups = groupNavBySections(visible);
    const workspace = groups.find(g => g.section === 'workspace');
    expect(workspace?.items[0]?.to).toBe(ROUTES.GET_RUNNING);
  });
});
