import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useCan } from "@/hooks/useCapabilities";
import { useDatesSource } from "@/hooks/useDatesSource";
import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import { useSheetImport } from "@/hooks/useSheetImport";
import { isDatesMapComplete } from "@/data/airtableMapping";
import { isSheetMapComplete, type SheetColumnMap } from "@/lib/sheetImport/mapRows";
import { WizardFooterAction } from "@/components/getRunning/v3/WizardFooterAction";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MappingTab } from "@/components/settings/airtable/MappingTab";
import { stepFeatureLink } from "@/lib/getRunning/stepFeature";
import type { GetRunningStepKey } from "@/lib/getRunning/steps";
import { cn } from "@/lib/utils";

/** shadcn Select cannot use "" as an item value, so "not mapped" needs a sentinel,
 *  same convention as `MappingTab`. */
const NONE = "__none__";

/** The sheet column-map fields, in display order. `program`/`date` are required
 *  (mirrors `isSheetMapComplete`); the rest are optional. */
const SHEET_FIELDS: { key: keyof SheetColumnMap; required?: boolean }[] = [
  { key: "program", required: true },
  { key: "subProgram" },
  { key: "date", required: true },
  { key: "city" },
  { key: "session1" },
  { key: "session2" },
  { key: "session3" },
  { key: "venue" },
];

/**
 * The "map" step's body (Wireflow v3 Phase 2, Task 8; Sheet branch added Phase 4, Task
 * A5): the Airtable field-mapping table, fed straight from `useAirtableConsole` (the same
 * data-wiring the Settings Airtable console and `AirtableConnectRail` use), plus a short
 * "slots fold" callout reminding the visitor that each imported production still needs
 * its own casting breakdown, set on the `productions` step (`stepFeatureLink("productions")`).
 *
 * Continue is gated on the shared `isDatesMapComplete` predicate (Controller Ruling C), not
 * on `MappingTab`'s own `mapped`/`total` header counter: that counter spans all nine mapping
 * slots (city, venue, three sessions, the cancellation status field), most of which are
 * genuinely optional for a first sync, so gating Continue on it would make this step
 * unreachable for an org that legitimately never maps every optional field.
 * `useGetRunningV3`'s `datesMapDone` reads the exact same predicate, so the board and this
 * wizard step never disagree about whether "map" is done.
 *
 * `source === "sheet"` renders a lean column-mapping form instead: one select per
 * `SheetColumnMap` field, options being the sheet's header row. Headers come from
 * `useSheetImport`'s `parsed` cache, which resets on remount (each wizard step mounts
 * fresh), so this step re-loads them via `loadSheet(settings.url)` whenever they are
 * missing and a URL is saved — the same "reload if not cached" fallback the Cities step
 * uses for the parsed rows. Continue is gated on `isSheetMapComplete`, this branch's
 * counterpart to `isDatesMapComplete`.
 *
 * Portals its Continue into `WizardFooterContext`'s slot, same pattern as `SourceStep`/
 * `ConnectStep`. Read-only viewers (no `configure_airtable` capability) see the mapping but
 * every select is disabled (`MappingTab`'s own `canWrite` gate for Airtable, a local
 * `disabled` prop for the sheet form); Continue itself stays keyed only to the mapping
 * predicate, mirroring `ConnectStep` (a viewer who arrives at an already-mapped step can
 * still advance, only editing is capability-gated).
 */
