import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchAirtableSettings } from "./airtableSettings";

describe("fetchAirtableSettings", () => {
  it("returns typed defaults when no rows exist", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    const s = await fetchAirtableSettings(fake as never, "org-1");
    expect(s).toEqual({
      airtable_sync_enabled: false,
      airtable_base_id: "",
      airtable_table_name: "",
      airtable_field_map: {},
    });
  });

  it("prefers the org row over the platform default per key", async () => {
    const fake = createFakeSupabase({
      app_settings: {
        data: [
          { key: "airtable_base_id", value: "appPLATFORM", org_id: null },
          { key: "airtable_base_id", value: "appORG", org_id: "org-1" },
          { key: "airtable_table_name", value: "Events", org_id: "org-1" },
          { key: "airtable_field_map", value: { date: "Date", city: "City" }, org_id: "org-1" },
          { key: "airtable_sync_enabled", value: true, org_id: "org-1" },
        ],
        error: null,
      },
    });
    const s = await fetchAirtableSettings(fake as never, "org-1");
    expect(s.airtable_base_id).toBe("appORG");
    expect(s.airtable_table_name).toBe("Events");
    expect(s.airtable_field_map).toEqual({ date: "Date", city: "City" });
    expect(s.airtable_sync_enabled).toBe(true);
  });

  it("throws when the query errors", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: { message: "boom" } } });
    await expect(fetchAirtableSettings(fake as never, "org-1")).rejects.toBeTruthy();
  });
});
