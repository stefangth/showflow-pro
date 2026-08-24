import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchGetRunningV3Enabled, setGetRunningV3Enabled } from "@/data/getRunningFlag";

/**
 * Effective "is the v3 Get running board live for this org" runtime flag: the org's
 * `getrunning_v3_enabled` app_settings override if present, else `true`. Wireflow v3 is
 * now the app default (the build-time `GETRUNNING_V3` env fork was retired from the
 * runtime path); `enabled` therefore defaults to `true` while the query is loading (or
 * when there is no active org), so first paint shows the v3 board and never flashes the
 * v1 one. An org falls back to v1 only via an explicit `false` override.
 */
export function useGetRunningV3Enabled(): { enabled: boolean; isLoading: boolean } {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const q = useQuery({
    queryKey: ["app-settings", "getrunning-v3-enabled", orgId],
    enabled: !!orgId,
    queryFn: () => fetchGetRunningV3Enabled(supabase, orgId),
  });
  return { enabled: q.data ?? true, isLoading: q.isLoading };
}

/**
 * Super-admin mutation to set (or clear) the org's v3 override. Requires an active org —
 * `setGetRunningV3Enabled` takes a non-null `orgId`, unlike the fetch side above, so the
 * mutation rejects up front when there is none rather than calling the data layer with a
 * null org id.
 */
export function useSetGetRunningV3Enabled(): UseMutationResult<void, unknown, boolean> {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => {
      if (!orgId) return Promise.reject(new Error("useSetGetRunningV3Enabled: no active org"));
      return setGetRunningV3Enabled(supabase, orgId, enabled);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app-settings"] }),
  });
}
