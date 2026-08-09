# What users ask themselves along the journey — per-role question inventory

Date: 2026-08-09
Status: research (code-grounded), feeds onboarding/wizard content, gap audits, help/FAQ, and journey planning.

## Purpose and how to use this document

For each user type (admin, production team, artist, plus the super-admin entry point) this document walks the entire journey and lists the questions users silently ask themselves at each stage, whether the shipped app answers them today, and what the natural fix is when it doesn't.

Four downstream uses, all served by the same matrix:

1. **Wizard & onboarding content** — filter a stage's questions; each unanswered one is a candidate line of wizard/rail copy.
2. **Gap audit** — every ❌ and 🟡 row is a finding; the summary table at the end collects them.
3. **In-app help / FAQ** — the question column *is* the FAQ, phrased in the user's voice.
4. **Journey planning** — stages, anxieties, and drop-off risks per role.

### Legend

| Mark | Meaning |
|---|---|
| ✅ | Answered by a shipped surface (the surface is named) |
| 🟡 | Partially answered: the answer exists but is easy to miss, lives on the wrong surface, or omits the number/consequence that makes it useful |
| ❌ | Not answered anywhere in the product today |

Opportunity types: **wizard** (first-run/setup rail copy), **help** (contextual help rail, tooltip, empty state), **faq** (durable help page), **email** (transactional email copy), **product** (needs a behavior change, not just copy).

### Grounding

Every coverage claim below was verified against the shipped surfaces: `DashboardWelcome` + setup rails (`firstRun.ts`, `moduleOnboarding.ts`), the booking/hire inline setup rails and waiting cards, `LoginPage` / `AcceptInvitePage` / `NoOrgScreen` / `SuspendedOrgScreen`, `ArtistDashboard` + `AvailabilityPage` + `ArtistAvailabilityCalendar` + `OfferResponseButtons`, `ProfilePage`, `ChatPanel`, `SignHireOrderDialog`, the transactional-email registry (10 templates), and every `notifications` insert across edge functions and triggers.

---

## Stage skeleton (shared by all roles)

| # | Stage | Moment |
|---|---|---|
| 0 | Before the app | The invitation email lands |
| 1 | Crossing the threshold | Accept the invite, create/sign in to the account |
| 2 | First session | First look at the dashboard |
| 3 | First real task | The role's first meaningful action |
| 4 | Steady state | Daily/weekly use |
| 5 | Edge cases & exits | Things going wrong, leaving |

---

## Entry point: the super-admin / org provisioning preamble

Every journey starts when a super-admin provisions the org (Platform console → New organization: module picker, first-admin invite). Super-admins are internal operators; their questions ("which modules should this org start with?", "what does the founding admin receive?") are answered by the `NewOrgDialog` copy and `FEATURE_REGISTRY` descriptions. Two things they cannot see, and should be able to check before the first admin does:

- **"What will the founding admin's first session look like with the modules I picked?"** — 🟡. The module picker shows labels/descriptions, but there is no preview of the resulting onboarding (a fresh org with everything off gets a dashboard with off-footers only). *Opportunity: help.*
- **"Did the invite arrive / was it opened?"** — 🟡. Resend exists; open/accept status is only visible as the pending-invite row. *Opportunity: product (invite status), low priority.*

---

## Admin journey

The admin is typically the org's first user, invited by the platform, landing in a completely empty workspace they are responsible for making real.

### Stage 0 — the invitation email

| Question in their head | Coverage | Where / gap | Opportunity |
|---|---|---|---|
| What is ShowFlow? What does it do? | ❌ | `org-invitation` says "You've been invited to join {org}… Accept to set up your account." No product explanation anywhere in any email. | email |
| What does being the "admin" mean? What am I signing up to own? | ❌ | Role appears as a bare suffix ("…as admin") with no explanation of what the role can/must do. | email |
| Is this legitimate? Who sent it? | 🟡 | Org name is present; no sender/person context ("{name} invited you"). | email |
| How long do I have to accept? | 🟡 | "This invitation expires in 14 days" exists but only as small footer text. | email |

