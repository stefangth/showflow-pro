# System Health Console — Phase 1 (Scheduled jobs + Edge functions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `/platform` System Health tab into a console shell with a universal 4-state model, driven by two domain panels — Scheduled jobs and Edge functions.

**Architecture:** Durable cron *status* comes from `cron_health_state` via the existing `get_cron_health()` RPC. *Latency/error* metrics for both panels come from one new super-admin edge function, `platform-edge-metrics`, that proxies the Supabase Analytics (Management) API with a dedicated PAT (edge secret `ANALYTICS`). The **Degraded** state is derived in a pure, unit-tested module by combining cron status with latency. No new DB tables.

**Tech Stack:** React 18 + TS + Vite, @tanstack/react-query v5, shadcn/ui + Tailwind (semantic tokens), Supabase edge functions (Deno, DI via `handle(req, deps)`), Vitest (frontend), Deno test (edge).

**Spec:** `docs/superpowers/specs/2026-06-24-system-health-console-phase1-design.md`

### Execution-environment notes
- This local env is **Deno-only**. **Vitest/eslint run in CI** (treat `npx vitest run` steps as "the executor or CI runs this"). **Deno edge tests run locally** with: `deno test --allow-all --node-modules-dir=none supabase/functions/platform-edge-metrics/`.
- `ANALYTICS` (a Supabase PAT) is **already set** as an edge-function secret. No setup step.
- Deploy is automatic on merge to `main` (per CLAUDE.md), provided `config.toml` lists the new function.

### File structure (created/modified)
- Create `src/lib/systemHealth.ts` — pure types + status derivation (no I/O).
- Create `src/lib/systemHealth.test.ts` — derivation unit tests.
- Modify `src/config/app.config.ts` — add `SYSTEM_HEALTH` thresholds.
- Create `supabase/functions/platform-edge-metrics/index.ts` — Analytics proxy.
- Create `supabase/functions/platform-edge-metrics/index.di.test.ts` — DI tests.
- Modify `supabase/config.toml` — register the function.
- Modify `src/data/platform.ts` — add `fetchEdgeFnMetrics`.
- Create `src/data/platform.edgemetrics.test.ts` — data-access test.
- Create `src/hooks/useSystemHealth.ts` — `useCronHealth` + `useEdgeFnMetrics` hooks.
- Create `src/components/platform/systemHealth/primitives.tsx` — StatusDot, StatusPill, LatencyStat, RunTimeline.
- Create `src/components/platform/systemHealth/primitives.test.tsx`.
- Create `src/components/platform/systemHealth/OverallStatusBanner.tsx`, `DomainSummaryGrid.tsx`.
- Create `src/components/platform/systemHealth/ScheduledJobsPanel.tsx`, `EdgeFunctionsPanel.tsx`.
- Modify `src/components/platform/SystemHealthTab.tsx` — rewrite as the shell.
- Modify `src/components/platform/SystemHealthTab.test.tsx` — update for the new model.

---

## Task 1: Pure status-derivation module (`systemHealth.ts`)

**Files:**
- Create: `src/lib/systemHealth.ts`
- Test: `src/lib/systemHealth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/systemHealth.test.ts
import { describe, it, expect } from "vitest";
import {
  deriveJobStatus, deriveEdgeFnStatus, worstStatus, CRON_JOB_TO_FN,
  type EdgeFnMetric, type HealthBudget,
} from "@/lib/systemHealth";

const BUDGET: HealthBudget = { p95Ms: 12000, errorRate: 0.05 };
const metric = (over: Partial<EdgeFnMetric> = {}): EdgeFnMetric => ({
  fn: "f", invocations: 10, errors: 0, p50Ms: 100, p95Ms: 200,
  lastInvokedAt: "2026-06-24T00:00:00Z", lastStatus: 200, recent: [], ...over,
});

describe("deriveJobStatus", () => {
  it("maps cron 'stale' to stale regardless of metrics", () => {
    expect(deriveJobStatus("stale", metric(), BUDGET)).toBe("stale");
  });
  it("maps cron 'failing' to down", () => {
    expect(deriveJobStatus("failing", metric(), BUDGET)).toBe("down");
  });
  it("is operational when healthy and within budget", () => {
    expect(deriveJobStatus("healthy", metric({ p95Ms: 8000 }), BUDGET)).toBe("operational");
  });
  it("is degraded when healthy but p95 over budget", () => {
    expect(deriveJobStatus("healthy", metric({ p95Ms: 15000 }), BUDGET)).toBe("degraded");
  });
  it("is degraded when healthy but error rate over budget", () => {
    expect(deriveJobStatus("healthy", metric({ invocations: 10, errors: 2 }), BUDGET)).toBe("degraded");
  });
  it("is operational when healthy with no metrics yet", () => {
    expect(deriveJobStatus("healthy", null, BUDGET)).toBe("operational");
  });
});

describe("deriveEdgeFnStatus", () => {
  it("is operational with no recent invocations", () => {
    expect(deriveEdgeFnStatus(metric({ invocations: 0 }), BUDGET)).toBe("operational");
  });
  it("is down when every recent invocation errored", () => {
    expect(deriveEdgeFnStatus(metric({ invocations: 3, errors: 3 }), BUDGET)).toBe("down");
  });
  it("is degraded on elevated error rate with some success", () => {
    expect(deriveEdgeFnStatus(metric({ invocations: 10, errors: 2 }), BUDGET)).toBe("degraded");
  });
  it("is degraded on slow p95", () => {
    expect(deriveEdgeFnStatus(metric({ p95Ms: 20000 }), BUDGET)).toBe("degraded");
  });
});

describe("worstStatus", () => {
  it("ranks down worst, then stale, then degraded, then operational", () => {
    expect(worstStatus(["operational", "degraded", "down"])).toBe("down");
    expect(worstStatus(["operational", "stale", "degraded"])).toBe("stale");
    expect(worstStatus([])).toBe("operational");
  });
});

describe("CRON_JOB_TO_FN", () => {
  it("maps cron job names to their deployed function slugs", () => {
    expect(CRON_JOB_TO_FN["offer-digest"]).toBe("send-offer-digest");
    expect(CRON_JOB_TO_FN["expire-offers-hourly"]).toBe("expire-offers");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/systemHealth.test.ts`
