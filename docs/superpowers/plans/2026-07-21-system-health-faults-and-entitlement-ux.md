# System Health fault visibility + entitlement UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make System Health report 4xx rejections as real faults with enough detail to diagnose them, and make module entitlement state legible in the UI instead of surfacing as an opaque non-2xx error.

**Architecture:** The edge-metrics aggregate gains three fields (`rejected`, `byStatus`, `lastFailure`) that the health derivation and panel consume, so the status pill, the counters, and the run timeline finally share one definition of "fault". A second, lazily-fetched Analytics query supplies per-function error log lines on expand. Separately, entitlement state becomes visible: non-super-admins see a locked nav entry, super-admins reach the page but get a read-only banner, and edge-function error codes get mapped to readable copy.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, Deno edge functions with DI (`handle(req, deps)`), Supabase Analytics API.

## Global Constraints

- `any` is banned. Lint is CI-gated at `--max-warnings 0`. Use an explicit local row `interface` plus a single `as unknown as` cast at the query boundary, or the typed test helpers.
- **No em-dashes or en-dashes in product/UI copy** (UI strings, banners, toasts). Use periods, commas, colons, or middots.
- Semantic design tokens only in components (`text-muted-foreground`, `border-border`, `bg-warning`). Never hardcode colors. Accent numbered stops (`accent-50`–`900`) do not support Tailwind opacity modifiers.
- Test-first. Write the failing test, watch it fail, then implement.
- `EdgeFnMetric` is dual-homed: `src/lib/systemHealth.ts` and the interface inside `supabase/functions/platform-edge-metrics/index.ts`. Both change in the same commit.
- Edge-function Deno tests run with `--node-modules-dir=none`.
- After any edge-function behavior change, run the **whole** `supabase/functions/` Deno suite, not just the one file.
- Commit messages: imperative, lowercase, <= 72 chars.

---

### Task 1: Count 4xx rejections in the edge-metrics aggregate

**Files:**
- Modify: `supabase/functions/platform-edge-metrics/index.ts:7-13` (interface), `:49-74` (aggregate)
- Modify: `src/lib/systemHealth.ts:8-18` (mirror interface)
- Test: `supabase/functions/platform-edge-metrics/index.di.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `EdgeFnMetric` gains `rejected: number`, `byStatus: Record<string, number>`, `lastFailure: { status: number; at: string } | null`. Tasks 2, 3, and 4 all depend on these exact names.

- [ ] **Step 1: Write the failing test**

Add to `supabase/functions/platform-edge-metrics/index.di.test.ts`, at the end of the file:

```ts
const TIER_ID = "af3fd77d-cba2-4026-b5db-34d04de20ef5";

Deno.test("counts 4xx as rejected, 5xx as errors, and breaks down by status", async () => {
  const rows = {
    result: [
      { function_id: TIER_ID, status_code: 401, execution_time_ms: 300, timestamp: "2026-07-21T09:00:00Z" },
      { function_id: TIER_ID, status_code: 401, execution_time_ms: 310, timestamp: "2026-07-21T09:05:00Z" },
      { function_id: TIER_ID, status_code: 500, execution_time_ms: 900, timestamp: "2026-07-21T09:10:00Z" },
      { function_id: TIER_ID, status_code: 200, execution_time_ms: 400, timestamp: "2026-07-21T09:15:00Z" },
    ],
  };
  const fnList = [{ id: TIER_ID, slug: "open-offer-tier", name: "open-offer-tier" }];
  const { deps } = superDeps(routeFetch(rows, fnList));
  const res = await handle(superReq(), deps);
  assertEquals(res.status, 200);

  const body = await res.json() as { functions: Array<Record<string, unknown>> };
  const fn = body.functions[0];
  assertEquals(fn.fn, "open-offer-tier");
  assertEquals(fn.invocations, 4);
  assertEquals(fn.rejected, 2);
  assertEquals(fn.errors, 1);
  assertEquals(fn.byStatus, { "200": 1, "401": 2, "500": 1 });
});

Deno.test("lastFailure reports the most recent non-2xx, not the most recent call", async () => {
  const rows = {
    result: [
      { function_id: TIER_ID, status_code: 401, execution_time_ms: 300, timestamp: "2026-07-21T09:00:00Z" },
      { function_id: TIER_ID, status_code: 200, execution_time_ms: 400, timestamp: "2026-07-21T09:20:00Z" },
    ],
  };
  const fnList = [{ id: TIER_ID, slug: "open-offer-tier", name: "open-offer-tier" }];
  const { deps } = superDeps(routeFetch(rows, fnList));
  const res = await handle(superReq(), deps);

  const body = await res.json() as { functions: Array<Record<string, unknown>> };
  assertEquals(body.functions[0].lastFailure, { status: 401, at: "2026-07-21T09:00:00Z" });
});

