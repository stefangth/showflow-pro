# Configurable Airtable Poll Interval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each org's admin choose how often its Airtable base is polled (preset intervals), with a super-admin platform default, an on-demand "Sync now", and in-UI cadence transparency.

**Architecture:** The global `airtable-poll` cron keeps firing every 5 minutes and iterating active orgs; the interval is enforced as a **per-org gate inside the loop** (skip an org until `airtable_poll_interval_minutes` has elapsed since its last poll, read from `airtable_sync_log.synced_at`). A scoped org-admin-JWT branch on the same function powers "Sync now" for a single org. The existing dead seed `airtable_poll_interval_minutes` is reused — no new settings key or table.

**Tech Stack:** React 18 + TS + TanStack Query + shadcn/ui (frontend); Deno edge functions with DI (`handle(req, deps)`); Vitest (frontend) + Deno test (edge); Supabase Postgres + pg_cron.

## Global Constraints

- **Do not edit** `src/integrations/supabase/types.ts` or files under `supabase/migrations/` by hand except the ONE new migration this plan adds (Task 6). New migrations are created via the migration tool / MCP `apply_migration`.
- **Interval floor = 5 minutes; grace = 60 seconds.** These are the master-tick resolution and cron-jitter absorber. Server clamps any stored value to ≥ 5.
- **Presets (minutes):** `[5, 15, 30, 60, 120, 240, 480]` — labels "5 minutes / 15 minutes / 30 minutes / 1 hour / 2 hours / 4 hours / 8 hours".
- **Reuse the existing settings key** `airtable_poll_interval_minutes` (integer minutes). Do NOT create a new key.
- **`airtable-poll` stays `verify_jwt = false`** in `supabase/config.toml` — do NOT change it. The handler does its own auth (cron secret OR org-admin JWT).
- **Settings tiering:** org row → platform default (`org_id IS NULL`) → code fallback. Frontend uses `resolveOrgSetting`/`upsertOrgSetting`/`savePlatformSetting`; edge uses `resolveOrgSetting` from `_shared/settings.ts`.
- **Query-key invalidation:** mutations touching `bookings` invalidate `['bookings']` (prefix). Sync settings use the tab's `SETTINGS_KEY = ['airtable','settings',orgId]`.
- **This is an automation change** → `docs/system-map.md` AND `src/data/systemMap.ts` MUST be updated in this PR (Task 10).
- **User-facing feature** → version bump is **MINOR**: `1.7.0 → 1.8.0` in `package.json` and `APP_META.VERSION`, plus a changelog block (Task 10).
- Edge tests run in CI via `deno test`; run the WHOLE `supabase/functions/` suite after edge changes (single-file runs hide regressions). Frontend: `npx vitest run`.

---

## File Structure

- `src/lib/airtablePoll.ts` **(new)** — pure interval helpers (presets, clamp, format, next-sync). Frontend + tests only.
- `src/lib/airtablePoll.test.ts` **(new)** — unit tests for the above.
- `src/data/airtableSettings.ts` **(modify)** — add `airtable_poll_interval_minutes` to the settings type/keys/defaults/fetch.
- `src/data/airtableSettings.test.ts` **(modify)** — cover the new key.
- `src/data/airtableSync.ts` **(modify)** — add `triggerAirtableSyncNow(client, orgId)`.
- `supabase/functions/airtable-poll/index.ts` **(modify)** — extract `syncOneOrg`; add interval gate + `fetchLastPollAt` + constants; add the sync-now JWT branch.
- `supabase/functions/airtable-poll/index.di.test.ts` **(modify)** — add `makeGateDeps` helper + gate tests + manual-sync tests; update one existing auth test.
- `supabase/migrations/<generated>_airtable_sync_log_org_synced_idx.sql` **(new)** — index for the gate/last-sync reads.
- `src/components/settings/AirtableSyncTab.tsx` **(modify)** — interval `Select`, last/next-sync line, "Sync now" button, rate-limit note.
- `src/components/platform/PlatformDefaultsTab.tsx` **(modify)** — "Airtable sync defaults" card (platform default interval).
- `docs/system-map.md`, `src/data/systemMap.ts`, `CLAUDE.md`, `public/changelog.md`, `public/changelog.json`, `package.json`, `src/config/app.config.ts` **(modify)** — docs + release (Task 10).

---

## Task 1: Pure interval module (`src/lib/airtablePoll.ts`)

**Files:**
- Create: `src/lib/airtablePoll.ts`
- Test: `src/lib/airtablePoll.test.ts`

