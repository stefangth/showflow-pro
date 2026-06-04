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

/**
 * Change the signed-in user's password. Supabase's updateUser does NOT verify the
 * current password, so we re-authenticate with it first (a wrong password fails here,
 * before any change is made).
 */
export async function updateMyPassword(
  client: SupabaseClient<Database>,
  args: { email: string; currentPassword: string; newPassword: string },
): Promise<void> {
  const { error: verifyErr } = await client.auth.signInWithPassword({
    email: args.email,
    password: args.currentPassword,
  });
  if (verifyErr) throw new Error("Current password is incorrect");
  const { error } = await client.auth.updateUser({ password: args.newPassword });
  if (error) throw error;
}

/** Send a password-recovery email (Supabase built-in), returning the user to `redirectTo`. */
export async function requestPasswordReset(
  client: SupabaseClient<Database>,
  email: string,
  redirectTo: string,
): Promise<void> {
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

/** Set a new password for the user in the current (recovery/invite) session. */
export async function setNewPassword(client: SupabaseClient<Database>, newPassword: string): Promise<void> {
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
