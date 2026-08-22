import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import type { SyncLogSummary, UnresolvedRecord } from "@/data/airtableSync";
import type { AirtableSettings } from "@/data/airtableSettings";
import type { AirtableFieldMap } from "@/data/airtableMapping";
import {
  deriveMode,
  deriveStatus,
  deriveKpis,
  groupHeldCauses,
  parseHeldReason,
  requiredMappedCount,
  statusBadge,
  runClock,
} from "./console";

const t = i18n.getFixedT("en", "settingsAirtable");

function makeLog(over: Partial<SyncLogSummary> = {}): SyncLogSummary {
  return {
    id: "log-1",
    status: "success",
    records_processed: 10,
    imported_count: 8,
    new_count: 3,
    updated_count: 5,
    held_count: 0,
    error_details: null,
    synced_at: "2026-08-14T09:12:00.000Z",
    ...over,
  };
}

function makeSettings(over: Partial<AirtableSettings> = {}): AirtableSettings {
  return {
    airtable_sync_enabled: true,
    airtable_base_id: "base",
    airtable_table_name: "table",
    airtable_field_map: {},
    airtable_view: "Grid view",
    airtable_poll_interval_minutes: 15,
    ...over,
  };
}

function makeHeld(over: Partial<UnresolvedRecord> = {}): UnresolvedRecord {
  return {
    id: "rec-1",
    airtable_record_id: "atr-1",
    reason: "missing date",
    created_at: "2026-08-14T09:00:00.000Z",
    action: "held_unresolved",
    ...over,
  };
}

describe("runClock", () => {
  it("returns 'not yet' when iso is null", () => {
    expect(runClock(null)).toBe("not yet");
  });
  it("returns a formatted time string when given an iso", () => {
    expect(runClock("2026-08-14T09:12:00.000Z")).not.toBe("not yet");
    expect(typeof runClock("2026-08-14T09:12:00.000Z")).toBe("string");
  });
});

describe("statusBadge", () => {
  it("maps known statuses", () => {
    expect(statusBadge("success", t)).toEqual({ label: "ok", tone: "green" });
    expect(statusBadge("partial", t)).toEqual({ label: "partial", tone: "amber" });
    expect(statusBadge("error", t)).toEqual({ label: "failed", tone: "red" });
  });
  it("falls back to the raw status with amber tone", () => {
    expect(statusBadge("weird", t)).toEqual({ label: "weird", tone: "amber" });
  });
});

describe("deriveMode", () => {
  it("returns setup when the key is missing", () => {
    expect(deriveMode({ keyPresent: false, hasBaseTable: true, latest: makeLog() })).toBe("setup");
  });
  it("returns setup when base/table are not set", () => {
    expect(deriveMode({ keyPresent: true, hasBaseTable: false, latest: makeLog() })).toBe("setup");
  });
  it("returns error when the latest run errored", () => {
    expect(
      deriveMode({ keyPresent: true, hasBaseTable: true, latest: makeLog({ status: "error" }) }),
    ).toBe("error");
  });
  it("returns healthy when there is no run yet", () => {
    expect(deriveMode({ keyPresent: true, hasBaseTable: true, latest: null })).toBe("healthy");
  });
  it("returns healthy when the latest run succeeded with nothing held", () => {
    expect(
      deriveMode({
        keyPresent: true,
        hasBaseTable: true,
        latest: makeLog({ status: "success", held_count: 0 }),
      }),
    ).toBe("healthy");
  });
  it("returns live when there are held records", () => {
    expect(
      deriveMode({
        keyPresent: true,
        hasBaseTable: true,
        latest: makeLog({ status: "success", held_count: 2 }),
      }),
    ).toBe("live");
  });
});

describe("deriveStatus", () => {
  it("error mode uses the error_details when present", () => {
    const s = deriveStatus(makeLog({ status: "error", error_details: "boom" }), "error", t);
    expect(s.tone).toBe("red");
    expect(s.headline).toBe("Sync is failing");
    expect(s.line).toBe("The last run failed. boom");
  });
  it("error mode falls back to a generic line", () => {
    const s = deriveStatus(makeLog({ status: "error", error_details: null }), "error", t);
    expect(s.line).toBe("The last run failed. Airtable rejected the request.");
  });
  it("healthy mode with a run contains the counts (not the clock)", () => {
    const s = deriveStatus(
      makeLog({ imported_count: 8, new_count: 3, updated_count: 5 }),
      "healthy",
      t,
    );
    expect(s.tone).toBe("green");
    expect(s.headline).toBe("Syncing normally");
    expect(s.line).toContain("brought in 8 dates: 3 new, 5 updated");
    expect(s.line).toContain("Every record resolved.");
  });
  it("healthy mode with no run uses the not-synced-yet copy", () => {
    const s = deriveStatus(null, "healthy", t);
    expect(s.line).toBe("Not synced yet. The next run will bring in dates.");
  });
  it("live mode headline and line reflect held count (plural)", () => {
    const s = deriveStatus(
      makeLog({ held_count: 3, imported_count: 8, new_count: 3, updated_count: 5 }),
      "live",
      t,
    );
    expect(s.tone).toBe("amber");
    expect(s.headline).toBe("Syncing, 3 records held");
    expect(s.line).toContain("brought in 8 dates: 3 new, 5 updated");
    expect(s.line).toContain("3 records could not resolve");
  });
  it("live mode singularizes a single held record", () => {
    const s = deriveStatus(makeLog({ held_count: 1 }), "live", t);
    expect(s.headline).toBe("Syncing, 1 record held");
    expect(s.line).toContain("1 record could not resolve");
  });
});

