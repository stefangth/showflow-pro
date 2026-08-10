# Invite Password Setup + Branded Magic-Link Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee every invited user a one-click way into the app (set-password or straight-in) regardless of account state, and add a branded, Resend-delivered "email me a sign-in link" option co-equal with password on every login.

**Architecture:** One new public edge function (`send-login-link`) mints Supabase auth links via `generateLink` and sends them through the existing branded Resend pipeline (`deps.sendEmail`) — never letting Supabase Auth send its own unbranded email. The same "mint, don't send" primitive hardens the invite email's existing-user branch. Magic and invite links land on one new public route, `/auth/callback`, which resolves the session and forwards to a safe relative redirect. A small dedicated table (`auth_link_throttle`) enforces a per-email cooldown via a `SECURITY DEFINER` RPC.

**Tech Stack:** Supabase (Postgres + Auth + edge functions on Deno), React 18 + Vite + TypeScript, React Query, Tailwind + shadcn/ui, Vitest (unit), Deno test (edge), pgTAP (DB), Playwright (e2e). Email templates are React Email components.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the spec / CLAUDE.md.

- **Edge functions use the DI pattern:** export `handle(req, deps)`, wire `Deno.serve((req) => handle(req, realDeps()))` only at the bottom. Tests import `handle` and pass `makeFakeDeps(...)` from `supabase/functions/_shared/testing.ts`. Use `_shared/http.ts` (`preflight`/`json`), never re-inline CORS/client/auth.
- **New public edge function needs a `config.toml` block** with `verify_jwt = false`, or it deploys with JWT verification forced on and 401s the public caller.
- **`any` is banned** (lint error, CI `--max-warnings 0`). For untyped Supabase rows use an explicit local interface + a single `as unknown as` cast at the query boundary; in tests use the typed helpers, never per-site `as any`.
- **No em-dashes or en-dashes in any product/UI/email copy strings** (mockups, UI strings, emails, changelog). Use period, comma, colon, middot. Arrows are fine. (Spec prose may use dashes; copy strings may not.)
- **Mirrored files are generated — never hand-edit a target.** `src/lib/emailTemplates/emailCopy.ts` is a mirror SOURCE; run `npm run sync:mirrors` after editing it; `npm run sync:mirrors:check` gates CI. `emailTemplateMeta.ts` and `coverage.ts` are frontend-only (NOT mirrored) and edited directly, but must ship in the same commit as the `emailCopy.ts` change.
- **Migrations: the merge applies them; you do not.** Never hand-apply to production to green a PR. Generate via the migration tool; the file must be named to match the version actually recorded. Seed data lives in `seed.sql`, never a migration. Never hand-edit `src/integrations/supabase/types.ts` — regenerate it.
- **New tables need RLS enabled + explicit policies.** `auth_link_throttle` is auth infrastructure keyed by email (NOT tenant data): RLS enabled with ZERO policies + `revoke all from anon, authenticated` = deny-all; no RESTRICTIVE `org_isolation` policy (there is no `org_id`). Explicit `grant ... to service_role` (newer CLI strips implicit grants on fresh local stacks).
- **Week starts Monday** everywhere (not relevant here, but the app-wide rule).
- **Test-first (TDD):** write the failing test before implementation; bug fixes start with a failing regression test. Tests import the real module — never re-implement production logic in a test.
- **Type-checking is three projects:** `npx tsc -p tsconfig.app.json --noEmit` (src/), `npx tsc -p tsconfig.tools.json --noEmit` (e2e/, scripts), `deno check --node-modules-dir=none supabase/functions/<fn>/index.ts` (edge). None subsumes the others.
- **Branch:** `claude/invited-user-password-setup-f00051`. Commit messages imperative, lowercase, <=72 chars. End commit messages with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

## Task 1: Throttle table + `claim_login_link_slot` RPC (migration, pgTAP, type regen)

**Files:**
- Create: migration under `supabase/migrations/` (named to match the recorded version — see Step 8)
- Create: `supabase/tests/rls/auth_link_throttle.sql`
- Modify (regenerated, do not hand-edit): `src/integrations/supabase/types.ts`, `supabase/functions/_shared/database.types.ts`

**Interfaces:**
- Produces: DB function `public.claim_login_link_slot(p_email text, p_cooldown_seconds int) returns boolean` (service-role execute only); table `public.auth_link_throttle(email text primary key, last_sent_at timestamptz)`. After regen, `claim_login_link_slot` is a typeable `.rpc()` name in the generated types (consumed by Task 6).

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/rls/auth_link_throttle.sql`:

```sql
begin;
select plan(12);

-- Structure + RLS posture
select has_table('public', 'auth_link_throttle', 'auth_link_throttle table exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.auth_link_throttle'::regclass),
  true, 'RLS is enabled on auth_link_throttle');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'auth_link_throttle'),
  0, 'auth_link_throttle has zero policies (deny-all at grant layer)');

-- Grant-layer denial: downgrade to the authenticated role so the revoked grant applies.
set local role authenticated;
select throws_ok($$ select * from public.auth_link_throttle $$, '42501', null,
  'authenticated cannot SELECT auth_link_throttle');
select throws_ok($$ insert into public.auth_link_throttle(email) values ('a@x.com') $$, '42501', null,
  'authenticated cannot INSERT auth_link_throttle');
select throws_ok($$ update public.auth_link_throttle set last_sent_at = now() $$, '42501', null,
  'authenticated cannot UPDATE auth_link_throttle');
select throws_ok($$ delete from public.auth_link_throttle $$, '42501', null,
  'authenticated cannot DELETE auth_link_throttle');
select throws_ok($$ select public.claim_login_link_slot('a@x.com', 60) $$, '42501', null,
  'authenticated cannot EXECUTE claim_login_link_slot');
reset role;

-- RPC behavior (superuser/service context in the test harness)
select is(public.claim_login_link_slot('claim@x.com', 60), true, 'first claim for a fresh email returns true');
select is(public.claim_login_link_slot('claim@x.com', 60), false, 'immediate second claim returns false (within cooldown)');

update public.auth_link_throttle set last_sent_at = now() - interval '2 minutes' where email = 'claim@x.com';
select is(public.claim_login_link_slot('claim@x.com', 60), true, 're-claim after the window returns true');

-- Coupling regression: a >1-day cooldown must NOT prune a row inside its window.
insert into public.auth_link_throttle(email, last_sent_at) values ('long@x.com', now() - interval '1 day');
select is(public.claim_login_link_slot('long@x.com', 172800), false,
  'a row 1 day old is not pruned and stays throttled under a 2-day cooldown');

select finish();
rollback;
```

- [ ] **Step 2: Run the pgTAP test to verify it fails**

Run: `supabase test db` (local stack running; from repo root). If the local stack is not up: `npm run local:up` first.
Expected: FAIL — `auth_link_throttle` does not exist / `claim_login_link_slot` is undefined.

- [ ] **Step 3: Generate the migration via the migration tool**

Create a migration (via the Supabase migration tool / `supabase migration new auth_link_throttle`) with this body:

```sql
-- Per-email cooldown for server-minted auth links (magic-link login + re-invite).
-- Auth infrastructure, keyed by email, NOT org-scoped and NOT tenant data.
create table public.auth_link_throttle (
  email        text        primary key,
  last_sent_at timestamptz not null default now()
);

