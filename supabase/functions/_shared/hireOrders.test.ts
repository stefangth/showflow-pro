import { assertEquals } from "./test-asserts.ts";
import {
  ORDER_FIELD_KEYS,
  computeFeeTotal,
  defaultTemplateId,
  formatMoney,
  formatOrderNo,
  normalizeTermsSetting,
  orderReadyIssues,
  resolveEngagementSessions,
  resolveFields,
  resolveTermsClauses,
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

Deno.test("formatOrderNo: renders the legacy {cast|seq} pattern (castCode when present, else seq)", () => {
  assertEquals(
    formatOrderNo("{prefix}-{yyyy}-{mmdd}-{cast|seq}", { prefix: "HO", date: "2026-06-15", castCode: "B1", seq: 7 }),
    "HO-2026-0615-B1",
  );
  assertEquals(
    formatOrderNo("{prefix}-{yyyy}-{mmdd}-{cast|seq}", { prefix: "HO", date: "2026-06-15", seq: 7 }),
    "HO-2026-0615-7",
  );
});

Deno.test("formatOrderNo: {seq} is always the numeric sequence, {cast} is code-or-empty", () => {
  assertEquals(
    formatOrderNo("{prefix}-{yyyy}-{mmdd}-{seq}", { prefix: "HO", date: "2026-06-15", castCode: "B1", seq: 7 }),
    "HO-2026-0615-7",
  );
  assertEquals(formatOrderNo("{prefix}-{cast}{seq}", { prefix: "HO", castCode: "B1", seq: 3 }), "HO-B13");
  assertEquals(formatOrderNo("{prefix}-{cast}{seq}", { prefix: "HO", seq: 3 }), "HO-3");
});

Deno.test("formatOrderNo: default {seq} pattern yields a distinct number per artist on a date", () => {
  const pattern = "{prefix}-{yyyy}-{mmdd}-{seq}";
  const nums = [1, 2, 3, 4, 5, 6].map((seq) =>
    formatOrderNo(pattern, { prefix: "HO", date: "2026-06-15", castCode: "AIDA", seq }));
  assertEquals(new Set(nums).size, 6);
  assertEquals(nums, [
    "HO-2026-0615-1",
    "HO-2026-0615-2",
    "HO-2026-0615-3",
    "HO-2026-0615-4",
    "HO-2026-0615-5",
    "HO-2026-0615-6",
  ]);
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

// ── terms ────────────────────────────────────────────────────────────────

Deno.test("normalizeTermsSetting: passes a valid new-shape value through unchanged", () => {
  const v = { templates: [{ id: "a", name: "A", clauses: [{ title: "t", body: "b" }] }], default_id: "a" };
  assertEquals(normalizeTermsSetting(v), v);
});

Deno.test("normalizeTermsSetting: converts the legacy lean/standard/full shape to three templates, default standard", () => {
  const legacy = { lean: [], standard: [{ title: "S", body: "sb" }], full: [] };
  assertEquals(normalizeTermsSetting(legacy), {
    templates: [
      { id: "lean", name: "Lean", clauses: [] },
      { id: "standard", name: "Standard", clauses: [{ title: "S", body: "sb" }] },
      { id: "full", name: "Full", clauses: [] },
    ],
    default_id: "standard",
  });
});

Deno.test("normalizeTermsSetting: returns empty for missing/junk input", () => {
  assertEquals(normalizeTermsSetting(null), { templates: [], default_id: null });
  assertEquals(normalizeTermsSetting({}), { templates: [], default_id: null });
  assertEquals(normalizeTermsSetting({ templates: "nope" }), { templates: [], default_id: null });
});

Deno.test("normalizeTermsSetting: drops malformed templates and clauses", () => {
  const v = {
    templates: [
      { id: "a", name: "A", clauses: [{ title: "t", body: "b" }, { title: 1 }] },
      { name: "no id" },
    ],
    default_id: "a",
  };
  assertEquals(normalizeTermsSetting(v), {
    templates: [{ id: "a", name: "A", clauses: [{ title: "t", body: "b" }] }],
    default_id: "a",
  });
});

Deno.test("defaultTemplateId: returns default_id when it points at an existing template", () => {
  assertEquals(defaultTemplateId({ templates: [{ id: "a", name: "A", clauses: [] }], default_id: "a" }), "a");
});

Deno.test("defaultTemplateId: falls back to the first template when default_id is missing or stale", () => {
  assertEquals(defaultTemplateId({ templates: [{ id: "a", name: "A", clauses: [] }], default_id: "gone" }), "a");
  assertEquals(defaultTemplateId({ templates: [{ id: "a", name: "A", clauses: [] }], default_id: null }), "a");
});

Deno.test("defaultTemplateId: returns null when there are no templates", () => {
  assertEquals(defaultTemplateId({ templates: [], default_id: null }), null);
});

Deno.test("resolveTermsClauses: returns the referenced template's clauses", () => {
  const setting = {
    templates: [
      { id: "a", name: "A", clauses: [{ title: "ta", body: "ba" }] },
      { id: "b", name: "B", clauses: [{ title: "tb", body: "bb" }] },
    ],
    default_id: "b",
  };
  assertEquals(resolveTermsClauses(setting, "a"), [{ title: "ta", body: "ba" }]);
});

Deno.test("resolveTermsClauses: falls back to the default template when the id is unknown (deleted)", () => {
  const setting = {
    templates: [
      { id: "a", name: "A", clauses: [{ title: "ta", body: "ba" }] },
      { id: "b", name: "B", clauses: [{ title: "tb", body: "bb" }] },
    ],
    default_id: "b",
  };
  assertEquals(resolveTermsClauses(setting, "gone"), [{ title: "tb", body: "bb" }]);
});

Deno.test("resolveTermsClauses: returns [] when neither the id nor a default resolves", () => {
  assertEquals(resolveTermsClauses({ templates: [], default_id: null }, "x"), []);
});

// ── engagementDates ──────────────────────────────────────────────────────

Deno.test("resolveEngagementSessions: uses synced values when there is no override", () => {
  const synced = { sessions: ["19:00", "21:00"], duration_min: 90 };
  assertEquals(resolveEngagementSessions(synced, undefined), synced);
});

Deno.test("resolveEngagementSessions: lets an override replace sessions and/or duration", () => {
  const synced = { sessions: ["19:00", "21:00"], duration_min: 90 };
  assertEquals(resolveEngagementSessions(synced, { sessions: ["20:00"] }), { sessions: ["20:00"], duration_min: 90 });
  assertEquals(resolveEngagementSessions(synced, { duration_min: 120 }), { sessions: ["19:00", "21:00"], duration_min: 120 });
});

Deno.test("resolveEngagementSessions: treats an empty override sessions array as an explicit clear", () => {
  const synced = { sessions: ["19:00", "21:00"], duration_min: 90 };
  assertEquals(resolveEngagementSessions(synced, { sessions: [] }), { sessions: [], duration_min: 90 });
});

// ── feeBasis ─────────────────────────────────────────────────────────────

Deno.test("computeFeeTotal multiplies per-date fees in exact cents", () => {
  assertEquals(computeFeeTotal(500, 3, "per_date"), 1500);
  assertEquals(computeFeeTotal(500.1, 3, "per_date"), 1500.3);
  assertEquals(computeFeeTotal(500, 1, "per_date"), 500);
});

Deno.test("computeFeeTotal leaves a total-basis fee alone", () => {
  assertEquals(computeFeeTotal(1500, 3, "total"), 1500);
});

Deno.test("computeFeeTotal no-ops on a nonsensical date count", () => {
  assertEquals(computeFeeTotal(500, 0, "per_date"), 500);
  assertEquals(computeFeeTotal(500, -2, "per_date"), 500);
});
