import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import type { Json } from "@/integrations/supabase/types";
import { formatOrderNo } from "@/lib/hireOrders/orderNo";
import { useDerivedDraft } from "@/hooks/useDerivedDraft";
import { NUMBERING_DEFAULT } from "./defaults";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** The `hire_order_numbering` app_settings value (spec §2.6). */
export interface HireOrderNumbering {
  prefix: string;
  pattern: string;
}

export function NumberingCard({ orgId, readOnly = false }: { orgId: string | null; readOnly?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["app-settings", "hire_order_numbering", orgId],
    queryFn: () => resolveOrgSetting<HireOrderNumbering>(supabase, orgId, "hire_order_numbering", NUMBERING_DEFAULT),
    enabled: Boolean(orgId),
  });

  // A view of the stored setting, not a copy seeded into state by an effect: Save
  // persists `form` verbatim, and a seeded copy is still the DEFAULT in the commit
  // that opens the `isLoading` gate below, and never re-seeds when the active org
  // changes underneath the card. An unrelated refetch still cannot clobber edits in
  // progress -- see useDerivedDraft.
  const [form, setForm] = useDerivedDraft<HireOrderNumbering>(data, NUMBERING_DEFAULT);

  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error("No active organization");
      return upsertOrgSetting(supabase, orgId, "hire_order_numbering", form as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Numbering saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  // Read failed: render the error INSTEAD of the form. Falling through would show
  // NUMBERING_DEFAULT as if it were the org's saved values, and a Save from there
  // would overwrite a customized prefix/pattern with the stock one.
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load the numbering settings. {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  // Rendered with the shared pure formatter (src/lib/hireOrders/orderNo.ts) so the
  // preview can never drift from the number the generator actually stamps.
  const preview = formatOrderNo(form.pattern, { prefix: form.prefix, date: "2026-06-15", seq: 7 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Numbering</CardTitle>
        <CardDescription>
          Controls the order number stamped on every hire order. Supported tokens: {"{prefix}"}, {"{yyyy}"}, {"{mm}"}, {"{dd}"}, {"{mmdd}"}, {"{seq}"}, {"{cast}"}, {"{cast|seq}"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ho-prefix">Prefix</Label>
            <Input
              id="ho-prefix"
              value={form.prefix}
              disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, prefix: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ho-pattern">Pattern</Label>
            <Input
              id="ho-pattern"
              value={form.pattern}
              disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, pattern: e.target.value }))}
            />
          </div>
        </div>
        {preview && <p className="text-xs text-muted-foreground">Preview: {preview}</p>}
        <Button onClick={() => save.mutate()} disabled={readOnly || save.isPending || !orgId}>
          Save numbering
        </Button>
      </CardContent>
    </Card>
  );
}
