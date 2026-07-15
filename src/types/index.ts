import type { Database } from '@/integrations/supabase/types';

// Table row types
export type Show = Database['public']['Tables']['shows']['Row'];
export type ShowInsert = Database['public']['Tables']['shows']['Insert'];
export type ShowDate = Database['public']['Tables']['show_dates']['Row'];
export type ShowDateInsert = Database['public']['Tables']['show_dates']['Insert'];
export type Artist = Database['public']['Tables']['artists']['Row'];
export type ArtistInsert = Database['public']['Tables']['artists']['Insert'];
export type Booking = Database['public']['Tables']['bookings']['Row'];
export type BookingInsert = Database['public']['Tables']['bookings']['Insert'];
export type BookingAuditLog = Database['public']['Tables']['booking_audit_log']['Row'];
export type Notification = Database['public']['Tables']['notifications']['Row'];
export type Profile = Database['public']['Tables']['profiles']['Row'];
export type AirtableSyncLog = Database['public']['Tables']['airtable_sync_log']['Row'];
export type City = Database['public']['Tables']['cities']['Row'];
export type Cast = Database['public']['Tables']['casts']['Row'];
export type CastMember = Database['public']['Tables']['cast_members']['Row'];
export type ShowCastEligibility = Database['public']['Tables']['show_cast_eligibility']['Row'];
export type ShowDateCastEligibility = Database['public']['Tables']['show_date_cast_eligibility']['Row'];
export type Chat = Database['public']['Tables']['chats']['Row'];
export type ChatMessage = Database['public']['Tables']['chat_messages']['Row'];

// Enum types
export type ShowStatus = Database['public']['Enums']['show_status'];
export type ArtistStatus = Database['public']['Enums']['artist_status'];
export type AvailabilityStatus = Database['public']['Enums']['availability_status'];
export type BookingStatus = Database['public']['Enums']['booking_status'];
export type ShowDateStatus = Database['public']['Enums']['show_date_status'];
export type AppRole = Database['public']['Enums']['app_role'];

// Extended types for UI
export interface ShowWithDates extends Show {
  show_dates: ShowDate[];
}

export interface BookingWithDetails extends Booking {
  artist: Artist;
  show_date: ShowDate & { show: Show };
}

export interface ShowDateWithBookings extends ShowDate {
  bookings: (Booking & { artist: Artist })[];
  show: Show;
}

/**
 * The show's own program · sub_program identity label. Internal helper for
 * CATALOG surfaces — production lists, the show picker, cast-eligibility headers,
 * Airtable catalog linking — and as a deterministic sort key. These need the raw
 * program/sub_program identity of a *catalog show*, which must not collapse to a
 * single program or custom value (it would lose disambiguation and reorder lists
 * unpredictably). For a *booking / show_date* display, use `referenceLabel`
 * (src/lib/bookingFlow.ts), which honors the org's configured reference field.
 */
export function showIdentityLabel(
  show: { program: string | null; sub_program: string | null } | null | undefined
): string {
  return [show?.program, show?.sub_program].filter(Boolean).join(' · ') || 'Untitled show';
}
