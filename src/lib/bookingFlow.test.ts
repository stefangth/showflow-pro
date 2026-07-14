import { describe, expect, it } from "vitest";
import {
  applyPreset,
  BOOKING_FLOW_DEFAULTS,
  BOOKING_FLOW_PRESETS,
  matchPreset,
  normalizeBookingFlow,
} from "./bookingFlow";

describe("normalizeBookingFlow", () => {
  it("returns defaults for null, undefined, and garbage", () => {
    expect(normalizeBookingFlow(null)).toEqual(BOOKING_FLOW_DEFAULTS);
    expect(normalizeBookingFlow(undefined)).toEqual(BOOKING_FLOW_DEFAULTS);
    expect(normalizeBookingFlow("nope")).toEqual(BOOKING_FLOW_DEFAULTS);
    expect(normalizeBookingFlow([1, 2])).toEqual(BOOKING_FLOW_DEFAULTS);
  });

  it("defaults preserve current production behavior (auto-open on, digest, all steps on)", () => {
    expect(BOOKING_FLOW_DEFAULTS.auto_open_tier1).toBe(true);
    expect(BOOKING_FLOW_DEFAULTS.offer_delivery).toBe("digest");
    expect(BOOKING_FLOW_DEFAULTS.artist_acceptance).toBe(true);
    expect(BOOKING_FLOW_DEFAULTS.producer_confirmation).toBe(true);
    expect(BOOKING_FLOW_DEFAULTS.at_risk_alerts).toBe(true);
    expect(BOOKING_FLOW_DEFAULTS.expiry_reminder).toBe(false);
    expect(BOOKING_FLOW_DEFAULTS.auto_escalate).toBe(false);
  });

  it("merges partial objects over defaults", () => {
    const flow = normalizeBookingFlow({ offer_delivery: "immediate", expiry_reminder: true });
    expect(flow.offer_delivery).toBe("immediate");
    expect(flow.expiry_reminder).toBe(true);
    expect(flow.artist_acceptance).toBe(true);
  });

  it("forces producer_confirmation true when artist_acceptance is false", () => {
    const flow = normalizeBookingFlow({ artist_acceptance: false, producer_confirmation: false });
    expect(flow.artist_acceptance).toBe(false);
    expect(flow.producer_confirmation).toBe(true);
  });

  it("rejects unknown delivery and reference values", () => {
    const flow = normalizeBookingFlow({
      offer_delivery: "carrier-pigeon",
      reference_field: { source: "venue" },
    });
    expect(flow.offer_delivery).toBe("digest");
    expect(flow.reference_field).toEqual({ source: "show" });
  });

  it("keeps custom reference only when custom_field_id is a string", () => {
    expect(
      normalizeBookingFlow({ reference_field: { source: "custom", custom_field_id: "cf-1" } })
        .reference_field,
    ).toEqual({ source: "custom", custom_field_id: "cf-1" });
    expect(
      normalizeBookingFlow({ reference_field: { source: "custom" } }).reference_field,
    ).toEqual({ source: "show" });
  });
});

describe("presets", () => {
  it("classic preset equals the defaults (minus reference_field)", () => {
    const { reference_field: _ref, ...defaults } = BOOKING_FLOW_DEFAULTS;
    expect(BOOKING_FLOW_PRESETS.classic).toEqual(defaults);
  });

  it("applyPreset swaps flow fields but preserves reference_field", () => {
    const start = normalizeBookingFlow({
      reference_field: { source: "custom", custom_field_id: "cf-1" },
    });
    const fast = applyPreset(start, "fasttrack");
    expect(fast.offer_delivery).toBe("immediate");
    expect(fast.producer_confirmation).toBe(false);
    expect(fast.reference_field).toEqual({ source: "custom", custom_field_id: "cf-1" });
  });

  it("matchPreset recognizes each preset and reports custom otherwise", () => {
    expect(matchPreset(BOOKING_FLOW_DEFAULTS)).toBe("classic");
    expect(matchPreset(applyPreset(BOOKING_FLOW_DEFAULTS, "fasttrack"))).toBe("fasttrack");
    expect(matchPreset(applyPreset(BOOKING_FLOW_DEFAULTS, "direct"))).toBe("direct");
    expect(matchPreset(normalizeBookingFlow({ expiry_reminder: true }))).toBe("custom");
  });

  it("direct preset locks confirmation on and turns offer machinery off", () => {
    const direct = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    expect(direct.artist_acceptance).toBe(false);
    expect(direct.producer_confirmation).toBe(true);
    expect(direct.at_risk_alerts).toBe(false);
    expect(direct.auto_open_tier1).toBe(false);
  });
});
