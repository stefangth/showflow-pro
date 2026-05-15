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
 * Daily confirmation digest:
 *   Fires hourly (via pg_cron). Checks if Berlin local hour matches
 *   `confirmation_digest_hour_berlin` (default 20). If so, groups all
 *   undigested confirmed bookings by artist and sends one email per artist,
 *   then stamps confirmation_digest_sent_at = now() on the bookings included.
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

  // ── Berlin hour gate ─────────────────────────────────────────────────────
  const { data: hourSetting } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'confirmation_digest_hour_berlin')
    .maybeSingle()
  const targetHour = (hourSetting?.value as number | null) ?? 20

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

  // ── Query confirmed bookings without digest ───────────────────────────────
  const { data: confirmedBookings, error: queryErr } = await admin
    .from('bookings')
    .select(`
      id,
      artist_id,
      artists (
        id,
        user_id,
        profiles (
          display_name,
          email
        )
      ),
      show_dates (
        date,
        shows (
          name
        ),
        cities (
          name
        )
      )
    `)
    .eq('status', 'confirmed')
    .is('confirmation_digest_sent_at', null)

  if (queryErr) {
    console.error('send-confirmation-digest: query error', queryErr)
    return json({ error: queryErr.message }, 500)
  }

  if (!confirmedBookings || confirmedBookings.length === 0) {
    return json({ digests_sent: 0 })
  }

  // ── Group by artist ──────────────────────────────────────────────────────
  type GroupedEntry = {
    recipientEmail: string
    displayName: string
    bookingIds: string[]
    bookings: Array<{ show: string; date: string; city: string }>
  }

  const grouped = new Map<string, GroupedEntry>()

  for (const b of confirmedBookings as any[]) {
    const artistId = b.artist_id
    const profile = b.artists?.profiles
    const recipientEmail = profile?.email
    if (!recipientEmail) continue

    const showDate = b.show_dates
    const show = showDate?.shows?.name ?? 'Unknown show'
    const date = showDate?.date ?? '—'
    const city = showDate?.cities?.name ?? '—'

    if (!grouped.has(artistId)) {
      grouped.set(artistId, {
        recipientEmail,
        displayName: profile?.display_name ?? '',
        bookingIds: [],
        bookings: [],
      })
    }
    const entry = grouped.get(artistId)!
    entry.bookingIds.push(b.id)
    entry.bookings.push({ show, date, city })
  }

  // ── Send one email per artist ─────────────────────────────────────────────
  let digestsSent = 0

  for (const [artistId, entry] of grouped) {
    try {
      await admin.functions.invoke('send-transactional-email', {
        body: {
          template_name: 'artist-confirmation-digest',
          recipient_email: entry.recipientEmail,
          templateData: {
            displayName: entry.displayName,
            bookings: entry.bookings,
          },
          idempotency_key: `confirmation-digest-${artistId}-${new Date().toISOString().slice(0, 13)}`,
        },
      })

      // Stamp confirmation_digest_sent_at on these specific bookings
      const { error: stampErr } = await admin
        .from('bookings')
        .update({ confirmation_digest_sent_at: new Date().toISOString() })
        .in('id', entry.bookingIds)

      if (stampErr) {
        console.error('send-confirmation-digest: failed to stamp confirmation_digest_sent_at', {
          artistId,
          error: stampErr.message,
        })
      }

      digestsSent += 1
    } catch (e) {
      console.error('send-confirmation-digest: email send failed', {
        artistId,
        error: (e as Error).message,
      })
    }
  }

  return json({ digests_sent: digestsSent })
})
