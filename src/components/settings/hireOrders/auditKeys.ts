/**
 * Every app_settings key this tab owns, exactly as spec §2.6. Consumed by the rail's
 * useSettingsAudit for the change-history panel. Mirrors BOOKING_AUDIT_KEYS in shape
 * and purpose (BookingFlowTab.tsx:29-36). Unlike that tab, each card here saves
 * itself independently (the PlatformDefaultsTab idiom), so this list has no
 * page-level dirty-tracking counterpart to feed.
 */
export const HIRE_ORDER_AUDIT_KEYS = [
  "hire_order_letterhead",
  "hire_order_terms",
  "hire_order_numbering",
  "hire_order_defaults",
  "hire_order_countersign",
];
