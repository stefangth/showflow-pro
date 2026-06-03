import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchMyMemberships, fetchOrgProducers } from "./orgs";

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

describe("fetchOrgProducers", () => {
  it("returns the profiles of the org's producers + admins (excludes artists)", async () => {
    const fake = createFakeSupabase({
      org_memberships: {
        data: [
          { user_id: "u1", role: "producer" },
          { user_id: "u2", role: "admin" },
          { user_id: "u3", role: "artist" }, // filtered out by .in("role", [...])
        ],
        error: null,
      },
      profiles: {
        data: [
          { user_id: "u1", display_name: "Alice" },
          { user_id: "u2", display_name: "Bob" },
        ],
        error: null,
      },
    });

    const result = await fetchOrgProducers(fake as never, "o1");
    expect(result).toEqual([
      { user_id: "u1", display_name: "Alice" },
      { user_id: "u2", display_name: "Bob" },
    ]);
    // Scoped to the org and to writer roles
    expect(fake.calls).toContainEqual({ table: "org_memberships", method: "eq", args: ["org_id", "o1"] });
    expect(fake.calls).toContainEqual({ table: "org_memberships", method: "in", args: ["role", ["producer", "admin"]] });
    // Profiles looked up by the resolved user ids
    expect(fake.calls).toContainEqual({ table: "profiles", method: "in", args: ["user_id", ["u1", "u2"]] });
  });

  it("returns [] (and never queries profiles) when the org has no producers/admins", async () => {
    const fake = createFakeSupabase({
      org_memberships: { data: [{ user_id: "u3", role: "artist" }], error: null },
    });
    expect(await fetchOrgProducers(fake as never, "o1")).toEqual([]);
    expect(fake.calls.some((c) => c.table === "profiles")).toBe(false);
  });

  it("throws when the membership query errors", async () => {
    const fake = createFakeSupabase({
      org_memberships: { data: null, error: { message: "boom" } },
    });
    await expect(fetchOrgProducers(fake as never, "o1")).rejects.toBeTruthy();
  });
});
