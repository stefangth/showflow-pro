import { describe, expect, it } from "vitest";
import {
  applyEmailTokens,
  compactEmailCopy,
  EMAIL_COPY_DEFAULTS,
  legacyEmailOverridesToCopy,
  resolveEmailCopy,
} from "./emailCopy";
import { EMAIL_TEMPLATE_COPY_FIELDS } from "./emailTemplateMeta";

describe("legacyEmailOverridesToCopy", () => {
  it("translates the persisted legacy field names to flattened copy keys", () => {
    expect(legacyEmailOverridesToCopy({
      "offer-immediate": { subject: "Custom", cta_label: "Answer" },
    })).toEqual({
      "offer-immediate.subject": "Custom",
      "offer-immediate.ctaLabel": "Answer",
    });
  });

  it("does not migrate unknown templates or blank legacy values", () => {
    expect(legacyEmailOverridesToCopy({
      unknown: { subject: "Ignore me" },
      "offer-immediate": { intro: "  ", footer: "A real footer" },
    })).toEqual({ "offer-immediate.footer": "A real footer" });
  });
});

describe("applyEmailTokens", () => {
  it("replaces known tokens while leaving unknown placeholders visible", () => {
    expect(applyEmailTokens("Hi {{name}}, {{missing}}", { name: "Mara" }))
      .toBe("Hi Mara, {{missing}}");
  });

  it("replaces repeated tokens and coerces numeric values", () => {
    expect(applyEmailTokens("{{count}} of {{count}}", { count: 2 })).toBe("2 of 2");
  });
});

describe("resolveEmailCopy", () => {
  it("uses defaults for blank values and preserves a non-blank per-template override", () => {
    const resolved = resolveEmailCopy({
      "offer-immediate.heading": "Your next performance",
      "offer-immediate.footer": "   ",
    });

    expect(resolved["offer-immediate.heading"]).toBe("Your next performance");
    expect(resolved["offer-immediate.footer"]).toBe("Questions? Reach out to your point of contact and they'll be glad to help.");
    expect(EMAIL_COPY_DEFAULTS["offer-immediate.heading"]).toBe("You have a new offer");
  });
});

describe("compactEmailCopy", () => {
  it("removes default and blank draft values but keeps a real override", () => {
    expect(compactEmailCopy({
      "offer-immediate.heading": "You have a new offer",
      "offer-immediate.footer": " ",
      "offer-immediate.ctaLabel": "Answer now",
    })).toEqual({ "offer-immediate.ctaLabel": "Answer now" });
  });
});

describe("email copy registry", () => {
  it("has metadata for every editable default and no orphan metadata field", () => {
    const metadataKeys = EMAIL_TEMPLATE_COPY_FIELDS.flatMap(({ fields }) =>
      fields.map(({ key }) => key),
    ).sort();
    const editableDefaultKeys = Object.keys(EMAIL_COPY_DEFAULTS)
      .filter((key) => !key.startsWith("cron-health-alert.") && !key.startsWith("magic-link."))
      .sort();

    expect(editableDefaultKeys).toEqual(metadataKeys);
  });

  it("keeps internal cron copy deliverable without exposing it to the editor", () => {
    expect(EMAIL_COPY_DEFAULTS["cron-health-alert.heading"])
      .toBe("Scheduled job failing");
    expect(EMAIL_TEMPLATE_COPY_FIELDS.some(
      ({ templateKey }) => templateKey === "cron-health-alert",
    )).toBe(false);
  });

  it("keeps dynamic plural branches as explicit singular and plural entries", () => {
    expect(EMAIL_COPY_DEFAULTS["artist-offer-digest.pendingOfferSingular"])
      .toBe("pending offer");
    expect(EMAIL_COPY_DEFAULTS["artist-offer-digest.pendingOfferPlural"])
      .toBe("pending offers");
  });

  it("contains no unicode em or en dashes in user-editable defaults", () => {
    for (const value of Object.values(EMAIL_COPY_DEFAULTS)) {
      expect(value).not.toMatch(/[–—]/);
    }
  });
});
