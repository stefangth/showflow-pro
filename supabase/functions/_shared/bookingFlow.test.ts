import { assertEquals } from "./test-asserts.ts";
import { makeFakeDeps } from "./testing.ts";
import {
  BOOKING_FLOW_DEFAULTS,
  normalizeBookingFlow,
  referenceLabel,
  resolveBookingFlow,
} from "./bookingFlow.ts";

Deno.test("normalizeBookingFlow: null and garbage return defaults", () => {
  assertEquals(normalizeBookingFlow(null), BOOKING_FLOW_DEFAULTS);
  assertEquals(normalizeBookingFlow("x"), BOOKING_FLOW_DEFAULTS);
});

Deno.test("normalizeBookingFlow: acceptance off forces confirmation on", () => {
  const flow = normalizeBookingFlow({ artist_acceptance: false, producer_confirmation: false });
  assertEquals(flow.producer_confirmation, true);
});

Deno.test("normalizeBookingFlow: bad enum values fall back", () => {
  const flow = normalizeBookingFlow({ offer_delivery: "x", reference_field: { source: "venue" } });
  assertEquals(flow.offer_delivery, "digest");
  assertEquals(flow.reference_field, { source: "show" });
});

Deno.test("referenceLabel: show, program, custom, fallback", () => {
  const show = { program: "Candlelight", sub_program: "Strings" };
  assertEquals(
    referenceLabel({ reference: { source: "show" }, show, custom: null, customFieldKey: null }),
    "Candlelight · Strings",
  );
  assertEquals(
    referenceLabel({ reference: { source: "program" }, show, custom: null, customFieldKey: null }),
    "Candlelight",
  );
  assertEquals(
    referenceLabel({
      reference: { source: "custom", custom_field_id: "cf-1" },
      show,
      custom: { berechnung: "FV-2033" },
      customFieldKey: "berechnung",
    }),
    "FV-2033",
  );
  assertEquals(
    referenceLabel({
      reference: { source: "custom", custom_field_id: "cf-1" },
      show,
      custom: {},
      customFieldKey: "berechnung",
    }),
    "Candlelight · Strings",
  );
});

// ── Entitlement gating ──────────────────────────────────────────────────────

Deno.test("resolveBookingFlow: returns defaults for an unentitled org, ignoring app_settings", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "booking_flow" }, data: [{ org_id: "org-1", value: { artist_acceptance: false } }] },
      ],
    },
    rpcs: { is_feature_enabled: { data: false, error: null } },
  });
  const flow = await resolveBookingFlow(deps.admin, "org-1");
  assertEquals(flow, normalizeBookingFlow(null));
  assertEquals(flow, BOOKING_FLOW_DEFAULTS);
});

Deno.test("resolveBookingFlow: entitled org reads its configured booking_flow setting", async () => {
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "booking_flow" }, data: [{ org_id: "org-1", value: { artist_acceptance: false } }] },
      ],
    },
    rpcs: { is_feature_enabled: { data: true, error: null } },
  });
  const flow = await resolveBookingFlow(deps.admin, "org-1");
  // artist_acceptance:false forces producer_confirmation:true (existing normalize rule).
  assertEquals(flow.artist_acceptance, false);
  assertEquals(flow.producer_confirmation, true);
});

Deno.test("resolveBookingFlow: fails OPEN (falls through to resolveOrgSetting) when the entitlement RPC errors", async () => {
  // Seed a NON-default org override so the assertion can distinguish the correct
  // fail-open path (override honored) from a fail-closed regression (defaults
  // returned) — an empty app_settings seed would pass either way.
  const { deps } = makeFakeDeps({
    tables: {
      app_settings: [
        { when: { key: "booking_flow" }, data: [{ org_id: "org-1", value: { artist_acceptance: false } }] },
      ],
    },
    rpcs: { is_feature_enabled: { data: null, error: { message: "boom" } } },
  });
  const flow = await resolveBookingFlow(deps.admin, "org-1");
  // The stored override was read and applied, proving resolution proceeded past
  // the erroring entitlement check (artist_acceptance:false also forces
  // producer_confirmation:true via the existing normalize rule).
  assertEquals(flow.artist_acceptance, false);
  assertEquals(flow.producer_confirmation, true);
});
