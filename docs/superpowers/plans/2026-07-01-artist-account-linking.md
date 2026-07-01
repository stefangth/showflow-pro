# Artist ↔ account linking & status — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins invite an artist to an app login straight from the artist surface, link the resulting account deterministically via an FK on the invitation, and show a shared three-state account status (Active · Invited · No account) on artist cards and in the profile sheet.

**Architecture:** A new `org_invitations.artist_id` FK is stamped by `create-invitation` and consumed by `accept_invitation` to claim the exact artist row (email-match kept as a legacy fallback). A member-guarded `list_pending_invited_artists(p_org)` SECURITY DEFINER RPC exposes only the artist ids with a live pending invite, so producers see status without crossing the PII boundary. A pure `artistAccountState` helper drives one status vocabulary across the card chip and `LinkedAccountPanel`.

**Tech Stack:** React 18 + Vite + TS, @tanstack/react-query v5, react-hook-form + zod, Supabase (Postgres + edge functions Deno), vitest + jsdom, pgTAP, Deno test.

## Global Constraints

- **Local env is Deno-only.** `npx vitest run`, `npm run lint`, and pgTAP (`supabase test db`) execute in **CI only** — in "run the test" steps, show the real command and mark it `# (CI — not run locally)`. Deno edge tests DO run locally: `deno test --allow-all --node-modules-dir=none supabase/functions/<fn>/`.
- **Migrations** are applied via the Supabase MCP `apply_migration` (records real-timestamp version names); name migration files to match the applied version. NEVER hand-edit `supabase/migrations/*` or `src/integrations/supabase/types.ts` (auto-generated) by hand — regenerate types via the MCP `generate_typescript_types` after a migration.
- **Edge functions** use dependency injection: export `handle(req, deps)`, wire `Deno.serve` at the bottom; tests import `handle` + `makeFakeDeps` from `supabase/functions/_shared/testing.ts`; use `_shared/http.ts` (CORS/json), `_shared/auth.ts` (`requireOrgRole`). New functions need a `[functions.<name>]` block in `supabase/config.toml` (`create-invitation` already has one — no config change).
- **Frontend data-access pattern:** Supabase reads/writes live in `src/data/<domain>.ts` as `fetchX(client,args)`/`mutateX(client,args)`; hooks are thin wrappers passing the `supabase` singleton; test data-access with `src/test/supabaseFake.ts`, hooks/components with `src/test/renderWithProviders.tsx` + `src/test/fixtures.ts`. Never `vi.mock` the client.
- **Query keys** are hierarchical by domain; mutations invalidate the whole domain prefix. Use `['artists','pending-invites', orgId]` for the new RPC.
- **Styling:** semantic tokens only (`text-success`/`text-warning`/`text-muted-foreground`, etc.); never hardcode colors. Accent numbered stops don't support opacity modifiers.
- **Commit messages:** imperative, lowercase, ≤72 chars; conventional prefixes (`feat:`/`fix:`/`test:`/`docs:`).
- **Versioning:** user-facing → MINOR bump (`package.json` + `APP_META.VERSION` in `src/config/app.config.ts`), newest-first block in `public/changelog.md`, regenerate `public/changelog.json` via `deno run --allow-read --allow-write scripts/changelog-to-json.ts`. Final task covers this.

---

### Task 1: Migration — `org_invitations.artist_id` FK + index

**Files:**
- Create: `supabase/migrations/<applied-ts>_org_invitations_artist_id.sql`
- Modify (regenerate, do not hand-edit): `src/integrations/supabase/types.ts`

**Interfaces:**
- Produces: `org_invitations.artist_id uuid NULL` → FK `artists(id) ON DELETE SET NULL`; partial index `org_invitations_artist_id_idx`.
- Consumes: nothing.

Steps:

- [ ] Write the migration SQL. Author the file locally first (so it is committed), with this exact body:
  ```sql
  -- Spec A: deterministic artist↔account link. Stamp the target artist onto the
  -- invitation so accept_invitation can claim the exact row (email match kept as a
  -- legacy fallback). ON DELETE SET NULL → a deleted artist reverts the invite to
  -- the email-match path. No new RLS: artist_id is covered by the existing row-level
  -- org scoping / org_isolation on org_invitations.
  alter table public.org_invitations
    add column if not exists artist_id uuid
    references public.artists(id) on delete set null;

  create index if not exists org_invitations_artist_id_idx
    on public.org_invitations(artist_id)
    where artist_id is not null;
  ```
- [ ] Apply it via the Supabase MCP `apply_migration` with `name: "org_invitations_artist_id"` and the SQL above. Note the real-timestamp version it records.
- [ ] Rename the local file to match the applied version (`<recorded-ts>_org_invitations_artist_id.sql`) so the committed filename equals the applied version.
- [ ] Regenerate types via the MCP `generate_typescript_types`; overwrite `src/integrations/supabase/types.ts` with the output (never hand-edit).
- [ ] Verify the column exists: run the MCP `execute_sql` with
  `select column_name from information_schema.columns where table_schema='public' and table_name='org_invitations' and column_name='artist_id';` — expect one row.
- [ ] Commit: `feat: add org_invitations.artist_id fk + index`

---

### Task 2: Migration — recreate `accept_invitation` with `artist_id`-first link

**Files:**
- Create: `supabase/migrations/<applied-ts>_accept_invitation_artist_link.sql`
- Test: `supabase/tests/rpc/accept_invitation.sql` (extend existing)

**Interfaces:**
- Consumes: `org_invitations.artist_id` (Task 1); `auth.uid()`; `org_invitations` row.
- Produces: `accept_invitation(p_token text) returns uuid` — unchanged signature; now links `artists.user_id` by `artist_id` when present (guarded `user_id IS NULL`), else by lowercased email.

Steps:

