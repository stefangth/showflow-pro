# Dashboard First Run — Design

**Date:** 2026-08-07
**Branch:** `claude/dashboard-first-run-screens-781f83`
**Source design:** Claude Design project "ShowFlow" — `Dashboard First Run v2.dc.html` (direction **2a**), plus its design-system bundle (`_ds/showflow-design-system-.../colors_and_type.css`).

## Context & goal

A brand-new org lands on an empty `DashboardPage` with nothing to act on, and a teammate who joins an already-configured org has no idea which rules shaped the numbers they see. The `2a` design adds a **first-run layer** to the dashboard:

- a role-scoped **welcome panel** (accent hero) at the top of the dashboard;
- its primary button opens an **on-demand rail** (a setup checklist, or — once setup is done — a read-only "how this org works") rather than navigating away;
- **dismissing** collapses the panel to a **one-line resumable chip** in the same spot;
- underneath, the existing dashboard body renders **greyed + a `Sample` chip** until the org's setup is complete, then **live**.

The crucial property, from the design owner: **the experience is composed from whatever modules the org has licensed.** There is no fixed base. Each enabled module (`booking_flow`, `hire_orders`, and any module added later) contributes its own setup steps, its welcome/preview slice, and its "rules you inherited". Turn a module on at runtime → it joins the onboarding; off → it drops out (and the already-entitlement-driven locked-nav upsell returns).

The design system is already ported into the app (`src/index.css` mirrors the DS `colors_and_type.css` — `--primary` = `#6E5CF6` = `--accent-500`, `--warning` = `#D97706`), so this is a layout + composition + wiring change, not a token or readiness-logic rebuild. The setup *readiness* already exists per module (`useBookingSetupStatus`, `useHireOrderSetupStatus`); this feature **presents and composes** it on the dashboard and deep-links back to where the work already happens.

## Decisions

