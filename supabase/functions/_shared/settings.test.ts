import { assertEquals } from "./test-asserts.ts";
import { createFakeClient } from "./testing.ts";
import { getActiveOrgs, resolveOrgSetting } from "./settings.ts";

const ORG_A = "00000000-0000-0000-0000-0000000000a1";

function adminWith(tables: Record<string, unknown>) {
  // settings.ts only uses the `admin` client surface (from().select()...).
  const { client } = createFakeClient({ tables: tables as never });
  return client as unknown as Parameters<typeof resolveOrgSetting>[0];
}

// Note: the fake client records .or() but does not parse it — it returns ALL seeded
// rows for the key, so these tests exercise resolveOrgSetting's JS row-selection
// (org row ?? platform row ?? fallback), not the DB-side .or() filter.
Deno.test("resolveOrgSetting: prefers the org row over the platform default", async () => {
  const admin = adminWith({
    app_settings: [{
      when: { key: "offer_digest_hour_berlin" },
      data: [{ org_id: ORG_A, value: 20 }, { org_id: null, value: 19 }],
    }],
  });
  assertEquals(await resolveOrgSetting<number>(admin, ORG_A, "offer_digest_hour_berlin", 0), 20);
});

Deno.test("resolveOrgSetting: falls back to the platform default when no org row", async () => {
  const admin = adminWith({
    app_settings: [{
      when: { key: "offer_digest_hour_berlin" },
      data: [{ org_id: null, value: 19 }],
    }],
  });
  assertEquals(await resolveOrgSetting<number>(admin, ORG_A, "offer_digest_hour_berlin", 0), 19);
});

Deno.test("resolveOrgSetting: returns the fallback when neither row exists", async () => {
  const admin = adminWith({ app_settings: { data: [], error: null } });
  assertEquals(await resolveOrgSetting<number>(admin, ORG_A, "missing", 48), 48);
});

Deno.test("getActiveOrgs: returns active org ids", async () => {
  const admin = adminWith({ organizations: { data: [{ id: ORG_A }], error: null } });
  assertEquals(await getActiveOrgs(admin), [{ id: ORG_A }]);
});
