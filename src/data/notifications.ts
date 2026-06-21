import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Notification = Database["public"]["Tables"]["notifications"]["Row"];

/** Newest-N notifications fetched for the notification bell. */
export const NOTIFICATIONS_LIMIT = 50;

/** Fetch the newest notifications for a user (capped at NOTIFICATIONS_LIMIT). */
export async function fetchNotifications(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<Notification[]> {
  const { data, error } = await client
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(NOTIFICATIONS_LIMIT);
  if (error) throw error;
  return (data ?? []) as Notification[];
}

/** Mark a single notification read. */
export async function markNotificationRead(
  client: SupabaseClient<Database>,
  id: string,
): Promise<void> {
  const { error } = await client.from("notifications").update({ read: true }).eq("id", id);
  if (error) throw error;
}

/** Mark all of a user's unread notifications read. */
export async function markAllNotificationsRead(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from("notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) throw error;
}
