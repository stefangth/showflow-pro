# CLAUDE.md — Showflow Pro

Guidance for AI coding agents (Claude Code and others) and new developers. Read this before writing any code.

## UI work: read this before writing a component

`docs/ui-conventions.md` is the spec. It wins over `Design System/`, which is brand
history and describes an older product framing (ADR 0012). Do not take conventions,
copy voice or component behaviour from that folder.

Hard rules, in order of how often they are broken:

1. **Check `src/components/ui` first.** 58 primitives exist. If one is close, use it with
   `className`. Do not write a local version. The eight most-reimplemented patterns are
   now primitives too: `Eyebrow`, `StatusPill`, `StatusDot`, `KpiTile`, `EmptyState`,
   `Metric`, `CountChip`, `PageHeader`. `Token` joins them: it is the only way to render
   Geist Mono in feature code, and only a machine token earns it (see rule 8).
2. **No raw values.** No hex, no `rgba()`, no `text-[13px]`, no `rounded-[10px]`, no
   `bg-foreground/[0.04]` outside `src/components/ui`. `eslint/ui-conventions.js` is wired
   into the CI gate (Wave 2) and runs at `--max-warnings 0`, so a raw value fails the
   build. Write token-clean regardless: use the `fontSize` scale (`text-control` etc.),
   the radius scale (`rounded-chip|field|control|card|icon|pill`), and semantic colour
   tokens.
3. **13px is the control size.** Buttons, inputs, table cells, nav rows. 14 is body.
   11 is the eyebrow.
4. **Uppercase text is `<Eyebrow>`.** Never hand-write
   `text-[11px] font-semibold uppercase tracking-[1.6px]`.
5. **Status colour comes from `TONES`.** Never a local tone map. Amber is waiting, red is
   risk.
6. **No dashes in copy.** Em and en dashes fail CI in both languages. Use a period, a
   colon, or "to" for a range. No exclamation marks, no emoji. German is Du-form.
7. **Plain language in the UI, domain terms in code.** The label is "Waiting on you";
   the identifier is `hold`. New user-facing terms go in `src/i18n/terms.ts`.
8. **Numbers are `<Metric>`.** Geist Sans, tabular figures, always. Mono is only for
   machine tokens: ids, reference numbers, keys, scopes, function names, status codes,
   versions. Those are `<Token>`. If a person reads it aloud as a quantity, a date, or
   a time, it is a `<Metric>`, not a token.

If you believe a rule is wrong, change `docs/ui-conventions.md` in the same PR and say so
in the description. Do not route around it.

> Do **not** put secrets, API keys, sprint goals, or current task lists here. See `memory.md` for living project state.

---

## What this project is

**Showflow Pro** is an artist booking SaaS for live show productions. Producers schedule shows and dates; artists declare availability; the system suggests, soft-books, and confirms bookings — replacing spreadsheets and email chains.

Scale target: 50+ active shows, 200+ artists, multi-venue.

---

## Tech stack

- **Frontend:** React 18, Vite 5, TypeScript 5
- **Styling:** Tailwind CSS v3 + shadcn/ui (Radix primitives), `framer-motion` for animation
- **Routing:** `react-router-dom` v6
- **Data:** `@tanstack/react-query` v5 for all server state
- **Forms:** `react-hook-form` + `zod`
- **Backend:** Supabase (external project, **not** Lovable Cloud) — Postgres, Auth, Edge Functions, Realtime
- **Notifications:** `sonner` (toasts), in-app `notifications` table

---

## Build / test / lint

**npm is the only supported package manager for root Node dependencies.**
`package-lock.json` is authoritative: use `npm ci` for a reproducible install and
`npm install` when intentionally adding or updating dependencies, committing the
resulting `package.json` and `package-lock.json` changes together. Do not create
`bun.lock`, `bun.lockb`, `yarn.lock`, or `pnpm-lock.yaml`. Deno lockfiles under
the repository are separate runtime state for Supabase Edge Functions and are
not covered by this npm-only rule.

```bash
npm ci               # reproducible install from package-lock.json
npm run dev          # local dev server (Vite, port 8080)
npm run build        # production build
npm run lint         # eslint (zero-warning gate: --max-warnings 0)
npx vitest run       # unit tests (vitest + jsdom; setup in src/test/setup.ts)
npm run test:coverage # what CI runs: the same suite + the coverage thresholds
npm run test:watch   # vitest watch mode
```

**Type-checking is split across three projects** — run all three, none of them subsumes the others:

```bash
npx tsc -p tsconfig.app.json --noEmit    # src/
npx tsc -p tsconfig.tools.json --noEmit  # e2e/, scripts/*.test.ts, build configs
deno check --node-modules-dir=none supabase/functions/*/index.ts  # the edge runtime
```

CI runs `vitest run --coverage` (not a bare `vitest run`): the thresholds in `vitest.config.ts` only apply under `--coverage`, and the suite is executed exactly once — do not add a second job that re-runs it uninstrumented.

### Running locally against a local database

**`npm run dev` targets a LOCAL Supabase stack, not production.** The committed `.env.development` points Vite at `127.0.0.1`; production is the explicit opt-in `npm run dev:prod` (watch the `▶ Supabase: LOCAL|PRODUCTION` banner the dev server prints). This is what lets agents work without mutating real customer data. One-time: install a container runtime (OrbStack) + `npm run local:setup`. Each session: `npm run local:up` (boots the stack, applies migrations + `seed.sql` → logins `admin@`/`producer@`/`artist@example.com`, password `showflow-dev`; writes the gitignored `.env.development.local` with the live keys), then `npm run dev`. Stop with `npm run local:down`; wipe/re-seed with `npm run local:reset`.

Run the CI stack locally with the two-tier convention: **`npm run verify:fast`** (Docker-free inner loop — lint, typecheck, build, unit+coverage, Deno) and **`npm run verify:full`** (adds pgTAP + Playwright e2e; needs the local stack). These, plus the secret scan (`npm run scan:secrets`), are **invoked manually** — there is no auto-installed git hook (an earlier `pre-push` hook wired via `core.hooksPath` → `.githooks/` was removed, so `npm ci` no longer touches `core.hooksPath`). CI runs the same suite on every PR push regardless (`.github/workflows/ci.yml`) and is the enforced gate; a successful fast/full result is cached and reused when the exact source snapshot is unchanged. Full runbook: [`docs/runbooks/local-development-stack.md`](docs/runbooks/local-development-stack.md).

Edge functions deploy automatically **on merge to `main`** via `.github/workflows/deploy-functions.yml`: the Supabase CLI deploys every function in `supabase/functions/` to the live project (`epweartpzwvcasrzyueh`). No manual deploy step for changes that land on `main`. When you add a **new** function, give it a `[functions.<name>]` block in `supabase/config.toml` (default `verify_jwt = true`; set `false` for public webhooks and cron callers that use `X-Cron-Secret`) — an unlisted function would deploy with JWT verification forced on and break those callers. To deploy off-cycle (a backfill, or before a merge) run the workflow manually (Actions → "Deploy Edge Functions" → Run workflow) or use the Supabase MCP `deploy_edge_function`. Removing a function still needs a manual `supabase functions delete <name>` — the deploy never deletes.

---

## Environment setup

Create a `.env` file at the repo root with:

```
VITE_SUPABASE_URL=https://<project-id>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
VITE_SUPABASE_PROJECT_ID=<project-id>
```

These are public values (anon key, not service role). Never commit `.env`. The service role key is used only inside edge functions via `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`.

**Optional PostHog analytics.** Set `VITE_POSTHOG_KEY` (the public `phc_…` project key) to enable product analytics; `VITE_POSTHOG_HOST` defaults to EU Cloud (`https://eu.i.posthog.com`) — override only for US Cloud or self-hosted. Leaving `VITE_POSTHOG_KEY` unset keeps PostHog fully dark (the integration no-ops), which is the default for local/dev. PostHog is **consent-gated**: `src/features/analytics/AnalyticsBridge.tsx` (mounted inside `ConsentProvider`) feeds the GDPR `ConsentChoices` into the pure `applyConsent` state machine in `src/features/analytics/posthog.ts`. PostHog is not initialized until a visitor opts into `analytics` or `errorTracking`; `analytics` → autocapture + browser-history pageviews, `sessionReplay` → session recording, `errorTracking` → exception capture (`capture_exceptions`), and withdrawing all consent opts out + resets the distinct id. `AnalyticsIdentityBridge` identifies consented authenticated users with their Supabase UUID and `$email` only; no names or profile fields. `AppErrorBoundary` routes caught React render errors through the same error-tracking consent gate. PostHog is the disclosed processor for **all three** categories (`CookieConsentDialog` + privacy policy EN/DE name PostHog, 12-month retention) — there is no Sentry integration, so never reintroduce Sentry-labelled copy for `errorTracking`. Never add a bare `posthog.init()` — route every capture-state change through `applyConsent`.

