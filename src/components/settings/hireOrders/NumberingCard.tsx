import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import type { Json } from "@/integrations/supabase/types";
import { formatOrderNo } from "@/lib/hireOrders/orderNo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/** The `hire_order_numbering` app_settings value (spec §2.6). */
export interface HireOrderNumbering {
  prefix: string;
  pattern: string;
}
export const NUMBERING_DEFAULT: HireOrderNumbering = { prefix: "HO", pattern: "{prefix}-{yyyy}-{mmdd}-{cast|seq}" };

export function NumberingCard({ orgId }: { orgId: string | null }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["app-settings", "hire_order_numbering", orgId],
    queryFn: () => resolveOrgSetting<HireOrderNumbering>(supabase, orgId, "hire_order_numbering", NUMBERING_DEFAULT),
    enabled: Boolean(orgId),
  });

  const [form, setForm] = useState<HireOrderNumbering>(NUMBERING_DEFAULT);
  // Seed once when server data first arrives; a later unrelated refetch must not
  // clobber in-progress edits (the save's own refetch already matches the form).
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
      return upsertOrgSetting(supabase, orgId, "hire_order_numbering", form as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Numbering saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  // Rendered with the shared pure formatter (src/lib/hireOrders/orderNo.ts) so the
  // preview can never drift from the number the generator actually stamps.
  const preview = formatOrderNo(form.pattern, { prefix: form.prefix, date: "2026-06-15", seq: 7 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Numbering</CardTitle>
        <CardDescription>
          Controls the order number stamped on every hire order. Supported tokens: {"{prefix}"}, {"{yyyy}"}, {"{mm}"}, {"{dd}"}, {"{mmdd}"}, {"{cast|seq}"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ho-prefix">Prefix</Label>
            <Input
              id="ho-prefix"
              value={form.prefix}
              onChange={(e) => setForm((f) => ({ ...f, prefix: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ho-pattern">Pattern</Label>
            <Input
              id="ho-pattern"
              value={form.pattern}
              onChange={(e) => setForm((f) => ({ ...f, pattern: e.target.value }))}
            />
          </div>
        </div>
        {preview && <p className="text-xs text-muted-foreground">Preview: {preview}</p>}
        <Button onClick={() => save.mutate()} disabled={save.isPending || !orgId}>
          Save numbering
        </Button>
      </CardContent>
    </Card>
  );
}
