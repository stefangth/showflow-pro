import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchLatestSyncLog } from "@/data/airtableSync";
import { useShows } from "@/hooks/useShows";
import { useCan } from "@/hooks/useCapabilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AirtableConnect } from "@/components/getRunning/panels/airtable/AirtableConnect";
import { ShowFormDialog } from "@/components/catalog/ShowFormDialog";
import { formatTimestampLocal } from "@/lib/dates";
import { UnlocksNote } from "./UnlocksNote";

/**
 * The `dates` task's in-panel body (screen 02 "status" shape): an Airtable sync-status
 * card (or a "not connected yet" line), a held-records affordance, and an "add a show by
 * hand" overlay — wired straight to EXISTING surfaces rather than a bespoke card. The
 * overlay itself is `AirtableConnect` (screen 11): the four-step connect rail (11b) while
 * the connection is incomplete, collapsing to the four-group summary (11a) once
 * connected — both fed by the same `useAirtableConsole` data-wiring the Settings
 * `AirtableSyncTab` console uses, so nothing here re-implements mapping/catalog logic.
 * Replaces `ShowsStep`, which only linked out to Productions and `/settings?tab=airtable`.
 *
 * Reads `fetchLatestSyncLog` under the exact `["airtable","sync-log",orgId]` key
 * `useAirtableConsole` uses for its own `syncLogQ`, so the overlay's "Sync now" (which
 * invalidates that key) refreshes this card too without any bespoke wiring.
 *
 * `canConfigureAirtable`/`canTriggerSync` are resolved via `useCan` exactly as
 * `SettingsPage.tsx` does at its own `<AirtableSyncTab>` mount, so `AirtableConnect`
 * behaves with the same read-only/sync-trigger floor whether reached from Settings or
 * from this board.
 */
export function DatesPanelBody({
  orgId,
  onDone,
}: {
  orgId: string | null;
  onDone: () => void;
}) {
  const { t } = useTranslation("getRunning");
  const canConfigureAirtable = useCan("configure_airtable");
  const canTriggerSync = useCan("trigger_sync");
  const { data: shows } = useShows();
  const [airtableOpen, setAirtableOpen] = useState(false);
  const [showOpen, setShowOpen] = useState(false);

  const syncQ = useQuery({
    queryKey: ["airtable", "sync-log", orgId],
    enabled: !!orgId,
    queryFn: () => fetchLatestSyncLog(supabase, orgId),
  });
  const latest = syncQ.data ?? null;
  const heldCount = latest?.held_count ?? 0;

  return (
    <div className="space-y-3">
      {latest ? (
        <div className="space-y-2 rounded-control bg-well-tint p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant="confirmed" dot>
                {t("panel.body.dates.connectedBadge")}
              </Badge>
              <span className="truncate text-xs text-muted-foreground">
                {t("panel.body.dates.syncedAt", { time: formatTimestampLocal(latest.synced_at) })}
              </span>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {t("panel.body.dates.recordCount", { count: latest.records_processed ?? 0 })}
            </span>
          </div>

          {heldCount > 0 && (
            <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
              <div className="flex items-center gap-2">
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--amber-100)] px-1 text-eyebrow font-semibold text-[var(--amber-600)]">
                  {heldCount}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("panel.body.dates.heldLine", { count: heldCount })}
                </span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setAirtableOpen(true)}>
                {t("panel.body.dates.resolve")}
              </Button>
            </div>
          )}
        </div>
      ) : syncQ.isLoading ? (
        <Skeleton className="h-12 w-full rounded-control" />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("panel.body.dates.emptyLine")}</p>
          <Button type="button" size="sm" onClick={() => setAirtableOpen(true)}>
            {t("panel.body.dates.setup")}
          </Button>
        </div>
      )}

      {/* eslint-disable-next-line no-restricted-syntax -- "or" divider row (two rule spans + label), not a block eyebrow */}
      <div className="flex items-center gap-2 text-eyebrow uppercase tracking-wider text-muted-foreground">
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        {t("panel.body.dates.dividerOr")}
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setShowOpen(true)}>
        {t("panel.body.dates.newShow")}
      </Button>

      <UnlocksNote>{t("panel.body.dates.unlocks")}</UnlocksNote>

      <ShowFormDialog
        open={showOpen}
        onOpenChange={setShowOpen}
        allShows={shows ?? []}
        onSaved={() => {
          setShowOpen(false);
          onDone();
        }}
      />

      <Dialog open={airtableOpen} onOpenChange={setAirtableOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>{t("panel.body.dates.airtableDialogTitle")}</DialogTitle>
          </DialogHeader>
          <AirtableConnect
            orgId={orgId}
            readOnly={!canConfigureAirtable}
            canTriggerSync={canTriggerSync}
            onLater={() => setAirtableOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
