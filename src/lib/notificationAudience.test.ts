import { describe, expect, it } from "vitest";
import { visibleNotificationCategories, PRODUCER_ONLY_CATEGORIES } from "./notificationAudience";

describe("visibleNotificationCategories", () => {
  it("drops producer-only categories for an artist-only viewer", () => {
    const keys = visibleNotificationCategories({ isArtistOnly: true }).map((c) => c.key);
    expect(keys).toEqual(["booking_offers", "booking_confirmations", "schedule_changes", "hire_orders"]);
    for (const k of PRODUCER_ONLY_CATEGORIES) expect(keys).not.toContain(k);
  });
  it("keeps every category for a producer/admin viewer", () => {
    const keys = visibleNotificationCategories({ isArtistOnly: false }).map((c) => c.key);
    expect(keys).toContain("booking_activity");
    expect(keys).toContain("at_risk");
    expect(keys).toHaveLength(6);
  });
});
