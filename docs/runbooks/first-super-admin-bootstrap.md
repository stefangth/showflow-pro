# Runbook — Bootstrapping the first super-admin

> **When you need this:** exactly once per environment (production, staging, a fresh
> demo/test copy). It is the **only** setup step that touches the Supabase dashboard + SQL
> editor. Everything after it — creating organizations, inviting their first admin, adding
> more super-admins — happens in-app via the Platform console.

## Why a manual step exists

Showflow Pro is **invite-only**, and access is gated on organization membership with a
super-admin (`platform_admins`) tier that runs the Platform console. The console — and the
`add_platform_admin` RPC behind it — are themselves super-admin-gated (`is_super_admin`), so
a brand-new database has no way to *promote* its first super-admin from inside the app. It's
a locked door with the key on the inside. This runbook breaks that deadlock; once one
super-admin exists, the deadlock is gone for good.

## Prerequisites

- Access to the project's **Supabase dashboard** (Authentication + SQL editor).
- The email address that should own the platform.

## Steps

### 1. Create the auth user

Supabase dashboard → **Authentication → Users → Add user**.

- Enter the owner's email and a password (or use **Invite** to email a magic link).
- This creates the row in `auth.users`. No role or membership is attached yet.

### 2. Promote that user to super-admin

Supabase dashboard → **SQL editor** → run (replace the email):

```sql
insert into public.platform_admins (user_id)
select id from auth.users
where lower(email) = lower('owner@example.com')
on conflict (user_id) do nothing;
```

The `select … from auth.users` resolves the email to its UUID for you, so there's no UUID to
copy by hand. `on conflict do nothing` makes the statement safe to re-run.

### 3. Verify

```sql
select u.email, pa.created_at
from public.platform_admins pa
join auth.users u on u.id = pa.user_id;
```

You should see exactly the email you just added.

### 4. Log in and take over from the console

Sign in to the app with that account. As a super-admin you bypass the org gate and land in
the **Platform console** (`/platform`). From here, everything is in-app — no more SQL:

- **Organizations → New organization** — creates an org, seeds its starter catalog, and
  emails its first admin an `/accept-invite` link. If the email ever fails to arrive, use the
  per-invite **Resend** / copy-link controls in the org's invite popover.
- **Platform Admins → Add** — add further super-admins by email.

## Guardrails (already enforced in the database)

- `remove_platform_admin` refuses to remove the **last** super-admin and refuses
  self-removal, so you can't accidentally lock the platform out.
- The Step-2 insert is the only path that bypasses `is_super_admin`; it requires direct
  database access, which only a project owner has.

## Recovery

Lost access to every super-admin account? Re-run **Step 2** with a fresh or owned email to
mint a new super-admin, then sign in and prune the stale ones from **Platform → Platform
Admins**.
