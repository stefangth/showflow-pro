# Invite password setup + branded magic-link login — design

Date: 2026-08-09
Branch: `claude/invited-user-password-setup-f00051`

## One-line summary

Guarantee every invited user a working one-click set-password (or straight-in) link in the branded invite email regardless of account state, and add a branded, Resend-delivered "email me a sign-in link" option that stands co-equal beside password on every login, both minted by one new `send-login-link` edge function and landing on a single new public `/auth/callback` route.

## Context & problem

Two related gaps in the auth surface today:

**1. Invited users can be stranded without a way to set a password.** `deliverOrgInvitation` in `supabase/functions/_shared/invitations.ts` mints a one-click `actionLink` **only for net-new users**:

```ts
let actionLink: string | undefined;
if (!exists) {
  const redirectTo = `${args.appOrigin}/reset-password?redirect=${encodeURIComponent(acceptPath)}`;
  const { data, error } = await deps.admin.auth.admin.generateLink({ type: "invite", email: args.email, options: { redirectTo } });
  ...
  actionLink = ...properties?.action_link;
}
```

For an **existing** auth user (`userExistsByEmail` returns true), `actionLink` stays `undefined`, so the branded `org-invitation` email falls back to the plain copy-paste accept link only:

```tsx
const acceptUrl = actionLink || (token ? `${APP_URL}/accept-invite?token=${token}` : APP_URL);
```

The "existing auth user" state is not rare. `generateLink({ type: "invite" })` **creates the auth account** the first time an invite is sent, so the moment a first invite is delivered the user exists in `auth.users` even if they never set a password. Any of these now hit the existing-user branch:

- **Re-invite** of someone who was invited before but never accepted or never set a password.
- **Invite to an already-registered person** (e.g. an artist who has an account in another org, or was pre-seeded).
- **Expired invite link** — the user comes back after the Supabase link TTL and clicks again; the account already exists.

The concrete failure the user reported, traced end to end: such a user receives the branded invite whose only working link is the plain token accept URL. They click it and land on `/accept-invite?token=…` with **no session**. `AcceptInvitePage` sees no authenticated user and redirects them to `/login?redirect=/accept-invite?token=…` (confirmed at `AcceptInvitePage.tsx` line 47 — the unauthenticated visitor is bounced to `/login`, they are *not* auto-pushed to a reset flow). On `/login` a passwordless user has no password to enter, so they click "Forgot password?", which navigates to `/reset-password` (request mode); there they submit the request form, whose handler calls `requestPasswordReset` (`src/data/profiles.ts`) and fires Supabase Auth's own **unbranded** `resetPasswordForEmail` email. That second, off-brand email is the visible symptom; the **root cause** is the missing `actionLink` on the existing-user invite branch — the invite never carried a link that establishes a session.

**2. There is no passwordless login.** `LoginPage` offers password sign-in and "Forgot password" only. A returning user who never set (or forgot) a password has no first-class, branded way in. Supabase's client-side `signInWithOtp` would work but sends an **unbranded** Supabase email — the exact thing we are trying to eliminate — so it is rejected.

Both problems share one primitive: **mint a Supabase auth link server-side and deliver it through the existing branded Resend pipeline (`deps.sendEmail`), never letting Supabase Auth send an email of its own.** This design builds that primitive once and uses it for both login and the invite hardening.

## Goals

1. The invite email always carries a working one-click link that gets the recipient to a place where they end up authenticated and can set a password, in **every** account state (net-new, existing-passwordless, existing-registered, expired-link retry).
2. Never send an unbranded Supabase Auth email anywhere in the invite or login flow.
3. `LoginPage` presents password and "email me a sign-in link" as two **co-equal actions of the same visual weight** — two full-width buttons with **identical variant, width, and vertical rhythm**, stacked one above the other, so neither visually dominates the other. Password sits on top solely because it is the form's default submit (Enter key), and it is styled identically to the link button (both `variant="default"`) rather than as a filled-primary next to an outline peer; "co-equal" is satisfied literally (same weight), not merely "equal width with password still primary." Either action is usable on first and every subsequent login.
4. One shared, testable minting edge function (`send-login-link`) and one shared landing route (`/auth/callback`).
5. No account-existence leak: identical response and toast whether or not the address maps to a user.
6. Per-email server-side cooldown on link minting (the admin `generateLink` API has no built-in per-email throttle), plus a bounded per-request cost on the public endpoint so a spray attack cannot force expensive work.

## Non-goals

- No change to the password sign-in path (`AuthContext.signIn` → `signInWithPassword`) or to the in-app password change on `ProfilePage`.
- No removal of the "Forgot password" link or of `ResetPasswordPage`'s request mode — password reset remains its own branded flow (it already uses `resetPasswordForEmail`; changing that to Resend is out of scope here).
- No new signup path — onboarding stays invite-only; `send-login-link` never creates accounts.
- No change to `accept_invitation` RPC semantics or `AcceptInvitePage`.
- No SMS / OTP-code entry UI — this is link-based only.
- No org-scoping of the throttle table (it is auth infrastructure keyed by email, pre-session).
- No change to `deliverOrgInvitation`'s existing `userExistsByEmail` call — that path is reached only through the authenticated, org-gated `create-invitation`, not a public surface, so the listUsers cost there is not an abuse vector and is left as-is.
- No suppression-bypass for the magic-link email — it flows through the normal `send-transactional-email` suppression checks like every other template. See Error handling for the accepted lockout limitation and its named recovery path.

## Locked decisions (from the user; not reopened)

- Auth direction is "both, equal": password AND "email me a sign-in link" side by side on login, with the same visual weight; invites still route brand-new users to a set-password screen, with a magic link as an always-available fallback.
- Branded delivery via Resend: an edge function mints with `admin.auth.admin.generateLink` and sends through `deps.sendEmail`. No unbranded Supabase-auth emails. Client-side `signInWithOtp` is rejected for exactly this reason.
- A dedicated new edge function is the shared minting point for login and invite.
- Throttle via a small dedicated table + migration (justified below vs reusing `email_send_log`).
- A dedicated new public route `/auth/callback` resolves the session from the URL and forwards to a safe relative `?redirect=`.

## Detailed design per component

### A. New edge function `send-login-link`

**Path:** `supabase/functions/send-login-link/index.ts`
**Config:** add a `[functions.send-login-link]` block with `verify_jwt = false` to `supabase/config.toml` (see Rollout). It must be public: the caller is an unauthenticated visitor on the login screen with no JWT.

**Contract**

- Method `POST`, JSON body `{ email: string, app_origin: string }`.
- `OPTIONS` → `preflight()` from `_shared/http.ts`.
- Returns HTTP `200 { ok: true }` for any syntactically valid request (existence-hiding). Malformed payloads return `400 { error }`. Server faults (existence-lookup fault, throttle-RPC fault, or a `generateLink` transient failure) return `500 { error: "Internal error" }` — a **generic** body, with the detailed cause logged server-side only, never in the response.