- [ ] Extend the pgTAP test FIRST (test-first). Append to `supabase/tests/rpc/accept_invitation.sql`: bump `SELECT plan(6);` to `SELECT plan(10);`, and before `SELECT * FROM finish();` add these blocks (they exercise: id-stamped link, the no-op-when-user-already-owns-an-artist guard, and the legacy email path still working):
  ```sql
  -- === Spec A: artist_id-first linking ===
  -- Seed a second org, a fresh invitee C, an id-stamped artist, and a legacy artist.
  SET session_replication_role = replica;
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    ('aaaaaaaa-aaaa-ac03-0000-000000000000','authenticated','authenticated','accept-c@test.com', now(),'{"provider":"email"}','{}',now(),now()),
    ('aaaaaaaa-aaaa-ac04-0000-000000000000','authenticated','authenticated','accept-d@test.com', now(),'{"provider":"email"}','{}',now(),now());

  INSERT INTO public.organizations (id, name, slug)
  VALUES ('00000000-0000-0000-0000-0000000ac002','Accept Org 2','accept-org-2');

  -- Artist to be claimed by id (booking email deliberately DIFFERENT from login email).
  INSERT INTO public.artists (id, org_id, name, email, status)
  VALUES ('00000000-0000-0000-0000-0000000ar001','00000000-0000-0000-0000-0000000ac002','Idd Artist','booking-only@test.com','active');
  -- An artist already owned by user C in the same org (to trip the guard's no-op).
  INSERT INTO public.artists (id, org_id, name, email, status, user_id)
  VALUES ('00000000-0000-0000-0000-0000000ar002','00000000-0000-0000-0000-0000000ac002','Owned Artist','owned@test.com','active','aaaaaaaa-aaaa-ac03-0000-000000000000');
  -- id-stamped invite for user C.
  INSERT INTO public.org_invitations (org_id, email, role, token, status, artist_id)
  VALUES ('00000000-0000-0000-0000-0000000ac002','accept-c@test.com','artist','tok-accept-ccc','pending','00000000-0000-0000-0000-0000000ar001');

  -- Legacy (no artist_id) invite for user D + a matching-email artist.
  INSERT INTO public.artists (id, org_id, name, email, status)
  VALUES ('00000000-0000-0000-0000-0000000ar003','00000000-0000-0000-0000-0000000ac002','Legacy Artist','accept-d@test.com','active');
  INSERT INTO public.org_invitations (org_id, email, role, token, status)
  VALUES ('00000000-0000-0000-0000-0000000ac002','accept-d@test.com','artist','tok-accept-ddd','pending');
  SET session_replication_role = DEFAULT;

  -- 7. User C accepts the id-stamped invite → the exact artist is claimed by artist_id.
  SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-ac03-0000-000000000000","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  SELECT lives_ok(
    $$ SELECT public.accept_invitation('tok-accept-ccc') $$,
    'id-stamped invitee accepts');
  RESET ROLE;
  SELECT is(
    (SELECT user_id FROM public.artists WHERE id = '00000000-0000-0000-0000-0000000ar001'),
    'aaaaaaaa-aaaa-ac03-0000-000000000000'::uuid,
    'artist_id-stamped invite links the exact artist by id');

  -- 8. The guard no-ops: the artist C already owns is untouched (still owned by C).
  SELECT is(
    (SELECT user_id FROM public.artists WHERE id = '00000000-0000-0000-0000-0000000ar002'),
    'aaaaaaaa-aaaa-ac03-0000-000000000000'::uuid,
    'pre-owned artist is untouched (no unique-index violation)');

  -- 9. Legacy invitee D accepts (no artist_id) → email match still claims the row.
  SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-ac04-0000-000000000000","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  SELECT lives_ok(
    $$ SELECT public.accept_invitation('tok-accept-ddd') $$,
    'legacy invitee accepts');
  RESET ROLE;
  SELECT is(
    (SELECT user_id FROM public.artists WHERE id = '00000000-0000-0000-0000-0000000ar003'),
    'aaaaaaaa-aaaa-ac04-0000-000000000000'::uuid,
    'legacy email path still links by lowercased email');
  ```
- [ ] Run the pgTAP suite: `supabase test db` `# (CI — not run locally)` — expect **FAIL** (the function still only does the email path, so tests 7 and 8 fail: `ar001` has null `user_id`).
- [ ] Write the migration SQL. Author `supabase/migrations/<ts>_accept_invitation_artist_link.sql` locally with the full recreated function (email branch byte-for-byte identical to the current one; grants unchanged):
  ```sql
  -- Spec A: accept_invitation links the artist deterministically by artist_id when
  -- the invitation carries one, else falls back to the legacy lowercased-email match.
  -- The `user_id IS NULL` guard keeps accept idempotent and avoids tripping the
  -- artists(org_id, user_id) partial-unique index when the caller already owns an
  -- artist in the org (claim no-ops; membership still created). Signature/grants unchanged.
  create or replace function public.accept_invitation(p_token text)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_inv   public.org_invitations;
    v_uid   uuid := auth.uid();
    v_email text;
  begin
    if v_uid is null then
      raise exception 'Not authenticated' using errcode = '42501';
    end if;

    select email into v_email from auth.users where id = v_uid;

    select * into v_inv
    from public.org_invitations
    where token = p_token
      and status = 'pending'
      and expires_at > now()
    for update;

    if v_inv.id is null then
      raise exception 'Invalid or expired invitation' using errcode = 'P0002';
    end if;

    if lower(v_inv.email) <> lower(coalesce(v_email, '')) then
      raise exception 'Invitation was issued to a different email' using errcode = '42501';
    end if;

    insert into public.org_memberships (org_id, user_id, role)
    values (v_inv.org_id, v_uid, v_inv.role)
    on conflict (org_id, user_id, role) do nothing;

    if v_inv.artist_id is not null then
      -- Deterministic link by id. Guard: never re-claim an already-linked row.
      update public.artists a
         set user_id = v_uid
       where a.id = v_inv.artist_id
         and a.org_id = v_inv.org_id
         and a.user_id is null;
    else
      -- Legacy / Admin-tab invites: claim an unclaimed row by lowercased email.
      update public.artists a
         set user_id = v_uid
       where a.org_id = v_inv.org_id
         and a.user_id is null
         and lower(a.email) = lower(v_inv.email);
    end if;

    update public.org_invitations
    set status = 'accepted', accepted_at = now()
    where id = v_inv.id;

    return v_inv.org_id;
  end;
  $$;

  revoke all on function public.accept_invitation(text) from public;
  revoke all on function public.accept_invitation(text) from anon;
  grant execute on function public.accept_invitation(text) to authenticated;
  ```
- [ ] Apply via the MCP `apply_migration` with `name: "accept_invitation_artist_link"` and the SQL above; rename the local file to the recorded version.
- [ ] Run the pgTAP suite again: `supabase test db` `# (CI — not run locally)` — expect **PASS** (all 10 assertions).
- [ ] Commit: `feat: link accept_invitation by artist_id first`

---

### Task 3: Migration — `list_pending_invited_artists(p_org)` RPC

**Files:**
- Create: `supabase/migrations/<applied-ts>_list_pending_invited_artists.sql`
- Test: `supabase/tests/rpc/list_pending_invited_artists.sql`

**Interfaces:**
- Consumes: `org_invitations` (status/expires_at/artist_id/email), `artists` (id/org_id/email), `is_org_member(auth.uid(), p_org)`.
- Produces: `list_pending_invited_artists(p_org uuid) returns setof uuid` — distinct artist ids with a live pending invite (id-stamped OR legacy email-matched); `SECURITY DEFINER`, member-guarded; `grant execute to authenticated`.

Steps:

