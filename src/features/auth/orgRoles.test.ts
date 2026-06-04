import { describe, it, expect } from "vitest";
import { rolesForOrg, effectiveHasRole, effectiveOrgs } from "./orgRoles";

describe("rolesForOrg", () => {
  it("returns only the roles for the given org", () => {
    const m = [{ org_id: "a", role: "admin" as const }, { org_id: "b", role: "artist" as const }];
    expect(rolesForOrg(m, "a")).toEqual(["admin"]);
    expect(rolesForOrg(m, null)).toEqual([]);
  });
});

describe("effectiveHasRole", () => {
  const base = { isSuperAdmin: false, viewAsUser: null, viewAsRole: null, roles: ["producer" as const] };
  it("uses real roles when nothing overrides", () => {
    expect(effectiveHasRole({ ...base, role: "producer" })).toBe(true);
    expect(effectiveHasRole({ ...base, role: "admin" })).toBe(false);
  });
  it("super-admin sees every role", () => {
    expect(effectiveHasRole({ ...base, isSuperAdmin: true, roles: [], role: "admin" })).toBe(true);
  });
  it("editor view-as overrides win over super-admin", () => {
    expect(effectiveHasRole({ ...base, isSuperAdmin: true, viewAsRole: "artist", role: "admin" })).toBe(false);
    expect(effectiveHasRole({ ...base, isSuperAdmin: true, viewAsRole: "artist", role: "artist" })).toBe(true);
    expect(effectiveHasRole({ ...base, isSuperAdmin: true, viewAsUser: { roles: ["producer"] }, role: "admin" })).toBe(false);
  });
});

describe("effectiveOrgs", () => {
  const all = [{ id: "a" }, { id: "b" }];
  const mine = [{ id: "a" }];
  it("super-admin gets all orgs; others get memberships", () => {
    expect(effectiveOrgs(true, all, mine)).toBe(all);
    expect(effectiveOrgs(false, all, mine)).toBe(mine);
  });
});
