# Stable Invitation and Sign-In Methods Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the database invitation authoritative for 30 days, exchange its stable token for a fresh Supabase Auth link only when the invitee continues, and give passwordless users an excellent optional password-setup experience after acceptance and from Profile.

**Architecture:** Invitation email links point only to `/accept-invite?token=...`; the browser stores and immediately scrubs the token, and a public Edge Function atomically validates/cooldowns the database invitation before minting a short-lived Auth link. Membership acceptance remains independent of sign-in-method choice, while a self-only password-status RPC and focused auth data helpers power the post-acceptance handoff and Profile security UI.

**Tech Stack:** React 18, TypeScript, TanStack Query, React Router, Zod, Supabase Auth/Postgres/Edge Functions, Deno tests, pgTAP, Vitest/Testing Library, Playwright.

## Global Constraints

- `public.org_invitations` remains authoritative for exactly 30 days; Supabase Auth action-link TTL must never determine invitation validity.
- A resend restarts the full 30-day invitation window from resend time, including an explicitly resent expired pending invitation.
- Migration extends only pending invitations that are unexpired at migration time to `created_at + interval '30 days'`; it must not revive already expired rows.
- Opening an invitation performs no Auth work. Only an explicit Continue action may mint an Auth action link.
- Capture the stable invitation token in `sessionStorage` and remove it from the visible URL synchronously before analytics effects can observe the query string.
- Accept organization membership before offering password setup. Password setup is optional and magic links remain available after a password is created.
- Passwordless users see two equal, initially unselected choices: `Create a password` and `Continue with magic links`.
- Profile labels the section `Sign-in & security`, shows magic links as active, and offers `Add password` or `Change password` according to server-authoritative password status.
- Password status exposes only a boolean for `auth.uid()`; it must not expose `auth.users` rows or password hashes.
- Use Supabase JS v2's `current_password` (v2.102.0+) and `nonce` properties for password changes.
- Invitation-exchange cooldown state is separate from login magic-link throttle state.
- Edge Functions and logs must not print or return stable invitation tokens.
- Follow `CLAUDE.md`: no `any`, use semantic design tokens, no em/en dashes in user-facing copy, data functions accept a Supabase client, and tests use `supabaseFake` or dependency injection.
- Create migrations with `supabase migration new`; regenerate Supabase types and mirror files instead of editing generated targets by hand.
- Each numbered task is implemented by one fresh `gpt-5.6-sol` subagent at `low`; parallel execution is allowed only for dependency-safe tasks with disjoint file ownership.
- After all numbered tasks pass, one fresh `gpt-5.6-sol` subagent at `medium` performs one holistic review; the root agent applies review fixes and runs final verification.

---

## File Map

### Database and generated contracts

- Create: `supabase/migrations/<generated_timestamp>_stable_invitation_auth.sql` - 30-day lifetime, safe backfill, resend renewal, exchange claim/cooldown, and self-only password-status RPC.
- Create: `supabase/tests/rpc/invitation_auth_lifecycle.sql` - pgTAP coverage for lifetime, renewal, exchange states/concurrency permissions, and password-status privacy.
- Modify (generated): `src/integrations/supabase/types.ts` - browser RPC/table contracts.
- Modify (generated): `supabase/functions/_shared/database.types.ts` - Edge Function RPC/table contracts.

### Invitation delivery and exchange

- Modify: `supabase/functions/_shared/invitations.ts` - separate account provisioning from action-link minting and ensure emails receive only stable tokens.
- Modify: `supabase/functions/_shared/invitations.test.ts` - helper behavior and redirect safety.
- Modify: `supabase/functions/create-invitation/index.ts` and `.di.test.ts` - provision accounts without emailing Auth links.
- Modify: `supabase/functions/resend-invitation/index.ts` and `.di.test.ts` - renew 30-day authority and resend stable links, including expired pending rows.
- Modify: `supabase/functions/provision-org/index.ts` and `.di.test.ts` - stable first-admin invitation delivery.
- Modify: `supabase/functions/_shared/transactional-email-templates/org-invitation.tsx` and `.test.ts` - one durable CTA and unified copy.
- Modify source: `src/lib/emailTemplates/emailCopy.ts` and `.test.ts`; regenerate `supabase/functions/_shared/transactional-email-templates/_shell/emailCopy.ts`.
- Create: `supabase/functions/exchange-invitation/index.ts` and `index.test.ts` - public token exchange endpoint.
- Modify: `supabase/config.toml` - set `verify_jwt = false` only for `exchange-invitation`.
- Modify: `src/data/invitations.ts` and `.test.ts` - typed browser invocation wrapper.

### Browser token lifecycle and acceptance UI

