import { assertEquals } from "./test-asserts.ts";
import { buildProgramKey, buildCityKey } from "./airtableKey.ts";

Deno.test("buildProgramKey: sub-program alone when program absent", () => {
  assertEquals(buildProgramKey(null, "TJE: Murder"), "TJE: Murder");
});
Deno.test("buildProgramKey: composite when both present", () => {
  assertEquals(buildProgramKey("TJE", "TJE: Murder"), "TJE|TJE: Murder");
});
Deno.test("buildProgramKey: trims; null when nothing usable", () => {
  assertEquals(buildProgramKey(null, "  "), null);
  assertEquals(buildProgramKey("  ", null), null);
});
Deno.test("buildCityKey: trims; blank → null", () => {
  assertEquals(buildCityKey(" Berlin "), "Berlin");
  assertEquals(buildCityKey(""), null);
});
