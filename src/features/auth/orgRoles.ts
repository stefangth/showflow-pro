import type { AppRole } from "@/config/app.config";

/** The roles a user holds within one org (empty if org is null/absent). */
export function rolesForOrg(
  memberships: ReadonlyArray<{ org_id: string; role: AppRole }>,
  orgId: string | null,
): AppRole[] {
  if (!orgId) return [];
  return memberships.filter((m) => m.org_id === orgId).map((m) => m.role);
}

/** UI role check: editor impersonation wins, then super-admin sees all, then real roles. */
export function effectiveHasRole(opts: {
  isSuperAdmin: boolean;
  viewAsUser: { roles: AppRole[] } | null;
  viewAsRole: AppRole | null;
  roles: AppRole[];
  role: AppRole;
}): boolean {
  const { isSuperAdmin, viewAsUser, viewAsRole, roles, role } = opts;
  if (viewAsUser) return viewAsUser.roles.includes(role);
  if (viewAsRole !== null) return role === viewAsRole;
  if (isSuperAdmin) return true;
  return roles.includes(role);
}

/** Which orgs the switcher lists: ALL orgs for super-admins, else the user's memberships. */
export function effectiveOrgs<T extends { id: string }>(isSuperAdmin: boolean, allOrgs: T[], membershipOrgs: T[]): T[] {
  return isSuperAdmin ? allOrgs : membershipOrgs;
}
