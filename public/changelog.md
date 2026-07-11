# ShowFlow — Changelog

What's new in ShowFlow, newest first.

## 1.8.2 — July 11, 2026

*Dark mode*

### New
- **Dark mode** — Switch between Light, Dark, and System appearance from the new toggle in the top bar. System follows your device automatically, and your choice is remembered across sessions.

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

### Improved
- **Organization tools (admins)** — Platform admins can now export an organization's full dataset and permanently delete an organization from the console.

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
- **Platform console** — a super-admin console for managing organizations.

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
