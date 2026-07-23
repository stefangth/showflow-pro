# Per-Org Capability Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a super-admin, per-org capability-flags system (mirroring the entitlements pattern) whose first flag, `producer_can_invite`, lets producers invite artists to the app.

**Architecture:** A new `org_capabilities` table + `is_capability_enabled()` SQL twin, a three-runtime-mirrored registry (`src/lib/capabilities.ts` ⇄ `supabase/functions/_shared/capabilities.ts` ⇄ SQL defaults), a data layer + hook, enforcement in the `create-invitation` edge function (producers may invite only artists, only when the flag is on) and in `ArtistProfileSheet`, and a "User rights" toggle section in `EditOrgDialog`. Ships neutral (flag defaults off).

**Tech Stack:** Postgres (RLS, SECURITY DEFINER functions, triggers), Supabase edge functions (Deno), React 18 + TypeScript + @tanstack/react-query, vitest, Deno test, pgTAP.

**Spec:** `docs/superpowers/specs/2026-07-23-per-org-capability-flags-design.md`

## Global Constraints

- **Three-runtime mirror rule:** `src/lib/capabilities.ts`, `supabase/functions/_shared/capabilities.ts`, and the SQL `is_capability_enabled()` defaults must carry the same registry + defaults and change in the same commit. The shared TS block is byte-identical between the two files (enforced by a sentinel-delimited mirror test).
- **First (only) flag:** `producer_can_invite`, `defaultEnabled: false`.
- **Fail closed:** `checkCapability` returns `false` on RPC error (capabilities are grants; deny on error). No `booking_flow`-style fail-open.
- **Security invariant:** a producer may create only `'artist'` invitations, and only when `producer_can_invite` is on for that org. Admins/super-admins are never subject to the producer restriction. Enforced server-side regardless of client.
- **ADR-0011 preserved:** producers never see account PII (`canSeeAccount` stays `isAdmin`). Resend stays admin-only (`org_invitations` RW is admin-only RLS).
- **No new nav/route.** No `config.toml` change (no new edge function). **No `public/changelog.md` entry** (super-admin/platform surface; per project rule, platform-admin actions never appear there).
- **No `any`.** Derive types from `Database`; single `as unknown as Row` cast at query boundaries in `src/data/**` only. Semantic Tailwind tokens only.
- **Migrations** are applied via the Supabase MCP `apply_migration` (CONTROLLER-RUN); name the committed file to match the assigned version. Never hand-edit `types.ts` — regenerate and re-copy both mirrors.

## Convention (execution)

DB migration + type-regen + pgTAP tasks (Task 1) and final verification (Task 8) are **CONTROLLER-RUN** (prod writes via Supabase MCP). Code tasks (2–7) use a **sonnet** implementer + **sonnet** reviewer. Final whole-branch review = **opus**.

---

### Task 1: `org_capabilities` table + `is_capability_enabled` + triggers + RLS + pgTAP (CONTROLLER-RUN)

**Files:**
- Create: `supabase/migrations/<version>_org_capabilities.sql` (version = the `apply_migration`-assigned timestamp)
- Create: `supabase/tests/rpc/org_capabilities.sql` (pgTAP)
- Modify (regen, do not hand-edit): `src/integrations/supabase/types.ts`, `supabase/functions/_shared/database.types.ts`

**Interfaces:**
- Produces: table `public.org_capabilities(org_id, capability, enabled, updated_by, updated_at)`; RPC `public.is_capability_enabled(_org uuid, _capability text) returns boolean`.

- [ ] **Step 1: Apply the migration via the Supabase MCP `apply_migration`** (name `org_capabilities`), body:

```sql
create table public.org_capabilities (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  capability text not null,
  enabled    boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, capability)
);

alter table public.org_capabilities enable row level security;

create policy "Members can view org capabilities"
  on public.org_capabilities for select to authenticated
  using (public.is_org_member(auth.uid(), org_id));

create policy "Super admins manage capabilities"
  on public.org_capabilities for all to authenticated
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

create policy org_isolation on public.org_capabilities
  as restrictive for all to authenticated
  using (public.is_org_member(auth.uid(), org_id))
  with check (public.is_org_member(auth.uid(), org_id));

-- Registry twin. Defaults MUST mirror CAPABILITY_REGISTRY in
-- src/lib/capabilities.ts + _shared/capabilities.ts (same-PR rule).
create or replace function public.is_capability_enabled(_org uuid, _capability text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select enabled from public.org_capabilities where org_id = _org and capability = _capability),
    case _capability
      when 'producer_can_invite' then false
      else false
    end
  );
$$;

-- Stamp updated_at + updated_by on every write.
create or replace function public.stamp_org_capability()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger stamp_org_capability before insert or update on public.org_capabilities
  for each row execute function public.stamp_org_capability();

-- Audit into the existing generic settings_audit_log.
create or replace function public.log_org_capability_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.enabled is not distinct from old.enabled then
    return null;
  end if;
  insert into public.settings_audit_log (org_id, key, actor, old_value, new_value)
  values (
    new.org_id,
    'capability:' || new.capability,
    auth.uid(),
    case when tg_op = 'UPDATE' then to_jsonb(old.enabled) else null end,
    to_jsonb(new.enabled)
  );
  return null;
end $$;

create trigger log_org_capability_change after insert or update on public.org_capabilities
  for each row execute function public.log_org_capability_change();
```

