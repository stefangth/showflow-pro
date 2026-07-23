# Per-Org Capability Flags — Design

**Date:** 2026-07-23
**Status:** Approved (user pre-approved spec + plan)
**Branch:** `claude/org-capability-flags` (separate PR, off `main` @ 84c872e)
**Sibling sub-project of:** Platform IAM. The user-management console shipped as PR #186. This is the second half of the original request: *"a settings page where superadmins can enable/disable flags for user rights (e.g. creating an invite) on a per-org basis."*

---

## 1. Problem & goal

### 1.1 The gap

Roles in Showflow are fixed: an **admin** can invite people into the org; a **producer** cannot. Some organizations want producers to be able to invite artists (their day-to-day collaborators) without granting full admin. Today that is impossible without promoting the producer to admin, which also hands them member management, settings, billing surfaces, and the ability to invite *other admins* — far more than "let them add an artist."

There is no super-admin surface to grant a *narrow, per-org* permission like this.

### 1.2 What we are building

A **per-org capability-flags** system: named permission grants a super-admin toggles per organization, orthogonal to module entitlements (`org_entitlements`, which gate whole *features*) and to the editor's table-permission overrides. Capabilities gate **who may do an action**, not **whether a module exists**.

The system ships with exactly **one** flag:

- **`producer_can_invite`** (default **off**) — when on, producers in that org may invite **artists** to the app.

The registry is built so a second flag is a few lines, but we ship one real, wired flag end-to-end rather than speculative scaffolding (YAGNI).

### 1.3 Explicit non-goals

- **No per-user overrides.** Capabilities are per-org only. (The user-management console is where any future per-user override would surface.)
- **Producers still cannot invite admins or producers.** The flag only ever permits producer→**artist** invitations. This is enforced server-side regardless of the client.
- **Resend stays admin-only.** `org_invitations` RW RLS is admin-only; loosening it would expose all pending invites (incl. admin/producer invites and their tokens) to producers. Producers get the *create* affordance ("Invite to app") and see the resulting "Invited" status chip, but the **Resend** button remains admin-only.
- **No new nav, no route, no customer-facing changelog for the super-admin surface.** The only customer-visible behavior change is "producers can now invite artists when my org's super-admin turns it on."

---

## 2. Architecture — mirror the entitlements pattern exactly

Capabilities are a structural clone of module entitlements (`org_entitlements`), with a different table, different registry, and a fail-**closed**-always resolver. Keeping them parallel means one mental model, one review lens, and the same three-runtime-mirror discipline.

| Concern | Entitlements (existing) | Capabilities (new) |
|---|---|---|
| Table | `org_entitlements` | **`org_capabilities`** |
| PK | `(org_id, feature)` | `(org_id, capability)` |
| SQL twin | `is_feature_enabled(_org, _feature)` | **`is_capability_enabled(_org, _capability)`** |
| Frontend registry | `src/lib/entitlements.ts` | **`src/lib/capabilities.ts`** |
| Edge registry (verbatim mirror) | `supabase/functions/_shared/entitlements.ts` | **`supabase/functions/_shared/capabilities.ts`** |
| Edge DB helper | `checkFeature` / `requireFeature` | **`checkCapability` / `requireCapability`** |
| Frontend read | `src/data/entitlements.ts` `fetchEntitlements` | **`src/data/capabilities.ts` `fetchCapabilities`** |
| Frontend write | `src/data/platform.ts` `setOrgEntitlement` | **`setOrgCapability`** (in `platform.ts`) |
| Frontend hook | `src/hooks/useEntitlements.ts` | **`src/hooks/useCapabilities.ts`** |
| Super-admin UI | EditOrgDialog "Modules" section | EditOrgDialog **"User rights"** section |

### 2.1 The three-runtime mirror rule (inherited)

`src/lib/capabilities.ts`, `supabase/functions/_shared/capabilities.ts`, and the SQL twin `is_capability_enabled()` all carry the same registry + defaults. **They must change in the same commit.** The two TS files' shared top halves (registry + pure resolvers) are byte-identical; the edge file additionally has DB-backed helpers below a divider (exactly like `entitlements.ts`). Header comments in each file state the mirror obligation.

### 2.2 Fail direction

`checkCapability` fails **closed always** (on RPC error → deny). Unlike entitlements — where `booking_flow` fails *open* because six live cron/request consumers must never be silently disabled by a transient RPC error — capabilities are permission *grants* that default off. Denying on error is the safe direction for a grant: the worst case is a producer who briefly can't invite, never a producer who wrongly can.

---

## 3. Data model

### 3.1 `org_capabilities` table (new migration)

