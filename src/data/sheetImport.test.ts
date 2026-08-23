import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { SheetDateRaw } from "@/lib/sheetImport/mapRows";
import {
  fetchSheetImportSettings, saveSheetImportSettings, fetchSheetHeaders, importSheetDates,
} from "./sheetImport";

const asClient = (f: ReturnType<typeof createFakeSupabase>) => f as unknown as SupabaseClient<Database>;

describe("fetchSheetImportSettings", () => {
  it("returns the default { url: '', map: {} } when there is no saved row", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    const out = await fetchSheetImportSettings(asClient(fake), "org-1");
    expect(out).toEqual({ url: "", map: {} });
  });

  it("returns the org's saved settings when present", async () => {
    const saved = { url: "https://docs.google.com/spreadsheets/d/x/export?format=csv", map: { program: "Program", date: "Date" } };
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: "org-1", value: saved }], error: null },
    });
    const out = await fetchSheetImportSettings(asClient(fake), "org-1");
    expect(out).toEqual(saved);
  });
});

describe("saveSheetImportSettings", () => {
  it("upserts app_settings under the sheet_import_settings key", async () => {
    const fake = createFakeSupabase({});
    const settings = { url: "https://example.com/sheet.csv", map: { program: "Program", date: "Date" } };
    await saveSheetImportSettings(asClient(fake), "org-1", settings);
    expect(fake.calls).toContainEqual({
      table: "app_settings",
      method: "upsert",
      args: [{ org_id: "org-1", key: "sheet_import_settings", value: settings }, { onConflict: "org_id,key" }],
    });
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: { message: "boom" } } });
    await expect(saveSheetImportSettings(asClient(fake), "org-1", { url: "", map: {} })).rejects.toBeTruthy();
  });
});

describe("fetchSheetHeaders", () => {
  it("fetches the CSV via the proxy and returns the parsed headers", async () => {
    const csv = "Program,Date\nShowA,2026-01-01\n";
    const fake = createFakeSupabase({ "fn:fetch-remote-sheet": { data: { csv }, error: null } });
    const out = await fetchSheetHeaders(asClient(fake), "org-1", "https://example.com/sheet.csv");
    expect(out).toEqual(["Program", "Date"]);
    expect(fake.calls).toContainEqual({
      table: "fn:fetch-remote-sheet",
      method: "invoke",
      args: [{ org_id: "org-1", url: "https://example.com/sheet.csv" }],
    });
  });
});

describe("importSheetDates", () => {
  it("invokes import-sheet-dates with org_id + rows and returns the result", async () => {
    const rows: SheetDateRaw[] = [
      { program: "ShowA", subProgram: "", date: "2026-01-01", city: "Berlin", session_1: "19:00", session_2: null, session_3: null, venue: null, rowIndex: 1 },
    ];
    const result = { processed: 1, new_dates: 1, updated: 0, held: 0, tiers_opened: 1 };
    const fake = createFakeSupabase({ "fn:import-sheet-dates": { data: result, error: null } });
    const out = await importSheetDates(asClient(fake), "org-1", rows);
    expect(out).toEqual(result);
    expect(fake.calls).toContainEqual({
      table: "fn:import-sheet-dates",
      method: "invoke",
      args: [{ org_id: "org-1", rows }],
    });
  });

  it("throws when the edge function returns an error", async () => {
    const fake = createFakeSupabase({ "fn:import-sheet-dates": { data: null, error: { message: "boom" } } });
    await expect(importSheetDates(asClient(fake), "org-1", [])).rejects.toBeTruthy();
  });
});
