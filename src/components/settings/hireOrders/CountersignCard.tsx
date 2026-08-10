import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { useDerivedDraft } from "@/hooks/useDerivedDraft";
import { COUNTERSIGN_DEFAULT } from "./defaults";
import type { Json } from "@/integrations/supabase/types";
import { CountersignFields } from "./fields/CountersignFields";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export type CountersignMode = "manual" | "electronic";

/** The `hire_order_countersign` app_settings value (spec §2.6 / §8). */
export interface HireOrderCountersign {
  mode: CountersignMode;
  /** electronic mode only: also email producers the signed PDF. */
  email_producers_on_countersign?: boolean;
}

export function CountersignCard({ orgId, readOnly = false }: { orgId: string | null; readOnly?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["app-settings", "hire_order_countersign", orgId],
    queryFn: () => resolveOrgSetting<HireOrderCountersign>(supabase, orgId, "hire_order_countersign", COUNTERSIGN_DEFAULT),
    enabled: Boolean(orgId),
  });

  // A view of the stored setting, not a copy seeded into state by an effect: Save
  // persists `form` verbatim, and a seeded copy is still the DEFAULT in the commit
  // that opens the `isLoading` gate below, and never re-seeds when the active org
  // changes underneath the card. An unrelated refetch still cannot clobber edits in
  // progress -- see useDerivedDraft.
  const [form, setForm] = useDerivedDraft<HireOrderCountersign>(data, COUNTERSIGN_DEFAULT);

  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error("No active organization");
      return upsertOrgSetting(supabase, orgId, "hire_order_countersign", form as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      qc.invalidateQueries({ queryKey: ["hire-orders"] });
      toast.success("Countersign mode saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  // Read failed: render the error INSTEAD of the form. Falling through would show
  // COUNTERSIGN_DEFAULT ("manual") as if it were the org's saved mode, and a Save
  // from there would silently revert an org configured for electronic signing.
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load the countersign settings. {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Countersign mode</CardTitle>
        <CardDescription>How the artist's signature is captured once a hire order is issued.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <CountersignFields value={form} onChange={setForm} readOnly={readOnly} />
        <Button onClick={() => save.mutate()} disabled={save.isPending || !orgId || readOnly}>
          Save countersign mode
        </Button>
      </CardContent>
    </Card>
  );
}
