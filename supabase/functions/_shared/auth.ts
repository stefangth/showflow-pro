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
  // Constant-time compare so a timing side-channel can't leak the service-role key.
  return serviceKey !== "" && constantTimeEqual(authHeader, `Bearer ${serviceKey}`);
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
 * Used by org-scoped admin endpoints (e.g. airtable-schema) so an admin of one org
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

/**
 * Require a valid X-Cron-Secret and NOTHING else (cron-only endpoints).
 *
 * Use this for endpoints that must be driven by pg_cron alone — e.g. airtable-poll,
 * which loops EVERY active org and writes cross-org data, so a per-org admin JWT must
 * never be able to trigger it (a role-fallback here would be a cross-tenant hole).
 *
 * The cron secret lives in Supabase Vault (not member-readable app_settings — see
 * migration 20260702120010_cron_secret_to_vault.sql). PostgREST cannot reach the
 * vault/private schemas, so we read it through the service-role-only public RPC
 * `get_cron_secret`. Comparison stays constant-time to avoid a timing oracle.
 * A missing or mismatched header → 401.
 */
export async function requireCronSecret(deps: Deps, req: Request): Promise<AuthOutcome> {
  const cronSecret = req.headers.get("X-Cron-Secret");
  const { data: stored } = await deps.admin.rpc("get_cron_secret");
  const storedSecret = (stored as string | null) ?? "";
  if (!cronSecret || !constantTimeEqual(cronSecret, storedSecret)) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }
  return { ok: true, userId: null };
}

/**
 * Accept a valid X-Cron-Secret OR fall back to requireRole.
 *
 * When an X-Cron-Secret header is present it is validated via `requireCronSecret`
 * (constant-time, Vault-backed). Otherwise the caller must satisfy `requireRole`
 * for one of `roles` in ANY org — this coarse role fallback is safe only for
 * endpoints scoped to a single caller/org; cross-org fan-out endpoints must use
 * `requireCronSecret` directly.
 */
export async function requireCronOrRole(deps: Deps, req: Request, roles: string[]): Promise<AuthOutcome> {
  if (req.headers.get("X-Cron-Secret")) {
    return requireCronSecret(deps, req);
  }
  return requireRole(deps, req, roles);
}
