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
 * Hourly job:
 *   1. Call expire_soft_bookings() RPC to cancel any expired offers.
 *   2. For each show_date with a still-unfilled tier after expiry, write a
 *      cast_escalation_requested notification + send a producer email.
 *   3. Mark show_date_offer_tiers.escalation_notified_at to be idempotent.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  // 1. Expire stale offers
  const { error: rpcErr } = await admin.rpc('expire_soft_bookings')
  if (rpcErr) return json({ error: `expire_soft_bookings: ${rpcErr.message}` }, 500)

  // 2. Find open tiers that have never been escalated
  const { data: openTiers } = await (admin as any)
    .from('show_date_offer_tiers')
    .select('id, show_date_id, tier, escalation_notified_at')
    .is('closed_at', null)
    .is('escalation_notified_at', null)

  if (!openTiers || openTiers.length === 0) return json({ expired: true, escalations: 0 })

  // Slot defaults
  const { data: slotsSetting } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'sub_program_slots_defaults')
    .maybeSingle()
  const slotDefaults = (slotsSetting?.value as Record<string, Record<string, { main_cast: number; understudies: number }>>) ?? {}

  let escalated = 0

  for (const row of openTiers as Array<{ id: string; show_date_id: string; tier: number }>) {
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

    // Has every open offer in this tier expired (or been resolved) AND the tier still isn't filled?
    const { data: bookings } = await admin
      .from('bookings')
      .select('status, offer_expires_at')
      .eq('show_date_id', row.show_date_id)
      .eq('offer_tier', row.tier)

    const accepted = (bookings ?? []).filter((b: any) => b.status === 'soft_booked' || b.status === 'confirmed').length
    const pendingNotExpired = (bookings ?? []).filter((b: any) =>
      b.status === 'suggested' && (!b.offer_expires_at || new Date(b.offer_expires_at) > new Date())
    ).length

    // Only escalate when the tier window has fully closed (no live pending) AND still short of slots
    if (pendingNotExpired > 0) continue
    if (accepted >= requiredSlots) continue

    // Resolve recipients
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

    const message = `Tier ${row.tier} for ${program ?? 'show'} on ${(sd as any).date} expired with ${accepted}/${requiredSlots} slots filled — open the next tier.`

    const notifRows = recipientIds.map((uid: string) => ({
      user_id: uid,
      type: 'cast_escalation_requested',
      title: 'Escalation needed',
      message,
      related_entity_type: 'show_date_offer_tier',
      related_entity_id: row.id,
    }))
    if (notifRows.length > 0) {
      await admin.from('notifications').insert(notifRows)
    }

    // Send producer emails (best-effort, non-blocking on failures)
    for (const uid of recipientIds) {
      const { data: profile } = await admin.from('profiles').select('email').eq('user_id', uid).maybeSingle()
      const recipientEmail = (profile as any)?.email
      if (!recipientEmail) continue
      try {
        await admin.functions.invoke('send-transactional-email', {
          body: {
            template_name: 'cast-escalation-requested',
            recipient_email: recipientEmail,
            templateData: { program, date: (sd as any).date, tier: row.tier, accepted, required: requiredSlots },
          },
        })
      } catch (e) {
        console.error('expire-offers: email send failed', { uid, error: (e as Error).message })
      }
    }

    // Mark idempotent
    await (admin as any)
      .from('show_date_offer_tiers')
      .update({ escalation_notified_at: new Date().toISOString() })
      .eq('id', row.id)

    escalated += 1
  }

  return json({ expired: true, escalations: escalated })
})
