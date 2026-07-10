# Email Delivery Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Email delivery" domain to the super-admin System Health console, backed by a durable send/event log that also un-breaks transactional email, plus a threshold-based super-admin alert watcher.

**Architecture:** Create the three missing email tables (`email_send_log`, `suppressed_emails`, `email_unsubscribe_tokens`) plus an alert-state table; capture the full Resend deliverability lifecycle as a one-row-per-message state machine (send fn writes the row, the Resend webhook updates it by `resend_id`); expose aggregates through a service-role `email_health_snapshot` RPC wrapped by a super-admin `get_email_health`; derive a 4-state health with a pure `deriveEmailStatus` mirrored across the TS frontend and the Deno watcher; render an `EmailDeliveryPanel` and alert super-admins on Degraded/Down transitions. Everything mirrors the existing cron-health machinery rather than forking it.

**Tech Stack:** React 18 + TS + Vite, Tailwind + shadcn, TanStack Query v5, Supabase (Postgres + RLS + RPCs + `pg_cron`), Deno edge functions with dependency injection, Resend. Tests: Vitest (unit/data/component), pgTAP (DB), Deno test (edge).

## Global Constraints

- **Local exec reality (this env is Deno-only — memory `env-no-node-supabase-cli`):** Deno edge tests run locally with `deno test --allow-all --node-modules-dir=none <file>`. **Vitest, pgTAP, and eslint run in CI**, not locally — write those tests and treat their "run" steps as CI verification. **Migrations apply via the Supabase MCP `apply_migration`** (records a real-timestamp version — name the migration to match; never hand-write files under `supabase/migrations/`).
- **Edge-function DI:** every function exports `handle(req, deps)` and wires `Deno.serve((req) => handle(req, realDeps()))` only at the bottom. Tests import `handle` + `makeFakeDeps`/`makeRequest` from `supabase/functions/_shared/testing.ts`. Use `_shared/http.ts` (`preflight`, `json`), `_shared/auth.ts`, `_shared/deps.ts` — never re-inline CORS/clients/auth.
- **Cross-runtime mirror rule:** `deriveEmailStatus` + thresholds exist twice — `src/lib/systemHealth.ts` (frontend) and `supabase/functions/_shared/emailHealth.ts` (Deno). Neither runtime can import the other; each carries a `// MIRROR: keep in sync with <other path>` comment (same rule as `BOOKING_ENGINE_DEFAULTS`).
- **RLS template:** every new table `ENABLE ROW LEVEL SECURITY`; reads gated by `is_super_admin(auth.uid())`; **no** `WITH CHECK (true)` write policy (writes come from service role / `pg_cron`, which bypass RLS).
- **Query keys:** hierarchical `['platform', …]`. Semantic tokens only (`text-warning`, `bg-success`, …); `font-display` for card titles. Loading → shadcn `Skeleton`; query error → `Alert variant="destructive"`.
- **Deliverability only** — no opens/clicks. **Recipient PII** stored full (super-admin RLS) but **redacted in the UI**.
- **Versioning:** MINOR bump `1.8.1 → 1.9.0` in `package.json` **and** `APP_META.VERSION` in `src/config/app.config.ts`; add a `public/changelog.md` block and regenerate `public/changelog.json` (`deno run --allow-read --allow-write scripts/changelog-to-json.ts`).
- **Automation-map rule:** any automation change updates **both** `docs/system-map.md` and `src/data/systemMap.ts` in this PR.
- **Naming:** DB `snake_case`; components `PascalCase`; hooks `useThing`; commit messages imperative, lowercase, ≤72 chars.

---

### Task 1: Email health thresholds + pure `deriveEmailStatus` (frontend)

**Files:**
- Modify: `src/config/app.config.ts` (add `EMAIL_HEALTH` after `SYSTEM_HEALTH_BUDGET`, ~line 58)
- Modify: `src/lib/systemHealth.ts` (add `EmailHealth`, `EmailHealthThresholds`, `deriveEmailStatus`)
- Test: `src/lib/systemHealth.emailStatus.test.ts`

**Interfaces:**
- Produces: `EMAIL_HEALTH` (config object); `interface EmailHealth`; `deriveEmailStatus(h: EmailHealth, t: EmailHealthThresholds): HealthState`. Consumed by Tasks 9–11.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/systemHealth.emailStatus.test.ts
import { describe, it, expect } from "vitest";
import { deriveEmailStatus, type EmailHealth } from "@/lib/systemHealth";
import { EMAIL_HEALTH } from "@/config/app.config";

const t = EMAIL_HEALTH;
const base: EmailHealth = {
  attempted: 0, sent: 0, delivered: 0, delayed: 0, bounced: 0, complained: 0,
  failed: 0, suppressed: 0, deliveryRate: 0, bounceRate: 0, complaintRate: 0,
  failureCount: 0, lastEventAt: null, byTemplate: [], recentIssues: [],
};

