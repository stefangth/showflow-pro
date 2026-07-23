# Per-org User Group Rights — Plan 3: Enforcement Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make all 27 producer capabilities actually enforced (UI + edge + RLS/RPC), so the Plan 2 matrix menu controls real behavior, plus expose the admin-only Settings tabs read-only to producers (the "broad Settings" read-only floor).

**Architecture:** Each right is enforced at the layer its action actually runs through: `useCan(action)` in the UI (rendering read-only, not hiding), `requireCapability` in edge functions, an in-body capability check in `SECURITY DEFINER` RPCs, and a capability-aware predicate in the write RLS for direct client→DB writes. RLS enforces at **role × table × command** granularity; where multiple UI capabilities share one table+command, the finer ones are UI-gated and server-enforced by a coarser sibling (documented per right). Capability defaults already reproduce today's behavior (Plan 1), so this plan is behavior-preserving except for the intentionally-flipped rights (Plan 1 §9), which are already live.

**Tech Stack:** React 18 + TS (`useCan`); Deno edge (`requireCapability`); Supabase Postgres RLS + pgTAP + `SECURITY DEFINER` RPCs; Playwright E2E. This is Plan 3 of 3; Plans 1 (engine) and 2 (menu) are on this branch.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-23-per-org-user-group-rights-design.md` §5 (the 27-right catalog + "replaces" column), §6 (defense-in-depth + read-only floor), §8 (guardrails).
- **Engine (built):** `useCan(action: string)` (`src/hooks/useCapabilities.ts`) — admins always true; else resolves the current role's capability. `requireCapability(deps, orgId, key)` (`supabase/functions/_shared/capabilities.ts`) — 403 `capability_disabled` when off; fails closed. `is_capability_enabled(_org, _capability)` (DB, layered). The `create-invitation` double-gate is the canonical edge pattern.
- **Read-only floor:** capabilities gate MUTATIONS only. Never add a capability check to a SELECT policy; producer read stays unconditional. UI renders controls read-only/disabled, never removes the page.
- **Behavior-preserving:** every capability default already equals today's gate. A pgTAP/edge/UI test for each right must prove: producer allowed when ON, denied when OFF, admin always allowed, read still works when OFF.
- **Migrations:** apply via Supabase MCP `apply_migration` (records a real-timestamp version); write the matching local file. Never edit an applied migration — use `CREATE OR REPLACE` / `DROP POLICY; CREATE POLICY` follow-ups. Regenerate types (`supabase gen types typescript --project-id epweartpzwvcasrzyueh --schema public`) into both homes if any table shape changes (none expected here — policies/functions only).
- **Verification commands:** typecheck is `npx tsc -p tsconfig.app.json --noEmit` (root `npx tsc --noEmit` is a NO-OP — do not use it). `npm run lint`. `npx vitest run <path>`. Deno: `deno test --allow-all --node-modules-dir=none supabase/functions/<fn>/`. pgTAP: via Supabase MCP `execute_sql`, wrap the file in `BEGIN … ROLLBACK` and capture TAP into a temp table (see Plan 1's `org_capability_policies.sql` run for the idiom; pgtap funcs live in the `extensions` schema, unqualified). Full-suite has chronic load-flakes (`AirtableSyncTab`, `HireOrdersPage`, `SettingsPage`, `CastsCitiesTab`, `RangeStep`, `HireOrderImportDialog`) — re-run any failing file in isolation before treating it as real.
- **No `any`; semantic tokens only; no em/en dashes in copy.**
- **Prod project:** `epweartpzwvcasrzyueh`. `has_org_role(_uid, _org, _role app_role)`, `is_org_member(_uid, _org)` signatures confirmed.

---

## Enforcement map (all 27 rights → mechanism + exact site)

Legend: **E** edge `requireCapability`; **R** RPC in-body check; **L** capability-aware RLS; **T** RLS transition-predicate (status-change gated); **U** UI `useCan` (rewire); **U-only** UI-gated, server-covered by a coarser sibling (named); **RO** read-only Settings surface.

| # | key | default | mechanism | exact site(s) |
|---|---|---|---|---|
| 1 | producer_can_invite | on | E ✓ done + U | `create-invitation` (wired). UI fix: `ArtistsPage.tsx:317` invite chip + `:367` `canInvite` prop → `useCan('invite_artists')`; `ArtistProfileSheet.tsx:41` already uses the cap. |
| 2 | producer_can_manage_invitations | on | L + U(new) | Revoke = `org_invitations` UPDATE(`status='revoked'`) `src/data/invitations.ts:72`. RLS `org_invitations_rw` (admin FOR ALL) → add producer+cap arm scoped `role='artist'`. **New UI**: producer-facing revoke control on Artists page pending-invite chip (Admin console stays admin-only). |
| 3 | producer_can_manage_productions | on | L + U | RLS `shows` INSERT+UPDATE "Admins and producers…" → add cap. UI: `ProductionsPage.tsx:145,181` create/edit → `useCan('manage_productions')`. |
| 4 | producer_can_archive_productions | on | U-only (shows UPDATE ⊂ manage_productions) | UI: `ProductionsPage.tsx:146` archive → `useCan('archive_productions')`. Server-covered by #3. |
| 5 | producer_can_reorder_productions | on | U-only (shows UPDATE ⊂ manage_productions) | UI: `ProductionsPage.tsx` drag (`useReorderShows`) → `useCan('reorder_productions')`. Server-covered by #3. |
| 6 | producer_can_hard_delete_productions | off | L + U | RLS `shows` DELETE "Admins can delete shows" (admin) → add producer+cap arm. UI: `ProductionsPage.tsx:131,149` → `useCan('hard_delete_productions')`. |
| 7 | producer_can_manage_show_dates | on | L + U | RLS `show_dates` INSERT+UPDATE → add cap. UI: `ShowDateDetailSheet.tsx:97` `canManage` → `useCan('manage_show_dates')`. |
| 8 | producer_can_hard_delete_show_dates | off | L + U | RLS `show_dates` DELETE (admin) → add producer+cap. UI: `ShowDateDetailSheet.tsx:250` → `useCan('hard_delete_show_dates')`. |
| 9 | producer_can_manage_casts | on | L + U | RLS `casts` INSERT/UPDATE + `cast_members` INSERT/DELETE → add cap. (`casts` DELETE stays admin-only.) UI: `CastsSection.tsx:17`, `CastDetailsSheet.tsx:30` → `useCan('manage_casts')`. |
| 10 | producer_can_run_offer_engine | on | E + U | Edge `open-offer-tier/index.ts:76` + `close-offer-tier/index.ts:50` add `requireCapability`. UI: `ShowDateDetailSheet.tsx:704` TierTimeline `canManage` → `useCan('run_offer_engine')`. |
| 11 | producer_can_confirm_bookings | on | **T** + U | RLS `bookings` "…manage bookings" FOR ALL → producer WITH CHECK gate on `status='confirmed'` transition. UI: `BookingRow.tsx:23` + `ShowDateDetailSheet.tsx:769`/`DashboardPage.tsx:140` bulk → `useCan('confirm_bookings')`. **HIGH RISK — see Phase 1c.** |
| 12 | producer_can_edit_booking_settings | off | L(app_settings) + RO | RLS `app_settings` via `app_setting_capability`. UI: `BookingFlowTab` read-only + nav `show` producer (Phase 5). |
| 13 | producer_can_add_artists | on | L(new) + R + U | **New** producer INSERT policy on `artists` gated on cap. RPC `bulk_import_artists` add cap check. UI: `ArtistsPage.tsx:239` single Add (admin-only today) → `useCan('add_artists')`; `:234` import already producer. |
| 14 | producer_can_edit_artists | on | L + U | RLS `artists` UPDATE "Producers can update artists" → add cap. UI: `ArtistProfileSheet.tsx:38` `canEdit` → `useCan('edit_artists')`. |
| 15 | producer_can_view_linked_accounts | on | E + U | Edge `resend-invitation/index.ts:24` add `requireCapability('producer_can_view_linked_accounts')`. UI: `ArtistProfileSheet.tsx:304` `canSeeAccount`/`canResend` → `useCan('resend_account_invite')`. |
| 16 | producer_can_generate_hire_orders | on | E + U | Edge `generate-hire-orders` `draft` action → `requireCapability`. UI: `HireOrdersCard.tsx:99` generate → `useCan('generate_hire_orders')`. |
| 17 | producer_can_issue_hire_orders | on | E + U | Edge `generate-hire-orders` `issue` action → `requireCapability`. UI: `GenerateHireOrderDialog.tsx:185`, `OrderSlideOver.tsx:71` → `useCan('issue_hire_orders')`. |
| 18 | producer_can_void_hire_orders | on | **T** + U | RLS `hire_orders` "Producers manage…" FOR ALL → producer WITH CHECK gate on `status='void'`. UI: `OrderSlideOver.tsx:95` → `useCan('void_hire_orders')`. |
| 19 | producer_can_manage_countersign | on | **T** + U | RLS `hire_orders` WITH CHECK gate on `status='countersigned'`. UI: `HireOrderDetailPage.tsx:117` `canManage` (countersign path) → `useCan('manage_countersign')`. |
| 20 | producer_can_edit_hire_order_settings | off | L(app_settings) + RO | `app_settings` hire-order keys via helper. UI: `HireOrdersTab` cards read-only (Phase 5). |
| 21 | producer_can_rename_org | off | R + U | RPC `rename_org` add producer+cap arm. UI: `OrganizationTab` rename control → `useCan('rename_org')` (tab exposed read-only, Phase 5). |
| 22 | producer_can_manage_ownership | on | L + U | RLS `show_assignments` FOR ALL (admin+producer) → add cap. UI: `ProductionOwnershipTab.tsx:32` `canEnter` → `useCan('manage_ownership')`. |
| 23 | producer_can_manage_cities | on | L + U | RLS `cities` INSERT/UPDATE + `cast_city_priority` → add cap (cities DELETE stays admin). UI: `CastsCitiesTab.tsx:25` `canEnter` → `useCan('manage_cities')`. |
| 24 | producer_can_edit_filter_settings | off | L(app_settings) + RO | `app_settings` filter/notification keys via helper. UI: Filters + Notifications tabs read-only (Phase 5). |
| 25 | producer_can_edit_scheduling | on | U-only (shows UPDATE ⊂ manage_productions) | Slot fields in `ShowFormDialog` are `shows` UPDATE (server-covered by #3). Settings "Scheduling" tab is informational-only. UI: gate the slot fields → `useCan('edit_scheduling')`. Documented as UI-only. |
| 26 | producer_can_configure_airtable | off | E + R + L + RO | Edge `airtable-schema/index.ts:53` producer+cap; RPC `set_org_airtable_key` producer+cap; `app_settings` airtable keys via helper. UI: `AirtableSyncTab` read-only + save controls `useCan('configure_airtable')`. |
| 27 | producer_can_trigger_sync | off | E + U | Edge `airtable-poll` single-org path (`index.ts:568`) producer+cap. UI: `AirtableSyncTab.tsx:653` "Sync now" → `useCan('trigger_sync')`. |

---

## Resolved unknowns

### `app_setting_capability(key)` — the settings key → capability map (Phase 0)

Real keys enumerated from prod. Unknown keys return `null` → producer denied (admin-only), which is fail-safe. During implementation, `grep -rn "upsertOrgSetting\|\.set(" src/components/settings` to confirm every key each tab writes is covered; add any missing key to the correct arm (never leave a producer-writable key mapping to `null` if the spec intends producer access).

```sql
create or replace function public.app_setting_capability(_key text)
returns text language sql immutable set search_path = public as $$
  select case
    when _key in ('offer_response_window_hours','offer_digest_hour_berlin','confirmation_digest_hour_berlin',
                  'email_template_overrides','resend_from_address','booking_flow')
      then 'producer_can_edit_booking_settings'
    when _key in ('hire_order_defaults','hire_order_letterhead','hire_order_terms',
                  'hire_order_numbering','hire_order_terms_variants')
      then 'producer_can_edit_hire_order_settings'
    when _key in ('filter_mappings','filters_visibility','notifications_enabled')
      then 'producer_can_edit_filter_settings'
    when _key in ('airtable_base_id','airtable_table_name','airtable_field_map',
                  'airtable_sync_enabled','airtable_poll_interval_minutes')
      then 'producer_can_configure_airtable'
    else null  -- editor_*, email_log_retention_days, starter_catalog_template: admin-only, never producer
  end;
