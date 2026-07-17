import { describe, it, expect, afterEach } from "vitest";
import { BOOKING_ENGINE_DEFAULTS, ROUTE_FEATURES, requiredFeatureForPath } from "./app.config";

describe("config/app.config", () => {
  it("BOOKING_ENGINE_DEFAULTS holds the canonical booking-engine fallbacks (mirror of supabase/functions/_shared/settings.ts)", () => {
    expect(BOOKING_ENGINE_DEFAULTS).toEqual({
      offer_response_window_hours: 48,
      offer_digest_hour_berlin: 19,
      confirmation_digest_hour_berlin: 20,
      resend_from_address: "ShowFlow <noreply@showflow.pro>",
    });
  });
});

describe("requiredFeatureForPath", () => {
  const TEST_PATH = "/__test-route-7";

  afterEach(() => {
    delete (ROUTE_FEATURES as Record<string, string>)[TEST_PATH];
  });

  it("gates the hire-order detail route on the hire_orders feature", () => {
    expect(ROUTE_FEATURES["/hire-orders/:id"]).toBe("hire_orders");
  });

  it("gates the V4 hire-orders tracking route on the hire_orders feature", () => {
    expect(ROUTE_FEATURES["/hire-orders"]).toBe("hire_orders");
    expect(requiredFeatureForPath("/hire-orders")).toBe("hire_orders");
  });

  it("returns undefined for a path with no configured feature", () => {
    expect(requiredFeatureForPath("/dashboard")).toBeUndefined();
  });

  it("returns the feature key for a route present in ROUTE_FEATURES", () => {
    (ROUTE_FEATURES as Record<string, string>)[TEST_PATH] = "hire_orders";
    expect(requiredFeatureForPath(TEST_PATH)).toBe("hire_orders");
  });

  it("matches a dynamic `:param` route pattern against a concrete pathname", () => {
    // The real URL is `/hire-orders/<uuid>`, which never exact-matches the
    // `/hire-orders/:id` key — the gate must pattern-match or it silently no-ops.
    expect(requiredFeatureForPath("/hire-orders/abc-123-uuid")).toBe("hire_orders");
  });

  it("does not match the dynamic pattern for the wrong segment count", () => {
    // "/hire-orders" itself now exact-matches ROUTE_FEATURES directly (the V4
    // list route) — the case this guards against is a path with too many
    // segments for the ":id" pattern, which must still fall through to undefined.
    expect(requiredFeatureForPath("/hire-orders/abc/extra")).toBeUndefined();
  });

  it("does not match an empty `:param` segment", () => {
    expect(requiredFeatureForPath("/hire-orders/")).toBeUndefined();
  });
});
