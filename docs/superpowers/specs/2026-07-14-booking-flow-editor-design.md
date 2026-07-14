# Booking Flow Editor: admin-configurable booking flow (Phases 1+2)

Date: 2026-07-14
Status: approved design, pending user review of this document
Branch: claude/booking-engine-ui-ux-09cbf4

## Summary

Org admins (and super-admins) get a new Settings tab, "Booking flow", where they configure how the
offer-to-booking pipeline behaves for their org: turn steps off, change offer delivery, add automations,
and choose the reference field used to identify bookings in emails and UI. The editor is a visual
pipeline: presets on top, a numbered step timeline with controls on each node, and a live rail showing
the resulting lifecycle, a plain-language "in practice" summary, a sample-day flow preview, and a change
history. The per-date booking cockpit (ShowDateDetailSheet) is rebuilt to reflect the configured flow.

The status vocabulary stays fixed (suggested, soft_booked, confirmed, cancelled; DB-enforced).
Configuration changes which transitions are automated, skipped, or gated, never the vocabulary.

Approved direction: mockup "presets above the pipeline" (artifact `booking-engine-direction-preview`,
version `final-v1-no-dashes`), merged from the user's Claude Design project "Configurable booking flow
design" (option 1a) and the round-1 flow policy editor.

## Decisions locked with the user

1. Config granularity: org-wide only. One flow per org; per-show overrides are out of scope.
2. Direct-booking semantics: hand-picked. With artist acceptance off there are no offers; producers
   book individual artists from eligibility lists and each booking is confirmed immediately. Opening
   a tier never mass-books anyone.
3. Producer confirmation is forced on (locked) when artist acceptance is off: the producer's booking
   is itself the confirmation.
4. Extra automations included: at-risk alerts (existing watcher becomes configurable) and expiry
   reminder (new: remind unanswered artists 24 h before their window closes).
5. Change history stays: new `settings_audit_log` table.
6. Reference field means the display field used in offer emails, digests, notifications, and booking
   rows: show name (default), program + sub-program, or one custom field. It never drives eligibility.
   The heavier "tiering axis" configurability (city vs venue vs other) remains parked as Phase 4.
7. Copy rule: no em- or en-dashes in any product copy (UI strings, emails, docs). Use period, comma,
   colon, semicolon, or middot. Arrows for state transitions are fine.

## 1. Flow policy model and storage

### 1.1 The `booking_flow` setting

One new `app_settings` key, `booking_flow`, holding the entire policy as a JSON object. It resolves
atomically through the existing chain (org row, then platform row, then code default), so org and
platform values can never blend into an incoherent combination.

```jsonc
{
  "auto_open_tier1": false,        // open tier 1 automatically when a date becomes ready
  "auto_escalate": false,          // open the next tier when a window closes short
  "at_risk_alerts": true,          // tier-at-risk-watcher notifications
  "offer_delivery": "digest",      // "digest" | "immediate"
  "expiry_reminder": false,        // remind unanswered artists 24 h before expiry
  "artist_acceptance": true,       // false = direct-booking mode (no offers at all)
  "producer_confirmation": true,   // false = acceptance confirms instantly; forced true when artist_acceptance=false
  "confirmation_digest": true,     // daily confirmation summary email
  "understudy_promotion": true,    // auto-promote on cancellation
  "reference_field": { "source": "show" }
                                   // source: "show" | "program" | "custom"
                                   // when "custom": { "source": "custom", "custom_field_id": "<uuid>" }
}
```

The code default equals the Classic preset, which equals current production behavior. Orgs that never
open the editor see zero change. Existing keys stay separate and continue to work unchanged:
`offer_response_window_hours`, `offer_digest_hour_berlin`, `confirmation_digest_hour_berlin`,
`resend_from_address`. The editor edits both the object and those keys from one surface.

Invariant enforced everywhere (client validation, edge validation, and the settings save path):
`artist_acceptance === false` implies `producer_confirmation === true`.

### 1.2 Shared pure logic (dual-home)

- `src/lib/bookingFlow.ts`: TypeScript types, `BOOKING_FLOW_DEFAULTS`, the three presets
  (classic, fasttrack, direct), `normalizeBookingFlow` (parse + invariant), `matchPreset`,
  `lifecycleChips`, `inPracticeRows`, `flowPreviewRows`, `referenceLabel`.
- `supabase/functions/_shared/bookingFlow.ts`: the minimal mirror edge functions need
  (defaults, `normalizeBookingFlow`, `referenceLabel`). Same dual-home pattern and sync comment as
  `BOOKING_ENGINE_DEFAULTS`.

All rail copy in the settings editor renders from these functions so the text is unit-tested.

### 1.3 `settings_audit_log`

