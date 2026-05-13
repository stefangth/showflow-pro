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

A show is a production template: program name, sub-program, default venue, required skills, and a default slot count. One show row represents the production as a whole, not any specific performance date.

### `show_dates`

Each row is one performance instance of a show: a specific date, city, optional venue override, and start/end times. One show typically has many dates. Status progresses from `open` → `partially_filled` → `fully_filled`, or `cancelled`.

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
- Availability and bookings have different access patterns: artists write their own availability; bookings are created by producers or the auto-suggest engine.

---

## Eligibility

Before a producer can book an artist, the artist must be **eligible** for that show date. Eligibility is defined through casts.

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

## The Availability → Booking Flow

This is the core workflow. Here is the full sequence:

```
Artist marks "Available" on a date
        │
        ▼
availability table: INSERT/UPDATE { artist_id, date, status: 'available' }
        │
        ▼
AvailabilityPicker (client) invokes auto-suggest-bookings edge function
for each non-cancelled show_date on that calendar day
        │
        ▼
auto-suggest-bookings edge function:
  1. Verify caller is available on this date (artist self-verification)
  2. Resolve eligible artists for the show date (cast eligibility logic)
  3. Filter out already-booked artists
  4. Score remaining candidates:
       Priority score    × 0.40
       Skill match       × 0.35
       Availability history (inverse recent booking count) × 0.25
  5. Upsert top N candidates as bookings with status='suggested'
     (idempotent — safe to re-run; duplicates are ignored)
        │
        ▼
Producer opens /bookings
  - Show date status changes from "Open" → "Cast Pending"
    (because suggested bookings now exist)
  - Clicking the date opens ShowDateDetailSheet:
      • "Cast" section: artists with suggested/soft_booked/confirmed bookings
      • "Available to Book" section: artists who declared available but aren't booked yet
        │
        ▼
Producer reviews suggested artists and soft-books or confirms
        │
        ▼
Booking status: suggested → soft_booked → confirmed
```

### Slot counts and sub-program config

Before the auto-suggest engine runs, it reads slot defaults from `app_settings` (key: `sub_program_slots_defaults`). Each sub-program (e.g. "Matinée", "Evening") must have a configured `main_cast` count and `understudies` count. If a sub-program has no slot config, the engine returns an error — configure missing sub-programs in **Settings → Scheduling**.

### Soft-book expiry

Soft bookings that aren't confirmed within the configured window (`soft_book_expiry_hours`, default 48 h) are automatically cancelled by a scheduled database job. This prevents dates from being held indefinitely.

### Understudy promotion

If a confirmed main-cast artist cancels, any `is_understudy = true` booking with status `suggested` or `soft_booked` is automatically promoted to fill the slot.

### Scoring weights (reference)

| Factor | Weight | Notes |
|---|---|---|
| Priority score | 40% | Artist's `priority_score` field (0–10 scale, normalised to 0–1) |
| Skill match | 35% | Proportion of show's `required_skills` the artist has |
| Availability history | 25% | Inverse of recent confirmed bookings (last 90 days); artists with fewer recent bookings score higher to distribute work |

Weights are defined in `src/config/app.config.ts` (`BOOKING_CONFIG.SUGGEST_WEIGHTS`) and in the edge function. They must sum to 1.

---

## Status Reference

### Booking status

| Status | Meaning |
|---|---|
| `suggested` | Auto-suggest engine has nominated this artist; no commitment yet |
| `soft_booked` | Producer has placed a hold; artist is tentatively scheduled |
| `confirmed` | Booking is locked in; artist is on the cast list |
| `cancelled` | Booking cancelled; recorded in audit log, never deleted |

### Show date derived status (producer /bookings view)

| Status | Condition |
|---|---|
| Open | No bookings exist for this date |
| Cast Pending | Some bookings exist but confirmed main cast < required slots |
| Cast Confirmed | Confirmed main cast ≥ required slots |
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

In-app notifications are written to the `notifications` table (`user_id`, `type`, `payload`, `read_at`). They are created server-side only (edge functions or server mutations with appropriate RLS). Notification delivery requires `FLAGS.NOTIFICATIONS = true` (default on).

Transactional email uses the `send-transactional-email` edge function. Templates live in `supabase/functions/_shared/transactional-email-templates/` and are registered in `registry.ts`. New templates must be added to the registry to be deliverable.

---

## Settings Reference

| Setting | Location | Purpose |
|---|---|---|
| `soft_book_expiry_hours` | Settings → Scheduling | Hours before an unconfirmed soft booking auto-cancels |
| `sub_program_slots_defaults` | Settings → Scheduling | Main cast + understudy slot counts per sub-program |
| `auto_suggest_enabled` | Settings → Booking Engine | Toggle auto-suggest globally |
| `max_suggestions` | Settings → Booking Engine | Max candidates per slot |
| `airtable_sync_enabled` | Settings → Airtable Sync | Enable/disable the Airtable polling loop (mocked) |
| `notifications_enabled` | Settings → Notifications | Toggle in-app notifications |
| `filters_visibility` | Settings → Filters | Which filter controls producers and artists see on each page |

Static developer constants (feature flags, route definitions, scoring weights) live in `src/config/app.config.ts` and require a code deploy to change.
