import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import type { Json } from "@/integrations/supabase/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The `hire_order_defaults` app_settings value (spec §2.3 / §2.6). */
export interface HireOrderDefaults {
  default_fee: number | null;
  currency: string;
}
export const ORDER_DEFAULTS_DEFAULT: HireOrderDefaults = { default_fee: null, currency: "EUR" };

/** Kept in sync with the CURRENCY_SYMBOLS map in src/lib/hireOrders/money.ts. */
const CURRENCIES = ["EUR", "USD", "CHF"];

export function OrderDefaultsCard({ orgId }: { orgId: string | null }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["app-settings", "hire_order_defaults", orgId],
    queryFn: () => resolveOrgSetting<HireOrderDefaults>(supabase, orgId, "hire_order_defaults", ORDER_DEFAULTS_DEFAULT),
    enabled: Boolean(orgId),
  });

  const [form, setForm] = useState<HireOrderDefaults>(ORDER_DEFAULTS_DEFAULT);
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
      return upsertOrgSetting(supabase, orgId, "hire_order_defaults", form as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Order defaults saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Order defaults</CardTitle>
        <CardDescription>
          Prefills a new hire order's fee and currency. A producer can always adjust the fee per order.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ho-default-fee">Default fee</Label>
            <Input
              id="ho-default-fee"
              type="number"
              min={0}
              step="0.01"
              value={form.default_fee ?? ""}
              placeholder="No default"
              onChange={(e) =>
                setForm((f) => ({ ...f, default_fee: e.target.value === "" ? null : Number(e.target.value) }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ho-currency">Currency</Label>
            <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
              <SelectTrigger id="ho-currency"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !orgId}>
          Save defaults
        </Button>
      </CardContent>
    </Card>
  );
}
