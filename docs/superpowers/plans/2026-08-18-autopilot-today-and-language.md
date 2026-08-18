# Autopilot Today page + simplified language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Milestone 3 (the language sweep) fans out cleanly one namespace per agent; Milestones 1 and 2 are sequential and share interfaces, so run those inline.

**Goal:** Replace `/dashboard` with the "Today" surface from the Autopilot prototype, rename the fast-track booking preset to **Autopilot** (digest delivery), and roll the prototype's simplified language across the whole product UI, transactional emails and Help centre.

**Architecture:** A new pure derivation module (`src/lib/autopilot/today.ts`) turns existing reads (offer tiers, bookings, show_dates, email suppression) into a single `TodayModel` of "things that need a human" plus a "done for you" feed. A thin data-access layer (`src/data/autopilot.ts`) and one hook (`useAutopilotToday`) feed a set of presentational components under `src/components/today/`. No new tables: `show_dates.cancellation_reason` / `cast_notified_at` and `suppressed_emails` already exist. Copy lives in a new typed `today` i18n namespace, and the sweep edits the existing namespaces in place.

**Tech Stack:** React 18 + TypeScript, Tailwind v3 + shadcn/ui, @tanstack/react-query v5, react-i18next, Vitest + jsdom + Testing Library, Deno for edge/email templates.

**Spec:** The Claude Design project `178c01e4-210a-4341-a18d-76c4fd02204e`, file `Autopilot Prototype.dc.html`, bound to design system `showflow-design-system-019dff72-08b4-7b0e-96d7-3d7004e1efcb`. Decisions taken with the owner on 2026-08-18 are recorded in "Owner decisions" below.

## Global Constraints

- **Semantic tokens only.** Never hardcode a colour. The prototype's literals map 1:1 onto repo tokens: `#F6F4EF`→`bg-background`, `#fff`→`bg-card`, `#15131C`→`text-foreground`, `#5B5A57`→`text-muted-foreground`, `#8B8A85`→`text-faint`, `#FAF8F4`→`bg-muted`, `#EFEDE7`→`--surface-3`, `rgba(20,18,14,.08)`→`border-border`.
- **The accent scale is immutable across modes** (`src/index.css`). The prototype uses `var(--accent-700)` for eyebrow text and `var(--accent-600)` for inline links; both are unreadable on the dark ground. Introduce ONE new semantic token `--accent-text` (light `#4738B0`, dark `#C9BCFF`) and use it for every eyebrow/inline-link in new code. Do not re-pitch `--accent-500..900`.
- **`shadow-[var(--shadow-2)]` renders nothing.** Use the named `shadow-elev1/2/3` utilities.
- **Accent numbered stops do not support Tailwind opacity modifiers.** No `bg-accent-500/20`.
- **No em or en dashes** in any user-facing copy. `src/i18n/copyLint.test.ts` enforces this, and German uses informal "Du".
- **English is the canonical i18n shape; German must match key-for-key.** `src/i18n/keyParity.test.ts` fails CI on any gap.
- **Week starts Monday** in every grid (`weekStartsOn={1}`, pad `(getDay()+6)%7`).
- **Tests import the real module.** Never re-implement production logic in a test. Data-access tests use `src/test/supabaseFake.ts`; never `vi.mock` the Supabase client.
- **`any` is banned** (`--max-warnings 0`). Use an explicit row interface + a single `as unknown as Row[]` cast at the query boundary.
- **Mirrors:** `src/lib/bookingFlow.ts` is dual-homed with `supabase/functions/_shared/bookingFlow.ts`. Edit both in the same commit; run `npm run sync:mirrors:check`.

## Owner decisions (2026-08-18)

