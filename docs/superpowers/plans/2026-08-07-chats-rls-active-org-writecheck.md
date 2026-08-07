# Plan A — Fix chats (and all tenant tables) RLS write regression from active-org scoping

## Context

Migration `supabase/migrations/20260806104215_active_org_scoping.sql` (applied to prod 2026-08-06) rewrote the RESTRICTIVE `org_isolation` policy on `chats` **and 28 other tenant tables** to add an active-org conjunct to **both `USING` and `WITH CHECK`**:

```sql
create policy org_isolation on public.<table> as restrictive for all to authenticated
  using      (public.is_org_member(auth.uid(), org_id)
              and (public.active_org_id() is null or org_id = public.active_org_id()))
  with check (public.is_org_member(auth.uid(), org_id)
              and (public.active_org_id() is null or org_id = public.active_org_id()));
```

`active_org_id()` reads the SPA's `x-active-org` request header from PostgREST's `request.headers` GUC. The `chats` table has a `BEFORE INSERT` trigger (`derive_org_id_from_show_date_id()`) that overwrites `NEW.org_id` with the show_date's org. So the `WITH CHECK` becomes effectively `show_date.org_id = x-active-org header`. When a multi-org member / super-admin inserts a chat whose show_date belongs to org A while their active-org header is org B, the insert is rejected: `new row violates row-level security policy for table "chats"`. Confirmed against prod (reproduced), and `chats` has 0 rows — chat creation has never once succeeded. This is a latent write-path failure on all 29 tables, not just chats.

**Root judgment (from investigation):** the active-org conjunct is a *read-narrowing* / defense-in-depth convenience (ADR-0003 says isolation never depends on the active-org UI filter). On **writes** it adds no real isolation: `is_org_member(auth.uid(), org_id)` already restricts writes to orgs the caller belongs to, and the derive triggers stamp `org_id` from the FK parent, so a client cannot forge a cross-org row. Enforcing header-equality on a **server-derived, client-timing-dependent** value is inherently racy and is exactly what breaks legitimate writes.

## Goal

Drop the active-org conjunct from the **`WITH CHECK`** of `org_isolation` on every table the buggy migration touched, while **keeping it on `USING`** (read narrowing preserved). Apply uniformly across all 29 tables so the policy template stays consistent and the same latent write bug is closed on `bookings`, `casts`, etc.

## Global Constraints

- **Do NOT hand-apply the migration to production.** The merge to `main` applies it (Supabase GitHub integration). Only create the migration file. (See CLAUDE.md "The merge applies migrations. You do not.")
- **The table list is authoritative from the buggy migration.** Read `supabase/migrations/20260806104215_active_org_scoping.sql` and enumerate the exact set of tables it rewrote (expected 29). The new migration must cover **exactly that set** — no more, no fewer. Do not guess the list.
- **Preserve each table's `USING` expression verbatim** (keep the active-org conjunct on reads). Only the `WITH CHECK` changes to `with check (public.is_org_member(auth.uid(), org_id))`.
- Keep the policy RESTRICTIVE, `for all`, `to authenticated`, name `org_isolation`.
- Migration must be idempotent-safe in the normal Supabase sense (drop + recreate policy per table). Follow the exact DDL style of the buggy migration.
- New migration filename: a timestamp strictly greater than `20260806104215`, descriptive suffix e.g. `_org_isolation_writecheck_drop_active_org.sql`. Do NOT edit the existing migration.
- TypeScript/edge mirrors are unaffected (pure SQL policy change); do not touch `types.ts`.

## Task 1 — Regression test (pgTAP), then the migration (TDD)

**Test first (must fail on current prod schema, pass after the migration DDL):**

Write a pgTAP test at `supabase/tests/chats_rls_active_org_writecheck_test.sql` that:
1. Creates two orgs (A and B) and a user who is an `admin` member of **both** (use the project's existing helper patterns / fixtures for orgs, memberships, `user_roles`/`org_members` — inspect neighbouring tests in `supabase/tests/` for the exact seeding helpers; do not invent schema).
2. Creates a show + a `show_date` in **org A**.
3. Authenticates as that user: `set local role authenticated`, `set local request.jwt.claims` to `{"sub":"<user>","role":"authenticated"}`.
4. Sets the active-org header GUC to **org B**: `set local request.headers = '{"x-active-org":"<orgB>"}'` (confirm the exact GUC name by reading `active_org_id()`'s definition).
5. Asserts that inserting a `chats` row for the **org A** show_date **succeeds** (this is the regression: it currently raises `new row violates row-level security policy`). Use `lives_ok`.
6. Asserts read-narrowing is preserved: with the active-org header = org B, a `SELECT` from `chats` does **not** return the org-A chat (`is_empty` / row count 0) — proving `USING` still narrows.

Run the test the way this repo runs pgTAP (per CLAUDE.md / project memory): inside `BEGIN; CREATE EXTENSION IF NOT EXISTS pgtap; <test>; ROLLBACK;` via `execute_sql` (Supabase MCP) against the live project — **read/rollback only, never commit**. Demonstrate it **FAILS** first (step 5 errors) on the current schema.

**Then the migration:**

Create `supabase/migrations/<newtimestamp>_org_isolation_writecheck_drop_active_org.sql` that, for **each** table in the buggy migration's set, `DROP POLICY IF EXISTS org_isolation ON public.<table>;` then `CREATE POLICY org_isolation ... USING (<verbatim active-org USING expr>) WITH CHECK (public.is_org_member(auth.uid(), org_id));`.

**Verify:** re-run the pgTAP test in a transaction that first applies the new migration's DDL, and show step 5 now passes (`lives_ok`) and step 6 still holds. Also run `deno`/`tsc` are N/A (pure SQL); instead sanity-check the SQL parses by applying it inside a `BEGIN; ... ROLLBACK;` against the live DB.

**Do not commit the migration as applied to prod.** Leave `supabase_migrations.schema_migrations` untouched.

### Test requirements
- The pgTAP file is the durable regression test and must live in `supabase/tests/`.
- Cover both the write success (regression) and the read-narrowing preservation (guard against over-correction).

## Out of scope
- No frontend changes (ChatPanel guard is a weaker Option B; not needed once RLS is fixed).
- No changes to `active_org_id()` or the derive triggers.
