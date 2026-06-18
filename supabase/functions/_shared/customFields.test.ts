import { assertEquals } from "./test-asserts.ts";
import { coerceCustomValue } from "./customFields.ts";

Deno.test("coerceCustomValue: number parses numeric strings and rejects NaN", () => {
  assertEquals(coerceCustomValue(42, "number"), { ok: true, value: 42 });
  assertEquals(coerceCustomValue("42", "number"), { ok: true, value: 42 });
  assertEquals(coerceCustomValue("nope", "number"), { ok: false });
});

Deno.test("coerceCustomValue: date keeps YYYY-MM-DD, rejects unparseable", () => {
  assertEquals(coerceCustomValue("2026-06-18", "date"), { ok: true, value: "2026-06-18" });
  assertEquals(coerceCustomValue("2026-06-18T10:00:00.000Z", "date"), { ok: true, value: "2026-06-18" });
  assertEquals(coerceCustomValue("not a date", "date"), { ok: false });
});

Deno.test("coerceCustomValue: boolean is true only when raw === true", () => {
  assertEquals(coerceCustomValue(true, "boolean"), { ok: true, value: true });
  assertEquals(coerceCustomValue("true", "boolean"), { ok: true, value: false });
});

Deno.test("coerceCustomValue: select/text stringify scalars, reject objects/arrays", () => {
  assertEquals(coerceCustomValue("Berlin", "select"), { ok: true, value: "Berlin" });
  assertEquals(coerceCustomValue("hello", "text"), { ok: true, value: "hello" });
  assertEquals(coerceCustomValue(["a", "b"], "text"), { ok: false });
});

Deno.test("coerceCustomValue: blank/missing values are omitted (ok:false)", () => {
  assertEquals(coerceCustomValue(null, "text"), { ok: false });
  assertEquals(coerceCustomValue(undefined, "number"), { ok: false });
  assertEquals(coerceCustomValue("", "text"), { ok: false });
});
