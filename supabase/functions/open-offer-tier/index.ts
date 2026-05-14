import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!

  // Callers may use either a user JWT (admin/producer) or the service role key
  const authHeader = req.headers.get('Authorization') ?? ''
  const isServiceRole = authHeader === `Bearer ${serviceKey}`

  if (!isServiceRole) {
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const token = authHeader.replace('Bearer ', '')
    const { data: claimsData } = await userClient.auth.getClaims(token)
    if (!claimsData?.claims) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', claimsData.claims.sub)
      .in('role', ['admin', 'producer'])
      .maybeSingle()
    if (!roleRow) return json({ error: 'Forbidden — admin or producer required' }, 403)
  }

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

  const admin = createClient(supabaseUrl, serviceKey)

  // Fetch show date
  const { data: showDate, error: sdErr } = await admin
    .from('show_dates')
    .select('id, show_id, city_id, date, status')
    .eq('id', show_date_id)
    .maybeSingle()

  if (sdErr || !showDate) return json({ error: 'Show date not found' }, 404)
  if (showDate.status === 'cancelled') return json({ error: 'Show date is cancelled' }, 400)

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

  // Read offer_response_window_hours from settings (fallback: 48h)
  const { data: expirySetting } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'offer_response_window_hours')
    .maybeSingle()

  const expiryHours = (expirySetting?.value as number | null) ?? 48
  const offeredAt = new Date()
  const offerExpiresAt = new Date(offeredAt.getTime() + expiryHours * 60 * 60 * 1000)

  // Batch insert suggested bookings (idempotent via ignoreDuplicates)
  const toInsert = candidateIds.map((artistId: string) => ({
    show_date_id,
    artist_id: artistId,
    status: 'suggested' as const,
    is_understudy: false,
    offered_at: offeredAt.toISOString(),
    offer_expires_at: offerExpiresAt.toISOString(),
    offer_tier: tier,
  }))

  const { data: inserted, error: insErr } = await admin
    .from('bookings')
    .upsert(toInsert, { onConflict: 'show_date_id,artist_id', ignoreDuplicates: true })
    .select('id')

  if (insErr) {
    console.error('open-offer-tier: insert error', insErr)
    return json({ error: insErr.message }, 500)
  }

  // Upsert show_date_offer_tiers record
  await (admin as any)
    .from('show_date_offer_tiers')
    .upsert(
      { show_date_id, tier, opened_at: offeredAt.toISOString() },
      { onConflict: 'show_date_id,tier', ignoreDuplicates: true }
    )

  const offersCreated = inserted?.length ?? 0
  console.log('open-offer-tier complete', { show_date_id, tier, offersCreated })

  return json({ offers_created: offersCreated })
})
