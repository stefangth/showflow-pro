# Demo Mode — Design

- **Date:** 2026-08-16
- **Status:** Design approved (pending written-spec review)
- **Author:** Claude + owner
- **Related:** `src/features/editor/*` (toolbar + view-as pattern), `supabase/functions/provision-org`, `supabase/seed.sql`, `src/lib/entitlements.ts`

---

## 1. Summary

A first-class **Demo Mode** so the owner and multiple salespeople can demo Showflow Pro to prospects against a real, polished, self-contained workspace. Each rep gets their **own real Supabase org** flagged as a demo (`organizations.is_demo = true`), seeded with a curated dataset that exercises every UI lens, wrapped in an in-app **demo control bar + docked "run of show" rail** (design option **1a**), with hard **email/PDF guardrails**, one-click **reset/wipe/reseed**, and a declarative **scene + cue engine** that scripts the key sales journey.

Demos run against the real backend (realtime, booking engine, edge functions all genuinely execute) rather than a faked client, because the product answers "always online is fine." The two hard problems this design solves are **repeatability** (reset between demos) and **side-effect safety** (never deliver a real email/PDF from fake data).

## 2. Goals / Non-goals

**Goals**
- A rep demos on a real org that looks alive from every angle a free-click can land on.
- All demo side effects (email, PDF delivery) are contained and turned into *showable* artifacts.
- A rep can reset their own demo org to pristine in one click, and only ever their own.
- A scripted "run of show" guides the key journey; reps can also free-click.
- Super-admins provision and manage demo orgs from the Platform console.
- Role/persona switching to show admin / production / artist perspectives live.

**Non-goals**
- Offline operation (explicitly out — online is assumed).
- A shared multi-rep demo dataset (explicitly out — each rep is isolated).
- A real, controllable simulation clock (see Decision 5 — cues instead).
- Public marketing/changelog exposure (demo mode is an internal sales/super-admin tool; per `CLAUDE.md` it never appears in the public changelog).

## 3. Locked decisions (with rationale)

1. **Approach A — real per-rep demo orgs**, not a client-side fake. Reuses `switchOrg`, view-as, provisioning, and the seed catalog; full fidelity; lowest net build cost. A faked client would require a client-injection seam that does not exist and would drift from real behavior.
2. **`organizations.is_demo` boolean column**, not a `demo_mode` entitlement. It is an org *type*, not a purchasable module. A bare column keeps the entitlements registry (a customer-facing "modules you bought" concept + generated mirror + SQL twin) clean, is read directly in all three layers, and — critically — avoids two footguns the entitlement path carries: (a) the destructive wipe guard would depend on an indirect, *defaultable* resolver in a separate table instead of the same row it wipes; (b) `useModuleGate` exempts non-impersonating super-admins, so an entitlement-keyed demo bar would render on *every real customer org* for any super-admin. A column shows the bar iff the org truly is a demo, for everyone.
3. **Provisioning: "New demo org" per rep from Platform → Organizations** (super-admin action). Reps are **admin members of their own demo org** (tight blast radius), not super-admins.
4. **Reset is always scoped to the rep's own demo org.** The wipe routine hard-refuses on any org where `is_demo = false`, triple-guarded (RPC + edge caller + UI).
5. **Time is narrative; cues are deterministic scripted mutations.** No real controllable clock (would mean rebuilding "now" across RLS/crons/edge and is fragile in a live demo). The sim clock is a *display device*; each cue (`Run clock to 17:00`, `Yasmin accepts`, `Drop 3 notifications`) is a named, idempotent server action applying a pre-authored state delta — instant, deterministic, undone by Reset. Artist actions run as server cues; the role toggle only switches the rendered perspective.

## 4. Architecture overview

Three planes, mapped to existing patterns:

