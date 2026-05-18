import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Daily offer digest:
 *   Fires hourly (via pg_cron). Checks if Berlin local hour matches
 *   `offer_digest_hour_berlin` (default 19). If so, groups all undigested
 *   suggested bookings by artist and sends one email per artist, then stamps
 *   digest_sent_at = now() on the bookings included.
 *
 * Auth: X-Cron-Secret header (pg_cron), or user JWT (admin/producer manual trigger).
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  // ── Auth: X-Cron-Secret or user JWT ──────────────────────────────────────
  const cronSecret = req.headers.get('X-Cron-Secret')
  if (cronSecret) {
    const { data: secretSetting } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'cron_secret')
      .maybeSingle()
    const storedSecret = (secretSetting?.value as string | null) ?? ''
    if (cronSecret !== storedSecret) return json({ error: 'Unauthorized' }, 401)
  } else {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['admin', 'producer'])
      .maybeSingle()
    if (!roleRow) return json({ error: 'Forbidden — admin or producer required' }, 403)
  }

  // ── Offer window setting ─────────────────────────────────────────────────
  // Read once; used to stamp offer_expires_at when the digest is sent.
  const { data: expirySetting } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'offer_response_window_hours')
    .maybeSingle()
  const offerWindowHours = typeof expirySetting?.value === 'number' ? expirySetting.value : 48

  // ── Berlin hour gate ─────────────────────────────────────────────────────
  const { data: hourSetting } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'offer_digest_hour_berlin')
    .maybeSingle()
  const targetHour = typeof hourSetting?.value === 'number' ? hourSetting.value : 19

  const berlinHour = parseInt(
    new Intl.DateTimeFormat('en', {
      timeZone: 'Europe/Berlin',
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
    10,
  )

  if (berlinHour !== targetHour) {
    return json({ skipped: true, reason: `Berlin hour is ${berlinHour}, target is ${targetHour}` })
  }

  // ── Query pending offers ─────────────────────────────────────────────────
  // Artist email + display name live on the `artists` row (not `profiles`);
  // shows uses `program`/`sub_program` (no `name` column).
  //
  // offer_expires_at is null on newly created offers (expiry is set here
  // when the digest is sent, not at offer creation). Include both null-expiry
  // offers and any that still have time remaining.
  const now = new Date()
  const offerExpiresAt = new Date(now.getTime() + offerWindowHours * 60 * 60 * 1000)

  const { data: pendingBookings, error: queryErr } = await admin
    .from('bookings')
    .select(`
      id,
      artist_id,
      artists ( id, name, email ),
      show_dates (
        date,
        shows ( program, sub_program ),
        cities ( name )
      )
    `)
    .eq('status', 'suggested')
    .is('digest_sent_at', null)
    .or(`offer_expires_at.is.null,offer_expires_at.gt.${now.toISOString()}`)

  if (queryErr) {
    console.error('send-offer-digest: query error', queryErr)
    return json({ error: queryErr.message }, 500)
  }

  if (!pendingBookings || pendingBookings.length === 0) {
    return json({ digests_sent: 0 })
  }

  // ── Group by artist ──────────────────────────────────────────────────────
  type GroupedEntry = {
    recipientEmail: string
    displayName: string
    bookingIds: string[]
    offers: Array<{ show: string; date: string; city: string; expires: string }>
  }

  const grouped = new Map<string, GroupedEntry>()

  // Format the expiry time once — same for all offers in this digest run.
  const expiresDisplay = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(offerExpiresAt)

  for (const b of pendingBookings as any[]) {
    const artistId = b.artist_id
    const artist = b.artists
    const recipientEmail = artist?.email
    if (!recipientEmail) continue

    const showDate = b.show_dates
    const program = showDate?.shows?.program
    const subProgram = showDate?.shows?.sub_program
    const show = program ? (subProgram ? `${program} — ${subProgram}` : program) : 'Unknown show'
    const date = showDate?.date ?? '—'
    const city = showDate?.cities?.name ?? '—'
    const expires = expiresDisplay

    if (!grouped.has(artistId)) {
      grouped.set(artistId, {
        recipientEmail,
        displayName: artist?.name ?? '',
        bookingIds: [],
        offers: [],
      })
    }
    const entry = grouped.get(artistId)!
    entry.bookingIds.push(b.id)
    entry.offers.push({ show, date, city, expires })
  }

  // ── Send one email per artist ─────────────────────────────────────────────
  let digestsSent = 0

  for (const [artistId, entry] of grouped) {
    try {
      await admin.functions.invoke('send-transactional-email', {
        body: {
          template_name: 'artist-offer-digest',
          recipient_email: entry.recipientEmail,
          templateData: {
            displayName: entry.displayName,
            offers: entry.offers,
          },
          idempotency_key: `offer-digest-${artistId}-${new Date().toISOString().slice(0, 13)}`,
        },
      })

      // Stamp digest_sent_at and set offer_expires_at on these bookings.
      // The expiry window starts from digest send time, not offer creation.
      const { error: stampErr } = await admin
        .from('bookings')
        .update({
          digest_sent_at: now.toISOString(),
          offer_expires_at: offerExpiresAt.toISOString(),
        })
        .in('id', entry.bookingIds)

      if (stampErr) {
        console.error('send-offer-digest: failed to stamp digest_sent_at', { artistId, error: stampErr.message })
      }

      digestsSent += 1
    } catch (e) {
      console.error('send-offer-digest: email send failed', { artistId, error: (e as Error).message })
    }
  }

  return json({ digests_sent: digestsSent })
})
