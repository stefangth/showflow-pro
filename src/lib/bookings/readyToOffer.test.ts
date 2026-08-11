import { describe, it, expect } from "vitest";
import { countReadyToOffer, type ReadyDateInput } from "./readyToOffer";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { fetchOpenedTier1DateIds } from "@/data/bookings";

// A (show, city) predicate that covers everything — most tests only care about
// the other three gates, so this keeps fixtures short.
const coverAll = () => true;

function date(overrides: Partial<ReadyDateInput> & { id: string }): ReadyDateInput {
  return {
    showId: "show-1",
    cityId: "city-1",
    hasSession: true,
    slotsSet: true,
    ...overrides,
  };
}

describe("countReadyToOffer", () => {
  it("counts 4 ready dates out of 4 ready + 30 missing-slots + 2 already-opened", () => {
    const ready: ReadyDateInput[] = Array.from({ length: 4 }, (_, i) => date({ id: `ready-${i}` }));
    const missingSlots: ReadyDateInput[] = Array.from({ length: 30 }, (_, i) =>
      date({ id: `missing-slots-${i}`, slotsSet: false }));
    const opened: ReadyDateInput[] = Array.from({ length: 2 }, (_, i) =>
      date({ id: `opened-${i}` }));

    const dates = [...ready, ...missingSlots, ...opened];
    const openedTier1Ids = new Set(opened.map((d) => d.id));

    expect(countReadyToOffer(dates, coverAll, openedTier1Ids)).toBe(4);
  });

  it("excludes a date with no session configured", () => {
    const dates: ReadyDateInput[] = [date({ id: "d1", hasSession: false })];
    expect(countReadyToOffer(dates, coverAll, new Set())).toBe(0);
  });

  it("excludes a date whose slots are not set", () => {
    const dates: ReadyDateInput[] = [date({ id: "d1", slotsSet: false })];
    expect(countReadyToOffer(dates, coverAll, new Set())).toBe(0);
  });

  it("excludes a date whose (show, city) pair is not covered", () => {
    const dates: ReadyDateInput[] = [date({ id: "d1", showId: "show-uncovered", cityId: "city-2" })];
    const coveredShowCity = (showId: string, cityId: string | null) =>
      !(showId === "show-uncovered" && cityId === "city-2");
    expect(countReadyToOffer(dates, coveredShowCity, new Set())).toBe(0);
  });

  it("excludes a date whose tier 1 has already been opened", () => {
    const dates: ReadyDateInput[] = [date({ id: "d1" })];
    expect(countReadyToOffer(dates, coverAll, new Set(["d1"]))).toBe(0);
  });

  it("returns 0 for an empty date list", () => {
    expect(countReadyToOffer([], coverAll, new Set())).toBe(0);
  });

  it("counts a date with a null city as long as coveredShowCity says yes", () => {
    // coveredShowCity is an injected predicate — countReadyToOffer itself has no
    // opinion on null cities, that policy lives in the caller (resolveCoverage).
    const dates: ReadyDateInput[] = [date({ id: "d1", cityId: null })];
    expect(countReadyToOffer(dates, coverAll, new Set())).toBe(1);
  });
});

describe("fetchOpenedTier1DateIds", () => {
  it("returns the distinct show_date ids that have a tier-1 row for the org", async () => {
    const fake = createFakeSupabase({
      show_date_offer_tiers: {
        data: [
          { show_date_id: "d1" },
          { show_date_id: "d2" },
          { show_date_id: "d1" }, // duplicate — same date could carry stray rows
        ],
        error: null,
      },
    });
    const ids = await fetchOpenedTier1DateIds(asSupabase(fake), "org-1");
    expect(ids.sort()).toEqual(["d1", "d2"]);
    expect(fake.calls).toContainEqual({ table: "show_date_offer_tiers", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "show_date_offer_tiers", method: "eq", args: ["tier", 1] });
  });

  it("returns [] when the org has no tier-1 rows", async () => {
    const fake = createFakeSupabase({ show_date_offer_tiers: { data: [], error: null } });
    expect(await fetchOpenedTier1DateIds(asSupabase(fake), "org-1")).toEqual([]);
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ show_date_offer_tiers: { data: null, error: { message: "boom" } } });
    await expect(fetchOpenedTier1DateIds(asSupabase(fake), "org-1")).rejects.toBeTruthy();
  });
});
