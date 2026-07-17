import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  describeAuditEntry,
  flowPreviewRows,
  inPracticeRows,
  lifecycleChips,
  type BookingFlow,
  type FlowTimes,
} from "@/lib/bookingFlow";
import type { SettingsAuditEntry } from "@/data/settingsAudit";
import { formatDateDMY } from "@/lib/dates";

const TONE_CLASS: Record<string, string> = {
  violet: "bg-accent text-accent-foreground",
  amber: "bg-[var(--amber-100)] text-[var(--amber-600)]",
  green: "bg-[var(--green-100)] text-[var(--green-600)]",
  neutral: "bg-muted text-muted-foreground",
};

function RailCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        {children}
      </CardContent>
    </Card>
  );
}

export function FlowRail(props: {
  flow: BookingFlow;
  times: FlowTimes;
  dirtyCount: number;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  audit: SettingsAuditEntry[];
  isLoading?: boolean;
  isError?: boolean;
  /** When true, hides the Save/Discard actions (the module isn't entitled, so there's
   *  nothing to save) but keeps every other card, including change history, visible. */
  locked?: boolean;
}) {
  const { flow, times, dirtyCount, saving, onSave, onDiscard, audit, isLoading, isError, locked = false } = props;
  return (
    <div className="flex flex-col gap-3 lg:sticky lg:top-4">
      {/* When locked, the rail offers no Save/Discard (see below), so a dirty count here
          would refer to a save control that doesn't exist on this rail. Any dirt while
          locked comes from the from-address input or EmailTemplatesCard (both stay
          editable and write BOOKING_AUDIT_KEYS), which the page-level Save handles
          instead — the page-level banner carries that messaging. */}
      {!locked && dirtyCount > 0 && (
        <div className="rounded-lg bg-[var(--amber-100)] px-3 py-2 text-xs font-medium text-[var(--amber-600)]">
          Previewing unsaved draft · {dirtyCount} {dirtyCount === 1 ? "change" : "changes"}
        </div>
      )}
      <RailCard label="Resulting lifecycle">
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {lifecycleChips(flow).map((c, i) => (
            <span key={c.label} className="inline-flex items-center gap-1.5">
              {i > 0 && <span className="font-mono text-xs text-muted-foreground">→</span>}
              <Badge variant="secondary" className={TONE_CLASS[c.tone]}>
                {c.label}
              </Badge>
            </span>
          ))}
        </div>
      </RailCard>
      <RailCard label="In practice">
        <div className="mt-2.5 space-y-2">
          {inPracticeRows(flow, times).map((r) => (
            <div key={r.who} className="flex gap-2.5 text-xs">
              <span className="w-20 flex-none rounded bg-muted px-1 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {r.who}
              </span>
              <span>{r.text}</span>
            </div>
          ))}
        </div>
      </RailCard>
      <RailCard label="Flow preview">
        <div className="mt-2.5 space-y-1.5">
          {flowPreviewRows(flow, times).map((r, i) => (
            <div key={i} className="flex gap-2.5 text-xs">
              <span className="w-14 flex-none text-right font-mono text-[10px] text-muted-foreground">{r.at}</span>
              <span>{r.text}</span>
            </div>
          ))}
        </div>
      </RailCard>
      {!locked && (
        <div className="flex gap-2">
          <Button className="flex-1" disabled={dirtyCount === 0 || saving} onClick={onSave}>
            {dirtyCount > 0 ? `Save (${dirtyCount})` : "Saved"}
          </Button>
          {dirtyCount > 0 && (
            <Button variant="ghost" onClick={onDiscard}>
              Discard
            </Button>
          )}
        </div>
      )}
      <RailCard label="Change history">
        <div className="mt-1">
          {isLoading ? (
            <div className="mt-1.5 space-y-1.5">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ) : isError ? (
            <Alert variant="destructive" className="mt-1.5 p-2.5">
              <AlertDescription className="text-xs">Could not load change history.</AlertDescription>
            </Alert>
          ) : (
            <>
              {audit.length === 0 && <p className="mt-1.5 text-xs text-muted-foreground">No changes recorded yet.</p>}
              {audit.map((e) => (
                <div key={e.id} className="border-t border-border pt-2 mt-2 first:border-t-0 first:mt-1.5">
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {formatDateDMY(e.created_at.slice(0, 10))} · {e.actorName ?? "System"}
                  </p>
                  <p className="mt-0.5 text-xs">{describeAuditEntry(e)}</p>
                </div>
              ))}
            </>
          )}
        </div>
      </RailCard>
    </div>
  );
}
