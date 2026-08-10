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

0. **Visual approval first (standing owner directive, 2026-08-10).** Before implementing any
   user-facing change, show the owner a before/after mockup and get explicit approval; the
   approved visual is the spec the implementation (and its critics) are held to.

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
| A0.1 | Email: what is ShowFlow | shipped (branch) | productIntro copy key; WP1 capped at 7 rounds, exit A/0 blockers |
| A0.2 | Email: what does "admin" mean | shipped (branch) | per-role copy keys + ROLE_DESCRIPTIONS in the mirrored block |
| A0.3 | Email: who invited me | shipped (branch) | inviter display name via resolveInviterName, fallback email |
| A0.4 | Email: expiry prominence | shipped (branch) | expiresOn from the row; expired invite = honest 409 on resend |
| A1.1 | Account-vs-login narration | shipped (branch) | #238 mechanics + isNewUser-aware ctaHint (two truthful variants) |
| A1.2 | Org/role preview on accept | shipped (branch) | success card (WP2, exit A/0 blockers at cap 7); role x flow x artistLinked-aware next-step lines |
| A1.3 | What did accepting commit me to | shipped (branch) | success card: org, role, capability-checked next step (producer line reads producer_can_confirm_bookings) |
| A3.1 | Concepts not linked from rail steps | shipped (branch) | docs-tab deep link; SettingsPage ?tab= enabler |
| A3.2 | No invite-your-people step | shipped (branch) | `people` step, done = ≥1 ACTIVE artist, flow-aware chip via blockFor |
| A3.3 | "What happens tonight" narrative | shipped (branch) | describeTonight reads the full flow (off/immediate/digest states) |
| A3.4 | Artist-side preview never suggested | shipped (branch) | admin-only rule, scoped to what the picker can actually do |
| A4.1 | Notifications don't deep-link | shipped (branch) | entityRoutes map, reachability-gated (role/entitlement); WP4a capped at B, its last blocker fixed in closure |
| A4.2 | Airtable sync-held has no email | shipped (branch) | airtable-sync-held template + in-app notify + set-keyed idempotency; WP4b capped at B, grammar blockers fixed in closure |
| A4.3 | Member-change consequences | shipped (branch) | remove dialog narrates (#239); role menu carries ROLE_DESCRIPTIONS (WP4a) |
| A4.4 | Schedule-edit: who gets told when | shipped (branch) | scheduleChangeNote, flow-aware; digest-off wording corrected in closure (never names the off email) |
| A5.1 | Suspended screen: no contact | mechanism shipped, DARK | SupportContactLine works; APP_META.SUPPORT_EMAIL is null so the live screen still shows no contact. OWNER TO-DO: set a real address |

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

- 2026-08-10 (wave 1 done): WP1 and WP3 both capped at 7 implementer+critic rounds
  (commits 04c35c2/907cb9f + support files cb85e10/9543215 + residuals 09f651a). Recurring
  critic lesson worth keeping: **static copy must hold in every reachable org state**
  (direct book, immediate delivery, digests off, unregistered artists); when a surface
  cannot read the flow, name what the row HOLDS, not what one pipeline does with it
  (see moduleOnboarding's comments and the OFFER_CLAIM test sweep).
- 2026-08-10: main independently shipped resend delivery-gating + resent-at stamp
  (eaf4931/2687833); merged so a resend sends the rich email, returns honest 422/502 on
  failure, and stamps mark_invitation_resent only after confirmed delivery.
- 2026-08-10: resend does NOT extend expires_at (DB row stays the single expiry source);
  an already-expired pending invite gets a 409 telling the admin to revoke + re-invite.

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
- 2026-08-10 (wave 2 done): WP2 exit A/0 blockers, WP4a and WP4b capped at B; every
  remaining blocker was precisely diagnosed and fixed in a post-workflow closure pass
  (commits 0c3a0a7..da2708c): digest-off note wording, sync-held number agreement
  (email + in-app), sync-report card made cause-neutral + prose em-dash sweep,
  first-run welcome de-falsified for later admins of populated orgs, useBookingFlow
  null-org enabled gate, create-invitation error bodies surfaced, and an invitation
  email preview role switcher (dataOverride through preview-transactional-email).
  Verify:fast green after each step.
- 2026-08-10: local-stack gotcha — the shared local Supabase stack serves edge functions
  from whichever WORKTREE ran `local:up` last; a stale mount renders old templates in
  previews/Mailpit. If live email/edge behavior looks pre-branch, `supabase stop` +
  `npm run local:up` from the current worktree.
- Residual polish (non-blocking, from final critic improvement lists): AcceptInvitePage
  test naming nit (`user: null` case), setup-status call-arg assertions pin hook
  identity, sync-held email answers "did it work" but not per-record "why" (report
  carries it), coverage-row trigger text implies every-run sends.

## End-of-session checklist

1. Update the status tables above (IDs → shipped/merged, with branch/PR).
2. Update the artifact (republish with status marks for shipped items; keep the same URL via
   the `url` parameter from any session).
3. Update the memory file `user-journey-questions-research.md` if priorities shifted.
4. `npm run verify:fast` green before handing the branch over; note anything skipped.
