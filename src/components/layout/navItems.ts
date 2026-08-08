import { LayoutDashboard, BookOpen, Clock, Settings, Shield, MessageSquare, Users, Building2, Theater, FileSignature } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ROUTES, type AppRole } from '@/config/app.config';
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
  { to: ROUTES.AVAILABILITY, icon: Clock, label: 'Availability', section: 'workspace', roles: ['artist'], feature: 'booking_flow', badge: 'openOffers' },
  { to: ROUTES.CHATS, icon: MessageSquare, label: 'Chats', section: 'workspace' },
  { to: ROUTES.PRODUCTIONS, icon: Theater, label: 'Productions', section: 'catalog', roles: ['admin', 'producer'] },
  { to: ROUTES.ARTISTS, icon: Users, label: 'Artists', section: 'catalog', roles: ['admin', 'producer'] },
  { to: ROUTES.ADMIN, icon: Shield, label: 'Admin', section: 'system', roles: ['admin'] },
  { to: ROUTES.SETTINGS, icon: Settings, label: 'Settings', section: 'system', roles: ['admin', 'producer'] },
  { to: ROUTES.PLATFORM, icon: Building2, label: 'Platform', section: 'system', superAdmin: true },
];

/** A nav item resolved for one viewer. `locked` means "show it, grayed and inert":
 *  the org does not have the module, but hiding it entirely leaves members unable
 *  to tell the module exists. Super-admins are not locked (they administer
 *  entitlements, and ProtectedRoute lets them through to the off-state page),
 *  except while previewing another user or any specific role via the editor
 *  "view as" toolbar, when they see that perspective's locks. See isImpersonating. */
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
    entitlementsLoading: boolean;
    impersonating?: boolean;
  },
): VisibleNavItem[] {
  // Entitlement no longer HIDES an item, it LOCKS it: a member who cannot use a
  // module should still be able to see that it exists. Super-admins are not
  // locked (consistent with ProtectedRoute exempting them from the route-level
  // feature gate), except while previewing another user via view-as (see the
  // lock closure below). While entitlements are still loading, fail OPEN (never lock)
  // so an entitled org doesn't see the item flash locked for one round-trip,
  // matching ProtectedRoute and HireOrdersPage's fail-open loading behavior.
  // Role gating below is unchanged and still hides outright.
  const lock = (item: NavItem): VisibleNavItem => ({
    ...item,
    // Super-admins are normally never locked, but a super-admin previewing another
    // user or any specific role via the editor "view as" toolbar should see that
    // perspective's locks.
    locked: !ctx.entitlementsLoading && !!item.feature
      && (!ctx.isSuperAdmin || !!ctx.impersonating)
      && !ctx.enabledFeatures.has(item.feature),
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

/**
 * Should this item read as "hidden for the previewed perspective" in editor mode?
 * When true the sidebar dims it and stamps an EyeOff, so a super-admin previewing
 * a role/user can see which entries that perspective would NOT have — without the
 * item actually disappearing (view-as never removes items, only annotates them).
 *
 * Two independent gates decide real visibility, so both are checked here:
 *  - `superAdmin` items are visible ONLY to super-admins. No previewable perspective
 *    is ever a super-admin — `viewAsRole` is an AppRole (admin/producer/artist) and
 *    `viewAsUser` carries only org roles — so any active preview hides them. Missing
 *    this axis is why Platform never dimmed (it has no `roles`, only `superAdmin`).
 *  - `roles` items are visible to those roles; an item with neither gate (Dashboard,
 *    Chats) is universal and never dimmed.
 */
export function isHiddenForViewAs(
  item: NavItem,
  ctx: { isEditorMode: boolean; viewAsRole: AppRole | null; viewAsUser: { roles: AppRole[] } | null },
): boolean {
  if (!ctx.isEditorMode) return false;
  const impersonating = !!ctx.viewAsUser || ctx.viewAsRole !== null;
  if (item.superAdmin) return impersonating;
  if (!item.roles) return false;
  if (ctx.viewAsUser) return !item.roles.some((r) => ctx.viewAsUser!.roles.includes(r as AppRole));
  if (ctx.viewAsRole === null) return false;
  return !item.roles.includes(ctx.viewAsRole);
}
