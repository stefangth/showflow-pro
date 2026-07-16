import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { enabledFeatures, FEATURE_REGISTRY, type FeatureKey } from "@/lib/entitlements";
import { fetchEntitlements } from "@/data/entitlements";

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
