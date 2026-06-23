import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

/**
 * Cron-health watcher. Every ~15 min: read the latest HTTP outcome per cron job
 * (via cron_health_scan, which joins cron_health_dispatch -> net._http_response),
 * update cron_health_state, append failures to cron_health_log, and on a
 * transition INTO failure (healthy/unknown -> failing/stale) alert all super-admins
 * once (in-app notification + email). On recovery (-> healthy) send an in-app
 * notification only (no email — avoids flapping-job email storms). Idempotent via
 * cron_health_state.alerted_at.
 *
 * A 404'd function cannot report its own absence, so health is observed from the
 * cron (caller) side. Jobs that have never dispatched are skipped (unknown) so a
 * fresh system never false-alarms.
 *
 * Auth: X-Cron-Secret (pg_cron) or an admin JWT (manual trigger).
 */

/** Jobs we expect to dispatch, with max silence (minutes) before a still-unanswered dispatch is 'stale'. */
export const KNOWN_JOBS: Record<string, number> = {
  "offer-digest": 1500,
  "confirmation-digest": 1500,
  "expire-offers-hourly": 130,
  "tier-at-risk-hourly": 130,
  "airtable-poll": 30,
  "cron-health-watcher": 60,
};

type ScanRow = {
  job_name: string;
  request_id: number;
  dispatched_at: string;
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
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireCronOrRole(deps, req, ["admin"]);
  if (!auth.ok) return auth.response;

  const admin = deps.admin;
  const now = deps.now();

  const { data: scan } = await admin.rpc("cron_health_scan");
  const byJob = new Map(((scan ?? []) as ScanRow[]).map((r) => [r.job_name, r]));

  const { data: stateData } = await admin
    .from("cron_health_state").select("job_name, status, alerted_at, last_ok_at, consecutive_failures");
  const prevByJob = new Map(((stateData ?? []) as StateRow[]).map((s) => [s.job_name, s]));

  let newlyFailing = 0;
  let recovered = 0;

  for (const jobName of Object.keys(KNOWN_JOBS)) {
    const row = byJob.get(jobName);
    if (!row) continue; // never dispatched (or pruned) — nothing to assess yet.

    const ageMin = (now.getTime() - new Date(row.dispatched_at).getTime()) / 60000;
    let status: "healthy" | "failing" | "stale";
    let statusCode: number | null = null;
    let error: string | null = null;

    if (row.responded_at === null) {
      if (ageMin <= KNOWN_JOBS[jobName]) continue; // dispatched, awaiting response — re-check next run.
      status = "stale";
      error = "no response from function";
    } else {
      statusCode = row.status_code;
      const ok = !row.timed_out && statusCode !== null && statusCode >= 200 && statusCode < 300;
      status = ok ? "healthy" : "failing";
      if (!ok) error = row.timed_out ? "timed out" : (row.error_msg ?? `HTTP ${statusCode}`);
    }

    const prev = prevByJob.get(jobName);
    const prevStatus = prev?.status ?? "unknown";
    const failing = status !== "healthy";
    const wasFailing = prevStatus === "failing" || prevStatus === "stale";

    await admin.from("cron_health_state").upsert({
      job_name: jobName,
      status,
      last_status_code: statusCode,
      last_response_at: row.responded_at,
      last_dispatched_at: row.dispatched_at,
      last_ok_at: status === "healthy" ? now.toISOString() : (prev?.last_ok_at ?? null),
      last_error: error,
      consecutive_failures: failing ? (prev?.consecutive_failures ?? 0) + 1 : 0,
      alerted_at: failing ? (wasFailing ? (prev?.alerted_at ?? now.toISOString()) : now.toISOString()) : null,
      updated_at: now.toISOString(),
    }, { onConflict: "job_name" });

    if (failing) {
      await admin.from("cron_health_log").insert({ job_name: jobName, status_code: statusCode, error });
      if (!wasFailing) {
        newlyFailing++;
        await alertSuperAdmins(deps, jobName, statusCode, error, prev?.last_ok_at ?? null);
      }
    } else if (wasFailing) {
      recovered++;
      await notifyRecovery(deps, jobName);
    }
  }

  // Prune: dispatch rows older than 1 day, failure log older than 30 days.
  await admin.from("cron_health_dispatch").delete()
    .lt("dispatched_at", new Date(now.getTime() - 86_400_000).toISOString());
  await admin.from("cron_health_log").delete()
    .lt("observed_at", new Date(now.getTime() - 30 * 86_400_000).toISOString());

  return json({ checked: byJob.size, newly_failing: newlyFailing, recovered });
}

/** Super-admin user ids (platform_admins). */
async function superAdminIds(admin: Deps["admin"]): Promise<string[]> {
  const { data } = await admin.from("platform_admins").select("user_id");
  return ((data ?? []) as { user_id: string }[]).map((a) => a.user_id);
}

/** Insert one in-app notification per super-admin (server-side — satisfies the no-bare-client-insert rule). */
async function notifyAll(
  admin: Deps["admin"],
  ids: string[],
  title: string,
  message: string,
  jobName: string,
): Promise<void> {
  if (ids.length === 0) return;
  await admin.from("notifications").insert(ids.map((uid) => ({
    user_id: uid,
    type: "cron_health_alert",
    title,
    message,
    related_entity_type: "cron_job",
    related_entity_id: jobName,
  })));
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
    jobName,
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
          dashboard_url: "https://showflow.pro/platform",
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
  await notifyAll(deps.admin, ids, "Scheduled job recovered", `${jobName} is responding normally again.`, jobName);
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
