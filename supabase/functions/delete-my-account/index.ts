import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = deps.userClient(authHeader);
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  // Last-admin guard: block if the caller is the sole admin of any org. Call via the
  // user's JWT client — sole_admin_orgs is self-scoped on auth.uid(), so the service-role
  // client (auth.uid() = null) would return nothing and silently disable the guard.
  const { data: soleOrgs, error: guardErr } = await userClient.rpc("sole_admin_orgs", { p_user: user.id });
  if (guardErr) return json({ error: "verify_failed" }, 500);
  const orgs = (soleOrgs ?? []) as Array<{ org_id: string; org_name: string }>;
  if (orgs.length > 0) {
    return json({ error: "last_admin", org_name: orgs[0].org_name }, 409);
  }

  // Anonymize via the caller's JWT client so anonymize_user's auth.uid() = self.
  const { error: anonErr } = await userClient.rpc("anonymize_user", { p_user: user.id });
  if (anonErr) return json({ error: "anonymize_failed" }, 500);

  // Finally, delete the auth account (admin API).
  const { error: delErr } = await deps.admin.auth.admin.deleteUser(user.id);
  if (delErr) return json({ error: "delete_failed" }, 500);

  return json({ success: true }, 200);
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
