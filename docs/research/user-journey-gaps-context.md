# User journey gaps — session driver

Reusable context for sessions that close journey-question gaps. Pair this file with the
browsable artifact and paste/reference both at session start.

- **Question inventory (source of truth):** `docs/research/2026-08-09-user-type-journey-questions.md`
- **Browsable artifact (filterable, per-role):** https://claude.ai/code/artifact/947c3125-5c76-46df-9193-fc713b83735e
- **This file:** live status + constraints. Update it (and the artifact) at the end of every session that ships items.

## How to drive a session with this file

Suggested opening prompt for a future session:

> Read `docs/research/user-journey-gaps-context.md` and the research doc it points to.
> Work on items <IDs or role> . Follow the Constraints section. Update the status tables
> and the artifact when done.

Item IDs: `<Role><Stage>.<n>` — A=admin, P=production team, R=artist (e.g. A3.2, R3.1).
Statuses: `open` · `in progress` · `shipped (branch)` · `merged` · `superseded` · `wontfix`.

## Constraints (apply to every gap session)

1. **TDD, superpowers-style.** Failing test first; tests import the real module; use the
   harnesses (`src/test/supabaseFake.ts`, `renderWithProviders`, `castHelpers`;
   `_shared/testing.ts` + `makeFakeDeps` for edge). Plans live in `docs/superpowers/plans/`.
2. **Extract shared values over hardcoding.** Numbers and copy that exist elsewhere must be
   read, not repeated: invitation expiry from the `org_invitations.expires_at` row, digest
   hours via `resolveOrgSetting` + `BOOKING_ENGINE_DEFAULTS`, roles via
   `roleLabel()`/`ROLE_DESCRIPTIONS` (mirrored block in `src/config/app.config.ts`),
   routes via `ROUTES`. New dual-homed values go through `scripts/mirrors.manifest.json` +
   `npm run sync:mirrors`, never hand-copied.
3. **Copy rules:** no em/en dashes in user-facing copy; user-voice, consequence-first
   ("what happens next, and when"); match the tone of `firstRun.ts` / `moduleOnboarding.ts`.
4. **Styling:** semantic tokens only; accent numbered stops take no opacity modifiers.
5. **No hand-applied migrations.** Migrations are plain files applied on merge; avoid schema
   changes unless the item truly needs one.
6. **Release packaging (changelog + version bump) is the owner's call** — gap sessions do
   not bump versions.
7. When an item's premise changed (a PR landed that reshapes the surface), re-verify against
   main before implementing, then record the re-scope in the Decision log below.

## Status — Admin (16 items, this branch: `claude/user-type-onboarding-questions-eca9d8`)

| ID | Item | Status | Notes |
|---|---|---|---|
| A0.1 | Email: what is ShowFlow | in progress (WP1) | productIntro copy key |
| A0.2 | Email: what does "admin" mean | in progress (WP1) | ROLE_DESCRIPTIONS registry, mirrored |
| A0.3 | Email: who invited me | in progress (WP1) | inviter display name, fallback email |
| A0.4 | Email: expiry prominence | in progress (WP1) | expiresOn from the invitation row |
| A1.1 | Account-vs-login narration | largely superseded by PR #238 | magic-link CTA works for both; WP1 adds ctaHint |
| A1.2 | Org/role preview on accept | re-scoped (WP2) | #239 creates membership at invite time, so no confirm gate; success card instead |
| A1.3 | What did accepting commit me to | in progress (WP2) | success card: org, role, next steps |
| A3.1 | Concepts not linked from rail steps | in progress (WP3) | docs-tab deep link from ladder/eligibility |
| A3.2 | No invite-your-people step | in progress (WP3) | new `people` step: done = ≥1 catalog artist |
| A3.3 | "What happens tonight" narrative | in progress (WP3) | describeTonight() in TimingStep, reads settings |
| A3.4 | Artist-side preview never suggested | in progress (WP3) | admin-only view-as rule in complete state |
| A4.1 | Notifications don't deep-link | in progress (WP4a) | entityRoutes map; benefits all roles |
| A4.2 | Airtable sync-held has no email | in progress (WP4b) | new template + send in airtable-poll |
| A4.3 | Member-change consequences | partially superseded by PR #239 | remove dialog now narrates; WP4a adds role descriptions to role menu |
| A4.4 | Schedule-edit: who gets told when | in progress (WP4a) | digest-hour line in ShowDateFormDialog edit mode |
| A5.1 | Suspended screen: no contact | in progress (WP4a) | SUPPORT_EMAIL mechanism ships dark (null) — owner must set a real address |

