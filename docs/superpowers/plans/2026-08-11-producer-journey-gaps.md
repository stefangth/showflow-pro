# Production Team Journey Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Execution: Phase 0 (DB foundation) is done by the main session first, sequentially, because its two migrations share one local `db reset` + `types.ts` regeneration. Then the four work packages (WP-P1..WP-P4) run **in parallel** as one wave (their file sets are disjoint), each dispatched to a fresh implementer subagent, then two-stage reviewed (implementer -> independent reviewer -> address findings) before its commit agent lands the WP's file list. WP-P2 and WP-P3 depend on Phase 0's regenerated types; WP-P1 and WP-P4 do not.

**Goal:** Close the open PRODUCTION TEAM journey items from `docs/research/2026-08-09-user-type-journey-questions.md`, extracting shared values instead of hardcoding, and reusing the point-of-action narration helpers the admin session already shipped to main.

**Architecture:** One shared DB foundation, then four disjoint-file work packages in a single wave. **Phase 0 (main session, pgTAP TDD):** two additive migrations (`list_org_admin_names` producer-safe RPC for P2.3; `hire_orders.viewed_at` column + `mark_hire_order_seen` SECURITY DEFINER RPC for P4.6), applied to the local stack, then `types.ts` + edge mirror regenerated and pgTAP green. Front-loading the DB work gives the workflow a typed foundation and avoids concurrent `db reset` in a shared worktree. **Wave 1 (workflow):** WP-P1 cockpit action narration (P3.1/P3.2/P3.3/P3.4/P3.5/P5.1/P5.2), WP-P2 producer role + admin-names UI (P0.2/P2.3-frontend), WP-P3 hire-order void + seen UI (P4.5/P4.6-frontend), WP-P4 tier-at-risk recovery + email (P4.2). File sets are disjoint, so all four run in parallel.

**Tech Stack:** React 18 + TS 5, react-query v5, vitest + `src/test/` harness (`supabaseFake`, `renderWithProviders`, `castHelpers`), Deno edge functions with `handle(req, deps)` DI + `makeFakeDeps`, pgTAP (`supabase test db`), `scripts/sync-mirrors.mjs` for dual-homed values.

## Global Constraints