- [ ] Write the pgTAP test FIRST. Create `supabase/tests/rpc/list_pending_invited_artists.sql`:
  ```sql
  -- list_pending_invited_artists(p_org): member-guarded; returns distinct artist ids
  -- with a LIVE pending invite (id-stamped OR legacy email-matched); excludes
  -- expired/accepted/revoked; rejects non-members.
  BEGIN;
  CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
  SELECT plan(5);

  SET session_replication_role = replica;
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-0000000pm01','authenticated','authenticated','member@x.com',now(),'{"provider":"email"}','{}',now(),now()),
    ('00000000-0000-0000-0000-0000000pm02','authenticated','authenticated','outsider@x.com',now(),'{"provider":"email"}','{}',now(),now());
  INSERT INTO public.organizations (id, name, slug) VALUES
    ('00000000-0000-0000-0000-0000000pmc0','Pending Org','pending-org');
  INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
    ('00000000-0000-0000-0000-0000000pmc0','00000000-0000-0000-0000-0000000pm01','producer');

  -- a1: id-stamped live invite. a2: legacy email-matched live invite.
  -- a3: expired invite (excluded). a4: accepted invite (excluded). a5: no invite.
  INSERT INTO public.artists (id, org_id, name, email, status) VALUES
    ('00000000-0000-0000-0000-0000000pa01','00000000-0000-0000-0000-0000000pmc0','A1','a1-booking@x.com','active'),
    ('00000000-0000-0000-0000-0000000pa02','00000000-0000-0000-0000-0000000pmc0','A2','a2@x.com','active'),
    ('00000000-0000-0000-0000-0000000pa03','00000000-0000-0000-0000-0000000pmc0','A3','a3@x.com','active'),
    ('00000000-0000-0000-0000-0000000pa04','00000000-0000-0000-0000-0000000pmc0','A4','a4@x.com','active'),
    ('00000000-0000-0000-0000-0000000pa05','00000000-0000-0000-0000-0000000pmc0','A5','a5@x.com','active');

  INSERT INTO public.org_invitations (org_id, email, role, token, status, expires_at, artist_id) VALUES
    ('00000000-0000-0000-0000-0000000pmc0','a1-login@x.com','artist','tok-pa1','pending', now() + interval '7 days','00000000-0000-0000-0000-0000000pa01'),
    ('00000000-0000-0000-0000-0000000pmc0','a2@x.com',      'artist','tok-pa2','pending', now() + interval '7 days', null),
    ('00000000-0000-0000-0000-0000000pmc0','a3@x.com',      'artist','tok-pa3','pending', now() - interval '1 day',  null),
    ('00000000-0000-0000-0000-0000000pmc0','a4@x.com',      'artist','tok-pa4','accepted',now() + interval '7 days', null);
  SET session_replication_role = DEFAULT;

  SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000pm01","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;

  -- 1. Returns the id-stamped artist.
  SELECT ok(
    '00000000-0000-0000-0000-0000000pa01' IN (SELECT public.list_pending_invited_artists('00000000-0000-0000-0000-0000000pmc0')),
    'includes the id-stamped artist');
  -- 2. Returns the legacy email-matched artist.
  SELECT ok(
    '00000000-0000-0000-0000-0000000pa02' IN (SELECT public.list_pending_invited_artists('00000000-0000-0000-0000-0000000pmc0')),
    'includes the legacy email-matched artist');
  -- 3. Excludes expired + accepted + no-invite artists (only a1,a2 remain).
  SELECT is(
    (SELECT count(*)::int FROM public.list_pending_invited_artists('00000000-0000-0000-0000-0000000pmc0')),
    2, 'excludes expired / accepted / uninvited');
  RESET ROLE;

  -- 4. Non-member is rejected.
  SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000pm02","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT throws_ok(
    $$ SELECT public.list_pending_invited_artists('00000000-0000-0000-0000-0000000pmc0') $$,
    '42501', null, 'non-member is rejected');
  RESET ROLE;

  -- 5. anon has no execute privilege.
  SELECT is(
    has_function_privilege('anon','public.list_pending_invited_artists(uuid)','execute'),
    false, 'anon cannot execute the RPC');

  SELECT * FROM finish();
  ROLLBACK;
  ```
- [ ] Run the pgTAP suite: `supabase test db` `# (CI — not run locally)` — expect **FAIL** (function does not exist yet).
- [ ] Write the migration SQL. Create `supabase/migrations/<ts>_list_pending_invited_artists.sql`:
  ```sql
  -- Spec A: member-guarded status feed for the artist-card chip. Returns only the
  -- artist ids (non-PII) in p_org that have a LIVE pending invite — id-stamped or
  -- legacy email-matched — so producers can see "Invited" without any invitation PII
  -- crossing the ADR-0011 boundary. "Active" needs no RPC (it's artists.user_id).
  create or replace function public.list_pending_invited_artists(p_org uuid)
  returns setof uuid
  language plpgsql
  stable
  security definer
  set search_path = public
  as $$
  begin
    if not public.is_org_member(auth.uid(), p_org) then
      raise exception 'Forbidden: org members only' using errcode = '42501';
    end if;
    return query
      select distinct a.id
      from public.artists a
      join public.org_invitations i
        on i.org_id = a.org_id
       and i.status = 'pending'
       and i.expires_at > now()
       and (
         i.artist_id = a.id
         or (i.artist_id is null and lower(i.email) = lower(a.email))
       )
      where a.org_id = p_org;
  end;
  $$;

  revoke all on function public.list_pending_invited_artists(uuid) from public, anon;
  grant execute on function public.list_pending_invited_artists(uuid) to authenticated;
  ```
- [ ] Apply via the MCP `apply_migration` with `name: "list_pending_invited_artists"`; rename the local file to the recorded version.
- [ ] Regenerate types via the MCP `generate_typescript_types` and overwrite `src/integrations/supabase/types.ts` (the RPC now appears under `Functions`).
- [ ] Run the pgTAP suite again: `supabase test db` `# (CI — not run locally)` — expect **PASS** (5 assertions).
- [ ] Commit: `feat: add list_pending_invited_artists rpc`

---

### Task 4: Edge fn — `create-invitation` accepts optional `artist_id`

**Files:**
- Modify: `supabase/functions/create-invitation/index.ts`
- Test: `supabase/functions/create-invitation/index.di.test.ts`

**Interfaces:**
- Consumes: body `{ org_id, email, role, app_origin, artist_id? }`; `deps.admin`; `requireOrgRole(deps, req, org_id, ['admin'])`.
- Produces: on valid `artist_id` → inserts `org_invitations` row with `artist_id` + forces `role: 'artist'`; rejects (`400`) when the artist is missing, cross-org, or already has `user_id`.

Steps:

- [ ] Write the failing DI tests FIRST. Append to `supabase/functions/create-invitation/index.di.test.ts`:
  ```ts
  Deno.test("create-invitation DI: valid artist_id → stamps artist_id + forces role artist", async () => {
    const { deps, calls } = makeFakeDeps({
      authUser: { id: "u1" },
      usersById: { u1: { email: "admin@acme.test" } },
      tables: {
        org_memberships: { data: { role: "admin" }, error: null },
        artists: { data: { id: "art-1", org_id: "org-1", user_id: null }, error: null },
        org_invitations: {
          data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "artist", status: "pending", token: "tok123", expires_at: "2099-01-01T00:00:00Z" },
          error: null,
        },
        organizations: { data: { name: "Acme" }, error: null },
      },
    });
    // role 'producer' in the body must be overridden to 'artist' when artist_id is present.
    const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer", artist_id: "art-1" }), deps);
    assertEquals(res.status, 200);
    const insert = calls.find((c) => c.table === "org_invitations" && c.method === "insert");
    assertExists(insert);
    assertEquals(insert.args[0], { org_id: "org-1", email: "invitee@x.com", role: "artist", invited_by: "u1", artist_id: "art-1" });
  });

  Deno.test("create-invitation DI: artist_id from another org → 400", async () => {
    const { deps } = makeFakeDeps({
      authUser: { id: "u1" },
      usersById: { u1: { email: "admin@acme.test" } },
      tables: {
        org_memberships: { data: { role: "admin" }, error: null },
        artists: { data: { id: "art-1", org_id: "other-org", user_id: null }, error: null },
      },
    });
    const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "artist", artist_id: "art-1" }), deps);
    assertEquals(res.status, 400);
  });

  Deno.test("create-invitation DI: artist_id already registered → 400", async () => {
    const { deps } = makeFakeDeps({
      authUser: { id: "u1" },
      usersById: { u1: { email: "admin@acme.test" } },
      tables: {
        org_memberships: { data: { role: "admin" }, error: null },
        artists: { data: { id: "art-1", org_id: "org-1", user_id: "u9" }, error: null },
      },
    });
    const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "artist", artist_id: "art-1" }), deps);
    assertEquals(res.status, 400);
  });

  Deno.test("create-invitation DI: no artist_id → legacy insert has no artist_id key", async () => {
    const { deps, calls } = adminDeps();
    await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
    const insert = calls.find((c) => c.table === "org_invitations" && c.method === "insert");
    assertExists(insert);
    assertEquals(Object.prototype.hasOwnProperty.call(insert.args[0] as object, "artist_id"), false);
  });
  ```
