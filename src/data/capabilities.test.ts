import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchCapabilities } from "./capabilities";
import { setOrgCapability, fetchAllOrgCapabilities } from "./platform";

describe("fetchCapabilities", () => {
  it("selects capability+enabled scoped to the org", async () => {
    const rows = [{ capability: "producer_can_invite", enabled: true }];
    const fake = createFakeSupabase({ org_capabilities: { data: rows, error: null } });
    const result = await fetchCapabilities(fake as never, "org-1");
    expect(result).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "org_capabilities", method: "select", args: ["capability, enabled"] });
    expect(fake.calls).toContainEqual({ table: "org_capabilities", method: "eq", args: ["org_id", "org-1"] });
  });

  it("returns an empty array when no rows", async () => {
    const fake = createFakeSupabase({ org_capabilities: { data: [], error: null } });
    expect(await fetchCapabilities(fake as never, "org-1")).toEqual([]);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ org_capabilities: { data: null, error: { message: "boom" } } });
    await expect(fetchCapabilities(fake as never, "org-1")).rejects.toBeTruthy();
  });
});

describe("setOrgCapability", () => {
  it("upserts on (org_id, capability)", async () => {
    const fake = createFakeSupabase({ org_capabilities: { data: null, error: null } });
    await setOrgCapability(fake as never, "org-1", "producer_can_invite", true);
    expect(fake.calls).toContainEqual({
      table: "org_capabilities",
      method: "upsert",
      args: [{ org_id: "org-1", capability: "producer_can_invite", enabled: true }, { onConflict: "org_id,capability" }],
    });
  });

  it("throws on upsert error", async () => {
    const fake = createFakeSupabase({ org_capabilities: { data: null, error: { message: "no" } } });
    await expect(setOrgCapability(fake as never, "org-1", "producer_can_invite", false)).rejects.toBeTruthy();
  });
});

describe("fetchAllOrgCapabilities", () => {
  it("reads org_id+capability+enabled across all orgs", async () => {
    const rows = [
      { org_id: "org-1", capability: "producer_can_invite", enabled: true },
      { org_id: "org-2", capability: "producer_can_invite", enabled: false },
    ];
    const fake = createFakeSupabase({ org_capabilities: { data: rows, error: null } });
    const result = await fetchAllOrgCapabilities(fake as never);
    expect(result).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "org_capabilities", method: "select", args: ["org_id, capability, enabled"] });
  });

  it("returns an empty array when no rows", async () => {
    const fake = createFakeSupabase({ org_capabilities: { data: [], error: null } });
    expect(await fetchAllOrgCapabilities(fake as never)).toEqual([]);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ org_capabilities: { data: null, error: { message: "boom" } } });
    await expect(fetchAllOrgCapabilities(fake as never)).rejects.toBeTruthy();
  });
});
