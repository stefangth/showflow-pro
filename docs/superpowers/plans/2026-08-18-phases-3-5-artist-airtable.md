# Get Running Phases 3–5 (screens 08 / 09 / 11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three remaining "Get running" redesign surfaces — the artist Availability first-run (08), the artist Account page (09), and the Airtable connect rail (11) — faithfully to the imported claude.ai design.

**Architecture:** Three independent surfaces, one branch (`claude/phases-3-5-artist-airtable-95cf7b`), one commit each.
- **08** reworks `AvailabilityPage` chrome: a one-step "Your setup" progress card + a single "Block what you cannot play" task strip that retires once a date is blocked + a read-only "How booking works here" rules card, wrapped around the *existing* `CalendarSurface` + blocked-dates surface. No board (an artist has one step).
- **09** restructures the shared `ProfilePage` into the four-group settings-row pattern (Details / Sign-in / What reaches you / Your data) plus an artist-only Reference + Language sidebar. The notification matrix becomes role-aware: artists no longer see the two producer-only categories.
- **11** turns the Airtable connect into a board-context 4-step rail (11b) that collapses to a compact 4-group summary (11a), rendered inside the Get-running `dates` task panel. The Settings `AirtableSyncTab` console is left untouched (its restructure belongs to the deferred 05/06 Settings work).

**Tech Stack:** React 18 + TS, Tailwind v3 + shadcn/ui, react-query v5, react-i18next (EN+DE), vitest + jsdom + @testing-library/react, `renderWithProviders` + `supabaseFake`.

**Spec:** `docs/superpowers/specs/2026-08-17-setup-settings-design/SPEC.md` (§5.5, screens 08/09/11) and the pixel references `docs/superpowers/specs/2026-08-17-setup-settings-design/screens/screen_08_08_Artist_first_run.html`, `screen_09_09_Artist_account.html`, `screen_11_11_Airtable_connect.html`.

## Global Constraints

- **i18n:** every new string via `t()` in the right namespace, **EN and DE in the same change** (informal "Du", **no em/en dashes** — use period/comma/colon/middot). CI gates: `src/i18n/keyParity.test.ts` (DE must match EN key-for-key) and `src/i18n/copyLint.test.ts` (no dashes, Du). Reuse `src/i18n/terms.ts` `TERMS` for domain terms (e.g. Engagementvertrag, Tagesübersicht).
- **Styling:** semantic tokens only (`bg-background`/`bg-card`/`bg-muted`/`text-foreground`/`text-muted-foreground`/`border-border`); `#6E5CF6`→`bg-primary`, accent scale `bg-accent-50..900` (**no `/opacity` modifiers on accent stops**); shadows `shadow-elev1..4`; radius keys `var(--radius-l)`/`var(--radius-xl)`. Badges use existing `Badge` variants (`confirmed`/`neutral`/`accent`/`risk`), never invented `amber-*` utilities; inline amber = `bg-[var(--amber-100)] text-[var(--amber-600)]`.
- **Roles:** `producer` displays as "Production Team" via `roleLabel()`/`ROLE_LABELS`; compare the literal `'producer'` only. Role checks via `useAuth().hasRole(ROLES.X)`.
- **Tests import the real module.** Never re-implement production logic in a test. Pure model first (TDD), then data-access via `supabaseFake`, then components via `renderWithProviders`.
- **Capability/entitlement gating preserved:** `booking_flow` gates the artist calendar/eligibility; `hire_orders` gates the paperwork footer line + hire-orders notification row; `language_packages` gates the language switcher; `configure_airtable`/`trigger_sync` gate the Airtable writes.
- **Verification gate:** each commit must pass `npm run verify:fast` (lint `--max-warnings 0`, `tsc -p tsconfig.app.json`, `tsc -p tsconfig.tools.json`, build, `vitest run --coverage`, deno check). Visually verify each screen on the LOCAL dev stack before its commit.
- **Owner decisions locked (2026-08-18):** (a) artist notification matrix — **remove** `booking_activity` and `at_risk` rows entirely (not dim); (b) all three screens on one branch, three commits; (c) omit the "Find a setting ⌘K" box on screen 09.
- **Help center:** screens 08/09 change what an artist would ask; update `src/lib/help/items.ts` (EN+DE) or state "No help center impact" with reason in the PR.

---

## Phase A — Screen 08: Artist Availability first-run

**Design:** `screen_08_08_Artist_first_run.html`. Artist route `/availability`. No board. Header (eyebrow + headline + body) with a 236px "Your setup · 0 of 1 done" card; one task strip "Block what you cannot play" [Block dates]; a read-only "How booking works here" three-column rules card; the live dates surface (existing `CalendarSurface`) + blocked-dates card; a hire-orders footer line. Edge cases kept: booking engine off → one line, no strip/rules/calendar; artist not linked → `UnlinkedArtistCard` (unchanged).

