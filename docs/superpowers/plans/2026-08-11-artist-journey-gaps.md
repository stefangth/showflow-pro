# Artist Journey Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 15 artist-facing journey gaps (R0.2–R5.4) with point-of-action copy, empty states, and two email fixes, so an artist always knows what a control does, what happens next, and when.

**Architecture:** Pure copy/UI changes reusing existing flow/settings helpers. Four disjoint-file work packages run as one parallel wave (no DB, no migration). New narration is a pure helper beside the producer's `actionCopy.ts`; email copy flows through the mirrored `emailCopy.ts` source.

**Tech Stack:** React 18 + TS, Tailwind semantic tokens, Vitest + jsdom + `renderWithProviders`, Deno tests for edge email templates, `@tanstack/react-query`.

**Spec:** `docs/superpowers/specs/2026-08-11-artist-journey-gaps-design.md` · **Approved visual:** https://claude.ai/code/artifact/42e2b69d-5d4d-4dc9-b641-a2f70f9c2173

## Global Constraints

- **No em- or en-dashes** in any user-facing string (middot `·` and arrows `→` are fine).
- **Honest in every reachable org state:** direct-book (`artist_acceptance:false`), immediate delivery, digest, paused (`active:false`), unentitled, and super-admin preview. When a surface can render for an unentitled org, gate promises on the REAL entitlement (`useEntitlements()` + `!isLoading`), never `useFeature` (fails open while loading, bypasses for super-admins) or the flow `active` flag.
- **Semantic tokens only;** accent numbered stops take no opacity modifiers.
- **Extract, don't hardcode:** read hours via `useFlowTimes`, flow via `useBookingFlow`; reuse `describeTonightStandalone`, `SOFT_BOOKED_MEANING`. Email copy edits go in `src/lib/emailTemplates/emailCopy.ts` then `npm run sync:mirrors` — never hand-edit `_shell/emailCopy.ts`.
- **No version bump / changelog** (owner packages the release).
- **TDD:** failing test first; tests import the real module; use `src/test/supabaseFake.ts` / `renderWithProviders` / `castHelpers`.
- **Commit per task** on branch `claude/artist-items-journey-gaps-f181d5`.

## File Structure

| Work package | Files touched |
|---|---|
| WP-R1 availability/calendar | `src/pages/AvailabilityPage.tsx`, `src/components/availability/ArtistAvailabilityCalendar.tsx` (+ tests) |
| WP-R2 offer moment/dashboard | `src/lib/bookings/actionCopy.ts`, `src/components/availability/OfferResponseButtons.tsx`, `src/lib/flowCopy.ts`, `src/components/dashboard/ArtistDashboard.tsx` (+ tests) |
| WP-R3 profile/hire/cancel/delete | `src/pages/ProfilePage.tsx`, `src/components/artists/ArtistProfileSheet.tsx`, `src/components/hireOrders/SignHireOrderDialog.tsx`, `src/components/bookings/ArtistBookingsView.tsx` (+ tests) |
| WP-R4 emails | `src/lib/emailTemplates/emailCopy.ts`, `supabase/functions/_shared/transactional-email-templates/artist-confirmation-digest.tsx`, `.../app-links.test.ts`, `.../org-invitation.test.ts` |

The four WPs touch disjoint files. `flowCopy.ts` is edited only by WP-R2; WP-R1 only reads it. R5.1's signpost lives in the artist-only `ArtistBookingsView`, not the shared cockpit.

**After the wave:** one authoritative `npx tsc -p tsconfig.app.json --noEmit` + full `npx vitest run` + `npm run sync:mirrors:check`, because new module exports / props can break a consumer or `vi.mock` outside a WP's file list (producer-session lesson).

---

## WP-R1 — Availability & calendar

### Task 1: Timing line — response window + digest hour on the availability page (R2.1 + R4.7)

**Files:**
- Modify: `src/pages/AvailabilityPage.tsx` (render a muted timing line under the blocking help text near line 419-421)
- Test: `src/pages/AvailabilityPage.flowCopy.test.tsx`

