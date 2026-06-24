# Platform System Health console — Phase 1 (Scheduled jobs + Edge functions) — design

**Status:** Draft for review (brainstorming complete; direction + mockup approved in session)
**Date:** 2026-06-24
**Author:** Stefan Schaal (with Claude)
**Related:** Hotfix `20260624101342_cron_dispatch_timeout` (memory `cron-health-watcher-false-timeouts`);
the cron-health monitoring design `docs/superpowers/specs/2026-06-22-booking-engine-deploy-and-cron-health-design.md`;
initiative memory `system-health-console-initiative`.

## Context & goal

The `/platform` console's **System Health** tab is today a single card listing scheduled jobs with one
`healthy / failing / stale` badge each ([`src/components/platform/SystemHealthTab.tsx`](../../../src/components/platform/SystemHealthTab.tsx)).
That binary pill **conflates three different conditions** — slow-but-returning-200, actually-down (404/500),
and not-firing — which is exactly what let a healthy-but-slow `cron-health-watcher` render as a red failure
and page super-admins (see the hotfix).

**Goal (Phase 1 of the broader console):** turn the System Health tab into a best-in-class console *shell*
plus the first two domain panels — **Scheduled jobs** and **Edge functions** — built on a universal status
model where **latency is first-class**. Later phases add Email delivery, Database, Org sync, Auth/Storage.

This spec covers **only** the shell + those two panels. It is one implementation plan.

## Decisions (locked)

1. **Scope = broad console, decomposed.** A shared shell (overall banner + domain summary grid) renders
   independent per-domain panels. Phase 1 ships the shell + Scheduled jobs + Edge functions; remaining
   domains appear in the grid as honest **"Not monitored yet"** placeholders (muted, *not* green — never
   fake health).
