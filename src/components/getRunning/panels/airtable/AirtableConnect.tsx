import { useState } from "react";
import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import { AirtableConnectRail, type AirtableConnectStep } from "./AirtableConnectRail";
import { AirtableConnectionSummary } from "./AirtableConnectionSummary";

interface AirtableConnectProps {
  orgId: string | null;
  readOnly: boolean;
  canTriggerSync: boolean;
}

/**
 * State owner for the Get-running Airtable connect experience (screen 11): the four-step
 * rail (11b) while the connection is incomplete, collapsing to the four-group summary
 * (11a) once `keyPresent && hasBaseTable`. The summary's "Replace"/"Change"/"Map
 * sessions"/"Review" affordances force the rail back open on the chosen step; the rail's
 * `onConnected` (its last step's primary) releases that override, so a fully-connected
 * org lands back on the summary.
 *
 * Calls `useAirtableConsole` itself only to decide which mode to render — `AirtableConnectRail`
 * and `AirtableConnectionSummary` each call it again for their own data. React Query
 * dedupes the identical query keys across all three mounts, so this costs no extra
 * network round-trips (see task-C0-spike.md §8).
 */
export function AirtableConnect({ orgId, readOnly, canTriggerSync }: AirtableConnectProps) {
  const c = useAirtableConsole(orgId, { readOnly, canTriggerSync });
  const [forcedStep, setForcedStep] = useState<AirtableConnectStep | null>(null);
  const connected = c.keyPresent && c.hasBaseTable;

  if (connected && forcedStep === null) {
    return (
      <AirtableConnectionSummary
        orgId={orgId}
        readOnly={readOnly}
        canTriggerSync={canTriggerSync}
        onEditStep={(step) => setForcedStep(step)}
      />
    );
  }

  return (
    <AirtableConnectRail
      orgId={orgId}
      readOnly={readOnly}
      canTriggerSync={canTriggerSync}
      initialStep={forcedStep ?? undefined}
      onConnected={() => setForcedStep(null)}
    />
  );
}