1. **Copy sweep breadth:** everything, including transactional emails and the Help centre, EN + DE.
2. **Autopilot preset:** rename `fasttrack` to **Autopilot** and flip `offer_delivery` from `immediate` to `digest`. Existing fast-track orgs move to 19:00 asks. No fifth preset.
3. **Feed undo:** an action is undoable **only until the digest/confirmation email that carries it has gone out**. After that the row's affordance becomes **Review**. One invariant, enforced in one pure function.
4. **Today cards in pass 1:** all four (at-risk date, cancelled-cast-not-told, bounced asks, done-for-you feed).
5. **"Stuck" is rejected copy.** The state is called **"At risk"** in the eyebrow, the list state and the cast badge. This also matches the existing `at_risk_alerts` engine concept.

---

## File Structure

**New**

| Path | Responsibility |
|---|---|
| `src/lib/autopilot/today.ts` | Pure derivation: `TodayModel`, at-risk classification, feed shaping, the undo/review invariant. No React, no Supabase. |
| `src/lib/autopilot/today.test.ts` | Unit tests for the above. |
| `src/data/autopilot.ts` | `fetchCancelledUntoldDates`, `fetchBouncedAsks`, `fetchAutopilotFeed`, `setDateSlots`. Client passed as a parameter. |
| `src/data/autopilot.test.ts` | Data-access tests against `supabaseFake`. |
| `src/hooks/useAutopilotToday.ts` | Composes the reads into `TodayModel`; thin wrapper over `src/data`. |
| `src/components/today/TodayPage.tsx` | Orchestrator: header, banner, cards, empty state, feed. |
| `src/components/today/TodayHeader.tsx` | Eyebrow date, headline, sub. |
| `src/components/today/BouncedAsksBanner.tsx` | Red-tint banner, "Fix their addresses" / "Later". |
| `src/components/today/AtRiskDateCard.tsx` | Hero card: date rail, three resolution options. |
| `src/components/today/CancelledUntoldCard.tsx` | "Cancelled, cast not told" + "Tell them it is off". |
| `src/components/today/TodayEmpty.tsx` | "Nothing needs you" dashed empty state. |
| `src/components/today/DoneForYouFeed.tsx` | Activity feed with Undo/Review per the invariant. |
| `src/components/today/DateRail.tsx` | The 92px weekday/day/month/"in Nd" rail shared by both cards. |
| `src/components/layout/AutopilotStatusCard.tsx` | Sidebar module ("Autopilot on" / "How this works"). |
| `src/i18n/locales/en/today.json`, `de/today.json` | New typed namespace. |

**Modified**

| Path | Change |
|---|---|
| `src/index.css` | Add `--accent-text` (light + dark). |
| `tailwind.config.ts` | Expose `accent-text` as a colour utility. |
| `src/pages/DashboardPage.tsx` | `ProducerDashboard` → `TodayPage`; keep the artist branch and the get-running landing gate. |
| `src/components/dashboard/ArtistDashboard.tsx` | Adopt the prototype's artist copy and offer card. |
| `src/components/layout/AppLayout.tsx` | Mount `AutopilotStatusCard` in the sidebar. |
| `src/lib/bookingFlow.ts` + `supabase/functions/_shared/bookingFlow.ts` | `fasttrack.offer_delivery: "digest"`. |
| `src/i18n/react-i18next.d.ts` | Register the `today` namespace. |
| `src/i18n/config.ts` (resource wiring) | Load `today.json`. |
| `src/i18n/terms.ts` | Reword the glossary to the new vocabulary. |
| ~25 locale namespaces, EN + DE | The sweep (milestone 3). |
| 8 email templates under `supabase/functions/_shared/transactional-email-templates/` | The sweep. |
| `src/lib/help/items.ts` | The sweep (157 records, EN + DE). |

---

## Milestone 1 — Foundations and the Today surface

### Task 1: The `--accent-text` semantic token

**Files:**
- Modify: `src/index.css` (`:root` block and the `.dark` block)
- Modify: `tailwind.config.ts`

**Interfaces:**
- Produces: CSS var `--accent-text`; Tailwind utility `text-accent-text`.

