# 30-Day Uptime Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two per-row status strips in the platform System Health console with a single Statuspage-style 30-day uptime bar, applied uniformly to every scheduled job and every edge function, with per-run detail moved into a keyboard-reachable "Recent runs" text list.

**Architecture:** Supabase's Analytics API only retains 24 hours, so a 30-day bar needs a durable rollup. A new `public.health_daily` table stores one row per (day, function slug) with run/failure/rejection counts and p95. A new `health-rollup` edge function, dispatched by pg_cron every 15 minutes, recomputes **today and yesterday** from the Analytics API and upserts them — recomputing rather than incrementing makes it idempotent, and covering yesterday closes the gap at the midnight boundary. Scheduled jobs and on-demand functions share this one source because cron jobs *are* deployed edge functions (`CRON_JOB_TO_FN` maps job name to slug); the panels differ only in how they label the row. History starts accumulating the day this deploys; earlier days render as an explicit "no data" cell.

**Tech Stack:** Postgres + pg_cron + pg_net, Deno edge functions, React 18 + TypeScript, `@tanstack/react-query` v5, Tailwind + shadcn/ui (Radix Tooltip), Vitest + Testing Library, Deno test, pgTAP.

## Global Constraints

- **Window:** 30 days. Single source of truth: `SYSTEM_HEALTH.uptimeDays` in `src/config/app.config.ts`.
- **`any` is banned** — lint is CI-gated at `--max-warnings 0`. For Supabase rows supabase-js can't infer, declare an explicit local `interface` and cast once at the query boundary with `as unknown as Row[]`.
- **No em-dashes or en-dashes in user-facing copy** (UI strings, tooltips, labels). Use a period, comma, colon or middot (`·`).
- **Semantic Tailwind tokens only** (`bg-success`, `bg-destructive`, `bg-muted`, `text-muted-foreground`). Never `bg-white`/`bg-green-500`. The `accent-50`..`accent-900` stops do NOT support `/opacity` modifiers; other semantic tokens do.
- **Never hand-edit** `src/integrations/supabase/types.ts` or any file whose header says `GENERATED FILE. Do not edit.`
- **Every new table needs RLS enabled with explicit policies.** `health_daily` is platform-scoped (not org-scoped), so it follows the `cron_health_log` template: super-admin `SELECT` only, no write policy (writes come from the service-role rollup, which bypasses RLS).
- **Tests import the real module.** Never re-implement production logic inside a test file.
- **Edge functions export `handle(req, deps)`** and only wire `Deno.serve` at the bottom. Tests import `handle` and pass `makeFakeDeps(...)` from `supabase/functions/_shared/testing.ts`.
- **No changelog entry.** This is the super-admin platform console; per `CLAUDE.md` those changes have no customer-facing angle and must not appear in `public/changelog.md`.
- **Any automation change updates BOTH** `docs/system-map.md` and `src/data/systemMap.ts` in the same PR.
- Local verification commands: `npx vitest run`, `npm run lint`, `npx tsc -p tsconfig.app.json --noEmit`, `deno check --node-modules-dir=none <file>`, `deno test --allow-all --node-modules-dir=none supabase/functions/`.

---

## File Structure

**Create**
- `supabase/migrations/<applied-version>_health_daily.sql` — the `health_daily` table, RLS, and the `get_health_daily(p_days int)` RPC.
- `supabase/migrations/<applied-version>_health_rollup_cron.sql` — the pg_cron schedule that dispatches `health-rollup`.
- `supabase/functions/health-rollup/index.ts` — the rollup writer (Analytics API → `health_daily`).
- `supabase/functions/health-rollup/index.test.ts` — Deno tests for the rollup.
- `src/lib/uptime.ts` — pure derivation: day-cell states, uptime percentage, tooltip copy.
- `src/lib/uptime.test.ts`
- `src/components/platform/systemHealth/UptimeBar.tsx` — the Statuspage-style bar (cells, axis, uptime figure).
- `src/components/platform/systemHealth/UptimeBar.test.tsx`
- `src/components/platform/systemHealth/RecentRunsList.tsx` — keyboard-reachable per-run text list.
- `src/components/platform/systemHealth/RecentRunsList.test.tsx`

**Modify**
- `src/config/app.config.ts` — add `uptimeDays: 30`; remove `historyDays`.
- `src/data/platform.ts` — add `HealthDay` interface + `fetchHealthDaily`.
- `src/hooks/useSystemHealth.ts` — add `useHealthDaily`.
- `src/components/platform/systemHealth/primitives.tsx` — delete `RunTimeline` and `IncidentTimeline`; keep `StatusDot`/`StatusPill`/`LatencyStat` and `describeOutcome`'s consumers.
- `src/components/platform/systemHealth/ScheduledJobsPanel.tsx` — swap both strips for `UptimeBar` + `RecentRunsList`.
- `src/components/platform/systemHealth/EdgeFunctionsPanel.tsx` — same swap.
- `src/components/platform/SystemHealthTab.tsx` — fetch `useHealthDaily` once and pass down.
- `supabase/config.toml` — add `[functions.health-rollup]` with `verify_jwt = false`.
- `supabase/functions/cron-health-watcher/index.ts` — add `health-rollup` to `KNOWN_JOBS`.
- `src/lib/systemHealth.ts` — add `health-rollup` to `CRON_JOB_TO_FN`.
- `docs/system-map.md` and `src/data/systemMap.ts` — document the new cron.

**Delete**
- `IncidentTimeline` / `RunTimeline` and their tests (folded into the modify steps above; `dailyFailureBuckets` and `describeFailureDay` in `src/lib/systemHealth.ts` go with them).

---

### Task 1: `health_daily` table, RLS, and read RPC

**Files:**
- Create: `supabase/migrations/<applied-version>_health_daily.sql`
- Create: `supabase/tests/health_daily.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.health_daily(day date, fn text, runs int, failures int, rejected int, worst_status int, p95_ms int, updated_at timestamptz)` with PK `(day, fn)`; RPC `public.get_health_daily(p_days int)` returning `TABLE (day date, fn text, runs int, failures int, rejected int, worst_status int, p95_ms int)`, super-admin gated.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/health_daily.sql`:

```sql
BEGIN;
SELECT plan(6);

