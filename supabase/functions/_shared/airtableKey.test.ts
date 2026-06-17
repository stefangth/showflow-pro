import { assertEquals } from "./test-asserts.ts";
import { normalizeCityName, buildCityKey, buildProgramKey } from "./airtableKey.ts";

Deno.test("normalizeCityName trims and lowercases (locale-independent)", () => {
  assertEquals(normalizeCityName(" Berlin "), "berlin");
  assertEquals(normalizeCityName("BERLIN"), "berlin");
  assertEquals(normalizeCityName("München"), "münchen");
  assertEquals(normalizeCityName(null), "");
  assertEquals(normalizeCityName(undefined), "");
});

Deno.test("buildCityKey is case-insensitive; blank → null", () => {
  assertEquals(buildCityKey(" Berlin "), "berlin");
  assertEquals(buildCityKey("BERLIN"), "berlin");
  assertEquals(buildCityKey(""), null);
  assertEquals(buildCityKey("   "), null);
});

Deno.test("buildProgramKey is unchanged (case-preserving)", () => {
  assertEquals(buildProgramKey(null, "TJE: Murder"), "TJE: Murder");
  assertEquals(buildProgramKey("TJE", "TJE: Murder"), "TJE|TJE: Murder");
});
Deno.test("buildProgramKey: program value alone when sub-program absent", () => {
  assertEquals(buildProgramKey("TJE", null), "TJE");
});
Deno.test("buildProgramKey: trims; null when nothing usable", () => {
  assertEquals(buildProgramKey(null, "  "), null);
  assertEquals(buildProgramKey("  ", null), null);
  assertEquals(buildProgramKey(undefined, undefined), null);
});