**Interfaces:**
- Consumes: `useFlowTimes(orgId)` → `{ windowHours, offerDigestHour, confirmationDigestHour }` (`src/hooks/useBookingFlow.ts`); `useBookingFlow()` → `BookingFlow`; `describeTonightStandalone(times, flow)` (`src/lib/bookings/timingCopy.ts`) → `string | null`.
- Produces: nothing new; a rendered line only.

- [ ] **Step 1: Write the failing test** — assert the digest-org artist sees the number, and a direct-book org does not.

```tsx
// in AvailabilityPage.flowCopy.test.tsx, following the file's existing render harness
it("shows the response window and digest hour for an offer+digest org", async () => {
  renderAvailabilityPage({ flow: { artist_acceptance: true, offer_delivery: "digest", active: true } });
  expect(await screen.findByText(/48 hours to answer/i)).toBeInTheDocument();
  expect(screen.getByText(/19:00 digest/i)).toBeInTheDocument();
});

it("shows no timing line for a direct-book org", async () => {
  renderAvailabilityPage({ flow: { artist_acceptance: false, active: true } });
  expect(screen.queryByText(/hours to answer/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify it fails** — `npx vitest run src/pages/AvailabilityPage.flowCopy.test.tsx` → FAIL (text not found).
- [ ] **Step 3: Implement** — in `AvailabilityPage.tsx`, read `const times = useFlowTimes(orgId); const tonight = describeTonightStandalone(times, flow);` and render, only when non-null, below the existing blocking paragraph:

```tsx
{tonight && (
  <p className="text-xs text-muted-foreground mt-1">{tonight}</p>
)}
```

Use the page's existing `orgId`/`flow`. Mirror `FirstOfferCard`'s org-scope discipline (`orgId ? flow : null`) so a null-org never narrates the platform default.

- [ ] **Step 4: Run and verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(availability): surface response window + digest hour to artists (R2.1/R4.7)"`

### Task 2: Ineligible-cell explanation + zero-eligible empty state (R3.4 + R3.5)

**Files:**
- Modify: `src/components/availability/ArtistAvailabilityCalendar.tsx` (ineligible branch ~230-232; empty-state guard at top of `CardContent` ~148-154)
- Test: `src/components/availability/ArtistAvailabilityCalendar.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it("labels an ineligible day with why it is disabled", () => {
  render(<ArtistAvailabilityCalendar eligibleDates={[/* one eligible date only */]} .../>);
  const cell = screen.getByRole("button", { name: /this date is not offered to you/i });
  // OR, since ineligible cells are non-interactive divs, query by title:
  expect(document.querySelector('[title="This date is not offered to you. Offered dates come from your casts."]')).toBeTruthy();
});

it("shows an empty state when there are zero eligible dates", () => {
  render(<ArtistAvailabilityCalendar eligibleDates={[]} .../>);
  expect(screen.getByText(/no eligible dates yet\. once you are added to a cast/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify it fails** — `npx vitest run src/components/availability/ArtistAvailabilityCalendar.test.tsx` → FAIL.
- [ ] **Step 3: Implement**
  - Ineligible branch (currently `return <div key={dateStr}>{cell}</div>`): add attributes so screen readers and hover both explain it:

```tsx
if (!isEligible) {
  return (
    <div
      key={dateStr}
      title="This date is not offered to you. Offered dates come from your casts."
      aria-label="This date is not offered to you. Offered dates come from your casts."
    >
      {cell}
    </div>
  );
}
```

  - Empty state at the top of `CardContent`, before the weekday grid:

```tsx
{eligibleDates.length === 0 && (
  <p className="text-sm text-muted-foreground mb-4">
    No eligible dates yet. Once you are added to a cast, offered dates appear here.
  </p>
)}
```

  Keep the existing grid render intact below (blocked-only artists still see their blocks); the empty line just names the state.

- [ ] **Step 4: Run and verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(availability): explain disabled dates + zero-eligible empty state (R3.4/R3.5)"`