SELECT has_table('public', 'health_daily', 'health_daily exists');
SELECT col_is_pk('public', 'health_daily', ARRAY['day','fn'], 'PK is (day, fn)');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.health_daily'::regclass),
  'RLS is enabled on health_daily'
);
-- No write policy: the rollup writes with the service role, which bypasses RLS.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'health_daily' AND cmd <> 'SELECT'),
  0, 'health_daily has no INSERT/UPDATE/DELETE policy'
);
SELECT has_function('public', 'get_health_daily', ARRAY['integer'], 'get_health_daily(int) exists');
SELECT is(
  (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_health_daily'),
  true, 'get_health_daily is SECURITY DEFINER'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run it to verify it fails**

There is no local Postgres container in this environment. Run the file against the linked project inside a transaction that rolls back:

```bash
supabase db query --linked -f supabase/tests/health_daily.sql
```

Expected: FAIL — `relation "public.health_daily" does not exist`.

If `supabase db query` is unavailable, run the same file via the Supabase MCP `execute_sql`, wrapping it as `BEGIN; CREATE EXTENSION IF NOT EXISTS pgtap; <file body>; ROLLBACK;`.

- [ ] **Step 3: Write the migration**

Create the migration file with this body. Name the file `<version>_health_daily.sql` where `<version>` is filled in at Step 5 — apply first, then rename to the version the tool records.

```sql
-- Durable daily health rollup. The Supabase Analytics API retains 24 hours, so the System
-- Health console's 30-day uptime bar cannot be derived from it. health-rollup recomputes
-- today and yesterday from Analytics every 15 minutes and upserts here; recomputing (rather
-- than incrementing) keeps the writer idempotent, and covering yesterday closes the gap at
-- the midnight boundary.
--
-- Keyed by deployed function slug, not by cron job name: scheduled jobs ARE edge functions,
-- so one rollup feeds both panels and the two can never disagree.
CREATE TABLE public.health_daily (
  day          date        NOT NULL,
  fn           text        NOT NULL,
  runs         int         NOT NULL DEFAULT 0,
  failures     int         NOT NULL DEFAULT 0,  -- 5xx plus "no response at all"
  rejected     int         NOT NULL DEFAULT 0,  -- 4xx
  worst_status int,
  p95_ms       int,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, fn)
);
CREATE INDEX health_daily_day_idx ON public.health_daily (day DESC);

ALTER TABLE public.health_daily ENABLE ROW LEVEL SECURITY;

-- Read-only for super-admins. Writes come from the service-role rollup, which bypasses RLS —
-- deliberately NO write policy (mirrors cron_health_log; never add WITH CHECK (true) here).
CREATE POLICY "super-admin reads health_daily" ON public.health_daily
  FOR SELECT USING (is_super_admin(auth.uid()));

-- Dashboard feed. Bounded server-side so a client cannot ask for an unbounded scan.
CREATE OR REPLACE FUNCTION public.get_health_daily(p_days int)
RETURNS TABLE (
  day date, fn text, runs int, failures int, rejected int, worst_status int, p95_ms int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h.day, h.fn, h.runs, h.failures, h.rejected, h.worst_status, h.p95_ms
  FROM public.health_daily h
  WHERE is_super_admin(auth.uid())
    AND h.day > (CURRENT_DATE - LEAST(GREATEST(COALESCE(p_days, 30), 1), 90))
  ORDER BY h.fn, h.day;
$$;
REVOKE ALL ON FUNCTION public.get_health_daily(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_health_daily(int) TO authenticated;
```

- [ ] **Step 4: Apply the migration**

Apply via the Supabase MCP `apply_migration` with `name: "health_daily"` and the SQL body above (do NOT include the filename). The tool records a real-timestamp version.

- [ ] **Step 5: Rename the file to the recorded version**

Read the recorded version:

```bash
supabase db query --linked --query "select max(version) from supabase_migrations.schema_migrations"
```

Rename the local file to `supabase/migrations/<that-version>_health_daily.sql`. A mismatch here causes chronic version drift between the repo and `schema_migrations`.

- [ ] **Step 6: Run the pgTAP test to verify it passes**

```bash
supabase db query --linked -f supabase/tests/health_daily.sql
```

Expected: all 6 assertions `ok`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations supabase/tests/health_daily.sql
git commit -m "add health_daily rollup table and read rpc"
```

---

### Task 2: `health-rollup` edge function

**Files:**
- Create: `supabase/functions/health-rollup/index.ts`
- Create: `supabase/functions/health-rollup/index.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `public.health_daily` from Task 1; `preflight`/`json` from `../_shared/http.ts`; `requireCronOrRole` from `../_shared/auth.ts`; `realDeps`/`Deps` from `../_shared/deps.ts`; `makeFakeDeps` from `../_shared/testing.ts`.
- Produces: `export async function handle(req: Request, deps: Deps): Promise<Response>` returning `{ days: number, rows: number }` on success. Deployed slug: `health-rollup`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/health-rollup/index.test.ts`. Note the real harness: `makeFakeDeps` takes `envVars` / `now` / `fetchImpl` (not `env`/`fetch`), returns `{ deps, calls }`, and the cron secret is read via `deps.admin.rpc("get_cron_secret")`, so it is seeded through `rpcs`, not through the environment. Writes are asserted from the recorded `calls`, never by monkey-patching `deps.admin.from`.

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const SECRET = "s3cret";

/** The rollup makes two different GETs; route them by URL. */
function fakeFetch(slug: string, rows: unknown[]): typeof fetch {
  return ((url: string) =>
    Promise.resolve(
      String(url).includes("/functions")
        ? new Response(JSON.stringify([{ id: "id-1", slug }]), { status: 200 })
        : new Response(JSON.stringify({ result: rows }), { status: 200 }),
    )) as unknown as typeof fetch;
}

function depsFor(slug: string, rows: unknown[], fetchImpl?: typeof fetch) {
  return makeFakeDeps({
    rpcs: { get_cron_secret: { data: SECRET } },
    envVars: { ANALYTICS: "pat", SUPABASE_PROJECT_REF: "ref" },
    now: new Date("2026-08-04T12:00:00Z"),
    fetchImpl: fetchImpl ?? fakeFetch(slug, rows),
  });
}

const cronReq = () => makeRequest({ headers: { "X-Cron-Secret": SECRET }, body: {} });

/** The rows the handler upserted into health_daily, as recorded by the fake client. */
function upserted(calls: Array<{ table: string; method: string; args: unknown[] }>) {
  const call = calls.find((c) => c.table === "health_daily" && c.method === "upsert");
  return (call?.args[0] ?? []) as Record<string, unknown>[];
}

Deno.test("aggregates a day into runs, failures and worst status", async () => {
  const { deps, calls } = depsFor("airtable-poll", [
    { function_id: "id-1", status_code: 200, execution_time_ms: 900, timestamp: "2026-08-04T09:00:00Z" },
    { function_id: "id-1", status_code: 502, execution_time_ms: 4200, timestamp: "2026-08-04T09:24:00Z" },
  ]);

  const res = await handle(cronReq(), deps);
  assertEquals(res.status, 200);

  const row = upserted(calls).find((r) => r.day === "2026-08-04" && r.fn === "airtable-poll");
  assertEquals(row?.runs, 2);
  assertEquals(row?.failures, 1);
  assertEquals(row?.rejected, 0);
  assertEquals(row?.worst_status, 502);
});

Deno.test("counts a 4xx as rejected, not as a failure", async () => {
  const { deps, calls } = depsFor("expire-offers", [
    { function_id: "id-1", status_code: 401, execution_time_ms: 100, timestamp: "2026-08-04T09:00:00Z" },
  ]);

  await handle(cronReq(), deps);

  const row = upserted(calls).find((r) => r.fn === "expire-offers");
  assertEquals(row?.failures, 0);
  assertEquals(row?.rejected, 1);
});

Deno.test("a run with no status code at all counts as a failure", async () => {
  const { deps, calls } = depsFor("airtable-poll", [
    { function_id: "id-1", execution_time_ms: 0, timestamp: "2026-08-04T09:00:00Z" },
  ]);

  await handle(cronReq(), deps);

  assertEquals(upserted(calls).find((r) => r.fn === "airtable-poll")?.failures, 1);
});

Deno.test("splits rows across today and yesterday", async () => {
  const { deps, calls } = depsFor("airtable-poll", [
    { function_id: "id-1", status_code: 200, execution_time_ms: 900, timestamp: "2026-08-04T09:00:00Z" },
    { function_id: "id-1", status_code: 500, execution_time_ms: 900, timestamp: "2026-08-03T22:00:00Z" },
  ]);

  await handle(cronReq(), deps);

  const rows = upserted(calls);
  assertEquals(rows.find((r) => r.day === "2026-08-04")?.failures, 0);
  assertEquals(rows.find((r) => r.day === "2026-08-03")?.failures, 1);
});

Deno.test("rejects a caller without the cron secret", async () => {
  const { deps } = depsFor("airtable-poll", []);
  const res = await handle(makeRequest({ body: {} }), deps);
  assertEquals(res.status === 401 || res.status === 403, true);
});

Deno.test("returns 502 without writing when Analytics is unavailable", async () => {
  const failing = (() => Promise.resolve(new Response("nope", { status: 500 }))) as unknown as typeof fetch;
  const { deps, calls } = depsFor("airtable-poll", [], failing);

  const res = await handle(cronReq(), deps);

  assertEquals(res.status, 502);
  // A partial rollup written over a real day would turn a metrics outage into a permanent hole.
  assertEquals(calls.some((c) => c.table === "health_daily" && c.method === "upsert"), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
deno test --allow-all --node-modules-dir=none supabase/functions/health-rollup/
```

Expected: FAIL — module `./index.ts` not found.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/health-rollup/index.ts`:

```ts
import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

/**
 * Daily health rollup. Every 15 min: read per-invocation outcomes from the Supabase Analytics
 * API and upsert one health_daily row per (day, function slug).
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

/** UTC calendar day. The bar is an operational record, not a local-time one: the rollup writes
 *  from a server with no user timezone, so UTC is the only stable key. */
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

function aggregate(rows: RawRow[], idToSlug: Map<string, string>, days: Set<string>): DailyRow[] {
  const buckets = new Map<string, RawRow[]>();
  for (const r of rows) {
    if (!r.timestamp) continue;
    const at = new Date(r.timestamp);
    if (Number.isNaN(at.getTime())) continue;
    const day = dayKey(at);
    if (!days.has(day)) continue;
    const fn = (r.function_id && idToSlug.get(r.function_id)) || r.function_id || "unattributed";
    const key = `${day} ${fn}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(r); else buckets.set(key, [r]);
  }
  return [...buckets.entries()].map(([key, rs]) => {
    const [day, fn] = key.split(" ");
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
deno test --allow-all --node-modules-dir=none supabase/functions/health-rollup/
deno check --node-modules-dir=none supabase/functions/health-rollup/index.ts
```

Expected: 5 passed, check clean.

- [ ] **Step 5: Register the function in `config.toml`**

In `supabase/config.toml`, insert alphabetically near the other `[functions.*]` blocks:

```toml
[functions.health-rollup]
verify_jwt = false
```

`verify_jwt = false` is required: pg_cron calls this with `X-Cron-Secret`, not a JWT. The function self-authorizes via `requireCronOrRole(deps, req, [])`. An unlisted function deploys with JWT verification forced on and every cron dispatch would 401.

- [ ] **Step 6: Run the whole edge suite**

```bash
deno test --allow-all --node-modules-dir=none supabase/functions/
```

Expected: all pass. Run the whole directory, not just this function — a shared-module change can regress sibling suites.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/health-rollup supabase/config.toml
git commit -m "add health-rollup edge function"
```

---

### Task 3: Schedule the rollup and put it under health monitoring

**Files:**
- Create: `supabase/migrations/<applied-version>_health_rollup_cron.sql`
- Modify: `supabase/functions/cron-health-watcher/index.ts:36-44`
- Modify: `src/lib/systemHealth.ts` (the `CRON_JOB_TO_FN` map)
- Modify: `docs/system-map.md`, `src/data/systemMap.ts`
- Test: `src/lib/systemHealth.test.ts`

**Interfaces:**
- Consumes: `health-rollup` (Task 2), `public.cron_health_dispatch`.
- Produces: pg_cron job named `health-rollup`; `CRON_JOB_TO_FN["health-rollup"] === "health-rollup"`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/systemHealth.test.ts`, inside the existing `describe("CRON_JOB_TO_FN", ...)` block:

```ts
  it("maps the health rollup job to its function slug", () => {
    expect(CRON_JOB_TO_FN["health-rollup"]).toBe("health-rollup");
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/lib/systemHealth.test.ts
```

Expected: FAIL — received `undefined`.

- [ ] **Step 3: Add the mapping and the watcher entry**

In `src/lib/systemHealth.ts`, add to `CRON_JOB_TO_FN`:

```ts
  "health-rollup": "health-rollup",
```

In `supabase/functions/cron-health-watcher/index.ts`, add to `KNOWN_JOBS`:

```ts
  "health-rollup": 60, // */15 job; same max-silence as its sibling watchers.
```

Without this the rollup would be the one unmonitored cron: it could stop writing and the uptime bar would quietly flatline with nobody alerted.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/lib/systemHealth.test.ts
deno test --allow-all --node-modules-dir=none supabase/functions/cron-health-watcher/
```

Expected: PASS.

- [ ] **Step 5: Write the cron migration**

Follow the dispatch idiom in `20260728131500_cron_stagger_and_timeout.sql` exactly: 90s timeout, cron secret from `private.cron_secret()`, and a `cron_health_dispatch` row so the watcher can see it. Minute 7 keeps it off the shared `:00`/`:02`/`:03`/`:04`/`:05` slots and out of the cold-boot pile-up that caused false timeouts.

```sql
-- Dispatch health-rollup every 15 minutes. Minute 7 is unused by the existing jobs
-- (expire-offers :00, airtable-poll :02, offer-digest :03, confirmation-digest :04,
-- tier-at-risk :05, cron-health-watcher :09, email-health-watcher :56) — simultaneous
-- cold boots serialize in the edge runtime and cross pg_net's timeout, which is what
-- produced false "failing" alerts before the stagger.
DO $$ BEGIN
  PERFORM cron.unschedule('health-rollup') FROM cron.job WHERE jobname = 'health-rollup';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('health-rollup','7-59/15 * * * *', $$
  WITH r AS (SELECT net.http_post(
    url:='https://epweartpzwvcasrzyueh.supabase.co/functions/v1/health-rollup',
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()),
    body:='{}'::jsonb, timeout_milliseconds:=90000) AS request_id)
  INSERT INTO public.cron_health_dispatch (job_name, request_id) SELECT 'health-rollup', request_id FROM r;
$$);
```

- [ ] **Step 6: Deploy the function, then apply the migration**

Order matters: the cron must not dispatch to a function that does not exist yet (a missing function returns a CORS-less 404 and the watcher would alert).

Deploy `health-rollup` via the Supabase MCP `deploy_edge_function`, then apply the migration with `apply_migration`, `name: "health_rollup_cron"`. Rename the local file to the recorded version exactly as in Task 1 Step 5.

- [ ] **Step 7: Verify the job is scheduled and dispatching**

```bash
supabase db query --linked --query "select jobname, schedule, active from cron.job where jobname = 'health-rollup'"
```

Wait for one tick (up to 15 min), then confirm rows are landing:

```bash
supabase db query --linked --query "select day, fn, runs, failures from public.health_daily order by day desc, fn limit 20"
```

Expected: at least one row per active function for today. If empty, read the function logs — the most likely causes are a missing `ANALYTICS` secret or `verify_jwt` still on.

- [ ] **Step 8: Update the system map (both copies)**

`docs/system-map.md` and `src/data/systemMap.ts` are twins and `CLAUDE.md` requires both to change in the same PR as any automation change. Add a trigger node to `src/data/systemMap.ts` alongside the existing `c_cronhealth` entry:

```ts
  {
    id: "c_healthrollup",
    column: "trigger",
    kind: "cron",
    label: "health-rollup clock",
    sub: "7-59/15 * * * * — every 15 min",
    subsystems: ["platform"],
    detail: {
      Fires: "health-rollup",
      Note: "recomputes today and yesterday from the Analytics API into health_daily; feeds the 30-day uptime bar",
      Cite: "<version>_health_rollup_cron.sql",
    },
  },
```

Add the matching trigger → function → data → effect row to `docs/system-map.md` in the same style as the surrounding entries.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations src/lib/systemHealth.ts src/lib/systemHealth.test.ts \
        supabase/functions/cron-health-watcher/index.ts docs/system-map.md src/data/systemMap.ts
git commit -m "schedule health-rollup and put it under cron health monitoring"
```

---

### Task 4: Uptime derivation (pure)

**Files:**
- Create: `src/lib/uptime.ts`
- Create: `src/lib/uptime.test.ts`
- Modify: `src/config/app.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface HealthDay { day: string; fn: string; runs: number; failures: number; rejected: number; worst_status: number | null; p95_ms: number | null }`
  - `export type DayState = "operational" | "degraded" | "down" | "nodata"`
  - `export interface UptimeCell { day: string; state: DayState; runs: number; failures: number; rejected: number; worstStatus: number | null }`
  - `export function buildUptimeCells(rows: HealthDay[], days: number, now: Date): UptimeCell[]`
  - `export function uptimePercent(cells: UptimeCell[]): number | null`
  - `export function describeUptimeDay(cell: UptimeCell): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/uptime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildUptimeCells, uptimePercent, describeUptimeDay, type HealthDay } from "@/lib/uptime";

// Pinned to a UTC instant, not a local one: the cells are keyed by UTC day, so a local
// construction would shift the expected keys on a developer machine outside UTC.
const now = new Date("2026-08-04T12:00:00Z");
const row = (over: Partial<HealthDay> = {}): HealthDay => ({
  day: "2026-08-04", fn: "airtable-poll", runs: 100, failures: 0, rejected: 0,
  worst_status: 200, p95_ms: 900, ...over,
});

describe("buildUptimeCells", () => {
  it("returns one cell per day, oldest first, ending today", () => {
    const cells = buildUptimeCells([], 30, now);
    expect(cells).toHaveLength(30);
    expect(cells[29].day).toBe("2026-08-04");
    expect(cells[0].day).toBe("2026-07-06");
  });

  it("marks days with no recorded rollup as nodata, not as healthy", () => {
    // The bar ships before any history exists; a blank day must never read as green.
    expect(buildUptimeCells([], 30, now).every((c) => c.state === "nodata")).toBe(true);
  });

  it("is operational when a day recorded runs and no faults", () => {
    const cells = buildUptimeCells([row()], 30, now);
    expect(cells[29].state).toBe("operational");
  });

  it("is down when every run that day failed", () => {
    const cells = buildUptimeCells([row({ runs: 12, failures: 12, worst_status: 502 })], 30, now);
    expect(cells[29].state).toBe("down");
  });

  it("is degraded when some but not all runs failed", () => {
    const cells = buildUptimeCells([row({ runs: 100, failures: 3 })], 30, now);
    expect(cells[29].state).toBe("degraded");
  });

  it("is degraded when runs were rejected with 4xx", () => {
    const cells = buildUptimeCells([row({ runs: 100, rejected: 40 })], 30, now);
    expect(cells[29].state).toBe("degraded");
  });

  it("treats a day the function was idle as nodata, not as an outage", () => {
    // Zero invocations means nobody called it, which is not the same as it being broken.
    const cells = buildUptimeCells([row({ runs: 0, failures: 0, worst_status: null })], 30, now);
    expect(cells[29].state).toBe("nodata");
  });

  it("ignores rollup rows outside the window", () => {
    const cells = buildUptimeCells([row({ day: "2026-06-01", failures: 5 })], 30, now);
    expect(cells.every((c) => c.state === "nodata")).toBe(true);
  });
});

describe("uptimePercent", () => {
  it("is null when no day has any recorded run", () => {
    expect(uptimePercent(buildUptimeCells([], 30, now))).toBeNull();
  });

  it("counts only days with data, so a fresh install is not penalised", () => {
    const cells = buildUptimeCells([row({ runs: 100, failures: 1 })], 30, now);
    expect(uptimePercent(cells)).toBeCloseTo(99, 5);
  });

  it("is 100 when every recorded run succeeded", () => {
    expect(uptimePercent(buildUptimeCells([row()], 30, now))).toBe(100);
  });

  it("does not count 4xx rejections against uptime", () => {
    // A rejected caller is a caller problem, not the function being unavailable.
    const cells = buildUptimeCells([row({ runs: 100, rejected: 50, failures: 0 })], 30, now);
    expect(uptimePercent(cells)).toBe(100);
  });
});

describe("describeUptimeDay", () => {
  it("says so for a day with no data", () => {
    expect(describeUptimeDay({
      day: "2026-08-04", state: "nodata", runs: 0, failures: 0, rejected: 0, worstStatus: null,
    })).toContain("no data recorded");
  });

  it("reports runs and failures with the worst status code", () => {
    const text = describeUptimeDay({
      day: "2026-08-04", state: "degraded", runs: 288, failures: 1, rejected: 0, worstStatus: 502,
    });
    expect(text).toContain("288 runs");
    expect(text).toContain("1 failure");
    expect(text).toContain("HTTP 502");
  });

  it("pluralises failures and mentions rejections", () => {
    const text = describeUptimeDay({
      day: "2026-08-04", state: "degraded", runs: 10, failures: 2, rejected: 3, worstStatus: 500,
    });
    expect(text).toContain("2 failures");
    expect(text).toContain("3 rejected");
  });

  it("says all runs succeeded on a clean day", () => {
    const text = describeUptimeDay({
      day: "2026-08-04", state: "operational", runs: 288, failures: 0, rejected: 0, worstStatus: 200,
    });
    expect(text).toContain("288 runs");
    expect(text).toContain("no failures");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/lib/uptime.test.ts
```

Expected: FAIL — cannot resolve `@/lib/uptime`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/uptime.ts`:

```ts
/** One health_daily row as returned by get_health_daily. Mirrors the table's columns. */
export interface HealthDay {
  day: string;              // 'YYYY-MM-DD' (UTC calendar day, as written by health-rollup)
  fn: string;
  runs: number;
  failures: number;         // 5xx plus "no response at all"
  rejected: number;         // 4xx
  worst_status: number | null;
  p95_ms: number | null;
}

export type DayState = "operational" | "degraded" | "down" | "nodata";

export interface UptimeCell {
  day: string;
  state: DayState;
  runs: number;
  failures: number;
  rejected: number;
  worstStatus: number | null;
}

/** 4xx fraction above which a day reads degraded. Mirrors SYSTEM_HEALTH.rejectRateBudget:
 *  an occasional validation 400 is normal traffic, a sustained rejection rate is a broken caller. */
const REJECT_RATE_BUDGET = 0.2;

const EMPTY = (day: string): UptimeCell =>
  ({ day, state: "nodata", runs: 0, failures: 0, rejected: 0, worstStatus: null });

/** UTC day key. health-rollup writes UTC days (it runs on a server with no user timezone),
 *  so the bar must bucket in UTC too or the lookup silently misses near midnight. */
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

function classify(row: HealthDay): DayState {
  // Zero runs is idle, not broken. Most on-demand functions go days without a call, and painting
  // those red would make the bar useless.
  if (row.runs === 0) return "nodata";
  if (row.failures >= row.runs) return "down";
  if (row.failures > 0) return "degraded";
  if (row.rejected / row.runs > REJECT_RATE_BUDGET) return "degraded";
  return "operational";
}

/**
 * Build the fixed-width cell series for one function, oldest first, ending on `now`'s day.
 * Days with no rollup row come back as "nodata" — the bar ships before any history exists,
 * and an unrecorded day must never render as a green claim about uptime.
 */
export function buildUptimeCells(rows: HealthDay[], days: number, now: Date): UptimeCell[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: UptimeCell[] = [];
  for (let back = days - 1; back >= 0; back--) {
    // Date.UTC day overflow: correct across month boundaries, and immune to DST because
    // UTC has none — which is the other reason the keys are UTC rather than local.
    const key = dayKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back)));
    const row = byDay.get(key);
    out.push(row
      ? {
        day: key,
        state: classify(row),
        runs: row.runs,
        failures: row.failures,
        rejected: row.rejected,
        worstStatus: row.worst_status,
      }
      : EMPTY(key));
  }
  return out;
}