### Stage 1 — accepting and signing in

| Question | Coverage | Where / gap | Opportunity |
|---|---|---|---|
| Do I create an account or sign in? | 🟡 | Handled procedurally (net-new users route through the Supabase invite link → set password; existing users bounce to login and back). Never narrated; a user who mixes the paths gets the "sent to a different email address" error as their first explanation. | help |
| Which org am I joining, and as what? | ❌ | `AcceptInvitePage` accepts automatically on landing. There is no "Join {org} as {role}?" preview/confirm step. | product |
| What did accepting just commit me to? | ❌ | Success toast is "Invitation accepted", then straight into the app. | help |

### Stage 2 — first session on the dashboard

This is the strongest part of the shipped journey. The first-run system answers most of the natural questions explicitly.

| Question | Coverage | Where | Opportunity |
|---|---|---|---|
| Where am I? Is this thing empty or broken? | ✅ | Welcome hero: "You are the first admin at {org}. The database is empty. A few steps put real dates on this page, and the sample below becomes yours." + greyed `SamplePreview` labeled "Sample". | — |
| What do I do first, and how long will it take? | ✅ | "Start setup" + "About 15 minutes" + the setup rail's ordered steps. | — |
| What blocks what? Can I explore without breaking things? | ✅ | Rail body: "Some of these block the first offer. Nothing here stops you using the rest of the app." + per-step chips (Blocks offers / Blocks filling / Blocks issuing). | — |
| What will this page look like when it works? | ✅ | `SamplePreview` fixture ("What this page becomes"). | — |
| Why don't I see [module]? | ✅ | Off-footers: "Hire orders is off for this org. Ask your account manager to switch it on." | — |

### Stage 3 — doing the setup (the admin's first real task)

| Question | Coverage | Where / gap | Opportunity |
|---|---|---|---|
| Which booking flow should I pick? What's the difference? | ✅ | `FlowPresets`: Classic / Fast-track / Direct book / Custom, each with a one-line consequence description, changeable later. | — |
| What breaks if I skip a step? | ✅ | Per-step todo hints ("A show with no slot count never reads as full", "Without a match the tier opens to nobody"). | — |
| What are casts, ladders, tiers? What's the mental model? | 🟡 | Step hints explain consequences well but assume the concepts. The conceptual guide exists (`docs/app-logic.md`, Settings → Documentation) but is not linked from the rail steps. | help |
| Can I test this without emailing real people? | ✅ | The Rehearsal dry-run: "Nothing is created and no email leaves." | — |
| **How do my people get in? How do artists get accounts?** | ❌ | The setup rail has no "invite your team / artists" step at all (steps are flow, slots, ladder, eligibility, timing + hire-order letterhead/terms/countersign). Invites live in Admin → People and the bulk artist import exists, but nothing in onboarding points there. An admin can "complete setup" with zero humans in the org. | wizard |
| When does the first offer actually go out, and to whom? | 🟡 | Timing step sets the digest hours; the rehearsal shows send time for one date. The end-to-end "what happens tonight" narrative (sync → tier opens → digest at 19:00 → 48h window) is only in the inherited-rules list after completion. | wizard |
| Do artists see what I see? What does their side look like? | ❌ | Nothing shows an admin the artist's experience (view-as exists for admins but nothing suggests using it during onboarding). | help |

### Stage 4 — steady state

| Question | Coverage | Where / gap | Opportunity |
|---|---|---|---|
| What runs automatically vs. what needs a human? | ✅ | Inherited-rules list ("Offers with tiers", "Daily offer digest", "Confirm is manual…") + Settings → Documentation → System Map. | — |
| What's waiting on me today? | ✅ | Dashboard queue + "N artists are waiting on a confirm from you." | — |
| Why did this tier escalate / this offer expire? | 🟡 | `tier_escalated` / `cast_escalation_requested` notifications state the fact, but notifications don't deep-link (clicking only marks read), so finding the date is manual. | product |
| Did the Airtable sync work? Why are dates missing? | 🟡 | `airtable_sync_held` in-app notification + "Review the Last sync report in Settings → Airtable." In-app only; an admin who lives in email can miss it. | email |
| How do I change someone's role / remove someone? What happens to their data? | 🟡 | Admin → People handles the mechanics; consequences (what a removed artist still sees, what happens to their bookings) are not narrated. | faq |
| Who gets notified when I change a schedule? | 🟡 | The change-log → confirmation-digest pipeline works, but nothing at edit time tells the admin "booked artists will be told tonight at 20:00". | help |

