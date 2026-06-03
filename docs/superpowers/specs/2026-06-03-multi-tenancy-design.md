# Multi-Tenancy — Design Spec

- **Date:** 2026-06-03
- **Status:** Approved design → ready for implementation planning
- **Author:** Brainstorming session (Claude Code + owner)
- **Topic:** Convert Showflow Pro from single-tenant to multi-tenant SaaS with per-customer data isolation

---

## 1. Problem & goal

Showflow Pro is currently **single-tenant**: one global pool of shows, artists, bookings, roles (`user_roles`), catalogs (skills/cities/programs), and a singleton `app_settings` config table. We want multiple **customer organizations** ("orgs") to use one deployment while each org's operational data stays **private from every other org**.

A prior attempt failed on two specific fronts (owner-reported):

1. **Data leaked across tenants / RLS broke** — policies became tangled; either data crossed the boundary or queries returned nothing.
2. **Schema-migration pain** — adding tenant scoping across many tables, foreign keys, and regenerated types was error-prone.

**This design is explicitly built to defuse both.** Every major decision below is checked against "does this make a leak structurally impossible?" and "does this keep the migration mechanical?"

"Private to them" means **private from each other** (tenant-to-tenant isolation). It does **not** mean private from the platform operator — see the super-admin decision (§3) and accepted risk (§12).

---

## 2. Locked decisions (from brainstorming)

| # | Question | Decision |
|---|----------|----------|
| 1 | Past failure modes to design around | Data-leak/RLS + migration pain |
| 2 | Artist across multiple orgs | **Fully separate per org** — global person, org-scoped artist profile |
| 3 | Catalogs (skills/cities/programs) | **Per-org**, seeded from a starter template on org creation |
| 4 | How orgs are created | **Super-admin provisions** (via in-app console) |
| 5 | How users join an org | **Org-admin invites by email**; super-admin seeds the first admin |
| 6 | Login / URL model | **Shared app + in-app org switcher** (one domain); designed subdomain-ready for later |
| 7 | Super-admin data access | **Full god-mode**, plain (no audit log, no MFA) — accepted risk, see §12 |
| 8 | Build scope | Core isolation **+ super-admin console + per-org usage metrics**; **defer** billing & per-org branding |
| 9 | Existing data | **Truly greenfield** — no backfill of real data |
| 10 | Multi-org for staff | Producers/admins may also belong to multiple orgs (free with the membership model) |

---

## 3. Architecture — pooled multi-tenancy (shared DB + RLS)

**Chosen:** one Postgres database, one schema, an `org_id` column on every tenant table, isolation enforced by Row-Level Security.

**Rejected, with reasons specific to this project:**

- **Schema-per-tenant** — worsens the migration pain (every schema change runs N times); Supabase's type-gen, PostgREST, and Realtime assume one `public` schema; multi-org artists and god-mode both need cross-tenant queries that separate schemas fight.
- **Database/project-per-tenant** — hard isolation but massive ops (N projects, deploys, cron, secrets) and it **breaks one-login-many-orgs** (separate auth per project). Overkill at the target scale (50 shows / 200 artists).

Pooled RLS fits Supabase natively, is cheapest to operate, makes multi-org identity and god-mode trivial, and leaves **one** schema to migrate and **one** place to enforce isolation.

---

## 4. Data model

### 4.1 New tables (platform layer)

- **`organizations`** — `id, name, slug (unique), status ('active'|'suspended'), created_by, created_at, updated_at`. The tenant.
- **`platform_admins`** — `user_id (PK/unique FK → auth.users)`. The super-admin(s); deliberately **above** the org model.
- **`org_memberships`** — `id, org_id, user_id, role app_role, created_at, UNIQUE(org_id, user_id, role)`. Replaces global `user_roles`. Per-org roles; any user may belong to many orgs.
- **`org_invitations`** — `id, org_id, email, role, token (unique), status ('pending'|'accepted'|'revoked'), invited_by, expires_at, created_at`.

### 4.2 Global table (shared identity — the only cross-org data)

- **`profiles`** — unchanged shape: `user_id (unique), display_name, avatar_url, phone, email`. **No `org_id`.** One person, one login, nothing bookable. This is what makes "fully separate per org" true by construction.

### 4.3 Changed tables

