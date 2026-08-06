import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { COUNTERSIGN_DEFAULT } from "@/components/settings/hireOrders/defaults";
import type { HireOrderCountersign } from "@/components/settings/hireOrders/CountersignCard";
import { CountersignFields } from "@/components/settings/hireOrders/fields/CountersignFields";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";

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

  const [form, setForm] = useState<HireOrderCountersign>(COUNTERSIGN_DEFAULT);
  const seededRef = useRef(false);
  useEffect(() => {
    if (!stored.data || seededRef.current) return;
    seededRef.current = true;
    setForm(stored.data);
  }, [stored.data]);

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
