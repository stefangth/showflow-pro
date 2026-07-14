# Booking Flow Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org admins configure the booking flow (skip steps, delivery mode, automations, reference field) through a visual pipeline editor, and the per-date cockpit reflects the configured flow.

**Architecture:** A single `booking_flow` JSON policy in `app_settings` resolved org → platform → code default, normalized by dual-home pure logic (`src/lib/bookingFlow.ts` + `supabase/functions/_shared/bookingFlow.ts`). Every engine touchpoint (edge functions, DB triggers, client data functions) reads the policy at action time. The settings surface is a preset-led timeline editor with a live preview rail; ShowDateDetailSheet is decomposed into flow-aware components.

**Tech Stack:** React 18 + TypeScript + Tailwind (semantic tokens) + shadcn/ui, TanStack Query v5, Supabase (Postgres RLS, Deno edge functions), Vitest + jsdom, Deno test, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-14-booking-flow-editor-design.md` (approved). Mockup reference: artifact "Booking Flow Editor Preview", version `final-v1-no-dashes`.

## Global Constraints

- **No em- or en-dashes in any user-facing copy** (UI strings, emails, notification text, doc copy). Use period, comma, colon, semicolon, or middot (`·`). Arrows (`→`) for state transitions are fine.
- **Status vocabulary is fixed:** `suggested | soft_booked | confirmed | cancelled`. Config changes transitions, never the vocabulary.
- **Invariant:** `artist_acceptance === false` implies `producer_confirmation === true`. Enforced in `normalizeBookingFlow` on every read.
- **Query keys:** mutations writing `bookings` invalidate the whole `['bookings']` prefix. Settings writes invalidate `['app-settings']` prefix. Never list sub-keys.
- **Tests import the real module.** Never re-implement production logic in a test file.
- **Semantic Tailwind tokens only** (`bg-background`, `text-muted-foreground`, `border-border`, badge pattern `bg-*-100 text-*-600` via existing `bookingStatusBadgeClass` conventions). Never `bg-white`/`text-black`.
- **Migrations:** create NEW files named `$(date -u +%Y%m%d%H%M%S)_<slug>.sql` under `supabase/migrations/`; never edit an existing migration. Guard/trigger changes are `CREATE OR REPLACE FUNCTION` in a new file, copied verbatim from the prior definition with the minimal edit. pgTAP files under `supabase/tests/` are ordinary editable files.
- **Local commands:** `npx vitest run <file>` (node_modules already installed via `npm ci`), `deno test --allow-all --node-modules-dir=none supabase/functions/`, `npm run lint`, `npx tsc -p tsconfig.app.json --noEmit`. pgTAP runs in CI only (`supabase test db`); author the files regardless.
- **After ANY edge-function behavior change, run the whole Deno suite**, not just one file.
- **Edge functions must use** `_shared/http.ts` (`json`, `preflight`), `_shared/auth.ts`, `_shared/settings.ts` (`resolveOrgSetting`, `getActiveOrgs`); never inline CORS/auth/client creation. All touched functions already exist, so `supabase/config.toml` needs no new blocks.
- **System map rule:** the tasks changing automations must update `docs/system-map.md` AND `src/data/systemMap.ts` in the same PR (Task 22); `src/data/systemMap.test.ts` is the CI drift guard.
- **Commits:** imperative, lowercase, ≤72 chars. Commit at the end of every task.
- **Git safety:** never run `git reset --hard`, `git checkout -- .`, force-push, or delete branches. If a step fails, stop and report; do not "clean up" by discarding work.
- **Back-compat:** an org with no `booking_flow` row must behave exactly as production does today. That means `BOOKING_FLOW_DEFAULTS.auto_open_tier1 = true` (the Airtable poll already auto-opens tier 1 for new dates via `openOfferTierBatch`, `supabase/functions/airtable-poll/index.ts:404`).

## File structure (what gets created/modified)

```
src/lib/bookingFlow.ts                     NEW  policy types, defaults, presets, normalize, presentation fns
src/lib/bookingFlow.test.ts                NEW
src/lib/bookingCockpit.ts                  NEW  pure funnel/up-next computations
src/lib/bookingCockpit.test.ts             NEW
src/hooks/useBookingFlow.ts                NEW  resolved+normalized policy for the current org
src/data/bookings.ts                       MOD  respondToOffer autoConfirm; createBooking; dryRunOfferTier
src/data/settingsAudit.ts                  NEW  fetchSettingsAudit
src/components/settings/EmailTemplatesCard.tsx      NEW (extracted from SettingsPage)
src/components/settings/bookingFlow/BookingFlowTab.tsx   NEW
src/components/settings/bookingFlow/FlowPresets.tsx      NEW
src/components/settings/bookingFlow/FlowTimeline.tsx     NEW (step cards inside)
src/components/settings/bookingFlow/FlowRail.tsx         NEW (lifecycle/practice/preview/save/history)
src/pages/SettingsPage.tsx                 MOD  tab swap (booking → admin-only Booking flow), EDITABLE_SETTING_KEYS
src/pages/DashboardPage.tsx                MOD  Ready-to-Confirm gate
src/components/shows/BookingRow.tsx        MOD  confirm-button gate prop
src/components/shows/ShowDateDetailSheet.tsx   MOD  recomposed
src/components/shows/date/BookingFunnel.tsx    NEW
src/components/shows/date/UpNextStrip.tsx      NEW
src/components/shows/date/TierTimeline.tsx     NEW
src/components/shows/date/DryRunDialog.tsx     NEW
src/components/shows/date/EligibilityBookList.tsx  NEW
src/components/shows/ShowDateFormDialog.tsx    MOD  auto-open default + edit-path auto-open
src/components/availability/OfferResponseButtons.tsx  MOD  autoConfirm wiring
supabase/functions/_shared/bookingFlow.ts      NEW  mirror: defaults, normalize, referenceLabel, resolveBookingFlow
supabase/functions/_shared/bookingFlow.test.ts NEW
supabase/functions/_shared/notificationCategories.ts  MOD  new email template categories
supabase/functions/_shared/transactional-email-templates/offer-immediate.tsx        NEW
supabase/functions/_shared/transactional-email-templates/offer-expiry-reminder.tsx  NEW
supabase/functions/_shared/transactional-email-templates/registry.ts                MOD
supabase/functions/open-offer-tier/index.ts    MOD  direct-mode 409, dry_run, immediate delivery
supabase/functions/send-offer-digest/index.ts  MOD  skip gates
supabase/functions/send-confirmation-digest/index.ts  MOD  confirmation_digest gate
supabase/functions/expire-offers/index.ts      MOD  reminder pass + auto-escalate
supabase/functions/tier-at-risk-watcher/index.ts  MOD  at_risk_alerts gate
supabase/functions/airtable-poll/index.ts      MOD  auto-open gate + updated-ready dates
supabase/migrations/<ts>_settings_audit_log.sql            NEW
supabase/migrations/<ts>_booking_flow_guard_and_reminder.sql  NEW
supabase/migrations/<ts>_understudy_promotion_flow_gates.sql  NEW
supabase/tests/db/settings_audit_log.sql       NEW
supabase/tests/triggers/enforce_booking_transition.sql     MOD  (+2 assertions)
supabase/tests/triggers/promote_understudy_on_cancellation.sql  MOD  (+2 assertions)
docs/system-map.md                          MOD
src/data/systemMap.ts                       MOD
e2e/booking-flow-presets.spec.ts            NEW
```

Milestones: A = Tasks 1-3 (pure logic), B = 4-6 (DB), C = 7-14 (engine), D = 15-17 (settings surface), E = 18-21 (cockpit), F = 22-24 (map, e2e, finalize).

---

### Task 1: Booking flow policy core (types, defaults, presets, normalize)

**Files:**
- Create: `src/lib/bookingFlow.ts`
- Test: `src/lib/bookingFlow.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by nearly every later task):
  - `type OfferDelivery = "digest" | "immediate"`
  - `type ReferenceSource = "show" | "program" | "custom"`
  - `interface ReferenceField { source: ReferenceSource; custom_field_id?: string }`
  - `interface BookingFlow { auto_open_tier1: boolean; auto_escalate: boolean; at_risk_alerts: boolean; offer_delivery: OfferDelivery; expiry_reminder: boolean; artist_acceptance: boolean; producer_confirmation: boolean; confirmation_digest: boolean; understudy_promotion: boolean; reference_field: ReferenceField }`
  - `const BOOKING_FLOW_DEFAULTS: BookingFlow`
  - `type PresetName = "classic" | "fasttrack" | "direct"`
  - `const BOOKING_FLOW_PRESETS: Record<PresetName, Omit<BookingFlow, "reference_field">>`
  - `function normalizeBookingFlow(value: unknown): BookingFlow`
  - `function applyPreset(flow: BookingFlow, preset: PresetName): BookingFlow`
  - `function matchPreset(flow: BookingFlow): PresetName | "custom"`

- [ ] **Step 1: Write the failing test**

Create `src/lib/bookingFlow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  applyPreset,
  BOOKING_FLOW_DEFAULTS,
  BOOKING_FLOW_PRESETS,
  matchPreset,
  normalizeBookingFlow,
} from "./bookingFlow";

describe("normalizeBookingFlow", () => {
  it("returns defaults for null, undefined, and garbage", () => {
    expect(normalizeBookingFlow(null)).toEqual(BOOKING_FLOW_DEFAULTS);
    expect(normalizeBookingFlow(undefined)).toEqual(BOOKING_FLOW_DEFAULTS);
    expect(normalizeBookingFlow("nope")).toEqual(BOOKING_FLOW_DEFAULTS);
    expect(normalizeBookingFlow([1, 2])).toEqual(BOOKING_FLOW_DEFAULTS);
  });

  it("defaults preserve current production behavior (auto-open on, digest, all steps on)", () => {
    expect(BOOKING_FLOW_DEFAULTS.auto_open_tier1).toBe(true);
    expect(BOOKING_FLOW_DEFAULTS.offer_delivery).toBe("digest");
    expect(BOOKING_FLOW_DEFAULTS.artist_acceptance).toBe(true);
    expect(BOOKING_FLOW_DEFAULTS.producer_confirmation).toBe(true);
    expect(BOOKING_FLOW_DEFAULTS.at_risk_alerts).toBe(true);
    expect(BOOKING_FLOW_DEFAULTS.expiry_reminder).toBe(false);
    expect(BOOKING_FLOW_DEFAULTS.auto_escalate).toBe(false);
  });

  it("merges partial objects over defaults", () => {
    const flow = normalizeBookingFlow({ offer_delivery: "immediate", expiry_reminder: true });
    expect(flow.offer_delivery).toBe("immediate");
    expect(flow.expiry_reminder).toBe(true);
    expect(flow.artist_acceptance).toBe(true);
  });

  it("forces producer_confirmation true when artist_acceptance is false", () => {
    const flow = normalizeBookingFlow({ artist_acceptance: false, producer_confirmation: false });
    expect(flow.artist_acceptance).toBe(false);
    expect(flow.producer_confirmation).toBe(true);
  });

  it("rejects unknown delivery and reference values", () => {
    const flow = normalizeBookingFlow({
      offer_delivery: "carrier-pigeon",
      reference_field: { source: "venue" },
    });
    expect(flow.offer_delivery).toBe("digest");
    expect(flow.reference_field).toEqual({ source: "show" });
  });

  it("keeps custom reference only when custom_field_id is a string", () => {
    expect(
      normalizeBookingFlow({ reference_field: { source: "custom", custom_field_id: "cf-1" } })
        .reference_field,
    ).toEqual({ source: "custom", custom_field_id: "cf-1" });
    expect(
      normalizeBookingFlow({ reference_field: { source: "custom" } }).reference_field,
    ).toEqual({ source: "show" });
  });
});

describe("presets", () => {
  it("classic preset equals the defaults (minus reference_field)", () => {
    const { reference_field: _ref, ...defaults } = BOOKING_FLOW_DEFAULTS;
    expect(BOOKING_FLOW_PRESETS.classic).toEqual(defaults);
  });

  it("applyPreset swaps flow fields but preserves reference_field", () => {
    const start = normalizeBookingFlow({
      reference_field: { source: "custom", custom_field_id: "cf-1" },
    });
    const fast = applyPreset(start, "fasttrack");
    expect(fast.offer_delivery).toBe("immediate");
    expect(fast.producer_confirmation).toBe(false);
    expect(fast.reference_field).toEqual({ source: "custom", custom_field_id: "cf-1" });
  });

  it("matchPreset recognizes each preset and reports custom otherwise", () => {
    expect(matchPreset(BOOKING_FLOW_DEFAULTS)).toBe("classic");
    expect(matchPreset(applyPreset(BOOKING_FLOW_DEFAULTS, "fasttrack"))).toBe("fasttrack");
    expect(matchPreset(applyPreset(BOOKING_FLOW_DEFAULTS, "direct"))).toBe("direct");
    expect(matchPreset(normalizeBookingFlow({ expiry_reminder: true }))).toBe("custom");
  });

  it("direct preset locks confirmation on and turns offer machinery off", () => {
    const direct = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    expect(direct.artist_acceptance).toBe(false);
    expect(direct.producer_confirmation).toBe(true);
    expect(direct.at_risk_alerts).toBe(false);
    expect(direct.auto_open_tier1).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookingFlow.test.ts`
Expected: FAIL (cannot resolve `./bookingFlow`).

- [ ] **Step 3: Write the implementation**

Create `src/lib/bookingFlow.ts`:

```ts
// Booking flow policy: one JSON object per org in app_settings key "booking_flow".
// Dual-home rule: supabase/functions/_shared/bookingFlow.ts mirrors the types,
// defaults, normalize, and referenceLabel below. Keep both in sync in the same PR.

export type OfferDelivery = "digest" | "immediate";
export type ReferenceSource = "show" | "program" | "custom";

export interface ReferenceField {
  source: ReferenceSource;
  custom_field_id?: string;
}

export interface BookingFlow {
  auto_open_tier1: boolean;
  auto_escalate: boolean;
  at_risk_alerts: boolean;
  offer_delivery: OfferDelivery;
  expiry_reminder: boolean;
  artist_acceptance: boolean;
  producer_confirmation: boolean;
  confirmation_digest: boolean;
  understudy_promotion: boolean;
  reference_field: ReferenceField;
}

// Defaults = current production behavior for an org with no booking_flow row.
// auto_open_tier1 is true because airtable-poll already auto-opens tier 1 for
// newly synced dates (openOfferTierBatch).
export const BOOKING_FLOW_DEFAULTS: BookingFlow = {
  auto_open_tier1: true,
  auto_escalate: false,
  at_risk_alerts: true,
  offer_delivery: "digest",
  expiry_reminder: false,
  artist_acceptance: true,
  producer_confirmation: true,
  confirmation_digest: true,
  understudy_promotion: true,
  reference_field: { source: "show" },
};

export type PresetName = "classic" | "fasttrack" | "direct";

type FlowFields = Omit<BookingFlow, "reference_field">;

export const BOOKING_FLOW_PRESETS: Record<PresetName, FlowFields> = {
  classic: {
    auto_open_tier1: true,
    auto_escalate: false,
    at_risk_alerts: true,
    offer_delivery: "digest",
    expiry_reminder: false,
    artist_acceptance: true,
    producer_confirmation: true,
    confirmation_digest: true,
    understudy_promotion: true,
  },
  fasttrack: {
    auto_open_tier1: true,
    auto_escalate: true,
    at_risk_alerts: true,
    offer_delivery: "immediate",
    expiry_reminder: true,
    artist_acceptance: true,
    producer_confirmation: false,
    confirmation_digest: true,
    understudy_promotion: true,
  },
  direct: {
    auto_open_tier1: false,
    auto_escalate: false,
    at_risk_alerts: false,
    offer_delivery: "digest",
    expiry_reminder: false,
    artist_acceptance: false,
    producer_confirmation: true,
    confirmation_digest: true,
    understudy_promotion: true,
  },
};

const FLOW_FIELD_KEYS = Object.keys(BOOKING_FLOW_PRESETS.classic) as (keyof FlowFields)[];

export function normalizeBookingFlow(value: unknown): BookingFlow {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const bool = (key: keyof FlowFields): boolean =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : (BOOKING_FLOW_DEFAULTS[key] as boolean);

  const delivery: OfferDelivery = raw.offer_delivery === "immediate" ? "immediate" : "digest";

  const rawRef =
    raw.reference_field && typeof raw.reference_field === "object" && !Array.isArray(raw.reference_field)
      ? (raw.reference_field as Record<string, unknown>)
      : {};
  let reference_field: ReferenceField = { source: "show" };
  if (rawRef.source === "program") reference_field = { source: "program" };
  else if (rawRef.source === "custom" && typeof rawRef.custom_field_id === "string") {
    reference_field = { source: "custom", custom_field_id: rawRef.custom_field_id };
  }

  const flow: BookingFlow = {
    auto_open_tier1: bool("auto_open_tier1"),
    auto_escalate: bool("auto_escalate"),
    at_risk_alerts: bool("at_risk_alerts"),
    offer_delivery: delivery,
    expiry_reminder: bool("expiry_reminder"),
    artist_acceptance: bool("artist_acceptance"),
    producer_confirmation: bool("producer_confirmation"),
    confirmation_digest: bool("confirmation_digest"),
    understudy_promotion: bool("understudy_promotion"),
    reference_field,
  };
  if (!flow.artist_acceptance) flow.producer_confirmation = true;
  return flow;
}

export function applyPreset(flow: BookingFlow, preset: PresetName): BookingFlow {
  return { ...flow, ...BOOKING_FLOW_PRESETS[preset] };
}

export function matchPreset(flow: BookingFlow): PresetName | "custom" {
  for (const name of Object.keys(BOOKING_FLOW_PRESETS) as PresetName[]) {
    const preset = BOOKING_FLOW_PRESETS[name];
    if (FLOW_FIELD_KEYS.every((key) => flow[key] === preset[key])) return name;
  }
  return "custom";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bookingFlow.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookingFlow.ts src/lib/bookingFlow.test.ts
git commit -m "add booking flow policy core (defaults, presets, normalize)"
```

---

### Task 2: Booking flow presentation functions (chips, practice, preview, reference label, audit diff)

**Files:**
- Modify: `src/lib/bookingFlow.ts` (append)
- Test: `src/lib/bookingFlow.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `interface FlowTimes { windowHours: number; offerDigestHour: number; confirmationDigestHour: number }`
  - `interface LifecycleChip { label: string; tone: "violet" | "amber" | "green" | "neutral" }`
  - `function lifecycleChips(flow: BookingFlow): LifecycleChip[]`
  - `interface PracticeRow { who: "Artist" | "Producer" | "Automation"; text: string }`
  - `function inPracticeRows(flow: BookingFlow, times: FlowTimes): PracticeRow[]`
  - `interface PreviewRow { at: string; text: string }`
  - `function flowPreviewRows(flow: BookingFlow, times: FlowTimes): PreviewRow[]`
  - `function referenceLabel(args: { reference: ReferenceField; show: { program: string | null; sub_program: string | null } | null; custom: Record<string, unknown> | null; customFieldKey: string | null }): string`
  - `function describeAuditEntry(entry: { key: string; old_value: unknown; new_value: unknown }): string`
  - `function hh(hour: number): string` (zero-padded `"19:00"`)

- [ ] **Step 1: Write the failing tests (append to `src/lib/bookingFlow.test.ts`)**

```ts
import {
  describeAuditEntry,
  flowPreviewRows,
  inPracticeRows,
  lifecycleChips,
  referenceLabel,
} from "./bookingFlow";

const TIMES = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };

