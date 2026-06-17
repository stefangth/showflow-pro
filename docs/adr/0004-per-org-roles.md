# ADR-0004: Per-org roles in `org_memberships`; retire global `user_roles`/`has_role`

**Status:** Accepted
**Date:** 2026-06-03 *(god-mode refinements 2026-06-04). Recorded retroactively 2026-06-16.*
**Deciders:** Stefan Schaal (platform owner)

## Context

Roles lived in a global `user_roles` table checked by `has_role(uuid, app_role)`. Multi-tenancy
([ADR-0003](0003-pooled-multi-tenancy-isolation.md)) requires per-org roles — *"any user may belong
to many orgs."* The change had to keep the live app and test suite green throughout.

## Decision

- **Roles live in `org_memberships`** `(org_id, user_id, role, UNIQUE(org_id, user_id, role))`.
- **Three SECURITY DEFINER helpers** enforce access: `is_super_admin(_uid)`,
  `is_org_member(_uid, _org)`, `has_org_role(_uid, _org, _role)`; the latter two are
  `select is_super_admin(_uid) or exists (…)`. *"**God-mode lives in exactly one place:**
  `is_super_admin()` is baked into both membership checks … Reversing the plain-god-mode choice
  later means editing one function, not 89 policies."*
- **Permissive policies rewritten** `has_role(auth.uid(), R)` → `has_org_role(auth.uid(), org_id, R)`
  via a mechanical substitution; self/participant/`USING(true)`/restrictive policies untouched.
- **`user_roles` and `has_role()` dropped** once the only remaining references were `user_roles`'s
  own policies.
- **Super-admins live in `platform_admins`** — deliberately *"above"* the org model.
- **Server-enforced; client is UX-only** — *"Role checks are always server-enforced via RLS. The
  client `useAuth().hasRole(...)` is for UX only … never trust it for data access."* `hasRole()`
  keeps its signature (derives the active org's roles) and short-circuits to `true` for super-admins.
- **Edge auth:** `requireRole` (any-org) and `requireOrgRole(org_id, [...])` (org-scoped, no
  cross-org grants; last-admin guard scoped to the org); `requireSuperAdmin` added with the platform
  console.

## Options Considered

**Where roles live** and **invite-only vs. other onboarding** were locked owner/brainstorming
decisions — no rejected alternative is **documented**. The one documented sub-choice is god-mode
shape: *"God-mode = all-orgs switcher (owner choice)"* — a super-admin's `AuthContext.orgs` is all
organizations; other options were not enumerated.

## Trade-off Analysis

Concentrating god-mode in one function trades a small amount of "magic" (super-admins silently pass
every policy) for reversibility: changing or auditing god-mode is a one-function edit rather than a
sweep across policies.

## Consequences

- **Easier:** multi-org staff fall out of the membership model for free; god-mode is one-function
  reversible.
- **Harder:** every role check now carries an org dimension; staged retirement needed transition
  fallbacks and careful ordering (redefine `is_org_member` before dropping `user_roles`, since it
  backs the restrictive policy on every table).
- **Accepted risk (verbatim):** *"Super-admin access is unlogged and not MFA-gated, by explicit
  owner decision (offered audit-log + MFA twice; declined). This weakens the privacy/GDPR/DPA story
  … **Revisit before onboarding regulated or enterprise customers.**"* The single-helper design
  makes adding an audit wrapper a one-function change later.

## Implementation (delivered)

Migrations `20260603130200_org_scoped_role_gating.sql`,
`20260603150000_drop_user_roles_and_has_role.sql`, plus the bootstrap membership backfill in
`20260603120100_add_org_id_to_tenant_tables.sql`. Spec `2026-06-03-multi-tenancy-design.md` §§4.1,
5.1, 8, 8.1, 12. PRs #77, #78, #80, #92.