### Stage 5 — edge cases & exits

| Question | Coverage | Where / gap | Opportunity |
|---|---|---|---|
| Why is my org suspended? Who do I contact? | 🟡 | `SuspendedOrgScreen` reassures ("Your data is safe") and says "contact your platform administrator", but gives no reason and no contact channel. | help |
| Can I export everything / delete the org? | ✅ | Per-user export on Profile; org deletion + full export are platform actions (correctly not self-serve). | — |
| What happens if I (the only admin) delete my account? | ✅ | Last-admin guard blocks it server-side. | — |

---

## Production team journey

Producers usually join an org that an admin is still setting up, or one that's already humming. Their central anxieties: "what's my job here, what's automated, and what am I allowed to touch?"

### Stage 0–1 — invitation and entry

Same entry gaps as the admin (what is ShowFlow ❌, what does my role mean ❌, which org am I joining ❌), plus one of their own:

| Question | Coverage | Where / gap | Opportunity |
|---|---|---|---|
| What's the difference between me ("Production Team") and the admin? | ❌ | Nowhere user-facing. The access-by-area matrix exists only in `docs/app-logic.md`. | faq |

### Stage 2 — first session

| Question | Coverage | Where | Opportunity |
|---|---|---|---|
| Is this org ready, or still being built? | ✅ | "{org} is still being set up. Dates, offers and confirmations appear here the moment the first import lands." | — |
| Why is everything empty — is it me or the org? | ✅ | Producer-without-capability rail body: "Only an admin can do these. This is here so you know why the page is empty, not so you can fix it." This is the single best piece of expectation-setting copy in the app. | — |
| **Who exactly do I ask to finish setup?** | ❌ | The waiting cards deliberately never name the admin (RBAC limitation noted in code). "An admin has to finish setup" with no way to see who the admins are. | product |
| What can I do while I wait? | ✅ | "Plan dates now, offer later" / "Nothing stops you adding dates and sessions." | — |
| I joined a mature org — what are the house rules? | ✅ | Complete-state welcome: "You have joined {org}" + inherited-rules list ("You cannot change these, but every number on this page follows them"). | — |

### Stage 3 — first real task (confirming a booking, opening a tier)

| Question | Coverage | Where / gap | Opportunity |
|---|---|---|---|
| Where do dates come from? Can I add one by hand? | 🟡 | "Dates keep syncing" implies Airtable; manual `ShowDateFormDialog` exists. The dual source (sync + manual, and what sync overwrites) isn't explained at the point of creation. | help |
| What does confirming actually do? Is it final? What does the artist experience? | 🟡 | Confirm is a button; the consequence chain (artist gets `booking_confirmed` in-app now, the email digest lands at 20:00 Berlin, chat opens for them) is never narrated at the point of action. | help |
| What's "soft-booked"? Why can't I just book someone? | 🟡 | Status labels exist; the flow explanation lives in the inherited-rules list, not on the bookings surface where the statuses appear. Direct-book orgs sidestep this. | help |
| What's a tier, and when do I open the next one? | 🟡 | Ladder/tier mechanics explained in the setup rail (admin surface); the per-date tier controls in `ShowDateDetailSheet` assume the concept. | help |
| What if I need an artist outside the eligible casts? | 🟡 | Direct booking from the eligibility list; "no eligibility config = unrestricted" is a rule only documented in app-logic.md. | faq |
| When do artists hear about what I just did? | ❌ | Digest send hours are a Settings value producers may not be able to see; no surface at action time says "this reaches the artist tonight at {hour}". | help |

