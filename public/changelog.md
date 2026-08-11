# ShowFlow — Changelog

What's new in ShowFlow, newest first.

## 1.16.0 — August 11, 2026

*Answering "who can see our data" without leaving the app*

### New
- **Trust and data** — A new section in Settings shows what your organization holds, who can read each kind of record, and how long every category is kept. Pick a role to see exactly what it reads and the mechanism that decides it, so you can answer an artist manager on the call instead of promising to check.
- **A public trust center** — The same controls are published at showflow.pro/trust for anyone reviewing ShowFlow before they sign. No form, no NDA, no email gate.

## 1.15.0 — August 8, 2026

*A guided first run on your dashboard*

### New
- **Dashboard first run** — A welcome panel greets you on the dashboard and opens a setup checklist on demand. It shows exactly the steps your workspace needs, adapts to the modules your organization has turned on, and collapses to a single line you can reopen any time.
- **The rules you inherited** — Once setup is complete, the same panel becomes a short, read-only summary of how your organization works, so anyone who joins can see the decisions behind every number on the page.

### Improved
- **A dashboard that fills in as you go** — Until your workspace has real dates, the dashboard shows a clearly marked sample of what it becomes, then switches to your live numbers once setup is done.

## 1.14.0 — August 6, 2026

*Getting hire orders ready*

### New
- **Show date cockpit** — Opening a date now leads with the work: an anchored header with the fill meter and one primary action, a facts and activity rail that stays put, and tabs for cast, offers, hire order, chat, and setup. Filling a date and getting it signed no longer competes with once-a-season setup.
- **Peek a date from the list** — Hover a bookings row (or press Space) for a quick card showing who is waiting on you and how many slots are open, and confirm the accepted artists right there. Enter still opens the full date.
- **Hire order setup checklist** — A checklist beside your hire orders shows exactly what is needed before the first order can be sent, and lets you set it right there. It disappears once you are set up.
- **Ready-made terms templates** — Start from a prepared set of engagement terms instead of writing clauses from scratch. You get your own copy, so editing it changes nothing for anyone else.
- **Bookings setup checklist** — A checklist beside Shows and bookings walks you through the booking flow, slot counts, cast priorities, eligibility, and response timing, then retires itself once the first offer can go out.
- **Rehearse the next date** — Preview exactly who the next date would offer, and when, without creating a booking or sending a single email.
- **Upcoming, past, or all dates** — Bookings, hire orders, and availability now let you switch between upcoming, past, and all dates. Bookings and availability start on upcoming; past dates appear dimmed but stay clickable everywhere they show.

### Improved
- **One clear next step per date** — The date header shows a single primary action that follows your booking flow: confirm the artists waiting on you, open the next offer tier, book from eligibility, or generate the hire order.
- **Know before you send** — Issuing a hire order now shows anything missing first, with the fix right there, instead of failing after you press send.
- **Batch issuing is honest about what it can send** — Select any number of orders and see exactly how many can go now. The rest stay selected as drafts so you can fix them.
- **Signing is on the document** — Artists sign right under the order they are reading, instead of in a separate window.
- **Honest setup blockers** — Each outstanding booking setup step says whether it stops offers entirely or only stops a date filling, so you know what to fix first.
- **Bring back the setup checklist** — Hidden the setup checklist and want it back? A button on the same screen reopens it, and the checklist now opens in a roomier panel instead of a narrow side column.
- **Overdue hire orders stay in view** — The hire orders list shows every order by default and flags any past its date that still needs signing as Overdue, so nothing awaiting countersignature slips out of sight.
- **Roomier new order wizard** — The guided new order flow is wider, giving multi-date engagements more space in the date and artist grids.

### Fixed
- **Past holds stay visible** — A hold on a date that has already passed no longer disappears from your bookings, so you keep a record of what you were booked for.

## 1.13.0 — July 25, 2026

*Clearer fees on multi-date hire orders*

