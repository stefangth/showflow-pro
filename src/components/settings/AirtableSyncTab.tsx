import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Trash2, CheckCircle2, KeyRound, Lock, Loader2, AlertCircle } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import type { AirtableSettings } from "@/data/airtableSettings";
import { formatDateDMY } from "@/lib/dates";
import { POLL_INTERVAL_PRESETS, formatInterval } from "@/lib/airtablePoll";
import { airtableFallbackMessage, type FallbackCause } from "@/lib/airtableFallback";

import { StatusHeader } from "./airtable/StatusHeader";
import { ConsoleTabs, type ConsoleTab } from "./airtable/ConsoleTabs";
import { ReadOnlyBanner } from "./airtable/ReadOnlyBanner";
import { SetupWizard } from "./airtable/SetupWizard";
import { OverviewTab } from "./airtable/OverviewTab";
import { MappingTab } from "./airtable/MappingTab";
import { CatalogTab } from "./airtable/CatalogTab";
import { ActivityTab } from "./airtable/ActivityTab";

interface Props {
  orgId: string | null;
  /** Capability floor (`configure_airtable`): the console still renders read-only for a
   *  producer without the capability. Admins always pass `false`. */
  readOnly?: boolean;
  /** Capability floor (`trigger_sync`), independent of `readOnly`: whether this user may
   *  fire an on-demand "Sync now". Admins always pass `true`. */
  canTriggerSync?: boolean;
}

