import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";

const ORG_TABLES = [
  "organizations", "org_memberships", "artists", "shows", "show_dates",
  "bookings", "booking_audit_log", "chats", "chat_messages",
];

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
    const { data, error } = await admin.from(table).select("*").eq(col, orgId);
    if (error) return json({ error: `Failed to read ${table}` }, 500);
    bundle[table] = data ?? [];
  }
  return json({ success: true, bundle }, 200);
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
