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
import { ensureUserWithRole, BOOTSTRAP_ORG_ID, type SeededUser } from "./users";

export interface BookingFixture {
  cityId: string;
  showId: string;
  showDateId: string;
  /** The resolved ISO date (YYYY-MM-DD) the show_date was seeded on — used by
   *  `openBookingsDate` to navigate the calendar surface to the right month. */
  dateISO: string;
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
    .insert({ name: `${E2E_TAG}-city`, org_id: BOOTSTRAP_ORG_ID })
    .select("id")
    .single();
  if (cityErr || !city) throw new Error(`seed city failed: ${cityErr?.message}`);

  const { data: show, error: showErr } = await admin
    .from("shows")
    .insert({
      program: `${E2E_TAG}-program`,
      sub_program: `${E2E_TAG}-sub`,
      org_id: BOOTSTRAP_ORG_ID,
      // open-offer-tier now refuses to open offers for a show with no slot count set
      // (matches production: a real show is sized before offers go out). Seed a main
      // slot count well above the single seeded artist so dates never auto-fill.
      main_cast_slots: 4,
    })
    .select("id")
    .single();
  if (showErr || !show) throw new Error(`seed show failed: ${showErr?.message}`);

  const { data: cast, error: castErr } = await admin
    .from("casts")
    .insert({ name: `${E2E_TAG}-cast`, org_id: BOOTSTRAP_ORG_ID })
    .select("id")
    .single();
  if (castErr || !cast) throw new Error(`seed cast failed: ${castErr?.message}`);

  const { data: artist, error: artistErr } = await admin
    .from("artists")
    .insert({
      name: `${E2E_TAG}-artist`,
      user_id: artistUser.id,
      email: artistUser.email,
      org_id: BOOTSTRAP_ORG_ID,
    })
    .select("id")
    .single();
  if (artistErr || !artist) throw new Error(`seed artist failed: ${artistErr?.message}`);

  const { error: cmErr } = await admin
    .from("cast_members")
    .insert({ cast_id: cast.id, artist_id: artist.id });
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
    dateISO,
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

/**
 * Like `openOfferTier`, but returns the error message instead of throwing, for
 * specs that need to assert a REJECTED call (a direct-booking org, where
 * `booking_flow.artist_acceptance:false` makes the endpoint refuse with a 409)
 * without an unhandled rejection. Mirrors the error-unwrapping pattern in
 * `src/data/account.ts`: supabase-js reports a handled non-2xx edge-function
 * response as a `FunctionsHttpError` with the Response in `error.context`, and
 * the function's own `{ error: "message" }` body is what we want to assert on.
 */
export async function tryOpenOfferTier(
  showDateId: string,
  tier = 1
): Promise<{ error: string | null }> {
  const admin = adminClient();
  const { error } = await admin.functions.invoke("open-offer-tier", {
    body: { show_date_id: showDateId, tier },
  });
  if (!error) return { error: null };
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body && typeof body.error === "string") return { error: body.error };
    } catch {
      // Body wasn't JSON (or already consumed), fall through to the generic message.
    }
  }
  return { error: error.message };
}

/**
 * Set (or clear) an org's `booking_flow` override in `app_settings`, driving
 * the classic / fast-track / direct presets end to end.
 *
 * `value: null` resets to defaults by DELETING the org's override row, not by
 * upserting a null `value` column: `app_settings.value` is `NOT NULL`, so an
 * upsert with `value: null` (SQL NULL) would violate that constraint. A stored
 * JSONB `'null'::jsonb` would be skipped by `get_org_setting`'s
 * `value <> 'null'::jsonb` guard too, but it can't get inserted in the first
 * place given the same NOT NULL column. Deleting the row is the one
 * unambiguous way back to the platform default.
 */
export async function setBookingFlow(
  orgId: string,
  value: Record<string, unknown> | null
): Promise<void> {
  const admin = adminClient();
  if (value === null) {
    const { error } = await admin
      .from("app_settings")
      .delete()
      .match({ org_id: orgId, key: "booking_flow" });
    if (error) throw error;
    return;
  }
  const { error } = await admin
    .from("app_settings")
    .upsert({ org_id: orgId, key: "booking_flow", value }, { onConflict: "org_id,key" });
  if (error) throw error;
}

/**
 * Give a cast a show-scoped priority for (show, city): the show ladder
 * overrides the org-wide city list for that pair. Creates the eligibility
 * row if missing, updates priority if it already exists.
 */
export async function setShowLadderPriority(args: {
  showId: string;
  cityId: string;
  castId: string;
  orgId: string;
  priority: number;
}): Promise<void> {
  const admin = adminClient();
  const { data: existing } = await admin
    .from("show_cast_eligibility")
    .select("id")
    .eq("show_id", args.showId)
    .eq("city_id", args.cityId)
    .eq("cast_id", args.castId);
  if (existing && existing.length > 0) {
    const { error } = await admin
      .from("show_cast_eligibility")
      .update({ priority: args.priority })
      .eq("id", existing[0].id);
    if (error) throw error;
  } else {
    const { error } = await admin.from("show_cast_eligibility").insert({
      show_id: args.showId,
      city_id: args.cityId,
      cast_id: args.castId,
      org_id: args.orgId,
      priority: args.priority,
    });
    if (error) throw error;
  }
}

/** Require a skill on a show, creating the skill in the org if needed. Returns the skill id. */
export async function addShowRequiredSkillE2E(args: {
  showId: string;
  orgId: string;
  skillName: string;
}): Promise<string> {
  const admin = adminClient();
  const { data: skill, error: skillErr } = await admin
    .from("skills")
    .insert({ org_id: args.orgId, name: args.skillName })
    .select("id")
    .single();
  if (skillErr) throw skillErr;
  const { error } = await admin
    .from("show_required_skills")
    .insert({ show_id: args.showId, skill_id: skill.id, org_id: args.orgId });
  if (error) throw error;
  return skill.id;
}

/** Most recent booking for an artist (any status). */
export async function getLatestBooking(
  artistId: string
): Promise<{ id: string; status: string; confirmed_at: string | null } | null> {
  const admin = adminClient();
  const { data } = await admin
    .from("bookings")
    .select("id, status, confirmed_at")
    .eq("artist_id", artistId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Newest `notifications` row matching a user, type, and related entity, or null.
 * The booking-status-change trigger writes to `notifications` synchronously in
 * the same transaction as the booking write, so once the booking row is
 * readable (e.g. via `getLatestBooking`) its notification is committed too, and
 * this needs no polling or retry.
 */
export async function getNotification(
  userId: string,
  type: string,
  relatedEntityId: string
): Promise<{
  id: string;
  type: string;
  title: string | null;
  user_id: string;
  related_entity_id: string | null;
} | null> {
  const admin = adminClient();
  const { data } = await admin
    .from("notifications")
    .select("id, type, title, user_id, related_entity_id")
    .eq("user_id", userId)
    .eq("type", type)
    .eq("related_entity_id", relatedEntityId)
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
