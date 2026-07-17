import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import type { Json } from "@/integrations/supabase/types";
import { HIRE_ORDER_DEFAULT_TERMS, type HireOrderClause } from "@/config/app.config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

/** The `hire_order_terms` app_settings value (spec §2.6). */
export interface HireOrderTerms {
  lean: HireOrderClause[];
  standard: HireOrderClause[];
  full: HireOrderClause[];
}

type VariantKey = keyof HireOrderTerms;
const VARIANT_LABELS: Record<VariantKey, string> = { lean: "Lean", standard: "Standard", full: "Full" };

function ClauseListEditor({
  variantKey,
  clauses,
  onChange,
}: {
  variantKey: VariantKey;
  clauses: HireOrderClause[];
  onChange: (next: HireOrderClause[]) => void;
}) {
  const label = VARIANT_LABELS[variantKey];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-display font-semibold text-sm">{label}</h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...clauses, { title: "", body: "" }])}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add clause
        </Button>
      </div>
      {clauses.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          No clauses yet. Add the clauses your organization wants printed on a {label.toLowerCase()} hire order
          before issuing one.
        </p>
      )}
      {clauses.map((clause, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <Input
              aria-label={`${label} clause ${i + 1} title`}
              value={clause.title}
              placeholder="Clause title"
              className="flex-1"
              onChange={(e) =>
                onChange(clauses.map((c, j) => (j === i ? { ...c, title: e.target.value } : c)))
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${label} clause ${i + 1}`}
              onClick={() => onChange(clauses.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Textarea
            aria-label={`${label} clause ${i + 1} body`}
            rows={2}
            value={clause.body}
            placeholder="Clause text"
            onChange={(e) =>
              onChange(clauses.map((c, j) => (j === i ? { ...c, body: e.target.value } : c)))
            }
          />
        </div>
      ))}
    </div>
  );
}

export function TermsVariantsCard({ orgId }: { orgId: string | null }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["app-settings", "hire_order_terms", orgId],
    queryFn: () => resolveOrgSetting<HireOrderTerms>(supabase, orgId, "hire_order_terms", HIRE_ORDER_DEFAULT_TERMS),
    enabled: Boolean(orgId),
  });

  const [form, setForm] = useState<HireOrderTerms>(HIRE_ORDER_DEFAULT_TERMS);
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
      return upsertOrgSetting(supabase, orgId, "hire_order_terms", form as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Terms saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Terms</CardTitle>
        <CardDescription>
          Clauses printed on the hire order PDF. Lean, standard, and full are separate sets: a hire order
          picks one variant when it is issued. ShowFlow ships no default clauses, so your organization
          authors its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ClauseListEditor variantKey="lean" clauses={form.lean} onChange={(next) => setForm((f) => ({ ...f, lean: next }))} />
        <Separator />
        <ClauseListEditor variantKey="standard" clauses={form.standard} onChange={(next) => setForm((f) => ({ ...f, standard: next }))} />
        <Separator />
        <ClauseListEditor variantKey="full" clauses={form.full} onChange={(next) => setForm((f) => ({ ...f, full: next }))} />
        <Button onClick={() => save.mutate()} disabled={save.isPending || !orgId}>
          Save terms
        </Button>
      </CardContent>
    </Card>
  );
}
