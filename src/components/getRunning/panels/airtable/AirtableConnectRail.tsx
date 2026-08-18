import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CheckCircle2, CircleHelp } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import type { AirtableSettings } from "@/data/airtableSettings";
import type { AirtableBase, AirtableTable } from "@/data/airtableSchema";
import { airtableFallbackMessage, type FallbackCause } from "@/lib/airtableFallback";

import { MappingTab } from "@/components/settings/airtable/MappingTab";
import { CatalogTab } from "@/components/settings/airtable/CatalogTab";
import { useLatchedOnReady } from "./useLatchedOnReady";

/** The four steps of the Get-running Airtable connect rail (screen 11b), also the four
 *  group keys the collapsed summary (11a, `AirtableConnectionSummary`) re-opens the rail
 *  on via `onEditStep`. */
export type AirtableConnectStep = "connect" | "baseTable" | "map" | "catalog";

interface StepDef {
  step: AirtableConnectStep;
  n: number;
  titleKey: string;
  hintKey: string;
}

const STEPS: StepDef[] = [
  { step: "connect", n: 1, titleKey: "setupWizard.steps.connectTitle", hintKey: "setupWizard.steps.connectHint" },
  { step: "baseTable", n: 2, titleKey: "setupWizard.steps.baseTableTitle", hintKey: "setupWizard.steps.baseTableHint" },
  { step: "map", n: 3, titleKey: "setupWizard.steps.mapFieldsTitle", hintKey: "setupWizard.steps.mapFieldsHint" },
  { step: "catalog", n: 4, titleKey: "setupWizard.steps.linkCatalogTitle", hintKey: "setupWizard.steps.linkCatalogHint" },
];

/** First step that still needs the visitor's attention, given the console's readiness. */
function firstUnsatisfiedStep(keyPresent: boolean, hasBaseTable: boolean): AirtableConnectStep {
  return keyPresent ? (hasBaseTable ? "map" : "baseTable") : "connect";
}

interface AirtableConnectRailProps {
  orgId: string | null;
  readOnly: boolean;
  canTriggerSync: boolean;
  /** Fires once the last step's primary is clicked — the caller (`AirtableConnect`)
   *  flips from the rail (11b) back to the collapsed summary (11a). */
  onConnected: () => void;
  /** Forces the rail open on a specific step, overriding the readiness-derived default —
   *  used when the summary's "Replace"/"Change"/"Map sessions"/"Review" re-opens the rail
   *  on the exact group the visitor clicked. */
  initialStep?: AirtableConnectStep;
  /** Fires on the footer's "Later" button — optional so existing callers keep compiling;
   *  when omitted the button renders with no handler (design-only, matching the mock). */
  onLater?: () => void;
}

/** The four-step connect rail (screen 11b): a numbered step list on the left, the active
 *  step's body on the right, and a persistent footer that saves + advances. Steps 3 and 4
 *  mount the existing `MappingTab`/`CatalogTab` unchanged, fed from `useAirtableConsole` —
 *  the same data-wiring the Settings console (`AirtableSyncTab`) uses, so nothing here
 *  re-implements mapping or catalog logic. */
