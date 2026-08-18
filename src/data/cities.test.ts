import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchCities, fetchCitiesForLinking, linkCityAirtableKey, importCitiesFromOptions, mergeCities, updateCity } from "./cities";

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

  it("fetchCities returns full rows filtered by org_id (never another org's rows)", async () => {
    // Two orgs' cities seeded; god-mode RLS would return both, so the explicit
    // org_id filter must be what scopes the result. Array-seed matches on eq(org_id).
    const org1Rows = [{ id: "c1", name: "Berlin", org_id: "org-1", airtable_city_key: null }];
    const org2Rows = [{ id: "c2", name: "Munich", org_id: "org-2", airtable_city_key: null }];
    const fake = createFakeSupabase({
      cities: [
        { when: { org_id: "org-1" }, data: org1Rows, error: null },
        { when: { org_id: "org-2" }, data: org2Rows, error: null },
      ],
    });
    const res = await fetchCities(fake as never, "org-1");
    expect(res).toEqual(org1Rows);
    // Full-row projection: select('*'), org-filtered.
    expect(fake.calls).toContainEqual({ table: "cities", method: "select", args: ["*"] });
    expect(fake.calls).toContainEqual({ table: "cities", method: "eq", args: ["org_id", "org-1"] });
    // Never leaks the other org's row.
    expect(res).not.toContainEqual(org2Rows[0]);
  });

  it("fetchCities scopes to the requested org (org-2)", async () => {
    const org1Rows = [{ id: "c1", name: "Berlin", org_id: "org-1", airtable_city_key: null }];
    const org2Rows = [{ id: "c2", name: "Munich", org_id: "org-2", airtable_city_key: null }];
    const fake = createFakeSupabase({
      cities: [
        { when: { org_id: "org-1" }, data: org1Rows, error: null },
        { when: { org_id: "org-2" }, data: org2Rows, error: null },
      ],
    });
    expect(await fetchCities(fake as never, "org-2")).toEqual(org2Rows);
  });

  it("fetchCities returns [] for null org (no query)", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchCities(fake as never, null)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("fetchCities throws on error", async () => {
    const fake = createFakeSupabase({ cities: { data: null, error: { message: "boom" } } });
    await expect(fetchCities(fake as never, "org-1")).rejects.toMatchObject({ message: "boom" });
  });

  it("linkCityAirtableKey updates the key on the row", async () => {
    const fake = createFakeSupabase({ cities: { data: null, error: null } });
    await linkCityAirtableKey(fake as never, "c1", "Berlin");
    expect(fake.calls).toContainEqual({ table: "cities", method: "update", args: [{ airtable_city_key: "Berlin" }] });
    expect(fake.calls).toContainEqual({ table: "cities", method: "eq", args: ["id", "c1"] });
  });

  it("updateCity updates the trimmed name on the row and returns it", async () => {
    const row = { id: "c1", name: "Munich", org_id: "org-1", airtable_city_key: null };
    const fake = createFakeSupabase({ cities: { data: row, error: null } });
    const res = await updateCity(fake as never, "c1", "  Munich  ");
    expect(res).toEqual(row);
    expect(fake.calls).toContainEqual({ table: "cities", method: "update", args: [{ name: "Munich" }] });
    expect(fake.calls).toContainEqual({ table: "cities", method: "eq", args: ["id", "c1"] });
  });

  it("updateCity throws on error (e.g. unique violation)", async () => {
    const fake = createFakeSupabase({ cities: { data: null, error: { code: "23505", message: "duplicate key value" } } });
    await expect(updateCity(fake as never, "c1", "Berlin")).rejects.toMatchObject({ code: "23505" });
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
