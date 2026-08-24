import { useContext, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useCan } from "@/hooks/useCapabilities";
import { useDatesSource } from "@/hooks/useDatesSource";
import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import { useSheetImport } from "@/hooks/useSheetImport";
import { isSheetMapComplete, mapSheetRows } from "@/lib/sheetImport/mapRows";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiTile } from "@/components/ui/kpi-tile";
import { CatalogTab } from "@/components/settings/airtable/CatalogTab";
import { DatesMissingCityList } from "@/components/getRunning/v3/steps/DatesMissingCityList";
import { useDatesMissingCity } from "@/hooks/useShowDates";
import { ROUTES } from "@/config/app.config";

/**
 * The "cities" step's body (Wireflow v3 Phase 2, Task 9; Sheet branch added Phase 4, Task
 * A5): resolve every imported city to a ShowFlow city, link-to-existing / create-new /
 * bulk-create, fed straight from `useAirtableConsole` (the same data-wiring the Settings
 * Airtable console and `MapStep`/`ConnectStep` use). Reuses `CatalogTab`'s Cities section
 * via its `section="cities"` prop (Task 9 brief) rather than re-implementing the row UI:
 * the row rendering, the search/filter toolbar and the selection-based bulk-create flow
 * all come from that component, unchanged.
 *
 * Cities "cannot be skipped" (Controller Ruling, see the step brief): Continue is gated on
 * every `cityRows` entry having a `linkedId`, not on some separate confirmation. That empty
 * state is only correct once the console's own queries have settled (`airtable.ready`):
 * while still loading, an org with real unresolved Airtable cities would otherwise render as
 * "no cities" with Continue already enabled, letting a visitor click straight through before
 * those rows ever appear. So a loading console renders a skeleton instead, with Continue
 * disabled.
 *
 * The non-sheet body picks between four states, in this order ("Get running truthful
 * completion", Task 4, which fixed the dead end where all four collapsed into one):
 *   1. no dates at all (`hasAnyDates === false`) - nothing to give a city to yet, so point
 *      at the productions step rather than claiming the step is resolved;
 *   2. real dates with no city (`useDatesMissingCity`) - `DatesMissingCityList`, the only
 *      body that exists on the by-hand and sheet paths, where `cityRows` is always empty;
 *   3. imported Airtable city strings (`cityRows`) - the existing `CatalogTab`;
 *   4. otherwise the resolved/empty note, with a link out to where cities are actually
 *      managed (Settings › Casts & coverage) and Continue enabled, since nothing is left.
 * `hasAnyDates` arrives as a prop (`BookingSetupStatus.hasAnyDates`, resolved by
 * `StepBodyV3`) and is `null` while that read is in flight, which renders the skeleton: a
 * loading org must not flash "No dates yet" at an org that has hundreds.
 *
 * Continue is gated on state 1 AND 2 being clear too, not only on the imported rows. Before
 * Task 4 the manual path had `cityRows.length === 0`, so Continue was enabled the moment the
 * step opened and `onDone` collapsed the wizard while the block it claims to clear was still
 * standing.
 *
 * `source === "sheet"` is this step's actual import trigger (Task A5): "Import dates now"
 * gets the parsed sheet (`useSheetImport`'s cached `parsed`, reloading via `loadSheet` if
 * the cache was reset by a remount — the same fallback `MapStep` uses for headers), maps it
 * with `mapSheetRows`, and runs the import. The result (processed/new/updated/held) renders
 * as a row of `KpiTile`s; held rows only surface as a count with a note pointing at the city
 * catalog (`Settings › Casts & coverage`) rather than a per-row list, since
 * `SheetImportResult` doesn't carry which cities were held — a richer per-run breakdown is
 * Phase 5's "Sources console" work (see the task brief's design note), not this lean pass.
 * Continue is gated on an import having actually landed rows (`new_dates + updated > 0`),
 * not merely having been run once, so a run that held everything can't be waved through.
 *
 * Portals its Continue into `WizardFooterContext`'s slot, same pattern as `SourceStep`/
 * `ConnectStep`/`MapStep`. Read-only viewers (no `configure_airtable` capability) see the
 * catalog but `CatalogTab`'s own `canWrite` gate disables every link/create/unlink control
 * (the sheet branch's Import button is disabled the same way); Continue itself stays keyed
 * only to resolution state, mirroring `MapStep` (a viewer who arrives at an already-resolved
 * step can still advance).
 */
