import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchMyMemberships } from "./orgs";

describe("fetchMyMemberships", () => {
  it("queries org_memberships by user_id and returns rows with the joined org", async () => {
    const rows = [
      {
        org_id: "o1",
        role: "admin",
        organizations: { id: "o1", name: "Cirque", slug: "cirque", status: "active" },
      },
    ];
    const fake = createFakeSupabase({ org_memberships: { data: rows, error: null } });
    const result = await fetchMyMemberships(fake as never, "u1");
    expect(result).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "org_memberships", method: "eq", args: ["user_id", "u1"] });
  });

  it("returns [] when the user has no memberships", async () => {
    const fake = createFakeSupabase({ org_memberships: { data: [], error: null } });
    expect(await fetchMyMemberships(fake as never, "u1")).toEqual([]);
  });

  it("throws when the query errors", async () => {
    const fake = createFakeSupabase({ org_memberships: { data: null, error: { message: "boom" } } });
    await expect(fetchMyMemberships(fake as never, "u1")).rejects.toBeTruthy();
  });
});
