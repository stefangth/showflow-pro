import { describe, it, expect } from "vitest";
import { NAV_ITEMS, visibleNavItems } from "./navItems";

const ctx = (over: Partial<{ isEditorMode: boolean; isRealAdmin: boolean; isSuperAdmin: boolean; roles: string[] }> = {}) => {
  const { isEditorMode = false, isRealAdmin = false, isSuperAdmin = false, roles = [] } = over;
  return { isEditorMode, isRealAdmin, isSuperAdmin, hasRole: (r: string) => roles.includes(r) };
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
