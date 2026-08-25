import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useBookingSetupStatus, useProducerCount } from "@/hooks/useBookingSetup";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useHireOrderExtraSetup } from "@/hooks/useHireOrderExtraSetup";
import { useSkillGaps } from "@/hooks/useSkills";
import { useDatesSource } from "@/hooks/useDatesSource";
import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import { isDatesMapComplete } from "@/data/airtableMapping";
import { useSheetImport } from "@/hooks/useSheetImport";
import { isSheetMapComplete } from "@/lib/sheetImport/mapRows";
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
 * `datesWithoutCity` advisory. Task A6 wires the same two signals for a `sheet` source via
 * `useSheetImport`: `datesConnectDone` is a non-empty saved sheet URL, `datesMapDone` is
 * `isSheetMapComplete` on the saved column map (program + date both set).
 *
 * Phase 3 wires `feeDone`/`documentDone` to whether the org owns
 * its own `hire_order_defaults`/`hire_order_numbering` app_settings row (useHireOrderExtraSetup),
 * since an inherited platform default is not a decision. `skillGaps` counts skills required
 * by some part but held by no active artist (fetchSkillEligibilityGaps), replacing the
 * earlier best-effort "the catalog is non-empty" read.
 *
 * Runs unconditionally: every caller wants this board's live data, so every sub-hook below
 * fires whenever the viewer's role and the relevant module's entitlement allow it, with no
 * further caller-supplied gate.
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
  const hireExtra = useHireOrderExtraSetup(hireOrgId);
  const producerCount = useProducerCount(orgId, isNonArtist && bookingOn);

  // The get_dates wizard's chosen source, and (only for an Airtable source) its console
  // connection/mapping state. Gated on the same bookingOrgId as the booking module's own
  // reads above, so an artist or a booking-off org never pays for either read.
  const { source: datesSource, isLoading: datesSourceLoading } = useDatesSource(bookingOrgId);
  // The console is only consumed below (datesConnectDone/datesMapDone) when the org's dates
  // source is Airtable, so gate its orgId on that instead of mounting it (and its ~7 queries)
  // unconditionally for every manual/by-hand org too.
  const airtable = useAirtableConsole(datesSource === "airtable" ? bookingOrgId : null, { readOnly: true, canTriggerSync: false });
  // Same gating shape for the sheet source's Connect/Map done-signals (Task A6): only
  // mounted (and only fetched) when the org's dates source is actually "sheet".
  const sheetImport = useSheetImport(datesSource === "sheet" ? bookingOrgId : null);

  // Real signal for the `skills` step: skills required by some part but held by no active
  // artist. Only fired for a non-artist viewer in a booking-entitled org, same gating shape
  // as the other booking-module reads above. Deliberately NOT in the isLoading gate below
  // (see the field's doc comment on GetRunningInputV3): this step does not block the board,
  // so delaying the whole board on it would cost more than the momentary green it can show
  // while loading.
  // Shared with `ArtistSkillAssignList` inside the step body (one hook, one cache entry),
  // so the board's step state and the panel that clears it can never disagree.
  const skillGaps = useSkillGaps(orgId, { enabled: isNonArtist && bookingOn });

  // Called unconditionally (rules of hooks), same as v1.
  const canManageShows = useCan("manage_productions");
  const canEditScheduling = useCan("edit_scheduling");
  const canEditBooking = useCan("edit_booking_settings");
  // The `skills` step edits the skill catalog, which SkillsTab gates on manage_skills
  // (a different capability + producer default than edit_booking_settings).
  const canManageSkills = useCan("manage_skills");
  const canEditHire = useCan("edit_hire_order_settings");
  const canAddArtists = useCan("add_artists");

  // `airtable.ready` requires a non-null orgId by construction (see its doc comment), so it
  // is never true when the console's orgId is null (a non-Airtable source, booking off, or
  // an artist viewer) — gate on `datesSource === "airtable"` directly rather than
  // `bookingOrgId` alone, or a disabled/unmounted console would hold isLoading true forever.
  const isLoading = entitlementsLoading
    || (bookingOn && (booking.isLoading || datesSourceLoading))
    || (datesSource === "airtable" && !airtable.ready)
    || (datesSource === "sheet" && sheetImport.isLoading)
    || (hireOrdersOn && (hire.isLoading || hireExtra.isLoading));

  if (isLoading) return { model: null, isLoading: true };

  // Real Phase 2 signals: a manual source needs neither a connection nor a mapping (both
  // trivially true; composeGetRunningV3 hides those two steps for a manual source instead of
  // reading their `done`), an Airtable source reads the console's connection + mapping
  // state, and any other source (including none chosen yet) reports both outstanding.
  // `datesMapDone` uses the shared `isDatesMapComplete` predicate (Controller Ruling C, Task
  // 8) rather than `airtable.mapped >= airtable.mappedTotal`: that count includes every
  // mapping slot (city, venue, three sessions, the cancellation status field), most of which
  // are genuinely optional for a first sync, so gating on it made "map done" unreachable for
  // a legitimate org that never maps every optional field. `MapStep`'s own Continue gate
  // reads the same predicate, so the board and the wizard never disagree about "map done".
  const isAirtableConnected = airtable.keyPresent && airtable.hasBaseTable;
  const isAirtableMapped = isDatesMapComplete(airtable.fieldMap);
  const isSheetConnected = Boolean(sheetImport.settings.url);
  const isSheetMapped = isSheetMapComplete(sheetImport.settings.map);
  const datesConnectDone =
    datesSource === "manual" ? true
    : datesSource === "airtable" ? isAirtableConnected
    : datesSource === "sheet" ? isSheetConnected
    : false;
  const datesMapDone =
    datesSource === "manual" ? true
    : datesSource === "airtable" ? isAirtableMapped
    : datesSource === "sheet" ? isSheetMapped
    : false;
  // `datesWithoutCity` is `coverage?.futurePairs.filter(...).length ?? 0`, so a FAILED
  // coverage read reports 0 exactly like a clean one. Consulting `booking.isError` is what
  // stops that 0 from turning the `cities` step green (and, through `canFirstOffer`, hiding
  // the "your first ask is shut" card) on a read nobody can vouch for. The loading gate
  // above covers `isLoading` only, so this is the branch that catches a failure. Matches
  // the fail-closed shape its three neighbours (artistCount, dateCount, skillGaps) already
  // use: unread means outstanding.
  const datesCitiesUnknown = bookingOn && booking.isError;
  const datesCitiesDone = bookingOn ? !booking.isError && booking.status.datesWithoutCity === 0 : false;

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
    datesCitiesUnknown,
    hasAnyDates: bookingOn ? booking.status.hasAnyDates : false,
    producerCount,
    // An unreadable gaps query (e.g. an RLS misconfiguration on show_required_skills) must
    // not resolve to 0, which would render the step falsely done. Treat a persistent error
    // as one outstanding gap so the step stays honestly incomplete.
    //
    // `isLoading` counts too, and for the same reason: this query is deliberately OUTSIDE
    // the board's isLoading gate above, so the board renders while it is still in flight.
    // Resolving that window to 0 marked the `skills` step done on every mount, and for an
    // otherwise-finished org flipped `model.complete` true long enough to flash the retired
    // "Everything here is set up" board before the gaps landed. A DISABLED query (booking
    // off) reports `isLoading: false` in React Query v5, so the `bookingOn` branch below is
    // unaffected by this.
    skillGaps: bookingOn ? (skillGaps.isError || skillGaps.isLoading ? 1 : (skillGaps.data?.length ?? 0)) : 0,
    feeDone: hireOrdersOn ? hireExtra.status.feeDone : false,
    documentDone: hireOrdersOn ? hireExtra.status.documentDone : false,
    canManageShows,
    canEditScheduling,
    canEditBooking,
    canManageSkills,
    canEditHire,
    canAddArtists,
    canInvite: role === "admin",
  };

  return { model: composeGetRunningV3(input), isLoading: false };
}
