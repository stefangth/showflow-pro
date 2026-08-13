import { describe, expect, it } from "vitest";
import {
  applyPreset,
  bookingTemplateMatches,
  BOOKING_FLOW_TEMPLATE_DEFAULTS,
  BOOKING_FLOW_DEFAULTS,
  BOOKING_FLOW_PRESETS,
  describeAuditEntry,
  flowPreviewRows,
  inPracticeRows,
  inferBookingTemplate,
  lifecycleChips,
  matchPreset,
  normalizeBookingFlow,
  normalizeBookingFlowTemplates,
  referenceLabel,
} from "./bookingFlow";

describe("booking flow templates", () => {
  it("uses each template's own defaults for a partial definition", () => {
    const templates = normalizeBookingFlowTemplates({ fasttrack: { flow: {}, times: {} } });
    expect(templates.fasttrack.flow.offer_delivery).toBe("immediate");
    expect(templates.fasttrack.flow.producer_confirmation).toBe(false);
  });
  it("falls back per malformed template without corrupting valid siblings", () => {
    const templates = normalizeBookingFlowTemplates({
      classic: { flow: { offer_delivery: "immediate" }, times: { windowHours: 72, offerDigestHour: 8, confirmationDigestHour: 9 } },
      fasttrack: "broken",
      off: { flow: { active: true }, times: { windowHours: 24, offerDigestHour: 10, confirmationDigestHour: 11 } },
    });

    expect(templates.classic.flow.offer_delivery).toBe("immediate");
    expect(templates.classic.times).toEqual({ windowHours: 72, offerDigestHour: 8, confirmationDigestHour: 9 });
    expect(templates.fasttrack).toEqual(BOOKING_FLOW_TEMPLATE_DEFAULTS.fasttrack);
    expect(templates.off.flow.active).toBe(false);
    expect(templates.off.times.windowHours).toBe(24);
  });

  it("forces active state from the template identity", () => {
    const templates = normalizeBookingFlowTemplates({
      fasttrack: { flow: { active: false }, times: {} },
      off: { flow: { active: true }, times: {} },
    });

    expect(templates.fasttrack.flow.active).toBe(true);
    expect(templates.off.flow.active).toBe(false);
  });

  it("matches every flow and timing value and rejects either kind of divergence", () => {
    const classic = BOOKING_FLOW_TEMPLATE_DEFAULTS.classic;

    expect(bookingTemplateMatches(classic.flow, classic.times, classic)).toBe(true);
    expect(bookingTemplateMatches(
      { ...classic.flow, expiry_reminder: !classic.flow.expiry_reminder },
      classic.times,
      classic,
    )).toBe(false);
    expect(bookingTemplateMatches(
      classic.flow,
      { ...classic.times, windowHours: classic.times.windowHours + 1 },
      classic,
    )).toBe(false);
  });

  it("infers an exact template and falls back to classic for legacy customization", () => {
    const templates = BOOKING_FLOW_TEMPLATE_DEFAULTS;

    expect(inferBookingTemplate(templates.direct.flow, templates.direct.times, templates)).toBe("direct");
    expect(inferBookingTemplate(
      { ...templates.fasttrack.flow, reference_field: { source: "program" } },
      templates.fasttrack.times,
      templates,
    )).toBe("classic");
  });
});

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
  it("classic preset equals the defaults (minus reference_field and active)", () => {
    const { reference_field: _ref, active: _active, ...defaults } = BOOKING_FLOW_DEFAULTS;
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

const TIMES = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };

describe("lifecycleChips", () => {
  it("classic: offered → soft booked → confirmed", () => {
    expect(lifecycleChips(BOOKING_FLOW_DEFAULTS).map((c) => c.label)).toEqual([
      "Offered",
      "Soft booked",
      "Confirmed",
    ]);
  });
  it("auto-confirm: offered → confirmed", () => {
    const flow = normalizeBookingFlow({ producer_confirmation: false });
    expect(lifecycleChips(flow).map((c) => c.label)).toEqual(["Offered", "Confirmed"]);
  });
  it("direct: direct booking → confirmed", () => {
    const flow = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    expect(lifecycleChips(flow).map((c) => c.label)).toEqual(["Direct booking", "Confirmed"]);
    expect(lifecycleChips(flow)[0].tone).toBe("neutral");
  });
});

describe("inPracticeRows", () => {
  it("always returns artist, producer, automation rows", () => {
    expect(inPracticeRows(BOOKING_FLOW_DEFAULTS, TIMES).map((r) => r.who)).toEqual([
      "Artist",
      "Producer",
      "Automation",
    ]);
  });
  it("mentions digest hour and window in classic artist row", () => {
    const artist = inPracticeRows(BOOKING_FLOW_DEFAULTS, TIMES)[0].text;
    expect(artist).toContain("19:00");
    expect(artist).toContain("48 h");
    expect(artist).toContain("soft-books");
  });
  it("direct mode: artist never sees an offer, producer books directly", () => {
    const rows = inPracticeRows(applyPreset(BOOKING_FLOW_DEFAULTS, "direct"), TIMES);
    expect(rows[0].text).toContain("Never sees an offer");
    expect(rows[1].text).toContain("eligibility list");
  });
  it("direct mode with auto_open_tier1 still true does not claim tier 1 auto-opens", () => {
    const flow = normalizeBookingFlow({ ...applyPreset(BOOKING_FLOW_DEFAULTS, "direct"), auto_open_tier1: true });
    const automation = inPracticeRows(flow, TIMES)[2].text;
    expect(automation.toLowerCase()).not.toContain("tier 1");
  });
  it("contains no em- or en-dashes in any row for any preset", () => {
    for (const preset of ["classic", "fasttrack", "direct"] as const) {
      for (const row of inPracticeRows(applyPreset(BOOKING_FLOW_DEFAULTS, preset), TIMES)) {
        expect(row.text).not.toMatch(/[—–]/);
      }
    }
  });
});

describe("flowPreviewRows", () => {
  it("classic shows digest send and manual tier wait", () => {
    const texts = flowPreviewRows(BOOKING_FLOW_DEFAULTS, TIMES).map((r) => r.text).join("\n");
    expect(texts).toContain("Offer digest emailed");
    expect(texts).toContain("48 h response window");
  });
  it("fast-track shows immediate email, reminder, and auto-escalation", () => {
    const texts = flowPreviewRows(applyPreset(BOOKING_FLOW_DEFAULTS, "fasttrack"), TIMES)
      .map((r) => r.text)
      .join("\n");
    expect(texts).toContain("Offers emailed immediately");
    expect(texts).toContain("expiry reminder");
    expect(texts).toContain("tier 2 opens automatically");
  });
  it("direct mode has no offer rows", () => {
    const texts = flowPreviewRows(applyPreset(BOOKING_FLOW_DEFAULTS, "direct"), TIMES)
      .map((r) => r.text)
      .join("\n");
    expect(texts).toContain("eligibility list");
    expect(texts).not.toContain("digest emailed");
  });
  it("contains no em- or en-dashes for any preset", () => {
    for (const preset of ["classic", "fasttrack", "direct"] as const) {
      for (const row of flowPreviewRows(applyPreset(BOOKING_FLOW_DEFAULTS, preset), TIMES)) {
        expect(row.text).not.toMatch(/[—–]/);
        expect(row.at).not.toMatch(/[—–]/);
      }
    }
  });
});

describe("referenceLabel", () => {
  const show = { program: "Candlelight", sub_program: "Strings" };
  it("show source joins program and sub-program with a middot", () => {
    expect(referenceLabel({ reference: { source: "show" }, show, custom: null, customFieldKey: null }))
      .toBe("Candlelight · Strings");
  });
  it("program source uses program only", () => {
    expect(referenceLabel({ reference: { source: "program" }, show, custom: null, customFieldKey: null }))
      .toBe("Candlelight");
  });
  it("custom source reads the custom field value", () => {
    expect(
      referenceLabel({
        reference: { source: "custom", custom_field_id: "cf-1" },
        show,
        custom: { berechnung: "FV-2033" },
        customFieldKey: "berechnung",
      }),
    ).toBe("FV-2033");
  });
  it("custom falls back to the show label when the value is empty or the key unknown", () => {
    expect(
      referenceLabel({
        reference: { source: "custom", custom_field_id: "cf-1" },
        show,
        custom: { berechnung: "  " },
        customFieldKey: "berechnung",
      }),
    ).toBe("Candlelight · Strings");
    expect(
      referenceLabel({
        reference: { source: "custom", custom_field_id: "cf-1" },
        show,
        custom: null,
        customFieldKey: null,
      }),
    ).toBe("Candlelight · Strings");
  });
  it("handles missing show gracefully", () => {
    expect(referenceLabel({ reference: { source: "show" }, show: null, custom: null, customFieldKey: null }))
      .toBe("Untitled show");
  });
});

describe("describeAuditEntry", () => {
  it("diffs booking_flow field by field with human labels", () => {
    const text = describeAuditEntry({
      key: "booking_flow",
      old_value: BOOKING_FLOW_DEFAULTS,
      new_value: { ...BOOKING_FLOW_DEFAULTS, artist_acceptance: false, producer_confirmation: true },
    });
    expect(text).toBe("Artist acceptance: on → off");
  });
  it("formats delivery and reference changes", () => {
    const text = describeAuditEntry({
      key: "booking_flow",
      old_value: BOOKING_FLOW_DEFAULTS,
      new_value: {
        ...BOOKING_FLOW_DEFAULTS,
        offer_delivery: "immediate",
        reference_field: { source: "program" },
      },
    });
    expect(text).toContain("Offer delivery: daily digest → immediate");
    expect(text).toContain("Reference field: show label → program");
  });
  it("formats scalar setting keys", () => {
    expect(
      describeAuditEntry({ key: "offer_response_window_hours", old_value: 72, new_value: 48 }),
    ).toBe("Response window: 72 → 48");
  });
  it("shows a diff when only the custom reference field id changes", () => {
    // Switching from one custom field to another is a real, user-visible change;
    // rendering both sides as a bare "custom field" hid it as "No effective change".
    const text = describeAuditEntry({
      key: "booking_flow",
      old_value: { ...BOOKING_FLOW_DEFAULTS, reference_field: { source: "custom", custom_field_id: "11111111-aaaa-bbbb-cccc-000000000001" } },
      new_value: { ...BOOKING_FLOW_DEFAULTS, reference_field: { source: "custom", custom_field_id: "22222222-aaaa-bbbb-cccc-000000000002" } },
    });
    expect(text).not.toBe("No effective change");
    expect(text).toContain("Reference field:");
  });
  it("reports no effective change for identical values", () => {
    expect(
      describeAuditEntry({ key: "booking_flow", old_value: BOOKING_FLOW_DEFAULTS, new_value: BOOKING_FLOW_DEFAULTS }),
    ).toBe("No effective change");
  });
});

describe("active master switch", () => {
  it("defaults active=true when the key is absent (legacy/no-row parity)", () => {
    expect(normalizeBookingFlow(null).active).toBe(true);
    expect(normalizeBookingFlow({}).active).toBe(true);
  });
  it("round-trips active=false", () => {
    expect(normalizeBookingFlow({ active: false }).active).toBe(false);
  });
  it("matchPreset returns 'off' iff inactive, regardless of fields", () => {
    expect(matchPreset(normalizeBookingFlow({ active: false }))).toBe("off");
    expect(matchPreset(normalizeBookingFlow(null))).toBe("classic"); // active + classic fields
  });
  it("applyPreset('off') deactivates but preserves fields; a real preset reactivates", () => {
    const base = normalizeBookingFlow(null);
    const off = applyPreset(base, "off");
    expect(off.active).toBe(false);
    expect(off.auto_open_tier1).toBe(base.auto_open_tier1); // fields preserved
    const back = applyPreset(off, "fasttrack");
    expect(back.active).toBe(true);
    expect(back.auto_escalate).toBe(true); // fasttrack field applied
  });
});

describe("preview helpers reflect the off state", () => {
  const times = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };
  const offFlow = applyPreset(BOOKING_FLOW_DEFAULTS, "off"); // classic fields, active:false

  it("lifecycleChips collapses to a single Off chip when inactive", () => {
    expect(lifecycleChips(offFlow)).toEqual([{ label: "Off", tone: "neutral" }]);
    // sanity: an active flow still yields the full lifecycle (not the off branch)
    expect(lifecycleChips(BOOKING_FLOW_DEFAULTS).length).toBeGreaterThan(1);
  });

  it("inPracticeRows says nothing runs when inactive", () => {
    const rows = inPracticeRows(offFlow, times);
    expect(rows.map((r) => r.who)).toEqual(["Artist", "Producer", "Automation"]);
    expect(rows.every((r) => /off|nothing/i.test(r.text))).toBe(true);
  });

  it("flowPreviewRows shows a single paused row when inactive", () => {
    const rows = flowPreviewRows(offFlow, times);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toMatch(/paused/i);
  });
});
