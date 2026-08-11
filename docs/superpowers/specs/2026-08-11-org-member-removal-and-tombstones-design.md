# Org-member removal: fix super-admin failure + S-tier /admin/people removal — design

Date: 2026-08-11
Branch: `claude/super-admin-user-removal-0aa3f1`

## One-line summary

Fix the super-admin "Remove from org" that dies with a generic "Something went wrong" (a masked PostgREST error hiding the last-admin guard), and rebuild org-member removal in **Admin → People** as a two-tier flow: a reversible soft-remove that leaves a "Recently removed" tombstone (with **Undo** and **Clear**), where **Clear** dismisses the tombstone — or, only when this is the user's last organization, fully deletes the account.

## Context & problem

### 1. The reported bug — super-admin removal shows "Something went wrong"

In **Platform → Users**, a super-admin removes a user from an org via `handleRemoveFromOrg` (`src/components/platform/UserDetailSheet.tsx:141`), which calls `removeMembership` → the `platform_remove_membership` RPC. The RPC is correct and deployed; verified against prod:

- Function body matches migration `20260723003308_platform_membership_rpcs.sql` (`is_super_admin` guard, last-admin guard, delete, audit insert).
- No `BEFORE DELETE` triggers on `org_memberships`; no FK references it (nothing RESTRICTs the delete).
- `is_super_admin('e35dc5e3-…')` (showflowpro@gmail.com) returns `true`.

The RPC's **only** raise path — given a super-admin caller — is the last-admin guard: `raise exception 'org must keep at least one admin'`. Every prod org has exactly one admin (Bootstrap Org, Fever, TERBE 73), so removing any org's admin is (correctly) refused. Removing a *non-admin* member succeeds.

The reason the user sees gibberish instead of that message is a masking bug in the drawer's error formatter:

```ts
// src/components/platform/UserDetailSheet.tsx:45
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}
```

supabase-js returns a failed `.rpc()` error as a **plain object** `{ code, message, details, hint }`, not an `Error` instance (postgrest-js `2.105.4`: on the non-throwing default path the returned `error` is `JSON.parse(body)`; the `PostgrestError` class that *does* extend `Error` is only constructed when `shouldThrowOnError` is set). The data layer does `if (error) throw error`, so a plain object propagates to `onError`. `e instanceof Error` is `false`, so **every** failure collapses to `"Something went wrong"`. The same `errorMessage` masks the drawer's role-change, add-to-org, link-artist, email-change, and delete paths too.

The `/admin/people` tab dodges this by reading `(e as Error).message` directly (`PeopleTab.tsx:196`) — a no-op TS cast that at runtime reads `.message` off the plain object. That accidental correctness is what we make deliberate and shared.

### 2. The feature gap — removal in /admin/people is a trapdoor

Today `remove_org_member` (`20260604160000_org_member_management.sql`) hard-deletes the membership and the person simply vanishes from the list. There is no audit trace of who was removed or when, no undo, and no path to fully delete a departed user's account from the org surface. The owner wants removal to be reversible, to leave a visible "Removed · <date>" record, and to optionally erase the account — mirroring, in intent, the deliberate "Account deleted + timestamp then clear" idea. No such tombstone exists anywhere today (confirmed: no `"Account deleted"` string in `src/`; `anonymize_user` hard-deletes `org_memberships`/`profiles` and renames artists to `"Deleted artist"`, and a deleted user disappears from the platform list entirely).

## Goals

1. Super-admin (and every other) failure in `UserDetailSheet` shows the **real** reason; the last-admin block reads as guidance ("make someone else an admin first"), not an error.
2. Org-admin removal in **Admin → People** is a two-tier flow:
   - **Remove** — reversible soft-remove; keeps the account, artist profile, and bookings; leaves a tombstone.
   - **Undo** — restores the membership with its original roles.
   - **Clear from list** — dismisses the tombstone; account untouched. Shown when the user still belongs to other orgs.
   - **Delete account** — full anonymize + auth-delete, offered **only** when this org is the user's last membership and they are not the sole admin of any other org. Typed-email confirm.
3. Removal never widens who can be erased: an org admin can never delete a user who is active in another org.
4. Zero change to any RLS access predicate — removal still hard-deletes the membership row.

## Non-goals

- No change to the super-admin cross-org **Delete user** danger-zone in `UserDetailSheet` (it already anonymizes + auth-deletes globally, which is correct for a super-admin).
- No tombstones in **Platform → Users** — it gets the error-surfacing fix + last-admin guidance only. Symmetry can follow later if wanted.
- No soft-delete column on `org_memberships` (rejected — see below).
- No new per-org capability toggle for deletion; the `admin` role bar that already governs Remove governs Delete account too.
- No change to the booking/artist data of a removed-but-not-deleted user.

## Design

### Data model — one new tombstone table (rejected alternative: soft-delete column)

**Chosen: a separate `org_member_removals` tombstone table.** Removal keeps hard-deleting the membership, so `is_org_member`, `has_org_role`, and every RLS policy built on them stay byte-for-byte unchanged. The tombstone is purely presentational + audit and carries everything Undo needs.

