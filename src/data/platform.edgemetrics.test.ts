import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchEdgeFnMetrics } from "@/data/platform";
import type { Database } from "@/integrations/supabase/types";

const asClient = (f: ReturnType<typeof createFakeSupabase>) => f as unknown as SupabaseClient<Database>;

describe("fetchEdgeFnMetrics", () => {
  it("invokes platform-edge-metrics with the window and returns the functions array", async () => {
    const fake = createFakeSupabase({
      "fn:platform-edge-metrics": {
        data: { functions: [{ fn: "airtable-poll", invocations: 3, errors: 1, p50Ms: 4000, p95Ms: 9000, lastInvokedAt: "2026-06-24T09:10:00Z", lastStatus: 500, recent: [] }] },
        error: null,
      },
    });
    const rows = await fetchEdgeFnMetrics(asClient(fake), 60);
    expect(rows).toHaveLength(1);
    expect(rows[0].fn).toBe("airtable-poll");
    expect(fake.calls).toContainEqual({ table: "fn:platform-edge-metrics", method: "invoke", args: [{ window_minutes: 60 }] });
  });

  it("returns [] when the function yields no body", async () => {
    const fake = createFakeSupabase({ "fn:platform-edge-metrics": { data: null, error: null } });
    expect(await fetchEdgeFnMetrics(asClient(fake), 60)).toEqual([]);
  });

  it("throws on an invoke error", async () => {
    const fake = createFakeSupabase({ "fn:platform-edge-metrics": { data: null, error: { message: "boom" } } });
    await expect(fetchEdgeFnMetrics(asClient(fake), 60)).rejects.toThrow("boom");
  });
});