describe("deriveEmailStatus", () => {
  it("idle (no attempts) → operational", () => {
    expect(deriveEmailStatus(base, t)).toBe("operational");
  });
  it("all suppressed pre-send → operational", () => {
    expect(deriveEmailStatus({ ...base, attempted: 5, suppressed: 5 }, t)).toBe("operational");
  });
  it("everything failed pre-Resend → down", () => {
    expect(deriveEmailStatus({ ...base, attempted: 4, failed: 4, failureCount: 4 }, t)).toBe("down");
  });
  it("sending but zero delivery webhooks → stale", () => {
    expect(deriveEmailStatus({ ...base, attempted: 30, sent: 30 }, t)).toBe("stale");
  });
  it("bounce 2.9% (>2%, <5%) → degraded", () => {
    expect(deriveEmailStatus({ ...base, attempted: 241, sent: 241, delivered: 233, bounced: 7, deliveryRate: 0.967, bounceRate: 0.029 }, t)).toBe("degraded");
  });
  it("bounce 6% (>5%) → down", () => {
    expect(deriveEmailStatus({ ...base, attempted: 100, sent: 100, delivered: 94, bounced: 6, deliveryRate: 0.94, bounceRate: 0.06 }, t)).toBe("down");
  });
  it("complaint 0.4% (>0.3%) → down", () => {
    expect(deriveEmailStatus({ ...base, attempted: 250, sent: 250, delivered: 249, complained: 1, deliveryRate: 0.996, complaintRate: 0.004 }, t)).toBe("down");
  });
  it("any send failure alongside healthy delivery → degraded", () => {
    expect(deriveEmailStatus({ ...base, attempted: 51, sent: 50, delivered: 50, failed: 1, failureCount: 1, deliveryRate: 1 }, t)).toBe("degraded");
  });
  it("healthy delivery, no faults → operational", () => {
    expect(deriveEmailStatus({ ...base, attempted: 100, sent: 100, delivered: 100, deliveryRate: 1 }, t)).toBe("operational");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/systemHealth.emailStatus.test.ts` (CI)
Expected: FAIL — `deriveEmailStatus` / `EMAIL_HEALTH` not exported.

- [ ] **Step 3: Add `EMAIL_HEALTH` to config**

In `src/config/app.config.ts`, after the `SYSTEM_HEALTH_BUDGET` block (~line 58):

```ts
/** Email-delivery health thresholds + windows for the System Health "Email delivery" domain.
 *  Rates are deliverability-industry norms. Alert-only knobs (window/min-volume) gate the watcher. */
export const EMAIL_HEALTH = {
  /** Warn/critical bounce fraction (0..1). */
  bounceWarn: 0.02,
  bounceDown: 0.05,
  /** Warn/critical spam-complaint fraction (0..1). */
  complaintWarn: 0.001,
  complaintDown: 0.003,
  /** Below this delivery fraction (0..1) the domain reads Degraded. */
  deliveryWarn: 0.95,
  /** Panel default lookback (minutes) + the toggle options (24h / 7d). */
  windowMinutes: 1440,
  windowOptions: [1440, 10080] as const,
  /** Watcher-only: rolling alert window + false-alarm guards. */
  alertWindowMinutes: 180,
  minVolumeForAlert: 20,
  failureAlertCount: 3,
} as const;
```

- [ ] **Step 4: Add types + `deriveEmailStatus` to `src/lib/systemHealth.ts`**

Append to `src/lib/systemHealth.ts`:

```ts
/** Per-template delivery breakdown row (from get_email_health). */
export interface EmailTemplateStat {
  templateName: string; sent: number; delivered: number; bounced: number; failed: number; deliveryRate: number;
}
/** One actionable recent issue (failed/bounced/complained/suppressed). */
export interface EmailIssue {
  recipientEmail: string; templateName: string; status: string; errorMessage: string | null; occurredAt: string;
}
/** Aggregated email-delivery health over a window. Mirrors get_email_health's mapped shape. */
export interface EmailHealth {
  attempted: number; sent: number; delivered: number; delayed: number; bounced: number;
  complained: number; failed: number; suppressed: number;
  deliveryRate: number; bounceRate: number; complaintRate: number; failureCount: number;
  lastEventAt: string | null; byTemplate: EmailTemplateStat[]; recentIssues: EmailIssue[];
}
export interface EmailHealthThresholds {
  bounceWarn: number; bounceDown: number; complaintWarn: number; complaintDown: number; deliveryWarn: number;
}

/**
 * Pure 4-state derivation for email delivery. `sent` = reached Resend; rates use it as denominator.
 * `suppressed` (pre-send skip) is healthy, never a fault.
 * MIRROR: keep in sync with supabase/functions/_shared/emailHealth.ts (Deno watcher copy).
 */
export function deriveEmailStatus(h: EmailHealth, t: EmailHealthThresholds): HealthState {
  if (h.attempted === 0) return "operational";                 // idle
  if (h.sent === 0) return h.failed > 0 ? "down" : "operational"; // all-fail vs all-suppressed
  if (h.delivered + h.delayed + h.bounced + h.complained === 0) return "stale"; // no delivery webhooks
  if (h.bounceRate > t.bounceDown || h.complaintRate > t.complaintDown) return "down";
  if (h.bounceRate > t.bounceWarn || h.complaintRate > t.complaintWarn ||
      h.failureCount > 0 || h.deliveryRate < t.deliveryWarn) return "degraded";
  return "operational";
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/systemHealth.emailStatus.test.ts` (CI)
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add src/config/app.config.ts src/lib/systemHealth.ts src/lib/systemHealth.emailStatus.test.ts
git commit -m "feat: add email-health thresholds and pure deriveEmailStatus"
```

---

### Task 2: Migration — email tables + RLS (un-breaks sending)

**Files:**
- Create (via MCP `apply_migration`, name `email_delivery_tables`): `supabase/migrations/<ts>_email_delivery_tables.sql`
- Test: `supabase/tests/email_send_log_rls.sql` (pgTAP, CI)

**Interfaces:**
- Produces tables `email_send_log`, `suppressed_emails`, `email_unsubscribe_tokens`, `email_health_state`; app_settings seed `email_log_retention_days = 90`. Consumed by Tasks 3–8.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/email_send_log_rls.sql
BEGIN;
SELECT plan(4);
SELECT has_table('public', 'email_send_log', 'email_send_log exists');
SELECT has_table('public', 'suppressed_emails', 'suppressed_emails exists');
SELECT has_table('public', 'email_unsubscribe_tokens', 'email_unsubscribe_tokens exists');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_send_log'::regclass),
  true, 'RLS enabled on email_send_log');
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run to verify it fails**

Run: `supabase test db` (CI)
Expected: FAIL — relations do not exist.

- [ ] **Step 3: Apply the migration**

Apply via Supabase MCP `apply_migration`, name `email_delivery_tables`, SQL:

```sql
-- email_send_log: one row per transactional email (a state machine).
-- send-transactional-email inserts 'pending' then updates; handle-email-suppression
-- updates by resend_id as Resend delivery events arrive.
CREATE TABLE public.email_send_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     uuid NOT NULL UNIQUE,
  resend_id      text UNIQUE,
  org_id         uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  template_name  text NOT NULL,
  recipient_email text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','sent','delivered','delivery_delayed',
                                     'bounced','complained','failed','suppressed','pref_disabled')),
  error_message  text,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  delivered_at   timestamptz,
  delayed_at     timestamptz,
  bounced_at     timestamptz,
  complained_at  timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_send_log_created_idx  ON public.email_send_log (created_at DESC);
CREATE INDEX email_send_log_status_idx   ON public.email_send_log (status);
CREATE INDEX email_send_log_template_idx ON public.email_send_log (template_name);
CREATE INDEX email_send_log_org_idx      ON public.email_send_log (org_id);
CREATE TRIGGER email_send_log_updated_at
  BEFORE UPDATE ON public.email_send_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- suppressed_emails: bounce/complaint suppression list. Creating this un-breaks the
-- fail-closed suppression check in send-transactional-email.
CREATE TABLE public.suppressed_emails (
  email      text PRIMARY KEY,
  reason     text NOT NULL DEFAULT 'manual' CHECK (reason IN ('bounce','complaint','manual')),
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- email_unsubscribe_tokens: one-click List-Unsubscribe tokens.
CREATE TABLE public.email_unsubscribe_tokens (
  token      text PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- email_health_state: single global row for alert de-dupe (twin of cron_health_state).
CREATE TABLE public.email_health_state (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_state    text NOT NULL DEFAULT 'operational'
                  CHECK (last_state IN ('operational','pending','degraded','down','stale')),
  last_alerted_at timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.email_health_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.email_send_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppressed_emails       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_health_state      ENABLE ROW LEVEL SECURITY;

-- Super-admin reads only; writes come from service role / pg_cron (bypass RLS). No WITH CHECK(true).
CREATE POLICY "super-admin reads email_send_log"    ON public.email_send_log    FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "super-admin reads suppressed_emails" ON public.suppressed_emails FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "super-admin reads email_health_state" ON public.email_health_state FOR SELECT USING (is_super_admin(auth.uid()));
-- email_unsubscribe_tokens: no authenticated access at all (service-role-only unsubscribe handler).

INSERT INTO public.app_settings (org_id, key, value, description) VALUES
  (NULL, 'email_log_retention_days', '90'::jsonb, 'Days to retain email_send_log rows before the daily prune')
ON CONFLICT (org_id, key) DO NOTHING;
```

- [ ] **Step 4: Re-run to verify it passes**

Run: `supabase test db` (CI)
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_email_delivery_tables.sql supabase/tests/email_send_log_rls.sql
git commit -m "feat: add email_send_log, suppression, unsubscribe, health-state tables"
```

---

### Task 3: Migration — `email_health_snapshot` + `get_email_health` RPCs

**Files:**
- Create (MCP `apply_migration`, name `email_health_rpcs`): `supabase/migrations/<ts>_email_health_rpcs.sql`
- Test: `supabase/tests/get_email_health.sql` (pgTAP, CI)

**Interfaces:**
- Produces `email_health_snapshot(int) → jsonb` (service_role) and `get_email_health(int) → jsonb` (authenticated, super-admin-guarded). Consumed by Task 8 (snapshot) and Task 9 (get_email_health). Returned keys are **snake_case**: `attempted, sent, delivered, delayed, bounced, complained, failed, suppressed, delivery_rate, bounce_rate, complaint_rate, failure_count, last_event_at, by_template[], recent_issues[]`.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/get_email_health.sql
BEGIN;
SELECT plan(3);

-- Seed: 100 reached Resend, 94 delivered, 6 bounced.
INSERT INTO public.email_send_log (message_id, resend_id, template_name, recipient_email, status, created_at, sent_at, delivered_at)
SELECT gen_random_uuid(), 'r'||g, 'offer_digest', g||'@t.test', 'delivered', now(), now(), now()
FROM generate_series(1,94) g;
INSERT INTO public.email_send_log (message_id, resend_id, template_name, recipient_email, status, created_at, sent_at, bounced_at, error_message)
SELECT gen_random_uuid(), 'b'||g, 'offer_digest', g||'@b.test', 'bounced', now(), now(), now(), 'mailbox not found'
FROM generate_series(1,6) g;

SELECT is((public.email_health_snapshot(1440)->>'sent')::int, 100, 'sent counts rows that reached Resend');
SELECT is(round((public.email_health_snapshot(1440)->>'bounce_rate')::numeric, 3), 0.060, 'bounce_rate = 6/100');
-- get_email_health raises for non-super-admins (auth.uid() is null in test → not super).
SELECT throws_ok('SELECT public.get_email_health(1440)', NULL, NULL, 'get_email_health rejects non-super-admin');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run to verify it fails**

Run: `supabase test db` (CI)
Expected: FAIL — functions do not exist.

- [ ] **Step 3: Apply the migration**

Apply via Supabase MCP `apply_migration`, name `email_health_rpcs`, SQL:

```sql
-- Raw aggregation over a lookback window. Service-role only (the watcher + the
-- super-admin wrapper). No auth.uid() guard here — access is gated by GRANT.
CREATE OR REPLACE FUNCTION public.email_health_snapshot(p_window_minutes int DEFAULT 1440)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH w AS (
    SELECT * FROM public.email_send_log
    WHERE created_at >= now() - make_interval(mins => p_window_minutes)
  ),
  agg AS (
    SELECT
      count(*)                                                              AS attempted,
      count(*) FILTER (WHERE status IN ('sent','delivered','delivery_delayed','bounced','complained')) AS sent,
      count(*) FILTER (WHERE status = 'delivered')       AS delivered,
      count(*) FILTER (WHERE status = 'delivery_delayed') AS delayed,
      count(*) FILTER (WHERE status = 'bounced')         AS bounced,
      count(*) FILTER (WHERE status = 'complained')      AS complained,
      count(*) FILTER (WHERE status = 'failed')          AS failed,
      count(*) FILTER (WHERE status IN ('suppressed','pref_disabled')) AS suppressed,
      max(greatest(delivered_at, bounced_at, complained_at, delayed_at)) AS last_event_at
    FROM w
  )
  SELECT jsonb_build_object(
    'window_minutes', p_window_minutes,
    'attempted', a.attempted, 'sent', a.sent, 'delivered', a.delivered, 'delayed', a.delayed,
    'bounced', a.bounced, 'complained', a.complained, 'failed', a.failed, 'suppressed', a.suppressed,
    'delivery_rate',  CASE WHEN a.sent > 0 THEN a.delivered::numeric  / a.sent ELSE 0 END,
    'bounce_rate',    CASE WHEN a.sent > 0 THEN a.bounced::numeric    / a.sent ELSE 0 END,
    'complaint_rate', CASE WHEN a.sent > 0 THEN a.complained::numeric / a.sent ELSE 0 END,
    'failure_count',  a.failed,
    'last_event_at',  a.last_event_at,
    'by_template', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'template_name', t.template_name,
        'sent',      t.sent, 'delivered', t.delivered, 'bounced', t.bounced, 'failed', t.failed,
        'delivery_rate', CASE WHEN t.sent > 0 THEN t.delivered::numeric / t.sent ELSE 0 END)
        ORDER BY t.sent DESC)
      FROM (
        SELECT template_name,
          count(*) FILTER (WHERE status IN ('sent','delivered','delivery_delayed','bounced','complained')) AS sent,
          count(*) FILTER (WHERE status = 'delivered') AS delivered,
          count(*) FILTER (WHERE status = 'bounced')   AS bounced,
          count(*) FILTER (WHERE status = 'failed')    AS failed
        FROM w GROUP BY template_name
      ) t), '[]'::jsonb),
    'recent_issues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'recipient_email', i.recipient_email, 'template_name', i.template_name,
        'status', i.status, 'error_message', i.error_message, 'occurred_at', i.created_at)
        ORDER BY i.created_at DESC)
      FROM (
        SELECT recipient_email, template_name, status, error_message, created_at
        FROM w WHERE status IN ('failed','bounced','complained','suppressed')
        ORDER BY created_at DESC LIMIT 25
      ) i), '[]'::jsonb)
  )
  FROM agg a;
