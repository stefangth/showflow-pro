import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { provisionOrg } from "@/data/platform";
import { slugify } from "./platformFormat";
import { FEATURE_KEYS, FEATURE_REGISTRY, type FeatureKey } from "@/lib/entitlements";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/** New orgs start with every module off; ships-dark modules need an explicit opt-in. */
const ALL_FEATURES_OFF = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Record<FeatureKey, boolean>;

const schema = z.object({
  name: z.string().min(1, "Required"),
  slug: z.string().min(1, "Required").regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens"),
  adminEmail: z.string().email("Valid email required"),
  role: z.enum(["admin", "producer", "artist"]),
  features: z.record(z.boolean()),
});
type FormValues = z.infer<typeof schema>;

export function NewOrgDialog() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", slug: "", adminEmail: "", role: "admin", features: ALL_FEATURES_OFF },
  });
  const nameReg = form.register("name");
  const features = form.watch("features") as Record<FeatureKey, boolean>;

  const mutation = useMutation({
    mutationFn: (v: FormValues) =>
      provisionOrg(supabase, {
        name: v.name,
        slug: v.slug,
        adminEmail: v.adminEmail,
        role: v.role,
        appOrigin: window.location.origin,
        features: v.features as Record<FeatureKey, boolean>,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform"] });
      toast.success("Organization created and first admin invited");
      form.reset();
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>New organization</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New organization</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...nameReg} onChange={(e) => {
              nameReg.onChange(e);
              if (!form.getFieldState("slug").isDirty) form.setValue("slug", slugify(e.target.value));
            }} />
            {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" {...form.register("slug")} />
            {form.formState.errors.slug && <p className="text-xs text-destructive">{form.formState.errors.slug.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adminEmail">First admin email</Label>
            <Input id="adminEmail" type="email" {...form.register("adminEmail")} />
            {form.formState.errors.adminEmail && <p className="text-xs text-destructive">{form.formState.errors.adminEmail.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={form.watch("role")} onValueChange={(v) => form.setValue("role", v as FormValues["role"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">admin</SelectItem>
                <SelectItem value="producer">producer</SelectItem>
                <SelectItem value="artist">artist</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-3 border border-border rounded-md p-4">
            <p className="text-sm font-medium">Modules</p>
            {FEATURE_KEYS.map((key) => {
              const def = FEATURE_REGISTRY[key];
              return (
                <div key={key} className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor={`module-${key}`} className="font-medium">{def.label}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
                  </div>
                  <Switch
                    id={`module-${key}`}
                    aria-label={def.label}
                    checked={features[key]}
                    onCheckedChange={(checked) => form.setValue("features", { ...features, [key]: checked })}
                  />
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Creating…" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
