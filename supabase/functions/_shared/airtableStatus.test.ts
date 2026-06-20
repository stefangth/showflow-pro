import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isCancelledStatus } from "./airtableStatus.ts";

Deno.test("isCancelledStatus matches case- and space-insensitively", () => {
  assertEquals(isCancelledStatus("Cancelled", "Cancelled"), true);
  assertEquals(isCancelledStatus("  cancelled ", "Cancelled"), true);
  assertEquals(isCancelledStatus("CANCELLED", "cancelled"), true);
});
Deno.test("isCancelledStatus is false for non-matches and empty config", () => {
  assertEquals(isCancelledStatus("Confirmed", "Cancelled"), false);
  assertEquals(isCancelledStatus("Cancelled", ""), false);
  assertEquals(isCancelledStatus("Cancelled", null), false);
  assertEquals(isCancelledStatus(null, "Cancelled"), false);
  assertEquals(isCancelledStatus(undefined, "Cancelled"), false);
});
