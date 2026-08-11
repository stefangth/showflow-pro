import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { fetchOrgMembers, removeOrgMember, setOrgMemberRole, fetchProducerCount } from "./members";

describe("fetchOrgMembers", () => {
  it("calls list_org_members and returns the rows", async () => {
    const rows = [{ user_id: "u1", email: "a@x.com", display_name: "Ada", roles: ["admin"] }];
    const fake = createFakeSupabase({ "rpc:list_org_members": { data: rows, error: null } });
    const result = await fetchOrgMembers(fake as never, "org-1");
    expect(result).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "rpc:list_org_members", method: "rpc", args: [{ p_org: "org-1" }] });
  });
});

describe("removeOrgMember", () => {
  it("calls remove_org_member with org + user", async () => {
    const fake = createFakeSupabase({ "rpc:remove_org_member": { data: null, error: null } });
    await removeOrgMember(fake as never, "org-1", "u1");
    expect(fake.calls).toContainEqual({ table: "rpc:remove_org_member", method: "rpc", args: [{ p_org: "org-1", p_user: "u1" }] });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:remove_org_member": { data: null, error: { message: "last admin" } } });
    await expect(removeOrgMember(fake as never, "org-1", "u1")).rejects.toBeTruthy();
  });
});

describe("setOrgMemberRole", () => {
  it("calls set_org_member_role with org/user/role/action", async () => {
    const fake = createFakeSupabase({ "rpc:set_org_member_role": { data: null, error: null } });
    await setOrgMemberRole(fake as never, "org-1", "u2", "producer", "add");
    expect(fake.calls).toContainEqual({
      table: "rpc:set_org_member_role", method: "rpc",
      args: [{ p_org: "org-1", p_user: "u2", p_role: "producer", p_action: "add" }],
    });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:set_org_member_role": { data: null, error: { message: "last admin" } } });
    await expect(setOrgMemberRole(fake as never, "org-1", "u2", "admin", "remove")).rejects.toBeTruthy();
  });
});

describe("fetchProducerCount", () => {
  it("counts producer-role memberships for the org via a head count", async () => {
    const fake = createFakeSupabase({ org_memberships: { data: [], error: null, count: 3 } });
    const n = await fetchProducerCount(asSupabase(fake), "o1");
    expect(n).toBe(3);
    // Filtered to the org and the producer role.
    expect(fake.calls).toContainEqual({ table: "org_memberships", method: "eq", args: ["org_id", "o1"] });
    expect(fake.calls).toContainEqual({ table: "org_memberships", method: "eq", args: ["role", "producer"] });
  });

  it("returns 0 when the org has no producer members", async () => {
    const fake = createFakeSupabase({ org_memberships: { data: [], error: null, count: 0 } });
    expect(await fetchProducerCount(asSupabase(fake), "o1")).toBe(0);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ org_memberships: { data: null, error: { message: "boom" } } });
    await expect(fetchProducerCount(asSupabase(fake), "o1")).rejects.toBeTruthy();
  });
});
