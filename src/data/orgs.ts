import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { coerceOrgKind, type OrgKind } from "@/lib/orgKind";

type AppRole = Database["public"]["Enums"]["app_role"];

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  is_demo: boolean;
  /** Workspace type. Drives vocabulary and presentation only (src/lib/orgKind.ts). */
  org_kind: OrgKind;
  /** When the kind was explicitly chosen; null while still on the default. */
  org_kind_set_at: string | null;
}

export interface Membership {
  org_id: string;
  role: AppRole;
  organizations: Organization | null;
}

/** All org memberships for an auth user, with the joined organization. */
export async function fetchMyMemberships(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<Membership[]> {
  const { data, error } = await client
    .from("org_memberships")
    .select("org_id, role, organizations ( id, name, slug, status, is_demo, org_kind, org_kind_set_at )")
    .eq("user_id", userId);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Membership[];
  return rows.map((m) => (m.organizations
    ? { ...m, organizations: { ...m.organizations, org_kind: coerceOrgKind(m.organizations.org_kind) } }
    : m));
}

/** Set the org's workspace type (admin-only RPC; super-admins pass). Stamps org_kind_set_at. */
export async function setOrgKind(
  client: SupabaseClient<Database>,
  orgId: string,
  kind: OrgKind,
): Promise<void> {
  const { error } = await client.rpc("set_org_kind", { p_org: orgId, p_kind: kind });
  if (error) throw error;
}

export interface OrgProducer {
  user_id: string;
  display_name: string | null;
}

/**
 * Producers + admins of an org (the users a show can be assigned to), with their
 * profile display names. Org-scoped replacement for the old global user_roles read.
 */
export async function fetchOrgProducers(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<OrgProducer[]> {
  const { data: roleRows, error: roleErr } = await client
    .from("org_memberships")
    .select("user_id")
    .eq("org_id", orgId)
    .in("role", ["producer", "admin"]);
  if (roleErr) throw roleErr;

  const userIds = Array.from(new Set((roleRows ?? []).map((r) => (r as { user_id: string }).user_id)));
  if (userIds.length === 0) return [];

  const { data: profileRows, error: profErr } = await client
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", userIds);
  if (profErr) throw profErr;

  return (profileRows ?? []) as OrgProducer[];
}

/** Rename the caller's org (admin-only RPC; name only — slug is left unchanged). */
export async function renameOrg(
  client: SupabaseClient<Database>,
  orgId: string,
  name: string,
): Promise<void> {
  const { error } = await client.rpc("rename_org", { p_org: orgId, p_name: name });
  if (error) throw error;
}
