import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchCronHealth } from "@/data/platform";
import type { Database } from "@/integrations/supabase/types";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) =>
  fake as unknown as SupabaseClient<Database>;

describe("fetchCronHealth", () => {
  it("returns rows from the get_cron_health RPC", async () => {
    const fake = createFakeSupabase({
      "rpc:get_cron_health": {
        data: [{
          job_name: "offer-digest", schedule: "0 16-19 * * *", status: "failing",
          last_status_code: 404, last_ok_at: null, last_error: "HTTP 404",
          consecutive_failures: 1, last_run_at: null,
          recent_failures: [{ status_code: 404, error: "HTTP 404", observed_at: "2026-07-23T10:00:00Z" }],
        }],
        error: null,
      },
    });
    const rows = await fetchCronHealth(asClient(fake));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failing");
    expect((rows[0] as unknown as { recentFailures: Array<{ error: string | null }> }).recentFailures)
      .toEqual([{ status_code: 404, error: "HTTP 404", observed_at: "2026-07-23T10:00:00Z" }]);
    expect(fake.calls).toContainEqual({ table: "rpc:get_cron_health", method: "rpc", args: [undefined] });
  });

  it("returns an empty array when the RPC yields no rows", async () => {
    const fake = createFakeSupabase({ "rpc:get_cron_health": { data: null, error: null } });
    expect(await fetchCronHealth(asClient(fake))).toEqual([]);
  });

  it("throws on an RPC error", async () => {
    const fake = createFakeSupabase({ "rpc:get_cron_health": { data: null, error: { message: "denied" } } });
    await expect(fetchCronHealth(asClient(fake))).rejects.toThrow("denied");
  });
});