Structurally identical to `org_entitlements`:

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
```

- **Read = any org member.** Producers (and the frontend hook) must read their org's capability rows to decide whether to show the invite affordance. Reading a boolean grant leaks nothing sensitive.
- **Write = super-admin only** (plus the RESTRICTIVE `org_isolation` for pooled-tenancy defense in depth — matches `org_entitlements`).

### 3.2 SQL twin + stamp + audit triggers

Cloned from the `org_entitlements` migration:

- `is_capability_enabled(_org uuid, _capability text) returns boolean` — `coalesce((select enabled …), case _capability when 'producer_can_invite' then false else false end)`. **STABLE SECURITY DEFINER, search_path=public.** Defaults mirror the registry.
- `stamp_org_capability()` BEFORE trigger — sets `updated_at = now()`, `updated_by = auth.uid()`.
- `log_org_capability_change()` AFTER trigger — writes to the existing generic `settings_audit_log` with key `'capability:' || new.capability` (mirrors `'entitlement:' || new.feature`); no-ops when `enabled` is unchanged on UPDATE.

### 3.3 Registry (all three runtimes)

```ts
export type CapabilityKey = "producer_can_invite";

export interface CapabilityDef {
  key: CapabilityKey;
  label: string;        // "Producers can invite artists"
  description: string;  // "Allow producers (not just admins) to invite artists to the app."
  defaultEnabled: boolean; // false
}

export const CAPABILITY_REGISTRY: Record<CapabilityKey, CapabilityDef> = { … };
export const CAPABILITY_KEYS = Object.keys(CAPABILITY_REGISTRY) as CapabilityKey[];

export interface CapabilityRow { capability: string; enabled: boolean }
export function enabledCapabilities(rows: CapabilityRow[]): Set<CapabilityKey>;
export function isCapabilityEnabled(rows: CapabilityRow[], cap: CapabilityKey): boolean;
```

The edge file adds below a divider: `checkCapability(admin, orgId, cap)` (RPC `is_capability_enabled`, fail closed) and `requireCapability(deps, orgId, cap)` (→ `null` or `json({ error: "capability_disabled" }, 403)`).

---

## 4. Enforcement

### 4.1 Backend — `create-invitation` (the single chokepoint)

All invitations (artist-sheet invites and admin Invites-tab invites) route through `inviteArtistToApp`/`createInvitation` → the `create-invitation` edge function. It currently requires `requireOrgRole(org_id, ['admin'])`.

**Key constraint:** `requireOrgRole` returns only `{ ok, userId }` (an `AuthOutcome`) — it does **not** expose the caller's resolved role. So we cannot branch on a returned role. The clean, idiomatic solution reuses `requireOrgRole` itself, **called twice**: first as an admin gate, then (only if that fails) as a producer gate. A super-admin passes the admin gate via `requireOrgRole`'s `platform_admins` fallback, so super-admins are treated as admins. A caller who fails the admin gate but passes the producer gate is, by construction, a plain producer.

```
resolve requested role (artist_id path forces 'artist', as today)

adminAuth = requireOrgRole(org_id, ['admin'])            // admins & super-admins
if adminAuth.ok:
    inviterId = adminAuth.userId                         // unchanged: may invite any role
else:
    prodAuth = requireOrgRole(org_id, ['producer'])      // plain producer?
    if !prodAuth.ok: return prodAuth.response            // neither → 401/403 (unchanged behavior)
    if requestedRole !== 'artist':
        return 403 { error: "producers_can_only_invite_artists" }
    if not (await checkCapability(admin, org_id, 'producer_can_invite')):
        return 403 { error: "capability_disabled" }
    inviterId = prodAuth.userId
