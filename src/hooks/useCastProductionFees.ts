import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchCastProductionFees,
  upsertCastProductionFee,
  deleteCastProductionFee,
  type CastProductionFee,
} from "@/data/castProductionFees";
import type { FeeBasis } from "@/lib/hireOrders/feeBasis";

export type { CastProductionFee };

/** Per-(cast x production) fee overrides for the active org, keyed on `orgId` (not the
 *  auth-context org) so callers scoped to a specific org can pass it explicitly. Kept
 *  intentionally separate from the org-default `["app-settings", ...]` domain: fee/document
 *  setup-rail `done` signals stay keyed on the org default row, not these per-cast rows. */
export function useCastProductionFees(orgId: string | null) {
  return useQuery({
    queryKey: ["cast-production-fees", orgId],
    enabled: !!orgId,
    queryFn: () => fetchCastProductionFees(supabase, orgId!),
  });
}

export function useUpsertCastProductionFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      orgId: string;
      castId: string;
      showId: string;
      feeAmount: number | null;
      currency: string;
      feeBasis: FeeBasis;
    }) => upsertCastProductionFee(supabase, args),
    onSuccess: (_data, { orgId }) => {
      qc.invalidateQueries({ queryKey: ["cast-production-fees", orgId] });
    },
  });
}

export function useDeleteCastProductionFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; orgId: string }) => deleteCastProductionFee(supabase, id),
    onSuccess: (_data, { orgId }) => {
      qc.invalidateQueries({ queryKey: ["cast-production-fees", orgId] });
    },
  });
}
