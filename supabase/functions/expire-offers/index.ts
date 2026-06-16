import { preflight, json } from "../_shared/http.ts";
import { requireCronOrRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

/**
 * Hourly job:
 *   1. Call expire_soft_bookings() RPC to cancel any expired offers.
 *   2. For each show_date with a still-unfilled tier after expiry, write a
 *      cast_escalation_requested notification + send a producer email.
 *   3. Mark show_date_offer_tiers.escalation_notified_at to be idempotent.
 *
 * Auth: X-Cron-Secret header (pg_cron) or user JWT (admin/producer manual trigger).
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const admin = deps.admin;

  // ── Auth: X-Cron-Secret or user JWT ──────────────────────────────────────
  const auth = await requireCronOrRole(deps, req, ["admin", "producer"]);
  if (!auth.ok) return auth.response;

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

  let escalated = 0

  for (const row of openTiers as Array<{ id: string; show_date_id: string; tier: number }>) {
    const { data: sd } = await admin
      .from('show_dates')
      .select('id, date, city_id, org_id, show:shows(program, sub_program, main_cast_slots, understudy_slots)')
      .eq('id', row.show_date_id)
      .maybeSingle()
    if (!sd) continue

    const program = (sd as any).show?.program
    const subProgram = (sd as any).show?.sub_program
    const mainCastSlots: number | null = (sd as any).show?.main_cast_slots ?? null
    const understudySlots: number | null = (sd as any).show?.understudy_slots ?? null

    // NULL slot columns = unconfigured show; skip (mirrors old behaviour when the
    // sub_program_slots_defaults JSON had no entry for this program/sub_program).
    if (mainCastSlots === null || understudySlots === null) continue
    const requiredSlots = mainCastSlots + understudySlots

    // Has every open offer in this tier expired (or been resolved) AND the tier still isn't filled?
    const { data: bookings } = await admin
      .from('bookings')
      .select('status, offer_expires_at')
      .eq('show_date_id', row.show_date_id)
      .eq('offer_tier', row.tier)

    const accepted = (bookings ?? []).filter((b: any) => b.status === 'soft_booked' || b.status === 'confirmed').length
    const pendingNotExpired = (bookings ?? []).filter((b: any) =>
      b.status === 'suggested' && (!b.offer_expires_at || new Date(b.offer_expires_at) > deps.now())
    ).length

    // Only escalate when the tier window has fully closed (no live pending) AND still short of slots
    if (pendingNotExpired > 0) continue
    if (accepted >= requiredSlots) continue

    // Resolve recipients
    const { data: producers } = await (admin as any).rpc('resolve_show_assignments', {
      p_program: program ?? '',
      p_sub_program: subProgram,
      p_city_id: (sd as any).city_id,
      p_org: (sd as any).org_id,
    })
    let recipientIds = (producers ?? []).map((p: any) => p.producer_user_id)
    if (recipientIds.length === 0) {
      // Fallback: notify admins OF THIS show_date's org (not every org's admins).
      const { data: admins } = await admin.from('org_memberships').select('user_id')
        .eq('org_id', (sd as any).org_id).eq('role', 'admin')
      recipientIds = (admins ?? []).map((a: any) => a.user_id)
    }
    recipientIds = [...new Set(recipientIds)]

    const message = `Tier ${row.tier} for ${program ?? 'show'} on ${(sd as any).date} expired with ${accepted}/${requiredSlots} slots filled — open the next tier.`

    const notifRows = recipientIds.map((uid: string) => ({
      org_id: (sd as any).org_id,
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

    // Send producer emails (best-effort, non-blocking on failures).
    // Email lives on auth.users — `profiles` has no email column.
    for (const uid of recipientIds) {
      const { data: userResp } = await admin.auth.admin.getUserById(uid)
      const recipientEmail = userResp?.user?.email
      if (!recipientEmail) continue
      try {
        await deps.sendEmail({ template_name: 'cast-escalation-requested', recipient_email: recipientEmail,
          templateData: { program, date: (sd as any).date, tier: row.tier, accepted, required: requiredSlots } })
      } catch (e) {
        console.error('expire-offers: email send failed', { uid, error: (e as Error).message })
      }
    }

    // Mark idempotent
    await (admin as any)
      .from('show_date_offer_tiers')
      .update({ escalation_notified_at: deps.now().toISOString() })
      .eq('id', row.id)

    escalated += 1
  }

  return json({ expired: true, escalations: escalated })
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