**Existing code (do not re-derive):**
- `src/pages/AvailabilityPage.tsx` — `ArtistAvailability()` renders header + `<PageMini page="availability"/>` + `CalendarSurface` (or `emptyAll`) + a blocked-dates `Card`. `if (!artist)` → `<UnlinkedArtistCard/>`. `bookingFlowEnabled = useFeature('booking_flow')`. Block mutations `addBlock`/`removeBlock` are inline; the block `<form>` uses a `<select aria-label={t('blocked.selectAriaLabel')}>` picker.
- `src/hooks/useMyBlockedDatesCount.ts` → `useMyBlockedDatesCount(artistId)` (key `['blocked-dates','count',artistId]`).
- `src/components/setup/useRailDismissed.ts` → `useRailDismissed(namespace, orgId): [dismissed, dismiss, undismiss]`.
- `src/hooks/useBookingFlow.ts` (`useBookingFlow`), `useFlowTimes`, `describeTonightStandalone` — already imported by the page for flow-aware wording.
- i18n namespace `availability`, files `src/i18n/locales/{en,de}/availability.json`. New keys go under a `firstRun.*` group.

**Files:**
- Create: `src/components/availability/AvailabilityFirstRun.tsx` — the new chrome (progress card + task strip + rules card + hire-orders footer). Pure presentational; receives its data as props.
- Create: `src/components/availability/AvailabilityFirstRun.test.tsx`
- Modify: `src/pages/AvailabilityPage.tsx` — mount `<AvailabilityFirstRun/>`, add the booking-off single-line branch, pass a scroll-target ref to the block form.
- Modify: `src/i18n/locales/en/availability.json` and `src/i18n/locales/de/availability.json` — add `firstRun.*`.
- Modify: `src/pages/AvailabilityPage.calendar.test.tsx` if a rendered-count assertion shifts (only if it breaks).

**Interfaces:**
- Produces: `AvailabilityFirstRun` React component with props:
  ```ts
  interface AvailabilityFirstRunProps {
    orgName: string;            // currentOrg?.name ?? '' — used in eyebrow + rules attribution
    blockedCount: number;       // useMyBlockedDatesCount → drives "N of 1 done" + strip retirement
    hireOrdersEnabled: boolean;  // useFeature('hire_orders') → footer line
    /** flow-aware rules copy inputs */
    artistAcceptance: boolean;   // flow.artist_acceptance → "offers by email" vs "direct book"
    digestLabel: string;         // e.g. "19:00" from flow times; falls back to design default
    windowHours: number;         // response window hours (default 48)
    onBlockDates: () => void;    // scrolls to + focuses the block-date picker
  }
  ```

### Task A1: Notification-free pure helper — the "done" rule (no new module needed)

The step-done rule is trivial (`blockedCount > 0`), computed inline; no separate module. Skip straight to the component test.

### Task A2: `AvailabilityFirstRun` component — progress card + task strip

