# Org-member removal fix + /admin/people tombstones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the super-admin "Remove from org" that fails with a masked "Something went wrong," and rebuild org-member removal in Admin → People as a reversible soft-remove that leaves a "Recently removed" tombstone with Undo / Clear from list / safe-scoped Delete account.

**Architecture:** Removal keeps hard-deleting the `org_memberships` row (so every RLS access predicate is untouched) and writes a new `org_member_removals` tombstone that carries a snapshot for Undo and audit. New org-admin RPCs (`restore_org_member`, `clear_removed_member`, `list_removed_members`) plus one org-admin edge function (`org-purge-removed-user`) that fully deletes the account **only** when this was the user's last org. A shared `toErrorMessage`/`friendlyError` helper un-masks Supabase's plain-object errors in `UserDetailSheet`.

**Tech Stack:** Postgres (SECURITY DEFINER RPCs, RLS), Supabase Edge (Deno, DI via `handle(req, deps)`), React + React Query + shadcn, Vitest, pgTAP, Deno test.

## Global Constraints

- `any` is banned (lint `--max-warnings 0`); type Supabase joined rows with an explicit local `interface` + a single `as unknown as Row[]` at the query boundary.
- Tests import the real module; never re-implement production logic in a test. Frontend tests use `src/test/supabaseFake.ts` + `renderWithProviders`; edge tests use `makeFakeDeps` from `_shared/testing.ts`. Never `vi.mock` the Supabase client.
- Query-key convention: existing member reads use `["members", orgId]`; mutations bust the whole `["members"]` domain. Tombstone reads use `["removed-members", orgId]`.
- Styling: semantic tokens only; destructive uses `text-[var(--red-600)]` / `hover:bg-[var(--red-100)]` (existing PersonRow idiom). No hardcoded colors. Week starts Monday (not relevant here). No em/en dashes in UI copy.
- Migrations auto-apply on merge; never hand-apply to prod. Regenerate types from the LOCAL stack (`supabase gen types --local`) after applying the migration locally, then `npm run sync:mirrors`.
- New edge function needs a `[functions.<name>]` block in `supabase/config.toml` (`verify_jwt = true`), or it deploys with JWT forced on incorrectly for its intended auth.
- Role display: never compare against the display label; always check the literal `'admin'` / `'producer'` role.
- Branch: `claude/super-admin-user-removal-0aa3f1`. Frequent commits, one per task.

---

## File structure

- `supabase/migrations/<ts>_org_member_removals.sql` — new. Table + RLS + `list_removed_members`, modified `remove_org_member`, `restore_org_member`, `clear_removed_member`, `_anonymize_user_data` (extracted private helper), `admin_anonymize_removed_user`.
- `supabase/tests/rpc/org_member_removal.test.sql` — new. pgTAP for the RPCs + guards + isolation.
- `supabase/functions/org-purge-removed-user/index.ts` — new. Safe-scoped full-delete edge function.
- `supabase/functions/org-purge-removed-user/index.test.ts` — new. Deno DI test.
- `supabase/config.toml` — modify. Add `[functions.org-purge-removed-user]`.
- `src/lib/errors.ts` — new. `toErrorMessage` + `friendlyError`.
- `src/lib/errors.test.ts` — new.
- `src/data/members.ts` — modify. `RemovedMember` type + `fetchRemovedMembers`, `restoreOrgMember`, `clearRemovedMember`, `purgeRemovedUser`.
- `src/data/members.removed.test.ts` — new. Data-access tests via `supabaseFake`.
- `src/hooks/useOrgMembers.ts` — modify. `useRemovedMembers`, `useRestoreOrgMember`, `useClearRemovedMember`, `usePurgeRemovedUser`; broaden invalidations.
- `src/components/admin/people/RemovedPersonRow.tsx` — new. Tombstone row.
- `src/components/admin/people/RemovedPersonRow.test.tsx` — new.
- `src/components/admin/people/PeopleTab.tsx` — modify. "Recently removed" group + dialogs + toasts + `toErrorMessage`.
- `src/components/platform/UserDetailSheet.tsx` — modify. `errorMessage` → `friendlyError`; disable only-admin Remove.
- `src/integrations/supabase/types.ts` + `supabase/functions/_shared/database.types.ts` — regenerated (Task 5).

---

## Task 1: Tombstone table + `list_removed_members` + tombstone-writing `remove_org_member`

**Files:**
- Create: `supabase/migrations/<ts>_org_member_removals.sql`
- Test: `supabase/tests/rpc/org_member_removal.test.sql`

**Interfaces:**
- Produces: table `public.org_member_removals(org_id uuid, user_id uuid, email text, display_name text, roles app_role[], removed_at timestamptz, removed_by uuid)`; `public.remove_org_member(p_org uuid, p_user uuid) returns void` (now snapshots + tombstones); `public.list_removed_members(p_org uuid) returns table(user_id uuid, email text, display_name text, roles app_role[], removed_at timestamptz, removed_by_name text, deletable boolean)`.

Create the migration file with `date +%Y%m%d%H%M%S` as `<ts>` (or the migration tool). Write the failing pgTAP first.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/rpc/org_member_removal.test.sql`:

```sql
begin;
select plan(6);

-- Fixtures: one org, an admin, and an artist member.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','admin@t.test'),
  ('22222222-2222-2222-2222-222222222222','artist@t.test');
insert into public.organizations (id, name) values ('aaaaaaaa-0000-0000-0000-000000000001','Org A');
insert into public.org_memberships (org_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','admin'),
  ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','artist');

-- Act as the admin.
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);

-- 1. Removing the artist deletes the membership.
select lives_ok(
  $$ select public.remove_org_member('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222') $$,
  'admin removes the artist');
select is_empty(
  $$ select 1 from public.org_memberships where org_id='aaaaaaaa-0000-0000-0000-000000000001' and user_id='22222222-2222-2222-2222-222222222222' $$,
  'membership row is gone');

-- 2. A tombstone was written with the role snapshot.
select results_eq(
  $$ select roles from public.org_member_removals where org_id='aaaaaaaa-0000-0000-0000-000000000001' and user_id='22222222-2222-2222-2222-222222222222' $$,
  $$ values (array['artist']::app_role[]) $$,
  'tombstone snapshots the removed roles');