$$;
```

### Transition-gated RLS (confirm / void / countersign)

These are direct client writes through one coarse `FOR ALL` policy. Gate the **specific status transition** in `WITH CHECK` so producer writes into the gated status require the capability, while every other producer write on the table is unchanged. Pattern (bookings shown; hire_orders analogous):

```sql
drop policy "Admins and producers can manage bookings" on public.bookings;
create policy "Admins manage bookings" on public.bookings for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin'))
  with check (public.has_org_role(auth.uid(), org_id, 'admin'));
create policy "Producers manage bookings" on public.bookings for all to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'producer'))
  with check (
    public.has_org_role(auth.uid(), org_id, 'producer')
    and (status <> 'confirmed'::booking_status
         or public.is_capability_enabled(org_id, 'producer_can_confirm_bookings'))
  );
```
This gates producer creation/transition INTO `confirmed` on the capability (covers single confirm, bulk confirm, and direct-book-as-confirmed), leaving cancel/decline/soft-book unaffected. The restrictive `org_isolation` policy still binds. The artist self-service policy ("Artists can respond to own offers") is untouched. **Verify carefully with pgTAP (Phase 1c): producer confirm allowed when cap on / denied when off / cancel always allowed / admin always / artist self-response unaffected.**

---

## Phases & tasks

Execution order matters: **Phase 0 → 1 (RLS) → 2 (RPC) → 3 (edge) can proceed in parallel among themselves after 0; Phase 4 (UI) depends on nothing server-side but should land with its matching server change; Phase 5 (read-only Settings) and 6 (invitations UI) are additive; Phase 7 verifies.** Each server task ships with pgTAP/Deno proof; each UI task with a component test.

### Phase 0 — shared SQL helper

**Task 0.1 — `app_setting_capability()`**
- Apply the migration in "Resolved unknowns" via `apply_migration` (name `app_setting_capability`); write the local file.
- pgTAP (append to a new `supabase/tests/rpc/app_setting_capability.sql`): assert representative keys map correctly and an unknown key returns `null`.
- Verify + commit.

### Phase 1 — capability-aware write RLS

Each task = one `DROP POLICY; CREATE POLICY` migration (or `CREATE POLICY` for a new arm) + a pgTAP file proving producer-on-allowed / producer-off-denied / admin-always / SELECT-unaffected. **Representative task fully specified below; the rest follow the same shape with the parameters in the table.**

**Task 1.1 (representative, fully worked) — `shows` INSERT/UPDATE + DELETE**

- [ ] **Step 1: pgTAP first** — create `supabase/tests/rls/shows_capabilities.sql` (bootstrap org `…b007`, an admin + a producer membership, using the `set_config('request.jwt.claims',…)` + `SET LOCAL ROLE authenticated` idiom from Plan 1). Assert, capturing TAP into a temp table:
  - producer INSERT a show → allowed when `producer_can_manage_productions` default (on); after `insert org_capabilities(...,'producer_can_manage_productions',false)` → producer INSERT throws `42501`; admin INSERT always allowed.
  - producer DELETE a show → throws `42501` by default (hard_delete off); after enabling `producer_can_hard_delete_productions` → allowed; admin DELETE always allowed.
  - producer SELECT always allowed regardless (read-only floor).
- [ ] **Step 2: run it** (execute_sql, BEGIN…ROLLBACK) → confirm the new assertions FAIL against current policies.
- [ ] **Step 3: apply the migration** (`apply_migration` name `shows_capability_rls`):

```sql
drop policy "Admins and producers can create shows" on public.shows;
create policy "Admins and producers can create shows" on public.shows for insert to authenticated
  with check (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_productions'))
  );

