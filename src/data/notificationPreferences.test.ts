import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchMyNotificationPreferences, updateMyNotificationPreferences } from "./notificationPreferences";

describe("fetchMyNotificationPreferences", () => {
  it("selects the prefs row and returns the map", async () => {
    const fake = createFakeSupabase({
      notification_preferences: { data: { prefs: { at_risk: { email: false } } }, error: null },
    });
    const result = await fetchMyNotificationPreferences(fake as never, "u1");
    expect(result).toEqual({ at_risk: { email: false } });
    expect(fake.calls).toContainEqual({ table: "notification_preferences", method: "eq", args: ["user_id", "u1"] });
  });

  it("returns {} when there is no row", async () => {
    const fake = createFakeSupabase({ notification_preferences: { data: null, error: null } });
    expect(await fetchMyNotificationPreferences(fake as never, "u1")).toEqual({});
  });
});

describe("updateMyNotificationPreferences", () => {
  it("upserts the prefs map keyed by user_id", async () => {
    const fake = createFakeSupabase({ notification_preferences: { data: null, error: null } });
    await updateMyNotificationPreferences(fake as never, "u1", { at_risk: { email: false } });
    expect(fake.calls).toContainEqual({
      table: "notification_preferences", method: "upsert",
      args: [{ user_id: "u1", prefs: { at_risk: { email: false } } }, { onConflict: "user_id" }],
    });
  });
});
