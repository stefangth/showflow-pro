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
  "offer-immediate.subject": "Offer: {{referenceLabel}} · {{date}}",
  "offer-immediate.heading": "You have a new offer",
  "offer-immediate.greeting": "Hi {{displayName}},",
  "offer-immediate.greetingAnonymous": "Hi,",
  "offer-immediate.intro": "You have been offered {{referenceLabel}} on {{where}}. You have {{hours}} hours to respond before the offer expires.",
  "offer-immediate.ctaLabel": "Respond to this offer",
  "offer-immediate.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "offer-immediate.previewText": "New offer: {{referenceLabel}} on ShowFlow",
  "offer-immediate.showLabel": "Show",
  "offer-immediate.dateLabel": "Date",
  "offer-immediate.showFallback": "a show",

  "artist-offer-digest.subject": "You have {{count}} {{pendingOffer}} on ShowFlow",
  "artist-offer-digest.heading": "{{count}} {{pendingOffer}} on ShowFlow",
  "artist-offer-digest.greeting": "Hi {{displayName}},",
  "artist-offer-digest.greetingAnonymous": "Hi,",
  "artist-offer-digest.intro": "You have {{count}} {{pendingOffer}} waiting for your response. Please review and accept or decline before the deadlines below.",
  "artist-offer-digest.ctaLabel": "View your offers",
  "artist-offer-digest.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "artist-offer-digest.previewText": "You have {{count}} {{pendingOffer}} on ShowFlow",
  "artist-offer-digest.pendingOfferSingular": "pending offer",
  "artist-offer-digest.pendingOfferPlural": "pending offers",
  "artist-offer-digest.showLabel": "Show",
  "artist-offer-digest.dateLabel": "Date",
  "artist-offer-digest.cityLabel": "City",
  "artist-offer-digest.expiresLabel": "Expires",

  "offer-expiry-reminder.subjectSingular": "Reminder: your offer expires soon",
  "offer-expiry-reminder.subjectPlural": "Reminder: {{count}} offers expire soon",
  "offer-expiry-reminder.headingSingular": "Your offer expires soon",
  "offer-expiry-reminder.headingPlural": "{{count}} offers expire soon",
  "offer-expiry-reminder.greeting": "Hi {{displayName}},",
  "offer-expiry-reminder.greetingAnonymous": "Hi,",
  "offer-expiry-reminder.introSingular": "You have an offer expiring within the next 24 hours. Respond soon to keep the booking.",
  "offer-expiry-reminder.introPlural": "You have {{count}} offers expiring within the next 24 hours. Respond soon to keep the booking.",
  "offer-expiry-reminder.ctaLabelSingular": "Respond to this offer",
  "offer-expiry-reminder.ctaLabelPlural": "Respond to your offers",
  "offer-expiry-reminder.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "offer-expiry-reminder.previewSingular": "Reminder: your offer expires soon on ShowFlow",
  "offer-expiry-reminder.previewPlural": "Reminder: {{count}} offers expire soon on ShowFlow",
  "offer-expiry-reminder.offerLine": "{{referenceLabel}} on {{date}}: respond by {{expiresAt}}",

  "artist-confirmation-digest.subjectUpdates": "Your booking updates on ShowFlow",
  "artist-confirmation-digest.subjectConfirmed": "Your bookings are confirmed on ShowFlow",
  "artist-confirmation-digest.headingUpdates": "Your booking updates",
  "artist-confirmation-digest.headingConfirmed": "Your bookings are confirmed",
  "artist-confirmation-digest.greeting": "Hi {{displayName}},",
  "artist-confirmation-digest.greetingAnonymous": "Hi,",
  "artist-confirmation-digest.introUpdates": "Here's what changed on your bookings.",
  "artist-confirmation-digest.introConfirmed": "Here's what just got confirmed. We're excited to have you on stage!",
  "artist-confirmation-digest.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "artist-confirmation-digest.cancelledHeading": "Cancelled",
  "artist-confirmation-digest.scheduleChangesHeading": "Schedule changes",
  "artist-confirmation-digest.confirmedHeading": "Confirmed",
  "artist-confirmation-digest.showLabel": "Show",
  "artist-confirmation-digest.dateLabel": "Date",
  "artist-confirmation-digest.cityLabel": "City",
  "artist-confirmation-digest.reasonLabel": "Reason",
  "artist-confirmation-digest.changeLabel": "Change",
  "artist-confirmation-digest.reasonFallback": "Not specified",
  "artist-confirmation-digest.emptyState": "No confirmed bookings yet.",

  "cast-escalation-requested.subject": "Escalation needed: Tier {{tier}} for {{program}} on {{date}}",
  "cast-escalation-requested.heading": "Cast escalation needed",
  "cast-escalation-requested.intro": "Tier {{tier}} for {{program}} on {{date}} has expired with only {{accepted}}/{{required}} slots filled.",
  "cast-escalation-requested.followup": "Open the next priority tier to keep this date on track.",
  "cast-escalation-requested.ctaLabel": "Open bookings",
  "cast-escalation-requested.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "cast-escalation-requested.previewText": "Cast escalation needed: Tier {{tier}} for {{program}} on {{date}}",
  "cast-escalation-requested.showLabel": "Show",
  "cast-escalation-requested.dateLabel": "Date",
  "cast-escalation-requested.tierLabel": "Tier",
  "cast-escalation-requested.filledLabel": "Filled",
  "cast-escalation-requested.slotsLabel": "slots",
  "cast-escalation-requested.showFallback": "a show",
  "cast-escalation-requested.dateFallback": "TBD",

  "hire-order-issued.subject": "Your hire order for {{dateLabel}} at {{venue}}",
  "hire-order-issued.heading": "Hire order issued",
  "hire-order-issued.greeting": "Hi {{artistName}},",
  "hire-order-issued.intro": "Your hire order for {{dateLabel}} at {{venue}} has been issued. Review the details below and download your copy.",
  "hire-order-issued.ctaLabel": "View and download",
  "hire-order-issued.signCtaLabel": "Review document",
  "hire-order-issued.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "hire-order-issued.previewText": "Your hire order for {{dateLabel}} at {{venue}}",
  "hire-order-issued.orderLabel": "Order.",
  "hire-order-issued.engagementDatesLabel": "Engagement dates.",
  "hire-order-issued.venueLabel": "Venue.",
  "hire-order-issued.cityLabel": "City.",
  "hire-order-issued.feeLabel": "Fee.",
  "hire-order-issued.signPrompt": "Review and sign your hire order online to confirm.",
  "hire-order-issued.signButton": "Review and sign",
  "hire-order-issued.pasteLink": "Or paste this link into your browser:",
  "hire-order-issued.manualPrompt": "Reply to confirm, or sign and return the attached PDF.",
  "hire-order-issued.artistFallback": "there",
  "hire-order-issued.dateFallback": "your date",
  "hire-order-issued.venueFallback": "the venue",

  "hire-order-countersigned.subject": "Your hire order for {{dateLabel}} has been countersigned",
  "hire-order-countersigned.heading": "Hire order countersigned",
  "hire-order-countersigned.greeting": "Hi {{artistName}},",
  "hire-order-countersigned.intro": "Your hire order for {{dateLabel}} at {{venue}} has been countersigned. A copy of the signed document is attached for your records.",
  "hire-order-countersigned.ctaLabel": "View signed order",
  "hire-order-countersigned.footer": "Questions? Reach out to your point of contact and they'll be glad to help.",
  "hire-order-countersigned.previewText": "Your hire order for {{dateLabel}} has been countersigned",
  "hire-order-countersigned.orderLabel": "Order.",
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
  "org-invitation.productIntro": "ShowFlow is where {{orgName}} plans its shows and books the artists for them.",
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
  "org-invitation.roleIntroArtist": "You get booked for shows and see every confirmed engagement.",
  // Rendered instead of roleIntroArtist ONLY when resolveArtistOffersExpected
  // (_shared/invitations.ts) has confirmed the inviting org's booking_flow is entitled,
  // active, AND set to accept offers (booking_flow.artist_acceptance: true) for real:
  // the caller never assumes this from BOOKING_FLOW_DEFAULTS alone, since an unentitled
  // or still-paused org would otherwise get a promise that never comes true. For the
  // (majority of) orgs where this all checks out, it names the one thing the artist will
  // really do, respond to emailed offers, instead of staying silent on it the way the
  // flow-neutral line above has to.
  "org-invitation.roleIntroArtistOffers": "You will get emailed booking offers to accept or decline, and you can see every confirmed engagement.",
  "org-invitation.ctaLabel": "Accept invitation",
  // These used to end with "If it ever stops working, ask whoever invited you to send a
  // fresh one." That recovery clause now lives in linkRecovery (below), rendered beside
  // the paste-link fallback instead of here, so the sentence right before the button
  // stays a plain, undiluted reassurance about what clicking it does rather than a hedge
  // about it failing, planted right where the reader is about to click.
  "org-invitation.ctaHintNewUser": "The button opens ShowFlow and asks you to choose a password. That is all you need to get in.",
  "org-invitation.ctaHintExistingUser": "The button signs you in directly. No password needed from this email.",
  "org-invitation.ctaHintFallback": "The button takes you to a sign in page. Use your existing password, or choose Forgot password there if you do not have one yet.",
  // "is open", not "is held": "held" reads as "queued for delivery" rather than "the
  // window this invitation is valid for". Also drops {{orgName}} for the same
  // repetition reason as roleIntro above.
  //
  // Scoped to "This invitation", never to "the link in this email": the button's href
  // (and the paste-link fallback right below it, see org-invitation.tsx's acceptUrl) is
  // a short-lived Supabase action link (magiclink for an existing account, invite for a
  // net-new one, see ensureInvitedUser in _shared/invitations.ts) whose own TTL is
  // GoTrue's mailer OTP expiry, hours, not days, and is consumed on first use besides.
  // Saying "the link in this email works until {{expiresOn}}" would be false for most
  // of that window: the LINK typically stops working long before {{expiresOn}} arrives,
  // while the INVITATION (org_invitations.expires_at, the value accept_invitation
  // actually checks) stays valid the whole time regardless of that link's fate.
  // linkRecovery (below, beside the paste-link fallback) now covers what to do if the
  // button itself stops working, so this line only needs to state what stays true for
  // its full stated duration: the invitation itself. Membership is also created at
  // invite time (ensure_invitation_membership, see
  // create-invitation/resend-invitation/provision-org), so an invitee who authenticates
  // through any path is already an org member regardless of this date; what actually
  // stops working after expiresOn is only the accept_invitation flow this invitation
  // drives, never the invitee's org access.
  //
  // The dated claim is about the INVITATION: {{expiresOn}} is the row's exact expires_at
  // day (formatExpiresOn, no arithmetic). Everything the date cannot promise is owned by
  // the second sentence instead: the sign-in button is a single-use action link that dies
  // within hours, and near the window's end even the dated day is partly over. "Ask for
  // it to be resent" covers both, and resend-invitation refuses an already-lapsed row
  // (409 with revoke-and-reinvite guidance), so following the remedy can never produce a
  // claim falser than this line.
  "org-invitation.expiryLine": "Your invitation is valid until {{expiresOn}}. If the sign-in button stops working, ask for it to be resent.",
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
  // topReasonUnlinkedProgram are the only two categories syncOrg's held_unresolved
  // branches emit (see topHeldReason in airtable-poll/index.ts); an unrecognized reason
  // is excluded from the tally there, so this line simply does not render rather than
  // ever naming a reason it can't back up. Phrased as a clause ("are {{topReasonLabel}}"),
  // not a report label ("N of M: reason"), so it reads like the rest of the email.
  "airtable-sync-held.topReasonLine": "{{topReasonCount}} of the {{heldCount}} are {{topReasonLabel}}.",
  // Two redundant-fraction cases the plain N-of-M line above never should render:
  // a single held record (its one reason IS the whole story, so "1 of 1" is noise),
  // and a held set where every record shares the same reason ("N of N" always means
  // "all of them"). Both state the fact directly instead of a fraction that reduces
  // to "all".
  "airtable-sync-held.topReasonLineSingle": "It's {{topReasonLabel}}.",
  "airtable-sync-held.topReasonLineAll": "All {{heldCount}} are {{topReasonLabel}}.",
  "airtable-sync-held.topReasonMissingDate": "missing a date",
  "airtable-sync-held.topReasonUnlinkedProgram": "not linked to one of your shows",
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

/** Merge valid, non-blank per-org copy over a fresh complete default record. An explicit
 *  (non-blank) override for the CURRENT key always wins over a carried-forward legacy
 *  one; a present-but-blank current-key value does not count as explicit, so the legacy
 *  value still carries forward in that case. */
export function resolveEmailCopy(override?: EmailCopyOverride | string | null): EmailCopy {
  const input = parseOverride(override);
  const raw = input as Record<string, unknown>;
  const resolved = withLegacyCarryForward(raw, { ...EMAIL_COPY_DEFAULTS } as EmailCopy);
  for (const key of Object.keys(EMAIL_COPY_DEFAULTS) as EmailCopyKey[]) {
    const value = input[key];
    if (hasExplicitValue(value)) resolved[key] = value;
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