/**
 * Successful-run percentage across the days that have data. Days with no rollup are excluded
 * rather than counted as 0% or 100%: on a fresh install almost every day is blank, and either
 * choice would print a confident number about a period nothing was recorded for.
 * Returns null when no day has a single run.
 */
export function uptimePercent(cells: UptimeCell[]): number | null {
  let runs = 0;
  let failures = 0;
  for (const c of cells) { runs += c.runs; failures += c.failures; }
  if (runs === 0) return null;
  return ((runs - failures) / runs) * 100;
}

/** Tooltip line for one day cell. */
export function describeUptimeDay(cell: UptimeCell): string {
  // Parsed as local midnight, not `new Date('YYYY-MM-DD')` (which parses as UTC and can render
  // the previous day for viewers west of Greenwich).
  const [y, m, d] = cell.day.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short",
  });
  if (cell.state === "nodata" && cell.runs === 0) return `${label} · no data recorded`;

  const parts = [label, `${cell.runs} runs`];
  parts.push(cell.failures === 0
    ? "no failures"
    : `${cell.failures} ${cell.failures === 1 ? "failure" : "failures"}`);
  if (cell.rejected > 0) parts.push(`${cell.rejected} rejected`);
  if (cell.worstStatus !== null && cell.failures + cell.rejected > 0) parts.push(`HTTP ${cell.worstStatus}`);
  return parts.join(" · ");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/lib/uptime.test.ts
