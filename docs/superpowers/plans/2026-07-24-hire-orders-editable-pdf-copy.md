# Hire orders: editable PDF copy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every static string in the hire-order PDF editable per org, with `{{token}}` interpolation, a settings card with reset-to-default + live preview, and issue-time freeze so a countersigned re-render reproduces the exact issued wording.

**Architecture:** A dual-homed keyed copy registry (`HIRE_ORDER_COPY_DEFAULTS`) + resolver (`resolveHireOrderCopy`) + token helper (`applyTokens`), byte-identical between `src/lib/hireOrders/pdfCopy.ts` and `supabase/functions/_shared/hire-order-pdf/pdfCopy.ts`. `render.tsx` reads every literal from a resolved `copy` object on `RenderInput`. A new `hire_order_copy` app-setting holds per-org overrides; the edge resolves it at preview/issue, freezes it into `issue_snapshot.copy`, and re-reads the snapshot on sign. A `PdfCopyCard` in Settings → Hire orders edits each key with a token hint + reset + preview (reusing the edge `preview` action with an ad-hoc copy override + sample data).

**Tech Stack:** React 18 + Vite + TS + Tailwind + shadcn/ui; Supabase (Deno edge fns, app_settings jsonb); `@react-pdf/renderer` v4; Vitest (jsdom + supabaseFake); Deno test (makeFakeDeps).

## Global Constraints

- **No schema change.** `hire_order_copy` is another `app_settings` key; the snapshot `copy` lives inside the existing jsonb `issue_snapshot` column. No migration.
- **Dual-home byte-equality.** The core copy module (`CopyKey`, `HIRE_ORDER_COPY_DEFAULTS`, `applyTokens`, `resolveHireOrderCopy`, `HireOrderCopy`) must be **byte-identical** in `src/lib/hireOrders/pdfCopy.ts` and `supabase/functions/_shared/hire-order-pdf/pdfCopy.ts` (no relative imports, so identity is achievable). A mirror test enforces it. Edit both in the same commit.
- **No em/en dashes in any default copy** (house rule). Defaults use `·` (middot), `,`, or `.`. The settings card soft-warns on em/en dashes in overrides.
- **Semantic + accent tokens only** in the settings card (no hardcoded colors).
- **`any` is banned** (CI `--max-warnings 0`). Type the setting as `Partial<HireOrderCopy>`; single `as unknown as` cast at the query boundary only where supabase-js can't infer.
- **Ships dark:** all behind `hire_orders` entitlement (default OFF). No new entitlement.
- **Test-first**, co-located tests, real-module imports.

---

### Task 1: Copy registry core (dual-home) + resolver + token helper

**Files:**
- Create: `src/lib/hireOrders/pdfCopy.ts`
- Create: `supabase/functions/_shared/hire-order-pdf/pdfCopy.ts` (byte-identical)
- Test: `src/lib/hireOrders/pdfCopy.test.ts`
- Test: `src/lib/hireOrders/pdfCopyMirror.test.ts`

**Interfaces:**
- Produces:
  - `type CopyKey` — the union of the ~45 keys below.
  - `type HireOrderCopy = Record<CopyKey, string>`.
  - `const HIRE_ORDER_COPY_DEFAULTS: HireOrderCopy` — every default string.
  - `function applyTokens(template: string, values: Record<string, string | number>): string` — replaces each `{{token}}` whose name is a key in `values`; leaves unknown `{{...}}` verbatim.
  - `function resolveHireOrderCopy(overrides?: Partial<HireOrderCopy> | null): HireOrderCopy` — per key: a non-empty (after `.trim()`) override wins, else the default. Always returns a complete record.

- [ ] **Step 1: Write the failing test** — `src/lib/hireOrders/pdfCopy.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  applyTokens,
  HIRE_ORDER_COPY_DEFAULTS,
  resolveHireOrderCopy,
  type CopyKey,
} from "./pdfCopy";

describe("applyTokens", () => {
  it("substitutes known tokens", () => {
    expect(applyTokens("Booking agent: {{agent_name}}", { agent_name: "Jo" }))
      .toBe("Booking agent: Jo");
  });
  it("coerces numbers", () => {
    expect(applyTokens("{{count}} dates", { count: 3 })).toBe("3 dates");
  });
  it("leaves unknown tokens verbatim (no blanking, no injection)", () => {
    expect(applyTokens("Hi {{typo}}", { agent_name: "Jo" })).toBe("Hi {{typo}}");
  });
  it("replaces every occurrence of a repeated token", () => {
    expect(applyTokens("{{x}}-{{x}}", { x: "a" })).toBe("a-a");
  });
});

describe("resolveHireOrderCopy", () => {
  it("returns defaults when no overrides", () => {
    expect(resolveHireOrderCopy()).toEqual(HIRE_ORDER_COPY_DEFAULTS);
    expect(resolveHireOrderCopy(null)).toEqual(HIRE_ORDER_COPY_DEFAULTS);
  });
  it("applies a non-empty override per key", () => {
    const r = resolveHireOrderCopy({ terms_heading: "Conditions" });
    expect(r.terms_heading).toBe("Conditions");
    expect(r.title_lead).toBe(HIRE_ORDER_COPY_DEFAULTS.title_lead);
  });
  it("falls back to default for empty/whitespace overrides", () => {
    expect(resolveHireOrderCopy({ terms_heading: "   " }).terms_heading)
      .toBe(HIRE_ORDER_COPY_DEFAULTS.terms_heading);
  });
  it("has no em/en dashes in any default", () => {
    for (const v of Object.values(HIRE_ORDER_COPY_DEFAULTS)) {
      expect(v).not.toMatch(/[–—]/);
    }
  });
  it("every default with a {{token}} keeps it resolvable", () => {
    // sanity: keys are stable strings
    const k: CopyKey = "party_agent";
    expect(HIRE_ORDER_COPY_DEFAULTS[k]).toContain("{{agent_name}}");
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run src/lib/hireOrders/pdfCopy.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write `src/lib/hireOrders/pdfCopy.ts`**

```ts
// Editable hire-order PDF copy. Every static string the renderer prints is a
// key here; interpolated strings use {{token}} placeholders resolved by
// applyTokens. Per-org overrides live in the `hire_order_copy` app-setting and
// are merged over these defaults by resolveHireOrderCopy.
//
// DUAL-HOME: byte-identical to supabase/functions/_shared/hire-order-pdf/pdfCopy.ts
// (the edge renderer can't import from src/). Edit both in the same commit;
// pdfCopyMirror.test.ts enforces byte-equality. No relative imports here so the
// two files can be identical.
//
// HOUSE RULE: no em/en dashes in defaults. Use middot, comma, or period.

