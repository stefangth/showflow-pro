# memory.md — Showflow Pro Project State

> Living document. Update this whenever significant decisions are made, features land, or known issues change. Do not put secrets here.

---

## Current date

2026-06-15

---

## Active branches

| Branch | Purpose |
|--------|---------|
| `main` | Production — never push directly |
| `dev` | Integration target for PRs |
| `claude/tender-bohr-cssjge` | Current Claude Code session (docs update) |

---

## In progress

_(nothing active)_

---

## Feature flag status

| Flag | Value | Notes |
|------|-------|-------|
| `AUTO_SUGGEST` | `true` | Scoring weights not in static config; logic lives in edge functions |
| `NOTIFICATIONS` | `true` | `notifications` table present in DB |
| `UNDERSTUDY` | `true` | Auto-promote on primary cancellation |
| `AUDIT_TRAIL` | `true` | `booking_audit_log` table — never delete rows |

---

## Known issues / tech debt

| Issue | Impact | Notes |
|-------|--------|-------|
| No seed-test-data edge function | Dev setup friction | Bootstrap the first admin out-of-band (Supabase dashboard + `org_memberships` insert), then use Admin → Invites for subsequent users |
| `app_origin` / `SITE_URL` hardening | Security | Invite action-link base URL should be read from a server-side env var rather than a client-supplied `app_origin` field — deferred follow-up from Phase 5 |
| Revoke-invite confirmation dialog | UX | Revoke action has no confirmation step yet |
| Resend-invite `expires_at` bump | Bug | Resending an invite does not extend `expires_at` on the existing row |

---

## Architectural decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| (initial) | Roles in `org_memberships` (per-org), never `profiles` | Allows multiple roles per user, per org; enforced by `has_org_role()` + `is_org_member()` security-definer functions |
| (initial) | RLS is source of truth; client `hasRole()` / `isSuperAdmin` is UX only | Prevents client-side bypass |
| (initial) | Week starts Monday app-wide | Consistency with show industry norms |
| (initial) | Chat locks after 30 days (`CHAT_ARCHIVE_DAYS`) | Prevents stale message threads; admins can still view |
| (initial) | Booking states: suggested → soft_booked → confirmed (or cancelled) | Mirrors industry booking workflow |
| (initial) | Supabase is external project, not Lovable Cloud | Separate lifecycle control |
| 2026-04-26 | AGENTS.md replaced by CLAUDE.md | Consolidated and expanded; added git workflow, env setup, testing, error handling, new-page checklist, feature flags, notification patterns |
| 2026-06-03 | `user_roles` / `has_role` / `user_approvals` retired → `org_memberships` | Multi-tenancy Phase 0–1: all role checks now go through `has_org_role(uid, org_id, role)` / `is_org_member(uid, org_id)`; old global table dropped |
| 2026-06-03 | Onboarding is invite-only (no public signup, no approval queue) | Org admin invites via `create-invitation` edge fn; invitee accepts via `/accept-invite?token=` → `accept_invitation` RPC |
| 2026-06-04 | `app_settings` is per-org with platform-default fallback | `org_id IS NULL` = platform default; per-org overrides win. `get_org_setting(org, key)` in DB; `resolveOrgSetting` / `upsertOrgSetting` in `src/data/settings.ts` + `_shared/settings.ts` |
| 2026-06-04 | Airtable API key stored in Supabase Vault per org | `set_org_airtable_key` RPC (admin-guarded) writes to Vault; `get_org_airtable_key` (service-role-only) reads it in `airtable-poll` |
| 2026-06-04 | Platform super-admin console at `/platform` gated by `isSuperAdmin` | `platform_admins` table + `is_super_admin()` security-definer (short-circuits org checks in RLS); `requireSuperAdmin` in `_shared/auth.ts` for edge functions |
| 2026-06-05 | Profile page + password reset implemented | `/profile` (edit display name/phone, in-app change-password); `/reset-password` (request + set modes, public) |

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
| 2026-06-15 | Updated `CLAUDE.md` and `memory.md` — documented platform console, per-org settings model, new pages (ProfilePage, ResetPasswordPage, PlatformPage), new hooks (useMyProfile, useOrgMembers), new edge functions (provision-org, resend-invitation), `src/data/` architecture, Vault-backed Airtable keys; removed stale SYNC_CONFIG reference and "no pages yet" notes |
| 2026-06-05 | Multi-tenancy Phase 5: ProfilePage + ResetPasswordPage + password change, invite unification (Supabase action-link for net-new users in org-invitation email), MembersTab (list/remove org members via list_org_members / remove_org_member RPCs), org-admin resend-invite button (#94/#95) |
| 2026-06-04 | Multi-tenancy Phase 4: platform super-admin console (`/platform`) — provision-org, platform_admins table, is_super_admin() RPC, requireSuperAdmin, god-mode view-as, org metrics, PlatformPage + components/platform/ (#92/#93) |
| 2026-06-04 | Multi-tenancy Phase 3: all cron/digest/email/Airtable edge functions made org-aware; derive-org_id-from-parent triggers on all FK-child tenant tables; per-org Airtable key in Supabase Vault; dropped bootstrap org_id DEFAULTs (#91) |
| 2026-06-04 | Multi-tenancy Phase 2: app_settings.org_id nullable (platform-default fallback), get_org_setting() DB fn, resolveOrgSetting/upsertOrgSetting frontend + edge, per-org editor config, per-org skill/city catalogs (#90) |
| 2026-06-03 | Multi-tenancy Phase 1C: InvitesTab (Admin → Invites), AcceptInvitePage, LoginPage redirect support, OrgSwitcher sidebar, ProtectedRoute org gate (NoOrgScreen / SuspendedOrgScreen), create-invitation edge fn + org-invitation email (#81–#84) |
| 2026-06-03 | Multi-tenancy Phase 1A/1B: org_memberships as source of truth, requireOrgRole, admin-set-role/admin-list-users org-scoped, SettingsPage producer dropdown org-scoped (#77–#80) |
| 2026-06-03 | Retired user_roles / has_role / user_approvals / ApprovalGate / admin-decide-approval / notify-signup entirely (#79–#80/#86) |
| 2026-06-03 | Removed dead Google sign-in button and signInWithGoogle from AuthContext (#88/#89) |
| 2026-05-30 | Updated `CLAUDE.md` and `memory.md` — documented GDPR consent system, public PrivacyPage + ImpressumPage routes, `docs/legal/` directory, `ConsentProvider` app wrapper, and `useConsent()` usage pattern |
| 2026-05-28 | Added GDPR privacy policy, impressum, and cookie consent system (#65) |
| 2026-05-28 | Show inline error on failed login, hid Google sign-in button (#64) |
| 2026-05-28 | Fixed cast inheritance invalidation chain (#62) |
| 2026-05-28 | Fixed: hide block-date button when artist already has a booking (#60) |
