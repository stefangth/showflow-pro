import { LayoutDashboard, BookOpen, Clock, Settings, Shield, MessageSquare, Users, Building2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ROUTES } from '@/config/app.config';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  roles?: string[];
  superAdmin?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.DASHBOARD, icon: LayoutDashboard, label: 'Dashboard' },
  { to: ROUTES.BOOKINGS, icon: BookOpen, label: 'Shows & Bookings', roles: ['admin', 'producer'] },
  { to: ROUTES.ARTISTS, icon: Users, label: 'Artists', roles: ['admin', 'producer'] },
  { to: ROUTES.AVAILABILITY, icon: Clock, label: 'Availability', roles: ['artist'] },
  { to: ROUTES.CHATS, icon: MessageSquare, label: 'Chats' },
  { to: ROUTES.ADMIN, icon: Shield, label: 'Admin', roles: ['admin'] },
  { to: ROUTES.SETTINGS, icon: Settings, label: 'Settings', roles: ['admin', 'producer'] },
  { to: ROUTES.PLATFORM, icon: Building2, label: 'Platform', superAdmin: true },
];

/** Base nav visibility (before editor view-as styling). */
export function visibleNavItems(
  items: NavItem[],
  ctx: { isEditorMode: boolean; isRealAdmin: boolean; isSuperAdmin: boolean; hasRole: (r: string) => boolean },
): NavItem[] {
  if (ctx.isEditorMode && ctx.isRealAdmin) {
    return items.filter((i) => !i.superAdmin || ctx.isSuperAdmin);
  }
  return items.filter((item) => {
    if (item.superAdmin) return ctx.isSuperAdmin;
    if (!item.roles) return true;
    return item.roles.some((r) => ctx.hasRole(r));
  });
}
