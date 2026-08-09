# Design: stop foreign-stack 401s and harden the System Health signal

- **Date:** 2026-08-09
- **Status:** approved (pending spec review)
- **Branch context:** local-CI-stack initiative (`local-ci-stack-database-*` worktree)
- **Related memory:** `foreign-stacks-dispatch-crons-at-prod`, `local-ci-stack-initiative`, `local-dev-env-targets-prod`, `system-health-console-initiative`, `analytics-api-gotchas`, `cron-health-watcher-false-timeouts`

## Problem

The platform System Health console intermittently shows cron jobs as **"degraded"**. Investigation (2026-08-09) established:

- Production's **own** cron dispatch is 100% healthy. Every `cron_health_dispatch` row joined to `net._http_response` is `200`; pg_net shows only `200` for the last hours.
- The "degraded" is driven by **401s from non-production stacks**. The pg_cron scheduling migrations (and two DB triggers) hardcode the production edge-function host `https://epweartpzwvcasrzyueh.supabase.co/functions/v1/...` with **no environment guard**. `00000000000000_local_extensions.sql` deliberately enables `pg_cron` + `pg_net` on local/CI (`supabase start`), so those migrations run there too. Each local `npm run local:up` / CI `verify:full` stack therefore boots the same jobs and fires at **production**, presenting its own `private.cron_secret()` — which on a fresh stack is a random `gen_random_bytes(32)` (`20260702120010_cron_secret_to_vault.sql`) and can never match prod. Prod's `requireCronSecret` rejects them with **401**.
- Those 401s land in production's `function_edge_logs`. The Analytics-derived metrics (`platform-edge-metrics` live, `health-rollup` durable → `health_daily`) bucket **every** 4xx (incl. 401) into `rejected`, unfiltered by caller. When `rejected/invocations > 0.2` (`SYSTEM_HEALTH.rejectRateBudget`), `deriveJobStatus`/`deriveEdgeFnStatus` (`src/lib/systemHealth.ts`) and the uptime bar's `classify()` (`src/lib/uptime.ts`) read **"degraded"** — even though the function itself is fine.
- Observed reject rates ~0.51 (Aug 8) → ~0.67 (Aug 9), a near-constant ~2 foreign 401s per legitimate success across every schedule (≈2 foreign stacks continuously dispatching). `failures` (5xx) is 0 everywhere; `worst_status` is 401. No Supabase preview branches currently exist, so the foreign traffic is local dev + CI.

**It is not rate limiting.** Rate limiting is HTTP 429; every failing call is 401 (Unauthorized).

### The uptime "100%" question (resolved)
`uptimePercent()` measures **availability** = `(runs − failures)/runs`, where `failures` = 5xx + no-response only. With zero 5xx everywhere, 100% is **correct** and is not a bug. It only *looks* wrong because the day cells (`classify()`) and the banner also fold the 401 reject-rate into "degraded", so a "100.0% uptime" label sits next to amber cells and a degraded banner — three surfaces, two definitions of health. Layer B reconciles them by making the classification agree that unauthorized traffic is not downtime. `uptimePercent()` stays as-is.

## Goals

1. **No non-production stack dispatches at production.** Local, CI, and any future preview branch must not fire in-DB `net.http_post` calls at the prod edge functions.
2. **Production behavior unchanged.** Same schedules, same 90s timeouts, same headers, same dispatch-capture. The change to prod is limited to how the URL string is built.
3. **The health signal is robust to unauthorized traffic.** A 401 from an unknown/unauthorized caller must not, by itself, push a function to "degraded" — now or from any future stray caller (e.g. expired-JWT browser polls against a `verify_jwt=true` function).
4. **The console's three surfaces agree** (uptime %, day cells, banner) for the true state.
5. **Tests stay green** and gain regression guards for both fixes.

## Non-goals

- Changing `uptimePercent()`'s definition (availability = 5xx-based) — explicitly kept.
- Rotating the production cron secret (not needed; foreign stacks simply stop reaching prod).
- Backfilling Analytics history beyond what `health-rollup` already recomputes (Analytics retains only 24h; older days cannot be reconstructed — see `analytics-api-gotchas`).
- Manually deleting the leaked/dead data or touching production out of band (merge applies migrations; never hand-apply — see `migrations-not-auto-applied-on-merge`).

---

## Layer A — Route every in-DB dispatcher through an environment-resolved base URL

### A.1 The resolver
Add a `private` helper that yields the edge-functions **origin** to dispatch to:

