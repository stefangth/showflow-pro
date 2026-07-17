import { LayoutDashboard, BookOpen, Clock, Settings, Shield, MessageSquare, Users, Building2, Theater } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ROUTES } from '@/config/app.config';
import type { FeatureKey } from '@/lib/entitlements';

export type NavSection = 'workspace' | 'catalog' | 'system';
export type NavBadge = 'pendingConfirmations' | 'openOffers';

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
  { to: ROUTES.AVAILABILITY, icon: Clock, label: 'Availability', section: 'workspace', roles: ['artist'], badge: 'openOffers' },
  { to: ROUTES.CHATS, icon: MessageSquare, label: 'Chats', section: 'workspace' },
  { to: ROUTES.PRODUCTIONS, icon: Theater, label: 'Productions', section: 'catalog', roles: ['admin', 'producer'] },
  { to: ROUTES.ARTISTS, icon: Users, label: 'Artists', section: 'catalog', roles: ['admin', 'producer'] },
  { to: ROUTES.ADMIN, icon: Shield, label: 'Admin', section: 'system', roles: ['admin'] },
  { to: ROUTES.SETTINGS, icon: Settings, label: 'Settings', section: 'system', roles: ['admin', 'producer'] },
  { to: ROUTES.PLATFORM, icon: Building2, label: 'Platform', section: 'system', superAdmin: true },
];

export interface NavSectionGroup { section: NavSection; label: string; items: NavItem[]; }

/** Group already role-filtered items by section, in fixed order, dropping empty sections. */
export function groupNavBySections(items: NavItem[]): NavSectionGroup[] {
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
): NavItem[] {
  // Entitlement gate applies to every viewer first. Super-admins bypass it
  // (god-mode), consistent with ProtectedRoute exempting super-admins from the
  // route-level feature gate — so a super-admin sees the sidebar link for any
  // gated route they can already reach by direct URL. Editor-mode admins who
  // aren't super-admins stay gated.
  items = items.filter(
    (item) => !item.feature || ctx.isSuperAdmin || ctx.enabledFeatures.has(item.feature),
  );

  if (ctx.isEditorMode && ctx.isRealAdmin) {
    return items.filter((i) => !i.superAdmin || ctx.isSuperAdmin);
  }
  return items.filter((item) => {
    if (item.superAdmin) return ctx.isSuperAdmin;
    if (!item.roles) return true;
    return item.roles.some((r) => ctx.hasRole(r));
  });
}
