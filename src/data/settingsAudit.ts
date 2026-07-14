import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface SettingsAuditEntry {
  id: string;
  key: string;
  actor: string | null;
  actorName: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

type AuditRow = Omit<SettingsAuditEntry, "actorName">;

export async function fetchSettingsAudit(
  client: SupabaseClient<Database>,
  args: { orgId: string; keys: string[]; limit?: number },
): Promise<SettingsAuditEntry[]> {
  const { data, error } = await client
    .from("settings_audit_log")
    .select("id, key, actor, old_value, new_value, created_at")
    .eq("org_id", args.orgId)
    .in("key", args.keys)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 20);
  if (error) throw error;
  const rows: AuditRow[] = data ?? [];

  const actorIds = [...new Set(rows.map((r) => r.actor).filter(Boolean))] as string[];
  const names = new Map<string, string | null>();
  if (actorIds.length) {
    const { data: profiles } = await client
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", actorIds);
    for (const p of (profiles ?? []) as { user_id: string; display_name: string | null }[]) {
      names.set(p.user_id, p.display_name);
    }
  }

  return rows.map((r) => ({ ...r, actorName: r.actor ? (names.get(r.actor) ?? null) : null }));
}