export type CopyKey =
  // Header + status badge
  | "header_eyebrow"
  | "badge_preview"
  | "badge_countersigned"
  | "badge_issued"
  // Title
  | "title_lead"
  | "billing_role_and_cast"
  | "billing_cast_only"
  // Parties
  | "party_producer_label"
  | "party_agent"
  | "party_artist_label"
  | "party_cast_reference"
  | "party_engagement"
  // Facts strip
  | "facts_date_label"
  | "facts_dates_count"
  | "facts_venue_label"
  | "facts_performance_label"
  | "facts_duration"
  | "facts_sessions_count"
  | "facts_single_set"
  | "facts_fee_label"
  | "facts_fee_sub"
  // Engagement dates + running order
  | "engagement_dates_heading"
  | "session_label"
  | "running_order_heading_venue"
  | "running_order_heading"
  | "table_call"
  | "table_time"
  // Notes
  | "notes_prefix"
  // Fees
  | "fees_heading"
  | "fees_engagement_fee"
  | "fees_total"
  // Terms
  | "terms_heading"
  // Signatures
  | "signature_for_producer"
  | "signature_producer_hint"
  | "signature_for_artist"
  | "signature_signed_electronically"
  | "signature_artist_hint"
  // Watermark
  | "watermark"
  // Footer
  | "footer_generated"
  // Certificate page
  | "cert_heading"
  | "cert_lead"
  | "cert_signer"
  | "cert_email"
  | "cert_method"
  | "cert_method_drawn"
  | "cert_method_typed"
  | "cert_signed_at"
  | "cert_signed_at_value"
  | "cert_ip"
  | "cert_device"
  | "cert_sha";

export type HireOrderCopy = Record<CopyKey, string>;

export const HIRE_ORDER_COPY_DEFAULTS: HireOrderCopy = {
  header_eyebrow: "Performance hire order",
  badge_preview: "Preview",
  badge_countersigned: "Countersigned",
  badge_issued: "Issued",

  title_lead: "This order confirms the engagement of",
  billing_role_and_cast: "{{role}} · billed as {{cast}}",
  billing_cast_only: "Billed as {{cast}}",

  party_producer_label: "Hiring party, the Producer",
  party_agent: "Booking agent: {{agent_name}}",
  party_artist_label: "Engaged artist, the Artist",
  party_cast_reference: "Cast reference: {{cast}}",
  party_engagement: "Engagement: {{role}}",

  facts_date_label: "Date",
  facts_dates_count: "{{count}} dates",
  facts_venue_label: "Venue",
  facts_performance_label: "Performance",
  facts_duration: "{{duration}} min",
  facts_sessions_count: "{{count}} sessions",
  facts_single_set: "Single set",
  facts_fee_label: "Engagement fee",
  facts_fee_sub: "net of VAT",

  engagement_dates_heading: "Engagement dates",
  session_label: "Session {{n}}",
  running_order_heading_venue: "Running order, {{venue}}",
  running_order_heading: "Running order",
  table_call: "Call",
  table_time: "Time",

  notes_prefix: "Notes: {{notes}}",

  fees_heading: "Fees & payment schedule",
  fees_engagement_fee: "Engagement fee",
  fees_total: "Total payable",

  terms_heading: "Terms & conditions",

  signature_for_producer: "For the Producer · {{legal_name}}",
  signature_producer_hint: "Name · Date {{date}}",
  signature_for_artist: "The Artist · {{artist}}",
  signature_signed_electronically: "Signed electronically · {{date}}",
  signature_artist_hint: "Signature · Date",

  watermark: "PREVIEW",

  footer_generated: "Generated by ShowFlow Pro · {{date}}",

  cert_heading: "Signature certificate",
  cert_lead: "Electronic signature record for hire order {{orderNo}}.",
  cert_signer: "Signer",
  cert_email: "Email",
  cert_method: "Method",
  cert_method_drawn: "Drawn signature",
  cert_method_typed: "Typed signature",
  cert_signed_at: "Signed at",
  cert_signed_at_value: "{{datetime}} (UTC)",
  cert_ip: "IP address",
  cert_device: "Device",
  cert_sha: "Document SHA-256",
};