Plan: `docs/superpowers/plans/2026-08-10-admin-journey-gaps.md` (2 waves, implementer+critic
loops to S-tier, 5-round cap).

## Status — Production team (next up)

P0.1 what is ShowFlow (email; A0.1 fix covers the shared template — verify producer wording) ·
P0.2 role vs admin difference (needs a user-facing capabilities surface) · P2.3 who exactly is
my admin (product: expose admin names to members; deliberately unshipped, RBAC decision) ·
P3.1 dates source (sync vs manual) · P3.2 confirm consequences · P3.3 soft-booked on-surface
explanation · P3.4 tier concept on date sheet · P3.5 outside-cast booking rule · P3.6 when do
artists hear (partially covered by A4.4's pattern; extend to confirm/cancel actions) ·
P4.2 tier-at-risk recovery actions + email · P4.3 understudy deep-link (A4.1 covers) ·
P4.5 void-then-redraft path · P4.6 did the artist see it · P5.1 cancel preview of understudy
promotion · P5.2 cancel: who gets told. All `open`.

## Status — Artist (after that)

R0.1-R0.3 invitation stakes/expectations (email) · R2.1 window duration as a number ·
R3.1 accepted-but-not-booked toast (**highest single-copy impact**) · R3.2 decline
consequences · R3.4 calendar disabled-date explanation · R3.5 zero-eligible empty state ·
R3.6 blocking vs existing bookings · R4.2 response-rate definition · R4.4 who sees my
contact info · R4.5 hire-order terms summary · R4.6 hire-orders card zero-state ·
R4.7 digest hour surfaced · R5.1 how to cancel after confirming · R5.3 confirmation-digest
email CTA · R5.4 deletion: hire orders/in-flight offers. All `open`.

## Cross-role enablers (build once, reuse)

- Settings `?tab=` deep-linking — shipped in WP3 (A3.1); reuse for any notification/email target.
- `entityRoutes.ts` notification→route map — shipped in WP4a (A4.1); extend per new entity type.
- `ROLE_DESCRIPTIONS` mirrored registry — shipped in WP1; reuse for any role-explaining surface.
- Point-of-action narration pattern (digest-hour line) — first instance in WP4a (A4.4); the
  producer items P3.2/P3.6/P5.2 should reuse the same helper/pattern.

## Decision log

- 2026-08-10: PR #239 made membership form at invite time → A1.2 re-scoped from "confirm
  gate" to "success card" (a gate would fight the architecture). A4.3 remove-dialog half was
  already shipped by #239.
- 2026-08-10: PR #238 (magic link) resolved A1.1's mechanics; only the email reassurance line
  remains (folded into WP1).
- 2026-08-10: A3.2 keyed on catalog artists (not app invites): offers reach booking emails
  without app accounts, so "add artists" is the true prerequisite, invites are optional.
- 2026-08-10: SUPPORT_EMAIL ships as a null mechanism; inventing a support address would be
  wrong. Owner sets the value to activate the suspended-screen contact line.
- 2026-08-10: Settings tabs were not URL-addressable; `?tab=` chosen over path segments to
  avoid touching route registration.

## End-of-session checklist

1. Update the status tables above (IDs → shipped/merged, with branch/PR).
2. Update the artifact (republish with status marks for shipped items; keep the same URL via
   the `url` parameter from any session).
3. Update the memory file `user-journey-questions-research.md` if priorities shifted.
4. `npm run verify:fast` green before handing the branch over; note anything skipped.