New table populated by a DB trigger on `app_settings` INSERT/UPDATE (value-changing writes only):

- Columns: `id`, `org_id` (nullable; null = platform default edited), `key`, `actor` (uuid, from
  `auth.uid()`, nullable for service-role writes), `old_value` jsonb, `new_value` jsonb, `created_at`.
- RLS: SELECT for org admins on their org rows (`has_org_role(auth.uid(), org_id, 'admin')`) and
  super-admins everywhere; no INSERT/UPDATE/DELETE policies (trigger writes with definer rights).
  RESTRICTIVE org-isolation policy per the tenancy template.
- The Change history rail reads the last N entries for the booking-flow-related keys and renders
  human diffs client-side (pure function in `bookingFlow.ts`).

### 1.4 New columns and guard changes

- `bookings.reminder_sent_at timestamptz null`: idempotency guard for the expiry reminder.
- Transition guard (`enforce_booking_transition`): add `suggested → confirmed` (acceptance under
  auto-confirm). All other transitions unchanged. Inserting rows directly as `confirmed` (direct mode)
  is already legal since the guard fires on UPDATE only; the insert path sets `confirmed_at`.

## 2. Engine compliance

Policy is read at action time via `resolveOrgSetting(admin, orgId, 'booking_flow', defaults)` then
`normalizeBookingFlow`. In-flight offers keep whatever expiry was stamped when they were sent.

| Touchpoint | Change |
|---|---|
| `open-offer-tier` | Refuses with 409 in direct mode. Gains `dry_run: true` input: runs the full eligibility pipeline and returns `{ candidates, excluded }` without writing. When `offer_delivery = "immediate"`: after creating suggested bookings, sends the offer email per artist immediately and stamps `offer_expires_at = now + window` at open time. |
| `send-offer-digest` | Skips orgs where `offer_delivery = "immediate"` or `artist_acceptance = false`. Digest content uses `referenceLabel`. |
| `expire-offers` | Two additions per org: (a) when `expiry_reminder` is on, finds suggested bookings with `offer_expires_at` within 24 h and `reminder_sent_at IS NULL`, sends the reminder email + in-app notification (respecting notification preferences), stamps `reminder_sent_at`; (b) when `auto_escalate` is on and expiry left a date short, closes the short tier and invokes `open-offer-tier` for the next available tier. |
| `tier-at-risk-watcher` | Skips orgs where `at_risk_alerts = false` (also naturally quiet in direct mode since no tiers open). |
| `respondToOffer` (client data fn) | Accept transitions `suggested → soft_booked`, or `suggested → confirmed` when `producer_confirmation = false` (sets `confirmed_at`). Decline unchanged. |
| `createBooking` (manual) | Inserts `soft_booked` as today; in direct mode inserts `confirmed` with `confirmed_at`. |
| `bulkConfirmSoftBooked` / dashboard | Unchanged mechanics; the "Ready to Confirm" card hides when `producer_confirmation = false`. |
| Understudy promotion trigger | Reads `understudy_promotion` and `artist_acceptance` via `get_org_setting`. Off: no-op. Acceptance mode: unchanged (longest-waiting accepted, not blocked). Direct mode: promotes the longest-waiting non-cancelled understudy booking (no acceptance exists to require), still skipping blocked artists and whole-date cancellations. |
| Auto-open tier 1 | Shared readiness check invoked from both date paths: `airtable-poll` after upsert, and the in-app date create/update mutation. Ready means: `artist_acceptance = true`, at least one session set, show slot config present, city set, tier 1 exists for that city, and no `show_date_offer_tiers` row for tier 1 yet. When ready and `auto_open_tier1` is on, invoke `open-offer-tier` with a null `opened_by` (system open, shown as "automatic" in the UI). Runs on updates too, so a date that becomes ready later still auto-opens once. |

Emails: two new templates registered in `_shared/transactional-email-templates/registry.ts`:
`offer-immediate` (single-offer email for immediate delivery) and `offer-expiry-reminder`. Both use
`referenceLabel` for their subject and body lines and the existing suppression/unsubscribe pipeline.

Reference field consumers: offer digest, immediate offer email, expiry reminder, confirmation digest,
in-app notification titles, and the booking-row/date labels in artist-facing views. Fallback rule:
if the configured custom field has no value on a date, fall back to show name.

## 3. Settings surface

New Settings tab "Booking flow", visible to admins and super-admins only, extracted out of
`SettingsPage.tsx` into `src/components/settings/bookingFlow/`. The current Booking Engine tab
(gated admin or producer today) is replaced by this tab; producers lose access to those settings,
which matches the decision that flow configuration is an admin concern. Components:

