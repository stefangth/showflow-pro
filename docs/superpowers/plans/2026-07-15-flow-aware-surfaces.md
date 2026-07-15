# Flow-Aware Surfaces (Booking Flow Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboards, artist surfaces, and notifications adapt to the org's configured booking flow: direct-booked artists get an in-app notification, artist pages stop speaking offer language in direct mode, and producers get flow-relevant dashboard cards.

**Architecture:** A pure copy registry (`src/lib/flowCopy.ts`) owns every mode-dependent string, keyed off the normalized `BookingFlow` switches (`artist_acceptance`, `offer_delivery`). One DB migration extends `notify_booking_transition()` with an INSERT branch for direct bookings. Two new self-hiding producer-dashboard cards are pure presentational components fed by one new data-access fetch and pure derivation helpers in `src/lib/bookingCockpit.ts`.

**Tech Stack:** React 18 + TS + React Query v5, Vitest + supabaseFake harness, Supabase Postgres (plpgsql trigger, pgTAP), Playwright e2e (CI-only).

**Spec:** `docs/superpowers/specs/2026-07-15-flow-aware-surfaces-design.md`

## Global Constraints

- **No em- or en-dashes in ANY copy** (UI strings, comments in copy, docs, changelog). Middot (`·`) and arrows (`→`) are fine.
- `src/lib/flowCopy.ts` is **frontend-only** (no mirror in `supabase/functions/_shared/`). Do NOT touch `src/lib/bookingFlow.ts`/`_shared/bookingFlow.ts` in this plan except where a task says so; the dual-home rule applies only to `bookingFlow.ts`.
- Callers get the flow via `useBookingFlow()` (returns normalized data) with fallback `BOOKING_FLOW_DEFAULTS` while loading; flowCopy functions do not re-normalize.
- Query keys: everything reading `bookings`/`show_date_offer_tiers` uses the `['bookings', ...]` prefix; mutations already invalidate `['bookings']`.
- Migrations: NEW timestamped file only (`date -u +%Y%m%d%H%M%S`), never edit applied migrations. Do NOT apply to production in any task; the controller handles prod apply with explicit user approval.
- Automation change rule: `docs/system-map.md` and `src/data/systemMap.ts` update in the SAME task as the trigger change; `src/data/systemMap.test.ts` is the drift guard.
- Tests import the real module; never re-implement production logic in tests. Use `src/test/renderWithProviders.tsx` + `createFakeSupabase` from `src/test/supabaseFake.ts`; mocking domain hooks (`useMyArtist`, `useBookingFlow`, ...) via `vi.mock` follows the existing page-test pattern (see `src/pages/AvailabilityPage.blockPicker.test.tsx`); never hand-roll supabase client method chains.
- Commands: `npx vitest run <file>` (fast, targeted), `npx vitest run` (full), `npx tsc -p tsconfig.app.json --noEmit` (NOT bare tsc). pgTAP and Playwright run in CI only. Branch: `claude/flow-aware-surfaces` (already checked out).
- Commit messages: lowercase imperative, ≤72 chars, body ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/flowCopy.ts` (new) | All mode-dependent copy: page headers, status labels, meter spec, delivery hint |
| `src/lib/flowCopy.test.ts` (new) | Per-mode assertions + no-dash sweep |
| `supabase/migrations/<ts>_direct_booking_confirmed_notification.sql` (new) | INSERT branch in `notify_booking_transition()` + trigger recreate |
| `supabase/tests/db/direct_booking_notification.sql` (new) | pgTAP for the INSERT branch |
| `docs/system-map.md`, `src/data/systemMap.ts` | Trigger row + notification matrix updates |
| `src/components/dashboard/ArtistDashboard.tsx` | Meter + header from flowCopy |
| `src/pages/AvailabilityPage.tsx`, `src/components/bookings/ArtistBookingsView.tsx` | Copy from flowCopy |
| `src/lib/bookingCockpit.ts` | + `computeTierAttention`, `unfilledMainCastDates` (pure) |
| `src/data/bookings.ts` | + `fetchTierAttention` |
| `src/components/dashboard/TierAttentionCard.tsx` (new), `DirectBookingCard.tsx` (new) | Pure presentational cards |
| `src/pages/DashboardPage.tsx` | Wire flow + both cards |
| `e2e/booking-flow-presets.spec.ts`, `e2e/helpers/booking.ts` | Notification assertion in the direct test |

---

### Task 1: flowCopy module

**Files:**
- Create: `src/lib/flowCopy.ts`
- Test: `src/lib/flowCopy.test.ts`

**Interfaces:**
- Consumes: `BookingFlow`, `BOOKING_FLOW_DEFAULTS`, `applyPreset` from `src/lib/bookingFlow.ts`.
- Produces (later tasks import these EXACT names): `PageCopy { title: string; subtitle: string }`, `availabilityPageCopy(flow: BookingFlow): PageCopy`, `bookingsViewCopy(flow: BookingFlow): PageCopy`, `bookingStatusLabels(flow: BookingFlow): Record<string, string>`, `MeterSpec { title: string; headerSentence: string; footer: string; filterUnanswered: boolean; countStatuses: string[] }`, `artistMeter(flow: BookingFlow): MeterSpec`, `deliveryHint(flow: BookingFlow): string`.
- Spec addendum (approved design detail): `MeterSpec` carries `footer` and `filterUnanswered` because the meter card's footer line and its link query param are offer-worded today.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/flowCopy.test.ts
import { describe, expect, it } from "vitest";
import { BOOKING_FLOW_DEFAULTS, applyPreset } from "./bookingFlow";
import {
  artistMeter, availabilityPageCopy, bookingStatusLabels, bookingsViewCopy, deliveryHint,
} from "./flowCopy";

const classic = BOOKING_FLOW_DEFAULTS;
const direct = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
const fasttrack = applyPreset(BOOKING_FLOW_DEFAULTS, "fasttrack");

describe("availabilityPageCopy", () => {
  it("offer orgs keep the offers framing", () => {
    expect(availabilityPageCopy(classic)).toEqual({
      title: "My Offers",
      subtitle: "View your offers and block dates you're unavailable for.",
    });
  });
  it("direct orgs get dates framing", () => {
    expect(availabilityPageCopy(direct)).toEqual({
      title: "My Dates",
      subtitle: "Your bookings and availability. Block dates you can't perform.",
    });
  });
});

describe("bookingStatusLabels", () => {
  it("direct orgs never claim offers", () => {
    const labels = bookingStatusLabels(direct);
    expect(labels.unanswered).toBe("Not booked");
    expect(labels.confirmed).toBe("Booked");
  });
  it("offer orgs keep existing labels", () => {
    const labels = bookingStatusLabels(classic);
    expect(labels).toMatchObject({
      suggested: "Offer pending", soft_booked: "Hold placed",
      confirmed: "Confirmed", unanswered: "No offer yet",
    });
  });
});

describe("bookingsViewCopy", () => {
  it("subtitle adapts per mode", () => {
    expect(bookingsViewCopy(classic).subtitle).toBe("Dates you've been offered for, based on your cast eligibility.");
    expect(bookingsViewCopy(direct).subtitle).toBe("Dates you're booked for, based on your cast eligibility.");
    expect(bookingsViewCopy(direct).title).toBe("My Bookings");
  });
});

describe("artistMeter", () => {
  it("offer orgs keep response rate counting confirmed + soft_booked", () => {
    const m = artistMeter(classic);
    expect(m.title).toBe("Response rate");
    expect(m.headerSentence).toBe("Your response rate on dates you've been offered.");
    expect(m.footer).toBe("Click to see pending offers →");
    expect(m.filterUnanswered).toBe(true);
    expect(m.countStatuses).toEqual(["confirmed", "soft_booked"]);
  });
  it("direct orgs get booked dates counting confirmed only", () => {
    const m = artistMeter(direct);
    expect(m.title).toBe("Booked dates");
    expect(m.headerSentence).toBe("Your booked share of the dates you're eligible for.");
    expect(m.footer).toBe("Click to see your dates →");
    expect(m.filterUnanswered).toBe(false);
    expect(m.countStatuses).toEqual(["confirmed"]);
  });
});

describe("deliveryHint", () => {
  it("only immediate offer orgs get the hint", () => {
    expect(deliveryHint(fasttrack)).toBe("Offers email artists immediately when a tier opens.");
    expect(deliveryHint(classic)).toBe("");
    expect(deliveryHint(direct)).toBe("");
  });
});

describe("copy hygiene", () => {
  it("emits no em- or en-dashes in any mode", () => {
    for (const flow of [classic, direct, fasttrack]) {
      const strings = [
        ...Object.values(availabilityPageCopy(flow)),
        ...Object.values(bookingsViewCopy(flow)),
        ...Object.values(bookingStatusLabels(flow)),
        artistMeter(flow).title, artistMeter(flow).headerSentence, artistMeter(flow).footer,
        deliveryHint(flow),
      ];
      for (const s of strings) expect(s).not.toMatch(/[—–]/);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/flowCopy.test.ts`
