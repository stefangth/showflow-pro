import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { fetchMyMemberships, setOrgKind } from "./orgs";

describe("orgs data: org_kind", () => {
  it("fetchMyMemberships selects org_kind and org_kind_set_at with the org", async () => {
    const fake = createFakeSupabase({
      org_memberships: { data: [{ org_id: "o1", role: "admin", organizations: { id: "o1", name: "A", slug: "a", status: "active", is_demo: false, org_kind: "staffing", org_kind_set_at: null } }], error: null },
    });
    const rows = await fetchMyMemberships(asSupabase(fake), "u1");
    expect(rows[0].organizations?.org_kind).toBe("staffing");
    const select = fake.calls.find((c) => c.table === "org_memberships" && c.method === "select");
    expect(String(select?.args[0])).toContain("org_kind");
    expect(String(select?.args[0])).toContain("org_kind_set_at");
  });

  it("setOrgKind calls the set_org_kind rpc", async () => {
    const fake = createFakeSupabase({ "rpc:set_org_kind": { data: null, error: null } });
    await setOrgKind(asSupabase(fake), "o1", "staffing");
    expect(fake.calls).toContainEqual({ table: "rpc:set_org_kind", method: "rpc", args: [{ p_org: "o1", p_kind: "staffing" }] });
  });

  it("setOrgKind throws on rpc error", async () => {
    const fake = createFakeSupabase({ "rpc:set_org_kind": { data: null, error: { message: "Forbidden" } } });
    await expect(setOrgKind(asSupabase(fake), "o1", "staffing")).rejects.toMatchObject({ message: "Forbidden" });
  });
});
