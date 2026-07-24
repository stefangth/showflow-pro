import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { capabilitiesByGroup } from "@/lib/capabilities";
import { useCapabilityMatrix, type CapabilityMatrixCell } from "@/hooks/useCapabilities";
import { setOrgCapability } from "@/data/platform";
import { setOrgCapabilityPolicy } from "@/data/capabilities";
import { PermissionRow } from "./PermissionRow";

interface Props {
  orgId: string;
  mode: "org" | "platform";
  moduleEnabled: (module: string) => boolean;
}

/** Grouped rights matrix: one Card per `CapabilityDef.group`, module-gated rows hidden,
 *  org-mode writes an override (with a confirm step for sensitive rights), platform-mode
 *  writes the default/lock policy. */
export function PermissionsMatrix({ orgId, mode, moduleEnabled }: Props) {
  const qc = useQueryClient();
  const { cells, isLoading } = useCapabilityMatrix(orgId);
  const [pending, setPending] = useState<{ cell: CapabilityMatrixCell; enabled: boolean } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["capabilities"] });

  const writeOverride = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      setOrgCapability(supabase, orgId, key, enabled),
    onSuccess: () => { invalidate(); toast.success("Rights updated."); },
    onError: (e: Error) => toast.error(e.message),
  });
  const writePolicy = useMutation({
    mutationFn: ({ key, patch }: { key: string; patch: { enabled?: boolean | null; locked?: boolean } }) =>
      setOrgCapabilityPolicy(supabase, orgId, key, patch),
    onSuccess: () => { invalidate(); toast.success("Policy updated."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const byKey = new Map(cells.map((c) => [c.def.key, c]));
  const onToggleOverride = (cell: CapabilityMatrixCell, enabled: boolean) => {
    if (cell.def.risk === "sensitive") { setPending({ cell, enabled }); return; }
    writeOverride.mutate({ key: cell.def.key, enabled });
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading rights...</p>;

  return (
    <div className="space-y-6">
      {capabilitiesByGroup().map(({ group, defs }) => {
        const visible = defs.filter((d) => !d.module || moduleEnabled(d.module));
        if (visible.length === 0) return null;
        return (
          <Card key={group}>
            <CardHeader><CardTitle className="font-display text-base">{group}</CardTitle></CardHeader>
            <CardContent className="pt-0">
              {visible.map((def) => {
                const cell = byKey.get(def.key);
                if (!cell) return null;
                return (
                  <PermissionRow
                    key={def.key}
                    cell={cell}
                    mode={mode}
                    onToggleOverride={(enabled) => onToggleOverride(cell, enabled)}
                    onToggleLock={(locked) => writePolicy.mutate({ key: def.key, patch: { locked } })}
                    onSetPlatformDefault={(enabled) => writePolicy.mutate({ key: def.key, patch: { enabled } })}
                  />
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change a sensitive right?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending && `${pending.enabled ? "Grant" : "Remove"} "${pending.cell.def.label}" for producers. This is a sensitive right.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) writeOverride.mutate({ key: pending.cell.def.key, enabled: pending.enabled });
                setPending(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