/** Replace each {{token}} whose name is a key of `values`. Unknown {{...}} are
 *  left verbatim (a typo stays visible instead of blanking or injecting). */
export function applyTokens(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  );
}

/** Merge per-org overrides over the defaults. A blank/whitespace override falls
 *  back to the default; the result is always a complete record. */
export function resolveHireOrderCopy(
  overrides?: Partial<HireOrderCopy> | null,
): HireOrderCopy {
  if (!overrides) return { ...HIRE_ORDER_COPY_DEFAULTS };
  const out = { ...HIRE_ORDER_COPY_DEFAULTS };
  for (const key of Object.keys(HIRE_ORDER_COPY_DEFAULTS) as CopyKey[]) {
    const v = overrides[key];
    if (typeof v === "string" && v.trim() !== "") out[key] = v;
  }
  return out;
}
```

- [ ] **Step 4: Create the edge mirror** — copy the file verbatim to `supabase/functions/_shared/hire-order-pdf/pdfCopy.ts` (identical bytes).

```bash
cp src/lib/hireOrders/pdfCopy.ts supabase/functions/_shared/hire-order-pdf/pdfCopy.ts
```

- [ ] **Step 5: Write the mirror test** — `src/lib/hireOrders/pdfCopyMirror.test.ts`

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The copy registry is dual-homed because the Deno edge renderer can't import
// from src/. The two files must be byte-identical: the frontend shows defaults +
// reset, the edge renders from them and freezes them into the issue snapshot. If
// they drift, a preview and its issued PDF would use different wording. Edit one,
// edit the other in the same commit.
describe("hire-order pdf copy mirror", () => {
  it("src and edge pdfCopy.ts are byte-identical", () => {
    const a = readFileSync("src/lib/hireOrders/pdfCopy.ts", "utf8");
    const b = readFileSync(
      "supabase/functions/_shared/hire-order-pdf/pdfCopy.ts",
      "utf8",
    );
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 6: Run tests, verify pass** — `npx vitest run src/lib/hireOrders/pdfCopy.test.ts src/lib/hireOrders/pdfCopyMirror.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/hireOrders/pdfCopy.ts src/lib/hireOrders/pdfCopy.test.ts src/lib/hireOrders/pdfCopyMirror.test.ts supabase/functions/_shared/hire-order-pdf/pdfCopy.ts
git commit -m "feat(hire-orders): editable pdf copy registry + resolver + token helper"
```

---

### Task 2: Renderer reads all copy from `RenderInput.copy`

**Files:**
- Modify: `supabase/functions/_shared/hireOrders.ts` (add `copy?` to `RenderInput`)
- Modify: `supabase/functions/_shared/hire-order-pdf/render.tsx` (replace every literal)
- Test: `supabase/functions/_shared/hire-order-pdf/render.test.ts` (add override assertions)

**Interfaces:**
- Consumes: `HireOrderCopy`, `HIRE_ORDER_COPY_DEFAULTS`, `applyTokens` from `./pdfCopy.ts` (Task 1).
- Produces: `RenderInput.copy?: HireOrderCopy` — when omitted, the renderer uses `HIRE_ORDER_COPY_DEFAULTS`, so existing callers/tests are byte-for-byte unchanged.

- [ ] **Step 1: Add the optional field to `RenderInput`** in `supabase/functions/_shared/hireOrders.ts` (after `signature?`):

```ts
  /** Resolved, complete copy dictionary (org overrides merged over defaults).
   *  Omitted in legacy call sites/tests -> the renderer uses the built-in
   *  defaults, reproducing the previous hardcoded strings exactly. */
  copy?: HireOrderCopy;
```

Add the import at the top of `_shared/hireOrders.ts`:

```ts
import type { HireOrderCopy } from "./hire-order-pdf/pdfCopy.ts";
```

- [ ] **Step 2: Write the failing render test** — append to `supabase/functions/_shared/hire-order-pdf/render.test.ts`. (Read the existing file first for its import style + `extractPdfText` usage + a representative `RenderInput` fixture.) Add:

```ts
Deno.test("render: an org copy override changes the printed heading", async () => {
  const base = /* the file's existing minimal RenderInput fixture (issued) */;
  const overridden = {
    ...base,
    terms: [{ title: "Payment", body: "Net 30." }],
    copy: resolveHireOrderCopy({ terms_heading: "Conditions of engagement" }),
  };
  const bytes = await renderHireOrderPdf(overridden);
  const text = await extractPdfText(bytes);
  assertStringIncludes(text, "Conditions of engagement");
});

