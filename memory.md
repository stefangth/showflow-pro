# memory.md — Showflow Pro Project State

> Living document. Update this whenever significant decisions are made, features land, or known issues change. Do not put secrets here.

---

## Current date

2026-05-17

---

## Active branches

| Branch | Purpose |
|--------|---------|
| `main` | Production — never push directly |
| `dev` | Integration target for PRs |
| `claude/update-documentation-CbfSj` | Current Claude Code session (docs update) |

---

## In progress

_(nothing active)_

---

## Feature flag status

| Flag | Value | Notes |
|------|-------|-------|
| `AIRTABLE_SYNC` | `false` | Polling loop not wired; Settings page toggles a flag the future sync worker will read |
| `AUTO_SUGGEST` | `true` | Scoring weights not yet in static config; logic lives in edge functions |
| `NOTIFICATIONS` | `true` | `notifications` table present in DB |
| `UNDERSTUDY` | `true` | Auto-promote on primary cancellation |
| `AUDIT_TRAIL` | `true` | `booking_audit_log` table — never delete rows |

---

## Known issues / tech debt

| Issue | Impact | Notes |
|-------|--------|-------|
| No seed-test-data edge function | Dev setup friction | AGENTS.md referenced it but it was never built; create test accounts manually via signup + admin approval |
| Near-zero test coverage | Risk | Only `src/test/example.test.ts` exists (trivial assertion); no component or integration tests |
| Airtable sync fully mocked | Feature gap | Real polling loop not implemented |

---

## Architectural decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| (initial) | Roles in `user_roles`, never `profiles` | Allows multiple roles per user; enforced by `has_role()` security-definer |
| (initial) | RLS is source of truth; client `hasRole()` is UX only | Prevents client-side bypass |
| (initial) | Week starts Monday app-wide | Consistency with show industry norms |
| (initial) | Chat locks after 30 days (`CHAT_ARCHIVE_DAYS`) | Prevents stale message threads; admins can still view |
| (initial) | Booking states: suggested → soft_booked → confirmed (or cancelled) | Mirrors industry booking workflow |
| (initial) | Supabase is external project, not Lovable Cloud | Separate lifecycle control |
| 2026-04-26 | AGENTS.md replaced by CLAUDE.md | Consolidated and expanded; added git workflow, env setup, testing, error handling, new-page checklist, feature flags, notification patterns |

---

## Environment

Required env vars (never commit to git):

```
VITE_SUPABASE_URL=https://<project-id>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
VITE_SUPABASE_PROJECT_ID=<project-id>
```

Edge functions additionally use `SUPABASE_SERVICE_ROLE_KEY` (set in Supabase dashboard, not in `.env`).

---

## Recent changes

| Date | Change |
|------|--------|
| 2026-05-17 | Updated `CLAUDE.md` and `memory.md` — corrected FLAGS→FEATURES, added editor module, artists/ dir, missing pages, ProtectedRoute prop name, clarified DB-stored booking settings |
| 2026-04-26 | Restored `ArtistsPage` — re-wired routing and nav (admin + producer only) |
| 2026-04-26 | Built `src/features/editor/` — admin-only UI editor mode (page access, column templates, table permissions stored in `app_settings`) |
| 2026-04-26 | Created `CLAUDE.md` — full project guidance for AI agents (expanded from AGENTS.md) |
| 2026-04-26 | Created `memory.md` — this living state tracker |
| 2026-04-26 | Deleted `AGENTS.md` — content migrated to `CLAUDE.md` |
