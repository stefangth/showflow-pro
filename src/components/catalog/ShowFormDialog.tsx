import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useCreateShow, useUpdateShow, type ShowWithStats } from "@/hooks/useShows";
import { useSkills } from "@/hooks/useSkills";
import { useShowSlots } from "@/hooks/useShowSlots";
import { saveShowSlots, type SlotDraft, type SlotKind } from "@/data/slots";
import { isSyncedShow, nextSortOrder } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SkillPicker } from "@/components/skills/SkillPicker";

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

  const updateSlot = (i: number, patch: Partial<SlotDraft>) =>
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const toggleSlotSkill = (i: number, skillId: string) =>
    setSlots((prev) => prev.map((s, idx) => idx === i
      ? { ...s, skillIds: s.skillIds.includes(skillId) ? s.skillIds.filter((x) => x !== skillId) : [...s.skillIds, skillId] }
      : s));
  // Every new row gets a client-minted id so a retry (dialog stays open on save
  // failure) re-submits the same array and saveShowSlots resolves already-landed
  // rows to no-op updates instead of duplicate inserts.
  const addSlot = () =>
    setSlots((prev) => [...prev, { id: crypto.randomUUID(), name: "", count: 1, kind: "main", skillIds: [] }]);
  const removeSlot = (i: number) => setSlots((prev) => prev.filter((_, idx) => idx !== i));

  const skillNameById = new Map((orgSkills ?? []).map((s) => [s.id, s.name] as const));
  const unionIds = new Set<string>();
  for (const s of slots) for (const id of s.skillIds) unionIds.add(id);
  const unionNames = [...unionIds]
    .map((id) => skillNameById.get(id))
    .filter((n): n is string => !!n)
    .sort((a, b) => a.localeCompare(b));
  const mainTotal = slots.filter((s) => s.kind === "main").reduce((a, s) => a + s.count, 0);
  const understudyTotal = slots.filter((s) => s.kind === "understudy").reduce((a, s) => a + s.count, 0);
  const calloutText = unionNames.length > 0
    ? t("form.callout.withSkills", { skills: unionNames.join(", ") })
    : t("form.callout.none");

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
            {synced && <Badge variant="secondary" className="bg-muted text-muted-foreground">{t("form.syncedBadge")}</Badge>}
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

          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">{t("form.slotsHeading")}</p>
              <p className="font-mono text-xs tabular-nums text-muted-foreground">{t("form.slotTotals", { main: mainTotal, understudy: understudyTotal })}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("form.slotsHelp")}
            </p>

            <div className="space-y-2">
              {slots.map((s, i) => (
                <div
                  key={s.id}
                  role="group"
                  aria-label={s.name ? t("form.slotGroupNamed", { name: s.name }) : t("form.slotGroupIndex", { index: i + 1 })}
                  className="space-y-2 rounded-md border border-border p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={t("form.roleNameLabel")}
                      placeholder={t("form.roleNameLabel")}
                      className="h-8 flex-1"
                      value={s.name}
                      disabled={slotsDisabled}
                      onChange={(e) => updateSlot(i, { name: e.target.value })}
                    />
                    <Input
                      aria-label={t("form.countLabel")}
                      inputMode="numeric"
                      className="h-8 w-14 text-center"
                      value={String(s.count)}
                      disabled={slotsDisabled}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/[^\d]/g, "");
                        updateSlot(i, { count: digits === "" ? 0 : parseInt(digits, 10) });
                      }}
                    />
                    <div className="inline-flex overflow-hidden rounded-md border border-border">
                      {(["main", "understudy"] as SlotKind[]).map((k) => (
                        <button
                          key={k}
                          type="button"
                          aria-pressed={s.kind === k}
                          disabled={slotsDisabled}
                          onClick={() => updateSlot(i, { kind: k })}
                          className={cn(
                            "px-2 py-1 text-xs transition-colors",
                            s.kind === k ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                            slotsDisabled && "pointer-events-none opacity-50",
                          )}
                        >
                          {k === "main" ? t("form.kindMain") : t("form.kindUnderstudy")}
                        </button>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label={t("form.removeSlot", { name: s.name || t("form.slotFallback") })}
                      disabled={slotsDisabled}
                      onClick={() => removeSlot(i)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <SkillPicker
                    skills={orgSkills ?? []}
                    selectedIds={s.skillIds}
                    onToggle={(id) => toggleSlotSkill(i, id)}
                    disabled={slotsDisabled}
                    emptyHint={t("form.skillsEmptyHint")}
                  />
                </div>
              ))}

              <Button type="button" variant="outline" size="sm" disabled={slotsDisabled} onClick={addSlot}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />{t("form.addSlot")}
              </Button>
            </div>

            {slots.length > 0 && (
              <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                {calloutText}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? t("form.saving") : isEdit ? t("form.save") : t("form.create")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
