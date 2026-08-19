import { assertEquals } from "./test-asserts.ts";
import { makeFakeDeps } from "./testing.ts";
import {
  bookingTemplateMatches,
  BOOKING_FLOW_TEMPLATE_DEFAULTS,
  BOOKING_FLOW_DEFAULTS,
  inferBookingTemplate,
  normalizeBookingFlow,
  normalizeBookingFlowTemplates,
  referenceLabel,
  resolveBookingFlow,
} from "./bookingFlow.ts";

Deno.test("booking templates: normalize per template and force identity active state", () => {
  const templates = normalizeBookingFlowTemplates({
    classic: { flow: { offer_delivery: "immediate" }, times: { windowHours: 72, offerDigestHour: 8, confirmationDigestHour: 9 } },
    fasttrack: "broken",
    off: { flow: { active: true }, times: { windowHours: 24, offerDigestHour: 10, confirmationDigestHour: 11 } },
  });
  assertEquals(templates.classic.flow.offer_delivery, "immediate");
  assertEquals(templates.classic.times, { windowHours: 72, offerDigestHour: 8, confirmationDigestHour: 9 });
  assertEquals(templates.fasttrack, BOOKING_FLOW_TEMPLATE_DEFAULTS.fasttrack);
  assertEquals(templates.off.flow.active, false);
});

Deno.test("booking templates: partial flow uses that template's defaults", () => {
  const templates = normalizeBookingFlowTemplates({ fasttrack: { flow: {}, times: {} } });
  assertEquals(templates.fasttrack.flow.offer_delivery, "digest");
  assertEquals(templates.fasttrack.flow.producer_confirmation, false);
});

Deno.test("booking templates: match all values and infer exact identity", () => {
  const templates = BOOKING_FLOW_TEMPLATE_DEFAULTS;
  assertEquals(bookingTemplateMatches(templates.classic.flow, templates.classic.times, templates.classic), true);
  assertEquals(bookingTemplateMatches(
    templates.classic.flow,
    { ...templates.classic.times, windowHours: 49 },
    templates.classic,
  ), false);
  assertEquals(inferBookingTemplate(templates.direct.flow, templates.direct.times, templates), "direct");
  // Autopilot is the recommended default, so a flow matching no template exactly
  // falls back to Autopilot rather than Classic.
  assertEquals(inferBookingTemplate(
    { ...templates.fasttrack.flow, reference_field: { source: "program" } },
    templates.fasttrack.times,
    templates,
  ), "fasttrack");
});

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
