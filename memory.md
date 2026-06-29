# memory.md — Showflow Pro Project State

> Living document. Update this whenever significant decisions are made, features land, or known issues change. Do not put secrets here.

---

## Current date

2026-06-29

---

## Active branches

| Branch | Purpose |
|--------|---------|
| `main` | Production — never push directly |
| `dev` | Integration target for PRs |
| `claude/tender-bohr-jmc7tj` | Current Claude Code session (docs update) |

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

Note: `AIRTABLE_SYNC` was removed from `FEATURES` in app.config.ts. Airtable sync is now fully implemented; it is enabled per-org via the `airtable_sync_enabled` key in `app_settings`.

---

## Known issues / tech debt

| Issue | Impact | Notes |
|-------|--------|-------|
| No seed-test-data edge function | Dev setup friction | Must bootstrap first org admin out-of-band (Supabase dashboard); org admin then invites others via Admin → Invites |

---

## Architectural decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| (initial) | Roles in `org_memberships` (per-org), never `profiles` | Multi-org support; enforced by `has_org_role()` / `is_org_member()` security-definer functions |
| (initial) | RLS is source of truth; client `hasRole()` is UX only | Prevents client-side bypass |
| (initial) | Week starts Monday app-wide | Consistency with show industry norms |
| (initial) | Chat locks after 30 days (`CHAT_ARCHIVE_DAYS`) | Prevents stale message threads; admins can still view |
| (initial) | Booking states: suggested → soft_booked → confirmed (or cancelled) | Mirrors industry booking workflow |
| (initial) | Supabase is external project, not Lovable Cloud | Separate lifecycle control |
| 2026-04-26 | AGENTS.md replaced by CLAUDE.md | Consolidated and expanded; added git workflow, env setup, testing, error handling, new-page checklist, feature flags, notification patterns |
| 2026-06-04 | Multi-tenancy: `app_settings` now per-org (org_id column) with platform-default fallback | Enables per-org configuration without duplicating the schema; `get_org_setting` / `resolveOrgSetting` encapsulate the two-row merge |
| 2026-06-04 | Super-admin model: `platform_admins` table + `is_super_admin()` + `PlatformRoute` | Separates god-mode (cross-org) from org-admin (single-org); super-admins bypass org gates without touching RLS |
| 2026-06-04 | Per-org Airtable API key in Supabase Vault | Keeps credentials out of app_settings (unencrypted JSONB) and enables true multi-tenancy for Airtable sync |
| 2026-06-04 | Data-access layer: all Supabase calls live in `src/data/<domain>.ts` as plain functions taking the client | Makes the data layer independently testable via the supabaseFake harness; hooks become thin wrappers |

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
| 2026-06-29 | Updated `CLAUDE.md` and `memory.md` — documented all changes from PRs #121–141 (see below) |
| 2026-06-27 | Sidebar restyle (#141) — two-tone wordmark, section-grouped nav (WORKSPACE/CATALOG/SYSTEM), role-specific count badges, bottom profile card, `useNavCounts` hook, font smoothing fix |
| 2026-06-26 | Design system settings/platform alignment (#140) — neutral surface aliases, semantic tint tokens, `--veil`, badge semantic tint pattern, accent scale locked as literal hex, fixed opacity-modifier breakage |
| 2026-06-25 | Design system token spec (#139) — elevation system, radius/spacing/motion/density scales, dark-mode accent fix, `rounded-xs/pill` + `shadow-elev*` Tailwind utilities |
| 2026-06-24 | Productions configurable columns + Airtable linked-record sync (#137) — `airtable-schema` Mode C (linked-record enumeration), `airtable-poll` resolves `multipleRecordLinks` → names, Productions columns via editor column-template system; released **v1.6.0** |
| 2026-06-24 | Platform System Health console Phase 1 + cron-watcher timeout hotfix (#136) — `platform-edge-metrics` edge function (Management API proxy), `src/lib/systemHealth.ts` 4-state derivation, `SYSTEM_HEALTH` config, `SystemHealthTab` rewritten, cron dispatch timeout raised to 30s |
| 2026-06-24 | Airtable mapping autosave (#135) — `src/data/airtableSettings.ts`, tab-owned React Query schema cache, `AutosaveStatus` indicator, AirtableSyncTab decoupled from page draft; released **v1.5.2** |
| 2026-06-23 | Docs: key decisions → ADR README; supersede ADR-0008 (in-app show-date creation shipped) (#134) |
| 2026-06-23 | bun.lock migrated off Lovable private npm mirror (#132), lovable-tagger devDependency dropped (#131), Lovable build tooling retired from vite.config.ts (#127) |
| 2026-06-23 | CI: auto-deploy edge functions on merge to main (#130) — `.github/workflows/deploy-functions.yml`, `config.toml` pins `verify_jwt` for all 18 functions |
| 2026-06-23 | Fix email recipient lookup (#129) — `get_user_id_by_email` RPC (service-role only) replaces paginated `listUsers` scan in `send-transactional-email` |
| 2026-06-23 | Restore booking-engine + cron-health monitoring (#126) — `cron-health-watcher` edge function, `cron_health_scan`/`get_cron_health` RPCs, 3 cron-health tables, `cron-health-alert` email template, System Health tab in platform console |
| 2026-06-22 | GDPR compliance (#125) — `notification_preferences` table with per-user `category × channel` opt-out, `gate_notification_pref` trigger, `export_my_data` / `anonymize_user` / `delete_org` RPCs, `delete-my-account` / `export-org-data` edge functions |
| 2026-06-22 | Airtable deploy + key management (#124) — Vault RPCs `get_org_airtable_key_status` / `delete_org_airtable_key`, `src/data/airtableKey.ts`; released **v1.4.1** |
| 2026-06-22 | Admin & member self-service (#121) — `rename_org` + `set_org_member_role` RPCs, Settings → Organization tab, Members tab inline role change, retired `admin-set-role` edge function |
| 2026-06-22 | App-logic docs refresh + remove inert `soft_book_expiry_hours` setting (#122), retire `sub_program_slots_defaults` (#123) |
| 2026-06-08 | Updated `CLAUDE.md` and `memory.md` — documented multi-tenancy phases 1–5 (per-org settings, super-admin model, platform console, `src/data/` layer, new hooks/pages/edge functions) |
| 2026-06-05 | Multi-tenancy Phase 5 (#94) — ProfilePage + ResetPasswordPage implemented, `useMyProfile`, MembersTab, `resend-invitation` edge function, invite unification |
| 2026-06-04 | Multi-tenancy Phase 4 (#92) — Platform console (`/platform` route, `PlatformPage`, `components/platform/`, `provision-org` edge function, super-admin model, `isSuperAdmin` in AuthContext) |
| 2026-06-04 | Multi-tenancy Phase 3 (#91) — all cron/booking-engine edge functions org-aware, per-org Airtable Vault key, `org_id` derivation triggers, `_shared/settings.ts` |
| 2026-06-04 | Multi-tenancy Phase 2 (#90) — `app_settings` per-org schema, `get_org_setting` DB function, `resolveOrgSetting` / `upsertOrgSetting` in frontend + edge, per-org editor config |
| 2026-05-30 | Updated `CLAUDE.md` and `memory.md` — documented GDPR consent system |
| 2026-05-28 | Added GDPR privacy policy, impressum, and cookie consent system (#65) |
| 2026-05-28 | Show inline error on failed login, hid Google sign-in button (#64) |
| 2026-05-28 | Fixed cast inheritance invalidation chain (#62) |
| 2026-04-26 | Created `CLAUDE.md`, `memory.md`; built `src/features/editor/`; restored `ArtistsPage` |
