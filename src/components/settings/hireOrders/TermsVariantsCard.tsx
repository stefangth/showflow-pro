import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import type { Json } from "@/integrations/supabase/types";
import { useDerivedDraft } from "@/hooks/useDerivedDraft";
import { HIRE_ORDER_DEFAULT_TERMS } from "@/config/app.config";
import {
  normalizeTermsSetting,
  defaultTemplateId,
  type HireOrderClause,
  type HireOrderTermsSetting,
} from "@/lib/hireOrders/terms";
import { useTermsLibrary, useImportTermsTemplates } from "@/hooks/useHireOrderSetup";
import { TermsLibraryPicker } from "./fields/TermsLibraryPicker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/common/IconTooltip";
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
  const { t } = useTranslation("settingsHireOrders");
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        {/* eslint-disable-next-line no-restricted-syntax -- non-standard tracking */}
        <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("termsVariantsCard.clausesHeading")}</h5>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readOnly}
          onClick={() => onChange([...clauses, { title: "", body: "" }])}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          {t("termsVariantsCard.addClause")}
        </Button>
      </div>
      {clauses.length === 0 && (
        <p className="rounded-card border border-dashed border-border p-3 text-xs text-muted-foreground">
          {t("termsVariantsCard.noClauses", { label })}
        </p>
      )}
      {clauses.map((clause, i) => (
        <div key={i} className="space-y-2 rounded-card border border-border p-3">
          <div className="flex items-center gap-2">
            <Input
              aria-label={t("termsVariantsCard.clauseTitleAria", { label, index: i + 1 })}
              value={clause.title}
              placeholder={t("termsVariantsCard.clauseTitlePlaceholder")}
              className="flex-1"
              disabled={readOnly}
              onChange={(e) =>
                onChange(clauses.map((c, j) => (j === i ? { ...c, title: e.target.value } : c)))
              }
            />
            <IconTooltip label={t("termsVariantsCard.removeClause")}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("termsVariantsCard.removeClauseAria", { label, index: i + 1 })}
                disabled={readOnly}
                onClick={() => onChange(clauses.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </IconTooltip>
          </div>
          <Textarea
            aria-label={t("termsVariantsCard.clauseBodyAria", { label, index: i + 1 })}
            rows={2}
            value={clause.body}
            placeholder={t("termsVariantsCard.clauseBodyPlaceholder")}
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
  const { t } = useTranslation("settingsHireOrders");
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

  // Normalized again on the way in, as the seed used to: the queryFn already does
  // it, and the two must not be able to drift.
  const stored = useMemo(() => (data ? normalizeTermsSetting(data) : undefined), [data]);
  // A view of the stored setting, not a copy seeded into state by an effect: Save
  // persists `form` verbatim, and a seeded copy is still the DEFAULT in the commit
  // that opens the `isLoading` gate below, and never re-seeds when the active org
  // changes underneath the card. An unrelated refetch still cannot clobber edits in
  // progress -- see useDerivedDraft.
  const [form, setForm] = useDerivedDraft<HireOrderTermsSetting>(stored, HIRE_ORDER_DEFAULT_TERMS);

  const [picked, setPicked] = useState<string[]>([]);
  const library = useTermsLibrary();
  const importTerms = useImportTermsTemplates(orgId);

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
      toast.success(t("termsVariantsCard.saved"));
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
        <AlertDescription>{t("termsVariantsCard.loadError")} {(error as Error).message}</AlertDescription>
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
        <CardTitle className="font-display">{t("termsVariantsCard.title")}</CardTitle>
        <CardDescription>
          {t("termsVariantsCard.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {library.data && library.data.length > 0 && (
          <div className="space-y-3 rounded-card border border-border p-3">
            <div>
              <h5 className="text-sm font-medium">{t("termsVariantsCard.startFromTemplate")}</h5>
              <p className="text-xs text-muted-foreground">
                {t("termsVariantsCard.startFromTemplateHelp")}
              </p>
            </div>
            <TermsLibraryPicker
              library={library.data}
              selectedIds={picked}
              alreadyHeldIds={form.templates.map((t) => t.id)}
              onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
              readOnly={readOnly}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={readOnly || picked.length === 0 || importTerms.isPending}
              // The clause editor below is seeded-once local state, so the import MUST
              // feed it the merged value. Without this, the editor keeps showing the
              // pre-import list and the card's own Save then persists that stale list,
              // deleting every clause the import just added.
              onClick={() =>
                importTerms.mutate(
                  { templateIds: picked },
                  { onSuccess: (next) => { setForm(next); setPicked([]); } },
                )
              }
            >
              {t("termsVariantsCard.addToOrg")}
            </Button>
          </div>
        )}
        {form.templates.length === 0 ? (
          <p className="rounded-card border border-dashed border-border p-3 text-xs text-muted-foreground">
            {t("termsVariantsCard.noTemplates")}
          </p>
        ) : (
          <RadioGroup
            value={effectiveDefaultId ?? undefined}
            onValueChange={setDefault}
            disabled={readOnly}
            className="space-y-4"
          >
            {form.templates.map((tpl, i) => {
              const label = tpl.name.trim() || t("termsVariantsCard.templateFallbackName", { index: i + 1 });
              const radioId = `ho-term-default-${tpl.id}`;
              return (
                <div
                  key={tpl.id}
                  data-testid={`terms-template-${tpl.id}`}
                  className="space-y-3 rounded-card border border-border p-4"
                >
                  <div className="flex items-center gap-3">
                    <Input
                      aria-label={t("termsVariantsCard.templateNameAria", { index: i + 1 })}
                      value={tpl.name}
                      placeholder={t("termsVariantsCard.templateNamePlaceholder")}
                      className="flex-1"
                      disabled={readOnly}
                      onChange={(e) => renameTemplate(tpl.id, e.target.value)}
                    />
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value={tpl.id} id={radioId} disabled={readOnly} />
                      <Label htmlFor={radioId} className="cursor-pointer text-xs font-normal text-muted-foreground">
                        {t("termsVariantsCard.default")}
                      </Label>
                    </div>
                    <IconTooltip label={t("termsVariantsCard.deleteTemplate", { label })}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("termsVariantsCard.deleteTemplate", { label })}
                        disabled={readOnly}
                        onClick={() => deleteTemplate(tpl.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </IconTooltip>
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
            {t("termsVariantsCard.addTemplate")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={readOnly || save.isPending || !orgId}>
            {t("termsVariantsCard.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