describe("deriveKpis", () => {
  it("returns length 4 with Held amber + value when held > 0", () => {
    const kpis = deriveKpis(makeLog({ held_count: 4 }), makeSettings(), [], t);
    expect(kpis).toHaveLength(4);
    const held = kpis[3];
    expect(held.label).toBe("Held");
    expect(held.value).toBe("4");
    expect(held.tone).toBe("amber");
    expect(held.sub).toBe("waiting on a link");
  });
  it("returns Held green + 'all resolved' when held is 0", () => {
    const kpis = deriveKpis(makeLog({ held_count: 0 }), makeSettings(), [], t);
    expect(kpis).toHaveLength(4);
    const held = kpis[3];
    expect(held.value).toBe("0");
    expect(held.tone).toBe("green");
    expect(held.sub).toBe("all resolved");
  });
  it("returns length 4 for a null latest", () => {
    const kpis = deriveKpis(null, makeSettings(), [], t);
    expect(kpis).toHaveLength(4);
    expect(kpis[3].tone).toBe("green");
  });
  it("error mode: first cell tone red and label 'failed'", () => {
    const kpis = deriveKpis(
      makeLog({ status: "error", held_count: 2 }),
      makeSettings(),
      [makeLog({ status: "success" })],
      t,
    );
    expect(kpis).toHaveLength(4);
    expect(kpis[0].label).toBe("Last run");
    expect(kpis[0].tone).toBe("red");
    expect(kpis[0].sub).toBe("failed");
    expect(kpis[1].label).toBe("Last clean run");
    expect(kpis[2].value).toBe("0");
    expect(kpis[3].value).toBe("2");
  });
});

describe("groupHeldCauses", () => {
  it("buckets a mixed input into three ordered causes", () => {
    const held: UnresolvedRecord[] = [
      makeHeld({ id: "p1", reason: "program 'Alpha' not linked" }),
      makeHeld({ id: "p2", reason: "program 'Beta' not linked" }),
      makeHeld({ id: "c1", reason: "city 'Berlin' not linked" }),
      makeHeld({ id: "d1", reason: "missing date" }),
      // ignored: wrong action
      makeHeld({ id: "e1", reason: "program 'Gamma' not linked", action: "error" }),
      // surfaced in the catch-all "unrecognized" bucket, never silently dropped
      makeHeld({ id: "x1", reason: "something else" }),
    ];
    const causes = groupHeldCauses(held, t);
    expect(causes.map((c) => c.category)).toEqual([
      "unlinked_program",
      "unlinked_city",
      "missing_date",
      "unrecognized",
    ]);

    const [program, city, date, unrecognized] = causes;

    expect(program.optionCount).toBe(2);
    expect(program.recordCount).toBe(2);
    expect(program.icon).toBe("theater");
    expect(program.title).toBe("2 program options have no catalog production");
    expect(program.detail).toBe("holding 2 records");

    expect(city.optionCount).toBe(1);
    expect(city.recordCount).toBe(1);
    expect(city.icon).toBe("map-pin");
    expect(city.title).toBe("1 city option has no catalog city");
    expect(city.detail).toBe("holding 1 record");

    expect(date.optionCount).toBe(0);
    expect(date.recordCount).toBe(1);
    expect(date.icon).toBe("calendar");
    expect(date.title).toBe("1 record has an empty date cell");

    expect(unrecognized.optionCount).toBe(0);
    expect(unrecognized.recordCount).toBe(1);
    expect(unrecognized.icon).toBe("alert-triangle");
    expect(unrecognized.title).toBe("1 record is held for an unrecognized reason");
  });

  it("dedupes distinct option names within a category", () => {
    const held: UnresolvedRecord[] = [
      makeHeld({ id: "p1", reason: "program 'Alpha' not linked" }),
      makeHeld({ id: "p2", reason: "program 'Alpha' not linked" }),
    ];
    const causes = groupHeldCauses(held, t);
    expect(causes).toHaveLength(1);
    expect(causes[0].optionCount).toBe(1);
    expect(causes[0].recordCount).toBe(2);
    expect(causes[0].title).toBe("1 program option has no catalog production");
  });

  it("surfaces unrecognized reasons in a catch-all bucket rather than dropping them", () => {
    const causes = groupHeldCauses([makeHeld({ reason: "nope" }), makeHeld({ reason: null })], t);
    expect(causes).toHaveLength(1);
    expect(causes[0].category).toBe("unrecognized");
    expect(causes[0].recordCount).toBe(2);
  });
});

describe("parseHeldReason", () => {
  it("parses the three known reason formats and extracts the option", () => {
    expect(parseHeldReason("missing date")).toEqual({ category: "missing_date", option: null });
    expect(parseHeldReason("program 'Queen Tribute' not linked")).toEqual({ category: "unlinked_program", option: "Queen Tribute" });
    expect(parseHeldReason("city 'Köln' not linked")).toEqual({ category: "unlinked_city", option: "Köln" });
  });
  it("returns null for null or unrecognized reasons", () => {
    expect(parseHeldReason(null)).toBeNull();
    expect(parseHeldReason("something else")).toBeNull();
  });
});

describe("requiredMappedCount", () => {
  it("reports total 9", () => {
    expect(requiredMappedCount({}).total).toBe(9);
  });
  it("counts filled mapping slots", () => {
    const fieldMap: AirtableFieldMap = {
      date: "Date",
      program: "Program",
      city: "City",
      status_field: "Status",
      // absent/blank ones should not count
      sub_program: null,
      venue: "",
    };
    const { mapped, total } = requiredMappedCount(fieldMap);
    expect(mapped).toBe(4);
    expect(total).toBe(9);
  });
});
