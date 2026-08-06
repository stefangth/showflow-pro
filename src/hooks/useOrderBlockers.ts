import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting } from "@/data/settings";
import { useCan } from "@/hooks/useCapabilities";
import { useOrgTerms } from "@/hooks/useHireOrderSetup";
import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";
import { computeBlockers, type Blocker } from "@/lib/hireOrders/preflight";
import type { HireOrderTermsSetting } from "@/lib/hireOrders/terms";
import type { OrderData } from "@/lib/hireOrders/types";

const EMPTY_TERMS: HireOrderTermsSetting = { templates: [], default_id: null };

export interface BlockableOrder {
  data: OrderData;
  terms_variant: string | null;
}

/**
 * Every reason one order cannot be issued yet, resolved against the org's current
 * settings and this viewer's capability. Both preflight surfaces and the edit-page
 * callout read this, so they can never disagree about what is blocking.
 *
 * Shares the `["app-settings", ...]` cache entries with the setup rail, so opening the
 * preflight sheet on an already-loaded page costs no extra round trips.
 */
export function useOrderBlockers(
  orgId: string | null,
  order: BlockableOrder | null | undefined,
): { blockers: Blocker[]; isLoading: boolean; isError: boolean; canEditSettings: boolean } {
  const canEditSettings = useCan("edit_hire_order_settings");
  const letterhead = useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    enabled: !!orgId,
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
  });
  const terms = useOrgTerms(orgId);

  const isLoading = !!orgId && (letterhead.isLoading || terms.isLoading);
  // Carried forward from plan 1's review: an unread setting is not an empty setting.
  // `?? EMPTY_TERMS` / `?? null` below still bias the blocker list toward blocking
  // (fail-safe for an issue gate), but a failed read must not be presented as "no
  // clauses configured" -- callers render `isError` honestly instead.
  const isError = !!orgId && (letterhead.isError || terms.isError);
  const blockers = order
    ? computeBlockers({
        data: order.data,
        letterhead: letterhead.data ?? null,
        terms: terms.data ?? EMPTY_TERMS,
        termsVariant: order.terms_variant,
        canEditSettings,
      })
    : [];

  return { blockers, isLoading, isError, canEditSettings };
}
