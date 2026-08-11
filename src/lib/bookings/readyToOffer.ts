/**
 * Pure aggregate for the dashboard first-run stage chain: how many upcoming
 * dates are eligible to open tier-1 offers right now. No Supabase, no React —
 * every input is pre-resolved by the caller (a later "metrics assembler" task).
 */

export interface ReadyDateInput {
  id: string;
  showId: string;
  cityId: string | null;
  /** Any of session_1/session_2/session_3 set — same rule as `hasSession` in
   *  ShowDateDetailSheet.tsx and the `hasSession` arg to shouldAutoOpenTier1
   *  (src/lib/bookings.ts). */
  hasSession: boolean;
  /** The date's show has main_cast_slots configured and > 0 — the same "slots
   *  done" signal computeBookingSetupStatus (src/lib/bookings/setupStatus.ts)
   *  reads per show, evaluated here per date via its show's slot count. */
  slotsSet: boolean;
}

/**
 * A date counts as "ready to offer" iff it has a session configured, its
 * show's slots are set, its (show, city) pair already has tier-1 coverage
 * (per `resolveCoverage`/`fetchLadderCoverageInputs`), and tier 1 has not
 * already been opened for it (per `fetchOpenedTier1DateIds`).
 *
 * `coveredShowCity` and `openedTier1Ids` are injected so this stays pure and
 * dependency-free — the caller wires them from `resolveCoverage(...)` output
 * and `fetchOpenedTier1DateIds(...)` respectively.
 */
export function countReadyToOffer(
  dates: ReadyDateInput[],
  coveredShowCity: (showId: string, cityId: string | null) => boolean,
  openedTier1Ids: Set<string>,
): number {
  let count = 0;
  for (const d of dates) {
    if (d.hasSession && d.slotsSet && coveredShowCity(d.showId, d.cityId) && !openedTier1Ids.has(d.id)) {
      count++;
    }
  }
  return count;
}
