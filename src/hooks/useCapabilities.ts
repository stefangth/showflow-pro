import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { enabledCapabilities, CAPABILITY_REGISTRY, type CapabilityKey } from "@/lib/capabilities";
import { fetchCapabilities } from "@/data/capabilities";

/** The current org's enabled capability set. Missing rows fall back to each
 *  capability's registry default inside enabledCapabilities(). */
export function useCapabilities() {
  const { currentOrg } = useAuth();
  const q = useQuery({
    queryKey: ["capabilities", currentOrg?.id],
    queryFn: () => fetchCapabilities(supabase, currentOrg!.id),
    enabled: !!currentOrg,
    staleTime: 60_000,
  });
  return { capabilities: enabledCapabilities(q.data ?? []), isLoading: q.isLoading };
}

/** Whether a single capability is enabled for the current org. Returns the
 *  registry default while capabilities are still loading. */
export function useCapability(capability: CapabilityKey): boolean {
  const { capabilities, isLoading } = useCapabilities();
  if (isLoading) return CAPABILITY_REGISTRY[capability].defaultEnabled;
  return capabilities.has(capability);
}
