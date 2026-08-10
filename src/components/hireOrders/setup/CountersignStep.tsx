
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { COUNTERSIGN_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { HireOrderCountersign } from "@/components/settings/hireOrders/CountersignCard";
import { CountersignFields } from "@/components/settings/hireOrders/fields/CountersignFields";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDerivedDraft } from "@/hooks/useDerivedDraft";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** The rail's countersign panel. Unlike the other two steps this one is not a blocker:
 *  the inherited manual mode issues perfectly well. Saving is what turns an inherited
 *  default into a decision, which is exactly what hasOrgSettingRow detects. */
export function CountersignStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }) {
  const qc = useQueryClient();
  const stored = useQuery({
    queryKey: ["app-settings", "hire_order_countersign", orgId],
    enabled: !!orgId,
    queryFn: () =>
      resolveOrgSetting<HireOrderCountersign>(supabase, orgId, "hire_order_countersign", COUNTERSIGN_DEFAULT),
  });

  // A view of the stored setting, not a copy seeded into state by an effect: Confirm
  // persists the form verbatim (merged onto the stored value), and a seeded copy is
  // still the blank DEFAULT in the commit that opens the isLoading gate below.
  const [form, setForm] = useDerivedDraft<HireOrderCountersign>(stored.data, COUNTERSIGN_DEFAULT);

  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error("No active organization");
      return upsertOrgSetting(supabase, orgId, "hire_order_countersign", form as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      qc.invalidateQueries({ queryKey: ["hire-orders"] });
      toast.success("Countersign mode saved");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Same guards as CountersignCard. An unread setting seeds COUNTERSIGN_DEFAULT
  // (manual), and Save would then write that over a stored electronic mode, silently
  // stopping artists signing in-app.
  if (stored.isLoading) return <Skeleton className="h-24 w-full" />;
  if (stored.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load the countersign setting. {(stored.error as Error).message}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">How an artist signs the order you send them.</p>
      <CountersignFields idPrefix="rail-countersign" value={form} onChange={setForm} />
      <Button size="sm" disabled={save.isPending || !orgId} onClick={() => save.mutate()}>
        Save
      </Button>
    </div>
  );
}