Expected: FAIL (cannot resolve `./flowCopy`).

- [ ] **Step 3: Implement**

```ts
// src/lib/flowCopy.ts
// Central registry for every string that changes with the org's booking flow.
// Copy derives from the normalized flow's switches (artist_acceptance,
// offer_delivery), never from preset names, so custom configs work. Callers
// pass useBookingFlow() data (already normalized; fall back to
// BOOKING_FLOW_DEFAULTS while loading). Frontend-only: no _shared mirror.
// No em- or en-dashes in any string (middot and arrows are fine).

import type { BookingFlow } from "./bookingFlow";

export interface PageCopy {
  title: string;
  subtitle: string;
}

export function availabilityPageCopy(flow: BookingFlow): PageCopy {
  if (!flow.artist_acceptance) {
    return {
      title: "My Dates",
      subtitle: "Your bookings and availability. Block dates you can't perform.",
    };
  }
  return {
    title: "My Offers",
    subtitle: "View your offers and block dates you're unavailable for.",
  };
}

export function bookingsViewCopy(flow: BookingFlow): PageCopy {
  return {
    title: "My Bookings",
    subtitle: flow.artist_acceptance
      ? "Dates you've been offered for, based on your cast eligibility."
      : "Dates you're booked for, based on your cast eligibility.",
  };
}

// Shared by AvailabilityPage and ArtistBookingsView (both kept private copies
// before). suggested/soft_booked are unreachable in direct mode but keep sane
// fallbacks; cancelled only renders in the bookings view.
export function bookingStatusLabels(flow: BookingFlow): Record<string, string> {
  if (!flow.artist_acceptance) {
    return {
      suggested: "Offer pending",
      soft_booked: "Hold placed",
      confirmed: "Booked",
      unanswered: "Not booked",
      cancelled: "Cancelled",
    };
  }
  return {
    suggested: "Offer pending",
    soft_booked: "Hold placed",
    confirmed: "Confirmed",
    unanswered: "No offer yet",
    cancelled: "Cancelled",
  };
}

export interface MeterSpec {
  title: string;
  headerSentence: string;
  footer: string;
  filterUnanswered: boolean;
  countStatuses: string[];
}

export function artistMeter(flow: BookingFlow): MeterSpec {
  if (!flow.artist_acceptance) {
    return {
      title: "Booked dates",
      headerSentence: "Your booked share of the dates you're eligible for.",
      footer: "Click to see your dates →",
      filterUnanswered: false,
      countStatuses: ["confirmed"],
    };
  }
  return {
    title: "Response rate",
    headerSentence: "Your response rate on dates you've been offered.",
    footer: "Click to see pending offers →",
    filterUnanswered: true,
    countStatuses: ["confirmed", "soft_booked"],
  };
}

export function deliveryHint(flow: BookingFlow): string {
  return flow.artist_acceptance && flow.offer_delivery === "immediate"
    ? "Offers email artists immediately when a tier opens."
    : "";
}
```