### New
- **Fee per date or total** — When a hire order covers several dates, choose whether the engagement fee applies to each date or to the whole engagement. A per-date fee is multiplied by the number of dates, and the wizard shows the running total as you enter it and again on the review step. Set your organization's default choice in Settings → Hire orders → Order defaults.
- **Fee breakdown on the PDF** — A per-date order now prints a line such as "500.00 per date x 3 dates" above the total, so the artist can see how it was reached.
- **PDF template editor** — Settings → Hire orders → PDF template opens a live editor for the hire order document. Pick any element from the outline, then change its wording, font, size, weight, colour, spacing, or letter case, and watch the real PDF update as you type. Changes apply to the next order issued, not to documents already issued.
- **Scale the whole document at once** — A single control in the template editor's Document panel grows or shrinks every element together, so the type hierarchy stays intact instead of resizing each line by hand.

### Improved
- **Dates carry into the artist grid** — Dates picked in the first step of the new order wizard are now assigned to every selected artist automatically, so the grid starts filled in instead of empty. Uncheck any dates that do not apply, then continue.

## 1.12.0 — July 24, 2026

*More flexible hire orders*

### New
- **Name your own terms templates** — Rename, add, and remove the terms templates on your hire orders in Settings → Hire orders. Pick a default that new orders start from.
- **Per-date running orders** — When a hire order covers several dates, each date now carries its own session times, pulled from the synced event and editable in the new-order wizard.
- **Editable hire order wording** — Customize every label and line printed on your hire order PDF from Settings → Hire orders, with a live preview before you save.
- **Booking agent signature** — Upload your booking agent's signature once and it prints on the producer line of every hire order you issue.

### Improved
- **Start hire orders where you work** — Shows & Bookings now shows how many dates are ready for a hire order, with a button on each ready date, and the same shortcut in the date's detail panel, to start one on the spot.
- **Copy a session length to every date** — In the new-order wizard, set a session's duration once and copy it to all the dates you selected.
- **Multi-date orders skip dates already covered** — Creating hire orders across several dates now leaves out any date that already has an order and tells you which were skipped.

### Fixed
- **Creating hire orders with custom terms** — Fixed an error that could block new hire orders from being created after you added or renamed a terms template. New orders, including ones that cover multiple dates, now save reliably.

## 1.11.0 — July 23, 2026

*Granular producer permissions*

### New
- **Roles & permissions** — A new Settings section lets admins decide exactly what producers may do in the organization, from creating productions and confirming bookings to issuing hire orders. Rights are grouped by area, and the more consequential ones ask for confirmation before they change.
- **Invitation controls on the Artists page** — Producers can now resend or revoke a pending artist invitation right where they manage the roster, instead of asking an admin.

### Improved
- **Producers can manage the artist roster** — Adding an artist, importing artists in bulk, and sending app invites are now available to producers by default. Admins can switch any of these off for their organization.
- **More settings visible to producers** — Booking flow, Airtable sync, Filters, Notifications, Hire orders, and Organization now open for producers in read-only form, so they can see how the organization is set up. Editing stays available only where an admin has granted the right.
- **Permissions apply everywhere** — Every right is enforced by the server as well as the interface, so a turned-off right blocks the action itself, not just the button.

## 1.10.3 — July 22, 2026

*Easier settings navigation*

### Improved
- **Settings navigation** — Settings now uses a grouped side menu instead of one long row of tabs, so every section stays visible and easy to find as the list grows. Related sections sit together under clear headings, and on smaller screens the menu becomes a compact scrollable strip.

## 1.10.2 — July 21, 2026

*Reliability fixes*

### Fixed
- **Endless loading spinner** — Opening the app with several tabs signed in to the same account could leave one tab stuck on the loading spinner. It now retries and recovers on its own instead of hanging, so you no longer need to reload.

## 1.10.1 — July 21, 2026

*Reliability fixes*

### Improved
- **Locked modules in the sidebar** — Features your organization hasn't switched on now appear as a locked item in the sidebar instead of being hidden, so it's clear what is available to enable.

### Fixed
- **Automatic offers** — Newly added show dates once again open their first round of artist offers automatically.

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
