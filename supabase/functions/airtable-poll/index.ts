import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { getActiveOrgs, resolveOrgSetting } from "../_shared/settings.ts";

/** Max concurrent open-offer-tier invocations per batch to avoid exhausting the DB connection pool. */
const OFFER_TIER_BATCH_SIZE = 10;

async function openOfferTierBatch(deps: Deps, ids: string[]): Promise<number> {
  let opened = 0;
  for (let i = 0; i < ids.length; i += OFFER_TIER_BATCH_SIZE) {
    const batch = ids.slice(i, i + OFFER_TIER_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((id) => deps.invokeFunction('open-offer-tier', { show_date_id: id, tier: 1 })),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value.error) console.error('airtable-poll: open-offer-tier failed', { error: result.value.error });
        else opened += 1;
      } else {
        console.error('airtable-poll: open-offer-tier threw', { reason: result.reason });
      }
    }
  }
  return opened;
}

interface OrgSyncResult { processed: number; new_dates: number; tiers_opened: number; skipped: number }

/** Sync one org's Airtable base into its show_dates. org_id on show_dates comes
 *  from the derive trigger (parent show); the lookup maps are org-scoped here so
 *  a record only ever matches THIS org's shows/cities. */
async function syncOrg(deps: Deps, orgId: string, baseId: string, tableName: string, apiKey: string): Promise<OrgSyncResult> {
  const admin = deps.admin;

  // ── Load lookup tables once before paging (org-scoped) ────────────────────
  // Keyed on "program|sub_program" to disambiguate shows that share a program name.
  const { data: shows } = await admin.from('shows').select('id, program, sub_program').eq('org_id', orgId).limit(10000);
  const showsByName = new Map<string, string>();
  for (const s of shows ?? []) {
    if (s.program) {
      const key = `${String(s.program).toLowerCase()}|${s.sub_program ? String(s.sub_program).toLowerCase() : ''}`;
      if (showsByName.has(key)) {
        console.warn('airtable-poll: duplicate (program, sub_program) key in shows; last one wins', { key });
      }
      showsByName.set(key, s.id);
    }
  }

  const { data: citiesRows } = await admin.from('cities').select('id, name').eq('org_id', orgId).limit(10000);
  const citiesByName = new Map<string, string>();
  for (const c of citiesRows ?? []) citiesByName.set(c.name.toLowerCase(), c.id);

  // Bulk-load all existing show_dates keyed by airtable_record_id to avoid N+1 SELECTs.
  // Paginated via .range() so tables larger than PostgREST's 1 000-row default are fully loaded.
  const existingByAirtableId = new Map<string, string>();
  {
    const PAGE_SIZE = 1000;
    let page = 0;
    while (true) {
      const { data: batch } = await admin
        .from('show_dates').select('id, airtable_record_id')
        .eq('org_id', orgId).not('airtable_record_id', 'is', null)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (!batch || batch.length === 0) break;
      for (const r of batch as any[]) if (r.airtable_record_id) existingByAirtableId.set(r.airtable_record_id as string, r.id as string);
      if (batch.length < PAGE_SIZE) break;
      page += 1;
    }
  }

  // ── Fetch pages and process records immediately (no full-buffer) ──────────
  const encodedTable = encodeURIComponent(tableName);
  const airtableBaseUrl = `https://api.airtable.com/v0/${baseId}/${encodedTable}?view=Grid%20view`;
  let processed = 0, newDates = 0, skippedRecords = 0;
  const newDateIds: string[] = [];
  let offset: string | undefined;
  let pageCount = 0;
  const MAX_PAGES = 100;

  do {
    pageCount += 1;
    const url = offset ? `${airtableBaseUrl}&offset=${encodeURIComponent(offset)}` : airtableBaseUrl;
    const airtableRes = await deps.fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!airtableRes.ok) {
      const errBody = (await airtableRes.text()).slice(0, 500);
      console.error('airtable-poll: Airtable API error', { org: orgId, status: airtableRes.status, body: errBody });
      // Flush already-inserted dates so they get offers before aborting this org.
      const partial = await openOfferTierBatch(deps, newDateIds);
      await admin.from('airtable_sync_log').insert({ org_id: orgId, sync_type: 'airtable_poll', status: 'error', records_processed: processed, error_details: `Airtable API error ${airtableRes.status}: ${errBody}`, synced_at: deps.now().toISOString() });
      throw { httpStatus: 502, body: { error: `Airtable API error: ${airtableRes.status}`, org_id: orgId, new_dates: newDates, tiers_opened: partial } };
    }
    const pageData = await airtableRes.json();
    offset = pageData.offset;
    for (const record of (pageData.records ?? []) as Array<{ id: string; fields: Record<string, any> }>) {
      const fields = record.fields;
      const airtableRecordId = record.id;
      const dateValue = fields['Date'] ?? fields['date'] ?? fields['Show Date'] ?? null;
      if (!dateValue) continue;
      const showName = fields['Show'] ?? fields['show'] ?? fields['Show Name'] ?? null;
      const showSubProgram = fields['Sub Program'] ?? fields['sub_program'] ?? null;
      let showId: string | null = null;
      if (showName) {
        const nameKey = String(showName).toLowerCase();
        const subKey = showSubProgram ? String(showSubProgram).toLowerCase() : '';
        // Prefer exact (program, sub_program) match; fall back to program-only (sub_program absent in DB).
        showId = showsByName.get(`${nameKey}|${subKey}`) ?? showsByName.get(`${nameKey}|`) ?? null;
      }
      if (!showId) {
        console.warn('airtable-poll: could not resolve show for record', { org: orgId, airtableRecordId, showName });
        skippedRecords += 1;
        continue;
      }
      const cityName = fields['City'] ?? fields['city'] ?? null;
      let cityId: string | null = null;
      if (cityName && citiesByName.has(String(cityName).toLowerCase())) cityId = citiesByName.get(String(cityName).toLowerCase())!;
      const rawSession1 = fields['Session 1'] ?? fields['session_1'] ?? fields['Start Time'];
      const m = rawSession1 ? String(rawSession1).match(/T?(\d{2}:\d{2})(:\d{2})?/) : null;
      const session1 = m ? m[1] : '00:00';

      const existingId = existingByAirtableId.get(airtableRecordId);
      if (existingId) {
        const payload: Record<string, unknown> = { date: dateValue, session_1: session1 };
        if (cityId !== null) payload.city_id = cityId;
        const { error } = await admin.from('show_dates').update(payload).eq('id', existingId);
        if (error) {
          console.error('airtable-poll: update error', { org: orgId, airtableRecordId, error: error.message });
          continue;
        }
        processed += 1;
        continue;
      }
      // org_id is set by the derive trigger from show_id.
      const { data: inserted, error: insertErr } = await admin.from('show_dates')
        .insert({ show_id: showId, date: dateValue, airtable_record_id: airtableRecordId, city_id: cityId, session_1: session1 })
        .select('id').single();
      if (insertErr) {
        console.error('airtable-poll: insert error', { org: orgId, airtableRecordId, error: insertErr.message });
        continue;
      }
      if (inserted?.id) {
        processed += 1;
        newDates += 1;
        newDateIds.push(inserted.id);
        existingByAirtableId.set(airtableRecordId, inserted.id);
      } else {
        console.warn('airtable-poll: insert returned no id without error', { org: orgId, airtableRecordId });
      }
    }
  } while (offset && pageCount < MAX_PAGES);

  // Only warn/flag truncation if the loop exited because of the page cap, not because pages ran out.
  const truncated = pageCount >= MAX_PAGES && !!offset;
  if (truncated) console.warn('airtable-poll: reached MAX_PAGES limit; sync may be incomplete', { org: orgId });

  // ── Open tier-1 offers in batches to avoid saturating the DB connection pool ──
  const tiersOpened = await openOfferTierBatch(deps, newDateIds);
  const tiersFailed = newDateIds.length - tiersOpened;
  const parts: string[] = [];
  if (truncated) parts.push(`Reached MAX_PAGES (${MAX_PAGES}); sync is incomplete`);
  if (tiersFailed > 0) parts.push(`${tiersFailed} of ${newDateIds.length} open-offer-tier calls failed`);
  if (skippedRecords > 0) parts.push(`${skippedRecords} records skipped (unresolved show)`);
  await admin.from('airtable_sync_log').insert({ org_id: orgId, sync_type: 'airtable_poll', status: (truncated || tiersFailed > 0) ? 'partial' : 'success', records_processed: processed, error_details: parts.length ? parts.join('; ') : null, synced_at: deps.now().toISOString() });

  return { processed, new_dates: newDates, tiers_opened: tiersOpened, skipped: skippedRecords };
}

