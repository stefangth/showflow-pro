import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { updateOrg, type OrgStat } from "@/data/platform";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  name: z.string().min(1, "Required"),
  slug: z.string().min(1, "Required").regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens"),
});
type Values = z.infer<typeof schema>;

export function EditOrgDialog({ org, onClose }: { org: OrgStat | null; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), values: { name: org?.name ?? "", slug: org?.slug ?? "" } });

  const mutation = useMutation({
    mutationFn: (v: Values) => updateOrg(supabase, org!.org_id, v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform"] }); toast.success("Org updated"); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!org} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit organization</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="e-name">Name</Label>
            <Input id="e-name" {...form.register("name")} />
            {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-slug">Slug</Label>
            <Input id="e-slug" {...form.register("slug")} />
            {form.formState.errors.slug && <p className="text-xs text-destructive">{form.formState.errors.slug.message}</p>}
          </div>
          <DialogFooter><Button type="submit" disabled={mutation.isPending}>Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
