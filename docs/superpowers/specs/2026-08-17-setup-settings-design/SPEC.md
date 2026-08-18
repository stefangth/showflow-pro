# Setup + Settings Redesign — Spec

**Status:** approved direction; Phase 1 (Get running board) plan written.
**Owner:** Stefan (stefanschaal@hotmail.de).
**Date:** 2026-08-17.
**Design source:** claude.ai design project `3eefd86b-0b1d-455e-9711-d67ec8bd6a1a` ("Simplifying onboarding and settings UX"), file `Setup + Settings 1b.dc.html`. Rendered copy in this folder: `render-all-screens.html` + `screens/*.html`.
**Design system:** ShowFlow foundations — violet accent, Geist, warm neutrals. Tokens in `src/index.css` / `tailwind.config.ts`. Token rule (verified 2026-08-17): use a semantic Tailwind utility when one exists, else the CSS-var arbitrary form `*-[var(--token)]` (dark-mode-correct because vars are redefined in dark). Verified mappings:
- `#6E5CF6`→`bg-primary` (= `--primary` = accent-500); `#5848D8`/`#4738B0` → `bg-primary-hover`/`bg-primary-active`; accent scale `bg-accent-50..900` (NO opacity modifiers — silently solid).
- `#F6F4EF`→`bg-background`; `#FFFFFF`→`bg-card`; `#FAF8F4`→`bg-muted`; `#EFEDE7` (surface-3)→`bg-[var(--surface-3)]`.
- text: `#15131C`→`text-foreground`; `#5B5A57`→`text-muted-foreground`; `#8B8A85` (faint)→`text-[var(--text-faint)]`.
- `#E6E3E0`→`border-border`; shadows→`shadow-elev1..4`.
- **Badges/chips use existing `Badge` variants — do NOT invent `amber-*` utilities (they are not registered):** amber "Blocks offers/booking/issuing" → `variant="risk"` (or `"hold"`); green "All covered / Running / Active" → `variant="confirmed"`; grey "Admin only / Not on" → `variant="neutral"`; violet "Open / Current" → `variant="accent"`. Inline amber fills → `bg-[var(--amber-100)] text-[var(--amber-600)]`.
**Plan(s):** `docs/superpowers/plans/2026-08-17-get-running-board.md` (Phase 1). Later phases get their own plans.

---

## 1. Problem

Onboarding and setup are scattered across four surfaces that overlap and drift: the Dashboard first-run "stage chain", the Shows & Bookings setup rail, the Hire-orders setup rail, and the shared `SetupChecklistSheet`. New admins can't see the whole path or its order; every task also lives as a settings tab, so people get sent "into settings to guess". Settings itself is 12 tabs. The design collapses onboarding into one ordered board and (separately, out of scope here) Settings into five sections.

## 2. Goal

One **Get running** board that owns the order of setup and finishes every task in a panel on the same screen; Settings answers only "where does a thing live" for later changes. Role-scoped, self-retiring, module-aware. Artists get no board (one inherited step). This spec covers onboarding + the artist account surface; it deliberately does **not** restructure Settings.

## 3. Scope

**In scope (phased):**
| Screen | Surface | Phase |
|---|---|---|
| 01–04 | Get running board: admin board + 3 task-panel shapes + producer view + retirement | **1 (first)** |
| 07 | Accept-invite success handoff (names the board) | later |
| 08 | Artist first run — Availability (no board, single step, "how booking works" rules card) | later |
| 09 | Artist account — Profile reworked into 4 groups, settings row pattern | later |
| 11 | Airtable connect — 4-step rail in a task panel (11b) collapsing to a 4-group steady state (11a) | later |

