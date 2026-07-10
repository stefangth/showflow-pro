# Email delivery monitoring — System Health console Phase 2 — design

**Status:** Draft for review (brainstorming complete; approach + UI mockup approved in session)
**Date:** 2026-07-11
**Author:** Stefan Schaal (with Claude)
**Related:** System Health console Phase 1 `docs/superpowers/specs/2026-06-24-system-health-console-phase1-design.md`
(this is the "Email delivery" domain it foresaw — see its *Out of scope* line: *"Email delivery (incl. the
real `send-transactional-email` 500s)"*); the Resend/GDPR email work in
`docs/superpowers/specs/2026-06-22-gdpr-data-compliance-design.md`; memories `system-health-console-initiative`,
`cron-health-watcher-false-timeouts`.

## Context & goal

The `/platform` **System Health** tab (Phase 1) monitors Scheduled jobs and Edge functions on a universal
4-state model, and `DomainSummaryGrid` already reserves **"Email delivery"** as a muted *"Not monitored yet"*
placeholder. This spec lights up that slot.

**A blocking discovery came out of exploration:** the transactional-email pipeline is *deployed but has no
backing tables in production.* `send-transactional-email` (v68) and the Resend webhook
`handle-email-suppression` (v65) both read/write `email_send_log`, `suppressed_emails`, and
`email_unsubscribe_tokens` — **none of which exist** (confirmed via `to_regclass` = null, the applied-migration
list, and generated types). Consequences:

1. **There is no data to monitor** — `email_send_log`, the natural spine for delivery health, was never created.
2. **Sends are failing right now** — [`send-transactional-email/index.ts:80`](../../../supabase/functions/send-transactional-email/index.ts)
   checks the suppression list *fail-closed*; a missing `suppressed_emails` table makes that query error and
   return `500` before anything sends. The offer/confirmation digests and invitation emails have been silently
   500ing. (Matches the `send-transactional-email` 500s noted in the Phase 1 spec and in memory.)

So "email delivery monitoring" here is two layers: **build the data foundation** (which also un-breaks sending),
then **surface it** in the console. Scope confirmed in session: **full** — foundation + monitoring + alerting.
Metrics scope confirmed: **deliverability only** (`sent / delivered / delayed / bounced / complained / failed`) —
**no** opens/clicks (avoids Resend tracking-pixel config and the GDPR-consent dependency; the model stays open to
adding engagement later).

This spec is one implementation plan.

## Decisions (locked)

1. **One row per message, updated in place (a state machine)** — *not* the current insert-per-transition, and
   *not* a two-table append-only event log (rejected as over-built for a health console — YAGNI). `email_send_log`
   holds one row per email; the send function transitions it `pending → sent | failed | suppressed | pref_disabled`
   and stamps `resend_id` on `sent`; the webhook transitions `sent → delivered | delivery_delayed | bounced |
   complained` by matching `resend_id`.
2. **Mirror the existing cron-health machinery, don't fork it** — a `get_email_health` RPC (twin of
   `get_cron_health`), a `deriveEmailStatus` beside `deriveJobStatus` in `src/lib/systemHealth.ts`, the same
   `StatusPill`/`StatusDot`/`Card` primitives, and an `email-health-watcher` cron twin of `cron-health-watcher`.
3. **Same universal 4-state model.** **Operational** / **Degraded** (bounce >2%, complaint >0.1%, any send-failure,
   or delivery <95%) / **Down** (bounce >5%, complaint >0.3%, or all-sends-fail) / **Stale** — a deliberately useful
   twist: *sending but zero delivery webhooks received* → the Resend webhook is likely misconfigured (monitoring
   the monitor).
4. **Deliverability only** (see goal). Opens/clicks out of scope.
5. **GDPR posture:** store the full recipient (needed to act on bounces) under **super-admin-only RLS**, **redacted
   in the UI**; a **daily prune** drops rows older than **90 days** (configurable via a platform `app_settings`
   key); `anonymize_user` scrubs the recipient on erasure.
6. **View-only console.** No resend/retry actions from the UI in this phase.

## Data model