- [ ] **Step 1:** In `:root`, beside the other "semantic, mode-flipping" tokens, add `--accent-text: #4738B0;  /* accent-700 in light */`.
- [ ] **Step 2:** In the `.dark` block, beside `--sidebar-accent-foreground`, add `--accent-text: #C9BCFF;  /* lifted for the dark ground; the 50-900 scale stays immutable */`.
- [ ] **Step 3:** In `tailwind.config.ts`, under `theme.extend.colors`, add `'accent-text': 'var(--accent-text)'`.
- [ ] **Step 4:** Run `npx tsc -p tsconfig.app.json --noEmit`. Expected: clean.
- [ ] **Step 5:** Commit `add accent-text semantic token for dark-safe eyebrows`.

### Task 2: The pure Today derivation

**Files:**
- Create: `src/lib/autopilot/today.ts`
- Test: `src/lib/autopilot/today.test.ts`

**Interfaces (exact — later tasks depend on these names):**

```ts
export type TodayItemKind = "at_risk" | "cancelled_untold";

export interface AtRiskDate {
  kind: "at_risk";
  showDateId: string;
  date: string;            // yyyy-mm-dd
  title: string;           // "Hamlet, Abend"
  where: string;           // "Thalia Theater, Hamburg"
  placesEmpty: number;
  daysOut: number;
  /** True when no further tier exists AND no eligible artist is left unasked. */
  exhausted: boolean;
  nextCastName: string | null;   // "Ensemble Nord"
  nextCastFreeCount: number;     // 6
  rosterCount: number;           // 14
  rosterFreeCount: number;       // 9
}

export interface CancelledUntoldDate {
  kind: "cancelled_untold";
  showDateId: string;
  date: string;
  title: string;
  where: string;
  daysOut: number;
  artistNames: string[];   // still holding the date
}

export type TodayItem = AtRiskDate | CancelledUntoldDate;

export interface BouncedAsk {
  artistId: string;
  artistName: string;
  email: string;
  showDateId: string;
  dateLabel: string;       // "Die Zauberflöte on 12 Sep"
  bouncedAt: string;       // ISO
}

export type FeedKind = "book" | "ask" | "draft" | "notify";
export type FeedAffordance = "undo" | "review";

export interface FeedRow {
  id: string;
  kind: FeedKind;
  text: string;
  at: string;              // "07:02" | "Sun 19:00"
  affordance: FeedAffordance;
}

export interface TodayModel {
  items: TodayItem[];
  bounced: BouncedAsk[];
  feed: FeedRow[];
  /** items.length + (bounced.length ? 1 : 0) — drives the headline and nav badge. */
  openCount: number;
  fillingOnTheirOwn: number;
  bookedOvernight: number;
}

export function computeToday(input: TodayInput, now: Date): TodayModel;

/**
 * The undo invariant. An action is reversible only while the email that
 * carries it has not yet been sent. `emailedAt` non-null => "review".
 * A digest-delivery org also loses undo once `now` passes the digest hour
 * on the action's own day.
 */
export function feedAffordance(
  row: { emailedAt: string | null; actedAt: string },
  flow: { offer_delivery: "digest" | "immediate" },
  times: { offerDigestHour: number },
  now: Date,
): FeedAffordance;
```

- [ ] **Step 1: Write the failing tests.** Cover, at minimum:
  - `feedAffordance` returns `"review"` when `emailedAt` is non-null, regardless of clock.
  - `feedAffordance` returns `"undo"` for a digest org when `now` is before the digest hour on the action's day, and `"review"` once past it.
  - `feedAffordance` returns `"review"` immediately for an `immediate`-delivery org (the mail is already gone).
  - The digest boundary is evaluated in **Europe/Berlin**, not local time (an action at 20:00 UTC on the 17th is already past a 19:00 Berlin digest).
  - `computeToday` marks a date `exhausted: true` only when there is no unopened tier AND no unasked eligible artist.
  - `computeToday` excludes a cancelled date whose `cast_notified_at` is set.
  - `computeToday` excludes a cancelled date that has no confirmed or soft-booked artists (nobody to tell).
  - `openCount` counts the bounced banner once, not once per bounced ask.
  - Items sort by date ascending.
