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

/**
 * Scans all open offer tiers and emits a `tier_at_risk` notification when a
 * (show_date, tier) becomes mathematically unable to fill before the deadline:
 *   remaining_pending + accepted < required_slots
 *
 * Visual-only (in-app); no email. Idempotent: one notification per (date, tier)
 * — clears when math recovers (by deleting the old row before re-evaluating).
 *
 * Auth: X-Cron-Secret header (pg_cron) or user JWT (admin/producer manual trigger).
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  // ── Auth: X-Cron-Secret or user JWT ──────────────────────────────────────
  const cronSecretHeader = req.headers.get('X-Cron-Secret')
  if (cronSecretHeader) {
    const { data: secretSetting } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'cron_secret')
      .maybeSingle()
    const storedSecret = (secretSetting?.value as string | null) ?? ''
    if (cronSecretHeader !== storedSecret) return json({ error: 'Unauthorized' }, 401)
  } else {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
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

  // Load all currently-open tiers (closed_at IS NULL)
  const { data: openTiers, error: tiersErr } = await (admin as any)
    .from('show_date_offer_tiers')
    .select('id, show_date_id, tier')
    .is('closed_at', null)

  if (tiersErr) return json({ error: tiersErr.message }, 500)
  if (!openTiers || openTiers.length === 0) return json({ at_risk_count: 0 })

  // Load slot defaults
  const { data: slotsSetting } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'sub_program_slots_defaults')
    .maybeSingle()
  const slotDefaults = (slotsSetting?.value as Record<string, Record<string, { main_cast: number; understudies: number }>>) ?? {}

  // Clear stale tier_at_risk notifications first; we re-emit below for still-at-risk ones
  await admin
    .from('notifications')
    .delete()
    .eq('type', 'tier_at_risk')

  let atRiskCount = 0

  for (const row of openTiers as Array<{ id: string; show_date_id: string; tier: number }>) {
    // Resolve show date + show meta
    const { data: sd } = await admin
      .from('show_dates')
      .select('id, date, city_id, show:shows(program, sub_program)')
      .eq('id', row.show_date_id)
      .maybeSingle()
    if (!sd) continue

    const program = (sd as any).show?.program
    const subProgram = (sd as any).show?.sub_program
    const slotCfg = slotDefaults?.[program]?.[subProgram]
    if (!slotCfg) continue
    const requiredSlots = slotCfg.main_cast + slotCfg.understudies
    if (requiredSlots === 0) continue

    // Count for this show_date, this tier
    const { data: bookings } = await admin
      .from('bookings')
      .select('status')
      .eq('show_date_id', row.show_date_id)
      .eq('offer_tier', row.tier)

    const pending = (bookings ?? []).filter((b: any) => b.status === 'suggested').length
    const accepted = (bookings ?? []).filter((b: any) => b.status === 'soft_booked' || b.status === 'confirmed').length

    if (pending + accepted >= requiredSlots) continue // healthy

    atRiskCount += 1

    // Resolve producers to notify (admin fallback)
    const { data: producers } = await (admin as any).rpc('resolve_show_assignments', {
      p_program: program ?? '',
      p_sub_program: subProgram,
      p_city_id: (sd as any).city_id,
    })

    let recipientIds = (producers ?? []).map((p: any) => p.producer_user_id)
    if (recipientIds.length === 0) {
      const { data: admins } = await admin.from('user_roles').select('user_id').eq('role', 'admin')
      recipientIds = (admins ?? []).map((a: any) => a.user_id)
    }

    const payloadMessage = `Tier ${row.tier} for ${program ?? 'show'} on ${(sd as any).date} is mathematically unfillable (${pending} pending, ${accepted} accepted, need ${requiredSlots}).`

    const rows = recipientIds.map((uid: string) => ({
      user_id: uid,
      type: 'tier_at_risk',
      title: 'Tier at risk',
      message: payloadMessage,
      related_entity_type: 'show_date_offer_tier',
      related_entity_id: row.id,
    }))

    if (rows.length > 0) {
      await admin.from('notifications').insert(rows)
    }
  }

  return json({ at_risk_count: atRiskCount })
})
