import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { provisionOrg } from "@/data/platform";

export interface CapturedSend {
  id: string;
  org_id: string;
  kind: "email" | "pdf";
  to_label: string | null;
  subject: string | null;
  preview_html: string | null;
  storage_path: string | null;
  created_at: string;
}

async function invokeDemoOps(
  client: SupabaseClient<Database>,
  body: Record<string, unknown>,
): Promise<{ org_id?: string; ok?: boolean; token?: string; expires_at?: string }> {
  const { data, error } = await client.functions.invoke("demo-ops", { body });
  if (error) throw error;
  const payload = data as
    | { error?: string; org_id?: string; ok?: boolean; token?: string; expires_at?: string }
    | null;
  if (payload?.error) throw new Error(payload.error);
  return payload ?? {};
}

/**
 * Wipe a demo org's data then reseed it (org-admin action). `resetState` also clears
 * the rep's scene position, sim clock, and prospect label — pass it for the "restart
 * for a new prospect" Reset, omit it for a data-only volume change that keeps place.
 */
export function resetDemoOrg(
  client: SupabaseClient<Database>,
  args: { orgId: string; volume: "small" | "full"; resetState?: boolean },
) {
  return invokeDemoOps(client, {
    action: "reset",
    org_id: args.orgId,
    volume: args.volume,
    reset_state: args.resetState ?? false,
  });
}

/** Wipe a demo org's data without reseeding (org-admin action). */
export function wipeDemoOrg(client: SupabaseClient<Database>, args: { orgId: string }) {
  return invokeDemoOps(client, { action: "wipe", org_id: args.orgId });
}

/**
 * Create a brand-new demo org: provision it via the battle-tested
 * provision-org flow (org + first-admin account + membership + invite
 * email), then flag it `is_demo` and seed it via demo-ops.
 *
 * If `flag_and_seed` fails after `provisionOrg` already succeeded, the org would
 * otherwise be left half-baked (starter catalog only, never seeded). We can't undo
 * the invite email that was already sent, but we DO best-effort `delete_org` the
 * just-created org so it doesn't linger in Platform — the blast radius is exactly
 * the empty org we made moments ago. The original error is always rethrown so the
 * caller surfaces the real failure; a failed cleanup is logged, not masked.
 */
export async function createDemoOrg(
  client: SupabaseClient<Database>,
  args: { name: string; slug: string; adminEmail: string; appOrigin: string; volume: "small" | "full" },
): Promise<string> {
  const orgId = await provisionOrg(client, {
    name: args.name,
    slug: args.slug,
    adminEmail: args.adminEmail,
    role: "admin",
    appOrigin: args.appOrigin,
    features: { hire_orders: true, booking_flow: true },
  });
  try {
    await invokeDemoOps(client, { action: "flag_and_seed", org_id: orgId, volume: args.volume });
  } catch (err) {
    const { error: cleanupErr } = await client.rpc("delete_org", { p_org: orgId });
    if (cleanupErr) console.error("createDemoOrg: cleanup delete_org failed", { orgId, error: cleanupErr });
    throw err;
  }
  return orgId;
}

/** Read a demo org's captured-send outbox (diverted emails/PDFs), newest-first. */
export async function fetchCapturedSends(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<CapturedSend[]> {
  const { data, error } = await client
    .from("demo_captured_sends")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CapturedSend[];
}

export interface DemoStateRow {
  org_id: string;
  volume: "small" | "full";
  prospect_label: string | null;
  sim_now: string | null;
  current_scene_id: string | null;
  script_id: string | null;
  updated_at: string;
}

/** Read a demo org's simulation state (volume, prospect label, sim clock, current scene/script). */
export async function fetchDemoState(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<DemoStateRow | null> {
  const { data, error } = await client
    .from("demo_state")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as DemoStateRow | null;
}

/** Upsert a demo org's simulation state (org-admin action, drives the demo rail). */
export async function updateDemoState(
  client: SupabaseClient<Database>,
  args: {
    orgId: string;
    patch: Partial<Pick<DemoStateRow, "volume" | "prospect_label" | "sim_now" | "current_scene_id" | "script_id">>;
  },
): Promise<void> {
  const { error } = await client
    .from("demo_state")
    .upsert({ org_id: args.orgId, ...args.patch }, { onConflict: "org_id" });
  if (error) throw error;
}

/** Fire a scripted demo cue (advances the current scene, may mutate domain data). */
export function runCue(client: SupabaseClient<Database>, args: { orgId: string; cueId: string }) {
  return invokeDemoOps(client, { action: "cue", org_id: args.orgId, cue_id: args.cueId });
}

export interface SandboxLink {
  id: string;
  org_id: string;
  token: string;
  expires_at: string;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
}

/**
 * A curated, display-safe read-only snapshot of a demo org, returned by the
 * public `sandbox-view` edge function. This shape is hand-synced (no
 * generator) with the object built in `supabase/functions/sandbox-view/index.ts`
 * (`buildSnapshot`) — update both together.
 */
export interface SandboxSnapshot {
  org: { label: string; volume: "small" | "full" };
  generatedAt: string;
  kpis: {
    upcomingDates: number;
    confirmedBookings: number;
    fillRate: number;
    hireOrdersIssued: number;
  };
  shows: Array<{ label: string }>;
  dates: Array<{
    id: string;
    date: string;
    showLabel: string;
    city: string | null;
    status: string;
    filled: number;
    needed: number;
  }>;
  bookingsByStatus: Record<string, number>;
  hireOrders: Array<{
    status: string;
    showLabel: string | null;
    dateOn: string | null;
  }>;
}

/** Read a demo org's sandbox links (leave-behind read-only URLs), newest-first. */
export async function fetchSandboxLinks(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<SandboxLink[]> {
  const { data, error } = await client
    .from("demo_sandbox_links")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as SandboxLink[];
}

/** Mint a new sandbox link for a demo org (org-admin action). */
export async function createSandboxLink(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<{ token: string; expires_at: string }> {
  const payload = await invokeDemoOps(client, { action: "link_create", org_id: orgId });
  return { token: payload.token as string, expires_at: payload.expires_at as string };
}

/** Revoke a sandbox link (org-admin action, idempotent). */
export function revokeSandboxLink(
  client: SupabaseClient<Database>,
  args: { orgId: string; token: string },
) {
  return invokeDemoOps(client, { action: "link_revoke", org_id: args.orgId, token: args.token });
}

/**
 * Fetch a sandbox snapshot via the public `sandbox-view` function. Never
 * throws on an `ok:false` response (not_found/revoked/expired) — the caller
 * (the sandbox viewer page) drives its empty/error state off `reason`.
 */
export async function fetchSandboxSnapshot(
  client: SupabaseClient<Database>,
  token: string,
): Promise<{ ok: boolean; reason?: string; snapshot?: SandboxSnapshot }> {
  const { data, error } = await client.functions.invoke("sandbox-view", { body: { token } });
  if (error) {
    // A 404/410 from the function surfaces as a FunctionsHttpError with the
    // raw Response on `context` — recover the JSON body it carries.
    const ctx = (error as { context?: Response }).context;
    if (ctx) {
      try {
        return (await ctx.json()) as { ok: boolean; reason?: string; snapshot?: SandboxSnapshot };
      } catch {
        // fall through to the generic reason below
      }
    }
    return { ok: false, reason: "not_found" };
  }
  return data as { ok: boolean; reason?: string; snapshot?: SandboxSnapshot };
}