### `email_send_log` (new) — one row per message

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `message_id` | uuid **unique** | internal id (send fn's `crypto.randomUUID()`); the send fn's update key |
| `resend_id` | text **unique** null | Resend's `email_id`; the webhook's match key (nullable unique → many NULLs for pre-send terminal rows) |
| `org_id` | uuid null | `references organizations(id) on delete set null` |
| `template_name` | text not null | |
| `recipient_email` | text not null | full address; RLS-guarded, redacted in UI |
| `status` | text not null | CHECK in (`pending`,`sent`,`delivered`,`delivery_delayed`,`bounced`,`complained`,`failed`,`suppressed`,`pref_disabled`) |
| `error_message` | text null | Resend error / bounce reason |
| `metadata` | jsonb not null default `'{}'` | e.g. `{resend_id}` echo, webhook `email_id` |
| `created_at` | timestamptz not null default now() | attempt time (window filter key) |
| `sent_at` / `delivered_at` / `delayed_at` / `bounced_at` / `complained_at` | timestamptz null | event stamps |
| `updated_at` | timestamptz not null default now() | `update_updated_at_column()` trigger |

Indexes: `(created_at desc)`, `(resend_id)`, `(status)`, `(template_name)`, `(org_id)`.
RLS: **enabled**; `select` only where `is_super_admin(auth.uid())`; writes via service role only (no `authenticated`
insert/update/delete policy). Add the RESTRICTIVE `org_isolation` policy only if we later expose per-org reads — not
this phase (log is platform-level, `org_id` nullable).

### `suppressed_emails` (new) — unblocks sending

`email` text pk (lowercased), `reason` text (`bounce`/`complaint`/`manual`), `metadata` jsonb, `created_at`. Matches
what `handle-email-suppression` and `send-transactional-email` already query. RLS: super-admin select; service-role writes.

### `email_unsubscribe_tokens` (new)

`token` text pk, `email` text **unique** (lowercased), `used_at` timestamptz null, `created_at`. Matches the columns
`send-transactional-email` and `handle-email-unsubscribe` already use. RLS: no `authenticated` access (service-role /
edge-function only; the unsubscribe handler runs service-role).

> Creating `suppressed_emails` + `email_unsubscribe_tokens` is the minimum that makes the send path stop 500ing;
> `email_send_log` is the monitoring spine. All three ship in one migration.

### `email_health_state` (new) — alert de-dupe

Single global row (`id bool pk default true`, `last_state text`, `last_alerted_at timestamptz`, `updated_at`).
Twin of `cron_health_state`; lets the watcher fire only on **transitions** into Degraded/Down.

## Status derivation (the testable core)

Add to the pure `src/lib/systemHealth.ts` (no I/O → unit-tested directly):

```
interface EmailHealth {
  attempted; sent; delivered; delayed; bounced; complained; failed; suppressed;
  deliveryRate; bounceRate; complaintRate; failureCount; lastEventAt; ...
}
interface EmailThresholds { bounceWarn:0.02; bounceDown:0.05; complaintWarn:0.001; complaintDown:0.003; deliveryWarn:0.95 }

deriveEmailStatus(h, t): HealthState
  if h.attempted === 0                                   -> 'operational'   // idle: nothing to report
  if h.sent === 0                                        -> h.failed > 0 ? 'down' : 'operational'  // all-fail vs all-suppressed
  if h.delivered + h.delayed + h.bounced + h.complained === 0 -> 'stale'    // sending, zero delivery webhooks → webhook gap
  if h.bounceRate > t.bounceDown || h.complaintRate > t.complaintDown       -> 'down'
  if h.bounceRate > t.bounceWarn || h.complaintRate > t.complaintWarn
     || h.failureCount > 0 || h.deliveryRate < t.deliveryWarn               -> 'degraded'
  return 'operational'
```

`sent` = rows that reached Resend (`sent|delivered|delivery_delayed|bounced|complained`); rates use `sent` as the
denominator. `suppressed` (pre-send skip) is expected/healthy, never a fault. Thresholds are deliverability-industry
norms; they live in a new `EMAIL_HEALTH` block in [`app.config.ts`](../../../src/config/app.config.ts) alongside
`SYSTEM_HEALTH` (`{ ...thresholds, windowMinutes: 1440, windowOptions: [1440, 10080], alertWindowMinutes: 180,
minVolumeForAlert: 20, failureAlertCount: 3 }`).

## Part 1 — Migration (DB)

One migration creates the four tables above (+ RLS, indexes, `update_updated_at_column` trigger on `email_send_log`),
plus:

- **`get_email_health(p_window_minutes int default 1440) returns jsonb`** — `SECURITY DEFINER`, guarded
  `if not is_super_admin(auth.uid()) then raise exception 'not authorized'`. Returns a single object:
  `{ window_minutes, attempted, sent, delivered, delayed, bounced, complained, failed, suppressed, delivery_rate,
  bounce_rate, complaint_rate, failure_count, last_event_at, by_template:[{template_name, sent, delivered, bounced,
  failed, delivery_rate}], recent_issues:[{recipient_email, template_name, status, error_message, occurred_at}] }`
  (recent_issues = last ~25 where status in `failed,bounced,complained,suppressed`, newest first). `grant execute to
  authenticated`. Cast at the data-access boundary (types.ts lags new RPCs — same pattern as `fetchCronHealth`).
- **`prune_email_log()`** + a `pg_cron` job `email-log-prune` (daily ~03:30) deleting rows older than
  `coalesce(app_settings 'email_log_retention_days', 90)` days.
- **`app_settings`** platform-default seed: `email_log_retention_days = 90`.
- **`anonymize_user`** (existing RPC) — extend to `update email_send_log set recipient_email = '[anonymized]'` for the
  erased user's address (new migration altering the function).

## Part 2 — Event capture (edge functions)

- **`send-transactional-email`** — replace the insert-per-transition logging with a single-row state machine keyed by
  `message_id`: insert `pending` up front; update to `suppressed` / `pref_disabled` on the pre-send gates; update to
  `sent` + set `resend_id` (from `sendData.id`) on 200; update to `failed` + `error_message` on Resend non-2xx. One
  row per attempt. No other behavior change. (Now that `suppressed_emails` exists, the fail-closed 500 is gone.)
- **`handle-email-suppression`** — expand from bounce/complaint-only to the full deliverability lifecycle. Map
  `email.sent`→`sent`, `email.delivered`→`delivered`, `email.delivery_delayed`→`delivery_delayed`,
  `email.bounced`→`bounced`, `email.complained`→`complained`. For each, **UPDATE** `email_send_log` where
  `resend_id = data.email_id`, stamping the matching `*_at`; if 0 rows match (event beat the send-row write, or row
  pruned), **INSERT** a fallback row so counts stay accurate. Keep the existing `suppressed_emails` upsert for
  bounce/complaint. Signature/verification unchanged. **Keep the function name** (renaming an edge function needs a
  manual `functions delete` per CLAUDE.md) — note the widened role in comments + system map.

## Part 3 — Alerting (edge function + cron)

New **`supabase/functions/email-health-watcher/index.ts`**, twin of `cron-health-watcher`:
`export async function handle(req, deps)` + bottom-wired `Deno.serve`; `config.toml`
`[functions.email-health-watcher] verify_jwt = false`; cron auth via `requireCronOrRole` (`X-Cron-Secret`).
Logic: compute email health over `alertWindowMinutes` (via `get_email_health` or inline SQL, service-role); derive
state; compare to `email_health_state.last_state`; on a **transition into** Degraded/Down insert a `notifications`
row (`type='email_health_degraded'`, `related_entity_type='system'`) **for each super-admin** (from `platform_admins`)
and update the state row; on recovery to Operational, update state (recovery notice optional). **Guards against false
alarms:** rate-based alerts require `sent ≥ minVolumeForAlert`; failure alerts require `failure_count ≥
failureAlertCount`. **No email alert** — the thing monitored is email; in-app only. Mirror
`cron-health-watcher`'s exact super-admin-notification insert. Register a `pg_cron` schedule (every 15 min).

## Part 4 — Data access + hook (frontend)

- [`src/data/platform.ts`](../../../src/data/platform.ts): add `EmailHealth` interface + `fetchEmailHealth(client,
  windowMinutes)` → `client.rpc('get_email_health', { p_window_minutes })`. The RPC returns a **snake_case** jsonb
  object; `fetchEmailHealth` **maps** it to the camelCase `EmailHealth` (and its nested `by_template` / `recent_issues`
  arrays) at this boundary — not a bare cast — so the panel consumes stable camelCase fields.
- [`src/hooks/useSystemHealth.ts`](../../../src/hooks/useSystemHealth.ts): add `useEmailHealth(windowMinutes)` — key
  `['platform','email-health', windowMinutes]`, `refetchInterval: SYSTEM_HEALTH.refetchMs`, `retry: 1`. A metrics
  failure must **not** blank the tab (same resilience contract as `useEdgeFnMetrics`).

## Part 5 — Components (frontend)

- **`src/components/platform/systemHealth/EmailDeliveryPanel.tsx`** (matches the approved mockup): `Card` titled
  "Email delivery" + `StatusPill`; a **window toggle** (24h / 7d, local state → drives `useEmailHealth`); an alert
  callout when Degraded/Down; a KPI row of 4 metric tiles (delivery / bounce / complaint rates, send-failure count),
  color-coded against thresholds; a composition bar (delivered / delayed / bounced / failed) with legend; **By
  template** bordered rows; **Recent issues** rows (redacted recipient + status badge + reason + relative time); a
  **webhook-heartbeat** footer line (`last_event_at`; explains the Stale state). All semantic tokens; `font-display`
  heading; `Skeleton` loading; `Alert variant="destructive"` on query error.
- **`DomainSummaryGrid.tsx`** — remove `"Email delivery"` from `PLACEHOLDERS`.
- **`SystemHealthTab.tsx`** — call `useEmailHealth`, derive the email `HealthState`, add the live `email` domain to
  `DomainSummaryGrid`, fold it into the overall `worstStatus`, render `<EmailDeliveryPanel/>`.
- **`redactEmail` (frontend)** — small helper in `src/lib/` (reuse if one already exists) for the recent-issues list.

## Testing (test-first — the five layers)

| Layer | What |
|---|---|
| Unit (pure) | `deriveEmailStatus` full matrix: idle / all-suppressed / all-fail(down) / sending-no-webhooks(stale) / bounce>2%&>5% / complaint>0.1%&>0.3% / send-failure / delivery<95% / healthy. |
| Data-access | `fetchEmailHealth` vs `src/test/supabaseFake.ts` — asserts `rpc('get_email_health',{p_window_minutes})`, maps the object, surfaces errors. |
| Database (pgTAP) | `get_email_health` super-admin guard (non-super → error) + rate math + window filter on seeded rows; `email_send_log` RLS (super-admin select only; others denied; no `authenticated` write); `prune_email_log`; `anonymize_user` recipient scrub. |
| Edge (Deno) | `send-transactional-email` state machine (pending→sent sets `resend_id`; →failed; →suppressed/pref_disabled) via `makeFakeDeps`; `handle-email-suppression` lifecycle update-by-`resend_id` for delivered/delayed/bounced/complained + insert-fallback + still upserts `suppressed_emails`; `email-health-watcher` transition-only alerting + min-volume/failure-count guards + cron-secret gate. |
| Component | `EmailDeliveryPanel` render states (operational/degraded/down/stale/idle) + recipient redaction + metrics-unavailable fallback; `DomainSummaryGrid` no longer shows the Email-delivery placeholder. |

Run the **whole** `supabase/functions/` Deno suite after the webhook/send changes (per memory
`edge-fn-multi-test-files`), and add `--node-modules-dir=none` per the local-env memory.

## Secrets & deploy prerequisites

- **`RESEND_WEBHOOK_SECRET`** — already consumed by `handle-email-suppression`; verify it is set (webhook 401s without it).
- **Resend dashboard (USER action — not automatable here):** subscribe the webhook endpoint to `email.sent`,
  `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained` (today it likely only fires
  bounce/complaint). If this is skipped, sends still record but delivery events don't — and the new **Stale** state
  surfaces exactly that gap.
- **Resend from-domain** must be verified, or Resend returns `422` — which now records as `failed` and shows in the
  panel (visible instead of silent).
- **Cron secret** for `email-health-watcher` (`X-Cron-Secret`) — reuse the existing cron-secret pattern.
- `config.toml`: add `[functions.email-health-watcher]` (`verify_jwt = false`). Both new/changed functions
  auto-deploy on merge to `main`; the two `pg_cron` jobs land via the migration.
- **System map:** update `docs/system-map.md` **and** `src/data/systemMap.ts` in this PR (new email-capture flow +
  watcher + prune), per CLAUDE.md.
- **Versioning:** MINOR bump (new user-facing platform feature) in `package.json` + `APP_META.VERSION`, plus a
  `public/changelog.md` block and regenerated `changelog.json`.

## Risks & mitigations

- **Webhook not configured for the full lifecycle** → the **Stale** state is designed to catch it; flagged as a user
  action above.
- **`resend_id` race** (delivery webhook lands before the send-row write) → webhook UPDATE-then-INSERT-fallback keeps
  counts correct.
- **Recipient PII at rest** → super-admin-only RLS, UI redaction, 90-day prune, `anonymize_user` scrub.
- **Send behavior changes** (creating `suppressed_emails` turns always-500 into actually-sending) → intended, but
  verify the Resend from-domain first; failures now surface as `failed` rows rather than silent 500s.
- **Low-volume false alerts** (2 bounces of 3 = 66%) → `minVolumeForAlert` + `failureAlertCount` guards.
- **types.ts lag** for the new RPC/tables → cast at the data-access boundary (same as `fetchCronHealth`).

## Out of scope

- Opens/clicks engagement metrics (decided out; model stays extensible).
- Per-org email-health surface for org admins (`org_id` is captured now; deferred to a later phase).
- Resend/retry-from-UI actions (view-only this phase).
- Historical backfill (no prior data exists; the log starts empty and fills forward).
- The other console domains (Database, Org sync, Auth/Storage) — later phases, each its own spec.
