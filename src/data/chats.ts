import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Chat data access.
 *
 * The list read below is org-filtered for the same reason as every other list in
 * `src/data`: RLS scopes rows to every org the caller may read, not to the org
 * currently being viewed, so an unfiltered `from("chats")` shows other orgs' chats
 * to super-admins and multi-org members. See src/data/casts.ts and ADR-0003.
 */

export interface ChatListRow {
  id: string;
  show_date_id: string;
  created_at: string;
  show_date: {
    id: string;
    date: string;
    show_id: string;
    show: { id: string; program: string | null; sub_program: string | null } | null;
  } | null;
}

/** The org's chat threads, newest first, with their date + show for the list UI. */
export async function fetchMyChats(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<ChatListRow[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("chats")
    .select("id, show_date_id, created_at, show_date:show_dates(id, date, show_id, show:shows(id, program, sub_program))")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ChatListRow[];
}
