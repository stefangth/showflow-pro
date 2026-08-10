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

  it("carries a stored org-invitation.intro override forward onto the new productIntro slot", () => {
    // Regression: this WP retired org-invitation.intro (and roleSuffix) in favor of
    // productIntro/roleIntro*. An org that had customized the old key must not silently
    // revert to the stock copy the moment this ships.
    const resolved = resolveEmailCopy({
      "org-invitation.intro": "Welcome to the Acme crew on ShowFlow.",
    } as never);

    expect(resolved["org-invitation.productIntro"]).toBe("Welcome to the Acme crew on ShowFlow.");
  });

  it("prefers an explicit productIntro override over a carried-forward legacy intro", () => {
    const resolved = resolveEmailCopy({
      "org-invitation.intro": "Stale legacy sentence.",
      "org-invitation.productIntro": "Fresh sentence chosen after the migration.",
    } as never);

    expect(resolved["org-invitation.productIntro"]).toBe("Fresh sentence chosen after the migration.");
  });

  it("ignores a blank legacy org-invitation.intro override", () => {
    const resolved = resolveEmailCopy({ "org-invitation.intro": "   " } as never);
    expect(resolved["org-invitation.productIntro"]).toBe(EMAIL_COPY_DEFAULTS["org-invitation.productIntro"]);
  });

  it("carries the legacy value forward when the new key is present but blank, since blank means not set everywhere else in this function", () => {
    // Regression: the carry-forward guard used to check only `typeof raw[newKey] !== "string"`,
    // so a stored productIntro of all-whitespace (typeof is still "string") blocked the legacy
    // value AND then got rejected by the main loop's own blank check, landing on the stock
    // default instead of the org's real customization.
    const resolved = resolveEmailCopy({
      "org-invitation.intro": "Legacy sentence for Acme.",
      "org-invitation.productIntro": "   ",
    } as never);
    expect(resolved["org-invitation.productIntro"]).toBe("Legacy sentence for Acme.");
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

  it("migrates a legacy org-invitation.intro value onto productIntro instead of dropping it", () => {
    // Regression: the email-template editor seeds its draft (and later re-saves it) via
    // compactEmailCopy(settingsQuery.data.copy). Before this fix, compactEmailCopy filtered
    // out any key that isn't in EMAIL_COPY_DEFAULTS, so a stored legacy org-invitation.intro
    // value vanished the instant the editor loaded, even though sendOrgInvitationEmail still
    // honors it via resolveEmailCopy's own carry-forward. The first save of ANY field would
    // then persist the draft without it, permanently destroying the org's customization.
    expect(compactEmailCopy({
      "org-invitation.intro": "Welcome to the Acme crew on ShowFlow.",
    } as never)).toEqual({
      "org-invitation.productIntro": "Welcome to the Acme crew on ShowFlow.",
    });
  });

  it("prefers an explicit productIntro over a legacy intro value when compacting", () => {
    expect(compactEmailCopy({
      "org-invitation.intro": "Stale legacy sentence.",
      "org-invitation.productIntro": "Fresh sentence chosen after the migration.",
    } as never)).toEqual({
      "org-invitation.productIntro": "Fresh sentence chosen after the migration.",
    });
  });

  it("does not migrate a blank legacy org-invitation.intro value", () => {
    expect(compactEmailCopy({ "org-invitation.intro": "   " } as never)).toEqual({});
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