### Task 3: Blocking does not affect existing bookings (R3.6)

**Files:**
- Modify: `src/pages/AvailabilityPage.tsx:419-421` (blocking help paragraph)
- Test: `src/pages/AvailabilityPage.blockPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("tells the artist existing bookings are unaffected by blocking", async () => {
  renderAvailabilityPage({ /* offer flow */ });
  expect(await screen.findByText(/dates you are already booked for are not affected/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify it fails** — `npx vitest run src/pages/AvailabilityPage.blockPicker.test.tsx` → FAIL.
- [ ] **Step 3: Implement** — replace the paragraph text:

```
Mark dates you cannot play so the system will not send you offers for them. Dates you are already booked for are not affected.
```

- [ ] **Step 4: Run and verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(availability): note blocking leaves existing bookings untouched (R3.6)"`

---

## WP-R2 — The offer moment & dashboard

### Task 4: `acceptConsequenceNote` helper (R3.1 core)

**Files:**
- Modify: `src/lib/bookings/actionCopy.ts` (add helper + type beside `confirmConsequenceNote`)
- Test: `src/lib/bookings/actionCopy.test.ts`

**Interfaces:**
- Produces: `acceptConsequenceNote(flow: AcceptFlow | null | undefined): { title: string; description?: string }` where `type AcceptFlow = Pick<BookingFlow, "producer_confirmation">`.

- [ ] **Step 1: Write the failing test**

```ts
import { acceptConsequenceNote } from "./actionCopy";

it("hold-then-confirm flow tells the artist a hold is placed", () => {
  expect(acceptConsequenceNote({ producer_confirmation: true })).toEqual({
    title: "Offer accepted",
    description: "Hold placed. Your producer confirms next.",
  });
});

it("auto-confirm flow tells the artist they are booked", () => {
  expect(acceptConsequenceNote({ producer_confirmation: false })).toEqual({
    title: "Offer accepted. You're booked.",
  });
});

it("defaults to hold-then-confirm when the flow is unknown", () => {
  expect(acceptConsequenceNote(null).description).toBe("Hold placed. Your producer confirms next.");
});
```

- [ ] **Step 2: Run and verify it fails** — `npx vitest run src/lib/bookings/actionCopy.test.ts` → FAIL (not exported).
- [ ] **Step 3: Implement** — append to `actionCopy.ts`:

```ts
/** The flow field that decides what accepting an offer does. */
type AcceptFlow = Pick<BookingFlow, "producer_confirmation">;

/**
 * What accepting an offer actually does, said at the toast. Mirrors the accept branch of
 * respondToOffer: producer_confirmation true soft-books (a hold, producer confirms next);
 * false confirms instantly. Undefined reads as the classic hold flow (respondToOffer's own
 * `?? true` default), so an unknown flow never over-promises "you're booked".
 */
export function acceptConsequenceNote(flow: AcceptFlow | null | undefined): {
  title: string;
  description?: string;
} {
  const holds = flow?.producer_confirmation ?? true;
  return holds
    ? { title: "Offer accepted", description: "Hold placed. Your producer confirms next." }
    : { title: "Offer accepted. You're booked." };
}
```

- [ ] **Step 4: Run and verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(bookings): acceptConsequenceNote for the offer-accept toast (R3.1)"`

### Task 5: Wire accept/decline toasts (R3.1 + R3.2)

**Files:**
- Modify: `src/components/availability/OfferResponseButtons.tsx:37-41`
- Test: create `src/components/availability/OfferResponseButtons.test.tsx`

**Interfaces:**
- Consumes: `acceptConsequenceNote` (Task 4); the component's existing `useBookingFlow()` + `respondToOffer`.

- [ ] **Step 1: Write the failing test** — render with the `renderWithProviders` harness + a `supabaseFake` that returns `affected: 1`; click Accept in a hold-flow org and assert the toast copy; click Decline and assert the reassurance.