Expected: FAIL — "Failed to resolve import '@/lib/systemHealth'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/systemHealth.ts
export type HealthState = "operational" | "degraded" | "down" | "stale";
export type CronStatus = "healthy" | "failing" | "stale" | "unknown";

/** A single recent invocation outcome, for the run timeline (most-recent-first). */
export interface EdgeFnOutcome { status: number; ms: number }

/** Per-function metrics from the platform-edge-metrics proxy over the lookback window.
 *  This shape is mirrored by the edge function's JSON output — keep the two in sync. */
export interface EdgeFnMetric {
  fn: string;
  invocations: number;
  errors: number;            // count of 5xx responses
  p50Ms: number | null;
  p95Ms: number | null;
  lastInvokedAt: string | null;
  lastStatus: number | null;
  recent: EdgeFnOutcome[];
}

export interface HealthBudget {
  p95Ms: number;             // above this (while otherwise healthy) -> degraded
  errorRate: number;         // 0..1; above this -> degraded
}

/** Cron job_name -> deployed edge-function slug (digests/watchers use different names). */
export const CRON_JOB_TO_FN: Record<string, string> = {
  "offer-digest": "send-offer-digest",
  "confirmation-digest": "send-confirmation-digest",
  "expire-offers-hourly": "expire-offers",
  "tier-at-risk-hourly": "tier-at-risk-watcher",
  "airtable-poll": "airtable-poll",
  "cron-health-watcher": "cron-health-watcher",
};

const errorRate = (m: EdgeFnMetric | null): number =>
  m && m.invocations > 0 ? m.errors / m.invocations : 0;

/** Combine durable cron status with latency/errors to yield the 4-state model. */
export function deriveJobStatus(cron: CronStatus, metric: EdgeFnMetric | null, budget: HealthBudget): HealthState {
  if (cron === "stale") return "stale";
  if (cron === "failing") return "down";
  if (metric) {
    if (errorRate(metric) > budget.errorRate) return "degraded";
    if (metric.p95Ms !== null && metric.p95Ms > budget.p95Ms) return "degraded";
  }
  return "operational";
}

/** On-demand functions: no schedule/stale concept; derive purely from metrics. */
export function deriveEdgeFnStatus(metric: EdgeFnMetric | null, budget: HealthBudget): HealthState {
  if (!metric || metric.invocations === 0) return "operational";
  const ok2xx = metric.invocations - metric.errors;
  if (metric.errors > 0 && ok2xx === 0) return "down";
  if (errorRate(metric) > budget.errorRate) return "degraded";
  if (metric.p95Ms !== null && metric.p95Ms > budget.p95Ms) return "degraded";
  return "operational";
}

