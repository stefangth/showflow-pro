import { useContext, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useCan } from "@/hooks/useCapabilities";
import { useDatesSource } from "@/hooks/useDatesSource";
import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";
import { Button } from "@/components/ui/button";
import { TokenStep, BaseTableStep } from "@/components/getRunning/panels/airtable/connectSteps";

/**
 * The "connect" step's body (Wireflow v3 Phase 2, Task 7).
 *
 * `source === "manual"` (and, this phase, `"sheet"` or no source yet) renders a short info
 * line: by hand needs no connection, so Continue just advances. `source === "airtable"`
 * reuses the extracted `TokenStep`/`BaseTableStep` (Task 5) fed by `useAirtableConsole`, the
 * same data-wiring the Settings Airtable console and the v1 `AirtableConnectRail` use, so
 * nothing here re-implements token/base/table logic. Once `connected` (`keyPresent &&
 * hasBaseTable`) the token/base-table inputs give way to a short connected summary line, and
 * Continue becomes enabled.
 *
 * `source === "sheet"` has no dedicated connect flow this phase (Google Sheet is disabled on
 * the source step), so it falls through to the same manual-style info body rather than
 * blocking the wizard on a source that cannot be chosen yet.
 *
 * Portals its primary action into `WizardFooterContext`'s slot, same pattern as `SourceStep`.
 *
 * Read-only viewers (no `configure_airtable` capability) see the org's connection state but
 * cannot save a token or edit the base/table (enforced by `canWrite` on the extracted steps);
 * the Save-token button here is disabled the same way rather than hidden, since there is
 * nothing else to look at on this step for a viewer mid-setup.
 */
export function ConnectStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const footerSlot = useContext(WizardFooterContext);
  const canEdit = useCan("configure_airtable");
  const { source } = useDatesSource(orgId);
  const airtable = useAirtableConsole(orgId, { canTriggerSync: false });
  const [tokenValue, setTokenValue] = useState("");

  const isAirtable = source === "airtable";
  const connected = airtable.keyPresent && airtable.hasBaseTable;
  const canContinue = !isAirtable || connected;

  const continueButton = (
    <Button type="button" size="sm" disabled={!canContinue} onClick={onDone}>
      {t("body.connect.continue")}
    </Button>
  );

  const handleSaveToken = () => {
    if (!canEdit || !tokenValue.trim() || airtable.savingKey) return;
    airtable.saveKey(tokenValue, () => setTokenValue(""));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
          {t("body.connect.heading")}
        </div>
        <p className="text-xs text-muted-foreground">{t("body.connect.sub")}</p>
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
      ) : (
        <p className="text-sm text-muted-foreground">{t("body.connect.manual")}</p>
      )}

      {footerSlot ? createPortal(continueButton, footerSlot) : continueButton}
    </div>
  );
}