$$;
REVOKE ALL ON FUNCTION public.email_health_snapshot(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_health_snapshot(int) TO service_role;

-- Super-admin dashboard entry point: wraps the snapshot behind the god-mode gate.
CREATE OR REPLACE FUNCTION public.get_email_health(p_window_minutes int DEFAULT 1440)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN public.email_health_snapshot(p_window_minutes);
END;
$$;
REVOKE ALL ON FUNCTION public.get_email_health(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_email_health(int) TO authenticated;
```

- [ ] **Step 4: Re-run to verify it passes**

Run: `supabase test db` (CI)
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_email_health_rpcs.sql supabase/tests/get_email_health.sql
git commit -m "feat: add email_health_snapshot and get_email_health RPCs"
```

---

### Task 4: Migration — retention prune + anonymize_user scrub

**Files:**
- Create (MCP `apply_migration`, name `email_log_prune_and_anonymize`): `supabase/migrations/<ts>_email_log_prune_and_anonymize.sql`
- Test: `supabase/tests/email_log_prune.sql` (pgTAP, CI)

**Interfaces:**
- Produces `prune_email_log() → int`, a daily `pg_cron` job `email-log-prune`, and an extended `anonymize_user` that scrubs `email_send_log.recipient_email`.

**Note:** Step 3 edits the existing `anonymize_user` body. Before applying, read the current definition (`SELECT pg_get_functiondef('public.anonymize_user'::regproc)` via MCP `execute_sql`) and add the one statement below **inside** it — do not drop the other scrub statements.

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- supabase/tests/email_log_prune.sql
BEGIN;
SELECT plan(1);
INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, created_at)
VALUES (gen_random_uuid(), 'offer_digest', 'old@t.test', 'delivered', now() - interval '120 days');
PERFORM public.prune_email_log();
SELECT is((SELECT count(*)::int FROM public.email_send_log WHERE recipient_email = 'old@t.test'), 0,
  'prune_email_log deletes rows older than retention');
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run to verify it fails**

Run: `supabase test db` (CI)
Expected: FAIL — `prune_email_log` does not exist.

- [ ] **Step 3: Apply the migration**

Apply via Supabase MCP `apply_migration`, name `email_log_prune_and_anonymize`, SQL (with the real `anonymize_user` body from the note above spliced in place of the `-- <existing …>` marker):

```sql
CREATE OR REPLACE FUNCTION public.prune_email_log()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days int := COALESCE((SELECT (value #>> '{}')::int FROM public.app_settings
                          WHERE org_id IS NULL AND key = 'email_log_retention_days'), 90);
  v_deleted int;
BEGIN
  DELETE FROM public.email_send_log WHERE created_at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_email_log() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_email_log() TO service_role;

SELECT cron.schedule('email-log-prune', '30 3 * * *', $$ SELECT public.prune_email_log(); $$);

-- Extend anonymize_user to scrub the recipient in the send log (GDPR erasure).
CREATE OR REPLACE FUNCTION public.anonymize_user(p_user uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text;
BEGIN
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = p_user;
  -- <existing anonymize_user body — profiles/artists/etc. scrubs — preserved verbatim>
  IF v_email IS NOT NULL THEN
    UPDATE public.email_send_log SET recipient_email = '[anonymized]'
    WHERE lower(recipient_email) = v_email;
  END IF;
END;
$$;
```

- [ ] **Step 4: Re-run to verify it passes**

Run: `supabase test db` (CI)
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_email_log_prune_and_anonymize.sql supabase/tests/email_log_prune.sql
git commit -m "feat: add email_send_log retention prune and anonymize scrub"
```

---

### Task 5: `send-transactional-email` — single-row logging state machine

**Files:**
- Modify: `supabase/functions/send-transactional-email/index.ts`
- Test: `supabase/functions/send-transactional-email/index.statelog.test.ts`

**Interfaces:**
- Consumes: `email_send_log` (Task 2), `makeFakeDeps`/`makeRequest` (`_shared/testing.ts`).
- Produces: exactly one `email_send_log` row per attempt, keyed by `message_id`, transitioning `pending → sent|failed|suppressed|pref_disabled`, stamping `resend_id`+`sent_at` on `sent`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/send-transactional-email/index.statelog.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const svc = "svc-key";
const authHeaders = { Authorization: `Bearer ${svc}` };
const env = { SUPABASE_URL: "http://sb.test", SUPABASE_SERVICE_ROLE_KEY: svc, RESEND_API_KEY: "re_test" };

Deno.test("logs one row transitioning pending → sent with resend_id", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: env,
    tables: {
      suppressed_emails: { data: null, error: null },
      email_unsubscribe_tokens: { data: { token: "tok", used_at: null }, error: null },
      app_settings: { data: [], error: null },
    },
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ id: "resend_123" }), { status: 200 })),
  });
  const req = makeRequest({ headers: authHeaders, body: { templateName: "offer-digest", recipientEmail: "a@t.test" } });
  const res = await handle(req, deps);
  assertEquals(res.status, 200);

  const logWrites = calls.filter((c) => c.table === "email_send_log");
  // one insert (pending) + one update (sent) — never two inserts.
  assertEquals(logWrites.filter((c) => c.method === "insert").length, 1);
  const update = logWrites.find((c) => c.method === "update");
  assertEquals((update!.args[0] as Record<string, unknown>).status, "sent");
  assertEquals((update!.args[0] as Record<string, unknown>).resend_id, "resend_123");
});

Deno.test("suppressed address updates the pending row to 'suppressed' (no second insert)", async () => {
  const { deps, calls } = makeFakeDeps({
    envVars: env,
    tables: { suppressed_emails: { data: { id: "x" }, error: null } },
  });
  const req = makeRequest({ headers: authHeaders, body: { templateName: "offer-digest", recipientEmail: "b@t.test" } });
  await handle(req, deps);
  const logWrites = calls.filter((c) => c.table === "email_send_log");
  assertEquals(logWrites.filter((c) => c.method === "insert").length, 1);
  assertEquals((logWrites.find((c) => c.method === "update")!.args[0] as Record<string, unknown>).status, "suppressed");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/send-transactional-email/index.statelog.test.ts`
Expected: FAIL — code still inserts a second row on suppression / does not update.

- [ ] **Step 3: Rework the logging in `index.ts`**

Replace the insert-per-transition logging with a state machine. After `messageId`/`templateName`/`recipientEmail`/`orgId` are known and the template is resolved (just before the suppression check at ~line 79), insert the pending row:

```ts
  // Record the attempt up front — exactly one row per message, updated in place.
  await admin.from('email_send_log').insert({
    message_id: messageId,
    org_id: orgId,
    template_name: templateName,
    recipient_email: effectiveRecipient,
    status: 'pending',
  })
```

Then **replace** each terminal-status write:

- Suppression branch (was `insert({... status:'suppressed'})`, ~line 92): →
  ```ts
  await admin.from('email_send_log').update({ status: 'suppressed' }).eq('message_id', messageId)
  return json({ success: false, reason: 'email_suppressed' }, 200)
  ```
- Preference-disabled branch (~line 120): →
  ```ts
  await admin.from('email_send_log').update({ status: 'pref_disabled' }).eq('message_id', messageId)
  return json({ success: false, reason: 'pref_disabled' }, 200)
  ```
- Remove the standalone `insert({... status:'pending'})` at ~line 218 (now redundant — the pending row already exists).
- Resend failure branch (~line 250): →
  ```ts
  await admin.from('email_send_log').update({
    status: 'failed',
    error_message: `Resend ${sendResponse.status}: ${errorBody.slice(0, 200)}`,
  }).eq('message_id', messageId)
  return json({ error: 'Failed to send email' }, 500)
  ```
- Resend success branch (~line 263): →
  ```ts
  await admin.from('email_send_log').update({
    status: 'sent',
    resend_id: sendData.id,
    sent_at: deps.now().toISOString(),
    metadata: { resend_id: sendData.id },
  }).eq('message_id', messageId)
  ```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/send-transactional-email/index.statelog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the whole edge suite (regression — memory `edge-fn-multi-test-files`)**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/send-transactional-email/`
Expected: PASS (existing `index.di.test.ts` / `index.pref.test.ts` / `index.smoke.test.ts` still green; adjust their `email_send_log` seed expectations only if they asserted the old insert-twice behavior).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/send-transactional-email/index.ts supabase/functions/send-transactional-email/index.statelog.test.ts
git commit -m "refactor: log email sends as a single-row state machine"
```

---

### Task 6: `handle-email-suppression` — full deliverability lifecycle

**Files:**
- Modify: `supabase/functions/handle-email-suppression/index.ts`
- Test: `supabase/functions/handle-email-suppression/index.lifecycle.test.ts`

**Interfaces:**
- Consumes: `email_send_log`, `suppressed_emails`, the Resend Standard-Webhooks verification already in the file.
- Produces: on each delivery event, an UPDATE of `email_send_log` by `resend_id` (insert-fallback if unmatched); bounce/complaint still upsert `suppressed_emails`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/handle-email-suppression/index.lifecycle.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapEventToLogStatus } from "./index.ts";

