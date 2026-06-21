import { preflight, json } from "../_shared/http.ts";
import { isServiceRole, requireOrgRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const admin = deps.admin;

  let show_date_id: string
  let tier: number
  try {
    const body = await req.json()
    show_date_id = body.show_date_id
    tier = Number(body.tier)
    if (!show_date_id || !tier || tier < 1) {
      return json({ error: 'show_date_id and tier (≥1) are required' }, 400)
    }
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  // Fetch show date (org_id drives the org-scoped auth check below).
  const { data: showDate, error: sdErr } = await admin
    .from('show_dates')
    .select('id, show_id, city_id, date, status, session_1, session_2, session_3, org_id')
    .eq('id', show_date_id)
    .maybeSingle()

  if (sdErr || !showDate) return json({ error: 'Show date not found' }, 404)

  // Org-scoped authorization: an admin/producer may only open offers for a date in
  // their OWN org. Service-role (cron / airtable-poll) bypasses; requireOrgRole also
  // accepts super-admins.
  if (!isServiceRole(deps, req)) {
    const auth = await requireOrgRole(deps, req, showDate.org_id, ["admin", "producer"])
    if (!auth.ok) return auth.response
  }

  if (showDate.status === 'cancelled') return json({ error: 'Show date is cancelled' }, 400)

  if (!showDate.session_1 && !showDate.session_2 && !showDate.session_3) {
    // ≥1-session rule: a times-TBD date is not yet bookable. Benign skip (200, not
    // 400) so airtable-poll's batch caller does not log a false "offer-tier failed".
    return json({ offers_created: 0, message: 'Show date has no sessions yet — offers not opened' })
  }

  // Resolve eligible cast IDs for this tier
  let eligibleCastIds: string[]

  if (tier === 99) {
    // Tier 99: ad-hoc casts added via show_date_cast_eligibility
    // that have no cast_city_priority entry for this city
    const { data: dateCasts } = await admin
      .from('show_date_cast_eligibility')
      .select('cast_id')
      .eq('show_date_id', show_date_id)

    if (!dateCasts || dateCasts.length === 0) {
      return json({ offers_created: 0, message: 'No ad-hoc casts for this date' })
    }

    // Filter out casts that are already in the priority system for this city
    if (showDate.city_id) {
      const castIds = dateCasts.map((r: any) => r.cast_id)
      const { data: priorityRows } = await (admin as any)
        .from('cast_city_priority')
        .select('cast_id')
        .eq('city_id', showDate.city_id)
        .in('cast_id', castIds)

      const prioritizedCastIds = new Set((priorityRows ?? []).map((r: any) => r.cast_id))
      eligibleCastIds = castIds.filter((id: string) => !prioritizedCastIds.has(id))
    } else {
      eligibleCastIds = dateCasts.map((r: any) => r.cast_id)
    }
  } else {
    // Tier 1-N: find casts with this priority for the date's city
    if (!showDate.city_id) {
      return json({ offers_created: 0, message: 'Show date has no city — cannot resolve priority casts' })
    }

    const { data: priorityRows } = await (admin as any)
      .from('cast_city_priority')
      .select('cast_id')
      .eq('city_id', showDate.city_id)
      .eq('priority', tier)

    eligibleCastIds = (priorityRows ?? []).map((r: any) => r.cast_id)

    if (eligibleCastIds.length === 0) {
      return json({ offers_created: 0, message: `No casts configured at tier ${tier} for this city` })
    }
  }

  if (eligibleCastIds.length === 0) {
    return json({ offers_created: 0, message: 'No eligible casts for this tier' })
  }

  // Get all active artists in eligible casts
  const { data: castMemberRows } = await admin
    .from('cast_members')
    .select('artist_id')
    .in('cast_id', eligibleCastIds)

  const artistIds = [...new Set((castMemberRows ?? []).map((r: any) => r.artist_id))]
  if (artistIds.length === 0) {
    return json({ offers_created: 0, message: 'No artists in eligible casts' })
  }

  // Fetch artist active status
  const { data: artistRows } = await admin
    .from('artists')
    .select('id')
    .in('id', artistIds)
    .eq('status', 'active')

  const activeArtistIds = (artistRows ?? []).map((r: any) => r.id)
  if (activeArtistIds.length === 0) {
    return json({ offers_created: 0, message: 'No active artists in eligible casts' })
  }

  // Skip artists with an existing open offer or non-cancelled booking for this date
  const { data: existingBookings } = await admin
    .from('bookings')
    .select('artist_id')
    .eq('show_date_id', show_date_id)
    .neq('status', 'cancelled')

  const alreadyBookedIds = new Set((existingBookings ?? []).map((b: any) => b.artist_id))

  // Skip artists with a blocked_dates entry for this date (table added in Task 5)
  let blockedArtistIds = new Set<string>()
  try {
    const { data: blockedRows } = await (admin as any)
      .from('blocked_dates')
      .select('artist_id')
      .eq('date', showDate.date)
      .in('artist_id', activeArtistIds)
    blockedArtistIds = new Set((blockedRows ?? []).map((r: any) => r.artist_id))
  } catch {
    // blocked_dates table may not exist yet — skip silently
  }

  const candidateIds = activeArtistIds.filter(
    (id: string) => !alreadyBookedIds.has(id) && !blockedArtistIds.has(id)
  )

  if (candidateIds.length === 0) {
    return json({ offers_created: 0, message: 'All eligible artists already have offers or are blocked' })
  }

  const offeredAt = deps.now()

  // Batch insert suggested bookings. Pre-filtering (alreadyBookedIds /
  // blockedArtistIds) handles deduplication — bookings has no UNIQUE
  // (show_date_id, artist_id) constraint, so an ON CONFLICT upsert here
  // would fail Postgres parse-time validation.
  //
  // offer_expires_at is intentionally omitted here: the expiry window
  // starts from when the artist is notified via the offer digest email,
  // not from offer creation. send-offer-digest sets offer_expires_at when
  // it stamps digest_sent_at.
  const toInsert = candidateIds.map((artistId: string) => ({
    show_date_id,
    artist_id: artistId,
    status: 'suggested' as const,
    is_understudy: false,
    offered_at: offeredAt.toISOString(),
    offer_tier: tier,
  }))

  const { data: inserted, error: insErr } = await admin
    .from('bookings')
    .insert(toInsert)
    .select('id')

  if (insErr) {
    console.error('open-offer-tier: insert error', insErr)
    return json({ error: insErr.message }, 500)
  }

  // show_date_offer_tiers has a UNIQUE (show_date_id, tier) constraint. A MERGE
  // upsert (no ignoreDuplicates) re-activates a tier that was previously closed:
  // clears closed_at, refreshes opened_at, and resets escalation so the new
  // round can escalate again. (close-offer-tier sets closed_at.)
  const { error: tierErr } = await (admin as any)
    .from('show_date_offer_tiers')
    .upsert(
      {
        show_date_id,
        tier,
        opened_at: offeredAt.toISOString(),
        closed_at: null,
        escalation_notified_at: null,
      },
      { onConflict: 'show_date_id,tier' }
    )
  // The tier row is now load-bearing for re-open (it clears closed_at) and is
  // what expire-offers / tier-at-risk-watcher filter on. The bookings were
  // already inserted, so don't fail the request — but if tracking failed, log it
  // AND signal the caller so the producer knows escalation/at-risk may be broken
  // for this round (re-opening the tier recovers it).
  if (tierErr) console.error('open-offer-tier: tier upsert error', tierErr)

  const offersCreated = inserted?.length ?? 0
  console.log('open-offer-tier complete', { show_date_id, tier, offersCreated, tierTracked: !tierErr })

  return json({ offers_created: offersCreated, ...(tierErr ? { tier_tracking_warning: true } : {}) })
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