- [ ] **Step 1: Write the failing test** — `src/components/availability/AvailabilityFirstRun.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import userEvent from "@testing-library/user-event";
import i18n from "@/i18n";
import { AvailabilityFirstRun } from "./AvailabilityFirstRun";

const base = {
  orgName: "Nordstadt Produktionen",
  hireOrdersEnabled: true,
  artistAcceptance: true,
  digestLabel: "19:00",
  windowHours: 48,
  onBlockDates: () => {},
};

function renderRun(props: Partial<React.ComponentProps<typeof AvailabilityFirstRun>>) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AvailabilityFirstRun {...base} blockedCount={0} {...props} />
    </I18nextProvider>,
  );
}

test("shows the one-task strip and 0 of 1 when nothing is blocked", () => {
  renderRun({ blockedCount: 0 });
  expect(screen.getByText(i18n.t("availability:firstRun.task.title"))).toBeInTheDocument();
  expect(screen.getByText(/0/)).toBeInTheDocument();
});

test("retires the strip once a date is blocked, keeping the rules card", () => {
  renderRun({ blockedCount: 2 });
  expect(screen.queryByText(i18n.t("availability:firstRun.task.title"))).not.toBeInTheDocument();
  // rules card is reference and always shows
  expect(screen.getByText(i18n.t("availability:firstRun.rules.heading"))).toBeInTheDocument();
});

test("Block dates button calls onBlockDates", async () => {
  const onBlockDates = vi.fn();
  renderRun({ blockedCount: 0, onBlockDates });
  await userEvent.click(screen.getByRole("button", { name: i18n.t("availability:firstRun.task.cta") }));
  expect(onBlockDates).toHaveBeenCalled();
});

test("hires-orders footer line only shows when hire orders are on", () => {
  const { rerender } = renderRun({ blockedCount: 0, hireOrdersEnabled: false });
  expect(screen.queryByText(i18n.t("availability:firstRun.hireOrdersFooter"))).not.toBeInTheDocument();
  rerender(
    <I18nextProvider i18n={i18n}>
      <AvailabilityFirstRun {...base} blockedCount={0} hireOrdersEnabled />
    </I18nextProvider>,
  );
  expect(screen.getByText(i18n.t("availability:firstRun.hireOrdersFooter"))).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/components/availability/AvailabilityFirstRun.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Add the i18n keys** to `src/i18n/locales/en/availability.json` under a new `firstRun` object, and the mirrored DE in `de/availability.json`. EN values (DE = informal "Du" translations, no dashes):

```jsonc
"firstRun": {
  "eyebrow": "{{org}} · your calendar",
  "headline": "One thing here is yours, and it takes two minutes",
  "body": "Block the dates you cannot play. They come off the list before anyone books you, so you only hear about dates that work. Everything else on this page is set by the org.",
  "setup": {
    "label": "Your setup",
    "progress": "{{done}} of 1 done",
    "hint": "An empty calendar is a valid answer. Opening this page counts it as done."
  },
  "task": {
    "title": "Block what you cannot play",
    "blocksNothing": "Blocks nothing",
    "body": "Blocked dates come off the list before anyone books you, so you only hear about dates that work.",
    "cta": "Block dates"
  },
  "rules": {
    "heading": "How booking works here",
    "setBy": "Set by {{org}}. You cannot change these.",
    "eligibilityTitle": "Eligibility comes from your cast",
    "eligibilityBody": "A date appears when a cast you are in is eligible for it and you hold every required skill.",
    "offersTitle": "Offers arrive by email",
    "offersBody": "One digest at {{time}}, never a mail per date. Accepting soft books you until a producer confirms.",
    "offersBodyDirect": "You are booked directly, so there is nothing to accept.",
    "windowTitle": "You have {{hours}} hours to answer",
    "windowBody": "After that the offer expires and goes to the next tier."
  },
  "hireOrdersFooter": "Hire orders are on. You sign in the browser and the countersigned PDF lands in your mail.",
  "bookingOff": "Dates do not run in ShowFlow for this org, so there is nothing to set here."
}
```

- [ ] **Step 4: Implement `AvailabilityFirstRun`** — build the three blocks per the design HTML (lines 66–155 of `screen_08_08_Artist_first_run.html`). Structure:
  - Header row: `flex items-start gap-6`. Left column: eyebrow (`text-[11px] font-semibold uppercase tracking-[1.6px] text-accent-600`), `<h1>` headline, body. Right: the 236px "Your setup" card (`bg-card border border-border rounded-[var(--radius-l)] p-3.5`) with `{{done}} of 1 done` where `done = Math.min(blockedCount, 1)` and one tick segment filled when done.
  - Task strip — render only when `blockedCount === 0`: `border border-accent-300 bg-card rounded-[var(--radius-l)] p-4 shadow-elev2`, ring dot, title + a `Badge variant="neutral"` "Blocks nothing", body, and a `<Button>` (`onBlockDates`) "Block dates".
  - Rules card — always render: header row (`bg-muted`) "How booking works here" + right-aligned `rules.setBy`; three equal columns (eligibility / offers / window). Use `artistAcceptance ? offersBody : offersBodyDirect`, `time: digestLabel`, `hours: windowHours`.
  - Hire-orders footer line — render only when `hireOrdersEnabled`: muted `file-signature` icon + `hireOrdersFooter`.

- [ ] **Step 5: Run test to verify it passes** — `npx vitest run src/components/availability/AvailabilityFirstRun.test.tsx` → PASS.

- [ ] **Step 6: Commit is deferred to the end of Phase A (after wiring).**

### Task A3: Wire `AvailabilityFirstRun` into `AvailabilityPage` + booking-off branch

**Files:** Modify `src/pages/AvailabilityPage.tsx`.

- [ ] **Step 1: Add a scroll target + handler.** Add `const blockFormRef = useRef<HTMLFormElement>(null);` and `const focusBlockForm = () => { blockFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); blockFormRef.current?.querySelector("select")?.focus(); };` Attach `ref={blockFormRef}` to the existing block `<form>`.

- [ ] **Step 2: Add the booking-off branch.** After the `if (!artist)` guard, add:
```tsx
if (!bookingFlowEnabled) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[32px] font-semibold tracking-tight">{pageCopy.title}</h1>
        <p className="text-muted-foreground mt-1">{pageCopy.subtitle}</p>
      </div>
      <p className="text-sm text-muted-foreground">{t("firstRun.bookingOff")}</p>
    </div>
  );
}
```
(Confirm `bookingFlowEnabled` is in scope at that point; it is declared at line ~59.)

- [ ] **Step 3: Mount `AvailabilityFirstRun`** between the page `<h1>` block and `<PageMini>` (replace the plain header block with the first-run header — keep `<PageMini page="availability"/>` below it since the SPEC keeps page minis). Wire props:
```tsx
const { data: blockedCount = 0 } = useMyBlockedDatesCount(artist?.id ?? null);
// ...
<AvailabilityFirstRun
  orgName={currentOrg?.name ?? ""}
  blockedCount={blockedCount}
  hireOrdersEnabled={hireOrdersEnabled}
  artistAcceptance={flow.artist_acceptance}
  digestLabel={/* derive from useFlowTimes, fallback "19:00" */}
  windowHours={/* flow response window hours, fallback 48 */}
  onBlockDates={focusBlockForm}
