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
  // Deliberately generic rather than naming the booking pipeline as fact: hire_orders and
  // booking_flow are independently toggleable per org (see src/lib/entitlements.ts), so an
  // org running hire orders without booking_flow on would read a sentence describing work
  // its account cannot do if this named "books artists" or "confirms casts" specifically.
  // Entitlements are not plumbed into this email (no per-org context is available at invite
  // time before the invitee has ever seen the app), so the sentence stays true for every
  // module mix instead of picking one to describe.
  "org-invitation.productIntro": "ShowFlow is how {{orgName}} runs its show production work.",
  // roleIntro states the role plainly ("as {{role}}"), not "on the {{role}} side": that
  // phrasing read naturally for single-noun labels but not for "Production Team". It also
  // drops {{orgName}} on purpose (see the "org-invitation body does not repeat the org
  // name" test below) since productIntro right above it already named the org once.
  "org-invitation.roleIntro": "You are joining as {{role}}.",
  // The three roleIntro* action lines below are the second-person twin of ROLE_DESCRIPTIONS
  // (src/config/app.config.ts): same facts, different grammatical person, kept as separate
  // strings because a sentence opening "You are joining..." cannot continue into a
  // subjectless third-person clause. Review both together when either changes.
  "org-invitation.roleIntroAdmin": "You get full control of this workspace, including people, casts, settings, and every booking.",
  "org-invitation.roleIntroProducer": "You plan productions and show dates, and book artists into them.",
  // No "where that is turned on" hedge: a brand-new invitee has no way to decode who
  // turns it on or where, so the sentence states what is always true instead.
  "org-invitation.roleIntroArtist": "You get booked for shows and see every confirmed engagement.",
  "org-invitation.ctaLabel": "Accept invitation",
  "org-invitation.ctaHintNewUser": "The button opens ShowFlow and asks you to choose a password. That is all you need to get in. If it ever stops working, ask whoever invited you to send a fresh one.",
  "org-invitation.ctaHintExistingUser": "The button signs you in directly. No password needed from this email. If it ever stops working, ask whoever invited you to send a fresh one.",
  "org-invitation.ctaHintFallback": "The button takes you to a sign in page. Use your existing password, or choose Forgot password there if you do not have one yet.",
  // "works until"/"works for" rather than "is held": "held" reads as "queued for
  // delivery"; "works" says directly what the reader needs to know (the window this
  // invitation stays valid). Also drops {{orgName}} for the same repetition reason as
  // roleIntro above.
  //
  // Scoped to "this invitation link", not "this invitation" bare: membership is created
  // at invite time (ensure_invitation_membership, see create-invitation/resend-invitation/
  // provision-org), so an invitee who can authenticate through any path, not only this
  // link, is already an org member regardless of this date. Stating it as "the link"
  // keeps the sentence true to what actually stops working after expiresOn: only the
  // accept_invitation flow this specific link drives, never the invitee's org access.
  "org-invitation.expiryLine": "This invitation link works until {{expiresOn}}.",
  "org-invitation.expiryFallback": "This invitation link works for 14 days.",
  "org-invitation.footer": "If you weren't expecting this invitation, you can safely ignore this email.",
  "org-invitation.previewText": "You're invited to join {{orgName}} on ShowFlow",
  "org-invitation.invitedBy": "Invited by {{inviter}}.",
  "org-invitation.pasteLink": "Or paste this link into your browser:",
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
