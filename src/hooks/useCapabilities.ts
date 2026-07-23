import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import {
  resolveAllCapabilities,
  resolveCapability,
  capabilityFor,
  CAPABILITY_REGISTRY,
  CAPABILITY_DEFS,
  type GrantableRole,
  type ResolvedCapability,
  type CapabilityDef,
  type CapabilitySource,
} from "@/lib/capabilities";
import { fetchCapabilityState } from "@/data/capabilities";

const EMPTY: Map<string, ResolvedCapability> = new Map();

/** The current org's fully-resolved capability map (layered: lock -> org -> platform -> registry). */
export function useResolvedCapabilities(): { resolved: Map<string, ResolvedCapability>; isLoading: boolean } {
  const { currentOrg } = useAuth();
  const q = useQuery({
    queryKey: ["capabilities", "state", currentOrg?.id],
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
  // Loading fallback returns the first held grantable role's registry default; the loaded path
  // unions across all held roles. Inert while every CAPABILITY_DEFS entry has role: "producer"
  // (revisit if artist-scoped defs are added).
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

export interface CapabilityMatrixCell {
  def: CapabilityDef;
  effective: boolean;
  locked: boolean;
  source: CapabilitySource;
  orgEnabled?: boolean;
  policyEnabled?: boolean | null;
  policyLocked: boolean;
}

/** Resolved matrix cells for an explicit org (platform console or the org's own Settings tab). */
export function useCapabilityMatrix(orgId: string | null): { cells: CapabilityMatrixCell[]; isLoading: boolean } {
  const q = useQuery({
    queryKey: ["capabilities", "state", orgId],
    queryFn: () => fetchCapabilityState(supabase, orgId!),
    enabled: !!orgId,
    staleTime: 60_000,
  });
  if (!q.data) return { cells: [], isLoading: q.isLoading };
  const orgByKey = new Map(q.data.overrides.map((r) => [r.capability, r]));
  const polByKey = new Map(q.data.policies.map((r) => [r.capability, r]));
  const cells = CAPABILITY_DEFS.map((def) => {
    const orgRow = orgByKey.get(def.key);
    const policyRow = polByKey.get(def.key);
    const r = resolveCapability(def.key, { orgRow, policyRow, registryDefault: def.defaultEnabled });
    return {
      def,
      effective: r.effective,
      locked: r.locked,
      source: r.source,
      orgEnabled: orgRow?.enabled,
      policyEnabled: policyRow?.enabled,
      policyLocked: policyRow?.locked ?? false,
    };
  });
  return { cells, isLoading: q.isLoading };
}