- [ ] Run the test: `deno test --allow-all --node-modules-dir=none supabase/functions/create-invitation/` — expect **FAIL** (handler ignores `artist_id`).
- [ ] Implement. In `supabase/functions/create-invitation/index.ts`, add `artist_id?: string` to `Body`, then after the `requireOrgRole` block (right after `const admin = deps.admin;`) insert the validation and compute the insert row:
  ```ts
    // Optional artist_id: deterministic link. Validate against the service client;
    // force role 'artist' when linking from the artist surface.
    let role = body.role;
    const artistId = typeof body.artist_id === "string" ? body.artist_id : undefined;
    if (artistId) {
      const { data: artist } = await admin
        .from("artists").select("id, org_id, user_id").eq("id", artistId).maybeSingle();
      if (!artist || (artist as { org_id: string }).org_id !== body.org_id) {
        return json({ error: "Artist not found in this organization" }, 400);
      }
      if ((artist as { user_id: string | null }).user_id) {
        return json({ error: "That artist already has an account" }, 400);
      }
      role = "artist";
    }

    const insertRow: Record<string, unknown> = { org_id: body.org_id, email, role, invited_by: auth.userId };
    if (artistId) insertRow.artist_id = artistId;
  ```
  Then change the insert call to use `insertRow` and read `artist_id` back:
  ```ts
    const { data: invite, error: insErr } = await admin
      .from('org_invitations')
      .insert(insertRow)
      .select('id, org_id, email, role, status, token, expires_at, artist_id')
      .single();
  ```
  And update the delivery `role:` field to use `invite.role` (already does). Leave the rest untouched.
- [ ] Run the test: `deno test --allow-all --node-modules-dir=none supabase/functions/create-invitation/` — expect **PASS** (all DI cases, old + new).
- [ ] Run the whole edge suite to catch regressions: `deno test --allow-all --node-modules-dir=none supabase/functions/` — expect **PASS**.
- [ ] Commit: `feat: create-invitation accepts optional artist_id`

---

### Task 5: Pure helper — `src/lib/artistAccount.ts`

**Files:**
- Create: `src/lib/artistAccount.ts`
- Test: `src/lib/artistAccount.test.ts`

**Interfaces:**
- Consumes: `{ user_id: string | null }` (partial artist row), `pendingSet: Set<string>`.
- Produces: `artistAccountState(artist, pendingSet): 'active' | 'invited' | 'none'`; `ACCOUNT_STATE_META: Record<AccountState, { label: string; dotClass: string }>`.

Steps:

- [ ] Write the failing test FIRST. Create `src/lib/artistAccount.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { artistAccountState, ACCOUNT_STATE_META } from "./artistAccount";

  describe("artistAccountState", () => {
    const pending = new Set<string>(["a-invited"]);

    it("returns 'active' when the artist has a user_id", () => {
      expect(artistAccountState({ id: "a-active", user_id: "u1" }, pending)).toBe("active");
    });

    it("active wins even if a stale pending id is present", () => {
      const stale = new Set<string>(["a-active"]);
      expect(artistAccountState({ id: "a-active", user_id: "u1" }, stale)).toBe("active");
    });

    it("returns 'invited' when unregistered but in the pending set", () => {
      expect(artistAccountState({ id: "a-invited", user_id: null }, pending)).toBe("invited");
    });

    it("returns 'none' when unregistered and not pending", () => {
      expect(artistAccountState({ id: "a-none", user_id: null }, pending)).toBe("none");
    });

    it("exposes a label + dot token for every state", () => {
      expect(ACCOUNT_STATE_META.active.label).toBe("Active account");
      expect(ACCOUNT_STATE_META.invited.label).toBe("Invite pending");
      expect(ACCOUNT_STATE_META.none.label).toBe("No account");
      expect(ACCOUNT_STATE_META.active.dotClass).toContain("success");
      expect(ACCOUNT_STATE_META.invited.dotClass).toContain("warning");
      expect(ACCOUNT_STATE_META.none.dotClass).toContain("muted");
    });
  });
  ```
- [ ] Run the test: `npx vitest run src/lib/artistAccount.test.ts` `# (CI — not run locally)` — expect **FAIL** (module missing).
- [ ] Implement. Create `src/lib/artistAccount.ts`:
  ```ts
  export type AccountState = "active" | "invited" | "none";

  /**
   * Three-state account status shared by the artist card chip and LinkedAccountPanel.
   * `active` (has a login) always wins; `invited` requires a live pending invite id
   * (from list_pending_invited_artists); otherwise `none`.
   */
  export function artistAccountState(
    artist: { id: string; user_id: string | null },
    pendingSet: Set<string>,
  ): AccountState {
    if (artist.user_id) return "active";
    if (pendingSet.has(artist.id)) return "invited";
    return "none";
  }

  /** Presentational map: one vocabulary + semantic dot token per state. */
  export const ACCOUNT_STATE_META: Record<AccountState, { label: string; dotClass: string }> = {
    active: { label: "Active account", dotClass: "bg-success" },
    invited: { label: "Invite pending", dotClass: "bg-warning" },
    none: { label: "No account", dotClass: "bg-muted-foreground" },
  };
  ```
- [ ] Run the test: `npx vitest run src/lib/artistAccount.test.ts` `# (CI — not run locally)` — expect **PASS**.
- [ ] Commit: `feat: add artistAccountState helper`

---

### Task 6: Data-access — pending ids + artist-invite caller

**Files:**
- Modify: `src/data/artists.ts`, `src/data/invitations.ts`
- Test: `src/data/artists.test.ts`, `src/data/invitations.test.ts`

**Interfaces:**
- Produces:
  - `fetchPendingInvitedArtistIds(client, orgId): Promise<string[]>` → `rpc('list_pending_invited_artists', { p_org: orgId })`.
  - `createInvitation(client, { orgId, email, role, artistId? })` — extend existing signature with optional `artistId`, forwarded as `artist_id` in the body.
  - `inviteArtistToApp(client, { orgId, artistId, email }): Promise<Invitation>` → `createInvitation(..., { role: 'artist', artistId })`.

Steps:

- [ ] Write the failing data-access tests FIRST. Append to `src/data/artists.test.ts`:
  ```ts
  import { fetchPendingInvitedArtistIds } from "./artists";

  describe("fetchPendingInvitedArtistIds", () => {
    it("calls the list_pending_invited_artists rpc with p_org and returns ids", async () => {
      const fake = createFakeSupabase({ "rpc:list_pending_invited_artists": { data: ["a1", "a2"], error: null } });
      const ids = await fetchPendingInvitedArtistIds(fake as never, "o1");
      expect(ids).toEqual(["a1", "a2"]);
      expect(fake.calls).toContainEqual({ table: "rpc:list_pending_invited_artists", method: "rpc", args: [{ p_org: "o1" }] });
    });

    it("returns [] when the rpc yields null", async () => {
      const fake = createFakeSupabase({ "rpc:list_pending_invited_artists": { data: null, error: null } });
      expect(await fetchPendingInvitedArtistIds(fake as never, "o1")).toEqual([]);
    });

    it("throws on error", async () => {
      const fake = createFakeSupabase({ "rpc:list_pending_invited_artists": { data: null, error: { message: "boom" } } });
      await expect(fetchPendingInvitedArtistIds(fake as never, "o1")).rejects.toBeTruthy();
    });
  });
  ```
  And append to `src/data/invitations.test.ts`:
  ```ts
  import { inviteArtistToApp } from "./invitations";

  describe("createInvitation with artistId", () => {
    it("forwards artist_id in the function body when provided", async () => {
      const fake = createFakeSupabase({ "fn:create-invitation": { data: { invitation: INV }, error: null } });
      await createInvitation(fake as never, { orgId: "o1", email: "x@y.com", role: "artist", artistId: "art-1" });
      expect(fake.calls).toContainEqual({
        table: "fn:create-invitation",
        method: "invoke",
        args: [{ org_id: "o1", email: "x@y.com", role: "artist", app_origin: window.location.origin, artist_id: "art-1" }],
      });
    });
  });

  describe("inviteArtistToApp", () => {
    it("calls create-invitation with role artist + the artist_id", async () => {
      const fake = createFakeSupabase({ "fn:create-invitation": { data: { invitation: INV }, error: null } });
      const result = await inviteArtistToApp(fake as never, { orgId: "o1", artistId: "art-1", email: "x@y.com" });
      expect(result).toEqual(INV);
      expect(fake.calls).toContainEqual({
        table: "fn:create-invitation",
        method: "invoke",
        args: [{ org_id: "o1", email: "x@y.com", role: "artist", app_origin: window.location.origin, artist_id: "art-1" }],
      });
    });
  });
  ```
