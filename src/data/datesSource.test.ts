import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchDatesSource, saveDatesSource } from "./datesSource";

describe("fetchDatesSource", () => {
  it("returns null when no setting is stored", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    expect(await fetchDatesSource(fake as never, "org-1")).toBeNull();
  });

  it("returns the org's stored source", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: "org-1", value: "airtable" }], error: null },
    });
    expect(await fetchDatesSource(fake as never, "org-1")).toBe("airtable");
  });

  it("prefers the org override over the platform default", async () => {
    const fake = createFakeSupabase({
      app_settings: {
        data: [
          { org_id: null, value: "manual" },
          { org_id: "org-1", value: "sheet" },
        ],
        error: null,
      },
    });
    expect(await fetchDatesSource(fake as never, "org-1")).toBe("sheet");
  });

  it("falls back to null when the stored value is not a recognized source", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: "org-1", value: "bogus" }], error: null },
    });
    expect(await fetchDatesSource(fake as never, "org-1")).toBeNull();
  });

  it("throws on query error", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: { message: "boom" } } });
    await expect(fetchDatesSource(fake as never, "org-1")).rejects.toBeTruthy();
  });
});

describe("saveDatesSource", () => {
  it("upserts the getrunning_dates_source key with the conflict target org_id,key", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: null } });
    await saveDatesSource(fake as never, "org-1", "airtable");
    expect(fake.calls).toContainEqual({
      table: "app_settings",
      method: "upsert",
      args: [
        { org_id: "org-1", key: "getrunning_dates_source", value: "airtable" },
        { onConflict: "org_id,key" },
      ],
    });
  });

  it("throws on upsert error", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: { message: "no" } } });
    await expect(saveDatesSource(fake as never, "org-1", "sheet")).rejects.toBeTruthy();
  });
});
