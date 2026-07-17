import { describe, it, expect } from "vitest";
import { NAV_ITEMS, visibleNavItems, groupNavBySections, type NavItem } from "./navItems";

const ctx = (over: Partial<{ isEditorMode: boolean; isRealAdmin: boolean; isSuperAdmin: boolean; roles: string[]; enabledFeatures: Set<string> }> = {}) => {
  const { isEditorMode = false, isRealAdmin = false, isSuperAdmin = false, roles = [], enabledFeatures = new Set<string>() } = over;
  return { isEditorMode, isRealAdmin, isSuperAdmin, hasRole: (r: string) => roles.includes(r), enabledFeatures };
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
  it("hides items whose feature is not enabled", () => {
    const items = [
      { to: "/x", icon: NAV_ITEMS[0].icon, label: "X", section: "workspace", feature: "hire_orders" } as NavItem,
    ];
    expect(visibleNavItems(items, ctx())).toHaveLength(0);
    expect(visibleNavItems(items, ctx({ enabledFeatures: new Set(["hire_orders"]) }))).toHaveLength(1);
  });

  it("gates a feature item even for a super-admin or editor-mode admin", () => {
    const items = [
      { to: "/x", icon: NAV_ITEMS[0].icon, label: "X", section: "workspace", feature: "hire_orders" } as NavItem,
    ];
    expect(visibleNavItems(items, ctx({ isSuperAdmin: true }))).toHaveLength(0);
    expect(visibleNavItems(items, ctx({ isEditorMode: true, isRealAdmin: true }))).toHaveLength(0);
    expect(
      visibleNavItems(items, ctx({ isSuperAdmin: true, enabledFeatures: new Set(["hire_orders"]) })),
    ).toHaveLength(1);
  });

  it("items without a feature key are unaffected by enabledFeatures", () => {
    const labels = visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"] })).map((i) => i.label);
    expect(labels).toContain("Admin");
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
