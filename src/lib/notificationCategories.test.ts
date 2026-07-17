import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  IN_APP_TYPE_CATEGORY,
  categoryForTemplate,
} from "./notificationCategories";

describe("notification category model", () => {
  it("exposes six categories and two channels", () => {
    expect(NOTIFICATION_CATEGORIES.map((c) => c.key)).toEqual([
      "booking_offers", "booking_confirmations", "booking_activity", "schedule_changes", "at_risk", "hire_orders",
    ]);
    expect(NOTIFICATION_CHANNELS).toEqual(["email", "in_app"]);
  });

  it("maps known in-app types and email templates to categories", () => {
    expect(IN_APP_TYPE_CATEGORY["booking_confirmed"]).toBe("booking_confirmations");
    expect(IN_APP_TYPE_CATEGORY["tier_at_risk"]).toBe("at_risk");
    expect(IN_APP_TYPE_CATEGORY["offer_expiring"]).toBe("booking_offers");
    expect(IN_APP_TYPE_CATEGORY["tier_escalated"]).toBe("at_risk");
    expect(categoryForTemplate("artist-offer-digest")).toBe("booking_offers");
  });

  it("returns null for critical/unmapped templates (always send)", () => {
    expect(categoryForTemplate("org-invitation")).toBeNull();
    expect(categoryForTemplate("new-signup-admin-notification")).toBeNull();
  });

  it("maps the three hire-orders in-app types and the hire-order-issued template to hire_orders", () => {
    expect(IN_APP_TYPE_CATEGORY["hire_orders_ready"]).toBe("hire_orders");
    expect(IN_APP_TYPE_CATEGORY["hire_order_issued"]).toBe("hire_orders");
    expect(IN_APP_TYPE_CATEGORY["hire_order_countersigned"]).toBe("hire_orders");
    expect(categoryForTemplate("hire-order-issued")).toBe("hire_orders");
  });
});
