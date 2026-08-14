# Page Minis — design spec

Status: proposed · 2026-08-14 · Source design: claude.ai/design "Page Minis" (project `84d2688a`), imported via claude_design MCP.

## Problem

A producer opening `/settings`, an artist opening `/availability`, or an admin opening
`/hire-orders` has no in-context explanation of what that module *does* or how its pieces
fit together. Help lives on a separate page; the setup rail only covers first-run
configuration and then retires. Every route should be able to explain its own module, to
the person actually reading it, without leaving the page.

## Solution — the "page mini"

A **page mini** is a compact, evergreen explainer pinned to the top of a route:

- **One mini per route**, rendered above the page body and below the setup wizard/rail.
- **Four steps**, left to right. Each step is a numbered eyebrow label, a small
  miniature of the real UI, and one line of plain explanation.
- **Role-aware.** The mini follows the viewer's role in the active org: it names the step
  that is theirs ("You confirm") and says who owns the ones that are not. Copy (and
  occasionally a step label) differs by role; the miniature illustrations do not.
- **Dismissible, evergreen.** Unlike a setup rail it never "completes" — it stays
  available. **Hide** collapses it to a slim Resume bar; **Resume** brings it back.
  Persistence is per-page × per-org × per-browser, exactly like the dashboard first run.

This is intended to become a **convention for new pages**: adding a route means adding its
mini (or explicitly recording that it has none).

### Reference (from the imported design)

The design canvas shows the mini for all nine current routes, each rendered per role,
plus the collapsed Resume bar and an "in situ" example placing the mini under the setup
wizard on `/hire-orders`. Full extracted copy for every page/role lives in the plan's
content appendix. Nine routes and their minis:

| Route | Section | Roles that see a mini | Eyebrow |
|---|---|---|---|
| `/bookings` | Shows & Bookings | admin, producer (super→admin) | How a date gets cast |
| `/availability` | Availability | artist (super→artist) | How your calendar works |
| `/chats` | Chats | admin, producer, artist, super | How threads work |
| `/productions` | Productions | admin, producer (super→admin) | How the catalog works |
| `/artists` | Artists | admin, producer (super→admin) | How the roster works |
| `/admin` | Admin | admin (super→admin) | How people get in |
| `/settings` | Settings | admin, producer (super→admin) | What settings decide |
| `/platform` | Platform | super-admin only | What the console controls |
| `/hire-orders` | Hire orders | admin, producer | How hire orders work |

The design also renders a dashed "No mini — X is not in this role's nav" placeholder for
roles that cannot reach a route. That state is a **canvas artifact only**: in the app,
`ProtectedRoute` already prevents a role from reaching a route it lacks, so the mini
component simply renders nothing when the viewer has no variant. (Super-admins can reach
any route via god-mode; they get the `super` variant, which for most pages is the admin
copy.)

## Requirements

### Behavior
1. On a route with a mini, an entitled/permitted viewer sees the full four-up mini by
   default (first visit, per browser).
2. **Hide** persists dismissal and swaps the mini for a slim Resume bar reading
   `<eyebrow> · Pick up where you left off · [Resume]`. **Resume** restores the full mini.
3. Dismissal is scoped per route × active org × browser (localStorage), and stays in sync
   across mounted instances and tabs — reusing `useRailDismissed`.
4. The mini renders the **role variant** for the viewer's effective role in the active org
   (respecting editor view-as and super-admin god-mode). If no variant applies, render
   nothing.
5. The mini sits **below** any setup rail/wizard and **above** the page body.
6. No layout shift / English flash: resolve dismissal and role synchronously from context;
   don't gate on a network round-trip.

### Content & i18n
7. All mini copy (eyebrow, per-page subnote, per-step label, per-step explanation) is
   **bilingual EN + DE**, authored as a typed data module (the `src/lib/help/` pattern),
   not flat JSON — the content is structured per-page/per-role records.
8. DE copy uses informal **"Du"**, contains **no em/en dashes**, and reuses the canonical
   `TERMS` glossary for domain terms. Enforced by `copyLint.test.ts` (the new module's
   strings must be fed into it) and a new en≠de guard for the module.
9. DE is only ever shown to `language_packages`-entitled orgs; when the entitlement is off
   AppLayout forces the runtime to English, so every mini must read correctly in English.
   Minis add **no** new entitlement — they ride the route's existing gating.

