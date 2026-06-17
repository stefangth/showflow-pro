import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchCitiesForLinking, linkCityAirtableKey, importCitiesFromOptions, mergeCities } from "./cities";

describe("cities data-access", () => {
  it("fetchCitiesForLinking selects link fields for the org", async () => {
    const rows = [{ id: "c1", name: "Berlin", airtable_city_key: "Berlin" }];
    const fake = createFakeSupabase({ cities: { data: rows, error: null } });
    const res = await fetchCitiesForLinking(fake as never, "org-1");
    expect(res).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "cities", method: "eq", args: ["org_id", "org-1"] });
  });

  it("fetchCitiesForLinking returns [] for null org (no query)", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchCitiesForLinking(fake as never, null)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("linkCityAirtableKey updates the key on the row", async () => {
    const fake = createFakeSupabase({ cities: { data: null, error: null } });
    await linkCityAirtableKey(fake as never, "c1", "Berlin");
    expect(fake.calls).toContainEqual({ table: "cities", method: "update", args: [{ airtable_city_key: "Berlin" }] });
    expect(fake.calls).toContainEqual({ table: "cities", method: "eq", args: ["id", "c1"] });
  });

  it("importCitiesFromOptions inserts unlinked options (org-scoped, key set)", async () => {
    const fake = createFakeSupabase({ cities: { data: null, error: null } });
    await importCitiesFromOptions(fake as never, "org-1", [{ name: "Hamburg", key: "Hamburg" }]);
    expect(fake.calls).toContainEqual({ table: "cities", method: "insert", args: [[{ org_id: "org-1", name: "Hamburg", airtable_city_key: "Hamburg" }]] });
  });

  it("importCitiesFromOptions no-ops on empty rows", async () => {
    const fake = createFakeSupabase({ cities: { data: null, error: null } });
    await importCitiesFromOptions(fake as never, "org-1", []);
    expect(fake.calls).toEqual([]);
  });

  it("mergeCities calls the merge_cities RPC with survivor + losers", async () => {
    const fake = createFakeSupabase({ "rpc:merge_cities": { data: null, error: null } });
    await mergeCities(fake as never, "survivor-1", ["loser-1", "loser-2"]);
    expect(fake.calls).toContainEqual({ table: "rpc:merge_cities", method: "rpc", args: [{ p_survivor: "survivor-1", p_losers: ["loser-1", "loser-2"] }] });
  });
  it("mergeCities throws on RPC error", async () => {
    const fake = createFakeSupabase({ "rpc:merge_cities": { data: null, error: { message: "not authorized" } } });
    await expect(mergeCities(fake as never, "s", ["l"])).rejects.toMatchObject({ message: "not authorized" });
  });
});
