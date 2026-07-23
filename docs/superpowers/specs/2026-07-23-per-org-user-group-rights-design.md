# Per-org user group rights — granular permissions matrix

- **Date:** 2026-07-23
- **Branch:** `claude/per-org-user-group-rights-d91601`
- **Status:** Design approved; spec under review
- **Builds on:** PR #187 (per-org capability flags — `producer_can_invite`, the `org_capabilities` table, the three-mirror registry)

---

## 1. Goal

Turn the single super-admin-only `producer_can_invite` toggle into a real, granular **user group rights** system: a per-org **role × capability matrix** that both **org admins** and **platform (super) admins** manage, enforced end-to-end (UI + edge + RLS). "User group" maps to the existing role (`admin` / `producer` / `artist`); a "right" is a discrete action a role may or may not perform within an org.

This is net-new configurability layered on the existing three roles. It does **not** introduce custom/arbitrary roles, and it does **not** touch the `app_role` enum or the `has_role()` RLS plumbing.

## 2. Decisions (resolved in brainstorming)

| Fork | Decision |
|---|---|
| **Model** | Role × capability matrix on the existing 3 roles, extending `org_capabilities`. No new roles, no `app_role`/`has_role()` changes. |
| **Enforcement** | Defense in depth: UI gate + edge `requireCapability` + capability-aware RLS, each with tests. |
| **First-cut scope** | Full catalog on day one — all ~30 rights wired and enforced. |
| **Governance** | Platform admin sets per-org defaults and can **lock** rights; org admin tunes everything unlocked. Two-layer storage. |
| **(a) Admin invariant** | Admin is never a stored capability — admins always hold everything by default. Registry defaults reproduce today's behavior exactly. |
| **(b) Platform UI** | The full matrix replaces the lone `producer_can_invite` toggle in `EditOrgDialog`, reached via a "Manage all rights" button; a compact summary stays in the dialog. |
| **(c) Rollout** | Ship **live** on faithful defaults. No staged/dark flag — a fresh org behaves identically until an admin retunes. |

## 3. Data model

Two layers, resolved by one function. The existing `org_capabilities` table is kept as-is; one platform table is added.

### Tables