/>
```
Derive `digestLabel`/`windowHours` from the flow objects already loaded (`flow`, `useFlowTimes(orgId)`); if a clean field isn't available, pass the design defaults (`"19:00"`, `48`) — do not invent a query.

- [ ] **Step 4: Run the page tests** — `npx vitest run src/pages/AvailabilityPage.calendar.test.tsx src/components/availability/AvailabilityFirstRun.test.tsx` → PASS (fix any count assertions the new header shifts).

- [ ] **Step 5: Visual check** — `npm run local:up` (if not up) then `npm run dev`; sign in as the seeded artist; confirm the header/setup card/strip/rules card/footer render, "Block dates" scrolls to the picker, blocking a date retires the strip and flips the meter to 1 of 1. Screenshot for the PR.

- [ ] **Step 6: Help center** — add/adjust one artist FAQ in `src/lib/help/items.ts` (EN+DE) covering "How do offers reach me / can I change the rules", or note "No help center impact" in the PR.

- [ ] **Step 7: Commit**
```bash
git add src/components/availability/AvailabilityFirstRun.tsx src/components/availability/AvailabilityFirstRun.test.tsx src/pages/AvailabilityPage.tsx src/i18n/locales/en/availability.json src/i18n/locales/de/availability.json src/lib/help/items.ts
git commit -m "artist availability first run: setup card, block strip, rules card (screen 08)"
```

---

## Phase B — Screen 09: Artist Account (Profile)

**Design:** `screen_09_09_Artist_account.html`. Route `/profile`. Four groups in the settings-row pattern: **Details** (Email = fixed, Display name, Phone), **Sign-in** (Magic links = Active, Password = status + Add/Change), **What reaches you** (email | in-app matrix), **Your data** (Download + Delete merged). Right sidebar (artist only): **Reference** (How booking works here / Your blocked dates / Message the office) + **Language** card + a small note. Omit the ⌘K box.

**Owner decision:** the artist matrix shows only `booking_offers`, `booking_confirmations`, `schedule_changes`, `hire_orders`. `booking_activity` and `at_risk` are **removed** for artists (kept for admin/producer).

**Existing code (do not re-derive):**
- `src/pages/ProfilePage.tsx` — five `Card`s today, `useTranslation("profile")`, no role differentiation. Full matrix maps `NOTIFICATION_CATEGORIES` unconditionally. Email from `useAuth().user.email` (disabled). `usePasswordStatus` + `PasswordSetupForm`. `exportMyData`/`deleteMyAccount` with the `DELETE`-typed `AlertDialog`.
- `src/lib/notificationCategories.ts` → re-exports `NOTIFICATION_CATEGORIES` (keys: `booking_offers`, `booking_confirmations`, `booking_activity`, `schedule_changes`, `at_risk`, `hire_orders`), `NOTIFICATION_CHANNELS = ['email','in_app']`.
- `src/features/i18n/LanguageContext.tsx` → `useLanguage()` `{ lang, setLang }`. Language switcher is gated by `useFeature('language_packages')` (see `AppLayout.tsx`).
- Role helpers: `useAuth().hasRole(ROLES.X)`, `ROLES` in `src/config/app.config.ts`.
- i18n namespace `profile`, files `src/i18n/locales/{en,de}/profile.json`.

**Files:**
- Create: `src/lib/notificationAudience.ts` — pure category-audience filter.
- Create: `src/lib/notificationAudience.test.ts`
- Modify: `src/pages/ProfilePage.tsx` — restructure into the four groups + sidebar, role-aware matrix.
- Modify: `src/i18n/locales/{en,de}/profile.json` — add `audience`, `reference`, `language`, `sidebarNote`, `details.emailFixed`, `data.deleteRow.*` keys.
- Modify: existing `src/pages/ProfilePage.test.tsx` if present (adjust to the new structure); add matrix-role assertions.

**Interfaces:**
- Produces:
  ```ts
  // src/lib/notificationAudience.ts
  import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/notificationCategories";
  /** Categories never delivered to artists (Production Team only). */
  export const PRODUCER_ONLY_CATEGORIES: readonly NotificationCategory[] = ["booking_activity", "at_risk"];
  /** The categories to render for a viewer. Artists drop the producer-only ones. */
  export function visibleNotificationCategories(opts: { isArtistOnly: boolean }): typeof NOTIFICATION_CATEGORIES[number][];
  ```

### Task B1: `notificationAudience` pure filter (TDD)

- [ ] **Step 1: Write the failing test** — `src/lib/notificationAudience.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { visibleNotificationCategories, PRODUCER_ONLY_CATEGORIES } from "./notificationAudience";

