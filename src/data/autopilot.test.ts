import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import {
  fetchAtRiskDateFacts,
  fetchAutopilotFeed,
  fetchBouncedAsks,
  fetchCancelledUntoldDates,
} from "./autopilot";

const AT_TIME = /^[A-Za-z]{3} \d{2}:\d{2}$/;

describe("fetchCancelledUntoldDates", () => {
  it("returns [] and makes no calls when orgId is null", async () => {
    const fake = createFakeSupabase({});
    const result = await fetchCancelledUntoldDates(asSupabase(fake), { orgId: null, today: "2026-07-15" });
    expect(result).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("queries show_dates for cancelled, untold, upcoming dates in the org", async () => {
    const fake = createFakeSupabase({
      show_dates: {
        data: [
          {
            id: "d1", date: "2026-07-20", venue: "Thalia Theater", cancellation_reason: "weather",
            cast_notified_at: null, show: { program: "Hamlet", sub_program: "Abend" },
          },
        ],
        error: null,
      },
      bookings: { data: [], error: null },
    });
    await fetchCancelledUntoldDates(asSupabase(fake), { orgId: "org1", today: "2026-07-15" });

    const dateCall = fake.calls.find((c) => c.table === "show_dates" && c.method === "select");
    expect(dateCall?.args[0]).toContain("cast_notified_at");
    const eqCalls = fake.calls.filter((c) => c.table === "show_dates" && c.method === "eq");
    expect(eqCalls).toContainEqual({ table: "show_dates", method: "eq", args: ["org_id", "org1"] });
    expect(eqCalls).toContainEqual({ table: "show_dates", method: "eq", args: ["status", "cancelled"] });
    const isCall = fake.calls.find((c) => c.table === "show_dates" && c.method === "is");
    expect(isCall?.args).toEqual(["cast_notified_at", null]);
    const gteCall = fake.calls.find((c) => c.table === "show_dates" && c.method === "gte");
    expect(gteCall?.args).toEqual(["date", "2026-07-15"]);
  });

  it("does not query bookings at all when there are no cancelled-untold dates", async () => {
    const fake = createFakeSupabase({ show_dates: { data: [], error: null } });
    const result = await fetchCancelledUntoldDates(asSupabase(fake), { orgId: "org1", today: "2026-07-15" });
    expect(result).toEqual([]);
    expect(fake.calls.some((c) => c.table === "bookings")).toBe(false);
  });

  it("joins bookings to booking_audit_log filtering old_status confirmed/soft_booked, new_status cancelled", async () => {
    const fake = createFakeSupabase({
      show_dates: {
        data: [
          {
            id: "d1", date: "2026-07-20", venue: "Thalia Theater", cancellation_reason: "weather",
            cast_notified_at: null, show: { program: "Hamlet", sub_program: "Abend" },
          },
        ],
        error: null,
      },
      bookings: {
        data: [
          {
            id: "b1", show_date_id: "d1", artist: { name: "Anna K." },
            booking_audit_log: [{ old_status: "confirmed", new_status: "cancelled" }],
          },
          {
            id: "b2", show_date_id: "d1", artist: { name: "Ben O." },
            booking_audit_log: [{ old_status: "soft_booked", new_status: "cancelled" }],
          },
        ],
        error: null,
      },
    });

    const result = await fetchCancelledUntoldDates(asSupabase(fake), { orgId: "org1", today: "2026-07-15" });

    const bookingCall = fake.calls.find((c) => c.table === "bookings" && c.method === "select");
    expect(bookingCall?.args[0]).toContain("booking_audit_log!inner(old_status, new_status)");
    const bookingEqs = fake.calls.filter((c) => c.table === "bookings" && c.method === "eq");
    expect(bookingEqs).toContainEqual({ table: "bookings", method: "eq", args: ["org_id", "org1"] });
    expect(bookingEqs).toContainEqual({ table: "bookings", method: "eq", args: ["status", "cancelled"] });
    expect(bookingEqs).toContainEqual({ table: "bookings", method: "eq", args: ["cancellation_reason", "date_cancelled"] });
    expect(bookingEqs).toContainEqual({ table: "bookings", method: "eq", args: ["booking_audit_log.new_status", "cancelled"] });
    const bookingIns = fake.calls.filter((c) => c.table === "bookings" && c.method === "in");
    expect(bookingIns).toContainEqual({ table: "bookings", method: "in", args: ["show_date_id", ["d1"]] });
    // old_status IN (confirmed, soft_booked) is expressed as .or(), not .in(): the
    // column is on the embedded booking_audit_log table, and PostgREST's .in() can't
    // be scoped to a foreign table the way .eq()/.or() can.
    const bookingOr = fake.calls.find((c) => c.table === "bookings" && c.method === "or");
    expect(bookingOr?.args).toEqual([
      "old_status.eq.confirmed,old_status.eq.soft_booked",
      { foreignTable: "booking_audit_log" },
    ]);

    expect(result).toEqual([
      {
        showDateId: "d1",
        date: "2026-07-20",
        program: "Hamlet",
        subProgram: "Abend",
        venue: "Thalia Theater",
        cancellationReason: "weather",
        castNotifiedAt: null,
        artistNames: ["Anna K.", "Ben O."],
      },
    ]);
  });

  it("returns an empty artistNames list for a cancelled date with no confirmed/soft_booked history (only ever suggested)", async () => {
    const fake = createFakeSupabase({
      show_dates: {
        data: [
          {
            id: "d1", date: "2026-07-20", venue: null, cancellation_reason: null,
            cast_notified_at: null, show: { program: "Hamlet", sub_program: null },
          },
        ],
        error: null,
      },
      bookings: { data: [], error: null }, // the !inner join drops the never-confirmed/soft_booked row
    });
    const result = await fetchCancelledUntoldDates(asSupabase(fake), { orgId: "org1", today: "2026-07-15" });
    expect(result).toEqual([
      {
        showDateId: "d1", date: "2026-07-20", program: "Hamlet", subProgram: null,
        venue: null, cancellationReason: null, castNotifiedAt: null, artistNames: [],
      },
    ]);
  });
});

describe("fetchBouncedAsks", () => {
  it("returns [] and makes no calls when orgId is null", async () => {
    const fake = createFakeSupabase({});
    const result = await fetchBouncedAsks(asSupabase(fake), { orgId: null, today: "2026-07-15" });
    expect(result).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("queries suggested bookings on upcoming dates, org-scoped explicitly", async () => {
    const fake = createFakeSupabase({
      bookings: { data: [], error: null },
    });
    await fetchBouncedAsks(asSupabase(fake), { orgId: "org1", today: "2026-07-15" });

    const bookingEqs = fake.calls.filter((c) => c.table === "bookings" && c.method === "eq");
    expect(bookingEqs).toContainEqual({ table: "bookings", method: "eq", args: ["org_id", "org1"] });
    expect(bookingEqs).toContainEqual({ table: "bookings", method: "eq", args: ["status", "suggested"] });
    const gteCall = fake.calls.find((c) => c.table === "bookings" && c.method === "gte");
    expect(gteCall?.args).toEqual(["show_date.date", "2026-07-15"]);
    // No candidate emails at all: suppressed_emails must never be queried.
    expect(fake.calls.some((c) => c.table === "suppressed_emails")).toBe(false);
  });

  it("joins the candidates' emails to suppressed_emails and only returns the bounced ones", async () => {
    const fake = createFakeSupabase({
      bookings: {
        data: [
          {
            artist_id: "a1", show_date_id: "d1",
            artist: { id: "a1", name: "Anna K.", email: "anna@example.com" },
            show_date: { date: "2026-09-12", show: { program: "Die Zauberflöte", sub_program: null } },
          },
          {
            artist_id: "a2", show_date_id: "d1",
            artist: { id: "a2", name: "Ben O.", email: "ben@example.com" },
            show_date: { date: "2026-09-12", show: { program: "Die Zauberflöte", sub_program: null } },
          },
        ],
        error: null,
      },
      suppressed_emails: {
        data: [{ email: "anna@example.com", created_at: "2026-07-14T09:00:00Z" }],
        error: null,
      },
    });

    const result = await fetchBouncedAsks(asSupabase(fake), { orgId: "org1", today: "2026-07-15" });

    const suppressedCall = fake.calls.find((c) => c.table === "suppressed_emails" && c.method === "in");
    expect(suppressedCall?.args).toEqual(["email", ["anna@example.com", "ben@example.com"]]);

    expect(result).toEqual([
      {
        artistId: "a1",
        artistName: "Anna K.",
        email: "anna@example.com",
        showDateId: "d1",
        dateLabel: "Die Zauberflöte on 12 Sep",
        bouncedAt: "2026-07-14T09:00:00Z",
      },
    ]);
  });

  it("skips a candidate with no email without erroring", async () => {
    const fake = createFakeSupabase({
      bookings: {
        data: [
          {
            artist_id: "a1", show_date_id: "d1",
            artist: { id: "a1", name: "Anna K.", email: null },
            show_date: { date: "2026-09-12", show: { program: "Die Zauberflöte", sub_program: null } },
          },
        ],
        error: null,
      },
    });
    const result = await fetchBouncedAsks(asSupabase(fake), { orgId: "org1", today: "2026-07-15" });
    expect(result).toEqual([]);
    expect(fake.calls.some((c) => c.table === "suppressed_emails")).toBe(false);
  });
});

describe("fetchAtRiskDateFacts", () => {
  it("returns [] and makes no calls when orgId is null or showDateIds is empty", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchAtRiskDateFacts(asSupabase(fake), { orgId: null, showDateIds: ["d1"] })).toEqual([]);
    expect(await fetchAtRiskDateFacts(asSupabase(fake), { orgId: "org1", showDateIds: [] })).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("computes the next-tier cast, free counts and unasked-eligible count for one date", async () => {
    const fake = createFakeSupabase({
      show_dates: {
        data: [{ id: "d1", date: "2026-07-20", show_id: "sh1", city_id: "c1", venue: "Thalia", city: { name: "Hamburg" } }],
        error: null,
      },
      artists: { data: [{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4" }], error: null },
      bookings: { data: [], error: null }, // nobody booked on this date yet
      blocked_dates: { data: [{ date: "2026-07-20", artist_id: "a2" }], error: null },
      // No show-level ladder for (sh1, c1) -> fetchOfferTiers falls back to the
      // org-wide cast_city_priority list; fetchGateCastIds also sees no rows -> gate is unrestricted (null).
      show_cast_eligibility: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
      // Tier 1 is already open; tier 2 is not -> hasUnopenedTier, nextTier = 2.
      show_date_offer_tiers: { data: [{ tier: 1, opened_at: "2026-07-10T00:00:00Z", closed_at: null }], error: null },
      cast_city_priority: [
        // My own next-tier-cast lookup chains .eq("priority", 2) -> matches this entry.
        { when: { priority: 2 }, data: [{ cast_id: "cast2" }] },
        // fetchOfferTiers's org-fallback priorities read chains only .eq("city_id", ...) -> falls through to here.
        { data: [{ priority: 1 }, { priority: 2 }] },
      ],
      casts: { data: [{ id: "cast2", name: "Ensemble Nord" }], error: null },
      cast_members: {
        data: [
          { cast_id: "cast2", artist_id: "a1" },
          { cast_id: "cast2", artist_id: "a2" },
          { cast_id: "cast2", artist_id: "a3" },
        ],
        error: null,
      },
      show_required_skills: { data: [], error: null },
      show_date_required_skills: { data: [], error: null },
      show_date_skill_drops: { data: [], error: null },
    });

    const result = await fetchAtRiskDateFacts(asSupabase(fake), { orgId: "org1", showDateIds: ["d1"] });

    expect(result).toEqual([
      {
        showDateId: "d1",
        where: "Thalia, Hamburg",
        hasUnopenedTier: true,
        unaskedEligibleCount: 4, // unrestricted gate/skills -> whole active roster, none asked yet
        nextCastName: "Ensemble Nord",
        nextCastFreeCount: 2, // a1, a3 free; a2 is blocked on this date
        rosterCount: 4,
        rosterFreeCount: 3, // a2 is blocked, a1/a3/a4 are free
        nextTierNumber: 2, // tier 1 already open, tier 2 is the next one to open
      },
    ]);

    // Org scoping is explicit on every table this reads (ADR-0003).
    for (const table of ["show_dates", "artists", "bookings", "blocked_dates"]) {
      const eqCalls = fake.calls.filter((c) => c.table === table && c.method === "eq");
      expect(eqCalls, `${table} should be org-scoped`).toContainEqual({ table, method: "eq", args: ["org_id", "org1"] });
    }
  });

  it("reports hasUnopenedTier: false when every tier on the ladder is already open", async () => {
    const fake = createFakeSupabase({
      show_dates: {
        data: [{ id: "d1", date: "2026-07-20", show_id: "sh1", city_id: "c1", venue: null, city: null }],
        error: null,
      },
      artists: { data: [], error: null },
      bookings: { data: [], error: null },
      blocked_dates: { data: [], error: null },
      show_cast_eligibility: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
      show_date_offer_tiers: { data: [{ tier: 1, opened_at: "2026-07-10T00:00:00Z", closed_at: null }], error: null },
      cast_city_priority: { data: [{ priority: 1 }], error: null },
      show_required_skills: { data: [], error: null },
      show_date_required_skills: { data: [], error: null },
      show_date_skill_drops: { data: [], error: null },
    });

    const result = await fetchAtRiskDateFacts(asSupabase(fake), { orgId: "org1", showDateIds: ["d1"] });
    expect(result).toEqual([
      {
        showDateId: "d1", where: "", hasUnopenedTier: false, unaskedEligibleCount: 0,
        nextCastName: null, nextCastFreeCount: 0, rosterCount: 0, rosterFreeCount: 0,
        nextTierNumber: null,
      },
    ]);
  });
});

describe("fetchAutopilotFeed", () => {
  it("returns [] and makes no calls when orgId is null", async () => {
    const fake = createFakeSupabase({});
    const result = await fetchAutopilotFeed(asSupabase(fake), { orgId: null, since: "2026-07-14T00:00:00Z" });
    expect(result).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("builds one ask/book/draft/notify row per kind, org-scoped and grouped by date", async () => {
    const since = "2026-07-14T00:00:00Z";
    const fake = createFakeSupabase({
      bookings: {
        // fetchAutopilotFeed's "ask" query (not-null + gte(offered_at), no .in()) sees
        // this whole array; fetchCancelledArtistNamesByDate's later "notify" lookup
        // chains .in("show_date_id", [...]) which the fake auto-filters by, so these
        // ask-shaped rows (show_date_id "d1") never leak into a "d4" notify lookup.
        data: [
          {
            show_date_id: "d1", offer_tier: 1, offered_at: "2026-07-14T07:00:00Z", digest_sent_at: null,
            show_date: { date: "2026-07-20", show: { program: "Hamlet", sub_program: "Abend" } },
          },
          {
            show_date_id: "d1", offer_tier: 1, offered_at: "2026-07-14T07:02:00Z", digest_sent_at: null,
            show_date: { date: "2026-07-20", show: { program: "Hamlet", sub_program: "Abend" } },
          },
        ],
        error: null,
      },
      booking_audit_log: {
        data: [
          {
            id: "audit1", created_at: "2026-07-14T08:00:00Z", old_status: "suggested", new_status: "soft_booked",
            booking: {
              id: "b1", show_date_id: "d2", org_id: "org1", confirmation_digest_sent_at: "2026-07-14T20:00:00Z",
              artist: { name: "Anna K." },
              show_date: { date: "2026-07-21", show: { program: "Faust", sub_program: null } },
            },
          },
        ],
        error: null,
      },
      hire_orders: {
        data: [
          {
            id: "ho1", show_date_id: "d3", created_at: "2026-07-14T09:00:00Z",
            show_date: { date: "2026-07-22", show: { program: "Macbeth", sub_program: null } },
          },
        ],
        error: null,
      },
      show_dates: {
        data: [
          {
            id: "d4", date: "2026-07-19", cast_notified_at: "2026-07-14T10:00:00Z",
            show: { program: "Carmen", sub_program: null },
          },
        ],
        error: null,
      },
    });

    const result = await fetchAutopilotFeed(asSupabase(fake), { orgId: "org1", since });

    const ask = result.find((r) => r.kind === "ask");
    expect(ask).toMatchObject({
      id: "ask:d1:1", kind: "ask",
      text: "Asked 2 artists about Hamlet, Abend, 20 Jul.",
      actedAt: "2026-07-14T07:00:00Z", emailedAt: null,
    });
    expect(ask?.at).toMatch(AT_TIME);

    const book = result.find((r) => r.kind === "book");
    expect(book).toMatchObject({
      id: "book:d2", kind: "book",
      text: "Booked Anna K. onto Faust, 21 Jul. They said yes, so the place is theirs.",
      actedAt: "2026-07-14T08:00:00Z", emailedAt: "2026-07-14T20:00:00Z",
      bookingIds: ["b1"], // findings 2/3: undo must act on exactly these booking ids
    });

    const draft = result.find((r) => r.kind === "draft");
    expect(draft).toMatchObject({
      id: "draft:d3", kind: "draft",
      text: "Drafted 1 contract for Macbeth, 22 Jul. They send when you are happy with them.",
      actedAt: "2026-07-14T09:00:00Z", emailedAt: null,
    });

    const notify = result.find((r) => r.kind === "notify");
    expect(notify).toMatchObject({
      id: "notify:d4", kind: "notify",
      actedAt: "2026-07-14T10:00:00Z", emailedAt: "2026-07-14T10:00:00Z",
    });
    expect(notify?.text).toContain("Carmen, 19 Jul is off");

    // Org scoping: every top-level table this reads carries its own explicit filter —
    // bookings/hire_orders/show_dates via a plain org_id eq, booking_audit_log (which
    // has no org_id column) via the embedded bookings!inner join.
    expect(fake.calls.filter((c) => c.table === "bookings" && c.method === "eq"))
      .toContainEqual({ table: "bookings", method: "eq", args: ["org_id", "org1"] });
    expect(fake.calls.filter((c) => c.table === "hire_orders" && c.method === "eq"))
      .toContainEqual({ table: "hire_orders", method: "eq", args: ["org_id", "org1"] });
    expect(fake.calls.filter((c) => c.table === "show_dates" && c.method === "eq"))
      .toContainEqual({ table: "show_dates", method: "eq", args: ["org_id", "org1"] });
    expect(fake.calls.filter((c) => c.table === "booking_audit_log" && c.method === "eq"))
      .toContainEqual({ table: "booking_audit_log", method: "eq", args: ["booking.org_id", "org1"] });
  });

  // Regression guard for the PGRST201 "ambiguous embed" bug (HTTP 300 Multiple
  // Choices): `hire_orders` has two relationships to `show_dates` (the direct
  // FK and the `hire_order_dates` join table), so an unhinted embed 300s
  // against the real PostgREST schema cache. `supabaseFake` only records calls
  // and never models relationship resolution, so it can't catch that itself —
  // this is a string-level check that the disambiguating `!<fkey>` hint is
  // present in the emitted `select`, not a semantic guarantee the hint is
  // correct against the live schema.
  it("disambiguates the hire_orders -> show_dates embed with an explicit FK hint", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: [], error: null } });
    await fetchAutopilotFeed(asSupabase(fake), { orgId: "org1", since: "2026-07-14T00:00:00Z" });

    const draftSelect = fake.calls.find((c) => c.table === "hire_orders" && c.method === "select");
    expect(draftSelect?.args[0]).toContain("show_date:show_dates!hire_orders_show_date_id_fkey");
  });
});
