import { assertEquals } from "./test-asserts.ts";
import { FEATURE_KEYS, FEATURE_REGISTRY, enabledFeatures, isFeatureEnabled } from "./entitlements.ts";

// Note: test-asserts.ts's deepEqual treats any two Set instances as equal
// (Object.keys() on a Set yields [], so it never compares contents). Sort
// enabledFeatures() into an array before asserting so these tests actually
// exercise the contents, not just "both are Sets".
function sorted(set: Set<string>): string[] {
  return Array.from(set).sort();
}

Deno.test("entitlements registry: registers booking_flow default-on and hire_orders default-off", () => {
  assertEquals(FEATURE_REGISTRY.booking_flow.defaultEnabled, true);
  assertEquals(FEATURE_REGISTRY.hire_orders.defaultEnabled, false);
  assertEquals(FEATURE_KEYS, ["booking_flow", "hire_orders"]);
});

Deno.test("entitlements registry: falls back to registry defaults when no row exists", () => {
  assertEquals(sorted(enabledFeatures([])), ["booking_flow"]);
});

Deno.test("entitlements registry: row wins over default in both directions", () => {
  const rows = [
    { feature: "booking_flow", enabled: false },
    { feature: "hire_orders", enabled: true },
  ];
  assertEquals(isFeatureEnabled(rows, "booking_flow"), false);
  assertEquals(isFeatureEnabled(rows, "hire_orders"), true);
});

Deno.test("entitlements registry: ignores unknown feature rows", () => {
  assertEquals(sorted(enabledFeatures([{ feature: "mystery", enabled: true }])), ["booking_flow"]);
});
