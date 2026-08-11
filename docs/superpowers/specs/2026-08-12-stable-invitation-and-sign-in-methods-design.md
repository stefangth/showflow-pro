# Stable 30-day invitations and optional passwords — design

Date: 2026-08-12
Branch: `codex/stable-invite-auth-design`

## One-line summary

Make the application invitation—not the short-lived Supabase action link—the authoritative 30-day credential, mint a fresh Auth session only after an explicit click, and let passwordless invitees choose equally between creating a password now or continuing with magic links, with password creation remaining available from Profile.

## Context and root cause

ShowFlow currently has two independent expirations:

- `org_invitations.expires_at`, currently 14 days and enforced by `accept_invitation`.
- The Supabase Auth invite or magic-link action embedded in the email, whose lifetime is much shorter.

The reported invitation was still valid in `org_invitations`, while its emailed Auth link had expired. A newly requested magic link worked immediately. The same account remained passwordless because resend classified any existing Auth row as a completed account, issued a magic link, and bypassed `/reset-password`. Profile then required a current password before setting a new one, which a passwordless account cannot supply.

The faulty assumption is “Auth user exists” equals “user has a password.” These states must be independent.

This design supersedes the invitation-link and Profile-password assumptions in `2026-08-09-invite-password-setup-and-magic-link-design.md`. The branded magic-link login and `/auth/callback` introduced by that design remain valid and in scope for reuse.

## Goals

1. New application invitations remain usable for 30 days.
2. Resending a pending invitation restarts a full 30-day window, including for an expired pending invitation.
3. Email CTAs remain usable for the database invitation’s lifetime instead of inheriting an already-minted Auth-link lifetime.
4. Opening an email must not mint or consume an Auth link until the person explicitly continues.
5. After acceptance, a passwordless user sees two equal choices: **Create a password** and **Continue with magic links**.
6. Adding a password never disables magic-link login.
7. A passwordless user can create a password later from Profile without supplying a nonexistent current password.
8. A password-enabled user can continue changing their password securely from Profile.
9. Auth state remains authoritative; ShowFlow does not maintain a duplicate `has_password` flag.
10. The invitation and Profile experiences meet the approved S-tier interaction and accessibility bar.

## Non-goals

- Removing password or magic-link login from the existing login page.
- Making the two login methods mutually exclusive.
- Adding self-service public signup.
- Adding passkeys, social login, SMS, or MFA in this change.
- Changing organization invitation authorization, role assignment, artist linking, or membership semantics.
- Storing or exposing password hashes outside the narrow boolean lookup described below.
- Reworking unrelated Profile sections.

## Locked product decisions

- The database invitation lifetime is **30 days**.
- Resend renews the window to **30 days from the resend**.
- The organization membership is accepted before optional password setup.
- Passwordless users receive two visually equal, unselected choices.
- The approved UI direction is **A: Calm handoff**—success, context, and choice in one composed card.
- Password setup unfolds inside that handoff rather than becoming a separate wizard step.
- Profile exposes a dedicated **Sign-in & security** surface.
- Supabase Auth is the source of truth for password status.

## End-to-end flow

### 1. Create or resend

The invitation email CTA always points to the stable application URL:

```text
https://app.showflow.pro/accept-invite?token=<invitation-token>
```

No Supabase action URL is embedded in the invitation email. Account provisioning needed by the existing invite-time membership flow may continue server-side, but any action link generated during provisioning is not delivered or treated as the invitation credential.

New invitation rows use `expires_at = now() + interval '30 days'`.

Resend authorizes the actor and confirms `status = 'pending'`, then renews `expires_at` to database `now() + interval '30 days'` before rendering the email. An expired pending invitation is eligible for this explicit renewal. The new date is read back from the row and rendered in the email.

Renewal precedes external delivery so the email can never claim a date the database did not persist. If delivery fails, the invitation remains renewed. This is a safe failure: an older email’s stable link benefits from the extension, while the admin still receives an honest delivery error and `last_resent_at`/`resent_count` are not stamped until delivery succeeds.

