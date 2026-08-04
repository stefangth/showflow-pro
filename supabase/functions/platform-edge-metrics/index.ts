import { preflight, json } from "../_shared/http.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { toIsoTimestamp } from "../_shared/analyticsTime.ts";

const MAX_WINDOW_MIN = 1440; // Management API caps the analytics range at 24h.

/** Mirrors src/lib/systemHealth.ts EdgeFnMetric — keep in sync. */
interface EdgeFnMetric {
  fn: string; invocations: number; errors: number; rejected: number;
  byStatus: Record<string, number>;
  p50Ms: number | null; p95Ms: number | null;
  lastInvokedAt: string | null; lastStatus: number | null;
  lastFailure: { status: number; at: string } | null;
  recent: { status: number; ms: number; at?: string }[];
}
// `timestamp` is a MICROSECOND epoch integer, not an ISO string (verified against the live
// API 2026-08-04). Normalise it through toIsoTimestamp before it reaches a Date or the client.
interface RawRow { function_id?: string; status_code?: number; execution_time_ms?: number; timestamp?: number | string }

// The function_edge_logs schema keys each row by function_id (a UUID) — there is NO
// function_name column (verified against the live Analytics API). function_id -> slug
// resolution happens in fetchFnSlugs below. Keep the SQL in this one constant.
const METRICS_SQL =
  "select m.function_id, r.status_code, m.execution_time_ms, t.timestamp " +
  "from function_edge_logs t cross join unnest(t.metadata) m cross join unnest(m.response) r " +
  "order by t.timestamp desc limit 2000";

// UNVERIFIED against the live Analytics API — the ANALYTICS PAT is an edge secret not
// available locally (decision 2026-07-21, confirmed with the repo owner), so this SQL is
// built from Supabase's documented shape only. function_logs is assumed to be a SEPARATE
// collection from function_edge_logs used by METRICS_SQL above: the former carries console
// output (event_message/level), the latter the HTTP result. Every field read from a
// resulting row is defensively optional-chained in fnLogs below — a wrong guess here
// degrades to an empty drill-down, never a crash. Post-deploy verification is a human step.
const LOGS_SQL =
  "select t.timestamp, m.level, t.event_message " +
  "from function_logs t cross join unnest(t.metadata) m " +
  "where m.function_id = '{FN_ID}' and m.level in ('error','warning') " +
  "order by t.timestamp desc limit 25";

