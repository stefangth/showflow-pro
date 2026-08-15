import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchShowsWithSlots, resolveOrgSetting, upsertOrgSetting, upsertOrgSettings, fetchShowsForLinking, linkShowAirtableKey, importShowsFromOptions, mergeOrgRows, fetchBookingFlow, hasOrgSettingRow, fetchOwnedSettingKeys, fetchFlowTimes, fetchOrgLanguage, setOrgLanguage } from "./settings";
import { BOOKING_FLOW_DEFAULTS, normalizeBookingFlow } from "@/lib/bookingFlow";

describe("fetchShowsWithSlots", () => {
  it("selects the correct columns from shows filtered by org_id", async () => {
    const rows = [
      { id: "s1", program: "A", sub_program: "x", main_cast_slots: 2, understudy_slots: 1, status: "active" },
      { id: "s2", program: "A", sub_program: "y", main_cast_slots: null, understudy_slots: null, status: "draft" },
    ];
    const fake = createFakeSupabase({ shows: { data: rows, error: null } });
    const result = await fetchShowsWithSlots(fake as never, "org-1");
    expect(result).toEqual(rows);
    expect(fake.calls).toContainEqual({
      table: "shows",
      method: "select",
      args: ["id, program, sub_program, main_cast_slots, understudy_slots, status"],
    });
    expect(fake.calls).toContainEqual({
      table: "shows",
      method: "eq",
      args: ["org_id", "org-1"],
    });
    expect(fake.calls).toContainEqual({
      table: "shows",
      method: "order",
      args: ["program"],
    });
    expect(fake.calls).toContainEqual({
      table: "shows",
      method: "order",
      args: ["sub_program"],
    });
  });

  it("returns empty array when no rows", async () => {
    const fake = createFakeSupabase({ shows: { data: [], error: null } });
    const result = await fetchShowsWithSlots(fake as never, "org-1");
    expect(result).toEqual([]);
  });

  it("returns empty without querying shows when orgId is null", async () => {
    const fake = createFakeSupabase({ shows: { data: [{ id: "s1" }], error: null } });
    const result = await fetchShowsWithSlots(fake as never, null);
    expect(result).toEqual([]);
    expect(fake.calls.some((c) => c.table === "shows")).toBe(false);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: { message: "boom" } } });
    await expect(fetchShowsWithSlots(fake as never, "org-1")).rejects.toBeTruthy();
  });
});


describe("resolveOrgSetting", () => {
  it("returns the org override when present", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: "o1", value: "orgA" }, { org_id: null, value: "plat" }], error: null },
    });
    expect(await resolveOrgSetting(fake as never, "o1", "k", "def")).toBe("orgA");
  });

  it("falls back to the platform default (org_id null) when no override", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: null, value: "plat" }], error: null },
    });
    expect(await resolveOrgSetting(fake as never, "o1", "k", "def")).toBe("plat");
  });

  it("falls through to the platform default when the org row is null-valued", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: "o1", value: null }, { org_id: null, value: "plat" }], error: null },
    });
    expect(await resolveOrgSetting(fake as never, "o1", "k", "def")).toBe("plat");
  });

  it("falls through to the fallback when the platform row is null-valued and there's no org override", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: null, value: null }], error: null },
    });
    expect(await resolveOrgSetting(fake as never, "o1", "k", "def")).toBe("def");
  });

  it("returns the fallback when no row matches", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    expect(await resolveOrgSetting(fake as never, "o1", "k", "def")).toBe("def");
  });

  it("queries platform-only with .is when orgId is null", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [{ org_id: null, value: "plat" }], error: null } });
    expect(await resolveOrgSetting(fake as never, null, "k", "def")).toBe("plat");
    expect(fake.calls).toContainEqual({ table: "app_settings", method: "is", args: ["org_id", null] });
  });

  it("throws on query error", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: { message: "boom" } } });
    await expect(resolveOrgSetting(fake as never, "o1", "k", "def")).rejects.toBeTruthy();
  });
});

describe("upsertOrgSetting", () => {
  it("upserts with org_id + key and conflict target org_id,key", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: null } });
    await upsertOrgSetting(fake as never, "o1", "k", { a: 1 } as never);
    expect(fake.calls).toContainEqual({
      table: "app_settings", method: "upsert",
      args: [{ org_id: "o1", key: "k", value: { a: 1 } }, { onConflict: "org_id,key" }],
    });
  });

  it("throws on upsert error", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: { message: "no" } } });
    await expect(upsertOrgSetting(fake as never, "o1", "k", {} as never)).rejects.toBeTruthy();
  });
});

