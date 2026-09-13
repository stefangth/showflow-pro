import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  fetchIsSuperAdmin, fetchAllOrgs, fetchPlatformOrgStats, provisionOrg,
  setOrgStatus, updateOrg, fetchPlatformAdmins, addPlatformAdmin,
  removePlatformAdmin, savePlatformSetting,
  fetchPlatformBookingTemplates, savePlatformBookingTemplates,
  exportOrgData, deleteOrg,
} from "./platform";
import { BOOKING_FLOW_TEMPLATE_DEFAULTS } from "@/lib/bookingFlow";

describe("data/platform", () => {
  it("fetchIsSuperAdmin calls the rpc and returns the boolean", async () => {
    const fake = createFakeSupabase({ "rpc:is_super_admin": { data: true, error: null } });
    expect(await fetchIsSuperAdmin(fake as never, "u1")).toBe(true);
    expect(fake.calls).toContainEqual({ table: "rpc:is_super_admin", method: "rpc", args: [{ _uid: "u1" }] });
  });

  it("fetchAllOrgs reads organizations ordered by name", async () => {
    const rows = [{ id: "o1", name: "A", slug: "a", status: "active" }];
    const fake = createFakeSupabase({ organizations: { data: rows, error: null } });
    expect(await fetchAllOrgs(fake as never)).toEqual(rows.map((r) => ({ ...r, org_kind: "production" })));
    expect(fake.calls).toContainEqual({ table: "organizations", method: "order", args: ["name"] });
  });

  it("fetchPlatformOrgStats calls the rpc", async () => {
    const stats = [{ org_id: "o1", name: "A", slug: "a", status: "active", member_count: 1, active_artist_count: 0, bookings_30d: 0, last_activity_at: null }];
    const fake = createFakeSupabase({ "rpc:platform_org_stats": { data: stats, error: null } });
    expect(await fetchPlatformOrgStats(fake as never)).toEqual(stats.map((s) => ({ ...s, org_kind: "production" })));
  });

  it("provisionOrg invokes the edge function with the mapped body and returns org_id", async () => {
    const fake = createFakeSupabase({ "fn:provision-org": { data: { org_id: "o9" }, error: null } });
    const id = await provisionOrg(fake as never, { name: "Acme", slug: "acme", adminEmail: "a@acme.com", appOrigin: "https://app.test" });
    expect(id).toBe("o9");
    expect(fake.calls).toContainEqual({ table: "fn:provision-org", method: "invoke", args: [{ name: "Acme", slug: "acme", admin_email: "a@acme.com", role: "admin", app_origin: "https://app.test" }] });
  });

  it("provisionOrg forwards features as the entitlements body", async () => {
    const fake = createFakeSupabase({ "fn:provision-org": { data: { org_id: "o9" }, error: null } });
    await provisionOrg(fake as never, {
      name: "Acme",
      slug: "acme",
      adminEmail: "a@acme.com",
      appOrigin: "https://app.test",
      features: { booking_flow: true, hire_orders: false },
    });
    expect(fake.calls).toContainEqual({
      table: "fn:provision-org",
      method: "invoke",
      args: [{
        name: "Acme",
        slug: "acme",
        admin_email: "a@acme.com",
        role: "admin",
        app_origin: "https://app.test",
        entitlements: { booking_flow: true, hire_orders: false },
      }],
    });
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

  it("fetchPlatformBookingTemplates reads the platform-only row and normalizes it", async () => {
    const fake = createFakeSupabase({ app_settings: { data: { value: {
      off: { flow: { active: true }, times: { windowHours: 24 } },
    } }, error: null } });
    const out = await fetchPlatformBookingTemplates(fake as never);
    expect(out.off.flow.active).toBe(false);
    expect(out.off.times.windowHours).toBe(24);
    expect(fake.calls).toContainEqual({ table: "app_settings", method: "is", args: ["org_id", null] });
  });

  it("fetchPlatformBookingTemplates falls back when no row exists", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: null } });
    expect(await fetchPlatformBookingTemplates(fake as never)).toEqual(BOOKING_FLOW_TEMPLATE_DEFAULTS);
  });

  it("savePlatformBookingTemplates upserts one platform-only template row", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: null } });
    await savePlatformBookingTemplates(fake as never, BOOKING_FLOW_TEMPLATE_DEFAULTS);
    expect(fake.calls).toContainEqual({
      table: "app_settings",
      method: "upsert",
      args: [{ org_id: null, key: "booking_flow_templates", value: BOOKING_FLOW_TEMPLATE_DEFAULTS }, { onConflict: "org_id,key" }],
    });
  });
});

describe("exportOrgData", () => {
  it("invokes export-org-data and returns the bundle", async () => {
    const bundle = { schema_version: 1, organizations: [{ id: "o1" }] };
    const fake = createFakeSupabase({ "fn:export-org-data": { data: { success: true, bundle }, error: null } });
    expect(await exportOrgData(fake as never, "o1")).toEqual(bundle);
    expect(fake.calls).toContainEqual({ table: "fn:export-org-data", method: "invoke", args: [{ org_id: "o1" }] });
  });
});

describe("deleteOrg", () => {
  it("calls the delete_org rpc with the org id", async () => {
    const fake = createFakeSupabase({ "rpc:delete_org": { data: null, error: null } });
    await deleteOrg(fake as never, "o1");
    expect(fake.calls).toContainEqual({ table: "rpc:delete_org", method: "rpc", args: [{ p_org: "o1" }] });
  });
});