function deriveRef(url?: string): string | null {
  const m = (url ?? "").match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

/** id -> slug map from the Management API (GET /v1/projects/{ref}/functions returns a bare
 *  array of { id, slug, name, ... }). Best-effort: a failure degrades to id-labelled metrics
 *  rather than blanking the panel, so latency data survives a name-resolution outage. */
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

function aggregate(rows: RawRow[], idToSlug: Map<string, string>): EdgeFnMetric[] {
  const byFn = new Map<string, RawRow[]>();
  for (const r of rows) {
    const fn = (r.function_id && idToSlug.get(r.function_id)) || r.function_id || "unknown";
    const arr = byFn.get(fn) ?? [];
    arr.push(r); byFn.set(fn, arr);
  }
  return [...byFn.entries()].map(([fn, rs]) => {
    const lat = rs.map((r) => Number(r.execution_time_ms)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    const pct = (p: number): number | null =>
      // Nearest-rank: ceil(p% * N) - 1. Plain floor returns the MAX for p95 when N is a multiple of 20.
      lat.length === 0 ? null : lat[Math.min(lat.length - 1, Math.max(0, Math.ceil((p / 100) * lat.length) - 1))];
    // Sort on the normalised ISO value: raw microsecond integers compare correctly as numbers
    // but not reliably as strings once their digit count changes.
    const iso = (r: RawRow) => toIsoTimestamp(r.timestamp) ?? "";
    const sorted = [...rs].sort((a, b) => iso(b).localeCompare(iso(a)));
    const last = sorted[0];
    const byStatus: Record<string, number> = {};
    for (const r of rs) {
      const key = String(Number(r.status_code) || 0);
      byStatus[key] = (byStatus[key] ?? 0) + 1;
    }
    // Most recent non-2xx. `sorted` is already newest-first, so the first match wins.
    // A 4xx counts here as much as a 5xx: to a caller, a rejection and a crash are
    // both "the call did not do its job".
    const failure = sorted.find((r) => Number(r.status_code) >= 400);
    return {
      fn,
      invocations: rs.length,
      errors: rs.filter((r) => Number(r.status_code) >= 500).length,
      rejected: rs.filter((r) => {
        const s = Number(r.status_code);
        return s >= 400 && s < 500;
      }).length,
      byStatus,
      p50Ms: pct(50),
      p95Ms: pct(95),
      lastInvokedAt: last ? iso(last) || null : null,
      lastStatus: last?.status_code ?? null,
      lastFailure: failure ? { status: Number(failure.status_code), at: iso(failure) } : null,
      // `at` carries each tick's own time so the dashboard timeline can say WHEN a run
      // failed on hover; omitted (not null) when the row has no usable timestamp.
      recent: sorted.slice(0, 20).map((r) => {
        const at = toIsoTimestamp(r.timestamp);
        return {
          status: Number(r.status_code) || 0,
          ms: Number(r.execution_time_ms) || 0,
          ...(at ? { at } : {}),
        };
      }),
    };
  });
}

interface RawLogRow { timestamp?: string; level?: string; event_message?: string }

/** Recent error/warning console output for ONE function. Split from the metrics query
 *  and fetched on demand: the ANALYTICS PAT is capped at 60 req/min and the panel polls
 *  every 60s, so this must not ride the refresh cycle. Every field on a returned row is
 *  untrusted (see the LOGS_SQL comment) — defaults stand in for anything missing or the
 *  wrong shape, so a schema mismatch yields an empty/garbled line, never a throw. */
async function fnLogs(deps: Deps, ref: string, token: string, fn: string, windowMin: number): Promise<Response> {
  const idToSlug = await fetchFnSlugs(deps, ref, token);
  const fnId = [...idToSlug.entries()].find(([, slug]) => slug === fn)?.[0];
  if (!fnId) return json({ lines: [] });

  const end = deps.now();
  const start = new Date(end.getTime() - windowMin * 60_000);
  const url = `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all` +
    `?iso_timestamp_start=${encodeURIComponent(start.toISOString())}` +
    `&iso_timestamp_end=${encodeURIComponent(end.toISOString())}` +
    `&sql=${encodeURIComponent(LOGS_SQL.replace("{FN_ID}", fnId))}`;

  let res: Response;
  try {
    res = await deps.fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    console.error("[platform-edge-metrics] logs fetch threw:", e instanceof Error ? e.message : String(e));
    return json({ error: "analytics_unavailable" }, 502);
  }
  if (!res.ok) return json({ error: "analytics_unavailable", status: res.status }, 502);

  const payload = await res.json().catch(() => ({ result: [] }));
  const rows = Array.isArray((payload as { result?: unknown }).result) ? (payload as { result: RawLogRow[] }).result : [];
  return json({
    lines: rows.map((r) => ({
      at: r.timestamp ?? "",
      level: r.level ?? "error",
      message: r.event_message ?? "",
    })),
  });
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireSuperAdmin(deps, req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const requested = Number((body as { window_minutes?: unknown }).window_minutes);
  const windowMin = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_WINDOW_MIN) : MAX_WINDOW_MIN;

  const ref = deps.env("SUPABASE_PROJECT_REF") ?? deriveRef(deps.env("SUPABASE_URL"));
  const token = deps.env("ANALYTICS");
  if (!ref || !token) return json({ error: "metrics_unconfigured" }, 500);

  if ((body as { action?: unknown }).action === "logs") {
    const fn = (body as { fn?: unknown }).fn;
    if (typeof fn !== "string" || fn === "") return json({ error: "fn required" }, 400);
    return fnLogs(deps, ref, token, fn, windowMin);
  }

  const end = deps.now();
  const start = new Date(end.getTime() - windowMin * 60_000);
  const url = `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all` +
    `?iso_timestamp_start=${encodeURIComponent(start.toISOString())}` +
    `&iso_timestamp_end=${encodeURIComponent(end.toISOString())}` +
    `&sql=${encodeURIComponent(METRICS_SQL)}`;

  let res: Response;
  try {
    res = await deps.fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    console.error("[platform-edge-metrics] Analytics fetch threw:", e instanceof Error ? e.message : String(e));
    return json({ error: "analytics_unavailable" }, 502);
  }
  if (!res.ok) {
    // Distinguishes a query error (400, e.g. a bad column) from a PAT problem (401/403) — the SQL is
    // fixed, so a lingering 502 here means the ANALYTICS token, not the query.
    console.error(`[platform-edge-metrics] Analytics ${res.status}:`, (await res.text().catch(() => "")).slice(0, 300));
    return json({ error: "analytics_unavailable", status: res.status }, 502);
  }

  const payload = await res.json().catch(() => ({ result: [] }));
  const rows = Array.isArray((payload as { result?: unknown }).result) ? (payload as { result: RawRow[] }).result : [];
  // Resolve function_id -> slug only when there's data (keeps the empty-window path to one API call).
  const idToSlug = rows.length ? await fetchFnSlugs(deps, ref, token) : new Map<string, string>();
  return json({ functions: aggregate(rows, idToSlug) });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
