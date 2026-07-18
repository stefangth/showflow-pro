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

  it("gates the hire-orders tracking (list) route on the hire_orders feature", () => {
    expect(ROUTE_FEATURES["/hire-orders"]).toBe("hire_orders");
  });

  it("gates the hire-order edit (V2 builder) route on the hire_orders feature", () => {
    expect(ROUTE_FEATURES["/hire-orders/:id/edit"]).toBe("hire_orders");
    expect(requiredFeatureForPath("/hire-orders/abc-123-uuid/edit")).toBe("hire_orders");
  });

  it("resolves the detail route via its own 2-segment pattern, not the 3-segment edit pattern", () => {
    // /hire-orders/:id (2 segs) and /hire-orders/:id/edit (3 segs) must never
    // cross-match — segment count keeps them isolated.
    expect(requiredFeatureForPath("/hire-orders/abc-123-uuid")).toBe("hire_orders");
    expect(requiredFeatureForPath("/hire-orders/abc-123-uuid/edit")).toBe("hire_orders");
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

  it("resolves the plain list route via the exact key, not the dynamic :id pattern", () => {
    // /hire-orders is its own exact ROUTE_FEATURES entry (the V4 tracking
    // page) — it must resolve without ever falling through to the
    // /hire-orders/:id pattern match (segment counts differ: 2 vs 3).
    expect(requiredFeatureForPath("/hire-orders")).toBe("hire_orders");
  });

  it("does not match the dynamic pattern for the wrong segment count", () => {
    expect(requiredFeatureForPath("/hire-orders/abc/extra")).toBeUndefined();
  });

  it("does not match an empty `:param` segment", () => {
    expect(requiredFeatureForPath("/hire-orders/")).toBeUndefined();
  });
});
