import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { renameOrg } from "@/data/orgs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({ name: z.string().min(1, "Required") });
type Values = z.infer<typeof schema>;

interface Props {
  /** Capability floor: the org name still renders, but a producer without
   *  `rename_org` can't submit a change. Admins always pass `false` here. */
  readOnly?: boolean;
}

/** Rename the current org (name only; slug is shown read-only). Producers see this tab
 *  read-only unless granted the `rename_org` capability; admins always may edit. */
export function OrganizationTab({ readOnly = false }: Props) {
  const { t } = useTranslation("settings");
  const { currentOrg, refreshOrgs } = useAuth();
  const form = useForm<Values>({ resolver: zodResolver(schema), values: { name: currentOrg?.name ?? "" } });

  const mutation = useMutation({
    mutationFn: (v: Values) => {
      if (!currentOrg) return Promise.resolve();
      return renameOrg(supabase, currentOrg.id, v.name);
    },
    onSuccess: async () => { await refreshOrgs(); toast.success(t("organization.renamed")); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!currentOrg) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">{t("organization.title")}</CardTitle>
        <CardDescription>{t("organization.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4 max-w-md">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">{t("organization.nameLabel")}</Label>
            <Input id="org-name" disabled={readOnly} {...form.register("name")} />
            {form.formState.errors.name && <p className="text-xs text-destructive">{t("organization.required")}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-slug">{t("organization.slugLabel")}</Label>
            <Input id="org-slug" value={currentOrg.slug} disabled readOnly />
          </div>
          <Button type="submit" disabled={readOnly || mutation.isPending}>{mutation.isPending ? t("organization.saving") : t("organization.save")}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