Email expiry copy is durable under later resends:

> This invitation is valid until at least {expiresOn}. A newer invitation email may extend that date.

### 2. Stable invitation landing

`AcceptInvitePage` remains the public route for the stable token. When there is no session, it changes from an automatic login redirect to a calm invitation landing state with one explicit **Continue** action.

Rendering the page performs no Auth mutation. This is load-bearing: email scanners and link previews may issue GET requests, so a page view must not mint a new action link.

When the user clicks **Continue**, the frontend invokes a new public Edge Function, `exchange-invitation`, with `{ token, app_origin }`. The function:

1. Validates the origin using the existing `safeAppOrigin` pattern.
2. Resolves the invitation by its high-entropy token.
3. Requires `status = 'pending'` and `expires_at > now()`.
4. Resolves or repairs the invited Auth account using the invitation email.
5. Mints a fresh Supabase action link that redirects through `/auth/callback` and back to the exact `/accept-invite?token=...` route.
6. Returns the action URL to the current browser for immediate navigation.

The function does not send a second email. Possession of the 30-day invitation token is the bearer proof, just as possession of the current emailed invite link is today. The short-lived Auth URL is generated only inside that authenticated-by-token exchange.

On first render, the page captures the token in tab-scoped `sessionStorage` and synchronously removes it from the visible URL with `history.replaceState` before analytics effects run. The exchange callback returns to `/accept-invite` without repeating the token; the page recovers it from the same tab. This keeps the bearer token out of pageview URLs, referrers, screenshots, and routine navigation history. If tab storage is unavailable or lost, the page shows a neutral “reopen your invitation email” recovery state instead of logging or reconstructing the secret.

If the visitor is already signed in, `AcceptInvitePage` skips exchange and follows the existing acceptance path. `accept_invitation` remains authoritative for email matching; a wrong account receives the current **Switch account** remedy and is never silently replaced.

### 3. Authentication callback and acceptance

The existing `/auth/callback` establishes the session and safely navigates back to the invitation URL. `AcceptInvitePage` then invokes the existing `accept_invitation` RPC, refreshes organizations, switches to the joined organization, and renders the accepted state.

If a newly minted Auth URL expires or fails, the callback provides **Return to invitation** when its validated redirect targets `/accept-invite`. The stable token can be exchanged again while the 30-day invitation remains valid; no admin resend is required.

### 4. Optional password choice

After acceptance, the page requests the signed-in user’s authoritative password status.

- `has_password = true`: render the existing accepted-invitation success content and dashboard action. Do not ask an established password user to create another password.
- `has_password = false`: render the approved Calm handoff with two equal, unselected choices:
  - **Create a password** — “Use it whenever you want. Magic-link sign-in will still be available.”
  - **Continue with magic links** — “We’ll email a secure sign-in link whenever you need one.”

Choosing magic links proceeds to the dashboard. Choosing password replaces the two options in the same card with the password form while preserving a compact “Invitation accepted · organization · role” context strip and a **Back to sign-in options** action.

The password form includes:

- Password and confirmation fields.
- Show/hide control.
- Requirements and strength feedback that do not rely on color alone.
- A single **Create password and continue** action.
- Disabled/loading and retry-safe error states.
- The signed-in email for account clarity.

Password failure never rolls back invitation acceptance and never removes the magic-link option.

## Authoritative password status

Add a no-argument RPC such as `public.my_has_password()`:

```sql
create or replace function public.my_has_password()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(u.encrypted_password, '') is not null, false)
  from auth.users u
  where u.id = auth.uid();
$$;

revoke all on function public.my_has_password() from public, anon;
grant execute on function public.my_has_password() to authenticated;
```

The final migration must preserve these security properties even if the exact SQL is adjusted:

