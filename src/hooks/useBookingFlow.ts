import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchBookingFlow } from "@/data/settings";
import { fetchCustomFieldDefs } from "@/data/customFields";

/** The org's effective (normalized) booking-flow policy. Thin wrapper over fetchBookingFlow. */
export function useBookingFlow() {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
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