Deno.test("render: default copy still prints the stock heading", async () => {
  const base = /* existing issued fixture with terms present */;
  const bytes = await renderHireOrderPdf(base); // no `copy`
  const text = await extractPdfText(bytes);
  assertStringIncludes(text, "Terms & conditions");
});
```

Import `resolveHireOrderCopy` from `../hire-order-pdf/pdfCopy.ts` (adjust relative path to the test's location) and `assertStringIncludes` from the std assert module already used in the file.

- [ ] **Step 3: Run it, verify the first test fails** — `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/hire-order-pdf/render.test.ts` → the override test FAILS (still prints "Terms & conditions").

- [ ] **Step 4: Refactor `render.tsx`** — in `HireOrderDoc`, after destructuring `input`, add:

```ts
import { applyTokens, HIRE_ORDER_COPY_DEFAULTS, type HireOrderCopy } from "./pdfCopy.ts";
// ...
const copy: HireOrderCopy = input.copy ?? HIRE_ORDER_COPY_DEFAULTS;
```

Then replace every literal string with `copy.<key>` or `applyTokens(copy.<key>, {...})`. The complete mapping (line references are pre-refactor):

- L371 `Performance hire order` → `copy.header_eyebrow`
- L376 badge ternary → `status === "preview" ? copy.badge_preview : status === "countersigned" ? copy.badge_countersigned : copy.badge_issued`
- L384 `This order confirms the engagement of` → `copy.title_lead`
- L355 `billing` computation →
  ```ts
  const billing = role && cast
    ? applyTokens(copy.billing_role_and_cast, { role, cast })
    : cast
    ? applyTokens(copy.billing_cast_only, { cast })
    : role;
  ```
- L392 `Hiring party, the Producer` → `copy.party_producer_label`
- L396 `` `Booking agent: ${letterhead.agent_name}` `` → `applyTokens(copy.party_agent, { agent_name: letterhead.agent_name })`
- L402 `Engaged artist, the Artist` → `copy.party_artist_label`
- L405 `` `Cast reference: ${cast}` `` → `applyTokens(copy.party_cast_reference, { cast })`
- L406 `` `Engagement: ${role}` `` → `applyTokens(copy.party_engagement, { role })`
- L413 `Date` → `copy.facts_date_label`
- L415 `` `${engagementDates.length} dates` `` → `applyTokens(copy.facts_dates_count, { count: engagementDates.length })`
- L418 `Venue` → `copy.facts_venue_label`
- L423 `Performance` → `copy.facts_performance_label`
- L424 `` duration ? `${duration} min` : "" `` → `duration ? applyTokens(copy.facts_duration, { duration }) : ""`
- L425 `` sessions.length > 1 ? `${sessions.length} sessions` : "Single set" `` → `sessions.length > 1 ? applyTokens(copy.facts_sessions_count, { count: sessions.length }) : copy.facts_single_set`
- L428 `Engagement fee` (facts) → `copy.facts_fee_label`
- L430 `net of VAT` → `copy.facts_fee_sub`
- L437 `Engagement dates` → `copy.engagement_dates_heading`
- L447 & L471 `` `Session ${i + 1}` `` → `applyTokens(copy.session_label, { n: i + 1 })`
- L464 `` venue ? `Running order, ${venue}` : "Running order" `` → `venue ? applyTokens(copy.running_order_heading_venue, { venue }) : copy.running_order_heading`
- L466 `Call` → `copy.table_call`
- L467 `Time` → `copy.table_time`
- L488 `` `Notes: ${notes}` `` → `applyTokens(copy.notes_prefix, { notes })`
- L495 `Fees & payment schedule` → `copy.fees_heading`
- L497 `Engagement fee` (fees row) → `copy.fees_engagement_fee`
- L501 `Total payable` → `copy.fees_total`
- L510 `Terms & conditions` → `copy.terms_heading`
- L526 `` `For the Producer · ${letterhead.legal_name}` `` → `applyTokens(copy.signature_for_producer, { legal_name: letterhead.legal_name })`
- L531 `` `Name · Date ${formatDateDMY(date)}` `` → `applyTokens(copy.signature_producer_hint, { date: formatDateDMY(date) })`
- L535 `` `The Artist · ${artist}` `` → `applyTokens(copy.signature_for_artist, { artist })`
- L543 `` signature ? `Signed electronically · ${formatIsoDMY(signature.signedAtIso)}` : "Signature · Date" `` → `signature ? applyTokens(copy.signature_signed_electronically, { date: formatIsoDMY(signature.signedAtIso) }) : copy.signature_artist_hint`
- L548 `PREVIEW` → `copy.watermark`
- L554 & L575 `` `Generated by ShowFlow Pro · ${formatIsoDMY(generatedAtIso)}` `` → `applyTokens(copy.footer_generated, { date: formatIsoDMY(generatedAtIso) })`
- L563 `Signature certificate` → `copy.cert_heading`
- L564 `` `Electronic signature record for hire order ${orderNo}.` `` → `applyTokens(copy.cert_lead, { orderNo })`
- L565 `Signer` → `copy.cert_signer`
- L566 `Email` → `copy.cert_email`
- L567 `Method` → `copy.cert_method`; `` signature.method === "drawn" ? "Drawn signature" : "Typed signature" `` → `signature.method === "drawn" ? copy.cert_method_drawn : copy.cert_method_typed`
- L568 `Signed at` → `copy.cert_signed_at`; `` `${formatIsoDateTimeUTC(signature.signedAtIso)} (UTC)` `` → `applyTokens(copy.cert_signed_at_value, { datetime: formatIsoDateTimeUTC(signature.signedAtIso) })`
- L569 `IP address` → `copy.cert_ip`
- L570 `Device` → `copy.cert_device`
- L571 `Document SHA-256` → `copy.cert_sha`

**Leave structural (NOT copy):** the brand-tile initial fallback `"?"` (L364), the `<Document title/author/creator>` metadata (L358), and the `Page {{n}} / {{total}}` footer render-callback (L557/L576) — page numbers are a layout primitive, not editable copy.

- [ ] **Step 5: Run render tests, verify pass** — `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/hire-order-pdf/render.test.ts` → PASS (override + default both green).

- [ ] **Step 6: Run the whole edge suite** — `deno test --allow-all --node-modules-dir=none supabase/functions/` → all green (call sites still omit `copy`, so output is unchanged).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/hireOrders.ts supabase/functions/_shared/hire-order-pdf/render.tsx supabase/functions/_shared/hire-order-pdf/render.test.ts
git commit -m "feat(hire-orders): renderer reads all copy from resolved dictionary"
```