describe("fetchOrgLanguage / setOrgLanguage", () => {
  it("coerces the stored org_language value to a ServerLocale", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [{ org_id: "o1", value: "de" }], error: null } });
    expect(await fetchOrgLanguage(fake as never, "o1")).toBe("de");
  });

  it("defaults to en when the setting is unset or not a supported language", async () => {
    const unset = createFakeSupabase({ app_settings: { data: [], error: null } });
    expect(await fetchOrgLanguage(unset as never, "o1")).toBe("en");
    const bad = createFakeSupabase({ app_settings: { data: [{ org_id: "o1", value: "fr" }], error: null } });
    expect(await fetchOrgLanguage(bad as never, "o1")).toBe("en");
  });

  it("writes the org_language key via upsert with the conflict target", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: null } });
    await setOrgLanguage(fake as never, "o1", "de");
    expect(fake.calls).toContainEqual({
      table: "app_settings", method: "upsert",
      args: [{ org_id: "o1", key: "org_language", value: "de" }, { onConflict: "org_id,key" }],
    });
  });
});

describe("upsertOrgSettings", () => {
  it("upserts related org settings in one request", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: null } });
    await upsertOrgSettings(fake as never, "o1", [
      { key: "booking_flow", value: { active: true } as never },
      { key: "booking_flow_template", value: "classic" as never },
    ]);
    expect(fake.calls).toContainEqual({
      table: "app_settings", method: "upsert",
      args: [[
        { org_id: "o1", key: "booking_flow", value: { active: true } },
        { org_id: "o1", key: "booking_flow_template", value: "classic" },
      ], { onConflict: "org_id,key" }],
    });
  });
});

describe("shows linking data-access", () => {
  it("fetchShowsForLinking includes airtable_program_key + slots + status for the org", async () => {
    const rows = [{ id: "s1", program: "TJE", sub_program: "TJE: Murder", main_cast_slots: null, understudy_slots: null, status: "active", airtable_program_key: "TJE: Murder" }];
    const fake = createFakeSupabase({ shows: { data: rows, error: null } });
    const res = await fetchShowsForLinking(fake as never, "org-1");
    expect(res).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "shows", method: "select", args: ["id, program, sub_program, main_cast_slots, understudy_slots, status, airtable_program_key"] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "eq", args: ["org_id", "org-1"] });
  });

  it("fetchShowsForLinking returns [] for null org", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchShowsForLinking(fake as never, null)).toEqual([]);
  });

  it("linkShowAirtableKey updates the key", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await linkShowAirtableKey(fake as never, "s1", "TJE: Murder");
    expect(fake.calls).toContainEqual({ table: "shows", method: "update", args: [{ airtable_program_key: "TJE: Murder" }] });
    expect(fake.calls).toContainEqual({ table: "shows", method: "eq", args: ["id", "s1"] });
  });

  it("importShowsFromOptions inserts shows with NULL slots, status active, and the link key", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await importShowsFromOptions(fake as never, "org-1", [{ program: null, sub_program: "TJE: Murder", key: "TJE: Murder" }]);
    expect(fake.calls).toContainEqual({ table: "shows", method: "insert", args: [[
      { org_id: "org-1", program: null, sub_program: "TJE: Murder", airtable_program_key: "TJE: Murder", main_cast_slots: null, understudy_slots: null, status: "active" },
    ]] });
  });

  it("importShowsFromOptions no-ops on empty rows", async () => {
    const fake = createFakeSupabase({ shows: { data: null, error: null } });
    await importShowsFromOptions(fake as never, "org-1", []);
    expect(fake.calls).toEqual([]);
  });
});

describe("mergeOrgRows", () => {
  it("prefers the org row over the platform default per key", () => {
    const byKey = mergeOrgRows([
      { key: "a", value: "platform", org_id: null },
      { key: "a", value: "org", org_id: "org-1" },
      { key: "b", value: "org-only", org_id: "org-1" },
      { key: "c", value: "platform-only", org_id: null },
    ]);
    expect(byKey.get("a")?.value).toBe("org");
    expect(byKey.get("b")?.value).toBe("org-only");
    expect(byKey.get("c")?.value).toBe("platform-only");
  });

  it("is order-independent (org row wins even when it appears first)", () => {
    const byKey = mergeOrgRows([
      { key: "a", value: "org", org_id: "org-1" },
      { key: "a", value: "platform", org_id: null },
    ]);
    expect(byKey.get("a")?.value).toBe("org");
  });

  it("returns an empty map for no rows", () => {
    expect(mergeOrgRows([]).size).toBe(0);
  });

  it("skips a null-valued org row and falls through to the platform default", () => {
    const byKey = mergeOrgRows([
      { key: "a", value: null, org_id: "org-1" },
      { key: "a", value: "platform", org_id: null },
    ]);
    expect(byKey.get("a")?.value).toBe("platform");
  });

  it("has no entry for a key whose only row is null-valued", () => {
    const byKey = mergeOrgRows([{ key: "a", value: null, org_id: "org-1" }]);
    expect(byKey.has("a")).toBe(false);
  });
});