- **TDD is mandatory**: failing test first, then implementation. Tests import the real module. Never re-implement logic in a test. Pure copy helpers get unit tests; the two RPCs get pgTAP tests; the edge send gets a Deno DI test.
- **Extract shared values over hardcoding**: digest hours via `resolveOrgSetting(...)` / `useFlowTimes(orgId)` + `BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin`; the flow shape via `useBookingFlow`; role label via `roleLabel('producer')` (renders "Production Team"); role blurb via `ROLE_DESCRIPTIONS.producer`; routes via `ROUTES` (`ROUTES.SETTINGS`, `ROUTES.BOOKINGS`, `ROUTES.HIRE_ORDER_DETAIL`); email host via `_shared/app-url.ts` `APP_URL`. Reuse `scheduleChangeNote` (`src/lib/notifications/scheduleChangeCopy.ts`) rather than re-authoring the who-hears line.
- **No em/en dashes in any user-facing copy** (UI strings, tooltips, dialog text, email copy, notification messages). Use period/comma/colon/middot. A `/[—–]/` assertion guards each new copy module's test.
- **Consequence-first, producer voice** ("what happens next, and when"), matching the approved before/after mockup (artifact `34773ec3-2899-43a7-9ca9-012521a18f51`). The mockup is the copy spec; implementers reproduce its strings verbatim (they appear inline below).
- **Semantic Tailwind tokens only** (`text-muted-foreground`, `bg-accent-500`, never raw colors); accent numbered stops take no opacity modifiers.
- **Static copy must hold in every reachable org state** (direct-book, immediate delivery, digests off, no Airtable, unregistered artists). When a surface cannot read the flow, name what the row HOLDS, not what one pipeline does. Every flow-aware helper returns the honest string (or `null`) per state; tests cover each branch.
- **Mirrored files**: edit the SOURCE (`src/lib/emailTemplates/emailCopy.ts`; `src/integrations/supabase/types.ts` is regenerated, not hand-edited), then `npm run sync:mirrors`. Never hand-edit `supabase/functions/_shared/*` mirror targets. `npm run sync:mirrors:check` must be clean.
- **Migrations**: additive only, distinct `2026-08-11` timestamps, no collision with existing versions. Applied to the LOCAL stack in Phase 0; production applies them on merge (do NOT hand-apply to prod). Every new RPC follows the guarded pattern: `security definer` + `set search_path = public` + membership/identity guard raising `42501` + `revoke all on function ... from public, anon; grant execute ... to authenticated`.
- **Git safety for agents**: implementers and critics NEVER run `git commit`, `git reset`, `git rebase`, `git checkout <ref>`, `git stash`, or amend/drop commits. WPs in the wave share the worktree; a dedicated commit agent lands each WP's exact file list after the wave. Critics inspect via `git diff -- <wp paths>` / `git status --porcelain -- <wp paths>`.
- **Test runs during rounds**: targeted (`npx vitest run <paths>`, no `--coverage`; `deno test --allow-all <fn dir>` for edge; `deno check --node-modules-dir=none <fn>/index.ts` after any edge change). Full `npm run verify:fast` runs once after the wave; `npm run verify:full` (pgTAP + e2e) if the local stack is up.
- No changelog / version bump on this branch (release packaging is the owner's call; recorded in the context file).

## Already handled (no task)

- **P4.3** (understudy notification deep-link): live on main. `notificationTarget()` routes `understudy_promoted` (entity `booking`) and every producer notification to `ROUTES.BOOKINGS`. Nothing to do.
- **P0.1** (invite email, producer wording): verified covered by the admin rewrite. A producer sees "Your role is Production Team. You plan productions and show dates, and book artists into them." No change; a one-line regression assertion in WP-P2's role test pins that `ROLE_DESCRIPTIONS.producer` stays dash-free and non-empty.

---

## Phase 0 — DB foundation (main session, pgTAP TDD)

Two additive migrations, then regenerate types + mirrors so Wave 1 typechecks. Both RPCs mirror `list_pending_invited_artists` (`supabase/migrations/20260701165232_list_pending_invited_artists.sql`).

**Files:**
- Create: `supabase/migrations/20260811090000_list_org_admin_names.sql`
- Create: `supabase/migrations/20260811090100_hire_orders_viewed_at.sql`
- Create: `supabase/tests/list_org_admin_names.test.sql` (pgTAP)
- Create: `supabase/tests/hire_orders_viewed_at.test.sql` (pgTAP)
- Regenerate: `src/integrations/supabase/types.ts`, then `supabase/functions/_shared/database.types.ts` via `npm run sync:mirrors`

**Interfaces (produced):**
```sql
-- P2.3: any org member may read the display names of the org's admins (names only, no emails/ids)
create function public.list_org_admin_names(p_org uuid) returns setof text
-- returns distinct non-null profiles.display_name for org_memberships role='admin' in p_org

-- P4.6: the linked artist stamps first-view on an issued/countersigned order (idempotent)
create function public.mark_hire_order_seen(p_order uuid) returns void
-- stamps hire_orders.viewed_at = now() only when caller is the linked artist,
-- status in ('issued','countersigned'), and viewed_at is null
```
```ts
// generated into types.ts after regeneration (do not hand-edit):
list_org_admin_names: { Args: { p_org: string }; Returns: string[] }
mark_hire_order_seen:  { Args: { p_order: string }; Returns: undefined }
// hire_orders Row/Update gains: viewed_at: string | null
```

- [ ] **Step 1 (test first, P2.3):** `supabase/tests/list_org_admin_names.test.sql`: seed an org with an admin (display_name 'Nadia Okonkwo'), a producer, and a second org's admin. Assert: called as the producer, `list_org_admin_names(org)` returns exactly `{'Nadia Okonkwo'}` (not the other org's admin, not the producer); called as a non-member, it raises `42501`; an admin with NULL display_name is omitted. Run `supabase test db`: fails (function missing).
- [ ] **Step 2 (P2.3):** Write `20260811090000_list_org_admin_names.sql`:
  ```sql
  create or replace function public.list_org_admin_names(p_org uuid)
  returns setof text language plpgsql stable security definer set search_path = public as $$
  begin
    if not public.is_org_member(auth.uid(), p_org) then
      raise exception 'Forbidden: org members only' using errcode = '42501';
    end if;
    return query
      select distinct p.display_name
      from public.org_memberships m
      join public.profiles p on p.user_id = m.user_id
      where m.org_id = p_org and m.role = 'admin' and p.display_name is not null and p.display_name <> ''
      order by p.display_name;
  end; $$;
  revoke all on function public.list_org_admin_names(uuid) from public, anon;
  grant execute on function public.list_org_admin_names(uuid) to authenticated;
  ```
