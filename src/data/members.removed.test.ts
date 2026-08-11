import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchRemovedMembers, restoreOrgMember, clearRemovedMember, purgeRemovedUser } from "./members";

describe("fetchRemovedMembers", () => {
  it("calls list_removed_members and returns the rows", async () => {
    const rows = [{ user_id: "u1", email: "a@t.test", display_name: "A", roles: ["artist"],
      removed_at: "2026-08-11T00:00:00Z", removed_by_name: "David", deletable: true }];
    const fake = createFakeSupabase({ "rpc:list_removed_members": { data: rows, error: null } });
    expect(await fetchRemovedMembers(fake as never, "org1")).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "rpc:list_removed_members", method: "rpc", args: [{ p_org: "org1" }] });
  });
});

describe("mutations", () => {
  it("restoreOrgMember surfaces the RPC error", async () => {
    const fake = createFakeSupabase({ "rpc:restore_org_member": { data: null, error: { message: "nope" } } });
    await expect(restoreOrgMember(fake as never, "org1", "u1")).rejects.toMatchObject({ message: "nope" });
  });
  it("clearRemovedMember calls the RPC with the right args", async () => {
    const fake = createFakeSupabase({ "rpc:clear_removed_member": { data: null, error: null } });
    await clearRemovedMember(fake as never, "org1", "u1");
    expect(fake.calls).toContainEqual({ table: "rpc:clear_removed_member", method: "rpc", args: [{ p_org: "org1", p_user: "u1" }] });
  });
  it("purgeRemovedUser returns the edge-fn result", async () => {
    const fake = createFakeSupabase({ "fn:org-purge-removed-user": { data: { deleted: true }, error: null } });
    expect(await purgeRemovedUser(fake as never, "org1", "u1")).toEqual({ deleted: true, retained: false });
    expect(fake.calls).toContainEqual({ table: "fn:org-purge-removed-user", method: "invoke", args: [{ org_id: "org1", user_id: "u1" }] });
  });
  it("purgeRemovedUser reports a retained (kept) account", async () => {
    const fake = createFakeSupabase({ "fn:org-purge-removed-user": { data: { retained: true, reason: "other_memberships" }, error: null } });
    expect(await purgeRemovedUser(fake as never, "org1", "u1")).toEqual({ deleted: false, retained: true });
  });
});