```

Expected: all pass.

- [ ] **Step 5: Add the window constant**

In `src/config/app.config.ts`, inside `SYSTEM_HEALTH`, replace the `historyDays` entry with:

```ts
  /** Days shown by the uptime bar. Cells fill in one per day from the health-rollup deploy;
   *  anything earlier renders as "no data" because the Analytics API retains only 24h and
   *  there is nothing to backfill from. */
  uptimeDays: 30,
```

Leave `logRetentionDays: 30` in place — `cron_health_log` still backs the failure list.

- [ ] **Step 6: Commit**

```bash
git add src/lib/uptime.ts src/lib/uptime.test.ts src/config/app.config.ts
git commit -m "add pure uptime-bar derivation"
```

---

### Task 5: Data access and hook

**Files:**
- Modify: `src/data/platform.ts`
- Modify: `src/hooks/useSystemHealth.ts`
- Test: `src/data/platform.uptime.test.ts` (create)

**Interfaces:**
- Consumes: `get_health_daily` (Task 1), `HealthDay` (Task 4).
- Produces:
  - `export async function fetchHealthDaily(client: SupabaseClient<Database>, days?: number): Promise<HealthDay[]>`
  - `export function useHealthDaily(): UseQueryResult<HealthDay[]>` with query key `["platform", "health-daily", days]`.

- [ ] **Step 1: Write the failing test**

Create `src/data/platform.uptime.test.ts`. The harness is `createFakeSupabase` (not a `makeSupabaseFake`): RPCs are seeded under an `"rpc:<name>"` key, calls are recorded on `fake.calls` as `{ table, method, args }`, and the fake is passed with `as never`.

```ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchHealthDaily } from "./platform";