Note: `ArtistBookingsView`'s label map today says `soft_booked: 'Soft booked'` while AvailabilityPage says `'Hold placed'`; converging both on `'Hold placed'` is intentional (one artist-facing word for the same state).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/flowCopy.test.ts` → PASS. Then `npx tsc -p tsconfig.app.json --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/flowCopy.ts src/lib/flowCopy.test.ts
git commit -m "add flow copy registry for mode-aware surfaces"
```

---

### Task 2: direct-booking notification (migration + pgTAP + system map)

**Files:**
- Create: `supabase/migrations/$(date -u +%Y%m%d%H%M%S)_direct_booking_confirmed_notification.sql`
- Create: `supabase/tests/db/direct_booking_notification.sql`
- Modify: `docs/system-map.md` (trigger table row ~line 148; notification matrix ~line 257)
- Modify: `src/data/systemMap.ts` (cite for the notify trigger; run the drift test)

**Interfaces:**
- Consumes: current `notify_booking_transition()` definition in `supabase/migrations/20260714182625_booking_flow_review_hardening.sql:30-125` (Section 1). Copy it VERBATIM as the base; only add the INSERT branch and change the trigger event.
- Produces: `notify_booking_transition()` also fires AFTER INSERT; a booking INSERTed with `status='confirmed'` notifies the linked artist (`type='booking_confirmed'`). No pgTAP/TS interface consumed later.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/db/direct_booking_notification.sql
-- Direct-booking orgs create bookings by INSERTing status='confirmed' with no
-- offer step (createBooking, confirmDirectly). notify_booking_transition() was
-- AFTER UPDATE only, so those artists got no in-app notification, ever
-- (Phase 3 gap 1). The INSERT branch closes it: INSERT as confirmed with a
-- linked artist -> one booking_confirmed notification; offer INSERTs
-- (suggested) and unlinked artists stay silent.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(3);

INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('db100000-0000-0000-0000-00000000000a','authenticated','authenticated','dbn-artist@test.com',now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug)
  VALUES ('db100000-0000-0000-0000-000000000001', 'DBN Org', 'dbn-org');
INSERT INTO public.shows (id, org_id, program, sub_program, status)
  VALUES ('db100000-0000-0000-0000-000000000002', 'db100000-0000-0000-0000-000000000001', 'DBN', 'DBN: Show', 'active');
INSERT INTO public.show_dates (id, show_id, date, session_1)
  VALUES ('db100000-0000-0000-0000-000000000003', 'db100000-0000-0000-0000-000000000002', '2026-08-01', '19:00');
-- a1 linked to the auth user, a2 and a3 unlinked
INSERT INTO public.artists (id, org_id, name, status, user_id)
  VALUES ('db100000-0000-0000-0000-000000000004', 'db100000-0000-0000-0000-000000000001', 'Linked Artist', 'active', 'db100000-0000-0000-0000-00000000000a');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('db100000-0000-0000-0000-000000000005', 'db100000-0000-0000-0000-000000000001', 'Unlinked Two', 'active');
INSERT INTO public.artists (id, org_id, name, status)
  VALUES ('db100000-0000-0000-0000-000000000006', 'db100000-0000-0000-0000-000000000001', 'Unlinked Three', 'active');

-- 1) INSERT confirmed with a linked artist -> exactly one booking_confirmed
INSERT INTO public.bookings (id, show_date_id, artist_id, status)
  VALUES ('db100000-0000-0000-0000-000000000007', 'db100000-0000-0000-0000-000000000003', 'db100000-0000-0000-0000-000000000004', 'confirmed');
SELECT is(
  (SELECT count(*) FROM public.notifications
    WHERE type = 'booking_confirmed'
      AND user_id = 'db100000-0000-0000-0000-00000000000a'
      AND related_entity_id = 'db100000-0000-0000-0000-000000000007'),
  1::bigint,
  'direct INSERT as confirmed notifies the linked artist');

-- 2) INSERT suggested (an offer) -> no new booking_confirmed row
INSERT INTO public.bookings (show_date_id, artist_id, status)
  VALUES ('db100000-0000-0000-0000-000000000003', 'db100000-0000-0000-0000-000000000005', 'suggested');
SELECT is(
  (SELECT count(*) FROM public.notifications WHERE type = 'booking_confirmed'),
  1::bigint,
  'offer INSERT (suggested) fires no confirmed notification');

-- 3) INSERT confirmed with an unlinked artist -> still no new row
INSERT INTO public.bookings (show_date_id, artist_id, status)
  VALUES ('db100000-0000-0000-0000-000000000003', 'db100000-0000-0000-0000-000000000006', 'confirmed');
SELECT is(
  (SELECT count(*) FROM public.notifications WHERE type = 'booking_confirmed'),
  1::bigint,
  'unlinked artist INSERT stays silent');

SELECT * FROM finish();
ROLLBACK;
```

(If `db100000-...` literals fail uuid parsing, use `db100000-...` style hex-only ids consistently; keep them unique within the file.)

- [ ] **Step 2: Note on running**

pgTAP is CI-only locally. Sanity-check the SQL by reading `supabase/tests/db/bookings_artist_org_guard.sql` for the established structure. CI validates.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/<UTC timestamp>_direct_booking_confirmed_notification.sql` (timestamp via `date -u +%Y%m%d%H%M%S`). Content: the FULL `CREATE OR REPLACE FUNCTION public.notify_booking_transition() ...` copied verbatim from `20260714182625_booking_flow_review_hardening.sql` Section 1 (lines 30-125), with exactly ONE addition immediately after `BEGIN` and before the `IF TG_OP != 'UPDATE' ...` guard:

```sql
  -- Phase 3: direct-booking orgs INSERT bookings as 'confirmed' with no offer
  -- step (createBooking with confirmDirectly), so no UPDATE transition ever
  -- fires for them and the artist was never notified in-app. Handle INSERTs
  -- here; offers land as 'suggested' and are skipped. Email is unchanged: the
  -- confirmation digest already covers direct bookings.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'confirmed' THEN
      SELECT sd.date, sd.city_id, s.program, s.sub_program
      INTO v_show_date
      FROM public.show_dates sd
      JOIN public.shows s ON s.id = sd.show_id
      WHERE sd.id = NEW.show_date_id;

      SELECT a.user_id INTO v_artist_user_id
      FROM public.artists a WHERE a.id = NEW.artist_id;

      IF v_artist_user_id IS NOT NULL THEN
        INSERT INTO public.notifications (org_id, user_id, type, title, message, related_entity_type, related_entity_id)
        VALUES (
          NEW.org_id,
          v_artist_user_id,
          'booking_confirmed',
          'Booking confirmed',
          format('Your booking for %s on %s has been confirmed.',
                 COALESCE(v_show_date.program, 'a show'),
                 to_char(v_show_date.date, 'DD Mon YYYY')),
          'booking',
          NEW.id
        );
      END IF;
    END IF;
    RETURN NULL;
  END IF;