- [ ] **Step 3 (test first, P4.6):** `supabase/tests/hire_orders_viewed_at.test.sql`: seed an issued order linked to artist A (user uA) in org O. Assert: `hire_orders` has a nullable `viewed_at`; called as uA, `mark_hire_order_seen(order)` sets `viewed_at` non-null; a second call does NOT change it (idempotent, still the first timestamp); called as a different user, it raises `42501` and leaves `viewed_at` untouched; on a `draft` order it raises `42501` (only issued/countersigned are viewable). Run: fails.
- [ ] **Step 4 (P4.6):** Write `20260811090100_hire_orders_viewed_at.sql`:
  ```sql
  alter table public.hire_orders add column if not exists viewed_at timestamptz;
  create or replace function public.mark_hire_order_seen(p_order uuid)
  returns void language plpgsql volatile security definer set search_path = public as $$
  declare v_ok boolean;
  begin
    select exists (
      select 1 from public.hire_orders ho
      join public.artists a on a.id = ho.artist_id
      where ho.id = p_order and a.user_id = auth.uid()
        and ho.status in ('issued','countersigned')
    ) into v_ok;
    if not v_ok then
      raise exception 'Forbidden: not the linked artist for a viewable order' using errcode = '42501';
    end if;
    update public.hire_orders set viewed_at = now() where id = p_order and viewed_at is null;
  end; $$;
  revoke all on function public.mark_hire_order_seen(uuid) from public, anon;
  grant execute on function public.mark_hire_order_seen(uuid) to authenticated;
  ```
  (The `enforce_hire_order_transition` freeze trigger only freezes `data, fee_amount, fee_currency, terms_variant, order_no, pdf_path`, so stamping `viewed_at` on an issued row is allowed; SECURITY DEFINER bypasses RLS regardless.)
- [ ] **Step 5:** Apply + regenerate against the LOCAL stack, then verify:
  ```bash
  supabase db reset            # applies all migrations incl. the two new files + seed
  supabase test db             # both pgTAP suites green
  supabase gen types typescript --local > src/integrations/supabase/types.ts
  npm run sync:mirrors && npm run sync:mirrors:check
  npx tsc -p tsconfig.app.json --noEmit
  ```
  Confirm `types.ts` now carries both function signatures and `hire_orders.viewed_at`. `generatedTypes.test.ts` must still pass (single non-null `uuid` arg generates cleanly; no widening needed).
- [ ] **Step 6:** Commit `feat(db): producer-safe admin-names RPC and hire-order seen stamp`.

---

## Wave 1

### WP-P1: Cockpit point-of-action narration

Closes P3.2 (confirm consequences), P3.3 (soft-booked meaning), P3.4 (tier concept), P3.5 (outside-cast rule), P5.1 (understudy-promotion preview) + P5.2 (cancel: who is told), P3.1 (dates source), and P3.6 (when do artists hear) which is answered inline by the confirm consequence line and the cancel who-hears line (the two actions that had no narration; open-tier already narrates delivery via `DryRunDialog`/`offerConfirmCopy`). All reuse `useFlowTimes`, `useBookingFlow`, `scheduleChangeNote`, and `ROUTES` from main. No schema changes.

**Files:**
- Create: `src/lib/bookings/actionCopy.ts` + `src/lib/bookings/actionCopy.test.ts`
- Modify: `src/components/shows/date/CockpitCastList.tsx` (confirm consequence line; wrap per-row Cancel in an AlertDialog; soft-booked tooltip on the "Accepted" badge)
- Modify: `src/components/shows/ShowDateDetailSheet.tsx` (pass flow/times into the cast list; name the artist in the per-row confirm toast)
- Modify: `src/components/shows/date/TierTimeline.tsx` (tier-concept line + "How casts and tiers work" doc link)
- Modify: `src/components/shows/date/EligibilityBookList.tsx` (unrestricted-eligibility note, shown only when the date has no cast limits)
- Modify: `src/components/shows/BookingRow.tsx` (soft-booked tooltip on the module-off "Soft-booked" badge)
- Modify: `src/components/shows/ShowDateFormDialog.tsx` (dates-source note, create mode only)
- Tests: co-located `.test.tsx` for each modified component (extend existing suites).