- Create: `src/features/auth/invitationToken.ts` and `.test.ts` - session-scoped capture, read, and clear helpers.
- Create: `src/features/analytics/AnalyticsBridge.invitation.test.tsx` - regression proof that token scrubbing precedes analytics page observation.
- Modify: `src/pages/AcceptInvitePage.tsx` and `.test.tsx` - safe landing, explicit exchange, acceptance, and Calm handoff.
- Modify: `src/pages/AuthCallbackPage.tsx` and `.test.tsx` - recover back to a pending invitation.

### Password methods and Profile

- Modify: `src/data/profiles.ts` and `.test.ts` - password status, setup, reauthentication, and change primitives.
- Create: `src/hooks/usePasswordStatus.ts` and `.test.tsx` - server-authoritative query and invalidation boundary.
- Modify: `src/test/supabaseFake.ts` and `src/test/supabaseFake.auth.test.ts` - `reauthenticate()` support.
- Create: `src/components/auth/PasswordSetupForm.tsx` and `.test.tsx` - reusable inline setup/change form.
- Modify: `src/pages/ProfilePage.tsx`; create `src/pages/ProfilePage.security.test.tsx` - Sign-in & security method rows.
- Modify: `docs/superpowers/specs/2026-08-12-stable-invitation-and-sign-in-methods-design.md` - document the supported `current_password` spelling.

### Full-story verification and release notes

- Modify: `e2e/invite-unified.spec.ts` - durable invite landing/exchange/acceptance/handoff.
- Modify: `e2e/profile.spec.ts` - add/change-password method states.
- Modify: `public/changelog.md`; regenerate the repository's changelog JSON through the existing build script.

---

### Task 1: Database Invitation Authority and Password Status

**Files:**
- Create: `supabase/migrations/<generated_timestamp>_stable_invitation_auth.sql`
- Create: `supabase/tests/rpc/invitation_auth_lifecycle.sql`
- Modify (generated): `src/integrations/supabase/types.ts`
- Modify (generated): `supabase/functions/_shared/database.types.ts`

**Interfaces:**
- Produces: `public.renew_invitation_for_resend(p_id uuid) returns timestamptz` for service-role callers.
- Produces: `public.claim_invitation_auth_exchange(p_token text, p_cooldown_seconds integer default 60) returns jsonb` with exactly `{"status":"ok","email":"..."}`, `{"status":"throttled","retry_after_seconds":N}`, or `{"status":"unavailable"}`.
- Produces: `public.my_has_password() returns boolean` for authenticated self-access.
- Produces: nullable `org_invitations.last_auth_exchange_at timestamptz`.

- [ ] **Step 1: Create the migration with the required repository command**

Run: `supabase migration new stable_invitation_auth`

Expected: one new `supabase/migrations/<generated_timestamp>_stable_invitation_auth.sql` file; use that generated path in every later command and commit.

- [ ] **Step 2: Write failing pgTAP lifecycle tests**

Create assertions that prove these exact cases:

```sql
SELECT is(
  (SELECT column_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'org_invitations' AND column_name = 'expires_at'),
  '(now() + ''30 days''::interval)',
  'new invitations default to 30 days'
);

SELECT is(
  public.renew_invitation_for_resend('00000000-0000-0000-0000-00000000f101'),
  now() + interval '30 days',
  'resend restarts the full lifetime'
);

SELECT is(
  public.claim_invitation_auth_exchange('valid-token', 60)->>'status',
  'ok',
  'a pending unexpired token is claimable'
);

SELECT is(
  public.claim_invitation_auth_exchange('valid-token', 60)->>'status',
  'throttled',
  'the atomic second claim is throttled'
);
```

Also use pgTAP `throws_ok`/`lives_ok` after `SET LOCAL ROLE` to prove service-role-only execution for renewal/claim, authenticated-only execution for `my_has_password`, unavailable results for missing/accepted/revoked/expired tokens, rounded-up positive retry seconds, a passwordless self result of false, a password self result of true, and no cross-user input surface.

- [ ] **Step 3: Run the database test and confirm RED**

Run: `supabase test db supabase/tests/rpc/invitation_auth_lifecycle.sql`

Expected: FAIL because the three RPCs, 30-day default, and exchange timestamp do not exist.

- [ ] **Step 4: Implement the migration**

Use this contract and security shape:

```sql
ALTER TABLE public.org_invitations
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 days'),
  ADD COLUMN last_auth_exchange_at timestamptz;

UPDATE public.org_invitations
SET expires_at = created_at + interval '30 days'
WHERE status = 'pending'
  AND expires_at > now()
  AND expires_at < created_at + interval '30 days';

CREATE OR REPLACE FUNCTION public.renew_invitation_for_resend(p_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_expires_at timestamptz := now() + interval '30 days';
BEGIN
  UPDATE public.org_invitations
  SET expires_at = v_expires_at, last_auth_exchange_at = NULL
  WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation is not pending'; END IF;
  RETURN v_expires_at;
END;
$$;
```

