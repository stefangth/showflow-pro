import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchOwnedSettingKeys } from "@/data/settings";

/** The two org settings whose PRESENCE (an org-owned row, not an inherited platform
 *  default) marks the v3 get-running `fee` and `document` steps done, mirroring how the
 *  flow/timing/countersign steps already test "a decision was made" (see
 *  `hasOrgSettingRow`/`fetchOwnedSettingKeys` in `src/data/settings.ts`).
 *
 *  Kept OUT of `HireOrderSetupStatus` on purpose: that status feeds the v1 hire-orders
 *  setup rail, whose only steps are letterhead/terms/countersign — Phase 3 must not grow
 *  that live v1 surface. The query key sits under `["app-settings", ...]` so the
 *  `OrderDefaultsCard` / `NumberingCard` `invalidateQueries(["app-settings"])` on save
 *  refreshes this read too, and the board reflects the new done state without a reload. */
const HIRE_ORDER_EXTRA_KEYS = ["hire_order_defaults", "hire_order_numbering"] as const;

export interface HireOrderExtraSetup {
  feeDone: boolean;
  documentDone: boolean;
}

export function useHireOrderExtraSetup(
  orgId: string | null,
): { status: HireOrderExtraSetup; isLoading: boolean } {
  const q = useQuery({
    queryKey: ["app-settings", "hire-order-extra", orgId],
    enabled: !!orgId,
    queryFn: () => fetchOwnedSettingKeys(supabase, orgId, HIRE_ORDER_EXTRA_KEYS),
  });
  const owned = q.data;
  return {
    status: {
      feeDone: owned?.has("hire_order_defaults") ?? false,
      documentDone: owned?.has("hire_order_numbering") ?? false,
    },
    isLoading: !!orgId && q.isLoading,
  };
}
