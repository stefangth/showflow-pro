import { LayoutDashboard, BookOpen, Clock, Settings, Shield, MessageSquare, Users, Building2, Theater, FileSignature } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ROUTES } from '@/config/app.config';
import type { FeatureKey } from '@/lib/entitlements';

export type NavSection = 'workspace' | 'catalog' | 'system';
export type NavBadge = 'pendingConfirmations' | 'openOffers' | 'awaitingCountersign';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  section: NavSection;
  badge?: NavBadge;
  roles?: string[];
  superAdmin?: boolean;
  /** Gate this item behind an org entitlement (Task 4's FEATURE_REGISTRY). */
  feature?: FeatureKey;
}

export const SECTION_LABELS: Record<NavSection, string> = {
  workspace: 'Workspace',
  catalog: 'Catalog',
  system: 'System',
};

const SECTION_ORDER: NavSection[] = ['workspace', 'catalog', 'system'];

export const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.DASHBOARD, icon: LayoutDashboard, label: 'Dashboard', section: 'workspace' },
  { to: ROUTES.BOOKINGS, icon: BookOpen, label: 'Shows & Bookings', section: 'workspace', roles: ['admin', 'producer'], badge: 'pendingConfirmations' },
  { to: ROUTES.HIRE_ORDERS, icon: FileSignature, label: 'Hire orders', section: 'workspace', roles: ['admin', 'producer'], feature: 'hire_orders', badge: 'awaitingCountersign' },
  { to: ROUTES.AVAILABILITY, icon: Clock, label: 'Availability', section: 'workspace', roles: ['artist'], badge: 'openOffers' },
  { to: ROUTES.CHATS, icon: MessageSquare, label: 'Chats', section: 'workspace' },
  { to: ROUTES.PRODUCTIONS, icon: Theater, label: 'Productions', section: 'catalog', roles: ['admin', 'producer'] },
  { to: ROUTES.ARTISTS, icon: Users, label: 'Artists', section: 'catalog', roles: ['admin', 'producer'] },
  { to: ROUTES.ADMIN, icon: Shield, label: 'Admin', section: 'system', roles: ['admin'] },
  { to: ROUTES.SETTINGS, icon: Settings, label: 'Settings', section: 'system', roles: ['admin', 'producer'] },
  { to: ROUTES.PLATFORM, icon: Building2, label: 'Platform', section: 'system', superAdmin: true },
];

/** A nav item resolved for one viewer. `locked` means "show it, grayed and inert":
 *  the org does not have the module, but hiding it entirely leaves members unable
 *  to tell the module exists. Super-admins are never locked — they administer
 *  entitlements, and ProtectedRoute lets them through to the off-state page. */
export type VisibleNavItem = NavItem & { locked: boolean };

export interface NavSectionGroup<T extends NavItem = NavItem> { section: NavSection; label: string; items: T[]; }

/** Group already role-filtered items by section, in fixed order, dropping empty sections. */
export function groupNavBySections<T extends NavItem>(items: T[]): NavSectionGroup<T>[] {
  return SECTION_ORDER
    .map((section) => ({ section, label: SECTION_LABELS[section], items: items.filter((i) => i.section === section) }))
    .filter((g) => g.items.length > 0);
}

/** Base nav visibility (before editor view-as styling). */
export function visibleNavItems(
  items: NavItem[],
  ctx: {
    isEditorMode: boolean;
    isRealAdmin: boolean;
    isSuperAdmin: boolean;
    hasRole: (r: string) => boolean;
    enabledFeatures: Set<string>;
  },
): VisibleNavItem[] {
  // Entitlement no longer HIDES an item, it LOCKS it: a member who cannot use a
  // module should still be able to see that it exists. Super-admins are never
  // locked, consistent with ProtectedRoute exempting them from the route-level
  // feature gate. Role gating below is unchanged and still hides outright.
  const lock = (item: NavItem): VisibleNavItem => ({
    ...item,
    locked: !!item.feature && !ctx.isSuperAdmin && !ctx.enabledFeatures.has(item.feature),
  });

  if (ctx.isEditorMode && ctx.isRealAdmin) {
    return items.filter((i) => !i.superAdmin || ctx.isSuperAdmin).map(lock);
  }
  return items
    .filter((item) => {
      if (item.superAdmin) return ctx.isSuperAdmin;
      if (!item.roles) return true;
      return item.roles.some((r) => ctx.hasRole(r));
    })
    .map(lock);
}