Implement `claim_invitation_auth_exchange` as a `SECURITY DEFINER SET search_path = ''` PL/pgSQL function that selects the matching row `FOR UPDATE`, returns generic unavailable unless it is pending and `expires_at > now()`, computes `ceil(extract(epoch from cooldown_remaining))`, and atomically writes `last_auth_exchange_at = now()` only for an `ok` result. Implement `my_has_password` as SQL or PL/pgSQL returning only `coalesce(length(encrypted_password) > 0, false)` for `auth.uid()`. Revoke execute from `public`, `anon`, and `authenticated` on the service-only functions; grant them to `service_role`; grant only `my_has_password` to `authenticated`.

- [ ] **Step 5: Run pgTAP and confirm GREEN**

Run: `supabase test db supabase/tests/rpc/invitation_auth_lifecycle.sql`

Expected: PASS with every planned assertion and no plan mismatch.

- [ ] **Step 6: Regenerate database types and mirrors**

Run: `supabase gen types typescript --local > src/integrations/supabase/types.ts`

Run: `npm run sync:mirrors`

Expected: browser and Edge Function generated types both expose the new column and RPCs; mirror check is clean.

- [ ] **Step 7: Verify generated contracts and commit**

Run: `rg -n "renew_invitation_for_resend|claim_invitation_auth_exchange|my_has_password|last_auth_exchange_at" src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts`

Expected: all four contracts appear in both generated type files.

Run: `git add supabase/migrations supabase/tests/rpc/invitation_auth_lifecycle.sql src/integrations/supabase/types.ts supabase/functions/_shared/database.types.ts && git commit -m "feat: make invitations authoritative for 30 days"`

---

### Task 2: Stable Invitation Email and Resend Renewal

**Files:**
- Modify: `supabase/functions/_shared/invitations.ts`
- Modify: `supabase/functions/_shared/invitations.test.ts`
- Modify: `supabase/functions/create-invitation/index.ts`
- Modify: `supabase/functions/create-invitation/index.di.test.ts`
- Modify: `supabase/functions/resend-invitation/index.ts`
- Modify: `supabase/functions/resend-invitation/index.di.test.ts`
- Modify: `supabase/functions/provision-org/index.ts`
- Modify: `supabase/functions/provision-org/index.di.test.ts`
- Modify: `supabase/functions/_shared/transactional-email-templates/org-invitation.tsx`
- Modify: `supabase/functions/_shared/transactional-email-templates/org-invitation.test.ts`
- Modify source: `src/lib/emailTemplates/emailCopy.ts`
- Modify: `src/lib/emailTemplates/emailCopy.test.ts`
- Modify (generated): `supabase/functions/_shared/transactional-email-templates/_shell/emailCopy.ts`

**Interfaces:**
- Consumes: `renew_invitation_for_resend(p_id uuid) returns timestamptz` from Task 1.
- Produces: `ensureInvitedAccount(deps, { email, appOrigin }): Promise<{ userId: string | null; isNewUser: boolean }>`.
- Produces: `mintInvitationActionLink(deps, { email, appOrigin }): Promise<string>` for Task 3; redirect target is `/auth/callback?redirect=%2Faccept-invite` and contains no stable token.
- Produces: `sendOrgInvitationEmail(deps, DeliverInviteArgs)` whose template data contains a stable token but no `actionLink` or `isNewUser`.

- [ ] **Step 1: Rewrite helper tests to express stable-link behavior**

Replace action-link delivery assertions with these behavioral checks:

```ts
const ensured = await ensureInvitedAccount(deps, {
  email: "new@acme.com",
  appOrigin: "https://app.showflow.pro",
});
assertEquals(ensured, { userId: "new-user-id", isNewUser: true });
assertEquals(sentTemplateData.token, "stable-token");
assertEquals("actionLink" in sentTemplateData, false);
assertEquals("isNewUser" in sentTemplateData, false);
```

Add `mintInvitationActionLink` cases for an existing user (`magiclink`), a missing user (`invite`), an allowlisted origin fallback, a missing `action_link` error, and a redirect that contains `/accept-invite` but never `token=`.

- [ ] **Step 2: Rewrite create/resend/provision and template tests**

Assert create/provision send only the durable URL `https://app.showflow.pro/accept-invite?token=stable-token`. For resend, assert an expired pending invite is no longer rejected, `renew_invitation_for_resend` is called before email delivery, the returned expiry drives `expiresOn`, email failure does not stamp `mark_invitation_resent`, and renewal itself remains committed. Assert the template always renders one unified hint such as `Continue securely to sign in or create your account.` without promising that the emailed link sets a password.

