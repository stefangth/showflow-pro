import { describe, it, expect } from "vitest";
import { REALTIME_INVALIDATIONS } from "./realtimeInvalidations";

/**
 * Guards the realtime table → query-key invalidation map. A key prefix that no
 * `useQuery` uses silently no-ops, so cross-client edits stop propagating (M5).
 */

function keysFor(table: string): unknown[][] {
  const entry = REALTIME_INVALIDATIONS.find((e) => e.table === table);
  if (!entry) throw new Error(`no realtime entry for table '${table}'`);
  return entry.keys;
}

function hasKey(table: string, prefix: string): boolean {
  return keysFor(table).some((k) => k[0] === prefix);
}

describe("REALTIME_INVALIDATIONS — shows table", () => {
  it("invalidates the live Productions list key ['shows'] (prefix)", () => {
    // ['shows'] prefix-matches useShows' ['shows','list',orgId], ['shows','with-slots',…], ['shows','linking',…].
    expect(hasKey("shows", "shows")).toBe(true);
  });

  it("invalidates the program/sub-programs key used by SettingsPage", () => {
    expect(hasKey("shows", "shows-program-sub-programs")).toBe(true);
  });

  it("invalidates the eligibility key used by CastDetailsSheet", () => {
    expect(hasKey("shows", "shows-for-eligibility")).toBe(true);
  });

  it("drops the dead ['show'] (singular) and ['shows-sub-programs'] keys", () => {
    expect(hasKey("shows", "show")).toBe(false);
    expect(hasKey("shows", "shows-sub-programs")).toBe(false);
  });
});

describe("REALTIME_INVALIDATIONS — hire-order readiness", () => {
  it("refreshes ['hire-orders'] when a booking or show_date changes (readiness derives from fully_filled status)", () => {
    expect(hasKey("bookings", "hire-orders")).toBe(true);
    expect(hasKey("show_dates", "hire-orders")).toBe(true);
  });

  it("propagates hire_orders row changes to the ['hire-orders'] domain", () => {
    expect(hasKey("hire_orders", "hire-orders")).toBe(true);
  });
});

describe("REALTIME_INVALIDATIONS — booking-setup ladder coverage", () => {
  // The setup rail's coverage query (['eligibility','ladder-coverage',org], useBookingSetup.ts)
  // reads show_dates, show_cast_eligibility, and cast_city_priority, so all three must bust
  // ['eligibility'] for the rail to live-refresh after an out-of-rail ladder edit.
  it("refreshes ['eligibility'] when show_dates changes", () => {
    expect(hasKey("show_dates", "eligibility")).toBe(true);
  });

  it("refreshes ['eligibility'] when show_cast_eligibility changes", () => {
    expect(hasKey("show_cast_eligibility", "eligibility")).toBe(true);
  });

  it("refreshes ['eligibility'] when cast_city_priority changes", () => {
    expect(hasKey("cast_city_priority", "eligibility")).toBe(true);
  });

  it("keeps invalidating the Casts & Cities org-wide priority key (['cast-city-priority'], CastsCitiesTab.tsx) on cast_city_priority changes", () => {
    expect(hasKey("cast_city_priority", "cast-city-priority")).toBe(true);
  });
});

describe("REALTIME_INVALIDATIONS — runtime entitlement propagation", () => {
  it("refreshes ['entitlements'] when org_entitlements changes", () => {
    expect(hasKey("org_entitlements", "entitlements")).toBe(true);
  });
});

describe("REALTIME_INVALIDATIONS — Offers cockpit tier-ladder headcounts", () => {
  // useTierLadderCounts (useTierLadder.ts) reads bookings, blocked_dates, and
  // show_date_required_skills; a change to any of them on another client must
  // refresh the ['tier-ladder'] domain. (blocked_dates isn't in the
  // supabase_realtime publication yet, so its subscription is currently a
  // no-op in practice — see the comment on that entry — but the map entry
  // itself must still be correct for when that publication gap closes.)
  it("refreshes ['tier-ladder'] when bookings changes", () => {
    expect(hasKey("bookings", "tier-ladder")).toBe(true);
  });

  it("refreshes ['tier-ladder'] when blocked_dates changes", () => {
    expect(hasKey("blocked_dates", "tier-ladder")).toBe(true);
  });

  it("refreshes ['tier-ladder'] when show_date_required_skills changes", () => {
    expect(hasKey("show_date_required_skills", "tier-ladder")).toBe(true);
  });

  // fetchTierLadderCounts feeds matchCount through fetchRequiredSkillIds, which
  // subtracts show_date_skill_drops from the effective required-skill union —
  // a drop must refresh the hero/ladder counts exactly like a date-skill add does.
  it("refreshes ['tier-ladder'] when show_date_skill_drops changes", () => {
    expect(hasKey("show_date_skill_drops", "tier-ladder")).toBe(true);
  });

  it("refreshes ['eligibility'] when show_date_skill_drops changes", () => {
    expect(hasKey("show_date_skill_drops", "eligibility")).toBe(true);
  });
});

// The Get running skills step reads ['skills','gaps',org], which counts a skill as held
// only when an ACTIVE artist holds it. Both halves of that sentence are live-editable from
// another session, so both tables have to reach the board or it keeps reporting a gap that
// is closed, or done when the last holder just went inactive.
describe("REALTIME_INVALIDATIONS — skill-gap freshness", () => {
  it("refreshes ['skills'] when artist_skills changes", () => {
    expect(hasKey("artist_skills", "skills")).toBe(true);
  });

  it("refreshes ['artist-skills'] when artist_skills changes", () => {
    expect(hasKey("artist_skills", "artist-skills")).toBe(true);
  });

  it("refreshes ['skills'] when artists changes, since a gap counts active holders only", () => {
    expect(hasKey("artists", "skills")).toBe(true);
  });

  it("refreshes ['cast-members-counts'] when artists changes, for the same reason", () => {
    expect(hasKey("artists", "cast-members-counts")).toBe(true);
  });
});

describe("REALTIME_INVALIDATIONS — map integrity", () => {
  it("lists no known-dead key prefixes (renamed/typo'd keys that no query uses)", () => {
    // Keys confirmed to have zero `useQuery` consumers in src as of this audit.
    const deadPrefixes = new Set(["show", "shows-sub-programs", "my-artist-producer"]);
    const listed = REALTIME_INVALIDATIONS.flatMap((e) => e.keys.map((k) => k[0]));
    const offenders = listed.filter((p) => deadPrefixes.has(p as string));
    expect(offenders).toEqual([]);
  });

  it("every entry has a table and at least one key", () => {
    for (const entry of REALTIME_INVALIDATIONS) {
      expect(entry.table).toBeTruthy();
      expect(entry.keys.length).toBeGreaterThan(0);
      for (const key of entry.keys) {
        expect(Array.isArray(key)).toBe(true);
        expect(key.length).toBeGreaterThan(0);
      }
    }
  });
});