describe("lifecycleChips", () => {
  it("classic: suggested → soft booked → confirmed", () => {
    expect(lifecycleChips(BOOKING_FLOW_DEFAULTS).map((c) => c.label)).toEqual([
      "Suggested",
      "Soft booked",
      "Confirmed",
    ]);
  });
  it("auto-confirm: suggested → confirmed", () => {
    const flow = normalizeBookingFlow({ producer_confirmation: false });
    expect(lifecycleChips(flow).map((c) => c.label)).toEqual(["Suggested", "Confirmed"]);
  });
  it("direct: direct booking → confirmed", () => {
    const flow = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    expect(lifecycleChips(flow).map((c) => c.label)).toEqual(["Direct booking", "Confirmed"]);
    expect(lifecycleChips(flow)[0].tone).toBe("neutral");
  });
});

describe("inPracticeRows", () => {
  it("always returns artist, producer, automation rows", () => {
    expect(inPracticeRows(BOOKING_FLOW_DEFAULTS, TIMES).map((r) => r.who)).toEqual([
      "Artist",
      "Producer",
      "Automation",
    ]);
  });
  it("mentions digest hour and window in classic artist row", () => {
    const artist = inPracticeRows(BOOKING_FLOW_DEFAULTS, TIMES)[0].text;
    expect(artist).toContain("19:00");
    expect(artist).toContain("48 h");
    expect(artist).toContain("soft-books");
  });
  it("direct mode: artist never sees an offer, producer books directly", () => {
    const rows = inPracticeRows(applyPreset(BOOKING_FLOW_DEFAULTS, "direct"), TIMES);
    expect(rows[0].text).toContain("Never sees an offer");
    expect(rows[1].text).toContain("eligibility list");
  });
  it("contains no em- or en-dashes in any row for any preset", () => {
    for (const preset of ["classic", "fasttrack", "direct"] as const) {
      for (const row of inPracticeRows(applyPreset(BOOKING_FLOW_DEFAULTS, preset), TIMES)) {
        expect(row.text).not.toMatch(/[—–]/);
      }
    }
  });
});

describe("flowPreviewRows", () => {
  it("classic shows digest send and manual tier wait", () => {
    const texts = flowPreviewRows(BOOKING_FLOW_DEFAULTS, TIMES).map((r) => r.text).join("\n");
    expect(texts).toContain("Offer digest emailed");
    expect(texts).toContain("48 h response window");
  });
  it("fast-track shows immediate email, reminder, and auto-escalation", () => {
    const texts = flowPreviewRows(applyPreset(BOOKING_FLOW_DEFAULTS, "fasttrack"), TIMES)
      .map((r) => r.text)
      .join("\n");
    expect(texts).toContain("Offers emailed immediately");
    expect(texts).toContain("expiry reminder");
    expect(texts).toContain("tier 2 opens automatically");
  });
  it("direct mode has no offer rows", () => {
    const texts = flowPreviewRows(applyPreset(BOOKING_FLOW_DEFAULTS, "direct"), TIMES)
      .map((r) => r.text)
      .join("\n");
    expect(texts).toContain("eligibility list");
    expect(texts).not.toContain("digest emailed");
  });
  it("contains no em- or en-dashes for any preset", () => {
    for (const preset of ["classic", "fasttrack", "direct"] as const) {
      for (const row of flowPreviewRows(applyPreset(BOOKING_FLOW_DEFAULTS, preset), TIMES)) {
        expect(row.text).not.toMatch(/[—–]/);
        expect(row.at).not.toMatch(/[—–]/);
      }
    }
  });
});

describe("referenceLabel", () => {
  const show = { program: "Candlelight", sub_program: "Strings" };
  it("show source joins program and sub-program with a middot", () => {
    expect(referenceLabel({ reference: { source: "show" }, show, custom: null, customFieldKey: null }))
      .toBe("Candlelight · Strings");
  });
  it("program source uses program only", () => {
    expect(referenceLabel({ reference: { source: "program" }, show, custom: null, customFieldKey: null }))
      .toBe("Candlelight");
  });
  it("custom source reads the custom field value", () => {
    expect(
      referenceLabel({
        reference: { source: "custom", custom_field_id: "cf-1" },
        show,
        custom: { berechnung: "FV-2033" },
        customFieldKey: "berechnung",
      }),
    ).toBe("FV-2033");
  });
  it("custom falls back to the show label when the value is empty or the key unknown", () => {
    expect(
      referenceLabel({
        reference: { source: "custom", custom_field_id: "cf-1" },
        show,
        custom: { berechnung: "  " },
        customFieldKey: "berechnung",
      }),
    ).toBe("Candlelight · Strings");
    expect(
      referenceLabel({
        reference: { source: "custom", custom_field_id: "cf-1" },
        show,
        custom: null,
        customFieldKey: null,
      }),
    ).toBe("Candlelight · Strings");
  });
  it("handles missing show gracefully", () => {
    expect(referenceLabel({ reference: { source: "show" }, show: null, custom: null, customFieldKey: null }))
      .toBe("Untitled show");
  });
});

