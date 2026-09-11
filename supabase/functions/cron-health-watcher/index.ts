import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { appUrl } from "../_shared/app-url.ts";

/**
 * Cron-health watcher. Every ~15 min: read the latest HTTP outcome per cron job
 * (via cron_health_scan, which joins cron_health_dispatch -> net._http_response),
 * update cron_health_state, and alert all super-admins once (in-app notification +
 * email) when a job's failure is confirmed. Failures are DEBOUNCED: an HTTP failure
 * (non-2xx/timeout) must recur for two distinct observations in a row before it is
 * announced, so a single self-healing 500/503/401 does not email anyone. Staleness
 * (the cron stopped firing) is already sustained and alerts on first detection. The
 * announced incident is also appended to cron_health_log at that point. On recovery
 * (-> healthy) send an in-app notification only (no email), and only if the incident
 * was actually announced. Idempotent via cron_health_state.alerted_at, which is the
 * single marker of an announced-and-ongoing incident.
 *
 * A 404'd function cannot report its own absence, so health is observed from the
 * cron (caller) side. Detection per known job:
 *   - latest dispatch older than its max-silence window  -> stale (cron stopped firing,
 *     or the function never responded), regardless of any older response;
 *   - dispatched recently, no response yet               -> pending (skip, re-check next run);
 *   - dispatched recently with a response                -> healthy (2xx) / failing (non-2xx/timeout);
 *   - never dispatched                                   -> unknown (skip).
 *
 * SELF-MONITORING: the watcher's own dispatch is in flight for the whole time it runs, so it can
 * never see a response to the request that invoked it. cron_health_scan therefore reports the
 * outcome of the newest ANSWERED dispatch (answered_at) while dispatched_at still tracks the
 * newest dispatch of any kind, which is what lets the watcher classify itself from its previous
 * completed run. Before that split it could mark itself failing (pg_net abandons its request at
 * the timeout and writes timed_out, which the still-running watcher then reads) but never mark
 * itself healthy again — prod sat at last_ok_at 2026-06-24 while returning 200 every 15 minutes.
 * Liveness is still observed externally: the dashboard surfaces `last_run_at` from
 * cron.job_run_details; if that ages, the watcher itself has stopped.
 *
 * Auth: X-Cron-Secret (pg_cron) only — platform-scoped, so no org-admin JWT fallback.
 */

/** Jobs we expect to dispatch, with max silence (minutes) before the latest dispatch is 'stale'. */
export const KNOWN_JOBS: Record<string, number> = {
  "offer-digest": 1320, // max dispatch gap (cron 0 16-19 UTC → 1260m) + 60m buffer
  "confirmation-digest": 1320, // max dispatch gap (cron 0 17-20 UTC → 1260m) + 60m buffer
  "expire-offers-hourly": 130,
  "tier-at-risk-hourly": 130,
  "airtable-poll": 30,
  "cron-health-watcher": 60, // displayed only; see SELF-MONITORING above.
  "email-health-watcher": 60, // */15 job; same max-silence as its sibling cron-health-watcher.
  // */15 job. Without this entry the rollup would be the one unmonitored cron: it could stop
  // writing and the System Health uptime bar would quietly flatline with nobody alerted.
  "health-rollup": 60,
};