```sql
create table public.org_member_removals (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  email        text,                      -- snapshot for display
  display_name text,                      -- snapshot for display
  roles        app_role[] not null,       -- snapshot for Undo + ghost badges
  removed_at   timestamptz not null default now(),
  removed_by   uuid,                       -- actor (auth.uid())
  primary key (org_id, user_id)
);
alter table public.org_member_removals enable row level security;
-- org admins (and super-admins, via has_org_role) read/write their org's tombstones.
-- One `for all` policy covers select/insert/update/delete.
create policy "org admins manage removals" on public.org_member_removals for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin'))
  with check (public.has_org_role(auth.uid(), org_id, 'admin'));
-- RESTRICTIVE pooled-tenancy isolation, matching every other tenant table (ADR-0003)
create policy "org_isolation" on public.org_member_removals as restrictive to authenticated
  using (public.is_org_member(auth.uid(), org_id)) with check (public.is_org_member(auth.uid(), org_id));
create index org_member_removals_org_idx on public.org_member_removals (org_id, removed_at desc);
```

`on delete cascade` on `user_id` means a full account delete (which removes the `auth.users` row) also cleans up its tombstone automatically. The direct RLS policies are additive; the tombstone table is only ever mutated through the SECURITY DEFINER RPCs below (and read by the list RPC), so the policies are a defense-in-depth floor.

**Rejected — `org_memberships.removed_at` soft-delete.** It would force `is_org_member`/`has_org_role` and every policy and query that reads memberships to learn `removed_at IS NULL`. That is a large, error-prone sweep across the whole app for a purely presentational feature, and any missed site becomes a security hole (a "removed" user still counted as a member). The tombstone table isolates the new concept completely.

### Server-side flows

All four are `security definer set search_path = public`, org-admin-guarded (`has_org_role(auth.uid(), p_org, 'admin')`, which also accepts super-admins).

1. **`remove_org_member(p_org, p_user)`** — *modify existing.* Keep the three guards (admin-only, not self, not last admin). Then, in the same transaction: snapshot the user's roles + `email` (from `auth.users`) + `display_name` (from `profiles`), delete the memberships, and `insert ... on conflict (org_id, user_id) do update` the tombstone (`removed_at = now()`, `removed_by = auth.uid()`). Snapshot **before** delete.

2. **`restore_org_member(p_org, p_user)`** — *new.* Read the tombstone; re-insert `org_memberships(org_id, user_id, role)` for each snapshot role (`on conflict do nothing`); delete the tombstone. Refuse (no-op with a clear raise) if no tombstone exists or the `auth.users` row is gone.

3. **`clear_removed_member(p_org, p_user)`** — *new.* Delete the tombstone row only. No account impact. This backs **Clear from list**.