- [ ] Run: `npx vitest run src/data/artists.test.ts src/data/invitations.test.ts` `# (CI — not run locally)` — expect **FAIL** (functions/param missing).
- [ ] Implement `fetchPendingInvitedArtistIds`. Append to `src/data/artists.ts`:
  ```ts
  /** Artist ids in an org with a live pending app-login invite (member-guarded RPC). */
  export async function fetchPendingInvitedArtistIds(
    client: SupabaseClient<Database>,
    orgId: string,
  ): Promise<string[]> {
    const { data, error } = await client.rpc("list_pending_invited_artists", { p_org: orgId });
    if (error) throw error;
    return (data ?? []) as string[];
  }
  ```
- [ ] Implement the `invitations.ts` changes. Extend `createInvitation`'s args type and body, then add `inviteArtistToApp`:
  ```ts
  export async function createInvitation(
    client: SupabaseClient<Database>,
    args: { orgId: string; email: string; role: AppRole; artistId?: string },
  ): Promise<Invitation> {
    const body: Record<string, unknown> = {
      org_id: args.orgId, email: args.email, role: args.role, app_origin: window.location.origin,
    };
    if (args.artistId) body.artist_id = args.artistId;
    const { data, error } = await client.functions.invoke("create-invitation", { body });
    if (error) throw error;
    const payload = data as { error?: string; invitation?: Invitation };
    if (payload?.error) throw new Error(payload.error);
    if (!payload?.invitation) throw new Error("Invitation was not created");
    return payload.invitation;
  }

  /** Invite an existing artist to an app login (always role 'artist', id-linked). */
  export async function inviteArtistToApp(
    client: SupabaseClient<Database>,
    args: { orgId: string; artistId: string; email: string },
  ): Promise<Invitation> {
    return createInvitation(client, { orgId: args.orgId, email: args.email, role: "artist", artistId: args.artistId });
  }
  ```
  (Replace the existing `createInvitation` body with the version above.)
- [ ] Run: `npx vitest run src/data/artists.test.ts src/data/invitations.test.ts` `# (CI — not run locally)` — expect **PASS** (old + new).
- [ ] Commit: `feat: add pending-invite + artist-invite data access`

---

### Task 7: Hook — `usePendingInvitedArtists(orgId)`

**Files:**
- Create: `src/hooks/usePendingInvitedArtists.ts`
- Test: `src/hooks/usePendingInvitedArtists.test.ts`

**Interfaces:**
- Consumes: `fetchPendingInvitedArtistIds(supabase, orgId)` (Task 6); `orgId: string | null | undefined`.
- Produces: `usePendingInvitedArtists(orgId)` → `UseQueryResult<string[]>` with key `['artists','pending-invites', orgId]`, `enabled: !!orgId`.

Steps:

- [ ] Write the failing hook test FIRST. Create `src/hooks/usePendingInvitedArtists.test.ts`:
  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { waitFor } from "@testing-library/react";
  import { renderHookWithProviders } from "@/test/renderWithProviders";
  import { createFakeSupabase } from "@/test/supabaseFake";

  const fake = createFakeSupabase({ "rpc:list_pending_invited_artists": { data: ["a1", "a2"], error: null } });
  vi.mock("@/integrations/supabase/client", () => ({ supabase: fake }));

  import { usePendingInvitedArtists } from "./usePendingInvitedArtists";

  describe("usePendingInvitedArtists", () => {
    beforeEach(() => { fake.calls.length = 0; });

    it("returns the pending ids for an org", async () => {
      const { result } = renderHookWithProviders(() => usePendingInvitedArtists("o1"));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(["a1", "a2"]);
      expect(fake.calls).toContainEqual({ table: "rpc:list_pending_invited_artists", method: "rpc", args: [{ p_org: "o1" }] });
    });

    it("stays disabled without an orgId", () => {
      const { result } = renderHookWithProviders(() => usePendingInvitedArtists(null));
      expect(result.current.fetchStatus).toBe("idle");
    });
  });
  ```
  (Mocking the singleton module is the established hook-test pattern — data-access functions themselves are tested against the fake without `vi.mock`; hooks that read the singleton mock the module import only.)
- [ ] Run: `npx vitest run src/hooks/usePendingInvitedArtists.test.ts` `# (CI — not run locally)` — expect **FAIL** (hook missing).
- [ ] Implement. Create `src/hooks/usePendingInvitedArtists.ts`:
  ```ts
  import { useQuery } from "@tanstack/react-query";
  import { supabase } from "@/integrations/supabase/client";
  import { fetchPendingInvitedArtistIds } from "@/data/artists";

  /** Artist ids in the org with a live pending app-login invite (drives the card chip). */
  export function usePendingInvitedArtists(orgId: string | null | undefined) {
    return useQuery({
      queryKey: ["artists", "pending-invites", orgId],
      enabled: !!orgId,
      queryFn: () => fetchPendingInvitedArtistIds(supabase, orgId!),
    });
  }
  ```
- [ ] Run: `npx vitest run src/hooks/usePendingInvitedArtists.test.ts` `# (CI — not run locally)` — expect **PASS**.
- [ ] Commit: `feat: add usePendingInvitedArtists hook`

---

### Task 8a: `AccountStatusChip` component

**Files:**
- Create: `src/components/artists/AccountStatusChip.tsx`
- Test: `src/components/artists/AccountStatusChip.test.tsx`

**Interfaces:**
- Consumes: `{ state: AccountState }` from `@/lib/artistAccount`.
- Produces: a quiet dot + label chip using `ACCOUNT_STATE_META`; semantic tokens only.

Steps:

- [ ] Write the failing component test FIRST. Create `src/components/artists/AccountStatusChip.test.tsx`:
  ```tsx
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { AccountStatusChip } from "./AccountStatusChip";

  describe("AccountStatusChip", () => {
    it("renders the Active label", () => {
      render(<AccountStatusChip state="active" />);
      expect(screen.getByText("Active account")).toBeInTheDocument();
    });
    it("renders the Invited label", () => {
      render(<AccountStatusChip state="invited" />);
      expect(screen.getByText("Invite pending")).toBeInTheDocument();
    });
    it("renders the None label", () => {
      render(<AccountStatusChip state="none" />);
      expect(screen.getByText("No account")).toBeInTheDocument();
    });
  });
  ```
- [ ] Run: `npx vitest run src/components/artists/AccountStatusChip.test.tsx` `# (CI — not run locally)` — expect **FAIL** (component missing).
- [ ] Implement. Create `src/components/artists/AccountStatusChip.tsx`:
  ```tsx
  import { ACCOUNT_STATE_META, type AccountState } from "@/lib/artistAccount";

  /** Quiet dot + label account-status chip (shared vocabulary; semantic tokens). */
  export function AccountStatusChip({ state }: { state: AccountState }) {
    const meta = ACCOUNT_STATE_META[state];
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} aria-hidden="true" />
        {meta.label}
      </span>
    );
  }
  ```
