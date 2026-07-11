import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveEmailStatus } from "./emailHealth.ts";

const snap = (o: Record<string, number>) => ({
  attempted: 0, sent: 0, delivered: 0, delayed: 0, bounced: 0, complained: 0, failed: 0,
  suppressed: 0, delivery_rate: 0, bounce_rate: 0, complaint_rate: 0, failure_count: 0, ...o,
});

Deno.test("mirror of frontend derivation", () => {
  assertEquals(deriveEmailStatus(snap({})), "operational");                                   // idle
  assertEquals(deriveEmailStatus(snap({ attempted: 30, sent: 30 })), "stale");                 // no webhooks
  assertEquals(deriveEmailStatus(snap({ attempted: 100, sent: 100, delivered: 94, bounced: 6, bounce_rate: 0.06 })), "down");
  assertEquals(deriveEmailStatus(snap({ attempted: 241, sent: 241, delivered: 233, bounced: 7, delivery_rate: 0.967, bounce_rate: 0.029 })), "degraded");
  assertEquals(deriveEmailStatus(snap({ attempted: 100, sent: 100, delivered: 100, delivery_rate: 1 })), "operational");
});