```tsx
it("accept toast tells a hold-flow artist the producer confirms next", async () => {
  // seed flow producer_confirmation:true; render <OfferResponseButtons bookingId="b1" />
  await userEvent.click(screen.getByRole("button", { name: /accept/i }));
  expect(await screen.findByText(/hold placed\. your producer confirms next/i)).toBeInTheDocument();
});

it("decline toast reassures about future offers", async () => {
  await userEvent.click(screen.getByRole("button", { name: /decline/i }));
  expect(await screen.findByText(/will not affect future offers/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify it fails** — `npx vitest run src/components/availability/OfferResponseButtons.test.tsx` → FAIL.
- [ ] **Step 3: Implement** — replace the success-toast block:

```tsx
if (accept) {
  const note = acceptConsequenceNote(flow);
  toast({ title: note.title, description: note.description });
} else {
  toast({
    title: "Offer declined",
    description: "This just cancels this one offer. It will not affect future offers.",
  });
}
```

  Import `acceptConsequenceNote` from `@/lib/bookings/actionCopy`. Leave the `autoConfirm` mutation logic untouched (the helper reads the same `flow`).

- [ ] **Step 4: Run and verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(availability): flow-aware accept + decline toasts (R3.1/R3.2)"`

### Task 6: Response-rate meter definition (R4.2)

**Files:**
- Modify: `src/lib/flowCopy.ts` (`MeterSpec` + `artistMeter`), `src/components/dashboard/ArtistDashboard.tsx:202-204` (render explainer)
- Test: `src/lib/flowCopy.test.ts`, `src/components/dashboard/ArtistDashboard.flowCopy.test.tsx`

**Interfaces:**
- Produces: `MeterSpec.explainer: string`.

- [ ] **Step 1: Write the failing tests**

```ts
// flowCopy.test.ts
it("offer meter explains what counts and that no one is scored", () => {
  expect(artistMeter({ artist_acceptance: true } as BookingFlow).explainer)
    .toBe("Counts dates you accepted or were booked for, out of dates you were offered. It is just for you, no one is scored on it.");
});
it("direct-book meter explains the booked/eligible ratio", () => {
  expect(artistMeter({ artist_acceptance: false } as BookingFlow).explainer)
    .toBe("Dates you are booked for, out of dates you are eligible for.");
});
```

```tsx
// ArtistDashboard.flowCopy.test.tsx — extend the existing meter test
expect(screen.getByText(/no one is scored on it/i)).toBeInTheDocument();
```

- [ ] **Step 2: Run and verify it fails** — `npx vitest run src/lib/flowCopy.test.ts src/components/dashboard/ArtistDashboard.flowCopy.test.tsx` → FAIL.
- [ ] **Step 3: Implement**
  - Add `explainer: string;` to `MeterSpec`.
  - In `artistMeter`, direct-book branch: `explainer: "Dates you are booked for, out of dates you are eligible for.",`; offer branch: `explainer: "Counts dates you accepted or were booked for, out of dates you were offered. It is just for you, no one is scored on it.",`
  - In `ArtistDashboard.tsx`, after the footer paragraph (line 202-204), add:

```tsx
<p className="text-xs text-muted-foreground mt-2">{meter.explainer}</p>
```

- [ ] **Step 4: Run and verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): define what the response-rate meter counts (R4.2)"`

### Task 7: Hire-orders card zero-state (R4.6)

**Files:**
- Modify: `src/components/dashboard/ArtistDashboard.tsx:257-306`
- Test: `src/components/dashboard/ArtistDashboard.hireOrders.test.tsx`

- [ ] **Step 1: Update the failing test** — the current test locks in "no empty card"; change it to assert the empty state renders when the module is on and the list is empty, and that NOTHING renders when the module is off.

