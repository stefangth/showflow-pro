# Phase 5 — Identity / Contact Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalize the `profiles`-vs-`artists` identity/contact ownership model, enforce one resolution rule in the offer/confirmation digests (registered artist → login email first), and surface the link in a read-only "Linked account" panel — with no table merge and no column drops.

**Architecture:** A single pure resolver in `supabase/functions/_shared/identity.ts` (re-exported to `src/lib/identity.ts`) is the one source of truth for "which email/name wins." The two digest edge functions resolve a registered artist's login email/display name via a new service-role-only `resolve_user_contacts(uuid[])` DB function. The frontend panel reuses the existing admin-only `list_org_members` (via `useOrgMembers`) — no new frontend RPC, keeping login-email PII at today's admin boundary.

**Tech Stack:** Deno edge functions (DI pattern, `makeFakeDeps`), Supabase Postgres (SECURITY DEFINER function + pgTAP), React 18 + React Query + shadcn/ui, Vitest + RTL.

**Source spec:** [`docs/superpowers/specs/2026-06-17-phase-5-identity-contact-design.md`](../specs/2026-06-17-phase-5-identity-contact-design.md)

**Commit trailer (every commit):**
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

**Environment constraints (read before running anything):**
- **No local Node/Vitest/pgTAP.** Frontend `vitest` and `supabase test db` (pgTAP) run **in CI only** — write the tests, but validate them via CI, not locally.
- **Deno runs locally.** Run edge/unit Deno tests with `deno test --allow-all <path>`. Do **not** run the whole `supabase/functions/` dir (it fails resolving `npm:@types/react` in the email-templates subtree) — pass specific files/dirs.
- **Supabase changes go through the MCP** (project `epweartpzwvcasrzyueh`): `apply_migration` → `list_migrations` to read the recorded version → **rename the local migration file to that exact version** → `generate_typescript_types` to regen `types.ts`.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `supabase/functions/_shared/identity.ts` | **New.** Pure resolvers: `resolveContactEmail`, `resolveAccountDisplayName`. | 1 |
| `supabase/functions/_shared/identity.test.ts` | **New.** Deno unit tests for the resolvers. | 1 |
| `src/lib/identity.ts` | **New.** Frontend re-export of the resolvers (single source of truth). | 1 |
| `src/lib/identity.test.ts` | **New.** Vitest smoke test for the re-export bridge. | 1 |
| `supabase/migrations/<version>_resolve_user_contacts.sql` | **New.** Service-role `resolve_user_contacts(uuid[])`. | 2 |
| `supabase/tests/rpc/resolve_user_contacts.sql` | **New.** pgTAP: returns email/display_name; locked to service_role. | 2 |
| `src/integrations/supabase/types.ts` | **Modify.** Add the regenerated `resolve_user_contacts` Functions entry. | 2 |
| `supabase/functions/send-offer-digest/index.ts` | **Modify.** Resolve recipient/greeting via the resolver + RPC. | 3 |
| `supabase/functions/send-offer-digest/index.di.test.ts` | **Modify.** Add registered/unregistered/gap/greeting tests. | 3 |
| `supabase/functions/send-confirmation-digest/index.ts` | **Modify.** Same change as the offer digest. | 3 |
| `supabase/functions/send-confirmation-digest/index.di.test.ts` | **Modify.** Add registered + gap tests. | 3 |
| `src/components/artists/LinkedAccountPanel.tsx` | **New.** Presentational, props-driven panel using the resolver. | 4 |
| `src/components/artists/LinkedAccountPanel.test.tsx` | **New.** Vitest + RTL tests for the panel. | 4 |
| `src/components/artists/ArtistProfileSheet.tsx` | **Modify.** Wire `useOrgMembers` + render the panel. | 4 |
| `docs/adr/0011-identity-contact-ownership.md` | **New.** ADR-0011. | 5 |
| `docs/adr/0001-airtable-system-of-record.md` | **Modify.** Update item 6 to the refined scope. | 5 |
| `docs/superpowers/specs/2026-06-16-airtable-sync-engine-design.md` | **Modify.** Update §12 step 5. | 5 |
| `CLAUDE.md` | **Modify.** Add the ownership-model + digest-rule decision notes. | 5 |
| `docs/app-logic.md` | **Modify.** Add an "Identity vs. booking contact" subsection. | 5 |

---

## Task 1: Shared identity resolver

**Files:**
- Create: `supabase/functions/_shared/identity.ts`
- Test: `supabase/functions/_shared/identity.test.ts`
- Create: `src/lib/identity.ts`
- Test: `src/lib/identity.test.ts`

- [ ] **Step 1: Write the failing Deno test**

Create `supabase/functions/_shared/identity.test.ts`:

