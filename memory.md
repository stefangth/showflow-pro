# memory.md — Showflow Pro Project State

> Living document. Update this whenever significant decisions are made, features land, or known issues change. Do not put secrets here.

---

## Current date

2026-06-01

---

## Active branches

| Branch | Purpose |
|--------|---------|
| `main` | Production — never push directly |
| `dev` | Integration target for PRs |
| `claude/tender-bohr-sdqvC` | Current Claude Code session (docs audit) |

---

## In progress

_(nothing active)_

---

## Feature flag status

| Flag | Value | Notes |
|------|-------|-------|
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
| 2026-06-01 | Updated `CLAUDE.md` and `memory.md` — removed stale `SYNC_CONFIG` reference (deleted in #68), noted `PendingApprovalScreen`/`RejectedScreen` live in `src/pages/`, removed `AIRTABLE_SYNC` feature flag (deleted), removed "Airtable sync mocked" known issue (now implemented via `airtable-poll` scheduled edge function) |
| 2026-06-01 | Remove mock data from database and UI strings (#68) — wired up `airtable-poll` edge function with real Airtable API calls scheduled via pg_cron (`*/5 * * * *`); removed `AIRTABLE_SYNC` feature flag and `SYNC_CONFIG` constants from `app.config.ts` |
| 2026-05-30 | Updated `CLAUDE.md` and `memory.md` — documented GDPR consent system (`features/consent/`, `components/consent/`), public PrivacyPage + ImpressumPage routes, `docs/legal/` directory, `ConsentProvider` app wrapper, and `useConsent()` usage pattern |
| 2026-05-28 | Added GDPR privacy policy, impressum, and cookie consent system (#65) — `features/consent/ConsentContext`, `components/consent/CookieConsentBanner` + `CookieConsentDialog`, public PrivacyPage + ImpressumPage, `docs/legal/` with EN/DE markdown docs, login page footer links |
| 2026-05-28 | Show inline error on failed login, hid Google sign-in button (#64) |
| 2026-05-28 | Fixed cast inheritance invalidation chain (#62) — bookings query key busting |
| 2026-05-28 | Fixed: hide block-date button when artist already has a booking (#60) |
| 2026-05-17 | Updated `CLAUDE.md` and `memory.md` — corrected FLAGS→FEATURES, added editor module, artists/ dir, missing pages, ProtectedRoute prop name, clarified DB-stored booking settings |
| 2026-04-26 | Restored `ArtistsPage` — re-wired routing and nav (admin + producer only) |
| 2026-04-26 | Built `src/features/editor/` — admin-only UI editor mode (page access, column templates, table permissions stored in `app_settings`) |
| 2026-04-26 | Created `CLAUDE.md` — full project guidance for AI agents (expanded from AGENTS.md) |
| 2026-04-26 | Created `memory.md` — this living state tracker |
| 2026-04-26 | Deleted `AGENTS.md` — content migrated to `CLAUDE.md` |