/**
 * Polls Airtable for show date records per ACTIVE org and upserts into show_dates,
 * then calls open-offer-tier (tier 1) for each newly inserted date.
 *
 * For each active org it resolves, from app_settings (org override ?? platform default):
 *   - airtable_sync_enabled (bool) — skip the org when false
 *   - airtable_base_id / airtable_table_name — skip when unconfigured or base has a bad format
 * and reads that org's Airtable API key from the Vault via the get_org_airtable_key
 * service-role RPC — skip the org when no key is configured.
 *
 * One org's settings/key/Airtable failure never aborts the others (per-org loop
 * body is wrapped: log + continue). Returns totals across all synced orgs.
 *
 * Auth: X-Cron-Secret header (pg_cron, platform cron_secret row). Cron-only — no user JWT.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight();
  const admin = deps.admin;

  // ── Auth: X-Cron-Secret (hardened to the platform cron_secret row) ────────
  const cronSecretHeader = req.headers.get('X-Cron-Secret');
  if (!cronSecretHeader) return json({ error: 'Unauthorized' }, 401);
  const { data: secretSetting } = await admin
    .from('app_settings').select('value').eq('key', 'cron_secret').is('org_id', null).maybeSingle();
  if (cronSecretHeader !== ((secretSetting?.value as string | null) ?? '')) return json({ error: 'Unauthorized' }, 401);

  let orgs: Array<{ id: string }>;
  try {
    orgs = await getActiveOrgs(admin);
  } catch (e) {
    console.error('airtable-poll: failed to fetch active orgs', { error: (e as Error).message });
    return json({ error: 'failed to fetch active orgs' }, 500);
  }

  const totals = { orgs_synced: 0, processed: 0, new_dates: 0, tiers_opened: 0, skipped: 0 };

  for (const org of orgs) {
    // One org's settings/key/Airtable failure must never abort the others.
    try {
      const enabled = await resolveOrgSetting<boolean>(admin, org.id, 'airtable_sync_enabled', false);
      if (!enabled) continue;
      const baseId = await resolveOrgSetting<string | null>(admin, org.id, 'airtable_base_id', null);
      const tableName = await resolveOrgSetting<string | null>(admin, org.id, 'airtable_table_name', null);
      if (!baseId || !tableName) continue;
      // Airtable base IDs: "app" + at least 14 alphanumeric chars (standard format is 17 chars total).
      if (!/^app[A-Za-z0-9]{14,}$/.test(baseId)) {
        await admin.from('airtable_sync_log').insert({ org_id: org.id, sync_type: 'airtable_poll', status: 'error', records_processed: 0, error_details: 'airtable_base_id has unexpected format; expected app + 14 alphanumeric chars', synced_at: deps.now().toISOString() });
        continue;
      }
      const { data: apiKey } = await admin.rpc('get_org_airtable_key', { _org: org.id });
      if (!apiKey) continue; // sync enabled but no key configured

      const r = await syncOrg(deps, org.id, baseId, tableName, apiKey as string);
      totals.orgs_synced += 1;
      totals.processed += r.processed;
      totals.new_dates += r.new_dates;
      totals.tiers_opened += r.tiers_opened;
      totals.skipped += r.skipped;
    } catch (e) {
      console.error('airtable-poll: org sync failed', { org: org.id, error: (e as { body?: unknown })?.body ?? (e as Error).message });
      // continue with the next org; any sync_log error row was already recorded inside syncOrg.
    }
  }

  return json(totals);
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
