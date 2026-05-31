# Testability Foundation (Part 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a shared test harness for both runtimes and convert every Supabase edge function to dependency injection, so Parts 1–3 become "write real tests + fix bugs."

**Architecture:** Two test seams. Frontend: data-access functions `fetchX(client, args)` driven by a call-recording fake Supabase client + a React Query render harness. Backend: each edge function becomes `handle(req, deps)` with `Deno.serve((req) => handle(req, realDeps()))`, where `deps` carries the Supabase clients, env, clock, function-invoker, and fetch. Two pilots are converted **with real tests** to validate the seam; the rest are converted mechanically with smoke tests.

**Tech Stack:** Vitest + jsdom + @testing-library/react (frontend); Deno test (edge functions); TypeScript; Supabase JS v2.

**Spec:** `docs/superpowers/specs/2026-06-01-testability-foundation-part0-design.md`

---

## Phases (= the 3 PRs on `dev`)

| Phase | PR | Tasks | Independently shippable? |
|---|---|---|---|
| **A** | PR A — Harness + conventions | A1–A10 | Yes (no production behavior change) |
| **B** | PR B — Pilot DI | B1–B2 | Yes (depends on A5–A8) |
| **C** | PR C — DI rollout | C1–C12 | Yes (depends on A5–A8, B) |

**Dependency note:** Phases B and C depend only on the Deno shared modules from Phase A (A5–A8), not on the frontend harness. Execute A → B → C in order.

---

## Conventions & key facts (read before starting)

- **Working branch:** `dev`. Commit after every task.
- **Run one Vitest file:** `npx vitest run <path>` · **watch:** `npm run test:watch`
- **Run one Deno test file:** `deno test --allow-all <path>` · **all fn tests:** `deno test --allow-all supabase/functions/`
- **Typecheck / lint:** `npm run build` (tsc via Vite) · `npm run lint` · `deno check <path>`
- **Never edit** `src/integrations/supabase/client.ts` or `src/integrations/supabase/types.ts` (auto-generated). The data-access pattern passes the existing `supabase` singleton **into** functions; it never modifies the client.
- **Email is sent by invoking an edge function**, not a raw Resend call: existing code does `admin.functions.invoke('send-transactional-email', { body })`. In DI this becomes `deps.sendEmail(msg)`, a convenience over `deps.invokeFunction(name, body)`.
- **`new Date()` / `Date.now()` inside handlers becomes `deps.now()`** so time-gated logic (Berlin-hour digests, offer expiry) is testable.
- **Auth modes vary by function** (cron-secret, user-JWT admin / admin-or-producer, service-role bypass, HMAC webhook, token, public). Phase A builds shared auth helpers covering the JWT + cron-secret cases; webhook/token/public functions keep their own checks.
- **`types.ts` is stale for the `bookings` table** (missing `offered_at`, `offer_expires_at`, `digest_sent_at`, `offer_tier`); edge functions already use `(admin as any)` for these. Do not try to fix types here — regen is a Part 3 item. Frontend fixtures do not need those columns.
- **Existing fake edge-function tests stay untouched in Part 0** (they pass harmlessly). Part 1 replaces them. The pilots (B) get brand-new `*.di.test.ts` files so we don't collide with the existing `index.test.ts`.

### Function conversion-difficulty ranking (drives Phase C order)

| Function | Difficulty | Auth | Uses `now`? | Email/invoke? | Raw fetch? |
|---|---|---|---|---|---|
| admin-list-users | EASY | JWT admin | no | no | no |
| admin-set-role | EASY | JWT admin | no | no | no |
| admin-decide-approval | EASY | JWT admin | yes | sendEmail | no |
| notify-signup | EASY | public (db webhook) | no | sendEmail | no |
| handle-email-unsubscribe | MEDIUM | token | yes | no | no |
| preview-transactional-email | MEDIUM | JWT admin/producer | no | no | no |
| send-confirmation-digest | MEDIUM | cron OR JWT admin/producer | yes | sendEmail | no |
| tier-at-risk-watcher | MEDIUM | cron OR JWT admin/producer | no | no | no |
| airtable-poll | HARD | cron-secret | yes | invokeFunction(open-offer-tier) | yes (Airtable) |
| handle-email-suppression | HARD | HMAC webhook | no (`Date.now()` in sig) | no | no |
| send-transactional-email | HARD | public | yes | n/a (is the email impl) | yes (Resend) |

---

# PHASE A — Harness, shared infra, CLAUDE.md (PR A)

### Task A1: Frontend — `createTestQueryClient`

**Files:**
- Create: `src/test/queryClient.ts`
- Test: `src/test/queryClient.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/queryClient.test.ts
import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createTestQueryClient } from "./queryClient";

describe("createTestQueryClient", () => {
  it("returns a QueryClient with retries disabled", () => {
    const qc = createTestQueryClient();
    expect(qc).toBeInstanceOf(QueryClient);
    expect(qc.getDefaultOptions().queries?.retry).toBe(false);
  });

  it("returns a fresh instance each call", () => {
    expect(createTestQueryClient()).not.toBe(createTestQueryClient());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/queryClient.test.ts`
Expected: FAIL — `Failed to resolve import "./queryClient"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/test/queryClient.ts
import { QueryClient } from "@tanstack/react-query";

/** A QueryClient configured for tests: no retries, no refetch noise. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/queryClient.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/test/queryClient.ts src/test/queryClient.test.ts
git commit -m "test: add createTestQueryClient harness helper"
```

---

### Task A2: Frontend — `renderWithProviders` + `renderHookWithProviders`

**Files:**
- Create: `src/test/renderWithProviders.tsx`
- Test: `src/test/renderWithProviders.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/test/renderWithProviders.test.tsx
import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { renderWithProviders, renderHookWithProviders } from "./renderWithProviders";

describe("renderWithProviders", () => {
  it("renders children inside a QueryClientProvider", async () => {
    function Probe() {
      const q = useQuery({ queryKey: ["probe"], queryFn: async () => "ok" });
      return <div>{q.data ?? "loading"}</div>;
    }
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());
  });
});

describe("renderHookWithProviders", () => {
  it("runs a hook that uses react-query", async () => {
    const { result } = renderHookWithProviders(() =>
      useQuery({ queryKey: ["h"], queryFn: async () => 42 }),
    );
    await waitFor(() => expect(result.current.data).toBe(42));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/renderWithProviders.test.tsx`
Expected: FAIL — cannot resolve `./renderWithProviders`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/test/renderWithProviders.tsx
import React from "react";
import { render, renderHook, type RenderOptions } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createTestQueryClient } from "./queryClient";

interface Options {
  queryClient?: QueryClient;
}

