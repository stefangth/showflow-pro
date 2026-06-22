# Data & compliance (GDPR) — design

**Date:** 2026-06-22
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Initiative:** Self-service — sub-project #4 of 4, the last one (see memory `self-service-initiative.md`)

## Context

The self-service initiative's drivers are **(1) get the operator out of the loop** and
**(2) cut customer support**. Sub-projects #1 (show/date CRUD, PR #118), #2 (onboarding docs),
and #3 (admin & member self-service, PR #121) have shipped. This is **#4: data & compliance** —
the real GDPR gap. Today the only privacy self-service is a single global email unsubscribe;
there is no data export, no account or org deletion, and no granular notification control.

Ships as **one cohesive "Data & Compliance" branch/PR** covering all three pillars (the user may
still implement it in internal slices, but it lands together).

### Current state (verified)

- **Personal data spans many tables.** `profiles` (global login identity: `display_name`,
  `phone`; login email is `auth.users.email`), `artists` (per-org talent: `name`, `email`,
  `phone`, `bio`; `user_id` nullable — ADR-0011), `bookings`, `chat_messages` (`body`,
  `user_id`), availability/`blocked_dates`, `notifications`, `org_memberships`,
  `org_invitations`, and `booking_audit_log`.
- **The erasure-vs-retention tension is concrete.** `booking_audit_log` is "never delete"
  (CLAUDE.md) and carries `performed_by` (nullable user FK) + `org_id` + a `details` JSONB. GDPR
  erasure conflicts with that immutability.
- **Identity model (ADR-0011).** `profiles` = one global row per auth user (spans all orgs);
  `artists` = per-org, `user_id` nullable. A registered artist has both; an **unregistered**
  artist (`user_id` null) has only the per-org `artists` row and no account — so they cannot
  self-delete; only an org admin / super-admin can erase them. Resolution helpers live in
  `supabase/functions/_shared/identity.ts`.
- **Notification delivery has two channels.** In-app (`notifications` table) and email
  (transactional + daily digests). Canonical in-app `type` values (from triggers + functions):
  `booking_confirmed`, `booking_ready_to_confirm`, `tier_at_risk`, `cast_escalation_requested`,
  `schedule_change` / `session_added` / `session_removed` / `session_retimed`, booking
  `cancelled`. Notification-emitting **DB triggers** live in several migrations (e.g.
  `20260514240000_booking_notification_trigger.sql`,
  `20260620130000_show_date_cancellation.sql`,
  `20260519000000_promote_understudy_on_cancellation.sql`).
- **Email templates** (registry `supabase/functions/_shared/transactional-email-templates/registry.ts`):
  `artist-offer-digest`, `artist-confirmation-digest`, `cast-escalation-requested`,
  `org-invitation`, plus legacy signup templates. `org-invitation` and password reset are
  **critical/transactional** — always send.
- **Only opt-out today** is a global, token-based email unsubscribe:
  `handle-email-unsubscribe` writes `suppressed_emails`; `send-transactional-email` checks
  `suppressed_emails` (fail-closed) by **recipient email** before sending and issues an
  unsubscribe token. There is no per-category or per-type control and no in-app opt-out.
- **Org "deletion" does not exist.** `organizations` only has `status` (`active` | `suspended`),
  managed super-admin-only via `setOrgStatus` / `updateOrg` (`src/data/platform.ts`) and
  `EditOrgDialog` in the Platform console. `show_dates.show_id` is `ON DELETE CASCADE`.
- **Account deletion does not exist.** `ProfilePage` (`src/pages/ProfilePage.tsx`) edits display
  name/phone and changes password; no delete or export. Deleting `auth.users` requires the auth
  **admin API** (service role) → must be edge-function-fronted.
- **A last-admin guard already exists** for member removal (`remove_org_member`,
  `set_org_member_role`) — race-safe via `lock table org_memberships in share row exclusive
  mode`. Account self-deletion reuses this pattern.
- **`SettingsPage` already has an admin-only Notifications tab** (`value="notifications"`) — that
  is **org-level** config, not per-user. The per-user preference matrix is a different surface
  and belongs on `ProfilePage`.
- **Current version is `1.4.0`** (`package.json` + `APP_META.VERSION` in
  `src/config/app.config.ts`). This feature set is a MINOR bump → **`1.5.0`**.

## Goals

1. **Self-serve data export** — any user downloads their own personal data as portable JSON
   (GDPR Art. 15 access + Art. 20 portability); a super-admin can export any org's full dataset.
2. **Deletion** — any user can delete their own account (self-service); a super-admin can delete
   an entire org. Both honor the never-delete audit rule via anonymize-and-retain.
