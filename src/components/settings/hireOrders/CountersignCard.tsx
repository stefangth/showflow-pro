import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { invokeHireOrderAction } from "@/data/hireOrders";
import type { Json } from "@/integrations/supabase/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export type CountersignMode = "manual" | "documenso";

/** The `hire_order_countersign` app_settings value (spec §2.6 / §8). Only the
 *  Documenso instance URL lives in this org setting — the API token is a
 *  Vault-backed edge secret (DOCUMENSO_API_TOKEN) configured server-side by
 *  the platform operator, mirroring the Airtable PAT pattern: it is never
 *  entered, shown, or stored in this card. */
export interface HireOrderCountersign {
  mode: CountersignMode;
  base_url?: string;
}
export const COUNTERSIGN_DEFAULT: HireOrderCountersign = { mode: "manual" };

interface CountersignTestResult { ok: boolean; detail: string }

export function CountersignCard({ orgId }: { orgId: string | null }) {
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
      toast.success("Countersign mode saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // "Test connection" — an admin-only, cheap Documenso connectivity check
  // (generate-hire-orders' countersign-test action). Never sends a token from
  // here: the server reads DOCUMENSO_API_TOKEN from its own Vault-backed edge
  // secret and never echoes it back. Result renders inline, not as a toast, so
  // it stays visible next to the fields it describes.
  const [testResult, setTestResult] = useState<CountersignTestResult | null>(null);
  const test = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("No active organization");
      const result = await invokeHireOrderAction(supabase, {
        action: "countersign-test",
        org_id: orgId,
        base_url: form.base_url || undefined,
      });
      return result as CountersignTestResult;
    },
    onSuccess: (result) => setTestResult(result),
    onError: (e: Error) => setTestResult({ ok: false, detail: e.message }),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  // Read failed: render the error INSTEAD of the form. Falling through would show
  // COUNTERSIGN_DEFAULT ("manual") as if it were the org's saved mode, and a Save
  // from there would silently revert an org configured for documenso.
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
          onValueChange={(v) => {
            setForm((f) => ({ ...f, mode: v as CountersignMode }));
            setTestResult(null);
          }}
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
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="ho-documenso-base-url">Documenso instance URL</Label>
              <Input
                id="ho-documenso-base-url"
                placeholder="https://app.documenso.com"
                value={form.base_url ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use the hosted app.documenso.com. Enter a self-hosted instance's URL instead.
              </p>
            </div>
            <Alert>
              <AlertDescription>
                The Documenso API token is configured server-side by the platform operator (a Supabase Vault
                secret). It is never entered here.
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setTestResult(null); test.mutate(); }}
                disabled={test.isPending || !orgId}
              >
                {test.isPending ? "Testing connection..." : "Test connection"}
              </Button>
              {testResult?.ok && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  {testResult.detail}
                </span>
              )}
              {testResult && !testResult.ok && (
                <span className="text-xs text-destructive">{testResult.detail}</span>
              )}
            </div>
          </div>
        )}
        <Button onClick={() => save.mutate()} disabled={save.isPending || !orgId}>
          Save countersign mode
        </Button>
      </CardContent>
    </Card>
  );
}