- [ ] **Step 3: Run focused Deno/Vitest tests and confirm RED**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/invitations.test.ts supabase/functions/create-invitation/index.di.test.ts supabase/functions/resend-invitation/index.di.test.ts supabase/functions/provision-org/index.di.test.ts supabase/functions/_shared/transactional-email-templates/org-invitation.test.ts`

Run: `npx vitest run src/lib/emailTemplates/emailCopy.test.ts`

Expected: FAIL on obsolete helper names/action-link template fields and the current expired-resend rejection.

- [ ] **Step 4: Split account provisioning from action minting**

Refactor `_shared/invitations.ts` so `ensureInvitedAccount` looks up the user and returns existing users without generating a link. For a missing user, call `auth.admin.generateLink({ type: "invite", email, options: { redirectTo } })` only to create the Auth user and discard its `action_link`. Implement `mintInvitationActionLink` separately: existing user uses `magiclink`, missing user uses `invite`, both validate `action_link`, and neither receives nor embeds the stable token.

- [ ] **Step 5: Make all invitation emails stable-only**

Remove `actionLink` and `isNewUser` from `DeliverInviteArgs`, `sendOrgInvitationEmail`, all three callers, and the React email template. Build the CTA only from the allowlisted app URL plus `/accept-invite?token=${encodeURIComponent(token)}`. Update the source email copy and run `npm run sync:mirrors`; never hand-edit the mirrored shell file.

Set `ORG_INVITATION_EXPIRY_DAYS = 30` and update its nearby comments and preview assertions so sample/template dates match the live database default.

- [ ] **Step 6: Renew first, then resend**

In `resend-invitation/index.ts`, keep authorization and pending-status validation, remove the `expires_at <= now()` rejection, call:

```ts
const { data: renewedExpiry, error: renewError } = await deps.admin.rpc(
  "renew_invitation_for_resend",
  { p_id: invite.id },
);
if (renewError || !renewedExpiry) throw renewError ?? new Error("Invitation renewal failed");
```

Use `renewedExpiry` for rendered expiry copy. Send the stable-token email, then call `mark_invitation_resent` only when `emailWasSent(result)` is true.

- [ ] **Step 7: Run focused tests and type-check Edge Functions**

Run the two commands from Step 3 again.

Expected: PASS.

Run: `deno check --node-modules-dir=none supabase/functions/create-invitation/index.ts supabase/functions/resend-invitation/index.ts supabase/functions/provision-org/index.ts`

Expected: no diagnostics.

- [ ] **Step 8: Commit the stable-delivery slice**

Run: `git add supabase/functions src/lib/emailTemplates/emailCopy.ts src/lib/emailTemplates/emailCopy.test.ts && git commit -m "fix: deliver durable invitation links"`

---

### Task 3: Public Invitation Exchange Endpoint

**Files:**
- Create: `supabase/functions/exchange-invitation/index.ts`
- Create: `supabase/functions/exchange-invitation/index.test.ts`
- Modify: `supabase/config.toml`
- Modify: `src/data/invitations.ts`
- Modify: `src/data/invitations.test.ts`

**Interfaces:**
- Consumes: `claim_invitation_auth_exchange(p_token, p_cooldown_seconds)` from Task 1.
- Consumes: `mintInvitationActionLink(deps, { email, appOrigin })` from Task 2.
- Produces: `POST /functions/v1/exchange-invitation` body `{ token: string; app_origin: string }`.
- Produces: success `{ action_url: string }`; unavailable HTTP 410 `{ error: "Invitation unavailable" }`; throttle HTTP 429 `{ error: "Please wait before trying again", retry_after_seconds: number }` plus `Retry-After`; generic HTTP 500.
- Produces: `exchangeInvitation(client, { token, appOrigin }): Promise<{ actionUrl: string }>`.

- [ ] **Step 1: Write failing Edge Function tests**

Use exported dependency-injected `handler(req, deps)` tests for OPTIONS/CORS, invalid JSON or empty token (400), claim `unavailable` (410), claim `throttled` (429 and rounded Retry-After), claim error (500), missing action link (500), and success (200). The success test must prove the minted URL comes from the claimed email and that no response or captured log contains the stable token.

- [ ] **Step 2: Write failing browser data tests**

Add fake function-invocation assertions:

```ts
const result = await exchangeInvitation(fake as never, {
  token: "stable-token",
  appOrigin: "https://app.showflow.pro",
});
expect(result).toEqual({ actionUrl: "https://auth.example/action" });
expect(fake.calls).toContainEqual({
  table: "functions",
  method: "invoke",
  args: ["exchange-invitation", { body: { token: "stable-token", app_origin: "https://app.showflow.pro" } }],
});
```

Add explicit error mapping for 410, 429 with retry seconds, malformed success, and generic failures.

- [ ] **Step 3: Run tests and confirm RED**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/exchange-invitation/index.test.ts`

Run: `npx vitest run src/data/invitations.test.ts`

Expected: FAIL because the endpoint and data function do not exist.

- [ ] **Step 4: Implement the Edge Function**

