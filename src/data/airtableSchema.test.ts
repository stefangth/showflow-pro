import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchAirtableBases, fetchAirtableTables } from "./airtableSchema";

describe("airtableSchema data-access", () => {
  it("fetchAirtableBases returns bases and sends org_id in the body", async () => {
    const fake = createFakeSupabase({
      "fn:airtable-schema": { data: { schemaAccessible: true, bases: [{ id: "appA", name: "Base A" }] }, error: null },
    });
    const res = await fetchAirtableBases(fake as never, "org-1");
    expect(res).toEqual({ schemaAccessible: true, bases: [{ id: "appA", name: "Base A" }] });
    // The fake records functions.invoke as args=[body] (the body object directly).
    expect(fake.calls).toContainEqual({ table: "fn:airtable-schema", method: "invoke", args: [{ org_id: "org-1" }] });
  });

  it("fetchAirtableTables sends org_id + baseId and returns tables", async () => {
    const fake = createFakeSupabase({
      "fn:airtable-schema": { data: { schemaAccessible: true, tables: [{ id: "tbl1", name: "Events", fields: [{ id: "f1", name: "Datum", type: "date" }] }] }, error: null },
    });
    const res = await fetchAirtableTables(fake as never, "org-1", "appA");
    expect(res.tables?.[0].name).toBe("Events");
    expect(fake.calls).toContainEqual({ table: "fn:airtable-schema", method: "invoke", args: [{ org_id: "org-1", baseId: "appA" }] });
  });

  it("maps schemaAccessible:false (no bases)", async () => {
    const fake = createFakeSupabase({ "fn:airtable-schema": { data: { schemaAccessible: false }, error: null } });
    const res = await fetchAirtableBases(fake as never, "org-1");
    expect(res.schemaAccessible).toBe(false);
    expect(res.bases).toBeUndefined();
  });

  it("throws the function-level error", async () => {
    const fake = createFakeSupabase({ "fn:airtable-schema": { data: { error: "No Airtable key configured" }, error: null } });
    await expect(fetchAirtableBases(fake as never, "org-1")).rejects.toThrow("No Airtable key configured");
  });
});