4. **Full delete — edge function `org-purge-removed-user`** (`verify_jwt = true`; `requireOrgRole(org_id, ['admin'])` from `_shared/auth.ts`). Auth-account deletion needs the admin API, so it cannot be a pure RPC. Steps, all fail-closed:
   - Require a tombstone exists for `(org_id, user_id)` (you can only purge someone already removed).
   - **Safe-scope gate:** the target has **no** `org_memberships` in any org (they were removed from their last one) **and** `sole_admin_orgs(user_id)` is empty. If not satisfied → return `{ retained: true, reason }` and do nothing destructive; the UI treats this exactly like Clear-from-list.
   - Run the anonymization (reuse the `anonymize_user` logic; because that RPC's own guard is `auth.uid() = target OR is_super_admin`, add a sibling SECURITY DEFINER RPC `admin_anonymize_removed_user(p_org, p_user)` that re-checks org-admin + the safe-scope gate and performs the same statements — do **not** loosen `anonymize_user`).
   - `auth.admin.deleteUser(user_id)` via the service-role client. The `on delete cascade` clears the tombstone.
   - Purge is a rare, fully-gated action. Do **not** invent a new audit table for it: the `org_member_removals` tombstone already records who removed the user and when (the removal that must precede any purge), and the edge runtime logs the call. If the owner later wants a durable org-admin audit trail, add it as its own change.

`sole_admin_orgs` (already exists, `20260622193223_anonymize_user.sql`) is the exact primitive for "not the last admin anywhere."

### Read path — the People list learns tombstones + a `deletable` flag

`list_org_members` stays as-is (active members only). Add a sibling read the People tab consumes:

- **`list_removed_members(p_org)`** — *new, admin-guarded* — returns `user_id, email, display_name, roles, removed_at, removed_by_name`, plus a computed **`deletable boolean`**: `true` when the user has no other `org_memberships` anywhere and `sole_admin_orgs(user_id)` is empty. `deletable` is what flips the row's action between **Clear from list** and **Delete account**, so the button never guesses and the edge function's gate is the authority the button mirrors.

Data-access lives in `src/data/members.ts` (`fetchRemovedMembers`, `restoreOrgMember`, `clearRemovedMember`, `purgeRemovedUser`); hooks in `src/hooks/useOrgMembers.ts` (`useRemovedMembers`, `useRestoreOrgMember`, `useClearRemovedMember`, `usePurgeRemovedUser`), each invalidating `["org-members", orgId]` and `["removed-members", orgId]`.

### Shared error helper — `src/lib/errors.ts`

```ts
export function toErrorMessage(e: unknown, fallback = "Something went wrong"): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}
```

Plus a thin `friendlyError(e)` that maps the two known guard strings to guidance copy:
- `org must keep at least one admin` / `Cannot remove the last admin of the organization` → *"{org} needs at least one admin. Make someone else an admin first, then remove this one."*
- everything else → `toErrorMessage(e)`.

Replace `errorMessage` in `UserDetailSheet.tsx` with `friendlyError`; adopt `toErrorMessage` in `PeopleTab.tsx` (replacing the `(e as Error).message` casts) for consistency. Unit-tested against a synthetic PostgREST-shaped plain object so the masking regression can never return.

### UI — Admin → People (`PeopleTab.tsx` + `PersonRow.tsx`)

- A third subgroup **"Recently removed · N"** using the existing `PeopleGroup` pattern, below Pending invites and Members, fed by `useRemovedMembers`. Search scopes it like the others.
- **Tombstone row** (a dimmed `PersonRow` variant, or a small `RemovedPersonRow`): dashed muted avatar (`ti-user-off`), name/email in `--text-secondary`/`--text-muted`, meta `Removed <date> · by <name>`, a `was <Role>` ghost badge, and actions:
  - **Undo** (`ti-arrow-back-up`) → `useRestoreOrgMember`.
  - Adaptive **Clear**: `deletable === false` → **Clear from list** (neutral) → `useClearRemovedMember`, with hint `in N other orgs · account kept`; `deletable === true` → **Delete account** (`--text-danger`) opening a typed-email confirm → `usePurgeRemovedUser`, with hint `last organization · fully erasable`.
- **Remove confirm** (existing dialog, revised copy): "Remove {name} from {org}? They lose access to this organization now. Their account, artist profile, and bookings are kept, and you can undo this from the list." On success: toast `Member removed` with an inline **Undo** action (calls restore), in addition to the persistent row Undo.
- **Delete-account confirm**: destructive dialog, typed-email match required (mirrors the platform delete pattern), body naming that this is the user's only org and the delete is global + irreversible.

The two approved mockups (`admin_people_removal_stier_mockup`, `removal_dialogs_and_platform_fix`) are the visual spec.

### UI — Platform → Users (`UserDetailSheet.tsx`)

- Swap `errorMessage` → `friendlyError` (surfaces real reasons; guides the last-admin case).
- Disable the only-admin's **Remove from org** button with the same inline reason (compute from the membership set already in the drawer), so the block is understood before it's attempted. Role-swap away from the last admin stays allowed only if it isn't the last admin — reuse the same predicate.

## Testing

- **pgTAP** (`supabase/tests/`): `remove_org_member` writes a tombstone + snapshots roles; last-admin/self guards still raise; `restore_org_member` round-trips membership+roles and deletes the tombstone; `clear_removed_member` removes only the tombstone; cross-org isolation (admin of org A can't touch org B's tombstones); `list_removed_members.deletable` is correct for last-org vs multi-org vs sole-admin-elsewhere.
- **Deno** (`supabase/functions/org-purge-removed-user/`): safe-scope gate refuses when the target has another membership or is a sole admin elsewhere (returns `retained`); performs anonymize + deleteUser only when clean; org-admin auth required; feature/DI via `makeFakeDeps`.
- **Vitest**: `toErrorMessage`/`friendlyError` against Error, plain PostgREST object, and null; `PeopleTab` renders the Recently-removed group, adaptive Clear label by `deletable`, and Undo; data-access functions via `supabaseFake`.

## Migration & rollout

- One migration: `create table org_member_removals` + policies + `list_removed_members`, `restore_org_member`, `clear_removed_member`, `admin_anonymize_removed_user`, and the `remove_org_member` replacement (all `create or replace`).
- New edge function `org-purge-removed-user` needs a `[functions.org-purge-removed-user]` block in `supabase/config.toml` (`verify_jwt = true`).
- Regenerate types (`supabase gen types` → `npm run sync:mirrors`) for the new table/RPCs; `deno check` the new function.
- No data backfill (tombstones accrue from first use). Migrations auto-apply on merge — do not hand-apply.
- No changelog/version bump unless the owner asks (super-admin/platform-admin actions are out of scope for the public changelog; the /admin/people member-removal UX is customer-facing and may warrant an "Improved" bullet — confirm with the owner at ship time).

## Resolved decisions

- Removal model: **two-tier** (remove → optional purge). *(owner)*
- Clear scope: **safe-scoped** — full delete only when this is the user's last org; otherwise Clear dismisses the tombstone. *(owner)*
- Tombstones persist until cleared (no auto-expiry); immediate Undo toast **and** persistent row Undo; Platform → Users gets the fix + guidance, not tombstones; full-delete gated by the `admin` role (no new capability). *(defaults, owner-approved)*
