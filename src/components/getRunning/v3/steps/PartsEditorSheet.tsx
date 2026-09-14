import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useShowSlots } from "@/hooks/useShowSlots";
import { useSkills } from "@/hooks/useSkills";
import { useCan } from "@/hooks/useCapabilities";
import { saveShowSlots, type SlotDraft } from "@/data/slots";
import { CastingBreakdownFields } from "@/components/catalog/CastingBreakdownFields";
import { useInlineSkillCreate } from "@/components/skills/useInlineSkillCreate";
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
  // Same fail-closed read as ShowFormDialog: an errored catalog must not render as an empty
  // one, or every picker invites a duplicate of a skill the org already has.
  const { data: orgSkills, isError: skillsUnreadable } = useSkills();
  // A missing skill must be nameable here, where the breakdown is written. Creation is
  // `manage_skills`, separate from the save-pending flag that gates editing.
  const canManageSkills = useCan("manage_skills");
  const createSkillInline = useInlineSkillCreate(orgSkills ?? []);
  const slotsQ = useShowSlots(open ? showId : undefined);

  const [slots, setSlots] = useState<SlotDraft[]>([]);
  // Which show the draft was last seeded for, keyed on the open transition (not query-data
  // identity) so a mid-session refetch never clobbers in-progress edits. Mirrors
  // ShowFormDialog's `slotsSeededForRef`.
  const seededForRef = useRef<string | null>(null);

  // Open/close session seeding: reset on close, then seed once from the fetch,
  // ref-keyed on the open transition so a mid-session refetch never clobbers
  // in-progress edits. This is external-system synchronization (Radix keeps the
  // dialog mounted across close/reopen), not derived state — the render-time
  // "adjust during render" form observably double-renders here, so it stays an
  // effect. Only the reset-to-empty on close trips set-state-in-effect (the seed
  // from query data is an allowed external sync).
  useEffect(() => {
    if (!open) {
      seededForRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on close discards unsaved edits; see above
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
      // Same reason as ShowFormDialog's list: a slot row's required skills feed
      // `["skills", "gaps", ...]`, so requiring a skill here must refresh the gap read the
      // board's `skills` step and the assign panel both render from.
      queryClient.invalidateQueries({ queryKey: ["skills"] });
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
          onCreateSkill={createSkillInline}
          canCreateSkill={canManageSkills}
          skillsUnreadable={skillsUnreadable}
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
