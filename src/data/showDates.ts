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
