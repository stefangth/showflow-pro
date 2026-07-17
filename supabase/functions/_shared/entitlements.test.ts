import { assertEquals } from "./test-asserts.ts";
import { makeFakeDeps } from "./testing.ts";
import {
  FEATURE_KEYS,
  FEATURE_REGISTRY,
  checkFeature,
  enabledFeatures,
  filterEntitledOrgs,
  isFeatureEnabled,
  requireFeature,
} from "./entitlements.ts";

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

// ── Edge-only helpers (checkFeature / requireFeature / filterEntitledOrgs) ──────

Deno.test("checkFeature: returns true when the RPC reports the feature enabled", async () => {
  const { deps } = makeFakeDeps({ rpcs: { is_feature_enabled: { data: true, error: null } } });
  assertEquals(await checkFeature(deps.admin, "org-1", "hire_orders"), true);
});

Deno.test("checkFeature: returns false when the RPC reports the feature disabled", async () => {
  const { deps } = makeFakeDeps({ rpcs: { is_feature_enabled: { data: false, error: null } } });
  assertEquals(await checkFeature(deps.admin, "org-1", "hire_orders"), false);
});

Deno.test("checkFeature: fails CLOSED for hire_orders on RPC error", async () => {
  const { deps } = makeFakeDeps({ rpcs: { is_feature_enabled: { data: null, error: { message: "boom" } } } });
  assertEquals(await checkFeature(deps.admin, "org-1", "hire_orders"), false);
});

Deno.test("checkFeature: fails OPEN for booking_flow on RPC error", async () => {
  const { deps } = makeFakeDeps({ rpcs: { is_feature_enabled: { data: null, error: { message: "boom" } } } });
  assertEquals(await checkFeature(deps.admin, "org-1", "booking_flow"), true);
});

Deno.test("requireFeature: 403s with feature_disabled when the feature is off", async () => {
  const { deps } = makeFakeDeps({ rpcs: { is_feature_enabled: { data: false, error: null } } });
  const res = await requireFeature(deps, "org-1", "hire_orders");
  assertEquals(res?.status, 403);
  assertEquals(await res?.json(), { error: "feature_disabled" });
});

Deno.test("requireFeature: returns null when the feature is on", async () => {
  const { deps } = makeFakeDeps({ rpcs: { is_feature_enabled: { data: true, error: null } } });
  const res = await requireFeature(deps, "org-1", "hire_orders");
  assertEquals(res, null);
});

Deno.test("filterEntitledOrgs: keeps only orgs with the feature enabled", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      orgs: [
        { when: { id: "org-a" }, data: { id: "org-a" } },
      ],
    },
    rpcs: {}, // per-org result seeded via a custom admin below
  });
  // filterEntitledOrgs calls checkFeature per org — build a tiny fake admin whose
  // rpc() branches on the _org param so different orgs get different results.
  const admin = {
    rpc: (_name: string, params?: { _org?: string }) =>
      Promise.resolve({ data: params?._org === "org-a", error: null }),
  } as unknown as typeof deps.admin;
  const result = await filterEntitledOrgs(admin, [{ id: "org-a" }, { id: "org-b" }], "hire_orders");
  assertEquals(result, [{ id: "org-a" }]);
});