- [ ] **Step 2:** Run `npx vitest run src/lib/autopilot/today.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `src/lib/autopilot/today.ts`. Reuse `showSlots` from `src/lib/settings.ts` and `parseDateOnly`/`toDateKey` from `src/lib/dates.ts` for timezone safety. Berlin-anchor the digest boundary with the `en-CA` `Intl.DateTimeFormat` trick already used in `src/lib/bookingCockpit.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `add pure Today derivation for the autopilot board`.

### Task 3: Data access

**Files:**
- Create: `src/data/autopilot.ts`
- Test: `src/data/autopilot.test.ts`

**Interfaces:**
- Consumes: the row shapes from Task 2.
- Produces:
```ts
export async function fetchCancelledUntoldDates(
  client: SupabaseClient<Database>, args: { orgId: string | null; today: string },
): Promise<CancelledUntoldInput[]>;

export async function fetchBouncedAsks(
  client: SupabaseClient<Database>, args: { orgId: string | null; today: string },
): Promise<BouncedAsk[]>;

export async function fetchAutopilotFeed(
  client: SupabaseClient<Database>, args: { orgId: string | null; since: string },
): Promise<FeedInput[]>;

/** "Run the show with 1 fewer": narrows a single date's required places. */
export async function setDateSlots(
  client: SupabaseClient<Database>, args: { showDateId: string; mainCast: number },
): Promise<void>;
```

- [ ] **Step 1:** Write failing tests with `supabaseFake` asserting the exact table, columns, filters and org scoping for each function. Assert `fetchCancelledUntoldDates` filters `status = 'cancelled'`, `cast_notified_at is null`, `date >= today`, `org_id = orgId`. Assert `fetchBouncedAsks` joins `suppressed_emails` to artists with a `suggested` booking on an upcoming date and is org-scoped explicitly (RLS does not narrow it — ADR-0003).
- [ ] **Step 2:** Run `npx vitest run src/data/autopilot.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. One explicit row `interface` per query plus a single `as unknown as Row[]` cast right after the error check.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `add autopilot data access`.

### Task 4: The `today` i18n namespace

**Files:**
- Create: `src/i18n/locales/en/today.json`, `src/i18n/locales/de/today.json`
- Modify: `src/i18n/react-i18next.d.ts`, `src/i18n/config.ts` (or wherever resources are assembled)

- [ ] **Step 1:** Author `en/today.json` with every string from the prototype's Today view, verbatim where the design gives one. Keys grouped `header.*`, `atRisk.*`, `cancelled.*`, `bounced.*`, `empty.*`, `feed.*`, `sidebar.*`.
- [ ] **Step 2:** Author `de/today.json` key-for-key, informal "Du", reusing `TERMS` for domain nouns, no dashes.
- [ ] **Step 3:** Register the namespace in `react-i18next.d.ts` and the resource map.
- [ ] **Step 4:** Run `npx vitest run src/i18n/keyParity.test.ts src/i18n/copyLint.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `add today i18n namespace`.

### Task 5: Presentational components

**Files:**
- Create: the eight files under `src/components/today/` listed in File Structure.
- Test: `src/components/today/TodayPage.test.tsx`

Fidelity notes taken straight off the prototype — match these:
- Page: `max-width: 920px`, `flex-col`, `gap: 20px`, main padding `28px 32px`.
- Eyebrow: 11px / 600 / uppercase / `letter-spacing: 1.6px` / `text-accent-text`.
- H1: 32px / 600 / `-0.6px`.
- Hero at-risk card: `rounded-[14px]`, `border-border`, `shadow-elev3`; every other card `shadow-elev2` or none.
- Date rail: 92px wide, `bg-amber-100` for at-risk / `bg-accent-50` for cancelled, weekday eyebrow, 28px mono day, month, `in Nd` in mono 10px.
- Resolution options: first is `bg-muted` with a primary "Do this"; the others are bordered with a secondary button.
- Feed rows: 20px tinted circle icon, 13px text, mono timestamp, text-button affordance.
- Empty state: dashed border, 40px green circle with a check, 22px headline.