drop policy "Admins and producers can update shows" on public.shows;
create policy "Admins and producers can update shows" on public.shows for update to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_manage_productions'))
  );

drop policy "Admins can delete shows" on public.shows;
create policy "Admins can delete shows" on public.shows for delete to authenticated
  using (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, 'producer_can_hard_delete_productions'))
  );
```
- [ ] **Step 4** write the local migration file; **Step 5** re-run the pgTAP → all green; **Step 6** commit.

**Tasks 1.2–1.8 — same shape, parameters:**

| Task | table / policies | ON-arm capability(ies) | notes |
|---|---|---|---|
| 1.2 | `show_dates` INSERT/UPDATE → `manage_show_dates`; DELETE → `hard_delete_show_dates` | as named | mirror 1.1 exactly |
| 1.3 | `casts` INSERT/UPDATE + `cast_members` INSERT/DELETE → `manage_casts` | `manage_casts` | `casts` DELETE stays admin-only (do not touch) |
| 1.4 | `artists` UPDATE "Producers can update artists" → `edit_artists`; **NEW** `artists` INSERT producer policy → `add_artists` | `edit_artists`, `add_artists` | there is NO producer INSERT today — this ADDS one (behavior change is intended: default on) |
| 1.5 | `cities` INSERT/UPDATE + `cast_city_priority` writes → `manage_cities` | `manage_cities` | `cities` DELETE stays admin-only |
| 1.6 | `show_assignments` FOR ALL → `manage_ownership` | `manage_ownership` | already admin+producer; add cap to producer arm |
| 1.7 | `org_invitations` — add producer arm for UPDATE(`status='revoked'`) scoped `role='artist'` → `manage_invitations` | `manage_invitations` | keep `org_invitations_rw` admin FOR ALL; ADD a narrow producer UPDATE policy |
| 1.8 | `app_settings` INSERT/UPDATE/DELETE → producer arm via `app_setting_capability(key)` | (per-key) | see below |

**Task 1.8 (app_settings, fully worked) migration:**
```sql
drop policy "Admins can insert app settings" on public.app_settings;
create policy "Members write app settings by capability" on public.app_settings for insert to authenticated
  with check (
    public.has_org_role(auth.uid(), org_id, 'admin')
    or (public.app_setting_capability(key) is not null
        and public.has_org_role(auth.uid(), org_id, 'producer')
        and public.is_capability_enabled(org_id, public.app_setting_capability(key)))
  );