- `BookingFlowTab.tsx`: layout (presets row, timeline, rail), wires the draft hook.
- `FlowPresets.tsx`: the four preset cards; selecting applies the preset to the draft; any manual
  change flips selection to Custom via `matchPreset`.
- `FlowTimeline.tsx` + step cards (`StepDateCreated`, `StepOpenTier`, `StepNotifyArtists`,
  `StepArtistAcceptance`, `StepProducerConfirmation`, `StepConfirmationDigest`,
  `StepUnderstudyPromotion`): numbered nodes, controls on the node, skipped steps dim, locked
  confirmation shows the explanatory note.
- `FlowRail.tsx` composed of `LifecycleCard`, `InPracticeCard`, `FlowPreviewCard`,
  `SaveRow` (Save (N) / Discard, draft banner), `ChangeHistoryCard`.
- `useBookingFlowDraft.ts`: loads resolved settings (React Query), holds the draft, computes dirty
  keys, saves via `upsertOrgSetting` (one write for `booking_flow`, plus writes for any changed
  legacy keys), invalidates the settings query. Audit rows appear via the DB trigger.
- The existing Email Templates card and from-address field move onto this tab below the editor.
- The reference-field custom option renders a second select fed by the custom field definitions
  domain (`src/data/customFields`).

Step 2 hosts: delivery segmented control, digest hour, response window, expiry reminder toggle,
reference field selects, and a live email-subject preview from `referenceLabel`.

## 4. Cockpit redesign (ShowDateDetailSheet)

`ShowDateDetailSheet.tsx` (737 lines) becomes a thin composition; new components under
`src/components/shows/date/`:

- `DateHeader`: show, date, city, sessions, date status badge, date actions (edit, cancel, delete).
- `BookingFunnel`: offered → accepted → confirmed bars against slot targets (main + understudy).
- `UpNextStrip`: policy-driven automation pills (digest countdown, next expiry, escalate on/off,
  at-risk state). Hidden in direct mode except confirmation digest.
- `TierTimeline`: available/open/closed tiers with per-tier fill counts, open and close actions,
  the existing withdraw/keep close dialog.
- `DryRunDialog`: calls `open-offer-tier` with `dry_run: true`, lists exactly who would get offers
  and who is excluded (blocked, already booked, inactive), confirm button performs the real open.
- `EligibilityBookList` (direct mode only, replaces `TierTimeline`): eligible artists with Book
  buttons (confirmed insert) and understudy checkbox.
- `AssignedArtists`: main cast and understudy groups; Confirm button only when
  `producer_confirmation = true` and status is soft_booked.
- City select, ad-hoc cast eligibility popover, and the chat panel carry over unchanged.

Dashboard touch (small, included here): "Ready to Confirm" card renders only when
`producer_confirmation = true`.

## 5. Testing

Test-first per repo standard; tests import real modules.

- Unit (vitest): every pure `bookingFlow.ts` function (normalize + invariant, presets, matchPreset,
  lifecycle, in-practice, preview rows, referenceLabel incl. custom-field fallback); draft-hook dirty
  diffing; data-access fns (`respondToOffer` both confirmation modes, `createBooking` both modes)
  with `supabaseFake`.
- Edge (Deno DI): `open-offer-tier` (dry-run shape, direct-mode 409, immediate delivery emails +
  expiry stamp), `send-offer-digest` skip matrix, `expire-offers` (reminder idempotency via
  `reminder_sent_at`, auto-escalate opens next tier once), `tier-at-risk-watcher` gate. Run the whole
  `supabase/functions/` suite (multi-test-file rule).
- pgTAP: transition guard allows `suggested → confirmed` and still blocks illegal moves;
  `settings_audit_log` trigger writes diffs with actor; understudy trigger honors the policy gates
  and the direct-mode criterion; RLS on `settings_audit_log`.
- Playwright (end of plan): one happy path per preset (classic, fast-track, direct).

## Out of scope (later phases)

- Phase 3: dashboards and artist surfaces fully adapted to the policy (copy, empty states, artist
  response-rate meter in direct mode), beyond the single Ready-to-Confirm gating included above.
- Phase 4: configurable eligibility/tiering axis (city vs venue vs other) and artist-attribute
  filters. The reference field in this spec is display-only by design.
- Per-show or per-program flow overrides.

## Rollout and back-compat

- No data migration needed: absent `booking_flow` key resolves to Classic (current behavior).
- Deploy order safe by construction: edge functions read the key defensively via `normalizeBookingFlow`;
  the DB guard change is additive; new columns are nullable.
- Config changes apply to future actions only; offers already sent keep their stamped expiry and flow.
- `docs/system-map.md` and `src/data/systemMap.ts` must be updated in the same PR that changes the
  automations (auto-open, escalate, reminder, watcher gate).