Validate the body without reflecting the token. Call the claim RPC before minting. Return status-specific JSON with existing shared CORS/security headers. On `ok`, call `mintInvitationActionLink` with the claimed email, convert it to `{ action_url }`, and never log request bodies, token values, or action URLs. Export the injected handler and guard `Deno.serve` with the repository's established `import.meta.main` pattern.

- [ ] **Step 5: Configure only this endpoint as public**

Append:

```toml
[functions.exchange-invitation]
verify_jwt = false
```

Do not alter `verify_jwt` for any other function.

- [ ] **Step 6: Implement the typed browser wrapper**

Invoke the function with `{ token, app_origin: appOrigin }`, validate `data.action_url` as a non-empty string, and throw a typed `InvitationExchangeError` carrying `kind: "unavailable" | "throttled" | "unknown"` and optional `retryAfterSeconds` so UI code never parses human copy.

- [ ] **Step 7: Run tests, checks, and commit**

Run: `deno test --allow-all --node-modules-dir=none supabase/functions/exchange-invitation/index.test.ts && deno check --node-modules-dir=none supabase/functions/exchange-invitation/index.ts`

Run: `npx vitest run src/data/invitations.test.ts && npx tsc -p tsconfig.app.json --noEmit`

Expected: PASS with no diagnostics.

Run: `git add supabase/functions/exchange-invitation supabase/config.toml src/data/invitations.ts src/data/invitations.test.ts && git commit -m "feat: exchange stable invitations for fresh auth links"`

---

### Task 4: Safe Token Capture, Landing, and Callback Recovery

**Files:**
- Create: `src/features/auth/invitationToken.ts`
- Create: `src/features/auth/invitationToken.test.ts`
- Create: `src/features/analytics/AnalyticsBridge.invitation.test.tsx`
- Modify: `src/pages/AcceptInvitePage.tsx`
- Modify: `src/pages/AcceptInvitePage.test.tsx`
- Modify: `src/pages/AuthCallbackPage.tsx`
- Modify: `src/pages/AuthCallbackPage.test.tsx`

**Interfaces:**
- Consumes: `exchangeInvitation(client, { token, appOrigin })` and `InvitationExchangeError` from Task 3.
- Produces: `captureInvitationToken(location, history, storage): string | null`, `readInvitationToken(storage): string | null`, and `clearInvitationToken(storage): void` using constant key `showflow.pendingInvitationToken`.
- Produces: unauthenticated invitation landing whose Continue click performs the exchange and navigates to the returned Auth URL.

- [ ] **Step 1: Write token-helper tests**

Cover a query token being stored, `history.replaceState` receiving `/accept-invite` with unrelated query/hash preserved, an existing stored token being returned when the URL has none, whitespace/empty tokens being rejected, storage exceptions degrading safely, and `clearInvitationToken` removing only the named key.

- [ ] **Step 2: Write landing and callback recovery tests**

In `AcceptInvitePage.test.tsx`, replace the unauthenticated auto-redirect expectation with: visible invitation-context landing, no exchange on render, exactly one exchange after Continue, disabled/loading Continue while pending, `window.location.assign(actionUrl)` on success, retry UI for throttling, permanent unavailable state for 410, and generic retry for unknown failure. Assert the raw token is absent from `window.location.search` before a child `useEffect` observer runs. In callback tests, assert failed Auth callbacks show `Return to invitation` only when session storage contains a pending token.

In `AnalyticsBridge.invitation.test.tsx`, mount the real route shell with a consented analytics spy and an initial `/accept-invite?token=stable-token` URL. Assert the first location observed when analytics initializes is `/accept-invite` and that neither the spy payload nor the current URL contains `stable-token`.

- [ ] **Step 3: Run focused Vitest and confirm RED**

Run: `npx vitest run src/features/auth/invitationToken.test.ts src/features/analytics/AnalyticsBridge.invitation.test.tsx src/pages/AcceptInvitePage.test.tsx src/pages/AuthCallbackPage.test.tsx`

Expected: FAIL because token storage and explicit exchange behavior do not exist.

- [ ] **Step 4: Implement synchronous capture and URL scrubbing**

Implement the helper without React effects:

```ts
export const PENDING_INVITATION_TOKEN_KEY = "showflow.pendingInvitationToken";

export function captureInvitationToken(
  location: Pick<Location, "href" | "pathname" | "search" | "hash">,
  history: Pick<History, "replaceState">,
  storage: Pick<Storage, "getItem" | "setItem">,
): string | null {
  const url = new URL(location.href);
  const queryToken = url.searchParams.get("token")?.trim();
  if (queryToken) storage.setItem(PENDING_INVITATION_TOKEN_KEY, queryToken);
  url.searchParams.delete("token");
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return queryToken || storage.getItem(PENDING_INVITATION_TOKEN_KEY);
}
```

Wrap storage/history access in narrow `try/catch` blocks so privacy scrubbing still occurs if storage is unavailable. Call capture during `AcceptInvitePage` render initialization, before effects, and retain the token in a ref/state value without putting it back into navigation state or query parameters.

