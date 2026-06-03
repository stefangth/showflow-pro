/**
 * Eligibility-gating helpers. These compose on top of the booking fixture
 * (`seedBookingFixture` already builds the eligible graph: city, show, cast,
 * cast_member, show_cast_eligibility, plus one eligible show_date with a
 * `show_date_cast_eligibility` row). The only thing missing for the gating
 * spec is a SECOND show_date on the same show that the cast is NOT eligible
 * for — i.e. one with no `show_date_cast_eligibility` row.
 *
 * Everything here reuses the booking fixture's tagging convention so
 * `cleanupBookingFixture()` (FK-ordered) tears it down: the extra show_date
 * hangs off the same `${E2E_TAG}-program` show, and any toggle helpers only
 * touch `show_date_cast_eligibility` rows keyed by those tagged ids.
 *
 * Schema reminders (src/integrations/supabase/types.ts):
 *   - `show_date_cast_eligibility (show_date_id, cast_id)` is the per-date
 *     override `open-offer-tier` reads on the tier-99 path. A show_date with
 *     no row here yields zero eligible casts → zero offers.
 */
import { adminClient } from "./supabase";

function isoDays(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Add a second show_date on the already-seeded show that the cast is NOT
 * eligible for (no `show_date_cast_eligibility` row). Mirrors the show_date
 * insert in `seedBookingFixture` (city_id left null → tier-99 path).
 */
export async function seedIneligibleShowDate(
  showId: string,
  dateISO?: string
): Promise<{ showDateId: string }> {
  const admin = adminClient();
  const { data: showDate, error } = await admin
    .from("show_dates")
    .insert({
      show_id: showId,
      date: dateISO ?? isoDays(31),
      session_1: "20:00:00",
    })
    .select("id")
    .single();
  if (error || !showDate) {
    throw new Error(`seed ineligible show_date failed: ${error?.message}`);
  }
  // Deliberately NO show_date_cast_eligibility row → cast is not eligible.
  return { showDateId: showDate.id };
}

/** Make a cast eligible for a date (idempotent on the natural key). */
export async function addDateEligibility(
  showDateId: string,
  castId: string
): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("show_date_cast_eligibility")
    .upsert(
      { show_date_id: showDateId, cast_id: castId },
      { onConflict: "show_date_id,cast_id", ignoreDuplicates: true }
    );
  if (error) throw new Error(`addDateEligibility failed: ${error.message}`);
}

/** Remove a cast's eligibility for a date. */
export async function removeDateEligibility(
  showDateId: string,
  castId: string
): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("show_date_cast_eligibility")
    .delete()
    .eq("show_date_id", showDateId)
    .eq("cast_id", castId);
  if (error) throw new Error(`removeDateEligibility failed: ${error.message}`);
}

/** Count bookings (any status) for an artist on a specific date. */
export async function bookingCountForDate(
  artistId: string,
  showDateId: string
): Promise<number> {
  const admin = adminClient();
  const { count } = await admin
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("artist_id", artistId)
    .eq("show_date_id", showDateId);
  return count ?? 0;
}
