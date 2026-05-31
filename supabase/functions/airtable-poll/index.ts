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

// deno-lint-ignore no-explicit-any
async function openOfferTierBatch(admin: any, ids: string[]): Promise<number> {
  let opened = 0
  for (let i = 0; i < ids.length; i += OFFER_TIER_BATCH_SIZE) {
    const batch = ids.slice(i, i + OFFER_TIER_BATCH_SIZE)
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
          opened += 1
        }
      } else {
        console.error('airtable-poll: open-offer-tier threw', { reason: result.reason })
      }
    }
  }
  return opened
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

  // Airtable base IDs: "app" + at least 14 alphanumeric chars (standard format is 17 chars total).
  if (!/^app[A-Za-z0-9]{14,}$/.test(baseId)) {
    await admin.from('airtable_sync_log').insert({
      sync_type: 'airtable_poll',
      status: 'error',
      records_processed: 0,
      error_details: 'airtable_base_id has unexpected format; expected app + 14 alphanumeric chars',
      synced_at: new Date().toISOString(),
    })
    return json({ error: 'airtable_base_id has unexpected format; expected app + 14 alphanumeric chars' }, 422)
  }

  const airtableApiKey = Deno.env.get('AIRTABLE_API_KEY')
  if (!airtableApiKey) {
    await admin.from('airtable_sync_log').insert({
      sync_type: 'airtable_poll',
      status: 'error',
      records_processed: 0,
      error_details: 'AIRTABLE_API_KEY secret not set',
      synced_at: new Date().toISOString(),
    })
    return json({ error: 'AIRTABLE_API_KEY secret not set' }, 500)
  }

  // ── Load lookup tables once before paging ─────────────────────────────────
  // Keyed on "program|sub_program" to disambiguate shows that share a program name.
  const { data: shows } = await admin
    .from('shows')
    .select('id, program, sub_program')
    .limit(10000)

  const showsByName = new Map<string, string>()
  for (const s of shows ?? []) {
    if (s.program) {
      const key = `${String(s.program).toLowerCase()}|${s.sub_program ? String(s.sub_program).toLowerCase() : ''}`
      if (showsByName.has(key)) {
        console.warn('airtable-poll: duplicate (program, sub_program) key in shows; last one wins', { key })
      }
      showsByName.set(key, s.id)
    }
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
  // Paginated via .range() so tables larger than PostgREST's 1 000-row default are fully loaded.
  const existingByAirtableId = new Map<string, string>()
  {
    const PAGE_SIZE = 1000
    let page = 0
    while (true) {
      const { data: batch } = await admin
        .from('show_dates')
        .select('id, airtable_record_id')
        .not('airtable_record_id', 'is', null)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      if (!batch || batch.length === 0) break
      for (const r of batch as any[]) {
        if (r.airtable_record_id) existingByAirtableId.set(r.airtable_record_id as string, r.id as string)
      }
      if (batch.length < PAGE_SIZE) break
      page += 1
    }
  }

  // ── Fetch pages and process records immediately (no full-buffer) ──────────
  const encodedTable = encodeURIComponent(tableName)
  const airtableBaseUrl = `https://api.airtable.com/v0/${baseId}/${encodedTable}?view=Grid%20view`

  let processed = 0
  let newDates = 0
  let skippedRecords = 0
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
      // Flush already-inserted dates so they get offers before aborting.
      const partialTiersOpened = await openOfferTierBatch(admin, newDateIds)
      await admin.from('airtable_sync_log').insert({
        sync_type: 'airtable_poll',
        status: 'error',
        records_processed: processed,
        error_details: `Airtable API error ${airtableRes.status}: ${errBody}`,
        synced_at: new Date().toISOString(),
      })
      return json({ error: `Airtable API error: ${airtableRes.status}`, new_dates: newDates, tiers_opened: partialTiersOpened }, 502)
    }

    const page = await airtableRes.json()
    offset = page.offset

    for (const record of (page.records ?? []) as Array<{ id: string; fields: Record<string, any> }>) {
      const fields = record.fields
      const airtableRecordId = record.id

      const dateValue = fields['Date'] ?? fields['date'] ?? fields['Show Date'] ?? null
      if (!dateValue) continue

      const showName = fields['Show'] ?? fields['show'] ?? fields['Show Name'] ?? null
      const showSubProgram = fields['Sub Program'] ?? fields['sub_program'] ?? null

      let showId: string | null = null
      if (showName) {
        const nameKey = String(showName).toLowerCase()
        const subKey = showSubProgram ? String(showSubProgram).toLowerCase() : ''
        // Prefer exact (program, sub_program) match; fall back to program-only (sub_program absent in DB).
        showId = showsByName.get(`${nameKey}|${subKey}`) ?? showsByName.get(`${nameKey}|`) ?? null
      }

      if (!showId) {
        console.warn('airtable-poll: could not resolve show for record', { airtableRecordId, showName })
        skippedRecords += 1
        continue
      }

      const cityName = fields['City'] ?? fields['city'] ?? null
      let cityId: string | null = null
      if (cityName && citiesByName.has(String(cityName).toLowerCase())) {
        cityId = citiesByName.get(String(cityName).toLowerCase())!
      }

      const rawSession1 = fields['Session 1'] ?? fields['session_1'] ?? fields['Start Time']
      const session1Match = rawSession1 ? String(rawSession1).match(/T?(\d{2}:\d{2})(:\d{2})?/) : null
      const session1 = session1Match ? session1Match[1] : '00:00'

      const existingId = existingByAirtableId.get(airtableRecordId)

      if (existingId) {
        const updatePayload: Record<string, unknown> = { date: dateValue, session_1: session1 }
        if (cityId !== null) updatePayload.city_id = cityId
        const { error: updateErr } = await admin
          .from('show_dates')
          .update(updatePayload)
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
          session_1: session1,
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
      } else {
        console.warn('airtable-poll: insert returned no id without error', { airtableRecordId })
      }
    }
  } while (offset && pageCount < MAX_PAGES)

  // Only warn/flag truncation if the loop exited because of the page cap, not because pages ran out.
  const truncated = pageCount >= MAX_PAGES && !!offset
  if (truncated) {
    console.warn('airtable-poll: reached MAX_PAGES limit; sync may be incomplete')
  }

  // ── Open tier-1 offers in batches to avoid saturating the DB connection pool ──
  const tiersOpened = await openOfferTierBatch(admin, newDateIds)

  const tiersFailed = newDateIds.length - tiersOpened
  const statusParts: string[] = []
  if (truncated) statusParts.push(`Reached MAX_PAGES (${MAX_PAGES}); sync is incomplete`)
  if (tiersFailed > 0) statusParts.push(`${tiersFailed} of ${newDateIds.length} open-offer-tier calls failed`)

  const infoParts: string[] = [...statusParts]
  if (skippedRecords > 0) infoParts.push(`${skippedRecords} records skipped (unresolved show)`)

  await admin.from('airtable_sync_log').insert({
    sync_type: 'airtable_poll',
    status: statusParts.length > 0 ? 'partial' : 'success',
    records_processed: processed,
    error_details: infoParts.length > 0 ? infoParts.join('; ') : null,
    synced_at: new Date().toISOString(),
  })

  return json({ processed, new_dates: newDates, tiers_opened: tiersOpened, skipped: skippedRecords })
})