- It reads only the row whose id equals `auth.uid()`.
- Anonymous callers cannot execute it.
- It returns one boolean and never returns `encrypted_password`.
- The function has an explicit safe `search_path`.
- pgTAP proves that user A cannot learn user B’s state.

No `has_password` column is added to `profiles`, user metadata, or app metadata. The RPC is queried when the accepted screen or Profile needs it and is invalidated immediately after a successful password update.

## Profile: Sign-in & security

Replace the current generic **Change password** card with an isolated **Sign-in & security** card containing two method rows:

1. **Magic links** — always “Available whenever you sign in,” with an **Active** status.
2. **Password** — state and action derived from `my_has_password()`:
   - Passwordless: “Not set” and **Add password**.
   - Password-enabled: “Password set” and **Change password**.

The card explains that adding a password does not disable magic links.

### First password

For `has_password = false`, Profile uses the same password/confirmation component as onboarding and calls authenticated `auth.updateUser({ password })`. It does not request a current password.

If Supabase requires recent authentication, call `auth.reauthenticate()`, collect the emailed nonce, and retry `updateUser({ password, nonce })`. The user remains on the form with their inputs preserved except where security requires clearing a secret.

### Existing password change

For `has_password = true`, require current, new, and confirmation fields. Replace the current manual `signInWithPassword` verification with the supported `currentPassword` attribute (the installed Supabase JS v2 contract):

```ts
supabase.auth.updateUser({
  password: newPassword,
  currentPassword,
});
```

The repository’s installed `@supabase/supabase-js` version supports this API. It avoids creating a new sign-in session merely to verify the current password. If project policy additionally requires nonce reauthentication for an older session, follow the same explicit nonce step.

## Database and migration design

One migration contains the related database changes:

1. Change `org_invitations.expires_at` default to `now() + interval '30 days'`.
2. Extend only currently unexpired pending invitations created under the shorter rule:

   ```sql
   update public.org_invitations
   set expires_at = greatest(expires_at, created_at + interval '30 days')
   where status = 'pending' and expires_at > now();
   ```

   Already expired invitations are not silently revived by migration. They are revived only by an authorized resend.

3. Add or replace a service-role-only renewal RPC used by `resend-invitation`. It atomically requires a pending row, sets `expires_at = now() + interval '30 days'`, and returns the renewed row/date.
4. Add `my_has_password()` with the restricted grants above.
5. Add an atomic, invitation-scoped exchange cooldown if needed by the final implementation. It must not reuse the login email throttle because a normal login-link request must not block an invitation exchange, or vice versa.

Update `ORG_INVITATION_EXPIRY_DAYS` from 14 to 30. Its application consumer remains preview/sample copy; live email dates always come from the invitation row.

## Edge Function design

### `exchange-invitation`

- `verify_jwt = false` in `supabase/config.toml`; callers do not yet have a session.
- Custom authorization is the invitation token, validated inside the handler.
- Accept only POST and OPTIONS.
- Clamp `app_origin` to the existing trusted-origin allowlist.
- Never log the invitation token or returned action URL.
- Return generic invalid/expired responses that do not disclose the invited email.
- Disable repeat submissions in the client and apply a short per-invitation server cooldown to limit link invalidation abuse.
- A transient failure leaves the invitation row pending and retryable.
- Use the repository’s dependency-injected handler and `makeFakeDeps` patterns.

The returned action link redirects to:

```text
<trusted-origin>/auth/callback?redirect=<encoded /accept-invite?token=...>
```

If the Auth account unexpectedly does not exist, the function may mint an invite-type action link that creates it, but it must still redirect through `/auth/callback`, not force password setup before membership acceptance. The post-accept password choice owns password onboarding for both new and existing passwordless users.

### Existing invite functions

`create-invitation`, `resend-invitation`, and `provision-org` continue ensuring the invited Auth account and membership according to current repository semantics. Their organization invitation delivery passes the stable token URL rather than an Auth action URL.

