import type { Deps } from "./deps.ts";
import { json } from "./http.ts";

export type AuthOutcome =
  | { ok: true; userId: string | null }
  | { ok: false; response: Response };

/**
 * Constant-time string comparison. Guards against timing side-channels when
 * comparing secrets. We short-circuit on unequal lengths first (length is not
 * secret), then XOR-accumulate every byte so the loop runs for the full length
 * regardless of where (or whether) the bytes differ.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/** True when the request carries the service-role key as its bearer token. */
export function isServiceRole(deps: Deps, req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return serviceKey !== "" && authHeader === `Bearer ${serviceKey}`;
}

/**
 * Validate a user JWT and require one of `roles` in ANY org (coarse gate).
 *
 * org_memberships can hold many rows per user (multi-org), so we cap at one row to
 * avoid PostgREST's "multiple rows returned" error on .maybeSingle().
 */
export async function requireRole(deps: Deps, req: Request, roles: string[]): Promise<AuthOutcome> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }
  const { data: { user }, error } = await deps.userClient(authHeader).auth.getUser();
  if (error || !user) return { ok: false, response: json({ error: "Unauthorized" }, 401) };

  const { data: roleRow } = await deps.admin
    .from("org_memberships").select("role").eq("user_id", user.id).in("role", roles).limit(1).maybeSingle();
  if (!roleRow) return { ok: false, response: json({ error: "Forbidden" }, 403) };

  return { ok: true, userId: user.id };
}

/**
 * Validate a user JWT and require one of `roles` WITHIN a specific org.
 *
 * Used by org-scoped admin endpoints (e.g. admin-set-role) so an admin of one org
 * cannot act on another. Platform admins (super-admins) bypass the org gate so
 * god-mode works on org-scoped endpoints (mirrors the SQL is_super_admin short-circuit).
 */
export async function requireOrgRole(deps: Deps, req: Request, orgId: string, roles: string[]): Promise<AuthOutcome> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }
  const { data: { user }, error } = await deps.userClient(authHeader).auth.getUser();
  if (error || !user) return { ok: false, response: json({ error: "Unauthorized" }, 401) };

  // Common path first: an org membership with one of the required roles.
  const { data: roleRow } = await deps.admin
    .from("org_memberships").select("role")
    .eq("user_id", user.id).eq("org_id", orgId).in("role", roles).limit(1).maybeSingle();
  if (roleRow) return { ok: true, userId: user.id };

  // Fallback (rare): platform admins pass every org gate (mirrors the SQL is_super_admin short-circuit).
  const { data: superRow } = await deps.admin
    .from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (superRow) return { ok: true, userId: user.id };

  return { ok: false, response: json({ error: "Forbidden" }, 403) };
}

/**
 * Validate a user JWT and require the caller to be a platform admin (super-admin).
 * Used by /platform edge endpoints (provision-org).
 */
export async function requireSuperAdmin(deps: Deps, req: Request): Promise<AuthOutcome> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }
  const { data: { user }, error } = await deps.userClient(authHeader).auth.getUser();
  if (error || !user) return { ok: false, response: json({ error: "Unauthorized" }, 401) };

  const { data: row } = await deps.admin
    .from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!row) return { ok: false, response: json({ error: "Forbidden" }, 403) };

  return { ok: true, userId: user.id };
}

/** Accept a valid X-Cron-Secret (vs app_settings.cron_secret) OR fall back to requireRole. */
export async function requireCronOrRole(deps: Deps, req: Request, roles: string[]): Promise<AuthOutcome> {
  const cronSecret = req.headers.get("X-Cron-Secret");
  if (cronSecret) {
    const { data: setting } = await deps.admin
      .from("app_settings").select("value").eq("key", "cron_secret").is("org_id", null).maybeSingle();
    const stored = ((setting as { value?: string } | null)?.value as string | null) ?? "";
    if (!constantTimeEqual(cronSecret, stored)) return { ok: false, response: json({ error: "Unauthorized" }, 401) };
    return { ok: true, userId: null };
  }
  return requireRole(deps, req, roles);
}
