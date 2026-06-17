# Architecture Decision Records (ADRs)

This directory holds **Architecture Decision Records** — short documents that capture a
significant, hard-to-reverse decision, the context that forced it, the options we weighed,
and the consequences we accepted. They exist so future contributors (human or AI) can
understand *why* the system is shaped the way it is, not just *what* it does.

## When to write one

Write an ADR when a decision:

- is expensive or disruptive to reverse (data model, tenancy model, sync ownership), **or**
- chooses between credible alternatives that a reasonable person would question later, **or**
- establishes a convention the rest of the codebase must follow.

Routine, easily-reversible choices do **not** need an ADR — put those in the relevant spec
under `docs/superpowers/specs/`.

## Format

Use the template below (Nygard-style, lightly extended). One decision per file.

```markdown
# ADR-NNNN: Title

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-XXXX
**Date:** YYYY-MM-DD
**Deciders:** who signed off

## Context
## Decision
## Options Considered
## Trade-off Analysis
## Consequences
## Action Items
```

## Conventions

- Filename: `NNNN-kebab-case-title.md`, zero-padded, monotonically increasing.
- Never edit the **Decision** of an Accepted ADR in place. To change course, write a new ADR
  and mark the old one `Superseded by ADR-XXXX`.
- Link ADRs to the spec(s) that implement them and vice-versa.

## Index

ADRs are numbered in the order they were **recorded**, not the order decided — see each ADR's
**Date**. ADRs 0002–0008 were recorded retroactively on 2026-06-16 from PR, migration, and
design-spec history; they capture decisions already shipped (multi-tenancy, roles, onboarding,
testing, DB-computed status, the availability→blocked_dates shift, and the removed show-date UI).
Where the original sources did not document the reasoning, the ADR says so and marks the rationale
as reconstructed.

| ADR | Title | Decision date | Status |
|-----|-------|---------------|--------|
| [0001](0001-airtable-system-of-record.md) | Airtable is the system of record; Showflow mirrors and maps | 2026-06-16 | Accepted |
| [0002](0002-testability-foundation.md) | Testability foundation — edge-function DI, data-access extraction, five test layers | 2026-06-01 | Accepted |
| [0003](0003-pooled-multi-tenancy-isolation.md) | Pooled multi-tenancy — denormalized `org_id`, RESTRICTIVE isolation, derive triggers | 2026-06-03 | Accepted |
| [0004](0004-per-org-roles.md) | Per-org roles in `org_memberships`; retire global `user_roles`/`has_role` | 2026-06-03 | Accepted |
| [0005](0005-invite-only-onboarding.md) | Invite-only onboarding; retire signup → approval queue | 2026-06-03 | Accepted |
| [0006](0006-db-computed-show-date-status.md) | `show_dates.status` computed in the database by triggers | 2026-05-13 | Accepted |
| [0007](0007-drop-availability-for-blocked-dates.md) | Drop `availability` in favour of `blocked_dates` | 2026-05-14 | Accepted |
| [0008](0008-no-show-date-creation-ui.md) | No in-app UI for creating show dates | pre-2026-06-03 | Accepted |
| [0009](0009-extensible-synced-fields.md) | Extensible synced fields via per-entity JSONB + registry (not dynamic DDL) | 2026-06-16 | Accepted |
