import { useTranslation } from "react-i18next";
import { CheckCircle2, CircleHelp } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Token } from "@/components/ui/token";

import type { AirtableSettings } from "@/data/airtableSettings";
import type { AirtableBase, AirtableTable } from "@/data/airtableSchema";
import { airtableFallbackMessage, type FallbackCause } from "@/lib/airtableFallback";

/** The connect rail's step 1 body (personal access token). Extracted from
 *  `AirtableConnectRail` so the v3 wizard's `ConnectStep` can reuse it without the
 *  map/catalog steps `AirtableConnect` bundles. */
export function TokenStep({ value, onChange, canWrite }: { value: string; onChange: (v: string) => void; canWrite: boolean }) {
  const { t } = useTranslation("settingsAirtable");
  return (
    <div>
      <h3 className="text-title-sm font-semibold tracking-tight">{t("setupWizard.tokenStepTitle")}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {t("setupWizard.tokenHelpPrefix")}{" "}
        <Token className="text-xs">data.records:read</Token> {t("setupWizard.tokenHelpAnd")}{" "}
        <Token className="text-xs">schema.bases:read</Token>.
      </p>
      <Input
        type="password"
        placeholder={t("setupWizard.keyPlaceholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!canWrite}
        className="mt-4 max-w-[420px] bg-well-tint"
      />
      <div className="mt-5 flex items-center gap-2 border-t border-border pt-3.5">
        <CircleHelp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{t("setupWizard.noTokenHint")}</p>
      </div>
    </div>
  );
}

export interface BaseTableStepProps {
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

/** The connect rail's step 2 body (base and table selection, with a manual-entry fallback
 *  when the Airtable schema isn't readable). Extracted from `AirtableConnectRail` for the
 *  same reason as `TokenStep` above. */
export function BaseTableStep(p: BaseTableStepProps) {
  const { t } = useTranslation("settingsAirtable");
  const s = p.settings;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-title-sm font-semibold tracking-tight">{t("manageDialog.baseTable.label")}</h3>
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
