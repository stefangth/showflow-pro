import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchBookingFlow, fetchFlowTimes } from "@/data/settings";
import { fetchCustomFieldDefs } from "@/data/customFields";

/** The org's effective (normalized) booking-flow policy. Thin wrapper over fetchBookingFlow.
 *
 *  Defaults to the shell's active org. Pass `orgOverride` from a surface that is already
 *  keyed on an org id of its own (TimingStep seeds and resets on an `orgId` prop) so the
 *  flow and the rest of that surface cannot be resolved from two independent sources: the
 *  org switcher lives in the app shell and does not unmount those panels, so a window where
 *  the two disagree would narrate one org's flow beside another org's values. */
export function useBookingFlow(orgOverride?: string | null) {
  const { currentOrg } = useAuth();
  const orgId = orgOverride !== undefined ? orgOverride : currentOrg?.id ?? null;
  return useQuery({
    queryKey: ["app-settings", "booking-flow", orgId],
    queryFn: () => fetchBookingFlow(supabase, orgId),
  });
}

/**
 * The org's reference-field policy plus the resolved custom-field key (when the
 * source is a custom field). Feeds `referenceLabel` at booking-row display sites.
 */
export function useReferenceField() {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const flowQ = useBookingFlow();
  const reference = flowQ.data?.reference_field ?? { source: "show" as const };
  const defsQ = useQuery({
    queryKey: ["custom-fields", "show_dates", orgId],
    queryFn: () => fetchCustomFieldDefs(supabase, { orgId, entity: "show_dates" }),
    enabled: Boolean(orgId) && reference.source === "custom",
  });
  const customFieldKey =
    reference.source === "custom"
      ? (defsQ.data ?? []).find((d) => d.id === reference.custom_field_id)?.key ?? null
      : null;
  return { reference, customFieldKey };
}

/** The org's effective offer window and digest hours, for lifecycle previews and the
 *  rehearsal footer. */
export function useFlowTimes(orgId: string | null) {
  return useQuery({
    queryKey: ["app-settings", "flow-times", orgId],
    enabled: !!orgId,
    queryFn: () => fetchFlowTimes(supabase, orgId),
  });
}
