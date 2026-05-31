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

  const airtableApiKey = Deno.env.get('AIRTABLE_API_KEY')
  if (!airtableApiKey) {
    return json({ error: 'AIRTABLE_API_KEY secret not set' }, 500)
  }

  // ── Fetch all records from Airtable (paginated) ───────────────────────
  const encodedTable = encodeURIComponent(tableName)
  const airtableBaseUrl = `https://api.airtable.com/v0/${baseId}/${encodedTable}?view=Grid%20view`

  const records: Array<{ id: string; fields: Record<string, any> }> = []
  let offset: string | undefined = undefined

  do {
    const url = offset ? `${airtableBaseUrl}&offset=${offset}` : airtableBaseUrl
    const airtableRes = await fetch(url, {
      headers: { Authorization: `Bearer ${airtableApiKey}` },
    })

    if (!airtableRes.ok) {
      const errBody = await airtableRes.text()
      console.error('airtable-poll: Airtable API error', { status: airtableRes.status, body: errBody })
      await admin.from('airtable_sync_log').insert({
        sync_type: 'airtable_poll',
        status: 'error',
        records_processed: 0,
        error_details: `Airtable API error ${airtableRes.status}: ${errBody}`,
        synced_at: new Date().toISOString(),
      })
      return json({ error: `Airtable API error: ${airtableRes.status}` }, 502)
    }

    const page = await airtableRes.json()
    records.push(...(page.records ?? []))
    offset = page.offset
  } while (offset)

  if (records.length === 0) {
    await admin.from('airtable_sync_log').insert({
      sync_type: 'airtable_poll',
      status: 'success',
      records_processed: 0,
      synced_at: new Date().toISOString(),
    })
    return json({ processed: 0, new_dates: 0, tiers_opened: 0 })
  }

  // ── Load shows (keyed by airtable_record_id and by program) and cities (by name) ─
  // `shows` has no `name` column; fall back to `program` as the display key.
  const { data: shows } = await admin
    .from('shows')
    .select('id, program, sub_program, airtable_record_id')

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

  const citiesByName = new Map<string, string>()
  for (const c of citiesRows ?? []) {
    citiesByName.set(c.name.toLowerCase(), c.id)
  }

  // ── Upsert show_dates ──────────────────────────────────────────────────
  let processed = 0
  let newDates = 0
  let tiersOpened = 0

  for (const record of records) {
    const fields = record.fields
    const airtableRecordId = record.id

    // Resolve date
    const dateValue = fields['Date'] ?? fields['date'] ?? fields['Show Date'] ?? null
    if (!dateValue) continue

    // Resolve show_id — prefer airtable_record_id match, fallback to name
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

    // Resolve city_id
    const cityName = fields['City'] ?? fields['city'] ?? null
    let cityId: string | null = null
    if (cityName && citiesByName.has(String(cityName).toLowerCase())) {
      cityId = citiesByName.get(String(cityName).toLowerCase())!
    }

    // Check if this airtable_record_id already exists
    const { data: existing } = await (admin as any)
      .from('show_dates')
      .select('id')
      .eq('airtable_record_id', airtableRecordId)
      .maybeSingle()

    if (existing) {
      // Update non-identifying fields to stay in sync with Airtable
      await admin
        .from('show_dates')
        .update({ date: dateValue, city_id: cityId })
        .eq('id', existing.id)
      processed += 1
      continue
    }

    // Insert new show_date
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

    processed += 1
    newDates += 1

    // Open tier-1 offers for the new show date
    if (inserted?.id) {
      try {
        await admin.functions.invoke('open-offer-tier', {
          body: { show_date_id: inserted.id, tier: 1 },
        })
        tiersOpened += 1
      } catch (e) {
        console.error('airtable-poll: open-offer-tier failed', {
          showDateId: inserted.id,
          error: (e as Error).message,
        })
      }
    }
  }

  await admin.from('airtable_sync_log').insert({
    sync_type: 'airtable_poll',
    status: 'success',
    records_processed: processed,
    synced_at: new Date().toISOString(),
  })

  return json({ processed, new_dates: newDates, tiers_opened: tiersOpened })
})
