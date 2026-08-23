import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useBookingSetupStatus, useProducerCount } from "@/hooks/useBookingSetup";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { useHireOrderExtraSetup } from "@/hooks/useHireOrderExtraSetup";
import { useQuery } from "@tanstack/react-query";
import { fetchSkillEligibilityGaps } from "@/data/skills";
import { supabase } from "@/integrations/supabase/client";
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
 * `options.active` (default `true`) is the CI-review-bot-flagged efficiency gate: callers that
 * mount this hook app-wide regardless of whether v3 is actually on for the org (e.g.
 * `useGetRunningNavVisible`, consulted by `AppLayout` on every admin/producer route) pass
 * `active: v3Enabled` so the ~12 fan-out queries below (booking/hire/skills/dates-source plus,
 * for an Airtable org, the whole `useAirtableConsole`) never fire when v3 is off for that org —
 * the prod default. All sub-hooks are still CALLED unconditionally (rules of hooks); only their
 * `orgId`/`enabled` inputs are gated on `active`, so an inactive call fetches nothing.
 */
export function useGetRunningV3(options?: { active?: boolean }): { model: GetRunningModelV3 | null; isLoading: boolean } {
  const active = options?.active ?? true;
  const { currentOrg, hasRole } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const isNonArtist = hasRole("admin") || hasRole("producer");
  const role: GetRunningInputV3["role"] = hasRole("admin") ? "admin" : "producer";

  const { features, isLoading: entitlementsLoading } = useEntitlements();
  const bookingOn = features.has("booking_flow");
  const hireOrdersOn = features.has("hire_orders");

  // While inactive, every gated orgId collapses to null and every gated `enabled` flag is
  // false, so each sub-hook's own `enabled: !!orgId` (or explicit `enabled` param) fetches
  // nothing — see the `options.active` doc note above.
  const gateOrgId = active ? orgId : null;

  // Gate each module's readiness reads on BOTH role and the module's entitlement, same
  // plumbing as v1's useGetRunning / useDashboardFirstRun.
  const bookingOrgId = isNonArtist && bookingOn ? gateOrgId : null;
  const hireOrgId = isNonArtist && hireOrdersOn ? gateOrgId : null;
  const booking = useBookingSetupStatus(bookingOrgId);
  const hire = useHireOrderSetupStatus(hireOrgId);
  const hireExtra = useHireOrderExtraSetup(hireOrgId);
  const producerCount = useProducerCount(gateOrgId, active && isNonArtist && bookingOn);

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
  const skillGaps = useQuery({
    queryKey: ["skills", "gaps", orgId],
    queryFn: () => fetchSkillEligibilityGaps(supabase, orgId),
    enabled: active && isNonArtist && bookingOn && !!orgId,
  });

  // Called unconditionally (rules of hooks), same as v1.
  const canManageShows = useCan("manage_productions");
  const canEditScheduling = useCan("edit_scheduling");
  const canEditBooking = useCan("edit_booking_settings");
  // The `skills` step edits the skill catalog, which SkillsTab gates on manage_skills
  // (a different capability + producer default than edit_booking_settings).
  const canManageSkills = useCan("manage_skills");
  const canEditHire = useCan("edit_hire_order_settings");
  const canAddArtists = useCan("add_artists");

  // Inactive: every sub-hook above was called (rules of hooks) but fetched nothing (gated
  // orgIds/enabled flags are all false), so there is no live data to compose a model from.
  // Return before the isLoading/model composition below rather than let it build a model
  // out of empty inputs.
  if (!active) return { model: null, isLoading: false };

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
    hasAnyDates: bookingOn ? booking.status.hasAnyDates : false,
    producerCount,
    skillGaps: bookingOn ? (skillGaps.data?.length ?? 0) : 0,
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
