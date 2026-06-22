import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { NotificationCategory, NotificationChannel } from "@/lib/notificationCategories";

export type NotificationPrefs = Partial<
  Record<NotificationCategory, Partial<Record<NotificationChannel, boolean>>>
>;

/** The current user's notification preferences map ({} = all defaults / enabled). */
export async function fetchMyNotificationPreferences(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<NotificationPrefs> {
  const { data, error } = await client
    .from("notification_preferences")
    .select("prefs")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return ((data?.prefs ?? {}) as NotificationPrefs);
}

/** Upsert the full prefs map for the current user. */
export async function updateMyNotificationPreferences(
  client: SupabaseClient<Database>,
  userId: string,
  prefs: NotificationPrefs,
): Promise<void> {
  const { error } = await client
    .from("notification_preferences")
    .upsert({ user_id: userId, prefs: prefs as never }, { onConflict: "user_id" });
  if (error) throw error;
}
