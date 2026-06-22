import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import { useCreateShow, useUpdateShow, type ShowWithStats } from "@/hooks/useShows";
import { isSyncedShow, nextSortOrder } from "@/lib/catalog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

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

const toSlot = (s: string | undefined): number | null => (s && s.trim() !== "" ? parseInt(s, 10) : null);

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
  const isEdit = !!show;
  const synced = !!show && isSyncedShow(show);
  const createShow = useCreateShow();
  const updateShow = useUpdateShow();

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

  const onSubmit = async (v: FormValues) => {
    try {
      if (isEdit && show) {
        await updateShow.mutateAsync({
          id: show.id,
          patch: synced
            ? { category: v.category || null, description: v.description || null, main_cast_slots: toSlot(v.mainCastSlots), understudy_slots: toSlot(v.understudySlots) }
            : { program: v.program || null, sub_program: v.subProgram || null, category: v.category || null, description: v.description || null, main_cast_slots: toSlot(v.mainCastSlots), understudy_slots: toSlot(v.understudySlots) },
        });
        toast.success("Production updated");
        onSaved?.(show.id);
      } else {
        if (!currentOrg) { toast.error("No active organization"); return; }
        const { id } = await createShow.mutateAsync({
          orgId: currentOrg.id, createdBy: user?.id ?? null,
          program: v.program || null, subProgram: v.subProgram || null,
          category: v.category || null, description: v.description || null,
          mainCastSlots: toSlot(v.mainCastSlots), understudySlots: toSlot(v.understudySlots),
          sortOrder: nextSortOrder(allShows),
        });
        toast.success("Production created");
        onSaved?.(id);
      }
      onOpenChange(false);
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
              <Input id="mainCastSlots" inputMode="numeric" {...form.register("mainCastSlots")} />
              {err.mainCastSlots && <p className="text-xs text-destructive">{err.mainCastSlots.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="understudySlots">Understudy slots</Label>
              <Input id="understudySlots" inputMode="numeric" {...form.register("understudySlots")} />
              {err.understudySlots && <p className="text-xs text-destructive">{err.understudySlots.message}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : isEdit ? "Save" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