export function AirtableConnectRail({ orgId, readOnly, canTriggerSync, onConnected, initialStep, onLater }: AirtableConnectRailProps) {
  const { t } = useTranslation("settingsAirtable");
  const c = useAirtableConsole(orgId, { readOnly, canTriggerSync });
  const canWrite = !readOnly;

  // The active step is LATCHED once, the moment the console has settled (`c.ready`), from the
  // first-unsatisfied step at that instant — and thereafter moves only on an explicit `goTo`
  // (a token save, or the footer's primary). It must NOT re-derive from readiness every
  // render: the base/table step autosaves the moment a table is picked, so a reactive
  // `activeStep` would jump straight to "map" before the visitor can set the optional view
  // name or click Continue (screen-11 review finding). Latching on `c.ready` rather than the
  // first render is essential — the key-status query is async, so an eager seed would read
  // keyPresent=false and wrongly park on "connect" until it resolved.
  const [activeStep, setActiveStep] = useLatchedOnReady<AirtableConnectStep>(
    c.ready,
    () => firstUnsatisfiedStep(c.keyPresent, c.hasBaseTable),
    initialStep ?? null,
  );
  const goTo = (step: AirtableConnectStep) => setActiveStep(step);

  const [tokenValue, setTokenValue] = useState("");

  // Latch not yet resolved (key-status/settings still loading) — show a skeleton rather than
  // flashing the wrong step. All hooks above have run, so this early return is rules-safe.
  if (activeStep === null) {
    return <Skeleton className="h-72 w-full rounded-[var(--radius-xl)]" />;
  }

  const activeIndex = STEPS.findIndex((s) => s.step === activeStep);

  // "Save and continue" (reused from SetupWizard) is honest only on the connect step,
  // where the primary click IS the save. The base/table step already autosaves on
  // Select-change/Input-blur — the footer press there only navigates forward, so it gets
  // its own "Continue" label rather than implying a save that already happened.
  const primaryLabel =
    activeStep === "connect" ? t("setupWizard.saveAndContinue")
      : activeStep === "baseTable" ? t("rail.footer.continue")
        : activeStep === "map" ? t("setupWizard.steps.linkCatalogTitle")
          : t("rail.footer.finish");

  const primaryDisabled =
    !canWrite
    || (activeStep === "connect" && (c.savingKey || !tokenValue.trim()))
    || (activeStep === "baseTable" && !c.hasBaseTable);

  const handlePrimary = () => {
    if (activeStep === "connect") {
      c.saveKey(tokenValue, () => { setTokenValue(""); goTo("baseTable"); });
    } else if (activeStep === "baseTable") {
      goTo("map");
    } else if (activeStep === "map") {
      goTo("catalog");
    } else {
      onConnected();
    }
  };

  return (
    <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-elev3">
      <div className="border-b border-border p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-600">{c.eyebrow}</p>
        <h2 className="mt-1.5 font-display text-[22px] font-semibold tracking-tight">{t("setupWizard.heading")}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("setupWizard.subheading")}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[236px_1fr]">
        <ol className="border-b border-border bg-muted py-4 sm:border-b-0 sm:border-r">
          {STEPS.map((s, i) => {
            const current = i === activeIndex;
            const done = i < activeIndex;
            const last = i === STEPS.length - 1;
            return (
              <li key={s.step} className="flex gap-3 px-4 py-2.5">
                <div className="flex flex-col items-center gap-1">
                  <span
                    className={cn(
                      "flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-semibold",
                      current
                        ? "bg-primary text-primary-foreground"
                        : done
                          ? "border border-accent-200 bg-accent-100 text-accent-700"
                          : "border border-border bg-card text-muted-foreground",
                    )}
                  >
                    {done ? <Check className="h-3 w-3" /> : s.n}
                  </span>
                  {!last && <span className="w-px flex-1 bg-border" />}
                </div>
                <div className="pb-1.5">
                  <p className={cn("text-[13px] font-semibold", i <= activeIndex ? "text-foreground" : "text-muted-foreground")}>
                    {t(s.titleKey)}
                  </p>
                  <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{t(s.hintKey)}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="p-4">
          {activeStep === "connect" && (
            <TokenStep value={tokenValue} onChange={setTokenValue} canWrite={canWrite} />
          )}
          {activeStep === "baseTable" && (
            <BaseTableStep
              canWrite={canWrite}
              keyPresent={c.keyPresent}
              settings={c.settings}
              onSaveSettings={c.saveSettings}
              schemaState={c.schemaState}
              fallbackCause={c.fallbackCause}
              isSchemaPending={c.isSchemaPending}
              refreshSchema={c.refreshSchema}
              bases={c.bases}
              tables={c.tables}
            />
          )}
          {activeStep === "map" && (
            c.selectedTable ? (
              <MappingTab
                tableName={c.selectedTable.name}
                fields={c.selectedTable.fields.map((f) => ({ id: f.id, name: f.name }))}
                fieldMap={c.fieldMap}
                onSetField={c.setField}
                mapped={c.mapped}
                total={c.mappedTotal}
                optionNames={c.optionNames}
                unboundFields={c.unboundFields}
                onAddAllCustom={c.addAllCustom}
                canWrite={canWrite}
              />
            ) : (
              <Alert>
                <AlertDescription>
                  {t("mappingTab.pickBaseAndTable")}{" "}
                  <button type="button" className="underline" onClick={() => goTo("baseTable")}>
                    {t("setupWizard.steps.baseTableTitle")}
                  </button>{" "}
                  {t("mappingTab.pickBaseAndTableSuffix")}
                </AlertDescription>
              </Alert>
            )
          )}
          {activeStep === "catalog" && (
            <CatalogTab
              programSource={c.programSource}
              citySource={c.citySource}
              programRows={c.programRows}
              cityRows={c.cityRows}
              programExisting={c.programExisting}
              cityExisting={c.cityExisting}
              onLink={c.onLink}
              onCreate={c.onCreate}
              onUnlink={c.onUnlink}
              onBulkCreate={c.onBulkCreate}
              merge={c.mergeSuggestion}
              canWrite={canWrite}
              busy={c.catalogBusy}
            />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2.5 border-t border-border bg-muted px-4 py-3.5">
        <span className="font-mono text-xs font-medium text-accent-600">{t("rail.footer.stepOf", { n: activeIndex + 1 })}</span>
        <span className="text-xs text-muted-foreground">{t("rail.footer.savedAsYouGo")}</span>
        <span className="flex-1" />
        <Button type="button" variant="outline" onClick={onLater}>{t("rail.footer.later")}</Button>
        <Button type="button" onClick={handlePrimary} disabled={primaryDisabled}>{primaryLabel}</Button>
      </div>
    </div>
  );
}

// ── Step 1: Connect (personal access token) ─────────────────────────────────────

function TokenStep({ value, onChange, canWrite }: { value: string; onChange: (v: string) => void; canWrite: boolean }) {
  const { t } = useTranslation("settingsAirtable");
  return (
    <div>
      <h3 className="text-[17px] font-semibold tracking-tight">{t("setupWizard.tokenStepTitle")}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {t("setupWizard.tokenHelpPrefix")}{" "}
        <span className="font-mono text-xs">data.records:read</span> {t("setupWizard.tokenHelpAnd")}{" "}
        <span className="font-mono text-xs">schema.bases:read</span>.
      </p>
      <Input
        type="password"
        placeholder={t("setupWizard.keyPlaceholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!canWrite}
        className="mt-4 max-w-[420px] bg-muted"
      />
      <div className="mt-5 flex items-center gap-2 border-t border-border pt-3.5">
        <CircleHelp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{t("setupWizard.noTokenHint")}</p>
      </div>
    </div>
  );
}

// ── Step 2: Base and table ───────────────────────────────────────────────────────

interface BaseTableStepProps {
  canWrite: boolean;
  keyPresent: boolean;
  settings: AirtableSettings;
  onSaveSettings: (patch: Partial<AirtableSettings>) => void;
  schemaState: "idle" | "loading" | "accessible" | "fallback";
  fallbackCause: FallbackCause;
  isSchemaPending: boolean;
  refreshSchema: () => void;
  bases: AirtableBase[];
  tables: AirtableTable[];
}

function BaseTableStep(p: BaseTableStepProps) {
  const { t } = useTranslation("settingsAirtable");
  const s = p.settings;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[17px] font-semibold tracking-tight">{t("manageDialog.baseTable.label")}</h3>
        {p.schemaState === "accessible" && (
          <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> {t("manageDialog.baseTable.schemaConnected")}</Badge>
        )}
        {p.schemaState === "fallback" && <Badge variant="outline">{t("manageDialog.baseTable.manualMode")}</Badge>}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={p.refreshSchema}
          disabled={p.isSchemaPending || !p.keyPresent}
        >
          {p.isSchemaPending ? t("manageDialog.baseTable.refreshLoading") : t("manageDialog.baseTable.refresh")}
        </Button>
      </div>
      {!p.keyPresent && <p className="text-xs text-muted-foreground">{t("manageDialog.baseTable.saveKeyFirst")}</p>}
      {p.schemaState === "accessible" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("manageDialog.baseTable.baseLabel")}</Label>
            <Select value={s.airtable_base_id} onValueChange={(v) => p.onSaveSettings({ airtable_base_id: v, airtable_table_name: "" })} disabled={!p.canWrite}>
              <SelectTrigger><SelectValue placeholder={t("manageDialog.baseTable.selectBasePlaceholder")} /></SelectTrigger>
              <SelectContent>{p.bases.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("manageDialog.baseTable.tableLabel")}</Label>
            <Select value={s.airtable_table_name} onValueChange={(v) => p.onSaveSettings({ airtable_table_name: v })} disabled={!p.tables.length || !p.canWrite}>
              <SelectTrigger><SelectValue placeholder={t("manageDialog.baseTable.selectTablePlaceholder")} /></SelectTrigger>
              <SelectContent>{p.tables.map((tb) => <SelectItem key={tb.id} value={tb.name}>{tb.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      ) : p.schemaState === "fallback" ? (
        <>
          <Alert><AlertDescription>{airtableFallbackMessage(p.fallbackCause)}</AlertDescription></Alert>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("manageDialog.baseTable.baseIdLabel")}</Label>
              <Input
                placeholder={t("manageDialog.baseTable.baseIdPlaceholder")}
                defaultValue={s.airtable_base_id}
                key={`base-${s.airtable_base_id}`}
                disabled={!p.canWrite}
                onBlur={(e) => { if (e.target.value !== s.airtable_base_id) p.onSaveSettings({ airtable_base_id: e.target.value, airtable_table_name: "" }); }}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("manageDialog.baseTable.tableNameLabel")}</Label>
              <Input
                placeholder={t("manageDialog.baseTable.tableNamePlaceholder")}
                defaultValue={s.airtable_table_name}
                key={`table-${s.airtable_table_name}`}
                disabled={!p.canWrite}
                onBlur={(e) => { if (e.target.value !== s.airtable_table_name) p.onSaveSettings({ airtable_table_name: e.target.value }); }}
              />
            </div>
          </div>
        </>
      ) : p.schemaState === "loading" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
      ) : null}
      {p.keyPresent && s.airtable_table_name && (
        <div className="space-y-2">
          <Label>{t("manageDialog.baseTable.viewLabel")}</Label>
          <Input
            placeholder={t("manageDialog.baseTable.viewPlaceholder")}
            defaultValue={s.airtable_view}
            key={`view-${s.airtable_view}`}
            disabled={!p.canWrite}
            onBlur={(e) => { const v = e.target.value.trim(); if (v !== s.airtable_view) p.onSaveSettings({ airtable_view: v }); }}
          />
          <p className="text-xs text-muted-foreground">{t("manageDialog.baseTable.viewHelp")}</p>
        </div>
      )}
    </div>
  );
}
