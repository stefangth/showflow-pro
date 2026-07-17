import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchEntitlements } from "./entitlements";
import { setOrgEntitlement, fetchAllOrgEntitlements } from "./platform";

describe("fetchEntitlements", () => {
  it("selects feature+enabled scoped to the org", async () => {
    const rows = [{ feature: "hire_orders", enabled: true }];
    const fake = createFakeSupabase({ org_entitlements: { data: rows, error: null } });
    const result = await fetchEntitlements(fake as never, "org-1");
    expect(result).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "org_entitlements", method: "select", args: ["feature, enabled"] });
    expect(fake.calls).toContainEqual({ table: "org_entitlements", method: "eq", args: ["org_id", "org-1"] });
  });

  it("returns an empty array when no rows", async () => {
    const fake = createFakeSupabase({ org_entitlements: { data: [], error: null } });
    expect(await fetchEntitlements(fake as never, "org-1")).toEqual([]);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ org_entitlements: { data: null, error: { message: "boom" } } });
    await expect(fetchEntitlements(fake as never, "org-1")).rejects.toBeTruthy();
  });
});

describe("setOrgEntitlement", () => {
  it("upserts on (org_id, feature)", async () => {
    const fake = createFakeSupabase({ org_entitlements: { data: null, error: null } });
    await setOrgEntitlement(fake as never, "org-1", "hire_orders", true);
    expect(fake.calls).toContainEqual({
      table: "org_entitlements",
      method: "upsert",
      args: [{ org_id: "org-1", feature: "hire_orders", enabled: true }, { onConflict: "org_id,feature" }],
    });
  });

  it("throws on upsert error", async () => {
    const fake = createFakeSupabase({ org_entitlements: { data: null, error: { message: "no" } } });
    await expect(setOrgEntitlement(fake as never, "org-1", "hire_orders", false)).rejects.toBeTruthy();
  });
});

describe("fetchAllOrgEntitlements", () => {
  it("reads org_id+feature+enabled across all orgs", async () => {
    const rows = [
      { org_id: "org-1", feature: "hire_orders", enabled: true },
      { org_id: "org-2", feature: "booking_flow", enabled: false },
    ];
    const fake = createFakeSupabase({ org_entitlements: { data: rows, error: null } });
    const result = await fetchAllOrgEntitlements(fake as never);
    expect(result).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "org_entitlements", method: "select", args: ["org_id, feature, enabled"] });
  });

  it("returns an empty array when no rows", async () => {
    const fake = createFakeSupabase({ org_entitlements: { data: [], error: null } });
    expect(await fetchAllOrgEntitlements(fake as never)).toEqual([]);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ org_entitlements: { data: null, error: { message: "boom" } } });
    await expect(fetchAllOrgEntitlements(fake as never)).rejects.toBeTruthy();
  });
});