- [ ] **Step 2: Save the migration file** at `supabase/migrations/<assigned-version>_org_capabilities.sql` with the exact SQL above (so the repo mirrors prod).

- [ ] **Step 3: Write + run the pgTAP tests** (`supabase/tests/rpc/org_capabilities.sql`), executed via the Supabase MCP `execute_sql` wrapped `begin; create extension if not exists pgtap; ... rollback;`, capturing all TAP lines into a temp `_tap` table granted to `authenticated`. Assertions:
  1. `is_capability_enabled(org, 'producer_can_invite')` = **false** with no row (registry default).
  2. Insert `(org,'producer_can_invite',true)` → `is_capability_enabled` = **true**.
  3. Update to `enabled=false` → `is_capability_enabled` = **false**.
  4. `stamp_org_capability` set `updated_by` = the acting user on insert.
  5. A `settings_audit_log` row exists with `key = 'capability:producer_can_invite'` after the insert.
  6. As a **non-super-admin** member, `insert into org_capabilities` is **blocked** by RLS (0 rows / error).
  7. As a member, `select` on the org's `org_capabilities` **succeeds** (any-member read).

Expected: all `ok`, `0` failures.

- [ ] **Step 4: Regenerate types** via the Supabase MCP `generate_typescript_types`; extract `.types`; write **both** `src/integrations/supabase/types.ts` and `supabase/functions/_shared/database.types.ts` byte-identical. Verify the diff is additive (only `org_capabilities` + the new function) and `npx vitest run src/integrations/supabase/typesMirror.test.ts` is green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts supabase/tests/rpc/org_capabilities.sql
git commit -m "add org_capabilities table + is_capability_enabled twin"
```

---

### Task 2: Capability registry — `src/lib/capabilities.ts` + `_shared/capabilities.ts` mirror + edge helpers

**Files:**
- Create: `src/lib/capabilities.ts`
- Create: `src/lib/capabilities.test.ts`
- Create: `supabase/functions/_shared/capabilities.ts`
- Create: `src/lib/capabilitiesMirror.test.ts`

**Interfaces:**
- Produces (frontend): `CapabilityKey`, `CapabilityDef`, `CAPABILITY_REGISTRY`, `CAPABILITY_KEYS`, `CapabilityRow`, `enabledCapabilities(rows)`, `isCapabilityEnabled(rows, cap)`.
- Produces (edge): the same registry/resolvers **plus** `checkCapability(admin, orgId, cap): Promise<boolean>` and `requireCapability(deps, orgId, cap): Promise<Response | null>`.

- [ ] **Step 1: Write the failing pure-logic test** `src/lib/capabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_KEYS, CAPABILITY_REGISTRY, enabledCapabilities, isCapabilityEnabled,
} from "./capabilities";

