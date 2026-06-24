import { preflight, json } from "../_shared/http.ts";
import { requireSuperAdmin } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

const MAX_WINDOW_MIN = 1440; // Management API caps the analytics range at 24h.

/** Mirrors src/lib/systemHealth.ts EdgeFnMetric — keep in sync. */
interface EdgeFnMetric {
  fn: string; invocations: number; errors: number;
  p50Ms: number | null; p95Ms: number | null;
  lastInvokedAt: string | null; lastStatus: number | null;
  recent: { status: number; ms: number }[];
}
interface RawRow { function_name?: string; name?: string; status_code?: number; execution_time_ms?: number; timestamp?: string }

// VERIFY AT IMPLEMENTATION: confirm the log source name + column names against the live
// Analytics API (the MCP get_logs edge-function shape: execution_time_ms, status_code,
// timestamp, function_id). Keep the SQL in this one constant.
const METRICS_SQL =
  "select m.function_name, r.status_code, m.execution_time_ms, t.timestamp " +
  "from function_edge_logs t cross join unnest(t.metadata) m cross join unnest(m.response) r " +
  "order by t.timestamp desc limit 2000";

function deriveRef(url?: string): string | null {
  const m = (url ?? "").match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

function aggregate(rows: RawRow[]): EdgeFnMetric[] {
  const byFn = new Map<string, RawRow[]>();
  for (const r of rows) {
    const fn = r.function_name ?? r.name ?? "unknown";
    const arr = byFn.get(fn) ?? [];
    arr.push(r); byFn.set(fn, arr);
  }
  return [...byFn.entries()].map(([fn, rs]) => {
    const lat = rs.map((r) => Number(r.execution_time_ms)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    const pct = (p: number): number | null =>
      // Nearest-rank: ceil(p% * N) - 1. Plain floor returns the MAX for p95 when N is a multiple of 20.
      lat.length === 0 ? null : lat[Math.min(lat.length - 1, Math.ceil((p / 100) * lat.length) - 1)];
    const sorted = [...rs].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    const last = sorted[0];
    return {
      fn,
      invocations: rs.length,
      errors: rs.filter((r) => Number(r.status_code) >= 500).length,
      p50Ms: pct(50),
      p95Ms: pct(95),
      lastInvokedAt: last?.timestamp ?? null,
      lastStatus: last?.status_code ?? null,
      recent: sorted.slice(0, 20).map((r) => ({ status: Number(r.status_code) || 0, ms: Number(r.execution_time_ms) || 0 })),
    };
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

  const end = deps.now();
  const start = new Date(end.getTime() - windowMin * 60_000);
  const url = `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all` +
    `?iso_timestamp_start=${encodeURIComponent(start.toISOString())}` +
    `&iso_timestamp_end=${encodeURIComponent(end.toISOString())}` +
    `&sql=${encodeURIComponent(METRICS_SQL)}`;

  let res: Response;
  try {
    res = await deps.fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (_e) {
    return json({ error: "analytics_unavailable" }, 502);
  }
  if (!res.ok) return json({ error: "analytics_unavailable", status: res.status }, 502);

  const payload = await res.json().catch(() => ({ result: [] }));
  const rows = Array.isArray((payload as { result?: unknown }).result) ? (payload as { result: RawRow[] }).result : [];
  return json({ functions: aggregate(rows) });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
