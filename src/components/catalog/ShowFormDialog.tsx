import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useCreateShow, useUpdateShow, type ShowWithStats } from "@/hooks/useShows";
import { useSkills } from "@/hooks/useSkills";
import { fetchShowRequiredSkillIds, addShowRequiredSkill, removeShowRequiredSkill } from "@/data/eligibility";
import { isSyncedShow, nextSortOrder } from "@/lib/catalog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SkillPicker } from "@/components/skills/SkillPicker";

const slot = z.string().regex(/^\d*$/, "Whole number ≥ 0").optional().or(z.literal(""));
const schema = z.object({
  program: z.string().trim().optional().or(z.literal("")),
  subProgram: z.string().trim().optional().or(z.literal("")),
  category: z.string().trim().optional().or(z.literal("")),
  description: z.string().trim().optional().or(z.literal("")),
  mainCastSlots: slot,
  understudySlots: slot,
}).refine((v) => !!(v.program || v.subProgram), { message: "Program or sub-program required", path: ["program"] });
type FormValues = z.infer<typeof schema>;

const toSlot = (s: string | undefined): number | null => (s != null && s.trim() !== "" ? parseInt(s, 10) : null);

export function ShowFormDialog({
  open, onOpenChange, show, allShows, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  show?: ShowWithStats | null;
  allShows: ShowWithStats[];
  onSaved?: (id: string) => void;
}) {
  const { user, currentOrg } = useAuth();
  const canEditScheduling = useCan("edit_scheduling");
  const isEdit = !!show;
  const synced = !!show && isSyncedShow(show);
  const createShow = useCreateShow();
  const updateShow = useUpdateShow();
  const queryClient = useQueryClient();

  const { data: orgSkills } = useSkills();
  const [requiredSkillIds, setRequiredSkillIds] = useState<string[]>([]);
  const initialSkillIdsRef = useRef<string[]>([]);
  // Which (open session, show identity) the skills editor was last seeded for.
  // The dialog instance stays mounted across close/reopen (ProductionsPage), so
  // seeding must be keyed on the open transition, not on query-data identity:
  // structural sharing keeps a refetch reference-equal, which would otherwise
  // let an unsaved toggle survive an X/Escape close and leak into the next save.
  const skillsSeededForRef = useRef<string | null>(null);
  // Show id created in the current open session; a retry after a failed skills
  // diff must reuse it instead of creating a duplicate show.
  const createdShowIdRef = useRef<string | null>(null);
  // Load the show's current required skills when editing (dialog opens with a show).
  const showReqQ = useQuery({
    queryKey: ["eligibility", "show-required-skills", show?.id],
    enabled: open && !!show?.id,
    queryFn: () => fetchShowRequiredSkillIds(supabase, show!.id),
  });
  useEffect(() => {
    if (!open) {
      // Closing discards unsaved toggles (they must never survive into the next
      // session's diff) and ends the create session.
      skillsSeededForRef.current = null;
      createdShowIdRef.current = null;
      setRequiredSkillIds([]);
      initialSkillIdsRef.current = [];
      return;
    }
    const identity = show?.id ?? "__create__";
    // Seed once per open session per show identity; a mid-session refetch must
    // not clobber in-progress toggles (same pattern as the ArtistProfileSheet
    // draft reseed).
    if (skillsSeededForRef.current === identity) return;
    if (show?.id && showReqQ.data === undefined) return; // edit mode: wait for the fetch
    skillsSeededForRef.current = identity;
    const ids = show?.id ? showReqQ.data ?? [] : [];
    setRequiredSkillIds(ids);
    initialSkillIdsRef.current = ids;
  }, [open, show?.id, showReqQ.data]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      program: show?.program ?? "", subProgram: show?.sub_program ?? "", category: show?.category ?? "",
      description: show?.description ?? "",
      mainCastSlots: show?.main_cast_slots != null ? String(show.main_cast_slots) : "",
      understudySlots: show?.understudy_slots != null ? String(show.understudy_slots) : "",
    },
  });
  useEffect(() => {
    if (open) form.reset({
      program: show?.program ?? "", subProgram: show?.sub_program ?? "", category: show?.category ?? "",
      description: show?.description ?? "",
      mainCastSlots: show?.main_cast_slots != null ? String(show.main_cast_slots) : "",
      understudySlots: show?.understudy_slots != null ? String(show.understudy_slots) : "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, show]);

  /** Insert/delete added/removed skill ids against the target show, then bust
   *  every domain the eligibility engine reads from. The baseline ref advances
   *  INCREMENTALLY after each successful write, so a retry after a mid-diff
   *  failure only re-attempts genuinely unfinished operations (a repeated
   *  insert would hit the UNIQUE (show_id, skill_id) index). Returns whether
   *  the whole diff applied. */
  const applyRequiredSkillsDiff = async (targetShowId: string, orgId: string): Promise<boolean> => {
    const before = new Set(initialSkillIdsRef.current);
    const after = new Set(requiredSkillIds);
    const toAdd = requiredSkillIds.filter((id) => !before.has(id));
    const toRemove = initialSkillIdsRef.current.filter((id) => !after.has(id));
    if (toAdd.length === 0 && toRemove.length === 0) return true;
    try {
      for (const id of toAdd) {
        await addShowRequiredSkill(supabase, { showId: targetShowId, skillId: id, orgId });
        initialSkillIdsRef.current = [...initialSkillIdsRef.current, id];
      }
      for (const id of toRemove) {
        await removeShowRequiredSkill(supabase, { showId: targetShowId, skillId: id });
        initialSkillIdsRef.current = initialSkillIdsRef.current.filter((x) => x !== id);
      }
      return true;
    } catch (e) {
      // Distinct from the show-upsert failure: the show itself saved fine.
      toast.error("Failed to update required skills", { description: (e as Error).message });
      return false;
    } finally {
      // Partial writes may have landed even on failure; refresh consumers either way.
      queryClient.invalidateQueries({ queryKey: ["eligibility"] });
      queryClient.invalidateQueries({ queryKey: ["eligible-artists"] });
      queryClient.invalidateQueries({ queryKey: ["artist-eligible-dates"] });
      queryClient.invalidateQueries({ queryKey: ["offer-tiers"] });
    }
  };

  const onSubmit = async (v: FormValues) => {
    if (!currentOrg) { toast.error("No active organization"); return; }
    try {
      let targetShowId: string;
      if (isEdit && show) {
        await updateShow.mutateAsync({
          id: show.id,
          patch: synced
            ? { category: v.category || null, description: v.description || null, main_cast_slots: toSlot(v.mainCastSlots), understudy_slots: toSlot(v.understudySlots) }
            : { program: v.program || null, sub_program: v.subProgram || null, category: v.category || null, description: v.description || null, main_cast_slots: toSlot(v.mainCastSlots), understudy_slots: toSlot(v.understudySlots) },
        });
        targetShowId = show.id;
        toast.success("Production updated");
        onSaved?.(show.id);
      } else {
        // A retry after a failed skills diff reuses the show created earlier in
        // this open session instead of inserting a duplicate.
        let id = createdShowIdRef.current;
        if (!id) {
          ({ id } = await createShow.mutateAsync({
            orgId: currentOrg.id, createdBy: user?.id ?? null,
            program: v.program || null, subProgram: v.subProgram || null,
            category: v.category || null, description: v.description || null,
            mainCastSlots: toSlot(v.mainCastSlots), understudySlots: toSlot(v.understudySlots),
            sortOrder: nextSortOrder(allShows),
          }));
          createdShowIdRef.current = id;
          toast.success("Production created");
          onSaved?.(id);
        }
        targetShowId = id;
      }
      const skillsApplied = await applyRequiredSkillsDiff(targetShowId, currentOrg.id);
      if (skillsApplied) onOpenChange(false); // keep the dialog open on diff failure so a retry can finish
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const pending = createShow.isPending || updateShow.isPending;
  const err = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? "Edit production" : "New production"}
            {synced && <Badge variant="secondary" className="bg-muted text-muted-foreground">Synced from Airtable</Badge>}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="program">Program</Label>
            <Input id="program" disabled={synced} {...form.register("program")} />
            {err.program && <p className="text-xs text-destructive">{err.program.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subProgram">Sub-program</Label>
            <Input id="subProgram" disabled={synced} {...form.register("subProgram")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Input id="category" {...form.register("category")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" {...form.register("description")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mainCastSlots">Main cast slots</Label>
              <Input id="mainCastSlots" inputMode="numeric" disabled={!canEditScheduling} {...form.register("mainCastSlots")} />
              {err.mainCastSlots && <p className="text-xs text-destructive">{err.mainCastSlots.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="understudySlots">Understudy slots</Label>
              <Input id="understudySlots" inputMode="numeric" disabled={!canEditScheduling} {...form.register("understudySlots")} />
              {err.understudySlots && <p className="text-xs text-destructive">{err.understudySlots.message}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Required skills</p>
            <p className="text-xs text-muted-foreground">
              Artists must have all of these skills to receive offers or be booked.
            </p>
            <SkillPicker
              skills={orgSkills ?? []}
              selectedIds={requiredSkillIds}
              onToggle={(id) => setRequiredSkillIds((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
              disabled={pending}
              emptyHint="No skills yet. Add skills on artist profiles first."
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : isEdit ? "Save" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
