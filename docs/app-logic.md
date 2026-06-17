# Showflow Pro — App Logic Guide

This document explains how the platform works: roles, data model, eligibility, and the full booking flow from availability to confirmed cast. It is intended for admins and producers who need to understand the system's behaviour, not just its UI.

---

## Roles and Access

| Role | What they can do |
|---|---|
| **Admin** | Full access: approve users, manage casts, configure settings, manage bookings, view all data |
| **Producer** | Manage shows and bookings, view artist availability, trigger and confirm bookings |
| **Artist** | Declare availability, view their own eligible dates and booking status |

### Signup and approval

New accounts are not active immediately. Every signup lands in a `pending` state and a notification is sent to admins. An admin must approve or reject the account from the admin panel before the user can access any protected content. At approval time, the admin assigns a role. This role is stored in `user_roles` and enforced by Postgres RLS on every query — the client UI hides or shows UI based on role, but the database always enforces it independently.

---

## Data Model

### Why these tables are separate

The four core tables — `shows`, `show_dates`, `bookings`, and `availability` — model distinct things with different lifetimes and cardinalities. Merging them would cause duplication and break the independence between an artist's general calendar availability and their bookings for specific productions.

### `shows`

A show is a production template: program name, sub-program, required skills, and status. One show row represents the production as a whole, not any specific performance date. Venues are set per show date (not on the show itself); slot capacity comes from `app_settings`, not from a column on this table.

### `show_dates`

Each row is one performance instance of a show: a specific date, city, optional venue override, and session times. One show typically has many dates. Status progresses from `open` → `partially_filled` → `fully_filled`, or `cancelled`.

### `bookings`

The join between an artist and a show date. One booking row = one artist assigned to one performance. Status moves through the lifecycle:

```
suggested → soft_booked → confirmed
             (any state) → cancelled
```

Each booking records who created it (`booked_by`), whether the artist is an understudy (`is_understudy`), and all status changes are appended to `booking_audit_log` (never deleted).

### `availability`

An artist's declared availability on a **calendar date** (not tied to a specific show). One artist can have one availability row per day. Statuses: `available`, `unavailable`, `tentative`.

This separation matters because:
- One artist may be eligible for multiple shows on the same day (e.g. a matinée and an evening). They mark availability once; the booking system handles each show separately.
- Availability can exist before any show date is scheduled.
- Availability and bookings have different access patterns: artists write their own availability; bookings are created by the offer engine.

### `blocked_dates`

An artist's list of dates they are explicitly blocking — dates when they should not receive offers regardless of their general availability status. One row per (artist, date). The `open-offer-tier` function filters out artists with a `blocked_dates` entry before creating offers. Artists manage blocked dates via the calendar UI.

### Identity vs. booking contact

A person can appear in two tables. **`profiles`** is their global login account (one per user:
display name, personal phone, avatar). **`artists`** is their bookable talent record *inside an org*
(talent name, booking email/phone, bio, status) — and it exists even for external artists with no
login (`user_id` is empty). These are different real-world contacts, not duplicates, so they are
kept separate (ADR-0011).

When an invited person accepts, their artist row is linked to their login automatically (by email).
For a linked (registered) artist, the offer/confirmation **digest emails go to their login email**
first, falling back to the booking email; the admin can see the effective recipient in the artist's
"Linked account" panel.

---

## Eligibility

Before an artist can receive an offer for a show date, the artist must be **eligible** for that date. Eligibility is defined through casts.

### Casts and cast membership

A cast is a named group of artists (e.g. "London Principal Cast", "NYC Ensemble"). Artists join casts via `cast_members`.

### Show-level eligibility (`show_cast_eligibility`)

A cast can be marked eligible for a given **show + city** combination. This means all members of that cast are eligible for every date of that show in that city.

### Per-date overrides (`show_date_cast_eligibility`)

For finer control, a cast can be made eligible (or restricted) for a single specific show date, overriding the show-level rule.

### Resolution order

`useEligibleArtists` and `useArtistEligibleDates` resolve eligibility as:

1. Collect all casts eligible for the show + city (from `show_cast_eligibility`)
2. Merge with any casts eligible for the specific show date (from `show_date_cast_eligibility`)
3. Union all artist IDs from all collected casts via `cast_members`

If no eligibility config exists at all (no rows in either table for the show date), the system treats eligibility as **unrestricted** (any artist may be booked).

Artists can only declare availability on dates returned by `useArtistEligibleDates` — the calendar makes non-eligible dates non-interactive.

---

## The Offer → Booking Flow

This is the core workflow. Here is the full sequence:

```
New show date arrives via Airtable sync (airtable-poll cron)
        │
        ▼
airtable-poll calls open-offer-tier for Tier 1
        │
        ▼
open-offer-tier edge function:
  1. Resolves eligible artists for the tier (cast_city_priority table;
     Tier 99 = ad-hoc cast via show_date_cast_eligibility)
  2. Filters out: artists with existing non-cancelled bookings for this date,
     artists with a blocked_dates entry for this date
  3. Inserts suggested bookings for all remaining candidates
     (no scoring/ranking — all eligible artists in the tier receive an offer)
  4. offer_expires_at is left null until the offer digest is sent
  5. Records the tier as opened in show_date_offer_tiers
        │
        ▼
Daily offer digest email (send-offer-digest, 19:00 Berlin):
  - Sends one consolidated email per artist listing all their pending offers
  - Stamps digest_sent_at = now() and sets offer_expires_at = now() + offer_response_window_hours
  - The expiry clock starts from when the artist is notified, not from offer creation
        │
        ▼
Artist opens their calendar (ArtistAvailabilityCalendar)
  - Dates with pending offers show an "Offer" indicator
  - Clicking the date opens OfferResponseButtons:
      Accept → booking status: suggested → soft_booked
      Decline → booking status: suggested → cancelled (cancellation_reason: 'artist_declined')
        │
        ▼
expire-offers runs hourly:
  - Cancels suggested bookings where offer_expires_at < now() (status → cancelled)
  - If a tier's window has fully closed (no pending, non-expired offers remain)
    and accepted count < required slots:
      → creates a cast_escalation_requested in-app notification + emails producers
      → stamps escalation_notified_at (idempotent — fires once per tier)
        │
        ▼
Producer opens /bookings (ShowsBookingsPage)
  - Show date shows "Partially Filled" once soft-booked bookings exist
  - Clicking the date opens ShowDateDetailSheet: review soft-booked artists → confirm or cancel
        │
        ▼
Daily confirmation digest email (send-confirmation-digest, 20:00 Berlin):
  - Sends a confirmation summary to newly confirmed artists
```

### Slot counts and sub-program config

Each **show** carries `main_cast_slots` and `understudy_slots` (one show = one `(program, sub_program)`). If a show's slots are `NULL` (unconfigured) the show date status never reaches `fully_filled` and the UI shows an "Unconfigured" badge — set the counts on the show in **Settings → Scheduling**.

### Offer expiry

Suggested offers that have not been accepted or declined expire once `offer_expires_at` passes. The expiry window (`offer_response_window_hours`, default 48 h) starts from the time the offer digest email is sent — not from when the offer was created. This gives artists the full configured window after they receive notification. The `expire-offers` function runs hourly and cancels any suggested booking whose `offer_expires_at` has passed.

### Understudy promotion

If a confirmed main-cast booking is cancelled, the system automatically promotes the best available understudy to fill the vacant slot. The promotion trigger selects from `is_understudy = true` bookings for the same show date with status `soft_booked` or `suggested`, preferring `soft_booked` over `suggested` and, within the same status, the earliest created booking.

- A `soft_booked` understudy → promoted to `confirmed`, `is_understudy = false`
- A `suggested` understudy → promoted to `soft_booked`, `is_understudy = false`

The promotion is recorded in `booking_audit_log` (action: `understudy_promoted`) and the promoted artist receives an `understudy_promoted` in-app notification.

---

## Status Reference

### Booking status

| Status | Meaning |
|---|---|
| `suggested` | Offer has been sent to this artist; no commitment yet |
| `soft_booked` | Artist accepted the offer; producer still needs to confirm |
| `confirmed` | Booking is locked in; artist is on the cast list |
| `cancelled` | Booking cancelled; recorded in audit log, never deleted |

### Show date derived status (producer /bookings view)

| Status | Condition |
|---|---|
| Open | No bookings exist for this date |
| Partially Filled | Some bookings exist but confirmed main cast < required slots |
| Fully Filled | Confirmed main cast ≥ required slots |
| Cancelled | show_date.status = 'cancelled' |
| Unconfigured | No slot config found for this sub-program |

### Availability status

| Status | Meaning |
|---|---|
| `available` | Artist has marked themselves free and willing |
| `tentative` | Artist may be available but has a conflict or uncertainty |
| `unavailable` | Artist is not free on this date |
| *(no record)* | Artist has not responded for this date |

---

## Chat

Each show date has a dedicated chat thread (`chats` table, one row per `show_date_id`). Participants are:
- Admins
- Producers
- Artists who are confirmed or soft-booked for that date

Chat threads become **read-only** after `CHAT_ARCHIVE_DAYS` (30 days) past the show date. Admins can still view archived threads. The archive window is configured in `src/config/app.config.ts`.

---

## Notifications

In-app notifications are written to the `notifications` table (`user_id`, `type`, `title`, `message`, `read`, `related_entity_id`, `related_entity_type`). They are created server-side only (edge functions or triggers with appropriate RLS). Read state is a plain boolean `read` field. Notification delivery requires `FEATURES.NOTIFICATIONS = true` (default on).

Transactional email uses the `send-transactional-email` edge function. Templates live in `supabase/functions/_shared/transactional-email-templates/` and are registered in `registry.ts`. New templates must be added to the registry to be deliverable.

---

## Settings Reference

| Setting | Location | Purpose |
|---|---|---|
| `offer_response_window_hours` | Settings → Booking Engine | Hours after the offer digest email that an artist has to respond before the offer auto-expires (active setting; default 48 h) |
| `soft_book_expiry_hours` | Settings → Scheduling | Legacy — superseded by `offer_response_window_hours`. Has no effect on current expiry logic. |
| `sub_program_slots_defaults` | Settings → Scheduling | Main cast + understudy slot counts per sub-program |
| `auto_suggest_enabled` | Settings → Booking Engine | Toggle auto-suggest globally |
| `max_suggestions` | Settings → Booking Engine | Max candidates per slot |
| `airtable_sync_enabled` | Settings → Airtable Sync | Enable/disable the Airtable polling loop (mocked) |
| `notifications_enabled` | Settings → Notifications | Toggle in-app notifications |
| `filters_visibility` | Settings → Filters | Which filter controls producers and artists see on each page |

Static developer constants (feature flags, route definitions) live in `src/config/app.config.ts` and require a code deploy to change.
