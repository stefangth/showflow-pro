import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchCitiesForLinking, linkCityAirtableKey, importCitiesFromOptions } from "./cities";

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
});