**Interfaces:**
- Produces: `MIN_POLL_INTERVAL_MINUTES: number` (=5), `POLL_INTERVAL_PRESET_MINUTES: number[]`, `POLL_INTERVAL_PRESETS: {value:number,label:string}[]`, `clampInterval(v: unknown): number`, `formatInterval(min: number): string`, `nextSyncAt(lastSyncedAt: string|Date|null|undefined, intervalMin: number): Date|null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/airtablePoll.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  MIN_POLL_INTERVAL_MINUTES, POLL_INTERVAL_PRESET_MINUTES, POLL_INTERVAL_PRESETS,
  clampInterval, formatInterval, nextSyncAt,
} from "./airtablePoll";

describe("airtablePoll", () => {
  it("exposes the approved presets", () => {
    expect(POLL_INTERVAL_PRESET_MINUTES).toEqual([5, 15, 30, 60, 120, 240, 480]);
    expect(POLL_INTERVAL_PRESETS[0]).toEqual({ value: 5, label: "5 minutes" });
    expect(POLL_INTERVAL_PRESETS.find((p) => p.value === 60)?.label).toBe("1 hour");
    expect(POLL_INTERVAL_PRESETS.find((p) => p.value === 120)?.label).toBe("2 hours");
  });

  it("formats minutes and hours", () => {
    expect(formatInterval(5)).toBe("5 minutes");
    expect(formatInterval(30)).toBe("30 minutes");
    expect(formatInterval(60)).toBe("1 hour");
    expect(formatInterval(480)).toBe("8 hours");
  });

  it("clamps below-floor / invalid values to the minimum", () => {
    expect(clampInterval(1)).toBe(MIN_POLL_INTERVAL_MINUTES);
    expect(clampInterval(0)).toBe(5);
    expect(clampInterval(-10)).toBe(5);
    expect(clampInterval("nope")).toBe(5);
    expect(clampInterval(undefined)).toBe(5);
    expect(clampInterval(30)).toBe(30);
  });

  it("computes the next sync time (null when never synced)", () => {
    expect(nextSyncAt(null, 30)).toBeNull();
    expect(nextSyncAt(undefined, 30)).toBeNull();
    const last = "2026-07-05T10:00:00.000Z";
    expect(nextSyncAt(last, 30)?.toISOString()).toBe("2026-07-05T10:30:00.000Z");
    // interval below floor is clamped to 5 min
    expect(nextSyncAt(last, 1)?.toISOString()).toBe("2026-07-05T10:05:00.000Z");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/airtablePoll.test.ts`
Expected: FAIL — cannot resolve `./airtablePoll`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/airtablePoll.ts`:

```ts
/**
 * Pure helpers for the Airtable poll interval. The master cron ticks every 5 min,
 * so 5 is the resolution floor. Mirrors the edge-side constants in
 * supabase/functions/airtable-poll/index.ts (two runtimes, no shared import).
 */
export const MIN_POLL_INTERVAL_MINUTES = 5;

/** Admin-selectable cadences, in minutes. */
export const POLL_INTERVAL_PRESET_MINUTES = [5, 15, 30, 60, 120, 240, 480] as const;

