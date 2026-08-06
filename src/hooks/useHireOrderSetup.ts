import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { hasOrgSettingRow, resolveOrgSetting } from "@/data/settings";
import { fetchTermsLibrary, importTermsTemplates } from "@/data/hireOrders";
import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";
import { normalizeTermsSetting } from "@/lib/hireOrders/terms";
import { HIRE_ORDER_DEFAULT_TERMS } from "@/config/app.config";
import { computeSetupStatus, type HireOrderSetupStatus } from "@/lib/hireOrders/setupStatus";

/** The org's own resolved terms setting, normalized. Shared by the status hook, the
 *  rail's terms step and the import mutation, so all three read one cache entry.
 *
 *  The fallback MUST stay identical to TermsVariantsCard's, which observes the same
 *  query key: two observers of one key with different fallbacks make the cached value
 *  depend on which surface mounted first, so the same import would append onto a
 *  different base depending on where it was started. */
export function useOrgTerms(orgId: string | null) {
  return useQuery({
    queryKey: ["app-settings", "hire_order_terms", orgId],
    enabled: !!orgId,
    queryFn: async () =>
      normalizeTermsSetting(
        await resolveOrgSetting<unknown>(supabase, orgId, "hire_order_terms", HIRE_ORDER_DEFAULT_TERMS),
      ),
  });
}

/**
 * Org-level hire-order setup readiness for the rail. Composes three reads and the pure
 * `computeSetupStatus`. Note the countersign read is a PRESENCE check, not a value
 * read: inheriting the manual default is not a decision (spec §1).
 */
export function useHireOrderSetupStatus(orgId: string | null): {
  status: HireOrderSetupStatus;
  isLoading: boolean;
} {
  const letterhead = useOrgLetterhead(orgId);
  const terms = useOrgTerms(orgId);
  const countersign = useQuery({
    queryKey: ["app-settings", "hire_order_countersign", "exists", orgId],
    enabled: !!orgId,
    queryFn: () => hasOrgSettingRow(supabase, orgId, "hire_order_countersign"),
  });

  const isLoading = !!orgId && (letterhead.isLoading || terms.isLoading || countersign.isLoading);
  // No `?? EMPTY_TERMS` fallback: an unread setting is passed through as undefined so
  // computeSetupStatus reports the step outstanding, rather than being told the org
  // genuinely holds an empty terms library.
  const status = computeSetupStatus({
    letterhead: letterhead.data ?? null,
    terms: terms.data,
    countersignChosen: countersign.data ?? false,
  });
  return { status, isLoading };
}

/** The org's resolved `hire_order_letterhead`.
 *
 *  One home for a query that five surfaces need (setup status, order blockers, the
 *  batch dialog, the rail's letterhead step, the preflight's inline fix). Inlining it
 *  per call site meant the key, the fallback and the `enabled` condition had to be kept
 *  identical by hand in eight places, and any drift would silently split the cache.
 *  Pass `null` to keep it idle, which is how callers gate on `open` or on an
 *  entitlement. */
export function useOrgLetterhead(orgId: string | null) {
  return useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    enabled: !!orgId,
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
  });
}

/** The platform terms library. Org-independent, so it is cached once per session.
 *
 *  Keyed under `app-settings`, NOT `hire-orders`: it is a platform app_settings row,
 *  and the hire-orders domain is invalidated wholesale after every draft, issue and
 *  resend (`invalidateHireOrders`). Under the old key a batch of ten issues refetched
 *  this row ten times and its staleTime never applied. */
export function useTermsLibrary() {
  return useQuery({
    queryKey: ["app-settings", "hire_order_terms_library"],
    queryFn: () => fetchTermsLibrary(supabase),
    staleTime: 5 * 60_000,
  });
}

/**
 * Copy the chosen library templates into the org's own terms setting.
 *
 * Refuses to run when the org's current terms have not been read. The merge APPENDS to
 * `current`, so substituting an empty set there would turn an import into a full
 * replacement of the org's authored contract library. The guard lives in the hook, not
 * in a caller's early return, because a caller opened on a cold cache (an issue
 * preflight, a batch repair) is exactly where a mistimed click would land.
 */
export function useImportTermsTemplates(orgId: string | null) {
  const qc = useQueryClient();
  const library = useTermsLibrary();
  const terms = useOrgTerms(orgId);
  return useMutation({
    mutationFn: ({ templateIds }: { templateIds: string[] }) => {
      if (!orgId) throw new Error("No active organization");
      const current = terms.data;
      if (!current) throw new Error("Terms could not be loaded. Reload and try again.");
      const chosen = (library.data ?? []).filter((t) => templateIds.includes(t.id));
      if (chosen.length === 0) throw new Error("Select a template to add");
      return importTermsTemplates(supabase, { orgId, current, templates: chosen });
    },
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      const name = next.templates.find((t) => t.id === next.default_id)?.name;
      toast.success(name ? `Terms added. Default is now "${name}".` : "Terms added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
