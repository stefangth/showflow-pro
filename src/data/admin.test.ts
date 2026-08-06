import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchAdminAuditLogs, fetchAdminSyncLogs, fetchAdminStats } from "./admin";

describe("fetchAdminAuditLogs", () => {
  it("selects newest-first with the artist join and applies the limit", async () => {
    const rows = [{ id: "log-1", action: "confirm", booking: { artist: { name: "Ada" } } }];
    const fake = createFakeSupabase({ booking_audit_log: { data: rows, error: null } });
    const res = await fetchAdminAuditLogs(fake as never, 50, "org-1");
    expect(res).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "booking_audit_log", method: "select", args: ["*, booking:bookings(artist:artists(name))"] });
    expect(fake.calls).toContainEqual({ table: "booking_audit_log", method: "order", args: ["created_at", { ascending: false }] });
    expect(fake.calls).toContainEqual({ table: "booking_audit_log", method: "limit", args: [50] });
  });

  it("returns [] when data is null", async () => {
    const fake = createFakeSupabase({ booking_audit_log: { data: null, error: null } });
    expect(await fetchAdminAuditLogs(fake as never, 50, "org-1")).toEqual([]);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ booking_audit_log: { data: null, error: { message: "boom" } } });
    await expect(fetchAdminAuditLogs(fake as never, 50, "org-1")).rejects.toBeTruthy();
  });
});

describe("fetchAdminSyncLogs", () => {
  it("selects newest-first by synced_at with the limit", async () => {
    const rows = [{ id: "s-1", status: "success", sync_type: "poll", records_processed: 4 }];
    const fake = createFakeSupabase({ airtable_sync_log: { data: rows, error: null } });
    const res = await fetchAdminSyncLogs(fake as never, 20, "org-1");
    expect(res).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "airtable_sync_log", method: "order", args: ["synced_at", { ascending: false }] });
    expect(fake.calls).toContainEqual({ table: "airtable_sync_log", method: "limit", args: [20] });
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ airtable_sync_log: { data: null, error: { message: "boom" } } });
    await expect(fetchAdminSyncLogs(fake as never, 20, "org-1")).rejects.toBeTruthy();
  });
});

describe("fetchAdminStats", () => {
  it("returns head counts per table", async () => {
    const fake = createFakeSupabase({
      shows: { data: null, count: 5, error: null },
      artists: { data: null, count: 12, error: null },
      bookings: { data: null, count: 30, error: null },
    });
    const stats = await fetchAdminStats(fake as never, "org-1");
    expect(stats).toEqual({ shows: 5, artists: 12, bookings: 30 });
    // Server-side head counts: no row data transferred.
    expect(fake.calls).toContainEqual({ table: "shows", method: "select", args: ["*", { count: "exact", head: true }] });
    expect(fake.calls).toContainEqual({ table: "artists", method: "select", args: ["*", { count: "exact", head: true }] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "select", args: ["*", { count: "exact", head: true }] });
  });

  it("defaults missing counts to 0", async () => {
    const fake = createFakeSupabase({
      shows: { data: null, count: null, error: null },
      artists: { data: null, count: null, error: null },
      bookings: { data: null, count: null, error: null },
    });
    expect(await fetchAdminStats(fake as never, "org-1")).toEqual({ shows: 0, artists: 0, bookings: 0 });
  });
});