describe("fetchBookingFlow", () => {
  it("returns normalized defaults when no row exists", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    expect(await fetchBookingFlow(fake as never, "org-1")).toEqual(BOOKING_FLOW_DEFAULTS);
  });
  it("normalizes the org row (invariant enforced)", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: "org-1", value: { artist_acceptance: false, producer_confirmation: false } }], error: null },
    });
    const flow = await fetchBookingFlow(fake as never, "org-1");
    expect(flow.artist_acceptance).toBe(false);
    expect(flow.producer_confirmation).toBe(true);
  });

  it("returns classic defaults without reading the override when booking_flow is disabled", async () => {
    const fake = createFakeSupabase({
      "rpc:is_feature_enabled": { data: false, error: null },
      app_settings: { data: [{ org_id: "org-1", value: { artist_acceptance: false } }], error: null },
    });
    const flow = await fetchBookingFlow(fake as never, "org-1");
    expect(flow).toEqual(normalizeBookingFlow(null));
    expect(fake.calls.some((c) => c.table === "app_settings")).toBe(false);
    expect(fake.calls).toContainEqual({ table: "rpc:is_feature_enabled", method: "rpc", args: [{ _org: "org-1", _feature: "booking_flow" }] });
  });

  it("resolves the org override when entitled", async () => {
    const fake = createFakeSupabase({
      "rpc:is_feature_enabled": { data: true, error: null },
      app_settings: { data: [{ org_id: "org-1", value: { artist_acceptance: false } }], error: null },
    });
    const flow = await fetchBookingFlow(fake as never, "org-1");
    expect(fake.calls).toContainEqual({ table: "rpc:is_feature_enabled", method: "rpc", args: [{ _org: "org-1", _feature: "booking_flow" }] });
    expect(fake.calls.some((c) => c.table === "app_settings")).toBe(true);
    expect(flow.artist_acceptance).toBe(false);
  });

  it("fails open to the existing resolution when the RPC errors", async () => {
    const fake = createFakeSupabase({
      "rpc:is_feature_enabled": { data: null, error: { message: "boom" } },
      app_settings: { data: [{ org_id: "org-1", value: { artist_acceptance: false } }], error: null },
    });
    const flow = await fetchBookingFlow(fake as never, "org-1");
    expect(fake.calls.some((c) => c.table === "app_settings")).toBe(true);
    expect(flow.artist_acceptance).toBe(false);
  });

  it("skips the entitlement RPC entirely when orgId is null", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    const flow = await fetchBookingFlow(fake as never, null);
    expect(flow).toEqual(normalizeBookingFlow(null));
    expect(fake.calls.some((c) => c.table === "rpc:is_feature_enabled")).toBe(false);
  });
});

describe("hasOrgSettingRow", () => {
  it("is true when the org has its own row for the key", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ key: "hire_order_countersign" }], error: null },
    });
    expect(await hasOrgSettingRow(fake as never, "org-1", "hire_order_countersign")).toBe(true);
    expect(fake.calls).toContainEqual({ table: "app_settings", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "app_settings", method: "eq", args: ["key", "hire_order_countersign"] });
  });

  it("is false when only a platform default exists (no org row comes back)", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    expect(await hasOrgSettingRow(fake as never, "org-1", "hire_order_countersign")).toBe(false);
  });

  it("is false without querying when there is no org", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [{ key: "x" }], error: null } });
    expect(await hasOrgSettingRow(fake as never, null, "hire_order_countersign")).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ app_settings: { data: null, error: { message: "boom" } } });
    await expect(hasOrgSettingRow(fake as never, "org-1", "k")).rejects.toBeTruthy();
  });
});

describe("fetchOwnedSettingKeys", () => {
  it("returns only the org's own keys among those asked for", async () => {
    const client = createFakeSupabase({ app_settings: { data: [{ key: "booking_flow" }], error: null } });
    const owned = await fetchOwnedSettingKeys(client as never, "org-1", ["booking_flow", "offer_digest_hour_berlin"]);
    expect(owned.has("booking_flow")).toBe(true);
    expect(owned.has("offer_digest_hour_berlin")).toBe(false);
  });
  it("is empty for a null org", async () => {
    const client = createFakeSupabase({});
    expect((await fetchOwnedSettingKeys(client as never, null, ["booking_flow"])).size).toBe(0);
  });
});

describe("fetchFlowTimes", () => {
  it("falls back to BOOKING_ENGINE_DEFAULTS when no rows exist", async () => {
    const client = createFakeSupabase({ app_settings: { data: [], error: null } });
    const t = await fetchFlowTimes(client as never, "org-1");
    expect(t).toEqual({ windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 });
  });
});