describe("describeAuditEntry", () => {
  it("diffs booking_flow field by field with human labels", () => {
    const text = describeAuditEntry({
      key: "booking_flow",
      old_value: BOOKING_FLOW_DEFAULTS,
      new_value: { ...BOOKING_FLOW_DEFAULTS, artist_acceptance: false, producer_confirmation: true },
    });
    expect(text).toBe("Artist acceptance: on → off");
  });
  it("formats delivery and reference changes", () => {
    const text = describeAuditEntry({
      key: "booking_flow",
      old_value: BOOKING_FLOW_DEFAULTS,
      new_value: {
        ...BOOKING_FLOW_DEFAULTS,
        offer_delivery: "immediate",
        reference_field: { source: "program" },
      },
    });
    expect(text).toContain("Offer delivery: daily digest → immediate");
    expect(text).toContain("Reference field: show label → program");
  });
  it("formats scalar setting keys", () => {
    expect(
      describeAuditEntry({ key: "offer_response_window_hours", old_value: 72, new_value: 48 }),
    ).toBe("Response window: 72 → 48");
  });
  it("reports no effective change for identical values", () => {
    expect(
      describeAuditEntry({ key: "booking_flow", old_value: BOOKING_FLOW_DEFAULTS, new_value: BOOKING_FLOW_DEFAULTS }),
    ).toBe("No effective change");
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/lib/bookingFlow.test.ts`
Expected: FAIL (missing exports `lifecycleChips`, etc.). Task 1 tests still pass.

- [ ] **Step 3: Append the implementation to `src/lib/bookingFlow.ts`**

```ts
export interface FlowTimes {
  windowHours: number;
  offerDigestHour: number;
  confirmationDigestHour: number;
}

export interface LifecycleChip {
  label: string;
  tone: "violet" | "amber" | "green" | "neutral";
}

export function hh(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function lifecycleChips(flow: BookingFlow): LifecycleChip[] {
  if (!flow.artist_acceptance) {
    return [
      { label: "Direct booking", tone: "neutral" },
      { label: "Confirmed", tone: "green" },
    ];
  }
  const chips: LifecycleChip[] = [{ label: "Suggested", tone: "violet" }];
  if (flow.producer_confirmation) chips.push({ label: "Soft booked", tone: "amber" });
  chips.push({ label: "Confirmed", tone: "green" });
  return chips;
}

export interface PracticeRow {
  who: "Artist" | "Producer" | "Automation";
  text: string;
}

export function inPracticeRows(flow: BookingFlow, times: FlowTimes): PracticeRow[] {
  let artist: string;
  if (flow.artist_acceptance) {
    const delivery =
      flow.offer_delivery === "digest"
        ? `Gets the offer in the daily ${hh(times.offerDigestHour)} digest email`
        : "Gets the offer email the moment the tier opens";
    const accept = flow.producer_confirmation
      ? "Accepting soft-books the date."
      : "Accepting confirms the booking instantly.";
    artist = `${delivery}, then has ${times.windowHours} h to respond. ${accept}`;
  } else {
    artist = `Never sees an offer. The booking appears as confirmed in their calendar${
      flow.confirmation_digest ? ` and the ${hh(times.confirmationDigestHour)} confirmation digest.` : "."
    }`;
  }

  let producer: string;
  if (!flow.artist_acceptance) {
    producer =
      "Books artists directly from the per-date eligibility list; each booking is confirmed immediately.";
  } else if (flow.producer_confirmation) {
    producer = "Reviews accepted artists in “Ready to Confirm” and bulk-confirms the cast.";
  } else {
    producer = "No review queue: acceptances confirm on their own; the dashboard tracks fills as they land.";
  }

  const autos: string[] = [];
  if (flow.auto_open_tier1) autos.push("tier 1 opens as soon as a date is ready (sessions and slots configured)");
  if (flow.auto_escalate && flow.artist_acceptance) autos.push("unfilled windows escalate to the next tier");
  if (flow.at_risk_alerts && flow.artist_acceptance) autos.push("producers are alerted when a date can no longer fill in time");
  if (flow.expiry_reminder && flow.artist_acceptance) autos.push("unanswered artists get a reminder 24 h before their window closes");
  if (flow.understudy_promotion) autos.push("cancellations promote the longest-waiting accepted understudy");
  const automation = autos.length
    ? `${autos.join("; ").replace(/^./, (c) => c.toUpperCase())}.`
    : "Nothing runs in the background; every step is manual.";

  return [
    { who: "Artist", text: artist },
    { who: "Producer", text: producer },
    { who: "Automation", text: automation },
  ];
}

export interface PreviewRow {
  at: string;
  text: string;
}

export function flowPreviewRows(flow: BookingFlow, times: FlowTimes): PreviewRow[] {
  const rows: PreviewRow[] = [
    { at: "09:02", text: "Date created (Airtable sync or in-app) · 12 eligible artists in tier 1" },
  ];
  if (flow.artist_acceptance) {
    rows.push(
      flow.auto_open_tier1
        ? { at: "09:02", text: "Tier 1 opens automatically · 12 offers created (suggested)" }
        : { at: "·", text: "Tier 1 waits for a producer to open it" },
    );
    rows.push(
      flow.offer_delivery === "digest"
        ? { at: hh(times.offerDigestHour), text: `Offer digest emailed · ${times.windowHours} h response window starts` }
        : { at: "09:03", text: `Offers emailed immediately · ${times.windowHours} h response window starts` },
    );
    if (flow.producer_confirmation) {
      rows.push({ at: "+1 day", text: "Anna K. accepts → soft booked" });
      rows.push({ at: "+1 day", text: "Producer confirms the cast → confirmed" });
    } else {
      rows.push({ at: "+1 day", text: "Anna K. accepts → confirmed immediately" });
    }
    if (flow.expiry_reminder && times.windowHours > 24) {
      rows.push({ at: `+${times.windowHours - 24} h`, text: "Unanswered artists get an expiry reminder" });
    }
    if (flow.at_risk_alerts) {
      rows.push({ at: "auto", text: "Producers alerted if remaining offers cannot fill the date" });
    }
    rows.push(
      flow.auto_escalate
        ? { at: `+${times.windowHours} h`, text: "Window closes short → tier 2 opens automatically" }
        : { at: `+${times.windowHours} h`, text: "Window closes short; the next tier stays manual" },
    );
  } else {
    rows.push({ at: "·", text: "No offers; producer books artists from the eligibility list" });
    rows.push({ at: "·", text: "Producer booking → confirmed directly" });
  }
  if (flow.confirmation_digest) {
    rows.push({ at: hh(times.confirmationDigestHour), text: "Confirmation digest emailed to newly confirmed artists" });
  }
  if (flow.understudy_promotion) {
    rows.push({ at: "auto", text: "On cancellation, longest-waiting accepted understudy promoted" });
  }
  return rows;
}

export function referenceLabel(args: {
  reference: ReferenceField;
  show: { program: string | null; sub_program: string | null } | null;
  custom: Record<string, unknown> | null;
  customFieldKey: string | null;
}): string {
  const { reference, show, custom, customFieldKey } = args;
  const showText =
    [show?.program, show?.sub_program].filter(Boolean).join(" · ") || "Untitled show";
  if (reference.source === "program") return show?.program ?? showText;
  if (reference.source === "custom" && customFieldKey) {
    const value = custom?.[customFieldKey];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return String(value);
    }
  }
  return showText;
}

const FLOW_FIELD_LABELS: Record<keyof BookingFlow, string> = {
  auto_open_tier1: "Auto-open tier 1",
  auto_escalate: "Auto-escalation",
  at_risk_alerts: "At-risk alerts",
  offer_delivery: "Offer delivery",
  expiry_reminder: "Expiry reminder",
  artist_acceptance: "Artist acceptance",
  producer_confirmation: "Producer confirmation",
  confirmation_digest: "Confirmation digest",
  understudy_promotion: "Understudy promotion",
  reference_field: "Reference field",
};

const SETTING_LABELS: Record<string, string> = {
  booking_flow: "Booking flow",
  offer_response_window_hours: "Response window",
  offer_digest_hour_berlin: "Offer digest hour",
  confirmation_digest_hour_berlin: "Confirmation digest hour",
  resend_from_address: "Sender address",
  email_template_overrides: "Email templates",
};

function fmtFlowValue(field: keyof BookingFlow, flow: BookingFlow): string {
  if (field === "offer_delivery") return flow.offer_delivery === "digest" ? "daily digest" : "immediate";
  if (field === "reference_field") {
    if (flow.reference_field.source === "program") return "program";
    if (flow.reference_field.source === "custom") return "custom field";
    return "show label";
  }
  return flow[field] ? "on" : "off";
}

export function describeAuditEntry(entry: {
  key: string;
  old_value: unknown;
  new_value: unknown;
}): string {
  if (entry.key === "booking_flow") {
    const before = normalizeBookingFlow(entry.old_value);
    const after = normalizeBookingFlow(entry.new_value);
    const parts: string[] = [];
    for (const field of Object.keys(FLOW_FIELD_LABELS) as (keyof BookingFlow)[]) {
      const a = fmtFlowValue(field, before);
      const b = fmtFlowValue(field, after);
      if (a !== b) parts.push(`${FLOW_FIELD_LABELS[field]}: ${a} → ${b}`);
    }
    return parts.length ? parts.join(" · ") : "No effective change";
  }
  const label = SETTING_LABELS[entry.key] ?? entry.key;
  const fmt = (v: unknown) => (v === null || v === undefined ? "unset" : typeof v === "object" ? "updated" : String(v));
  return `${label}: ${fmt(entry.old_value)} → ${fmt(entry.new_value)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/bookingFlow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookingFlow.ts src/lib/bookingFlow.test.ts
git commit -m "add booking flow presentation and audit-diff functions"
```

---

### Task 3: Edge mirror `_shared/bookingFlow.ts`

**Files:**
- Create: `supabase/functions/_shared/bookingFlow.ts`
- Test: `supabase/functions/_shared/bookingFlow.test.ts`

**Interfaces:**
- Consumes: `resolveOrgSetting` from `supabase/functions/_shared/settings.ts` (`resolveOrgSetting<T>(admin, orgId, key, fallback)`).
- Produces (used by Tasks 8-14):
  - Same `BookingFlow`, `ReferenceField`, `BOOKING_FLOW_DEFAULTS`, `normalizeBookingFlow`, `referenceLabel` as the frontend module (mirror; no presets or presentation rows needed edge-side).
  - `async function resolveBookingFlow(admin: SupabaseClient, orgId: string): Promise<BookingFlow>` — sugar: `normalizeBookingFlow(await resolveOrgSetting(admin, orgId, "booking_flow", null))`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/bookingFlow.test.ts`:

```ts
import { assertEquals } from "./test-asserts.ts";
import {
  BOOKING_FLOW_DEFAULTS,
  normalizeBookingFlow,
  referenceLabel,
} from "./bookingFlow.ts";

Deno.test("normalizeBookingFlow: null and garbage return defaults", () => {
  assertEquals(normalizeBookingFlow(null), BOOKING_FLOW_DEFAULTS);
  assertEquals(normalizeBookingFlow("x"), BOOKING_FLOW_DEFAULTS);
});

Deno.test("normalizeBookingFlow: acceptance off forces confirmation on", () => {
  const flow = normalizeBookingFlow({ artist_acceptance: false, producer_confirmation: false });
  assertEquals(flow.producer_confirmation, true);
});

Deno.test("normalizeBookingFlow: bad enum values fall back", () => {
  const flow = normalizeBookingFlow({ offer_delivery: "x", reference_field: { source: "venue" } });
  assertEquals(flow.offer_delivery, "digest");
  assertEquals(flow.reference_field, { source: "show" });
});

Deno.test("referenceLabel: show, program, custom, fallback", () => {
  const show = { program: "Candlelight", sub_program: "Strings" };
  assertEquals(
    referenceLabel({ reference: { source: "show" }, show, custom: null, customFieldKey: null }),
    "Candlelight · Strings",
  );
  assertEquals(
    referenceLabel({ reference: { source: "program" }, show, custom: null, customFieldKey: null }),
    "Candlelight",
  );
  assertEquals(
    referenceLabel({
      reference: { source: "custom", custom_field_id: "cf-1" },
      show,
      custom: { berechnung: "FV-2033" },
      customFieldKey: "berechnung",
    }),
    "FV-2033",
  );
  assertEquals(
    referenceLabel({
      reference: { source: "custom", custom_field_id: "cf-1" },
      show,
      custom: {},
      customFieldKey: "berechnung",
    }),
    "Candlelight · Strings",
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/bookingFlow.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/bookingFlow.ts`. Copy the types, `BOOKING_FLOW_DEFAULTS`, `normalizeBookingFlow`, and `referenceLabel` from `src/lib/bookingFlow.ts` VERBATIM (they are dependency-free), with this header comment and one addition:

```ts
// MIRROR of src/lib/bookingFlow.ts (types, defaults, normalize, referenceLabel).
// The two runtimes cannot share an import; change both files in the same PR.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolveOrgSetting } from "./settings.ts";

// ... (verbatim copies of OfferDelivery, ReferenceSource, ReferenceField,
//      BookingFlow, BOOKING_FLOW_DEFAULTS, normalizeBookingFlow, referenceLabel
//      from src/lib/bookingFlow.ts Tasks 1-2)

export async function resolveBookingFlow(
  admin: SupabaseClient,
  orgId: string,
): Promise<BookingFlow> {
  return normalizeBookingFlow(await resolveOrgSetting(admin, orgId, "booking_flow", null));
}
```

Check the import specifier other `_shared` modules use for `@supabase/supabase-js` (open `_shared/settings.ts` line 1) and use the identical specifier.

- [ ] **Step 4: Run the test, then the whole edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/bookingFlow.test.ts`
Expected: PASS.
Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: all existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/bookingFlow.ts supabase/functions/_shared/bookingFlow.test.ts
git commit -m "add edge mirror of booking flow policy module"
```

---

### Task 4: Migration: `settings_audit_log` table + trigger + RLS

**Files:**
- Create: `supabase/migrations/$(date -u +%Y%m%d%H%M%S)_settings_audit_log.sql` (generate the timestamp when you create the file)
- Test: `supabase/tests/db/settings_audit_log.sql`

**Interfaces:**
- Consumes: existing `public.app_settings`, `public.is_org_member(uuid, uuid)`, `public.has_org_role(uuid, uuid, app_role)`.
- Produces: table `public.settings_audit_log` with columns `id uuid PK`, `org_id uuid NULL`, `key text`, `actor uuid NULL`, `old_value jsonb NULL`, `new_value jsonb NULL`, `created_at timestamptz`. Read by Task 15's `fetchSettingsAudit`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/db/settings_audit_log.sql`. Follow the house skeleton (`BEGIN; CREATE EXTENSION pgtap...; SELECT plan(N); ... finish(); ROLLBACK;`) and the seed idiom from `supabase/tests/triggers/notifications_pref_gate.sql` (seed under `SET session_replication_role = replica;`, impersonate with `set_config('request.jwt.claims', ...)` + `SET LOCAL ROLE authenticated` per `supabase/tests/rls/per_org_settings.sql:46-68`):

```sql
-- settings_audit_log: app_settings writes are audited; org admins can read their org's rows.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-00000000ad01','authenticated','authenticated','audit-admin@x.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('00000000-0000-0000-0000-00000000ad02','authenticated','authenticated','audit-other@x.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug) VALUES
  ('00000000-0000-0000-0000-00000000ac01','AuditOrgA','audit-org-a'),
  ('00000000-0000-0000-0000-00000000ac02','AuditOrgB','audit-org-b');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-00000000ac01','00000000-0000-0000-0000-00000000ad01','admin'),
  ('00000000-0000-0000-0000-00000000ac02','00000000-0000-0000-0000-00000000ad02','admin');
SET session_replication_role = DEFAULT;

-- 1. INSERT into app_settings writes an audit row with old_value NULL
INSERT INTO public.app_settings (org_id, key, value)
VALUES ('00000000-0000-0000-0000-00000000ac01','booking_flow','{"artist_acceptance":true}'::jsonb);
SELECT is(
  (SELECT count(*)::int FROM public.settings_audit_log
   WHERE org_id='00000000-0000-0000-0000-00000000ac01' AND key='booking_flow' AND old_value IS NULL),
  1, 'insert audited with old_value NULL');

-- 2. UPDATE with a changed value writes a row carrying old and new
UPDATE public.app_settings SET value='{"artist_acceptance":false}'::jsonb
WHERE org_id='00000000-0000-0000-0000-00000000ac01' AND key='booking_flow';
SELECT is(
  (SELECT count(*)::int FROM public.settings_audit_log
   WHERE org_id='00000000-0000-0000-0000-00000000ac01' AND key='booking_flow'
     AND old_value='{"artist_acceptance":true}'::jsonb
     AND new_value='{"artist_acceptance":false}'::jsonb),
  1, 'update audited with old and new values');

-- 3. UPDATE with an identical value writes nothing
UPDATE public.app_settings SET value='{"artist_acceptance":false}'::jsonb
WHERE org_id='00000000-0000-0000-0000-00000000ac01' AND key='booking_flow';
SELECT is(
  (SELECT count(*)::int FROM public.settings_audit_log
   WHERE org_id='00000000-0000-0000-0000-00000000ac01' AND key='booking_flow'),
  2, 'no-op update not audited');

-- 4. org admin can read own org rows
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000ad01","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.settings_audit_log
   WHERE org_id='00000000-0000-0000-0000-00000000ac01'),
  2, 'org admin reads own org audit rows');
RESET ROLE;

-- 5. other-org admin sees nothing
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000ad02","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.settings_audit_log
   WHERE org_id='00000000-0000-0000-0000-00000000ac01'),
  0, 'foreign org admin sees no audit rows');

-- 6. authenticated users cannot write the audit log directly
SELECT throws_ok(
  $$INSERT INTO public.settings_audit_log (org_id, key, new_value)
    VALUES ('00000000-0000-0000-0000-00000000ac02','x','{}'::jsonb)$$,
  '42501', NULL, 'direct insert denied by RLS');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Write the migration**

Create the migration file (generate the name with `echo "$(date -u +%Y%m%d%H%M%S)_settings_audit_log.sql"`):

```sql
-- settings_audit_log: per-change audit for app_settings, feeding the
-- Settings → Booking flow "Change history" rail.
-- Writes happen ONLY via the trigger below (SECURITY DEFINER); there is
-- deliberately no INSERT policy (no WITH CHECK (true) on audit tables).
-- Rows with org_id IS NULL (platform-default edits) are invisible to org
-- members by design; a platform-console reader can be added later.

CREATE TABLE public.settings_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  actor uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_settings_audit_org_key
  ON public.settings_audit_log (org_id, key, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_app_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.value IS NOT DISTINCT FROM OLD.value THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.settings_audit_log (org_id, key, actor, old_value, new_value)
  VALUES (
    NEW.org_id,
    NEW.key,
    auth.uid(),
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.value ELSE NULL END,
    NEW.value
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER log_app_settings_change
AFTER INSERT OR UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.log_app_settings_change();

ALTER TABLE public.settings_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON public.settings_audit_log
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), org_id))
  WITH CHECK (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins can view settings audit"
  ON public.settings_audit_log FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'));
```

Before finalizing, open `supabase/migrations/20260617164248_airtable_sync_records.sql:43-52` and confirm the policy syntax matches that template exactly (it does; adjust only if the template differs from the above).

- [ ] **Step 3: Sanity-check the SQL locally**

pgTAP cannot run locally; instead verify the migration parses by reading it once more against the checklist: table, index, function, trigger, RLS enable, two policies, no `WITH CHECK (true)`. Then run the frontend type check to be sure nothing else broke: `npx tsc -p tsconfig.app.json --noEmit`.
Expected: no errors. (CI's "Database tests (pgTAP)" job is the real verifier.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_settings_audit_log.sql supabase/tests/db/settings_audit_log.sql
git commit -m "add settings_audit_log table, trigger, and rls"
```

---

### Task 5: Migration: transition guard `suggested → confirmed` + `bookings.reminder_sent_at`

**Files:**
- Create: `supabase/migrations/$(date -u +%Y%m%d%H%M%S)_booking_flow_guard_and_reminder.sql`
- Modify: `supabase/tests/triggers/enforce_booking_transition.sql` (append assertions, bump `plan(N)`)

**Interfaces:**
- Consumes: existing `public.enforce_booking_transition()` (defined in `supabase/migrations/20260702120020_booking_transition_guard.sql:42-75`).
- Produces: guard additionally allows `suggested → confirmed`; new nullable column `public.bookings.reminder_sent_at timestamptz` (used by Task 11).

- [ ] **Step 1: Extend the pgTAP test first**

Open `supabase/tests/triggers/enforce_booking_transition.sql`. Find the existing `SELECT plan(N);` and increase N by 2. Using the file's existing seeded booking fixtures (reuse whatever helper inserts a `suggested` booking; follow the file's established pattern for creating one), append before `finish()`:

```sql
-- suggested → confirmed is now legal (auto-confirm acceptance under booking_flow)
SELECT lives_ok(
  $$UPDATE public.bookings SET status='confirmed', confirmed_at=now()
    WHERE id='<the file's suggested-booking fixture id>'$$,
  'suggested → confirmed allowed');

-- confirmed → soft_booked remains illegal
SELECT throws_ok(
  $$UPDATE public.bookings SET status='soft_booked'
    WHERE id='<the same booking id, now confirmed>'$$,
  '23514', NULL, 'confirmed → soft_booked still blocked');
```

Replace the placeholder ids with the fixture ids the file actually uses (read the file; it seeds fixed uuids). Keep the file's existing assertions untouched.

- [ ] **Step 2: Write the migration**

Create the migration file. Copy the ENTIRE function definition from `supabase/migrations/20260702120020_booking_transition_guard.sql` lines 42-75 verbatim (header comment included), then make exactly two edits: (1) add `'confirmed'::booking_status` to the `suggested` branch, (2) update the header comment's legal-set line. The state-machine block must end up exactly:

```sql
  IF (OLD.status = 'suggested'::booking_status
        AND NEW.status IN ('soft_booked'::booking_status, 'confirmed'::booking_status, 'cancelled'::booking_status))
     OR (OLD.status = 'soft_booked'::booking_status
        AND NEW.status IN ('confirmed'::booking_status, 'cancelled'::booking_status))
     OR (OLD.status = 'confirmed'::booking_status
        AND NEW.status = 'cancelled'::booking_status)
  THEN
    RETURN NEW;
  END IF;
```

Do NOT re-create the trigger binding (it already points at the function; `CREATE OR REPLACE FUNCTION` is enough). Prepend to the same migration file:

```sql
-- suggested → confirmed becomes legal: artist acceptance under
-- booking_flow.producer_confirmation=false confirms in one step.
-- reminder_sent_at: idempotency stamp for the offer expiry reminder.

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
```

- [ ] **Step 3: Verify no accidental drift**

Run: `diff <(sed -n '42,75p' supabase/migrations/20260702120020_booking_transition_guard.sql) <(sed -n '/CREATE OR REPLACE FUNCTION public.enforce_booking_transition/,/^\$\$;/p' supabase/migrations/*_booking_flow_guard_and_reminder.sql)`
Expected: the ONLY differences are the added `'confirmed'::booking_status` and the comment-line edit.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_booking_flow_guard_and_reminder.sql supabase/tests/triggers/enforce_booking_transition.sql
git commit -m "allow suggested to confirmed transition, add reminder stamp"
```

---

### Task 6: Migration: understudy promotion honors the flow policy

**Files:**
- Create: `supabase/migrations/$(date -u +%Y%m%d%H%M%S)_understudy_promotion_flow_gates.sql`
- Modify: `supabase/tests/triggers/promote_understudy_on_cancellation.sql` (append, bump `plan(N)`)

**Interfaces:**
- Consumes: `public.promote_understudy_on_cancellation()` (current definition: `supabase/migrations/20260702120003_understudy_promotion_require_acceptance.sql:32-132`); `public.get_org_setting(_org uuid, _key text) RETURNS jsonb`.
- Produces: promotion trigger that (a) no-ops when `booking_flow.understudy_promotion` is false, (b) in direct mode (`artist_acceptance` false) also considers `confirmed` understudies since no accept step exists.

- [ ] **Step 1: Extend the pgTAP test first**

Open `supabase/tests/triggers/promote_understudy_on_cancellation.sql`; bump `plan(N)` by 2; append two scenarios before `finish()`, following the file's existing seed pattern (org, show, date, main-cast `confirmed` booking, understudy booking):

```sql
-- promotion disabled by booking_flow → cancelling the main does not promote
-- (seed a fresh date + confirmed main + soft_booked understudy per the file's pattern, then:)
INSERT INTO public.app_settings (org_id, key, value)
VALUES ('<seed org id>','booking_flow','{"understudy_promotion":false}'::jsonb)
ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value;
UPDATE public.bookings SET status='cancelled', cancelled_at=now() WHERE id='<main booking id>';
SELECT is(
  (SELECT status::text FROM public.bookings WHERE id='<understudy booking id>'),
  'soft_booked', 'promotion skipped when understudy_promotion=false');

-- direct mode: a confirmed understudy is promoted (is_understudy flips false)
UPDATE public.app_settings SET value='{"understudy_promotion":true,"artist_acceptance":false}'::jsonb
WHERE org_id='<seed org id>' AND key='booking_flow';
-- (seed a fresh date + confirmed main + CONFIRMED understudy, then cancel the main:)
UPDATE public.bookings SET status='cancelled', cancelled_at=now() WHERE id='<main2 booking id>';
SELECT is(
  (SELECT (status::text || ':' || is_understudy::text) FROM public.bookings WHERE id='<understudy2 booking id>'),
  'confirmed:false', 'direct mode promotes a confirmed understudy');
```

Replace the placeholder ids with fixture uuids following the file's numbering convention.

- [ ] **Step 2: Write the migration**

Copy the entire function from `20260702120003_understudy_promotion_require_acceptance.sql:32-132` verbatim into the new migration as a `CREATE OR REPLACE FUNCTION`, then apply exactly three edits:

1. Add to the DECLARE block:

```sql
  v_flow jsonb;
  v_acceptance boolean;
```

2. Immediately after the existing `app.cancelling_show_date` early-return guard, insert:

```sql
  -- Booking flow policy gates (org override → platform default → code default true).
  v_flow := public.get_org_setting(NEW.org_id, 'booking_flow');
  IF COALESCE((v_flow->>'understudy_promotion')::boolean, true) = false THEN
    RETURN NEW;
  END IF;
  v_acceptance := COALESCE((v_flow->>'artist_acceptance')::boolean, true);
```

3. In the candidate SELECT, replace the line `AND b.status = 'soft_booked'::booking_status` with:

```sql
    AND (
      (v_acceptance AND b.status = 'soft_booked'::booking_status)
      OR (NOT v_acceptance AND b.status IN ('soft_booked'::booking_status, 'confirmed'::booking_status))
    )
```

Everything else (FOR UPDATE SKIP LOCKED, promotion UPDATE to `confirmed` + `is_understudy=false`, audit log row, notification insert) stays byte-identical. A `confirmed → confirmed` promotion UPDATE passes the transition guard via its same-status short-circuit.

- [ ] **Step 3: Verify drift**

Run: `diff <(sed -n '32,132p' supabase/migrations/20260702120003_understudy_promotion_require_acceptance.sql) <(sed -n '/CREATE OR REPLACE FUNCTION public.promote_understudy_on_cancellation/,/^\$\$;/p' supabase/migrations/*_understudy_promotion_flow_gates.sql)`
Expected: only the three edits above.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*_understudy_promotion_flow_gates.sql supabase/tests/triggers/promote_understudy_on_cancellation.sql
git commit -m "gate understudy promotion on booking flow policy"
```

---

### Task 7: Client data functions honor the flow (respondToOffer, createBooking, useBookingFlow)

**Files:**
- Modify: `src/data/bookings.ts` (respondToOffer at :204; add createBooking)
- Modify: `src/data/settings.ts` (add fetchBookingFlow)
- Create: `src/hooks/useBookingFlow.ts`
- Modify: `src/components/availability/OfferResponseButtons.tsx`
- Modify: `src/lib/bookings.ts` (add shouldAutoOpenTier1 helper, used by Task 14)
- Test: `src/data/bookings.test.ts`, `src/data/settings.test.ts` (append), `src/lib/bookings.test.ts` (append)

**Interfaces:**
- Consumes: `normalizeBookingFlow`, `BookingFlow` from `@/lib/bookingFlow`; `resolveOrgSetting` from `@/data/settings`.
- Produces:
  - `respondToOffer(client, args: { bookingId: string; accept: boolean; now: Date; autoConfirm?: boolean }): Promise<{ affected: number }>` — accept with `autoConfirm: true` writes `{ status: "confirmed", confirmed_at }` (still guarded by `.eq("status","suggested")`).
  - `createBooking(client, args: { showDateId: string; artistId: string; isUnderstudy: boolean; bookedBy: string; orgId: string; confirmDirectly: boolean; now: Date }): Promise<void>` — inserts `soft_booked`, or `confirmed` + `confirmed_at` when `confirmDirectly`.
  - `fetchBookingFlow(client, orgId: string | null): Promise<BookingFlow>` in `src/data/settings.ts` — `normalizeBookingFlow(await resolveOrgSetting(client, orgId, "booking_flow", null))`.
  - `useBookingFlow(): UseQueryResult<BookingFlow>` — thin hook, `queryKey: ["app-settings", "booking-flow", orgId]`.
  - `shouldAutoOpenTier1(args: { flow: Pick<BookingFlow, "auto_open_tier1" | "artist_acceptance">; hasSession: boolean; openedTiers: { tier: number }[] }): boolean` in `src/lib/bookings.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `src/data/bookings.test.ts` (follow the file's existing `createFakeSupabase` conventions):

```ts
describe("respondToOffer autoConfirm", () => {
  it("accept with autoConfirm writes confirmed + confirmed_at, still guarded on suggested", async () => {
    const fake = createFakeSupabase({ bookings: { data: [{ id: "b1" }], error: null } });
    const now = new Date("2026-07-14T10:00:00Z");
    const res = await respondToOffer(fake as never, { bookingId: "b1", accept: true, now, autoConfirm: true });
    expect(res).toEqual({ affected: 1 });
    const update = fake.calls.find((c) => c.table === "bookings" && c.method === "update");
    expect(update?.args[0]).toMatchObject({ status: "confirmed", confirmed_at: now.toISOString() });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["status", "suggested"] });
  });
  it("accept without autoConfirm keeps writing soft_booked", async () => {
    const fake = createFakeSupabase({ bookings: { data: [{ id: "b1" }], error: null } });
    await respondToOffer(fake as never, { bookingId: "b1", accept: true, now: new Date() });
    const update = fake.calls.find((c) => c.table === "bookings" && c.method === "update");
    expect(update?.args[0]).toMatchObject({ status: "soft_booked" });
  });
});

describe("createBooking", () => {
  const args = { showDateId: "d1", artistId: "a1", isUnderstudy: false, bookedBy: "u1", orgId: "org-1" };
  it("inserts soft_booked by default", async () => {
    const fake = createFakeSupabase({ bookings: { data: null, error: null } });
    await createBooking(fake as never, { ...args, confirmDirectly: false, now: new Date() });
    const insert = fake.calls.find((c) => c.table === "bookings" && c.method === "insert");
    expect(insert?.args[0]).toMatchObject({
      show_date_id: "d1", artist_id: "a1", status: "soft_booked", is_understudy: false,
      booked_by: "u1", org_id: "org-1",
    });
  });
  it("inserts confirmed with confirmed_at in direct mode", async () => {
    const fake = createFakeSupabase({ bookings: { data: null, error: null } });
    const now = new Date("2026-07-14T10:00:00Z");
    await createBooking(fake as never, { ...args, confirmDirectly: true, now });
    const insert = fake.calls.find((c) => c.table === "bookings" && c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ status: "confirmed", confirmed_at: now.toISOString() });
  });
});
```

Append to `src/data/settings.test.ts`:

```ts
import { fetchBookingFlow } from "./settings";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";

describe("fetchBookingFlow", () => {
  it("returns normalized defaults when no row exists", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    expect(await fetchBookingFlow(fake as never, "org-1")).toEqual(BOOKING_FLOW_DEFAULTS);
  });
  it("normalizes the org row (invariant enforced)", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: "org-1", value: { artist_acceptance: false, producer_confirmation: false } }], error: null },
    });
    const flow = await fetchBookingFlow(fake as never, "org-1");
    expect(flow.artist_acceptance).toBe(false);
    expect(flow.producer_confirmation).toBe(true);
  });
});
```

Append to `src/lib/bookings.test.ts`:

```ts
import { shouldAutoOpenTier1 } from "./bookings";

describe("shouldAutoOpenTier1", () => {
  const flow = { auto_open_tier1: true, artist_acceptance: true };
  it("true when enabled, session present, tier 1 not yet opened", () => {
    expect(shouldAutoOpenTier1({ flow, hasSession: true, openedTiers: [] })).toBe(true);
  });
  it("false without a session, when disabled, in direct mode, or when tier 1 exists", () => {
    expect(shouldAutoOpenTier1({ flow, hasSession: false, openedTiers: [] })).toBe(false);
    expect(shouldAutoOpenTier1({ flow: { ...flow, auto_open_tier1: false }, hasSession: true, openedTiers: [] })).toBe(false);
    expect(shouldAutoOpenTier1({ flow: { ...flow, artist_acceptance: false }, hasSession: true, openedTiers: [] })).toBe(false);
    expect(shouldAutoOpenTier1({ flow, hasSession: true, openedTiers: [{ tier: 1 }] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/data/bookings.test.ts src/data/settings.test.ts src/lib/bookings.test.ts`
Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement**

In `src/data/bookings.ts`, change `respondToOffer` (currently :204): add `autoConfirm?: boolean` to the args type; in the accept branch build the patch as

```ts
const patch = args.accept
  ? args.autoConfirm
    ? { status: "confirmed" as const, confirmed_at: args.now.toISOString() }
    : { status: "soft_booked" as const }
  : { status: "cancelled" as const, cancelled_at: args.now.toISOString(), cancellation_reason: "artist_declined" };
```

keeping the existing `.eq("id", ...).eq("status", "suggested").select("id")` shape and `affected` return. Add:

```ts
export async function createBooking(
  client: SupabaseClient<Database>,
  args: {
    showDateId: string;
    artistId: string;
    isUnderstudy: boolean;
    bookedBy: string;
    orgId: string;
    confirmDirectly: boolean;
    now: Date;
  },
): Promise<void> {
  const { error } = await client.from("bookings").insert({
    show_date_id: args.showDateId,
    artist_id: args.artistId,
    status: args.confirmDirectly ? "confirmed" : "soft_booked",
    confirmed_at: args.confirmDirectly ? args.now.toISOString() : null,
    is_understudy: args.isUnderstudy,
    booked_by: args.bookedBy,
    org_id: args.orgId,
  });
  if (error) throw error;
}
```

In `src/data/settings.ts` add:

```ts
import { BookingFlow, normalizeBookingFlow } from "@/lib/bookingFlow";

export async function fetchBookingFlow(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<BookingFlow> {
  return normalizeBookingFlow(await resolveOrgSetting(client, orgId, "booking_flow", null));
}
```

Create `src/hooks/useBookingFlow.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchBookingFlow } from "@/data/settings";

export function useBookingFlow() {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  return useQuery({
    queryKey: ["app-settings", "booking-flow", orgId],
    queryFn: () => fetchBookingFlow(supabase, orgId),
  });
}
```

(Check how existing hooks in `src/hooks/` import `useAuth` and mirror the exact import path.)

In `src/lib/bookings.ts` add:

```ts
export function shouldAutoOpenTier1(args: {
  flow: { auto_open_tier1: boolean; artist_acceptance: boolean };
  hasSession: boolean;
  openedTiers: { tier: number }[];
}): boolean {
  return (
    args.flow.auto_open_tier1 &&
    args.flow.artist_acceptance &&
    args.hasSession &&
    !args.openedTiers.some((t) => t.tier === 1)
  );
}
```

In `src/components/availability/OfferResponseButtons.tsx`: import `useBookingFlow`; in the accept handler pass `autoConfirm: !(flow?.producer_confirmation ?? true)` to `respondToOffer`. Success toast copy when auto-confirmed: `toast.success("Offer accepted. Booking confirmed.")`; unchanged otherwise. Keep the existing 0-rows "This offer is no longer available." path.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/data/bookings.test.ts src/data/settings.test.ts src/lib/bookings.test.ts`
Expected: PASS. Then `npx tsc -p tsconfig.app.json --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/data/bookings.ts src/data/settings.ts src/hooks/useBookingFlow.ts src/lib/bookings.ts src/components/availability/OfferResponseButtons.tsx src/data/bookings.test.ts src/data/settings.test.ts src/lib/bookings.test.ts
git commit -m "wire booking flow policy into client booking mutations"
```

---

### Task 8: open-offer-tier: direct-mode refusal + dry-run

**Files:**
- Modify: `supabase/functions/open-offer-tier/index.ts`
- Test: `supabase/functions/open-offer-tier/index.di.test.ts` (append)

**Interfaces:**
- Consumes: `resolveBookingFlow` from `../_shared/bookingFlow.ts` (Task 3).
- Produces (HTTP contract used by Tasks 12, 14, 19):
  - Request body gains optional `dry_run?: boolean`.
  - Direct mode (`artist_acceptance` false): `409` with `{ error: "Direct booking mode: offers are disabled for this organization." }`.
  - Dry-run response: `{ dry_run: true, candidates: Array<{ id: string; name: string }>, excluded: { already_booked: number; blocked: number; inactive: number } }` and NO writes.

- [ ] **Step 1: Write the failing DI tests (append to `index.di.test.ts`, reusing the file's `envVars`, `SVC`, `SHOW_DATE_OPEN`, seed helpers)**

```ts
const FLOW_DIRECT = { data: [{ org_id: "org-A", value: { artist_acceptance: false } }], error: null };

Deno.test("open-offer-tier: direct-booking org → 409, nothing written", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-A" }, error: null },
      app_settings: FLOW_DIRECT,
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 409);
  assertEquals(calls.some((c) => c.table === "bookings" && c.method === "insert"), false);
});

Deno.test("open-offer-tier: dry_run returns candidates and writes nothing", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-A" }, error: null },
      app_settings: { data: [], error: null },
      cast_city_priority: { data: [{ cast_id: "c1" }], error: null },
      cast_members: { data: [{ artist_id: "a1" }, { artist_id: "a2" }], error: null },
      artists: [
        { when: { __write: true }, data: null, error: null },
        { data: [{ id: "a1", name: "Lena" }, { id: "a2", name: "Marco" }], error: null },
      ],
      bookings: { data: [], error: null },
      blocked_dates: { data: [{ artist_id: "a2" }], error: null },
    },
  });
  const res = await handle(
    makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1, dry_run: true } }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.dry_run, true);
  assertEquals(body.candidates, [{ id: "a1", name: "Lena" }]);
  assertEquals(body.excluded.blocked, 1);
  assertEquals(calls.some((c) => c.table === "bookings" && c.method === "insert"), false);
  assertEquals(calls.some((c) => c.table === "show_date_offer_tiers" && c.method === "upsert"), false);
});
```

Adjust the `artists` seed to the file's established array-seed style: the second-query name lookup and the active-filter query both hit `artists`; verify against how the fake resolves repeated queries on the same table (mirror `bookingsSeed` at `index.di.test.ts:43-66`). If the active-filter query and the name query need distinguishing, seed with `when` on the recorded `.eq("status","active")` arg.

- [ ] **Step 2: Run to verify failures**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/open-offer-tier/`
Expected: new tests FAIL; existing ones PASS.

- [ ] **Step 3: Implement in `supabase/functions/open-offer-tier/index.ts`**

1. Import: `import { resolveBookingFlow } from "../_shared/bookingFlow.ts";`
2. Input parsing (:18-29): add `const dryRun = body.dry_run === true;`
3. Directly after the org-scoped auth block (:43-46), before the cancelled check:

```ts
const flow = await resolveBookingFlow(deps.admin, showDate.org_id);
if (!flow.artist_acceptance) {
  return json({ error: "Direct booking mode: offers are disabled for this organization." }, 409);
}
```

4. While computing the pipeline, track counts you already have in scope: `inactiveCount = memberArtistIds.length - activeArtistIds.length`, `alreadyBookedCount = activeArtistIds.filter((id) => alreadyBookedIds.has(id)).length`, `blockedCount` = number of active-and-not-booked artists removed by the blocked-dates filter (:142-155).
5. After `candidateIds` is final (:159), before `const offeredAt = deps.now()`:

```ts
if (dryRun) {
  let candidates: Array<{ id: string; name: string }> = [];
  if (candidateIds.length > 0) {
    const { data: names, error: namesErr } = await deps.admin
      .from("artists")
      .select("id, name")
      .in("id", candidateIds);
    if (namesErr) return json({ error: namesErr.message }, 500);
    candidates = (names ?? []) as Array<{ id: string; name: string }>;
  }
  return json({
    dry_run: true,
    candidates,
    excluded: { already_booked: alreadyBookedCount, blocked: blockedCount, inactive: inactiveCount },
  });
}
```

Also make the two earlier benign-exit paths (no sessions :50-54, empty candidates :153-159) return `{ dry_run: true, candidates: [], excluded: ... , message }` when `dryRun` is set, so the dialog can render the reason.

- [ ] **Step 4: Run the whole edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/open-offer-tier/
git commit -m "add direct-mode refusal and dry-run to open-offer-tier"
```

---

### Task 9: Immediate offer delivery + `offer-immediate` email template

**Files:**
- Create: `supabase/functions/_shared/transactional-email-templates/offer-immediate.tsx`
- Modify: `supabase/functions/_shared/transactional-email-templates/registry.ts`
- Modify: `supabase/functions/_shared/notificationCategories.ts` (EMAIL_TEMPLATE_CATEGORY)
- Modify: `supabase/functions/open-offer-tier/index.ts`
- Test: `supabase/functions/open-offer-tier/index.di.test.ts` (append)

**Interfaces:**
- Consumes: `deps.sendEmail` + `emailWasSent` (`_shared/deps.ts:28`), `referenceLabel` (Task 3), `resolveOrgSetting` + `BOOKING_ENGINE_DEFAULTS` (`_shared/settings.ts`), identity helpers `resolveContactEmail` / `resolveAccountDisplayName` (`_shared/identity.ts`, exactly as `send-offer-digest/index.ts:96-113` uses them).
- Produces: template `offer-immediate` (templateData: `{ displayName: string; referenceLabel: string; date: string; city: string | null; windowHours: number }`); in immediate mode, inserted bookings get `digest_sent_at` and `offer_expires_at` stamped at open.

- [ ] **Step 1: Write the failing DI test (append)**

```ts
Deno.test("open-offer-tier: immediate delivery emails artists and stamps expiry", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: { ...SHOW_DATE_OPEN, org_id: "org-A", custom: {} }, error: null },
      app_settings: { data: [{ org_id: "org-A", value: { offer_delivery: "immediate" } }], error: null },
      shows: { data: { program: "Candlelight", sub_program: "Strings" }, error: null },
      cities: { data: { name: "Berlin" }, error: null },
      cast_city_priority: { data: [{ cast_id: "c1" }], error: null },
      cast_members: { data: [{ artist_id: "a1" }], error: null },
      artists: { data: [{ id: "a1", name: "Lena", email: "lena@x.com", user_id: null }], error: null },
      bookings: [
        { when: { __write: true }, data: [{ id: "b1", artist_id: "a1" }], error: null },
        { data: [], error: null },
      ],
      blocked_dates: { data: [], error: null },
      show_date_offer_tiers: { data: null, error: null },
    },
    rpcs: { resolve_user_contacts: { data: [], error: null } },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 200);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  assertEquals((email!.body as Record<string, unknown>).template_name, "offer-immediate");
  const stamp = calls.find(
    (c) => c.table === "bookings" && c.method === "update" &&
      (c.args[0] as Record<string, unknown>).offer_expires_at !== undefined,
  );
  assertExists(stamp);
});

Deno.test("open-offer-tier: digest delivery (default) sends no email at open", async () => {
  // same seeds minus the app_settings override; assert invokeCalls has no send-transactional-email
});
```

Write the second test in full (copy the first, drop the `app_settings` value, assert `invokeCalls.filter(c => c.name === "send-transactional-email").length === 0` and no `offer_expires_at` update).

- [ ] **Step 2: Run to verify failures**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/open-offer-tier/`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

Create `offer-immediate.tsx` modeled byte-for-byte on `artist-offer-digest.tsx`'s imports and export shape (`/// <reference ...>`, `npm:react@18.3.1`, `npm:@react-email/components@0.0.22`, `APP_URL`):

```tsx
/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { APP_URL } from '../app-url.ts'

const SITE_NAME = 'ShowFlow'
const AVAILABILITY_URL = `${APP_URL}/availability`

function OfferImmediate({ displayName, referenceLabel, date, city, windowHours }: Record<string, any>) {
  return (
    <Html>
      <Head />
      <Preview>New offer: {referenceLabel}</Preview>
      <Body style={{ backgroundColor: '#F6F4EF', fontFamily: 'Helvetica, Arial, sans-serif' }}>
        <Container style={{ padding: '24px' }}>
          <Heading as="h2">You have a new offer</Heading>
          <Text>Hi {displayName},</Text>
          <Text>
            You have been offered {referenceLabel} on {date}
            {city ? ` in ${city}` : ''}. You have {windowHours} hours to respond before the offer expires.
          </Text>
          <Section>
            <Button href={AVAILABILITY_URL} style={{ backgroundColor: '#6E5CF6', color: '#ffffff', padding: '10px 18px', borderRadius: '8px' }}>
              Respond on {SITE_NAME}
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: OfferImmediate,
  subject: (data: Record<string, any>) => `Offer: ${data.referenceLabel} · ${data.date}`,
  displayName: 'Immediate offer',
  previewData: { displayName: 'Jane Performer', referenceLabel: 'Candlelight · Strings', date: '2026-04-30', city: 'Berlin', windowHours: 48 },
} satisfies TemplateEntry
```

Registry: `import { template as offerImmediate } from './offer-immediate.tsx'` and add `'offer-immediate': offerImmediate` to `TEMPLATES`. In `_shared/notificationCategories.ts` add `'offer-immediate': 'booking_offers'` to `EMAIL_TEMPLATE_CATEGORY` (so the central pref gate in send-transactional-email applies).

In `open-offer-tier/index.ts`:
1. Add `custom` to the show_dates select (:32-38).
2. Change the bookings insert select from `.select('id')` to `.select('id, artist_id')` (:172-189).
3. After a successful insert and tier upsert, when `flow.offer_delivery === "immediate"`, add (import `resolveOrgSetting`, `BOOKING_ENGINE_DEFAULTS` from `../_shared/settings.ts`; `referenceLabel` from `../_shared/bookingFlow.ts`; `emailWasSent` from `../_shared/deps.ts`; identity helpers from `../_shared/identity.ts`):

```ts
if (flow.offer_delivery === "immediate") {
  const windowHours = await resolveOrgSetting(
    deps.admin, showDate.org_id, "offer_response_window_hours",
    BOOKING_ENGINE_DEFAULTS.offer_response_window_hours,
  );
  const expiresAt = new Date(offeredAt.getTime() + windowHours * 3600 * 1000);

  const { data: showRow } = await deps.admin
    .from("shows").select("program, sub_program").eq("id", showDate.show_id).maybeSingle();
  let cityName: string | null = null;
  if (showDate.city_id) {
    const { data: cityRow } = await deps.admin
      .from("cities").select("name").eq("id", showDate.city_id).maybeSingle();
    cityName = (cityRow as { name: string } | null)?.name ?? null;
  }
  let customFieldKey: string | null = null;
  if (flow.reference_field.source === "custom" && flow.reference_field.custom_field_id) {
    const { data: def } = await deps.admin
      .from("custom_field_definitions").select("key")
      .eq("id", flow.reference_field.custom_field_id).maybeSingle();
    customFieldKey = (def as { key: string } | null)?.key ?? null;
  }
  const label = referenceLabel({
    reference: flow.reference_field,
    show: (showRow ?? null) as { program: string | null; sub_program: string | null } | null,
    custom: (showDate.custom ?? null) as Record<string, unknown> | null,
    customFieldKey,
  });

  const { data: artistRows } = await deps.admin
    .from("artists").select("id, name, email, user_id").in("id", candidateIds);
  const userIds = (artistRows ?? []).map((a: { user_id: string | null }) => a.user_id).filter(Boolean);
  const { data: contacts } = userIds.length
    ? await deps.admin.rpc("resolve_user_contacts", { p_user_ids: userIds })
    : { data: [] };
  // Build authEmail lookup and per-artist recipient exactly like send-offer-digest/index.ts:85-113.

  const bookingByArtist = new Map(
    (insertedRows ?? []).map((r: { id: string; artist_id: string }) => [r.artist_id, r.id]),
  );
  const sentBookingIds: string[] = [];
  for (const artist of (artistRows ?? []) as Array<{ id: string; name: string; email: string | null; user_id: string | null }>) {
    const recipient = resolveContactEmail({ authEmail: authEmailFor(artist.user_id), bookingEmail: artist.email });
    if (!recipient) continue;
    const result = await deps.sendEmail({
      template_name: "offer-immediate",
      recipient_email: recipient,
      org_id: showDate.org_id,
      templateData: {
        displayName: resolveAccountDisplayName({ name: artist.name }),
        referenceLabel: label,
        date: showDate.date,
        city: cityName,
        windowHours,
      },
      idempotency_key: `offer-immediate-${show_date_id}-${artist.id}`,
    });
    if (emailWasSent(result)) {
      const bid = bookingByArtist.get(artist.id);
      if (bid) sentBookingIds.push(bid);
    }
  }
  if (sentBookingIds.length) {
    await deps.admin.from("bookings")
      .update({ digest_sent_at: offeredAt.toISOString(), offer_expires_at: expiresAt.toISOString() })
      .in("id", sentBookingIds);
  }
}
```

Open `send-offer-digest/index.ts:85-113` and `_shared/identity.ts` first and match the exact helper signatures (`resolveContactEmail`, `resolveAccountDisplayName`) rather than the sketches above; keep `insertedRows` as the variable holding the insert's `.select("id, artist_id")` result.

- [ ] **Step 4: Run the whole edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS (including registry/preview tests if any assert the template list).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/transactional-email-templates/ supabase/functions/_shared/notificationCategories.ts supabase/functions/open-offer-tier/
git commit -m "send immediate offer emails when delivery mode is immediate"
```

---

### Task 10: Digest senders honor the flow

**Files:**
- Modify: `supabase/functions/send-offer-digest/index.ts`
- Modify: `supabase/functions/send-confirmation-digest/index.ts`
- Test: append to each function's `.di.test.ts`

**Interfaces:**
- Consumes: `resolveBookingFlow` (Task 3).
- Produces: offer digest skips orgs with `offer_delivery === "immediate"` or `artist_acceptance === false`; confirmation digest skips orgs with `confirmation_digest === false`.

- [ ] **Step 1: Write the failing DI tests**

Append to `send-offer-digest/index.di.test.ts` (mirror the file's existing seed for a matching digest hour and one due booking):

```ts
Deno.test("send-offer-digest: immediate-delivery org is skipped", async () => {
  // Copy the file's existing happy-path seed (org at the matching Berlin hour with one
  // suggested booking), then add:
  //   app_settings: { data: [{ org_id: "org-1", value: { offer_delivery: "immediate" } }], error: null }
  // Note: resolveOrgSetting for the digest hour ALSO reads app_settings, so seed with
  // array entries distinguished by the recorded .eq("key", ...) arg:
  //   app_settings: [
  //     { when: { key: "booking_flow" }, data: [{ org_id: "org-1", value: { offer_delivery: "immediate" } }], error: null },
  //     { data: [], error: null },
  //   ]
  // Assert: invokeCalls contains no send-transactional-email, response digests_sent === 0.
});

Deno.test("send-offer-digest: direct-mode org is skipped", async () => {
  // Same, with value { artist_acceptance: false }.
});
```

Write both tests in full following the file's existing happy-path test as the base. Append the symmetric test to `send-confirmation-digest/index.di.test.ts` with `value: { confirmation_digest: false }`.

- [ ] **Step 2: Run to verify failures**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/send-offer-digest/ supabase/functions/send-confirmation-digest/`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

`send-offer-digest/index.ts`, inside the org loop directly after the digest-hour gate (:42-47):

```ts
const flow = await resolveBookingFlow(admin, org.id);
if (!flow.artist_acceptance || flow.offer_delivery === "immediate") continue;
```

`send-confirmation-digest/index.ts`, at the equivalent spot in its org loop (after its hour gate):

```ts
const flow = await resolveBookingFlow(admin, org.id);
if (!flow.confirmation_digest) continue;
```

(Direct mode keeps its confirmation digest: it is the artist's only notification.)

**Reference field in digest content:** both digests currently label each offer/confirmation from `shows(program, sub_program)`. In BOTH functions, after resolving `flow`, resolve `customFieldKey` once per org (same `custom_field_definitions` lookup as Task 9; the digest queries must add `custom` to their `show_dates(...)` select), and build each item's display label with `referenceLabel({ reference: flow.reference_field, show: row.show_dates?.shows ?? null, custom: row.show_dates?.custom ?? null, customFieldKey })`, passing it into the existing templateData item shape (add a `label` field the templates render in place of the raw program strings; update `artist-offer-digest.tsx` / `artist-confirmation-digest.tsx` to prefer `offer.label` with fallback to their current program rendering so previews stay valid). Extend one DI test per function asserting the templateData items carry the custom-field label when the org's flow selects a custom reference.

- [ ] **Step 4: Run the whole edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-offer-digest/ supabase/functions/send-confirmation-digest/
git commit -m "gate digest senders on booking flow policy"
```

---

### Task 11: Expiry reminder (template + expire-offers pass)

**Files:**
- Create: `supabase/functions/_shared/transactional-email-templates/offer-expiry-reminder.tsx`
- Modify: `supabase/functions/_shared/transactional-email-templates/registry.ts`, `supabase/functions/_shared/notificationCategories.ts`
- Modify: `supabase/functions/expire-offers/index.ts`
- Test: `supabase/functions/expire-offers/index.di.test.ts` (append)

**Interfaces:**
- Consumes: Task 5's `bookings.reminder_sent_at`; `resolveBookingFlow`, `referenceLabel`; `getActiveOrgs`; identity helpers.
- Produces: template `offer-expiry-reminder` (templateData `{ displayName: string; offers: Array<{ referenceLabel: string; date: string; expiresAt: string }> }`); reminder rows stamped `reminder_sent_at`; in-app notification `type: "offer_expiring"` for artists with accounts; response gains `reminders_sent`.

- [ ] **Step 1: Write the failing DI tests (append to `expire-offers/index.di.test.ts`)**

```ts
Deno.test("expire-offers: sends one reminder per artist inside the 24h window and stamps reminder_sent_at", async () => {
  // Seeds: organizations active org "org-1"; app_settings booking_flow
  //   { expiry_reminder: true }; a suggested booking with offer_expires_at
  //   12h after the fake now, reminder_sent_at null, joined artists row
  //   (email, user_id null) and show_dates→shows rows; empty tier scan
  //   (show_date_offer_tiers: { data: [], error: null }) so the escalation
  //   loop is quiet. rpcs: expire_soft_bookings { data: null, error: null },
  //   resolve_user_contacts { data: [], error: null }.
  // Assert: one send-transactional-email invokeCall with template_name
  //   "offer-expiry-reminder"; one bookings update whose args[0] has
  //   reminder_sent_at; response json reminders_sent === 1.
});

Deno.test("expire-offers: no reminder when expiry_reminder is off or already stamped", async () => {
  // Two variants in one test body: flow off → zero reminder emails;
  //   then stamped booking (reminder_sent_at set) with flow on → zero.
});
```

Write both in full, modeling seeds on the file's existing tests (reuse its `envVars`/`SVC` constants and fake-now default `2026-06-01T12:00:00Z`).

- [ ] **Step 2: Run to verify failures**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/expire-offers/`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

Create `offer-expiry-reminder.tsx` with the same scaffolding as `offer-immediate.tsx`; body lists each offer as `Text` rows: `"{referenceLabel} on {date}: respond by {expiresAt}"`; subject: `(data) => { const n = (data?.offers ?? []).length; return n === 1 ? "Reminder: your offer expires soon" : \`Reminder: ${n} offers expire soon\`; }`; CTA button to `AVAILABILITY_URL`. Register as `'offer-expiry-reminder'` in `TEMPLATES` and add `'offer-expiry-reminder': 'booking_offers'` to `EMAIL_TEMPLATE_CATEGORY`.

In `expire-offers/index.ts`, after the `expire_soft_bookings` RPC (:30-31) and before the tier scan, insert the reminder pass:

```ts
let remindersSent = 0;
const orgs = await getActiveOrgs(admin);
for (const org of orgs) {
  const flow = await resolveBookingFlow(admin, org.id);
  if (!flow.artist_acceptance || !flow.expiry_reminder) continue;
  const cutoff = new Date(now.getTime() + 24 * 3600 * 1000);
  const { data: due, error: dueErr } = await admin
    .from("bookings")
    .select("id, artist_id, offer_expires_at, artists(id, name, email, user_id), show_dates(date, custom, show_id, city_id, shows(program, sub_program))")
    .eq("org_id", org.id)
    .eq("status", "suggested")
    .is("reminder_sent_at", null)
    .not("offer_expires_at", "is", null)
    .gt("offer_expires_at", now.toISOString())
    .lt("offer_expires_at", cutoff.toISOString());
  if (dueErr || !due?.length) continue;

  // Group per artist; resolve recipient exactly like send-offer-digest
  // (resolve_user_contacts RPC + resolveContactEmail + resolveAccountDisplayName).
  // For each artist group:
  //   - offers[] rows built with referenceLabel({ reference: flow.reference_field,
  //     show: row.show_dates?.shows ?? null, custom: row.show_dates?.custom ?? null,
  //     customFieldKey }) — resolve customFieldKey once per org exactly as in Task 9.
  //   - sendEmail({ template_name: "offer-expiry-reminder", recipient_email, org_id: org.id,
  //     templateData: { displayName, offers },
  //     idempotency_key: `offer-reminder-${org.id}-${artistId}-${now.toISOString().slice(0, 10)}` })
  //   - if emailWasSent: stamp the group's booking ids
  //     admin.from("bookings").update({ reminder_sent_at: now.toISOString() }).in("id", ids)
  //     and, when the artist has a user_id, insert an in-app notification row
  //     { org_id: org.id, user_id, type: "offer_expiring", title: "Offer expiring soon",
  //       message: `You have ${ids.length === 1 ? "an offer" : String(ids.length) + " offers"} expiring in the next 24 hours.`,
  //       related_entity_type: "booking", related_entity_id: ids[0] }
  //   - remindersSent += 1 per email actually sent
}
```

Write the grouping loop in full in the implementation (the digest's grouping code at `send-offer-digest/index.ts:96-142` is the model to copy). Add `reminders_sent: remindersSent` to the final response json (:139).

- [ ] **Step 4: Run the whole edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/transactional-email-templates/ supabase/functions/_shared/notificationCategories.ts supabase/functions/expire-offers/
git commit -m "add 24h offer expiry reminder pass to expire-offers"
```

---

### Task 12: Auto-escalation in expire-offers

**Files:**
- Modify: `supabase/functions/expire-offers/index.ts`
- Test: `supabase/functions/expire-offers/index.di.test.ts` (append)

**Interfaces:**
- Consumes: existing per-tier loop (:44-134), `resolveBookingFlow`, `deps.invokeFunction`.
- Produces: when a tier is short and `auto_escalate` is on: current tier row closed (`closed_at` + `escalation_notified_at` set), `open-offer-tier` invoked for the next priority, notification `type: "tier_escalated"`; the manual escalation email path runs only when auto-escalate is off or no next tier exists. Response gains `auto_escalated` count.

- [ ] **Step 1: Write the failing DI tests (append)**

```ts
Deno.test("expire-offers: auto_escalate closes the short tier and opens the next", async () => {
  // Seeds: one open tier row (tier 1) whose date is future, shows with
  //   main_cast_slots 2, bookings all expired/cancelled (accepted+pending < required),
  //   app_settings booking_flow { auto_escalate: true },
  //   cast_city_priority: { data: [{ priority: 2 }], error: null }.
  // Assert: invokeCalls contains { name: "open-offer-tier" } with body
  //   { show_date_id: "d1", tier: 2 }; a show_date_offer_tiers update whose
  //   args[0] includes closed_at; a notifications insert whose rows have
  //   type "tier_escalated"; NO cast-escalation-requested email invokeCall.
});

Deno.test("expire-offers: auto_escalate with no next tier falls back to the manual escalation path", async () => {
  // Same seeds with cast_city_priority: { data: [], error: null }.
  // Assert: behavior identical to the existing escalation notification test
  //   (cast_escalation_requested notification inserted, escalation_notified_at update).
});
```

Write both in full, cloning the file's existing escalation test seeds.

- [ ] **Step 2: Run to verify failures**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/expire-offers/`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

In the per-tier loop, after the short-fill condition is established and BEFORE the existing recipients/notification code (:86-134):

```ts
const flow = flowByOrg.get(sd.org_id) ?? (await resolveBookingFlow(admin, sd.org_id));
flowByOrg.set(sd.org_id, flow);
if (!flow.artist_acceptance) continue; // direct-mode orgs have no offer tiers to escalate

if (flow.auto_escalate && row.tier !== 99) {
  const { data: nextRows } = await admin
    .from("cast_city_priority")
    .select("priority")
    .eq("org_id", sd.org_id)
    .eq("city_id", sd.city_id)
    .gt("priority", row.tier)
    .order("priority", { ascending: true })
    .limit(1);
  const nextTier = (nextRows?.[0] as { priority: number } | undefined)?.priority;
  if (nextTier !== undefined) {
    await admin
      .from("show_date_offer_tiers")
      .update({ closed_at: now.toISOString(), escalation_notified_at: now.toISOString() })
      .eq("id", row.id);
    await deps.invokeFunction("open-offer-tier", { show_date_id: row.show_date_id, tier: nextTier });
    // notify the same recipients the manual path resolves (reuse its recipient list)
    // rows: { org_id: sd.org_id, user_id, type: "tier_escalated",
    //   title: "Tier escalated automatically",
    //   message: `Tier ${row.tier} closed short · tier ${nextTier} opened automatically.`,
    //   related_entity_type: "show_date_offer_tier", related_entity_id: row.id }
    autoEscalated += 1;
    continue; // skip the manual escalation email/notification for this row
  }
}
```

Declare `const flowByOrg = new Map<string, BookingFlow>();` and `let autoEscalated = 0;` before the loop; move the recipients resolution (`resolve_show_assignments` + admin fallback, :86-99) ABOVE this block so both paths share it. Add `auto_escalated: autoEscalated` to the response.

- [ ] **Step 4: Run the whole edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/expire-offers/
git commit -m "auto-escalate short tiers when the flow enables it"
```

---

### Task 13: tier-at-risk-watcher gate

**Files:**
- Modify: `supabase/functions/tier-at-risk-watcher/index.ts`
- Test: `supabase/functions/tier-at-risk-watcher/index.di.test.ts` (append)

**Interfaces:**
- Consumes: `resolveBookingFlow`.
- Produces: orgs with `at_risk_alerts === false` (or direct mode) produce no at-risk notifications; their stale-clear behavior is unchanged.

- [ ] **Step 1: Write the failing DI test (append)**

```ts
Deno.test("tier-at-risk-watcher: org with at_risk_alerts=false produces no notifications", async () => {
  // Clone the file's existing at-risk happy-path seed, add
  //   app_settings: { data: [{ org_id: "org-1", value: { at_risk_alerts: false } }], error: null }.
  // Assert: no notifications insert call; response at_risk_count === 0.
});
```

Write it in full from the file's existing happy-path test.

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/tier-at-risk-watcher/`
Expected: FAIL.

- [ ] **Step 3: Implement**

In the per-tier loop, immediately after the show-date row `sd` resolves (~:71), with a `flowByOrg` Map cache identical to Task 12's pattern:

```ts
const flow = flowByOrg.get(sd.org_id) ?? (await resolveBookingFlow(admin, sd.org_id));
flowByOrg.set(sd.org_id, flow);
if (!flow.at_risk_alerts || !flow.artist_acceptance) continue;
```

- [ ] **Step 4: Run the whole edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/tier-at-risk-watcher/
git commit -m "gate at-risk watcher on booking flow policy"
```

---

### Task 14: Auto-open tier 1 honors the flow (poll + in-app dates)

**Files:**
- Modify: `supabase/functions/airtable-poll/index.ts`
- Modify: `src/components/shows/ShowDateFormDialog.tsx`
- Test: `supabase/functions/airtable-poll/index.di.test.ts` (append)

**Interfaces:**
- Consumes: `resolveBookingFlow` (edge), `useBookingFlow` + `shouldAutoOpenTier1` + `fetchOpenedTiers` + `openOfferTier` (frontend, Task 7).
- Produces: the poll's `openOfferTierBatch` is gated by `auto_open_tier1 && artist_acceptance` and additionally covers UPDATED dates that have a session and no tier-1 row yet; in-app date create defaults its "open offers" checkbox from the flow; in-app date edit auto-opens tier 1 when `shouldAutoOpenTier1` says so.

- [ ] **Step 1: Write the failing DI tests (append to `airtable-poll/index.di.test.ts`)**

```ts
Deno.test("airtable-poll: auto_open_tier1=false → no open-offer-tier invocations", async () => {
  // Clone the file's existing new-date sync seed; add app_settings booking_flow
  //   { auto_open_tier1: false }.
  // Assert: invokeCalls has no { name: "open-offer-tier" } entries.
});

Deno.test("airtable-poll: updated date with session and no tier-1 row is auto-opened", async () => {
  // Clone the update-path seed (existing date id "d-upd" whose payload has session_1),
  //   app_settings booking_flow default (empty data), and
  //   show_date_offer_tiers: { data: [], error: null } for the tier-1 lookup.
  // Assert: invokeCalls contains { name: "open-offer-tier" } with body
  //   { show_date_id: "d-upd", tier: 1 }.
});
```

Write both in full from the file's existing sync tests.

- [ ] **Step 2: Run to verify failures**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `airtable-poll/index.ts` `syncOrg`:
1. Collect `updatedWithSession: string[]` in the update path (:372): push `existingId` when the upsert payload has `session_1 || session_2 || session_3`.
2. Replace the unconditional `const tiersOpened = await openOfferTierBatch(deps, newDateIds)` (:404) with:

```ts
let tiersOpened = 0;
const flow = await resolveBookingFlow(deps.admin, orgId);
if (flow.auto_open_tier1 && flow.artist_acceptance) {
  let candidates = [...newDateIds];
  if (updatedWithSession.length) {
    const { data: existingTierRows } = await deps.admin
      .from("show_date_offer_tiers")
      .select("show_date_id")
      .in("show_date_id", updatedWithSession)
      .eq("tier", 1);
    const already = new Set((existingTierRows ?? []).map((r: { show_date_id: string }) => r.show_date_id));
    candidates = candidates.concat(updatedWithSession.filter((id) => !already.has(id)));
  }
  tiersOpened = await openOfferTierBatch(deps, candidates);
}
```

(Use the exact org-id variable name in scope in `syncOrg`; `open-offer-tier` itself no-ops benignly for not-ready dates, so over-inclusion is safe.)

In `ShowDateFormDialog.tsx`:
1. `const { data: flow } = useBookingFlow();`
2. The "open offers" checkbox: default checked = `(flow?.auto_open_tier1 ?? true) && (flow?.artist_acceptance ?? true)`; hide the checkbox entirely when `flow && !flow.artist_acceptance`.
3. In the edit branch of `onSubmit` (:106-114), after `update.mutateAsync` succeeds:

```ts
if (flow && date) {
  const hasSession = Boolean(values.session1 || values.session2 || values.session3);
  const openedTiers = await fetchOpenedTiers(supabase, date.id);
  if (shouldAutoOpenTier1({ flow, hasSession, openedTiers })) {
    const res = await openOfferTier(supabase, { showDateId: date.id, tier: 1 });
    if (res.offersCreated > 0) toast.success(`Tier 1 opened automatically · ${res.offersCreated} offers sent`);
  }
}
```

(Adapt `values.*`/`date` to the dialog's actual form-state and prop names; read the file first.)

- [ ] **Step 4: Run everything touched**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/` → PASS.
Run: `npx vitest run` → PASS. `npx tsc -p tsconfig.app.json --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/airtable-poll/ src/components/shows/ShowDateFormDialog.tsx
git commit -m "gate tier-1 auto-open on flow and cover updated dates"
```

---

### Task 15: Settings plumbing (editable key, audit data access, EmailTemplatesCard extraction)

**Files:**
- Modify: `src/pages/SettingsPage.tsx` (EDITABLE_SETTING_KEYS :52-57; extract Email Templates card :176-235)
- Create: `src/components/settings/EmailTemplatesCard.tsx`
- Create: `src/data/settingsAudit.ts`
- Create: `src/hooks/useSettingsAudit.ts`
- Test: `src/data/settingsAudit.test.ts`, `src/lib/settings.test.ts` (append)

**Interfaces:**
- Consumes: Task 4's `settings_audit_log` table; `mergeOrgRows`/draft machinery in SettingsPage; `computeSettingsDirtyKeys` (`src/lib/settings.ts:42`).
- Produces:
  - `interface SettingsAuditEntry { id: string; key: string; actor: string | null; actorName: string | null; old_value: unknown; new_value: unknown; created_at: string }`
  - `fetchSettingsAudit(client, args: { orgId: string; keys: string[]; limit?: number }): Promise<SettingsAuditEntry[]>`
  - `useSettingsAudit(keys: string[]): UseQueryResult<SettingsAuditEntry[]>` — `queryKey: ["app-settings", "audit", orgId, ...keys]`.
  - `<EmailTemplatesCard get={get} set={set} />` — the existing card, verbatim behavior, importable by Task 17.
  - `'booking_flow'` added to `EDITABLE_SETTING_KEYS`.

- [ ] **Step 1: Write the failing tests**

`src/data/settingsAudit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchSettingsAudit } from "./settingsAudit";

describe("fetchSettingsAudit", () => {
  it("fetches entries for the org and keys, joining actor display names", async () => {
    const fake = createFakeSupabase({
      settings_audit_log: {
        data: [
          { id: "e1", key: "booking_flow", actor: "u1", old_value: null, new_value: {}, created_at: "2026-07-14T10:00:00Z" },
          { id: "e2", key: "offer_response_window_hours", actor: null, old_value: 72, new_value: 48, created_at: "2026-07-13T09:00:00Z" },
        ],
        error: null,
      },
      profiles: { data: [{ user_id: "u1", display_name: "Stefan S." }], error: null },
    });
    const entries = await fetchSettingsAudit(fake as never, { orgId: "org-1", keys: ["booking_flow", "offer_response_window_hours"] });
    expect(entries[0]).toMatchObject({ id: "e1", actorName: "Stefan S." });
    expect(entries[1]).toMatchObject({ id: "e2", actorName: null });
    expect(fake.calls).toContainEqual({ table: "settings_audit_log", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls.some((c) => c.table === "settings_audit_log" && c.method === "in")).toBe(true);
  });
});
```

Append to `src/lib/settings.test.ts` (guards the object-valued draft key):

```ts
import { computeSettingsDirtyKeys } from "./settings";

describe("computeSettingsDirtyKeys with object values", () => {
  it("detects a changed booking_flow object and ignores an identical one", () => {
    const saved = [{ key: "booking_flow", value: { artist_acceptance: true } }];
    const dirty = computeSettingsDirtyKeys(saved as never, { booking_flow: { artist_acceptance: false } } as never, ["booking_flow"]);
    expect(dirty).toContain("booking_flow");
    const clean = computeSettingsDirtyKeys(saved as never, { booking_flow: { artist_acceptance: true } } as never, ["booking_flow"]);
    expect(clean).not.toContain("booking_flow");
  });
});
```

If this test reveals `computeSettingsDirtyKeys` uses reference equality, fix it to deep-compare via `JSON.stringify` on both sides (that is a production fix in `src/lib/settings.ts`, not a test accommodation). Match the function's actual parameter shapes when writing the test (read `src/lib/settings.ts:42` first).

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/data/settingsAudit.test.ts src/lib/settings.test.ts`
Expected: FAIL (missing module / possibly the deep-compare case).

- [ ] **Step 3: Implement**

`src/data/settingsAudit.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface SettingsAuditEntry {
  id: string;
  key: string;
  actor: string | null;
  actorName: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

export async function fetchSettingsAudit(
  client: SupabaseClient<Database>,
  args: { orgId: string; keys: string[]; limit?: number },
): Promise<SettingsAuditEntry[]> {
  const { data, error } = await client
    .from("settings_audit_log")
    .select("id, key, actor, old_value, new_value, created_at")
    .eq("org_id", args.orgId)
    .in("key", args.keys)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 20);
  if (error) throw error;
  const rows = (data ?? []) as Omit<SettingsAuditEntry, "actorName">[];
  const actorIds = [...new Set(rows.map((r) => r.actor).filter(Boolean))] as string[];
  const names = new Map<string, string | null>();
  if (actorIds.length) {
    const { data: profiles } = await client
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", actorIds);
    for (const p of (profiles ?? []) as { user_id: string; display_name: string | null }[]) {
      names.set(p.user_id, p.display_name);
    }
  }
  return rows.map((r) => ({ ...r, actorName: r.actor ? (names.get(r.actor) ?? null) : null }));
}
```

(Note: `settings_audit_log` is not in the generated `Database` types until types are regenerated after the migration is applied. Cast the table name at the boundary with `client.from("settings_audit_log" as never)` and cast the result, isolating `any`/`never` to this file, per the repo's boundary-`any` convention.)

`src/hooks/useSettingsAudit.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { fetchSettingsAudit } from "@/data/settingsAudit";

export function useSettingsAudit(keys: string[]) {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id;
  return useQuery({
    queryKey: ["app-settings", "audit", orgId, ...keys],
    queryFn: () => fetchSettingsAudit(supabase, { orgId: orgId!, keys }),
    enabled: Boolean(orgId),
  });
}
```

`EmailTemplatesCard.tsx`: cut the Email Templates `<Card>` JSX (SettingsPage :176-235) into the new file unchanged, typed `({ get, set }: { get: (key: string) => unknown; set: (key: string, value: unknown) => void })` matching the props `BookingEngineTab` already receives; render `<EmailTemplatesCard get={get} set={set} />` in its old place so this task is behavior-neutral. Add `'booking_flow'` to `EDITABLE_SETTING_KEYS`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/data/settingsAudit.test.ts src/lib/settings.test.ts && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS/clean.

- [ ] **Step 5: Commit**

```bash
git add src/data/settingsAudit.ts src/hooks/useSettingsAudit.ts src/components/settings/EmailTemplatesCard.tsx src/pages/SettingsPage.tsx src/data/settingsAudit.test.ts src/lib/settings.test.ts src/lib/settings.ts
git commit -m "add settings audit data access and extract email templates card"
```

---

### Task 16: FlowPresets + FlowTimeline components

**Files:**
- Create: `src/components/settings/bookingFlow/FlowPresets.tsx`
- Create: `src/components/settings/bookingFlow/FlowTimeline.tsx`
- Test: `src/components/settings/bookingFlow/FlowTimeline.test.tsx`

**Interfaces:**
- Consumes: Task 1-2 (`BookingFlow`, `FlowTimes`, `applyPreset`, `matchPreset`, `BOOKING_FLOW_PRESETS`); shadcn `Card`, `Badge`, `Switch`, `Input`, `Select`, `Label`; `useCustomFieldDefs`-style fetch via `fetchCustomFieldDefs` (`src/data/customFields.ts:20`, entity `"show_dates"` — check the entity value used elsewhere and reuse it).
- Produces:
  - `<FlowPresets active={PresetName | "custom"} onSelect={(p: PresetName) => void} />`
  - `<FlowTimeline flow={BookingFlow} times={FlowTimes} onFlowChange={(patch: Partial<BookingFlow>) => void} onTimesChange={(patch: Partial<FlowTimes>) => void} customFields={{ id: string; label: string }[]} referencePreview={string} />`
- Both are pure/presentational: all state lives in Task 17's tab.

- [ ] **Step 1: Write the failing component test**

`src/components/settings/bookingFlow/FlowTimeline.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { applyPreset, BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import { FlowTimeline } from "./FlowTimeline";

const TIMES = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };
const noop = () => {};

describe("FlowTimeline", () => {
  it("renders all seven steps in classic mode with no skipped chips", () => {
    renderWithProviders(
      <FlowTimeline flow={BOOKING_FLOW_DEFAULTS} times={TIMES} onFlowChange={noop} onTimesChange={noop} customFields={[]} referencePreview="Offer: X · Apr 30" />,
    );
    expect(screen.getByText("Open offer tier")).toBeInTheDocument();
    expect(screen.getByText("Understudy promotion")).toBeInTheDocument();
    expect(screen.queryAllByText("Skipped")).toHaveLength(0);
  });

  it("direct mode dims offer steps, shows Skipped and Locked on chips", () => {
    renderWithProviders(
      <FlowTimeline flow={applyPreset(BOOKING_FLOW_DEFAULTS, "direct")} times={TIMES} onFlowChange={noop} onTimesChange={noop} customFields={[]} referencePreview="x" />,
    );
    expect(screen.getAllByText("Skipped").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Locked on")).toBeInTheDocument();
  });

  it("toggling artist acceptance calls onFlowChange", () => {
    const onFlowChange = vi.fn();
    renderWithProviders(
      <FlowTimeline flow={BOOKING_FLOW_DEFAULTS} times={TIMES} onFlowChange={onFlowChange} onTimesChange={noop} customFields={[]} referencePreview="x" />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /artist acceptance/i }));
    expect(onFlowChange).toHaveBeenCalledWith({ artist_acceptance: false });
  });

  it("renders no em- or en-dashes anywhere", () => {
    const { container } = renderWithProviders(
      <FlowTimeline flow={BOOKING_FLOW_DEFAULTS} times={TIMES} onFlowChange={noop} onTimesChange={noop} customFields={[]} referencePreview="x" />,
    );
    expect(container.textContent).not.toMatch(/[—–]/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/settings/bookingFlow/FlowTimeline.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`FlowPresets.tsx` (copy the mockup's four cards; dot colors via inline `hsl(var(--primary))`, `var(--green-500)`, `var(--amber-500)`, muted):

```tsx
import { BOOKING_FLOW_PRESETS, type PresetName } from "@/lib/bookingFlow";
import { cn } from "@/lib/utils";

const PRESET_META: Record<PresetName, { name: string; desc: string; dotClass: string }> = {
  classic: { name: "Classic", desc: "Offer → artist accepts → producer confirms. Today's flow.", dotClass: "bg-primary" },
  fasttrack: { name: "Fast-track", desc: "Auto-opened, immediate offers; acceptance confirms instantly.", dotClass: "bg-[var(--green-500)]" },
  direct: { name: "Direct book", desc: "No offers; producers book artists from eligibility lists.", dotClass: "bg-[var(--amber-500)]" },
};

export function FlowPresets({ active, onSelect }: { active: PresetName | "custom"; onSelect: (p: PresetName) => void }) {
  const presets = Object.keys(BOOKING_FLOW_PRESETS) as PresetName[];
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4" role="group" aria-label="Flow presets">
      {presets.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={active === p}
          onClick={() => onSelect(p)}
          className={cn(
            "rounded-lg border border-border bg-card p-3 text-left transition-colors",
            active === p ? "border-primary ring-1 ring-primary bg-accent" : "hover:border-input",
          )}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className={cn("h-2 w-2 rounded-full", PRESET_META[p].dotClass)} />
            {PRESET_META[p].name}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{PRESET_META[p].desc}</span>
        </button>
      ))}
      <div
        aria-pressed={active === "custom"}
        className={cn(
          "rounded-lg border border-border bg-card p-3",
          active === "custom" && "border-primary ring-1 ring-primary bg-accent",
        )}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="h-2 w-2 rounded-full bg-muted-foreground" />
          Custom
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">Your own combination of the steps below.</span>
      </div>
    </div>
  );
}
```

(Only three clickable presets plus a passive Custom indicator; grid stays 4-up.)

`FlowTimeline.tsx` — structure: a `TimelineStep` local component (number bubble + connector + card) and seven steps. Implement the full copy from the final mockup (all copy middot/period based, NO dashes):

```tsx
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { hh, type BookingFlow, type FlowTimes } from "@/lib/bookingFlow";

interface Props {
  flow: BookingFlow;
  times: FlowTimes;
  onFlowChange: (patch: Partial<BookingFlow>) => void;
  onTimesChange: (patch: Partial<FlowTimes>) => void;
  customFields: { id: string; label: string }[];
  referencePreview: string;
}

function TimelineStep({ n, title, desc, dim, chips, children, last }: {
  n: number; title: string; desc: string; dim?: boolean; chips?: ReactNode; children?: ReactNode; last?: boolean;
}) {
  return (
    <div className={cn("flex gap-3", dim && "opacity-45")}>
      <div className="flex w-7 flex-none flex-col items-center">
        <span className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
          n === 0 || dim ? "bg-muted text-muted-foreground" : "bg-accent text-accent-foreground",
        )}>{n}</span>
        {!last && <span className="w-0.5 flex-1 bg-input" />}
      </div>
      <div className="mb-2.5 flex-1 rounded-lg border border-border bg-card p-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex-1">
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
          </div>
          {chips}
        </div>
        {children && <div className="mt-3 flex flex-col gap-2.5 border-t border-border pt-3">{children}</div>}
      </div>
    </div>
  );
}

export function FlowTimeline({ flow, times, onFlowChange, onTimesChange, customFields, referencePreview }: Props) {
  const respOff = !flow.artist_acceptance;
  const skippedChip = <Badge variant="secondary" className="bg-muted text-muted-foreground">Skipped</Badge>;
  return (
    <div>
      <TimelineStep n={0} title="Date created" desc="Via Airtable sync or in-app; either way the date enters the flow here."
        chips={<Badge variant="secondary" className="bg-muted text-muted-foreground">Always on</Badge>} />

      <TimelineStep n={1} title="Open offer tier" desc="Creates suggested bookings for every eligible artist in the tier."
        dim={respOff}
        chips={<>
          <Badge variant="secondary" className="bg-accent text-accent-foreground">Suggested</Badge>
          {respOff && skippedChip}
        </>}>
        <label className="flex items-center gap-2.5 text-sm">
          <Switch checked={flow.auto_open_tier1} disabled={respOff} aria-label="Auto-open tier 1"
            onCheckedChange={(v) => onFlowChange({ auto_open_tier1: v })} />
          Open tier 1 automatically when a new date is ready
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <Switch checked={flow.auto_escalate} disabled={respOff} aria-label="Auto-escalate tiers"
            onCheckedChange={(v) => onFlowChange({ auto_escalate: v })} />
          Escalate to the next tier automatically when a window closes short
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <Switch checked={flow.at_risk_alerts} disabled={respOff} aria-label="At-risk alerts"
            onCheckedChange={(v) => onFlowChange({ at_risk_alerts: v })} />
          Alert producers when a date can no longer fill in time
        </label>
      </TimelineStep>

      <TimelineStep n={2} title="Notify artists" desc="How and when offers reach artists. The response window starts at delivery."
        dim={respOff} chips={respOff ? skippedChip : undefined}>
        <div className="flex flex-wrap items-center gap-4">
          <div className="inline-flex rounded-md bg-muted p-0.5" role="group" aria-label="Offer delivery">
            {(["digest", "immediate"] as const).map((mode) => (
              <button key={mode} type="button" aria-pressed={flow.offer_delivery === mode} disabled={respOff}
                onClick={() => onFlowChange({ offer_delivery: mode })}
                className={cn("rounded px-3 py-1.5 text-xs font-medium",
                  flow.offer_delivery === mode ? "bg-card shadow-sm" : "text-muted-foreground")}>
                {mode === "digest" ? `Daily digest · ${hh(times.offerDigestHour)}` : "Immediately"}
              </button>
            ))}
          </div>
          <label className={cn("flex items-center gap-2 text-xs text-muted-foreground", flow.offer_delivery !== "digest" && "opacity-40")}>
            Digest hour (Berlin)
            <Input type="number" min={0} max={23} value={times.offerDigestHour} disabled={respOff || flow.offer_delivery !== "digest"}
              className="w-16 font-mono" onChange={(e) => onTimesChange({ offerDigestHour: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Response window (h)
            <Input type="number" min={1} max={336} value={times.windowHours} disabled={respOff}
              className="w-16 font-mono" onChange={(e) => onTimesChange({ windowHours: Number(e.target.value) })} />
          </label>
        </div>
        <label className="flex items-center gap-2.5 text-sm">
          <Switch checked={flow.expiry_reminder} disabled={respOff} aria-label="Expiry reminder"
            onCheckedChange={(v) => onFlowChange({ expiry_reminder: v })} />
          Remind artists 24 h before their window closes
        </label>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs text-muted-foreground">Reference field</span>
          <Select value={flow.reference_field.source} disabled={respOff}
            onValueChange={(source) => onFlowChange({
              reference_field: source === "custom"
                ? { source: "custom", custom_field_id: customFields[0]?.id }
                : { source: source as "show" | "program" },
            })}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="show">Show label (default)</SelectItem>
              <SelectItem value="program">Program only</SelectItem>
              <SelectItem value="custom" disabled={customFields.length === 0}>Custom field…</SelectItem>
            </SelectContent>
          </Select>
          {flow.reference_field.source === "custom" && (
            <Select value={flow.reference_field.custom_field_id}
              onValueChange={(id) => onFlowChange({ reference_field: { source: "custom", custom_field_id: id } })}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {customFields.map((f) => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <span className="rounded-md border border-border bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground">{referencePreview}</span>
        </div>
      </TimelineStep>

      <TimelineStep n={3} title="Artist acceptance" desc="Artists accept or decline from their calendar. Off means producers book directly, with no offers at all."
        chips={<>
          <Badge variant="secondary" className={respOff || !flow.producer_confirmation ? "bg-[var(--green-100)] text-[var(--green-600)]" : "bg-[var(--amber-100)] text-[var(--amber-600)]"}>
            {respOff || !flow.producer_confirmation ? "Confirmed" : "Soft booked"}
          </Badge>
          <Switch checked={flow.artist_acceptance} aria-label="Artist acceptance"
            onCheckedChange={(v) => onFlowChange(v ? { artist_acceptance: true } : { artist_acceptance: false, producer_confirmation: true })} />
        </>}>
        {respOff && (
          <p className="rounded-md bg-[var(--amber-100)] px-2.5 py-1.5 text-xs text-[var(--amber-600)]">
            Offers, digests, and response windows are skipped. Producers book from eligibility lists; the artist's first touchpoint is the confirmation.
          </p>
        )}
      </TimelineStep>

      <TimelineStep n={4} title="Producer confirmation" desc="Producer reviews soft-booked artists and confirms the cast. Off means an acceptance confirms immediately."
        chips={<>
          <Badge variant="secondary" className="bg-[var(--green-100)] text-[var(--green-600)]">Confirmed</Badge>
          {respOff && <Badge variant="secondary" className="bg-muted text-muted-foreground">Locked on</Badge>}
          <Switch checked={flow.producer_confirmation} disabled={respOff} aria-label="Producer confirmation"
            onCheckedChange={(v) => onFlowChange({ producer_confirmation: v })} />
        </>}>
        {respOff && (
          <p className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
            With artist acceptance off, the producer's booking is itself the confirmation, so this step can't be skipped.
          </p>
        )}
      </TimelineStep>

      <TimelineStep n={5} title="Confirmation digest" desc="Daily summary email to newly confirmed artists."
        chips={<>
          <label className={cn("flex items-center gap-2 text-xs text-muted-foreground", !flow.confirmation_digest && "opacity-40")}>
            Hour (Berlin)
            <Input type="number" min={0} max={23} value={times.confirmationDigestHour} disabled={!flow.confirmation_digest}
              className="w-16 font-mono" onChange={(e) => onTimesChange({ confirmationDigestHour: Number(e.target.value) })} />
          </label>
          <Switch checked={flow.confirmation_digest} aria-label="Confirmation digest"
            onCheckedChange={(v) => onFlowChange({ confirmation_digest: v })} />
        </>} />

      <TimelineStep n={6} last title="Understudy promotion" desc="When a main-cast booking cancels, the longest-waiting accepted understudy is promoted automatically."
        chips={<Switch checked={flow.understudy_promotion} aria-label="Understudy promotion"
          onCheckedChange={(v) => onFlowChange({ understudy_promotion: v })} />} />
    </div>
  );
}
```

Verify `--green-100`/`--green-600`/`--amber-100`/`--amber-600` are the raw CSS vars defined in `src/index.css:100-108` (they are); arbitrary-value classes like `bg-[var(--green-100)]` are the established pattern for those raw tokens (grep for an existing usage and copy it; if the codebase instead maps them through `bookingStatusBadgeClass`-style helpers, reuse that helper).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/settings/bookingFlow/FlowTimeline.test.tsx && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS/clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/bookingFlow/
git commit -m "add flow presets and timeline editor components"
```

---

### Task 17: FlowRail + BookingFlowTab + SettingsPage wiring

**Files:**
- Create: `src/components/settings/bookingFlow/FlowRail.tsx`
- Create: `src/components/settings/bookingFlow/BookingFlowTab.tsx`
- Modify: `src/pages/SettingsPage.tsx` (tab :409 + content :500-502; delete the old `BookingEngineTab` numeric card, keep EmailTemplatesCard)
- Test: `src/components/settings/bookingFlow/BookingFlowTab.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, 15, 16; `useSettingsAudit`; `describeAuditEntry`; `fetchCustomFieldDefs`; SettingsPage's existing `get`/`set` draft accessors, `dirtyKeys`, save mutation, and discard mechanism (read :266-330 to get the exact prop shapes).
- Produces:
  - `<FlowRail flow={BookingFlow} times={FlowTimes} dirtyCount={number} saving={boolean} onSave={() => void} onDiscard={() => void} audit={SettingsAuditEntry[]} />`
  - `<BookingFlowTab get set dirtyKeys onSave onDiscard saving />` rendered by SettingsPage under `<TabsContent value="booking">`; TabsTrigger gate becomes `isAdmin` with label `Booking flow`.

- [ ] **Step 1: Write the failing test**

`BookingFlowTab.test.tsx` — render the tab with a stateful harness and assert preset → draft propagation:

```tsx
import { describe, expect, it } from "vitest";
import { useState } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import { BookingFlowTab } from "./BookingFlowTab";

function Harness() {
  const [draft, setDraft] = useState<Record<string, unknown>>({
    booking_flow: BOOKING_FLOW_DEFAULTS,
    offer_response_window_hours: 48,
    offer_digest_hour_berlin: 19,
    confirmation_digest_hour_berlin: 20,
  });
  return (
    <BookingFlowTab
      get={(k) => draft[k]}
      set={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
      dirtyKeys={[]}
      saving={false}
      onSave={() => {}}
      onDiscard={() => {}}
    />
  );
}

describe("BookingFlowTab", () => {
  it("selecting the Direct book preset flips the timeline into direct mode", () => {
    renderWithProviders(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /direct book/i }));
    expect(screen.getAllByText("Skipped").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Locked on")).toBeInTheDocument();
  });
  it("shows the resulting lifecycle chips", () => {
    renderWithProviders(<Harness />);
    expect(screen.getByText("Suggested")).toBeInTheDocument();
    expect(screen.getByText("Soft booked")).toBeInTheDocument();
  });
});
```

The tab internally calls `useSettingsAudit` and `fetchCustomFieldDefs` through hooks that hit the supabase singleton; guard both behind `enabled: Boolean(orgId)` (no org in the test harness → queries stay idle and render empty states). `useAuth` must tolerate a null org in tests — check how existing component tests involving `useAuth` provide context (search for an existing test rendering a component that uses `useAuth`, and copy its provider setup into `renderWithProviders` usage here; if none exists, wrap the harness in the same `AuthContext.Provider` pattern the app uses with a stub value).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/settings/bookingFlow/BookingFlowTab.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`FlowRail.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  describeAuditEntry, flowPreviewRows, inPracticeRows, lifecycleChips,
  type BookingFlow, type FlowTimes,
} from "@/lib/bookingFlow";
import type { SettingsAuditEntry } from "@/data/settingsAudit";
import { formatDateDMY } from "@/lib/dates";

const TONE_CLASS: Record<string, string> = {
  violet: "bg-accent text-accent-foreground",
  amber: "bg-[var(--amber-100)] text-[var(--amber-600)]",
  green: "bg-[var(--green-100)] text-[var(--green-600)]",
  neutral: "bg-muted text-muted-foreground",
};

function RailCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        {children}
      </CardContent>
    </Card>
  );
}

export function FlowRail(props: {
  flow: BookingFlow; times: FlowTimes; dirtyCount: number; saving: boolean;
  onSave: () => void; onDiscard: () => void; audit: SettingsAuditEntry[];
}) {
  const { flow, times, dirtyCount, saving, onSave, onDiscard, audit } = props;
  return (
    <div className="flex flex-col gap-3 lg:sticky lg:top-4">
      {dirtyCount > 0 && (
        <div className="rounded-lg bg-[var(--amber-100)] px-3 py-2 text-xs font-medium text-[var(--amber-600)]">
          Previewing unsaved draft · {dirtyCount} {dirtyCount === 1 ? "change" : "changes"}
        </div>
      )}
      <RailCard label="Resulting lifecycle">
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {lifecycleChips(flow).map((c, i) => (
            <span key={c.label} className="inline-flex items-center gap-1.5">
              {i > 0 && <span className="font-mono text-xs text-muted-foreground">→</span>}
              <Badge variant="secondary" className={TONE_CLASS[c.tone]}>{c.label}</Badge>
            </span>
          ))}
        </div>
      </RailCard>
      <RailCard label="In practice">
        <div className="mt-2.5 space-y-2">
          {inPracticeRows(flow, times).map((r) => (
            <div key={r.who} className="flex gap-2.5 text-xs">
              <span className="w-20 flex-none rounded bg-muted px-1 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{r.who}</span>
              <span>{r.text}</span>
            </div>
          ))}
        </div>
      </RailCard>
      <RailCard label="Flow preview">
        <div className="mt-2.5 space-y-1.5">
          {flowPreviewRows(flow, times).map((r, i) => (
            <div key={i} className="flex gap-2.5 text-xs">
              <span className="w-14 flex-none text-right font-mono text-[10px] text-muted-foreground">{r.at}</span>
              <span>{r.text}</span>
            </div>
          ))}
        </div>
      </RailCard>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={dirtyCount === 0 || saving} onClick={onSave}>
          {dirtyCount > 0 ? `Save (${dirtyCount})` : "Saved"}
        </Button>
        {dirtyCount > 0 && <Button variant="ghost" onClick={onDiscard}>Discard</Button>}
      </div>
      <RailCard label="Change history">
        <div className="mt-1">
          {audit.length === 0 && <p className="mt-1.5 text-xs text-muted-foreground">No changes recorded yet.</p>}
          {audit.map((e) => (
            <div key={e.id} className="border-t border-border pt-2 mt-2 first:border-t-0 first:mt-1.5">
              <p className="font-mono text-[10px] text-muted-foreground">
                {formatDateDMY(e.created_at.slice(0, 10))} · {e.actorName ?? "System"}
              </p>
              <p className="mt-0.5 text-xs">{describeAuditEntry(e)}</p>
            </div>
          ))}
        </div>
      </RailCard>
    </div>
  );
}
```

`BookingFlowTab.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import {
  applyPreset, matchPreset, normalizeBookingFlow,
  type BookingFlow, type FlowTimes, type PresetName, referenceLabel,
} from "@/lib/bookingFlow";
import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";
import { fetchCustomFieldDefs } from "@/data/customFields";
import { useSettingsAudit } from "@/hooks/useSettingsAudit";
import { EmailTemplatesCard } from "@/components/settings/EmailTemplatesCard";
import { FlowPresets } from "./FlowPresets";
import { FlowTimeline } from "./FlowTimeline";
import { FlowRail } from "./FlowRail";

const AUDIT_KEYS = [
  "booking_flow", "offer_response_window_hours", "offer_digest_hour_berlin",
  "confirmation_digest_hour_berlin", "resend_from_address", "email_template_overrides",
];

interface Props {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  dirtyKeys: string[];
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

export function BookingFlowTab({ get, set, dirtyKeys, saving, onSave, onDiscard }: Props) {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const flow = normalizeBookingFlow(get("booking_flow"));
  const times: FlowTimes = {
    windowHours: Number(get("offer_response_window_hours") ?? BOOKING_ENGINE_DEFAULTS.offer_response_window_hours),
    offerDigestHour: Number(get("offer_digest_hour_berlin") ?? BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin),
    confirmationDigestHour: Number(get("confirmation_digest_hour_berlin") ?? BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin),
  };
  const { data: customFieldDefs } = useQuery({
    queryKey: ["custom-fields", "show_dates", orgId],
    queryFn: () => fetchCustomFieldDefs(supabase, { orgId, entity: "show_dates" }),
    enabled: Boolean(orgId),
  });
  const audit = useSettingsAudit(AUDIT_KEYS);
  const customFields = (customFieldDefs ?? []).map((d) => ({ id: d.id, label: d.label }));
  const customFieldKey =
    flow.reference_field.source === "custom"
      ? (customFieldDefs ?? []).find((d) => d.id === flow.reference_field.custom_field_id)?.key ?? null
      : null;
  const referencePreview = `Offer: ${referenceLabel({
    reference: flow.reference_field,
    show: { program: "Candlelight", sub_program: "Strings" },
    custom: { [customFieldKey ?? ""]: "FV-2033" },
    customFieldKey,
  })} · Apr 30, Berlin`;

  const onFlowChange = (patch: Partial<BookingFlow>) => set("booking_flow", normalizeBookingFlow({ ...flow, ...patch }));
  const onTimesChange = (patch: Partial<FlowTimes>) => {
    if (patch.windowHours !== undefined) set("offer_response_window_hours", patch.windowHours);
    if (patch.offerDigestHour !== undefined) set("offer_digest_hour_berlin", patch.offerDigestHour);
    if (patch.confirmationDigestHour !== undefined) set("confirmation_digest_hour_berlin", patch.confirmationDigestHour);
  };
  const onPreset = (p: PresetName) => set("booking_flow", applyPreset(flow, p));

  return (
    <div className="space-y-4">
      <FlowPresets active={matchPreset(flow)} onSelect={onPreset} />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <FlowTimeline
          flow={flow} times={times}
          onFlowChange={onFlowChange} onTimesChange={onTimesChange}
          customFields={customFields} referencePreview={referencePreview}
        />
        <FlowRail
          flow={flow} times={times} dirtyCount={dirtyKeys.length} saving={saving}
          onSave={onSave} onDiscard={onDiscard} audit={audit.data ?? []}
        />
      </div>
      <EmailTemplatesCard get={get} set={set} />
    </div>
  );
}
```

SettingsPage wiring:
1. TabsTrigger (:409): gate `isAdmin` only, label `Booking flow`.
2. `<TabsContent value="booking">` renders `<BookingFlowTab get={get} set={set} dirtyKeys={bookingDirtyKeys} saving={saveMutation.isPending} onSave={() => saveMutation.mutate(...)} onDiscard={...} />` where `bookingDirtyKeys = dirtyKeys.filter((k) => AUDIT_KEYS.includes(k))` — read the page's actual save/dirty variable names (:266-330) and pass exactly those; the page may need a small `discardDraft()` helper (reset draft to saved settings) if one doesn't exist.
3. Delete the old `BookingEngineTab` numeric "Booking Engine" card (:123-174); its four fields now live in the timeline (window/hours) and, for `resend_from_address`, add a small labeled `Input` above `EmailTemplatesCard` inside `BookingFlowTab` bound to `get/set("resend_from_address")`.

- [ ] **Step 4: Run tests + typecheck + full frontend suite**

Run: `npx vitest run && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS/clean (existing SettingsPage tests may reference the removed card; update them to the new structure if they fail on removed text).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/bookingFlow/ src/pages/SettingsPage.tsx
git commit -m "replace booking engine tab with flow editor and rail"
```

---

### Task 18: Cockpit pure helpers (`bookingCockpit.ts`)

**Files:**
- Create: `src/lib/bookingCockpit.ts`
- Test: `src/lib/bookingCockpit.test.ts`

**Interfaces:**
- Consumes: `BookingFlow`, `FlowTimes`, `hh` from `@/lib/bookingFlow`; `SlotCounts` from `@/lib/settings` (`{ main_cast: number; understudies: number }`).
- Produces (consumed by Tasks 19-21):
  - `interface FunnelCounts { offered: number; accepted: number; confirmedMain: number; confirmedUnderstudy: number }`
  - `computeFunnel(bookings: Array<{ status: string; is_understudy: boolean }>): FunnelCounts` — offered = non-cancelled; accepted = soft_booked + confirmed; confirmed split by understudy flag.
  - `interface UpNextItem { tone: "violet" | "amber" | "neutral"; text: string }`
  - `computeUpNext(args: { flow: BookingFlow; times: FlowTimes; pendingCount: number; nextExpiry: string | null; hasOpenTier: boolean }): UpNextItem[]` — digest pill (`Digest sends daily · 19:00` when pending>0 and delivery digest), expiry pill (`N offers expire <date>` when nextExpiry), escalate pill (`Auto-escalate: on/off` when hasOpenTier), direct mode → single neutral pill `Direct booking: producers book from the eligibility list`.
  - `tierFillCounts(bookings: Array<{ status: string; offer_tier: number | null }>, tier: number): { pending: number; accepted: number }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { BOOKING_FLOW_DEFAULTS, applyPreset } from "./bookingFlow";
import { computeFunnel, computeUpNext, tierFillCounts } from "./bookingCockpit";

const TIMES = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };

describe("computeFunnel", () => {
  it("counts offered, accepted, and confirmed by group", () => {
    const funnel = computeFunnel([
      { status: "suggested", is_understudy: false },
      { status: "soft_booked", is_understudy: false },
      { status: "confirmed", is_understudy: false },
      { status: "confirmed", is_understudy: true },
      { status: "cancelled", is_understudy: false },
    ]);
    expect(funnel).toEqual({ offered: 4, accepted: 3, confirmedMain: 1, confirmedUnderstudy: 1 });
  });
});

describe("computeUpNext", () => {
  it("classic with pending offers shows digest and expiry pills", () => {
    const items = computeUpNext({
      flow: BOOKING_FLOW_DEFAULTS, times: TIMES, pendingCount: 3,
      nextExpiry: "2026-07-15T19:00:00Z", hasOpenTier: true,
    });
    const texts = items.map((i) => i.text).join("\n");
    expect(texts).toContain("19:00");
    expect(texts).toContain("3 offers expire");
    expect(texts).toContain("Auto-escalate: off");
  });
  it("direct mode shows the single direct-booking pill", () => {
    const items = computeUpNext({
      flow: applyPreset(BOOKING_FLOW_DEFAULTS, "direct"), times: TIMES,
      pendingCount: 0, nextExpiry: null, hasOpenTier: false,
    });
    expect(items).toHaveLength(1);
    expect(items[0].text).toContain("eligibility list");
  });
  it("emits no em- or en-dashes", () => {
    for (const i of computeUpNext({ flow: BOOKING_FLOW_DEFAULTS, times: TIMES, pendingCount: 1, nextExpiry: null, hasOpenTier: true })) {
      expect(i.text).not.toMatch(/[—–]/);
    }
  });
});

describe("tierFillCounts", () => {
  it("counts pending and accepted for one tier", () => {
    const counts = tierFillCounts([
      { status: "suggested", offer_tier: 1 },
      { status: "soft_booked", offer_tier: 1 },
      { status: "confirmed", offer_tier: 2 },
      { status: "cancelled", offer_tier: 1 },
    ], 1);
    expect(counts).toEqual({ pending: 1, accepted: 1 });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/bookingCockpit.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/lib/bookingCockpit.ts`**

```ts
import { hh, type BookingFlow, type FlowTimes } from "./bookingFlow";
import { formatDateWithWeekday } from "./dates";

export interface FunnelCounts {
  offered: number;
  accepted: number;
  confirmedMain: number;
  confirmedUnderstudy: number;
}

export function computeFunnel(
  bookings: Array<{ status: string; is_understudy: boolean }>,
): FunnelCounts {
  const active = bookings.filter((b) => b.status !== "cancelled");
  return {
    offered: active.length,
    accepted: active.filter((b) => b.status === "soft_booked" || b.status === "confirmed").length,
    confirmedMain: active.filter((b) => b.status === "confirmed" && !b.is_understudy).length,
    confirmedUnderstudy: active.filter((b) => b.status === "confirmed" && b.is_understudy).length,
  };
}

export interface UpNextItem {
  tone: "violet" | "amber" | "neutral";
  text: string;
}

export function computeUpNext(args: {
  flow: BookingFlow;
  times: FlowTimes;
  pendingCount: number;
  nextExpiry: string | null;
  hasOpenTier: boolean;
}): UpNextItem[] {
  const { flow, times, pendingCount, nextExpiry, hasOpenTier } = args;
  if (!flow.artist_acceptance) {
    return [{ tone: "neutral", text: "Direct booking: producers book from the eligibility list" }];
  }
  const items: UpNextItem[] = [];
  if (pendingCount > 0 && flow.offer_delivery === "digest") {
    items.push({ tone: "violet", text: `Digest sends daily · ${hh(times.offerDigestHour)}` });
  }
  if (pendingCount > 0 && nextExpiry) {
    items.push({
      tone: "amber",
      text: `${pendingCount} ${pendingCount === 1 ? "offer expires" : "offers expire"} ${formatDateWithWeekday(nextExpiry.slice(0, 10))}`,
    });
  }
  if (hasOpenTier) {
    items.push({ tone: "neutral", text: `Auto-escalate: ${flow.auto_escalate ? "on" : "off"}` });
  }
  return items;
}

export function tierFillCounts(
  bookings: Array<{ status: string; offer_tier: number | null }>,
  tier: number,
): { pending: number; accepted: number } {
  const inTier = bookings.filter((b) => b.offer_tier === tier);
  return {
    pending: inTier.filter((b) => b.status === "suggested").length,
    accepted: inTier.filter((b) => b.status === "soft_booked" || b.status === "confirmed").length,
  };
}
```

(Confirm `formatDateWithWeekday`'s signature in `src/lib/dates.ts` and pass what it expects.)

- [ ] **Step 4: Run** — `npx vitest run src/lib/bookingCockpit.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookingCockpit.ts src/lib/bookingCockpit.test.ts
git commit -m "add cockpit funnel and up-next pure helpers"
```

---

### Task 19: Cockpit components: BookingFunnel, UpNextStrip, TierTimeline, DryRunDialog

**Files:**
- Create: `src/components/shows/date/BookingFunnel.tsx`, `UpNextStrip.tsx`, `TierTimeline.tsx`, `DryRunDialog.tsx`
- Modify: `src/data/bookings.ts` (add `dryRunOfferTier`)
- Test: `src/data/bookings.test.ts` (append), `src/components/shows/date/BookingFunnel.test.tsx`

**Interfaces:**
- Consumes: Task 18 helpers; `fetchOfferTiers`/`fetchOpenedTiers`/`openOfferTier`/`closeOfferTier` (`src/data/bookings.ts`); `buildOfferTierOptions` (`src/lib/bookings.ts:86`); Task 8's dry-run HTTP contract; shadcn `Dialog`, `Progress` or plain divs for bars.
- Produces:
  - `dryRunOfferTier(client, args: { showDateId: string; tier: number }): Promise<{ candidates: { id: string; name: string }[]; excluded: { alreadyBooked: number; blocked: number; inactive: number }; message?: string }>`
  - `<BookingFunnel bookings={...} slots={SlotCounts | null} />`
  - `<UpNextStrip items={UpNextItem[]} />`
  - `<TierTimeline showDateId cityId flow bookings canManage onOpenTier(tier) onCloseTier(tier) onPreviewTier(tier) />` — lists opened tiers (fill counts via `tierFillCounts`) + available tiers with Open/Preview buttons; Close per open tier.
  - `<DryRunDialog open onOpenChange tier result loading onConfirm />` — renders candidates as chips, excluded counts line, primary button `Open tier N · send M offers`.

- [ ] **Step 1: Write the failing tests**

Append to `src/data/bookings.test.ts`:

```ts
describe("dryRunOfferTier", () => {
  it("invokes open-offer-tier with dry_run and maps the response", async () => {
    const fake = createFakeSupabase({
      "fn:open-offer-tier": {
        data: { dry_run: true, candidates: [{ id: "a1", name: "Lena" }], excluded: { already_booked: 1, blocked: 2, inactive: 0 } },
        error: null,
      },
    });
    const res = await dryRunOfferTier(fake as never, { showDateId: "d1", tier: 2 });
    expect(res.candidates).toEqual([{ id: "a1", name: "Lena" }]);
    expect(res.excluded).toEqual({ alreadyBooked: 1, blocked: 2, inactive: 0 });
    expect(fake.calls).toContainEqual({
      table: "fn:open-offer-tier", method: "invoke",
      args: [{ show_date_id: "d1", tier: 2, dry_run: true }],
    });
  });
});
```

`BookingFunnel.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { BookingFunnel } from "./BookingFunnel";

describe("BookingFunnel", () => {
  it("renders offered, accepted, and confirmed rows against slots", () => {
    renderWithProviders(
      <BookingFunnel
        bookings={[
          { status: "suggested", is_understudy: false },
          { status: "soft_booked", is_understudy: false },
          { status: "confirmed", is_understudy: false },
        ]}
        slots={{ main_cast: 4, understudies: 1 }}
      />,
    );
    expect(screen.getByText("Offered")).toBeInTheDocument();
    expect(screen.getByText(/3 sent/)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 5 slots/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failures** — `npx vitest run src/data/bookings.test.ts src/components/shows/date/BookingFunnel.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

`src/data/bookings.ts` add:

```ts
export interface DryRunResult {
  candidates: { id: string; name: string }[];
  excluded: { alreadyBooked: number; blocked: number; inactive: number };
  message?: string;
}

export async function dryRunOfferTier(
  client: SupabaseClient<Database>,
  args: { showDateId: string; tier: number },
): Promise<DryRunResult> {
  const { data, error } = await client.functions.invoke("open-offer-tier", {
    body: { show_date_id: args.showDateId, tier: args.tier, dry_run: true },
  });
  if (error) throw error;
  return {
    candidates: data?.candidates ?? [],
    excluded: {
      alreadyBooked: data?.excluded?.already_booked ?? 0,
      blocked: data?.excluded?.blocked ?? 0,
      inactive: data?.excluded?.inactive ?? 0,
    },
    message: data?.message,
  };
}
```

`BookingFunnel.tsx`:

```tsx
import { computeFunnel } from "@/lib/bookingCockpit";
import type { SlotCounts } from "@/lib/settings";

function Bar({ label, value, max, fillClass, right }: {
  label: string; value: number; max: number; fillClass: string; right: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="grid grid-cols-[80px_1fr_90px] items-center gap-3">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <span className="relative h-2.5 overflow-hidden rounded-full bg-muted">
        <span className={`absolute inset-y-0 left-0 rounded-full ${fillClass}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-right text-xs tabular-nums text-muted-foreground">{right}</span>
    </div>
  );
}

export function BookingFunnel({ bookings, slots }: {
  bookings: Array<{ status: string; is_understudy: boolean }>;
  slots: SlotCounts | null;
}) {
  const f = computeFunnel(bookings);
  const totalSlots = slots ? slots.main_cast + slots.understudies : 0;
  const confirmed = f.confirmedMain + f.confirmedUnderstudy;
  const max = Math.max(f.offered, totalSlots, 1);
  return (
    <div className="space-y-2" aria-label="Booking funnel">
      <Bar label="Offered" value={f.offered} max={max} fillClass="bg-accent-200" right={`${f.offered} sent`} />
      <Bar label="Accepted" value={f.accepted} max={max} fillClass="bg-accent-400" right={`${f.accepted} of ${f.offered}`} />
      <Bar label="Confirmed" value={confirmed} max={max} fillClass="bg-[var(--green-500)]"
        right={slots ? `${confirmed} / ${totalSlots} slots` : `${confirmed}`} />
    </div>
  );
}
```

`UpNextStrip.tsx`:

```tsx
import type { UpNextItem } from "@/lib/bookingCockpit";

const DOT: Record<UpNextItem["tone"], string> = {
  violet: "bg-primary",
  amber: "bg-[var(--amber-500)]",
  neutral: "bg-muted-foreground",
};

export function UpNextStrip({ items }: { items: UpNextItem[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Up next</span>
      {items.map((i) => (
        <span key={i.text} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${DOT[i.tone]}`} />
          {i.text}
        </span>
      ))}
    </div>
  );
}
```

`TierTimeline.tsx` and `DryRunDialog.tsx`: port the current Offers card behavior (ShowDateDetailSheet :531-670) into `TierTimeline` (opened tiers list with per-tier `tierFillCounts` + Close link + the existing close-confirmation AlertDialog and `buildOfferTierOptions` select + Open button with its existing `offerConfirmCopy` AlertDialog) and add a ghost `Preview who gets offers` button per selectable tier that calls `onPreviewTier(tier)`. `DryRunDialog` is a shadcn `Dialog` rendering: title `Opening tier {tier} would send {candidates.length} offers`, the digest/immediate sentence from the flow (`flow.offer_delivery === "digest" ? "Offers go out with the next daily digest." : "Offer emails send immediately."`), excluded line `Excluded: {alreadyBooked} already booked · {blocked} blocked · {inactive} inactive`, candidate name chips, and footer buttons `Open tier {tier} · send {n} offers` (primary, `onConfirm`) / `Cancel`. Keep all mutation wiring in the parent (Task 21); these components receive callbacks.

- [ ] **Step 4: Run** — `npx vitest run src/data/bookings.test.ts src/components/shows/date/ && npx tsc -p tsconfig.app.json --noEmit` → PASS/clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/shows/date/ src/data/bookings.ts src/data/bookings.test.ts
git commit -m "add cockpit funnel, up-next, tier timeline, and dry-run dialog"
```

---

### Task 20: EligibilityBookList + BookingRow confirm gate

**Files:**
- Create: `src/components/shows/date/EligibilityBookList.tsx`
- Modify: `src/components/shows/BookingRow.tsx`
- Test: `src/components/shows/BookingRow.test.tsx` (create), `src/components/shows/date/EligibilityBookList.test.tsx`

**Interfaces:**
- Consumes: `useEligibleArtists` (`src/hooks/useEligibleArtists.ts`) result shape (read the hook first: it returns eligible artists for a show date); `createBooking` (Task 7).
- Produces:
  - `BookingRow` gains prop `showConfirm: boolean`; Confirm renders only when `showConfirm && b.status === "soft_booked"`.
  - `<EligibilityBookList showDateId artists={{ id, name }[]} bookedArtistIds={Set<string>} onBook={(artistId: string, isUnderstudy: boolean) => void} booking={boolean} />` — rows with a Book button + an "as understudy" checkbox; already-booked artists show a neutral `Booked` badge instead of the button.

- [ ] **Step 1: Write the failing tests**

`BookingRow.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { aBooking } from "@/test/fixtures";
import { BookingRow } from "./BookingRow";

const artistBooking = { ...aBooking({ status: "soft_booked" }), artist: { id: "a1", name: "Lena" } };

describe("BookingRow confirm gate", () => {
  it("shows Confirm for soft_booked when showConfirm is true", () => {
    renderWithProviders(
      <BookingRow booking={artistBooking as never} canManage showConfirm onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });
  it("hides Confirm when showConfirm is false (auto-confirm flow)", () => {
    renderWithProviders(
      <BookingRow booking={artistBooking as never} canManage showConfirm={false} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });
});
```

`EligibilityBookList.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { EligibilityBookList } from "./EligibilityBookList";

describe("EligibilityBookList", () => {
  it("books an artist directly and marks already-booked rows", () => {
    const onBook = vi.fn();
    renderWithProviders(
      <EligibilityBookList
        artists={[{ id: "a1", name: "Lena" }, { id: "a2", name: "Marco" }]}
        bookedArtistIds={new Set(["a2"])}
        onBook={onBook}
        booking={false}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^Book$/ })[0]);
    expect(onBook).toHaveBeenCalledWith("a1", false);
    expect(screen.getByText("Booked")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failures** — `npx vitest run src/components/shows/` → FAIL on the new files.

- [ ] **Step 3: Implement**

`BookingRow.tsx`: add `showConfirm: boolean` to `BookingRowProps`; change the confirm condition (:32) from `b.status === 'soft_booked'` to `showConfirm && b.status === 'soft_booked'`. Update the existing call sites in `ShowDateDetailSheet.tsx` to pass `showConfirm` (temporarily `showConfirm={true}` until Task 21 wires the flow).

`EligibilityBookList.tsx`:

```tsx
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function EligibilityBookList({ artists, bookedArtistIds, onBook, booking }: {
  artists: { id: string; name: string }[];
  bookedArtistIds: Set<string>;
  onBook: (artistId: string, isUnderstudy: boolean) => void;
  booking: boolean;
}) {
  const [understudy, setUnderstudy] = useState(false);
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={understudy} onCheckedChange={(v) => setUnderstudy(v === true)} />
        Book as understudy
      </label>
      {artists.length === 0 && (
        <p className="text-sm text-muted-foreground">No eligible artists for this date. Check casts and city in Settings.</p>
      )}
      {artists.map((a) => (
        <div key={a.id} className="flex items-center justify-between rounded-lg border border-border p-3">
          <p className="text-sm font-medium">{a.name}</p>
          {bookedArtistIds.has(a.id) ? (
            <Badge variant="secondary" className="bg-muted text-muted-foreground">Booked</Badge>
          ) : (
            <Button size="sm" variant="outline" disabled={booking} onClick={() => onBook(a.id, understudy)}>
              Book
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run** — `npx vitest run src/components/shows/ && npx tsc -p tsconfig.app.json --noEmit` → PASS/clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/shows/BookingRow.tsx src/components/shows/BookingRow.test.tsx src/components/shows/date/EligibilityBookList.tsx src/components/shows/date/EligibilityBookList.test.tsx src/components/shows/ShowDateDetailSheet.tsx
git commit -m "add eligibility book list and gate confirm button"
```

---

### Task 21: Recompose ShowDateDetailSheet + dashboard gate

**Files:**
- Modify: `src/components/shows/ShowDateDetailSheet.tsx`
- Modify: `src/pages/DashboardPage.tsx`

**Interfaces:**
- Consumes: everything from Tasks 7, 18, 19, 20; the sheet's existing queries/mutations map (queries :55-127, mutations :182-286, sections :290-730).
- Produces: the sheet renders, top to bottom: sticky header (unchanged) → date info (unchanged) → `BookingFunnel` + `UpNextStrip` (replacing the old slots summary :357-378) → Date configuration card (unchanged) → date actions (unchanged) → `TierTimeline` + `DryRunDialog` (replacing the Offers card :531-670) OR `EligibilityBookList` in direct mode → Assigned Artists via `BookingRow showConfirm={flow.producer_confirmation}` → ChatPanel (unchanged). DashboardPage hides Ready-to-Confirm when `producer_confirmation` is false.

- [ ] **Step 1: Wire the flow and new components into the sheet**

In `ShowDateDetailSheet.tsx`:
1. `const { data: flowData } = useBookingFlow(); const flow = flowData ?? BOOKING_FLOW_DEFAULTS;` and `const times: FlowTimes = ...` from the resolved settings the sheet can read via `fetchBookingFlow`-adjacent legacy keys; simplest: also `useQuery(["app-settings","all", orgId])` is already the page-level pattern — instead reuse `BOOKING_ENGINE_DEFAULTS` fallbacks with `resolveOrgSetting` calls through a tiny `useQuery` if the sheet doesn't already load them. Keep it minimal: `UpNextStrip` needs only `offerDigestHour`; load it with `useQuery({ queryKey: ["app-settings", "booking-times", orgId], queryFn: ... resolveOrgSetting x3 })`.
2. Replace the slots summary block (:357-378) with:

```tsx
<div className="space-y-3">
  <BookingFunnel bookings={bookingsForDate ?? []} slots={slotConfig} />
  <UpNextStrip items={computeUpNext({
    flow,
    times,
    pendingCount: (bookingsForDate ?? []).filter((b) => b.status === "suggested").length,
    nextExpiry: (bookingsForDate ?? [])
      .filter((b) => b.status === "suggested" && b.offer_expires_at)
      .map((b) => b.offer_expires_at as string)
      .sort()[0] ?? null,
    hasOpenTier: (openedQ.data ?? []).some((t) => !t.closedAt),
  })} />
</div>
```

3. Replace the Offers card (:531-629) with `flow.artist_acceptance ? <TierTimeline ... /> : <EligibilityBookList ... />`:
   - `TierTimeline` props wired to the existing `tiersQ`/`openedQ` data, `openOffers.mutate`, `closeOffers.mutate`, plus dry-run state: `const [dryRun, setDryRun] = useState<{ tier: number } | null>(null);` and a `useQuery({ queryKey: ["offer-tiers", "dry-run", showDateId, dryRun?.tier], queryFn: () => dryRunOfferTier(supabase, { showDateId: showDateId!, tier: dryRun!.tier }), enabled: Boolean(dryRun) })` feeding `<DryRunDialog ... onConfirm={() => { openOffers.mutate(dryRun!.tier); setDryRun(null); }} />`.
   - `EligibilityBookList` wired to `eligibility` (from `useEligibleArtists(showDateId)` already in the sheet at :116; read its return shape) with `bookedArtistIds` = non-cancelled `bookingsForDate` artist ids, and `onBook` calling a new mutation `createBookingMutation` that uses Task 7's `createBooking(supabase, { ..., confirmDirectly: !flow.artist_acceptance, now: new Date() })` and invalidates `["bookings"]`. Replace the sheet's inline insert (:227-245) with this data fn for both modes.
4. Assigned Artists (:672-715): pass `showConfirm={flow.producer_confirmation}` to every `BookingRow`.
5. Keep the close-tier AlertDialog and edit dialog exactly as they are (moved inside `TierTimeline` in Task 19; delete the now-dead originals).
6. **Reference field in booking rows:** add to `src/hooks/useBookingFlow.ts`:

```ts
export function useReferenceField() {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const flowQ = useBookingFlow();
  const reference = flowQ.data?.reference_field ?? { source: "show" as const };
  const defsQ = useQuery({
    queryKey: ["custom-fields", "show_dates", orgId],
    queryFn: () => fetchCustomFieldDefs(supabase, { orgId, entity: "show_dates" }),
    enabled: Boolean(orgId) && reference.source === "custom",
  });
  const customFieldKey =
    reference.source === "custom"
      ? (defsQ.data ?? []).find((d) => d.id === reference.custom_field_id)?.key ?? null
      : null;
  return { reference, customFieldKey };
}
```

Then in the sheet's title/label spots and in `src/components/bookings/ArtistBookingsView.tsx` row labels, replace direct `showLabel(...)` calls with `referenceLabel({ reference, show, custom: showDate.custom ?? null, customFieldKey })` (import from `@/lib/bookingFlow`), keeping `showLabel` as the fallback the helper already implements. Read each component first; touch only the display-label call sites, not sorting/filtering logic.

- [ ] **Step 2: Dashboard gate**

`DashboardPage.tsx`: `const { data: flow } = useBookingFlow();` and change the Ready-to-Confirm render condition (:200) from `(softBookedRows?.length ?? 0) > 0` to `(flow?.producer_confirmation ?? true) && (softBookedRows?.length ?? 0) > 0`.

- [ ] **Step 3: Verify behavior in the browser (dev server)**

Run the dev server (launch config "dev", port 8080) and check with the seeded dev org: classic flow shows funnel + tiers + confirm buttons; flipping the org's `booking_flow` to direct (via the new settings tab) swaps the Offers card for the eligibility list and hides Confirm buttons and the dashboard card. Fix anything broken before committing.

- [ ] **Step 4: Run everything**

Run: `npx vitest run && npx tsc -p tsconfig.app.json --noEmit && npm run lint`
Expected: PASS/clean (update any existing sheet tests that referenced removed markup).

- [ ] **Step 5: Commit**

```bash
git add src/components/shows/ src/pages/DashboardPage.tsx
git commit -m "recompose date sheet around the configured booking flow"
```

---

### Task 22: System map + docs (both homes, same PR)

**Files:**
- Modify: `docs/system-map.md`
- Modify: `src/data/systemMap.ts`
- Test: existing `src/data/systemMap.test.ts` (CI drift guard; update expectations if it enumerates labels)

**Interfaces:**
- Consumes: the shipped behavior of Tasks 8-14.
- Produces: both map homes describe the new automation surface.

- [ ] **Step 1: Update `docs/system-map.md`**

Precise edits (keep the file's voice; NO em-dashes in new copy):
1. `## 5 → ### The booking state machine`: add `suggested → confirmed` (annotated "artist acceptance under auto-confirm; booking_flow.producer_confirmation=false") and note direct-mode inserts land as `confirmed` directly (inserts are not guarded; the guard covers updates).
2. `## 2. Clocks`: expire-offers entry gains the reminder pass (24 h before expiry, `reminder_sent_at` idempotency) and auto-escalation (closes short tier, opens next priority, `tier_escalated` notification); tier-at-risk-watcher entry notes the `booking_flow.at_risk_alerts` gate; send-offer-digest notes the immediate-delivery/direct-mode skip; send-confirmation-digest notes the `confirmation_digest` gate; airtable-poll notes the `auto_open_tier1` gate and updated-ready coverage.
3. `## 4` function counts/at-a-glance lines: adjust behavior notes for open-offer-tier (direct-mode 409, dry_run, immediate delivery).
4. `## 7. Messages out`: add `offer-immediate` and `offer-expiry-reminder` emails (category booking_offers) and in-app types `offer_expiring`, `tier_escalated`.
5. `## 5 → ### Triggers`: add `log_app_settings_change` on app_settings → settings_audit_log; note the understudy-promotion policy gates.
6. Appendix A dossiers for `open-offer-tier`, `send-offer-digest`, `send-confirmation-digest`, `expire-offers`, `tier-at-risk-watcher`, `airtable-poll`: one- or two-line additions matching the above.

- [ ] **Step 2: Mirror in `src/data/systemMap.ts`**

Add/adjust nodes and edges following the existing `SystemMapNode` shape (`src/data/systemMap.ts:9-29`): a `db` node for `settings_audit_log` (+ edge from the settings save path), detail-line updates on the `fn` nodes for the six functions above, and `fx` (effect) nodes/edges for the two new emails and two new notification types. Copy an existing node literal as the template. Run `npx vitest run src/data/systemMap.test.ts` and satisfy the drift guard.

- [ ] **Step 3: Run** — `npx vitest run src/data/systemMap.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/system-map.md src/data/systemMap.ts src/data/systemMap.test.ts
git commit -m "document booking flow automations in system map"
```

---

### Task 23: E2E: one happy path per preset

**Files:**
- Create: `e2e/booking-flow-presets.spec.ts`
- Possibly extend: `e2e/helpers/booking.ts` (a `setBookingFlow(orgId, value)` helper)

**Interfaces:**
- Consumes: `seedBookingFixture`/`cleanupBookingFixture`/`openOfferTier` helpers (`e2e/helpers/booking.ts`), `deleteUserByEmail`/`tagEmail` (`e2e/helpers/users.ts`, `e2e/helpers/supabase.ts`), the service-role admin client those helpers already construct.
- Produces: three serial tests proving the flow policy end to end.

- [ ] **Step 1: Add the helper**

In `e2e/helpers/booking.ts` (using the file's existing admin client):

```ts
export async function setBookingFlow(orgId: string, value: Record<string, unknown> | null) {
  const { error } = await admin
    .from("app_settings")
    .upsert({ org_id: orgId, key: "booking_flow", value }, { onConflict: "org_id,key" });
  if (error) throw error;
}
```

- [ ] **Step 2: Write the spec**

`e2e/booking-flow-presets.spec.ts`, `test.describe.configure({ mode: "serial" })`, one `beforeAll` seeding a booking fixture (clone the skeleton from `e2e/eligibility-gating.spec.ts`):

1. **classic**: `setBookingFlow(orgId, null)` (defaults); `openOfferTier` helper; assert via the admin client a `suggested` booking exists; artist logs in and accepts (reuse the acceptance steps from `e2e/booking-lifecycle.spec.ts`); assert DB status is `soft_booked`.
2. **fast-track (auto-confirm)**: `setBookingFlow(orgId, { producer_confirmation: false })`; fresh date; open tier; artist accepts; assert DB status is `confirmed` and `confirmed_at` set.
3. **direct**: `setBookingFlow(orgId, { artist_acceptance: false })`; fresh date; assert the `open-offer-tier` edge call returns an error (the helper should surface the 409); insert a booking through the UI path is optional — minimally assert via the admin client that a `createBooking`-shaped insert with `status: "confirmed"` succeeds and the artist's calendar shows the confirmed date after login.

`afterAll`: `setBookingFlow(orgId, null)` then the standard cleanup.

- [ ] **Step 3: Run locally if the env vars are present**

Run: `npx playwright test e2e/booking-flow-presets.spec.ts --config=e2e/playwright.config.ts --retries=0`
Expected: PASS locally when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are set; otherwise rely on CI's e2e job. Note: this spec needs the Task 4-6 migrations applied to the target database; when running against a DB without them, expect the reminder/audit assertions to be inapplicable (the spec above doesn't assert on them, so it runs on current prod schema EXCEPT test 2, which needs the `suggested → confirmed` guard change; run the full spec only after Task 24 applies migrations).

- [ ] **Step 4: Commit**

```bash
git add e2e/booking-flow-presets.spec.ts e2e/helpers/booking.ts
git commit -m "add e2e coverage for booking flow presets"
```

---

### Task 24: Finalize: migrations applied, types regenerated, full verification

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerated, never hand-edited)
- Possibly modify: `src/data/settingsAudit.ts` (drop the `as never` casts once types include `settings_audit_log`)

- [ ] **Step 1: Apply the three migrations to the live project via the Supabase MCP**

Use `apply_migration` (project `epweartpzwvcasrzyueh`) once per migration file, in file order: settings_audit_log → guard+reminder → understudy gates. All three are additive/safe (new table, new nullable column, guard widening, trigger gates that default to current behavior). Then run `list_migrations` and RENAME the local files to match the versions actually recorded (see the env-memory gotcha: `apply_migration` records real-timestamp versions; mismatched local filenames break the preview branch). Commit any renames.

- [ ] **Step 2: Regenerate types**

Use the MCP `generate_typescript_types`, write the output over `src/integrations/supabase/types.ts`, and drop the boundary casts in `src/data/settingsAudit.ts`. Run `npx tsc -p tsconfig.app.json --noEmit`.

- [ ] **Step 3: Full verification sweep**

```bash
npx vitest run
deno test --allow-all --node-modules-dir=none supabase/functions/
npm run lint
npx tsc -p tsconfig.app.json --noEmit
npm run build
```
Expected: all green. Then start the dev server and walk one classic and one direct scenario in the browser (settings tab renders, save writes audit history, cockpit swaps modes).

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts src/data/settingsAudit.ts supabase/migrations/
git commit -m "apply booking flow migrations and regenerate types"
```

---

## Deferred / out of scope (carried from the spec)

- Phase 3 (dashboards + artist surfaces beyond the Ready-to-Confirm gate), Phase 4 (eligibility axis, artist filters), per-show overrides.
- Version bump + `public/changelog.md` entry happen at release time per repo convention, not in this plan.
- Edge functions deploy automatically on merge to `main`; no manual deploy step.
