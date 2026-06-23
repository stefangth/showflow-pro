import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Organization } from "@/data/orgs";
import { BOOKING_ENGINE_DEFAULTS, type AppRole } from "@/config/app.config";

export interface OrgStat {
  org_id: string;
  name: string;
  slug: string;
  status: string;
  member_count: number;
  active_artist_count: number;
  bookings_30d: number;
  last_activity_at: string | null;
}

export interface PlatformAdmin {
  user_id: string;
  email: string;
  created_at: string;
}

export interface StarterCatalogTemplate {
  skills: string[];
  cities: string[];
  casts: { name: string; description: string | null }[];
}

export const EMPTY_STARTER_TEMPLATE: StarterCatalogTemplate = { skills: [], cities: [], casts: [] };

/** True if the user is a platform (super) admin. */
export async function fetchIsSuperAdmin(client: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data, error } = await client.rpc("is_super_admin", { _uid: userId });
  if (error) throw error;
  return data === true;
}

export interface CronHealthRow {
  job_name: string;
  schedule: string | null;
  status: "healthy" | "failing" | "stale" | "unknown";
  last_status_code: number | null;
  last_ok_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  last_run_at: string | null;
  recent_failures: { status_code: number | null; error: string | null; observed_at: string }[];
}

/** Per-cron health for the platform System Health tab (super-admin only, enforced inside the RPC). */
export async function fetchCronHealth(client: SupabaseClient<Database>): Promise<CronHealthRow[]> {
  // get_cron_health is a SECURITY DEFINER RPC added alongside the cron-health tables; the
  // generated Database type lags new RPCs, so it is called untyped at this data-access boundary.
  const rpc = client.rpc as unknown as (fn: string) => PromiseLike<{ data: CronHealthRow[] | null; error: { message: string } | null }>;
  const { data, error } = await rpc("get_cron_health");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Every organization (super-admin only; RLS short-circuits is_org_member). */
export async function fetchAllOrgs(client: SupabaseClient<Database>): Promise<Organization[]> {
  const { data, error } = await client.from("organizations").select("id, name, slug, status").order("name");
  if (error) throw error;
  return (data ?? []) as Organization[];
}

/** Per-org usage metrics (super-admin only). */
export async function fetchPlatformOrgStats(client: SupabaseClient<Database>): Promise<OrgStat[]> {
  const { data, error } = await client.rpc("platform_org_stats");
  if (error) throw error;
  return (data ?? []) as unknown as OrgStat[];
}

/** Provision a new org + seed catalog + invite first admin (super-admin only). Returns org_id. */
export async function provisionOrg(
  client: SupabaseClient<Database>,
  args: { name: string; slug: string; adminEmail: string; role?: AppRole; appOrigin: string },
): Promise<string> {
  const { data, error } = await client.functions.invoke("provision-org", {
    body: { name: args.name, slug: args.slug, admin_email: args.adminEmail, role: args.role ?? "admin", app_origin: args.appOrigin },
  });
  if (error) throw error;
  const payload = data as { error?: string; org_id?: string };
  if (payload?.error) throw new Error(payload.error);
  if (!payload?.org_id) throw new Error("Org was not created");
  return payload.org_id;
}

/** Suspend / reactivate an org (super-admin only via organizations RLS). */
export async function setOrgStatus(client: SupabaseClient<Database>, orgId: string, status: "active" | "suspended"): Promise<void> {
  const { error } = await client.from("organizations").update({ status }).eq("id", orgId);
  if (error) throw error;
}

/** Edit an org's name / slug (super-admin only). */
export async function updateOrg(client: SupabaseClient<Database>, orgId: string, patch: { name?: string; slug?: string }): Promise<void> {
  const { error } = await client.from("organizations").update(patch).eq("id", orgId);
  if (error) throw error;
}

export async function fetchPlatformAdmins(client: SupabaseClient<Database>): Promise<PlatformAdmin[]> {
  const { data, error } = await client.rpc("list_platform_admins");
  if (error) throw error;
  return (data ?? []) as unknown as PlatformAdmin[];
}

export async function addPlatformAdmin(client: SupabaseClient<Database>, email: string): Promise<void> {
  const { error } = await client.rpc("add_platform_admin", { p_email: email });
  if (error) throw error;
}

export async function removePlatformAdmin(client: SupabaseClient<Database>, userId: string): Promise<void> {
  const { error } = await client.rpc("remove_platform_admin", { p_user_id: userId });
  if (error) throw error;
}

/** Upsert a platform-default setting (org_id IS NULL). Super-admin only via app_settings RLS. */
export async function savePlatformSetting(client: SupabaseClient<Database>, key: string, value: Json): Promise<void> {
  const { error } = await client.from("app_settings").upsert({ org_id: null, key, value }, { onConflict: "org_id,key" });
  if (error) throw error;
}

/**
 * Shape of the platform/org booking-engine settings, derived from
 * BOOKING_ENGINE_DEFAULTS so the type can't drift from the constant:
 * numeric keys -> number, string keys -> string.
 */
export type BookingEngineDefaults = {
  -readonly [K in keyof typeof BOOKING_ENGINE_DEFAULTS]:
    (typeof BOOKING_ENGINE_DEFAULTS)[K] extends number ? number : string;
};

const BOOKING_DEFAULT_KEYS = Object.keys(BOOKING_ENGINE_DEFAULTS) as (keyof BookingEngineDefaults)[];

/**
 * Read the platform-default (org_id IS NULL) booking-engine settings in one
 * query, falling back to the canonical code defaults for any key without a row.
 * Powers the super-admin Platform → Defaults form.
 */
export async function fetchPlatformBookingDefaults(
  client: SupabaseClient<Database>,
): Promise<BookingEngineDefaults> {
  const { data, error } = await client
    .from("app_settings")
    .select("key, value")
    .is("org_id", null)
    .in("key", BOOKING_DEFAULT_KEYS as string[]);
  if (error) throw error;
  const byKey = new Map(
    ((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]),
  );
  const out: BookingEngineDefaults = { ...BOOKING_ENGINE_DEFAULTS };
  for (const key of BOOKING_DEFAULT_KEYS) {
    const v = byKey.get(key);
    // app_settings.value is JSONB (unknown at the type level); coerce to the declared
    // kind so a value stored as e.g. "48" doesn't land mistyped as a string.
    if (v !== undefined && v !== null) {
      (out as unknown as Record<string, unknown>)[key] =
        key === "resend_from_address" ? String(v) : Number(v);
    }
  }
  return out;
}

/**
 * Upsert ALL four platform-default booking-engine settings in one call (super-admin only).
 * Writes every key (even unchanged ones), so saving materializes platform rows for keys
 * that previously fell through to the code defaults — i.e. "Save" freezes the current
 * values as explicit platform defaults. Intended: this is the form for setting them.
 */
export async function savePlatformBookingDefaults(
  client: SupabaseClient<Database>,
  values: BookingEngineDefaults,
): Promise<void> {
  const rows = BOOKING_DEFAULT_KEYS.map((key) => ({
    org_id: null as string | null,
    key: key as string,
    value: values[key] as Json,
  }));
  const { error } = await client.from("app_settings").upsert(rows, { onConflict: "org_id,key" });
  if (error) throw error;
}

/** Export an org's full dataset as a JSON bundle (super-admin only). */
export async function exportOrgData(client: SupabaseClient<Database>, orgId: string): Promise<unknown> {
  const { data, error } = await client.functions.invoke("export-org-data", { body: { org_id: orgId } });
  if (error) throw error;
  const payload = data as { error?: string; bundle?: unknown } | null;
  if (payload?.error) throw new Error(payload.error);
  return payload?.bundle;
}

/** Permanently delete an org and all its data (super-admin only, hard teardown). */
export async function deleteOrg(client: SupabaseClient<Database>, orgId: string): Promise<void> {
  const { error } = await client.rpc("delete_org", { p_org: orgId });
  if (error) throw error;
}
