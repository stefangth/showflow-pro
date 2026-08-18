/**
 * Org-scoping regression suite for the list reads that used to run unfiltered.
 *
 * Each case seeds TWO orgs' rows behind the same table — which is exactly what
 * god-mode/multi-org RLS hands back — and asserts the fetcher returns only the
 * requested org's rows. If someone drops an `.eq("org_id", …)`, these fail.
 */
import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  fetchBookingCountsByDate,
  fetchConfirmedBookingsLite,
  fetchSoftBookedRows,
  fetchBookingsLight,
} from "./bookings";
import { fetchShowDatesList, fetchUpcomingShowDates } from "./showDates";
import { fetchArtists, fetchActiveArtistOptions, fetchMyArtist } from "./artists";
import { fetchSkills, fetchSkillsByArtist } from "./skills";

const ORG = "org-1";
const OTHER = "org-2";

describe("bookings list reads are org-scoped", () => {
  it("fetchBookingCountsByDate filters by org and tallies confirmed main/understudy", async () => {
    const fake = createFakeSupabase({
      bookings: [
        {
          when: { org_id: ORG },
          data: [
            { show_date_id: "d1", status: "confirmed", is_understudy: false },
            { show_date_id: "d1", status: "confirmed", is_understudy: true },
            { show_date_id: "d1", status: "soft_booked", is_understudy: false },
          ],
          error: null,
        },
        {
          when: { org_id: OTHER },
          data: [{ show_date_id: "d9", status: "confirmed", is_understudy: false }],
          error: null,
        },
      ],
    });
    const res = await fetchBookingCountsByDate(fake as never, ORG);
    expect(res.get("d1")).toEqual({
      confirmedMain: 1, confirmedUs: 1,
      acceptedMain: 1, acceptedUs: 0,
      pendingMain: 0, pendingUs: 0,
      total: 3,
    });
    expect(res.has("d9")).toBe(false);
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["org_id", ORG] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "neq", args: ["status", "cancelled"] });
  });

  it("fetchBookingCountsByDate returns an empty map for a null org without querying", async () => {
    const fake = createFakeSupabase({});
    expect((await fetchBookingCountsByDate(fake as never, null)).size).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it("fetchConfirmedBookingsLite filters by org", async () => {
    const fake = createFakeSupabase({
      bookings: [
        { when: { org_id: ORG }, data: [{ show_date_id: "d1", status: "confirmed", is_understudy: false }], error: null },
        { when: { org_id: OTHER }, data: [{ show_date_id: "d9", status: "confirmed", is_understudy: false }], error: null },
      ],
    });
    const res = await fetchConfirmedBookingsLite(fake as never, ORG);
    expect(res.map((b) => b.show_date_id)).toEqual(["d1"]);
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["org_id", ORG] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["status", "confirmed"] });
  });

  it("fetchSoftBookedRows filters by org", async () => {
    const fake = createFakeSupabase({
      bookings: [
        { when: { org_id: ORG }, data: [{ id: "b1", is_understudy: false }], error: null },
        { when: { org_id: OTHER }, data: [{ id: "b9", is_understudy: false }], error: null },
      ],
    });
    const res = await fetchSoftBookedRows(fake as never, ORG);
    expect(res.map((b) => b.id)).toEqual(["b1"]);
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["org_id", ORG] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["status", "soft_booked"] });
  });

  it("fetchBookingsLight filters by org and excludes cancelled", async () => {
    const fake = createFakeSupabase({
      bookings: [
        { when: { org_id: ORG }, data: [{ id: "b1", artist_id: "a1", status: "confirmed" }], error: null },
        { when: { org_id: OTHER }, data: [{ id: "b9", artist_id: "a9", status: "confirmed" }], error: null },
      ],
    });
    const res = await fetchBookingsLight(fake as never, ORG);
    expect(res.map((b) => b.id)).toEqual(["b1"]);
    expect(fake.calls).toContainEqual({ table: "bookings", method: "eq", args: ["org_id", ORG] });
    expect(fake.calls).toContainEqual({ table: "bookings", method: "neq", args: ["status", "cancelled"] });
  });
});