-- 3. list_removed_members shows the tombstone, deletable=true (artist had no other org).
select results_eq(
  $$ select user_id, deletable from public.list_removed_members('aaaaaaaa-0000-0000-0000-000000000001') $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid, true) $$,
  'list_removed_members returns the tombstone as deletable');

-- 4. The last-admin guard still fires (admin cannot remove themselves as last admin via self path).
select throws_ok(
  $$ select public.remove_org_member('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111') $$,
  '42501', 'You cannot remove your own membership',
  'self-removal still blocked');

-- 5. A non-admin cannot call remove_org_member.
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
select throws_ok(
  $$ select public.remove_org_member('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111') $$,
  '42501', 'Forbidden: org admin only',
  'non-admin blocked from remove_org_member');

select finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase test db supabase/tests/rpc/org_member_removal.test.sql`
Expected: FAIL — `org_member_removals` / `list_removed_members` do not exist.
(If the local stack is unavailable, run the file's body via the Supabase MCP `execute_sql` wrapped in `begin; create extension if not exists pgtap; … rollback;`.)

- [ ] **Step 3: Write the DDL**

Create `supabase/migrations/<ts>_org_member_removals.sql`:

```sql
-- Tombstones for org-member removal: keep a snapshot of a removed member so the
-- Admin > People "Recently removed" group can show who left, when, and offer Undo,
-- WITHOUT soft-deleting org_memberships (which would force every is_org_member /
-- has_org_role access check to learn to ignore removed rows). remove_org_member
-- still hard-deletes the membership; this table is presentational + audit only.
create table public.org_member_removals (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  roles        app_role[] not null,
  removed_at   timestamptz not null default now(),
  removed_by   uuid,
  primary key (org_id, user_id)
);
alter table public.org_member_removals enable row level security;

-- Org admins (and super-admins, via has_org_role) manage their org's tombstones.
create policy "org admins manage removals" on public.org_member_removals
  for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin'))
  with check (public.has_org_role(auth.uid(), org_id, 'admin'));

-- RESTRICTIVE pooled-tenancy isolation, matching every other tenant table (ADR-0003).
create policy "org_isolation" on public.org_member_removals as restrictive
  for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));

create index org_member_removals_org_idx on public.org_member_removals (org_id, removed_at desc);

-- remove_org_member: keep the three guards, then snapshot roles/email/name and
-- upsert the tombstone in the same transaction as the hard delete.
create or replace function public.remove_org_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_roles  app_role[];
  v_email  text;
  v_name   text;