- [ ] **Step 5: Implement the explicit landing exchange**

For unauthenticated users, render invitation context and a primary Continue button. On click, call the exchange wrapper with `window.location.origin` and then `window.location.assign(actionUrl)`. Keep the stored token on throttle/unknown failures; clear it on a permanent unavailable response. Do not call Supabase Auth on mount.

- [ ] **Step 6: Add callback recovery**

On failed callback, read the session token. If present, render `Return to invitation` linking to `/accept-invite`; otherwise preserve `Back to sign in`. Never append the token to that link.

- [ ] **Step 7: Run focused tests, type-check, and commit**

Run the Step 3 command and `npx tsc -p tsconfig.app.json --noEmit`.

Expected: PASS with no diagnostics.

Run: `git add src/features/auth/invitationToken.ts src/features/auth/invitationToken.test.ts src/features/analytics/AnalyticsBridge.invitation.test.tsx src/pages/AcceptInvitePage.tsx src/pages/AcceptInvitePage.test.tsx src/pages/AuthCallbackPage.tsx src/pages/AuthCallbackPage.test.tsx && git commit -m "feat: add safe invitation handoff"`

---

### Task 5: Password Method Data and Reusable Form

**Files:**
- Modify: `src/data/profiles.ts`
- Modify: `src/data/profiles.test.ts`
- Create: `src/hooks/usePasswordStatus.ts`
- Create: `src/hooks/usePasswordStatus.test.tsx`
- Modify: `src/test/supabaseFake.ts`
- Modify: `src/test/supabaseFake.auth.test.ts`
- Create: `src/components/auth/PasswordSetupForm.tsx`
- Create: `src/components/auth/PasswordSetupForm.test.tsx`
- Modify: `docs/superpowers/specs/2026-08-12-stable-invitation-and-sign-in-methods-design.md`

**Interfaces:**
- Consumes: authenticated RPC `my_has_password()` from Task 1.
- Produces: `fetchMyHasPassword(client): Promise<boolean>`.
- Produces: `setMyPassword(client, password): Promise<void>` using `auth.updateUser({ password })`.
- Produces: `requestPasswordReauthentication(client): Promise<void>` using `auth.reauthenticate()`.
- Produces: `changeMyPassword(client, { password, currentPassword?, nonce? }): Promise<void>` using `auth.updateUser({ password, current_password, nonce })` with undefined keys omitted.
- Produces: `usePasswordStatus()` with query key `['auth', 'has-password']` and an exported invalidation helper/hook mutation path.
- Produces: `<PasswordSetupForm mode="setup" | "change" onSuccess onCancel?>`.

- [ ] **Step 1: Extend the fake with a failing contract test**

Assert `fake.auth.reauthenticate()` records `{ table: "auth", method: "reauthenticate", args: [] }` and returns seed key `auth:reauthenticate`.

- [ ] **Step 2: Rewrite profile data tests**

Test false/true RPC results, RPC errors, setup `updateUser({ password })`, change `updateUser({ password, current_password: "old-secret" })`, nonce change `updateUser({ password, nonce: "123456" })`, reauthentication, and propagation of Auth errors. Assert no data helper calls `signInWithPassword`.

- [ ] **Step 3: Write hook and form tests**

Hook tests assert the exact query key, boolean result, error state, and invalidation after a successful setup/change. Form tests cover setup/change headings, `newPasswordSchema` requirements, confirmation mismatch, show/hide controls with accessible labels, disabled submit while pending, current-password submission, a reauthentication-required transition to a six-digit nonce field without clearing the new password, success callback, cancel, and inline error copy.

- [ ] **Step 4: Run focused tests and confirm RED**

Run: `npx vitest run src/test/supabaseFake.auth.test.ts src/data/profiles.test.ts src/hooks/usePasswordStatus.test.tsx src/components/auth/PasswordSetupForm.test.tsx`

Expected: FAIL on absent RPC/auth methods, hook, and form.

- [ ] **Step 5: Implement fake and data primitives**

Add `reauthenticate()` beside existing Auth fake methods. Replace the manual password verification flow in `profiles.ts` with the four interfaces above. For `changeMyPassword`, construct the update payload conditionally and use the installed Supabase JS v2 property names `current_password` and `nonce` exactly.

- [ ] **Step 6: Implement the password-status hook**

Follow existing TanStack Query hook patterns, enable only for an authenticated user, and export a small invalidation function that invalidates `['auth', 'has-password']` after password writes.

- [ ] **Step 7: Implement the reusable form**

Reuse `newPasswordSchema` from `src/features/auth/resetPassword.ts`. Keep local fields for new password, confirmation, and either current password or nonce. Treat the specific Supabase reauthentication-required error as a prompt to call `requestPasswordReauthentication`, show clear `Check your email for the 6-digit code` copy, preserve new-password fields, then retry with `nonce`. Use existing form/button/input/card primitives and semantic tokens; do not duplicate a second password-strength policy.