### Stage 4 — steady state

| Question | Coverage | Where / gap | Opportunity |
|---|---|---|---|
| What needs me today? | ✅ | Dashboard queue ("Waiting on you", "Expiring today", "Unfilled tiers"). | — |
| A tier is "at risk" — what am I supposed to do about it? | 🟡 | `tier_at_risk` states the math ("P pending, A accepted, need R") but has no email counterpart and no deep link; the recovery actions (open next tier, direct-book) aren't suggested. | product |
| An understudy got promoted — do I need to do anything? | ✅/🟡 | "Understudy ready to confirm" notification lands in the confirm queue; fine — but no deep link. | product |
| When do hire-order drafts appear? Why is this order frozen? | ✅ | "Auto-drafted on fill" rule + issued-state freeze is DB-enforced and documented; the setup rail explains "Issuing is manual". | — |
| Can I undo an issued order? | 🟡 | Void exists; the viewer doesn't explain the void-then-redraft path. | help |
| What does this artist see / did they get my message? | ❌ | No read-status, no artist-view preview. Chat participation rules are stated, delivery isn't. | faq |

### Stage 5 — edge cases

| Question | Coverage | Where / gap | Opportunity |
|---|---|---|---|
| A confirmed artist pulled out day-of — what now? | 🟡 | Cancel + auto understudy promotion works and is explained in the rules list; the cancellation surface doesn't preview "an understudy will be auto-promoted" before you cancel. | help |
| I cancelled a date — who gets told, and when? | 🟡 | Change-log → digest + in-app "Booking cancelled" notification; again invisible at the point of action. | help |

---

## Artist journey

The artist is the most numerous, least invested user type, on the smallest screen, with the highest drop-off risk. Their questions are shorter and more emotional: "what is this, what do they want from me, am I committed, will saying no hurt me?"

### Stage 0 — the invitation email

| Question | Coverage | Where / gap | Opportunity |
|---|---|---|---|
| What is ShowFlow? Is this spam? | ❌ | Same mechanical invitation copy as everyone else. | email |
| Does this invite mean I'm hired / on the roster? What's expected of me? | ❌ | Nothing distinguishes the artist invitation from an admin one beyond the role suffix. | email |
| Do I have to do this to keep getting work? | ❌ | Unaddressed; the email gives no stakes or benefit ("get offers by email, answer in one tap"). | email |

### Stage 1 — entry

Same as other roles (account-vs-login 🟡, which org ❌). One artist-specific:

| Question | Coverage | Where / gap | Opportunity |
|---|---|---|---|
| Did they link me to the right profile? | 🟡 | Auto-link by email; on failure the toast "we couldn't auto-link your artist profile — an admin can link it" is honest, and the dashboard shows "No artist profile linked to your account. Ask an admin to link your account." Good copy, but the artist can't see or fix anything themselves. | — |

### Stage 2 — first session

| Question | Coverage | Where | Opportunity |
|---|---|---|---|
| What is this page and what do I do first? | ✅ | "{org} added you to the roster. Offers arrive by email and land on this page. Block the dates you cannot play first, so you only get asked about dates that work." | — |
| How long will this take? What if I do nothing? | ✅ | "About 2 minutes" + "None of this blocks anything. It just makes the offers you get worth answering." | — |
| How do offers reach me, and by what rules? | ✅ | Inherited rules: "Eligibility comes from your cast", "Offers arrive in a daily digest", "You have a response window". The strongest rule-explaining surface in the app. | — |
| **How long is the response window, actually?** | 🟡 | The rules say a window exists and that expiry escalates, but never the number. `offer-immediate` email states the hours; the digest email shows only per-row deadlines. An artist on digest delivery never sees "you generally get 48h". | wizard |

### Stage 3 — the first offer