Remove `isNewUser`-driven email promises such as “asks you to choose a password” versus “signs you in directly.” Every recipient now receives the same truthful CTA explanation: the button opens their ShowFlow invitation, then securely signs them in if needed.

## Error and recovery behavior

- Missing token: explain that the link is incomplete and provide no false retry action.
- Invalid, revoked, or expired token: do not reveal the invited email; direct the user to request an admin resend.
- Exchange throttled: keep the stable page and show when Continue can be retried.
- Auth exchange fault: keep the stable page and offer retry.
- Expired short-lived Auth callback: return to the stable invitation.
- Wrong signed-in email: preserve the existing **Switch account** flow.
- Invitation acceptance failure: do not show the password-method choice.
- Password-status lookup failure: do not guess. Show accepted-invitation success, allow dashboard access, and explain that sign-in settings remain available from Profile.
- Password creation failure: preserve form values where safe, keep membership accepted, and retain a route back to magic links.
- Email delivery failure after resend renewal: report delivery failure to the admin; do not stamp resend metadata, but keep the safe database extension.

## Security and privacy

- Treat the 30-day invitation token as a bearer credential.
- Do not include invitation tokens, action links, emails, or password status in analytics events.
- Capture and scrub the token before consented analytics/pageview effects can observe the route; add a regression test against the Analytics bridge ordering.
- Do not send secrets to PostHog, logs, toast telemetry, or error-reporting payloads.
- Preserve `accept_invitation`’s server-side email equality check as defense in depth.
- The public exchange endpoint performs a single indexed token lookup before any Auth admin call.
- Use service-role credentials only inside Edge Functions; never expose them to the browser.
- Lock every SECURITY DEFINER function down with explicit revokes, grants, caller checks, and a fixed `search_path`.
- Password status is informational UI state for the current account, never an authorization input.

## Approved S-tier UX/UI contract

The approved visual direction is a centered, focused card consistent with ShowFlow’s existing `StageMark`, Tailwind, and shadcn language—not a new visual system.

- A restrained violet progress accent and success icon establish completion without confetti or noise.
- “Invitation accepted” appears before organization and role context.
- Both initial method choices use identical card size, border, spacing, icon treatment, typography, and interaction weight.
- Neither choice is preselected or visually primary.
- Copy says **Create a password** and **Use magic links**, while making “for now” and “no lock-in” clear.
- The password form transitions within the same shell; reduced-motion users receive an instantaneous state change.
- Keyboard navigation, visible focus, 44px minimum targets, screen-reader labels, semantic status announcements, and mobile stacking are required.
- Loading states preserve layout to avoid jumps.
- Errors appear next to the affected action and in an accessible summary when submission fails.
- Profile uses concise method rows and status badges, not two unrelated password forms.
- Dark mode and narrow mobile widths receive explicit visual verification.

## Testing

### pgTAP

- New invitation default is 30 days.
- Migration extends unexpired pending rows but not expired, accepted, or revoked rows.
- Renewal resets a pending row to 30 days from database time.
- Renewal can revive an expired pending row.
- Renewal rejects accepted and revoked rows.
- Renewal is callable only by the service role path intended by the application.
- `my_has_password()` returns false for passwordless self and true for password-enabled self.
- Anonymous access and cross-user inspection are impossible.

### Deno / Edge Function

- OPTIONS and malformed payload handling.
- Foreign origin rejection.
- Valid pending token produces a fresh action link with the exact safe callback redirect.
- Expired, revoked, accepted, and unknown tokens do not mint links.
- Existing and unexpectedly missing Auth-account paths.
- Cooldown/double-submit behavior.
- Tokens and action URLs are absent from logged error objects.
- Resend renews before rendering, renders the renewed date, and stamps resend metadata only after confirmed delivery.
- Delivery failure leaves the renewed expiry but not a successful resend stamp.

### Vitest