```tsx
it("shows a hire-orders zero-state when the module is on and there are no orders", () => {
  featureHolder.enabled = true; // hire_orders on
  render(<ArtistDashboard /* myHireOrders: [] */ />);
  expect(screen.getByText(/your booking paperwork shows up here/i)).toBeInTheDocument();
});
it("renders no hire-orders card when the module is off", () => {
  featureHolder.enabled = false;
  render(<ArtistDashboard /* myHireOrders: [] */ />);
  expect(screen.queryByText(/your booking paperwork/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/your hire orders/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify it fails** — `npx vitest run src/components/dashboard/ArtistDashboard.hireOrders.test.tsx` → FAIL.
- [ ] **Step 3: Implement** — change the outer predicate from `hireOrdersEnabled && (myHireOrders?.length ?? 0) > 0` to `hireOrdersEnabled` and branch inside `CardContent`:

```tsx
{hireOrdersEnabled && (
  <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Your hire orders
      {(myHireOrders?.length ?? 0) > 0 && <Badge>{myHireOrders!.length}</Badge>}
    </CardTitle></CardHeader>
    <CardContent className="space-y-2">
      {(myHireOrders?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          Your booking paperwork shows up here. When a producer sends you a hire order, it arrives by email and you can review and sign it here.
        </p>
      ) : (
        myHireOrders!.map((o) => (/* existing row markup unchanged */))
      )}
    </CardContent>
  </Card>
)}
```

- [ ] **Step 4: Run and verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(dashboard): hire-orders card zero-state introduces the flow (R4.6)"`

---

## WP-R3 — Profile, hire-order signing, cancelling, deletion

### Task 8: Contact-visibility note (R4.4)

**Files:**
- Modify: `src/pages/ProfilePage.tsx` (under the contact/Details fields), `src/components/artists/ArtistProfileSheet.tsx:241` (adjoin the existing "Separate from the login account." helper)
- Test: `src/pages/ProfilePage.notifications.test.tsx` (or a new `ProfilePage.identity.test.tsx`), `src/components/artists/ArtistProfileSheet.capabilities.test.tsx`

- [ ] **Step 1: Write the failing tests** — assert the note text renders on the profile page, and on the producer sheet.

```tsx
// ProfilePage
expect(screen.getByText(/admins and producers in your organization can see the contact details on your artist record/i)).toBeInTheDocument();
```

- [ ] **Step 2: Run and verify it fails** — `npx vitest run src/pages/ProfilePage.notifications.test.tsx` → FAIL.
- [ ] **Step 3: Implement**
  - ProfilePage, under the Details card contact fields:

```tsx
<p className="text-xs text-muted-foreground">
  Admins and producers in your organization can see the contact details on your artist record so they can reach you about bookings.
</p>
```

  - ArtistProfileSheet, beside line 241's helper, add a second line:

```tsx
<p className="text-xs text-muted-foreground">Visible to admins and producers in this organization.</p>
```

- [ ] **Step 4: Run and verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(profile): state who can see an artist's contact details (R4.4)"`

### Task 9: Hire-order terms summary + after-signing (R4.5)

**Files:**
- Modify: `src/components/hireOrders/SignHireOrderDialog.tsx` (add a summary line above the signature pad; DO NOT change `CONSENT_TEXT`)
- Test: `src/components/hireOrders/SignHireOrderDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("summarizes the terms and what happens after signing", () => {
  render(<SignHireOrderDialog open .../>);
  expect(screen.getByText(/you are agreeing to the fee, dates, and terms shown on this order/i)).toBeInTheDocument();
  expect(screen.getByText(/countersigns and emails you the final pdf/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify it fails** — `npx vitest run src/components/hireOrders/SignHireOrderDialog.test.tsx` → FAIL.
- [ ] **Step 3: Implement** — inside the dialog body, above `<SignaturePad>`:

```tsx
<p className="text-sm text-muted-foreground">
  You are agreeing to the fee, dates, and terms shown on this order. After you sign, your organization countersigns and emails you the final PDF.
</p>
```

- [ ] **Step 4: Run and verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(hire-orders): summarize terms + after-signing for the artist (R4.5)"`

### Task 10: Cancel-after-confirm signpost (R5.1)

