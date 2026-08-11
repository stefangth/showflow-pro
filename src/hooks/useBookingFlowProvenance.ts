import { useAuth } from "@/features/auth/AuthContext";
import { useOrgAdminNames } from "@/hooks/useOrgAdminNames";
import { useSettingsAudit } from "@/hooks/useSettingsAudit";
import type { FirstRunProvenance, FirstRunRole } from "@/lib/dashboard/stageChain.types";

/**
 * Provenance for the first-run chain header's "Rules set by <name> · <date>" line.
 *
 * Admins can read the (admin-only-RLS) settings audit log, so they see who last touched
 * the org's booking-flow settings and when. Producers/artists can't read that table — the
 * audit query resolves empty for them, not an error — so they instead see the org's first
 * admin by name (no timestamp attached, since we don't know when that admin last changed
 * anything).
 *
 * Both source hooks are called unconditionally on every render (rules of hooks); only the
 * *composed return value* branches on role. `useOrgAdminNames` is still gated via its own
 * `enabled` option for admins, who never need it.
 */
export function useBookingFlowProvenance(role: FirstRunRole): FirstRunProvenance {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id;

  const audit = useSettingsAudit(["booking_flow"]);
  const adminNames = useOrgAdminNames(orgId, { enabled: role !== "admin" });

  if (role === "admin") {
    const latest = audit.data?.find((entry) => entry.key === "booking_flow") ?? null;
    return {
      byYou: true,
      actorName: latest?.actorName ?? null,
      changedAt: latest?.created_at ?? null,
    };
  }

  return {
    byYou: false,
    actorName: adminNames.data?.[0] ?? null,
    changedAt: null,
  };
}