**Interfaces (produced):**
```ts
// src/lib/bookings/actionCopy.ts  (all pure, all dash-free, all covered per branch)
import type { BookingFlow } from '@/types';
type ConfirmFlow = Pick<BookingFlow, 'active' | 'confirmation_digest'>;

export function confirmConsequenceNote(flow: ConfirmFlow | null | undefined, confirmationDigestHour: number): string;
//  flow.active && confirmation_digest  -> "Confirm places the booking. The artist sees it in the app right away. The confirmation email goes out in the daily summary at {H}:00 Berlin."
//  flow.active && !confirmation_digest -> "Confirm places the booking and notifies the artist in the app right away."
//  !flow || !flow.active               -> "Confirm places the booking."

export const SOFT_BOOKED_MEANING = 'Accepted the offer. Held for you, not booked, until you confirm.';

export const TIER_CONCEPT_NOTE = 'Tiers are your casts in priority order. Offers open with tier 1. If it cannot fill, you open the next tier.';

export function unrestrictedEligibilityNote(orgName: string): string;
//  -> `This date has no cast limits, so anyone in ${orgName} can be booked here.`

export const DATE_SOURCE_NOTE = 'You can add a show date by hand here. If your workspace syncs from Airtable, those dates keep updating on their own, and a date you add here is not changed by a sync.';

export function cancelBookingCopy(args: {
  artistName: string;
  understudyPromotionEnabled: boolean;   // flow.active && flow.understudy_promotion
  bookingFlowEnabled: boolean;
  flow: Pick<BookingFlow,'active'|'confirmation_digest'> | null | undefined;
  confirmationDigestHour: number;
}): { title: string; understudyLine: string | null; whoHearsLine: string };
//  title = `Cancel ${artistName}'s booking?`
//  understudyLine = understudyPromotionEnabled
//     ? `If ${artistName} is in the main cast, the longest waiting accepted understudy is promoted automatically.` : null
//  whoHearsLine = scheduleChangeNote(bookingFlowEnabled, flow, confirmationDigestHour) ?? 'The artist is notified in the app.'
```

**Interfaces (consumed):** `useFlowTimes(orgId)` -> `{ confirmationDigestHour }` (`src/hooks/useBookingFlow.ts`); `useBookingFlow(orgId)` -> `{ active, confirmation_digest, understudy_promotion, artist_acceptance }`; `scheduleChangeNote` (`src/lib/notifications/scheduleChangeCopy.ts`); `ROUTES.SETTINGS`; the eligibility "unrestricted" signal already derived on the sheet (`deriveDirectBookList` / `eligibility.artistIds == null`); `useAuth().currentOrg?.name`.

- [ ] **Step 1 (test first):** `actionCopy.test.ts`: assert each `confirmConsequenceNote` branch string exactly, both `cancelBookingCopy` shapes (understudy on/off; whoHears fallback when `scheduleChangeNote` returns null), `unrestrictedEligibilityNote('Cirque Lumiere')`, and the three constants; `/[—–]/` fails on every returned string and constant. Run: fails (module missing).
- [ ] **Step 2:** Implement `actionCopy.ts` importing `scheduleChangeNote`. Pass.
- [ ] **Step 3 (test first, P3.2):** `CockpitCastList.test.tsx`: when a row is `accepted`/`soft_booked` and the flow is active with digests on, the confirm consequence line renders with the resolved hour; the per-row confirm toast names the artist. Implement: render `confirmConsequenceNote(flow, confirmationDigestHour)` as a `text-xs text-muted-foreground` line under the cast actions (once per list, near the Confirm control), reading flow/times threaded from `ShowDateDetailSheet`; change the per-row confirm success toast to `Booked ${name}.`. Pass.
- [ ] **Step 4 (test first, P5.1/P5.2):** `CockpitCastList.test.tsx`: clicking the per-row Cancel opens an AlertDialog whose title is `Cancel ${name}'s booking?`, whose body shows the understudy line when `understudy_promotion` is on and the who-hears line from `scheduleChangeNote`, with actions "Keep booking" / "Cancel booking"; the mutation fires only after confirming "Cancel booking". Implement: wrap the existing per-row Cancel (`CockpitCastList.tsx:112`) in an `AlertDialog` built from `cancelBookingCopy(...)`; do NOT add a dialog to the whole-date "Cancel date" path (it already narrates and does not promote). Pass.
- [ ] **Step 5 (test first, P3.3):** `CockpitCastList.test.tsx` + `BookingRow.test.tsx`: the "Accepted" badge (cockpit) and the "Soft-booked" badge (module-off) carry a tooltip whose content is `SOFT_BOOKED_MEANING`. Implement via the shared `IconTooltip`/`Tooltip` primitive wrapping the badge. Pass.
- [ ] **Step 6 (test first, P3.4):** `TierTimeline.test.tsx`: the tier picker area renders `TIER_CONCEPT_NOTE` and a link "How casts and tiers work" whose href is `` `${ROUTES.SETTINGS}?tab=docs` ``. Implement near the tier `Select` (`TierTimeline.tsx:161`). Pass.
- [ ] **Step 7 (test first, P3.5):** `EligibilityBookList.test.tsx`: when the date's eligibility is unrestricted, `unrestrictedEligibilityNote(orgName)` renders above the artist list; when restricted, it does not. Implement, threading the unrestricted flag + org name from `ShowDateDetailSheet`. Pass.
- [ ] **Step 8 (test first, P3.1):** `ShowDateFormDialog.test.tsx`: in create mode the dialog shows `DATE_SOURCE_NOTE`; in edit mode it does not. Implement. Pass.
- [ ] **Step 9:** Commit `feat: show-date cockpit narrates confirm, cancel, soft-booked, tiers and eligibility`.

