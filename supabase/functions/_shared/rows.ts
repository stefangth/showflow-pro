/** Joined-row shapes shared by the booking-engine crons and webhooks.
 *  Fields mirror the select strings at the call sites — if you change a
 *  select, change the interface in the same commit. */
export interface ShowJoin {
  program: string | null
  sub_program: string | null
  main_cast_slots: number | null
  understudy_slots: number | null
}
export interface ShowDateWithShow {
  id: string
  show_id: string
  date: string
  city_id: string | null
  org_id: string
  show: ShowJoin | null
}
export interface ProducerAssignmentRow { producer_user_id: string }
export interface OrgAdminRow { user_id: string }
export interface ArtistJoin {
  id: string
  name: string | null
  email: string | null
  user_id: string | null
}
export interface DueBookingRow {
  id: string
  artist_id: string
  offer_expires_at: string | null
  artists: ArtistJoin | null
  show_dates: {
    date: string
    custom: Record<string, unknown> | null
    show_id: string
    city_id: string | null
    shows: { program: string | null; sub_program: string | null } | null
  } | null
}
