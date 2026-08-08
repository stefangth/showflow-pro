/**
 * Every app_settings key the booking-flow tab owns. SettingsPage filters its
 * page-level dirtyKeys against this list to drive the rail's Save/Discard, and
 * the tab feeds it to useSettingsAudit for the change-history panel.
 */
export const BOOKING_AUDIT_KEYS = [
  "booking_flow",
  "offer_response_window_hours",
  "offer_digest_hour_berlin",
  "confirmation_digest_hour_berlin",
  "resend_from_address",
];
