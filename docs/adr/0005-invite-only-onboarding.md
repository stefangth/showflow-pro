# ADR-0005: Invite-only onboarding; retire signup → approval queue

**Status:** Accepted
**Date:** 2026-06-03 *(invite unification 2026-06-04). Recorded retroactively 2026-06-16.*
**Deciders:** Stefan Schaal (platform owner)

## Context

Onboarding was public signup → a global approval queue (`user_approvals`, `ApprovalGate`,
`admin-decide-approval`, `notify-signup`). Multi-tenancy reframes onboarding as *access **is**
membership*: a person belongs to Showflow only by being a member of an org. Greenfield, so the
approval subsystem was dropped rather than migrated.

## Decision

- **`org_invitations`** `(org_id, email, role, token unique, status pending|accepted|revoked,
  invited_by, expires_at)`.
- **`create-invitation` edge function** — `requireOrgRole(org_id,'admin')` → insert invitation →
  best-effort send the branded `org-invitation` email (`/accept-invite?token=…`); a send failure
  does not fail the request.
- **`accept_invitation(p_token)` SECURITY DEFINER RPC** — the invitee redeems the token: validates
  `pending` + not expired (`FOR UPDATE`), checks the token email matches `auth.users.email`, inserts
  the `org_memberships` row, **claims** any unclaimed producer-created `artists` row for that email,
  and marks the invite accepted. *"Membership cannot be self-granted by a client insert."*
- **`ProtectedRoute` org gate** — no active org → `NoOrgScreen` ("ask an admin for an invite");
  suspended org → `SuspendedOrgScreen`. Plus a sidebar `OrgSwitcher` and the Admin **Invites** tab.
- **Retire the approval flow** — `handle_new_user` becomes profile-only; drop `decide_user_approval`,
  `user_approvals`, the `approval_status` enum, and the `admin-decide-approval` / `notify-signup`
  edge functions, with their tests.
- **Invite unification (Phase 5)** — a shared `deliverOrgInvitation`: net-new invitees get a Supabase
  `generateLink({ type:'invite', redirectTo: /reset-password?redirect=<…/accept-invite?token=…> })`
  embedded as the action link in the *branded* email; existing users get the plain accept link. All
  three callers (`provision-org`, `create-invitation`, `resend-invitation`) converge.

## Options Considered

The core onboarding choice (invite-only vs. alternatives) was a locked owner decision — **not
documented** as a comparison. The Phase-5 unification *did* record a rejected alternative: copying
`inviteUserByEmail` into `create-invitation` — *"Least code, but it does **not** unify: Supabase's
unbranded native invite email coexists with the branded one … Fails the 'unify' goal."*

## Trade-off Analysis

Invite-only removes an entire operational subsystem (the approval queue) and makes membership the
single gate, at the cost of an interim window during the staged migration where fresh public signups
had no path (expected and intentional).

## Consequences

- **Easier:** no approval queue to operate; access == membership; org provisioning is one atomic
  flow (`provision_org`).
- **Harder / accepted:** an interim window — *"⚠️ Between this and Stage 1C, fresh signups have no
  onboarding path (expected, invite-only)"* — later closed for first-admins by `provision-org` and
  for all invitees by the Phase-5 `generateLink` unification.
- **Risk noted:** the net-new invite link carries the session in the URL hash, so `/reset-password`
  must distinguish recovery from invite arrivals — covered by an e2e net-new-invite test.

## Implementation (delivered)

Migrations `20260603130000_accept_invitation_rpc.sql`, `20260603140000_retire_approval_flow.sql`.
Spec `2026-06-03-multi-tenancy-design.md` §§4.4, 6, 8; `2026-06-04-multi-tenancy-phase-5-self-
service-design.md` §§1, 5, 12. PRs #79, #81, #82, #83, #84, #94, #95.