// continue with existing insert flow, using inviterId as invited_by
```

**Why two calls, not a new helper:** `requireOrgRole` already resolves membership role via `.in('role', roles)` + the super-admin fallback, and is thoroughly tested. Reusing it (rather than a bespoke `callerIsAdmin`) means zero new auth surface, and it is fake-deps-compatible: the fake applies `.in()` filtering to single-object `org_memberships` seeds (verified in `testing.ts resolveSeed`), so `.in('role',['admin'])` on a `{role:'producer'}` seed returns null (admin gate fails) while `.in('role',['producer'])` matches (producer gate passes). The extra JWT/round-trip on the producer path is negligible (invites are rare). Admins hit only the first call.

**Backward-compat with existing tests (verified):** admin-path tests never reach `checkCapability`, so they're unchanged. The unseeded `is_capability_enabled` RPC defaults to `{data:null}` in the fake → `checkCapability` returns false, so the existing "producer → 403" test (`index.di.test.ts`, no cap seed) stays green (now 403 `capability_disabled` instead of the coarse gate; it only asserts the status). New tests seed `rpcs: { is_capability_enabled: { data: true, error: null } }` for the cap-on case.

**Security invariant:** a producer can only ever create an `'artist'` invitation, and only when the org's `producer_can_invite` is on. Enforced server-side irrespective of client. This is the privilege-escalation guard and is covered by an edge test.

### 4.2 Frontend — `ArtistProfileSheet` + `LinkedAccountPanel`

- Add `useCapability('producer_can_invite')` in `ArtistProfileSheet`.
- Compute `const canInvite = isAdmin || (isProducer && producerCanInvite);`
- Split the panel's single `canInvite` prop into **`canInvite`** (the create button, state="none") and **`canResend`** (the resend button, state="invited"). Pass `canInvite={canInvite}` and `canResend={isAdmin}`.
- `LinkedAccountPanel`: gate the "Invite to app" button on `canInvite`, the "Resend" button on `canResend`. Keep account PII gated on `canSeeAccount={isAdmin}` (unchanged, ADR-0011).

Producers with the flag on: see the status chip (via `list_pending_invited_artists`, any-member), can click "Invite to app" (state="none"), see it flip to "Invited", but do **not** see the Resend button or account PII.

### 4.3 Super-admin UI — EditOrgDialog "User rights" section

Add a second bordered section below "Modules", identical structure, iterating `CAPABILITY_KEYS`:

```
User rights
  Producers can invite artists                    [Switch]
  Allow producers (not just admins) to invite artists to the app.
```

Toggling calls `setOrgCapability(supabase, orgId, key, enabled)` and invalidates `["capabilities"]`. Reads via a `useQuery(["capabilities", org?.org_id], fetchCapabilities)` mirroring the existing `isModuleEnabled`.

---

## 5. Testing

- **pgTAP** (`supabase/tests/`): `is_capability_enabled` default (no row → false); explicit row overrides default (true/false); non-super-admin cannot INSERT/UPDATE `org_capabilities` (RLS); member CAN SELECT; audit row written to `settings_audit_log` with key `capability:producer_can_invite`; stamp trigger sets `updated_by`.
- **Edge (Deno)** for `create-invitation`: (a) admin invites artist → ok (unchanged); (b) producer invites artist, cap **off** → 403 `capability_disabled`; (c) producer invites artist, cap **on** → ok; (d) producer invites **admin/producer**, cap on → 403 `producers_can_only_invite_artists`; (e) super-admin path unaffected. Use `makeFakeDeps` with a seeded `rpcs: { is_capability_enabled: … }` and `requireOrgRole` returning the producer role.
- **Unit (vitest)**: `capabilities.ts` pure resolvers (`enabledCapabilities`, `isCapabilityEnabled`, defaults); `fetchCapabilities`/`setOrgCapability` via `supabaseFake`; `useCapabilities`/`useCapability` via `renderWithProviders`; `LinkedAccountPanel` new `canResend` gating (create shows for producer, resend hidden); `EditOrgDialog` renders the User-rights Switch and toggles it.
- **Mirror sync**: extend the existing byte-equality guard approach — a small test asserting `src/lib/capabilities.ts` and `_shared/capabilities.ts` share the same registry (mirror the `typesMirror.test.ts` spirit; at minimum assert equal `CAPABILITY_KEYS` + defaults). Regenerate `types.ts` + `_shared/database.types.ts` for the new table and keep them byte-identical.

---

## 6. Rollout

- **Ships neutral.** `producer_can_invite` defaults off, so no org's behavior changes until a super-admin flips it. No dark-launch gate needed beyond the default.
- **Deploy:** the new migration applies to prod via the migration tool; `create-invitation` is already listed in `config.toml` (`verify_jwt` unchanged — it stays as-is) and redeploys on merge. No new function, no `config.toml` block.
- **Config.toml:** unchanged — no new edge function is added.
- **Changelog:** one optional customer-facing "Improved" line ("Admins' super-admin can now let producers invite artists") is *not* applicable — this is a super-admin/platform toggle, and per project rules platform-admin actions never appear in `public/changelog.md`. **No changelog entry.**

---

## 7. Open considerations (resolved)

- **Why a new table, not a `producer_can_invite` column on `organizations` or a booking-engine `app_settings` key?** Capabilities are an open-ended, registry-driven set with per-key audit + defaults; a table mirroring `org_entitlements` gives uniform toggling, audit, and RLS for every future flag with zero per-flag DDL. A column-per-flag or settings-key approach would not.
- **Why not reuse `org_entitlements` with `feature: 'producer_can_invite'`?** Different axis (permission vs module), different fail direction (closed vs booking_flow's open), and mixing them would pollute the module registry + fleet chip view. Separate table keeps each registry coherent.
- **Resend for producers** — deferred (needs an org_invitations RLS loosening or a resend edge-fn auth change; out of scope, documented non-goal).