---

### Task 3: Edge threads copy through preview / issue / sign (+ snapshot freeze + sample preview)

**Files:**
- Modify: `supabase/functions/generate-hire-orders/index.ts`
- Test: `supabase/functions/generate-hire-orders/index.di.test.ts`

**Interfaces:**
- Consumes: `resolveHireOrderCopy`, `HireOrderCopy` from `../_shared/hire-order-pdf/pdfCopy.ts`.
- Produces: `PreviewBody.copy_override?: Partial<HireOrderCopy>` and optional `order_id` (absent → sample preview). `IssueSnapshot.copy: HireOrderCopy` frozen at issue; `signOrder` re-reads it.

- [ ] **Step 1: Write failing DI tests** — add to `index.di.test.ts` (read the file first for the `makeFakeDeps`/`handle` harness + how it seeds settings + captures `renderHireOrderPdf` input):

```ts
// preview honors an ad-hoc copy override
Deno.test("preview: copy_override reaches the renderer", async () => {
  let seen: unknown;
  const deps = makeFakeDeps({
    /* seed org membership admin/producer, hire_orders feature on, an order row */
    renderHireOrderPdf: (input) => { seen = input; return Promise.resolve(new Uint8Array([1])); },
  });
  const res = await handle(reqWith({ action: "preview", org_id, order_id, copy_override: { terms_heading: "Bespoke" } }), deps);
  assertEquals(res.status, 200);
  assertEquals((seen as { copy: Record<string, string> }).copy.terms_heading, "Bespoke");
});

// preview with no order_id renders sample data
Deno.test("preview: no order_id renders a sample document", async () => {
  let seen: unknown;
  const deps = makeFakeDeps({ /* admin, feature on */ renderHireOrderPdf: (i) => { seen = i; return Promise.resolve(new Uint8Array([1])); } });
  const res = await handle(reqWith({ action: "preview", org_id, copy_override: { terms_heading: "Bespoke" } }), deps);
  assertEquals(res.status, 200);
  const input = seen as { data: unknown; status: string; copy: Record<string, string> };
  assertEquals(input.status, "preview");
  assertEquals(input.copy.terms_heading, "Bespoke");
  // sample data present so the doc isn't blank
  assertExists((input.data as { artist_name?: { value?: unknown } }).artist_name?.value);
});

// issue freezes copy into the snapshot
Deno.test("issue: resolved copy is frozen into issue_snapshot", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const deps = makeFakeDeps({ /* ready order, letterhead ready, terms present, hire_order_copy override {terms_heading:"Frozen"} */
    captureUpdate: (row) => updates.push(row) });
  const res = await handle(reqWith({ action: "issue", org_id, order_ids: [orderId] }), deps);
  assertEquals(res.status, 200);
  const snap = updates.find((u) => u.issue_snapshot)?.issue_snapshot as { copy?: Record<string, string> };
  assertEquals(snap.copy?.terms_heading, "Frozen");
});

// sign reproduces the frozen copy, ignoring a later org edit
Deno.test("sign: re-render uses snapshot.copy not the live setting", async () => {
  let seen: unknown;
  const deps = makeFakeDeps({ /* issued order whose issue_snapshot.copy.terms_heading = "Frozen"; live hire_order_copy now {terms_heading:"Changed"} */
    renderHireOrderPdf: (i) => { seen = i; return Promise.resolve(new Uint8Array([1])); } });
  const res = await handle(reqWith({ action: "sign", order_id: orderId, /* signing payload */ }), deps);
  assertEquals(res.status, 200);
  assertEquals((seen as { copy: Record<string, string> }).copy.terms_heading, "Frozen");
});
```

Match the exact `makeFakeDeps` seeding + request-building helpers the existing tests in this file use (do not invent a new harness).

- [ ] **Step 2: Run them, verify they fail** — `deno test --allow-all --node-modules-dir=none supabase/functions/generate-hire-orders/index.di.test.ts` → the four new tests FAIL.

- [ ] **Step 3: Implement.** In `index.ts`:

Add the import:
```ts
import { type HireOrderCopy, resolveHireOrderCopy } from "../_shared/hire-order-pdf/pdfCopy.ts";
```
Add a fallback constant near the other `*_DEFAULT`s:
```ts
const COPY_DEFAULT: Partial<HireOrderCopy> = {};
```
Extend `IssueSnapshot`:
```ts
interface IssueSnapshot {
  letterhead: HireOrderLetterhead;
  terms: HireOrderTerm[];
  currency: string;
  countersign_mode: string;
  /** Resolved copy frozen at issue so a countersigned re-render reproduces the
   *  exact issued wording. Legacy snapshots (pre-copy) lack it -> signOrder
   *  falls back to the live setting. Stored as the FULL resolved record. */
  copy?: HireOrderCopy;
}
```