**Out of scope (owner-confirmed):**
- **05 / 06** — the Settings 12-tabs→5-sections restructure (Workspace / People & access / Booking / Documents & email / Data & privacy) and its 41-setting coverage map. Today's 12-tab Settings stays. Because it stays, the old `/settings?tab=…` links keep working untouched (no redirect map needed).
- **10 Validation** — this is the designer's own coverage/gap map, a design document, not an app screen.
- **Page minis** are **kept** as-is on their existing pages (owner instruction). No mini is removed; the Get running route defaults to no mini (the board self-describes).

## 4. Locked decisions

Confirmed by the owner on 2026-08-17 (AskUserQuestion) plus two mid-turn asks:

1. **Sequencing — phased, board first.** Build 01–04 as the first reviewable milestone, then 08/09, then 07, then 11. Review each against the design before the next.
2. **Old onboarding surfaces — replace them.** The board fully retires the dashboard first-run stage-chain, the booking setup rail, the hire-orders setup rail, and `SetupChecklistSheet`. The step-editor *leaves* (FlowStep, SlotsStep, TimingStep, LadderStep, EligibilityStep, PeopleStep, LetterheadStep, TermsStep, CountersignStep, RehearsalBlock, FirstOfferCard) and the pure status libs/hooks are **kept** and reused inside the task panel.
3. **Producer "Nudge" (03) — omit for now.** The producer board shows the "waits on {admin}" state but no Nudge action. The full three-channel nudge (in-app + email + chat message, once per task per day) is deferred to a later pass.
4. **Retirement home (04) — minimal reference.** A completed board offers "Hide from nav" (per person) and a small read-only **"How this org works"** provenance card, surfaced as a new admin/producer Settings tab. Not the full Settings restructure.
5. **Fold `/admin` into `/settings`** (mid-turn ask). The Admin page's People / Activity(audit) / Sync(logs) become admin-only Settings tabs; `/admin` → `/settings?tab=people`; the Admin nav item retires. The 3 admin stat cards + admin PageMini are dropped (the People pane is the substance).
6. **Move Help nav item to the System cluster** (mid-turn ask); it is in Workspace today.

## 5. Requirements by screen