- [ ] **Step 1:** Write `TodayPage.test.tsx` covering: renders the at-risk headline for 2 open items; renders the empty state at 0; renders the bounced banner only when bounces exist; a feed row past its digest shows "Review" and one before shows "Undo". **Do not** put `getByRole` with a `name` inside `findBy*`/`waitFor` (slow query starves the poll loop — known flake source); query by role once, outside the retry.
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Build the components against the fidelity notes, tokens only.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit `add today board components`.

### Task 6: Wire the route and the sidebar module

**Files:**
- Modify: `src/pages/DashboardPage.tsx`, `src/components/layout/AppLayout.tsx`
- Create: `src/components/layout/AutopilotStatusCard.tsx`
- Modify: `src/hooks/useAutopilotToday.ts` consumers

- [ ] **Step 1:** Replace the `ProducerDashboard` body with `<TodayPage />`, keeping the artist branch and the one-time get-running landing gate exactly as they are.
- [ ] **Step 2:** Mount `AutopilotStatusCard` in the sidebar above the user block. Producer/admin copy: "Autopilot on / Asks go out at 19:00. A yes becomes a booking. Contracts draft when a date fills. / Take it off autopilot". Artist copy: "How this works / You get asked by email. A yes books you on the spot, no confirming afterwards. / Block dates you cannot play". Derive the sentence from the live flow, never from the preset name.
- [ ] **Step 3:** Run `npx vitest run` and `npx tsc -p tsconfig.app.json --noEmit`.
- [ ] **Step 4:** Verify in the browser at both themes (see Verification).
- [ ] **Step 5:** Commit `replace dashboard with the autopilot today board`.

### Task 7: The artist view

**Files:**
- Modify: `src/components/dashboard/ArtistDashboard.tsx` and its four existing test files.

- [ ] **Step 1:** Update the tests to the new copy first ("Can you do this one?", "Yes, I can do it", "No, not this one", the decline reassurance line, "Die Zauberflöte, 12 September is yours").
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Restyle the offer card to the prototype: accent-200 border, `shadow-elev3`, 92px accent-50 date rail, 19px title, the "Answer by Wed 19:00" mono amber deadline.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `adopt the autopilot artist offer card`.

---

## Milestone 2 — The Autopilot preset

### Task 8: Rename fast-track and flip it to digest

**Files:**
- Modify: `src/lib/bookingFlow.ts`, `supabase/functions/_shared/bookingFlow.ts`
- Modify: `src/i18n/locales/{en,de}/settingsBookingFlow.json`
- Test: the existing `src/lib/bookingFlow.test.ts` and the Deno mirror test.

- [ ] **Step 1:** Add a failing test asserting `BOOKING_FLOW_PRESETS.fasttrack.offer_delivery === "digest"` and that `matchPreset` still round-trips an Autopilot flow to `"fasttrack"`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Flip the field in **both** homes. Change `flowPresets.names.fasttrack` to "Autopilot" (EN) and "Autopilot" (DE — a loanword here, so it stays).
- [ ] **Step 4:** Run `npx vitest run`, `deno test --allow-all supabase/functions/`, `npm run sync:mirrors:check`.
- [ ] **Step 5:** Commit `rename fast-track to autopilot and deliver its asks by digest`.

**Note for the executor:** the preset key stays `fasttrack` in the database and in `PresetName`. Only the label and one field change. Renaming the key would orphan every stored `booking_flow_template` row.

---

## Milestone 3 — The language sweep