export function MapStep({
  orgId,
  onDone,
  onGoToStep,
}: {
  orgId: string | null;
  onDone: () => void;
  /** Jump the wizard to another step. Used by the not-yet-connected state, which has
   *  nothing to map until the Connect step has run. */
  onGoToStep?: (key: GetRunningStepKey) => void;
}): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const canEdit = useCan("configure_airtable");
  const { source } = useDatesSource(orgId);
  const airtable = useAirtableConsole(orgId, { readOnly: !canEdit, canTriggerSync: false });
  const sheetImport = useSheetImport(orgId);
  const [loadingHeaders, setLoadingHeaders] = useState(false);

  const isSheet = source === "sheet";
  // An Airtable org that has not finished connecting has no columns to choose from, so the
  // mapping table would render nine required rows over an empty dropdown and no way to
  // fill any of them. Send them to the step that can actually unblock this instead.
  //
  // Gated on `airtable.ready` (the console's own key-status + settings queries having
  // settled, same flag `CitiesStep` reads) because `keyPresent`/`hasBaseTable` are BOTH
  // false while those queries are in flight. Without it a fully connected org is told its
  // base is not connected for as long as the read takes, and offered a button back to a
  // step it already finished.
  const airtableResolved = source !== "airtable" || airtable.ready;
  const awaitingAirtableConnection =
    source === "airtable" && airtable.ready && !(airtable.keyPresent && airtable.hasBaseTable);
  const sheetUrl = sheetImport.settings.url;
  const headers = sheetImport.parsed?.headers ?? null;

  // Headers loaded on the Connect step live in that mount's `useSheetImport` instance and
  // do not survive navigating here (each step remounts fresh) — reload them once if a URL
  // is saved and nothing is cached yet, so the mapping selects have options without the
  // visitor having to step back.
  useEffect(() => {
    if (!isSheet || !sheetUrl || headers !== null || loadingHeaders) return;
    // This is a genuine fetch-on-mount effect (synchronizing with an external
    // system), not derived state: the loading flag must flip the instant the
    // request starts, so a synchronous setState here is correct.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingHeaders(true);
    sheetImport
      .loadSheet(sheetUrl)
      .catch(() => {})
      .finally(() => setLoadingHeaders(false));
    // loadSheet/sheetImport are a fresh closure every render (useSheetImport returns a new
    // object each call); re-running is gated on isSheet/sheetUrl/headers/loadingHeaders
    // above, so omitting them from the deps array is intentional, not a staleness bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSheet, sheetUrl, headers, loadingHeaders]);

  const handleSetSheetField = (key: keyof SheetColumnMap, value: string) => {
    const map = { ...sheetImport.settings.map };
    if (value === NONE) delete map[key];
    else map[key] = value;
    sheetImport.saveSettings({ ...sheetImport.settings, map });
  };

  const canContinue = !airtableResolved || awaitingAirtableConnection
    ? false
    : isSheet
      ? isSheetMapComplete(sheetImport.settings.map)
      : isDatesMapComplete(airtable.fieldMap);
  const tableName = airtable.selectedTable?.name ?? airtable.settings.airtable_table_name;
  const fields = airtable.selectedTable?.fields.map((f) => ({ id: f.id, name: f.name })) ?? [];

  const continueButton = (
    <Button type="button" size="sm" disabled={!canContinue} onClick={onDone}>
      {t("body.map.continue")}
    </Button>
  );

  return (
    <div data-testid="step-body-map" className="space-y-4">
      {!airtableResolved ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : awaitingAirtableConnection ? (
        <div className="space-y-2 rounded-card border border-border bg-well-tint px-3.5 py-3">
          <p className="text-control text-foreground">{t("body.map.notConnected")}</p>
          {onGoToStep && (
            <Button type="button" variant="outline" size="sm" onClick={() => onGoToStep("connect")}>
              {t("body.map.goToConnect")}
            </Button>
          )}
        </div>
      ) : isSheet ? (
        !sheetUrl ? (
          <p className="text-sm text-muted-foreground">{t("body.map.sheet.noHeaders")}</p>
        ) : loadingHeaders || headers === null ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {SHEET_FIELDS.map(({ key, required }) => {
              const label = t(`body.map.sheet.fields.${key}`);
              const value = sheetImport.settings.map[key] ?? NONE;
              const unmappedRequired = required && value === NONE;
              return (
                <div key={key} className="space-y-1">
                  <Label className={cn("text-sm font-medium", unmappedRequired && "text-[color:var(--amber-600)]")}>
                    {label}
                  </Label>
                  <Select value={value} onValueChange={(v) => handleSetSheetField(key, v)} disabled={!canEdit}>
                    <SelectTrigger aria-label={label} className="h-[30px]">
                      <SelectValue placeholder={t("body.map.sheet.selectPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("body.map.sheet.notMapped")}</SelectItem>
                      {headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <MappingTab
          tableName={tableName}
          fields={fields}
          fieldMap={airtable.fieldMap}
          onSetField={airtable.setField}
          mapped={airtable.mapped}
          total={airtable.mappedTotal}
          optionNames={airtable.optionNames}
          unboundFields={airtable.unboundFields}
          onAddAllCustom={airtable.addAllCustom}
          canWrite={airtable.canWrite}
          // The wizard shell already titles this step above the card, so the card header
          // steps down rather than competing with it. In Settings this card is the
          // section and keeps the full card-title size.
          dense
        />
      )}

      <div className="space-y-1 rounded-card border border-border bg-well-tint px-3.5 py-3">
        <p className="text-control font-medium text-foreground">{t("body.map.slotsFold.title")}</p>
        <p className="text-xs text-muted-foreground">
          {t("body.map.slotsFold.body")}{" "}
          <Link
            to={stepFeatureLink("productions")}
            className="font-medium text-accent-600 underline-offset-2 hover:underline"
          >
            {t("body.map.slotsFold.link")}
          </Link>
        </p>
      </div>

      {!canContinue && !awaitingAirtableConnection && airtableResolved && (
        <p className="text-xs text-muted-foreground">
          {isSheet ? t("body.map.sheet.mapIncomplete") : t("body.map.mapIncomplete")}
        </p>
      )}

      <WizardFooterAction>{continueButton}</WizardFooterAction>
    </div>
  );
}
