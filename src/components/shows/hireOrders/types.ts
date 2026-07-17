/** The subset of the show-date detail record the hire-orders surface reads.
 *  Structurally satisfied by the (loosely typed) `showDate` the detail sheet
 *  already loads, so no extra columns need to be selected there. */
export interface HireOrderShowDate {
  id: string;
  date: string;
  venue?: string | null;
  duration_minutes?: number | null;
  /** `show_date_status` — only `fully_filled` changes the banner copy. */
  status?: string | null;
  show?: { program?: string | null; sub_program?: string | null } | null;
  city?: { name?: string | null } | null;
}

/** A booking as the detail sheet holds it (active + joined artist). */
export interface HireOrderBooking {
  id: string;
  status: string;
  artist?: { id: string; name: string } | null;
}