1. **Real Dashboard feature, not a prototype replica.** The prototype's three top-bar toggles (*Viewing as* / *Setup* / *Panel*) are demo devices. In the app: role comes from auth, first-run-vs-inherited and sample-vs-live are **derived**, and dismissal is persisted. No toggles ship.
2. **Single setup-complete switch** (owner's choice). One boolean — `setupComplete` — drives **both** the panel mode (first-run ↔ inherited) **and** the preview (sample ↔ live), faithful to the prototype's coupling. `setupComplete` = AND, over the org's **enabled** modules, of each module's own `.complete` (artist role: the artist's personal readiness).
3. **Module-composed via a registry.** A typed `MODULE_ONBOARDING` registry keyed by `FeatureKey` holds each module's *presentation* (step copy, CTA route, inherited-rule copy, off-footer). Live *readiness* comes only from that module's existing status hook. The dashboard composes only the enabled modules' contributions.
4. **Overview + deep-link, single source of truth.** The dashboard rail edits nothing itself. Each step shows done/todo and a CTA that deep-links to the surface that already owns the work (Shows & Bookings setup rail, Productions, Admin › Invites, Settings › Hire orders, Availability, Profile). No duplicated editors; the page-local `BookingSetupRail` / hire-order `SetupRail` remain the deep-dive editors.
5. **Anti-drift by construction** (owner's requirement). Step coverage is compiler-enforced (exhaustive `Record<EngineStepKey, …>`), titles reuse the engine's `STEP_TITLES`, routes are `ROUTES` constants, and a parity test asserts every `FeatureKey` has a contribution. See Part D.
6. **Runtime on/off** (owner's requirement). Add `org_entitlements` to `REALTIME_INVALIDATIONS` so a platform module toggle recomposes every open dashboard live. See Part C.3.
7. **"Inherited" framing carries no colleague name.** With the single-switch model and no per-user flag, the read-only panel shows whenever `setupComplete` and reads "This workspace is already set up · the rules you inherited" — never "Mara Kessler set this up" (unknowable without new state).
8. **Keep the existing dashboard body.** The "preview underneath" is the current `ProducerDashboard` / `ArtistDashboard` content, wrapped: greyed + `Sample` (with a small illustrative sample fixture) when `!setupComplete`, live otherwise. This feature does **not** re-lay-out the live dashboard into the prototype's stat/queue/week structure — that would replace the just-shipped cockpit-era dashboard and is out of scope (see Follow-ups).

## Non-goals (deferred — see Follow-ups)

Re-laying-out the live dashboard body to the prototype's exact stats/queue/week grid; per-user server-side onboarding state (and the named "your colleague set this up" copy it would enable); cross-device dismissal (localStorage per-browser is retained, matching the existing rails); onboarding for modules that don't exist yet (the registry makes adding them a one-contribution change, but we ship only the two real modules).

---

## Part A — Composition core (`src/lib/dashboard/`)

Pure, no React, no Supabase — fully unit-testable.

### A.1 Types & registry — `moduleOnboarding.ts`

```ts
export type DashboardRole = "admin" | "producer" | "artist";
export type SetupBlock = "offers" | "filling" | null; // reuse lib/bookings BlockKind vocabulary

export interface OnboardingStepMeta {
  title: string;        // reuse the engine's STEP_TITLES[key] where one exists
  todoHint: string;
  doneHint: string;
  ctaLabel: string;
  ctaRoute: string;     // a ROUTES.* constant, never a literal
  /** Capability the CTA requires. When the viewer lacks it, the step renders
   *  read-only (no CTA) — the producer "only an admin can do these" state. */
  ctaCapability?: CapabilityAction; // e.g. "edit_booking_settings", "edit_hire_order_settings"
}

export interface InheritedRule { title: string; hint: string; }

export interface ModuleOnboardingDef<StepKey extends string> {
  key: FeatureKey;
  /** Exhaustive per-step presentation, TYPED ON THE ENGINE'S OWN KEY UNION.
   *  Adding/removing/renaming an engine step is a compile error here. */
  steps: Record<StepKey, OnboardingStepMeta>;
  /** Read-only "how this org works" items, per role + resolved booking flow. */
  rules: (role: DashboardRole, ctx: OnboardingCtx) => InheritedRule[];
  /** Footer line shown when the module is NOT licensed (the upsell nudge). */
  offFooter: string;
}
```

`MODULE_ONBOARDING: Record<FeatureKey, ModuleOnboardingDef<string>>` holds the `booking_flow` def (typed `ModuleOnboardingDef<BookingSetupStepKey>`) and the `hire_orders` def (typed `ModuleOnboardingDef<SetupStepKey>`). Step **order and done-ness are never stored here** — they come from each module's `status.steps` at runtime (which is already ordered), so order cannot drift.

### A.2 Composition — `firstRun.ts`

Pure functions over already-fetched inputs:

- `composeOnboarding({ enabled, role, moduleStatuses, ctx }) → { steps: ComposedStep[], complete: boolean, rules: InheritedRule[], offFooters: string[] }`
  where `ComposedStep = OnboardingStepMeta & { key, done, block, moduleKey }`.
  For each **enabled** module: iterate its `status.steps` (ordered, each `{ key, done, block? }`), look up `MODULE_ONBOARDING[m].steps[key]` (guaranteed present by the exhaustive type), attach `done`/`block`. `complete` = every enabled module's `status.complete` (empty enabled set ⇒ panel suppressed, see B.1). `offFooters` = the `offFooter` of each **disabled** licensable module.
- `welcomeCopy(role, complete, ctx) → { eyebrow, headline, body, primaryLabel, secondaryLabel, progressLabel, progressFilled, progressTotal, progressHint }` — the panel's copy, parameterized by `orgName`, resolved `flow`, and live `counts`. Strings come from the prototype's `renderVals` (the nine role×state variants), with the org name and counts interpolated. Progress = done/total across composed steps.

`OnboardingCtx = { orgName, flow /* BOOKING_FLOW_DEFAULTS shape */, counts /* useNavCounts */ }`.

### A.3 Sample fixture

A compact static fixture (`SAMPLE_PREVIEW[role]`) lifted from the prototype's `centre(role)` — the greyed rows shown while `!complete` so the empty state reads as "what this page becomes," not a blank page. Sample rows never link or act.

---

## Part B — Components (`src/components/dashboard/firstRun/`)

### B.1 `useDashboardFirstRun(role)` — the composition hook

Because React forbids conditional hooks, this hook calls **every** module status hook unconditionally (each self-gates its own queries via `enabled:` and is cheap when its module is off), then selects the enabled set:

- `useEntitlements()` → `{ features, isLoading }`.
- `useBookingSetupStatus(orgId)` (admin/producer) and the artist personal readiness (B.4) for the `booking_flow` slice.
- `useHireOrderSetupStatus(orgId)` for the `hire_orders` slice.
- `useNavCounts()` for live counts in copy; `currentOrg`, `useBookingFlow` for `ctx`.
- `useRailDismissed("dashboardWelcome", orgId)` → `[dismissed, dismiss, undismiss]`.

Returns `{ show, complete, dismissed, steps, rules, offFooters, welcome, dismiss, undismiss, railOpen, openRail, closeRail }` by calling `composeOnboarding` + `welcomeCopy`. **No-flicker rule:** while `features.isLoading`, return `{ show: false }` (same stance as `useModuleGate`, which deliberately does not fail open) so a module that is actually off never flashes on. `show` is also false when the enabled set contributes zero steps (no licensable onboarding).

### B.2 Presentational components

- `DashboardWelcome` — accent hero: `bg-accent-500 text-white` block with eyebrow / headline / body / primary (`openRail`) + secondary (`dismiss`) buttons / progress dots (`bg-white/…` filled vs faint). Pure props from `welcome`.
- `DashboardWelcomeCollapsed` — the one-line chip (check icon + label + hint + a `Resume` / `How this org works` button that calls `openRail`; the whole feature can be recalled because `undismiss` is available, but per the prototype the chip stays and just reopens the rail).
- `DashboardSetupRail` — right-hand rail (`w-[340px]`). Header (eyebrow = progress, title, body, Close). Body = composed steps via the **existing** `SetupStepRow` primitive (done check / numbered todo, `hint`, optional `SetupStepBlock` chip from the module's `block`, and the CTA `Link` to `ctaRoute`). A step's CTA is shown only when the viewer holds its `ctaCapability` (`useCan`); otherwise the step is read-only — this is the prototype's producer "fresh" state ("only an admin can do these"), and the rail's header body swaps to the "why the page is empty, not so you can fix it" framing when *no* step is actionable for the viewer (parallel to the existing `BookingProducerWaitingCard`). Complete mode swaps the step list for the read-only `rules` list and shows the `offFooters` + a "Got it" (`dismiss`) affordance. Reuses `SetupStepRow`'s risk/neutral tones — no new chip tokens.
- `SamplePreview` — wraps the dashboard body. When `!complete`: renders the `SAMPLE_PREVIEW[role]` fixture inside a greyed container (`opacity-[.55]`) with a `Sample` chip and the "What this page becomes" section header; when `complete`: renders `children` (the real body) with the "Today · Live" header.

### B.3 Page wiring

- `DashboardPage.tsx` (`ProducerDashboard`) and `ArtistDashboard.tsx`: call `useDashboardFirstRun(role)`; render `DashboardWelcome` **or** `DashboardWelcomeCollapsed` (by `dismissed`) at the top, the `DashboardSetupRail` beside the body when `railOpen`, and wrap the existing body in `SamplePreview`. The two pages share all four components; only `role` and the body differ. Existing booking/hire-order sections inside the body keep their own `ModuleGate` guards untouched.

### B.4 Artist personal readiness

Artists have no org-engine setup hook, so a small `useArtistOnboardingStatus()` composes concrete personal signals into a `status.steps`/`complete` shape matching the engine contract (so `composeOnboarding` treats it uniformly):

- `accountLinked` — `useMyArtist()` present (done whenever the artist can see the dashboard).
- `notifications` — a phone number on `useMyProfile()` / configured `useNotificationPreferences()` (done once set).
- `blockDates` — inherently optional (an open calendar legitimately has zero blocks), so "done" is satisfied by **either** ≥1 of the artist's own `blocked_dates` **or** a per-user `useRailDismissed("artistBlockAck", …)` ack, so a genuinely-open artist can reach `complete`. Exact read finalized in the plan (AvailabilityPage already loads these rows).

Only `booking_flow` contributes to the artist experience today; if `booking_flow` is off for an artist's org, `show` is false (nothing to onboard).

---

## Part C — State, dismissal, runtime toggles

### C.1 The single switch

`setupComplete` = `composeOnboarding(...).complete`. `!complete` ⇒ welcome hero is "first-run" (steps rail) and preview is greyed `Sample`; `complete` ⇒ hero is "inherited/how this org works" (read-only rules) and preview is live. One value, both surfaces — the prototype's coupling.

### C.2 Dismissal

`useRailDismissed("dashboardWelcome", orgId)` (existing hook: per-org, per-browser localStorage; `dismiss`/`undismiss`; cross-tab via the shared store). Shown ⟷ collapsed chip. The chip always reopens the rail. Both the hero's "Later"/"Dismiss" secondary and the rail's "Got it" call `dismiss`.

### C.3 Runtime module on/off

- **Gap fixed:** add `{ table: "org_entitlements", keys: [["entitlements"]] }` to `REALTIME_INVALIDATIONS`, and ensure `org_entitlements` is in the Realtime publication (verify in the plan; add a migration only if it is not). The composition is backed by the `["entitlements", orgId]` query, so a platform toggle then recomposes every open dashboard within realtime latency — `setupComplete`, steps, rules, offFooters, and the greyed/live preview all follow.
- **On:** the module's steps/rules join; `setupComplete` may drop to false. If the hero was dismissed it **stays collapsed**, but the chip's "N steps left" hint updates from the recomposed step count — no surprise re-expansion.
- **Off:** the module drops out; `setupComplete` recomputes over the remaining modules; its `offFooter` upsell appears and the locked-nav upsell (already entitlement-driven in `visibleNavItems`) returns.

---

## Part D — Anti-drift guarantees (by construction)

1. **One readiness source per module.** `done`/`complete` come only from the module's existing status hook; the registry stores no second predicate.
2. **Compiler-enforced coverage.** `steps: Record<BookingSetupStepKey, …>` and `Record<SetupStepKey, …>` make a missing/renamed engine step a TypeScript error in the registry. `composeOnboarding` iterates the engine's ordered `status.steps`, so order is never duplicated.
3. **Shared titles + `ROUTES` only.** `OnboardingStepMeta.title` reuses the engine's exported `STEP_TITLES[key]`; every `ctaRoute` is a `ROUTES.*` constant (literal route strings are banned repo-wide). Renames land once.
4. **Registry parity test.** `moduleOnboarding.test.ts` asserts `Object.keys(MODULE_ONBOARDING).sort()` deep-equals `FEATURE_KEYS.sort()` — a new module with no contribution (or an orphan) fails CI, mirroring the repo's existing mirror-drift guards. A second assertion: for each module, `keys(def.steps)` equals the engine `status.steps` keys for a fixture status (catches a step the engine has but the registry's `Record` was widened to miss).
5. **Deep-link, never reimplement.** The dashboard edits no settings, so there is no editor that *can* fall out of sync with the real setup surfaces.

---

## Part E — Token mapping

DS token → repo utility (all already in `src/index.css`; semantic tokens only, no literals):

| DS | Repo |
|---|---|
| `--accent-500` hero bg / progress fill | `bg-accent-500` (≡ `bg-primary`), white text/`text-primary-foreground` |
| `--accent-100` / `--accent-700` active chip | `bg-accent-100` / `text-accent-700` (existing active-nav pattern) |
| `--text` / `--text-muted` / `--text-faint` | `text-foreground` / `text-muted-foreground` / a fainter muted (`text-muted-foreground/70`) |
| `--surface` / `--surface-2` / `--surface-3` | `bg-card` / `bg-muted/40` / `bg-muted` (segmented track) |
| `--line` / `--line-strong` | `border-border` / `border-border` (strong variant where present) |
| `--amber-*` "Blocks offers" chip | the existing `SetupStepRow` `tone:"risk"` (repo `--warning`), not a new token |
| radii `--radius-l/-xl` | `rounded-lg` / `rounded-xl` (hero) |
| `--shadow-2/-3` | `shadow-elev2` / `shadow-elev3` |

Exact utility names verified against `src/index.css` during implementation. Calendars/grids stay Monday-first (not applicable here — no grid).

---

## Part F — Testing plan (test-first)

Layer: Vitest + jsdom + `renderWithProviders` + `supabaseFake` (no `vi.mock` of the client).

**Pure (`src/lib/dashboard/`):**
- `firstRun.test.ts` — `composeOnboarding`: enabled-set filtering; `complete` AND-fold (incl. empty set ⇒ vacuous, drives `show:false`); `done`/`block` carried from status; `offFooters` from disabled modules. `welcomeCopy`: the nine role×state variants, org-name/count interpolation, progress math.
- `moduleOnboarding.test.ts` — the two **drift guards** (registry parity vs `FEATURE_KEYS`; per-module step-key coverage vs a fixture engine status).

**Components (`firstRun/`):**
- `DashboardWelcome` / `DashboardWelcomeCollapsed` — copy per role×complete; primary opens rail, secondary dismisses.
- `DashboardSetupRail` — fresh renders composed steps with CTAs to the right `ROUTES`; block chip shows for blocking steps; complete renders read-only rules + offFooters; Close/Got-it.
- `SamplePreview` — greyed + `Sample` fixture when `!complete`; real children when complete.
- `useDashboardFirstRun` — no-flicker while entitlements load (`show:false`); recomposition when the entitlement set changes (simulate an `["entitlements"]` cache change → steps/complete update); dismissal persists via `useRailDismissed`.

**Regression:** `DashboardPage.moduleGate.test.tsx` / `ArtistDashboard.*` still green (the wrap must not disturb existing gated sections).

---

## Part G — Files touched (anticipated)

**New — pure:**
- `src/lib/dashboard/moduleOnboarding.ts` (+ `.test.ts`)
- `src/lib/dashboard/firstRun.ts` (+ `.test.ts`)

**New — components:**
- `src/components/dashboard/firstRun/useDashboardFirstRun.ts` (+ `.test.ts`)
- `src/components/dashboard/firstRun/useArtistOnboardingStatus.ts`
- `src/components/dashboard/firstRun/DashboardWelcome.tsx` (+ `.test.tsx`)
- `src/components/dashboard/firstRun/DashboardWelcomeCollapsed.tsx`
- `src/components/dashboard/firstRun/DashboardSetupRail.tsx` (+ `.test.tsx`)
- `src/components/dashboard/firstRun/SamplePreview.tsx` (+ `.test.tsx`)

**Changed:**
- `src/pages/DashboardPage.tsx` — wrap `ProducerDashboard` with welcome/rail/sample.
- `src/components/dashboard/ArtistDashboard.tsx` — same wrap (artist slice).
- `src/features/auth/realtimeInvalidations.ts` — add the `org_entitlements → ['entitlements']` row (+ its parity test `realtimeInvalidations.test.ts` if present).

**Possibly (verify first):** a migration adding `org_entitlements` to the Realtime publication — only if it is not already published.

---

## Risks & mitigations

- **Two "setup done" definitions drift.** Mitigated structurally (Part D): single readiness source + compiler coverage + parity test. There is no place to write a competing predicate.
- **Runtime toggle doesn't reach open clients.** Mitigated by the `REALTIME_INVALIDATIONS` addition; verified by a recomposition test and a manual toggle in the browser preview.
- **Artist "blockDates" never completes** (open calendar). Mitigated by the ack-or-data predicate (B.4).
- **Preview divergence from the real dashboard.** Accepted and scoped: we wrap the existing body rather than rebuild it; the sample fixture is explicitly illustrative. Rebuilding the body to the prototype layout is a Follow-up.
- **Hero contrast in dark mode.** `bg-accent-500` + white text is AA on the DS dark ground (the accent scale is mode-stable by design); verified in the preview's dark theme.

## Follow-ups (deferred)

Re-lay-out the live dashboard body to the prototype's stats/queue/week grid (a dashboard redesign in its own right); per-user server-side onboarding state to enable named "your colleague set this up" copy and cross-device dismissal; onboarding contributions for future modules (already a one-file change via the registry).