describe("visibleNotificationCategories", () => {
  it("drops producer-only categories for an artist-only viewer", () => {
    const keys = visibleNotificationCategories({ isArtistOnly: true }).map((c) => c.key);
    expect(keys).toEqual(["booking_offers", "booking_confirmations", "schedule_changes", "hire_orders"]);
    for (const k of PRODUCER_ONLY_CATEGORIES) expect(keys).not.toContain(k);
  });
  it("keeps every category for a producer/admin viewer", () => {
    const keys = visibleNotificationCategories({ isArtistOnly: false }).map((c) => c.key);
    expect(keys).toContain("booking_activity");
    expect(keys).toContain("at_risk");
    expect(keys).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/notificationAudience.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/lib/notificationAudience.ts`:
```ts
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/notificationCategories";

export const PRODUCER_ONLY_CATEGORIES: readonly NotificationCategory[] = ["booking_activity", "at_risk"];

export function visibleNotificationCategories(opts: { isArtistOnly: boolean }) {
  if (!opts.isArtistOnly) return [...NOTIFICATION_CATEGORIES];
  return NOTIFICATION_CATEGORIES.filter((c) => !PRODUCER_ONLY_CATEGORIES.includes(c.key));
}
```

- [ ] **Step 4: Run to verify it passes** — → PASS.

- [ ] **Step 5: Commit is deferred to end of Phase B.**

### Task B2: Restructure `ProfilePage` into four groups + role-aware matrix

**Files:** Modify `src/pages/ProfilePage.tsx`, `src/i18n/locales/{en,de}/profile.json`.

- [ ] **Step 1: Add role + audience wiring.** In `ProfilePage`, add:
```tsx
import { visibleNotificationCategories } from "@/lib/notificationAudience";
import { ROLES } from "@/config/app.config";
// ...
const { user, hasRole } = useAuth();
const isProducerOrAdmin = hasRole(ROLES.ADMIN) || hasRole(ROLES.PRODUCER);
const isArtistOnly = hasRole(ROLES.ARTIST) && !isProducerOrAdmin;
const categories = visibleNotificationCategories({ isArtistOnly });
```
Change the matrix `.map(NOTIFICATION_CATEGORIES ...)` to `.map(categories ...)`.

- [ ] **Step 2: Convert the page shell to two columns.** Replace `<div className="space-y-6 max-w-xl">` with a header row + `flex gap-5 items-start` where the main column is `flex-1 min-w-0 space-y-4` and the sidebar is `w-[300px] shrink-0` (rendered only when `isArtistOnly`, else the main column keeps `max-w-2xl`). Header: `<h1>Account</h1>` + subtitle `t("page.subtitle")`. **Do not** add the ⌘K box (owner: omit).

- [ ] **Step 3: Details group — add the "Fixed" pill** on the email row (`<span>{t("details.emailFixed")}</span>` styled as a `bg-muted` chip). Keep the existing `identity` form and Save button; wrap the group in the design's card chrome (a `bg-muted` uppercase header row "Details" + rows below). New key `details.emailFixed: "Fixed"`.

- [ ] **Step 4: Merge "Your data".** Replace the two separate Cards (Download and Delete) with one card titled `data.title` containing two rows: the Download row (existing `downloadMyData` button) and a Delete row (red `data.deleteRow.title` + `data.deleteRow.description`, the existing `AlertDialog`). Move the `hireOrdersNote` append into the delete row description. New keys under `data.deleteRow.*`.

- [ ] **Step 5: Matrix footer note.** Under the matrix add `t("audience.footer")` in the `bg-muted` footer strip: EN `"Critical account emails are always sent. Invitations and password resets ignore these switches."`

- [ ] **Step 6: Sidebar (artist-only).** Render Reference + Language + note cards:
  - **Reference** card: three rows — "How booking works here" (link to `ROUTES.AVAILABILITY`), "Your blocked dates" (`t("reference.blockedDates", { count })` where `count` comes from `useMyBlockedDatesCount(artist?.id)` via `useMyArtist()`; link to `ROUTES.AVAILABILITY`), "Message the office" (link to `ROUTES.CHATS`). Icons `route`/`clock`/`message-square` from lucide.
  - **Language** card: gated `const languagePacksEnabled = useFeature('language_packages');` → render the `useLanguage()` select only when enabled; else render nothing (or the note only). Reuse the same option set as `AppLayout`'s picker. New keys `language.*`.
  - **Note** card: `t("sidebarNote")` = "No setup, no progress, no explainer strip. An artist's account is four groups and never grows a wizard."

- [ ] **Step 7: Add all EN keys** to `en/profile.json` and mirror in `de/profile.json`:
```jsonc
"details": { "emailFixed": "Fixed" /* + existing */ },
"audience": { "footer": "Critical account emails are always sent. Invitations and password resets ignore these switches." },
"data": {
  "deleteRow": {
    "title": "Delete account",
    "description": "Your account and profile go. Shared booking history stays, de-identified. Signed hire orders are kept for the org's records."
  }
  /* + existing data.* */
},
"reference": {
  "title": "Reference",
  "bookingRules": "How booking works here",
  "bookingRulesHint": "The rules you inherited, and who set them.",
  "blockedDates": "Your blocked dates",
  "blockedDatesHint_one": "{{count}} blocked. Editing them lives in Availability.",
  "blockedDatesHint_other": "{{count}} blocked. Editing them lives in Availability.",
  "blockedDatesHintZero": "None blocked. Editing them lives in Availability.",
  "office": "Message the office",
  "officeHint": "Chats. For anything you cannot change here."
},
"language": {
  "title": "Language",
  "hint": "Your app language. Emails and PDFs follow the workspace language the org picked."
},
"sidebarNote": "No setup, no progress, no explainer strip. An artist's account is four groups and never grows a wizard."
```

- [ ] **Step 8: Update the page test.** In `src/pages/ProfilePage.test.tsx` (create if absent), assert: (a) an artist-only viewer's matrix has no "Booking activity"/"At-risk" rows; (b) a producer viewer's matrix keeps them; (c) the Reference sidebar renders only for the artist-only viewer. Render with `renderWithProviders` overriding the auth role fixture. Example:
```tsx
test("artist matrix hides producer-only categories", async () => {
  renderWithProviders(<ProfilePage />, { auth: { roles: ["artist"] } });
  expect(await screen.findByText("Booking offers")).toBeInTheDocument();
  expect(screen.queryByText("Booking activity")).not.toBeInTheDocument();
  expect(screen.queryByText("At-risk & escalations")).not.toBeInTheDocument();
});
```
(Use the `renderWithProviders` auth-override mechanism already in `src/test/renderWithProviders.tsx`/`fixtures.ts`; if it has no role override, add a minimal one rather than `vi.mock`.)

- [ ] **Step 9: Run tests** — `npx vitest run src/lib/notificationAudience.test.ts src/pages/ProfilePage.test.tsx` → PASS.

- [ ] **Step 10: Visual check** — dev stack: sign in as the seeded artist, confirm four groups + sidebar, matrix has four rows; then confirm (as admin) the matrix still has six rows and no sidebar. Screenshot.

- [ ] **Step 11: Help center** — update `src/lib/help/items.ts` (EN+DE) for "what notifications do I get / where do I change my details", or note "No help center impact".

- [ ] **Step 12: Commit**
```bash
git add src/lib/notificationAudience.ts src/lib/notificationAudience.test.ts src/pages/ProfilePage.tsx src/pages/ProfilePage.test.tsx src/i18n/locales/en/profile.json src/i18n/locales/de/profile.json src/lib/help/items.ts
git commit -m "artist account: four-group layout, role-aware notification matrix, reference sidebar (screen 09)"
```

---

## Phase C — Screen 11: Airtable connect rail (board `dates` panel)

**Design:** `screen_11_11_Airtable_connect.html`. **11b (chosen while connecting):** a four-step rail — 1 Connect (token), 2 Base and table, 3 Map fields, 4 Link catalog — with a 236px numbered step list on the left and the step body on the right; "Saved as you go", "Later", and a next-step primary. **11a (steady state, connected):** the same task collapsed to four groups — Token (Replace), Base and table (Change), Map fields (N of 4 required), Link catalog — each a compact row. One task, two states; the last step's save flips 11b → 11a.

**Scope decision (locked, follows SPEC "05/06 out of scope"):** screen 11 reworks the **Get-running `dates` panel** Airtable path only. The Settings `AirtableSyncTab` console (`SettingsPage.tsx`) stays mounted and unchanged — its restructure to the 11a "connections row" is deferred with the 05/06 Settings work. The new rail/summary is a **board-context** component; it must not regress the Settings console.

**Existing code (do not re-derive):**
- `src/components/getRunning/panels/DatesPanelBody.tsx` — the `dates` task body; currently opens `<AirtableSyncTab>` in a `Dialog` overlay from a "setup"/"Resolve" button. Reads `fetchLatestSyncLog` under `['airtable','sync-log',orgId]`.
- `src/components/settings/AirtableSyncTab.tsx` (821 lines) — `deriveMode()` (`setup`/`error`/`healthy`/`live`), `SetupWizard` (4-step rail, steps 1–2 interactive today), `ManageConnectionDialog` (token/base-table/view/frequency), console tabs `OverviewTab`/`MappingTab`/`CatalogTab`/`ActivityTab`. Connected = `keyPresent && hasBaseTable`.
- Data access: `src/data/airtableKey.ts` (`fetchAirtableKeyStatus`/`saveAirtableKey`/`deleteAirtableKey`), `airtableSettings.ts` (`fetchAirtableSettings` + `AIRTABLE_SETTING_KEYS`), `airtableSchema.ts` (`fetchAirtableBases`/`fetchAirtableTables`), `airtableMapping.ts` (`SHOWFLOW_FIELDS`, `AirtableFieldMap`), `airtableSync.ts` (`fetchLatestSyncLog`/`triggerAirtableSyncNow`). Settings writes via `upsertOrgSetting`.
- Readiness pure logic in `src/components/settings/airtable/console.ts` (`deriveMode`, `requiredMappedCount`, `deriveKpis`).
- i18n namespace `settingsAirtable` (`src/i18n/locales/{en,de}/settingsAirtable.json`, `setupWizard.steps.*` already exist) + board copy in `getRunning` (`panel.body.dates.*`).

**Architecture:** Build a self-contained board-context component tree that **reuses the existing presentational sub-components** (`MappingTab`, `CatalogTab`, the token + base/table sections) fed by a **shared hook extracted from `AirtableSyncTab`**, so there is no logic duplication and the Settings console keeps working. If the hook extraction proves too invasive for one commit, fall back to the reduced scope in Task C0.

### Task C0: Decide the reuse boundary (spike, ≤30 min, no commit)

- [ ] Read `AirtableSyncTab.tsx` end to end and confirm whether `MappingTab` and `CatalogTab` can be mounted standalone given their props, and how much of the query/mutation wiring they need. Produce a one-paragraph note at the top of the new component file documenting the chosen boundary. Two acceptable outcomes:
  - **(preferred) Shared hook:** extract the queries/mutations/derived state into `src/hooks/useAirtableConsole.ts`; `AirtableSyncTab` consumes it unchanged in behavior (guarded by `AirtableSyncTab.test.tsx`); the new rail/summary consume the same hook.
  - **(fallback) Thin reuse:** the new component owns only the token + base/table + `fetchLatestSyncLog` wiring and mounts `MappingTab`/`CatalogTab` for steps 3/4 with a minimal local query set; the Settings console is the deeper editing path a "Manage in Settings" link points to.
- Record which boundary was chosen. Everything below is written against the **shared-hook** outcome; if fallback is chosen, steps 3/4 bodies become links into Settings' Mapping/Catalog tabs rather than inline reuse (note it and adjust the tests accordingly).

### Task C1 (preferred path): Extract `useAirtableConsole` hook

**Files:** Create `src/hooks/useAirtableConsole.ts`; Modify `src/components/settings/AirtableSyncTab.tsx` to consume it; keep `src/components/settings/AirtableSyncTab.test.tsx` green.

**Interfaces:**
- Produces: `useAirtableConsole(orgId: string | null, opts: { readOnly?: boolean; canTriggerSync?: boolean }): AirtableConsole` where `AirtableConsole` is a typed object exposing the state + handlers `AirtableSyncTab` currently holds inline (key status, settings `s`, `saveSettings`, `syncNow`, bases/tables queries, field-map save, catalog link/create/unlink mutations, `keyPresent`, `hasBaseTable`, `requiredMapped` `{mapped,total}`, `latest`). Copy the exact query keys so caches stay shared.

- [ ] **Step 1:** Move the inline `useQuery`/`useMutation`/derived-state blocks from `AirtableSyncTab.tsx` into `useAirtableConsole.ts`, returning them as one object. No behavior change.
- [ ] **Step 2:** Rewrite `AirtableSyncTab` to `const c = useAirtableConsole(orgId, { readOnly, canTriggerSync });` and read from `c.*`.
- [ ] **Step 3: Run** `npx vitest run src/components/settings/AirtableSyncTab.test.tsx src/components/settings/airtable/console.test.ts` → PASS unchanged. Fix drift until green.
- [ ] **Step 4:** No commit yet (bundled into the Phase C commit).

### Task C2: `AirtableConnectRail` (11b) — the four-step rail

**Files:** Create `src/components/getRunning/panels/airtable/AirtableConnectRail.tsx` + `.test.tsx`.

**Interfaces:**
- Consumes: `useAirtableConsole` (C1); `MappingTab`, `CatalogTab` (existing); `SHOWFLOW_FIELDS`; the token + base/table field groups (extract the token `<Input>`+Save and the base/table `<Select>`s from `ManageConnectionDialog` into small local sub-components `TokenStep`/`BaseTableStep`, or reuse `SetupWizard`'s token step).
- Produces: `AirtableConnectRail({ orgId, readOnly, canTriggerSync, onConnected }: { orgId: string|null; readOnly: boolean; canTriggerSync: boolean; onConnected: () => void })`.

- [ ] **Step 1: Write the failing test** — assert the rail renders four numbered steps with the `settingsAirtable:setupWizard.steps.*` labels, starts on the first unsatisfied step (`keyPresent ? (hasBaseTable ? "map" : "baseTable") : "connect"`), and that a token save advances the active step. Use `renderWithProviders` + `supabaseFake` seeded so `fetchAirtableKeyStatus` returns `{present:false}` first.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** the rail per the design (11b HTML lines 105–170): `grid grid-cols-[236px_1fr]`. Left `<ol>` of four steps with numbered circles (current = `bg-primary text-white`, done = `bg-accent-100 text-accent-700` with a check, future = `border-border`), connector lines. Right body switches on the active step: `connect`→token field + Save (`saveAirtableKey`), `baseTable`→base/table/view selects (schema-accessible) or manual inputs (fallback), `map`→`<MappingTab .../>`, `catalog`→`<CatalogTab .../>`. Footer: `Step {n} of 4 · Saved as you go` + "Later" + a next-step primary that advances; on the catalog step the primary calls `onConnected()`. Active-step state is local (`useState`), initialized from readiness, and advances on save.
- [ ] **Step 4: Run to verify it passes.**

### Task C3: `AirtableConnectionSummary` (11a) — collapsed four groups

**Files:** Create `src/components/getRunning/panels/airtable/AirtableConnectionSummary.tsx` + `.test.tsx`.

**Interfaces:**
- Produces: `AirtableConnectionSummary({ orgId, readOnly, canTriggerSync, onEditStep }: { orgId: string|null; readOnly: boolean; canTriggerSync: boolean; onEditStep: (step: "connect"|"baseTable"|"map"|"catalog") => void })`.

- [ ] **Step 1: Write the failing test** — assert four group rows render (Token/Base and table/Map fields/Link catalog), the map row shows `N of 4 required` from `requiredMappedCount`, and clicking "Replace"/"Change"/"Map sessions" calls `onEditStep` with the right key.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** per 11a HTML (lines 34–88): a header ("Connect Airtable" + "Nothing syncs until the last group is done…") over four rows. Token row: check dot + "Saved {date}, stored in Vault, never displayed" + "Replace" (`onEditStep('connect')`). Base and table row: `base › table · view · {frequency}` + "Change". Map fields row (accent-bordered when incomplete): `{mapped} of {total} required` + "Map sessions". Link catalog row (dashed when unlinked). Values come from `useAirtableConsole`. Respect `readOnly` (hide the affordances).
- [ ] **Step 4: Run to verify it passes.**

### Task C4: Compose `AirtableConnect` + wire into `DatesPanelBody`

**Files:** Create `src/components/getRunning/panels/airtable/AirtableConnect.tsx`; Modify `src/components/getRunning/panels/DatesPanelBody.tsx`; add board copy to `src/i18n/locales/{en,de}/settingsAirtable.json` (reuse `setupWizard.*`) and/or `getRunning.json`.

**Interfaces:**
- Produces: `AirtableConnect({ orgId, readOnly, canTriggerSync }: {...})` = the summary when `keyPresent && hasBaseTable`, else the rail; the rail's `onConnected` and the summary's `onEditStep` share one local `activeStep`/`mode` state so the last save flips rail→summary and an "edit" flips summary→rail on that step.

- [ ] **Step 1:** Implement `AirtableConnect` as the state owner (mode = `connected ? "summary" : "rail"`, with `onEditStep` forcing rail on a chosen step).
- [ ] **Step 2:** In `DatesPanelBody`, replace the `<AirtableSyncTab .../>` inside the overlay `<DialogContent>` with `<AirtableConnect orgId={orgId} readOnly={!canConfigureAirtable} canTriggerSync={canTriggerSync} />`. Widen the dialog to match the design's roomier rail (`max-w-3xl` → keep; the design notes the rail wants ~760px, `max-w-3xl` ≈ 768px, good). Keep the `DialogHeader className="sr-only"` + `DialogTitle` (a11y — the CI reviewer enforces this). Keep the "connected"/held/"setup" trigger card above the overlay as-is.
- [ ] **Step 3:** Reuse `settingsAirtable:setupWizard.steps.*` for the rail labels; add any missing 11a strings (`connection.tokenSaved`, `connection.replace`, `connection.change`, `connection.mapSessions`, `connection.requiredCount`) to both locale files.
- [ ] **Step 4: Run** `npx vitest run src/components/getRunning/panels/DatesPanelBody.test.tsx src/components/getRunning/panels/airtable/` → PASS. Update `DatesPanelBody.test.tsx` expectations (it currently asserts the `<AirtableSyncTab>` overlay opens; retarget to `AirtableConnect`).
- [ ] **Step 5: Visual check** — dev stack as admin, open Get running → Get dates in → the `dates` task panel → "Connect Airtable": confirm the 4-step rail renders and, on a seeded connected org, the 11a collapsed groups render; "Replace"/"Change"/"Map sessions" reopen the right step. Confirm Settings → Automation still shows the full unchanged console. Screenshots for the PR.

- [ ] **Step 6: System map / docs** — no automation trigger changes (this is UI over existing sync); confirm `docs/system-map.md` needs no edit and note it in the PR.

- [ ] **Step 7: Commit**
```bash
git add src/hooks/useAirtableConsole.ts src/components/settings/AirtableSyncTab.tsx src/components/getRunning/panels/airtable/ src/components/getRunning/panels/DatesPanelBody.tsx src/components/getRunning/panels/DatesPanelBody.test.tsx src/i18n/locales/en/settingsAirtable.json src/i18n/locales/de/settingsAirtable.json
git commit -m "airtable connect: four-step rail collapsing to a four-group summary in the dates panel (screen 11)"
```

---

## Final verification (before PR)

- [ ] `npm run verify:fast` all green (lint, three tsc projects, build, `vitest run --coverage`, deno check).
- [ ] `npx vitest run` full suite green; coverage thresholds met.
- [ ] Re-read each of `screen_08`, `screen_09`, `screen_11` against the running app; confirm token/colour/spacing fidelity (semantic tokens, no dashes in copy, DE parity).
- [ ] Confirm the three commits are clean and scoped; open the PR (main requires an owner review approval — cannot self-merge).
- [ ] Update the initiative memory (`setup-settings-getrunning-initiative.md`) with the built/merged status.

## Self-review notes (spec coverage)

- **08** covers SPEC §5.5 artist-first-run: strip + rules card + edge cases (booking off / not linked). Page minis kept (`<PageMini>` stays). ✅
- **09** covers SPEC §5.5 artist-account four groups + settings-row + Reference sidebar + Language card; open item "remove booking_activity/at_risk switches" resolved per owner (remove); ⌘K omitted per owner. ✅
- **11** covers SPEC §5.5 Airtable 4-step rail (11b) collapsing to 4-group (11a); Settings console untouched (05/06 deferred), scope decision recorded in Task C0. ✅
- **Deferred (not in this plan, noted for the PR):** the dead artist stage-chain code (`buildArtistOnboarding`, artist branch of `stageChain.ts`, `onboarding.json` artist keys) has no render surface after 08 lands; remove as a follow-up cleanup unless trivially safe to delete here. The 11a "Settings connections row" reuse lands with the 05/06 restructure.
