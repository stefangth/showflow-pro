import { useContext, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useCan } from "@/hooks/useCapabilities";
import { useDatesSource } from "@/hooks/useDatesSource";
import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import { useSheetImport } from "@/hooks/useSheetImport";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TokenStep, BaseTableStep } from "@/components/getRunning/panels/airtable/connectSteps";

/**
 * A soft, client-side plausibility check on a Google Sheets "publish to web as CSV"
 * link, mirroring `isAllowedSheetUrl`'s predicate shape in the `fetch-remote-sheet`
 * edge function (exact host, `/spreadsheets/` path, `format=csv`). This only gates
 * whether Continue looks reasonable to press; the edge function re-validates for real
 * and is the actual SSRF guard.
 */
function looksLikePublishedSheetUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.hostname !== "docs.google.com") return false;
  if (!u.pathname.startsWith("/spreadsheets/")) return false;
  return u.searchParams.get("format") === "csv";
}

/**
 * The "connect" step's body (Wireflow v3 Phase 2, Task 7; Sheet branch added Phase 4,
 * Task A5).
 *
 * `source === "manual"` (and no source yet) renders a short info line: by hand needs no
 * connection, so Continue just advances. `source === "airtable"` reuses the extracted
 * `TokenStep`/`BaseTableStep` (Task 5) fed by `useAirtableConsole`, the same data-wiring
 * the Settings Airtable console and the v1 `AirtableConnectRail` use, so nothing here
 * re-implements token/base/table logic. Once `connected` (`keyPresent && hasBaseTable`)
 * the token/base-table inputs give way to a short connected summary line, and Continue
 * becomes enabled.
 *
 * `source === "sheet"` pastes the published-CSV URL (`useSheetImport`'s `settings.url`),
 * saves it via `saveSettings`, and loads its columns via `loadSheet` (which also caches
 * the parsed rows for the Cities step's import trigger, so a visitor who reaches Cities
 * right after loading here does not pay for a second fetch). Continue only needs a
 * plausible URL (`looksLikePublishedSheetUrl`) — the actual column mapping happens on the
 * next step, once headers are loaded.
 *
 * Portals its primary action into `WizardFooterContext`'s slot, same pattern as `SourceStep`.
 *
 * Read-only viewers (no `configure_airtable` capability) see the org's connection state but
 * cannot save a token, edit the base/table, or edit the sheet URL (enforced by `canWrite` on
 * the extracted Airtable steps, and by disabling the sheet URL input/actions here); nothing
 * on this step is hidden from a viewer mid-setup, only editing is capability-gated.
 */
export function ConnectStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const footerSlot = useContext(WizardFooterContext);
  const canEdit = useCan("configure_airtable");
  const { source } = useDatesSource(orgId);
  const airtable = useAirtableConsole(orgId, { readOnly: !canEdit, canTriggerSync: false });
  const sheetImport = useSheetImport(orgId);
  const [tokenValue, setTokenValue] = useState("");
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [loadedCount, setLoadedCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadingColumns, setLoadingColumns] = useState(false);

  const isAirtable = source === "airtable";
  const isSheet = source === "sheet";
  const connected = airtable.keyPresent && airtable.hasBaseTable;
  const effectiveSheetUrl = sheetUrl ?? sheetImport.settings.url;
  const sheetUrlValid = looksLikePublishedSheetUrl(effectiveSheetUrl);
  // Continue is gated on the URL being SAVED, not merely typed: "Load columns"
  // persists it (and loads the headers MapStep needs). Advancing on an unsaved
  // URL would strand MapStep, which reads back an empty `settings.url` on its
  // fresh useSheetImport mount and can never complete its column mapping.
  const sheetReady = sheetUrlValid && sheetImport.settings.url === effectiveSheetUrl;
  const canContinue = isAirtable ? connected : isSheet ? sheetReady : true;

  const continueButton = (
    <Button type="button" size="sm" disabled={!canContinue} onClick={onDone}>
      {t("body.connect.continue")}
    </Button>
  );

  const handleSaveToken = () => {
    if (!canEdit || !tokenValue.trim() || airtable.savingKey) return;
    airtable.saveKey(tokenValue, () => setTokenValue(""));
  };

  const handleLoadColumns = async () => {
    if (!canEdit || !sheetUrlValid || loadingColumns) return;
    setLoadError(false);
    setLoadingColumns(true);
    sheetImport.saveSettings({ ...sheetImport.settings, url: effectiveSheetUrl });
    try {
      const parsed = await sheetImport.loadSheet(effectiveSheetUrl);
      setLoadedCount(parsed.headers.length);
    } catch {
      setLoadError(true);
    } finally {
      setLoadingColumns(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
          {isSheet ? t("body.connect.sheet.heading") : t("body.connect.heading")}
        </div>
        <p className="text-xs text-muted-foreground">
          {isSheet ? t("body.connect.sheet.sub") : t("body.connect.sub")}
        </p>
      </div>

      {isAirtable ? (
        connected ? (
          <p className="text-sm text-muted-foreground">
            {t("body.connect.connected", {
              baseName: airtable.baseName,
              tableName: airtable.settings.airtable_table_name,
            })}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <TokenStep value={tokenValue} onChange={setTokenValue} canWrite={canEdit} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canEdit || !tokenValue.trim() || airtable.savingKey}
                onClick={handleSaveToken}
              >
                {t("body.connect.saveToken")}
              </Button>
            </div>
            <BaseTableStep
              canWrite={canEdit}
              keyPresent={airtable.keyPresent}
              settings={airtable.settings}
              onSaveSettings={airtable.saveSettings}
              schemaState={airtable.schemaState}
              fallbackCause={airtable.fallbackCause}
              isSchemaPending={airtable.isSchemaPending}
              refreshSchema={airtable.refreshSchema}
              bases={airtable.bases}
              tables={airtable.tables}
            />
          </div>
        )
      ) : isSheet ? (
        <div className="space-y-2">
          <Label htmlFor="sheet-url">{t("body.connect.sheet.urlLabel")}</Label>
          <Input
            id="sheet-url"
            value={effectiveSheetUrl}
            placeholder={t("body.connect.sheet.urlPlaceholder")}
            disabled={!canEdit}
            onChange={(e) => setSheetUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t("body.connect.sheet.helper")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canEdit || !sheetUrlValid || loadingColumns}
            onClick={handleLoadColumns}
          >
            {loadingColumns ? t("body.connect.sheet.loading") : t("body.connect.sheet.loadColumns")}
          </Button>
          {loadedCount !== null && !loadError && (
            <p className="text-xs text-muted-foreground">
              {t("body.connect.sheet.loaded", { count: loadedCount })}
            </p>
          )}
          {loadError && <p className="text-xs text-destructive">{t("body.connect.sheet.loadError")}</p>}
          {!sheetUrlValid && effectiveSheetUrl && (
            <p className="text-xs text-muted-foreground">{t("body.connect.sheet.invalidUrl")}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("body.connect.manual")}</p>
      )}

      {footerSlot ? createPortal(continueButton, footerSlot) : continueButton}
    </div>
  );
}
