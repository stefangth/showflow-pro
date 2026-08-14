import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Organization } from "@/data/orgs";
import type { EdgeFnMetric, EmailHealth } from "@/lib/systemHealth";
import type { HealthDay } from "@/lib/uptime";
import { SYSTEM_HEALTH, type AppRole } from "@/config/app.config";
import type { EntitlementRow, FeatureKey } from "@/lib/entitlements";
import {
  normalizeBookingFlowTemplates,
  type BookingFlowTemplates,
} from "@/lib/bookingFlow";

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

export interface CronFailure {
  status_code: number | null;
  error: string | null;
  observed_at: string;
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
  recentFailures: CronFailure[];
}

/** Per-cron health for the platform System Health tab (super-admin only, enforced inside the RPC). */
export async function fetchCronHealth(client: SupabaseClient<Database>): Promise<CronHealthRow[]> {
  // get_cron_health is a SECURITY DEFINER RPC added alongside the cron-health tables; the generated
  // Database type lags new RPCs, so the name is cast and the result is cast at this boundary — same
  // shape as fetchPlatformOrgStats below.
  const { data, error } = await client.rpc("get_cron_health" as never);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const failures = Array.isArray(row.recent_failures) ? row.recent_failures : [];
    return {
      job_name: String(row.job_name ?? ""),
      schedule: typeof row.schedule === "string" ? row.schedule : null,
      status: row.status === "healthy" || row.status === "failing" || row.status === "stale" || row.status === "unknown"
        ? row.status
        : "unknown",
      last_status_code: typeof row.last_status_code === "number" ? row.last_status_code : null,
      last_ok_at: typeof row.last_ok_at === "string" ? row.last_ok_at : null,
      last_error: typeof row.last_error === "string" ? row.last_error : null,
      consecutive_failures: Number(row.consecutive_failures ?? 0),
      last_run_at: typeof row.last_run_at === "string" ? row.last_run_at : null,
      recentFailures: failures.flatMap((failure) => {
        if (!failure || typeof failure !== "object") return [];
        const record = failure as Record<string, unknown>;
        if (typeof record.observed_at !== "string") return [];
        return [{
          status_code: typeof record.status_code === "number" ? record.status_code : null,
          error: typeof record.error === "string" ? record.error : null,
          observed_at: record.observed_at,
        }];
      }),
    };
  });
}

/** Daily health rollup for the System Health uptime bar (super-admin only, enforced in the RPC).
 *  Returns one row per (day, function) for days that actually recorded traffic — days with no
 *  row are absent, and the bar renders them as "no data" rather than as uptime. */
export async function fetchHealthDaily(
  client: SupabaseClient<Database>,
  days: number = SYSTEM_HEALTH.uptimeDays,
): Promise<HealthDay[]> {
  const { data, error } = await client.rpc("get_health_daily", { p_days: days });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    day: row.day,
    fn: row.fn,
    runs: row.runs,
    failures: row.failures,
    rejected: row.rejected,
    unauthorized: row.unauthorized,
    // Nullable in the table: an idle day has no status code and no latency sample. Coercing
    // either to 0 would print "HTTP 0" / "0.0s" as though they were measurements.
    worst_status: row.worst_status,
    p95_ms: row.p95_ms,
  }));
}

/** Edge-function metrics for the System Health tab, via the super-admin platform-edge-metrics
 *  proxy (Supabase Analytics API). Returns one row per function over the lookback window. */
export async function fetchEdgeFnMetrics(
  client: SupabaseClient<Database>,
  windowMinutes: number = SYSTEM_HEALTH.windowMinutes,
): Promise<EdgeFnMetric[]> {
  const { data, error } = await client.functions.invoke("platform-edge-metrics", {
    body: { window_minutes: windowMinutes },
  });
  if (error) throw error;
  return (data as { functions?: EdgeFnMetric[] } | null)?.functions ?? [];
}

/** One console log line from a function's recent error/warning output. */
export interface EdgeFnLogLine { at: string; level: string; message: string }

/** Recent error/warning log lines for a single edge function. Fetched on demand
 *  (row expand), never on the panel's refresh cycle — see the note in the edge
 *  function about the ANALYTICS PAT rate limit. */
export async function fetchEdgeFnLogs(
  client: SupabaseClient<Database>,
  fn: string,
  windowMinutes: number = SYSTEM_HEALTH.windowMinutes,
): Promise<EdgeFnLogLine[]> {
  const { data, error } = await client.functions.invoke("platform-edge-metrics", {
    body: { action: "logs", fn, window_minutes: windowMinutes },
  });
  if (error) throw error;
  return (data as { lines?: EdgeFnLogLine[] } | null)?.lines ?? [];
}

/** Email-delivery health for the System Health tab (super-admin only, enforced inside the RPC).
 *  Maps get_email_health's snake_case jsonb (incl. nested by_template/recent_issues) to the
 *  camelCase EmailHealth the panel consumes — a mapping, not a bare cast, so shape drift in the
 *  RPC surfaces as a type error here rather than silently reaching the UI. */
