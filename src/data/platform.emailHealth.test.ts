import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchEmailHealth } from "@/data/platform";
import type { Database } from "@/integrations/supabase/types";

const asClient = (fake: ReturnType<typeof createFakeSupabase>) =>
  fake as unknown as SupabaseClient<Database>;

describe("fetchEmailHealth", () => {
  it("calls get_email_health with p_window_minutes and maps snake_case to camelCase", async () => {
    const fake = createFakeSupabase({
      "rpc:get_email_health": {
        data: {
          attempted: 241, sent: 241, delivered: 233, delayed: 1, bounced: 7, complained: 0,
          failed: 2, suppressed: 5, delivery_rate: 0.967, bounce_rate: 0.029, complaint_rate: 0,
          failure_count: 2, last_event_at: "2026-07-11T08:00:00Z",
          by_template: [{ template_name: "offer_digest", sent: 210, delivered: 204, bounced: 6, failed: 0, delivery_rate: 0.971 }],
          recent_issues: [{ recipient_email: "b@gmail.com", template_name: "offer_digest", status: "bounced", error_message: "no mailbox", occurred_at: "2026-07-11T06:00:00Z" }],
        },
        error: null,
      },
    });

    const h = await fetchEmailHealth(asClient(fake), 1440);

    expect(h.attempted).toBe(241);
    expect(h.sent).toBe(241);
    expect(h.delivered).toBe(233);
    expect(h.delayed).toBe(1);
    expect(h.bounced).toBe(7);
    expect(h.complained).toBe(0);
    expect(h.failed).toBe(2);
    expect(h.suppressed).toBe(5);
    expect(h.deliveryRate).toBeCloseTo(0.967);
    expect(h.bounceRate).toBeCloseTo(0.029);
    expect(h.complaintRate).toBeCloseTo(0);
    expect(h.failureCount).toBe(2);
    expect(h.lastEventAt).toBe("2026-07-11T08:00:00Z");

    expect(h.byTemplate).toHaveLength(1);
    expect(h.byTemplate[0]).toEqual({
      templateName: "offer_digest", sent: 210, delivered: 204, bounced: 6, failed: 0, deliveryRate: 0.971,
    });

    expect(h.recentIssues).toHaveLength(1);
    expect(h.recentIssues[0]).toEqual({
      recipientEmail: "b@gmail.com", templateName: "offer_digest", status: "bounced",
      errorMessage: "no mailbox", occurredAt: "2026-07-11T06:00:00Z",
    });

    expect(fake.calls).toContainEqual({
      table: "rpc:get_email_health", method: "rpc", args: [{ p_window_minutes: 1440 }],
    });
  });

  it("coerces string-typed JSONB rate fields with Number(...)", async () => {
    // Postgres numeric columns can arrive over the wire as strings (JSON has no numeric-precision
    // guarantee for `numeric`), so the mapper must coerce, not just pass through.
    const fake = createFakeSupabase({
      "rpc:get_email_health": {
        data: {
          attempted: 10, sent: 10, delivered: 9, delayed: 0, bounced: 1, complained: 0,
          failed: 0, suppressed: 0,
          delivery_rate: "0.9", bounce_rate: "0.1", complaint_rate: "0",
          failure_count: 0, last_event_at: null, by_template: [], recent_issues: [],
        },
        error: null,
      },
    });

    const h = await fetchEmailHealth(asClient(fake), 1440);

    expect(h.deliveryRate).toBe(0.9);
    expect(h.bounceRate).toBe(0.1);
    expect(h.complaintRate).toBe(0);
    expect(h.lastEventAt).toBeNull();
    expect(h.byTemplate).toEqual([]);
    expect(h.recentIssues).toEqual([]);
  });

  it("returns zeroed defaults when the RPC yields no data", async () => {
    const fake = createFakeSupabase({ "rpc:get_email_health": { data: null, error: null } });
    const h = await fetchEmailHealth(asClient(fake), 1440);
    expect(h.attempted).toBe(0);
    expect(h.deliveryRate).toBe(0);
    expect(h.lastEventAt).toBeNull();
    expect(h.byTemplate).toEqual([]);
    expect(h.recentIssues).toEqual([]);
  });

  it("throws on an RPC error", async () => {
    const fake = createFakeSupabase({ "rpc:get_email_health": { data: null, error: { message: "denied" } } });
    await expect(fetchEmailHealth(asClient(fake), 1440)).rejects.toThrow("denied");
  });
});
