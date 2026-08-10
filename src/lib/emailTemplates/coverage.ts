import { EMAIL_TEMPLATE_CATEGORY, type NotificationCategory } from "@/lib/notificationCategories";
import type { EmailFamily } from "./emailTheme";

export type EmailTemplateCoverageStatus = "editable" | "external" | "internal";
export type EmailTemplateCoverageCategory = NotificationCategory | "critical" | "internal";
/**
 * Who sees the row in Settings -> Email templates when `status` is "internal"
 * (a status of "editable"/"external" is always visible to everyone; this field
 * is only read for "internal" rows). "platform" (the default when the field is
 * omitted) keeps the row hidden from org admins, e.g. cron-health-alert and
 * magic-link, which are platform-only or not meant to surface per-org customization
 * hooks. "org" keeps a row that can't be copy-edited still visible to the org
 * admins it's actually about, e.g. airtable-sync-held: they can't reword it, but
 * they need to know it exists.
 */
export type EmailTemplateAudience = "org" | "platform";

export interface EmailTemplateCoverage {
  key: string;
  displayName: string;
  group: "Booking engine" | "Hire orders" | "Accounts & access" | "System";
  family: EmailFamily | null;
  trigger: string;
  recipient: string;
  status: EmailTemplateCoverageStatus;
  audience?: EmailTemplateAudience;
  category: EmailTemplateCoverageCategory;
}

/**
 * The customer-visible email inventory. Trigger and recipient wording is
 * intentionally hand-authored: delivery code cannot reliably describe them.
 */
export const EMAIL_TEMPLATE_COVERAGE: readonly EmailTemplateCoverage[] = [
  {
    key: "offer-immediate",
    displayName: "Immediate offer",
    group: "Booking engine",
    family: "violet",
    trigger: "Offer tier opens (open-offer-tier)",
    recipient: "Offered artist",
    status: "editable",
    category: EMAIL_TEMPLATE_CATEGORY["offer-immediate"],
  },
  {
    key: "artist-offer-digest",
    displayName: "Artist offer digest",
    group: "Booking engine",
    family: "violet",
    trigger: "Daily 19:00 Berlin (send-offer-digest)",
    recipient: "Artists w/ pending offers",
    status: "editable",
    category: EMAIL_TEMPLATE_CATEGORY["artist-offer-digest"],
  },
  {
    key: "offer-expiry-reminder",
    displayName: "Offer expiry reminder",
    group: "Booking engine",
    family: "violet",
    trigger: "Before an offer expires (expire-offers)",
    recipient: "Artist w/ pending offer",
    status: "editable",
    category: EMAIL_TEMPLATE_CATEGORY["offer-expiry-reminder"],
  },
  {
    key: "artist-confirmation-digest",
    displayName: "Artist confirmation digest",
    group: "Booking engine",
    family: "violet",
    trigger: "Daily 20:00 Berlin (send-confirmation-digest)",
    recipient: "Newly confirmed artists",
    status: "editable",
    category: EMAIL_TEMPLATE_CATEGORY["artist-confirmation-digest"],
  },
  {
    key: "cast-escalation-requested",
    displayName: "Cast escalation requested",
    group: "Booking engine",
    family: "ember",
    trigger: "Tier can't fill by deadline (expire-offers)",
    recipient: "Producers",
    status: "editable",
    category: EMAIL_TEMPLATE_CATEGORY["cast-escalation-requested"],
  },
  {
    key: "hire-order-issued",
    displayName: "Hire order issued",
    group: "Hire orders",
    family: "pine",
    trigger: "Producer issues an order (generate-hire-orders)",
    recipient: "Artist (PDF attached)",
    status: "editable",
    category: EMAIL_TEMPLATE_CATEGORY["hire-order-issued"],
  },
  {
    key: "hire-order-countersigned",
    displayName: "Hire order countersigned",
    group: "Hire orders",
    family: "steel",
    trigger: "Order countersigned (generate-hire-orders)",
    recipient: "Producer + artist",
    status: "editable",
    category: EMAIL_TEMPLATE_CATEGORY["hire-order-countersigned"],
  },
  {
    key: "org-invitation",
    displayName: "Organization invitation",
    group: "Accounts & access",
    family: "violet",
    trigger: "Admin invites someone (create-invitation)",
    recipient: "The invitee",
    status: "editable",
    category: "critical",
  },
  {
    key: "account-email-changed",
    displayName: "Account email changed",
    group: "Accounts & access",
    family: "steel",
    trigger: "A user's email is changed (platform-manage-user)",
    recipient: "The user (security)",
    status: "editable",
    category: "critical",
  },
  {
    key: "magic-link",
    displayName: "Sign-in link",
    group: "Accounts & access",
    family: "violet",
    trigger: "User requests a sign-in link (send-login-link)",
    recipient: "The user",
    status: "internal", // like cron-health-alert: rendered from defaults, not per-org editable
    category: "critical", // literal; NOT in EMAIL_TEMPLATE_CATEGORY, so never preference-gated
  },
  {
    key: "password-reset",
    displayName: "Password reset",
    group: "Accounts & access",
    family: null,
    trigger: "User requests a reset",
    recipient: "The user",
    status: "external",
    category: "critical",
  },
  {
    key: "cron-health-alert",
    displayName: "Cron health alert",
    group: "System",
    family: null,
    trigger: "A scheduled job fails (cron-health-watcher)",
    recipient: "Super-admins",
    status: "internal",
    category: "internal",
  },
  {
    key: "airtable-sync-held",
    displayName: "Airtable sync held",
    group: "System",
    family: "violet",
    trigger: "A record is newly held, or a sync stops importing (airtable-poll)",
    recipient: "Org admins",
    status: "internal", // rendered from defaults, not per-org editable (like cron-health-alert)
    audience: "org", // unlike cron-health-alert/magic-link, org admins ARE the audience: stays visible to them
    category: "internal", // operational status alert, not preference-gated (like cron-health-alert)
  },
];