type ScanRow = {
  job_name: string;
  request_id: number | null;
  dispatched_at: string; // newest dispatch of any kind — the staleness source
  answered_at: string | null; // dispatch the outcome below came from; may be older
  status_code: number | null;
  timed_out: boolean | null;
  error_msg: string | null;
  responded_at: string | null;
};
type StateRow = {
  job_name: string;
  status: string;
  alerted_at: string | null;
  last_ok_at: string | null;
  consecutive_failures: number;
  last_observation_key: string | null;
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  // Platform-scoped watcher: cron-secret only, no org-role JWT fallback. An org-admin must not be able
  // to trigger platform-wide super-admin alerts (this differs from the per-org cron watchers). Passing
  // [] means the requireRole fallback matches no role, so only a valid X-Cron-Secret is accepted.
  const auth = await requireCronOrRole(deps, req, []);
  if (!auth.ok) return auth.response;

  const admin = deps.admin;
  const now = deps.now();

  // Abort on read errors: a swallowed scan error would make a monitoring blackout look
  // healthy, and a swallowed state-read error would treat every failing job as a fresh
  // transition and re-alert all super-admins on every run (alert storm).
  const { data: scan, error: scanErr } = await admin.rpc("cron_health_scan");
  if (scanErr) {
    console.error("cron-health-watcher: cron_health_scan failed, aborting", scanErr);
    return json({ error: "scan_failed", detail: (scanErr as { message?: string }).message }, 503);
  }
  const byJob = new Map(((scan ?? []) as ScanRow[]).map((r) => [r.job_name, r]));

  const { data: stateData, error: stateErr } = await admin
    .from("cron_health_state").select("job_name, status, alerted_at, last_ok_at, consecutive_failures, last_observation_key");
  if (stateErr) {
    console.error("cron-health-watcher: state read failed, aborting to prevent alert storm", stateErr);
    return json({ error: "state_read_failed", detail: (stateErr as { message?: string }).message }, 503);
  }
  const prevByJob = new Map(((stateData ?? []) as StateRow[]).map((s) => [s.job_name, s]));

  let newlyFailing = 0;
  let recovered = 0;
  let assessed = 0; // jobs actually classified this run — excludes never-dispatched and in-flight (no response yet)

  for (const jobName of Object.keys(KNOWN_JOBS)) {
    const row = byJob.get(jobName);
    if (!row) continue; // never dispatched (or pruned) — nothing to assess yet.

    const ageMin = (now.getTime() - new Date(row.dispatched_at).getTime()) / 60000;
    let status: "healthy" | "failing" | "stale";
    let statusCode: number | null = null;
    let error: string | null = null;

    if (ageMin > KNOWN_JOBS[jobName]) {
      // Latest dispatch is older than expected → the cron has stopped firing (or the
      // function never responded). A stale dispatch is a failure regardless of any old response.
      status = "stale";
      statusCode = null; // an old success code is meaningless for a staleness failure — avoid a red "stale (200)" badge
      error = row.responded_at === null
        ? `no response ${Math.round(ageMin)}m after dispatch`
        : `cron not firing (no dispatch in ${Math.round(ageMin)}m)`;
    } else if (row.responded_at === null) {
      continue; // dispatched recently, response in-flight — re-check next run.
    } else {
      statusCode = row.status_code;
      const ok = !row.timed_out && statusCode !== null && statusCode >= 200 && statusCode < 300;
      status = ok ? "healthy" : "failing";
      if (!ok) error = row.timed_out ? "timed out" : (row.error_msg ?? `HTTP ${statusCode}`);
    }

    const prev = prevByJob.get(jobName);
    const failing = status !== "healthy";
    // alerted_at is the source of truth for "an incident has been announced" — it is stamped only when
    // an alert actually goes out (below) and cleared on recovery. It gates both re-alerting and whether
    // a recovery is worth announcing, so a debounced blip that never alerted also recovers silently.
    const prevAlerted = prev?.alerted_at != null;

    // consecutive_failures counts distinct failed OBSERVATIONS, not watcher passes. An hourly job
    // scanned by a */15 watcher re-reads the same dispatch row up to 4 times; incrementing on each
    // pass turned one timeout into "3 consecutive failures" on the prod dashboard.
    const observationKey = status === "stale"
      ? `stale:${row.dispatched_at}`
      : `req:${row.request_id}`;
    const repeatObservation = prev?.last_observation_key === observationKey;
    const consecutiveFailures = failing
      ? (repeatObservation ? (prev?.consecutive_failures ?? 0) : (prev?.consecutive_failures ?? 0) + 1)
      : 0;

    // Debounce transient HTTP blips: a job that returns non-2xx/timeout must fail TWO distinct
    // observations in a row before we announce it, so a single self-healing 500/503/401 no longer
    // emails every super-admin (the flapping that produced ~12 alert emails overnight). Staleness is
    // already a sustained condition — silence past the max-silence window, which carries a >=60m buffer,
    // and by nature has only one observation to count — so it still alerts on first detection.
    const alertThreshold = status === "stale" ? 1 : 2;
    const announce = failing && !prevAlerted && consecutiveFailures >= alertThreshold;

    const { error: upsertErr } = await admin.from("cron_health_state").upsert({
      job_name: jobName,
      status,
      last_status_code: statusCode,
      last_response_at: row.responded_at,
      last_dispatched_at: row.dispatched_at,
      last_ok_at: status === "healthy" ? now.toISOString() : (prev?.last_ok_at ?? null),
      last_error: error,
      consecutive_failures: consecutiveFailures,
      last_observation_key: observationKey,
      // Stamp alerted_at only when we actually announce this run; preserve it while an announced
      // incident continues (may be null if a prior write was lost) — never fabricate a timestamp;
      // clear it on recovery.
      alerted_at: failing ? (prevAlerted ? (prev?.alerted_at ?? null) : (announce ? now.toISOString() : null)) : null,
      updated_at: now.toISOString(),
    }, { onConflict: "job_name" });
    // Guard the write like the reads above: if the state didn't persist, skip alerting this run.
    // Otherwise a dropped write leaves prev unadvanced and we could re-alert on a later run (storm).
    if (upsertErr) {
      console.error("cron-health-watcher: state upsert failed, skipping alerts for", jobName, upsertErr);
      continue;
    }
    assessed++;

    if (announce) {
      // Log once per announced incident (on the crossing), not every run — a sustained outage would
      // otherwise flood cron_health_log and make get_cron_health's recent_failures N copies of one event.
      await admin.from("cron_health_log").insert({ job_name: jobName, status_code: statusCode, error });
      newlyFailing++;
      await alertSuperAdmins(deps, jobName, statusCode, error, prev?.last_ok_at ?? null);
    } else if (!failing && prevAlerted) {
      recovered++;
      await notifyRecovery(deps, jobName);
    }
  }

  // Prune: dispatch rows older than 1 day, failure log older than 30 days.
  await admin.from("cron_health_dispatch").delete()
    .lt("dispatched_at", new Date(now.getTime() - 86_400_000).toISOString());
  await admin.from("cron_health_log").delete()
    .lt("observed_at", new Date(now.getTime() - 30 * 86_400_000).toISOString());

  // `checked` = jobs actually classified this run, not jobs with a dispatch row — an in-flight job
  // (dispatched, no response yet) is skipped above and must not inflate the count.
  return json({ checked: assessed, newly_failing: newlyFailing, recovered });
}