- **`artists`** — gains `org_id NOT NULL` FK; uniqueness changes from `UNIQUE(user_id)` to **`UNIQUE(org_id, user_id)`**. One bookable profile per person *per org*; `user_id` stays nullable (producer-created artists not yet claimed). All artist attributes (skills, cast_role, status, priority, bio) are org-scoped.
- **`app_settings`** — uniqueness changes from `UNIQUE(key)` to **`UNIQUE(org_id, key)`**; `org_id` nullable, where **`org_id IS NULL` = platform default** (see settings resolver §7).
- **Every other tenant table gains `org_id NOT NULL REFERENCES organizations(id)`:** `shows, show_dates, show_date_offer_tiers, show_cast_eligibility, show_date_cast_eligibility, bookings, booking_audit_log, casts, cast_members, cast_city_priority, cities, skills, artist_skills, blocked_dates, show_assignments, chats, chat_messages, notifications, airtable_sync_log`.

### 4.3a Note — "programs/sub-programs" are not a table

Program/sub-program are **values on `shows`** (`shows.program`, `shows.sub_program`) plus slot capacity in **`app_settings.sub_program_slots_defaults`**. Both already become per-org once `shows` gains `org_id` and `app_settings` is keyed by `(org_id, key)`. There is **no `programs` catalog table** to scope. The per-org "program catalog" a customer sees is therefore the distinct program/sub-program values in their own `shows` plus their own slot-defaults setting.

### 4.4 Retired

- **`user_roles`** → replaced by `org_memberships`.
- **`user_approvals`** + the global approval queue → replaced by invite-only onboarding (§6). Dropped (greenfield).

### 4.5 Why denormalize `org_id` everywhere (even on `notifications`, `booking_audit_log`)

So the **same one-line RLS rule** applies to every table. Uniformity is the primary defense against policy bugs — the second failure mode. We accept a denormalized `org_id` on child tables to buy that uniformity.

---

## 5. Security & isolation

### 5.1 Helper functions (replace global `has_role`)

All `STABLE SECURITY DEFINER SET search_path = public` (the existing proven pattern):

```sql
create function is_super_admin(_uid uuid) returns boolean ... as $$
  select exists (select 1 from platform_admins where user_id = _uid) $$;

create function is_org_member(_uid uuid, _org uuid) returns boolean ... as $$
  select is_super_admin(_uid)
      or exists (select 1 from org_memberships where user_id = _uid and org_id = _org) $$;

create function has_org_role(_uid uuid, _org uuid, _role app_role) returns boolean ... as $$
  select is_super_admin(_uid)
      or exists (select 1 from org_memberships
                 where user_id = _uid and org_id = _org and role = _role) $$;
```

**God-mode lives in exactly one place:** `is_super_admin()` is baked into both membership checks, so the super-admin transparently passes every policy with no special-casing. Reversing the plain-god-mode choice later means editing one function, not 89 policies.

### 5.2 Uniform RLS policy template (every tenant table)

```sql
alter table <t> enable row level security;        -- default-deny

create policy <t>_read on <t> for select to authenticated
  using ( is_org_member(auth.uid(), org_id) );

create policy <t>_write on <t> for all to authenticated
  using     ( has_org_role(auth.uid(), org_id, <writer_role>) )
  with check ( has_org_role(auth.uid(), org_id, <writer_role>) );  -- write-side leak guard
```

- `<writer_role>` is `'producer'`/`'admin'` per table (artist-owned rows like blocked_dates add an `OR (org-scoped artist owned by auth.uid())` clause for self-writes).
- **`WITH CHECK` is mandatory** — without it a user could `update ... set org_id = <other org>` and smuggle a row across the boundary.
- **Audit/log tables stay append-only** — `booking_audit_log` keeps insert-via-trigger; **no `WITH CHECK (true)`** (per existing house rule). It only gains `org_id` for uniform reads.
- `is_chat_participant()` and other security-definer helpers are updated to carry/verify the org dimension.

### 5.3 Active org = UX filter; membership = the guarantee

- The client filters by the **active org** (`.eq('org_id', activeOrg)`) purely so the UI shows one org at a time.
- **Isolation never depends on that filter.** RLS's `is_org_member(org_id)` guarantees a session can only ever read orgs it belongs to. A missing client filter at worst shows a *2-org user both of their own orgs* — never another tenant's data. This is the property the prior attempt lacked.

### 5.4 Two CI guards (the insurance)

- **Coverage test** — a SQL/pgTAP test asserting *every* table with an `org_id` column has RLS enabled and both standard policies. Catches "added a table, forgot the policy."
- **Isolation suite** — seeds two orgs and proves org A's session reads/writes **zero** of org B's rows on every table; non-members get zero rows; super-admin sees all. Runs in CI on every PR.

