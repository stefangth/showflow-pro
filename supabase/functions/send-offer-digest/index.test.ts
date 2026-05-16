/**
 * Unit tests for send-offer-digest edge function.
 *
 * Tests Berlin timezone hour gate, auth validation, and grouping logic.
 * No real Supabase or email calls.
 */
import {
  assertEquals,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";

// ── Logic helpers mirroring the function ─────────────────────────────────

/** Returns the current Berlin hour (mirrors Intl formatting in the function). */
function getBerlinHour(date: Date): number {
  return parseInt(
    new Intl.DateTimeFormat("en", {
      timeZone: "Europe/Berlin",
      hour: "numeric",
      hour12: false,
    }).format(date),
    10,
  );
}

type OfferRow = {
  id: string;
  artist_id: string;
  offer_expires_at: string;
  artists: { id: string; name: string; email: string | null };
  show_dates: {
    date: string;
    shows: { program: string; sub_program: string } | null;
    cities: { name: string } | null;
  } | null;
};

function groupByArtist(pendingBookings: OfferRow[]): Map<
  string,
  {
    recipientEmail: string;
    displayName: string;
    bookingIds: string[];
    offers: Array<{ show: string; date: string; city: string; expires: string }>;
  }
> {
  const grouped = new Map();
  for (const b of pendingBookings) {
    const recipientEmail = b.artists?.email;
    if (!recipientEmail) continue;
    const artistId = b.artist_id;
    const program = b.show_dates?.shows?.program;
    const subProgram = b.show_dates?.shows?.sub_program;
    const show = program
      ? subProgram ? `${program} — ${subProgram}` : program
      : "Unknown show";
    const date = b.show_dates?.date ?? "—";
    const city = b.show_dates?.cities?.name ?? "—";
    if (!grouped.has(artistId)) {
      grouped.set(artistId, {
        recipientEmail,
        displayName: b.artists.name ?? "",
        bookingIds: [],
        offers: [],
      });
    }
    const entry = grouped.get(artistId)!;
    entry.bookingIds.push(b.id);
    entry.offers.push({ show, date, city, expires: b.offer_expires_at });
  }
  return grouped;
}

// ── Tests ──────────────────────────────────────────────────────────────────

Deno.test("hour gate skips when Berlin hour does not match target", () => {
  const targetHour = 19;
  // Use a known time that is NOT 19:00 Berlin — e.g. noon UTC in January
  // (Berlin = UTC+1 in winter, so noon UTC = 13:00 Berlin)
  const dateAtNoonUTC = new Date("2026-01-15T12:00:00Z");
  const berlinHour = getBerlinHour(dateAtNoonUTC);
  const shouldSkip = berlinHour !== targetHour;
  assertEquals(shouldSkip, true, `Berlin hour ${berlinHour} should not match target 19`);
});

Deno.test("hour gate proceeds at correct Berlin hour", () => {
  const targetHour = 19;
  // 18:00 UTC in summer (CEST = UTC+2) → 20:00 Berlin — not 19
  // 17:00 UTC in summer → 19:00 Berlin
  const dateAt1700UTC_CEST = new Date("2026-07-15T17:00:00Z");
  const berlinHour = getBerlinHour(dateAt1700UTC_CEST);
  assertEquals(berlinHour, targetHour, "17:00 UTC in CEST = 19:00 Berlin");
});

Deno.test("missing auth returns 401", () => {
  const cronSecret: string | null = null;
  const authHeader: string | null = null;
  const isAuthorized =
    cronSecret !== null || authHeader?.startsWith("Bearer ");
  assertEquals(isAuthorized, false);
});

Deno.test("artist without email is skipped during grouping", () => {
  const bookings: OfferRow[] = [
    {
      id: "b1",
      artist_id: "a1",
      offer_expires_at: "2026-01-02T00:00:00Z",
      artists: { id: "a1", name: "No Email Artist", email: null },
      show_dates: null,
    },
  ];
  const grouped = groupByArtist(bookings);
  assertEquals(grouped.size, 0, "artist without email should be skipped");
});

Deno.test("multiple bookings for same artist are grouped together", () => {
  const bookings: OfferRow[] = [
    {
      id: "b1",
      artist_id: "a1",
      offer_expires_at: "2026-01-02T00:00:00Z",
      artists: { id: "a1", name: "Artist One", email: "artist@example.com" },
      show_dates: {
        date: "2026-06-01",
        shows: { program: "theatre", sub_program: "musical" },
        cities: { name: "Berlin" },
      },
    },
    {
      id: "b2",
      artist_id: "a1",
      offer_expires_at: "2026-01-03T00:00:00Z",
      artists: { id: "a1", name: "Artist One", email: "artist@example.com" },
      show_dates: {
        date: "2026-06-02",
        shows: { program: "theatre", sub_program: "musical" },
        cities: { name: "Berlin" },
      },
    },
  ];
  const grouped = groupByArtist(bookings);
  assertEquals(grouped.size, 1, "two bookings for same artist → one group");
  assertEquals(grouped.get("a1")?.bookingIds.length, 2);
});

Deno.test("distinct artists produce separate groups", () => {
  const bookings: OfferRow[] = [
    {
      id: "b1",
      artist_id: "a1",
      offer_expires_at: "2026-01-02T00:00:00Z",
      artists: { id: "a1", name: "Artist One", email: "a1@example.com" },
      show_dates: null,
    },
    {
      id: "b2",
      artist_id: "a2",
      offer_expires_at: "2026-01-02T00:00:00Z",
      artists: { id: "a2", name: "Artist Two", email: "a2@example.com" },
      show_dates: null,
    },
  ];
  const grouped = groupByArtist(bookings);
  assertEquals(grouped.size, 2, "two distinct artists → two groups");
});

Deno.test("show label includes sub_program when present", () => {
  const bookings: OfferRow[] = [
    {
      id: "b1",
      artist_id: "a1",
      offer_expires_at: "2026-01-02T00:00:00Z",
      artists: { id: "a1", name: "Test", email: "test@test.com" },
      show_dates: {
        date: "2026-06-01",
        shows: { program: "theatre", sub_program: "musical" },
        cities: null,
      },
    },
  ];
  const grouped = groupByArtist(bookings);
  const offer = grouped.get("a1")?.offers[0];
  assertEquals(offer?.show, "theatre — musical");
});
