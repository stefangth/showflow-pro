import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { saveAirtableKey, fetchAirtableKeyStatus, deleteAirtableKey } from "./airtableKey";

describe("saveAirtableKey", () => {
  it("calls set_org_airtable_key with org + key", async () => {
    const fake = createFakeSupabase({ "rpc:set_org_airtable_key": { data: null, error: null } });
    await saveAirtableKey(fake as never, "org-1", "key_abc");
    expect(fake.calls).toContainEqual({ table: "rpc:set_org_airtable_key", method: "rpc", args: [{ _org: "org-1", _key: "key_abc" }] });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:set_org_airtable_key": { data: null, error: { message: "forbidden" } } });
    await expect(saveAirtableKey(fake as never, "org-1", "k")).rejects.toBeTruthy();
  });
});

describe("fetchAirtableKeyStatus", () => {
  it("returns present + updatedAt from the table row", async () => {
    const fake = createFakeSupabase({ "rpc:get_org_airtable_key_status": { data: [{ present: true, updated_at: "2026-06-22T17:44:00Z" }], error: null } });
    const res = await fetchAirtableKeyStatus(fake as never, "org-1");
    expect(res).toEqual({ present: true, updatedAt: "2026-06-22T17:44:00Z" });
    expect(fake.calls).toContainEqual({ table: "rpc:get_org_airtable_key_status", method: "rpc", args: [{ _org: "org-1" }] });
  });
  it("treats an absent key (or empty result) as not present", async () => {
    const fake = createFakeSupabase({ "rpc:get_org_airtable_key_status": { data: [], error: null } });
    const res = await fetchAirtableKeyStatus(fake as never, "org-1");
    expect(res).toEqual({ present: false, updatedAt: null });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:get_org_airtable_key_status": { data: null, error: { message: "forbidden" } } });
    await expect(fetchAirtableKeyStatus(fake as never, "org-1")).rejects.toBeTruthy();
  });
});

describe("deleteAirtableKey", () => {
  it("calls delete_org_airtable_key with org", async () => {
    const fake = createFakeSupabase({ "rpc:delete_org_airtable_key": { data: null, error: null } });
    await deleteAirtableKey(fake as never, "org-1");
    expect(fake.calls).toContainEqual({ table: "rpc:delete_org_airtable_key", method: "rpc", args: [{ _org: "org-1" }] });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:delete_org_airtable_key": { data: null, error: { message: "forbidden" } } });
    await expect(deleteAirtableKey(fake as never, "org-1")).rejects.toBeTruthy();
  });
});