```

The audit-log INSERT stays where it is (UPDATE path only; there is no OLD row to audit a status_change against on INSERT). After the function, recreate the trigger with the new event:

```sql
DROP TRIGGER IF EXISTS notify_booking_transition_trigger ON public.bookings;
CREATE TRIGGER notify_booking_transition_trigger
AFTER INSERT OR UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.notify_booking_transition();
```

Head the file with a comment block explaining the gap (mirror the pgTAP header). Note: `NEW.org_id` is already derived by the BEFORE trigger `trg_derive_org_id`, so it is safe to use in this AFTER trigger.

- [ ] **Step 4: Update both system-map homes**

`docs/system-map.md`:
- Trigger table row (currently line ~148) becomes:

```
| `notify_booking_transition_trigger` | `bookings` | AFTER INSERT OR UPDATE | audit log (updates only) + notifications: `suggested→soft_booked` → producers; `soft_booked→confirmed` → artist; direct INSERT as `confirmed` → artist | no | body `20260604133000_org_scope_assignments_and_autocancel.sql`, INSERT branch `<your migration filename>.sql` |
```

- Notification matrix: directly under the row `| Booking confirmed (`soft_booked→confirmed`) | in-app | the artist | DB trigger `notify_booking_transition` | notification prefs |` (line ~257) add:

```
| Booked directly (direct-booking INSERT as `confirmed`) | in-app | the artist | DB trigger `notify_booking_transition` | notification prefs |
```

`src/data/systemMap.ts`: grep for `notify_booking_transition` (one hit in the `d_bookings` detail chain) and for the node/edge that describes the booking-notification behavior; add the new migration filename to that node's cite list (pattern: how `20260714104826` was added to `d_bookings` detail Cite) and extend any behavior text that enumerates the two UPDATE transitions with the direct-INSERT case. Then run `npx vitest run src/data/systemMap.test.ts` (the drift guard) and satisfy whatever it checks.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/data/systemMap.test.ts` → PASS. `npx tsc -p tsconfig.app.json --noEmit` → clean.

```bash
git add supabase/migrations/*direct_booking_confirmed_notification.sql supabase/tests/db/direct_booking_notification.sql docs/system-map.md src/data/systemMap.ts
git commit -m "notify artist on direct confirmed booking insert"
```

Do NOT apply the migration to any remote project. Report in your summary that the migration awaits controller-managed prod apply.

---

### Task 3: ArtistDashboard meter + header

**Files:**
- Modify: `src/components/dashboard/ArtistDashboard.tsx` (meter memo ~lines 63-76; header ~96-99; meter card ~108-135)
- Test: `src/components/dashboard/ArtistDashboard.flowCopy.test.tsx` (new)

**Interfaces:**
- Consumes: `artistMeter(flow): MeterSpec` from Task 1 (`title`, `headerSentence`, `footer`, `filterUnanswered`, `countStatuses`); `useBookingFlow()` from `src/hooks/useBookingFlow.ts`; `BOOKING_FLOW_DEFAULTS` from `src/lib/bookingFlow.ts`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing test**

Create `src/components/dashboard/ArtistDashboard.flowCopy.test.tsx`. Mock the same modules `src/pages/AvailabilityPage.blockPicker.test.tsx` mocks (read it first): `@/integrations/supabase/client` (a `createFakeSupabase` instance with empty table seeds), `react-router-dom` (Link → anchor passthrough), `@/features/auth/AuthContext`, `@/hooks/useMyArtist` (returns `{ data: { id: "artist-1", name: "A" } }`), `@/hooks/useArtistEligibleDates` (returns 4 eligible dates `d1..d4`), plus `@/hooks/useBookingFlow` with a mutable holder:

```tsx
const flowHolder = { flow: BOOKING_FLOW_DEFAULTS as BookingFlow };
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowHolder.flow }),
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));
```

Seed the artist's bookings query so d1 is `confirmed`, d2 is `soft_booked`, d3 is `suggested`, d4 unbooked (check how ArtistDashboard fetches `myBookings` and seed the fake accordingly; if it uses a hook, mock that hook instead).

Two tests:
1. Classic flow: renders heading text `Response rate`, sentence `Your response rate on dates you've been offered.`, and `2 of 4 dates` (confirmed + soft_booked).
2. `flowHolder.flow = applyPreset(BOOKING_FLOW_DEFAULTS, "direct")`: renders `Booked dates`, `Your booked share of the dates you're eligible for.`, and `1 of 4 dates` (confirmed only), and the meter link href does NOT contain `filter=unanswered`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/dashboard/ArtistDashboard.flowCopy.test.tsx`
Expected: FAIL (direct-mode assertions; classic ones may pass already).

- [ ] **Step 3: Implement**

In `ArtistDashboard.tsx`:

```tsx
import { useBookingFlow } from '@/hooks/useBookingFlow';   // keep existing useReferenceField import
import { BOOKING_FLOW_DEFAULTS } from '@/lib/bookingFlow';
import { artistMeter } from '@/lib/flowCopy';
// inside the component:
const flowQ = useBookingFlow();
const meter = artistMeter(flowQ.data ?? BOOKING_FLOW_DEFAULTS);
```

Meter memo: replace the hardcoded status check with

```tsx
const respondedCount = dates.filter((d) => {
  const s = bookingMap.get(d.id);
  return s != null && meter.countStatuses.includes(s);
}).length;
```

and add `meter` to the `useMemo` dependency array. Header `<p>` → `{meter.headerSentence}`. Card label `Response rate` → `{meter.title}`. Meter link:

```tsx
<Link to={meter.filterUnanswered ? `${ROUTES.AVAILABILITY}?filter=unanswered` : ROUTES.AVAILABILITY} className="block">
```

Footer line `Click to see pending offers →` → `{meter.footer}`.

- [ ] **Step 4: Run to verify it passes**

`npx vitest run src/components/dashboard/` → PASS. `npx tsc -p tsconfig.app.json --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/ArtistDashboard.tsx src/components/dashboard/ArtistDashboard.flowCopy.test.tsx
git commit -m "swap artist meter and header per booking flow mode"
```

---

### Task 4: AvailabilityPage + ArtistBookingsView copy

**Files:**
- Modify: `src/pages/AvailabilityPage.tsx` (local `BOOKING_STATUS_LABEL` ~lines 37-42; H1/subtitle ~216-220)
- Modify: `src/components/bookings/ArtistBookingsView.tsx` (local `STATUS_LABEL` ~43-49; H1/subtitle ~127-130)
- Test: `src/pages/AvailabilityPage.flowCopy.test.tsx` (new), `src/components/bookings/ArtistBookingsView.flowCopy.test.tsx` (new)

**Interfaces:**
- Consumes: `availabilityPageCopy`, `bookingsViewCopy`, `bookingStatusLabels` from Task 1; `useBookingFlow`.
- Produces: nothing consumed later. NOTE: both local label maps are DELETED; labels come from `bookingStatusLabels(flow)`.

- [ ] **Step 1: Write the failing tests**

Both test files clone the mock scaffold of `src/pages/AvailabilityPage.blockPicker.test.tsx` (read it first; reuse its client seeding) plus the `flowHolder` mock of `@/hooks/useBookingFlow` from Task 3. Assertions:

AvailabilityPage: (1) classic → H1 `My Offers`, subtitle contains `View your offers`; (2) direct → H1 `My Dates`, subtitle contains `Block dates you can't perform`, and an unbooked eligible row shows `Not booked` (not `No offer yet`).

