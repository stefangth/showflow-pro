import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { renameOrg } from "@/data/orgs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({ name: z.string().min(1, "Required") });
type Values = z.infer<typeof schema>;

/** Admin-only: rename the current org (name only; slug is shown read-only). */
export function OrganizationTab() {
  const { currentOrg, refreshOrgs } = useAuth();
  const form = useForm<Values>({ resolver: zodResolver(schema), values: { name: currentOrg?.name ?? "" } });

  const mutation = useMutation({
    mutationFn: (v: Values) => renameOrg(supabase, currentOrg!.id, v.name),
    onSuccess: async () => { await refreshOrgs(); toast.success("Organization renamed"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!currentOrg) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Organization</CardTitle>
        <CardDescription>Your workspace name. The slug is fixed — contact support to change it.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4 max-w-md">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Organization name</Label>
            <Input id="org-name" {...form.register("name")} />
            {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-slug">Slug</Label>
            <Input id="org-slug" value={currentOrg.slug} disabled readOnly />
          </div>
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Save"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
