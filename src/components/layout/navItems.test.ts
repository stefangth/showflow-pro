import { describe, it, expect } from "vitest";
import { NAV_ITEMS, visibleNavItems, groupNavBySections, type NavItem } from "./navItems";

const ctx = (over: Partial<{ isEditorMode: boolean; isRealAdmin: boolean; isSuperAdmin: boolean; roles: string[]; enabledFeatures: Set<string>; entitlementsLoading: boolean }> = {}) => {
  const { isEditorMode = false, isRealAdmin = false, isSuperAdmin = false, roles = [], enabledFeatures = new Set<string>(), entitlementsLoading = false } = over;
  return { isEditorMode, isRealAdmin, isSuperAdmin, hasRole: (r: string) => roles.includes(r), enabledFeatures, entitlementsLoading };
};

describe("visibleNavItems", () => {
  it("an artist sees Availability but not Admin or Platform", () => {
    const labels = visibleNavItems(NAV_ITEMS, ctx({ roles: ["artist"] })).map((i) => i.label);
    expect(labels).toContain("Availability");
    expect(labels).not.toContain("Admin");
    expect(labels).not.toContain("Platform");
  });
  it("an org admin sees Admin but not Platform", () => {
    const labels = visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"] })).map((i) => i.label);
    expect(labels).toContain("Admin");
    expect(labels).not.toContain("Platform");
  });
  it("a super-admin sees Platform", () => {
    const labels = visibleNavItems(NAV_ITEMS, ctx({ isSuperAdmin: true })).map((i) => i.label);
    expect(labels).toContain("Platform");
  });
  it("editor admin sees role items but Platform only if super-admin", () => {
    expect(visibleNavItems(NAV_ITEMS, ctx({ isEditorMode: true, isRealAdmin: true })).map((i) => i.label)).not.toContain("Platform");
    expect(visibleNavItems(NAV_ITEMS, ctx({ isEditorMode: true, isRealAdmin: true, isSuperAdmin: true })).map((i) => i.label)).toContain("Platform");
  });
});

describe("feature gating", () => {
  it("locks items whose feature is not enabled", () => {
    const items = [
      { to: "/x", icon: NAV_ITEMS[0].icon, label: "X", section: "workspace", feature: "hire_orders" } as NavItem,
    ];
    const off = visibleNavItems(items, ctx());
    expect(off).toHaveLength(1);
    expect(off[0].locked).toBe(true);

    const on = visibleNavItems(items, ctx({ enabledFeatures: new Set(["hire_orders"]) }));
    expect(on).toHaveLength(1);
    expect(on[0].locked).toBe(false);
  });

  it("gates a feature item for a non-super-admin (incl. editor-mode admin) but lets a super-admin bypass", () => {
    const items = [
      { to: "/x", icon: NAV_ITEMS[0].icon, label: "X", section: "workspace", feature: "hire_orders" } as NavItem,
    ];
    // Editor-mode admin who is NOT a super-admin stays visible but locked.
    const editorAdmin = visibleNavItems(items, ctx({ isEditorMode: true, isRealAdmin: true }));
    expect(editorAdmin).toHaveLength(1);
    expect(editorAdmin[0].locked).toBe(true);
    // Super-admins are never locked (matches ProtectedRoute's route-level bypass),
    // with or without the feature explicitly enabled for their org.
    const superAdminOff = visibleNavItems(items, ctx({ isSuperAdmin: true }));
    expect(superAdminOff).toHaveLength(1);
    expect(superAdminOff[0].locked).toBe(false);
    const superAdminOn = visibleNavItems(
      items,
      ctx({ isSuperAdmin: true, enabledFeatures: new Set(["hire_orders"]) }),
    );
    expect(superAdminOn).toHaveLength(1);
    expect(superAdminOn[0].locked).toBe(false);
  });

  it("items without a feature key are unaffected by enabledFeatures", () => {
    const labels = visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"] })).map((i) => i.label);
    expect(labels).toContain("Admin");
  });
});