### WP-P2: Producer role explainer + admin names

Closes P0.2 (role vs admin, producer-reachable) and P2.3-frontend (name the admins). Consumes the `list_org_admin_names` RPC from Phase 0.

**Files:**
- Create: `src/data/orgAdmins.ts` (`fetchOrgAdminNames`) + `src/data/orgAdmins.test.ts`
- Create: `src/hooks/useOrgAdminNames.ts`
- Modify: `src/components/bookings/setup/BookingProducerWaitingCard.tsx` (name the admins in the waiting body; role explainer line + doc link)
- Modify: `src/lib/dashboard/moduleOnboarding.ts` (producer role-explainer rule in the complete-state rules, reusing `ROLE_DESCRIPTIONS.producer` + `?tab=docs`)
- Tests: `BookingProducerWaitingCard.test.tsx`, `moduleOnboarding.test.ts`, `orgAdmins.test.ts`.

**Interfaces (produced):**
```ts
// src/data/orgAdmins.ts
export async function fetchOrgAdminNames(client: SupabaseClient<Database>, orgId: string): Promise<string[]>;
//  client.rpc('list_org_admin_names', { p_org: orgId }); returns [] on error (never throws to the card)

// src/hooks/useOrgAdminNames.ts
export function useOrgAdminNames(orgId: string | undefined): UseQueryResult<string[]>;
//  queryKey ['org-admins', 'names', orgId]; enabled: !!orgId

// helper for the card (pure, tested):
export function adminAskLine(names: string[]): string | null;
//  []            -> null  (card falls back to the generic "an admin" copy)
//  ['Nadia']     -> 'Ask Nadia to finish setup before anyone can be booked.'
//  ['Nadia','Tom'] -> 'Ask Nadia or Tom to finish setup before anyone can be booked.'
//  3+            -> 'Ask Nadia, Tom or another admin to finish setup before anyone can be booked.'
```

**Interfaces (consumed):** `ROLE_DESCRIPTIONS.producer` + `roleLabel('producer')` (`src/config/app.config.ts`); `ROUTES.SETTINGS`; `useAuth().currentOrg`.

- [ ] **Step 1 (test first):** `orgAdmins.test.ts` with `supabaseFake`: `fetchOrgAdminNames` calls `rpc('list_org_admin_names', { p_org })` and returns the string array; on error returns `[]`. `adminAskLine` covers 0/1/2/3+ names and is dash-free. Run: fails.
- [ ] **Step 2:** Implement `fetchOrgAdminNames`, `adminAskLine`, and `useOrgAdminNames`. Pass.
- [ ] **Step 3 (test first, P2.3):** `BookingProducerWaitingCard.test.tsx`: with admin names `['Nadia Okonkwo','Tom Reeve']` the waiting body reads "Nothing stops you adding dates and sessions. Ask Nadia Okonkwo or Tom Reeve to finish setup before anyone can be booked."; with `[]` it renders the existing generic "An admin has to finish setup" copy unchanged. Implement using `useOrgAdminNames` + `adminAskLine`, falling back to the current string when the line is null. Pass.
- [ ] **Step 4 (test first, P0.2):** `BookingProducerWaitingCard.test.tsx` + `moduleOnboarding.test.ts`: the producer waiting card and the producer complete-state rules both carry a role-explainer line "You are on the Production Team. You plan dates, run offers and confirm bookings. Inviting people, casts and settings stay with the admin." and a link "See what each role can do" -> `` `${ROUTES.SETTINGS}?tab=docs` ``; the line is absent for the admin role. Implement: a `PRODUCER_ROLE_NOTE` constant + link rendered on the waiting card and as a producer-only rule in `moduleOnboarding.ts`. Assert `ROLE_DESCRIPTIONS.producer` stays non-empty and dash-free (the P0.1 regression pin). Pass.
- [ ] **Step 5:** Commit `feat: producers see who their admins are and what their role covers`.

