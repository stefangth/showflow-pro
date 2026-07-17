import { assertEquals } from "./test-asserts.ts";
import {
  ORDER_FIELD_KEYS,
  formatMoney,
  formatOrderNo,
  orderReadyIssues,
  resolveFields,
  withCollisionSuffix,
} from "./hireOrders.ts";

Deno.test("ORDER_FIELD_KEYS: lists every order field key exactly once, in a fixed order", () => {
  assertEquals(ORDER_FIELD_KEYS, [
    "artist_name",
    "recipient_email",
    "role",
    "cast",
    "date",
    "venue",
    "city",
    "duration_min",
    "sessions",
    "fee",
    "currency",
    "notes",
  ]);
  assertEquals(new Set(ORDER_FIELD_KEYS).size, ORDER_FIELD_KEYS.length);
});

Deno.test("resolveFields: applies precedence manual > sheet > showflow > default with source tags", () => {
  const out = resolveFields({
    defaults: { currency: "EUR", fee: "1000" },
    showflow: { artist_name: "Mara", venue: "Colosseum", fee: "2000" },
    sheet: { venue: "Palladium", fee: "3000" },
    manual: { fee: "4500" },
  });
  assertEquals(out.artist_name, { value: "Mara", source: "showflow" });
  assertEquals(out.venue, { value: "Palladium", source: "sheet" });
  assertEquals(out.fee, { value: "4500", source: "manual" });
  assertEquals(out.currency, { value: "EUR", source: "default" });
});

Deno.test("resolveFields: skips undefined and empty-string layer values", () => {
  const out = resolveFields({ showflow: { venue: "X" }, sheet: { venue: "" }, manual: { venue: undefined } });
  assertEquals(out.venue, { value: "X", source: "showflow" });
});

Deno.test("formatOrderNo: renders the default pattern", () => {
  assertEquals(
    formatOrderNo("{prefix}-{yyyy}-{mmdd}-{cast|seq}", { prefix: "HO", date: "2026-06-15", castCode: "B1", seq: 7 }),
    "HO-2026-0615-B1",
  );
  assertEquals(
    formatOrderNo("{prefix}-{yyyy}-{mmdd}-{cast|seq}", { prefix: "HO", date: "2026-06-15", seq: 7 }),
    "HO-2026-0615-7",
  );
});

Deno.test("withCollisionSuffix: suffixes collisions", () => {
  assertEquals(withCollisionSuffix("HO-2026-0615-B1", 0), "HO-2026-0615-B1");
  assertEquals(withCollisionSuffix("HO-2026-0615-B1", 1), "HO-2026-0615-B1-2");
  assertEquals(withCollisionSuffix("HO-2026-0615-B1", 2), "HO-2026-0615-B1-3");
});

Deno.test("formatMoney: formats with two decimals and thousands separators", () => {
  assertEquals(formatMoney("4500", "EUR"), "€4,500.00");
  assertEquals(formatMoney(4500.5, "EUR"), "€4,500.50");
});

Deno.test("formatMoney: prefixes each known currency with its symbol", () => {
  assertEquals(formatMoney("4500", "USD"), "$4,500.00");
  // CHF's trailing space is deliberate: it reads as a word, not a glyph.
  assertEquals(formatMoney("4500", "CHF"), "CHF 4,500.00");
});

Deno.test("formatMoney: falls back to a spaced currency code when the symbol is unknown", () => {
  assertEquals(formatMoney("4500", "SEK"), "SEK 4,500.00");
});

Deno.test("orderReadyIssues: ready gate requires fee, recipient email, date, and letterhead legal name", () => {
  const issues = orderReadyIssues({}, {});
  for (const code of ["missing_fee", "missing_recipient_email", "missing_date", "missing_letterhead"]) {
    if (!issues.includes(code)) {
      throw new Error(`expected issues to include ${code}, got ${JSON.stringify(issues)}`);
    }
  }
  const ok = resolveFields({ manual: { fee: "4500", recipient_email: "a@b.de", date: "2026-06-15", artist_name: "M" } });
  assertEquals(orderReadyIssues(ok, { legal_name: "Aurora GmbH" }), []);
});