- [ ] **Step 8: Correct the approved design document**

Document `current_password` as the supported Supabase JS v2.102.0+ property; do not change the approved behavior.

- [ ] **Step 9: Run focused tests, type-check, and commit**

Run the Step 4 command and `npx tsc -p tsconfig.app.json --noEmit`.

Expected: PASS with no diagnostics.

Run: `git add src/data/profiles.ts src/data/profiles.test.ts src/hooks/usePasswordStatus.ts src/hooks/usePasswordStatus.test.tsx src/test/supabaseFake.ts src/test/supabaseFake.auth.test.ts src/components/auth/PasswordSetupForm.tsx src/components/auth/PasswordSetupForm.test.tsx docs/superpowers/specs/2026-08-12-stable-invitation-and-sign-in-methods-design.md && git commit -m "feat: add password method controls"`

---

### Task 6: Calm Post-Acceptance Handoff

**Files:**
- Modify: `src/pages/AcceptInvitePage.tsx`
- Modify: `src/pages/AcceptInvitePage.test.tsx`

**Interfaces:**
- Consumes: `usePasswordStatus()` and `PasswordSetupForm` from Task 5.
- Consumes: stored-token clear helper from Task 4.
- Produces: accepted-invitation success card with conditional, optional password choice.

- [ ] **Step 1: Add failing acceptance-state tests**

Add cases for: password status queried only after `acceptInvitation` succeeds; stored token cleared only after acceptance; existing-password user sees the current success action without setup choices; passwordless user sees equal `Create a password` and `Continue with magic links` choices with neither selected; Create opens the form inline without losing organization/role context; magic links navigate to the dashboard; successful setup shows confirmation then dashboard; status RPC failure shows a non-blocking note and dashboard action without guessing password state.

- [ ] **Step 2: Add interaction-quality tests**

Assert both choices are keyboard reachable, selection focus moves to the inline form heading, validation/error messages use live regions, mobile DOM order is context then choices then action, animation classes are guarded by reduced-motion utilities, and there is no password-method wording before membership acceptance.

- [ ] **Step 3: Run the page tests and confirm RED**

Run: `npx vitest run src/pages/AcceptInvitePage.test.tsx`

Expected: FAIL because the post-acceptance choice does not exist.

- [ ] **Step 4: Implement the Calm handoff**

Preserve the existing accepted invitation card's organization, role, and booking details. Add two visually equal semantic buttons/cards below a short `How would you like to sign in next time?` prompt, with concise descriptions and no preselection. `Create a password` expands `PasswordSetupForm mode="setup"` inline; `Continue with magic links` proceeds immediately to the existing destination. Keep a persistent accepted checkmark/context while the form is open and use restrained semantic-token borders/backgrounds, visible focus rings, 44px minimum touch targets, and `motion-reduce:*` variants.

- [ ] **Step 5: Wire status and failure behavior**

Enable `usePasswordStatus` only after acceptance. Render the choice only for `false`; retain the existing success action for `true`; for query failure show `Your invitation was accepted. You can manage sign-in methods from your profile.` and a dashboard action. Clear the stored invitation token after acceptance succeeds, not after merely exchanging the link.

- [ ] **Step 6: Run tests, type-check, and commit**

Run: `npx vitest run src/pages/AcceptInvitePage.test.tsx src/components/auth/PasswordSetupForm.test.tsx && npx tsc -p tsconfig.app.json --noEmit`

Expected: PASS with no diagnostics.

Run: `git add src/pages/AcceptInvitePage.tsx src/pages/AcceptInvitePage.test.tsx && git commit -m "feat: add calm post-invite sign-in choice"`

---

### Task 7: Profile Sign-In and Security

**Files:**
- Modify: `src/pages/ProfilePage.tsx`
- Create: `src/pages/ProfilePage.security.test.tsx`

**Interfaces:**
- Consumes: `usePasswordStatus()` and `PasswordSetupForm` from Task 5.
- Produces: server-authoritative Profile method management.

- [ ] **Step 1: Write failing Profile security tests**

Render Profile with status false, true, loading, and error. Assert a `Sign-in & security` section, a `Magic links` row always marked `Active`, a false-state `Password` row marked `Not set` with `Add password`, a true-state row marked `Set` with `Change password`, inline setup/change forms, cancel restoration, success status refresh, and a retry affordance on status failure. Assert the old always-visible current/new password form is gone.

- [ ] **Step 2: Run the test and confirm RED**

Run: `npx vitest run src/pages/ProfilePage.security.test.tsx`

Expected: FAIL because Profile has no sign-in-method rows or server-authoritative state.

- [ ] **Step 3: Implement method rows and progressive forms**

