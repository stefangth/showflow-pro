import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchAdminAuditLogs } from "./admin";

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