2. **Universal 4-state model**, applied to every domain, semantic-token colored:
   - **Operational** — responding within its latency budget.
   - **Degraded** — working but slow (200 over budget) or elevated error rate. *(The state today's UI lacks.)*
   - **Down** — non-2xx (404/500) or genuinely hung.
   - **Stale** — scheduled but not firing (dead-man's switch; cron only).
3. **IA = banner → domain grid → drill-down panels.** Hybrid status-page (glance) + operational dashboard
   (depth on demand). Overall banner status = worst live domain.
4. **Metrics source = Supabase Analytics API** (chosen over in-DB instrumentation and cron-data-only).
   A new super-admin edge function proxies the platform logs/analytics; **no** per-invocation writes and
   **no** new metrics table. Trade-off accepted: latency/error history is bounded by Supabase's log
   retention (~24h); durable long-history rollup is deferred.
5. **Status layering.** Durable *health status* for cron jobs stays in `cron_health_state` (via the existing
   `get_cron_health()` RPC — it alone knows schedule + firing/stale semantics). *Latency & error/invocation
   counts* for both panels come from the Analytics proxy. **Degraded** is *derived* by combining the two.

## Status derivation (the testable core)

A pure module `src/lib/systemHealth.ts` (no I/O → unit-tested directly):

```
type HealthState = 'operational' | 'degraded' | 'down' | 'stale';

deriveJobStatus(cron, metric, budget): HealthState
  - cron.status === 'stale'            -> 'stale'
  - cron.status === 'failing'          -> 'down'      // non-2xx / genuine error (durable)
  - metric.errorRate > budget.errorRate -> 'degraded' // healthy status but recent 5xx
  - metric.p95Ms     > budget.p95Ms     -> 'degraded' // healthy + slow (the cold-start case)
  - else                                -> 'operational'

deriveEdgeFnStatus(metric, budget): HealthState   // no cron/stale concept for on-demand fns
  - metric.recent5xx and no recent 2xx -> 'down'
  - metric.errorRate > budget.errorRate -> 'degraded'
  - metric.p95Ms     > budget.p95Ms     -> 'degraded'
  - else                                -> 'operational'
```

Budgets live in `SYSTEM_HEALTH` in [`src/config/app.config.ts`](../../../src/config/app.config.ts), e.g.
`{ p95Ms: 12000, errorRate: 0.05, windowMinutes: 1440, refetchMs: 60000 }`. The p95 budget is deliberately
cold-start-tolerant (functions legitimately boot in 3–10s); tune after observing real data. Merge of cron
rows ↔ metrics is by edge-function name (the cron `job_name` maps to a function slug via a small static map,
since e.g. `expire-offers-hourly` → `expire-offers`).

## Part 1 — `platform-edge-metrics` edge function (backend)

New `supabase/functions/platform-edge-metrics/index.ts`, modeled on the super-admin functions
(`provision-org` / `export-org-data`): `export async function handle(req, deps)` + bottom-wired
`Deno.serve`. `config.toml`: `[functions.platform-edge-metrics] verify_jwt = true`.

1. `if (req.method === 'OPTIONS') return preflight()`.
2. `const auth = await requireSuperAdmin(deps, req); if (!auth.ok) return auth.response;`
3. Read `window_minutes` from the JSON body (default `1440`, clamp to a sane max).
4. `deps.fetch` GET the Supabase Analytics logs endpoint
   (`https://api.supabase.com/v1/projects/{ref}/analytics/endpoints/logs.all?sql=...`) with
   `Authorization: Bearer ${deps.env('ANALYTICS')}` (a dedicated personal access token, stored as the
   edge-function secret `ANALYTICS` — see Secrets), running a query over the edge-log
   source that groups by function and returns, per function: `invocations`, `errors_5xx`, `errors_4xx`,
   approx `p50_ms` / `p95_ms` of `execution_time_ms`, `last_invoked_at`, `last_status`.
5. Aggregate/normalize into `{ functions: EdgeFnMetric[] }` and `json(...)`. Analytics non-2xx → `json({
   error: 'analytics_unavailable', detail }, 502)` (the frontend degrades gracefully — see Part 2).

**Deps used:** `deps.fetch`, `deps.env`. Both are already on `Deps` and faked by `makeFakeDeps`, so the
handler is fully unit-testable with canned Analytics JSON — no network in tests.

> **Verify at implementation:** the exact Analytics endpoint path, the log source name
> (`edge_logs` / `function_edge_logs`), and column names (`execution_time_ms`, `response.status_code`, …)
> against the live Supabase Analytics API before finalizing the query. Mirror the shape the MCP `get_logs`
> edge-function service returns (fields seen: `execution_time_ms`, `status_code`, `timestamp`,
> `function_id`). Keep the SQL in one named constant for easy correction.

## Part 2 — Data access + hooks (frontend)

- [`src/data/platform.ts`](../../../src/data/platform.ts): add `fetchEdgeFnMetrics(client, { windowMinutes })`
  → `client.functions.invoke('platform-edge-metrics', { body: { window_minutes } })`, typed `EdgeFnMetric[]`.
  Reuse existing `fetchCronHealth` / `CronHealthRow`.
- Hooks: `useCronHealth()` (extract the query currently inline in `SystemHealthTab`) and `useEdgeFnMetrics()`.
  Keys: `['platform','cron-health']` (existing) and `['platform','edge-metrics', windowMinutes]`. Both
  `refetchInterval: SYSTEM_HEALTH.refetchMs`. On `edge-metrics` error, the panels still render cron status +
  show "latency metrics unavailable" rather than blanking the tab.

## Part 3 — Components (frontend)

Decompose the single `SystemHealthTab` into a shell + small, focused, independently-testable units under
`src/components/platform/systemHealth/`:

- `SystemHealthTab.tsx` (shell) — composes `useCronHealth` + `useEdgeFnMetrics`, derives per-domain rollups,
  renders `OverallStatusBanner` + `DomainSummaryGrid` + `ScheduledJobsPanel` + `EdgeFunctionsPanel`.
- `OverallStatusBanner.tsx` — worst-of summary + last-updated + env.
- `DomainSummaryGrid.tsx` + `DomainSummaryCard.tsx` — one tile per domain (live + "Not monitored yet" placeholders).
- `ScheduledJobsPanel.tsx` — per-job row: `StatusDot` + name + `StatusPill` + `RunTimeline` (last-N from
  metrics window) + `LatencyStat` (p95) + last/next run; watcher-liveness line from `cron.job_run_details`
  (`get_cron_health.last_run_at`).
- `EdgeFunctionsPanel.tsx` — per-function row: status, p95, error rate, invocations, last invoked.
- Shared presentational primitives: `StatusDot.tsx`, `StatusPill.tsx`, `RunTimeline.tsx`, `LatencyStat.tsx`.

All semantic tokens only; shadcn `Card`/`Badge`/`Skeleton`/`Alert`; `font-display` for headings. Loading →
`Skeleton`; query error → `Alert variant="destructive"`. Matches the approved mockup.

## Testing (test-first)

| Layer | What |
|---|---|
| Unit (pure) | `systemHealth.ts` — full derivation matrix (cron status × p95 × error rate → each of the 4 states; the merge-by-name helper). |
| Data-access | `fetchEdgeFnMetrics` vs `src/test/supabaseFake.ts` — asserts `functions.invoke` name + body, maps response, surfaces errors. |
| Edge function | `platform-edge-metrics/index.di.test.ts` with `makeFakeDeps` — aggregation (p95, error counts) from canned analytics JSON; **super-admin gate** (non-super-admin → 403); analytics non-2xx → 502; `window_minutes` default + clamp. |
| Component | Panels via `renderWithProviders` + fixtures — render Operational / Degraded / Down / Stale and the metrics-unavailable fallback. |

(No pgTAP: no new tables; `get_cron_health` is already covered.)

## Secrets & deploy prerequisites

- **Edge-function secret `ANALYTICS`** — a **dedicated** Supabase personal access token (`sbp_…`), already
  set in the project's edge-function secrets (✓ done). Read via `deps.env('ANALYTICS')`; never returned to
  the client. Dedicated (not the CI deploy token) so it is independently revocable and does not share CI's
  Management-API rate budget.
  **Why a PAT at all:** the analytics/logs endpoint is on the **Management API** (`api.supabase.com`), which
  only accepts a PAT — the reserved project keys (`SUPABASE_SECRET_KEYS` / `SUPABASE_SERVICE_ROLE_KEY`) are
  data-plane and cannot authenticate it.
  **Constraints (from the Management API):** account-wide token (PATs aren't scopable) → mitigated by the
  super-admin gate + read-only use + independent revocability; **rate-limited 60 req/min per PAT** and the
  query range is **capped at ≤24h** (map the window to `iso_timestamp_start`/`iso_timestamp_end`). Cache
  results (React Query `staleTime`) and issue one aggregated call per load.
- Add the `[functions.platform-edge-metrics]` block to `config.toml` (`verify_jwt = true`) so the deploy-all
  workflow doesn't force JWT off/on incorrectly. Auto-deploys on merge to `main`.

## Risks & mitigations

- **Analytics endpoint/schema assumptions** → isolate the SQL + parsing in one place; verify against live at
  implementation; graceful fallback (cron status still renders if the proxy 502s).
- **~24h retention** → trends are bounded; durable rollup explicitly deferred (out of scope below).
- **Management-token sensitivity** → narrowest scope, super-admin gate, read-only, env-only.
- **Analytics rate limits/latency** → React Query caching + modest `refetchMs`; one aggregated call per load.

## Out of scope (Phase 1)

- Durable >24h metrics rollup (revisit if longer trends are needed).
- Other domains: Email delivery (incl. the real `send-transactional-email` 500s), Database, Org sync,
  Auth/Storage — later phases, each its own spec.
- Changes to the existing cron alerting path (unchanged).
- Investigating *why* every function boots in 3–10s (separate operational task).
