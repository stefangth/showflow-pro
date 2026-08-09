# Artist contact-field privacy: prove the RLS control, retire the dead grant illusion

**Date:** 2026-08-08
**Branch:** `claude/artist-contact-security-fix-940f03`
**Status:** Design approved, spec under review

## Background

The auto-review on PR #225 (the grants-parity migration `20260808201308`) flagged that
`artists.email` / `artists.phone` are exposed to `authenticated`: the April 2026 migration
`20260425202310` tried to protect them with column-level `REVOKE SELECT (email, phone)` plus a
safe-column `GRANT`, but never revoked the table-level `SELECT`. A table grant covers every
column, so the column `REVOKE` was moot from the start.

## What is actually true today (verified against prod `epweartpzwvcasrzyueh`)

The brief described the situation as *"any authenticated user can read every artist's email and
phone."* That was true in April 2026 but **is not true today.** Verified against live policies,
grants, views, functions, and the realtime publication:

- **The row-exposing policy is gone.** `20260425202310` also created
  `"Authenticated can view artist non-contact info" USING (true)` — the policy that actually
  exposed rows. Two migrations later, `20260425202459` **dropped it** and ran a blanket
  `GRANT SELECT ON public.artists TO authenticated` (which re-granted the contact columns,
  nullifying the `REVOKE`). The multi-tenancy retrofit never re-introduced any general-member
  read policy.
- **Current effective `SELECT` policies on `public.artists`** (later migrations supersede earlier):
  - PERMISSIVE `"Admins and producers can view all artist data"` —
    `has_org_role(auth.uid(), org_id, 'admin') OR has_org_role(auth.uid(), org_id, 'producer')`
  - PERMISSIVE `"Artists can view own full record"` — `auth.uid() = user_id`
  - RESTRICTIVE `org_isolation` — `is_org_member(auth.uid(), org_id)` (ANDed on)
- **Consequence:** a plain member (not admin/producer, not the linked artist) matches **no**
  permissive `SELECT` policy and reads **zero** other-artist rows — no name, no email, no phone.
- No `artists_public` view exists. Every contact-bearing edge-function read uses the **service
  role** (RLS-exempt by design); no user-JWT edge path reads contact fields. `artists` is in the
  realtime publication, but realtime respects RLS.

**What the brief's author verified** — `has_table_privilege` / `has_column_privilege` = `true` —
is the *grant* layer only. Grants are necessary but not sufficient for exposure; RLS still filters
rows. So there is **no live cross-user leak.**

## The real defects

1. **A latent defense-in-depth gap.** The blanket table grant silently nullified the column
   `REVOKE`, so the *intended* column-level protection is dead. The schema now *implies* a
   protection it does not provide. If anyone re-adds a broad read policy, contact fields leak with
   no backstop.
2. **No regression test.** Nothing in pgTAP asserts that a non-privileged member cannot read
   `artists.email` / `artists.phone`. This is exactly why the protection rotted unnoticed.

## Structural constraint that shapes the fix

`admin`, `producer`, and plain members are **all the same Postgres role (`authenticated`)**.
Column-level `GRANT`/`REVOKE` cannot distinguish them. Genuinely revoking `email`/`phone` from
`authenticated` would break admin/producer/self reads too — unless those reads move to a
`SECURITY DEFINER` path. This is precisely why the "naive fix breaks the app," and why a column
grant is the wrong tool for an admin-vs-member distinction. **RLS (row-level) is the correct and
already-working control.**

## Decision (approved)

**Scope: RLS-as-control + regression tests.** Treat RLS as the real access control (it is already
correct) and make it un-rot-able with executable proof; retire the dead column-grant illusion in
the schema. Do **not** revoke contact columns from `authenticated` and do **not** reroute reads
through `SECURITY DEFINER` RPCs (that was the rejected Option B — larger diff across data layer,
edge mirrors, and multi-layer tests, with real app-breakage risk and no live threat to justify it).

## Deliverables

### 1. pgTAP regression test (the core deliverable)

New file `supabase/tests/rls/artists_contact_privacy.sql`, matching the harness in the existing
`supabase/tests/rls/artists_capabilities.sql` (`session_replication_role = replica` for seeding;
`set_config('request.jwt.claims', …)` + `SET LOCAL ROLE authenticated` to impersonate; `is_empty`
/ `is` / `throws_ok` assertions; `BEGIN … ROLLBACK`).

