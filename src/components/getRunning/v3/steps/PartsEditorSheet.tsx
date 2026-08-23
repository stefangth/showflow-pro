import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useShowSlots } from "@/hooks/useShowSlots";
import { useSkills } from "@/hooks/useSkills";
import { saveShowSlots, type SlotDraft } from "@/data/slots";
import { CastingBreakdownFields } from "@/components/catalog/CastingBreakdownFields";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

export interface PartsEditorSheetProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgId: string;
  showId: string;
  /** Production name, interpolated into the sheet title. */
  showLabel: string;
  onSaved?: () => void;
}

/**
 * A slide-in Sheet (Wireflow v3 Phase 2, Task 10) editing ONE production's casting
 * breakdown, opened from the `productions` step (Task 11) for a row whose breakdown
 * still needs setting up. Reuses `CastingBreakdownFields` as the body, unchanged, and
 * saves through the same `saveShowSlots` data-access function and query-key
 * invalidation list as `ShowFormDialog` — the two surfaces write the same rows, so
 * they must bust the same downstream caches (derived `shows.main_cast_slots`/
 * `understudy_slots`, `show_required_skills`, eligibility, and offer-tier reads).
 *
 * Seeds from `useShowSlots`, gated to fetch only while the sheet is open (`open ?
 * showId : undefined`), into a local editable draft. Closing (or a fresh open for a
 * different show) resets the seeded-for tracking so the next open re-seeds instead of
 * reusing a stale draft.
 */
export function PartsEditorSheet({
  open,
  onOpenChange,
  orgId,
  showId,
  showLabel,
  onSaved,
}: PartsEditorSheetProps): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const queryClient = useQueryClient();
  const { data: orgSkills } = useSkills();
  const slotsQ = useShowSlots(open ? showId : undefined);

  const [slots, setSlots] = useState<SlotDraft[]>([]);
  // Which show the draft was last seeded for, keyed on the open transition (not query-data
  // identity) so a mid-session refetch never clobbers in-progress edits. Mirrors
  // ShowFormDialog's `slotsSeededForRef`.
  const seededForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      seededForRef.current = null;
      setSlots([]);
      return;
    }
    if (seededForRef.current === showId) return;
    if (slotsQ.data === undefined) return; // wait for the fetch
    seededForRef.current = showId;
    setSlots(slotsQ.data);
  }, [open, showId, slotsQ.data]);

  const saveMutation = useMutation({
    mutationFn: () => saveShowSlots(supabase, { showId, orgId, slots }),
    onSuccess: () => {
      // Same invalidation list as ShowFormDialog's `saveSlots` — both write show_slots
      // and must bust every domain the derived caches feed.
      queryClient.invalidateQueries({ queryKey: ["show-slots"] });
      queryClient.invalidateQueries({ queryKey: ["shows"] });
      queryClient.invalidateQueries({ queryKey: ["show-dates"] });
      queryClient.invalidateQueries({ queryKey: ["eligibility"] });
      queryClient.invalidateQueries({ queryKey: ["eligible-artists"] });
      queryClient.invalidateQueries({ queryKey: ["artist-eligible-dates"] });
      queryClient.invalidateQueries({ queryKey: ["offer-tiers"] });
      toast.success(t("body.parts.savedToast"));
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e) => {
      toast.error((e as Error).message);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t("body.parts.title", { name: showLabel })}</SheetTitle>
        </SheetHeader>

        <CastingBreakdownFields
          value={slots}
          onChange={setSlots}
          skills={orgSkills ?? []}
          disabled={saveMutation.isPending}
        />

        <SheetFooter>
          <Button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {t("body.parts.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