```ts
import { assertEquals } from "./test-asserts.ts";
import { resolveContactEmail, resolveAccountDisplayName } from "./identity.ts";

Deno.test("resolveContactEmail: login (auth) email wins over booking email", () => {
  assertEquals(
    resolveContactEmail({ authEmail: "login@x.com", bookingEmail: "book@x.com" }),
    "login@x.com",
  );
});

Deno.test("resolveContactEmail: falls back to booking email when no auth email", () => {
  assertEquals(resolveContactEmail({ authEmail: null, bookingEmail: "book@x.com" }), "book@x.com");
  assertEquals(resolveContactEmail({ bookingEmail: "book@x.com" }), "book@x.com");
});

Deno.test("resolveContactEmail: whitespace-only treated as absent; both empty → null", () => {
  assertEquals(resolveContactEmail({ authEmail: "   ", bookingEmail: "book@x.com" }), "book@x.com");
  assertEquals(resolveContactEmail({ authEmail: null, bookingEmail: null }), null);
  assertEquals(resolveContactEmail({ authEmail: "  ", bookingEmail: "  " }), null);
});

Deno.test("resolveAccountDisplayName: account display name wins over talent label", () => {
  assertEquals(
    resolveAccountDisplayName({ displayName: "Ada Lovelace", artistName: "Talent Label" }),
    "Ada Lovelace",
  );
});

Deno.test("resolveAccountDisplayName: falls back to talent label, then empty string", () => {
  assertEquals(resolveAccountDisplayName({ displayName: null, artistName: "Talent" }), "Talent");
  assertEquals(resolveAccountDisplayName({ displayName: "  ", artistName: "Talent" }), "Talent");
  assertEquals(resolveAccountDisplayName({ displayName: null, artistName: null }), "");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all supabase/functions/_shared/identity.test.ts`
Expected: FAIL — `Module not found "…/identity.ts"`.

- [ ] **Step 3: Implement the resolver**

Create `supabase/functions/_shared/identity.ts`:

```ts
/**
 * Identity / contact resolution — the single source of truth for ADR-0011.
 *
 * profiles  = global login-user identity (display_name; login email is auth.users.email)
 * artists   = per-org bookable talent (name = talent label, email = booking contact)
 *
 * A registered artist (artists.user_id set) has both; an unregistered artist
 * (user_id null) has only the artist row. These helpers encode which one wins.
 * Pure + dependency-free so they run unchanged in Deno (edge) and the browser (re-export).
 */

/**
 * The address to reach a person.
 * Registered → login (auth) email wins; the booking email is the fallback.
 * Unregistered → only the booking email exists.
 * Whitespace-only values are treated as absent.
 */
export function resolveContactEmail(opts: {
  authEmail?: string | null;
  bookingEmail?: string | null;
}): string | null {
  const auth = opts.authEmail?.trim();
  const booking = opts.bookingEmail?.trim();
  return auth || booking || null;
}

/**
 * The name to address a person by in account/identity contexts (e.g. a digest greeting).
 * The account display name wins; the talent label is the fallback.
 */
export function resolveAccountDisplayName(opts: {
  displayName?: string | null;
  artistName?: string | null;
}): string {
  return opts.displayName?.trim() || opts.artistName?.trim() || "";
}
```

- [ ] **Step 4: Run the Deno test to verify it passes**

Run: `deno test --allow-all supabase/functions/_shared/identity.test.ts`
Expected: PASS (6 tests, ok).

- [ ] **Step 5: Create the frontend re-export + its smoke test**

Create `src/lib/identity.ts` (mirrors the Phase 3 `airtableMapping.ts` cross-import precedent):

```ts
// Single source of truth for identity/contact resolution (ADR-0011). The edge
// functions import the same module from _shared; the frontend re-exports it so
// the digest path and the UI never diverge.
export { resolveContactEmail, resolveAccountDisplayName } from
  "../../supabase/functions/_shared/identity.ts";
```

Create `src/lib/identity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveContactEmail, resolveAccountDisplayName } from "@/lib/identity";

describe("identity resolver (frontend re-export bridge)", () => {
  it("re-exports resolveContactEmail with login-first semantics", () => {
    expect(resolveContactEmail({ authEmail: "login@x.com", bookingEmail: "book@x.com" })).toBe("login@x.com");
  });
  it("re-exports resolveAccountDisplayName with display-name-first semantics", () => {
    expect(resolveAccountDisplayName({ displayName: "Ada", artistName: "Talent" })).toBe("Ada");
  });
});
```

- [ ] **Step 6: Type-check the cross-import locally (CI runs vitest)**

Run: `deno check supabase/functions/_shared/identity.ts`
Expected: no errors. (The `src/lib/identity.test.ts` vitest run is CI-only — note it; do not attempt locally.)

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/identity.ts supabase/functions/_shared/identity.test.ts src/lib/identity.ts src/lib/identity.test.ts
git commit -m "feat(identity): shared contact/display-name resolver (ADR-0011)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `resolve_user_contacts` DB function

