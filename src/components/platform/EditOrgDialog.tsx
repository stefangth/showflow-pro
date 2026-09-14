import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { updateOrg, exportOrgData, deleteOrg, setOrgEntitlement, type OrgStat } from "@/data/platform";
import { setOrgKind } from "@/data/orgs";
import { fetchEntitlements } from "@/data/entitlements";
import { FEATURE_KEYS, FEATURE_REGISTRY, type FeatureKey } from "@/lib/entitlements";
import type { OrgKind } from "@/lib/orgKind";
import { OrgKindSelect } from "@/components/settings/OrgKindSelect";
import { PermissionsMatrix } from "@/components/settings/permissions/PermissionsMatrix";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

const schema = z.object({
  name: z.string().min(1, "Required"),
  slug: z.string().min(1, "Required").regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens"),
});
type Values = z.infer<typeof schema>;

export function EditOrgDialog({ org, onClose }: { org: OrgStat | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { refreshOrgs } = useAuth();
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [rightsOpen, setRightsOpen] = useState(false);

  const form = useForm<Values>({ resolver: zodResolver(schema), values: { name: org?.name ?? "", slug: org?.slug ?? "" } });

  const handleExport = async () => {
    setBusy(true);
    try {
      const bundle = await exportOrgData(supabase, org!.org_id);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `org-${org!.slug}-export.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Org data downloaded");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const handleDelete = async () => {
    if (confirmName !== org?.name) return; // defense-in-depth beyond the disabled attr
    setBusy(true);
    try {
      await deleteOrg(supabase, org!.org_id);
      qc.invalidateQueries({ queryKey: ["platform"] });
      toast.success("Organization deleted");
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const mutation = useMutation({
    mutationFn: (v: Values) => updateOrg(supabase, org!.org_id, v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform"] }); toast.success("Org updated"); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: entitlements } = useQuery({
    queryKey: ["entitlements", org?.org_id],
    queryFn: () => fetchEntitlements(supabase, org!.org_id),
    enabled: !!org,
  });

  const isModuleEnabled = (feature: FeatureKey): boolean => {
    const row = entitlements?.find((r) => r.feature === feature);
    return row ? row.enabled : FEATURE_REGISTRY[feature].defaultEnabled;
  };

  const toggleModule = useMutation({
    mutationFn: ({ feature, enabled }: { feature: FeatureKey; enabled: boolean }) =>
      setOrgEntitlement(supabase, org!.org_id, feature, enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform"] });
      qc.invalidateQueries({ queryKey: ["entitlements"] });
      toast.success("Module updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const kindMutation = useMutation({
    mutationFn: (kind: OrgKind) => setOrgKind(supabase, org!.org_id, kind),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["platform"] });
      await refreshOrgs();
      toast.success("Workspace type updated");
    },
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
          <div className="space-y-1.5">
            <Label htmlFor="e-kind">Workspace type</Label>
            <OrgKindSelect id="e-kind" value={org?.org_kind ?? "production"} onChange={(k) => kindMutation.mutate(k)} disabled={kindMutation.isPending} />
            <p className="text-xs text-muted-foreground">Saves immediately. Changes the words the org sees, never its data.</p>
          </div>
          <DialogFooter><Button type="submit" disabled={mutation.isPending}>Save</Button></DialogFooter>
        </form>
        <div className="mt-6 border border-border rounded-control p-4 space-y-3">
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
                  checked={isModuleEnabled(key)}
                  disabled={toggleModule.isPending}
                  onCheckedChange={(checked) => toggleModule.mutate({ feature: key, enabled: checked })}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-6 rounded-card border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">User rights</p>
              <p className="text-xs text-muted-foreground">Set platform defaults and lock rights for this org.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setRightsOpen(true)}>
              Manage all rights
            </Button>
          </div>
        </div>
        {org && (
          <Dialog open={rightsOpen} onOpenChange={setRightsOpen}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-display">User rights: {org.name}</DialogTitle>
              </DialogHeader>
              <PermissionsMatrix orgId={org.org_id} mode="platform" moduleEnabled={() => true} />
            </DialogContent>
          </Dialog>
        )}
        <div className="mt-6 border-t border-destructive/30 pt-4 space-y-3">
          <p className="text-sm font-medium text-destructive">Danger zone</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={handleExport} disabled={busy}>Export org data</Button>
            <AlertDialog onOpenChange={(o) => { if (!o) setConfirmName(""); }}>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={busy}>Delete organization</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {org?.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the organization and all its data. Members keep their
                    accounts. Type the organization name to confirm.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input placeholder={org?.name ?? ""} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={confirmName !== org?.name || busy}
                    onClick={(e) => { e.preventDefault(); handleDelete(); }}
                  >
                    Permanently delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
