# System Health Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explain every non-operational System Health state and make scheduled-job incident history readable in the Platform console.

**Architecture:** Keep `deriveJobStatus` and `deriveEdgeFnStatus` as the status authority, adding pure companion explanation helpers that use their precedence. Explicitly map the cron RPC's existing JSON history and render it in an accessible expansion below each scheduled job. Retain the Analytics log drill-down as best-effort, but include its returned error text in the UI.

**Tech Stack:** React 18, TypeScript, TanStack Query, Vitest, Testing Library, Supabase.

## Global Constraints

- Follow `CLAUDE.md`: tests import real modules; data access stays in `src/data`; do not edit migrations or generated Supabase types.
- Use red-green TDD for every behavior change.
- Do not imply an Edge Function response body exists when the monitoring data only contains a status or transport error.
- Do not change the unverified production Analytics SQL without live-schema evidence.

---

### Task 1: Pure non-operational status explanations

**Files:**
- Modify: `src/lib/systemHealth.ts`
- Modify: `src/lib/systemHealth.test.ts`

**Interfaces:**
- Consumes: `CronStatus`, `EdgeFnMetric`, and `HealthBudget`.
- Produces: `describeJobHealth(cron, metric, budget): string | null` and `describeEdgeFnHealth(metric, budget): string | null`.

- [x] **Step 1: Write failing explanation tests**

Add tests that expect:

```ts
expect(describeJobHealth("healthy", metric({ p95Ms: 15_000 }), BUDGET))
  .toBe("p95 latency 15.0s exceeds the 12.0s budget");
expect(describeJobHealth("failing", metric(), BUDGET))
  .toBe("The latest scheduled run failed");
expect(describeEdgeFnHealth(metric({ invocations: 10, rejected: 3 }), BUDGET))
  .toBe("4xx rejection rate 30.0% exceeds the 20.0% budget");
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/lib/systemHealth.test.ts`

Expected: FAIL because the two explanation helpers are not exported.

- [x] **Step 3: Implement the minimal explanation helpers**

Add a private formatter:

```ts
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
```

Then implement helpers with the status derivation's precedence: stale, failing/down, pending, all failed/rejected, elevated 5xx rate, elevated 4xx rate, and p95 budget. Return `null` when operational.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run src/lib/systemHealth.test.ts`

Expected: PASS.

---

### Task 2: Scheduled-job reason and failure-history rendering

**Files:**
- Modify: `src/data/platform.ts`
- Modify: `src/components/platform/systemHealth/ScheduledJobsPanel.tsx`
- Modify: `src/components/platform/systemHealth/ScheduledJobsPanel.test.tsx`

**Interfaces:**
- Consumes: `describeJobHealth` and `CronHealthRow.recent_failures`.
- Produces: `CronFailure` with `status_code`, `error`, and `observed_at`; an accessible `Failure history` disclosure when one or more entries exist.

- [x] **Step 1: Write failing component tests**

Extend the cron fixture with:

```ts
recent_failures: [{
  status_code: 504,
  error: "timed out",
  observed_at: "2026-07-23T10:00:00Z",
}],
```