ArtistBookingsView: (1) classic → subtitle contains `been offered for`; (2) direct → subtitle contains `you're booked for`, and a confirmed row shows `Booked` while an unbooked eligible row shows `Not booked`. (Check the component's props/mocked hooks the way its existing usage in `src/pages/` wires it; mock `useArtistEligibleDates`/`useMyArtist` as in the blockPicker test.)

- [ ] **Step 2: Run to verify they fail**

`npx vitest run src/pages/AvailabilityPage.flowCopy.test.tsx src/components/bookings/ArtistBookingsView.flowCopy.test.tsx` → FAIL on direct-mode strings.

- [ ] **Step 3: Implement**

AvailabilityPage.tsx: delete the module-level `BOOKING_STATUS_LABEL`; inside the component:

```tsx
const flowQ = useBookingFlow();
const flow = flowQ.data ?? BOOKING_FLOW_DEFAULTS;
const pageCopy = availabilityPageCopy(flow);
const statusLabels = bookingStatusLabels(flow);
```

Replace every `BOOKING_STATUS_LABEL[x]` read with `statusLabels[x]`, the H1 text with `{pageCopy.title}`, the subtitle with `{pageCopy.subtitle}`. (`useBookingFlow` import joins the existing `useReferenceField` import.)

ArtistBookingsView.tsx: same pattern with `bookingsViewCopy(flow)` for title/subtitle and `bookingStatusLabels(flow)` replacing `STATUS_LABEL` (delete the local map; keep `cancelled` handling identical).

- [ ] **Step 4: Run to verify**

`npx vitest run src/pages/ src/components/bookings/` → PASS (including the pre-existing blockPicker/error tests). `npx tsc -p tsconfig.app.json --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/AvailabilityPage.tsx src/components/bookings/ArtistBookingsView.tsx src/pages/AvailabilityPage.flowCopy.test.tsx src/components/bookings/ArtistBookingsView.flowCopy.test.tsx
git commit -m "adapt artist page copy to booking flow mode"
```

---

### Task 5: tier-attention derivation (pure)

**Files:**
- Modify: `src/lib/bookingCockpit.ts` (append)
- Test: `src/lib/bookingCockpit.test.ts` (append)

**Interfaces:**
- Consumes: `tierFillCounts` already in the same file.
- Produces (Task 6 imports these EXACT names):

```ts
export interface TierAttentionInput {
  showDateId: string;
  date: string; // yyyy-mm-dd
  program: string | null;
  subProgram: string | null;
  custom: Record<string, unknown> | null;
  slots: { main_cast: number; understudies: number } | null;
  tier: number;
  bookings: Array<{ status: string; offer_tier: number | null; offer_expires_at: string | null }>;
}
export interface TierAttentionItem {
  showDateId: string; date: string; program: string | null; subProgram: string | null;
  custom: Record<string, unknown> | null;
  tier: number; filled: number; required: number; atRisk: boolean; expiresSoon: boolean;
}
export function computeTierAttention(rows: TierAttentionInput[], now: Date): TierAttentionItem[]
export function unfilledMainCastDates(
  dates: Array<{ id: string; date: string; program: string | null; subProgram: string | null; mainSlots: number | null }>,
  confirmedMainByDate: Map<string, number>,
): Array<{ id: string; date: string; program: string | null; subProgram: string | null; mainBooked: number; mainSlots: number }>
```

- [ ] **Step 1: Write the failing tests** (append to `bookingCockpit.test.ts`)

```ts
describe("computeTierAttention", () => {
  const NOW = new Date("2026-07-15T12:00:00Z");
  const base = {
    showDateId: "d1", date: "2026-07-20", program: "TJE", subProgram: "Murder",
    custom: null, slots: { main_cast: 2, understudies: 1 }, tier: 1,
  };
  it("flags an under-filled open tier as at risk", () => {
    const items = computeTierAttention([{
      ...base,
      bookings: [{ status: "soft_booked", offer_tier: 1, offer_expires_at: null }],
    }], NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ filled: 1, required: 3, atRisk: true, expiresSoon: false });
  });
  it("flags offers expiring within 24h even when filled", () => {
    const items = computeTierAttention([{
      ...base,
      bookings: [
        { status: "soft_booked", offer_tier: 1, offer_expires_at: null },
        { status: "soft_booked", offer_tier: 1, offer_expires_at: null },
        { status: "suggested", offer_tier: 1, offer_expires_at: "2026-07-15T20:00:00Z" },
      ],
    }], NOW);
    expect(items[0]).toMatchObject({ filled: 3, atRisk: false, expiresSoon: true });
  });
  it("drops healthy tiers, unconfigured slots, and cancelled bookings", () => {
    const items = computeTierAttention([
      { ...base, bookings: [
        { status: "confirmed", offer_tier: 1, offer_expires_at: null },
        { status: "confirmed", offer_tier: 1, offer_expires_at: null },
        { status: "soft_booked", offer_tier: 1, offer_expires_at: null },
      ] },
      { ...base, showDateId: "d2", slots: null, bookings: [] },
      { ...base, showDateId: "d3", bookings: [
        { status: "cancelled", offer_tier: 1, offer_expires_at: null },
      ] },
    ], NOW);
    expect(items.map((i) => i.showDateId)).toEqual(["d3"]); // only the empty at-risk one
  });
  it("sorts by date ascending", () => {
    const items = computeTierAttention([
      { ...base, showDateId: "later", date: "2026-07-25", bookings: [] },
      { ...base, showDateId: "sooner", date: "2026-07-18", bookings: [] },
    ], NOW);
    expect(items.map((i) => i.showDateId)).toEqual(["sooner", "later"]);
  });
});

describe("unfilledMainCastDates", () => {
  it("returns dates whose confirmed main cast is under the slot count", () => {
    const out = unfilledMainCastDates(
      [
        { id: "d1", date: "2026-07-20", program: "A", subProgram: null, mainSlots: 2 },
        { id: "d2", date: "2026-07-21", program: "B", subProgram: null, mainSlots: 2 },
        { id: "d3", date: "2026-07-22", program: "C", subProgram: null, mainSlots: null },
      ],
      new Map([["d1", 2], ["d2", 1]]),
    );
    expect(out).toEqual([
      { id: "d2", date: "2026-07-21", program: "B", subProgram: null, mainBooked: 1, mainSlots: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

`npx vitest run src/lib/bookingCockpit.test.ts` → FAIL (functions not exported).

- [ ] **Step 3: Implement** (append to `bookingCockpit.ts`)

```ts
export interface TierAttentionInput {
  showDateId: string;
  date: string;
  program: string | null;
  subProgram: string | null;
  custom: Record<string, unknown> | null;
  slots: { main_cast: number; understudies: number } | null;
  tier: number;
  bookings: Array<{ status: string; offer_tier: number | null; offer_expires_at: string | null }>;
}

export interface TierAttentionItem {
  showDateId: string;
  date: string;
  program: string | null;
  subProgram: string | null;
  custom: Record<string, unknown> | null;
  tier: number;
  filled: number;
  required: number;
  atRisk: boolean;
  expiresSoon: boolean;
}

const EXPIRES_SOON_MS = 24 * 60 * 60 * 1000;

/**
 * Attention rows for the producer dashboard: open tiers that are under-filled
 * (filled = pending + accepted in the tier, required = total configured slots,
 * matching the dashboard's fully-confirmed math) or that have pending offers
 * expiring within 24h. Dates without slot config are skipped: no basis to
 * judge. Sorted soonest first.
 */
export function computeTierAttention(rows: TierAttentionInput[], now: Date): TierAttentionItem[] {
  const items: TierAttentionItem[] = [];
  for (const r of rows) {
    if (!r.slots) continue;
    const required = r.slots.main_cast + r.slots.understudies;
    const counts = tierFillCounts(r.bookings, r.tier);
    const filled = counts.pending + counts.accepted;
    const atRisk = filled < required;
    const expiresSoon = r.bookings.some((b) => {
      if (b.status !== "suggested" || b.offer_tier !== r.tier || !b.offer_expires_at) return false;
      const dt = new Date(b.offer_expires_at).getTime() - now.getTime();
      return dt > 0 && dt <= EXPIRES_SOON_MS;
    });
    if (!atRisk && !expiresSoon) continue;
    items.push({
      showDateId: r.showDateId, date: r.date, program: r.program, subProgram: r.subProgram,
      custom: r.custom, tier: r.tier, filled, required, atRisk, expiresSoon,
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/** Direct-mode dashboard rows: upcoming dates whose confirmed main cast is short. */
export function unfilledMainCastDates(
  dates: Array<{ id: string; date: string; program: string | null; subProgram: string | null; mainSlots: number | null }>,
  confirmedMainByDate: Map<string, number>,
): Array<{ id: string; date: string; program: string | null; subProgram: string | null; mainBooked: number; mainSlots: number }> {
  return dates
    .filter((d) => d.mainSlots != null && (confirmedMainByDate.get(d.id) ?? 0) < d.mainSlots)
    .map((d) => ({
      id: d.id, date: d.date, program: d.program, subProgram: d.subProgram,
      mainBooked: confirmedMainByDate.get(d.id) ?? 0, mainSlots: d.mainSlots as number,
    }));
}
```

- [ ] **Step 4: Run to verify** — `npx vitest run src/lib/bookingCockpit.test.ts` → PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookingCockpit.ts src/lib/bookingCockpit.test.ts
git commit -m "add tier attention and unfilled date derivations"
```

---

### Task 6: TierAttentionCard + data fetch + wiring

**Files:**
- Modify: `src/data/bookings.ts` (append `fetchTierAttention`)
- Create: `src/components/dashboard/TierAttentionCard.tsx`
- Modify: `src/pages/DashboardPage.tsx` (wire flow + query + card between the stat-card grid and the Ready-to-Confirm card)
- Test: `src/data/bookings.test.ts` (append), `src/components/dashboard/TierAttentionCard.test.tsx` (new)

**Interfaces:**
- Consumes: `computeTierAttention`, `TierAttentionInput`, `TierAttentionItem` (Task 5); `deliveryHint` (Task 1); `useBookingFlow`; `referenceLabel` from `src/lib/bookingFlow.ts`; existing `useReferenceField` values already in `DashboardPage`.
- Produces: `fetchTierAttention(client, args: { orgId: string | null; today: string }): Promise<TierAttentionInput[]>`; `TierAttentionCard({ items, hint, reference, customFieldKey })` (renders nothing when `items` empty).

- [ ] **Step 1: Failing data-access test** (append to `src/data/bookings.test.ts`, follow the file's existing `createFakeSupabase` style)

```ts
describe("fetchTierAttention", () => {
  it("selects open tiers on upcoming org dates and maps rows", async () => {
    const fake = createFakeSupabase({
      show_date_offer_tiers: {
        data: [{
          tier: 1,
          show_date: {
            id: "d1", date: "2026-07-20", status: "open", custom: null,
            show: { program: "TJE", sub_program: "M", main_cast_slots: 2, understudy_slots: 1 },
            bookings: [{ status: "suggested", offer_tier: 1, offer_expires_at: null }],
          },
        }],
        error: null,
      },
    });
    const rows = await fetchTierAttention(fake as never, { orgId: "org-1", today: "2026-07-15" });
    expect(rows).toEqual([{
      showDateId: "d1", date: "2026-07-20", program: "TJE", subProgram: "M", custom: null,
      slots: { main_cast: 2, understudies: 1 }, tier: 1,
      bookings: [{ status: "suggested", offer_tier: 1, offer_expires_at: null }],
    }]);
    expect(fake.calls).toContainEqual({ table: "show_date_offer_tiers", method: "is", args: ["closed_at", null] });
    expect(fake.calls).toContainEqual({ table: "show_date_offer_tiers", method: "eq", args: ["show_date.org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "show_date_offer_tiers", method: "gte", args: ["show_date.date", "2026-07-15"] });
  });
  it("returns [] for a null org without querying", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchTierAttention(fake as never, { orgId: null, today: "2026-07-15" })).toEqual([]);
    expect(fake.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/data/bookings.test.ts` → FAIL.

- [ ] **Step 3: Implement `fetchTierAttention`** (append to `src/data/bookings.ts`; import `TierAttentionInput` type from `@/lib/bookingCockpit`)

```ts
/**
 * Open offer tiers on this org's upcoming, non-cancelled dates, with the
 * date's bookings and slot config, for the dashboard tier-attention card.
 * `today` is passed in (yyyy-mm-dd) so callers and tests own the clock.
 */
export async function fetchTierAttention(
  client: SupabaseClient<Database>,
  args: { orgId: string | null; today: string },
): Promise<TierAttentionInput[]> {
  if (!args.orgId) return [];
  const { data, error } = await client
    .from("show_date_offer_tiers")
    .select(
      "tier, show_date:show_dates!inner(id, date, status, custom, org_id, " +
      "show:shows(program, sub_program, main_cast_slots, understudy_slots), " +
      "bookings(status, offer_tier, offer_expires_at))",
    )
    .is("closed_at", null)
    .eq("show_date.org_id", args.orgId)
    .gte("show_date.date", args.today)
    .neq("show_date.status", "cancelled");
  if (error) throw error;
  // deno-lint-style any at the join boundary, consistent with the file's other joined-row shapes
  return ((data ?? []) as any[]).map((r) => ({
    showDateId: r.show_date.id,
    date: r.show_date.date,
    program: r.show_date.show?.program ?? null,
    subProgram: r.show_date.show?.sub_program ?? null,
    custom: r.show_date.custom ?? null,
    slots:
      r.show_date.show?.main_cast_slots != null && r.show_date.show?.understudy_slots != null
        ? { main_cast: r.show_date.show.main_cast_slots, understudies: r.show_date.show.understudy_slots }
        : null,
    tier: r.tier,
    bookings: (r.show_date.bookings ?? []).map((b: any) => ({
      status: b.status, offer_tier: b.offer_tier, offer_expires_at: b.offer_expires_at,
    })),
  }));
}
```

(If `show_dates` has no `custom` column in `types.ts`, check how `ShowsBookingsPage`'s query selects the custom-field values and mirror that select; if custom values live elsewhere, set `custom: null` here and note it — `referenceLabel` degrades gracefully.)

- [ ] **Step 4: Failing card test** (`src/components/dashboard/TierAttentionCard.test.tsx`)

```tsx
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { MemoryRouter } from "react-router-dom";
import { TierAttentionCard } from "./TierAttentionCard";

const item = {
  showDateId: "d1", date: "2026-07-20", program: "TJE", subProgram: "Murder", custom: null,
  tier: 2, filled: 1, required: 3, atRisk: true, expiresSoon: true,
};
const wrap = (ui: React.ReactElement) => renderWithProviders(<MemoryRouter>{ui}</MemoryRouter>);

describe("TierAttentionCard", () => {
  it("renders rows with fill state and badges", () => {
    wrap(<TierAttentionCard items={[item]} hint="" reference={{ source: "show" }} customFieldKey={null} />);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText(/Tier 2 · 1 of 3/)).toBeInTheDocument();
    expect(screen.getByText("At risk")).toBeInTheDocument();
    expect(screen.getByText("Expires soon")).toBeInTheDocument();
  });
  it("shows the immediate-delivery hint when provided and renders nothing when empty", () => {
    const { container } = wrap(<TierAttentionCard items={[]} hint="x" reference={{ source: "show" }} customFieldKey={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

(If `renderWithProviders` already provides a router, drop the `MemoryRouter` wrapper — check its source first.)

- [ ] **Step 5: Implement the card**

```tsx
// src/components/dashboard/TierAttentionCard.tsx
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/config/app.config";
import { formatDateDMY } from "@/lib/dates";
import { referenceLabel, type BookingFlow } from "@/lib/bookingFlow";
import type { TierAttentionItem } from "@/lib/bookingCockpit";

const MAX_ROWS = 5;

/**
 * Producer-dashboard card for offer orgs: open tiers that are under-filled or
 * have offers expiring within 24h. Pure presentational; the page owns the
 * query, derivation, and flow gating. Renders nothing without items.
 */
export function TierAttentionCard({ items, hint, reference, customFieldKey }: {
  items: TierAttentionItem[];
  hint: string;
  reference: BookingFlow["reference_field"];
  customFieldKey: string | null;
}) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">Needs attention</CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent className="space-y-2">
        {items.slice(0, MAX_ROWS).map((it) => (
          <Link
            key={`${it.showDateId}-${it.tier}`}
            to={ROUTES.BOOKINGS}
            className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors"
          >
            <div>
              <p className="text-sm font-medium">
                {referenceLabel({
                  reference,
                  show: { program: it.program, sub_program: it.subProgram },
                  custom: it.custom,
                  customFieldKey,
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateDMY(it.date)} · Tier {it.tier} · {it.filled} of {it.required}
              </p>
            </div>
            <div className="flex gap-1.5">
              {it.atRisk && <Badge variant="secondary" className="bg-warning/10 text-warning">At risk</Badge>}
              {it.expiresSoon && <Badge variant="secondary" className="bg-info/10 text-info">Expires soon</Badge>}
            </div>
          </Link>
        ))}
        {items.length > MAX_ROWS && (
          <p className="text-xs text-muted-foreground">And {items.length - MAX_ROWS} more. See Bookings.</p>
        )}
      </CardContent>
    </Card>
  );
}
```

Check `bg-warning/10 text-warning` and `bg-info/10 text-info` exist as semantic tokens (grep `text-warning` / `text-info` in `src/`); if not, reuse whatever badge classes `bookingStatusBadgeClass` in `src/lib/bookings.ts` uses for comparable states.

- [ ] **Step 6: Wire into DashboardPage**

In `ProducerDashboard` (in `src/pages/DashboardPage.tsx`):

```tsx
import { useBookingFlow, useReferenceField } from '@/hooks/useBookingFlow'; // extend existing import
import { BOOKING_FLOW_DEFAULTS } from '@/lib/bookingFlow';                 // extend existing import
import { computeTierAttention } from '@/lib/bookingCockpit';
import { deliveryHint } from '@/lib/flowCopy';
import { fetchTierAttention } from '@/data/bookings';
import { TierAttentionCard } from '@/components/dashboard/TierAttentionCard';
import { useAuth } from '@/features/auth/AuthContext'; // already imported

// inside ProducerDashboard:
const { currentOrg } = useAuth();
const orgId = currentOrg?.id ?? null;
const flow = useBookingFlow().data ?? BOOKING_FLOW_DEFAULTS;

const { data: attentionRows } = useQuery({
  queryKey: ['bookings', 'tier-attention', orgId],
  enabled: Boolean(orgId) && flow.artist_acceptance,
  queryFn: () => fetchTierAttention(supabase, { orgId, today: todayStr }),
});
const attentionItems = useMemo(
  () => computeTierAttention(attentionRows ?? [], new Date()),
  [attentionRows],
);
```

Render between the stat-card grid and the Ready-to-Confirm card:

```tsx
{flow.artist_acceptance && (
  <TierAttentionCard
    items={attentionItems}
    hint={deliveryHint(flow)}
    reference={reference}
    customFieldKey={customFieldKey}
  />
)}
```

(Existing `useAuth` usage in `DashboardPage` is `hasRole` at the top-level component; `ProducerDashboard` may not call `useAuth` yet — add the call inside `ProducerDashboard`.)

- [ ] **Step 7: Verify and commit**

`npx vitest run src/data/bookings.test.ts src/components/dashboard/ src/pages/` → PASS. tsc clean.

```bash
git add src/data/bookings.ts src/data/bookings.test.ts src/components/dashboard/TierAttentionCard.tsx src/components/dashboard/TierAttentionCard.test.tsx src/pages/DashboardPage.tsx
git commit -m "add tier attention card to producer dashboard"
```

---

### Task 7: DirectBookingCard

**Files:**
- Create: `src/components/dashboard/DirectBookingCard.tsx`
- Modify: `src/pages/DashboardPage.tsx` (confirmed-bookings query select + card wiring)
- Test: `src/components/dashboard/DirectBookingCard.test.tsx` (new)

**Interfaces:**
- Consumes: `unfilledMainCastDates` (Task 5); `deliveryHint` NOT used here; `flow` already wired in Task 6; existing `upcomingDates`/`confirmedBookings` queries in `DashboardPage.tsx:54-86`.
- Produces: `DirectBookingCard({ items, reference, customFieldKey })`, `items: Array<{ id; date; program; subProgram; mainBooked; mainSlots }>`; renders nothing when empty.

- [ ] **Step 1: Failing card test** (`src/components/dashboard/DirectBookingCard.test.tsx`, same scaffold as Task 6's card test)

```tsx
const item = { id: "d1", date: "2026-07-21", program: "TJE", subProgram: "Murder", mainBooked: 1, mainSlots: 2 };

it("lists unfilled dates with booked counts", () => {
  wrap(<DirectBookingCard items={[item]} reference={{ source: "show" }} customFieldKey={null} />);
  expect(screen.getByText("Dates needing artists")).toBeInTheDocument();
  expect(screen.getByText(/1 of 2 booked/)).toBeInTheDocument();
});
it("renders nothing when empty", () => {
  const { container } = wrap(<DirectBookingCard items={[]} reference={{ source: "show" }} customFieldKey={null} />);
  expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (module missing).

- [ ] **Step 3: Implement the card** — same structure as `TierAttentionCard` (Card > header "Dates needing artists" > up to 5 row Links to `ROUTES.BOOKINGS`), row text: `referenceLabel(...)` bold line, sub-line `` `${formatDateDMY(it.date)} · ${it.mainBooked} of ${it.mainSlots} booked` ``, overflow line `And {n} more. See Bookings.`, `MAX_ROWS = 5`, `if (items.length === 0) return null`.

- [ ] **Step 4: Wire into DashboardPage**

Extend the confirmed-bookings query select (line ~74) to include the understudy flag and keep the type in sync:

```ts
type BookingLite = { show_date_id: string; status: string; is_understudy: boolean };
// select becomes:
.select('show_date_id, status, is_understudy')
```

Add alongside `confirmedCountByDate` (which keeps counting ALL confirmed for the stat cards):

```ts
const confirmedMainByDate = (() => {
  const map = new Map<string, number>();
  (confirmedBookings ?? []).forEach(b => {
    if (!b.is_understudy) map.set(b.show_date_id, (map.get(b.show_date_id) ?? 0) + 1);
  });
  return map;
})();

const directItems = useMemo(
  () => unfilledMainCastDates(
    (upcomingDates ?? []).map(d => ({
      id: d.id, date: d.date, program: d.show?.program ?? null,
      subProgram: d.show?.sub_program ?? null, mainSlots: d.show?.main_cast_slots ?? null,
    })),
    confirmedMainByDate,
  ),
  [upcomingDates, confirmedBookings],
);
```

Render directly after the TierAttentionCard block:

```tsx
{!flow.artist_acceptance && (
  <DirectBookingCard items={directItems} reference={reference} customFieldKey={customFieldKey} />
)}
```

- [ ] **Step 5: Verify and commit**

`npx vitest run src/components/dashboard/ src/pages/` → PASS. Full `npx vitest run` → PASS. tsc clean.

```bash
git add src/components/dashboard/DirectBookingCard.tsx src/components/dashboard/DirectBookingCard.test.tsx src/pages/DashboardPage.tsx
git commit -m "add direct booking card for unfilled dates"
```

---

### Task 8: e2e notification assertion + final sweep

**Files:**
- Modify: `e2e/helpers/booking.ts` (notification lookup helper; expose artist user id from the fixture if it does not already)
- Modify: `e2e/booking-flow-presets.spec.ts` (direct test, after the `getLatestBooking` assertion at the end)
- No prod code changes.

**Interfaces:**
- Consumes: the file's existing admin-client pattern (see `getLatestBooking` in `e2e/helpers/booking.ts:237-`) and the fixture that already links `user_id: artistUser.id` (`booking.ts:75`).
- Produces: `getNotification(userId: string, type: string, relatedEntityId: string)` helper returning the newest matching notifications row or null.

- [ ] **Step 1: Read `e2e/helpers/booking.ts`.** Confirm whether the fixture return exposes the artist's auth user id; if not, add it to the fixture's returned object (e.g. `artistUserId: artistUser.id`).

- [ ] **Step 2: Add the helper** (same admin-client style as `getLatestBooking`):

```ts
export async function getNotification(userId: string, type: string, relatedEntityId: string) {
  const { data } = await admin
    .from("notifications")
    .select("id, type, title, user_id, related_entity_id")
    .eq("user_id", userId)
    .eq("type", type)
    .eq("related_entity_id", relatedEntityId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}
```

(Adapt `admin` to however `getLatestBooking` gets its client in that file.)

- [ ] **Step 3: Extend the direct test** (after `expect(booking?.status).toBe("confirmed");`):

```ts
// Phase 3: the direct INSERT itself fires the booking_confirmed in-app
// notification (DB trigger), since no offer/accept transition ever runs.
const notification = await getNotification(fixture.artistUserId, "booking_confirmed", booking!.id);
expect(notification).not.toBeNull();
```

- [ ] **Step 4: Validate what is locally validatable**

`npx tsc -p tsconfig.app.json --noEmit` → clean. `npx playwright test --config=e2e/playwright.config.ts --list` → collects without error (type/collection check; browsers do not run locally). Full `npx vitest run` and `deno test --allow-all --node-modules-dir=none supabase/functions/` → both green (proves no regressions from the branch as a whole; no edge functions changed in this plan). `npm run lint` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add e2e/helpers/booking.ts e2e/booking-flow-presets.spec.ts
git commit -m "assert direct booking notification in e2e"
```

---

## Post-plan (controller, not a task)

- Prod apply of the Task 2 migration to `epweartpzwvcasrzyueh` ONLY with the user's explicit approval; align the recorded version to the filename afterwards.
- PR, CI watch, review response, merge per standing instructions.
- Release bookkeeping (same-day fold rules apply).
