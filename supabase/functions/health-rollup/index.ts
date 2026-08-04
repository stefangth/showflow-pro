import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

/**
 * Daily health rollup. Every 15 min: read per-invocation outcomes from the Supabase Analytics
 * API and upsert one health_daily row per (day, function slug).
 *
 * WHY THIS EXISTS: the Analytics API retains 24 hours. The System Health console's 30-day
 * uptime bar cannot be derived from it, so the counts have to be durably recorded as they age
 * out. Nothing can be backfilled — history starts the day this first runs.
 *
 * WHY RECOMPUTE, NOT INCREMENT: the writer must be idempotent. pg_cron can double-fire, a run
 * can be retried, and a partial write must not permanently skew a day's counts. Each pass
 * recomputes a whole day from source and overwrites it.
 *
 * WHY TODAY *AND* YESTERDAY: the last pass before midnight cannot see the final minutes of the
 * day. Rewriting yesterday on every pass closes that gap; after 00:15 UTC yesterday is final.
 *
 * Auth: X-Cron-Secret only (platform-scoped, like cron-health-watcher). Passing [] as the role
 * list means the requireRole fallback matches nothing, so no JWT can trigger this.
 */

// Same shape as platform-edge-metrics' METRICS_SQL. The Analytics API keys rows by function_id
// (a UUID); there is no function_name column, so slugs are resolved separately below.
const METRICS_SQL =
  "select m.function_id, r.status_code, m.execution_time_ms, t.timestamp " +
  "from function_edge_logs t cross join unnest(t.metadata) m cross join unnest(m.response) r " +
  "order by t.timestamp desc limit 10000";

interface RawRow {
  function_id?: string;
  status_code?: number;
  execution_time_ms?: number;
  timestamp?: string;
}

interface DailyRow {
  day: string;
  fn: string;
  runs: number;
  failures: number;
  rejected: number;
  worst_status: number | null;
  p95_ms: number | null;
}

function deriveRef(url?: string): string | null {
  const m = (url ?? "").match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

/** id -> slug from the Management API. Best-effort: on failure rows keep their raw id, which
 *  still produces a usable (if ugly) series rather than dropping the day entirely. */
async function fetchFnSlugs(deps: Deps, ref: string, token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await deps.fetch(`https://api.supabase.com/v1/projects/${ref}/functions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return map;
    const parsed = await res.json().catch(() => null);
    const list = Array.isArray(parsed) ? parsed : ((parsed as { functions?: unknown } | null)?.functions ?? []);
    for (const f of list as Array<{ id?: string; slug?: string; name?: string }>) {
      const label = f?.slug ?? f?.name;
      if (f?.id && label) map.set(f.id, label);
    }
  } catch (_e) { /* degrade to id labels */ }
  return map;
}

/** UTC calendar day. The bar is an operational record written by a server with no user
 *  timezone, so UTC is the only stable key; the frontend buckets in UTC to match. */
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

function aggregate(rows: RawRow[], idToSlug: Map<string, string>, days: Set<string>): DailyRow[] {
  const buckets = new Map<string, RawRow[]>();
  for (const r of rows) {
    if (!r.timestamp) continue;
    const at = new Date(r.timestamp);
    if (Number.isNaN(at.getTime())) continue;
    const day = dayKey(at);
    // Only the days this pass recomputes. A partial older day would overwrite a complete one.
    if (!days.has(day)) continue;
    const fn = (r.function_id && idToSlug.get(r.function_id)) || r.function_id || "unattributed";
    const key = `${day} ${fn}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(r); else buckets.set(key, [r]);
  }
  return [...buckets.entries()].map(([key, rs]) => {
    const [day, fn] = key.split(" ");
    const status = (r: RawRow) => Number(r.status_code) || 0;
    // status 0 means the run produced no HTTP response at all — as much a failure as a 5xx.
    const failures = rs.filter((r) => status(r) <= 0 || status(r) >= 500).length;
    const rejected = rs.filter((r) => status(r) >= 400 && status(r) < 500).length;
    const lat = rs.map((r) => Number(r.execution_time_ms)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    // Nearest-rank p95: ceil(0.95 * N) - 1. Plain floor returns the max when N is a multiple of 20.
    const p95 = lat.length === 0 ? null : lat[Math.min(lat.length - 1, Math.max(0, Math.ceil(0.95 * lat.length) - 1))];
    const codes = rs.map(status).filter((s) => s > 0);
    return {
      day,
      fn,
      runs: rs.length,
      failures,
      rejected,
      worst_status: codes.length ? Math.max(...codes) : null,
      p95_ms: p95 === null ? null : Math.round(p95),
    };
  });
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireCronOrRole(deps, req, []);
  if (!auth.ok) return auth.response;

  const ref = deps.env("SUPABASE_PROJECT_REF") ?? deriveRef(deps.env("SUPABASE_URL"));
  const token = deps.env("ANALYTICS");
  if (!ref || !token) return json({ error: "metrics_unconfigured" }, 500);

  const now = deps.now();
  // Start of yesterday (UTC) through now: exactly the two days this pass rewrites.
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const days = new Set([dayKey(start), dayKey(now)]);

  const url = `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all` +
    `?iso_timestamp_start=${encodeURIComponent(start.toISOString())}` +
    `&iso_timestamp_end=${encodeURIComponent(now.toISOString())}` +
    `&sql=${encodeURIComponent(METRICS_SQL)}`;

  let res: Response;
  try {
    res = await deps.fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    console.error("[health-rollup] Analytics fetch threw:", e instanceof Error ? e.message : String(e));
    return json({ error: "analytics_unavailable" }, 502);
  }
  if (!res.ok) {
    // Abort without writing. A partial or empty rollup written over a real day would turn a
    // metrics outage into a permanent hole in the uptime bar.
    console.error(`[health-rollup] Analytics ${res.status}:`, (await res.text().catch(() => "")).slice(0, 300));
    return json({ error: "analytics_unavailable", status: res.status }, 502);
  }

  const payload = await res.json().catch(() => ({ result: [] }));
  const raw = Array.isArray((payload as { result?: unknown }).result) ? (payload as { result: RawRow[] }).result : [];
  const idToSlug = raw.length ? await fetchFnSlugs(deps, ref, token) : new Map<string, string>();
  const rows = aggregate(raw, idToSlug, days);

  if (rows.length > 0) {
    const { error } = await deps.admin.from("health_daily").upsert(
      rows.map((r) => ({ ...r, updated_at: now.toISOString() })),
      { onConflict: "day,fn" },
    );
    if (error) {
      console.error("[health-rollup] upsert failed", error);
      return json({ error: "upsert_failed" }, 500);
    }
  }

  return json({ days: days.size, rows: rows.length });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