**PostHog source maps.** Production Vite builds upload source maps only when all server-only variables are present: `POSTHOG_API_KEY` (a personal key with error-tracking write and organization-read scopes), `POSTHOG_PROJECT_ID=246246`, and `POSTHOG_HOST` (EU: `https://eu.posthog.com`; US: `https://us.posthog.com`). The public runtime host and management host must use the same region (`eu.i.posthog.com` ↔ `eu.posthog.com`, or US equivalents). The Rollup plugin deletes uploaded source maps from the build artifact. Vercel supplies `VERCEL_GIT_COMMIT_SHA` for the release version; builds outside Vercel fall back to `package.json`'s version. Missing build variables skip upload safely. Never expose `POSTHOG_API_KEY` through a `VITE_` variable.

**Optional local dev auto-login.** To skip the login screen while running `npm run dev`, set `VITE_DEV_AUTOLOGIN=true` plus `VITE_DEV_AUTOLOGIN_EMAIL` / `VITE_DEV_AUTOLOGIN_PASSWORD` (a real account for this project's Supabase) in your gitignored `.env` — `AuthProvider` then auto-signs-in on mount so gated routes render. It's an ordinary password sign-in (RLS is unchanged) and the whole path is guarded by `import.meta.env.DEV`, so it is dead-stripped from production builds and can never run on a deployed server. Keep these vars unset in any hosting provider. See `src/features/auth/devAutoLogin.ts`. (When running against the LOCAL stack, these are already set for you in the committed `.env.development` — autologin as the seeded `admin@example.com` — so you don't need them in `.env`; see the [local-development-stack runbook](docs/runbooks/local-development-stack.md).)

---

## Git workflow

- **Branch naming:** `feature/<short-desc>`, `fix/<short-desc>`, `claude/<short-desc>`
- **Commit messages:** imperative, lowercase, ≤72 chars (e.g. `add artist availability calendar`)
- **Claude Code sessions** develop on the branch specified at session start (see `memory.md` for current active branch).

---

## Versioning & changelog

- **Semver tags on releases.** Tag the release commit `vMAJOR.MINOR.PATCH` (`git tag -a v1.4.0 -m "<theme>"` then `git push origin --tags`). MINOR = new user-facing features, PATCH = fixes, MAJOR = breaking changes. Tags exist through `v1.9.0` (all of `v1.4.1`–`v1.9.0` were cut in one catch-up batch on Jul 15, 2026) — every release since (`1.9.1`–`1.15.0`, current) has shipped without a tag; catch up the tagging when convenient, don't skip it going forward.
- **Bump the version in two places to match the tag:** `version` in `package.json` and `APP_META.VERSION` in `src/config/app.config.ts` (the latter renders next to the brand name in the top-left of `AppLayout`).
- **Update `public/changelog.md`** (the single source of truth). Add a newest-first block: `## X.Y.Z — Mon D, YYYY`, a one-line `*theme*`, then `### New` / `### Improved` / `### Fixed` bullets written for end users (no refactors, tests, CI, or docs). Bullets use the form `- **Title** — description`. Never mention super-admin or platform-admin actions (Platform console, org provisioning, org-module toggles, etc.) — there is no public super-admin or platform-admin role, so those changes have no customer-facing angle and don't belong in this file at all.
- **Regenerate the JSON:** `deno run --allow-read --allow-write scripts/changelog-to-json.ts` rewrites `public/changelog.json` from the markdown — never hand-edit the JSON.
- **Both files are served publicly** at `/changelog.md` and `/changelog.json` with `Access-Control-Allow-Origin: *` (see `vercel.json`) and consumed by the standalone landing-page repo. Don't rename or move them without updating the landing page.
- **The dependency runs both ways.** `CHANGELOG_URL` in `src/config/app.config.ts` points the in-app version pill at the landing page's `/changelog` route. Nothing in this repo can typecheck or test that route, so renaming it there silently 404s the pill — change it in both repos together.

---

## Architecture

```
src/
  components/
    admin/         # Admin-only UI. people/ — the unified People pane (Admin > People):
                   #   PeopleTab (orchestrator: one search over pending invites + members),
                   #   InviteBar (inline invite + live duplicate detection + bulk trigger),
                   #   BulkInviteDialog, InviteRow, MemberRow, and pure helpers
                   #   peopleMatch.ts (isValidEmail/parseEmails/matchContact/filterPeople) +
                   #   roleOptions.ts (shared ROLE_OPTIONS)
    artists/       # ArtistProfileSheet
    availability/  # ArtistAvailabilityCalendar, AvailabilityPicker, OfferResponseButtons
    bookings/      # ArtistBookingsView and booking surfaces
                   #   + setup/ (FirstOfferCard — one-time dismissible explainer shown to an
                   #   artist while they have a pending offer; FlowStep, TimingStep, RehearsalBlock,
                   #   SlotsStep — step bodies reused inside the Get Running v3 wizard, not a
                   #   standalone rail. The old BookingSetupRail/BookingProducerWaitingCard/
                   #   EligibilityStep/LadderStep producer-facing rail was retired when Get Running
                   #   v3 became the single onboarding surface — see `getRunning/` below)
    brand/         # StageMark — brand mark SVG (variants: mono outline "mark", violet tile "tile")
    calendar/      # EntityCalendar (shared month grid)
    casts/         # Cast grouping UI (dialog, sheet, section)
    chat/          # ChatPanel, MessageBubble (per-show-date threads)
    common/        # IconTooltip — shared tooltip-wrapped-icon-button helper
    consent/       # CookieConsentBanner (bottom-fixed GDPR banner), CookieConsentDialog (per-category toggles)
    dashboard/     # ArtistDashboard only — rendered by DashboardPage (ROUTES.DASHBOARD, /today)
                   #   for artist-only users. The old `firstRun/` onboarding rail (DashboardWelcome,
                   #   DashboardSetupRail, SamplePreview, …) was retired with the Get Running v3
                   #   cutover; admins/producers now get the Autopilot Today board instead (see
                   #   `today/` below)
    today/         # Autopilot Today — the steady-state ROUTES.DASHBOARD (/today) home for
                   #   admins/producers (TodayPage.tsx exports `TodayContainer`): TodayHeader, DateRail,
                   #   AtRiskDateCard, CancelledUntoldCard, BouncedAsksBanner, DoneForYouFeed,
                   #   TodayEmpty + pure helpers feedRowText.ts/joinNames.ts. Data via
                   #   useAutopilotToday (src/data/autopilot.ts). Never redirects; the one-time
                   #   "is this org still mid-setup, send them to Get Running instead" decision
                   #   lives at the app root in `features/auth/HomeLanding.tsx`, not here
    getRunning/    # The Get Running v3 onboarding board (route `/get-running`, admin/producer
                   #   only) — the single unified setup wizard that replaced the old per-module
                   #   dashboard/bookings/hire-orders setup rails. HowThisOrgWorks.tsx (read-only
                   #   reference card, now surfaced from Settings); panels/ (PeoplePanelBody,
                   #   LadderPanelBody, EligibilityPanelBody, TeamPanelBody, CastRosterList,
                   #   UnlocksNote, + panels/airtable/ AirtableConnect*); v3/ (GetRunningBoardV3 —
                   #   the board shell, WizardShell, stepRegistryV3, FinishSetupLink,
                   #   GetRunningSettingsMirror, StepComingSoon, WizardFooterContext/
                   #   WizardFooterAction; board/ — HeroCard, StillShutCard, PhaseIconRail,
                   #   PhaseRow; steps/ — SourceStep, ConnectStep, MapStep, CitiesStep,
                   #   ProductionsStep, SkillsStep, FeeStep, DocumentStep, ArtistSkillAssignList,
                   #   DatesMissingCityList, PartsEditorSheet — plus reused step bodies from
                   #   `bookings/setup/` and `hireOrders/setup/`). Copy/step model lives in
                   #   `src/lib/getRunning/` (steps.ts is the current v3 16-step composer;
                   #   tasks.ts is an older v1 11-task composer still used by `HomeLanding` and
                   #   `AcceptInvitePage` for the "is setup done" redirect check — the two models
                   #   can disagree since v3 merged v1's `ladder`+`eligibility` into one `coverage`
                   #   step; worth reconciling)
    demo/          # Sales Demo Mode UI (visible only inside an `is_demo` org): DemoBar
                   #   (top bar: scene selector, sim clock, reset/wipe, outbox, sandbox-link
                   #   dialog), DemoBadge (sidebar "DEMO" pill), DemoOutbox (captured-send
                   #   viewer), RunOfShowRail, SceneSelect + SandboxLinkDialog — mints/revokes
                   #   `demo_sandbox_links` rows (via useCreateSandboxLink/useRevokeSandboxLink/
                   #   useSandboxLinks in src/hooks/useDemo.ts) and copies the public
                   #   `/sandbox/:token` URL (SandboxViewerPage) for a leave-behind demo tour
    filters/       # Reusable filter/sort/view-toggle controls
    help/          # HelpPage (`/help`) support: HelpRoleTabs, HelpFilters, HelpStageSection,
                   #   HelpItemRow, HelpGlossary, HelpFooterCards — renders the typed bilingual
                   #   FAQ data module at `src/lib/help/items.ts` (see the Help center checklist item)
    platform/      # Super-admin platform console UI (OrganizationsTab, PlatformAdminsTab,
                   #   PlatformDefaultsTab, EditOrgDialog, NewOrgDialog, OrgInvitePopover,
                   #   OrgMembersPopover, SystemHealthTab, UsersTab + UserDetailSheet — a cross-org
                   #   searchable user directory backed by platform-list-users/platform-manage-user,
                   #   letting a super-admin add/remove org memberships, link an artist, change
                   #   email, force a password reset, suspend/unsuspend, or delete) + pure utilities
                   #   (platformFormat.ts, templateText.ts) + systemHealth/ (OverallStatusBanner,
                   #   DomainSummaryGrid, EdgeFunctionsPanel, ScheduledJobsPanel, UptimeBar,
                   #   RecentRunsList, primitives)
    catalog/       # Production catalog CRUD: ShowFormDialog (create/edit shows) + ProductionsPage support
    shows/         # ShowDateDetailSheet — the full per-date booking management surface;
                   #   ShowDateFormDialog — create/edit show_dates (in-app);
                   #   date/ (CockpitShell, CockpitHeader, CockpitRail, CockpitFooter, CockpitPager,
                   #   CockpitCastList, TierTimeline, SlotMeter, DryRunDialog, EligibilityBookList,
                   #   RequiredSkillsSection — the "show date cockpit": header + fill meter + one
                   #   primary action, sticky facts/activity rail, tabs for cast/offers/hire-order/
                   #   chat/setup — this is the internal layout of ShowDateDetailSheet);
                   #   hireOrders/ (HireOrdersCard + GenerateHireOrderDialog: the per-date
                   #   hire-order surface embedded in ShowDateDetailSheet, feature-gated)
    hireOrders/    # Shared hire-order document primitives (OrderFactsRail, OrderTimeline)
                   #   used by the HireOrderDetailPage viewer; edit/ (FieldSection, ProvenanceChip,
                   #   SetupCallout — support for HireOrderEditPage); import/ (HireOrderImportDialog +
                   #   MapStep/RangeStep/ResolveStep/ReviewStep — bulk hire-order import wizard);
                   #   setup/ (CountersignStep, LetterheadStep, TermsStep — step bodies reused
                   #   inside the Get Running v3 wizard; the old SetupRail/ProducerWaitingCard
                   #   standalone checklist was retired with that cutover, see `getRunning/` above)
    settings/      # AirtableSyncTab (schema-driven mapping + catalog linking), OrganizationTab,
                   #   CastsCitiesTab, ProductionOwnershipTab, DocumentationTab (+ MarkdownDoc,
                   #   SystemMapCanvas, SystemMapReference — Settings → Documentation → System Map),
                   #   hireOrders/HireOrdersTab (Letterhead, Numbering, OrderDefaults,
                   #   TermsVariants, Countersign cards; Settings > Hire orders, admin-only)
                   #   + hireOrders/fields/ (CountersignFields, LetterheadFields, TermsLibraryPicker
                   #   — extracted field groups reused by the Hire-orders settings cards)
                   #   + hireOrders/template/ (the PDF template WYSIWYG editor at
                   #   ROUTES.HIRE_ORDER_TEMPLATE: outline / live browser-rendered PDF /
                   #   inspector panes over the semantic role registry in
                   #   src/lib/hireOrders/pdf/pdfTheme.ts)
                   #   + emailTemplates/ (Settings → Email templates: EmailTemplatesTab, the coverage
                   #   registry of every transactional email with trigger/recipient/status + preview,
                   #   and EmailTemplateEditorPage at ROUTES.EMAIL_TEMPLATE over email_copy/email_theme;
                   #   gated by the edit_email_templates capability)
                   #   + templateEditor/ (domain-neutral editor kit — shell, generic outline, copy +
                   #   role-style controls, override-map helpers — shared by the PDF and email editors)
                   #   + bookingFlow/ (BookingFlowTab, FlowPresets, FlowRail, FlowTimeline, auditKeys.ts
                   #   — Settings → Booking Engine / Booking Flow: response window, digest hours,
                   #   flow presets, and the settings-change audit trail from src/data/settingsAudit.ts)
                   #   + rolesRights/ (RolesRightsTab, RightGroupCard, RightRow, EditingPickerCard,
                   #   StagedChangesCard, ChangeLogDialog — Settings → Roles and rights, the
                   #   org-admin UI over the src/lib/capabilities.ts registry)
                   #   + permissions/ (PermissionsMatrix, PermissionRow — the super-admin
                   #   platform-mode capability editor embedded in
                   #   src/components/platform/EditOrgDialog.tsx; the org-admin surface moved to
                   #   rolesRights/ above)
                   #   + trust/ (TrustDataTab, OrgDataCard, VisibilityMatrix, RetentionCard,
                   #   YourDataCard, DocumentsCard — Settings → Trust & data, the in-app half of
                   #   the Trust Center; renders src/lib/trust/facts.ts scoped to the active org)
    setup/         # useRailDismissed only — per-person dismissal used by
                   #   `useGetRunningNavVisible` and `FirstOfferCard`. The rest of the old shared
                   #   module-onboarding-rail chrome (SetupChecklistSheet, SetupStepRow,
                   #   setupRailMode.ts, useModuleOnboardingRail) was retired with the Get Running
                   #   v3 cutover — see `getRunning/` above
    layout/        # AppLayout (sidebar + topbar shell), NotificationsList (notification bell popover)
    minis/         # Page minis: PageMini (frame: pure PageMiniView + thin container),
                   #   atoms.tsx (token-only miniature atoms) and illustrations/<Page>Mini.tsx
                   #   (four illustration nodes per route, barreled by illustrations/index.ts ART).
                   #   Copy lives in src/lib/minis. See the New page checklist.
    ui/            # shadcn primitives — DO NOT edit by hand, regenerate via shadcn
  config/
    app.config.ts  # ROUTE_FEATURES (entitlement-gated routes), route constants (ROUTES), BOOKING_ENGINE_DEFAULTS, CHAT_ARCHIVE_DAYS
  data/            # Data-access layer: fetchX(client, args) / mutateX(client, args) functions
                   #   that take the Supabase client as a parameter. Hooks are thin wrappers.
                   #   Domains: account, admin, artistImport, artists, airtableKey, airtableMapping,
                   #   airtableSchema, airtableSettings, airtableSync, authLinks (requestLoginLink,
                   #   magic-link login), blockedDates (artist self-declared blocked dates,
                   #   explicitly active-org-scoped), bookings, capabilities (org capability rows
                   #   backing src/lib/capabilities.ts), casts, chats, cities, customFields,
                   #   demo (sales Demo Mode: resetDemoOrg/wipeDemoOrg/createDemoOrg + demo-ops
                   #   invocation, demo_captured_sends outbox, demo_state sim clock/scene,
                   #   demo_sandbox_links — the leave-behind read-only link — createSandboxLink/
                   #   revokeSandboxLink/fetchSandboxLinks plus fetchSandboxSnapshot which reads
                   #   the public sandbox-view function),
                   #   eligibility (show/date required-skill union), emailTemplates, entitlements,
                   #   hireOrders, invitations, members, notificationPreferences, notifications, orgs,
                   #   platform, platformUsers (cross-org user directory + membership/artist-link/
                   #   manage-user actions backing Platform → Users), profiles, remoteSheet, settings,
                   #   settingsAudit (settings change-audit log), shows, showDates, showAssignments
                   #   (production ownership, explicitly active-org-scoped), skills, systemMap,
                   #   autopilot (Autopilot Today board reads), tierLadder (client mirror of the
                   #   server tier-ladder resolver, cast-per-tier for the Offers cockpit),
                   #   trustStats (Settings → Trust & data org counts), orgAdmins (admin display
                   #   names via `list_org_admin_names`), castProductionFees (per cast×production
                   #   fee overrides), datesSource (org's chosen Get Running dates-wizard source:
                   #   airtable/sheet/manual), sheetImport (saved published-CSV URL + column map
                   #   for the sheet dates source), slots (named `show_slots` rows backing the
                   #   slot-row repeater on ShowFormDialog).
                   #   Test with supabaseFake.ts (never vi.mock the client).
  features/
    auth/          # AuthContext (org-aware: currentOrg/orgs/switchOrg, isSuperAdmin),
                   #   realtimeInvalidations.ts (REALTIME_INVALIDATIONS table→query-key map),
                   #   ProtectedRoute (org gate → NoOrgScreen / SuspendedOrgScreen;
                   #   super-admins bypass org gate and suspended-org check),
                   #   PlatformRoute (super-admin-only gate for /platform, no org required),
                   #   orgRoles.ts (multi-org role utilities),
                   #   resetPassword.ts (pure hash-parse / redirect-safety / schema helpers)
    consent/       # ConsentContext, ConsentProvider, useConsent hook — localStorage-backed GDPR consent state
                   #   (key: showflow.consent.v1; categories: analytics, sessionReplay, errorTracking)
                   #   ConsentProvider wraps the routing tree (inside BrowserRouter, outside AuthProvider/EditorProvider).
    editor/        # Super-admin-only UI editor: EditorContext, EditorToolbar, EditorSidePanel,
                   #   ColumnLayoutEditor, columnRegistries, types,
                   #   editorAccess.ts (canUseEditor — the super-admin-only gate
                   #   shared by the provider, toolbar, toggle and AppLayout).
                   #   Persists page access / column templates / table permissions in
                   #   app_settings (keys: editor_page_access, editor_column_templates,
                   #   editor_table_permissions). EditorProvider wraps the whole app.
                   #   Read-only hook for page components: useEditorConfig().
  hooks/           # Domain hooks (useMyArtist, useEligibleArtists, useChatParticipant,
                   #   useArtistEligibleDates, useSettingsWarnings,
                   #   useSkills/useArtistSkills, useNotifications/useMarkNotificationRead/
                   #   useMarkAllNotificationsRead, useNotificationPreferences,
                   #   useMyProfile/useUpdateMyProfile,
                   #   useOrgMembers/useRemoveOrgMember/useSetOrgMemberRole,
                   #   usePendingInvitedArtists, usePendingArtistInvitations (pending artist-role
                   #   invitations for the Artists-page revoke/resend controls),
                   #   useInvitationMutations (shared create/resend/revoke for the People pane),
                   #   useNavCounts (sidebar badge counts),
                   #   useSystemHealth (useCronHealth, useEdgeFnLogs/Metrics, useEmailHealth,
                   #   useHealthDaily), useShows/useShowDates/useCities/useAllCities,
                   #   useBookingFlow (effective org booking-flow policy), useBookingSetup
                   #   (booking-flow Get Running step readiness), useHireOrders (draft/issue/preview/
                   #   download-url actions, terms, useDatesReadyForHireOrder), useHireOrderSetup
                   #   (hire-orders Get Running step readiness), useOrderBlockers (issuing blockers),
                   #   useMyBlockedDatesCount, usePlatformUsers (Platform → Users query/mutations),
                   #   useSettingsAudit,
                   #   useAutopilotToday (Autopilot Today board data), useNeedsYouCount (org-wide
                   #   "Needs you" sidebar badge count), useTierLadder (tier→cast map + per-tier
                   #   headcounts), useDerivedDraft (edit-tracking draft-as-view-of-server-value
                   #   pattern), useCastProductionFees, useBookingFlowProvenance ("rules set by
                   #   admin/producer X" line), useOrgAdminNames, usePasswordStatus (whether the
                   #   user has a password set), useTrustStats/useOrgDataStats (Trust & data tiles),
                   #   useAirtableConsole (Settings Airtable console queries), useAirtableDatesReady
                   #   (lightweight Airtable-ready check for Shows & Bookings), useShowSlots
                   #   (ShowFormDialog slot repeater), useGetRunning/useGetRunningV3/
                   #   useGetRunningNavVisible (see `getRunning/` in the components tree above —
                   #   note useGetRunning's v1 task model and useGetRunningV3's v3 step model can
                   #   disagree on whether setup is "done")
                   #   + UI hooks (use-mobile, use-toast)
  integrations/
    supabase/
      client.ts    # Single shared Supabase client
      types.ts     # AUTO-GENERATED — never edit
  lib/             # Shared utilities: utils.ts (cn helper), dates.ts (parseDateOnly,
                   #   formatDateDMY, formatDateWithWeekday, toDateKey — all timezone-safe),
                   #   avatar.ts, bookings.ts, catalog.ts (isSyncedShow/Date, canHardDeleteShow/Date),
                   #   settings.ts (dedupeProgramPairs, effectiveSlots), singleFlight.ts,
                   #   hireOrders/kpis.ts (computeOrderKpis), entitlements.ts + capabilities.ts
                   #   (the two per-org gating registries, see Key files table), identity.ts
                   #   (re-exports the login-email-first contact resolution from
                   #   _shared/identity.ts — see ADR-0011), notificationCategories.ts,
                   #   minis/ (page-mini content: types.ts, pages/<page>.ts bilingual MiniDefs,
                   #   index.ts MINIS registry, resolveMiniRole; illustrations live in
                   #   src/components/minis. See the New page checklist)
  pages/           # One file per route, default-exported
                   #   Key pages: DashboardPage (ROUTES.DASHBOARD, /today) — always renders,
                   #     never redirects: ArtistDashboard for artist-only users, Autopilot Today
                   #     (`components/today/TodayContainer`) for everyone else. `ROUTES.HOME`
                   #     ('/') renders HomeLanding instead — a one-time post-login redirect
                   #     decision (Get Running vs. Dashboard), not a page of its own,
                   #   GetRunningPage (ROUTES.GET_RUNNING, /get-running) — thin admin/producer-gated
                   #     wrapper around GetRunningBoardV3, the unified setup wizard,
                   #   HelpPage (ROUTES.HELP, /help) — role-aware Help center over `src/lib/help/items.ts`,
                   #   ShowsBookingsPage (ROUTES.BOOKINGS),
                   #   ProductionsPage (ROUTES.PRODUCTIONS) — admin+producer catalog CRUD + drag-reorder,
                   #   ArtistsPage (admin+producer), AvailabilityPage (artist),
                   #   AdminPage, SettingsPage, ChatsListPage
                   #   ProfilePage (ROUTES.PROFILE) — user profile + in-app password change
                   #   ResetPasswordPage (ROUTES.RESET_PASSWORD) — request + set (public, no auth)
                   #   PlatformPage (ROUTES.PLATFORM) — super-admin console; uses PlatformRoute
                   #   HireOrdersPage (ROUTES.HIRE_ORDERS, /hire-orders) — list page (KPIs, table,
                   #     slide-over, new-order wizard, import dialog), links out to Get Running via
                   #     FinishSetupLink when setup isn't done; feature-gated
                   #   HireOrderDetailPage (ROUTES.HIRE_ORDER_DETAIL, /hire-orders/:id): the
                   #     single hire-order viewer (admin/producer/artist; feature-gated route)
                   #   HireOrderEditPage (ROUTES.HIRE_ORDER_EDIT, /hire-orders/:id/edit) — edit a
                   #     draft order's snapshotted fields before issuing; feature-gated
                   #   EmailTemplateEditorPage (ROUTES.EMAIL_TEMPLATE) — WYSIWYG editor over
                   #     email_copy/email_theme for one transactional template + live preview;
                   #     gated by the edit_email_templates capability
                   #   AuthCallbackPage (ROUTES.AUTH_CALLBACK, /auth/callback, public) — landing
                   #     page for magic-link and invite-link sign-in; parses the auth hash, then
                   #     redirects via safeRelativeRedirect to the caller's ?redirect= path
                   #   FeatureDisabledScreen — shown by ProtectedRoute/ModuleGate for a
                   #     ROUTE_FEATURES route the current org lacks the entitlement for
                   #   NoOrgScreen — shown when a signed-in user belongs to no org (invite-only
                   #     onboarding: nothing to do but wait for an invite)
                   #   SuspendedOrgScreen — shown when the active org is suspended; lets a
                   #     multi-org user switch to another non-suspended org
                   #   DevCockpitHarness — dev-only (import.meta.env.DEV-gated, registered
                   #     directly in App.tsx, not via ROUTES) visual harness for pixel-diffing the
                   #     show-date cockpit against its design prototype; never mounted in production
                   #   Public pages (no auth): UnsubscribePage, PrivacyPage, ImpressumPage,
                   #   AcceptInvitePage, ResetPasswordPage, AuthCallbackPage,
                   #   SandboxViewerPage (ROUTES.SANDBOX, /sandbox/:token) — the leave-behind
                   #     read-only demo tour a prospect opens with no login: fetches a curated
                   #     snapshot via fetchSandboxSnapshot (sandbox-view function) and renders
                   #     expired/revoked/not_found empty states, or a read-only KPI+table view
                   #     with no mutate controls
                   #   /signup redirects to /login (no standalone signup page).
  types/           # Domain types extending Supabase row types
docs/
  app-logic.md    # Domain guide (roles, data model, booking flow) — for admins/producers
  system-map.md   # Automation engine map (trigger→function→data→effect) — mirrored by src/data/systemMap.ts (in-app canvas); update both in the same PR as any automation change
  legal/          # Privacy policy + impressum in EN/DE (served by PrivacyPage, ImpressumPage)
supabase/
  functions/       # Deno edge functions
    _shared/transactional-email-templates/  # React Email templates + registry
  migrations/      # SQL migrations — read-only, generated via the migration tool
```

### Key decisions

The project's **key architecture decisions** — the operational *what / where*, plus links to the ADRs that carry the *why* — now live in **[`docs/adr/README.md`](docs/adr/README.md)** under *"Key decisions (operational summary)"*. They were moved out of this file so there is a single home for them. Read that section before changing data-model, auth, tenancy, sync, booking, or compliance behavior.

### Calendar conventions

- **Week starts on Monday everywhere.** When using shadcn `Calendar` / `DayPicker`, pass `weekStartsOn={1}`. For manually rendered month grids, compute the leading pad as `(monthStart.getDay() + 6) % 7` and order weekday headers Mon–Sun.

---

## Conventions

### Naming

- **Files:** `PascalCase.tsx` for components/pages, `camelCase.ts` for hooks/utilities, `kebab-case` for shadcn primitives (existing convention).
- **Components:** `PascalCase`. Pages export default; everything else named export.
- **Hooks:** `useThing`.
- **DB:** `snake_case` tables and columns. Enum types in `app_role`, `booking_status`, etc.
- **Routes:** define in `ROUTES`, kebab-case URLs.
- **Role display labels are decoupled from the DB enum.** The `producer` `app_role` value is unchanged in the schema, RLS, and edge functions, but the UI displays it as **"Production Team"** everywhere via `ROLE_LABELS`/`roleLabel()` in `src/config/app.config.ts` (mirrored to `_shared/roles.ts`). Never compare against the display string — always check the literal `'producer'` role.

### React / data

- Use `useQuery` for reads, `useMutation` for writes; invalidate the relevant `queryKey` on success.
- **Query key convention — hierarchical prefix by domain:** All keys follow `['domain', 'sub-key', ...params]`. The two most critical domains:
  - **`['bookings', ...]`** — everything that reads from the `bookings` table (e.g. `['bookings', 'for-date', id]`, `['bookings', 'status']`, `['bookings', 'artist', artistId]`).
  - **`['blocked-dates', ...]`** — everything that reads from the `blocked_dates` table. *(Renamed from the old `['availability', ...]` domain when the `availability` table was dropped for `blocked_dates` — ADR-0007.)*
- **Invalidation rule:** Mutations that write to `bookings` invalidate `['bookings']` (prefix match, catches all sub-keys). Mutations that write to `blocked_dates` invalidate `['blocked-dates']`. This is the only pattern that stays correct as new consumers are added. Never list individual sub-keys in a mutation — always bust the whole domain.
- **Supabase Realtime is enabled** on all primary tables. Booking status changes propagate automatically to subscribed clients.
- Prefer the existing domain hooks in `src/hooks/` (`useMyArtist`, `useEligibleArtists`, `useArtistEligibleDates`, `useChatParticipant`, `useSettingsWarnings`, `useSkills`/`useArtistSkills`, `useNotifications`) over duplicating Supabase queries inline.
- Never call Supabase from a component effect when a query will do.
- Side effects on success → `sonner` toast (`toast.success`, `toast.error`).

### Error handling & loading states

- Use React Query's `isLoading`, `isError`, `error` states — no ad-hoc local loading flags.
- Show `Skeleton` (shadcn) for loading cards; show `Alert variant="destructive"` for page-level errors.
- Edge function errors: return `{ error: "message" }` with appropriate HTTP status; surface to the client via `toast.error`.

### New page / route checklist

When adding a new page:
1. Add a route constant to `ROUTES` in `src/config/app.config.ts`.
2. Create `src/pages/YourPage.tsx` with a default export.
3. Register in `src/App.tsx` with `<ProtectedRoute requiredRoles={[...]}>`.
4. Add a nav item in `src/components/layout/` with matching role gating (give it a `labelKey` so the label is translatable).
5. **Page mini (convention).** Every route explains its own module in a four-step, role-aware mini pinned at the header→body seam. Add a `PageKey` + a `MiniDef` at `src/lib/minis/pages/<page>.ts` (bilingual EN + DE, informal "Du", reuse `src/i18n/terms.ts` `TERMS`), register it in `src/lib/minis/index.ts`, build its token-only illustration at `src/components/minis/illustrations/<Page>Mini.tsx` (add it to the `ART` barrel), and drop `<PageMini page="<page>" />` into the page at the header→body seam. Copy is guarded by `minis.test.ts` (structure + en≠de) and `copyLint.test.ts` (no dashes, Du). If a page has no mini, state "No mini." with a reason in the PR. See `docs/superpowers/specs/2026-08-14-page-minis-design.md`.
6. **Help center impact.** If the change alters what an admin, producer, or artist would ask, or how the app answers it, update the Help content (`src/lib/help/items.ts`, EN + DE, "Du") in the SAME PR, or state "No help center impact." in the PR description. The help center is authored at spec time, not retrofitted later.

### Internationalization (i18n)

- react-i18next drives shell chrome via typed JSON namespaces in `src/i18n/locales/` (`common`, `help`). **English is the canonical shape; German must match it key-for-key** — `src/i18n/keyParity.test.ts` fails CI on any gap (a missing key would otherwise silently render English via `fallbackLng`).
- User-facing strings go through `t('...')`, never hardcoded. Keys are typed (`react-i18next.d.ts`), so an unknown key is a compile error.
- Structured content (the Help FAQ) is a typed bilingual data module in `src/lib/help/` (en + de co-located per record), not flat strings.
- Domain terms live once in the canonical `src/i18n/terms.ts` `TERMS` glossary; reuse it, never re-translate a term inline. This is the single source the whole app UI draws from as it is localized.
- No em/en dashes in copy; German uses the informal "Du". `src/i18n/copyLint.test.ts` enforces both.
- The language setting is global (account menu → `src/features/i18n/LanguageContext.tsx`), defaults to the browser language, and persists to localStorage. Rolling i18n across the rest of the app UI is incremental, one namespace per domain behind `fallbackLng` — see `docs/superpowers/specs/2026-08-14-i18n-and-help-page-design.md`.
- **A brand-new user-facing surface is authored through `t()` from the start** — the incremental rollout below is about migrating *existing* English, not a licence to ship new hardcoded copy that "we'll localize later". Add the surface's keys to the right domain namespace in the same PR (e.g. the calendar surface's producer copy lives in `bookings:calendar.*`, artist copy in `availability:calendar.*`, and role-agnostic chrome in `common:calendar.*`), so it never needs a follow-up i18n pass. Purely calendrical labels that date-fns already localizes (weekday-header names) stay on the `dfLocale()` path in `src/lib/dates.ts`, not `t()`.
- **Phase 2 (in progress): per-domain namespaces beyond shell chrome.** The `dashboard` namespace is the first domain migrated. `src/lib/dashboard/stageChain.ts` and `moduleOnboarding.ts` still return hardcoded English copy on purpose — that content is deferred to a future `onboarding` namespace shared with the Get Running v3 wizard, rather than migrated piecemeal per module. The whole language switcher, including German, is gated behind the `language_packages` entitlement (`src/lib/entitlements.ts`), which ships DARK: `defaultEnabled: false`, so a fresh org runs English-only until a super-admin turns it on for that org (Platform → Organizations). `AppLayout` force-resets the runtime to English whenever the entitlement is off, so translated strings never leak to an org that hasn't been granted the module.

### Edge functions

- One folder per function under `supabase/functions/<name>/index.ts`. Current categories:
  - **Admin ops:** `admin-list-users` (org-scoped via `requireOrgRole(org_id, ['admin'])`; org admins list only their own org's roster + roles — current callers: `EditorToolbar`'s org selector). Member role changes are the `set_org_member_role` RPC (not an edge function).
  - **Invitations:** `create-invitation` (org admin → insert `org_invitations` + send the `org-invitation` email; accepts an optional `artist_id` to deterministically link a catalog artist — validates same-org + `user_id IS NULL` and forces role `artist`). Acceptance is the `accept_invitation` RPC (links the artist by `org_invitations.artist_id` first — guarded so it no-ops when the caller already owns an org artist — else by lowercased email), not an edge function. `org_invitations.artist_id` is an FK → `artists(id) ON DELETE SET NULL`, also read by the `list_pending_invited_artists(p_org)` RPC that feeds the artist-card account-status chip.
  - **Magic-link login:** `send-login-link` — public, unauthenticated "email me a sign-in link" endpoint (`verify_jwt = false`, necessarily). Existence-hiding by design: the success path and the no-such-account path both return an identical `200 {ok:true}` (genuine RPC/lookup failures instead return a generic `500`, so this isn't a bare-`try/catch`-free endpoint — only the two "did this email have an account" outcomes are indistinguishable). Looks up the user via the indexed `get_user_id_by_email` RPC (not `listUsers` pagination), throttles via the `claim_login_link_slot` RPC (60s cooldown per email, backed by the `auth_link_throttle` table), mints a Supabase `magiclink` via `generateLink` with `redirectTo` = `<appOrigin>/auth/callback?redirect=<clamped path>`, and sends the `magic-link` transactional email. The redirect path is clamped again client-side (`safeRedirectPath`, mirroring `resetPassword.ts`'s `safeRelativeRedirect`) so an absolute/protocol-relative value can't be smuggled through. Existing-user invites also mint a magic link (instead of hitting the password-reset flow) so they land straight on `/auth/callback`.
  - **Airtable sync:** `airtable-schema` (admin-only, user-JWT via `requireOrgRole(org_id, ['admin'])`) reads the org's Airtable schema with the Vault PAT for the mapping UI — returns `{ schemaAccessible, bases }` (no `baseId` in body) or `{ schemaAccessible, tables }` (with `baseId`); an Airtable `403` (PAT missing the `schema.bases:read` scope) surfaces as `{ schemaAccessible: false }` so the UI falls back to typed inputs, and the PAT is never returned to the client. `airtable-poll` is the `*/5 * * * *` cron that upserts `show_dates` from each org's base (each org is throttled by its `airtable_poll_interval_minutes` setting, min 5; an org-admin "Sync now" triggers a single-org poll on demand) (see the Airtable-sync key decision in `docs/adr/README.md`).
  - **Transactional email:** `send-transactional-email`, `preview-transactional-email`, `handle-email-suppression`, `handle-email-unsubscribe`. New templates must be registered in `_shared/transactional-email-templates/registry.ts`.
  - **Booking engine:** `open-offer-tier` (create suggested bookings) and `close-offer-tier` (close a tier ± withdraw its pending offers) are per-request endpoints taking a `show_date_id`, not crons. The cron functions — `expire-offers` (hourly expiry), `send-offer-digest` (daily 19:00 Berlin), `send-confirmation-digest` (daily 20:00 Berlin) — are org-aware: they iterate active orgs via `getActiveOrgs(admin)` from `_shared/settings.ts` and resolve settings per-org with `resolveOrgSetting`. `expire-offers` retries a transient RPC timeout once before giving up (Supabase's API gateway occasionally cuts off a REST call at 5s even though the query itself runs in well under that) and reports a genuine lookup failure as `503`, not a silent no-op. The whole engine is gated behind the `booking_flow` entitlement at RLS, edge (`requireFeature`/`checkFeature`), and UI layers — see the `booking_flow` key decision in `docs/adr/README.md` before assuming it's unconditionally on for every org.
  - **Watchers:** `tier-at-risk-watcher` — scans open offer tiers and fires an in-app `tier_at_risk` notification when remaining pending + accepted < required slots. Idempotent (one notification per date/tier). No email; visual only. `cron-health-watcher` — 15-min cron that classifies every cron job healthy/failing/stale from the dispatch-capture tables and alerts super-admins on failure transitions; an HTTP failure only alerts after two consecutive failed observations (debounced, so a single self-healing blip stays silent), while staleness still alerts on first detection since it means the job didn't run at all. `health-rollup` — 15-min cron that recomputes **today's and yesterday's** per-function run/failure counts from the Analytics API into `health_daily`, the durable source behind the System Health 30-day uptime bar (Analytics itself retains only 24h, so nothing older can be reconstructed and nothing can be backfilled). Recomputes whole days rather than incrementing, so it is idempotent under a double-fire or retry, and aborts without writing when Analytics is unavailable so an outage cannot punch a permanent hole in the bar. `email-health-watcher` — ~15-min cron (platform-scoped, `X-Cron-Secret` only, no org-role fallback) that snapshots email deliverability via the `email_health_snapshot` RPC, derives operational/degraded/down, and alerts super-admins in-app (never by email — that's exactly what may be broken) on a fresh transition into degraded/down. Idempotent via `email_health_state.last_state`; volume-gated so a couple of bounces can't false-alarm; aborts without writing on any read/write failure so an outage can't corrupt state or spam alerts.
  - **Platform (super-admin):** `provision-org` (atomic org creation + catalog seeding + first-admin invite, requires super-admin); `resend-invitation` (resend an existing `org_invitations` row's email); `platform-edge-metrics` (System Health metrics proxy to the Supabase Analytics API via the dedicated `ANALYTICS` PAT); `platform-list-users` (cross-org user directory — paginated, capped at 1000, reports `truncated` — joined against `org_memberships`/`organizations`/`artists`/`profiles`, backs Platform → Users); `platform-manage-user` (one endpoint, five actions — `change_email`, `send_password_reset`, `suspend`, `unsuspend`, `delete` — against `auth.admin`; guards against self-action and against removing the last platform admin or the sole admin of any org via `sole_admin_orgs`; every action writes `platform_audit_log`). `platform-list-users`/`platform-manage-user` are cross-org and super-admin-only, distinct from the org-scoped `admin-list-users` above.
  - **Account & data (GDPR):** `delete-my-account` (authenticated; last-admin-guarded via `sole_admin_orgs`; calls `anonymize_user` **via the caller's JWT client** then `auth.admin.deleteUser`) and `export-org-data` (super-admin; full org JSON bundle). Per-user export is the `export_my_data` RPC; org deletion is the `delete_org` RPC (super-admin); account anonymization is the `anonymize_user` RPC.
  - **Import:** `fetch-remote-sheet` — SSRF-guarded proxy that fetches a public Google Sheets CSV for the bulk artist import (`requireOrgRole(org_id, ['producer','admin'])`; host-allowlisted to `docs.google.com` published-CSV URLs, no redirect following, size/timeout caps). The bulk insert itself is the `bulk_import_artists(p_org, p_rows)` RPC — a producer/admin-guarded `SECURITY DEFINER` set-based insert with server-side dedup on `lower(email)`, returning a per-row jsonb status array. Client parse/map/dedup lives in the pure `src/lib/artistImport/*` modules behind the `ArtistImportDialog` wizard.
  - **Hire orders:** `generate-hire-orders` is the hire-order engine: one endpoint, four per-request actions (plus a `sign` action for in-app electronic signing). `draft` creates draft orders from a date's confirmed bookings (snapshotting fields via `resolveFields`); `issue` readiness-gates, renders the PDF, uploads it to the `hire-orders` bucket, stamps `issued`, emails the artist the PDF attachment and notifies them; `preview` returns a watermarked PDF and persists nothing; `download-url` returns a signed URL for producers, super-admins, or the linked artist on issued/countersigned orders. It runs `verify_jwt = false` in `config.toml` because the auto-draft DB trigger calls it with `X-Cron-Secret`, so it self-authorizes via `requireCronOrRole(['admin','producer'])` for cron callers or `requireOrgRole(org_id, ['admin','producer'])` for JWT callers, then `requireFeature(org, 'hire_orders')`. `download-url` runs its own per-order auth ahead of that gate. When a show_date transitions into `fully_filled`, the feature-gated `dispatch_hire_order_drafts` DB trigger fires the `draft` action so orders are auto-drafted; issuing stays a human action in the UI. Frontend data access is `src/data/hireOrders.ts` with thin hooks in `src/hooks/useHireOrders.ts`. Ships DARK (the `hire_orders` entitlement defaults off). `documenso-webhook` exists in the tree but is **retained, dark, and not wired into any flow** — it was superseded by the in-app `sign` action + `hire_order_signatures` before ever going live, kept only in case a self-hosted Documenso integration is revisited later; do not treat Documenso as a live integration.
  - **Demo (sales):** `demo-ops` is the callable surface for demo-org operations — one endpoint, action-dispatched (`reset`, `wipe`, `flag_and_seed`, `cue`, `link_create`, `link_revoke`). `flag_and_seed` is super-admin-only (stamps `is_demo`, enables `hire_orders`, seeds); the rest are org-admin (`requireOrgRole(org_id, ['admin'])`, super-admins pass via its fallback) and re-assert `is_demo` at the edge as defense in depth on top of each RPC's own guard. `link_create`/`link_revoke` mint/revoke a `demo_sandbox_links` row (leave-behind read-only URL) via the service-role client, since RLS has no authenticated write policy on that table. `sandbox-view` is the paired public function (`verify_jwt = false` — a prospect opens the link with no login): given a `token`, it resolves the link (404 `not_found` if unknown, 410 `revoked`/`expired`), re-verifies the org is `is_demo` (defense in depth), and returns a curated, display-safe JSON snapshot (no PII, no PDF bytes, no signed URLs) built by inline service-role reads — no `SECURITY DEFINER` RPC, so no service-role-grant footgun. Both are restricted to `is_demo` orgs, which only a super-admin can create — no entitlement toggle involved.
- Use the service role key only when bypassing RLS is intentional (admin endpoints). Always re-verify the caller's role server-side first via `requireRole` (any-org), `requireOrgRole(org_id, [...])` (org-scoped), or `requireSuperAdmin` (platform-admin endpoints) from `_shared/auth.ts` — see `create-invitation` / `provision-org` for patterns. `requireOrgRole` automatically accepts super-admins so god-mode works on org-scoped endpoints.
- Read secrets via `Deno.env.get('SECRET_NAME')`.

### Notification system

- In-app notifications write to the `notifications` table (columns: `id`, `user_id`, `type`, `title`, `message`, `read` boolean, `related_entity_id`, `related_entity_type`, `created_at`). There is no `payload` column and no `read_at` timestamp — read state is a plain boolean `read`.
- Create notifications from edge functions or server-side mutations only — never bare client-side inserts without proper RLS policies.

### Styling

- **Use semantic tokens only**: `bg-background`, `text-foreground`, `text-primary`, `border-border`, etc. Never hardcode colors like `bg-white` or `text-black` in components.
- **Accent numbered stops (`accent-50`–`900`) do NOT support Tailwind opacity modifiers** (`bg-accent-500/20`, `text-accent-700/60`, …) — those vars are plain hex, not HSL channels, so the `/<alpha>` silently yields a solid color with no error. For an alpha accent, use a solid stop, an `rgba()` literal, or a dedicated token.
- **Tint washes** use `bg-hover-tint` / `bg-well-tint` / `bg-accent-tint`. Ad-hoc `bg-muted` and `bg-foreground/N` washes are lint-banned in feature code (Wave 2.1).
- All design tokens live in `src/index.css` (HSL, except the hex `--accent-50`–`900` scale) and `tailwind.config.ts`.
- Display font: `font-display` (Geist). Body: default Geist (`font-sans`); mono: `font-mono` (Geist Mono). Fonts are loaded in `index.html` and set in `tailwind.config.ts`.
- Match the existing component patterns: `Card` for grouped content, `Tabs` for sectioned admin UIs, `Badge` for status pills.

### TypeScript

- Prefer types derived from `Database` in `src/integrations/supabase/types.ts` — see `src/types/index.ts` for extension patterns.
- `any` is banned (lint error, CI-gated via `--max-warnings 0`). When supabase-js can't infer a joined-row
  shape, define an explicit local row `interface` and cast once at the query result
  (`as unknown as Row[]`) immediately after the error check — confined to `src/data/**`,
  hook `queryFn`s, and `supabase/functions/**`. Never deep-access an untyped row.
  Test stubs go through the typed helpers (`src/test/castHelpers.ts` — `asSupabase`/`asQueryResult`/`partialMock`;
  `supabase/functions/_shared/testing.ts` — `asTypedClient`/`bindFakeFrom`/`setFakeFrom`) —
  one cast inside the helper, never per-site `as any`.

### Testing

*Design rationale: ADR-0002 (testability foundation — edge-function DI, data-access extraction, the five layers).*

**Test-first is the default.** For any new logic (a pure function, a data-access function, an edge-function branch), write the failing test before the implementation. Bug fixes start with a failing regression test that reproduces the bug.

**The five test layers and when to use each:**

| Layer | Tool | Runs via | Use for |
|---|---|---|---|
| Unit / hook | Vitest + jsdom + @testing-library/react | `npx vitest run` | Pure functions, data-access functions, hooks, components |
| Database | pgTAP | `supabase test db` | Triggers, RLS policies, RPCs (`supabase/tests/`) |
| Edge function | Deno test | `deno test --allow-all supabase/functions/` | Edge-function handlers + shared modules |
| End-to-end | Playwright | `npx playwright test --config=e2e/playwright.config.ts` | Critical cross-stack flows |

CI runs all of these (`.github/workflows/ci.yml`).

**Hard rule: tests import the real module.** Never re-implement production logic inside a test file. If logic is hard to import, that is a signal to extract it — not to copy it into the test.

**Frontend pattern — data-access extraction:** Put Supabase reads/writes in `src/data/<domain>.ts` as `fetchX(client, args)` / `mutateX(client, args)` functions that take the client as a parameter. Hooks are thin wrappers that pass the `supabase` singleton. Test the data-access functions with the call-recording fake client in `src/test/supabaseFake.ts`, and use `src/test/renderWithProviders.tsx` + `src/test/fixtures.ts` for hook/component tests. Do not hand-roll `vi.mock('@/integrations/supabase/client')` chains.

**Backend pattern — dependency injection:** Each edge function exports `handle(req, deps)` and only wires `Deno.serve((req) => handle(req, realDeps()))` at the bottom. `Deps` (in `supabase/functions/_shared/deps.ts`) carries the Supabase clients, `env`, `now`, `invokeFunction`/`sendEmail`, and `fetch`. Tests import `handle` and pass `makeFakeDeps(...)` from `supabase/functions/_shared/testing.ts`. Use the shared `_shared/http.ts` (CORS + json), `_shared/auth.ts` (requireRole / requireOrgRole / requireSuperAdmin / requireCronOrRole / isServiceRole), and `_shared/settings.ts` (resolveOrgSetting / getActiveOrgs) helpers — do not re-inline CORS, client creation, auth, or settings resolution.

- Co-locate tests beside the file they test.
- Test behavior, never implementation details (internal state, private methods).

### Database changes

- Schema changes go through the migration tool — never hand-edit `supabase/migrations/` or `src/integrations/supabase/types.ts`.
- **The merge applies migrations. You do not.** Merging to `main` runs the Supabase GitHub integration's production deploy, which applies every pending migration in `supabase/migrations/` to the live project. That is the *only* writer to `supabase_migrations.schema_migrations`. Do not apply to production by hand.
- **If you must apply out of band, rename the file in the same commit.** The MCP `apply_migration` stamps its *own* current-timestamp version, not the one in your filename. The moment production records a version with no matching local file, `supabase db push` aborts **wholesale** and applies nothing — so one hand-applied migration silently disables every deploy that follows. Read back the version that was actually recorded and `git mv` the file to match it (check the rename keeps the file in the same position relative to its neighbours). This is not a convention you can forget: `scripts/check-migrations.mjs` fails the PR, and `deploy-functions.yml` refuses to ship, when the two sides disagree.
- **Seed data lives in `supabase/seed.sql`, never in a migration.** It is applied by `supabase db reset` locally and by Supabase when a preview branch is created. Keep it synthetic — no personal data, `@example.com` addresses only — and idempotent.
- **Nullable RPC arguments have no home in the generated types.** PostgREST type-gen marks every function arg non-null and cannot express `CALLED ON NULL INPUT`, so an RPC that legitimately takes NULL still generates `p_foo: string`. Do not widen it in `types.ts` — that quietly makes the file un-regenerable and the next `supabase gen types` breaks the build. Declare a widened args type in `supabase/functions/_shared/rows.ts` (see `ResolveShowAssignmentsArgs`, `CreateHireOrderWithDatesArgs`) and cast at the `.rpc()` call. `scripts/generatedTypes.test.ts` guards this.
- **Regenerating the types:** `supabase gen types typescript --project-id <id> > src/integrations/supabase/types.ts`, then `npm run sync:mirrors` for the edge mirror. Verify with `npm run sync:mirrors:check`, `npx tsc -p tsconfig.app.json --noEmit`, and `deno check --node-modules-dir=none` on any edge function you touched — the edge runtime is not covered by `tsc`.
- Every new table needs RLS enabled and explicit policies. Default to `authenticated` role; on tenant tables restrict reads by `is_org_member(auth.uid(), org_id)` and writes by `has_org_role(auth.uid(), org_id, ...)` (the uniform org-isolation template), plus the RESTRICTIVE `org_isolation` policy (pooled multi-tenancy: ADR-0003).
- Use the `update_updated_at_column()` trigger on tables with `updated_at`.

---

## Booking workflow (domain rules)

The entire booking engine is gated behind the `booking_flow` entitlement (RLS + edge `requireFeature` + UI `ModuleGate`/route lock) — the rules below describe its behavior when the module is enabled for an org. See the `booking_flow` key decision in `docs/adr/README.md` for the disabled-state semantics (data freezes read-only, it doesn't drain).

A booking moves through: `suggested → soft_booked → confirmed` (or `cancelled` from any state).

**DB-enforced integrity:** at most one *active* (non-cancelled) booking exists per `(show_date_id, artist_id)` (partial unique index `bookings_active_artist_date_uniq`); and a booking's artist must belong to the same org as its show_date — enforced by the `derive_org_id_for_booking()` trigger, which re-derives `org_id` and re-checks on INSERT and on any UPDATE of `artist_id`/`show_date_id`. Don't rely on application-side dedup alone.

- Offers are created by `open-offer-tier` edge function (call after new show_date creation or manually).
- Artists have a configurable response window (default 48h) to respond; `expire-offers` runs hourly. The window duration, digest send hours (Berlin time), and other booking engine settings are stored in `app_settings` (editable via Settings → Booking Engine), not hardcoded in `app.config.ts`.
- Artists receive a daily offer digest email at the configured hour (default 19:00 Berlin).
- Producers see soft_booked rows in their dashboard and bulk-confirm.
- Artists receive a confirmation digest email at the configured hour (default 20:00 Berlin).
- Email provider: Resend. Template overrides editable in Settings → Booking Engine.
- Understudies (`is_understudy = true`) auto-promote when the primary cancels.

---

## Test accounts (development only)

Onboarding is invite-only, so there is no public signup. **Bootstrap the first super-admin** once per environment — the only setup step that needs SQL — per the runbook at `docs/runbooks/first-super-admin-bootstrap.md`: create the auth user (Supabase dashboard), then `insert into public.platform_admins (user_id) select id from auth.users where lower(email) = lower('owner@example.com')`. Sign in and you land in the **Platform console**, where **Organizations → New organization** provisions an org (seeds its starter catalog + emails the first admin an `/accept-invite?token=` link) with no SQL. That admin then invites producers/artists from **Admin → Invites**; each invitee accepts via the emailed link. There is no automated seeding function.

Suggested emails:
- `test-admin@showflowpro.com`
- `test-producer@showflowpro.com`
- `test-artist@showflowpro.com`

**Rotate or remove before any production deploy.**

---

## Key files to reference

| File | Purpose |
|------|---------|
| `src/config/app.config.ts` | ROUTE_FEATURES (entitlement-gated routes), ROUTES, BOOKING_ENGINE_DEFAULTS (canonical booking-engine fallbacks; mirrors `_shared/settings.ts`), CHAT_ARCHIVE_DAYS |
| `scripts/sync-mirrors.mjs` | Generator for every dual-homed frontend/edge file. **`scripts/mirrors.manifest.json` is the source of truth for what is mirrored — read it rather than any list in this file.** Two modes: `file` (whole file, stamped with a `// GENERATED FILE. Do not edit.` header, optionally prefixed by a `prelude` for per-runtime directives the source must not carry — e.g. the edge `render.tsx` JSX pragma) and `block` (sentinel-delimited region, e.g. the registries in `src/lib/capabilities.ts` / `src/lib/entitlements.ts`). `npm run sync:mirrors` regenerates every target from its source; `npm run sync:mirrors:check` fails CI on drift. **Never hand-edit a generated target or block** — if a file opens with the GENERATED stamp, edit its `source` and regenerate. Two dual-homed pairs are deliberately NOT in the manifest and stay hand-maintained: `src/lib/hireOrders/types.ts` (structural, five files combined into one) and the hire-order consent text (`SignHireOrderDialog.tsx` / `generate-hire-orders/index.ts`) |
| `src/lib/entitlements.ts` | Per-org module entitlements registry: `FeatureKey`, `FEATURE_REGISTRY`, `enabledFeatures`/`isFeatureEnabled`. This is the SOURCE for the sentinel-delimited block in `supabase/functions/_shared/entitlements.ts` (the two runtimes can't share an import): edit here, then run `npm run sync:mirrors` to regenerate the block, never hand-edit it in the target. The SQL twin `public.is_feature_enabled()` is not covered by the generator, so keep it in sync by hand in the same commit |
| `src/lib/capabilities.ts` | Per-org **capabilities** ("user group rights") registry: `CAPABILITY_DEFS` (role x action grants), `resolveCapability` (lock → org override → platform default → registry default), group helpers. Distinct from entitlements: a module says a feature *exists*, a capability says who may *use* it. The sentinel-delimited registry block is the SOURCE for the same block in `supabase/functions/_shared/capabilities.ts`: edit here, then run `npm run sync:mirrors` to regenerate it, never hand-edit it in the target. `public.capability_default()` is the SQL twin (guarded by `capabilityDefaultsSql.test.ts`) and is not covered by the generator, so keep it in sync by hand. UI reads it via `useCan(action)` (`src/hooks/useCapabilities.ts`) |
| `src/lib/trust/facts.ts` | Trust Center claim tables (visibility matrix, subprocessors, retention, controls, documents). **Every string must be traceable to code in this repo or a published artefact.** Source for `public/trust.json` via `scripts/build-trust-json.mjs`, which the landing page's `/trust` route fetches — the same cross-repo pattern as `changelog.json`. `facts.privacy.test.ts` diffs the retention + subprocessor tables against `docs/legal/privacy-policy.en.md`; `capabilityInventory.test.ts` pins the printed counts to `CAPABILITY_DEFS`. Regenerate with `npm run sync:mirrors` |
| `src/integrations/supabase/types.ts` | Auto-generated DB types — read only |
| `src/features/auth/AuthContext.tsx` | Auth state, org-scoped role helpers, `currentOrg`/`orgs`/`switchOrg`, `isSuperAdmin` |
| `src/features/auth/resetPassword.ts` | Pure helpers for reset-password flow (hash parse, redirect safety, schema) |
| `src/features/consent/ConsentContext.tsx` | GDPR consent state (analytics / sessionReplay / errorTracking) |
| `src/features/editor/EditorContext.tsx` | Editor mode state, page access and column/permission config (super-admin only) |
| `src/data/settings.ts` | `resolveOrgSetting` / `upsertOrgSetting` — org-aware settings resolver (frontend) |
| `src/data/platform.ts` | Super-admin data access: `fetchAllOrgs`, `provisionOrg`, `fetchPlatformOrgStats`, platform admin CRUD |
| `src/data/platformUsers.ts` | Super-admin cross-org user directory + membership/artist-link/manage-user data access, backing the Platform → Users tab (`platform-list-users`/`platform-manage-user`) |
| `src/data/authLinks.ts` | `requestLoginLink` — magic-link login data access (`send-login-link`) |
| `src/data/profiles.ts` | `fetchMyProfile` / `updateMyProfile` / `updateMyPassword` |
| `src/data/members.ts` | `fetchOrgMembers` / `removeOrgMember` (via `list_org_members` / `remove_org_member` RPCs) |
| `src/hooks/` | All domain hooks — reuse before writing new queries |
| `src/types/index.ts` | Domain type extensions on top of Supabase types |
| `supabase/functions/_shared/settings.ts` | `resolveOrgSetting` + `getActiveOrgs` — org-aware settings for edge functions |
| `supabase/functions/_shared/database.types.ts` | Generated from `src/integrations/supabase/types.ts` by `npm run sync:mirrors` (`scripts/mirrors.manifest.json`); `npm run sync:mirrors:check` enforces it in CI. Never hand-edit; regenerate after `types.ts` changes |
| `supabase/functions/_shared/auth.ts` | `requireRole` / `requireOrgRole` / `requireSuperAdmin` / `requireCronOrRole` |
| `supabase/functions/provision-org/index.ts` | Atomic org creation + catalog seed + first-admin invite (super-admin) |
| `supabase/functions/send-offer-digest/index.ts` | Daily offer digest (Berlin 19:00 gate) |
| `supabase/functions/send-confirmation-digest/index.ts` | Daily confirmation digest (Berlin 20:00 gate) |
| `supabase/functions/airtable-poll/index.ts` | Org-aware Airtable → show_dates sync (per-org Vault key) |
| `supabase/functions/open-offer-tier/index.ts` | Creates suggested bookings for a date/tier |
| `supabase/functions/tier-at-risk-watcher/index.ts` | In-app notification when a tier can no longer fill before deadline |
| `supabase/functions/delete-my-account/index.ts` | Authenticated account self-deletion: last-admin guard → `anonymize_user` → `auth.admin.deleteUser` |
| `src/data/account.ts` | `exportMyData` / `deleteMyAccount` |
| `src/data/notificationPreferences.ts` | `fetchMyNotificationPreferences` / `updateMyNotificationPreferences` |
| `docs/system-map.md` | Automation engine system map: every trigger → function → data → side effect, with the DB guards. Mirrored by `src/data/systemMap.ts` (the in-app Settings → Documentation → System Map canvas); update both in the same PR as any automation change |

---

## Things to avoid

- Editing files under `supabase/migrations/` or `src/integrations/supabase/types.ts`.
- Storing roles on `profiles`, or doing role checks via `localStorage`.
- Adding `WITH CHECK (true)` policies on log/audit tables.
- Hardcoding colors, fonts, or route strings.
- Defaulting calendars/grids to Sunday-first — week starts on Monday across the app.
- Letting artists declare availability on dates outside `useArtistEligibleDates`.
- Coupling client logic to a specific tenant or production brand — the platform is product-agnostic.
- Using ad-hoc `useState` loading flags when React Query's `isLoading` / `isError` will do.
- Re-implementing production logic inside a test file (tests must import the real module).
- Constructing a Supabase client, CORS headers, or auth checks inline in an edge function instead of using `realDeps()` / `_shared/http.ts` / `_shared/auth.ts`.
- Hand-rolling `vi.mock('@/integrations/supabase/client')` chains instead of the `src/test/` harness.
- Casting Supabase rows or clients with `as any` — use an explicit row interface + single `as unknown as` cast at the query boundary, or the typed test helpers (`castHelpers.ts` / `_shared/testing.ts`).
