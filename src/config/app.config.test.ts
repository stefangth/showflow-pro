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

  it("starts empty: no route is gated by default", () => {
    expect(ROUTE_FEATURES).toEqual({});
  });

  it("returns undefined for a path with no configured feature", () => {
    expect(requiredFeatureForPath("/dashboard")).toBeUndefined();
  });

  it("returns the feature key for a route present in ROUTE_FEATURES", () => {
    (ROUTE_FEATURES as Record<string, string>)[TEST_PATH] = "hire_orders";
    expect(requiredFeatureForPath(TEST_PATH)).toBe("hire_orders");
  });
});
