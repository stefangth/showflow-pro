import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchBookingFlow } from "@/data/settings";

/** The org's effective (normalized) booking-flow policy. Thin wrapper over fetchBookingFlow. */
export function useBookingFlow() {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  return useQuery({
    queryKey: ["app-settings", "booking-flow", orgId],
    queryFn: () => fetchBookingFlow(supabase, orgId),
  });
}
