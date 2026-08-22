import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { upsertOrgSetting } from "@/data/settings";
import { TermsLibraryPicker } from "@/components/settings/hireOrders/fields/TermsLibraryPicker";
import {
  useImportTermsTemplates, useOrgLetterhead, useOrgTerms, useTermsLibrary,
} from "@/hooks/useHireOrderSetup";
import { mergeLetterhead } from "@/lib/hireOrders/letterhead";
import { BLOCKER_COPY, type Blocker, type BlockerKey } from "@/lib/hireOrders/preflight";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Inline fix for `missing_letterhead`: the one field the gate actually checks.
 *  Merges onto the stored value so it cannot erase the agent fields (see
 *  mergeLetterhead). Everything else about the letterhead stays in Settings.
 *
 *  Guards on the read exactly like LetterheadStep.tsx: an unread setting is not an
 *  empty one, and rendering the form before `stored` has actually landed (or after it
 *  failed) would merge this one field onto LETTERHEAD_DEFAULT's blanks and silently
 *  erase agent_name / agent_email / agent_signature_path, which this compact control
 *  never renders and so can never carry forward on its own. */
function LetterheadFix({ orgId, idPrefix }: { orgId: string | null; idPrefix: string }) {
  const { t } = useTranslation("hireOrdersPages");
  const qc = useQueryClient();
  const stored = useOrgLetterhead(orgId);
  const [legalName, setLegalName] = useState("");
  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error(t("common.noActiveOrg"));
      if (!legalName.trim()) throw new Error(t("blockerList.enterLegalName"));
      const payload = mergeLetterhead(stored.data, { legal_name: legalName.trim() });
      return upsertOrgSetting(supabase, orgId, "hire_order_letterhead", payload as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success(t("blockerList.letterheadSaved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (stored.isLoading) return <Skeleton className="mt-2 h-16 w-full" />;
  if (stored.isError) {
    return (
      <Alert variant="destructive" className="mt-2">
        <AlertDescription>
          {t("blockerList.letterheadLoadError", { message: (stored.error as Error).message })}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <Label htmlFor={`${idPrefix}-legal-name`} className="text-xs">{t("blockerList.legalName")}</Label>
      <div className="flex gap-2">
        <Input
          id={`${idPrefix}-legal-name`}
          className="h-8"
          value={legalName}
          placeholder={t("blockerList.legalNamePlaceholder")}
          onChange={(e) => setLegalName(e.target.value)}
        />
        <Button size="sm" disabled={save.isPending || !orgId} onClick={() => save.mutate()}>
          {t("common.save")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("blockerList.savedForOrgOnce")}</p>
    </div>
  );
}

/** Inline fix for `missing_terms`: import a template from the platform library.
 *
 *  Guards on the org's own terms read: `useImportTermsTemplates` now THROWS when that
 *  read has not landed, precisely so an import can never replace a library it could not
 *  see. Rather than let a click surface that as a toast, the control itself does not
 *  render until the read is known good. */
function TermsFix({ orgId, idPrefix }: { orgId: string | null; idPrefix: string }) {
  const { t } = useTranslation("hireOrdersPages");
  const library = useTermsLibrary();
  const terms = useOrgTerms(orgId);
  const importTerms = useImportTermsTemplates(orgId);
  const [picked, setPicked] = useState<string[]>([]);

  if (terms.isLoading) return <Skeleton className="mt-2 h-16 w-full" />;
  if (terms.isError) {
    return (
      <Alert variant="destructive" className="mt-2">
        <AlertDescription>
          {t("blockerList.termsLoadError", { message: (terms.error as Error).message })}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <TermsLibraryPicker
        idPrefix={idPrefix}
        library={library.data ?? []}
        selectedIds={picked}
        alreadyHeldIds={(terms.data?.templates ?? []).map((t) => t.id)}
        onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
      />
      <Button
        size="sm"
        disabled={picked.length === 0 || importTerms.isPending || !orgId}
        onClick={() => importTerms.mutate({ templateIds: picked }, { onSuccess: () => setPicked([]) })}
      >
        {t("blockerList.createFromTemplate")}
      </Button>
    </div>
  );
}

export interface BlockerListProps {
  orgId: string | null;
  blockers: Blocker[];
  /** Order-scoped blockers are fixed on the order itself, not here. The caller
   *  decides what that means: the sheet navigates to the edit page, the edit page
   *  focuses the field. */
  onFixOrderField: (key: BlockerKey) => void;
  idPrefix?: string;
}

/** One row per blocker, with the inline fix where the viewer is allowed to make it.
 *  Shared by the single-order sheet and the edit-page callout so the wording and the
 *  affordances are identical wherever a producer meets the same gap. */
export function BlockerList({ orgId, blockers, onFixOrderField, idPrefix = "blocker" }: BlockerListProps) {
  const { t } = useTranslation("hireOrdersPages");
  return (
    <div className="space-y-2.5">
      {blockers.map((b) => (
        <div key={b.key} className="flex gap-2.5 rounded-l border border-border p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--amber-600)]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{BLOCKER_COPY[b.key].label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{BLOCKER_COPY[b.key].detail}</p>

            {b.scope === "order" && (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => onFixOrderField(b.key)}>
                {t("blockerList.openTheOrder")}
              </Button>
            )}
            {b.scope === "org" && b.fixable && b.key === "missing_letterhead" && (
              <LetterheadFix orgId={orgId} idPrefix={`${idPrefix}-lh`} />
            )}
            {b.scope === "org" && b.fixable && b.key === "missing_terms" && (
              <TermsFix orgId={orgId} idPrefix={`${idPrefix}-terms`} />
            )}
            {b.scope === "org" && !b.fixable && (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                <Lock className="h-3 w-3" />
                {t("blockerList.adminOnly")}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
