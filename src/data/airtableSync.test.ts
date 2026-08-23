import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchLatestSyncLog, fetchRecentSyncLogs, fetchUnresolvedRecords } from "./airtableSync";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const asClient = (f: ReturnType<typeof createFakeSupabase>) => f as unknown as SupabaseClient<Database>;

describe("airtableSync data fns", () => {
  it("fetchLatestSyncLog returns null when there is no row", async () => {
    const fake = createFakeSupabase({ airtable_sync_log: { data: null, error: null } });
    expect(await fetchLatestSyncLog(asClient(fake), "org-1")).toBeNull();
  });

  it("fetchLatestSyncLog returns the most recent log row", async () => {
    const row = { id: "log-1", sync_type: "airtable_poll", status: "partial", imported_count: 3, new_count: 2, updated_count: 1, held_count: 4, synced_at: "2026-06-17T10:00:00Z" };
    const fake = createFakeSupabase({ airtable_sync_log: { data: row, error: null } });
    const out = await fetchLatestSyncLog(asClient(fake), "org-1");
    expect(out?.id).toBe("log-1");
    expect(out?.held_count).toBe(4);
    expect(out?.sync_type).toBe("airtable_poll");
  });

  it("fetchLatestSyncLog returns the newer of an airtable_poll and a sheet_import run", async () => {
    // The fake doesn't apply order()/limit() itself, so — like the test above — it is
    // seeded with the single row the real DB's `.order(...).limit(1)` would hand back:
    // here, a sheet_import run that is newer than a would-be airtable_poll row.
    const newest = { id: "log-2", sync_type: "sheet_import", status: "success", imported_count: 5, new_count: 5, updated_count: 0, held_count: 0, synced_at: "2026-08-14T09:12:00Z" };
    const fake = createFakeSupabase({ airtable_sync_log: { data: newest, error: null } });
    const out = await fetchLatestSyncLog(asClient(fake), "org-1");
    expect(out?.id).toBe("log-2");
    expect(out?.sync_type).toBe("sheet_import");
    // Both source types are allow-listed, so this sheet_import row isn't filtered out.
    expect(fake.calls).toContainEqual({ table: "airtable_sync_log", method: "in", args: ["sync_type", ["airtable_poll", "sheet_import"]] });
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

  it("fetchRecentSyncLogs returns [] when there is no org", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchRecentSyncLogs(asClient(fake), null)).toEqual([]);
  });

  it("fetchRecentSyncLogs returns the rows, newest first, limited", async () => {
    const rows = [
      { id: "a", sync_type: "airtable_poll", status: "success", imported_count: 1, new_count: 1, updated_count: 0, held_count: 0, error_details: null, synced_at: "2026-08-14T09:12:00Z" },
      { id: "b", sync_type: "airtable_poll", status: "partial", imported_count: 2, new_count: 1, updated_count: 1, held_count: 3, error_details: null, synced_at: "2026-08-14T08:42:00Z" },
    ];
    const fake = createFakeSupabase({ airtable_sync_log: { data: rows, error: null } });
    const out = await fetchRecentSyncLogs(asClient(fake), "org-1", 5);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("a");
    expect(fake.calls).toContainEqual({ table: "airtable_sync_log", method: "order", args: ["synced_at", { ascending: false }] });
    expect(fake.calls).toContainEqual({ table: "airtable_sync_log", method: "limit", args: [5] });
  });

  it("fetchRecentSyncLogs returns Airtable poll and Sheet import runs together, newest first, each tagged with sync_type", async () => {
    const rows = [
      { id: "s1", sync_type: "sheet_import", status: "success", imported_count: 1, new_count: 1, updated_count: 0, held_count: 0, error_details: null, synced_at: "2026-08-14T09:12:00Z" },
      { id: "p1", sync_type: "airtable_poll", status: "partial", imported_count: 2, new_count: 1, updated_count: 1, held_count: 3, error_details: null, synced_at: "2026-08-14T08:42:00Z" },
    ];
    const fake = createFakeSupabase({ airtable_sync_log: { data: rows, error: null } });
    const out = await fetchRecentSyncLogs(asClient(fake), "org-1", 10);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "s1", sync_type: "sheet_import" });
    expect(out[1]).toMatchObject({ id: "p1", sync_type: "airtable_poll" });
    // The .in() allow-list is exactly these two types, so an unrelated future
    // sync_type wouldn't silently leak into this console.
    expect(fake.calls).toContainEqual({ table: "airtable_sync_log", method: "in", args: ["sync_type", ["airtable_poll", "sheet_import"]] });
  });
});
