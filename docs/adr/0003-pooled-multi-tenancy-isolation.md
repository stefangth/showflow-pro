# ADR-0003: Pooled multi-tenancy — denormalized `org_id`, RESTRICTIVE isolation, derive-from-parent triggers

**Status:** Accepted
**Date:** 2026-06-03 *(design); Phase 3 triggers/Vault 2026-06-04. Recorded retroactively 2026-06-16.*
**Deciders:** Stefan Schaal (platform owner)

## Context

The app was single-tenant. A prior multi-tenancy attempt failed on two fronts (owner-reported, spec
§1): *"1. Data leaked across tenants / RLS broke … 2. Schema-migration pain."* Every decision was
checked against *"does this make a leak structurally impossible?"* and *"does this keep the migration
mechanical?"* The retrofit was greenfield (no real data to backfill).

## Decision

A **pooled** model: one database, one schema, an `org_id` column on every tenant table, isolation by
RLS.

- **Denormalized `org_id` on every tenant table** (incl. deep children like `chat_messages`,
  `booking_audit_log`) so *"the **same one-line RLS rule** applies to every table. Uniformity is the
  primary defense against policy bugs … We accept a denormalized `org_id` on child tables to buy
  that uniformity."*
- **One RESTRICTIVE `org_isolation` policy per table** (`as restrictive for all to authenticated
  using (is_org_member(auth.uid(), org_id)) with check (...)`), rather than rewriting the ~89
  permissive policies: *"Restrictive policies only FILTER — they never grant,"* so intra-org guards
  (self/participant) are preserved. The mandatory `WITH CHECK` blocks `update … set org_id = <other
  org>` smuggling.
- **`org_id` is correct-by-construction via BEFORE INSERT triggers** that derive it from the FK
  parent (`derive_org_id_from_show_id`, `_show_date_id`, `_booking_id`, `_cast_id`, `_artist_id`,
  `_chat_id`); parentless writers (`notifications`, `airtable_sync_log`) are stamped explicitly.
- **Bootstrap-org coexistence then fail-loud:** a temporary `org_id … DEFAULT <bootstrap>` kept the
  org-unaware client working during migration; the DEFAULTs were then dropped so *"a missed path
  fail[s] loudly (NOT NULL) rather than silently land in the bootstrap org."*
- **Isolation never depends on the active-org UI filter** — *"RLS's `is_org_member(org_id)`
  guarantees a session can only ever read orgs it belongs to … This is the property the prior
  attempt lacked."*
- **Invariants enforced in CI (pgTAP):** parent↔child `org_id` consistency, an RLS coverage test
  (every `org_id` table has RLS + both policies), and an isolation suite (org A reads/writes zero of
  org B), written before the migration.
- **Per-org secrets in Supabase Vault:** the Airtable key is set by an org-admin-guarded
  `set_org_airtable_key` and read only by a service-role `get_org_airtable_key` — kept out of
  member-readable `app_settings`. (The platform `cron_secret` stays an `app_settings` value.)

## Options Considered

| Option | Verdict |
|---|---|
| **Pooled (one schema + RLS)** | **Chosen** |
| Schema-per-tenant | Rejected — *"worsens migration pain (every change runs N times); Supabase type-gen/PostgREST/Realtime assume one `public` schema; … god-mode need[s] cross-tenant queries."* |
| Database/project-per-tenant | Rejected — *"hard isolation but massive ops … and it **breaks one-login-many-orgs**. Overkill at the target scale."* |
| Rewrite all permissive policies (join-based org checks) | Rejected — *"high-risk, and it would regress intra-org guards."* |

## Trade-off Analysis

Pooled accepts a denormalized column and a uniform RLS rule in exchange for a mechanical migration
and a single enforcement point. The denormalization risk (child `org_id` diverging from parent) is
bought back by the derive triggers + the consistency pgTAP, making wrong-org rows structurally
impossible by construction.

## Consequences

- **Easier:** one schema to migrate; isolation enforced in two helper functions; god-mode and
  multi-org identity become trivial.
- **Harder / accepted:** denormalized `org_id` must stay consistent (enforced by triggers + tests);
  cron functions must loop over orgs (*"revisit at hundreds of orgs"*); first use of Vault adds an
  operational dependency.
- **Carried forward:** this is the model [ADR-0001](0001-airtable-system-of-record.md) relies on
  (booking/show_date `org_id` derivation) and [ADR-0004](0004-per-org-roles.md) builds on. The
  god-mode (super-admin) accepted risk is recorded in ADR-0004.

## Implementation (delivered)

Migrations `20260603120100_add_org_id_to_tenant_tables.sql`, `20260603120200_org_isolation_rls.sql`,
`20260604130000_org_id_derivation_triggers.sql`, `20260604131000_org_airtable_vault.sql`,
`20260604132000_drop_bootstrap_org_defaults.sql`. pgTAP `org_id_parent_child_consistency.sql`,
`org_coverage.sql`, `rls/org_isolation.sql`. Spec `2026-06-03-multi-tenancy-design.md` §§1–5, 7,
9, 12. PRs #86, #91, #93.
