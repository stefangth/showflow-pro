import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchLatestSyncLog } from "@/data/airtableSync";
import { useShows } from "@/hooks/useShows";
import { useCan } from "@/hooks/useCapabilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AirtableSyncTab } from "@/components/settings/AirtableSyncTab";
import { ShowFormDialog } from "@/components/catalog/ShowFormDialog";
import { formatTimestampLocal } from "@/lib/dates";
import { UnlocksNote } from "./UnlocksNote";

/**
 * The `dates` task's in-panel body (screen 02 "status" shape): an Airtable sync-status
 * card (or a "not connected yet" line), a held-records affordance, and an "add a show by
 * hand" overlay — all wired straight to EXISTING surfaces rather than a new first-time
 * connect wizard (owner decision #2 in `.superpowers/sdd/2026-08-18-get-running-in-panel-editors`:
 * the overlay to the existing `AirtableSyncTab` console IS the connect/manage path until
 * design screen 11 lands). Replaces `ShowsStep`, which only linked out to Productions and
 * `/settings?tab=airtable`.
 *
 * Reads `fetchLatestSyncLog` under the exact `["airtable","sync-log",orgId]` key
 * `AirtableSyncTab` uses for its own `syncLogQ`, so the overlay's "Sync now" (which
 * invalidates that key) refreshes this card too without any bespoke wiring.
 *
 * `canConfigureAirtable`/`canTriggerSync` are resolved via `useCan` exactly as
 * `SettingsPage.tsx` does at its own `<AirtableSyncTab>` mount, so the overlay behaves
 * identically whether it is opened from Settings or from this board.
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
        <div className="space-y-2 rounded-[var(--radius-l)] bg-muted p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant="confirmed" dot>
                {t("panel.body.dates.connectedBadge")}
              </Badge>
              <span className="truncate text-xs text-muted-foreground">
                {t("panel.body.dates.syncedAt", { time: formatTimestampLocal(latest.synced_at) })}
              </span>
            </div>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {t("panel.body.dates.recordCount", { count: latest.records_processed ?? 0 })}
            </span>
          </div>

          {heldCount > 0 && (
            <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
              <div className="flex items-center gap-2">
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--amber-100)] px-1 text-[11px] font-semibold text-[var(--amber-600)]">
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
      ) : (
        !syncQ.isLoading && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t("panel.body.dates.emptyLine")}</p>
            <Button type="button" size="sm" onClick={() => setAirtableOpen(true)}>
              {t("panel.body.dates.setup")}
            </Button>
          </div>
        )
      )}

      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
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
          <AirtableSyncTab orgId={orgId} readOnly={!canConfigureAirtable} canTriggerSync={canTriggerSync} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
