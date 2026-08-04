import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchHealthDaily } from "./platform";

const row = {
  day: "2026-08-04", fn: "airtable-poll", runs: 288,
  failures: 1, rejected: 0, worst_status: 502, p95_ms: 4200,
};

describe("fetchHealthDaily", () => {
  it("calls get_health_daily with the requested window and maps the rows", async () => {
    const fake = createFakeSupabase({ "rpc:get_health_daily": { data: [row], error: null } });

    const rows = await fetchHealthDaily(fake as never, 30);

    expect(fake.calls).toContainEqual({
      table: "rpc:get_health_daily", method: "rpc", args: [{ p_days: 30 }],
    });
    expect(rows).toEqual([row]);
  });

  it("returns an empty list when nothing has been rolled up yet", async () => {
    const fake = createFakeSupabase({ "rpc:get_health_daily": { data: null, error: null } });
    expect(await fetchHealthDaily(fake as never, 30)).toEqual([]);
  });

  it("keeps a null worst_status and p95 rather than coercing them to 0", async () => {
    // An idle day has no status code at all; 0 would render as a real HTTP code in the tooltip.
    const fake = createFakeSupabase({
      "rpc:get_health_daily": { data: [{ ...row, worst_status: null, p95_ms: null }], error: null },
    });
    const [mapped] = await fetchHealthDaily(fake as never, 30);
    expect(mapped.worst_status).toBeNull();
    expect(mapped.p95_ms).toBeNull();
  });

  it("throws when the rpc errors so the panel can surface it", async () => {
    const fake = createFakeSupabase({
      "rpc:get_health_daily": { data: null, error: new Error("denied") },
    });
    await expect(fetchHealthDaily(fake as never, 30)).rejects.toThrow("denied");
  });
});