Replace the current password block with two compact method rows. The Magic links row is informational and always Active. The Password row is driven only by `usePasswordStatus`; its Add/Change button expands the reusable form in the same section. Preserve the rest of Profile unchanged. Use real headings, buttons, status text, focus restoration on cancel/success, semantic tokens, and mobile stacking.

- [ ] **Step 4: Run Profile and shared password tests**

Run: `npx vitest run src/pages/ProfilePage.security.test.tsx src/components/auth/PasswordSetupForm.test.tsx src/hooks/usePasswordStatus.test.tsx`

Expected: PASS.

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc -p tsconfig.app.json --noEmit`

Expected: no diagnostics.

Run: `git add src/pages/ProfilePage.tsx src/pages/ProfilePage.security.test.tsx && git commit -m "feat: add profile sign-in security controls"`

---

### Task 8: End-to-End Regression Coverage and Release Notes

**Files:**
- Modify: `e2e/invite-unified.spec.ts`
- Modify: `e2e/profile.spec.ts`
- Modify: `public/changelog.md`
- Modify (generated): `public/changelog.json`

**Interfaces:**
- Consumes: all Task 1-7 behavior.
- Produces: full-story regression proof and customer-facing release note.

- [ ] **Step 1: Add failing invitation E2E scenarios**

Cover: opening a stable invite while signed out leaves the user on a branded landing and does not exchange until Continue; Continue receives a fresh Auth URL; returning through callback accepts membership; passwordless acceptance shows both unselected choices; magic-link choice reaches dashboard; password choice creates a usable password; a delayed but still-unexpired database invitation works; an expired invitation fails until explicit resend; an explicitly resent expired pending invite receives a new 30-day expiry; and a second immediate exchange shows throttled retry UI. Use the repository's existing local Supabase/auth helpers or Playwright route interception for the short-lived external action URL, while preserving a real browser-to-app acceptance path.

- [ ] **Step 2: Add failing Profile E2E scenarios**

Cover a passwordless session showing Magic links Active and Password Not set, adding a password, reloading to see Password Set, changing it via the supported current-password or nonce path, and retaining magic-link availability.

- [ ] **Step 3: Run the focused E2E specs and confirm RED**

Run: `npx playwright test --config=e2e/playwright.config.ts e2e/invite-unified.spec.ts e2e/profile.spec.ts`

Expected: at least the newly added scenarios FAIL before their final fixtures/intercepts are aligned; existing scenarios remain diagnosable.

- [ ] **Step 4: Complete deterministic E2E setup**

Use unique test emails/tokens, database cleanup through existing helpers, explicit waits on visible states rather than timeouts, and exact route assertions. Do not embed production credentials, raw user tokens, or fixed shared accounts. Ensure intercepted exchanges reproduce 200/410/429 response bodies defined in Task 3.

Add Playwright projects or scoped `test.use` coverage for a narrow mobile viewport, dark color scheme, reduced motion, and keyboard-only choice/form interaction. Assert stable layout and focus behavior rather than brittle pixel snapshots.

- [ ] **Step 5: Add the release note and regenerate mirrors**

Add a dated changelog entry explaining that invitation links now remain usable for their full 30-day window, resends restart that window, and users can choose magic links or add a password after joining and from Profile. Use user-facing language and no internal implementation terms.

Run: `deno run --allow-read --allow-write scripts/changelog-to-json.ts`

Expected: `public/changelog.json` is regenerated from Markdown.

Run: `npm run sync:mirrors && npm run sync:mirrors:check`

Expected: email/trust mirrors are regenerated and all generated-artifact checks pass.

- [ ] **Step 6: Run focused E2E and full repository verification**

Run: `npx playwright test --config=e2e/playwright.config.ts e2e/invite-unified.spec.ts e2e/profile.spec.ts`

Expected: PASS.

Run: `npm run verify:fast`

Expected: PASS.

Run: `npm run verify:full`

Expected: PASS, including pgTAP, Deno, Vitest, type checks, lint/build, generated mirror checks, and Playwright suites configured by the repository.

- [ ] **Step 7: Commit the verification slice**

Run: `git add e2e/invite-unified.spec.ts e2e/profile.spec.ts public/changelog.md public/changelog.json && git add -u && git commit -m "test: cover stable invitation onboarding"`

---

## Dependency-Aware Execution Order

1. Task 1 runs first.
2. Tasks 2 and 5 may run in parallel after Task 1 because their owned files are disjoint.
3. Task 3 runs after Tasks 1 and 2.
4. Task 4 runs after Task 3. Task 7 may run in parallel with Tasks 3 and 4 after Task 5 because its owned files are disjoint.
5. Task 6 runs after Tasks 4 and 5.
6. Task 8 runs after Tasks 1-7.
7. One fresh Sol/medium reviewer then reviews the complete diff against this plan and the approved design. Root fixes every confirmed issue and reruns `npm run verify:fast` plus any affected focused suite, then `npm run verify:full` before claiming completion.
