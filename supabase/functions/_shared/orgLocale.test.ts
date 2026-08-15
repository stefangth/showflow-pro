import { assertEquals } from "./test-asserts.ts";
import { makeFakeDeps } from "./testing.ts";
import { ORG_LANGUAGE_SETTING_KEY, coerceLocale, resolveOrgLocale } from "./orgLocale.ts";

// Seed the app_settings row resolveOrgSetting reads for a given org language.
function seed(orgLanguage: string | null, entitled: boolean) {
  return makeFakeDeps({
    tables: orgLanguage !== null
      ? {
          app_settings: [
            { when: { key: ORG_LANGUAGE_SETTING_KEY }, data: [{ org_id: "org1", value: orgLanguage }] },
          ],
        }
      : {},
    rpcs: { is_feature_enabled: { data: entitled, error: null } },
  });
}

Deno.test("resolveOrgLocale: setting 'de' + language_packages on => de", async () => {
  const { deps } = seed("de", true);
  assertEquals(await resolveOrgLocale(deps.admin, "org1"), "de");
});

Deno.test("resolveOrgLocale: setting 'de' but entitlement off => en (gate holds)", async () => {
  const { deps } = seed("de", false);
  assertEquals(await resolveOrgLocale(deps.admin, "org1"), "en");
});

Deno.test("resolveOrgLocale: setting 'en' + entitlement on => en", async () => {
  const { deps } = seed("en", true);
  assertEquals(await resolveOrgLocale(deps.admin, "org1"), "en");
});

Deno.test("resolveOrgLocale: no org_language row => en", async () => {
  const { deps } = seed(null, true);
  assertEquals(await resolveOrgLocale(deps.admin, "org1"), "en");
});

Deno.test("resolveOrgLocale: null orgId => en without touching the DB", async () => {
  const { deps, calls } = seed("de", true);
  assertEquals(await resolveOrgLocale(deps.admin, null), "en");
  // No settings read and no entitlement RPC for an org-less send.
  assertEquals(calls.some((c) => c.table === "app_settings"), false);
  assertEquals(calls.some((c) => c.table === "rpc:is_feature_enabled"), false);
});

Deno.test("resolveOrgLocale: setting 'de' never calls the entitlement RPC when it resolves to en earlier", async () => {
  // Sanity: an 'en' setting must not spend an entitlement RPC round-trip.
  const { deps, calls } = seed("en", true);
  await resolveOrgLocale(deps.admin, "org1");
  assertEquals(calls.some((c) => c.table === "rpc:is_feature_enabled"), false);
});

Deno.test("coerceLocale + key literal agree with the src/ twin", () => {
  assertEquals(ORG_LANGUAGE_SETTING_KEY, "org_language");
  assertEquals(coerceLocale("de"), "de");
  assertEquals(coerceLocale("en"), "en");
  assertEquals(coerceLocale("xx"), "en");
  assertEquals(coerceLocale(null), "en");
});
