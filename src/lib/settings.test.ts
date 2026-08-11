import { describe, it, expect } from "vitest";
import { showSlots, computeSchedulingWarnings, computeSettingsDirtyKeys } from "./settings";

describe("showSlots", () => {
  it("returns null when show is null", () => {
    expect(showSlots(null)).toBeNull();
  });

  it("returns null when show is undefined", () => {
    expect(showSlots(undefined)).toBeNull();
  });

  it("returns null when main_cast_slots is null", () => {
    expect(showSlots({ main_cast_slots: null, understudy_slots: 1 })).toBeNull();
  });

  it("treats a main-only show (understudy null) as configured with 0 understudies", () => {
    expect(showSlots({ main_cast_slots: 2, understudy_slots: null })).toEqual({
      main_cast: 2,
      understudies: 0,
    });
  });

  it("returns null when both columns are null", () => {
    expect(showSlots({ main_cast_slots: null, understudy_slots: null })).toBeNull();
  });

  it("returns SlotCounts when both columns are set", () => {
    expect(showSlots({ main_cast_slots: 2, understudy_slots: 1 })).toEqual({
      main_cast: 2,
      understudies: 1,
    });
  });

  it("treats explicit 0/0 as configured (not null)", () => {
    expect(showSlots({ main_cast_slots: 0, understudy_slots: 0 })).toEqual({
      main_cast: 0,
      understudies: 0,
    });
  });
});

describe("computeSchedulingWarnings", () => {
  it("returns zero for empty array", () => {
    const w = computeSchedulingWarnings([]);
    expect(w.schedulingWarnings).toBe(0);
    expect(w.hasAnyWarning).toBe(false);
  });

  it("returns zero for null input", () => {
    const w = computeSchedulingWarnings(null);
    expect(w.schedulingWarnings).toBe(0);
    expect(w.hasAnyWarning).toBe(false);
  });

  it("counts shows where main_cast_slots is null", () => {
    const w = computeSchedulingWarnings([
      { main_cast_slots: null, understudy_slots: 1 },
      { main_cast_slots: 2, understudy_slots: 1 },
    ]);
    expect(w.schedulingWarnings).toBe(1);
    expect(w.hasAnyWarning).toBe(true);
  });

  it("does not count a main-only show (understudy null is configured)", () => {
    const w = computeSchedulingWarnings([
      { main_cast_slots: 2, understudy_slots: null },
      { main_cast_slots: 2, understudy_slots: 1 },
    ]);
    expect(w.schedulingWarnings).toBe(0);
    expect(w.hasAnyWarning).toBe(false);
  });

  it("counts each show missing a main count once", () => {
    const w = computeSchedulingWarnings([
      { main_cast_slots: null, understudy_slots: null },
      { main_cast_slots: null, understudy_slots: 1 },
      { main_cast_slots: 2, understudy_slots: 1 },
    ]);
    expect(w.schedulingWarnings).toBe(2);
    expect(w.hasAnyWarning).toBe(true);
  });

  it("reports zero when all shows are configured", () => {
    const w = computeSchedulingWarnings([
      { main_cast_slots: 2, understudy_slots: 1 },
      { main_cast_slots: 0, understudy_slots: 0 },
    ]);
    expect(w.schedulingWarnings).toBe(0);
    expect(w.hasAnyWarning).toBe(false);
  });
});

