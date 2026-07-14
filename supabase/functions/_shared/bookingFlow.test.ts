import { assertEquals } from "./test-asserts.ts";
import {
  BOOKING_FLOW_DEFAULTS,
  normalizeBookingFlow,
  referenceLabel,
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
