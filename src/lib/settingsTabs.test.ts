import { describe, it, expect } from "vitest";
import { resolveInitialTab, SETTINGS_TAB_PARAMS } from "./settingsTabs";

describe("resolveInitialTab", () => {
  it("honours a whitelisted tab param", () => {
    expect(resolveInitialTab("airtable", true)).toBe("airtable");
    expect(resolveInitialTab("airtable", false)).toBe("airtable");
  });

  it("docs deep-link falls back for a non-super-admin", () => {
    // Admin/producer fall back to "how this org works"; a plain member to "organization".
    expect(resolveInitialTab("docs", true, false)).toBe("how-it-works");
    expect(resolveInitialTab("docs", false, false)).toBe("organization");
  });

  it("docs deep-link opens for a super-admin", () => {
    expect(resolveInitialTab("docs", true, true)).toBe("docs");
  });

  it("lands on 'how this org works' for an admin or producer when no tab is asked for", () => {
    expect(resolveInitialTab(null, true)).toBe("how-it-works");
    // Producer is the 4th arg (isAdmin=false, isSuperAdmin=false, isProducer=true).
    expect(resolveInitialTab(null, false, false, true)).toBe("how-it-works");
  });

  it("lands on 'organization' for a member who cannot see 'how this org works'", () => {
    expect(resolveInitialTab(null, false)).toBe("organization");
  });

  it("falls back to the role default on an unknown tab", () => {
    expect(resolveInitialTab("nope", true)).toBe("how-it-works");
    expect(resolveInitialTab("", false)).toBe("organization");
  });

  it("gives a non-admin the default rather than an admin-only tab they cannot see", () => {
    // "permissions" has no trigger and no content for a producer, so honouring the param
    // would strand them on an empty pane.
    expect(resolveInitialTab("permissions", false)).toBe("organization");
    expect(resolveInitialTab("permissions", true)).toBe("permissions");
  });

  it("gives a non-admin the default rather than the admin-only People/Activity tabs", () => {
    // Folded in from the retired standalone Admin page: same admin-only floor it always had.
    expect(resolveInitialTab("people", false)).toBe("organization");
    expect(resolveInitialTab("people", true)).toBe("people");
    expect(resolveInitialTab("activity", false)).toBe("organization");
    expect(resolveInitialTab("activity", true)).toBe("activity");
  });

  it("no longer deep-links the retired sync-log tab (duplicate of Airtable sync's history view)", () => {
    expect(resolveInitialTab("sync-log", true)).toBe("how-it-works");
    expect(SETTINGS_TAB_PARAMS).not.toContain("sync-log");
  });

  it("redirects the retired casts-cities and production-ownership params to casts-coverage", () => {
    // Both sections folded into Casts & coverage; an old bookmark or notification link
    // must still land somewhere valid rather than falling back to the role default.
    expect(resolveInitialTab("casts-cities", true)).toBe("casts-coverage");
    expect(resolveInitialTab("casts-cities", false)).toBe("casts-coverage");
    expect(resolveInitialTab("production-ownership", true)).toBe("casts-coverage");
    expect(resolveInitialTab("production-ownership", false)).toBe("casts-coverage");
  });

  it("deep-links the hire-orders tab (a safe target despite the entitlement gate)", () => {
    // hire-orders is entitlement-gated, but SettingsPage renders its trigger and content for
    // any admin/producer regardless of entitlement (HireOrdersTab self-gates on useFeature),
    // so a ?tab=hire-orders link is no worse than the tab an admin can already click by hand.
    // The /get-running contract-task breadcrumbs rely on this deep link.
    expect(resolveInitialTab("hire-orders", true)).toBe("hire-orders");
    expect(SETTINGS_TAB_PARAMS).toContain("hire-orders");
  });
});

// Whether each value in SETTINGS_TAB_PARAMS actually names a tab SettingsPage renders is
// not something this pure module can know, and asserting the list against a copy of itself
// would only restate it. That guard lives in SettingsPage.test.tsx, which renders the page
// once per value and checks a tab really gets selected.