alter table public.auth_link_throttle enable row level security;
-- No policies for anon/authenticated: written/read ONLY by the service-role edge
-- function (bypasses RLS) via the RPC below. RLS-enabled + zero policies = deny-all.
-- No RESTRICTIVE org_isolation policy: there is no org_id; it is not tenant data.

-- Explicit grants: newer Supabase CLI strips implicit table grants on fresh local stacks.
revoke all on public.auth_link_throttle from anon, authenticated;
grant all on public.auth_link_throttle to service_role;

-- Atomic claim: returns true and stamps last_sent_at when the cooldown has elapsed
-- (or no row exists), false when still within the window. Also prunes stale rows.
create or replace function public.claim_login_link_slot(
  p_email text,
  p_cooldown_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now   timestamptz := now();
  -- Prune horizon = LARGER of one day or the cooldown, so raising the cooldown never
  -- prunes a row still inside its cooldown window.
  v_prune interval := greatest(interval '1 day', make_interval(secs => p_cooldown_seconds));
  v_claimed boolean;
begin
  delete from public.auth_link_throttle where last_sent_at < v_now - v_prune;

  insert into public.auth_link_throttle as t (email, last_sent_at)
  values (lower(p_email), v_now)
  on conflict (email) do update
    set last_sent_at = v_now
    where t.last_sent_at < v_now - make_interval(secs => p_cooldown_seconds)
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_login_link_slot(text, int) from anon, authenticated;
grant execute on function public.claim_login_link_slot(text, int) to service_role;
```

- [ ] **Step 4: Apply locally and run the pgTAP test to verify it passes**

Run: `npm run local:reset` (applies every migration to the local Postgres + seeds), then `supabase test db`.
Expected: PASS — all 12 pgTAP assertions green.

- [ ] **Step 5: Regenerate types from the local stack**

Run:
```bash
supabase gen types typescript --local > src/integrations/supabase/types.ts
```
Then regenerate the edge mirror:
```bash
npm run sync:mirrors
```

- [ ] **Step 6: Verify the type regen + mirror**

Run: `npm run sync:mirrors:check && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS, and `claim_login_link_slot` now appears in `src/integrations/supabase/types.ts` (grep to confirm: `grep -n claim_login_link_slot src/integrations/supabase/types.ts`).

> Fallback if the local stack is unavailable (path 2): skip Steps 5-6 and instead cast at the single `.rpc()` call site in Task 6 using a widened-args type in `supabase/functions/_shared/rows.ts` (`type ClaimLoginLinkSlotArgs = { p_email: string; p_cooldown_seconds: number }`, invoked as `deps.admin.rpc("claim_login_link_slot" as never, args as unknown as ClaimLoginLinkSlotArgs)`), mirroring `resolve_show_assignments`. Do NOT hand-apply the migration to production to satisfy the type checker.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations supabase/tests/rls/auth_link_throttle.sql src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts
git commit -m "add auth_link_throttle table + claim_login_link_slot rpc"
```

- [ ] **Step 8: Confirm the migration filename matches the recorded version**

If the migration tool recorded a version different from the filename (MCP `apply_migration` stamps its own timestamp), `git mv` the file to match the recorded version so `scripts/check-migrations.mjs` passes. With `supabase migration new` + local reset there is no drift. Verify: `node scripts/check-migrations.mjs` (or `npm run` equivalent) exits clean.

---

## Task 2: `safeAppOrigin` shared helper (edge)

**Files:**
- Create: `supabase/functions/_shared/appOrigin.ts`
- Test: `supabase/functions/_shared/appOrigin.test.ts`

**Interfaces:**
- Consumes: `appUrl(getEnv)` from `_shared/app-url.ts`; `Deps` from `_shared/deps.ts`.
- Produces: `export function safeAppOrigin(candidate: string | undefined, deps: Deps): string | null` — returns the trimmed candidate iff it is on the allowlist `{ appUrl(deps.env) } ∪ { http://localhost:8080, http://127.0.0.1:8080 }`, else `null`. Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/appOrigin.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { safeAppOrigin } from "./appOrigin.ts";
import type { Deps } from "./deps.ts";

// Minimal Deps stub: only deps.env is read (via appUrl). APP_URL unset => prod default.
const depsWith = (appUrl?: string): Deps =>
  ({ env: (k: string) => (k === "APP_URL" ? appUrl : undefined) } as unknown as Deps);

Deno.test("safeAppOrigin: accepts the canonical prod origin", () => {
  assertEquals(safeAppOrigin("https://app.showflow.pro", depsWith()), "https://app.showflow.pro");
});

Deno.test("safeAppOrigin: accepts a custom APP_URL canonical", () => {
  const d = depsWith("https://staging.example.com");
  assertEquals(safeAppOrigin("https://staging.example.com", d), "https://staging.example.com");
});

Deno.test("safeAppOrigin: accepts localhost:8080 even when APP_URL is unset (prod default canonical)", () => {
  // The load-bearing local-stack case: APP_URL unset => canonical is prod, but :8080 is still allowed.
  assertEquals(safeAppOrigin("http://localhost:8080", depsWith()), "http://localhost:8080");
  assertEquals(safeAppOrigin("http://127.0.0.1:8080", depsWith()), "http://127.0.0.1:8080");
});

Deno.test("safeAppOrigin: trims a trailing slash before matching", () => {
  assertEquals(safeAppOrigin("https://app.showflow.pro/", depsWith()), "https://app.showflow.pro");
});

Deno.test("safeAppOrigin: rejects a foreign origin -> null", () => {
  assertEquals(safeAppOrigin("https://evil.example", depsWith()), null);
});

Deno.test("safeAppOrigin: rejects missing / malformed -> null", () => {
  assertEquals(safeAppOrigin(undefined, depsWith()), null);
  assertEquals(safeAppOrigin("not a url", depsWith()), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-all supabase/functions/_shared/appOrigin.test.ts`
Expected: FAIL — `appOrigin.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/appOrigin.ts`:

```ts
import type { Deps } from "./deps.ts";
import { appUrl } from "./app-url.ts";

/**
 * Return `candidate` iff it is an allowlisted app origin, else null. The allowlist is the
 * canonical app origin (APP_URL or the prod default) plus the committed local-stack dev
 * origins. The localhost ports are allowed UNCONDITIONALLY (not gated on canonical being
 * localhost) because the local edge runtime has no APP_URL, so canonical resolves to prod;
 * gating would reject :8080 locally and mint a production redirect. A foreign host is never
 * allowlisted, so an open-redirect / phishing origin can never be minted into an auth link.
 */
export function safeAppOrigin(candidate: string | undefined, deps: Deps): string | null {
  if (!candidate) return null;
  let trimmed: string;
  try {
    // Normalise and validate as a URL; reject syntactic garbage.
    const u = new URL(candidate);
    trimmed = `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
  const canonical = appUrl(deps.env).replace(/\/+$/, "");
  const allow = new Set([canonical, "http://localhost:8080", "http://127.0.0.1:8080"]);
  return allow.has(trimmed) ? trimmed : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --allow-all supabase/functions/_shared/appOrigin.test.ts && deno check --node-modules-dir=none supabase/functions/_shared/appOrigin.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/appOrigin.ts supabase/functions/_shared/appOrigin.test.ts
git commit -m "add safeAppOrigin allowlist helper for public auth endpoints"
```

---

## Task 3: Record `generateLink` calls in the edge test fake (harness prerequisite)

**Files:**
- Modify: `supabase/functions/_shared/testing.ts`

**Interfaces:**
- Produces: the shared fake's `auth.admin.generateLink` now pushes `{ table: "auth.admin.generateLink", method: "generate", args: [params] }` into `calls` before returning the seeded result. Consumed by Tasks 6 and 7 (they assert `type`/`redirectTo` from the recorded call).

- [ ] **Step 1: Locate the current stub**

Read `supabase/functions/_shared/testing.ts` and find the `generateLink` implementation (currently `(_params: unknown) => Promise.resolve(opts.generateLinkResult ?? …)`, which does NOT record into `calls`). Compare with `resetPasswordForEmail`, which DOES push into `calls`.

- [ ] **Step 2: Edit the stub to record the call**

Change `generateLink` so it records before returning, mirroring `resetPasswordForEmail`:

```ts
generateLink: (params: unknown) => {
  calls.push({ table: "auth.admin.generateLink", method: "generate", args: [params] });
  return Promise.resolve(opts.generateLinkResult ?? { data: { properties: { action_link: "https://link.example/generated" } }, error: null });
},
```

(Preserve the exact existing default shape for `generateLinkResult ?? …` — keep whatever default the file already returns; only add the `calls.push(...)` line and thread `params` through instead of `_params`.)

- [ ] **Step 3: Run the full edge suite to verify nothing regressed**

Run: `deno test --allow-all supabase/functions/`
Expected: PASS — existing tests are unaffected (none asserts on the new recording yet).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/testing.ts
git commit -m "record generateLink calls in the edge test fake"
```

---

## Task 4: `magic-link` email template — copy defaults, component, registry, subject resolver

**Files:**
- Modify: `src/lib/emailTemplates/emailCopy.ts` (mirrored SOURCE)
- Modify: `src/lib/emailTemplates/emailCopy.test.ts` (extend internal-exclusion filter)
- Create: `supabase/functions/_shared/transactional-email-templates/magic-link.tsx`
- Modify: `supabase/functions/_shared/transactional-email-templates/registry.ts`
- Regenerated: `supabase/functions/_shared/transactional-email-templates/_shell/emailCopy.ts` (via `sync:mirrors`)

**Interfaces:**
- Produces: registered template key `"magic-link"` in `TEMPLATES` and `EMAIL_TEMPLATE_KEYS`, with `SUBJECT_RESOLVERS["magic-link"]`; the component reads only `{ actionLink }`. Consumed by Task 6 (`deps.sendEmail({ template_name: "magic-link", templateData: { actionLink } })`).

- [ ] **Step 1: Add copy defaults + the new key (mirrored source)**

In `src/lib/emailTemplates/emailCopy.ts`: add `"magic-link"` to `EMAIL_TEMPLATE_KEYS` immediately before `"cron-health-alert"`. Add these eight copy keys to `EMAIL_COPY_DEFAULTS` (no em/en dashes):

```ts
"magic-link.subject": "Your sign-in link for ShowFlow",
"magic-link.heading": "Sign in to ShowFlow",
"magic-link.greeting": "Hi,",
"magic-link.intro": "Use the button below to sign in. This link works once and expires shortly. If you did not request it, you can ignore this email.",
"magic-link.ctaLabel": "Sign in",
"magic-link.footer": "For your security, this link can only be used once.",
"magic-link.previewText": "Your one-time sign-in link for ShowFlow",
"magic-link.pasteLink": "Or paste this link into your browser:",
```

- [ ] **Step 2: Extend the parity-test filter (internal template, no meta block)**

In `src/lib/emailTemplates/emailCopy.test.ts`, in the test `"has metadata for every editable default and no orphan metadata field"` (~line 69), extend the existing exclusion:

```ts
// before: .filter((key) => !key.startsWith("cron-health-alert."))
.filter((key) => !key.startsWith("cron-health-alert.") && !key.startsWith("magic-link."))
```

Do NOT add an `emailTemplateMeta.ts` block — `magic-link` is internal, exactly like `cron-health-alert`.

- [ ] **Step 3: Regenerate the mirror and run the parity test to verify it passes**

Run: `npm run sync:mirrors && npx vitest run src/lib/emailTemplates/emailCopy.test.ts`
Expected: PASS — the `"contains no unicode em or en dashes"` test also passes over the new copy, and the mirror target `_shell/emailCopy.ts` now carries the `magic-link.*` keys.

- [ ] **Step 4: Write the template component**

Create `supabase/functions/_shared/transactional-email-templates/magic-link.tsx`:

```tsx
/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { Text } from "npm:@react-email/components@0.0.22";
import type { TemplateData, TemplateEntry } from "./registry.ts";
import { EmailShell, emailRoleStyle } from "./_shell/EmailShell.tsx";
import { EMAIL_COPY_DEFAULTS, type EmailCopy } from "./_shell/emailCopy.ts";
import { EMAIL_THEME_DEFAULTS, type EmailFamily, type EmailRoleKey, type EmailTheme } from "./_shell/emailTheme.ts";

interface Props {
  actionLink?: string;
  _emailCopy?: EmailCopy; _emailTheme?: EmailTheme; _emailFamily?: EmailFamily; _highlightRole?: EmailRoleKey;
}

const MagicLinkEmail = ({
  actionLink,
  _emailCopy = EMAIL_COPY_DEFAULTS as EmailCopy, _emailTheme = EMAIL_THEME_DEFAULTS,
  _emailFamily = "violet", _highlightRole,
}: Props) => {
  const copy = _emailCopy; const theme = _emailTheme;
  const href = actionLink || "";
  return (
    <EmailShell family={_emailFamily} theme={theme}
      previewText={copy["magic-link.previewText"]}
      heading={copy["magic-link.heading"]}
      footer={copy["magic-link.footer"]}
      cta={{ href, label: copy["magic-link.ctaLabel"] }} highlightRole={_highlightRole}>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{copy["magic-link.greeting"]}</Text>
      <Text style={{ ...emailRoleStyle(theme, "body", _highlightRole), lineHeight: "1.6", margin: "0 0 16px" }}>{copy["magic-link.intro"]}</Text>
      <Text style={{ ...emailRoleStyle(theme, "footer", _highlightRole), margin: "0 0 8px" }}>{copy["magic-link.pasteLink"]}</Text>
      <Text style={{ ...emailRoleStyle(theme, "dataValue", _highlightRole), margin: "0" }}>{href}</Text>
    </EmailShell>
  );
};

export const template = {
  component: MagicLinkEmail as React.ComponentType<TemplateData>,
  subject: EMAIL_COPY_DEFAULTS["magic-link.subject"],
  displayName: "Sign-in link",
  previewData: { actionLink: "https://app.showflow.pro/auth/callback?redirect=/dashboard" },
} satisfies TemplateEntry;
```

- [ ] **Step 5: Register the template + subject resolver**

In `supabase/functions/_shared/transactional-email-templates/registry.ts`:
- Add the import near the other template imports: `import { template as magicLink } from './magic-link.tsx'`
- Add to `TEMPLATES`: `'magic-link': { ...magicLink, family: 'violet' },`
- Add to `SUBJECT_RESOLVERS` (required — `EMAIL_TEMPLATE_KEYS` now includes `magic-link`, so the `satisfies Record<EmailTemplateKey, SubjectResolver>` becomes non-exhaustive without it):

```ts
'magic-link': (_data, copy) => copy['magic-link.subject'],
```

- [ ] **Step 6: Verify the edge template type-checks**

Run: `deno check --node-modules-dir=none supabase/functions/_shared/transactional-email-templates/registry.ts`
Expected: PASS — `SUBJECT_RESOLVERS` is exhaustive; the component satisfies `TemplateEntry`.

- [ ] **Step 7: Full parity + mirror re-check + commit**

Run: `npm run sync:mirrors:check && npx vitest run src/lib/emailTemplates/emailCopy.test.ts`
Expected: PASS.

```bash
git add src/lib/emailTemplates/emailCopy.ts src/lib/emailTemplates/emailCopy.test.ts \
  supabase/functions/_shared/transactional-email-templates/magic-link.tsx \
  supabase/functions/_shared/transactional-email-templates/registry.ts \
  supabase/functions/_shared/transactional-email-templates/_shell/emailCopy.ts
git commit -m "add branded magic-link email template (internal)"
```

---

## Task 5: Coverage registry entry for `magic-link`

**Files:**
- Modify: `src/lib/emailTemplates/coverage.ts`
- Modify: `src/lib/emailTemplates/coverage.test.ts`

- [ ] **Step 1: Update the pinned assertions first (failing test)**

In `src/lib/emailTemplates/coverage.test.ts`:
- In the ordered-key test (line ~6), insert `"magic-link"` into the expected `map(t => t.key)` array immediately after `"account-email-changed"` and before `"password-reset"`, and change the title string from `"...ten live delivery templates plus the external password reset"` to `"...eleven delivered templates plus the external password reset"`.
- Leave the `status === "editable"` list (line ~22) UNCHANGED (stays nine — magic-link is internal).
- Optional: in the `"keeps password reset external and cron health internal"` test (line ~36), add an assertion that `magic-link` is `status:"internal"`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/emailTemplates/coverage.test.ts`
Expected: FAIL — the ordered array does not yet contain `magic-link`.

- [ ] **Step 3: Add the coverage entry**

In `src/lib/emailTemplates/coverage.ts`, insert into `EMAIL_TEMPLATE_COVERAGE` in the `Accounts & access` group, immediately after `account-email-changed` and before `password-reset`:

```ts
{
  key: "magic-link",
  displayName: "Sign-in link",
  group: "Accounts & access",
  family: "violet",
  trigger: "User requests a sign-in link (send-login-link)",
  recipient: "The user",
  status: "internal", // like cron-health-alert: rendered from defaults, not per-org editable
  category: "critical", // literal; NOT in EMAIL_TEMPLATE_CATEGORY, so never preference-gated
},
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/emailTemplates/coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/emailTemplates/coverage.ts src/lib/emailTemplates/coverage.test.ts
git commit -m "list magic-link in the email coverage registry (internal)"
```

---

## Task 6: `send-login-link` edge function

**Files:**
- Create: `supabase/functions/send-login-link/index.ts`
- Test: `supabase/functions/send-login-link/index.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `safeAppOrigin` (Task 2), the fake's recorded `generateLink` (Task 3), `magic-link` template (Task 4), `claim_login_link_slot` RPC typed (Task 1), and the existing `get_user_id_by_email` RPC.
- Produces: `POST /functions/v1/send-login-link` with body `{ email, app_origin }` → `200 { ok: true }` (existence-hiding) / `400 { error }` / `500 { error: "Internal error" }`. Consumed by Task 8 (`requestLoginLink`).

- [ ] **Step 1: Add the config.toml block**

In `supabase/config.toml`, add (matching the other public-caller blocks):

```toml
[functions.send-login-link]
verify_jwt = false
```

- [ ] **Step 2: Write the failing test**

Create `supabase/functions/send-login-link/index.test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";
import { makeFakeDeps } from "../_shared/testing.ts";

const CANON = "https://app.showflow.pro";
const post = (body: unknown) =>
  new Request("https://x/functions/v1/send-login-link", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });

Deno.test("exists + slot allowed: mints magiclink and sends exactly one magic-link email", async () => {
  const deps = makeFakeDeps({
    authUsersByEmail: { "user@x.com": "uid-1" },
    rpcs: { claim_login_link_slot: true },
  });
  const res = await handle(post({ email: "user@x.com", app_origin: CANON }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });

  const sends = deps.sentEmails.filter((e) => e.template_name === "magic-link");
  assertEquals(sends.length, 1);
  assertEquals(sends[0].templateData, { actionLink: sends[0].templateData.actionLink }); // only actionLink
  assertEquals("org_id" in sends[0], false);

  const gen = deps.calls.find((c) => c.table === "auth.admin.generateLink");
  const params = gen!.args[0] as { type: string; options: { redirectTo: string } };
  assertEquals(params.type, "magiclink");
  assertEquals(params.options.redirectTo.includes("/auth/callback?redirect=%2Fdashboard"), true);
});

Deno.test("no account: 200 ok, no email, no throttle write", async () => {
  const deps = makeFakeDeps({ authUsersByEmail: {}, rpcs: { claim_login_link_slot: true } });
  const res = await handle(post({ email: "ghost@x.com", app_origin: CANON }), deps);
  assertEquals(res.status, 200);
  assertEquals(deps.sentEmails.length, 0);
  assertEquals(deps.calls.some((c) => c.table === "rpc" && c.args[0] === "claim_login_link_slot"), false);
});

Deno.test("lookup fault: 500 generic, no email, no throttle call", async () => {
  const deps = makeFakeDeps({ rpcs: { get_user_id_by_email: { error: { message: "boom" } } } });
  const res = await handle(post({ email: "user@x.com", app_origin: CANON }), deps);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Internal error" });
  assertEquals(deps.sentEmails.length, 0);
});

Deno.test("throttled: 200 ok, no email", async () => {
  const deps = makeFakeDeps({ authUsersByEmail: { "user@x.com": "uid-1" }, rpcs: { claim_login_link_slot: false } });
  const res = await handle(post({ email: "user@x.com", app_origin: CANON }), deps);
  assertEquals(res.status, 200);
  assertEquals(deps.sentEmails.length, 0);
});

Deno.test("throttle RPC fault: 500 generic, no email", async () => {
  const deps = makeFakeDeps({ authUsersByEmail: { "user@x.com": "uid-1" }, rpcs: { claim_login_link_slot: { error: { message: "boom" } } } });
  const res = await handle(post({ email: "user@x.com", app_origin: CANON }), deps);
  assertEquals(res.status, 500);
  assertEquals(deps.sentEmails.length, 0);
});

Deno.test("generateLink transient failure: 500 generic, no email", async () => {
  const deps = makeFakeDeps({
    authUsersByEmail: { "user@x.com": "uid-1" }, rpcs: { claim_login_link_slot: true },
    generateLinkResult: { data: null, error: { message: "transient" } },
  });
  const res = await handle(post({ email: "user@x.com", app_origin: CANON }), deps);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Internal error" });
  assertEquals(deps.sentEmails.length, 0);
});

Deno.test("malformed body / bad email: 400, no lookup", async () => {
  const deps = makeFakeDeps({});
  assertEquals((await handle(post({ email: "nope", app_origin: CANON }), deps)).status, 400);
  assertEquals(deps.sentEmails.length, 0);
});

Deno.test("foreign app_origin: 400, no mint, no email", async () => {
  const deps = makeFakeDeps({ authUsersByEmail: { "user@x.com": "uid-1" } });
  const res = await handle(post({ email: "user@x.com", app_origin: "https://evil.example" }), deps);
  assertEquals(res.status, 400);
  assertEquals(deps.calls.some((c) => c.table === "auth.admin.generateLink"), false);
  assertEquals(deps.sentEmails.length, 0);
});

Deno.test("localhost app_origin with prod APP_URL: accepted, redirect uses localhost", async () => {
  // APP_URL unset in makeFakeDeps => canonical is the prod default; :8080 must still be accepted.
  const deps = makeFakeDeps({ authUsersByEmail: { "user@x.com": "uid-1" }, rpcs: { claim_login_link_slot: true } });
  const res = await handle(post({ email: "user@x.com", app_origin: "http://localhost:8080" }), deps);
  assertEquals(res.status, 200);
  const gen = deps.calls.find((c) => c.table === "auth.admin.generateLink");
  const params = gen!.args[0] as { options: { redirectTo: string } };
  assertEquals(params.options.redirectTo.startsWith("http://localhost:8080/auth/callback"), true);
});

Deno.test("missing app_origin: 400", async () => {
  const deps = makeFakeDeps({ authUsersByEmail: { "user@x.com": "uid-1" } });
  assertEquals((await handle(post({ email: "user@x.com" }), deps)).status, 400);
});
```

> Note on fake seeding shapes (`authUsersByEmail`, `rpcs`, `generateLinkResult`, `deps.sentEmails`, `deps.calls`): confirm the exact option names against `supabase/functions/_shared/testing.ts` while writing the test and adjust the seeds to match the harness (the spec references `authUsersByEmail` backing `get_user_id_by_email`, `rpcs.<name>` for RPC results, and `generateLinkResult`). If `sentEmails`/`calls` have different accessor names in the fake, use the fake's actual names — do not invent new ones.

- [ ] **Step 3: Run the test to verify it fails**

Run: `deno test --allow-all supabase/functions/send-login-link/index.test.ts`
Expected: FAIL — `./index.ts` does not exist.

- [ ] **Step 4: Write the handler**

Create `supabase/functions/send-login-link/index.ts`:

```ts
import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { safeAppOrigin } from "../_shared/appOrigin.ts";

type Body = { email?: string; app_origin?: string };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOLDOWN_SECONDS = 60;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const email = body?.email?.trim().toLowerCase();
    const appOrigin = safeAppOrigin(body?.app_origin, deps);
    if (!email || !EMAIL_RE.test(email) || !appOrigin) return json({ error: "Invalid payload" }, 400);

    // Existence check FIRST via a single indexed lookup (get_user_id_by_email), NOT the
    // O(users) admin listUsers pagination. On a public endpoint this bounds the per-request
    // cost of a sprayed address to one indexed query and writes no throttle row for a non-account.
    const { data: userId, error: lookupErr } = await deps.admin.rpc("get_user_id_by_email", { p_email: email });
    if (lookupErr) {
      console.error("send-login-link get_user_id_by_email failed:", lookupErr.message);
      return json({ error: "Internal error" }, 500);
    }
    if (!userId) return json({ ok: true }); // no account: identical shape, nothing done

    const { data: allowed, error: throttleError } = await deps.admin.rpc("claim_login_link_slot", {
      p_email: email, p_cooldown_seconds: COOLDOWN_SECONDS,
    });
    if (throttleError) {
      console.error("send-login-link claim_login_link_slot failed:", throttleError.message);
      return json({ error: "Internal error" }, 500);
    }
    if (allowed !== true) return json({ ok: true }); // within cooldown; no second email, no leak

    const redirectTo = `${appOrigin}/auth/callback?redirect=${encodeURIComponent("/dashboard")}`;
    const { data, error } = await deps.admin.auth.admin.generateLink({
      type: "magiclink", email, options: { redirectTo },
    });
    if (error) throw error;
    const actionLink = (data as { properties?: { action_link?: string } })?.properties?.action_link;
    await deps.sendEmail({
      template_name: "magic-link",
      recipient_email: email,
      templateData: { actionLink },
    });
    return json({ ok: true });
  } catch (e) {
    console.error("send-login-link error", (e as Error).message);
    return json({ error: "Internal error" }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

> If Task 1 used the path-2 fallback (no local type regen), cast the throttle call: `deps.admin.rpc("claim_login_link_slot" as never, { p_email: email, p_cooldown_seconds: COOLDOWN_SECONDS } as unknown as ClaimLoginLinkSlotArgs)` with the type declared in `_shared/rows.ts`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `deno test --allow-all supabase/functions/send-login-link/index.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 6: Type-check the edge function + run the whole edge suite**

Run: `deno check --node-modules-dir=none supabase/functions/send-login-link/index.ts && deno test --allow-all supabase/functions/`
Expected: PASS (per the "edge fns have multiple test files" lesson, run the whole suite).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/send-login-link supabase/config.toml
git commit -m "add send-login-link edge function for branded magic-link login"
```

---

## Task 7: Invite hardening — existing-user magic link + honest paste line

**Files:**
- Modify: `supabase/functions/_shared/invitations.ts`
- Modify: `supabase/functions/_shared/transactional-email-templates/org-invitation.tsx`
- Test: `supabase/functions/_shared/invitations.test.ts` (replace one test, keep the net-new test)

**Interfaces:**
- Consumes: the recorded `generateLink` fake (Task 3).
- Produces: `deliverOrgInvitation` now always sets a non-empty `actionLink` (net-new → `type:'invite'` → `/reset-password`; existing → `type:'magiclink'` → `/auth/callback`).

- [ ] **Step 1: Replace the stale regression test (and keep the net-new one)**

In `supabase/functions/_shared/invitations.test.ts`:
- Keep/confirm the net-new test asserts the recorded `generateLink` call has `type:'invite'` and `redirectTo` containing `/reset-password?redirect=`.
- **Replace** the existing test at ~line 28 (`"existing user → branded email with NO actionLink"`, currently `assertEquals(body.templateData.actionLink, undefined)`) with:

```ts
Deno.test("deliverOrgInvitation: existing user -> magic link actionLink to /auth/callback", async () => {
  const deps = makeFakeDeps({
    usersById: { "uid-1": { id: "uid-1", email: "known@x.com" } }, // makes userExistsByEmail true
    generateLinkResult: { data: { properties: { action_link: "https://link.example/magic" } }, error: null },
  });
  await deliverOrgInvitation(deps, {
    email: "known@x.com", orgName: "Cirque", role: "Artist", token: "tok-1",
    appOrigin: "https://app.showflow.pro", idempotencyKey: "org-invitation-1", orgId: "org-1",
  });

  const send = deps.sentEmails.find((e) => e.template_name === "org-invitation")!;
  assertEquals(send.templateData.actionLink, "https://link.example/magic"); // non-empty now

  const gen = deps.calls.find((c) => c.table === "auth.admin.generateLink")!;
  const params = gen.args[0] as { type: string; options: { redirectTo: string } };
  assertEquals(params.type, "magiclink");
  assertEquals(params.options.redirectTo.includes("/auth/callback?redirect="), true);
  assertEquals(params.options.redirectTo.includes("%2Faccept-invite%3Ftoken%3Dtok-1"), true);
});
```

> Confirm the fake option that makes `userExistsByEmail` return true (the spec references `usersById`); match the harness's actual seeding for `admin.listUsers` and adjust if the name differs.

- [ ] **Step 2: Run to verify the replaced test fails**

Run: `deno test --allow-all supabase/functions/_shared/invitations.test.ts`
Expected: FAIL — the existing-user branch still mints no link (`actionLink` undefined), so the new assertions fail.

- [ ] **Step 3: Implement the existing-user magic-link branch**

In `supabase/functions/_shared/invitations.ts`, replace the `deliverOrgInvitation` body's link-minting with:

```ts
export async function deliverOrgInvitation(deps: Deps, args: DeliverInviteArgs): Promise<void> {
  const acceptPath = `/accept-invite?token=${args.token}`;
  const exists = await userExistsByEmail(deps, args.email);

  let actionLink: string | undefined;
  if (!exists) {
    // NET-NEW: invite link creates the account, lands on set-password, then accept. (unchanged)
    const redirectTo = `${args.appOrigin}/reset-password?redirect=${encodeURIComponent(acceptPath)}`;
    const { data, error } = await deps.admin.auth.admin.generateLink({
      type: "invite", email: args.email, options: { redirectTo },
    });
    if (error) throw error;
    actionLink = (data as { properties?: { action_link?: string } })?.properties?.action_link;
  } else {
    // EXISTING (re-invite / passwordless / expired): magic link logs them in and lands on
    // accept via /auth/callback. They can set a password later in-app on ProfilePage.
    const redirectTo = `${args.appOrigin}/auth/callback?redirect=${encodeURIComponent(acceptPath)}`;
    const { data, error } = await deps.admin.auth.admin.generateLink({
      type: "magiclink", email: args.email, options: { redirectTo },
    });
    if (error) throw error;
    actionLink = (data as { properties?: { action_link?: string } })?.properties?.action_link;
  }

  await deps.sendEmail({
    template_name: "org-invitation",
    recipient_email: args.email,
    org_id: args.orgId,
    templateData: {
      orgName: args.orgName, role: args.role, token: args.token,
      inviterEmail: args.inviterEmail, actionLink,
    },
    idempotency_key: args.idempotencyKey,
  });
}
```

- [ ] **Step 4: Make the invite email paste line honest (token URL, not the single-use link)**

In `supabase/functions/_shared/transactional-email-templates/org-invitation.tsx`, keep the CTA using `acceptUrl` (`actionLink || token-url`) but change the **paste line** (currently `{acceptUrl}`) to always render the token accept URL:

```tsx
// derive a stable, pasteable URL separate from the one-click CTA:
const pasteUrl = token ? `${APP_URL}/accept-invite?token=${token}` : APP_URL;
// ...the CTA stays cta={{ href: acceptUrl, label: ... }}; the paste line renders {pasteUrl}
```

(`acceptUrl` remains `actionLink || (token ? …token-url : APP_URL)` for the CTA. Only the paste `<Text>` at the bottom switches to `pasteUrl`.)

- [ ] **Step 5: Run tests + type-check to verify pass**

Run: `deno test --allow-all supabase/functions/_shared/invitations.test.ts && deno check --node-modules-dir=none supabase/functions/_shared/invitations.ts supabase/functions/_shared/transactional-email-templates/org-invitation.tsx`
Expected: PASS.

- [ ] **Step 6: Run the whole edge suite + commit**

Run: `deno test --allow-all supabase/functions/`
Expected: PASS.

```bash
git add supabase/functions/_shared/invitations.ts supabase/functions/_shared/invitations.test.ts \
  supabase/functions/_shared/transactional-email-templates/org-invitation.tsx
git commit -m "mint a magic link for existing-user invites so they never hit the reset flow"
```

---

## Task 8: `requestLoginLink` data-access

**Files:**
- Create: `src/data/authLinks.ts`
- Test: `src/data/authLinks.test.ts`

**Interfaces:**
- Produces: `requestLoginLink(client, email, appOrigin): Promise<void>` — invokes `send-login-link`, throws on transport error only. Consumed by Task 11 (`LoginPage`).

- [ ] **Step 1: Write the failing test**

Create `src/data/authLinks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { requestLoginLink } from "./authLinks";
import { makeSupabaseFake } from "@/test/supabaseFake";

describe("requestLoginLink", () => {
  it("invokes send-login-link with email + app_origin", async () => {
    const fake = makeSupabaseFake({ functions: { "send-login-link": { data: { ok: true }, error: null } } });
    await requestLoginLink(fake.client, "user@x.com", "https://app.showflow.pro");
    const call = fake.functionInvocations.find((c) => c.name === "send-login-link")!;
    expect(call.body).toEqual({ email: "user@x.com", app_origin: "https://app.showflow.pro" });
  });

  it("throws on a transport error", async () => {
    const fake = makeSupabaseFake({ functions: { "send-login-link": { data: null, error: { message: "network" } } } });
    await expect(requestLoginLink(fake.client, "user@x.com", "https://app.showflow.pro")).rejects.toThrow();
  });
});
```

> Match the exact `src/test/supabaseFake.ts` API for seeding a `functions.invoke` result and reading recorded invocations; adjust the seed/accessor names to the fake's real shape.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/data/authLinks.test.ts`
Expected: FAIL — `./authLinks` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/data/authLinks.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Request a branded, one-time sign-in link. Existence-hiding: resolves for any input;
 *  the edge function no-ops (still 200) when no account matches. Throws only on transport error. */
export async function requestLoginLink(
  client: SupabaseClient<Database>,
  email: string,
  appOrigin: string,
): Promise<void> {
  const { error } = await client.functions.invoke("send-login-link", {
    body: { email, app_origin: appOrigin },
  });
  if (error) throw error;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/data/authLinks.test.ts && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/authLinks.ts src/data/authLinks.test.ts
git commit -m "add requestLoginLink data-access for magic-link login"
```

---

## Task 9: `AuthCallbackPage` + route + redirect-safety tests

**Files:**
- Create: `src/pages/AuthCallbackPage.tsx`
- Test: `src/pages/AuthCallbackPage.test.tsx`
- Modify: `src/config/app.config.ts` (add `AUTH_CALLBACK`)
- Modify: `src/App.tsx` (register the public route)
- Modify: `src/features/auth/resetPassword.test.ts` (extend `safeRelativeRedirect` cases)

**Interfaces:**
- Consumes: `safeRelativeRedirect` from `src/features/auth/resetPassword.ts` (unchanged).
- Produces: `ROUTES.AUTH_CALLBACK = '/auth/callback'`; a public page that resolves the session and forwards to a validated relative redirect. Consumed by Task 6's minted `redirectTo` and Task 7's invite links.

- [ ] **Step 1: Add the route constant**

In `src/config/app.config.ts`, add to `ROUTES`: `AUTH_CALLBACK: '/auth/callback',`.

- [ ] **Step 2: Extend the redirect-safety unit test (failing not required — pure assertions)**

In `src/features/auth/resetPassword.test.ts`, add cases confirming `safeRelativeRedirect` handles the callback's inputs:

```ts
it("safeRelativeRedirect: callback targets", () => {
  expect(safeRelativeRedirect(null, "/dashboard")).toBe("/dashboard");
  expect(safeRelativeRedirect("//evil.com", "/dashboard")).toBe("/dashboard");
  expect(safeRelativeRedirect("http://x", "/dashboard")).toBe("/dashboard");
  expect(safeRelativeRedirect("/accept-invite?token=x", "/dashboard")).toBe("/accept-invite?token=x");
  expect(safeRelativeRedirect("/dashboard", "/dashboard")).toBe("/dashboard");
});
```

- [ ] **Step 3: Write the failing component test**

Create `src/pages/AuthCallbackPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AuthCallbackPage from "./AuthCallbackPage";

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigateSpy,
}));

// Controllable auth mock
let sessionResult: { data: { session: unknown } } = { data: { session: null } };
const authCbs: Array<(e: string, s: unknown) => void> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve(sessionResult),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCbs.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/auth/callback" element={<AuthCallbackPage />} /></Routes>
    </MemoryRouter>,
  );

beforeEach(() => { navigateSpy.mockClear(); authCbs.length = 0; sessionResult = { data: { session: null } }; window.location.hash = ""; });

describe("AuthCallbackPage", () => {
  it("navigates to the validated redirect on SIGNED_IN", async () => {
    renderAt("/auth/callback?redirect=/accept-invite?token=x");
    authCbs.forEach((cb) => cb("SIGNED_IN", { user: { id: "u" } }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/accept-invite?token=x", { replace: true }));
  });

  it("clamps an unsafe redirect to /dashboard", async () => {
    renderAt("/auth/callback?redirect=//evil.com");
    authCbs.forEach((cb) => cb("SIGNED_IN", { user: { id: "u" } }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/dashboard", { replace: true }));
  });

  it("shows the recovery state immediately on an error hash (first commit, no timers, no auth listener)", () => {
    window.location.hash = "#error=access_denied&error_description=expired";
    renderAt("/auth/callback");
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
    expect(authCbs.length).toBe(0); // if (failed) return: no listener wired
  });

  it("falls back to the recovery link after the watchdog when no session and no error hash", () => {
    vi.useFakeTimers();
    renderAt("/auth/callback");
    vi.advanceTimersByTime(8000);
    expect(screen.getByText(/request a new sign-in link/i)).toBeInTheDocument();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run src/pages/AuthCallbackPage.test.tsx`
Expected: FAIL — `AuthCallbackPage` does not exist.

- [ ] **Step 5: Write the page**

Create `src/pages/AuthCallbackPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { safeRelativeRedirect } from "@/features/auth/resetPassword";
import { ROUTES } from "@/config/app.config";
import { StageMark } from "@/components/brand/StageMark";

/** Read at render time, BEFORE supabase-js (detectSessionInUrl) strips the hash. */
function hashHasError(): boolean {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return Boolean(hash.get("error") || hash.get("error_description"));
}

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [failed, setFailed] = useState<boolean>(() => hashHasError());

  useEffect(() => {
    if (failed) return; // error hash already detected at render; no session wiring needed.

    const target = safeRelativeRedirect(searchParams.get("redirect"), ROUTES.DASHBOARD);
    let done = false;
    const go = () => { if (!done) { done = true; navigate(target, { replace: true }); } };

    supabase.auth.getSession().then(({ data }) => { if (data.session) go(); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) go();
    });
    const t = setTimeout(() => { if (!done) setFailed(true); }, 8000);
    return () => { clearTimeout(t); sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md text-center space-y-4">
        <div className="mx-auto"><StageMark variant="tile" size={52} /></div>
        {failed ? (
          <>
            <p className="text-sm text-muted-foreground">That link has expired. Request a new sign-in link.</p>
            <Link to={ROUTES.LOGIN} className="text-sm font-medium underline-offset-2 hover:underline">
              Back to sign in
            </Link>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            <p className="text-sm text-muted-foreground">Signing you in...</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Register the route**

In `src/App.tsx`, add alongside the other public routes (no `ProtectedRoute`):

```tsx
<Route path={ROUTES.AUTH_CALLBACK} element={<AuthCallbackPage />} />
```

Add the import: `import AuthCallbackPage from "@/pages/AuthCallbackPage";` (match the file's existing page-import style — static or lazy).

- [ ] **Step 7: Run tests + type-check to verify pass**

Run: `npx vitest run src/pages/AuthCallbackPage.test.tsx src/features/auth/resetPassword.test.ts && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/pages/AuthCallbackPage.tsx src/pages/AuthCallbackPage.test.tsx src/config/app.config.ts src/App.tsx src/features/auth/resetPassword.test.ts
git commit -m "add /auth/callback landing route for magic and invite links"
```

---

## Task 10: `LoginPage` co-equal "email me a sign-in link" action

**Files:**
- Modify: `src/pages/LoginPage.tsx`
- Test: `src/pages/LoginPage.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `requestLoginLink` (Task 8).

- [ ] **Step 1: Write the failing layout + behavior test**

Create/extend `src/pages/LoginPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import LoginPage from "./LoginPage";

const requestLoginLink = vi.fn();
vi.mock("@/data/authLinks", () => ({ requestLoginLink: (...a: unknown[]) => requestLoginLink(...a) }));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a) } }));

beforeEach(() => { requestLoginLink.mockReset(); toastSuccess.mockReset(); });

describe("LoginPage magic-link action", () => {
  it("renders Sign in then the sign-in-link button (co-equal), an 'or' divider, and Forgot password below both", () => {
    renderWithProviders(<LoginPage />);
    const signIn = screen.getByRole("button", { name: /sign in/i });
    const link = screen.getByRole("button", { name: /email me a sign-in link/i });
    // DOM order: Sign in before the link button
    expect(signIn.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Same visual weight: both carry the default variant's fill class
    expect(signIn.className).toMatch(/bg-primary/);
    expect(link.className).toMatch(/bg-primary/);
    // Divider
    expect(screen.getByText(/^or$/i)).toBeInTheDocument();
    // Forgot password below both buttons
    const forgot = screen.getByRole("link", { name: /forgot password/i });
    expect(link.compareDocumentPosition(forgot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("empty email: focuses the field and does not call the function", async () => {
    renderWithProviders(<LoginPage />);
    await userEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    expect(requestLoginLink).not.toHaveBeenCalled();
  });

  it("with email: calls requestLoginLink and shows the generic toast", async () => {
    requestLoginLink.mockResolvedValueOnce(undefined);
    renderWithProviders(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "user@x.com" } });
    await userEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    await waitFor(() => expect(requestLoginLink).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/if that email exists/i));
  });

  it("rejected request still shows the same success toast (no enumeration)", async () => {
    requestLoginLink.mockRejectedValueOnce(new Error("boom"));
    renderWithProviders(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "user@x.com" } });
    await userEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/if that email exists/i)));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/pages/LoginPage.test.tsx`
Expected: FAIL — the sign-in-link button / divider / relocated link do not exist yet.

- [ ] **Step 3: Implement the LoginPage changes**

In `src/pages/LoginPage.tsx`:
- Add imports:
```ts
import { toast } from "sonner";
import { requestLoginLink } from "@/data/authLinks";
import { supabase } from "@/integrations/supabase/client";
```
- Add state + handler inside the component:
```ts
const [linkSending, setLinkSending] = useState(false);
const onEmailLink = async () => {
  if (!email) { setError("Enter your email first."); emailRef.current?.focus(); return; }
  setLinkSending(true);
  try {
    await requestLoginLink(supabase, email, window.location.origin);
    toast.success("If that email exists, a sign-in link is on its way.");
  } catch {
    toast.success("If that email exists, a sign-in link is on its way.");
  } finally {
    setLinkSending(false);
  }
};
```
- Remove the current "Forgot password?" `<div>` from its spot above the Sign in button (lines ~162-169).
- After the existing Sign in `<Button>`, add the divider + the co-equal button, then the relocated Forgot password link:
```tsx
<div className="relative my-1" aria-hidden="true">
  <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-[var(--auth-hairline)]" /></div>
  <div className="relative flex justify-center text-xs">
    <span className="bg-[var(--auth-card)] px-2 text-muted-foreground">or</span>
  </div>
</div>
<Button type="button" variant="default" className="w-full" disabled={linkSending} onClick={onEmailLink}>
  {linkSending ? "Sending..." : "Email me a sign-in link"}
</Button>
<div className="mt-3 text-center">
  <Link
    to={ROUTES.RESET_PASSWORD}
    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
  >
    Forgot password?
  </Link>
</div>
```

> The Sign in button keeps `type="submit"` and `variant="default"`. Both buttons therefore share the same fill (`bg-primary`), satisfying the co-equal lock. Keep the two buttons as direct siblings inside the form so Enter still submits the password form.

- [ ] **Step 4: Run tests + type-check + lint to verify pass**

Run: `npx vitest run src/pages/LoginPage.test.tsx && npx tsc -p tsconfig.app.json --noEmit && npm run lint`
Expected: PASS (lint zero-warning gate; no `any`).

- [ ] **Step 5: Commit**

```bash
git add src/pages/LoginPage.tsx src/pages/LoginPage.test.tsx
git commit -m "add co-equal email-me-a-sign-in-link action to the login page"
```

---

## Task 11: End-to-end (Playwright) login-page coverage

**Files:**
- Create/modify: an e2e spec under `e2e/` (e.g. `e2e/login-magic-link.spec.ts`)

- [ ] **Step 1: Write the e2e spec**

Create `e2e/login-magic-link.spec.ts` (follow the existing e2e config + patterns in `e2e/`, including how the reset-password e2e intercepts function calls and relies on the `:8080` redirect allowlist):

```ts
import { test, expect } from "@playwright/test";

test("login page shows co-equal password + magic-link actions and posts the request", async ({ page }) => {
  await page.goto("/login");

  const signIn = page.getByRole("button", { name: /sign in/i });
  const link = page.getByRole("button", { name: /email me a sign-in link/i });
  await expect(signIn).toBeVisible();
  await expect(link).toBeVisible();
  await expect(page.getByText(/^or$/)).toBeVisible();
  await expect(page.getByRole("link", { name: /forgot password/i })).toBeVisible();

  // Intercept the function call; the emailed-link follow is out of reach without a mailbox.
  const posted = page.waitForRequest((r) => r.url().includes("/send-login-link") && r.method() === "POST");
  await page.getByLabel(/email/i).fill("e2e-user@example.com");
  await link.click();
  await posted;
  await expect(page.getByText(/if that email exists/i)).toBeVisible();
});
```

- [ ] **Step 2: Run the e2e spec (local stack up)**

Run: `npx playwright test --config=e2e/playwright.config.ts e2e/login-magic-link.spec.ts`
Expected: PASS. (Requires the local stack + dev server per the e2e config; `npm run local:up` first if needed.)

- [ ] **Step 3: Commit**

```bash
git add e2e/login-magic-link.spec.ts
git commit -m "add e2e coverage for the login magic-link action"
```

---

## Task 12: Rollout config, changelog, and full verification

**Files:**
- Modify: `public/changelog.md`
- Regenerated: `public/changelog.json` (via the deno script)

**External (manual, cannot be tested locally):**
- Supabase production Auth redirect allowlist.

- [ ] **Step 1: Add the changelog entry**

In `public/changelog.md`, add a newest-first block (bump `APP_META.VERSION` in `src/config/app.config.ts` and `version` in `package.json` to a new MINOR, e.g. `1.9.0` -> next minor; confirm the current version first). Use the `- **Title** — description` form, no em/en dashes in the bullet text; user-facing only, no super-admin mentions:

```markdown
## X.Y.Z — Aug 9, 2026

*Faster, friendlier sign-in*

### Improved
- **Sign in with a link** — On the login screen you can now get a one-time sign-in link by email, alongside password sign-in.

### Fixed
- **Invites always let you set a password** — Invited people now get a working one-click link in the invitation email in every case, so they are never sent a separate password-reset email to get started.
```

- [ ] **Step 2: Regenerate the changelog JSON**

Run: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`
Expected: `public/changelog.json` rewritten from the markdown (never hand-edited).

- [ ] **Step 3: Run the full fast verification**

Run: `npm run verify:fast`
Expected: PASS — lint, typecheck (all three tsconfig projects), build, unit + coverage, Deno. Also run `deno check --node-modules-dir=none supabase/functions/send-login-link/index.ts` if not already covered.

- [ ] **Step 4: Run the full verification (local stack)**

Run: `npm run verify:full`
Expected: PASS — adds pgTAP (`auth_link_throttle`) + Playwright e2e against the local stack.

- [ ] **Step 5: Commit**

```bash
git add public/changelog.md public/changelog.json src/config/app.config.ts package.json
git commit -m "changelog + version bump for magic-link login and invite fix"
```

- [ ] **Step 6: Production Auth redirect allowlist (manual, post-merge or via dashboard)**

In the Supabase production dashboard (Authentication → URL Configuration → Redirect URLs), add `https://app.showflow.pro/auth/callback` and confirm `https://app.showflow.pro/reset-password` is present. GoTrue silently falls back to `site_url` for any `redirectTo` not on the allowlist, which would break the minted links. `config.toml`'s `additional_redirect_urls` already covers the `:8080` dev/e2e origins, and `/auth/callback` is path-matched under those, so no local config change is needed. **This step cannot be done from code — flag it to the repo owner as a required manual step before the feature works in production.** The edge functions deploy automatically on merge to `main` (`deploy-functions.yml`); the migration applies on merge via the Supabase GitHub integration.

---

## Self-Review Notes (author checklist — for reference during execution)

- **Spec coverage:** §A send-login-link → Task 6; §A safeAppOrigin → Task 2; §B invite hardening + org-invitation paste line → Task 7; §C magic-link template/registry/copy → Task 4; §C4 coverage → Task 5; §D requestLoginLink → Task 8; §E LoginPage → Task 10; §F AuthCallbackPage + route → Task 9; throttle table + RPC + migration/type-regen → Task 1; harness prerequisite (§Testing 0) → Task 3; pgTAP → Task 1; edge tests → Tasks 6/7; unit tests → Tasks 8/9/10; e2e → Task 11; rollout/config/changelog/allowlist → Task 12.
- **`get_user_id_by_email`** already exists in the repo and is not created here; only `auth_link_throttle` + `claim_login_link_slot` are new (Task 1).
- **Ordering:** Task 1 (types) precedes Task 6 (typed `.rpc`); Task 2/3/4 precede Task 6; Task 3 precedes Task 7; Task 8 precedes Task 10; Task 9 provides the route both Task 6 and Task 7 links target.
- **Fake seeding names** (`authUsersByEmail`, `usersById`, `rpcs.*`, `generateLinkResult`, `sentEmails`, `calls`, `functionInvocations`) are taken from the spec's references; verify each against `supabase/functions/_shared/testing.ts` and `src/test/supabaseFake.ts` when writing tests and use the harness's actual accessor names.