- **`org_capabilities`** *(exists — PR #187)* — org-admin **overrides**. `(org_id, capability, enabled, updated_by, updated_at)`, PK `(org_id, capability)`. RLS **extended**: org **admins** may write (previously super-admin only), but only for rights that are **not locked**. Super-admins retain full write.
- **`org_capability_policies`** *(new)* — the **platform layer**. `(org_id, capability, enabled bool null, locked bool not null default false, updated_by, updated_at)`, PK `(org_id, capability)`. RLS: super-admin write only; org members read (needed to render effective value + lock state). Restrictive `org_isolation` policy per the tenant template. Audited into `settings_audit_log` (key `capability_policy:<name>`) by a `log_org_capability_policy_change` trigger, and `updated_at`/`updated_by` stamped by a `stamp_org_capability_policy` trigger — mirroring the existing `org_capabilities` triggers.

### Resolver — upgrade `is_capability_enabled(_org, _capability)` in place

The signature is unchanged, so **every existing caller (edge `requireCapability` and any RLS policy) gets layered semantics for free**:

```
policy := org_capability_policies[_org, _capability]
if policy.locked then
    return coalesce(policy.enabled, registry_default(_capability))   -- platform wins
end if
org := org_capabilities[_org, _capability]
if org exists then
    return org.enabled                                              -- org tunes
end if
return coalesce(policy.enabled, registry_default(_capability))       -- platform default, then registry
```

`registry_default(_capability)` is the SQL twin of the TS registry: a `case` arm per key. Two helper functions are added for the UI:
- `is_capability_locked(_org, _capability) → bool`
- (Optional, if needed for the matrix render) a set-returning `resolve_org_capabilities(_org)` that returns `(capability, effective bool, locked bool, source text)` in one round-trip.

### Why keep the `is_capability_enabled` signature stable

Changing it would ripple into `supabase/functions/_shared/capabilities.ts` and every RLS policy that calls it. Keeping `(_org, _capability text)` and encoding the role inside the key string (see §4) means the whole enforcement surface is additive.

## 4. Registry

`src/lib/capabilities.ts` becomes a structured catalog, replacing the ad-hoc `CapabilityKey` union. Mirrored **byte-identically** into `supabase/functions/_shared/capabilities.ts`, with every `key → defaultEnabled` also added to the SQL `is_capability_enabled` `case`. (Three-mirror discipline, exactly as entitlements.)

```ts
type GrantableRole = 'producer' | 'artist';

interface CapabilityDef {
  key: string;              // storage key → org_capabilities + is_capability_enabled, e.g. 'producer_can_issue_hire_orders'
  action: string;           // matrix row id, e.g. 'issue_hire_orders'
  role: GrantableRole;      // matrix column this cell grants
  group: string;            // matrix section, e.g. 'Hire orders'
  label: string;
  description: string;
  risk: 'standard' | 'sensitive';
  defaultEnabled: boolean;  // MUST equal today's hardcoded gate (safety invariant)
  module?: FeatureKey;      // e.g. 'hire_orders' — cell hidden when module off
  enforcement: ('ui' | 'edge' | 'rls')[]; // documents where the check lives
}
```

**Invariants:**
- **Admin is never in the registry.** Admins always hold every right; the matrix shows the admin column read-only ✓. This structurally prevents "removed the last admin's power," and it is why platform-tier powers (delete org, toggle modules, manage platform admins) are simply **not capabilities**.
- **`producer_can_invite` keeps its exact key** — it becomes the `(producer, invite_artists)` cell. No data migration; the existing `org_capabilities` row and edge check keep working.
- **Defaults == today.** A unit test asserts every `defaultEnabled` matches the gate it replaces.
- **Artist has no togglable cells in v1** (the column exists for completeness). Artist "download own issued PDF" stays governed by the existing per-order `download-url` auth, not a capability.
- **Admin power tools are excluded** — Editor mode, page-access/column editing, and "View as" impersonation stay real-admin-only (delegating impersonation is a security concern), not capabilities.

## 5. The catalog (full, day one)

Legend: default is the value that reproduces today. `S` = standard, `!` = sensitive (confirm + audit). Module column blank unless gated.

### A. Members & access
| key | action / label | role | default | risk | enforcement | replaces (today) |
|---|---|---|---|---|---|---|
| `producer_can_invite` *(exists)* | Invite artists | producer | off | S | edge (`create-invitation`, wired) | admin-only + this cap |
| `producer_can_invite_producers` | Invite producers | producer | off | ! | edge (`create-invitation`) | admin-only |
| `producer_can_change_roles` | Change member roles | producer | off | ! | RPC `set_org_member_role` | admin-only |
| `producer_can_remove_members` | Remove members | producer | off | ! | RPC `remove_org_member` | admin-only |
| `producer_can_manage_invitations` | Revoke / resend invitations | producer | off | S | edge (`resend-invitation`) + RLS (`org_invitations`) | admin-only |

*Inviting/promoting admins stays admin-only (not a capability) — a producer granting admin would be escalation.*

### B. Productions & show dates
| key | action / label | role | default | risk | enforcement | replaces |
|---|---|---|---|---|---|---|
| `producer_can_manage_productions` | Create / edit productions | producer | on | S | RLS (`shows` ins/upd) | admin+producer |
| `producer_can_archive_productions` | Archive productions | producer | on | S | RLS (`shows` upd) | admin+producer |
| `producer_can_reorder_productions` | Reorder productions | producer | on | S | RLS (`shows` upd sort) | admin+producer |
| `producer_can_hard_delete_productions` | Hard-delete productions | producer | off | ! | RLS (`shows` del) | admin-only |
| `producer_can_manage_show_dates` | Create / edit show dates | producer | on | S | RLS (`show_dates` ins/upd) | admin+producer |
| `producer_can_hard_delete_show_dates` | Hard-delete show dates | producer | off | ! | RLS (`show_dates` del) | admin-only |

### C. Bookings & engine
| key | action / label | role | default | risk | enforcement | replaces |
|---|---|---|---|---|---|---|
| `producer_can_manage_casts` | Manage casts | producer | on | S | RLS (`casts`, `cast_members`) | admin+producer |
| `producer_can_run_offer_engine` | Open / close offer tiers | producer | on | S | edge (`open-offer-tier`, `close-offer-tier`) | admin+producer |
| `producer_can_confirm_bookings` | Confirm bookings | producer | on | S | RLS (`bookings` upd) | admin+producer |
| `producer_can_edit_booking_settings` | Edit booking-engine settings | producer | off | ! | RLS (`app_settings` booking keys) | admin-only |

### D. Artists
| key | action / label | role | default | risk | enforcement | replaces |
|---|---|---|---|---|---|---|
| `producer_can_add_artists` | Add / bulk-import artists | producer | on | S | RLS (`artists` ins) + RPC `bulk_import_artists` | admin+producer |
| `producer_can_edit_artists` | Edit artist details & skills | producer | on | S | RLS (`artists` upd, skills) | admin+producer |
| `producer_can_view_linked_accounts` | View linked-account panel / resend | producer | off | S | ui (panel) + edge (resend) | admin-only |

### E. Hire orders — `module: hire_orders`
| key | action / label | role | default | risk | enforcement | replaces |
|---|---|---|---|---|---|---|
| `producer_can_generate_hire_orders` | Generate / draft orders | producer | on | S | edge (`generate-hire-orders` draft) | admin+producer |
| `producer_can_issue_hire_orders` | Issue orders | producer | off | ! | edge (`generate-hire-orders` issue) | admin-only |
| `producer_can_void_hire_orders` | Void orders | producer | off | ! | edge / RLS (void path) | admin-only |
| `producer_can_manage_countersign` | Manage countersign | producer | on | S | edge / RLS | admin+producer |
| `producer_can_edit_hire_order_settings` | Edit hire-order settings | producer | off | ! | RLS (`app_settings` hire-order keys) | admin-only |

### F. Settings & organization
| key | action / label | role | default | risk | enforcement | replaces |
|---|---|---|---|---|---|---|
| `producer_can_rename_org` | Rename organization | producer | off | ! | RLS (`organizations` upd) | admin-only |
| `producer_can_manage_ownership` | Manage production ownership | producer | on | S | RLS | admin+producer |
| `producer_can_manage_cities` | Manage casts & cities | producer | on | S | RLS (`cities`, casts) | admin+producer |
| `producer_can_edit_filter_settings` | Edit filters / notification defaults | producer | off | S | RLS (`app_settings` filter/notif keys) | admin-only |
| `producer_can_edit_scheduling` | Edit scheduling settings | producer | on | S | RLS (`app_settings` scheduling keys) | admin+producer |

### G. Integrations
| key | action / label | role | default | risk | enforcement | replaces |
|---|---|---|---|---|---|---|
| `producer_can_configure_airtable` | Configure Airtable sync (mapping, keys) | producer | off | ! | edge (`airtable-schema`) + RLS (airtable settings) | admin-only |
| `producer_can_trigger_sync` | Trigger manual "Sync now" | producer | off | S | edge (`airtable-poll` single-org) | admin-only |

**Total: 30 producer capabilities** (1 pre-existing, 29 new). Exact count and each "replaces" gate are verified per-right during planning.

## 6. Enforcement (defense in depth)

Each right lands in up to three places:

1. **UI** — new hook `useCan(action: string): boolean` (admin → always true; else resolve the `${role}_can_${action}` cell from `useCapabilities()` with registry-default fallback) plus a pure `can(role, action, rows)` for logic tests. Replaces the scattered `hasRole('admin') || hasRole('producer')` checks at the gate sites in §5's "replaces" column.
2. **Edge** — `requireCapability(deps, org_id, key)` inserted **after** the role gate, following the `create-invitation` double-gate. Applies to the `edge`-tagged rights.
3. **RLS** — the table's write policy gains `OR (has_org_role(uid, org_id, 'producer') AND is_capability_enabled(org_id, '<key>'))`. Applies to the `rls`-tagged rights. `SECURITY DEFINER` RPCs (`set_org_member_role`, `remove_org_member`, `bulk_import_artists`) get an in-body capability check instead of a policy change.

**Tests per right:**
- Vitest: `can()` resolver truth table; a mirror byte-equality test (src registry == edge registry); a "defaults == today" test.
- pgTAP: layered `is_capability_enabled` (locked / override / platform-default / registry-default paths); and for each `rls` right — producer denied when off, allowed when on, admin always allowed, cross-org isolation holds.
- Deno: `requireCapability` present and fail-closed on each `edge` right.
- Playwright: one headline E2E — platform/admin grants producer "issue orders" → a producer session can issue.

Realistic RLS surface: ~15–20 policies/RPCs to audit and extend. This is the bulk of the work and is enumerated explicitly in the implementation plan.

## 7. The menu — one component, two homes

A shared `PermissionsMatrix` component: rows = actions grouped by `group`, columns = roles (`admin` read-only ✓, `producer`, `artist`), cells = toggle / lock / read-only depending on context and risk.

```
Roles & permissions                              org: Acme Productions

  MEMBERS & ACCESS                admin   producer   artist
  Invite artists                    ✓      [ ON ]      —
  Change member roles  !            ✓      [ off ]     —
  Remove members  !                 ✓        —         —
  …
  HIRE ORDERS  (module: on)        admin   producer   artist
  Generate orders                   ✓      [ ON ]      —
  Issue orders  !                   ✓      [ off ]🔒   —     managed by ShowFlow
  …
```

- **Settings → "Roles & permissions"** — new tab, **admin-only** (`SettingsPage`; new `PermissionsTab`). Org admins toggle unlocked producer/artist cells. Admin column read-only ✓. Locked cells disabled with a "managed by ShowFlow" note. Module-gated rows hidden when the module is off. Sensitive (`!`) toggles prompt a confirm dialog. Writes go to `org_capabilities` (RLS blocks locked cells server-side too).
- **Platform console → per-org** — the same component with two extras per cell: a **lock** control and the platform-default setter. Writes go to `org_capability_policies`. This replaces the single `producer_can_invite` switch in `EditOrgDialog`; the dialog keeps a compact "N rights customized, M locked" summary with a **"Manage all rights"** button that opens the full matrix.

## 8. Guardrails

- **No privilege escalation** — platform-tier powers are not capabilities, so they can't be granted; inviting/promoting admins and impersonation stay admin-only and off-registry.
- **Sensitive tier (`!`)** — confirm dialog in the UI, and audited server-side (existing `org_capabilities` audit trigger + new `org_capability_policies` trigger).
- **Locked rights** — platform admins' governance lever for managed/regulated tenants; enforced in RLS (org-admin writes to a locked capability are rejected), not just hidden in the UI.
- **Faithful defaults** — the safety invariant that makes a live launch safe.

## 9. Rollout & safety

- **Ship live**, no dark entitlement. The "defaults == today" test guarantees a fresh org behaves identically until an admin retunes.
- **Backward compatible** — `producer_can_invite` and its data survive unchanged.
- **Changelog** — customer-facing "New" entry (Settings → Roles & permissions). Per project convention, no mention of platform/super-admin surfaces (the platform lock layer is not described in the public changelog).
- **System map** — no new automation triggers, so `docs/system-map.md` / `src/data/systemMap.ts` are unaffected. `docs/adr/README.md` key-decisions and `CLAUDE.md` capability notes get a short update.

## 10. Out of scope (v1)

- Custom/arbitrary roles or named groups beyond `admin`/`producer`/`artist`.
- Grantable artist capabilities (column present, no togglable cells).
- Delegating admin power tools (Editor mode, impersonation).
- Per-field/per-column permissions (the editor system already covers column visibility separately).

## 11. Open questions / risks

- **`confirm_bookings` RLS** — the `bookings` table has many status transitions; the capability must gate only the producer confirm path without loosening other transitions. Verify the exact policy shape during planning; may need a narrower `WITH CHECK` or a dedicated RPC.
- **`app_settings` key partitioning** — several rights gate subsets of `app_settings` (booking, hire-order, filter, scheduling keys). Confirm the policies can discriminate by key prefix, or introduce a small mapping, so one right doesn't accidentally gate another's keys.
- **Per-row `is_capability_enabled` cost in RLS** — evaluate whether the function call per row needs `STABLE`/marking or a join-friendly variant for hot tables (`bookings`, `show_dates`).
- **Registry size** — 30 mirrored keys across three files; the mirror byte-equality test and the SQL `case` must stay in sync (guarded by tests, but a real maintenance surface).
