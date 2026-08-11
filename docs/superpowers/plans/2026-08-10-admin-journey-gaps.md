# Admin Journey Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this session the plan is executed by a Workflow with implementer+critic loops; each work package (WP) below is one implementer assignment.

**Goal:** Close the 16 ADMIN partial/gap items from `docs/research/2026-08-09-user-type-journey-questions.md` (as re-scoped below after PRs #238/#239 landed), extracting shared values instead of hardcoding.

**Architecture:** Five work packages on the session branch, executed in **two waves** (parallel within a wave, waves sequential — wave boundaries follow the data dependencies, file sets within a wave are disjoint). **Wave 1: WP1 ∥ WP3.** WP1 creates the shared `ROLE_DESCRIPTIONS` registry (mirrored to the edge) and rewrites the invitation email around real data (the DB row's `expires_at`, the inviter's profile, the role registry). WP3 extends the booking setup engine with a "people" step, adds Settings tab deep-linking (`?tab=`), and narrates the nightly pipeline. **Wave 2: WP2 ∥ WP4a ∥ WP4b.** WP2 turns the accept page's instant redirect into an informative success moment (consumes WP1's registry). WP4a wires notification deep-links and point-of-action narration (consumes WP1's registry + WP3's `?tab=`). WP4b gives the Airtable sync-held alert an email counterpart (consumes WP3's `?tab=`).

**Tech Stack:** React 18 + TS 5, react-query v5, vitest + `src/test/` harness (`supabaseFake`, `renderWithProviders`, `castHelpers`), Deno edge functions with `handle(req, deps)` DI + `makeFakeDeps`, `scripts/sync-mirrors.mjs` for dual-homed values.

## Global Constraints

- **TDD is mandatory**: failing test first, then implementation. Tests import the real module — never re-implement logic in a test.
- **Extract shared values over hardcoding**: the invitation expiry comes from the invitation row's `expires_at` (DB is the single source); role labels via `roleLabel()` everywhere; role descriptions via the new `ROLE_DESCRIPTIONS`; digest hours via `resolveOrgSetting(...)` + `BOOKING_ENGINE_DEFAULTS`; routes via `ROUTES`.
- **No em/en dashes in any user-facing copy** (UI strings, email copy). Use period/comma/colon. `moduleOnboarding.test.ts` already enforces this for onboarding copy.
- **Semantic Tailwind tokens only** (`text-muted-foreground`, `bg-accent-500`, never raw colors); accent numbered stops take no opacity modifiers.
- **Mirrored files**: edit the SOURCE (`src/lib/emailTemplates/emailCopy.ts`, the sentinel block in `src/config/app.config.ts`), then `npm run sync:mirrors`. Never hand-edit `supabase/functions/_shared/*` mirror targets.
- **No DB migrations in this plan.** Nothing here changes schema or RPCs.
- **Git safety for agents**: implementers and critics NEVER run `git commit`, `git reset`, `git rebase`, `git checkout <ref>`, `git stash`, or amend/drop commits — WPs in the same wave share the worktree, so a dedicated commit agent lands each WP's exact file list after its wave (the "Commit" step in each WP is executed by that agent, not the implementer). Critics inspect their WP via `git diff -- <wp paths>` / `git status --porcelain -- <wp paths>`.
- **Quality loop**: per WP, implementer → three parallel critics (product/opus, correctness/sonnet, conventions/haiku) → re-implement with the critics' findings; loop until every critic returns tier S with zero blockers, capped at **5 rounds**.
- **Test runs during rounds**: targeted (`npx vitest run <paths>`, no `--coverage`; `deno test --allow-all <fn dir>` for edge). Full `npm run verify:fast` runs once, after all waves.
- **After edge-function changes**: `deno check --node-modules-dir=none supabase/functions/<fn>/index.ts` and run the full Deno suite for the touched function directory.
- No changelog/version bump in this branch (release packaging is the owner's call; recorded in the context file).

---

### WP1: Invitation email tells the invitee what they're joining

Closes A0.1 (what is ShowFlow), A0.2 (what does my role mean), A0.3 (who invited me), A0.4 (expiry prominence), plus the raw-enum role-label inconsistency and a CTA reassurance line (A1.1 residue).

**Files:**
- Modify: `src/config/app.config.ts` (inside the `ROLE LABELS MIRROR` sentinel block: add `ROLE_DESCRIPTIONS` + `roleDescription()`)
- Regenerate: `supabase/functions/_shared/roles.ts` (via `npm run sync:mirrors`)
- Modify: `src/lib/emailTemplates/emailCopy.ts` (org-invitation keys) + regenerate `supabase/functions/_shared/transactional-email-templates/_shell/emailCopy.ts`
- Modify: `supabase/functions/_shared/transactional-email-templates/org-invitation.tsx`
- Modify: `supabase/functions/_shared/invitations.ts` (`sendOrgInvitationEmail` signature + a `formatExpiresOn` helper + inviter display-name resolution helper)
- Modify: `supabase/functions/create-invitation/index.ts`, `supabase/functions/resend-invitation/index.ts`, `supabase/functions/provision-org/index.ts`
- Test: `src/config/appConfig.roles.test.ts` (new), existing `*.di.test.ts` files for the three edge functions, template render test if the suite has one (follow `org-invitation` existing tests)

**Interfaces (produced):**
```ts
// src/config/app.config.ts (inside the mirrored block)
export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: 'Full control of this workspace: people, casts, settings, and every booking.',
  producer: 'Plans productions and show dates, sends offers, and confirms bookings.',
  artist: 'Receives booking offers, declares availability, and sees confirmed engagements.',
};
export function roleDescription(role: AppRole): string { return ROLE_DESCRIPTIONS[role]; }

// supabase/functions/_shared/invitations.ts
export function formatExpiresOn(expiresAt: string | null | undefined): string | undefined; // "August 24, 2026" via Intl, undefined when absent
// sendOrgInvitationEmail gains: roleDescription?, inviterName?, expiresOn? in templateData
```

- [ ] **Step 1 (test first):** `src/config/appConfig.roles.test.ts`: every `AppRole` has a non-empty description; no em/en dashes (`/[—–]/` fails); `roleDescription('producer')` mentions neither "producer" jargon-only wording nor dashes. Run: fails (module lacks export).
- [ ] **Step 2:** Add `ROLE_DESCRIPTIONS` + `roleDescription` inside the sentinel block; `npm run sync:mirrors`; test passes; `npm run sync:mirrors:check` clean.
- [ ] **Step 3 (test first):** For each edge fn's `*.di.test.ts`: assert `sendEmail` payload `templateData` now contains `role` as the *label* (e.g. `"Production Team"`, not `"producer"`), `roleDescription`, `expiresOn` derived from the invitation row, and (create-invitation) `inviterName` when the inviter has a `profiles.display_name`. Run: fails.
- [ ] **Step 4:** Extend `sendOrgInvitationEmail` and the three callers. `create-invitation`: fetch inviter `profiles.display_name` (one select; fallback to email). `resend-invitation`: pass `roleLabel(invite.role)`, `expiresOn` from the row, and resolve the inviter from `invite.invited_by` (same helper). `provision-org`: `roleLabel('admin')` + `expiresOn`. Run tests: pass. Deno check all three.
- [ ] **Step 5 (copy):** New/changed keys in `src/lib/emailTemplates/emailCopy.ts` (then `npm run sync:mirrors`):
  - `org-invitation.productIntro`: `ShowFlow is where {{orgName}} plans shows, sends booking offers, and confirms casts.`
  - `org-invitation.roleIntro`: `You are joining as {{role}}. {{roleDescription}}`
  - `org-invitation.expiryLine`: `This invitation works until {{expiresOn}}.`
  - `org-invitation.ctaHint`: `The button signs you in directly. You can set a password later from your profile.`
  - `org-invitation.invitedBy`: `Invited by {{inviter}}.` (template passes `inviter` = name, else email)
  - `org-invitation.footer`: `If you weren't expecting this invitation, you can safely ignore this email.` (expiry moves out of the footer into the body; when `expiresOn` is missing, the template renders the old `expires in 14 days` fallback line — keep a `org-invitation.expiryFallback` key so no invite ever ships without an expiry statement)
- [ ] **Step 6:** Template renders the new sections in order: greeting → productIntro → roleIntro (only when role known) → intro → CTA → ctaHint → expiryLine/expiryFallback → invitedBy → pasteLink → footer. Update `previewData` so Settings → Email templates preview shows all sections. Run the template/registry tests + full Deno suite for `_shared/transactional-email-templates`.
- [ ] **Step 7:** Commit `feat: invitation email explains product, role, inviter and expiry`.

### WP3: First-run learns about people, tonight, concepts, and view-as

Closes A3.2 (no invite-your-people step), A3.3 (what happens tonight), A3.1 (concept links), A3.4 (view-as suggestion) + shared enabler: Settings tab deep-links.

**Files:** (amended after implementation — the original list was written before the step's real blast radius was known. A new step key is consumed by every surface that composes booking setup, and a flow-aware panel needs the org's flow passed in, so the set below is what the branch actually carries. The commit agent must land all of it: the subset in the first draft does not typecheck on its own.)

- Engine + data: `src/lib/bookings/setupStatus.ts` (new step key `people`, `blockFor` per flow), `src/hooks/useBookingSetup.ts` (`artistCount` + the on-demand `useInactiveArtistCount`), `src/data/artists.ts` (`fetchArtistCount`, `fetchInactiveArtistCount`), `src/hooks/useBookingFlow.ts` (accepts an org override, so a rail panel reads the RAIL's org, not the shell's)
- Registries: `src/lib/dashboard/moduleOnboarding.ts` (people step meta, `VIEW_AS_ARTIST_TIP`, flow-branched rules), `src/lib/dashboard/setupBlocks.ts` + `types.ts` (the shared "Blocks X" chip vocabulary and the widened `SetupBlock` union), `src/lib/dashboard/firstRun.ts`
- Copy modules (pure, new): `src/lib/bookings/timingCopy.ts` (`describeTonight`, `timingScopeNote`), `src/lib/bookings/coverageCopy.ts` (`ladderScopeNote`, `eligibilityScopeNote`), `src/lib/settingsTabs.ts` (`resolveInitialTab`)
- Setup panels: `src/components/bookings/setup/` — `BookingSetupRail.tsx`, `BookingProducerWaitingCard.tsx`, `PeopleStep.tsx` (new), `FlowStep.tsx`, `TimingStep.tsx`, `LadderStep.tsx`, `EligibilityStep.tsx`, `RehearsalBlock.tsx`, `FirstOfferCard.tsx`
- Shared first-run surfaces: `src/components/dashboard/firstRun/DashboardSetupRail.tsx`, `src/components/dashboard/firstRun/useDashboardFirstRun.ts`
- Settings: `src/pages/SettingsPage.tsx` (`?tab=` seed + re-follow)
- Tests: co-located for every module above, plus the composed surfaces the new step flows into — `src/components/setup/useModuleOnboardingRail.test.tsx`, `src/components/dashboard/ArtistDashboard.firstRun.test.tsx`, `src/pages/ShowsBookingsPage.peek.test.tsx`, `src/hooks/useBookingSetup.test.ts`, `src/data/artists.test.ts`

**Interfaces (produced):**
```ts
// setupStatus.ts
export type BookingSetupStepKey = 'flow' | 'people' | 'slots' | 'ladder' | 'eligibility' | 'timing';
// BookingSetupStatusInput gains: artistCount: number | null  (null = unreadable; treated as 0)
// people step: done = (artistCount ?? 0) > 0, block: 'offers'

// src/data/artists.ts
export async function fetchArtistCount(client: SupabaseClient, orgId: string): Promise<number>; // head:true count on artists

// src/lib/settingsTabs.ts
export function resolveInitialTab(param: string | null, isAdmin: boolean): string; // whitelist + role gate, falls back to existing defaults

// src/lib/bookings/timingCopy.ts
export function describeTonight(v: { offerHour: number; confirmHour: number; windowHours: number }, artistAcceptance: boolean): string | null;
// artistAcceptance=true → "Tonight at 19:00 Berlin the offer digest goes out. Artists get 48 hours to answer, and confirmations mail at 20:00."
// artistAcceptance=false → null (direct-book orgs have no offer digest)
```

- [ ] **Step 1 (test first):** `setupStatus.test.ts`: with `artistCount: 0` the `people` step is present, ordered `['flow','people','slots','ladder','eligibility','timing']`, `done: false`, `block: 'offers'`, and `canOffer` is false even when everything else is done; with `artistCount: 3` it is done. `null` behaves as 0. Run: fails.
- [ ] **Step 2:** Implement in `computeBookingSetupStatus` (STEP_TITLES: `people: 'Add your artists'`; STEP_ORDER; BLOCK map). Pass.
- [ ] **Step 3 (test first):** `moduleOnboarding.test.ts` parity tests will fail until the meta exists — add step meta: title `Add your artists`, todoHint `Import your roster or add artists one by one. Offers reach them by email before they ever log in.`, doneHint `Your roster has artists in it.`, ctaLabel `Open artists`, ctaRoute `ROUTES.ARTISTS`, no ctaCapability. Pass.
- [ ] **Step 4:** `fetchArtistCount` (test with `supabaseFake`: records a `select('*', { count: 'exact', head: true })` on `artists` scoped to org) and wire a `['artists', 'count', orgId]` query into `useBookingSetupStatus`. Failure → `artistCount: null`. Pass.
- [ ] **Step 5 (test first):** `settingsTabs.test.ts`: `resolveInitialTab('airtable', true) === 'airtable'`; unknown/`null` → role default (`'organization'` admin, `'scheduling'` non-admin); admin-only tab requested by non-admin → `'scheduling'`. Implement; wire `useSearchParams` read-once seed in `SettingsPage.tsx`. Pass.
- [ ] **Step 6 (test first):** `timingCopy.test.ts` for both branches + no dashes; implement `describeTonight`; render it in `TimingStep` under the existing helper text (`text-xs text-muted-foreground`), live-updating from the form values. Pass.
- [ ] **Step 7:** Ladder + Eligibility steps: append link row `How casts and tiers work` → `` `${ROUTES.SETTINGS}?tab=docs` `` next to the existing "Rank casts in Settings" links. Snapshot/queries in existing step tests.
- [ ] **Step 8 (test first):** `moduleOnboarding.test.ts`: `bookingOnboarding.rules('admin', ctx)` contains a rule titled `See it as your artists do`; `rules('producer', ctx)` does not (producers cannot use Editor Mode). Implement: hint `Editor Mode, the pencil icon top right, can view this app exactly as one of your artists.` Pass.
  - **Amended:** `rules` is the rail's COMPLETE state, so a tip that lives only there reaches an admin *after* setup, while the gap (research line 98) is that nothing suggests view-as *during* it. The tip is therefore an exported `VIEW_AS_ARTIST_TIP` object rendered by two surfaces: the `rules` block above, and the `BookingSetupRail` footer, which exists only while setup is unfinished. Gated on `canUseEditor(roles, isSuperAdmin)` at the render site, so a super-admin visiting an org they never joined gets it too.
  - **Amended (A3.2 scope):** the `people` step is the artist roster, but PeopleStep also carries one admin-gated clause naming `Admin, People` as where producers and fellow admins are invited, so an admin who works the whole rail is not left thinking the roster is the whole answer to "invite my people". Membership invites themselves stay out of the setup rail: they are not a booking-readiness gate.
- [ ] **Step 9:** Commit `feat: booking setup gains people step, tonight narrative, concept links, view-as tip`.

### WP2: Accepting an invite lands on an informative success moment

Closes A1.2/A1.3 as re-scoped: membership now exists at invite time (#239), so the page keeps auto-accepting but replaces the instant redirect with a "here's what just happened" card.

**Files:**
- Modify: `src/pages/AcceptInvitePage.tsx`
- Test: `src/pages/AcceptInvitePage.test.tsx` (extend the existing post-#239 suite)

**Interfaces (consumed):** `useAuth().orgs` (each `{ id, name, roles }` via `orgRoles.ts`), `roleLabel`, `ROLE_DESCRIPTIONS` (WP1).

- [ ] **Step 1 (test first):** success path renders a card with heading `You've joined {orgName}`, the role line (label + description from `ROLE_DESCRIPTIONS` when the membership role is resolvable from `orgs`), a role-aware next-step line, and a `Go to dashboard` button that navigates to `ROUTES.DASHBOARD`; asserts NO auto-navigate on success. Error paths unchanged. Run: fails.
- [ ] **Step 2:** Implement: keep `acceptInvitation` + `switchOrg`; on success set local state `{ orgId }` instead of `navigate`; resolve org + role from `useAuth().orgs`; fallbacks: org name → `your organization`, role line omitted when unresolvable. Next-step lines: admin `Your dashboard has a short setup list that gets the first offers out.`, producer `Your dashboard shows what is waiting on you.`, artist `Offers arrive by email and land on your dashboard.` Drop the success toast (the card replaces it); keep the artist-link warning toast. Pass.
- [ ] **Step 3:** Commit `feat: accept-invite success screen says what you joined and what happens next`.

### WP4a: Steady-state surfaces answer "so what happens now?"

Closes A4.1 (notification deep-links), A4.3 residue (role meaning at role-change), A4.4 (schedule-change narration). A5.1 (suspended-screen contact) ships as mechanism-ready-but-dark, not closed: `SupportContactLine` renders correctly for either state of `APP_META.SUPPORT_EMAIL`, but that value ships `null` (see "Out of scope" below), so a suspended user still lands on the unchanged "contact your platform administrator" copy with no reachable contact until an owner sets a real address.

**Files:** (amended after implementation — like WP3, the original list undercounted the branch's real footprint. `scheduleChangeNote`'s reasoning about which channel reaches which artist, and under what account condition, outgrew an inline string and was extracted to its own pure, independently-tested module rather than duplicated between `ShowDateFormDialog` and its test. The set below is what the branch actually carries; the commit agent must land all of it or `ShowDateFormDialog.tsx`'s import of `scheduleChangeNote` fails to resolve.)
- Create: `src/lib/notifications/entityRoutes.ts` + test
- Create: `src/lib/notifications/scheduleChangeCopy.ts` + test (extracted from the edit-mode digest line below — the channel/account reasoning needed its own home and its own regression tests, see A4.4)
- Modify: `src/components/layout/NotificationsList.tsx` (+ its test), `src/components/layout/AppLayout.tsx` (popover close on navigate, + new co-located `AppLayout.test.tsx` pinning that wiring)
- Modify: `src/components/admin/people/PersonRow.tsx` (role descriptions subtext, from WP1)
- Modify: `src/components/shows/ShowDateFormDialog.tsx` (edit-mode digest line, via `scheduleChangeNote`)
- Modify: `src/config/app.config.ts` (`APP_META.SUPPORT_EMAIL: string | null = null` — OUTSIDE the mirror block), `src/pages/SuspendedOrgScreen.tsx` + test

**Interfaces (produced):**
```ts
// src/lib/notifications/entityRoutes.ts
export function notificationTarget(n: { related_entity_type: string | null; related_entity_id: string | null }): string | null;
// booking | show_date | show_date_offer_tier → ROUTES.BOOKINGS
// hire_order (with id) → ROUTES.HIRE_ORDER_DETAIL.replace(':id', id)
// airtable_sync_log → `${ROUTES.SETTINGS}?tab=airtable`
// cron_job | system → ROUTES.PLATFORM
// anything else / missing id where required → null
```

- [ ] **Step 1 (test first):** `entityRoutes.test.ts` covering every mapping + null cases; implement. Pass.
- [ ] **Step 2 (test first):** `NotificationsList.test.tsx`: clicking a notification with a target marks it read AND calls `navigate` with the target and fires the new optional `onNavigate` prop; a target-less notification only marks read. Implement with `useNavigate`; `AppLayout` passes `onNavigate={() => setNotifOpen(false)}` (or however the popover open state is held — follow the existing state). Pass.
- [ ] **Step 3:** `PersonRow` role dropdown: under each `roleLabel(r)` checkbox item add `text-xs text-muted-foreground` line with `ROLE_DESCRIPTIONS[r]`. Extend `PersonRow.test.tsx` to assert the description renders. Pass.
- [ ] **Step 4 (test first):** `ShowDateFormDialog` edit mode shows `Booked artists see changes in the app immediately. The email summary goes out at {H}:00 Berlin.` where `{H}` resolves via react-query → `resolveOrgSetting(supabase, orgId, 'confirmation_digest_hour_berlin', BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin)`. Hidden in create mode. Implement. Pass.
- [ ] **Step 5 (test first):** `SuspendedOrgScreen.test.tsx`: with `APP_META.SUPPORT_EMAIL = null` the copy is unchanged; with a value (mock via `vi.spyOn`/test seam or export a pure `suspendedContactLine(email)` helper) a `mailto:` link renders: `Your admin can reach the platform team at {email}.` Implement with the pure-helper approach so the test imports the real module. Pass.
- [ ] **Step 6:** Commit `feat: notifications deep-link; role, schedule and suspension surfaces narrate consequences`.

### WP4b: Airtable sync-held gets an email counterpart

Closes A4.2. Follow the `cast-escalation-requested` pattern in `expire-offers` for recipient resolution and sending.

**Files:** (amended after implementation — coverage.ts's new `audience: "org"` field only has meaning if something reads it: Settings > Email templates is where an org admin would actually find out this alert exists, and its pre-WP4b visibility gate (`status !== "internal" || isSuperAdmin`) hid every internal row, including this new one, from the org admins it is now about. Fixing that gate is a two-line change confined to `EmailTemplatesTab.tsx`'s own local helpers, not a redesign of the page, so it stays inside this WP rather than becoming a sixth work package. The commit agent must land the full set below or `coverage.ts`'s `audience` field ships as dead code and `EmailTemplatesTab.test.tsx`'s WP4b assertions fail to resolve.)
- Create: `supabase/functions/_shared/transactional-email-templates/airtable-sync-held.tsx`
- Modify: `supabase/functions/_shared/transactional-email-templates/registry.ts`, `src/lib/emailTemplates/emailCopy.ts` (+ sync mirror), `src/lib/emailTemplates/coverage.ts`
- Modify: `supabase/functions/airtable-poll/index.ts` (`notifyAdminsOnSyncProblem` also emails)
- Modify: `src/components/settings/emailTemplates/EmailTemplatesTab.tsx` (+ its test) — `isVisibleTemplate` gains the `audience: "org"` exception so the new row is not silently invisible to the admins it is about; while in the file, also fixed a pre-existing bug the new row exposed most: a `render_failed` preview response (HTTP 200, empty `html`, an `errorMessage`) rendered a blank iframe with no explanation instead of surfacing why
- Modify: `src/lib/notificationCategories.test.ts` — additive coverage for `categoryForTemplate("airtable-sync-held")`; no production file in this pair changes, `categoryForTemplate` already falls through to `null` for any key absent from `EMAIL_TEMPLATE_CATEGORY`
- Test: extend `airtable-poll`'s Deno tests (`makeFakeDeps`), template registry test, coverage registry test, `EmailTemplatesTab.test.tsx`, `app-links.test.ts` (the app-host-vs-marketing-host regression guard, so the newest CTA-bearing template is covered)

**Interfaces:** template key `airtable-sync-held`; templateData `{ orgName, heldCount?, zeroImport?, settingsUrl }`; `settingsUrl` = `` `${APP_URL}/settings?tab=airtable` `` (WP3's deep link) via `_shared/app-url.ts`.

- [ ] **Step 1 (test first):** Deno test: when the sync problem is new-or-worse, `deps.sendEmail` is called once per admin with template `airtable-sync-held`, subject containing the org name, and `settingsUrl` pointing at `/settings?tab=airtable`; when unchanged, no email. Admin emails resolve via `deps.admin.auth.admin.getUserById` (mirror the in-app recipient list). Run: fails.
- [ ] **Step 2:** Template + copy keys (subject `Airtable sync needs attention in {{orgName}}`; body mirrors the in-app message wording; CTA `Review the sync report`) + registry entry (family `violet`) + coverage.ts row (audience: org admins; trigger: `airtable-poll cron, when held records appear or grow`). Implement the send in `notifyAdminsOnSyncProblem` after the insert, tolerating email failure without failing the poll (log, don't throw).
- [ ] **Step 3:** Deno check + full Deno suite for `airtable-poll` and the templates dir; `npm run sync:mirrors:check`; vitest for coverage registry.
- [ ] **Step 4:** Commit `feat: email admins when the airtable sync holds records`.

---

## Verification (after all WPs)

- [ ] `npm run verify:fast` green (lint zero-warning, tsc app+tools, build, vitest+coverage, deno check).
- [ ] `npm run sync:mirrors:check` green.
- [ ] Update `docs/research/user-journey-gaps-context.md` statuses + the research artifact.

## Out of scope (recorded in the context file)

- A2.x items were already ✅. Producer/artist backlogs untouched.
- A "who exactly is my admin" (producer item P2.3) and org/role preview *before* auth: product decisions, not admin items.
- Changelog + version bump: owner packages releases.
- Setting a real `SUPPORT_EMAIL` value: owner decision; mechanism ships dark (null).