**issueOrders** (the batch resolver, ~L1458): add `hire_order_copy` to the `Promise.all`, resolve it once, pass into `issueOne`:
```ts
const copyOverride = await resolveOrgSetting<Partial<HireOrderCopy>>(admin, org, "hire_order_copy", COPY_DEFAULT);
const copy = resolveHireOrderCopy(copyOverride);
```
Thread `copy` as a new `issueOne` param. In **issueOne**: pass `copy` into `renderHireOrderPdf({..., copy })` and add `copy` to the `snapshot` object.

**previewOrder** (~L1960): make `order_id` optional; add `copy_override`:
```ts
interface PreviewBody { org_id: string; order_id?: string; copy_override?: Partial<HireOrderCopy>; }
```
Resolve the org's `hire_order_copy`, merge the ad-hoc override on top (override wins per key), then resolve to a complete record:
```ts
const stored = await resolveOrgSetting<Partial<HireOrderCopy>>(admin, org, "hire_order_copy", COPY_DEFAULT);
const copy = resolveHireOrderCopy({ ...stored, ...(body.copy_override ?? {}) });
```
When `body.order_id` is present, keep the existing order lookup. When absent, build sample data and skip the lookup:
```ts
const o = body.order_id
  ? /* existing lookup; 404 if missing */
  : { id: "", order_no: sampleOrderNo(), data: sampleOrderData(), terms_variant: null, fee_currency: null, agent_name: null, agent_email: null };
```
Add a `sampleOrderData(): OrderData` helper returning a representative order (artist "Alex Rivera", a date, venue "Grand Theatre", city "Berlin", role "Lead", cast "A-cast", fee "1500", two sessions "18:00"/"20:30", short notes) as `FieldValue`-wrapped fields, plus `sampleOrderNo()` returning e.g. `"HO-PREVIEW"`. Pass `copy` into `renderHireOrderPdf`.

**signOrder** (~L2256): read `snapshot.copy`; fall back to live resolution for legacy snapshots:
```ts
let renderCopy: HireOrderCopy;
if (snapshot && snapshot.letterhead && Array.isArray(snapshot.terms)) {
  // ... existing letterhead/terms/currency ...
  renderCopy = resolveHireOrderCopy(snapshot.copy); // snapshot.copy may be undefined (legacy) -> defaults
} else {
  // ... existing live fallback ...
  const storedCopy = await resolveOrgSetting<Partial<HireOrderCopy>>(admin, org, "hire_order_copy", COPY_DEFAULT);
  renderCopy = resolveHireOrderCopy(storedCopy);
}
```
Pass `copy: renderCopy` into the `renderHireOrderPdf` call.

- [ ] **Step 4: Run the DI tests, verify pass** — `deno test --allow-all --node-modules-dir=none supabase/functions/generate-hire-orders/index.di.test.ts` → PASS.

- [ ] **Step 5: Run the whole edge suite** — `deno test --allow-all --node-modules-dir=none supabase/functions/` → green.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/generate-hire-orders/index.ts supabase/functions/generate-hire-orders/index.di.test.ts
git commit -m "feat(hire-orders): thread editable copy through preview/issue/sign + freeze in snapshot"
```

---

### Task 4: Frontend copy UI metadata (sections, labels, token hints, em-dash check)

**Files:**
- Create: `src/components/settings/hireOrders/pdfCopyMeta.ts`
- Test: `src/components/settings/hireOrders/pdfCopyMeta.test.ts`

**Interfaces:**
- Consumes: `CopyKey`, `HIRE_ORDER_COPY_DEFAULTS` from `@/lib/hireOrders/pdfCopy`.
- Produces:
  - `interface CopyField { key: CopyKey; label: string; tokens: string[]; multiline?: boolean }`
  - `interface CopySection { title: string; fields: CopyField[] }`
  - `const COPY_SECTIONS: CopySection[]` — every `CopyKey` appears exactly once, grouped by document section, with a human label + the `{{tokens}}` allowed in that field.
  - `function hasBadDash(text: string): boolean` — true if the string contains an em (`—`) or en (`–`) dash.

- [ ] **Step 1: Write the failing test** — `pdfCopyMeta.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { HIRE_ORDER_COPY_DEFAULTS, type CopyKey } from "@/lib/hireOrders/pdfCopy";
import { COPY_SECTIONS, hasBadDash } from "./pdfCopyMeta";

describe("COPY_SECTIONS", () => {
  it("covers every CopyKey exactly once", () => {
    const keys = COPY_SECTIONS.flatMap((s) => s.fields.map((f) => f.key)).sort();
    const all = (Object.keys(HIRE_ORDER_COPY_DEFAULTS) as CopyKey[]).sort();
    expect(keys).toEqual(all);
    expect(new Set(keys).size).toBe(keys.length); // no dupes
  });
  it("declares tokens that actually appear in the default template", () => {
    for (const s of COPY_SECTIONS) {
      for (const f of s.fields) {
        for (const t of f.tokens) {
          expect(HIRE_ORDER_COPY_DEFAULTS[f.key]).toContain(`{{${t}}}`);
        }
      }
    }
  });
});

