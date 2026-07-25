import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import type { Json } from "@/integrations/supabase/types";
import { type FeeBasis, isFeeBasis } from "@/lib/hireOrders/feeBasis";
import { ORDER_DEFAULTS_DEFAULT } from "./defaults";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The `hire_order_defaults` app_settings value (spec §2.3 / §2.6). */
export interface HireOrderDefaults {
  default_fee: number | null;
  currency: string;
  /** Whether `default_fee` is charged once per engagement date or covers the
   *  whole engagement. Prefills the wizard; a producer can switch per order. */
  default_fee_basis: FeeBasis;
}

/** Kept in sync with the CURRENCY_SYMBOLS map in src/lib/hireOrders/money.ts. */
const CURRENCIES = ["EUR", "USD", "CHF"];

export function OrderDefaultsCard({ orgId, readOnly = false }: { orgId: string | null; readOnly?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
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
      // resolveOrgSetting replaces the fallback wholesale on a match rather than
      // merging field-by-field, so an org that saved this setting before
      // default_fee_basis existed comes back with the key entirely absent — and
      // nothing validates this hand-editable JSON on the way in, so it can also
      // hold "" or "weekly". Validate with the same predicate the server uses
      // (a bare `??` would let those through and render the Select blank while
      // the server bills per_date), so the control shows what will happen.
      setForm({
        ...data,
        default_fee_basis: isFeeBasis(data.default_fee_basis) ? data.default_fee_basis : "per_date",
      });
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
  // Read failed: render the error INSTEAD of the form. Falling through would show
  // ORDER_DEFAULTS_DEFAULT as if it were the org's saved values, and a Save from
  // there would overwrite a real stored default fee with none.
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load the order defaults. {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Order defaults</CardTitle>
        <CardDescription>
          Prefills a new hire order's fee, basis, and currency. A per-date fee is multiplied by the
          number of engagement dates on the order. A producer can always adjust it per order.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ho-default-fee">Default fee</Label>
            <Input
              id="ho-default-fee"
              type="number"
              min={0}
              step="0.01"
              value={form.default_fee ?? ""}
              placeholder="No default"
              disabled={readOnly}
              onChange={(e) =>
                setForm((f) => ({ ...f, default_fee: e.target.value === "" ? null : Number(e.target.value) }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ho-currency">Currency</Label>
            <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))} disabled={readOnly}>
              <SelectTrigger id="ho-currency"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="ho-fee-basis">Fee basis</Label>
            <Select
              value={form.default_fee_basis}
              onValueChange={(v) => setForm((f) => ({ ...f, default_fee_basis: v as FeeBasis }))}
              disabled={readOnly}
            >
              <SelectTrigger id="ho-fee-basis" aria-label="Fee basis"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="per_date">Per date</SelectItem>
                <SelectItem value="total">Total for all dates</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={() => save.mutate()} disabled={readOnly || save.isPending || !orgId}>
          Save defaults
        </Button>
      </CardContent>
    </Card>
  );
}
