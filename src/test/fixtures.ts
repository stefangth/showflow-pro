import type { Database } from "@/integrations/supabase/types";

type ArtistRow = Database["public"]["Tables"]["artists"]["Row"];
type ShowDateRow = Database["public"]["Tables"]["show_dates"]["Row"];
type BookingRow = Database["public"]["Tables"]["bookings"]["Row"];

let seq = 0;
/** Deterministic-but-unique id generator (no Math.random / Date in fixtures). */
function id(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq.toString().padStart(8, "0")}`;
}
const ISO = "2026-01-01T00:00:00.000Z";

export function anArtist(overrides: Partial<ArtistRow> = {}): ArtistRow {
  return {
    id: id("artist"),
    name: "Test Artist",
    email: "artist@example.com",
    phone: null,
    bio: null,
    status: "active",
    user_id: id("user"),
    created_at: ISO,
    updated_at: ISO,
    ...overrides,
  };
}

export function aShowDate(overrides: Partial<ShowDateRow> = {}): ShowDateRow {
  return {
    id: id("show-date"),
    show_id: id("show"),
    city_id: id("city"),
    date: "2026-02-01",
    session_1: "19:00",
    session_2: null,
    session_3: null,
    venue: null,
    notes: null,
    airtable_record_id: null,
    status: "open",
    created_at: ISO,
    updated_at: ISO,
    ...overrides,
  };
}

export function aBooking(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: id("booking"),
    show_date_id: id("show-date"),
    artist_id: id("artist"),
    status: "suggested",
    is_understudy: false,
    booked_by: null,
    notes: null,
    cancellation_reason: null,
    cancelled_at: null,
    confirmed_at: null,
    created_at: ISO,
    updated_at: ISO,
    ...overrides,
  };
}
