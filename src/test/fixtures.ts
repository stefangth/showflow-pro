import type { Database } from "@/integrations/supabase/types";

type ArtistRow = Database["public"]["Tables"]["artists"]["Row"];
type ShowDateRow = Database["public"]["Tables"]["show_dates"]["Row"];
type BookingRow = Database["public"]["Tables"]["bookings"]["Row"];
type OrgRow = Database["public"]["Tables"]["organizations"]["Row"];
type MembershipRow = Database["public"]["Tables"]["org_memberships"]["Row"];

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
    cast_role: null,
    status: "active",
    org_id: id("org"),
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
    duration_minutes: null,
    venue: null,
    notes: null,
    cancellation_reason: null,
    cast_notified_at: null,
    airtable_record_id: null,
    source: null,
    custom: {},
    org_id: id("org"),
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
    fee_amount: null,
    booked_by: null,
    notes: null,
    cancellation_reason: null,
    cancelled_at: null,
    confirmed_at: null,
    offer_tier: null,
    offered_at: null,
    offer_expires_at: null,
    reminder_sent_at: null,
    digest_sent_at: null,
    confirmation_digest_sent_at: null,
    org_id: id("org"),
    created_at: ISO,
    updated_at: ISO,
    ...overrides,
  };
}

export function anOrganization(overrides: Partial<OrgRow> = {}): OrgRow {
  return {
    id: id("org"),
    name: "Test Org",
    slug: id("slug"),
    status: "active",
    is_demo: false,
    created_by: null,
    org_kind: "production",
    org_kind_set_at: null,
    created_at: ISO,
    updated_at: ISO,
    ...overrides,
  };
}

export function aMembership(overrides: Partial<MembershipRow> = {}): MembershipRow {
  return {
    id: id("mem"),
    org_id: id("org"),
    user_id: id("user"),
    role: "producer",
    created_at: ISO,
    ...overrides,
  };
}