### WP-P3: Hire-order void copy + artist-seen timeline

Closes P4.5 (void-then-redraft copy) and P4.6-frontend (Seen step). Consumes `mark_hire_order_seen` + `hire_orders.viewed_at` from Phase 0. (Hire-orders module ships dark; these render only where the entitlement is on.)

**Files:**
- Modify: `src/data/hireOrders.ts` (`markHireOrderSeen`) + `src/data/hireOrders.test.ts`
- Modify: `src/hooks/useHireOrders.ts` (`useMarkHireOrderSeen`, silent)
- Modify: `src/components/hireOrders/OrderSlideOver.tsx` (void dialog copy)
- Modify: `src/components/hireOrders/OrderTimeline.tsx` (insert "Seen" step)
- Modify: `src/pages/HireOrderDetailPage.tsx` (stamp on first view by the linked artist; pass `seenAt`)
- Tests: `hireOrders.test.ts`, `OrderTimeline.test.tsx`, `OrderSlideOver.test.tsx`, `HireOrderDetailPage.test.tsx` (extend existing).

**Interfaces (produced):**
```ts
// src/data/hireOrders.ts
export async function markHireOrderSeen(client: SupabaseClient<Database>, id: string): Promise<void>;
//  client.rpc('mark_hire_order_seen', { p_order: id }); throws on error

// src/hooks/useHireOrders.ts
export function useMarkHireOrderSeen(): UseMutationResult<void, Error, string>;
//  silent on success (no toast); busts ['hire-orders'] via invalidateHireOrders
```

- [ ] **Step 1 (test first):** `hireOrders.test.ts`: `markHireOrderSeen` calls `rpc('mark_hire_order_seen', { p_order })`. Run: fails. Implement. Pass.
- [ ] **Step 2 (test first, P4.5):** `OrderSlideOver.test.tsx`: the void AlertDialog body reads "Voiding cancels this order for good. If the artist needs a corrected order, you can generate a fresh hire order for this date afterward." (title "Void this hire order?" and button "Void order" unchanged). Implement. Pass.
- [ ] **Step 3 (test first, P4.6):** `OrderTimeline.test.tsx`: `STEPS` becomes `["Created","Issued to artist","Seen","Awaiting countersign","Countersigned"]`; a new `seenAt` prop drives the "Seen" step timestamp; the "Seen" step reads as reached only when `seenAt` is present (not purely by index), so an issued-but-unseen order shows "Seen" pending while "Awaiting countersign" is active; `activeStepIndex` maps `issued -> 3`, `countersigned -> 4`. Implement: add the label, the `seenAt` branch to `stepTimestamp`, shift `activeStepIndex`, and gate the "Seen" completed state on `seenAt != null`. Pass.
- [ ] **Step 4 (test first, P4.6 wiring):** `HireOrderDetailPage.test.tsx`: when the viewer is the linked artist (`myArtist.id === order.artist_id`), the order status is `issued`/`countersigned`, and `order.viewed_at` is null, `useMarkHireOrderSeen().mutate(order.id)` fires once on load; it does NOT fire for a producer/admin viewer, for a draft order, or when `viewed_at` is already set. `OrderTimeline` receives `seenAt={order.viewed_at}`. Implement with a guarded `useEffect`. Pass.
- [ ] **Step 5:** Commit `feat: hire orders show when the artist first saw them, and void copy points to redraft`.

### WP-P4: Tier-at-risk recovery guidance + email

Closes P4.2. The in-app message gains recovery guidance; a new `tier-at-risk` email mirrors `cast-escalation-requested`. Follows the WP4b (`airtable-sync-held`) pattern from the admin session.

