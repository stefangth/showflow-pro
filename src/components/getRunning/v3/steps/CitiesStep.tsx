import { useContext } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useCan } from "@/hooks/useCapabilities";
import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";
import { Button } from "@/components/ui/button";
import { CatalogTab } from "@/components/settings/airtable/CatalogTab";
import { ROUTES } from "@/config/app.config";

/**
 * The "cities" step's body (Wireflow v3 Phase 2, Task 9): resolve every imported city to a
 * ShowFlow city, link-to-existing / create-new / bulk-create, fed straight from
 * `useAirtableConsole` (the same data-wiring the Settings Airtable console and `MapStep`/
 * `ConnectStep` use). Reuses `CatalogTab`'s Cities section via its `section="cities"` prop
 * (Task 9 brief) rather than re-implementing the row UI: the row rendering, the search/filter
 * toolbar and the selection-based bulk-create flow all come from that component, unchanged.
 *
 * Cities "cannot be skipped" (Controller Ruling, see the step brief): Continue is gated on
 * every `cityRows` entry having a `linkedId`, not on some separate confirmation. An org with
 * no Airtable cities yet (a by-hand org, or one that hasn't mapped a city field) sees the
 * empty state instead of an empty `CatalogTab` shell, with a link out to where cities are
 * actually managed (Settings › Casts & coverage) and Continue enabled immediately, since
 * there is nothing to resolve.
 *
 * Portals its Continue into `WizardFooterContext`'s slot, same pattern as `SourceStep`/
 * `ConnectStep`/`MapStep`. Read-only viewers (no `configure_airtable` capability) see the
 * catalog but `CatalogTab`'s own `canWrite` gate disables every link/create/unlink control;
 * Continue itself stays keyed only to resolution state, mirroring `MapStep` (a viewer who
 * arrives at an already-resolved step can still advance).
 */
export function CitiesStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const footerSlot = useContext(WizardFooterContext);
  const canEdit = useCan("configure_airtable");
  const airtable = useAirtableConsole(orgId, { readOnly: !canEdit, canTriggerSync: false });

  const cityRows = airtable.cityRows;
  const isEmpty = cityRows.length === 0;
  const canContinue = isEmpty || cityRows.every((row) => row.linkedId !== null);

  const continueButton = (
    <Button type="button" size="sm" disabled={!canContinue} onClick={onDone}>
      {t("body.cities.continue")}
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
          {t("body.cities.heading")}
        </div>
        <p className="text-xs text-muted-foreground">{t("body.cities.sub")}</p>
      </div>

      {isEmpty ? (
        <div className="space-y-2 rounded-l border border-border bg-well-tint px-3.5 py-6 text-center">
          <p className="text-sm text-muted-foreground">{t("body.cities.empty")}</p>
          <Link
            to={`${ROUTES.SETTINGS}?tab=casts-coverage`}
            className="inline-block text-control font-medium text-accent-600 underline-offset-2 hover:underline"
          >
            {t("body.cities.manageLink")}
          </Link>
        </div>
      ) : (
        <CatalogTab
          section="cities"
          programSource={airtable.programSource}
          citySource={airtable.citySource}
          programRows={[]}
          cityRows={cityRows}
          programExisting={[]}
          cityExisting={airtable.cityExisting}
          onLink={airtable.onLink}
          onCreate={airtable.onCreate}
          onUnlink={airtable.onUnlink}
          onBulkCreate={airtable.onBulkCreate}
          merge={airtable.mergeSuggestion}
          canWrite={airtable.canWrite}
          busy={airtable.catalogBusy}
        />
      )}

      {!canContinue && <p className="text-xs text-muted-foreground">{t("body.cities.incomplete")}</p>}

      {footerSlot ? createPortal(continueButton, footerSlot) : continueButton}
    </div>
  );
}
