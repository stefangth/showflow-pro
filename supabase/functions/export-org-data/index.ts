import { preflight, json } from "../_shared/http.ts";
import type { Database } from "../_shared/database.types.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";

type OrgTable = keyof Database["public"]["Tables"];

// Every org-scoped table (mirrors delete_org's coverage) so a pre-deletion export
// is not lossy. `organizations` is keyed by `id`; all others by `org_id`.
// notification_preferences is intentionally absent — it is user-scoped (no org_id).
const ORG_TABLES = [
  "organizations", "org_memberships", "org_invitations", "app_settings",
  "artists", "artist_skills", "skills",
  "casts", "cast_members", "cast_city_priority", "cities", "custom_field_definitions",
  "shows", "show_dates", "show_assignments", "show_cast_eligibility",
  "show_date_cast_eligibility", "show_date_change_log", "show_date_offer_tiers",
  "bookings", "booking_audit_log", "blocked_dates",
  "chats", "chat_messages", "notifications",
  "airtable_sync_log", "airtable_sync_record_log",
] as const satisfies readonly OrgTable[];

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireSuperAdmin(deps, req);
  if (!auth.ok) return auth.response;

  let orgId: string | undefined;
  try {
    const body = await req.json();
    orgId = body.org_id ?? body.orgId;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!orgId) return json({ error: "org_id is required" }, 400);

  const admin = deps.admin;
  const bundle: Record<string, unknown> = {
    schema_version: 1,
    exported_at: deps.now().toISOString(),
    org_id: orgId,
  };
  for (const table of ORG_TABLES) {
    const col = table === "organizations" ? "id" : "org_id";
    // The loop is generic over table names, which defeats the typed client's
    // per-table column inference — single structural cast at the boundary.
    const query = admin.from(table).select("*") as unknown as {
      eq: (col: string, val: string) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
    const { data, error } = await query.eq(col, orgId);
    if (error) return json({ error: `Failed to read ${table}` }, 500);
    bundle[table] = data ?? [];
  }
  return json({ success: true, bundle }, 200);
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