function Wrapper({ queryClient, children }: { queryClient: QueryClient; children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** Render a component with a QueryClientProvider. Returns the testing-library result + the queryClient. */
export function renderWithProviders(ui: React.ReactElement, opts: Options & Omit<RenderOptions, "wrapper"> = {}) {
  const { queryClient = createTestQueryClient(), ...rtl } = opts;
  const result = render(ui, {
    wrapper: ({ children }) => <Wrapper queryClient={queryClient}>{children}</Wrapper>,
    ...rtl,
  });
  return { ...result, queryClient };
}

/** renderHook variant wrapped in a QueryClientProvider. */
export function renderHookWithProviders<TResult, TProps>(
  hook: (props: TProps) => TResult,
  opts: Options = {},
) {
  const { queryClient = createTestQueryClient() } = opts;
  const result = renderHook(hook, {
    wrapper: ({ children }) => <Wrapper queryClient={queryClient}>{children}</Wrapper>,
  });
  return { ...result, queryClient };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/renderWithProviders.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/test/renderWithProviders.tsx src/test/renderWithProviders.test.tsx
git commit -m "test: add renderWithProviders + renderHookWithProviders harness"
```

---

### Task A3: Frontend — call-recording fake Supabase client

**Files:**
- Create: `src/test/supabaseFake.ts`
- Test: `src/test/supabaseFake.test.ts`

The fake records every chained call so tests can assert *which table / columns / filters* were queried, and resolves terminals (`await`, `.maybeSingle()`, `.single()`, `.rpc()`) to per-table seeded results.

- [ ] **Step 1: Write the failing test**

```ts
// src/test/supabaseFake.test.ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "./supabaseFake";

describe("createFakeSupabase", () => {
  it("resolves a seeded table result when awaited", async () => {
    const fake = createFakeSupabase({ artists: { data: [{ id: "a1" }], error: null } });
    const res = await fake.from("artists").select("*").eq("status", "active");
    expect(res).toEqual({ data: [{ id: "a1" }], error: null });
  });

  it("resolves maybeSingle to the seeded result", async () => {
    const fake = createFakeSupabase({ artists: { data: { id: "a1" }, error: null } });
    const res = await fake.from("artists").select("*").eq("user_id", "u1").maybeSingle();
    expect(res).toEqual({ data: { id: "a1" }, error: null });
  });

  it("records the table, methods, and arguments used", async () => {
    const fake = createFakeSupabase({ artists: { data: null, error: null } });
    await fake.from("artists").select("id").eq("user_id", "u1").maybeSingle();
    expect(fake.calls).toEqual([
      { table: "artists", method: "from", args: [] },
      { table: "artists", method: "select", args: ["id"] },
      { table: "artists", method: "eq", args: ["user_id", "u1"] },
      { table: "artists", method: "maybeSingle", args: [] },
    ]);
  });

  it("defaults unseeded tables to an empty result", async () => {
    const fake = createFakeSupabase({});
    expect(await fake.from("whatever").select("*")).toEqual({ data: [], error: null });
  });

  it("resolves rpc() to a seeded rpc result and records it", async () => {
    const fake = createFakeSupabase({ "rpc:my_fn": { data: 7, error: null } });
    expect(await fake.rpc("my_fn", { x: 1 })).toEqual({ data: 7, error: null });
    expect(fake.calls).toContainEqual({ table: "rpc:my_fn", method: "rpc", args: [{ x: 1 }] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/supabaseFake.test.ts`
Expected: FAIL — cannot resolve `./supabaseFake`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/test/supabaseFake.ts
export interface FakeResult {
  data?: unknown;
  error?: unknown;
}
export interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/** Chainable query-builder methods that return `this` and record their call. */
const CHAIN_METHODS = [
  "select", "insert", "update", "upsert", "delete",
  "eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "or", "not", "match",
  "order", "limit", "range", "filter", "contains", "overlaps",
] as const;

/** Terminal methods that resolve to the seeded result. */
const TERMINAL_METHODS = ["single", "maybeSingle"] as const;

/**
 * A minimal, call-recording stand-in for the supabase-js client.
 * Seed is keyed by table name (or `rpc:<name>`) → { data, error }.
 */
export function createFakeSupabase(seed: Record<string, FakeResult> = {}) {
  const calls: RecordedCall[] = [];

  function builder(table: string) {
    const result: FakeResult = seed[table] ?? { data: [], error: null };
    const chain: Record<string, unknown> = {};

    for (const m of CHAIN_METHODS) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return chain;
      };
    }
    for (const m of TERMINAL_METHODS) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return Promise.resolve(result);
      };
    }
    // Make the builder awaitable (thenable) so `await fake.from(t).select()...` resolves.
    chain.then = (onFulfilled: (v: FakeResult) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected);

    return chain;
  }

  return {
    calls,
    from(table: string) {
      calls.push({ table, method: "from", args: [] });
      return builder(table);
    },
    rpc(name: string, params?: unknown) {
      calls.push({ table: `rpc:${name}`, method: "rpc", args: [params] });
      return Promise.resolve(seed[`rpc:${name}`] ?? { data: null, error: null });
    },
  };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/supabaseFake.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/test/supabaseFake.ts src/test/supabaseFake.test.ts
git commit -m "test: add call-recording fake supabase client (frontend)"
```

---

### Task A4: Frontend — domain fixtures

**Files:**
- Create: `src/test/fixtures.ts`
- Test: `src/test/fixtures.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/fixtures.test.ts
import { describe, it, expect } from "vitest";
import { anArtist, aShowDate, aBooking } from "./fixtures";

describe("fixtures", () => {
  it("anArtist returns a valid default row", () => {
    const a = anArtist();
    expect(a.id).toBeTruthy();
    expect(a.name).toBeTruthy();
    expect(a.status).toBe("active");
  });

  it("applies overrides", () => {
    expect(anArtist({ name: "Jo", status: "inactive" })).toMatchObject({ name: "Jo", status: "inactive" });
  });

  it("aShowDate and aBooking return overridable rows", () => {
    expect(aShowDate({ city_id: "c1" }).city_id).toBe("c1");
    expect(aBooking({ status: "confirmed" }).status).toBe("confirmed");
  });

  it("gives distinct ids across calls", () => {
    expect(anArtist().id).not.toBe(anArtist().id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/fixtures.test.ts`
Expected: FAIL — cannot resolve `./fixtures`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/test/fixtures.ts
import type { Database } from "@/integrations/supabase/types";

type ArtistRow = Database["public"]["Tables"]["artists"]["Row"];
type ShowDateRow = Database["public"]["Tables"]["show_dates"]["Row"];
type BookingRow = Database["public"]["Tables"]["bookings"]["Row"];

let seq = 0;
/** Deterministic-but-unique id generator (no Math.random / Date in fixtures). */
function id(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq.toString().padStart(8, "0")}`;
}
const ISO = "2026-01-01T00:00:00.000Z";

export function anArtist(overrides: Partial<ArtistRow> = {}): ArtistRow {
  return {
    id: id("artist"),
    name: "Test Artist",
    email: "artist@example.com",
    phone: null,
    bio: null,
    status: "active",
    user_id: id("user"),
    created_at: ISO,
    updated_at: ISO,
    ...overrides,
  };
}

export function aShowDate(overrides: Partial<ShowDateRow> = {}): ShowDateRow {
  return {
    id: id("show-date"),
    show_id: id("show"),
    city_id: id("city"),
    date: "2026-02-01",
    session_1: "19:00",
    session_2: null,
    session_3: null,
    venue: null,
    notes: null,
    airtable_record_id: null,
    status: "open",
    created_at: ISO,
    updated_at: ISO,
    ...overrides,
  };
}

export function aBooking(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: id("booking"),
    show_date_id: id("show-date"),
    artist_id: id("artist"),
    status: "suggested",
    is_understudy: false,
    booked_by: null,
    notes: null,
    cancellation_reason: null,
    cancelled_at: null,
    confirmed_at: null,
    created_at: ISO,
    updated_at: ISO,
    ...overrides,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/fixtures.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/test/fixtures.ts src/test/fixtures.test.ts
git commit -m "test: add typed domain fixtures (artist, show_date, booking)"
```

---

### Task A5: Backend — `_shared/http.ts` (CORS + json)

**Files:**
- Create: `supabase/functions/_shared/http.ts`
- Test: `supabase/functions/_shared/http.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/http.test.ts
import { assertEquals } from "./test-asserts.ts";
import { corsHeaders, json, preflight } from "./http.ts";

Deno.test("json sets status, body, and CORS + content-type headers", async () => {
  const res = json({ ok: true }, 201);
  assertEquals(res.status, 201);
  assertEquals(res.headers.get("Content-Type"), "application/json");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(await res.json(), { ok: true });
});

Deno.test("json defaults to status 200", () => {
  assertEquals(json({}).status, 200);
});

Deno.test("preflight returns a CORS 204 for OPTIONS", () => {
  const res = preflight();
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("corsHeaders allows the x-cron-secret header", () => {
  assertEquals(corsHeaders["Access-Control-Allow-Headers"].includes("x-cron-secret"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all supabase/functions/_shared/http.test.ts`
Expected: FAIL — module `./http.ts` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// supabase/functions/_shared/http.ts
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/** JSON response with CORS + content-type headers. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Standard CORS preflight response. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all supabase/functions/_shared/http.test.ts`
Expected: PASS (4 tests).

> **Behavior note:** existing functions return `new Response(null, { headers: corsHeaders })` (status 200) for OPTIONS; `preflight()` standardizes on 204. Both are valid preflight responses; the smoke tests in Phase C assert "status is 200 or 204" to stay tolerant.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/http.ts supabase/functions/_shared/http.test.ts
git commit -m "feat(functions): add shared CORS + json http helpers"
```

---

### Task A6: Backend — `_shared/deps.ts` (Deps interface + realDeps)

**Files:**
- Create: `supabase/functions/_shared/deps.ts`
- Test: `supabase/functions/_shared/deps.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/deps.test.ts
import { assertEquals, assertExists } from "./test-asserts.ts";
import { realDeps } from "./deps.ts";

Deno.test("realDeps exposes the full Deps surface", () => {
  const env: Record<string, string> = {
    SUPABASE_URL: "http://localhost",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    SUPABASE_ANON_KEY: "anon",
  };
  const deps = realDeps((k) => env[k]);
  assertExists(deps.admin);
  assertEquals(typeof deps.userClient, "function");
  assertEquals(typeof deps.env, "function");
  assertEquals(typeof deps.now, "function");
  assertEquals(typeof deps.invokeFunction, "function");
  assertEquals(typeof deps.sendEmail, "function");
  assertEquals(typeof deps.fetch, "function");
  assertEquals(deps.env("SUPABASE_ANON_KEY"), "anon");
  assertEquals(deps.now() instanceof Date, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all supabase/functions/_shared/deps.test.ts`
Expected: FAIL — module `./deps.ts` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// supabase/functions/_shared/deps.ts
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface EmailMessage {
  template_name: string;
  recipient_email: string;
  templateData?: Record<string, unknown>;
  idempotency_key?: string;
}

export interface InvokeResult {
  data: unknown;
  error: unknown;
}

/** Everything a handler touches that is environment- or time-dependent. Injected so tests can fake it. */
export interface Deps {
  admin: SupabaseClient;
  userClient: (authHeader: string) => SupabaseClient;
  env: (key: string) => string | undefined;
  now: () => Date;
  invokeFunction: (name: string, body: unknown) => Promise<InvokeResult>;
  sendEmail: (msg: EmailMessage) => Promise<InvokeResult>;
  fetch: typeof fetch;
}

/**
 * Build the production Deps from the environment.
 * `getEnv` is injectable purely so this is unit-testable; production calls realDeps().
 */
export function realDeps(getEnv: (k: string) => string | undefined = (k) => Deno.env.get(k)): Deps {
  const url = getEnv("SUPABASE_URL") ?? "";
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = getEnv("SUPABASE_ANON_KEY") ?? "";
  const admin = createClient(url, serviceKey);

  const invokeFunction = async (name: string, body: unknown): Promise<InvokeResult> => {
    const { data, error } = await admin.functions.invoke(name, { body });
    return { data, error };
  };

  return {
    admin,
    userClient: (authHeader: string) =>
      createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } }),
    env: getEnv,
    now: () => new Date(),
    invokeFunction,
    sendEmail: (msg: EmailMessage) => invokeFunction("send-transactional-email", msg),
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all supabase/functions/_shared/deps.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/deps.ts supabase/functions/_shared/deps.test.ts
git commit -m "feat(functions): add Deps interface + realDeps factory"
```

---

### Task A7: Backend — `_shared/testing.ts` (fake deps + fake client + request builder)

**Files:**
- Create: `supabase/functions/_shared/testing.ts`
- Test: `supabase/functions/_shared/testing.test.ts`

This is the Deno analogue of the frontend fake client, plus a `makeFakeDeps()` builder and a `makeRequest()` helper. It powers every backend DI test (Phases B and C).

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/testing.test.ts
import { assertEquals } from "./test-asserts.ts";
import { createFakeClient, makeFakeDeps, makeRequest } from "./testing.ts";

Deno.test("fake client resolves seeded table + records calls", async () => {
  const { client, calls } = createFakeClient({ tables: { user_roles: { data: { role: "admin" }, error: null } } });
  const res = await client.from("user_roles").select("role").eq("user_id", "u1").maybeSingle();
  assertEquals(res, { data: { role: "admin" }, error: null });
  assertEquals(calls[0], { table: "user_roles", method: "from", args: [] });
});

Deno.test("fake client resolves seeded rpc", async () => {
  const { client } = createFakeClient({ rpcs: { my_rpc: { data: [1], error: null } } });
  assertEquals(await client.rpc("my_rpc", { a: 1 }), { data: [1], error: null });
});

Deno.test("fake admin.auth.getUser returns the seeded user", async () => {
  const { client } = createFakeClient({ authUser: { id: "u9" } });
  const { data } = await client.auth.getUser();
  assertEquals(data.user, { id: "u9" });
});

Deno.test("makeFakeDeps wires env, now, and records invokeFunction calls", async () => {
  const fixedNow = new Date("2026-06-01T17:00:00.000Z");
  const { deps, invokeCalls } = makeFakeDeps({ envVars: { SUPABASE_URL: "x" }, now: fixedNow });
  assertEquals(deps.env("SUPABASE_URL"), "x");
  assertEquals(deps.now().getTime(), fixedNow.getTime());
  await deps.sendEmail({ template_name: "t", recipient_email: "e@x.com" });
  assertEquals(invokeCalls[0].name, "send-transactional-email");
});

Deno.test("makeRequest builds a Request with headers + JSON body", async () => {
  const req = makeRequest({ method: "POST", headers: { "X-Cron-Secret": "s" }, body: { a: 1 } });
  assertEquals(req.method, "POST");
  assertEquals(req.headers.get("X-Cron-Secret"), "s");
  assertEquals(await req.json(), { a: 1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all supabase/functions/_shared/testing.test.ts`
Expected: FAIL — module `./testing.ts` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// supabase/functions/_shared/testing.ts
import type { Deps, EmailMessage, InvokeResult } from "./deps.ts";

export interface RecordedCall { table: string; method: string; args: unknown[]; }
export interface FakeClientOptions {
  tables?: Record<string, { data?: unknown; error?: unknown }>;
  rpcs?: Record<string, { data?: unknown; error?: unknown }>;
  authUser?: { id: string } | null;
  claims?: { sub: string } | null;
  usersById?: Record<string, { email?: string }>;
}

const CHAIN = [
  "select", "insert", "update", "upsert", "delete",
  "eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "or", "not", "match",
  "order", "limit", "range", "filter",
];

/** A call-recording stand-in for a Supabase client (admin or user). */
export function createFakeClient(opts: FakeClientOptions = {}) {
  const calls: RecordedCall[] = [];
  const tables = opts.tables ?? {};
  const rpcs = opts.rpcs ?? {};

  function builder(table: string) {
    const result = tables[table] ?? { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const m of CHAIN) {
      chain[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return chain; };
    }
    for (const m of ["single", "maybeSingle"]) {
      chain[m] = () => { calls.push({ table, method: m, args: [] }); return Promise.resolve(result); };
    }
    chain.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(f, r);
    return chain;
  }

  const client = {
    from(table: string) { calls.push({ table, method: "from", args: [] }); return builder(table); },
    rpc(name: string, params?: unknown) {
      calls.push({ table: `rpc:${name}`, method: "rpc", args: [params] });
      return Promise.resolve(rpcs[name] ?? { data: null, error: null });
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user: opts.authUser ?? null }, error: null }),
      getClaims: (_token?: string) => Promise.resolve({ data: opts.claims ? { claims: opts.claims } : null, error: null }),
      admin: {
        getUserById: (id: string) =>
          Promise.resolve({ data: { user: opts.usersById?.[id] ? { id, ...opts.usersById[id] } : null }, error: null }),
        listUsers: () =>
          Promise.resolve({ data: { users: Object.entries(opts.usersById ?? {}).map(([id, u]) => ({ id, ...u })) }, error: null }),
      },
    },
    functions: { invoke: (_n: string, _o: unknown) => Promise.resolve({ data: null, error: null }) },
  };
  return { client, calls };
}

export interface FakeDepsOptions extends FakeClientOptions {
  envVars?: Record<string, string>;
  now?: Date;
  fetchImpl?: typeof fetch;
}

/** Build a fake Deps for handler tests. Records invokeFunction/sendEmail calls. */
export function makeFakeDeps(opts: FakeDepsOptions = {}) {
  const { client, calls } = createFakeClient(opts);
  const invokeCalls: Array<{ name: string; body: unknown }> = [];
  const env = opts.envVars ?? {};
  const fixedNow = opts.now ?? new Date("2026-06-01T12:00:00.000Z");

  const invokeFunction = (name: string, body: unknown): Promise<InvokeResult> => {
    invokeCalls.push({ name, body });
    return Promise.resolve({ data: null, error: null });
  };

  const deps: Deps = {
    admin: client as unknown as Deps["admin"],
    userClient: () => client as unknown as Deps["admin"],
    env: (k) => env[k],
    now: () => fixedNow,
    invokeFunction,
    sendEmail: (msg: EmailMessage) => invokeFunction("send-transactional-email", msg),
    fetch: opts.fetchImpl ?? (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch,
  };
  return { deps, calls, invokeCalls, client };
}

/** Build a Request for handler tests. */
export function makeRequest(opts: { method?: string; headers?: Record<string, string>; body?: unknown; url?: string } = {}): Request {
  const { method = "POST", headers = {}, body, url = "http://localhost/fn" } = opts;
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all supabase/functions/_shared/testing.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/testing.ts supabase/functions/_shared/testing.test.ts
git commit -m "feat(functions): add Deno fake client + makeFakeDeps test harness"
```

---

### Task A8: Backend — `_shared/auth.ts` (auth helpers)

**Files:**
- Create: `supabase/functions/_shared/auth.ts`
- Test: `supabase/functions/_shared/auth.test.ts`

Covers the JWT and cron-secret auth modes shared across functions. Returns a discriminated outcome so callers can early-return the error Response.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/auth.test.ts
import { assertEquals } from "./test-asserts.ts";
import { makeFakeDeps, makeRequest } from "./testing.ts";
import { requireRole, requireCronOrRole, isServiceRole } from "./auth.ts";

Deno.test("requireRole rejects a request with no Bearer token (401)", async () => {
  const { deps } = makeFakeDeps();
  const out = await requireRole(deps, makeRequest({ headers: {} }), ["admin"]);
  assertEquals(out.ok, false);
  if (!out.ok) assertEquals(out.response.status, 401);
});

Deno.test("requireRole rejects a valid user lacking the role (403)", async () => {
  const { deps } = makeFakeDeps({ authUser: { id: "u1" }, tables: { user_roles: { data: null, error: null } } });
  const out = await requireRole(deps, makeRequest({ headers: { Authorization: "Bearer jwt" } }), ["admin"]);
  assertEquals(out.ok, false);
  if (!out.ok) assertEquals(out.response.status, 403);
});

Deno.test("requireRole accepts a user with the role and returns userId", async () => {
  const { deps } = makeFakeDeps({ authUser: { id: "u1" }, tables: { user_roles: { data: { role: "admin" }, error: null } } });
  const out = await requireRole(deps, makeRequest({ headers: { Authorization: "Bearer jwt" } }), ["admin", "producer"]);
  assertEquals(out.ok, true);
  if (out.ok) assertEquals(out.userId, "u1");
});

Deno.test("requireCronOrRole accepts a matching cron secret without a JWT", async () => {
  const { deps } = makeFakeDeps({ tables: { app_settings: { data: { value: "secret123" }, error: null } } });
  const out = await requireCronOrRole(deps, makeRequest({ headers: { "X-Cron-Secret": "secret123" } }), ["admin"]);
  assertEquals(out.ok, true);
  if (out.ok) assertEquals(out.userId, null);
});

Deno.test("requireCronOrRole rejects a wrong cron secret (401)", async () => {
  const { deps } = makeFakeDeps({ tables: { app_settings: { data: { value: "secret123" }, error: null } } });
  const out = await requireCronOrRole(deps, makeRequest({ headers: { "X-Cron-Secret": "nope" } }), ["admin"]);
  assertEquals(out.ok, false);
  if (!out.ok) assertEquals(out.response.status, 401);
});

Deno.test("isServiceRole detects the service-role bearer token", () => {
  const { deps } = makeFakeDeps({ envVars: { SUPABASE_SERVICE_ROLE_KEY: "svc" } });
  assertEquals(isServiceRole(deps, makeRequest({ headers: { Authorization: "Bearer svc" } })), true);
  assertEquals(isServiceRole(deps, makeRequest({ headers: { Authorization: "Bearer other" } })), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all supabase/functions/_shared/auth.test.ts`
Expected: FAIL — module `./auth.ts` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// supabase/functions/_shared/auth.ts
import type { Deps } from "./deps.ts";
import { json } from "./http.ts";

export type AuthOutcome =
  | { ok: true; userId: string | null }
  | { ok: false; response: Response };

/** True when the request carries the service-role key as its bearer token. */
export function isServiceRole(deps: Deps, req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return serviceKey !== "" && authHeader === `Bearer ${serviceKey}`;
}

/** Validate a user JWT and require one of `roles`. */
export async function requireRole(deps: Deps, req: Request, roles: string[]): Promise<AuthOutcome> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }
  const { data: { user }, error } = await deps.userClient(authHeader).auth.getUser();
  if (error || !user) return { ok: false, response: json({ error: "Unauthorized" }, 401) };

  const { data: roleRow } = await deps.admin
    .from("user_roles").select("role").eq("user_id", user.id).in("role", roles).maybeSingle();
  if (!roleRow) return { ok: false, response: json({ error: "Forbidden" }, 403) };

  return { ok: true, userId: user.id };
}

/** Accept a valid X-Cron-Secret (vs app_settings.cron_secret) OR fall back to requireRole. */
export async function requireCronOrRole(deps: Deps, req: Request, roles: string[]): Promise<AuthOutcome> {
  const cronSecret = req.headers.get("X-Cron-Secret");
  if (cronSecret) {
    const { data: setting } = await deps.admin
      .from("app_settings").select("value").eq("key", "cron_secret").maybeSingle();
    const stored = ((setting as { value?: string } | null)?.value as string | null) ?? "";
    if (cronSecret !== stored) return { ok: false, response: json({ error: "Unauthorized" }, 401) };
    return { ok: true, userId: null };
  }
  return requireRole(deps, req, roles);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all supabase/functions/_shared/auth.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/auth.ts supabase/functions/_shared/auth.test.ts
git commit -m "feat(functions): add shared auth helpers (requireRole, cron, service-role)"
```

---

### Task A9: Frontend — reference hook (`useMyArtist`) data-access extraction

**Files:**
- Create: `src/data/artists.ts`
- Create: `src/data/artists.test.ts`
- Modify: `src/hooks/useMyArtist.ts`

This proves the frontend harness end-to-end and is the copy-paste template for Part 2.

- [ ] **Step 1: Write the failing test (data-access function)**

```ts
// src/data/artists.test.ts
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { anArtist } from "@/test/fixtures";
import { fetchMyArtist } from "./artists";

describe("fetchMyArtist", () => {
  it("queries the artists table by user_id and returns the row", async () => {
    const artist = anArtist({ user_id: "u1" });
    const fake = createFakeSupabase({ artists: { data: artist, error: null } });
    const result = await fetchMyArtist(fake as never, "u1");
    expect(result).toEqual(artist);
    expect(fake.calls).toContainEqual({ table: "artists", method: "eq", args: ["user_id", "u1"] });
    expect(fake.calls).toContainEqual({ table: "artists", method: "maybeSingle", args: [] });
  });

  it("returns null when no row exists", async () => {
    const fake = createFakeSupabase({ artists: { data: null, error: null } });
    expect(await fetchMyArtist(fake as never, "u1")).toBeNull();
  });

  it("throws when the query errors", async () => {
    const fake = createFakeSupabase({ artists: { data: null, error: { message: "boom" } } });
    await expect(fetchMyArtist(fake as never, "u1")).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/artists.test.ts`
Expected: FAIL — cannot resolve `./artists`.

- [ ] **Step 3: Write the data-access function**

```ts
// src/data/artists.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Artist } from "@/types";

/** Fetch the artists row linked to a given auth user id (or null). */
export async function fetchMyArtist(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<Artist | null> {
  const { data, error } = await client
    .from("artists")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Artist | null) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/artists.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor the hook to use the data-access function**

```ts
// src/hooks/useMyArtist.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveUserId } from '@/features/auth/AuthContext';
import { fetchMyArtist } from '@/data/artists';

/** Returns the `artists` row linked to the current auth user (or impersonated user). */
export function useMyArtist() {
  const userId = useEffectiveUserId();
  return useQuery({
    queryKey: ['my-artist', userId],
    enabled: !!userId,
    queryFn: () => fetchMyArtist(supabase, userId!),
  });
}
```

- [ ] **Step 6: Verify nothing broke**

Run: `npm run build && npx vitest run src/data/artists.test.ts`
Expected: build PASS, tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/artists.ts src/data/artists.test.ts src/hooks/useMyArtist.ts
git commit -m "refactor: extract fetchMyArtist data-access fn as Part 2 template"
```

---

### Task A10: Rewrite CLAUDE.md testing conventions

**Files:**
- Modify: `CLAUDE.md` (the `### Testing` subsection under `## Conventions`, and the `## Things to avoid` list)

- [ ] **Step 1: Replace the `### Testing` subsection**

Find the current `### Testing` block and replace its body with:

```markdown
### Testing

**Test-first is the default.** For any new logic (a pure function, a data-access function, an edge-function branch), write the failing test before the implementation. Bug fixes start with a failing regression test that reproduces the bug.

**The five test layers and when to use each:**

| Layer | Tool | Runs via | Use for |
|---|---|---|---|
| Unit / hook | Vitest + jsdom + @testing-library/react | `npx vitest run` | Pure functions, data-access functions, hooks, components |
| Database | pgTAP | `supabase test db` | Triggers, RLS policies, RPCs (`supabase/tests/`) |
| Edge function | Deno test | `deno test --allow-all supabase/functions/` | Edge-function handlers + shared modules |
| End-to-end | Playwright | `npx playwright test --config=e2e/playwright.config.ts` | Critical cross-stack flows |

CI runs all of these (`.github/workflows/ci.yml`).

**Hard rule: tests import the real module.** Never re-implement production logic inside a test file. If logic is hard to import, that is a signal to extract it — not to copy it into the test.

**Frontend pattern — data-access extraction:** Put Supabase reads/writes in `src/data/<domain>.ts` as `fetchX(client, args)` / `mutateX(client, args)` functions that take the client as a parameter. Hooks are thin wrappers that pass the `supabase` singleton. Test the data-access functions with the call-recording fake client in `src/test/supabaseFake.ts`, and use `src/test/renderWithProviders.tsx` + `src/test/fixtures.ts` for hook/component tests. Do not hand-roll `vi.mock('@/integrations/supabase/client')` chains.

**Backend pattern — dependency injection:** Each edge function exports `handle(req, deps)` and only wires `Deno.serve((req) => handle(req, realDeps()))` at the bottom. `Deps` (in `supabase/functions/_shared/deps.ts`) carries the Supabase clients, `env`, `now`, `invokeFunction`/`sendEmail`, and `fetch`. Tests import `handle` and pass `makeFakeDeps(...)` from `supabase/functions/_shared/testing.ts`. Use the shared `_shared/http.ts` (CORS + json) and `_shared/auth.ts` (requireRole / requireCronOrRole / isServiceRole) helpers — do not re-inline CORS, client creation, or auth.

- Co-locate tests beside the file they test.
- Test behavior, never implementation details (internal state, private methods).
```

- [ ] **Step 2: Extend the `## Things to avoid` list**

Add these bullets:

```markdown
- Re-implementing production logic inside a test file (tests must import the real module).
- Constructing a Supabase client, CORS headers, or auth checks inline in an edge function instead of using `realDeps()` / `_shared/http.ts` / `_shared/auth.ts`.
- Hand-rolling `vi.mock('@/integrations/supabase/client')` chains instead of the `src/test/` harness.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mandate test-first + document all test layers and DI patterns"
```

---

# PHASE B — Pilot DI conversions with real tests (PR B)

**Conversion shape for both pilots** (apply, then write the test):
1. Replace `import { createClient } from 'npm:...'` with imports from `_shared/{http,deps,auth}.ts`.
2. Delete the local `corsHeaders` + `json()` (now imported).
3. Change `Deno.serve(async (req) => { ... })` to `export async function handle(req: Request, deps: Deps): Promise<Response> { ... }` and add `if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));` at the bottom.
4. Replace the OPTIONS line with `if (req.method === 'OPTIONS') return preflight();`.
5. Replace inline client creation with `deps.admin` / `deps.userClient(...)`; replace `Deno.env.get(x)` with `deps.env(x)`.
6. Replace the auth block with the shared helper (see each task).
7. Replace `new Date()` with `deps.now()`; replace `admin.functions.invoke('send-transactional-email', {body})` with `deps.sendEmail(body)`.
8. **Move all remaining handler logic verbatim** into `handle` — no logic changes.

### Task B1: Convert `expire-offers` + real test

**Files:**
- Modify: `supabase/functions/expire-offers/index.ts`
- Create: `supabase/functions/expire-offers/index.di.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/expire-offers/index.di.test.ts
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("expire-offers: OPTIONS returns CORS preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("expire-offers: wrong cron secret is rejected 401", async () => {
  const { deps } = makeFakeDeps({ tables: { app_settings: { data: { value: "right" }, error: null } } });
  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "wrong" } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("expire-offers: runs expiry RPC and reports zero escalations when no open tiers", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      app_settings: { data: { value: "s" }, error: null },
      show_date_offer_tiers: { data: [], error: null },
    },
    rpcs: { expire_soft_bookings: { data: null, error: null } },
  });
  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "s" } }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { expired: true, escalations: 0 });
  assertEquals(calls.some((c) => c.table === "rpc:expire_soft_bookings"), true);
});
```

> The first real test wave deliberately pins the auth + RPC + early-return paths. When `Deps` proves out, extend with an escalation-path test (seed one open tier + bookings short of slots; assert `deps.sendEmail` invoked and `escalation_notified_at` update recorded) — add that as a follow-up step once the conversion compiles.

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all supabase/functions/expire-offers/index.di.test.ts`
Expected: FAIL — `index.ts` has no export `handle`.

- [ ] **Step 3: Convert the handler**

Apply the 8-step conversion shape above. New header + signature + auth block:

```ts
// top of supabase/functions/expire-offers/index.ts
import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  const admin = deps.admin;

  const auth = await requireCronOrRole(deps, req, ["admin", "producer"]);
  if (!auth.ok) return auth.response;

  // 1. Expire stale offers
  const { error: rpcErr } = await admin.rpc("expire_soft_bookings");
  if (rpcErr) return json({ error: `expire_soft_bookings: ${rpcErr.message}` }, 500);

  // ... (rest of the existing handler body, moved verbatim from the old Deno.serve callback,
  //      with these two substitutions inside the loop:
  //        - line ~105:  new Date()              -> deps.now()
  //        - line ~160:  new Date().toISOString()-> deps.now().toISOString()
  //        - lines 144-151: admin.functions.invoke('send-transactional-email', { body: {...} })
  //                         -> deps.sendEmail({ template_name: 'cast-escalation-requested',
  //                                             recipient_email: recipientEmail,
  //                                             templateData: { program, date: (sd as any).date, tier: row.tier, accepted, required: requiredSlots } })
  //      ) ...

  return json({ expired: true, escalations: escalated });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

> The escalation loop's body (lines 63–164 of the original) moves in unchanged except the three substitutions noted. Do not alter the escalation decision logic.

- [ ] **Step 4: Run test + typecheck**

Run: `deno check supabase/functions/expire-offers/index.ts && deno test --allow-all supabase/functions/expire-offers/index.di.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/expire-offers/index.ts supabase/functions/expire-offers/index.di.test.ts
git commit -m "refactor(expire-offers): convert to handle(req, deps) + add real DI tests"
```

---

### Task B2: Convert `open-offer-tier` + real test

**Files:**
- Modify: `supabase/functions/open-offer-tier/index.ts`
- Create: `supabase/functions/open-offer-tier/index.di.test.ts`

`open-offer-tier` accepts a **service-role bearer** OR a **user JWT (admin/producer)**, so its auth composes `isServiceRole` + `requireRole`. It currently validates the JWT via `getClaims`; the conversion normalizes to `requireRole` (which uses `getUser`) — this is the intentional, test-covered normalization.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/open-offer-tier/index.di.test.ts
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const SVC = { Authorization: "Bearer svc" };
const envVars = { SUPABASE_SERVICE_ROLE_KEY: "svc" };

Deno.test("open-offer-tier: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("open-offer-tier: no auth → 401", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ headers: {}, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("open-offer-tier: service role + missing fields → 400", async () => {
  const { deps } = makeFakeDeps({ envVars });
  const res = await handle(makeRequest({ headers: SVC, body: { tier: 0 } }), deps);
  assertEquals(res.status, 400);
});

Deno.test("open-offer-tier: cancelled show date → 400", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: { show_dates: { data: { id: "d1", show_id: "s1", city_id: "c1", date: "2026-02-01", status: "cancelled" }, error: null } },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 1 } }), deps);
  assertEquals(res.status, 400);
});

Deno.test("open-offer-tier: tier with no priority casts returns offers_created 0", async () => {
  const { deps } = makeFakeDeps({
    envVars,
    tables: {
      show_dates: { data: { id: "d1", show_id: "s1", city_id: "c1", date: "2026-02-01", status: "open" }, error: null },
      cast_city_priority: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: SVC, body: { show_date_id: "d1", tier: 2 } }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).offers_created, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all supabase/functions/open-offer-tier/index.di.test.ts`
Expected: FAIL — no export `handle`.

- [ ] **Step 3: Convert the handler**

Apply the 8-step shape. New header + signature + auth block (replaces lines 1–44 of the original):

```ts
// top of supabase/functions/open-offer-tier/index.ts
import { preflight, json } from "../_shared/http.ts";
import { isServiceRole, requireRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  const admin = deps.admin;

  // Accept either the service-role key or a user JWT (admin/producer).
  if (!isServiceRole(deps, req)) {
    const auth = await requireRole(deps, req, ["admin", "producer"]);
    if (!auth.ok) return auth.response;
  }

  let show_date_id: string;
  let tier: number;
  try {
    const body = await req.json();
    show_date_id = body.show_date_id;
    tier = Number(body.tier);
    if (!show_date_id || !tier || tier < 1) {
      return json({ error: "show_date_id and tier (≥1) are required" }, 400);
    }
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // ... (rest of the existing handler body from line 59 onward, moved verbatim;
  //      delete the now-redundant `const admin = createClient(...)` at line 59 since
  //      `admin` is already `deps.admin` above. No other logic changes. `new Date()` at
  //      line 176 becomes `deps.now()`.) ...

  return json({ offers_created: offersCreated });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 4: Run test + typecheck**

Run: `deno check supabase/functions/open-offer-tier/index.ts && deno test --allow-all supabase/functions/open-offer-tier/index.di.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/open-offer-tier/index.ts supabase/functions/open-offer-tier/index.di.test.ts
git commit -m "refactor(open-offer-tier): convert to handle(req, deps) + add real DI tests"
```

---

# PHASE C — DI rollout + send-offer-digest real test (PR C)

## Conversion Recipe (apply to every function in this phase)

> This is the exact mechanical transform. Each task below lists only its function-specific values.

1. Add imports: `import { preflight, json } from "../_shared/http.ts";` `import { realDeps, type Deps } from "../_shared/deps.ts";` and the auth helper(s) the function needs.
2. Remove `import { createClient } from 'npm:...'`, the local `corsHeaders`, and the local `json()`/`jsonResponse()`.
3. Signature: `export async function handle(req: Request, deps: Deps): Promise<Response> {` … `}` + footer `if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));`.
4. `if (req.method === 'OPTIONS') return preflight();` (functions that 405 non-POST keep that check after preflight).
5. `deps.admin` for the service client; `deps.userClient(authHeader)` for the user client; `deps.env(x)` for every `Deno.env.get(x)`.
6. Replace the inline auth block with the shared helper from the table.
7. `new Date()` → `deps.now()`; `admin.functions.invoke('send-transactional-email', { body })` → `deps.sendEmail(body)`; `admin.functions.invoke('<other>', { body })` → `deps.invokeFunction('<other>', body)`.
8. Move all remaining logic verbatim. No behavior changes.

**Smoke-test template** (fill the bracketed values from each task):

```ts
// supabase/functions/<NAME>/index.smoke.test.ts
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("<NAME>: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps(<DEPS_OPTS>);
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("<NAME>: unauthorized request is rejected", async () => {
  const { deps } = makeFakeDeps(<DEPS_OPTS>);
  const res = await handle(makeRequest(<UNAUTH_REQ>), deps);
  assertEquals(res.status, <UNAUTH_STATUS>);
});

Deno.test("<NAME>: authorized happy path returns <HAPPY_STATUS>", async () => {
  const { deps } = makeFakeDeps(<HAPPY_DEPS_OPTS>);
  const res = await handle(makeRequest(<HAPPY_REQ>), deps);
  assertEquals(res.status, <HAPPY_STATUS>);
});
```

---

### Task C1: Convert `send-offer-digest` + REAL test (atomic-update focus)

**Files:**
- Modify: `supabase/functions/send-offer-digest/index.ts`
- Create: `supabase/functions/send-offer-digest/index.di.test.ts`

Auth helper: `requireCronOrRole(deps, req, ["admin", "producer"])`. Clock substitutions: lines 74, 98, 187 (`new Date()` → `deps.now()`). Email: line 179 → `deps.sendEmail(...)`. The Berlin-hour gate uses `Intl.DateTimeFormat(...).format(deps.now())`.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/send-offer-digest/index.di.test.ts
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

// 19:00 Berlin on 2026-06-01 (CEST = UTC+2) == 17:00 UTC.
const BERLIN_19 = new Date("2026-06-01T17:00:00.000Z");
const cronOK = { "X-Cron-Secret": "s" };

function baseDeps(extraTables = {}, now = BERLIN_19) {
  return makeFakeDeps({
    now,
    tables: {
      app_settings: { data: { value: "s" }, error: null }, // cron_secret lookup
      ...extraTables,
    },
  });
}

Deno.test("send-offer-digest: skips when Berlin hour != target", async () => {
  // 12:00 UTC == 14:00 Berlin, target 19 → skip.
  const { deps } = baseDeps({}, new Date("2026-06-01T12:00:00.000Z"));
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.skipped, true);
});

Deno.test("send-offer-digest: wrong cron secret → 401", async () => {
  const { deps } = makeFakeDeps({ tables: { app_settings: { data: { value: "s" }, error: null } } });
  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "nope" } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("send-offer-digest: no pending offers → digests_sent 0", async () => {
  const { deps } = baseDeps({ bookings: { data: [], error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(await res.json(), { digests_sent: 0 });
});

Deno.test("send-offer-digest: sends email AND stamps digest_sent_at+offer_expires_at together", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Jo", email: "jo@x.com" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, calls, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals(await res.json(), { digests_sent: 1 });
  // Email sent via sendEmail:
  assertEquals(invokeCalls.some((c) => c.name === "send-transactional-email"), true);
  // The stamp update writes BOTH fields in one update() — this is the known non-atomic-risk path.
  const update = calls.find((c) => c.table === "bookings" && c.method === "update");
  assertEquals(!!update, true);
  const payload = update!.args[0] as Record<string, unknown>;
  assertEquals("digest_sent_at" in payload && "offer_expires_at" in payload, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all supabase/functions/send-offer-digest/index.di.test.ts`
Expected: FAIL — no export `handle`.

- [ ] **Step 3: Convert the handler** (apply the Recipe; auth = `requireCronOrRole`, clock subs at 74/98/187, email at 179). Move the grouping + send loop verbatim.

- [ ] **Step 4: Run test + typecheck**

Run: `deno check supabase/functions/send-offer-digest/index.ts && deno test --allow-all supabase/functions/send-offer-digest/index.di.test.ts`
Expected: PASS (4 tests).

> The 4th test documents the current behavior (one `update()` writing both fields). Part 1 will add the bug-hunt test: simulate `update` returning an error after `sendEmail` succeeds and assert the booking is not double-emailed on the next run.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-offer-digest/index.ts supabase/functions/send-offer-digest/index.di.test.ts
git commit -m "refactor(send-offer-digest): convert to handle(req, deps) + real DI tests"
```

---

### Tasks C2–C9: Mechanical conversions (EASY + MEDIUM)

For each function: (1) apply the Conversion Recipe, (2) `deno check`, (3) create `index.smoke.test.ts` from the template with the values in its row, (4) run it, (5) commit with `refactor(<name>): convert to handle(req, deps) + smoke test`.

Per-function values for the smoke template and recipe:

| # | Function | Auth helper | `now`/email subs | `<UNAUTH_REQ>` / `<UNAUTH_STATUS>` | `<HAPPY_*>` |
|---|---|---|---|---|---|
| C2 | admin-list-users | `requireRole(deps, req, ["admin"])` | none | `{ headers: {} }` / 401 | deps: `{ authUser:{id:"u1"}, tables:{ user_roles:{data:{role:"admin"},error:null} }, usersById:{} }`; req `{ headers:{ Authorization:"Bearer jwt" } }` / 200 |
| C3 | admin-set-role | `requireRole(deps, req, ["admin"])` | none | `{ headers: {} }` / 401 | deps: `{ authUser:{id:"u1"}, tables:{ user_roles:{data:{role:"admin"},error:null} } }`; req `{ headers:{Authorization:"Bearer jwt"}, body:{ user_id:"u2", role:"artist", action:"add" } }` / 200 |
| C4 | admin-decide-approval | `requireRole(deps, req, ["admin"])` | `new Date()`→`deps.now()` (line ~106); email line ~74 → `deps.sendEmail(...)` | `{ headers: {} }` / 401 | deps: `{ authUser:{id:"u1"}, tables:{ user_roles:{data:{role:"admin"},error:null} }, rpcs:{ decide_user_approval:{data:null,error:null} } }`; req `{ headers:{Authorization:"Bearer jwt"}, body:{ approval_id:"ap1", decision:"approved", role:"artist" } }` / 200 |
| C5 | notify-signup | none (db webhook) | email line ~52 → `deps.sendEmail(...)` | `{ body: {} }` / 400 (missing record) | deps: `{ usersById:{ admin1:{email:"a@x.com"} }, tables:{ user_roles:{data:[{user_id:"admin1"}],error:null} } }`; req `{ body:{ record:{ id:"ap1", email:"new@x.com", status:"pending" } } }` / 200 |
| C6 | handle-email-unsubscribe | token (keep inline lookup) | `new Date()`→`deps.now()` (line ~96) | `{ method:"GET", url:"http://localhost/fn" }` (no token) / 404 | deps: `{ tables:{ email_unsubscribe_tokens:{data:{ id:"t1", used_at:null },error:null} } }`; req `{ method:"GET", url:"http://localhost/fn?token=t1" }` / 200 |
| C7 | preview-transactional-email | `requireRole(deps, req, ["admin","producer"])` | none | `{ headers: {} }` / 401 | deps: `{ authUser:{id:"u1"}, tables:{ user_roles:{data:{role:"admin"},error:null} } }`; req `{ headers:{Authorization:"Bearer jwt"}, body:{} }` / 200 |
| C8 | send-confirmation-digest | `requireCronOrRole(deps, req, ["admin","producer"])` | `new Date()`→`deps.now()` (lines ~142,148); email line ~134 → `deps.sendEmail(...)`; Berlin gate uses `deps.now()` | `{ headers:{ "X-Cron-Secret":"nope" } }` / 401 | deps: `{ now:new Date("2026-06-01T18:00:00.000Z"), tables:{ app_settings:{data:{value:"s"},error:null}, bookings:{data:[],error:null} } }`; req `{ headers:{ "X-Cron-Secret":"s" } }` / 200 (skipped or digests_sent:0 depending on Berlin hour vs 20) |
| C9 | tier-at-risk-watcher | `requireCronOrRole(deps, req, ["admin","producer"])` | none | `{ headers:{ "X-Cron-Secret":"nope" } }` / 401 | deps: `{ tables:{ app_settings:{data:{value:"s"},error:null}, show_date_offer_tiers:{data:[],error:null} } }`; req `{ headers:{ "X-Cron-Secret":"s" } }` / 200 |

> **C8 Berlin-hour note:** set the happy-path `now` to a UTC time whose Berlin hour is NOT the confirmation target (20), so the handler returns `{ skipped: true }` at 200 — this keeps the smoke test deterministic without seeding confirmed bookings. The real time-gate + grouping test is deferred to Part 1.
> **C6 note:** `handle-email-unsubscribe` parses the token from query (GET), form, or JSON body. Keep that parsing inside `handle`; only the client/env/now/cors/json get DI-ized.

Each of C2–C9 is its own commit. Run `deno test --allow-all supabase/functions/<name>/` after each.

---

### Tasks C10–C12: HARD functions — structural DI + smoke only

These carry crypto / external-API / large-surface logic. In Part 0 do **structural DI only** (client/env/now/cors/json/fetch via deps; auth helper where applicable) + a smoke test. **Do not** refactor the crypto, Resend, or Airtable internals — those get real tests in Part 1. If any resists mechanical conversion, stop and flag it rather than rewriting.

#### Task C10: airtable-poll (HARD)

Auth: cron-secret (keep inline OR use `requireCronOrRole` with `[]` roles — inline is safer to preserve behavior; keep inline). Subs: `new Date()`→`deps.now()` (lines 106,118,201,310); the Airtable `fetch(...)` (line 187) → `deps.fetch(...)`; the internal `admin.functions.invoke('open-offer-tier', { body })` (helper line ~24) → `deps.invokeFunction('open-offer-tier', body)`; `AIRTABLE_API_KEY` via `deps.env`. Keep the `openOfferTierBatch` helper, pagination, and upsert logic verbatim.

```ts
// supabase/functions/airtable-poll/index.smoke.test.ts
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("airtable-poll: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("airtable-poll: wrong cron secret → 401", async () => {
  const { deps } = makeFakeDeps({ tables: { app_settings: { data: { value: "right" }, error: null } } });
  const res = await handle(makeRequest({ headers: { "X-Cron-Secret": "wrong" } }), deps);
  assertEquals(res.status, 401);
});
```

Commit: `refactor(airtable-poll): structural DI + smoke test (deep tests in Part 1)`.

#### Task C11: handle-email-suppression (HARD)

Auth: HMAC signature (keep the `crypto.subtle` verification verbatim). Subs: client via `deps.admin`; `RESEND_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` via `deps.env`; keep `Date.now()` inside the signature check (it is part of the crypto contract, not business time). Replace `jsonResponse` with shared `json`.

```ts
// supabase/functions/handle-email-suppression/index.smoke.test.ts
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("handle-email-suppression: non-POST → 405", async () => {
  const { deps } = makeFakeDeps({ envVars: { RESEND_WEBHOOK_SECRET: "whsec_x" } });
  const res = await handle(makeRequest({ method: "GET" }), deps);
  assertEquals(res.status, 405);
});

Deno.test("handle-email-suppression: missing/invalid signature → 401", async () => {
  const { deps } = makeFakeDeps({ envVars: { RESEND_WEBHOOK_SECRET: "whsec_x" } });
  const res = await handle(makeRequest({ method: "POST", body: { type: "email.bounced" } }), deps);
  assertEquals(res.status, 401);
});
```

Commit: `refactor(handle-email-suppression): structural DI + smoke test (deep tests in Part 1)`.

#### Task C12: send-transactional-email (HARD)

Auth: none/public. Subs: `deps.admin`; `RESEND_API_KEY`/`SUPABASE_*` via `deps.env`; the Resend `fetch('https://api.resend.com/emails', ...)` (line 232) → `deps.fetch(...)`; `new Date()` (lines 142,148) → `deps.now()`. Keep `crypto.getRandomValues`/`crypto.randomUUID`, the React render, suppression check, and token upsert verbatim.

```ts
// supabase/functions/send-transactional-email/index.smoke.test.ts
import { assertEquals } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

Deno.test("send-transactional-email: OPTIONS returns preflight", async () => {
  const { deps } = makeFakeDeps({ envVars: { RESEND_API_KEY: "re_x" } });
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("send-transactional-email: unknown template → 404", async () => {
  const { deps } = makeFakeDeps({ envVars: { RESEND_API_KEY: "re_x" } });
  const res = await handle(makeRequest({ method: "POST", body: { templateName: "does-not-exist", recipientEmail: "a@x.com" } }), deps);
  assertEquals(res.status, 404);
});
```

Commit: `refactor(send-transactional-email): structural DI + smoke test (deep tests in Part 1)`.

---

### Task C13: Full-suite verification gate

- [ ] **Step 1: Run every layer locally**

```bash
npm run lint
npm run build
deno test --allow-all supabase/functions/
npx vitest run
```
Expected: all PASS. (pgTAP + Playwright run in CI; trigger them via a PR to `main` is out of scope here — they are unchanged by Part 0.)

- [ ] **Step 2: Confirm every function exports `handle`**

```bash
grep -L "export async function handle" supabase/functions/*/index.ts
```
Expected: prints nothing (every function has the export). Investigate any file listed.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A && git commit -m "chore: green full test suite after Part 0 DI conversion"
```

---

## Self-Review

**Spec coverage** (against `2026-06-01-testability-foundation-part0-design.md`):
- §4A backend DI seam (`_shared/{cors,deps,auth}.ts` + fake-deps helper) → A5 (http), A6 (deps), A7 (testing/fake), A8 (auth). ✓
- §4B frontend harness (queryClient wrapper, fake client, fixtures, reference hook) → A1, A2, A3, A4, A9. ✓
- §4C CLAUDE.md rewrite → A10. ✓
- §5 validate-first: 2 pilots with real tests → B1, B2; rollout with smoke tests + send-offer-digest real test → C1–C12. ✓
- §5 "flag, don't rewrite" tangled functions → C10–C12 instructions. ✓
- §6 safety net (typecheck/lint/existing suites) → C13. ✓
- §8 DoD "every function runs as handle(req, deps)" → C13 Step 2 grep gate. ✓

**Placeholder scan:** No "TBD"/"handle edge cases" — every code step has complete code or a precise verbatim-move instruction with named substitutions and line numbers. ✓

**Type consistency:** `Deps` fields (`admin`, `userClient`, `env`, `now`, `invokeFunction`, `sendEmail`, `fetch`) are defined in A6 and used identically in A7, A8, B1, B2, C*. `makeFakeDeps`/`makeRequest`/`createFakeSupabase`/`createFakeClient` signatures match between their defining tasks and consumers. `AuthOutcome` shape (`{ ok, userId } | { ok, response }`) consistent across A8 and all callers. ✓

**Known intentional behavior changes (test-covered):** (1) `open-offer-tier` JWT validation normalizes `getClaims` → `getUser` via `requireRole`; (2) OPTIONS preflight standardizes 200 → 204 (smoke tests accept both).
