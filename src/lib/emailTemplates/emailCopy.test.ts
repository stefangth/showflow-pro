import { describe, expect, it } from "vitest";
import {
  applyEmailTokens,
  compactEmailCopy,
  EMAIL_COPY_DE,
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
    expect(EMAIL_COPY_DEFAULTS["offer-immediate.heading"]).toBe("Can you do this one?");
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
      "offer-immediate.heading": "Can you do this one?",
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
  it("uses one truthful invitation hint for every account state", () => {
    const hint = "Continue securely to sign in or create your account.";
    expect(EMAIL_COPY_DEFAULTS["org-invitation.ctaHintNewUser"]).toBe(hint);
    expect(EMAIL_COPY_DEFAULTS["org-invitation.ctaHintExistingUser"]).toBe(hint);
    expect(EMAIL_COPY_DEFAULTS["org-invitation.ctaHintFallback"]).toBe(hint);
  });

  it("has metadata for every editable default and no orphan metadata field", () => {
    const metadataKeys = EMAIL_TEMPLATE_COPY_FIELDS.flatMap(({ fields }) =>
      fields.map(({ key }) => key),
    ).sort();
    const editableDefaultKeys = Object.keys(EMAIL_COPY_DEFAULTS)
      .filter((key) =>
        !key.startsWith("cron-health-alert.") &&
        !key.startsWith("magic-link.") &&
        !key.startsWith("airtable-sync-held."),
      )
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

  it("keeps internal airtable sync copy deliverable without exposing it to the editor", () => {
    // Rendered from defaults only (mirrors cron-health-alert/magic-link): the
    // recipients are org admins, but the wording is an operational status alert,
    // not something per-org customization should touch. See coverage.ts's
    // "airtable-sync-held" row (status: "internal").
    expect(EMAIL_COPY_DEFAULTS["airtable-sync-held.heading"])
      .toBe("Airtable sync needs attention");
    expect(EMAIL_TEMPLATE_COPY_FIELDS.some(
      ({ templateKey }) => templateKey === "airtable-sync-held",
    )).toBe(false);
  });

  it("keeps dynamic plural branches as explicit singular and plural entries", () => {
    expect(EMAIL_COPY_DEFAULTS["artist-offer-digest.pendingOfferSingular"])
      .toBe("date to answer");
    expect(EMAIL_COPY_DEFAULTS["artist-offer-digest.pendingOfferPlural"])
      .toBe("dates to answer");
    expect(EMAIL_COPY_DEFAULTS["airtable-sync-held.heldRecordSingular"])
      .toBe("record");
    expect(EMAIL_COPY_DEFAULTS["airtable-sync-held.heldRecordPlural"])
      .toBe("records");
  });

  it("never renders a literal plural marker like record(s) anywhere in the copy registry", () => {
    for (const value of Object.values(EMAIL_COPY_DEFAULTS)) {
      expect(value).not.toMatch(/\(s\)/);
    }
  });

  it("gives the airtable sync alert its own held vs zero-import copy in user voice", () => {
    // Held branch names the token, not a bare "record(s)".
    expect(EMAIL_COPY_DEFAULTS["airtable-sync-held.introHeld"]).toContain("{{heldRecord}}");
    expect(EMAIL_COPY_DEFAULTS["airtable-sync-held.introHeld"]).not.toContain("non-empty table");
    // Zero-import gets its own intro and followup, not a shared "these records" reference.
    expect(EMAIL_COPY_DEFAULTS["airtable-sync-held.introZeroImport"]).not.toBe(EMAIL_COPY_DEFAULTS["airtable-sync-held.introHeld"]);
    expect(EMAIL_COPY_DEFAULTS["airtable-sync-held.followupZeroImport"]).not.toBe(EMAIL_COPY_DEFAULTS["airtable-sync-held.followupHeld"]);
    expect(EMAIL_COPY_DEFAULTS["airtable-sync-held.introZeroImport"]).not.toContain("non-empty table");
  });

  it("contains no unicode em or en dashes in user-editable defaults", () => {
    for (const value of Object.values(EMAIL_COPY_DEFAULTS)) {
      expect(value).not.toMatch(/[–—]/);
    }
  });
});

const emailTokensOf = (s: string): string[] =>
  (s.match(/\{\{(\w+)\}\}/g) ?? []).slice().sort();

describe("EMAIL_COPY_DE (German base)", () => {
  it("has exactly the same keys as EMAIL_COPY_DEFAULTS", () => {
    expect(Object.keys(EMAIL_COPY_DE).slice().sort()).toEqual(
      Object.keys(EMAIL_COPY_DEFAULTS).slice().sort(),
    );
  });

  it("preserves every {{token}} placeholder from the English twin", () => {
    for (const key of Object.keys(EMAIL_COPY_DEFAULTS) as (keyof typeof EMAIL_COPY_DEFAULTS)[]) {
      expect(emailTokensOf(EMAIL_COPY_DE[key]), `tokens for ${key}`).toEqual(
        emailTokensOf(EMAIL_COPY_DEFAULTS[key]),
      );
    }
  });

  it("uses no em or en dashes", () => {
    for (const [key, value] of Object.entries(EMAIL_COPY_DE)) {
      expect(value, `dash in ${key}`).not.toMatch(/[–—]/);
    }
  });

  it("uses the informal Du, never the formal Sie/Ihr", () => {
    for (const [key, value] of Object.entries(EMAIL_COPY_DE)) {
      expect(value, `formal address in ${key}`).not.toMatch(
        /\b(Sie|Ihre?|Ihnen|Ihrem|Ihren|Ihres)\b/,
      );
    }
  });
});

describe("resolveEmailCopy locale selection", () => {
  it("defaults to English and stays byte-identical to the defaults", () => {
    expect(resolveEmailCopy()).toEqual({ ...EMAIL_COPY_DEFAULTS });
    expect(resolveEmailCopy(undefined, "en")).toEqual({ ...EMAIL_COPY_DEFAULTS });
  });

  it("returns the German base when locale is 'de'", () => {
    expect(resolveEmailCopy(undefined, "de")).toEqual({ ...EMAIL_COPY_DE });
  });

  it("layers a sparse per-org override over the German base", () => {
    const out = resolveEmailCopy({ "offer-immediate.heading": "X" }, "de");
    expect(out["offer-immediate.heading"]).toBe("X");
    // an uncustomized key still resolves to the German base, not English
    expect(out["offer-immediate.ctaLabel"]).toBe(EMAIL_COPY_DE["offer-immediate.ctaLabel"]);
  });
});
