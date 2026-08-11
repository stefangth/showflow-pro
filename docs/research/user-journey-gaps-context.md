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

## Status — Production team (16 items, branch: `claude/user-journey-gaps-context-e7f182`)

| ID | Item | Status | Notes |
|---|---|---|---|
| P0.1 | Email: what is ShowFlow (producer) | verified covered | admin rewrite already gives producers a real role line ("Your role is Production Team. You plan productions and show dates, and book artists into them."); no change |
| P0.2 | Role vs admin difference | shipped (branch) | `PRODUCER_ROLE_NOTE` + "See what each role can do" link to Settings `?tab=docs` on the waiting card (real Link) and producer complete-state rules (WP-P2) |
| P2.3 | Who exactly is my admin | shipped (branch) | new producer-safe `list_org_admin_names(p_org)` RPC (names only, member-guarded); waiting card names admins ("Ask Nadia or Tom…"), falls back to generic when none (WP-P2) |
| P3.1 | Dates source (sync vs manual) | shipped (branch) | `DATE_SOURCE_NOTE` on ShowDateFormDialog create mode; holds whether or not Airtable is configured (WP-P1) |
| P3.2 | Confirm consequences | shipped (branch) | `confirmConsequenceNote` under the cast confirm control; flow-aware + entitlement-gated (bare line when booking_flow off); named confirm toast (WP-P1) |
| P3.3 | Soft-booked on-surface explanation | shipped (branch) | `SOFT_BOOKED_MEANING` tooltip on both the cockpit "Accepted" badge and the module-off "Soft-booked" badge (WP-P1) |
| P3.4 | Tier concept on date sheet | shipped (branch) | `TIER_CONCEPT_NOTE` + "How casts and tiers work" link (`?tab=docs`) by the tier picker (WP-P1) |
| P3.5 | Outside-cast booking rule | shipped (branch) | `unrestrictedEligibilityNote` above the book list, shown only when the date has no cast limits (WP-P1) |
| P3.6 | When do artists hear | shipped (branch) | answered inline by the confirm consequence line + the cancel who-hears line (the two actions that had no narration); open-tier already narrated delivery (WP-P1) |
| P4.2 | Tier-at-risk recovery + email | shipped (branch) | in-app message softened + recovery guidance ("open the next tier / direct-book"); new `tier-at-risk` email once per newly-at-risk (tier, recipient) pair, failure-swallowed; system-map updated (WP-P4) |
| P4.3 | Understudy deep-link | already on main | `notificationTarget()` routes `understudy_promoted` + every producer notification to `/bookings`; no work |
| P4.5 | Void-then-redraft path | shipped (branch) | void dialog reworded to point to issuing a fresh order (WP-P3, hire-orders module dark) |
| P4.6 | Did the artist see it | shipped (branch) | `viewed_at` + `mark_hire_order_seen` RPC (in-app view stamp, privacy-safe, NOT email opens); "Seen" timeline step reached only when seen (WP-P3) |
| P5.1 | Cancel preview of understudy promotion | shipped (branch) | per-row Cancel now an AlertDialog previewing understudy auto-promotion (flow-aware); whole-date "Cancel date" untouched (WP-P1) |
| P5.2 | Cancel: who gets told | shipped (branch) | cancel dialog who-hears line reuses `scheduleChangeNote`; entitlement-honest (WP-P1) |

Plan: `docs/superpowers/plans/2026-08-11-producer-journey-gaps.md` (Phase 0 DB foundation + 4 parallel WPs, subagent-driven implementer+reviewer loops). `verify:fast` + `verify:full` (pgTAP + e2e) green. Not merged (owner packages release).

### Session execution trail (producer, 2026-08-11)

Executed via `superpowers:subagent-driven-development`, parallelized: Phase 0 (sequential, gates the wave) then WP-P1..P4 as one wave of disjoint-file implementers, each with a fresh-agent task review + fix loop, then a whole-branch review. Approved scope + copy first via the before/after mockup (owner picked in all three heavier items). Commit chain (`main` = 32416aa):