**Files:**
- Create: `supabase/migrations/<version>_resolve_user_contacts.sql`
- Test: `supabase/tests/rpc/resolve_user_contacts.sql`
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/<version>_resolve_user_contacts.sql` (the `<version>` is fixed in Step 3 after applying). Content:

```sql
-- Phase 5: resolve_user_contacts — batched login email + display_name lookup by
-- user_id, for the offer/confirmation digests (ADR-0011). Reads auth.users, so it
-- is SECURITY DEFINER and granted to service_role ONLY (the digests run as
-- service role). The frontend never calls this; it reuses list_org_members.
create or replace function public.resolve_user_contacts(p_user_ids uuid[])
returns table (user_id uuid, email text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text, p.display_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = any(p_user_ids);
$$;

revoke all on function public.resolve_user_contacts(uuid[]) from public, anon, authenticated;
grant execute on function public.resolve_user_contacts(uuid[]) to service_role;
```

- [ ] **Step 2: Apply the migration via the Supabase MCP**

Call the MCP tool `apply_migration` with `project_id: "epweartpzwvcasrzyueh"`, `name: "resolve_user_contacts"`, and `query` = the SQL from Step 1.
Expected: success.

- [ ] **Step 3: Read the recorded version and rename the local file**

Call MCP `list_migrations` (`project_id: "epweartpzwvcasrzyueh"`); find the just-applied `resolve_user_contacts` row and read its `version` (e.g. `20260617XXXXXX`). Rename the local file to exactly `supabase/migrations/<version>_resolve_user_contacts.sql` so the repo matches the remote ledger.

- [ ] **Step 4: Write the pgTAP test**

Create `supabase/tests/rpc/resolve_user_contacts.sql`:

```sql
-- supabase/tests/rpc/resolve_user_contacts.sql
-- resolve_user_contacts: returns login email + profile display_name by user_id,
-- and is NOT executable by `authenticated` (it reads auth.users).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

SET session_replication_role = replica;
-- u1 has a profile with a display name; u2 has an auth user but NO profile row.
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('cccccccc-0000-4000-a000-000000000001','authenticated','authenticated','login1@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('cccccccc-0000-4000-a000-000000000002','authenticated','authenticated','login2@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.profiles (user_id, display_name)
VALUES ('cccccccc-0000-4000-a000-000000000001','Ada Lovelace')
ON CONFLICT (user_id) DO UPDATE SET display_name = excluded.display_name;
SET session_replication_role = DEFAULT;

-- 1 & 2. user WITH a profile → returns auth email + profile display_name.
SELECT is(
  (SELECT email FROM public.resolve_user_contacts(ARRAY['cccccccc-0000-4000-a000-000000000001']::uuid[])),
  'login1@test.com', 'returns the auth email for a known user');
SELECT is(
  (SELECT display_name FROM public.resolve_user_contacts(ARRAY['cccccccc-0000-4000-a000-000000000001']::uuid[])),
  'Ada Lovelace', 'returns the profile display_name');

-- 3. user WITHOUT a profile → email present, display_name null.
SELECT is(
  (SELECT display_name FROM public.resolve_user_contacts(ARRAY['cccccccc-0000-4000-a000-000000000002']::uuid[])),
  NULL, 'display_name is null when no profile row exists');

-- 4 & 5. privilege: authenticated cannot execute; service_role can.
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.resolve_user_contacts(uuid[])', 'EXECUTE'),
  'authenticated cannot execute resolve_user_contacts');
SELECT ok(
  has_function_privilege('service_role', 'public.resolve_user_contacts(uuid[])', 'EXECUTE'),
  'service_role can execute resolve_user_contacts');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 5: Validate the pgTAP locally via the MCP (pgTAP is CI-only otherwise)**

Call MCP `execute_sql` (`project_id: "epweartpzwvcasrzyueh"`) with the **entire** contents of `supabase/tests/rpc/resolve_user_contacts.sql` (it is wrapped in `BEGIN … ROLLBACK`, so it leaves no trace).
Expected: 5 TAP rows, each beginning `ok 1`…`ok 5` (no `not ok`). If any `not ok`, fix the migration/test and re-apply.

- [ ] **Step 6: Regenerate types and add the Functions entry**

Call MCP `generate_typescript_types` (`project_id: "epweartpzwvcasrzyueh"`). In the result, locate the new `resolve_user_contacts` entry under `Database["public"]["Functions"]` and apply exactly that entry into the local `src/integrations/supabase/types.ts` (targeted edit, to keep the diff minimal). It will look like:

```ts
      resolve_user_contacts: {
        Args: { p_user_ids: string[] }
        Returns: {
          user_id: string
          email: string
          display_name: string
        }[]
      }
```

(Insert it in `Functions` in alphabetical position, matching the generated output.)

- [ ] **Step 7: Type-check the edited types file**

Run: `deno check supabase/functions/_shared/identity.ts`
Expected: no errors. (Full frontend typecheck is CI-only.)

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/*_resolve_user_contacts.sql supabase/tests/rpc/resolve_user_contacts.sql src/integrations/supabase/types.ts
git commit -m "feat(db): resolve_user_contacts service-role lookup (ADR-0011)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Digests enforce the resolution rule

**Files:**
- Modify: `supabase/functions/send-offer-digest/index.ts`
- Test: `supabase/functions/send-offer-digest/index.di.test.ts`
- Modify: `supabase/functions/send-confirmation-digest/index.ts`
- Test: `supabase/functions/send-confirmation-digest/index.di.test.ts`

- [ ] **Step 1: Write the failing DI tests for the offer digest**

Append to `supabase/functions/send-offer-digest/index.di.test.ts` (the helpers `baseDeps`, `APP_SETTINGS_SEED`, `ORG_1`, `cronOK`, `BERLIN_19_CEST`, `makeFakeDeps`, `assertExists` are already defined/imported at the top of that file):

```ts
// ── ADR-0011: registered artist → login email first ───────────────────────────

Deno.test("send-offer-digest: registered artist → login email wins; greeting uses display_name", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Talent Label", email: "booking@x.com", user_id: "u1" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_19_CEST,
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: pending, error: null },
    },
    rpcs: { resolve_user_contacts: { data: [{ user_id: "u1", email: "login@x.com", display_name: "Ada Lovelace" }] } },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  const msg = email!.body as { recipient_email: string; templateData?: { displayName?: string } };
  assertEquals(msg.recipient_email, "login@x.com");
  assertEquals(msg.templateData?.displayName, "Ada Lovelace");
});

Deno.test("send-offer-digest: unregistered artist (no user_id) → booking email + talent label", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "External Act", email: "booking@x.com", user_id: null },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = baseDeps({ bookings: { data: pending, error: null } });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  const msg = email!.body as { recipient_email: string; templateData?: { displayName?: string } };
  assertEquals(msg.recipient_email, "booking@x.com");
  assertEquals(msg.templateData?.displayName, "External Act");
});

Deno.test("send-offer-digest: registered artist with blank booking email → delivered at login email (gap regression)", async () => {
  const pending = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Talent", email: null, user_id: "u1" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_19_CEST,
    tables: {
      app_settings: APP_SETTINGS_SEED,
      organizations: { data: [{ id: ORG_1 }], error: null },
      bookings: { data: pending, error: null },
    },
    rpcs: { resolve_user_contacts: { data: [{ user_id: "u1", email: "login@x.com", display_name: null }] } },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  const msg = email!.body as { recipient_email: string; templateData?: { displayName?: string } };
  assertEquals(msg.recipient_email, "login@x.com");
  // display_name null → greeting falls back to the talent label
  assertEquals(msg.templateData?.displayName, "Talent");
});
```

- [ ] **Step 2: Run the offer-digest tests to verify the new ones fail**

Run: `deno test --allow-all supabase/functions/send-offer-digest/`
Expected: the three new tests FAIL (recipient is `booking@x.com`/skipped, displayName is the talent label) because the handler still reads `artist.email`/`artist.name` directly. The pre-existing tests still pass.

- [ ] **Step 3: Rewire the offer digest**

In `supabase/functions/send-offer-digest/index.ts`:

(a) Add the resolver import after the existing imports (top of file):

```ts
import { resolveContactEmail, resolveAccountDisplayName } from "../_shared/identity.ts";
```

(b) Add `user_id` to the joined artists select (currently `artists ( id, name, email )`):

```ts
        artists ( id, name, email, user_id ),
```

(c) Immediately after the `if (!pendingBookings || pendingBookings.length === 0) continue;` line, resolve the registered users' contacts:

```ts
    // ADR-0011: registered artists are addressed at their login (auth) email; the
    // booking email is the fallback (and the only address an unregistered artist has).
    const userIds = [...new Set(
      (pendingBookings as any[]).map((b) => b.artists?.user_id).filter((id: unknown): id is string => !!id),
    )];
    const byUser = new Map<string, { email: string | null; display_name: string | null }>();
    if (userIds.length > 0) {
      const { data: contacts, error: contactsErr } = await admin.rpc('resolve_user_contacts', { p_user_ids: userIds });
      if (contactsErr) {
        // Non-fatal: fall back to booking emails for this org's artists.
        console.error('send-offer-digest: resolve_user_contacts failed', { org: org.id, error: contactsErr.message });
      } else {
        for (const c of (contacts ?? []) as Array<{ user_id: string; email: string | null; display_name: string | null }>) {
          byUser.set(c.user_id, { email: c.email, display_name: c.display_name });
        }
      }
    }
```

(d) In the grouping loop, replace these lines:

```ts
      const artist = b.artists;
      const recipientEmail = artist?.email;
      if (!recipientEmail) continue;
```

with:

```ts
      const artist = b.artists;
      const acct = artist?.user_id ? byUser.get(artist.user_id) : undefined;
      const recipientEmail = resolveContactEmail({ authEmail: acct?.email, bookingEmail: artist?.email });
      if (!recipientEmail) continue;
```

(e) In the `grouped.set(...)` call, replace `displayName: artist?.name ?? ''` with:

```ts
        grouped.set(b.artist_id, { recipientEmail, displayName: resolveAccountDisplayName({ displayName: acct?.display_name, artistName: artist?.name }), bookingIds: [], offers: [] });
```

- [ ] **Step 4: Run the offer-digest tests to verify all pass**

Run: `deno test --allow-all supabase/functions/send-offer-digest/`
Expected: PASS — all tests including the three new ones and the pre-existing "artist has no email → skipped" (its artist has no `user_id`, so it stays unregistered → no email → skipped).

- [ ] **Step 5: Write the failing DI tests for the confirmation digest**

Append to `supabase/functions/send-confirmation-digest/index.di.test.ts`. First confirm the file's existing top-of-file helpers (org id constant, settings seed, `cronOK`, a Berlin-20:00 timestamp). The confirmation digest defaults to **hour 20**; use a 20:00-Berlin `now`. Add:

```ts
// ── ADR-0011: registered artist → login email first ───────────────────────────
// CEST (UTC+2): 2026-06-01T18:00:00Z = 20:00 Berlin (confirmation default hour).
const BERLIN_20_CEST = new Date("2026-06-01T18:00:00.000Z");
const CONF_SETTINGS = [
  { when: { key: "cron_secret" }, data: { value: "s" } },
  { when: { key: "confirmation_digest_hour_berlin" }, data: [{ org_id: null, value: 20 }] },
];
const CONF_ORG = "00000000-0000-0000-0000-0000000000a1";

Deno.test("send-confirmation-digest: registered artist → login email wins; greeting uses display_name", async () => {
  const confirmed = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Talent Label", email: "booking@x.com", user_id: "u1" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_20_CEST,
    tables: {
      app_settings: CONF_SETTINGS,
      organizations: { data: [{ id: CONF_ORG }], error: null },
      bookings: { data: confirmed, error: null },
    },
    rpcs: { resolve_user_contacts: { data: [{ user_id: "u1", email: "login@x.com", display_name: "Ada Lovelace" }] } },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  const msg = email!.body as { recipient_email: string; templateData?: { displayName?: string } };
  assertEquals(msg.recipient_email, "login@x.com");
  assertEquals(msg.templateData?.displayName, "Ada Lovelace");
});

Deno.test("send-confirmation-digest: registered artist with blank booking email → delivered at login email (gap regression)", async () => {
  const confirmed = [{
    id: "b1", artist_id: "a1",
    artists: { id: "a1", name: "Talent", email: null, user_id: "u1" },
    show_dates: { date: "2026-06-10", shows: { program: "P", sub_program: "S" }, cities: { name: "Berlin" } },
  }];
  const { deps, invokeCalls } = makeFakeDeps({
    now: BERLIN_20_CEST,
    tables: {
      app_settings: CONF_SETTINGS,
      organizations: { data: [{ id: CONF_ORG }], error: null },
      bookings: { data: confirmed, error: null },
    },
    rpcs: { resolve_user_contacts: { data: [{ user_id: "u1", email: "login@x.com", display_name: null }] } },
  });
  const res = await handle(makeRequest({ headers: cronOK }), deps);
  assertEquals((await res.json()).digests_sent, 1);
  const email = invokeCalls.find((c) => c.name === "send-transactional-email");
  assertExists(email);
  assertEquals((email!.body as { recipient_email: string }).recipient_email, "login@x.com");
});
```

> If `cronOK`, `makeFakeDeps`, `makeRequest`, `assertEquals`, `assertExists`, or `handle` are not already imported/defined at the top of `index.di.test.ts`, add the same imports the offer-digest test uses:
> `import { assertEquals, assertExists } from "../_shared/test-asserts.ts";`
> `import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";`
> `import { handle } from "./index.ts";`
> and `const cronOK = { "X-Cron-Secret": "s" };`.

- [ ] **Step 6: Run the confirmation-digest tests to verify the new ones fail**

Run: `deno test --allow-all supabase/functions/send-confirmation-digest/`
Expected: the two new tests FAIL (recipient is `booking@x.com`/skipped).

- [ ] **Step 7: Rewire the confirmation digest (identical shape)**

In `supabase/functions/send-confirmation-digest/index.ts`:

(a) Add the import after the existing imports:

```ts
import { resolveContactEmail, resolveAccountDisplayName } from "../_shared/identity.ts";
```

(b) Add `user_id` to the artists select (currently `artists ( id, name, email )`):

```ts
        artists ( id, name, email, user_id ),
```

(c) Immediately after `if (!confirmedBookings || confirmedBookings.length === 0) continue;`, insert:

```ts
    // ADR-0011: registered artists are addressed at their login (auth) email; the
    // booking email is the fallback (and the only address an unregistered artist has).
    const userIds = [...new Set(
      (confirmedBookings as any[]).map((b) => b.artists?.user_id).filter((id: unknown): id is string => !!id),
    )];
    const byUser = new Map<string, { email: string | null; display_name: string | null }>();
    if (userIds.length > 0) {
      const { data: contacts, error: contactsErr } = await admin.rpc('resolve_user_contacts', { p_user_ids: userIds });
      if (contactsErr) {
        console.error('send-confirmation-digest: resolve_user_contacts failed', { org: org.id, error: contactsErr.message });
      } else {
        for (const c of (contacts ?? []) as Array<{ user_id: string; email: string | null; display_name: string | null }>) {
          byUser.set(c.user_id, { email: c.email, display_name: c.display_name });
        }
      }
    }
```

(d) In the grouping loop, replace:

```ts
      const artist = b.artists;
      const recipientEmail = artist?.email;
      if (!recipientEmail) continue;
```

with:

```ts
      const artist = b.artists;
      const acct = artist?.user_id ? byUser.get(artist.user_id) : undefined;
      const recipientEmail = resolveContactEmail({ authEmail: acct?.email, bookingEmail: artist?.email });
      if (!recipientEmail) continue;
```

(e) In the `grouped.set(...)` call, replace `displayName: artist?.name ?? ''` with:

```ts
        grouped.set(b.artist_id, { recipientEmail, displayName: resolveAccountDisplayName({ displayName: acct?.display_name, artistName: artist?.name }), bookingIds: [], bookings: [] });
```

- [ ] **Step 8: Run both digest test suites to verify all pass**

Run: `deno test --allow-all supabase/functions/send-offer-digest/ supabase/functions/send-confirmation-digest/`
Expected: PASS (all tests green in both dirs).

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/send-offer-digest/ supabase/functions/send-confirmation-digest/
git commit -m "feat(digests): address registered artists by login email (ADR-0011)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Linked-account panel on ArtistProfileSheet

**Files:**
- Create: `src/components/artists/LinkedAccountPanel.tsx`
- Test: `src/components/artists/LinkedAccountPanel.test.tsx`
- Modify: `src/components/artists/ArtistProfileSheet.tsx`

- [ ] **Step 1: Write the failing component test** (vitest is CI-only — write it, validate via CI)

Create `src/components/artists/LinkedAccountPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { LinkedAccountPanel } from "./LinkedAccountPanel";

describe("LinkedAccountPanel", () => {
  it("unregistered artist → external badge, no login email", () => {
    renderWithProviders(
      <LinkedAccountPanel userId={null} bookingEmail="book@x.com" canSeeAccount={true} />,
    );
    expect(screen.getByText(/external/i)).toBeInTheDocument();
    expect(screen.queryByText("login@x.com")).not.toBeInTheDocument();
  });

  it("registered + admin → account name, login email, and effective digest email (login-first)", () => {
    renderWithProviders(
      <LinkedAccountPanel
        userId="u1"
        bookingEmail="book@x.com"
        account={{ email: "login@x.com", display_name: "Ada Lovelace" }}
        canSeeAccount={true}
      />,
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    // login@x.com appears as both the login email and the effective "Digest goes to" target.
    expect(screen.getAllByText("login@x.com").length).toBeGreaterThanOrEqual(1);
  });

  it("registered + admin + null account email → effective digest email falls back to booking", () => {
    renderWithProviders(
      <LinkedAccountPanel
        userId="u1"
        bookingEmail="book@x.com"
        account={{ email: null, display_name: "Ada" }}
        canSeeAccount={true}
      />,
    );
    expect(screen.getByText("book@x.com")).toBeInTheDocument();
  });

  it("registered + producer (cannot see account) → badge only, no login email", () => {
    renderWithProviders(
      <LinkedAccountPanel
        userId="u1"
        bookingEmail="book@x.com"
        account={{ email: "login@x.com", display_name: "Ada" }}
        canSeeAccount={false}
      />,
    );
    expect(screen.getByText(/registered/i)).toBeInTheDocument();
    expect(screen.queryByText("login@x.com")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Create the panel component**

Create `src/components/artists/LinkedAccountPanel.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { resolveContactEmail } from "@/lib/identity";

interface LinkedAccountPanelProps {
  /** artists.user_id — null/undefined means unregistered (external talent, no login). */
  userId: string | null | undefined;
  /** artists.email — the booking contact (may be null). */
  bookingEmail: string | null | undefined;
  /** The linked login account; pass only when the viewer is an admin and the member was found. */
  account?: { email: string | null; display_name: string | null };
  /** True while the admin account lookup is in flight. */
  accountLoading?: boolean;
  /** Whether the viewer may see account-level PII (admins). Producers get the badge only. */
  canSeeAccount: boolean;
}

