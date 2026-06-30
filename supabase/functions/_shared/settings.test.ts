import { assertEquals } from "./test-asserts.ts";
import { createFakeClient } from "./testing.ts";
import { getActiveOrgs, resolveOrgSetting, BOOKING_ENGINE_DEFAULTS } from "./settings.ts";

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

Deno.test("resolveOrgSetting: a null-valued org row falls through to the platform default", async () => {
  const admin = adminWith({
    app_settings: [{
      when: { key: "offer_digest_hour_berlin" },
      data: [{ org_id: ORG_A, value: null }, { org_id: null, value: 19 }],
    }],
  });
  assertEquals(await resolveOrgSetting<number>(admin, ORG_A, "offer_digest_hour_berlin", 0), 19);
});

Deno.test("resolveOrgSetting: a null-valued platform row falls through to the fallback", async () => {
  const admin = adminWith({
    app_settings: [{
      when: { key: "offer_digest_hour_berlin" },
      data: [{ org_id: null, value: null }],
    }],
  });
  assertEquals(await resolveOrgSetting<number>(admin, ORG_A, "offer_digest_hour_berlin", 48), 48);
});

Deno.test("resolveOrgSetting: returns the fallback when neither row exists", async () => {
  const admin = adminWith({ app_settings: { data: [], error: null } });
  assertEquals(await resolveOrgSetting<number>(admin, ORG_A, "missing", 48), 48);
});

Deno.test("getActiveOrgs: returns active org ids", async () => {
  const admin = adminWith({ organizations: { data: [{ id: ORG_A }], error: null } });
  assertEquals(await getActiveOrgs(admin), [{ id: ORG_A }]);
});

// Guards FE<->edge drift: these MUST match src/config/app.config.ts BOOKING_ENGINE_DEFAULTS
// (pinned there by src/config/app.config.test.ts). The two runtimes can't share an import,
// so this is the cross-runtime sync gate.
Deno.test("BOOKING_ENGINE_DEFAULTS mirrors the frontend contract", () => {
  assertEquals(BOOKING_ENGINE_DEFAULTS.offer_response_window_hours, 48);
  assertEquals(BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin, 19);
  assertEquals(BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin, 20);
  assertEquals(BOOKING_ENGINE_DEFAULTS.resend_from_address, "ShowFlow <noreply@showflow.pro>");
});
