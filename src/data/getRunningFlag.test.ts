import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import {
  GETRUNNING_V3_SETTING_KEY,
  fetchGetRunningV3Enabled,
  setGetRunningV3Enabled,
} from "./getRunningFlag";

describe("getRunningFlag data-access", () => {
  it("returns the org override when a true row exists", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: "org-1", value: true }], error: null },
    });
    const enabled = await fetchGetRunningV3Enabled(asSupabase(fake), "org-1");
    expect(enabled).toBe(true);
  });

  it("falls back to the build-flag default when no row exists", async () => {
    // GETRUNNING_V3 is false in the test env (VITE_GETRUNNING_V3 unset) → fallback false.
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    const enabled = await fetchGetRunningV3Enabled(asSupabase(fake), "org-1");
    expect(enabled).toBe(false);
  });

  it("upserts the org row on set", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: null } });
    await setGetRunningV3Enabled(asSupabase(fake), "org-1", true);
    expect(fake.calls).toContainEqual({
      table: "app_settings",
      method: "upsert",
      args: [
        { org_id: "org-1", key: GETRUNNING_V3_SETTING_KEY, value: true },
        { onConflict: "org_id,key" },
      ],
    });
  });

  it("throws when the upsert errors", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: { message: "boom" } } });
    await expect(setGetRunningV3Enabled(asSupabase(fake), "org-1", true)).rejects.toBeTruthy();
  });
});