| Commit | What | Review outcome |
|---|---|---|
| `2de672b` | Implementation plan | pre-flight scan clean |
| `61000f6` | Phase 0: `list_org_admin_names` RPC + `hire_orders.viewed_at`/`mark_hire_order_seen` + pgTAP + regen types | Spec PASS / Quality Approved. Reviewer mutation-tested the pgTAP suites red to prove they are genuine. 1 owner-note (CLI `__InternalSupabase` drift). |
| `7413917` | WP-P2: producer role explainer + admin names | Spec PASS / Approved. 1 parked (rails-link plain text; requirement met by card link). |
| `fc789bb` | WP-P3: hire-order void copy + artist-seen timeline | Spec PASS / Approved. 1 deferred minor (void-after-seen cosmetics). |
| `f8202db` | WP-P4: tier-at-risk recovery message + email | Spec FAIL (system map not updated) -> fix loop. |
| `4e63856` | WP-P1: cockpit confirm/cancel/soft-booked/tier/eligibility narration | Spec FAIL (1 Critical: required props broke DevCockpitHarness; 1 Important: fail-open entitlement read) -> fix loop. Implementer also survived a mid-task API-error resume. |
| `0f78a1e` | WP-P4 fix: system map (md + `systemMap.ts`) reflects the email; guard the email path | scoped re-review: both ADDRESSED. |
| `b3cb3cd` | WP-P1 fix: props optional + guarded; cancel who-hears honest via `useEntitlements()`+`!isLoading` | scoped re-review: both ADDRESSED (reviewer ran full tsc clean). |
| `227acc7` | WP-P3 fix: complete a sibling test's `vi.mock` (caught only by the full-suite `verify:fast`) | full suite green. |
| `725d8ee` | Final fix wave: confirm line honest under entitlement (I-1) + guard tier-at-risk insert before email (M-2) | whole-branch review (opus) READY-after-fix; scoped re-review: both ADDRESSED, no new breakage. |
| `c2e3fa1` | docs: this status update | - |

Whole-branch review (opus) verdict: **READY after 1 Important**, 0 Critical. RPC security passed clean (member-guard, names-only, linked-artist-only idempotent write, no cross-org leak, pgTAP-covered); tier-at-risk email once-per-newly-at-risk-pair gating + failure-swallowing confirmed; both system maps + all exhaustive registries updated; no em/en dashes. The Important (confirm-line entitlement honesty, twin of the cancel fix) was fixed rather than deferred. Deferred/parked (none block merge): Phase-0 CLI marker drift (owner infra note), WP-P2 rails-link plain text + "Production Team" verbatim hardcode, WP-P3 void-after-seen cosmetics, M-1 (confirm line omits unregistered-artist caveat; the confirm target accepted an offer so has contact), M-3 (inert stacked DialogDescription that cannot co-occur). Full artifacts under `.superpowers/sdd/2026-08-11-producer-journey-gaps/` (ledger + per-WP briefs/reports/reviews).

## Status — Artist (16 items, branch: `claude/artist-items-journey-gaps-f181d5`)

| ID | Item | Status | Notes |
|---|---|---|---|
| R0.1 | Email: what is ShowFlow (artist) | verified covered | invitation `productIntro` renders for every invitee ("ShowFlow is where {{orgName}} plans its shows and books the artists for them."); same call as producer P0.1, no change |
| R0.2 · R0.3 | Invite: on the roster + stakes (offers by email, one tap) | shipped (branch) | `roleIntroArtist` (flow-neutral) gains "You are on the roster."; `roleIntroArtistOffers` (offers confirmed) adds "booking offers by email, accept or decline each in one tap". Benefit stays only on the gated line; flow-neutral line makes no offer promise (WP-R4) |
| R2.1 · R4.7 | Response window + digest hour as numbers | shipped (branch) | availability page renders `describeTonightStandalone(useFlowTimes, flow)` gated on `flow.artist_acceptance` (never leaks the confirmation-digest sentence to direct-book/paused orgs); reuses the producer helper verbatim (WP-R1) |
| R3.1 | Accepted-but-not-booked toast (**highest single-copy impact**) | shipped (branch) | new `acceptConsequenceNote(flow)` in actionCopy.ts; hold flow toast = "Offer accepted" + "Hold placed. Your producer confirms next."; auto-confirm = "Offer accepted. You're booked." Logic mirrors the mutation's own `autoConfirm` (WP-R2) |
| R3.2 | Decline consequences | shipped (branch) | decline toast gains "This just cancels this one offer. It will not affect future offers." (verified truthful through the DB triggers) (WP-R2) |
| R3.4 | Calendar disabled-date explanation | shipped (branch) | ineligible cell gets `title` + sr-only span: "This date is not offered to you. Offered dates come from your casts and their required skills." (widened for skill-gate honesty) (WP-R1) |
| R3.5 | Zero-eligible empty state (calendar) | shipped (branch) | "No eligible dates yet. Once you are added to a cast, offered dates appear here." matches the list view; also fixes the super-admin module-off preview (WP-R1) |
| R3.6 | Blocking vs existing bookings | shipped (branch) | "...Dates you are already booked for are not affected." (WP-R1) |
| R4.2 | Response-rate definition | shipped (branch) | `MeterSpec.explainer`, flow-derived: offer meter "Counts dates you accepted or were booked for, out of dates you were offered. It is just for you, no one is scored on it."; direct-book variant matches its own `countStatuses` (WP-R2) |
| R4.4 | Who sees my contact info | shipped (branch) | note on ProfilePage (phrased about the artist record, not the account phone) + matching helper on the producer-facing ArtistProfileSheet; true to RLS (admin/producer/self) (WP-R3) |
| R4.5 | Hire-order terms summary + after-signing | shipped (branch) | SignHireOrderDialog gains "You are agreeing to the fee, dates, and terms shown on this order. Adding your signature completes it, and we email you the final signed PDF." CONSENT_TEXT untouched; ships dark with hire_orders (WP-R3) |
| R4.6 | Hire-orders card zero-state | shipped (branch) | card renders inside `hireOrdersEnabled` even when empty ("Your booking paperwork shows up here..."); module-off orgs still show nothing (WP-R2) |
| R5.1 | How to cancel after confirming | shipped (branch) | ArtistBookingsView signpost (booking_flow-gated): "Need to cancel a date you confirmed? Message your producer in the date's chat..." (WP-R3) |
| R5.3 | Confirmation-digest email CTA | shipped (branch) | EmailShell `cta` → `APP_URL/bookings`, "View your bookings"; moved into the app-link contract test (WP-R4) |
| R5.4 | Deletion: hire orders / in-flight offers | shipped (branch) | delete copy names open offers ("kept but de-identified") + hire_orders-gated retention clause; corrected away from a false "details removed" claim (anonymize_user keeps PII in the snapshot) (WP-R3) |

