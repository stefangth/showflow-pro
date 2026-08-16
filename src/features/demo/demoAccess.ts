import type { Organization } from "@/data/orgs";

/** The demo chrome shows iff the active org is genuinely a demo org — for everyone,
 *  including super-admins. Never keyed off entitlements/ModuleGate (which exempt
 *  super-admins and would render demo chrome on real customer orgs). */
export function isDemoOrg(org: Organization | null): boolean {
  return org?.is_demo === true;
}