Ordered by traffic so each commit is independently shippable. For every namespace: change EN, mirror the key set into DE, then run `keyParity` + `copyLint`.

### Task 9: Shared registries
`src/i18n/terms.ts`, `src/i18n/locales/*/flowCopy.json`, `common.json` nav.
- `hold` → "Waiting on you"; `softBooked` → "Said yes, waiting on you"; `tierLadder` → "Who this date asks"; `responseWindow` → "Answer by"; `digest` → "Daily send"; `hireOrder` → "Contract"; `blockedDate` → "Not free".
- `nav.hireOrders` → "Contracts"; `nav.dashboard` → "Today"; `nav.bookings` → "Dates".
- `statusLabels.offer.*` → Asked / Said yes, waiting on you / Booked / Not asked yet / Cancelled.
- [ ] Steps: edit EN, mirror DE, run `npx vitest run src/i18n`, commit.

### Task 10: High-traffic namespaces
`showsDetail.json` (137 hits), `bookings.json`, `availability.json`, `bookingCopy.json`, `dashboard.json`.
- [ ] Steps: per file, edit EN, mirror DE, run the full unit suite (component tests assert on this copy and will surface every miss), fix, commit per namespace.

### Task 11: Setup and settings namespaces
`onboarding.json`, `getRunning.json`, `settingsBookingFlow.json`, `settingsCastsCoverage.json`, `settingsHireOrders.json`, `hireOrdersPages.json`, `productions.json`, `artists.json`, `settingsAirtable.json`, `settingsRolesRights.json`, `settingsSkills.json`, and the small remainder.
- [ ] Steps: same loop, commit per namespace.

### Task 12: Transactional emails
`artist-offer-digest.tsx`, `offer-immediate.tsx`, `offer-expiry-reminder.tsx`, `artist-confirmation-digest.tsx`, `tier-at-risk.tsx`, `cast-escalation-requested.tsx`, `hire-order-issued.tsx`, `hire-order-countersigned.tsx`.
- Subject lines and bodies move to the ask/said-yes/booked/contract vocabulary. The offer digest is the template the owner flagged as changing with Autopilot: it must read as "the asks that went out tonight", with the answer deadline as "Answer by <weekday> 19:00".
- [ ] Steps: update each template plus its co-located test, run `deno test --allow-all supabase/functions/`, commit per template.

### Task 13: Help centre
`src/lib/help/items.ts` (157 records, EN + DE co-located).
- [ ] Steps: sweep in one pass, run `npx vitest run src/lib/help src/i18n`, commit.

---

## Verification

Run before claiming done:

```bash
npm run verify:fast
```

Browser verification is mandatory and must cover **both themes**:
1. `preview_start` the dev server against the LOCAL stack (`npm run local:up` first; `npm run dev` targets local by design).
2. Load `/dashboard`. Screenshot light.
3. `resize_window` with `colorScheme: "dark"`, reload, screenshot dark.
4. Confirm with `javascript_tool` that no eyebrow resolves to `#4738B0` in dark (it must be `#C9BCFF` via `--accent-text`).
5. Check `read_console_messages` for errors.

## Self-review notes

- **Spec coverage:** the prototype's Today view, artist view and sidebar module are covered by Tasks 5-7. The prototype's **Dates** view (list/month/season lenses) and the **day-one 3-question setup** are deliberately NOT in this plan: the former belongs to the in-flight calendar initiative, and the latter conflicts head-on with the `/get-running` board shipped in #320. Both are flagged to the owner as open forks rather than silently built.
- **Undo scope:** the invariant in Task 2 is the whole of decision 3. Row-level undo handlers reuse existing mutations (`bulkDeclineSoftBooked` to unbook, `closeOfferTier` to un-ask); no new reversal backend is introduced.
- **Risk:** Task 8 changes behaviour for any org already on fast-track (immediate to digest). That is the owner's explicit instruction, recorded above.
