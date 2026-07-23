import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import {
  resolveAllCapabilities,
  capabilityFor,
  CAPABILITY_REGISTRY,
  type GrantableRole,
  type ResolvedCapability,
} from "@/lib/capabilities";
import { fetchCapabilityState } from "@/data/capabilities";

const EMPTY: Map<string, ResolvedCapability> = new Map();

/** The current org's fully-resolved capability map (layered: lock -> org -> platform -> registry). */
export function useResolvedCapabilities(): { resolved: Map<string, ResolvedCapability>; isLoading: boolean } {
  const { currentOrg } = useAuth();
  const q = useQuery({
    queryKey: ["capabilities", currentOrg?.id],
    queryFn: () => fetchCapabilityState(supabase, currentOrg!.id),
    enabled: !!currentOrg,
    staleTime: 60_000,
  });
  const resolved = q.data ? resolveAllCapabilities(q.data.overrides, q.data.policies) : EMPTY;
  return { resolved, isLoading: q.isLoading };
}

/** Whether the current user may perform `action` in the current org.
 *  Admins always may. While loading, falls back to the registry default for the user's role. */
export function useCan(action: string): boolean {
  const { hasRole } = useAuth();
  const { resolved, isLoading } = useResolvedCapabilities();
  if (hasRole("admin")) return true;
  for (const role of ["producer", "artist"] as GrantableRole[]) {
    if (!hasRole(role)) continue;
    const def = capabilityFor(role, action);
    if (!def) continue;
    if (isLoading) return def.defaultEnabled;
    if (resolved.get(def.key)?.effective) return true;
  }
  return false;
}

/** Back-compat: enabled set of capability keys for the current org. */
export function useCapabilities(): { capabilities: Set<string>; isLoading: boolean } {
  const { resolved, isLoading } = useResolvedCapabilities();
  const capabilities = new Set<string>();
  resolved.forEach((v, k) => { if (v.effective) capabilities.add(k); });
  return { capabilities, isLoading };
}

/** Back-compat single-key check (now layered). Returns the registry default while loading. */
export function useCapability(capability: string): boolean {
  const { resolved, isLoading } = useResolvedCapabilities();
  if (isLoading) return CAPABILITY_REGISTRY[capability]?.defaultEnabled ?? false;
  return resolved.get(capability)?.effective ?? false;
}