export function AirtableSyncTab({ orgId, readOnly = false, canTriggerSync = true }: Props) {
  const { t } = useTranslation('settingsAirtable');
  const canWrite = !readOnly;
  const [airtableKey, setAirtableKey] = useState("");
  const [replacing, setReplacing] = useState(false);

  // Console UI state
  const [tab, setTab] = useState<ConsoleTab>("overview");
  const [openCause, setOpenCause] = useState<string | null>("unlinked_program");
  const [manageOpen, setManageOpen] = useState(false);
  // Setup-wizard local token (distinct from the manage-connection replace field).
  const [setupKey, setSetupKey] = useState("");

  const c = useAirtableConsole(orgId, { readOnly, canTriggerSync });

  // The key-save mutation always clears every local token draft on success, regardless of
  // which surface (setup wizard or manage-connection dialog) triggered it — matching the
  // pre-extraction behavior where both call sites shared one onSuccess.
  const resetKeyDrafts = () => { setAirtableKey(""); setSetupKey(""); setReplacing(false); };
  const openManage = (replace = false) => { setReplacing(replace); setManageOpen(true); };

  // ── Render ───────────────────────────────────────────────────────────────────
  if (!orgId) {
    return <p className="text-sm text-muted-foreground">{t('root.selectOrg')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {readOnly && <ReadOnlyBanner />}

      {c.mode === "setup" ? (
        <SetupWizard
          keyValue={setupKey}
          onKeyChange={setSetupKey}
          onSaveKey={() => c.saveKey(setupKey, resetKeyDrafts)}
          saving={c.savingKey}
          canWrite={canWrite}
          keyPresent={c.keyPresent}
          onManageConnection={() => openManage(false)}
        />
      ) : (
        <>
          <StatusHeader
            eyebrow={c.eyebrow}
            status={c.status}
            kpis={c.kpis}
            saved={c.saveState !== "saving" && c.saveState !== "error"}
            canSyncNow={canTriggerSync && c.keyPresent && !!c.settings.airtable_sync_enabled}
            syncing={c.syncing}
            onSyncNow={() => c.syncNow()}
          />

          <ConsoleTabs
            value={tab}
            onChange={setTab}
            heldCount={c.heldCount}
            syncEnabled={!!c.settings.airtable_sync_enabled}
            onToggleSync={(v) => c.saveSettings({ airtable_sync_enabled: v })}
            canWrite={canWrite}
          />

          {tab === "overview" && (
            <OverviewTab
              showError={c.mode === "error"}
              errorTitle={t('overview.errorTitle')}
              errorDetail={c.status.line}
              onReplaceToken={() => openManage(true)}
              allClear={c.mode === "healthy" && c.heldCount === 0}
              attention={c.causes.length > 0 ? {
                causes: c.causes,
                heldCount: c.heldCount,
                canWrite,
                openCategory: openCause,
                onToggle: (cat) => setOpenCause((prev) => (prev === cat ? null : cat)),
                onFix: c.onFixCause,
                onOpenCatalog: () => setTab("catalog"),
                onOpenActivity: () => setTab("activity"),
                nextRunLabel: c.nextRunLabel,
              } : null}
              connection={{
                token: c.keyUpdatedAt
                  ? t('overview.connection.tokenSaved', { date: formatDateDMY(new Date(c.keyUpdatedAt)) })
                  : t('overview.connection.tokenNotSet'),
                base: c.baseName,
                tableView: `${c.settings.airtable_table_name || t('overview.connection.tableViewFallbackTable')} · ${c.settings.airtable_view || t('overview.connection.tableViewFallbackView')}`,
                frequency: t('overview.connection.frequency', { interval: formatInterval(c.settings.airtable_poll_interval_minutes) }),
              }}
              onManageConnection={() => openManage(false)}
              recentRuns={c.recent.slice(0, 5)}
              canWrite={canWrite}
            />
          )}

          {tab === "mapping" && (
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
                  {t('mappingTab.pickBaseAndTable')} <button className="underline" onClick={() => openManage(false)}>{t('mappingTab.manageConnectionLink')}</button> {t('mappingTab.pickBaseAndTableSuffix')}
                </AlertDescription>
              </Alert>
            )
          )}

          {tab === "catalog" && (
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

          {tab === "activity" && <ActivityTab runs={c.recent} loading={c.recentLoading} />}
        </>
      )}

      <ManageConnectionDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        canWrite={canWrite}
        keyPresent={c.keyPresent}
        keyUpdatedAt={c.keyUpdatedAt}
        replacing={replacing}
        setReplacing={setReplacing}
        airtableKey={airtableKey}
        setAirtableKey={setAirtableKey}
        onSaveKey={() => c.saveKey(airtableKey, resetKeyDrafts)}
        savingKey={c.savingKey}
        onDeleteKey={() => c.deleteKey(() => { setAirtableKey(""); setReplacing(false); })}
        deletingKey={c.deletingKey}
        settings={c.settings}
        onSaveSettings={c.saveSettings}
        saveState={c.saveState}
        schemaState={c.schemaState}
        fallbackCause={c.fallbackCause}
        isSchemaPending={c.isSchemaPending}
        refreshSchema={c.refreshSchema}
        bases={c.bases}
        tables={c.tables}
      />
    </div>
  );
}

// ── Manage-connection dialog (base/table/view/frequency + the Vault key) ────────

function AutosaveStatus({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  const { t } = useTranslation('settingsAirtable');
  if (state === "idle") return null;
  if (state === "saving") return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> {t('autosaveStatus.saving')}</span>;
  if (state === "saved") return <span className="flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3 w-3 text-primary" /> {t('autosaveStatus.saved')}</span>;
  return <span className="flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3 w-3" /> {t('autosaveStatus.error')}</span>;
}

interface ManageConnectionProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canWrite: boolean;
  keyPresent: boolean;
  keyUpdatedAt: string | null;
  replacing: boolean;
  setReplacing: (v: boolean) => void;
  airtableKey: string;
  setAirtableKey: (v: string) => void;
  onSaveKey: () => void;
  savingKey: boolean;
  onDeleteKey: () => void;
  deletingKey: boolean;
  settings: AirtableSettings;
  onSaveSettings: (patch: Partial<AirtableSettings>) => void;
  saveState: "idle" | "saving" | "saved" | "error";
  schemaState: "idle" | "loading" | "accessible" | "fallback";
  fallbackCause: FallbackCause;
  isSchemaPending: boolean;
  refreshSchema: () => void;
  bases: { id: string; name: string }[];
  tables: { id: string; name: string }[];
}

function ManageConnectionDialog(p: ManageConnectionProps) {
  const { t } = useTranslation('settingsAirtable');
  const s = p.settings;
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="font-display">{t('manageDialog.title')}</DialogTitle>
            <AutosaveStatus state={p.saveState} />
          </div>
          <DialogDescription>{t('manageDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* API key */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <Label className="font-medium">{t('manageDialog.token.label')}</Label>
              {p.keyPresent ? (
                <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> {t('manageDialog.token.keySaved')}</Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-muted-foreground"><KeyRound className="h-3 w-3" /> {t('manageDialog.token.notSet')}</Badge>
              )}
              {p.keyPresent && p.keyUpdatedAt && (
                <span className="text-xs text-muted-foreground">{t('manageDialog.token.updated', { date: formatDateDMY(new Date(p.keyUpdatedAt)) })}</span>
              )}
            </div>
            {p.keyPresent && !p.replacing ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-muted-foreground"><Lock className="h-4 w-4" /> {t('manageDialog.token.maskedValue')}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={!p.canWrite} onClick={() => p.setReplacing(true)}>{t('manageDialog.token.replace')}</Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={!p.canWrite || p.deletingKey}>
                        <Trash2 className="mr-1 h-4 w-4" /> {t('manageDialog.token.delete')}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('manageDialog.token.deleteDialogTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('manageDialog.token.deleteDialogDescription')}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t('manageDialog.token.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={p.onDeleteKey}>{t('manageDialog.token.deleteKeyConfirm')}</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input type="password" autoComplete="off" placeholder={p.keyPresent ? t('manageDialog.token.placeholderReplace') : t('manageDialog.token.placeholderNew')} value={p.airtableKey} disabled={!p.canWrite} onChange={(e) => p.setAirtableKey(e.target.value)} />
                  <Button onClick={p.onSaveKey} disabled={!p.canWrite || p.savingKey}>{p.keyPresent ? t('manageDialog.token.update') : t('manageDialog.token.saveKey')}</Button>
                  {p.keyPresent && p.replacing && (
                    <Button variant="ghost" onClick={() => { p.setReplacing(false); p.setAirtableKey(""); }}>{t('manageDialog.token.cancel')}</Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('manageDialog.token.helpPrefix')}{' '}
                  <span className="font-mono text-xs">data.records:read</span>{' '}
                  {t('manageDialog.token.helpAnd')}{' '}
                  <span className="font-mono text-xs">schema.bases:read</span>.
                </p>
              </>
            )}
          </div>

          {/* Base & table */}
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="font-medium">{t('manageDialog.baseTable.label')}</Label>
              {p.schemaState === "accessible" && <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> {t('manageDialog.baseTable.schemaConnected')}</Badge>}
              {p.schemaState === "fallback" && <Badge variant="outline">{t('manageDialog.baseTable.manualMode')}</Badge>}
              <Button variant="outline" size="sm" className="ml-auto" onClick={p.refreshSchema} disabled={p.isSchemaPending || !p.keyPresent}>
                {p.isSchemaPending ? t('manageDialog.baseTable.refreshLoading') : t('manageDialog.baseTable.refresh')}
              </Button>
            </div>
            {!p.keyPresent && <p className="text-xs text-muted-foreground">{t('manageDialog.baseTable.saveKeyFirst')}</p>}
            {p.schemaState === "accessible" ? (
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-2">
                  <Label>{t('manageDialog.baseTable.baseLabel')}</Label>
                  <Select value={s.airtable_base_id} onValueChange={(v) => p.onSaveSettings({ airtable_base_id: v, airtable_table_name: "" })} disabled={!p.canWrite}>
                    <SelectTrigger><SelectValue placeholder={t('manageDialog.baseTable.selectBasePlaceholder')} /></SelectTrigger>
                    <SelectContent>{p.bases.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('manageDialog.baseTable.tableLabel')}</Label>
                  <Select value={s.airtable_table_name} onValueChange={(v) => p.onSaveSettings({ airtable_table_name: v })} disabled={!p.tables.length || !p.canWrite}>
                    <SelectTrigger><SelectValue placeholder={t('manageDialog.baseTable.selectTablePlaceholder')} /></SelectTrigger>
                    <SelectContent>{p.tables.map((tb) => <SelectItem key={tb.id} value={tb.name}>{tb.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            ) : p.schemaState === "fallback" ? (
              <>
                <Alert><AlertDescription>{airtableFallbackMessage(p.fallbackCause)}</AlertDescription></Alert>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-2">
                    <Label>{t('manageDialog.baseTable.baseIdLabel')}</Label>
                    <Input placeholder={t('manageDialog.baseTable.baseIdPlaceholder')} defaultValue={s.airtable_base_id} key={`base-${s.airtable_base_id}`} disabled={!p.canWrite} onBlur={(e) => { if (e.target.value !== s.airtable_base_id) p.onSaveSettings({ airtable_base_id: e.target.value, airtable_table_name: "" }); }} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('manageDialog.baseTable.tableNameLabel')}</Label>
                    <Input placeholder={t('manageDialog.baseTable.tableNamePlaceholder')} defaultValue={s.airtable_table_name} key={`table-${s.airtable_table_name}`} disabled={!p.canWrite} onBlur={(e) => { if (e.target.value !== s.airtable_table_name) p.onSaveSettings({ airtable_table_name: e.target.value }); }} />
                  </div>
                </div>
              </>
            ) : p.schemaState === "loading" ? (
              <div className="grid grid-cols-1 gap-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : null}
            {p.keyPresent && s.airtable_table_name && (
              <div className="space-y-2">
                <Label>{t('manageDialog.baseTable.viewLabel')}</Label>
                <Input placeholder={t('manageDialog.baseTable.viewPlaceholder')} defaultValue={s.airtable_view} key={`view-${s.airtable_view}`} disabled={!p.canWrite} onBlur={(e) => { const v = e.target.value.trim(); if (v !== s.airtable_view) p.onSaveSettings({ airtable_view: v }); }} />
                <p className="text-xs text-muted-foreground">{t('manageDialog.baseTable.viewHelp')}</p>
              </div>
            )}
          </div>

          {/* Frequency */}
          <div className="space-y-2 border-t border-border pt-4">
            <Label className="font-medium">{t('manageDialog.frequency.label')}</Label>
            <Select value={String(s.airtable_poll_interval_minutes)} onValueChange={(v) => p.onSaveSettings({ airtable_poll_interval_minutes: Number(v) })} disabled={!p.canWrite}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{POLL_INTERVAL_PRESETS.map((preset) => <SelectItem key={preset.value} value={String(preset.value)}>{preset.label}</SelectItem>)}</SelectContent>
            </Select>
            {s.airtable_poll_interval_minutes < 60 && (
              <Alert className="max-w-xl">
                <AlertTitle>{t('manageDialog.frequency.warningTitle')}</AlertTitle>
                <AlertDescription>{t('manageDialog.frequency.warningDescription')}</AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