Plan: `docs/superpowers/plans/2026-08-11-artist-journey-gaps.md` (13 tasks / 4 disjoint-file WPs, no Phase 0, no migration). Spec: `docs/superpowers/specs/2026-08-11-artist-journey-gaps-design.md`. `verify:fast` green (all 8 layers, twice). `verify:full` skipped (no DB surface; no e2e pins changed copy). Not merged (owner packages release).

### Session execution trail (artist, 2026-08-11)

Executed via `superpowers:subagent-driven-development` on `sonnet` implementers/reviewers with an `opus` whole-branch review. 4 WP-level implementers (sequential — no parallel implementers on a shared worktree), each with a fresh-agent task review + fix loop, then the whole-branch review + one fix wave. Owner approved scope + copy first via the before/after mockup (all recommendations, R3.1/R4.2/R4.4 = Option A). No migration this session (every fix reused existing settings/helpers). Commit chain (`main` = 676ffb6):

| Commit | What | Review outcome |
|---|---|---|
| `426c385`,`f26fe96` | Spec + implementation plan | pre-flight scan clean |
| `9b1a203`,`f9d0ee7`,`5d84779` | WP-R1: availability timing line + ineligible/empty-state + blocking note | Spec ❌ → fix. Critical: timing line leaked the confirmation-digest sentence onto direct-book orgs (describeTonight returns non-null when confirmation_digest true, the default/"direct" preset); the "no line" test passed vacuously. + 2 Important (skill-gate wording, aria-label on role-less div). |
| `fe7a66d` | WP-R1 fix: gate on `artist_acceptance` + testid; widen ineligible wording; sr-only span | re-review: all addressed. |
| `ad28425`,`b2bce09`,`3727360`,`0808f1a` | WP-R2: acceptConsequenceNote + accept/decline toasts + meter explainer + hire-orders zero-state | Spec ✅ / Approved, 0 findings (first pass). |
| `af26944`,`23a6101`,`0e75258`,`feeb490` | WP-R3: contact note + hire-order terms + cancel signpost + deletion copy | Spec ❌ → fix. Critical: R5.4 "with your details removed" false (anonymize_user only nulls FKs; PII persists). + Important: new ProfilePage test hand-rolled `vi.mock`. |
| `dda8657` | WP-R3 fix: true retention-only deletion copy; migrate identity test to the harness | re-review: all addressed. |
| `fae3553`,`a7d85be` | WP-R4: artist invite role lines + confirmation-digest CTA (mirror-synced) | Spec ✅ / Approved. app-links `ctaUrl` generalization strengthens the contract; emailTemplateMeta entry required by coverage test. |
| `5c53fa9` | Final fix wave (from whole-branch opus review): correct R4.5 false countersign claim + tighten R5.4 opening | scoped re-review: both addressed, no new breakage. |

