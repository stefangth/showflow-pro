# Org-Invite Membership Fix + Unified Admin People List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make an org invitation create the invitee's membership (and, for artists, an artist profile) at invite time, self-heal any auth path that lands without acceptance, and merge the Admin > People members + pending-invite lists into one row-per-person list with an Active/Invited pill.

**Architecture:** A new service-role SECURITY DEFINER helper `ensure_invitation_membership(p_invitation, p_user)` centralizes membership insert + artist create-or-claim; `accept_invitation` and a new `claim_my_invitations()` route through it, and a new `revoke_invitation(p_id)` reverses it. The three invite-sending edge paths (`create-invitation`, `provision-org`, `resend-invitation`) resolve the invitee's user id and call the helper immediately after the invitation exists, so membership exists before the person ever clicks a link. AuthContext calls `claim_my_invitations()` best-effort on every identity load so recovery/plain-login paths reconcile without SQL backfill, and the People pane renders a single `buildPeople(members, pendingInvites)` list above the read-only invitation-history card.

**Tech Stack:** React 18 + Vite + TS, Tailwind + shadcn/ui, @tanstack/react-query v5, Supabase (Postgres RPCs, Deno edge functions), Vitest + jsdom, Deno test, pgTAP.

## Global Constraints

- TEST-FIRST across all five layers; every new logic branch gets a failing test before implementation; tests import the real module and never re-implement production logic.
- Data-access functions are `fetchX(client, args)` / `mutateX(client, args)` tested with `src/test/supabaseFake.ts` (`createFakeSupabase`); never `vi.mock` the client.
- Edge handlers are `handle(req, deps)` tested with `makeFakeDeps` / `makeRequest` from `supabase/functions/_shared/testing.ts` and asserts from `supabase/functions/_shared/test-asserts.ts`; use `_shared/http.ts`, `_shared/auth.ts`, `_shared/invitations.ts` — never re-inline CORS/auth/client creation.
- pgTAP tests live in `supabase/tests/rpc/`, wrapped `BEGIN; CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions; SELECT plan(N); … SELECT * FROM finish(); ROLLBACK;`, using `SET session_replication_role = replica;` to seed `auth.users` and `set_config('request.jwt.claims', …)` + `SET LOCAL ROLE authenticated` to exercise as a user.
- `any` is banned (CI `--max-warnings 0`); for joined rows use an explicit interface + a single `as unknown as` cast at the query boundary.
- Every new SQL function: `SECURITY DEFINER` + `set search_path = public`; `revoke all … from public, anon`; grant only the intended role. All new functions here are created by the migration, which runs as the `postgres` superuser, so each function is OWNED by `postgres`.
- **Owner-privilege assumption (do not "fix" by widening grants):** `ensure_invitation_membership` is granted to `service_role` ONLY, yet `accept_invitation` and `claim_my_invitations` call it. This works precisely because all three are `SECURITY DEFINER` owned by `postgres` (a superuser), and a SECURITY DEFINER body executes as its owner, who bypasses `EXECUTE` ACL checks. The pgTAP grant-boundary assertion (Task 1, test #9: `authenticated → 42501`) depends on the helper staying service-role-only. Do NOT add `authenticated` to its grant to "make a caller work" — that would silently open the helper to any signed-in user.
- Migrations auto-apply on merge via the Supabase GitHub integration — do NOT hand-apply to prod, do NOT hand-edit `supabase/migrations/` or `src/integrations/supabase/types.ts`. New RPCs require a migration, then `supabase gen types typescript --local` from a stack that has the migration, then `npm run sync:mirrors` (CI gates `npm run sync:mirrors:check`).
- Query keys are domain-prefixed (`['org-invitations', orgId]`, `['members', orgId]`); mutations invalidate the whole domain prefix. Use `sonner` toasts; React Query `isLoading`/`isError`; `Skeleton` for loading, `Alert variant="destructive"` for errors.
- Semantic color tokens only (no `bg-white`/`text-black`); no em/en dashes in user-facing copy.
- Update `public/changelog.md` for user-facing changes (newest-first, `- **Title** description`), then regenerate `public/changelog.json` via `deno run --allow-read --allow-write scripts/changelog-to-json.ts`; never mention super-admin/platform actions in the changelog.
- New migration timestamp must be `20260809170000` or later (avoid the known-colliding `20260809120000`; current head is `20260809160000`).
- Verify: `npm run lint`; `npx tsc -p tsconfig.app.json --noEmit`; `npx tsc -p tsconfig.tools.json --noEmit`; `deno check --node-modules-dir=none supabase/functions/*/index.ts`; `npx vitest run`; `deno test --allow-all supabase/functions/`; pgTAP via `supabase test db`. Two-tier: `npm run verify:fast` / `npm run verify:full`.

## File Structure

**Create**
- `supabase/migrations/20260809170000_invite_membership_and_self_heal.sql` — `ensure_invitation_membership`, reimplemented `accept_invitation`, `claim_my_invitations`, `revoke_invitation`.
- `supabase/tests/rpc/ensure_invitation_membership.sql` — pgTAP for the helper (membership insert, artist claim-by-id, claim-by-email, auto-create, owner no-op, service-role-only grant).
- `supabase/tests/rpc/claim_my_invitations.sql` — pgTAP for the self-heal loop.
- `supabase/tests/rpc/revoke_invitation.sql` — pgTAP for revoke (status flip + membership removal + admin/super-admin gates + last-admin guard + accepted-invite guard).
- `src/components/admin/people/PersonRow.tsx` — one merged person row (Active vs Invited).
- `src/components/admin/people/PersonRow.test.tsx` — render tests for both states.

**Modify**
- `supabase/functions/_shared/invitations.ts` — split `deliverOrgInvitation` into `ensureInvitedUser` + `sendOrgInvitationEmail` (drop `userExistsByEmail` + `deliverOrgInvitation`).
- `supabase/functions/_shared/invitations.test.ts` — rewrite for the two new functions.
- `supabase/functions/create-invitation/index.ts` — reuse the already-resolved `existingUserId`, resolve net-new via `ensureInvitedUser`, call `ensure_invitation_membership` (best-effort/logged), then send email best-effort.
- `supabase/functions/create-invitation/index.di.test.ts` — add a membership-RPC assertion via the net-new path (adminDeps untouched).
- `supabase/functions/provision-org/index.ts` — look up invitation id by token, resolve invitee id, call `ensure_invitation_membership` (best-effort/logged), then deliver.
- `supabase/functions/provision-org/index.di.test.ts` — assert the membership RPC call.
- `supabase/functions/resend-invitation/index.ts` — migrate off `deliverOrgInvitation` to `ensureInvitedUser` + idempotent `ensure_invitation_membership` + `sendOrgInvitationEmail`.
- `supabase/functions/resend-invitation/index.di.test.ts` — update the delivery assertion.
- `supabase/tests/rpc/accept_invitation.sql` — add an artist-auto-create regression (count assertion).
- `src/data/invitations.ts` — add `claimMyInvitations`; change `revokeInvitation` to call the `revoke_invitation` RPC.
- `src/data/invitations.test.ts` — update `revokeInvitation` test; add `claimMyInvitations` test.
- `src/features/auth/AuthContext.tsx` — call `claimMyInvitations` best-effort at the top of `loadIdentity`.
- `src/pages/ResetPasswordPage.tsx` — preserve `?redirect=` into the recovery `redirectTo`.
- `src/components/admin/people/peopleMatch.ts` — add `Person` type + `buildPeople` + `filterPeopleList`; delete now-unused `filterPeople` (keep `filterInvitesByEmail`).
- `src/components/admin/people/peopleMatch.test.ts` — add `buildPeople`/`filterPeopleList` tests.
- `src/components/admin/people/PeopleTab.tsx` — render the single merged list via `buildPeople` + `PersonRow`; keep the read-only invitation-history card.
- `src/hooks/useInvitationMutations.ts` — invalidate `['members']` on create/revoke.
- `src/integrations/supabase/types.ts` (regenerated, not hand-edited) + `supabase/functions/_shared/database.types.ts` (via `npm run sync:mirrors`).
- `public/changelog.md` + `public/changelog.json` (regenerated).

---

### Task 1: `ensure_invitation_membership` SQL helper + pgTAP

**Files**
- Create: `supabase/migrations/20260809170000_invite_membership_and_self_heal.sql` (this task adds only the `ensure_invitation_membership` function; later tasks append to the same file).
- Create: `supabase/tests/rpc/ensure_invitation_membership.sql`

**Interfaces**
- Produces SQL: `public.ensure_invitation_membership(p_invitation uuid, p_user uuid) returns boolean` — SECURITY DEFINER, grant `service_role` only. Inserts `org_memberships(org_id, user_id, role)` from the invitation `ON CONFLICT (org_id,user_id,role) DO NOTHING`; for `role='artist'` claims by `artist_id`, else claims an unclaimed row by `lower(email)`, else auto-creates an `artists` row (unless the user already owns one in the org). Returns `artist_linked` (false only when an `artist_id`-stamped claim was skipped by the owner guard).

**Steps**
- [ ] Write the failing pgTAP test `supabase/tests/rpc/ensure_invitation_membership.sql`:
```sql
-- Tests for public.ensure_invitation_membership(p_invitation, p_user).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('bbbbbbbb-bbbb-e001-0000-000000000000','authenticated','authenticated','ensure-a@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('bbbbbbbb-bbbb-e002-0000-000000000000','authenticated','authenticated','ensure-b@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('bbbbbbbb-bbbb-e003-0000-000000000000','authenticated','authenticated','ensure-c@test.com', now(),'{"provider":"email"}','{}',now(),now());

INSERT INTO public.organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-0000000e0001','Ensure Org','ensure-org');

-- Producer invite (no artist): membership only.
INSERT INTO public.org_invitations (id, org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-00000000e101','00000000-0000-0000-0000-0000000e0001','ensure-a@test.com','producer','tok-e-a','pending');
-- Artist invite, plain email, NO matching artist row → must auto-create.
INSERT INTO public.org_invitations (id, org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-00000000e102','00000000-0000-0000-0000-0000000e0001','ensure-b@test.com','artist','tok-e-b','pending');
-- Artist invite, plain email, WITH an unclaimed artist row by email → must claim it.
INSERT INTO public.artists (id, org_id, name, email, status)
VALUES ('00000000-0000-0000-0000-0000000ar501','00000000-0000-0000-0000-0000000e0001','Claimable','ensure-c@test.com','active');
INSERT INTO public.org_invitations (id, org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-00000000e103','00000000-0000-0000-0000-0000000e0001','ensure-c@test.com','artist','tok-e-c','pending');
SET session_replication_role = DEFAULT;

-- 1. Producer invite → membership created (returns true, nothing to link).
SELECT is(
  public.ensure_invitation_membership('00000000-0000-0000-0000-00000000e101','bbbbbbbb-bbbb-e001-0000-000000000000'),
  true, 'producer invite returns artist_linked true');
-- 2. Membership row exists for the producer.
SELECT is(
  (SELECT count(*)::int FROM public.org_memberships
   WHERE org_id='00000000-0000-0000-0000-0000000e0001' AND user_id='bbbbbbbb-bbbb-e001-0000-000000000000' AND role='producer'),
  1, 'producer membership created');
-- 3. No artist row was created for a producer.
SELECT is(
  (SELECT count(*)::int FROM public.artists WHERE org_id='00000000-0000-0000-0000-0000000e0001' AND user_id='bbbbbbbb-bbbb-e001-0000-000000000000'),
  0, 'producer gets no artist row');
-- 4. Artist invite with no matching row → auto-creates an artist.
SELECT is(
  public.ensure_invitation_membership('00000000-0000-0000-0000-00000000e102','bbbbbbbb-bbbb-e002-0000-000000000000'),
  true, 'artist invite with no row returns true');
-- 5. The auto-created artist has the user linked and name from the email local-part.
SELECT is(
  (SELECT name FROM public.artists WHERE org_id='00000000-0000-0000-0000-0000000e0001' AND user_id='bbbbbbbb-bbbb-e002-0000-000000000000'),
  'ensure-b', 'auto-created artist name derives from email local-part');
-- 6. Artist membership row exists.
SELECT is(
  (SELECT count(*)::int FROM public.org_memberships
   WHERE org_id='00000000-0000-0000-0000-0000000e0001' AND user_id='bbbbbbbb-bbbb-e002-0000-000000000000' AND role='artist'),
  1, 'artist membership created');
-- 7. Artist invite with an unclaimed email row → claims it (no new row).
SELECT is(
  public.ensure_invitation_membership('00000000-0000-0000-0000-00000000e103','bbbbbbbb-bbbb-e003-0000-000000000000'),
  true, 'artist invite claims an unclaimed email row');
-- 8. That exact row is now owned; no duplicate artist was created.
SELECT is(
  (SELECT count(*)::int FROM public.artists
   WHERE org_id='00000000-0000-0000-0000-0000000e0001' AND user_id='bbbbbbbb-bbbb-e003-0000-000000000000'),
  1, 'email claim links exactly one artist row, no duplicate');
-- 9. Grant boundary: NOT executable by authenticated (service_role only). The permission
--    check fires before execution, so a repeat invitation id still throws 42501. This
--    assertion is load-bearing for the owner-privilege model in Global Constraints:
--    keep the grant service-role-only; do NOT add `authenticated` here.
SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-bbbb-e001-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.ensure_invitation_membership('00000000-0000-0000-0000-00000000e101','bbbbbbbb-bbbb-e001-0000-000000000000') $$,
  '42501', NULL, 'authenticated cannot execute ensure_invitation_membership');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
```
- [ ] Run-to-fail: `supabase test db` (or, if Docker-free, run the file's SQL inside a `BEGIN;…ROLLBACK;` via the Supabase MCP `execute_sql`). Expected failure: `function public.ensure_invitation_membership(uuid, uuid) does not exist`.
- [ ] Write the minimal implementation — create `supabase/migrations/20260809170000_invite_membership_and_self_heal.sql` with the helper:
```sql
-- Invite-time membership + artist provisioning, plus self-heal + revoke.
-- ensure_invitation_membership centralizes: membership insert (idempotent) and, for
-- artist invites, claim-by-id → claim-by-email → auto-create. service_role only:
-- called by the edge admin client and (as function OWNER = postgres, which bypasses
-- EXECUTE ACLs) by accept_invitation / claim_my_invitations. Returns artist_linked
-- (false only when an artist_id-stamped claim is skipped by the owner guard, preserving
-- accept_invitation's contract).
create or replace function public.ensure_invitation_membership(p_invitation uuid, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv    public.org_invitations;
  v_linked boolean := true;
  v_cnt    int;
begin
  select * into v_inv from public.org_invitations where id = p_invitation;
  if v_inv.id is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  insert into public.org_memberships (org_id, user_id, role)
  values (v_inv.org_id, p_user, v_inv.role)
  on conflict (org_id, user_id, role) do nothing;

  if v_inv.role = 'artist' then
    if v_inv.artist_id is not null then
      -- Deterministic link by id; guard against the artists(org_id,user_id) partial-unique
      -- index (no-op when the caller already owns an artist in this org).
      update public.artists a
         set user_id = p_user
       where a.id = v_inv.artist_id
         and a.org_id = v_inv.org_id
         and a.user_id is null
         and not exists (
           select 1 from public.artists o
           where o.org_id = v_inv.org_id and o.user_id = p_user
         );
      get diagnostics v_cnt = row_count;
      v_linked := v_cnt > 0;
    else
      -- Plain email invite: claim an unclaimed row by lowercased email.
      update public.artists a
         set user_id = p_user
       where a.org_id = v_inv.org_id
         and a.user_id is null
         and lower(a.email) = lower(v_inv.email);
      get diagnostics v_cnt = row_count;
      if v_cnt = 0
         and not exists (
           select 1 from public.artists o
           where o.org_id = v_inv.org_id and o.user_id = p_user
         ) then
        -- No claimable row and the user owns none → auto-create a minimal profile.
        insert into public.artists (org_id, user_id, email, name)
        values (v_inv.org_id, p_user, lower(v_inv.email), split_part(v_inv.email, '@', 1));
      end if;
    end if;
  end if;

  return v_linked;
end;
$$;
revoke all on function public.ensure_invitation_membership(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_invitation_membership(uuid, uuid) to service_role;
```
- [ ] Run-to-pass: `supabase test db` (or MCP `execute_sql` on the test file). Expected: `ok 1..9`, all passing.
- [ ] Commit: `feat(db): add ensure_invitation_membership helper for invite-time provisioning`

---

### Task 2: Reimplement `accept_invitation` + add `claim_my_invitations` + `revoke_invitation` (+ pgTAP)

**Files**
- Modify: `supabase/migrations/20260809170000_invite_membership_and_self_heal.sql` (append three functions)
- Modify: `supabase/tests/rpc/accept_invitation.sql` (add an artist-auto-create regression with a real count assertion; existing 12 stay green)
- Create: `supabase/tests/rpc/claim_my_invitations.sql`
- Create: `supabase/tests/rpc/revoke_invitation.sql`

**Interfaces**
- Produces SQL: `accept_invitation(p_token text) returns jsonb` — unchanged contract `{org_id, artist_linked}`, unchanged guards, now delegating membership+artist to `ensure_invitation_membership`.
- Produces SQL: `claim_my_invitations() returns integer` — SECURITY DEFINER, grant `authenticated`; for `auth.uid()`'s email loops pending non-expired invitations, calls `ensure_invitation_membership`, marks each accepted, returns the count.
- Produces SQL: `revoke_invitation(p_id uuid) returns void` — SECURITY DEFINER, grant `authenticated`; admin (`has_org_role(v_caller, org, 'admin')`) OR super-admin (`is_super_admin(v_caller)`) gate on the invitation's org, guards that the invitation is still `pending`, marks it revoked, and deletes the `(org_id, user_id, role)` membership the invite created (last-admin guard), resolving the user by `lower(email)`.

**Steps**
- [ ] Write the failing pgTAP test `supabase/tests/rpc/claim_my_invitations.sql`:
```sql
-- Tests for public.claim_my_invitations(): self-heal for any auth path.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('cccccccc-cccc-c101-0000-000000000000','authenticated','authenticated','claim-a@test.com', now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-0000000c1001','Claim Org','claim-org');
INSERT INTO public.org_invitations (id, org_id, email, role, token, status, expires_at)
VALUES ('00000000-0000-0000-0000-00000000c111','00000000-0000-0000-0000-0000000c1001','claim-a@test.com','artist','tok-claim-a','pending', now() + interval '7 days');
SET session_replication_role = DEFAULT;

-- 1. Claiming returns the count of pending invitations reconciled.
SELECT set_config('request.jwt.claims','{"sub":"cccccccc-cccc-c101-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.claim_my_invitations(), 1, 'claims the one pending invitation');
RESET ROLE;
-- 2. Membership was created.
SELECT is(
  (SELECT count(*)::int FROM public.org_memberships
   WHERE org_id='00000000-0000-0000-0000-0000000c1001' AND user_id='cccccccc-cccc-c101-0000-000000000000' AND role='artist'),
  1, 'membership created by claim');
-- 3. Artist profile auto-created.
SELECT is(
  (SELECT count(*)::int FROM public.artists
   WHERE org_id='00000000-0000-0000-0000-0000000c1001' AND user_id='cccccccc-cccc-c101-0000-000000000000'),
  1, 'artist profile auto-created by claim');
-- 4. Invitation is now accepted.
SELECT is(
  (SELECT status FROM public.org_invitations WHERE id='00000000-0000-0000-0000-00000000c111'),
  'accepted', 'invitation marked accepted');

SELECT * FROM finish();
ROLLBACK;
```
- [ ] Write the failing pgTAP test `supabase/tests/rpc/revoke_invitation.sql`:
```sql
-- Tests for public.revoke_invitation(p_id): status flip + membership removal + gates.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('dddddddd-dddd-d101-0000-000000000000','authenticated','authenticated','rev-admin@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('dddddddd-dddd-d102-0000-000000000000','authenticated','authenticated','rev-invitee@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('dddddddd-dddd-d103-0000-000000000000','authenticated','authenticated','rev-outsider@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('dddddddd-dddd-d104-0000-000000000000','authenticated','authenticated','rev-super@test.com', now(),'{"provider":"email"}','{}',now(),now()),
  ('dddddddd-dddd-d105-0000-000000000000','authenticated','authenticated','rev-invitee2@test.com', now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-0000000d1001','Revoke Org','revoke-org');
-- A super-admin who is NOT a member of the org (the platform OrgInvitePopover path).
INSERT INTO public.platform_admins (user_id) VALUES ('dddddddd-dddd-d104-0000-000000000000');
INSERT INTO public.org_memberships (org_id, user_id, role)
VALUES ('00000000-0000-0000-0000-0000000d1001','dddddddd-dddd-d101-0000-000000000000','admin');
-- Invite-time memberships already exist for the two invitees.
INSERT INTO public.org_memberships (org_id, user_id, role)
VALUES
  ('00000000-0000-0000-0000-0000000d1001','dddddddd-dddd-d102-0000-000000000000','producer'),
  ('00000000-0000-0000-0000-0000000d1001','dddddddd-dddd-d105-0000-000000000000','artist');
INSERT INTO public.org_invitations (id, org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-00000000d111','00000000-0000-0000-0000-0000000d1001','rev-invitee@test.com','producer','tok-rev','pending');
-- A second pending invite the non-member super-admin will revoke.
INSERT INTO public.org_invitations (id, org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-00000000d113','00000000-0000-0000-0000-0000000d1001','rev-invitee2@test.com','artist','tok-rev2','pending');
-- An already-accepted invitation must be un-revokable (would otherwise strip membership).
INSERT INTO public.org_invitations (id, org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-00000000d112','00000000-0000-0000-0000-0000000d1001','rev-invitee@test.com','artist','tok-rev-acc','accepted');
SET session_replication_role = DEFAULT;

-- 1. A non-admin outsider cannot revoke (gate fires before the status guard).
SELECT set_config('request.jwt.claims','{"sub":"dddddddd-dddd-d103-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.revoke_invitation('00000000-0000-0000-0000-00000000d111') $$,'42501', NULL, 'outsider cannot revoke');
RESET ROLE;
-- 2. The org admin revokes successfully.
SELECT set_config('request.jwt.claims','{"sub":"dddddddd-dddd-d101-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.revoke_invitation('00000000-0000-0000-0000-00000000d111') $$,'admin revokes');
RESET ROLE;
-- 3. Invitation is revoked.
SELECT is((SELECT status FROM public.org_invitations WHERE id='00000000-0000-0000-0000-00000000d111'),'revoked','invitation marked revoked');
-- 4. The invite-created membership was removed.
SELECT is(
  (SELECT count(*)::int FROM public.org_memberships
   WHERE org_id='00000000-0000-0000-0000-0000000d1001' AND user_id='dddddddd-dddd-d102-0000-000000000000' AND role='producer'),
  0, 'invite-created membership removed on revoke');
-- 5. The admin's own membership is untouched.
SELECT is(
  (SELECT count(*)::int FROM public.org_memberships
   WHERE org_id='00000000-0000-0000-0000-0000000d1001' AND user_id='dddddddd-dddd-d101-0000-000000000000' AND role='admin'),
  1, 'admin membership untouched');
-- 6. An already-accepted invitation cannot be revoked (no membership stripping).
SELECT set_config('request.jwt.claims','{"sub":"dddddddd-dddd-d101-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.revoke_invitation('00000000-0000-0000-0000-00000000d112') $$,'P0001', NULL,'cannot revoke an accepted invitation');
RESET ROLE;
-- 7. A non-member super-admin can revoke (the platform OrgInvitePopover path).
SELECT set_config('request.jwt.claims','{"sub":"dddddddd-dddd-d104-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.revoke_invitation('00000000-0000-0000-0000-00000000d113') $$,'non-member super-admin revokes');
RESET ROLE;
-- 8. The second invitee's invite-created membership was removed by the super-admin revoke.
SELECT is(
  (SELECT count(*)::int FROM public.org_memberships
   WHERE org_id='00000000-0000-0000-0000-0000000d1001' AND user_id='dddddddd-dddd-d105-0000-000000000000' AND role='artist'),
  0, 'super-admin revoke removed the invite-created membership');

SELECT * FROM finish();
ROLLBACK;
```
- [ ] Add the accept-auto-create regression to `supabase/tests/rpc/accept_invitation.sql`: bump `SELECT plan(12)` to `SELECT plan(14)` and append before `SELECT * FROM finish();` a self-contained block that asserts the artists row is actually created (a `lives_ok` alone would pass on the OLD function, so a real count assertion is required to go red at run-to-fail):
```sql
-- 13-14. Accept routes through ensure_invitation_membership: a plain-email artist invite
--        with NO matching artists row must auto-create the artist profile. The count
--        assertion goes red on the OLD accept (which never auto-created), green after wiring.
SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-0000000ac0f1','Accept AutoCreate Org','accept-autocreate-org');
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('aaaaaaaa-aaaa-ac06-0000-000000000000','authenticated','authenticated','accept-f@test.com', now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.org_invitations (org_id, email, role, token, status)
VALUES ('00000000-0000-0000-0000-0000000ac0f1','accept-f@test.com','artist','tok-accept-fff','pending');
SET session_replication_role = DEFAULT;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-ac06-0000-000000000000","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.accept_invitation('tok-accept-fff') $$,'plain artist invite accepts');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.artists
   WHERE org_id='00000000-0000-0000-0000-0000000ac0f1' AND user_id='aaaaaaaa-aaaa-ac06-0000-000000000000'),
  1, 'accept auto-creates the artist profile for a plain-email artist invite');
```
- [ ] Run-to-fail: `supabase test db`. Expected failures: `function public.claim_my_invitations() does not exist`; `function public.revoke_invitation(uuid) does not exist`; and in `accept_invitation.sql` the new count assertion FAILS (OLD accept never auto-created, so the artists count is 0). The `lives_ok` on the same block passes on the OLD function — the count assertion is the one that must go red.
- [ ] Write the minimal implementation — append to `supabase/migrations/20260809170000_invite_membership_and_self_heal.sql`:
```sql
-- accept_invitation, reimplemented to route membership + artist provisioning through
-- ensure_invitation_membership. Contract preserved: returns jsonb {org_id, artist_linked},
-- same not-authenticated / expired-or-invalid / email-mismatch guards.
create or replace function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv    public.org_invitations;
  v_uid    uuid := auth.uid();
  v_email  text;
  v_linked boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = v_uid;

  select * into v_inv
  from public.org_invitations
  where token = p_token and status = 'pending' and expires_at > now()
  for update;

  if v_inv.id is null then
    raise exception 'Invalid or expired invitation' using errcode = 'P0002';
  end if;

  if lower(v_inv.email) <> lower(coalesce(v_email, '')) then
    raise exception 'Invitation was issued to a different email' using errcode = '42501';
  end if;

  v_linked := public.ensure_invitation_membership(v_inv.id, v_uid);

  update public.org_invitations
  set status = 'accepted', accepted_at = now()
  where id = v_inv.id;

  return jsonb_build_object('org_id', v_inv.org_id, 'artist_linked', v_linked);
end;
$$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.accept_invitation(text) to service_role;

-- claim_my_invitations: reconcile every pending, non-expired invitation for the caller's
-- email on ANY authenticated load (invite link, recovery, plain login). This is what makes
-- membership + artist profile + invite status self-heal without SQL backfill. Rows already
-- past their ~14-day expires_at are NOT reconciled here (a fresh invite must be resent).
-- Matches on lower(email) EXACTLY: gracicalma's googlemail invite reconciles only against a
-- googlemail login (correct per the auth logs); do NOT normalize googlemail<->gmail.
create or replace function public.claim_my_invitations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_count int := 0;
  r       record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    return 0;
  end if;

  for r in
    select id from public.org_invitations
    where lower(email) = lower(v_email)
      and status = 'pending'
      and expires_at > now()
    for update
  loop
    perform public.ensure_invitation_membership(r.id, v_uid);
    update public.org_invitations set status = 'accepted', accepted_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.claim_my_invitations() from public, anon;
grant execute on function public.claim_my_invitations() to authenticated;

-- revoke_invitation: mark a PENDING invitation revoked AND remove the membership row the
-- invite created at invite time (else revoke would strand an orphaned member). Admin OR
-- super-admin (platform OrgInvitePopover runs as a super-admin who isn't an org member).
-- The status guard prevents revoking an already-accepted invite (which would strip a
-- member's genuinely-earned membership). Last-admin guard mirrors remove_org_member.
create or replace function public.revoke_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_inv    public.org_invitations;
  v_user   uuid;
begin
  select * into v_inv from public.org_invitations where id = p_id;
  if v_inv.id is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  if not (public.has_org_role(v_caller, v_inv.org_id, 'admin') or public.is_super_admin(v_caller)) then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;

  if v_inv.status <> 'pending' then
    raise exception 'Only pending invitations can be revoked';
  end if;

  update public.org_invitations set status = 'revoked' where id = p_id;

  -- Resolve the invitee's auth user and drop the (org, user, invited-role) membership the
  -- invite created. Only that exact role row — an independently-earned role is untouched.
  select id into v_user from auth.users where lower(email) = lower(v_inv.email);
  if v_user is not null then
    lock table public.org_memberships in share row exclusive mode;
    if v_inv.role = 'admin'
       and exists (
         select 1 from public.org_memberships
         where org_id = v_inv.org_id and user_id = v_user and role = 'admin'
       )
       and (
         select count(distinct user_id) from public.org_memberships
         where org_id = v_inv.org_id and role = 'admin' and user_id <> v_user
       ) < 1 then
      raise exception 'Cannot remove the last admin of the organization' using errcode = '42501';
    end if;
    delete from public.org_memberships
    where org_id = v_inv.org_id and user_id = v_user and role = v_inv.role;
  end if;
end;
$$;
revoke all on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;
```
- [ ] Run-to-pass: `supabase test db`. Expected: `accept_invitation.sql` (14), `claim_my_invitations.sql` (4), `revoke_invitation.sql` (8), and `ensure_invitation_membership.sql` (9) all pass.
- [ ] Commit: `feat(db): route accept through ensure helper; add claim + revoke RPCs`

---

### Task 3: Split `deliverOrgInvitation` into `ensureInvitedUser` + `sendOrgInvitationEmail` (+ Deno)

**Files**
- Modify: `supabase/functions/_shared/invitations.ts`
- Modify: `supabase/functions/_shared/invitations.test.ts`

**Interfaces**
- Produces: `ensureInvitedUser(deps: Deps, args: { email: string; appOrigin: string; token: string }): Promise<{ userId: string | null; actionLink?: string }>` — for an existing user resolves the id via `get_user_id_by_email` (no email/link minted); for a net-new user mints the invite action link (creating the account) and returns its id + `action_link`.
- Produces: `sendOrgInvitationEmail(deps: Deps, args: DeliverInviteArgs & { actionLink?: string }): Promise<void>` — sends the `org-invitation` email.
- Consumes: `deps.admin.rpc("get_user_id_by_email", { p_email })`, `deps.admin.auth.admin.generateLink`, `deps.sendEmail`.

**Steps**
- [ ] Verify no other importer depends on the removed exports (they will be deleted): `grep -rn "userExistsByEmail\|deliverOrgInvitation" supabase/functions --include=*.ts | grep -v ".test.ts"`. Expected only the three edge index.ts callers migrated in Tasks 4/5/6; if any other appears, migrate it in the same task it belongs to.
- [ ] Rewrite `supabase/functions/_shared/invitations.test.ts` as the failing test:
```ts
import { assertEquals } from "./test-asserts.ts";
import { ensureInvitedUser, sendOrgInvitationEmail } from "./invitations.ts";
import { makeFakeDeps } from "./testing.ts";

const APP_ORIGIN = "https://app.test";

Deno.test("ensureInvitedUser: existing user → resolves id, no action link", async () => {
  const { deps } = makeFakeDeps({
    authUsersByEmail: { "old@acme.com": { id: "u9" } },
  });
  const r = await ensureInvitedUser(deps, { email: "old@acme.com", appOrigin: APP_ORIGIN, token: "tok-1" });
  assertEquals(r.userId, "u9");
  assertEquals(r.actionLink, undefined);
});

Deno.test("ensureInvitedUser: net-new user → generateLink returns id + action link", async () => {
  const { deps } = makeFakeDeps({
    generateLinkResult: {
      data: { properties: { action_link: "https://app.test/reset-password?redirect=x" }, user: { id: "new-1" } },
      error: null,
    },
  });
  const r = await ensureInvitedUser(deps, { email: "new@acme.com", appOrigin: APP_ORIGIN, token: "tok-1" });
  assertEquals(r.userId, "new-1");
  assertEquals(r.actionLink, "https://app.test/reset-password?redirect=x");
});

Deno.test("sendOrgInvitationEmail: sends org-invitation with the action link", async () => {
  const { deps, invokeCalls } = makeFakeDeps();
  await sendOrgInvitationEmail(deps, {
    email: "new@acme.com", orgName: "Acme", role: "artist", token: "tok-1",
    inviterEmail: "boss@acme.com", appOrigin: APP_ORIGIN, idempotencyKey: "org-invitation-1",
    orgId: "org-1", actionLink: "https://app.test/reset-password?redirect=x",
  });
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const body = sent[0].body as { template_name: string; templateData: { actionLink?: string } };
  assertEquals(body.template_name, "org-invitation");
  assertEquals(body.templateData.actionLink, "https://app.test/reset-password?redirect=x");
});
```
- [ ] Run-to-fail: `deno test --allow-all supabase/functions/_shared/invitations.test.ts`. Expected: `ensureInvitedUser`/`sendOrgInvitationEmail` are not exported (module error).
- [ ] Write the minimal implementation — replace the whole body of `supabase/functions/_shared/invitations.ts` (keep `DeliverInviteArgs`; drop `userExistsByEmail` and `deliverOrgInvitation`):
```ts
import type { Deps } from "./deps.ts";

export interface DeliverInviteArgs {
  email: string;
  orgName?: string;
  role?: string;
  token: string;
  inviterEmail?: string;
  appOrigin: string;
  idempotencyKey: string;
  orgId?: string;
}

/**
 * Resolve the auth user for an invite, creating a net-new account when needed.
 * Existing users: id via get_user_id_by_email (no email sent here, no link minted).
 * Net-new users: mint a Supabase invite action link (this also creates the account;
 * Supabase sends no email of its own) that lands on
 * /reset-password?redirect=/accept-invite?token=… and return both the new id and the
 * action_link.
 */
export async function ensureInvitedUser(
  deps: Deps,
  args: { email: string; appOrigin: string; token: string },
): Promise<{ userId: string | null; actionLink?: string }> {
  const email = args.email.toLowerCase();
  const { data: existingId } = await deps.admin.rpc("get_user_id_by_email", { p_email: email });
  if (existingId) return { userId: existingId as string };

  const acceptPath = `/accept-invite?token=${args.token}`;
  const redirectTo = `${args.appOrigin}/reset-password?redirect=${encodeURIComponent(acceptPath)}`;
  const { data, error } = await deps.admin.auth.admin.generateLink({
    type: "invite",
    email: args.email,
    options: { redirectTo },
  });
  if (error) throw error;
  const d = data as { properties?: { action_link?: string }; user?: { id?: string } } | null;
  return { userId: d?.user?.id ?? null, actionLink: d?.properties?.action_link };
}

/** Deliver ONE branded org-invitation email (best-effort at the call site). */
export async function sendOrgInvitationEmail(
  deps: Deps,
  args: DeliverInviteArgs & { actionLink?: string },
): Promise<void> {
  await deps.sendEmail({
    template_name: "org-invitation",
    recipient_email: args.email,
    org_id: args.orgId,
    templateData: {
      orgName: args.orgName,
      role: args.role,
      token: args.token,
      inviterEmail: args.inviterEmail,
      actionLink: args.actionLink,
    },
    idempotency_key: args.idempotencyKey,
  });
}
```
- [ ] Run-to-pass: `deno test --allow-all supabase/functions/_shared/invitations.test.ts`. Expected: 3 passing.
- [ ] Commit: `refactor(edge): split invite delivery into ensureInvitedUser + sendOrgInvitationEmail`

---

### Task 4: Wire `create-invitation` to create membership at invite time (+ Deno)

**Files**
- Modify: `supabase/functions/create-invitation/index.ts` (import line 6; replace the delivery block, lines ~113-133)
- Modify: `supabase/functions/create-invitation/index.di.test.ts` (add one membership-RPC assertion; `adminDeps()` at lines 24-38 is left UNCHANGED)

**Interfaces**
- Consumes: `ensureInvitedUser`, `sendOrgInvitationEmail` (Task 3); `deps.admin.rpc("ensure_invitation_membership", { p_invitation, p_user })` (Task 1).
- Produces: on success, membership is provisioned best-effort at invite time; response unchanged `{ ok: true, invitation }`.

**Design notes (resolving the critic's blockers/improvements):**
- **Membership is BEST-EFFORT/logged, not fatal** (mirrors `provision-org` and matches this handler's existing "delivery failure does not fail the request" posture). Rationale: the invitation row already exists above; a fatal 500 here would leave a pending invite plus a 500, and a client retry would then hit the pending-invite unique index (23505 → 409). `claim_my_invitations` reconciles membership on the invitee's first sign-in regardless, so decision A ("membership at invite time so the not-a-member gap can't occur") is still satisfied: the invitee is never in a signed-in-but-not-a-member state.
- **No double `get_user_id_by_email`:** the duplicate guard already resolved `existingUserId` (line 79, unconditional). Reuse it for the existing-user case; only call `ensureInvitedUser` for the net-new branch (which mints the account + action link). The net-new branch re-runs `get_user_id_by_email` once inside `ensureInvitedUser` (returns null again) before `generateLink`; that single cheap RPC keeps the helper self-contained for its other callers (provision-org/resend) and is accepted.
- **`adminDeps()` stays as-is.** Because membership is best-effort and skipped when `userId` is null, every existing 200-path test (which uses the default `generateLink` fake that returns no `user.id` → `userId` null → membership skipped) keeps returning 200 with no change. The new test supplies its own `generateLinkResult` with a `user.id` to exercise and assert the RPC.

**Steps**
- [ ] Add the failing membership assertion — append after the existing "admin → 200" test in `supabase/functions/create-invitation/index.di.test.ts` (uses the file's `adminDeps`/`inviteReq` helpers and its `assertEquals`/`assertExists` imports). It drives the NET-NEW path (no `authUsersByEmail`, so `get_user_id_by_email` returns null and the duplicate-member 409 guard is skipped), and seeds a `user.id` so `ensureInvitedUser` yields a non-null `userId`:
```ts
Deno.test("create-invitation DI: admin → creates membership at invite time via RPC (net-new invitee)", async () => {
  const { deps, calls } = adminDeps({
    // Net-new invitee → resolved through generateLink (which returns the new user id).
    // No authUsersByEmail, so the duplicate-member 409 guard is skipped.
    generateLinkResult: {
      data: { properties: { action_link: "https://app.test/reset-password?redirect=x" }, user: { id: "new-invitee" } },
      error: null,
    },
    rpcs: { ensure_invitation_membership: { data: true, error: null } },
  });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 200);
  const rpcCall = calls.find((c) => c.table === "rpc:ensure_invitation_membership");
  assertExists(rpcCall);
  assertEquals(rpcCall!.args, [{ p_invitation: "inv1", p_user: "new-invitee" }]);
});
```
- [ ] Run-to-fail: `deno test --allow-all supabase/functions/create-invitation/`. Expected: all existing tests pass (adminDeps unchanged; best-effort membership doesn't disturb them), and the new test fails because OLD `index.ts` never calls `rpc:ensure_invitation_membership` → `assertExists(rpcCall)` fails.
- [ ] Write the minimal implementation — in `supabase/functions/create-invitation/index.ts` change the import on line 6 and replace the delivery block (lines ~113-133, the `try { … deliverOrgInvitation … } … return json({ ok: true, invitation: invite });`):
```ts
// line 6:
import { ensureInvitedUser, sendOrgInvitationEmail } from "../_shared/invitations.ts";
```
```ts
    // Membership at invite time (best-effort, mirroring provision-org). Reuse the
    // existingUserId already resolved for the duplicate guard above; only mint a net-new
    // account (which also creates the auth user + action link) when the invitee is new.
    // A failure here does NOT fail the request: the invitation row exists and
    // claim_my_invitations reconciles membership on the invitee's first sign-in.
    let userId: string | null = (existingUserId as string | null) ?? null;
    let actionLink: string | undefined;
    try {
      if (!userId) {
        const ensured = await ensureInvitedUser(deps, { email: invite.email, appOrigin, token: invite.token });
        userId = ensured.userId;
        actionLink = ensured.actionLink;
      }
      if (userId) {
        const { error: memErr } = await admin.rpc("ensure_invitation_membership", {
          p_invitation: invite.id, p_user: userId,
        });
        if (memErr) console.error("create-invitation: membership link failed", (memErr as { message?: string }).message);
      }
    } catch (e) {
      console.error("create-invitation: membership provisioning failed", (e as Error).message);
    }

    // Best-effort delivery. The invitation + membership already exist, so a send failure
    // does not fail the request — the admin can copy the accept link instead.
    try {
      const { data: org } = await admin
        .from('organizations').select('name').eq('id', body.org_id).maybeSingle();
      const inviter = inviterId ? await admin.auth.admin.getUserById(inviterId) : null;
      await sendOrgInvitationEmail(deps, {
        email: invite.email,
        orgName: (org as { name?: string } | null)?.name ?? undefined,
        role: roleLabel(invite.role),
        token: invite.token,
        inviterEmail: inviter?.data?.user?.email ?? undefined,
        appOrigin,
        idempotencyKey: `org-invitation-${invite.id}`,
        orgId: body.org_id,
        actionLink,
      });
    } catch (e) {
      console.error('create-invitation: delivery failed', (e as Error).message);
    }

    return json({ ok: true, invitation: invite });
```
- [ ] Run-to-pass: `deno test --allow-all supabase/functions/create-invitation/`. Expected: all passing including the new membership assertion, with the existing 200/409 tests unchanged.
- [ ] Commit: `feat(edge): create-invitation provisions membership at invite time`

---

### Task 5: Wire `provision-org` to create the first-admin membership at invite time (+ Deno)

**Files**
- Modify: `supabase/functions/provision-org/index.ts` (import line 4; replace the delivery block, lines ~90-107)
- Modify: `supabase/functions/provision-org/index.di.test.ts`

**Interfaces**
- Consumes: `provision_org` RPC returns `{ org_id, token }` (no invitation id) → look up the invitation id by token; `ensureInvitedUser`; `ensure_invitation_membership`.
- Produces: first-admin membership provisioned best-effort before email; response unchanged `{ org_id }`.

**Steps**
- [ ] Add the failing assertion to `supabase/functions/provision-org/index.di.test.ts` (append; uses the file's existing `makeFakeDeps`/`makeRequest`/`body`/asserts):
```ts
Deno.test("provision-org: creates first-admin membership at invite time via RPC", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      org_invitations: { data: { id: "inv-9" }, error: null }, // token lookup returns the invitation id
    },
    rpcs: {
      provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null },
      ensure_invitation_membership: { data: true, error: null },
    },
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" }, user: { id: "new-admin" } }, error: null },
  });
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  const rpcCall = calls.find((c) => c.table === "rpc:ensure_invitation_membership");
  assertEquals(rpcCall?.args, [{ p_invitation: "inv-9", p_user: "new-admin" }]);
});
```
- [ ] Run-to-fail: `deno test --allow-all supabase/functions/provision-org/`. Expected: no `rpc:ensure_invitation_membership` call → assertion fails. (Existing delivery tests, which use the default `generateLink` fake with no `user.id` → `userId` null → membership skipped, stay green.)
- [ ] Write the minimal implementation — in `supabase/functions/provision-org/index.ts` change import line 4 and replace the delivery `try { … deliverOrgInvitation … } … return json({ org_id });` block (lines ~90-107):
```ts
// line 4:
import { ensureInvitedUser, sendOrgInvitationEmail } from "../_shared/invitations.ts";
```
```ts
    // Resolve the invitation id created inside provision_org (it returns only {org_id, token}),
    // then create the first-admin's account + membership NOW, before the branded email.
    // Best-effort/logged: the org + invitation already exist and claim_my_invitations
    // self-heals on the admin's first sign-in, so a link failure must not undo the org.
    try {
      const { data: invRow } = await deps.admin
        .from("org_invitations").select("id").eq("token", token).maybeSingle();
      const invitationId = (invRow as { id?: string } | null)?.id;
      const { userId, actionLink } = await ensureInvitedUser(deps, { email, appOrigin, token });
      if (invitationId && userId) {
        const { error: memErr } = await deps.admin.rpc("ensure_invitation_membership", {
          p_invitation: invitationId, p_user: userId,
        });
        if (memErr) console.error("provision-org: membership link failed", (memErr as { message?: string }).message);
      }
      const inviter = auth.userId ? await deps.admin.auth.admin.getUserById(auth.userId) : null;
      await sendOrgInvitationEmail(deps, {
        email, orgName: name, role, token,
        inviterEmail: inviter?.data?.user?.email ?? undefined,
        appOrigin, idempotencyKey: `org-invitation-${org_id}`, orgId: org_id, actionLink,
      });
    } catch (e) {
      console.error("provision-org: invite delivery failed", (e as Error).message);
    }

    return json({ org_id });
```
  (Confirm the local variable names `name`, `role`, `email`, `token`, `org_id`, `appOrigin`, and `auth.userId` against the surrounding code before editing; `const { org_id, token } = data` is destructured at line ~45.)
- [ ] Run-to-pass: `deno test --allow-all supabase/functions/provision-org/`. Expected: all passing (the net-new admin membership test plus the two original delivery tests, which only assert the email, stay green).
- [ ] Commit: `feat(edge): provision-org links first-admin membership at invite time`

---

### Task 6: Migrate `resend-invitation` off `deliverOrgInvitation` (+ Deno)

**Files**
- Modify: `supabase/functions/resend-invitation/index.ts` (import line 5; replace the delivery block, lines ~35-46)
- Modify: `supabase/functions/resend-invitation/index.di.test.ts`

**Interfaces**
- Consumes: `ensureInvitedUser`, `sendOrgInvitationEmail` (Task 3); `deps.admin.rpc("ensure_invitation_membership", { p_invitation, p_user })` (Task 1).
- Produces: resends the branded `org-invitation` email and idempotently re-asserts the invitee's membership; response unchanged `{ ok: true }`.

**Rationale:** Task 3 deletes `deliverOrgInvitation`, which `resend-invitation` imports (line 5) and calls (line 39). Without this task, `deno check --node-modules-dir=none supabase/functions/*/index.ts` and the resend Deno suite break. Resend is also the exact mechanism Task 11's runbook uses to re-invite the stranded four, so it must produce a fresh action link and (idempotently) reconcile membership.

**Steps**
- [ ] Update the delivery assertion in `supabase/functions/resend-invitation/index.di.test.ts` — replace the assertion that a `deliverOrgInvitation`/email send happened with one that asserts the membership RPC and the resend email fire (adapt the existing admin-success test; uses `makeFakeDeps`/`makeRequest` and the file's asserts). Note the handler authorizes via `org_memberships` (admin) BEFORE delivery, so seed that row:
```ts
Deno.test("resend-invitation DI: resends email + reasserts membership via RPC", async () => {
  const { deps, calls, invokeCalls } = makeFakeDeps({
    authUser: { id: "u1" },
    usersById: { u1: { email: "admin@acme.test" } },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      org_invitations: { data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "producer", status: "pending", token: "tok123" }, error: null },
      organizations: { data: { name: "Acme" }, error: null },
    },
    authUsersByEmail: { "invitee@x.com": { id: "existing-invitee" } },
    rpcs: { ensure_invitation_membership: { data: true, error: null } },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer jwt" }, body: { invitation_id: "inv1", app_origin: "https://app.test" } }),
    deps,
  );
  assertEquals(res.status, 200);
  const rpcCall = calls.find((c) => c.table === "rpc:ensure_invitation_membership");
  assertEquals(rpcCall?.args, [{ p_invitation: "inv1", p_user: "existing-invitee" }]);
  assertEquals(invokeCalls.filter((c) => c.name === "send-transactional-email").length, 1);
});
```
- [ ] Run-to-fail: `deno test --allow-all supabase/functions/resend-invitation/`. Expected: the old code never calls `rpc:ensure_invitation_membership` → assertion fails.
- [ ] Write the minimal implementation — in `supabase/functions/resend-invitation/index.ts` change import line 5 and replace the delivery block (lines ~35-46, the `const { data: org } … await deliverOrgInvitation(...) … return json({ ok: true });`):
```ts
// line 5:
import { ensureInvitedUser, sendOrgInvitationEmail } from "../_shared/invitations.ts";
```
```ts
    const { data: org } = await deps.admin
      .from("organizations").select("name").eq("id", invite.org_id).maybeSingle();

    // Resolve the invitee account, idempotently re-assert their membership (covers the
    // stranded/hand-created cases from the runbook), then resend a fresh action link.
    const { userId, actionLink } = await ensureInvitedUser(deps, {
      email: invite.email, appOrigin, token: invite.token,
    });
    if (userId) {
      await deps.admin.rpc("ensure_invitation_membership", {
        p_invitation: invite.id, p_user: userId,
      });
    }
    await sendOrgInvitationEmail(deps, {
      email: invite.email,
      orgName: (org as { name?: string } | null)?.name ?? undefined,
      role: invite.role,
      token: invite.token,
      appOrigin,
      idempotencyKey: `org-invitation-resend-${invite.id}`,
      orgId: invite.org_id,
      actionLink,
    });

    return json({ ok: true });
```
- [ ] Run-to-pass: `deno test --allow-all supabase/functions/resend-invitation/` and `deno check --node-modules-dir=none supabase/functions/resend-invitation/index.ts`. Expected: green (no dangling `deliverOrgInvitation` import anywhere).
- [ ] Commit: `feat(edge): resend-invitation reasserts membership via ensure helper`

---

### Task 7: Frontend data + AuthContext self-heal + ResetPassword redirect (+ Vitest)

**Files**
- Modify: `src/data/invitations.ts` (add `claimMyInvitations`; change `revokeInvitation`)
- Modify: `src/data/invitations.test.ts`
- Modify: `src/features/auth/AuthContext.tsx` (`loadIdentity`, lines ~120-136)
- Modify: `src/pages/ResetPasswordPage.tsx` (`onRequest`, lines ~47-58)

**Interfaces**
- Produces: `claimMyInvitations(client: SupabaseClient<Database>): Promise<number>` — calls `client.rpc("claim_my_invitations")`.
- Produces: `revokeInvitation(client, id): Promise<void>` — now `client.rpc("revoke_invitation", { p_id: id })`.
- Consumes: `AuthContext.loadIdentity` calls `claimMyInvitations(supabase)` best-effort before `fetchMyMemberships`.

**Steps**
- [ ] Update `src/data/invitations.test.ts` — replace the `revokeInvitation` describe block and add a `claimMyInvitations` block (failing). Add `claimMyInvitations` to the import from `./invitations`:
```ts
describe("revokeInvitation", () => {
  it("calls the revoke_invitation RPC with the id", async () => {
    const fake = createFakeSupabase({ "rpc:revoke_invitation": { data: null, error: null } });
    await revokeInvitation(fake as never, "inv1");
    expect(fake.calls).toContainEqual({ table: "rpc:revoke_invitation", method: "rpc", args: [{ p_id: "inv1" }] });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:revoke_invitation": { data: null, error: { message: "boom" } } });
    await expect(revokeInvitation(fake as never, "inv1")).rejects.toBeTruthy();
  });
});

describe("claimMyInvitations", () => {
  it("calls claim_my_invitations and returns the count", async () => {
    const fake = createFakeSupabase({ "rpc:claim_my_invitations": { data: 2, error: null } });
    const n = await claimMyInvitations(fake as never);
    expect(n).toBe(2);
    expect(fake.calls).toContainEqual({ table: "rpc:claim_my_invitations", method: "rpc", args: [undefined] });
  });
  it("returns 0 when data is null", async () => {
    const fake = createFakeSupabase({ "rpc:claim_my_invitations": { data: null, error: null } });
    expect(await claimMyInvitations(fake as never)).toBe(0);
  });
});
```
  (Confirm the fake's recorded-call shape for `rpc` matches `src/test/supabaseFake.ts` — mirror whatever the existing `acceptInvitation`/RPC tests in this file assert; adjust the `args` shape if the fake records `[params]` differently.)
- [ ] Run-to-fail: `npx vitest run src/data/invitations.test.ts`. Expected: `claimMyInvitations` is not exported; `revokeInvitation` still hits the `org_invitations` table not the RPC.
- [ ] Write the minimal implementation — in `src/data/invitations.ts` replace `revokeInvitation` (currently ~lines 102-112) and add `claimMyInvitations`:
```ts
/** Revoke a pending invitation and remove the membership it created (admin/super-admin RPC). */
export async function revokeInvitation(
  client: SupabaseClient<Database>,
  id: string,
): Promise<void> {
  const { error } = await client.rpc("revoke_invitation", { p_id: id });
  if (error) throw error;
}

/**
 * Reconcile any pending invitations for the signed-in user's email (membership + artist
 * profile + status), for any auth path. Best-effort: callers ignore the count. Returns the
 * number of invitations claimed.
 */
export async function claimMyInvitations(client: SupabaseClient<Database>): Promise<number> {
  const { data, error } = await client.rpc("claim_my_invitations");
  if (error) throw error;
  return (data as number | null) ?? 0;
}
```
- [ ] Run-to-pass: `npx vitest run src/data/invitations.test.ts`. Expected: passing.
- [ ] Wire the self-heal — in `src/features/auth/AuthContext.tsx` add the import and call it at the top of `loadIdentity` (lines ~120-136). Match the surrounding function's exact structure before editing:
```ts
// with the other @/data imports near the top of the file:
import { claimMyInvitations } from '@/data/invitations';
```
```ts
  const loadIdentity = async (userId: string) => {
    // Best-effort self-heal: reconcile any pending invitations for this user's email BEFORE
    // reading memberships, so an invitee who arrived via recovery/plain-login (never hitting
    // /accept-invite) still lands with membership + artist profile. Never blocks bootstrap.
    try { await claimMyInvitations(supabase); } catch { /* non-fatal */ }
    try {
      const data = await fetchMyMemberships(supabase, userId);
      setMemberships(data);
      setCurrentOrgId((prev) => prev ?? data[0]?.org_id ?? null);
    } catch {
      setMemberships([]);
    }
    try {
      const su = await fetchIsSuperAdmin(supabase, userId);
      setIsSuperAdmin(su);
      setAllOrgs(su ? await fetchAllOrgs(supabase) : []);
    } catch {
      setIsSuperAdmin(false);
      setAllOrgs([]);
    }
  };
```
  (The `try/catch` bodies must mirror the file's actual state setters — reproduce the existing `loadIdentity` body verbatim and only prepend the `claimMyInvitations` line.)
- [ ] Preserve the redirect in `src/pages/ResetPasswordPage.tsx` `onRequest` (lines ~47-58). Confirm `searchParams`, `ROUTES`, and `requestPasswordReset` are already imported/in scope:
```ts
  const onRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      // Defense-in-depth: if the user reached this page via /reset-password?redirect=…
      // (e.g. an expired invite link), carry that redirect into the recovery link so they
      // land back on /accept-invite after setting a password.
      const redirect = searchParams.get("redirect");
      const redirectTo = `${window.location.origin}${ROUTES.RESET_PASSWORD}${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}`;
      await requestPasswordReset(supabase, email, redirectTo);
      toast.success("If that email exists, a reset link is on its way");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };
```
- [ ] Run-to-pass: `npx vitest run src/data/invitations.test.ts`. Expected: green. (Defer `npx tsc -p tsconfig.app.json --noEmit` to Task 10: `types.ts` does not yet know the two new RPC names, so `client.rpc("claim_my_invitations")` / `rpc("revoke_invitation")` will not typecheck until the regen lands.)
- [ ] Commit: `feat: self-heal invitations on auth load; revoke via RPC; preserve reset redirect`

---

### Task 8: `buildPeople` + `filterPeopleList` pure helpers (+ Vitest)

**Files**
- Modify: `src/components/admin/people/peopleMatch.ts`
- Modify: `src/components/admin/people/peopleMatch.test.ts`

**Interfaces**
- Produces: `Person` interface `{ emailKey: string; email: string; status: "active" | "invited"; userId: string | null; displayName: string | null; roles: AppRole[]; lastSignInAt: string | null; invitation: Invitation | null }`.
- Produces: `buildPeople(members: OrgMember[], pendingInvites: Invitation[]): Person[]` — one Person per lowercased email; `invited` when a pending invite exists else `active`; roles from membership else `[invite.role]`; sorted invited-first then by email.
- Produces: `filterPeopleList(query: string, people: Person[]): Person[]` — case-insensitive match on display name or email.

**Steps**
- [ ] Confirm the imported types' exact names/fields: `OrgMember` from `@/data/members` (fields `user_id`, `email`, `display_name`, `roles`, `last_sign_in_at`) and `Invitation` from `@/data/invitations` (fields `id`, `org_id`, `email`, `role`, `status`, `token`, `expires_at`). Adjust the fixtures below if the real shapes differ.
- [ ] Add the failing tests to `src/components/admin/people/peopleMatch.test.ts`:
```ts
import { buildPeople, filterPeopleList } from "./peopleMatch";
import type { OrgMember } from "@/data/members";
import type { Invitation } from "@/data/invitations";

const member = (over: Partial<OrgMember>): OrgMember => ({
  user_id: "u1", email: "a@x.com", display_name: "Ada", roles: ["producer"], last_sign_in_at: null, ...over,
});
const invite = (over: Partial<Invitation>): Invitation => ({
  id: "inv1", org_id: "o1", email: "b@x.com", role: "artist", status: "pending", token: "t", expires_at: "2099-01-01", ...over,
});

describe("buildPeople", () => {
  it("emits one active person per member with no pending invite", () => {
    const people = buildPeople([member({})], []);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ emailKey: "a@x.com", status: "active", userId: "u1", roles: ["producer"] });
  });

  it("emits an invited-only person for a pending invite with no member", () => {
    const people = buildPeople([], [invite({})]);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ emailKey: "b@x.com", status: "invited", userId: null, roles: ["artist"] });
    expect(people[0].invitation?.id).toBe("inv1");
  });

  it("merges a member and their pending invite into one invited person, keeping membership roles", () => {
    const m = member({ email: "C@x.com", user_id: "u3", roles: ["admin"] });
    const i = invite({ id: "inv3", email: "c@x.com", role: "producer" });
    const people = buildPeople([m], [i]);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ emailKey: "c@x.com", status: "invited", userId: "u3", roles: ["admin"] });
    expect(people[0].invitation?.id).toBe("inv3");
  });

  it("sorts invited people before active, then by email", () => {
    const people = buildPeople([member({ email: "z@x.com" })], [invite({ email: "b@x.com" })]);
    expect(people.map((p) => p.emailKey)).toEqual(["b@x.com", "z@x.com"]);
  });
});

describe("filterPeopleList", () => {
  const list = buildPeople([member({ email: "ada@x.com", display_name: "Ada L" })], [invite({ email: "bob@x.com" })]);
  it("passes through on empty query", () => expect(filterPeopleList("", list)).toHaveLength(2));
  it("matches on email substring", () => expect(filterPeopleList("bob", list).map((p) => p.emailKey)).toEqual(["bob@x.com"]));
  it("matches on display name", () => expect(filterPeopleList("ada l", list).map((p) => p.emailKey)).toEqual(["ada@x.com"]));
});
```
- [ ] Run-to-fail: `npx vitest run src/components/admin/people/peopleMatch.test.ts`. Expected: `buildPeople`/`filterPeopleList` not exported.
- [ ] Write the minimal implementation — append to `src/components/admin/people/peopleMatch.ts` (it already imports `OrgMember` and `Invitation`; add `AppRole` import if not present):
```ts
import type { AppRole } from "@/config/app.config";

export interface Person {
  /** Lowercased email — the identity key. */
  emailKey: string;
  /** Display-case email (from the member row if present, else the invite). */
  email: string;
  status: "active" | "invited";
  userId: string | null;
  displayName: string | null;
  roles: AppRole[];
  lastSignInAt: string | null;
  /** The pending invitation, when the person is invited. */
  invitation: Invitation | null;
}

/**
 * Merge members and pending invitations into one row-per-person directory. A person is
 * `invited` when a pending invite exists for their email (even if a membership row already
 * exists at invite time), else `active`. Roles come from the membership when present, else
 * the invite's single role. Sorted invited-first, then by email.
 */
export function buildPeople(members: OrgMember[], pendingInvites: Invitation[]): Person[] {
  const byEmail = new Map<string, Person>();

  for (const m of members) {
    const key = (m.email ?? "").toLowerCase();
    if (!key) continue;
    byEmail.set(key, {
      emailKey: key,
      email: m.email ?? key,
      status: "active",
      userId: m.user_id,
      displayName: m.display_name,
      roles: m.roles,
      lastSignInAt: m.last_sign_in_at,
      invitation: null,
    });
  }

  for (const inv of pendingInvites) {
    const key = inv.email.toLowerCase();
    const existing = byEmail.get(key);
    if (existing) {
      existing.status = "invited";
      existing.invitation = inv;
    } else {
      byEmail.set(key, {
        emailKey: key,
        email: inv.email,
        status: "invited",
        userId: null,
        displayName: null,
        roles: [inv.role],
        lastSignInAt: null,
        invitation: inv,
      });
    }
  }

  return Array.from(byEmail.values()).sort((a, b) => {
    if (a.status !== b.status) return a.status === "invited" ? -1 : 1;
    return a.emailKey.localeCompare(b.emailKey);
  });
}

/** Case-insensitive filter over a Person list (display name or email). Empty query = passthrough. */
export function filterPeopleList(query: string, people: Person[]): Person[] {
  const q = query.trim().toLowerCase();
  if (!q) return people;
  return people.filter(
    (p) => (p.displayName ?? "").toLowerCase().includes(q) || p.emailKey.includes(q),
  );
}
```
- [ ] Run-to-pass: `npx vitest run src/components/admin/people/peopleMatch.test.ts`. Expected: passing.
- [ ] Commit: `feat(people): add buildPeople + filterPeopleList merge helpers`

---

### Task 9: `PersonRow` component + unified `PeopleTab` (+ Vitest)

**Files**
- Create: `src/components/admin/people/PersonRow.tsx`
- Create: `src/components/admin/people/PersonRow.test.tsx`
- Modify: `src/components/admin/people/PeopleTab.tsx`
- Modify: `src/components/admin/people/peopleMatch.ts` (delete now-unused `filterPeople`)
- Modify: `src/hooks/useInvitationMutations.ts`

**Scope note (explicit, per review):** This task merges the **Members** and **Pending invitations** cards into ONE `buildPeople` list with Active/Invited pills. The read-only **Invitation history** card (accepted/revoked invitations, driven by `historyInvites` + `filterInvitesByEmail`, current PeopleTab lines 49-60 and 151-166) is DELIBERATELY PRESERVED unchanged — accepted/revoked rows carry no membership and are not part of the merged directory, so dropping them would silently lose the audit trail. Because history still consumes `filterInvitesByEmail` and `InviteRow`, both stay. Only `filterPeople` (previously the sole driver of the two merged cards) becomes dead; delete it in this task (eslint's `no-unused-vars` does NOT flag unused *exports*, so it must be removed by hand). Before deleting, confirm nothing else imports it: `grep -rn "filterPeople\b" src` should show only `PeopleTab.tsx` (being rewritten) and `peopleMatch.ts`.

**Interfaces**
- Produces: `PersonRow({ person, isSelf, onCopyLink, onResend, onRevoke, onSetRole, onRequestRemove, resendPending, revokePending, setRolePending })` — Invited state shows the status pill + copy/resend/revoke (from `person.invitation`); Active state shows role badges + role-editor popover + remove.
- Consumes: `Person` (Task 8), `ROLE_OPTIONS`, `roleLabel`.

**Steps**
- [ ] Write the failing test `src/components/admin/people/PersonRow.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PersonRow } from "./PersonRow";
import type { Person } from "./peopleMatch";

const base: Person = {
  emailKey: "a@x.com", email: "a@x.com", status: "active", userId: "u1",
  displayName: "Ada", roles: ["producer"], lastSignInAt: null, invitation: null,
};
const noop = () => {};

describe("PersonRow", () => {
  it("active person shows an Active pill and a Remove control", () => {
    render(<PersonRow person={base} isSelf={false} onCopyLink={noop} onResend={noop} onRevoke={noop} onSetRole={noop} onRequestRemove={noop} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("invited person shows an Invited pill and a Revoke control", () => {
    const invited: Person = {
      ...base, status: "invited", displayName: null,
      invitation: { id: "inv1", org_id: "o1", email: "a@x.com", role: "artist", status: "pending", token: "tok", expires_at: "2099-01-01" },
    };
    render(<PersonRow person={invited} isSelf={false} onCopyLink={noop} onResend={noop} onRevoke={noop} onSetRole={noop} onRequestRemove={noop} />);
    expect(screen.getByText("Invited")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /revoke invitation/i })).toBeInTheDocument();
  });

  it("invited revoke calls onRevoke with the invitation id", async () => {
    const onRevoke = vi.fn();
    const invited: Person = {
      ...base, status: "invited",
      invitation: { id: "inv1", org_id: "o1", email: "a@x.com", role: "artist", status: "pending", token: "tok", expires_at: "2099-01-01" },
    };
    render(<PersonRow person={invited} isSelf={false} onCopyLink={noop} onResend={noop} onRevoke={onRevoke} onSetRole={noop} onRequestRemove={noop} />);
    screen.getByRole("button", { name: /revoke invitation/i }).click();
    expect(onRevoke).toHaveBeenCalledWith("inv1");
  });
});
```
- [ ] Run-to-fail: `npx vitest run src/components/admin/people/PersonRow.test.tsx`. Expected: module `PersonRow` not found.
- [ ] Write the minimal implementation — create `src/components/admin/people/PersonRow.tsx` (verify `IconTooltip`'s import path and the icon set against `InviteRow.tsx`/`MemberRow.tsx` and adapt if they differ):
```tsx
import { format } from "date-fns";
import { Copy, X, RefreshCw, Check, Settings as SettingsIcon } from "lucide-react";
import { type AppRole, roleLabel } from "@/config/app.config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IconTooltip } from "@/components/common/IconTooltip";
import { cn } from "@/lib/utils";
import { ROLE_OPTIONS } from "./roleOptions";
import type { Person } from "./peopleMatch";

export interface PersonRowProps {
  person: Person;
  isSelf: boolean;
  onCopyLink: (token: string) => void;
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
  onSetRole: (v: { userId: string; role: AppRole; action: "add" | "remove" }) => void;
  onRequestRemove: (t: { user_id: string; email: string | null }) => void;
  resendPending?: boolean;
  revokePending?: boolean;
  setRolePending?: boolean;
}

/** One person in the merged directory: Invited (invite actions) or Active (role editor + remove). */
export function PersonRow({
  person, isSelf, onCopyLink, onResend, onRevoke, onSetRole, onRequestRemove,
  resendPending = false, revokePending = false, setRolePending = false,
}: PersonRowProps) {
  const invited = person.status === "invited";
  const inv = person.invitation;
  return (
    <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border">
      <div className="min-w-0">
        <p className={`font-medium text-sm truncate ${invited && !person.displayName ? "text-muted-foreground" : ""}`}>
          {person.displayName || person.email}
        </p>
        <p className="text-xs text-muted-foreground truncate">{person.email}</p>
        {!invited && (
          <p className="text-xs text-muted-foreground">
            {person.lastSignInAt ? `Last seen ${format(new Date(person.lastSignInAt), "dd/MM/yyyy HH:mm")}` : "Never signed in"}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{person.roles.map(roleLabel).join(", ")}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant="outline" className={cn("text-xs", invited ? "border-warning text-warning" : "border-success text-success")}>
          {invited ? "Invited" : "Active"}
        </Badge>

        {invited && inv ? (
          <>
            <IconTooltip label="Copy invite link">
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onCopyLink(inv.token)} aria-label="Copy invite link">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </IconTooltip>
            <IconTooltip label="Resend invitation">
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={resendPending} onClick={() => onResend(inv.id)} aria-label="Resend invitation">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </IconTooltip>
            <IconTooltip label="Revoke invitation">
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={revokePending} onClick={() => onRevoke(inv.id)} aria-label="Revoke invitation">
                <X className="h-3.5 w-3.5" />
              </Button>
            </IconTooltip>
          </>
        ) : (
          <>
            {person.roles.map((r) => <Badge key={r} variant="secondary" className="text-xs">{roleLabel(r)}</Badge>)}
            {person.userId && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" aria-label={`Edit roles for ${person.email}`}>
                    <SettingsIcon className="h-3 w-3 mr-1" />Roles
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="end">
                  {ROLE_OPTIONS.map((r) => {
                    const has = person.roles.includes(r);
                    return (
                      <button
                        key={r}
                        disabled={setRolePending}
                        onClick={() => onSetRole({ userId: person.userId!, role: r, action: has ? "remove" : "add" })}
                        className="flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-muted text-left disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Check className={cn("h-4 w-4 mr-2", has ? "opacity-100" : "opacity-0")} />
                        {roleLabel(r)}
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>
            )}
            <Button
              size="sm" variant="ghost" className="h-7 px-2 text-xs"
              disabled={isSelf || !person.userId}
              onClick={() => onRequestRemove({ user_id: person.userId!, email: person.email })}
            >
              {isSelf ? "You" : "Remove"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
```
- [ ] Run-to-pass: `npx vitest run src/components/admin/people/PersonRow.test.tsx`. Expected: passing.
- [ ] Rewrite `PeopleTab` to render the single merged list, KEEPING the history card. Change the imports (drop `MemberRow` + `filterPeople`; add `buildPeople`/`filterPeopleList` + `PersonRow`; keep `InviteRow` + `filterInvitesByEmail`):
```tsx
// imports:
import { buildPeople, filterPeopleList, filterInvitesByEmail } from "./peopleMatch";
import { PersonRow } from "./PersonRow";
import { InviteRow } from "./InviteRow"; // still used by the read-only history card
// (drop MemberRow + filterPeople imports)
```
  Replace the derived lists (current lines ~42-84):
```tsx
  const allMembers = useMemo(() => members ?? [], [members]);
  const pendingInvites = useMemo(
    () => (invites ?? []).filter((i) => i.status === "pending"),
    [invites],
  );
  const historyInvites = useMemo(
    () => (invites ?? []).filter((i) => i.status === "accepted" || i.status === "revoked"),
    [invites],
  );
  const people = useMemo(() => buildPeople(allMembers, pendingInvites), [allMembers, pendingInvites]);
  const filteredPeople = useMemo(() => filterPeopleList(search, people), [search, people]);
  const filteredHistory = useMemo(() => filterInvitesByEmail(search, historyInvites), [search, historyInvites]);
  const hasSearch = search.trim().length > 0;
  const dedupeHint = (isLoading || invitesLoading)
    ? "Checking existing people…"
    : (isError || invitesError)
    ? "Can't verify duplicates right now, so new invites are paused."
    : null;
  const showPeople = filteredPeople.length > 0;
  const showHistory = filteredHistory.length > 0;
  const nothing = hasSearch && !showPeople && !showHistory && !dedupeHint;
```
  Replace the pending + members cards (current lines ~111-149) with the single People card, and LEAVE the history card (current lines ~151-166) exactly as-is:
```tsx
      {showPeople && (
        <Card>
          <CardHeader><CardTitle className="font-display text-base">People</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {filteredPeople.map((p) => (
              <PersonRow
                key={p.emailKey}
                person={p}
                isSelf={p.userId === user?.id}
                onCopyLink={copyLink}
                onResend={(id) => resend.mutate(id)}
                onRevoke={(id) => revoke.mutate(id)}
                onSetRole={(vars) => setRole.mutate(vars, {
                  onSuccess: () => toast.success("Role updated"),
                  onError: (e) => toast.error((e as Error).message),
                })}
                onRequestRemove={setTarget}
                resendPending={resend.isPending && resend.variables === p.invitation?.id}
                revokePending={revoke.isPending && revoke.variables === p.invitation?.id}
                setRolePending={setRole.isPending}
              />
            ))}
          </CardContent>
        </Card>
      )}
```
  Update the empty-state copy (current lines ~168-171) to reflect people + history:
```tsx
      {nothing && <p className="text-sm text-muted-foreground text-center py-6">No people match "{search.trim()}".</p>}
      {!hasSearch && people.length === 0 && !showHistory && !isLoading && !isError && (
        <p className="text-sm text-muted-foreground text-center py-6">No people yet.</p>
      )}
```
  (Keep `InviteBar`, `BulkInviteDialog`, the search input, the `copyLink` helper, and the remove `AlertDialog` exactly as they are; they still take `allMembers` + `pendingInvites`.)
- [ ] Delete the now-dead `filterPeople` export from `src/components/admin/people/peopleMatch.ts` (keep `filterInvitesByEmail`, `matchContact`, `parseEmails`, `isValidEmail` — still used by history / InviteBar / BulkInviteDialog).
- [ ] Invalidate `['members']` on create/revoke — in `src/hooks/useInvitationMutations.ts` change `invalidate` to bust both domains:
```ts
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["org-invitations"] });
    qc.invalidateQueries({ queryKey: ["members"] });
  };
```
  (Both create and revoke now change membership, so both must refresh the merged list. Confirm the members hooks' query key prefix is exactly `["members", ...]` — see `src/hooks/useOrgMembers.ts` — and match it.)
- [ ] Run-to-pass: `npx vitest run src/components/admin/people/` and `npx tsc -p tsconfig.app.json --noEmit`. Expected: green.
- [ ] Commit: `feat(people): render one merged Active/Invited people list`

---

### Task 10: Regenerate types, sync mirrors, changelog, full verify

**Files**
- Modify: `src/integrations/supabase/types.ts` (regenerated), `supabase/functions/_shared/database.types.ts` (via mirror)
- Modify: `public/changelog.md`, `public/changelog.json`, `package.json`, `src/config/app.config.ts`

**Interfaces**
- Consumes: the three new RPCs land in the generated `Database["public"]["Functions"]` map so `client.rpc("claim_my_invitations")`, `rpc("revoke_invitation")`, and the edge `admin.rpc("ensure_invitation_membership")` typecheck.

**Steps**
- [ ] Bring up a local stack that has the new migration: `npm run local:up` (applies `supabase/migrations/` incl. `20260809170000_…`).
- [ ] Regenerate types: `supabase gen types typescript --local > src/integrations/supabase/types.ts`, then `npm run sync:mirrors`. Verify the new functions appear: `grep -n "ensure_invitation_membership\|claim_my_invitations\|revoke_invitation" src/integrations/supabase/types.ts`. (Contingency: if PostgREST omits `ensure_invitation_membership` because it is service-role-only, declare an `EnsureInvitationMembershipArgs` in `supabase/functions/_shared/rows.ts` and cast at the edge `.rpc()` calls in Tasks 4/5/6, mirroring the `ResolveShowAssignmentsArgs` pattern; the two authenticated RPCs will always be present.)
- [ ] Run `npm run sync:mirrors:check` — expect no drift.
- [ ] Add a user-facing changelog entry — prepend to `public/changelog.md` under a new version block (bump `package.json` `version` and `APP_META.VERSION` in `src/config/app.config.ts` to match, e.g. `1.15.1`):
```md
## 1.15.1 — August 9, 2026

*Invitations that just work*

### Fixed
- **Invited people join instantly** — When you invite someone, their membership and role are set up right away, so they land in the right place the moment they sign in, even if their original invite link expired and they reset their password instead.
- **Invited artists get a profile** — Inviting someone as an artist now sets up their artist profile automatically, so their dashboard is ready on first sign-in.

### Improved
- **One People list** — Admin > People now shows a single list with an Active or Invited badge per person, with invite and role controls in one place.
```
  (No mention of super-admin/platform provisioning per convention.)
- [ ] Regenerate the JSON: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`.
- [ ] Run the full gate: `npm run lint`; `npx tsc -p tsconfig.app.json --noEmit`; `npx tsc -p tsconfig.tools.json --noEmit`; `deno check --node-modules-dir=none supabase/functions/*/index.ts`; `npx vitest run`; `deno test --allow-all supabase/functions/`; `supabase test db` (or `npm run verify:full`). Expected: all green.
- [ ] Commit: `chore: regen types + mirrors; changelog 1.15.1`

---

### Task 11 (NON-CODE): Post-merge ops runbook — resend the stranded invites

**Files** — none (operational).

**Steps**
- [ ] Confirm the PR is merged to `main` and the Supabase GitHub integration reports the migration `20260809170000_invite_membership_and_self_heal` applied (`mcp list_migrations` or the Actions deploy log), and that `deploy-functions.yml` deployed `create-invitation` + `provision-org` + `resend-invitation`.
- [ ] Check each stranded invitation's `expires_at` for org **TERBE 73** before deciding the action, e.g. `select email, status, expires_at, (expires_at > now()) as still_valid from org_invitations where org_id = '<TERBE 73 org id>' and email in ('david.gottheit@posteo.de','jonas.k.behrend@gmail.com','timistderbeste0@gmail.com','tobias.radler@gmx.de','gracicalma@googlemail.com')`. `claim_my_invitations` only reconciles rows with `expires_at > now()`, so any row already past its ~14-day window MUST be resent (a reload alone will not self-heal it).
- [ ] For the four accounts that never signed in, click **Resend** in Admin > People (or the platform OrgInvitePopover as super-admin) so a fresh, non-expired invite email goes out. Resend now (idempotently) re-asserts membership and mints a new action link; `claim_my_invitations` flips the invite status to accepted on first sign-in:
  - `david.gottheit@posteo.de` (admin)
  - `jonas.k.behrend@gmail.com` (producer)
  - `timistderbeste0@gmail.com` (artist)
  - `tobias.radler@gmx.de` (artist)
- [ ] For **gracicalma@googlemail.com**: `claim_my_invitations` matches on `lower(email)` EXACTLY, and her invite is on the **googlemail.com** address, so it reconciles only when she signs in with her googlemail login (correct per the auth logs). Do NOT "normalize" googlemail to gmail anywhere. If her `still_valid` check above is TRUE, ask her to simply reload / sign in again — `claim_my_invitations` on next authenticated load will confirm her membership, auto-create her artist profile (clearing the "No artist profile linked" dashboard notice), and flip her invitation to accepted. If her row's `expires_at` has already passed (likely, given the multi-hour/day gap since the original invite), a reload will NOT create her profile — click **Resend** for her too and have her accept via the fresh link (also on the googlemail address).
- [ ] After each account signs in (or reloads), verify in Admin > People that their row shows **Active** (not Invited) and that the artist invitees now have an artist profile (their dashboard no longer shows "No artist profile linked to your account").
- [ ] Do NOT run any SQL data backfill — the self-heal (`claim_my_invitations`) plus resend cover every case per decision D.

---

## Self-Review

**Bug coverage**
- **Bug 1 (invited user sees "not a member", role not applied):** Task 4 (`create-invitation`) and Task 5 (`provision-org`) provision the `org_memberships` row at invite time via `ensure_invitation_membership`, including the super-admin "view into org" path (`requireOrgRole` accepts super-admins; the membership RPC runs on the service-role admin client). Both are best-effort/logged, and Task 7's `claim_my_invitations` in `loadIdentity` guarantees the invitee is never in a signed-in-but-not-a-member state (it reconciles before memberships are read), which is the actual gap that stranded gracicalma. Task 7 also preserves `?redirect=` through the recovery link as defense-in-depth.
- **Bug 2 (status doesn't flip; merge lists):** `claim_my_invitations` marks invitations `accepted` on sign-in (status flips); `revoke_invitation` marks `revoked` and removes the invite-created membership (guarded to pending only, admin OR super-admin, last-admin-guarded); Task 8/9 merge members + pending invites into one `buildPeople` list with an Active/Invited pill, invite actions on invited rows and role editor/remove on active rows. The read-only invitation-history card is explicitly preserved (Task 9 scope note), so revoked/accepted history is not lost.
- **Bug 3 (no artist profile):** `ensure_invitation_membership` auto-creates an `artists` row (name from the email local-part) for plain-email artist invites with no claimable row — verified by pgTAP Task 1 (#4/#5), the Task 2 accept regression (count assertion), and the Task 2 claim test (#3). Task 11 confirms the dashboard notice clears for the three stranded artists.

**Decision coverage (A–D)**
- **A (membership at invite time incl. super-admin):** Tasks 1, 4, 5, 6. All three edge callers provision membership best-effort/logged (matching each function's existing "delivery failure must not fail the request / must not undo the org" posture); the always-on `claim_my_invitations` self-heal is the backstop, so the not-a-member gap cannot be observed by a signed-in user even if a membership RPC hiccups. This deliberately replaces the earlier fatal-on-failure design for `create-invitation`, which would have left a pending invite + 500 and a retry-into-409. **Owner sign-off (2026-08-09): best-effort/logged approved** — closes the round-3 critic must-fix (the relaxation of locked decision A is explicit and accepted, not unilateral).
- **B (one unified list):** Tasks 8, 9 — `buildPeople` dedupes by lowercased email, invited-first sort, invited rows keep resend/revoke/copy-link, active rows keep role editor/remove; history card retained.
- **C (auto-create + link artist by derived name):** `ensure_invitation_membership` email branch; `split_part(email,'@',1)` for the NOT NULL `name`; guarded against the `artists (org_id,user_id)` partial-unique index by the owner no-op check.
- **D (no SQL backfill; resend + self-heal):** Task 7 `claim_my_invitations` + Task 11 resend runbook listing the exact four accounts and the gracicalma path, with an explicit `expires_at` check so an expired row is resent rather than assumed to self-heal, and an explicit googlemail-vs-gmail note.

**Guard-interaction walk (the "already a member" / duplicate cases):** `create-invitation` retains its pre-existing org-scoped guards: the `existingUserId`-gated duplicate-member 409 and the pending-invite unique-index 23505 → 409. The new membership step reuses `existingUserId` (no second `get_user_id_by_email` for existing users) and only mints a net-new account when `existingUserId` is null; the Task 4 test drives that net-new path so the duplicate-member 409 guard is not triggered, and the assertion goes green (the earlier design's 409 trap is gone). `ensure_invitation_membership`'s `ON CONFLICT (org_id,user_id,role) DO NOTHING` is a further backstop. An existing user invited to a NEW org B proceeds normally: the duplicate check is scoped to `(org_id, lower(email))`, so no conflict, and the helper inserts the org-B membership. `revoke_invitation` deletes only the exact `(org_id, user_id, invited-role)` row, so revoking one role never strips a genuinely-earned second role, and its pending-only status guard prevents stripping membership from an already-accepted invite (pgTAP #6). The service-role-only grant on `ensure_invitation_membership` works via owner privilege for `accept_invitation`/`claim_my_invitations` and is asserted closed to `authenticated` (pgTAP #9).

**Placeholder scan:** No `TBD`/`similar to`/`add error handling` placeholders; every code step carries runnable code. Repeated code (guards, import lines, delivery blocks) is written out in full rather than cross-referenced.

**Type-consistency check:** `ensure_invitation_membership(uuid,uuid)→boolean`, `claim_my_invitations()→int`, `revoke_invitation(uuid)→void` are declared identically in the migration, called with the same arg names (`p_invitation`/`p_user`, no args, `p_id`) in edge (`admin.rpc`) and frontend (`client.rpc`), and asserted with those exact args in the Deno and Vitest tests. `ensureInvitedUser`/`sendOrgInvitationEmail` signatures are identical across their three edge callers (Tasks 4/5/6) and the shared module (Task 3); the default `generateLink` fake returns no `user.id`, so callers treat `userId: null` as "skip membership," which is why existing edge tests stay green with `adminDeps` untouched. `Person` fields are produced by `buildPeople` and consumed unchanged by `PersonRow`. `OrgMember.last_sign_in_at` maps to `Person.lastSignInAt`. The `Invitation` shape (`id`/`token`/`role`/`status`) is the same across `buildPeople`, `PersonRow`, and `revokeInvitation`. Types regen (Task 10) must land before the app-tsc gates in Tasks 7/9 fully pass, so the Task 7 typecheck is explicitly deferred to Task 10 while Tasks 8/9 (which add no new RPC names) typecheck independently.
