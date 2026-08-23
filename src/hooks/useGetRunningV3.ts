import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useBookingSetupStatus, useProducerCount } from "@/hooks/useBookingSetup";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useSkills } from "@/hooks/useSkills";
import { useDatesSource } from "@/hooks/useDatesSource";
import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import { composeGetRunningV3, type GetRunningInputV3, type GetRunningModelV3 } from "@/lib/getRunning/steps";

/**
 * Live-data integration hook for the Wireflow v3 `/get-running` board: gathers every read
 * the pure `composeGetRunningV3` composer (`@/lib/getRunning/steps`) needs, maps them to a
 * `GetRunningInputV3`, and returns the resulting `GetRunningModelV3`.
 *
 * Mirrors `useGetRunning` (`src/hooks/useGetRunning.ts`, the v1 board's integration hook)
 * hook-for-hook and gate-for-gate — see that file's header comment for the rationale behind
 * the role/entitlement gating. This hook is intentionally independent of v1: it does not
 * import from `@/lib/getRunning/tasks`, so v1 stays byte-stable while this board evolves.
 *
 * Phase 2 wires the get_dates split to real signals: `datesSource` reads the org's chosen
 * wizard source (useDatesSource); `datesConnectDone`/`datesMapDone` read the Airtable
 * console's connection + required-field-mapping state (useAirtableConsole) when that source
 * is Airtable, and are trivially done for a manual source (composeGetRunningV3 hides those
 * steps for a manual source instead); `datesCitiesDone` reuses the booking module's
 * `datesWithoutCity` advisory. Two inputs still have no real signal: `feeDone` and
 * `documentDone` are hardcoded false until later phases wire their real signals; `skillsDone`
 * uses a cheap best-effort read (the org's skill catalog is non-empty) rather than a new query.
 */
export function useGetRunningV3(): { model: GetRunningModelV3 | null; isLoading: boolean } {
  const { currentOrg, hasRole } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const isNonArtist = hasRole("admin") || hasRole("producer");
  const role: GetRunningInputV3["role"] = hasRole("admin") ? "admin" : "producer";

  const { features, isLoading: entitlementsLoading } = useEntitlements();
  const bookingOn = features.has("booking_flow");
  const hireOrdersOn = features.has("hire_orders");

  // Gate each module's readiness reads on BOTH role and the module's entitlement, same
  // plumbing as v1's useGetRunning / useDashboardFirstRun.
  const bookingOrgId = isNonArtist && bookingOn ? orgId : null;
  const hireOrgId = isNonArtist && hireOrdersOn ? orgId : null;
  const booking = useBookingSetupStatus(bookingOrgId);
  const hire = useHireOrderSetupStatus(hireOrgId);
  const producerCount = useProducerCount(orgId, isNonArtist && bookingOn);

  // The get_dates wizard's chosen source, and (only for an Airtable source) its console
  // connection/mapping state. Gated on the same bookingOrgId as the booking module's own
  // reads above, so an artist or a booking-off org never pays for either read.
  const { source: datesSource, isLoading: datesSourceLoading } = useDatesSource(bookingOrgId);
  const airtable = useAirtableConsole(bookingOrgId, { readOnly: true, canTriggerSync: false });

  // Cheap best-effort signal for the `skills` step: the org's skill catalog is non-empty.
  // Only fired for a non-artist viewer in a booking-entitled org, same gating shape as the
  // other booking-module reads above.
  const skills = useSkills({ enabled: isNonArtist && bookingOn });

  // Called unconditionally (rules of hooks), same as v1.
  const canManageShows = useCan("manage_productions");
  const canEditScheduling = useCan("edit_scheduling");
  const canEditBooking = useCan("edit_booking_settings");
  const canEditHire = useCan("edit_hire_order_settings");
  const canAddArtists = useCan("add_artists");

  // `airtable.ready` requires a non-null orgId by construction (see its doc comment), so it
  // is never true when bookingOrgId is null (booking off, or an artist viewer) — gate on
  // bookingOrgId directly rather than bookingOn alone, or a disabled console would hold
  // isLoading true forever.
  const isLoading = entitlementsLoading
    || (bookingOn && (booking.isLoading || datesSourceLoading))
    || (!!bookingOrgId && !airtable.ready)
    || (hireOrdersOn && hire.isLoading);

  if (isLoading) return { model: null, isLoading: true };

  // Real Phase 2 signals: a manual source needs neither a connection nor a mapping (both
  // trivially true; composeGetRunningV3 hides those two steps for a manual source instead of
  // reading their `done`), an Airtable source reads the console's connection + mapping
  // state, and any other source (including none chosen yet) reports both outstanding.
  const isAirtableConnected = airtable.keyPresent && airtable.hasBaseTable;
  const isAirtableMapped = airtable.mapped >= airtable.mappedTotal;
  const datesConnectDone = datesSource === "manual" ? true : datesSource === "airtable" ? isAirtableConnected : false;
  const datesMapDone = datesSource === "manual" ? true : datesSource === "airtable" ? isAirtableMapped : false;
  // Advisory-only: 0 while coverage is unread or the org has no upcoming dates, same as the
  // booking module's own field (see setupStatus.ts's doc comment on `datesWithoutCity`).
  const datesCitiesDone = bookingOn ? booking.status.datesWithoutCity === 0 : false;

  const input: GetRunningInputV3 = {
    role,
    bookingOn,
    hireOrdersOn,
    booking: bookingOn ? booking.status : null,
    hire: hireOrdersOn ? hire.status : null,
    datesSource,
    datesConnectDone,
    datesMapDone,
    datesCitiesDone,
    producerCount,
    // Phase 1 placeholder: non-empty skill catalog. Defaults to false while the read is
    // outstanding or the module is off, rather than blocking the whole board on it.
    skillsDone: bookingOn ? (skills.data?.length ?? 0) > 0 : false,
    feeDone: false,
    documentDone: false,
    canManageShows,
    canEditScheduling,
    canEditBooking,
    canEditHire,
    canAddArtists,
    canInvite: role === "admin",
  };

  return { model: composeGetRunningV3(input), isLoading: false };
}
