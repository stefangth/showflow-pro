import { describe, expect, it } from "vitest";
import { FEATURE_KEYS, FEATURE_REGISTRY, enabledFeatures, isFeatureEnabled } from "./entitlements";

describe("entitlements registry", () => {
  it("registers booking_flow default-on and hire_orders default-off", () => {
    expect(FEATURE_REGISTRY.booking_flow.defaultEnabled).toBe(true);
    expect(FEATURE_REGISTRY.hire_orders.defaultEnabled).toBe(false);
    expect(FEATURE_KEYS).toEqual(["booking_flow", "hire_orders"]);
  });
  it("falls back to registry defaults when no row exists", () => {
    expect(enabledFeatures([])).toEqual(new Set(["booking_flow"]));
  });
  it("row wins over default in both directions", () => {
    const rows = [
      { feature: "booking_flow", enabled: false },
      { feature: "hire_orders", enabled: true },
    ];
    expect(isFeatureEnabled(rows, "booking_flow")).toBe(false);
    expect(isFeatureEnabled(rows, "hire_orders")).toBe(true);
  });
  it("ignores unknown feature rows", () => {
    expect(enabledFeatures([{ feature: "mystery", enabled: true }])).toEqual(new Set(["booking_flow"]));
  });
});
