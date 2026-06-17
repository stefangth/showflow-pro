import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchLatestSyncLog, fetchUnresolvedRecords } from "./airtableSync";
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

  it("fetchUnresolvedRecords returns held + errored rows (excludes imported/updated) with their action", async () => {
    const rows = [
      { id: "r1", airtable_record_id: "recA", reason: "program 'X' not linked", created_at: "2026-06-17T10:00:00Z", action: "held_unresolved" },
      { id: "r2", airtable_record_id: "recB", reason: "insert failed: duplicate key", created_at: "2026-06-17T10:01:00Z", action: "error" },
      { id: "r3", airtable_record_id: "recC", reason: null, created_at: "2026-06-17T10:02:00Z", action: "imported_new" },
    ];
    const fake = createFakeSupabase({ airtable_sync_record_log: { data: rows, error: null } });
    const out = await fetchUnresolvedRecords(asClient(fake), "log-1");
    // The .in("action", [...]) filter excludes the imported_new row.
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.action).sort()).toEqual(["error", "held_unresolved"]);
  });

  it("fetchUnresolvedRecords returns [] when syncLogId is null", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchUnresolvedRecords(asClient(fake), null)).toEqual([]);
  });
});