```
private.functions_base_url() -> text   -- e.g. 'https://epweartpzwvcasrzyueh.supabase.co'
```

- **Default (production):** the production host, as a literal inside the function. This is the single place the prod host lives.
- **Override (non-prod):** returns a configured override when present. Concrete mechanism (finalize in plan): a Postgres setting `app.functions_base_url` read via `current_setting('app.functions_base_url', true)`, or a `private.runtime_config(key,value)` row. `SECURITY DEFINER`, `STABLE`, `SET search_path`.
- Fail-safe direction: default is prod, so a **missing** override can only ever mis-target **local** (harmless), never break production.

### A.2 Non-prod override lives in `seed.sql`
`supabase/seed.sql` runs on `supabase db reset` (local), on `verify:full`, and on Supabase **preview-branch** creation — but **never on production**. It sets the override to the local stack's functions endpoint (exact host — `http://kong:8000` vs `http://127.0.0.1:54321` reachable from the db container — to be verified against the running local stack during implementation; see `docs/runbooks/local-development-stack.md`).

Result: local/CI/preview crons exercise the real dispatch path against **local** functions (faithful mirror); production is untouched.

### A.3 Every in-DB `net.http_post` to an edge function uses the resolver
A new migration rebuilds all current dispatchers to construct the URL as `private.functions_base_url() || '/functions/v1/<fn>'` instead of a hardcoded host. In scope (the live dispatchers):

1. **The 8 pg_cron jobs** — reschedule (unschedule-if-exists + reschedule) `expire-offers-hourly`, `airtable-poll`, `offer-digest`, `confirmation-digest`, `tier-at-risk-hourly`, `cron-health-watcher`, `email-health-watcher`, `health-rollup`. **Preserve every schedule/minute field and `timeout_milliseconds := 90000`** (guarded by `cron_schedule_stagger.sql` / `cron_dispatch_timeout.sql`) and the `cron_health_dispatch` INSERT and `X-Cron-Secret` header.
2. **`public.dispatch_hire_order_drafts()`** (trigger on `show_dates` → `fully_filled`; `20260717161030`) — same host substitution; keep the 30s timeout, entitlement gate, and `X-Cron-Secret`.
3. **`on_auth_user_created`'s notify dispatch** (`20260423103651`) — same host substitution.

Superseded older scheduling migrations (`20260514290000`, `20260514300000`, `20260623042017`, `20260624101342`, `20260711000837`) are historical; the new migration sets the final `cron.job` state, so they need no edits.

### A.4 Regression guard (pgTAP)
Add a test asserting **no** `cron.job.command` (for the dispatch jobs) contains a literal `://<prod-ref>.supabase.co` — i.e. they all route through the resolver — and that `private.functions_base_url()` returns the production host when no override is set. This locks the fix so a future migration can't reintroduce a hardcoded prod URL.

---

## Layer B — 401 is not a health signal (B1)

### B.1 Separate 401 from generic 4xx, end to end
`health_daily` currently stores only an aggregate `rejected` (all 4xx), so 401 cannot be excluded from historical rows without a schema change.

- **Schema:** add `health_daily.unauthorized int not null default 0` (the 401 subset). Keep `rejected` meaning **all 4xx** (backward-compatible for any other reader). Extend the `get_health_daily` RPC to return it. Regenerate types (`supabase gen types` + `npm run sync:mirrors`), per the DB-changes runbook.
- **Durable write (`health-rollup`):** it already sees per-row `status_code`; also count 401 into `unauthorized`.
- **Live metric (`platform-edge-metrics`):** it already builds a `byStatus` histogram; expose an `unauthorized` (401) count on the per-fn metric alongside `rejected`.

### B.2 Classification excludes 401
The health/degraded decision uses the **non-401 reject rate** = `(rejected − unauthorized)/runs` (equivalently, non-401 4xx / invocations):

- `src/lib/systemHealth.ts` — `deriveJobStatus` / `deriveEdgeFnStatus` reject-rate branch.
- `src/lib/uptime.ts` — `classify()` reject-rate branch.

401 stays **visible** everywhere it's informative: the `byStatus` chips and the uptime day tooltip (`describeUptimeDay`) continue to show the 401 count. `rejectRateBudget` is unchanged; it now applies to genuine client/app 4xx (400/403/404/409/422 …). `uptimePercent()` is untouched.

