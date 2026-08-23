import { useContext } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useCan } from "@/hooks/useCapabilities";
import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import { isDatesMapComplete } from "@/data/airtableMapping";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";
import { Button } from "@/components/ui/button";
import { MappingTab } from "@/components/settings/airtable/MappingTab";
import { stepFeatureLink } from "@/lib/getRunning/stepFeature";

/**
 * The "map" step's body (Wireflow v3 Phase 2, Task 8): the Airtable field-mapping table,
 * fed straight from `useAirtableConsole` (the same data-wiring the Settings Airtable
 * console and `AirtableConnectRail` use), plus a short "slots fold" callout reminding the
 * visitor that each imported production still needs its own casting breakdown, set on the
 * `productions` step (`stepFeatureLink("productions")`).
 *
 * Continue is gated on the shared `isDatesMapComplete` predicate (Controller Ruling C), not
 * on `MappingTab`'s own `mapped`/`total` header counter: that counter spans all nine mapping
 * slots (city, venue, three sessions, the cancellation status field), most of which are
 * genuinely optional for a first sync, so gating Continue on it would make this step
 * unreachable for an org that legitimately never maps every optional field.
 * `useGetRunningV3`'s `datesMapDone` reads the exact same predicate, so the board and this
 * wizard step never disagree about whether "map" is done.
 *
 * Portals its Continue into `WizardFooterContext`'s slot, same pattern as `SourceStep`/
 * `ConnectStep`. Read-only viewers (no `configure_airtable` capability) see the mapping but
 * `MappingTab`'s own `canWrite` gate disables every select; Continue itself stays keyed only
 * to `isDatesMapComplete`, mirroring `ConnectStep` (a viewer who arrives at an already-mapped
 * step can still advance, only editing is capability-gated).
 */
export function MapStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const footerSlot = useContext(WizardFooterContext);
  const canEdit = useCan("configure_airtable");
  const airtable = useAirtableConsole(orgId, { readOnly: !canEdit, canTriggerSync: false });

  const canContinue = isDatesMapComplete(airtable.fieldMap);
  const tableName = airtable.selectedTable?.name ?? airtable.settings.airtable_table_name;
  const fields = airtable.selectedTable?.fields.map((f) => ({ id: f.id, name: f.name })) ?? [];

  const continueButton = (
    <Button type="button" size="sm" disabled={!canContinue} onClick={onDone}>
      {t("body.map.continue")}
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
          {t("body.map.heading")}
        </div>
        <p className="text-xs text-muted-foreground">{t("body.map.sub")}</p>
      </div>

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
      />

      <div className="space-y-1 rounded-l border border-border bg-well-tint px-3.5 py-3">
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

      {!canContinue && <p className="text-xs text-muted-foreground">{t("body.map.mapIncomplete")}</p>}

      {footerSlot ? createPortal(continueButton, footerSlot) : continueButton}
    </div>
  );
}
