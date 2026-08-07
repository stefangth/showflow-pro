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

/**
 * Whether the UI is being previewed as someone other than the signed-in user's
 * real perspective: a specific impersonated user, or a role that perspective
 * does not already cover. This is the single predicate every view-as gate keys
 * off — the in-page ModuleGate, the nav lock, the route feature gate, and the
 * red editor-pencil indicator — so they cannot drift apart.
 *
 * The signed-in user's "real perspective" depends on who they are:
 *  - A super-admin's real view is god-mode (every module, every org), so
 *    previewing ANY specific role departs from it — even a role they also hold
 *    as an org member. Without this, a super-admin who is also an org admin
 *    could not preview the "module disabled" gate by choosing "Admin": the
 *    god-mode exemption stayed on and a disabled module rendered as enabled.
 *  - A non-super-admin's real view IS their org roles, so choosing a role they
 *    already hold is a no-op and NOT impersonation.
 */
export function isImpersonating(opts: {
  isSuperAdmin?: boolean;
  roles: AppRole[];
  viewAsRole: AppRole | null;
  viewAsUser: { roles: AppRole[] } | null;
}): boolean {
  const { isSuperAdmin = false, roles, viewAsRole, viewAsUser } = opts;
  if (viewAsUser != null) return true;
  if (viewAsRole == null) return false;
  return isSuperAdmin || !roles.includes(viewAsRole);
}

/** Which orgs the switcher lists: ALL orgs for super-admins, else the user's memberships. */
export function effectiveOrgs<T extends { id: string }>(isSuperAdmin: boolean, allOrgs: T[], membershipOrgs: T[]): T[] {
  return isSuperAdmin ? allOrgs : membershipOrgs;
}