### B.3 Historical reconciliation (optional, recommended)
After Layer A stops the 401s, `health-rollup` recomputes **today + yesterday**, so recent cells self-correct within ~2 days. Days older than that keep their amber coloring until they age out of the 30-day window. To flip the already-recorded cron-function amber days immediately, a one-time, targeted backfill:

```
update public.health_daily
   set unauthorized = rejected
 where failures = 0 and worst_status = 401 and unauthorized = 0;
```

Safe because it only touches rows whose sole badness is 401 (no 5xx, worst 4xx = 401) — the cron endpoints, which realistically receive no other 4xx. This is cosmetic (the live banner clears within a day regardless); include it if the 30-day bar's history should read true immediately.

---

## Touchpoints (design-level; the plan enumerates exact edits)

**Layer A**
- New migration: `private.functions_base_url()` + reschedule all cron jobs + redefine the two trigger functions through the resolver.
- `supabase/seed.sql`: set the non-prod override.
- `supabase/tests/db/`: new guard test (no hardcoded prod host in dispatchers; resolver defaults to prod).

**Layer B**
- New migration: `health_daily.unauthorized` column + `get_health_daily` update.
- `supabase/functions/health-rollup/index.ts`: write `unauthorized`.
- `supabase/functions/platform-edge-metrics/index.ts`: expose `unauthorized`.
- `src/lib/systemHealth.ts`, `src/lib/uptime.ts`: non-401 reject rate.
- `src/integrations/supabase/types.ts` (regen) + `_shared/database.types.ts` mirror (`npm run sync:mirrors`).
- Unit tests: `uptime.ts` classify, `systemHealth.ts` derivers, metric bucketing; edge tests for `health-rollup` / `platform-edge-metrics`.
- Optional one-time backfill migration (B.3).

> Check `scripts/mirrors.manifest.json` for any touched file that is a mirror source and regenerate; `npm run sync:mirrors:check` gates CI.

## Testing plan

- **pgTAP:** keep `cron_schedule_stagger` / `cron_dispatch_timeout` green (schedules + 90s timeout preserved); add the no-hardcoded-host guard; add a resolver-default test.
- **Vitest:** `classify()` and `deriveJobStatus`/`deriveEdgeFnStatus` treat 401 as operational but non-401 4xx as degraded; `uptimePercent()` unchanged; metric bucketing splits 401.
- **Deno:** `health-rollup` writes `unauthorized`; `platform-edge-metrics` exposes it.
- **Manual/prod check after merge:** confirm prod cron dispatch still 200 (`cron_health_dispatch` join) and that a local `local:up` no longer produces prod 401s (the prod edge logs for cron fns stop showing 401 within one local session).

## Rollout & safety

- Merge to `main` applies the migrations (Supabase GitHub integration). **Do not hand-apply** (`migrations-not-auto-applied-on-merge`); if applied out of band, rename the file to the recorded version.
- Reschedule is unschedule-if-exists + reschedule with identical schedules/timeouts — safe and idempotent.
- Ordering: Layer A and Layer B are independent and can land in one PR or two. If split, Layer A first (removes the source), Layer B second (reconciles the display + hardens).

## Risks & mitigations

- **Local functions URL wrong / unreachable from the db container** → local crons error locally (harmless; stays local). Mitigation: verify the exact host during implementation against the running stack; a connection error in `net._http_response` locally is acceptable.
- **Override missing on a non-prod stack** → that stack targets prod again (the original bug). Mitigation: fail-safe default is prod, so this only regresses if seed doesn't run; the guard test + the fact that `local:up` always seeds contains it. Consider having the resolver refuse to return the prod host when a known non-prod marker is present (finalize in plan).
- **B1 masks a real 401 regression** (e.g. cron-secret drift, service-bearer regression) → those remain caught: cron-secret drift shows in `cron-health-watcher` (authoritative `net._http_response`), and the service-bearer regression also surfaces as 403; 401 stays visible in `byStatus`. Net signal loss is acceptable.
- **Prod cron command text change** → still 200 (resolver returns the same prod host). Verified by the post-merge check.

## Open items to finalize in the plan
1. Override mechanism: `app.functions_base_url` GUC vs `private.runtime_config` row.
2. Exact local functions origin reachable from the db container (`kong:8000` vs `127.0.0.1:54321`).
3. Whether to ship Layer B's historical backfill (B.3).
4. Confirm no other test pins a literal cron URL (`cron_health.sql`, `cron_health_rpcs.sql`, `hire_orders.sql`).