export async function fetchEmailHealth(
  client: SupabaseClient<Database>,
  windowMinutes: number,
): Promise<EmailHealth> {
  // get_email_health is a SECURITY DEFINER RPC added alongside the email-delivery tables; the
  // generated Database type lags new RPCs, so the name is cast here — same idiom as
  // fetchCronHealth above.
  const { data, error } = await client.rpc(
    "get_email_health" as never,
    { p_window_minutes: windowMinutes } as never,
  );
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  const byTemplate = (d.by_template ?? []) as Record<string, unknown>[];
  const recentIssues = (d.recent_issues ?? []) as Record<string, unknown>[];
  return {
    attempted: Number(d.attempted ?? 0),
    sent: Number(d.sent ?? 0),
    delivered: Number(d.delivered ?? 0),
    delayed: Number(d.delayed ?? 0),
    bounced: Number(d.bounced ?? 0),
    complained: Number(d.complained ?? 0),
    failed: Number(d.failed ?? 0),
    suppressed: Number(d.suppressed ?? 0),
    deliveryRate: Number(d.delivery_rate ?? 0),
    bounceRate: Number(d.bounce_rate ?? 0),
    complaintRate: Number(d.complaint_rate ?? 0),
    failureCount: Number(d.failure_count ?? 0),
    lastEventAt: (d.last_event_at as string | null | undefined) ?? null,
    byTemplate: byTemplate.map((t) => ({
      templateName: t.template_name as string,
      sent: Number(t.sent ?? 0),
      delivered: Number(t.delivered ?? 0),
      bounced: Number(t.bounced ?? 0),
      failed: Number(t.failed ?? 0),
      deliveryRate: Number(t.delivery_rate ?? 0),
    })),
    recentIssues: recentIssues.map((i) => ({
      recipientEmail: i.recipient_email as string,
      templateName: i.template_name as string,
      status: i.status as string,
      errorMessage: (i.error_message as string | null | undefined) ?? null,
      occurredAt: i.occurred_at as string,
    })),
  };
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

/** Provision a new org + seed catalog + invite first admin (super-admin only). Returns org_id.
 *  `features`, when passed, selects which module entitlements the new org starts with and is
 *  forwarded as `entitlements` in the request body for the edge function to seed. */
export async function provisionOrg(
  client: SupabaseClient<Database>,
  args: { name: string; slug: string; adminEmail: string; role?: AppRole; appOrigin: string; features?: Record<FeatureKey, boolean> },
): Promise<string> {
  const { data, error } = await client.functions.invoke("provision-org", {
    body: {
      name: args.name,
      slug: args.slug,
      admin_email: args.adminEmail,
      role: args.role ?? "admin",
      app_origin: args.appOrigin,
      ...(args.features ? { entitlements: args.features } : {}),
    },
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

export async function fetchPlatformBookingTemplates(
  client: SupabaseClient<Database>,
): Promise<BookingFlowTemplates> {
  const { data, error } = await client
    .from("app_settings")
    .select("value")
    .eq("key", "booking_flow_templates")
    .is("org_id", null)
    .maybeSingle();
  if (error) throw error;
  return normalizeBookingFlowTemplates((data as { value?: unknown } | null)?.value);
}

export async function savePlatformBookingTemplates(
  client: SupabaseClient<Database>,
  templates: BookingFlowTemplates,
): Promise<void> {
  const value = normalizeBookingFlowTemplates(templates) as unknown as Json;
  const { error } = await client.from("app_settings").upsert(
    { org_id: null, key: "booking_flow_templates", value },
    { onConflict: "org_id,key" },
  );
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

/** Toggle a single feature entitlement for an org (upsert on org_id+feature). Super-admin only via org_entitlements RLS. */
export async function setOrgEntitlement(
  client: SupabaseClient<Database>,
  orgId: string,
  feature: FeatureKey,
  enabled: boolean,
): Promise<void> {
  const { error } = await client
    .from("org_entitlements")
    .upsert({ org_id: orgId, feature, enabled }, { onConflict: "org_id,feature" });
  if (error) throw error;
}

/** Every org's feature entitlement rows (platform fleet view, super-admin only). */
export async function fetchAllOrgEntitlements(
  client: SupabaseClient<Database>,
): Promise<Array<{ org_id: string } & EntitlementRow>> {
  const { data, error } = await client.from("org_entitlements").select("org_id, feature, enabled");
  if (error) throw error;
  return (data ?? []) as Array<{ org_id: string } & EntitlementRow>;
}

/** Toggle a single capability for an org (upsert on org_id+capability). Super-admin only via org_capabilities RLS. */
export async function setOrgCapability(
  client: SupabaseClient<Database>,
  orgId: string,
  capability: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await client
    .from("org_capabilities")
    .upsert({ org_id: orgId, capability, enabled }, { onConflict: "org_id,capability" });
  if (error) throw error;
}