Deno.test("maps Resend event types to log statuses", () => {
  assertEquals(mapEventToLogStatus("email.sent"), "sent");
  assertEquals(mapEventToLogStatus("email.delivered"), "delivered");
  assertEquals(mapEventToLogStatus("email.delivery_delayed"), "delivery_delayed");
  assertEquals(mapEventToLogStatus("email.bounced"), "bounced");
  assertEquals(mapEventToLogStatus("email.complained"), "complained");
  assertEquals(mapEventToLogStatus("email.opened"), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/handle-email-suppression/index.lifecycle.test.ts`
Expected: FAIL — `mapEventToLogStatus` not exported.

- [ ] **Step 3: Add the lifecycle mapping + log write**

In `handle-email-suppression/index.ts`, add near the existing `mapEventToReason`:

```ts
type LogStatus = 'sent' | 'delivered' | 'delivery_delayed' | 'bounced' | 'complained'
const EVENT_TO_STATUS: Record<string, LogStatus> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
}
const STATUS_TO_STAMP: Record<LogStatus, string> = {
  sent: 'sent_at', delivered: 'delivered_at', delivery_delayed: 'delayed_at',
  bounced: 'bounced_at', complained: 'complained_at',
}
/** Resend event type → email_send_log status (null = ignore). */
export function mapEventToLogStatus(eventType: string): LogStatus | null {
  return EVENT_TO_STATUS[eventType] ?? null
}
```

Then, in `handle`, after the existing `reason`/suppression handling, record the delivery event on the log. Replace the current `mapEventToReason`-only early-return logic so that **every** mapped event updates the log while bounce/complaint still suppress:

```ts
  const logStatus = mapEventToLogStatus(payload.type)
  if (!logStatus) {
    return json({ success: true, ignored: true })  // e.g. email.opened / email.clicked
  }
  const resendId = payload.data?.email_id ?? null
  const recipientEmail = payload.data?.to?.[0]?.toLowerCase() ?? null

  // Bounce/complaint → suppress the address (unchanged behavior).
  const reason = mapEventToReason(payload.type)
  if (reason && recipientEmail) {
    await admin.from('suppressed_emails').upsert(
      { email: recipientEmail, reason, metadata: { resend_email_id: resendId } },
      { onConflict: 'email' })
  }

  // Update the send row by resend_id; insert a fallback if the event beat the send-row
  // write or the row was pruned, so counts stay accurate.
  const patch: Record<string, unknown> = { status: logStatus, [STATUS_TO_STAMP[logStatus]]: deps.now().toISOString() }
  if (reason) patch.error_message = mapReasonToMessage(reason)
  if (resendId) {
    const { data: updated } = await admin.from('email_send_log')
      .update(patch).eq('resend_id', resendId).select('id')
    if (!updated || (updated as unknown[]).length === 0) {
      await admin.from('email_send_log').insert({
        message_id: crypto.randomUUID(), resend_id: resendId, template_name: 'system',
        recipient_email: recipientEmail ?? 'unknown', ...patch,
      })
    }
  }
  return json({ success: true })
```

(Delete the now-superseded `mapEventToReason`-gated block that inserted the old `template_name:'system'` row and returned early. Keep `mapReasonToMessage`; drop `mapReasonToStatus` if unused.)

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/handle-email-suppression/index.lifecycle.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Run the whole function's suite (regression)**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/handle-email-suppression/`
Expected: PASS (`index.di.test.ts` / `index.smoke.test.ts` green; update any assertion that expected the old single insert to expect the update-by-resend_id path).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/handle-email-suppression/index.ts supabase/functions/handle-email-suppression/index.lifecycle.test.ts
git commit -m "feat: capture full Resend deliverability lifecycle in email_send_log"
```

---

### Task 7: Deno mirror of `deriveEmailStatus` (`_shared/emailHealth.ts`)

**Files:**
- Create: `supabase/functions/_shared/emailHealth.ts`
- Test: `supabase/functions/_shared/emailHealth.test.ts`

**Interfaces:**
- Produces: `EMAIL_THRESHOLDS`, `EMAIL_ALERT`, `deriveEmailStatus(snapshot): EmailState`. Consumed by Task 8. `snapshot` is the raw snake_case object from `email_health_snapshot`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/emailHealth.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveEmailStatus } from "./emailHealth.ts";

const snap = (o: Record<string, number>) => ({
  attempted: 0, sent: 0, delivered: 0, delayed: 0, bounced: 0, complained: 0, failed: 0,
  suppressed: 0, delivery_rate: 0, bounce_rate: 0, complaint_rate: 0, failure_count: 0, ...o,
});

Deno.test("mirror of frontend derivation", () => {
  assertEquals(deriveEmailStatus(snap({})), "operational");                                   // idle
  assertEquals(deriveEmailStatus(snap({ attempted: 30, sent: 30 })), "stale");                 // no webhooks
  assertEquals(deriveEmailStatus(snap({ attempted: 100, sent: 100, delivered: 94, bounced: 6, bounce_rate: 0.06 })), "down");
  assertEquals(deriveEmailStatus(snap({ attempted: 241, sent: 241, delivered: 233, bounced: 7, delivery_rate: 0.967, bounce_rate: 0.029 })), "degraded");
  assertEquals(deriveEmailStatus(snap({ attempted: 100, sent: 100, delivered: 100, delivery_rate: 1 })), "operational");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/emailHealth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// supabase/functions/_shared/emailHealth.ts
// MIRROR: keep in sync with src/lib/systemHealth.ts deriveEmailStatus + src/config/app.config.ts EMAIL_HEALTH.
export type EmailState = "operational" | "degraded" | "down" | "stale";

export const EMAIL_THRESHOLDS = {
  bounceWarn: 0.02, bounceDown: 0.05, complaintWarn: 0.001, complaintDown: 0.003, deliveryWarn: 0.95,
};
export const EMAIL_ALERT = { windowMinutes: 180, minVolumeForAlert: 20, failureAlertCount: 3 };

export interface EmailSnapshot {
  attempted: number; sent: number; delivered: number; delayed: number; bounced: number;
  complained: number; failed: number; suppressed: number;
  delivery_rate: number; bounce_rate: number; complaint_rate: number; failure_count: number;
}

export function deriveEmailStatus(h: EmailSnapshot, t = EMAIL_THRESHOLDS): EmailState {
  if (h.attempted === 0) return "operational";
  if (h.sent === 0) return h.failed > 0 ? "down" : "operational";
  if (h.delivered + h.delayed + h.bounced + h.complained === 0) return "stale";
  if (h.bounce_rate > t.bounceDown || h.complaint_rate > t.complaintDown) return "down";
  if (h.bounce_rate > t.bounceWarn || h.complaint_rate > t.complaintWarn ||
      h.failure_count > 0 || h.delivery_rate < t.deliveryWarn) return "degraded";
  return "operational";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/emailHealth.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/emailHealth.ts supabase/functions/_shared/emailHealth.test.ts
git commit -m "feat: add Deno mirror of email-health derivation"
```

---

### Task 8: `email-health-watcher` edge function + schedule

**Files:**
- Create: `supabase/functions/email-health-watcher/index.ts`
- Create: `supabase/functions/email-health-watcher/deno.json` (copy `handle-email-suppression/deno.json`)
- Modify: `supabase/config.toml` (add `[functions.email-health-watcher]` `verify_jwt = false`)
- Create (MCP `apply_migration`, name `email_health_watcher_cron`): the `pg_cron` schedule
- Test: `supabase/functions/email-health-watcher/index.test.ts`

**Interfaces:**
- Consumes: `email_health_snapshot` (Task 3), `deriveEmailStatus`/`EMAIL_ALERT` (Task 7), `requireCronOrRole` (`_shared/auth.ts`), `platform_admins`, `notifications`, `email_health_state`.
- Produces: an in-app super-admin notification (`type='email_health_degraded'`) on a transition **into** degraded/down; updates `email_health_state`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/email-health-watcher/index.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const cronHeaders = { "X-Cron-Secret": "sekret" };
const withSecret = { rpcs: { get_cron_secret: { data: "sekret", error: null } } };

Deno.test("alerts super-admins on operational → degraded transition", async () => {
  const snapshot = { attempted: 100, sent: 100, delivered: 94, bounced: 6, delayed: 0, complained: 0,
    failed: 0, suppressed: 0, delivery_rate: 0.94, bounce_rate: 0.06, complaint_rate: 0, failure_count: 0 };
  const { deps, calls } = makeFakeDeps({
    ...withSecret,
    rpcs: { ...withSecret.rpcs, email_health_snapshot: { data: snapshot, error: null } },
    tables: {
      email_health_state: { data: { last_state: "operational" }, error: null },
      platform_admins: { data: [{ user_id: "super-1" }], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: cronHeaders }), deps);
  assertEquals(res.status, 200);
  const notif = calls.find((c) => c.table === "notifications" && c.method === "insert");
  assertEquals(Array.isArray(notif!.args[0]) ? (notif!.args[0] as unknown[]).length : 1, 1);
});

Deno.test("no re-alert when already degraded (idempotent)", async () => {
  const snapshot = { attempted: 100, sent: 100, delivered: 94, bounced: 6, delayed: 0, complained: 0,
    failed: 0, suppressed: 0, delivery_rate: 0.94, bounce_rate: 0.06, complaint_rate: 0, failure_count: 0 };
  const { deps, calls } = makeFakeDeps({
    ...withSecret,
    rpcs: { ...withSecret.rpcs, email_health_snapshot: { data: snapshot, error: null } },
    tables: {
      email_health_state: { data: { last_state: "down" }, error: null },
      platform_admins: { data: [{ user_id: "super-1" }], error: null },
    },
  });
  await handle(makeRequest({ headers: cronHeaders }), deps);
  assertEquals(calls.some((c) => c.table === "notifications" && c.method === "insert"), false);
});

Deno.test("rejects without cron secret", async () => {
  const { deps } = makeFakeDeps(withSecret);
  const res = await handle(makeRequest({ headers: {} }), deps);
  assertEquals(res.status, 401);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/email-health-watcher/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the watcher**

```ts
// supabase/functions/email-health-watcher/index.ts
import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { deriveEmailStatus, EMAIL_ALERT, type EmailSnapshot } from "../_shared/emailHealth.ts";

/**
 * Every ~15 min: snapshot email deliverability over the alert window, derive health,
 * and on a transition INTO degraded/down alert all super-admins once (in-app only —
 * email is the thing being monitored). Idempotent via email_health_state.last_state.
 * Rate alerts are gated on minimum volume so a 2-of-3 bounce spike can't false-alarm.
 * Auth: X-Cron-Secret only (platform-scoped — no org-role fallback).
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  const auth = await requireCronOrRole(deps, req, []);
  if (!auth.ok) return auth.response;

  const admin = deps.admin;
  const now = deps.now();

  const { data: snap, error: snapErr } = await admin.rpc("email_health_snapshot", { p_window_minutes: EMAIL_ALERT.windowMinutes });
  if (snapErr) {
    console.error("email-health-watcher: snapshot failed, aborting", snapErr);
    return json({ error: "snapshot_failed" }, 503);
  }
  const h = snap as EmailSnapshot;

  // Volume guard: don't derive an alertable state from a tiny sample. Below the floor,
  // treat as operational (unless there are enough hard send-failures to stand alone).
  const enoughVolume = h.sent >= EMAIL_ALERT.minVolumeForAlert;
  const enoughFailures = h.failure_count >= EMAIL_ALERT.failureAlertCount;
  let state = deriveEmailStatus(h);
  if ((state === "degraded" || state === "down") && !enoughVolume && !enoughFailures) {
    state = "operational";
  }

  const { data: stateRow, error: stateErr } = await admin
    .from("email_health_state").select("last_state").eq("id", true).maybeSingle();
  if (stateErr) {
    console.error("email-health-watcher: state read failed, aborting to prevent alert storm", stateErr);
    return json({ error: "state_read_failed" }, 503);
  }
  const prev = (stateRow as { last_state?: string } | null)?.last_state ?? "operational";

  const isBad = state === "degraded" || state === "down";
  const wasBad = prev === "degraded" || prev === "down";

  const { error: upsertErr } = await admin.from("email_health_state").upsert({
    id: true, last_state: state,
    last_alerted_at: isBad ? (wasBad ? undefined : now.toISOString()) : null,
    updated_at: now.toISOString(),
  }, { onConflict: "id" });
  if (upsertErr) {
    console.error("email-health-watcher: state upsert failed, skipping alert", upsertErr);
    return json({ error: "state_write_failed" }, 503);
  }

  let alerted = 0;
  if (isBad && !wasBad) {
    alerted = await alertSuperAdmins(deps, state, h);
  }
  return json({ state, alerted });
}

async function alertSuperAdmins(deps: Deps, state: string, h: EmailSnapshot): Promise<number> {
  const { data } = await deps.admin.from("platform_admins").select("user_id");
  const ids = ((data ?? []) as { user_id: string }[]).map((a) => a.user_id);
  if (ids.length === 0) return 0;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const message =
    `Email delivery is ${state}: ${pct(h.delivery_rate)} delivered, ${pct(h.bounce_rate)} bounced, ` +
    `${pct(h.complaint_rate)} complaints, ${h.failure_count} send failures (last ${EMAIL_ALERT.windowMinutes}m).`;
  const { error } = await deps.admin.from("notifications").insert(ids.map((uid) => ({
    user_id: uid, org_id: null, type: "email_health_degraded",
    title: "Email delivery degraded", message,
    related_entity_type: "system", related_entity_id: null,
  })));
  if (error) { console.error("email-health-watcher: notification insert failed", error); return 0; }
  return ids.length;
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/email-health-watcher/`
Expected: PASS (3 tests).

- [ ] **Step 5: Register in `config.toml`**

Add to `supabase/config.toml` (alphabetical among the `[functions.*]` blocks):

```toml
[functions.email-health-watcher]
verify_jwt = false
```

- [ ] **Step 6: Schedule the cron**

Apply via Supabase MCP `apply_migration`, name `email_health_watcher_cron`. Model the `cron.schedule` HTTP-dispatch on the existing watcher cron entries (same `net.http_post` + `X-Cron-Secret` pattern already used for `cron-health-watcher`; copy that job's SQL, changing the job name to `email-health-watcher`, the schedule to `*/15 * * * *`, and the URL path to `/functions/v1/email-health-watcher`). Read the existing entry first: `SELECT command FROM cron.job WHERE jobname = 'cron-health-watcher'` via MCP `execute_sql`, then adapt it verbatim.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/email-health-watcher/ supabase/config.toml supabase/migrations/*_email_health_watcher_cron.sql
git commit -m "feat: add email-health-watcher alert cron"
```

---

### Task 9: Data access + hook (`fetchEmailHealth` / `useEmailHealth`)

**Files:**
- Modify: `src/data/platform.ts` (add `EmailHealth` mapping + `fetchEmailHealth`)
- Modify: `src/hooks/useSystemHealth.ts` (add `useEmailHealth`)
- Test: `src/data/platform.emailHealth.test.ts`

**Interfaces:**
- Consumes: `get_email_health` RPC (Task 3), `EmailHealth` type (Task 1).
- Produces: `fetchEmailHealth(client, windowMinutes): Promise<EmailHealth>`; `useEmailHealth(windowMinutes)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/data/platform.emailHealth.test.ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchEmailHealth } from "@/data/platform";

describe("fetchEmailHealth", () => {
  it("calls get_email_health and maps snake_case → camelCase", async () => {
    const fake = createFakeSupabase({
      "rpc:get_email_health": {
        data: {
          attempted: 241, sent: 241, delivered: 233, delayed: 1, bounced: 7, complained: 0,
          failed: 2, suppressed: 5, delivery_rate: 0.967, bounce_rate: 0.029, complaint_rate: 0,
          failure_count: 2, last_event_at: "2026-07-11T08:00:00Z",
          by_template: [{ template_name: "offer_digest", sent: 210, delivered: 204, bounced: 6, failed: 0, delivery_rate: 0.971 }],
          recent_issues: [{ recipient_email: "b@gmail.com", template_name: "offer_digest", status: "bounced", error_message: "no mailbox", occurred_at: "2026-07-11T06:00:00Z" }],
        },
        error: null,
      },
    });
    // deno-lint-ignore no-explicit-any
    const h = await fetchEmailHealth(fake as any, 1440);
    expect(h.bounceRate).toBeCloseTo(0.029);
    expect(h.byTemplate[0].templateName).toBe("offer_digest");
    expect(h.recentIssues[0].recipientEmail).toBe("b@gmail.com");
    const call = fake.calls.find((c) => c.table === "rpc:get_email_health");
    expect(call?.args[0]).toEqual({ p_window_minutes: 1440 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/data/platform.emailHealth.test.ts` (CI)
Expected: FAIL — `fetchEmailHealth` not exported.

- [ ] **Step 3: Add `fetchEmailHealth` to `src/data/platform.ts`**

```ts
import type { EmailHealth } from "@/lib/systemHealth";

/** Email-delivery health for the System Health tab (super-admin; gate enforced in the RPC).
 *  Maps the RPC's snake_case jsonb to the camelCase EmailHealth the panel consumes. */
export async function fetchEmailHealth(
  client: SupabaseClient<Database>,
  windowMinutes: number,
): Promise<EmailHealth> {
  const { data, error } = await client.rpc("get_email_health" as never, { p_window_minutes: windowMinutes } as never);
  if (error) throw error;
  const d = (data ?? {}) as Record<string, any>;
  return {
    attempted: d.attempted ?? 0, sent: d.sent ?? 0, delivered: d.delivered ?? 0, delayed: d.delayed ?? 0,
    bounced: d.bounced ?? 0, complained: d.complained ?? 0, failed: d.failed ?? 0, suppressed: d.suppressed ?? 0,
    deliveryRate: Number(d.delivery_rate ?? 0), bounceRate: Number(d.bounce_rate ?? 0),
    complaintRate: Number(d.complaint_rate ?? 0), failureCount: d.failure_count ?? 0,
    lastEventAt: d.last_event_at ?? null,
    byTemplate: ((d.by_template ?? []) as Record<string, any>[]).map((t) => ({
      templateName: t.template_name, sent: t.sent, delivered: t.delivered, bounced: t.bounced,
      failed: t.failed, deliveryRate: Number(t.delivery_rate ?? 0),
    })),
    recentIssues: ((d.recent_issues ?? []) as Record<string, any>[]).map((i) => ({
      recipientEmail: i.recipient_email, templateName: i.template_name, status: i.status,
      errorMessage: i.error_message ?? null, occurredAt: i.occurred_at,
    })),
  };
}
```

- [ ] **Step 4: Add `useEmailHealth` to `src/hooks/useSystemHealth.ts`**

```ts
import { fetchEmailHealth } from "@/data/platform";
import { EMAIL_HEALTH } from "@/config/app.config";

export function useEmailHealth(windowMinutes: number = EMAIL_HEALTH.windowMinutes) {
  return useQuery({
    queryKey: ["platform", "email-health", windowMinutes],
    queryFn: () => fetchEmailHealth(supabase, windowMinutes),
    refetchInterval: SYSTEM_HEALTH.refetchMs,
    staleTime: Infinity,
    retry: 1, // supplementary — a metrics outage must not blank the tab
  });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/data/platform.emailHealth.test.ts` (CI)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/platform.ts src/hooks/useSystemHealth.ts src/data/platform.emailHealth.test.ts
git commit -m "feat: add fetchEmailHealth data access and useEmailHealth hook"
```

---

### Task 10: `EmailDeliveryPanel` component + `redactEmail`

**Files:**
- Create: `src/lib/redactEmail.ts`
- Create: `src/components/platform/systemHealth/EmailDeliveryPanel.tsx`
- Test: `src/lib/redactEmail.test.ts`, `src/components/platform/systemHealth/EmailDeliveryPanel.test.tsx`

**Interfaces:**
- Consumes: `EmailHealth`, `deriveEmailStatus`, `EMAIL_HEALTH`, `StatusPill`/`StatusDot`.
- Produces: `<EmailDeliveryPanel health={EmailHealth} state={HealthState} window={number} onWindowChange={(m:number)=>void} />` and `redactEmail(email: string): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/redactEmail.test.ts
import { describe, it, expect } from "vitest";
import { redactEmail } from "@/lib/redactEmail";
describe("redactEmail", () => {
  it("masks the local part", () => {
    expect(redactEmail("bthomas@gmail.com")).toBe("b***@gmail.com");
    expect(redactEmail("a@b.co")).toBe("a***@b.co");
    expect(redactEmail("weird")).toBe("***");
  });
});
```

```tsx
// src/components/platform/systemHealth/EmailDeliveryPanel.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmailDeliveryPanel } from "./EmailDeliveryPanel";
import type { EmailHealth } from "@/lib/systemHealth";

const health: EmailHealth = {
  attempted: 248, sent: 241, delivered: 233, delayed: 1, bounced: 7, complained: 0, failed: 2, suppressed: 5,
  deliveryRate: 0.967, bounceRate: 0.029, complaintRate: 0, failureCount: 2, lastEventAt: "2026-07-11T08:00:00Z",
  byTemplate: [{ templateName: "offer_digest", sent: 210, delivered: 204, bounced: 6, failed: 0, deliveryRate: 0.971 }],
  recentIssues: [{ recipientEmail: "bthomas@gmail.com", templateName: "offer_digest", status: "bounced", errorMessage: "no mailbox", occurredAt: "2026-07-11T06:00:00Z" }],
};

describe("EmailDeliveryPanel", () => {
  it("renders KPIs, template rows, and a redacted recipient", () => {
    render(<EmailDeliveryPanel health={health} state="degraded" window={1440} onWindowChange={() => {}} />);
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("offer_digest")).toBeInTheDocument();
    expect(screen.getByText("b***@gmail.com")).toBeInTheDocument();
    expect(screen.queryByText("bthomas@gmail.com")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/redactEmail.test.ts src/components/platform/systemHealth/EmailDeliveryPanel.test.tsx` (CI)
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `redactEmail`**

```ts
// src/lib/redactEmail.ts
/** Mask an address for display: keep the first local char + domain. "b***@gmail.com". */
export function redactEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}
```

- [ ] **Step 4: Write `EmailDeliveryPanel.tsx`**

```tsx
// src/components/platform/systemHealth/EmailDeliveryPanel.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusPill, StatusDot } from "./primitives";
import { redactEmail } from "@/lib/redactEmail";
import { EMAIL_HEALTH } from "@/config/app.config";
import type { EmailHealth, HealthState } from "@/lib/systemHealth";

const pct = (n: number) => `${(n * 100).toFixed(n >= 0.01 || n === 0 ? 1 : 2)}%`;
const toneForRate = (rate: number, warn: number, down: number) =>
  rate > down ? "text-destructive" : rate > warn ? "text-warning" : "text-success";

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-medium tabular-nums ${tone}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

export function EmailDeliveryPanel({
  health, state, window, onWindowChange,
}: { health: EmailHealth; state: HealthState; window: number; onWindowChange: (m: number) => void }) {
  const h = health;
  const badge = (s: string): string =>
    s === "bounced" ? "border-warning/30 text-warning"
      : s === "failed" || s === "complained" ? "border-destructive/30 text-destructive"
      : "border-border text-muted-foreground";
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <CardTitle className="font-display text-base">Email delivery</CardTitle>
        <StatusPill state={state} />
        <span className="flex-1" />
        <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
          {EMAIL_HEALTH.windowOptions.map((m) => (
            <button key={m} onClick={() => onWindowChange(m)}
              className={`px-3 py-1 ${window === m ? "bg-muted font-medium text-foreground" : "text-muted-foreground"}`}>
              {m === 1440 ? "24h" : "7d"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Delivery rate" value={pct(h.deliveryRate)} sub={`${h.delivered} of ${h.sent} delivered`}
               tone={h.deliveryRate < EMAIL_HEALTH.deliveryWarn ? "text-warning" : "text-success"} />
          <Kpi label="Bounce rate" value={pct(h.bounceRate)} sub={`${h.bounced} bounced · warn > 2%`}
               tone={toneForRate(h.bounceRate, EMAIL_HEALTH.bounceWarn, EMAIL_HEALTH.bounceDown)} />
          <Kpi label="Complaint rate" value={pct(h.complaintRate)} sub={`${h.complained} complaints · norm < 0.1%`}
               tone={toneForRate(h.complaintRate, EMAIL_HEALTH.complaintWarn, EMAIL_HEALTH.complaintDown)} />
          <Kpi label="Send failures" value={String(h.failureCount)} sub={`${h.suppressed} suppressed pre-send`}
               tone={h.failureCount > 0 ? "text-warning" : "text-success"} />
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-muted-foreground">By template</div>
          <div className="space-y-1.5">
            {h.byTemplate.map((t) => (
              <div key={t.templateName} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                <StatusDot state={t.bounced > 0 || t.failed > 0 ? "degraded" : "operational"} />
                <span className="flex-1 truncate font-mono text-sm">{t.templateName}</span>
                <span className="text-xs text-muted-foreground">{t.sent} sent · {t.bounced} bounced · {t.failed} failed</span>
                <span className="min-w-[52px] text-right text-sm font-medium tabular-nums">{pct(t.deliveryRate)}</span>
              </div>
            ))}
            {h.byTemplate.length === 0 && <p className="text-sm text-muted-foreground">No email in this window.</p>}
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-muted-foreground">Recent issues</div>
          <div className="space-y-1.5">
            {h.recentIssues.map((i, idx) => (
              <div key={idx} className="flex items-center gap-3 border-b border-border py-1.5 last:border-0">
                <Badge variant="outline" className={`text-[11px] ${badge(i.status)}`}>{i.status}</Badge>
                <span className="font-mono text-xs text-muted-foreground">{redactEmail(i.recipientEmail)}</span>
                <span className="flex-1 truncate text-xs text-muted-foreground">{i.errorMessage ?? i.templateName}</span>
                <span className="text-xs text-muted-foreground">{new Date(i.occurredAt).toLocaleString()}</span>
              </div>
            ))}
            {h.recentIssues.length === 0 && <p className="text-sm text-muted-foreground">No delivery issues in this window.</p>}
          </div>
        </div>

        <div className="border-t border-border pt-3 text-xs text-muted-foreground">
          {h.lastEventAt
            ? `Delivery webhook healthy — last Resend event ${new Date(h.lastEventAt).toLocaleString()}.`
            : "No delivery events received yet — if sends continue with none, this domain reads Stale (check the Resend webhook)."}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/lib/redactEmail.test.ts src/components/platform/systemHealth/EmailDeliveryPanel.test.tsx` (CI)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/redactEmail.ts src/lib/redactEmail.test.ts src/components/platform/systemHealth/EmailDeliveryPanel.tsx src/components/platform/systemHealth/EmailDeliveryPanel.test.tsx
git commit -m "feat: add EmailDeliveryPanel and redactEmail helper"
```

---

### Task 11: Wire the panel into `SystemHealthTab`

**Files:**
- Modify: `src/components/platform/SystemHealthTab.tsx`
- Modify: `src/components/platform/systemHealth/DomainSummaryGrid.tsx` (drop the `"Email delivery"` placeholder)
- Test: `src/components/platform/systemHealth/DomainSummaryGrid.test.tsx` (assert it's no longer a placeholder)

**Interfaces:**
- Consumes: `useEmailHealth`, `deriveEmailStatus`, `EMAIL_HEALTH`, `EmailDeliveryPanel`.

- [ ] **Step 1: Update the failing test**

Add to `DomainSummaryGrid.test.tsx`:

```tsx
it("no longer shows Email delivery as a placeholder", () => {
  render(<DomainSummaryGrid domains={[]} />);
  expect(screen.queryAllByText("Not monitored yet").length).toBeGreaterThan(0); // other placeholders remain
  expect(screen.queryByText("Email delivery")).not.toBeInTheDocument(); // removed from PLACEHOLDERS
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/platform/systemHealth/DomainSummaryGrid.test.tsx` (CI)
Expected: FAIL — "Email delivery" still rendered as a placeholder.

- [ ] **Step 3: Remove the placeholder**

In `DomainSummaryGrid.tsx`, change:

```ts
const PLACEHOLDERS = ["Database", "Org sync", "Auth / Storage"];
```

- [ ] **Step 4: Wire the tab**

In `SystemHealthTab.tsx`: add imports, a window state, the hook, derive the email state, add the domain, render the panel.

```tsx
import { useState } from "react";
import { useCronHealth, useEdgeFnMetrics, useEmailHealth } from "@/hooks/useSystemHealth";
import { EmailDeliveryPanel } from "./systemHealth/EmailDeliveryPanel";
import { deriveEmailStatus, /* …existing… */ } from "@/lib/systemHealth";
import { SYSTEM_HEALTH_BUDGET as budget, EMAIL_HEALTH } from "@/config/app.config";
```

Inside the component (after `const edge = useEdgeFnMetrics();`):

```tsx
  const [emailWindow, setEmailWindow] = useState(EMAIL_HEALTH.windowMinutes);
  const email = useEmailHealth(emailWindow);
  const emailState = email.data ? deriveEmailStatus(email.data, EMAIL_HEALTH) : "pending";
```

Add `emailState` to the overall rollup:

```tsx
  const overall = worstStatus([jobsState, edgeState, emailState]);
```

Add the email domain tile (after the `edge` tile) — resilient to a metrics outage:

```tsx
        { key: "email", label: "Email delivery",
          state: email.isError ? "pending" : emailState,
          detail: email.isError ? "metrics unavailable"
            : email.data ? `${email.data.sent} sent · ${(email.data.bounceRate * 100).toFixed(1)}% bounce`
            : "loading…" },
```

Render the panel after `<EdgeFunctionsPanel .../>` (only once data is present; a query error must not blank the tab):

```tsx
      {email.data && (
        <EmailDeliveryPanel health={email.data} state={emailState} window={emailWindow} onWindowChange={setEmailWindow} />
      )}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/components/platform/systemHealth/ src/components/platform/SystemHealthTab.test.tsx` (CI)
Expected: PASS (existing `SystemHealthTab.test.tsx` still green; update its query mocks if it asserted the domain list length).

- [ ] **Step 6: Verify in the running app**

Start the dev server (`preview_start` with the project's dev config), sign in as a super-admin, open `/platform` → System Health. Confirm the Email delivery tile is live (not "Not monitored yet") and the panel renders KPIs + the 24h/7d toggle. Capture a screenshot.

- [ ] **Step 7: Commit**

```bash
git add src/components/platform/SystemHealthTab.tsx src/components/platform/systemHealth/DomainSummaryGrid.tsx src/components/platform/systemHealth/DomainSummaryGrid.test.tsx
git commit -m "feat: light up the Email delivery domain in System Health"
```

---

### Task 12: Docs, system map, version bump, changelog

**Files:**
- Modify: `docs/system-map.md`, `src/data/systemMap.ts` (add the email-capture flow + watcher + prune)
- Modify: `package.json` (`version`), `src/config/app.config.ts` (`APP_META.VERSION`)
- Modify: `public/changelog.md`; regenerate `public/changelog.json`

- [ ] **Step 1: Update the system map (both files)**

In `docs/system-map.md`, add entries under the automation map: Resend webhook `handle-email-suppression` → `email_send_log` (delivery lifecycle) + `suppressed_emails`; `email-health-watcher` (`*/15`) → `email_health_snapshot` → super-admin `notifications`; `email-log-prune` (daily) → deletes old `email_send_log`. Mirror the same three flows as nodes/edges in `src/data/systemMap.ts` (follow the existing entry shape in that file).

- [ ] **Step 2: Bump the version**

- `package.json`: `"version": "1.9.0"`.
- `src/config/app.config.ts`: `APP_META.VERSION: '1.9.0'`.

- [ ] **Step 3: Add the changelog block**

Prepend to `public/changelog.md`:

```markdown
## 1.9.0 — Jul 11, 2026

*Email delivery monitoring*

### New
- **Email delivery health** — the platform System Health console now tracks delivery, bounce, complaint, and send-failure rates, with a per-template breakdown and recent-issues list.
- **Delivery alerts** — super-admins are notified in-app when bounce or complaint rates cross safe thresholds.

### Fixed
- **Transactional email** — created the missing send-log and suppression tables that were causing digests and invitations to fail.
```

- [ ] **Step 4: Regenerate the JSON**

Run: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
Expected: `public/changelog.json` rewritten with the 1.9.0 block.

- [ ] **Step 5: Commit**

```bash
git add docs/system-map.md src/data/systemMap.ts package.json src/config/app.config.ts public/changelog.md public/changelog.json
git commit -m "docs: system map, v1.9.0 bump, and changelog for email monitoring"
```

---

## Self-Review

**Spec coverage:** tables + RLS (T2) ✓; `email_health_snapshot`/`get_email_health` (T3) ✓; prune + anonymize scrub (T4) ✓; send-fn state machine (T5) ✓; webhook lifecycle (T6) ✓; derivation mirror (T1 frontend, T7 Deno) ✓; watcher + guards + idempotency + schedule (T8) ✓; data/hook (T9) ✓; panel + redaction + window toggle (T10) ✓; tab wire-up + placeholder removal (T11) ✓; system map + version + changelog (T12) ✓. Deliverability-only and super-admin-only RLS are honored throughout; the Resend-dashboard subscription is already done (out of the code plan).

**Type consistency:** `EmailHealth` (camelCase, frontend, T1/T9/T10) vs `EmailSnapshot` (snake_case, Deno, T7/T8) are deliberately distinct — the frontend maps the RPC in `fetchEmailHealth` (T9). `deriveEmailStatus` signatures differ per runtime (TS takes `(EmailHealth, thresholds)`; Deno takes `(EmailSnapshot, thresholds?)`) — intentional, documented as mirrors. `email_health_snapshot` returns snake_case keys consumed identically by T8 (raw) and T9 (mapped). `notifications` insert shape matches `cron-health-watcher`'s (`user_id, org_id:null, type, title, message, related_entity_type, related_entity_id:null`).

**Placeholder scan:** none — all steps carry real code/SQL. The two spots that read existing definitions before editing (T4 `anonymize_user` body, T8 cron dispatch SQL) explicitly instruct reading the live definition via MCP `execute_sql` and adapting it, because those bodies aren't in this repo's migrations; this is a read-then-extend instruction, not a placeholder.
