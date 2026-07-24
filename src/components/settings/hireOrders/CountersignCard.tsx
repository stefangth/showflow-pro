import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { COUNTERSIGN_DEFAULT } from "./defaults";
import type { Json } from "@/integrations/supabase/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
        <RadioGroup
          value={form.mode}
          onValueChange={(v) => setForm((f) => ({ ...f, mode: v as CountersignMode }))}
          disabled={readOnly}
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
            <RadioGroupItem value="electronic" id="ho-countersign-electronic" className="mt-0.5" />
            <Label htmlFor="ho-countersign-electronic" className="cursor-pointer font-normal">
              <span className="block text-sm font-medium">Electronic signature (in-app)</span>
              <span className="block text-xs text-muted-foreground">
                The artist reviews and signs the issued order inside ShowFlow. A signed PDF and audit record are stored automatically.
              </span>
            </Label>
          </div>
        </RadioGroup>
        {form.mode === "electronic" && (
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Checkbox
              id="ho-email-producers"
              className="mt-0.5"
              checked={!!form.email_producers_on_countersign}
              onCheckedChange={(c) => setForm((f) => ({ ...f, email_producers_on_countersign: c === true }))}
            />
            <Label htmlFor="ho-email-producers" className="cursor-pointer font-normal">
              <span className="block text-sm font-medium">Also email producers the signed copy</span>
              <span className="block text-xs text-muted-foreground">
                When the artist signs, email the assigned producers a copy of the signed hire order. Producers are notified in-app either way.
              </span>
            </Label>
          </div>
        )}
        <Button onClick={() => save.mutate()} disabled={save.isPending || !orgId || readOnly}>
          Save countersign mode
        </Button>
      </CardContent>
    </Card>
  );
}