export function CitiesStep({
  orgId,
  onDone,
  hasAnyDates,
}: {
  orgId: string | null;
  onDone: () => void;
  /** `BookingSetupStatus.hasAnyDates`; `null` while that read is still in flight. */
  hasAnyDates: boolean | null;
}): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const footerSlot = useContext(WizardFooterContext);
  const canEdit = useCan("configure_airtable");
  const { source } = useDatesSource(orgId);
  const airtable = useAirtableConsole(orgId, { readOnly: !canEdit, canTriggerSync: false });
  const sheetImport = useSheetImport(orgId);
  // Two distinct failure points: loadSheet/mapSheetRows can throw locally (bad URL,
  // unreadable sheet) before an import ever runs, and runImport itself (the
  // import-sheet-dates edge fn) can reject after firing. Both need to surface, so
  // "nothing imported yet" is never confused with "the import failed".
  const [loadError, setLoadError] = useState(false);
  const mutationFailed = !!sheetImport.importError;

  const isSheet = source === "sheet";
  const loaded = airtable.ready;
  const cityRows = airtable.cityRows;

  // Shares its cache entry with `DatesMissingCityList`'s own call, so the list and the
  // Continue gate below can never disagree about how many dates are still unresolved.
  const missing = useDatesMissingCity(orgId);
  const missingCount = missing.data?.length ?? 0;
  const settled = loaded && hasAnyDates !== null && !missing.isLoading;
  const isEmpty = settled && hasAnyDates && missingCount === 0 && cityRows.length === 0;

  const sheetResult = sheetImport.result;
  const sheetMap = sheetImport.settings.map;
  const sheetMapReady = isSheetMapComplete(sheetMap);
  const sheetImportCanRun = canEdit && sheetMapReady && !!sheetImport.settings.url && !sheetImport.importing;
  const sheetContinue = !!sheetResult && sheetResult.new_dates + sheetResult.updated > 0;

  const canContinue = isSheet
    ? sheetContinue
    : settled && hasAnyDates === true && missingCount === 0 && cityRows.every((row) => row.linkedId !== null);

  const continueButton = (
    <Button type="button" size="sm" disabled={!canContinue} onClick={onDone}>
      {t("body.cities.continue")}
    </Button>
  );

  const handleImport = async () => {
    if (!sheetImportCanRun || !isSheetMapComplete(sheetMap)) return;
    setLoadError(false);
    try {
      const parsed = sheetImport.parsed ?? (await sheetImport.loadSheet(sheetImport.settings.url));
      const rows = mapSheetRows(parsed, sheetMap);
      sheetImport.runImport(rows);
    } catch {
      setLoadError(true);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
          {isSheet ? t("body.cities.sheet.heading") : t("body.cities.heading")}
        </div>
        <p className="text-xs text-muted-foreground">{isSheet ? t("body.cities.sheet.sub") : t("body.cities.sub")}</p>
      </div>

      {isSheet ? (
        <div className="space-y-4">
          <Button type="button" variant="outline" size="sm" disabled={!sheetImportCanRun} onClick={handleImport}>
            {sheetImport.importing
              ? t("body.cities.sheet.importing")
              : sheetResult
                ? t("body.cities.sheet.importAgain")
                : t("body.cities.sheet.importButton")}
          </Button>

          {loadError && <p className="text-xs text-destructive">{t("body.connect.sheet.loadError")}</p>}
          {mutationFailed && <p className="text-xs text-destructive">{t("body.cities.sheet.importError")}</p>}

          {sheetResult ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiTile label={t("body.cities.sheet.resultProcessed")} value={String(sheetResult.processed)} />
              <KpiTile label={t("body.cities.sheet.resultNew")} value={String(sheetResult.new_dates)} tone="confirmed" />
              <KpiTile label={t("body.cities.sheet.resultUpdated")} value={String(sheetResult.updated)} />
              <KpiTile
                label={t("body.cities.sheet.resultHeld")}
                value={String(sheetResult.held)}
                tone={sheetResult.held > 0 ? "waiting" : "neutral"}
              />
            </div>
          ) : !mutationFailed ? (
            <p className="text-sm text-muted-foreground">{t("body.cities.sheet.notYet")}</p>
          ) : null}

          {sheetResult && sheetResult.held > 0 && (
            <div className="space-y-1 rounded-l border border-border bg-well-tint px-3.5 py-3">
              <p className="text-xs text-muted-foreground">{t("body.cities.sheet.heldNote")}</p>
              <Link
                to={`${ROUTES.SETTINGS}?tab=casts-coverage`}
                className="inline-block text-control font-medium text-accent-600 underline-offset-2 hover:underline"
              >
                {t("body.cities.sheet.manageLink")}
              </Link>
            </div>
          )}
        </div>
      ) : !settled ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !hasAnyDates ? (
        <div className="space-y-2 rounded-l border border-border bg-well-tint px-3.5 py-6 text-center">
          <p className="text-sm text-muted-foreground">{t("body.cities.noDates")}</p>
          <Link
            to={`${ROUTES.GET_RUNNING}?step=productions`}
            className="inline-block text-control font-medium text-accent-600 underline-offset-2 hover:underline"
          >
            {t("body.cities.noDatesLink")}
          </Link>
        </div>
      ) : missingCount > 0 ? (
        <DatesMissingCityList orgId={orgId} canEdit={canEdit} />
      ) : isEmpty ? (
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

      {/* Scoped to the imported-rows branch: the no-dates and missing-city bodies carry their
          own explanation, and "Link or create every city" would misdescribe both. */}
      {!isSheet && settled && hasAnyDates === true && missingCount === 0 && !canContinue && (
        <p className="text-xs text-muted-foreground">{t("body.cities.incomplete")}</p>
      )}

      {footerSlot ? createPortal(continueButton, footerSlot) : continueButton}
    </div>
  );
}
