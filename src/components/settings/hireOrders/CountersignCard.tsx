import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import type { Json } from "@/integrations/supabase/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export type CountersignMode = "manual" | "documenso";

/** The `hire_order_countersign` app_settings value (spec §2.6 / §8). Documenso
 *  credentials live in Vault, not here (extended plan, not this task). */
export interface HireOrderCountersign {
  mode: CountersignMode;
}
export const COUNTERSIGN_DEFAULT: HireOrderCountersign = { mode: "manual" };

export function CountersignCard({ orgId }: { orgId: string | null }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["app-settings", "hire_order_countersign", orgId],
    queryFn: () => resolveOrgSetting<HireOrderCountersign>(supabase, orgId, "hire_order_countersign", COUNTERSIGN_DEFAULT),
    enabled: Boolean(orgId),
  });

  const [form, setForm] = useState<HireOrderCountersign>(COUNTERSIGN_DEFAULT);
  const seededRef = useRef(false);
  useEffect(() => {
    if (data && !seededRef.current) {
      seededRef.current = true;
      setForm(data);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error("No active organization");
      return upsertOrgSetting(supabase, orgId, "hire_order_countersign", form as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Countersign mode saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Countersign mode</CardTitle>
        <CardDescription>How the artist's signature is captured once a hire order is issued.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup
          value={form.mode}
          onValueChange={(v) => setForm({ mode: v as CountersignMode })}
          className="gap-3"
        >
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <RadioGroupItem value="manual" id="ho-countersign-manual" className="mt-0.5" />
            <Label htmlFor="ho-countersign-manual" className="cursor-pointer font-normal">
              <span className="block text-sm font-medium">Manual</span>
              <span className="block text-xs text-muted-foreground">
                A producer marks the order as countersigned once the artist has signed outside ShowFlow.
              </span>
            </Label>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <RadioGroupItem value="documenso" id="ho-countersign-documenso" className="mt-0.5" />
            <Label htmlFor="ho-countersign-documenso" className="cursor-pointer font-normal">
              <span className="block text-sm font-medium">Documenso</span>
              <span className="block text-xs text-muted-foreground">
                Send the order for e-signature through Documenso once connected.
              </span>
            </Label>
          </div>
        </RadioGroup>
        {form.mode === "documenso" && (
          <Alert>
            <AlertDescription>
              Connect Documenso in a later step. Manual marking stays available.
            </AlertDescription>
          </Alert>
        )}
        <Button onClick={() => save.mutate()} disabled={save.isPending || !orgId}>
          Save countersign mode
        </Button>
      </CardContent>
    </Card>
  );
}
