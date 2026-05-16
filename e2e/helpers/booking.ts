/**
 * Booking-lifecycle seeding helpers. Creates the minimum graph needed to drive
 * Flow B: a city, show, future show_date, cast, artist linked to a user, and
 * the eligibility rows that make the artist appear as a valid offer target.
 *
 * Schema reminders (from src/integrations/supabase/types.ts):
 *   - `shows` has NO `title` column — identify by `program` + `sub_program`.
 *   - `casts` has NO `show_id` — the cast↔show link lives in
 *     `show_cast_eligibility (show_id, cast_id, city_id)`.
 *   - `show_cast_eligibility.city_id` is NOT NULL, so we always seed a city.
 *   - `show_date_cast_eligibility (show_date_id, cast_id)` is the per-date
 *     override used by `open-offer-tier` when `tier=99`.
 */
import { adminClient, E2E_TAG } from "./supabase";
import { ensureUserWithRole, type SeededUser } from "./users";

export interface BookingFixture {
  cityId: string;
  showId: string;
  showDateId: string;
  castId: string;
  artistId: string;
  artistUser: SeededUser;
}

interface SeedOptions {
  artistEmail: string;
  artistPassword: string;
  /** ISO date (YYYY-MM-DD). Defaults to 30 days from today. */
  dateISO?: string;
}

function isoDays(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Idempotent seeding: wipes any prior e2e booking graph then re-seeds. */
export async function seedBookingFixture(opts: SeedOptions): Promise<BookingFixture> {
  const admin = adminClient();
  await cleanupBookingFixture();

  const artistUser = await ensureUserWithRole(opts.artistEmail, opts.artistPassword, "artist");

  const { data: city, error: cityErr } = await admin
    .from("cities")
    .insert({ name: `${E2E_TAG}-city` })
    .select("id")
    .single();
  if (cityErr || !city) throw new Error(`seed city failed: ${cityErr?.message}`);

  const { data: show, error: showErr } = await admin
    .from("shows")
    .insert({
      program: `${E2E_TAG}-program`,
      sub_program: `${E2E_TAG}-sub`,
    })
    .select("id")
    .single();
  if (showErr || !show) throw new Error(`seed show failed: ${showErr?.message}`);

  const { data: cast, error: castErr } = await admin
    .from("casts")
    .insert({ name: `${E2E_TAG}-cast` })
    .select("id")
    .single();
  if (castErr || !cast) throw new Error(`seed cast failed: ${castErr?.message}`);

  const { data: artist, error: artistErr } = await admin
    .from("artists")
    .insert({
      name: `${E2E_TAG}-artist`,
      user_id: artistUser.id,
      email: artistUser.email,
    })
    .select("id")
    .single();
  if (artistErr || !artist) throw new Error(`seed artist failed: ${artistErr?.message}`);

  const { error: cmErr } = await admin
    .from("cast_members")
    .insert({ cast_id: cast.id, artist_id: artist.id, role: "primary" });
  if (cmErr) throw new Error(`seed cast_members failed: ${cmErr.message}`);

  const { error: sceErr } = await admin
    .from("show_cast_eligibility")
    .insert({ show_id: show.id, cast_id: cast.id, city_id: city.id });
  if (sceErr) throw new Error(`seed show_cast_eligibility failed: ${sceErr.message}`);

  const dateISO = opts.dateISO ?? isoDays(30);
  // Leave city_id null on the show_date — that keeps `open-offer-tier` on the
  // tier-99 path with no priority filtering.
  const { data: showDate, error: dateErr } = await admin
    .from("show_dates")
    .insert({
      show_id: show.id,
      date: dateISO,
      session_1: "20:00:00",
    })
    .select("id")
    .single();
  if (dateErr || !showDate) throw new Error(`seed show_date failed: ${dateErr?.message}`);

  const { error: sdceErr } = await admin
    .from("show_date_cast_eligibility")
    .insert({ show_date_id: showDate.id, cast_id: cast.id });
  if (sdceErr) throw new Error(`seed show_date_cast_eligibility failed: ${sdceErr.message}`);

  return {
    cityId: city.id,
    showId: show.id,
    showDateId: showDate.id,
    castId: cast.id,
    artistId: artist.id,
    artistUser,
  };
}

/** Remove any e2e-tagged graph from prior runs. Order matters for FK constraints. */
export async function cleanupBookingFixture(): Promise<void> {
  const admin = adminClient();

  const { data: shows } = await admin
    .from("shows")
    .select("id")
    .like("program", `${E2E_TAG}%`);
  const showIds = (shows ?? []).map((r) => r.id);

  const { data: casts } = await admin
    .from("casts")
    .select("id")
    .like("name", `${E2E_TAG}%`);
  const castIds = (casts ?? []).map((r) => r.id);

  if (showIds.length > 0) {
    const { data: dates } = await admin
      .from("show_dates")
      .select("id")
      .in("show_id", showIds);
    const dateIds = (dates ?? []).map((d) => d.id);

    if (dateIds.length > 0) {
      await admin.from("bookings").delete().in("show_date_id", dateIds);
      await admin.from("show_date_cast_eligibility").delete().in("show_date_id", dateIds);
    }
    await admin.from("show_cast_eligibility").delete().in("show_id", showIds);
    await admin.from("show_dates").delete().in("show_id", showIds);
    await admin.from("shows").delete().in("id", showIds);
  }

  if (castIds.length > 0) {
    await admin.from("cast_members").delete().in("cast_id", castIds);
    await admin.from("show_cast_eligibility").delete().in("cast_id", castIds);
    await admin.from("show_date_cast_eligibility").delete().in("cast_id", castIds);
    await admin.from("casts").delete().in("id", castIds);
  }

  await admin.from("artists").delete().like("name", `${E2E_TAG}%`);
  await admin.from("cities").delete().like("name", `${E2E_TAG}%`);
}

/** Trigger an offer tier for a date via the same edge function the producer flow uses. */
export async function openOfferTier(showDateId: string, tier = 1): Promise<void> {
  const admin = adminClient();
  const { error } = await admin.functions.invoke("open-offer-tier", {
    body: { show_date_id: showDateId, tier },
  });
  if (error) throw new Error(`open-offer-tier failed: ${error.message}`);
}

/** Most recent booking for an artist (any status). */
export async function getLatestBooking(
  artistId: string
): Promise<{ id: string; status: string } | null> {
  const admin = adminClient();
  const { data } = await admin
    .from("bookings")
    .select("id, status")
    .eq("artist_id", artistId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Count `booking_confirmed` notifications for a user since a wall-clock instant.
 * The booking-status-change trigger writes to `notifications` directly; the
 * email itself is sent later by the daily confirmation-digest cron job.
 * For E2E we verify the trigger fired — that's the "email stub" boundary.
 */
export async function confirmedNotificationsSince(
  userId: string,
  sinceISO: string
): Promise<number> {
  const admin = adminClient();
  const { count } = await admin
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "booking_confirmed")
    .gte("created_at", sinceISO);
  return count ?? 0;
}