const RANK: Record<HealthState, number> = { operational: 0, degraded: 1, stale: 2, down: 3 };
/** The worst (most severe) state in a list; "operational" for an empty list. */
export function worstStatus(states: HealthState[]): HealthState {
  return states.reduce<HealthState>((w, s) => (RANK[s] > RANK[w] ? s : w), "operational");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/systemHealth.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/systemHealth.ts src/lib/systemHealth.test.ts
git commit -m "feat(system-health): pure 4-state derivation module"
```

---

## Task 2: Console thresholds in app config

**Files:**
- Modify: `src/config/app.config.ts` (add after `BOOKING_ENGINE_DEFAULTS`, before `ROLES`)

- [ ] **Step 1: Add the config block**

```ts
/** Platform System Health console thresholds (super-admin tab).
 *  Mirrors the spec; tune p95BudgetMs from real cold-start data. */
export const SYSTEM_HEALTH = {
  /** Analytics lookback window (minutes). The Management API caps the range at 24h. */
  windowMinutes: 1440,
  /** Dashboard auto-refresh (ms). */
  refetchMs: 60_000,
  /** p95 latency (ms) above which an otherwise-healthy job/function reads as Degraded.
   *  Deliberately cold-start tolerant — functions legitimately boot 3–10s. */
  p95BudgetMs: 12_000,
  /** Recent 5xx fraction (0..1) above which a job/function reads as Degraded. */
  errorRateBudget: 0.05,
} as const;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit` (or rely on the next vitest run)
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/config/app.config.ts
git commit -m "feat(system-health): add SYSTEM_HEALTH thresholds"
```

---

## Task 3: `platform-edge-metrics` edge function

**Files:**
- Create: `supabase/functions/platform-edge-metrics/index.ts`
- Test: `supabase/functions/platform-edge-metrics/index.di.test.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Write the failing DI test**

```ts
// supabase/functions/platform-edge-metrics/index.di.test.ts
import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const SUPER = "11111111-1111-1111-1111-111111111111";

/** Canned Analytics rows: 3 airtable-poll invocations (one 500), 1 fast send-offer-digest. */
function analyticsRows() {
  return {
    result: [
      { function_name: "airtable-poll", status_code: 200, execution_time_ms: 4000, timestamp: "2026-06-24T09:00:00Z" },
      { function_name: "airtable-poll", status_code: 200, execution_time_ms: 9000, timestamp: "2026-06-24T09:05:00Z" },
      { function_name: "airtable-poll", status_code: 500, execution_time_ms: 1200, timestamp: "2026-06-24T09:10:00Z" },
      { function_name: "send-offer-digest", status_code: 200, execution_time_ms: 3000, timestamp: "2026-06-24T09:00:00Z" },
    ],
  };
}

function superDeps(fetchImpl?: typeof fetch) {
  return makeFakeDeps({
    authUser: { id: SUPER },
    tables: { platform_admins: { data: { user_id: SUPER }, error: null } },
    envVars: { ANALYTICS: "sbp_test_token", SUPABASE_URL: "https://proj.supabase.co" },
    fetchImpl,
  });
}
const superReq = (body: Record<string, unknown> = {}) =>
  makeRequest({ method: "POST", headers: { Authorization: "Bearer super-jwt" }, body });

Deno.test("OPTIONS preflight returns 204", async () => {
  const { deps } = superDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status, 204);
});

Deno.test("missing Bearer -> 401", async () => {
  const { deps } = superDeps();
  const res = await handle(makeRequest({ method: "POST", body: {} }), deps);
  assertEquals(res.status, 401);
});

Deno.test("non-super-admin -> 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "plain" },
    tables: { platform_admins: { data: null, error: null } },
    envVars: { ANALYTICS: "sbp_test_token", SUPABASE_URL: "https://proj.supabase.co" },
  });
  const res = await handle(superReq(), deps);
  assertEquals(res.status, 403);
});

Deno.test("aggregates per function and authenticates with the ANALYTICS PAT", async () => {
  let seenUrl = "";
  let seenAuth = "";
  const fetchImpl = ((url: string, init?: RequestInit) => {
    seenUrl = String(url);
    seenAuth = String((init?.headers as Record<string, string>)?.["Authorization"] ?? "");
    return Promise.resolve(new Response(JSON.stringify(analyticsRows()), { status: 200 }));
  }) as unknown as typeof fetch;

  const { deps } = superDeps(fetchImpl);
  const res = await handle(superReq({ window_minutes: 60 }), deps);
  assertEquals(res.status, 200);
  const body = await res.json() as { functions: Array<Record<string, unknown>> };

  const poll = body.functions.find((f) => f.fn === "airtable-poll")!;
  assertExists(poll);
  assertEquals(poll.invocations, 3);
  assertEquals(poll.errors, 1);
  assertEquals(poll.p95Ms, 9000); // slowest of the 3 at the p95 index
  // Hits the Management API with the dedicated PAT, never the service key.
  assertEquals(seenUrl.startsWith("https://api.supabase.com/v1/projects/proj/analytics"), true);
  assertEquals(seenAuth, "Bearer sbp_test_token");
});

Deno.test("analytics non-200 -> 502", async () => {
  const fetchImpl = (() => Promise.resolve(new Response("nope", { status: 500 }))) as unknown as typeof fetch;
  const { deps } = superDeps(fetchImpl);
  const res = await handle(superReq(), deps);
  assertEquals(res.status, 502);
});