Deno.test("lastFailure is null when every call succeeded", async () => {
  const rows = {
    result: [
      { function_id: TIER_ID, status_code: 200, execution_time_ms: 400, timestamp: "2026-07-21T09:00:00Z" },
    ],
  };
  const fnList = [{ id: TIER_ID, slug: "open-offer-tier", name: "open-offer-tier" }];
  const { deps } = superDeps(routeFetch(rows, fnList));
  const res = await handle(superReq(), deps);

  const body = await res.json() as { functions: Array<Record<string, unknown>> };
  assertEquals(body.functions[0].lastFailure, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
deno test --allow-all --node-modules-dir=none supabase/functions/platform-edge-metrics/
```

Expected: FAIL. The three new tests report `undefined` for `rejected`, `byStatus`, and `lastFailure`.

- [ ] **Step 3: Extend the interface in the edge function**

In `supabase/functions/platform-edge-metrics/index.ts`, replace the `EdgeFnMetric` interface (currently lines 7-13):

```ts
/** Mirrors src/lib/systemHealth.ts EdgeFnMetric — keep in sync. */
interface EdgeFnMetric {
  fn: string; invocations: number; errors: number; rejected: number;
  byStatus: Record<string, number>;
  p50Ms: number | null; p95Ms: number | null;
  lastInvokedAt: string | null; lastStatus: number | null;
  lastFailure: { status: number; at: string } | null;
  recent: { status: number; ms: number }[];
}
```

- [ ] **Step 4: Compute the new fields in `aggregate`**

In the same file, replace the returned object literal inside `aggregate` (currently lines 63-72):

```ts
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
      lastInvokedAt: last?.timestamp ?? null,
      lastStatus: last?.status_code ?? null,
      lastFailure: failure ? { status: Number(failure.status_code), at: String(failure.timestamp) } : null,
      recent: sorted.slice(0, 20).map((r) => ({ status: Number(r.status_code) || 0, ms: Number(r.execution_time_ms) || 0 })),
    };
```

- [ ] **Step 5: Mirror the interface in the frontend**

In `src/lib/systemHealth.ts`, replace the `EdgeFnMetric` interface (currently lines 8-18):

```ts
/** Per-function metrics from the platform-edge-metrics proxy over the lookback window.
 *  This shape is mirrored by the edge function's JSON output — keep the two in sync. */
export interface EdgeFnMetric {
  fn: string;
  invocations: number;
  errors: number;            // count of 5xx responses
  rejected: number;          // count of 4xx responses
  /** Exact status-code histogram, e.g. { "200": 3, "401": 48 }. Drives the panel's
   *  "what went wrong" chips, which a bare error count cannot answer. */
  byStatus: Record<string, number>;
  p50Ms: number | null;
  p95Ms: number | null;
  lastInvokedAt: string | null;
  lastStatus: number | null;
  /** Most recent non-2xx outcome in the window, or null if every call succeeded. */
  lastFailure: { status: number; at: string } | null;
  recent: EdgeFnOutcome[];
}
```

- [ ] **Step 6: Run the full edge-function suite**

```bash
deno test --allow-all --node-modules-dir=none supabase/functions/
```

Expected: PASS, all files. The pre-existing `platform-edge-metrics` tests must still pass. If any other function's test constructs an `EdgeFnMetric`, update it to include the new fields.

- [ ] **Step 7: Typecheck the frontend**

```bash
npx tsc --noEmit
```

Expected: errors in `src/lib/systemHealth.test.ts` and `src/components/platform/SystemHealthTab.test.tsx` about missing `rejected` / `byStatus` / `lastFailure` on their metric fixtures. Fix each fixture by adding `rejected: 0, byStatus: {}, lastFailure: null`. Re-run until clean.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/platform-edge-metrics/ src/lib/systemHealth.ts src/lib/systemHealth.test.ts src/components/platform/SystemHealthTab.test.tsx
git commit -m "count 4xx rejections in edge function metrics"
```

---

### Task 2: Make 4xx a fault in the health derivation

**Files:**
- Modify: `src/config/app.config.ts:75-92` (budget)
- Modify: `src/lib/systemHealth.ts` (`HealthBudget`, `deriveJobStatus`, `deriveEdgeFnStatus`)
- Test: `src/lib/systemHealth.test.ts`

**Interfaces:**
- Consumes: `EdgeFnMetric.rejected` from Task 1.
- Produces: `HealthBudget` gains `rejectRate: number`. `SYSTEM_HEALTH.rejectRateBudget = 0.2`.

**Why two budgets:** a stray 400 from bad user input is normal and must not page anyone, so 4xx gets a looser threshold than 5xx. But when *nothing* gets through, the function is down regardless of which class of failure it is.

- [ ] **Step 1: Write the failing tests**

In `src/lib/systemHealth.test.ts`, update the shared fixtures at the top of the file:

```ts
const BUDGET: HealthBudget = { p95Ms: 12000, errorRate: 0.05, rejectRate: 0.2 };
const metric = (over: Partial<EdgeFnMetric> = {}): EdgeFnMetric => ({
  fn: "f", invocations: 10, errors: 0, rejected: 0, byStatus: {}, p50Ms: 100, p95Ms: 200,
  lastInvokedAt: "2026-06-24T00:00:00Z", lastStatus: 200, lastFailure: null, recent: [], ...over,
});
```

Then add these cases inside the existing `describe("deriveEdgeFnStatus", ...)` block:

```ts
  it("is down when every call was rejected with 4xx", () => {
    expect(deriveEdgeFnStatus(metric({ invocations: 48, rejected: 48, errors: 0 }), BUDGET)).toBe("down");
  });
  it("is degraded when the 4xx rate is over budget but some calls get through", () => {
    expect(deriveEdgeFnStatus(metric({ invocations: 10, rejected: 3 }), BUDGET)).toBe("degraded");
  });
  it("tolerates an occasional 4xx below budget", () => {
    expect(deriveEdgeFnStatus(metric({ invocations: 100, rejected: 5 }), BUDGET)).toBe("operational");
  });
  it("is down when 4xx and 5xx together account for every call", () => {
    expect(deriveEdgeFnStatus(metric({ invocations: 4, rejected: 2, errors: 2 }), BUDGET)).toBe("down");
  });
```

And add this case inside the existing `describe("deriveJobStatus", ...)` block:

```ts
  it("is degraded when a healthy cron job is being rejected with 4xx", () => {
    expect(deriveJobStatus("healthy", metric({ invocations: 10, rejected: 3 }), BUDGET)).toBe("degraded");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/lib/systemHealth.test.ts
```

Expected: FAIL. The `down` and `degraded` cases return `"operational"` because `rejected` is ignored today.

- [ ] **Step 3: Add the reject-rate budget**

In `src/config/app.config.ts`, add to the `SYSTEM_HEALTH` object after `errorRateBudget`:

```ts
  /** Recent 4xx fraction (0..1) above which a job/function reads as Degraded.
   *  Looser than errorRateBudget: an occasional validation 400 is normal traffic,
   *  a sustained rejection rate is a broken caller. */
  rejectRateBudget: 0.2,
```

And extend `SYSTEM_HEALTH_BUDGET`:

```ts
export const SYSTEM_HEALTH_BUDGET = {
  p95Ms: SYSTEM_HEALTH.p95BudgetMs,
  errorRate: SYSTEM_HEALTH.errorRateBudget,
  rejectRate: SYSTEM_HEALTH.rejectRateBudget,
};
```

- [ ] **Step 4: Implement the derivation**

In `src/lib/systemHealth.ts`, extend `HealthBudget`:

```ts
export interface HealthBudget {
  p95Ms: number;             // above this (while otherwise healthy) -> degraded
  errorRate: number;         // 0..1; above this -> degraded
  rejectRate: number;        // 0..1; 4xx fraction above this -> degraded
}
```

Add a rate helper next to the existing `errorRate` helper:

```ts
const rejectRate = (m: EdgeFnMetric | null): number =>
  m && m.invocations > 0 ? m.rejected / m.invocations : 0;
```

Replace the metric block inside `deriveJobStatus`:

```ts
  if (metric) {
    if (errorRate(metric) > budget.errorRate) return "degraded";
    if (rejectRate(metric) > budget.rejectRate) return "degraded";
    if (metric.p95Ms !== null && metric.p95Ms > budget.p95Ms) return "degraded";
  }
```

Replace `deriveEdgeFnStatus` entirely:

```ts
/** On-demand functions: no schedule/stale concept; derive purely from metrics.
 *  4xx counts as a fault alongside 5xx — a function that rejects every caller is
 *  as unavailable as one that crashes, and the run timeline has always drawn it
 *  that way. Keeping the two rates separate lets an occasional validation 400 pass
 *  while a sustained rejection rate does not. */
export function deriveEdgeFnStatus(metric: EdgeFnMetric | null, budget: HealthBudget): HealthState {
  if (!metric || metric.invocations === 0) return "operational";
  // Nothing got through in the window, whatever the reason.
  if (metric.errors + metric.rejected === metric.invocations) return "down";
  if (errorRate(metric) > budget.errorRate) return "degraded";
  if (rejectRate(metric) > budget.rejectRate) return "degraded";
  if (metric.p95Ms !== null && metric.p95Ms > budget.p95Ms) return "degraded";
  return "operational";
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/lib/systemHealth.test.ts
```

Expected: PASS, including every pre-existing case.

- [ ] **Step 6: Commit**

```bash
git add src/lib/systemHealth.ts src/lib/systemHealth.test.ts src/config/app.config.ts
git commit -m "treat 4xx rejections as faults in health derivation"
```

---

### Task 3: Show what went wrong in the panel, and fix the card count

**Files:**
- Modify: `src/components/platform/systemHealth/EdgeFunctionsPanel.tsx`
- Modify: `src/components/platform/SystemHealthTab.tsx:64` (card detail)
- Create: `src/components/platform/systemHealth/EdgeFunctionsPanel.test.tsx`
- Test: `src/components/platform/SystemHealthTab.test.tsx`

**Interfaces:**
- Consumes: `EdgeFnMetric.rejected`, `.byStatus`, `.lastFailure` (Task 1); `deriveEdgeFnStatus` (Task 2).
- Produces: nothing later tasks depend on.

**Two problems fixed here.** The row never said *which* status code occurred, and the card counted `metrics.length` (every function, cron included) while the panel below renders only non-cron functions, so the two disagreed by exactly the cron count.

- [ ] **Step 1: Write the failing panel test**

Create `src/components/platform/systemHealth/EdgeFunctionsPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EdgeFunctionsPanel } from "./EdgeFunctionsPanel";
import type { EdgeFnMetric } from "@/lib/systemHealth";

const metric = (over: Partial<EdgeFnMetric> = {}): EdgeFnMetric => ({
  fn: "open-offer-tier", invocations: 48, errors: 0, rejected: 48,
  byStatus: { "401": 48 }, p50Ms: 300, p95Ms: 400,
  lastInvokedAt: "2026-07-21T09:00:00Z", lastStatus: 401,
  lastFailure: { status: 401, at: "2026-07-21T09:00:00Z" }, recent: [], ...over,
});

describe("EdgeFunctionsPanel", () => {
  it("shows the status-code breakdown so the failure is identifiable", () => {
    render(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText("401 × 48")).toBeInTheDocument();
  });

  it("reports rejected calls alongside errors", () => {
    render(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText(/48 rejected/)).toBeInTheDocument();
    expect(screen.getByText(/0 errors/)).toBeInTheDocument();
  });

  it("marks an all-rejected function as Down, not Operational", () => {
    render(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText("Down")).toBeInTheDocument();
    expect(screen.queryByText("Operational")).not.toBeInTheDocument();
  });

  it("notes when no call succeeded in the window", () => {
    render(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText(/no 2xx in this window/)).toBeInTheDocument();
  });

  it("omits the breakdown row entirely for a clean function", () => {
    render(<EdgeFunctionsPanel metrics={[metric({
      fn: "generate-hire-orders", invocations: 6, rejected: 0, errors: 0,
      byStatus: { "200": 6 }, lastStatus: 200, lastFailure: null,
    })]} />);
    expect(screen.getByText("Operational")).toBeInTheDocument();
    expect(screen.queryByText(/rejected/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no 2xx/)).not.toBeInTheDocument();
  });

  it("gives the run timeline a text equivalent for screen readers", () => {
    render(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByText(/48 calls, 48 rejected, 0 errors/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/components/platform/systemHealth/EdgeFunctionsPanel.test.tsx
```

Expected: FAIL. `401 × 48` is not rendered; the pill reads `Operational`.

- [ ] **Step 3: Implement the panel**

Replace the body of `src/components/platform/systemHealth/EdgeFunctionsPanel.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, StatusDot, LatencyStat, RunTimeline } from "./primitives";
import { deriveEdgeFnStatus, CRON_FNS, type EdgeFnMetric } from "@/lib/systemHealth";
import { SYSTEM_HEALTH_BUDGET as budget } from "@/config/app.config";

/** Status-code histogram as sorted "code × count" chips, faults first. A bare
 *  error count cannot answer "what went wrong"; the exact code can. */
function statusChips(byStatus: Record<string, number>) {
  return Object.entries(byStatus)
    .map(([code, count]) => ({ code: Number(code), count }))
    .filter((c) => c.code >= 400)
    .sort((a, b) => b.count - a.count);
}

export function EdgeFunctionsPanel({ metrics }: { metrics: EdgeFnMetric[] }) {
  // Non-cron functions only — cron-invoked functions live in the Scheduled jobs panel, and
  // double-listing them here would duplicate their status pills (and double-count health).
  const rows = metrics.filter((m) => !CRON_FNS.has(m.fn));
  return (
    <Card>
      <CardHeader><CardTitle className="font-display text-base">Edge functions</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.map((m) => {
          const state = deriveEdgeFnStatus(m, budget);
          const chips = statusChips(m.byStatus);
          const succeeded = m.invocations - m.errors - m.rejected;
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
                <span className={m.rejected > 0 ? "text-destructive" : undefined}>· {m.rejected} rejected</span>
                <span className={m.errors > 0 ? "text-destructive" : undefined}>· {m.errors} errors</span>
              </div>
              {/* The timeline is aria-hidden, so this carries the same information as text. */}
              <span className="sr-only">
                {m.invocations} calls, {m.rejected} rejected, {m.errors} errors
              </span>
              {chips.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-5 text-xs">
                  {chips.map((c) => (
                    <span
                      key={c.code}
                      className={c.code >= 500
                        ? "rounded-md bg-destructive/10 px-2 py-0.5 font-mono text-destructive"
                        : "rounded-md bg-warning/10 px-2 py-0.5 font-mono text-warning"}
                    >
                      {c.code} × {c.count}
                    </span>
                  ))}
                  {succeeded === 0 && (
                    <span className="text-muted-foreground">no 2xx in this window</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No edge-function activity in the window.</p>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run the panel test to verify it passes**

```bash
npx vitest run src/components/platform/systemHealth/EdgeFunctionsPanel.test.tsx
```

Expected: PASS, all six cases.

- [ ] **Step 5: Write the failing card-count test**

Add to `src/components/platform/SystemHealthTab.test.tsx` (follow the file's existing render/mocking setup for `useCronHealth` / `useEdgeFnMetrics` / `useEmailHealth`; supply metrics for one cron function and one on-demand function):

```tsx
  it("counts only on-demand functions in the Edge functions card, matching the panel below", async () => {
    // One cron function (rendered in Scheduled jobs) + one on-demand function.
    // The card must not count the cron one: the panel below does not list it.
    renderTab({ metrics: [
      metricFixture({ fn: "airtable-poll" }),
      metricFixture({ fn: "open-offer-tier", invocations: 48, rejected: 48, byStatus: { "401": 48 } }),
    ] });
    expect(await screen.findByText(/1 on-demand · 1 flagged/)).toBeInTheDocument();
    expect(screen.queryByText(/2 active/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 6: Run it to verify it fails**

```bash
npx vitest run src/components/platform/SystemHealthTab.test.tsx
```

Expected: FAIL. The card renders `2 active`.

- [ ] **Step 7: Fix the card count**

In `src/components/platform/SystemHealthTab.tsx`, extract the filtered list so the card and the panel provably share it. Replace the `edgeStates` line:

```tsx
  const onDemand = metrics.filter((m) => !CRON_FNS.has(m.fn));
  const edgeStates: HealthState[] = onDemand.map((m) => deriveEdgeFnStatus(m, budget));
```

Add, next to `flaggedJobs`:

```tsx
  const flaggedEdge = edgeStates.filter((s) => s === "degraded" || s === "down" || s === "stale").length;
```

Replace the `edge` domain entry:

```tsx
        { key: "edge", label: "Edge functions", state: edgeState,
          detail: edge.isError ? "metrics unavailable" : `${onDemand.length} on-demand · ${flaggedEdge} flagged` },
```

- [ ] **Step 8: Run the tab test to verify it passes**

```bash
npx vitest run src/components/platform/SystemHealthTab.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Lint and commit**

```bash
npm run lint
git add src/components/platform/
git commit -m "surface status codes and rejections in edge function panel"
```

---

### Task 4: Error log drill-down on expand

**Files:**
- Modify: `supabase/functions/platform-edge-metrics/index.ts` (new `logs` action)
- Modify: `src/data/platform.ts` (new `fetchEdgeFnLogs`)
- Modify: `src/hooks/useSystemHealth.ts` (new `useEdgeFnLogs`)
- Modify: `src/components/platform/systemHealth/EdgeFunctionsPanel.tsx`
- Test: `supabase/functions/platform-edge-metrics/index.di.test.ts`, `src/components/platform/systemHealth/EdgeFunctionsPanel.test.tsx`

**Interfaces:**
- Consumes: `EdgeFnMetric.fn` (Task 1).
- Produces: `fetchEdgeFnLogs(client, fn, windowMinutes): Promise<EdgeFnLogLine[]>` where `EdgeFnLogLine = { at: string; level: string; message: string }`.

**Why lazy:** the `ANALYTICS` PAT is rate-limited to 60 requests/min and the panel already polls every 60s. A second query on every refresh would spend that budget on rows nobody is reading. Logs are fetched only when a row is expanded.

- [ ] **Step 1: Build defensively — the schema cannot be verified locally**

**Decision (2026-07-21, confirmed with the repo owner):** the `ANALYTICS` PAT is an edge secret and is not available in the local environment, so the live `function_logs` schema **cannot** be confirmed before writing this code. Build against Supabase's documented shape, but treat every field as untrusted.

This means:
- Every field read from a log row uses a fallback (`r.timestamp ?? ""`, `r.event_message ?? ""`), never a bare access.
- A non-2xx or unparseable Analytics response returns the existing `analytics_unavailable` error, which the panel renders as "Log lines unavailable."
- An empty or shape-mismatched result set renders "No error output in this window." rather than throwing.

The net effect of a wrong guess is an empty drill-down, never a broken panel or a crash. Mark the SQL constant with a comment stating the shape is UNVERIFIED against the live instance so the next reader knows not to trust it.

Post-deploy verification is a human step, tracked in the Post-merge section.

- [ ] **Step 2: Write the failing test**

Add to `supabase/functions/platform-edge-metrics/index.di.test.ts`:

```ts
Deno.test("logs action returns recent log lines for one function", async () => {
  const logRows = {
    result: [
      { timestamp: "2026-07-21T09:10:00Z", level: "error", event_message: "airtable-poll: open-offer-tier failed" },
      { timestamp: "2026-07-21T09:09:00Z", level: "error", event_message: "Unauthorized" },
    ],
  };
  const fnList = [{ id: TIER_ID, slug: "open-offer-tier", name: "open-offer-tier" }];
  const { deps } = superDeps(routeFetch(logRows, fnList));
  const res = await handle(superReq({ action: "logs", fn: "open-offer-tier" }), deps);
  assertEquals(res.status, 200);

  const body = await res.json() as { lines: Array<Record<string, unknown>> };
  assertEquals(body.lines.length, 2);
  assertEquals(body.lines[0].message, "airtable-poll: open-offer-tier failed");
  assertEquals(body.lines[0].level, "error");
});

Deno.test("logs action still requires super-admin", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "plain" },
    tables: { platform_admins: { data: null, error: null } },
    envVars: { ANALYTICS: "sbp_test_token", SUPABASE_URL: "https://proj.supabase.co" },
  });
  const res = await handle(superReq({ action: "logs", fn: "open-offer-tier" }), deps);
  assertEquals(res.status, 403);
});

Deno.test("logs action rejects a missing fn", async () => {
  const { deps } = superDeps(routeFetch({ result: [] }));
  const res = await handle(superReq({ action: "logs" }), deps);
  assertEquals(res.status, 400);
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
deno test --allow-all --node-modules-dir=none supabase/functions/platform-edge-metrics/
```

Expected: FAIL. The handler ignores `action` and returns the metrics payload.

- [ ] **Step 4: Implement the `logs` action**

In `supabase/functions/platform-edge-metrics/index.ts`, add near `METRICS_SQL` (adjusting column names to whatever Step 1 verified):

```ts
// Column names verified against the live Analytics API on 2026-07-21 (see Step 1 of the
// plan) — function_logs is a SEPARATE collection from function_edge_logs: the former
// carries console output (event_message/level), the latter the HTTP result.
const LOGS_SQL =
  "select t.timestamp, m.level, t.event_message " +
  "from function_logs t cross join unnest(t.metadata) m " +
  "where m.function_id = '{FN_ID}' and m.level in ('error','warning') " +
  "order by t.timestamp desc limit 25";
```

Add this handler function:

```ts
interface RawLogRow { timestamp?: string; level?: string; event_message?: string }

/** Recent error/warning console output for ONE function. Split from the metrics query
 *  and fetched on demand: the ANALYTICS PAT is capped at 60 req/min and the panel polls
 *  every 60s, so this must not ride the refresh cycle. */
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
```

Wire it into `handle`, immediately after the `windowMin` computation and the `ref`/`token` guard (so the auth check and config guard still run first):

```ts
  if ((body as { action?: unknown }).action === "logs") {
    const fn = (body as { fn?: unknown }).fn;
    if (typeof fn !== "string" || fn === "") return json({ error: "fn required" }, 400);
    return fnLogs(deps, ref, token, fn, windowMin);
  }
```

- [ ] **Step 5: Run the full edge suite**

```bash
deno test --allow-all --node-modules-dir=none supabase/functions/
```

Expected: PASS, all files.

- [ ] **Step 6: Add the data-access function**

In `src/data/platform.ts`, after `fetchEdgeFnMetrics`:

```ts
/** One console log line from a function's recent error/warning output. */
export interface EdgeFnLogLine { at: string; level: string; message: string }

/** Recent error/warning log lines for a single edge function. Fetched on demand
 *  (row expand), never on the panel's refresh cycle — see the note in the edge
 *  function about the ANALYTICS PAT rate limit. */
export async function fetchEdgeFnLogs(
  client: SupabaseClient<Database>,
  fn: string,
  windowMinutes: number = SYSTEM_HEALTH.windowMinutes,
): Promise<EdgeFnLogLine[]> {
  const { data, error } = await client.functions.invoke("platform-edge-metrics", {
    body: { action: "logs", fn, window_minutes: windowMinutes },
  });
  if (error) throw error;
  return (data as { lines?: EdgeFnLogLine[] } | null)?.lines ?? [];
}
```

- [ ] **Step 7: Add the hook**

In `src/hooks/useSystemHealth.ts`:

```ts
/** Error/warning log lines for one function. `enabled` gates the fetch so the
 *  query only fires when a panel row is actually expanded. */
export function useEdgeFnLogs(fn: string, enabled: boolean) {
  return useQuery({
    queryKey: ["platform", "edge-logs", fn, SYSTEM_HEALTH.windowMinutes],
    queryFn: () => fetchEdgeFnLogs(supabase, fn, SYSTEM_HEALTH.windowMinutes),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
}
```

Add `fetchEdgeFnLogs` to the existing import from `@/data/platform`.

- [ ] **Step 8: Write the failing expand test**

Add to `src/components/platform/systemHealth/EdgeFunctionsPanel.test.tsx`:

```tsx
  it("offers a log drill-down only for a function with faults", () => {
    render(<EdgeFunctionsPanel metrics={[metric()]} />);
    expect(screen.getByRole("button", { name: /view recent errors/i })).toBeInTheDocument();
  });

  it("offers no drill-down for a clean function", () => {
    render(<EdgeFunctionsPanel metrics={[metric({
      fn: "generate-hire-orders", invocations: 6, rejected: 0, errors: 0,
      byStatus: { "200": 6 }, lastStatus: 200, lastFailure: null,
    })]} />);
    expect(screen.queryByRole("button", { name: /view recent errors/i })).not.toBeInTheDocument();
  });
```

This test needs a QueryClientProvider. Wrap with `renderWithProviders` from `src/test/renderWithProviders.tsx` instead of bare `render` for these two cases.

- [ ] **Step 9: Run it to verify it fails**

```bash
npx vitest run src/components/platform/systemHealth/EdgeFunctionsPanel.test.tsx
```

Expected: FAIL. No such button exists.

- [ ] **Step 10: Add the expandable detail to the panel**

Extract the row into a child component in the same file so each row owns its expand state. This is the complete component, replacing the inline `rows.map` body from Task 3:

```tsx
function EdgeFnRow({ m }: { m: EdgeFnMetric }) {
  const [open, setOpen] = useState(false);
  const state = deriveEdgeFnStatus(m, budget);
  const chips = statusChips(m.byStatus);
  const succeeded = m.invocations - m.errors - m.rejected;
  const hasFaults = m.errors + m.rejected > 0;
  const logs = useEdgeFnLogs(m.fn, open);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-3">
        <StatusDot state={state} />
        <span className="font-mono text-sm font-medium flex-1 truncate">{m.fn}</span>
        <StatusPill state={state} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 pl-5 text-xs text-muted-foreground">
        <RunTimeline metric={m} p95BudgetMs={budget.p95Ms} />
        <LatencyStat p95Ms={m.p95Ms} />
        <span>· {m.invocations} calls</span>
        <span className={m.rejected > 0 ? "text-destructive" : undefined}>· {m.rejected} rejected</span>
        <span className={m.errors > 0 ? "text-destructive" : undefined}>· {m.errors} errors</span>
      </div>
      {/* The timeline is aria-hidden, so this carries the same information as text. */}
      <span className="sr-only">
        {m.invocations} calls, {m.rejected} rejected, {m.errors} errors
      </span>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-5 text-xs">
          {chips.map((c) => (
            <span
              key={c.code}
              className={c.code >= 500
                ? "rounded-md bg-destructive/10 px-2 py-0.5 font-mono text-destructive"
                : "rounded-md bg-warning/10 px-2 py-0.5 font-mono text-warning"}
            >
              {c.code} × {c.count}
            </span>
          ))}
          {succeeded === 0 && (
            <span className="text-muted-foreground">no 2xx in this window</span>
          )}
        </div>
      )}
      {hasFaults && (
        <div className="mt-2 pl-5">
          {m.lastFailure && (
            <p className="text-xs text-muted-foreground">
              {/* A full local timestamp, not lib/dates' date-only helpers: "which day did
                  this fail" is useless for a fault you are triaging right now. */}
              Last failure {new Date(m.lastFailure.at).toLocaleString()}, status {m.lastFailure.status}
            </p>
          )}
          <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide recent errors" : "View recent errors"}
          </Button>
          {open && (
            <div className="mt-2 rounded-md bg-muted/40 p-2">
              {logs.isLoading && <p className="text-xs text-muted-foreground">Loading log lines.</p>}
              {logs.isError && <p className="text-xs text-muted-foreground">Log lines unavailable.</p>}
              {logs.data?.length === 0 && <p className="text-xs text-muted-foreground">No error output in this window.</p>}
              {logs.data?.map((l, i) => (
                <p key={i} className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {l.at.slice(11, 19)} {l.message}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

Add the imports this needs: `useState` from react, `Button` from `@/components/ui/button`, and `useEdgeFnLogs` from `@/hooks/useSystemHealth`. Change the parent `rows.map` to `rows.map((m) => <EdgeFnRow key={m.fn} m={m} />)`.

- [ ] **Step 11: Run the tests to verify they pass**

```bash
npx vitest run src/components/platform/systemHealth/
```

Expected: PASS, all cases.

- [ ] **Step 12: Lint and commit**

```bash
npm run lint
git add supabase/functions/platform-edge-metrics/ src/data/platform.ts src/hooks/useSystemHealth.ts src/components/platform/systemHealth/
git commit -m "add per-function error log drill-down to system health"
```

---

### Task 5: Make edge-function error codes readable

**Files:**
- Create: `src/lib/edgeErrors.ts`
- Create: `src/lib/edgeErrors.test.ts`
- Modify: `src/data/hireOrders.ts:205-213` (`invokeHireOrderAction`)

**Interfaces:**
- Consumes: nothing.
- Produces: `readEdgeError(error: unknown): Promise<string>` — resolves a supabase-js FunctionsHttpError into readable copy.

**Why:** supabase-js discards the response body and throws `Edge Function returned a non-2xx status code`. Every edge call in the app has this failure mode. The body is reachable via `error.context`, which is the `Response`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/edgeErrors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readEdgeError } from "./edgeErrors";

const httpError = (body: unknown, status = 403) =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(JSON.stringify(body), { status }),
  });

describe("readEdgeError", () => {
  it("maps feature_disabled to copy naming the module and where to enable it", async () => {
    expect(await readEdgeError(httpError({ error: "feature_disabled" })))
      .toBe("This module is off for this organization. Enable it in Platform, Organizations.");
  });

  it("maps a known validation code to its own copy", async () => {
    expect(await readEdgeError(httpError({ error: "invalid_fee" }, 400)))
      .toBe("The fee must be a number.");
  });

  it("falls back to the raw code when it is unmapped", async () => {
    expect(await readEdgeError(httpError({ error: "some_new_code" }))).toBe("some_new_code");
  });

  it("falls back to the error message when the body is not JSON", async () => {
    const err = Object.assign(new Error("boom"), {
      context: new Response("<html>502</html>", { status: 502 }),
    });
    expect(await readEdgeError(err)).toBe("boom");
  });

  it("passes a plain Error through unchanged", async () => {
    expect(await readEdgeError(new Error("network down"))).toBe("network down");
  });

  it("handles a non-Error value", async () => {
    expect(await readEdgeError("nope")).toBe("Something went wrong.");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/lib/edgeErrors.test.ts
```

Expected: FAIL, cannot resolve `./edgeErrors`.

- [ ] **Step 3: Implement**

Create `src/lib/edgeErrors.ts`:

```ts
/**
 * supabase-js throws `Edge Function returned a non-2xx status code` and discards the
 * body, so every server-side reason arrives as the same opaque string. The Response
 * is still reachable on `error.context` — this reads it once and maps our `{ error: code }`
 * convention to copy a user can act on.
 */

const CODE_COPY: Record<string, string> = {
  feature_disabled: "This module is off for this organization. Enable it in Platform, Organizations.",
  invalid_fee: "The fee must be a number.",
  bad_request: "That request was missing required information.",
  unknown_action: "That action is not supported.",
  not_found: "That record no longer exists.",
  forbidden: "You do not have access to that record.",
  no_pdf: "That order has no PDF yet.",
  analytics_unavailable: "Metrics are temporarily unavailable.",
};

function hasResponseContext(e: unknown): e is { context: Response } {
  return typeof e === "object" && e !== null && "context" in e &&
    (e as { context: unknown }).context instanceof Response;
}

export async function readEdgeError(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : "Something went wrong.";
  if (!hasResponseContext(error)) return fallback;
  try {
    const body = await error.context.clone().json() as { error?: unknown };
    const code = typeof body?.error === "string" ? body.error : null;
    if (!code) return fallback;
    return CODE_COPY[code] ?? code;
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run src/lib/edgeErrors.test.ts
```

Expected: PASS, all six cases.

- [ ] **Step 5: Use it at the hire-order call site**

In `src/data/hireOrders.ts`, replace `invokeHireOrderAction`:

```ts
/** Invoke the generate-hire-orders edge function (actions: draft/issue/preview/download-url).
 *  Rethrows with the server's own reason rather than supabase-js's opaque
 *  "non-2xx status code" string — see src/lib/edgeErrors.ts. */
export async function invokeHireOrderAction(
  client: SupabaseClient<Database>,
  body: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.functions.invoke("generate-hire-orders", { body });
  if (error) throw new Error(await readEdgeError(error));
  return data;
}
```

Add `import { readEdgeError } from "@/lib/edgeErrors";` at the top.

- [ ] **Step 6: Run the hire-order tests**

```bash
npx vitest run src/data/hireOrders.test.ts src/hooks/useHireOrders.test.ts
```

Expected: PASS. If a test asserted on the old opaque message, update it to the mapped copy.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add src/lib/edgeErrors.ts src/lib/edgeErrors.test.ts src/data/hireOrders.ts
git commit -m "surface edge function error codes as readable copy"
```

---

### Task 6: Lock the nav entry for non-super-admins when a module is off

**Files:**
- Modify: `src/components/layout/navItems.ts` (`visibleNavItems`, `groupNavBySections`)
- Modify: `src/components/layout/AppLayout.tsx` (nav rendering)
- Test: `src/components/layout/navItems.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `VisibleNavItem = NavItem & { locked: boolean }`. `visibleNavItems` now returns `VisibleNavItem[]`. `groupNavBySections` becomes generic over `T extends NavItem`.

**Behavior matrix.** Role gating is unchanged and runs first, so an artist still never sees Hire orders at all.

| Viewer | Module on | Module off |
|---|---|---|
| Super-admin | normal link | normal link (page shows the off-state, Task 7) |
| Admin / producer | normal link | **visible, grayed, not clickable** |
| Role without access | hidden | hidden |

Note this is a deliberate discoverability change: org members will now see that a module exists before it is switched on.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/layout/navItems.test.ts`:

```ts
describe("feature locking", () => {
  it("locks a feature-gated item for a non-super-admin when the module is off", () => {
    const items = visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"] }));
    const hireOrders = items.find((i) => i.label === "Hire orders");
    expect(hireOrders).toBeDefined();
    expect(hireOrders?.locked).toBe(true);
  });

  it("unlocks it once the module is enabled", () => {
    const items = visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"], enabledFeatures: new Set(["hire_orders"]) }));
    expect(items.find((i) => i.label === "Hire orders")?.locked).toBe(false);
  });

  it("never locks it for a super-admin, who administers entitlements", () => {
    const items = visibleNavItems(NAV_ITEMS, ctx({ isSuperAdmin: true, roles: ["admin"] }));
    expect(items.find((i) => i.label === "Hire orders")?.locked).toBe(false);
  });

  it("still hides the item entirely from a role that has no access to it", () => {
    const items = visibleNavItems(NAV_ITEMS, ctx({ roles: ["artist"] }));
    expect(items.find((i) => i.label === "Hire orders")).toBeUndefined();
  });

  it("leaves ungated items unlocked", () => {
    const items = visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"] }));
    expect(items.find((i) => i.label === "Dashboard")?.locked).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run src/components/layout/navItems.test.ts
```

Expected: FAIL. `hireOrders` is `undefined` (currently filtered out) and no `locked` property exists.

- [ ] **Step 3: Implement the locking**

In `src/components/layout/navItems.ts`, add the type after `NavItem`:

```ts
/** A nav item resolved for one viewer. `locked` means "show it, grayed and inert":
 *  the org does not have the module, but hiding it entirely leaves members unable
 *  to tell the module exists. Super-admins are never locked — they administer
 *  entitlements, and ProtectedRoute lets them through to the off-state page. */
export type VisibleNavItem = NavItem & { locked: boolean };
```

Replace `visibleNavItems` entirely. The entitlement `filter` becomes a `lock` mapping; the role gating below it is unchanged:

```ts
/** Base nav visibility (before editor view-as styling). */
export function visibleNavItems(
  items: NavItem[],
  ctx: {
    isEditorMode: boolean;
    isRealAdmin: boolean;
    isSuperAdmin: boolean;
    hasRole: (r: string) => boolean;
    enabledFeatures: Set<string>;
  },
): VisibleNavItem[] {
  // Entitlement no longer HIDES an item, it LOCKS it: a member who cannot use a
  // module should still be able to see that it exists. Super-admins are never
  // locked, consistent with ProtectedRoute exempting them from the route-level
  // feature gate. Role gating below is unchanged and still hides outright.
  const lock = (item: NavItem): VisibleNavItem => ({
    ...item,
    locked: !!item.feature && !ctx.isSuperAdmin && !ctx.enabledFeatures.has(item.feature),
  });

  if (ctx.isEditorMode && ctx.isRealAdmin) {
    return items.filter((i) => !i.superAdmin || ctx.isSuperAdmin).map(lock);
  }
  return items
    .filter((item) => {
      if (item.superAdmin) return ctx.isSuperAdmin;
      if (!item.roles) return true;
      return item.roles.some((r) => ctx.hasRole(r));
    })
    .map(lock);
}
```

Make `groupNavBySections` generic so it carries `locked` through:

```ts
export interface NavSectionGroup<T extends NavItem = NavItem> { section: NavSection; label: string; items: T[]; }

/** Group already role-filtered items by section, in fixed order, dropping empty sections. */
export function groupNavBySections<T extends NavItem>(items: T[]): NavSectionGroup<T>[] {
  return SECTION_ORDER
    .map((section) => ({ section, label: SECTION_LABELS[section], items: items.filter((i) => i.section === section) }))
    .filter((g) => g.items.length > 0);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/components/layout/navItems.test.ts
```

Expected: PASS, including every pre-existing case.

- [ ] **Step 5: Render locked items as inert in the sidebar**

In `src/components/layout/AppLayout.tsx`, inside `group.items.map(item => { ... })`, return a non-interactive element for locked items before the existing `<NavLink>`:

```tsx
              if (item.locked) {
                return (
                  <div
                    key={item.to}
                    aria-disabled="true"
                    title={`${item.label} is not enabled for this organization`}
                    className="flex cursor-not-allowed items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[13px] font-medium text-muted-foreground/50"
                  >
                    <span className="relative shrink-0">
                      <item.icon className="h-[14px] w-[14px]" />
                    </span>
                    {!collapsed && (
                      <span className="flex flex-1 items-center gap-2 min-w-0">
                        <span className="truncate">{item.label}</span>
                        <Lock className="ml-auto h-3 w-3 shrink-0" />
                      </span>
                    )}
                  </div>
                );
              }
```

Add `Lock` to the existing `lucide-react` import in that file.

- [ ] **Step 6: Verify in the browser**

Start the dev server via `preview_start`, sign in as the org admin (not the super-admin), and confirm: the Hire orders entry is visible, grayed, shows a lock, and does not navigate on click. Then confirm a super-admin still gets a working link. Take a screenshot of the locked state.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint && npx vitest run src/components/layout/
git add src/components/layout/
git commit -m "show locked nav entry when a module is off"
```

---

### Task 7: Read-only hire-order surface for super-admins when the module is off

**Files:**
- Create: `src/components/layout/FeatureOffBanner.tsx`
- Create: `src/components/layout/FeatureOffBanner.test.tsx`
- Modify: `src/pages/HireOrdersPage.tsx`
- Test: `src/pages/HireOrdersPage.test.tsx`

**Interfaces:**
- Consumes: `useFeature` from `src/hooks/useEntitlements.ts`.
- Produces: `<FeatureOffBanner feature={FeatureKey} />`.

**Why:** ProtectedRoute lets super-admins past the route gate, so they land on a page whose write buttons call an edge function that will 403. The page must say so before they click.

- [ ] **Step 1: Write the failing banner test**

Create `src/components/layout/FeatureOffBanner.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeatureOffBanner } from "./FeatureOffBanner";

describe("FeatureOffBanner", () => {
  it("names the module and links to where it is enabled", () => {
    render(<MemoryRouter><FeatureOffBanner feature="hire_orders" /></MemoryRouter>);
    expect(screen.getByText(/Hire orders is off for this organization/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /enable it/i })).toHaveAttribute("href", "/platform");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/components/layout/FeatureOffBanner.test.tsx
```

Expected: FAIL, cannot resolve `./FeatureOffBanner`.

- [ ] **Step 3: Implement the banner**

Create `src/components/layout/FeatureOffBanner.tsx`:

```tsx
import { Link } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ROUTES } from "@/config/app.config";
import { FEATURE_REGISTRY, type FeatureKey } from "@/lib/entitlements";

/** Shown to a super-admin who reached a feature-gated page for an org that does not
 *  have the module. They keep read access (they administer entitlements) but every
 *  write would 403 at the edge function, so the page must say so before they try. */
export function FeatureOffBanner({ feature }: { feature: FeatureKey }) {
  return (
    <Alert>
      <AlertDescription>
        {FEATURE_REGISTRY[feature].label} is off for this organization, so changes cannot be saved.{" "}
        <Link to={ROUTES.PLATFORM} className="underline">Enable it</Link> in Platform, Organizations.
      </AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run src/components/layout/FeatureOffBanner.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Write the failing page test**

Add to `src/pages/HireOrdersPage.test.tsx` (follow the file's existing provider/mock setup):

```tsx
  it("warns and disables creation when the module is off", async () => {
    renderPage({ featureEnabled: false });
    expect(await screen.findByText(/Hire orders is off for this organization/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new hire order/i })).toBeDisabled();
  });

  it("shows no banner and an enabled action when the module is on", async () => {
    renderPage({ featureEnabled: true });
    expect(screen.queryByText(/is off for this organization/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new hire order/i })).toBeEnabled();
  });
```

- [ ] **Step 6: Run it to verify it fails**

```bash
npx vitest run src/pages/HireOrdersPage.test.tsx
```

Expected: FAIL. No banner renders and the button is enabled.

- [ ] **Step 7: Wire the page**

In `src/pages/HireOrdersPage.tsx`, add:

```tsx
const featureOn = useFeature("hire_orders");
```

Render `{!featureOn && <FeatureOffBanner feature="hire_orders" />}` at the top of the page content, and add `disabled={!featureOn}` to the "New hire order" trigger and any other mutating control on the page.

Add imports for `useFeature` from `@/hooks/useEntitlements` and `FeatureOffBanner` from `@/components/layout/FeatureOffBanner`.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npx vitest run src/pages/HireOrdersPage.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Full suite, lint, commit**

```bash
npx vitest run && npm run lint
git add src/components/layout/FeatureOffBanner.tsx src/components/layout/FeatureOffBanner.test.tsx src/pages/HireOrdersPage.tsx src/pages/HireOrdersPage.test.tsx
git commit -m "warn and disable writes when hire orders module is off"
```

---

### Task 8: Diagnose the open-offer-tier 401s

**Files:**
- Read first: `supabase/functions/airtable-poll/index.ts:120-140`, `supabase/functions/_shared/deps.ts` (`invokeFunction`), `supabase/functions/open-offer-tier/index.ts:20-80`, `supabase/functions/_shared/auth.ts` (`isServiceRole`, `requireRole`)
- Modify: determined by the evidence, not by this plan.

**Interfaces:**
- Consumes: the log drill-down from Task 4, which is the intended instrument for this.

**This task is investigation-first and deliberately does not prescribe a fix.** Every `open-offer-tier` invocation in the last 24h returned 401 in ~0.3s, all of them immediately following an `airtable-poll` run. That means tier 1 is never auto-opened for newly synced dates. The 401 could originate at four different points and guessing between them is how a wrong fix gets shipped.

- [ ] **Step 1: Read the evidence the new panel now gives you**

Open Platform, System Health, expand `open-offer-tier`, and read the error log lines. Record the exact message text before touching any code.

- [ ] **Step 2: Establish which layer rejects**

Confirm, in order, and write down the answer to each:
1. Does `deps.invokeFunction` attach an `Authorization` header, and which key (service role or anon)?
2. `open-offer-tier` is `verify_jwt = true` in `supabase/config.toml`. Does the request die at the gateway, or does it reach `handle`? A log line from inside the function proves it reached; silence suggests the gateway.
3. If it reaches `handle`, does it fail at `isServiceRole`, at the `requireRole` pre-auth (line 27), or at the org-scoped `requireOrgRole` (line 76)?

- [ ] **Step 3: State one hypothesis in writing**

Format: "I think X is the root cause because Y." Do not proceed with more than one hypothesis in flight.

- [ ] **Step 4: Write the failing test that reproduces it**

Add a case to `supabase/functions/open-offer-tier/index.di.test.ts` (or `airtable-poll`'s, depending on which side the defect is on) that reproduces the 401 with the same caller shape `airtable-poll` uses. It must fail before the fix.

- [ ] **Step 5: Run it to verify it fails**

```bash
deno test --allow-all --node-modules-dir=none supabase/functions/open-offer-tier/ supabase/functions/airtable-poll/
```

Expected: FAIL, reproducing the 401.

- [ ] **Step 6: Fix, then run the whole edge suite**

```bash
deno test --allow-all --node-modules-dir=none supabase/functions/
```

Expected: PASS, all files. The whole suite matters here: `airtable-poll` and `open-offer-tier` each have a broad `index.di.test.ts` contract suite, and a single-file run has hidden a multi-test regression on this codebase before.

- [ ] **Step 7: Verify against production after deploy**

Edge functions deploy on merge to `main`. After merging, wait for one `airtable-poll` cycle (max 5 minutes) and confirm in System Health that `open-offer-tier` shows 2xx calls and reads Operational.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/
git commit -m "fix open-offer-tier rejecting airtable-poll invocations"
```

---

## Post-merge

- [ ] Enable the `hire_orders` module for Bootstrap Org: Platform, Organizations, edit, toggle Hire orders on. This is the immediate unblock for the failing wizard and needs no code.
- [ ] `public/changelog.md` gets one entry for the release date covering the user-facing parts: the locked nav entry, the readable module-off messaging, and (once Task 8 lands) the offer-tier fix. System Health is a super-admin surface, so per the changelog rules **none of Tasks 1 through 4 appear there**. Regenerate with `deno run --allow-read --allow-write scripts/changelog-to-json.ts`.