/** Human label for an interval: minutes below an hour, else whole hours. */
export function formatInterval(min: number): string {
  if (min % 60 === 0 && min >= 60) {
    const h = min / 60;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  return `${min} minutes`;
}

export const POLL_INTERVAL_PRESETS = POLL_INTERVAL_PRESET_MINUTES.map((value) => ({
  value,
  label: formatInterval(value),
}));

/** Coerce a stored value to a safe interval (≥ floor); invalid input → floor. */
export function clampInterval(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= MIN_POLL_INTERVAL_MINUTES ? n : MIN_POLL_INTERVAL_MINUTES;
}

/** When the next poll becomes eligible, or null if the org has never synced. */
export function nextSyncAt(
  lastSyncedAt: string | Date | null | undefined,
  intervalMin: number,
): Date | null {
  if (!lastSyncedAt) return null;
  const last = lastSyncedAt instanceof Date ? lastSyncedAt : new Date(lastSyncedAt);
  return new Date(last.getTime() + clampInterval(intervalMin) * 60_000);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/airtablePoll.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/airtablePoll.ts src/lib/airtablePoll.test.ts
git commit -m "feat: pure airtable poll-interval helpers"
```

---

## Task 2: Surface the interval in Airtable settings data (`src/data/airtableSettings.ts`)

**Files:**
- Modify: `src/data/airtableSettings.ts`
- Test: `src/data/airtableSettings.test.ts`

**Interfaces:**
- Consumes: `MIN_POLL_INTERVAL_MINUTES` from Task 1.
- Produces: `AirtableSettings.airtable_poll_interval_minutes: number`; the key is fetched with org→platform→default resolution.

- [ ] **Step 1: Write the failing test**

Add to `src/data/airtableSettings.test.ts` inside the `describe`:

```ts
  it("defaults the poll interval to the floor when unset", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    const s = await fetchAirtableSettings(fake as never, "org-1");
    expect(s.airtable_poll_interval_minutes).toBe(5);
  });

  it("prefers the org poll interval over the platform default", async () => {
    const fake = createFakeSupabase({
      app_settings: {
        data: [
          { key: "airtable_poll_interval_minutes", value: 15, org_id: null },
          { key: "airtable_poll_interval_minutes", value: 60, org_id: "org-1" },
        ],
        error: null,
      },
    });
    const s = await fetchAirtableSettings(fake as never, "org-1");
    expect(s.airtable_poll_interval_minutes).toBe(60);
  });

  it("falls back to the platform default when the org has no override", async () => {
    const fake = createFakeSupabase({
      app_settings: {
        data: [{ key: "airtable_poll_interval_minutes", value: 30, org_id: null }],
        error: null,
      },
    });
    const s = await fetchAirtableSettings(fake as never, "org-1");
    expect(s.airtable_poll_interval_minutes).toBe(30);
  });
```

Also update the `toEqual({...})` in the existing "returns typed defaults" test to include the new key:

```ts
    expect(s).toEqual({
      airtable_sync_enabled: false,
      airtable_base_id: "",
      airtable_table_name: "",
      airtable_field_map: {},
      airtable_view: "Grid view",
      airtable_poll_interval_minutes: 5,
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/airtableSettings.test.ts`
Expected: FAIL — `airtable_poll_interval_minutes` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `src/data/airtableSettings.ts`:

Add the import near the top:

```ts
import { MIN_POLL_INTERVAL_MINUTES } from "@/lib/airtablePoll";
```

Add to the `AirtableSettings` interface (after `airtable_view`):

```ts
  /** How often the poll runs for this org, in minutes (min 5). */
  airtable_poll_interval_minutes: number;
```

Add to `AIRTABLE_SETTING_KEYS` (before the closing `] as const;`):

```ts
  "airtable_poll_interval_minutes",
```

Add to `DEFAULTS`:

```ts
  airtable_poll_interval_minutes: MIN_POLL_INTERVAL_MINUTES,
```

Add to the returned object in `fetchAirtableSettings` (after the `airtable_view` line):

```ts
    airtable_poll_interval_minutes:
      (byKey.get("airtable_poll_interval_minutes")?.value as number) ?? DEFAULTS.airtable_poll_interval_minutes,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/data/airtableSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/airtableSettings.ts src/data/airtableSettings.test.ts
git commit -m "feat: read airtable poll interval in settings data layer"
```

---

## Task 3: Extract `syncOneOrg` in the edge function (behavior-preserving refactor)

This isolates the per-org pipeline so both the cron loop and the upcoming "Sync now" branch call it. **No behavior change** — the existing `airtable-poll` suite must stay green.

**Files:**
- Modify: `supabase/functions/airtable-poll/index.ts`

**Interfaces:**
- Produces: `async function syncOneOrg(deps: Deps, orgId: string): Promise<OrgSyncResult | null>` — resolves config, runs misconfig guards (logging an error `sync_log` row + returning `null` on failure), else runs `syncOrg` and returns its result.

- [ ] **Step 1: Add `syncOneOrg` above `handle`**

In `supabase/functions/airtable-poll/index.ts`, immediately before `export async function handle(`, insert:

```ts
/**
 * Resolve one org's Airtable sync config, run the misconfig guards, and sync it.
 * Returns the per-org result, or null when the org is misconfigured (an error
 * sync_log row was already written) so the caller skips its totals. Shared by the
 * cron loop (per active org) and the manual "Sync now" path (single org).
 */
async function syncOneOrg(deps: Deps, orgId: string): Promise<OrgSyncResult | null> {
  const admin = deps.admin;
  const [baseId, tableName, fieldMap, viewRaw] = await Promise.all([
    resolveOrgSetting<string | null>(admin, orgId, "airtable_base_id", null),
    resolveOrgSetting<string | null>(admin, orgId, "airtable_table_name", null),
    resolveOrgSetting<FieldMap>(admin, orgId, "airtable_field_map", {}),
    resolveOrgSetting<string | null>(admin, orgId, "airtable_view", "Grid view"),
  ]);
  const viewName = (viewRaw ?? "Grid view").trim();

  const logMisconfig = (detail: string) =>
    admin.from("airtable_sync_log").insert({ org_id: orgId, sync_type: "airtable_poll", status: "error", records_processed: 0, imported_count: 0, new_count: 0, updated_count: 0, held_count: 0, error_details: detail, synced_at: deps.now().toISOString() });

  if (!baseId || !tableName) { await logMisconfig("Airtable sync enabled but base_id or table_name is not configured"); return null; }
  if (!/^app[A-Za-z0-9]{14,}$/.test(baseId)) { await logMisconfig("airtable_base_id has unexpected format; expected app + 14 alphanumeric chars"); return null; }
  if (!fieldMap?.date || !fieldMap?.sub_program) { await logMisconfig("Airtable field map incomplete: 'date' and 'sub_program' must be mapped"); return null; }

  const { data: apiKey } = await admin.rpc("get_org_airtable_key", { _org: orgId });
  if (!apiKey) { await logMisconfig("Airtable sync enabled but no API key is configured in the Vault"); return null; }

  return await syncOrg(deps, orgId, baseId, tableName, apiKey as string, fieldMap, viewName);
}
```

- [ ] **Step 2: Replace the loop body to call `syncOneOrg`**

In `handle`, replace the entire `for (const org of orgs) { ... }` loop body with:

```ts
  for (const org of orgs) {
    try {
      const enabled = await resolveOrgSetting<boolean>(admin, org.id, "airtable_sync_enabled", false);
      if (!enabled) continue; // intentionally off → skip silently

      const r = await syncOneOrg(deps, org.id);
      if (!r) continue; // misconfigured — error row already written

      totals.orgs_synced += 1;
      totals.processed += r.processed;
      totals.new_dates += r.new_dates;
      totals.updated += r.updated;
      totals.held += r.held;
      totals.tiers_opened += r.tiers_opened;
    } catch (e) {
      console.error("airtable-poll: org sync failed", { org: org.id, error: (e as { body?: unknown })?.body ?? (e as Error).message });
      // continue; any sync_log row was already written inside syncOrg / the misconfig guards.
    }
  }
```

- [ ] **Step 3: Run the full edge suite to verify no regression**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/`
Expected: PASS — all existing tests green (same behavior, refactored structure).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/airtable-poll/index.ts
git commit -m "refactor: extract syncOneOrg from airtable-poll loop"
```

---

## Task 4: Per-org interval gate in the cron loop

**Files:**
- Modify: `supabase/functions/airtable-poll/index.ts`
- Test: `supabase/functions/airtable-poll/index.di.test.ts`

**Interfaces:**
- Consumes: `syncOneOrg` (Task 3), `resolveOrgSetting`.
- Produces: constants `MIN_POLL_INTERVAL_MINUTES = 5`, `POLL_GRACE_MS = 60_000`; `clampIntervalMinutes(v): number`; `fetchLastPollAt(admin, orgId): Promise<Date|null>`; a `makeGateDeps(...)` test helper (reused by Task 5).

- [ ] **Step 1: Write the failing tests**

At the top of `index.di.test.ts` (after the existing helpers, before the first `Deno.test`), add the shared helper:

```ts
/**
 * Deps for interval-gate and manual-sync tests: one enabled+keyed org, empty catalog,
 * an Airtable-page fetch spy, and a seedable last-poll timestamp. `memberRole`/`authUser`
 * feed requireOrgRole for the manual-sync path.
 */
function makeGateDeps(opts: {
  lastSyncedAt?: string | null;
  intervalMinutes?: number;
  now?: Date;
  authUser?: { id: string };
  memberRole?: string | null;
} = {}) {
  const fetchSpy = { count: 0 };
  const fetchImpl = ((url: string) => {
    if (String(url).includes("api.airtable.com")) fetchSpy.count += 1;
    return Promise.resolve(new Response(JSON.stringify({ records: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as unknown as typeof fetch;

  const intervalRows = opts.intervalMinutes != null
    ? [{ when: { key: "airtable_poll_interval_minutes" }, data: [{ org_id: ORG, value: opts.intervalMinutes }] }]
    : [];

  const { deps, invokeCalls, calls } = makeFakeDeps({
    now: opts.now ?? new Date("2026-06-01T12:00:00.000Z"),
    authUser: opts.authUser,
    tables: {
      app_settings: [
        { when: { key: "cron_secret" }, data: { value: "secret123" } },
        ...ENABLED_SETTINGS,
        ...intervalRows,
      ],
      organizations: { data: [{ id: ORG }], error: null },
      shows: { data: [], error: null },
      cities: { data: [], error: null },
      show_dates: { data: [], error: null },
      custom_field_definitions: { data: [], error: null },
      airtable_sync_log: opts.lastSyncedAt !== undefined
        ? { data: opts.lastSyncedAt === null ? null : { synced_at: opts.lastSyncedAt }, error: null }
        : { data: null, error: null },
      airtable_sync_record_log: { data: [], error: null },
      org_memberships: { data: opts.memberRole ? { role: opts.memberRole } : null, error: null },
      platform_admins: { data: null, error: null },
      notifications: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: "key", error: null }, get_cron_secret: { data: "secret123", error: null } },
    fetchImpl,
  });
  return { deps, invokeCalls, calls, fetchSpy };
}
```

Then add the gate tests:

```ts
// ─── Interval gate (cron path) ────────────────────────────────────────────────

Deno.test("gate: first run (no prior poll) → polls", async () => {
  const { deps, fetchSpy } = makeGateDeps({ lastSyncedAt: null });
  const res = await handle(authReq(), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(fetchSpy.count, 1);       // hit Airtable
  assertEquals(body.orgs_synced, 1);
});

Deno.test("gate: within interval → skipped, no Airtable call", async () => {
  // last poll 2 min before now(12:00); default interval 5 → 120s < 300s-60s=240s → skip
  const { deps, fetchSpy } = makeGateDeps({ lastSyncedAt: "2026-06-01T11:58:00.000Z" });
  const res = await handle(authReq(), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(fetchSpy.count, 0);
  assertEquals(body.orgs_synced, 0);
});

Deno.test("gate: interval elapsed → polls", async () => {
  const { deps, fetchSpy } = makeGateDeps({ lastSyncedAt: "2026-06-01T11:50:00.000Z" }); // 10 min ago
  const res = await handle(authReq(), deps);
  const body = await res.json();
  assertEquals(fetchSpy.count, 1);
  assertEquals(body.orgs_synced, 1);
});

Deno.test("gate: sub-floor interval value is clamped to 5 min", async () => {
  // stored 1 → clamped to 5; last poll 2 min ago → still skipped
  const { deps, fetchSpy } = makeGateDeps({ lastSyncedAt: "2026-06-01T11:58:00.000Z", intervalMinutes: 1 });
  const res = await handle(authReq(), deps);
  await res.json();
  assertEquals(fetchSpy.count, 0);
});

Deno.test("gate: 60s grace lets a 5-min interval poll slightly early", async () => {
  // last poll 4m40s ago (280s); 300s-60s grace = 240s threshold; 280 ≥ 240 → poll
  const { deps, fetchSpy } = makeGateDeps({ lastSyncedAt: "2026-06-01T11:55:20.000Z", intervalMinutes: 5 });
  const res = await handle(authReq(), deps);
  await res.json();
  assertEquals(fetchSpy.count, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/index.di.test.ts`
Expected: FAIL — within-interval / clamp tests still poll (gate not implemented; `fetchSpy.count` is 1 not 0).

- [ ] **Step 3: Add the constants + `fetchLastPollAt`**

In `index.ts`, add near the other module constants (below `MAX_PAGES`):

```ts
/** Poll-interval floor + jitter grace. Mirrors src/lib/airtablePoll.ts (two runtimes,
 *  no shared import). The 5-min floor matches the master cron tick; the 60s grace keeps
 *  a 5-min interval polling every tick despite cron dispatch jitter. */
const MIN_POLL_INTERVAL_MINUTES = 5;
const POLL_GRACE_MS = 60_000;
function clampIntervalMinutes(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= MIN_POLL_INTERVAL_MINUTES ? n : MIN_POLL_INTERVAL_MINUTES;
}

/** Most recent airtable_poll attempt for an org (null = never). Drives the interval gate. */
async function fetchLastPollAt(admin: Deps["admin"], orgId: string): Promise<Date | null> {
  const { data } = await admin
    .from("airtable_sync_log").select("synced_at")
    .eq("org_id", orgId).eq("sync_type", "airtable_poll")
    .order("synced_at", { ascending: false }).limit(1).maybeSingle();
  const ts = (data as { synced_at?: string } | null)?.synced_at;
  return ts ? new Date(ts) : null;
}
```

- [ ] **Step 4: Insert the gate in the loop**

In `handle`, inside `for (const org of orgs)`, immediately after the `if (!enabled) continue;` line and before `const r = await syncOneOrg(...)`, insert:

```ts
      // Per-org interval gate: skip until this org's interval has elapsed since its last
      // poll. The master cron ticks every 5 min; this throttles each org independently.
      const intervalRaw = await resolveOrgSetting<number>(admin, org.id, "airtable_poll_interval_minutes", MIN_POLL_INTERVAL_MINUTES);
      const intervalMs = clampIntervalMinutes(intervalRaw) * 60_000;
      const lastPollAt = await fetchLastPollAt(admin, org.id);
      if (lastPollAt && deps.now().getTime() - lastPollAt.getTime() < intervalMs - POLL_GRACE_MS) continue;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/`
Expected: PASS — new gate tests green AND all pre-existing tests still green (the happy-path seeds return no `synced_at`, so they poll as before).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/airtable-poll/index.ts supabase/functions/airtable-poll/index.di.test.ts
git commit -m "feat: per-org interval gate in airtable-poll"
```

---

## Task 5: "Sync now" scoped org-admin branch

**Files:**
- Modify: `supabase/functions/airtable-poll/index.ts`
- Test: `supabase/functions/airtable-poll/index.di.test.ts`

**Interfaces:**
- Consumes: `syncOneOrg` (Task 3), `requireOrgRole` from `_shared/auth.ts`.
- Produces: a pre-cron branch in `handle` — a request WITHOUT `X-Cron-Secret` is an org-admin single-org trigger (`{ org_id }` body → `requireOrgRole(org_id,['admin'])` → `syncOneOrg`, gate bypassed). Returns `{ ok: true, orgs_synced, result }`.

- [ ] **Step 1: Write the failing tests**

Add to `index.di.test.ts`:

```ts
// ─── Manual "Sync now" (org-admin JWT, single org, gate bypassed) ─────────────

Deno.test("sync-now: org admin + org_id → 200, syncs only that org (bypasses gate)", async () => {
  // last poll 30s ago would be gated on the cron path; the manual path must still run.
  const { deps, fetchSpy } = makeGateDeps({
    lastSyncedAt: "2026-06-01T11:59:30.000Z", authUser: { id: "admin-1" }, memberRole: "admin",
  });
  const res = await handle(
    makeRequest({ method: "POST", headers: { Authorization: "Bearer admin-jwt" }, body: { org_id: ORG } }),
    deps,
  );
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.orgs_synced, 1);
  assertEquals(fetchSpy.count, 1);
});

Deno.test("sync-now: caller not an admin of the org → 403", async () => {
  const { deps, fetchSpy } = makeGateDeps({ authUser: { id: "user-1" }, memberRole: null });
  const res = await handle(
    makeRequest({ method: "POST", headers: { Authorization: "Bearer user-jwt" }, body: { org_id: ORG } }),
    deps,
  );
  assertEquals(res.status, 403);
  assertEquals(fetchSpy.count, 0);
});

Deno.test("sync-now: missing org_id → 400", async () => {
  const { deps } = makeGateDeps({ authUser: { id: "admin-1" }, memberRole: "admin" });
  const res = await handle(
    makeRequest({ method: "POST", headers: { Authorization: "Bearer admin-jwt" }, body: {} }),
    deps,
  );
  assertEquals(res.status, 400);
});
```

Then **update** the existing test named `"airtable-poll: admin USER JWT without a cron secret → 401 (cron-secret-only, no role fallback)"` — its contract changed (a JWT without `org_id` now falls into the sync-now branch and is rejected for lack of `org_id`, not for being a JWT). Replace that whole `Deno.test(...)` with:

```ts
Deno.test("airtable-poll: admin JWT without org_id → 400 (JWT path is single-org; never the cron fan-out)", async () => {
  // The cross-org fan-out stays cron-secret-only. A JWT request is the "Sync now" path,
  // which REQUIRES an explicit org_id and can only ever sync that one org — so a JWT can
  // never trigger the fan-out. Without org_id it's a 400, not a fan-out.
  const { deps } = makeFakeDeps({
    authUser: { id: "admin-1" },
    tables: { org_memberships: { data: { role: "admin" }, error: null } },
    rpcs: { get_cron_secret: { data: "secret123", error: null } },
  });
  const res = await handle(
    makeRequest({ method: "POST", headers: { Authorization: "Bearer admin-jwt" } }),
    deps,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "org_id required");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/index.di.test.ts`
Expected: FAIL — sync-now tests get 401 (no branch yet); the updated test still sees 401 not 400.

- [ ] **Step 3: Add the `requireOrgRole` import**

In `index.ts`, change the auth import line:

```ts
import { requireCronSecret } from "../_shared/auth.ts";
```

to:

```ts
import { requireCronSecret, requireOrgRole } from "../_shared/auth.ts";
```

- [ ] **Step 4: Add the branch at the top of `handle`**

In `handle`, immediately after `const admin = deps.admin;` and before the `// Auth: X-Cron-Secret ONLY ...` block, insert:

```ts
  // Manual "Sync now": a request WITHOUT the cron secret is an org-admin trigger for a
  // SINGLE org (never the cross-org fan-out). requireOrgRole scopes it to the caller's own
  // org, so it can't drive other orgs' writes — that's why the fan-out stays
  // cron-secret-only below. The gate is intentionally bypassed (explicit user action).
  if (req.headers.get("X-Cron-Secret") == null) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    let body: { org_id?: string } = {};
    try { body = await req.json(); } catch { /* empty/invalid body → handled below */ }
    const orgId = body?.org_id;
    if (!orgId) return json({ error: "org_id required" }, 400);
    const roleCheck = await requireOrgRole(deps, req, orgId, ["admin"]);
    if (!roleCheck.ok) return roleCheck.response;
    try {
      const result = await syncOneOrg(deps, orgId);
      return json({ ok: true, orgs_synced: result ? 1 : 0, result });
    } catch (e) {
      console.error("airtable-poll: manual sync failed", { org: orgId, error: (e as { body?: unknown })?.body ?? (e as Error).message });
      return json({ error: "sync failed", org_id: orgId }, 502);
    }
  }
```

Also update the handler's doc-comment (the block above `export async function handle`) so the "X-Cron-Secret ONLY" note reflects the new scoped JWT branch. Replace the `Auth:` paragraph with:

```ts
 * Auth: TWO paths. (1) X-Cron-Secret header → the cross-org fan-out over EVERY active
 * org (gated per-org by airtable_poll_interval_minutes). (2) An org-admin JWT + { org_id }
 * body → a manual "Sync now" for that ONE org only (requireOrgRole, gate bypassed). The
 * fan-out is never reachable via a JWT, so a single org's admin can't drive cross-org writes.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/`
Expected: PASS — sync-now tests green, updated auth test green, and the pre-existing cron-secret auth tests (missing/wrong/null secret → 401) still green (those requests carry the `X-Cron-Secret` header or no Authorization, so they behave as before).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/airtable-poll/index.ts supabase/functions/airtable-poll/index.di.test.ts
git commit -m "feat: add scoped Sync now branch to airtable-poll"
```

---

## Task 6: Index for the gate / last-sync reads

**Files:**
- Create (via migration tool): `supabase/migrations/<generated>_airtable_sync_log_org_synced_idx.sql`

- [ ] **Step 1: Apply the migration**

Use the Supabase MCP `apply_migration` with name `airtable_sync_log_org_synced_idx` and this SQL (the tool writes the file with a real-timestamp version — name the file to match):

```sql
-- Speeds the per-org "last poll" read that drives the airtable-poll interval gate,
-- and the Settings → Airtable "last sync" panel (fetchLatestSyncLog). Both query
-- airtable_sync_log by org_id + sync_type ordered by synced_at DESC.
CREATE INDEX IF NOT EXISTS idx_airtable_sync_log_org_synced
  ON public.airtable_sync_log (org_id, sync_type, synced_at DESC);
```

- [ ] **Step 2: Verify the index exists**

Run (MCP `execute_sql`):

```sql
SELECT indexname FROM pg_indexes
WHERE tablename = 'airtable_sync_log' AND indexname = 'idx_airtable_sync_log_org_synced';
```
Expected: one row.

- [ ] **Step 3: Commit the generated migration file**

```bash
git add supabase/migrations/
git commit -m "perf: index airtable_sync_log(org_id, sync_type, synced_at)"
```

---

## Task 7: `triggerAirtableSyncNow` data helper

**Files:**
- Modify: `src/data/airtableSync.ts`

**Interfaces:**
- Produces: `triggerAirtableSyncNow(client, orgId): Promise<SyncNowResult>` and `SyncNowResult`. Thin wrapper over `supabase.functions.invoke('airtable-poll', { body: { org_id } })` — verified by build + preview (the `functions.invoke` layer isn't covered by the read/write fake).

- [ ] **Step 1: Add the helper**

Append to `src/data/airtableSync.ts` (keep the existing imports of `SupabaseClient`/`Database` — they are already present in this file):

```ts
export interface SyncNowResult {
  ok: boolean;
  orgs_synced: number;
  result: { processed: number; new_dates: number; updated: number; held: number; tiers_opened: number } | null;
}

/**
 * Trigger an immediate Airtable poll for one org (the "Sync now" button). Calls the
 * airtable-poll function with a JWT (attached by supabase-js) + org_id, hitting its
 * scoped org-admin branch — a single-org sync that bypasses the interval gate.
 */
export async function triggerAirtableSyncNow(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<SyncNowResult> {
  const { data, error } = await client.functions.invoke("airtable-poll", { body: { org_id: orgId } });
  if (error) throw error;
  return data as SyncNowResult;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.app.json` (or `npm run build`)
Expected: no new type errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/data/airtableSync.ts
git commit -m "feat: triggerAirtableSyncNow data helper"
```

---

## Task 8: Airtable Sync tab UI — interval, status line, Sync now, rate note

**Files:**
- Modify: `src/components/settings/AirtableSyncTab.tsx`

**Interfaces:**
- Consumes: `POLL_INTERVAL_PRESETS`, `formatInterval`, `nextSyncAt` (Task 1); `triggerAirtableSyncNow`, `SyncNowResult` (Task 7); existing `s.airtable_poll_interval_minutes`, `saveSettings`, `syncLogQ`, `keyPresent`.

- [ ] **Step 1: Add imports**

Near the other `@/data` / `@/lib` imports at the top of the file, add:

```ts
import { POLL_INTERVAL_PRESETS, formatInterval, nextSyncAt } from "@/lib/airtablePoll";
import { triggerAirtableSyncNow, type SyncNowResult } from "@/data/airtableSync";
```

`Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`, `Button`, `toast`, `useMutation` are already imported in this file.

- [ ] **Step 2: Add the `syncNow` mutation**

Next to the other mutations in the component (e.g. right after `saveSettings`), add:

```ts
  const syncNow = useMutation({
    mutationFn: () => triggerAirtableSyncNow(supabase, orgId!),
    onSuccess: (res: SyncNowResult) => {
      if (res.result) {
        toast.success(`Synced — ${res.result.new_dates} new, ${res.result.updated} updated`);
      } else {
        toast.success("Sync ran — see the report below");
      }
      qc.invalidateQueries({ queryKey: ["airtable", "sync-log", orgId] });
      qc.invalidateQueries({ queryKey: ["airtable", "unresolved", orgId] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Sync failed"),
  });
```

- [ ] **Step 3: Add the interval control + status line + Sync now**

In the JSX, immediately after the "Enable toggle" `</div>` block (the one containing the `Switch` bound to `airtable_sync_enabled`) and before the `<Separator />` that follows it, insert:

```tsx
          {/* Poll interval + cadence transparency */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1.5">
              <Label className="font-medium">Sync frequency</Label>
              <Select
                value={String(s.airtable_poll_interval_minutes)}
                onValueChange={(v) => saveSettings.mutate({ airtable_poll_interval_minutes: Number(v) })}
              >
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POLL_INTERVAL_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Shorter = fresher data but more Airtable API calls (Airtable allows ~5 requests/sec per base)
                and more writes each cycle. Runs on the shared 5-minute cycle.
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Button
                variant="outline" size="sm"
                disabled={!s.airtable_sync_enabled || !keyPresent || syncNow.isPending}
                onClick={() => syncNow.mutate()}
              >
                {syncNow.isPending ? "Syncing…" : "Sync now"}
              </Button>
              <p className="text-xs text-muted-foreground text-right">
                {(() => {
                  const last = syncLogQ.data?.synced_at ?? null;
                  if (!last) return "Not synced yet — runs on the next cycle.";
                  const next = nextSyncAt(last, s.airtable_poll_interval_minutes);
                  const lastStr = new Date(last).toLocaleString();
                  const nextStr = next ? next.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
                  return `Last synced ${lastStr} · next ~${nextStr} (every ${formatInterval(s.airtable_poll_interval_minutes)})`;
                })()}
              </p>
            </div>
          </div>
```

(If `syncLogQ.data` has no `synced_at` field in scope, confirm `fetchLatestSyncLog` selects `synced_at` — it does — so `syncLogQ.data?.synced_at` is valid.)

- [ ] **Step 4: Verify in the preview**

Start the dev server (preview_start), open Settings → Airtable Sync as an admin, and confirm:
- The "Sync frequency" dropdown shows the 7 presets and reflects the saved value.
- Changing it autosaves (the AutosaveStatus pill flips to "saved").
- "Sync now" is disabled when sync is off or no key; enabled otherwise.
- The status line reads "Last synced … · next ~…" (or the not-synced-yet copy).

Use `preview_snapshot` / `preview_inspect` to confirm the control and copy render; `preview_console_logs` for errors.

- [ ] **Step 5: Run lint + build**

Run: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/AirtableSyncTab.tsx
git commit -m "feat: poll-interval control, Sync now, cadence line in Airtable tab"
```

---

## Task 9: Platform default (super-admin) — Airtable sync defaults card

**Files:**
- Modify: `src/components/platform/PlatformDefaultsTab.tsx`

**Interfaces:**
- Consumes: existing `resolveOrgSetting(client, null, ...)` + `savePlatformSetting(client, key, value)` from `@/data/*` (already imported in this file); `POLL_INTERVAL_PRESETS`, `formatInterval` (Task 1); `MIN_POLL_INTERVAL_MINUTES` from `@/lib/airtablePoll`.

- [ ] **Step 1: Add imports**

At the top of `PlatformDefaultsTab.tsx`, add:

```ts
import { POLL_INTERVAL_PRESETS, MIN_POLL_INTERVAL_MINUTES } from "@/lib/airtablePoll";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
```

(`savePlatformSetting` and `resolveOrgSetting` are already imported; `Card`, `Button`, `Label`, `Skeleton` too.)

- [ ] **Step 2: Add the card component**

Add a new component in the same file:

```tsx
/** Platform-wide default Airtable poll interval (org_id IS NULL). Orgs override it in
 *  Settings → Airtable Sync. */
function AirtableDefaultsCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["platform", "airtable-interval"],
    queryFn: () => resolveOrgSetting<number>(supabase, null, "airtable_poll_interval_minutes", MIN_POLL_INTERVAL_MINUTES),
  });

  const save = useMutation({
    mutationFn: (minutes: number) => savePlatformSetting(supabase, "airtable_poll_interval_minutes", minutes as unknown as Json),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform", "airtable-interval"] });
      qc.invalidateQueries({ queryKey: ["airtable", "settings"] }); // org tabs inherit this default
      toast.success("Airtable sync default saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Airtable sync defaults</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Default polling frequency for organizations that haven't set their own in
          Settings → Airtable Sync. The poll runs on a shared 5-minute cycle; this sets how
          often each org is actually synced.
        </p>
        <div className="space-y-1.5 max-w-xs">
          <Label>Default sync frequency</Label>
          <Select value={String(data ?? MIN_POLL_INTERVAL_MINUTES)} onValueChange={(v) => save.mutate(Number(v))}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {POLL_INTERVAL_PRESETS.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Render the card**

In the top-level `PlatformDefaultsTab` return, add `<AirtableDefaultsCard />` after `<BookingEngineDefaultsCard />`:

```tsx
  return (
    <div className="space-y-6">
      <StarterCatalogCard />
      <BookingEngineDefaultsCard />
      <AirtableDefaultsCard />
    </div>
  );
```

- [ ] **Step 4: Verify in the preview**

As a super-admin, open Platform → Defaults and confirm the "Airtable sync defaults" card renders, shows the current default, and saving toasts success. `preview_snapshot` to confirm; `preview_console_logs` for errors.

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/platform/PlatformDefaultsTab.tsx
git commit -m "feat: super-admin Airtable poll-interval default"
```

---

## Task 10: Docs + release (system map, CLAUDE.md, changelog, version bump)

**Files:**
- Modify: `src/data/systemMap.ts`, `docs/system-map.md`, `CLAUDE.md`, `public/changelog.md`, `public/changelog.json`, `package.json`, `src/config/app.config.ts`

- [ ] **Step 1: Update the in-app system map (`src/data/systemMap.ts`)**

In the `c_poll` node's `detail`, add a `Note` key describing the gate. Change the node so `detail` includes:

```ts
    detail: {
      Fires: "airtable-poll",
      Auth: "X-Cron-Secret from Vault via private.cron_secret()",
      Note: "per-org interval gate: skips an org until airtable_poll_interval_minutes has elapsed (min 5, 60s grace)",
      Cite: "supabase/migrations/20260624101342_cron_dispatch_timeout.sql",
    },
```

In the `f_poll` node, update `sub` and `detail`:

```ts
    label: "airtable-poll",
    sub: "cron fan-out · org-admin Sync now",
    subsystems: ["airtable"],
    detail: {
      Trigger: "cron every 5 min (per-org interval gate) + Settings → Airtable 'Sync now' (single org)",
      Auth: "requireCronSecret (fan-out) OR requireOrgRole(admin)+org_id (one org) · verify_jwt=false",
      Writes: "shows, show_dates, airtable_sync_log(+record), notifications (airtable_sync_held)",
      Effects: "invokes open-offer-tier per NEW date (tier 1, batches of 10) · Airtable Data+Meta API",
      Failure: "per-org isolation; idempotent by airtable_record_id",
      Cite: "airtable-poll/index.ts",
    },
```

- [ ] **Step 2: Update the narrative map (`docs/system-map.md`)**

Read `docs/system-map.md`, find the airtable-poll trigger and function entries, and update them to state:
- the cron ticks every 5 min but each org is **gated** by `airtable_poll_interval_minutes` (min 5, 60s grace, read from `airtable_sync_log.synced_at`);
- there is a second entry point — an **org-admin "Sync now"** (`requireOrgRole(admin)` + `org_id`) that syncs one org immediately, bypassing the gate.

- [ ] **Step 3: One line in `CLAUDE.md`**

In `CLAUDE.md`, in the Airtable-sync bullet under "Edge functions", change the `airtable-poll` description to note the gate. Find `` `airtable-poll` is the `*/5 * * * *` cron `` and extend that sentence to: "… cron (each org is throttled by its `airtable_poll_interval_minutes` setting, min 5; an org-admin 'Sync now' triggers a single-org poll on demand)."

- [ ] **Step 4: Add the changelog block**

Prepend to `public/changelog.md` (newest-first, right below the `What's new…` intro line, above `## 1.7.0`):

```markdown
## 1.8.0 — July 5, 2026

*Control your Airtable sync cadence*

### New
- **Choose how often Airtable syncs** — Pick a polling frequency per organization, from every 5 minutes up to every 8 hours, in Settings → Airtable Sync.
- **Sync now** — Pull the latest from Airtable immediately, between scheduled cycles, with one click.

### Improved
- **See your sync cadence at a glance** — The Airtable Sync tab shows when it last synced and when the next sync is due.
```

- [ ] **Step 5: Regenerate the changelog JSON**

Run: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
Expected: `public/changelog.json` rewritten with the 1.8.0 block first. Do NOT hand-edit the JSON.

- [ ] **Step 6: Bump the version in both places**

In `package.json`, change `"version": "1.7.0"` → `"version": "1.8.0"`.
In `src/config/app.config.ts`, change `VERSION: '1.7.0'` → `VERSION: '1.8.0'`.

- [ ] **Step 7: Verify build + full test suites**

Run:
```bash
npm run build
npx vitest run
deno test --allow-all --node-modules-dir=none supabase/functions/airtable-poll/
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/data/systemMap.ts docs/system-map.md CLAUDE.md public/changelog.md public/changelog.json package.json src/config/app.config.ts
git commit -m "docs: system map + changelog for airtable poll interval (v1.8.0)"
```

---

## Self-Review notes (author)

- **Spec coverage:** interval gate (T3–T4), presets (T1), reuse existing key (T2/T4), Sync now (T5/T7/T8), last/next-sync line (T8), platform default (T9), rate-limit note (T8), index (T6), docs+release (T10). All spec sections map to a task.
- **Type consistency:** `syncOneOrg(deps, orgId) → OrgSyncResult | null` used identically in the loop (T3/T4) and the sync-now branch (T5). `SyncNowResult.result` shape matches `OrgSyncResult` fields consumed in T8. `clampInterval` (frontend, T1) vs `clampIntervalMinutes` (edge, T4) are intentionally separate (two runtimes) with identical semantics.
- **Auth-contract change:** exactly ONE existing test changes (JWT-without-org_id: 401 → 400); the cron-secret 401 tests are unaffected because they carry the `X-Cron-Secret` header (or no Authorization at all → still 401 via the Bearer check). Called out explicitly in T5.
- **No config.toml change:** `airtable-poll` stays `verify_jwt=false`; the handler authenticates both paths itself.