- **Data plane** — a demo org is an ordinary tenant with `is_demo = true`. All existing RLS/org-isolation applies unchanged. New: seed/wipe RPCs, a demo-state table (sim clock + current scene), a captured-sends table, and (Phase 3) a sandbox-link table.
- **Server plane** — new edge function `demo-ops` (create/seed/wipe/reset/cue/link), plus `is_demo` checks added to send-side functions to divert email/PDF into the captured-sends store. Follows the DI `handle(req, deps)` + `_shared/auth.ts` + `_shared/http.ts` conventions.
- **UI plane** — a `DemoProvider` (mirroring `EditorProvider`) exposing demo state + actions; the **demo control bar**, **DEMO badge**, and **run-of-show rail** rendered by `AppLayout` when `currentOrg.is_demo`. Role switching reuses the existing `viewAsRole`/`viewAsUser` plumbing on `AuthContext`.

## 5. Data model

- **`organizations.is_demo boolean not null default false`** — the flag. RLS: readable by org members (already), writable only by super-admins (platform path). Exposed on `AuthContext.currentOrg`.
- **`demo_state`** (`org_id` PK/FK, `is_demo`-scoped) — `sim_now timestamptz`, `current_scene_id text`, `prospect_label text`, `volume text check (volume in ('small','full'))`, `script_id text`, `updated_at`. One row per demo org; the rep's rail reads/writes it.
- **`demo_captured_sends`** — diverted outbound artifacts: `id`, `org_id`, `kind ('email'|'pdf')`, `to_label`, `subject`, `preview_html`/`storage_path`, `created_at`. Powers the in-app "sent" viewer. RLS: org members read; only service role writes.
- **`demo_sandbox_links`** *(Phase 3)* — `token`, `org_id`, `expires_at`, `created_by`, read-only public grant metadata.

All demo tables get the standard RESTRICTIVE `org_isolation` policy and a `is_demo`-only CHECK where a write must never touch a real org.

## 6. Components

### A. Org flag + provisioning (Platform)
- Migration: add `is_demo`. Regenerate types + mirror.
- Platform → Organizations: a **"New demo org"** action (extends the existing New-org dialog) that calls `demo-ops:create` → provisions the org with `is_demo=true`, runs `seed_demo_org`, invites the chosen rep as **admin**. Reuses `provision_org` + `ensureInvitedAccount` + membership link from `provision-org`.
- Platform Organizations list shows a **DEMO** chip and, for demo rows, "Reseed" / "Wipe" affordances (super-admin).

### B. Seed / wipe / reseed routines + safety
- **`seed_demo_org(p_org uuid, p_volume text)`** `SECURITY DEFINER` RPC — inserts the full curated catalog (see §7) scoped to one org. Prod-callable (unlike `seed.sql`). Idempotent per org. Runs with dispatch triggers suppressed for the session (or inserts hire-orders directly) so bulk-seeding confirmed/fully-filled dates doesn't fan out edge-function calls; the auto-draft path is exercised deliberately by a cue in scene 05, not by the bulk seed.
- **`wipe_demo_org(p_org uuid)`** `SECURITY DEFINER` RPC — deletes all tenant rows for the org. **Guard: `if (select is_demo from organizations where id = p_org) is not true then raise exception`.** This is the most dangerous function in the app; the guard reads the same row it wipes, and callers re-check.
- **`reset` = `wipe_demo_org` then `seed_demo_org`** in one transaction.
- Edge `demo-ops` actions `seed` / `wipe` / `reset` / `reseed`: `requireOrgRole(org_id, ['admin'])` (rep, own org) **or** `requireSuperAdmin` (platform), then re-assert `is_demo` before calling the RPCs.