Deno.test("window is clamped to <= 24h", async () => {
  let seenUrl = "";
  const fetchImpl = ((url: string) => {
    seenUrl = String(url);
    return Promise.resolve(new Response(JSON.stringify({ result: [] }), { status: 200 }));
  }) as unknown as typeof fetch;
  const { deps } = superDeps(fetchImpl);
  await handle(superReq({ window_minutes: 99999 }), deps);
  const u = new URL(seenUrl);
  const start = new Date(u.searchParams.get("iso_timestamp_start")!);
  const end = new Date(u.searchParams.get("iso_timestamp_end")!);
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  assertEquals(hours <= 24.0001, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/platform-edge-metrics/`
Expected: FAIL — module `./index.ts` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// supabase/functions/platform-edge-metrics/index.ts
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
      lat.length === 0 ? null : lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))];
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/platform-edge-metrics/`
Expected: PASS (6 tests).

- [ ] **Step 5: Register the function in config.toml**

Add to `supabase/config.toml` (near the other super-admin functions `export-org-data` / `provision-org`):

```toml
[functions.platform-edge-metrics]
verify_jwt = true
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/platform-edge-metrics/ supabase/config.toml
git commit -m "feat(system-health): platform-edge-metrics Analytics proxy (super-admin)"
```

---

## Task 4: `fetchEdgeFnMetrics` data-access

**Files:**
- Modify: `src/data/platform.ts` (add after `fetchCronHealth`)
- Test: `src/data/platform.edgemetrics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/data/platform.edgemetrics.test.ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchEdgeFnMetrics } from "@/data/platform";
import type { Database } from "@/integrations/supabase/types";

const asClient = (f: ReturnType<typeof createFakeSupabase>) => f as unknown as SupabaseClient<Database>;

describe("fetchEdgeFnMetrics", () => {
  it("invokes platform-edge-metrics with the window and returns the functions array", async () => {
    const fake = createFakeSupabase({
      "fn:platform-edge-metrics": {
        data: { functions: [{ fn: "airtable-poll", invocations: 3, errors: 1, p50Ms: 4000, p95Ms: 9000, lastInvokedAt: "2026-06-24T09:10:00Z", lastStatus: 500, recent: [] }] },
        error: null,
      },
    });
    const rows = await fetchEdgeFnMetrics(asClient(fake), 60);
    expect(rows).toHaveLength(1);
    expect(rows[0].fn).toBe("airtable-poll");
    expect(fake.calls).toContainEqual({ table: "fn:platform-edge-metrics", method: "invoke", args: [{ window_minutes: 60 }] });
  });

  it("returns [] when the function yields no body", async () => {
    const fake = createFakeSupabase({ "fn:platform-edge-metrics": { data: null, error: null } });
    expect(await fetchEdgeFnMetrics(asClient(fake), 60)).toEqual([]);
  });

  it("throws on an invoke error", async () => {
    const fake = createFakeSupabase({ "fn:platform-edge-metrics": { data: null, error: { message: "boom" } } });
    await expect(fetchEdgeFnMetrics(asClient(fake), 60)).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/platform.edgemetrics.test.ts`
Expected: FAIL — `fetchEdgeFnMetrics` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to the top imports of `src/data/platform.ts`:

```ts
import type { EdgeFnMetric } from "@/lib/systemHealth";
import { SYSTEM_HEALTH } from "@/config/app.config";
```

Add after `fetchCronHealth`:

```ts
/** Edge-function metrics for the System Health tab, via the super-admin platform-edge-metrics
 *  proxy (Supabase Analytics API). Returns one row per function over the lookback window. */
export async function fetchEdgeFnMetrics(
  client: SupabaseClient<Database>,
  windowMinutes: number = SYSTEM_HEALTH.windowMinutes,
): Promise<EdgeFnMetric[]> {
  const { data, error } = await client.functions.invoke("platform-edge-metrics", {
    body: { window_minutes: windowMinutes },
  });
  if (error) throw error;
  return (data as { functions?: EdgeFnMetric[] } | null)?.functions ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/platform.edgemetrics.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/platform.ts src/data/platform.edgemetrics.test.ts
git commit -m "feat(system-health): fetchEdgeFnMetrics data-access"
```

---

## Task 5: Query hooks

**Files:**
- Create: `src/hooks/useSystemHealth.ts`

Thin wrappers over the tested data-access functions; verified indirectly through the component tests in Tasks 7–9 (React Query hooks are not unit-tested in isolation in this codebase).

- [ ] **Step 1: Write the hooks**

```ts
// src/hooks/useSystemHealth.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchCronHealth, fetchEdgeFnMetrics } from "@/data/platform";
import { SYSTEM_HEALTH } from "@/config/app.config";

export function useCronHealth() {
  return useQuery({
    queryKey: ["platform", "cron-health"],
    queryFn: () => fetchCronHealth(supabase),
    refetchInterval: SYSTEM_HEALTH.refetchMs,
  });
}

export function useEdgeFnMetrics() {
  return useQuery({
    queryKey: ["platform", "edge-metrics", SYSTEM_HEALTH.windowMinutes],
    queryFn: () => fetchEdgeFnMetrics(supabase, SYSTEM_HEALTH.windowMinutes),
    refetchInterval: SYSTEM_HEALTH.refetchMs,
    staleTime: SYSTEM_HEALTH.refetchMs, // cap calls — the Analytics PAT is rate-limited to 60/min.
    // Latency is supplementary — a metrics outage must not blank the tab (panels show cron status only).
    retry: 1,
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSystemHealth.ts
git commit -m "feat(system-health): useCronHealth + useEdgeFnMetrics hooks"
```

---

## Task 6: Presentational primitives

**Files:**
- Create: `src/components/platform/systemHealth/primitives.tsx`
- Test: `src/components/platform/systemHealth/primitives.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/platform/systemHealth/primitives.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill, LatencyStat } from "./primitives";

describe("StatusPill", () => {
  it("labels each state in sentence case", () => {
    render(<StatusPill state="degraded" />);
    expect(screen.getByText("Degraded")).toBeInTheDocument();
  });
});

describe("LatencyStat", () => {
  it("formats milliseconds as seconds", () => {
    render(<LatencyStat p95Ms={8400} />);
    expect(screen.getByText(/8\.4s/)).toBeInTheDocument();
  });
  it("renders a dash when latency is unknown", () => {
    render(<LatencyStat p95Ms={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/platform/systemHealth/primitives.test.tsx`
Expected: FAIL — cannot resolve `./primitives`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/platform/systemHealth/primitives.tsx
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HealthState, EdgeFnMetric } from "@/lib/systemHealth";

const LABEL: Record<HealthState, string> = {
  operational: "Operational", degraded: "Degraded", down: "Down", stale: "Stale",
};
// Semantic tokens only. "degraded"/"stale" use the warning tone, "down" destructive, "operational" success-ish.
const DOT: Record<HealthState, string> = {
  operational: "bg-emerald-500", degraded: "bg-amber-500", down: "bg-destructive", stale: "bg-muted-foreground",
};
const PILL: Record<HealthState, string> = {
  operational: "border-emerald-500/30 text-emerald-600",
  degraded: "border-amber-500/30 text-amber-600",
  down: "border-destructive/30 text-destructive",
  stale: "border-border text-muted-foreground",
};

export function StatusDot({ state, className }: { state: HealthState; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 rounded-full", DOT[state], className)} />;
}

export function StatusPill({ state }: { state: HealthState }) {
  return <Badge variant="outline" className={cn("gap-1.5", PILL[state])}><StatusDot state={state} />{LABEL[state]}</Badge>;
}

export function LatencyStat({ p95Ms }: { p95Ms: number | null }) {
  const text = p95Ms === null ? "—" : `${(p95Ms / 1000).toFixed(1)}s`;
  return <span className="tabular-nums text-muted-foreground">{p95Ms === null ? "—" : `p95 ${text}`}</span>;
}

/** Up to 20 recent-outcome ticks (most-recent-first), colored by outcome. */
export function RunTimeline({ metric, p95BudgetMs }: { metric: EdgeFnMetric | null; p95BudgetMs: number }) {
  const ticks = (metric?.recent ?? []).slice(0, 20);
  const tone = (o: { status: number; ms: number }) =>
    o.status >= 500 ? "bg-destructive" : o.status >= 400 || o.ms > p95BudgetMs ? "bg-amber-500" : "bg-emerald-500";
  if (ticks.length === 0) return <span className="text-xs text-muted-foreground">no recent runs</span>;
  return (
    <span className="inline-flex items-center gap-px" aria-hidden>
      {ticks.map((o, i) => <span key={i} className={cn("h-3 w-[3px] rounded-sm", tone(o))} />)}
    </span>
  );
}
```

> Note: `bg-emerald-500`/`bg-amber-500` are used for the success/warning hues the design system lacks as semantic tokens; `bg-destructive`, `text-muted-foreground`, `border-border` are semantic. If the project later adds `--success`/`--warning` tokens, swap these.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/platform/systemHealth/primitives.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/platform/systemHealth/primitives.tsx src/components/platform/systemHealth/primitives.test.tsx
git commit -m "feat(system-health): status primitives (pill, dot, latency, timeline)"
```

---

## Task 7: Overall banner + domain summary grid

**Files:**
- Create: `src/components/platform/systemHealth/OverallStatusBanner.tsx`
- Create: `src/components/platform/systemHealth/DomainSummaryGrid.tsx`
- Test: `src/components/platform/systemHealth/DomainSummaryGrid.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/platform/systemHealth/DomainSummaryGrid.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DomainSummaryGrid } from "./DomainSummaryGrid";

describe("DomainSummaryGrid", () => {
  it("renders live domains and honest 'Not monitored yet' placeholders", () => {
    render(<DomainSummaryGrid domains={[
      { key: "jobs", label: "Scheduled jobs", state: "degraded", detail: "1 slow" },
      { key: "edge", label: "Edge functions", state: "operational", detail: "p95 4.9s" },
    ]} />);
    expect(screen.getByText("Scheduled jobs")).toBeInTheDocument();
    expect(screen.getByText("1 slow")).toBeInTheDocument();
    expect(screen.getAllByText("Not monitored yet").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/platform/systemHealth/DomainSummaryGrid.test.tsx`
Expected: FAIL — cannot resolve `./DomainSummaryGrid`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/platform/systemHealth/OverallStatusBanner.tsx
import { Card } from "@/components/ui/card";
import { StatusDot } from "./primitives";
import type { HealthState } from "@/lib/systemHealth";

const SUMMARY: Record<HealthState, string> = {
  operational: "All systems operational",
  degraded: "Some systems degraded",
  down: "A system is down",
  stale: "A scheduled job has stopped firing",
};

export function OverallStatusBanner({ state, detail }: { state: HealthState; detail: string }) {
  return (
    <Card className="flex items-center justify-between gap-4 p-4">
      <div className="flex items-center gap-3 min-w-0">
        <StatusDot state={state} className="h-2.5 w-2.5" />
        <div className="min-w-0">
          <div className="font-display font-medium">{SUMMARY[state]}</div>
          <div className="text-sm text-muted-foreground truncate">{detail}</div>
        </div>
      </div>
    </Card>
  );
}
```

```tsx
// src/components/platform/systemHealth/DomainSummaryGrid.tsx
import { StatusDot } from "./primitives";
import type { HealthState } from "@/lib/systemHealth";

export interface DomainSummary { key: string; label: string; state: HealthState; detail: string }

/** Domains planned for later phases — shown muted so we never imply unmeasured health. */
const PLACEHOLDERS = ["Email delivery", "Database", "Org sync", "Auth / Storage"];

export function DomainSummaryGrid({ domains }: { domains: DomainSummary[] }) {
  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
      {domains.map((d) => (
        <div key={d.key} className="rounded-lg bg-muted/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <StatusDot state={d.state} />
            <span className="text-sm text-muted-foreground">{d.label}</span>
          </div>
          <div className="text-xs text-muted-foreground">{d.detail}</div>
        </div>
      ))}
      {PLACEHOLDERS.map((label) => (
        <div key={label} className="rounded-lg bg-muted/20 p-3 opacity-60">
          <div className="mb-2 flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>
          <div className="text-xs text-muted-foreground">Not monitored yet</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/platform/systemHealth/DomainSummaryGrid.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/platform/systemHealth/OverallStatusBanner.tsx src/components/platform/systemHealth/DomainSummaryGrid.tsx src/components/platform/systemHealth/DomainSummaryGrid.test.tsx
git commit -m "feat(system-health): overall banner + domain summary grid"
```

---

## Task 8: Scheduled jobs + Edge functions panels

**Files:**
- Create: `src/components/platform/systemHealth/ScheduledJobsPanel.tsx`
- Create: `src/components/platform/systemHealth/EdgeFunctionsPanel.tsx`
- Test: `src/components/platform/systemHealth/ScheduledJobsPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/platform/systemHealth/ScheduledJobsPanel.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScheduledJobsPanel } from "./ScheduledJobsPanel";
import type { CronHealthRow } from "@/data/platform";
import type { EdgeFnMetric } from "@/lib/systemHealth";

const cron: CronHealthRow = {
  job_name: "cron-health-watcher", schedule: "*/15 * * * *", status: "healthy",
  last_status_code: 200, last_ok_at: null, last_error: null, consecutive_failures: 0,
  last_run_at: "2026-06-24T09:45:00Z", recent_failures: [],
};
const metric: EdgeFnMetric = {
  fn: "cron-health-watcher", invocations: 10, errors: 0, p50Ms: 4000, p95Ms: 8400,
  lastInvokedAt: "2026-06-24T09:45:00Z", lastStatus: 200, recent: [],
};

describe("ScheduledJobsPanel", () => {
  it("shows a slow-but-200 job as Degraded, not Down", () => {
    render(<ScheduledJobsPanel cronRows={[cron]} metrics={[metric]} />);
    expect(screen.getByText("cron-health-watcher")).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.queryByText("Down")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/platform/systemHealth/ScheduledJobsPanel.test.tsx`
Expected: FAIL — cannot resolve `./ScheduledJobsPanel`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/platform/systemHealth/ScheduledJobsPanel.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, StatusDot, LatencyStat, RunTimeline } from "./primitives";
import { deriveJobStatus, CRON_JOB_TO_FN, type EdgeFnMetric } from "@/lib/systemHealth";
import { SYSTEM_HEALTH } from "@/config/app.config";
import type { CronHealthRow } from "@/data/platform";

const budget = { p95Ms: SYSTEM_HEALTH.p95BudgetMs, errorRate: SYSTEM_HEALTH.errorRateBudget };

export function ScheduledJobsPanel({ cronRows, metrics }: { cronRows: CronHealthRow[]; metrics: EdgeFnMetric[] }) {
  const byFn = new Map(metrics.map((m) => [m.fn, m]));
  return (
    <Card>
      <CardHeader><CardTitle className="font-display text-base">Scheduled jobs</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {cronRows.map((c) => {
          const metric = byFn.get(CRON_JOB_TO_FN[c.job_name] ?? c.job_name) ?? null;
          const state = deriveJobStatus(c.status, metric, budget);
          return (
            <div key={c.job_name} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-3">
                <StatusDot state={state} />
                <span className="font-mono text-sm font-medium flex-1 truncate">{c.job_name}</span>
                <StatusPill state={state} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-5 text-xs text-muted-foreground">
                <RunTimeline metric={metric} p95BudgetMs={budget.p95Ms} />
                <LatencyStat p95Ms={metric?.p95Ms ?? null} />
                <span>· {c.schedule ?? "—"}</span>
                {c.last_run_at && <span>· last run {new Date(c.last_run_at).toLocaleString()}</span>}
                {c.last_error && <span>· {c.last_error}</span>}
              </div>
            </div>
          );
        })}
        {cronRows.length === 0 && <p className="text-sm text-muted-foreground">No scheduled-job health recorded yet.</p>}
      </CardContent>
    </Card>
  );
}
```

```tsx
// src/components/platform/systemHealth/EdgeFunctionsPanel.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, StatusDot, LatencyStat, RunTimeline } from "./primitives";
import { deriveEdgeFnStatus, CRON_JOB_TO_FN, type EdgeFnMetric } from "@/lib/systemHealth";
import { SYSTEM_HEALTH } from "@/config/app.config";

const budget = { p95Ms: SYSTEM_HEALTH.p95BudgetMs, errorRate: SYSTEM_HEALTH.errorRateBudget };
const CRON_FNS = new Set(Object.values(CRON_JOB_TO_FN));

export function EdgeFunctionsPanel({ metrics }: { metrics: EdgeFnMetric[] }) {
  // Show non-cron functions here (cron ones live in the Scheduled jobs panel); fall back to all if none.
  const nonCron = metrics.filter((m) => !CRON_FNS.has(m.fn));
  const rows = nonCron.length > 0 ? nonCron : metrics;
  return (
    <Card>
      <CardHeader><CardTitle className="font-display text-base">Edge functions</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.map((m) => {
          const state = deriveEdgeFnStatus(m, budget);
          return (
            <div key={m.fn} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-3">
                <StatusDot state={state} />
                <span className="font-mono text-sm font-medium flex-1 truncate">{m.fn}</span>
                <StatusPill state={state} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-5 text-xs text-muted-foreground">
                <RunTimeline metric={m} p95BudgetMs={budget.p95Ms} />
                <LatencyStat p95Ms={m.p95Ms} />
                <span>· {m.invocations} calls</span>
                <span>· {m.errors} errors</span>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No edge-function activity in the window.</p>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/platform/systemHealth/ScheduledJobsPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/platform/systemHealth/ScheduledJobsPanel.tsx src/components/platform/systemHealth/EdgeFunctionsPanel.tsx src/components/platform/systemHealth/ScheduledJobsPanel.test.tsx
git commit -m "feat(system-health): scheduled jobs + edge functions panels"
```

---

## Task 9: Rewrite `SystemHealthTab` as the shell

**Files:**
- Modify: `src/components/platform/SystemHealthTab.tsx`
- Modify: `src/components/platform/SystemHealthTab.test.tsx`

- [ ] **Step 1: Update the existing test for the new model**

Replace the body of `src/components/platform/SystemHealthTab.test.tsx` with:

```tsx
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { SystemHealthTab } from "./SystemHealthTab";
import * as platform from "@/data/platform";

describe("SystemHealthTab", () => {
  it("renders a failing cron job as Down", async () => {
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([{
      job_name: "offer-digest", schedule: "0 16-19 * * *", status: "failing",
      last_status_code: 404, last_ok_at: null, last_error: "HTTP 404",
      consecutive_failures: 1, last_run_at: null, recent_failures: [],
    }]);
    vi.spyOn(platform, "fetchEdgeFnMetrics").mockResolvedValue([]);
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText("offer-digest")).toBeInTheDocument();
    expect(await screen.findByText("Down")).toBeInTheDocument();
  });

  it("renders a healthy-but-slow job as Degraded (not Down) when metrics are present", async () => {
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([{
      job_name: "cron-health-watcher", schedule: "*/15 * * * *", status: "healthy",
      last_status_code: 200, last_ok_at: null, last_error: null,
      consecutive_failures: 0, last_run_at: "2026-06-24T09:45:00Z", recent_failures: [],
    }]);
    vi.spyOn(platform, "fetchEdgeFnMetrics").mockResolvedValue([{
      fn: "cron-health-watcher", invocations: 10, errors: 0, p50Ms: 4000, p95Ms: 18000,
      lastInvokedAt: "2026-06-24T09:45:00Z", lastStatus: 200, recent: [],
    }]);
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText("Degraded")).toBeInTheDocument();
  });

  it("still renders cron status when the metrics proxy fails", async () => {
    vi.spyOn(platform, "fetchCronHealth").mockResolvedValue([{
      job_name: "airtable-poll", schedule: "*/5 * * * *", status: "healthy",
      last_status_code: 200, last_ok_at: null, last_error: null,
      consecutive_failures: 0, last_run_at: null, recent_failures: [],
    }]);
    vi.spyOn(platform, "fetchEdgeFnMetrics").mockRejectedValue(new Error("analytics down"));
    renderWithProviders(<SystemHealthTab />);
    expect(await screen.findByText("airtable-poll")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/platform/SystemHealthTab.test.tsx`
Expected: FAIL — the current tab has no "Down"/"Degraded" labels and ignores `fetchEdgeFnMetrics`.

- [ ] **Step 3: Rewrite the component**

```tsx
// src/components/platform/SystemHealthTab.tsx
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCronHealth, useEdgeFnMetrics } from "@/hooks/useSystemHealth";
import { OverallStatusBanner } from "./systemHealth/OverallStatusBanner";
import { DomainSummaryGrid } from "./systemHealth/DomainSummaryGrid";
import { ScheduledJobsPanel } from "./systemHealth/ScheduledJobsPanel";
import { EdgeFunctionsPanel } from "./systemHealth/EdgeFunctionsPanel";
import {
  deriveJobStatus, deriveEdgeFnStatus, worstStatus, CRON_JOB_TO_FN, type HealthState,
} from "@/lib/systemHealth";
import { SYSTEM_HEALTH } from "@/config/app.config";

const budget = { p95Ms: SYSTEM_HEALTH.p95BudgetMs, errorRate: SYSTEM_HEALTH.errorRateBudget };

export function SystemHealthTab() {
  const cron = useCronHealth();
  const edge = useEdgeFnMetrics();

  if (cron.isLoading) return <Skeleton className="h-40 w-full" />;
  if (cron.isError) return <Alert variant="destructive"><AlertDescription>{(cron.error as Error).message}</AlertDescription></Alert>;

  const cronRows = cron.data ?? [];
  const metrics = edge.data ?? [];
  const byFn = new Map(metrics.map((m) => [m.fn, m]));

  const jobStates: HealthState[] = cronRows.map((c) =>
    deriveJobStatus(c.status, byFn.get(CRON_JOB_TO_FN[c.job_name] ?? c.job_name) ?? null, budget));
  const cronFns = new Set(Object.values(CRON_JOB_TO_FN));
  const edgeStates: HealthState[] = metrics.filter((m) => !cronFns.has(m.fn)).map((m) => deriveEdgeFnStatus(m, budget));

  const jobsState = worstStatus(jobStates);
  const edgeState = worstStatus(edgeStates);
  const overall = worstStatus([jobsState, edgeState]);

  const slowJobs = jobStates.filter((s) => s !== "operational").length;
  const detail = edge.isError
    ? "Latency metrics unavailable — showing scheduled-job status only"
    : `${cronRows.length} jobs · ${slowJobs} need attention`;

  return (
    <div className="space-y-4">
      <OverallStatusBanner state={overall} detail={detail} />
      <DomainSummaryGrid domains={[
        { key: "jobs", label: "Scheduled jobs", state: jobsState, detail: `${cronRows.length} jobs · ${slowJobs} flagged` },
        { key: "edge", label: "Edge functions", state: edgeState, detail: edge.isError ? "metrics unavailable" : `${metrics.length} active` },
      ]} />
      <ScheduledJobsPanel cronRows={cronRows} metrics={metrics} />
      <EdgeFunctionsPanel metrics={metrics} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/platform/SystemHealthTab.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/platform/SystemHealthTab.tsx src/components/platform/SystemHealthTab.test.tsx
git commit -m "feat(system-health): rewrite tab as console shell (banner + grid + panels)"
```

---

## Task 10: Full verification

- [ ] **Step 1: Run the full frontend suite**

Run: `npx vitest run`
Expected: PASS, including the new files and the updated `SystemHealthTab.test.tsx`.

- [ ] **Step 2: Run the edge suite**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS, including `platform-edge-metrics`.

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: no lint errors; production build succeeds.

- [ ] **Step 4: Manual smoke (post-deploy)**

After merge to `main` deploys `platform-edge-metrics`: open `/platform` → System Health as a super-admin. Confirm the banner, the grid (2 live + placeholders), and both panels render; `cron-health-watcher` shows Operational/Degraded (never a false Down); the Edge functions panel lists non-cron functions; and if `send-transactional-email` 5xx'd in the window, it reads Degraded/Down. This is also where the `ANALYTICS` token is first exercised end-to-end.

- [ ] **Step 5: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(system-health): phase 1 verification cleanup"
```

---

## Notes for the executor
- **TDD is mandatory:** every implementation step is preceded by a failing test you must watch fail.
- **Semantic tokens:** the only non-token colors are the success/warning hues (`emerald`/`amber`) the design system lacks; everything else is `bg-destructive`, `text-muted-foreground`, `border-border`, etc.
- **Keep the two `EdgeFnMetric` shapes in sync** — `src/lib/systemHealth.ts` (frontend) and the interface inside `supabase/functions/platform-edge-metrics/index.ts` (edge). They cannot share an import across runtimes.
- **Verify-at-implementation:** the `METRICS_SQL` + log source/columns in `platform-edge-metrics` must be confirmed against the live Analytics API (per the spec) before the manual smoke step; the DI tests pin the aggregation behavior regardless of the exact query text.