**Public-surface cost bound (the abuse gate).** Because the endpoint is `verify_jwt = false`, an attacker can spray arbitrary addresses at it with no JWT. The per-request work must therefore be cheap and bounded *before* anything expensive runs. The existence check uses the existing service-role RPC **`get_user_id_by_email`** — a single indexed `auth.users` lookup — **not** `userExistsByEmail`, which paginates `admin.listUsers` (an O(users), multi-round-trip admin-API scan). This caps the cost of a sprayed, non-existent address to exactly one indexed DB query with **no admin-API call, no `generateLink`, no email, and no throttle-row write**. The expensive admin path (`generateLink` + `sendEmail`) and the only table write (`claim_login_link_slot`) are both reached **only after** a positive existence result, i.e. only for real accounts, which are additionally rate-limited by the 60s per-email cooldown. So both the compute cost and the table growth of a spray attack are bounded by the registered-user set, not by attacker volume. (Supabase's platform-level per-IP function rate limit remains the outer coarse gate; this design does not depend on it, but it composes with it.) Type note: `get_user_id_by_email` is generated as `Returns: string` (PostgREST cannot express a nullable scalar return, per CLAUDE.md), but it returns **NULL** at runtime for an unknown address; the `if (!userId)` branch is therefore the real no-account path even though the type reads non-null. The shared fake models the NULL correctly (it backs the RPC from `authUsersByEmail`), so no cast or type widening is needed.

**Ordering rationale (bounded throttle table).** The existence check runs **before** the throttle claim, so a non-existent address never writes a row. This bounds `auth_link_throttle` to at most the number of real registered accounts (plus opportunistic pruning of stale rows in the RPC). The cost is a small timing difference between the existent and non-existent branches (the existent branch additionally throttles + mints + sends); we accept it and defend enumeration at the response layer (identical body + toast), where it actually matters, rather than at the timing layer. Both branches now share only a single indexed lookup, so the timing gap is smaller than in a listUsers design.

**Handler shape (DI pattern, matches every other function):**

```ts
import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { safeAppOrigin } from "../_shared/appOrigin.ts"; // see note below

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

    // Existence check FIRST, via a SINGLE indexed lookup (get_user_id_by_email),
    // NOT the O(users) admin listUsers pagination. On a public endpoint this bounds
    // the per-request cost of a sprayed address to one indexed query: no admin API
    // call, no throttle write, no mint. A non-account never writes a throttle row.
    const { data: userId, error: lookupErr } = await deps.admin.rpc("get_user_id_by_email", { p_email: email });
    if (lookupErr) {
      console.error("send-login-link get_user_id_by_email failed:", lookupErr.message);
      return json({ error: "Internal error" }, 500);
    }
    if (!userId) return json({ ok: true }); // no account: identical shape, nothing done

    // Throttle claim (atomic check-and-set) only for real accounts.
    const { data: allowed, error: throttleError } = await deps.admin.rpc("claim_login_link_slot", {
      p_email: email, p_cooldown_seconds: COOLDOWN_SECONDS,
    });
    if (throttleError) {
      // A DB/RPC fault must NOT masquerade as a throttled request (which would
      // silently disable all magic-link login behind a success toast).
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
      templateData: { actionLink }, // the ONLY input magic-link.tsx reads
    });
    return json({ ok: true });
  } catch (e) {
    // Generic body only; detailed cause logged server-side, never returned.
    console.error("send-login-link error", (e as Error).message);
    return json({ error: "Internal error" }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
```

A `500` here is not an enumeration oracle: it fires only on a DB/RPC fault (existence lookup or throttle) or a `generateLink` transient failure, all independent of whether the address maps to an account, and the client renders the same generic toast regardless (see LoginPage). All three `500` branches now return the identical generic `{ error: "Internal error" }` body — nothing account-specific or cause-specific leaks in the HTTP response; the diagnostic detail lives only in the server logs / System Health. Surfacing it as `500` (rather than folding it into the throttled `200` path) means a bad deploy or permission drift shows up as real errors in logs instead of a silent, inbox-empty outage.

**`app_origin` handling.** `create-invitation` trusts the client-supplied `app_origin` (it only trims the trailing slash). To avoid an open-redirect / phishing vector on a **public** endpoint, `send-login-link` must not embed an arbitrary attacker origin into a real auth link. Introduce a tiny shared helper:

- **Path:** `supabase/functions/_shared/appOrigin.ts`
- **Signature:** `export function safeAppOrigin(candidate: string | undefined, deps: Deps): string | null`
- **Behavior:** build a small allowlist of trusted app origins and return the candidate iff it is on it, else `null`. Concretely: `canonical = appUrl(deps.env)` (from `_shared/app-url.ts`); trim any trailing slash on the candidate; the allowlist is `{ canonical } ∪ { "http://localhost:8080", "http://127.0.0.1:8080" }` (the committed local-stack dev origins). Return the trimmed candidate when it exactly matches an allowlisted origin; return `null` for a missing, syntactically invalid, or non-allowlisted (foreign) candidate. The dev origins are allowlisted **unconditionally**, NOT gated on `canonical` being localhost. This is deliberate and load-bearing: on the local stack `APP_URL` is unset for the edge runtime (verified — it is absent from `.env.development`, `.env.development.local`, `config.toml`, and the local-up script), so `appUrl(deps.env)` resolves to the production default `https://app.showflow.pro`. An environment gate keyed on `canonical` being localhost would therefore reject `:8080` on the local stack and mint a **production** `redirectTo`, silently breaking end-to-end verification of the magic-link login on the very branch this ships on — while the invite path (which uses the raw `app_origin`) kept working, an inconsistency. Allowlisting the fixed localhost ports is safe in production because localhost is never an attacker-controlled host: a minted link pointing at `localhost:8080` simply fails to resolve on a machine not running the dev app, leaking nothing. A **foreign** host (`https://evil.example`) is what must never be minted, and the allowlist rejects it → `null`.
- **Handler contract (makes the `| null` live).** Because `safeAppOrigin` returns `null` for a missing/invalid/foreign origin, the handler's `if (!email || !appOrigin) return json(..., 400)` guard is a **live** rejection path, not dead code: a spoofed or malformed `app_origin` is answered with `400`, never silently coerced to the canonical origin. This is an *origin* error, independent of whether the email maps to an account, so it does not weaken enumeration parity (a real login request from the app always carries an allowlisted `window.location.origin` and never 400s on this branch). Supabase's Auth redirect allowlist (see Rollout) is the second, independent gate.

> Note: `safeAppOrigin` keeps the emailed link from ever containing a foreign host and constrains the minted origin to `{ canonical app, known local-dev ports }`. Preview/other deployment hosts are intentionally out of scope for magic-link login — those surfaces authenticate against production — so a login request from such a host 400s rather than minting a link to a non-app origin.

**Why `generateLink({ type: "magiclink" })` and not `resetPasswordForEmail`.** `resetPasswordForEmail` both mints AND sends an unbranded Supabase email (this is exactly the bug `platform-manage-user`'s `send_password_reset` action documents). `generateLink` mints only — it returns `properties.action_link` and sends nothing — so we can hand the link to our own Resend template. This is the same "mint, don't send" nuance already learned in-repo.

### B. Invite hardening in `_shared/invitations.ts`

**Path:** `supabase/functions/_shared/invitations.ts` → `deliverOrgInvitation`.

Change: the existing-user branch must also mint an `actionLink` — a **magic link** that logs the user straight in and lands on the accept path — so the invite email is one-click in every state. (The existence check here stays `userExistsByEmail`: this function runs only behind the authenticated, org-gated `create-invitation`, so the public-endpoint cost concern from §A does not apply and no signature/dependency change is warranted.)

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
    // EXISTING (re-invite / passwordless / expired): magic link logs them in and lands
    // on accept via /auth/callback. They can set a password later in-app on ProfilePage.
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

Notes:

- The **net-new redirect** deliberately stays `/reset-password?redirect=...` so brand-new users still get the set-password screen first (the locked "invites route new users to set-password" decision). Only the existing-user branch is new.
- The plain token accept link (`${APP_URL}/accept-invite?token=…`) remains rendered in the email body by `org-invitation.tsx` as the copy-paste fallback. The component already renders `acceptUrl` as both the CTA (`actionLink || token-url`) and the paste line. With `actionLink` now always present, the CTA is one-click.

  One refinement to make the paste-line honest: today the paste line uses `acceptUrl` (which becomes the magic/invite link, a single-use URL that reads oddly when pasted). Change `org-invitation.tsx` so the paste line always shows the **token** accept URL (`token ? ${APP_URL}/accept-invite?token=${token} : APP_URL`) while the CTA uses `actionLink`. This is a source edit to the edge template `org-invitation.tsx` (not mirrored — email `.tsx` components are hand-maintained; only `emailCopy.ts`/`emailTheme.ts` are generated).

- No signature change to `DeliverInviteArgs`; `create-invitation` and `resend-invitation` callers are unaffected.
- **Regression test to REPLACE (not add):** the existing `supabase/functions/_shared/invitations.test.ts` test at line 28, `"deliverOrgInvitation: existing user → branded email with NO actionLink"`, asserts `body.templateData.actionLink === undefined`. That assertion now describes the old, broken behavior and directly contradicts this change. It **must be rewritten** (seed `generateLinkResult` in `makeFakeDeps`, assert a non-empty `actionLink`, and read the newly-recorded `generateLink` call to assert `type: "magiclink"` and a `redirectTo` containing `/auth/callback?redirect=…/accept-invite?token=…`), not left in place alongside a new test — see Testing §2.

### C. New email template `magic-link`

Editor model decision (locked here to keep the wiring buildable): **`magic-link` is an internal template, like `cron-health-alert`** — its copy lives as version-controlled defaults but it is NOT exposed to the per-org editor, because the primary login send has no `org_id` for a per-org override to attach to (full rationale immediately below). It is therefore threaded through the renderer + registry + copy **defaults** and listed in the coverage registry as `status:"internal"`, but it gets **no** `emailTemplateMeta.ts` block and is excluded from the parity filter — the same shape as `cron-health-alert`. One of these edits (`emailCopy.ts`) is a mirrored source (requires `sync:mirrors`).

**Decision: `magic-link` is an internal (non-editor-editable) template, mirroring `cron-health-alert`.** `send-transactional-email` resolves per-org copy overrides **by `org_id`**, but the primary send — the login-screen send from §A — has **no** `org_id` (`send-login-link` calls `deps.sendEmail` *without* one, because there is no session yet), so a per-org edit to `magic-link.*` copy would have **zero effect** on the login-link email (and the re-invite path sends the separate `org-invitation` template, not this one). Presenting `magic-link` as "editable" in the Email-templates admin surface would therefore be a trap: an admin's edit silently no-ops for the dominant path. We instead treat it exactly like the existing internal `cron-health-alert` template. Its **defaults** live in `emailCopy.ts` (so the email renders and the copy is version-controlled and translatable at the defaults level), but it is **excluded from the editor field-metadata** and marked `status:"internal"` in the coverage registry, so the admin UI never advertises per-org editability that would no-op. (The alternative — keep it editable and surface an in-editor caveat — was rejected: more UI surface for no real gain, since no per-org edit can ever reach the login send.) The same `org_id`-scoping applies to the per-org email **theme** (`emailTheme` is resolved by `org_id` too), so the sign-in-link email always renders with the default violet family even for orgs that customized their theme. This is intended for a pre-session auth email — there is no org context to theme it by — and is called out here so it is a conscious consequence of the internal-template choice, not a surprise.

**C1. Component — `supabase/functions/_shared/transactional-email-templates/magic-link.tsx`** (new; hand-maintained, violet family, mirrors `org-invitation.tsx` structure):

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

`actionLink` is the sole runtime input the component reads (the CTA href and the paste line); the handler passes exactly `{ actionLink }` and nothing else, so the send payload and the template's inputs match one-for-one with no dead field.

**C2. Registry — `supabase/functions/_shared/transactional-email-templates/registry.ts`:** import and register, AND add a `SUBJECT_RESOLVERS` entry.

```ts
import { template as magicLink } from './magic-link.tsx'
// ...in TEMPLATES:
'magic-link': { ...magicLink, family: 'violet' },
```

`SUBJECT_RESOLVERS` (registry.ts line ~136) is declared `satisfies Record<EmailTemplateKey, SubjectResolver>`, where `EmailTemplateKey = typeof EMAIL_TEMPLATE_KEYS[number]`. Because C3a adds `"magic-link"` to `EMAIL_TEMPLATE_KEYS`, that `Record` becomes **non-exhaustive** unless `magic-link` also gets a resolver — `deno check` and the tsc mirror fail otherwise. A static subject still needs an entry: the existing `account-email-changed` proves it (`(_data, copy) => copy['account-email-changed.subject']`). Add the mirroring entry:

```ts
'magic-link': (_data, copy) => copy['magic-link.subject'],
```

This also makes the `magic-link.subject` copy resolve at send time. `send-transactional-email` accepts any template present in `TEMPLATES`, so registration + resolver is the only wiring required for delivery.

**C2a. Keep `magic-link` UNMAPPED in `notificationCategories.ts`.** `send-transactional-email` consults `categoryForTemplate` (in `supabase/functions/_shared/notificationCategories.ts`) via the `EMAIL_TEMPLATE_CATEGORY` map: mapped templates are preference-gated, unmapped templates always send. `magic-link` is critical auth mail and **must not** be added to `EMAIL_TEMPLATE_CATEGORY`, exactly like the existing invite / password-reset templates, so a user's notification preferences can never suppress a sign-in link. Do not add a category entry for it; the `?? null` fallthrough in `categoryForTemplate` is the desired behavior. (Called out because a future contributor "tidying up" the map could silently break sign-in.) Note this governs only preference-gating; hard suppression (bounce/complaint list) still applies — see Error handling.

**C3. Copy defaults + editor metadata (two files that MUST move together).**

The frontend keeps editor copy in two hand-authored files that a unit test cross-checks: `src/lib/emailTemplates/emailCopy.ts` (the mirrored **defaults**) and `src/lib/emailTemplates/emailTemplateMeta.ts` (the editor **field metadata**). `emailCopy.test.ts` — the test `"has metadata for every editable default and no orphan metadata field"` (line 64) — asserts that `Object.keys(EMAIL_COPY_DEFAULTS)`, after dropping keys with the `cron-health-alert.` prefix (the existing internal-template exclusion), **exactly equals** the field keys in `EMAIL_TEMPLATE_COPY_FIELDS`. Because `magic-link` is internal (per the decision above), we **extend that exclusion** and add **no** `emailTemplateMeta.ts` block — exactly as `cron-health-alert` is handled today. Adding `magic-link.*` defaults without this filter change would fail the parity test in `verify:fast`. Both edits below ship in the same commit as the `emailCopy.ts` change.

**C3a. `src/lib/emailTemplates/emailCopy.ts` (mirrored SOURCE; run `npm run sync:mirrors` after):**

- Add `"magic-link"` to `EMAIL_TEMPLATE_KEYS` (currently ends `..., "account-email-changed", "cron-health-alert"`; insert `"magic-link"` before `"cron-health-alert"` so keys stay grouped with the other Accounts & access templates).
- Add the copy keys (no em/en dashes, per house rule) — exactly these eight (rendered from defaults only; no editor meta block, since `magic-link` is internal):

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

Then `npm run sync:mirrors` regenerates `supabase/functions/_shared/transactional-email-templates/_shell/emailCopy.ts` (the `// GENERATED FILE. Do not edit.` target — confirmed as the mirror target of this source in `scripts/mirrors.manifest.json`). `npm run sync:mirrors:check` must be green in CI.

**C3b. No `emailTemplateMeta.ts` block (internal template).** Because `magic-link` is internal (per the decision above), it gets **no** field-metadata block — exactly like `cron-health-alert`. Instead, extend the internal-exclusion filter in `emailCopy.test.ts` so the parity test does not demand metadata for the `magic-link.*` defaults:

```ts
// emailCopy.test.ts — test "has metadata for every editable default and no orphan metadata field" (line ~69)
// before: .filter((key) => !key.startsWith("cron-health-alert."))
.filter((key) => !key.startsWith("cron-health-alert.") && !key.startsWith("magic-link."))
```

This is the same shape as the existing `cron-health-alert.` exclusion and ships in the same commit as the `emailCopy.ts` defaults. `emailTemplateMeta.ts` is not touched.

### C4. Settings coverage registry (`src/lib/emailTemplates/coverage.ts`) — hand-maintained, NOT derived

Correcting an earlier draft: `EMAIL_TEMPLATE_COVERAGE` is a hand-authored array (each entry hardcodes `group`/`trigger`/`recipient`/`status`/`category`/`family`); it does **not** read `EMAIL_TEMPLATE_KEYS`, so a new template is **not** picked up automatically. We still add an explicit entry so `magic-link` is documented in the admin Email-templates inventory for oversight, but with `status:"internal"` (mirroring `cron-health-alert`) so it is listed without exposing a per-org editor that would no-op. Add it in the `Accounts & access` group, after `account-email-changed`:

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

Placement in the array must be immediately after `account-email-changed` and before `password-reset`, because `coverage.test.ts` asserts the exact ordered key list. The full new ordered key list is: `offer-immediate`, `artist-offer-digest`, `offer-expiry-reminder`, `artist-confirmation-digest`, `cast-escalation-requested`, `hire-order-issued`, `hire-order-countersigned`, `org-invitation`, `account-email-changed`, **`magic-link`**, `password-reset`, `cron-health-alert` (12 entries total: 11 live/delivered templates — the 9 editable plus the two internal ones, `magic-link` and `cron-health-alert` — plus the external `password-reset`). Impact on the hand-pinned assertions in `coverage.test.ts` (see Testing §1):

1. **Breaks** — the ordered `map(t => t.key)` list (test line 6): insert `"magic-link"` after `"account-email-changed"`, and change the test title from "ten live delivery templates plus the external password reset" to "eleven delivered templates plus the external password reset".
2. **Unaffected** — the `status === "editable"` `objectContaining` list (test line 22) stays **nine**: `magic-link` is `internal`, not `editable`, so it is not added there — this is the whole point of choosing internal.
3. **Unaffected** — the `"takes opt-out categories"` parity test needs no change: `magic-link` is not in `EMAIL_TEMPLATE_CATEGORY`, so its `if (category)` guard is skipped and the literal `"critical"` stands.
4. **Optional strengthening** — extend the `"keeps password reset external and cron health internal"` test (test line 36) to also assert `magic-link` is `status:"internal"`, keeping internal-status coverage explicit.

### D. Data-access + hook (frontend)

**New file `src/data/authLinks.ts`:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Request a branded, one-time sign-in link. Existence-hiding: resolves for any input;
 *  the edge function no-ops (still 200) when no account matches. */
export async function requestLoginLink(
  client: SupabaseClient<Database>,
  email: string,
  appOrigin: string,
): Promise<void> {
  const { error } = await client.functions.invoke("send-login-link", {
    body: { email, app_origin: appOrigin },
  });
  if (error) throw error; // transport-level only; the handler returns 200 for valid input
}
```

No React Query hook is required (fire-and-forget mutation with no cache to invalidate); `LoginPage` calls `requestLoginLink(supabase, email, window.location.origin)` directly, mirroring how `ResetPasswordPage` calls `requestPasswordReset`. A thin `useRequestLoginLink` wrapper is optional and not added, keeping parity with `requestPasswordReset` (which has none).

### E. `LoginPage` — co-equal "email me a sign-in link" action

**Path:** `src/pages/LoginPage.tsx`.

Final layout decision (resolves the co-equal lock literally — same visual weight, no filled-vs-outline asymmetry):

- The password form is unchanged and its "Sign in" button remains the form's default submit (`type="submit"`, Enter-key). It keeps `variant="default"`.
- **Directly beneath** the Sign in button, add a full-width `Button` with the **same** `variant="default"`, `type="button"`, labeled "Email me a sign-in link". Identical variant, width, and vertical rhythm as Sign in, so the two form a two-button stack of genuinely equal visual prominence — neither is a de-emphasized peer. Password is on top only because it is the Enter-key default; it is not styled as the singular primary. (This is a deliberate departure from the round-5 `variant="outline"` treatment, which the co-equal lock rules out.) To keep the stack legible with two same-weight buttons, separate them with a small "or" divider row between the two buttons (a thin rule with a centered "or" label), a standard equal-weight either/or pattern; both buttons keep the same fill.
- **Move** the "Forgot password?" text link: today it sits *above* the Sign in button (inside the form, right after the password field). Relocate it to **below both buttons** as a smaller tertiary text affordance, visually subordinate to the two co-equal actions. This is a deliberate reflow, not a no-op — the current markup order changes.

Imports to add to `LoginPage.tsx`:

```ts
import { toast } from "sonner";
import { requestLoginLink } from "@/data/authLinks";
import { supabase } from "@/integrations/supabase/client"; // not currently imported; the handler passes it
```

Handler:

```ts
const [linkSending, setLinkSending] = useState(false);
const onEmailLink = async () => {
  if (!email) { setError("Enter your email first."); emailRef.current?.focus(); return; }
  setLinkSending(true);
  try {
    await requestLoginLink(supabase, email, window.location.origin);
    toast.success("If that email exists, a sign-in link is on its way.");
  } catch {
    // Never leak existence or transport detail on this control.
    toast.success("If that email exists, a sign-in link is on its way.");
  } finally {
    setLinkSending(false);
  }
};
```

- The button shows a spinner / disabled state while `linkSending`.
- The generic toast is identical on success and failure (including the `500` lookup/throttle-RPC-fault case) so the control cannot be used as an account oracle.
- The `?redirect=` already in the URL is not passed to `send-login-link` (the minted magic link always lands on `/auth/callback?redirect=/dashboard`); preserving an arbitrary pre-login `?redirect=` through an emailed link is out of scope and would widen the redirect surface. Password login keeps honoring `?redirect=` as today.

### F. New `AuthCallbackPage` at `/auth/callback`

**Path:** `src/pages/AuthCallbackPage.tsx` (default export). **Public route** (no `ProtectedRoute`).

Behavior mirrors `ResetPasswordPage`'s session-resolve pattern: the magic/invite link puts the session in the URL hash; supabase-js resolves it and fires `SIGNED_IN`. The page waits for a session, then navigates to the validated relative redirect. **It also reads the URL hash for an explicit GoTrue error** (`#error=...&error_description=...`), which GoTrue appends when a link is expired or already used, and short-circuits to the failed state immediately rather than waiting on the watchdog.

**Timing correctness (the hash-strip race).** supabase-js is created with `detectSessionInUrl: true`, so at client init it asynchronously parses the URL fragment and, via `history.replaceState`, **strips the hash** (both the session tokens and any `#error=...`). If the error hash were read inside `useEffect` (which runs post-paint), the client may already have wiped it, so the "immediate expired-link" state would silently never fire and the user would sit through the full 8s watchdog. `ResetPasswordPage` avoids exactly this by reading its recovery hash in a **`useState` initializer** (render/first-commit time), which runs before the client's async strip completes. This page does the same: the error hash is parsed **synchronously in a `useState` initializer**, captured into state before any effect runs, so detection does not depend on the hash still being present post-mount. The `useEffect` only wires session listeners and the watchdog; it never re-reads `window.location.hash`.

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  // Synchronous initializer: captures the GoTrue error hash before the async strip.
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
    // Watchdog ONLY for the genuine no-signal case (no session AND no error hash arrived).
    const t = setTimeout(() => { if (!done) setFailed(true); }, 8000);
    return () => { clearTimeout(t); sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      {/* StageMark + "Signing you in..." spinner; on `failed`, show
          "That link has expired. Request a new sign-in link." with a Link to ROUTES.LOGIN. */}
    </div>
  );
}
```

- Reuses the exported `safeRelativeRedirect` from `src/features/auth/resetPassword.ts` (no duplication).
- The redirect is validated to be a safe in-app relative path; an attacker-crafted `?redirect=//evil.com` falls back to `/dashboard`.
- On the failure branch (expired/used link, or no session), the page does not dead-end: it points back to `/login`, where the user can request a fresh branded link. Because requesting a link is now self-service and branded, an expired link is fully recoverable.

**Route registration** (`src/App.tsx`, public, no gate — sits with the other public routes):

```tsx
<Route path={ROUTES.AUTH_CALLBACK} element={<AuthCallbackPage />} />
```

**Route constant** (`src/config/app.config.ts`, in `ROUTES`): `AUTH_CALLBACK: '/auth/callback'`.

**Landing for an accountless-but-orgless user (expected, not a dead end).** A user who exists in `auth.users` only because a prior invite created the account, but who never joined any org (never accepted), can now request a login link from `/login` and authenticate. `send-login-link` always lands them on `/auth/callback?redirect=/dashboard`; `ProtectedRoute`'s org gate then routes them to `NoOrgScreen` (they have a session but no org). This is the correct, already-designed terminal state for an orgless account — not a regression introduced here. Their path into an org is still the invite link (Flow 3), which lands on `/accept-invite` and joins them; a bare login link deliberately does not accept an invite on their behalf. No special-casing is added; `NoOrgScreen` with its "ask your admin for an invite" copy is the intended surface.

## Data model + migration (throttle table)

### Why a dedicated table (vs `email_send_log`)

`email_send_log` is delivery-outcome telemetry: it holds suppressed / skipped / failed rows and is keyed for the email pipeline, not for a pre-mint gate. Deriving a cooldown from it means scanning by recipient + template + timestamp across a growing log, and coupling the login-link gate to email-delivery semantics (a suppressed or bounced row would still count as "recently sent" — wrong). A purpose-built one-row-per-email table gives an O(1), atomic check-and-set with clear ownership, independent of whether the email ultimately delivers, and trivially testable in isolation. The write is a single upsert inside a `SECURITY DEFINER` RPC.

### Size bound

Because the handler claims a slot **only after** `get_user_id_by_email` returns a real user id, only registered accounts ever write a row, so the table is bounded by the number of registered users. As belt-and-suspenders, the RPC opportunistically prunes rows older than the larger of one day or the cooldown on each call, keeping the working set to accounts that actually requested a link recently.

### DDL sketch (generated via the migration tool; file named to match the applied version)

```sql
-- Table: per-email cooldown for server-minted auth links (magic-link login + re-invite).
-- Auth infrastructure, keyed by email, NOT org-scoped and NOT tenant data.
create table public.auth_link_throttle (
  email        text        primary key,
  last_sent_at timestamptz not null default now()
);

alter table public.auth_link_throttle enable row level security;

-- No policies for anon/authenticated: this table is written and read ONLY by the
-- service-role edge function (which bypasses RLS) via the RPC below. RLS-enabled with
-- zero policies = deny-all to every non-superuser role. That is the intended posture.
-- (No RESTRICTIVE org_isolation policy: there is no org_id; it is not tenant data.)

-- Explicit grants: newer Supabase CLI strips implicit table grants on fresh local
-- stacks, so grant service_role explicitly and grant NOTHING to anon/authenticated.
revoke all on public.auth_link_throttle from anon, authenticated;
grant all on public.auth_link_throttle to service_role;

-- Atomic claim: returns true and stamps last_sent_at when the cooldown has elapsed
-- (or no row exists), false when still within the window. One statement, no race.
-- Also opportunistically prunes stale rows so the table stays small.
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
  -- Prune horizon is the LARGER of one day or the cooldown, so raising the cooldown
  -- can never prune a row that is still inside its cooldown window. This removes the
  -- hidden coupling that a >1-day cooldown would otherwise introduce (Open Question 2).
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

-- Only the service role may call it (the public send-login-link handler uses deps.admin).
revoke all on function public.claim_login_link_slot(text, int) from anon, authenticated;
grant execute on function public.claim_login_link_slot(text, int) to service_role;
```

Notes:

- `ON CONFLICT ... DO UPDATE ... WHERE` with `RETURNING` is atomic: if the guard is false, no row is updated and nothing is returned, so `v_claimed` is `NULL` → `false`. If it succeeds (insert or update), it returns `true`.
- The **prune horizon is derived from the cooldown** (`greatest(interval '1 day', cooldown)`), so the earlier hard-coded "1 day" no longer silently caps the safe cooldown. Raising `COOLDOWN_SECONDS` above a day (Open Question 2) stays correct without any DDL edit — a row within its cooldown is never pruned, because the prune horizon is at least the cooldown. For a sub-day cooldown the horizon is still one day (keeps the table small), which is strictly longer than the cooldown, so pruning is always safe.
- `lower(p_email)` inside the function keeps the key canonical even though the handler already lowercases.
- Seed data: none. This table is empty at rest; no `seed.sql` entry (and it must not go in a migration anyway).

### Migration + type-regen ordering (branch-local, NO production hand-apply)

`send-login-link` calls `deps.admin.rpc("claim_login_link_slot", ...)`. supabase-js's typed client constrains the `.rpc()` name to functions present in the generated types, so a brand-new RPC name is not typeable until the types include it, and `deno check --node-modules-dir=none` / `tsc` (both in `verify:fast`) run on the PR **before** merge. The prior draft resolved this by hand-applying the migration to **production** out of band — precisely the pattern memory flags as having broken every subsequent `supabase db push` once a prod-recorded version had no matching local file. That is not required here. Two lower-risk paths exist; use them in this order:

1. **Regenerate types from the LOCAL stack (preferred on this branch).** This is the local-CI-stack branch, so the migration can be applied and verified entirely locally: generate the migration with the migration tool, `npm run local:reset` (applies every migration in `supabase/migrations/` to the local Postgres), then `supabase gen types typescript --local > src/integrations/supabase/types.ts`, then `npm run sync:mirrors` to update `supabase/functions/_shared/database.types.ts`. This adds both `claim_login_link_slot` and (already present) `get_user_id_by_email` to the generated types with **no touch to the production project**. Commit the migration, `types.ts`, and the regenerated mirror together. Production is written normally by the merge, which applies the still-unrecorded migration under the filename's own version — no `git mv` dance, no drift.
2. **Cast at the `.rpc()` boundary (fallback if local type-gen is unavailable).** Mirror the in-repo `_shared/rows.ts` widened-args convention: rather than hand-applying to prod solely to satisfy the type checker, cast the throttle call so it typechecks against the *current* generated types — e.g. define `type ClaimLoginLinkSlotArgs = { p_email: string; p_cooldown_seconds: number }` in `_shared/rows.ts` and invoke `deps.admin.rpc("claim_login_link_slot" as never, args as unknown as ClaimLoginLinkSlotArgs)` at the single call site (one confined cast, exactly the boundary pattern used for `resolve_show_assignments` / `create_hire_order_with_dates` / `upsert_health_daily`). No pre-merge migration apply of any kind is then needed; the real types land on the next routine regeneration. Prefer path 1 when the local stack is available so the call stays fully typed; use path 2 only if it is not.

Do **not** hand-apply the migration to the production project to make the PR green. Neither path above requires it, and the failure mode (a prod-recorded version with no matching local file aborting all future deploys) is far costlier than either.

## Full flow walkthroughs

### Flow 1 — Magic-link login (new-first or returning)

1. Visitor opens `/login`, types their email, clicks "Email me a sign-in link".
2. `LoginPage.onEmailLink` calls `requestLoginLink(supabase, email, window.location.origin)`.
3. `send-login-link` handler runs: validates `email` + `app_origin` (via `safeAppOrigin`), then the single-lookup existence check `get_user_id_by_email(email)`.
   - On a lookup error → logged + `500 { error:"Internal error" }` (client still shows the generic toast).
   - If it returns `null` (no account) → `200 { ok:true }`, nothing sent, no throttle row written, no admin-API call.
   - If it returns a user id → `claim_login_link_slot(email, 60)`. On a populated RPC error → logged + `500 { error:"Internal error" }`. If throttled (`false`) → `200 { ok:true }`, sends nothing. Else → `generateLink({ type:'magiclink', redirectTo: '<origin>/auth/callback?redirect=/dashboard' })`, then `deps.sendEmail({ template_name:'magic-link', templateData:{ actionLink } })`.
4. UI shows the generic toast "If that email exists, a sign-in link is on its way." regardless of branch.
5. The user receives the branded `magic-link` Resend email and clicks "Sign in".
6. Supabase verifies the token and redirects the browser to `/auth/callback?redirect=/dashboard` with the session in the URL hash.
7. `AuthCallbackPage` finds no error hash (checked synchronously at render), sees `SIGNED_IN` (or an already-present session), computes `safeRelativeRedirect("/dashboard", "/dashboard")`, and navigates to `/dashboard`. `ProtectedRoute` now sees a session and renders — or, for an accountless-but-orgless user (see §F), routes them to `NoOrgScreen`, the expected terminal state.

### Flow 2 — Invite, net-new user (unchanged happy path)

1. Admin (or capability-gated producer) invites `new@x.com`; `create-invitation` inserts the `org_invitations` row and calls `deliverOrgInvitation`.
2. `userExistsByEmail` = false → `generateLink({ type:'invite', redirectTo:'<origin>/reset-password?redirect=/accept-invite?token=…' })` (this also creates the auth account). `actionLink` is set.
3. Branded `org-invitation` email sends with the one-click CTA = the invite link; paste line = the token accept URL.
4. User clicks → lands on `/reset-password` in "set" mode (the invite link resolves a `SIGNED_IN`/`invite` session; `ResetPasswordPage` flips to set-password).
5. User sets a password → `setNewPassword` → navigates to `safeRelativeRedirect('/accept-invite?token=…', '/dashboard')` → `/accept-invite` runs `accept_invitation`, links the artist, joins the org.

### Flow 3 — Invite existing / re-invite / passwordless (the fixed case)

1. Admin invites `known@x.com`, who already exists in `auth.users` (prior invite, other org, or pre-seed).
2. `create-invitation` inserts the invitation (or maps 23505 to "already has a pending invitation" if one is live) and calls `deliverOrgInvitation`.
3. `userExistsByEmail` = true → **new branch**: `generateLink({ type:'magiclink', redirectTo:'<origin>/auth/callback?redirect=/accept-invite?token=…' })`. `actionLink` is set.
4. Branded `org-invitation` email sends with a one-click CTA that logs the user straight in; paste line = the token accept URL.
5. User clicks → Supabase verifies → `/auth/callback?redirect=/accept-invite?token=…` → `AuthCallbackPage` sees the session → navigates to `/accept-invite?token=…` → `accept_invitation` runs while authenticated → the user is in the org.
6. No password is required to accept; the user can set one later on `ProfilePage` (in-app password change already supported). **The unbranded reset email is never triggered.** (Before this change, step 3 minted no `actionLink`, so the invite carried only the token accept URL, which lands at `/accept-invite` with no session → bounce to `/login` → the passwordless user resorts to "Forgot password" → the unbranded `resetPasswordForEmail` fires. That whole chain is now cut.)

### Flow 4 — Expired link recovery

1. A user clicks an old magic/invite link after the Supabase TTL (or a second time after use). GoTrue redirects to `/auth/callback#error=...&error_description=...` with no valid session.
2. `AuthCallbackPage` parses the hash **synchronously at render** (before supabase-js's `detectSessionInUrl` strips it), sees the `error`/`error_description`, and starts in the `failed` state: "That link has expired. Request a new sign-in link." linking to `/login`. No session listeners are even wired. (The 8s watchdog is only the fallback when no session and no error hash arrive at all.)
3. On `/login`, "Email me a sign-in link" mints a fresh branded link (subject to the 60s cooldown). Self-service, branded, no dead end.

## Security

- **Public-endpoint abuse (compute + table growth).** `send-login-link` is `verify_jwt = false`, so it is reachable by anyone. The per-request cost of a sprayed, non-existent address is exactly one indexed `get_user_id_by_email` query — no `admin.listUsers` pagination, no `generateLink`, no email, no throttle-row write. The expensive admin work and the only DB write happen strictly after a positive existence result, so both compute cost and table size are bounded by the registered-user set, not attacker volume, and real accounts are further limited to one link per 60s. Supabase's platform per-IP function rate limit is the outer coarse gate but is not relied upon.
- **Enumeration.** `send-login-link` returns `200 { ok:true }` for existent, non-existent, and throttled emails alike; the UI toast is identical on success and failure (and on the `500` RPC-fault case). All three `500` branches return the identical generic `{ error: "Internal error" }` body, so even the error response carries no account-specific or cause-specific signal. `generateLink`'s "user not found" is never surfaced (the not-exists branch never calls it). Enumeration is defended at the response layer. A small residual timing difference remains — the existent branch additionally throttles + mints + sends — accepted as the price of bounding the throttle table; both branches share only the single indexed lookup.
- **Throttle & table growth.** Per-email 60s cooldown, enforced server-side and atomically via `claim_login_link_slot`, and claimed **only for real accounts** (after the existence check) so an attacker spraying random addresses writes zero rows. `auth_link_throttle` is therefore bounded by the registered-user count, and the RPC opportunistically prunes rows older than the cooldown-derived horizon. `generateLink` (admin API) has no built-in per-email limit like `signInWithOtp`, so this table is the limiter; a burst of clicks yields exactly one email per 60s per address.
- **RPC-fault visibility.** A populated `get_user_id_by_email` or `claim_login_link_slot` error returns `500` and logs distinctly, so a bad deploy / permission drift surfaces as real errors (and in System Health) instead of every login silently failing behind a success toast. The `500` is not an oracle (it is account-independent, generic body) and the client renders the same toast.
- **Redirect safety.** The minted `redirectTo` origin is constrained by `safeAppOrigin` to the allowlist `{ canonical app origin, the committed localhost dev origins }`; any other (foreign or malformed) `app_origin` is answered with a `400` rather than minting a link, and Supabase's Auth redirect allowlist is the second, independent gate. The in-app `?redirect=` on `/auth/callback` is always run through `safeRelativeRedirect` (relative, non-`//`), so it can only ever navigate within the app.
- **Public function surface.** `verify_jwt = false` is required (unauthenticated caller) and mirrors the other public webhooks. The function never returns account state and can only cause an email a visitor could already request.
- **Critical-mail preference bypass.** `magic-link` is intentionally left out of `notificationCategories.ts` (`categoryForTemplate` → `null`), so notification *preferences* can never suppress a sign-in link, matching invites and password reset. Hard suppression (bounce/complaint list) is a separate mechanism — see Error handling for its accepted limitation.
- **Throttle table exposure.** RLS enabled with zero policies + `revoke all from anon, authenticated` means no client can read who requested links or when. Only the service role (via the RPC) touches it.
- **No account creation.** `send-login-link` only ever mints for existing users; it cannot spray-create accounts (unlike `type:'invite'`, which is never used here). Signup stays invite-only.

## Error handling & edge cases

- **Malformed body / bad email** → `400 { error:"Invalid payload" }`; the UI still shows the generic toast (LoginPage catches and shows the same success copy, so even a client-side validation slip does not leak).
- **`get_user_id_by_email` lookup fault** (permission drift, DB error) → logged, `500 { error:"Internal error" }`; UI shows the generic toast. Not folded into the not-exists `200`, so the outage is diagnosable.
- **`claim_login_link_slot` RPC fault** (missing function after a bad deploy, permission drift, DB error) → logged, `500 { error:"Internal error" }`; UI shows the generic toast. Not folded into the throttled `200` path, so the outage is diagnosable rather than silent.
- **`generateLink` transient failure** → handler `throw` → caught → `500 { error:"Internal error" }`, detail logged; UI shows the generic toast (no detail in the body). The throttle stamp is not "refunded" — the row was already claimed, so the user waits out the 60s before retrying. Acceptable; claiming before the (post-existence) mint is the safer anti-abuse posture.
- **`sendEmail` returns skipped/failed for a suppressed/bounced address (accepted limitation, recovery path named).** A previously bounced or complaint-listed address is on the hard suppression list, so `send-transactional-email` skips it and the handler still returns `200 { ok:true }` (it does not inspect the result, consistent with existence-hiding). That address therefore receives **nothing** while the toast says "a sign-in link is on its way." We do **not** bypass suppression for `magic-link`: sending auth mail to a hard-bounced address risks further reputation damage on the shared Resend domain, and a complaint-listed recipient explicitly asked to stop. The consequence is a documented, accepted limitation: a suppressed address cannot use the passwordless path. It is not a lockout of the account, because **password login remains the fully-functional fallback** — the user can sign in with a password, or use "Forgot password?" (whose branded/unbranded status is unchanged by this design) to set one — and an org admin can re-check the address or the user can contact support to clear a stale suppression. This trade (suppression respected, password fallback named) is deliberate; if the team later decides critical auth links should bypass suppression the way invites arguably do, that is a one-flag change in `send-transactional-email`'s suppression check for the `magic-link`/invite templates, called out as a follow-up, not made here.
- **Throttled** → `200 { ok:true }`, no email; the toast already told the user to check their inbox.
- **`/auth/callback` with an error hash** (expired/used link) → immediate `failed` state (detected synchronously at render, beating the hash strip) + recovery link to `/login`.
- **`/auth/callback` with no token and no error** (direct navigation) → `getSession` finds a session (already-logged-in user) → immediate redirect to `/dashboard`; or no session → 8s watchdog → recovery affordance to `/login`.
- **Already-authenticated user clicks a magic link** → `getSession` resolves immediately → straight to the redirect target. No error.
- **Login link for an accountless-but-orgless user** → authenticates and lands on `NoOrgScreen` via `ProtectedRoute`'s org gate (see §F). Expected, not an error; their route into an org remains the invite link.
- **Re-invite where a live pending invite exists** → `create-invitation` returns 409 before `deliverOrgInvitation` runs (existing behavior); no link minted, no regression.
- **`org-invitation` idempotency** unchanged (`org-invitation-${invite.id}`); the magic-link login email is transactional and un-keyed (each request is a distinct intentional send), matching `account-email-changed`.

## Testing plan (five layers)

**0. Test-harness prerequisite (edge).** The shared fake in `supabase/functions/_shared/testing.ts` currently implements `auth.admin.generateLink` as `(_params: unknown) => Promise.resolve(opts.generateLinkResult ?? …)` and **does not record the call** (unlike `resetPasswordForEmail`, `updateUserById`, and `rpc`, which push into `calls`). The `redirectTo`/`type`/foreign-origin assertions below therefore cannot be written against the harness as-is. Add a task to extend the fake so `generateLink` pushes `{ table: "auth.admin.generateLink", method: "generate", args: [params] }` into `calls` before returning the seeded result (mirroring `resetPasswordForEmail`). All `redirectTo`/`type` assertions then read from that recorded call via the existing `calls` array. This is a one-line harness edit in the shared fake, not a per-test cast, and is a prerequisite for the `send-login-link` and `invitations` edge tests (including the replaced existing-user test). The existence check needs no harness change: the fake already backs `get_user_id_by_email` from the seeded `authUsersByEmail` map (an explicit `rpcs.get_user_id_by_email` seed still wins), so seeding a user by email is enough to make the lookup return an id.

**1. Unit / data (Vitest + jsdom).**
- `src/data/authLinks.test.ts` — `requestLoginLink` calls `functions.invoke("send-login-link", { body:{ email, app_origin } })` against `supabaseFake`; throws on transport error; resolves on `{ error:null }`. (Use `src/test/supabaseFake.ts`, never `vi.mock`.)
- `src/features/auth/resetPassword.test.ts` (extend) — add `/auth/callback` fallback cases: `null`, `"//evil.com"`, `"http://x"` → fallback; `"/accept-invite?token=x"`, `"/dashboard"` → passthrough.
- `AuthCallbackPage` component test with `renderWithProviders` — mock `supabase.auth.getSession`/`onAuthStateChange` to emit `SIGNED_IN`; assert navigation to the validated target; assert `//evil.com` redirects to `/dashboard`. **Hash-race regression:** pre-set `window.location.hash = "#error=access_denied&error_description=..."` before render and assert the recovery state is present on the **first commit** (no timer advance, and without ever emitting `SIGNED_IN`), proving the synchronous `useState` initializer detects the error even though the effect has not run; also assert that when the error hash is set, no `onAuthStateChange` subscription is created (the `if (failed) return` short-circuit). Separately, with neither session nor error hash, assert the 8s watchdog surfaces the recovery link (fake timers).
- **`LoginPage` layout + behavior test** — pins the locked co-equal layout so a regression to the old order or a de-emphasized link fails green:
  - Behavior: clicking "Email me a sign-in link" with an empty email focuses the field and does not call the function; with an email, calls `requestLoginLink` and shows the generic toast; a rejected `requestLoginLink` still shows the same success toast (no enumeration).
  - **Order + prominence:** query both buttons and assert DOM order is `Sign in` first, then `Email me a sign-in link`; assert **both** carry the same `variant="default"` treatment (assert the shared class the `default` variant applies, e.g. `bg-primary`, on both buttons — not one filled and one outline), locking the "same visual weight" decision; assert the "or" divider renders between them.
  - **Forgot-password relocation:** assert the "Forgot password?" link renders **after** both buttons in DOM order (below the co-equal stack), not above the Sign in button as before, locking the deliberate reflow.
- **Email-copy parity — keep `emailCopy.test.ts` green.** No new test file; the existing `"has metadata for every editable default and no orphan metadata field"` test now transitively covers `magic-link`: the eight `magic-link.*` defaults (C3a) must one-for-one match the `EMAIL_TEMPLATE_COPY_FIELDS` block (C3b), and the `"contains no unicode em or en dashes"` test must pass over the new copy. Add a task to run `npx vitest run src/lib/emailTemplates/emailCopy.test.ts` after C3 to confirm the two files agree.
- **Coverage registry — update the pinned assertions in `coverage.test.ts`.** After adding the `magic-link` entry to `EMAIL_TEMPLATE_COVERAGE` (C4, `status:"internal"`): (a) insert `"magic-link"` into the ordered `map(t => t.key)` expectation after `"account-email-changed"` and change the title from "ten live delivery templates plus the external password reset" to "eleven delivered templates plus the external password reset"; (b) the `status === "editable"` list is **unchanged** — magic-link is internal, so the "nine customer email templates" assertion stands; (c) the `"takes opt-out categories"` test needs **no** change (magic-link is absent from `EMAIL_TEMPLATE_CATEGORY`); (d) optionally extend the `"keeps password reset external and cron health internal"` test to also assert `magic-link` is internal. Run `npx vitest run src/lib/emailTemplates/coverage.test.ts` to confirm.

**2. Edge function (Deno test, `handle(req, makeFakeDeps(...))`).**
- `supabase/functions/send-login-link/index.test.ts`:
  - exists + slot allowed → seed `authUsersByEmail` with the email (so `get_user_id_by_email` returns an id) and `rpcs.claim_login_link_slot: true`; mints (`generateLink` seeded) + one `sendEmail` invoke with `template_name:'magic-link'` and `templateData` equal to exactly `{ actionLink }` (assert no `appOrigin` or other stray key); read the recorded `auth.admin.generateLink` call and assert `type:'magiclink'` and `redirectTo` contains `/auth/callback?redirect=%2Fdashboard`.
  - not-exists (`authUsersByEmail` unseeded → `get_user_id_by_email` returns `null`) → `200 { ok:true }`, zero `sendEmail` invokes, and **no** `claim_login_link_slot` call recorded (existence-first ordering).
  - lookup fault → seed `rpcs.get_user_id_by_email` with a populated `error`; assert `500`, body equals `{ error:"Internal error" }`, zero `sendEmail`, and no `claim_login_link_slot` call.
  - throttle blocks the 2nd call → seed the email as existing and `rpcs.claim_login_link_slot` to return `true` then `false`; assert exactly one `sendEmail` invoke across the two calls.
  - throttle RPC fault → seed the `claim_login_link_slot` rpc result with a populated `error`; assert `500`, body `{ error:"Internal error" }`, and zero `sendEmail` invokes.
  - `generateLink` transient failure → seed the email as existing, `claim_login_link_slot: true`, and `generateLinkResult` with a populated `error`; assert `500`, body `{ error:"Internal error" }` (generic, no raw message), and zero `sendEmail`.
  - malformed body / bad email → `400` (no lookup, no mint).
  - foreign `app_origin` (`https://evil.example`) → assert the handler returns `400` and that **no** `generateLink` and **no** `sendEmail` occur (`safeAppOrigin` returns `null` → the `!appOrigin` guard fires). Proves the allowlist rejects spoofed origins.
  - localhost `app_origin` with **production** `APP_URL` → leave `APP_URL` unset so `appUrl(deps.env)` resolves to the prod default, and send `app_origin:'http://localhost:8080'`; assert it is **accepted** and the minted `redirectTo` uses the localhost origin. This is the regression test for the exact failure this design fixes: the local stack (no `APP_URL`) must still mint a localhost redirect.
  - canonical `app_origin` → send `app_origin` equal to `appUrl(deps.env)`; assert accepted and `redirectTo` uses it.
  - missing `app_origin` → assert `400` (guard live), no minting.
- `supabase/functions/_shared/invitations.test.ts` (extend AND replace):
  - net-new (`usersById` empty) → recorded `generateLink` call has `type:'invite'` and `/reset-password?redirect=...` (unchanged; keep the existing test).
  - **Replace** the existing `"existing user → branded email with NO actionLink"` test (line ~28, currently `assertEquals(body.templateData.actionLink, undefined)`), which now asserts the removed behavior. The replacement seeds `usersById` with the email plus a `generateLinkResult`, and asserts: `sendEmail` templateData carries a **non-empty** `actionLink`, and the recorded `generateLink` call has `type:'magiclink'` and a `redirectTo` containing `/auth/callback?redirect=…/accept-invite?token=tok-1`. Leaving the old assertion in place would fail (`undefined` vs a URL), so this is a replacement, not an addition.
- Run the **whole** `supabase/functions/` Deno suite (per the "edge fns have multiple test files" lesson), not just the new file.

**3. Database (pgTAP, `supabase/tests/rls/auth_link_throttle.sql`).**
- `has_table('auth_link_throttle')`, RLS enabled, and no policies exist.
- **Grant-layer denial (as the `authenticated` role, not just its jwt claims).** pgTAP normally executes as the migration/superuser role, which is not subject to the revoked grant, so setting `request.jwt.claims` alone would NOT raise `42501` — the statements would run. To observe the grant-layer denial, downgrade the executing role: wrap each throwing statement with `SET LOCAL ROLE authenticated;` (matching the repo's existing RLS pgTAP tests) and assert `throws_ok($$ ... $$, '42501')` for `SELECT`/`INSERT`/`UPDATE`/`DELETE` on `auth_link_throttle`. Because the migration `revoke all ... from anon, authenticated` strips the table privilege outright, the denial is at the grant layer and independent of RLS, so under `SET LOCAL ROLE authenticated` the outcome is a hard `42501`, never an empty result set. Reset with `RESET ROLE;` after each case.
- `claim_login_link_slot` behavior (call in a superuser/service context): first call for a fresh email returns `true` and inserts; an immediate second call returns `false`; a call after back-dating `last_sent_at` beyond the window returns `true` and re-stamps; a row back-dated beyond the prune horizon (one day, since the test uses the 60s cooldown) is pruned on the next call. **Add a coupling-regression case:** call with `p_cooldown_seconds` set to two days and a row back-dated one day, and assert the row is **not** pruned and the claim returns `false` (still within the >1-day cooldown) — proving the `greatest(interval '1 day', cooldown)` prune horizon protects rows inside a >1-day cooldown.
- `execute` on `claim_login_link_slot` denied to `authenticated`: under `SET LOCAL ROLE authenticated`, `throws_ok(... '42501')`.

**4. End-to-end (Playwright, `e2e/`).**
- On `/login`, assert the two co-equal buttons render in order (`Sign in` then `Email me a sign-in link`) with the same filled treatment, the "or" divider between them, and "Forgot password?" below both. Clicking "Email me a sign-in link" with an email filled POSTs to the `send-login-link` function (intercept the request) and shows the generic toast. Following the emailed link itself is out of reach without a mailbox, so the e2e stops at "request posted + toast shown" (documented as the boundary). The existing reset-password e2e (which relies on the `:8080` redirect allowlist in `config.toml`) is the reference for how far link-follow can be automated locally.

## Rollout / config

- **`supabase/config.toml`** — add:
  ```toml
  [functions.send-login-link]
  verify_jwt = false
  ```
  Omitting this deploys the function with JWT verification forced on, 401-ing every public caller. `deploy-functions.yml` deploys all functions in `supabase/functions/` on merge to `main`; the block is the only manual config step for the new function.
- **Supabase Auth redirect allowlist (production dashboard, not `config.toml`)** — add `https://app.showflow.pro/auth/callback` and confirm `https://app.showflow.pro/reset-password` is present. GoTrue silently falls back to `site_url` for any `redirectTo` not on the allowlist, which would break the minted links. `config.toml`'s `additional_redirect_urls` already covers the `:8080` dev/e2e origins for local stacks; `/auth/callback` is path-matched under those origins, so no local config change is needed.
- **Migration + type regeneration (on the branch, before CI) — no production hand-apply.** Follow the "Migration + type-regen ordering" procedure above: generate the migration, then either (1) `npm run local:reset` + `supabase gen types typescript --local` + `npm run sync:mirrors` (preferred; no prod touch), or (2) the `_shared/rows.ts` cast-at-`.rpc()` fallback (no migration apply needed at all). Commit the migration, `types.ts`, and the regenerated mirror together. The merge to `main` applies the migration to production under the filename's own version. Do **not** MCP-apply to prod solely to green the PR.
- **`npm run sync:mirrors`** — required after editing `src/lib/emailTemplates/emailCopy.ts` (adds the `magic-link.*` keys and the new `EMAIL_TEMPLATE_KEYS` entry) and, on path 1, after regenerating `types.ts`. CI runs `npm run sync:mirrors:check`. Note: `emailTemplateMeta.ts` and `coverage.ts` are frontend-only (NOT mirrored), so they are edited directly — but they must ship in the same commit as the `emailCopy.ts` change to keep `emailCopy.test.ts` and `coverage.test.ts` green.
- **Changelog** — user-facing entry under `### Improved` (branded sign-in link on login) and `### Fixed` (invited users can always set a password from the invite email). Regenerate `public/changelog.json` via the deno script. No super-admin/platform mentions.
- **Verify** — `npm run verify:fast` (lint, typecheck across all three tsconfig projects, build, unit+coverage, Deno) plus `deno check --node-modules-dir=none supabase/functions/send-login-link/index.ts` and the new/edited templates; `npm run verify:full` for pgTAP + e2e against the local stack.

## Open questions

1. **Throttle stamp timing on mint failure.** The design claims the slot before minting (safer against abuse) so a `generateLink` failure still consumes the 60s window. If product prefers "a failed mint shouldn't cost the user their retry," the claim would move to after a successful mint, at the cost of a small burst window. Recommend keeping claim-before-mint unless support sees real friction.
2. **Cooldown length.** 60s is proposed to match the feel of Supabase's own OTP throttle. It is a one-line constant (`COOLDOWN_SECONDS`) and an argument to the RPC; no schema change. The prior hidden coupling — that a >1-day cooldown would be silently defeated by a fixed 1-day prune — is now **removed**: the prune horizon is `greatest(interval '1 day', cooldown)`, so the cooldown can be raised to any value safely, and a pgTAP case pins that. So this is genuinely a free-to-tune constant now.
3. **`app_origin` in `create-invitation`.** This design hardens the *login* origin via `safeAppOrigin` but leaves `create-invitation`'s existing trust of client `app_origin` unchanged (that endpoint is authenticated and org-gated, a narrower surface). Worth deciding separately whether to route invite origins through `safeAppOrigin` too for consistency.
4. **Suppression bypass for critical auth mail.** This design respects the hard suppression list for `magic-link` (a bounced/complaint-listed address gets nothing; password login is the named fallback). If the team decides passwordless sign-in should reach a suppressed address the way an invite arguably should, that is a scoped follow-up: add `magic-link` (and possibly the invite templates) to a suppression-bypass allowlist in `send-transactional-email`'s suppression check. Not made here because it trades email-reputation safety for reach; flagged for a product call.