- [ ] Run: `npx vitest run src/components/artists/AccountStatusChip.test.tsx` `# (CI — not run locally)` — expect **PASS**.
- [ ] Commit: `feat: add AccountStatusChip component`

---

### Task 8b: `ArtistsPage` — chip, inline invite, Add-Artist checkbox

**Files:**
- Modify: `src/pages/ArtistsPage.tsx`
- Test: `src/pages/ArtistsPage.accountStatus.test.tsx`

**Interfaces:**
- Consumes: `usePendingInvitedArtists(currentOrg?.id)`, `artistAccountState`, `AccountStatusChip`, `inviteArtistToApp`.
- Produces: a chip per card; an inline **Invite** button on `none`-state cards (admin-only); an "Also send an app-login invite" checkbox in the Add-Artist dialog (email required when checked; insert→invite with partial-success toast).

Steps:

- [ ] Write the failing component test FIRST. Create `src/pages/ArtistsPage.accountStatus.test.tsx` (mock the singleton + auth so cards render deterministically):
  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { screen, waitFor } from "@testing-library/react";
  import { renderWithProviders } from "@/test/renderWithProviders";

  const artists = [
    { id: "a-active", name: "Ann Active", email: "ann@x.com", status: "active", user_id: "u1", org_id: "o1" },
    { id: "a-invited", name: "Ivy Invited", email: "ivy@x.com", status: "active", user_id: null, org_id: "o1" },
    { id: "a-none", name: "Ned None", email: "ned@x.com", status: "active", user_id: null, org_id: "o1" },
  ];
  const fake = {
    calls: [] as unknown[],
    from() {
      return {
        select() { return this; },
        order() { return Promise.resolve({ data: artists, error: null }); },
        neq() { return Promise.resolve({ data: [], error: null }); },
      };
    },
    rpc(name: string) {
      if (name === "list_pending_invited_artists") return Promise.resolve({ data: ["a-invited"], error: null });
      return Promise.resolve({ data: [], error: null });
    },
  };
  vi.mock("@/integrations/supabase/client", () => ({ supabase: fake }));
  vi.mock("@/features/auth/AuthContext", () => ({
    useAuth: () => ({ hasRole: () => true, currentOrg: { id: "o1" } }),
  }));
  vi.mock("@/features/editor/EditorContext", () => ({ useEditorConfig: () => ({ isEditorMode: false }) }));

  import ArtistsPage from "./ArtistsPage";

  describe("ArtistsPage account status chips", () => {
    it("shows Active / Invite pending / No account per artist state", async () => {
      renderWithProviders(<ArtistsPage />);
      await waitFor(() => expect(screen.getByText("Ann Active")).toBeInTheDocument());
      expect(screen.getByText("Active account")).toBeInTheDocument();
      expect(screen.getByText("Invite pending")).toBeInTheDocument();
      expect(screen.getByText("No account")).toBeInTheDocument();
    });
  });
  ```
  (If mocking the chained builder proves brittle, prefer `createFakeSupabase` with per-table seeds; the intent — three chips from three states — is the contract.)
- [ ] Run: `npx vitest run src/pages/ArtistsPage.accountStatus.test.tsx` `# (CI — not run locally)` — expect **FAIL** (no chips rendered).
- [ ] Implement the imports + pending set. Add near the top imports of `src/pages/ArtistsPage.tsx`:
  ```tsx
  import { Checkbox } from '@/components/ui/checkbox';
  import { usePendingInvitedArtists } from '@/hooks/usePendingInvitedArtists';
  import { artistAccountState } from '@/lib/artistAccount';
  import { AccountStatusChip } from '@/components/artists/AccountStatusChip';
  import { inviteArtistToApp } from '@/data/invitations';
  ```
  Add form state for the invite checkbox alongside the existing `form` state:
  ```tsx
  const [alsoInvite, setAlsoInvite] = useState(false);
  const { data: pendingIds } = usePendingInvitedArtists(currentOrg?.id);
  const pendingSet = useMemo(() => new Set(pendingIds ?? []), [pendingIds]);
  ```
- [ ] Implement the Add-Artist flow. Replace the `createArtist` mutation's `mutationFn` and `onSuccess` so it inserts then optionally invites, with partial-success handling:
  ```tsx
  const createArtist = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error('No active organization');
      if (alsoInvite && !form.email.trim()) throw new Error('Email is required to send an invite');
      const { data: inserted, error } = await supabase.from('artists').insert({
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        bio: form.bio || null,
        org_id: currentOrg.id,
      }).select('id').single();
      if (error) throw error;
      if (alsoInvite && inserted) {
        try {
          await inviteArtistToApp(supabase, { orgId: currentOrg.id, artistId: inserted.id, email: form.email });
        } catch (e) {
          return { inviteFailed: true } as const; // keep the artist; warn below
        }
      }
      return { inviteFailed: false } as const;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['artists'] });
      queryClient.invalidateQueries({ queryKey: ['artists', 'pending-invites'] });
      setDialogOpen(false);
      setForm({ name: '', email: '', phone: '', bio: '' });
      setAlsoInvite(false);
      if (res?.inviteFailed) {
        toast({ title: 'Artist created', description: "The invite couldn't be sent — retry from the artist.", variant: 'destructive' });
      } else {
        toast({ title: alsoInvite ? 'Artist added and invited' : 'Artist added' });
      }
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });
  ```
- [ ] Implement the checkbox in the dialog form. In the Add-Artist `<form>`, after the Bio `<Textarea>` and before the skills helper `<p>`, insert:
  ```tsx
  <div className="flex items-start gap-2 rounded-md border border-border p-3">
    <Checkbox id="also-invite" checked={alsoInvite} onCheckedChange={(v) => setAlsoInvite(!!v)} />
    <div className="space-y-1">
      <label htmlFor="also-invite" className="text-sm font-medium leading-none">Also send an app-login invite</label>
      {alsoInvite && (
        <p className="text-xs text-muted-foreground">They'll get an email to set a password and join as an artist. Email is required.</p>
      )}
    </div>
  </div>
  ```
  And make email required when checked by adding `required={alsoInvite}` to the email `<Input>` in that dialog.
- [ ] Implement the card chip + inline invite. Replace the status `<Badge>` block on the card with the existing status badge **plus** the account chip, and add an inline Invite affordance for `none`. Inside the card `CardContent`, change the header row's right side and add a chip row below the name block:
  ```tsx
  {(() => {
    const state = artistAccountState(artist, pendingSet);
    return (
      <div className="flex flex-col items-end gap-2">
        <Badge variant="secondary" className={statusColor[artist.status] ?? ''}>{artist.status}</Badge>
        <AccountStatusChip state={state} />
        {state === 'none' && hasRole('admin') && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={(e) => { e.stopPropagation(); inviteExisting.mutate(artist); }}
            disabled={inviteExisting.isPending}
          >
            Invite
          </Button>
        )}
      </div>
    );
  })()}
  ```
  Add the `inviteExisting` mutation next to `createArtist` (prefills the booking email; requires one; optimistic invalidation):
  ```tsx
  const inviteExisting = useMutation({
    mutationFn: async (artist: Artist) => {
      if (!currentOrg) throw new Error('No active organization');
      if (!artist.email) throw new Error('This artist has no email — add one before inviting.');
      await inviteArtistToApp(supabase, { orgId: currentOrg.id, artistId: artist.id, email: artist.email });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists', 'pending-invites'] });
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      toast({ title: 'Invite sent' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });
  ```
  (The existing header `<div className="flex items-start justify-between mb-3">` right-hand `<Badge>` is what gets replaced by the block above.)