### Convention
10. A single registry maps a `PageKey` → mini definition, and one component `<PageMini
    page={...} />` renders it. Adding a page's mini = add one definition file + one
    illustration file + drop `<PageMini>` into the page.
11. CLAUDE.md's "New page / route checklist" gains a step: add a page mini (EN+DE) or
    record "No mini." with a reason. Help-center-impact rule already applies.

## Architecture

### Content model — `src/lib/minis/`
- `types.ts`: `MiniRole = 'admin' | 'producer' | 'artist' | 'super'`; `Lang` from
  `@/i18n/config`; `Bi = Record<Lang, string>`. A `MiniStepCopy = { label: Bi; text: Bi }`.
  A `MiniDef = { page: PageKey; route: string; eyebrow: Bi; subnote?: Bi; art: MiniPage
  (id ref to illustration set); variants: Partial<Record<MiniRole, [MiniStepCopy × 4]>> }`.
- `pages/<page>.ts`: one `MiniDef` per file (bookings, availability, chats, productions,
  artists, admin, settings, platform, hireOrders). Keeps per-page work independent and
  parallelizable — each file is touched by exactly one implementer.
- `index.ts`: barrels the per-page defs into `MINIS: Record<PageKey, MiniDef>`.

### Illustrations — `src/components/minis/illustrations/<Page>Mini.tsx`
- Each page exports an ordered array of four presentational React nodes (the miniature
  UI: mini calendars, avatar/status rows, progress meters, timelines). Pure, token-only
  (`--surface`, `--accent-*`, `--radius-*`, semantic `--green/amber` badges), no data.
- Role-invariant: the same four illustrations serve every role variant of that page; only
  copy changes. Built with the shared primitives below.

### Shared primitives — `src/components/minis/`
- `PageMini.tsx`: the frame. Resolves viewer role → variant; if none, returns null.
  Reads `useRailDismissed('mini.' + page, orgId)`. Renders either the collapsed Resume
  bar (reusing `DashboardWelcomeCollapsed`) or the full card: header (eyebrow · subnote ·
  Hide) + responsive four-column step grid (each: number+label, illustration panel,
  explanation). Responsive: 4 cols wide, stacking down at lg/md/sm like the dashboard chain.
- `MiniStep.tsx`, and small shared atoms (mini calendar cell, mini avatar, mini badge,
  mini meter, mini timeline) factored so the nine illustration files stay short and
  consistent.
- Role resolution helper `resolveMiniRole(def, { hasRole, isSuperAdmin, viewAs })`:
  super-admin (not impersonating) → `super` if present else `admin`→`producer`→`artist`;
  else first of admin/producer/artist the viewer holds that has a variant; else null.

### Placement (per page)
Drop `<PageMini page="…" />` as a direct child of each page's root `space-y-6` container,
after the header/rail and before the body:
- `SettingsPage.tsx` — after the unsaved-changes bar, before `<Tabs>`.
- `ShowsBookingsPage.tsx` (producer view) — after the collapsed/banner setup rail, before
  the `min-w-0 space-y-6` body. (Artist view renders `AvailabilityPage`'s domain elsewhere;
  bookings mini is admin/producer only.)
- `AvailabilityPage.tsx` — after the header, before the filter row.
- The remaining six pages: the equivalent header→body seam.

## Non-goals
- No cross-device persistence (localStorage per browser, matching the dashboard first run).
- No new server tables, RPCs, or entitlements.
- No change to routing, nav gating, or the setup rails themselves.
- The "No mini" dashed placeholder is not implemented (canvas-only).

## Testing
- Unit: `resolveMiniRole` (each role incl. super-admin god-mode + view-as); `PageMini`
  renders the correct variant, Hide→Resume toggles and persists via the localStorage key,
  null-render when no variant.
- Content guards: feed `src/lib/minis` EN/DE strings into `copyLint.test.ts`
  (dashes + informal Du); add a `minis` en≠de guard (typed modules aren't covered by
  `translationCompleteness.test.ts`). A structural test asserts every `MINIS` entry has
  exactly four steps per declared variant and non-empty EN+DE for each.
- Verify the app renders (browser preview) for the settings exemplar in EN and, for an
  entitled org, DE; light + dark.

## Rollout
Settings mini first (exemplar that proves the frame + content model + tests), then the
other eight in parallel, then the convention docs + changelog + help-center pass.
