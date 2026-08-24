import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useCreateShow, useUpdateShow, type ShowWithStats } from "@/hooks/useShows";
import { useSkills } from "@/hooks/useSkills";
import { useShowSlots } from "@/hooks/useShowSlots";
import { saveShowSlots, type SlotDraft } from "@/data/slots";
import { isSyncedShow, nextSortOrder } from "@/lib/catalog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CastingBreakdownFields } from "@/components/catalog/CastingBreakdownFields";
import { CityCatalogField } from "@/components/catalog/CityCatalogField";
import { useInlineSkillCreate } from "@/components/skills/useInlineSkillCreate";

const baseSchema = z.object({
  program: z.string().trim().optional().or(z.literal("")),
  subProgram: z.string().trim().optional().or(z.literal("")),
  category: z.string().trim().optional().or(z.literal("")),
  description: z.string().trim().optional().or(z.literal("")),
});
type FormValues = z.infer<typeof baseSchema>;

export function ShowFormDialog({
  open, onOpenChange, show, allShows, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  show?: ShowWithStats | null;
  allShows: ShowWithStats[];
  onSaved?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation("productions");
  const { user, currentOrg } = useAuth();
  const canEditScheduling = useCan("edit_scheduling");
  const schema = useMemo(
    () => baseSchema.refine((v) => !!(v.program || v.subProgram), {
      message: t("form.validation.programOrSubRequired"), path: ["program"],
    }),
    // `i18n.language` forces this to recompute on every real language change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, i18n.language],
  );
  const isEdit = !!show;
  const synced = !!show && isSyncedShow(show);
  const createShow = useCreateShow();
  const updateShow = useUpdateShow();
  const queryClient = useQueryClient();
  const pending = createShow.isPending || updateShow.isPending;
  // Slots ARE the production's scheduling configuration (they derive its main/understudy
  // totals), so the whole repeater is gated by the same capability that gated the old
  // slot-count fields.
  const slotsDisabled = !canEditScheduling || pending;

  const { data: orgSkills } = useSkills();
  // Growing the skill catalog is `manage_skills`, not the `edit_scheduling` behind
  // `slotsDisabled`: a producer may be allowed to write the breakdown without being
  // allowed to invent skills.
  const canManageSkills = useCan("manage_skills");
  const createSkillInline = useInlineSkillCreate(orgSkills ?? []);
  // The named slot rows the production authors (role name, count, main/understudy,
  // per-slot required skills). shows.main_cast_slots/understudy_slots and
  // show_required_skills are trigger-maintained caches derived from these.
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  // Which (open session, show identity) the slot repeater was last seeded for. The
  // dialog instance stays mounted across close/reopen (ProductionsPage), so seeding is
  // keyed on the open transition, not query-data identity: a mid-session refetch (or a
  // structurally-shared reference) must not clobber in-progress edits, and an unsaved
  // add/remove must never leak into the next session's save.
  const slotsSeededForRef = useRef<string | null>(null);
  // Show id created in the current open session; a retry after a failed slot save
  // reuses it instead of creating a duplicate show.
  const createdShowIdRef = useRef<string | null>(null);

  const slotsQ = useShowSlots(open ? show?.id : undefined);
  useEffect(() => {
    if (!open) {
      // Closing discards unsaved slot edits (they must never survive into the next
      // session's save) and ends the create session.
      slotsSeededForRef.current = null;
      createdShowIdRef.current = null;
      setSlots([]);
      return;
    }
    const identity = show?.id ?? "__create__";
    if (slotsSeededForRef.current === identity) return;
    if (show?.id && slotsQ.data === undefined) return; // edit mode: wait for the fetch
    slotsSeededForRef.current = identity;
    setSlots(show?.id ? (slotsQ.data ?? []) : []);
  }, [open, show?.id, slotsQ.data]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      program: show?.program ?? "", subProgram: show?.sub_program ?? "",
      category: show?.category ?? "", description: show?.description ?? "",
    },
  });
  useEffect(() => {
    if (open) form.reset({
      program: show?.program ?? "", subProgram: show?.sub_program ?? "",
      category: show?.category ?? "", description: show?.description ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, show]);

  /** Reconcile the show's slot rows, then bust every domain the derived caches feed.
   *  Returns whether the save applied; the caller keeps the dialog open on failure so
   *  a retry (idempotent thanks to the client-minted ids) can finish. */
  const saveSlots = async (targetShowId: string, orgId: string): Promise<boolean> => {
    try {
      await saveShowSlots(supabase, { showId: targetShowId, orgId, slots });
      return true;
    } catch (e) {
      toast.error(t("form.toasts.saveSlotsFailed"), { description: (e as Error).message });
      return false;
    } finally {
      queryClient.invalidateQueries({ queryKey: ["show-slots"] });
      queryClient.invalidateQueries({ queryKey: ["shows"] });
      queryClient.invalidateQueries({ queryKey: ["show-dates"] });
      queryClient.invalidateQueries({ queryKey: ["eligibility"] });
      queryClient.invalidateQueries({ queryKey: ["eligible-artists"] });
      queryClient.invalidateQueries({ queryKey: ["artist-eligible-dates"] });
      queryClient.invalidateQueries({ queryKey: ["offer-tiers"] });
    }
  };

  const onSubmit = async (v: FormValues) => {
    if (!currentOrg) { toast.error(t("form.toasts.noActiveOrg")); return; }
    try {
      let targetShowId: string;
      if (isEdit && show) {
        // main_cast_slots/understudy_slots are derived from slots now, so the show
        // patch never writes them.
        await updateShow.mutateAsync({
          id: show.id,
          patch: synced
            ? { category: v.category || null, description: v.description || null }
            : { program: v.program || null, sub_program: v.subProgram || null, category: v.category || null, description: v.description || null },
        });
        targetShowId = show.id;
        toast.success(t("form.toasts.updated"));
        onSaved?.(show.id);
      } else {
        // A retry after a failed slot save reuses the show created earlier in this
        // open session instead of inserting a duplicate.
        let id = createdShowIdRef.current;
        if (!id) {
          ({ id } = await createShow.mutateAsync({
            orgId: currentOrg.id, createdBy: user?.id ?? null,
            program: v.program || null, subProgram: v.subProgram || null,
            category: v.category || null, description: v.description || null,
            sortOrder: nextSortOrder(allShows),
          }));
          createdShowIdRef.current = id;
          toast.success(t("form.toasts.created"));
          onSaved?.(id);
        }
        targetShowId = id;
      }
      const slotsSaved = await saveSlots(targetShowId, currentOrg.id);
      if (slotsSaved) onOpenChange(false); // keep the dialog open on save failure so a retry can finish
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const err = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? t("form.editTitle") : t("form.newTitle")}
            {synced && <Badge variant="secondary" className="bg-well-tint text-muted-foreground">{t("form.syncedBadge")}</Badge>}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="program">{t("form.programLabel")}</Label>
            <Input id="program" disabled={synced} {...form.register("program")} />
            {err.program && <p className="text-xs text-destructive">{err.program.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subProgram">{t("form.subProgramLabel")}</Label>
            <Input id="subProgram" disabled={synced} {...form.register("subProgram")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category">{t("form.categoryLabel")}</Label>
            <Input id="category" {...form.register("category")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">{t("form.descriptionLabel")}</Label>
            <Textarea id="description" {...form.register("description")} />
          </div>

          <CastingBreakdownFields
            value={slots}
            onChange={setSlots}
            skills={orgSkills ?? []}
            disabled={slotsDisabled}
            onCreateSkill={createSkillInline}
            canCreateSkill={canManageSkills}
          />

          {/* Cities are an org-wide catalog, not a property of this production; the
              section says so. It is here because this is where the producer is already
              thinking about where the production goes. */}
          <CityCatalogField orgId={currentOrg?.id ?? null} />

          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? t("form.saving") : isEdit ? t("form.save") : t("form.create")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