-- repeat for UPDATE (using+with check) and DELETE (using), same predicate.
```
pgTAP (`supabase/tests/rls/app_settings_capabilities.sql`): producer write `offer_response_window_hours` denied by default (edit_booking_settings off) → allowed after enabling; producer write `editor_column_templates` always denied (maps null); producer SELECT always allowed; admin writes always.

**Task 1.9c (transition-gated, HIGH RISK) — `bookings` confirm + `hire_orders` void/countersign:**
- Apply the bookings policy split from "Resolved unknowns" (name `bookings_confirm_capability`), and the analogous `hire_orders` split gating `status='void'` on `void_hire_orders` and `status='countersigned'` on `manage_countersign` (name `hire_orders_transition_capability`).
- pgTAP `supabase/tests/rls/bookings_transition_capabilities.sql` + `hire_orders_transition_capabilities.sql`: producer confirm allowed on/denied off; producer cancel ALWAYS allowed (not gated); artist self-response policy still works; admin always; SELECT unaffected. Same for void/countersign.
- **This is the task most likely to need iteration** — verify the `FOR ALL` split doesn't drop an existing allowed path (e.g. draft creation, soft-book). Enumerate every current producer booking/hire-order write path from `src/data/bookings.ts` / `src/data/hireOrders.ts` and assert each still works when the gated cap is on.

### Phase 2 — RPC in-body capability checks

**Task 2.1 — `rename_org`**: `CREATE OR REPLACE` follow-up migration changing the guard from admin-only to `admin OR (producer AND is_capability_enabled(p_org,'producer_can_rename_org'))`. pgTAP update in `supabase/tests/rpc/rename_org.sql`: producer allowed when cap on, denied off, admin always.

**Task 2.2 — `bulk_import_artists`**: `CREATE OR REPLACE` adding, after the producer/admin role check, `if has_org_role(producer) and not is_capability_enabled(p_org,'producer_can_add_artists') then raise exception 'Forbidden'`. pgTAP update: producer bulk import denied when `add_artists` off.

### Phase 3 — edge `requireCapability`

Each: insert `requireCapability(deps, org_id, '<key>')` after the existing `requireOrgRole([...,'producer'])` gate (only for the producer path; admins bypass). Add a Deno test asserting 403 `capability_disabled` when the RPC returns false and success when true (seed the fake `is_capability_enabled` RPC — see `create-invitation/index.di.test.ts` for the pattern). **Do not gate the admin/super-admin path.**

| Task | edge fn | action / gate | capability |
|---|---|---|---|
| 3.1 | `open-offer-tier`, `close-offer-tier` | after `requireOrgRole([admin,producer])` | `producer_can_run_offer_engine` |
| 3.2 | `generate-hire-orders` | per-action: `draft` → `generate_hire_orders`; `issue` → `issue_hire_orders` (add a second gate on the issue branch) | two caps |
| 3.3 | `resend-invitation` | after role gate (currently admin-only → allow producer + cap) | `producer_can_view_linked_accounts` |
| 3.4 | `airtable-schema` | allow producer + cap (currently admin-only) | `producer_can_configure_airtable` |
| 3.5 | `airtable-poll` single-org JWT path (`index.ts:568`) | allow producer + cap (currently admin-only) | `producer_can_trigger_sync` |

For 3.3/3.4/3.5 the current gate is `requireOrgRole([...,'admin'])`; widen to accept a producer who holds the capability: try admin first, else `requireOrgRole([...,'producer'])` + `requireCapability(...)`, mirroring `create-invitation`'s two-call structure.

### Phase 4 — UI rewiring (`hasRole` → `useCan`, render read-only)

Per surface, replace the hardcoded role check with `useCan(action)` and disable/hide the mutating control (never the page). Add/adjust a component test per surface asserting the control is enabled when `useCan` returns true and disabled when false (mock `@/hooks/useCapabilities` `useCan`).

| Task | file(s) | swap |
|---|---|---|
| 4.1 | `ProductionsPage.tsx` | create/edit `useCan('manage_productions')`; archive `useCan('archive_productions')`; reorder `useCan('reorder_productions')`; delete `useCan('hard_delete_productions')` |
| 4.2 | `ShowDateDetailSheet.tsx` | `canManage` split: date/edit `useCan('manage_show_dates')`; delete `useCan('hard_delete_show_dates')`; offer engine `useCan('run_offer_engine')`; confirm (`BookingRow` prop) `useCan('confirm_bookings')`; generate hire orders `useCan('generate_hire_orders')` |
| 4.3 | `CastsSection.tsx`, `CastDetailsSheet.tsx` | `useCan('manage_casts')` |
| 4.4 | `ArtistsPage.tsx`, `ArtistProfileSheet.tsx`, `LinkedAccountPanel.tsx` | single Add `useCan('add_artists')`; edit `useCan('edit_artists')`; invite chip/`canInvite` `useCan('invite_artists')`; resend/account panel `useCan('resend_account_invite')` |
| 4.5 | `HireOrdersCard.tsx`, `HireOrderDetailPage.tsx`, `OrderSlideOver.tsx`, `GenerateHireOrderDialog.tsx` | generate/issue/void/countersign → their caps |
| 4.6 | `ProductionOwnershipTab.tsx`, `CastsCitiesTab.tsx` | `useCan('manage_ownership')` / `useCan('manage_cities')` (replace the `canEnter` write-gating; keep read) |
| 4.7 | `DashboardPage.tsx` ProducerDashboard | bulk confirm/decline → `useCan('confirm_bookings')` |
| 4.8 | `ShowFormDialog.tsx` | slot fields → `useCan('edit_scheduling')` (UI-only) |

### Phase 5 — broad-Settings read-only surfaces

Expose the admin-only Settings tabs to producers **read-only**. For each: (a) change the nav `show:` predicate in `SettingsPage.tsx` from `isAdmin` to `isAdmin || isProducer`; (b) thread a `readOnly` boolean (`= !useCan(<edit cap>)`) into the tab body and disable every write control + hide/disable Save; (c) the org-rename control in `OrganizationTab` gated by `useCan('rename_org')`.

| Task | tab | nav change | edit capability (readOnly = !useCan) |
|---|---|---|---|
| 5.1 | Booking flow (`BookingFlowTab`) | `show: isAdmin \|\| isProducer` | `edit_booking_settings` |
| 5.2 | Airtable (`AirtableSyncTab`) | `isAdmin \|\| isProducer` | `configure_airtable` (Sync-now uses `trigger_sync`) |
| 5.3 | Filters + Notifications | `isAdmin \|\| isProducer` | `edit_filter_settings` |
| 5.4 | Hire orders (`HireOrdersTab`) | `(isAdmin \|\| isProducer) && hireOrdersEntitled` | `edit_hire_order_settings` |
| 5.5 | Organization (`OrganizationTab`) | `isAdmin \|\| isProducer` | rename control `useCan('rename_org')` |

Each task: a component test asserting the tab renders for a producer and its write controls are disabled when the cap is off, enabled when on.

### Phase 6 — producer invitations affordance (net-new UI)

`manage_invitations` needs a producer-reachable revoke/resend for **artist** invitations (Admin console stays admin-only). Add a small control to the Artists page pending-invite chip (`ArtistsPage.tsx` / the `AccountStatusChip` area) that, gated by `useCan('manage_artist_invitations')`, calls the existing revoke (`src/data/invitations.ts`) and resend paths — now permitted by the Phase 1.7 RLS + Phase 3.3 edge cap. Component test: control visible+enabled for a producer with the cap, absent/disabled without.

### Phase 7 — E2E + full verification

- **Task 7.1 — headline E2E** (`e2e/`): admin turns OFF a default-on right (issue hire orders) in Settings → Roles & permissions → a producer session can no longer issue but still **views** the order; admin turns ON a default-off right (hard-delete productions) → producer can delete. Covers both directions + the read-only floor.
- **Task 7.2 — full verification**: whole pgTAP suite (all new `*_capabilities.sql` + updated `rename_org`/`bulk_import_artists`), whole Deno edge suite, `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`, `npx vitest run` (re-run any load-flake file in isolation). Changelog entry (Settings → Roles & permissions; customer-facing, no super-admin mention). Update `docs/adr/README.md` key-decisions + `CLAUDE.md` capability notes if needed. (No `docs/system-map.md` change — no new automation triggers.)

---

## Self-Review

**Spec coverage:** all 27 rights appear in the enforcement map with a concrete site and mechanism; §6 read-only floor honored (no SELECT gated; UI renders read-only; Phase 5 exposes the four tabs); §6 defense-in-depth met per right except the explicitly-documented **U-only** rights (archive/reorder productions, edit_scheduling) whose server enforcement is a coarser sibling, and **confirm/void/countersign** handled via transition predicates. Both §11 unknowns resolved with concrete SQL (Phase 0 helper; Phase 1c transition pattern).

**Honesty flags (carry into execution):**
- **U-only rights** (#4, #5, #25): a determined producer with the coarser cap on could still perform the sub-action via the API. Documented; acceptable because the coarser cap is the real security boundary and these are low-stakes. If true per-action enforcement is later required, route them through dedicated RPCs.
- **Phase 1c transition RLS** is the highest-risk work: splitting a `FOR ALL` policy risks dropping an existing allowed write path. Its pgTAP must enumerate every current producer write path on `bookings`/`hire_orders` and prove each still works.
- **#13 add_artists** and **#2/#6 defaults** are the deploy-visible behavior changes (already live from Plan 1's default flip for the on-by-default ones; #6/#8/#12/#20/#21/#24/#26/#27 default off, so enabling them is opt-in).

**Type/name consistency:** capability keys match `CAPABILITY_DEFS` exactly; `useCan(action)` uses the `action` field (not the key); edge/RPC/RLS use the full `producer_can_*` key. `app_setting_capability` and `is_capability_enabled` names are consistent across Phase 0/1/2.

**Scale:** ~9 RLS migrations + pgTAP, 2 RPC migrations + pgTAP, 5 edge changes + Deno tests, 8 UI-rewire tasks, 5 read-only-tab tasks, 1 net-new UI, 1 E2E. Large but decomposed; consider executing Phase 1 (RLS) as its own subagent-driven run before the UI phases.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-23-per-org-user-group-rights-enforcement.md`. Not executed (per your choice) — review the enforcement approach, especially Phase 1c (transition RLS) and the U-only granularity notes, before we build.**
