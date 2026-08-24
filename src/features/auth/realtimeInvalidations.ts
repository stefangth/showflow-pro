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
  { table: 'cast_members',              keys: [['cast-members'], ['artist-casts'], ['my-cast-memberships'], ['cast-members-counts'], ['cast-roster-counts'], ['eligible-artists'], ['artist-eligible-dates']] }, // cast membership drives both eligibility queries
  // An artist's status decides whether their cast membership counts toward coverage
  // (fetchCastMemberCounts / fetchLadderCoverageInputs filter to status = 'active'), so
  // deactivating an artist has to bust those reads too, not just the artist lists.
  { table: 'artists',                    keys: [['artists'], ['my-artist'], ['cast-members-counts'], ['eligibility']] },
  { table: 'shows',                      keys: [['shows'], ['shows-for-eligibility'], ['shows-program-sub-programs']] },
  { table: 'casts',                      keys: [['casts']] },
  { table: 'cities',                     keys: [['cities']] },
  { table: 'app_settings',               keys: [['app-settings']] },
  { table: 'org_entitlements',           keys: [['entitlements']] },
  { table: 'profiles',                   keys: [['chat-author-profiles']] },
  { table: 'chat_messages',              keys: [['chat-messages']] },
  { table: 'chats',                      keys: [['chat'], ['my-chats']] },
  { table: 'booking_audit_log',          keys: [['admin-audit']] },
  // blocked_dates and show_date_required_skills both feed fetchTierLadderCounts'
  // waterfall (blocked exclusion, required-skill match). Both were added to the
  // supabase_realtime publication in 20260812190100, so cross-client refresh for
  // both rows is live.
  { table: 'blocked_dates',              keys: [['blocked-dates'], ['tier-ladder']] },
  { table: 'show_date_required_skills',  keys: [['eligibility'], ['tier-ladder']] },
  // A drop subtracts from the effective required-skill union (fetchRequiredSkillIds),
  // which fetchTierLadderCounts reads — same rationale as show_date_required_skills above.
  { table: 'show_date_skill_drops',      keys: [['eligibility'], ['tier-ladder']] },
];