const row = {
  day: "2026-08-04", fn: "airtable-poll", runs: 288,
  failures: 1, rejected: 0, worst_status: 502, p95_ms: 4200,
};

describe("fetchHealthDaily", () => {
  it("calls get_health_daily with the requested window and maps the rows", async () => {
    const fake = createFakeSupabase({ "rpc:get_health_daily": { data: [row], error: null } });

    const rows = await fetchHealthDaily(fake as never, 30);

    expect(fake.calls).toContainEqual({
      table: "rpc:get_health_daily", method: "rpc", args: [{ p_days: 30 }],
    });
    expect(rows).toEqual([row]);
  });

  it("returns an empty list when nothing has been rolled up yet", async () => {
    const fake = createFakeSupabase({ "rpc:get_health_daily": { data: null, error: null } });
    expect(await fetchHealthDaily(fake as never, 30)).toEqual([]);
  });

  it("defaults a null worst_status and p95 rather than coercing them to 0", async () => {
    // An idle day has no status code at all; 0 would render as a real HTTP code in the tooltip.
    const fake = createFakeSupabase({
      "rpc:get_health_daily": {
        data: [{ ...row, worst_status: null, p95_ms: null }], error: null,
      },
    });
    const [mapped] = await fetchHealthDaily(fake as never, 30);
    expect(mapped.worst_status).toBeNull();
    expect(mapped.p95_ms).toBeNull();
  });

  it("throws when the rpc errors so the panel can surface it", async () => {
    const fake = createFakeSupabase({
      "rpc:get_health_daily": { data: null, error: new Error("denied") },
    });
    await expect(fetchHealthDaily(fake as never, 30)).rejects.toThrow("denied");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/data/platform.uptime.test.ts
```

Expected: FAIL — `fetchHealthDaily` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/data/platform.ts`, add near `fetchCronHealth`:

```ts
/** Daily health rollup for the System Health uptime bar (super-admin only, enforced in the RPC).
 *  Returns one row per (day, function) for days that actually recorded traffic — days with no
 *  row are absent, and the bar renders them as "no data". */
export async function fetchHealthDaily(
  client: SupabaseClient<Database>,
  days: number = SYSTEM_HEALTH.uptimeDays,
): Promise<HealthDay[]> {
  // get_health_daily post-dates the generated Database type, so the name and result are cast
  // once here at the query boundary — same pattern as fetchCronHealth above.
  const { data, error } = await client.rpc("get_health_daily" as never, { p_days: days } as never);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    day: String(row.day ?? ""),
    fn: String(row.fn ?? ""),
    runs: Number(row.runs ?? 0),
    failures: Number(row.failures ?? 0),
    rejected: Number(row.rejected ?? 0),
    worst_status: typeof row.worst_status === "number" ? row.worst_status : null,
    p95_ms: typeof row.p95_ms === "number" ? row.p95_ms : null,
  }));
}
```

Add `import type { HealthDay } from "@/lib/uptime";` to the imports, and add `SYSTEM_HEALTH` to the existing `@/config/app.config` import.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/data/platform.uptime.test.ts
```

Expected: all pass.

- [ ] **Step 5: Add the hook**

In `src/hooks/useSystemHealth.ts`:

```ts
/** Daily rollup behind the uptime bar. Cheap (a single indexed RPC over ~30 days x ~26
 *  functions), so unlike the Analytics-backed queries it has no rate-limit concerns. */
export function useHealthDaily() {
  return useQuery({
    queryKey: ["platform", "health-daily", SYSTEM_HEALTH.uptimeDays],
    queryFn: () => fetchHealthDaily(supabase, SYSTEM_HEALTH.uptimeDays),
    refetchInterval: SYSTEM_HEALTH.refetchMs,
    // Supplementary like the other panels: a rollup outage must not blank the tab.
    retry: 1,
  });
}
```

Add `fetchHealthDaily` to the existing `@/data/platform` import.

- [ ] **Step 6: Verify types and lint**

```bash
npx tsc -p tsconfig.app.json --noEmit
npm run lint
```

Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/data/platform.ts src/data/platform.uptime.test.ts src/hooks/useSystemHealth.ts
git commit -m "add health_daily data access and hook"
```

---

### Task 6: The `UptimeBar` component

**Files:**
- Create: `src/components/platform/systemHealth/UptimeBar.tsx`
- Create: `src/components/platform/systemHealth/UptimeBar.test.tsx`

**Interfaces:**
- Consumes: `buildUptimeCells`, `uptimePercent`, `describeUptimeDay`, `HealthDay` (Task 4); `Tooltip`/`TooltipContent`/`TooltipProvider`/`TooltipTrigger` from `@/components/ui/tooltip`; `cn` from `@/lib/utils`.
- Produces: `export function UptimeBar({ rows, days, now }: { rows: HealthDay[]; days: number; now?: Date }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `src/components/platform/systemHealth/UptimeBar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UptimeBar } from "./UptimeBar";
import type { HealthDay } from "@/lib/uptime";

const now = new Date("2026-08-04T12:00:00Z");
const row = (over: Partial<HealthDay> = {}): HealthDay => ({
  day: "2026-08-04", fn: "airtable-poll", runs: 288, failures: 0, rejected: 0,
  worst_status: 200, p95_ms: 900, ...over,
});

describe("UptimeBar", () => {
  it("renders one cell per day in the window", () => {
    const { container } = render(<UptimeBar rows={[]} days={30} now={now} />);
    expect(container.querySelectorAll("[data-uptime-day]")).toHaveLength(30);
  });

  it("labels the axis so the direction of time is unambiguous", () => {
    render(<UptimeBar rows={[]} days={30} now={now} />);
    expect(screen.getByText("30 days ago")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("shows the uptime percentage when there is data", () => {
    render(<UptimeBar rows={[row({ runs: 100, failures: 1 })]} days={30} now={now} />);
    expect(screen.getByText(/99\.0% uptime/)).toBeInTheDocument();
  });

  it("says no data instead of printing a fake 100% before any rollup exists", () => {
    render(<UptimeBar rows={[]} days={30} now={now} />);
    expect(screen.getByText("no data yet")).toBeInTheDocument();
    expect(screen.queryByText(/uptime/)).not.toBeInTheDocument();
  });

  it("colours a fully failed day as down and an unrecorded day as muted", () => {
    const { container } = render(
      <UptimeBar rows={[row({ runs: 12, failures: 12, worst_status: 502 })]} days={30} now={now} />,
    );
    const cells = container.querySelectorAll("[data-uptime-day]");
    expect(cells[29].className).toContain("bg-destructive");
    expect(cells[0].className).toContain("bg-muted");
  });

  it("reveals that day's detail on hover", async () => {
    const { container } = render(
      <UptimeBar rows={[row({ runs: 288, failures: 1, worst_status: 502 })]} days={30} now={now} />,
    );
    const cells = container.querySelectorAll("[data-uptime-day]");
    // Radix opens a tooltip from pointermove on the trigger, not mouseover.
    fireEvent.pointerMove(cells[29] as HTMLElement, { pointerType: "mouse" });
    // Radix renders the visible bubble plus a visually-hidden copy, hence findAllByText.
    expect(await screen.findAllByText(/288 runs · 1 failure · HTTP 502/)).not.toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/components/platform/systemHealth/UptimeBar.test.tsx
```

Expected: FAIL — cannot resolve `./UptimeBar`.

- [ ] **Step 3: Write the implementation**

Create `src/components/platform/systemHealth/UptimeBar.tsx`:

```tsx
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { buildUptimeCells, describeUptimeDay, uptimePercent, type DayState, type HealthDay } from "@/lib/uptime";

const TONE: Record<DayState, string> = {
  operational: "bg-success",
  degraded: "bg-warning",
  down: "bg-destructive",
  // Muted, not green: an unrecorded day is an absence of evidence, not evidence of health.
  nodata: "bg-muted",
};

/**
 * Statuspage-style uptime bar: one cell per day, oldest on the left, with the window's
 * successful-run percentage on the right. Cells flex to fill the row so the bar reads as one
 * continuous object at any panel width.
 *
 * Fed by health_daily (durable) rather than the Analytics API (24h), which is the only reason
 * it can show anything older than yesterday.
 */
export function UptimeBar({ rows, days, now = new Date() }: {
  rows: HealthDay[]; days: number; now?: Date;
}) {
  const cells = buildUptimeCells(rows, days, now);
  const pct = uptimePercent(cells);

  return (
    <div className="space-y-1">
      <TooltipProvider delayDuration={80}>
        {/* aria-hidden: the cells are a visual index. The keyboard-reachable equivalents are the
            uptime figure below and the Recent runs / Failure history lists in the row. */}
        <div className="flex items-stretch gap-[2px]" aria-hidden>
          {cells.map((c) => (
            <Tooltip key={c.day}>
              <TooltipTrigger asChild>
                <span
                  data-uptime-day
                  data-state={c.state}
                  className={cn("h-6 min-w-[3px] flex-1 rounded-sm cursor-default", TONE[c.state])}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="px-2 py-1 text-xs">
                {describeUptimeDay(c)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{days} days ago</span>
        <span className="tabular-nums">
          {pct === null ? "no data yet" : `${pct.toFixed(1)}% uptime`}
        </span>
        <span>Today</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/components/platform/systemHealth/UptimeBar.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/platform/systemHealth/UptimeBar.tsx src/components/platform/systemHealth/UptimeBar.test.tsx
git commit -m "add statuspage-style uptime bar component"
```

---

### Task 7: `RecentRunsList` — per-run detail as text

**Files:**
- Create: `src/components/platform/systemHealth/RecentRunsList.tsx`
- Create: `src/components/platform/systemHealth/RecentRunsList.test.tsx`

**Interfaces:**
- Consumes: `describeOutcome` and `EdgeFnOutcome` from `@/lib/systemHealth`.
- Produces: `export function RecentRunsList({ recent }: { recent: EdgeFnOutcome[] }): JSX.Element | null`.

This replaces the per-run detail that the deleted 20-tick timeline carried in hover tooltips. As a `<details>` list it is reachable by keyboard and readable by a screen reader, which the hairline ticks never were, and it is faster to scan with a mouse than hovering twenty marks one at a time.

- [ ] **Step 1: Write the failing test**

Create `src/components/platform/systemHealth/RecentRunsList.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RecentRunsList } from "./RecentRunsList";

describe("RecentRunsList", () => {
  it("renders nothing when there are no recent runs", () => {
    const { container } = render(<RecentRunsList recent={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("summarises the count while collapsed and lists each run when opened", () => {
    render(<RecentRunsList recent={[
      { status: 200, ms: 900, at: "2026-08-04T09:00:00Z" },
      { status: 502, ms: 4200, at: "2026-08-04T09:24:06Z" },
    ]} />);

    const summary = screen.getByText(/Recent runs \(2\)/);
    expect(summary).toBeInTheDocument();
    fireEvent.click(summary);
    expect(screen.getByText(/HTTP 502 · 4\.2s/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 200 · 0\.9s/)).toBeInTheDocument();
  });

  it("flags the failing runs so they can be picked out of the list", () => {
    render(<RecentRunsList recent={[{ status: 502, ms: 4200 }]} />);
    fireEvent.click(screen.getByText(/Recent runs \(1\)/));
    expect(screen.getByText(/HTTP 502/).className).toContain("text-destructive");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/components/platform/systemHealth/RecentRunsList.test.tsx
```

Expected: FAIL — cannot resolve `./RecentRunsList`.

- [ ] **Step 3: Write the implementation**

Create `src/components/platform/systemHealth/RecentRunsList.tsx`:

```tsx
import { describeOutcome, type EdgeFnOutcome } from "@/lib/systemHealth";

/**
 * The last runs as text, newest first. This is the keyboard- and screen-reader-reachable
 * equivalent of the per-invocation detail the uptime bar cannot carry: the bar answers
 * "which day", this answers "which run, what code, how slow".
 */
export function RecentRunsList({ recent }: { recent: EdgeFnOutcome[] }) {
  if (recent.length === 0) return null;
  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-foreground">
        Recent runs ({recent.length})
      </summary>
      <div className="mt-2 space-y-1 rounded-md bg-muted/40 p-2">
        {recent.map((o, i) => (
          <p
            key={i}
            className={o.status <= 0 || o.status >= 400 ? "font-mono text-destructive" : "font-mono"}
          >
            {describeOutcome(o)}
          </p>
        ))}
      </div>
    </details>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/components/platform/systemHealth/RecentRunsList.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/platform/systemHealth/RecentRunsList.tsx src/components/platform/systemHealth/RecentRunsList.test.tsx
git commit -m "add recent-runs text list"
```

---

### Task 8: Swap both panels over and delete the old strips

**Files:**
- Modify: `src/components/platform/systemHealth/ScheduledJobsPanel.tsx`
- Modify: `src/components/platform/systemHealth/EdgeFunctionsPanel.tsx`
- Modify: `src/components/platform/SystemHealthTab.tsx`
- Modify: `src/components/platform/systemHealth/primitives.tsx` (delete `RunTimeline`, `IncidentTimeline`)
- Modify: `src/lib/systemHealth.ts` (delete `dailyFailureBuckets`, `describeFailureDay`, `FailureDay`, `FailureRecord`)
- Modify: `src/components/platform/systemHealth/primitives.test.tsx`, `src/lib/systemHealth.test.ts`, `src/components/platform/systemHealth/ScheduledJobsPanel.test.tsx`, `src/components/platform/systemHealth/EdgeFunctionsPanel.test.tsx`

**Interfaces:**
- Consumes: `UptimeBar` (Task 6), `RecentRunsList` (Task 7), `useHealthDaily` (Task 5), `SYSTEM_HEALTH.uptimeDays` (Task 4).
- Produces: `ScheduledJobsPanel({ cronRows, metrics, healthDaily })` and `EdgeFunctionsPanel({ metrics, healthDaily })`, both taking `healthDaily: HealthDay[]`.

- [ ] **Step 1: Write the failing tests**

In `src/components/platform/systemHealth/ScheduledJobsPanel.test.tsx`, replace the incident-timeline test added earlier with:

```tsx
  it("draws an uptime bar for the job from its function's rollup", () => {
    const { container } = render(
      <ScheduledJobsPanel
        cronRows={[cron]}
        metrics={[metric]}
        healthDaily={[{
          // cron.job_name is 'cron-health-watcher', whose slug is the same; a job whose
          // name and slug differ (offer-digest -> send-offer-digest) must map via CRON_JOB_TO_FN.
          day: new Date().toISOString().slice(0, 10), fn: "cron-health-watcher",
          runs: 96, failures: 0, rejected: 0, worst_status: 200, p95_ms: 4000,
        }]}
      />,
    );
    expect(container.querySelectorAll("[data-uptime-day]")).toHaveLength(30);
    expect(screen.getByText(/100\.0% uptime/)).toBeInTheDocument();
  });

  it("maps a job whose name differs from its function slug", () => {
    const digest = { ...cron, job_name: "offer-digest" } as CronHealthRow;
    render(
      <ScheduledJobsPanel
        cronRows={[digest]}
        metrics={[]}
        healthDaily={[{
          day: new Date().toISOString().slice(0, 10), fn: "send-offer-digest",
          runs: 4, failures: 1, rejected: 0, worst_status: 500, p95_ms: 1000,
        }]}
      />,
    );
    expect(screen.getByText(/75\.0% uptime/)).toBeInTheDocument();
  });
```

In `src/components/platform/systemHealth/EdgeFunctionsPanel.test.tsx`, add:

```tsx
  it("draws an uptime bar per on-demand function", () => {
    const { container } = render(
      <EdgeFunctionsPanel
        metrics={[{
          fn: "create-invitation", invocations: 4, errors: 0, rejected: 0, byStatus: {},
          p50Ms: 500, p95Ms: 800, lastInvokedAt: null, lastStatus: 200, lastFailure: null, recent: [],
        }]}
        healthDaily={[{
          day: new Date().toISOString().slice(0, 10), fn: "create-invitation",
          runs: 4, failures: 0, rejected: 0, worst_status: 200, p95_ms: 800,
        }]}
      />,
    );
    expect(container.querySelectorAll("[data-uptime-day]")).toHaveLength(30);
  });
```

Delete the `RunTimeline` describe block from `primitives.test.tsx` and the `dailyFailureBuckets` / `describeFailureDay` describe blocks from `systemHealth.test.ts` — the code they cover is being removed, and a test kept alive for deleted behavior is worse than no test.

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run src/components/platform/systemHealth/
```

Expected: FAIL — `healthDaily` is not a prop; no `[data-uptime-day]` nodes.

- [ ] **Step 3: Rewrite `ScheduledJobsPanel`**

Replace the two timeline blocks with the bar and the runs list. The row keeps its status dot, name, pill, latency and schedule line.

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, StatusDot, LatencyStat } from "./primitives";
import { UptimeBar } from "./UptimeBar";
import { RecentRunsList } from "./RecentRunsList";
import { describeJobHealth, deriveJobStatus, CRON_JOB_TO_FN, type EdgeFnMetric } from "@/lib/systemHealth";
import type { HealthDay } from "@/lib/uptime";
import { SYSTEM_HEALTH_BUDGET as budget, SYSTEM_HEALTH } from "@/config/app.config";
import type { CronHealthRow } from "@/data/platform";

export function ScheduledJobsPanel({ cronRows, metrics, healthDaily }: {
  cronRows: CronHealthRow[]; metrics: EdgeFnMetric[]; healthDaily: HealthDay[];
}) {
  const byFn = new Map(metrics.map((m) => [m.fn, m]));
  return (
    <Card>
      <CardHeader><CardTitle className="font-display text-base">Scheduled jobs</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {cronRows.map((c) => {
          // Jobs are keyed by cron name, rollups by deployed slug — they differ for the
          // digests and watchers, so both lookups go through CRON_JOB_TO_FN.
          const slug = CRON_JOB_TO_FN[c.job_name] ?? c.job_name;
          const metric = byFn.get(slug) ?? null;
          const state = deriveJobStatus(c.status, metric, budget);
          const reason = describeJobHealth(c.status, metric, budget);
          const rollup = healthDaily.filter((r) => r.fn === slug);
          return (
            <div key={c.job_name} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-3">
                <StatusDot state={state} />
                <span className="font-mono text-sm font-medium flex-1 truncate">{c.job_name}</span>
                <StatusPill state={state} />
              </div>
              <div className="mt-3">
                <UptimeBar rows={rollup} days={SYSTEM_HEALTH.uptimeDays} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <LatencyStat p95Ms={metric?.p95Ms ?? null} />
                <span>· {c.schedule ?? "—"}</span>
                {c.last_run_at && <span>· last run {new Date(c.last_run_at).toLocaleString()}</span>}
                {c.last_error && <span>· {c.last_error}</span>}
              </div>
              {reason && <p className="mt-2 text-xs text-muted-foreground">{reason}</p>}
              <RecentRunsList recent={metric?.recent ?? []} />
              {c.recentFailures.length > 0 && (
                <details className="mt-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium text-foreground">
                    Failure history ({c.recentFailures.length} in {SYSTEM_HEALTH.logRetentionDays} days) · last {new Date(c.recentFailures[0].observed_at).toLocaleString()}
                  </summary>
                  <div className="mt-2 space-y-1 rounded-md bg-muted/40 p-2">
                    {c.recentFailures.map((failure) => (
                      <p key={`${failure.observed_at}-${failure.status_code ?? "none"}`}>
                        {new Date(failure.observed_at).toLocaleString()} · {failure.status_code === null ? "no HTTP response" : `HTTP ${failure.status_code}`} · {failure.error ?? "No error detail recorded"}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          );
        })}
        {cronRows.length === 0 && <p className="text-sm text-muted-foreground">No scheduled-job health recorded yet.</p>}
      </CardContent>
    </Card>
  );
}
```

Note the `pl-5` indents are gone: the bar is full-width, so indenting the metadata under it no longer lines up with anything.

- [ ] **Step 4: Rewrite `EdgeFunctionsPanel`'s row**

In `src/components/platform/systemHealth/EdgeFunctionsPanel.tsx`:

- Change the component signature to `EdgeFunctionsPanel({ metrics, healthDaily }: { metrics: EdgeFnMetric[]; healthDaily: HealthDay[] })` and pass `healthDaily.filter((r) => r.fn === m.fn)` into each `EdgeFnRow` as a `rollup` prop.
- In `EdgeFnRow`, replace the `<RunTimeline ... />` element with, directly under the name row:

```tsx
      <div className="mt-3">
        <UptimeBar rows={rollup} days={SYSTEM_HEALTH.uptimeDays} />
      </div>
```

- Drop `RunTimeline` from the `./primitives` import and add `import { UptimeBar } from "./UptimeBar";`, `import { RecentRunsList } from "./RecentRunsList";`, `import type { HealthDay } from "@/lib/uptime";` and `SYSTEM_HEALTH` to the config import.
- Remove the `pl-5` from the stat line and the blocks below it.
- Add `<RecentRunsList recent={m.recent} />` immediately before the existing `hasFaults` block, so per-run detail sits above the log drill-down.
- Leave the status chips, `lastFailure` line and "View recent errors" button exactly as they are.

- [ ] **Step 5: Thread the data through `SystemHealthTab`**

In `src/components/platform/SystemHealthTab.tsx`:

- Add `import { useHealthDaily } from "@/hooks/useSystemHealth";` to the existing hook import.
- Add `const daily = useHealthDaily();` beside the other hooks.
- Add `const healthDaily = daily.data ?? [];` beside `const metrics = ...`. An empty array is the correct fallback: the bar renders 30 "no data" cells, which is exactly right when the rollup has not run.
- Pass `healthDaily={healthDaily}` to both `<ScheduledJobsPanel />` and `<EdgeFunctionsPanel />`.

Do not gate rendering on `daily.isLoading` — the panels are useful without the bar, and blocking on it would make a rollup outage blank the tab.

- [ ] **Step 6: Delete the dead code**

- In `src/components/platform/systemHealth/primitives.tsx`: delete `RunTimeline` and `IncidentTimeline`, then delete any import that is now unused (`Tooltip*`, `cn`, `describeOutcome`, `dailyFailureBuckets`, `describeFailureDay`, `EdgeFnMetric`, `EdgeFnOutcome`, `FailureRecord`). `StatusDot`, `StatusPill` and `LatencyStat` stay.
- In `src/lib/systemHealth.ts`: delete `FailureRecord`, `FailureDay`, `localDayKey`, `dailyFailureBuckets` and `describeFailureDay`. Keep `describeOutcome` — `RecentRunsList` uses it.

Lint will fail on any import left dangling, which is the check that this step was done completely.

- [ ] **Step 7: Run the full gate**

```bash
npx vitest run
npm run lint
npx tsc -p tsconfig.app.json --noEmit
npm run sync:mirrors:check
```

Expected: all green. If `vitest` reports a failure in a file you did not touch, a deleted export is still referenced somewhere — follow the error rather than re-adding the export.

- [ ] **Step 8: Verify in the browser**

The `/platform` route needs a super-admin login. Verify the rendering with a throwaway Vite entry instead:

Create `health-preview.html` at the repo root:

```html
<!doctype html><html><head><meta charset="utf-8"><title>preview</title></head>
<body><div id="root"></div><script type="module" src="/src/health-preview.tsx"></script></body></html>
```

Create `src/health-preview.tsx` rendering `<ScheduledJobsPanel>` with fixture `cronRows`, `metrics` and a `healthDaily` array covering a mix of clean, degraded, down and missing days. Start the dev server with the `preview_start` tool (never `npm run dev` in Bash), open `http://localhost:8080/health-preview.html`, screenshot it, and hover a day cell to confirm the tooltip.

Then delete both files — they must not be committed:

```bash
rm -f health-preview.html src/health-preview.tsx
```

- [ ] **Step 9: Commit**

```bash
git add src/components/platform src/lib/systemHealth.ts src/lib/systemHealth.test.ts
git commit -m "replace status strips with a 30-day uptime bar"
```

---

### Task 9: Documentation and post-deploy verification

**Files:**
- Modify: `CLAUDE.md` (the `components/platform/` and edge-function inventory sections)
- Modify: `docs/system-map.md` (if Task 3 Step 8 left anything incomplete)

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Update the architecture notes**

In `CLAUDE.md`:

- Under `components/platform/`, extend the `systemHealth/` list to `systemHealth/ (OverallStatusBanner, DomainSummaryGrid, EdgeFunctionsPanel, ScheduledJobsPanel, UptimeBar, RecentRunsList, primitives)`.
- Under the edge-functions **Watchers** bullet, add: `health-rollup` — 15-min cron that recomputes today's and yesterday's per-function run/failure counts from the Analytics API into `health_daily`, the durable source behind the System Health 30-day uptime bar. Idempotent (recomputes rather than increments); aborts without writing when Analytics is unavailable, so an outage cannot punch a hole in the bar.

- [ ] **Step 2: Confirm the rollup is actually accumulating**

At least an hour after deploy:

```bash
supabase db query --linked --query "select day, count(*) as functions, sum(runs) as runs, sum(failures) as failures from public.health_daily group by day order by day desc"
```

Expected: a row for today (and yesterday once one pass has run past midnight), with `runs` well above zero. If `functions` is 1 and the slug reads `unattributed`, the Management API slug lookup is failing — check the `ANALYTICS` PAT's scopes.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/system-map.md
git commit -m "document the health rollup and uptime bar"
```

---

## Rollout note

The bar is honest but empty on day one: 29 of 30 cells read "no data recorded" until history accumulates. That is expected and is why `uptimePercent` returns `null` (rendering "no data yet") rather than a fabricated 100%. Nothing can be backfilled — the Analytics API's 24-hour retention is the hard limit, and it is the reason `health_daily` exists at all.
