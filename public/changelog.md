# ShowFlow — Changelog

What's new in ShowFlow, newest first.

## 1.10.0 — July 18, 2026

*Paperwork that writes itself*

### New
- **Hire orders** — Generate a draft engagement sheet straight from a confirmed booking, review the fee and terms, then issue it as a PDF. The artist gets the PDF by email and an in-app notification, and can download it from their dashboard any time.
- **Import hire orders from a spreadsheet** — Bring in engagements from an Excel file or a public Google Sheets link. Map the columns, choose which rows to import, match each row to the right artist and date, fix anything flagged, then create the drafts in bulk.
- **Hire orders page** — A new Hire orders page shows KPI tiles across every order, filters by status, search, and select many orders at once to issue them in a single batch.
- **Guided new order wizard** — Build a single hire order step by step: pick the artist and date, confirm the engagement details, set the fee, then review before creating the draft. A fully manual engagement with no linked date is supported too, for one-off bookings made outside the calendar.
- **Split builder for drafts** — Open a draft in a two-pane editor: fields on one side, a live PDF preview on the other, with a note on where each value came from (the booking, a manual edit, or an organization default).
- **Documenso countersigning (optional)** — Organizations that want electronic signatures can opt into Documenso countersigning in Settings. It is off by default and needs an admin to connect and configure it; issued orders can then be sent for e-signature and are marked countersigned automatically when the artist signs.

## 1.9.0 — July 15, 2026

*Make the booking flow your own*

### New
- **Booking flow editor** — Decide how booking works for your organization in Settings → Booking flow: pick a preset (Classic, Fast-track, Direct book) or tune every step yourself, with a live preview of the resulting booking lifecycle and what each choice means in practice.
- **Direct booking mode** — Skip offers entirely. Producers book and confirm artists straight from the eligibility list on a date, in one step.
- **Fast-track mode** — Offer emails go out immediately when a tier opens, and artists who accept are confirmed automatically with no separate confirmation step.
- **Offer expiry reminders** — Artists can get a reminder email a day before their open offer expires, so fewer offers lapse unanswered.
- **Auto-escalation** — When an offer tier expires without filling, the next tier can open automatically instead of waiting for a producer.
- **Dry-run preview** — See exactly which artists an "Open tier" action would reach, and who is excluded and why, before sending anything.
- **Choose your reference field** — Pick what names a booking in offers and emails: the show label, the program, or any custom field.
- **Settings change history** — Every booking-flow change is recorded with who changed what and when, shown right next to the editor.
- **Direct bookings notify the artist** — Artists booked directly now get an in-app notification the moment a producer books them, not just the next digest email.
- **Dashboard attention cards** — Producers see under-filled open tiers and offers expiring within a day at a glance; direct-booking organizations see upcoming dates that still need artists.
- **Show-specific cast priorities** — A show can now carry its own cast tier ladder per city, overriding the organization default; edit it in Settings → Casts & Cities with the new scope selector.
- **Required skills** — Shows (and individual dates) can require skills; offers, direct booking, and each artist's availability calendar respect them automatically, and artists only ever see requirements from their own organization.
- **Skill-scoped offers** — Open a tier for artists with specific skills only, or filter the direct-book list by skill; the dry-run preview and confirmation dialog show exactly who is reached and who is excluded, and why.
- **Skill-aware understudy promotion** — When a main-cast artist cancels, the understudy whose skills best cover theirs is promoted first; without skills in play, promotion behaves exactly as before.

### Improved
- **Per-date booking cockpit** — The date sheet now leads with a booking funnel, an "up next" strip of pending actions, and a tier timeline that adapts to your organization's flow.
- **Unavailable artists stay unbookable** — Direct booking respects artist-declared blocked dates, the same way tiered offers always have.
- **Every page speaks your booking flow** — In direct-booking mode the artist dashboard shows a Booked dates meter instead of a response rate, and artist pages say "My Dates" and "Not booked" instead of offer language.
- **Offer tiers respect show eligibility** — Opening a city tier now only reaches artists who are actually eligible for that show, matching what the direct-book list and artist calendars already enforced.

## 1.8.2 — July 11, 2026

*Dark mode*

### New
- **Dark mode** — Switch between Light, Dark, and System appearance from the new toggle in the top bar. System follows your device automatically, and your choice is remembered across sessions.

### Fixed
- **Email links now open the app** — Links in invitation and notification emails — including "Accept invitation" — now open the ShowFlow app directly instead of the marketing site, so accepting an invite and other email actions work as expected.

## 1.8.1 — July 6, 2026

*Fixes*

### Fixed
- **Airtable sync frequency now sticks** — Choosing a polling interval (for example, every hour) no longer reverts to 5 minutes after other settings are saved.

## 1.8.0 — July 5, 2026

*Control your Airtable sync cadence*

### New
- **Choose how often Airtable syncs** — Pick a polling frequency per organization, from every 5 minutes up to every 8 hours, in Settings → Airtable Sync.
- **Sync now** — Pull the latest from Airtable immediately, between scheduled cycles, with one click.

### Improved
- **See your sync cadence at a glance** — The Airtable Sync tab shows when it last synced and when the next sync is due.

## 1.7.0 — July 1, 2026

