import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import { AirtableConnectRail, type AirtableConnectStep } from "./AirtableConnectRail";
import { AirtableConnectionSummary } from "./AirtableConnectionSummary";

interface AirtableConnectProps {
  orgId: string | null;
  readOnly: boolean;
  canTriggerSync: boolean;
  /** Forwarded to the rail's footer "Later" button — optional so existing callers keep
   *  compiling; typically closes whatever overlay hosts `AirtableConnect`. */
  onLater?: () => void;
}

/**
 * State owner for the Get-running Airtable connect experience (screen 11): the four-step
 * rail (11b) while the connection is incomplete, collapsing to the four-group summary
 * (11a) once the console is already connected. The summary's "Replace"/"Change"/"Map
 * sessions"/"Review" affordances force the rail back open on the chosen step; the rail's
 * `onConnected` (its last step's primary) releases that override, so a fully-connected
 * org lands back on the summary.
 *
 * `mode` is a LATCH, not a re-derivation: it is set once, the moment `useAirtableConsole`
 * has settled (`c.ready`), from `keyPresent && hasBaseTable` at that instant — and from
 * then on only flips on the rail's own `onConnected` event. Re-deriving it from
 * `connected` on every render would collapse a first-time connector straight back to the
 * summary the instant `BaseTableStep` autosaves a base/table pick (step 2 of 4),
 * defeating the whole point of walking the rail linearly through steps 3 (Map fields)
 * and 4 (Link catalog). An already-connected org still opens directly on the summary,
 * since `connected` is already true the moment the latch initializes.
 *
 * Calls `useAirtableConsole` itself only to decide which mode to render — `AirtableConnectRail`
 * and `AirtableConnectionSummary` each call it again for their own data. React Query
 * dedupes the identical query keys across all three mounts, so this costs no extra
 * network round-trips (see task-C0-spike.md §8).
 */
export function AirtableConnect({ orgId, readOnly, canTriggerSync, onLater }: AirtableConnectProps) {
  const c = useAirtableConsole(orgId, { readOnly, canTriggerSync });
  const connected = c.keyPresent && c.hasBaseTable;
  const [mode, setMode] = useState<"rail" | "summary" | null>(null);
  const [forcedStep, setForcedStep] = useState<AirtableConnectStep | null>(null);

  // Initialize the latch once the console has settled, then transition only on the
  // explicit events below (never re-derive from `connected` — see the comment above).
  useEffect(() => {
    if (mode === null && c.ready) setMode(connected ? "summary" : "rail");
  }, [mode, c.ready, connected]);

  if (mode === null) {
    return <Skeleton className="h-64 w-full rounded-[var(--radius-xl)]" />;
  }

  if (mode === "summary") {
    return (
      <AirtableConnectionSummary
        orgId={orgId}
        readOnly={readOnly}
        canTriggerSync={canTriggerSync}
        onEditStep={(step) => { setForcedStep(step); setMode("rail"); }}
      />
    );
  }

  return (
    <AirtableConnectRail
      orgId={orgId}
      readOnly={readOnly}
      canTriggerSync={canTriggerSync}
      initialStep={forcedStep ?? undefined}
      onConnected={() => { setForcedStep(null); setMode("summary"); }}
      onLater={onLater}
    />
  );
}
