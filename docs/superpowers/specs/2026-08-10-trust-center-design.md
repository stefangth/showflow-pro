# Trust center: make the claims true, publish them, keep them live

**Date:** 2026-08-10
**Branch:** `claude/trust-center-design-d3znic` (both repos)
**Status:** Design approved, ready for implementation planning
**Repos:** `showflow-pro` (data, docs, in-app surfaces) and `showflow-pro.landingpage` (the public page)

## Context

ShowFlow has no SOC 2 and no ISO 27001, so the usual badge-wall trust page is not
available to us. It is also not what our buyers ask for first. The buyer is typically a
theatre, festival, or touring production, often publicly funded, whose data protection
officer reviews before signature. What they ask for is an Auftragsverarbeitungsvertrag
under Art. 28 GDPR with a technical and organisational measures annex under Art. 32.

There is a second reader that trust-center templates do not anticipate. A freelance artist
does not buy ShowFlow. They are invited into a workspace they did not choose and asked for
a phone number and the days they cannot work. Their question is who can see that. Answering
it well is not only decent, it is how the buyer's DPO gets satisfied, because the DPO is
asking on the artists' behalf.

We already have most of the substance and none of the shop window. The access controls,
audit trails, per-user export, account deletion, consent management, and durable uptime
history are all built and working. They are invisible to anyone outside the codebase.

This spec covers three phases. Phase 1 corrects things that are currently wrong or
understated. Phase 2 publishes the page. Phase 3 makes it live rather than static.

## Current state (verified 2026-08-10 against prod `epweartpzwvcasrzyueh`)

- **Hosting region is `eu-west-1`.** Database, auth, storage, and edge functions run in
  AWS Ireland. The privacy policy currently describes Supabase as "United States and
  European Union regions", which understates the actual posture.
- **The privacy policy describes a schema that no longer exists.** Sections 3.1 and 3.2
  enumerate `availability`, `user_roles`, and `user_approvals`. All three were removed
  (ADR-0007, ADR-0004, ADR-0005). The policy also still describes the approval-queue signup
  that invite-only onboarding replaced.
- **Row-level security is the real access control and it is sound.** Every tenant table
  carries a RESTRICTIVE `org_isolation` policy ANDed onto its permissive grants. Database
  advisors return zero error-level findings. The two "RLS enabled, no policy" notices
  (`auth_link_throttle`, `email_unsubscribe_tokens`) are deny-all by design, reached only by
  the service role.
- **Artist contact fields are already protected.** A plain member matches no permissive
  SELECT policy on `artists` and reads zero other-artist rows. See
  `2026-08-08-artist-contact-privacy-design.md`, which established the pattern this spec
  follows: treat RLS as the control, and make it un-rot-able with pgTAP.
- **`profiles` is the remaining gap.** Its SELECT policy is own-row OR super-admin OR any
  co-org member. The row carries `display_name` and `phone`, so every co-org member,
  including other artists, can read another user's personal phone number.
- **Nothing in the product actually reads another user's `profiles.phone`.** Verified across
  both repos: `list_org_members` returns `display_name`, `email`, `roles`,
  `last_sign_in_at` and no phone; `ChatPanel`, `src/data/settingsAudit.ts`, and
  `src/data/orgs.ts` each select only `user_id, display_name`; `fetchMyProfile` is scoped to
  the caller's own `user_id`; `platform-list-users` goes through the service-role client.
  The exposure is latent, not live.
- **Uptime history is durable and already computed.** `health_daily` is recomputed every 15
  minutes by the `health-rollup` cron, holds 30 days, recomputes whole days so it is
  idempotent, and declines to write when its source is unavailable. It is currently
  readable only in the super-admin console, and it reports per-function failure counts.
- **The landing page has no test harness.** No vitest, no test script, no test files. This
  shapes where Phase 2's testable logic is allowed to live.
- **There is a proven cross-repo publishing pattern.** `public/changelog.md` and
  `public/changelog.json` are generated in this repo, served with
  `Access-Control-Allow-Origin: *` per `vercel.json`, and consumed by the landing page.
  The trust page reuses this rather than inventing a second mechanism.

## Goals

1. Every public claim is true, current, and specific enough to be checked.
2. A buyer's DPO can complete diligence from the page plus two documents, without emailing us.
3. An artist can see exactly who can read each thing we hold about them.
4. The page cannot silently rot as the schema changes.

## Non-goals

- Certification work. SOC 2 and ISO are out of scope here.
- NDA or email gating on the page itself. Gate only the AVV and TOMs annex.
- Two-factor authentication and SSO. Both are real gaps, both are separate work.
- A "what we don't have yet" section. Dropped by decision; see below.

## Decisions

**D1. No published gaps section.** An earlier draft proposed publishing known gaps with
dated commitments. Dropped. It commits us in public to dates we do not control, and the
same honesty is achieved by not overclaiming anywhere else on the page.

**D2. The visibility matrix is a checked-in fixture that pgTAP verifies.** Generating it at
request time from `pg_policies` would put a live schema description on a public endpoint.
Hand-writing it guarantees drift. Instead the matrix lives as data in this repo, and a
pgTAP test asserts each row against real policy behaviour by impersonating each role. If
a future migration widens a policy, the test fails and the public page cannot go stale.

