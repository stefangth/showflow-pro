import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import type { Json } from "@/integrations/supabase/types";
import { HIRE_ORDER_DEFAULT_TERMS } from "@/config/app.config";
import {
  normalizeTermsSetting,
  defaultTemplateId,
  type HireOrderClause,
  type HireOrderTermsSetting,
} from "@/lib/hireOrders/terms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

function ClauseListEditor({
  label,
  clauses,
  onChange,
  readOnly = false,
}: {
  label: string;
  clauses: HireOrderClause[];
  onChange: (next: HireOrderClause[]) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Clauses</h5>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly}
          onClick={() => onChange([...clauses, { title: "", body: "" }])}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add clause
        </Button>
      </div>
      {clauses.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          No clauses yet. Add the clauses your organization wants printed on a "{label}" hire order before
          issuing one.
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
              disabled={readOnly}
              onChange={(e) =>
                onChange(clauses.map((c, j) => (j === i ? { ...c, title: e.target.value } : c)))
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${label} clause ${i + 1}`}
              disabled={readOnly}
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
            disabled={readOnly}
            onChange={(e) =>
              onChange(clauses.map((c, j) => (j === i ? { ...c, body: e.target.value } : c)))
            }
          />
        </div>
      ))}
    </div>
  );
}

export function TermsVariantsCard({ orgId, readOnly = false }: { orgId: string | null; readOnly?: boolean }) {
  const qc = useQueryClient();
  // Shares the ["app-settings","hire_order_terms",orgId] key with useHireOrderTerms
  // (the three order pickers), so a save here busts every picker's cache. Both
  // observers MUST resolve to the identical HireOrderTermsSetting shape -- the
  // queryFn normalizes here too (not just read into local state below), so a
  // legacy-shape org that hasn't re-saved yet never caches the raw {lean,standard,
  // full} object for a picker to read and crash on (`terms.templates` undefined).
  const { data, isLoading, isError, error } = useQuery<HireOrderTermsSetting>({
    queryKey: ["app-settings", "hire_order_terms", orgId],
    queryFn: async () =>
      normalizeTermsSetting(await resolveOrgSetting<unknown>(supabase, orgId, "hire_order_terms", HIRE_ORDER_DEFAULT_TERMS)),
    enabled: Boolean(orgId),
  });

  const [form, setForm] = useState<HireOrderTermsSetting>(HIRE_ORDER_DEFAULT_TERMS);
  const seededRef = useRef(false);
  useEffect(() => {
    if (data && !seededRef.current) {
      seededRef.current = true;
      setForm(normalizeTermsSetting(data));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error("No active organization");
      // Persist the EFFECTIVE default (null -> first template) so a saved setting
      // never depends on the default-templateId fallback at read time.
      const payload: HireOrderTermsSetting = { templates: form.templates, default_id: defaultTemplateId(form) };
      return upsertOrgSetting(supabase, orgId, "hire_order_terms", payload as unknown as Json);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Terms saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  // Read failed: render the error INSTEAD of the form. This card is the sharpest case
  // of that hazard: HIRE_ORDER_DEFAULT_TERMS is empty for every template, so falling
  // through would render "No clauses yet" and be indistinguishable from an org that
  // genuinely has none. A Save from there would wipe every authored clause.
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load the terms settings. {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  const effectiveDefaultId = defaultTemplateId(form);

  function addTemplate() {
    setForm((f) => ({
      ...f,
      templates: [...f.templates, { id: crypto.randomUUID(), name: "", clauses: [] }],
    }));
  }

  function renameTemplate(id: string, name: string) {
    setForm((f) => ({ ...f, templates: f.templates.map((t) => (t.id === id ? { ...t, name } : t)) }));
  }

  function updateClauses(id: string, clauses: HireOrderClause[]) {
    setForm((f) => ({ ...f, templates: f.templates.map((t) => (t.id === id ? { ...t, clauses } : t)) }));
  }

  function setDefault(id: string) {
    setForm((f) => ({ ...f, default_id: id }));
  }

  function deleteTemplate(id: string) {
    setForm((f) => {
      const wasDefault = defaultTemplateId(f) === id;
      const templates = f.templates.filter((t) => t.id !== id);
      return { templates, default_id: wasDefault ? (templates[0]?.id ?? null) : f.default_id };
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Terms</CardTitle>
        <CardDescription>
          Templates of clauses printed on the hire order PDF. A hire order picks one template when it is
          issued, and one template is marked as the default. ShowFlow ships no default clauses, so your
          organization authors its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {form.templates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            No templates yet. Add one to start authoring terms.
          </p>
        ) : (
          <RadioGroup
            value={effectiveDefaultId ?? undefined}
            onValueChange={setDefault}
            disabled={readOnly}
            className="space-y-4"
          >
            {form.templates.map((tpl, i) => {
              const label = tpl.name.trim() || `Template ${i + 1}`;
              const radioId = `ho-term-default-${tpl.id}`;
              return (
                <div
                  key={tpl.id}
                  data-testid={`terms-template-${tpl.id}`}
                  className="space-y-3 rounded-lg border border-border p-4"
                >
                  <div className="flex items-center gap-3">
                    <Input
                      aria-label={`Template ${i + 1} name`}
                      value={tpl.name}
                      placeholder="Template name"
                      className="flex-1"
                      disabled={readOnly}
                      onChange={(e) => renameTemplate(tpl.id, e.target.value)}
                    />
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value={tpl.id} id={radioId} disabled={readOnly} />
                      <Label htmlFor={radioId} className="cursor-pointer text-xs font-normal text-muted-foreground">
                        Default
                      </Label>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${label}`}
                      disabled={readOnly}
                      onClick={() => deleteTemplate(tpl.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <ClauseListEditor
                    label={label}
                    clauses={tpl.clauses}
                    onChange={(next) => updateClauses(tpl.id, next)}
                    readOnly={readOnly}
                  />
                </div>
              );
            })}
          </RadioGroup>
        )}
        <Separator />
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={addTemplate}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add template
          </Button>
          <Button onClick={() => save.mutate()} disabled={readOnly || save.isPending || !orgId}>
            Save terms
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
