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

/** Max concurrent open-offer-tier invocations per batch to avoid exhausting the DB connection pool. */
const OFFER_TIER_BATCH_SIZE = 10

/**
 * Polls Airtable for show date records, upserts into show_dates,
 * and calls open-offer-tier (tier 1) for each newly inserted date.
 *
 * Reads from app_settings:
 *   - airtable_sync_enabled (bool)
 *   - airtable_base_id
 *   - airtable_table_name
 *
 * Reads AIRTABLE_API_KEY from Deno.env (Supabase secret).
 *
 * Auth: X-Cron-Secret header (pg_cron). Cron-only — no user JWT.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  // ── Auth: X-Cron-Secret ──────────────────────────────────────────────────
  const cronSecretHeader = req.headers.get('X-Cron-Secret')
  if (!cronSecretHeader) return json({ error: 'Unauthorized' }, 401)

  const { data: secretSetting } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'cron_secret')
    .maybeSingle()
  const storedSecret = (secretSetting?.value as string | null) ?? ''
  if (cronSecretHeader !== storedSecret) return json({ error: 'Unauthorized' }, 401)

  // ── Read app_settings ─────────────────────────────────────────────────────
  const { data: settingsRows } = await admin
    .from('app_settings')
    .select('key, value')
    .in('key', ['airtable_sync_enabled', 'airtable_base_id', 'airtable_table_name'])

  const settings: Record<string, any> = {}
  for (const row of settingsRows ?? []) {
    settings[row.key] = row.value
  }

  const syncEnabled = Boolean(settings['airtable_sync_enabled'])
  if (!syncEnabled) {
    return json({ skipped: true, reason: 'sync disabled' })
  }

  const baseId = (settings['airtable_base_id'] as string | null) ?? ''
  const tableName = (settings['airtable_table_name'] as string | null) ?? ''

  if (!baseId || !tableName) {
    return json({ skipped: true, reason: 'airtable_base_id or airtable_table_name not configured' })
  }

  // Airtable base IDs start with "app" followed by at least 10 alphanumeric chars.
  // Exact length varies (17–18 chars observed), so we use a minimum rather than exact match.
  if (!/^app[A-Za-z0-9]{10,}$/.test(baseId)) {
    return json({ error: 'airtable_base_id has unexpected format; expected appXXXXXXXXXXXXXX' }, 500)
  }

  const airtableApiKey = Deno.env.get('AIRTABLE_API_KEY')
  if (!airtableApiKey) {
    return json({ error: 'AIRTABLE_API_KEY secret not set' }, 500)
  }

  // ── Load lookup tables once before paging ─────────────────────────────────
  // `shows` has no `name` column; fall back to `program` as the display key.
  const { data: shows } = await admin
    .from('shows')
    .select('id, program, sub_program, airtable_record_id')
    .limit(10000)

  const showsByAirtableId = new Map<string, string>()
  const showsByName = new Map<string, string>()
  for (const s of shows ?? []) {
    const sAny = s as any
    if (sAny.airtable_record_id) showsByAirtableId.set(sAny.airtable_record_id, s.id)
    if (sAny.program) showsByName.set(String(sAny.program).toLowerCase(), s.id)
  }

  const { data: citiesRows } = await admin
    .from('cities')
    .select('id, name')
    .limit(10000)

  const citiesByName = new Map<string, string>()
  for (const c of citiesRows ?? []) {
    citiesByName.set(c.name.toLowerCase(), c.id)
  }

  // Bulk-load all existing show_dates keyed by airtable_record_id to avoid N+1 SELECTs.
  const { data: existingDates } = await admin
    .from('show_dates')
    .select('id, airtable_record_id')
    .not('airtable_record_id', 'is', null)
    .limit(10000)
  const existingByAirtableId = new Map<string, string>(
    (existingDates ?? [])
      .filter((r: any) => r.airtable_record_id)
      .map((r: any) => [r.airtable_record_id as string, r.id as string])
  )

  // ── Fetch pages and process records immediately (no full-buffer) ──────────
  const encodedTable = encodeURIComponent(tableName)
  const airtableBaseUrl = `https://api.airtable.com/v0/${baseId}/${encodedTable}?view=Grid%20view`

  let processed = 0
  let newDates = 0
  const newDateIds: string[] = []
  let offset: string | undefined = undefined
  let pageCount = 0
  const MAX_PAGES = 100

  do {
    pageCount += 1
    const url = offset ? `${airtableBaseUrl}&offset=${encodeURIComponent(offset)}` : airtableBaseUrl
    const airtableRes = await fetch(url, {
      headers: { Authorization: `Bearer ${airtableApiKey}` },
    })

    if (!airtableRes.ok) {
      const errBody = (await airtableRes.text()).slice(0, 500)
      console.error('airtable-poll: Airtable API error', { status: airtableRes.status, body: errBody })
      await admin.from('airtable_sync_log').insert({
        sync_type: 'airtable_poll',
        status: 'error',
        records_processed: processed,
        error_details: `Airtable API error ${airtableRes.status}: ${errBody}`,
        synced_at: new Date().toISOString(),
      })
      return json({ error: `Airtable API error: ${airtableRes.status}` }, 502)
    }

    const page = await airtableRes.json()
    offset = page.offset

    for (const record of (page.records ?? []) as Array<{ id: string; fields: Record<string, any> }>) {
      const fields = record.fields
      const airtableRecordId = record.id

      const dateValue = fields['Date'] ?? fields['date'] ?? fields['Show Date'] ?? null
      if (!dateValue) continue

      const showAirtableId = fields['Show ID'] ?? fields['show_id'] ?? null
      const showName = fields['Show'] ?? fields['show'] ?? fields['Show Name'] ?? null

      let showId: string | null = null
      if (showAirtableId && showsByAirtableId.has(String(showAirtableId))) {
        showId = showsByAirtableId.get(String(showAirtableId))!
      } else if (showName && showsByName.has(String(showName).toLowerCase())) {
        showId = showsByName.get(String(showName).toLowerCase())!
      }

      if (!showId) {
        console.warn('airtable-poll: could not resolve show for record', { airtableRecordId, showAirtableId, showName })
        continue
      }

      const cityName = fields['City'] ?? fields['city'] ?? null
      let cityId: string | null = null
      if (cityName && citiesByName.has(String(cityName).toLowerCase())) {
        cityId = citiesByName.get(String(cityName).toLowerCase())!
      }

      const existingId = existingByAirtableId.get(airtableRecordId)

      if (existingId) {
        const { error: updateErr } = await admin
          .from('show_dates')
          .update({ date: dateValue, city_id: cityId })
          .eq('id', existingId)
        if (updateErr) {
          console.error('airtable-poll: update error', { airtableRecordId, error: updateErr.message })
          continue
        }
        processed += 1
        continue
      }

      const { data: inserted, error: insertErr } = await admin
        .from('show_dates')
        .insert({
          show_id: showId,
          date: dateValue,
          airtable_record_id: airtableRecordId,
          city_id: cityId,
        })
        .select('id')
        .single()

      if (insertErr) {
        console.error('airtable-poll: insert error', { airtableRecordId, error: insertErr.message })
        continue
      }

      if (inserted?.id) {
        processed += 1
        newDates += 1
        newDateIds.push(inserted.id)
        existingByAirtableId.set(airtableRecordId, inserted.id)
      }
    }
  } while (offset && pageCount < MAX_PAGES)

  if (pageCount >= MAX_PAGES) {
    console.warn('airtable-poll: reached MAX_PAGES limit; sync may be incomplete')
  }

  // ── Open tier-1 offers in batches to avoid saturating the DB connection pool ──
  let tiersOpened = 0
  for (let i = 0; i < newDateIds.length; i += OFFER_TIER_BATCH_SIZE) {
    const batch = newDateIds.slice(i, i + OFFER_TIER_BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(id => admin.functions.invoke('open-offer-tier', {
        body: { show_date_id: id, tier: 1 },
      }))
    )
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { error: invokeErr } = result.value
        if (invokeErr) {
          console.error('airtable-poll: open-offer-tier failed', { error: invokeErr })
        } else {
          tiersOpened += 1
        }
      } else {
        console.error('airtable-poll: open-offer-tier threw', { reason: result.reason })
      }
    }
  }

  const tiersFailed = newDateIds.length - tiersOpened
  await admin.from('airtable_sync_log').insert({
    sync_type: 'airtable_poll',
    status: tiersFailed > 0 ? 'partial' : 'success',
    records_processed: processed,
    error_details: tiersFailed > 0 ? `${tiersFailed} of ${newDateIds.length} open-offer-tier calls failed` : null,
    synced_at: new Date().toISOString(),
  })

  return json({ processed, new_dates: newDates, tiers_opened: tiersOpened })
})