/**
 * Read-only "Linked account" section for ArtistProfileSheet (ADR-0011). Surfaces
 * whether a talent record is tied to a login account and — for admins — the
 * effective digest recipient (digests prefer the login email; see _shared/identity).
 */
export function LinkedAccountPanel({
  userId,
  bookingEmail,
  account,
  accountLoading,
  canSeeAccount,
}: LinkedAccountPanelProps) {
  const isRegistered = !!userId;
  const effectiveDigestEmail = resolveContactEmail({ authEmail: account?.email, bookingEmail });

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Linked account</span>
        <Badge variant={isRegistered ? "secondary" : "outline"}>
          {isRegistered ? "Registered" : "Unregistered — external"}
        </Badge>
      </div>

      {!isRegistered && (
        <p className="text-sm text-muted-foreground">
          No login account. Digests use the booking email{bookingEmail ? ` (${bookingEmail})` : ""}.
        </p>
      )}

      {isRegistered && canSeeAccount && (
        accountLoading ? (
          <p className="text-sm text-muted-foreground">Loading account…</p>
        ) : account ? (
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Account name</dt>
            <dd>{account.display_name ?? "—"}</dd>
            <dt className="text-muted-foreground">Login email</dt>
            <dd>{account.email ?? "—"}</dd>
            <dt className="text-muted-foreground">Digest goes to</dt>
            <dd>{effectiveDigestEmail ?? "—"}</dd>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            Account details unavailable. Digests go to {effectiveDigestEmail ?? "the booking email"}.
          </p>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire the panel into ArtistProfileSheet**

In `src/components/artists/ArtistProfileSheet.tsx`:

(a) Add imports (with the other imports near the top):

```ts
import { useOrgMembers } from '@/hooks/useOrgMembers';
import { LinkedAccountPanel } from './LinkedAccountPanel';
```

(b) After the line `const canEdit = hasRole('admin') || hasRole('producer');`, add:

```ts
  const isAdmin = hasRole('admin');
  // Reuse the admin-only member list (list_org_members) to resolve the linked account.
  // Only enabled for admins — producers get the badge only (no PII), per ADR-0011.
  const { data: orgMembers, isLoading: membersLoading } = useOrgMembers(
    isAdmin ? currentOrg?.id : null,
  );
  const linkedMember = artist?.user_id && orgMembers
    ? orgMembers.find((m) => m.user_id === artist.user_id)
    : undefined;
```

(c) Inside the `<form>` (the `: (` branch where `artist` is defined), render the panel just before the `{canEdit && (` action-buttons block:

```tsx
            <LinkedAccountPanel
              userId={artist.user_id}
              bookingEmail={artist.email}
              account={linkedMember ? { email: linkedMember.email, display_name: linkedMember.display_name } : undefined}
              accountLoading={isAdmin && !!artist.user_id && membersLoading}
              canSeeAccount={isAdmin}
            />
```

- [ ] **Step 4: Type-check the touched frontend modules locally**

Run: `deno check supabase/functions/_shared/identity.ts`
Expected: no errors. (Frontend `tsc`/`vitest` for `LinkedAccountPanel.test.tsx` + `ArtistProfileSheet` is CI-only — note it; validate via CI.)

- [ ] **Step 5: Commit**

```bash
git add src/components/artists/LinkedAccountPanel.tsx src/components/artists/LinkedAccountPanel.test.tsx src/components/artists/ArtistProfileSheet.tsx
git commit -m "feat(artists): linked-account panel on ArtistProfileSheet (ADR-0011)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Docs — ADR-0011 + updates

**Files:**
- Create: `docs/adr/0011-identity-contact-ownership.md`
- Modify: `docs/adr/0001-airtable-system-of-record.md`
- Modify: `docs/superpowers/specs/2026-06-16-airtable-sync-engine-design.md`
- Modify: `CLAUDE.md`
- Modify: `docs/app-logic.md`

- [ ] **Step 1: Write ADR-0011**

Create `docs/adr/0011-identity-contact-ownership.md`:

```markdown
# ADR-0011: Identity vs. booking-contact ownership (profiles vs artists)

**Status:** Accepted
**Date:** 2026-06-17
**Deciders:** Stefan Schaal

## Context

A person's details live in two tables: the global `profiles` row (one per auth user:
`display_name`, `phone`, `avatar_url`) and the per-org `artists` row (`name`, `email`, `phone`,
`bio`, `cast_role`, `status`; `user_id` is **nullable**). The fields look duplicated, and Phase 5
was framed as "deduplication." Investigation showed: (a) production holds 1 profile and 0 artists —
no data to reconcile; (b) the two tables serve different populations; and (c) the contact fields on
`artists` are **load-bearing** — an unregistered/external artist has no profile, so their
name/email/phone can only live on the artist row. Linking is headless: `accept_invitation` claims an
unregistered artist row by email, setting `artists.user_id`, so at link time `artists.email` equals
`auth.users.email`.

## Decision

**`profiles` owns login-user identity; `artists` owns the org-scoped bookable talent record and its
booking contact. We do not merge the tables and do not drop columns.** The overlap is two different
real-world contacts (account vs. booking), not duplication to be collapsed.

- Account identity: `profiles.display_name`, personal `profiles.phone`, `profiles.avatar_url`
  (reserved), login email `auth.users.email`.
- Talent record: `artists.name` (talent label), `artists.email`/`artists.phone` (booking contact),
  `artists.bio`, `artists.status`, `artists.cast_role` (reserved).
- **Reserved columns** (`cast_role`, `avatar_url`) are intentionally retained, not removed.

**Resolution rule (registered artist, `user_id` set):** account identity wins for *the person* —
specifically, the offer/confirmation digests address them at their login email first
(`coalesce(auth.users.email, artists.email)`) and greet them by `display_name` (falling back to the
talent label). Unregistered artists are unaffected (`artists.*` only). The talent label
(`artists.name`) remains canonical on talent surfaces.

The rule lives in one pure module, `supabase/functions/_shared/identity.ts` (re-exported to
`src/lib/identity.ts`). The digests resolve login contacts via the service-role-only
`resolve_user_contacts(uuid[])` function; the frontend "Linked account" panel reuses the admin-only
`list_org_members`, keeping login-email PII at the existing admin boundary.

## Consequences

**Easier:** a documented model that won't be "fixed" by a merge; digests reach registered artists at
their verified login email and no longer silently drop an artist whose booking email is blank; the
admin can see the effective digest recipient on the artist sheet.

**Harder:** a registered artist's `artists.name` and `display_name` can differ (by design); the panel
is a best-effort mirror of the digest (it can't show the login email if the membership was removed
while the artist row stayed linked — see the Phase 5 spec §10).

**Revisit if:** unregistered artists need richer contact than `artists.*` provides, or a unified
cross-org person view is required.
```

- [ ] **Step 2: Update ADR-0001 item 6**

In `docs/adr/0001-airtable-system-of-record.md`, replace the line:

```
6. [ ] **Phase 5:** identity/contact deduplication (`profiles` / `artists`).
```

with:

```
6. [x] **Phase 5:** identity/contact **ownership** — `profiles` owns login-user identity; `artists`
   owns the org-scoped talent record + booking contact (load-bearing for unregistered talent). No
   merge, no column drops; enforced in the digests. Recorded in
   [ADR-0011](0011-identity-contact-ownership.md).
```

- [ ] **Step 3: Update the master spec §12 step 5**

In `docs/superpowers/specs/2026-06-16-airtable-sync-engine-design.md`, replace:

```
5. **Identity/contact dedup:** collapse `profiles`/`artists` contact fields (separate, independent).
```

with:

```
5. **Identity/contact ownership:** formalize the two-population model (no merge, no column drops);
   enforce the login-email-first rule in the digests; add a "Linked account" panel. See ADR-0011 +
   the Phase 5 design spec (`2026-06-17-phase-5-identity-contact-design.md`).
```

- [ ] **Step 4: Update CLAUDE.md**

In `CLAUDE.md`, under the "### Key decisions" list, add a new bullet (after the slot-capacity / booking bullets, before the Airtable bullets):

```
- **Identity vs. booking contact (ADR-0011).** `profiles` (global, per auth user) owns login-user
  identity (`display_name`, personal `phone`, `avatar_url` reserved; login email is
  `auth.users.email`). `artists` (per org) owns the bookable talent record + booking contact
  (`name` = talent label, `email`/`phone` = booking contact, `bio`, `status`, `cast_role` reserved);
  `user_id` is nullable (unregistered/external talent have no profile, so their contact MUST live on
  `artists`). The tables are **not** merged and **no** columns are dropped. The resolution rule lives
  in `supabase/functions/_shared/identity.ts` (`resolveContactEmail` = login-email-first;
  `resolveAccountDisplayName` = display-name-first), re-exported by `src/lib/identity.ts`. The
  offer/confirmation digests address a registered artist at `coalesce(auth.users.email,
  artists.email)` via the service-role-only `resolve_user_contacts(uuid[])` function; the
  ArtistProfileSheet "Linked account" panel reuses the admin-only `list_org_members`.
```

- [ ] **Step 5: Update docs/app-logic.md**

Open `docs/app-logic.md`, find the section describing `artists`/`profiles` (search for "artist" or "profile" in the data-model section). Add this subsection there:

```markdown
### Identity vs. booking contact

A person can appear in two tables. **`profiles`** is their global login account (one per user:
display name, personal phone, avatar). **`artists`** is their bookable talent record *inside an org*
(talent name, booking email/phone, bio, status) — and it exists even for external artists with no
login (`user_id` is empty). These are different real-world contacts, not duplicates, so they are
kept separate (ADR-0011).

When an invited person accepts, their artist row is linked to their login automatically (by email).
For a linked (registered) artist, the offer/confirmation **digest emails go to their login email**
first, falling back to the booking email; the admin can see the effective recipient in the artist's
"Linked account" panel.
```

- [ ] **Step 6: Commit**

```bash
git add docs/adr/0011-identity-contact-ownership.md docs/adr/0001-airtable-system-of-record.md docs/superpowers/specs/2026-06-16-airtable-sync-engine-design.md CLAUDE.md docs/app-logic.md
git commit -m "docs(identity): ADR-0011 + ownership-model docs (Phase 5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] **Deno suites green locally:**
  Run: `deno test --allow-all supabase/functions/_shared/identity.test.ts supabase/functions/send-offer-digest/ supabase/functions/send-confirmation-digest/`
  Expected: all PASS.
- [ ] **pgTAP validated via MCP** (Task 2 Step 5) — 5/5 `ok`.
- [ ] **Open a PR** and confirm CI is green: Typecheck, Unit (vitest — includes `src/lib/identity.test.ts` + `LinkedAccountPanel.test.tsx`), Lint, E2E, pgTAP (includes `resolve_user_contacts.sql`), Deno.
- [ ] **Post-merge live check (carry-over):** still pending from Phases 3+4 — trigger a poll against the German base and confirm non-zero `imported_count`. Independent of Phase 5, but bundle the validation if convenient.
```
