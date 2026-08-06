import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { hasOrgSettingRow, resolveOrgSetting } from "@/data/settings";
import { fetchTermsLibrary, importTermsTemplates } from "@/data/hireOrders";
import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";
import { normalizeTermsSetting, type HireOrderTermsSetting } from "@/lib/hireOrders/terms";
import { computeSetupStatus, type HireOrderSetupStatus } from "@/lib/hireOrders/setupStatus";

const EMPTY_TERMS: HireOrderTermsSetting = { templates: [], default_id: null };

/** The org's own resolved terms setting, normalized. Shared by the status hook, the
 *  rail's terms step and the import mutation, so all three read one cache entry. */
export function useOrgTerms(orgId: string | null) {
  return useQuery({
    queryKey: ["app-settings", "hire_order_terms", orgId],
    enabled: !!orgId,
    queryFn: async () =>
      normalizeTermsSetting(await resolveOrgSetting<unknown>(supabase, orgId, "hire_order_terms", null)),
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
  const letterhead = useQuery({
    queryKey: ["app-settings", "hire_order_letterhead", orgId],
    enabled: !!orgId,
    queryFn: () => resolveOrgSetting<Letterhead>(supabase, orgId, "hire_order_letterhead", LETTERHEAD_DEFAULT),
  });
  const terms = useOrgTerms(orgId);
  const countersign = useQuery({
    queryKey: ["app-settings", "hire_order_countersign", "exists", orgId],
    enabled: !!orgId,
    queryFn: () => hasOrgSettingRow(supabase, orgId, "hire_order_countersign"),
  });

  const isLoading = !!orgId && (letterhead.isLoading || terms.isLoading || countersign.isLoading);
  const status = computeSetupStatus({
    letterhead: letterhead.data ?? null,
    terms: terms.data ?? EMPTY_TERMS,
    countersignChosen: countersign.data ?? false,
  });
  return { status, isLoading };
}

/** The platform terms library. Org-independent, so it is cached once per session. */
export function useTermsLibrary() {
  return useQuery({
    queryKey: ["hire-orders", "terms-library"],
    queryFn: () => fetchTermsLibrary(supabase),
    staleTime: 5 * 60_000,
  });
}

/** Copy the chosen library templates into the org's own terms setting. */
export function useImportTermsTemplates(orgId: string | null) {
  const qc = useQueryClient();
  const library = useTermsLibrary();
  const terms = useOrgTerms(orgId);
  return useMutation({
    mutationFn: ({ templateIds }: { templateIds: string[] }) => {
      if (!orgId) throw new Error("No active organization");
      const chosen = (library.data ?? []).filter((t) => templateIds.includes(t.id));
      if (chosen.length === 0) throw new Error("Select a template to add");
      return importTermsTemplates(supabase, {
        orgId,
        current: terms.data ?? EMPTY_TERMS,
        templates: chosen,
      });
    },
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      const name = next.templates.find((t) => t.id === next.default_id)?.name;
      toast.success(name ? `Terms added. Default is now "${name}".` : "Terms added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
