import { describe, it, expect } from "vitest";
import { isActiveBookedEntry } from "./ArtistBookingsView";
import type { EligibleDate } from "@/hooks/useArtistEligibleDates";
import type { ActiveBookedDateEntry } from "@/data/artists";

/**
 * Plan B fix wave: `isActiveBookedEntry` used to guard on `'is_understudy' in
 * d`, which silently misclassifies an eligible-date row the moment
 * `EligibleDate` ever gains a field named `is_understudy` (e.g. an understudy
 * flag surfaced onto eligibility rows). The explicit `kind: 'active-booked'`
 * discriminant (set only by `fetchMyActiveBookedDates`) can't be fooled by a
 * coincidental field name on a sibling shape.
 */
describe("isActiveBookedEntry", () => {
  it("is true for a real ActiveBookedDateEntry row (kind: 'active-booked')", () => {
    const row: ActiveBookedDateEntry = {
      kind: "active-booked",
      id: "d1",
      date: "2026-01-01",
      venue: null,
      session_1: null,
      session_2: null,
      session_3: null,
      status: "soft_booked",
      is_understudy: false,
      show: null,
    };
    expect(isActiveBookedEntry(row)).toBe(true);
  });

  it("is false for an eligible-date row even if it happens to carry an is_understudy field", () => {
    // Simulates EligibleDate gaining an `is_understudy`-named field: the old
    // `'is_understudy' in d` guard would have misclassified this as an
    // active-booked row. `kind` isn't part of EligibleDate at all, so the
    // explicit-tag guard can't be fooled by the coincidental field name.
    const row = {
      id: "d2",
      date: "2026-01-01",
      session_1: null,
      session_2: null,
      session_3: null,
      status: "open",
      city_id: null,
      show_id: "s1",
      venue: null,
      city: null,
      custom: null,
      show: { id: "s1", program: null, sub_program: null, status: "active" },
      is_understudy: false,
    } as EligibleDate & { is_understudy: boolean };
    expect(isActiveBookedEntry(row)).toBe(false);
  });

  it("is false for a plain eligible-date row with no is_understudy field at all", () => {
    const row: EligibleDate = {
      id: "d3",
      date: "2026-01-01",
      session_1: null,
      session_2: null,
      session_3: null,
      status: "open",
      city_id: null,
      show_id: "s1",
      venue: null,
      city: null,
      custom: null,
      show: { id: "s1", program: null, sub_program: null, status: "active" },
    };
    expect(isActiveBookedEntry(row)).toBe(false);
  });
});