---

## 6. Auth & onboarding (invite-only)

**Provisioning chain:** super-admin creates org + seeds starter catalog + invites first admin → first admin accepts → invites producers and creates/invites artists → each accept writes an `org_memberships` row.

- **Invitations** sent via the existing transactional-email infra (one new template in the registry). Acceptance runs a `SECURITY DEFINER` RPC `accept_invitation(token)` that writes the membership server-side — membership cannot be self-granted by a client insert.
- **Artist claim:** accepting an invite tied to a producer-created artist links `artists.user_id = auth.uid()` for **that org's row only**.
- **`AuthContext`** (additive): gains `currentOrg`, `memberships[] ({org, roles})`, `switchOrg(id)`; `hasRole()` resolves against the active org; `currentOrg` persists to localStorage and is restored on load. Existing `viewAsRole`/`viewAsUser` editor impersonation composes with the active org.
- **`ProtectedRoute`** adds one check: member of `currentOrg` **and** holds the required role there. Editor-mode page-access override still applies, scoped to the active org's config.
- **No memberships** → "ask your org admin for an invite" empty state. **Suspended org** → "org suspended" gate (data intact, member can't act; super-admin can still Enter).
- **`handle_new_user`** still creates the `profiles` row; there is no global approval gate — access *is* membership.
- **Realtime** per-table invalidation channels gain an `org_id` filter; switching orgs re-subscribes to the active org.

---

## 7. Backend — edge functions, cron, settings

### 7.1 Cron pattern — one schedule, loop over orgs

The 5 cron-driven functions keep their single pg_cron schedule; each function **iterates active orgs** and does per-org work, reading that org's settings. No per-org cron schedules (unnecessary at target scale; revisit at hundreds of orgs).

### 7.2 Settings resolver — org override, else platform default

```
getSetting(org, key) = app_settings[org_id = org].value
                    ?? app_settings[org_id IS NULL].value   -- platform baseline
```

A new org inherits sensible defaults with zero config and overrides only what it cares about.

### 7.3 Function-by-function

| Function | Change |
|---|---|
| `send-offer-digest`, `send-confirmation-digest` | Group by `(org, artist)`; gate each org by its own digest hour; render with that org's email overrides. |
| `expire-offers`, `tier-at-risk-watcher` | Iterate orgs; read each org's `sub_program_slots_defaults`; per-`show_date`/tier logic already org-scoped via `org_id`. |
| `airtable-poll` | Iterate only orgs with `airtable_sync_enabled`; use each org's base/table; stamp inserted `show_dates` with that `org_id`. |
| `open-offer-tier` | Derive `org_id` from the `show_date`; thread into created bookings + tiers. |
| `admin-set-role` | Becomes "set role within an org" → writes `org_memberships`, guarded by `has_org_role(caller, org, 'admin')`. |
| `admin-list-users` | Scoped to the caller's org. |
| `admin-decide-approval` | Retired → replaced by `accept_invitation`. `notify-signup` → "invite accepted" notice to that org's admins. |
| `send-transactional-email`, suppression/unsubscribe | Mostly unchanged (person-level); template overrides resolved per-org. |

Booking-engine triggers (`compute_show_date_status`, `resolve_show_assignments`, `auto_cancel_on_slot_fill`, `promote_understudy_on_cancellation`, `notify_booking_transition`) operate on rows that now carry `org_id`; the only edits are reading the right org's slot defaults and keeping notifications inside the org. `cron_secret` stays platform-level.

**Service-role functions bypass RLS, so each re-verifies the caller's org membership + role server-side before acting** — the existing `admin-decide-approval` pattern, now org-aware. (DI: `handle(req, deps)` + `makeFakeDeps` keeps all of this unit-testable.)

---

## 8. Super-admin console & metrics

- **Route `/platform`**, gated by `is_super_admin()`; invisible to everyone else.
- **New organization** — one atomic server-side flow (`provision_org`): insert `organizations` → copy the starter-catalog template into the org's `skills`, `cities`, and `casts`, and seed the org's `sub_program_slots_defaults` in `app_settings` → create first-admin `org_invitations` → send invite. Atomic: no half-created orgs.
- **Enter ▸** — god-mode in practice: sets `currentOrg` to a non-member org; works because `is_org_member()` short-circuits on `is_super_admin()`. Unlogged (per §12).
- **Suspend / Reactivate** — flips `organizations.status`; members of a suspended org hit the suspended gate.
- **Metrics** — one super-admin-only SQL view/RPC `platform_org_stats` aggregating per-org members, active artists, bookings-30d, last activity. The only cross-tenant read path, callable only by super-admin.

The org-scoped app gains just the **sidebar org switcher**; everything else renders scoped to the active org.

---

## 9. Testing strategy (test-first)

| Layer | Tool | Targets |
|---|---|---|
| Database | pgTAP (`supabase test db`) | **Isolation suite ★** + **coverage test ★**; helper functions; org-scoped triggers; per-org settings |
| Unit/hook/component | Vitest + `supabaseFake` | data-access fns, AuthContext org logic, switcher, settings resolver, invite acceptance |
| Edge function | Deno test + `makeFakeDeps` | org-aware digests, `provision_org`, `accept_invitation`, `admin-set-role` org guard |
| End-to-end | Playwright | **Cross-tenant proof** (org A cannot load org B through the full stack); invite→accept→switch; provision→invite→login |

The pgTAP isolation + coverage tests are **written before the migration** (they fail first, then go green).

---

## 10. Migration mechanics (anti-"migration pain")

- Greenfield → **no data backfill**; `org_id` is added `NOT NULL` + FK directly to empty tables.
- **One ordered migration via the Supabase migration tool** (never hand-edited), generated from the uniform template, not table-by-table:
  1. Create platform tables (`organizations`, `platform_admins`, `org_memberships`, `org_invitations`).
  2. Add `org_id` to every tenant table.
  3. Swap `user_roles` → `org_memberships`; drop `user_approvals`.
  4. Change uniques (`artists`, `app_settings`).
  5. Drop old `has_role` policies; install the three helpers; apply the policy template to every tenant table.
  6. Seed: owner as `platform_admin`, platform-default `app_settings` (`org_id IS NULL`), starter-catalog template, one **bootstrap org**.
- `generate_typescript_types` regenerates `src/integrations/supabase/types.ts` (regenerated, never hand-edited).
- **The coverage test gates the merge** — the migration is not "done" until every table proves it is scoped and policied.

---

## 11. Phasing — five phases, each ends green

A single **bootstrap org** keeps the existing UI working through every phase, so the app never breaks mid-flight.

| Phase | Lands | Gate (must be green) |
|---|---|---|
| **0 · Foundation** | Platform tables · `org_id`+FK everywhere · 3 helpers · uniform RLS · bootstrap org | Isolation suite ★ + coverage test; app still builds (defaults to bootstrap org) |
| **1 · Auth + switcher** | AuthContext org context · ProtectedRoute · org switcher · invite→accept · empty states | Vitest (auth) + e2e (invite, switch); isolation still green |
| **2 · Catalogs** | Starter-template seeding · per-org settings resolver · per-org editor config | Vitest (resolver) + pgTAP (per-org settings) |
| **3 · Backend** | Cron loops over orgs · per-(org,artist) digests · Airtable per-org · admin fns org-scoped | Deno `handle()` + fake deps; per-org digest gating |
| **4 · Console** | `/platform` · provision/suspend · god-mode Enter · metrics view | E2e provision→invite→login; super-admin-only access |

The riskiest part (isolation) ships **first** and is **proven by tests before any UI exists**.

---

## 12. Risks & accepted decisions

- **Accepted risk — unaudited god-mode.** Super-admin access is unlogged and not MFA-gated, by explicit owner decision (offered audit-log + MFA twice; declined). This weakens the privacy/GDPR/DPA story given the app already runs a consent system. **Revisit before onboarding regulated or enterprise customers.** The single helper design makes adding an audit wrapper a one-function change later.
- **Per-org catalog re-entry.** Fully-separate artist profiles mean a multi-org artist re-enters skills/availability per org and manages availability per org. This is the deliberate price of the strongest privacy guarantee (chosen in §2.2). Starter-template catalogs reduce org-setup friction but not per-artist re-entry.
- **Denormalized `org_id`** must stay consistent with parents (e.g., a `booking`'s `org_id` must equal its `show_date`'s). Enforced by setting it server-side/in triggers, never from client input, plus a pgTAP consistency check.

---

## 13. Out of scope (deferred)

- **Billing / plans / seat limits** — separate subsystem, later.
- **Per-org branding** (logo/colors) — cosmetic; the shared-domain model makes it optional.
- **Per-org subdomains / white-label** — the design keeps org context cleanly separable so this can layer on without rework, but it is not built now.

---

## 14. Open questions

None blocking. The design is internally consistent and ready for an implementation plan (`writing-plans`), which will expand §11's phases into ordered, testable tasks.
