import type { AppRole } from '@/config/app.config';

/**
 * Who may use editor mode: an admin of the active org, or a super-admin — including in
 * an org they hold no membership in.
 *
 * The super-admin arm is load-bearing, not a courtesy. `roles` comes from
 * `rolesForOrg(memberships, currentOrg.id)` and is membership-scoped, so a super-admin
 * viewing an org they never joined has none at all. Gating on `roles.includes('admin')`
 * alone would strip the whole toolbar — including the toggle that lets them back in —
 * the moment they switch orgs from inside editor mode.
 */
export function canUseEditor(roles: readonly AppRole[], isSuperAdmin: boolean): boolean {
  return isSuperAdmin || roles.includes('admin');
}
