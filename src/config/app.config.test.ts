import { describe, it, expect, afterEach } from "vitest";
import { BOOKING_ENGINE_DEFAULTS, ROLE_LABELS, ROUTES, ROUTE_FEATURES, requiredFeatureForPath, roleLabel } from "./app.config";

describe("config/app.config", () => {
  it("exposes the exact dynamic email template editor route", () => {
    expect(ROUTES.EMAIL_TEMPLATE).toBe("/settings/email-templates/:templateKey");
  });

  it("BOOKING_ENGINE_DEFAULTS holds the canonical booking-engine fallbacks (mirror of supabase/functions/_shared/settings.ts)", () => {
    expect(BOOKING_ENGINE_DEFAULTS).toEqual({
      offer_response_window_hours: 48,
      offer_digest_hour_berlin: 19,
      confirmation_digest_hour_berlin: 20,
      resend_from_address: "ShowFlow <noreply@showflow.pro>",
    });
  });
});

describe("roleLabel", () => {
  it("labels the producer role 'Production Team' (covers producers + project managers)", () => {
    expect(roleLabel("producer")).toBe("Production Team");
    expect(ROLE_LABELS.producer).toBe("Production Team");
  });

  it("keeps admin and artist as their capitalized names", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("artist")).toBe("Artist");
  });

  it("falls back to the raw value for an unknown role string", () => {
    expect(roleLabel("super-admin")).toBe("super-admin");
    expect(roleLabel("")).toBe("");
  });
});

describe("requiredFeatureForPath", () => {
  const TEST_PATH = "/__test-route-7";

  afterEach(() => {
    delete (ROUTE_FEATURES as Record<string, string>)[TEST_PATH];
  });

  it("gates the hire-order detail route on the hire_orders feature", () => {
    expect(ROUTE_FEATURES["/contracts/:id"]).toBe("hire_orders");
  });

  it("gates the hire-orders tracking (list) route on the hire_orders feature", () => {
    expect(ROUTE_FEATURES["/contracts"]).toBe("hire_orders");
  });

  it("gates the hire-order edit (V2 builder) route on the hire_orders feature", () => {
    expect(ROUTE_FEATURES["/contracts/:id/edit"]).toBe("hire_orders");
    expect(requiredFeatureForPath("/contracts/abc-123-uuid/edit")).toBe("hire_orders");
  });

  it("resolves the detail route via its own 2-segment pattern, not the 3-segment edit pattern", () => {
    // /contracts/:id (2 segs) and /contracts/:id/edit (3 segs) must never
    // cross-match — segment count keeps them isolated.
    expect(requiredFeatureForPath("/contracts/abc-123-uuid")).toBe("hire_orders");
    expect(requiredFeatureForPath("/contracts/abc-123-uuid/edit")).toBe("hire_orders");
  });

  it("returns undefined for a path with no configured feature", () => {
    expect(requiredFeatureForPath("/today")).toBeUndefined();
  });

  it("returns the feature key for a route present in ROUTE_FEATURES", () => {
    (ROUTE_FEATURES as Record<string, string>)[TEST_PATH] = "hire_orders";
    expect(requiredFeatureForPath(TEST_PATH)).toBe("hire_orders");
  });

  it("matches a dynamic `:param` route pattern against a concrete pathname", () => {
    // The real URL is `/contracts/<uuid>`, which never exact-matches the
    // `/contracts/:id` key — the gate must pattern-match or it silently no-ops.
    expect(requiredFeatureForPath("/contracts/abc-123-uuid")).toBe("hire_orders");
  });

  it("resolves the plain list route via the exact key, not the dynamic :id pattern", () => {
    // /contracts is its own exact ROUTE_FEATURES entry (the V4 tracking
    // page) — it must resolve without ever falling through to the
    // /contracts/:id pattern match (segment counts differ: 2 vs 3).
    expect(requiredFeatureForPath("/contracts")).toBe("hire_orders");
  });

  it("does not match the dynamic pattern for the wrong segment count", () => {
    expect(requiredFeatureForPath("/contracts/abc/extra")).toBeUndefined();
  });

  it("does not match an empty `:param` segment", () => {
    expect(requiredFeatureForPath("/contracts/")).toBeUndefined();
  });

  it("gates the pdf template editor route on its own exact key, never the /contracts/:id pattern", () => {
    // /settings/contracts/template contains the literal segment "contracts",
    // but it must resolve via its own exact ROUTE_FEATURES entry — never by
    // accidentally pattern-matching /contracts/:id (different segment counts,
    // 4 vs 3, keep them isolated regardless).
    expect(ROUTE_FEATURES["/settings/contracts/template"]).toBe("hire_orders");
    expect(requiredFeatureForPath("/settings/contracts/template")).toBe("hire_orders");
  });

  it("gates /availability behind booking_flow", () => {
    expect(ROUTE_FEATURES["/availability"]).toBe("booking_flow");
    expect(requiredFeatureForPath("/availability")).toBe("booking_flow");
  });
});