**Fixture (one primary org + one second org for cross-org isolation):**

- `adminUser` — `admin` member of org1
- `producerUser` — `producer` member of org1
- `artistUserA` — `artist` member of org1, linked to `artistRowA` (its `user_id`)
- `artistRowA` — org1, `email` + `phone` set (artistUserA's own record)
- `artistRowB` — org1, `email` + `phone` set, **not** linked to artistUserA (the snoop target)
- `otherOrgUser` — member of org2 (any role)

**Assertions (the executable security property):**

1. As **artistUserA**: `SELECT email, phone FROM artists WHERE id = artistRowB` → **empty**
   (a plain artist member cannot read another artist's contact — the exact thing that regressed).
2. As **artistUserA**: `SELECT 1 FROM artists WHERE id = artistRowB` → **empty**
   (the row itself is invisible, making the column question moot — stated explicitly so a future
   broad-row-policy regression fails here even if someone "means" to hide only columns).
3. As **artistUserA**: own `artistRowA` `email` and `phone` are **readable** (self policy intact).
4. As **adminUser**: `artistRowB` `email` and `phone` are **readable** (admin need preserved).
5. As **producerUser**: `artistRowB` `email` and `phone` are **readable** (producer need preserved).
6. As **otherOrgUser**: `SELECT 1 FROM artists WHERE id = artistRowB` → **empty**
   (cross-org isolation on contact-bearing rows).

If any future migration re-adds a broad read policy (a `USING (true)`-style regression), assertions
1/2/6 go red in CI — this is the actual regression backstop, stronger than any column grant.

### 2. Documentation / cleanup migration (zero behavior change)

New migration `supabase/migrations/<timestamp>_document_artist_contact_pii.sql` that makes the
schema honest about how contact PII is protected:

- `COMMENT ON COLUMN public.artists.email` and `…artists.phone` stating: PII readable only by
  admin/producer (all org artists) or the linked artist themselves, enforced by the RLS `SELECT`
  policies; **column grants do not gate this — do not rely on them.**
- `REVOKE SELECT (email, phone) ON public.artists FROM anon;` — a harmless belt. `anon` reads no
  artist rows under RLS anyway, so this is behaviorally a no-op, but it documents intent at the
  grant layer and removes the vestigial `anon` column grant left by the historical dance.

Idempotent and prod-safe. It applies on merge like any migration (per the repo rule, **not**
hand-applied). It does **not** touch `authenticated` grants or any `SELECT` policy, so no app path
changes behavior.

### Deliberate non-goals

- **No change to `authenticated` table/column grants** beyond the `anon` belt above.
- **No `SECURITY DEFINER` RPC rerouting** of contact reads.
- **No change to app `select` strings.** `fetchArtists` / `fetchMyArtist` `select("*")`, the
  hire-order `fetchArtistsLite` / `fetchShowflowLayerForOrder` contact reads, and
  `ArtistProfileSheet`'s own `select("*")` are all admin/producer/self surfaces already gated
  correctly by RLS. Narrowing them would be churn with no security value — and narrowing
  `fetchArtists` to a non-PII list would actively break ArtistsPage's email column.

## Test / verification plan

- Run the new pgTAP file locally against the local Supabase stack (`supabase test db`, or the
  `npm run verify:full` path per the local-development-stack runbook). The prod MCP path is **not**
  used for verification because the impersonation `SET LOCAL ROLE authenticated` is (correctly)
  blocked there; the local stack is the CI-equivalent path.
- Confirm the whole pgTAP suite still passes (no regression from the `anon` revoke or the comments).
- No frontend/edge code changes, so `vitest` / `tsc` / Deno suites are unaffected; run `lint` +
  `verify:fast` as a sanity gate before the PR.

## Rollout

- Single PR on `claude/artist-contact-security-fix-940f03` → `main`.
- Merge applies the documentation migration to prod (comments + `anon` revoke); no data migration,
  no downtime, no app behavior change.
- Not customer-facing → no `changelog.md` entry (internal security hardening + test only).
