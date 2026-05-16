/**
 * Booking-lifecycle seeding helpers. Creates the minimum graph needed to drive
 * Flow B: a show, a future show_date, a cast, an artist linked to a user, and
 * the eligibility rows that make the artist appear as a valid offer target.
 */
import { adminClient, E2E_TAG } from "./supabase";
import { ensureUserWithRole, type SeededUser } from "./users";

export interface BookingFixture {
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

/** Idempotent seeding keyed by a fixed tag — deletes any prior e2e booking graph first. */
export async function seedBookingFixture(opts: SeedOptions): Promise<BookingFixture> {
  const admin = adminClient();
  await cleanupBookingFixture();

  const artistUser = await ensureUserWithRole(opts.artistEmail, opts.artistPassword, "artist");

  const { data: show, error: showErr } = await admin
    .from("shows")
    .insert({
      title: `${E2E_TAG} show`,
      program: `${E2E_TAG}-program`,
      sub_program: `${E2E_TAG}-sub`,
    })
    .select("id")
    .single();
  if (showErr || !show) throw new Error(`seed show failed: ${showErr?.message}`);

  const { data: cast, error: castErr } = await admin
    .from("casts")
    .insert({ name: `${E2E_TAG} cast`, show_id: show.id })
    .select("id")
    .single();
  if (castErr || !cast) throw new Error(`seed cast failed: ${castErr?.message}`);

  const { data: artist, error: artistErr } = await admin
    .from("artists")
    .insert({
      name: `${E2E_TAG} artist`,
      user_id: artistUser.id,
      email: artistUser.email,
    })
    .select("id")
    .single();
  if (artistErr || !artist) throw new Error(`seed artist failed: ${artistErr?.message}`);

  await admin
    .from("cast_members")
    .insert({ cast_id: cast.id, artist_id: artist.id, role: "primary" });

  await admin
    .from("show_cast_eligibility")
    .insert({ show_id: show.id, cast_id: cast.id });

  const dateISO = opts.dateISO ?? isoDays(30);
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

  await admin
    .from("show_date_cast_eligibility")
    .insert({ show_date_id: showDate.id, cast_id: cast.id });

  return {
    showId: show.id,
    showDateId: showDate.id,
    castId: cast.id,
    artistId: artist.id,
    artistUser,
  };
}

/** Remove any e2e show/cast/artist/booking rows from prior runs. Order matters for FKs. */
export async function cleanupBookingFixture(): Promise<void> {
  const admin = adminClient();
  // shows cascade to show_dates, casts, show_cast_eligibility (per app FK rules).
  // Bookings reference show_date and artist, so delete those first by tag.
  const { data: showIds } = await admin
    .from("shows")
    .select("id")
    .like("title", `${E2E_TAG}%`);
  const ids = (showIds ?? []).map((r) => r.id);
  if (ids.length > 0) {
    // bookings → show_dates → shows
    const { data: dateIds } = await admin
      .from("show_dates")
      .select("id")
      .in("show_id", ids);
    const dateIdList = (dateIds ?? []).map((d) => d.id);
    if (dateIdList.length > 0) {
      await admin.from("bookings").delete().in("show_date_id", dateIdList);
    }
    await admin.from("shows").delete().in("id", ids);
  }
  await admin.from("artists").delete().like("name", `${E2E_TAG}%`);
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

/** Count rows in email_send_log for a recipient since a wall-clock instant. */
export async function emailLogCountSince(
  recipient: string,
  sinceISO: string
): Promise<number> {
  const admin = adminClient();
  const { count } = await admin
    .from("email_send_log")
    .select("*", { count: "exact", head: true })
    .eq("recipient_email", recipient)
    .gte("created_at", sinceISO);
  return count ?? 0;
}
