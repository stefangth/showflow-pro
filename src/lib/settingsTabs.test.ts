import { describe, it, expect } from "vitest";
import { resolveInitialTab, SETTINGS_TAB_PARAMS } from "./settingsTabs";

describe("resolveInitialTab", () => {
  it("honours a whitelisted tab param", () => {
    expect(resolveInitialTab("airtable", true)).toBe("airtable");
    expect(resolveInitialTab("airtable", false)).toBe("airtable");
  });

  it("opens Documentation from the concept links the setup steps render", () => {
    expect(resolveInitialTab("docs", true)).toBe("docs");
    expect(resolveInitialTab("docs", false)).toBe("docs");
  });

  it("falls back to the role default when no tab is asked for", () => {
    expect(resolveInitialTab(null, true)).toBe("organization");
    expect(resolveInitialTab(null, false)).toBe("scheduling");
  });

  it("falls back to the role default on an unknown tab", () => {
    expect(resolveInitialTab("nope", true)).toBe("organization");
    expect(resolveInitialTab("", false)).toBe("scheduling");
  });

  it("gives a non-admin the default rather than an admin-only tab they cannot see", () => {
    // "permissions" has no trigger and no content for a producer, so honouring the param
    // would strand them on an empty pane.
    expect(resolveInitialTab("permissions", false)).toBe("scheduling");
    expect(resolveInitialTab("permissions", true)).toBe("permissions");
  });

  it("does not deep-link the entitlement-gated hire-orders tab", () => {
    // Whether that tab exists depends on the org's entitlement, which this pure helper
    // cannot see, so it is deliberately not a deep-link target for anyone.
    expect(resolveInitialTab("hire-orders", true)).toBe("organization");
    expect(SETTINGS_TAB_PARAMS).not.toContain("hire-orders");
  });
});

// Whether each value in SETTINGS_TAB_PARAMS actually names a tab SettingsPage renders is
// not something this pure module can know, and asserting the list against a copy of itself
// would only restate it. That guard lives in SettingsPage.test.tsx, which renders the page
// once per value and checks a tab really gets selected.
