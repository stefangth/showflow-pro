# Phase 2 — `airtable-schema` Edge Function Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `airtable-schema` edge function that reads an org's Airtable schema server-side (using the Vault-stored PAT, never exposed to the client) so the upcoming mapping UI can offer base/table/field dropdowns — with a clean `{ schemaAccessible: false }` fallback signal when the PAT lacks the `schema.bases:read` scope.

**Architecture:** A single DI-pattern handler (`handle(req, deps)` + `realDeps()`) following the exact shape of `create-invitation` (user-JWT auth via `requireOrgRole(org_id, ['admin'])`) and `airtable-poll` (Vault key via the `get_org_airtable_key` RPC; outbound Airtable calls via `deps.fetch`). Two modes gated by one Airtable scope: **no `baseId`** → list accessible bases (`GET /v0/meta/bases`, offset-paginated); **with `baseId`** → describe that base's tables/fields (`GET /v0/meta/bases/{baseId}/tables`). A `403` from Airtable (missing scope) is the *expected* manual-fallback signal `{ schemaAccessible: false }`, not an error. The PAT is read server-side and **never** returned to the client. No DB migration, no frontend in this plan — this is the self-contained backend foundation the Phase 2b mapping UI will call.

**Tech Stack:** Deno edge function (Supabase, project `epweartpzwvcasrzyueh`). **Deno 2.5.x is available locally**, so every test step runs with `deno test --allow-all <path>` directly in this environment (no Supabase CLI/Docker/MCP needed — this plan touches no DB). Shared modules reused verbatim: `_shared/http.ts` (`preflight`/`json`), `_shared/auth.ts` (`requireOrgRole`), `_shared/deps.ts` (`Deps`/`realDeps`), `_shared/testing.ts` (`makeFakeDeps`/`makeRequest`), `_shared/test-asserts.ts` (`assertEquals`/`assertExists`). Edge functions deploy automatically when their directory changes (on merge) — **no manual deploy step**; CI runs `deno test --allow-all supabase/functions/` and auto-discovers the new files.

Implements [the sync-engine spec §7](../specs/2026-06-16-airtable-sync-engine-design.md) and [ADR-0001](../../adr/0001-airtable-system-of-record.md).

> **Naming note:** spec §12 calls this `airtable-describe-base`; spec §7 and the initiative handoff call it `airtable-schema`. This plan uses **`airtable-schema`** (the §7 name) and Task 3 corrects the §12 wording.

> **Scope note:** This plan is **only** the edge function. The `app_settings.airtable_field_map` key, the `shows.airtable_program_key` / `cities.airtable_city_key` catalog-link columns, and the Settings mapping/linking UI (the rest of spec §12 "Mapping model") are follow-on plans (Phase 2b). The function ships and is fully tested in isolation — it is a read-only introspection endpoint with no DB writes.

---

## File Structure

- `supabase/functions/airtable-schema/index.ts` — **new.** The `handle(req, deps)` function + `realDeps()` wiring. ~80 lines.
- `supabase/functions/airtable-schema/index.di.test.ts` — **new.** Deno DI tests via `makeFakeDeps` (guards, both modes, pagination, 403/401 mapping, PAT-never-leaked). Matches the `index.di.test.ts` convention used by `airtable-poll` and `create-invitation`.
- `CLAUDE.md` — **modify.** Add `airtable-schema` to the edge-functions inventory.
- `docs/superpowers/specs/2026-06-16-airtable-sync-engine-design.md` — **modify.** One-word fix in §12 (`airtable-describe-base` → `airtable-schema`) for consistency with §7.

