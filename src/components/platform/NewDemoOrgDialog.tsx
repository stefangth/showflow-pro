import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useCreateDemoOrg } from "@/hooks/useDemo";
import { slugify } from "./platformFormat";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  name: z.string().min(1, "Required"),
  slug: z.string().min(1, "Required").regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens"),
  adminEmail: z.string().email("Valid email required"),
});
type FormValues = z.infer<typeof schema>;

/**
 * Provisions a brand-new demo org (via `useCreateDemoOrg`, which calls
 * `provisionOrg` then flags + seeds it through `demo-ops`) and invites the
 * given rep as its first admin. Mirrors `NewOrgDialog` with a smaller field
 * set — a demo org always ships with the full module set and full seed
 * volume, so there's nothing to configure beyond name/slug/rep email.
 */
export function NewDemoOrgDialog() {
  const [open, setOpen] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", slug: "", adminEmail: "" },
  });
  const nameReg = form.register("name");
  const create = useCreateDemoOrg();

  const onSubmit = (v: FormValues) =>
    create.mutate(
      { name: v.name, slug: v.slug, adminEmail: v.adminEmail, appOrigin: window.location.origin, volume: "full" },
      {
        onSuccess: () => {
          toast.success("Demo org created and rep invited");
          form.reset();
          setOpen(false);
        },
        onError: (e: Error) => toast.error(e.message),
      },
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline">New demo org</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New demo org</DialogTitle>
          <DialogDescription>Create a demo organization, seed it with sample data, and invite the rep.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="demo-name">Name</Label>
            <Input id="demo-name" {...nameReg} onChange={(e) => {
              nameReg.onChange(e);
              if (!form.getFieldState("slug").isDirty) form.setValue("slug", slugify(e.target.value));
            }} />
            {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="demo-slug">Slug</Label>
            <Input id="demo-slug" {...form.register("slug")} />
            {form.formState.errors.slug && <p className="text-xs text-destructive">{form.formState.errors.slug.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="demo-admin-email">Rep email</Label>
            <Input id="demo-admin-email" type="email" {...form.register("adminEmail")} />
            {form.formState.errors.adminEmail && <p className="text-xs text-destructive">{form.formState.errors.adminEmail.message}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
