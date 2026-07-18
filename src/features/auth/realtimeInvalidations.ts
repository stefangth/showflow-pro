/**
 * Realtime table → query-key invalidations. Keys are prefix-matched by React Query,
 * so a top-level key (e.g. ['shows']) busts every sub-key under it (['shows','list',id], …).
 * Every listed prefix MUST correspond to a real `useQuery` key somewhere in src — a typo'd
 * or renamed key silently no-ops and breaks cross-client propagation. Exported for testing.
 */
export const REALTIME_INVALIDATIONS: Array<{ table: string; keys: unknown[][] }> = [
  { table: 'bookings',                   keys: [['bookings']] },
  { table: 'show_dates',                 keys: [['show-dates'], ['dashboard-upcoming-dates'], ['artist-eligible-dates']] },
  { table: 'show_date_cast_eligibility', keys: [['show-date-cast-eligibility'], ['eligible-artists'], ['artist-eligible-dates']] },
  { table: 'show_cast_eligibility',      keys: [['cast-eligibility'], ['eligible-artists'], ['artist-eligible-dates']] },
  { table: 'cast_members',              keys: [['cast-members'], ['artist-casts'], ['my-cast-memberships'], ['cast-members-counts'], ['eligible-artists'], ['artist-eligible-dates']] }, // cast membership drives both eligibility queries
  { table: 'artists',                    keys: [['artists'], ['my-artist']] },
  { table: 'shows',                      keys: [['shows'], ['shows-for-eligibility'], ['shows-program-sub-programs']] },
  { table: 'casts',                      keys: [['casts']] },
  { table: 'cities',                     keys: [['cities']] },
  { table: 'app_settings',               keys: [['app-settings']] },
  { table: 'profiles',                   keys: [['chat-author-profiles']] },
  { table: 'chat_messages',              keys: [['chat-messages']] },
  { table: 'chats',                      keys: [['chat'], ['my-chats']] },
  { table: 'booking_audit_log',          keys: [['admin-audit']] },
  { table: 'airtable_sync_log',          keys: [['admin-sync']] },
];
