import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface MyProfile {
  user_id: string;
  display_name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
}

/** The signed-in user's global profile row (or null). */
export async function fetchMyProfile(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<MyProfile | null> {
  const { data, error } = await client
    .from("profiles")
    .select("user_id, display_name, phone, email, avatar_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as MyProfile | null) ?? null;
}

/** Update the editable profile fields for the signed-in user. */
export async function updateMyProfile(
  client: SupabaseClient<Database>,
  userId: string,
  patch: { display_name?: string | null; phone?: string | null },
): Promise<void> {
  const { error } = await client.from("profiles").update(patch).eq("user_id", userId);
  if (error) throw error;
}