- [ ] Run: `npx vitest run src/pages/ArtistsPage.accountStatus.test.tsx` `# (CI — not run locally)` — expect **PASS**.
- [ ] Commit: `feat: artist card account chip + invite affordances`

---

### Task 8c: `LinkedAccountPanel` — unified vocabulary + Invite/Resend

**Files:**
- Modify: `src/components/artists/LinkedAccountPanel.tsx`, `src/components/artists/ArtistProfileSheet.tsx`
- Test: `src/components/artists/LinkedAccountPanel.test.tsx`

**Interfaces:**
- Consumes (new props): `state: AccountState`, `canInvite: boolean`, `onInvite?: () => void`, `onResend?: () => void`, `inviteBusy?: boolean`.
- Produces: same panel driven by `ACCOUNT_STATE_META`; `none` → **Invite to app** button; `invited` → **Invited · Resend**.

Steps:

- [ ] Write the failing component test FIRST. Create `src/components/artists/LinkedAccountPanel.test.tsx`:
  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen, fireEvent } from "@testing-library/react";
  import { LinkedAccountPanel } from "./LinkedAccountPanel";

  describe("LinkedAccountPanel", () => {
    it("active state shows the shared 'Active account' vocabulary", () => {
      render(<LinkedAccountPanel state="active" userId="u1" bookingEmail="b@x.com" canSeeAccount={false} canInvite={false} />);
      expect(screen.getByText("Active account")).toBeInTheDocument();
    });
    it("none state shows an Invite to app button when canInvite", () => {
      const onInvite = vi.fn();
      render(<LinkedAccountPanel state="none" userId={null} bookingEmail="b@x.com" canSeeAccount canInvite onInvite={onInvite} />);
      fireEvent.click(screen.getByRole("button", { name: /invite to app/i }));
      expect(onInvite).toHaveBeenCalled();
    });
    it("invited state shows a Resend button when canInvite", () => {
      const onResend = vi.fn();
      render(<LinkedAccountPanel state="invited" userId={null} bookingEmail="b@x.com" canSeeAccount canInvite onResend={onResend} />);
      fireEvent.click(screen.getByRole("button", { name: /resend/i }));
      expect(onResend).toHaveBeenCalled();
    });
  });
  ```
- [ ] Run: `npx vitest run src/components/artists/LinkedAccountPanel.test.tsx` `# (CI — not run locally)` — expect **FAIL** (props/labels absent).
- [ ] Implement the panel. Rewrite `src/components/artists/LinkedAccountPanel.tsx`:
  ```tsx
  import { Button } from "@/components/ui/button";
  import { resolveContactEmail } from "@/lib/identity";
  import { ACCOUNT_STATE_META, type AccountState } from "@/lib/artistAccount";

  interface LinkedAccountPanelProps {
    /** Three-state account status (shared vocabulary). */
    state: AccountState;
    /** artists.user_id — null/undefined means unregistered. */
    userId: string | null | undefined;
    /** artists.email — the booking contact (may be null). */
    bookingEmail: string | null | undefined;
    /** The linked login account; pass only when the viewer is an admin and the member was found. */
    account?: { email: string | null; display_name: string | null };
    /** True while the admin account lookup is in flight. */
    accountLoading?: boolean;
    /** Whether the viewer may see account-level PII (admins). Producers get the status only. */
    canSeeAccount: boolean;
    /** Whether the viewer may invite/resend (admins). */
    canInvite: boolean;
    onInvite?: () => void;
    onResend?: () => void;
    inviteBusy?: boolean;
  }

  /**
   * Read-only "Linked account" section for ArtistProfileSheet (ADR-0011). One status
   * vocabulary (ACCOUNT_STATE_META) shared with the card chip; admins additionally see
   * the effective digest recipient and an Invite/Resend action.
   */
  export function LinkedAccountPanel({
    state, userId, bookingEmail, account, accountLoading, canSeeAccount, canInvite, onInvite, onResend, inviteBusy,
  }: LinkedAccountPanelProps) {
    const isRegistered = !!userId;
    const meta = ACCOUNT_STATE_META[state];
    const effectiveDigestEmail = resolveContactEmail({ authEmail: account?.email, bookingEmail });

    return (
      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Linked account</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} aria-hidden="true" />
            {meta.label}
          </span>
        </div>

        {state === "none" && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              No login account. Digests use the booking email{bookingEmail ? ` (${bookingEmail})` : ""}.
            </p>
            {canInvite && (
              <Button size="sm" variant="outline" onClick={onInvite} disabled={inviteBusy}>Invite to app</Button>
            )}
          </div>
        )}

        {state === "invited" && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Invite pending — awaiting acceptance.</p>
            {canInvite && (
              <Button size="sm" variant="outline" onClick={onResend} disabled={inviteBusy}>Resend</Button>
            )}
          </div>
        )}

        {isRegistered && canSeeAccount && (
          accountLoading ? (
            <p className="text-sm text-muted-foreground">Loading account…</p>
          ) : account ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Account name</dt>
              <dd>{account.display_name ?? "—"}</dd>
              <dt className="text-muted-foreground">Login email</dt>
              <dd>{account.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Digest goes to</dt>
              <dd>{effectiveDigestEmail ?? "—"}</dd>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Account details unavailable. Digests go to {effectiveDigestEmail ?? "the booking email"}.
            </p>
          )
        )}
      </div>
    );
  }
  ```
- [ ] Wire the sheet. In `src/components/artists/ArtistProfileSheet.tsx`, import the helpers/data-access and compute state, then pass the new props. Add imports:
  ```tsx
  import { usePendingInvitedArtists } from '@/hooks/usePendingInvitedArtists';
  import { artistAccountState } from '@/lib/artistAccount';
  import { inviteArtistToApp, resendInvitation, fetchOrgInvitations } from '@/data/invitations';
  ```
  Inside the component, after `const isAdmin = hasRole('admin');`, add:
  ```tsx
  const { data: pendingIds } = usePendingInvitedArtists(currentOrg?.id);
  const pendingSet = useMemo(() => new Set(pendingIds ?? []), [pendingIds]);
  const accountState = artist ? artistAccountState(artist, pendingSet) : 'none';

  const invite = useMutation({
    mutationFn: async () => {
      if (!currentOrg || !artist) throw new Error('No active organization');
      if (!artist.email) throw new Error('This artist has no email — add one before inviting.');
      await inviteArtistToApp(supabase, { orgId: currentOrg.id, artistId: artist.id, email: artist.email });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artists', 'pending-invites'] });
      qc.invalidateQueries({ queryKey: ['invitations'] });
      toast({ title: 'Invite sent' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const resend = useMutation({
    mutationFn: async () => {
      if (!currentOrg || !artist) throw new Error('No active organization');
      const invitations = await fetchOrgInvitations(supabase, currentOrg.id);
      const live = invitations.find(
        (i) => i.status === 'pending' && (i as { artist_id?: string }).artist_id === artist.id,
      ) ?? invitations.find(
        (i) => i.status === 'pending' && artist.email && i.email.toLowerCase() === artist.email.toLowerCase(),
      );
      if (!live) throw new Error('No pending invite to resend.');
      await resendInvitation(supabase, live.id);
    },
    onSuccess: () => toast({ title: 'Invite re-sent' }),
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  ```
  Then replace the `<LinkedAccountPanel .../>` call with:
  ```tsx
  <LinkedAccountPanel
    state={accountState}
    userId={artist.user_id}
    bookingEmail={artist.email}
    account={linkedMember ? { email: linkedMember.email, display_name: linkedMember.display_name } : undefined}
    accountLoading={isAdmin && !!artist.user_id && membersLoading}
    canSeeAccount={isAdmin}
    canInvite={isAdmin}
    onInvite={() => invite.mutate()}
    onResend={() => resend.mutate()}
    inviteBusy={invite.isPending || resend.isPending}
  />
  ```
  (The `Invitation` interface in `src/data/invitations.ts` should also gain `artist_id?: string | null` and the `fetchOrgInvitations` select add `, artist_id` so the resend lookup can match by id — do that in this step.)
