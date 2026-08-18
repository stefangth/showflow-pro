import { describe, it, expect } from "vitest";
import { resolveInitialTab, SETTINGS_TAB_PARAMS } from "./settingsTabs";

describe("resolveInitialTab", () => {
  it("honours a whitelisted tab param", () => {
    expect(resolveInitialTab("airtable", true)).toBe("airtable");
    expect(resolveInitialTab("airtable", false)).toBe("airtable");
  });

  it("docs deep-link falls back for a non-super-admin", () => {
    expect(resolveInitialTab("docs", true, false)).toBe("organization");
    expect(resolveInitialTab("docs", false, false)).toBe("organization");
  });

  it("docs deep-link opens for a super-admin", () => {
    expect(resolveInitialTab("docs", true, true)).toBe("docs");
  });

  it("falls back to the role default when no tab is asked for", () => {
    expect(resolveInitialTab(null, true)).toBe("organization");
    expect(resolveInitialTab(null, false)).toBe("organization");
  });

  it("falls back to the role default on an unknown tab", () => {
    expect(resolveInitialTab("nope", true)).toBe("organization");
    expect(resolveInitialTab("", false)).toBe("organization");
  });

  it("gives a non-admin the default rather than an admin-only tab they cannot see", () => {
    // "permissions" has no trigger and no content for a producer, so honouring the param
    // would strand them on an empty pane.
    expect(resolveInitialTab("permissions", false)).toBe("organization");
    expect(resolveInitialTab("permissions", true)).toBe("permissions");
  });

  it("gives a non-admin the default rather than the admin-only People/Activity/Sync-log tabs", () => {
    // Folded in from the retired standalone Admin page: same admin-only floor it always had.
    expect(resolveInitialTab("people", false)).toBe("organization");
    expect(resolveInitialTab("people", true)).toBe("people");
    expect(resolveInitialTab("activity", false)).toBe("organization");
    expect(resolveInitialTab("activity", true)).toBe("activity");
    expect(resolveInitialTab("sync-log", false)).toBe("organization");
    expect(resolveInitialTab("sync-log", true)).toBe("sync-log");
  });

  it("redirects the retired casts-cities and production-ownership params to casts-coverage", () => {
    // Both sections folded into Casts & coverage; an old bookmark or notification link
    // must still land somewhere valid rather than falling back to the role default.
    expect(resolveInitialTab("casts-cities", true)).toBe("casts-coverage");
    expect(resolveInitialTab("casts-cities", false)).toBe("casts-coverage");
    expect(resolveInitialTab("production-ownership", true)).toBe("casts-coverage");
    expect(resolveInitialTab("production-ownership", false)).toBe("casts-coverage");
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
