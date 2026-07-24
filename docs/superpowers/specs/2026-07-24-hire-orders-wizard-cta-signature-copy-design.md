# Hire orders: wizard duration fill, CTA system, agent signature, editable PDF copy — Design

Date: 2026-07-24
Status: Draft for review
Follows: PR #194 (the `terms_variant` constraint hotfix — already shipped and live)

## Context

This is "Spec 2" from the 2026-07-24 request. The bugfix (part 1) shipped first and
separately in PR #194. This spec covers the remaining five workstreams, which the user
asked to plan together in one spec:

- **A. Wizard duration "copy to all dates"** (part 2)
- **B. Hire-order CTA system** (part 3) — four placements sharing one banner component
- **C. Partial-success** on already-covered dates in multi-date creation (the deferred half of part 1's "also add partial-success")
- **D. Agent signature** — one uploadable image per org, rendered on issued PDFs (part 4)
- **E. Editable PDF copy** — every string in the hire-order PDF editable per org, with live preview (part 5)

All five are behind the existing `hire_orders` entitlement (default OFF) and the
`generate_hire_orders` / `issue_hire_orders` capabilities. Nothing here changes who may
use hire orders; it changes what they can do once enabled.

## Goals / non-goals

Goals: make multi-date creation fast (A, C), discoverable (B), and the document fully
brandable (D, E), reusing existing infrastructure wherever possible.

Non-goals:
- Multiple named agents each with a signature (D is **one image per org**).
- A freeform/WYSIWYG PDF document builder (E is **structured per-string overrides**, not layout editing).
- Changing the booking/confirmation flow or the fill-status computation.
- "Preview terms" in the banner (explicitly dropped by the user).

---

## A. Wizard: "Copy duration to all dates" (per-row)

### Today
`NewOrderWizard` step 3 (linked/multi-date mode) renders one bordered group per assigned
date (`src/components/hireOrders/NewOrderWizard.tsx:840-887`), each with its own
**Duration (minutes)** `Input` bound to `dateSchedules[dateId].durationMin` via
`setDateDuration(dateId, value)` (`:849-854`, `:387-389`). There is no bulk control.

### Design (user's choice: per-row, "copy to all" appears once a value is entered)
Under each date's duration input, when that date's `durationMin` is a non-blank, valid
number, render a small inline affordance: a `Button variant="link" size="sm"` labeled
**"Copy to all dates"**. Clicking it writes that date's `durationMin` into every OTHER
assigned date's schedule (a new `copyDurationToAll(sourceDateId)` helper that maps over
`dateSchedules` and sets each entry's `durationMin`). Each date remains independently
editable afterward.

Details:
- The affordance is hidden when only one date is assigned (nothing to copy to), when the
  value is blank, or when the value is not a finite number (mirror `parseDurationValue`).
- After a copy, show a brief `toast.success("Applied {n} min to {m} dates")` for feedback,
  or a transient inline "Applied to all dates" text — pick the toast (consistent with the
  rest of the wizard's `sonner` usage).
- Accessibility: the link gets `aria-label={`Copy ${label}'s duration to all dates`}`.
- No wire-format change: the per-date `date_overrides` diff in `buildDateOverrides()`
  already emits each changed date's `duration_min`; copying just pre-fills the same state,
  so overrides are produced exactly as if the producer typed each one.

### Wireframe (step 3, linked mode)
```
Each date starts from its synced running order. Edit a date to override just that date.

┌ 31 Jul · Rudolf-Steiner-Haus · Berlin ─────────────────────┐
│ Duration (minutes)                                          │
│ [ 90                    ]                                    │
│ ↳ Copy to all dates        ← link; appears once 90 is typed │
│                                                             │
│ Sessions                                                    │
│ [Label (optional)] [19:00]  🗑                              │
│ ＋ Add session                                               │
└─────────────────────────────────────────────────────────────┘
┌ 01 Aug · Rudolf-Steiner-Haus · Berlin ─────────────────────┐
│ Duration (minutes)                                          │
│ [ 90                    ]   ← filled by "Copy to all dates"  │
│ ↳ Copy to all dates                                         │
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

### Tests
- `engagementDates`/wizard: unit test `copyDurationToAll` sets every other date's
  `durationMin` and leaves sessions untouched (pure helper, extract it so it's testable
  without rendering).
- Component test: entering a duration reveals the link; clicking it fills the others;
  the link is absent with one date and with a blank/NaN value.

---

## B. Hire-order CTA system

Four placements sharing one reusable banner. Global gating rule (user's choice):
**buttons are disabled when the `hire_orders` feature is off**; the aggregate banner
(B1) is hidden when off (a disabled "0 dates" banner is noise). Everywhere, the manage
gate is `canManage` (admin/producer) and the action gate is `useCan("generate_hire_orders")`.

### B0. Reusable `HireOrderReadyBanner` (new component)
`src/components/hireOrders/HireOrderReadyBanner.tsx`. Matches the user's screenshot: a
soft-violet rounded card, a left icon tile, a title + one line of subcopy, and a primary
button on the right. **No "Preview terms."** Props:
```ts
interface HireOrderReadyBannerProps {
  title: string;            // e.g. "This date is fully filled — ready for a hire order"
  description: string;      // subcopy, artist-name-aware
  ctaLabel: string;         // "Generate hire order" | "Generate hire orders"
  onCta: () => void;
  disabled?: boolean;       // feature off / capability off / pending
  icon?: ReactNode;         // defaults to a hire-order glyph
}
```
Styling uses semantic + accent tokens only (no hardcoded colors). It renders in the
`ShowDateDetailSheet` (single-date copy) and `ShowBookingsPage` (aggregate copy) with
different text.

### B1. ShowBookingsPage — aggregate banner above the table → opens the wizard
Above the table (below the header at `src/pages/ShowsBookingsPage.tsx:272-278`), render
`HireOrderReadyBanner` when the feature is ON and ≥1 currently-visible date is
`fully_filled` with no active hire order:
- title: `"{n} dates are fully filled — ready for hire orders"` (singular for n=1).
- description: `"Create the orders to confirm the engagements and send them for countersignature."`
- CTA "Generate hire orders" → opens `NewOrderWizard` inline (mount it on this page; pull
  `currentOrg` from the existing `useAuth()` call to pass `orgId`).
- Hidden entirely when feature off or n=0.

Readiness data: add `fetchDatesReadyForHireOrder(client, orgId)` in `src/data/hireOrders.ts`
(+ a `useDatesReadyForHireOrder` hook) that returns the count/ids of `show_dates` with
`status = 'fully_filled'` that have no non-void `hire_orders` row (legacy `show_date_id`
or via `hire_order_dates`). Reuse in B2 to avoid N queries.

### B2. ShowBookingsPage — per-row status-column flip → single-date generate
In the dates table/list, when a row's date is `fully_filled` and has no active order, the
Hire-order cell shows an inline **"Generate hire order"** CTA (`Button size="sm"`, ghost/
outline). It triggers the single-date `draft` action for that `show_date_id` (mirrors
`HireOrdersCard.handleGenerate` → `action.mutate({ action: "draft", org_id, show_date_id })`).
Once an active order exists, the cell shows a compact status chip instead
("Order drafted" / "Order issued" / "Countersigned") using `HireOrderStatusBadge`. When the
feature is off the CTA is disabled; when not fully-filled the cell shows "—".

Reuses the B1 readiness set (map keyed by `show_date_id`) plus per-date order status so the
table renders without a query per row.

### B3. ShowDateDetailSheet — top CTA → single-date generate
Near the sheet header, a "Generate hire order" `Button` shown when the date is
`fully_filled` and unordered (disabled when feature off). Same single-date `draft` action.
Purely a discoverability shortcut to the section below.

### B4. ShowDateDetailSheet — HireOrdersCard banner upgrade
Replace the existing plain banner in `ProducerHireOrders`
(`src/components/shows/hireOrders/HireOrdersCard.tsx:138-153`) with `HireOrderReadyBanner`,
single-date variant:
- title: `"This date is fully filled — ready for a hire order"` (fully-filled) or
  `"Generate for confirmed artists"` (partially, existing behavior).
- description: artist-name-aware — for a single confirmed artist,
  `"Generate the order to confirm the engagement and send it to {artistName} for countersignature."`
  (`artistName` = the single `confirmed[0].artist?.name`; for multiple confirmed artists use
  `"…send it to the confirmed cast for countersignature."`).
- CTA "Generate hire order" → the existing `handleGenerate()` (`draft` action).

### Wireframes
ShowBookingsPage (aggregate banner + per-row flip):
```
Shows & Bookings                                             [ New date ]
All scheduled dates and cast status in one place.

┌──────────────────────────────────────────────────────────────────────────┐
│ ✦  3 dates are fully filled — ready for hire orders        [ Generate     │
│    Create the orders to confirm the engagements and send      hire orders ]│
│    them for countersignature.                                              │
└──────────────────────────────────────────────────────────────────────────┘

[search…]  [filters]                                        [ list | grid ]

Date        Show / cast              Cast status        Hire order
31 Jul      Murder · Lead(1/1)       ● Fully filled     [＋ Generate hire order]
22 Jul      Murder · Lead(1/1)       ● Fully filled     ✓ Order issued
09 Jun      Murder · Lead(2/3)       ◐ 2 / 3 filled     —
```
ShowDateDetailSheet (top CTA + section banner):
```
┌ 31 Jul · Rudolf-Steiner-Haus ───────────────────  [Generate hire order] ✕ ┐
│ ... schedule / cast / bookings ...                                         │
│                                                                            │
│ Hire orders                                                                │
│ ┌────────────────────────────────────────────────────────────────────┐   │
│ │ ✦ This date is fully filled — ready for a hire order   [ Generate   │   │
│ │   Generate the order to confirm the engagement and       hire order ]│   │
│ │   send it to Max Mustermann for countersignature.                    │   │
│ └────────────────────────────────────────────────────────────────────┘   │
│ (existing order list appears here once orders exist)                       │
└────────────────────────────────────────────────────────────────────────────┘
```

### Tests
- `HireOrderReadyBanner`: renders title/description/CTA; disabled state; no "Preview terms".
- `fetchDatesReadyForHireOrder`: data-access test with `supabaseFake` (fully_filled minus
  active-order dates; excludes void orders and aggregate-child-covered dates).
- ShowBookingsPage: aggregate banner appears only when feature on and count>0; per-row cell
  flips to CTA when fully-filled/unordered and to a chip once an order exists.
- ShowDateDetailSheet: top CTA visibility + gating; banner upgrade renders the artist name.

---

## C. Partial-success on already-covered dates (multi-date)

### Today
`create_hire_order_with_dates` calls `assert_hire_order_dates_available`, which raises
`active hire order already covers a selected date` if **any** selected date is covered.
`draftBatch` maps that to `skipped: [{artist_id, reason:"exists"}]` for the whole artist —
so one covered date blocks that artist's entire aggregate order.

### Design
1. **Edge pre-filter (`draftBatchArtist`)**: before calling the RPC, query the artist's
   already-covered dates within the org (a non-void `hire_orders` row whose `show_date_id`
   or `hire_order_dates.show_date_id` intersects the requested set). Remove those from the
   artist's date list; create the aggregate for the remainder. If **all** are covered, skip
   the artist (`reason: "exists"`, unchanged). Report dropped dates.
2. **Response shape**: extend the per-artist outcome so a created order can carry
   `skipped_dates: string[]` (the covered dates that were dropped). `DraftBatchResult` stays
   `{created, skipped, errors}` but each `created` entry can be reported with its dropped
   dates; the wizard surfaces `toast.warning("Created for 2 of 3 dates; 1 date already had an order")`.
3. **Wizard step-1 pre-flag**: in the assignment matrix, mark an artist×date cell that is
   already covered (a subtle "has order" badge/disabled state), computed from
   `useDatesReadyForHireOrder` + per-artist order coverage, so the producer sees it before
   submit. This is the UI half that makes the silent drop visible.
4. **Race safety**: the RPC's internal `assert_hire_order_dates_available` remains the
   backstop — if a date gets covered between the pre-filter and the insert, the RPC still
   raises and that artist reports `exists` (rare, acceptable).

### Tests
- Edge DI: an artist with 1 of 3 dates covered → order created for 2 dates, `skipped_dates`
  reports the 1; an artist with all covered → skipped; the RPC backstop still returns
  `exists` on a mid-flight conflict.
- Wizard: covered cells render the flag; the summary toast reflects partial creation.

---

## D. Agent signature — one image per org, on issued PDFs

### What exists to reuse
The PDF renderer already draws a signature **image** via react-pdf
`<Image src={imageDataUrl}>` for the artist's drawn countersignature
(`supabase/functions/_shared/hire-order-pdf/render.tsx:531-542`), and the `sign` action
already validates a base64 PNG (magic-byte check + size cap) and stores it in the
`hire-orders` storage bucket. The producer/agent side of the signature block currently
renders only a blank ruled line (`render.tsx:524-529`). There is **no** client-side image
upload anywhere in the app today — this is the first.

### Design
**Storage of the setting**: add `agent_signature_path: string | null` to the
`hire_order_letterhead` app-setting (frontend `Letterhead` type + edge
`HireOrderLetterhead`, kept in their existing dual-home). The image bytes live in the
`hire-orders` bucket at `${org}/agent-signature.png` (org-folder scoped, same bucket the
storage RLS already isolates by org).

**Upload flow** (new edge action, reusing the sign action's PNG handling): add
`upload-agent-signature` to `generate-hire-orders` — admin-gated (`requireOrgRole(org_id,
['admin'])`, since the letterhead card is admin-managed) + `requireFeature`. It accepts a
base64 PNG, validates (`data:image/png;base64,` prefix, magic bytes, size cap — reuse the
`sign` constants), uploads to `${org}/agent-signature.png` (`upsert: true`), writes
`agent_signature_path` into the `hire_order_letterhead` setting, and returns a signed URL
for immediate preview. A companion `remove-agent-signature` (or a null upload) clears it.

**Settings UI** (`LetterheadCard`): add an "Agent signature" row under agent name/email — a
file picker (PNG only) → reads the file as a base64 data URL → calls the upload action →
shows the returned image as a preview with a "Remove" button. Follows the card's existing
save/resolve pattern; the image itself round-trips through the edge action, never a direct
client storage write (the bucket has no client INSERT policy).

**Render at issue time**: `issueOne`/`previewOrder` resolve the letterhead as today; when
`agent_signature_path` is set, fetch the PNG from storage, base64-encode it to a data URL,
and pass it to the renderer. Extend `RenderInput`/letterhead with an optional
`agent_signature_data_url`; in `render.tsx` the producer signature block renders
`<Image src={agent_signature_data_url}>` above the ruled line when present (mirrors the
artist `sigMarkImage` path/style), else the current blank line. The frozen `issue_snapshot`
letterhead should capture the resolved signature so the countersigned re-render reproduces
it (same pattern as the rest of the snapshot).

**Security**: PNG-only + magic-byte validation + size cap (reuse `MAX_SIGNATURE_PNG_CHARS`);
org-scoped path; admin-gated; the shared bucket's org-isolation RLS already applies. The
signature is the org's own authorized-signatory mark applied to its own documents — not a
third party's — so there's no cross-tenant exposure.

### Tests
- Edge DI: `upload-agent-signature` validates PNG, rejects non-PNG/oversize, stores at the
  org path, writes the setting; non-admin → 403; feature off → gated.
- Render: producer block renders `<Image>` when `agent_signature_data_url` present, blank
  line when absent (pure render assertion on the doc tree).
- Settings: `LetterheadCard` upload → preview → remove round-trip (component test with a
  faked action).

---

## E. Editable PDF copy — every string, structured, with live preview

### Today
Every label/heading/boilerplate string is hardcoded in `render.tsx` (fully enumerated in
the code map: title block, parties, facts strip, engagement-dates/running-order sections,
fees, terms heading, signatures, watermark, footer, certificate page). Only letterhead and
terms clauses are org-configurable.

### Design
**A keyed copy dictionary with defaults.** Introduce `HIRE_ORDER_COPY_DEFAULTS`, a flat
`Record<CopyKey, string>` of every static string (~40 keys), grouped by document section,
dual-homed like the other hire-order shared code (`src/lib/hireOrders/pdfCopy.ts` +
byte-identical `supabase/functions/_shared/…`). Interpolated strings become **token
templates** with `{{token}}` placeholders (e.g. `booking_agent: "Booking agent: {{agent_name}}"`,
`facts_dates_count: "{{count}} dates"`, `signed_electronically: "Signed electronically · {{date}}"`).
A small `applyTokens(template, values)` helper (shared, tested) does the substitution; the
allowed token set per key is fixed and documented in the registry.

**Per-org overrides.** New app-setting `hire_order_copy`: a partial
`Record<CopyKey, string>` of overrides. `resolveHireOrderCopy(defaults, overrides)` merges
override-over-default per key (empty/absent → default). The renderer replaces every literal
with `copy.<key>` (or `applyTokens(copy.<key>, values)`), so `render.tsx` reads all text
from the resolved copy object passed in `RenderInput`.

**Settings UI** (`PdfCopyCard`, new card in `HireOrdersTab`): every key rendered as an
editable field grouped under section headings, prefilled with the current effective value,
each with a "Reset to default" affordance and inline help showing available `{{tokens}}`.
A **"Preview"** button renders the watermarked PDF using the current (unsaved) copy — reuse
the existing `preview` action, extended to accept an ad-hoc copy override so the preview
reflects edits before saving. House rule enforced in help text + a soft validator: no
em/en dashes in copy.

**Freeze at issue.** The resolved copy is captured into `issue_snapshot` alongside
letterhead/terms/currency, so a countersigned re-render reproduces the exact issued wording
even if the org later edits its copy.

### Scope note
This is a real refactor of `render.tsx` (every literal → a keyed lookup) plus a new setting,
a resolver, a token helper, a settings card, and a preview path. It is the largest of the
five and should be the last implemented. It does not change layout — only text.

### Tests
- `resolveHireOrderCopy` + `applyTokens`: merge precedence, token substitution, unknown
  token safety, em-dash validator.
- Dual-home byte-equality test (like the existing terms/entitlements mirrors).
- Render: with an override, the PDF tree shows the overridden string; defaults otherwise.
- Edge `preview`: honors an ad-hoc copy override; `issue` freezes copy into the snapshot.
- Settings: `PdfCopyCard` edit + reset-to-default + preview (component test).

---

## Data model & migrations summary
- **A, B, C (UI + edge)**: no schema change (C changes the edge response shape + adds a
  query; the pre-filter reads existing tables).
- **D**: no new table; `agent_signature_path` lives inside the existing `hire_order_letterhead`
  JSON app-setting; bytes in the existing `hire-orders` bucket. No migration unless we choose
  to add a bucket policy (not needed — service-role writes, existing org-scoped read RLS).
- **E**: no schema change; `hire_order_copy` is another `app_settings` key.

So Spec 2 is **migration-light** (likely none required); most risk is in the `render.tsx`
refactor (E) and the new upload flow (D).

## Testing plan (layers)
Unit/data (Vitest + `supabaseFake`) for helpers, data-access, and components; Deno DI for
the edge actions (`upload-agent-signature`, partial-success `draft-batch`, `preview` copy
override, `issue` snapshot); render assertions for D/E; a dual-home byte-equality test for
the copy registry. Test-first per repo convention.

## Rollout / versioning
All behind `hire_orders` (default OFF) — ships dark by default. Deliver in the order
**A → B → C → D → E** (independent, increasing risk), each its own PR. Fold changelog into
whatever version is current on ship day (same-day convention); these are user-facing
features so a MINOR bump applies when they land on a new day. Update `docs/system-map.md`
only if the automation graph changes (D adds no trigger; C/E don't either).

## Open decisions (please confirm during review)
1. **A** — after "Copy to all dates", confirm feedback via a toast (vs. silent). Recommend toast.
2. **B2** — per-row "Generate hire order" fires the draft immediately with a toast, vs.
   opening the detail sheet first. Recommend immediate draft (fast path) + toast; the row
   then shows the status chip. Confirm.
3. **B** — banner copy wording (titles/subcopy above) — confirm or tweak.
4. **D** — accept storing `agent_signature_path` inside `hire_order_letterhead` (vs. a
   dedicated `hire_order_agent_signature` key). Recommend inside letterhead (it's letterhead
   data). Also confirm admin-only (vs. producer with capability).
5. **E** — token syntax `{{token}}` and the fixed allowed-token set per key; and whether the
   preview must reflect unsaved edits (recommend yes).
6. Sequencing — confirm A→B→C→D→E, each its own PR, or a different grouping.
