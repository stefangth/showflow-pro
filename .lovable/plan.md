

## Plan: Admin-approved signup + Google OAuth + IAM approval flow

### 1. Approval data model

New table `user_approvals` (RLS-enabled):

- `id`, `user_id` (uuid, unique, references `auth.users.id` logically), `email` (text), `display_name` (text), `status` (enum: `pending` / `approved` / `rejected`), `requested_role` (`app_role`, default `artist`), `decided_by` (uuid, nullable), `decided_at` (timestamptz, nullable), `rejection_reason` (text, nullable), `created_at`, `updated_at`.

Policies:
- `SELECT`: self (`user_id = auth.uid()`) OR admin via `has_role`.
- `INSERT`: only via the post-signup edge function (service role) — no client policy.
- `UPDATE`: admin only.

Trigger: replace `handle_new_user()` so that on `auth.users` insert it ALSO inserts a `user_approvals` row with `status = 'pending'` and does NOT insert into `user_roles`. The existing `profiles` insert continues. Roles are granted only when an admin approves.

Bootstrap: a one-time SQL migration that auto-approves and grants `admin` to the first user whose email matches a developer seed (kept manual — admin can also self-promote via the existing IAM `admin-set-role` function once the bootstrap admin exists).

### 2. Auth flow changes

- **Google OAuth** (Supabase URLs already configured by the user, site URL = `showflow.pro`, redirect path `/oauth/consent`):
  - `LoginPage` keeps the existing Google button. After Google returns and the new `auth.users` row is created, the `handle_new_user` trigger writes a `user_approvals` row with `status = 'pending'`.
- **Email/password login** kept; signup remains removed (already done in the previous loop).
- New gate component `ApprovalGate` wraps `ProtectedRoute`:
  - On every authenticated session it queries `user_approvals` for the current user.
  - `pending` → render `PendingApprovalScreen` ("Your signup is being reviewed. We'll email you when an admin approves your account."), with a sign-out button. No app routes accessible.
  - `rejected` → render `RejectedScreen` with the reason and sign-out button.
  - `approved` → normal app access.
  - If the row is missing (legacy users created before this change), treat as approved to avoid lockout.

### 3. Admin notification email

- New transactional flow using Lovable's built-in email infrastructure (per project rules):
  1. `email_domain--check_email_domain_status` → if no domain, prompt the user to set up an email sender domain (`<lov-open-email-setup>`). This is a prerequisite.
  2. Once domain exists, run `email_domain--setup_email_infra` and `email_domain--scaffold_transactional_email`.
  3. Add two React Email templates in `supabase/functions/_shared/transactional-email-templates/`:
     - `new-signup-admin-notification.tsx` — sent to all admins. Includes signup name, email, requested role, and a link to `https://showflow.pro/admin?tab=approvals`.
     - `signup-decision.tsx` — sent to the signed-up user when an admin approves or rejects them (subject + body switch based on `decision` prop).
- New edge function `notify-signup` (service role, `verify_jwt = false`, called by a database webhook on `user_approvals` insert):
  - Looks up admin user emails via service role and `auth.admin.listUsers()` filtered against `user_roles` rows where `role = 'admin'`.
  - For each admin, invokes `send-transactional-email` with `templateName: 'new-signup-admin-notification'` and an `idempotencyKey` of `signup-${user_approvals.id}-${admin.id}`.
- `admin-set-role` is extended (or paired with a new `admin-decide-approval` function) so when an admin approves/rejects:
  - Updates `user_approvals` (status, `decided_by`, `decided_at`, `rejection_reason`).
  - On approve: inserts the chosen role into `user_roles`.
  - On reject: leaves `user_roles` empty.
  - Invokes `send-transactional-email` with `templateName: 'signup-decision'`, `idempotencyKey: approval-${user_approvals.id}-${status}`, `templateData: { decision, reason, displayName }`.

### 4. IAM view updates (`AdminPage`)

Add a new tab "Approvals" (default tab when there are pending requests) alongside the existing Users / Audit / Sync tabs.

- **Approvals tab**: lists `user_approvals` where `status = 'pending'`. Each row shows email, display name, requested at (`DD/MM/YYYY HH:mm`), role selector (default `artist`, choices `artist | producer | admin`), and two buttons: **Approve** and **Reject** (Reject opens a small dialog asking for a reason). Buttons call `admin-decide-approval`.
- **Users tab**: extend the existing IAM table with a status badge column (`Pending` / `Approved` / `Rejected`) joined from `user_approvals`. Rejected/pending users still appear so admins can change their mind; approving from here works the same as the Approvals tab.
- Realtime: subscribe to `user_approvals` so the badge / pending count updates without refresh.
- A small badge on the Approvals tab trigger shows the pending count.

### 5. Files to create / edit

```text
NEW:
  supabase/functions/notify-signup/index.ts
  supabase/functions/admin-decide-approval/index.ts
  supabase/functions/_shared/transactional-email-templates/new-signup-admin-notification.tsx
  supabase/functions/_shared/transactional-email-templates/signup-decision.tsx
  src/features/auth/ApprovalGate.tsx
  src/pages/PendingApprovalScreen.tsx
  src/pages/RejectedScreen.tsx
  src/components/admin/ApprovalsTab.tsx
  supabase/migrations/<ts>_user_approvals.sql

EDIT:
  src/features/auth/AuthContext.tsx                 (expose approval status)
  src/features/auth/ProtectedRoute.tsx              (delegate to ApprovalGate)
  src/App.tsx                                       (mount ApprovalGate)
  src/pages/AdminPage.tsx                           (new Approvals tab + status column)
  src/pages/LoginPage.tsx                           (info copy under Google button)
  supabase/functions/_shared/transactional-email-templates/registry.ts
                                                    (register the two new templates)
```

### 6. Webhook wiring

- One DB webhook (configured via the migration tool's webhook helper) on `user_approvals` `INSERT` → POST to `notify-signup`. If automated webhook config isn't possible from the migration, the edge function will alternatively be invoked from the `handle_new_user` trigger via `pg_net` (preferred fallback — keeps everything in SQL).

### 7. Out of scope

- No bulk approve/reject.
- No expiring approval requests / auto-cleanup of rejected rows.
- No CAPTCHA on signup (Google OAuth is the only entry path; email/password signup is already removed).
- No per-admin notification preferences — every admin gets every signup email until we add a settings toggle.
- No re-application after rejection — admin must manually clear the row in Supabase to let the user retry. Will revisit if needed.
- The four Supabase OAuth endpoint URLs you shared are already what `supabase-js` uses under the hood — no extra config needed in the client. They're noted for reference only.

