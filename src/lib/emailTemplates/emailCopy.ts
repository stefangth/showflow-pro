// Editable transactional-email copy. This pure registry is mirrored into the
// edge runtime so preview, delivery, and the browser editor agree on defaults.
//
// DUAL-HOME PAIR: src/lib/emailTemplates/emailCopy.ts generates
// supabase/functions/_shared/transactional-email-templates/_shell/emailCopy.ts.
// Edit this source, then run `npm run sync:mirrors`; never edit the target.

export const EMAIL_TEMPLATE_KEYS = [
  "offer-immediate",
  "artist-offer-digest",
  "offer-expiry-reminder",
  "artist-confirmation-digest",
  "cast-escalation-requested",
  "tier-at-risk",
  "hire-order-issued",
  "hire-order-countersigned",
  "org-invitation",
  "account-email-changed",
  "magic-link",
  "cron-health-alert",
  "airtable-sync-held",
] as const;

export type EmailTemplateKey = typeof EMAIL_TEMPLATE_KEYS[number];

export const EMAIL_COPY_DEFAULTS = {
  "offer-immediate.subject": "Can you do {{referenceLabel}}? · {{date}}",
  "offer-immediate.heading": "Can you do this one?",
  "offer-immediate.greeting": "Hi {{displayName}},",
  "offer-immediate.greetingAnonymous": "Hi,",
  "offer-immediate.intro": "You have been asked about {{referenceLabel}} on {{where}}. Say yes and the date is held for you. Say no and it will not count against you, and it does not affect any other date. Answer within {{hours}} hours.",
  "offer-immediate.ctaLabel": "Answer this ask",
  "offer-immediate.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "offer-immediate.previewText": "Can you do {{referenceLabel}} on ShowFlow?",
  "offer-immediate.showLabel": "Production",
  "offer-immediate.dateLabel": "Date",
  "offer-immediate.showFallback": "a production",

  "artist-offer-digest.subject": "{{count}} {{pendingOffer}} on ShowFlow",
  "artist-offer-digest.heading": "{{count}} {{pendingOffer}} on ShowFlow",
  "artist-offer-digest.greeting": "Hi {{displayName}},",
  "artist-offer-digest.greetingAnonymous": "Hi,",
  "artist-offer-digest.intro": "You have {{count}} {{pendingOffer}}. Say yes and the date is held for you. Say no and it will not count against you, and it does not affect any other date.",
  "artist-offer-digest.ctaLabel": "Answer these",
  "artist-offer-digest.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "artist-offer-digest.previewText": "You have {{count}} {{pendingOffer}}. Say yes and it is held for you.",
  "artist-offer-digest.pendingOfferSingular": "date to answer",
  "artist-offer-digest.pendingOfferPlural": "dates to answer",
  "artist-offer-digest.showLabel": "Production",
  "artist-offer-digest.dateLabel": "Date",
  "artist-offer-digest.cityLabel": "City",
  "artist-offer-digest.expiresLabel": "Answer by",

  "offer-expiry-reminder.subjectSingular": "Reminder: answer by tomorrow",
  "offer-expiry-reminder.subjectPlural": "Reminder: {{count}} asks need an answer by tomorrow",
  "offer-expiry-reminder.headingSingular": "This one needs an answer soon",
  "offer-expiry-reminder.headingPlural": "{{count}} asks need an answer soon",
  "offer-expiry-reminder.greeting": "Hi {{displayName}},",
  "offer-expiry-reminder.greetingAnonymous": "Hi,",
  "offer-expiry-reminder.introSingular": "One of your asks needs an answer within the next 24 hours. Answer soon to keep the date.",
  "offer-expiry-reminder.introPlural": "{{count}} of your asks need an answer within the next 24 hours. Answer soon to keep the dates.",
  "offer-expiry-reminder.ctaLabelSingular": "Answer this ask",
  "offer-expiry-reminder.ctaLabelPlural": "Answer your asks",
  "offer-expiry-reminder.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "offer-expiry-reminder.previewSingular": "Reminder: answer by tomorrow on ShowFlow",
  "offer-expiry-reminder.previewPlural": "Reminder: {{count}} asks need an answer by tomorrow on ShowFlow",
  "offer-expiry-reminder.offerLine": "{{referenceLabel}} on {{date}}: answer by {{expiresAt}}",

  "artist-confirmation-digest.subjectUpdates": "Updates to your dates on ShowFlow",
  "artist-confirmation-digest.subjectConfirmed": "You are booked on ShowFlow",
  "artist-confirmation-digest.headingUpdates": "What changed",
  "artist-confirmation-digest.headingConfirmed": "You are booked",
  "artist-confirmation-digest.greeting": "Hi {{displayName}},",
  "artist-confirmation-digest.greetingAnonymous": "Hi,",
  "artist-confirmation-digest.introUpdates": "Here is what changed on your dates.",
  "artist-confirmation-digest.introConfirmed": "Here is what just got booked. We are excited to have you on stage!",
  "artist-confirmation-digest.ctaLabel": "View your dates",
  "artist-confirmation-digest.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "artist-confirmation-digest.cancelledHeading": "Cancelled",
  "artist-confirmation-digest.scheduleChangesHeading": "Schedule changes",
  "artist-confirmation-digest.confirmedHeading": "Booked",
  "artist-confirmation-digest.showLabel": "Production",
  "artist-confirmation-digest.dateLabel": "Date",
  "artist-confirmation-digest.cityLabel": "City",
  "artist-confirmation-digest.reasonLabel": "Reason",
  "artist-confirmation-digest.changeLabel": "Change",
  "artist-confirmation-digest.reasonFallback": "Not specified",
  "artist-confirmation-digest.emptyState": "Nothing booked yet.",

  "cast-escalation-requested.subject": "Tier {{tier}} for {{program}} on {{date}} ran out of time",
  "cast-escalation-requested.heading": "This date needs a decision",
  "cast-escalation-requested.intro": "Tier {{tier}} for {{program}} on {{date}} ran out of time with only {{accepted}} of {{required}} parts filled.",
  "cast-escalation-requested.followup": "Open the next tier to keep asking, or book someone directly.",
  "cast-escalation-requested.ctaLabel": "Open this date",
  "cast-escalation-requested.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "cast-escalation-requested.previewText": "Tier {{tier}} for {{program}} on {{date}} ran out of time",
  "cast-escalation-requested.showLabel": "Production",
  "cast-escalation-requested.dateLabel": "Date",
  "cast-escalation-requested.tierLabel": "Tier",
  "cast-escalation-requested.filledLabel": "Filled",
  "cast-escalation-requested.slotsLabel": "parts",
  "cast-escalation-requested.showFallback": "a production",
  "cast-escalation-requested.dateFallback": "TBD",

  // The early-warning twin of cast-escalation-requested above: tier-at-risk-watcher
  // fires this while the tier is still open but can no longer mathematically fill
  // before its deadline, so the recovery guidance points at the SAME two remedies
  // (open the next tier, or book directly) rather than only "open the next tier" —
  // a still-open tier can still be filled by a direct booking too.
  "tier-at-risk.subject": "{{program}} on {{date}} is at risk",
  "tier-at-risk.heading": "This date is at risk",
  "tier-at-risk.body": "Tier {{tier}} for {{program}} on {{date}} cannot fill on the current asks. {{pending}} still waiting to answer, {{accepted}} said yes, and {{required}} parts needed. Open the next tier, or book someone directly from who can be asked.",
  "tier-at-risk.ctaLabel": "Review this date",
  "tier-at-risk.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "tier-at-risk.previewText": "{{program}} on {{date}} is at risk",
  "tier-at-risk.showFallback": "a production",
  "tier-at-risk.dateFallback": "TBD",

  "hire-order-issued.subject": "Your contract for {{dateLabel}} at {{venue}}",
  "hire-order-issued.heading": "Your contract is ready",
  "hire-order-issued.greeting": "Hi {{artistName}},",
  "hire-order-issued.intro": "Your contract for {{dateLabel}} at {{venue}} is ready. Review the details below and download your copy.",
  "hire-order-issued.ctaLabel": "View and download",
  "hire-order-issued.signCtaLabel": "Review contract",
  "hire-order-issued.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "hire-order-issued.previewText": "Your contract for {{dateLabel}} at {{venue}}",
  "hire-order-issued.orderLabel": "Contract.",
  "hire-order-issued.engagementDatesLabel": "Engagement dates.",
  "hire-order-issued.venueLabel": "Venue.",
  "hire-order-issued.cityLabel": "City.",
  "hire-order-issued.feeLabel": "Fee.",
  "hire-order-issued.signPrompt": "Review and sign your contract online to confirm.",
  "hire-order-issued.signButton": "Review and sign",
  "hire-order-issued.pasteLink": "Or paste this link into your browser:",
  "hire-order-issued.manualPrompt": "Reply to confirm, or sign and return the attached PDF.",
  "hire-order-issued.artistFallback": "there",
  "hire-order-issued.dateFallback": "your date",
  "hire-order-issued.venueFallback": "the venue",

  "hire-order-countersigned.subject": "Your contract for {{dateLabel}} is signed",
  "hire-order-countersigned.heading": "Your contract is signed",
  "hire-order-countersigned.greeting": "Hi {{artistName}},",
  "hire-order-countersigned.intro": "Your contract for {{dateLabel}} at {{venue}} is fully signed. A copy is attached for your records.",
  "hire-order-countersigned.ctaLabel": "View signed contract",
  "hire-order-countersigned.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "hire-order-countersigned.previewText": "Your contract for {{dateLabel}} is signed",
  "hire-order-countersigned.orderLabel": "Contract.",
  "hire-order-countersigned.dateLabel": "Date.",
  "hire-order-countersigned.venueLabel": "Venue.",
  "hire-order-countersigned.artistFallback": "there",
  "hire-order-countersigned.dateFallback": "your date",
  "hire-order-countersigned.venueFallback": "the venue",

  "org-invitation.subject": "You're invited to join {{orgName}} on ShowFlow",
  "org-invitation.heading": "Join {{orgName}}",
  "org-invitation.greeting": "Hi,",
  // Names the two things every org does regardless of its module mix (plans shows,
  // books the artists for them): both are core, always-on concepts, not something an
  // entitlement can turn off. What stays out is the MECHANISM behind "books": hire_orders
  // and the offer/digest machinery in booking_flow are independently toggleable per org
  // (see src/lib/entitlements.ts), and artist_acceptance is a further per-org toggle (an
  // org can book straight to confirmed with no offer step at all, see
  // _shared/bookingFlow.ts). "Books the artists" is true either way; "sends offers" or
  // "confirms casts via hire orders" would not be. The roleIntro action lines below name
  // the same two facts again in second person, scoped to the invitee's specific role.
  "org-invitation.productIntro": "ShowFlow is where {{orgName}} plans its productions and books the artists for them.",
  // roleIntro states the role plainly ("Your role is {{role}}."), not "you are joining
  // as {{role}}": that phrasing parses as the invitee BEING a team once {{role}} is
  // "Production Team" rather than joining one, and "on the {{role}} side" reads
  // awkwardly for that same non-single-noun label. It also drops {{orgName}} on purpose
  // (see the "org-invitation body does not repeat the org name" test below) since
  // productIntro right above it already named the org once.
  "org-invitation.roleIntro": "Your role is {{role}}.",
  // The three roleIntro* action lines below are the second-person twin of ROLE_DESCRIPTIONS
  // (src/config/app.config.ts): same facts, different grammatical person, kept as separate
  // strings because a sentence opening "Your role is..." cannot continue into a
  // subjectless third-person clause. Review both together when either changes.
  "org-invitation.roleIntroAdmin": "You get full control of this workspace, including people, casts, settings, and every booking.",
  "org-invitation.roleIntroProducer": "You plan productions and show dates, and book artists into them.",
  // No "where that is turned on" hedge: a brand-new invitee has no way to decode who
  // turns it on or where, so the sentence states what is always true instead. This is
  // the FLOW-NEUTRAL artist line: org-invitation.tsx renders it by default, and always
  // for a direct-book org (booking_flow.artist_acceptance: false) or one where the
  // booking_flow module is unentitled or paused (booking_flow.active: false, the preset
  // every freshly provisioned org starts in), where there never is an offer step to
  // mention. See resolveArtistOffersExpected in _shared/invitations.ts for the full
  // gate. See roleIntroArtistOffers immediately below for the line an artist sees only
  // once that gate has actually confirmed offers are coming.
  "org-invitation.roleIntroArtist": "You are on the roster. You get booked for productions and can see every confirmed engagement.",
  // Rendered instead of roleIntroArtist ONLY when resolveArtistOffersExpected
  // (_shared/invitations.ts) has confirmed the inviting org's booking_flow is entitled,
  // active, AND set to accept offers (booking_flow.artist_acceptance: true) for real:
  // the caller never assumes this from BOOKING_FLOW_DEFAULTS alone, since an unentitled
  // or still-paused org would otherwise get a promise that never comes true. For the
  // (majority of) orgs where this all checks out, it names the one thing the artist will
  // really do, respond to emailed offers, instead of staying silent on it the way the
  // flow-neutral line above has to.
  "org-invitation.roleIntroArtistOffers": "You are on the roster. You will get booking offers by email, accept or decline each in one tap, then see every confirmed engagement.",
  "org-invitation.ctaLabel": "Accept invitation",
  // These used to end with "If it ever stops working, ask whoever invited you to send a
  // fresh one." That recovery clause now lives in linkRecovery (below), rendered beside
  // the paste-link fallback instead of here, so the sentence right before the button
  // stays a plain, undiluted reassurance about what clicking it does rather than a hedge
  // about it failing, planted right where the reader is about to click.
  "org-invitation.ctaHintNewUser": "Continue securely to sign in or create your account.",
  "org-invitation.ctaHintExistingUser": "Continue securely to sign in or create your account.",
  "org-invitation.ctaHintFallback": "Continue securely to sign in or create your account.",
  // "is open", not "is held": "held" reads as "queued for delivery" rather than "the
  // window this invitation is valid for". Also drops {{orgName}} for the same
  // repetition reason as roleIntro above.
  //
  // Scoped to the durable database invitation, never an Auth action link. {{expiresOn}}
  // is the expiry rendered for this send. A later resend renews the row for 30 days, so
  // an older email can only promise this date as a lower bound and explicitly directs the
  // reader to the newest invitation email for the current window.
  "org-invitation.expiryLine": "Your invitation is valid until at least {{expiresOn}}. A newer invitation email may extend this date.",
  // Fires only when expires_at itself could not be resolved (effectively prevented by the
  // NOT NULL column default): it makes no day-count claim at all, because there is no row
  // to derive one from. The remedy sentence is the whole message.
  "org-invitation.expiryFallback": "If the sign-in button stops working, ask for the invitation to be resent.",
  "org-invitation.footer": "If you weren't expecting this invitation, you can safely ignore this email.",
  "org-invitation.previewText": "You're invited to join {{orgName}} on ShowFlow",
  "org-invitation.invitedBy": "Invited by {{inviter}}.",
  // Sent as the template's `inviterName` only by provision-org, for a brand-new org's
  // first-admin invite: that recipient is a stranger to the platform operator
  // personally, so forwarding the operator's own display name or personal inbox address
  // would read as no more trustworthy than a spam sender's (a stranger has no more
  // context for "Jordan Owner" than for owner@platform.test). A generic, still-truthful
  // line beats a personalized one nobody can place. create-invitation and
  // resend-invitation never send this: their inviter is a colleague within the SAME org
  // the recipient is already joining, where resolveInviterName's own name-or-email
  // fallback already reads as legitimate.
  "org-invitation.inviterFallback": "the ShowFlow team",
  "org-invitation.pasteLink": "Or paste this link into your browser:",
  // Rendered right after the paste-link fallback (EmailShell's postCta slot, below the
  // button), not beside the button itself: this is what to do when NEITHER the button
  // NOR the pasted link works, so it reads as the last word on getting in rather than a
  // hedge planted immediately before the reader's first attempt (see ctaHintNewUser /
  // ctaHintExistingUser above, which used to carry this same clause).
  "org-invitation.linkRecovery": "If none of this works, ask whoever invited you to send a fresh invitation.",
  "org-invitation.orgFallback": "an organization",

  "account-email-changed.subject": "Your ShowFlow login email was changed",
  "account-email-changed.heading": "Your login email was changed",
  "account-email-changed.greeting": "Hi,",
  "account-email-changed.intro": "The login email for your ShowFlow account was changed by an administrator.",
  "account-email-changed.footer": "If you did not expect this change, contact your administrator right away.",
  "account-email-changed.previewText": "Your ShowFlow login email was changed",
  "account-email-changed.previousEmailLabel": "Previous email",
  "account-email-changed.newEmailLabel": "New email",
  "account-email-changed.signInPrompt": "Sign in at {{signInUrl}} using your new email address.",
  "account-email-changed.emailFallback": "unknown",

  "magic-link.subject": "Your sign-in link for ShowFlow",
  "magic-link.heading": "Sign in to ShowFlow",
  "magic-link.greeting": "Hi,",
  "magic-link.intro": "Use the button below to sign in. This link works once and expires shortly. If you did not request it, you can ignore this email.",
  "magic-link.ctaLabel": "Sign in",
  "magic-link.footer": "For your security, this link can only be used once.",
  "magic-link.previewText": "Your one-time sign-in link for ShowFlow",
  "magic-link.pasteLink": "Or paste this link into your browser:",

  "cron-health-alert.subject": "Cron health: {{jobName}} is failing ({{statusCode}})",
  "cron-health-alert.heading": "Scheduled job failing",
  "cron-health-alert.intro": "The scheduled job {{jobName}} last returned {{statusCode}}. Part of the booking engine may be degraded until it is fixed.",
  "cron-health-alert.ctaLabel": "Open System Health",
  "cron-health-alert.footer": "The ShowFlow team",
  "cron-health-alert.previewText": "Cron health alert: {{jobName}} is failing",
  "cron-health-alert.jobLabel": "Job",
  "cron-health-alert.lastStatusLabel": "Last status",
  "cron-health-alert.lastErrorLabel": "Last error",
  "cron-health-alert.lastHealthyLabel": "Last healthy",
  "cron-health-alert.jobFallback": "a scheduled job",
  "cron-health-alert.valueFallback": "unknown",

  // Rendered from defaults only, never exposed to the per-org copy editor (see
  // EMAIL_TEMPLATE_COPY_FIELDS in emailTemplateMeta.ts, which deliberately has no
  // entry for this template, and coverage.ts's "airtable-sync-held" row, status:
  // "internal"). Unlike cron-health-alert/magic-link, the row stays visible to its
  // org-admin recipients in Settings > Email templates (coverage.ts's audience:
  // "org"), but like cron-health-alert it always sends: an operational status alert
  // about the org's own data pipeline isn't preference-gated, only the blunt
  // one-click unsubscribe link opts an address out.
  "airtable-sync-held.subject": "Airtable sync needs attention in {{orgName}}",
  "airtable-sync-held.heading": "Airtable sync needs attention",
  "airtable-sync-held.heldRecordSingular": "record",
  "airtable-sync-held.heldRecordPlural": "records",
  // Mutually exclusive with introZeroImport/followupZeroImport: notifyAdminsOnSyncProblem
  // (airtable-poll) passes heldCount when records were held, else zeroImport, mirroring
  // the in-app notification message's own branching. "could not be brought into
  // ShowFlow" reads correctly for a count of 1 or many, so heldCount never needs its
  // own verb form. Cause-neutral on purpose: held_unresolved has more than one cause
  // (an unmapped program, but also a blank date cell), and the fix differs per cause
  // (a mapping edit vs. an Airtable data fix), so the email can't assert either one.
  // The sync report (linked by the CTA) carries the real per-record reason.
  "airtable-sync-held.introHeld": "{{heldCount}} Airtable {{heldRecord}} in {{orgName}} could not be brought into ShowFlow.",
  // Quantified, not a blanket claim: unlike introHeld above, this line only ever states
  // the count for the ONE category it names ("{{topReasonCount}} of the {{heldCount}}"),
  // so it stays truthful even when the held set has mixed causes. topReasonMissingDate /
  // topReasonUnlinkedProgram / topReasonUnlinkedCity are the three categories syncOrg's
  // held_unresolved branches emit (see topHeldReason in airtable-poll/index.ts); an unrecognized reason
  // is excluded from the tally there, so this line simply does not render rather than
  // ever naming a reason it can't back up. Phrased as a clause ("are {{topReasonLabel}}"),
  // not a report label ("N of M: reason"), so it reads like the rest of the email.
  "airtable-sync-held.topReasonLine": "{{topReasonCount}} of the {{heldCount}} are {{topReasonLabel}}.",
  // The partial breakdown's singular form: the smallest mixed-cause held set (two
  // records, two different reasons) makes the majority category count exactly one, and
  // "1 of the 2 are" is subject-verb disagreement. Same shape, singular verb.
  "airtable-sync-held.topReasonLineOne": "{{topReasonCount}} of the {{heldCount}} is {{topReasonLabel}}.",
  // Two redundant-fraction cases the plain N-of-M line above never should render:
  // a single held record (its one reason IS the whole story, so "1 of 1" is noise),
  // and a held set where every record shares the same reason ("N of N" always means
  // "all of them"). Both state the fact directly instead of a fraction that reduces
  // to "all".
  "airtable-sync-held.topReasonLineSingle": "It's {{topReasonLabel}}.",
  "airtable-sync-held.topReasonLineAll": "All {{heldCount}} are {{topReasonLabel}}.",
  "airtable-sync-held.topReasonMissingDate": "missing a date",
  "airtable-sync-held.topReasonUnlinkedProgram": "not linked to one of your productions",
  "airtable-sync-held.topReasonUnlinkedCity": "using a city that isn't linked to one of yours",
  // Four variants, chosen in the template by (heldCount === 1) x (does a topReasonLine
  // above already name the reason for EVERY held record). A single record is "it", never
  // "which ones" (there is only one), and once the reason line above has already said
  // why, the followup must not ask "why" again: "1 record... It's missing a date. Open
  // the sync report to see which ones and why..." was both ungrammatical (plural "ones"
  // for one record) and self-contradicting (re-promising a "why" the sentence right
  // before it just gave).
  "airtable-sync-held.followupHeld": "Open the sync report to see which ones and why, then fix them so they come in on the next sync.",
  "airtable-sync-held.followupHeldSingle": "Open the sync report to see why, then fix it so it comes in on the next sync.",
  "airtable-sync-held.followupHeldKnownReason": "Open the sync report to see which ones, then fix them so they come in on the next sync.",
  "airtable-sync-held.followupHeldSingleKnownReason": "Fix it in the sync report so it comes in on the next sync.",
  // Scoped to Airtable itself, not to staffing: an admin or producer can still create
  // and staff a show date manually in-app while a sync is stalled ("no offers can go
  // out" and "no new dates can be staffed" are both false claims for that reason).
  // "Nothing from Airtable will reach ShowFlow" stays true in every reachable org state.
  "airtable-sync-held.introZeroImport": "The Airtable sync in {{orgName}} ran but brought in zero dates this time, even though there is data waiting. Nothing from Airtable will reach ShowFlow until this is fixed.",
  "airtable-sync-held.followupZeroImport": "Open the sync report to see what happened on this run, then fix it so your dates start coming in again.",
  "airtable-sync-held.ctaLabel": "Review the sync report",
  "airtable-sync-held.footer": "The ShowFlow team",
  "airtable-sync-held.previewTextHeld": "{{heldCount}} Airtable {{heldRecord}} waiting on you in {{orgName}}.",
  // Two overclaims a previous draft made here, both false in every reachable state:
  // "Here's why" promised a reason the body deliberately withholds (see introZeroImport's
  // own comment on why the cause can't be asserted); "Today's" implied a daily cadence,
  // but airtable-poll runs every airtable_poll_interval_minutes (5-min floor), at any
  // hour, not once a day. The inbox snippet must not claim more than the body does.
  "airtable-sync-held.previewTextZeroImport": "The Airtable sync in {{orgName}} brought in nothing this time.",
  "airtable-sync-held.orgFallback": "your organization",
} as const;

