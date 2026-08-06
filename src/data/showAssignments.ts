import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Production-ownership data access (Settings → Production ownership).
 *
 * Both reads take an explicit `orgId`: RLS scopes rows to every org the caller may read,
 * not to the org currently being viewed, so relying on it alone lists other orgs'
 * assignments and programs. See src/data/casts.ts for the full rationale.
 */

export interface ShowAssignmentRow {
  id: string;
  producer_user_id: string;
  program: string | null;
  sub_program: string | null;
  city_id: string | null;
}

export interface ProgramSubProgramPair { program: string; sub_program: string }

/** The org's producer→production assignments. */
export async function fetchShowAssignments(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<ShowAssignmentRow[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("show_assignments")
    .select("id, producer_user_id, program, sub_program, city_id")
    .eq("org_id", orgId)
    .order("program").order("sub_program").order("created_at");
  if (error) throw error;
  return (data ?? []) as ShowAssignmentRow[];
}

/** Distinct program / sub-program pairs across the org's shows, sorted for the pickers. */
export async function fetchProgramSubProgramPairs(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<ProgramSubProgramPair[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("shows")
    .select("program, sub_program")
    .eq("org_id", orgId)
    .not("program", "is", null)
    .not("sub_program", "is", null);
  if (error) throw error;
  const seen = new Set<string>();
  const pairs: ProgramSubProgramPair[] = [];
  for (const row of (data ?? []) as { program: string | null; sub_program: string | null }[]) {
    if (row.program == null || row.sub_program == null) continue;
    const key = `${row.program}::${row.sub_program}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ program: row.program, sub_program: row.sub_program });
  }
  pairs.sort((a, b) => a.program.localeCompare(b.program) || a.sub_program.localeCompare(b.sub_program));
  return pairs;
}