### C. Guardrails (email/PDF) + captured-sends viewer
- Every send-side edge function (`send-transactional-email`, `send-offer-digest`, `send-confirmation-digest`, `generate-hire-orders` issue) loads the org (already does) and, when `org.is_demo`, **diverts** instead of delivering: write a `demo_captured_sends` row (email → rendered HTML; PDF → the generated file in a demo path) and skip the real Resend/attachment send.
- New in-app **"Demo outbox"** surface (a panel, reachable from the demo bar / notifications) rendering `demo_captured_sends` so the rep can *show* "the artist just got this." Turns the guardrail into a selling point.
- Belt-and-suspenders: demo artists use non-routable addresses so even a missed guard cannot deliver.

### D. Demo UI shell — option 1a
- **DEMO badge** on the org row in the sidebar; **"Demo persona"** chip on the user card.
- **Demo control bar** (between header and page body, shown when `currentOrg.is_demo`): `Scene ▾` selector · `Admin / Production / Artist` role toggle (→ `viewAsRole`) · **sim clock** display with `+10m` / `+1d` (narrative; advances `demo_state.sim_now` and may fire time-cued deltas) · **Reset** · **Sandbox link** (Phase 3) · hide · exit.
- **Run-of-show rail** (right dock, rep teleprompter): scene list with progress + time estimates; active scene expanded with a **"Say:"** talk-track, **cue buttons**, and **Next scene**; footer with **Prospect label** personalization (renames the demo org's display name) + **Small house / Full season** volume toggle (→ reseed at that volume).
- `DemoProvider` (mirrors `EditorProvider`): holds bar/rail visibility (session), reads `demo_state`, exposes `runCue`, `goToScene`, `advanceClock`, `reset`, `setRole`. Read-only `useDemo()` for consumers.

### E. Scene + cue engine
- **Declarative scenes**, authored as data (a typed module, EN/DE where user-visible, following the i18n + no-dash + "Du" conventions): `Scene = { id, title, route, persona, highlightRef?, say, cues: CueId[], estMin }`.
- **Cues** are named server actions dispatched to `demo-ops:cue` (`{ org_id, cue_id }`), each an idempotent, demo-org-only mutation. The catalog for the default script:
  - `artist_accepts_offer` — transition a specific pending offer → `soft_booked` (as if the artist accepted).
  - `run_clock_to_1700` — expire the two staged holds (same effect as `expire-offers`) + advance `sim_now`.
  - `drop_notifications` — insert 3 unread notifications for the current persona.
  - `fill_date` — confirm the remaining slot so a date reaches `fully_filled` (fires the real auto-draft trigger → hire order drafts on screen).
  - `issue_hire_order` — issue the drafted order (PDF → demo outbox, not delivered).
  - `generate_sandbox_link` *(Phase 3)*.
- Reset restores the pre-cue baseline, so cues are replayable across demos.

### F. Reset
- Rep-facing Reset (bar button) → `demo-ops:reset` scoped to `currentOrg` (own demo org only). Confirms, wipes+reseeds at the current volume, restores scene 01, invalidates all queries.

### G. Sandbox link *(Phase 3)*
- `demo-ops:link` mints a read-only, expiring (14-day) public token granting scoped read access to the demo org, for leave-behind. Meatier (public read path + its own RLS/edge auth), so it lands last.

## 7. Dataset coverage matrix

**20+ `show_dates` spanning today → +90 days**, 6 shows, a full cast across multiple cities. Every lens deliberately non-empty and non-stale:

| Lens / surface | What the seed guarantees |
|---|---|
| Dashboard (admin) | live-upcoming count, holds-expiring today, next-30-day fill % all populated |
| Dashboard (producer) | soft-booked "ready to confirm" queue with ≥3 rows |
| Dashboard (artist) | pending offers + upcoming confirmed for the demo artist |
| Calendar | past-done, today, and future dates present |
| Booking states | suggested, soft_booked, confirmed, at_risk, cancelled, understudy-promoted all present; **2 holds with deadline today 17:00** (scene 03) |
| Hire orders | draft, issued, countersigned examples |
| Chat | ≥1 per-date thread with message history |
| Notifications | unread notifications for the persona |
| Availability | an artist with declared blocked dates |
| Catalog | ≥6 shows, multiple casts + cities; one "synced-looking" + one manual show |
| Volume | `full` = dense; `small` = trimmed subset for a faster demo |

Seed content is synthetic and locale-appropriate to the demo (German theater names in the mockup, e.g. "Rheinbühne Köln"), never real. Dates are relative to seed time (like `seed.sql`) so the fixture never drifts into the past.

## 8. Isolation & safety

- **The wipe guard is the crown jewel.** `wipe_demo_org` refuses on `is_demo <> true`; the edge caller re-asserts; the UI only offers wipe/reset inside a demo org. No path reaches a real tenant.
- **Reps are org-admins of one org.** RLS confines every read/write to that org. A rep cannot switch into, seed, or wipe another rep's org or a real one.
- **Email/PDF can't escape:** `is_demo` divert + non-routable demo addresses (defense in depth).
- **Super-admin god-mode:** the demo bar keys off `is_demo` (not `useModuleGate`), so it never renders on real orgs.
- **Provisioning stays super-admin-only** (`requireSuperAdmin`), matching `provision-org`.

## 9. Testing strategy (five layers)

- **Unit/hook:** the scene/cue registry (structure, EN≠DE, no-dash lint), `DemoProvider` state machine, captured-sends rendering, data-access functions via `supabaseFake`.
- **pgTAP:** `wipe_demo_org` **refuses on a non-demo org** (the critical regression), `seed_demo_org` idempotency + coverage counts, RLS on the demo tables.
- **Edge (Deno):** `demo-ops` auth matrix (rep vs super-admin vs stranger), each cue's idempotency, the `is_demo` email-divert branch in each send function.
- **E2E (Playwright):** create demo org → run the script end to end (accept → confirm → auto-draft → issue) → reset returns to baseline; assert no real send occurred.

## 10. Phasing

- **Phase 1 — Foundation:** `is_demo` column + Platform toggle/"New demo org"; `seed_demo_org` / `wipe_demo_org` RPCs + coverage seed; email/PDF divert + demo outbox; demo control bar + DEMO badge; role switch (reuse view-as); reset / wipe / manual reseed.
- **Phase 2 — Show run:** run-of-show rail; scene/cue engine; the Season-handover script; sim-clock narrative; prospect-label personalization; volume toggle.
- **Phase 3 — Leave-behind:** read-only expiring sandbox link.

## 11. Cross-cutting checklist (per CLAUDE.md)

- **Changelog:** none — demo mode is a super-admin/internal sales tool; the public changelog must not mention platform-admin actions.
- **Help center:** the demo outbox and demo bar are rep-facing; add brief internal help only if reps use the general Help center (likely "No help center impact." for customer-facing help). Confirm during planning.
- **Page mini:** demo mode adds chrome + a Platform action, not a new customer route; the demo outbox panel is not a standalone route. Expected "No mini." — restate with reason in the PR.
- **Mirrors:** no entitlement/capability registry change (column, not entitlement), so no `sync:mirrors` for the flag itself; regenerate `types.ts` + `database.types.ts` mirror after the migration.
- **i18n / copy:** scene talk-tracks and rail copy follow the no-em-dash + informal-Du rules; reuse `TERMS`.

## 12. Open questions / risks

- **Trigger suppression during seed:** confirm the cleanest way to bulk-seed confirmed/fully-filled dates without fanning out `dispatch_hire_order_drafts` edge calls (session-local trigger disable vs. seeding hire-order rows directly). Resolve in the plan.
- **Persona rendering for a specific artist:** `viewAsUser` switches the rendered perspective but not DB access; confirm the artist dashboard resolves its `artist_id` from the viewed user so scene 04 shows the right artist. Cues do the writes regardless.
- **Sandbox-link scope (Phase 3):** exact read-only surface + public RLS shape to be designed when Phase 3 starts.
