
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { upsertOrgSetting } from "@/data/settings";
import { LETTERHEAD_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { Letterhead } from "@/components/settings/hireOrders/LetterheadCard";
import { useOrgLetterhead } from "@/hooks/useHireOrderSetup";
import { LetterheadFields } from "@/components/settings/hireOrders/fields/LetterheadFields";
import { linesFromText, mergeLetterhead, serializeLines } from "@/lib/hireOrders/letterhead";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDerivedDraft } from "@/hooks/useDerivedDraft";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** The rail's letterhead panel. Writes the SAME app_settings key through the SAME
 *  upsertOrgSetting call as the Settings card, so the Settings change-history rail
 *  picks these edits up and the two surfaces cannot drift.
 *
 *  It renders three of the six letterhead fields, so its save merges onto the stored
 *  value. Saving the compact object directly would erase the agent name, agent email
 *  and agent signature that only Settings renders. */
export function LetterheadStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }) {
  const { t } = useTranslation("hireOrdersPages");
  const qc = useQueryClient();
  const stored = useOrgLetterhead(orgId);

  // A view of the stored setting, not a copy seeded into state by an effect: Confirm
  // persists the form verbatim (merged onto the stored value), and a seeded copy is
  // still the blank DEFAULT in the commit that opens the isLoading gate below.
  const [form, setForm] = useDerivedDraft<Letterhead>(stored.data, LETTERHEAD_DEFAULT);
  const [addressText, setAddressText] = useDerivedDraft(
    stored.data && serializeLines(stored.data.address_lines),
    "",
  );

  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error(t("common.noActiveOrg"));
      const payload = mergeLetterhead(stored.data, {
        legal_name: form.legal_name,
        registration_line: form.registration_line,
        address_lines: linesFromText(addressText),
      });
      return upsertOrgSetting(supabase, orgId, "hire_order_letterhead", payload as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success(t("letterheadStep.saved"));
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Same guards as LetterheadCard, for the same reason. Rendering the form before the
  // read has landed (or after it failed) seeds it from LETTERHEAD_DEFAULT's blanks, and
  // Confirm then merges onto `undefined`: the agent name, agent email and agent
  // signature path are written back empty and the org's signature PNG is orphaned.
  if (stored.isLoading) return <Skeleton className="h-40 w-full" />;
  if (stored.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {t("letterheadStep.loadError", { message: (stored.error as Error).message })}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("letterheadStep.intro")}
      </p>
      <LetterheadFields
        idPrefix="rail-letterhead"
        value={form}
        addressText={addressText}
        onChange={setForm}
        onAddressTextChange={setAddressText}
      />
      <Button size="sm" disabled={save.isPending || !orgId} onClick={() => save.mutate()}>
        {t("letterheadStep.confirm")}
      </Button>
    </div>
  );
}