**Files:**
- Create: `supabase/functions/_shared/transactional-email-templates/tier-at-risk.tsx`
- Modify: `supabase/functions/tier-at-risk-watcher/index.ts` (soften + append recovery guidance to the notification message; email each recipient for a newly-inserted at-risk pair)
- Modify: `supabase/functions/_shared/transactional-email-templates/registry.ts` (register `tier-at-risk`, family `ember`, subject resolver)
- Modify: `src/lib/emailTemplates/emailCopy.ts` (+ `npm run sync:mirrors` -> `_shared/.../emailCopy.ts`)
- Modify: `src/lib/emailTemplates/coverage.ts` (coverage row: group "Booking engine", recipient "Producers", trigger "Tier can't fill on current offers (tier-at-risk-watcher)", status "editable")
- Tests: `tier-at-risk-watcher` Deno DI tests, template registry test, `coverage.ts` test, `app-links.test.ts` (CTA host guard).

**Interfaces:** template key `tier-at-risk`; `templateData { program, date, tier, pending, accepted, required, reviewUrl }`; `reviewUrl = \`${APP_URL}/bookings\`` via `_shared/app-url.ts`. Recipient emails resolved per uid via `deps.admin.auth.admin.getUserById(uid)` (mirror `expire-offers` cast-escalation).

**Copy (in-app message, in `tier-at-risk-watcher`):**
`Tier ${tier} for ${program ?? 'show'} on ${date} cannot fill on the current offers (${pending} pending, ${accepted} accepted, need ${required}). Open the next tier or book directly from the eligibility list to fill it.`

**Copy (email `tier-at-risk`):** subject `A tier is running short for {{program}} on {{date}}`; body `Tier {{tier}} for {{program}} on {{date}} cannot fill on the current offers. {{pending}} pending, {{accepted}} accepted, and {{required}} needed. Open the next tier, or book directly from the eligibility list.`; CTA `Review this date`.

- [ ] **Step 1 (test first):** Extend `tier-at-risk-watcher`'s Deno DI test (`makeFakeDeps`): for a tier that becomes at-risk (a NEW notification pair is inserted), `deps.sendEmail` is called once per resolved recipient with `template_name: 'tier-at-risk'`, subject containing the program, and `templateData.reviewUrl` ending `/bookings`; for a tier already at-risk (pair already exists) no email is sent; the notification message contains "Open the next tier". Recipient emails come from `deps.admin.auth.admin.getUserById`. Email failure is swallowed (the watcher still completes). Run: fails.
- [ ] **Step 2:** Implement: soften/append the message; after inserting each new pair, resolve the recipient email and best-effort `deps.sendEmail(...)` inside try/catch (log, never throw). Add the template `.tsx`, register it (family `ember`, subject resolver), add the `emailCopy.ts` keys and `npm run sync:mirrors`, add the coverage row. Confirm the coverage row is visible in Settings -> Email templates (recipient "Producers", status "editable" is not gated out; no `EmailTemplatesTab` change expected, but assert visibility in its test if the internal/audience gate touches it).
- [ ] **Step 3:** `deno check --node-modules-dir=none supabase/functions/tier-at-risk-watcher/index.ts`; full Deno suite for `tier-at-risk-watcher` and the templates dir; `npm run sync:mirrors:check`; vitest for `coverage.ts` + `app-links.test.ts`.
- [ ] **Step 4:** Commit `feat: tier-at-risk suggests recovery actions and emails the producers`.

---

## Verification (after the wave)

- [ ] `npm run verify:fast` green (lint zero-warning, tsc app+tools, build, vitest+coverage, deno check).
- [ ] `npm run verify:full` if the local stack is up (adds pgTAP for the two new RPCs + Playwright e2e).
- [ ] `npm run sync:mirrors:check` green.
- [ ] Update `docs/research/user-journey-gaps-context.md` Production-team status table (IDs -> shipped, with branch) and the Decision log.
- [ ] Republish the research artifact (`34773ec3-...` before/after; and the status artifact `947c3125-...`) with shipped marks, keeping the same URLs.

## Out of scope (recorded in the context file)

- **P0.1** and **P4.3**: already covered on main (see "Already handled").
- Email open-pixel tracking for P4.6: rejected on privacy grounds. "Seen" means the linked artist opened the order in the app, stamped once via `mark_hire_order_seen`. No email-open instrumentation.
- Changelog + version bump: owner packages releases.
