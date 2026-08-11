import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

interface Body { org_id?: string; user_id?: string }

/**
 * Full account delete for a removed org member, but ONLY when this org was the user's
 * LAST membership — so an org admin can never erase someone still active in another org.
 * Returns { retained: true } (a no-op) when the user still belongs elsewhere; the caller
 * then just clears the tombstone from the list. Requires org-admin (super-admins pass).
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Body;
  try { body = await req.json() as Body; } catch { return json({ error: "Bad request" }, 400); }
  const orgId = body.org_id, targetId = body.user_id;
  if (!orgId || !targetId) return json({ error: "Bad request" }, 400);

  const gate = await requireOrgRole(deps, req, orgId, ["admin"]);
  if (!gate.ok) return gate.response;
  const authHeader = req.headers.get("Authorization") ?? "";

  // Must already be a removed member of this org (you can only purge a tombstone).
  const { data: tomb } = await deps.admin
    .from("org_member_removals").select("user_id").eq("org_id", orgId).eq("user_id", targetId).maybeSingle();
  if (!tomb) return json({ error: "not_removed" }, 404);

  // Safe-scope: a full delete only if this was their LAST org (no membership anywhere).
  const { data: other } = await deps.admin
    .from("org_memberships").select("org_id").eq("user_id", targetId).limit(1).maybeSingle();
  if (other) return json({ retained: true, reason: "other_memberships" }, 200);

  // Anonymize via the caller's JWT client so admin_anonymize_removed_user's
  // has_org_role(auth.uid()) resolves to the calling admin.
  const { error: anonErr } = await deps.userClient(authHeader)
    .rpc("admin_anonymize_removed_user", { p_org: orgId, p_user: targetId });
  if (anonErr) return json({ error: "anonymize_failed" }, 500);

  // Delete the auth account; the org_member_removals FK cascade clears the tombstone.
  const { error: delErr } = await deps.admin.auth.admin.deleteUser(targetId);
  if (delErr) return json({ error: "delete_failed" }, 500);

  return json({ deleted: true }, 200);
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
