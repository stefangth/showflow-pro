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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

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
    if (!roleRow) return json({ error: 'Forbidden' }, 403)
  }

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

  const { data: confirmedBookings, error: queryErr } = await admin
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
    .eq('status', 'confirmed')
    .is('confirmation_digest_sent_at', null)

  if (queryErr) {
    console.error('send-confirmation-digest: query error', queryErr)
    return json({ error: queryErr.message }, 500)
  }

  if (!confirmedBookings || confirmedBookings.length === 0) {
    return json({ digests_sent: 0 })
  }

  type GroupedEntry = {
    recipientEmail: string
    displayName: string
    bookingIds: string[]
    bookings: Array<{ show: string; date: string; city: string }>
  }

  const grouped = new Map<string, GroupedEntry>()

  for (const b of confirmedBookings as any[]) {
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

    if (!grouped.has(artistId)) {
      grouped.set(artistId, {
        recipientEmail,
        displayName: artist?.name ?? '',
        bookingIds: [],
        bookings: [],
      })
    }
    const entry = grouped.get(artistId)!
    entry.bookingIds.push(b.id)
    entry.bookings.push({ show, date, city })
  }

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

      const { error: stampErr } = await admin
        .from('bookings')
        .update({ confirmation_digest_sent_at: new Date().toISOString() })
        .in('id', entry.bookingIds)

      if (stampErr) {
        console.error('send-confirmation-digest: failed to stamp', { artistId, error: stampErr.message })
      }

      digestsSent += 1
    } catch (e) {
      console.error('send-confirmation-digest: email send failed', { artistId, error: (e as Error).message })
    }
  }

  return json({ digests_sent: digestsSent })
})