**Files:**
- Modify: `src/components/bookings/ArtistBookingsView.tsx` (under the subtitle, inside the existing `booking_flow` `ModuleGate`)
- Test: `src/components/bookings/ArtistBookingsView.flowCopy.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("signposts how to cancel a confirmed date", async () => {
  renderArtistBookingsView({ /* offer flow */ });
  expect(await screen.findByText(/need to cancel a date you confirmed\? message your producer in the date's chat/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify it fails** — `npx vitest run src/components/bookings/ArtistBookingsView.flowCopy.test.tsx` → FAIL.
- [ ] **Step 3: Implement** — add under the subtitle (line 174-177 region):

```tsx
<p className="text-xs text-muted-foreground mt-1">
  Need to cancel a date you confirmed? Message your producer in the date's chat and they will update the booking.
</p>
```

- [ ] **Step 4: Run and verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(bookings): signpost how an artist cancels a confirmed date (R5.1)"`

### Task 11: Account-deletion disposition (R5.4)

**Files:**
- Modify: `src/pages/ProfilePage.tsx:233-236` (delete-account card body; hire-orders clause gated by `useFeature('hire_orders')`)
- Test: `src/pages/ProfilePage.delete.test.tsx`

- [ ] **Step 1: Write the failing tests** — with `hire_orders` on, the hire-orders sentence shows; with it off, only the offers clause shows.

```tsx
it("names open offers, and hire orders when the module is on", () => {
  renderProfilePage({ hireOrders: true });
  expect(screen.getByText(/including any open offers, is kept but de-identified/i)).toBeInTheDocument();
  expect(screen.getByText(/signed hire orders are kept for the organization's records/i)).toBeInTheDocument();
});
it("omits the hire-orders sentence when the module is off", () => {
  renderProfilePage({ hireOrders: false });
  expect(screen.queryByText(/signed hire orders are kept/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify it fails** — `npx vitest run src/pages/ProfilePage.delete.test.tsx` → FAIL.
- [ ] **Step 3: Implement** — replace the card body paragraph and add a gated sentence (read `const hireOrdersEnabled = useFeature('hire_orders');`):

```tsx
<p className="text-sm text-muted-foreground">
  Permanently delete your account. Your personal details are removed. Your shared booking history, including any open offers, is kept but de-identified. This cannot be undone.
  {hireOrdersEnabled ? " Signed hire orders are kept for the organization's records with your details removed." : ""}
</p>
```

- [ ] **Step 4: Run and verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(profile): deletion copy names offers + hire orders (R5.4)"`

---

## WP-R4 — Invitation & digest emails

### Task 12: Artist invitation role lines (R0.2 + R0.3)

**Files:**
- Modify: `src/lib/emailTemplates/emailCopy.ts:188` (`roleIntroArtist`) and `:197` (`roleIntroArtistOffers`), then `npm run sync:mirrors`
- Test: `supabase/functions/_shared/transactional-email-templates/org-invitation.test.ts` (Deno), `src/lib/emailTemplates/emailCopy.test.ts` (Vitest)

- [ ] **Step 1: Update the failing tests** — the existing artist tests (org-invitation.test.ts ~234-296) assert the default line stays flow-neutral and the offers line carries the benefit. Update expectations to the new strings; add an assertion that the flow-neutral line does NOT promise emailed offers.

```ts
// org-invitation.test.ts
assertStringIncludes(defaultArtistLine, "You are on the roster.");
assert(!defaultArtistLine.includes("email")); // flow-neutral line makes no offer promise
assertStringIncludes(offersArtistLine, "booking offers by email, accept or decline each in one tap");
```

- [ ] **Step 2: Run and verify it fails** — `deno test --allow-all supabase/functions/_shared/transactional-email-templates/org-invitation.test.ts` → FAIL.
- [ ] **Step 3: Implement** — in `emailCopy.ts` source:
  - `roleIntroArtist`: `"You are on the roster. You get booked for shows and can see every confirmed engagement."`
  - `roleIntroArtistOffers`: `"You are on the roster. You will get booking offers by email, accept or decline each in one tap, then see every confirmed engagement."`
  - Run `npm run sync:mirrors` to regenerate `_shell/emailCopy.ts`.

