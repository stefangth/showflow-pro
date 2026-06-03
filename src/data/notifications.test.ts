import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from "./notifications";

describe("fetchNotifications", () => {
  it("queries notifications by user_id, newest first, limited to 50", async () => {
    const rows = [{ id: "n1" }, { id: "n2" }];
    const fake = createFakeSupabase({ notifications: { data: rows, error: null } });
    const result = await fetchNotifications(fake as never, "u1");
    expect(result).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "notifications", method: "eq", args: ["user_id", "u1"] });
    expect(fake.calls).toContainEqual({ table: "notifications", method: "order", args: ["created_at", { ascending: false }] });
    expect(fake.calls).toContainEqual({ table: "notifications", method: "limit", args: [50] });
  });

  it("returns [] when data is null", async () => {
    const fake = createFakeSupabase({ notifications: { data: null, error: null } });
    expect(await fetchNotifications(fake as never, "u1")).toEqual([]);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ notifications: { data: null, error: { message: "boom" } } });
    await expect(fetchNotifications(fake as never, "u1")).rejects.toBeTruthy();
  });
});

describe("markNotificationRead", () => {
  it("updates read=true filtered by id", async () => {
    const fake = createFakeSupabase({ notifications: { data: null, error: null } });
    await markNotificationRead(fake as never, "n1");
    expect(fake.calls).toContainEqual({ table: "notifications", method: "update", args: [{ read: true }] });
    expect(fake.calls).toContainEqual({ table: "notifications", method: "eq", args: ["id", "n1"] });
  });
});

describe("markAllNotificationsRead", () => {
  it("updates read=true filtered by user_id and unread only", async () => {
    const fake = createFakeSupabase({ notifications: { data: null, error: null } });
    await markAllNotificationsRead(fake as never, "u1");
    expect(fake.calls).toContainEqual({ table: "notifications", method: "update", args: [{ read: true }] });
    expect(fake.calls).toContainEqual({ table: "notifications", method: "eq", args: ["user_id", "u1"] });
    expect(fake.calls).toContainEqual({ table: "notifications", method: "eq", args: ["read", false] });
  });
});