/** Super-admin user ids (platform_admins). */
async function superAdminIds(admin: Deps["admin"]): Promise<string[]> {
  const { data } = await admin.from("platform_admins").select("user_id");
  return ((data ?? []) as { user_id: string }[]).map((a) => a.user_id);
}

/**
 * Insert one in-app notification per super-admin (server-side — satisfies the no-bare-client-insert rule).
 * org_id is left null: cron-health is platform-level, not org-scoped (the notifications.org_id NOT NULL
 * constraint was dropped for exactly this).
 *
 * In-app delivery is best-effort: an insert error is logged but not thrown, so the email path (the
 * guaranteed alert channel) still runs. Re-alerting is gated on the status transition (wasFailing), not
 * on this insert, so a rare transient failure costs at most one missing in-app bell — the email still
 * goes out. Per-channel delivery tracking would be the only way to retry just the bell, which isn't
 * worth the added state for a supplementary channel.
 */
async function notifyAll(
  admin: Deps["admin"],
  ids: string[],
  title: string,
  message: string,
): Promise<void> {
  if (ids.length === 0) return;
  // related_entity_id is a uuid column — a job-name string throws "invalid input syntax for type
  // uuid" and (because the error is logged, not thrown) would silently drop every alert. The job
  // name is conveyed by related_entity_type + the message text instead.
  const { error } = await admin.from("notifications").insert(ids.map((uid) => ({
    user_id: uid,
    org_id: null,
    type: "cron_health_alert",
    title,
    message,
    related_entity_type: "cron_job",
    related_entity_id: null,
  })));
  if (error) console.error("cron-health-watcher: notification insert failed", { error });
}

/** Failure alert: in-app notification + email to every super-admin. */
async function alertSuperAdmins(
  deps: Deps,
  jobName: string,
  statusCode: number | null,
  error: string | null,
  lastOkAt: string | null,
): Promise<void> {
  const admin = deps.admin;
  const ids = await superAdminIds(admin);
  if (ids.length === 0) return;

  await notifyAll(
    admin,
    ids,
    "Scheduled job failing",
    `${jobName} last returned ${statusCode ?? "no response"}${error ? ` (${error})` : ""}.`,
  );

  // Email per super-admin (login-email via the service-role resolver).
  const { data: contacts } = await admin.rpc("resolve_user_contacts", { p_user_ids: ids });
  for (const c of ((contacts ?? []) as { email: string | null }[])) {
    if (!c.email) continue;
    try {
      await deps.sendEmail({
        template_name: "cron-health-alert",
        recipient_email: c.email,
        templateData: {
          job_name: jobName,
          status_code: statusCode ?? "no response",
          error: error ?? "",
          last_ok_at: lastOkAt ?? "unknown",
          dashboard_url: `${appUrl(deps.env)}/platform`,
        },
      });
    } catch (e) {
      console.error("cron-health-watcher: alert email failed", { jobName, error: (e as Error).message });
    }
  }
}

/** Recovery: in-app notification only (no email — recovery is good news and avoids flapping-job email storms). */
async function notifyRecovery(deps: Deps, jobName: string): Promise<void> {
  const ids = await superAdminIds(deps.admin);
  await notifyAll(deps.admin, ids, "Scheduled job recovered", `${jobName} is responding normally again.`);
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