- [ ] Run: `npx vitest run src/components/artists/LinkedAccountPanel.test.tsx` `# (CI — not run locally)` — expect **PASS**.
- [ ] Run the whole frontend suite to catch snapshot/text drift from the vocabulary change: `npx vitest run` `# (CI — not run locally)` — expect **PASS**.
- [ ] Commit: `feat: unify LinkedAccountPanel status + invite/resend`

---

### Task 9: Docs — `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing. Produces: doc notes for `create-invitation` optional `artist_id` and `org_invitations.artist_id`.

Steps:

- [ ] Update the `create-invitation` bullet under *Edge functions → Invitations* in `CLAUDE.md` to note the optional `artist_id`. Change the existing line to:
  ```
  - **Invitations:** `create-invitation` (org admin → insert `org_invitations` + send the `org-invitation` email; accepts an optional `artist_id` to deterministically link a catalog artist — validates same-org + `user_id IS NULL` and forces role `artist`). Acceptance is the `accept_invitation` RPC (links by `org_invitations.artist_id` first, else by lowercased email), not an edge function.
  ```
- [ ] Add a one-line note near the booking/onboarding data-model description (or the Invitations bullet) that `org_invitations.artist_id` is an FK → `artists(id) ON DELETE SET NULL`, consumed by `accept_invitation` and `list_pending_invited_artists`.
- [ ] Commit: `docs: note create-invitation artist_id + org_invitations fk`

---

### Task 10: Versioning + changelog

**Files:**
- Modify: `package.json`, `src/config/app.config.ts`, `public/changelog.md`, `public/changelog.json` (regenerated)

**Interfaces:**
- Consumes: nothing. Produces: `1.7.0` version bump in both places; a newest-first changelog block; regenerated JSON.

Steps:

- [ ] Bump `version` in `package.json` from `1.6.0` to `1.7.0`.
- [ ] Bump `APP_META.VERSION` in `src/config/app.config.ts` from `'1.6.0'` to `'1.7.0'`.
- [ ] Add a newest-first block at the top of `public/changelog.md` (right after the intro lines, above `## 1.6.0`):
  ```md
  ## 1.7.0 — July 1, 2026

  *Invite artists to a login, right from the roster*

  ### New
  - **Invite from the artist** — Admins can send an app-login invite straight from the Add-Artist dialog or an existing artist, no separate Invites tab detour.
  - **Account status at a glance** — Every artist shows a clear Active · Invited · No account status on their card and profile.

  ### Improved
  - **Reliable account linking** — Inviting from an artist ties the login to that exact artist, even when their login email differs from their booking email.
  ```
- [ ] Regenerate the JSON: `deno run --allow-read --allow-write scripts/changelog-to-json.ts` (rewrites `public/changelog.json`; never hand-edit).
- [ ] Verify the JSON updated: run the MCP-free check `head -20 public/changelog.json` and confirm the `1.7.0` entry is present.
- [ ] Commit: `docs: bump to 1.7.0 + changelog for artist invites`

---

## Self-Review

**Spec coverage (each Design section → task):**

- A. Data model — `org_invitations.artist_id` FK + index → **Task 1**. ✅
- B. `accept_invitation` amend (artist_id-first + `user_id IS NULL` guard + email fallback; pgTAP both branches + skip-when-already-owns) → **Task 2** (plan 10 assertions cover id-link, guard no-op, legacy email). ✅
- C. `create-invitation` optional `artist_id` (validate same-org + `user_id IS NULL`, force role artist; DI tests) → **Task 4**. ✅
- D. `list_pending_invited_artists(p_org)` member-guarded RPC (id-stamped OR legacy email; excludes expired/accepted/revoked; ids only) + pgTAP → **Task 3** (includes non-member reject + anon-no-execute). ✅
- E. Pure helper `artistAccountState` + presentational map + card chip + `LinkedAccountPanel` vocabulary → **Tasks 5, 8a, 8b, 8c**. ✅
- F. Add-Artist "Also send invite" checkbox (progressive disclosure, email required, insert→invite, partial-success toast, no rollback) → **Task 8b**. ✅
- G. "Invite to app" for existing artists (panel primary home + card convenience; prefill editable email; optimistic; invalidate pending + invitations) → **Tasks 8b (card) + 8c (panel Invite/Resend)**. ✅
- H. Data-access + hooks (`fetchPendingInvitedArtistIds`, `inviteArtistToApp`, `usePendingInvitedArtists`, key `['artists','pending-invites', orgId]`) → **Tasks 6, 7**. ✅
- I. Testing across all five layers → unit (Tasks 5–8), pgTAP (2, 3), edge DI (4); E2E optional (not scripted, per spec "optional"). ✅
- Docs + Versioning → **Tasks 9, 10**. ✅

**Edge cases (spec §Edge cases) covered:** already-registered blocked server-side (Task 4 test) + button hidden (Task 8b/8c only show Invite on `none`); duplicate live invite → Resend not a 2nd row (Task 8c resend path); expired → `none` (Task 3 RPC `expires_at` filter + test 3); legacy Admin-tab invites surface as Invited (Task 3 legacy email join + test 2); artist deleted → FK `ON DELETE SET NULL` (Task 1); user already owns an artist → guard no-op (Task 2 test 8); login≠booking email → `artist_id` authoritative, no overwrite (Task 2 seeds different emails; no email write anywhere).

**No placeholders:** every code step shows complete real code (SQL, Deno TS, React TSX, test bodies). No "similar to Task N" / "add validation" left unspecified.

**Type/signature consistency across tasks (verified inline):**
- `fetchPendingInvitedArtistIds(client, orgId): Promise<string[]>` — defined Task 6, consumed by `usePendingInvitedArtists` (Task 7), whose result feeds `pendingSet` (Task 8b) and `artistAccountState` (Task 5). Consistent.
- `artistAccountState({ id, user_id }, Set<string>): AccountState` (Task 5) — the artist arg is a structural subset satisfied by the full `Artist` row (has `id` + `user_id`), so callers in 8b/8c pass `artist` directly. Consistent.
- `inviteArtistToApp(client, { orgId, artistId, email }): Promise<Invitation>` (Task 6) — consumed unchanged in 8b (Add-Artist + card) and 8c (panel). Consistent.
- `createInvitation` gained optional `artistId` (Task 6) forwarded as body `artist_id`; the edge handler reads body `artist_id` (Task 4). Body key matches on both sides. Consistent.
- `ACCOUNT_STATE_META` labels ("Active account"/"Invite pending"/"No account") are asserted identically in Task 5, 8a, and 8c tests — single source, no drift.
- `Invitation` interface gains `artist_id?: string | null` and `fetchOrgInvitations` select adds `artist_id` (Task 8c) so the resend-by-id lookup type-checks. Noted in Task 8c so it isn't missed.

**Fix applied inline during review:** Task 8c explicitly calls out extending the `Invitation` type + `fetchOrgInvitations` select with `artist_id` (needed by the resend lookup) — originally implicit; now stated so the type stays consistent. `create-invitation` already has a `[functions.create-invitation]` block in `supabase/config.toml`, so no config change is required (Global Constraints note). No new function is added, so no config.toml edit anywhere.