export type EmailCopyKey = keyof typeof EMAIL_COPY_DEFAULTS;
export type EmailCopy = Record<EmailCopyKey, string>;
export type EmailCopyOverride = Partial<Record<EmailCopyKey, unknown>>;

/** The languages server-rendered emails ship in. Mirrors ServerLocale in
 *  src/lib/i18n/orgLanguage.ts (kept separate so this file stays import-free for
 *  the edge mirror). `EMAIL_COPY_DE` below is the complete German base map. */
export type EmailLocale = "en" | "de";

/** Complete German base map for server-rendered emails. Same keys as
 *  EMAIL_COPY_DEFAULTS (enforced by emailCopy.test.ts key/placeholder/Du/dash
 *  gates); selected by resolveEmailCopy(override, "de"). Informal Du, no dashes,
 *  TERMS glossary (Engagementvertrag etc). Mirrored to the edge with this file. */
export const EMAIL_COPY_DE: EmailCopy = {
  "offer-immediate.subject": "Kannst Du {{referenceLabel}} übernehmen? · {{date}}",
  "offer-immediate.heading": "Kannst Du das übernehmen?",
  "offer-immediate.greeting": "Hallo {{displayName}},",
  "offer-immediate.greetingAnonymous": "Hallo,",
  "offer-immediate.intro": "Du wurdest zu {{referenceLabel}} am {{where}} gefragt. Sag ja, und der Termin ist für Dich reserviert. Sag nein, und das wird Dir nicht angerechnet und wirkt sich auf keinen anderen Termin aus. Antworte innerhalb von {{hours}} Stunden.",
  "offer-immediate.ctaLabel": "Jetzt antworten",
  "offer-immediate.footer": "Fragen? Wende Dich an Deine Ansprechperson, sie hilft Dir gerne weiter.",
  "offer-immediate.previewText": "Kannst Du {{referenceLabel}} auf ShowFlow übernehmen?",
  "offer-immediate.showLabel": "Produktion",
  "offer-immediate.dateLabel": "Datum",
  "offer-immediate.showFallback": "eine Produktion",

  "artist-offer-digest.subject": "{{count}} {{pendingOffer}} auf ShowFlow",
  "artist-offer-digest.heading": "{{count}} {{pendingOffer}} auf ShowFlow",
  "artist-offer-digest.greeting": "Hallo {{displayName}},",
  "artist-offer-digest.greetingAnonymous": "Hallo,",
  "artist-offer-digest.intro": "Du hast {{count}} {{pendingOffer}}. Sag ja, und der Termin ist für Dich reserviert. Sag nein, und das wird Dir nicht angerechnet und wirkt sich auf keinen anderen Termin aus.",
  "artist-offer-digest.ctaLabel": "Diese beantworten",
  "artist-offer-digest.footer": "Fragen? Wende Dich an Deine Ansprechperson, sie hilft Dir gerne weiter.",
  "artist-offer-digest.previewText": "Du hast {{count}} {{pendingOffer}} zu beantworten.",
  "artist-offer-digest.pendingOfferSingular": "Termin zum Beantworten",
  "artist-offer-digest.pendingOfferPlural": "Termine zum Beantworten",
  "artist-offer-digest.showLabel": "Produktion",
  "artist-offer-digest.dateLabel": "Datum",
  "artist-offer-digest.cityLabel": "Stadt",
  "artist-offer-digest.expiresLabel": "Antworte bis",

  "offer-expiry-reminder.subjectSingular": "Erinnerung: Antworte bis morgen",
  "offer-expiry-reminder.subjectPlural": "Erinnerung: {{count}} Anfragen brauchen bis morgen eine Antwort",
  "offer-expiry-reminder.headingSingular": "Dieser Termin braucht bald eine Antwort",
  "offer-expiry-reminder.headingPlural": "{{count}} Termine brauchen bald eine Antwort",
  "offer-expiry-reminder.greeting": "Hallo {{displayName}},",
  "offer-expiry-reminder.greetingAnonymous": "Hallo,",
  "offer-expiry-reminder.introSingular": "Eine Deiner Anfragen braucht innerhalb der nächsten 24 Stunden eine Antwort. Antworte bald, um Dir den Termin zu sichern.",
  "offer-expiry-reminder.introPlural": "{{count}} Deiner Anfragen brauchen innerhalb der nächsten 24 Stunden eine Antwort. Antworte bald, um Dir die Termine zu sichern.",
  "offer-expiry-reminder.ctaLabelSingular": "Jetzt antworten",
  "offer-expiry-reminder.ctaLabelPlural": "Jetzt antworten",
  "offer-expiry-reminder.footer": "Fragen? Wende Dich an Deine Ansprechperson, sie hilft Dir gerne weiter.",
  "offer-expiry-reminder.previewSingular": "Erinnerung: Antworte bis morgen auf ShowFlow",
  "offer-expiry-reminder.previewPlural": "Erinnerung: {{count}} Anfragen brauchen bis morgen eine Antwort auf ShowFlow",
  "offer-expiry-reminder.offerLine": "{{referenceLabel}} am {{date}}: antworte bis {{expiresAt}}",

  "artist-confirmation-digest.subjectUpdates": "Neuigkeiten zu Deinen Terminen auf ShowFlow",
  "artist-confirmation-digest.subjectConfirmed": "Du bist gebucht auf ShowFlow",
  "artist-confirmation-digest.headingUpdates": "Was sich geändert hat",
  "artist-confirmation-digest.headingConfirmed": "Du bist gebucht",
  "artist-confirmation-digest.greeting": "Hallo {{displayName}},",
  "artist-confirmation-digest.greetingAnonymous": "Hallo,",
  "artist-confirmation-digest.introUpdates": "Hier ist, was sich bei Deinen Terminen geändert hat.",
  "artist-confirmation-digest.introConfirmed": "Hier ist, was gerade gebucht wurde. Wir freuen uns, Dich auf der Bühne zu haben!",
  "artist-confirmation-digest.ctaLabel": "Deine Termine ansehen",
  "artist-confirmation-digest.footer": "Fragen? Wende Dich an Deine Ansprechperson, sie hilft Dir gerne weiter.",
  "artist-confirmation-digest.cancelledHeading": "Storniert",
  "artist-confirmation-digest.scheduleChangesHeading": "Terminänderungen",
  "artist-confirmation-digest.confirmedHeading": "Gebucht",
  "artist-confirmation-digest.showLabel": "Produktion",
  "artist-confirmation-digest.dateLabel": "Datum",
  "artist-confirmation-digest.cityLabel": "Stadt",
  "artist-confirmation-digest.reasonLabel": "Grund",
  "artist-confirmation-digest.changeLabel": "Änderung",
  "artist-confirmation-digest.reasonFallback": "Nicht angegeben",
  "artist-confirmation-digest.emptyState": "Noch nichts gebucht.",

  "cast-escalation-requested.subject": "Stufe {{tier}} für {{program}} am {{date}} ist abgelaufen",
  "cast-escalation-requested.heading": "Dieser Termin braucht eine Entscheidung",
  "cast-escalation-requested.intro": "Stufe {{tier}} für {{program}} am {{date}} ist abgelaufen, nur {{accepted}} von {{required}} Positionen sind besetzt.",
  "cast-escalation-requested.followup": "Öffne die nächste Stufe, um weiter zu fragen, oder buche direkt.",
  "cast-escalation-requested.ctaLabel": "Diesen Termin öffnen",
  "cast-escalation-requested.footer": "Fragen? Wende Dich an Deine Ansprechperson, sie hilft Dir gerne weiter.",
  "cast-escalation-requested.previewText": "Stufe {{tier}} für {{program}} am {{date}} ist abgelaufen",
  "cast-escalation-requested.showLabel": "Produktion",
  "cast-escalation-requested.dateLabel": "Datum",
  "cast-escalation-requested.tierLabel": "Stufe",
  "cast-escalation-requested.filledLabel": "Besetzt",
  "cast-escalation-requested.slotsLabel": "Positionen",
  "cast-escalation-requested.showFallback": "eine Produktion",
  "cast-escalation-requested.dateFallback": "noch offen",

  "tier-at-risk.subject": "{{program}} am {{date}} ist gefährdet",
  "tier-at-risk.heading": "Dieser Termin ist gefährdet",
  "tier-at-risk.body": "Stufe {{tier}} für {{program}} am {{date}} kann mit den aktuellen Anfragen nicht gefüllt werden. {{pending}} warten noch auf Antwort, {{accepted}} haben ja gesagt und {{required}} Positionen werden gebraucht. Öffne die nächste Stufe oder buche direkt aus der Liste der Anfragbaren.",
  "tier-at-risk.ctaLabel": "Diesen Termin ansehen",
  "tier-at-risk.footer": "Fragen? Wende Dich an Deine Ansprechperson, sie hilft Dir gerne weiter.",
  "tier-at-risk.previewText": "{{program}} am {{date}} ist gefährdet",
  "tier-at-risk.showFallback": "eine Produktion",
  "tier-at-risk.dateFallback": "noch offen",

  "hire-order-issued.subject": "Dein Engagementvertrag für {{dateLabel}} im {{venue}}",
  "hire-order-issued.heading": "Dein Engagementvertrag ist bereit",
  "hire-order-issued.greeting": "Hallo {{artistName}},",
  "hire-order-issued.intro": "Dein Engagementvertrag für {{dateLabel}} im {{venue}} ist bereit. Sieh Dir die Details unten an und lade Deine Kopie herunter.",
  "hire-order-issued.ctaLabel": "Ansehen und herunterladen",
  "hire-order-issued.signCtaLabel": "Vertrag prüfen",
  "hire-order-issued.footer": "Fragen? Wende Dich an Deine Ansprechperson, sie hilft Dir gerne weiter.",
  "hire-order-issued.previewText": "Dein Engagementvertrag für {{dateLabel}} im {{venue}}",
  "hire-order-issued.orderLabel": "Vertrag.",
  "hire-order-issued.engagementDatesLabel": "Engagementtermine.",
  "hire-order-issued.venueLabel": "Veranstaltungsort.",
  "hire-order-issued.cityLabel": "Stadt.",
  "hire-order-issued.feeLabel": "Gage.",
  "hire-order-issued.signPrompt": "Prüfe und unterschreibe Deinen Engagementvertrag online, um ihn zu bestätigen.",
  "hire-order-issued.signButton": "Prüfen und unterschreiben",
  "hire-order-issued.pasteLink": "Oder füge diesen Link in Deinen Browser ein:",
  "hire-order-issued.manualPrompt": "Antworte, um zu bestätigen, oder unterschreibe das angehängte PDF und sende es zurück.",
  "hire-order-issued.artistFallback": "Du",
  "hire-order-issued.dateFallback": "Deinen Termin",
  "hire-order-issued.venueFallback": "Veranstaltungsort",

  "hire-order-countersigned.subject": "Dein Engagementvertrag für {{dateLabel}} ist unterschrieben",
  "hire-order-countersigned.heading": "Dein Engagementvertrag ist unterschrieben",
  "hire-order-countersigned.greeting": "Hallo {{artistName}},",
  "hire-order-countersigned.intro": "Dein Engagementvertrag für {{dateLabel}} im {{venue}} ist vollständig unterschrieben. Eine Kopie ist zu Deinen Unterlagen beigefügt.",
  "hire-order-countersigned.ctaLabel": "Unterschriebenen Vertrag ansehen",
  "hire-order-countersigned.footer": "Fragen? Wende Dich an Deine Ansprechperson, sie hilft Dir gerne weiter.",
  "hire-order-countersigned.previewText": "Dein Engagementvertrag für {{dateLabel}} ist unterschrieben",
  "hire-order-countersigned.orderLabel": "Vertrag.",
  "hire-order-countersigned.dateLabel": "Datum.",
  "hire-order-countersigned.venueLabel": "Veranstaltungsort.",
  "hire-order-countersigned.artistFallback": "Du",
  "hire-order-countersigned.dateFallback": "Deinen Termin",
  "hire-order-countersigned.venueFallback": "Veranstaltungsort",

  "org-invitation.subject": "Du bist eingeladen, {{orgName}} auf ShowFlow beizutreten",
  "org-invitation.heading": "{{orgName}} beitreten",
  "org-invitation.greeting": "Hallo,",
  "org-invitation.productIntro": "ShowFlow ist die Plattform, auf der {{orgName}} seine Produktionen plant und die Artists dafür bucht.",
  "org-invitation.roleIntro": "Deine Rolle ist {{role}}.",
  "org-invitation.roleIntroAdmin": "Du hast die volle Kontrolle über diesen Workspace, einschließlich Personen, Besetzungen, Einstellungen und jeder Buchung.",
  "org-invitation.roleIntroProducer": "Du planst Produktionen und Show-Termine und buchst Artists dafür.",
  "org-invitation.roleIntroArtist": "Du stehst auf der Liste. Du wirst für Produktionen gebucht und siehst jedes bestätigte Engagement.",
  "org-invitation.roleIntroArtistOffers": "Du stehst auf der Liste. Du bekommst Buchungsangebote per E-Mail, nimmst sie mit einem Klick an oder lehnst sie ab und siehst danach jedes bestätigte Engagement.",
  "org-invitation.ctaLabel": "Einladung annehmen",
  "org-invitation.ctaHintNewUser": "Fahre sicher fort, um Dich anzumelden oder Dein Konto zu erstellen.",
  "org-invitation.ctaHintExistingUser": "Fahre sicher fort, um Dich anzumelden oder Dein Konto zu erstellen.",
  "org-invitation.ctaHintFallback": "Fahre sicher fort, um Dich anzumelden oder Dein Konto zu erstellen.",
  "org-invitation.expiryLine": "Deine Einladung ist gültig bis mindestens {{expiresOn}}. Eine neuere Einladungs-E-Mail kann dieses Datum verlängern.",
  "org-invitation.expiryFallback": "Falls der Anmeldebutton nicht funktioniert, bitte darum, dass die Einladung erneut gesendet wird.",
  "org-invitation.footer": "Falls Du diese Einladung nicht erwartet hast, kannst Du diese E-Mail einfach ignorieren.",
  "org-invitation.previewText": "Du bist eingeladen, {{orgName}} auf ShowFlow beizutreten",
  "org-invitation.invitedBy": "Eingeladen von {{inviter}}.",
  "org-invitation.inviterFallback": "dem ShowFlow-Team",
  "org-invitation.pasteLink": "Oder füge diesen Link in Deinen Browser ein:",
  "org-invitation.linkRecovery": "Falls nichts davon funktioniert, bitte diejenige Person, die Dich eingeladen hat, eine neue Einladung zu senden.",
  "org-invitation.orgFallback": "eine Organisation",

  "account-email-changed.subject": "Deine ShowFlow-Anmelde-E-Mail wurde geändert",
  "account-email-changed.heading": "Deine Anmelde-E-Mail wurde geändert",
  "account-email-changed.greeting": "Hallo,",
  "account-email-changed.intro": "Die Anmelde-E-Mail für Dein ShowFlow-Konto wurde von einer Administratorin oder einem Administrator geändert.",
  "account-email-changed.footer": "Falls Du diese Änderung nicht erwartet hast, kontaktiere sofort Deine Administratorin oder Deinen Administrator.",
  "account-email-changed.previewText": "Deine ShowFlow-Anmelde-E-Mail wurde geändert",
  "account-email-changed.previousEmailLabel": "Bisherige E-Mail",
  "account-email-changed.newEmailLabel": "Neue E-Mail",
  "account-email-changed.signInPrompt": "Melde Dich unter {{signInUrl}} mit Deiner neuen E-Mail-Adresse an.",
  "account-email-changed.emailFallback": "unbekannt",

  "magic-link.subject": "Dein Anmeldelink für ShowFlow",
  "magic-link.heading": "Bei ShowFlow anmelden",
  "magic-link.greeting": "Hallo,",
  "magic-link.intro": "Nutze den Button unten, um Dich anzumelden. Dieser Link funktioniert nur einmal und läuft in Kürze ab. Falls Du ihn nicht angefordert hast, kannst Du diese E-Mail ignorieren.",
  "magic-link.ctaLabel": "Anmelden",
  "magic-link.footer": "Zu Deiner Sicherheit kann dieser Link nur einmal verwendet werden.",
  "magic-link.previewText": "Dein einmaliger Anmeldelink für ShowFlow",
  "magic-link.pasteLink": "Oder füge diesen Link in Deinen Browser ein:",

  "cron-health-alert.subject": "Cron-Status: {{jobName}} schlägt fehl ({{statusCode}})",
  "cron-health-alert.heading": "Geplanter Job schlägt fehl",
  "cron-health-alert.intro": "Der geplante Job {{jobName}} hat zuletzt {{statusCode}} zurückgegeben. Ein Teil der Booking Engine könnte beeinträchtigt sein, bis das behoben ist.",
  "cron-health-alert.ctaLabel": "System Health öffnen",
  "cron-health-alert.footer": "Das ShowFlow-Team",
  "cron-health-alert.previewText": "Cron-Alarm: {{jobName}} schlägt fehl",
  "cron-health-alert.jobLabel": "Job",
  "cron-health-alert.lastStatusLabel": "Letzter Status",
  "cron-health-alert.lastErrorLabel": "Letzter Fehler",
  "cron-health-alert.lastHealthyLabel": "Zuletzt fehlerfrei",
  "cron-health-alert.jobFallback": "ein geplanter Job",
  "cron-health-alert.valueFallback": "unbekannt",

  "airtable-sync-held.subject": "Airtable-Sync braucht Aufmerksamkeit in {{orgName}}",
  "airtable-sync-held.heading": "Airtable-Sync braucht Aufmerksamkeit",
  "airtable-sync-held.heldRecordSingular": "Eintrag",
  "airtable-sync-held.heldRecordPlural": "Einträge",
  "airtable-sync-held.introHeld": "{{heldCount}} Airtable-{{heldRecord}} in {{orgName}} konnten nicht in ShowFlow übernommen werden.",
  "airtable-sync-held.topReasonLine": "{{topReasonCount}} von {{heldCount}} sind {{topReasonLabel}}.",
  "airtable-sync-held.topReasonLineOne": "{{topReasonCount}} von {{heldCount}} ist {{topReasonLabel}}.",
  "airtable-sync-held.topReasonLineSingle": "Er ist {{topReasonLabel}}.",
  "airtable-sync-held.topReasonLineAll": "Alle {{heldCount}} sind {{topReasonLabel}}.",
  "airtable-sync-held.topReasonMissingDate": "ohne Datum",
  "airtable-sync-held.topReasonUnlinkedProgram": "nicht mit einer Deiner Produktionen verknüpft",
  "airtable-sync-held.topReasonUnlinkedCity": "einer Stadt zugeordnet, die nicht verknüpft ist",
  "airtable-sync-held.followupHeld": "Öffne den Sync-Bericht, um zu sehen, welche und warum, und behebe sie, damit sie beim nächsten Sync übernommen werden.",
  "airtable-sync-held.followupHeldSingle": "Öffne den Sync-Bericht, um zu sehen, warum, und behebe es, damit es beim nächsten Sync übernommen wird.",
  "airtable-sync-held.followupHeldKnownReason": "Öffne den Sync-Bericht, um zu sehen, welche, und behebe sie, damit sie beim nächsten Sync übernommen werden.",
  "airtable-sync-held.followupHeldSingleKnownReason": "Behebe es im Sync-Bericht, damit es beim nächsten Sync übernommen wird.",
  "airtable-sync-held.introZeroImport": "Der Airtable-Sync in {{orgName}} lief, hat aber diesmal keine Termine übernommen, obwohl Daten bereitstehen. Aus Airtable gelangt nichts zu ShowFlow, bis das behoben ist.",
  "airtable-sync-held.followupZeroImport": "Öffne den Sync-Bericht, um zu sehen, was bei diesem Lauf passiert ist, und behebe es, damit Deine Termine wieder ankommen.",
  "airtable-sync-held.ctaLabel": "Sync-Bericht ansehen",
  "airtable-sync-held.footer": "Das ShowFlow-Team",
  "airtable-sync-held.previewTextHeld": "{{heldCount}} Airtable-{{heldRecord}} warten auf Dich in {{orgName}}.",
  "airtable-sync-held.previewTextZeroImport": "Der Airtable-Sync in {{orgName}} hat diesmal nichts übernommen.",
  "airtable-sync-held.orgFallback": "Deine Organisation",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOverride(value: unknown): EmailCopyOverride {
  if (typeof value === "string") {
    try {
      return parseOverride(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value as EmailCopyOverride : {};
}

function isCopyKey(value: string): value is EmailCopyKey {
  return Object.prototype.hasOwnProperty.call(EMAIL_COPY_DEFAULTS, value);
}

/**
 * Retired copy keys carried forward onto their closest surviving replacement, so an org
 * that customized one before it was retired keeps SOME visible effect of that
 * customization instead of silently reverting to the stock default. `org-invitation.intro`
 * (the pre-WP1 combined product+role sentence) is the only one with a clean positional
 * match: both it and `productIntro` are the email's opening explanatory sentence.
 * `org-invitation.roleSuffix` (a " as {{role}}" fragment appended to the old intro) has no
 * equivalent slot in the new three-line role structure (roleIntro / roleIntroAdmin /
 * roleIntroProducer / roleIntroArtist) and is intentionally NOT carried forward: the
 * fragment doesn't compose into any of the new strings without reading as a
 * grammar error, so an org that customized only roleSuffix already lost that
 * customization's visible effect the moment role became its own dedicated set of strings.
 */
const LEGACY_KEY_CARRY_FORWARD: Record<string, EmailCopyKey> = {
  "org-invitation.intro": "org-invitation.productIntro",
};

/** Whether a raw override value counts as explicitly set, for override-precedence
 *  purposes: a non-blank string. A key present but all-whitespace must be treated the
 *  same as a key that is absent everywhere this matters (an explicit new-key override
 *  wins over a legacy carry-forward value, but only a MEANINGFUL one). */
function hasExplicitValue(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Fold any LEGACY_KEY_CARRY_FORWARD source values onto their current-key equivalent
 *  in a plain object, when the RAW input has no explicit (non-blank) value of its own
 *  under the current key. Shared by resolveEmailCopy (folds onto a fresh
 *  defaults-plus-overrides record, for rendering a send) and compactEmailCopy (folds
 *  onto the raw draft before filtering, for persisting from the settings editor), so a
 *  customization saved under a retired key is honored identically by both: a send must
 *  never silently revert to stock copy, and the editor must never silently drop the
 *  customization the moment it loads the draft (compactEmailCopy alone used to filter
 *  out any key not in EMAIL_COPY_DEFAULTS, which includes every retired legacy key). */
function withLegacyCarryForward<T extends Record<string, unknown>>(raw: Record<string, unknown>, target: T): T {
  for (const [legacyKey, newKey] of Object.entries(LEGACY_KEY_CARRY_FORWARD)) {
    const legacyValue = raw[legacyKey];
    if (hasExplicitValue(legacyValue) && !hasExplicitValue(raw[newKey])) {
      (target as Record<string, unknown>)[newKey] = legacyValue;
    }
  }
  return target;
}

/** Plain {{name}} substitution from a resolved vocabulary table. A local, import-free
 *  copy of interpolateVocabulary (src/lib/orgKind.ts): this file is a whole-file mirror
 *  that must import nothing (the edge twin resolves ../orgKind at a different relative
 *  depth than this source's ../orgKind, so no single import path works on both sides).
 *  Unknown tokens (runtime variables like {{orgName}}, {{count}}, {{date}}) are left
 *  verbatim. */
function substituteVocabulary(text: string, vocab: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vocab, name) ? vocab[name] : whole,
  );
}

/** Production vocabulary fallback, used when resolveEmailCopy is called WITHOUT an
 *  explicit vocab table (the caller threads the org's workspace-type table in; until it
 *  does, and for every plain call, this stands in). Its words MUST equal
 *  VOCABULARY.production in src/lib/orgKind.ts, which is exactly what keeps a plain
 *  resolveEmailCopy(...) byte-identical to the pre-variable prose. Import-free by the
 *  mirror rule above. */
export const PRODUCTION_VOCAB: Record<EmailLocale, Record<string, string>> = {
  en: {
    show: "show", shows: "shows", Show: "Show", Shows: "Shows",
    showDate: "date", showDates: "dates", ShowDate: "Date", ShowDates: "Dates",
    artist: "artist", artists: "artists", Artist: "Artist", Artists: "Artists",
    production: "production", productions: "productions", Production: "Production", Productions: "Productions",
    cast: "cast", casts: "casts", Cast: "Cast", Casts: "Casts",
    understudy: "understudy", understudies: "understudies", Understudy: "Understudy", Understudies: "Understudies",
    skill: "skill", skills: "skills", Skill: "Skill", Skills: "Skills",
    hireOrder: "contract", hireOrders: "contracts", HireOrder: "Contract", HireOrders: "Contracts",
    roleProducer: "Production Team", kind: "production",
  },
  de: {
    show: "Show", shows: "Shows", Show: "Show", Shows: "Shows",
    showDate: "Termin", showDates: "Termine", ShowDate: "Termin", ShowDates: "Termine",
    artist: "Artist", artists: "Artists", Artist: "Artist", Artists: "Artists",
    production: "Produktion", productions: "Produktionen", Production: "Produktion", Productions: "Produktionen",
    cast: "Besetzung", casts: "Besetzungen", Cast: "Besetzung", Casts: "Besetzungen",
    understudy: "Zweitbesetzung", understudies: "Zweitbesetzungen", Understudy: "Zweitbesetzung", Understudies: "Zweitbesetzungen",
    skill: "Skill", skills: "Skills", Skill: "Skill", Skills: "Skills",
    hireOrder: "Engagementvertrag", hireOrders: "Engagementverträge", HireOrder: "Engagementvertrag", HireOrders: "Engagementverträge",
    roleProducer: "Production Team", kind: "production",
  },
};

/**
 * Vocabulary templates: the copy keys that name a domain noun, authored with {{noun}}
 * variables. resolveEmailCopy substitutes these against the resolved workspace-type
 * table (staffing swaps the words) for any key still at its language default. Kept
 * SEPARATE from EMAIL_COPY_DEFAULTS / EMAIL_COPY_DE, which stay clean prose, because
 * every template component and subject function reads those default maps RAW (their
 * `_emailCopy = EMAIL_COPY_DEFAULTS` fallback and `template.subject`), so a bare
 * {{noun}} token in the defaults would leak into any direct or default render. Under the
 * production table every value here substitutes back to the exact clean default, which
 * is the byte-identity guarantee (guarded by emailCopy.orgKind.test.ts). Keys are a
 * subset of EmailCopyKey. Most keys exist in both locales, but a few are EN-only: where
 * the German literal does not equal the registry's German production word (the hire-order
 * short form "Vertrag" vs the registry "Engagementvertrag") or needs article agreement a
 * bare variable cannot give ("eine Produktion" vs staffing "Kunde"), tokenizing German
 * would break DE byte-identity, so the German key stays a clean-prose default until that
 * wording is reconciled. English is the canonical, always-on locale (German ships behind
 * the language_packages entitlement), so EN staffing still gets the swapped word.
 */
const EMAIL_COPY_VOCAB_TEMPLATES: Record<EmailLocale, Partial<Record<EmailCopyKey, string>>> = {
  en: {
    "offer-immediate.intro": "You have been asked about {{referenceLabel}} on {{where}}. Say yes and the {{showDate}} is held for you. Say no and it will not count against you, and it does not affect any other {{showDate}}. Answer within {{hours}} hours.",
    "artist-offer-digest.intro": "You have {{count}} {{pendingOffer}}. Say yes and the {{showDate}} is held for you. Say no and it will not count against you, and it does not affect any other {{showDate}}.",
    "offer-expiry-reminder.introSingular": "One of your asks needs an answer within the next 24 hours. Answer soon to keep the {{showDate}}.",
    "offer-expiry-reminder.introPlural": "{{count}} of your asks need an answer within the next 24 hours. Answer soon to keep the {{showDates}}.",
    "hire-order-issued.subject": "Your {{hireOrder}} for {{dateLabel}} at {{venue}}",
    "hire-order-issued.heading": "Your {{hireOrder}} is ready",
    "hire-order-issued.intro": "Your {{hireOrder}} for {{dateLabel}} at {{venue}} is ready. Review the details below and download your copy.",
    "hire-order-issued.previewText": "Your {{hireOrder}} for {{dateLabel}} at {{venue}}",
    "hire-order-issued.signPrompt": "Review and sign your {{hireOrder}} online to confirm.",
    "hire-order-countersigned.subject": "Your {{hireOrder}} for {{dateLabel}} is signed",
    "hire-order-countersigned.heading": "Your {{hireOrder}} is signed",
    "hire-order-countersigned.intro": "Your {{hireOrder}} for {{dateLabel}} at {{venue}} is fully signed. A copy is attached for your records.",
    "hire-order-countersigned.previewText": "Your {{hireOrder}} for {{dateLabel}} is signed",
    "org-invitation.productIntro": "ShowFlow is where {{orgName}} plans its {{productions}} and books the {{artists}} for them.",
    "org-invitation.roleIntroAdmin": "You get full control of this workspace, including people, {{casts}}, settings, and every booking.",
    "org-invitation.roleIntroProducer": "You plan {{productions}} and show dates, and book {{artists}} into them.",
    "org-invitation.roleIntroArtist": "You are on the roster. You get booked for {{productions}} and can see every confirmed engagement.",
    "airtable-sync-held.topReasonUnlinkedProgram": "not linked to one of your {{productions}}",
    // The show/production field label in booking emails. {{Production}} is production
    // ("Production", byte-identical) and staffing ("Client"). No article, safe both langs.
    "offer-immediate.showLabel": "{{Production}}",
    "artist-offer-digest.showLabel": "{{Production}}",
    "artist-confirmation-digest.showLabel": "{{Production}}",
    "cast-escalation-requested.showLabel": "{{Production}}",
    // EN-only (see the map's doc comment). {{production}} feeds the subject line via
    // SUBJECT_RESOLVERS; production "a production" is byte-identical, staffing "a client".
    "offer-immediate.showFallback": "a {{production}}",
    "cast-escalation-requested.showFallback": "a {{production}}",
    "tier-at-risk.showFallback": "a {{production}}",
    // EN-only. {{HireOrder}}="Contract" (prod) / "Work order" (staffing); the DE literal
    // "Vertrag" differs from the registry "Engagementvertrag", so DE stays a clean default.
    "hire-order-issued.orderLabel": "{{HireOrder}}.",
    "hire-order-countersigned.orderLabel": "{{HireOrder}}.",
    "hire-order-issued.signCtaLabel": "Review {{hireOrder}}",
    "hire-order-countersigned.ctaLabel": "View signed {{hireOrder}}",
  },
  de: {
    "offer-immediate.intro": "Du wurdest zu {{referenceLabel}} am {{where}} gefragt. Sag ja, und der {{showDate}} ist für Dich reserviert. Sag nein, und das wird Dir nicht angerechnet und wirkt sich auf keinen anderen {{showDate}} aus. Antworte innerhalb von {{hours}} Stunden.",
    "artist-offer-digest.intro": "Du hast {{count}} {{pendingOffer}}. Sag ja, und der {{showDate}} ist für Dich reserviert. Sag nein, und das wird Dir nicht angerechnet und wirkt sich auf keinen anderen {{showDate}} aus.",
    "offer-expiry-reminder.introSingular": "Eine Deiner Anfragen braucht innerhalb der nächsten 24 Stunden eine Antwort. Antworte bald, um Dir den {{showDate}} zu sichern.",
    "offer-expiry-reminder.introPlural": "{{count}} Deiner Anfragen brauchen innerhalb der nächsten 24 Stunden eine Antwort. Antworte bald, um Dir die {{showDates}} zu sichern.",
    "hire-order-issued.subject": "Dein {{hireOrder}} für {{dateLabel}} im {{venue}}",
    "hire-order-issued.heading": "Dein {{hireOrder}} ist bereit",
    "hire-order-issued.intro": "Dein {{hireOrder}} für {{dateLabel}} im {{venue}} ist bereit. Sieh Dir die Details unten an und lade Deine Kopie herunter.",
    "hire-order-issued.previewText": "Dein {{hireOrder}} für {{dateLabel}} im {{venue}}",
    "hire-order-issued.signPrompt": "Prüfe und unterschreibe Deinen {{hireOrder}} online, um ihn zu bestätigen.",
    "hire-order-countersigned.subject": "Dein {{hireOrder}} für {{dateLabel}} ist unterschrieben",
    "hire-order-countersigned.heading": "Dein {{hireOrder}} ist unterschrieben",
    "hire-order-countersigned.intro": "Dein {{hireOrder}} für {{dateLabel}} im {{venue}} ist vollständig unterschrieben. Eine Kopie ist zu Deinen Unterlagen beigefügt.",
    "hire-order-countersigned.previewText": "Dein {{hireOrder}} für {{dateLabel}} ist unterschrieben",
    "org-invitation.productIntro": "ShowFlow ist die Plattform, auf der {{orgName}} seine {{productions}} plant und die {{artists}} dafür bucht.",
    "org-invitation.roleIntroAdmin": "Du hast die volle Kontrolle über diesen Workspace, einschließlich Personen, {{casts}}, Einstellungen und jeder Buchung.",
    "org-invitation.roleIntroProducer": "Du planst {{productions}} und Show-Termine und buchst {{artists}} dafür.",
    "org-invitation.roleIntroArtist": "Du stehst auf der Liste. Du wirst für {{productions}} gebucht und siehst jedes bestätigte Engagement.",
    "airtable-sync-held.topReasonUnlinkedProgram": "nicht mit einer Deiner {{productions}} verknüpft",
    // Show/production field label. {{Production}} is production ("Produktion",
    // byte-identical) and staffing ("Kunde"). No article, safe both langs.
    "offer-immediate.showLabel": "{{Production}}",
    "artist-offer-digest.showLabel": "{{Production}}",
    "artist-confirmation-digest.showLabel": "{{Production}}",
    "cast-escalation-requested.showLabel": "{{Production}}",
  },
};

/** Merge valid, non-blank per-org copy over a fresh complete default record, then
 *  substitute {{noun}} vocabulary variables. An explicit (non-blank) override for the
 *  CURRENT key always wins over a carried-forward legacy one; a present-but-blank
 *  current-key value does not count as explicit, so the legacy value still carries
 *  forward in that case.
 *
 *  `vocab` is a RESOLVED vocabulary table (VOCABULARY[kind][locale] shape, typed
 *  structurally as Record<string, string> so this file imports nothing). When omitted it
 *  falls back to the production words for `locale`; since those equal the hardcoded
 *  nouns, a plain call (or a production table) is byte-identical to before {{noun}}
 *  variables existed. A staffing table swaps the words. A key still at its language
 *  default draws its noun from the vocabulary template above; a key an admin overrode (or
 *  that carried a legacy value forward) is substituted as authored, so a {{Show}} in a
 *  custom string still resolves. Runtime tokens ({{orgName}}, {{count}}, dates) are
 *  always left for applyEmailTokens. */
export function resolveEmailCopy(
  override?: EmailCopyOverride | string | null,
  locale: EmailLocale = "en",
  vocab?: Record<string, string>,
): EmailCopy {
  const input = parseOverride(override);
  const raw = input as Record<string, unknown>;
  // Select the language base; a sparse per-org override still layers on top of
  // whichever base was chosen.
  const base = locale === "de" ? EMAIL_COPY_DE : EMAIL_COPY_DEFAULTS;
  const resolved = withLegacyCarryForward(raw, { ...base } as EmailCopy);
  for (const key of Object.keys(EMAIL_COPY_DEFAULTS) as EmailCopyKey[]) {
    const value = input[key];
    if (hasExplicitValue(value)) resolved[key] = value;
  }
  const table = vocab ?? PRODUCTION_VOCAB[locale];
  const templates = EMAIL_COPY_VOCAB_TEMPLATES[locale];
  for (const key of Object.keys(resolved) as EmailCopyKey[]) {
    const source = resolved[key] === base[key] ? (templates[key] ?? resolved[key]) : resolved[key];
    resolved[key] = substituteVocabulary(source, table);
  }
  return resolved;
}

/** Persist only meaningful values that differ from the built-in default. Migrates any
 *  legacy-key value onto its current-key equivalent first (see withLegacyCarryForward),
 *  so a draft seeded straight from a stored override (EmailTemplateEditorPage does this
 *  on load, and again on every save) keeps a customization saved under a retired key
 *  instead of losing it the instant compaction runs. */
export function compactEmailCopy(draft?: EmailCopyOverride | null): Partial<Record<EmailCopyKey, string>> {
  if (!draft || !isRecord(draft)) return {};
  const raw = draft as Record<string, unknown>;
  const migrated = withLegacyCarryForward(raw, { ...raw });
  const compacted: Partial<Record<EmailCopyKey, string>> = {};
  for (const [key, value] of Object.entries(migrated)) {
    if (isCopyKey(key) && hasExplicitValue(value) && value !== EMAIL_COPY_DEFAULTS[key]) {
      compacted[key] = value;
    }
  }
  return compacted;
}

/** Translate the one-release legacy settings shape into the flattened registry.
 *  A single legacy field fans out to every matching copy variant, so templates
 *  whose copy is split into singular/plural or updates/confirmed keys (which have
 *  no flat `.subject`/`.intro`/`.ctaLabel`) still receive the override instead of
 *  silently dropping it. */
export function legacyEmailOverridesToCopy(value: unknown): Partial<Record<EmailCopyKey, string>> {
  if (!isRecord(value)) return {};
  const fields: Record<string, readonly string[]> = {
    subject: ["subject", "subjectSingular", "subjectPlural", "subjectUpdates", "subjectConfirmed"],
    intro: ["intro", "introSingular", "introPlural", "introUpdates", "introConfirmed"],
    cta_label: ["ctaLabel", "ctaLabelSingular", "ctaLabelPlural"],
    footer: ["footer"],
  };
  const converted: Partial<Record<EmailCopyKey, string>> = {};
  for (const [template, legacy] of Object.entries(value)) {
    if (!EMAIL_TEMPLATE_KEYS.includes(template as EmailTemplateKey) || !isRecord(legacy)) continue;
    for (const [legacyField, copyFields] of Object.entries(fields)) {
      const candidate = legacy[legacyField];
      if (typeof candidate !== "string" || candidate.trim() === "") continue;
      for (const copyField of copyFields) {
        const copyKey = `${template}.${copyField}`;
        if (isCopyKey(copyKey)) converted[copyKey] = candidate;
      }
    }
  }
  return converted;
}

/** Replace known {{token}} values while leaving accidental placeholders visible. */
export function applyEmailTokens(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  );
}