| Question | Coverage | Where / gap | Opportunity |
|---|---|---|---|
| **I accepted — am I booked now?** | 🟡 | The toast says only "Offer accepted". The truth ("Hold placed — awaiting producer confirmation") exists in the calendar popover and the "Hold placed" badge, but a user acting from the toast alone believes they're done. Highest-impact single copy fix in the artist journey. | help |
| If I decline, will I get fewer offers later? | ❌ | The anxiety behind every decline. Nothing addresses it (the honest answer: declining just cancels that offer). | faq |
| What happens if I just don't answer? | ✅ | "After it passes the offer expires and goes to the next tier." + expiry-reminder email/notification at T-24h. | — |
| **Why can't I click this date?** | ❌ | Ineligible calendar cells are dimmed and disabled with no tooltip, aria-label, or caption explaining why ("not one of your cast's dates"). The legend must be reverse-engineered. | help |
| **Why do I see no dates at all?** | ❌/🟡 | The calendar has no empty state whatsoever for zero eligible dates (a grid of dead cells + a legend advertising "Eligible" that matches nothing). The list view is better: "No eligible dates yet. Once you're added to a cast, offered dates appear here." | help |
| Does blocking a date affect existing bookings? | 🟡 | "Mark dates you're unavailable so the system won't send you offers" covers future offers; silence on existing bookings (they're untouched). | help |

### Stage 4 — steady state

| Question | Coverage | Where / gap | Opportunity |
|---|---|---|---|
| What am I committed to this month? | ✅ | Bookings view + calendar badges (Booked / Hold / Offer / Blocked). | — |
| What does my "response rate" count, and does it matter? | ❌ | The meter shows a % with no definition of what counts (accepted + soft-booked) and no statement of whether anyone judges it. | help |
| Who can see this chat? Why can't I see chat for a date I was offered? | ✅ | "Chat is only available to producers, admins, and artists booked or soft-booked for this date." | — |
| Who in the org sees my phone/email? | ❌ | Contact visibility (admins/producers see the artist record's contact) is never stated to the artist. | faq |
| What is this hire-order document? Do I have to sign? What am I agreeing to? | 🟡 | Status badge translates `issued` → "Awaiting countersign" (good); the consent checkbox is legally explicit. But the dialog relies on "the document shown on this page" and never summarizes the terms; and there's no explanation of what happens after signing. | help |
| Where's my fee? | 🟡 | On the hire order when the module is on. The dashboard card has **no empty state** — an artist in a hire-orders org with zero orders never learns the feature exists. Orgs without the module: nothing, by design. | help |
| When does the digest email arrive? | ❌ | 19:00 Berlin default, never surfaced to artists. | faq |

### Stage 5 — edge cases & exits

| Question | Coverage | Where / gap | Opportunity |
|---|---|---|---|
| **I'm confirmed but now I can't make it — how do I cancel?** | ❌ | There is no artist-side cancel for a confirmed booking, and no copy telling the artist the correct path (contact the producer / use chat). A confirmed artist with an emergency has no signposted action. | help |
| I got promoted from understudy — what does that mean for me? | ✅ | "You have been moved to the main cast…" notification states it plainly (though with no deep link). | — |
| The show moved/cancelled — is my info current? | 🟡 | Schedule-change in-app notifications + confirmation digest, but that digest email has **no CTA/link back into the app** — the only template without one. | email |
| What happens to my stuff if I delete my account? | ✅/🟡 | Unusually good copy ("personal details removed; shared booking history is kept but de-identified") — but silent on hire orders and in-flight offers. | faq |
| I work with two orgs — which one am I looking at? | 🟡 | Org switcher handles it; the "suspended" tag on other orgs is unexplained. | — |

---

## Cross-role systemic findings

These recur across every role and are bigger than any one wizard:

1. **Stage 0–1 is the weakest part of the journey for every role.** The product's best explanatory surfaces (welcome hero, setup rails, inherited rules) all live *after* login. The invitation email, the accept flow, and the first-session transition explain nothing about what ShowFlow is, what the role means, or which org is being joined. The best onboarding copy in the app is unreachable by the person deciding whether to click the link.
2. **Consequence narration is missing at the point of action.** The app explains rules *in the rails* but not *at the buttons*: accepting an offer doesn't say "awaiting producer confirmation"; confirming a booking doesn't say "artist is told tonight at 20:00"; cancelling doesn't preview understudy promotion; blocking doesn't say "existing bookings unaffected".
3. **In-app notifications are dead ends.** Every insert carries `related_entity_type`/`related_entity_id`, but clicking only marks read. Every "so what do I do?" question downstream of a notification inherits this.
4. **Numbers are withheld from artists.** The response window duration and digest hour are stated as concepts, never as values, even though both are org settings the copy layer could read.
5. **The empty-vs-broken distinction is handled brilliantly on the dashboard and nowhere else.** The calendar with zero eligible dates, the hire-orders card with zero orders, and the notifications bell have no equivalent of the Sample/"What this page becomes" treatment.

---

## Gap-audit summary (all ❌ and load-bearing 🟡 rows)

Ranked by (reach × journey criticality). "Fix" names the natural surface.

| # | Gap | Roles hit | Fix | Effort |
|---|---|---|---|---|
| 1 | Invitation email explains nothing (product, role, org, sender) | all | email copy rewrite; role-specific paragraph | S |
| 2 | Accept flow has no org/role preview or confirm step | all | product: preview screen on `AcceptInvitePage` | M |
| 3 | "Offer accepted" toast omits the hold/confirmation reality | artist | help: toast copy reads the org's flow ("Accepted. The producer confirms next.") | S |
| 4 | Calendar: no disabled-date explanation, no zero-eligible empty state | artist | help: tooltip/caption + empty state | S–M |
| 5 | Notifications never deep-link | all | product: navigate on click via `related_entity_*` | M |
| 6 | Response window & digest hour never shown as numbers to artists | artist | wizard/help: read org settings into rail + availability page | S |
| 7 | Admin onboarding has no "invite your people" step | admin | wizard: add a people step to the rail | M |
| 8 | No artist-side path (even copy) for cancelling a confirmed booking | artist | help/faq: signpost chat/producer contact | S |
| 9 | Confirm/cancel/schedule-edit actions don't narrate who gets told when | admin, producer | help: microcopy at action points | M |
| 10 | Waiting cards can't name the admin(s) to ask | producer | product: expose admin display names to members | M |
| 11 | Response-rate meter undefined | artist | help: one-line definition under the meter | S |
| 12 | `artist-confirmation-digest` email has no CTA/link | artist | email: add button | S |
| 13 | Hire-orders dashboard card has no zero-state | artist | help: empty state introducing the document flow | S |
| 14 | Role capabilities matrix not user-facing ("what can Production Team do?") | admin, producer | faq/docs surface | M |
| 15 | Contact-visibility ("who sees my phone?") unstated | artist | faq/privacy note on profile | S |
| 16 | `tier_at_risk` / `airtable_sync_held` have no email counterpart | admin, producer | email: optional templates | M |
| 17 | Suspended-org screen: no reason, no contact channel | all | help + product (contact link) | S |
| 18 | Conceptual model (casts/tiers/ladders) not linked from setup steps | admin | help: link app-logic docs from rail steps | S |

## Where new wizards or help rails would pay off most

- **An "invite your people" step in the admin setup rail** (#7) — the only genuinely missing *step* in an otherwise complete setup story; the org cannot function without it and onboarding never mentions it.
- **An artist "your first offer" moment** — the existing `FirstOfferCard` is the right hook; extend it to carry the window duration (#6), the accept-consequence (#3), and the decline reassurance. One card answers the artist's three biggest anxieties at exactly the right time.
- **A stage-0 rewrite rather than a new wizard** — the invitation email + accept preview (#1, #2) beats any in-app wizard for reach, because it meets users before the first drop-off point.
- **Point-of-action consequence microcopy** (#3, #9) as a pattern, not a project: a one-line "what happens next, and when" under every state-changing button, reading the org's actual flow and digest settings.
- **Empty states as onboarding** (#4, #13): the Sample-preview pattern already proved the approach on the dashboard; the calendar and hire-orders card are the two surfaces still failing the "empty or broken?" test.
