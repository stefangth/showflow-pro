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

  it("defaults to v3 on when no row exists", async () => {
    // v3 is the app default now (the build-flag fork was retired from the runtime path),
    // so an org with no override resolves to true.
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    const enabled = await fetchGetRunningV3Enabled(asSupabase(fake), "org-1");
    expect(enabled).toBe(true);
  });

  it("returns the org override when a false row exists", async () => {
    // The one way back to the v1 board: an explicit false override (super-admin toggle).
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: "org-1", value: false }], error: null },
    });
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