*Faster artist onboarding*

### New
- **Invite artists to a login from the roster** — Send an app-login invite straight from the Add Artist dialog or from an existing artist, with no separate Invites detour.
- **Account status at a glance** — Every artist shows a clear Active, Invited, or No account status on their card and profile.
- **Bulk import artists** — Import your roster from a CSV or Excel file, or paste a public Google Sheets link. Map the columns, review and de-duplicate, then add everyone at once — and optionally send them login invites in the same step.

### Improved
- **Reliable account linking** — Inviting from an artist ties the login to that exact artist, even when their login email differs from their booking email.

## 1.6.0 — June 24, 2026

*Productions table & Airtable sync improvements*

### New
- **Configurable Productions columns** — Admins can choose which columns appear on the Productions page, and in what order, per role.
- **Link individual programs** — Link a single Airtable program option to an existing show, the same way cities already work.

### Improved
- **Clearer Airtable field mapping** — The field-mapping card now labels each side: your ShowFlow field versus the Airtable column it maps to.

### Fixed
- **Program & sub-program now show on Productions** — Imported shows display their name instead of a dash.
- **Cities link from linked-record fields** — When Airtable stores City as a linked record, those cities can now be linked and kept in sync.
- **Venue shows its name** — Venues display the real venue name instead of an internal Airtable record id.

## 1.5.2 — June 24, 2026

*Airtable mapping reliability*

### Fixed
- **Airtable field mappings save automatically** — Mapping a field, choosing a base or table, or toggling sync in Settings → Airtable Sync now saves instantly, with a clear "Saving… / All changes saved" indicator. No separate Save click needed.
- **Mappings stay visible when you switch tabs** — The Airtable Sync tab now remembers your loaded base and table, so your field mappings and catalog links no longer disappear when you leave the tab and come back.

## 1.5.1 — June 23, 2026

*Airtable sync fix*

### Fixed
- **Airtable table selection** — When a base was already saved, the table dropdown in Settings → Airtable Sync stayed empty and unselectable after loading. It now fills in automatically, with clearer guidance and a retry when a base's tables can't be read.

## 1.5.0 — June 22, 2026

*Your data, your choices*

### New
- **Notification preferences** — Choose exactly how you hear about offers, confirmations, schedule changes, and alerts, with separate email and in-app switches for each. Critical account emails are always delivered.
- **Download my data** — Export a complete copy of your personal data (profile, talent records, bookings, availability, messages, and notifications) as a JSON file from your profile.
- **Delete account** — Permanently delete your account from your profile. Your personal details are removed while shared booking history is kept but de-identified.

## 1.4.1 — June 22, 2026

*Airtable sync fixes*

### Fixed
- **Airtable connection** — loading bases and tables from Airtable works again, and the automatic show-date sync is running.

### Improved
- **API key management** — the Airtable settings now show whether a key is saved and when it was last updated, and let you replace or delete it.

## 1.4.0 — June 21, 2026

*Integrations & automation*

### New
- **Airtable sync** — keep show dates in sync with an Airtable base, including session times, added or removed dates, and cancellations.
- **Guided Airtable setup** — a step-by-step field-mapping screen links your programs and cities, automatically matching existing entries so you don't end up with duplicates.
- **Offer tier controls** — producers and admins can open and close offer tiers directly.
- **Schedule-change notifications** — the right people are alerted automatically when a date is cancelled or a session is added, removed, or re-timed.

### Improved
- **Redesigned login** — a new login page with a full-bleed hero image.
- **Email branding** — transactional emails now consistently use the "ShowFlow" name.

## 1.3.0 — June 5, 2026

*Multi-organization platform*

### New
- **Multiple organizations** — shows, artists, and settings are isolated per organization, with a quick switcher for anyone who belongs to more than one.
- **Invite-only onboarding** — invite teammates by email and have them join through a secure link. (Public sign-up has been retired.)
- **Your profile** — a profile page with in-app password changes, plus a self-service password reset.
- **Member management** — manage members and resend pending invitations.

## 1.2.0 — May 31, 2026

*Privacy & polish*

### New
- **Cookie consent** — a GDPR consent system with granular toggles for analytics, session replay, and error tracking. Tracking runs only if you opt in.
- **Legal pages** — privacy policy and Impressum, available in English and German.

### Improved
- **Login feedback** — failed logins now show a clear inline error.

## 1.1.0 — May 19, 2026

*Bookings & design system*

### New
- **Automated offers** — artists receive a daily digest of open offers with a response window; stale offers expire automatically, and a confirmation digest follows once they're booked.
- **Understudy auto-promotion** — understudies are promoted automatically when a confirmed artist drops out.
- **Availability for producers** — artist availability is surfaced to producers and feeds an auto-suggest booking engine.

### Improved
- **New design system** — a refreshed Showflow look across the app.
- **Clearer bookings view** — a flatter, date-first layout; individual sessions replace start/end times; slot capacity is easier to read.
- **Helpful table headers** — column descriptions now appear in table headers.
- **Smarter availability** — the "block date" action is hidden once an artist already has a booking.

## 1.0.0 — April 26, 2026

*Initial release*

### New
- **Cast editing** — producers and admins can edit cast names and descriptions.
