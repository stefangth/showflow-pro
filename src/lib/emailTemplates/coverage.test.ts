import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATE_CATEGORY } from "@/lib/notificationCategories";
import { EMAIL_TEMPLATE_COVERAGE } from "./coverage";

describe("EMAIL_TEMPLATE_COVERAGE", () => {
  it("lists the approved thirteen delivered templates plus the external password reset in registry order", () => {
    expect(EMAIL_TEMPLATE_COVERAGE.map((template) => template.key)).toEqual([
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
      "password-reset",
      "cron-health-alert",
      "airtable-sync-held",
    ]);
  });

  it("marks all ten customer email templates as editable and retains their approved metadata", () => {
    expect(EMAIL_TEMPLATE_COVERAGE.filter((template) => template.status === "editable")).toEqual([
      expect.objectContaining({ key: "offer-immediate", displayName: "Immediate offer", group: "Booking engine", family: "violet", recipient: "Offered artist" }),
      expect.objectContaining({ key: "artist-offer-digest", displayName: "Artist offer digest", group: "Booking engine", family: "violet", recipient: "Artists w/ pending offers" }),
      expect.objectContaining({ key: "offer-expiry-reminder", displayName: "Offer expiry reminder", group: "Booking engine", family: "violet", recipient: "Artist w/ pending offer" }),
      expect.objectContaining({ key: "artist-confirmation-digest", displayName: "Artist confirmation digest", group: "Booking engine", family: "violet", recipient: "Newly confirmed artists" }),
      expect.objectContaining({ key: "cast-escalation-requested", displayName: "Cast escalation requested", group: "Booking engine", family: "ember", recipient: "Producers" }),
      expect.objectContaining({ key: "tier-at-risk", displayName: "Tier at risk", group: "Booking engine", family: "ember", recipient: "Producers" }),
      expect.objectContaining({ key: "hire-order-issued", displayName: "Hire order issued", group: "Hire orders", family: "pine", recipient: "Artist (PDF attached)" }),
      expect.objectContaining({ key: "hire-order-countersigned", displayName: "Hire order countersigned", group: "Hire orders", family: "steel", recipient: "Producer + artist" }),
      expect.objectContaining({ key: "org-invitation", displayName: "Organization invitation", group: "Accounts & access", family: "violet", recipient: "The invitee" }),
      expect.objectContaining({ key: "account-email-changed", displayName: "Account email changed", group: "Accounts & access", family: "steel", recipient: "The user (security)" }),
    ]);
  });

  it("keeps password reset external and cron health internal", () => {
    expect(EMAIL_TEMPLATE_COVERAGE.find((template) => template.key === "password-reset")).toMatchObject({
      group: "Accounts & access",
      status: "external",
      category: "critical",
    });
    expect(EMAIL_TEMPLATE_COVERAGE.find((template) => template.key === "cron-health-alert")).toMatchObject({
      group: "System",
      status: "internal",
      family: null,
      category: "internal",
    });
    expect(EMAIL_TEMPLATE_COVERAGE.find((template) => template.key === "magic-link")).toMatchObject({
      group: "Accounts & access",
      status: "internal",
      category: "critical",
    });
  });

  it("keeps the airtable sync alert un-editable but visible to its org-admin audience", () => {
    expect(EMAIL_TEMPLATE_COVERAGE.find((template) => template.key === "airtable-sync-held")).toMatchObject({
      displayName: "Airtable sync held",
      group: "System",
      family: "violet",
      trigger: "A record is newly held, or a sync stops importing (airtable-poll)",
      recipient: "Org admins",
      status: "internal",
      audience: "org",
      category: "internal",
    });
    // cron-health-alert and magic-link stay platform-only: no `audience` override.
    expect(EMAIL_TEMPLATE_COVERAGE.find((template) => template.key === "cron-health-alert")?.audience).toBeUndefined();
    expect(EMAIL_TEMPLATE_COVERAGE.find((template) => template.key === "magic-link")?.audience).toBeUndefined();
  });

  it("takes opt-out categories from the shared email category registry", () => {
    for (const template of EMAIL_TEMPLATE_COVERAGE) {
      const category = EMAIL_TEMPLATE_CATEGORY[template.key];
      if (category) expect(template.category).toBe(category);
    }
  });
});
