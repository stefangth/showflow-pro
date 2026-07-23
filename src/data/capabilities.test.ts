import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  fetchCapabilities,
  fetchCapabilityPolicies,
  fetchCapabilityState,
  clearOrgCapability,
  setOrgCapabilityPolicy,
  clearOrgCapabilityPolicy,
} from "./capabilities";
import { setOrgCapability } from "./platform";

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

describe("fetchCapabilityPolicies", () => {
  it("selects capability, enabled, locked scoped to the org", async () => {
    const rows = [{ capability: "producer_can_issue_hire_orders", enabled: false, locked: true }];
    const fake = createFakeSupabase({ org_capability_policies: { data: rows, error: null } });
    const result = await fetchCapabilityPolicies(fake as never, "org-1");
    expect(result).toEqual(rows);
    expect(fake.calls).toContainEqual({
      table: "org_capability_policies",
      method: "select",
      args: ["capability, enabled, locked"],
    });
    expect(fake.calls).toContainEqual({ table: "org_capability_policies", method: "eq", args: ["org_id", "org-1"] });
  });

  it("returns an empty array when no rows", async () => {
    const fake = createFakeSupabase({ org_capability_policies: { data: [], error: null } });
    expect(await fetchCapabilityPolicies(fake as never, "org-1")).toEqual([]);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ org_capability_policies: { data: null, error: { message: "boom" } } });
    await expect(fetchCapabilityPolicies(fake as never, "org-1")).rejects.toBeTruthy();
  });
});

describe("fetchCapabilityState", () => {
  it("returns overrides and policies together", async () => {
    const overrideRows = [{ capability: "producer_can_rename_org", enabled: true }];
    const policyRows = [{ capability: "producer_can_rename_org", enabled: null, locked: true }];
    const fake = createFakeSupabase({
      org_capabilities: { data: overrideRows, error: null },
      org_capability_policies: { data: policyRows, error: null },
    });
    const result = await fetchCapabilityState(fake as never, "org-1");
    expect(result).toEqual({ overrides: overrideRows, policies: policyRows });
    expect(fake.calls).toContainEqual({ table: "org_capabilities", method: "select", args: ["capability, enabled"] });
    expect(fake.calls).toContainEqual({ table: "org_capabilities", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({
      table: "org_capability_policies",
      method: "select",
      args: ["capability, enabled, locked"],
    });
    expect(fake.calls).toContainEqual({ table: "org_capability_policies", method: "eq", args: ["org_id", "org-1"] });
  });

  it("returns empty arrays when neither table has rows", async () => {
    const fake = createFakeSupabase({
      org_capabilities: { data: [], error: null },
      org_capability_policies: { data: [], error: null },
    });
    expect(await fetchCapabilityState(fake as never, "org-1")).toEqual({ overrides: [], policies: [] });
  });

  it("throws when the policies read errors", async () => {
    const fake = createFakeSupabase({
      org_capabilities: { data: [], error: null },
      org_capability_policies: { data: null, error: { message: "boom" } },
    });
    await expect(fetchCapabilityState(fake as never, "org-1")).rejects.toBeTruthy();
  });
});

describe("clearOrgCapability", () => {
  it("deletes the override row for (org, capability)", async () => {
    const fake = createFakeSupabase({ org_capabilities: { data: null, error: null } });
    await clearOrgCapability(fake as never, "org-1", "producer_can_rename_org");
    expect(fake.calls).toContainEqual({ table: "org_capabilities", method: "delete", args: [] });
    expect(fake.calls).toContainEqual({ table: "org_capabilities", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "org_capabilities", method: "eq", args: ["capability", "producer_can_rename_org"] });
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ org_capabilities: { data: null, error: { message: "boom" } } });
    await expect(clearOrgCapability(fake as never, "org-1", "x")).rejects.toBeTruthy();
  });
});

describe("setOrgCapabilityPolicy", () => {
  it("upserts a partial patch on (org_id, capability)", async () => {
    const fake = createFakeSupabase({ org_capability_policies: { data: null, error: null } });
    await setOrgCapabilityPolicy(fake as never, "org-1", "producer_can_issue_hire_orders", { locked: true });
    expect(fake.calls).toContainEqual({
      table: "org_capability_policies",
      method: "upsert",
      args: [{ org_id: "org-1", capability: "producer_can_issue_hire_orders", locked: true }, { onConflict: "org_id,capability" }],
    });
  });

  it("upserts an enabled+locked patch on (org_id, capability)", async () => {
    const fake = createFakeSupabase({ org_capability_policies: { data: null, error: null } });
    await setOrgCapabilityPolicy(fake as never, "org-1", "producer_can_rename_org", { enabled: false, locked: true });
    expect(fake.calls).toContainEqual({
      table: "org_capability_policies",
      method: "upsert",
      args: [
        { org_id: "org-1", capability: "producer_can_rename_org", enabled: false, locked: true },
        { onConflict: "org_id,capability" },
      ],
    });
  });

  it("throws on upsert error", async () => {
    const fake = createFakeSupabase({ org_capability_policies: { data: null, error: { message: "no" } } });
    await expect(
      setOrgCapabilityPolicy(fake as never, "org-1", "producer_can_invite", { locked: false }),
    ).rejects.toBeTruthy();
  });
});

describe("clearOrgCapabilityPolicy", () => {
  it("deletes the policy row for (org, capability)", async () => {
    const fake = createFakeSupabase({ org_capability_policies: { data: null, error: null } });
    await clearOrgCapabilityPolicy(fake as never, "org-1", "producer_can_rename_org");
    expect(fake.calls).toContainEqual({ table: "org_capability_policies", method: "delete", args: [] });
    expect(fake.calls).toContainEqual({ table: "org_capability_policies", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "org_capability_policies", method: "eq", args: ["capability", "producer_can_rename_org"] });
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ org_capability_policies: { data: null, error: { message: "boom" } } });
    await expect(clearOrgCapabilityPolicy(fake as never, "org-1", "x")).rejects.toBeTruthy();
  });
});
