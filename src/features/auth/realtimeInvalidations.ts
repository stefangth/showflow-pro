/**
 * Realtime table → query-key invalidations. Keys are prefix-matched by React Query,
 * so a top-level key (e.g. ['shows']) busts every sub-key under it (['shows','list',id], …).
 * Every listed prefix MUST correspond to a real `useQuery` key somewhere in src — a typo'd
 * or renamed key silently no-ops and breaks cross-client propagation. Exported for testing.
 */
export const REALTIME_INVALIDATIONS: Array<{ table: string; keys: unknown[][] }> = [
  // ['hire-orders'] on bookings + show_dates keeps the hire-order readiness query
  // (['hire-orders','ready',org] — the bookings banner + per-row CTA/chip) fresh
  // when a booking confirm/cancel flips a date's fully_filled status.
  // ['tier-ladder'] keeps the Offers cockpit's per-tier headcounts (useTierLadderCounts)
  // fresh — an offer/booking/response changes who still matches a tier.
  { table: 'bookings',                   keys: [['bookings'], ['hire-orders'], ['tier-ladder']] },
  { table: 'show_dates',                 keys: [['show-dates'], ['dashboard-upcoming-dates'], ['artist-eligible-dates'], ['hire-orders'], ['eligibility']] },
  { table: 'hire_orders',                keys: [['hire-orders']] },
  { table: 'show_date_cast_eligibility', keys: [['show-date-cast-eligibility'], ['eligible-artists'], ['artist-eligible-dates']] },
  { table: 'show_cast_eligibility',      keys: [['cast-eligibility'], ['eligible-artists'], ['artist-eligible-dates'], ['eligibility']] },
  // Booking-setup ladder-coverage query (['eligibility','ladder-coverage',org], the setup
  // rail's Eligibility step) and the Casts & Cities org-wide priority editor both read this table.
  { table: 'cast_city_priority',         keys: [['cast-city-priority'], ['eligibility']] },
  { table: 'cast_members',              keys: [['cast-members'], ['artist-casts'], ['my-cast-memberships'], ['cast-members-counts'], ['eligible-artists'], ['artist-eligible-dates']] }, // cast membership drives both eligibility queries
  { table: 'artists',                    keys: [['artists'], ['my-artist']] },
  { table: 'shows',                      keys: [['shows'], ['shows-for-eligibility'], ['shows-program-sub-programs']] },
  { table: 'casts',                      keys: [['casts']] },
  { table: 'cities',                     keys: [['cities']] },
  { table: 'app_settings',               keys: [['app-settings']] },
  { table: 'org_entitlements',           keys: [['entitlements']] },
  { table: 'profiles',                   keys: [['chat-author-profiles']] },
  { table: 'chat_messages',              keys: [['chat-messages']] },
  { table: 'chats',                      keys: [['chat'], ['my-chats']] },
  { table: 'booking_audit_log',          keys: [['admin-audit']] },
  { table: 'airtable_sync_log',          keys: [['admin-sync']] },
  // blocked_dates and show_date_required_skills both feed fetchTierLadderCounts'
  // waterfall (blocked exclusion, required-skill match); a change on another
  // client must refresh both the existing eligibility consumers and the ladder.
  { table: 'blocked_dates',              keys: [['blocked-dates'], ['tier-ladder']] },
  { table: 'show_date_required_skills',  keys: [['eligibility'], ['tier-ladder']] },
];