- Rendering the stable invitation page does not call exchange.
- Continue calls exchange once and navigates to its returned action URL.
- Signed-in invited user bypasses exchange.
- Wrong-account recovery remains intact.
- Password-enabled accepted user skips the choice.
- Passwordless accepted user sees two equal, unselected actions.
- Magic-link choice reaches the dashboard.
- Password choice opens the inline form, Back restores choices, and successful creation reaches the dashboard.
- Validation, loading, retry, reauthentication, and password-status failure states.
- Profile renders **Add password** without current password for passwordless users.
- Profile renders **Change password** with current password for password-enabled users.
- Successful password creation invalidates/refetches status.
- Invitation email CTA is always the stable app URL and its copy no longer branches on `isNewUser`.

### Playwright

- Create invite → open stable URL → explicit Continue → accept → continue with magic links → dashboard.
- Create invite → accept → create password → sign out → sign in with that password.
- Accept with magic links → Profile → add password → sign out → password sign-in.
- Advance or set invitation timestamps to prove a delayed but unexpired 30-day link works.
- Prove an expired pending invitation fails, then admin resend revives it for a fresh 30-day window.
- Visual checks at desktop, mobile, dark mode, keyboard-only, and reduced motion.

### Repository verification

Run the complete `CLAUDE.md` verification contract, including:

- Focused Vitest and Deno tests during development.
- `npm run verify:fast`.
- `npm run verify:full` with the local Supabase stack.
- Generated type and mirror checks after migrations/template changes.

## Rollout

1. Land the migration, new function/config entry, shared invite changes, frontend, and tests in one PR.
2. The production Edge Function deployment remains gated until production records the migration, matching `.github/workflows/deploy-functions.yml`.
3. Verify the local flow against Mailpit and the local Supabase stack before merge.
4. After production deploy, run one controlled invitation through both access choices and confirm Auth, membership, expiry, and email-delivery logs without recording secret URLs.
5. Monitor generic exchange failures, invitation acceptance failures, and password-update errors. Never log their credentials.
6. Add a customer-facing **Fixed** entry to `public/changelog.md` and regenerate `public/changelog.json`; do not bump the application version unless this change is included in a release boundary.

## Rejected alternatives

### Put a 30-day Supabase Auth URL directly in the email

Supabase action-link lifetime is intentionally shorter and cannot represent the application’s 30-day invitation contract. It also recreates the scanner problem.

### Send a second magic-link email after opening the invitation

This is secure but adds avoidable inbox friction. The emailed invitation token already proves possession; exchanging it directly for a fresh, immediate action link gives the same ownership boundary with a smoother experience.

### Store `has_password` in `profiles`

It can drift after recovery, admin changes, or any password operation outside the mirrored write path. Auth must remain authoritative.

### Show password setup to every invitee

This avoids status detection but annoys established users and violates the approved requirement to ask only passwordless accounts.

### Accept only after password choice

A password or reauthentication failure would once again block the organization invitation. Membership acceptance and optional account-method setup must remain separate.

## Resolved decisions

- Invitation lifetime: 30 days. *(owner)*
- Resend lifetime: restart 30 days from the authorized resend request; renewal is persisted before delivery and remains if delivery fails. *(owner + failure-safety refinement)*
- Existing migration behavior: extend only still-valid pending invitations; revive expired ones only on resend. *(owner)*
- Account-method choice: equal, unselected options after membership acceptance. *(owner)*
- UI direction: Calm handoff with inline password setup and dedicated Profile security card. *(owner, visual approval)*
- Password source of truth: Supabase Auth through a self-only boolean RPC. *(owner)*
- Magic links remain available after adding a password. *(owner requirement clarified in approved UI)*

## Current Supabase references

- [Password-based Auth](https://supabase.com/docs/guides/auth/passwords) — authenticated password updates and the Supabase JS v2 `currentPassword` property.
- [Password security](https://supabase.com/docs/guides/auth/password-security) — recent-session and nonce reauthentication behavior.
- [`updateUser`](https://supabase.com/docs/reference/javascript/auth-updateuser) — authenticated password and nonce update contract.