describe("hasBadDash", () => {
  it("flags em and en dashes", () => {
    expect(hasBadDash("a — b")).toBe(true);
    expect(hasBadDash("a – b")).toBe(true);
  });
  it("passes middot / hyphen / plain", () => {
    expect(hasBadDash("a · b")).toBe(false);
    expect(hasBadDash("a - b")).toBe(false);
    expect(hasBadDash("Terms & conditions")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run src/components/settings/hireOrders/pdfCopyMeta.test.ts` → FAIL.

- [ ] **Step 3: Write `pdfCopyMeta.ts`** — declare `COPY_SECTIONS` grouping all keys (Header & status, Title, Parties, Facts, Engagement dates & running order, Notes, Fees, Terms, Signatures, Watermark & footer, Signature certificate), each field with a concise label + its token list (empty for static keys; e.g. `party_agent` → `["agent_name"]`, `facts_dates_count`/`facts_sessions_count` → `["count"]`, `billing_role_and_cast` → `["role","cast"]`, `cert_lead` → `["orderNo"]`, etc). Mark long fields (`notes_prefix`, `cert_lead`) `multiline: true`. Implement:

```ts
export function hasBadDash(text: string): boolean {
  return /[–—]/.test(text);
}
```

- [ ] **Step 4: Run it, verify pass** — same command → PASS. (The "covers every key exactly once" test is the guard that keeps this in sync with the registry.)

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/hireOrders/pdfCopyMeta.ts src/components/settings/hireOrders/pdfCopyMeta.test.ts
git commit -m "feat(hire-orders): pdf copy settings metadata (sections + token hints)"
```

---

### Task 5: Extract shared `openPdf` helper (DRY)

**Files:**
- Create: `src/lib/hireOrders/openPdf.ts`
- Test: `src/lib/hireOrders/openPdf.test.ts`
- Modify: `src/components/shows/hireOrders/GenerateHireOrderDialog.tsx` (import instead of local)
- Modify: `src/pages/HireOrderEditPage.tsx` (if it has its own local copy — verify; reuse the shared one)

**Interfaces:**
- Produces: `function openPdfBase64(base64: string): void` — decode base64 → Blob → `window.open` a temporary object URL, revoke after 60s.

- [ ] **Step 1: Write the failing test** — `openPdf.test.ts` stubs `window.open`, `URL.createObjectURL`/`revokeObjectURL`, and `atob`; asserts `openPdfBase64("JVBERi0=")` calls `createObjectURL` with a `application/pdf` Blob and `window.open` with `"_blank","noopener,noreferrer"`.

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement** `openPdfBase64` (move the body of `openPdf` from `GenerateHireOrderDialog.tsx` verbatim, renamed).

- [ ] **Step 4: Run it, verify pass.**

- [ ] **Step 5: Replace the local `openPdf`** in `GenerateHireOrderDialog.tsx` with an import of `openPdfBase64` (delete the local function; update the call). Check `HireOrderEditPage.tsx` — if it re-decodes base64 inline (it reads `res.pdf_base64`), route it through `openPdfBase64` too.

- [ ] **Step 6: Run the affected suites** — `npx vitest run src/components/shows/hireOrders/GenerateHireOrderDialog.test.tsx src/lib/hireOrders/openPdf.test.ts` → green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/hireOrders/openPdf.ts src/lib/hireOrders/openPdf.test.ts src/components/shows/hireOrders/GenerateHireOrderDialog.tsx src/pages/HireOrderEditPage.tsx
git commit -m "refactor(hire-orders): extract shared openPdfBase64 helper"
```

---

### Task 6: `PdfCopyCard` settings UI + wire into HireOrdersTab

**Files:**
- Create: `src/components/settings/hireOrders/PdfCopyCard.tsx`
- Test: `src/components/settings/hireOrders/PdfCopyCard.test.tsx`
- Modify: `src/components/settings/hireOrders/HireOrdersTab.tsx` (add the card + `KEY_LABELS` entry)
- Modify: `src/components/settings/hireOrders/auditKeys.ts` (add `hire_order_copy`)

**Interfaces:**
- Consumes: `resolveOrgSetting`/`upsertOrgSetting` (`@/data/settings`), `invokeHireOrderAction` (`@/data/hireOrders`), `HIRE_ORDER_COPY_DEFAULTS`/`resolveHireOrderCopy`/`type HireOrderCopy`/`CopyKey` (`@/lib/hireOrders/pdfCopy`), `COPY_SECTIONS`/`hasBadDash` (`./pdfCopyMeta`), `openPdfBase64` (`@/lib/hireOrders/openPdf`).
- Props: `{ orgId: string | null; readOnly?: boolean }` (mirrors LetterheadCard).

Behavior:
- Load `hire_order_copy` (a `Partial<HireOrderCopy>`) via `useQuery` + `resolveOrgSetting`. Seed a local `overrides` state once (the `seededRef` pattern from LetterheadCard). The **effective** value shown per field = `overrides[key] ?? HIRE_ORDER_COPY_DEFAULTS[key]`.
- Render `COPY_SECTIONS`: each section a heading; each field an `Input`/`Textarea` (label = `field.label`, value = effective, `disabled={readOnly}`), with a token hint line (`Tokens: {{agent_name}}`) when `field.tokens.length`, a "Reset to default" ghost button shown only when the field differs from its default (sets `overrides[key]` back to the default value — or deletes the key), and a soft warning when `hasBadDash(value)`.
- **Save** (`useMutation` + `upsertOrgSetting`): persist only keys that differ from the default (a compact override map), `invalidateQueries(["app-settings"])`, toast "PDF copy saved".
- **Preview** (`useMutation` + `invokeHireOrderAction(supabase, { action: "preview", org_id, copy_override })`): send the current unsaved override map, `openPdfBase64(res.pdf_base64)`. Disabled while pending or `!orgId`.
- Loading `Skeleton`; on read error render an `Alert variant="destructive"` INSTEAD of the fields (LetterheadCard rationale: blank defaults could overwrite real saved copy).

- [ ] **Step 1: Write the failing component test** — `PdfCopyCard.test.tsx` (model on `LetterheadCard.test.tsx`: hoisted `client`, `seedClient`, `renderWithProviders`). Cover:
  1. renders the saved override in its field (`seed hire_order_copy = { terms_heading: "Bespoke terms" }` → the Terms heading field has value "Bespoke terms"; an unset field shows its default).
  2. edit + Save upserts a compact override map (change `fees_total` to "Amount due", click Save, assert the `upsert` call's `value` contains `fees_total: "Amount due"` and does NOT contain unchanged keys).
  3. Reset-to-default restores a field to its default and drops it from the saved map.
  4. Preview invokes `generate-hire-orders` with `action: "preview"` and a `copy_override` carrying the edits (seed `fn:generate-hire-orders` → `{ pdf_base64: "JVBERi0=" }`; stub `window.open`/URL as in openPdf.test).
  5. em-dash warning appears when a field value contains `—`.
  6. `readOnly` disables inputs, Save, and Reset (Preview may stay enabled — it's read-only).

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run src/components/settings/hireOrders/PdfCopyCard.test.tsx` → FAIL.

- [ ] **Step 3: Implement `PdfCopyCard.tsx`** per the behavior above.

- [ ] **Step 4: Run it, verify pass.**

- [ ] **Step 5: Wire into the tab** — in `HireOrdersTab.tsx` import + render `<PdfCopyCard orgId={orgId} readOnly={readOnly} />` after `TermsVariantsCard`; add `hire_order_copy: "PDF copy"` to `KEY_LABELS`. In `auditKeys.ts` add `"hire_order_copy"` to `HIRE_ORDER_AUDIT_KEYS`.

- [ ] **Step 6: Run the settings suite + typecheck + lint** —
```bash
npx vitest run src/components/settings/hireOrders/
npx tsc --noEmit && npx eslint src/components/settings/hireOrders/ --max-warnings 0
```

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/hireOrders/PdfCopyCard.tsx src/components/settings/hireOrders/PdfCopyCard.test.tsx src/components/settings/hireOrders/HireOrdersTab.tsx src/components/settings/hireOrders/auditKeys.ts
git commit -m "feat(hire-orders): PDF copy settings card with reset + live preview"
```

---

### Task 7: Changelog, version, docs, memory

**Files:**
- Modify: `public/changelog.md` (+ regenerate `public/changelog.json`)
- Modify: `package.json` + `src/config/app.config.ts` (version — only if landing on a NEW calendar day vs #195; same-day folds in)
- Verify: `docs/system-map.md` unchanged (E adds no automation) — confirm, don't edit.

- [ ] **Step 1: Add a changelog entry** under the current version (same-day fold; see [[same-day-releases-one-version]]). An end-user `### New` bullet:
  `- **Editable hire order wording** — organizations can now customize every label and line of the hire order PDF under Settings, Hire orders, with a live preview.`
  No mention of tokens/snapshot internals or admin-only mechanics.

- [ ] **Step 2: Regenerate JSON** — `deno run --allow-read --allow-write scripts/changelog-to-json.ts`.

- [ ] **Step 3: Version** — if this PR merges on the same calendar day as #195's version, do NOT bump (fold in). If a later day, MINOR-bump `package.json` + `APP_META.VERSION` together.

- [ ] **Step 4: Full local gate** —
```bash
npx vitest run && npx tsc --noEmit && npx eslint . --max-warnings 0
deno test --allow-all --node-modules-dir=none supabase/functions/
```

- [ ] **Step 5: Commit**

```bash
git add public/changelog.md public/changelog.json package.json src/config/app.config.ts
git commit -m "docs(hire-orders): changelog for editable pdf copy"
```

---

## Self-Review (run after drafting, before executing)

- **Spec coverage:** registry+resolver+token (T1) ✓; renderer refactor (T2) ✓; per-org override setting + snapshot freeze + preview override + sample preview (T3) ✓; settings card edit/reset/preview/em-dash (T4+T6) ✓; dual-home byte-equality (T1) ✓; DRY openPdf (T5) ✓; changelog/version (T7) ✓.
- **Type consistency:** `HireOrderCopy`/`CopyKey`/`resolveHireOrderCopy`/`applyTokens` names are used identically across T1→T2→T3→T4→T6. `RenderInput.copy` optional in T2, populated in T3. `IssueSnapshot.copy` optional (legacy-safe) in T3.
- **No placeholders:** the render-refactor mapping (T2 Step 4) is fully enumerated; the DI seeding in T3 must match the existing `index.di.test.ts` harness (read it first, do not invent).
- **Deferred item folded in:** C2 (wizard pre-flag of already-covered artist×date cells) is NOT in this plan — it is a wizard concern unrelated to PDF copy; leave it out of Part E's PR to keep the diff coherent (revisit separately).
