import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchOrgAdminNames, adminAskLine } from "./orgAdmins";

describe("fetchOrgAdminNames", () => {
  it("calls list_org_admin_names with the org id and returns the names", async () => {
    const fake = createFakeSupabase({
      "rpc:list_org_admin_names": { data: ["Nadia Okonkwo", "Tom Reeve"], error: null },
    });
    const names = await fetchOrgAdminNames(fake as never, "org-1");
    expect(names).toEqual(["Nadia Okonkwo", "Tom Reeve"]);
    expect(fake.calls).toContainEqual({
      table: "rpc:list_org_admin_names",
      method: "rpc",
      args: [{ p_org: "org-1" }],
    });
  });

  it("returns [] when the RPC reports an error, rather than throwing", async () => {
    const fake = createFakeSupabase({
      "rpc:list_org_admin_names": { data: null, error: { message: "boom" } },
    });
    await expect(fetchOrgAdminNames(fake as never, "org-1")).resolves.toEqual([]);
  });

  it("returns [] when the RPC resolves with no data (no admin has a display name yet)", async () => {
    const fake = createFakeSupabase({
      "rpc:list_org_admin_names": { data: null, error: null },
    });
    await expect(fetchOrgAdminNames(fake as never, "org-1")).resolves.toEqual([]);
  });
});

describe("adminAskLine", () => {
  it("returns null for zero names, so the caller falls back to its generic copy", () => {
    expect(adminAskLine([])).toBeNull();
  });

  it("names a single admin", () => {
    expect(adminAskLine(["Nadia"])).toBe("Ask Nadia to finish setup before anyone can be booked.");
  });

  it("names two admins joined by or", () => {
    expect(adminAskLine(["Nadia", "Tom"])).toBe(
      "Ask Nadia or Tom to finish setup before anyone can be booked.",
    );
  });

  it("collapses three or more to the first two plus another admin", () => {
    expect(adminAskLine(["Nadia", "Tom", "Ana"])).toBe(
      "Ask Nadia, Tom or another admin to finish setup before anyone can be booked.",
    );
  });

  it("uses no em or en dashes", () => {
    for (const names of [["Nadia"], ["Nadia", "Tom"], ["Nadia", "Tom", "Ana"]]) {
      expect(adminAskLine(names)).not.toMatch(/[—–]/);
    }
  });
});
