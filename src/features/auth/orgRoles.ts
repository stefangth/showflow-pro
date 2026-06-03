import type { AppRole } from "@/config/app.config";

/** The roles a user holds within one org (empty if org is null/absent). */
export function rolesForOrg(
  memberships: ReadonlyArray<{ org_id: string; role: AppRole }>,
  orgId: string | null,
): AppRole[] {
  if (!orgId) return [];
  return memberships.filter((m) => m.org_id === orgId).map((m) => m.role);
}
