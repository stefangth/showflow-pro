import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { enabledFeatures, FEATURE_REGISTRY, type FeatureKey } from "@/lib/entitlements";
import { fetchEntitlements } from "@/data/entitlements";
import { isImpersonating } from "@/features/auth/orgRoles";

/** The current org's enabled feature set. Unresolved (missing) rows fall back
 *  to each feature's registry default inside enabledFeatures(). */
export function useEntitlements() {
  const { currentOrg } = useAuth();
  const q = useQuery({
    queryKey: ["entitlements", currentOrg?.id],
    queryFn: () => fetchEntitlements(supabase, currentOrg!.id),
    enabled: !!currentOrg,
    staleTime: 60_000,
  });
  return { features: enabledFeatures(q.data ?? []), isLoading: q.isLoading };
}

/** Whether a single feature is enabled for the current org. Returns the
 *  registry default while entitlements are still loading. */
export function useFeature(feature: FeatureKey): boolean {
  const { features, isLoading } = useEntitlements();
  if (isLoading) return FEATURE_REGISTRY[feature].defaultEnabled;
  return features.has(feature);
}

/**
 * Gate state for an in-page module surface (see ModuleGate). Differs from
 * useFeature in two deliberate ways:
 *
 *  - It does NOT fail open while entitlements load. useFeature reports a
 *    default-on module as enabled during that window, which for an in-page gate
 *    means mounting real write controls for an org that may turn out to be
 *    unentitled; those writes are rejected by the RLS floor, so the user gets a
 *    misleading failure. `pending` lets the caller render nothing instead.
 *  - It exempts super-admins, matching visibleNavItems ("Super-admins are never
 *    locked") and ProtectedRoute. Without it those two gates would admit a
 *    super-admin to a page whose every region this gate then blanked. The
 *    exemption is dropped while the super-admin is previewing another user or a
 *    role they do not hold via the editor "view as" toolbar (isImpersonating),
 *    so that preview faithfully reflects what the gated user would see.
 */
export function useModuleGate(feature: FeatureKey): { allow: boolean; pending: boolean } {
  const { features, isLoading } = useEntitlements();
  const { isSuperAdmin, roles, viewAsRole, viewAsUser } = useAuth();
  if (isSuperAdmin && !isImpersonating({ roles, viewAsRole, viewAsUser })) {
    return { allow: true, pending: false };
  }
  if (isLoading) return { allow: false, pending: true };
  return { allow: features.has(feature), pending: false };
}