- [ ] **Step 4: Run and verify it passes** — `deno test ...org-invitation.test.ts` and `npx vitest run src/lib/emailTemplates/emailCopy.test.ts` → PASS; `npm run sync:mirrors:check` clean.
- [ ] **Step 5: Commit** — `git commit -am "feat(email): artist invite states roster + offers-by-email benefit (R0.2/R0.3)"`

### Task 13: Confirmation-digest CTA (R5.3)

**Files:**
- Modify: `src/lib/emailTemplates/emailCopy.ts` (add `artist-confirmation-digest.ctaLabel`), then `npm run sync:mirrors`; `supabase/functions/_shared/transactional-email-templates/artist-confirmation-digest.tsx`; `.../app-links.test.ts`
- Test: `.../app-links.test.ts` (Deno)

- [ ] **Step 1: Update the failing test** — move `"artist-confirmation-digest"` out of the excluded set into `APP_LINK_TEMPLATES`, and set `hasCta: true` for it, so the contract test now demands a CTA to the app host.
- [ ] **Step 2: Run and verify it fails** — `deno test --allow-all supabase/functions/_shared/transactional-email-templates/app-links.test.ts` → FAIL (no cta rendered).
- [ ] **Step 3: Implement** — in `artist-confirmation-digest.tsx`:
  - Add `import { APP_URL } from "../app-url.ts";` and `const BOOKINGS_URL = ${APP_URL}/bookings;` (template literal).
  - Pass `cta={{ href: BOOKINGS_URL, label: copy["artist-confirmation-digest.ctaLabel"] }}` to `<EmailShell>`.
  - Add copy key in `emailCopy.ts` source beside the other `artist-confirmation-digest.*` keys: `"artist-confirmation-digest.ctaLabel": "View your bookings",` then `npm run sync:mirrors`.

- [ ] **Step 4: Run and verify it passes** — `deno test ...app-links.test.ts` → PASS; `npm run sync:mirrors:check` clean.
- [ ] **Step 5: Commit** — `git commit -am "feat(email): confirmation digest links back to bookings (R5.3)"`

---

## Post-wave verification (run once, after all tasks)

- [ ] `npm run sync:mirrors:check` — clean (email copy mirror in sync).
- [ ] `npx tsc -p tsconfig.app.json --noEmit` — clean (new `MeterSpec.explainer`, `acceptConsequenceNote` export, any new prop reached every consumer, e.g. no other `MeterSpec` builder left without `explainer`).
- [ ] `npx vitest run` — full suite green (catches any sibling `vi.mock` of `actionCopy`/`flowCopy`/dashboard that a new export broke).
- [ ] `deno check --node-modules-dir=none supabase/functions/_shared/transactional-email-templates/artist-confirmation-digest.tsx` — edge runtime typecheck.
- [ ] `npm run verify:fast` then `npm run verify:full` (pgTAP + Playwright) — green.
- [ ] Update `docs/research/user-journey-gaps-context.md` Artist status table + the browsable artifact; update memory `user-journey-questions-research.md`.

## Self-review

- **Spec coverage:** R0.1 (covered, no task) · R0.2/R0.3 → T12 · R2.1/R4.7 → T1 · R3.1 → T4+T5 · R3.2 → T5 · R3.4/R3.5 → T2 · R3.6 → T3 · R4.2 → T6 · R4.4 → T8 · R4.5 → T9 · R4.6 → T7 · R5.1 → T10 · R5.3 → T13 · R5.4 → T11. All 15 covered.
- **Type consistency:** `acceptConsequenceNote` returns `{title, description?}` in T4 and is consumed with `.title`/`.description` in T5. `MeterSpec.explainer` added in T6 and rendered in T6. No name drift.
- **Placeholder scan:** every copy string is literal; no "TBD"/"handle edge cases".
