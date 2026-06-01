import type { Deps } from "./deps.ts";
import { json } from "./http.ts";

export type AuthOutcome =
  | { ok: true; userId: string | null }
  | { ok: false; response: Response };

/** True when the request carries the service-role key as its bearer token. */
export function isServiceRole(deps: Deps, req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return serviceKey !== "" && authHeader === `Bearer ${serviceKey}`;
}

/** Validate a user JWT and require one of `roles`. */
export async function requireRole(deps: Deps, req: Request, roles: string[]): Promise<AuthOutcome> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }
  const { data: { user }, error } = await deps.userClient(authHeader).auth.getUser();
  if (error || !user) return { ok: false, response: json({ error: "Unauthorized" }, 401) };

  const { data: roleRow } = await deps.admin
    .from("user_roles").select("role").eq("user_id", user.id).in("role", roles).maybeSingle();
  if (!roleRow) return { ok: false, response: json({ error: "Forbidden" }, 403) };

  return { ok: true, userId: user.id };
}

/** Accept a valid X-Cron-Secret (vs app_settings.cron_secret) OR fall back to requireRole. */
export async function requireCronOrRole(deps: Deps, req: Request, roles: string[]): Promise<AuthOutcome> {
  const cronSecret = req.headers.get("X-Cron-Secret");
  if (cronSecret) {
    const { data: setting } = await deps.admin
      .from("app_settings").select("value").eq("key", "cron_secret").maybeSingle();
    const stored = ((setting as { value?: string } | null)?.value as string | null) ?? "";
    if (cronSecret !== stored) return { ok: false, response: json({ error: "Unauthorized" }, 401) };
    return { ok: true, userId: null };
  }
  return requireRole(deps, req, roles);
}
