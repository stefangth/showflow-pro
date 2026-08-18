import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/notificationCategories";

/** Categories never delivered to artists (Production Team only). */
export const PRODUCER_ONLY_CATEGORIES: readonly NotificationCategory[] = ["booking_activity", "at_risk"];

/**
 * The categories to render for a viewer's notification matrix. Artists drop the
 * producer-only categories entirely (they are never sent to artists, so showing
 * them as choices would be misleading) — producers/admins keep the full set.
 */
export function visibleNotificationCategories(opts: { isArtistOnly: boolean }) {
  if (!opts.isArtistOnly) return [...NOTIFICATION_CATEGORIES];
  return NOTIFICATION_CATEGORIES.filter((c) => !PRODUCER_ONLY_CATEGORIES.includes(c.key));
}