begin
  if not public.has_org_role(v_caller, p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  if p_user = v_caller then
    raise exception 'You cannot remove your own membership' using errcode = '42501';
  end if;
  lock table public.org_memberships in share row exclusive mode;
  if exists (select 1 from public.org_memberships where org_id = p_org and user_id = p_user and role = 'admin')
     and (select count(distinct user_id) from public.org_memberships
          where org_id = p_org and role = 'admin' and user_id <> p_user) < 1 then
    raise exception 'Cannot remove the last admin of the organization' using errcode = '42501';
  end if;

  select array_agg(role order by role) into v_roles
    from public.org_memberships where org_id = p_org and user_id = p_user;
  select u.email::text, p.display_name into v_email, v_name
    from auth.users u left join public.profiles p on p.user_id = u.id
    where u.id = p_user;

  delete from public.org_memberships where org_id = p_org and user_id = p_user;

  insert into public.org_member_removals (org_id, user_id, email, display_name, roles, removed_at, removed_by)
  values (p_org, p_user, v_email, v_name, coalesce(v_roles, '{}'), now(), v_caller)
  on conflict (org_id, user_id)
  do update set email = excluded.email, display_name = excluded.display_name,
                roles = excluded.roles, removed_at = excluded.removed_at, removed_by = excluded.removed_by;
end;
$$;

-- list_removed_members: the "Recently removed" feed. deletable = the user now has NO
-- membership in ANY org (this was their last one), which also means they are not the
-- sole admin of any other org — so a full account delete affects nobody else.
create or replace function public.list_removed_members(p_org uuid)
returns table (user_id uuid, email text, display_name text, roles app_role[],
               removed_at timestamptz, removed_by_name text, deletable boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_org_role(auth.uid(), p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  return query
    select r.user_id, r.email, r.display_name, r.roles, r.removed_at,
           actor.display_name as removed_by_name,
           not exists (select 1 from public.org_memberships m where m.user_id = r.user_id) as deletable
    from public.org_member_removals r
    left join public.profiles actor on actor.user_id = r.removed_by
    where r.org_id = p_org
    order by r.removed_at desc;
end;
$$;

revoke all on function public.list_removed_members(uuid) from public, anon;
grant execute on function public.list_removed_members(uuid) to authenticated;
```

Note: adding a membership back must clear a stale tombstone. `restore_org_member` (Task 2) deletes it explicitly; the invite-accept / role-add paths are out of scope here because the tombstone is admin-only chrome and `deletable`/display recompute on next read — a stale tombstone for a re-added user is corrected the moment an admin clicks Undo or Clear. (If this proves confusing in review, add a trigger on `org_memberships` INSERT to delete a matching tombstone — deferred as YAGNI.)

- [ ] **Step 4: Apply locally + run the test to verify it passes**

Run: `npm run local:reset` (applies migrations + seed) then `supabase test db supabase/tests/rpc/org_member_removal.test.sql`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/rpc/org_member_removal.test.sql
git commit -m "feat: org_member_removals tombstone + tombstone-writing remove_org_member"
```

---

## Task 2: `restore_org_member` + `clear_removed_member`

**Files:**
- Modify: `supabase/migrations/<ts>_org_member_removals.sql` (append)
- Test: `supabase/tests/rpc/org_member_removal.test.sql` (extend)

**Interfaces:**
- Consumes: `org_member_removals`, `remove_org_member` (Task 1).
- Produces: `public.restore_org_member(p_org uuid, p_user uuid) returns void`; `public.clear_removed_member(p_org uuid, p_user uuid) returns void`.

- [ ] **Step 1: Add failing pgTAP assertions**

In `org_member_removal.test.sql`, bump `plan(6)` → `plan(9)` and append before `select finish();` (still acting as the admin — re-set the sub to the admin id after test 5/6 flipped it):

```sql
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);

-- 7. Undo re-inserts the membership with its original role and drops the tombstone.
select lives_ok(
  $$ select public.restore_org_member('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222') $$,
  'admin restores the removed artist');
select results_eq(
  $$ select role from public.org_memberships where org_id='aaaaaaaa-0000-0000-0000-000000000001' and user_id='22222222-2222-2222-2222-222222222222' $$,
  $$ values ('artist'::app_role) $$,
  'membership restored with original role');
select is_empty(
  $$ select 1 from public.org_member_removals where org_id='aaaaaaaa-0000-0000-0000-000000000001' and user_id='22222222-2222-2222-2222-222222222222' $$,
  'tombstone cleared after restore');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase test db supabase/tests/rpc/org_member_removal.test.sql`
Expected: FAIL — `restore_org_member` does not exist.

- [ ] **Step 3: Append the DDL**

Append to the migration:

```sql
-- Undo: re-insert the snapshot memberships, delete the tombstone. Idempotent per role.
create or replace function public.restore_org_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_roles app_role[];
begin
  if not public.has_org_role(auth.uid(), p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  select roles into v_roles from public.org_member_removals where org_id = p_org and user_id = p_user;
  if v_roles is null then
    raise exception 'No removed member to restore' using errcode = 'P0002';
  end if;
  insert into public.org_memberships (org_id, user_id, role)
  select p_org, p_user, unnest(v_roles)
  on conflict (org_id, user_id, role) do nothing;
  delete from public.org_member_removals where org_id = p_org and user_id = p_user;
end;
$$;

-- Clear from list: dismiss the tombstone only; the account is untouched.
create or replace function public.clear_removed_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_org_role(auth.uid(), p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  delete from public.org_member_removals where org_id = p_org and user_id = p_user;
end;
$$;

revoke all on function public.restore_org_member(uuid, uuid) from public, anon;
revoke all on function public.clear_removed_member(uuid, uuid) from public, anon;
grant execute on function public.restore_org_member(uuid, uuid) to authenticated;
grant execute on function public.clear_removed_member(uuid, uuid) to authenticated;
```

- [ ] **Step 4: Apply + verify pass**

Run: `npm run local:reset && supabase test db supabase/tests/rpc/org_member_removal.test.sql`
Expected: PASS (9/9).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/rpc/org_member_removal.test.sql
git commit -m "feat: restore_org_member (undo) + clear_removed_member (dismiss)"
```

---

## Task 3: Shared `_anonymize_user_data` helper + `admin_anonymize_removed_user`

Extract the anonymization statements into a private helper so both the existing GDPR path and the new org-admin path share one body (no drift), without loosening `anonymize_user`'s own guard.

**Files:**
- Modify: `supabase/migrations/<ts>_org_member_removals.sql` (append)
- Test: `supabase/tests/rpc/org_member_removal.test.sql` (extend)

**Interfaces:**
- Consumes: existing `anonymize_user` statements (from `20260711011420_anonymize_user_clear_unsubscribe_token.sql` — read that file for the current, authoritative body before extracting).
- Produces: `public._anonymize_user_data(p_user uuid) returns void` (private); `public.anonymize_user(p_user uuid)` rewritten to guard + call the helper; `public.admin_anonymize_removed_user(p_org uuid, p_user uuid) returns void`.

- [ ] **Step 1: Add failing pgTAP assertions**

Bump `plan(9)` → `plan(12)`. First re-remove the artist so a tombstone exists again, then assert the admin purge path. Append before `finish()`:

```sql
-- Re-remove the artist (they were restored in test 7) so a tombstone exists.
select public.remove_org_member('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');

-- 10. Admin anonymize refuses if the target still has a membership elsewhere.
insert into public.organizations (id, name) values ('aaaaaaaa-0000-0000-0000-000000000002','Org B');
insert into public.org_memberships (org_id, user_id, role)
  values ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','artist');
select throws_ok(
  $$ select public.admin_anonymize_removed_user('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222') $$,
  'P0001', 'User still belongs to another organization',
  'admin anonymize refuses when target is in another org');

-- 11. With no other membership, admin anonymize succeeds and anonymizes the artist profile.
delete from public.org_memberships where org_id='aaaaaaaa-0000-0000-0000-000000000002' and user_id='22222222-2222-2222-2222-222222222222';
insert into public.artists (id, org_id, name, email, user_id)
  values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Art Ist','artist@t.test','22222222-2222-2222-2222-222222222222');
select lives_ok(
  $$ select public.admin_anonymize_removed_user('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222') $$,
  'admin anonymize succeeds for a last-org removed user');
select results_eq(
  $$ select name, user_id from public.artists where id='cccccccc-0000-0000-0000-000000000001' $$,
  $$ values ('Deleted artist'::text, null::uuid) $$,
  'artist profile anonymized + unlinked');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase test db supabase/tests/rpc/org_member_removal.test.sql`
Expected: FAIL — `admin_anonymize_removed_user` does not exist.

- [ ] **Step 3: Append the DDL**

First read `supabase/migrations/20260711011420_anonymize_user_clear_unsubscribe_token.sql` (and `20260622193223_anonymize_user.sql`) for the current body. Append, transcribing the CURRENT statement list into the helper (the block below reflects the known body — reconcile against the file before committing):

```sql
-- Private: the anonymization statements only. No auth check; revoked from everyone
-- so it is reachable ONLY from the two guarded wrappers below.
create or replace function public._anonymize_user_data(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.blocked_dates
    where artist_id in (select id from public.artists where user_id = p_user);
  update public.artists
    set name = 'Deleted artist', email = null, phone = null, bio = null, user_id = null
    where user_id = p_user;
  delete from public.chat_messages where user_id = p_user;
  update public.booking_audit_log set performed_by = null where performed_by = p_user;
  delete from public.notifications where user_id = p_user;
  delete from public.notification_preferences where user_id = p_user;
  delete from public.org_memberships where user_id = p_user;
  delete from public.org_invitations
    where lower(email) = (select lower(email) from auth.users where id = p_user);
  -- (reconcile: the live anonymize_user also clears the unsubscribe token — keep that line)
  delete from public.profiles where user_id = p_user;
end;
$$;
revoke all on function public._anonymize_user_data(uuid) from public, anon, authenticated;

-- Existing GDPR path: keep its self/super-admin guard, delegate the body to the helper.
create or replace function public.anonymize_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (auth.uid() = p_user or public.is_super_admin(auth.uid())) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform public._anonymize_user_data(p_user);
end;
$$;

-- New org-admin path: erase a removed member's account, but ONLY when this is their
-- last org (no membership anywhere) so no other org is affected. Guarded three ways.
create or replace function public.admin_anonymize_removed_user(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_org_role(auth.uid(), p_org, 'admin') then
    raise exception 'Forbidden: org admin only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.org_member_removals where org_id = p_org and user_id = p_user) then
    raise exception 'User was not removed from this organization' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.org_memberships where user_id = p_user) then
    raise exception 'User still belongs to another organization' using errcode = 'P0001';
  end if;
  perform public._anonymize_user_data(p_user);
end;
$$;

revoke all on function public.admin_anonymize_removed_user(uuid, uuid) from public, anon;
grant execute on function public.admin_anonymize_removed_user(uuid, uuid) to authenticated;
```

Do NOT change the grants on `anonymize_user` (it already grants execute to authenticated with its own guard).

- [ ] **Step 4: Apply + verify pass**

Run: `npm run local:reset && supabase test db supabase/tests/rpc/org_member_removal.test.sql`
Expected: PASS (12/12).

- [ ] **Step 5: Verify the existing GDPR path still works**

Run the existing account-deletion pgTAP + edge tests that touch `anonymize_user`:
Run: `supabase test db` (full pgTAP suite) and `deno test --allow-all supabase/functions/delete-my-account/`
Expected: PASS (the extraction is behavior-preserving).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat: extract _anonymize_user_data; add admin_anonymize_removed_user (last-org guard)"
```

---

## Task 4: `org-purge-removed-user` edge function

**Files:**
- Create: `supabase/functions/org-purge-removed-user/index.ts`
- Create: `supabase/functions/org-purge-removed-user/index.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `requireOrgRole` (`_shared/auth.ts`), `realDeps`/`Deps` (`_shared/deps.ts`), `preflight`/`json` (`_shared/http.ts`), `admin_anonymize_removed_user` (Task 3).
- Produces: `POST { org_id, user_id }` → `200 { deleted: true }` | `200 { retained: true, reason }` | error. `handle(req, deps)` export.

- [ ] **Step 1: Write the failing Deno test**

Create `index.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
const CALLER = "11111111-1111-1111-1111-111111111111";
const TARGET = "22222222-2222-2222-2222-222222222222";
const auth = { Authorization: "Bearer jwt" };

function depsFor(targetMemberships: Array<{ role: string }>) {
  return makeFakeDeps({
    authUser: { id: CALLER },
    tables: {
      // requireOrgRole: caller's admin row in ORG.
      org_memberships: {
        match: [
          { when: { user_id: CALLER, org_id: ORG }, data: [{ role: "admin" }] },
          { when: { user_id: TARGET }, data: targetMemberships },
        ],
        data: [],
      },
      // tombstone existence check for (ORG, TARGET).
      org_member_removals: { data: [{ org_id: ORG, user_id: TARGET }] },
    },
  });
}

Deno.test("retains the account when the target still belongs to another org", async () => {
  const { deps } = depsFor([{ role: "artist" }]);
  const res = await handle(makeRequest({ headers: auth, body: { org_id: ORG, user_id: TARGET } }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { retained: true, reason: "other_memberships" });
});

Deno.test("deletes the account when this was the target's last org", async () => {
  const { deps, calls } = depsFor([]);
  const res = await handle(makeRequest({ headers: auth, body: { org_id: ORG, user_id: TARGET } }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { deleted: true });
  // anonymize RPC + auth delete both fired.
  const rpc = calls.find((c) => c.table === "rpc:admin_anonymize_removed_user");
  assertEquals(!!rpc, true);
});

Deno.test("rejects a non-admin caller", async () => {
  const deps = makeFakeDeps({
    authUser: { id: CALLER },
    tables: { org_memberships: { data: [] }, platform_admins: { data: [] } },
  }).deps;
  const res = await handle(makeRequest({ headers: auth, body: { org_id: ORG, user_id: TARGET } }), deps);
  assertEquals(res.status, 403);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test --allow-all supabase/functions/org-purge-removed-user/`
Expected: FAIL — `./index.ts` does not exist.

- [ ] **Step 3: Write the handler**

Create `index.ts`:

```ts
import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

interface Body { org_id?: string; user_id?: string }

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Body;
  try { body = await req.json() as Body; } catch { return json({ error: "Bad request" }, 400); }
  const orgId = body.org_id, targetId = body.user_id;
  if (!orgId || !targetId) return json({ error: "Bad request" }, 400);

  const authHeader = req.headers.get("Authorization") ?? "";
  const gate = await requireOrgRole(deps, req, orgId, ["admin"]);
  if (!gate.ok) return gate.response;

  // Must already be a removed member of this org.
  const { data: tomb } = await deps.admin
    .from("org_member_removals").select("user_id").eq("org_id", orgId).eq("user_id", targetId).maybeSingle();
  if (!tomb) return json({ error: "not_removed" }, 404);

  // Safe-scope: only a full delete if this was their LAST org (no membership anywhere).
  const { data: other } = await deps.admin
    .from("org_memberships").select("org_id").eq("user_id", targetId).limit(1).maybeSingle();
  if (other) return json({ retained: true, reason: "other_memberships" }, 200);

  // Anonymize via the caller's JWT client so admin_anonymize_removed_user's has_org_role(auth.uid()) resolves.
  const { error: anonErr } = await deps.userClient(authHeader)
    .rpc("admin_anonymize_removed_user", { p_org: orgId, p_user: targetId });
  if (anonErr) return json({ error: "anonymize_failed" }, 500);

  // Delete the auth account; the org_member_removals FK cascade clears the tombstone.
  const { error: delErr } = await deps.admin.auth.admin.deleteUser(targetId);
  if (delErr) return json({ error: "delete_failed" }, 500);

  return json({ deleted: true }, 200);
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 4: Run it to verify it passes**

Run: `deno test --allow-all supabase/functions/org-purge-removed-user/`
Expected: PASS (3/3).
Then: `deno check --node-modules-dir=none supabase/functions/org-purge-removed-user/index.ts`

- [ ] **Step 5: Register in config.toml**

Add to `supabase/config.toml` (alphabetically among the `[functions.*]` blocks):

```toml
[functions.org-purge-removed-user]
verify_jwt = true
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/org-purge-removed-user supabase/config.toml
git commit -m "feat: org-purge-removed-user edge fn (safe-scoped account delete)"
```

---

## Task 5: Regenerate types + sync mirrors

**Files:**
- Modify (generated): `src/integrations/supabase/types.ts`, `supabase/functions/_shared/database.types.ts`

- [ ] **Step 1: Ensure the migration is applied locally**

Run: `npm run local:reset` (applies the new migration to the local stack).

- [ ] **Step 2: Regenerate types from the local schema**

Run: `supabase gen types typescript --local > src/integrations/supabase/types.ts`
Then: `npm run sync:mirrors`

- [ ] **Step 3: Verify types include the new RPCs + table**

Run: `npm run sync:mirrors:check && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS; `types.ts` now contains `org_member_removals`, `list_removed_members`, `restore_org_member`, `clear_removed_member`, `admin_anonymize_removed_user`.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts
git commit -m "chore: regenerate types for org_member_removals + RPCs"
```

---

## Task 6: Shared error helper `src/lib/errors.ts`

**Files:**
- Create: `src/lib/errors.ts`
- Test: `src/lib/errors.test.ts`

**Interfaces:**
- Produces: `toErrorMessage(e: unknown, fallback?: string): string`; `friendlyError(e: unknown): string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toErrorMessage, friendlyError } from "./errors";

describe("toErrorMessage", () => {
  it("reads Error.message", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });
  it("reads .message off a plain PostgREST-shaped object", () => {
    expect(toErrorMessage({ code: "P0001", message: "org must keep at least one admin" }))
      .toBe("org must keep at least one admin");
  });
  it("falls back for a value with no message", () => {
    expect(toErrorMessage(null)).toBe("Something went wrong");
    expect(toErrorMessage({}, "Nope")).toBe("Nope");
  });
});

describe("friendlyError", () => {
  it("maps the last-admin guard to guidance", () => {
    expect(friendlyError({ message: "org must keep at least one admin" }))
      .toMatch(/at least one admin/i);
    expect(friendlyError({ message: "Cannot remove the last admin of the organization" }))
      .toMatch(/admin first/i);
  });
  it("passes other messages through", () => {
    expect(friendlyError({ message: "Forbidden" })).toBe("Forbidden");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/errors.ts`:

```ts
/**
 * Normalize an unknown thrown value to a user-facing message. supabase-js returns a
 * failed .rpc()/query error as a PLAIN object { code, message, details, hint } — NOT an
 * Error instance — so `e instanceof Error` alone silently swallows every DB error into a
 * generic fallback. Read `.message` off either shape.
 */
export function toErrorMessage(e: unknown, fallback = "Something went wrong"): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}

/** Map known org-membership guard messages to guidance; otherwise the real message. */
export function friendlyError(e: unknown): string {
  const msg = toErrorMessage(e);
  if (/keep at least one admin|last admin of the organization/i.test(msg)) {
    return "This organization needs at least one admin. Make someone else an admin first, then remove this one.";
  }
  return msg;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.ts src/lib/errors.test.ts
git commit -m "feat: toErrorMessage/friendlyError — un-mask supabase plain-object errors"
```

---

## Task 7: Data-access for removed members (`src/data/members.ts`)

**Files:**
- Modify: `src/data/members.ts`
- Test: `src/data/members.removed.test.ts`

**Interfaces:**
- Consumes: `list_removed_members`, `restore_org_member`, `clear_removed_member` RPCs; `org-purge-removed-user` function.
- Produces: `RemovedMember` interface; `fetchRemovedMembers(client, orgId): Promise<RemovedMember[]>`; `restoreOrgMember(client, orgId, userId): Promise<void>`; `clearRemovedMember(client, orgId, userId): Promise<void>`; `purgeRemovedUser(client, orgId, userId): Promise<{ deleted: boolean; retained: boolean }>`.

- [ ] **Step 1: Write the failing test**

Create `src/data/members.removed.test.ts` (uses the real `createFakeSupabase` API: seed keyed by `rpc:<name>` / `fn:<name>`, calls recorded on `fake.calls`, client passed as `fake as never`):

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchRemovedMembers, restoreOrgMember, clearRemovedMember, purgeRemovedUser } from "./members";

describe("fetchRemovedMembers", () => {
  it("calls list_removed_members and returns the rows", async () => {
    const rows = [{ user_id: "u1", email: "a@t.test", display_name: "A", roles: ["artist"],
      removed_at: "2026-08-11T00:00:00Z", removed_by_name: "David", deletable: true }];
    const fake = createFakeSupabase({ "rpc:list_removed_members": { data: rows, error: null } });
    expect(await fetchRemovedMembers(fake as never, "org1")).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "rpc:list_removed_members", method: "rpc", args: [{ p_org: "org1" }] });
  });
});

describe("mutations", () => {
  it("restoreOrgMember surfaces the RPC error", async () => {
    const fake = createFakeSupabase({ "rpc:restore_org_member": { data: null, error: { message: "nope" } } });
    await expect(restoreOrgMember(fake as never, "org1", "u1")).rejects.toMatchObject({ message: "nope" });
  });
  it("clearRemovedMember calls the RPC with the right args", async () => {
    const fake = createFakeSupabase({ "rpc:clear_removed_member": { data: null, error: null } });
    await clearRemovedMember(fake as never, "org1", "u1");
    expect(fake.calls).toContainEqual({ table: "rpc:clear_removed_member", method: "rpc", args: [{ p_org: "org1", p_user: "u1" }] });
  });
  it("purgeRemovedUser returns the edge-fn result", async () => {
    const fake = createFakeSupabase({ "fn:org-purge-removed-user": { data: { deleted: true }, error: null } });
    expect(await purgeRemovedUser(fake as never, "org1", "u1")).toEqual({ deleted: true, retained: false });
    expect(fake.calls).toContainEqual({ table: "fn:org-purge-removed-user", method: "invoke", args: [{ org_id: "org1", user_id: "u1" }] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/data/members.removed.test.ts`
Expected: FAIL — the new functions are not exported.

- [ ] **Step 3: Add the data-access functions**

Append to `src/data/members.ts`:

```ts
export interface RemovedMember {
  user_id: string;
  email: string | null;
  display_name: string | null;
  roles: AppRole[];
  removed_at: string;
  removed_by_name: string | null;
  /** true when the user has no membership in any org — a full account delete is safe. */
  deletable: boolean;
}

/** Tombstones for an org's recently-removed members (admin-only RPC). */
export async function fetchRemovedMembers(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<RemovedMember[]> {
  const { data, error } = await client.rpc("list_removed_members", { p_org: orgId });
  if (error) throw error;
  return (data ?? []) as unknown as RemovedMember[];
}

/** Undo a removal: restore the membership + roles, drop the tombstone (admin-only RPC). */
export async function restoreOrgMember(
  client: SupabaseClient<Database>, orgId: string, userId: string,
): Promise<void> {
  const { error } = await client.rpc("restore_org_member", { p_org: orgId, p_user: userId });
  if (error) throw error;
}

/** Dismiss a tombstone from the list; account untouched (admin-only RPC). */
export async function clearRemovedMember(
  client: SupabaseClient<Database>, orgId: string, userId: string,
): Promise<void> {
  const { error } = await client.rpc("clear_removed_member", { p_org: orgId, p_user: userId });
  if (error) throw error;
}

/** Full account delete for a removed user, only when this was their last org (edge fn). */
export async function purgeRemovedUser(
  client: SupabaseClient<Database>, orgId: string, userId: string,
): Promise<{ deleted: boolean; retained: boolean }> {
  const { data, error } = await client.functions.invoke("org-purge-removed-user", {
    body: { org_id: orgId, user_id: userId },
  });
  if (error) throw error;
  const payload = data as { error?: string; deleted?: boolean; retained?: boolean };
  if (payload?.error) throw new Error(payload.error);
  return { deleted: !!payload?.deleted, retained: !!payload?.retained };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/data/members.removed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/members.ts src/data/members.removed.test.ts
git commit -m "feat: data-access for removed-member tombstones + purge"
```

---

## Task 8: Hooks (`src/hooks/useOrgMembers.ts`)

**Files:**
- Modify: `src/hooks/useOrgMembers.ts`

**Interfaces:**
- Consumes: Task 7 data-access.
- Produces: `useRemovedMembers(orgId)`, `useRestoreOrgMember(orgId)`, `useClearRemovedMember(orgId)`, `usePurgeRemovedUser(orgId)`. Every mutation invalidates BOTH `["members"]` and `["removed-members"]`.

- [ ] **Step 1: Extend the hooks file**

Add imports and hooks to `src/hooks/useOrgMembers.ts`:

```ts
import {
  fetchOrgMembers, removeOrgMember, setOrgMemberRole,
  fetchRemovedMembers, restoreOrgMember, clearRemovedMember, purgeRemovedUser,
} from "@/data/members";

/** Tombstones for an org's recently-removed members. */
export function useRemovedMembers(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["removed-members", orgId],
    enabled: !!orgId,
    queryFn: () => fetchRemovedMembers(supabase, orgId!),
  });
}

function useMembersMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members"] });
      qc.invalidateQueries({ queryKey: ["removed-members"] });
    },
  });
}

export const useRestoreOrgMember = (orgId: string) =>
  useMembersMutation((userId: string) => restoreOrgMember(supabase, orgId, userId));
export const useClearRemovedMember = (orgId: string) =>
  useMembersMutation((userId: string) => clearRemovedMember(supabase, orgId, userId));
export const usePurgeRemovedUser = (orgId: string) =>
  useMembersMutation((userId: string) => purgeRemovedUser(supabase, orgId, userId));
```

Also update the existing `useRemoveOrgMember` `onSuccess` to invalidate `["removed-members"]` too (a removal now creates a tombstone):

```ts
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members"] });
      qc.invalidateQueries({ queryKey: ["removed-members"] });
    },
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useOrgMembers.ts
git commit -m "feat: hooks for removed-member undo/clear/purge"
```

---

## Task 9: `RemovedPersonRow` + "Recently removed" group + dialogs in PeopleTab

**Files:**
- Create: `src/components/admin/people/RemovedPersonRow.tsx`
- Test: `src/components/admin/people/RemovedPersonRow.test.tsx`
- Modify: `src/components/admin/people/PeopleTab.tsx`

**Interfaces:**
- Consumes: `RemovedMember` (data), `useRemovedMembers`/`useRestoreOrgMember`/`useClearRemovedMember`/`usePurgeRemovedUser` (hooks), `toErrorMessage` (Task 6).
- Produces: `RemovedPersonRow` component.

- [ ] **Step 1: Write the failing component test**

Create `src/components/admin/people/RemovedPersonRow.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RemovedPersonRow } from "./RemovedPersonRow";
import type { RemovedMember } from "@/data/members";

const base: RemovedMember = {
  user_id: "u1", email: "t@t.test", display_name: "Tobias", roles: ["artist"],
  removed_at: "2026-08-11T09:00:00Z", removed_by_name: "David", deletable: false,
};

describe("RemovedPersonRow", () => {
  it("shows Clear from list when not deletable", () => {
    render(<RemovedPersonRow member={base} onUndo={vi.fn()} onClear={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: /clear from list/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete account/i })).not.toBeInTheDocument();
  });
  it("shows Delete account when deletable", () => {
    render(<RemovedPersonRow member={{ ...base, deletable: true }} onUndo={vi.fn()} onClear={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: /delete account/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/admin/people/RemovedPersonRow.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Write `RemovedPersonRow.tsx`**

```tsx
import { format } from "date-fns";
import { Undo2, UserMinus } from "lucide-react";
import { roleLabel } from "@/config/app.config";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { IconTooltip } from "@/components/common/IconTooltip";
import type { RemovedMember } from "@/data/members";

export interface RemovedPersonRowProps {
  member: RemovedMember;
  onUndo: (userId: string) => void;
  onClear: (m: RemovedMember) => void;
  onDelete: (m: RemovedMember) => void;
  undoPending?: boolean;
}

/** A dimmed tombstone row for the "Recently removed" subgroup. The trailing action is
 *  adaptive: Clear from list (dismiss) when the user is in other orgs, else Delete account. */
export function RemovedPersonRow({ member, onUndo, onClear, onDelete, undoPending = false }: RemovedPersonRowProps) {
  const who = member.display_name || member.email || member.user_id;
  const removed = format(new Date(member.removed_at), "dd/MM/yyyy");
  const by = member.removed_by_name ? ` by ${member.removed_by_name}` : "";
  return (
    <div role="listitem" className="flex flex-col gap-3 py-3 opacity-90 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar aria-hidden className="h-9 w-9">
          <AvatarFallback className="border border-dashed border-border bg-transparent text-muted-foreground">
            <UserMinus className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-sm font-medium text-muted-foreground" title={who}>{who}</p>
          <p className="truncate text-xs text-muted-foreground">
            {member.email ? `${member.email} · ` : ""}Removed {removed}{by}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-12 sm:flex-nowrap sm:justify-end sm:pl-0">
        <div className="hidden sm:flex sm:w-44 sm:justify-end">
          {member.roles.map((r) => (
            <Badge key={r} variant="outline" className="border-border/60 font-normal text-muted-foreground">
              was {roleLabel(r)}
            </Badge>
          ))}
        </div>
        <div className="flex items-center justify-end gap-1 sm:w-40">
          <IconTooltip label="Undo removal">
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs"
              disabled={undoPending} onClick={() => onUndo(member.user_id)}
              aria-label={`Undo removal of ${who}`}>
              <Undo2 className={`h-4 w-4 ${undoPending ? "animate-pulse" : ""}`} />Undo
            </Button>
          </IconTooltip>
          {member.deletable ? (
            <Button size="sm" variant="ghost"
              className="h-8 px-2.5 text-xs text-[var(--red-600)] hover:bg-[var(--red-100)]"
              onClick={() => onDelete(member)} aria-label={`Delete account of ${who}`}>
              Delete account
            </Button>
          ) : (
            <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs text-muted-foreground"
              onClick={() => onClear(member)} aria-label={`Clear ${who} from list`}>
              Clear from list
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

(`Undo2` and `UserMinus` are confirmed present in the installed `lucide-react`.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/admin/people/RemovedPersonRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the group + dialogs into PeopleTab**

In `PeopleTab.tsx`:
1. Import `useRemovedMembers, useRestoreOrgMember, useClearRemovedMember, usePurgeRemovedUser` from `@/hooks/useOrgMembers`; `RemovedPersonRow`; `RemovedMember` from `@/data/members`; `toErrorMessage` from `@/lib/errors`; `Input` (already imported).
2. Add state: `const [deleteTarget, setDeleteTarget] = useState<RemovedMember | null>(null);` and `const [deleteText, setDeleteText] = useState("");`.
3. Add data + mutations:
```tsx
const { data: removed } = useRemovedMembers(currentOrg?.id);
const restore = useRestoreOrgMember(currentOrg?.id ?? "");
const clearRemoved = useClearRemovedMember(currentOrg?.id ?? "");
const purge = usePurgeRemovedUser(currentOrg?.id ?? "");
const removedMembers = useMemo(() => removed ?? [], [removed]);
const filteredRemoved = useMemo(() => {
  const q = search.trim().toLowerCase();
  if (!q) return removedMembers;
  return removedMembers.filter((r) =>
    (r.display_name ?? "").toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q));
}, [search, removedMembers]);
```
4. Replace the existing remove `onSuccess` toast with a toast that offers Undo, and route errors through `toErrorMessage`:
```tsx
remove.mutate(target.user_id, {
  onSuccess: () => {
    const uid = target.user_id;
    toast.success("Member removed", { action: { label: "Undo", onClick: () => restore.mutate(uid) } });
  },
  onError: (e) => toast.error(toErrorMessage(e)),
});
```
5. Render the "Recently removed" group after the Members group (inside the same `CardContent`):
```tsx
{filteredRemoved.length > 0 && (
  <PeopleGroup label="Recently removed" count={filteredRemoved.length}>
    {filteredRemoved.map((m) => (
      <RemovedPersonRow
        key={m.user_id}
        member={m}
        undoPending={restore.isPending && restore.variables === m.user_id}
        onUndo={(uid) => restore.mutate(uid, {
          onSuccess: () => toast.success("Member restored"),
          onError: (e) => toast.error(toErrorMessage(e)),
        })}
        onClear={(rm) => clearRemoved.mutate(rm.user_id, {
          onSuccess: () => toast.success("Removed from list"),
          onError: (e) => toast.error(toErrorMessage(e)),
        })}
        onDelete={(rm) => { setDeleteTarget(rm); setDeleteText(""); }}
      />
    ))}
  </PeopleGroup>
)}
```
6. Update the empty-state condition so a workspace with only tombstones (no active people) still renders the group: change the `filteredPeople.length === 0` branch to also check `filteredRemoved.length === 0` before showing "No people yet."
7. Update the Remove confirm dialog copy to the approved wording:
```tsx
<AlertDialogDescription>
  {target?.email} loses access to this organization now. Their account, artist profile, and bookings are kept, and you can undo this from the list.
</AlertDialogDescription>
```
8. Add the Delete-account typed-confirm dialog (after the revoke dialog):
```tsx
<AlertDialog open={deleteTarget !== null}
  onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteText(""); } }}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete this account?</AlertDialogTitle>
      <AlertDialogDescription>
        {deleteTarget?.email} has no other organization, so this erases their account everywhere: login removed and personal data anonymized. This cannot be undone. Type{" "}
        <span className="font-medium">{deleteTarget?.email}</span> to confirm.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <Input placeholder={deleteTarget?.email ?? ""} value={deleteText} onChange={(e) => setDeleteText(e.target.value)} />
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        disabled={!deleteTarget || deleteText !== deleteTarget.email || purge.isPending}
        onClick={(e) => {
          e.preventDefault();
          if (!deleteTarget) return;
          const uid = deleteTarget.user_id;
          purge.mutate(uid, {
            onSuccess: (res) => {
              toast.success(res.retained ? "Removed from list (account kept)" : "Account deleted");
              setDeleteTarget(null); setDeleteText("");
            },
            onError: (err) => toast.error(toErrorMessage(err)),
          });
        }}>
        Delete account
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Note: `purge.mutate`'s `onSuccess` receives the mutation result — confirm `usePurgeRemovedUser`'s `mutationFn` returns the `{ deleted, retained }` object (it does, via `purgeRemovedUser`). React Query passes that as the first `onSuccess` arg.

- [ ] **Step 6: Add a PeopleTab render test for the group**

Append to `src/components/admin/people/PeopleTab.test.tsx` a test that seeds `useRemovedMembers` (via the query cache / provider fake used by the existing PeopleTab tests — follow the file's established seeding) with one deletable and one non-deletable tombstone, and asserts a "Recently removed" heading plus one "Delete account" and one "Clear from list" button. (Match the existing test's provider + supabase-fake setup; do not introduce `vi.mock`.)

- [ ] **Step 7: Run the People tests**

Run: `npx vitest run src/components/admin/people/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/admin/people
git commit -m "feat: Recently removed group with undo, clear, and safe-scoped delete"
```

---

## Task 10: Platform → Users fix (`UserDetailSheet.tsx`)

**Files:**
- Modify: `src/components/platform/UserDetailSheet.tsx`

**Interfaces:**
- Consumes: `friendlyError` (Task 6).

- [ ] **Step 1: Replace the masking formatter**

Delete the local `errorMessage` function (lines 45-47) and import the shared helper:

```tsx
import { friendlyError } from "@/lib/errors";
```

Replace every `errorMessage(e)` / `errorMessage(err)` call in the file with `friendlyError(e)` (they are all inside `toast.error(...)`). This un-masks the real reason and turns the last-admin guard into guidance.

- [ ] **Step 2: Disable removing an org's only admin**

In the membership card, compute whether this membership is the org's only admin from the drawer's own data and disable the Remove button with the inline reason. The drawer only holds the target user's memberships, not the org's full admin count, so gate on the safe signal it does have — the target holds the `admin` role in this org — and let the server stay the source of truth (the toast still guides if two admins race to one). Change the "Remove from org" button:

```tsx
{(() => {
  const isAdminHere = m.roles.includes("admin");
  return (
    <IconTooltip label={isAdminHere ? "Removing the admin role may leave the org without an admin; the server will block it if so" : "Remove from organization"}>
      <Button
        type="button" size="sm" variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => setOrgToRemove(m)}
      >
        Remove from org
      </Button>
    </IconTooltip>
  );
})()}
```

(Do NOT hard-disable — a multi-admin org must still allow removing one admin. The server guard + `friendlyError` toast is the authority; the tooltip sets expectations. `IconTooltip` is already imported.)

- [ ] **Step 3: Typecheck + existing tests**

Run: `npx tsc -p tsconfig.app.json --noEmit && npx vitest run src/components/platform/`
Expected: PASS (no `UserDetailSheet` test exists today; the typecheck + platform suite must stay green).

- [ ] **Step 4: Commit**

```bash
git add src/components/platform/UserDetailSheet.tsx
git commit -m "fix: surface real errors + last-admin guidance in Platform Users drawer"
```

---

## Task 11: Full verification + changelog decision

**Files:**
- (Possibly) Modify: `public/changelog.md`, `public/changelog.json`, `package.json`, `src/config/app.config.ts`

- [ ] **Step 1: Run the fast gate**

Run: `npm run verify:fast`
Expected: lint (0 warnings), tsc (all three projects), build, unit+coverage, Deno all PASS. Fix anything red before proceeding.

- [ ] **Step 2: Run the full gate (needs local stack)**

Run: `npm run verify:full`
Expected: adds pgTAP + Playwright e2e; PASS.

- [ ] **Step 3: Changelog**

The `/admin/people` removal UX is customer-facing. Ask the owner whether to add an "Improved" bullet + version bump (per CLAUDE.md, super-admin/platform changes never go in the changelog, so the Platform → Users fix is excluded either way). If yes: bump `package.json` + `APP_META.VERSION`, add a newest-first block to `public/changelog.md` (form `- **Title** — description`, no em-dashes), then `deno run --allow-read --allow-write scripts/changelog-to-json.ts`. If no, skip.

- [ ] **Step 4: Final commit (if changelog changed)**

```bash
git add public/changelog.md public/changelog.json package.json src/config/app.config.ts
git commit -m "docs: changelog for reversible member removal"
```

---

## Self-review notes (author)

- Spec coverage: table + 4 flows (Tasks 1-4), `deletable` flag (Task 1 `list_removed_members`), shared error helper (Task 6), Platform fix + guidance (Task 10), tests at all layers (Tasks 1-4, 6, 7, 9). All spec sections mapped.
- Reconciliation flags left for the implementer: (a) transcribe the CURRENT `anonymize_user` body when writing `_anonymize_user_data` — include the unsubscribe-token clear from `20260711011420` (the block in Task 3 reflects the known body but the live migration is authoritative); (b) match the existing `PeopleTab.test.tsx` provider/supabase-fake seeding in Task 9 Step 6 (the RemovedPersonRow unit test in Step 1 is the primary coverage of the adaptive-label logic; the PeopleTab test is an integration add-on). Verified against the codebase: `createFakeSupabase` API (Task 7), `Undo2`/`UserMinus` lucide icons (Task 9), sonner `toast.success(msg, { action })` (Task 9), the `["members", orgId]` query key, and every RPC/edge signature the migration introduces.
- Type consistency: RPC names (`list_removed_members`, `restore_org_member`, `clear_removed_member`, `admin_anonymize_removed_user`), function name (`org-purge-removed-user`), query keys (`["removed-members", orgId]`), and the `{ deleted, retained }` purge shape are used identically across backend, data, hooks, and UI tasks.
```