describe("capabilities registry", () => {
  it("producer_can_invite defaults to off (no row)", () => {
    expect(isCapabilityEnabled([], "producer_can_invite")).toBe(false);
    expect(enabledCapabilities([]).has("producer_can_invite")).toBe(false);
  });
  it("an explicit enabled row overrides the default", () => {
    expect(isCapabilityEnabled([{ capability: "producer_can_invite", enabled: true }], "producer_can_invite")).toBe(true);
  });
  it("an explicit disabled row stays off", () => {
    expect(isCapabilityEnabled([{ capability: "producer_can_invite", enabled: false }], "producer_can_invite")).toBe(false);
  });
  it("CAPABILITY_KEYS matches the registry", () => {
    expect(CAPABILITY_KEYS).toEqual(Object.keys(CAPABILITY_REGISTRY));
    expect(CAPABILITY_REGISTRY.producer_can_invite.defaultEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** (`npx vitest run src/lib/capabilities.test.ts`) — module not found.

- [ ] **Step 3: Create `src/lib/capabilities.ts`** with the shared block delimited by the mirror sentinels:

```ts
// Per-org capability flags ("user rights"). Pure logic only, no DB access.
// MIRROR: supabase/functions/_shared/capabilities.ts carries the same
// registry + resolvers (the two runtimes cannot share an import). Change
// both files in the same commit. SQL twin: public.is_capability_enabled().
//
// Capabilities are permission GRANTS (who may do an action), distinct from
// module entitlements (whether a feature exists — see entitlements.ts).

// >>> CAPABILITY REGISTRY MIRROR (keep byte-identical with the twin file) >>>
export type CapabilityKey = "producer_can_invite";

export interface CapabilityDef {
  key: CapabilityKey;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

export const CAPABILITY_REGISTRY: Record<CapabilityKey, CapabilityDef> = {
  producer_can_invite: {
    key: "producer_can_invite",
    label: "Producers can invite artists",
    description: "Allow producers (not just admins) to invite artists to the app.",
    defaultEnabled: false,
  },
};

export const CAPABILITY_KEYS = Object.keys(CAPABILITY_REGISTRY) as CapabilityKey[];

export interface CapabilityRow {
  capability: string;
  enabled: boolean;
}

export function enabledCapabilities(rows: CapabilityRow[]): Set<CapabilityKey> {
  const byKey = new Map(rows.map((r) => [r.capability, r.enabled]));
  return new Set(CAPABILITY_KEYS.filter((k) => byKey.get(k) ?? CAPABILITY_REGISTRY[k].defaultEnabled));
}

export function isCapabilityEnabled(rows: CapabilityRow[], capability: CapabilityKey): boolean {
  return enabledCapabilities(rows).has(capability);
}
// <<< CAPABILITY REGISTRY MIRROR <<<
```

- [ ] **Step 4: Run the test, verify it passes.**

- [ ] **Step 5: Create `supabase/functions/_shared/capabilities.ts`** — imports + the **byte-identical** sentinel block + edge helpers:

```ts
// Per-org capability flags ("user rights"). Pure logic (the mirror block)
// plus edge-only DB-backed helpers (below the divider).
// MIRROR: src/lib/capabilities.ts carries the same registry + resolvers
// (the two runtimes cannot share an import). Change both files in the same
// commit. SQL twin: public.is_capability_enabled().
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Deps } from "./deps.ts";
import { json } from "./http.ts";

// >>> CAPABILITY REGISTRY MIRROR (keep byte-identical with the twin file) >>>
export type CapabilityKey = "producer_can_invite";

export interface CapabilityDef {
  key: CapabilityKey;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

export const CAPABILITY_REGISTRY: Record<CapabilityKey, CapabilityDef> = {
  producer_can_invite: {
    key: "producer_can_invite",
    label: "Producers can invite artists",
    description: "Allow producers (not just admins) to invite artists to the app.",
    defaultEnabled: false,
  },
};

export const CAPABILITY_KEYS = Object.keys(CAPABILITY_REGISTRY) as CapabilityKey[];

export interface CapabilityRow {
  capability: string;
  enabled: boolean;
}

export function enabledCapabilities(rows: CapabilityRow[]): Set<CapabilityKey> {
  const byKey = new Map(rows.map((r) => [r.capability, r.enabled]));
  return new Set(CAPABILITY_KEYS.filter((k) => byKey.get(k) ?? CAPABILITY_REGISTRY[k].defaultEnabled));
}

export function isCapabilityEnabled(rows: CapabilityRow[], capability: CapabilityKey): boolean {
  return enabledCapabilities(rows).has(capability);
}
// <<< CAPABILITY REGISTRY MIRROR <<<

// ── Edge-only helpers (DB-backed via the is_capability_enabled RPC) ─────────
// Capabilities are permission grants; every helper here fails CLOSED (deny on
// error), unlike entitlements' booking_flow fail-open.

/** Ask the DB (via the `is_capability_enabled` RPC) whether `capability` is on for `orgId`. Fails closed. */
export async function checkCapability(
  admin: SupabaseClient,
  orgId: string,
  capability: CapabilityKey,
): Promise<boolean> {
  const { data, error } = await admin.rpc("is_capability_enabled", { _org: orgId, _capability: capability });
  if (error) return false;
  return data === true;
}

/** Edge gate: 403 `{ error: "capability_disabled" }` when `capability` is off for `orgId`, else null. */
export async function requireCapability(
  deps: Deps,
  orgId: string,
  capability: CapabilityKey,
): Promise<Response | null> {
  return (await checkCapability(deps.admin, orgId, capability)) ? null : json({ error: "capability_disabled" }, 403);
}
```

- [ ] **Step 6: Write the mirror-sync test** `src/lib/capabilitiesMirror.test.ts` (reads both files as text, extracts the sentinel block, asserts byte-equality — the Deno file can't be imported into vitest):

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Deno edge runtime cannot import from src/, so the capability registry is
// dual-homed. This test is the sync contract: the block between the sentinels
// must be byte-identical in both files. Change both in the same commit.
const START = "// >>> CAPABILITY REGISTRY MIRROR (keep byte-identical with the twin file) >>>";
const END = "// <<< CAPABILITY REGISTRY MIRROR <<<";

function block(path: string): string {
  const text = readFileSync(path, "utf8");
  const s = text.indexOf(START);
  const e = text.indexOf(END);
  if (s === -1 || e === -1) throw new Error(`mirror sentinels not found in ${path}`);
  return text.slice(s, e + END.length);
}

describe("capabilities registry mirror", () => {
  it("src/lib/capabilities.ts and _shared/capabilities.ts share a byte-identical registry block", () => {
    expect(block("supabase/functions/_shared/capabilities.ts")).toBe(block("src/lib/capabilities.ts"));
  });
});
```

- [ ] **Step 7: Run `npx vitest run src/lib/capabilities.test.ts src/lib/capabilitiesMirror.test.ts`, verify green.**

- [ ] **Step 8: Run the edge suite touching the new file** — `deno check supabase/functions/_shared/capabilities.ts` (via the project's Deno task) to confirm it type-checks with the Deno imports. (No standalone Deno test yet; Task 5 exercises `checkCapability` through `create-invitation`.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/capabilities.ts src/lib/capabilities.test.ts supabase/functions/_shared/capabilities.ts src/lib/capabilitiesMirror.test.ts
git commit -m "add capability registry (frontend + edge mirror) with fail-closed helpers"
```

---

### Task 3: Data layer — `fetchCapabilities` + `setOrgCapability`

**Files:**
- Create: `src/data/capabilities.ts`
- Create: `src/data/capabilities.test.ts`
- Modify: `src/data/platform.ts` (add `setOrgCapability`, `fetchAllOrgCapabilities`)

**Interfaces:**
- Consumes: `CapabilityRow`, `CapabilityKey` from `@/lib/capabilities`; `Database` from types.
- Produces: `fetchCapabilities(client, orgId): Promise<CapabilityRow[]>`; `setOrgCapability(client, orgId, capability, enabled): Promise<void>`.

- [ ] **Step 1: Write failing test** `src/data/capabilities.test.ts` (uses `src/test/supabaseFake.ts`):

```ts
import { describe, expect, it } from "vitest";
import { fetchCapabilities } from "./capabilities";
import { makeSupabaseFake } from "@/test/supabaseFake";

describe("fetchCapabilities", () => {
  it("selects capability+enabled for the org", async () => {
    const fake = makeSupabaseFake({
      "org_capabilities": [{ capability: "producer_can_invite", enabled: true }],
    });
    const rows = await fetchCapabilities(fake.client, "org-1");
    expect(rows).toEqual([{ capability: "producer_can_invite", enabled: true }]);
    const call = fake.calls.find((c) => c.table === "org_capabilities");
    expect(call?.filters).toContainEqual({ method: "eq", args: ["org_id", "org-1"] });
  });
});
```

> Note: match the exact `makeSupabaseFake` seed/recording shape used by `src/data/entitlements.test.ts` — mirror that file's assertions rather than the sketch above if the fake's API differs.

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Create `src/data/capabilities.ts`** (mirror `src/data/entitlements.ts`):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CapabilityRow } from "@/lib/capabilities";

/** The org's capability rows (capability + enabled only). */
export async function fetchCapabilities(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<CapabilityRow[]> {
  const { data, error } = await client
    .from("org_capabilities")
    .select("capability, enabled")
    .eq("org_id", orgId);
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 4: Add `setOrgCapability` + `fetchAllOrgCapabilities` to `src/data/platform.ts`** (mirror `setOrgEntitlement`/`fetchAllOrgEntitlements`; add `CapabilityKey`, `CapabilityRow` to the existing `@/lib/capabilities` import):

```ts
/** Toggle a single capability for an org (upsert on org_id+capability). Super-admin only via org_capabilities RLS. */
export async function setOrgCapability(
  client: SupabaseClient<Database>,
  orgId: string,
  capability: CapabilityKey,
  enabled: boolean,
): Promise<void> {
  const { error } = await client
    .from("org_capabilities")
    .upsert({ org_id: orgId, capability, enabled }, { onConflict: "org_id,capability" });
  if (error) throw error;
}

/** Every org's capability rows (platform fleet view, super-admin only). */
export async function fetchAllOrgCapabilities(
  client: SupabaseClient<Database>,
): Promise<Array<{ org_id: string } & CapabilityRow>> {
  const { data, error } = await client.from("org_capabilities").select("org_id, capability, enabled");
  if (error) throw error;
  return (data ?? []) as Array<{ org_id: string } & CapabilityRow>;
}
```

Add to the platform.ts imports: `import type { CapabilityRow, CapabilityKey } from "@/lib/capabilities";`.

- [ ] **Step 5: Run tests, verify green** (`npx vitest run src/data/capabilities.test.ts`).

- [ ] **Step 6: `npx tsc --noEmit` + `npm run lint` clean. Commit.**

```bash
git add src/data/capabilities.ts src/data/capabilities.test.ts src/data/platform.ts
git commit -m "add capabilities data layer (fetch + setOrgCapability)"
```

---

### Task 4: Hook — `useCapabilities` + `useCapability`

**Files:**
- Create: `src/hooks/useCapabilities.ts`
- Create: `src/hooks/useCapabilities.test.tsx`

**Interfaces:**
- Consumes: `fetchCapabilities` (Task 3); `enabledCapabilities`, `CAPABILITY_REGISTRY`, `CapabilityKey` from `@/lib/capabilities`; `useAuth().currentOrg`.
- Produces: `useCapabilities(): { capabilities: Set<CapabilityKey>; isLoading: boolean }`; `useCapability(cap: CapabilityKey): boolean`.

- [ ] **Step 1: Write failing test** `src/hooks/useCapabilities.test.tsx` (mirror `src/hooks/useNavCounts.test.ts` / entitlement hook test style; use `renderWithProviders` and mock the data layer, not the client):

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { makeWrapper } from "@/test/renderWithProviders";

vi.mock("@/data/capabilities", () => ({ fetchCapabilities: vi.fn() }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

import { fetchCapabilities } from "@/data/capabilities";
import { useAuth } from "@/features/auth/AuthContext";
import { useCapability } from "./useCapabilities";

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-1" } } as unknown as ReturnType<typeof useAuth>);
});

describe("useCapability", () => {
  it("returns the registry default (false) while loading, then the resolved value", async () => {
    vi.mocked(fetchCapabilities).mockResolvedValue([{ capability: "producer_can_invite", enabled: true }]);
    const { result } = renderHook(() => useCapability("producer_can_invite"), { wrapper: makeWrapper() });
    expect(result.current).toBe(false); // default while loading
    await waitFor(() => expect(result.current).toBe(true));
  });
});
```

> Note: use whatever `renderWithProviders` export the repo provides (`makeWrapper`/`renderWithProviders`) — mirror `src/hooks/useNavCounts.test.ts`.

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Create `src/hooks/useCapabilities.ts`** (mirror `useEntitlements.ts`):

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { enabledCapabilities, CAPABILITY_REGISTRY, type CapabilityKey } from "@/lib/capabilities";
import { fetchCapabilities } from "@/data/capabilities";

/** The current org's enabled capability set. Missing rows fall back to each
 *  capability's registry default inside enabledCapabilities(). */
export function useCapabilities() {
  const { currentOrg } = useAuth();
  const q = useQuery({
    queryKey: ["capabilities", currentOrg?.id],
    queryFn: () => fetchCapabilities(supabase, currentOrg!.id),
    enabled: !!currentOrg,
    staleTime: 60_000,
  });
  return { capabilities: enabledCapabilities(q.data ?? []), isLoading: q.isLoading };
}

/** Whether a single capability is enabled for the current org. Returns the
 *  registry default while capabilities are still loading. */
export function useCapability(capability: CapabilityKey): boolean {
  const { capabilities, isLoading } = useCapabilities();
  if (isLoading) return CAPABILITY_REGISTRY[capability].defaultEnabled;
  return capabilities.has(capability);
}
```

- [ ] **Step 4: Run test, verify green. `tsc`+lint clean. Commit.**

```bash
git add src/hooks/useCapabilities.ts src/hooks/useCapabilities.test.tsx
git commit -m "add useCapabilities/useCapability hooks"
```

---

### Task 5: Enforce `producer_can_invite` in `create-invitation`

**Files:**
- Modify: `supabase/functions/create-invitation/index.ts`
- Modify: `supabase/functions/create-invitation/index.di.test.ts`

**Interfaces:**
- Consumes: `requireOrgRole` (existing), `checkCapability` / `requireCapability` (Task 2), the `is_capability_enabled` RPC (Task 1).

**Behavior (see spec §4.1):** admins/super-admins unchanged (may invite any role). A caller who is only a producer may invite **only** `role='artist'`, and **only** when `producer_can_invite` is on.

- [ ] **Step 1: Write the failing edge tests** in `index.di.test.ts`. Add a producer-deps helper and four cases. (`requireOrgRole` reads `org_memberships` with `.in('role', roles)`; the fake applies `.in` filtering to single-object seeds, so a `{role:'producer'}` seed fails the `['admin']` gate and passes the `['producer']` gate.)

```ts
function producerDeps(extra: Record<string, unknown> = {}) {
  return makeFakeDeps({
    authUser: { id: "p1" },
    usersById: { p1: { email: "prod@acme.test" } },
    tables: {
      org_memberships: { data: { role: "producer" }, error: null },
      org_invitations: {
        data: { id: "inv1", org_id: "org-1", email: "invitee@x.com", role: "artist", status: "pending", token: "tok123", expires_at: "2099-01-01T00:00:00Z" },
        error: null,
      },
      organizations: { data: { name: "Acme" }, error: null },
    },
    ...extra,
  });
}

Deno.test("create-invitation DI: producer invites artist with capability ON → 200", async () => {
  const { deps } = producerDeps({ rpcs: { is_capability_enabled: { data: true, error: null } } });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "artist" }), deps);
  assertEquals(res.status, 200);
});

Deno.test("create-invitation DI: producer invites artist with capability OFF → 403 capability_disabled", async () => {
  const { deps } = producerDeps({ rpcs: { is_capability_enabled: { data: false, error: null } } });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "artist" }), deps);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "capability_disabled");
});

Deno.test("create-invitation DI: producer invites a PRODUCER (cap on) → 403 producers_can_only_invite_artists", async () => {
  const { deps } = producerDeps({ rpcs: { is_capability_enabled: { data: true, error: null } } });
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "producers_can_only_invite_artists");
});

Deno.test("create-invitation DI: admin still invites a producer → 200 (unchanged)", async () => {
  const { deps } = adminDeps();
  const res = await handle(inviteReq({ org_id: "org-1", email: "invitee@x.com", role: "producer" }), deps);
  assertEquals(res.status, 200);
});
```

- [ ] **Step 2: Run the create-invitation Deno tests, verify the new ones FAIL** (current handler 403s all producers regardless).

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/create-invitation/`
Expected: the three producer-path tests fail (status/error mismatch); the admin test already passes.

- [ ] **Step 3: Edit `create-invitation/index.ts`.** Add the import and replace the single admin gate with the two-call gate. Current (near line 34):

```ts
    // Caller must be an admin of the target org.
    const auth = await requireOrgRole(deps, req, body.org_id, ["admin"]);
    if (!auth.ok) return auth.response;

    const admin = deps.admin;
```

Replace with:

```ts
    // Admins & super-admins may invite any role (unchanged). A caller who is only
    // a producer may invite ONLY artists, and ONLY when producer_can_invite is on.
    // requireOrgRole returns just { ok, userId } (no role), so we gate twice.
    const adminAuth = await requireOrgRole(deps, req, body.org_id, ["admin"]);
    let inviterId: string;
    if (adminAuth.ok) {
      inviterId = adminAuth.userId!;
    } else {
      const prodAuth = await requireOrgRole(deps, req, body.org_id, ["producer"]);
      if (!prodAuth.ok) return prodAuth.response;
      // NOTE: the requested role is resolved to 'artist' below for the artist_id path;
      // for the plain path we must check the *incoming* body.role here.
      if (body.role !== "artist") return json({ error: "producers_can_only_invite_artists" }, 403);
      const capGate = await requireCapability(deps, body.org_id, "producer_can_invite");
      if (capGate) return capGate;
      inviterId = prodAuth.userId!;
    }

    const admin = deps.admin;
```

Add the import near the top:

```ts
import { requireCapability } from "../_shared/capabilities.ts";
```

Then update the two later uses of `auth.userId` to `inviterId`:
- the `insertRow` `invited_by: auth.userId` → `invited_by: inviterId`
- any other `auth.userId` reference in the handler (search the file; there is one in `insertRow`).

> **Ordering subtlety (verify during implementation):** the artist_id branch may force `role = "artist"` *after* this gate. Confirm the producer role check uses `body.role` (the raw requested role) so a producer passing `artist_id` + `role:'artist'` still resolves to artist and passes, while `role:'producer'` is rejected before the insert. If the existing code resolves `role` before the auth gate, gate on that resolved `role` instead — the net invariant is: a producer may only ever cause an `'artist'` insert.

- [ ] **Step 4: Run the full create-invitation Deno tests + the smoke test, verify all green.**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/create-invitation/`
Expected: PASS (incl. the existing "producer → 403" test, now 403 via `capability_disabled`).

- [ ] **Step 5: Run the WHOLE edge suite** to catch cross-function regressions:

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/create-invitation/
git commit -m "let producers invite artists when producer_can_invite is enabled"
```

---

### Task 6: Frontend enforcement — `LinkedAccountPanel` resend split + `ArtistProfileSheet` wiring

**Files:**
- Modify: `src/components/artists/LinkedAccountPanel.tsx`
- Modify: `src/components/artists/LinkedAccountPanel.test.tsx`
- Modify: `src/components/artists/ArtistProfileSheet.tsx`

**Interfaces:**
- Consumes: `useCapability` (Task 4).
- `LinkedAccountPanel` gains an optional `canResend?: boolean` prop (defaults to `canInvite`); the "Invite to app" button stays gated on `canInvite`, the "Resend" button moves to `canResend`.

- [ ] **Step 1: Write/adjust the failing `LinkedAccountPanel` test.** Add a case proving invite shows but resend is hidden when `canInvite && !canResend`:

```tsx
it("shows Invite (create) but hides Resend when canInvite and not canResend", () => {
  const onInvite = vi.fn();
  const { rerender } = render(
    <LinkedAccountPanel state="none" userId={null} bookingEmail="b@x.com" canSeeAccount={false} canInvite canResend={false} onInvite={onInvite} />,
  );
  expect(screen.getByRole("button", { name: /invite to app/i })).toBeInTheDocument();
  rerender(
    <LinkedAccountPanel state="invited" userId={null} bookingEmail="b@x.com" canSeeAccount={false} canInvite canResend={false} onResend={vi.fn()} />,
  );
  expect(screen.queryByRole("button", { name: /resend/i })).not.toBeInTheDocument();
});
```

Keep existing tests green (they omit `canResend`, so it defaults to `canInvite`).

- [ ] **Step 2: Run, verify the new test fails.**

- [ ] **Step 3: Edit `LinkedAccountPanel.tsx`.** Add the prop (ordered AFTER `canInvite` so the default can reference it) and switch the resend gate:

```ts
  /** Whether the viewer may invite/create (admins, or producers with the capability). */
  canInvite: boolean;
  /** Whether the viewer may resend a pending invite. Defaults to canInvite; kept admin-only
   *  in ArtistProfileSheet because resend reads org_invitations (admin-only RLS). */
  canResend?: boolean;
```

In the destructuring signature, add `canResend = canInvite` right after `canInvite`. Change the state="invited" resend button gate from `{canInvite && (` to `{canResend && (`.

- [ ] **Step 4: Edit `ArtistProfileSheet.tsx`.** Add the import and compute the gates:

```ts
import { useCapability } from '@/hooks/useCapabilities';
```

After `const isAdmin = hasRole('admin');` (line 38), add:

```ts
  const isProducer = hasRole('producer');
  const producerCanInvite = useCapability('producer_can_invite');
  const canInvite = isAdmin || (isProducer && producerCanInvite);
```

Change the `LinkedAccountPanel` props (around line 300-301):

```tsx
              canSeeAccount={isAdmin}
              canInvite={canInvite}
              canResend={isAdmin}
```

(Leave `accountLoading={isAdmin && ...}` and `onInvite`/`onResend` unchanged.)

- [ ] **Step 5: Run `npx vitest run src/components/artists/`, verify green.** `tsc`+lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/artists/
git commit -m "show artist invite to producers when producer_can_invite is on (resend stays admin-only)"
```

---

### Task 7: Super-admin UI — "User rights" section in `EditOrgDialog`

**Files:**
- Modify: `src/components/platform/EditOrgDialog.tsx`
- Modify/Create: `src/components/platform/EditOrgDialog.test.tsx` (add a capability-toggle test; create the file if none exists, mirroring the platform test harness)

**Interfaces:**
- Consumes: `setOrgCapability` (Task 3), `fetchCapabilities` (Task 3), `CAPABILITY_KEYS`, `CAPABILITY_REGISTRY`, `CapabilityKey` (Task 2).

- [ ] **Step 1: Write the failing test** — render `EditOrgDialog` with an org and assert the "User rights" section + the `producer_can_invite` Switch render, and toggling calls `setOrgCapability`. Mirror how existing platform component tests mock the data layer (`vi.mock('@/data/platform')`, `vi.mock('@/data/capabilities')`), and wrap in `renderWithProviders`. Assert:
  - text "User rights" present;
  - a Switch with `aria-label="Producers can invite artists"` present;
  - clicking it calls the mocked `setOrgCapability(_, org.org_id, "producer_can_invite", true)`.

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Edit `EditOrgDialog.tsx`.** Add imports:

```ts
import { setOrgEntitlement, setOrgCapability, /* …existing… */ } from "@/data/platform";
import { fetchCapabilities } from "@/data/capabilities";
import { CAPABILITY_KEYS, CAPABILITY_REGISTRY, type CapabilityKey } from "@/lib/capabilities";
```

After the `toggleModule` mutation (line ~88), add the capability query + toggle (mirror `isModuleEnabled`/`toggleModule`):

```ts
  const { data: capabilities } = useQuery({
    queryKey: ["capabilities", org?.org_id],
    queryFn: () => fetchCapabilities(supabase, org!.org_id),
    enabled: !!org,
  });

  const isCapabilityOn = (capability: CapabilityKey): boolean => {
    const row = capabilities?.find((r) => r.capability === capability);
    return row ? row.enabled : CAPABILITY_REGISTRY[capability].defaultEnabled;
  };

  const toggleCapability = useMutation({
    mutationFn: ({ capability, enabled }: { capability: CapabilityKey; enabled: boolean }) =>
      setOrgCapability(supabase, org!.org_id, capability, enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["capabilities"] });
      toast.success("User rights updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
```

Add the "User rights" section immediately AFTER the closing `</div>` of the "Modules" section (after line ~127), mirroring its markup:

```tsx
        <div className="mt-6 border border-border rounded-md p-4 space-y-3">
          <p className="text-sm font-medium">User rights</p>
          {CAPABILITY_KEYS.map((key) => {
            const def = CAPABILITY_REGISTRY[key];
            return (
              <div key={key} className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor={`capability-${key}`} className="font-medium">{def.label}</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
                </div>
                <Switch
                  id={`capability-${key}`}
                  aria-label={def.label}
                  checked={isCapabilityOn(key)}
                  disabled={toggleCapability.isPending}
                  onCheckedChange={(checked) => toggleCapability.mutate({ capability: key, enabled: checked })}
                />
              </div>
            );
          })}
        </div>
```

- [ ] **Step 4: Run `npx vitest run src/components/platform/EditOrgDialog.test.tsx`, verify green.** `tsc`+lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/platform/EditOrgDialog.tsx src/components/platform/EditOrgDialog.test.tsx
git commit -m "add User rights (capabilities) toggle section to EditOrgDialog"
```

---

### Task 8: Full verification + deploy readiness (CONTROLLER-RUN)

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite** — `npx vitest run` — all green (includes the new capability tests + the mirror test).
- [ ] **Step 2: Run the full edge suite** — `deno test --allow-all --node-modules-dir=none supabase/functions/` — all green.
- [ ] **Step 3: `npx tsc --noEmit`** — clean.
- [ ] **Step 4: `npm run lint`** — 0 warnings.
- [ ] **Step 5: Re-run the pgTAP** (`supabase/tests/rpc/org_capabilities.sql`) via `execute_sql` — all `ok`.
- [ ] **Step 6: Confirm no `config.toml` change** (no new edge function) and **no `public/changelog.md` change** (super-admin surface).
- [ ] **Step 7: Confirm the migration is applied to prod** and the committed migration file matches the applied version.
- [ ] **Step 8: Final whole-branch review** (opus) via `superpowers:requesting-code-review`, then `superpowers:finishing-a-development-branch` → open the PR against `main`, watch CI + reviewer comments.

---

## Self-review (author checklist — completed)

- **Spec coverage:** table+twin+triggers+RLS (T1) ✓; three-runtime registry+helpers (T2) ✓; data layer (T3) ✓; hook (T4) ✓; create-invitation enforcement incl. producer→artist-only + fail-closed (T5) ✓; ArtistProfileSheet/LinkedAccountPanel resend split (T6) ✓; EditOrgDialog "User rights" (T7) ✓; verification (T8) ✓.
- **Fail direction:** `checkCapability` returns `false` on error (T2) ✓.
- **Security invariant:** producer→artist-only enforced server-side with an explicit test (T5) ✓.
- **Mirror discipline:** sentinel-delimited byte-identical block + mirror test (T2); SQL defaults match registry (T1) ✓.
- **Type consistency:** `CapabilityKey`/`CapabilityRow`/`enabledCapabilities`/`isCapabilityEnabled` names identical across T2–T7; `is_capability_enabled(_org,_capability)` signature identical in T1 (SQL), T2 (`checkCapability`), and T5 (test seed) ✓.
- **No placeholders:** every code step carries complete code; `<version>` in T1 is the tool-assigned migration timestamp (documented), not a gap ✓.