3. **Granular notification preferences** — a category × channel (email / in-app) matrix per user,
   with critical transactional email always sending.

## Non-goals (explicitly out of scope)

- **Org deletion by org admins** — too catastrophic for a single admin; stays super-admin-only,
  immediate (org admins request it from a super-admin). No soft-delete / grace-period / scheduled
  purge job.
- **Per-org notification preferences** — prefs are **per-user global** for v1. (An artist in two
  orgs can't yet mute one org's offers but not the other's — deferred.)
- **Admin per-org export by org admins** — org-level export is super-admin only (pairs with
  super-admin-only org deletion: the platform operator owns org-level data requests).
- **Human-readable export (PDF/HTML)** — JSON only for v1 (portability is the requirement).
- **Reworking the org-level Settings → Notifications tab** — untouched; per-user prefs are a new
  surface on `ProfilePage`.

## Decisions (made during brainstorm)

- **All three pillars, one cohesive release.**
- **Erasure = anonymize-and-retain (tombstone).** Hard-delete the auth account, profile, and
  purely-personal rows; anonymize shared/audit records (null the user link, replace embedded PII
  with a generic tombstone). Audit trail stays intact but de-identified.
- **Org deletion = super-admin only, immediate** tombstone purge.
- **Account deletion = self-service**, blocked by the **last-admin guard** (can't orphan an org;
  GDPR "legitimate grounds" limitation — hand off or have the org deleted first).
- **Export = per-user self-serve JSON + super-admin per-org/global export.**
- **Notification prefs = category × channel matrix**, per-user global, opt-out default; critical
  transactional email (`org-invitation`, password reset) never gated; the existing global
  unsubscribe link remains the "all non-critical email off" master.

## Design

### Architecture split

Pure-SQL operations → `SECURITY DEFINER` RPCs (pgTAP-testable). Anything needing the auth admin
API or that aggregates a large payload → edge functions (DI pattern, fake-deps-testable). This
pillar adds **1 table**, **3 RPCs**, **3 new edge functions** + **1 edited** edge function, and
frontend surfaces. Migrations are applied via the Supabase MCP `apply_migration` (records
real-timestamp versions; name the files to match) and types regenerated via MCP; vitest / pgTAP /
lint / build run in CI only (no local Node); the Deno suite runs locally with
`--node-modules-dir=none`.

### Pillar 1 — Notification preferences (category × channel)

**Table `notification_preferences`** (new migration):
- `user_id uuid primary key references auth.users(id) on delete cascade`, `prefs jsonb not null
  default '{}'::jsonb`, `updated_at timestamptz` (with the `update_updated_at_column()` trigger).
- `prefs` maps `category -> { "email": bool, "in_app": bool }`. **Opt-out model:** a missing row
  or missing key/channel = **enabled**, so existing users keep receiving everything until they
  change something.
- RLS: enable + policies so a user `select`/`insert`/`update`s only `where user_id = auth.uid()`
  (plus the RESTRICTIVE `org_isolation`? — N/A, this table has no `org_id`; it is user-scoped, not
  tenant-scoped). Edge functions read via the service role.

**Category map** `src/config/notificationCategories.ts` (TS) — `type string -> category`, the
single source of truth, mirrored by a SQL helper for trigger use. Proposed categories (final
mapping comes from the implementation-time audit of every emit site):
- **Booking offers** — `artist-offer-digest` (email), suggested-booking in-app.
- **Booking confirmations** — `artist-confirmation-digest` (email), `booking_confirmed` (in-app).
- **Booking activity (producers)** — `booking_ready_to_confirm` (in-app).
- **Schedule changes** — `schedule_change`, `session_added/removed/retimed`, booking `cancelled`.
- **At-risk & escalations** — `tier_at_risk`, `cast_escalation_requested` (+ the
  `cast-escalation-requested` email).
- **Excluded (always-on):** `org-invitation`, password reset, and any template/type not in the
  map → never gated.

**Enforcement — two points:**
1. **Email.** In `send-transactional-email`, after the existing `suppressed_emails` check: resolve
   the recipient address → `user_id` (auth lookup), map `templateName` → category; if mapped, call
   `should_notify(user, category, 'email')` and skip the send (logging `reason:
   'pref_disabled'`) when false. **Fail open** for unmapped/critical templates and when the
   address can't be resolved to a user — never block an invite or password reset. The two digest
   senders (`send-offer-digest`, `send-confirmation-digest`) apply the same per-recipient gate.
2. **In-app.** A SQL helper `should_notify(p_user uuid, p_category text, p_channel text) returns
   boolean` (`SECURITY DEFINER`, defaults true on missing row/key). The notification-emitting
   **triggers** call it before inserting, so DB-side notifications respect prefs too. Any
   application-side `notifications` insert (edge functions) routes through the same check.

**RPC `should_notify`** is `SECURITY DEFINER`, reads `notification_preferences`, returns the
channel boolean (true when absent). Pure SQL → pgTAP-tested.

### Pillar 2 — Data export (JSON)

**Per-user: RPC `export_my_data() returns jsonb`** (`SECURITY DEFINER`):
- Aggregates the caller's own rows: `profiles`, `artists` (all orgs), `bookings` (via the
  caller's artist rows), availability/`blocked_dates`, `chat_messages` authored, `notifications`,
  `org_memberships`. Returns one document: `{ schema_version, exported_at, account: {...},
  artists: [...], bookings: [...], ... }`. Empty relations serialize as `[]` (valid doc even with
  zero artist records). Pure SQL → pgTAP-tested.
- Data access `src/data/account.ts`: `exportMyData(client)` → `rpc('export_my_data')`.
- UI: a "Download my data" card on `ProfilePage` calls it and triggers a client-side
  `showflow-export-<YYYY-MM-DD>.json` download (Blob + anchor).

**Super-admin: edge function `export-org-data`** (`requireSuperAdmin`):
- Body `{ org_id }`. Returns the whole org bundle (members, artists, shows, show_dates, bookings,
  booking_audit_log, chats/messages). Edge function (not RPC) because payloads can be large and it
  composes several reads. DI-pattern, fake-deps-tested.
- Data access `src/data/platform.ts`: `exportOrgData(client, orgId)`; UI button in
  `EditOrgDialog` (Platform console) downloads the bundle.

### Pillar 3 — Deletion (anonymize-and-retain)

**Core RPC `anonymize_user(p_user uuid)`** (`SECURITY DEFINER`, idempotent) — the SQL half only:
- `artists where user_id = p_user`: `name` → `'Deleted artist'`, `email`/`phone`/`bio` → `null`,
  `user_id` → `null` (across **all** orgs).
- `chat_messages where user_id = p_user`: `user_id` → `null` (body retained as shared history).
- `booking_audit_log where performed_by = p_user`: `performed_by` → `null` (row retained —
  never-delete honored).
- Hard-delete `notifications`, availability/`blocked_dates` (by the user's artist rows),
  `org_memberships`, and pending `org_invitations` for the user; delete `profiles where user_id =
  p_user`.
- Does **not** touch `auth.users` (that is the edge function's job) and does **not** delete
  `bookings` (kept; the artist is already anonymized).
- Guard: callable only by the account owner's edge function or a super-admin path — enforce via
  `revoke from public/anon`, `grant execute to authenticated`, and an internal check that
  `auth.uid() = p_user OR is_super_admin(auth.uid())`.

**Edge function `delete-my-account`** (authenticated):
- Run the **last-admin guard** (reuse the member-removal logic: block if the caller is the sole
  admin of any org) → 409 with a clear "you are the last admin of <org>; appoint another admin or
  have the org deleted first" message.
- Call `anonymize_user(self)`, then `deps.admin.auth.admin.deleteUser(self)`.
- Client: on success, sign out and route to login.

**Edge function `delete-org`** (`requireSuperAdmin`):
- Body `{ org_id }`. For every member of the org, call `anonymize_user(member)`; then delete the
  `organizations` row (org-scoped rows cascade via existing FKs). One transaction where possible.
- Data access `src/data/platform.ts`: `deleteOrg(client, orgId)`; UI in `EditOrgDialog` "Danger
  zone" with a type-the-org-name confirm.

### Frontend surfaces (summary)

- **`ProfilePage` = personal account hub.** Existing Details + Password, plus three new cards:
  **Notification preferences** (category × channel switch grid; `useNotificationPreferences` read
  + `useUpdateNotificationPreferences` write), **Download my data** (export button), **Delete
  account** (`destructive` card → type-`DELETE` confirm dialog; inline last-admin block message).
- **Platform console `EditOrgDialog` Danger zone** (super-admin): "Export org data" + "Delete
  organization" (type-the-name confirm).
- **No new routes.**

## Testing (test-first; the five layers)

- **Unit (vitest + `src/test/supabaseFake.ts` + `renderWithProviders`)**: data-access fns
  (`fetchNotificationPreferences`/`updateNotificationPreferences`, `exportMyData`,
  `deleteMyAccount`, `exportOrgData`, `deleteOrg`) assert the RPC/function name + args;
  `notificationCategories` map + `should_notify` projection; `ProfilePage` cards (matrix toggle,
  export download wiring, delete confirm-gating + last-admin message); `EditOrgDialog` danger
  zone.
- **pgTAP (CI)**: `anonymize_user` (artists anonymized, chat/audit `performed_by` nulled, personal
  rows gone, `booking_audit_log` rows still present, idempotent on re-run); `export_my_data`
  (returns only the caller's rows, has `schema_version`); `notification_preferences` RLS
  (own-row-only); `should_notify` (true on missing row/key, respects an explicit `false`).
- **Edge (Deno DI, `_shared/testing.ts`)**: `delete-my-account` (last-admin guard blocks; happy
  path calls anonymize + `deleteUser`), `delete-org` (super-admin gate; non-super-admin 403),
  `export-org-data` (gate + bundle shape), and the `send-transactional-email` category gate
  (suppressed-by-pref vs critical-always-sends vs unresolvable-recipient-fails-open). Run the
  **whole** `supabase/functions/` Deno suite afterward (per the `edge-fn-multi-test-files` memory).
- **E2E (Playwright, optional)**: toggle a category off, download the export, open the
  delete-account confirm.

## Files touched

**New**
- `supabase/migrations/<ts>_notification_preferences.sql` (table + RLS + `should_notify` +
  `update_updated_at` trigger)
- `supabase/migrations/<ts>_anonymize_user.sql`
- `supabase/migrations/<ts>_export_my_data.sql`
- `supabase/migrations/<ts>_trigger_notification_prefs.sql` (route notification-emitting triggers
  through `should_notify`)
- `supabase/functions/delete-my-account/` (+ DI tests)
- `supabase/functions/delete-org/` (+ DI tests)
- `supabase/functions/export-org-data/` (+ DI tests)
- `src/config/notificationCategories.ts` (+ test)
- `src/data/notificationPreferences.ts` (+ test)
- `src/data/account.ts` — `exportMyData`, `deleteMyAccount` (+ test)
- `src/hooks/useNotificationPreferences.ts` (+ test)
- `supabase/tests/*` pgTAP for the new/changed RPCs

**Modified**
- `src/pages/ProfilePage.tsx` (three new cards) (+ test)
- `src/components/platform/EditOrgDialog.tsx` (danger zone) (+ test)
- `src/data/platform.ts` — `exportOrgData`, `deleteOrg` (+ test)
- `supabase/functions/send-transactional-email/index.ts` (per-category email gate) (+ test)
- `supabase/functions/send-offer-digest/index.ts`, `send-confirmation-digest/index.ts`
  (per-recipient category gate)
- the notification-emitting trigger migration(s) (call `should_notify`)
- `package.json` + `src/config/app.config.ts` (`1.5.0`)
- `public/changelog.md` (newest-first `1.5.0` block) + regenerate `public/changelog.json` via
  `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
- `CLAUDE.md` (new edge fns; the deletion/anonymization model; notification-prefs decision; export)

## Edge cases & error handling

- **Re-deletion / idempotency** — `anonymize_user` re-run is a no-op (nulls already null, rows
  already gone).
- **Empty export** — a user with zero artist records exports a valid doc with `[]` arrays.
- **Multi-org artist** — anonymized in **all** orgs on self-delete.
- **Unregistered artists** (`user_id` null) — untouched by self-delete; only admin/super-admin
  erase them (via org deletion or future admin tooling).
- **Prefs absent** — `should_notify` returns true (everything on) — no migration backfill needed.
- **Email gate fails open** — unmapped/critical templates and unresolvable recipients always send;
  the gate only ever *suppresses* a known non-critical category the user explicitly disabled.
- **Last admin self-delete** — blocked with a clear message; the user can still be erased after
  handing off admin or having the org deleted.
- **Org delete cascade** — rely on existing FKs after anonymizing members; verify no
  `RESTRICT`/`NO ACTION` FK blocks the `organizations` delete (audit-log retains `org_id` but the
  org row goes — confirm the audit-log FK is `set null` / nullable, not `restrict`).

## Risks & mitigations

- **Auth admin delete is irreversible** — gate behind a type-to-confirm dialog; the last-admin
  guard prevents orphaning; anonymize *before* `deleteUser` so a failure leaves a recoverable
  state (re-runnable).
- **Trigger-routing regressions** — changing notification triggers risks silencing wanted
  notifications; pgTAP covers `should_notify` defaults and the whole Deno suite + existing trigger
  tests guard behavior. Default-on keeps current behavior for everyone until they opt out.
- **Recipient→user resolution in the email gate** — if the address can't be mapped, fail open;
  never let pref logic block transactional mail.
- **`booking_audit_log` FK to `organizations`** — confirm org delete doesn't violate a
  `restrict`; if it does, null `org_id` for the deleted org's audit rows as part of `delete-org`
  (still "never delete the row").
- **Large org export** — keep `export-org-data` an edge function (streaming/256MB headroom) rather
  than an RPC; paginate internally if needed.
