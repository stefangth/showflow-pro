import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface MyProfile {
  user_id: string;
  display_name: string | null;
  phone: string | null;
}

/** The signed-in user's global profile row (or null). */
export async function fetchMyProfile(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<MyProfile | null> {
  const { data, error } = await client
    .from("profiles")
    .select("user_id, display_name, phone")
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

export async function fetchMyHasPassword(client: SupabaseClient<Database>): Promise<boolean> {
  const { data, error } = await client.rpc("my_has_password");
  if (error) throw error;
  return data;
}

export async function setMyPassword(client: SupabaseClient<Database>, password: string): Promise<void> {
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}

export async function requestPasswordReauthentication(client: SupabaseClient<Database>): Promise<void> {
  const { error } = await client.auth.reauthenticate();
  if (error) throw error;
}

export async function changeMyPassword(
  client: SupabaseClient<Database>,
  args: { password: string; currentPassword?: string; nonce?: string },
): Promise<void> {
  const attributes = {
    password: args.password,
    ...(args.currentPassword !== undefined ? { current_password: args.currentPassword } : {}),
    ...(args.nonce !== undefined ? { nonce: args.nonce } : {}),
  };
  const { error } = await client.auth.updateUser(attributes);
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
