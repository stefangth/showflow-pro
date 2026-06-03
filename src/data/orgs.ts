import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
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
    .select("org_id, role, organizations ( id, name, slug, status )")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []) as unknown as Membership[];
}