describe("show_dates list reads are org-scoped", () => {
  it("fetchShowDatesList filters by org and orders by date", async () => {
    const fake = createFakeSupabase({
      show_dates: [
        { when: { org_id: ORG }, data: [{ id: "d1", date: "2026-08-10" }], error: null },
        { when: { org_id: OTHER }, data: [{ id: "d9", date: "2026-08-11" }], error: null },
      ],
    });
    const res = await fetchShowDatesList<{ id: string }>(fake as never, ORG);
    expect(res.map((d) => d.id)).toEqual(["d1"]);
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "eq", args: ["org_id", ORG] });
    expect(fake.calls).toContainEqual({
      table: "show_dates", method: "order", args: ["date", { ascending: true }],
    });
  });

  it("fetchShowDatesList returns [] for a null org without querying", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchShowDatesList(fake as never, null)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("fetchUpcomingShowDates filters by org, date floor and cancelled", async () => {
    const fake = createFakeSupabase({
      show_dates: [
        { when: { org_id: ORG }, data: [{ id: "d1", date: "2026-08-10" }], error: null },
        { when: { org_id: OTHER }, data: [{ id: "d9", date: "2026-08-10" }], error: null },
      ],
    });
    const res = await fetchUpcomingShowDates<{ id: string }>(fake as never, ORG, "2026-08-06");
    expect(res.map((d) => d.id)).toEqual(["d1"]);
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "eq", args: ["org_id", ORG] });
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "gte", args: ["date", "2026-08-06"] });
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "neq", args: ["status", "cancelled"] });
  });
});

describe("artists reads are org-scoped", () => {
  it("fetchArtists filters by org", async () => {
    const fake = createFakeSupabase({
      artists: [
        { when: { org_id: ORG }, data: [{ id: "a1", name: "Ada" }], error: null },
        { when: { org_id: OTHER }, data: [{ id: "a9", name: "Zoe" }], error: null },
      ],
    });
    const res = await fetchArtists(fake as never, ORG);
    expect(res.map((a) => a.id)).toEqual(["a1"]);
    expect(fake.calls).toContainEqual({ table: "artists", method: "eq", args: ["org_id", ORG] });
  });

  it("fetchActiveArtistOptions filters by org and status", async () => {
    const fake = createFakeSupabase({
      artists: [{ when: { org_id: ORG }, data: [{ id: "a1", name: "Ada" }], error: null }],
    });
    await fetchActiveArtistOptions(fake as never, ORG);
    expect(fake.calls).toContainEqual({ table: "artists", method: "eq", args: ["org_id", ORG] });
    expect(fake.calls).toContainEqual({ table: "artists", method: "eq", args: ["status", "active"] });
  });

  it("fetchMyArtist resolves the artist row for the ACTIVE org", async () => {
    // One auth user linked to an artist row in each org. Without the org filter,
    // maybeSingle() would see two rows and error (or return the wrong org's artist).
    const fake = createFakeSupabase({
      artists: [
        { when: { org_id: ORG, user_id: "u1" }, data: { id: "a1", name: "Ada", org_id: ORG }, error: null },
        { when: { org_id: OTHER, user_id: "u1" }, data: { id: "a9", name: "Ada", org_id: OTHER }, error: null },
      ],
    });
    const res = await fetchMyArtist(fake as never, "u1", ORG);
    expect(res?.id).toBe("a1");
    expect(fake.calls).toContainEqual({ table: "artists", method: "eq", args: ["org_id", ORG] });
    expect(fake.calls).toContainEqual({ table: "artists", method: "eq", args: ["user_id", "u1"] });
  });

  it("fetchMyArtist returns null for a null org without querying", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchMyArtist(fake as never, "u1", null)).toBeNull();
    expect(fake.calls).toEqual([]);
  });
});

describe("skills reads are org-scoped", () => {
  it("fetchSkills filters by org", async () => {
    const fake = createFakeSupabase({
      skills: [
        { when: { org_id: ORG }, data: [{ id: "s1", name: "Juggling" }], error: null },
        { when: { org_id: OTHER }, data: [{ id: "s9", name: "Fire" }], error: null },
      ],
    });
    const res = await fetchSkills(fake as never, ORG);
    expect(res.map((s) => s.id)).toEqual(["s1"]);
    expect(fake.calls).toContainEqual({ table: "skills", method: "eq", args: ["org_id", ORG] });
  });

  it("fetchSkills returns [] for a null org without querying", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchSkills(fake as never, null)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("fetchSkillsByArtist filters by org and groups per artist", async () => {
    const fake = createFakeSupabase({
      artist_skills: [
        {
          when: { org_id: ORG },
          data: [
            { artist_id: "a1", skill: { id: "s1", name: "Juggling" } },
            { artist_id: "a1", skill: null },
            { artist_id: "a2", skill: { id: "s2", name: "Aerial" } },
          ],
          error: null,
        },
      ],
    });
    const res = await fetchSkillsByArtist(fake as never, ORG);
    expect(res.get("a1")).toEqual([{ id: "s1", name: "Juggling" }]);
    expect(res.get("a2")).toEqual([{ id: "s2", name: "Aerial" }]);
    expect(fake.calls).toContainEqual({ table: "artist_skills", method: "eq", args: ["org_id", ORG] });
  });
});
