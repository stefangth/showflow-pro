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

// This asserts the EXACT SAME coercion table as src/lib/i18n/orgLanguage.test.ts.
// The two coerceLocale implementations are hand-duplicated (edge can't import from
// src/), so keep this table byte-identical with the src twin's: if either body ever
// diverges (e.g. someone teaches one to accept a third locale), the file whose body
// changed fails its own test against the shared table below.
Deno.test("coerceLocale + key literal agree with the src/ twin (shared table)", () => {
  assertEquals(ORG_LANGUAGE_SETTING_KEY, "org_language");
  assertEquals(coerceLocale("de"), "de");
  assertEquals(coerceLocale("en"), "en");
  assertEquals(coerceLocale("fr"), "en");
  assertEquals(coerceLocale("DE"), "en"); // case-sensitive on purpose
  assertEquals(coerceLocale(""), "en");
  assertEquals(coerceLocale(null), "en");
  assertEquals(coerceLocale(undefined), "en");
  assertEquals(coerceLocale(42), "en");
  assertEquals(coerceLocale({}), "en");
});