### 5.1 Get running board — admin (screen 01)
- New route `/get-running` + a Workspace nav item (icon Rocket, badge "{done}/{total}"), gated `roles: ['admin','producer']` — **artists have no board** (screen 08's artist sidebar has no Get running item); a direct artist URL hit bounces to Availability (see 5.3).
- Header: eyebrow "{Org} · get running", headline keyed on how much blocks the first offer, body, and a 236px "Set up · {done} of {total} done" card with tick segments + module on/off list ("Booking engine On/Off", "Hire orders On/Off") + "Modules are switched on by your account manager."
- Board = 3 phase cards: **Get dates in** (running row: shows-in + slots-set, review/resolve held-records), **Make it bookable** (accent-bordered active card of task rows), **Paperwork** (dashed card, 3 document tiles; omitted when hire orders off).
- A right-side **task panel** (440px) is open on the first blocking task by default; the board column narrows while it is open.
- Footer strips: "Preview as artist" and "Every task here is also a setting… Open Settings instead".
- **Task model:** 11 tasks when both modules on — get_dates: `dates`, `slots`; bookable: `flow`, `people`, `ladder`, `eligibility`, `timing`, `team`; paperwork: `letterhead`, `terms`, `countersign`. Composed from `computeBookingSetupStatus` + `computeSetupStatus` + producer count + Airtable status. (Design-mapping choice, pinned in `src/lib/getRunning/tasks.ts`; reducible to 10 if "Get dates in" is one task.)
- Block vocabulary carried from the existing libs: amber "Blocks offers / Blocks booking / Blocks issuing", soft "filling", grey "Admin only", violet "Open".

### 5.2 Task panels (screen 02)
- One frame + footer, three content shapes: **choice** (e.g. Booking flow — radio options + consequence lines), **values** (e.g. Offer timing — two fields + an "on these settings" preview timeline), **document** (e.g. Letterhead — fields + a live preview + "N left" of the paperwork set).
- Each panel **reuses the existing step editor** for its task; the panel only supplies the frame (eyebrow by block, title, body, scroll body, footer "Saved as you go · Later · {primary}"). Save is incremental ("saved as you go").

### 5.3 Producer view (screen 03) & edge states
- Same board, role-scoped: tasks a producer cannot do are **named and attributed** ("Waits on {admin}") with a "View" affordance, not disabled in place. **No Nudge** (decision 3).
- Role-cover footer: "You are on the Production Team… inviting people, casts and settings stay with the admin."
- Nothing-on org (no module entitled): a single "nothing to set up" card, no board.
- Artist on `/get-running`: redirect to `/availability` until the artist phase (08) lands.
- Loading: skeleton.

### 5.4 Retirement (screen 04)
- All applicable tasks done → board collapses to a one-row "This workspace is running" state with "How this org works" + "Hide from nav".
- "Hide from nav" is **per person** (matches existing `useRailDismissed`); the nav item disappears when complete **and** dismissed. It returns when a new module is switched on or a rule goes empty; a new admin sees it once.
- "How this org works" = read-only provenance (current flow, offer timing, coverage summary, letterhead/terms/countersign state, each with "set by {name}, {date}" where available, from `useBookingFlowProvenance` + `settingsAudit`). Also a new Settings tab.

### 5.5 Later-phase screens (07/08/09/11) — captured, not yet planned
- **07 Invite handoff:** the existing `AcceptInvitePage` success card, reworded to name the board ("Open Get running"). Per-role next-step lines already exist.
- **08 Artist first run (Availability):** replace the artist stage-chain with one "Block what you cannot play" strip + a read-only "How booking works here" rules card (eligibility / offers by email / 48h window) + the live dates list. Keep edge cases: booking off → one line, no calendar; artist not linked → "an admin still has to link your artist profile".
- **09 Artist account (Profile):** rework into 4 groups (Details, Sign-in, "What reaches you" notification matrix, Your data) in the settings row pattern + a Reference sidebar + Language card. **Behavior change to confirm at that phase:** the two never-sent categories (booking activity, at-risk) render dimmed/"Production Team only" instead of as live artist switches. "Find a setting ⌘K" renders as decorative/simple filter, not a real command palette.
- **11 Airtable connect:** move the existing 4-step `SetupWizard` into a task-panel rail (11b); once connected it collapses to a 4-group steady state (11a) reused as the Settings connections row.

## 6. Non-functional requirements

- **i18n:** every new string via `t()` in a domain namespace, EN **and** DE in the same change (Du, no em/en dashes; `keyParity.test.ts` + `copyLint.test.ts` are CI gates). Reuse `src/i18n/terms.ts` `TERMS`.
- **Styling:** semantic tokens only; accent numbered stops don't take opacity modifiers; use `shadow-elev2/3`.
- **Testing:** pure model (`tasks.ts`) is TDD; data-access via `src/data/*` + `supabaseFake`; components via `renderWithProviders`. Tests import the real module.
- **Roles:** `producer` displays as "Production Team" via `roleLabel()`; compare the literal `'producer'` only.
- **Capability/entitlement gating** preserved: booking tasks need `booking_flow`; paperwork needs `hire_orders`; per-step edit capabilities unchanged; super-admin god-mode unchanged.
- **Help center:** update `src/lib/help/items.ts` (EN+DE) to point at Get running, or state "no impact" with reason in the PR.

## 7. Open items / to confirm during build

- **T3 (Phase 1):** confirm the 11-vs-10 task split at first review.
- **Screen 09 phase:** confirm removing artist-toggleable "booking activity"/"at-risk" notification switches (they exist live today).
- **Airtable homes:** the board adds a third entry point; current Settings→Automation and Admin→Sync (now folded into Settings) stay — confirm no consolidation is wanted beyond the fold.
- **"How this org works" depth:** how much provenance history to surface (single "last changed by" line vs full change log).
