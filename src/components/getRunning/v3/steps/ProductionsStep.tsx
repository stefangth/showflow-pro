import { useContext, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useCan } from "@/hooks/useCapabilities";
import { useShows, type ShowWithStats } from "@/hooks/useShows";
import { showSlots } from "@/lib/settings";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";
import { PartsEditorSheet } from "@/components/getRunning/v3/steps/PartsEditorSheet";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Metric } from "@/components/ui/metric";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ShowFormDialog } from "@/components/catalog/ShowFormDialog";
import { ShowDateFormDialog } from "@/components/shows/ShowDateFormDialog";
import { showIdentityLabel } from "@/types";

/**
 * The "productions" step's body (Wireflow v3 Phase 2, Task 11): a compact list of the org's
 * productions, each row showing its date count and casting-breakdown state (`showSlots`), a
 * "Set casting breakdown" button opening `PartsEditorSheet` (Task 10) for that row, and two
 * header actions for adding a production or a date by hand (`ShowFormDialog`/
 * `ShowDateFormDialog`, the same dialogs the Productions page and show-date cockpit use).
 *
 * Continue is gated on at least one production having its parts configured (`showSlots(s) !=
 * null`), mirroring the booking-setup rail's `slots` step (`productions.done`): a wizard that
 * let a visitor advance with zero configured productions would reach later steps (skills,
 * cast ranking) with nothing to rank against.
 *
 * `manage_productions` gates "Add a production"; `manage_show_dates` gates "Add a date"
 * (a distinct capability a producer can hold independently of `manage_productions` via
 * per-org overrides, so the two header actions are NOT interchangeable); `edit_scheduling`
 * gates the per-row "Set casting breakdown" button, mirroring `ShowFormDialog`'s own
 * `canEditScheduling` gate on its slot repeater. A viewer with none of these capabilities
 * sees the list read only, with no add/edit affordances, mirroring `CitiesStep`/`MapStep`'s
 * read-only pattern.
 *
 * Portals its Continue into `WizardFooterContext`'s slot, same pattern as the other v3 step
 * bodies.
 */
export function ProductionsStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const footerSlot = useContext(WizardFooterContext);
  const canManage = useCan("manage_productions");
  const canManageDates = useCan("manage_show_dates");
  const canSchedule = useCan("edit_scheduling");

  const shows = useShows();
  const list = shows.data ?? [];

  const [formOpen, setFormOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [partsShow, setPartsShow] = useState<ShowWithStats | null>(null);

  // The step's own `done` is `hasAnyDates && slotsDone` (src/lib/getRunning/steps.ts), so
  // the gate must ask both. With productions configured and zero dates, a slots-only gate
  // enabled Continue, completed nothing, and the wizard's advance wrapped BACKWARDS to
  // `cities`, whose body says "Go to productions": a loop with no way out.
  const hasAnyDates = list.some((s) => s.dateCount > 0);
  const slotsReady = list.some((s) => showSlots(s) != null);
  const canContinue = slotsReady && hasAnyDates;

  const continueButton = (
    <Button type="button" size="sm" disabled={!canContinue} onClick={onDone}>
      {t("body.productions.continue")}
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
            {t("body.productions.heading")}
          </div>
          <p className="text-xs text-muted-foreground">{t("body.productions.sub")}</p>
        </div>
        {(canManageDates || canManage) && (
          <div className="flex shrink-0 gap-2">
            {canManageDates && (
              <Button type="button" size="sm" variant="outline" onClick={() => setDateOpen(true)}>
                {t("body.productions.addDate")}
              </Button>
            )}
            {canManage && (
              <Button type="button" size="sm" variant="outline" onClick={() => setFormOpen(true)}>
                {t("body.productions.addProduction")}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* The list read fails CLOSED, ahead of the empty branch. `shows.data ?? []` is also
          what an ERRORED or still-loading read looks like, and the empty state below tells an
          org with productions that it has none and invites it to create another one. Continue
          is already disabled in both states; only the body was lying. */}
      {shows.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t("body.productions.readError")}</AlertDescription>
        </Alert>
      ) : shows.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : list.length === 0 ? (
        canManage ? (
          <EmptyState
            title={t("body.productions.empty")}
            action={{ label: t("body.productions.addProduction"), onClick: () => setFormOpen(true) }}
          />
        ) : (
          <EmptyState title={t("body.productions.readOnlyEmpty")} reason={t("body.productions.readOnlyReason")} />
        )
      ) : (
        <div className="overflow-hidden rounded-m border border-border">
          {list.map((s) => {
            const slots = showSlots(s);
            return (
              <div key={s.id} className="flex items-center gap-3 border-b border-border p-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-control font-medium text-foreground">
                    {s.program}
                    {s.sub_program ? <span className="text-muted-foreground"> · {s.sub_program}</span> : null}
                  </div>
                  <Metric size="inline" className="text-muted-foreground">
                    {t("body.productions.dateCount", { count: s.dateCount })}
                  </Metric>
                </div>
                {slots ? (
                  <Metric size="body">
                    {t("body.productions.parts", { main: slots.main_cast, understudies: slots.understudies })}
                  </Metric>
                ) : (
                  <StatusPill tone="waiting">{t("body.productions.unconfigured")}</StatusPill>
                )}
                {canSchedule && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setPartsShow(s)}>
                    {t("body.productions.setParts")}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Name the reason that actually applies. Nothing in this step's copy mentioned dates
          before, so an org with configured breakdowns and no dates had no way to tell why
          Continue was off. */}
      {list.length > 0 && !slotsReady && (
        <p className="text-xs text-muted-foreground">{t("body.productions.incomplete")}</p>
      )}
      {list.length > 0 && slotsReady && !hasAnyDates && (
        <p className="text-xs text-muted-foreground">{t("body.productions.noDates")}</p>
      )}

      {footerSlot ? createPortal(continueButton, footerSlot) : continueButton}

      {canManage && <ShowFormDialog open={formOpen} onOpenChange={setFormOpen} allShows={list} />}
      {canManageDates && (
        <ShowDateFormDialog
          open={dateOpen}
          onOpenChange={setDateOpen}
          mode="create"
          defaultShowId={list[0]?.id ?? null}
        />
      )}
      {partsShow && orgId && (
        <PartsEditorSheet
          open
          onOpenChange={(o) => {
            if (!o) setPartsShow(null);
          }}
          orgId={orgId}
          showId={partsShow.id}
          showLabel={showIdentityLabel(partsShow)}
          onSaved={() => setPartsShow(null)}
        />
      )}
    </div>
  );
}
