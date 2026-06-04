import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Organization } from "@/data/orgs";
import type { AppRole } from "@/config/app.config";

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

/** Re-send a first-admin invitation email. */
export async function resendInvitation(client: SupabaseClient<Database>, invitationId: string): Promise<void> {
  const { error } = await client.functions.invoke("resend-invitation", { body: { invitation_id: invitationId } });
  if (error) throw error;
}

/** Upsert a platform-default setting (org_id IS NULL). Super-admin only via app_settings RLS. */
export async function savePlatformSetting(client: SupabaseClient<Database>, key: string, value: Json): Promise<void> {
  const { error } = await client.from("app_settings").upsert({ org_id: null, key, value }, { onConflict: "org_id,key" });
  if (error) throw error;
}
