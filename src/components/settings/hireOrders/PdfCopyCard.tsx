import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { invokeHireOrderAction } from "@/data/hireOrders";
import { openPdfBase64 } from "@/lib/hireOrders/openPdf";
import { HIRE_ORDER_COPY_DEFAULTS, type CopyKey, type HireOrderCopy } from "@/lib/hireOrders/pdfCopy";
import { COPY_SECTIONS, hasBadDash } from "./pdfCopyMeta";
import type { Json } from "@/integrations/supabase/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** No stored overrides -> every field shows its default. */
const COPY_CARD_DEFAULT: Partial<HireOrderCopy> = {};

/** Keep only keys whose value is non-empty AND differs from the default: the
 *  stored setting is a compact override map, never the full dictionary. */
function compactOverrides(form: Partial<HireOrderCopy>): Partial<HireOrderCopy> {
  const out: Partial<HireOrderCopy> = {};
  for (const key of Object.keys(HIRE_ORDER_COPY_DEFAULTS) as CopyKey[]) {
    const v = form[key];
    if (typeof v === "string" && v.trim() !== "" && v !== HIRE_ORDER_COPY_DEFAULTS[key]) {
      out[key] = v;
    }
  }
  return out;
}

export function PdfCopyCard({ orgId, readOnly = false }: { orgId: string | null; readOnly?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["app-settings", "hire_order_copy", orgId],
    queryFn: () => resolveOrgSetting<Partial<HireOrderCopy>>(supabase, orgId, "hire_order_copy", COPY_CARD_DEFAULT),
    enabled: Boolean(orgId),
  });

  // Local override map (only keys that differ from a default). The effective value
  // shown per field is form[key] ?? default[key]. Seed once when server data first
  // arrives; a later unrelated refetch must not clobber in-progress edits.
  const [form, setForm] = useState<Partial<HireOrderCopy>>({});
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
      return upsertOrgSetting(supabase, orgId, "hire_order_copy", compactOverrides(form) as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("PDF copy saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const preview = useMutation({
    mutationFn: () =>
      invokeHireOrderAction(supabase, {
        action: "preview",
        org_id: orgId,
        copy_override: compactOverrides(form),
      }),
    onSuccess: (res) => {
      const b64 = (res as { pdf_base64?: string } | null)?.pdf_base64;
      if (b64) openPdfBase64(b64);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  // Read failed: render the error INSTEAD of the fields. Falling through would show
  // the blank defaults as if they were the org's values, and a Save from there
  // would overwrite real stored copy.
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load the PDF copy settings. {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  function setField(key: CopyKey, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function resetField(key: CopyKey) {
    setForm((f) => {
      const next = { ...f };
      delete next[key];
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">PDF copy</CardTitle>
        <CardDescription>
          Customize every label and line printed on the hire order PDF. Leave a field on its default, or
          reset it any time. Tokens in double braces are filled in per order.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {COPY_SECTIONS.map((section) => (
          <div key={section.title} className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {section.title}
            </h4>
            {section.fields.map((field) => {
              const value = form[field.key] ?? HIRE_ORDER_COPY_DEFAULTS[field.key];
              const modified = value !== HIRE_ORDER_COPY_DEFAULTS[field.key];
              const id = `ho-copy-${field.key}`;
              return (
                <div key={field.key} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={id}>{field.label}</Label>
                    {modified && !readOnly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        aria-label={`Reset ${field.label} to default`}
                        onClick={() => resetField(field.key)}
                      >
                        Reset to default
                      </Button>
                    )}
                  </div>
                  {field.multiline ? (
                    <Textarea
                      id={id}
                      rows={2}
                      value={value}
                      disabled={readOnly}
                      onChange={(e) => setField(field.key, e.target.value)}
                    />
                  ) : (
                    <Input
                      id={id}
                      value={value}
                      disabled={readOnly}
                      onChange={(e) => setField(field.key, e.target.value)}
                    />
                  )}
                  {field.tokens.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Tokens: {field.tokens.map((t) => `{{${t}}}`).join(" ")}
                    </p>
                  )}
                  {hasBadDash(value) && (
                    <p className="text-xs text-destructive">
                      Use a period, comma, or middot instead of a dash.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Button onClick={() => save.mutate()} disabled={readOnly || save.isPending || !orgId}>
            Save PDF copy
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => preview.mutate()}
            disabled={preview.isPending || !orgId}
          >
            Preview
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
