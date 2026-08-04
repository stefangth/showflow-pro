import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { toIsoTimestamp, analyticsDayKey } from "./analyticsTime.ts";

// The exact value the live Analytics API returned on 2026-08-04 for a health-rollup invocation.
const LIVE_MICROSECONDS = 1785867796145000;

Deno.test("reads the microsecond epoch the Analytics API actually returns", () => {
  assertEquals(toIsoTimestamp(LIVE_MICROSECONDS), "2026-08-04T18:23:16.145Z");
});

Deno.test("does not mistake microseconds for milliseconds", () => {
  // The bug this module exists to prevent: naive `new Date(µs)` lands in the year 58,000
  // without throwing, so every downstream day comparison silently matches nothing.
  assertEquals(new Date(LIVE_MICROSECONDS).getUTCFullYear() > 9999, true);
  assertEquals(new Date(toIsoTimestamp(LIVE_MICROSECONDS)!).getUTCFullYear(), 2026);
});

Deno.test("accepts a millisecond epoch", () => {
  assertEquals(toIsoTimestamp(1785867796145), "2026-08-04T18:23:16.145Z");
});

Deno.test("accepts a second epoch", () => {
  assertEquals(toIsoTimestamp(1785867796), "2026-08-04T18:23:16.000Z");
});

Deno.test("accepts a numeric epoch delivered as a string", () => {
  assertEquals(toIsoTimestamp("1785867796145000"), "2026-08-04T18:23:16.145Z");
});

Deno.test("accepts an ISO string unchanged in meaning", () => {
  assertEquals(toIsoTimestamp("2026-08-04T18:23:16.145Z"), "2026-08-04T18:23:16.145Z");
});

Deno.test("returns null for anything unreadable rather than a wrong date", () => {
  for (const bad of [null, undefined, "", "not-a-date", {}, [], NaN, 0, -1]) {
    assertEquals(toIsoTimestamp(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

Deno.test("analyticsDayKey yields the UTC calendar day", () => {
  assertEquals(analyticsDayKey(LIVE_MICROSECONDS), "2026-08-04");
  assertEquals(analyticsDayKey("garbage"), null);
});

Deno.test("analyticsDayKey uses UTC, not the host timezone", () => {
  // 23:30 UTC on 4 Aug is already 5 Aug in Berlin; the key must stay 2026-08-04 so it
  // matches what the rollup writes regardless of where the code runs.
  assertEquals(analyticsDayKey(Date.parse("2026-08-04T23:30:00Z") * 1000), "2026-08-04");
});
