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
): Promise<{ org_id?: string }> {
  const { data, error } = await client.functions.invoke("demo-ops", { body });
  if (error) throw error;
  const payload = data as { error?: string; org_id?: string; ok?: boolean } | null;
  if (payload?.error) throw new Error(payload.error);
  return payload ?? {};
}

/** Wipe a demo org's data then reseed it (org-admin action). */
export function resetDemoOrg(
  client: SupabaseClient<Database>,
  args: { orgId: string; volume: "small" | "full" },
) {
  return invokeDemoOps(client, { action: "reset", org_id: args.orgId, volume: args.volume });
}

/** Wipe a demo org's data without reseeding (org-admin action). */
export function wipeDemoOrg(client: SupabaseClient<Database>, args: { orgId: string }) {
  return invokeDemoOps(client, { action: "wipe", org_id: args.orgId });
}

/**
 * Create a brand-new demo org: provision it via the battle-tested
 * provision-org flow (org + first-admin account + membership + invite
 * email), then flag it `is_demo` and seed it via demo-ops.
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
  await invokeDemoOps(client, { action: "flag_and_seed", org_id: orgId, volume: args.volume });
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
