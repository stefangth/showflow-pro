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

/** Fetch the artists row linked to a given auth user id (or null). */
export async function fetchMyArtist(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<Artist | null> {
  const { data, error } = await client
    .from("artists")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Artist | null) ?? null;
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

/** Append cancelled entries whose id isn't already in the eligible-dates list. */
export function mergeArtistCancelledDates<T extends { id: string }>(
  eligible: T[],
  cancelled: CancelledDateEntry[],
): Array<T | CancelledDateEntry> {
  const seen = new Set(eligible.map((d) => d.id));
  return [...eligible, ...cancelled.filter((c) => !seen.has(c.id))];
}