describe("feature locking", () => {
  it("locks a feature-gated item for a non-super-admin when the module is off", () => {
    const items = visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"] }));
    const hireOrders = items.find((i) => i.label === "Hire orders");
    expect(hireOrders).toBeDefined();
    expect(hireOrders?.locked).toBe(true);
  });

  it("unlocks it once the module is enabled", () => {
    const items = visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"], enabledFeatures: new Set(["hire_orders"]) }));
    expect(items.find((i) => i.label === "Hire orders")?.locked).toBe(false);
  });

  it("does not lock a feature-gated item while entitlements are still loading (fails open)", () => {
    const items = visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"], entitlementsLoading: true }));
    const hireOrders = items.find((i) => i.label === "Hire orders");
    expect(hireOrders).toBeDefined();
    expect(hireOrders?.locked).toBe(false);
  });

  it("never locks it for a super-admin, who administers entitlements", () => {
    const items = visibleNavItems(NAV_ITEMS, ctx({ isSuperAdmin: true, roles: ["admin"] }));
    expect(items.find((i) => i.label === "Hire orders")?.locked).toBe(false);
  });

  it("still hides the item entirely from a role that has no access to it", () => {
    const items = visibleNavItems(NAV_ITEMS, ctx({ roles: ["artist"] }));
    expect(items.find((i) => i.label === "Hire orders")).toBeUndefined();
  });

  it("leaves ungated items unlocked", () => {
    const items = visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"] }));
    expect(items.find((i) => i.label === "Dashboard")?.locked).toBe(false);
  });
});

describe("hire orders nav item", () => {
  it("is present but locked for an admin without the hire_orders feature enabled", () => {
    const items = visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"] }));
    const hireOrders = items.find((i) => i.label === "Hire orders");
    expect(hireOrders).toBeDefined();
    expect(hireOrders?.locked).toBe(true);
  });

  it("is shown unlocked for a producer once hire_orders is enabled", () => {
    const items = visibleNavItems(
      NAV_ITEMS,
      ctx({ roles: ["producer"], enabledFeatures: new Set(["hire_orders"]) }),
    );
    const hireOrders = items.find((i) => i.label === "Hire orders");
    expect(hireOrders).toBeDefined();
    expect(hireOrders?.locked).toBe(false);
  });

  it("is hidden for an artist even with the feature enabled (role-gated)", () => {
    const labels = visibleNavItems(
      NAV_ITEMS,
      ctx({ roles: ["artist"], enabledFeatures: new Set(["hire_orders"]) }),
    ).map((i) => i.label);
    expect(labels).not.toContain("Hire orders");
  });

  it("carries the awaitingCountersign badge and workspace section", () => {
    const item = NAV_ITEMS.find((i) => i.label === "Hire orders");
    expect(item?.badge).toBe("awaitingCountersign");
    expect(item?.section).toBe("workspace");
    expect(item?.feature).toBe("hire_orders");
  });
});

describe("sections", () => {
  it("every nav item declares a section", () => {
    for (const i of NAV_ITEMS) expect(i.section).toBeTruthy();
  });

  it("an artist sees only the Workspace section", () => {
    const groups = groupNavBySections(visibleNavItems(NAV_ITEMS, ctx({ roles: ["artist"] })));
    expect(groups.map((g) => g.section)).toEqual(["workspace"]);
    expect(groups[0].items.map((i) => i.label)).toEqual(["Dashboard", "Availability", "Chats"]);
  });

  it("an admin sees workspace, catalog and system", () => {
    const groups = groupNavBySections(visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"] })));
    expect(groups.map((g) => g.section)).toEqual(["workspace", "catalog", "system"]);
  });

  it("drops empty sections", () => {
    expect(groupNavBySections([])).toEqual([]);
  });
});