Assert the panel renders `p95 latency 18.0s exceeds the 12.0s budget`, a `Failure history` control, and—after clicking it—`504` and `timed out`.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/components/platform/systemHealth/ScheduledJobsPanel.test.tsx`

Expected: FAIL because neither reason copy nor failure history is rendered.


- [x] **Step 3: Implement explicit mapping and UI**

Add this exported type in `src/data/platform.ts` and use it in `CronHealthRow`:

```ts
export interface CronFailure {
  status_code: number | null;
  error: string | null;
  observed_at: string;
}
```

Replace `fetchCronHealth`'s bare result cast with an explicit map from `Record<string, unknown>`, including a `recentFailures` array that maps `recent_failures`. Rename the public row field to `recentFailures` so UI code never depends on unvalidated RPC JSON:

```ts
return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
  job_name: String(row.job_name),
  schedule: (row.schedule as string | null | undefined) ?? null,
  status: row.status as CronHealthRow["status"],
  last_status_code: typeof row.last_status_code === "number" ? row.last_status_code : null,
  last_ok_at: (row.last_ok_at as string | null | undefined) ?? null,
  last_error: (row.last_error as string | null | undefined) ?? null,
  consecutive_failures: Number(row.consecutive_failures ?? 0),
  last_run_at: (row.last_run_at as string | null | undefined) ?? null,
  recentFailures: Array.isArray(row.recent_failures) ? row.recent_failures as CronFailure[] : [],
}));
```

In `ScheduledJobsPanel`, call `describeJobHealth`, render its non-null copy below the existing schedule details, and use native `<details><summary>Failure history</summary>…</details>` to list each timestamp, status (`HTTP ${status_code}` when non-null), and stored error text.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run src/components/platform/systemHealth/ScheduledJobsPanel.test.tsx`

Expected: PASS.

---

### Task 3: On-demand reason copy and useful log-fetch failure state

**Files:**
- Modify: `src/components/platform/systemHealth/EdgeFunctionsPanel.tsx`
- Modify: `src/components/platform/systemHealth/EdgeFunctionsPanel.test.tsx`

**Interfaces:**
- Consumes: `describeEdgeFnHealth` and the existing `useEdgeFnLogs` query result.
- Produces: reason copy for non-operational function rows and an expanded drill-down that displays the query error message when the Analytics request fails.

- [x] **Step 1: Write failing UI tests**

Add a metric with `invocations: 10`, `errors: 2`, and assert the panel renders `5xx error rate 20.0% exceeds the 5.0% budget`. Add an interaction test that clicks `View recent errors` and verifies the detail region opens with its loading state.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/components/platform/systemHealth/EdgeFunctionsPanel.test.tsx`

Expected: FAIL because no explanation is rendered and the expanded state is not asserted by existing tests.

- [x] **Step 3: Implement minimal rendering**

Import and call `describeEdgeFnHealth`. Render the returned reason after the summary. Replace the generic error-state copy with `Log lines unavailable: ${(logs.error as Error).message}` while retaining a safe fallback when the error is not an `Error`.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run src/components/platform/systemHealth/EdgeFunctionsPanel.test.tsx`

Expected: PASS.

---

### Task 4: Full verification and publish

**Files:**
- Modify: files from Tasks 1–3 and both health documentation files only.

- [x] **Step 1: Run focused health tests**

Run: `npx vitest run src/lib/systemHealth.test.ts src/components/platform/systemHealth/ScheduledJobsPanel.test.tsx src/components/platform/systemHealth/EdgeFunctionsPanel.test.tsx`

Expected: PASS.

- [x] **Step 2: Run repository verification**

Run: `npm test && npm run lint && npm run build`

Expected: all commands exit 0.

- [x] **Step 3: Review the diff**

Run: `git diff --check origin/main...HEAD && git diff --stat origin/main...HEAD`

Expected: only scoped health-observability code, tests, and documentation.

- [x] **Step 4: Commit and open a draft pull request**

```bash
git add src/lib/systemHealth.ts src/lib/systemHealth.test.ts src/data/platform.ts \
  src/components/platform/systemHealth/ docs/superpowers/specs/ \
  docs/superpowers/plans/
git commit -m "explain system health degradation"
git push -u origin codex/health-observability
```

Create a draft PR against `main` with the root cause, changes, and verification evidence.

## Plan Review

- **Spec coverage:** Task 1 explains all status types; Task 2 exposes scheduled history; Task 3 improves on-demand visibility without modifying the unverified Analytics SQL; Task 4 verifies and publishes.
- **Placeholder scan:** no placeholders or deferred implementation instructions remain.
- **Type consistency:** both panels consume the same `HealthBudget`/metric types and the cron history type matches `get_cron_health`'s JSON object shape.
