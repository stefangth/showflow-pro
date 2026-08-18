import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Artist } from "@/types";

/** Artist ids in an org with a live pending app-login invite (member-guarded RPC). */
export async function fetchPendingInvitedArtistIds(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<string[]> {
  const { data, error } = await client.rpc("list_pending_invited_artists", { p_org: orgId });
  if (error) throw error;
  return (data ?? []) as string[];
}

/**
 * The artists row linked to a given auth user, in the ACTIVE org (or null).
 *
 * The org filter is required for correctness, not just tidiness: one auth user can be
 * linked to an `artists` row in several orgs, and RLS returns all of them, so an
 * unfiltered `maybeSingle()` errors on multiple rows (or resolves the wrong org's
 * artist). Every artist-facing booking view keys off the id this returns.
 */
export async function fetchMyArtist(
  client: SupabaseClient<Database>,
  userId: string,
  orgId: string | null,
): Promise<Artist | null> {
  if (!orgId) return null;
  const { data, error } = await client
    .from("artists")
    .select("*")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Artist | null) ?? null;
}

/** The org's artists, alphabetical — the artists list surface. */
export async function fetchArtists(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<Artist[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("artists").select("*").eq("org_id", orgId).order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Artist[];
}

/**
 * How many ACTIVE artists the org has on its roster. A server-side head count, so no row
 * data crosses the wire and there is no PostgREST max-rows truncation to misread as an
 * empty roster (see fetchPendingConfirmationsCount).
 *
 * Scoped to `status = 'active'` because that is exactly the population the offer engine
 * reads (open-offer-tier filters the same way, as does fetchActiveArtistOptions). This
 * count drives the booking-setup readiness gate, so counting inactive or on-leave rows
 * would clear the gate for an org whose whole roster is parked while a tier would still
 * open to nobody.
 */
export async function fetchArtistCount(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<number> {
  const { count, error } = await client
    .from("artists")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "active");
  if (error) throw error;
  return count ?? 0;
}

/** Row shape of the fetchActiveArtistOptions artist_skills join below. */
interface ArtistSkillLinkRow { artist_id: string; skill_id: string }

/** Minimal active-artist options for the direct-book / eligibility pickers, each carrying
 *  its skill ids so EligibilityBookList's narrowing chips (design 1h) can count how many
 *  of the currently-listed artists hold a given skill. */
export async function fetchActiveArtistOptions(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<{ id: string; name: string; skillIds: string[] }[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("artists")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("name");
  if (error) throw error;
  const artists = (data ?? []) as { id: string; name: string }[];
  if (artists.length === 0) return [];
  const { data: skillRows, error: skillError } = await client
    .from("artist_skills")
    .select("artist_id, skill_id")
    .eq("org_id", orgId);
  if (skillError) throw skillError;
  const skillIdsByArtist = new Map<string, string[]>();
  for (const row of (skillRows ?? []) as unknown as ArtistSkillLinkRow[]) {
    const existing = skillIdsByArtist.get(row.artist_id);
    if (existing) existing.push(row.skill_id);
    else skillIdsByArtist.set(row.artist_id, [row.skill_id]);
  }
  return artists.map((a) => ({ ...a, skillIds: skillIdsByArtist.get(a.id) ?? [] }));
}

/** A show_date the artist was booked on that was cancelled via a date cancellation. */
export interface CancelledDateEntry {
  id: string; // show_date id
  date: string;
  venue: string | null;
  session_1: string | null;
  session_2: string | null;
  session_3: string | null;
  status: "cancelled";
  cancellation_reason: string | null;
  show: { program: string | null; sub_program: string | null } | null;
}

/** Joined row shape of the fetchMyCancelledDateBookings select below — mirror the select string. */
interface CancelledBookingRow {
  show_date_id: string;
  show_date: {
    id: string;
    date: string;
    venue: string | null;
    session_1: string | null;
    session_2: string | null;
    session_3: string | null;
    status: string;
    cancellation_reason: string | null;
    show: { program: string | null; sub_program: string | null } | null;
  } | null;
}

/** Dates this artist had a booking on that were cancelled by a date cancellation. */
export async function fetchMyCancelledDateBookings(
  client: SupabaseClient<Database>,
  artistId: string,
): Promise<CancelledDateEntry[]> {
  const { data, error } = await client
    .from("bookings")
    .select(
      "show_date_id, show_date:show_dates(id, date, venue, session_1, session_2, session_3, status, cancellation_reason, show:shows(program, sub_program))",
    )
    .eq("artist_id", artistId)
    .eq("status", "cancelled")
    .eq("cancellation_reason", "date_cancelled");
  if (error) throw error;
  return ((data ?? []) as unknown as CancelledBookingRow[])
    .map((b) => b.show_date)
    .filter((sd): sd is CancelledDateEntry => !!sd && sd.status === "cancelled");
}

/**
 * A show_date this artist has an active (non-cancelled) booking on, with the
 * booking's own status (suggested/soft_booked/confirmed) rather than the
 * show_date's. Shaped like `CancelledDateEntry` so callers can render both
 * uniformly; unlike `useArtistEligibleDates` (upcoming-only), this includes
 * past dates — it's the row source that makes past bookings renderable.
 *
 * `kind` is a literal discriminant tag, not just a field that happens to be
 * unique among the row shapes a caller might union together (like the old
 * `'is_understudy' in d` guard relied on): a new field landing on a sibling
 * type can't silently break the `in` check the way a coincidental key could.
 */
export interface ActiveBookedDateEntry {
  kind: "active-booked";
  id: string; // show_date id
  date: string;
  venue: string | null;
  session_1: string | null;
  session_2: string | null;
  session_3: string | null;
  status: string; // the booking's status
  is_understudy: boolean;
  show: { program: string | null; sub_program: string | null } | null;
}

/** Joined row shape of the fetchMyActiveBookedDates select below — mirror the select string. */
interface ActiveBookingRow {
  show_date_id: string;
  status: string;
  is_understudy: boolean;
  show_date: {
    id: string;
    date: string;
    venue: string | null;
    session_1: string | null;
    session_2: string | null;
    session_3: string | null;
    show: { program: string | null; sub_program: string | null } | null;
  } | null;
}

/** Dates this artist has an active (non-cancelled) booking on, past or upcoming. */
export async function fetchMyActiveBookedDates(
  client: SupabaseClient<Database>,
  artistId: string,
): Promise<ActiveBookedDateEntry[]> {
  const { data, error } = await client
    .from("bookings")
    .select(
      "show_date_id, status, is_understudy, show_date:show_dates(id, date, venue, session_1, session_2, session_3, show:shows(program, sub_program))",
    )
    .eq("artist_id", artistId)
    .neq("status", "cancelled");
  if (error) throw error;
  return ((data ?? []) as unknown as ActiveBookingRow[])
    .filter((b): b is ActiveBookingRow & { show_date: NonNullable<ActiveBookingRow["show_date"]> } => !!b.show_date)
    .map((b) => ({
      kind: "active-booked" as const,
      id: b.show_date.id,
      date: b.show_date.date,
      venue: b.show_date.venue,
      session_1: b.show_date.session_1,
      session_2: b.show_date.session_2,
      session_3: b.show_date.session_3,
      status: b.status,
      is_understudy: b.is_understudy,
      show: b.show_date.show,
    }));
}

/** Append cancelled entries whose id isn't already in the eligible-dates list. */
export function mergeArtistCancelledDates<T extends { id: string }>(
  eligible: T[],
  cancelled: CancelledDateEntry[],
): Array<T | CancelledDateEntry> {
  const seen = new Set(eligible.map((d) => d.id));
  return [...eligible, ...cancelled.filter((c) => !seen.has(c.id))];
}

/**
 * Append active-booked entries whose id isn't already in the base list. Mirrors
 * `mergeArtistCancelledDates`'s first-seen-wins semantics; used to surface a
 * booking whose show_date falls outside `useArtistEligibleDates` (upcoming-only) —
 * typically a past date. This is the fix for the July 31 bug where a past
 * `soft_booked` booking was invisible to the artist because the eligible-dates
 * query silently excludes anything before today.
 */
export function mergeArtistActiveBookedDates<T extends { id: string }>(
  base: T[],
  activeBooked: ActiveBookedDateEntry[],
): Array<T | ActiveBookedDateEntry> {
  const seen = new Set(base.map((d) => d.id));
  return [...base, ...activeBooked.filter((d) => !seen.has(d.id))];
}
