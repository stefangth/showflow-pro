import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchCustomFieldDefs, upsertCustomFieldDef, deleteCustomFieldDef } from "./customFields";

describe("customFields data-access", () => {
  it("fetchCustomFieldDefs selects for the org (and entity when given)", async () => {
    const rows = [{ id: "d1", org_id: "org-1", entity: "show_dates", key: "capacity", label: "Capacity",
      type: "number", source: "airtable", source_field: "Capacity", options: null, filterable: true, sortable: true }];
    const fake = createFakeSupabase({ custom_field_definitions: { data: rows, error: null } });
    const res = await fetchCustomFieldDefs(fake as never, { orgId: "org-1", entity: "show_dates" });
    expect(res).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "custom_field_definitions", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "custom_field_definitions", method: "eq", args: ["entity", "show_dates"] });
  });

  it("fetchCustomFieldDefs returns [] for null org (no query)", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchCustomFieldDefs(fake as never, { orgId: null })).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("upsertCustomFieldDef upserts with source=airtable on the (org,entity,key) conflict target", async () => {
    const fake = createFakeSupabase({ custom_field_definitions: { data: null, error: null } });
    await upsertCustomFieldDef(fake as never, {
      org_id: "org-1", entity: "show_dates", key: "capacity", label: "Capacity",
      type: "number", source_field: "Capacity",
    });
    expect(fake.calls).toContainEqual({
      table: "custom_field_definitions", method: "upsert",
      args: [
        { org_id: "org-1", entity: "show_dates", key: "capacity", label: "Capacity", type: "number", source_field: "Capacity", source: "airtable" },
        { onConflict: "org_id,entity,key" },
      ],
    });
  });

  it("deleteCustomFieldDef deletes by id", async () => {
    const fake = createFakeSupabase({ custom_field_definitions: { data: null, error: null } });
    await deleteCustomFieldDef(fake as never, "d1");
    expect(fake.calls).toContainEqual({ table: "custom_field_definitions", method: "delete", args: [] });
    expect(fake.calls).toContainEqual({ table: "custom_field_definitions", method: "eq", args: ["id", "d1"] });
  });

  it("upsertCustomFieldDef throws on error", async () => {
    const fake = createFakeSupabase({ custom_field_definitions: { data: null, error: { message: "nope" } } });
    await expect(upsertCustomFieldDef(fake as never, {
      org_id: "o", entity: "show_dates", key: "k", label: "L", type: "text", source_field: "F",
    })).rejects.toMatchObject({ message: "nope" });
  });
});
