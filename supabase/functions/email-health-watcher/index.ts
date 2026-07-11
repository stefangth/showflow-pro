import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { deriveEmailStatus, EMAIL_ALERT, type EmailSnapshot } from "../_shared/emailHealth.ts";

/**
 * Every ~15 min: snapshot email deliverability over the alert window, derive health,
 * and on a transition INTO degraded/down alert all super-admins once (in-app only —
 * email is the thing being monitored, so an email alert would be undeliverable exactly
 * when it matters most). Idempotent via email_health_state.last_state.
 * Rate alerts are gated on minimum volume so a 2-of-3 bounce spike can't false-alarm.
 * Auth: X-Cron-Secret only (platform-scoped — no org-role fallback).
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  const auth = await requireCronOrRole(deps, req, []);
  if (!auth.ok) return auth.response;

  const admin = deps.admin;
  const now = deps.now();

  // Abort on a snapshot-read error: a swallowed error would make an outage look
  // operational (silently skip the alert).
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

  // Abort on a state-read error too: without knowing the prior state, every run would
  // look like a fresh transition and re-alert every ~15 min (alert storm).
  const { data: stateRow, error: stateErr } = await admin
    .from("email_health_state").select("last_state").eq("id", true).maybeSingle();
  if (stateErr) {
    console.error("email-health-watcher: state read failed, aborting to prevent alert storm", stateErr);
    return json({ error: "state_read_failed" }, 503);
  }
  const prev = (stateRow as { last_state?: string } | null)?.last_state ?? "operational";

  const isBad = state === "degraded" || state === "down";
  const wasBad = prev === "degraded" || prev === "down";
  const freshTransition = isBad && !wasBad;

  // Single channel, no email backstop: alert BEFORE persisting the new state. If the
  // notifications insert fails on a fresh transition, we must not advance `last_state` —
  // otherwise the next run sees `wasBad === true` and the alert is lost for good.
  let alerted = 0;
  let alertOk = true;
  if (freshTransition) {
    const r = await alertSuperAdmins(deps, state, h);
    alertOk = r.ok;
    alerted = r.count;
  }

  // Single channel: if a fresh transition's alert failed, keep the prior state so the
  // next run re-detects the transition and retries — never silently drop the only alert.
  const persistState = (freshTransition && !alertOk) ? prev : state;
  const { error: upsertErr } = await admin.from("email_health_state").upsert({
    id: true,
    last_state: persistState,
    last_alerted_at: isBad ? ((wasBad || !alertOk) ? undefined : now.toISOString()) : null,
    updated_at: now.toISOString(),
  }, { onConflict: "id" });
  if (upsertErr) {
    console.error("email-health-watcher: state upsert failed, skipping alert", upsertErr);
    return json({ error: "state_write_failed" }, 503);
  }

  return json({ state, alerted });
}

/**
 * In-app notification only for every super-admin (platform_admins) — no email.
 * Returns `{ ok: false }` whenever delivery could not be confirmed (recipient read failed,
 * or the notification insert failed) so the caller can retry on the next run instead of
 * advancing `last_state` past an alert that never actually landed. Zero super-admins is
 * `{ ok: true, count: 0 }` — there is no one to retry for, so state may still advance.
 */
async function alertSuperAdmins(deps: Deps, state: string, h: EmailSnapshot): Promise<{ ok: boolean; count: number }> {
  const { data, error: readErr } = await deps.admin.from("platform_admins").select("user_id");
  if (readErr) {
    console.error("email-health-watcher: platform_admins read failed, will retry", readErr);
    return { ok: false, count: 0 };
  }
  const ids = ((data ?? []) as { user_id: string }[]).map((a) => a.user_id);
  if (ids.length === 0) return { ok: true, count: 0 };

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const message =
    `Email delivery is ${state}: ${pct(h.delivery_rate)} delivered, ${pct(h.bounce_rate)} bounced, ` +
    `${pct(h.complaint_rate)} complaints, ${h.failure_count} send failures (last ${EMAIL_ALERT.windowMinutes}m).`;

  const { error } = await deps.admin.from("notifications").insert(ids.map((uid) => ({
    user_id: uid,
    org_id: null,
    type: "email_health_degraded",
    title: "Email delivery degraded",
    message,
    related_entity_type: "system",
    related_entity_id: null,
  })));
  if (error) {
    console.error("email-health-watcher: notification insert failed, will retry", error);
    return { ok: false, count: 0 };
  }
  return { ok: true, count: ids.length };
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
