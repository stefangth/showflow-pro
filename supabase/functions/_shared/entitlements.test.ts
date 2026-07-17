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

Deno.test("filterEntitledOrgs: keeps only entitled orgs via a single batch query, honoring registry defaults", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      org_entitlements: {
        data: [
          { org_id: "org-a", enabled: true },
          { org_id: "org-b", enabled: false },
          // org-c has no row -> falls back to the registry default (hire_orders = off).
        ],
        error: null,
      },
    },
  });
  const result = await filterEntitledOrgs(
    deps.admin,
    [{ id: "org-a" }, { id: "org-b" }, { id: "org-c" }],
    "hire_orders",
  );
  assertEquals(result, [{ id: "org-a" }]);
  // One org_entitlements read for the whole batch — the old per-org N+1 is gone.
  assertEquals(calls.filter((c) => c.table === "org_entitlements" && c.method === "select").length, 1);
});

Deno.test("filterEntitledOrgs: an org with no row falls back to the registry default (booking_flow on)", async () => {
  const { deps } = makeFakeDeps({ tables: { org_entitlements: { data: [], error: null } } });
  assertEquals(await filterEntitledOrgs(deps.admin, [{ id: "org-a" }], "booking_flow"), [{ id: "org-a" }]);
});

Deno.test("filterEntitledOrgs: on query error fails OPEN for booking_flow and CLOSED otherwise", async () => {
  const errored = { tables: { org_entitlements: { data: null, error: { message: "boom" } } } };
  const { deps: openDeps } = makeFakeDeps(errored);
  assertEquals(await filterEntitledOrgs(openDeps.admin, [{ id: "o1" }], "booking_flow"), [{ id: "o1" }]);
  const { deps: closedDeps } = makeFakeDeps(errored);
  assertEquals(await filterEntitledOrgs(closedDeps.admin, [{ id: "o1" }], "hire_orders"), []);
});

Deno.test("filterEntitledOrgs: an empty org list short-circuits without querying", async () => {
  const { deps, calls } = makeFakeDeps({ tables: { org_entitlements: { data: [], error: null } } });
  assertEquals(await filterEntitledOrgs(deps.admin, [], "hire_orders"), []);
  assertEquals(calls.some((c) => c.table === "org_entitlements"), false);
});
