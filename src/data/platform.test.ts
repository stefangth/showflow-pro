import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  fetchIsSuperAdmin, fetchAllOrgs, fetchPlatformOrgStats, provisionOrg,
  setOrgStatus, updateOrg, fetchPlatformAdmins, addPlatformAdmin,
  removePlatformAdmin, savePlatformSetting,
} from "./platform";

describe("data/platform", () => {
  it("fetchIsSuperAdmin calls the rpc and returns the boolean", async () => {
    const fake = createFakeSupabase({ "rpc:is_super_admin": { data: true, error: null } });
    expect(await fetchIsSuperAdmin(fake as never, "u1")).toBe(true);
    expect(fake.calls).toContainEqual({ table: "rpc:is_super_admin", method: "rpc", args: [{ _uid: "u1" }] });
  });

  it("fetchAllOrgs reads organizations ordered by name", async () => {
    const rows = [{ id: "o1", name: "A", slug: "a", status: "active" }];
    const fake = createFakeSupabase({ organizations: { data: rows, error: null } });
    expect(await fetchAllOrgs(fake as never)).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "organizations", method: "order", args: ["name"] });
  });

  it("fetchPlatformOrgStats calls the rpc", async () => {
    const stats = [{ org_id: "o1", name: "A", slug: "a", status: "active", member_count: 1, active_artist_count: 0, bookings_30d: 0, last_activity_at: null }];
    const fake = createFakeSupabase({ "rpc:platform_org_stats": { data: stats, error: null } });
    expect(await fetchPlatformOrgStats(fake as never)).toEqual(stats);
  });

  it("provisionOrg invokes the edge function with the mapped body and returns org_id", async () => {
    const fake = createFakeSupabase({ "fn:provision-org": { data: { org_id: "o9" }, error: null } });
    const id = await provisionOrg(fake as never, { name: "Acme", slug: "acme", adminEmail: "a@acme.com", appOrigin: "https://app.test" });
    expect(id).toBe("o9");
    expect(fake.calls).toContainEqual({ table: "fn:provision-org", method: "invoke", args: [{ name: "Acme", slug: "acme", admin_email: "a@acme.com", role: "admin", app_origin: "https://app.test" }] });
  });

  it("setOrgStatus updates organizations.status by id", async () => {
    const fake = createFakeSupabase({ organizations: { data: null, error: null } });
    await setOrgStatus(fake as never, "o1", "suspended");
    expect(fake.calls).toContainEqual({ table: "organizations", method: "update", args: [{ status: "suspended" }] });
    expect(fake.calls).toContainEqual({ table: "organizations", method: "eq", args: ["id", "o1"] });
  });

  it("updateOrg patches name/slug by id", async () => {
    const fake = createFakeSupabase({ organizations: { data: null, error: null } });
    await updateOrg(fake as never, "o1", { name: "New", slug: "new" });
    expect(fake.calls).toContainEqual({ table: "organizations", method: "update", args: [{ name: "New", slug: "new" }] });
  });

  it("addPlatformAdmin / removePlatformAdmin / fetchPlatformAdmins call their rpcs", async () => {
    const fake = createFakeSupabase({
      "rpc:add_platform_admin": { data: "u2", error: null },
      "rpc:remove_platform_admin": { data: null, error: null },
      "rpc:list_platform_admins": { data: [{ user_id: "u1", email: "a@b.c", created_at: "t" }], error: null },
    });
    await addPlatformAdmin(fake as never, "a@b.c");
    await removePlatformAdmin(fake as never, "u2");
    expect(await fetchPlatformAdmins(fake as never)).toHaveLength(1);
    expect(fake.calls).toContainEqual({ table: "rpc:add_platform_admin", method: "rpc", args: [{ p_email: "a@b.c" }] });
    expect(fake.calls).toContainEqual({ table: "rpc:remove_platform_admin", method: "rpc", args: [{ p_user_id: "u2" }] });
  });

  it("savePlatformSetting upserts a NULL-org row", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: null } });
    await savePlatformSetting(fake as never, "starter_catalog_template", { skills: [] } as never);
    expect(fake.calls).toContainEqual({ table: "app_settings", method: "upsert", args: [{ org_id: null, key: "starter_catalog_template", value: { skills: [] } }, { onConflict: "org_id,key" }] });
  });
});