**Request/response contract** (the function's interface, referenced by every task):

- **Request** (POST body; auth is the caller's user JWT, set automatically by `supabase.functions.invoke`):
  - `{ org_id: string }` → list-bases mode
  - `{ org_id: string, baseId: string }` → describe-base mode
- **Responses:**
  - List bases: `{ schemaAccessible: true, bases: [{ id, name }] }`
  - Describe base: `{ schemaAccessible: true, tables: [{ id, name, fields: [{ id, name, type, options? }] }] }`
  - Missing scope (Airtable 403): `{ schemaAccessible: false }` (HTTP 200 — an expected determination, not an error)
  - Bad/revoked PAT (Airtable 401): `{ error: "Airtable key is invalid or revoked" }` (HTTP 400)
  - Other Airtable error: `{ error, detail }` (HTTP 502)
  - No `org_id`: `{ error }` (HTTP 400) · not admin: 403 · no Bearer: 401 · no Vault key: `{ error }` (HTTP 400)

---

### Task 1: List-bases mode + auth/guards

**Files:**
- Create: `supabase/functions/airtable-schema/index.di.test.ts`
- Create: `supabase/functions/airtable-schema/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/airtable-schema/index.di.test.ts`:

```typescript
/**
 * DI tests for the airtable-schema handler.
 *
 * Coverage (Task 1 — guards + list-bases mode):
 *  - OPTIONS preflight
 *  - missing org_id → 400
 *  - no Bearer → 401; non-admin → 403 (via requireOrgRole)
 *  - no Vault key → 400, no Airtable fetch
 *  - list bases: correct URL, Bearer carries the Vault key, permissionLevel "none" filtered,
 *    offset pagination, PAT never leaked to the client
 *  - Airtable 403 → { schemaAccessible: false }; 401 → bad-key error (400)
 */
import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const ORG = "00000000-0000-0000-0000-0000000000a1";
const ADMIN = "11111111-1111-1111-1111-111111111111";
const PAT = "pat-secret-DONOTLEAK";

/** Deps with an admin caller of ORG and a Vault key (override key/fetch as needed). */
function adminDeps(opts: { rpcKey?: string | null; fetchImpl?: typeof fetch } = {}) {
  const { rpcKey = PAT, fetchImpl } = opts;
  return makeFakeDeps({
    authUser: { id: ADMIN },
    tables: {
      org_memberships: { data: { role: "admin" }, error: null },
      platform_admins: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: rpcKey, error: null } },
    fetchImpl,
  });
}

/** An admin-authenticated POST with the given JSON body. */
function adminReq(body: Record<string, unknown> = { org_id: ORG }) {
  return makeRequest({ method: "POST", headers: { Authorization: "Bearer admin-jwt" }, body });
}

function airtableJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

// ─── Guards ───────────────────────────────────────────────────────────────────

Deno.test("airtable-schema: OPTIONS → preflight", async () => {
  const { deps } = adminDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("airtable-schema: missing org_id → 400", async () => {
  const { deps } = adminDeps();
  const res = await handle(
    makeRequest({ method: "POST", headers: { Authorization: "Bearer admin-jwt" }, body: {} }),
    deps,
  );
  assertEquals(res.status, 400);
});

Deno.test("airtable-schema: no Bearer → 401", async () => {
  const { deps } = adminDeps();
  const res = await handle(makeRequest({ method: "POST", body: { org_id: ORG } }), deps);
  assertEquals(res.status, 401);
});

Deno.test("airtable-schema: non-admin (no membership, not super-admin) → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-non-admin" },
    tables: {
      org_memberships: { data: null, error: null },
      platform_admins: { data: null, error: null },
    },
    rpcs: { get_org_airtable_key: { data: PAT, error: null } },
  });
  const res = await handle(adminReq({ org_id: ORG }), deps);
  assertEquals(res.status, 403);
});

Deno.test("airtable-schema: no Vault key → 400, no Airtable fetch", async () => {
  let fetched = 0;
  const { deps } = adminDeps({
    rpcKey: null,
    fetchImpl: () => { fetched++; return Promise.resolve(airtableJson({})) as Promise<Response>; },
  });
  const res = await handle(adminReq({ org_id: ORG }), deps);
  assertEquals(res.status, 400);
  assertEquals(fetched, 0);
});

// ─── List bases ─────────────────────────────────────────────────────────────────

Deno.test("airtable-schema: lists bases (filters permissionLevel none), Vault key in Bearer, never leaked", async () => {
  const captured: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = (url, init) => {
    captured.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(airtableJson({
      bases: [
        { id: "appAAA", name: "Fever Berlin", permissionLevel: "create" },
        { id: "appBBB", name: "Interface Only", permissionLevel: "none" },
      ],
    })) as Promise<Response>;
  };
  const { deps } = adminDeps({ fetchImpl });
  const res = await handle(adminReq({ org_id: ORG }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.schemaAccessible, true);
  // permissionLevel "none" base is filtered out
  assertEquals(body.bases, [{ id: "appAAA", name: "Fever Berlin" }]);
  // exactly one fetch, correct URL + Authorization header carrying the Vault key
  assertEquals(captured.length, 1);
  assertEquals(captured[0].url, "https://api.airtable.com/v0/meta/bases");
  assertEquals((captured[0].init.headers as Record<string, string>)["Authorization"], `Bearer ${PAT}`);
  // the PAT never reaches the client
  assertEquals(JSON.stringify(body).includes(PAT), false);
});

Deno.test("airtable-schema: list bases follows offset pagination and concatenates pages", async () => {
  const urls: string[] = [];
  let call = 0;
  const fetchImpl: typeof fetch = (url) => {
    urls.push(String(url));
    call += 1;
    if (call === 1) {
      return Promise.resolve(airtableJson({
        bases: [{ id: "app1", name: "One", permissionLevel: "edit" }],
        offset: "page2tok",
      })) as Promise<Response>;
    }
    return Promise.resolve(airtableJson({
      bases: [{ id: "app2", name: "Two", permissionLevel: "edit" }],
    })) as Promise<Response>;
  };
  const { deps } = adminDeps({ fetchImpl });
  const res = await handle(adminReq({ org_id: ORG }), deps);
  const body = await res.json();
  assertEquals(body.bases, [{ id: "app1", name: "One" }, { id: "app2", name: "Two" }]);
  assertEquals(urls.length, 2);
  assertEquals(urls[1].includes("offset=page2tok"), true);
});

Deno.test("airtable-schema: Airtable 403 (missing scope) → { schemaAccessible: false }", async () => {
  const { deps } = adminDeps({
    fetchImpl: () => Promise.resolve(airtableJson({ error: { type: "INSUFFICIENT_PERMISSIONS" } }, 403)) as Promise<Response>,
  });
  const res = await handle(adminReq({ org_id: ORG }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.schemaAccessible, false);
  assertEquals("bases" in body, false);
});

Deno.test("airtable-schema: Airtable 401 (bad PAT) → 400 error", async () => {
  const { deps } = adminDeps({
    fetchImpl: () => Promise.resolve(new Response("Unauthorized", { status: 401 })) as Promise<Response>,
  });
  const res = await handle(adminReq({ org_id: ORG }), deps);
  assertEquals(res.status, 400);
  assertExists((await res.json()).error);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `deno test --allow-all supabase/functions/airtable-schema/index.di.test.ts`
Expected: the run errors at module load — `Module not found "./index.ts"` (the implementation does not exist yet). This confirms the test file is wired to the real module.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/airtable-schema/index.ts`:

```typescript
import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

type Body = { org_id?: string; baseId?: string };

const AIRTABLE_META = "https://api.airtable.com/v0/meta";
/** meta/bases returns <=1000 bases/page; cap the offset loop so a pathological
 *  response can never spin forever (mirrors airtable-poll's MAX_PAGES guard). */
const MAX_BASE_PAGES = 10;

interface AirtableBase { id: string; name: string; permissionLevel?: string }

/** Map a non-OK Airtable Meta response to a client response.
 *  403 (missing schema.bases:read scope) is the EXPECTED manual-fallback signal,
 *  not an error. 401 means the stored PAT is bad. Returns null when res is OK
 *  and the caller should proceed to parse the body. */
async function airtableFailure(res: Response, label: string): Promise<Response | null> {
  if (res.ok) return null;
  if (res.status === 403) return json({ schemaAccessible: false });
  if (res.status === 401) return json({ error: "Airtable key is invalid or revoked" }, 400);
  const detail = (await res.text()).slice(0, 300);
  return json({ error: `${label} (${res.status})`, detail }, 502);
}

/**
 * Reads the org's Airtable schema for the mapping UI.
 *
 * Auth: user JWT, requireOrgRole(org_id, ['admin']) (super-admins pass too).
 * The org PAT is read from the Vault via get_org_airtable_key and used only
 * server-side — it is NEVER returned to the client.
 *
 * Modes (one Airtable scope, schema.bases:read, gates both):
 *  - body has no baseId → list accessible bases.
 *  - Airtable 403 (no scope) → { schemaAccessible: false } so the UI falls back to typed inputs.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const orgId = body?.org_id;
    if (!orgId) return json({ error: "Invalid payload: org_id is required" }, 400);

    // Caller must be an admin of the target org (super-admins pass via requireOrgRole).
    const auth = await requireOrgRole(deps, req, orgId, ["admin"]);
    if (!auth.ok) return auth.response;

    // The org's write-only PAT, read from the Vault. Never echoed to the client.
    const { data: apiKey } = await deps.admin.rpc("get_org_airtable_key", { _org: orgId });
    if (!apiKey) return json({ error: "No Airtable key configured for this organization" }, 400);
    const headers = { Authorization: `Bearer ${apiKey as string}` };

    // ── List accessible bases (offset-paginated) ──────────────────────────────
    const bases: Array<{ id: string; name: string }> = [];
    let offset: string | undefined;
    let pages = 0;
    do {
      const url = offset
        ? `${AIRTABLE_META}/bases?offset=${encodeURIComponent(offset)}`
        : `${AIRTABLE_META}/bases`;
      const res = await deps.fetch(url, { headers });
      const fail = await airtableFailure(res, "Airtable base list failed");
      if (fail) return fail;
      const data = (await res.json()) as { bases?: AirtableBase[]; offset?: string };
      for (const b of data.bases ?? []) {
        // permissionLevel "none" = interface-only base the PAT can't actually read.
        if (b.permissionLevel !== "none") bases.push({ id: b.id, name: b.name });
      }
      offset = data.offset;
      pages += 1;
    } while (offset && pages < MAX_BASE_PAGES);

    return json({ schemaAccessible: true, bases });
  } catch (e) {
    console.error("airtable-schema error", e);
    return json({ error: (e as Error).message }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `deno test --allow-all supabase/functions/airtable-schema/index.di.test.ts`
Expected: all Task-1 tests pass (`ok` for OPTIONS, missing org_id, no Bearer, non-admin, no Vault key, list bases, pagination, 403, 401) — `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/airtable-schema/index.ts supabase/functions/airtable-schema/index.di.test.ts
git commit -m "feat(edge): add airtable-schema function (list bases for mapping UI)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Describe-base mode (tables + fields)

**Files:**
- Modify: `supabase/functions/airtable-schema/index.di.test.ts`
- Modify: `supabase/functions/airtable-schema/index.ts`

- [ ] **Step 1: Write the failing tests**

Append these tests to `supabase/functions/airtable-schema/index.di.test.ts` (the `adminDeps`/`adminReq`/`airtableJson`/`ORG`/`PAT` helpers from Task 1 are already in the file):

```typescript
// ─── Describe base (tables + fields) ─────────────────────────────────────────────

Deno.test("airtable-schema: describe base → tables + fields with options, correct URL", async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (url) => {
    urls.push(String(url));
    // Mirrors the real German base (Datum / Program / 1. Show) per spec §3.
    return Promise.resolve(airtableJson({
      tables: [{
        id: "tblEvents",
        name: "Events",
        primaryFieldId: "fldDate",
        fields: [
          { id: "fldDate", name: "Datum", type: "date" },
          { id: "fldProg", name: "Program", type: "singleSelect", options: { choices: [{ id: "selA", name: "TJE: Murder", color: "blueLight2" }] } },
          { id: "fldShow1", name: "1. Show", type: "singleLineText" },
        ],
        views: [{ id: "viwGrid", name: "Grid view", type: "grid" }],
      }],
    })) as Promise<Response>;
  };
  const { deps } = adminDeps({ fetchImpl });
  const res = await handle(adminReq({ org_id: ORG, baseId: "appKg8xpplxd49Bo6" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.schemaAccessible, true);
  // correct describe-base URL (not the list-bases URL)
  assertEquals(urls[0], "https://api.airtable.com/v0/meta/bases/appKg8xpplxd49Bo6/tables");
  assertEquals(body.tables.length, 1);
  assertEquals(body.tables[0].id, "tblEvents");
  assertEquals(body.tables[0].name, "Events");
  assertEquals(body.tables[0].fields.length, 3);
  // field shape is exactly { id, name, type } when no options are present
  assertEquals(body.tables[0].fields[0], { id: "fldDate", name: "Datum", type: "date" });
  // singleSelect options.choices are preserved verbatim (needed later for option-linking + §14)
  assertEquals(body.tables[0].fields[1].options.choices[0].name, "TJE: Murder");
  // the table's `views` are dropped — not part of our contract
  assertEquals("views" in body.tables[0], false);
});

Deno.test("airtable-schema: describe base 403 (missing scope) → { schemaAccessible: false }", async () => {
  const { deps } = adminDeps({
    fetchImpl: () => Promise.resolve(new Response("", { status: 403 })) as Promise<Response>,
  });
  const res = await handle(adminReq({ org_id: ORG, baseId: "appXXX" }), deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).schemaAccessible, false);
});

Deno.test("airtable-schema: describe base never leaks the PAT", async () => {
  const { deps } = adminDeps({
    fetchImpl: () => Promise.resolve(airtableJson({ tables: [] })) as Promise<Response>,
  });
  const res = await handle(adminReq({ org_id: ORG, baseId: "appXXX" }), deps);
  assertEquals(JSON.stringify(await res.json()).includes(PAT), false);
});
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `deno test --allow-all supabase/functions/airtable-schema/index.di.test.ts`
Expected: the three new `describe base …` tests FAIL — with no `baseId` branch yet, the handler runs list-bases mode and calls `GET …/meta/bases`, so the URL assertion (`…/meta/bases/appKg8xpplxd49Bo6/tables`) and the `tables` shape assertions do not hold. All Task-1 tests still pass.

- [ ] **Step 3: Add the describe-base branch**

In `supabase/functions/airtable-schema/index.ts`:

First, add the two interfaces directly below the existing `AirtableBase` interface:

```typescript
interface AirtableField { id: string; name: string; type: string; options?: Record<string, unknown> }
interface AirtableTable { id: string; name: string; fields?: AirtableField[] }
```

Then insert the describe-base branch immediately **after** the `const headers = { Authorization: ... };` line and **before** the `// ── List accessible bases` comment:

```typescript
    // ── Mode B: describe one base's tables + fields ───────────────────────────
    if (body?.baseId) {
      const res = await deps.fetch(`${AIRTABLE_META}/bases/${encodeURIComponent(body.baseId)}/tables`, { headers });
      const fail = await airtableFailure(res, "Airtable schema read failed");
      if (fail) return fail;
      const data = (await res.json()) as { tables?: AirtableTable[] };
      const tables = (data.tables ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        fields: (t.fields ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          ...(f.options ? { options: f.options } : {}),
        })),
      }));
      return json({ schemaAccessible: true, tables });
    }

```

Also update the handler's doc comment: change the `Modes` bullet `- body has no baseId → list accessible bases.` to read:

```typescript
 *  - body has no baseId → list accessible bases  → { schemaAccessible: true, bases: [{ id, name }] }.
 *  - body has a baseId  → describe that base      → { schemaAccessible: true, tables: [{ id, name, fields: [{ id, name, type, options? }] }] }.
```

- [ ] **Step 4: Run the full file and confirm all tests pass**

Run: `deno test --allow-all supabase/functions/airtable-schema/index.di.test.ts`
Expected: every test passes — Task-1 (guards, list bases, pagination, 403/401) **and** the three describe-base tests — `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/airtable-schema/index.ts supabase/functions/airtable-schema/index.di.test.ts
git commit -m "feat(edge): airtable-schema describe-base mode (tables + fields)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Documentation

**Files:**
- Modify: `CLAUDE.md` (edge-functions inventory)
- Modify: `docs/superpowers/specs/2026-06-16-airtable-sync-engine-design.md` (§12 name fix)

- [ ] **Step 1: Add `airtable-schema` to the CLAUDE.md edge-function inventory**

In `CLAUDE.md`, under `### Edge functions`, find the **Invitations** bullet:

```markdown
  - **Invitations:** `create-invitation` (org admin → insert `org_invitations` + send the `org-invitation` email). Acceptance is the `accept_invitation` RPC, not an edge function.
```

Immediately after it, add a new category bullet:

```markdown
  - **Airtable sync:** `airtable-schema` (admin-only, user-JWT via `requireOrgRole(org_id, ['admin'])`) reads the org's Airtable schema with the Vault PAT and returns `{ schemaAccessible, bases }` (no `baseId`) or `{ schemaAccessible, tables }` (with `baseId`) for the mapping UI; a `403` from Airtable surfaces as `{ schemaAccessible: false }` (manual-fallback signal). The PAT is never returned to the client. `airtable-poll` is the cron sync (see below).
```

- [ ] **Step 2: Fix the spec §12 function name**

In `docs/superpowers/specs/2026-06-16-airtable-sync-engine-design.md`, in the §12 phase-2 bullet, change `airtable-describe-base` to `airtable-schema` so it matches §7. The line currently reads:

```markdown
2. **Mapping model:** `airtable-describe-base` function; `airtable_field_map` + `airtable_key`
```

Change it to:

```markdown
2. **Mapping model:** `airtable-schema` function; `airtable_field_map` + `airtable_key`
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-16-airtable-sync-engine-design.md
git commit -m "docs: register airtable-schema edge function" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- **Tests run locally.** Deno 2.5.x is installed; run `deno test --allow-all supabase/functions/airtable-schema/index.di.test.ts` at each step. The first run downloads `npm:@supabase/supabase-js@2` (pulled transitively via `_shared/deps.ts`) and caches it — allow network on the first run.
- **No DB, no MCP, no deploy.** This plan writes no migration and touches no table; the function deploys automatically when the directory changes on merge to `main`. There is nothing to apply via the Supabase MCP. Do **not** call `deploy_edge_function` manually — it would create drift against the auto-deploy.
- **403 vs 401 is the crux.** A `403` means the PAT is valid but lacks `schema.bases:read` → `{ schemaAccessible: false }` so the UI falls back to typed inputs (spec §7). A `401` means the PAT itself is wrong → an actionable `400` error. Keep these distinct.
- **Never leak the PAT.** The key only appears in the outbound `Authorization` header. Two tests assert `JSON.stringify(responseBody)` does not contain it — keep them.
- **`options` is forwarded opaquely.** The describe-base mode passes each field's `options` through verbatim (so `singleSelect.options.choices` survives for Phase 2b option-linking and §14 custom-field typing). Do not reshape it.
- **What this unblocks (not in this plan):** Phase 2b wires `supabase.functions.invoke('airtable-schema', { body: { org_id, baseId } })` into the Settings → Airtable Sync UI for base/table/field dropdowns, and adds the `airtable_field_map` / catalog-link columns. Live end-to-end verification against base `appKg8xpplxd49Bo6` happens there.

## Coverage vs spec §7

| Spec §7 requirement | Task |
|---|---|
| New `airtable-schema` function, DI pattern, shared `http.ts`/`auth.ts` | 1 |
| Auth: user JWT + `requireOrgRole(org_id, ['admin'])`; PAT via `get_org_airtable_key`, never returned | 1 |
| No `baseId` → `GET /v0/meta/bases` → `{ schemaAccessible: true, bases: [{ id, name }] }` | 1 |
| With `baseId` → `GET …/meta/bases/{baseId}/tables` → `{ schemaAccessible: true, tables: [{ id, name, fields: [{ name, type, options? }] }] }` | 2 |
| 403 / insufficient scope → `{ schemaAccessible: false }` (not an error) | 1 (list) · 2 (describe) |
| One scope gates both calls → a single unified fallback | 1 + 2 |
