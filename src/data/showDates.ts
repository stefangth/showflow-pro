import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface CreateShowDateArgs {
  orgId: string;
  showId: string;
  date: string; // 'yyyy-MM-dd'
  session1: string | null;
  session2: string | null;
  session3: string | null;
  venue: string | null;
  cityId: string | null;
  notes: string | null;
}
export interface UpdateShowDatePatch {
  date?: string;
  session_1?: string | null;
  session_2?: string | null;
  session_3?: string | null;
  venue?: string | null;
  city_id?: string | null;
  notes?: string | null;
}
export interface DupCheckDate { id: string; show_id: string; date: string; status: string }

/** Insert a manual show_date. org_id is also re-derived by trg_derive_org_id from show_id. */
export async function createShowDate(client: SupabaseClient<Database>, a: CreateShowDateArgs): Promise<{ id: string }> {
  const { data, error } = await client.from("show_dates").insert({
    org_id: a.orgId, show_id: a.showId, date: a.date,
    session_1: a.session1, session_2: a.session2, session_3: a.session3,
    venue: a.venue, city_id: a.cityId, notes: a.notes,
  }).select("id").single();
  if (error) throw error;
  return data as { id: string };
}

export async function updateShowDate(client: SupabaseClient<Database>, id: string, patch: UpdateShowDatePatch): Promise<void> {
  const { error } = await client.from("show_dates").update(patch).eq("id", id);
  if (error) throw error;
}

/** Cancel (status→cancelled fires cascade_cancel_bookings_on_date_cancel; releases bookings, audited). */
export async function cancelShowDate(client: SupabaseClient<Database>, id: string, reason: string): Promise<void> {
  const { error } = await client.from("show_dates").update({ status: "cancelled", cancellation_reason: reason }).eq("id", id);
  if (error) throw error;
}

export async function deleteShowDate(client: SupabaseClient<Database>, id: string): Promise<void> {
  const { error } = await client.from("show_dates").delete().eq("id", id);
  if (error) throw error;
}

/** Minimal rows for the create-dialog duplicate check (same show). */
export async function fetchShowDatesForShow(client: SupabaseClient<Database>, showId: string | null): Promise<DupCheckDate[]> {
  if (!showId) return [];
  const { data, error } = await client.from("show_dates").select("id, show_id, date, status").eq("show_id", showId);
  if (error) throw error;
  return (data ?? []) as DupCheckDate[];
}

/* ------------------------------------------------------------------------- *
 * Org-scoped list reads. The explicit org filter is load-bearing: RLS scopes to
 * every org the caller may read, not to the org being viewed (ADR-0003).
 * ------------------------------------------------------------------------- */

const SHOW_DATE_LIST_COLS =
  "id, date, session_1, session_2, session_3, venue, status, notes, city_id, show_id, custom, cancellation_reason, cast_notified_at, " +
  "show:shows(id, program, sub_program, status, main_cast_slots, understudy_slots), " +
  "city:cities(id, name)";

/** Every show_date in the org, with show + city, for the bookings grid. */
export async function fetchShowDatesList<T>(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<T[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("show_dates")
    .select(SHOW_DATE_LIST_COLS)
    .eq("org_id", orgId)
    .order("date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as T[];
}

/** The org's upcoming, non-cancelled dates from `today` (yyyy-mm-dd) onward. */
export async function fetchUpcomingShowDates<T>(
  client: SupabaseClient<Database>,
  orgId: string | null,
  today: string,
  columns = "id, date, show_id, show:shows(program, sub_program, main_cast_slots, understudy_slots)",
): Promise<T[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("show_dates")
    .select(columns)
    .eq("org_id", orgId)
    .gte("date", today)
    .neq("status", "cancelled")
    .order("date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as T[];
}

/** How many non-cancelled dates the org has, past or future. The get-running board
 *  uses this to tell "no dates yet" (first run) from "no upcoming dates" (between
 *  seasons); counting only future dates would make an established org look blank. */
export async function fetchShowDateCount(client: SupabaseClient, orgId: string | null): Promise<number> {
  if (!orgId) return 0;
  const { count, error } = await client
    .from("show_dates")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .neq("status", "cancelled");
  if (error) throw error;
  return count ?? 0;
}

/** The soonest future, non-cancelled show date that has a city, for the setup-rail
 *  rehearsal. Null when none qualifies (a date without a city cannot resolve a tier). */
export async function fetchNextRehearsalDate(
  client: SupabaseClient<Database>,
  args: { orgId: string; today: string },
): Promise<{ id: string; date: string } | null> {
  const { data, error } = await client
    .from("show_dates")
    .select("id, date")
    .eq("org_id", args.orgId)
    .neq("status", "cancelled")
    .not("city_id", "is", null)
    .gte("date", args.today)
    .order("date", { ascending: true })
    .limit(1);
  if (error) throw error;
  const row = ((data ?? []) as { id: string; date: string }[])[0];
  return row ? { id: row.id, date: row.date } : null;
}
