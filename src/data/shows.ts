import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type ShowStatus = Database["public"]["Enums"]["show_status"]; // 'active' | 'archived' | 'draft'

export interface ShowRow {
  id: string;
  program: string | null;
  sub_program: string | null;
  category: string | null;
  description: string | null;
  status: ShowStatus;
  main_cast_slots: number | null;
  understudy_slots: number | null;
  airtable_program_key: string | null;
  sort_order: number | null;
  created_at?: string;
}
export interface ShowWithStats extends ShowRow { dateCount: number }

export interface CreateShowArgs {
  orgId: string;
  createdBy: string | null;
  program: string | null;
  subProgram: string | null;
  category: string | null;
  description: string | null;
  mainCastSlots: number | null;
  understudySlots: number | null;
  sortOrder: number | null;
}
export interface UpdateShowPatch {
  program?: string | null;
  sub_program?: string | null;
  category?: string | null;
  description?: string | null;
  main_cast_slots?: number | null;
  understudy_slots?: number | null;
}

const SHOW_COLS =
  "id, program, sub_program, category, description, status, main_cast_slots, understudy_slots, airtable_program_key, sort_order, created_at";

/** Show options for the cast-priority scope picker, in the catalog's display order. */
export async function fetchShowOptions(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<Pick<ShowRow, "id" | "program" | "sub_program">[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("shows")
    .select("id, program, sub_program")
    .eq("org_id", orgId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("program");
  if (error) throw error;
  return (data ?? []) as Pick<ShowRow, "id" | "program" | "sub_program">[];
}

/** Minimal show identities for the cast-eligibility matrix columns, org-scoped. */
export async function fetchShowsForEligibility(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<Pick<ShowRow, "id" | "program" | "sub_program">[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("shows").select("id, program, sub_program").eq("org_id", orgId).order("program");
  if (error) throw error;
  return (data ?? []) as Pick<ShowRow, "id" | "program" | "sub_program">[];
}

/** Org's shows ordered for display, each with its non-cancelled date count. */
export async function fetchShowsWithStats(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<ShowWithStats[]> {
  if (!orgId) return [];
  const { data: shows, error } = await client
    .from("shows").select(SHOW_COLS).eq("org_id", orgId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("program", { ascending: true })
    .order("sub_program", { ascending: true });
  if (error) throw error;
  const { data: dates, error: dErr } = await client
    .from("show_dates").select("show_id").eq("org_id", orgId).neq("status", "cancelled");
  if (dErr) throw dErr;
  const counts = new Map<string, number>();
  for (const d of (dates ?? []) as { show_id: string }[]) counts.set(d.show_id, (counts.get(d.show_id) ?? 0) + 1);
  return (shows ?? []).map((s) => ({ ...(s as ShowRow), dateCount: counts.get((s as ShowRow).id) ?? 0 }));
}

export async function createShow(client: SupabaseClient<Database>, a: CreateShowArgs): Promise<{ id: string }> {
  const { data, error } = await client.from("shows").insert({
    org_id: a.orgId, created_by: a.createdBy, program: a.program, sub_program: a.subProgram,
    category: a.category, description: a.description, main_cast_slots: a.mainCastSlots,
    understudy_slots: a.understudySlots, status: "active", sort_order: a.sortOrder,
  }).select("id").single();
  if (error) throw error;
  return data as { id: string };
}

export async function updateShow(client: SupabaseClient<Database>, id: string, patch: UpdateShowPatch): Promise<void> {
  const { error } = await client.from("shows").update(patch).eq("id", id);
  if (error) throw error;
}

export async function archiveShow(client: SupabaseClient<Database>, id: string, archived: boolean): Promise<void> {
  const { error } = await client.from("shows").update({ status: archived ? "archived" : "active" }).eq("id", id);
  if (error) throw error;
}

export async function deleteShow(client: SupabaseClient<Database>, id: string): Promise<void> {
  const { error } = await client.from("shows").delete().eq("id", id);
  if (error) throw error;
}

/** Persist a new display order: sort_order = array index, per id. */
export async function reorderShows(client: SupabaseClient<Database>, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await client.from("shows").update({ sort_order: i }).eq("id", orderedIds[i]);
    if (error) throw error;
  }
}
