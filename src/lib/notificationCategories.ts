// Re-export the shared category model so the UI and the edge gate never diverge
// (mirrors src/lib/identity.ts).
export {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  IN_APP_TYPE_CATEGORY,
  EMAIL_TEMPLATE_CATEGORY,
  categoryForTemplate,
  type NotificationCategory,
  type NotificationChannel,
} from "../../supabase/functions/_shared/notificationCategories.ts";
