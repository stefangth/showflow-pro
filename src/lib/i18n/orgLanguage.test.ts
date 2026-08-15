import { describe, expect, it } from "vitest";
import { ORG_LANGUAGE_SETTING_KEY, coerceLocale } from "./orgLanguage";

describe("orgLanguage", () => {
  it("names the app_settings key that stores an org's language", () => {
    // The edge runtime twin (supabase/functions/_shared/orgLocale.ts) hard-codes
    // the same literal; both are asserted so they cannot silently drift apart.
    expect(ORG_LANGUAGE_SETTING_KEY).toBe("org_language");
  });

  it("coerces only the exact string 'de' to German", () => {
    expect(coerceLocale("de")).toBe("de");
  });

  it("coerces everything else to English", () => {
    expect(coerceLocale("en")).toBe("en");
    expect(coerceLocale("fr")).toBe("en");
    expect(coerceLocale("DE")).toBe("en"); // case-sensitive on purpose
    expect(coerceLocale("")).toBe("en");
    expect(coerceLocale(null)).toBe("en");
    expect(coerceLocale(undefined)).toBe("en");
    expect(coerceLocale(42)).toBe("en");
    expect(coerceLocale({})).toBe("en");
  });
});