describe("computeSettingsDirtyKeys", () => {
  const EDITABLE = ["resend_from_address", "offer_response_window_hours", "notifications_enabled"] as const;

  it("returns no dirty keys when the draft is untouched (empty draft)", () => {
    const settings = [{ key: "offer_response_window_hours", value: 48 }];
    expect(computeSettingsDirtyKeys(settings, {}, EDITABLE)).toEqual([]);
  });

  it("returns no dirty keys when the draft matches persisted values", () => {
    const settings = [{ key: "offer_response_window_hours", value: 48 }];
    const draft = { offer_response_window_hours: 48 };
    expect(computeSettingsDirtyKeys(settings, draft, EDITABLE)).toEqual([]);
  });

  it("marks a changed persisted key dirty", () => {
    const settings = [{ key: "offer_response_window_hours", value: 48 }];
    const draft = { offer_response_window_hours: 24 };
    expect(computeSettingsDirtyKeys(settings, draft, EDITABLE)).toEqual(["offer_response_window_hours"]);
  });

  // The core H5 regression: a first-ever value for a key with NO persisted row must be dirty.
  it("marks a first-ever value dirty even with no persisted row", () => {
    const settings: { key: string; value: unknown }[] = []; // nothing saved yet
    const draft = { resend_from_address: "Org <hi@org.com>" };
    expect(computeSettingsDirtyKeys(settings, draft, EDITABLE)).toEqual(["resend_from_address"]);
  });

  it("handles a null/undefined settings list (first-ever value still dirty)", () => {
    const draft = { resend_from_address: "Org <hi@org.com>" };
    expect(computeSettingsDirtyKeys(null, draft, EDITABLE)).toEqual(["resend_from_address"]);
    expect(computeSettingsDirtyKeys(undefined, draft, EDITABLE)).toEqual(["resend_from_address"]);
  });

  it("does not mark an editable key dirty when it is absent from the draft", () => {
    // Key is editable and has no persisted row, but the user never entered a value.
    expect(computeSettingsDirtyKeys([], {}, EDITABLE)).toEqual([]);
  });

  // Regression: editableKeys is an ALLOWLIST, not a union with every persisted key. A
  // non-editable key that SettingsPage seeds into its draft (e.g. the platform-default-backed
  // airtable_poll_interval_minutes, which is managed by the Airtable tab) must NEVER be dirty —
  // otherwise a SettingsPage Save writes the stale draft value back and clobbers the tab's write.
  it("ignores a non-editable key even when the draft diverges from persisted", () => {
    const settings = [{ key: "airtable_poll_interval_minutes", value: 60 }];
    const draft = { airtable_poll_interval_minutes: 5 }; // stale platform-default seed
    expect(computeSettingsDirtyKeys(settings, draft, EDITABLE)).toEqual([]);
  });

  it("uses deep equality so equivalent object values are not dirty", () => {
    const settings = [{ key: "filters_visibility", value: { shows: { producer: { program: true } } } }];
    const draft = { filters_visibility: { shows: { producer: { program: true } } } };
    expect(computeSettingsDirtyKeys(settings, draft, ["filters_visibility"])).toEqual([]);
  });

  it("detects a nested object edit via deep comparison", () => {
    const settings = [{ key: "filters_visibility", value: { shows: { producer: { program: true } } } }];
    const draft = { filters_visibility: { shows: { producer: { program: false } } } };
    expect(computeSettingsDirtyKeys(settings, draft, ["filters_visibility"])).toEqual(["filters_visibility"]);
  });

  it("never marks a persisted key outside the editable set dirty (allowlist, not union)", () => {
    // A key this form does not manage is owned by another surface; SettingsPage must not
    // save it, even if the draft (seeded from persisted) diverges. (Was the reverse before —
    // the union let a non-editable key clobber the owning surface's write. See the interval
    // regression above.)
    const settings = [{ key: "legacy_key", value: "old" }];
    const draft = { legacy_key: "new" };
    expect(computeSettingsDirtyKeys(settings, draft, EDITABLE)).toEqual([]);
  });
});

describe("computeSettingsDirtyKeys with object values", () => {
  it("detects a changed booking_flow object and ignores an identical one", () => {
    const saved = [{ key: "booking_flow", value: { artist_acceptance: true } }];
    const dirty = computeSettingsDirtyKeys(saved as never, { booking_flow: { artist_acceptance: false } } as never, ["booking_flow"]);
    expect(dirty).toContain("booking_flow");
    const clean = computeSettingsDirtyKeys(saved as never, { booking_flow: { artist_acceptance: true } } as never, ["booking_flow"]);
    expect(clean).not.toContain("booking_flow");
  });

  // Regression: jsonb does not preserve key insertion order, so a value that round-trips
  // through Postgres can come back with its keys reordered even though nothing changed.
  // A plain JSON.stringify comparison would misreport that as dirty and let a no-op Save
  // write it back. The comparison must be key-order-insensitive.
  it("ignores key order when the values are otherwise identical", () => {
    const saved = [{ key: "booking_flow", value: { b: 1, a: 2 } }];
    const draft = { booking_flow: { a: 2, b: 1 } };
    expect(computeSettingsDirtyKeys(saved as never, draft as never, ["booking_flow"])).toEqual([]);
  });

  it("ignores key order in nested objects too", () => {
    const saved = [{ key: "booking_flow", value: { reference_field: { source: "custom", custom_field_id: "f1" } } }];
    const draft = { booking_flow: { reference_field: { custom_field_id: "f1", source: "custom" } } };
    expect(computeSettingsDirtyKeys(saved as never, draft as never, ["booking_flow"])).toEqual([]);
  });

  it("still detects a real change when key order also differs", () => {
    const saved = [{ key: "booking_flow", value: { b: 1, a: 2 } }];
    const draft = { booking_flow: { a: 99, b: 1 } };
    expect(computeSettingsDirtyKeys(saved as never, draft as never, ["booking_flow"])).toEqual(["booking_flow"]);
  });
});