**D3. No tests on the landing page, by design.** The trust page there is copy and layout.
There is nothing to assert that `tsc -b` and review do not already cover, and standing up a
test harness in a repo that has none would be ceremony rather than safety. Everything worth
testing, meaning the matrix and the claims it encodes, lives in `showflow-pro` where the
five test layers already are, and reaches the landing page as published JSON the same way
the changelog does. The rule that keeps this honest: if something on the trust page starts
to feel like it needs a test, that is the signal it belongs in the other repo.

**D4. Fix `profiles.phone` by narrowing the policy, not by splitting the table.** ADR-0011
puts personal phone on `profiles` deliberately. Splitting it into a second table to dodge a
policy problem fights that decision. Narrow the SELECT policy to own-row plus super-admin,
and serve the co-org display-name need through a `SECURITY DEFINER` RPC returning only safe
columns. Fallback if an unmovable direct-read path turns up during implementation: move
`phone` to a `profile_contacts` table with own-row-only RLS.

**D5. Publish in German and English.** The privacy policy already declares the German
version controlling. A trust page for German institutional buyers that exists only in
English signals it was not written for them.

## Phase 1: make the claims true

Nothing may be published until this phase lands. Two documentation changes, one code
change, one drafting task.

### 1a. Reconcile the privacy policy with the current schema

`docs/legal/privacy-policy.en.md` and `docs/legal/privacy-policy.de.md`.

- Section 3.1: drop `user_roles` and `user_approvals`; describe roles as held per
  organisation in `org_memberships`, and describe onboarding as invitation-only.
- Section 3.2: replace `availability` with `blocked_dates` and describe it as dates the
  artist marks unavailable, not a three-state availability declaration.
- Sweep the rest of both documents for any other reference to retired tables or the
  approval-queue signup.
- Bump the "Last updated" date in both, keeping German as controlling.

No tests: these are prose documents rendered through `?raw` imports. The guard is review.

### 1b. State EU-only residency

Same two documents, section 5 and section 6.

- Name the region: primary database, authentication, file storage, and edge functions run
  in the EU (AWS `eu-west-1`, Ireland).
- Keep the transfer-mechanism column honest for processors that do sit in the US.
- Re-check each of the six processors against what it actually touches today. Airtable is
  listed as "currently disabled"; confirm that is still accurate before publishing.

### 1c. Close the `profiles.phone` exposure

The only code change in Phase 1. TDD, following the pattern in
`2026-08-08-artist-contact-privacy-design.md`.

**Step 1, failing test first.** New `supabase/tests/rls/profiles_contact_privacy.sql`,
matching the harness in `supabase/tests/rls/artists_contact_privacy.sql`. Fixture: two users
in one org, one user in a second org.

Assertions, all of which must fail before the fix:

1. As co-org member B: `select phone from profiles where user_id = A` returns empty.
2. As co-org member B: `select display_name from profiles where user_id = A` returns empty
   (direct table read is no longer the path).
3. As user A: own row still readable, `phone` included.
4. As a super-admin: any row readable.
5. As the second-org user: no rows for A, phone or otherwise.

**Step 2, the RPC.** Add `list_org_display_names(p_user_ids uuid[])`, `SECURITY DEFINER`,
returning `user_id, display_name` for users sharing an org with the caller. Add pgTAP
coverage: returns names for co-org users, returns nothing for users in another org, and is
not callable to enumerate arbitrary user ids.

**Step 3, the migration.** Narrow the `profiles` SELECT policy to own-row plus super-admin.
Generated through the migration tool, never hand-edited.

**Step 4, move the three call sites.** `ChatPanel.tsx`, `src/data/settingsAudit.ts`, and
`src/data/orgs.ts` each move from a direct `profiles` select to the new RPC. Data-access
functions get vitest coverage with `src/test/supabaseFake.ts` first, asserting the RPC is
called with the right arguments and the rows map correctly. Then the change.

**Step 5, regenerate types** with `supabase gen types` plus `npm run sync:mirrors`, and run
all three typecheck projects.

**Verification before merge:** grep both repos for any remaining direct `profiles` read on a
user-JWT client. If one exists that cannot move to the RPC, fall back to D4's alternative.

### 1d. Draft the AVV and the Art. 32 TOMs annex

New `docs/legal/dpa.en.md`, `dpa.de.md`, and a TOMs annex in both languages. The annex is
where the RLS architecture, audit trails, EU region, encryption, access control, deletion
routines, and backup handling get written in the form a DPO expects. This is a drafting and
legal-review task, not an engineering one, but it is the single highest-value item in the
phase and it blocks Phase 2's documents section.

## Phase 2: publish the page

### 2a. The matrix fixture and its verification (this repo)

- `src/data/trustMatrix.ts`: the matrix as typed data. Rows are the things we hold, columns
  are you, admins, production team, and other artists. Cells are `visible`, `blocked`, or
  `partial` with a short plain-language qualifier.
- Vitest first: the fixture is well-formed, every row has every column, every `partial` cell
  carries a qualifier.