Whole-branch review (opus) verdict: **READY WITH FIXES**, 1 Critical (R4.5 after-signing claimed an org-countersign step that does not exist — in electronic mode the artist's signature IS the countersignature; it also contradicted the dialog's own description), fixed in `5c53fa9`. The WP-R3 task review had wrongly affirmed that sentence as true — the whole-branch pass caught it, validating the two-tier review. `verify:fast` all 8 layers green after the fix.

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

- 2026-08-11 (producer session done): all 16 production-team items closed on branch
  `claude/user-journey-gaps-context-e7f182` (Phase 0 + 4 WPs, subagent-driven implementer+reviewer
  loops). P4.3 was already on main; P0.1 verified covered (no change). Two additive migrations,
  owner-approved via the before/after mockup + option picker: `list_org_admin_names` (P2.3, reverses
  the earlier "deliberately unshipped RBAC" call, names-only + member-guarded) and `hire_orders.viewed_at`
  + `mark_hire_order_seen` (P4.6). P4.6 "seen" is defined as the linked artist opening the order IN THE
  APP (privacy-safe view stamp), explicitly NOT email-open pixel tracking.
- 2026-08-11: recurring critic lesson (again): a point-of-action line must gate on the org's REAL
  entitlement, not the flow's `active` flag or `useFeature` (which fails open during load + bypasses for
  super-admins). Both the cancel who-hears line AND the confirm line were fixed to read `useEntitlements()`
  gated on `!isLoading` (mirroring ShowDateFormDialog), so a super-admin on an un-entitled org never sees a
  false "email at 20:00" promise. Two independent review passes (per-WP + whole-branch) each caught one half.
- 2026-08-11: required-prop blast radius. Adding required props to a shared component (`CockpitCastList`)
  broke a consumer outside the WP's file list (`DevCockpitHarness`), and a new hook export
  (`useMarkHireOrderSeen`) broke a sibling test's `vi.mock`. Both were invisible to the WPs' targeted test
  runs and only surfaced in the whole-tree `verify:fast`. Lesson for parallel disjoint-file WPs: the
  authoritative full tsc + full vitest must run once after the wave; new required props / new module exports
  need a sweep of every consumer and every `vi.mock` of that module.
- 2026-08-11: owner to-do (infra): the local Supabase CLI (2.112.0) drops the unused
  `__InternalSupabase.PostgrestVersion` marker on `gen types`; harmless (type-only, unused, tsc/mirrors
  clean) but will flap as diff noise while CI's CLI is unpinned. Pin/upgrade the CI Supabase CLI when
  convenient. Do NOT hand-restore the block (would violate the no-hand-edit-generated-types rule).

- 2026-08-11 (artist session done): all 15 working artist items shipped on branch
  `claude/artist-items-journey-gaps-f181d5` (R0.1 verified covered, no change). No migration —
  every fix reused existing settings/helpers (`describeTonightStandalone`, `useFlowTimes`,
  `SOFT_BOOKED_MEANING`, `MeterSpec`, `useFeature`). Three copy strings were corrected AWAY from the
  owner-approved before/after artifact, each for factual honesty (the standing owner directive): the
  ineligible-cell reason widened to name skill requirements (they gate eligibility too, not just casts);
  the R5.4 deletion clause dropped "with your details removed" (`anonymize_user` only nulls the FK
  columns — the artist's name/email/phone persist in the frozen `hire_orders.data` snapshot and the
  denormalized `signer_name`/`signer_email`); and the R4.5 after-signing line dropped "your organization
  countersigns" (in electronic mode the artist's own signature IS the countersignature: `issued` →
  `countersigned` on the artist's action, no later org step). Owner may want to review these three.
- 2026-08-11: recurring critic lesson (artist edition of the producer's "hold in every state" rule): a
  point-of-action line that DELEGATES to a shared flow helper inherits that helper's FULL behavior, not
  just the branch you had in mind. `describeTonightStandalone` looks like "the offer-window sentence" but
  also composes a producer-framed confirmation-digest sentence for direct-book orgs (whenever
  `confirmation_digest` is on, the default). Gating "render when non-null" leaked that onto direct-book
  artists; the fix was to gate on `flow.artist_acceptance` — the actual precondition for R2.1/R4.7 (an
  artist who receives offers). And: a two-tier review earns its keep — the WP task review affirmed the
  false R4.5 countersign sentence as "verified true"; the opus whole-branch review refuted it.

## End-of-session checklist

1. Update the status tables above (IDs → shipped/merged, with branch/PR).
2. Update the artifact (republish with status marks for shipped items; keep the same URL via
   the `url` parameter from any session).
3. Update the memory file `user-journey-questions-research.md` if priorities shifted.
4. `npm run verify:fast` green before handing the branch over; note anything skipped.
