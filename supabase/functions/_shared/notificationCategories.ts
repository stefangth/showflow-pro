// Single source of truth for notification categories (GDPR notification prefs).
// Pure + dependency-free so it runs in Deno (edge gate) and the browser (re-export),
// mirroring the identity.ts pattern. The SQL category_of()/should_notify() functions
// mirror IN_APP_TYPE_CATEGORY — keep them in sync.

export const NOTIFICATION_CATEGORIES = [
  { key: "booking_offers", label: "Booking offers", description: "New offers awaiting your response" },
  { key: "booking_confirmations", label: "Booking confirmations", description: "When one of your bookings is confirmed" },
  { key: "booking_activity", label: "Booking activity", description: "Producer updates — artists accepting offers" },
  { key: "schedule_changes", label: "Schedule changes", description: "Date, session, and cancellation changes" },
  { key: "at_risk", label: "At-risk & escalations", description: "Tiers at risk of going unfilled and cast escalations" },
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]["key"];

export const NOTIFICATION_CHANNELS = ["email", "in_app"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** In-app `notifications.type` value -> category. Unmapped types are always delivered. */
export const IN_APP_TYPE_CATEGORY: Record<string, NotificationCategory> = {
  booking_confirmed: "booking_confirmations",
  booking_ready_to_confirm: "booking_activity",
  schedule_change: "schedule_changes",
  session_added: "schedule_changes",
  session_removed: "schedule_changes",
  session_retimed: "schedule_changes",
  cancelled: "schedule_changes",
  tier_at_risk: "at_risk",
  cast_escalation_requested: "at_risk",
  offer_expiring: "booking_offers",
  tier_escalated: "at_risk",
};

/** Email `template_name` -> category. Unmapped templates (invites, password reset) always send. */
export const EMAIL_TEMPLATE_CATEGORY: Record<string, NotificationCategory> = {
  "artist-offer-digest": "booking_offers",
  "offer-immediate": "booking_offers",
  "offer-expiry-reminder": "booking_offers",
  "artist-confirmation-digest": "booking_confirmations",
  "cast-escalation-requested": "at_risk",
};

/** The category for an email template, or null when it is critical/uncategorized (always send). */
export function categoryForTemplate(templateName: string): NotificationCategory | null {
  return EMAIL_TEMPLATE_CATEGORY[templateName] ?? null;
}