- pgTAP: `supabase/tests/rls/trust_matrix_matches_policy.sql` proves each cell by
  impersonating each role and attempting the read. This is the test that stops the public
  page from going stale, so it is the important one. Write it before the fixture is final,
  and let it drive the wording.
- A generator writes `public/trust-matrix.json` from the fixture, mirroring the changelog
  script's shape. Never hand-edit the JSON.
- `vercel.json` serves it with `Access-Control-Allow-Origin: *`, as the changelog files are.

### 2b. The page (landing page repo)

New `/trust` route in `src/App.tsx`, `src/pages/Trust.tsx`, following the existing
`Privacy.tsx` composition and the section spacing rules in that repo's CLAUDE.md.

Sections, in reading order:

1. Posture summary: residency, uptime, subprocessor count.
2. Where your data lives.
3. How organisations are kept apart.
4. Who can see what: the matrix, fetched from the published JSON with the checked-in copy
   as fallback if the fetch fails.
5. Your rights, with real buttons that deep-link into the app.
6. Subprocessors, what each one touches, and how we give notice of changes.
7. Documents: privacy policy, terms, and the AVV plus TOMs annex behind an email form.
8. Reporting a security problem.

Also: `/.well-known/security.txt`, a footer link, and the nav pill entry. German and
English per D5, using whatever pattern the repo settles on for the privacy page.

No tests here, per D3. `Trust.tsx` is copy and layout, guarded by `npm run build` and
review. Keep it that way: the moment it wants logic, that logic belongs in `showflow-pro`
and should arrive here as published data.

## Phase 3: make it live

### 3a. Public uptime endpoint

New edge function `public-uptime`, `verify_jwt = false`, with a `[functions.public-uptime]`
block in `supabase/config.toml`.

Deno tests first, covering:

- A single aggregated availability percentage over 30 days, with no per-function
  breakdown in the response. A public map of which subsystem is weakest is reconnaissance,
  not transparency, so this assertion is the point of the endpoint.
- Daily buckets carry a status band only, never raw failure counts.
- Stale or missing `health_daily` data returns a clearly marked unknown rather than a
  fabricated 100%.
- Cache headers, so the page does not drive load onto the rollup.

Then the handler, using `handle(req, deps)` with `realDeps()` wired at the bottom.

### 3b. In-app "Your data" panel

`ProfilePage` already holds export, deletion, and password change at the bottom of a
settings form. Promote them into a panel with context, and add the matrix scoped to the
current workspace plus a plain answer to what happens when you leave.

Vitest first, with `renderWithProviders` and `supabaseFake`: the panel renders each matrix
row, export triggers the existing RPC, deletion shows the last-admin guard message.

### 3c. Settings, Trust and compliance tab

Admin-facing, org-scoped: which DPA version this org accepted and when, an access review
listing everyone holding admin rights, audit-log export, and retention settings. New
data-access functions in `src/data/` with vitest coverage first, then the tab.

Accepting a DPA version needs a small table with the usual org-isolation policy template
and pgTAP coverage.

### 3d. Subprocessor change notices

Art. 28(2) requires notice before adding a subprocessor. We already have a notifications
table and per-category preferences, so route it through those and get a delivery record as
a side effect. New notification category, an admin-only trigger to raise a notice, and
tests at the category and trigger level.

## Testing summary

| Change | Layer | Written first |
|---|---|---|
| `profiles` policy narrowing | pgTAP | yes, must fail before the migration |
| `list_org_display_names` | pgTAP | yes |
| Moved `profiles` call sites | vitest, `supabaseFake` | yes |
| Trust matrix fixture | vitest | yes |
| Matrix matches live policy | pgTAP | yes, drives the wording |
| `public-uptime` | Deno, `makeFakeDeps` | yes |
| Your data panel | vitest, `renderWithProviders` | yes |
| Trust and compliance tab | vitest, plus pgTAP for the new table | yes |
| Subprocessor notices | vitest and pgTAP | yes |
| Legal documents | none, review only | n/a |
| `Trust.tsx` | none by design (D3) | n/a |

## Risks

- **Narrowing the `profiles` policy could break a read path not found in this sweep.**
  Mitigated by the pre-merge grep and by D4's fallback. Realtime respects RLS, so a
  subscription on `profiles` would also narrow; check for one during implementation.
- **The AVV is legal drafting and will not move at engineering pace.** It blocks Phase 2's
  documents section but nothing else. Start it at the top of Phase 1 and let the rest of
  the phase run alongside.
- **The matrix wording has to stay plain while the pgTAP test stays precise.** These pull in
  opposite directions. Resolve it by keeping the test's assertions authoritative and the
  fixture's prose short, with the qualifier field carrying any nuance.
- **Publishing an uptime figure invites being held to it.** We are not offering an SLA, and
  the page should not imply one.

## Open questions

1. Who reviews and signs off the AVV and TOMs annex, and by when?
2. Does the German trust page need its own route, or a language toggle on one route? The
  privacy page's existing approach should probably decide it.
3. Do we want the matrix visible to logged-out visitors, or only in-app? Public is the
  stronger position, and the pgTAP guard is what makes it safe.
