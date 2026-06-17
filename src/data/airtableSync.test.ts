import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchLatestSyncLog, fetchHeldRecords } from "./airtableSync";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const asClient = (f: ReturnType<typeof createFakeSupabase>) => f as unknown as SupabaseClient<Database>;

describe("airtableSync data fns", () => {
  it("fetchLatestSyncLog returns null when there is no row", async () => {
    const fake = createFakeSupabase({ airtable_sync_log: { data: null, error: null } });
    expect(await fetchLatestSyncLog(asClient(fake), "org-1")).toBeNull();
  });

  it("fetchLatestSyncLog returns the most recent log row", async () => {
    const row = { id: "log-1", status: "partial", imported_count: 3, new_count: 2, updated_count: 1, held_count: 4, synced_at: "2026-06-17T10:00:00Z" };
    const fake = createFakeSupabase({ airtable_sync_log: { data: row, error: null } });
    const out = await fetchLatestSyncLog(asClient(fake), "org-1");
    expect(out?.id).toBe("log-1");
    expect(out?.held_count).toBe(4);
  });

  it("fetchHeldRecords returns only the held rows for a log", async () => {
    const held = [{ id: "r1", airtable_record_id: "recA", reason: "program 'X' not linked", created_at: "2026-06-17T10:00:00Z", raw_fields: {} }];
    const fake = createFakeSupabase({ airtable_sync_record_log: { data: held, error: null } });
    const out = await fetchHeldRecords(asClient(fake), "log-1");
    expect(out).toHaveLength(1);
    expect(out[0].airtable_record_id).toBe("recA");
  });

  it("fetchHeldRecords returns [] when syncLogId is null", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchHeldRecords(asClient(fake), null)).toEqual([]);
  });
});
