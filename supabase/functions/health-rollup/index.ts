import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { analyticsDayKey } from "../_shared/analyticsTime.ts";
import { deriveRef, fetchFnSlugs } from "../_shared/analyticsApi.ts";
import type { Json } from "../_shared/database.types.ts";

/**
 * Daily health rollup. Every 15 min: read per-invocation outcomes from the Supabase Analytics
 * API and upsert one health_daily row per (day, function slug).
 *
 * WHY THIS EXISTS: the Analytics API retains 24 hours. The System Health console's 30-day
 * uptime bar cannot be derived from it, so the counts have to be durably recorded as they age
 * out. Nothing can be backfilled — history starts the day this first runs, and that first
 * "yesterday" row is necessarily partial (most of it had already aged out of Analytics before
 * the first pass). Every subsequent day is captured whole because the rollup sees it live.
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
  // 10000, vs platform-edge-metrics' 2000 for the same query shape: that one samples the last
  // 20 runs for a sparkline, this one must count a WHOLE day across every function (~500/day
  // today, with headroom for growth). A truncated read here would under-count a day.
  "order by t.timestamp desc limit 10000";

interface RawRow {
  function_id?: string;
  status_code?: number;
  execution_time_ms?: number;
  // Microseconds since the epoch, as an integer — NOT an ISO string. Always read it
  // through analyticsDayKey/toIsoTimestamp; see _shared/analyticsTime.ts.
  timestamp?: number | string;
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

/** UTC calendar day. The bar is an operational record written by a server with no user
 *  timezone, so UTC is the only stable key; the frontend buckets in UTC to match. */
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

function aggregate(rows: RawRow[], idToSlug: Map<string, string>, days: Set<string>): DailyRow[] {
  const buckets = new Map<string, RawRow[]>();
  for (const r of rows) {
    const day = analyticsDayKey(r.timestamp);
    if (day === null) continue;
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
  const startOfDay = (d: Date, offsetDays = 0) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offsetDays));
  const todayStart = startOfDay(now);
  const yesterdayStart = startOfDay(now, -1);

  // ONE REQUEST PER DAY, not one spanning both. The Analytics API caps a query's range at
  // 24 hours and clamps anything longer silently: asking for yesterday-00:00 through now
  // (up to 48h) came back holding only yesterday's rows, so today's bar never filled in.
  // Two calls per pass is well inside the ANALYTICS PAT's 60 req/min budget.
  const windows: Array<{ day: string; start: Date; end: Date }> = [
    { day: dayKey(yesterdayStart), start: yesterdayStart, end: todayStart },
    { day: dayKey(now), start: todayStart, end: now },
  ];

  const rows: DailyRow[] = [];
  let fetched = 0;
  let idToSlug = new Map<string, string>();

  for (const w of windows) {
    const url = `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all` +
      `?iso_timestamp_start=${encodeURIComponent(w.start.toISOString())}` +
      `&iso_timestamp_end=${encodeURIComponent(w.end.toISOString())}` +
      `&sql=${encodeURIComponent(METRICS_SQL)}`;

    let res: Response;
    try {
      res = await deps.fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      console.error("[health-rollup] Analytics fetch threw:", e instanceof Error ? e.message : String(e));
      return json({ error: "analytics_unavailable" }, 502);
    }
    if (!res.ok) {
      // Abort the whole pass without writing anything. A partial or empty rollup written over
      // a real day would turn a transient metrics outage into a permanent hole in the bar.
      console.error(`[health-rollup] Analytics ${res.status}:`, (await res.text().catch(() => "")).slice(0, 300));
      return json({ error: "analytics_unavailable", status: res.status }, 502);
    }

    const payload = await res.json().catch(() => ({ result: [] }));
    const raw = Array.isArray((payload as { result?: unknown }).result) ? (payload as { result: RawRow[] }).result : [];
    fetched += raw.length;
    if (raw.length === 0) continue;
    // Resolve slugs once, lazily — the map is the same for both windows.
    if (idToSlug.size === 0) idToSlug = await fetchFnSlugs(deps, ref, token);
    rows.push(...aggregate(raw, idToSlug, new Set([w.day])));
  }

  // "Fetched N, aggregated 0" is the one failure this function can hit while still returning
  // 200, and it is silent otherwise: the bar would just never fill in. Log the discriminating
  // fact (a raw timestamp) so the cause is visible without a redeploy.
  if (fetched > 0 && rows.length === 0) {
    console.error("[health-rollup] fetched rows but aggregated none", {
      fetched,
      wantDays: windows.map((w) => w.day),
    });
  }

  if (rows.length > 0) {
    // Via the RPC, not a plain .upsert(): the write must never REDUCE a day's counts.
    // Analytics retention is a rolling 24 hours, so a pass late on day N+1 can only see the
    // tail of day N — re-reading "yesterday" at 18:00 returns roughly six hours of it. A plain
    // overwrite would replace a complete day with that sliver and decay it further every 15
    // minutes. upsert_health_daily applies the update only when runs >= the stored value, so a
    // truncated read is ignored while genuine growth and identical re-runs both still apply.
    // jsonb arg: the generated type is the structural `Json`, so the row array is cast once
    // here at the call boundary (same idiom as generate-hire-orders' p_data).
    const { error } = await deps.admin.rpc("upsert_health_daily", { p_rows: rows as unknown as Json });
    if (error) {
      console.error("[health-rollup] upsert failed", error);
      return json({ error: "upsert_failed" }, 500);
    }
  }

  return json({ days: windows.length, rows: rows.length, fetched });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
