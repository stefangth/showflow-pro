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
  "offer-immediate.footer": "The ShowFlow team",
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
  "artist-offer-digest.footer": "The ShowFlow team",
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
  "offer-expiry-reminder.footer": "The ShowFlow team",
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
  "artist-confirmation-digest.footer": "The ShowFlow team",
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
  "cast-escalation-requested.footer": "The ShowFlow team",
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
  "hire-order-issued.footer": "Questions about this hire order. Reply to this email and we will help.",
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
  "hire-order-countersigned.footer": "Questions about this hire order. Reply to this email and we will help.",
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
  "org-invitation.intro": "You've been invited to join {{orgName}} on ShowFlow{{roleSuffix}}. Accept the invitation to set up your account and get started.",
  "org-invitation.roleSuffix": " as {{role}}",
  "org-invitation.ctaLabel": "Accept invitation",
  "org-invitation.footer": "This invitation expires in 14 days. If you weren't expecting it, you can safely ignore this email.",
  "org-invitation.previewText": "You're invited to join {{orgName}} on ShowFlow",
  "org-invitation.invitedBy": "Invited by {{inviterEmail}}.",
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

/** Merge valid, non-blank per-org copy over a fresh complete default record. */
export function resolveEmailCopy(override?: EmailCopyOverride | string | null): EmailCopy {
  const input = parseOverride(override);
  const resolved = { ...EMAIL_COPY_DEFAULTS } as EmailCopy;
  for (const key of Object.keys(EMAIL_COPY_DEFAULTS) as EmailCopyKey[]) {
    const value = input[key];
    if (typeof value === "string" && value.trim() !== "") resolved[key] = value;
  }
  return resolved;
}

/** Persist only meaningful values that differ from the built-in default. */
export function compactEmailCopy(draft?: EmailCopyOverride | null): Partial<Record<EmailCopyKey, string>> {
  if (!draft || !isRecord(draft)) return {};
  const compacted: Partial<Record<EmailCopyKey, string>> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (isCopyKey(key) && typeof value === "string" && value.trim() !== "" && value !== EMAIL_COPY_DEFAULTS[key]) {
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
