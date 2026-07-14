import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchSettingsAudit } from "./settingsAudit";

describe("fetchSettingsAudit", () => {
  it("fetches entries for the org and keys, joining actor display names", async () => {
    const fake = createFakeSupabase({
      settings_audit_log: {
        data: [
          { id: "e1", key: "booking_flow", actor: "u1", old_value: null, new_value: {}, created_at: "2026-07-14T10:00:00Z" },
          { id: "e2", key: "offer_response_window_hours", actor: null, old_value: 72, new_value: 48, created_at: "2026-07-13T09:00:00Z" },
        ],
        error: null,
      },
      profiles: { data: [{ user_id: "u1", display_name: "Stefan S." }], error: null },
    });
    const entries = await fetchSettingsAudit(fake as never, { orgId: "org-1", keys: ["booking_flow", "offer_response_window_hours"] });
    expect(entries[0]).toMatchObject({ id: "e1", actorName: "Stefan S." });
    expect(entries[1]).toMatchObject({ id: "e2", actorName: null });
    expect(fake.calls).toContainEqual({ table: "settings_audit_log", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls.some((c) => c.table === "settings_audit_log" && c.method === "in")).toBe(true);
  });

  // Regression: the profiles lookup used to discard its error (destructuring only
  // `data`), so a failed join silently rendered every actorName as null instead of
  // surfacing the failure the way the main query already does.
  it("rejects when the profiles lookup errors", async () => {
    const fake = createFakeSupabase({
      settings_audit_log: {
        data: [
          { id: "e1", key: "booking_flow", actor: "u1", old_value: null, new_value: {}, created_at: "2026-07-14T10:00:00Z" },
        ],
        error: null,
      },
      profiles: { data: null, error: new Error("profiles lookup failed") },
    });
    await expect(
      fetchSettingsAudit(fake as never, { orgId: "org-1", keys: ["booking_flow"] }),
    ).rejects.toThrow("profiles lookup failed");
  });
});
